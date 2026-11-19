# The audit plan format

The planner writes `plan.md` in this shape; the editor applies it top to bottom. The plan is complete when a reader
who has never seen the audit could apply it with a text editor and nothing else. Contents: the layout - the rules for
the sections around the edits - the rules for every edit.

## Layout

````markdown
# Audit plan - <kind> - <date>

Baseline: <git revision the targets were read at> - <date and time>

## Summary

| Item | Baseline | Edits | Expected |
|---|---|---|---|
| <item> | <grade> | E1, E2 | <grade> |

## Edits

### E1 - <path from the repo root>

- Item: <the skill, agent, rule or file this belongs to>
- Finding: <the id of the baseline finding it answers>
- Why: <one line>
- Kind: replace | insert-after | delete | new-file | move-file | delete-file
- Guard: <the rule or behaviour that must still be there after the edit, or 'none'>

Old:

```text
<the exact text now in the file, long enough to appear only once>
```

New:

```text
<the exact text that replaces it>
```

## Open questions

- Q1 - <the decision that is the user's>: <option A, the recommended one> / <option B> - <what each changes in this plan>

## Not planned

- <finding id> - <why it is left: a guard forbids it, it is the user's call, it belongs to another audit>

## Effects

- <what loads, attaches or costs differently once the edits land, and which repos take the change at the next sync>

## Depends on

- <what the checks need to run, and each fact the plan assumes without having verified it, with how to verify it>

## Checks

1. <each command the editor runs after the last edit, in the order they run, with the output that means it passed>

## Risks and rollback

- <the commands that put back what the edits and the checks changed, and one row per edit that hangs on an open question>
````

## Rules for the sections around the edits

- `Baseline` is `git rev-parse --short HEAD` when the targets were read. The flow starts only on targets with no
  uncommitted change, and compares them against it before the grade and before the edit.
- A plan with no edit - every audited item already at the target - keeps `## Edits` with 'None' under it and has
  no `Applies:` line, no expected folder and no checks; the flow reads it as a report-only run.
- `Effects` is what a session notices: a rule or skill that now loads or attaches where it did not, the always-on
  size before and after, a trigger that moved. `None beyond the edited files` is a valid answer when it is true.
  A size or a count it gives is measured, never estimated: before from the files at `Baseline`, after from the
  proved results beside the plan, and again whenever an `Old` or a `New` changes.
- `Depends on` names what must hold for the plan to apply: a sibling checkout or a tool version a check needs, a
  claim about outside documentation that was not read. An assumption nobody can verify is an open question instead.
- `Open questions`: an edit that hangs on a question is still written, for the recommended option. `Summary` gives
  the expected grade with every question at its recommended option, and each question says what the grade is under
  each other option. An answered question stays in the section, marked with the option taken, who took it and
  when - the user's own answer, or a ruling under auto-run that the user may still overturn at the ask - and with
  what each option not taken would have changed. The planner marks it where it was sent the answer before the
  edit; an answer that is the recommended option is not sent then - `run.md` holds it, and `final.md` lists it
  under 'Still open'.
- A check's expected output names only what the edits change - never a count of unrelated lines, a total a tool
  prints over a file or a registry another plan can edit, or the revision `HEAD` is at: in a run of several kinds
  another kind's commit moves each of them before the editor runs. Where the edits add entries, the check names
  the ids or the lines they add and the words that mean failure, never how many the file then holds.
- Checks are numbered in the order they run, and every check is run and reported as it comes out. A check that
  writes and is safe only when something holds - a sync that copies a whole tree, a generator - tests that
  condition in its own command, so that it fails without writing where the condition does not hold. A note beside
  the command ('read Depends on first') is a decision left to the editor.
- A check that reads a copy the edits reach only through a command - a sync, a build - comes after that command
  as a check of its own, and only where the `checks` or `notes` the dispatch carries name a command that writes
  this repository's copies alone. Where they name none, or only one that writes other repositories too, the plan
  lists no such command, and `Depends on` says the copies are stale and which checks read them.
