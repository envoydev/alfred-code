using System.Net;
using System.Text.Json;
using LendingDesk.Api.Contracts;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Guard03;

/// <summary>
/// The loans list's new filters. Every test seeds the same six loans, all starting on the clock's
/// today (2026-03-10):
/// L1 Cordless drill / Ada Lovelace due 03-20, L2 Tripod / Ada Lovelace due 03-15,
/// L3 Cordless drill / Grace Hopper due 03-20, L4 Hammer drill / Grace Hopper due 03-25,
/// L5 Tripod / Dorothy Vaughan due 03-12, L6 Cordless drill / Dorothy Vaughan due 04-01.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Guard03LoanFilterTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private readonly Dictionary<string, int> _loans = [];
    private readonly Dictionary<string, int> _items = [];
    private readonly Dictionary<string, int> _members = [];

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");

        foreach (var (key, name) in new[] { ("M1", "Ada Lovelace"), ("M2", "Grace Hopper"), ("M3", "Dorothy Vaughan") })
        {
            var response = await _staff.PostJsonAsync("/api/members", new { name, email = $"{key.ToUpperInvariant()}@filters.example.com" });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            _members[key] = (await response.ReadAsync<MemberDto>()).Id;
        }

        foreach (var (key, name, sku) in new[] { ("I1", "Cordless drill", "DRL-1"), ("I2", "Tripod", "TRP-1"), ("I3", "Hammer drill", "DRL-2") })
        {
            var response = await _staff.PostJsonAsync("/api/items", new { name, category = "Tools", sku, totalStock = 10 });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            _items[key] = (await response.ReadAsync<ItemDto>()).Id;
        }

        foreach (var (key, item, member, due) in new[]
        {
            ("L1", "I1", "M1", new DateOnly(2026, 3, 20)),
            ("L2", "I2", "M1", new DateOnly(2026, 3, 15)),
            ("L3", "I1", "M2", new DateOnly(2026, 3, 20)),
            ("L4", "I3", "M2", new DateOnly(2026, 3, 25)),
            ("L5", "I2", "M3", new DateOnly(2026, 3, 12)),
            ("L6", "I1", "M3", new DateOnly(2026, 4, 1)),
        })
        {
            var response = await _staff.PostJsonAsync("/api/loans", new
            {
                itemId = _items[item],
                memberId = _members[member],
                startDate = _api.Clock.Today,
                dueDate = due,
            });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            _loans[key] = (await response.ReadAsync<LoanDto>()).Id;
        }
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private string Resolve(string query)
    {
        foreach (var (key, id) in _items.Concat(_members))
        {
            query = query.Replace("{" + key + "}", id.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);
        }

        return query;
    }

    private async Task<PagedResult<LoanDto>> ListAsync(string query)
    {
        var response = await _staff.GetAsync("/api/loans?" + Resolve(query));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<PagedResult<LoanDto>>();
    }

    private string[] Labels(PagedResult<LoanDto> page) =>
        page.Items.Select(l => _loans.Single(pair => pair.Value == l.Id).Key).ToArray();

    private static string[] Expected(string labels) => labels.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    private async Task AssertListAsync(string query, string labels)
    {
        var page = await ListAsync(query);

        Assert.Equal(Expected(labels), Labels(page));
        Assert.Equal(Expected(labels).Length, page.TotalCount);
    }

    [Fact]
    public async Task ItemId_keeps_only_the_loans_of_that_item()
    {
        await AssertListAsync("itemId={I1}", "L1 L3 L6");
        await AssertListAsync("itemId={I2}", "L5 L2");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task An_itemId_below_1_is_a_400_the_same_way_memberId_is(int value)
    {
        var member = await _staff.GetAsync($"/api/loans?memberId={value}");

        var response = await _staff.GetAsync($"/api/loans?itemId={value}");

        Assert.Equal(HttpStatusCode.BadRequest, member.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var expected = await member.ReadAsync<Problem>();
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Code, problem.Code);
        Assert.Equal(expected.Title, problem.Title);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
        Assert.Contains(problem.Errors!.Keys, key => string.Equals(key, "ItemId", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task An_unknown_itemId_is_an_empty_page_the_same_way_an_unknown_memberId_is()
    {
        await AssertListAsync("memberId=999999", string.Empty);
        await AssertListAsync("itemId=999999", string.Empty);
    }

    [Theory]
    [InlineData("dueFrom=2026-03-15", "L2 L1 L3 L4 L6")]
    [InlineData("dueFrom=2026-03-16", "L1 L3 L4 L6")]
    [InlineData("dueTo=2026-03-20", "L5 L2 L1 L3")]
    [InlineData("dueTo=2026-03-19", "L5 L2")]
    [InlineData("dueFrom=2026-03-15&dueTo=2026-03-20", "L2 L1 L3")]
    [InlineData("dueFrom=2026-03-20&dueTo=2026-03-20", "L1 L3")]
    [InlineData("dueFrom=2026-04-02", "")]
    public async Task DueFrom_and_dueTo_are_inclusive_and_work_alone_or_together(string query, string labels)
    {
        await AssertListAsync(query, labels);
    }

    [Fact]
    public async Task DueFrom_later_than_dueTo_is_an_empty_page_not_an_error()
    {
        await AssertListAsync("dueFrom=2026-03-21&dueTo=2026-03-20", string.Empty);
    }

    [Theory]
    [InlineData("DRILL", "L1 L3 L4 L6")]
    [InlineData("hopper", "L3 L4")]
    [InlineData("oR", "L5 L1 L3 L6")]
    [InlineData("ripo", "L5 L2")]
    [InlineData("zebra", "")]
    public async Task Search_matches_item_or_member_names_ignoring_case(string search, string labels)
    {
        await AssertListAsync("search=" + Uri.EscapeDataString(search), labels);
    }

    [Fact]
    public async Task Search_takes_100_characters_and_rejects_101_the_same_way_the_items_list_does()
    {
        await AssertListAsync("search=" + new string('x', 100), string.Empty);
        var items = await _staff.GetAsync("/api/items?search=" + new string('x', 101));

        var response = await _staff.GetAsync("/api/loans?search=" + new string('x', 101));

        Assert.Equal(HttpStatusCode.BadRequest, items.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var expected = await items.ReadAsync<Problem>();
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Code, problem.Code);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Contains(problem.Errors!.Keys, key => string.Equals(key, "Search", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("itemId={I1}&memberId={M3}", "L6")]
    [InlineData("itemId={I1}&search=hopper", "L3")]
    [InlineData("search=or&dueTo=2026-03-20", "L5 L1 L3")]
    [InlineData("memberId={M1}&dueFrom=2026-03-16", "L1")]
    [InlineData("itemId={I2}&memberId={M1}&dueFrom=2026-03-01&dueTo=2026-03-31&search=trip", "L2")]
    [InlineData("itemId={I3}&search=ada", "")]
    public async Task The_filters_apply_together(string query, string labels)
    {
        await AssertListAsync(query, labels);
    }

    [Fact]
    public async Task The_filters_apply_together_with_status()
    {
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{_loans["L1"]}/return", null)).StatusCode);
        _api.Clock.Now = new DateTimeOffset(2026, 3, 16, 9, 0, 0, TimeSpan.Zero);

        await AssertListAsync("status=Overdue&search=tripod", "L5 L2");
        await AssertListAsync("status=Overdue&dueFrom=2026-03-13", "L2");
        await AssertListAsync("status=Active&itemId={I1}", "L3 L6");
        await AssertListAsync("status=Returned&search=ada", "L1");
        await AssertListAsync("status=Active&memberId={M2}&dueTo=2026-03-20", "L3");
    }

    [Fact]
    public async Task Paging_and_ordering_apply_to_the_filtered_list()
    {
        var first = await ListAsync("search=or&pageSize=2&page=1");
        var second = await ListAsync("search=or&pageSize=2&page=2");
        var third = await ListAsync("search=or&pageSize=2&page=3");
        var items = await ListAsync("itemId={I1}&pageSize=2&page=2");

        Assert.Equal(["L5", "L1"], Labels(first));
        Assert.Equal(["L3", "L6"], Labels(second));
        Assert.Empty(third.Items);
        Assert.All(new[] { first, second, third }, page => Assert.Equal(4, page.TotalCount));
        Assert.All(new[] { first, second, third }, page => Assert.Equal(2, page.PageSize));
        Assert.Equal([1, 2, 3], new[] { first, second, third }.Select(p => p.Page));
        Assert.Equal(["L6"], Labels(items));
        Assert.Equal(3, items.TotalCount);
    }

    [Fact]
    public async Task The_response_shape_is_unchanged()
    {
        var all = await ListAsync(string.Empty);
        var response = await _staff.GetAsync("/api/loans?" + Resolve("itemId={I1}&dueFrom=2026-03-01&dueTo=2026-04-30&search=drill"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            ["items", "page", "pageSize", "totalCount"],
            document.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        foreach (var loan in document.RootElement.GetProperty("items").EnumerateArray())
        {
            Assert.Equal(
                ["dueDate", "id", "itemId", "itemName", "memberId", "memberName", "returnedAt", "startDate", "status"],
                loan.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        }

        var filtered = JsonSerializer.Deserialize<PagedResult<LoanDto>>(document.RootElement.GetRawText(), LendingApiFactory.Json)!;
        Assert.Equal(["L1", "L3", "L6"], Labels(filtered));
        Assert.Equal(all.Items.Where(l => filtered.Items.Any(f => f.Id == l.Id)), filtered.Items);
        Assert.Equal(6, all.TotalCount);
    }
}
