---
name: dotnet-hosted-services
description: "Use when writing a worker service, a `BackgroundService` or `IHostedService`, a periodic job, a bot or daemon host, or any in-process background task hung off the generic host. .NET hosted-service and worker conventions, floored at .NET 8 / C# 12, with the 24/7 detail in `references/`. Do NOT use for the broker side of a consumer - the delivery contract, idempotency and retry policy are the messaging skill's, though the consumer's host process is still this skill - nor for HTTP endpoints or reactive in-memory streams."
---

# .NET hosted services - background work on the generic host

The host a long-running task runs inside: how the work is registered, which base type it derives from, what happens when it throws, how it reaches a scoped dependency, how it loops, and how it stops cleanly. It stops at the host boundary: broker-driven delivery, idempotency and retry are the broker-messaging skill's (where installed), the HTTP service around an in-process task is the web hub's, and the general concurrency mechanics are the `csharp` baseline's. Floor .NET 8 / C# 12.

**Each rule below is one line; `references/hosting-in-full.md` carries it with its reason and worked code - read it before writing a new worker, a loop, or a shutdown path.**

## The rules

- **Host shape:** a standalone worker is a `Microsoft.NET.Sdk.Worker` binary on `Host.CreateApplicationBuilder`; a web app's background task is `AddHostedService<T>()` on the web builder - never a second process for work that shares its config and DI, never a hosted service resolved and started by hand.
- **Windows Service:** the same worker, with the Windows Service skill (the Service Control Manager layer) loaded WITH this one; without it, the floors - `AddWindowsService()`, paths anchored on `AppContext.BaseDirectory`, `HostOptions.ShutdownTimeout` under the SCM's ~30s, a non-zero exit on a fatal error.
- **Base type:** `BackgroundService` by default; `IHostedService` only for a one-shot start step (`StartAsync` returns quickly - the host awaits every one in sequence); `IHostedLifecycleService` only for code before all services start or after all stop.
- **The `ExecuteAsync` trap:** an escaped exception either stops the whole host (`StopHost`, the default) or silently ends the worker forever (`Ignore`). Own the failure: a `try` / `catch` per cycle, `OperationCanceledException` caught only `when (stoppingToken.IsCancellationRequested)`, a fatal fault rethrown so an orchestrator restarts the process. Never `async void`; no `ConfigureAwait(false)` in the body.
- **Scoped dependencies:** a worker is a singleton - never a `DbContext` or other scoped service in its constructor. Inject `IServiceScopeFactory` and `CreateAsyncScope()` once per unit of work.
- **Periodic work:** `PeriodicTimer.WaitForNextTickAsync(stoppingToken)`, never a `Task.Delay` loop; the interval from options, timestamps from an injected `TimeProvider`.
- **Shutdown:** thread the stopping token into every call and check it every loop; `StopAsync` releases and flushes within `HostOptions.ShutdownTimeout` (30s by default, raised only for a real drain); `IHostApplicationLifetime.StopApplication()` when the worker itself ends the process. Prove it: stop the host and quote the elapsed time and the exit code.
- **In-process queues:** a bounded `Channel<T>` singleton drained by a `BackgroundService` with `ReadAllAsync(stoppingToken)` - only for work that stays in one process; anything that must survive a restart or cross a process is a broker.

## Running it 24/7

- `references/resilience-and-io.md` - outbound I/O hardening a console host lacks: `HttpClient` lifetime, Polly v8, rate limiting, `ClientWebSocket` reconnect.
- `references/scheduling-and-coordination.md` - Hangfire / Quartz.NET / Coravel, and single-instance leader election.
- `references/deployment-and-observability.md` - the systemd / container / Kubernetes signal-and-drain contract and the remaining `HostOptions` knobs.
- `references/newer-versions.md` - what .NET 10 and 11 change about `ExecuteAsync` and a failed worker's exception; read it before assuming a newer runtime behaves like the floor.
