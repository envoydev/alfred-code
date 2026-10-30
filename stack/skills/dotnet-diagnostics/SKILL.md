---
name: dotnet-diagnostics
description: "Use when benchmarking a .NET hot path (BenchmarkDotNet), profiling a slow app (dotnet-trace, dotnet-counters) or debugging a crash, hang or leak (dotnet-dump)."
---

# dotnet-diagnostics (decision layer)

Three ways to put numbers on a .NET process instead of guessing: profile a live process to find where its time goes, benchmark a hot path in isolation, or capture a dump of a process that crashed, hung, or is leaking. This hub decides which one the task needs and routes to the depth - it does not restate it.

- The app is slow or burns CPU and the hot spot is unknown - counters, then a sampled trace -> `references/profiling.md`
- Time a hot path / compare two implementations -> `references/microbenchmarking.md`
- A process crashed, hung, or is leaking - capture and read a dump -> `references/dumps.md`

## When to use

- Profiles a live process with dotnet-counters and dotnet-trace, benchmarks a hot path with BenchmarkDotNet, or captures a dump with dotnet-dump / dotnet-gcdump and does first-look SOS analysis (CoreCLR only) - 'my app is slow', 'high CPU', 'is this faster', 'it hangs', 'memory keeps growing'.
- Not for APM or distributed tracing across services (OpenTelemetry wiring).

## Measure first

A benchmark exists to earn or refute a change, not to decorate one. Before you tune, confirm the hot path is actually hot - a microbenchmark of the wrong method buys nothing, and the usual culprit is a slow query or an N+1, not a type choice (that call is `dotnet-performance`'s). Reach for `references/profiling.md` first when the hot spot is unknown or the cost is I/O, contention, or spread across a request - the counters and a sampled trace name it; reach for `references/microbenchmarking.md` once the comparison is CPU/allocation on a tight in-process path.

## The result is a number, not a verdict

Whichever route you take, the output contract is the same and it carries evidence, never a claim:

- A benchmark reports the BenchmarkDotNet summary rows for both variants - mean, allocated, ratio - copied from the run, plus the command that produced them. 'It is faster' with no table is not a result. The shape:

  ```text
  dotnet run -c Release -- --filter '*SortBench*'
  | Method | Mean     | Allocated | Ratio |
  | Bubble | <copied> | <copied>  | 1.00  |
  | Quick  | <copied> | <copied>  | <x>   |
  ```

- A profile reports the counters it read, the `dotnet-trace collect` command and the `dotnet-trace report <file> topN` rows that carry the conclusion, before and after under the same load.
- A dump reports the capture command, the file, and the first-look SOS output that supports the conclusion (`clrstack`, `dumpheap -stat`, `gcroot`). Name what you did NOT rule out.

## Capture where it reproduces

A dump is only as good as the process it came from. Capture in the environment that reproduces the fault - the same runtime, the same container, under the same load - because a crash that only shows up in production will not surface in a local run. Enable automatic crash dumps ahead of time (`DOTNET_DbgEnableMiniDump`) for a fault you cannot trigger on demand; collect on demand (`dotnet-dump collect`) for a hang or a leak you can catch live. Load `references/dumps.md` for the capture matrix, the container setup, and the first-look SOS pass.
