<!-- planted: none -->
# ticket-strong

## TASK

Create a ticket: cancelling an order whose id contains a dash fails with a 500.

## DRAFT

**Title:** [Orders/API] Cancel returns 500 for order ids containing a dash

**Description:**

```markdown
## Problem

Cancelling an order whose id contains a dash fails with HTTP 500. `POST /orders/o-17/cancel` logs `SqliteError: no such column: o`; an id without a dash is reported to cancel normally.

## Steps to reproduce

1. Place an order with the id `o-17`.
2. Send `POST /orders/o-17/cancel`.

## Expected

204, and the order's status reads `cancelled`.

## Actual

500, and the status is unchanged.

## Acceptance Criteria

- `POST /orders/o-17/cancel` on a placed order returns 204 and its status reads `cancelled`.
- An id containing a quote (`o'1`) is treated as an id: a missing order gives the not-found error, never a SQL error.
- Cancelling a shipped order still fails with the shipped error.

## Notes

- Is the lookup's SQL built from the id as text? Check before relying on it - the error suggests the id is read as SQL.
- Do ids without a dash really cancel in the same build? Confirm with the reporter.
```
