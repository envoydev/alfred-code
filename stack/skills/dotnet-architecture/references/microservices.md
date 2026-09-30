# Microservices

Independently deployable, independently scalable services split by bounded context. Load when a boundary genuinely forces distribution. Read the warning first - most microservice pain is self-inflicted, and many teams are now consolidating nanoservices back toward coarser services or a modular monolith.

## Start by not needing them

- The default failure mode is a **distributed monolith**: services that must deploy together, share a database, or chat synchronously on every request - all the cost of distribution, none of the benefit.
- Microservices are never the goal; a business driver is - independent scale, faster deploys, fault isolation. 'It's modern' is not a reason. Start as a modular monolith and extract a service only when a specific boundary needs independent deploy cadence, independent scale, team autonomy, or a different stack.
- Below roughly five services, or with a small team, the distribution tax - network latency, distributed debugging, operational overhead - outweighs the benefit. Prefer the modular monolith and extract later; local .NET Aspire orchestration supports that path.

## Boundaries

- A **bounded context** is the outer boundary; an **aggregate** is the transactional consistency boundary inside it. Never split one aggregate across services - it is the smallest sane unit.
- A bounded context is not automatically one service; it can map to several. Start coarse-grained and subdivide as the domain clarifies - premature decomposition produces unstable boundaries and constant cross-service change.
- DDD is the primary decomposition heuristic, not the only one. Volatility, data sensitivity (PII/PCI), scaling profile, and team topology (Conway's law) are legitimate and often better drivers. Do not be dogmatic. Model the domain first with `references/ddd.md`.

## Data ownership

- **A database per service, private behind its API.** Another service's data comes via that API or via replicated read models and events - accept eventual consistency between services.
- **No shared database, and no shared domain or serialization library across a boundary** - both reintroduce coupling and kill independent deployability. Prefer duplicating a type on each side over sharing one library between services. Read-path shaping and ORM concerns stay with the ORM data-access skill.

## Communication

- **Synchronous**: REST at the edge and for simple internal calls; gRPC for high-throughput internal hops (the gRPC skill). A dual stack is the norm. Move an internal REST hop to gRPC only when profiling shows serialization or latency is the real bottleneck and you own both ends.
- **Asynchronous**: an event-driven broker is the default for cross-service state propagation - it decouples and survives partial failure. Design every call for partial failure.
- The messaging library is a deliberate decision, not a default - the broker-messaging skill owns that choice plus the broker wiring, outbox, and sagas.

## Consistency across services

- No cross-service transactions. Publish integration events reliably with the **outbox** pattern and consume them idempotently with an **inbox** - together they close the dual-write gap and give exactly-once effect.
- **Saga** for a multi-step flow: orchestration (a central coordinator) for complex, branching, or five-plus step flows where you need visibility and testability; choreography (services react to events) for simple two-to-four step flows - watch for event storms. Implementation lives in the broker-messaging skill.
- Reserve 2PC / XA for short-lived, strong-consistency edge cases only. Eventual consistency is the default across boundaries, so design the UX and APIs for it.

## CQRS and event sourcing - only where justified

- **CQRS** (separate read and write models) earns its keep when the domain is complex, read and write scale independently, or many teams share one context. It is over-engineering for simple CRUD.
- **Event sourcing** is a far bigger commitment - use it only for a real audit-trail or temporal-query need (finance, compliance) or a naturally event-driven domain; Marten (Postgres-backed, MIT) is the .NET option. Apply advanced patterns per service, never as a blanket default - keep the simple services plain CRUD.

## Edges and delivery

- **Gateway / BFF**: front the mesh with a gateway and a backend-for-frontend per client type (web, mobile). YARP is the first-class Microsoft-supported choice - a library you embed for full pipeline control and throughput; Ocelot is the config-first option for simpler needs; reach for Kong or KrakenD only on a large multi-language platform.
- **Versioning**: version every contract from day one with additive, consumer-safe changes - the ASP.NET Core web hub owns the discipline.
- **Resilience**: timeouts, retries with backoff, circuit breakers, idempotent handlers - the ASP.NET Core web hub owns the standard resilience handler.
- **Observability**: distributed tracing correlated across every hop is not optional - OpenTelemetry over OTLP, wired by the ASP.NET Core web hub, manual spans included. Bound metric cardinality and use tail-based sampling.
- **Containers and runtime**: multi-stage builds on chiseled / distroless images, one database per service, Kubernetes for production - the DevOps skill owns the Dockerfiles, CI, and deploy. Standardize new services on the current .NET LTS (an even-numbered release); an STS runtime is the wrong floor for a platform you run for years.

## Local orchestration - dev-time only

Run the whole mesh locally with .NET Aspire: the AppHost models services, databases, and messaging and wires service discovery, OpenTelemetry, and resilience by default. The AppHost is a **dev-time orchestrator, not a production runtime** - production stays on your Kubernetes / Helm / GitOps pipeline. Its publish/deploy targets (Azure Container Apps, Kubernetes) change status release by release - verify the current state via the documentation server before leaning on one; the house default stays your own pipeline.

## Verify independent deployability

Independent deployment is the whole point of the split, so prove it. Gate each boundary with consumer-driven contract tests (Pact) in CI rather than a heavy, brittle end-to-end suite; `dotnet-testing` owns the strategy - Testcontainers against real dependencies, contract tests at the seams, a thin E2E layer.

## When

Independent scaling of a hotspot, independent deploy cadence, team autonomy at boundaries, or a genuine polyglot need. Not for a small team, a single cohesive domain, fewer than ~5 services, or as a greenfield default - reach for the modular monolith first and extract.
