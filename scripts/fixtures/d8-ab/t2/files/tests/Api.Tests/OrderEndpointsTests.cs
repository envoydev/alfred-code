using System.Net;
using System.Net.Http.Json;
using Api.Orders;

namespace Api.Tests;

public sealed class OrderEndpointsTests
{
    [Fact]
    public async Task Get_returns_the_order_with_its_status_as_text()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs(null).GetAsync("/orders/2");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"Shipped\"", body);
    }

    [Fact]
    public async Task Get_of_an_unknown_order_is_404()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs(null).GetAsync("/orders/999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task List_returns_every_order_by_id()
    {
        await using var factory = new ApiFactory();
        var orders = await factory.ClientAs(null).GetFromJsonAsync<List<Order>>("/orders", Json.Options);

        Assert.NotNull(orders);
        Assert.Equal([1, 2, 3, 4, 5], orders.Select(o => o.Id));
    }
}
