---
name: dotnet-testing
description: "Use before writing, changing or reviewing .NET tests, auditing test quality, mutation testing or coverage. Not for Angular, Ionic or plain TS/JS tests."
---

# .NET Testing Approach

This skill captures the **approach**, not a single library. The principles below apply regardless of which test runner, substitute library, or assertion library a project picks. Library routing is in §Library choices.

**Floor: .NET 8 / C# 12.** Testing classic ASP.NET on .NET Framework 4.8 (in-memory OWIN `TestServer`, `HttpContextBase`) is `references/net-framework-48.md`.

## When to use

- The .NET testing hub: the architecture-neutral approach for unit / integration / E2E tests, not a single library.
- Defaults are xUnit, NSubstitute and FluentAssertions 7.x; coverage mechanics, library routing, Testcontainers, Aspire integration and snapshot testing are in `references/`.
- Do NOT load for Angular or Ionic tests, or for plain TS/JS outside a framework harness - the Angular and the TypeScript/JavaScript testing skills own those.

## Test strategy by responsibility (architecture-neutral)

The strategy keys off the *role* a unit plays, not a layer name - so it maps onto whatever architecture the project picked (the pick-one rule lives with the architecture decision, not here). In a layered (Clean / Onion) project the roles below are the layers; in a vertical-slice / modular project they are the parts of a feature folder (the domain types, the handler / endpoint logic, the infrastructure wiring) - test each part the same way regardless of where it physically lives.

- **Domain / business rules** - pure unit tests, no substitutes. Cover entities, value objects, domain services, domain events, invariants, guard clauses, factory methods, and every branch of a business rule including exception paths - this is the code where an uncovered branch is never acceptable.
- **Use cases / handlers / orchestration** (the application logic of a slice or layer) - unit tests with all ports and abstractions substituted. Cover success paths, validation failures, exception handling, and orchestration branches.
- **Infrastructure / adapters** - test logic-bearing code only (mappers, parsers, serializers, policy classes, retry/backoff, non-trivial query logic). Use SQLite in-memory or Testcontainers when query logic is non-trivial (`references/testcontainers.md`) - never the EF Core InMemory provider for relational behavior: it enforces no relational constraints and translates no SQL, so it passes queries the real database rejects. Do not write tests that only assert a substitute was configured.
- **Integration / E2E** - defined per project in project AGENTS.md. For an Aspire-orchestrated app the harness is `references/aspire-integration-testing.md`.
- **Negative-security paths** - assert the deny paths, not just the happy path: an expired or tampered token returns 401, N failed logins trip 429, and one user reading another's resource id returns 404 (a resource the caller may not see returns 404, never 403 - no existence disclosure; 403 only where the caller can see the resource but not the action). Explicit negative-security tests belong in the integration suite, not just the auth unit tests.

## Coverage

- The % bar is the USER's, owned and recorded by the `capture-test-coverage` capture
  (asked at capture time, kept in its COVERAGE.md) - this skill sets no number.
- What this skill owns is the mechanics: coverage is computed after exclusions so the number
  reflects real logic coverage, not padding - the exclusion catalog below is that list for .NET.

## Standard exclusions (via `[ExcludeFromCodeCoverage]` or coverlet filters)

- `Program.cs`, `Main`, generic host bootstrap
- DI registration extensions
- Pure DTOs / records / POCOs with no behavior; plain auto-properties
- EF Core migrations and `DbContext.OnModelCreating`
- Generated code and framework configuration

## Test quality rules (framework-agnostic)

- **AAA structure** (Arrange / Act / Assert). One logical behavior per test.
- Every test asserts on **observable behavior or state** - no assertion-free or coverage-padding tests.
- Cover edge cases: nulls, empty / boundary values, cancellation tokens, concurrency where relevant, and every thrown-exception path.
- **Deterministic**: no real time - the clock seam (inject `TimeProvider`, never call `DateTime.UtcNow` directly) is `csharp`'s baseline rule; the test side is advancing that seam explicitly with `FakeTimeProvider` instead of waiting on the wall clock. No real I/O, no network, no `Thread.Sleep`. Seed any randomness.
- **Parameterized tests** for branch and boundary matrices instead of duplicated single-case tests.
- **Test naming**: `Do_Something_When_Condition` (PascalCase with underscores) regardless of runner.
- **A fix's test is named for the defect it pins**, in that same shape - `Total_Keeps_Discount_When_Currency_Changes`, not `Total_Works` - and fails on the unfixed code before it passes, so a later red names the regression it guards.
- **A self-review is never the check.** Re-reading your own change applies the assumptions that wrote it, so it finds only what they already allow; the check is a run - the test, the build, the analyzer - or a reviewer who did not write the change.
- If production code is **untestable** (hidden statics, sealed deps, no seams, hidden side effects), refactor for testability (extract interface, constructor injection) rather than writing a bad test. Flag these explicitly.
- **Substitute behavior, not implementation.** Verify the call your code makes to its collaborator (the boundary), not the internal sequence of calls. Avoid asserting on private methods or implementation details.

