<!-- planted: none -->
# topic-explainer-strong-code-track

## TASK

explain step by step how cancelling an order works in this project

## DRAFT

Cancelling an order is one request that walks three files: the route forwards it, the service checks it may be cancelled and asks for the `'cancelled'` status, and the repository writes that status.

Think of a shop counter: the clerk (the route) takes your receipt, the manager (the service) checks the item has not already left in the van, and the stock-keeper (the repository) changes the label on the shelf to 'cancelled'. The analogy stops at the van: no code in this repository puts an order 'in the van' - it only reads the `shipped` status, at `src/orders/orderService.js:14`; what sets it is not here.

1. The route takes the request - `src/http/routes.js:7`:

   ```js
   ['POST', '/orders/:id/cancel', (req, deps) => { cancelOrder(deps.orders, req.params.id); return { status: 204 }; }],
   ```

   It passes the id from the URL and the repository from `deps`, and answers 204 (done, no body) when nothing throws - why: the project's rule A1 (`ARCHITECTURE-PREFERENCES.md`) has a route call the service, never the repository, so the order rules live in one place.

2. The service reads the order - `src/orders/orderService.js:12-13`:

   ```js
   const order = repo.findById(id);
   if (!order) throw new Error(`order ${id} not found`);
   ```

   Why: the throw ends the cancel before any write, so an id with no order writes nothing.

3. The service refuses a shipped order - `src/orders/orderService.js:14`:

   ```js
   if (order.status === 'shipped') throw new Error(`order ${id} has shipped`);
   ```

   Why: the repository states no reason for this rule; what the line does is make sure a shipped order never reads 'cancelled'.

4. The service asks for the new status - `src/orders/orderService.js:15`:

   ```js
   repo.setStatus(id, 'cancelled');
   ```

   Why: the service names the status and the repository only stores it, so the word 'cancelled' lives in one place.

5. The repository writes the status - `src/orders/orderRepository.js:18`:

   ```js
   return db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
   ```

   The two `?` marks are filled from the array by the driver, so the id is never read as SQL - why: the project's rule is that every statement binds its values as parameters (`CODE-ASSESSMENT.md` W1, `db.run(sql, params)` at `src/db/db.js:10`).

For example, `cancelOrder` with the id `o1`, run against the fake repository the tests use (`fakeRepo`, `test/orderService.test.js:6`, whose `findById` returns the order it was given) holding `{ id: 'o1', status: 'placed' }`: step 2 gets that order back, `'placed'` passes step 3, and step 4 records `['o1', 'cancelled']` in the fake's `statuses`; the real repository would run step 5's UPDATE with `['cancelled', 'o1']`, and the route would answer 204. Against the real repository this same id stops at step 2 - the gotcha below says why.

What a refused cancel sends back is not in this repository: the route has no `try`/`catch`, and nothing here runs the `routes` table (`src/index.js` exports only `answer`), so the HTTP status a client sees for 'not found' or 'has shipped' depends on a dispatcher that is not here.

**The core concept:** the order of the checks is the rule - read, refuse, then write - so a refused cancel never writes: it reads the order once (step 2) and stops before steps 4 and 5.

**The gotcha:** the read in step 2 goes through `findById` (`src/orders/orderRepository.js:8`), which pastes the id into its SQL instead of binding it - the opposite of step 5:

```js
return db.run('SELECT * FROM orders WHERE id = ' + id)[0] || null;
```

For the id `o1` that builds `SELECT * FROM orders WHERE id = o1` - no quotes round a value the table stores as `TEXT` (`src/db/migrations/001_orders.sql:1`), so standard SQL reads `o1` as a column name and the read fails before steps 3-5 run. That outcome is reasoning from standard SQL, not a run: the driver is not in this repository (`src/db/db.js` takes it through `connect`, and its `run` passes the statement to `driver.query`). The id also comes straight from the URL (`src/http/routes.js:7`) with no check on the way, so an id holding a quote or a dash 'breaks the query or changes it' (`CODE-ASSESSMENT.md` W1, the project's one Must fix): a crafted id can change which row the checks in steps 2 and 3 read.

An illustrative change - the step 2 read written the way step 5 is:

```js
return db.run('SELECT * FROM orders WHERE id = ?', [id])[0] || null;
```

Takeaway: when a function reads and then writes, check that both halves bind their values the same way - the read is the half people forget.
