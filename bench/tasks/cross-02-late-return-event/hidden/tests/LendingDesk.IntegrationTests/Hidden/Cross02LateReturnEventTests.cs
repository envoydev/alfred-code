using System.Globalization;
using System.Net;
using System.Text.Json;

using LendingDesk.Data;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.Cross02;

/// <summary>
/// Hidden acceptance tests for cross-02: returning a loan writes loan.returned.v2 (with dueDate and daysLate), and
/// the worker turns a late v2 return into a LateReturn notice. Event types and payload fields are the literal wire
/// values, never C# constants or records a solution may name differently.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class LateReturnEventApiTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _api.Clock.Now = Cross02Support.LentAt;
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Theory]
    [InlineData("2026-03-12T15:00:00Z", 0)]
    [InlineData("2026-03-13T00:00:00Z", 0)]
    [InlineData("2026-03-13T23:59:59Z", 0)]
    [InlineData("2026-03-14T00:00:00Z", 1)]
    [InlineData("2026-03-14T23:59:59Z", 1)]
    [InlineData("2026-03-16T10:30:00Z", 3)]
    public async Task Returning_writes_one_loan_returned_v2_with_the_due_date_and_days_late(string returnedAtText, int daysLate)
    {
        var returnedAt = DateTimeOffset.Parse(returnedAtText, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
        var (memberId, loanId) = await Cross02Support.LendThroughApiAsync(_staff, _api.Clock, dueInDays: 3); // due 2026-03-13
        _api.Clock.Now = returnedAt;

        var response = await _staff.PostAsync($"/api/loans/{loanId}/return", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var events = await _api.WithDbAsync(db => db.OutboxMessages.AsNoTracking().OrderBy(o => o.Id).ToListAsync());
        Assert.DoesNotContain(events, e => e.Type == "loan.returned.v1");
        var returned = Assert.Single(events, e => e.Type == "loan.returned.v2");
        using var payload = JsonDocument.Parse(returned.Payload);
        var root = payload.RootElement;
        Assert.Equal(loanId, root.GetProperty("loanId").GetInt32());
        Assert.Equal(memberId, root.GetProperty("memberId").GetInt32());
        Assert.Equal(returnedAt, root.GetProperty("returnedAt").GetDateTimeOffset());
        Assert.Equal(JsonValueKind.String, root.GetProperty("dueDate").ValueKind);
        Assert.Equal("2026-03-13", root.GetProperty("dueDate").GetString());
        Assert.Equal(JsonValueKind.Number, root.GetProperty("daysLate").ValueKind);
        Assert.Equal(daysLate, root.GetProperty("daysLate").GetInt32());
    }

    [Fact]
    public async Task A_second_return_is_refused_and_writes_no_second_event()
    {
        var (_, loanId) = await Cross02Support.LendThroughApiAsync(_staff, _api.Clock, dueInDays: 3);
        _api.Clock.Now = new DateTimeOffset(2026, 3, 15, 10, 0, 0, TimeSpan.Zero);

        var first = await _staff.PostAsync($"/api/loans/{loanId}/return", null);
        var again = await _staff.PostAsync($"/api/loans/{loanId}/return", null);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("loan_already_returned", (await again.ReadAsync<Problem>()).Code);
        var types = await _api.WithDbAsync(db => db.OutboxMessages.Select(o => o.Type).ToListAsync());
        Assert.Equal(1, types.Count(t => t == "loan.returned.v2"));
        Assert.Equal(0, types.Count(t => t == "loan.returned.v1"));
    }

    [Fact]
    public async Task Lending_still_writes_loan_created_v1()
    {
        var (memberId, loanId) = await Cross02Support.LendThroughApiAsync(_staff, _api.Clock, dueInDays: 3);

        var created = Assert.Single(await _api.WithDbAsync(db => db.OutboxMessages.AsNoTracking().ToListAsync()));
        Assert.Equal("loan.created.v1", created.Type);
        using var payload = JsonDocument.Parse(created.Payload);
        Assert.Equal(loanId, payload.RootElement.GetProperty("loanId").GetInt32());
        Assert.Equal(memberId, payload.RootElement.GetProperty("memberId").GetInt32());
        Assert.Equal("2026-03-10", payload.RootElement.GetProperty("startDate").GetString());
        Assert.Equal("2026-03-13", payload.RootElement.GetProperty("dueDate").GetString());
    }
}

[Collection(DatabaseGroup.Name)]
public sealed class LateReturnWorkerTests(PostgresFixture postgres) : IAsyncLifetime
{
    private readonly TestClock _clock = new() { Now = new DateTimeOffset(2026, 3, 16, 9, 0, 0, TimeSpan.Zero) };
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await postgres.CreateDatabaseAsync();
        await using var db = Cross02Support.NewDb(_connectionString);
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task A_late_v2_return_sends_a_late_return_notice_and_no_return_receipt()
    {
        var loan = await SeedReturnedLoanAsync(daysLate: 2);
        await EnqueueV2Async(loan, daysLate: 2);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _clock);

        Assert.Equal(["LateReturn"], await Cross02Support.NoticesAsync(_connectionString, loan.Id));
    }

    [Fact]
    public async Task A_v2_return_one_day_late_sends_a_late_return_notice()
    {
        var loan = await SeedReturnedLoanAsync(daysLate: 1);
        await EnqueueV2Async(loan, daysLate: 1);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _clock);

        Assert.Equal(["LateReturn"], await Cross02Support.NoticesAsync(_connectionString, loan.Id));
    }

    [Fact]
    public async Task An_on_time_v2_return_sends_the_return_receipt()
    {
        var loan = await SeedReturnedLoanAsync(daysLate: 0);
        await EnqueueV2Async(loan, daysLate: 0);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _clock);

        Assert.Equal(["ReturnReceipt"], await Cross02Support.NoticesAsync(_connectionString, loan.Id));
    }

    [Fact]
    public async Task The_same_v2_event_arriving_twice_sends_one_notice()
    {
        var late = await SeedReturnedLoanAsync(daysLate: 3);
        var onTime = await SeedReturnedLoanAsync(daysLate: 0);
        await EnqueueV2Async(late, daysLate: 3);
        await EnqueueV2Async(late, daysLate: 3);
        await EnqueueV2Async(onTime, daysLate: 0);
        await EnqueueV2Async(onTime, daysLate: 0);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _clock);

        Assert.Equal(["LateReturn"], await Cross02Support.NoticesAsync(_connectionString, late.Id));
        Assert.Equal(["ReturnReceipt"], await Cross02Support.NoticesAsync(_connectionString, onTime.Id));
    }

    [Fact]
    public async Task A_v1_return_already_in_the_outbox_still_sends_the_return_receipt()
    {
        var loan = await SeedReturnedLoanAsync(daysLate: 2);
        await EnqueueAsync("loan.returned.v1", new { loanId = loan.Id, memberId = loan.MemberId, returnedAt = loan.ReturnedAt });

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _clock);

        Assert.Equal(["ReturnReceipt"], await Cross02Support.NoticesAsync(_connectionString, loan.Id));
    }

    /// <summary>A loan due 2026-03-13, returned at 15:00 UTC <paramref name="daysLate"/> days after that.</summary>
    private async Task<Loan> SeedReturnedLoanAsync(int daysLate)
    {
        await using var db = Cross02Support.NewDb(_connectionString);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var loan = new Loan
        {
            Member = new Member { Name = $"Member {suffix}", Email = $"{suffix}@example.com", CreatedAt = Cross02Support.LentAt },
            Item = new Item { Name = $"Item {suffix}", Category = "Tools", Sku = $"SKU-{suffix}".ToUpperInvariant(), TotalStock = 1, CreatedAt = Cross02Support.LentAt },
            StartDate = new DateOnly(2026, 3, 10),
            DueDate = new DateOnly(2026, 3, 13),
            ReturnedAt = new DateTimeOffset(new DateOnly(2026, 3, 13).AddDays(daysLate).ToDateTime(new TimeOnly(15, 0)), TimeSpan.Zero),
            CreatedAt = Cross02Support.LentAt,
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan;
    }

    private Task EnqueueV2Async(Loan loan, int daysLate) =>
        EnqueueAsync("loan.returned.v2", new
        {
            loanId = loan.Id,
            memberId = loan.MemberId,
            returnedAt = loan.ReturnedAt,
            dueDate = loan.DueDate,
            daysLate,
        });

    private async Task EnqueueAsync<T>(string type, T payload)
    {
        await using var db = Cross02Support.NewDb(_connectionString);
        db.OutboxMessages.Add(new OutboxMessage
        {
            Type = type,
            Payload = JsonSerializer.Serialize(payload, Cross02Support.Json),
            OccurredAt = _clock.Now,
        });
        await db.SaveChangesAsync();
    }
}

