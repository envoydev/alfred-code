---
name: dotnet-windows-service
description: "Load when building, installing, hardening or migrating a Windows Service - AddWindowsService, sc.exe, ServiceBase, error 1053. Not for a plain worker host."
---

# Windows Services - the SCM layer

A Windows Service is the same generic-host worker the house skill covering .NET hosted services teaches (`BackgroundService`, the Generic Host, scope-per-work, the stopping token, shutdown discipline) - **load that skill first, matched from your skill list by what it covers**; when nothing matches, the host-shape rules below still apply, only their deep dive is missing. This skill owns what the Service Control Manager adds on top. The SCM does not care which runtime you use, so the operational surface below - install, accounts, recovery, paths, ACLs, budgets - is identical for modern .NET and .NET Framework; only the in-process shape differs.

**Platform verdict.** New services: current LTS .NET, Worker template, `AddWindowsService()` - there is no scenario where a greenfield service starts on .NET Framework. Existing Framework services are not a burning platform (4.8/4.8.1 is an OS component with no standalone end date) - the real migration driver is NuGet packages dropping `net48`, so audit the package graph, and migrate when you touch the service anyway; the maintained Framework shape and the migration path are `references/framework-services.md`. Topshelf is archived (July 2022) - never for new work; `AddWindowsService()` plus a scripted `sc.exe` install covers it.

## When to use

- Windows Service conventions - the Service Control Manager layer over the .NET generic host. Triggers also: UseWindowsService, installutil, service accounts.
- Covers the dual-mode binary, SCM start/stop budgets, non-zero exit codes so recovery actions actually fire, the System32 working-directory trap, scripted sc.exe install with recovery actions, gMSA / least-privilege service accounts, unquoted-path and ACL hardening, event-log source registration, and the maintained .NET Framework ServiceBase shape + migration path.
- Not for the generic worker/host model itself with no SCM target - that is the hosted-worker skill - nor for Linux daemons/systemd or containerized workers.

## AddWindowsService - what it actually does

`builder.Services.AddWindowsService(o => o.ServiceName = "...")` (or `builder.Host.UseWindowsService()` for a web app) does three things, and only when the process really runs under the SCM: installs `WindowsServiceLifetime`, points the content root at `AppContext.BaseDirectory`, and wires the Event Log provider with the app name as default source. Because it is context-aware (`WindowsServiceHelpers.IsWindowsService()`), the identical binary run from a terminal gets console lifetime and Ctrl+C - a dual-mode binary with no conditional compilation, which is also the default way to debug one.

- Target the `-windows` TFM (`net10.0-windows`) - it carries `System.ServiceProcess` interop, Event Log, and registry without package juggling.
- The content-root fix covers the HOST only: the process working directory under the SCM is still `C:\Windows\System32`, so every relative path in your own file I/O silently resolves there (config not found, logs in System32). Anchor your own paths on `AppContext.BaseDirectory` / `IHostEnvironment.ContentRootPath`, never the current directory. With single-file publish, verify resolution after switching publish modes - `AppContext.BaseDirectory` can point at an extraction directory.
- ASP.NET Core inside a service is supported (internal/loopback endpoints co-located with background work); set `ContentRootPath = AppContext.BaseDirectory` explicitly when `IsWindowsService()`. A public-facing API belongs behind IIS or a reverse proxy, not in a service.

## The SCM contract - budgets and recovery

- **~30 seconds** to acknowledge a start or stop, machine-wide (`ServicesPipeTimeout`). Keep `StartAsync` short, set `HostOptions.ShutdownTimeout` UNDER the window (e.g. 25s), and design work as small resumable units that check cancellation between items and checkpoint progress - raising the machine-wide timeout affects every service on the box and is a documented-in-the-runbook last resort, never the fix.
- **Recovery actions fire only on a non-zero exit code.** The default `BackgroundServiceExceptionBehavior.StopHost` stops the host CLEANLY on an unhandled exception - the SCM sees a clean stop and will NOT restart it (.NET 8-10; from .NET 11 the host's `RunAsync` rethrows the worker's exception and the process exits non-zero - keep the explicit `Environment.Exit(1)` while the floor is .NET 8). On a fatal error, log and `Environment.Exit(1)` so `sc.exe failure` recovery applies; catch `OperationCanceledException` silently and exit zero on a normal stop. This trips people constantly - decide it per loop, deliberately.
- Current LTS behavior note: since .NET 10 the whole of `ExecuteAsync` runs on a background thread - the pre-first-`await` startup-blocking trap (and its `Task.Yield()` workaround) is gone; on .NET 8/9 keep the yield.

## Install, identity, hardening

The full scripted install, upgrade flow, secrets ranking, and diagnostics are `references/operations.md`; the non-negotiables:

- **Scripted `sc.exe` install** (installutil does not exist for modern .NET): quoted binpath, delayed-auto start, `depend=` on real dependencies (the database instance), a description, and `sc.exe failure` recovery actions. Idempotent, in CI, identical for both runtimes. Run it against a real machine only on the user's word - one AskUserQuestion naming the machine, since it needs admin and rewrites the SCM database.
- **Identity**: a gMSA (`DOMAIN\name$`, no password, auto-rotated) or a dedicated least-privilege account with 'Log on as a service' - never `LocalSystem` (it is admin). `LocalService` / `NetworkService` are fine for low-privilege work.
- **Unquoted service path** is a real privilege-escalation class: a binpath with spaces and no quotes lets `C:\Program.exe` run with service privileges. Always quote; keep the install directory non-writable by non-admins; check `sc sdshow` that non-admins cannot reconfigure the service.
- **Event-log source registered at install time** - creating one needs admin rights, so first-log-write registration fails under a least-privilege account.
- No plaintext secrets in config, source control, or environment variables (env vars are unencrypted and land in crash dumps) - the ranked options (Key Vault, Data Protection with explicit key encryption, DPAPI LocalMachine) are in the operations reference.

**Verify the install landed** by reading the SCM's own record back - the install script's exit code proves only that `sc.exe` parsed its arguments:

```text
sc qc <name>        -> BINARY_PATH_NAME quoted, SERVICE_START_NAME the intended account, START_TYPE 2 DELAYED
sc qfailure <name>  -> the recovery actions you scripted, not "RESTART -- Delay = 0 msec" defaults
```

Either output missing its expected line means the install did not take - fix the script and re-run before hardening anything else.

## A service that is RUNNING but stuck

The failure mode monitoring misses: the SCM says RUNNING while the loop is wedged. Emit a heartbeat and a throughput metric and alert on 'no progress in N minutes' - the SCM state is not health. Dead-letter poison items after N attempts so one bad record cannot wedge the loop, and guard single-instance with a named mutex or a distributed lock.

## When a Windows Service is the wrong answer

A service earns its place when the host is the constraint: a specific Windows box you control, local hardware/COM access, boot-time start with no user logged in, customer-hosted deployments. Short periodic work with no resident process is Windows Task Scheduler; cloud/Linux targets and horizontal scale are containerized workers; run-to-completion or event-driven units are container jobs or Functions. If it can be a stateless queue- or timer-triggered unit in the cloud, the service is the more expensive way to run it.
