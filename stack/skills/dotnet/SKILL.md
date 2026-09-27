---
name: dotnet
description: "Router for .NET / C# work: maps a work area (endpoint, EF Core query, BackgroundService, messaging, testing, performance, WPF / WinForms) to the one specialist skill to load. Load when starting or navigating any .NET backend or desktop task. Not for front-end work (the Angular / TypeScript conventions skills) or non-.NET work, and never instead of the specialist it names."
---

# dotnet (skill router)

**Availability - required vs optional.** The always-on spine of any .NET work is three skills: this router, `csharp` (every `.cs` file - every row below is in addition to it, never instead), and `dotnet-testing` (the moment a test is written or changed - tests are part of the done gate). Add exactly one surface hub for the app under build - `dotnet-web-backend` (ASP.NET Core), `dotnet-console-apps` + `dotnet-hosted-services` (worker / CLI / bot / daemon), `dotnet-hosted-services` + `dotnet-windows-service` (a Windows Service under the SCM), or `dotnet-wpf` / `dotnet-winforms` (desktop). Every other row below is an optional specialist, loaded only when its area is in play - never up front - and installed only where the project's stack or evidence shows that area: a row whose skill is not in your skill list means the area is absent here, not a broken pointer - work from this router and skip the row.

The index from a concrete .NET work area - a construct, command, file or task - to the one focused skill to load. It routes, never restates; several matching rows load several. **The trigger is the artifact**; a repo's `CLAUDE.md` binds these rows to its own files. A row that names a reference: load the skill, then open that file; a row too terse to decide is spelled out in `references/routing-in-full.md`.

## Language, architecture, setup

| About to... | Load |
|---|---|
| write or refactor any C# | `csharp` (always) |
| synchronization or producer-consumer code (`Channel<>`, `lock`, `SemaphoreSlim`) | `csharp` (`references/concurrency.md`); a worker's loop: `dotnet-hosted-services` |
| layout-sensitive types (struct vs class, pooling, `Span`) / JSON options, source-gen contexts, wire formats | `dotnet-performance` (`references/type-design.md` / `references/serialization.md`) |
| a Roslyn generator, or `[GeneratedRegex]` / `[LoggerMessage]` / `[JsonSerializable]` | `dotnet-source-generators` |
| a GoF pattern | `csharp-design-patterns` |
| a domain type (aggregate, value object, event, strongly-typed ID) / a layer, port or module boundary | `dotnet-architecture` (`references/ddd.md` / its hub) |
| boundaries as fitness tests | `dotnet-architecture-tests` |
| DI registration, `Add*` extensions, lifetimes | `csharp` (`references/dependency-injection.md`) |
| typed options and `ValidateOnStart` | `dotnet-web-backend` |
| a new solution, `Directory.Build.props`, `global.json`, a NuGet package or `Directory.Packages.props`, a local tool | `dotnet-project-setup` (`references/central-package-management.md`, `references/local-tools.md`) |
| formatting, analyzers, the CI quality gate | `dotnet-code-quality` |
| an EF schema, SDK or NuGet migration with preview and rollback | `dotnet-migrate` |

## Web, hardening, data

| About to... | Load |
|---|---|
| any ASP.NET Core service (load first) | `dotnet-web-backend` |
| minimal-API endpoints / controller-based Web API | `dotnet-minimal-api` / `dotnet-mvc-controllers` |
| the OpenAPI document or its UI | `dotnet-openapi` |
| Result-to-HTTP, `ProblemDetails`, `IExceptionHandler`, the validation filter | `dotnet-web-error-handling` |
| authentication or authorization | `dotnet-authentication` |
| gRPC / SignalR real-time push | `dotnet-grpc` / `dotnet-realtime` |
| OWASP hardening, SSRF, dependency audit / crypto primitives | `dotnet-security` / `dotnet-cryptography` |
| a schema, SQL, a document model, migrations, views, indexes | `database-conventions` (data hub) |
| EF Core / NHibernate data access or read-path performance | `dotnet-data-access` (`references/efcore.md`, `references/nhibernate.md`; engine side `postgres` / `sqlite`) |

## Messaging, hosting, desktop

| About to... | Load |
|---|---|
| broker messaging, outbox, sagas / Aspire orchestration | `dotnet-messaging` / `dotnet-aspire` |
| a worker or background task | `dotnet-hosted-services` (I/O: `references/resilience-and-io.md`; schedulers: `references/scheduling-and-coordination.md`; deploy: `references/deployment-and-observability.md`) |
| a Windows Service under the SCM | `dotnet-windows-service` (after `dotnet-hosted-services`) |
| a CLI tool / a chat or trading bot | `dotnet-console-apps` (bots: `references/bot-sdks.md`) |
| a WPF / WinForms desktop UI | `dotnet-wpf` / `dotnet-winforms` |

## Testing, quality, diagnostics

| About to... | Load |
|---|---|
| any .NET test or coverage (test hub) | `dotnet-testing` (`references/testcontainers.md`, `references/aspire-integration-testing.md`, `references/snapshot-testing.md`) |
| a reward-hacking or CRAP check before done | `dotnet-code-quality` (`references/crap-analysis.md`) |
| OpenTelemetry instrumentation | `dotnet-web-backend` (`references/observability.md`) |
| a microbenchmark / a crash or hang dump | `dotnet-diagnostics` (`references/microbenchmarking.md` / `references/dumps.md`) |
| a compiled assembly's real API | `ilspy-decompile` |

## .NET Framework 4.8

A net48 codebase routes through `references/net-framework-48-routing.md` - one row per area with the owner skill's net48 reference; open it only when the codebase is on net48.

## Notes

- **Hubs vs leaves.** `csharp`, `dotnet-web-backend`, `database-conventions` and `dotnet-testing` are the hubs - load a hub before its specialists; this router indexes them all.
- **Out of scope.** Web front-end and mobile are the Angular, TypeScript and Ionic/Capacitor conventions skills; the security review, code verification, the documentation server and git live in the project's `CLAUDE.md`.
