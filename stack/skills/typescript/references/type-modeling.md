# Modeling data with types, the nullable filter, and the TS 7 state

Read before modeling a new shape, when a filter over nullables types wrongly, and before adopting TypeScript 7.

**Contents:** [Model the data with types](#model-the-data-with-types), [The nullable filter](#the-nullable-filter), [TypeScript version state](#typescript-version-state)

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

## The nullable filter

A worked case that bites people: removing nulls from an array. `list.filter((x) => x != null)` keeps the right values but the result is still typed `(T | null)[]` - the compiler doesn't know the predicate narrowed anything. Write the predicate as a guard: `list.filter((x): x is T => x != null)` yields `T[]`. And `.filter(Boolean)` is not the same thing - it also drops `0`, `''`, `false`, and `NaN`, so reach for it only when you really mean every falsy value. State the predicate by what it keeps; an inverted `=> !x` reads as removal but keeps exactly the wrong elements.

## TypeScript version state

TS 7 (the Go-native rewrite) is rolling out: same type system and syntax, roughly 10x faster type-checking - but its stability state moves fast, so verify the CURRENT release status and your toolchain's support (editor LSP, programmatic API) via the documentation server at adoption time rather than trusting recall. Adopt it first where risk is lowest and the win immediate: `tsc --noEmit` in CI. Hold on TS 6 if you depend on the programmatic compiler API (ts-morph, custom transformers, some framework template type-checkers) until the stable 7.x API ships. Transpilation stays on esbuild/SWC/Vite regardless - they strip types without checking; only `tsc --noEmit` is type safety.
