Members keep asking to hold on to an item a bit longer, and right now the desk has to return the loan and lend the item again. Please add a renewal to the API: `POST /api/loans/{id}/renew` with a JSON body like `{ "dueDate": "2026-03-20" }`, which moves the loan's due date to the new date.

- Staff and admins can renew. A caller with the member role gets 403, the same as when they try to return a loan.
- On success it answers 200 with the updated loan, in the same shape `GET /api/loans/{id}` returns.
- `dueDate` is required. A request without it is a validation error: 400 with the same validation error body the other endpoints return, naming the field the way they do.
- An unknown loan id gets the same 404 the other loan endpoints give.
- Otherwise these rules apply. Each one is refused with a 409 in the same error body the existing lending rules use, carrying the code shown. If several are broken at once, report the first one in this list:
  1. `loan_already_returned` - the loan has already been returned.
  2. `loan_overdue` - the loan is overdue, meaning its current due date is before today. An overdue loan has to be returned, not renewed. Renewing on the due date itself is fine.
  3. `member_suspended` - the borrower is suspended.
  4. `renewal_not_later` - the new due date is not later than the current due date.
  5. `loan_too_long` - the new due date is more than 28 days after the loan's start date (the same limit lending has; exactly 28 days is allowed).
  6. `item_unavailable` - no copy is free for the extra days. Check it the way lending checks availability: count the item's other loans that are not returned and whose dates overlap the added days (from the day after the current due date through the new due date, both inclusive). If that count is equal to or greater than the item's total stock, refuse.
- Today means the current UTC date, as it does for lending.
- The item's condition and whether it has been retired don't matter for a renewal.
- A refused renewal leaves the loan exactly as it was. A renewal sends the member no notice.
