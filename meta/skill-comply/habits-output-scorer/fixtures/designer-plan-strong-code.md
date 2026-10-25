<!-- planted: none -->
# designer-plan-strong-code

## TASK

Add a cancellation reason: `POST /orders/:id/cancel` takes a `reason` (required, at most 200 characters), the order stores it, and the order row keeps it. Do not change how placing an order works.

## DRAFT

# Cancellation reason - plan

Oriented: ARCHITECTURE.md 'Layers' and 'Data' read; LSP documentSymbol on src/orders/orderService.js and src/orders/orderRepository.js, findReferences on cancelOrder (src/http/routes.js:7, test/orderService.test.js:17); javascript skill loaded; ARCHITECTURE-PREFERENCES.md A1 and quality/CODE-ASSESSMENT.md W1 read
Asked: "Add a cancellation reason: `POST /orders/:id/cancel` takes a `reason` (required, at most 200 characters), the order stores it, and the order row keeps it. Do not change how placing an order works."
Build: `npm test`
Resume: next task 1

## Fit

extend - cancelOrder already owns the cancel rule and the repository owns the status write; the reason rides the same path, so no new seam is needed.

## Tasks

### Task 1 - the orders table keeps a cancel reason

- status: TODO
- files: src/db/migrations/002_cancel_reason.sql (create) - `ALTER TABLE orders ADD COLUMN cancel_reason TEXT;`
- anchors: src/db/migrations/001_orders.sql:1 (the orders table)
- traps: a NOT NULL column fails on the rows already stored - the column is nullable and existing rows read NULL
- test: none - schema only; task 2's repository test asserts the UPDATE statement that writes `cancel_reason`
- acceptance: `npm test` - every test passes
- log_points: none - a migration has no runtime path here

### Task 2 - the repository writes the reason with the status

- status: TODO
- files: src/orders/orderRepository.js (modify), test/orderRepository.test.js (create)
- anchors: src/orders/orderRepository.js:OrderRepository.setStatus
- traps: the reason is user text - it is bound as a parameter, never concatenated (the W1 shape)
- test: test/orderRepository.test.js 'cancel writes the reason as a parameter' - a fake driver records `query(sql, params)` and the case asserts the sql `UPDATE orders SET status = ?, cancel_reason = ? WHERE id = ?` and the params `['cancelled', 'late delivery', 'o1']`; it fails before the slice because setStatus takes no reason and its statement names no `cancel_reason`
- acceptance: `node --test test/orderRepository.test.js` - 1 pass, 0 fail
- log_points: none - the service is the place a cancel would be logged, and it has no logger yet

### Task 3 - cancelOrder requires the reason and passes it on

- status: TODO
- files: src/orders/orderService.js (modify), test/orderService.test.js (modify)
- anchors: src/orders/orderService.js:cancelOrder
- traps: a missing, empty or whitespace-only reason, one that is not a string (a number or an object from the JSON body) and one of 201 characters must throw before any write
- test: test/orderService.test.js - the fake repository's `setStatus(id, s, reason)` records all three; 'a cancel passes the reason to the repository' asserts statuses `[['o1', 'cancelled', 'late delivery']]`, and 'a reason over 200 characters is refused' asserts the call throws /reason/ with statuses empty; the first fails before the slice because cancelOrder calls `setStatus(id, 'cancelled')` with no reason, the second because cancelOrder ignores a reason
- acceptance: `node --test test/orderService.test.js` - every case passes
- log_points: none - no logger in this service

### Task 4 - the cancel route forwards the reason

- status: TODO
- files: src/http/routes.js (modify), test/routes.test.js (create)
- anchors: src/http/routes.js:routes (the `POST /orders/:id/cancel` entry)
- traps: a request with no body must reach cancelOrder as an undefined reason, so the service's check answers it
- test: test/routes.test.js 'the cancel route forwards the body's reason' - calls the route's handler with `{ params: { id: 'o1' }, body: { reason: 'late delivery' } }` and a fake `deps.orders` holding a placed o1, and asserts its statuses `[['o1', 'cancelled', 'late delivery']]`; it fails before the slice because the handler calls `cancelOrder(deps.orders, req.params.id)` and drops the body
- acceptance: `npm test` - every test passes
- log_points: none

## Decisions

- The reason lives on the order row, not in a history table - precedent: src/db/migrations/001_orders.sql:1 keeps the status on the row; a history was not asked for.
- The length and presence check sits in cancelOrder - precedent: placeOrder checks totalCents at src/orders/orderService.js:5, so the service owns input rules and the route stays a thin adapter (ARCHITECTURE-PREFERENCES.md A1).
- A cancel with no reason now fails - no precedent - a public contract change the ask names ('required'); gate: tasks 1-4 ship in one commit; rollback: revert that commit, and the nullable column can stay behind harmlessly.
- Presence is judged on the trimmed reason, the 200-character limit on the reason as sent, and the row stores it as sent - no precedent - placeOrder takes no text to follow; trimming before storing was the alternative, rejected because the ask says the row keeps the reason, not a cleaned copy.
- A second cancel of an already-cancelled order overwrites the stored reason - no precedent - today's cancelOrder re-cancels without complaint and the ask adds no rule for a repeat; refusing a re-cancel was the alternative, rejected as a contract change outside the ask.
- The migration is not run by any test - no precedent - the project has no migration runner or test database (001_orders.sql is applied by hand); adding one is outside the ask, and task 2's test pins the column the migration adds.
- findById's concatenated SQL (CODE-ASSESSMENT.md W1) is read by cancelOrder and left for a follow-up - no precedent - outside the ask, and no card adds a new case of it.
