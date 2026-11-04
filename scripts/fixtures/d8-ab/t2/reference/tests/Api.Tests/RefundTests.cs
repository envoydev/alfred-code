using System.Net;
using Api.Orders;

namespace Api.Tests;

public sealed class RefundTests
{
    [Fact]
    public async Task Refunding_an_unknown_order_is_404()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs(OrderPolicies.RefundsApproverRole).PostAsync("/orders/999/refund", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_order_is_still_401_for_an_anonymous_caller()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs(null).PostAsync("/orders/999/refund", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public void A_refund_that_loses_a_race_is_a_conflict()
    {
        var store = new InMemoryOrderStore();
        var order = store.Find(1)!;
        Assert.True(store.TryReplace(order, order with { Status = OrderStatus.Refunded }));

        Assert.False(store.TryReplace(order, order with { Status = OrderStatus.Refunded }));
    }

    [Fact]
    public void Refund_leaves_the_other_orders_alone()
    {
        var store = new InMemoryOrderStore();

        var result = OrderEndpoints.Refund(4, store);

        Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.Ok<Order>>(result.Result);
        Assert.Equal(OrderStatus.Refunded, store.Find(4)!.Status);
        Assert.All(store.All().Where(o => o.Id != 4), o => Assert.NotEqual(OrderStatus.Refunded, o.Status));
    }
}