## Library choices

Defaults for a new project: **xUnit** runner, **NSubstitute** substitutes, **FluentAssertions 7.x** assertions (v8+ needs a paid commercial licence, so an upgrade is a licensing decision, not a routine bump; the Apache-2.0 fork AwesomeAssertions is the permissive way forward). One runner, one substitute library and one assertion library per project - migrate, never blend. When the project has already picked, or is picking now, the alternatives and the reason for each are `references/library-routing.md`. Substitute only what you cannot construct, stay loose rather than strict, and verify the boundary that matters instead of every interaction. Snapshot / Verify assertions - approving serialized output instead of hand-written asserts - are `references/snapshot-testing.md`.

### Coverage collection

- **coverlet** is the default collector (msbuild or runsettings). Combined with `dotnet test --collect:"XPlat Code Coverage"`.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- For CRAP-score risk hotspots, pair the coverage report with a complexity pass: CRAP = cyclomatic complexity weighed against that method's coverage, so a long, branchy, thinly-covered method ranks above a simple uncovered one. ReportGenerator emits complexity per method beside coverage, which is enough to rank; where the repo has a dedicated analysis for it, use that instead, and with neither, rank by uncovered branches alone.

## Test project conventions

- One test project per production project, mirroring namespace and folder structure.
- Folder layout inside test project mirrors the SUT's folder layout.
- Shared fixtures live in `*.TestSupport` / `*.Testing` projects when reused across multiple test projects; otherwise inline.
- Run the suite at minimal verbosity so the captured output stays lean: `dotnet test -v minimal` (or `--logger "console;verbosity=minimal"`), and read a failure by windowing to the first error / failed assertion, not the whole log - test output is context every seat that runs the gate pays for.

## Cancellation and async

- Every async path under test that accepts `CancellationToken` gets a cancellation test (token already cancelled, token cancelled mid-flight where realistic).
- Async tests return `Task` / `ValueTask` - never `async void`.

## Isolation and shared state

- Tests must pass regardless of order. No reliance on side effects from earlier tests, no mutable static state.
- Per-test fresh fixture by default (xUnit constructor, NUnit `[SetUp]`, MSTest `[TestInitialize]`). Reuse only for expensive resources (Testcontainers, web factory) via `IClassFixture` / `ICollectionFixture` and only when the resource is read-only or reset between tests.
- Database integration tests: each test gets its own transaction or schema, rolled back at teardown. Never assume row IDs.
- Test data via one canonical builder per aggregate, not literal-soup constructors. Prefer a `record` builder with `init` defaults; when the type under test is itself a `record`, derive case variations with a `with` expression from a canonical instance (`var large = baseOrder with { Total = new(1500m, "USD") };`) instead of re-running setup. Use a fluent `OrderBuilder().WithCustomer(...).Build()` only when a setter needs computation or validation.

## What NOT to test

- Auto-properties with no logic.
- Generated code, EF migrations, framework-provided types.
- DI registration extension methods (cover via integration test, not unit test).
- Pure DTOs / records used only as data carriers.
- Other people's libraries - assume `FluentValidation`, `Polly`, `EF Core` work. Test your wiring of them, not them.

## Auditing an existing suite

The rules above are for *writing* tests; reviewing an existing suite is its own lens - a test that passes can still prove nothing. When asked 'are these tests any good?' (or to run mutation testing), load `references/suite-audit.md`: the false-confidence catalog to scan first (assertion-free / always-true, coverage-touching, tautological, missing-await, swallowed-exception, disabled assertions), the assertion-depth and mock-usage passes, and Stryker.NET mutation testing.

## Routing (cross-skill)

These areas sit outside this skill. Where your skill list has nothing covering one, the note beside it is what to do instead.

- Performance microbenchmarks and crash / hang dump capture belong to the skill covering live-process measurement (BenchmarkDotNet, dotnet-dump, dotnet-gcdump). A test is not a benchmark: without that skill, keep timing assertions out of the suite entirely rather than approximating one.
- The reward-hacking / coverage-gaming check before any 'done' belongs to the skill covering .NET analyzers and build-gate enforcement; the CRAP ranking is paired at §Coverage above. Without it, the shortcuts to refuse are still the obvious ones: a skipped test, a weakened assertion, a lowered threshold.
- Testability refactors, the clock seam, and async-returns-`Task`-not-`void` are baseline rules owned by `csharp`. Exception and Result shapes under assertion belong to the skill covering HTTP error handling; without it, assert the shape the production code already returns rather than inventing an envelope.
