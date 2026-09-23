namespace LendingDesk.Domain.Members;

public sealed class Member
{
    public int Id { get; set; }

    public required string Name { get; set; }

    public required string Email { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
