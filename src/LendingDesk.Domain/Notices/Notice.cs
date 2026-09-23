using LendingDesk.Domain.Loans;

namespace LendingDesk.Domain.Notices;

public enum NoticeKind
{
    Confirmation,
    DueSoon,
    Overdue,
    ReturnReceipt,
}

/// <summary>A message sent to a member about one of their loans. Each kind is sent at most once per loan.</summary>
public sealed class Notice
{
    public long Id { get; set; }

    public int LoanId { get; set; }

    public Loan Loan { get; set; } = null!;

    public NoticeKind Kind { get; set; }

    public DateTimeOffset SentAt { get; set; }
}
