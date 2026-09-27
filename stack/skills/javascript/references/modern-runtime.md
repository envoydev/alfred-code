# Modern runtime and language state (mid-2026)

Loaded from the `javascript` skill when choosing language features or dates/decorators/module mechanics. Version facts move fast - re-verify before making one load-bearing.

## Features to prefer (shipped, safe on Node 20+/current browsers)

- `?.` and `??` (plus `??=`, `||=`, `&&=`) - fully replace lodash `get` and `&&` guard chains.
- `structuredClone()` - replaces `JSON.parse(JSON.stringify(x))` (which drops Dates, Maps, `undefined`) and most `cloneDeep` uses.
- Immutable array helpers: `toSorted()`, `toReversed()`, `toSpliced()`, `with()`, plus `at()` and `findLast()`/`findLastIndex()` - the idiomatic non-mutating update primitives.
- `Object.groupBy()` / `Map.groupBy()` - replace lodash `groupBy`.
- Iterator helpers (ES2025): `.map`/`.filter`/`.take`/`.drop`/`.flatMap`/`.reduce`/`.toArray` on any iterator - lazy pipelines without materializing intermediate arrays; prefer over eager chains on large or infinite sequences.
- Set methods (ES2025): `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`/`isSupersetOf`/`isDisjointFrom` - retire hand-rolled set logic.
- `Promise.try` (sync-or-async wrapping), `RegExp.escape` (safe user-string interpolation into regexes), top-level await in ESM.
- Explicit resource management: `using` / `await using` (TS 5.2+, Node 22+; spec-wise ES2026) for deterministic cleanup of disposables.

Unlearn on sight: `var`, the `arguments` object, `require`/`module.exports` in new code, JSON-round-trip cloning, `apply`-based max/min, moment.js, hand-rolled deep equality for grouping, IIFE module patterns.

## Temporal - dates are solved

Temporal is ES2026 (Stage 4, March 2026): Node 26 and current Firefox/Chrome/Edge ship it unflagged; Safari is the one remaining gap. Use it freely server-side; on the frontend feature-detect `globalThis.Temporal` and lazy-load `@js-temporal/polyfill` for Safari (keep the polyfill unconditionally only when Safari share is high). Treat moment.js, luxon, and for most new code date-fns/dayjs as legacy; `Date` coexists but is legacy for new code.

## Decorators - two incompatible systems

Standard TC39 decorators (TS 5.0+, no flag): value + context object, no parameter decorators, no automatic metadata. Legacy (`experimentalDecorators` + `emitDecoratorMetadata` + reflect-metadata) is what Angular and NestJS still require. Rule: new standalone TS uses standard decorators; Angular/Nest projects keep the legacy flags on; never mix the two systems in one codebase.

## Modules - the current mechanics

- ESM-only for new code (`"type": "module"`, `import.meta.url` over `__dirname`). Node 22+ `require(esm)` removed the last CJS blocker - CJS consumers can require ESM synchronously.
- **Dual-package hazard** (when a library ships both formats): a module loaded via both paths yields two instances - broken `instanceof`, doubled singletons, phantom-empty module state. Debug by logging the resolved path from both sides. Publishing mechanics (exports maps, when dual is still justified) belong to the npm packaging and publishing skill where the install has one.
- Import attributes (ES2025): `import data from './x.json' with { type: 'json' }` - Node 22+ requires this form for JSON modules (`assert` is gone); dynamic: `await import('./x.json', { with: { type: 'json' } })`.
- Import maps are stable in browsers - bare-specifier resolution and pinning for small no-build apps.

## Dead and not-yet

- Records & Tuples: withdrawn (2025). Do not wait for language-level deep immutability - `Object.freeze`, `readonly`, and structural discipline are the tools.
- Pattern matching: Stage 1/2, not close - `ts-pattern` if the ergonomics are worth a dependency today.
