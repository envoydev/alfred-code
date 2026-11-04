using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Orders;

public static class OrderEndpoints
{
    public static IEndpointRouteBuilder MapOrders(this IEndpointRouteBuilder app)
    {
        var orders = app.MapGroup("/orders");

        orders.MapGet("/", (IOrderStore store) => TypedResults.Ok(store.All()));

        orders.MapGet("/{id:int}", Results<Ok<Order>, NotFound> (int id, IOrderStore store) =>
            store.Find(id) is { } order ? TypedResults.Ok(order) : TypedResults.NotFound());

        orders.MapPost("/{id:int}/refund", Refund).RequireAuthorization(OrderPolicies.RefundsApprover);

        return app;
    }

    /// <summary>Marks the order Refunded and returns it; 409 when it already is, 404 when there is no such order.</summary>
    public static Results<Ok<Order>, NotFound, Conflict> Refund(int id, IOrderStore store)
    {
        if (store.Find(id) is not { } order)
        {
            return TypedResults.NotFound();
        }

        if (order.Status == OrderStatus.Refunded)
        {
            return TypedResults.Conflict();
        }

        var refunded = order with { Status = OrderStatus.Refunded };
        return store.TryReplace(order, refunded) ? TypedResults.Ok(refunded) : TypedResults.Conflict();
    }
}
