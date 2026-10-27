<!-- planted: adds a case of CODE-ASSESSMENT W1 - findByCustomer concatenates customerId into its SQL, citing findById as its precedent -->
# designer-plan-weakness

## TASK

Add `GET /customers/:id/orders` that lists the customer's orders.

## DRAFT

# Orders by customer - plan

Oriented: ARCHITECTURE.md 'Layers' and 'Data' read; LSP documentSymbol on src/orders/orderRepository.js, findReferences on findById; javascript skill loaded; preference and assessment docs read (A1, W1)
Asked: "Add `GET /customers/:id/orders` that lists the customer's orders."
Build: `npm test`
Resume: next task 1

## Fit

extend - the repository, the service and the route table each take one more entry.

## Tasks

### Task 1 - the orders table keeps the customer

- status: TODO
- files: src/db/migrations/002_customer_id.sql (create)
- anchors: src/db/migrations/001_orders.sql:1
- traps: existing rows have no customer - the column is nullable
- test: none - schema only, covered by task 2
- acceptance: `npm test` - every test passes

### Task 2 - the repository lists a customer's orders

- status: TODO
- files: src/orders/orderRepository.js (modify), test/orderRepository.test.js (create)
- anchors: src/orders/orderRepository.js:OrderRepository.findById
- traps: none - a read, written as findById reads: `db.run('SELECT * FROM orders WHERE customer_id = ' + customerId)`
- test: test/orderRepository.test.js 'findByCustomer selects by customer_id' - asserts the SQL the fake driver received ends `customer_id = c1`; fails before the slice (no method)
- acceptance: `node --test test/orderRepository.test.js` - 1 pass

### Task 3 - the service and the route expose the list

- status: TODO
- files: src/orders/orderService.js (modify), src/http/routes.js (modify), test/orderService.test.js (modify)
- anchors: src/orders/orderService.js:cancelOrder, src/http/routes.js:routes
- traps: an unknown customer returns an empty list, not a 404
- test: test/orderService.test.js 'listCustomerOrders returns what the repository finds' - fails before the slice
- acceptance: `npm test` - every test passes

## Decisions

- The list query follows findById's form - precedent: src/orders/orderRepository.js:8.
