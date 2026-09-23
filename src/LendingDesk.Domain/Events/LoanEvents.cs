namespace LendingDesk.Domain.Events;

/// <summary>
/// Events the API publishes through the outbox and the worker consumes. The type names are the
/// contract between the two - a breaking change to a payload gets a new version suffix.
/// </summary>
public static class EventTypes
{
    public const string LoanCreated = "loan.created.v1";
    public const string LoanReturned = "loan.returned.v1";
}

public sealed record LoanCreated(int LoanId, int MemberId, int ItemId, DateOnly StartDate, DateOnly DueDate);

public sealed record LoanReturned(int LoanId, int MemberId, DateTimeOffset ReturnedAt);
