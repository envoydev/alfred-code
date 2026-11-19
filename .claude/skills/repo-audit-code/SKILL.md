---
name: repo-audit-code
description: Use when auditing and fixing this repo's code toward grade A - structure, correctness, types, comments, tests, unconverted JS. Not for a hook's contract.
argument-hint: "[no-convert] [commit]"
disable-model-invocation: true
---

# Code audit and remediation

You are a code quality engineer for a repo of Node scripts, hooks modules and their tests. Bring the repo's own
working code to one standard and leave it in TypeScript: score every code item against an objective rubric
(structure, correctness, language and style, comments, tests, the language itself, consistency), score the SET for
what no single item shows - a cycle, a value with two homes, logic written twice - then fix what can be fixed
without changing what the code does, and report honestly what cannot.

The audit assumes nothing about which code exists: discover it from the repo's code roots, read every item end to
end with its tests, and run the repo's checks before judging. The standards are not this skill's own: each rubric
line is scored against the shared skill that owns it - `project-structure`, `javascript`, `typescript`,
`code-comments`, `ts-js-testing` - read by path, and against the repo's own map and configs, which win where they
differ on style and shape. JavaScript that can be TypeScript is converted first, by the `ts-convert` skill; this
audit never plans a conversion. It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-code` to audit the repo's code roots (the `audit.code` roots in
  `.claude/kit/repo.json`), or a root they name. `/repo-audit-code no-convert` audits the tree as it stands and
  converts nothing; `commit` after the command is the user's word for one local commit per converted batch.
- Not for prose - skills, rules, agents, the instruction file - which the other audits own.
- Not for a hook's event, matcher, exit contract, timeout, safety or fit with the house rules
  (`/repo-audit-hooks`). On a hook file this audit owns the structure, the correctness of the code paths, the
  language, the comments, the tests and the consistency; each of the two audits leaves the other's findings to it,
  named under 'Not planned'.
- Not for code that is not the repo's own working code - a sample project shown to users as it is, the probe
  scripts kept as the evidence of a recorded study, the kit's locked copies under `.claude/kit/` - which no root
  names.
- Not for writing or converting a file outside an audit: `typescript` and `ts-convert`.

## Parameters

- `CODE_ROOT`: the folders and files holding the code (default: `audit.code.roots`).
- `STANDARDS`: what the rubric scores against, read by path - `.claude/skills/<name>/SKILL.md` and the references it names, for `project-structure`, `javascript`, `typescript`, `code-comments` and `ts-js-testing` - plus the repo's own `structure_map` (in `.claude/kit/repo.json`), its `tsconfig`, lint and format configs, which win where they differ from a shared skill on style and shape. The language and the module system are the conversion's: `ts-convert` edits the `structure_map` lines that name them.
- `KEEP_JS`: the JavaScript that stays JavaScript under `// @ts-check` (default: `audit.code.keep_js`, a list of `{ "path": "<glob>", "reason": "<one line>" }`).
- `CONVERT`: `true` runs `ts-convert` before the audit; `no-convert` after the command turns it off (default: `true`).
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per item (default: `4`).
- `WRITE`: `true` takes the run to the flow's ask and applies what it picks; with `false` the conversion writes its plan and builds nothing, then the audit runs report-only on the tree as it stands, as under `no-convert` - nothing is renamed or committed (default: `true`).

## How the run goes

