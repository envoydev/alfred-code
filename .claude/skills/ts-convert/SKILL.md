---
name: ts-convert
description: "Use when converting JavaScript to TypeScript - 'convert this repo to TypeScript', 'migrate these JS files', CJS to ESM. Not for a new .ts file: typescript."
argument-hint: "[path ...] [commit]"
---

# TypeScript conversion - batch by batch, each batch proved by the typecheck and the tests

Converts a repo's JavaScript to TypeScript without changing what it does. Every `.js`, `.mjs`, `.cjs` and `.jsx`
file under the targets ends as TypeScript, as checked JavaScript with its reason, or untouched with its reason. A
converted file is an ES module of erasable syntax that Node runs by stripping its types, so in a CommonJS package
the conversion is also a migration to ES modules. One seat plans the whole conversion; then one seat at a time
converts one batch, and a batch lands only when the whole-repo typecheck and its tests pass.

## When to use

- The user asks to convert or migrate existing JavaScript to TypeScript - a repo, a folder, named files - or
  `/repo-audit-code` runs it as its first step, on that audit's roots and in that audit's run folder.
- Targets: the paths the user names; else the `roots` of `audit.code` in `.claude/kit/repo.json`; with neither,
  ask for the paths.
- Words after the command: paths, and `commit` - the user's word for one local commit per green batch.
- Not for writing a new `.ts` file or typing new code, which is `typescript`'s. Not for a fix beyond what the
  conversion needs: a defect met on the way is reported, and `/repo-audit-code` or `solve-task` takes it.

## The seats

- **This session coordinates.** It reads no code file beyond the first five lines of a `keep_js` file,
  for its `// @ts-check` line (step 2). It lists files, starts the seats, runs the checks' commands
  and reads only their output, asks the user, commits, and prints the result.
- **The planner** is a general-purpose agent on the `plan_model`, dispatched with `references/plan-brief.md`, the
  targets and the run folder. It builds the inventory, the import graph, the batches and `convert.md`. A revision
  after the grade, a re-plan and the search for a batch at fault go back to that seat.
- **The converter** is a general-purpose agent on the `implement_model`, dispatched with
  `references/converter-brief.md`, one batch of `convert.md` and `references/conversion-rules.md`. One at a time:
  each batch's check is the whole-repo typecheck, and later batches import earlier ones.
- Each seat's model is passed as its dispatch's `model`, taken from the request's `kit status` line or from
  `node .claude/kit/settings.mjs`. Where no dispatch is available, or a seat fails twice to start, do that seat's
  work here in a separate step, mark it `INLINE` in the report and say the split did not hold for it.

## The classes

Every `.js`, `.mjs`, `.cjs` and `.jsx` file under the targets takes one class - the first that holds:

1. **`leave`** - generated, vendored, a test fixture its test reads as data (in whatever language), or a file the
   repo's own `notes` or `structure_map` say must stay byte for byte as it is. Untouched, its reason in the plan.
   The test is the repo's own written word, not that the file is shipped.
2. **`check`** - listed in `keep_js`, or holding one of three reasons, each written into its `keep_js` entry:
   - **(a) outside runtime** - a runtime outside the repo loads it, with no byte-for-byte rule: it is copied into
     users' projects, run by users (an installer, or a script a shipped command runs), or copied into another repo
     by name. Found by a scan, never by memory: every token that ends in `.js`, `.mjs` or `.cjs` and is a tracked
     path under the targets (`scripts/<path>.js`, say), whatever precedes it, in every shipped file - the folders
     the repo's `notes` and instruction file name as shipped - names an (a) file. A token on a comment line of a code
     file still names one, its `keep_js` reason 'named only in a comment in <file> - the user may prune'.
   - **(b) closure** - it is in the closure of an (a) file, followed to its end: what it requires or imports, and
     a path it loads, runs or reads by name (a `path.join(...)` segment list, a command string, a path read as
     text) - a path it only compares or prints is a reference to update. The outside runtime loads those too.
   - **(c) construct** - it holds a CommonJS construct with no ES module form that keeps its behaviour
     (`references/conversion-rules.md` says which). Its closure does not follow: it runs on the repo's own runtime,
     so it may require a converted file.

   A `check` file stays JavaScript and gains `// @ts-check` and JSDoc types in the batch that types it, and the
   plan adds any such file missing from `keep_js` to the entry, with its reason. An (a) or (b) file never requires
   or imports a relative or absolute path - one starting `.` or `/` - that does not end in `.js`, `.cjs`, `.mjs`
   or `.json`, and no string literal in it names a `.ts`, `.mts` or `.cts` path; a built-in or a package name
   passes. Converting a `check` file is an open question, recommended
   'keep as checked JS'; the user's answer to convert moves it to `convert`, and its runtime change - a Node
   floor, a renamed file a deployed setting names - into the plan.
