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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace LendingDesk.IntegrationTests.Hidden.HomeN2;

[Collection(DatabaseGroup.Name)]
public sealed class HomeN2OutboxJamTests(PostgresFixture postgres) : IAsyncLifetime
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

    private async Task<int> ProcessOnceAsync()
    {
        await using var db = NewDb();
        return await Processor(db).ProcessPendingAsync(CancellationToken.None);
    }

    private async Task<Loan> SeedLoanAsync()
    {
        await using var db = NewDb();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var loan = new Loan
        {
            Member = new Member { Name = $"Member {suffix}", Email = $"{suffix}@example.com", CreatedAt = _clock.Now },
            Item = new Item { Name = $"Item {suffix}", Category = "Tools", Sku = $"SKU-{suffix}".ToUpperInvariant(), TotalStock = 1, CreatedAt = _clock.Now },
            StartDate = _clock.Today,
            DueDate = _clock.Today.AddDays(7),
            CreatedAt = _clock.Now,
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan;
    }

    /// <summary>Deletes the loan straight from the database, the way the cleanup did.</summary>
    private async Task DeleteLoanAsync(int loanId)
    {
        await using var db = NewDb();
        Assert.Equal(1, await db.Loans.Where(l => l.Id == loanId).ExecuteDeleteAsync());
    }

    private async Task<long> EnqueueAsync<T>(string type, T payload)
    {
        await using var db = NewDb();
        db.Enqueue(type, payload, _clock.Now);
        await db.SaveChangesAsync();
        return await db.OutboxMessages.MaxAsync(o => o.Id);
    }

    private Task<long> EnqueueCreatedAsync(Loan loan) =>
        EnqueueAsync(EventTypes.LoanCreated, new LoanCreated(loan.Id, loan.MemberId, loan.ItemId, loan.StartDate, loan.DueDate));

    private Task<long> EnqueueReturnedAsync(Loan loan) =>
        EnqueueAsync(EventTypes.LoanReturned, new LoanReturned(loan.Id, loan.MemberId, _clock.Now));

    private async Task<OutboxMessage> MessageAsync(long id)
    {
        await using var db = NewDb();
        return await db.OutboxMessages.AsNoTracking().SingleAsync(o => o.Id == id);
    }

    private async Task<List<NoticeKind>> NoticesForAsync(int loanId)
    {
        await using var db = NewDb();
        return await db.Notices.Where(n => n.LoanId == loanId).OrderBy(n => n.Id).Select(n => n.Kind).ToListAsync();
    }

    [Fact]
    public async Task A_message_for_a_deleted_loan_fails_on_its_own_and_the_messages_after_it_are_handled_in_the_same_pass()
    {
        var gone = await SeedLoanAsync();
        var kept = await SeedLoanAsync();
        var bad = await EnqueueCreatedAsync(gone);
        await DeleteLoanAsync(gone.Id);
        var created = await EnqueueCreatedAsync(kept);
        var returned = await EnqueueReturnedAsync(kept);

        var handled = await ProcessOnceAsync();

        Assert.Equal(2, handled);
        Assert.Equal([NoticeKind.Confirmation, NoticeKind.ReturnReceipt], await NoticesForAsync(kept.Id));
        Assert.Empty(await NoticesForAsync(gone.Id));

        var failed = await MessageAsync(bad);
        Assert.Equal(1, failed.Attempts);
        Assert.False(string.IsNullOrWhiteSpace(failed.LastError));
        Assert.Null(failed.ProcessedAt);
        Assert.NotNull((await MessageAsync(created)).ProcessedAt);
        Assert.NotNull((await MessageAsync(returned)).ProcessedAt);
    }

    [Fact]
    public async Task A_message_for_a_deleted_loan_is_retried_on_later_passes_then_set_aside_after_the_usual_attempts()
    {
        var gone = await SeedLoanAsync();
        var bad = await EnqueueReturnedAsync(gone);
        await DeleteLoanAsync(gone.Id);

        for (var attempt = 1; attempt <= OutboxProcessor.MaxAttempts; attempt++)
        {
            Assert.Equal(0, await ProcessOnceAsync());

            var message = await MessageAsync(bad);
            Assert.Equal(attempt, message.Attempts);
            Assert.False(string.IsNullOrWhiteSpace(message.LastError));
            if (attempt < OutboxProcessor.MaxAttempts)
            {
                Assert.Null(message.ProcessedAt);
            }
            else
            {
                Assert.NotNull(message.ProcessedAt);
            }
        }

        Assert.Equal(0, await ProcessOnceAsync());
        Assert.Equal(OutboxProcessor.MaxAttempts, (await MessageAsync(bad)).Attempts);
        Assert.Empty(await NoticesForAsync(gone.Id));
    }

    [Fact]
    public async Task Messages_queued_behind_a_failing_one_keep_flowing_on_every_pass()
    {
        var gone = await SeedLoanAsync();
        var first = await SeedLoanAsync();
        var second = await SeedLoanAsync();
        var bad = await EnqueueCreatedAsync(gone);
        await DeleteLoanAsync(gone.Id);
        await EnqueueCreatedAsync(first);

        Assert.Equal(1, await ProcessOnceAsync());

        var later = await EnqueueCreatedAsync(second);
        Assert.Equal(1, await ProcessOnceAsync());

        Assert.Equal([NoticeKind.Confirmation], await NoticesForAsync(first.Id));
        Assert.Equal([NoticeKind.Confirmation], await NoticesForAsync(second.Id));
        Assert.NotNull((await MessageAsync(later)).ProcessedAt);
        var failed = await MessageAsync(bad);
        Assert.Equal(2, failed.Attempts);
        Assert.Null(failed.ProcessedAt);
    }

    [Fact]
    public async Task Two_failing_messages_in_one_pass_are_each_counted_and_the_good_ones_between_them_are_handled()
    {
        var goneA = await SeedLoanAsync();
        var goneB = await SeedLoanAsync();
        var kept = await SeedLoanAsync();
        var badA = await EnqueueCreatedAsync(goneA);
        var good = await EnqueueCreatedAsync(kept);
        var badB = await EnqueueReturnedAsync(goneB);
        var goodAfter = await EnqueueReturnedAsync(kept);
        await DeleteLoanAsync(goneA.Id);
        await DeleteLoanAsync(goneB.Id);

        Assert.Equal(2, await ProcessOnceAsync());

        Assert.Equal([NoticeKind.Confirmation, NoticeKind.ReturnReceipt], await NoticesForAsync(kept.Id));
        Assert.NotNull((await MessageAsync(good)).ProcessedAt);
        Assert.NotNull((await MessageAsync(goodAfter)).ProcessedAt);
        foreach (var id in new[] { badA, badB })
        {
            var failed = await MessageAsync(id);
            Assert.Equal(1, failed.Attempts);
            Assert.False(string.IsNullOrWhiteSpace(failed.LastError));
            Assert.Null(failed.ProcessedAt);
        }
    }
}
