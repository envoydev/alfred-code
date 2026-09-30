# Async composition, cancellation, structured failure

Loaded from the `javascript` skill for non-trivial async work - parallel composition, cancellation wiring, retries, streams. The baseline rules (await-over-then, no floating promises, thread an AbortSignal) live in the skill body; this is the pattern depth.

## Composition - pick by failure semantics

- `Promise.all` - fail-fast; one rejection discards the siblings' results. For all-or-nothing batches.
- `Promise.allSettled` - collects every outcome; the right call for parallel independent work where partial failure is acceptable. Underused - reach for it more than instinct says.
- `Promise.any` - first success (AggregateError when all fail); `Promise.race` - first settle of either kind (timeouts, hedging).

## Cancellation

- `AbortSignal.timeout(ms)` for pure timeouts (rejects with `TimeoutError`); `new AbortController()` for caller-driven cancel; `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])` to combine.
- **A signal is single-use** - once aborted, aborted forever. A fresh controller per request/attempt; reusing one across retries instantly aborts every subsequent call. (This bites through circuit-breaker libs too.)
- Wire signals into fetch, streams, sockets, and your own async APIs - accept a `signal` parameter in anything cancellable you write. The semantics map 1:1 to .NET's `CancellationToken`.

## Structured errors

- Custom error classes extend `Error` with a set `name`; chain causes: `throw new AppError('upstream failed', { cause: err })` - the original stays inspectable.
- Narrow catches by `name` (`'TimeoutError'`, `'AbortError'`) or `instanceof`; `Error.isError()` (ES2026) where cross-realm robustness matters.
- Last-resort nets, logging only: `process.on('unhandledRejection')` in Node (recent Node crashes on them by default), `window.onunhandledrejection` in browsers. The real defense is the `no-floating-promises` lint the style config already carries.

## Retry, backoff, idempotency

Exponential backoff with jitter, transient errors only (network, 429, 5xx), capped attempts, a fresh `AbortSignal.timeout` per attempt. Never blindly retry a non-idempotent write - retry safety is a property of the operation, not the wrapper.

## Streams and the event loop

- `for await...of` over async generators for backpressure-aware pipelines; Web/Node streams for large payloads instead of buffering whole bodies.
- Never block the loop: no sync FS/crypto/large-JSON on a request path; chunk long CPU loops with `scheduler.yield()`/`queueMicrotask` (browser) or `setImmediate` (Node); genuinely CPU-bound work goes to a worker (`worker_threads` / Web Workers) - the depth is `references/performance.md`.
