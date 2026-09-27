# The .NET routing index in full

Read when a row in SKILL.md is too terse to decide - each row with its full description of the work area.

**Contents:** [Language and types](#language-and-types), [Architecture and structure](#architecture-and-structure), [ASP.NET Core and web](#aspnet-core-and-web), [Cross-cutting hardening](#cross-cutting-hardening), [Data and EF](#data-and-ef), [Messaging and orchestration](#messaging-and-orchestration), [Hosting and background work](#hosting-and-background-work), [Testing and quality](#testing-and-quality), [Diagnostics and performance](#diagnostics-and-performance), [Desktop](#desktop), [Legacy: .NET Framework 4.8 (net48)](#legacy-net-framework-48-net48), [Notes](#notes)

**Availability** - the same rule as SKILL.md's: a row whose skill is not in your skill list means the area is absent here - work from the router and skip the row.

## Language and types

| You are about to... | Load |
|---|---|
| write or refactor any C# (naming, async, dispose, exceptions/Result, logging, DI lifetimes, modern syntax) | `csharp` (always) |
| add a `Channel<>`, `lock`, `SemaphoreSlim`, `Interlocked`, `Thread`, or other synchronization / producer-consumer code | `csharp` (its `references/concurrency.md`); a hosted worker's loop is `dotnet-hosted-services` |
| define a type where allocation or memory layout matters (struct vs class, `readonly struct`, pooling, `Span`) | `dotnet-performance` (its `references/type-design.md`) |
| (de)serialize JSON, reuse `JsonSerializerOptions`, or add a `JsonSerializerContext`, or pick a wire format (Protobuf/MessagePack) | `dotnet-performance` (its `references/serialization.md`) |
| author a Roslyn `IIncrementalGenerator`, or consume `[GeneratedRegex]` / `[LoggerMessage]` / `[JsonSerializable]` | `dotnet-source-generators` |
| choose or implement a GoF design pattern (factory, strategy, observer, undo/redo, plugin seams) or fix pattern misuse | `csharp-design-patterns` |

## Architecture and structure

| You are about to... | Load |
|---|---|
| model a domain type - aggregate, value object, domain event, strongly-typed ID | `dotnet-architecture` (its `references/ddd.md`) |
| decide which layer something belongs in, define a cross-layer port, or draw a module/service boundary | `dotnet-architecture` (the style decision + load-one rule live in its hub) |
| enforce layer / dependency / naming / isolation boundaries as automated tests (fitness functions) that fail the build | `dotnet-architecture-tests` |
| register services, build an `Add*` extension, or reason about DI lifetimes | `csharp` (lifetimes in the hub; `Add*` / keyed / factory composition in its `references/dependency-injection.md`) |
| bind or validate settings - `IOptions`, `IValidateOptions`, `ValidateOnStart` | `dotnet-web-backend` (its typed-options section) |
| set up a new solution - the layout, `.slnx`, `Directory.Build.props`, or `global.json` | `dotnet-project-setup` |
| add or upgrade a NuGet package, or edit `Directory.Packages.props` | `dotnet-project-setup` (its `references/central-package-management.md`) |
| set up or enforce C# formatting and analyzers - CSharpier, SDK analyzers, `.editorconfig` severity, `TreatWarningsAsErrors`, the CI quality gate | `dotnet-code-quality` |
| run a .NET migration workflow - EF schema, .NET/SDK version upgrade, or NuGet update with preview/rollback/verify | `dotnet-migrate` |

## ASP.NET Core and web

| You are about to... | Load |
|---|---|
| build any ASP.NET Core / Web API / microservice (cross-cutting baseline: HttpClient, resilience, versioning, observability, caching) | `dotnet-web-backend` (web hub - load first) |
| write minimal-API endpoint mechanics - `MapGroup`, `TypedResults`/`Results<>`, `IEndpointFilter`, parameter binding, file uploads | `dotnet-minimal-api` |
| write controller-based Web API mechanics - `[ApiController]`, attribute routing, `ActionResult<T>`, the automatic-400 filter, action filters, binding sources | `dotnet-mvc-controllers` |
| generate the OpenAPI document (Swashbuckle vs .NET 9 built-in, transformers, security schemes) or serve Scalar/Swagger UI | `dotnet-openapi` |
| map Result-to-HTTP, return RFC 9457 `ProblemDetails`, add a global `IExceptionHandler`, or validate via a FluentValidation endpoint filter | `dotnet-web-error-handling` |
| add authentication / authorization - JWT bearer, cookies, OIDC, ASP.NET Identity, policy-based authz, API keys | `dotnet-authentication` |
| build a gRPC service or client - `.proto` codegen, streaming modes, interceptors, status mapping, gRPC-Web | `dotnet-grpc` |
| push real-time updates to connected clients - SignalR hubs, strongly-typed `Hub<T>`, `IHubContext`, groups/presence, reconnection, Redis/Azure backplane scale-out | `dotnet-realtime` |

## Cross-cutting hardening

| You are about to... | Load |
|---|---|
| harden against OWASP Top 10 - injection, broken access control, SSRF, dependency audit, deprecated-security patterns | `dotnet-security` |
| use `System.Security.Cryptography` - hashing, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare | `dotnet-cryptography` |

## Data and EF

| You are about to... | Load |
|---|---|
| design or modify a schema, write SQL (raw or ORM), model a NoSQL doc, or create migrations / views / procs / indexes | `database-conventions` (data hub) |
| write EF Core / NHibernate data access - `Include`/`ThenInclude`, `AsSplitQuery`, `AsNoTracking`, query shaping | `dotnet-data-access` (its `references/efcore.md` or `references/nhibernate.md`) |
| diagnose ORM read-path performance - N+1, projection shape, change tracking, row count | `dotnet-data-access` (engine-side EXPLAIN / index / planner -> `postgres` or `sqlite`) |

## Messaging and orchestration

| You are about to... | Load |
|---|---|
| build broker-backed async messaging - Wolverine/MassTransit, transactional outbox, choreography vs sagas, message contracts | `dotnet-messaging` |
| wire local cloud-native orchestration - Aspire AppHost (`AddProject`/`AddPostgres`/`WithReference`/`WaitFor`), ServiceDefaults, dashboard | `dotnet-aspire` |

## Hosting and background work

| You are about to... | Load |
|---|---|
| write a worker service or in-process background task - `BackgroundService`/`IHostedService`, the `ExecuteAsync` exception trap, scoped services from the host, `PeriodicTimer`, graceful shutdown, `Channel<>`-backed work | `dotnet-hosted-services` |
| harden a long-running worker's outbound I/O - `HttpClient`/socket exhaustion, Polly v8 resilience, rate limiting, `ClientWebSocket` reconnect | `dotnet-hosted-services` (its `references/resilience-and-io.md`) |
| pick a scheduler (Hangfire / Quartz.NET / Coravel) or run a job on exactly one instance (leader election) | `dotnet-hosted-services` (its `references/scheduling-and-coordination.md`) |
| deploy or observe a headless worker - signals, systemd / container / Kubernetes shutdown, health checks without Kestrel, `[LoggerMessage]` | `dotnet-hosted-services` (its `references/deployment-and-observability.md`) |
| host a worker under the Windows Service Control Manager - `AddWindowsService` / `UseWindowsService`, SCM start/stop budgets and exit codes, scripted `sc.exe` install with recovery actions, service accounts, event-log source | `dotnet-windows-service` (load `dotnet-hosted-services` first - the host model it stacks on) |
| build a CLI tool - argument parsing (`System.CommandLine` 2.0 / `Spectre.Console.Cli` / `Cocona`), subcommands, exit codes | `dotnet-console-apps` |
| build a chat or trading bot - a Telegram / Discord / Slack / exchange SDK plugged into a `BackgroundService`, command handlers in DI | `dotnet-console-apps` (its `references/bot-sdks.md`) |

## Testing and quality

| You are about to... | Load |
|---|---|
| write, modify, or review .NET tests, or configure coverage (per-layer strategy, AAA, xUnit/NSubstitute/FluentAssertions) | `dotnet-testing` (test hub) |
| add container-backed integration tests | `dotnet-testing` (its `references/testcontainers.md`) |
| test an Aspire-orchestrated app end-to-end | `dotnet-testing` (its `references/aspire-integration-testing.md`) |
| add Verify / snapshot assertions | `dotnet-testing` (its `references/snapshot-testing.md`) |
| check a diff for reward-hacking / coverage-gaming shortcuts, or CRAP-score risk before claiming done | `dotnet-code-quality` (its reward-hacking list + `references/crap-analysis.md`) |

## Diagnostics and performance

| You are about to... | Load |
|---|---|
| add OpenTelemetry tracing / metrics instrumentation | `dotnet-web-backend` (wiring in the hub; manual spans / metrics in its `references/observability.md`) |
| write a microbenchmark (BenchmarkDotNet) | `dotnet-diagnostics` (its `references/microbenchmarking.md`) |
| capture or analyze a crash / hang dump | `dotnet-diagnostics` (its `references/dumps.md`) |
| inspect a compiled assembly's real API or behavior | `ilspy-decompile` |
| install or pin a .NET local tool (`dotnet tool` / manifest) | `dotnet-project-setup` (its `references/local-tools.md`) |

## Desktop

| You are about to... | Load |
|---|---|
| build a WPF desktop UI - strict MVVM, bindings, dependency/attached properties, async commands, `INotifyDataErrorInfo`, threading | `dotnet-wpf` |
| build or maintain a WinForms desktop UI - logic out of code-behind (MVP / the .NET 8 binding engine), control/component/GDI disposal, high-DPI, 4.8-vs-modern deltas | `dotnet-winforms` |

## Legacy: .NET Framework 4.8 (net48)

Maintaining or hardening a .NET Framework 4.8 codebase routes through a second table - one row per work area, each naming the owner skill and the net48 reference file inside it, plus the async-deadlock angle. It is `references/net-framework-48-routing.md`; open it only when the codebase is actually on net48.

## Notes

- **Rows that name a reference file.** Some rows route into a hub's reference file rather than a standalone skill - load the named skill, then open that reference.
- **Hubs vs leaves.** `csharp` is the C# baseline hub, `dotnet-web-backend` the web hub, `database-conventions` the data hub, `dotnet-testing` the test hub - a leaf specialist points UP to its hub, the hub points DOWN to its deep specialists, and this router indexes them all. Load the web hub before a web specialist; load the data hub before EF/SQL specialists.
- **Out of this router's scope.** Web front-end and mobile work belong to the Angular, TypeScript and Ionic/Capacitor conventions skills, whose descriptions lead with their own triggers - not here. Cross-cutting flow that is not .NET-specific - the security review, code verification, the documentation server library docs, git - lives in the project's `CLAUDE.md`.
