---
name: dotnet-data-access
description: "Use when configuring a DbContext or ISession, writing or reviewing an EF Core, NHibernate or Dapper query, picking a loading strategy, chasing an N+1, or designing a read/write store in .NET (.NET 8 floor). Do NOT use for the engine side - raw SQL, indexes, the query planner (the database skills) - nor for the migration playbook, which is dotnet-migrate."
---

# dotnet-data-access (ORM hub)

Owns the .NET side of talking to a database, the part that is the same whichever full ORM you use. **Load the per-ORM reference for the concrete mechanics:**

- EF Core -> `references/efcore.md`
- NHibernate -> `references/nhibernate.md`
- .NET Framework 4.8 (EF Core 3.1 vs EF6, DbContext-per-request) -> `references/net-framework-48.md`

Out of scope, by design: raw SQL / index / planner tuning -> the engine skill (Postgres or SQLite); the migration safety playbook (expand-contract, backfill, rollback, never edit an applied migration) -> `dotnet-migrate`; async / `CancellationToken` / hand-mapping -> `csharp`; real-DB integration tests -> `dotnet-testing`. Where an install lacks one of those, the access rules below still hold - do not absorb the missing area into this layer.

## Session lifetime and thread-safety

- The unit-of-work object (EF `DbContext`, NH `ISession`) is **not thread-safe** and is short-lived - one per web request or per background unit of work. Never share it across requests or threads.
- The factory is the expensive singleton, built once at startup (EF via DI / `AddDbContextFactory`, NH `ISessionFactory`). Long-lived or parallel owners open a fresh session/context per operation from the factory - never hold a captive short-lived one on a singleton.
- Bulk / ETL work uses the tracking-free fast path (EF no-tracking, NH `IStatelessSession`).

## Identity map and change tracking

- Both ORMs keep an identity map and dirty-check tracked entities on flush. Reads dominate most apps and tracking is pure overhead, so **default read paths to no-tracking** and opt back in only on the query you intend to mutate.
- Writes go through an explicit transaction and an explicit flush/save - do not rely on implicit flush-on-dispose.

## Loading strategy and N+1

- N+1 comes from lazy-loading an association inside a loop, or querying per item. Fix by fetching in one query (eager fetch) or a single set query over the id list, not a call per id.
- Multiple eager collection fetches cause a cartesian explosion (rows multiply). Prefer **projection** (below); otherwise split into multiple queries (EF `AsSplitQuery`, NH futures) - see the reference.
- **Read the generated SQL, do not infer it.** Log or capture the statements for the changed read and quote the statement count: one query, not one per row. A fixed N+1 that was never counted is a claimed fix.

## Projection and read models

- Project to a DTO instead of materializing entities - fetches only the needed columns, skips tracking, and sidesteps explosion. The shape, ORM-agnostic: select into the DTO in the query, bound and no-tracking, never a `ToList()` then a `Select` in memory.

```csharp
// one query, three columns, no tracked entities, bounded
public Task<List<OrderSummary>> RecentAsync(Guid customerId, int limit, CancellationToken ct) =>
    _db.Orders
       .AsNoTracking()
       .Where(o => o.CustomerId == customerId)
       .OrderByDescending(o => o.PlacedAt)
       .Take(limit)                                     // required, never unbounded
       .Select(o => new OrderSummary(o.Id, o.PlacedAt, o.Total))
       .ToListAsync(ct);
```
- Separate read and write stores (CQRS-lite): read stores return denormalized projections with no tracking; write stores take commands and return minimal data (the new id, or void).
- Every read method takes a required `limit` / `Take` - never return unbounded. Keyset pagination for large sets (the SQL and its supporting index belong to the database-conventions and per-engine skills, where the project installed them - without one, write the keyset predicate and add the covering index yourself rather than falling back to offset paging); offset paging otherwise with a separate count.
- Do not build generic repositories (`IRepository<T>.GetAll()`) - they can't enforce limits, can't optimize a query, and hide N+1. Use purpose-built stores with named, intentful methods.

## Bulk operations

Mutate set-based, not load-loop-save - one statement, no materialization. The concrete call is per-ORM (EF `ExecuteUpdate`/`ExecuteDelete`, NH stateless session or HQL DML) - see the reference.

## Full ORM plus micro-ORM

- Full ORM (EF Core / NHibernate) for CRUD, validation-focused and domain-heavy writes; a micro-ORM (Dapper) for complex reads, reporting, and bulk. They coexist in one project - ORM for writes, Dapper for reads.
- Dapper read store: inject a pooled `DbDataSource` (`NpgsqlDataSource` on Postgres), open a connection per call, map an internal row type to a domain DTO by hand. Parent + children in one round trip: `QueryMultipleAsync` returns both result sets, then stitch in memory - never materialize two tables and join them in C# (push the join into SQL; shaping it engine-side is the Postgres engine skill's).
