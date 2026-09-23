Members have stopped getting loan confirmations and return receipts since yesterday's cleanup, when a few test loans were deleted straight from the database. The worker logs `Worker cycle failed` on every cycle, with a `DbUpdateException` whose inner error is:

```
23503: insert or update on table "Notices" violates foreign key constraint "FK_Notices_Loans_LoanId"
```

In `OutboxMessages`, the oldest unprocessed row is a `loan.created.v1` for one of the deleted loans. Its `Attempts` is still 0, its `LastError` is empty, and every message queued after it is still waiting.

Please fix the worker so one bad message can't hold up the others. A message that fails while it's being handled - a message for a loan that no longer exists included - has to be treated like any other failing message: the attempt is counted and its error recorded, it's retried on later passes, and it's set aside after the usual number of attempts. The messages after it are handled in the same pass as if it weren't there, and the pass still reports how many messages it handled successfully. A message for a loan that no longer exists sends no notice.

The worker tests build `OutboxProcessor` and `NoticeSender` directly, so keep their constructors and `ProcessPendingAsync` as they are.
