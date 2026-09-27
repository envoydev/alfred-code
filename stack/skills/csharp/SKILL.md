---
name: csharp
description: "Load before creating or editing any `.cs` file - writing, reviewing, or refactoring C#; do not lean on recalled conventions. C# conventions (.NET 8 / C# 12 floor) - style and structure plus runtime behavior, with the per-area deltas in `references/`. The always-load baseline underneath the specialist areas. Do NOT load it INSTEAD of one: architectural style choices, EF query shaping, ASP.NET request-pipeline work and performance tuning route out through the .NET router where the install has one."
---

# C# Conventions

For any BCL or NuGet API surface not pinned down here, resolve signatures with the `documentation` MCP rather than memory - never by grepping the NuGet cache or decompiled sources.

C# style, structure, and runtime conventions: how code is shaped (naming, layout, syntax) and how it behaves (async, I/O, exceptions, logging, DI). Style is enforced by `.editorconfig` (Allman braces, file-scoped namespaces) and `EnforceCodeStyleInBuild=true`.

**Where the detail lives.** Formatting, naming casing and language-feature style are authoritative in `references/csharp-style.md` (with the canonical `.editorconfig`). Each house rule below is one line; `references/house-rules.md` carries them in full with their examples - read it before a new type or file, a constructor with several dependencies, a `switch`, a public API's XML docs, or a result-versus-exception call. The .NET Framework 4.8 delta (the C# 7.3 ceiling, the polyfills, the SynchronizationContext caveat) is `references/net-framework-48.md`. **Above all of these, a project's own `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority: where a project diverges from these general conventions, follow the project.**

**Floor: .NET 8 / C# 12** - `TimeProvider`, `UnsafeAccessorAttribute`, the static throw-helpers, collection expressions and primary constructors are all in. A newer feature (C# 13 `System.Threading.Lock`, the C# 14 `field` keyword) is flagged inline and opt-in once the target moves up.

Specialized concerns route through the .NET router skill - the one whose description maps each work area (concurrency, performance / memory layout, design patterns, serialization, DI registration, config binding, DDD, architecture, packaging) to its focused skill - where the install has it: load the skill it names, and with no router match work from the skills already loaded. This file stays the style and runtime baseline only.

## Style and structure

- **Files:** at most 300 lines and 120 columns; partial classes only for generated code; one type per file, file-scoped namespaces.
- **Names** pass four tests: domain-aligned (no `Manager` / `Helper` / `Data` / `Info` / `Item`, no vague `Process` / `Handle`, where a domain term exists), intent-revealing, DDD-consistent (value objects for concepts; no `Entity` / `Aggregate` suffix; suffix repositories and services), never misleading (`Save` persists, `Validate` does not mutate).
- **Order:** private constants and statics, private readonly, private fields, properties, constructors, methods. Constructor parameters, fields and assignments share one order - `ILogger` first, then interfaces, classes, structs; broadest scope first; required before optional.
- **Blank line** before a `return` / `throw` / `break` that follows another statement.
- **Methods:** at most 20 lines and 3 parameters (a parameter object past that), one thing each (an 'and' in the name means split it), no `out` / `ref`; every `switch` case body in its own `{ }` block.
- **Types:** value objects small, immutable, validated in the constructor, with explicit conversions - never an `implicit operator`; accept and return the narrowest read-only collection shape; no magic numbers or strings; explicit values on persisted or wire enums, `[Flags]` only for bitwise; no public mutable fields; `StringComparison.Ordinal` / `OrdinalIgnoreCase`, never the culture default.
- **Visibility:** the lowest that works; new classes `sealed`; `virtual` / `abstract` only when overriding is designed; static classes only for pure utilities; no mutable static state.
- **Patterns:** the framework-native construct before a hand-rolled GoF pattern - the skill covering GoF design patterns in C# chooses, where installed.
- **Modern syntax** per `references/csharp-style.md`; new internal zero-alloc APIs take `params ReadOnlySpan<T>`, new lock objects are `System.Threading.Lock` (C# 13). Performance concerns belong to the skill covering .NET performance and memory layout, when your skill list has one; without it, prefer the framework default and measure before optimizing.
- **Forbidden:** `#region`; `using static` for non-utility classes; commented-out code; a `TODO` with no ticket; reflection in business or hot-path code (`UnsafeAccessorAttribute` reaches a private member); object-mapping libraries - write the mapping; `dynamic`; top-level statements outside `Program.cs`. A package change goes through the `dotnet` CLI (the skill covering .NET solution and package setup, where installed), never a hand edit of `Directory.Packages.props`.
- **Docs:** every public API carries expanded multi-line XML doc comments; the worked pair is section 5 of `references/csharp-style.md`.

## Runtime and behavior

- **Time:** `DateTimeOffset` across a process or DB boundary, persisted in UTC, local only at presentation; inject `TimeProvider`, never `DateTime.Now` / `UtcNow` in business logic; `Stopwatch` for measurements.
- **Async, disposal, JSON:** read `references/runtime-behavior.md` before async or cancellation code, a type that owns a resource, or `System.Text.Json` configuration; genuinely concurrent code (deadlocks, `SemaphoreSlim` / `Interlocked`, `Channel<T>`, bounded parallelism) opens `references/concurrency.md` instead.
- **Failures:** an expected outcome (validation, not-found, a business rule) returns a result - a domain-specific result record over a generic `Result<T>`; exceptions only for unexpected failures, never control flow; catch specific exceptions; `throw;`, never `throw ex;`. Shaping an HTTP error is the ASP.NET Core error-handling skill's, via the router.
- **Arguments:** Validate arguments at the top of public methods. Prefer the static throw-helpers over hand-written guards - `ArgumentNullException.ThrowIfNull(x)`, `ArgumentException.ThrowIfNullOrWhiteSpace(s)`, `ArgumentOutOfRangeException.ThrowIfNegative` / `ThrowIfGreaterThan(...)`.
- **Logging:** `ILogger<T>` templates with named placeholders, never interpolation; the exception object first; never passwords, tokens, secrets, full payment data or unneeded PII; one statement per logical event.
- **Secrets and config:** where secrets live is the skill covering .NET application-security hardening; without it, keep every secret out of source, config files and logs. Layers: `appsettings.json`, `appsettings.{Environment}.json`, environment variables, command line. Typed options and startup validation are the web hub skill's; the DI binding shape is `references/dependency-injection.md`.
- **LINQ:** at most 4-5 chained operators before a named intermediate; materialize before returning from a method that owns the DbContext or connection.
- **DI:** never `new` a service or infrastructure type in a class body; no namespace cycles; never inject a shorter lifetime into a longer one (`IServiceScopeFactory` / `Func<T>` instead); composition mechanics are `references/dependency-injection.md`.

## Prove it

Before any done word on a `.cs` change, run `dotnet build` and quote its summary line - no new warning or error is what shows the rules above held (style included, with `EnforceCodeStyleInBuild` on); re-reading the diff is not a check.
