# Transactions and connection management

The database rules that fire when application code drives the database rather than on every `.sql` edit: transaction scope and locking, and connection and pool handling. Schema design, query safety, indexes, migrations and the engine pitfalls stay in `SKILL.md`; SQL writing style is `references/sql-style.md`.

## Transactions

- Scope a transaction to exactly one unit of work - one request or use-case - opened at the boundary, committed on success, rolled back on exception.
- The cardinal mistake is holding a transaction open across external I/O: a transaction that waits on an HTTP call or a message bus holds its locks for the duration of a network round trip. Read what you need first, then open the transaction, do the writes, and close it.
- Design writes to be idempotent - an `UPSERT` or `MERGE` keyed on a natural or supplied id - so a retry after a timeout re-applies the same write instead of duplicating it.
- When two transactions can race to modify the same row - a balance transfer, an inventory decrement, an oversell guard - take a pessimistic row lock (`SELECT ... FOR UPDATE`) on the rows you are about to change rather than reading them optimistically and hoping; the unlocked read-then-write window is exactly where the lost update lives.
- When a single transaction locks several rows, take them in a consistent order (`WHERE id IN (...) ORDER BY id FOR UPDATE`) or in one set-based statement - an inconsistent lock order between two transactions is precisely what produces a deadlock.
- Database-backed work queue: claim a row atomically with `FOR UPDATE SKIP LOCKED LIMIT 1` (SQL Server: `WITH (UPDLOCK, READPAST, ROWLOCK)`) so competing workers take different rows instead of blocking on the same one.
- A job that must run on a single instance coordinates through an application-level lock - Postgres `pg_advisory_xact_lock` / `pg_try_advisory_lock`, SQL Server `sp_getapplock` - rather than a dummy row `SELECT ... FOR UPDATE`.

## Connection management

- Let the driver pool connections, which it does by default, and tune the pool to expected concurrency rather than the largest number the server will accept - an oversized pool just moves contention from the application to the database.
- Connections are scarce and must always be released: rely on `using` / `Dispose` (ORMs handle this for you) and, for raw access, scope the connection explicitly so it cannot leak on an exception path. Keep connections short-lived - one per unit of work - and never hold a long-lived shared connection, which serializes work behind it and survives the failures that a fresh connection would surface.
- Set a server-side `idle_in_transaction_session_timeout` alongside `statement_timeout` (SQL Server `LOCK_TIMEOUT`) so an abandoned client cannot pin a connection and keep holding its locks - a separate guard from the driver's pool idle timeout.
- Server-side prepared statements behind a transaction-mode pooler work only when the pooler tracks them, because the next call can land on a different backend - PgBouncer does when `max_prepared_statements` is non-zero; on a pooler that does not, disable them driver-side or run session-mode pooling. The pooler check and the per-driver switches live with the Postgres engine skill.
