# Layered architecture in .NET

What each layer owns, which libraries a client project can take on, how desktop and web hosts share one core, and what each layer's tests cover. Load it beside the style you picked - the shared dependency rule and the pick-one rule are in `SKILL.md`, the four-project layout in `clean-architecture.md`, slices in `vertical-slice.md`, modules in `modular-monolith.md`. The licence boundaries, the support dates and the advisory below were checked against first-party pages on 2026-10-21 (sources at the end); fetch any version, date or template release through the documentation server at use - never quote one from here to a client.

## Contents

- The default
- Platform baseline
- The layer map
- Dependencies, projects and folders
- Styles compared
- ASP.NET Core
- WPF and desktop
- Other hosts
- Flag in review
- Tests per layer
- By project type
- Reference layout (medium or complex)
- Templates
- A new client project, by default
- Sources (checked 2026-10-21)

## The default

- **A modular monolith outside, vertical slices inside each module, a rich Domain project only in modules with real invariants.** Size the project count to the domain, never to a template, and hold the boundaries with architecture tests rather than review.
- The debate moved from 'layers or slices' to 'dependency direction plus feature cohesion plus module boundaries': slices are about cohesion, clean / onion about which way dependencies point, so the two compose (Comartin); 'minimize coupling between slices, and maximize coupling in a slice' (Bogard); slices inside modular-monolith modules, each module free to pick its style (Jovanovic). Both maintained clean-architecture templates now organize by feature.
- **Still contested:** a separate Application project, repositories over EF. Decide each once per codebase, write it down, and enforce it - never mix both answers in one solution.

## Platform baseline

- Target the current **LTS** for client work - .NET 10 as checked, supported to 2028-11-14; read the support table at use.
- **.NET 8 and .NET 9 both leave support on 2026-11-10** - a client system still on either moves to the LTS.
- An **STS** release (.NET 11) only for a feature that justifies it; nothing here needs one.

## The layer map

| Layer | Owns | Never holds |
|---|---|---|
| Presentation (endpoints, controllers, Blazor components, WPF Views + ViewModels) | binding, auth policies, request shape validation, request -> command, Result -> HTTP / ProblemDetails, UI state | business rules, `DbContext` queries, transactions, cross-aggregate orchestration |
| Application (use cases) | one handler per use case, orchestration, the transaction boundary, authorization that needs data, ports (email, storage, clock, external APIs), read-model queries | `HttpContext` / `IActionResult`, UI types, EF configuration, vendor SDKs |
| Domain | entities and aggregates with behaviour, value objects (strongly typed IDs), invariants, domain events and services, repository interfaces for aggregates when used | EF attributes, DTOs, logging or DI frameworks, async I/O |
| Infrastructure | `DbContext`, EF configurations and migrations, repository implementations, outbox, message bus, blob, email, third-party clients, `IOptions` binding | business decisions, use-case orchestration |
| Host / composition root (`Program.cs`, `App.xaml.cs`, the Aspire AppHost) | DI wiring, middleware, configuration, service defaults | anything else |

Cross-cutting concerns: logging, telemetry and resilience sit in the host or infrastructure; validation, transactions and authorization in the application pipeline (decorators or pipeline behaviours); none of them in a shared 'Common' project.

## Dependencies, projects and folders

- Presentation and Infrastructure both depend on Application, which depends on Domain; only the host references Infrastructure. An interface lives with its consumer (Application or Domain), never with its implementation.
- **Separate projects** when the compiler must enforce the direction: several hosts sharing the core (web plus WPF plus a worker), several teams, a long-lived system. **Folders plus architecture tests** for a small app.
- Either way, implementation types are `internal` and each layer or module exposes one `services.AddXxx()` extension; `InternalsVisibleTo` goes to its test project only. Central Package Management (`Directory.Packages.props`), `TreatWarningsAsErrors` and the .NET analyzers on from day one.
- The architecture-test skill owns the library choice and the rules.

## Styles compared

| Style | Fits | Real cost |
|---|---|---|
| Classic N-tier (UI -> BLL -> DAL) | legacy maintenance, trivial CRUD | business logic coupled to persistence, pass-through services, hard to test |
| Clean / onion / hexagonal (one rule, three names) | complex rules, long-lived systems, several delivery channels | project and abstraction overhead; one change touches four projects |
| Vertical slice | CRUD-heavy apps, fast-moving teams, read-heavy APIs | duplication unless shared rules are moved into the domain |
| Modular monolith | most multi-domain client systems, a later service extraction | module boundaries designed up front; cross-module events and an outbox |

