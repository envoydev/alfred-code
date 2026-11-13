<!-- planted: missing a shared-file dependency - both subtasks edit src/orders/orderService.js and its test file, yet run as two parallel seats -->
# inline-plan-missing-dependency

## TASK

Add `refundOrder(repo, id)` and `reopenOrder(repo, id)` to the order service, each with a test: refund only a cancelled order, reopen only a cancelled order as placed.

## DRAFT

1. refundOrder in src/orders/orderService.js with its test - refuses any status but `cancelled`, then `setStatus(id, 'refunded')`.
2. reopenOrder in src/orders/orderService.js with its test - refuses any status but `cancelled`, then `setStatus(id, 'placed')`.
3. Each exports its function.
Depends: none - the two functions do not call each other.
Execution: route direct - mode parallel seats: 2 - model seat pins - two independent functions; parallel keeps quality: yes - each unit owns its files and is verified alone
Checks: per batch `node --test test/orderService.test.js`; once after the change `npm test`; before a push nothing more runs locally.
