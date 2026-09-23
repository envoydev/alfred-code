using System.Net;
using System.Text.RegularExpressions;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.Extensions.Logging;

namespace LendingDesk.IntegrationTests.Hidden.Guard01;

[Collection(DatabaseGroup.Name)]
public sealed partial class Guard01AuditLogTests(PostgresFixture postgres) : IAsyncLifetime
{
    private Guard01Api _api = null!;

    public async Task InitializeAsync() => _api = await Guard01Api.StartAsync(postgres);

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [GeneratedRegex(@"^(Member|Item) \d+ (suspended|reinstated|retired) by ")]
    private static partial Regex AuditShape();

    private int InformationEntries(string message) =>
        _api.Logs.Entries.Count(e => e.Level == LogLevel.Information && e.Message == message);

    private int AuditLikeEntries() => _api.Logs.Entries.Count(e => AuditShape().IsMatch(e.Message));

    [Fact]
    public async Task Suspending_a_member_writes_one_information_entry_naming_the_member_and_the_user()
    {
        var member = await _api.CreateMemberAsync();

        var response = await _api.ClientAs("admin", "alice").PostAsync($"/api/members/{member.Id}/suspend", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, InformationEntries($"Member {member.Id} suspended by alice"));
    }

    [Fact]
    public async Task Reinstating_a_member_writes_one_information_entry_naming_the_member_and_the_user()
    {
        var member = await _api.CreateMemberAsync();
        await _api.SuspendAsync(member.Id);

        var response = await _api.ClientAs("admin", "bob.admin").PostAsync($"/api/members/{member.Id}/reinstate", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, InformationEntries($"Member {member.Id} reinstated by bob.admin"));
    }

    [Fact]
    public async Task Retiring_an_item_writes_one_information_entry_naming_the_item_and_the_user()
    {
        var item = await _api.CreateItemAsync();

        var response = await _api.ClientAs("admin", "carol").DeleteAsync($"/api/items/{item.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(1, InformationEntries($"Item {item.Id} retired by carol"));
    }

    [Fact]
    public async Task Rejected_suspends_write_no_audit_entry()
    {
        var member = await _api.CreateMemberAsync();
        var admin = _api.ClientAs("admin", "alice");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/members/{member.Id}/suspend", null)).StatusCode);
        Assert.Equal(1, InformationEntries($"Member {member.Id} suspended by alice"));
        var before = AuditLikeEntries();

        var unknown = await admin.PostAsync("/api/members/999999/suspend", null);
        var again = await admin.PostAsync($"/api/members/{member.Id}/suspend", null);

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal(before, AuditLikeEntries());
    }

    [Fact]
    public async Task Rejected_reinstates_write_no_audit_entry()
    {
        var active = await _api.CreateMemberAsync();
        var overdue = await _api.CreateMemberAsync();
        var item = await _api.CreateItemAsync();
        await _api.LendAsync(overdue.Id, item.Id, dueInDays: 1);
        _api.Clock.Now = _api.Clock.Now.AddDays(2);
        await _api.SuspendAsync(overdue.Id);
        var admin = _api.ClientAs("admin", "alice");
        var before = AuditLikeEntries();

        var unknown = await admin.PostAsync("/api/members/999999/reinstate", null);
        var notSuspended = await admin.PostAsync($"/api/members/{active.Id}/reinstate", null);
        var blocked = await admin.PostAsync($"/api/members/{overdue.Id}/reinstate", null);

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("member_not_suspended", (await notSuspended.ReadAsync<Problem>()).Code);
        Assert.Equal("member_has_overdue_loans", (await blocked.ReadAsync<Problem>()).Code);
        Assert.Equal(before, AuditLikeEntries());
    }

    [Fact]
    public async Task Rejected_retires_write_no_audit_entry()
    {
        var item = await _api.CreateItemAsync();
        var admin = _api.ClientAs("admin", "alice");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/items/{item.Id}")).StatusCode);
        Assert.Equal(1, InformationEntries($"Item {item.Id} retired by alice"));
        var before = AuditLikeEntries();

        var unknown = await admin.DeleteAsync("/api/items/999999");
        var again = await admin.DeleteAsync($"/api/items/{item.Id}");

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal(before, AuditLikeEntries());
    }
}
