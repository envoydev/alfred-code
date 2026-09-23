Staff want more ways to narrow the loans list. Please add these optional query parameters to `GET /api/loans`:

- `itemId`: only loans of that item. Same rules as the existing `memberId`, including the 400 for a value below 1.
- `dueFrom` and `dueTo`: dates like `2026-03-20`; keep only loans due on or after `dueFrom` and on or before `dueTo`. Either one can be used alone. If `dueFrom` is later than `dueTo`, the result is simply empty, not an error.
- `search`: keep only loans whose item name or member name contains the text, ignoring case - the same kind of match the items list's `search` does, with the same 100-character limit.

All the filters given apply together, including the existing `memberId` and `status`. Ordering, paging and the response shape stay exactly as they are now. Add integration tests for the new filters next to the existing ones.

Heads up: I'm halfway through loan renewals, so you'll see uncommitted changes of mine around loans in the working copy. That's separate from this - I'll finish it myself.
