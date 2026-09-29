---
name: typescript
description: "Load before writing or editing any .ts or .tsx file, for tsconfig work, and for typing checked .js files. Not for base-language rules alone (javascript) or C#."
---

# TypeScript conventions - the type layer

**Before anything else: call the Skill tool for `javascript` now, or state it is already loaded this session** - its base-language rules (modules, async, failure channels, naming, untrusted input) are what this type layer stacks on, and a companion named only in flowing prose goes unacted (measured: a session reviewed untrusted-input parsing, squarely the base layer's trap territory, with the companion never invoked). A framework adds its own layer on top - for Angular, the framework-conventions skill covering components, templates and signals, where the install has one. Baseline is TypeScript 5+.

The single organizing idea: the compiler is the cheapest test you have. Configure it to be strict, describe your data so it can check the data, and never quietly disable it.

**The concrete tooling and the rule-by-rule style live in `references/typescript-style.md`** - the tsconfig (`@tsconfig/strictest`), the ESLint flat config (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`), Prettier, `.editorconfig`, and the naming / interface-vs-type / import / class-member rules those tools enforce. This SKILL.md owns the conceptual model below; where the two overlap, the reference is authoritative on the concrete rule. **Above both, a project's own config (its `.editorconfig`, `eslint.config.mjs`, `.prettierrc`, `tsconfig.json`) and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority - follow the project where it diverges.**

## When to use

- Before writing or editing any `.ts` or `.tsx` file, for tsconfig work, and for typing questions in checked `.js`
  files - the TypeScript type layer over the `javascript` baseline.
- Covers the strict flag set, modeling data with types, narrowing unknown instead of any, branded primitives, and
  checked JS via JSDoc and checkJs.
- In an Angular project also load the Angular framework-conventions skill, when your skill list has one - Angular
  template type-checking and component typing belong there, not here.

## Make the compiler strict, then stricter

`strict: true` is non-negotiable - it is the floor, not the goal. On top of it, turn on the flags that catch the bugs `strict` alone misses:

- `noUncheckedIndexedAccess` - `arr[i]` and `record[key]` become `T | undefined`, which is the truth. This is the single highest-value extra flag.
- `exactOptionalPropertyTypes` - `x?: T` stops silently accepting `x: undefined`, so an optional property and a present-but-undefined one are no longer conflated.
- `noImplicitOverride` - an override must say `override`, so a renamed base method surfaces as an error instead of a silent shadow.
- `noFallthroughCasesInSwitch` and `noImplicitReturns` - close the two control-flow holes where a path returns nothing or falls through unintentionally.
- The transpiler-safety set: `isolatedModules` (or `verbatimModuleSyntax`, which implies it) is mandatory when a single-file transpiler (esbuild/SWC/Vite/Babel) does the emitting - it forbids `const enum` and demands `export type` re-exports, which keeps the source portable across transpilers. `moduleResolution: "bundler"` for bundled projects, `nodenext` for direct-to-Node code.

Keep these in one shared base `tsconfig` and have each project `extends` it. A per-project config that redefines the flags drifts; one that inherits them cannot.

Where the house config-protection guard runs, it blocks any strictness-key edit to a tsconfig that already exists - a tightening included - until the user allows it. Ask for that allowance with the error count the flag surfaces, and never route around the block; a new tsconfig takes the full set from the start.

## Don't lie to the compiler

The whole value proposition collapses the moment you suppress a check. The rules:

- No `any`. For a value whose shape you genuinely don't know, use `unknown` and narrow it with a type guard before touching it. When a dependency ships no types, the `any` lives in exactly one typed wrapper module - it never leaks to call sites.
- At an external boundary (API response, user input, `JSON.parse`, message payloads), narrowing means PARSING: validate with a schema (Zod, or Valibot when bundle size matters) and take the inferred type from the schema - never cast. The network is untyped; a cast is a lie with a delay.
- `catch (e)` binds `unknown` (with `useUnknownInCatchVariables`, which `strict` turns on). Narrow before you touch it - `if (e instanceof SomeError)` - rather than assuming a `.message`.
- No `@ts-ignore`. Use `@ts-expect-error` with a reason on the same line, so the day the underlying problem is fixed the directive itself errors as unused and you delete it. `@ts-ignore` rots silently; `@ts-expect-error` is self-cleaning.
- No non-null assertion (`x!`) without a comment stating why null is impossible there. The honest alternatives are an early return or a narrowing check; the assertion is a promise to the compiler that nothing enforces.
- A user-defined guard returns `value is T`, not `boolean` - the predicate form is what teaches the compiler. Give narrowing logic a name and reuse the guard rather than re-checking inline.

A worked case that bites people: removing nulls from an array. `list.filter((x) => x != null)` keeps the right values but the result is still typed `(T | null)[]` - the compiler doesn't know the predicate narrowed anything. Write the predicate as a guard: `list.filter((x): x is T => x != null)` yields `T[]`. And `.filter(Boolean)` is not the same thing - it also drops `0`, `''`, `false`, and `NaN`, so reach for it only when you really mean every falsy value. State the predicate by what it keeps; an inverted `=> !x` reads as removal but keeps exactly the wrong elements.

## Model the data with types

A precise type is documentation the compiler enforces. Reach for the type system to make illegal states unrepresentable:

- **Discriminated unions** over a bag of optionals. Give each variant a literal tag (`kind` / `type`) and let a `switch` branch on it; a `never`-typed `default` makes the switch exhaustive, so adding a variant forces every consumer to handle it. This is the workhorse - prefer it to inheritance and to 'some of these fields are set together' objects.
- **Utility types** instead of re-typing shapes: `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `Record`, `ReturnType`, `Parameters`, `Awaited`. A derived type stays correct when its source changes.
- **String-literal unions** over `enum` for any closed set that crosses a runtime boundary - JSON, storage, a wire message. A union is just strings at runtime, so it round-trips cleanly; an `enum` is a runtime object with its own quirks. Keep `const enum` only for values that stay inside one bundle and never cross a package edge.
- **`interface` vs `type`**: `interface` for object shapes that are implemented or extended; `type` for unions, intersections, tuples, and anything mapped or conditional. Be consistent within a file rather than mixing both for the same job.
- **Model absence on purpose.** A lone optional (`x?: T`) beats `T | null | undefined` ambiguity. Pick `undefined` or `null` and mean one of them throughout a codebase - `undefined` is the TS-idiomatic default. Keep correlated nullable fields all-or-nothing: a `{ lat: number; lng: number } | null`, or a discriminated state, never two independent optionals that can drift into an impossible half-set. Build objects complete through a factory rather than assembling them via nullable intermediates.
- **`satisfies` for config objects and lookup tables** - it validates against the type while keeping the narrowest inferred literals, where an annotation widens and `as const` alone checks nothing.
- **`readonly` by default.** `readonly` properties, `readonly T[]` / `ReadonlyArray<T>` for collections, `as const` for literal config and tuples. Mutation is the exception you opt into, not the default you forget to prevent.
- **Brand primitives that share a representation but not a meaning** - a `UserId` and a `PostId` are both `string`, and mixing them is a real bug. `type UserId = string & { readonly __brand: 'UserId' }`, constructed only through a single validating guard, never a bare `as` at call sites. It is compile-time only - zero runtime cost - and it makes the type system reject a `PostId` where a `UserId` is required.

The mental model underneath all of this: a type is a set of values. Assignability is 'is a subset of'; `extends` and intersection shrink the set; `never` is the empty set and `unknown` the set of everything. That is why a `never` default proves exhaustiveness and why `unknown` is the safe top type to narrow down from.

Library-grade type work - conditional types with `infer`, mapped types, template-literal types - is worth it behind a published API surface, verified with `tsc --noEmit`. It is not worth it when a plain type or a utility type already says the shape. Type-level cleverness is a cost; spend it only where the surface is wide enough to repay it.

## Type-layer imports

- `import type { ... }` for type-only imports. It erases at build, can't pull a value at runtime, and won't create an import cycle through types alone (`verbatimModuleSyntax` makes the distinction explicit and enforced).
- When an upstream package's types are merely incomplete, fix them in place with module augmentation - `declare module 'pkg' { ... }`, or `declare global { interface Window { ... } }` for globals - in a dedicated `*.d.ts`. That is strictly better than casting to `any` or wrapping the library to dodge the gap.

## TypeScript version state

TS 7 (the Go-native rewrite) is rolling out: same type system and syntax, roughly 10x faster type-checking - but its stability state moves fast, so verify the CURRENT release status and your toolchain's support (editor LSP, programmatic API) via the documentation server at adoption time rather than trusting recall. Adopt it first where risk is lowest and the win immediate: `tsc --noEmit` in CI. Hold on TS 6 if you depend on the programmatic compiler API (ts-morph, custom transformers, some framework template type-checkers) until the stable 7.x API ships. Transpilation stays on esbuild/SWC/Vite regardless - they strip types without checking; only `tsc --noEmit` is type safety.

## Plain JavaScript is checked JavaScript

You don't lose the type checker by writing `.js`. The same language server checks it - turn it on:

- `// @ts-check` at the top of a single file, or `checkJs: true` with `allowJs: true` in `jsconfig.json` / `tsconfig.json` for a whole tree. Treat the diagnostics it produces as real errors.
- Describe types in JSDoc - `@param`, `@returns`, `@type`, `@typedef`. The language server reads JSDoc for inference and diagnostics, so JS gets most of TypeScript's safety with no build step at all.
- When a JS file fills up with `@typedef` and JSDoc generics, that's the signal it wants to be `.ts`. Convert it.

## Tooling

- ESLint with typescript-eslint and its type-aware rules, plus Prettier. Both run pre-commit and in CI. Prettier owns formatting - don't hand-format and don't add stylistic ESLint rules that fight it; let the lint surface real problems, not whitespace. The concrete config to copy - the flat `eslint.config.mjs`, the `@tsconfig/strictest` base, the `.prettierrc` and `.editorconfig` - is in `references/typescript-style.md`.
- Type-check in CI as its own step (`tsc --noEmit`), separate from bundling. A bundler can transpile past a type error; an explicit `tsc` pass cannot, so a green build genuinely means a type-clean build.
- Public API surfaces carry JSDoc - `@param`, `@returns`, `@throws`. It documents intent and feeds editor tooling for both TS and JS consumers.
- Class-member style - the `public` modifier, `#private` vs `private`, `readonly` on injected fields, `override`, parameter properties, and member ordering - is `references/typescript-style.md`'s ground; follow it there rather than from recall.

## Prove it

Before any done word on a TypeScript change, run the project's type check (`tsc --noEmit`, with `-p` naming the tsconfig that covers the change, or the workspace's own typecheck script) and its lint over what changed, and quote both result lines. A bundle that built is no type check; with neither command available, the close says the change is type-unchecked.
