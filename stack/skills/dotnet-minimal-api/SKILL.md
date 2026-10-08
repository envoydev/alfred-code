---
name: dotnet-minimal-api
description: "Use before writing or editing ASP.NET Core minimal API endpoints - MapGet, MapPost, MapGroup, endpoint filters. Not for MVC controllers, gRPC or SignalR."
---

# ASP.NET Core minimal API - endpoint mechanics

This skill owns the shape of a minimal API endpoint: where it is registered, what it returns, how parameters bind, and how a cross-cutting concern hangs off it. It stops at the endpoint boundary. The pipeline-wide concerns - validation library choice, resilience, observability, response caching - belong to the ASP.NET Core cross-cutting hub, the failure-to-`ProblemDetails` contract to the HTTP error-handling skill, OpenAPI document generation and the docs UI to the OpenAPI skill, and auth configuration to the .NET authentication skill; the controller-based counterpart is the skill covering controller-based Web APIs. Where your skill list has none of them, the endpoint rules below still execute - keep the concern out of the lambda and report the surrounding wiring as unowned rather than inventing a second convention for it. Floor is .NET 8 / C# 12; anything newer is marked optional.

## When to use

- Covers how an endpoint is shaped and wired, not what surrounds it: MapGroup registration, TypedResults and Results-of-T outcome unions, IEndpointFilter, parameter binding, endpoint metadata, and hardened IFormFile uploads.
- Later additions (beyond the .NET 8 floor) are flagged optional.
- Do NOT use for MVC or API controllers (that is the controller-based Web API skill), gRPC, SignalR, or non-HTTP code.

## Where endpoints live

`Program.cs` is for wiring, not for routes. Each feature or resource owns one registration extension method that maps its group:

```csharp
public static class TodoEndpoints
{
    public static IEndpointRouteBuilder MapTodoEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/todos")
            .WithTags("Todos")
            .RequireAuthorization()
            .AddEndpointFilter<ValidationFilter<CreateTodoRequest>>();

        group.MapGet("/{id:guid}", GetTodo);
        group.MapPost("/", CreateTodo);
        return app;
    }
}
```

`Program.cs` then reads as a table of contents: `app.MapTodoEndpoints();`, `app.MapUserEndpoints();`. Never let `MapGet`/`MapPost` calls accumulate inline in `Program.cs` - it becomes an unsearchable wall and there is nowhere to attach feature-level filters.

`MapGroup` (.NET 7+) is the unit of shared configuration. Put the route prefix, tags, auth requirement, and group-wide filters on the group once; do not repeat them per endpoint. Route constraints (`{id:guid}`, `{page:int:min(1)}`) belong in the template - they reject bad input before any handler code runs.

## Keep handlers out of the lambda

The registration line declares the *shape* of an endpoint - verb, route, filters, declared outcomes. The *logic* belongs in a named static method or a handler class, referenced as a method group:

```csharp
group.MapGet("/{id:guid}", GetTodo);

static async Task<Results<Ok<TodoDto>, NotFound>> GetTodo(
    Guid id, ITodoService todos, CancellationToken ct)
{
    var todo = await todos.FindAsync(id, ct);
    return todo is null ? TypedResults.NotFound() : TypedResults.Ok(todo.ToDto());
}
```

A lambda is fine only while the body is a single expression. The moment it needs a local, a branch, or more than a line or two, promote it to a named method - it becomes testable in isolation, readable in a stack trace, and (this matters) eligible for XML-doc-driven OpenAPI summaries, which the inline lambda cannot carry.

Always accept a `CancellationToken` as the last parameter and thread it into every async call. The framework binds the request-aborted token automatically; an endpoint that ignores it keeps working after the client has hung up.

## What an endpoint returns

Return `TypedResults`, not the untyped `Results`. `TypedResults.Ok(dto)`, `TypedResults.Created(uri, dto)`, `TypedResults.NotFound()`, `TypedResults.ValidationProblem(errors)` each carry their status and body type in the return type, which gives the generated document a correct schema for free and lets a unit test assert on a strongly typed result instead of poking at an opaque `IResult`.

When a handler has more than one legitimate outcome, name them all in the signature with the `Results<...>` union (.NET 7+):

```csharp
static async Task<Results<Created<TodoDto>, ValidationProblem, Conflict>> CreateTodo(...)
```

The signature is now the spec - the status codes are visible at a glance and the compiler will not let a return path produce an undeclared one. Each arm must still be a `TypedResults` value implementing `IResult`.

