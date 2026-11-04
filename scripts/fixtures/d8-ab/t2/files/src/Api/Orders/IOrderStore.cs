namespace Api.Orders;

public interface IOrderStore
{
    /// <summary>The order with this id, or null when there is none.</summary>
    Order? Find(int id);

    IReadOnlyList<Order> All();
}
