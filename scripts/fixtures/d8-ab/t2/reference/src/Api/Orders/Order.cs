namespace Api.Orders;

public enum OrderStatus
{
    Placed,
    Shipped,
    Refunded,
}

/// <summary>One customer order; <see cref="Total"/> is in US dollars.</summary>
public sealed record Order(int Id, string Customer, decimal Total, OrderStatus Status);
