using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Notices;
using LendingDesk.IntegrationTests.Infrastructure;
using LendingDesk.Worker.Notices;
using LendingDesk.Worker.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace LendingDesk.IntegrationTests.Hidden.Api01;

/// <summary>Hidden acceptance tests for api-01: POST /api/loans/{id}/renew.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Api01LoanRenewalTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private HttpClient _admin = null!;
    private DateOnly _day0;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _admin = _api.ClientAs("admin");
        _day0 = _api.Clock.Today;
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task Staff_and_admins_renew_and_get_the_loan_back_in_its_GET_shape()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);

        var byStaff = await RenewAsync(_staff, loan.Id, _day0.AddDays(10));

        Assert.Equal(HttpStatusCode.OK, byStaff.StatusCode);
        var renewed = await byStaff.ReadAsync<LoanDto>();
        Assert.Equal(loan with { DueDate = _day0.AddDays(10) }, renewed);
        Assert.Equal(renewed, await GetLoanAsync(loan.Id));

        var byAdmin = await RenewAsync(_admin, loan.Id, _day0.AddDays(14));

        Assert.Equal(HttpStatusCode.OK, byAdmin.StatusCode);
        var again = await byAdmin.ReadAsync<LoanDto>();
        Assert.Equal(loan with { DueDate = _day0.AddDays(14) }, again);
        Assert.Equal(again, await GetLoanAsync(loan.Id));
        Assert.Equal(LoanState.Active, again.Status);
    }

    [Fact]
    public async Task A_member_gets_the_same_403_as_on_return_and_the_loan_is_unchanged()
    {
        var suffix = NewSuffix();
        var member = await (await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"renew-{suffix}@example.com" })).ReadAsync<MemberDto>();
        var itemId = await CreateItemAsync(stock: 1);
        var loan = await LendAsync(member.Id, itemId, 0, 7);
        var asMember = _api.ClientAs("member", member.Email);

        var renew = await RenewAsync(asMember, loan.Id, _day0.AddDays(10));
        var returnAttempt = await asMember.PostAsync($"/api/loans/{loan.Id}/return", null);

        Assert.Equal(HttpStatusCode.Forbidden, returnAttempt.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, renew.StatusCode);
        AssertSameError(await returnAttempt.ReadAsync<Problem>(), await renew.ReadAsync<Problem>());
        Assert.Equal(loan, await GetLoanAsync(loan.Id));
    }

    [Fact]
    public async Task A_renewal_without_a_due_date_is_a_validation_error_naming_the_field()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);

        var response = await _staff.PostJsonAsync($"/api/loans/{loan.Id}/renew", new { });
        var reference = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId, startDate = _day0 });

        Assert.Equal(HttpStatusCode.BadRequest, reference.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var expected = await reference.ReadAsync<Problem>();
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Code, problem.Code);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(400, problem.Status);
        Assert.NotNull(problem.Errors);
        Assert.Contains("DueDate", expected.Errors!.Keys);
        Assert.Contains("DueDate", problem.Errors.Keys);
        Assert.Equal(loan, await GetLoanAsync(loan.Id));
    }

    [Fact]
    public async Task An_unknown_loan_gets_the_same_404_as_the_other_loan_endpoints()
    {
        var response = await RenewAsync(_staff, 999_999, _day0.AddDays(10));
        var reference = await _staff.GetAsync("/api/loans/999999");

        Assert.Equal(HttpStatusCode.NotFound, reference.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertSameError(await reference.ReadAsync<Problem>(), await response.ReadAsync<Problem>());
    }

    [Fact]
    public async Task A_returned_loan_cannot_be_renewed()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loan.Id}/return", null)).StatusCode);
        var returned = await GetLoanAsync(loan.Id);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "loan_already_returned", returned);
    }

    [Fact]
    public async Task An_overdue_loan_cannot_be_renewed_but_one_due_today_can_until_the_utc_day_ends()
    {
        var (memberId, itemId) = await SeedAsync(stock: 2);
        var dueYesterday = await LendAsync(memberId, itemId, 0, 3);
        var dueToday = await LendAsync(memberId, itemId, 0, 4);

        // Last second of the UTC day on which dueToday is due.
        _api.Clock.Now = new DateTimeOffset(_day0.AddDays(4).ToDateTime(new TimeOnly(23, 59, 59)), TimeSpan.Zero);

        await AssertRefusedAsync(await RenewAsync(_staff, dueYesterday.Id, _day0.AddDays(8)), "loan_overdue", await GetLoanAsync(dueYesterday.Id));
        var renewed = await RenewAsync(_staff, dueToday.Id, _day0.AddDays(8));
        Assert.Equal(HttpStatusCode.OK, renewed.StatusCode);
        Assert.Equal(_day0.AddDays(8), (await renewed.ReadAsync<LoanDto>()).DueDate);
        Assert.Equal(_day0.AddDays(8), (await GetLoanAsync(dueToday.Id)).DueDate);
    }

    [Fact]
    public async Task A_suspended_borrower_cannot_renew()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await SuspendAsync(memberId);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "member_suspended", loan);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-5)]
    public async Task The_new_due_date_must_be_later_than_the_current_one(int shiftDays)
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, loan.DueDate.AddDays(shiftDays)), "renewal_not_later", loan);
    }

    [Fact]
    public async Task A_renewal_may_reach_28_days_after_the_start_date_but_not_further()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);

        // The limit counts from the loan's start date, not from today.
        _api.Clock.Now = _api.Clock.Now.AddDays(5);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, loan.StartDate.AddDays(29)), "loan_too_long", loan);
        var atLimit = await RenewAsync(_staff, loan.Id, loan.StartDate.AddDays(28));
        Assert.Equal(HttpStatusCode.OK, atLimit.StatusCode);
        Assert.Equal(loan.StartDate.AddDays(28), (await GetLoanAsync(loan.Id)).DueDate);
    }

    [Fact]
    public async Task The_added_days_need_a_free_copy_through_the_new_due_date()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 10, 4);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "item_unavailable", loan);
        var upToTheOtherLoan = await RenewAsync(_staff, loan.Id, _day0.AddDays(9));
        Assert.Equal(HttpStatusCode.OK, upToTheOtherLoan.StatusCode);
        Assert.Equal(_day0.AddDays(9), (await GetLoanAsync(loan.Id)).DueDate);
    }

    [Fact]
    public async Task The_added_days_start_the_day_after_the_current_due_date()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(8)), "item_unavailable", loan);
    }

    [Fact]
    public async Task Only_other_loans_overlapping_the_added_days_count_against_the_stock()
    {
        var (memberId, itemId) = await SeedAsync(stock: 2);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);

        // Days 8-9 have one other loan out and two copies: free, although three loans touch days 0-9.
        var response = await RenewAsync(_staff, loan.Id, _day0.AddDays(9));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(_day0.AddDays(9), (await GetLoanAsync(loan.Id)).DueDate);
    }

    [Fact]
    public async Task Other_loans_filling_every_copy_of_the_added_days_refuse_the_renewal()
    {
        var (memberId, itemId) = await SeedAsync(stock: 2);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(8)), "item_unavailable", loan);
    }

    [Fact]
    public async Task Returned_loans_do_not_hold_a_copy_for_the_added_days()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        var later = await LendAsync(await CreateMemberAsync(), itemId, 8, 4);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{later.Id}/return", null)).StatusCode);

        var response = await RenewAsync(_staff, loan.Id, _day0.AddDays(10));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(_day0.AddDays(10), (await GetLoanAsync(loan.Id)).DueDate);
    }

    [Fact]
    public async Task The_item_s_condition_and_retirement_do_not_matter()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        var item = await (await _staff.GetAsync($"/api/items/{itemId}")).ReadAsync<ItemDto>();
        var damage = await _staff.PutJsonAsync($"/api/items/{itemId}", new { name = item.Name, category = item.Category, sku = item.Sku, totalStock = item.TotalStock, condition = "Damaged" });
        Assert.Equal(HttpStatusCode.OK, damage.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/items/{itemId}")).StatusCode);

        var response = await RenewAsync(_staff, loan.Id, _day0.AddDays(12));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(_day0.AddDays(12), (await GetLoanAsync(loan.Id)).DueDate);
    }

    [Fact]
    public async Task Already_returned_is_reported_before_overdue_and_suspended()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 2);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loan.Id}/return", null)).StatusCode);
        await SuspendAsync(memberId);
        _api.Clock.Now = _api.Clock.Now.AddDays(5);
        var returned = await GetLoanAsync(loan.Id);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "loan_already_returned", returned);
    }

    [Fact]
    public async Task Overdue_is_reported_before_suspended()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 2);
        await SuspendAsync(memberId);
        _api.Clock.Now = _api.Clock.Now.AddDays(5);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "loan_overdue", await GetLoanAsync(loan.Id));
    }

    [Theory]
    [InlineData(7)]
    [InlineData(29)]
    public async Task Suspended_is_reported_before_the_due_date_rules(int newDueInDays)
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await SuspendAsync(memberId);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(newDueInDays)), "member_suspended", loan);
    }

    [Fact]
    public async Task Suspended_is_reported_before_unavailable()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);
        await SuspendAsync(memberId);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(10)), "member_suspended", loan);
    }

    [Fact]
    public async Task Too_long_is_reported_before_unavailable()
    {
        var (memberId, itemId) = await SeedAsync(stock: 1);
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await LendAsync(await CreateMemberAsync(), itemId, 8, 4);

        await AssertRefusedAsync(await RenewAsync(_staff, loan.Id, _day0.AddDays(29)), "loan_too_long", loan);
    }

    [Fact]
    public async Task A_renewal_sends_the_member_no_notice()
    {
        var (memberId, itemId) = await SeedAsync();
        var loan = await LendAsync(memberId, itemId, 0, 7);
        await ProcessOutboxAsync();
        Assert.Equal([NoticeKind.Confirmation], await NoticeKindsAsync(loan.Id));

        var response = await RenewAsync(_staff, loan.Id, _day0.AddDays(12));
        await ProcessOutboxAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal([NoticeKind.Confirmation], await NoticeKindsAsync(loan.Id));
        Assert.Equal(1, await _api.WithDbAsync(db => db.Notices.CountAsync()));
    }

    private static string NewSuffix() => Guid.NewGuid().ToString("N")[..10];

    private static void AssertSameError(Problem expected, Problem actual)
    {
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.Title, actual.Title);
        Assert.Equal(expected.Code, actual.Code);
        Assert.Equal(expected.Detail, actual.Detail);
    }

    private async Task AssertRefusedAsync(HttpResponseMessage response, string code, LoanDto before)
    {
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(code, problem.Code);
        Assert.Equal(409, problem.Status);
        Assert.Equal(await LendingRuleTitleAsync(), problem.Title);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
        Assert.Equal(before, await GetLoanAsync(before.Id));
    }

    /// <summary>The title an existing lending-rule refusal carries (a loan starting in the past).</summary>
    private async Task<string> LendingRuleTitleAsync()
    {
        var (memberId, itemId) = await SeedAsync();
        var response = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId, startDate = _api.Clock.Today.AddDays(-1), dueDate = _api.Clock.Today.AddDays(2) });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        return (await response.ReadAsync<Problem>()).Title;
    }

    private static Task<HttpResponseMessage> RenewAsync(HttpClient client, int loanId, DateOnly dueDate) =>
        client.PostJsonAsync($"/api/loans/{loanId}/renew", new { dueDate });

    private async Task<LoanDto> GetLoanAsync(int loanId)
    {
        var response = await _staff.GetAsync($"/api/loans/{loanId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<LoanDto>();
    }

    private async Task<LoanDto> LendAsync(int memberId, int itemId, int startInDays, int days)
    {
        var response = await _staff.PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = _day0.AddDays(startInDays),
            dueDate = _day0.AddDays(startInDays + days),
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<LoanDto>();
    }

    private async Task SuspendAsync(int memberId) =>
        Assert.Equal(HttpStatusCode.OK, (await _admin.PostAsync($"/api/members/{memberId}/suspend", null)).StatusCode);

    private async Task<(int MemberId, int ItemId)> SeedAsync(int stock = 1) => (await CreateMemberAsync(), await CreateItemAsync(stock));

    private async Task<int> CreateMemberAsync()
    {
        var suffix = NewSuffix();
        var response = await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"m-{suffix}@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<MemberDto>()).Id;
    }

    private async Task<int> CreateItemAsync(int stock)
    {
        var suffix = NewSuffix().ToUpperInvariant();
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"SKU-{suffix}", totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<ItemDto>()).Id;
    }

    private Task<int> ProcessOutboxAsync() =>
        _api.WithDbAsync(db => new OutboxProcessor(
                db,
                new NoticeSender(db, _api.Clock, NullLogger<NoticeSender>.Instance),
                _api.Clock,
                NullLogger<OutboxProcessor>.Instance)
            .ProcessPendingAsync(CancellationToken.None));

    private Task<List<NoticeKind>> NoticeKindsAsync(int loanId) =>
        _api.WithDbAsync(db => db.Notices.Where(n => n.LoanId == loanId).OrderBy(n => n.Id).Select(n => n.Kind).ToListAsync());
}
