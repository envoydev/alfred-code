<!-- planted: cites CODE-ASSESSMENT W1 as the proof - the assessment entry stands in for evidence from this failure -->
# root-cause-assessment-proof

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

- CODE-ASSESSMENT.md W1 records that `OrderRepository.findById` builds its SQL by concatenation and that 'an id holding a quote or a dash breaks the query'. o-17 holds a dash, so W1 is the cause.
- Ruled out - cancelOrder's checks: the assessment records no weakness there.
- confidence: high - the project's own assessment names this exact failure.
- What would change the verdict: a newer assessment that no longer lists W1.
- What a fix must change: findById binds the id as a parameter, closing W1.
