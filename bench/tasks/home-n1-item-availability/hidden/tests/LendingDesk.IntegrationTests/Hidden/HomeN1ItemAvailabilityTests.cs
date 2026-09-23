using System.Globalization;
using System.Net;
using System.Text.Json;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.HomeN1;

[Collection(DatabaseGroup.Name)]
public sealed class HomeN1ItemAvailabilityTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private HttpClient _member = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _member = _api.ClientAs("member");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private static DateOnly Day(int month, int day) => new(2026, month, day);

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task<int> CreateItemAsync(int stock)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"AV-{suffix}", totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("id").GetInt32();
    }

    private async Task UpdateItemAsync(int itemId, int stock, string condition)
    {
        var current = await JsonAsync(await _staff.GetAsync($"/api/items/{itemId}"));
        var response = await _staff.PutJsonAsync($"/api/items/{itemId}", new
        {
            name = current.GetProperty("name").GetString(),
            category = current.GetProperty("category").GetString(),
            sku = current.GetProperty("sku").GetString(),
            totalStock = stock,
            condition,
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private async Task<int> CreateMemberAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var response = await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("id").GetInt32();
    }

    private async Task<int> LendAsync(int itemId, int memberId, DateOnly start, DateOnly due)
    {
        var response = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId, startDate = start, dueDate = due });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("id").GetInt32();
    }

    private static string Url(int itemId, string query) => $"/api/items/{itemId}/availability?{query}";

    private static string Range(DateOnly from, DateOnly to) => $"from={Iso(from)}&to={Iso(to)}";

    private static async Task<List<(string Date, int Available)>> AvailabilityAsync(HttpClient client, int itemId, DateOnly from, DateOnly to)
    {
        var response = await client.GetAsync(Url(itemId, Range(from, to)));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        return body.EnumerateArray()
            .Select(e => (e.GetProperty("date").GetString()!, e.GetProperty("available").GetInt32()))
            .ToList();
    }

    private static List<(string Date, int Available)> Expected(DateOnly from, params int[] available) =>
        available.Select((count, index) => (Iso(from.AddDays(index)), count)).ToList();

    private static HashSet<string> PropertyNames(JsonElement body) =>
        body.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

    private static bool HasErrorOn(JsonElement problem, string field) =>
        problem.TryGetProperty("errors", out var errors)
        && errors.ValueKind == JsonValueKind.Object
        && errors.EnumerateObject().Any(e =>
            string.Equals(e.Name, field, StringComparison.OrdinalIgnoreCase)
            || e.Name.EndsWith("." + field, StringComparison.OrdinalIgnoreCase));

    /// <summary>The API's existing answer to invalid input, to compare a new answer's shape against.</summary>
    private async Task<(HttpStatusCode Status, JsonElement Body)> ExistingInvalidInputAsync()
    {
        var response = await _member.GetAsync("/api/items?pageSize=0");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (response.StatusCode, await JsonAsync(response));
    }

    private async Task<JsonElement> AssertInvalidInputAsync(HttpResponseMessage response)
    {
        var (status, reference) = await ExistingInvalidInputAsync();
        Assert.Equal(status, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(reference.GetProperty("code").GetString(), body.GetProperty("code").GetString());
        Assert.Equal(PropertyNames(reference), PropertyNames(body));
        Assert.NotEmpty(body.GetProperty("errors").EnumerateObject());
        return body;
    }

    [Fact]
    public async Task Each_day_counts_the_unreturned_loans_whose_dates_cover_it_in_date_order()
    {
        var itemId = await CreateItemAsync(stock: 2);
        var otherItemId = await CreateItemAsync(stock: 1);
        var memberId = await CreateMemberAsync();
        await LendAsync(itemId, memberId, Day(3, 10), Day(3, 12));
        await LendAsync(itemId, memberId, Day(3, 11), Day(3, 11));
        await LendAsync(itemId, memberId, Day(3, 12), Day(3, 14));
        await LendAsync(otherItemId, memberId, Day(3, 10), Day(3, 16));

        var days = await AvailabilityAsync(_member, itemId, Day(3, 9), Day(3, 16));

        Assert.Equal(Expected(Day(3, 9), 2, 1, 0, 0, 1, 1, 2, 2), days);
    }

    [Fact]
    public async Task Returned_loans_never_count_even_on_days_before_their_return()
    {
        var itemId = await CreateItemAsync(stock: 1);
        var memberId = await CreateMemberAsync();
        var returned = await LendAsync(itemId, memberId, Day(3, 10), Day(3, 14));
        _api.Clock.Now = _api.Clock.Now.AddDays(2);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{returned}/return", null)).StatusCode);
        await LendAsync(itemId, memberId, Day(3, 13), Day(3, 15));

        var days = await AvailabilityAsync(_staff, itemId, Day(3, 10), Day(3, 16));

        Assert.Equal(Expected(Day(3, 10), 1, 1, 1, 0, 0, 0, 1), days);
    }

    [Fact]
    public async Task Past_days_are_reported_and_an_unreturned_loan_counts_only_from_its_start_through_its_due_date()
    {
        var itemId = await CreateItemAsync(stock: 1);
        var memberId = await CreateMemberAsync();
        await LendAsync(itemId, memberId, Day(3, 10), Day(3, 12));
        _api.Clock.Now = _api.Clock.Now.AddDays(10);

        var days = await AvailabilityAsync(_member, itemId, Day(3, 8), Day(3, 14));

        Assert.Equal(Expected(Day(3, 8), 1, 1, 0, 0, 0, 1, 1), days);
    }

    [Fact]
    public async Task Available_never_goes_below_zero()
    {
        var itemId = await CreateItemAsync(stock: 2);
        var memberId = await CreateMemberAsync();
        await LendAsync(itemId, memberId, Day(3, 10), Day(3, 11));
        await LendAsync(itemId, memberId, Day(3, 10), Day(3, 11));
        await UpdateItemAsync(itemId, stock: 1, condition: "Good");

        var days = await AvailabilityAsync(_staff, itemId, Day(3, 10), Day(3, 12));

        Assert.Equal(Expected(Day(3, 10), 0, 0, 1), days);
    }

    [Fact]
    public async Task A_damaged_item_is_reported_like_any_other()
    {
        var itemId = await CreateItemAsync(stock: 2);
        var memberId = await CreateMemberAsync();
        await LendAsync(itemId, memberId, Day(3, 10), Day(3, 11));
        await UpdateItemAsync(itemId, stock: 2, condition: "Damaged");

        var days = await AvailabilityAsync(_member, itemId, Day(3, 10), Day(3, 12));

        Assert.Equal(Expected(Day(3, 10), 1, 1, 2), days);
    }

    [Fact]
    public async Task A_single_day_and_a_31_day_range_are_both_answered_one_entry_per_day()
    {
        var itemId = await CreateItemAsync(stock: 3);

        var single = await AvailabilityAsync(_member, itemId, Day(3, 10), Day(3, 10));
        var month = await AvailabilityAsync(_member, itemId, Day(3, 1), Day(3, 31));
        var acrossMonths = await AvailabilityAsync(_member, itemId, Day(2, 20), Day(3, 22));

        Assert.Equal(Expected(Day(3, 10), 3), single);
        Assert.Equal(Expected(Day(3, 1), Enumerable.Repeat(3, 31).ToArray()), month);
        Assert.Equal(Expected(Day(2, 20), Enumerable.Repeat(3, 31).ToArray()), acrossMonths);
    }

    [Fact]
    public async Task A_request_without_the_demo_headers_is_unauthenticated()
    {
        var itemId = await CreateItemAsync(stock: 1);

        var response = await _api.CreateClient().GetAsync(Url(itemId, Range(Day(3, 10), Day(3, 16))));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("unauthenticated", (await JsonAsync(response)).GetProperty("code").GetString());
    }

    [Theory]
    [InlineData("to=2026-03-16")]
    [InlineData("")]
    [InlineData("from=2026-02-30&to=2026-03-05")]
    [InlineData("from=yesterday&to=2026-03-16")]
    [InlineData("from=2026-03-10&to=2026-13-01")]
    [InlineData("from=2026-03-10&to=soon")]
    public async Task A_missing_or_unreal_date_is_invalid_input(string query)
    {
        var itemId = await CreateItemAsync(stock: 1);

        await AssertInvalidInputAsync(await _member.GetAsync(Url(itemId, query)));
    }

    [Theory]
    [InlineData("from=2026-03-10")]
    [InlineData("from=2026-03-10&to=2026-03-09")]
    [InlineData("from=2026-03-01&to=2026-04-01")]
    [InlineData("from=2026-02-20&to=2026-03-23")]
    [InlineData("from=2026-03-31&to=2026-03-01")]
    public async Task A_missing_to_a_reversed_range_or_a_range_over_31_days_is_invalid_input_on_to(string query)
    {
        var itemId = await CreateItemAsync(stock: 1);

        var body = await AssertInvalidInputAsync(await _member.GetAsync(Url(itemId, query)));

        Assert.True(HasErrorOn(body, "to"), $"Expected an error on 'to' in: {body}");
    }

    [Fact]
    public async Task An_unknown_item_is_not_found_the_way_the_other_item_endpoints_answer_it()
    {
        var existing = await _member.GetAsync("/api/items/999999");
        var response = await _member.GetAsync(Url(999999, Range(Day(3, 10), Day(3, 16))));

        Assert.Equal(HttpStatusCode.NotFound, existing.StatusCode);
        Assert.Equal(existing.StatusCode, response.StatusCode);
        var expected = await JsonAsync(existing);
        var body = await JsonAsync(response);
        Assert.Equal(PropertyNames(expected), PropertyNames(body));
        foreach (var property in expected.EnumerateObject().Where(p => p.Name != "traceId"))
        {
            Assert.Equal(property.Value.ToString(), body.GetProperty(property.Name).ToString());
        }
    }

    [Fact]
    public async Task A_retired_item_is_a_conflict_with_the_code_lending_it_gets()
    {
        var itemId = await CreateItemAsync(stock: 1);
        var memberId = await CreateMemberAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await _api.ClientAs("admin").DeleteAsync($"/api/items/{itemId}")).StatusCode);
        var lend = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId, startDate = Day(3, 10), dueDate = Day(3, 12) });
        Assert.Equal(HttpStatusCode.Conflict, lend.StatusCode);
        var lendBody = await JsonAsync(lend);

        var response = await _member.GetAsync(Url(itemId, Range(Day(3, 10), Day(3, 16))));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(lendBody.GetProperty("code").GetString(), body.GetProperty("code").GetString());
        Assert.Equal(PropertyNames(lendBody), PropertyNames(body));
    }
}
