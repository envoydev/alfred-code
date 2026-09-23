The accounting export walks every loan through `GET /api/loans?page=N&pageSize=100`, and with a couple of million rows it has become painfully slow: every page counts the whole table again, the deep pages make PostgreSQL skip past everything before them, and nothing indexes the sort order. Please give it a cursor-paged endpoint to use instead. Leave `GET /api/loans` itself as it is - the web app pages it by number.

`GET /api/loans/feed`

- Same access rule as `GET /api/loans`, and the same optional `memberId` and `status` filters with the same meaning and validation.
- `limit` - page size, 1 to 100, default 20. `after` - optional cursor.
- Order: due date ascending, then loan id ascending (the order the existing list uses).
- Response body: `{ "items": [...], "nextCursor": "..." }`. Each item is the same loan object `GET /api/loans` returns. There is no total count.
- `nextCursor` is the cursor of the last item on the page, or null when no matching loan comes after it. So a full page that happens to be the last one returns null too, and an empty result is `"items": []` with `"nextCursor": null`.
- Passing a cursor back as `after` returns the matching loans that come strictly after that position in the order above. The cursor is a position, not a loan: it keeps working if that loan has since been returned or no longer matches the filters, and a loan created later that sorts before the cursor never shows up on, or shifts, the pages after it.

Cursor format: the loan's due date and id written as `yyyy-MM-dd,id` (for example `2026-03-17,42`), UTF-8, base64url-encoded without `=` padding (that example becomes `MjAyNi0wMy0xNyw0Mg`). Clients treat it as opaque, but this is the exact encoding. Whether the server also tolerates `=` padding on input is up to you.

An `after` that doesn't decode to that shape - not base64url, the wrong shape, a date that doesn't exist, an id below 1 - is a 400, and so is a `limit` out of range. Return both the same way the existing endpoints return an invalid query parameter.

Add an index named `IX_Loans_DueDate_Id` on `Loans ("DueDate", "Id")`, in that column order, in a new migration, so the database can serve this order and seek straight to the cursor.
