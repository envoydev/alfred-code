---
name: dotnet-aspire
description: "Load when scaffolding or editing an AppHost or ServiceDefaults, declaring resources and references, wiring discovery, or when the user says Aspire, AppHost, AddProject, WithReference, service discovery, or Aspire dashboard. .NET Aspire conventions for local cloud-native orchestration - the AppHost that declares the topology, the shared ServiceDefaults extension every service calls once, name-based service discovery, AppHost-injected connection strings, and the developer dashboard. Services floor at .NET 8 / C# 12. Do NOT load for non-Aspire projects, production deployment, or publishing images - those are the DevOps skill's."
---

# .NET Aspire - local orchestration

Aspire describes a distributed app as one object graph and runs the whole thing with a single F5 - everything starts together with the right connection strings already threaded between resources, and one dashboard shows every process's traces, logs, and metrics. Services floor at .NET 8 / C# 12; the AppHost itself needs a newer SDK than the services it runs, so confirm the current AppHost prerequisites through the documentation server before scaffolding one.

Aspire is two cooperating pieces, and this skill is about both:
- the **AppHost**, a small project that declares the topology and orchestrates the local run;
- **ServiceDefaults**, a shared library every service calls into for the cross-cutting plumbing.

The cross-cutting plumbing itself - OpenTelemetry exporters, the health-check probes, the resilience handlers - is configured by the skill covering the ASP.NET Core cross-cutting baseline (typed options, resilience, observability), where the install has one; without it, keep the defaults the templates ship and change one knob at a time with the reason recorded. ServiceDefaults is just the composition point where they all get registered in one call. This skill owns the orchestration; it does not re-teach what goes inside the defaults.

## What Aspire is and is not

- **Local run only, never a deployment system.** The graph drives `dotnet run` on the AppHost; getting the app onto a server belongs to CI and container tooling.
- **No Aspire type inside business logic.** A service reads its connection string from configuration as usual; the AppHost is only what hands it over. An Aspire type in a handler means the wiring leaked a layer.
- **First-party integration over a bare container.** Postgres, Redis, RabbitMQ, SQL Server and the rest each bring the connection string, a health check and traces; a hand-configured container brings none of them.

## The AppHost owns the topology

One AppHost project is the single place that knows which resources exist and how they depend on each other. It is a normal console app whose entry file (`AppHost.cs` in current templates, `Program.cs` in older ones) builds a `DistributedApplication`:

- Start with `DistributedApplication.CreateBuilder(args)`.
- Declare infrastructure with the resource builders: `AddPostgres(...)`, `AddRedis(...)`, `AddRabbitMQ(...)`, `AddSqlServer(...)`. These return resource references you hold onto.
- Declare each of your own services with `AddProject<Projects.SomeApi>("some-api")`. The generated `Projects.*` type comes from a project reference, so the AppHost compiles against the actual service projects.
- Finish with `builder.Build().Run()`.

Give every resource a stable, lowercase name (`"orders-api"`, `"postgres"`, `"cache"`). That name is the identity the rest of the system resolves against, so treat renaming a resource as a breaking change.

### Wire dependencies with references, not strings

The point of the AppHost is that you express *which resource talks to which* and let the runtime produce the wiring:

- `.WithReference(resource)` connects a service to a dependency. For a database or cache this injects the connection string into the service's configuration under a predictable key; for another project it registers that project for service discovery. This is how a connection string reaches a service - you never type one into the AppHost or the service.
- `.WaitFor(resource)` holds a service's start until its dependency reports healthy. Use it where startup order actually matters - a service that runs migrations against Postgres on boot should wait for Postgres - and leave it off where the service tolerates a not-yet-ready dependency, since waiting serializes startup.

A small AppHost reads as a dependency graph:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume()
    .AddDatabase("ordersdb");

var cache = builder.AddRedis("cache");

builder.AddProject<Projects.Orders_Api>("orders-api")
    .WithReference(postgres)
    .WithReference(cache)
    .WaitFor(postgres);

builder.Build().Run();
```

### Keep dev-only extras out of other environments

Conveniences like `.WithPgAdmin()`, `.WithRedisInsight()`, a broker's management UI, or a seeded data volume are for the developer loop and must never travel further. Gate them behind `builder.ExecutionContext.IsRunMode` (or an explicit dev check) so they only attach during a local run and are absent when the manifest is published. The same applies to fixed host ports - pin them only where a developer genuinely needs a stable address, and let Aspire assign the rest.

## ServiceDefaults: one call per service

ServiceDefaults is a shared library every service depends on, exposing a single `AddServiceDefaults()` extension that each service's `Program.cs` calls once. That one call is the composition root for the cross-cutting concerns:

- OpenTelemetry tracing, metrics, and logging with the OTLP exporter the dashboard reads;
- the standard health checks;
- the default HTTP resilience handler;
- service discovery registration.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
// ... service-specific registrations ...
var app = builder.Build();
app.MapDefaultEndpoints();
```

What goes *inside* each of those - which spans to record, what the readiness probe checks, how aggressive the retry policy is - is the ASP.NET Core cross-cutting baseline skill's call where the install has one, not this skill's. ServiceDefaults is the place those decisions get registered, not where they get made.

Pair the registration with `MapDefaultEndpoints()`, which maps the health endpoints. Keep the liveness-versus-readiness distinction: liveness answers is the process alive, readiness answers can it serve traffic yet (dependencies reachable, warmup done). Map the readiness probe only in environments where an orchestrator will poll it.

## Service discovery and configuration

- Address other services by their Aspire resource name, never by a hardcoded host or port. With service discovery wired through ServiceDefaults, a typed `HttpClient` configured with a base address of `https+http://orders-api` resolves to wherever that resource is actually running. Hardcoding `localhost:5217` defeats the whole orchestration model and breaks the moment a port shifts.
- Connection strings arrive as configuration, courtesy of the `WithReference` in the AppHost. The service should read them through the options pattern and bind them to a typed options class - not pull magic strings out of `IConfiguration` ad hoc, and never hardcode a value the AppHost is already supplying.
- The contract between AppHost and service is the resource name plus the configuration key it injects under. Keep both stable; changing either is a wiring break even though nothing in the service signatures changed.

## The dashboard

A local run launches the dashboard automatically, consuming the same OTLP ServiceDefaults already exports - use it for cross-service traces, health flips, and per-process environment and console output instead of standing up Seq, Jaeger or Grafana for the inner loop. Development tool only; never a production observability backend.

Prove the graph before calling the wiring done: `dotnet run` the AppHost, confirm every resource reaches Running in the dashboard and that each service resolved its injected connection string, and quote both. A topology that compiles but never starts is the failure this skill exists to prevent.

## Testing the orchestrated app

To spin up the full graph in a test and assert against it, use `DistributedApplicationTestingBuilder` to build the AppHost in-process. The harness specifics - waiting on resources, resolving endpoints, fixture lifetime - belong to the skill covering .NET test practice, which carries the Aspire integration-testing reference; load it when you write those tests rather than reinventing the setup here, and with none installed keep the fixture to one AppHost build per test class and say the setup is unverified.
