# Concurrency correctness (async, cancellation, synchronization)

The async-correctness mechanics that sit on top of this skill's style rules: how to await without deadlocking, how to thread a cancellation token to the leaves, the `Channel<T>` producer-consumer basics, and the synchronization primitives worth reaching for when shared mutable state is genuinely unavoidable. What a hosted worker loop adds on top - the unobserved-exception trap, captive scoped dependencies, `PeriodicTimer`, graceful shutdown - is the hosted-worker skill's own SKILL.md, installed where the project hosts workers.

## async/await correctness

The rules themselves are in `references/runtime-behavior.md`: async all the way up - no sync-over-async blocking with `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` - no `async void` outside event handlers, `ConfigureAwait(false)` in library code.

## On .NET Framework 4.8

On modern .NET most code runs with no `SynchronizationContext`, so the sync-over-async deadlock rarely bites. On classic ASP.NET, WPF, and WinForms a real single-threaded `SynchronizationContext` is present, so that deadlock is concrete on 4.8, not hypothetical. Why that context makes `ConfigureAwait(false)` in library code load-bearing, and what app-level code keeps the default for, is `references/net-framework-48.md` - it owns the async / `SynchronizationContext` split, and the `ValueTask` / `IAsyncEnumerable` polyfill packages 4.8 needs are covered there too.

## Cancellation propagation

A `CancellationToken` is only useful if it reaches the operation that must stop. Take one as the last parameter of every async method and pass it down the whole call chain to the leaf I/O call - a token that stops at your method boundary cancels nothing.

```csharp
public async Task ProcessAsync(Order order, CancellationToken ct)
{
    await _repo.SaveAsync(order, ct);           // thread it through
    await _bus.PublishAsync(order.Id, ct);      // ... to every await
}
```

In a loop, honor the token at the top of each iteration - `ct.ThrowIfCancellationRequested()` or a `while (!ct.IsCancellationRequested)` guard - so a long-running loop unwinds promptly instead of running to completion after cancellation was requested.

## SemaphoreSlim for async mutual exclusion

`lock` cannot span an `await` - the monitor is thread-affine and the continuation may resume on a different thread. When a critical section must `await` (an async cache refresh, a bounded number of concurrent callers), use `SemaphoreSlim` and its async `WaitAsync`. Release in a `finally` so an exception inside the section cannot leak the permit and wedge every future caller.

```csharp
private readonly SemaphoreSlim _gate = new(1, 1);   // 1,1 = async mutex

await _gate.WaitAsync(ct);
try
{
    await RefreshCacheAsync(ct);   // exclusive, and may await
}
finally
{
    _gate.Release();
}
```

Constructing it `new(n, n)` instead caps concurrency at `n` - a bounded gate in front of a downstream that only tolerates so many simultaneous calls.

## Channel&lt;T&gt; producer-consumer basics

`System.Threading.Channels` is the in-process producer-consumer primitive: producers `WriteAsync` to the writer, one or more consumers drain the reader (`await foreach (var item in reader.ReadAllAsync(ct))`). `Channel.CreateBounded<T>(capacity)` is the default choice - a full channel makes `WriteAsync` wait, which IS the backpressure that stops a fast producer from ballooning memory; `CreateUnbounded<T>` never pushes back and is only right when the producer is naturally bounded. When the producing side finishes, `writer.Complete()` (or `TryComplete(ex)` on failure) ends the consumer's `ReadAllAsync` loop cleanly - a channel nobody completes leaves the drain awaiting forever. Prefer a single drain loop as the one writer of downstream state - that serializes the mutation without a lock. Hosting that drain inside a `BackgroundService` - lifecycle, failure handling, shutdown - is the hosted-worker skill's territory, where installed.

## Interlocked and lock

For a lock-free counter or a compare-and-swap on a single word, `Interlocked` (`Increment`, `Add`, `Exchange`, `CompareExchange`) is atomic without any lock - the right tool for a shared count updated from many threads.

```csharp
private long _processed;
Interlocked.Increment(ref _processed);
```

A plain `lock` is still correct for a short, purely synchronous critical section that guards more than one field at once and never awaits. Keep the body tiny and allocate nothing inside it; the moment the section needs to `await`, switch to `SemaphoreSlim`. Before either, prefer designing shared mutable state away - an immutable snapshot, a `ConcurrentDictionary`, or serializing writes through a single consumer (a `Channel<T>` drained by one loop).

## Bounded parallelism

To fan work out across a collection with a hard cap on simultaneous operations, `Parallel.ForEachAsync` carries both the degree limit and the token in `ParallelOptions` - the right tool for I/O-bound or CPU-bound batch work.

```csharp
await Parallel.ForEachAsync(orders,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (order, token) => await ProcessOrderAsync(order, token));
```

An unbounded `Task.WhenAll(items.Select(ProcessAsync))` launches every operation at once - fine for a handful of independent calls, a way to exhaust a connection pool or hammer a downstream for a large set. When you must use `WhenAll` over many items, throttle it with a `SemaphoreSlim` acquired inside each task. Do not accumulate results into a shared `List<T>` from parallel bodies - that races; collect into a `ConcurrentBag<T>` or return each result and let `WhenAll` gather them.
