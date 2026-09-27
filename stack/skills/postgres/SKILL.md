---
name: postgres
description: "PostgreSQL engine specialist - the Postgres-specific delta on top of the cross-engine database conventions. Load for any hand-written Postgres SQL, an .sql file on a Postgres project, an EXPLAIN plan, a slow query, or an index / pooling / RLS decision. Not the cross-engine schema and transaction rules - the cross-engine database hub owns those, load it first where the install has it - not the ORM / EF Core side, which is its own skill, not another engine's SQL, and not an analytics or columnar workload, where this tuning advice inverts."
---

# postgres (engine specialist)

The Postgres-specific layer. **Cross-engine conventions - schema design, migrations, indexing and transaction rules, connection handling - are the cross-engine database hub's; load that hub first where the install has it, and do not restate it here.** RLS basics and least-privilege logins are the data-layer security skill's; the .NET/EF Core side is the ORM-side skill's (EF Core / Dapper). This file is only what changes *because the engine is Postgres*, and stands on its own when the hub is absent.

## Schema and types

- Keep every identifier lowercase `snake_case` and unquoted. Postgres folds unquoted identifiers to lowercase; a quoted mixed-case name (`"firstName"`) must be quoted forever and breaks ORMs and tools. Inheriting mixed-case? Wrap a `snake_case` view as a compatibility layer.
- `ADD CONSTRAINT IF NOT EXISTS` does not exist in Postgres - it is a syntax error. Guard idempotent constraint DDL with a `pg_constraint` check:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_owner_unique' AND conrelid = 'public.profiles'::regclass)
  THEN ALTER TABLE public.profiles ADD CONSTRAINT profiles_owner_unique UNIQUE (owner_id);
  END IF;
END $$;
```

- Growable value set: `TEXT` + `CHECK (col IN (...))`. A native `CREATE TYPE ... AS ENUM` only for a truly fixed set - adding a value needs `ALTER TYPE`, reordering is painful.
- Partition (`PARTITION BY RANGE`) once a table passes ~100M rows or is time-series with date-scoped reads: the planner prunes to relevant partitions, and dropping old data is an instant `DROP TABLE events_2023_01`, not a lock-heavy `DELETE` + `VACUUM`.
- Postgres never auto-indexes foreign-key columns. Every FK needs its own index or joins and `ON DELETE CASCADE` become full scans - audit with `pg_constraint` vs `pg_index`.

## Indexing - match the type to the query

| Access pattern | Index |
|---|---|
| `=`, `<`, `>`, `between`, `in`, `is null`, `order by` | B-tree (default) |
| `jsonb` containment, arrays, full-text `tsvector` | GIN |
| geometric / range types, nearest-neighbor (KNN) | GiST |
| huge naturally-ordered / append-only (e.g. `created_at`) | BRIN (10-100x smaller than B-tree) |
| pure equality, marginal win over B-tree | Hash |

- Composite leftmost-prefix: an index on `(a, b)` serves `WHERE a` and `WHERE a AND b`, never `WHERE b` alone. (Equality-first / range-last column ordering is the cross-engine hub's.)
- A partial index is used only when the planner proves the query predicate implies the index `WHERE` - keep that predicate identical to the query's own condition, and beware parameterized queries that can't match a literal-based filter.
- JSONB: a B-tree cannot serve `@>`. Use `GIN`; default `jsonb_ops` covers all operators, `jsonb_path_ops` covers only `@>`, `@?`, `@@` (not the key-existence `?`/`?&`/`?|`) at ~half the size. For scalar-key equality use an expression index, not GIN:

```sql
CREATE INDEX products_attrs_gin ON products USING GIN (attributes);         -- @>, ?, ?&, ?|
CREATE INDEX products_brand_idx ON products ((attributes->>'brand'));       -- attributes->>'brand' = 'Nike'
```

## Queries and the planner

- SARGability is engine-neutral and the cross-engine hub's (its SQL style reference carries the full section): leave the indexed column bare. The Postgres spellings of the trap:

| Non-sargable | Rewrite |
|---|---|
| `EXTRACT(YEAR FROM d) = 2026` | `d >= '2026-01-01' AND d < '2027-01-01'` |
| `date_trunc('day', ts) = :d` | `ts >= :d AND ts < :d + INTERVAL '1 day'` |
| `id::text = '42'` (cast on the column) | `id = 42` |

- Must filter on a function (e.g. case-insensitive email)? The escape hatch is a matching expression index: `CREATE INDEX ON users ((lower(email)))` then `WHERE lower(email) = :v`.
- When only existence matters, use `EXISTS` (semi-join) not a join - a join on a non-unique key multiplies rows, and a predicate on the right table's columns in `WHERE` silently turns a `LEFT JOIN` into an inner join.
- Rewrite `OR` across different columns as `UNION ALL` branches so each branch can seek. Avoid the catch-all `col = :p OR :p IS NULL` on hot paths - use a query per shape.
- Batch instead of N+1: `WHERE user_id = ANY($1::bigint[])`, one round trip, not N.
- Atomic upsert closes the check-then-insert race:

```sql
INSERT INTO settings (user_id, key, value) VALUES (123,'theme','dark')
  ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = now();
