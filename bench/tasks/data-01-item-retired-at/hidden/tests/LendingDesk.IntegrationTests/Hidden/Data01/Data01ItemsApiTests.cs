using System.Net;
using System.Text.Json;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.Data01;

/// <summary>The API once all three migrations have run: every item carries retiredAt.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Data01ItemsApiTests(PostgresFixture postgres) : IAsyncLifetime
{
    private static readonly DateTimeOffset RetireTime = new(2026, 3, 12, 16, 45, 30, 123, TimeSpan.Zero);

    private LendingApiFactory _api = null!;

    public async Task InitializeAsync() => _api = await LendingApiFactory.StartAsync(postgres);

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task An_item_in_use_has_a_null_retiredAt_wherever_it_is_returned_even_when_a_body_names_one()
    {
        var staff = _api.ClientAs("staff");

        var created = await staff.PostJsonAsync("/api/items", new { name = "Tile saw", category = "Tools", sku = "D01-SAW", totalStock = 2, retiredAt = "2026-01-01T00:00:00Z" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await JsonAsync(created);
        AssertInUse(item);
        var id = item.GetProperty("id").GetInt32();

        AssertInUse(await JsonAsync(await staff.GetAsync($"/api/items/{id}")));
        AssertInUse(FindIn(await JsonAsync(await staff.GetAsync("/api/items")), id));
        AssertInUse(FindIn(await JsonAsync(await staff.GetAsync("/api/items?includeRetired=true")), id));

        var updated = await staff.PutJsonAsync($"/api/items/{id}", new { name = "Tile saw XL", category = "Tools", sku = "D01-SAW", totalStock = 3, condition = "Worn", retiredAt = "2026-01-02T00:00:00Z" });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        AssertInUse(await JsonAsync(updated));
        AssertInUse(await JsonAsync(await staff.GetAsync($"/api/items/{id}")));
        Assert.Null(await RetiredAtInDbAsync(id));
    }

    [Fact]
    public async Task Retiring_records_the_clock_time_and_behaves_as_before()
    {
        var staff = _api.ClientAs("staff");
        var admin = _api.ClientAs("admin");
        var id = await CreateItemAsync("D01-PRJ");
        _api.Clock.Now = RetireTime;

        Assert.Equal(HttpStatusCode.Forbidden, (await staff.DeleteAsync($"/api/items/{id}")).StatusCode);
        AssertInUse(await JsonAsync(await staff.GetAsync($"/api/items/{id}")));

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/items/{id}")).StatusCode);

        AssertRetiredAt(await JsonAsync(await staff.GetAsync($"/api/items/{id}")), RetireTime);
        Assert.Equal(RetireTime, await RetiredAtInDbAsync(id));
        Assert.DoesNotContain(Items(await JsonAsync(await staff.GetAsync("/api/items"))), i => i.GetProperty("id").GetInt32() == id);
        AssertRetiredAt(FindIn(await JsonAsync(await staff.GetAsync("/api/items?includeRetired=true")), id), RetireTime);

        _api.Clock.Now = RetireTime.AddDays(1);
        var again = await admin.DeleteAsync($"/api/items/{id}");
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("item_retired", (await again.ReadAsync<Problem>()).Code);
        AssertRetiredAt(await JsonAsync(await staff.GetAsync($"/api/items/{id}")), RetireTime);

        var member = await JsonAsync(await staff.PostJsonAsync("/api/members", new { name = "Retired item borrower", email = "d01-borrower@example.com" }));
        var loan = await staff.PostJsonAsync("/api/loans", new
        {
            itemId = id,
            memberId = member.GetProperty("id").GetInt32(),
            startDate = _api.Clock.Today,
            dueDate = _api.Clock.Today.AddDays(3),
        });
        Assert.Equal(HttpStatusCode.Conflict, loan.StatusCode);
        Assert.Equal("item_retired", (await loan.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task Updating_a_retired_item_neither_clears_nor_moves_retiredAt()
    {
        var staff = _api.ClientAs("staff");
        var id = await CreateItemAsync("D01-LDR");
        _api.Clock.Now = RetireTime;
        Assert.Equal(HttpStatusCode.NoContent, (await _api.ClientAs("admin").DeleteAsync($"/api/items/{id}")).StatusCode);
        _api.Clock.Now = RetireTime.AddDays(2);

        var updated = await staff.PutJsonAsync($"/api/items/{id}", new { name = "Old ladder", category = "Tools", sku = "D01-LDR", totalStock = 1, condition = "Worn", retiredAt = (string?)null });

        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        AssertRetiredAt(await JsonAsync(updated), RetireTime);
        AssertRetiredAt(await JsonAsync(await staff.GetAsync($"/api/items/{id}")), RetireTime);
        Assert.Equal(RetireTime, await RetiredAtInDbAsync(id));
    }

    private async Task<int> CreateItemAsync(string sku)
    {
        var response = await _api.ClientAs("staff").PostJsonAsync("/api/items", new { name = $"Item {sku}", category = "Tools", sku, totalStock = 2 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("id").GetInt32();
    }

    private Task<DateTimeOffset?> RetiredAtInDbAsync(int id) =>
        _api.WithDbAsync(db => db.Database
            .SqlQuery<DateTimeOffset?>($"""SELECT "RetiredAt" AS "Value" FROM "Items" WHERE "Id" = {id}""")
            .SingleAsync());

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} from {response.RequestMessage?.RequestUri}: {body}");
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }

    private static List<JsonElement> Items(JsonElement page) => [.. page.GetProperty("items").EnumerateArray()];

    private static JsonElement FindIn(JsonElement page, int id)
    {
        var matches = Items(page).Where(i => i.GetProperty("id").GetInt32() == id).ToList();
        Assert.True(matches.Count == 1, $"Item {id} is not in the page: {page}");
        return matches[0];
    }

    private static void AssertInUse(JsonElement item)
    {
        Assert.True(item.TryGetProperty("retiredAt", out var retiredAt), $"The item has no retiredAt field: {item}");
        Assert.Equal(JsonValueKind.Null, retiredAt.ValueKind);
        Assert.False(item.GetProperty("isRetired").GetBoolean(), $"An item in use says isRetired: {item}");
    }

    private static void AssertRetiredAt(JsonElement item, DateTimeOffset expected)
    {
        Assert.True(item.TryGetProperty("retiredAt", out var retiredAt), $"The item has no retiredAt field: {item}");
        Assert.Equal(JsonValueKind.String, retiredAt.ValueKind);
        Assert.Equal(expected, retiredAt.GetDateTimeOffset());
        Assert.True(item.GetProperty("isRetired").GetBoolean(), $"A retired item says isRetired false: {item}");
    }
}
