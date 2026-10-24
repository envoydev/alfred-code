<!-- planted: none -->
# topic-explainer-strong-code-track

## TASK

explain step by step how cancelling an order works in this project

## DRAFT

Cancelling an order is one request that walks three files: the route forwards it, the service checks it may be cancelled, and the repository writes the new status.

Think of a shop counter: the clerk (the route) takes your receipt, the manager (the service) checks the item has not already left in the van, and the stock-keeper (the repository) changes the label on the shelf. The analogy stops at the van: here nothing in this service puts an order 'in the van' - the `shipped` status is set somewhere else.

1. The route takes the request - `src/http/routes.js:7`:

   ```js
   ['POST', '/orders/:id/cancel', (req, deps) => { cancelOrder(deps.orders, req.params.id); return { status: 204 }; }],
   ```

   It passes the id from the URL and the repository from `deps`, and answers 204 (done, no body) when nothing throws - why: the route stays an adapter, the rules live in the service.

2. The service reads the order - `src/orders/orderService.js:12-13`:

   ```js
   const order = repo.findById(id);
   if (!order) throw new Error(`order ${id} not found`);
   ```

   Why: a cancel of an order that does not exist must fail loudly, not write a status for nothing.

3. The service refuses a shipped order - `src/orders/orderService.js:14`:

   ```js
   if (order.status === 'shipped') throw new Error(`order ${id} has shipped`);
   ```

   Why: once the goods have left, cancelling is a refund problem, not a status change.

4. The repository writes the status - `src/orders/orderRepository.js:18`:

   ```js
   return db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
   ```

   The two `?` marks are filled from the array by the driver, so the id is never read as SQL - why: a value can never change the statement.

**The core concept:** the order of the checks is the rule - read, refuse, then write - so a refused cancel never touches the database.

**The gotcha:** the read in step 2 goes through `findById` (`src/orders/orderRepository.js:8`), which pastes the id into its SQL instead of binding it - the opposite of step 4. The project records this as CODE-ASSESSMENT.md W1, so an id with a dash can fail at step 2 before the rules run.

An illustrative change - the step 2 read written the way step 4 is:

```js
return db.run('SELECT * FROM orders WHERE id = ?', [id])[0] || null;
```

Takeaway: when a function reads and then writes, check that both halves bind their values the same way - the read is the half people forget.