3. **`convert`** - everything else: loaded only by the repo's own runtime, or by a tool that reads TypeScript.

## The module format

A converted file is an ES module with erasable syntax only. In a package whose `type` is `module` it takes `.ts`;
in any other package it takes `.mts`, so the package's remaining CommonJS files load as before and a CommonJS
caller reaches it through `require()` of an ES module. Never `.cts`: under type stripping a `.cts` file keeps plain
`require()`, whose result the compiler types as `any`, and `import x = require()` is not erasable - so a typed
CommonJS file is not on offer, and converting a CommonJS package is a migration to ES modules. That is one rule
and no per-package question; its size is on the size line. The facts under it are dated in
`references/currency.md`, and how each CommonJS construct moves is `references/conversion-rules.md`.

## The run

After a compaction, Read `convert-run.md` and `progress.md` in the run folder before the next dispatch or ask.
With `auto-run` on, an ask below takes its `(Recommended)` option and is ledgered in `convert-run.md` as a ruling;
the approval of the plan follows the `plan-approval` rule whatever auto-run says.

1. **Settings and targets.** Take the request's `kit status` line, or run `node .claude/kit/settings.mjs`. Resolve
   the targets, and read `keep_js`, `checks` and `notes` from `audit.code` where the repo has the entry.
2. **Anything to do.** List the JavaScript: `git ls-files -- <targets>`, the `.js`, `.mjs`, `.cjs` and `.jsx`
   files. A file is settled when the newest finished `convert.md` on disk - under `docs/superpowers/audits/` or
   `docs/superpowers/convert/`, every batch of its `progress.md` done - lists it as `leave`, or when a `keep_js`
   path matches it and its first five lines hold `// @ts-check`. Every file settled: print
   `Nothing to convert: <n> JavaScript files - <k> left as they are, <m> checked`, `Finished: yes`, and return.
   Otherwise, unless `WRITE` is false, before any seat starts `git status --porcelain -- <targets>
   <instruction file> .claude/kit/repo.json package.json <lockfile> 'tsconfig*.json'` must print nothing, or the
   run stops before the planner, naming the paths to commit or stash.
3. **The run folder, or a resume.** Where a run folder's `progress.md` has batches not done, this run resumes it
   ('Resume' below). Otherwise take the folder the audit named, or make
   `docs/superpowers/convert/<date>/` (`-2`, `-3` where the date has one), and start `convert-run.md` there: the
   targets, the way in, `WRITE` - true unless the audit passes false - the commit word, each seat's model with its
   source, the pass score and whether the plan is graded, and one `Next:` line rewritten at every step.
4. **Plan.** Dispatch the planner with: `references/plan-brief.md` by path, the repository root, the targets, the
   run folder, the `keep_js`, `checks` and `notes` of the entry, and mode `plan`. It writes `convert.md` and
   `progress.md` and returns the size numbers and the open questions. Write its id into `convert-run.md`. A plan
   with no batch and no toolchain edit - every file `leave` or already `check` - has no `pending` line: skip steps
   5 to 9 and close on `Nothing to convert: <n> JavaScript files - <k> left as they are, <m> checked`,
   `Finished: yes`.
5. **Open questions.** What the planner returned as the user's to decide - a `check` file that could be
   converted, a `.jsx` file nothing builds, a path used outside the repo - goes to the user in one AskUserQuestion
   call, at most four questions, the recommended option first. An answer that differs from the recommended option
   goes back to the planner with SendMessage; the others are written to `convert-run.md`.
6. **Grade and approval.** With `WRITE` false, stop here: print the plan's path and its summary, build nothing.
   Otherwise, where scoring is on, load `refining-plans` and grade `convert.md` to the pass score - the task is the
   user's request and this skill's classes and module format; a revision is the planner's. Then the plan is
   approved as the `plan-approval` rule says: by the run with `auto_approve` on, else by the user, who is notified.
   The approval line goes into `convert-run.md` - `Approved: convert.md <Baseline> - <by whom> - <score path>` -
   and a resume skips the plan and the grade only where that line is there.
