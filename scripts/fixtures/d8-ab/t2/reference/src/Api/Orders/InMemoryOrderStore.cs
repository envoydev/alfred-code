using System.Collections.Concurrent;

namespace Api.Orders;

/// <summary>The orders, held in memory for the life of the process and seeded with a few samples.</summary>
public sealed class InMemoryOrderStore : IOrderStore
{
    private readonly ConcurrentDictionary<int, Order> orders = new();

    public InMemoryOrderStore()
    {
        foreach (var order in new[]
        {
            new Order(1, "Ada Lovelace", 120.00m, OrderStatus.Placed),
            new Order(2, "Alan Turing", 75.50m, OrderStatus.Shipped),
            new Order(3, "Barbara Liskov", 42.00m, OrderStatus.Shipped),
            new Order(4, "Donald Knuth", 310.25m, OrderStatus.Placed),
            new Order(5, "Grace Hopper", 100.00m, OrderStatus.Shipped),
        })
        {
            orders[order.Id] = order;
        }
    }

    public Order? Find(int id) => orders.TryGetValue(id, out var order) ? order : null;

    public IReadOnlyList<Order> All() => [.. orders.Values.OrderBy(o => o.Id)];

    public bool TryReplace(Order current, Order next)
    {
        if (current.Id != next.Id)
        {
            throw new ArgumentException("A replacement keeps the order's id.", nameof(next));
        }

        return orders.TryUpdate(next.Id, next, current);
    }
}
