<!-- planted: none -->
# root-cause-strong-unproven

## TASK

About 1 in 200 cancels in production take 30 seconds and then succeed. There is no error; the only log line is like `cancel o-4411 took 30012ms`. Find the root cause.

## DRAFT

unproven - 3 hypotheses ranked

1. The status UPDATE waits on a database lock held by another writer. The 30012ms is a 30s wait plus the statement, the shape of a lock timeout that gives up waiting and then succeeds once the lock frees. Would confirm it: the driver's busy or lock-wait log at the slow cancel's timestamp, or a long write transaction overlapping it.
2. The driver's connection pool is empty and the cancel waits for a connection. src/db/db.js:12 sends every statement through one `driver.query`, so a pool limit lives in the driver config, which this repository does not hold. Would confirm it: the pool's wait count or queue length at the slow cancel.
3. The client's request is retried by a proxy after a 30s idle timeout and the second attempt is the one that succeeds. Would confirm it: two requests for the same order id 30s apart in the proxy's access log.

- Evidence in hand: only the timing line from the report, `cancel o-4411 took 30012ms`; the code path is findById then setStatus (src/orders/orderService.js:12-15), both single statements.
- confidence: low - one log shape and the code path; no log ties the 30s to either statement.
- What would change the ranking: a slow cancel whose two statements each log their own time - a slow UPDATE puts 1 first, a slow wait before the first statement puts 2 first, and no slow statement at all puts 3 first.
- Log points that would raise the tier: the time before and after each `db.run` call in findById and setStatus, with the order id, at info level, plus the driver's pool wait time when it reports one.