Use the hexagonal words - ports and adapters - for every external integration even in slice-based code: a payment gateway, an HL7 / FHIR feed, an LMS, a sensor fleet.

## ASP.NET Core

- **Thin endpoints.** Minimal APIs with a route group per feature (or controllers where the client standard says so): bind, call one use case, map the result.
- **Mediator licences.** MediatR 13.0+ (from 2025-07-02) and AutoMapper 15.0+ are dual-licensed RPL-1.5 (reciprocal) or Lucky Penny commercial; MediatR 12.x stays Apache-2.0 and AutoMapper 14.0.0 and earlier MIT. The free Community licence covers an organization under $5M revenue that never took more than $10M outside capital, and on client work only when the CLIENT qualifies - the licence follows the client. For client work, in this order:
  1. Plain handler classes (`ICommandHandler<T>`) with decorators through Scrutor's `Decorate` (MIT) - no mediator at all.
  2. martinothamar `Mediator` 3.x (MIT, source-generated, Native AOT friendly).
  3. Wolverine (MIT) when the project also needs messaging, an outbox and sagas.
  4. Pinning MediatR 12.5.0 works but freezes the project on a line nobody patches.

  Never adopt a mediator for indirection alone.
- **Mapping.** Explicit mapping methods, written by hand - the C# conventions rule out object-mapping libraries. Never AutoMapper on client work: besides the licence, GHSA-rvv3-g6hj-g44x / CVE-2026-32933 (high, uncontrolled recursion, DoS) affects every version before 15.1.1 and 16.0.0 to 16.1.0 (fixed in 15.1.1 and 16.1.1), so the last free line, 14.0.0, carries it unpatched.
- **Validation in two places.** Request shape at the edge, with the validator the ASP.NET Core web hub picks and the endpoint filter the web error-handling skill owns. Invariants in domain constructors and methods, enforced whoever calls.
- **DTOs, never entities, cross the edge.** Commands and queries are records, query handlers project straight to DTOs with `Select`, and no `IQueryable` leaves a handler or repository.
- **EF Core and stores.** Where a query lives is the data-access skill's call - purpose-built read and write stores with named methods, never a generic `IRepository<T>`. A DDD aggregate gets its aggregate-scoped repository (`IOrderRepository`).
- **Transactions.** The use case is the transaction: one `SaveChangesAsync` per command; an explicit transaction or the EF execution strategy only for multi-step work; cross-module and integration events go through an outbox, never published inside the request after the commit.
- **Errors.** A Result for the expected (not found, validation, conflict), `IExceptionHandler` plus ProblemDetails for the unexpected - the web error-handling skill owns the wiring.
- **DI per layer.** `AddDomain()` / `AddApplication()` / `AddInfrastructure(IConfiguration)` / `AddOrdersModule()`; `Program.cs` only composes them; `ValidateScopes` and `ValidateOnBuild` on in Development.

## WPF and desktop

- **MVVM is the presentation layer.** A ViewModel calls application use cases or services - never `DbContext`, `HttpClient` details or a View type; the code-behind holds no business logic. The WPF skill owns the toolkit itself; this is the layering.
- **Generic Host.** Compose through the generic host as the WPF skill describes, registering the SAME `AddApplication()` / `AddInfrastructure()` the web host calls; it brings configuration, logging, `IOptions` and `IHostedService` for background sync.
- Navigation and dialogs sit behind `INavigationService` (ViewModel-first, a DataTemplate per ViewModel) and `IDialogService` / `IFilePickerService`; a ViewModel never calls `MessageBox` or `new Window()`.
- **No request scope on the desktop:** `IDbContextFactory<T>` or a DI scope per use-case call, never one `DbContext` for the app's life.
- **Share the core.** Domain and Application target plain `net10.0` (no `-windows`), so ASP.NET Core, WPF, MAUI, Blazor and worker hosts all reference them. A desktop client of a central system calls the API through a typed `HttpClient` that implements the same application port, with the DTOs in a small Contracts project, rather than opening the database itself.
- ViewModel tests construct it with fakes and assert property and command state; an injected `IDispatcher` keeps the UI thread out of them.

## Other hosts

- **Worker service** - a `BackgroundService` opens a scope per message or iteration and calls the same handlers.
- **Blazor** - Server and interactive server components call handlers through DI; WebAssembly goes through the API. Components stay as thin as ViewModels.
- **MAUI** - the WPF rules, the same toolkit.
- **Aspire** - AppHost and ServiceDefaults are composition-root concerns, not layers.

## Flag in review

