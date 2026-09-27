---
name: dotnet-grpc
description: "Use when defining, implementing, or calling a gRPC service in .NET, or weighing gRPC against REST. Conventions where the .proto is the contract and Grpc.Tools generates from it at build, host with Grpc.AspNetCore (AddGrpc + MapGrpcService), consume through typed clients (AddGrpcClient over IHttpClientFactory) with a reused multiplexing channel, the four call shapes with a deadline and CancellationToken on every one, JWT-bearer or mTLS auth, interceptors for cross-cutting work, the gRPC health protocol, and gRPC-Web for browsers. Floors at .NET 8 / C# 12. Do NOT use for plain REST or minimal APIs - that is the minimal-API endpoint skill."
---

# .NET gRPC

gRPC is a contract-first RPC system: you declare services and messages in a `.proto`, code is generated from it on both ends, and calls travel as Protobuf over HTTP/2. Reach for it when the producer and consumer are both yours and you want a typed contract, low overhead, and streaming - internal service-to-service traffic above all. Stay on REST when the surface is a public or browser-facing API where ubiquity and human-readable bodies matter more; those endpoints belong to whichever skill covers your HTTP endpoint surface. This skill covers gRPC and nothing else. Baseline is .NET 8 / C# 12.

## The .proto is the single source of truth
The contract lives in the `.proto`, not in C#. Define every service and message there and let codegen produce the C# types; treat the generated `*.cs` as build output you never open or edit.

- Generate with `Grpc.Tools` (a build-time, dev-only package). Reference each proto in the csproj and pick the side that project needs:
  ```xml
  <ItemGroup>
    <Protobuf Include="Protos\orders.proto" GrpcServices="Server" />
  </ItemGroup>
  ```
  Use `GrpcServices="Client"` in a consumer, `"Both"` only when a project is both. The server generates an abstract base to override; the client generates a strongly typed stub.
- Share the contract by sharing the `.proto`, not the compiled assembly: keep protos in one folder (or a dedicated contracts project / package) that both sides reference, so server and client always regenerate from the same file.

### Evolve the schema additively, never in place
Protobuf field numbers are the wire identity - the field name is irrelevant on the wire, the tag is everything. Compatibility is a discipline, not a feature you turn on:
- Add fields with brand-new tag numbers; a reader that does not know a field skips it.
- Never renumber a field, never reuse a retired tag, and never change a field's type. Retire a field with `reserved` on its tag (and optionally its name) so nobody re-homes the number.
- Removing a field from the message is safe on the wire; reusing its number later is not.
- Prefer explicit-presence (`optional`) on scalar fields when 'unset' must be distinguishable from the zero value - otherwise `0`, `""`, and `false` are indistinguishable from absent.
- Enums must keep a zero member as the default/unknown value, and you add members, never reorder them.

## Server
Host gRPC in ASP.NET Core via `Grpc.AspNetCore`:

```csharp
builder.Services.AddGrpc();
// ...
app.MapGrpcService<OrdersService>();
```

- Keep the service class thin. It implements the generated base, translates the request message, and delegates to an application service; business logic does not live in the gRPC layer. Map the result back to a response message or throw an `RpcException` (see status mapping below).
- gRPC needs HTTP/2 end to end. In `Development` over Kestrel that works on plain HTTP; in production terminate with a proxy that speaks HTTP/2 to the backend (and keep ALPN intact). A request that arrives as HTTP/1.1 will fail the protocol check, not fall back.
- Reflection (`Grpc.AspNetCore.Server.Reflection`) lets tools like `grpcurl` discover services - enable it in non-production only; it exposes your full schema.
- Tune limits deliberately: `MaxReceiveMessageSize` / `MaxSendMessageSize` guard against oversized payloads (gRPC is for messages, not file transfer), and response compression (`ResponseCompressionAlgorithm = "gzip"`) pays off on larger bodies - but do not compress a response that mixes a secret with attacker-influenced data, since compressing them together is a CRIME/BREACH-style oracle that leaks the secret by size.

## Client
Register typed clients through DI so they ride `IHttpClientFactory` and a shared, correctly managed channel:

```csharp
builder.Services
    .AddGrpcClient<Orders.OrdersClient>(o => o.Address = new Uri("https://orders:5001"))
    .AddStandardResilienceHandler();
```