[Collection(DatabaseGroup.Name)]
public sealed class LateReturnEndToEndTests(PostgresFixture postgres) : IAsyncLifetime
{
    private string _connectionString = null!;
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _connectionString = await _api.WithDbAsync(db => Task.FromResult(db.Database.GetConnectionString()))
            ?? throw new InvalidOperationException("The API's database has no connection string.");
        _api.Clock.Now = Cross02Support.LentAt;
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task A_late_return_through_the_api_ends_as_a_late_return_notice()
    {
        var (_, loanId) = await Cross02Support.LendThroughApiAsync(_staff, _api.Clock, dueInDays: 3);
        _api.Clock.Now = new DateTimeOffset(2026, 3, 15, 8, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loanId}/return", null)).StatusCode);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _api.Clock);

        Assert.Equal(["Confirmation", "LateReturn"], await Cross02Support.NoticesAsync(_connectionString, loanId));
    }

    [Fact]
    public async Task A_return_on_the_due_date_through_the_api_ends_as_a_return_receipt()
    {
        var (_, loanId) = await Cross02Support.LendThroughApiAsync(_staff, _api.Clock, dueInDays: 3);
        _api.Clock.Now = new DateTimeOffset(2026, 3, 13, 20, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loanId}/return", null)).StatusCode);

        await Cross02WorkerHost.DrainOutboxAsync(_connectionString, _api.Clock);

        Assert.Equal(["Confirmation", "ReturnReceipt"], await Cross02Support.NoticesAsync(_connectionString, loanId));
    }
}