- An anemic domain with fat services where invariants exist (dosage limits, booking overlaps, stock reservation) - move the rule into the entity; plain CRUD slices are exempt.
- Pass-through layers: controller -> service -> repository -> `DbContext` with no logic at any step - collapse into one slice handler.
- Leaking EF: entities as responses, lazy-loading proxies crossing layers, `IQueryable` from a repository.
- Over-abstraction: six to ten projects, a generic repository, a unit of work, a mediator and AutoMapper for a 15-endpoint CRUD app.
- A 'Common' or 'Shared' project growing into a dependency magnet; the shared kernel stays tiny (Result, base entity, typed-ID helpers).
- God services (an `OrderService` with 40 methods) - one handler per use case.
- Modules referencing each other's internals or forming a cycle - public contracts or integration events, cycles caught by the architecture tests.
- A template taken whole: Jason Taylor's still references MediatR and AutoMapper - swap them before client work over the Community thresholds.

## Tests per layer

The .NET testing skill owns what each layer's tests cover and how. The layering adds one project: **Architecture.Tests**, one per solution - layer direction, no EF in Domain, no ASP.NET in Application, handlers `internal sealed`, no module reaching another's internals - with the rules the architecture-test skill owns.

## By project type

| Project | Structure | Start from |
|---|---|---|
| Small CRUD / admin / MVP | one web project and one test project, `Features/` slices with their stores, no mediator | Ardalis.MinimalClean.Template; graduate later |
| Medium business app, one domain | Web / Application / Domain / Infrastructure, slices inside Application, architecture tests | Ardalis.CleanArchitecture.Template or Jason Taylor's, minus the commercial libraries |
| Complex rules (scheduling, clinical data, compliance) | a rich Domain project, a repository per aggregate, Result, an outbox | spend the abstraction budget here |
| Multi-domain, long-lived | modular monolith, `Modules/<Name>/{Api, Application, Domain, Infrastructure}` or one project per module, a schema per module, in-process events plus outbox, Aspire | extract a service only on a measured scale or team need |
| Desktop and web sharing logic | shared `net10.0` Domain / Application / Contracts, a WPF host and an API host, the desktop calling the API | one set of DI extensions, two composition roots |

## Reference layout (medium or complex)

The one folder layout for every internal style - `clean-architecture.md` points here.

```text
src/
  AppHost/            (Aspire, optional)
  ServiceDefaults/
  Web.Api/            Program.cs, Endpoints/<Feature>/, ExceptionHandlers/
  Application/        Features/<Feature>/{Command, Handler, Validator, Dto}.cs, Abstractions/ (ports)
  Domain/             <Aggregate>/{Entity, ValueObjects, Events, Errors}.cs
  Infrastructure/     Persistence/{AppDbContext, Configurations, Migrations}, Outbox/, Integrations/
  Desktop.Wpf/        (optional) Views/, ViewModels/, Services/ (navigation, dialogs)
tests/
  Domain.UnitTests/  Application.UnitTests/  Api.IntegrationTests/  Architecture.Tests/
Directory.Packages.props
```

## Templates

- **Ardalis.CleanArchitecture.Template** - `dotnet new clean-arch`, on martinothamar `Mediator`; its slice-based small-app sibling `dotnet new min-clean` ships as its own package, Ardalis.MinimalClean.Template. Best fit for DDD-leaning projects.
- **Clean.Architecture.Solution.Template** (Jason Taylor) - feature folders of command, validator and handler; it references MediatR and AutoMapper, so replace both before client work over the Community thresholds.

Read each template's current release and its dependencies at use.

## A new client project, by default

1. .NET 10, Minimal APIs, Central Package Management, nullable on, warnings as errors.
2. The smallest structure the table above allows; a project is added when an architecture test or a second host asks for it.
3. No commercially licensed library by default: plain handlers or `Mediator`, hand-written mapping methods, the web hub's validator.
4. Result plus ProblemDetails, `IExceptionHandler` for the unexpected.
5. Integration tests on a real database and architecture tests from the first sprint.
6. The choice recorded where the project keeps decisions (the record shape in `SKILL.md`).

## Sources (checked 2026-10-21)

- .NET support dates: dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
- MediatR / AutoMapper licence: github.com/LuckyPennySoftware/MediatR/blob/main/LICENSE.md, mediatr.io (Community licence FAQ), automapper.io
- AutoMapper advisory: github.com/advisories/GHSA-rvv3-g6hj-g44x
- Mediator: github.com/martinothamar/Mediator; Scrutor: github.com/khellang/Scrutor; Wolverine: github.com/JasperFx/wolverine
- Templates: nuget.org/packages/Ardalis.CleanArchitecture.Template, github.com/jasontaylordev/CleanArchitecture
