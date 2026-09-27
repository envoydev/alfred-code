# API controller mechanics in full

Read before writing a new controller, an action filter, or a validation setup, and whenever a one-line rule in SKILL.md needs its reason or worked code.

**Contents:** [The controller and the [ApiController] attribute](#the-controller-and-the-apicontroller-attribute), [Attribute routing and route templates](#attribute-routing-and-route-templates), [What an action returns](#what-an-action-returns), [The automatic 400, and keeping it consistent with the house validation filter](#the-automatic-400-and-keeping-it-consistent-with-the-house-validation-filter), [Parameter binding sources](#parameter-binding-sources), [Action filters - the controller's per-action hook](#action-filters---the-controllers-per-action-hook), [Thin controllers](#thin-controllers), [ProblemDetails](#problemdetails), [Controllers or minimal APIs - the decision](#controllers-or-minimal-apis---the-decision), [Prove the pipeline](#prove-the-pipeline), [Anti-patterns](#anti-patterns), [Newer versions (optional)](#newer-versions-optional)

## The controller and the [ApiController] attribute

An API controller is a class deriving from `ControllerBase` (not `Controller` - that base drags in view support you do not want on a pure API) and decorated with `[ApiController]`:

```csharp
[ApiController]
[Route("api/v1/todos")]
public sealed class TodosController(ITodoService todos) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TodoDto>> GetById(Guid id, CancellationToken ct)
    {
        var todo = await todos.FindAsync(id, ct);
        return todo is null ? NotFound() : Ok(todo.ToDto());
    }
}
```

`[ApiController]` is the switch that turns a plain MVC controller into an API one. It is opt-in behavior, not cosmetic - it makes attribute routing mandatory, infers binding sources, infers `multipart/form-data` for `IFormFile` parameters, maps every error status code to `ProblemDetails`, and - the one to understand deeply below - triggers an automatic HTTP 400 on a model-validation failure. Apply it per controller, or once on an assembly-level marker so every controller in the project inherits it; do not sprinkle it inconsistently.

Use primary-constructor injection (C# 12) for the controller's collaborators, and accept a `CancellationToken` as the last parameter of every async action - the framework binds the request-aborted token, and an action that ignores it keeps working after the client has hung up.

## Attribute routing and route templates

With `[ApiController]`, routing is attribute-based, not convention-based - there is no `MapControllerRoute` pattern in play. The route lives on the controller and the action:

- `[Route("api/v1/todos")]` on the controller sets the prefix. Prefer an explicit literal version segment (`v1`) over the `[controller]` token - the token couples your URL to the class name and silently breaks the contract on a rename.
- `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpPatch]`, `[HttpDelete]` on the action carry the verb and the relative template: `[HttpGet("{id:guid}")]`, `[HttpPost]`.
- Route constraints belong in the template - `{id:guid}`, `{page:int:min(1)}` - so a malformed segment is a 404 before any action code runs, not a parse error inside it.
- `[ApiController]` requires attribute routing and will throw at startup if an action has no reachable route, which is the framework catching a wiring mistake early.

`app.MapControllers()` in `Program.cs` wires the whole set in one line; the routes themselves stay declared on the classes, so `Program.cs` is wiring, not a route table.

## What an action returns

Three return shapes exist; pick by what the action actually does.

- **`ActionResult<T>`** is the default for an action with a single success payload plus framework helpers. It beats `IActionResult` because the implicit cast operators let you `return dto;` (it wraps in an `ObjectResult`) or `return NotFound();` from the same method, and because `[ProducesResponseType(StatusCodes.Status200OK)]` can omit the `Type` - it is inferred from `T`. A naked `IEnumerable<T>` does not get the implicit cast (C# has no implicit operators on interfaces), so declare `ActionResult<IEnumerable<T>>` and materialize the sequence.
- **`IActionResult`** only where there is genuinely no single payload type to name - a download stream, a redirect, a pure status. It carries no payload type for the document, so reach for it rarely.
- **`Results<TResult1, TResultN>` / `TypedResults`** - the same `HttpResults` types minimal APIs use, and they work in a controller action. The generic union names every outcome in the signature, the compiler rejects a return path that produces an undeclared one, and the union retains OpenAPI metadata automatically. This is the pick when you want the controller's outcome contract to read like a minimal-API handler:

```csharp
[HttpPost]
public async Task<Results<Created<TodoDto>, ValidationProblem, Conflict>> Create(
    CreateTodoRequest request, CancellationToken ct)
{
    var result = await todos.CreateAsync(request, ct);
    return TypedResults.Created($"/api/v1/todos/{result.Id}", result.ToDto());
}
```

`TypedResults` types come from `Microsoft.AspNetCore.Http.HttpResults`, not the MVC `ControllerBase` helpers (`Ok`, `NotFound`, `CreatedAtAction`). Do not mix the two styles within one controller - either lean on the `ControllerBase` helpers with `ActionResult<T>`, or commit to `TypedResults` with the union. Recommendation: `ActionResult<T>` with the `ControllerBase` helpers for ordinary brownfield controllers (it is the idiom every MVC reader expects); `Results<>` only where you are deliberately keeping symmetry with minimal-API handlers or sharing handler code between the two.

Serialize DTOs, never domain entities or EF Core models - a `record` request and response type at the action edge. Sending an entity leaks the persistence shape, drags lazy-loaded relations into the serializer, and welds the public contract to the schema.

## The automatic 400, and keeping it consistent with the house validation filter

This is the section that matters most for the house style. `[ApiController]` installs `ModelStateInvalidFilter`, which inspects `ModelState` immediately before the action body and, if invalid, short-circuits with an automatic HTTP 400 carrying a `ValidationProblemDetails` body. So `if (!ModelState.IsValid) return BadRequest(ModelState);` is dead code under `[ApiController]` - never write it.

The house convention validates with FluentValidation inside a filter (owned by the HTTP error-handling skill), not with data annotations on the DTO. That filter is the single validation authority. The problem: the built-in `ModelStateInvalidFilter` still fires on any data-annotation or binding `ModelState` error, so you can end up with two competing 400 shapes - the framework's `ValidationProblemDetails` and the filter's `ProblemDetails` - racing for the same failure. Make the FluentValidation filter the only voice by suppressing the built-in filter:

```csharp
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.SuppressModelStateInvalidFilter = true;
});
```

With it suppressed, the FluentValidation filter runs and produces the one canonical error envelope. The related knobs on `ApiBehaviorOptions`, for the cases where you keep the built-in path instead:

- `InvalidModelStateResponseFactory` - the delegate that builds the automatic 400. Override it to reshape the body or log the failure; by default it uses `ProblemDetailsFactory` to emit a `ValidationProblemDetails`.
- `SuppressMapClientErrors` - stops `[ApiController]` from converting bare error status codes (a `NotFound()` with no body) into `ProblemDetails`. Leave it off; the mapping is what gives every 4xx/5xx an RFC-shaped body for free.
- If you do keep model-state validation on a given action and need a *custom* 400 that matches the automatic one, call `ValidationProblem()` (which returns a `ValidationProblemDetails`), never `BadRequest(...)` with an ad-hoc object - that is how the two paths stay shape-consistent.

Do not assemble the error body here (see ProblemDetails below) - this section only decides where the validation gate sits and how to stop the framework from competing with it.

## Parameter binding sources

`[ApiController]` infers a binding source per parameter so you usually write none:

- A simple type matching a route token binds from the route; other simple types bind from the query string.
- A complex type **not** registered in DI binds from the body (`[FromBody]`), with at most one body parameter per action. Special framework types - `CancellationToken`, `IFormCollection` - are exempt from body inference.
- A complex type **registered** in DI binds from services (`[FromServices]` is inferred for `[ApiController]` parameters).
- `IFormFile` / `IFormFileCollection` infer `multipart/form-data`.

Make the source explicit the moment it is ambiguous or load-bearing: `[FromBody]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromForm]`, `[FromServices]`, `[FromKeyedServices("name")]` (.NET 8). An explicit attribute documents intent and stops a refactor from silently moving where a value comes from. To turn off a particular inference globally there are escape hatches - `SuppressInferBindingSourcesForParameters` and `DisableImplicitFromServicesParameters` on `ApiBehaviorOptions` - but prefer an explicit attribute on the one parameter over flipping a global switch.

When an action's parameter list grows long, collect the inputs into one complex-type parameter and mark it with the source - `[FromQuery]` for a query model - so MVC binds every property from it. That is MVC's own recursive model binding, not the minimal-API `[AsParameters]` attribute: that one belongs to the minimal-API surface and MVC model binding ignores it. A `readonly record struct` is the allocation-light, immutable carrier:

```csharp
public readonly record struct ListTodosQuery(int Page, int Size, string? Filter);

[HttpGet]
public async Task<ActionResult<IReadOnlyList<TodoDto>>> List(
    [FromQuery] ListTodosQuery query, CancellationToken ct) => ...;
```

## Action filters - the controller's per-action hook

`IAsyncActionFilter` is the controller analogue of the minimal-API `IEndpointFilter`: a concern scoped to an action or a controller - argument guards, validation, short-circuiting - that sees the model-bound arguments and can replace the result or call the next stage. Always implement the async interface, never the synchronous `IActionFilter`; the runtime checks for the async one first, and a synchronous filter that blocks on I/O starves the thread pool. Implement one or the other, not both.

```csharp
public sealed class ValidationFilter<TRequest> : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(
        ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.ActionArguments.TryGetValue("request", out var arg) && arg is TRequest request)
        {
            // resolve a validator, validate; on failure set context.Result to short-circuit
        }
        await next();   // omit this call to short-circuit; the action never runs
    }
}
```

`ActionExecutingContext.ActionArguments` exposes the bound parameters before the action runs; setting `context.Result` (or simply not calling `next()`) short-circuits the pipeline so the action body never executes. The post-action `ActionExecutedContext` carries `Result`, `Exception`, and `Canceled` for the after side.

Where filters live in the request pipeline, outermost first: authorization filters, then resource filters, then model binding, then **action filters**, then the action, then result filters; exception filters wrap unhandled action faults. An action filter therefore sees bound arguments but runs inside authorization - it is the wrong place for an auth decision (that is `[Authorize]`, configured by the authentication skill).

Filter **ordering** is two-dimensional. By default, scope decides: global filters wrap controller filters wrap action filters - so a global filter's *before* runs first and its *after* runs last. To override that, implement `IOrderedFilter` and set `Order`; a lower `Order` runs its before-code earlier and its after-code later, and `Order` always beats scope. Register a filter globally in `AddControllers(o => o.Filters.Add<T>())`, or attach it as an attribute on a controller or action for narrower scope.

## Thin controllers

A controller action is a translation layer, not a place for logic. It binds the request, hands a DTO or its fields to an injected application service, and maps the result to an `ActionResult`. Business rules, EF Core queries, transactions, and orchestration live in the service - not in the action and never smeared across a filter:

```csharp
[HttpPost("{id:guid}/complete")]
public async Task<ActionResult<TodoDto>> Complete(Guid id, CancellationToken ct)
{
    var result = await todos.CompleteAsync(id, ct);
    return result.IsNotFound ? NotFound() : Ok(result.Value.ToDto());
}
```

A thin action is testable through the service in isolation, keeps the controller readable, and means a second transport (a minimal-API endpoint, a message handler) can call the same service without duplicating logic. The architecture that organizes those services - VSA, clean, layered - is chosen once per project by the web hub, never inside the controller.

## ProblemDetails

Errors leave a controller as RFC-shaped `ProblemDetails`. `[ApiController]` already maps bare error status codes to it, and the `ControllerBase.Problem(...)` / `ValidationProblem(...)` helpers produce it explicitly. The global handler, the envelope, the status map and the validation filter are the HTTP error-handling contract named at the top - reuse it; where nothing covers it, define the map once in `Program.cs`, never per action.

## Controllers or minimal APIs - the decision

Both produce the same HTTP service; the choice is about fit, not capability. Greenfield defaults to minimal APIs; reach for controllers when something concrete calls for them - an existing controller-based codebase, MVC views or Razor on the same base, or tooling convention-bound to controllers (OData, attribute-based API versioning). One default per repo, a controller slice only where one of those reasons names itself; the full argument is `references/controllers-or-minimal-apis.md`.

## Prove the pipeline

A controller that compiles is not a controller that behaves. Before any done word, call the action three ways and quote each result: a valid request returns the expected 2xx and body; an invalid one returns a single 400 in the canonical envelope (two competing shapes means the built-in filter was never suppressed); and an unauthorized one returns 401 or 403 rather than falling through to the action.

## Anti-patterns

- Business logic, EF Core queries, or a `try`/`catch` in the action body - an action is a transport adapter, not a method body. Delegate to a service and let the global exception handler own the failure path.
- Two HTTP styles (controllers and minimal APIs) interleaved in one repo with no boundary; pick one as the default and confine the other to its justified slice.

## Newer versions (optional)

Targeting .NET 9 or 10? The optional deltas - the built-in OpenAPI generator, the unified validation APIs, the `IActionContextAccessor` obsoletion - are in `references/newer-versions.md`.