7. **Size before spend.** No converter starts before the user has seen:
   `Size: convert - <files> files, <characters> characters, <batches> batches`,
   `Whole suite: <tests> tests, <seconds> s a run, <runs> runs planned` and
   `Models: plan <model>, implement <model>, review <model>`. One batch: go on. More than one: stop and ask.

   ```ask
   This conversion moves <files> files, <characters> characters, in <N> batches: <N> converter seats on <model>, one at a time. Start?
   - 'All <N> batches (Recommended)' - every batch runs in this command
   - 'One batch first' - the toolchain and batch 1 now; decide on the rest from its report
   - 'Pick files' - name the files to convert; the batches are rebuilt from them
   - 'Cancel' - nothing is built; the plan stays in the run folder
   ```

   Above three batches the mark moves: 'One batch first (Recommended)' is listed first and 'All <N> batches'
   second. After 'Pick files' the planner rebuilds the batches from the files named, their tests and the members
   of their cycles; a rebuilt plan that only drops files is not graded again, and one that changes an edit is.
8. **The commit word.** Each green batch is one local commit, and the word for it is the user's: `commit` after
   the command, or the audit's `commit`. With neither, ask once before the first batch:

   ```ask
   Each converted batch is committed locally, so a failed batch can be put back to the last green one. Commit each batch?
   - 'Commit each batch locally (Recommended)' - one commit per green batch, never a push
   - 'Stop before converting' - nothing is built; the plan stays in the run folder
   ```

   No uncommitted mode is offered: a batch's restore and the next batch's start both rest on `HEAD` being the last
   green batch.
9. **Build.**
   - **Clean tree first.** `git status --porcelain -- <the targets and every path convert.md lists>` must print
     nothing, or the run stops before anything is written, naming the paths to commit or stash. So `HEAD` is always
     the last green batch, and a restore to it loses no one's work.
   - **Batch 0, the toolchain.** Dispatch a converter with the brief's toolchain section and the plan's 'Toolchain'.
     On its `GREEN`, run the typecheck command and the whole suite yourself, write the suite's count and seconds
     into `progress.md` as the baseline, and commit the toolchain alone: `build(<scope>): TypeScript toolchain`. A
     red typecheck or a red suite goes back to the planner; no batch starts on it. A plan with no toolchain edit
     starts no seat here and still records the baseline.
   - **Each batch, in order, one seat at a time.** Dispatch a converter with the brief, the batch's section of
     `convert.md`, the conversion rules and the paths that name the batch's files. On `GREEN`: run the typecheck
     command and the batch's test command yourself, compare the counts with the seat's, then commit by pathspec -
     `git add` the new and edited paths (an old path `git mv` moved is already staged, and `git add` of it fails),
     then `git commit -- <the pathspec of the batch's Commit: line>` - as
     `refactor(<scope>): <batch> is TypeScript`, or `refactor(<scope>): <batch> is type-checked JavaScript` for a
     `check` batch, with no trace of the agent - and mark the batch `done <commit>` in `progress.md`.
   - **A `FAILED` batch.** The seat restores it. Confirm that `git status --porcelain` over the batch's old and
     new paths prints nothing - where it does not, run the restore of 'Rollback' yourself - then mark it
     `FAILED: <the first error line>` and every batch whose `Needs:` line names it, directly or through another
     such batch, `waiting on <n>`. The others go on.
   - **The whole suite** runs after the commit of every batch that edits a glob and after the last batch. Fewer
     tests run than the baseline, or a red run, does not restore the batch that ran it: it goes to the planner in
     mode `fault`, which runs the failing tests at each batch commit since the last green whole-suite run and names
     the batch at fault. Revert that batch and every committed batch that needs it, newest first, one `git revert`
     each; a revert that does not apply is aborted (`git revert --abort`) and the run stops, naming it. The named
     batch is planned again and marked `pending (at fault once)`, every batch reverted with it `pending`. A batch
     named at fault while its line says so is `FAILED: at fault twice` and left for the user, and the batches that
     need it wait.
   - **The `check` class** is typed in batches of its own, after the `convert` batches, by the same seats and
     checks.
