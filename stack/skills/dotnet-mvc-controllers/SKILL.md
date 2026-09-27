---
name: dotnet-mvc-controllers
description: "Use before writing or editing ASP.NET Core API controllers and action filters - the ApiController attribute, attribute routing, ActionResult of T versus IActionResult or typed HttpResults, the automatic 400 filter (ApiBehaviorOptions, SuppressModelStateInvalidFilter), binding sources and From-attributes, IAsyncActionFilter. Floors at .NET 8 / C# 12; 9/10 deltas flagged optional. Do NOT use for minimal APIs (that is the minimal-API endpoint skill), MVC views, Razor Pages, gRPC, SignalR, or non-HTTP code."
---

# ASP.NET Core controllers - API controller mechanics

The shape of a controller-based Web API: how a controller is declared, how routes attach, what an action returns, how parameters bind, and how a cross-cutting concern hangs off an action - the brownfield-friendly counterpart to minimal APIs. It stops at the controller boundary: validation library, OpenAPI, resilience and observability belong to the ASP.NET Core cross-cutting hub, the `ProblemDetails` contract and the FluentValidation filter to the HTTP error-handling skill, auth to the .NET authentication skill; with none of them installed, keep the concern out of the action and report the wiring as unowned. Floor .NET 8 / C# 12; .NET Framework 4.8 is `references/net-framework-48.md`.

**Each rule below is one line; `references/controllers-in-full.md` carries it with its reason and worked code - read it before a new controller, an action filter, or a validation setup.**

## Declaring and routing
- Derive from `ControllerBase` (never `Controller`), decorate with `[ApiController]` - per controller or once assembly-wide, never inconsistently. It makes routing attribute-based, infers binding sources, maps errors to `ProblemDetails`, and triggers the automatic 400.
- Primary-constructor injection; a `CancellationToken` last on every async action.
- `[Route("api/v1/todos")]` with a literal version segment, never the `[controller]` token; the verb attribute carries the relative template; constraints in the template (`{id:guid}`); `app.MapControllers()` is the only wiring.

## What an action returns
- `ActionResult<T>` with the `ControllerBase` helpers by default (declare `ActionResult<IEnumerable<T>>`, never a naked `IEnumerable<T>`); `IActionResult` only with no single payload type; `Results<...>` / `TypedResults` only for deliberate minimal-API symmetry - never both styles in one controller.
- Serialize DTOs, never domain entities or EF Core models - a `record` request and response at the action edge.

## The automatic 400 and the house validation filter
- `if (!ModelState.IsValid)` is dead code under `[ApiController]` - never write it.
- The house FluentValidation filter is the single validation authority, so suppress the built-in one: `builder.Services.Configure<ApiBehaviorOptions>(o => o.SuppressModelStateInvalidFilter = true);` - two competing 400 shapes is the failure.
- Keep `SuppressMapClientErrors` off; a custom 400 on the built-in path is `ValidationProblem()`, never `BadRequest(...)` with an ad-hoc body.

## Binding
- Trust the inference (route, query, one body, services, `multipart/form-data`) until a source is ambiguous or load-bearing - then say it: `[FromBody]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromForm]`, `[FromServices]`, `[FromKeyedServices]`. Prefer the attribute over a global `ApiBehaviorOptions` switch.
- A long parameter list becomes one `[FromQuery]` complex type (a `readonly record struct`) - MVC's recursive binding, not the minimal-API `[AsParameters]`.

## Action filters
- `IAsyncActionFilter`, never the synchronous `IActionFilter`, never both; `ActionArguments` holds the bound values, and setting `context.Result` (or skipping `next()`) short-circuits.
- Filters run inside authorization - never an auth decision there. Scope orders them (global wraps controller wraps action) unless `IOrderedFilter.Order` says otherwise.

## Thin controllers and errors
- An action binds, delegates to an injected application service, and maps the result - business rules, EF queries, transactions and `try`/`catch` live in the service.
- Errors leave as RFC `ProblemDetails` through the error-handling skill's contract; where nothing covers it, one map in `Program.cs`, never per action.
- Greenfield defaults to minimal APIs; controllers where an existing codebase, MVC views, or controller-bound tooling (OData, attribute versioning) calls for them - one default per repo (`references/controllers-or-minimal-apis.md`).

## Prove the pipeline

Before any done word, call the action three ways and quote each: a valid request's 2xx and body; an invalid one's single 400 in the canonical envelope (two shapes means the built-in filter was never suppressed); an unauthorized one's 401 or 403.

.NET 9 / 10 deltas (the built-in OpenAPI generator, unified validation, the `IActionContextAccessor` obsoletion): `references/newer-versions.md`.
