# Auditing an existing test suite

Loaded when reviewing test quality ('are these tests any good?') or running mutation testing. A test that passes can still prove nothing - scan for the false-confidence anti-patterns first, because they are the ones that read as coverage while verifying nothing.

## False-confidence anti-patterns

- **No assertions / always-true** - runs code but never asserts (no `expect(...)` / `assert.*`), or asserts a constant (`expect(true).toBe(true)`, `expect(x).toEqual(x)`). A mock verification (`toHaveBeenCalled*` / `toHaveBeenCalledWith`) does count as an assertion.
- **Coverage-touching** - a *systematic* sweep calling every exported function with no real assertion (or only a `toBeDefined()`), to inflate the coverage number. The tell is the surface-area sweep, not a single missing assert.
- **Tautological / self-referential assertion** - asserts an identity round-trip (`expect(parse(input.toString())).toEqual(input)`) or a field against itself (`expect(dto.name).toBe(dto.name)`). It can only fail if the round-trip breaks; it never proves a transformation happened.
- **Missing `await` on an async assertion** - `expect(fn()).rejects.toThrow(...)` (or a `.resolves` assertion) without `await` - or an unawaited `expectAsync(...)` under Jasmine; it passes silently even when the assertion would fail. Same for a forgotten `await` on an async act step.
- **Swallowed exception / assert-only-in-catch** - `try { act(); } catch {}`, or asserting only inside the `catch`; both pass when no error is thrown even if the result is wrong. Use `expect(...).toThrow` / `await expect(...).rejects`.
- **Commented-out or disabled assertions** (or `it.skip` left behind) - the test still runs or lists as 'passing', giving the illusion of coverage. This is coverage-gaming; reject it in review.

## Two deeper passes

Beyond the catalog: judge **assertion depth** (do the specs verify different facets of correctness, or restate one shallow check), and run a **mock-usage audit** - trace each `vi.mock` / `jest.mock` / stub setup through the production path for that spec's inputs and classify it *used* (reached), *unreachable* (a guard/throw/branch skips it), *unused* (production never calls it on any input), or *redundant* (the same setup duplicated across specs instead of shared). Delete unreachable and unused setups; share redundant ones. Mocking stable pieces you own (a `fetch` wrapper, a logger) is usually over-mocking - prefer the real instance; timers are the exception (fake them).

## Red-check before you trust a finding

A catalog hit above is a CLAIM about what a test does or does not guard - prove it before rewriting or deleting: temporarily break the behavior the test's name promises (invert the guard, flip the return, comment the call) and run the test. Still green = the finding is real, the test never guarded that behavior - fix the test, re-run against the same break, and require RED before restoring the code. Goes red = a false positive - the test guards it through a path the audit missed; leave it. (Measured across one 21-finding round: every fix proven this way, and the red-check caught roughly 1 seat false positive in 20 - an audit that skips it rewrites working tests.) Deletion follows the same rule: a test leaves as vacuous only after the break-run showed it green.

## Mutation testing - do the tests catch faults

Coverage proves a line *ran*; it does not prove a test would *fail* if that line were wrong. Mutation testing closes that gap: **StrykerJS** (`@stryker-mutator/core` plus the runner plugin matching the suite - Vitest, Jest, or Karma) mutates the production code (flips a `>` to `>=`, a `+` to `-`, removes a statement) and reruns the tests - a mutant the suite kills is a fault the tests would catch, a *surviving* mutant is a real blind spot a high coverage number hid.

- **Scope it** - run on critical / high-risk modules, never blindly across the whole workspace. It is expensive and amplifies flaky or slow suites, so keep it off the fast PR path and stabilize the suite first.
- Install as dev dependencies and run `npx stryker run` (`npx stryker init` scaffolds the config; a `node:test` suite runs via `@stryker-mutator/tap-runner`) for local-and-CI parity.
- Read the mutation score as a *test-quality* signal interpreted with judgment, not a vanity metric - it complements line/branch coverage; the two answer different questions.
