# The web hub in full

Read before wiring an HTTP client, resilience, OpenTelemetry, a health check or typed options, and whenever a one-line rule in SKILL.md needs its reason or worked code.

**Contents:** [Architecture - pick exactly one, here](#architecture---pick-exactly-one-here), [HTTP and packages](#http-and-packages), [Validation](#validation), [Resilience](#resilience), [API design](#api-design), [Observability](#observability), [Caching](#caching), [Typed options and startup validation](#typed-options-and-startup-validation), [Tooling](#tooling)

## Architecture - pick exactly one, here

This is where the web hub pins the architecture rule, and it has one job: stop two patterns living side by side in one repo.

- In an established codebase, the existing architecture wins. Match its structure exactly; do not introduce a second pattern alongside the one already there, even a 'better' one. A repo with two architectures has neither.
- For greenfield work the architecture is a deliberate decision - load `dotnet-architecture` and follow its pick-one rule (one internal style per codebase, plus the topology and DDD-additive axes). The decision layer and each style's depth live in that hub; do not restate it here.
- Everything below this section - HTTP, validation, resilience, API design, observability, caching - applies unchanged whichever architecture you picked. These are pipeline concerns; they sit underneath the architecture, not inside it.

## HTTP and packages

Reach for `IHttpClientFactory` and never `new HttpClient()`. A factory-managed client pools and rotates its handlers, so it picks up DNS changes and avoids the socket exhaustion a long-lived raw client causes. Prefer a typed client (`AddHttpClient<TClient>()`) so the call surface is an injected, testable interface rather than a stringly-keyed lookup, and so the resilience handler below has one obvious place to attach.

Use `Directory.Packages.props` (central package management) wherever the project supports it, so every project resolves one version of each dependency - the CPM mechanics are `dotnet-project-setup`'s. Pin exact versions for anything security-sensitive rather than floating a range.

## Validation

FluentValidation is the default validator. Reserve ASP.NET Core `ModelState` / data annotations for genuinely trivial DTOs where a `[Required]` says all there is to say. The validation-error shape, the `ProblemDetails` mapping, and the endpoint filter that runs the validator are owned by `dotnet-web-error-handling` - do not assemble an error body or a filter here; this skill only fixes the library choice.

## Resilience

Outbound calls fail transiently; the policy for that is `Microsoft.Extensions.Http.Resilience` (Polly v8 under the hood). For an `HttpClient` pipeline, `AddStandardResilienceHandler()` adds a sensible default stack - rate limiter, total-request timeout, retry with backoff, circuit breaker, per-attempt timeout - in one line, and exposes the options for tuning:

```csharp
builder.Services.AddHttpClient<IOrdersClient, OrdersClient>(c =>
        c.BaseAddress = new Uri("https://orders"))
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(5);
        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
    });
```

Prefer the standard handler over a hand-rolled pipeline; the ordering of its strategies is the part that is easy to get subtly wrong. For a non-HTTP call - a database command, a broker publish - there is no handler to hang off, so build a Polly v8 `ResiliencePipeline` directly and invoke through it:

```csharp
var pipeline = new ResiliencePipelineBuilder()
    .AddRetry(new RetryStrategyOptions { MaxRetryAttempts = 3, BackoffType = DelayBackoffType.Exponential })
    .AddTimeout(TimeSpan.FromSeconds(10))
    .Build();

await pipeline.ExecuteAsync(async ct => await broker.PublishAsync(message, ct), ct);
```

One caution: do not stack a per-attempt resilience timeout on top of a client request timeout that is shorter - the outer one cancels mid-retry and the policy never gets to do its job. Let the resilience handler own the timing.

## API design

- Version every public route explicitly - `/api/v1/...` in the path, or an `Api-Version` header - and treat a shipped contract as frozen. Never break a versioned contract; add a v2 alongside it instead.
- **Resources are plural nouns in kebab-case** - `/api/v1/purchase-orders/{id}/line-items`, never `/getOrders` or `/purchaseOrder`. The HTTP method is the verb; a real domain action that is not create / read / replace / delete is a POST to a named sub-resource (`/orders/{id}/cancel`), not a GET with a side effect.
- **The success code says what happened**: 200 with a body; 201 for a POST that created, with a `Location` header naming the new resource (`TypedResults.Created(uri, dto)` / `CreatedAtRoute`); 202 when the work was only queued; 204 for success with no body (a DELETE, a PUT that returns nothing). Never 200 with an `{ "success": false }` body - a failure is a 4xx / 5xx through the house error mapping `dotnet-web-error-handling` owns (400 input, 404 absent, 409 conflict, 422 domain rule).
- **A collection is paged through one envelope**: `{ "items": [...], "nextCursor": "..." }`, with the cursor OPAQUE (an encoded keyset position, never a raw offset or id the client may do arithmetic on), no `nextCursor` on the last page, and a server-side maximum on the page size the client asks for. A `totalCount` is opt-in, never default - it is a second query over the whole filtered set. The keyset SQL behind the cursor is the database conventions' ground.
- Generate OpenAPI for every public HTTP API and keep request, response, and error shapes documented. The generator choice (Swashbuckle vs the .NET 9+ built-in) and the docs UI belong to the skill covering OpenAPI document generation; with none installed, generate the document with whatever the project already references and keep the shapes accurate rather than skipping the document.
- When you are designing or evolving a contract that other people consume - a REST surface or a published NuGet / shared library API - its `references/api-versioning.md` owns extend-only design, binary compatibility, API-approval testing, and safe versioning.

## Observability

Three signals, one destination. Wire all of it to OTLP and let the collector or backend fan it out per environment - that keeps the app code identical from laptop to production.

- **Logging:** structured throughout, via Serilog or `Microsoft.Extensions.Logging` with a structured sink; the template-not-interpolation convention is `csharp`'s - this file owns where the logs go.
- **Tracing and metrics:** OpenTelemetry on any service that runs in production, exporting to OTLP. The standard wiring is one builder chain:

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());

