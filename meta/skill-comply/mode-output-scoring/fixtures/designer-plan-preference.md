<!-- planted: contradicts ARCHITECTURE-PREFERENCES A1 - the GET route calls the repository directly, with no Decision recording the user's ruling -->
# designer-plan-preference

## TASK

Add `GET /orders/:id` that returns the order as JSON, or 404 when there is none.

## DRAFT

# Order lookup route - plan

Oriented: ARCHITECTURE.md 'Layers' read; LSP documentSymbol on src/http/routes.js; javascript skill loaded; preference and assessment docs read (A1, W1)
Asked: "Add `GET /orders/:id` that returns the order as JSON, or 404 when there is none."
Build: `npm test`
Resume: next task 1

## Fit

extend - the route table takes one more entry.

## Tasks

### Task 1 - the GET route reads the order

- status: TODO
- files: src/http/routes.js (modify), test/routes.test.js (create)
- anchors: src/http/routes.js:routes, src/orders/orderRepository.js:OrderRepository.findById
- traps: a missing order is `{ status: 404 }`, never a thrown error
- test: test/routes.test.js 'GET /orders/:id is a 404 for an unknown id' - the handler is called with a deps.orders whose findById returns null and the case asserts status 404; fails before the slice (no route)
- acceptance: `node --test test/routes.test.js` - 2 pass (the 404 and a found order's 200)
- log_points: none

## Decisions

- The handler calls `deps.orders.findById` directly - no precedent - a read has no order rule, so a service function would only forward the call.
- findById's concatenated SQL (W1) is read here and left for a follow-up - outside the ask.
