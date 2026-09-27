---
name: dotnet-minimal-api
description: "Use before writing or editing ASP.NET Core minimal API endpoints - MapGet, MapPost, MapGroup, endpoint filters. Covers how an endpoint is shaped and wired, not what surrounds it: MapGroup registration, TypedResults and Results-of-T outcome unions, IEndpointFilter, parameter binding, endpoint metadata, and hardened IFormFile uploads. Floors at .NET 8 / C# 12; later additions are flagged optional. Do NOT use for MVC or API controllers (that is the controller-based Web API skill), gRPC, SignalR, or non-HTTP code."
---

# ASP.NET Core minimal API - endpoint mechanics

This skill owns the shape of a minimal API endpoint: where it is registered, what it returns, how parameters bind, and how a cross-cutting concern hangs off it. It stops at the endpoint boundary. The pipeline-wide concerns - OpenAPI document generation, validation library choice, resilience, observability, response caching - belong to the ASP.NET Core cross-cutting hub, the failure-to-`ProblemDetails` contract to the HTTP error-handling skill, the docs UI to the OpenAPI skill, and auth configuration to the .NET authentication skill; the controller-based counterpart is the skill covering controller-based Web APIs. Where your skill list has none of them, the endpoint rules below still execute - keep the concern out of the lambda and report the surrounding wiring as unowned rather than inventing a second convention for it. Floor is .NET 8 / C# 12; anything newer is marked optional.

**Each rule below is one line; `references/endpoints-in-full.md` carries it with its reason and worked code - read it before a new feature's endpoints, a filter, or an upload.**

## Registration and handlers
- `Program.cs` is wiring, never routes: each feature owns one `Map<Feature>Endpoints` extension that maps its `MapGroup`, and `Program.cs` reads as a table of contents.
- The group carries the prefix, tags, auth requirement and group-wide filters once; route constraints (`{id:guid}`) in the template.
- Logic lives in a named static method or handler class referenced as a method group - a lambda only while the body is one expression.
- A `CancellationToken` last on every handler, threaded into every async call.

## Results and DTOs
- `TypedResults`, never untyped `Results`; more than one outcome is a `Results<...>` union in the signature.
- Serialize DTOs, never domain entities or EF Core models - a `record` response at the edge, and a request record of its own. Binding straight onto an entity is mass-assignment: a caller can over-post a field the form never exposed - an owner id, an `IsAdmin` - and have it persisted.

## Filters, binding, metadata
- `IEndpointFilter` for a per-route or per-group concern (validation first of all, returning `TypedResults.ValidationProblem(...)`); middleware only for per-request concerns. The error envelope is the error-handling skill's, the validator library the web hub's, the policies the authentication skill's.
- Trust the binding inference until a source is ambiguous - then `[FromBody]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromServices]`, `[FromKeyedServices]`; a long parameter list becomes an `[AsParameters]` `readonly record struct`; a custom type binds through a static `TryParse` or `BindAsync`.
- `.WithName()`, `.WithTags()`, `.WithSummary()` on every endpoint; `.Produces<T>()` / `.ProducesProblem()` for what `TypedResults` cannot infer.

## Uploads
- `IFormFile`, streamed with `MultipartReader` when large; cap `MaxRequestBodySize` AND `MultipartBodyLengthLimit`; sniff the real type from its magic bytes against an allowlist; save under a server-generated name, never the supplied one; antiforgery stays on unless the endpoint is not cookie-exposed.

## Prove the endpoint

Call it three ways before any done word and quote each: a valid request's declared status and body, an invalid one's canonical 400, and a cancelled request that stops the work. No `try` / `catch`, EF query or business logic in a route lambda. .NET 9+ additions (the built-in OpenAPI generator, .NET 10 validation, group rate limiting and output caching, AOT, server-sent events): `references/newer-versions.md`.
