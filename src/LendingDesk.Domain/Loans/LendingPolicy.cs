using LendingDesk.Domain.Items;

namespace LendingDesk.Domain.Loans;

public static class LendingPolicy
{
    public const int MaxLoanDays = 28;

    /// <summary>Throws when a new loan of <paramref name="item"/> breaks a lending rule.</summary>
    /// <param name="copiesOut">How many copies of the item are already lent out over the requested period.</param>
    public static void EnsureCanLend(Item item, DateOnly startDate, DateOnly dueDate, DateOnly today, int copiesOut)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (item.IsRetired)
        {
            throw new DomainException("item_retired", $"Item {item.Id} is retired and cannot be lent.");
        }

        if (item.Condition == ItemCondition.Damaged)
        {
            throw new DomainException("item_damaged", $"Item {item.Id} is damaged and cannot be lent until it is repaired.");
        }

        if (startDate < today)
        {
            throw new DomainException("start_in_past", "A loan cannot start in the past.");
        }

        if (dueDate < startDate)
        {
            throw new DomainException("due_before_start", "The due date is before the start date.");
        }

        if (dueDate.DayNumber - startDate.DayNumber > MaxLoanDays)
        {
            throw new DomainException("loan_too_long", $"A loan can last at most {MaxLoanDays} days.");
        }

        if (copiesOut >= item.TotalStock)
        {
            throw new DomainException("item_unavailable", $"No copy of item {item.Id} is free for those dates.");
        }
    }

    public static bool Overlaps(DateOnly startA, DateOnly endA, DateOnly startB, DateOnly endB) =>
        startA <= endB && startB <= endA;
}
