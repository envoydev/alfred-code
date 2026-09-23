namespace LendingDesk.Domain.Items;

public sealed class Item
{
    public int Id { get; set; }

    public required string Name { get; set; }

    public required string Category { get; set; }

    public required string Sku { get; set; }

    public int TotalStock { get; set; }

    public bool IsRetired { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public void Retire()
    {
        if (IsRetired)
        {
            throw new DomainException("item_retired", $"Item {Id} is already retired.");
        }

        IsRetired = true;
    }
}
