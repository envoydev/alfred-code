---
name: dotnet-testing
description: "Use before writing, modifying, or reviewing .NET tests, auditing test quality or smells, running mutation testing, or configuring coverage - do not rely on recall. The .NET testing hub: the architecture-neutral approach for unit / integration / E2E tests, not a single library. Defaults are xUnit, NSubstitute and FluentAssertions 7.x; coverage mechanics, library routing, Testcontainers, Aspire integration and snapshot testing are in `references/`. Floors at .NET 8 / C# 12. Do NOT load for Angular or Ionic tests, or for plain TS/JS outside a framework harness - the Angular and the TypeScript/JavaScript testing skills own those."
---

# .NET Testing Approach

This skill captures the **approach**, not a single library. The principles below apply regardless of which test runner, substitute library, or assertion library a project picks. Library routing is in §Library choices.

**Floor: .NET 8 / C# 12.** Testing classic ASP.NET on .NET Framework 4.8 (in-memory OWIN `TestServer`, `HttpContextBase`) is `references/net-framework-48.md`.

## Test strategy by responsibility (architecture-neutral)

The strategy keys off the *role* a unit plays, not a layer name: in a layered project the roles are the layers, in a vertical-slice or modular one the parts of a feature folder - test each part the same way wherever it lives.

- **Domain / business rules** - pure unit tests, no substitutes. Cover entities, value objects, domain services, domain events, invariants, guard clauses, factory methods, and every branch of a business rule including exception paths - this is the code where an uncovered branch is never acceptable.
- **Use cases / handlers / orchestration** (the application logic of a slice or layer) - unit tests with all ports and abstractions substituted. Cover success paths, validation failures, exception handling, and orchestration branches.
- **Infrastructure / adapters** - test logic-bearing code only (mappers, parsers, serializers, policy classes, retry/backoff, non-trivial query logic). Use SQLite in-memory or Testcontainers when query logic is non-trivial (`references/testcontainers.md`) - never the EF Core InMemory provider for relational behavior: it enforces no relational constraints and translates no SQL, so it passes queries the real database rejects. Do not write tests that only assert a substitute was configured.
- **Integration / E2E** - defined per project in project CLAUDE.md. For an Aspire-orchestrated app the harness is `references/aspire-integration-testing.md`.
- **Negative-security paths** - assert the deny paths, not just the happy path: an expired or tampered token returns 401, N failed logins trip 429, and one user reading another's resource id returns 404. Explicit negative-security tests belong in the integration suite, not just the auth unit tests.

## Coverage

- The % bar is the USER's, owned and recorded by the `alfred-capture-test-coverage` capture
  (asked at capture time, kept in its COVERAGE.md) - this skill sets no number.
- What this skill owns is the mechanics: coverage is computed after exclusions so the number
  reflects real logic coverage, not padding. The .NET exclusion catalog, the coverlet collector,
  the report formats and the CRAP ranking are `references/coverage-collection.md` - read it before
  measuring or adding an exclusion.

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

Defaults for a new project: **xUnit** runner, **NSubstitute** substitutes, **FluentAssertions 7.x** assertions (v8+ is a paid licence - `references/library-routing.md`). One runner, one substitute library and one assertion library per project - migrate, never blend. When the project has already picked, or is picking now, the alternatives and the reason for each are `references/library-routing.md`. Substitute only what you cannot construct, stay loose rather than strict, and verify the boundary that matters instead of every interaction. Snapshot / Verify assertions - approving serialized output instead of hand-written asserts - are `references/snapshot-testing.md`.

## Test project conventions

One test project per production project, mirroring its namespaces and folders, and the suite run at minimal verbosity with a failure read by its first error - `references/test-project.md` has the layout, the shared-fixture project rule and the verbosity flags.

## Cancellation and async

- Every async path under test that accepts `CancellationToken` gets a cancellation test (token already cancelled, token cancelled mid-flight where realistic).
- Async tests return `Task` / `ValueTask` - never `async void`.

## Isolation and shared state

- Tests must pass regardless of order. No reliance on side effects from earlier tests, no mutable static state.
- Per-test fresh fixture by default (xUnit constructor, NUnit `[SetUp]`, MSTest `[TestInitialize]`). Reuse only for expensive resources (Testcontainers, web factory) via `IClassFixture` / `ICollectionFixture` and only when the resource is read-only or reset between tests.
- Database integration tests: each test gets its own transaction or schema, rolled back at teardown. Never assume row IDs.
- Test data via one canonical builder per aggregate, never literal-soup constructors - the builder shapes (a `record` with `init` defaults, `with` variations, a fluent builder only when a setter computes) are `references/test-project.md`.

## What NOT to test

Auto-properties, generated code and migrations, framework types, pure DTOs, DI registration extensions (an integration test covers the wiring), and other people's libraries - test your wiring of them, never them.

## Auditing an existing suite

The rules above are for *writing* tests; reviewing an existing suite is its own lens - a test that passes can still prove nothing. When asked 'are these tests any good?' (or to run mutation testing), load `references/suite-audit.md`: the false-confidence catalog to scan first (assertion-free / always-true, coverage-touching, tautological, missing-await, swallowed-exception, disabled assertions), the assertion-depth and mock-usage passes, and Stryker.NET mutation testing.

## Routing (cross-skill)

These areas sit outside this skill; where your skill list has nothing covering one, the fallback beside it holds.

- Microbenchmarks and dump capture: the skill covering live-process measurement - without it, keep timing assertions out of the suite entirely.
- The coverage-gaming check before any 'done': the skill covering .NET analyzers and build gates - without it, refuse the obvious shortcuts (a skipped test, a weakened assertion, a lowered threshold).
- Testability refactors, the clock seam and `Task`-not-`void` are `csharp`'s; the exception and Result shapes under assertion are the HTTP error-handling skill's - without it, assert the shape production already returns.
