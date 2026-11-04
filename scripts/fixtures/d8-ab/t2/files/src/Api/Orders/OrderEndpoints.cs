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

        return app;
    }
}