- The last check is `git status --porcelain -- <the paths the plan edits>`, each path written out, and its
  expected output is one line per path and nothing else: the list is the pathspec a commit of the plan takes. It
  is scoped to those paths because the tree may hold changes that are not this plan's - another kind's edits in
  a run that commits nothing, a file outside the targets.
- `Risks and rollback` gives the commands that put back everything the plan and its checks change, in order - the
  edited files from the `Baseline` revision (`git checkout <revision> -- <paths>`), then whatever a check wrote
  that git does not track - and says what they leave behind and whether any step is irreversible; the editor
  never runs them. Under them, one row per edit that hangs on an open question, written when the plan is: the
  question, the option the edit is written for and how the edit is struck alone - the file as every other edit
  leaves it is kept under `expected-without-E<n>/<path>` beside the plan and proved with the rest.

## Rules for every edit

- `Old` is copied from the file, never retyped, and appears exactly once in it. Where the text repeats, take more
  lines until it does not.
- The planner proves it before the plan is handed over, and again after every change to the plan: on a copy of
  the targets in the work folder, each `Old` is found exactly once at its turn, in file order, and replaced by
  its `New`. The plan says so in one line above `Summary` (`Applies: <n> of <n> edits`), the result of each edited
  file is kept under a folder beside the plan - `expected/<path>` for `plan.md`, `retro-expected/<path>` for
  `retro-plan.md` - and the plan's first check compares the edited file with it (`cmp`). Every other check is run
  against those results before the plan is handed over, with no exception: what a check needs and the copy lacks -
  a sibling checkout, say - the planner builds in the work folder, and a check it cannot prove is not listed.
  A check that writes - a sync, a
  generator, a fixer - is run only on a copy of the whole repository in the work folder, from a script file kept
  beside the plan that changes into the copy by its full path and stops unless its working directory is that copy -
  never as a command typed after a `cd` in one shell line, where a failed link leaves the shell at the repository
  root and the write lands there. The work folder is outside the repository, as the flow's 'The run folder' says: a
  copy, a checkout or a probe tree is never built in the run folder, and only a check's results (`test.txt`,
  `validate.txt`) are written there. The expected folders (`expected/`, `retro-expected/`,
  `expected-without-E<n>/`) stay beside the plan, since the `cmp` check reads them; where one holds a test file,
  the plan says so in one line under `Checks` - a test runner that globs must exclude `docs/superpowers/`.
  A plan the user picks edits from goes back to its author:
  each edit not picked moves from `Edits` to `Not planned` with 'struck at the ask', the rest are proved again,
  and the expected files and the checks are replaced before the editor starts.
- `insert-after` gives `Old` as the anchor that stays and `New` as what follows it. `delete` gives `Old` only.
  `new-file` gives `New` only, as the whole file. `move-file` and `delete-file` give the paths and no text.
- Edits to one file are listed in the order they appear in it and never overlap. An edit that depends on another
  says so on a `Needs:` line. An edit that hangs on an open question says so on a `Question:` line
  (`Question: Q1 = A`), which also names the other edits that need it - 'none' where it can be struck alone.
- Nothing is left to the editor's judgment: no 'similar changes elsewhere', no 'as appropriate', no text described
  where it could be written.
- An outer fence is one backtick longer than any fence inside the text it holds.
- Where the repository holds `.claude/kit/prove-plan.mjs`, that proof is the script's:
  `node .claude/kit/prove-plan.mjs <plan>`, run at the repository root, reads every edited file at the `Baseline`
  revision, applies the edits by the rules above, writes the expected folder beside the plan and prints the
  `Applies:` line with each file's size before and after. It writes nothing and exits 1 unless every edit applied,
  naming each edit that did not. `--without E<n>` also writes `expected-without-E<n>/`, leaving out that edit and
  every edit that needs it. It writes only beside the plan and needs no copy; a check that writes still runs on
  one. With `--check` before the plan's path it writes nothing: it replays the plan the same way, compares the
  result with the expected folder and with the count on the `Applies:` line, and exits 1 on any difference,
  naming each. The flow runs that before the grade and before the edit, so no reader has to replay an edit.
  Where the script is absent, the planner proves by hand, to the same rules.
