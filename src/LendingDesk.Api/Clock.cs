namespace LendingDesk.Api;

internal static class Clock
{
    /// <summary>Loans are dated in UTC calendar days.</summary>
    public static DateOnly Today(this TimeProvider clock) => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
}