10. **Close.** Print the summary, then what is owed, then one line per seat with the model it ran on and the run
    folder. Never push.

    ```text
    Conversion: <repo> - <done> of <N> batches
    Converted:  <n> files, now TypeScript
    Checked:    <n> files, type-checked JavaScript - each in keep_js with its reason
    Left:       <n> files as they are - each with its reason
    Failed:     <batch> - <first error line>; waiting on it: <batches>
    Entries not covered: <paths converted with no test of their own>
    Whole suite: <tests> tests before -> <tests> after
    Finished:   yes | no - <batches> batches remain
    ```

    `Finished: yes` only when no batch of `progress.md` is `pending` or `waiting on`; a `FAILED` batch counts as
    finished, and so does a batch waiting on one `FAILED: at fault twice`, which is the user's. A batch `FAILED`
    at two runs running - its line was `FAILED` when this run began - is named on the `Failed:` line with how to
    stop it: a `keep_js` entry for its files, with the reason. Owed, where they apply: `npm run sync` in
    claude-kit, which refills the `project-structure` rule's `paths` after `structure_paths` changed - that rule
    is a kit copy and is never edited in place - and after a `check` batch edits a file other repos copy
    (`bin/*.mjs`); the CI legs of other operating systems, not verified here and owed before a push; each
    reason (c) file as a task for `solve-task`; and, with batches left, that `/repo-audit-code` or this skill again
    continues them.

## Resume

A later run - `/repo-audit-code` again, or this skill alone - finds the newest run folder under
`docs/superpowers/audits/` or `docs/superpowers/convert/` whose `progress.md` has a batch a run can take - not
`done`, and neither `FAILED: at fault twice` nor waiting on one - and writes the resumed run's `convert-run.md`
and `progress.md` there - a fresh audit run folder holds the audit's files only. A `FAILED` batch is not done: a
resume tries it again - except one `FAILED: at fault twice`, which is the user's. It checks two things
without reading code:

- `git diff --name-only <base> -- <the files of every batch not done>` prints nothing. The base is the newer of the
  newest done batch's commit in `progress.md` and the revision of the newest `Baseline` line of `convert.md` (a
  replan writes one); with neither, the toolchain commit; else the first Baseline revision - never an older
  Baseline once a batch is done, since a done batch edits the imports in files of later batches and those edits
  are the plan's own.
- Every JavaScript file `git ls-files -- <targets>` lists is in the plan's inventory.

Both hold and `convert-run.md` holds an `Approved:` line for the newest `Baseline` of `convert.md`: `convert.md`
continues from its first batch not done, with no new plan and no new grade. Both hold with no such line: the run
re-enters at step 5 - open questions, grade, approval - with the plan as it is. Either fails: the planner, in mode
`replan`, plans the rest again, and that plan is graded and approved again.

The resume prints the size line for the batches left and puts the same ask, with one change: once a batch of this
plan is green, 'One batch first' has done its work. The options are then 'All <N> remaining batches', 'The next 20
batches', 'Pick files' and 'Cancel', and the mark is on 'The next 20 batches' where more than 20 remain and on
'All <N> remaining batches' where 20 or fewer do - so an unattended run, which takes the mark, converts at most 20
batches per command.

## Rollback

`convert.md` gives the commands. A committed green batch is undone with `git revert` of its commit, the batches in
reverse order, the toolchain commit last. An uncommitted batch is restored:
`git restore --staged --worktree --source=HEAD -- <the batch's old and new paths and every other file it touched>`,
then the new paths git does not track are removed (`git clean -f -- <those paths>`).

## Safety

- Every path is the repo's own. A seat writes nothing outside its batch's files, the paths the plan lists for that
  batch and its own report; this session writes `progress.md` and `convert-run.md`.
- The only network use is the toolchain's one install from the npm registry, in a repo that takes dependencies.
- Nothing the run writes into a tracked file carries an absolute local path or a token.
- `engines` is never changed: it states what users' runtimes need, and by the classes no user loads a `convert`
  file. A maintainer floor above it goes into the repo's instruction file.
- A converted file is never checked with `node --check`, never imported to see whether it loads, and an entry is
  never run: its top level can start a suite, a gate or a write. An entry's run belongs to its own test.

## Signs it was skipped

- A converter started before the size line was shown, the plan approved, or the commit word given.
- Two converters at once, or a batch started on a tree whose last batch is neither committed nor restored.
- A batch committed on the seat's word alone, with the typecheck and its tests not run here.
- A type loosened, a test skipped or `engines` changed to make a batch pass.
- A `check` file for reason (a) or (b) that requires a path not ending in `.js`, `.cjs`, `.mjs` or `.json`, or
  builds a path to a `.ts`, `.mts` or `.cts` file.
- A resume that planned or graded again with the files of every batch not done unchanged and the `Approved:` line
  there, or that built batches of a plan with no `Approved:` line.
- This session read a code file, or a push.
