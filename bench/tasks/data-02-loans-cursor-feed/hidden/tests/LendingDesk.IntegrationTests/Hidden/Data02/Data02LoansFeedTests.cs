using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Data02;

/// <summary>GET /api/loans/feed through the HTTP surface, checked against GET /api/loans on the same data.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Data02LoansFeedTests(PostgresFixture postgres) : IAsyncLifetime
{
    /// <summary>Due dates, in days from today, of the seeded loans in creation (id) order - ties on 2, 5 and 9.</summary>
    private static readonly int[] DueOffsets = [5, 2, 5, 9, 2, 0, 14, 5, 3, 9, 1, 2];

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    [InlineData(5)]
    [InlineData(12)]
    [InlineData(100)]
    public async Task Walking_the_feed_returns_every_loan_once_in_the_list_order(int limit)
    {
        Assert.Equal("MjAyNi0wMy0xNyw0Mg", Cursor(new DateOnly(2026, 3, 17), 42));
        await SeedAsync();
        var expected = await ListAsync(string.Empty);
        Assert.Equal(DueOffsets.Length, expected.Count);

        AssertSameLoans(expected, await WalkAsync(string.Empty, limit));
    }

    [Fact]
    public async Task Without_a_limit_a_page_holds_twenty()
    {
        var (memberId, _, itemId) = await PeopleAndItemAsync();
        for (var i = 0; i < 25; i++)
        {
            await LendAsync(memberId, itemId, i % 7);
        }

        var first = await FeedAsync(string.Empty);
        Assert.Equal(20, first.Items.Count);
        Assert.NotNull(first.NextCursor);
        AssertSameLoans(await ListAsync(string.Empty), await WalkAsync(string.Empty, null));
    }

    [Fact]
    public async Task Member_and_status_filters_mean_what_they_mean_on_the_list()
    {
        var (m1, m2, loanIds) = await SeedAsync();
        foreach (var index in new[] { 1, 6, 8 })
        {
            Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{loanIds[index]}/return", null)).StatusCode);
        }

        _api.Clock.Now = _api.Clock.Now.AddDays(4);

        foreach (var filter in new[]
        {
            $"memberId={m1}",
            $"memberId={m2}",
            "status=Active",
            "status=Overdue",
            "status=Returned",
            $"memberId={m1}&status=Overdue",
            $"memberId={m2}&status=Active",
        })
        {
            var expected = await ListAsync(filter);
            Assert.NotEmpty(expected);
            AssertSameLoans(expected, await WalkAsync(filter, 2), filter);
        }

        var nobody = await FeedAsync("?memberId=999999");
        Assert.Empty(nobody.Items);
        Assert.Null(nobody.NextCursor);
    }

    [Fact]
    public async Task An_empty_result_is_an_empty_page_with_a_null_cursor()
    {
        var response = await _staff.GetAsync("/api/loans/feed");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("items").ValueKind);
        Assert.Equal(0, document.RootElement.GetProperty("items").GetArrayLength());
        Assert.True(document.RootElement.TryGetProperty("nextCursor", out var next), $"No nextCursor field: {body}");
        Assert.Equal(JsonValueKind.Null, next.ValueKind);
    }

    [Fact]
    public async Task A_cursor_is_a_position_in_the_order_not_a_loan()
    {
        await SeedAsync();
        var all = await ListAsync(string.Empty);
        var today = _api.Clock.Today;

        foreach (var loan in all)
        {
            var (due, id) = (DueOf(loan), IdOf(loan));
            AssertSameLoans(After(all, due, id), (await FeedAsync($"?limit=100&after={Cursor(due, id)}")).Items, $"after loan {id}");
        }

        foreach (var (due, id) in new[]
        {
            (today.AddDays(4), 1),
            (today.AddDays(5), 1),
            (today.AddDays(5), int.MaxValue),
            (today.AddDays(-30), 1),
            (today.AddDays(60), 1),
        })
        {
            var page = await FeedAsync($"?limit=100&after={Cursor(due, id)}");
            AssertSameLoans(After(all, due, id), page.Items, $"after {due:yyyy-MM-dd},{id}");
            Assert.Null(page.NextCursor);
        }
    }

    [Fact]
    public async Task A_cursor_keeps_working_after_its_loan_is_returned_or_under_other_filters()
    {
        var (m1, m2, _) = await SeedAsync();

        var active = await FeedAsync("?status=Active&limit=3");
        Assert.Equal(3, active.Items.Count);
        var cursor = Assert.IsType<string>(active.NextCursor);
        var lastId = IdOf(active.Items[^1]);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{lastId}/return", null)).StatusCode);

        var next = await FeedAsync($"?status=Active&limit=3&after={cursor}");
        var expected = After(await ListAsync("status=Active"), DueOf(active.Items[^1]), lastId);
        AssertSameLoans(expected.Take(3).ToList(), next.Items, "active after a returned loan");

        var firstOfM1 = await FeedAsync($"?memberId={m1}&limit=2");
        var m1Cursor = Assert.IsType<string>(firstOfM1.NextCursor);
        var m1Last = firstOfM1.Items[^1];
        var m2Page = await FeedAsync($"?memberId={m2}&limit=100&after={m1Cursor}");
        AssertSameLoans(After(await ListAsync($"memberId={m2}"), DueOf(m1Last), IdOf(m1Last)), m2Page.Items, "member 2 after a member 1 cursor");
    }

    [Fact]
    public async Task A_loan_created_later_that_sorts_before_the_cursor_neither_shows_up_nor_shifts_later_pages()
    {
        var (m1, _, _) = await SeedAsync();
        var before = await ListAsync(string.Empty);

        var first = await FeedAsync("?limit=4");
        var cursor = Assert.IsType<string>(first.NextCursor);
        var last = first.Items[^1];
        Assert.True(DueOf(last) > _api.Clock.Today, "The seeded data should put the fourth loan after today.");
        var itemId = await ItemAsync("D02-LATE");
        var lateId = await LendAsync(m1, itemId, 0);

        var second = await FeedAsync($"?limit=4&after={cursor}");
        var remaining = After(before, DueOf(last), IdOf(last));
        AssertSameLoans(remaining.Take(4).ToList(), second.Items, "second page");
        Assert.DoesNotContain(second.Items, l => IdOf(l) == lateId);

        var rest = new List<JsonElement>(first.Items);
        var after = cursor;
        while (after is not null)
        {
            var page = await FeedAsync($"?limit=4&after={after}");
            rest.AddRange(page.Items);
            after = page.NextCursor;
        }

        AssertSameLoans(before, rest, "the walk that started before the late loan");
    }

    [Theory]
    [InlineData("0")]
    [InlineData("101")]
    [InlineData("-1")]
    public async Task A_limit_out_of_range_is_rejected_like_any_invalid_query_parameter(string limit)
    {
        await AssertRejectedAsync(await _staff.GetAsync($"/api/loans/feed?limit={limit}"), "limit");
    }

    [Theory]
    [InlineData("raw", "***")]
    [InlineData("raw", "A")]
    [InlineData("raw", "MjAyNi0wMy0xNyw0M")]
    [InlineData("raw", "!MjAyNi0wMy0xNyw0Mg")]
    [InlineData("text", "hello")]
    [InlineData("text", "42")]
    [InlineData("text", "2026-03-17")]
    [InlineData("text", "2026-03-17,42,7")]
    [InlineData("text", "42,2026-03-17")]
    [InlineData("text", "2026-03-17;42")]
    [InlineData("text", "2026-03-17,abc")]
    [InlineData("text", "2026/03/17,42")]
    [InlineData("text", "2026-02-30,5")]
    [InlineData("text", "2026-13-01,5")]
    [InlineData("text", "2026-03-17,0")]
    [InlineData("text", "2026-03-17,-1")]
    public async Task An_after_that_is_not_a_cursor_is_rejected_like_any_invalid_query_parameter(string kind, string value)
    {
        var after = kind == "text" ? Base64Url(Encoding.UTF8.GetBytes(value)) : value;

        await AssertRejectedAsync(await _staff.GetAsync($"/api/loans/feed?after={Uri.EscapeDataString(after)}"), "after");
    }

    [Theory]
    [InlineData("memberId=0", "memberId")]
    [InlineData("memberId=-4", "memberId")]
    [InlineData("status=Lost", "status")]
    public async Task Member_and_status_are_validated_as_on_the_list(string query, string parameter)
    {
        var list = await _staff.GetAsync($"/api/loans?{query}");
        Assert.Equal(HttpStatusCode.BadRequest, list.StatusCode);

        await AssertRejectedAsync(await _staff.GetAsync($"/api/loans/feed?{query}"), parameter);
    }

    [Fact]
    public async Task Anyone_signed_in_may_read_the_feed_and_nobody_else()
    {
        await SeedAsync();

        var anonymous = await _api.CreateClient().GetAsync("/api/loans/feed");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal("unauthenticated", (await anonymous.ReadAsync<Problem>()).Code);

        foreach (var role in new[] { "member", "staff", "admin" })
        {
            var page = await FeedAsync("?limit=100", _api.ClientAs(role));
            Assert.Equal(DueOffsets.Length, page.Items.Count);
        }
    }

    [Fact]
    public async Task The_feed_sits_beside_the_numbered_list_which_is_left_as_it_is()
    {
        await SeedAsync();
        var all = await ListAsync(string.Empty);
        AssertSameLoans(all.Take(5).ToList(), (await FeedAsync("?limit=5")).Items);

        var response = await _staff.GetAsync("/api/loans?page=2&pageSize=5");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var page = document.RootElement;

        Assert.Equal(2, page.GetProperty("page").GetInt32());
        Assert.Equal(5, page.GetProperty("pageSize").GetInt32());
        Assert.Equal(DueOffsets.Length, page.GetProperty("totalCount").GetInt32());
        AssertSameLoans(all.Skip(5).Take(5).ToList(), [.. page.GetProperty("items").EnumerateArray()]);
    }

    private static string Cursor(DateOnly due, int id) =>
        Base64Url(Encoding.UTF8.GetBytes(due.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "," + id.ToString(CultureInfo.InvariantCulture)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static DateOnly DueOf(JsonElement loan) =>
        DateOnly.ParseExact(loan.GetProperty("dueDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static int IdOf(JsonElement loan) => loan.GetProperty("id").GetInt32();

    private static List<JsonElement> After(IEnumerable<JsonElement> loans, DateOnly due, int id) =>
        [.. loans.Where(l => DueOf(l) > due || (DueOf(l) == due && IdOf(l) > id))];

    private static void AssertSameLoans(List<JsonElement> expected, List<JsonElement> actual, string context = "")
    {
        Assert.True(
            expected.Count == actual.Count && expected.Zip(actual).All(p => JsonElement.DeepEquals(p.First, p.Second)),
            $"{context}\nexpected: [{string.Join(", ", expected.Select(e => e.GetRawText()))}]\nactual:   [{string.Join(", ", actual.Select(e => e.GetRawText()))}]");
    }

    private static async Task AssertRejectedAsync(HttpResponseMessage response, string parameter)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"Expected 400 for {response.RequestMessage?.RequestUri}, got {(int)response.StatusCode}: {body}");
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = JsonSerializer.Deserialize<Problem>(body, LendingApiFactory.Json)!;
        Assert.Equal(400, problem.Status);
        Assert.Equal("Validation failed", problem.Title);
        Assert.Equal("validation_failed", problem.Code);
        Assert.False(string.IsNullOrEmpty(problem.TraceId));
        Assert.True(
            problem.Errors is not null && problem.Errors.Keys.Any(k => k.EndsWith(parameter, StringComparison.OrdinalIgnoreCase)),
            $"The errors do not name {parameter}: {body}");
    }

    private async Task<(int Member1, int Member2, List<int> LoanIds)> SeedAsync()
    {
        var (m1, m2, itemId) = await PeopleAndItemAsync();
        var ids = new List<int>();
        for (var i = 0; i < DueOffsets.Length; i++)
        {
            ids.Add(await LendAsync(i % 2 == 0 ? m1 : m2, itemId, DueOffsets[i]));
        }

        return (m1, m2, ids);
    }

    private async Task<(int Member1, int Member2, int ItemId)> PeopleAndItemAsync()
    {
        var m1 = await MemberAsync("one");
        var m2 = await MemberAsync("two");
        return (m1, m2, await ItemAsync("D02-ITEM"));
    }

    private async Task<int> MemberAsync(string tag)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name = $"Feed member {tag}", email = $"feed-{tag}@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return IdOf(await ReadJsonAsync(response));
    }

    private async Task<int> ItemAsync(string sku)
    {
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Feed item {sku}", category = "Tools", sku, totalStock = 100 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return IdOf(await ReadJsonAsync(response));
    }

    private async Task<int> LendAsync(int memberId, int itemId, int dueInDays)
    {
        var response = await _staff.PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = _api.Clock.Today,
            dueDate = _api.Clock.Today.AddDays(dueInDays),
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return IdOf(await ReadJsonAsync(response));
    }

    private async Task<List<JsonElement>> ListAsync(string filter)
    {
        var response = await _staff.GetAsync("/api/loans?pageSize=100" + (filter.Length > 0 ? "&" + filter : string.Empty));
        var page = await ReadJsonAsync(response);
        Assert.True(page.GetProperty("totalCount").GetInt32() <= 100, "The test data outgrew one list page.");
        return [.. page.GetProperty("items").EnumerateArray()];
    }

    private async Task<(List<JsonElement> Items, string? NextCursor)> FeedAsync(string query, HttpClient? client = null)
    {
        var response = await (client ?? _staff).GetAsync("/api/loans/feed" + query);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"GET /api/loans/feed{query} returned {(int)response.StatusCode}: {body}");

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        Assert.Equal(JsonValueKind.Object, root.ValueKind);
        Assert.Equal(["items", "nextCursor"], root.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        var next = root.GetProperty("nextCursor");
        Assert.True(next.ValueKind is JsonValueKind.Null or JsonValueKind.String, $"nextCursor is neither null nor a string: {body}");
        return ([.. root.GetProperty("items").EnumerateArray().Select(e => e.Clone())], next.ValueKind == JsonValueKind.Null ? null : next.GetString());
    }

    /// <summary>Follows nextCursor from the first page to the end, checking every page and every cursor on the way.</summary>
    private async Task<List<JsonElement>> WalkAsync(string filter, int? limit)
    {
        var pageSize = limit ?? 20;
        var walked = new List<JsonElement>();
        string? after = null;
        for (var pages = 0; ; pages++)
        {
            Assert.True(pages < 200, "The feed never ends.");
            var parts = new List<string>();
            if (filter.Length > 0)
            {
                parts.Add(filter);
            }

            if (limit is { } l)
            {
                parts.Add($"limit={l}");
            }

            if (after is not null)
            {
                parts.Add($"after={after}");
            }

            var query = parts.Count > 0 ? "?" + string.Join('&', parts) : string.Empty;
            var (items, next) = await FeedAsync(query);
            Assert.True(items.Count <= pageSize, $"{query} returned {items.Count} loans for a page of {pageSize}.");
            if (after is not null)
            {
                Assert.True(items.Count > 0, $"A nextCursor was handed out, but {query} returned no loan after it.");
            }

            walked.AddRange(items);
            if (next is null)
            {
                return walked;
            }

            Assert.True(items.Count == pageSize, $"{query} returned a cursor after a page of {items.Count}, but a page holds {pageSize}.");
            Assert.Equal(Cursor(DueOf(items[^1]), IdOf(items[^1])), next);
            after = next;
        }
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} from {response.RequestMessage?.RequestUri}: {body}");
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }
}
