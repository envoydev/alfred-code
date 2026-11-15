---
name: javascript
description: "Load before writing or editing any .js, .jsx, .mjs or .cjs file in any runtime - the base layer for JS-family code. Not for C#/.NET or other languages."
user-invocable: false
---

# JavaScript conventions - the base language layer

For any runtime or package API surface not pinned down here, reach for the documentation tools rather than memory - never by grepping `node_modules` bundles.

These are the language rules for every piece of JS-family code, independent of where it runs. The TypeScript type-layer skill stacks on top of this baseline and owns everything type-system: strict flags, type modeling, and checked-JS-via-JSDoc. A framework adds its own layer above that. **A project's own config and code-style docs are higher priority - follow the project where it diverges.**

## When to use

Framework-agnostic - the base layer for all JS-family code. Load before writing or editing any .js, .jsx, .mjs, or .cjs file in any runtime - browser, Node, build script, service worker, extension.

Covers ES modules only, named exports and boundary barrels, async/await discipline with cancellation, the two failure channels (returned result vs thrown Error), modern-feature adoption (structuredClone, iterator helpers, Temporal), untrusted-input rules, naming and shape. The type layer (TypeScript, and checked JS via JSDoc) stacks on this baseline in the type-conventions skill where the project has one; frameworks add their own layer above that.

## Modules and imports

- ES modules only - `import` / `export`. No CommonJS `require` in new code, save for a `.cjs` interop shim. Set `"type": "module"` wherever the runtime allows it. The current mechanics - `require(esm)`, import attributes, the dual-package hazard - are `references/modern-runtime.md`, along with the shipped-feature catalog (iterator helpers, Set methods, `structuredClone`, Temporal for all new date work) that replaces the lodash-era idioms.
- Named exports by default; they keep one canonical name and survive renames. Reserve `export default` for the entry points a framework or bundler demands.
- Expose a package - or a feature wide enough to have a public surface - through a single index barrel at its boundary, and import through that barrel from outside. Barrels stop there: no deep intra-feature barrels (they hurt build/lint/test performance and invite cycles). Inside a feature, deep relative imports are fine; reaching past another feature's barrel is not.

## Async

- `async`/`await` over `.then()` chains; no floating promise - every promise awaited, returned, or explicitly `void`ed with a comment. A dropped rejection is an unhandled error you'll only find in production.
- `Promise.all` for independent work instead of serialized awaits in a loop.
- Thread an `AbortSignal` through cancellable I/O - fetch, timers, sockets - and wire it to teardown (component destroy, request abort, worker lifecycle). Cancellation is part of the contract, not an afterthought.
- No `async` function as a `new Promise(...)` executor - a rejection inside it vanishes. Wrap a legacy callback API exactly once in a `promisify`-style helper and use that everywhere.
- Composition semantics (`allSettled` vs `all`), the single-use-signal gotcha, `Error.cause` chaining, retry/backoff with idempotency, and stream/event-loop discipline: `references/async-patterns.md`.

## The two failure channels

- **Expected, recoverable outcomes** - not found, validation rejected, a conflict - are return values, not exceptions: a result object the call site branches on (`{ ok: true, value } | { ok: false, error }`). The failure stays visible in the signature instead of hidden in a `throw`.
- **Unexpected failures** - a bug, a broken invariant, a dependency that's down - throw. Always an `Error` (or subclass, one per distinct failure mode), never a string or plain object; `instanceof` and stack traces depend on it. Chain the original: `new AppError('upstream failed', { cause: err })`.
- Never swallow. An empty `catch`, or one that logs and limps onward, hides the failure. Handle it specifically or rethrow.

## Untrusted input

- Never merge untrusted input into objects with a recursive merge or spread without guarding `__proto__` / `constructor` / `prototype` keys - prototype pollution is the precondition gadget for a lot of downstream exploits. `Map` (or `Object.create(null)`) over plain objects for untrusted keys.
- Validate `event.origin` in every `postMessage` handler; treat cross-context messages as input, not as calls.
- No `eval`, `new Function`, or string-based `setTimeout` - there is always a data-shaped alternative.

## Naming and shape of code

- camelCase for values and functions, PascalCase for classes and constructors, UPPER_CASE for true constants; boolean predicates read as questions (`isReady`, `hasItems`). No abbreviations past the universally understood ones (`id`, `url`, `http`).
- Every name - a variable, a function or method, a class, a property, a parameter - reads clearly to a developer who has never seen the file: it says what the thing is or does, in the words of the domain. A variable, property or parameter is a noun for what it holds, with its unit where it has one (`timeoutMs`, `retryCount`); a function or method is a verb phrase for what it does (`loadSettings`, `parseVersion`); a class is a noun for the one thing it is, never a bare `Manager`, `Helper` or `Util`. No single letter outside a loop index or a one-line callback, and no `data`, `info`, `tmp`, `obj`, `val`, `res` or numbered `item2` standing alone. A name that needs a comment to be understood is renamed instead. Names outside the code being changed are not renamed unasked.
- A function does one thing. Prefer pure functions and early returns to deep nesting; a flat function with guard clauses is easier to read and to test than a pyramid.
- A file holds at most 350 lines of code, TypeScript and tests included - blank lines and comments are not counted, generated files and plain data tables are exempt. One that would pass the limit is split by responsibility before the new code goes in. A file already past it is not split unasked: new code goes into a module beside it, and the report names the file and its count.
- **Named values.** A literal that carries a meaning - a limit, a timeout, an exit code, a flag or option name, a key, a path, a status word, a version - gets a name and is written once: `MAX_RETRIES`, `EXIT_CODE.usage`, `FLAG.json`. A closed set of such values is one frozen object (`Object.freeze({ ok: 'ok', failed: 'FAIL' })`); in TypeScript the `typescript` skill gives its form. Not magic: `0`, `1` and `-1` in arithmetic or an index, `''`, `true`, `false`, `null`, a sentence written once for a person to read, and the values a test expects. A literal a host must read in place - a framework that parses the source - stays a literal.
- Constants live in a `constants` file and, in TypeScript, types in a `types` file - never beside the code that uses them, a regex or a lookup set with a single user included; `project-structure` says where those files sit. A value worked out at run time (a path joined from `__dirname`) is not a constant and stays with the code that computes it, and a value private to one test stays in the test.
- Comments are none by default: load `code-comments` before writing a doc comment or an inline one.
- `const` / `let`, never `var`. `===` / `!==`, never `==`. No implicit globals.

## Tooling

- Default test runner for plain JS/TS projects: **Vitest** (ESM-first, Jest-compatible API) - jest only where the project already signals it (existing jest config/deps, CRA, a monorepo sibling on jest); `node:test` is the zero-dependency floor for small libraries. Frameworks bring their own harness and win in their own projects.
- Performance work - Core Web Vitals in the browser, the never-block-the-event-loop discipline in Node, and the profiling toolbox - is `references/performance.md`; measure before optimizing.
- Lint and format per the project's own config; in a TypeScript project the TypeScript type-layer skill's style reference owns the concrete setup.
- Before any done word: run the project's lint and its test command over what you changed and close with `lint: <command> -> <result line>` and `tests: <command> -> <result line>`. A JS change that was never executed is a change nobody has run - the language gives you no compiler to catch it.
