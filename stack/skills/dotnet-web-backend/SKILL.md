---
name: dotnet-web-backend
description: "Use first for any ASP.NET Core, Web API, minimal API or microservice work - this is the .NET web hub, loaded ahead of the focused companion that covers the how. Owns the architecture-neutral cross-cutting baseline every ASP.NET Core service shares: IHttpClientFactory, FluentValidation, resilience via Microsoft.Extensions.Http.Resilience, API versioning, typed options with startup validation (IOptions / ValidateOnStart), observability (structured logging, OpenTelemetry to OTLP, correlation IDs, health checks), and caching (IMemoryCache, HybridCache, Redis). Floors at .NET 8 / C# 12. Do NOT use for console binaries, CLI tools, desktop apps, WPF/MAUI, daemons, or message-only consumers."
---

# .NET Web / HTTP Service Conventions

The web hub - the first skill to load for any HTTP service, where the cross-cutting concerns every ASP.NET Core app shares are decided once. Architecture-neutral: it fixes how the HTTP client, validation, resilience, observability, caching and options behave, and sends endpoint mechanics, errors, OpenAPI and auth to a focused companion. Floor .NET 8 / C# 12. .NET Framework 4.8 (MVC 5 / Web API 2, OWIN, no `IHttpClientFactory`): `references/net-framework-48.md`.

**Each rule below is one line; `references/hub-in-full.md` carries it with its reason and worked code - read it before wiring an HTTP client, resilience, OpenTelemetry, a health check or typed options.**

## Architecture - pick exactly one, here

An established codebase's architecture wins - match it, never add a second pattern beside it. Greenfield: load `dotnet-architecture` and follow its pick-one rule. Everything below applies whichever architecture was picked.

## The cross-cutting rules

- **HTTP:** `IHttpClientFactory` with a typed client (`AddHttpClient<TClient>()`), never `new HttpClient()`. Central package management wherever supported (`dotnet-project-setup` owns the mechanics); exact versions for anything security-sensitive.
- **Validation:** FluentValidation by default, data annotations only for a trivial DTO; the error shape and the validation filter are `dotnet-web-error-handling`'s.
- **Resilience:** `AddStandardResilienceHandler()` on an `HttpClient` pipeline, tuned through its options - never a hand-rolled stack; a non-HTTP call goes through a Polly v8 `ResiliencePipeline`. Never a client timeout shorter than the resilience timeout.
- **API design:** version every public route (`/api/v1/...`) and never break a shipped contract - add v2 beside it; plural kebab-case nouns, a domain action as a POST to a named sub-resource; the success code says what happened (201 with `Location`, 202 queued, 204 no body) and a failure is a 4xx / 5xx, never 200 with `success: false`; a collection pages through one envelope with an OPAQUE cursor and a server-side page-size cap, `totalCount` opt-in. Every public HTTP API has an accurate OpenAPI document (the skill covering OpenAPI generation picks the generator). A contract others consume: `references/api-versioning.md`.
- **Observability:** structured logs, OpenTelemetry traces and metrics, all to OTLP; W3C `traceparent` correlation with the trace id in every log line; `MapHealthChecks` with separate liveness and readiness endpoints. Deep manual instrumentation is `references/observability.md`. Under Aspire, ServiceDefaults assembles the same three - without it, register them in `Program.cs`. A secret never reaches a sink.
- **Caching:** only what a measurement says is worth it, always with an expiry - read `references/caching.md` before adding one.
- **Typed options:** bind every section to a typed class and validate at startup - the load-bearing call is `.ValidateOnStart()`:

  ```csharp
  builder.Services.AddOptions<SmtpSettings>()
      .BindConfiguration(SmtpSettings.SectionName)
      .ValidateDataAnnotations()
      .ValidateOnStart();
  ```

  Read `references/options.md` before a section whose value changes at runtime. Prove it once: blank a required setting and quote the startup failure, restore it and quote the health check.
- **Tooling:** the repo's formatter before every commit, enforced in CI (`dotnet-code-quality`); `dotnet list package --vulnerable` before a release-bound change (`dotnet-security`, A06).

## Deep specialists

This skill is the cross-cutting baseline; load the focused companion for the *how*.

**Availability** - the rows below name specialists installed only where the project's stack or evidence shows the area; a row whose skill is not in your skill list means the area is absent here - work from this hub and skip the row.

Default a new HTTP surface to minimal APIs: one default per repo, a controller slice only where the decision section names the reason. That decision - when controllers earn their place - is owned by the controller-based Web API skill.

- Endpoint mechanics (MapGroup, TypedResults, filters, binding, uploads) -> `dotnet-minimal-api`
- Controller-based Web API ([ApiController], attribute routing, action filters) -> `dotnet-mvc-controllers`
- AuthN / authZ (JWT/OIDC/Identity/policies) -> `dotnet-authentication`
- OWASP hardening / SSRF / dependency audit -> `dotnet-security`
- gRPC services -> `dotnet-grpc`
- Real-time push to connected clients (SignalR hubs, backplane scale-out) -> `dotnet-realtime`
- Background workers / hosted tasks (a daemon, an in-process `BackgroundService`, a message-only consumer's host) -> `dotnet-hosted-services`
- Broker messaging / outbox / sagas -> `dotnet-messaging`
- Per-layer tests -> `dotnet-testing`

Errors (`dotnet-web-error-handling`), the OpenAPI document (`dotnet-openapi`), deep manual OpenTelemetry (`references/observability.md`), and Aspire (`dotnet-aspire`) are routed where they arise in the sections above. The full index of every .NET specialist skill is the `dotnet` router.