Serialize DTOs, never domain entities or EF Core models. A `record` request and response type maps at the endpoint edge. Sending an entity over the wire leaks the persistence shape, drags lazy-loaded relations into the serializer, and couples the public contract to the schema.

Bind the request to its own DTO too, not the domain entity. A `CreateTodoRequest` / `UpdateTodoRequest` record - distinct from the persisted model, validated by the endpoint filter - is the contract in; the response DTO is the contract out. Binding straight onto an entity is mass-assignment: a caller can over-post a field the form never exposed - an owner id, an `IsAdmin` - and have it persisted. Let only mapped fields cross into domain logic.

## Per-endpoint cross-cutting: IEndpointFilter

`IEndpointFilter` (.NET 7+) is the hook for a concern scoped to a route or a group - validation, argument guards, short-circuiting - that does not belong in pipeline middleware. A filter sees the bound arguments and can inspect them, replace the result, or call the next stage:

```csharp
public class ValidationFilter<TRequest> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.GetArgument<TRequest>(0);
        // resolve a validator, validate, short-circuit on failure
        return await next(context);
    }
}
```

Reach for a filter over middleware when the concern is per-endpoint rather than per-request; middleware sees the raw pipeline and runs for everything, a filter runs only where it is attached and sees model-bound arguments. Attach it on the group (`.AddEndpointFilter<ValidationFilter<TRequest>>()`) when it applies to every route, or on a single endpoint when it does not.

Validation is the canonical filter: it runs before the handler and returns `TypedResults.ValidationProblem(...)` on failure. The error envelope, the global exception handler, and the `ProblemDetails` shape belong to the HTTP error-handling skill - do not assemble an error body here. The validator library choice belongs to the web hub. Authorization rides on `.RequireAuthorization("policy")`, but the policies and scheme are configured by the authentication skill.

## Parameter binding

Minimal APIs infer the binding source per parameter - route values, query string, header, body, and DI services are resolved by name and type. Make it explicit the moment it is ambiguous: `[FromBody]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromServices]`, and `[FromKeyedServices("name")]` (.NET 8) remove guesswork and prevent a refactor from silently changing where a value comes from.

When a handler grows a long parameter list, collect the inputs into one type and bind it with `[AsParameters]` (.NET 7+):

```csharp
public readonly record struct ListTodosQuery(
    [FromQuery] int Page, [FromQuery] int Size, [FromQuery] string? Filter);

group.MapGet("/", ([AsParameters] ListTodosQuery query, ...) => ...);
```

A `readonly record struct` keeps it allocation-light and immutable. For a custom type bound from the route or query, implement a static `TryParse`; for one bound from the whole request, implement a static `BindAsync`. The framework discovers these by convention - no attribute needed.

## Metadata

Tag every endpoint so the generated document and the test suite can address it: `.WithName(...)` for a stable operation id and link generation, `.WithTags(...)` to group it, `.WithSummary(...)` / `.WithDescription(...)` for human-readable docs. Declare outcomes the framework cannot infer with `.Produces<TodoDto>(StatusCodes.Status200OK)` and `.ProducesProblem(StatusCodes.Status404NotFound)`, so the document matches what the handler actually returns. Most of this is inferred when you use `TypedResults` and a `Results<>` union - the explicit calls fill the gaps. The document itself is produced by the skill covering OpenAPI generation and the docs UI.

## File uploads

Bind an upload with `IFormFile` (or `IFormFileCollection` for several); stream a large body with `MultipartReader`, section by section, rather than buffering it into memory. Before shipping an upload endpoint, read `references/file-uploads.md` - size caps in two places, magic-byte sniffing, server-side names, antiforgery.

## Prove the endpoint

A route that compiles is not a route that answers. Before any done word, call it three ways:

1. A valid request - quote the declared status and the body shape.
2. An invalid request - quote the single canonical 400 envelope.
3. A cancelled request - quote that the work stopped rather than running on.

Report: the three quoted results. An endpoint whose `CancellationToken` was never exercised is an endpoint that keeps working after the client has hung up.

## Anti-patterns

- A `try`/`catch`, an EF Core query, or any business logic inside the route lambda - the lambda is a route declaration, not a method body. Move the logic to a handler or service and let the global exception handler own the failure path.

## Newer versions (optional)

Everything above stands on the .NET 8 floor. The version-gated additions - the .NET 9+ built-in OpenAPI generator, .NET 10 first-party validation (and its no-async-rule gap), group-attachable rate limiting and output caching, Native AOT publishing, and .NET 10 server-sent events - live in `references/newer-versions.md`; open it when the project targets past the floor or is weighing AOT.
