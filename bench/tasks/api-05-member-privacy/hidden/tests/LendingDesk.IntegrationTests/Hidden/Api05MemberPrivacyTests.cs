using System.Globalization;
using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Api05;

/// <summary>
/// Hidden acceptance tests for api-05: a member-role caller sees only their own member record and loans, on every
/// route that returns either, and anything else looks exactly like an id nobody has.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Api05MemberPrivacyTests(PostgresFixture postgres) : IAsyncLifetime
{
    private const int NobodysId = 987654;

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private MemberDto _ada = null!;
    private MemberDto _grace = null!;
    private MemberDto _linus = null!;
    private readonly Dictionary<string, List<int>> _loans = [];

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _ada = await CreateMemberAsync("Ada Lovelace", "ada@example.com");
        _grace = await CreateMemberAsync("Grace Hopper", "grace@example.com");
        _linus = await CreateMemberAsync("Linus Torvalds", "linus@example.org");
        var drill = await CreateItemAsync("TL-501");
        var ladder = await CreateItemAsync("LD-502");
        var tripod = await CreateItemAsync("PH-503");

        await LendAsync("ada", drill, _ada.Id, dueInDays: 2);
        await LendAsync("ada", ladder, _ada.Id, dueInDays: 10);
        await LendAsync("grace", drill, _grace.Id, dueInDays: 2);
        await LendAsync("grace", tripod, _grace.Id, dueInDays: 10);
        await LendAsync("linus", ladder, _linus.Id, dueInDays: 3);
        Assert.Equal(HttpStatusCode.OK, (await _api.ClientAs("admin").PostAsync($"/api/members/{_linus.Id}/suspend", null)).StatusCode);

        // Four days on, the loans due in two and three days are overdue.
        _api.Clock.Now = _api.Clock.Now.AddDays(4);
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private HttpClient AsAda => _api.ClientAs("member", "ADA@Example.com");

    [Fact]
    public async Task A_member_lists_only_their_own_member_record()
    {
        var all = await GetPageAsync<MemberDto>(AsAda, "/api/members");
        var active = await GetPageAsync<MemberDto>(AsAda, "/api/members?status=Active");
        var suspended = await GetPageAsync<MemberDto>(AsAda, "/api/members?status=Suspended");
        var linusSuspended = await GetPageAsync<MemberDto>(_api.ClientAs("member", "linus@example.org"), "/api/members?status=Suspended");

        AssertPage(all, [_ada.Id], 1);
        AssertPage(active, [_ada.Id], 1);
        AssertPage(suspended, [], 0);
        AssertPage(linusSuspended, [_linus.Id], 1);
    }

    [Fact]
    public async Task A_member_reads_their_own_record_and_any_other_looks_like_an_id_nobody_has()
    {
        var own = await AsAda.GetAsync($"/api/members/{_ada.Id}");

        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(_ada, await own.ReadAsync<MemberDto>());
        await AssertLooksUnknownAsync(AsAda, "/api/members/{0}", _grace.Id);
        await AssertLooksUnknownAsync(AsAda, "/api/members/{0}", _linus.Id);
    }

    [Fact]
    public async Task A_member_lists_only_their_own_loans_with_filters_and_paging()
    {
        var all = await GetPageAsync<LoanDto>(AsAda, "/api/loans");
        var overdue = await GetPageAsync<LoanDto>(AsAda, "/api/loans?status=Overdue");
        var second = await GetPageAsync<LoanDto>(AsAda, "/api/loans?page=2&pageSize=1");
        var own = await GetPageAsync<LoanDto>(AsAda, $"/api/loans?memberId={_ada.Id}");
        var someoneElses = await GetPageAsync<LoanDto>(AsAda, $"/api/loans?memberId={_grace.Id}");

        AssertPage(all, _loans["ada"], 2);
        Assert.All(all.Items, l => Assert.Equal("Ada Lovelace", l.MemberName));
        AssertPage(overdue, [_loans["ada"][0]], 1);
        AssertPage(second, [_loans["ada"][1]], 2);
        AssertPage(own, _loans["ada"], 2);
        AssertPage(someoneElses, [], 0);
    }

    [Fact]
    public async Task A_member_reads_their_own_loan_and_any_other_looks_like_an_id_nobody_has()
    {
        var own = await AsAda.GetAsync($"/api/loans/{_loans["ada"][1]}");

        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(_ada.Id, (await own.ReadAsync<LoanDto>()).MemberId);
        await AssertLooksUnknownAsync(AsAda, "/api/loans/{0}", _loans["grace"][0]);
        await AssertLooksUnknownAsync(AsAda, "/api/loans/{0}", _loans["linus"][0]);
    }

    [Fact]
    public async Task A_member_lists_their_own_loans_by_member_and_anyone_elses_looks_like_a_member_nobody_is()
    {
        var own = await AsAda.GetAsync($"/api/members/{_ada.Id}/loans");

        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(_loans["ada"].Order(), Ids(await own.ReadAsync<List<LoanDto>>()).Order());
        await AssertLooksUnknownAsync(AsAda, "/api/members/{0}/loans", _grace.Id);
    }

    [Fact]
    public async Task A_member_whose_email_matches_no_member_sees_nothing()
    {
        var stranger = _api.ClientAs("member", "stranger@example.com");

        var members = await GetPageAsync<MemberDto>(stranger, "/api/members");
        var loans = await GetPageAsync<LoanDto>(stranger, "/api/loans");

        AssertPage(members, [], 0);
        AssertPage(loans, [], 0);
        await AssertLooksUnknownAsync(stranger, "/api/members/{0}", _ada.Id);
        await AssertLooksUnknownAsync(stranger, "/api/members/{0}/loans", _ada.Id);
        await AssertLooksUnknownAsync(stranger, "/api/loans/{0}", _loans["ada"][0]);
    }

    [Fact]
    public async Task Staff_and_admins_still_see_everything()
    {
        var admin = _api.ClientAs("admin");

        var loans = await GetPageAsync<LoanDto>(_staff, "/api/loans");
        var members = await GetPageAsync<MemberDto>(admin, "/api/members");
        var graceLoans = await _staff.GetAsync($"/api/members/{_grace.Id}/loans");

        Assert.Equal(5, loans.TotalCount);
        Assert.Equal(3, members.TotalCount);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/members/{_grace.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _staff.GetAsync($"/api/loans/{_loans["grace"][0]}")).StatusCode);
        Assert.Equal(_loans["grace"].Order(), Ids(await graceLoans.ReadAsync<List<LoanDto>>()).Order());
    }

    [Fact]
    public async Task Invalid_requests_and_member_refusals_are_unchanged()
    {
        var badFilter = await AsAda.GetAsync("/api/loans?memberId=0");
        var badPage = await AsAda.GetAsync("/api/members?pageSize=500");

        Assert.Equal(HttpStatusCode.BadRequest, badFilter.StatusCode);
        Assert.Equal("validation_failed", (await badFilter.ReadAsync<Problem>()).Code);
        Assert.Equal(HttpStatusCode.BadRequest, badPage.StatusCode);
        Assert.Equal("validation_failed", (await badPage.ReadAsync<Problem>()).Code);
        await AssertForbiddenAsync(await AsAda.PostJsonAsync("/api/loans", LoanBody(1, _ada.Id, dueInDays: 3)));
        await AssertForbiddenAsync(await AsAda.PostAsync($"/api/loans/{_loans["ada"][1]}/return", null));
        await AssertForbiddenAsync(await AsAda.PutJsonAsync($"/api/members/{_ada.Id}", new { name = "Ada", email = "ada@example.com" }));
        await AssertForbiddenAsync(await AsAda.GetAsync("/api/reports/overdue"));
    }

    private static void AssertPage(PagedResult<MemberDto> page, List<int> ids, int totalCount)
    {
        Assert.Equal(ids, Ids(page.Items));
        Assert.Equal(totalCount, page.TotalCount);
    }

    private static void AssertPage(PagedResult<LoanDto> page, List<int> ids, int totalCount)
    {
        Assert.Equal(ids, Ids(page.Items));
        Assert.Equal(totalCount, page.TotalCount);
    }

    private static List<int> Ids(IEnumerable<MemberDto> members) => members.Select(m => m.Id).ToList();

    private static List<int> Ids(IEnumerable<LoanDto> loans) => loans.Select(l => l.Id).ToList();

    private static async Task<PagedResult<T>> GetPageAsync<T>(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"GET {url} answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.ReadAsync<PagedResult<T>>();
    }

    /// <summary>The route answers for <paramref name="id"/> exactly as it answers for an id nobody has.</summary>
    private static async Task AssertLooksUnknownAsync(HttpClient client, string route, int id)
    {
        var url = string.Format(CultureInfo.InvariantCulture, route, id);
        var response = await client.GetAsync(url);
        var unknown = await client.GetAsync(string.Format(CultureInfo.InvariantCulture, route, NobodysId));

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"GET {url} answered {(int)response.StatusCode}, an unknown id answers 404");
        var expected = await unknown.ReadAsync<Problem>();
        var actual = await response.ReadAsync<Problem>();
        Assert.Equal(
            (expected.Status, expected.Title, expected.Code, expected.Detail?.Replace(NobodysId.ToString(CultureInfo.InvariantCulture), id.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)),
            (actual.Status, actual.Title, actual.Code, actual.Detail));
    }

    private static async Task AssertForbiddenAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("forbidden", (await response.ReadAsync<Problem>()).Code);
    }

    private async Task<MemberDto> CreateMemberAsync(string name, string email)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name, email });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    private async Task<int> CreateItemAsync(string sku)
    {
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Item {sku}", category = "Tools", sku, totalStock = 5 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<ItemDto>()).Id;
    }

    private async Task LendAsync(string who, int itemId, int memberId, int dueInDays)
    {
        var response = await _staff.PostJsonAsync("/api/loans", LoanBody(itemId, memberId, dueInDays));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        if (!_loans.TryGetValue(who, out var ids))
        {
            ids = [];
            _loans[who] = ids;
        }

        ids.Add((await response.ReadAsync<LoanDto>()).Id);
    }

    private object LoanBody(int itemId, int memberId, int dueInDays) => new
    {
        itemId,
        memberId,
        startDate = _api.Clock.Today,
        dueDate = _api.Clock.Today.AddDays(dueInDays),
    };
}
