<!-- planted: none -->
# custom-strong

## TASK

List the steps to back up the orders database before tomorrow's migration, and how to check the backup is good.

## DRAFT

The migration touches stored data, so its gate is a backup you have restored once and checked, before the migration runs.

Assumed: the engine is SQLite - the repository does not say which engine it is (below), so every command here is SQLite's `sqlite3`; with another engine the steps hold and the commands change.

1. Stop writes for the window - put the service in maintenance or stop it, so no order lands between the backup and the migration. Check: no request in the access log after the stop time.
2. Take the backup with SQLite's own copy - `sqlite3 <db file> ".backup 'orders-<date>.db'"` - which copies a consistent snapshot even if a reader is attached. Check: the file exists and is not empty.
3. Restore it once into a scratch file and check what came back - `sqlite3 restore-test.db ".restore 'orders-<date>.db'"`, then `sqlite3 restore-test.db "PRAGMA integrity_check; SELECT COUNT(*) FROM orders;"`. Check: `ok`, and the same count `sqlite3 <db file> "SELECT COUNT(*) FROM orders;"` gives on the live file.
4. Keep it off the machine - copy the backup file to where your backups live. Check: the copy's size matches the original's.

The migration waits until step 3's check passes; a failed check means taking the backup again, not migrating.

What this rests on: the orders table is created by src/db/migrations/001_orders.sql:1 (`CREATE TABLE orders ...`), and the project names its database only through the driver passed to `connect` (src/db/db.js:5) - neither the engine nor the database file's path is in this repository.

Open questions, yours to answer before step 1: which database engine is it (the steps assume SQLite until you say otherwise), where is the live database file (`<db file>` above), and where should the backup copy go?
