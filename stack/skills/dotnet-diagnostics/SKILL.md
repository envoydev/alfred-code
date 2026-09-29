---
name: dotnet-diagnostics
description: "Use when benchmarking a .NET hot path (BenchmarkDotNet) or debugging a crash, hang or memory leak with dotnet-dump. Not for CPU profiling or tracing."
---

# dotnet-diagnostics (decision layer)

Two ways to put numbers on a .NET process instead of guessing: benchmark a hot path in isolation, or capture a dump of a process that crashed, hung, or is leaking. This hub decides which one the task needs and routes to the depth - it does not restate it.

- Time a hot path / compare two implementations -> `references/microbenchmarking.md`
- A process crashed, hung, or is leaking - capture and read a dump -> `references/dumps.md`

## When to use

- Captures a dump with dotnet-dump / dotnet-gcdump and does first-look SOS analysis. CoreCLR only.
- Not for CPU profiling, APM or distributed tracing.

## Measure first

A benchmark exists to earn or refute a change, not to decorate one. Before you tune, confirm the hot path is actually hot - a microbenchmark of the wrong method buys nothing, and the usual culprit is a slow query or an N+1, not a type choice (that call is `dotnet-performance`'s). Reach for `references/microbenchmarking.md` when the comparison is CPU/allocation on a tight in-process path; reach for a profiler or trace when the cost is I/O, contention, or spread across a request.

## The result is a number, not a verdict

Whichever route you take, the output contract is the same and it carries evidence, never a claim:

- A benchmark reports the BenchmarkDotNet summary rows for both variants - mean, allocated, ratio - copied from the run, plus the command that produced them. 'It is faster' with no table is not a result.
- A dump reports the capture command, the file, and the first-look SOS output that supports the conclusion (`clrstack`, `dumpheap -stat`, `gcroot`). Name what you did NOT rule out.

## Capture where it reproduces

A dump is only as good as the process it came from. Capture in the environment that reproduces the fault - the same runtime, the same container, under the same load - because a crash that only shows up in production will not surface in a local run. Enable automatic crash dumps ahead of time (`DOTNET_DbgEnableMiniDump`) for a fault you cannot trigger on demand; collect on demand (`dotnet-dump collect`) for a hang or a leak you can catch live. Load `references/dumps.md` for the capture matrix, the container setup, and the first-look SOS pass.
