namespace LendingDesk.Api.Contracts;

public sealed record OverdueRowDto(int LoanId, string ItemName, string MemberName, DateOnly DueDate, int DaysOverdue);
