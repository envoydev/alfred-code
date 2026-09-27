---
name: dotnet-hosted-services
description: "Use when writing a worker service, a `BackgroundService` or `IHostedService`, a periodic job, a bot or daemon host, or any in-process background task hung off the generic host. .NET hosted-service and worker conventions, floored at .NET 8 / C# 12, with the 24/7 detail in `references/`. Do NOT use for the broker side of a consumer - the delivery contract, idempotency and retry policy are the messaging skill's, though the consumer's host process is still this skill - nor for HTTP endpoints or reactive in-memory streams."
---

# .NET hosted services - background work on the generic host

This skill owns the host a long-running task runs inside: how the work is registered, which base type to derive from, what happens when it throws, how it reaches a scoped dependency, how it loops, and how it stops cleanly. It stops at the host boundary. When the work is *driven by a broker* - a queue consumer, an outbox relay, a saga - the delivery contract, idempotency, and retry policy are the broker-messaging skill's (where installed); this skill only owns the host process those consumers happen to live in. The HTTP service around an in-process background task is the web hub skill's (the ASP.NET Core cross-cutting baseline). The general concurrency mechanics - awaiting without deadlock, cancellation threading, `SemaphoreSlim` / `Interlocked`, `Channel<T>` basics, bounded parallelism - are the `csharp` language baseline's; what the worker loop adds on top of them is in the trap section below. Floor is .NET 8 / C# 12; anything newer is marked optional.

## The two host shapes

There is one hosting model and two ways to enter it. Pick by what the process *is*.

A standalone worker - no HTTP surface, just background work - is a worker binary. The project uses the `Microsoft.NET.Sdk.Worker` SDK and `Host.CreateApplicationBuilder`:

```csharp
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<IngestWorker>();
var host = builder.Build();
host.Run();
```

`Host.CreateApplicationBuilder` (the post-.NET-6 linear builder, preferred over the old `CreateDefaultBuilder`/callback style) wires configuration, logging, and DI the same way the web host does - the hosted services you register run under the same lifecycle.

A background task that belongs to a web app is the same `AddHostedService<T>()` call against `WebApplicationBuilder.Services`. Do not stand up a second process for work that shares the web app's configuration and DI:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHostedService<OutboxFlushWorker>();
```

Both register an `IHostedService` in the DI container; the host starts every registered one on startup and stops them on shutdown. Register a worker as a singleton via `AddHostedService` - never resolve and start one yourself.

## Hosting as a Windows Service

A worker that runs under the Windows Service Control Manager is the same worker binary - this one hosting model, unchanged. Everything SCM: `AddWindowsService` and the dual-mode binary, start/stop budgets, non-zero exits so recovery actions fire, the System32 working-directory trap, install/accounts/hardening, and the legacy `ServiceBase` maintenance shape - is the Windows Service skill's (the one covering the Service Control Manager layer over this host); load it WITH this one whenever the worker targets the SCM. Without it, the floors: call `AddWindowsService()`, anchor file paths on `AppContext.BaseDirectory` (the SCM starts the process in System32), keep `HostOptions.ShutdownTimeout` under the SCM's ~30s stop budget, and exit non-zero on a fatal error so `sc.exe failure` recovery restarts the service - a clean stop never does.

## Which base type: IHostedService, BackgroundService, IHostedLifecycleService

- **`BackgroundService`** is the default. It is the abstract base for a long-running task: override one method, `ExecuteAsync(CancellationToken)`, and the framework calls it on start and signals the token on stop. Reach for it for essentially all continuous or looping work.
- **`IHostedService`** directly - implementing `StartAsync`/`StopAsync` yourself - only when there is no long-running loop: a one-shot startup action, registering and unregistering a resource, a fire-and-configure step. A common mistake is to do real work *inside* `StartAsync`; that method must return quickly, because the host awaits every service's `StartAsync` in sequence before the app is considered started. Block there and you stall startup. Long work goes in `ExecuteAsync`, which the host does not await.
- **`IHostedLifecycleService`** (.NET 8+, so on the floor) adds four finer hooks - `StartingAsync`/`StartedAsync`/`StoppingAsync`/`StoppedAsync` - that bracket the ordinary `StartAsync`/`StopAsync`. The full order is StartingAsync -> StartAsync -> StartedAsync, then StoppingAsync -> StopAsync -> StoppedAsync. Implement it (often on a `BackgroundService` subclass) only when you genuinely need to run code *before all* services start or *after all* have stopped - a pre-flight check, a post-shutdown flush. Most workers need none of it.

## The ExecuteAsync unobserved-exception trap

This is the single most important thing about `BackgroundService`. `ExecuteAsync` returns a `Task`. If your override lets an exception escape, the host does not crash at the throw site - the exception is captured into that returned task, and what happens next is governed by `HostOptions.BackgroundServiceExceptionBehavior`:

- **`StopHost`** is the default (since .NET 6). The exception is logged, and then the *entire host stops* - every other service goes down with it. One unhandled fault in one worker takes the whole process with it.
- **`Ignore`** logs the exception and lets the host keep running - but the faulted worker is now *gone*. It does not restart. The process stays up looking healthy while the background work it was doing has silently stopped forever. This is the classic trap: a worker that 'mysteriously stopped' days ago because something threw once and the behavior was set to `Ignore`.

Neither default is 'keep working'. So own the failure explicitly. Wrap the body in a `try`/`catch` and decide, per exception, whether to log-and-continue or let it propagate:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (!stoppingToken.IsCancellationRequested)
    {
        try
        {
            await DoOneCycleAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            break;                       // normal shutdown - swallow and exit
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ingest cycle failed; continuing");
            // transient: log and loop. fatal: rethrow to stop the host.
        }
    }
}
```

