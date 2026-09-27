---
name: typescript
description: Load before writing or editing any .ts or .tsx file, for tsconfig work, and for typing questions in checked .js files - the TypeScript type layer over the `javascript` baseline. Covers the strict flag set, modeling data with types, narrowing unknown instead of any, branded primitives, and checked JS via JSDoc and checkJs. Baseline is TypeScript 5+. Load `javascript` with it, the base-language layer this stacks on; in an Angular project also load the Angular framework-conventions skill, when your skill list has one - Angular template type-checking and component typing belong there, not here. Not for base-language rules alone (javascript) or C#/.NET.
---

# TypeScript conventions - the type layer

**Before anything else: call the Skill tool for `javascript` now, or state it is already loaded this session** - its base-language rules (modules, async, failure channels, naming, untrusted input) are what this type layer stacks on. A framework adds its own layer on top - for Angular, the framework-conventions skill covering components, templates and signals, where the install has one. Baseline is TypeScript 5+.

The single organizing idea: the compiler is the cheapest test you have. Configure it to be strict, describe your data so it can check the data, and never quietly disable it.

**The concrete tooling and the rule-by-rule style live in `references/typescript-style.md`** - the tsconfig (`@tsconfig/strictest`), the ESLint flat config (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`), Prettier, `.editorconfig`, and the naming / interface-vs-type / import / class-member rules those tools enforce. This SKILL.md owns the conceptual model below; where the two overlap, the reference is authoritative on the concrete rule. **Above both, a project's own config (its `.editorconfig`, `eslint.config.mjs`, `.prettierrc`, `tsconfig.json`) and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority - follow the project where it diverges.**

## Make the compiler strict, then stricter

`strict: true` is non-negotiable - it is the floor, not the goal. On top of it, turn on the flags that catch the bugs `strict` alone misses:

- `noUncheckedIndexedAccess` - `arr[i]` and `record[key]` become `T | undefined`, which is the truth. This is the single highest-value extra flag.
- `exactOptionalPropertyTypes` - `x?: T` stops silently accepting `x: undefined`, so an optional property and a present-but-undefined one are no longer conflated.
- `noImplicitOverride` - an override must say `override`, so a renamed base method surfaces as an error instead of a silent shadow.
- `noFallthroughCasesInSwitch` and `noImplicitReturns` - close the two control-flow holes where a path returns nothing or falls through unintentionally.
- The transpiler-safety set: `isolatedModules` (or `verbatimModuleSyntax`, which implies it) is mandatory when a single-file transpiler (esbuild/SWC/Vite/Babel) does the emitting - it forbids `const enum` and demands `export type` re-exports, which keeps the source portable across transpilers. `moduleResolution: "bundler"` for bundled projects, `nodenext` for direct-to-Node code.

Keep them in one shared base `tsconfig` that each project `extends` - a redefined copy drifts.

Where the house config-protection guard runs, it blocks any strictness-key edit to a tsconfig that already exists - a tightening included - until the user allows it. Ask for that allowance with the error count the flag surfaces, and never route around the block; a new tsconfig takes the full set from the start.

## Don't lie to the compiler

The whole value proposition collapses the moment you suppress a check. The rules:

- No `any`. For a value whose shape you genuinely don't know, use `unknown` and narrow it with a type guard before touching it. When a dependency ships no types, the `any` lives in exactly one typed wrapper module - it never leaks to call sites.
- At an external boundary (API response, user input, `JSON.parse`, message payloads), narrowing means PARSING: validate with a schema (Zod, or Valibot when bundle size matters) and take the inferred type from the schema - never cast. The network is untyped; a cast is a lie with a delay.
- `catch (e)` binds `unknown` (with `useUnknownInCatchVariables`, which `strict` turns on). Narrow before you touch it - `if (e instanceof SomeError)` - rather than assuming a `.message`.
- No `@ts-ignore`. Use `@ts-expect-error` with a reason on the same line, so the day the underlying problem is fixed the directive itself errors as unused and you delete it. `@ts-ignore` rots silently; `@ts-expect-error` is self-cleaning.
- No non-null assertion (`x!`) without a comment stating why null is impossible there. The honest alternatives are an early return or a narrowing check; the assertion is a promise to the compiler that nothing enforces.
- A user-defined guard returns `value is T`, not `boolean` - the predicate form is what teaches the compiler. Give narrowing logic a name and reuse the guard rather than re-checking inline.

The array-of-nullables filter is the case that bites - a guard predicate, never `.filter(Boolean)`; `references/type-modeling.md` works it through.

## Model the data with types

A precise type is documentation the compiler enforces - make illegal states unrepresentable. Read `references/type-modeling.md` before modeling a new shape; each rule here is one line:

- **Discriminated unions** over a bag of optionals, with a `never`-typed `default` so a new variant forces every consumer.
- **Utility types** (`Pick`, `Omit`, `Partial`, `Readonly`, `ReturnType`, `Awaited`...) instead of re-typing a shape.
- **String-literal unions** over `enum` for any closed set that crosses a runtime boundary.
- **`interface`** for shapes that are implemented or extended, **`type`** for unions, intersections, tuples, mapped and conditional types.
- **Absence on purpose** - one of `undefined` / `null` throughout; correlated nullable fields all-or-nothing.
- **`satisfies`** for config objects and lookup tables; **`readonly`** by default.
- **Brand primitives** that share a representation but not a meaning (`UserId` vs `PostId`), built only through one validating guard.

Library-grade type work (conditional types with `infer`, mapped and template-literal types) only behind a published API surface; type-level cleverness is a cost.

## Type-layer imports

- `import type { ... }` for type-only imports. It erases at build, can't pull a value at runtime, and won't create an import cycle through types alone (`verbatimModuleSyntax` makes the distinction explicit and enforced).
- An upstream package's incomplete types are fixed by module augmentation (`declare module 'pkg'`, or `declare global` for globals) in a dedicated `*.d.ts` - never a cast to `any`.

## TypeScript version state

TS 7 (the Go-native rewrite) moves fast - verify its current state via the documentation server before adopting, and read `references/type-modeling.md`'s version section for where to adopt it first.

## Plain JavaScript is checked JavaScript

You don't lose the type checker by writing `.js`. The same language server checks it - turn it on:

- `// @ts-check` at the top of a single file, or `checkJs: true` with `allowJs: true` in `jsconfig.json` / `tsconfig.json` for a whole tree. Treat the diagnostics it produces as real errors.
- Describe types in JSDoc - `@param`, `@returns`, `@type`, `@typedef`. The language server reads JSDoc for inference and diagnostics, so JS gets most of TypeScript's safety with no build step at all.
- When a JS file fills up with `@typedef` and JSDoc generics, that's the signal it wants to be `.ts`. Convert it.

## Tooling

- ESLint with typescript-eslint and its type-aware rules, plus Prettier. Both run pre-commit and in CI. Prettier owns formatting - don't hand-format and don't add stylistic ESLint rules that fight it; let the lint surface real problems, not whitespace. The concrete config to copy - the flat `eslint.config.mjs`, the `@tsconfig/strictest` base, the `.prettierrc` and `.editorconfig` - is in `references/typescript-style.md`.
- Type-check in CI as its own step (`tsc --noEmit`), separate from bundling. A bundler can transpile past a type error; an explicit `tsc` pass cannot, so a green build genuinely means a type-clean build.
- Public API surfaces carry JSDoc - `@param`, `@returns`, `@throws`. It documents intent and feeds editor tooling for both TS and JS consumers.
- Class-member style (modifiers, `#private` vs `private`, parameter properties, member order) is `references/typescript-style.md`'s ground.
