# RxJS - the mechanics behind the stream rule

The rule is `SKILL.md`'s (RxJS only where a stream earns it): observables only for genuine streams, `toSignal` at a template-only boundary, `takeUntilDestroyed` for teardown, no nested `subscribe`. This file holds the detail that rule points at.

- **Teardown.** Inside a component use `takeUntilDestroyed` (v16+) or the `DestroyRef` it reads from; a manual `Subject` plus `takeUntil` is only acceptable in a class with no injection context.
- **Flattening.** Replace a nested `subscribe` with the higher-order operator whose semantics you actually want - `switchMap` to cancel the previous, `concatMap` to queue, `mergeMap` to run in parallel, `exhaustMap` to ignore while busy - and say why in review when it is not obvious.
- **Pure `map`.** Keep `map` pure. Side effects belong in `tap`.
- **Shared streams.** Cache a shared stream with `shareReplay({ bufferSize: 1, refCount: true })` so late subscribers get the last value and the source unsubscribes when the audience empties.
- **Template boundary.** `toSignal` lets the view consume a signal and drops the async pipe's subscription bookkeeping.
