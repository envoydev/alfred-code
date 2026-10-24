<!-- planted: none -->
# custom-strong

## TASK

List the steps to back up the orders database before tomorrow's migration, and how to check the backup is good.

## DRAFT

The migration touches stored data, so the gate is a backup you have restored once, before the migration runs.

1. Stop writes for the window - put the service in maintenance or stop it, so no order lands between the backup and the migration. Check: no request in the access log after the stop time.
2. Take the backup with SQLite's own copy - `sqlite3 <db file> ".backup 'orders-<date>.db'"` - which copies a consistent snapshot even if a reader is attached. Check: the file exists and is not empty.
3. Prove it restores - `sqlite3 orders-<date>.db "PRAGMA integrity_check; SELECT COUNT(*) FROM orders;"` - expect `ok` and the same count the live database gives. Check: the two counts match.
4. Keep it off the machine - copy the file to where your backups live. Check: the copy's size matches.
5. Run the migration, then the same count query on the live database. Check: the count is unchanged unless the migration means to change it.

What this rests on: the orders table is created by src/db/migrations/001_orders.sql:1 (`CREATE TABLE orders ...`), and the project names its database only through the driver passed to `connect` (src/db/db.js:5) - the database file's path is not in this repository.

Open questions: where is the live database file, and where should the backup copy go? Both are yours to give; the steps above take them as `<db file>` and the backup location.
