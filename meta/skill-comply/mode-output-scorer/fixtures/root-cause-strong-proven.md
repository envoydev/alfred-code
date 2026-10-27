<!-- planted: none -->
# root-cause-strong-proven

## TASK

Cancelling order o-17 fails: `POST /orders/o-17/cancel` returns 500. The log line:

```text
SqliteError: no such column: o
    at OrderRepository.findById (src/orders/orderRepository.js:8)
    at cancelOrder (src/orders/orderService.js:12)
```

Order `17` cancels fine. Find the root cause.

## DRAFT

proven at src/orders/orderRepository.js:OrderRepository.findById

- The failure's own frame: `at OrderRepository.findById (src/orders/orderRepository.js:8)`, thrown as `SqliteError: no such column: o`.
- The code at src/orders/orderRepository.js:8: `return db.run('SELECT * FROM orders WHERE id = ' + id)[0] || null;` - the id is pasted into the SQL unquoted, so `o-17` reaches SQLite as `WHERE id = o-17`, which it parses as a column named `o` minus 17: exactly 'no such column: o'.
- Ruled out - the cancel rule and the status write: the stack stops in findById, before cancelOrder's checks run (src/orders/orderService.js:13-14), and setStatus binds its values (`'UPDATE orders SET status = ? WHERE id = ?'`, src/orders/orderRepository.js:18).
- It also explains why `17` works: `WHERE id = 17` is a number literal, which SQLite compares as text against the TEXT `id` column (src/db/migrations/001_orders.sql:1), so the same unbound SQL happens to be valid for an id with no letters or dash.
- confidence: high - the frame names the line, the line produces the exact message, and it accounts for the id that works.
- What would change the verdict: the same error from a query other than findById, or a findById that binds its id in the build that failed.
- What a fix must change: findById binds the id - `db.run('SELECT * FROM orders WHERE id = ?', [id])`, the form src/db/db.js:10 provides. That is CODE-ASSESSMENT.md W1's own fix at its one site: fix now, since this bug is that weakness. The route and the service stay as they are (ARCHITECTURE-PREFERENCES.md A1).
