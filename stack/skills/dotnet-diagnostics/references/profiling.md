# Profiling a live .NET process

Where a running CoreCLR process spends its time - 'my app is slow', high CPU, a request that got slower - read in two steps: the counters say WHAT is hot (CPU, GC, thread pool, exceptions), then a sampled trace says WHERE in the code. When to profile at all (measure first) lives in `SKILL.md`. Both tools ship as .NET tools and attach to a process by id or name; .NET Framework and NativeAOT are out of scope.

## Install

```bash
dotnet tool install -g dotnet-counters
dotnet tool install -g dotnet-trace
dnx dotnet-counters monitor -n MyApp      # SDK 10.0.100+: runs the tool once, no install
```

A repo that pins its tools keeps them in the local tool manifest instead (the skill covering .NET local tools, where installed). Both tools must run as the same user as the target process (or root), and on Linux and macOS share its `TMPDIR`.

## 1. Counters first - what is hot

```bash
dotnet-counters ps                                   # list .NET processes
dotnet-counters monitor -n MyApp --showDeltas        # System.Runtime by default
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
```

On .NET 9+ the runtime meter names read `dotnet.process.cpu.time`, `dotnet.gc.*`, `dotnet.thread_pool.*`; an app on .NET 8 or lower shows the older EventCounters (`System.Runtime[cpu-usage,time-in-gc,threadpool-queue-length]`). Read the deltas while the slow path runs:

| What moves | Points at |
|---|---|
| CPU time high while the slow path runs | CPU-bound code - take the trace below |
| GC pause time or gen-2 collections climbing | allocation pressure - a `--profile gc-verbose` trace below |
| thread-pool queue growing, CPU low | blocking on a pool thread (sync over async, a lock) - a dump's `clrstack -all` (`references/dumps.md`) |
| CPU low, latency high, queue flat | I/O wait - the database or the network, not this process |

`dotnet-counters collect -p <pid> --format csv -o counters.csv` writes the same numbers to a file for a before / after compare.

## 2. A sampled trace - where in the code

```bash
dotnet-trace collect -p <pid> --duration 00:00:00:30          # profiles dotnet-common + dotnet-sampled-thread-time
dotnet-trace collect -p <pid> --profile gc-verbose --duration 00:00:00:30   # allocations
dotnet-trace report <file>.nettrace topN -n 15                 # top methods by exclusive time, as text
dotnet-trace report <file>.nettrace topN -n 15 --inclusive
```

- `--profile dotnet-sampled-thread-time` samples every managed thread's stack about every 1 ms, running or blocked - wall-clock time, not CPU alone. A blocked thread's frames (a `Wait`, a socket read) rank high too; read them against the counters before calling a method hot.
- The `--profile cpu-sampling` older pages name was removed from `collect`; on Linux with kernel 6.4+, root and .NET 10, `dotnet-trace collect-linux` gives true on-CPU samples with native frames.
- Capture under the same load that shows the cost, for 10-60 seconds; a trace of an idle process ranks the idle loop.
- `--format Speedscope` writes a file speedscope.app opens; Visual Studio and PerfView open the `.nettrace` on Windows. Read `report topN` first - it needs no GUI.

## The result

Quote the counters' before rows, the capture command, and the `topN` rows that carry the conclusion (method, exclusive and inclusive share), plus the same rows after the fix under the same load. Name what the trace did not cover (the load it ran under, native frames on `collect`).
