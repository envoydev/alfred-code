<!-- planted: no quoted evidence - the verdict paraphrases the cause and quotes neither the failure nor the code -->
# root-cause-no-evidence

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

- The repository builds its lookup SQL by hand, which is a known source of trouble with ids that carry punctuation.
- A dash in the id is the likely trigger, since the order without one works.
- confidence: high.
- What would change the verdict: the same failure for an id with no dash.
- What a fix must change: findById uses a parameter for the id.
