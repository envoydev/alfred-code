# Code audit - Phase 2 remediation

Read before the first edit. The guards at the end override the grade target.

Set-level defects first. An import cycle: move the shared part to the place both sides may import - the feature's own file, or `core` when two features need it - and plan every import that changes. A dependency against the layering: move the effect out of the logic file into the folder's effects file, or pass the value in. Duplicated logic: one home, the other callers importing it, with the test that covered each copy still passing. A named value in two homes: the constants home keeps it and the second definition goes, every user importing the one. `structure_map` against the tree: where the tree is right and the map is stale, plan the map's line in `.claude/kit/repo.json`; where the tree is wrong, plan the move. An export nothing imports: delete it only when the search of the repo, its `package.json` scripts, its settings and the file lists other repos copy by name finds no user - otherwise it is an open question. A `keep_js` entry that matches no file, or names an outside runtime that does not load its file: plan the entry's removal as an edit of `.claude/kit/repo.json`; the file is then `ts-convert`'s to convert at the next run.

Then, for each item still below A / 9, a bounded loop. An item already at A / 9 gets no loop edit: each deduction it keeps is scored, cited in the report and listed as not planned, with the reason 'at the target - the loop runs only below it'. The loop:

1. Snapshot the item's files, its tests and every file that names it.
2. Rank the deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes it. Examples:
   - A decision inside an entry: move it to an exported pure function in the feature's folder; the entry calls it.
   - An effect inside a logic file: move the read or the write to the folder's effects file and pass the value in.
   - A value with a meaning written inline: name it in the constants home.
   - A swallowed error: handle the case the catch was written for, and rethrow the rest with its cause.
   - A floating promise: await it, return it, or mark it `void` with the reason.
   - An `any`: `unknown` and a narrowing check or a named type guard.
   - A type-only import without the `type` keyword: add it.
   - A comment that restates the code or describes code that is gone: delete it; a missing contract on an exported function: the doc comment `code-comments` asks for.
   - A behaviour with no test: add the test where the repo keeps tests for that item, with plain values for logic and the repo's own fakes for effects.
   - A `check` file without `// @ts-check`: add it and the JSDoc types the typecheck then asks for.
4. Re-score from scratch. Do not carry the previous score forward.
5. Repeat until A / 9, `MAX_ITERATIONS`, or a pass with no material gain.

## Anti-gaming guards (hard invariants)

- Behaviour is kept. A fix that changes behaviour is planned only for a deduction that names a failure scenario, and the same plan adds or changes the test that fails without the fix; the plan's checks run it.
- A rename or a move carries every reference. The same plan edits every import, `require` call, `package.json` script, settings hook command, installer file list, file list another repo copies by name (`KIT_FILES` in the kit's `bin/sync.ts`), the `roots`, `scope_with` and `keep_js` paths in `.claude/kit/repo.json`, the tests, and the docs that run the command - found by search, and listed under `Depends on` with the search that found them.
- A name or a path used outside the repo is the user's. An exported name, a CLI flag, a hook path a deployed settings file names, a file another repo copies: an open question, never a silent edit.
- The audit never plans a conversion. A `convert` file still in JavaScript - after `no-convert`, a `FAILED` batch or 'One batch first' - goes under 'Not planned' as `ts-convert`'s, with the reason it was left, and its D6 deduction stands.
- A `check` file gets `// @ts-check` and JSDoc types only. A `leave` file and a generated file are never edited; a generated file is fixed in its generator.
- Never loosen to pass. No `any`, no non-null assertion, no `@ts-ignore`, no `@ts-expect-error` without a cited reason, no strictness key removed, no lint rule switched off, no test deleted, skipped or weakened.
- A rewrite has a size limit. A finding whose fix rewrites more than half of an item's lines, or splits one file into a feature folder, is planned as `new-file` edits plus the old file's `delete-file` when the item's batch stays under 250,000 characters with them; otherwise it is listed under 'Not planned' as a task for `solve-task`, with its finding and the target shape.
- The other audit's findings are the other audit's. A hook's event, matcher, exit contract, timeout, safety or fit is named under 'Not planned' as the hooks audit's.
- Honest scoring. An item that cannot reach A without breaking a guard is reported at its real grade with the blocker.
