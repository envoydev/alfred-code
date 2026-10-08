---
name: sqlite
description: "Use when the work touches SQLite - a .db file, a PRAGMA, 'database is locked', an embedded or test store, an EF Core quirk. Not for Postgres-class writers."
---

# sqlite (engine specialist)

The SQLite-specific layer. **Cross-engine conventions - schema design, migrations, indexing and transaction rules, connection handling - are the cross-engine database hub's; load that hub first where the install has it, and do not restate it.** The EF Core side is the ORM-side skill's (EF Core / Dapper). This is only what changes *because the engine is SQLite*, and stands on its own when the hub is absent.

## When to use

Use when the work touches a SQLite database - a `.db` file, a PRAGMA, an embedded/desktop/mobile/test store, or an EF Core SQLite provider quirk.

The SQLite-specific delta on top of the cross-engine database hub: when SQLite fits, the single-writer / WAL concurrency model and busy-timeout, PRAGMAs (foreign_keys, journal_mode, synchronous), type affinity vs STRICT tables and date/bool storage, limited ALTER TABLE and the table-rebuild, connection-per-thread and in-memory test DBs, B-tree-only indexing, FTS5, and backup.

Not the cross-engine schema and transaction rules - those are the hub skill, loaded first - and not a server-class concurrent-writer workload, which is the PostgreSQL skill.

## When it fits

- Good: embedded / desktop / mobile app storage, single-node edge, a local cache, and test databases. It is a file, not a server.
- Bad: high-write-concurrency multi-client web. SQLite allows **one writer at a time** for the whole database - reach for PostgreSQL there (and the house PostgreSQL skill, when your skill list has one).

## Concurrency

- Enable WAL: `PRAGMA journal_mode=WAL` - readers no longer block the single writer, which is the big throughput win. WAL persists on the file.
- `PRAGMA busy_timeout=5000` (ms) so a contended writer waits instead of failing instantly with `SQLITE_BUSY`.
- `PRAGMA synchronous=NORMAL` with WAL is the usual durability/speed balance (`FULL` is safest, slower).

## PRAGMAs and typing

- `PRAGMA foreign_keys=ON` on **every connection** - FK enforcement is OFF by default.
- SQLite is dynamically typed (type *affinity*, not strict) - a column will accept any type. Declare `STRICT` tables (3.37+) to enforce the declared types.
- No native boolean or date/time type: store dates as ISO-8601 `TEXT` or epoch `INTEGER`, booleans as `0`/`1`. Sort/compare accordingly.

The connection-open sequence the rules above add up to:

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

## Schema changes

- `ALTER TABLE` is limited to `RENAME`, `ADD COLUMN`, `DROP COLUMN` (3.35+, but blocked on a column that is part of a PK, UNIQUE, indexed, named in a partial index's `WHERE`, in a table CHECK or another column's CHECK, in an FK, in a generated-column expression, or used by a trigger or view), and toggling a column's `NOT NULL` (3.53+).
- Any other change - retype a column, reorder, add other constraints - needs the documented 12-step rebuild, in this order (skipping steps is how FK enforcement and views silently break):
  1. `PRAGMA foreign_keys=OFF` (outside the transaction).
  2. Begin a transaction.
  3. Save the SQL of the table's indexes, triggers, and views (query `sqlite_schema`).
  4. `CREATE TABLE new_X` with the revised schema.
  5. `INSERT INTO new_X SELECT ... FROM X`.
  6. `DROP TABLE X`.
  7. `ALTER TABLE new_X RENAME TO X`.
  8. Recreate the indexes and triggers from step 3.
  9. Drop and recreate any views the change affects.
  10. `PRAGMA foreign_key_check` (if FKs were on).
  11. Commit.
  12. `PRAGMA foreign_keys=ON` again.
- The core of that sequence, with its two PRAGMA bookends - steps 3, 8 and 9 (saving and recreating the indexes, triggers and views) are the ones a hand-written rebuild forgets:

```sql
PRAGMA foreign_keys=OFF;                          -- step 1, outside the transaction
BEGIN;
  -- step 3: SELECT type, name, sql FROM sqlite_schema WHERE tbl_name='orders';
  CREATE TABLE new_orders (                       -- step 4: the revised schema
    id      INTEGER PRIMARY KEY,
    qty     INTEGER NOT NULL,                     -- was TEXT
    placed  TEXT NOT NULL
  ) STRICT;
  INSERT INTO new_orders (id, qty, placed)        -- step 5
    SELECT id, CAST(qty AS INTEGER), placed FROM orders;
  DROP TABLE orders;                              -- step 6
  ALTER TABLE new_orders RENAME TO orders;        -- step 7
  -- steps 8-9: replay the saved index / trigger / view SQL here
  PRAGMA foreign_key_check;                       -- step 10, inside the transaction
COMMIT;
PRAGMA foreign_keys=ON;                           -- step 12
```

- **The rebuild is not done until its check is quoted.** Paste the `PRAGMA foreign_key_check` output (an empty result is the pass, and say so), plus the row counts either side of step 5 and an `EXPLAIN QUERY PLAN` for one query that used a recreated index - a rebuild that silently dropped an index reads as a successful migration until production slows down.
- EF Core migrations on SQLite rebuild tables for many operations - can be slow and occasionally lossy. Review the generated SQL before applying.

## Queries and indexes

- No `RIGHT`/`FULL OUTER JOIN` before 3.39 - rewrite as `LEFT JOIN`.
- B-tree indexes only (no GIN/BRIN); partial and expression indexes are supported. Run `ANALYZE` / `PRAGMA optimize` for planner statistics, and `EXPLAIN QUERY PLAN` to confirm an index is used.
- Full-text search: use an FTS5 virtual table, not `LIKE '%term%'`.

## Connections and testing

- No server, no pooling - a connection is a file handle. Keep a connection per thread; do not share one connection across threads.
- An in-memory database (`:memory:`) is private to its connection unless you use a shared-cache name. For tests, hold the connection open for the database's lifetime, or the schema vanishes when it closes.

## Backup

The database is a single file: copy it while idle, or use the online backup API / `VACUUM INTO 'backup.db'` for a consistent copy of a live database.
