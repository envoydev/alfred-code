# Stores, stored procedures and views

The situational rules `SKILL.md` points here for - read before choosing a store other than the relational default, modeling a document store, or writing a stored procedure, view or trigger.

## Choosing a store

Relational is the default store; reach for a document, key-value, graph, or time-series engine only when the access pattern genuinely mismatches SQL, and expect to run it alongside the relational database rather than in place of it. A cache (Redis and the like) is a performance layer, never the source of truth - the system must be able to rebuild it from the database, and every cached key carries a TTL so a stale or orphaned entry cannot grow until it runs the instance out of memory.

## MongoDB / document stores

No dedicated skill; apply document-modeling care. Embed versus reference by access pattern, index every queried field path, bound array growth, and never run an unbounded `$lookup`. Traps: the 16 MB document limit is a hard ceiling, so design to sit well under it, and `ObjectId` already embeds a creation timestamp - read it from there rather than duplicating a created-at field.

## Stored procedures and views

Default to keeping logic in the application, where it is testable, diffable, and version-controlled with the rest of the code. Reach for a stored procedure only when set-based work in the engine genuinely beats application-side composition - a bulk operation that would otherwise round-trip per row. Use views for stable read projections, and a materialized view when the refresh cost is acceptable for the staleness it buys. Keep business logic out of triggers entirely: a trigger is reserved for auditing or for an integrity rule the schema itself cannot express, never for behavior a reader of the application code would never think to look for.
