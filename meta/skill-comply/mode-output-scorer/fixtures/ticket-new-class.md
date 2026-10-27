<!-- planted: names new code - an OrderIdValidator class and a CancelOrderDto the ticket tells the implementer to create -->
# ticket-new-class

## TASK

Create a ticket: cancelling an order whose id contains a dash fails with a 500.

## DRAFT

**Title:** [Orders/API] Cancel returns 500 for order ids containing a dash

**Description:**

```markdown
## Problem

Cancelling an order whose id contains a dash fails with HTTP 500 (`SqliteError: no such column: o`).

## Scope

- Add an `OrderIdValidator` class that checks ids against `^[a-z0-9-]+$` before any query.
- Add a `CancelOrderDto` with `id` and `reason`, built in the route and passed to the service.

## Acceptance Criteria

- `POST /orders/o-17/cancel` on a placed order returns 204 and its status reads `cancelled`.
- An id failing the validator returns 400.

## Notes

- Is the lookup's SQL built from the id as text? Check before relying on it.
```
