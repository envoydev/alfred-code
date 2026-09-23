using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Items;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests;

[Collection(DatabaseGroup.Name)]
public sealed class ItemsApiTests(PostgresFixture postgres) : IAsyncLifetime
{
    private LendingApiFactory _api = null!;

    public async Task InitializeAsync() => _api = await LendingApiFactory.StartAsync(postgres);

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private async Task<ItemDto> CreateItemAsync(string name, string sku, string category = "Tools", int stock = 2)
    {
        var response = await _api.ClientAs("staff").PostJsonAsync("/api/items", new { name, category, sku, totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<ItemDto>();
    }

    [Fact]
    public async Task A_new_item_is_good_and_fully_available()
    {
        var item = await CreateItemAsync("Cordless drill", "DRL-100", stock: 3);

        Assert.Equal(ItemCondition.Good, item.Condition);
        Assert.Equal(3, item.Available);
        Assert.False(item.IsRetired);
    }

    [Fact]
    public async Task The_list_searches_names_case_insensitively_and_filters_by_category()
    {
        await CreateItemAsync("Cordless drill", "DRL-200");
        await CreateItemAsync("Hammer drill", "DRL-201");
        await CreateItemAsync("Tripod", "TRP-200", category: "Photo");

        var drills = await (await _api.ClientAs("member").GetAsync("/api/items?search=DRILL")).ReadAsync<PagedResult<ItemDto>>();
        var photo = await (await _api.ClientAs("member").GetAsync("/api/items?category=Photo")).ReadAsync<PagedResult<ItemDto>>();

        Assert.Equal(["Cordless drill", "Hammer drill"], drills.Items.Select(i => i.Name));
        Assert.Equal(["Tripod"], photo.Items.Select(i => i.Name));
    }

    [Fact]
    public async Task Staff_update_an_item_including_its_condition()
    {
        var item = await CreateItemAsync("Ladder", "LDR-1");

        var response = await _api.ClientAs("staff").PutJsonAsync($"/api/items/{item.Id}", new { name = "Step ladder", category = "Tools", sku = "LDR-1", totalStock = 1, condition = "Worn" });

        var updated = await response.ReadAsync<ItemDto>();
        Assert.Equal("Step ladder", updated.Name);
        Assert.Equal(ItemCondition.Worn, updated.Condition);
        Assert.Equal(1, updated.TotalStock);
    }

    [Fact]
    public async Task A_malformed_sku_is_rejected()
    {
        var response = await _api.ClientAs("staff").PostJsonAsync("/api/items", new { name = "Saw", category = "Tools", sku = "saw 1", totalStock = 1 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Sku", (await response.ReadAsync<Problem>()).Errors!.Keys);
    }

    [Fact]
    public async Task Admins_retire_items_which_then_leave_the_default_list()
    {
        var item = await CreateItemAsync("Old projector", "PRJ-1");

        Assert.Equal(HttpStatusCode.Forbidden, (await _api.ClientAs("staff").DeleteAsync($"/api/items/{item.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _api.ClientAs("admin").DeleteAsync($"/api/items/{item.Id}")).StatusCode);

        var again = await _api.ClientAs("admin").DeleteAsync($"/api/items/{item.Id}");
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("item_retired", (await again.ReadAsync<Problem>()).Code);

        var active = await (await _api.ClientAs("staff").GetAsync("/api/items")).ReadAsync<PagedResult<ItemDto>>();
        var all = await (await _api.ClientAs("staff").GetAsync("/api/items?includeRetired=true")).ReadAsync<PagedResult<ItemDto>>();
        Assert.DoesNotContain(active.Items, i => i.Id == item.Id);
        Assert.Contains(all.Items, i => i.Id == item.Id && i.IsRetired);
    }
}
