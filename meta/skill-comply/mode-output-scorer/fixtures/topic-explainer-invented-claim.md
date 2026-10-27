<!-- planted: invented repository claim - db.run is said to retry three times with backoff, and src/db/db.js has no retry -->
# topic-explainer-invented-claim

## TASK

explain how this project retries a failed database call

## DRAFT

This project retries a failed database call inside `db.run`: a failure is tried again up to three times, waiting longer each time.

1. Every query goes through `src/db/db.js:10`, `run(sql, params)`.
2. When the driver throws, `run` waits 100ms, then 200ms, then 400ms, retrying each time (`src/db/db.js:12`).
3. After the third failure it throws the last error to the caller, so cancelOrder and placeOrder see one error for three tries.

**The core concept:** the retry sits in one place, so every repository method gets it for free.

**The gotcha:** a retried INSERT can write the same order twice if the first try reached the database before it failed.

Takeaway: put retries at the one door every call goes through, and make the statements behind it safe to repeat.
