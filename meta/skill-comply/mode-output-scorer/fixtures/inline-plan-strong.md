<!-- planted: none -->
# inline-plan-strong

## TASK

Add `refundOrder(repo, id)` and `reopenOrder(repo, id)` to the order service, each with a test: refund only a cancelled order, reopen only a cancelled order as placed.

## DRAFT

1. refundOrder in src/orders/orderService.js, its case in test/orderService.test.js - refuses any status but `cancelled`, then `setStatus(id, 'refunded')`.
2. reopenOrder in src/orders/orderService.js, its case in test/orderService.test.js - refuses any status but `cancelled`, then `setStatus(id, 'placed')`.
3. Both export from src/orders/orderService.js:18.
Depends: 1 and 2 share both files and the export line, so they land in order, never side by side; 3 consumes both functions.
Execution: route direct - mode serial - model session - two small functions in one file and one test file; parallel keeps quality: no - both edit src/orders/orderService.js and test/orderService.test.js
Checks: per batch `node --test test/orderService.test.js`; once after the change `npm test`; before a push nothing more runs locally - the project has no CI config.
