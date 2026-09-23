using LendingDesk.Data;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Events;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;
using LendingDesk.Domain.Notices;
using LendingDesk.IntegrationTests.Infrastructure;
using LendingDesk.Worker.Notices;
using LendingDesk.Worker.Outbox;
using LendingDesk.Worker.Reminders;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace LendingDesk.IntegrationTests;

[Collection(DatabaseGroup.Name)]
public sealed class WorkerTests(PostgresFixture postgres) : IAsyncLifetime
{
    private readonly TestClock _clock = new();
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await postgres.CreateDatabaseAsync();
        await using var db = NewDb();
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private LendingDbContext NewDb() =>
        new(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(_connectionString).Options);

    private OutboxProcessor Processor(LendingDbContext db) =>
        new(db, new NoticeSender(db, _clock, NullLogger<NoticeSender>.Instance), _clock, NullLogger<OutboxProcessor>.Instance);

    private ReminderScanner Scanner(LendingDbContext db) =>
        new(db, new NoticeSender(db, _clock, NullLogger<NoticeSender>.Instance), _clock);

    private async Task<Loan> SeedLoanAsync(int dueInDays, bool returned = false)
    {
        await using var db = NewDb();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var loan = new Loan
        {
            Member = new Member { Name = $"Member {suffix}", Email = $"{suffix}@example.com", CreatedAt = _clock.Now },
            Item = new Item { Name = $"Item {suffix}", Category = "Tools", Sku = $"SKU-{suffix}".ToUpperInvariant(), TotalStock = 1, CreatedAt = _clock.Now },
            StartDate = _clock.Today.AddDays(Math.Min(dueInDays, 0) - 1),
            DueDate = _clock.Today.AddDays(dueInDays),
            ReturnedAt = returned ? _clock.Now : null,
            CreatedAt = _clock.Now,
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan;
    }

    private async Task EnqueueAsync<T>(string type, T payload)
    {
        await using var db = NewDb();
        db.Enqueue(type, payload, _clock.Now);
        await db.SaveChangesAsync();
    }

    private async Task<List<NoticeKind>> NoticesForAsync(int loanId)
    {
        await using var db = NewDb();
        return await db.Notices.Where(n => n.LoanId == loanId).OrderBy(n => n.Id).Select(n => n.Kind).ToListAsync();
    }

    [Fact]
    public async Task Loan_events_become_notices_and_are_handled_once()
    {
        var loan = await SeedLoanAsync(dueInDays: 7);
        await EnqueueAsync(EventTypes.LoanCreated, new LoanCreated(loan.Id, loan.MemberId, loan.ItemId, loan.StartDate, loan.DueDate));
        await EnqueueAsync(EventTypes.LoanReturned, new LoanReturned(loan.Id, loan.MemberId, _clock.Now));

        await using (var db = NewDb())
        {
            Assert.Equal(2, await Processor(db).ProcessPendingAsync(CancellationToken.None));
        }

        await using (var db = NewDb())
        {
            Assert.Equal(0, await Processor(db).ProcessPendingAsync(CancellationToken.None));
            Assert.All(await db.OutboxMessages.ToListAsync(), m => Assert.Equal(_clock.Now, m.ProcessedAt));
        }

        Assert.Equal([NoticeKind.Confirmation, NoticeKind.ReturnReceipt], await NoticesForAsync(loan.Id));
    }

    [Fact]
    public async Task A_repeated_event_sends_its_notice_once()
    {
        var loan = await SeedLoanAsync(dueInDays: 7);
        var created = new LoanCreated(loan.Id, loan.MemberId, loan.ItemId, loan.StartDate, loan.DueDate);
        await EnqueueAsync(EventTypes.LoanCreated, created);
        await EnqueueAsync(EventTypes.LoanCreated, created);

        await using var db = NewDb();
        await Processor(db).ProcessPendingAsync(CancellationToken.None);

        Assert.Equal([NoticeKind.Confirmation], await NoticesForAsync(loan.Id));
    }

    [Fact]
    public async Task An_unknown_message_is_retried_then_set_aside_with_its_error()
    {
        await EnqueueAsync("loan.renamed.v9", new { LoanId = 1 });

        for (var attempt = 1; attempt <= OutboxProcessor.MaxAttempts; attempt++)
        {
            await using var db = NewDb();
            Assert.Equal(0, await Processor(db).ProcessPendingAsync(CancellationToken.None));
        }

        await using var check = NewDb();
        var message = await check.OutboxMessages.SingleAsync();
        Assert.Equal(OutboxProcessor.MaxAttempts, message.Attempts);
        Assert.NotNull(message.ProcessedAt);
        Assert.Contains("loan.renamed.v9", message.LastError, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Reminders_go_to_loans_due_tomorrow_and_overdue_loans_once_each()
    {
        var dueTomorrow = await SeedLoanAsync(dueInDays: 1);
        var overdue = await SeedLoanAsync(dueInDays: -2);
        var dueLater = await SeedLoanAsync(dueInDays: 5);
        var returnedLate = await SeedLoanAsync(dueInDays: -2, returned: true);

        await using (var db = NewDb())
        {
            Assert.Equal(2, await Scanner(db).ScanAsync(CancellationToken.None));
        }

        await using (var db = NewDb())
        {
            Assert.Equal(0, await Scanner(db).ScanAsync(CancellationToken.None));
        }

        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueTomorrow.Id));
        Assert.Equal([NoticeKind.Overdue], await NoticesForAsync(overdue.Id));
        Assert.Empty(await NoticesForAsync(dueLater.Id));
        Assert.Empty(await NoticesForAsync(returnedLate.Id));
    }
}
