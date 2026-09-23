namespace LendingDesk.Domain.Members;

public enum MemberStatus
{
    Active,
    Suspended,
}

public sealed class Member
{
    public int Id { get; set; }

    public required string Name { get; set; }

    public required string Email { get; set; }

    public MemberStatus Status { get; set; } = MemberStatus.Active;

    public DateTimeOffset CreatedAt { get; set; }

    public void Suspend()
    {
        if (Status == MemberStatus.Suspended)
        {
            throw new DomainException("member_suspended", $"Member {Id} is already suspended.");
        }

        Status = MemberStatus.Suspended;
    }
}