**Load the `repo-audit-plugin` skill before step 1 and run this audit through its flow.** Its planner seat does Phases 0
to 1b and writes Phase 2's edits as a plan, its editor seat applies them, and the planner does Phase 3. This session
coordinates and is the only one that asks the user. The seats do not ask for confirmation between phases; the stops
the flow adds are its own asks, one of them before any edit lands. Stop otherwise only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a path or an exported name used outside the
repo, a `check` file they may want converted, a blocker only they can waive - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report. Never change what the
code does, loosen a type or weaken a test to reach a grade.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.code`. No entry: report 'this repo has no code targets -
   nothing to audit' and stop. Its `roots` are `CODE_ROOT` for this run (a root the user names overrides them);
   run every `checks` command wherever this skill calls for the repo's checks, and quote its result; follow every
   `notes` line wherever this skill touches a repo-specific mechanism (the test runner and what it selects, a file
   list another repo copies by name, a runtime outside the repo that loads the code, a folder kept byte for byte,
   a generator).
2. **The conversion, before the flow's step 1.** Alone, this step is this session's; in a run of several kinds,
   `repo-audit-plugin`'s `references/all-kinds.md` says when `code`'s turn comes, and the step runs then. Name the
   run folder and create it: `docs/superpowers/audits/<date>-code/`, then `-2`, `-3` where the kind already has one
   of this date. The flow's step 1 takes this folder rather than making another. Then:
   - `CONVERT` on: load the `ts-convert` skill and run it on `CODE_ROOT`, giving it this run folder, `WRITE`, and
     the `commit` word where the command carried it. It returns at once where nothing is left to convert, and
     otherwise runs to its own end - its size line, plan, grade, approval, batches and commits are its own.
   - The audit starts only on a finished conversion - `ts-convert` reports `Finished: yes`: no batch `pending` or
     `waiting on`, a `FAILED` one counting as finished - or under `no-convert`, or with `WRITE` false. After a
     conversion that stopped earlier ('One batch first', a bounded resume, 'Stop before converting', 'Cancel'), end
     the run on the conversion's report and say
     that `/repo-audit-code` again continues it: an audit of a half-converted tree reads every unconverted item
     again at every run.
   - `no-convert`: no conversion; the size line says so.
3. **Items and batches** - this skill's own, in place of the flow's step 3. Items are what the scope script makes
   of the roots. An item is sized and read by its code files only - `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`,
   `.cts`, `.tsx` - so a folder that also holds prose or data is read for its code alone. Pack the items to audit
   into batches of at most 250,000 characters of code, in name order. An item larger than that is split by its
   files, in name order, across batches of its own; a single file larger than that is a batch alone, which its
   planner reads in parts. A split item's grade is the lowest of its parts', set by the `set` seat, which writes
   the item's one `grades.tsv` line. An item with no code file - a fixtures or data folder, a readme beside the
   scripts - or whose code files are all of the class `leave` is not read: its planner writes its `grades.tsv`
   line as `<id><TAB>A<TAB>9<TAB>yes`, and its row in `baseline.md` and `final.md` reads 'no code - not scored',
   so it is carried from then on. Tests are items like any other - under their own root or beside their subject -
   scored by their subject's rules plus `ts-js-testing`.
4. **The size line.** Under the flow's two lines add
   `Unconverted: <files> files, <characters> characters of class convert - <why>`: the files a conversion left
   `FAILED`, or, under `no-convert` or `WRITE` false, every JavaScript file under the roots that no `KEEP_JS` path
   matches and no `notes` line classes `leave` (`git ls-files -- <roots> ':(exclude,glob)<keep_js path>'...`, sized with `wc -c`). Each of them caps
   its item at B and is read again at every run.
5. **The checks, in a batched run.** With more than one batch, this session runs every `checks` command once before
   the planners start and once after the edits land - it runs the commands and reads only their output - and keeps
   the results in the run folder (`checks-before.txt`, `checks-after.txt`). Each planner's dispatch names that
   file, and a batch planner quotes it rather than running the suite itself. With one batch the planner runs them.
6. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a defect in
   every later phase (behaviour kept, one home per standard, the classes, the outside runtimes, the bar on types
   and tests).
7. **Phase 0 - discovery.** Follow `references/discovery.md`: the classes, the checks, each item read end to end
   with its tests, the set maps. Do not edit anything in this phase.
8. **Phase 1 - scoring.** Score each item on the seven dimensions in `references/rubric.md` and the set on its
   set-level defects, citing file and line for every point, and map the total through its grade bands, floors and
   caps. Produce the baseline report (the output contract below) before any editing.
9. **Phase 1b - currency.** Done inside Phase 1, not after it: follow `references/currency.md` - re-read each row
   the rubric scores with before it drives a score, and check the claims the code and its comments make. An
   unresolved DRIFTED finding blocks the item from A.
10. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first, then the bounded
    per-item loop. Its guards override the A target.
11. **Phase 3 - verification**, below.

## Phase 3 - Verification

1. Every `audit.code.checks` command green, its result quoted - the typecheck among them wherever the repo has one.
   In a batched run the result is `checks-after.txt`.
2. Every reference a move or a rename listed in `Depends on` found pointing at the new path: search the repo for
   the old path and the old name, and quote the search with its empty result.
3. Every edit that changed behaviour - planned only for a deduction that names a failure scenario - has its test in
   the same plan, and that test is quoted passing; no test was deleted, skipped or weakened (diff the test files
   against the snapshot).
4. No type was loosened: the diff of the edited files adds no `any`, no non-null assertion, no `@ts-ignore`, no
   `@ts-expect-error` without a cited reason, and no `tsconfig` lost a strictness key.
5. The edited items re-scored by the same evidence-cited method as Phase 1; the Phase 1b rows a remediation relied
   on re-read.
6. A moved or renamed item is recorded under its new id and the old id is dropped - `record` does both - and the
   report names each rename. An edit to a file that is also a hook makes the next `hooks` audit read that hook
   again; the report says which.

If an edit changed what the code does without a planned test, broke a reference, or regressed a check, restore it
from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every item is at A / 9, the set-level map is clean, and verification passed, or
- Every remaining sub-A item has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing - a `convert`
  file still in JavaScript and a reason (c) file among them.

Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Summary table: one row per item with `item`, `class` (the classes of its files: `convert`, `check (a|b|c)`, `leave`, `ts`), `code characters`, `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`, `already A`, `blocked: <reason>`, `capped at B: <file> unconverted`, `no code - not scored`).
2. Per item, a short block: baseline score by dimension with the top 2-3 cited deductions (file and line, and for D2 the failure scenario); what changed, as a terse list of edits; final score by dimension; any blocker and the guard that holds it.
3. The set maps: the import cycles, the dependencies against the layering, the named values with two homes, the duplicated logic, the exports nothing imports, the module system per package, the tree against `structure_map`, the `keep_js` entries against the files - each with its resolution or why it stands.
4. The `audit.code.checks` commands, each with its result line, before and after the edits.
5. The conversion's summary, from `ts-convert`'s report: converted, checked, left and failed, each with its reason, and the entries it listed as 'entry not covered'.
6. The Phase 1b currency table with this run's verdicts.
7. If `WRITE` is true, the files edited, moved, created or deleted, each rename with its old and new id, the hook files a `hooks` audit will read again, and the snapshot location for rollback.

The scorecard counts only items with code: the 'no code' items are listed beside it with their number, never in
'At grade A' or the mean. A carried item is told as 'no code' by its row in the `final.md` of the run folder its
`carried` line names, which this session reads for that row alone.

Keep the report dense. No preamble, no restating this skill back, no filler.
