We want to know when an item was retired, not just that it was. Please replace the `IsRetired` flag on items with a `RetiredAt` timestamp. The API runs as several instances and migrations go out ahead of the code, so this has to ship as expand, backfill, contract without breaking the version that is running today.

Database - add exactly three EF Core migrations, applied after `AddNotices` in this order, and no others:

1. `AddItemRetiredAt` (expand) - adds a nullable `RetiredAt` column of type `timestamp with time zone` to `Items`. It changes no data and leaves `IsRetired` exactly as it is.
2. `BackfillItemRetiredAt` (backfill) - no schema change. Every item with `IsRetired = true` and no `RetiredAt` gets `RetiredAt = CreatedAt`: we don't know when those were really retired, and the creation time is the earliest it could have been. Items that are not retired keep `RetiredAt` NULL.
3. `DropItemIsRetired` (contract) - first does that same fill again for any retired item still missing a `RetiredAt` (the old version keeps retiring items the old way until it is replaced, and some of those land after the backfill ran). Then it adds a check constraint named `CK_Items_RetiredAt` so that `RetiredAt` is either NULL or not earlier than `CreatedAt`. Then it drops the `IsRetired` column.

Until the contract migration runs, today's code must keep working against the database untouched. After `AddItemRetiredAt`, and again after `BackfillItemRetiredAt`, all of these still work: inserting an item without mentioning `RetiredAt`, retiring one by setting `IsRetired = true`, and reading `IsRetired`. Nobody will roll these migrations back, so the Down methods don't need to restore anything.

The app, once all three have run:

- Wherever the API returns an item, it has a `retiredAt` field: null for an item in use, the retirement time for a retired one. `isRetired` stays, and is true exactly when `retiredAt` is set.
- Retiring an item (`DELETE /api/items/{id}`, admins only) records the current time the same way returning a loan records `returnedAt`. Everything else about it stays as today: 204 on success, a second retire is still a 409 with code `item_retired`, retired items still drop out of `GET /api/items` unless `includeRetired=true`, and a retired item still can't be lent.
- Creating or updating an item never sets or clears `retiredAt`.
