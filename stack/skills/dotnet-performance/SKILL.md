---
name: dotnet-performance
description: "Use when a .NET type sits on a hot path or picking a serialization format - struct vs class, Span, ValueTask, JSON vs Protobuf. Not for 'my app is slow'."
---

# dotnet-performance (decision layer)

Two performance-aware design calls that are cheap to get right up front and expensive to retrofit: how a type allocates, and how bytes cross a boundary. This hub decides *whether* the call is worth spending on here and routes to the depth - it does not restate it.

- Type allocation / memory layout -> `references/type-design.md`
- Serialization-format choice -> `references/serialization.md`
- .NET Framework 4.8 caveats (the 'slow span', NuGet-only fast-path packages) -> `references/net-framework-48.md`

## When to use

- Also fires on: high-throughput loop, allocations, MessagePack.
- Not the starting point for 'my app is slow' - measure first with the diagnostics skill.

## Measure first

Do not optimize on a hunch - a change is earned by a measurement, and taking one is `dotnet-diagnostics`'s job; come back here once the number says the type or the format is the cost.

## When allocation and memory layout matter (type design)

Spend on the type-design defaults when a type sits on a **hot path** - a per-request allocation inside a tight loop, a high-throughput pipeline, a `BackgroundService` draining a channel, a serializer inner loop. There the choices pay their way: seal by default, a small immutable value becomes a readonly struct, byte work moves to `Span`, a usually-cached async result returns `ValueTask`, static lookup data becomes a `FrozenDictionary`.

Off the hot path, do not contort a domain model for allocations you never measured - correctness and clarity win. The seal-by-default and immutable-return defaults still apply everywhere, though, because they cost nothing and prevent whole classes of bug. Load `references/type-design.md` for the rules and the anti-patterns.

## When serialization-format choice matters

The format decision is a wire-compatibility decision, and it is hard to reverse once data is persisted or a contract is published. Decide by where the bytes go - the pick-by-destination table is in `references/serialization.md`.

Inside a single process (in-memory only), format is irrelevant - do not serialize at all. The rules that override taste: never `BinaryFormatter`, and never embed .NET type names in a payload (it breaks on the first rename). Load `references/serialization.md` for setup, the Newtonsoft migration, and the versioning rules; the Roslyn source-generator skill owns the source-gen mechanics and the ASP.NET web hub the JSON wiring - with neither installed, the `JsonSerializerContext` snippet in that reference is enough to ship.

## Prove it

A performance change is done only when its measurement is: quote the before and after numbers from the same benchmark or profile, run the same way (BenchmarkDotNet's Mean and Allocated columns (with `[MemoryDiagnoser]`) for a hot path, the profiler's figure for a live regression), plus the green test run. A change with no before number is a guess, and the close says so.
