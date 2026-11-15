---
name: repo-audit-flow
description: "Load when a repo-audit-* skill hands off its run - the planner, grader and editor seats and the plan that passes between them. Not typed directly."
user-invocable: false
---

# Audit flow - a strong model plans, a cheaper one edits

One flow for the eight `repo-audit-*` skills. The reading, the scoring and every decision about what to change
happen on the planner's model; the edits happen on the editor's, from a plan that leaves it nothing to decide.

## When to use

- Loaded by a `repo-audit-*` skill at the start of its run. That skill - 'the audit skill' below - keeps its own
  phases, rubric, guards and output contract. This file says who runs each phase and what passes between them.
- Not for a change outside an audit, and not typed directly: an audit starts with its own `/repo-audit-<kind>`.

## The seats

- **This session coordinates.** It resolves the targets, starts the seats, asks the user and prints the result. It
  reads no audited file whole and scores nothing: keeping the audit out of this context is why the seats exist.
- **The planner** is the `audit-planner` agent. It runs
  the audit skill's read, score and currency phases, writes the report and the plan, and later verifies. It never
  edits an audited file.
- **The grader** is the `refining-plans` skill, grading the plan when the plan grade is on.
- **The editor** is the `audit-editor` agent. It applies the plan and decides nothing.
- **Each seat's model** is passed as its dispatch's `model`: the one the user named in this session ('audit with
  fable', 'edit with haiku'), else the `plan_model` or `implement_model` of step 2's settings - the user's
  `KIT_PLAN_MODEL` or `KIT_IMPLEMENT_MODEL`, else the agent file's own (Opus plans, Sonnet edits). A value of `none`
  passes no `model`. The grader runs on the `review_model`.
- **No dispatch available**, or one seat failing twice: run that seat's work here in a separate step, mark it
  `INLINE` in the report, and say the model split did not hold for it.

## Two scores, kept apart

- **The audit's scores** are the planner's: each item against the audit skill's rubric, to its `TARGET` (grade A).
  They are the audit itself and are never switched off.
- **The plan grade** is the grader's: `plan.md` against a plan rubric, to the pass score. 'stop scoring',
  `KIT_SCORING` and `KIT_PASS_SCORE` govern it alone; none of them moves `TARGET` or an item's grade.
- An item's final grade is always the audit's, from the verify step. The plan grade only gates the ask.

## The run folder

`docs/superpowers/audits/<date>-<kind>/` in the audited repo, git-ignored. It holds `run.md`, `baseline.md`,
`records.md`, `plan.md`, `ledger.md` and `final.md`; a batched run adds `-<n>` to the middle three per batch. Nothing in it is
committed.

## The steps

1. **Targets.** Do the audit skill's Targets step: the `audit.<kind>` entry, its `roots`, `checks` and `notes`. No
   entry stops the run as that skill says. List every target file with its size (`wc -c`), and create the run folder.
2. **Settings.** Take the `kit status` line of the request, or run `node .claude/kit/settings.mjs`, and write `run.md`: the kind, `WRITE`, the planner's and the
   editor's model, the pass score and `Plan grade: on` or `off`, each with its source - the user's words in this
   session, the settings, or the default. The plan grade is off when that line's `scoring` is off - this
   session's last word on it outranks the settings, both ways - or the run is report-only (`WRITE` is `false`); a
   grade the user asked for in their words turns it on, except after they said in this session to stop scoring. After
   a compaction, Read `run.md` and `ledger.md` before the next dispatch or ask: they are how the run outlives the
   summary.
3. **Batches.** Targets over 250,000 characters in total are split into batches under that size, a skill folder or
   an agent file never split, in name order. Under it, one batch.
4. **Size before spend.** No planner starts before the user has seen the size. One batch: state the total
   characters, the planner's model and whether the plan is graded in one line, and go on. More than one batch: stop and ask,
   since each batch is its own planner on the stronger model and a graded plan costs a round or more on top:

   ```ask
   This audit reads <total> characters in <N> batches: <N> planners on <model>, one more to merge them<, and the plan is graded>. Start?
   - 'All <N> batches (Recommended)' - the whole set is audited in one run
   - 'One batch first' - audit <the first batch's items> now, and decide on the rest from its report
   - 'Pick items' - name the items to audit; the batches are rebuilt from them
   - 'Cancel' - nothing is started
   ```

   Above three batches the mark moves: 'One batch first (Recommended)' is listed first and 'All <N> batches' second.
5. **Plan.** Dispatch one planner per batch, all in one message, each with: the kind, the audit skill's folder, the
   repo root, its target paths, the run folder, the audit skill's parameters, the `checks` and `notes`, and mode
   `audit`. With more than one batch, then dispatch one more planner in mode `set` with only the batches' record
   and plan files: it adds the set-wide findings and merges everything into one `plan.md`.
6. **Open questions.** Whatever the planner returned as the user's to decide goes to the user in one
   AskUserQuestion call (at most four questions, each with a recommended option first). Send the answers to the same
   planner with SendMessage so it finishes the plan. Never answer one for the user.
7. **Grade.** First the freshness check: `git diff --stat <the plan's Baseline revision> -- <targets>` and
   `git status --porcelain -- <targets>` both print nothing. A target that changed since the plan was written goes
   back to the planner with SendMessage - re-audit those items and update the plan - before anything is graded or
   asked. Then, with `Plan grade: on`, load `refining-plans` and grade `plan.md` to `run.md`'s pass score; the task is the
   audit skill's goal and the baseline report. A revision the grader asks for is the planner's: send it the findings with SendMessage, never
   rewrite the plan here. Keep the score path.
8. **The ask.** A report-only run prints the report and the plan's path and stops here. Otherwise show one row per
   item - baseline grade, planned edits, expected grade - then:

   ```ask
   Apply the audit plan - <N> edits in <M> files? Plan: <path>. Plan grade: <score path, or 'ungraded - <why>'>.
   - 'Apply all (Recommended)' - the editor applies every edit, then the planner verifies and re-grades
   - 'Pick' - choose which items' edits are applied; the rest stay in the plan
   - 'Report only' - nothing is edited; the report and the plan stay in the run folder
   ```

9. **Edit.** Repeat step 7's freshness check when the ask waited on the user. Dispatch the editor with: the plan's path, the repo root, the items picked, the `checks` commands and
   the ledger's path. The editor runs the plan's own checks as well as these.
10. **Verify.** Send the planner the ledger's path with SendMessage, mode `verify`: it runs the audit skill's
   verification phase on what was edited, re-grades those items and writes `final.md`. An edit the ledger marks
   `SKIPPED` is rewritten by the planner against the file as it now is, and steps 9 and 10 run again - at most the
   audit skill's `MAX_ITERATIONS` rounds in all.
11. **Report.** Print the audit skill's output contract from `final.md`, then one line per seat with the model it ran
    on, the plan's score path and the run folder. Commit nothing: a commit waits for the user's word.

## The plan

Its format is `references/plan-format.md`; the planner writes to it and the editor reads by it. The rule under it:
every edit carries its exact text. An instruction such as 'tighten the wording' is a decision left to the editor, and
the plan is sent back to the planner for the text.

## Signs it was skipped

- A planner started on a batched run before the size ask was answered.
- This session read the audited files or scored an item itself.
- An edit landed before the ask, or the editor changed something the plan does not list.
- A plan graded or applied after one of its targets changed.
- `Plan grade: on` and the ask shows no score path.
- The report does not say which model each seat ran on, or the run folder has no `run.md`.