public static class Cross02Support
{
    public static readonly DateTimeOffset LentAt = new(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);

    /// <summary>The JSON form the existing events are written in (System.Text.Json web defaults: camelCase).</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static LendingDbContext NewDb(string connectionString) =>
        new(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(connectionString).Options);

    /// <summary>Creates a member and an item and lends it from the clock's today for <paramref name="dueInDays"/> days.</summary>
    public static async Task<(int MemberId, int LoanId)> LendThroughApiAsync(HttpClient staff, TestClock clock, int dueInDays)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var member = await PostAsync(staff, "/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" });
        var item = await PostAsync(staff, "/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"SKU-{suffix}", totalStock = 1 });
        var loan = await PostAsync(staff, "/api/loans", new
        {
            itemId = item.GetProperty("id").GetInt32(),
            memberId = member.GetProperty("id").GetInt32(),
            startDate = clock.Today,
            dueDate = clock.Today.AddDays(dueInDays),
        });
        return (member.GetProperty("id").GetInt32(), loan.GetProperty("id").GetInt32());
    }

    /// <summary>The kinds of notice sent for a loan, oldest first, as their stored names.</summary>
    public static async Task<List<string>> NoticesAsync(string connectionString, int loanId)
    {
        await using var db = NewDb(connectionString);
        var kinds = await db.Notices.Where(n => n.LoanId == loanId).OrderBy(n => n.Id).Select(n => n.Kind).ToListAsync();
        return [.. kinds.Select(k => k.ToString())];
    }

    private static async Task<JsonElement> PostAsync(HttpClient staff, string url, object body)
    {
        var response = await staff.PostJsonAsync(url, body);
        Assert.True(response.IsSuccessStatusCode, $"POST {url} returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.ReadAsync<JsonElement>();
    }
}
