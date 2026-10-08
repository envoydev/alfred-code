# Deploying and observing a headless worker

Host integration (signals, the service manager, the container) and the observability a worker needs without an HTTP surface. The container image build and the CI pipeline are the CI-and-deploy skill's; allocation- and serialization-level performance design is `dotnet-performance`; this note owns the deployment-time runtime knobs (GC mode, AOT, signals) and observability specific to a long-running host process.

## Signals and shutdown

The Generic Host already maps `SIGTERM` and `SIGINT` to a graceful shutdown - the stopping token fires, `StopAsync` runs, the host drains within `HostOptions.ShutdownTimeout`. Do not re-implement that. Reach for explicit signal handling only for a side-effect on shutdown:

- **`PosixSignalRegistration.Create(PosixSignal.SIGTERM, ctx => { ... })`** (cross-platform, .NET 6+) over `Console.CancelKeyPress`, which catches only Ctrl+C (`SIGINT`), runs on a thread-pool thread, races host shutdown, and needs `ctx.Cancel = true` to avoid immediate termination.
- Do **not** rely on `AppDomain.ProcessExit` for async cleanup - it has no `await` and a tight time budget.

## Kubernetes shutdown contract

The .NET process must *receive* `SIGTERM` (.NET maps it to graceful host shutdown) - which means running as **PID 1**, or behind an init shim (`tini`, or the container runtime's `--init`) that forwards the signal (the CI-and-deploy skill owns the image). Kubernetes runs the `preStop` hook, then sends `SIGTERM`, waits `terminationGracePeriodSeconds` (default 30s), then `SIGKILL`. Two rules follow:

- Use a `preStop` sleep (e.g. `sleep 15`) to let endpoint / load-balancer deregistration propagate before `SIGTERM` arrives, so in-flight work is not routed to a draining pod.
- Set `HostOptions.ShutdownTimeout` **less than** `terminationGracePeriodSeconds` *minus* that preStop sleep, so the host finishes draining before `SIGKILL` - the sleep eats into the same budget.

## Service-manager integration

- **systemd.** Add `Microsoft.Extensions.Hosting.Systemd` and call `builder.Services.AddSystemd()` (no-ops when not under systemd). Use `Type=notify` in the unit so the host signals readiness (`READY=1`) and `STOPPING=1` via sd_notify; logs map to journald priorities, so `journalctl -p 3` filters errors. Set the unit to restart on failure.
- **Windows Service.** The whole SCM layer - `AddWindowsService`, the System32 working-directory trap, non-zero exits for recovery, install scripts, service accounts and hardening - is the Windows Service skill's (the SCM layer over this host); load it when the worker targets the SCM, and without it apply the floors under 'Hosting as a Windows Service' in `SKILL.md`.

## Containers

The SDK publishes an OCI image with no Dockerfile - `dotnet publish /t:PublishContainer` (in the SDK from 8.0.200; a worker/console project also needs `<EnableSdkContainerSupport>true`). The build invocation, the `ContainerFamily` choice, and the CI that ships the image are the CI-and-deploy skill's; what matters for the *host* running inside it:

- **Non-root by default** - the `app` user, UID 1654, exposed as `$APP_UID`; set `USER` by that UID (not by name) so Kubernetes `runAsNonRoot` is satisfied.
- **Run on a chiseled (distroless) runtime image** for the smallest attack surface - no shell, no package manager. Chiseled images omit ICU and tzdata unless you use the `-extra` variant, so a worker that formats cultures or converts time zones needs the extra family or `InvariantGlobalization` set deliberately.
- **PID 1, or an init shim** so the process receives `SIGTERM` - see the shutdown contract above.

## GC and AOT in a long-running process

- **GC mode.** DATAS (Dynamic Adaptation To Application Sizes) is on by default from .NET 9 - it shrinks the heap when load drops, which makes HPA / KEDA autoscaling metrics trustworthy for a bursty worker in a memory-limited container. Server GC (parallel per-CPU heaps) suits a single dominant latency-sensitive process such as a trading bot; Workstation GC suits many co-located processes. Server GC is **not** the container default - opt in with `<ServerGarbageCollection>true`. Cap the heap under a cgroup limit with `GCHeapHardLimit`, and disable DATAS on a measured throughput regression with `DOTNET_GCDynamicAdaptationMode=0`. The allocation- and type-layout design that decides whether any of this is worth tuning is `dotnet-performance`.
- **Native AOT** shrinks startup and footprint but has hard limits: no dynamic assembly loading, no `Reflection.Emit`, requires trimming, must be self-contained; `System.Text.Json` needs its source generator and EF Core is not AOT-friendly on the .NET 8 floor (dynamic LINQ / query syntax). Reach for it only when startup time or memory dominate and there is no EF Core / reflection dependency; otherwise ReadyToRun and TieredPGO are the lower-risk levers.

## Observability without an HTTP surface

A worker has no Kestrel, so the web hub's observability wiring does not apply. Cover it directly:

- **Health checks.** Add `Microsoft.Extensions.Diagnostics.HealthChecks` and either expose a tiny Kestrel endpoint just for `/health` and `/alive`, or push liveness to the orchestrator another way. `.NET Aspire`'s `AddServiceDefaults()` bundles OpenTelemetry, health endpoints, service discovery, and a standard resilience handler in one call - for a non-web worker, factor a custom ServiceDefaults class library so you get the bundle without an ASP.NET Core framework reference (the Aspire skill, where installed).
- **Structured logging.** Use the `[LoggerMessage]` source generator for hot-path logs - it removes boxing and runtime template parsing, builds in the `IsEnabled` check, satisfies analyzer CA1848, and takes more than the six parameters `LoggerMessage.Define` caps at (the source-generators skill, where installed).
- **Telemetry.** Instrument with `ActivitySource` (traces) and `System.Diagnostics.Metrics.Meter` (metrics), export over OTLP. Alert on the signals that mean a worker is quietly broken: restart count, queue depth, gateway reconnect rate, and GC heap size.

## Bounding and parallelizing the lifecycle

`IHostedLifecycleService` (.NET 8+, so on the floor) adds four finer hooks - `StartingAsync`/`StartedAsync`/`StoppingAsync`/`StoppedAsync` - that bracket the ordinary `StartAsync`/`StopAsync`. The full order is StartingAsync -> StartAsync -> StartedAsync, then StoppingAsync -> StopAsync -> StoppedAsync. Implement it (often on a `BackgroundService` subclass) only when you genuinely need to run code *before all* services start or *after all* have stopped - a pre-flight check, a post-shutdown flush. Most workers need none of it.

`HostOptions` bounds and parallelizes the lifecycle beyond `ShutdownTimeout`. On the .NET 8 floor it exposes `StartupTimeout` - the mirror of `ShutdownTimeout`, bounding total start time - and `ServicesStartConcurrently`/`ServicesStopConcurrently`, which start and stop hosted services in parallel instead of the default sequential registration order. Reach for the concurrent options only when several services each have a slow `StartAsync`/`StopAsync` and the serial sum stalls the host; parallel start drops the ordering guarantee, so leave them off otherwise.
