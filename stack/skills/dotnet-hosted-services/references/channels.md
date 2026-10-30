# Queue-backed work with Channels

When one part of the app produces work and a background worker consumes it *in the same process*, use a `System.Threading.Channels` channel as the in-memory queue - a bounded `Channel<T>` registered as a singleton, written by the producer, drained by a `BackgroundService`:

```csharp
var channel = Channel.CreateBounded<WorkItem>(
    new BoundedChannelOptions(capacity: 100) { FullMode = BoundedChannelFullMode.Wait });

protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    await foreach (var item in _channel.Reader.ReadAllAsync(stoppingToken))
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // handle item
    }
}
```

Prefer a **bounded** channel so a runaway producer applies backpressure instead of growing the queue until the process runs out of memory. `ReadAllAsync` with the stopping token drains until shutdown. This skill only fixes that an in-process producer/consumer split belongs on a channel drained by a hosted service. The hard boundary: this is for work that stays inside one process. The moment the work must survive a restart, cross a process boundary, or be delivered at-least-once, it is not a channel - it is a broker, and that is the broker-messaging skill's, where installed. Do not build a durability story on top of an in-memory channel.
