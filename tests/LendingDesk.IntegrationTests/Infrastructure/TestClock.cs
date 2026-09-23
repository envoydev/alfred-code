namespace LendingDesk.IntegrationTests.Infrastructure;

public sealed class TestClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = new(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);

    public DateOnly Today => DateOnly.FromDateTime(Now.UtcDateTime);

    public override DateTimeOffset GetUtcNow() => Now;
}
