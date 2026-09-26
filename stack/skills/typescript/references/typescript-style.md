# TypeScript code style and conventions

The authoritative TypeScript/JavaScript *tooling and style* reference: the concrete tsconfig, ESLint, Prettier, and .editorconfig setup plus the rule-by-rule conventions they enforce. `SKILL.md` owns the conceptual model (why the compiler is a test, discriminated unions, branding, the two failure channels); this document owns the concrete tool config and the enforcement rules - where they overlap, this reference wins. Above both, a project's own config (its `.editorconfig`, `eslint.config.mjs`, `.prettierrc`, `tsconfig.json`) and its `<docs-path>/code-style/CODE-STYLE.md` are HIGHER priority: where a project diverges from these general conventions, follow the project.

## Contents

- TL;DR
- Baseline tooling
- tsconfig.json compiler options
- Naming conventions
- File and folder naming
- Types vs interfaces
- any vs unknown
- Type inference vs explicit annotations
- readonly and immutability
- Array and type syntax (stylistic defaults)
- null / undefined handling
- Functions
- Classes
- Imports / exports
- Error handling
- async / await
- General best practices
- Prettier config (`.prettierrc`)
- .editorconfig
- Good vs bad examples
- Recommendations (staged)
- Caveats

## TL;DR
- Baseline: typescript-eslint `strict` + `stylistic` (or their `-type-checked` variants with typed linting), TypeScript `strict: true`, plus Prettier for formatting.
- The tooling defaults are the standard: interfaces preferred (consistent-type-definitions = 'interface'), `T[]` array syntax (array-type = 'array'), no `any` (prefer `unknown`), no non-null assertions, camelCase/PascalCase/UPPER_CASE naming.
- Enforce with tsconfig strict flags, an ESLint flat config, Prettier, and .editorconfig; let inference do the work and annotate boundaries explicitly.

## Baseline tooling
Use the typescript-eslint shared configs as the community baseline. Per typescript-eslint.io, most projects should extend `recommended` or `strict` for correctness, plus `stylistic` for consistency. If you have typed linting enabled (recommended for real projects), use the type-checked variants.

Flat config (`eslint.config.mjs`):
```js
// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['**/*.{js,ts}'],
  extends: [
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
});
```

Stability note: typescript-eslint's Shared Configs docs state that 'with the exception of all, strict, and strict-type-checked, all configurations are considered stable', and that strict 'is not considered stable under Semantic Versioning (semver). Its enabled rules and/or their options may change outside of major version updates.' `stylistic` and `recommended` are stable. `projectService` is the stable typed-linting API (promoted in v8); confirm the current major via the documentation server at setup time and pin your version regardless.

## tsconfig.json compiler options
Start from `strict: true`, which turns on the whole strict family: noImplicitAny, strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitThis, useUnknownInCatchVariables, alwaysStrict.

For maximum safety, the community-maintained `@tsconfig/strictest` base is the reference (npm `@tsconfig/strictest`, MIT, maintained under the tsconfig/bases project). Its exact `compilerOptions`:
```json
{
  "compilerOptions": {
    "strict": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```
`@tsconfig/strictest` is strictness-only; it deliberately does not set `target`/`module`/`lib`. Compose it with an environment base such as `@tsconfig/node20`. Note `forceConsistentCasingInFileNames` is TypeScript's default since 5.0, so it is not listed; `noImplicitAny` is on implicitly via `strict`.

The two highest-friction, highest-value flags: `noUncheckedIndexedAccess` (array/record access returns `T | undefined`) and `exactOptionalPropertyTypes` (an optional `foo?: T` cannot be set to `undefined` unless the type says so). Enable both on new projects; adopt incrementally on existing ones.

## Naming conventions
- Variables, functions, parameters, methods, properties: `camelCase`.
- Classes, interfaces, type aliases, enums, type parameters, decorators: `PascalCase`.
- Module-level true constants: `UPPER_CASE` acceptable; `camelCase` also fine - be consistent.
- Enum members: `UPPER_CASE` or `PascalCase` - pick one.
- Booleans: prefix with `is`, `has`, `should`, `can` (`isActive`, `hasChildren`).
- Generics: `PascalCase`, single uppercase letter (`T`, `K`, `V`, `U`) or descriptive `TKey`/`TValue` in complex signatures.
- Do NOT prefix interfaces with `I` (`IUser`). This is a legacy .NET-era habit the modern TS community has abandoned; the TS handbook and Google TS style guide both discourage it. Flag it as legacy if you see it.
- Do not use leading underscores for private members; use the `private` keyword or `#private` fields.

