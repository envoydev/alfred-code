using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Members;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests;

[Collection(DatabaseGroup.Name)]
public sealed class MembersApiTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;

    public async Task InitializeAsync() => _api = await LendingApiFactory.StartAsync(postgres);

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private async Task<MemberDto> CreateMemberAsync(string name, string email)
    {
        var response = await _api.ClientAs("staff").PostJsonAsync("/api/members", new { name, email });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    [Fact]
    public async Task Staff_create_a_member_and_read_it_back()
    {
        var created = await CreateMemberAsync("  Ada Lovelace ", "Ada@Example.com");

        Assert.Equal("Ada Lovelace", created.Name);
        Assert.Equal("ada@example.com", created.Email);
        Assert.Equal(MemberStatus.Active, created.Status);
        var fetched = await (await _api.ClientAs("member").GetAsync($"/api/members/{created.Id}")).ReadAsync<MemberDto>();
        Assert.Equal(created, fetched);
    }

    [Fact]
    public async Task A_request_without_the_demo_headers_is_unauthenticated()
    {
        var response = await _api.CreateClient().GetAsync("/api/members");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("unauthenticated", (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task Members_cannot_create_members()
    {
        var response = await _api.ClientAs("member").PostJsonAsync("/api/members", new { name = "Eve", email = "eve@example.com" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("forbidden", (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task An_invalid_request_returns_the_validation_envelope()
    {
        var response = await _api.ClientAs("staff").PostJsonAsync("/api/members", new { name = "", email = "not-an-email" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal("validation_failed", problem.Code);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
        Assert.Contains("Email", problem.Errors!.Keys);
        Assert.Contains("Name", problem.Errors.Keys);
    }

    [Fact]
    public async Task A_duplicate_email_is_a_conflict()
    {
        await CreateMemberAsync("Grace Hopper", "grace@example.com");

        var response = await _api.ClientAs("staff").PostJsonAsync("/api/members", new { name = "Grace H.", email = "GRACE@example.com" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("duplicate", (await response.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task An_unknown_member_is_not_found()
    {
        var response = await _api.ClientAs("staff").GetAsync("/api/members/999999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal("not_found", problem.Code);
        Assert.Equal("Member 999999 was not found.", problem.Detail);
    }

    [Fact]
    public async Task Only_admins_suspend_and_the_list_filters_by_status()
    {
        var member = await CreateMemberAsync("Katherine Johnson", "katherine@example.com");
        await CreateMemberAsync("Dorothy Vaughan", "dorothy@example.com");

        Assert.Equal(HttpStatusCode.Forbidden, (await _api.ClientAs("staff").PostAsync($"/api/members/{member.Id}/suspend", null)).StatusCode);
        var suspended = await (await _api.ClientAs("admin").PostAsync($"/api/members/{member.Id}/suspend", null)).ReadAsync<MemberDto>();
        Assert.Equal(MemberStatus.Suspended, suspended.Status);

        var page = await (await _api.ClientAs("staff").GetAsync("/api/members?status=Suspended")).ReadAsync<PagedResult<MemberDto>>();
        Assert.Equal([member.Id], page.Items.Select(m => m.Id));
        Assert.Equal(1, page.TotalCount);
    }

    [Fact]
    public async Task The_list_is_paged_in_name_order()
    {
        foreach (var name in new[] { "Carol", "Alice", "Bob" })
        {
            await CreateMemberAsync(name, $"{name.ToUpperInvariant()}@paging.example.com");
        }

        var page = await (await _api.ClientAs("staff").GetAsync("/api/members?page=2&pageSize=2")).ReadAsync<PagedResult<MemberDto>>();

        Assert.Equal(3, page.TotalCount);
        Assert.Equal(["Carol"], page.Items.Select(m => m.Name));
    }
}
