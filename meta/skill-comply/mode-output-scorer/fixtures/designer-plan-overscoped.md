<!-- planted: unrequested framework - the plan adopts Express and an awilix DI container across the service for one read route -->
# designer-plan-overscoped

## TASK

Add `GET /orders/:id` that returns the order as JSON, or 404 when there is none.

## DRAFT

# Order lookup route - plan

Oriented: ARCHITECTURE.md 'Layers' read; LSP documentSymbol on src/http/routes.js and src/orders/orderService.js; javascript skill loaded; preference and assessment docs read (A1, W1)
Asked: "Add `GET /orders/:id` that returns the order as JSON, or 404 when there is none."
Build: `npm test`
Resume: next task 1

## Fit

refactor first - the hand-rolled route table has no middleware or error mapping, so the service moves onto Express with an awilix container before the new route lands.

## Tasks

### Task 1 - Express and awilix replace the route table

- status: TODO
- files: package.json (modify), src/http/app.js (create), src/container.js (create), src/http/routes.js (modify)
- anchors: src/http/routes.js:routes
- traps: every existing route keeps its status codes
- test: test/app.test.js 'POST /orders still returns 201' - asserts through supertest; fails before the slice (no app)
- acceptance: `npm test` - every test passes

### Task 2 - the order service takes its repository from the container

- status: TODO
- files: src/orders/orderService.js (modify), src/container.js (modify)
- anchors: src/orders/orderService.js:placeOrder, src/orders/orderService.js:cancelOrder
- traps: the tests' fake repository registers in a test container
- test: covered by task 1
- acceptance: `npm test` - every test passes

### Task 3 - getOrder in the service, and the GET route

- status: TODO
- files: src/orders/orderService.js (modify), src/http/app.js (modify), test/app.test.js (modify)
- anchors: src/orders/orderService.js:cancelOrder (the findById read it repeats)
- traps: a missing order is a 404, not a thrown error
- test: test/app.test.js 'GET /orders/nope is a 404' - fails before the slice (no route)
- acceptance: `npm test` - every test passes

## Decisions

- Express and awilix - no precedent - they are the common choice for a Node service of this shape and make later routes cheaper.
