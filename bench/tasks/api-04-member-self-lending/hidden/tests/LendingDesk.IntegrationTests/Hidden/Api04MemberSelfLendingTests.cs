using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Loans;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.Api04;

/// <summary>Hidden acceptance tests for api-04: members create loans for themselves through POST /api/loans.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Api04MemberSelfLendingTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private MemberDto _ada = null!;
    private MemberDto _bob = null!;
    private HttpClient _asAda = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _ada = await CreateMemberAsync("Ada Self", "ada.self@example.com");
        _bob = await CreateMemberAsync("Bob Other", "bob.other@example.com");
        _asAda = _api.ClientAs("member", "ada.self@example.com");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task A_member_borrows_for_themselves_and_gets_the_response_staff_would_get()
    {
        var itemId = await CreateItemAsync();
        var staffItemId = await CreateItemAsync();

        var response = await _asAda.PostJsonAsync("/api/loans", LoanBody(itemId, _ada.Id));
        var byStaff = await _staff.PostJsonAsync("/api/loans", LoanBody(staffItemId, _ada.Id));

        Assert.Equal(HttpStatusCode.Created, byStaff.StatusCode);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var loan = await response.ReadAsync<LoanDto>();
        var staffLoan = await byStaff.ReadAsync<LoanDto>();
        Assert.Equal(staffLoan with { Id = loan.Id, ItemId = itemId, ItemName = loan.ItemName }, loan);
        Assert.Equal(_ada.Id, loan.MemberId);
        Assert.Equal(itemId, loan.ItemId);
        Assert.Equal(LoanState.Active, loan.Status);
        Assert.Equal(loan, await (await _staff.GetAsync($"/api/loans/{loan.Id}")).ReadAsync<LoanDto>());
        Assert.Equal(1, await _api.WithDbAsync(db => db.Loans.CountAsync(l => l.ItemId == itemId && l.MemberId == _ada.Id)));

        // Staff and admins still lend to any member.
        var byAdmin = await _api.ClientAs("admin").PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), _bob.Id));
        Assert.Equal(HttpStatusCode.Created, byAdmin.StatusCode);
    }

    [Theory]
    [InlineData("ada.self@example.com")]
    [InlineData("ADA.SELF@EXAMPLE.COM")]
    [InlineData("Ada.Self@Example.Com")]
    public async Task The_caller_is_matched_to_the_member_by_email_ignoring_case(string user)
    {
        var itemId = await CreateItemAsync();

        var response = await _api.ClientAs("member", user).PostJsonAsync("/api/loans", LoanBody(itemId, _ada.Id));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(_ada.Id, (await response.ReadAsync<LoanDto>()).MemberId);
    }

    [Fact]
    public async Task A_member_naming_another_member_gets_the_role_403_and_nothing_is_saved()
    {
        await AssertAdaCanBorrowAsync();
        var before = await CountsAsync();

        var response = await _asAda.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), _bob.Id));

        await AssertRoleForbiddenAsync(response);
        Assert.Equal(before, await CountsAsync());
        Assert.Equal(0, await _api.WithDbAsync(db => db.Loans.CountAsync(l => l.MemberId == _bob.Id)));
    }

    [Fact]
    public async Task A_member_naming_a_member_id_that_does_not_exist_gets_403_not_404()
    {
        await AssertAdaCanBorrowAsync();
        var before = await CountsAsync();

        var response = await _asAda.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), 999_999));

        await AssertRoleForbiddenAsync(response);
        Assert.Equal(before, await CountsAsync());
    }

    [Fact]
    public async Task A_member_whose_email_matches_no_member_gets_403_for_any_member_id()
    {
        await AssertAdaCanBorrowAsync();
        var stranger = _api.ClientAs("member", "nobody.here@example.com");
        var itemId = await CreateItemAsync();
        var before = await CountsAsync();

        await AssertRoleForbiddenAsync(await stranger.PostJsonAsync("/api/loans", LoanBody(itemId, _ada.Id)));
        await AssertRoleForbiddenAsync(await stranger.PostJsonAsync("/api/loans", LoanBody(itemId, _bob.Id)));
        await AssertRoleForbiddenAsync(await stranger.PostJsonAsync("/api/loans", LoanBody(itemId, 999_999)));
        Assert.Equal(before, await CountsAsync());
    }

    [Fact]
    public async Task The_403_for_another_member_comes_before_the_item_lookup_and_the_lending_rules()
    {
        await AssertAdaCanBorrowAsync();
        var itemId = await CreateItemAsync(stock: 1);
        Assert.Equal(HttpStatusCode.Created, (await _staff.PostJsonAsync("/api/loans", LoanBody(itemId, _ada.Id))).StatusCode);
        await SuspendAsync(_bob.Id);
        var today = _api.Clock.Today;
        var before = await CountsAsync();

        // Unknown item.
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", LoanBody(999_999, _bob.Id)));
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", LoanBody(999_999, 999_999)));

        // Suspended borrower, the only copy already out, a start in the past, a loan that is too long.
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), _bob.Id)));
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", LoanBody(itemId, _bob.Id)));
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", new { itemId, memberId = _bob.Id, startDate = today.AddDays(-1), dueDate = today.AddDays(2) }));
        await AssertRoleForbiddenAsync(await _asAda.PostJsonAsync("/api/loans", new { itemId, memberId = _bob.Id, startDate = today, dueDate = today.AddDays(29) }));

        Assert.Equal(before, await CountsAsync());
    }

    [Fact]
    public async Task A_body_that_fails_validation_gets_the_usual_400_whoever_sends_it()
    {
        var itemId = await CreateItemAsync();
        var today = _api.Clock.Today;
        var reference = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId = _ada.Id, startDate = today });
        Assert.Equal(HttpStatusCode.BadRequest, reference.StatusCode);
        var expected = await reference.ReadAsync<Problem>();
        var before = await CountsAsync();

        await AssertValidationErrorAsync(expected, await _asAda.PostJsonAsync("/api/loans", new { itemId, memberId = _ada.Id, startDate = today }), "DueDate");
        await AssertValidationErrorAsync(expected, await _asAda.PostJsonAsync("/api/loans", new { itemId, memberId = _bob.Id, startDate = today }), "DueDate");
        await AssertValidationErrorAsync(expected, await _asAda.PostJsonAsync("/api/loans", new { itemId, memberId = _bob.Id, dueDate = today.AddDays(3) }), "StartDate");
        await AssertValidationErrorAsync(
            expected,
            await _api.ClientAs("member", "nobody.here@example.com").PostJsonAsync("/api/loans", new { itemId, memberId = _ada.Id, startDate = today }),
            "DueDate");
        Assert.Equal(before, await CountsAsync());
    }

    [Fact]
    public async Task A_member_borrowing_for_themselves_gets_the_same_404_as_staff_for_an_unknown_item()
    {
        await AssertSameAsStaffAsync(LoanBody(999_999, _ada.Id), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_suspended_member_borrowing_for_themselves_gets_member_suspended()
    {
        await SuspendAsync(_ada.Id);

        var problem = await AssertSameAsStaffAsync(LoanBody(await CreateItemAsync(), _ada.Id), HttpStatusCode.Conflict);

        Assert.Equal("member_suspended", problem.Code);
    }

    [Fact]
    public async Task A_member_borrowing_for_themselves_gets_the_same_lending_rule_conflicts_as_staff()
    {
        var today = _api.Clock.Today;
        var busyItemId = await CreateItemAsync(stock: 1);
        Assert.Equal(HttpStatusCode.Created, (await _staff.PostJsonAsync("/api/loans", LoanBody(busyItemId, _bob.Id))).StatusCode);
        var itemId = await CreateItemAsync();

        Assert.Equal("item_unavailable", (await AssertSameAsStaffAsync(LoanBody(busyItemId, _ada.Id), HttpStatusCode.Conflict)).Code);
        Assert.Equal("start_in_past", (await AssertSameAsStaffAsync(new { itemId, memberId = _ada.Id, startDate = today.AddDays(-1), dueDate = today.AddDays(2) }, HttpStatusCode.Conflict)).Code);
        Assert.Equal("loan_too_long", (await AssertSameAsStaffAsync(new { itemId, memberId = _ada.Id, startDate = today, dueDate = today.AddDays(29) }, HttpStatusCode.Conflict)).Code);
        Assert.Equal("due_before_start", (await AssertSameAsStaffAsync(new { itemId, memberId = _ada.Id, startDate = today.AddDays(3), dueDate = today.AddDays(2) }, HttpStatusCode.Conflict)).Code);
    }

    [Fact]
    public async Task Returning_a_loan_is_still_for_staff_and_admins_only()
    {
        var loan = await AssertAdaCanBorrowAsync();

        var response = await _asAda.PostAsync($"/api/loans/{loan.Id}/return", null);

        await AssertRoleForbiddenAsync(response);
        var after = await (await _staff.GetAsync($"/api/loans/{loan.Id}")).ReadAsync<LoanDto>();
        Assert.Null(after.ReturnedAt);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loan.Id}/return", null)).StatusCode);
    }

    private object LoanBody(int itemId, int memberId) => new
    {
        itemId,
        memberId,
        startDate = _api.Clock.Today,
        dueDate = _api.Clock.Today.AddDays(7),
    };

    /// <summary>Control: the feature works for Ada, so a 403 below comes from the ownership rule, not a blanket ban.</summary>
    private async Task<LoanDto> AssertAdaCanBorrowAsync()
    {
        var response = await _asAda.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), _ada.Id));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<LoanDto>();
    }

    /// <summary>The body the API already returns when a role may not do something (a member creating a member).</summary>
    private async Task AssertRoleForbiddenAsync(HttpResponseMessage response)
    {
        var reference = await _asAda.PostJsonAsync("/api/members", new { name = "Not Allowed", email = "not.allowed@example.com" });
        Assert.Equal(HttpStatusCode.Forbidden, reference.StatusCode);
        var expected = await reference.ReadAsync<Problem>();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Status, problem.Status);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(expected.Code, problem.Code);
        Assert.Equal(expected.Detail, problem.Detail);
    }

    private static async Task AssertValidationErrorAsync(Problem expected, HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(expected.Code, problem.Code);
        Assert.NotNull(problem.Errors);
        Assert.Contains(field, problem.Errors.Keys);
    }

    /// <summary>Sends the same body as Ada (for herself) and as staff; both are refused alike and nothing is saved.</summary>
    private async Task<Problem> AssertSameAsStaffAsync(object body, HttpStatusCode status)
    {
        var before = await CountsAsync();

        var asMember = await _asAda.PostJsonAsync("/api/loans", body);
        var asStaff = await _staff.PostJsonAsync("/api/loans", body);

        Assert.Equal(status, asStaff.StatusCode);
        Assert.Equal(status, asMember.StatusCode);
        var expected = await asStaff.ReadAsync<Problem>();
        var problem = await asMember.ReadAsync<Problem>();
        Assert.Equal(expected.Status, problem.Status);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(expected.Code, problem.Code);
        Assert.Equal(expected.Detail, problem.Detail);
        Assert.Equal(before, await CountsAsync());
        return problem;
    }

    private Task<(int Loans, int Outbox)> CountsAsync() =>
        _api.WithDbAsync(async db => (await db.Loans.CountAsync(), await db.OutboxMessages.CountAsync()));

    private async Task SuspendAsync(int memberId) =>
        Assert.Equal(HttpStatusCode.OK, (await _api.ClientAs("admin").PostAsync($"/api/members/{memberId}/suspend", null)).StatusCode);

    private async Task<MemberDto> CreateMemberAsync(string name, string email)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name, email });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    private async Task<int> CreateItemAsync(int stock = 2)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Kiosk item {suffix}", category = "Tools", sku = $"KSK-{suffix}", totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<ItemDto>()).Id;
    }
}
