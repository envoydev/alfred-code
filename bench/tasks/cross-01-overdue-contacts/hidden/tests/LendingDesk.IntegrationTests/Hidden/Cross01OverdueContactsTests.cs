using System.Net;
using System.Text.Json;

using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Cross01;

/// <summary>
/// Hidden acceptance tests for cross-01: GET /api/reports/overdue carries the item and the member as small
/// objects. Everything is read as raw JSON so any correct DTO shape compiles.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class OverdueReportContactsTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _api.Clock.Now = new DateTimeOffset(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task Each_row_carries_the_item_and_the_member_as_small_objects()
    {
        var member = await PostAsync("/api/members", new { name = "Ada Lovelace", email = "Ada.Lovelace@Example.com" });
        var item = await PostAsync("/api/items", new { name = "Ladder", category = "Tools", sku = "LD-001", totalStock = 2 });
        var loanId = await LendAsync(member, item, days: 3);
        _api.Clock.Now = _api.Clock.Now.AddDays(5);

        var row = Assert.Single(await ReportAsync());

        Assert.False(row.TryGetProperty("itemName", out _), "itemName should be gone from the row");
        Assert.False(row.TryGetProperty("memberName", out _), "memberName should be gone from the row");
        Assert.Equal(["daysOverdue", "dueDate", "item", "loanId", "member"], Keys(row));
        Assert.Equal(loanId, row.GetProperty("loanId").GetInt32());
        Assert.Equal("2026-03-13", row.GetProperty("dueDate").GetString());
        Assert.Equal(2, row.GetProperty("daysOverdue").GetInt32());

        var rowItem = row.GetProperty("item");
        Assert.Equal(["id", "name", "sku"], Keys(rowItem));
        Assert.Equal(Id(item), rowItem.GetProperty("id").GetInt32());
        Assert.Equal("Ladder", rowItem.GetProperty("name").GetString());
        Assert.Equal("LD-001", rowItem.GetProperty("sku").GetString());

        var rowMember = row.GetProperty("member");
        Assert.Equal(["email", "id", "name"], Keys(rowMember));
        Assert.Equal(Id(member), rowMember.GetProperty("id").GetInt32());
        Assert.Equal("Ada Lovelace", rowMember.GetProperty("name").GetString());
        // As stored: the members API keeps emails lower-cased.
        Assert.Equal(member.GetProperty("email").GetString(), rowMember.GetProperty("email").GetString());
        Assert.Equal("ada.lovelace@example.com", rowMember.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Rows_keep_their_selection_and_order_and_tell_same_named_items_apart()
    {
        var ada = await PostAsync("/api/members", new { name = "Ada Lovelace", email = "ada@example.com" });
        var grace = await PostAsync("/api/members", new { name = "Grace Hopper", email = "grace@example.com" });
        var ladderOne = await PostAsync("/api/items", new { name = "Ladder", category = "Tools", sku = "LD-001", totalStock = 5 });
        var ladderTwo = await PostAsync("/api/items", new { name = "Ladder", category = "Tools", sku = "LD-002", totalStock = 5 });
        var drill = await PostAsync("/api/items", new { name = "Drill", category = "Tools", sku = "DR-001", totalStock = 5 });

        var adaLadderTwo = await LendAsync(ada, ladderTwo, days: 3);       // due 03-13
        var graceLadderOne = await LendAsync(grace, ladderOne, days: 1);   // due 03-11
        var graceDrill = await LendAsync(grace, drill, days: 3);           // due 03-13, after adaLadderTwo by id
        var returned = await LendAsync(ada, drill, days: 2);               // due 03-12, but returned
        await LendAsync(ada, ladderOne, days: 5);                          // due 03-15 = today, not overdue
        await LendAsync(grace, ladderTwo, days: 9);                        // due 03-19, not overdue
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{returned}/return", null)).StatusCode);
        _api.Clock.Now = _api.Clock.Now.AddDays(5);

        var rows = await ReportAsync();

        Assert.Equal([graceLadderOne, adaLadderTwo, graceDrill], rows.Select(r => r.GetProperty("loanId").GetInt32()));
        Assert.Equal(["2026-03-11", "2026-03-13", "2026-03-13"], rows.Select(r => r.GetProperty("dueDate").GetString()));
        Assert.Equal([4, 2, 2], rows.Select(r => r.GetProperty("daysOverdue").GetInt32()));
        Assert.Equal([Id(ladderOne), Id(ladderTwo), Id(drill)], rows.Select(r => r.GetProperty("item").GetProperty("id").GetInt32()));
        Assert.Equal(["Ladder", "Ladder", "Drill"], rows.Select(r => r.GetProperty("item").GetProperty("name").GetString()));
        Assert.Equal(["LD-001", "LD-002", "DR-001"], rows.Select(r => r.GetProperty("item").GetProperty("sku").GetString()));
        Assert.Equal([Id(grace), Id(ada), Id(grace)], rows.Select(r => r.GetProperty("member").GetProperty("id").GetInt32()));
        Assert.Equal(["Grace Hopper", "Ada Lovelace", "Grace Hopper"], rows.Select(r => r.GetProperty("member").GetProperty("name").GetString()));
        Assert.Equal(["grace@example.com", "ada@example.com", "grace@example.com"], rows.Select(r => r.GetProperty("member").GetProperty("email").GetString()));
    }

    [Fact]
    public async Task The_report_keeps_its_access_rule()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await _api.ClientAs("member").GetAsync("/api/reports/overdue")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _api.CreateClient().GetAsync("/api/reports/overdue")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _api.ClientAs("admin").GetAsync("/api/reports/overdue")).StatusCode);
    }

    private async Task<JsonElement> PostAsync(string url, object body)
    {
        var response = await _staff.PostJsonAsync(url, body);
        Assert.True(response.IsSuccessStatusCode, $"POST {url} returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.ReadAsync<JsonElement>();
    }

    private async Task<int> LendAsync(JsonElement member, JsonElement item, int days)
    {
        var loan = await PostAsync("/api/loans", new
        {
            itemId = Id(item),
            memberId = Id(member),
            startDate = _api.Clock.Today,
            dueDate = _api.Clock.Today.AddDays(days),
        });
        return Id(loan);
    }

    private async Task<JsonElement[]> ReportAsync()
    {
        var response = await _staff.GetAsync("/api/reports/overdue");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        return [.. body.EnumerateArray()];
    }

    private static int Id(JsonElement entity) => entity.GetProperty("id").GetInt32();

    private static string[] Keys(JsonElement value) =>
        [.. value.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal)];
}
