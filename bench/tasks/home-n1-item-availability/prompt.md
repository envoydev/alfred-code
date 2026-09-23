Before staff pick dates on the lending form, they want to see when an item is free. Please add `GET /api/items/{id}/availability?from=2026-03-10&to=2026-03-16`.

It answers 200 with one entry per day from `from` through `to`, both included, in date order:

```json
[
  { "date": "2026-03-10", "available": 2 },
  { "date": "2026-03-11", "available": 1 }
]
```

`available` is the item's total stock minus the number of its loans that haven't been returned and whose dates cover that day (start date through due date, both included), and never less than 0. Returned loans don't count at all, whenever they were returned. Past days are fine, and a damaged item's days are reported like any other item's.

Anyone who is signed in can call it, the same as the other item reads.

When the request can't be answered, the response has to look exactly like the API's existing answer to that kind of problem - same status, same error code, same body shape:

- `from` or `to` missing, or not a real date: invalid input.
- `to` earlier than `from`, or a range longer than 31 days counting both ends (the 1st through the 31st is the longest allowed): invalid input on `to`, answered the same way as a missing `to`.
- An unknown item: not found, the way the other item endpoints answer it.
- A retired item: a conflict, with the same error code the API gives when someone tries to lend a retired item.
