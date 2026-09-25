---
name: ts-js-testing
description: "Load before writing, changing or reviewing plain TypeScript/JavaScript tests or configuring coverage: libraries, Node CLIs, framework-free web code, extension unit tests; runner detection (Vitest default), fake timers, mutation testing. Not for Angular/Ionic specs or .NET tests."
---

# TypeScript Testing

Practices and tooling for plain TypeScript/JavaScript tests - libraries, Node CLIs and tooling,
framework-free web code, and the browser-extension unit layer: how to write tests worth
counting, and which code coverage cannot meaningfully claim (the % bar itself is not this
skill's - see Coverage).

Plain-JavaScript projects (`.js`/`.mjs`, with or without JSDoc/checkJs) share everything here -
the published-type-surface section is the only TS-only part; a checked-JS project keeps
`tsc --noEmit` in CI the same way. Framework surfaces have their own hubs: Angular and Ionic
suites belong to the Angular testing skill, .NET to the .NET testing skill. Browser extensions
share everything here for their chrome-free logic; the extension-specific seams - the mocked
`chrome.*` API and Playwright persistent-context E2E - belong to the browser-extension skill, the
one covering MV3 manifests and that seam.

## Runner routing

Use whichever the workspace already runs - `package.json` names it. The default-runner rule is
the `javascript` skill's: **Vitest** for a new plain-TS/JS suite (ESM-first, Jest-compatible
API), Jest only where the project already signals it (existing config/deps, a monorepo sibling
on Jest), `node:test` the zero-dependency floor for small libraries. Detect, never install or
migrate a runner inside a task; a migration is its own user-approved change.

## Test strategy by role

- **Pure modules** - the bulk of a well-factored TS codebase: plain input/output specs,
  table-driven (`test.each`) when the interesting part is the input matrix. No mocks - a 'pure'
  module that needs one is a design smell to surface, not to mock around.
- **Boundary seams (HTTP, storage, clock, chrome.*)** - inject the dependency and stub the seam
  you OWN (a fetch wrapper, a storage port, a clock), not the global it wraps.
  `vi.mock`/`jest.mock` whole-module mocking is the last resort, not the default: it is hoisted,
  couples specs to import paths, and survives refactors worst. msw belongs to workspaces already
  carrying it - it exercises the real request pipeline; do not add it for one spec.
- **DOM-adjacent code** - jsdom/happy-dom covers DOM structure and synchronous events; assert
  through user-facing queries (Testing Library where present) rather than implementation
  internals. Be honest about the boundary: no layout, no navigation, no real focus or scroll -
  a behavior only a browser proves moves to a Playwright E2E (or, interactively, the MCP that
  drives a real browser, when one is registered), never into deeper jsdom mocking.
- **Node-runtime code (fs, env, processes)** - real temp dirs (`fs.mkdtemp`) beat fs mocks;
  `memfs` where the workspace already uses it. `vi.stubEnv` over raw `process.env` writes - it is NOT
  restored per test on its own (`unstubEnvs` defaults to false), so set `unstubEnvs: true` in the
  Vitest config or call `vi.unstubAllEnvs()` in a `beforeEach`, or the stub bleeds into every later
  test (verified against the Vitest docs, `config/unstubenvs` + `api/vi`, 2026-09-12);
  child-process work goes behind an injected exec seam like any boundary.
- **Published type surface** - `expectTypeOf`/`tsd` assertions only for types that ARE the
  product (a library's public generics, a message-contract union); app-internal types are
  already tested by the compiler, and `tsc --noEmit` in CI is part of the suite.

## Timing and async

Fake timers (`vi.useFakeTimers` + `advanceTimersByTime`) for debounce/retry/backoff logic;
always `await` the promise under test - a floating promise passes vacuously and lands its
failure in the wrong spec. Never a raw `setTimeout` wait in a spec; a spec that passes only
with an arbitrary sleep is a bug in the spec.

## The mock-masking trap

Module mocks bypass real wiring, so a broken entry point ships with a green suite - the same
failure class as Angular's TestBed masking. Keep one smoke spec that imports the REAL public
entry (the package barrel or the composition root), builds the object graph unmocked, and
exercises one end-to-end call - a broken export map, circular import, or mis-wired factory then
fails a spec, not the consumer:

```ts
// smoke.spec.ts - the one spec with no vi.mock anywhere: real modules, real wiring;
// only the network boundary is injected through the seam the app already exposes.
import { createApp } from '../src';
test('the real wiring boots and answers', async () => {
  const app = createApp({ fetchJson: async () => ({ ok: true }) });
  await expect(app.healthCheck()).resolves.toEqual({ ok: true });
});
```

## Coverage

- The % bar is the USER's, owned and recorded by the `alfred-capture-test-coverage` capture -
  this skill sets no number.
- What this skill owns is the mechanics: coverage is computed after exclusions so the number
  reflects real logic coverage, not padding - the catalog below is that list for plain TS/JS.

## Standard exclusions

- Config files (`*.config.ts`/`.js`/`.mjs` - vitest/vite/eslint/prettier), environment and
  bootstrap stubs, bin-entry shims that only call `main()`
- Type-only code: `.d.ts` files, modules holding only types/interfaces/constants (the compiler
  tests those)
- Barrel files (`index.ts` re-exports), generated code and build output (`dist/`, generated API
  clients)
- Extensions: the manifest (generated or not) and toolkit-generated wiring - covered by the
  extension E2E, not by line coverage

## Suite quality

Every spec asserts observable behavior - return values, thrown errors, emitted events, written
files, HTTP traffic; no assertion-free or coverage-padding specs, no `expect(true)`. When
reviewing an existing suite (or running mutation testing), load this skill's own
`references/suite-audit.md` - the false-confidence catalog, the assertion-depth and mock-usage
passes, and StrykerJS mutation testing. The catalog:
assertion-free / always-true, coverage-touching, tautological, missing-await,
swallowed-exception, disabled assertions.
