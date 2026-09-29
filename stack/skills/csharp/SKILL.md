---
name: csharp
description: "Load before creating or editing any .cs file - writing, reviewing or refactoring C#. Not instead of a .NET specialist area (EF queries, the ASP.NET pipeline)."
---

# C# Conventions

For any BCL or NuGet API surface not pinned down here, resolve signatures with the `documentation` MCP rather than memory - never by grepping the NuGet cache or decompiled sources.

C# style, structure, and runtime conventions in one place: how code is shaped (naming, layout, syntax) and how it behaves (async, I/O, exceptions, logging, DI). Style is enforced by `.editorconfig` (Allman braces through the formatting rule IDE0055, file-scoped namespaces through IDE0161) and `EnforceCodeStyleInBuild=true`.

**Formatting, naming, and language-feature style is authoritative in `references/csharp-style.md`** (with the full canonical `.editorconfig`); the .NET Framework 4.8 delta (the C# 7.3 ceiling, polyfills, the SynchronizationContext async caveat) is `references/net-framework-48.md`. This file keeps the house rules those do not cover, and where it overlaps them, the style docs win. **Above all of these, a project's own `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority: where a project diverges from these general conventions, follow the project.**

**Floor: .NET 8 / C# 12.** Every rule below assumes at least this target - `TimeProvider`, `UnsafeAccessorAttribute`, the static argument throw-helpers, and the C# 12 collection expressions / primary constructors are all in. Where a convention names a newer feature (C# 13 `System.Threading.Lock`, the C# 14 `field` keyword), it flags the version inline; treat those as opt-in once the project's target moves up.

Specialized concerns (concurrency, performance / memory layout, design patterns, serialization, DI registration, config binding, DDD, architecture, packaging) route through the .NET router skill where the install has it: load the focused skill it names, and with no router match work from the skills already loaded.

## When to use

- Before creating or editing any `.cs` file - writing, reviewing, or refactoring C#; do not lean on recalled
  conventions.
- The always-load baseline underneath the specialist areas: style and structure plus runtime behavior, with the
  per-area deltas in `references/`.
- Do NOT load it INSTEAD of one: architectural style choices, EF query shaping, ASP.NET request-pipeline work and
  performance tuning route out through the .NET router where the install has one.

---

# Style and Structure

## File structure
- Max 300 lines per file - a file past that is accreting more than one responsibility. Split by extracting cohesive groups of methods into new classes.
- 120 columns per line in `.cs` files - the soft limit `references/csharp-style.md` sets; markdown, JSON, config files exempt.
- Partial classes only for generated code (EF migrations, designer files) or extending a generated class.
- One-type-per-file, file naming, and file-scoped namespaces follow `references/csharp-style.md` - it owns the detail.

## Naming

Casing, prefixes, and the `Async` suffix live in `references/csharp-style.md` - not repeated here. The house rule on top of them is naming *intent* - apply four tests to every name:
1. **Domain-aligned** - use vocabulary from the project domain. Avoid `Manager`, `Helper`, `Data`, `Info`, `Item`, or vague verbs like `Process` / `Handle` when a domain-specific term exists.
2. **Intent-revealing** - the name explains what the member does without reading the implementation.
3. **DDD-consistent** - value objects model concepts, not primitives. Don't suffix entity types with `Entity` or `Aggregate`. Do suffix repositories and services.
4. **Free of misleading names** - a method named `Save` must persist; a `Validate` method must not also mutate state.

## Class member ordering

Order: private constants/statics, private readonly, private fields, protected/public properties, constructors, public/protected/private methods. Public properties before the constructor.

No SDK analyzer or `.editorconfig` rule enforces this order - it is a review rule, checked by reading the diff. StyleCop is no stand-in: its SA1201 puts constructors before properties and SA1202 puts public members before private, so adding that pack flags this order rather than holding it.

## Constructor parameter ordering

Private readonly fields, constructor parameters (primary constructors included) and body assignments follow one order, the same in all three: `ILogger` / `ILogger<T>` first, then other interfaces, then classes (sealed records, delegates such as `Func<>`, concrete service types), then structs. Within a group, broadest scope first; required before optional.

## Blank lines

Consecutive blank lines are the formatter's, or IDE2000 (experimental: `dotnet_style_allow_multiple_blank_lines_experimental = false`). The non-mechanical rule, which no analyzer checks: one blank line before control-transfer statements (`return`, `throw`, `break`, etc.) when preceded by another statement - so the exit visually separates from preceding logic.

## Methods
- Max 20 lines per method body - a longer body is doing more than one thing and resists review. Refactor if exceeded.
- Max 3 parameters. Use a parameter object (record or class) for more.
- Methods do one thing. If 'and' appears in a method name, split it.
- No `out` or `ref` parameters - they hide data flow at the call site and do not compose with async or LINQ; return a tuple or result object instead.
- Every `switch` case body wrapped in its own `{ }` block - even when one statement, even when no variable is declared, so no variable leaks between cases. Brace any half-braced switch you edit; the worked example, blank lines included, is in `references/csharp-style.md` (section 2, 'Switch case blocks').

## Types and variables
- `var`, nullable reference types, records vs classes and expression-bodied members are `references/csharp-style.md`'s; the bullets below are house additions.
- Value objects: model as small immutable types - typically `readonly record struct` - validate in the constructor (trust everywhere after), and expose explicit conversions / factory methods only, never an `implicit operator` (it silently defeats the type safety it exists to provide). Add a `TypeConverter` when the value object must bind from configuration.
- Member signatures expose the narrowest useful shape: accept `IEnumerable<T>` / `IReadOnlyCollection<T>` / `IReadOnlyList<T>` (or `ReadOnlySpan<T>` on hot paths), and return a read-only collection type (`IReadOnlyList<T>`, `IReadOnlyDictionary<,>`); return a `List<T>` / array only when the caller is meant to mutate it.
- No magic numbers or magic strings - use named constants or enums.
- Enums: explicit underlying values for any enum persisted to a database or sent over the wire. Use `[Flags]` only when bitwise combination is intended.
- No public mutable fields - use properties.
- String comparison: always specify `StringComparison.Ordinal` for non-linguistic comparisons (identifiers, keys, file paths), `StringComparison.OrdinalIgnoreCase` for case-insensitive. Never rely on culture-default comparison.

## Visibility and sealing
- Default to the lowest visibility that works: `private` for class members, `internal` for assembly-scoped types, `public` only for cross-assembly API.
- Mark new classes `sealed` unless inheritance is part of the design. Sealed classes enable JIT devirtualization and signal intent.
- Mark methods `virtual` or `abstract` only when overriding is genuinely required. Prefer composition over inheritance.
- Static classes only for pure utilities (no state, no I/O, no DI dependencies). For anything else, use a regular class with DI.
- Static fields only for true constants or thread-safe caches. Mutable static state is forbidden.

## Design patterns (GoF awareness)
Reach for the framework-native construct before hand-rolling a GoF pattern - most are already in the platform. Choosing, implementing or refactoring toward a pattern loads the skill covering GoF design patterns in C#; without it, the framework-native construct is the answer.

## Modern C# syntax preferences

The modern-feature style (primary constructors, collection expressions, raw strings, `required`, the `field` keyword, pattern matching) is section 4 of `references/csharp-style.md`. Two house preferences it does not name: prefer `params ReadOnlySpan<T>` (C# 13) for new internal zero-alloc APIs over `params T[]`, and `System.Threading.Lock` (C# 13) for new lock objects (do not retrofit existing `lock(object)` sites).

Performance concerns (readonly structs, `Span<T>` / `ArrayPool<T>`, collection choice) belong to the skill covering .NET performance and memory layout, when your skill list has one; without it, prefer the framework default and measure before optimizing.

## Forbidden patterns
- No `#region` blocks - a file that needs regions to navigate is too big; split it instead.
- No `using static` for non-utility classes.
- No commented-out code - delete it.
- No `TODO` without an associated ticket reference.
- No reflection in business or hot-path code; use source generators or compile-time alternatives. No object-mapping libraries (AutoMapper / Mapster / ExpressMapper) - write explicit mapping methods (compile-time checked, debuggable, refactor-safe). Reflection is acceptable only in serialization, the DI container, ORM / EF, test infrastructure, or one-time bootstrap - never for DTO / domain mapping. When you must reach a private member (serializer, test helper), use `UnsafeAccessorAttribute` (.NET 8), not `System.Reflection`.
- No `dynamic` - use `object` + pattern matching or a typed interface.
- No top-level statements outside `Program.cs`.

Routing note: when a convention here drives a package change - adding, removing, or swapping one (e.g. dropping a banned mapper, replacing Newtonsoft with System.Text.Json) - the install itself belongs to the skill covering .NET solution and package setup, where the install has it; either way use the `dotnet` CLI, never hand-edit `Directory.Packages.props`.

## Documentation
- Every public API surface has XML doc comments covering parameters, return values, thrown exceptions, and remarks for non-obvious behavior.
- Write them in the expanded multi-line form - each tag on its own lines, full sentences, `<returns>` and every `<param>` treated like `<summary>`, never a fragment on one `///` line. Open section 5 of `references/csharp-style.md` (the worked pair) before documenting a new public surface.

---

# Runtime and Behavior

## DateTime and timezones
- Store and pass `DateTimeOffset`, not `DateTime`, for any value crossing process or DB boundaries.
- All persisted timestamps in UTC. Convert to local only at the presentation boundary.
- Never call `DateTime.Now` or `DateTime.UtcNow` directly in business logic. Inject `TimeProvider` - in-box on the floor, and `Microsoft.Bcl.TimeProvider` back-ports it to .NET Framework 4.6.2+ / .NET Standard 2.0 - so a test drives time with `FakeTimeProvider`; a hand-rolled `IClock` stays only where the codebase already has one.
- Never call `DateTime.Now` for measurements - use `Stopwatch`.

## Async, disposal, and JSON
Read `references/runtime-behavior.md` before writing async or cancellation code, a type that owns a resource, or `System.Text.Json` configuration: it carries the house additions to the async baseline, the dispose rules and the JSON defaults. When the change is genuinely concurrent rather than merely async - deadlock avoidance, cancellation threading, `SemaphoreSlim` / `Interlocked`, `Channel<T>`, bounded parallelism - open `references/concurrency.md` instead.

## Exception handling and Result pattern
- Distinguish expected outcomes from exceptional failures. Validation, not-found, and business-rule failures are expected - return a result type rather than throwing. Prefer a domain-specific result (a sealed record with `Success` / `Failed` factory methods and an error-code enum, e.g. `CreateOrderResult`) over a generic `Result<T>` / `OneOf<,>` when the operation's failure modes are known.
- Exceptions for unexpected failures only (I/O errors, programming errors, contract violations).
- Catch specific exceptions; never bare `catch (Exception)` in business logic unless logging and re-throwing.
- Do not use exceptions for control flow.
- Re-throw with `throw;` not `throw ex;` (preserves stack trace).
- Validate arguments at the top of public methods. Prefer the static throw-helpers over hand-written guards: `ArgumentNullException.ThrowIfNull(x)`, `ArgumentException.ThrowIfNullOrWhiteSpace(s)`, `ArgumentOutOfRangeException.ThrowIfNegative` / `ThrowIfGreaterThan(...)` (.NET 8).
- Mapping a Result to HTTP (`ProblemDetails`, `IExceptionHandler`) is the ASP.NET Core error-handling skill's, via the .NET router; never shape HTTP errors in business code.

## Logging
- Structured logging via `ILogger<T>`. Use templates with named placeholders: `_logger.LogInformation("Order {OrderId} placed for {UserId}", orderId, userId)`. Never use string interpolation in log calls.
- Log levels: `Trace` (diagnostic noise), `Debug` (dev), `Information` (business events), `Warning` (recoverable issue), `Error` (operation failed), `Critical` (system unusable).
- Log exceptions with the exception object as the first arg: `_logger.LogError(ex, "Failed to {Action}", actionName)`. Never `.ToString()` an exception into the message.
- Never log: passwords, tokens, secrets, full payment data, PII beyond what is operationally needed. For healthcare and e-commerce projects, treat full identifiers as PII.
- One log statement per logical event. Avoid log spam in tight loops.

## Secrets and configuration sources
- Where secrets live (dev vs prod placement) is the skill covering .NET application-security hardening (OWASP-mapped mitigations, secret placement); without it, keep every secret out of source, config files and logs. Hashing / encryption primitives route via the .NET router to the cryptography-primitives skill, where installed.
- Configuration layering: `appsettings.json` (defaults) -> `appsettings.{Environment}.json` -> environment variables -> command-line args. Later layers override earlier.
- Typed options and startup validation (`IOptions<T>` family, `ValidateOnStart`, `IValidateOptions<T>`) belong to the web hub skill - the ASP.NET Core cross-cutting baseline - where the install has it; the DI-side binding shape is `references/dependency-injection.md`, and without the web hub that is the whole rule.

## LINQ
Method-vs-query syntax choice, chain wrapping, multiple-enumeration, and terminal-operator intent are authoritative in `references/csharp-style.md`. House additions:
- No more than 4-5 chained operators without an intermediate variable with a descriptive name.
- Materialize queries (`ToList`, `ToArray`) before returning from a method that owns the DbContext or connection lifetime.

## Decoupling and DI lifetimes
- Never call `new` on service-layer or infrastructure types inside a class body - use factories or DI.
- No circular dependencies between namespaces.
- Never inject a shorter-lifetime service into a longer-lifetime one (captive dependency). Use `IServiceScopeFactory` or a `Func<T>` factory for cross-lifetime access.
- Composition mechanics - grouping a feature's registrations behind an `Add*` extension, keyed services, factory registration, and `TryAdd` - are `references/dependency-injection.md`; this section owns only the lifetime rules.

## Prove it

Before any done word on a `.cs` change, run `dotnet build` and quote its summary line - no new warning or error is what shows the analyzer-backed rules held (style included, with `EnforceCodeStyleInBuild` on); re-reading the diff is no substitute for that build. The rules no analyzer backs - member ordering and the file, method and parameter caps - are checked by reading the diff, and the close says so.