INSERT INTO page_views (page_id, user_id) VALUES (1,123) ON CONFLICT DO NOTHING;
```

- Bulk load: multi-row `INSERT ... VALUES (...),(...)` (~1000 rows/statement) over per-row; `COPY` for large imports (fastest path).

## Read-path diagnostics

- `EXPLAIN (ANALYZE, BUFFERS)` is the primary tool - it runs the query and shows real timing and IO. Read for:
  - `Seq Scan` on a large table -> missing index.
  - high `Rows Removed by Filter` -> poor selectivity.
  - `Buffers: read >> hit` -> not cached (memory pressure).
  - `Sort Method: external merge` -> `work_mem` too low.
  - estimate-vs-actual row gap of 10x+ -> stale statistics, run `ANALYZE`.
- Rank findings by measured impact (actual rows/buffers/time), never by the estimated cost percentage.
- Report each finding in these three lines, so the evidence travels with the fix and the re-measure is part of the contract:

  ```text
  symptom: Seq Scan on orders, 2.1M rows, Rows Removed by Filter 2.09M, 1840 ms
  cause:   no index serves WHERE status = 'open' (0.5% of rows)
  fix:     CREATE INDEX CONCURRENTLY orders_open_idx ON orders (status) WHERE status = 'open'
           -> re-run EXPLAIN (ANALYZE, BUFFERS) and quote the new node
  ```

- Enable `pg_stat_statements`; rank by `total_exec_time` (aggregate cost) and `mean_exec_time` (worst per-call); `pg_stat_statements_reset()` after a fix to re-measure.
- Autovacuum handles most tables; tune per-table for high churn and `ANALYZE` after a bulk change:

```sql
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ANALYZE orders;
```

- Which tables need that tuning is measured, not guessed - dead rows against live ones, and when each table was last vacuumed:

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

A high `dead_pct` with an old `last_autovacuum` is the table whose scale factor to lower.

- `work_mem` is per sort/hash node, not per connection - keep `work_mem * max_connections` under ~25% of RAM or sorts spill to disk.
- A prepared statement can lock in a generic plan that hurts skewed values; if a prepared query degrades, force per-value planning (`plan_cache_mode = force_custom_plan`).

## Connections and pooling

- Each backend is a real process (~1-3MB) - always pool (PgBouncer or built-in). Rule of thumb `pool_size ~= cores*2`; a few dozen real connections serve hundreds of clients.
- Transaction-mode pooling is the default. Session mode is required only for features bound to one backend: server-side prepared statements, temp tables, session GUCs, session advisory locks.
- Size `max_connections` to RAM (100-200), not to peak client count - that is the pooler's job, and `work_mem * max_connections` must stay bounded.
- Behind a transaction pooler, disable driver-side prepared statements: Npgsql `Max Auto Prepare=0` (the ORM-side skill covers the EF Core wiring), postgres.js `{ prepare: false }`, JDBC `prepareThreshold=0`.

## The two specialist sections, deferred

`references/fts-and-rls.md` carries the two blocks a Postgres session needs only when the work is
actually there: FULL-TEXT SEARCH (the generated `tsvector` + GIN shape, the query operators, and
the language-configuration trap) and RLS POLICY PERFORMANCE (the scalar sub-select wrap, indexing
the policy column, and the `SECURITY DEFINER` helper). Read it when a query is a text search, or
when RLS is this project's tenancy mechanism - not otherwise.