- `AddGrpcClient<T>` wires the generated client to a pooled `HttpClient`, so resilience (retries, timeouts, circuit breaker) layers on the same way it does for HTTP - the resilience configuration itself belongs to the ASP.NET Core cross-cutting hub; without one, configure the pipeline on the client registration here rather than skipping it. Inject the client; do not construct it.
- The channel is the expensive, long-lived object and it multiplexes many concurrent calls over one HTTP/2 connection. Create it once and reuse it - per-request `GrpcChannel.ForAddress(...)` is the classic gRPC performance bug. `AddGrpcClient` handles this for you; only hand-managed channels need the discipline spelled out.
- A unary call returns an awaitable plus access to response headers, trailers, and status via the call object when you need them.

## Pick the call shape on purpose
Four shapes, one decision per method:
- **Unary** - one request, one response. The default; use it unless a stream earns its keep.
- **Server streaming** - one request, a stream of responses. Feeds, progress, paged or live result sets the client reads to completion.
- **Client streaming** - a stream of requests, one response. Uploads and batch ingestion where the server aggregates.
- **Bidirectional streaming** - independent request and response streams over one call. Live, conversational exchange; the two directions are not lock-step.

Non-negotiable on every call, streaming or not:
- Set a **deadline** (`CallOptions.Deadline` / the `deadline:` argument). A call without one can hang indefinitely; the deadline is absolute (a point in time), it propagates to the server, and exceeding it surfaces as `DeadlineExceeded`.
- Honor the `CancellationToken` end to end - pass the incoming token down through your awaits on the server, and stop enumerating a stream when the caller cancels. Streaming reads must also drain or cancel; an abandoned stream leaks the call.

## Map domain outcomes to status codes
gRPC has its own status space; do not invent your own error envelope inside a successful response.
- Throw `RpcException` with the right `StatusCode` for an expected failure - `NotFound`, `InvalidArgument`, `AlreadyExists`, `PermissionDenied`, `Unauthenticated`, `FailedPrecondition`. The whether-to-throw-or-return call at the language level is the C# baseline's; here, the wire signal for a failure is a status code, not a 200 carrying an error flag.
- Reserve `Internal` (and `Unknown`) for genuine bugs - an unhandled exception maps there by default, and you must not leak its message or stack to the caller. Catch the expected cases and convert them to precise codes; let an interceptor handle the rest.
- Attach machine-readable detail with trailers / the rich error model when a status code alone is too coarse for the client to act on.

## Cross-cutting concerns live in interceptors
Put logging, authentication checks, exception-to-status mapping, validation, and metrics in `Interceptor` subclasses (server and client side), not copied into every method.
- A **server interceptor** is the single place to log calls with their method and status, translate an unhandled exception into a clean `Internal`/mapped status, and enforce request-level concerns - the gRPC analogue of middleware.
- A **client interceptor** is where you stamp outgoing metadata (auth tokens, correlation IDs) and observe call outcomes uniformly.
- Register server interceptors in `AddGrpc(o => o.Interceptors.Add<T>())`; add client interceptors via `.AddInterceptor<T>()` on the client registration.

## Auth
- Authenticate with a **JWT bearer** token carried in call metadata, or with **mTLS** (client certificates) for service-to-service trust - both are configured by the skill covering .NET authentication. For JWT, attach the token from a client interceptor so no method has to remember it.
- Enforce on the server with `.RequireAuthorization()` on the mapped service (or `[Authorize]` on the service class / methods), exactly as for HTTP endpoints. Authorization policies are the same machinery; gRPC just feeds them from metadata.

## Health and observability
- Orchestrator probes speak the standard gRPC health-checking protocol - the opt-in wiring is in `references/optional-surfaces.md`.
- gRPC integrates with the standard .NET observability stack; emit traces and metrics through it rather than bolting on a parallel logging path. Correlation and the broader telemetry setup belong to the ASP.NET Core cross-cutting hub.

## Prove the contract

Codegen makes a build green without proving a call works. Three lines before any done word: build to regenerate the stubs from the `.proto` and quote the result; call one method with `grpcurl` and quote the status; call it again with an already-expired deadline and quote the `DeadlineExceeded`. A method that never returns `DeadlineExceeded` is a method with no deadline wired.

## Browsers can't speak raw gRPC
A browser client needs **gRPC-Web** - the server and CORS wiring, and its streaming limits, are in `references/optional-surfaces.md`.
