using LendingDesk.Data;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;
using LendingDesk.Domain.Notices;
using LendingDesk.IntegrationTests.Infrastructure;
using LendingDesk.Worker.Notices;
using LendingDesk.Worker.Reminders;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LendingDesk.IntegrationTests.Hidden.Guard02;

[Collection(DatabaseGroup.Name)]
public sealed class Guard02ReminderLeadTimeTests(PostgresFixture postgres) : IAsyncLifetime
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

    private async Task<int> ScanAsync(NoticeOptions options)
    {
        await using var db = NewDb();
        var scanner = new ReminderScanner(
            db,
            new NoticeSender(db, _clock, NullLogger<NoticeSender>.Instance),
            Options.Create(options),
            _clock);
        return await scanner.ScanAsync(CancellationToken.None);
    }

    private async Task<int> SeedLoanAsync(int dueInDays, bool returned = false, int? startInDays = null)
    {
        await using var db = NewDb();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var loan = new Loan
        {
            Member = new Member { Name = $"Member {suffix}", Email = $"{suffix}@example.com", CreatedAt = _clock.Now },
            Item = new Item { Name = $"Item {suffix}", Category = "Tools", Sku = $"SKU-{suffix}".ToUpperInvariant(), TotalStock = 1, CreatedAt = _clock.Now },
            StartDate = _clock.Today.AddDays(startInDays ?? (Math.Min(dueInDays, 0) - 1)),
            DueDate = _clock.Today.AddDays(dueInDays),
            ReturnedAt = returned ? _clock.Now : null,
            CreatedAt = _clock.Now,
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan.Id;
    }

    private async Task<List<NoticeKind>> NoticesForAsync(int loanId)
    {
        await using var db = NewDb();
        return await db.Notices.Where(n => n.LoanId == loanId).OrderBy(n => n.Id).Select(n => n.Kind).ToListAsync();
    }

    [Fact]
    public async Task A_lead_time_of_3_reminds_loans_due_from_tomorrow_to_three_days_out()
    {
        var dueToday = await SeedLoanAsync(dueInDays: 0);
        var dueIn1 = await SeedLoanAsync(dueInDays: 1);
        var dueIn2 = await SeedLoanAsync(dueInDays: 2);
        var dueIn3 = await SeedLoanAsync(dueInDays: 3);
        var dueIn4 = await SeedLoanAsync(dueInDays: 4);
        var notStartedYet = await SeedLoanAsync(dueInDays: 3, startInDays: 2);
        var overdue = await SeedLoanAsync(dueInDays: -2);
        var returned = await SeedLoanAsync(dueInDays: 2, returned: true);

        Assert.Equal(5, await ScanAsync(new NoticeOptions { DueSoonDays = 3 }));
        Assert.Equal(0, await ScanAsync(new NoticeOptions { DueSoonDays = 3 }));

        Assert.Empty(await NoticesForAsync(dueToday));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn1));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn2));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn3));
        Assert.Empty(await NoticesForAsync(dueIn4));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(notStartedYet));
        Assert.Equal([NoticeKind.Overdue], await NoticesForAsync(overdue));
        Assert.Empty(await NoticesForAsync(returned));
    }

    [Fact]
    public async Task A_lead_time_of_2_stops_at_two_days_out()
    {
        var dueIn1 = await SeedLoanAsync(dueInDays: 1);
        var dueIn2 = await SeedLoanAsync(dueInDays: 2);
        var dueIn3 = await SeedLoanAsync(dueInDays: 3);

        Assert.Equal(2, await ScanAsync(new NoticeOptions { DueSoonDays = 2 }));

        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn1));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn2));
        Assert.Empty(await NoticesForAsync(dueIn3));
    }

    [Fact]
    public async Task A_lead_time_of_1_behaves_as_before()
    {
        var dueToday = await SeedLoanAsync(dueInDays: 0);
        var dueIn1 = await SeedLoanAsync(dueInDays: 1);
        var dueIn2 = await SeedLoanAsync(dueInDays: 2);
        var overdue = await SeedLoanAsync(dueInDays: -1);
        var returned = await SeedLoanAsync(dueInDays: 1, returned: true);

        Assert.Equal(2, await ScanAsync(new NoticeOptions { DueSoonDays = 1 }));
        Assert.Equal(0, await ScanAsync(new NoticeOptions { DueSoonDays = 1 }));

        Assert.Empty(await NoticesForAsync(dueToday));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn1));
        Assert.Empty(await NoticesForAsync(dueIn2));
        Assert.Equal([NoticeKind.Overdue], await NoticesForAsync(overdue));
        Assert.Empty(await NoticesForAsync(returned));
    }

    [Fact]
    public async Task A_loan_gets_one_due_soon_notice_as_the_days_pass_and_its_overdue_notice_later()
    {
        var dueIn3 = await SeedLoanAsync(dueInDays: 3);
        var dueIn5 = await SeedLoanAsync(dueInDays: 5);
        var options = new NoticeOptions { DueSoonDays = 3 };

        var sentPerDay = new List<int>();
        for (var day = 0; day <= 4; day++)
        {
            sentPerDay.Add(await ScanAsync(options));
            _clock.Now = _clock.Now.AddDays(1);
        }

        // Day 0: the loan due in 3 days. Day 2: the other one, now 3 days out. Day 4: the first is overdue.
        Assert.Equal([1, 0, 1, 0, 1], sentPerDay);
        Assert.Equal([NoticeKind.DueSoon, NoticeKind.Overdue], await NoticesForAsync(dueIn3));
        Assert.Equal([NoticeKind.DueSoon], await NoticesForAsync(dueIn5));
    }
}
