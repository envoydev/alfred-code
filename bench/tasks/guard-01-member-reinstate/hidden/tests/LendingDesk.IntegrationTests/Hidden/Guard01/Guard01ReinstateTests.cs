using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Members;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Guard01;

[Collection(DatabaseGroup.Name)]
public sealed class Guard01ReinstateTests(PostgresFixture postgres) : IAsyncLifetime
{
    private Guard01Api _api = null!;

    public async Task InitializeAsync() => _api = await Guard01Api.StartAsync(postgres);

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private Task<HttpResponseMessage> ReinstateAsync(int memberId, string role = "admin") =>
        _api.ClientAs(role).PostAsync($"/api/members/{memberId}/reinstate", null);

    [Fact]
    public async Task Reinstating_a_suspended_member_makes_them_active_and_returns_the_member()
    {
        var member = await _api.CreateMemberAsync();
        await _api.SuspendAsync(member.Id);

        var response = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var reinstated = await response.ReadAsync<MemberDto>();
        Assert.Equal(member with { Status = MemberStatus.Active }, reinstated);
        Assert.Equal(MemberStatus.Active, (await _api.GetMemberAsync(member.Id)).Status);
    }

    [Fact]
    public async Task The_response_has_the_same_fields_as_the_suspend_response()
    {
        var member = await _api.CreateMemberAsync();
        var suspend = await _api.ClientAs("admin").PostAsync($"/api/members/{member.Id}/suspend", null);

        var reinstate = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.OK, reinstate.StatusCode);
        Assert.Equal(await Guard01Api.PropertyNamesAsync(suspend), await Guard01Api.PropertyNamesAsync(reinstate));
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("member")]
    public async Task Only_admins_can_reinstate(string role)
    {
        var member = await _api.CreateMemberAsync();
        await _api.SuspendAsync(member.Id);

        var refused = await ReinstateAsync(member.Id, role);

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("forbidden", (await refused.ReadAsync<Problem>()).Code);
        Assert.Equal(MemberStatus.Suspended, (await _api.GetMemberAsync(member.Id)).Status);
        Assert.Equal(HttpStatusCode.OK, (await ReinstateAsync(member.Id)).StatusCode);
    }

    [Fact]
    public async Task An_unknown_member_is_a_404_in_the_same_error_shape_as_the_other_endpoints()
    {
        var existing = await _api.ClientAs("admin").PostAsync("/api/members/999999/suspend", null);

        var response = await ReinstateAsync(999999);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(await Guard01Api.PropertyNamesAsync(existing), await Guard01Api.PropertyNamesAsync(response));
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(404, problem.Status);
        Assert.Equal("not_found", problem.Code);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
    }

    [Fact]
    public async Task A_member_who_is_not_suspended_is_a_409_member_not_suspended()
    {
        var member = await _api.CreateMemberAsync();

        var response = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(409, problem.Status);
        Assert.Equal("member_not_suspended", problem.Code);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
        Assert.Equal(MemberStatus.Active, (await _api.GetMemberAsync(member.Id)).Status);
    }

    [Fact]
    public async Task Not_suspended_is_checked_before_overdue_loans()
    {
        var member = await _api.CreateMemberAsync();
        var item = await _api.CreateItemAsync();
        await _api.LendAsync(member.Id, item.Id, dueInDays: 2);
        _api.Clock.Now = _api.Clock.Now.AddDays(3);

        var response = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("member_not_suspended", (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task An_overdue_loan_blocks_reinstating_until_it_is_returned()
    {
        var member = await _api.CreateMemberAsync();
        var item = await _api.CreateItemAsync();
        var loan = await _api.LendAsync(member.Id, item.Id, dueInDays: 2);
        _api.Clock.Now = _api.Clock.Now.AddDays(3);
        await _api.SuspendAsync(member.Id);

        var blocked = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        var problem = await blocked.ReadAsync<Problem>();
        Assert.Equal(409, problem.Status);
        Assert.Equal("member_has_overdue_loans", problem.Code);
        Assert.Equal(MemberStatus.Suspended, (await _api.GetMemberAsync(member.Id)).Status);

        await _api.ReturnAsync(loan.Id);
        var reinstated = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.OK, reinstated.StatusCode);
        Assert.Equal(MemberStatus.Active, (await reinstated.ReadAsync<MemberDto>()).Status);
    }

    [Fact]
    public async Task Loans_due_today_returned_late_or_belonging_to_someone_else_do_not_block()
    {
        var member = await _api.CreateMemberAsync();
        var other = await _api.CreateMemberAsync();
        var item = await _api.CreateItemAsync();
        await _api.LendAsync(member.Id, item.Id, dueInDays: 2);
        var returnedLate = await _api.LendAsync(member.Id, item.Id, dueInDays: 1);
        await _api.LendAsync(other.Id, item.Id, dueInDays: 1);
        _api.Clock.Now = _api.Clock.Now.AddDays(2);
        await _api.ReturnAsync(returnedLate.Id);
        await _api.SuspendAsync(member.Id);

        var response = await ReinstateAsync(member.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(MemberStatus.Active, (await _api.GetMemberAsync(member.Id)).Status);
    }
}
