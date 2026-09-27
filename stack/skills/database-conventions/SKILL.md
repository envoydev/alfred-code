---
name: database-conventions
description: "Load before designing or modifying a schema, writing SQL raw or through an ORM, modeling a document store, or creating a migration, view, procedure, or index. Database conventions across Postgres, SQL Server/T-SQL, SQLite, and MongoDB - the engine-neutral rules for schema design, migrations, indexes, foreign keys, transactions, connection management, query safety, N+1 prevention, and secret handling, plus the per-engine pitfalls that bite. Deeper work routes out per engine and per stack - the body names each route and what to do when the project installed none of them. Do NOT load for app-only in-memory data structures or a project with no persistence layer."
---

# Database conventions

For engine-specific syntax or feature support not pinned down here, resolve it with the `documentation` MCP rather than memory.

A careless database change is permanent: a dropped column takes its data, a missing index turns a query into a scan under load, an unbounded result set is a memory incident waiting for the row count. These are the engine-neutral defaults; the engine-specific work routes out per section.

**Each rule below is one line; `references/conventions-in-full.md` carries it with its reason and example - read it before a new table, index, constraint or migration.** SQL writing style (casing, layout, naming style, query construction, data types, NULL handling, the per-engine cheat-sheet) is authoritative in `references/sql-style.md`. **Above both, a project's own SQL style - a co-located `SQL_STYLE.md` and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority - follow the project where it diverges.**

## Store and schema
- Relational by default; another engine only for a genuinely mismatched access pattern, beside the database. A cache is never the source of truth, and every key carries a TTL.
- A surrogate primary key (`BIGINT` identity; a UUID only for distributed or non-guessable ids, time-ordered v7 / ULID on a write-heavy table), with a `UNIQUE` constraint on the natural identifier.
- 3NF by default; denormalize only a profiled hot read path. Many-to-many through a junction table with a composite key, both columns indexed; a polymorphic association guarded by a `CHECK`.
- Timestamps in UTC (a timezone-aware type only when the offset matters); non-nullable `created_at` / `updated_at` everywhere; a soft delete (`deleted_at`) for anything you may recover or audit, filtered out of normal reads.

## Engines
- Money and exact quantities are `decimal` / `NUMERIC(p,s)`, never `float` / `double`.
- **PostgreSQL** - the Postgres engine skill where installed. Trap: `SERIAL` is legacy (`GENERATED ALWAYS AS IDENTITY`); `TEXT` over `VARCHAR(n)` without a hard cap.
- **SQLite** - the SQLite engine skill where installed. Trap: foreign keys are OFF by default - `PRAGMA foreign_keys = ON` on every connection.
- **SQL Server** - no engine skill; `references/sql-style.md`'s T-SQL section. Traps: `NVARCHAR` for user-facing text; `DATETIME2` / `DATETIMEOFFSET` over `DATETIME`.
- **MongoDB** - embed versus reference by access pattern, index every queried path, bound arrays, no unbounded `$lookup`. Traps: the 16 MB document ceiling; `ObjectId` already carries the creation time.

## Query safety and N+1
- Every query is parameterized - never SQL by concatenation (the injection treatment is `database-security`'s); no PII or secret in logged query text.
- Read-only intent and `READ COMMITTED` by default; a stronger isolation only for a named consistency need.
- Bound every result set that can grow; never `SELECT *`.
- Deep pagination is keyset (seek) with a unique tiebreaker, never `OFFSET` - the worked query, and SQL Server's spelling, are in the reference.
- Join in the database, never in memory; the ORM's N+1 fix is the .NET data-access skill's where installed.

## Migrations
The workflow is the .NET migration-workflow skill's where installed; the engine rules it assumes: every migration reversible, one logical change with a descriptive name, idempotent at deploy, large backfills batched apart from the schema change, and lock impact reviewed before production. Prove the idempotence: run it twice and quote both exit lines.

## Naming, indexes, constraints
- One case and one table-name number per project, English identifiers; FK columns follow the related table; indexes self-describe (`ix_orders_customer_id_status`).
- Every index names the query it serves; composite order is equality columns then the range column; cover with `INCLUDE` before widening; a partial index for a sparse predicate; drop an unused index only after a representative usage window; build online (`CONCURRENTLY`, `ONLINE = ON`).
- Foreign keys enforced in the schema, with explicit `ON DELETE` / `ON UPDATE` and an index on every FK column; `NOT NULL` by default and `CHECK` for stateable invariants; uniqueness by constraint, never check-then-insert; no stored derived value that can drift - compute it or use a generated column.

## Transactions, secrets, procedures
- Read `references/transactions-and-connections.md` before opening a transaction, tuning a pool, or wiring a database-backed work queue.
- A connection string is a credential: from configuration or a secret store, never a committed file; production credentials apart from the rest; a suspected exposure is rotated (`database-security`).
- Logic stays in the application; a stored procedure only where set-based engine work clearly wins; views for stable projections; triggers only for auditing or an integrity rule the schema cannot state.
