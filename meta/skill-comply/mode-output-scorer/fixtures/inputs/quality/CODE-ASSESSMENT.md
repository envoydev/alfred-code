# Code assessment

Updated: 2026-10-24 (HEAD baseline)

## Rule sources

- The javascript convention rule (`.claude/rules/javascript-conventions.md`).

## Must fix

### W1 - SQL built by string concatenation

- Where: `src/orders/orderRepository.js:8` (`OrderRepository.findById`).
- Rule: every statement binds its values as parameters - `db.run(sql, params)`, `src/db/db.js:10`.
- Why it matters: the value is read as SQL - an id holding a quote or a dash breaks the query or changes it.

## Worth knowing

None.

## Deliberate tradeoffs

None.

## Proposed decisions

None.

## Summary

One Must fix: W1.
