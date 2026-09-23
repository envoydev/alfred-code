using System.Net;
using System.Text.Json;
using LendingDesk.Api.Contracts;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Events;
using LendingDesk.Domain.Loans;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests;

[Collection(DatabaseGroup.Name)]
public sealed class LoansApiTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private async Task<(int MemberId, int ItemId)> SeedAsync(int stock = 1)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var member = await (await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" })).ReadAsync<MemberDto>();
        var item = await (await _staff.PostJsonAsync("/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"SKU-{suffix}", totalStock = stock })).ReadAsync<ItemDto>();
        return (member.Id, item.Id);
    }

    private Task<HttpResponseMessage> LendAsync(int memberId, int itemId, int startInDays = 0, int days = 7) =>
        _staff.PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = _api.Clock.Today.AddDays(startInDays),
            dueDate = _api.Clock.Today.AddDays(startInDays + days),
        });

    [Fact]
    public async Task Lending_an_item_takes_a_copy_and_publishes_loan_created()
    {
        var (memberId, itemId) = await SeedAsync(stock: 2);

        var response = await LendAsync(memberId, itemId);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var loan = await response.ReadAsync<LoanDto>();
        Assert.Equal(LoanState.Active, loan.Status);
        Assert.Equal(_api.Clock.Today.AddDays(7), loan.DueDate);
        Assert.Equal(1, (await (await _staff.GetAsync($"/api/items/{itemId}")).ReadAsync<ItemDto>()).Available);

        var events = await _api.WithDbAsync(db => db.OutboxMessages.Where(o => o.Type == EventTypes.LoanCreated).ToListAsync());
        var created = Assert.Single(events);
        var payload = JsonSerializer.Deserialize<LoanCreated>(created.Payload, OutboxExtensions.PayloadOptions)!;
        Assert.Equal(new LoanCreated(loan.Id, memberId, itemId, loan.StartDate, loan.DueDate), payload);
        Assert.Null(created.ProcessedAt);
    }

    [Fact]
    public async Task The_last_copy_cannot_be_lent_twice_for_overlapping_dates()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        await LendAsync(memberId, itemId, startInDays: 0, days: 5);

        var overlapping = await LendAsync(memberId, itemId, startInDays: 3, days: 5);
        var later = await LendAsync(memberId, itemId, startInDays: 6, days: 5);

        Assert.Equal(HttpStatusCode.Conflict, overlapping.StatusCode);
        Assert.Equal("item_unavailable", (await overlapping.ReadAsync<Problem>()).Code);
        Assert.Equal(HttpStatusCode.Created, later.StatusCode);
    }

    [Theory]
    [InlineData(-1, 3, "start_in_past")]
    [InlineData(0, 29, "loan_too_long")]
    public async Task Lending_rules_come_back_as_conflicts(int startInDays, int days, string code)
    {
        var (memberId, itemId) = await SeedAsync();

        var response = await LendAsync(memberId, itemId, startInDays, days);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(code, (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task A_suspended_member_cannot_borrow()
    {
        var (memberId, itemId) = await SeedAsync();
        await _api.ClientAs("admin").PostAsync($"/api/members/{memberId}/suspend", null);

        var response = await LendAsync(memberId, itemId);

        Assert.Equal("member_suspended", (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task Returning_frees_the_copy_publishes_loan_returned_and_only_happens_once()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await (await LendAsync(memberId, itemId)).ReadAsync<LoanDto>();

        var returned = await (await _staff.PostAsync($"/api/loans/{loan.Id}/return", null)).ReadAsync<LoanDto>();
        var again = await _staff.PostAsync($"/api/loans/{loan.Id}/return", null);

        Assert.Equal(LoanState.Returned, returned.Status);
        Assert.Equal(_api.Clock.Now, returned.ReturnedAt);
        Assert.Equal("loan_already_returned", (await again.ReadAsync<Problem>()).Code);
        Assert.Equal(1, (await (await _staff.GetAsync($"/api/items/{itemId}")).ReadAsync<ItemDto>()).Available);
        Assert.Equal(1, await _api.WithDbAsync(db => db.OutboxMessages.CountAsync(o => o.Type == EventTypes.LoanReturned)));
    }

    [Fact]
    public async Task A_loan_past_its_due_date_is_overdue_in_the_list_and_the_report()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await (await LendAsync(memberId, itemId, days: 3)).ReadAsync<LoanDto>();

        _api.Clock.Now = _api.Clock.Now.AddDays(5);

        var overdue = await (await _staff.GetAsync("/api/loans?status=Overdue")).ReadAsync<PagedResult<LoanDto>>();
        var report = await (await _staff.GetAsync("/api/reports/overdue")).ReadAsync<List<OverdueRowDto>>();
        Assert.Equal([loan.Id], overdue.Items.Select(l => l.Id));
        var row = Assert.Single(report);
        Assert.Equal(loan.Id, row.LoanId);
        Assert.Equal(2, row.DaysOverdue);
    }

    [Fact]
    public async Task The_overdue_report_is_for_staff()
    {
        var response = await _api.ClientAs("member").GetAsync("/api/reports/overdue");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_member_s_loans_are_listed_newest_first()
    {
        var (memberId, itemId) = await SeedAsync(stock: 2);
        var first = await (await LendAsync(memberId, itemId, startInDays: 0)).ReadAsync<LoanDto>();
        var second = await (await LendAsync(memberId, itemId, startInDays: 2)).ReadAsync<LoanDto>();

        var loans = await (await _api.ClientAs("member").GetAsync($"/api/members/{memberId}/loans")).ReadAsync<List<LoanDto>>();

        Assert.Equal([second.Id, first.Id], loans.Select(l => l.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await _staff.GetAsync("/api/members/999999/loans")).StatusCode);
    }
}