Catch `OperationCanceledException` only when the stopping token actually requested it - that distinguishes a clean shutdown from a real timeout. For a worker whose failure *should* take the process down (so an orchestrator restarts it), let the exception propagate and leave the behavior on `StopHost`. The wrong move is to do neither and discover the silent stop in production.

Two worker-loop consequences of the same trap:

- **Never `async void` in a worker.** In a 24/7 process an `async void` exception is not an abstract leak: it escapes to the thread pool with no caller to catch it and kills the host at an arbitrary later moment. Every worker entry point returns `Task` and funnels its failures into the handling above.
- **No `ConfigureAwait(false)` inside the body.** A `BackgroundService` body captures no `SynchronizationContext`, so it needs none of its own and the sync-over-async deadlock cannot bite there - but a reusable library the worker calls still follows the `csharp` library rule.

## Scoped services from a singleton host - the captive-dependency pitfall

A `BackgroundService` is a singleton. Inject a scoped service (an EF Core `DbContext`, a per-request repository) into its constructor and you capture it for the entire process lifetime - a captive dependency. The `DbContext` is never disposed, accumulates tracked entities, and is shared unsafely across every loop iteration. Do not do it.

Inject `IServiceScopeFactory` instead and open a fresh scope per unit of work - one per loop iteration, so each cycle gets a clean `DbContext` that is disposed at the end of the cycle:

```csharp
public sealed class IngestWorker(IServiceScopeFactory scopeFactory, ILogger<IngestWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var repo = scope.ServiceProvider.GetRequiredService<IOrderRepository>();
            await repo.ProcessPendingAsync(stoppingToken);
        }
    }
}
```

`CreateAsyncScope` (over `CreateScope`) so the scope's `IAsyncDisposable` services dispose correctly. Only singletons - the logger, the scope factory, the `TimeProvider` - belong in the constructor; everything scoped is resolved from the scope.

## Periodic work: PeriodicTimer, not a Task.Delay loop

