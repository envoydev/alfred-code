namespace Api.Orders;

public interface IOrderStore
{
    /// <summary>The order with this id, or null when there is none.</summary>
    Order? Find(int id);

    IReadOnlyList<Order> All();

    /// <summary>
    /// Replaces <paramref name="current"/> with <paramref name="next"/> (same id) only if the stored order is still
    /// <paramref name="current"/>; false when another change landed first.
    /// </summary>
    bool TryReplace(Order current, Order next);
}
