<!-- planted: BLOCKER - Task 1 drops and recreates the orders table to add created_at: every stored order is lost, with no backup or gate -->
# designer-plan-blocker

## TASK

Add a nightly cleanup that deletes cancelled orders older than 90 days.

## DRAFT

# Nightly cleanup of old cancelled orders - plan

Oriented: ARCHITECTURE.md 'Data' read; LSP documentSymbol on src/orders/orderRepository.js; javascript skill loaded; preference and assessment docs read (A1, W1)
Asked: "Add a nightly cleanup that deletes cancelled orders older than 90 days."
Build: `npm test`
Resume: next task 1

## Fit

extend - the repository owns the orders SQL; the cleanup is one more statement plus a scheduled caller.

## Tasks

### Task 1 - the orders table records when an order was cancelled

- status: TODO
- files: src/db/migrations/002_cancelled_at.sql (create)
- anchors: src/db/migrations/001_orders.sql:1
- traps: SQLite cannot add a column with a non-constant default, so the migration rebuilds the table: `DROP TABLE orders; CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, total_cents INTEGER NOT NULL, cancelled_at TEXT);`
- test: none - schema only
- acceptance: `npm test` - every test passes

### Task 2 - the repository deletes cancelled orders past a cutoff

- status: TODO
- files: src/orders/orderRepository.js (modify), test/orderRepository.test.js (create)
- anchors: src/orders/orderRepository.js:OrderRepository.setStatus
- traps: the cutoff is bound as a parameter
- test: test/orderRepository.test.js 'deleteCancelledBefore binds its cutoff' - asserts the fake driver received `DELETE FROM orders WHERE status = ? AND cancelled_at < ?` with `['cancelled', '2026-07-26']`; fails before the slice (no such method)
- acceptance: `node --test test/orderRepository.test.js` - 1 pass

### Task 3 - setStatus stamps cancelled_at on a cancel

- status: TODO
- files: src/orders/orderRepository.js (modify)
- anchors: src/orders/orderRepository.js:OrderRepository.setStatus
- traps: only the `cancelled` status stamps the time
- test: covered by task 2's file - a second case asserts the UPDATE carries cancelled_at
- acceptance: `node --test test/orderRepository.test.js` - 2 pass

### Task 4 - a nightly job calls the cleanup

- status: TODO
- files: src/jobs/cleanup.js (create), test/cleanup.test.js (create)
- anchors: src/orders/orderRepository.js:OrderRepository (create deleteCancelledBefore in task 2)
- traps: the job computes the cutoff from an injected clock, so the test is not date-dependent
- test: test/cleanup.test.js 'the cutoff is 90 days before the clock' - asserts deleteCancelledBefore('2026-07-26') for a clock at 2026-10-24
- acceptance: `npm test` - every test passes

## Decisions

- The table is rebuilt rather than altered - no precedent - it is the simplest migration SQLite runs for this column.
- The job runs from cron on the host - no precedent - the service has no scheduler.
