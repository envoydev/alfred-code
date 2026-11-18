# Code audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit.

Code and its comments carry claims about the outside world - a runtime's version floor, what an API returns, a
compiler option - and this audit's own rubric scores against facts of the same kind. Training-data recall drifts,
so these claims are verified against current documentation - Node's and TypeScript's own pages for the runtime and
the compiler, the documentation MCP for a library - never re-asserted from memory. This check changes no dimension
weights (scores stay comparable across audit runs); an unresolved DRIFTED finding blocks the item from A.

1. **Inventory** while scoring Phase 1: collect every externally-verifiable claim in the code and its comments - a
   version floor, an API call's documented behaviour, a flag or config key, a 'X does not support Y' statement, a
   link to a page.
2. **The facts this audit leans on** are external claims too, re-read from the live pages each run before a row
   drives a score. As read on 2026-11-18:

   | Row | Fact | Source |
   |---|---|---|
   | erasable syntax | Node runs TypeScript by removing types and errors (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) on syntax that needs code generated: `enum` declarations, a `namespace` with runtime code, parameter properties, import aliases. `erasableSyntaxOnly` makes the compiler report the same set, and `import =` / `export =` assignments and `<prefix>`-style assertions with it | <https://nodejs.org/api/typescript.html> 'TypeScript features'; <https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly> |
   | type-only imports | 'the `type` keyword is necessary to correctly strip type imports'; without it Node treats the import as a value import, 'which will result in a runtime error'. `verbatimModuleSyntax` makes the compiler hold the code to it | <https://nodejs.org/api/typescript.html> 'Importing types without `type` keyword'; <https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax> |
   | import extensions | 'file extensions are mandatory in `import` statements and `import()` expressions', and in a `require()` of a TypeScript file. A package under `moduleResolution: bundler`, which 'never requires file extensions on relative paths in imports', follows its own map instead | <https://nodejs.org/api/typescript.html> 'Determining module system'; the `bundler` quote: <https://www.typescriptlang.org/tsconfig/#moduleResolution> |
   | strict family | `strict` is 'equivalent to enabling all of the strict mode family options': `alwaysStrict`, `strictNullChecks`, `strictBindCallApply`, `strictBuiltinIteratorReturn`, `strictFunctionTypes`, `strictPropertyInitialization`, `noImplicitAny`, `noImplicitThis`, `useUnknownInCatchVariables` | <https://www.typescriptlang.org/tsconfig/#strict> |
   | stricter flags | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns` and `noFallthroughCasesInSwitch` are options of the reference, none of them part of `strict` | <https://www.typescriptlang.org/tsconfig/> |
   | checked JavaScript | `checkJs` 'is the equivalent of including `// @ts-check` at the top of all JavaScript files which are included in your project'; `allowJs` lets JavaScript files into the program; types come from JSDoc | <https://www.typescriptlang.org/tsconfig/#checkJs>; <https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html> |

   The conversion's own facts - type stripping's versions, `require()` of an ES module, `import.meta.main` - are
   not rows here: they live in the `ts-convert` skill's `references/currency.md`, because this file is hashed as a
   scoring file and a correction to it audits every `code` item again.
3. **Prioritize** what a release can invalidate: version-named claims, API behaviour stated in a comment, support
   statements. House judgment (naming, where a file goes, what a comment carries) has no external truth to check -
   skip it.
4. **Verify, bounded**: group the claims by runtime, compiler or library; per library, one `resolve-library-id`
   plus at most 2-3 `query-docs` calls covering the whole batch. Cap ~15 libraries per run - the long tail rolls to
   the next audit and is listed as unchecked, and a run starts with the unchecked list of the last audit's report,
   where one is on disk, so a claim is not left unchecked run after run. The documentation server unreachable, or
   not among this seat's tools: fetch the official page itself - its `.md` form where the site serves one, as
   Node's does (`https://nodejs.org/api/<page>.md`) - and quote the line found, saying in the report that the
   lookup went to the page. The page route is bounded too: one fetch per page where it comes back whole, kept as a
   file in the run folder that answers every later claim on it; a page longer than one fetch returns is read on by
   offset until the claim's section is reached; and a DRIFTED verdict rests on the passage fetched word for word,
   since a fetch that answers through a summary can paraphrase. Where only a summary can be had, the claim is
   listed as unchecked - never CURRENT or UNVERIFIABLE - with what the summary said beside it, and it is in the
   unchecked list the next audit starts with. A claim whose summary reports a contradiction blocks its item from A,
   as a DRIFTED one does, until the passage is read word for word - then it takes the verdict the passage gives; a
   summary that reports agreement leaves the claim unchecked, never CURRENT. Mark the check SKIPPED in the report
   only when neither can be reached, and move on; never substitute recall for the lookup.
5. **Verdict per claim**: CURRENT (docs agree) | DRIFTED (docs contradict - a MATERIAL finding) | UNVERIFIABLE
   (docs silent - recorded, not a finding). Record the table (source, claim, verdict, evidence line) in the
   baseline report. A sentence in quotation marks that a file attributes to a page is a row of its own - a line
   that quotes two pages is two rows - and under the table goes the list of pages read: a page a target names that
   is not in that list is an unchecked claim and is listed as one.
6. **Remediation routing** for DRIFTED: a drifted claim in the code or a comment is fixed in Phase 2 - and when the
   drifted content is version-coupled detail (a version number in a comment, a copied flag list), prefer REPLACING
   it with the durable statement plus where the fact is read (the runtime's own page, `--help`) over updating the
   number: judgment stays in the artifact, drifting facts are fetched live. A drifted row of the table above is
   corrected at this file's source in claude-kit (`shared/skills/`) and never in a synced `.claude/` copy, which
   the next sync overwrites: where the run is in that repo, the planner writes the corrected row out whole under
   the report's currency table, headed 'Currency hand-off', and the flow's self-review lands it; anywhere else the
   same paragraph is the hand-off to the kit.
