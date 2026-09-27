---
name: dotnet-messaging
description: "Use when wiring a message bus, an outbox, a saga or process manager, integration events, or background message processing in .NET - or when the user names Wolverine, MassTransit, RabbitMQ, Azure Service Bus, queue, or pub/sub. Covers broker-backed, event-driven communication between modules and services: the transactional outbox, idempotent consumers under at-least-once delivery, choreography versus sagas, versioned message contracts, and RabbitMQ or Azure Service Bus transports. Floors at .NET 8 / C# 12. Do NOT use for in-process reactive streams or for synchronous request/response over HTTP; the consumer's host process itself is the hosted-worker skill's."
---

# .NET messaging - event-driven communication

This is about durable, broker-backed messages crossing a process or module boundary asynchronously. The defining traits: the sender does not wait for the receiver, the broker persists the message, and delivery is at-least-once. Everything here exists to make that delivery model safe.

Floor is .NET 8 / C# 12. What this skill does NOT cover: in-memory reactive streams (Rx / System.Reactive), and synchronous in-process cross-cutting concerns - HTTP, mediation, resilience pipelines - which belong to the ASP.NET Core cross-cutting hub. If the caller is awaiting a reply right now, it is not messaging. This skill owns the broker and the consumer contract - delivery, idempotency, retries; the generic *host* a consumer runs inside (the `BackgroundService`/worker process, its lifecycle and shutdown) belongs to the hosted-worker skill. Pushing a handled message's outcome to connected clients in real time (SignalR) is the server-to-client last hop, not broker delivery - that belongs to the real-time push skill.

## Pick the library: Wolverine

Default to Wolverine. Its core is MIT open-core, and it folds the in-process mediator and the out-of-process message bus into one programming model, so a handler that today runs inline can be moved onto a queue by changing routing, not code. The outbox, sagas, scheduled messages, and convention-discovered handlers are all in the box.

MassTransit is mature and well-documented but is no longer OSS-first, so reach for it only with a deliberate, paid-for reason - an existing licensed estate, a transport only it supports. New code starts on Wolverine. Before quoting a licence term or an end-of-maintenance date to anyone, read `references/library-licensing.md` and re-check it: those terms move, and a stale one is a commercial decision made on bad information.

```csharp
builder.Host.UseWolverine(opts =>
{
    opts.UseRabbitMqUsingNamedConnection("rabbit")   // the "rabbit" connection string
        .AutoProvision();                       // dev convenience; see Transport

    opts.Policies.UseDurableInboxOnAllListeners();
    opts.Policies.AutoApplyTransactions();      // wraps handlers in a tx
});
```

## Reliability is the whole point

Get-it-delivered-once is harder than it looks, and three rules carry the load.

### The transactional outbox - never dual-write

The trap: a handler writes to the database, then calls the broker to publish. Two separate I/O operations with no shared transaction. If the process dies between them, you have committed state with no message, or a published message that rolls back - silent inconsistency either way.

The outbox closes the gap. The outgoing message is written to a table inside the same transaction as the business data; a relay then forwards it to the broker. Commit publishes; rollback un-publishes. With Wolverine on EF Core, enable the EF Core outbox integration and `AutoApplyTransactions()` so every handler's database work and outgoing messages share one unit of work. The mirror on the receive side is the inbox (durable inbound storage), which also gives you the dedupe needed below.

### Idempotent consumers

At-least-once means a consumer will, eventually, see the same message twice - a redelivery after a transient failure, a relay that retried. So a handler must be safe to run more than once on the same message. Dedupe on the message id (the inbox does this for you), or make the effect naturally idempotent - upsert rather than insert, set-state rather than increment. Never assume exactly-once from the transport; design for the retry.

### Bounded retries and a dead-letter path

A poison message must not loop forever. Configure a finite retry policy - a few attempts with backoff - and after that route the message to a dead-letter queue for inspection, do not drop it. Distinguish transient faults (retry: timeout, broker hiccup) from permanent ones (dead-letter immediately: malformed payload, validation failure). Wolverine expresses this per-exception-type:

```csharp
opts.OnException<TimeoutException>()
    .RetryWithCooldown(50.Milliseconds(), 250.Milliseconds(), 1.Seconds());

opts.OnException<ValidationException>().MoveToErrorQueue();  // no retry
```

## Messages are contracts

A message that has left the process is a published interface - other deployables depend on its shape, and you cannot refactor across that boundary in one commit.

- Define message types as immutable `record`s of primitive and simple types. Put them in a dedicated Contracts assembly that producers and consumers both reference; do not let a consumer reach into the producer's internal model.
- Version additively. Add optional fields; never repurpose, retype, or remove an existing one - an old consumer may still be reading the old shape from a queue. When a breaking change is unavoidable, publish a new versioned message type alongside the old.
- Carry identifiers and the minimum facts the consumer needs, not whole domain entities. A fat contract welds two services' models together and breaks the moment one evolves.
- Timestamps come from an injected `TimeProvider`, never `DateTime.Now` - the clock-seam rule is the C# baseline's. This keeps message-stamping testable and timezone-correct.

```csharp
public sealed record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTimeOffset PlacedAt);
```

## Shape of the flow: choreography or saga

Match the coordination mechanism to the flow's complexity, and do not over-build.

- **Choreography** for a short flow (roughly two or three steps) with nothing to undo. Each service reacts to an event and may emit its own; no central coordinator. `OrderPlaced` -> inventory reserves stock and emits `StockReserved` -> billing charges. Simple, decoupled, but the end-to-end path lives in no single place, so keep it short.
- **A saga / process manager** once there is real workflow state to hold or a compensating action to run when a later step fails. This is the explicit, stateful path: the saga is correlated by a key, persists its state, and reacts to each step's outcome - including firing compensation (refund, release-stock) on failure. Use the library's saga support (Wolverine sagas), not a hand-rolled `status` column polled by a job. Hand-rolled status tracking is the anti-pattern a saga exists to replace.

Keep handlers thin regardless: one handler per message type, all side effects through injected services, no business logic smeared across the messaging plumbing. Where the library supports cascading messages, return the follow-on event from the handler rather than publishing imperatively - it keeps the handler pure and lets the outbox capture the outgoing message in the same transaction.

```csharp
public static class OrderPlacedHandler
{
    // returning StockReserved cascades it through the outbox
    public static StockReserved Handle(OrderPlaced placed, IInventory inventory)
    {
        inventory.Reserve(placed.OrderId);
        return new StockReserved(placed.OrderId);
    }
}
```

## Transport and local development

The broker's host and connection string come from configuration, never a literal; auto-provisioning and auto-purge stay in local development. Read `references/transport-and-local-dev.md` before choosing or configuring the broker or running it locally.

## Prove the consumer is idempotent

At-least-once delivery means the second copy is not hypothetical. Deliver the same message twice - re-publish it, or replay it from the dead-letter queue - and assert one effect: one row, one email, one balance change. Quote the count. A consumer whose duplicate has never been delivered in a test is a consumer nobody has proved idempotent, whatever the deduplication code says.
