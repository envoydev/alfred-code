---
name: dotnet-web-error-handling
description: "Use when deciding how an ASP.NET Core API reports failures - ProblemDetails, IExceptionHandler, Result types, error envelopes. Not for non-HTTP code."
---

# ASP.NET Core error handling

An API has exactly two ways to report that something went wrong, and they must never blur together:

- **Expected failures** - validation is rejected, the row is not there, a uniqueness rule is broken. These are part of the contract, so they are *return values*: a `Result` / `Result<T>` or a closed error union the caller branches on.
- **Unexpected failures** - a dependency is down, an invariant is violated, a bug throws. These are exceptions, and they are caught in exactly one place: a global handler.

The language-level call - when to throw versus when to return - is `csharp`. This skill is only about how a failure reaches the wire. Floor is .NET 8 / C# 12.

## When to use

- Also fires on: UseExceptionHandler, FluentValidation endpoint filters.
- Keeps expected failures (Result) apart from unexpected ones (exceptions caught once).
- Not for non-HTTP code - the C# baseline's exception and Result rules cover that.

## Model expected failures as return values
- An application or domain operation that can fail in a foreseeable way returns its outcome instead of throwing. Two shapes both work - `csharp` owns the shape call (it prefers a domain-specific result when the failure modes are known); pick one per codebase and stay with it:
  - a `Result<T>` holding either a value or one-or-more errors (`IsSuccess`, `Value`, `Errors`);
  - a closed union - `abstract record Error(string Code, string Message);` with `sealed record NotFound(...) : Error` and friends - resolved by a `switch` expression.
- Throwing to signal an ordinary outcome (not found, invalid input, conflict) is the thing to avoid: it is slower on the failure path, it hides the failure from the method signature, and it pushes a `try`/`catch` to every call site.

## One place maps an error to a status
- Convert the domain error to an HTTP status in a single helper - an `Error -> IResult` switch, or a `result.Match(onOk, onError)` extension - so an identical failure yields an identical status and body across every endpoint. Handlers call the helper; they do not each pick a status code.
- House mapping, kept in one file: invalid input 400, unauthenticated 401, forbidden 403, missing resource 404, conflict/uniqueness 409, broken domain rule 422, anything unmapped 500. Ownership decides between the two middle ones: a resource the caller may not see returns 404, never 403 - no existence disclosure; 403 only where the caller can see the resource but not the action.

```csharp
public abstract record Error(string Code, string Message);
public sealed record NotFound(string Message) : Error("not_found", Message);
public sealed record Conflict(string Message) : Error("conflict", Message);
public sealed record Validation(IDictionary<string, string[]> Errors) : Error("validation", "Validation failed");

// the single map - every endpoint routes through it
public static IResult ToProblem(this Error error) => error switch
{
    Validation v => TypedResults.ValidationProblem(v.Errors),
    NotFound n   => TypedResults.Problem(n.Message, statusCode: StatusCodes.Status404NotFound),
    Conflict c   => TypedResults.Problem(c.Message, statusCode: StatusCodes.Status409Conflict),
    _            => TypedResults.Problem(statusCode: StatusCodes.Status500InternalServerError),
};
```

A `Result<T>` carries either the value or one such `Error`; the handler ends with `result.Match(ok => TypedResults.Ok(ok), err => err.ToProblem())` so the status is decided in one place, not at each call site.

## ProblemDetails is the only error body (RFC 9457)
- Every non-2xx response is a `ProblemDetails`, or a `ValidationProblemDetails` for field-level errors - `type`, `title`, `status`, `detail`, `instance`, and an `errors` map where relevant. No bespoke `{ error: ... }` envelope, anywhere.
- Register `AddProblemDetails()` (.NET 7+) so framework-generated failures (binding 400s, 404s, 415s) emerge in the same shape as the ones you write. In its customization callback, attach a `traceId` extension so a client-side error can be traced back to the logs - the trace/correlation source itself is the ASP.NET Core cross-cutting hub's.
- Emit from handlers with `TypedResults.Problem(...)` and `TypedResults.ValidationProblem(errors)`; never assemble the JSON by hand.
- This contract is transport-shared: a controller-based API reuses the same `AddProblemDetails()`, the same global `IExceptionHandler`, and the same FluentValidation filter - it emits via the `ControllerBase.Problem(...)`/`ValidationProblem(...)` helpers instead of `TypedResults`, but the envelope and the handler are identical. Do not re-shape errors per transport.

## One global handler for the unexpected
- **.NET 8+ (preferred):** implement `IExceptionHandler.TryHandleAsync`, register with `AddExceptionHandler<T>()` next to `AddProblemDetails()`, and switch it on with `app.UseExceptionHandler()`. Register several handlers in order if you want known-exception-to-status mapping ahead of a final catch-all.
- The handler must: log the exception once with structured context (route, trace ID), default to 500 but map recognized exception types to their status, suppress `detail` and stack traces outside `Development`, and still answer in RFC 9457. It is the single `catch` for unexpected errors in the whole application.

```csharp
public sealed class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> log, IProblemDetailsService problems)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        log.LogError(ex, "Unhandled exception for {Method} {Path}", ctx.Request.Method, ctx.Request.Path);

        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        return await problems.TryWriteAsync(new()
        {
            HttpContext = ctx,
            // nested initializer: sets Title/Status on the ProblemDetails the context
            // lazily creates via its getter, rather than replacing that instance
            ProblemDetails = { Title = "An unexpected error occurred", Status = ctx.Response.StatusCode },
            // AddProblemDetails' callback already stamps the traceId extension
        });
    }
}

// Program.cs - register next to AddProblemDetails(), switch on with UseExceptionHandler()
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();
app.UseExceptionHandler();
```

## Validate at the edge
- Validate the request before the handler body runs, inside an `IEndpointFilter` (`ValidationFilter<TRequest>`) that short-circuits with `TypedResults.ValidationProblem(...)` on failure - this is the filter the minimal-API surface attaches to its route groups. FluentValidation is the default; fall back to built-in data annotations / `ModelState` only for trivial DTOs.
- A validation failure is an expected failure - it returns from the filter and never reaches the global exception handler.

## Prove it

Before any done word, send three requests and quote each response: an expected failure returns its mapped status as `ProblemDetails`; a thrown exception returns one 500 `ProblemDetails` with no stack trace outside `Development`; an invalid request returns one `ValidationProblemDetails` 400 from the filter, never from the global handler.

## Don't
- Wrap each endpoint body in its own `try`/`catch` rather than relying on the one global handler.
- Swallow an exception - an empty `catch`, or a `catch` that logs and limps on as if nothing happened. Handle it specifically or let it reach the handler.
