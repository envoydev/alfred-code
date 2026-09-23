using System.Net;
using System.Text.Json;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.HomeB1;

/// <summary>
/// The clock starts on 2026-03-10. On this branch a loan that is not returned is overdue only once it is
/// more than two days past its due date (decision 0001): due on the 13th, it is overdue from the 16th.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class HomeB1OverdueMembersTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private HttpClient _admin = null!;
    private int _itemId;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _admin = _api.ClientAs("admin");
        var item = await _staff.PostJsonAsync("/api/items", new { name = "Projector", category = "AV", sku = "PRJ-OVERDUE", totalStock = 50 });
        Assert.Equal(HttpStatusCode.Created, item.StatusCode);
        _itemId = (await JsonAsync(item)).GetProperty("id").GetInt32();
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static int Id(JsonElement member) => member.GetProperty("id").GetInt32();

    private static int OverdueLoans(JsonElement member)
    {
        Assert.True(member.TryGetProperty("overdueLoans", out var count), $"No overdueLoans in: {member}");
        return count.GetInt32();
    }

    private void SetToday(int month, int day) => _api.Clock.Now = new DateTimeOffset(2026, month, day, 9, 0, 0, TimeSpan.Zero);

    private async Task<JsonElement> CreateMemberAsync(string name)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name, email = $"{name.ToUpperInvariant()}@overdue.example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await JsonAsync(response);
    }

    /// <summary>Lends the shared item from today until <paramref name="dueDay"/> of March.</summary>
    private async Task<int> LendAsync(int memberId, int dueDay)
    {
        var response = await _staff.PostJsonAsync("/api/loans", new
        {
            itemId = _itemId,
            memberId,
            startDate = _api.Clock.Today,
            dueDate = new DateOnly(2026, 3, dueDay),
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("id").GetInt32();
    }

    private async Task<JsonElement> GetMemberAsync(int id)
    {
        var response = await _staff.GetAsync($"/api/members/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await JsonAsync(response);
    }

    private async Task<JsonElement> ListAsync(string query)
    {
        var response = await _staff.GetAsync($"/api/members?{query}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await JsonAsync(response);
    }

    private static List<int> Ids(JsonElement page) => page.GetProperty("items").EnumerateArray().Select(Id).ToList();

    private static int TotalCount(JsonElement page) => page.GetProperty("totalCount").GetInt32();

    [Fact]
    public async Task Every_response_that_carries_a_member_has_its_overdue_loan_count()
    {
        var created = await CreateMemberAsync("Ada");
        var ada = Id(created);
        Assert.Equal(0, OverdueLoans(created));
        await LendAsync(ada, dueDay: 13);
        await LendAsync(ada, dueDay: 13);
        await LendAsync(ada, dueDay: 30);
        SetToday(3, 16);

        var single = await GetMemberAsync(ada);
        var listed = (await ListAsync("pageSize=100")).GetProperty("items").EnumerateArray().Single(m => Id(m) == ada);
        var updated = await _staff.PutJsonAsync($"/api/members/{ada}", new { name = "Ada King", email = "ada.king@overdue.example.com" });
        var suspended = await _admin.PostAsync($"/api/members/{ada}/suspend", null);
        var newcomer = await CreateMemberAsync("Newcomer");

        Assert.Equal(2, OverdueLoans(single));
        Assert.Equal(2, OverdueLoans(listed));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(2, OverdueLoans(await JsonAsync(updated)));
        Assert.Equal(HttpStatusCode.OK, suspended.StatusCode);
        Assert.Equal(2, OverdueLoans(await JsonAsync(suspended)));
        Assert.Equal(0, OverdueLoans(newcomer));
    }

    [Fact]
    public async Task A_loan_counts_as_overdue_only_after_the_grace_period_and_only_while_it_is_not_returned()
    {
        var inGrace = Id(await CreateMemberAsync("Grace"));
        var returnedLate = Id(await CreateMemberAsync("Rita"));
        var dueToday = Id(await CreateMemberAsync("Toby"));
        await LendAsync(inGrace, dueDay: 14);
        var lateLoan = await LendAsync(returnedLate, dueDay: 11);
        SetToday(3, 15);
        Assert.Equal(1, OverdueLoans(await GetMemberAsync(returnedLate)));
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{lateLoan}/return", null)).StatusCode);
        SetToday(3, 16);
        await LendAsync(dueToday, dueDay: 16);

        Assert.Equal(0, OverdueLoans(await GetMemberAsync(inGrace)));
        Assert.Equal(0, OverdueLoans(await GetMemberAsync(returnedLate)));
        Assert.Equal(0, OverdueLoans(await GetMemberAsync(dueToday)));
        Assert.Empty(Ids(await ListAsync("overdueOnly=true")));

        SetToday(3, 17);

        Assert.Equal(1, OverdueLoans(await GetMemberAsync(inGrace)));
        Assert.Equal([inGrace], Ids(await ListAsync("overdueOnly=true")));
        Assert.Equal(1, TotalCount(await ListAsync("overdueOnly=true")));
    }

    [Fact]
    public async Task OverdueOnly_lists_members_with_an_overdue_loan_and_combines_with_the_status_filter_and_paging()
    {
        var alba = Id(await CreateMemberAsync("Alba"));
        var bram = Id(await CreateMemberAsync("Bram"));
        var cleo = Id(await CreateMemberAsync("Cleo"));
        var dina = Id(await CreateMemberAsync("Dina"));
        var egon = Id(await CreateMemberAsync("Egon"));
        await LendAsync(alba, dueDay: 11);
        await LendAsync(bram, dueDay: 30);
        await LendAsync(cleo, dueDay: 11);
        await LendAsync(egon, dueDay: 11);
        await LendAsync(egon, dueDay: 12);
        Assert.Equal(HttpStatusCode.OK, (await _admin.PostAsync($"/api/members/{cleo}/suspend", null)).StatusCode);
        SetToday(3, 20);

        var overdue = await ListAsync("overdueOnly=true");
        var notFiltered = await ListAsync("overdueOnly=false");
        var today = await ListAsync(string.Empty);
        var suspended = await ListAsync("overdueOnly=true&status=Suspended");
        var active = await ListAsync("status=Active&overdueOnly=true");
        var secondPage = await ListAsync("overdueOnly=true&page=2&pageSize=2");

        Assert.Equal([alba, cleo, egon], Ids(overdue));
        Assert.Equal(3, TotalCount(overdue));
        Assert.Equal([alba, bram, cleo, dina, egon], Ids(today));
        Assert.Equal(5, TotalCount(today));
        Assert.Equal(Ids(today), Ids(notFiltered));
        Assert.Equal(TotalCount(today), TotalCount(notFiltered));
        Assert.Equal([cleo], Ids(suspended));
        Assert.Equal(1, TotalCount(suspended));
        Assert.Equal([alba, egon], Ids(active));
        Assert.Equal(2, TotalCount(active));
        Assert.Equal([egon], Ids(secondPage));
        Assert.Equal(3, TotalCount(secondPage));
        Assert.Equal(2, secondPage.GetProperty("page").GetInt32());
        Assert.Equal(2, secondPage.GetProperty("pageSize").GetInt32());

        var counts = today.GetProperty("items").EnumerateArray().ToDictionary(Id, OverdueLoans);
        Assert.Equal(1, counts[alba]);
        Assert.Equal(0, counts[bram]);
        Assert.Equal(1, counts[cleo]);
        Assert.Equal(0, counts[dina]);
        Assert.Equal(2, counts[egon]);
    }
}