Enforce with the `@typescript-eslint/naming-convention` rule (feature-frozen but still maintained and bug-fixed):
```js
'@typescript-eslint/naming-convention': [
  'error',
  { selector: 'default', format: ['camelCase'] },
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
  { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'enumMember', format: ['UPPER_CASE'] },
]
```

## File and folder naming
- `kebab-case` file names are the dominant standard (and Angular's official choice). Some ecosystems use `PascalCase.ts` for a file containing a single class/component - acceptable if consistent.
- One primary concept per file; name the file after that concept.
- Avoid dumping-ground names like `utils.ts`, `helpers.ts`, `common.ts`.
- Tests: `*.spec.ts` or `*.test.ts`.

## Types vs interfaces
- Default to `interface` for object shapes. typescript-eslint's consistent-type-definitions rule defaults to 'interface', and the TS team's own guidance is that interfaces are the prevailing style, give better error messages, and are slightly faster for the compiler (cached `extends` relationships).
- Use `type` for unions, tuples, mapped types, conditional types, function types, and primitive aliases - things interfaces cannot express.
- Use `interface` when you want declaration merging or `extends`-style inheritance.
- Minority position: Matt Pocock (Total TypeScript) recommends the opposite - 'I would recommend you use type by default. It is a little more flexible and a little less surprising.' This is a legitimate stance, but the majority and the tooling default is `interface`. Pick one per codebase and enforce it.

## any vs unknown
- Ban `any`. The `strict` config sets no-explicit-any to 'error' (in `recommended` it is only 'warn').
- Use `unknown` for values of genuinely unknown type, then narrow with type guards.
- The strict-type-checked config catches unsafe `any` flows via no-unsafe-assignment, no-unsafe-call, no-unsafe-member-access, and no-unsafe-return.

## Type inference vs explicit annotations
- Let inference handle local variables and simple initializers - do not write `const count: number = 0`. The stylistic no-inferrable-types rule flags redundant annotations.
- Always annotate function parameters (they cannot be inferred).
- Annotate return types on exported/module-boundary functions. The explicit-module-boundary-types rule enforces this; it documents public APIs and prevents accidental return-type drift.

## readonly and immutability
- Mark never-reassigned properties `readonly`.
- Use `readonly T[]` / `ReadonlyArray<T>` for arrays you do not mutate.
- Use `as const` for literal constants and tuples.
- Know the core utility types: `Readonly<T>`, `Partial<T>`, `Required<T>`, `Pick<T,K>`, `Omit<T,K>`, `Record<K,V>`, `ReturnType<T>`, `Parameters<T>`, `Awaited<T>`. Compose these rather than hand-rolling.

## Array and type syntax (stylistic defaults)
- The array-type rule defaults to 'array' -> prefer `T[]` over `Array<T>`. Use `Array<T>` only for complex element types where brackets hurt readability.
- The consistent-indexed-object-style rule -> prefer `Record<K,V>` over index signatures where possible.
- consistent-type-imports is NOT in any preset - add it manually to enforce `import type { Foo }` for type-only imports (helps bundlers strip types).

## null / undefined handling
- Prefer `undefined` for 'absent' in TS code; reserve `null` for external APIs/JSON that use it.
- With `strictNullChecks`, model optionality explicitly (`foo?: string` or `string | undefined`).
- Use optional chaining `?.` and nullish coalescing `??` (not `||`, which trips on `0`/`''`). The prefer-optional-chain and prefer-nullish-coalescing rules live in stylistic-type-checked.
- Avoid non-null assertions (`!`). `strict` sets no-non-null-assertion to 'error'. If you must assert, comment why.

## Functions
- Use `function` declarations for top-level named functions (hoisting, cleaner stack traces); arrow functions for callbacks, closures, and class fields where lexical `this` matters.
- Keep parameter lists short; switch to an options object at ~3+ params.
- Prefer default params over in-body defaulting; keep required params before optional (the default-param-last rule).

## Classes
- Use access modifiers deliberately: `public` is implicit (do not write it), plus `protected` and `private`. Prefer `#private` fields for true runtime privacy.
- Use `readonly` for injected/constructor-set fields that do not change.
- Member ordering: enforce with the `@typescript-eslint/member-ordering` rule - static fields, instance fields, constructor, then methods; public before protected before private within each group.
- Use the `override` keyword (`noImplicitOverride` enforces it).
- Prefer parameter properties (`constructor(private readonly svc: Svc)`) for concise DI.

## Imports / exports
- Prefer named exports over default exports (better refactoring, consistent names, better tree-shaking).
- Barrel files (`index.ts` re-exports): use with caution. They provide clean imports and module boundaries but hurt build/lint/test performance, can cause circular deps, and can break tree-shaking. Modern consensus: avoid deep barrels in app code; they are more defensible at package boundaries. The eslint-plugin-barrel-files plugin (or built-in Biome/oxlint rules) can flag them.
- Import ordering: enforce with eslint-plugin-import's import/order (groups: builtin, external, internal, parent, sibling, index) plus alphabetize, or use eslint-plugin-simple-import-sort for a simpler opinionated sort.
- Use `import type` for type-only imports.

## Error handling
- With `useUnknownInCatchVariables` (part of `strict`), catch clause variables are `unknown` - narrow before use.
- Throw `Error` (or subclasses), never strings/objects. The only-throw-error / no-throw-literal rules enforce this.
- Create typed domain error classes extending `Error` and set `name`.
- For expected failures, consider a Result/discriminated-union return type instead of throwing.

## async / await
- Prefer `async/await` over raw `.then()` chains.
- The no-floating-promises rule (type-checked): every promise must be awaited, returned, or explicitly `void`ed.
- The no-misused-promises rule: do not pass async functions where void callbacks are expected without care.
- The await-thenable rule: do not await non-promises.
- Use `Promise.all` for concurrent independent work; do not `await` in a loop when you can parallelize.

## General best practices
- Prefer `const`; use `let` only when reassigning; never `var`.
- Use strict equality `===`/`!==`.
- Use template literals over string concatenation.
- Prefer discriminated unions over optional-field grab-bags for modeling state.
- With `noUncheckedIndexedAccess` on, always handle the `undefined` from index access.

## Prettier config (`.prettierrc`)
```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```
Use eslint-config-prettier to turn off ESLint formatting rules that conflict with Prettier. Prettier owns formatting; ESLint owns correctness and logic-style.

## .editorconfig
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

## Good vs bad examples
```ts
// BAD
function getUser(id): any {
  let u = users.filter(x => x.id == id)[0]
  return u!
}

// GOOD
function getUser(id: string): User | undefined {
  return users.find((user) => user.id === id);
}
```
```ts
// BAD - any, || defaulting swallows 0
function pageSize(cfg): number {
  return cfg.size || 20;
}

// GOOD - narrowed input, ?? preserves 0
function pageSize(cfg: { size?: number }): number {
  return cfg.size ?? 20;
}
```

## Recommendations (staged)
1. New projects: adopt `strictTypeChecked` + `stylisticTypeChecked`, `strict: true` tsconfig (ideally `@tsconfig/strictest`), Prettier, and .editorconfig on day one. Add consistent-type-imports and import/order.
2. Existing projects: enable `strict` first and fix the fallout, then layer typed linting, then add `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` incrementally per directory.
3. Escalate no-explicit-any from warn to error once the team is comfortable.
- Threshold to change: if typed linting is too slow in CI, drop to non-type-checked `recommended` + `stylistic` until capacity improves, then re-enable.

## Caveats
- The `strict` / strict-type-checked rulesets can change in minor typescript-eslint releases - pin versions.
- array-type and consistent-type-definitions are the two most commonly disabled stylistic rules; decide as a team whether you want `T[]`/`interface` enforced.
- The `I`-prefix and type-by-default debates are genuine community splits, not settled facts.
