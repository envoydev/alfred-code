using LendingDesk.Domain.Items;
using LendingDesk.Domain.Members;

namespace LendingDesk.Domain.Loans;

public enum LoanState
{
    Active,
    Returned,
    Overdue,
}

public sealed class Loan
{
    public int Id { get; set; }

    public int ItemId { get; set; }

    public Item Item { get; set; } = null!;

    public int MemberId { get; set; }

    public Member Member { get; set; } = null!;

    public DateOnly StartDate { get; set; }

    public DateOnly DueDate { get; set; }

    public DateTimeOffset? ReturnedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public LoanState StateOn(DateOnly today) =>
        ReturnedAt is not null ? LoanState.Returned
        : DueDate < today ? LoanState.Overdue
        : LoanState.Active;

    public void Return(DateTimeOffset at)
    {
        if (ReturnedAt is not null)
        {
            throw new DomainException("loan_already_returned", $"Loan {Id} was already returned.");
        }

        ReturnedAt = at;
    }
}
