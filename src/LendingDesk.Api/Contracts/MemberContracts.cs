using System.ComponentModel.DataAnnotations;
using LendingDesk.Domain.Members;

namespace LendingDesk.Api.Contracts;

public sealed record MemberDto(int Id, string Name, string Email, MemberStatus Status, DateTimeOffset CreatedAt)
{
    public static MemberDto From(Member member) => new(member.Id, member.Name, member.Email, member.Status, member.CreatedAt);
}

public sealed class MemberQuery : PageQuery
{
    public MemberStatus? Status { get; init; }
}

public sealed class MemberRequest
{
    [Required]
    [StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Required]
    [EmailAddress]
    [StringLength(320)]
    public string Email { get; init; } = string.Empty;
}
