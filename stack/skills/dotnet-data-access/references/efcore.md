# EF Core mechanics

Concrete EF Core forms of the ORM-agnostic principles in `SKILL.md`. Load when the ORM is EF Core.

## DbContext lifetime and pooling

- Web request: `AddDbContext<T>` registers Scoped - one context per request.
- Background / hosted service: `CreateScope()` per unit of work, resolve the context inside, dispose with the scope.
- Long-lived or parallel owners (Blazor, background loops): `AddDbContextFactory<T>`, then `await using var db = await factory.CreateDbContextAsync()`; `AddPooledDbContextFactory<T>` for the pooled variant on hot paths.
- High-throughput paths: `AddDbContextPool<T>` reuses instances (state reset between leases). Only pool contexts with no injected per-request scoped state, and never combine with the factory for the same context.

## Change tracking

- Read-heavy app: default the context to no-tracking in the ctor - `ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking`. Otherwise `.AsNoTracking()` per read.
- Trap: with a NoTracking default, mutating a fetched entity then `SaveChangesAsync()` silently persists nothing.
- Write under a NoTracking default: `.AsTracking()` on the query you'll mutate, or mutate then `Set.Update(entity)`. `Add` works in any mode; `Update()` marks the whole entity modified.
- One context tracks at most one instance per key; attaching or updating a second instance with the same key throws ('already being tracked') at track time, not on save. Fix: query then mutate that tracked instance, or detach the stale one via `Entry(e).State = EntityState.Detached`; use a fresh context per unit of work.

## Loading strategies

- Eager: `Include`/`ThenInclude` in one query. N+1 fix without a loop: `Where(o => ids.Contains(o.Id))`.
- Cartesian explosion from multiple collection `Include`s: prefer projection; else `AsSplitQuery()` per query or `QuerySplittingBehavior.SplitQuery` globally with `AsSingleQuery()` overrides.
- Split vs single: split avoids explosion but costs multiple round trips and can skew across reads; single is one round trip and transactionally consistent but explodes. Default split globally; keep single for small 2-3 level graphs always loaded together.

## Projection

- `.Select(...)` fetches only needed columns and skips tracking; EF emits correlated subqueries per sub-collection, which you can bound inside: `p.Reviews.OrderByDescending(...).Take(10)`.

```csharp
var page = await query
    .Skip((p.PageNumber - 1) * p.PageSize)
    .Take(p.PageSize)                                   // always bounded
    .Select(o => new OrderSummary(o.Id, o.Total, o.Status, o.CreatedAt))
    .ToListAsync(ct);
```

## Bulk and compiled queries

```csharp
var now = timeProvider.GetUtcNow();   // injected TimeProvider, never DateTimeOffset.UtcNow - see csharp
await _db.Orders
    .Where(o => o.ExpiresAt < now)
    .ExecuteUpdateAsync(s => s
        .SetProperty(o => o.Status, OrderStatus.Expired)
        .SetProperty(o => o.UpdatedAt, now), ct);
```

- `ExecuteUpdateAsync` / `ExecuteDeleteAsync` emit one statement, no materialization.
- Hot, repeated query shape: hoist to a static `EF.CompileAsyncQuery(...)` to skip re-translation per call.
- Transient-failure retries: wrap the retriable unit in `_db.Database.CreateExecutionStrategy().ExecuteAsync(...)`. A user-started transaction must open *inside* the strategy callback, or a retry replays a half-committed transaction.

## Migrations - multi-project CLI

The safety playbook is `dotnet-migrate`; this is the wiring it leaves open.

- `--project` = the migrations assembly (e.g. `Infrastructure`), `--startup-project` = the host (e.g. `Api`), `--context` when several `DbContext`s exist.
- Migrations in a different assembly from where the context is registered: `UseNpgsql(cs, o => o.MigrationsAssembly("MyApp.Infrastructure"))`.
- Apply inside an ExecutionStrategy (`GetPendingMigrationsAsync` -> `MigrateAsync`); prefer applying from a separate step - `dotnet-migrate`'s migrations bundle, or a dedicated migration-runner host that applies then exits - so the app never migrates on startup under load; the zero-downtime playbook is `dotnet-migrate`'s.

## Provider notes

- Behind a Postgres transaction pooler that does not track prepared statements (PgBouncer does when `max_prepared_statements` is non-zero), keep Npgsql's `Max Auto Prepare` at its default 0 and call no explicit `Prepare()`; the pooler modes themselves are the Postgres engine skill's.
- SQLite provider: EF migrations rebuild tables for many schema ops (limited `ALTER TABLE`) - review the generated SQL; the rebuild mechanics are the SQLite engine skill's.
