using System.ComponentModel.DataAnnotations;
using LendingDesk.Domain.Loans;

namespace LendingDesk.Api.Contracts;

public sealed record LoanDto(
    int Id,
    int ItemId,
    string ItemName,
    int MemberId,
    string MemberName,
    DateOnly StartDate,
    DateOnly DueDate,
    DateTimeOffset? ReturnedAt,
    LoanState Status);

public sealed class LoanQuery : PageQuery
{
    [Range(1, int.MaxValue)]
    public int? MemberId { get; init; }

    public LoanState? Status { get; init; }
}

public sealed class LoanRequest
{
    [Range(1, int.MaxValue)]
    public int ItemId { get; init; }

    [Range(1, int.MaxValue)]
    public int MemberId { get; init; }

    [Required]
    public DateOnly? StartDate { get; init; }

    [Required]
    public DateOnly? DueDate { get; init; }
}
