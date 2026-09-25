# Seam Interface Protocol

The recorded interface is the source of truth every affected stack builds against. It comes out of the PRODUCER designer's plan - the routes, request/response DTOs, error envelope, auth policy, schema semantics, event/message shapes the seam carries - and the orchestrator records it in the progress ledger, versioned, before any consumer seat is briefed. It changes only through the protocol below, never silently.

## Record before consumer work

For any cross-domain mode: dispatch the producer designer first (the upstream side per the dependency direction from the related-context entries or the architecture map). Copy its plan's interface section into the ledger as `v1`. In full_cross_domain, the consumer designer validates v1 against its side's needs before anything is built - a misfit loops back to the producer designer at design cost, not rework cost. Every task card and agent result carries the `contract_version` it was built against; verification runs against the current version only.

## What counts as a seam change

A local implementation detail can change and continue (report DONE_WITH_CONCERNS if it carries risk). A change to any of these is a SEAM change and must stop:

- Database schema or index semantics.
- API routes, verbs, request/response DTOs.
- Error codes and the error envelope.
- Auth / authorization policies.
- Event or message contracts.
- Config / env vars.
- Migration or deployment order.
- Frontend / desktop / mobile-visible behavior.

## The change protocol

When a seat finds the recorded interface cannot be met, it stops and emits BLOCKED_CONTRACT_CHANGE:

```yaml
status: BLOCKED_CONTRACT_CHANGE
agent: data-implementer
contract_version: v1
summary: "Unique-email design conflicts with soft-delete requirement."
recommended_change: "Partial unique index WHERE deleted_at IS NULL."
affected_domains: [backend, data]
risk_if_ignored: "Backend duplicate check will not match database semantics."
```

Orchestrator reaction:

1. Mark the task blocked in the ledger; pause ONLY the affected lanes.
2. Revise the interface - re-dispatch the producer designer with the delta, or decide in-session when the change is trivial and the tradeoff is clear.
3. Record v2 in the ledger and re-brief the affected seats; each reports: can continue, needs rework, or must discard stale work.
4. Verify against v2 only - a result produced against v1 is re-verified, never accepted as-is.

The integration-reviewer confirms at the final gate that the current version is used everywhere - a lane that signed off against a superseded version fails the gate.
