namespace LendingDesk.Domain;

/// <summary>A lending rule was broken. <see cref="Code"/> is stable and safe to show to clients.</summary>
public sealed class DomainException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
