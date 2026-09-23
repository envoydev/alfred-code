namespace LendingDesk.Api.Auth;

public static class Roles
{
    public const string Member = "member";
    public const string Staff = "staff";
    public const string Admin = "admin";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Member, Staff, Admin };
}

public static class Policies
{
    /// <summary>Front-desk work: lending, returning, editing the catalogue and member records.</summary>
    public const string Staff = "staff";

    /// <summary>Destructive or account-level actions.</summary>
    public const string Admin = "admin";
}