For work on a fixed cadence, use `PeriodicTimer` rather than a hand-rolled `await Task.Delay(interval)` loop. `Task.Delay` measures from the moment it is called, so the period drifts by however long each cycle took; `PeriodicTimer.WaitForNextTickAsync` ticks on a true interval and takes the cancellation token directly, so shutdown is immediate rather than waiting out the current delay:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
    while (await timer.WaitForNextTickAsync(stoppingToken))
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // ... one cycle, threading stoppingToken through
    }
}
```

`WaitForNextTickAsync` returns `false` only when the timer is *disposed*; when the stopping token cancels it throws `OperationCanceledException` (the returned task enters the canceled state). That is the expected shutdown path - the host recognizes a stopping-token cancellation and treats it as a clean stop, not a fault, so the loop ends on shutdown with no extra handling. Be aware it does not overlap ticks: if a cycle runs longer than the interval, the next tick fires immediately after, never concurrently. Get the interval from configuration via the options pattern, not a literal. Derive any timestamps from an injected `TimeProvider`, never `DateTime.Now` - see `csharp`.

## Graceful shutdown

Shutdown is cooperative - the host signals, your code must respond. Honor the signal in three places:

- **The stopping token.** When the host stops, it cancels the `CancellationToken` passed to `ExecuteAsync` (and `StopAsync`). Check `IsCancellationRequested` in every loop and thread the token into every async call so an in-flight operation is asked to wind down. A worker that ignores the token blocks shutdown until the timeout below forces it.
- **`StopAsync`.** Override it to release resources or finish a final flush. The host awaits it. The total time it allows across all services is `HostOptions.ShutdownTimeout`, which defaults to 30 seconds; raise it (`builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60))`) only if a clean drain genuinely needs longer, and never let `StopAsync` run unbounded.
- **`IHostApplicationLifetime`** when a worker must *itself* request shutdown - a fatal config error, a completed one-shot job. Inject it and call `StopApplication()`; register on `ApplicationStopping` to run last-gasp cleanup. This is how a worker ends the process deliberately rather than by throwing.
- **Explicit signal handling is rarely needed** - the host already maps `SIGTERM`/`SIGINT` to this graceful shutdown; shutdown side-effects (`PosixSignalRegistration`) and the full systemd / container / Kubernetes signal-and-drain contract are `references/deployment-and-observability.md`.

The contract is simple: cancel propagates in, the work drains within the timeout, the host exits. Code that does not observe the token is the reason a shutdown hangs.

Verify it, do not assume it: stop the host and confirm the loop exits before `ShutdownTimeout` elapses - quote the elapsed time and the exit code. A hang here is the stopping token not being observed. The remaining `HostOptions` lifecycle knobs (`StartupTimeout`, `ServicesStartConcurrently`/`ServicesStopConcurrently`) are `references/deployment-and-observability.md`.

## Queue-backed work with Channels

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

Prefer a **bounded** channel so a runaway producer applies backpressure instead of growing the queue until the process runs out of memory. `ReadAllAsync` with the stopping token drains until shutdown. The channel mechanics - readers, writers, completion, backpressure modes - are the `csharp` language baseline's; this skill only fixes that an in-process producer/consumer split belongs on a channel drained by a hosted service. The hard boundary: this is for work that stays inside one process. The moment the work must survive a restart, cross a process boundary, or be delivered at-least-once, it is not a channel - it is a broker, and that is the broker-messaging skill's, where installed. Do not build a durability story on top of an in-memory channel.

## Running it 24/7 - the references

The host is the engine; a worker or bot that stays up for weeks also has to survive its own I/O and schedule (deployment and signals are already cited at their step above):

- **`references/resilience-and-io.md`** - outbound I/O hardening the web hub would give a service but does not reach a console host: `HttpClient`/socket-exhaustion (singleton + `SocketsHttpHandler`, or `IHttpClientFactory`), Polly v8 resilience pipelines, `System.Threading.RateLimiting`, and raw `ClientWebSocket` reconnect/backoff/re-subscribe.
- **`references/scheduling-and-coordination.md`** - when a plain loop is not enough: the Hangfire / Quartz.NET / Coravel decision, and single-instance leader election (RedLock.net / SQL lock, with the idempotency caveat).
- **`references/newer-versions.md`** - what .NET 10 and .NET 11 change about `ExecuteAsync` and about a failed worker's exception. Read it before assuming a newer runtime behaves like the .NET 8 floor above.
