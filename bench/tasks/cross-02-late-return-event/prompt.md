When a member brings an item back after its due date, the worker sends them the same return receipt as for an on-time return. We want a late-return notice instead. The worker can't tell today, because the return event only says which loan came back, for which member, and when.

Please change the return event and teach the worker about it:

- From now on, returning a loan (`POST /api/loans/{id}/return`) writes a `loan.returned.v2` event to the outbox instead of `loan.returned.v1` - still exactly one per return, saved together with the return as today. Its payload has `loanId`, `memberId`, `returnedAt`, `dueDate` and `daysLate`, written in the same JSON form as the existing events. `dueDate` is the loan's due date (for example `"2026-03-13"`). `daysLate` is how many days after the due date the item came back, counting the UTC calendar day of `returnedAt`, the same way the API decides a loan is overdue: 0 when it comes back on or before the due date, 1 when it comes back at any time on the day after, and so on.
- The worker handles `loan.returned.v2`: when `daysLate` is above 0 it sends a new kind of notice, `LateReturn`, for that loan, and no return receipt. When `daysLate` is 0 it sends the usual `ReturnReceipt`. As with every notice, each kind goes out at most once per loan, so the same event arriving twice sends one notice.
- `loan.returned.v1` messages written before this ships are still in the outbox, so the worker must keep handling them exactly as today: a `ReturnReceipt`.
- `loan.created.v1` doesn't change.