builder.Logging.AddOpenTelemetry(o =>
{
    o.IncludeFormattedMessage = true;
    o.AddOtlpExporter();
});
```

That covers the wiring this skill owns - registering the providers, the auto-instrumentation, and the OTLP exporter for traces, metrics, and logs. Deep manual instrumentation is a different job: custom `Activity` / span creation, getting metric cardinality right, zero-alloc `TagList`, and propagators all belong to its `references/observability.md`. Defer to that rather than hand-rolling spans here - do not restate its rules in service code.

- **Correlation IDs:** propagate on every cross-service hop via the W3C `traceparent` header (OpenTelemetry handles this once it is wired) and include the trace / correlation id in every log entry so a log line ties back to a trace.
- **Health checks:** `MapHealthChecks` for liveness and readiness on every web service, on separate endpoints per probe - liveness answers 'is the process alive', readiness answers 'can it serve traffic yet'. Map readiness only where an orchestrator polls it.

If the service runs under Aspire, ServiceDefaults is the composition point that registers exactly this OpenTelemetry, health-check, and resilience setup in one call - this skill decides *what* goes in, and the skill covering Aspire orchestration owns *where* it is assembled - without one, register the same three in `Program.cs` yourself.

- **Mask secrets before they reach a sink:** the no-secrets-in-logs convention is `csharp`'s; this file only adds the sink stake - a structured sink is queryable and long-retained, so a secret logged once is leaked for as long as the logs live.

## Caching

Cache only what a measurement says is worth caching, always with an expiry. Before adding one, read `references/caching.md` - it picks the tier by topology (`IMemoryCache`, `HybridCache`, Redis), gives the `HybridCache` registration, and covers key versioning and output caching.

## Typed options and startup validation

Bind every configuration section to a strongly-typed class and validate it once, at startup - a misconfigured service should fail to boot with a clear message, not throw ten minutes into production from deep inside a request. That fail-fast discipline is the single most important rule here, and it is one registration chain:

```csharp
builder.Services.AddOptions<SmtpSettings>()
    .BindConfiguration(SmtpSettings.SectionName)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

`.ValidateOnStart()` is the load-bearing call - without it validation runs lazily on first access, which defeats the point. Simple rules go on the class as data-annotation attributes. Anything an attribute cannot express, the choice between `IOptions` / `IOptionsSnapshot` / `IOptionsMonitor`, and the anti-patterns are `references/options.md` - read it before binding a section whose value changes at runtime.

Prove it once: blank a required setting, start the service, and quote the startup failure naming the section; restore it, start clean, and quote the health-check response. Validation that has never been seen to fail is validation nobody has wired.

## Tooling

- Run the repo's formatter before every commit and enforce it in CI (`dotnet-code-quality` owns the pick and the analyzer gates) - formatting drift should never reach review.
- Audit dependencies with `dotnet list package --vulnerable` before any release-bound change; `dotnet-security` (A06) carries the CI form with `--include-transitive`.
