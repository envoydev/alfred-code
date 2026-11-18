---
name: repo-audit-plugin
description: "Use when the user asks to run this repo's audits together - '/repo-audit-plugin', 'run all audits', 'audit the skills and hooks'. Runs the kinds named, or all."
argument-hint: "[kind, kind ... | exclude kind, kind ...] [commit] [parallel] [full]"
---

# Plugin audit - one flow for every audit: a strong model plans, a cheaper one edits

One flow for the ten audits (`repo-audit-<kind>`), run for one kind or for several in one run. The reading, the
scoring and every decision about what to change happen on the planner's model; the edits happen on the editor's,
from a plan that leaves it nothing to decide. Each audit keeps its own method, rubric and run folder.

## When to use

Two ways in. Say in one line which one this run took:

- **Several kinds - the user asked for audits together.** They typed `/repo-audit-plugin` for every kind this repo
  has targets for, `/repo-audit-plugin exclude tools, usage` for every kind but those, or
  `/repo-audit-plugin skills, hooks` for those kinds alone - or asked for the same in chat: 'run all the audits',
  'audit everything except usage', 'audit the rules and the hooks'. The words typed after the command: `$ARGUMENTS`.
  **Read `references/all-kinds.md` before step 1.** It says which kinds run, in what order - one kind at a time
  unless the request says `parallel` - and which steps of the flow below it replaces for the run.
- **One kind - a `repo-audit-<kind>` skill loaded this file** at the start of its run, after the user typed that
  audit's own command. That skill - 'the audit skill' below - keeps its own phases, rubric, guards and output
  contract; the flow below says who runs each phase and what passes between them. `references/all-kinds.md` is not
  read. Where the audit skill names its own run folder, size and batches, options for step 8's ask, or work this
  session does around a seat - before the planner starts, between the edit and the verify step, after a 'Report
  only' - its word replaces this file's default for that step.
- Only on the user's ask. An audit mentioned in passing, or a question about one, starts nothing: a run spends
  planner seats on the strongest model before it shows anything.
- Not for a change outside an audit.

## The seats

- **This session coordinates.** It resolves the targets, starts the seats, asks the user and prints the result. It
  reads no audited file whole and scores nothing: keeping the audit out of this context is why the seats exist.
- **The planner** is the `audit-planner` agent. It runs
  the audit skill's read, score and currency phases, writes the report and the plan, and later verifies. It never
  edits an audited file.
- **The grader** is the `refining-plans` skill, grading the plan when the plan grade is on.
- **The editor** is the `audit-editor` agent. It applies the plan and decides nothing.
- **Each seat's model** is passed as its dispatch's `model`: the one the user named for this run only, else the
  `audit_model` or `implement_model` of step 2's settings - the audit model is the `plan_model` until it is set
  (Opus plans and Sonnet edits where nothing sets another). A
  model named without that limit ('audit with fable', 'edit with haiku') is a saved setting and reaches the seat that
  way; 'planner model fable' names the `plan_model`, not this seat. A value of `none`
  passes no `model`. The grader runs on the `review_model`.
- **No dispatch available**, or one seat failing twice: run that seat's work here in a separate step, mark it
  `INLINE` in the report, and say the model split did not hold for it.

## Two scores, kept apart

- **The audit's scores** are the planner's: each item against the audit skill's rubric, to its `TARGET` (grade A).
  They are the audit itself and are never switched off.
- **The plan grade** is the grader's: `plan.md` against a plan rubric, to the pass score. 'stop scoring',
  the `scoring` switch and the pass score govern it alone; none of them moves `TARGET` or an item's grade.
- An item's final grade is always the audit's, from the verify step. The plan grade only gates the ask.

## The run folder

`docs/superpowers/audits/<date>-<kind>/` in the audited repo, git-ignored. It holds `run.md`, `baseline.md`,
`records.md`, `plan.md`, `grades.tsv`, `ledger.md`, `final.md` and `retro.md`; a batched run adds `-<n>` to
`baseline`, `records`, `plan`, `final` and `retro` per batch, and its `set` seat writes the unnumbered
`baseline.md`, `plan.md`, `grades.tsv` and `final.md`, and `retro-set.md`. Nothing in it is committed. Beside the
run folders, `docs/superpowers/audits/state/<kind>.json` is what the scope script recorded: each item's grade
with the hashes it was graded under.

## The flow

With `auto-run` on, the asks of steps 4 and 6 are not put: each takes its `(Recommended)` option and is ledgered as
a ruling, as that skill says, and what that skill still stops on still stops. Step 8's ask is the approval of the
plan, and the `auto_approve` setting decides it as the `plan-approval` rule says, whatever auto-run says: on, 'Apply
all' is taken and ledgered; off, the ask is put and the user is notified that the run waits.

1. **Targets and scope.** Do the audit skill's Targets step: the `audit.<kind>` entry, its `roots`, `checks` and
   `notes`. No entry stops the run as that skill says. Then `git status --porcelain -- <targets>` must print
   nothing: a target with an uncommitted change stops the run here, naming the paths to commit or stash first -
   the plan's `Baseline` revision is the audit's snapshot, and step 7 never passes on a target that differs from
   it. List every target file with its size (`wc -c`), and create the run folder - `<date>-<kind>-2/`, then `-3`,
   where the kind already has one of this date: a folder an earlier record points to is never written over.

   Then the scope, where the repository holds `.claude/kit/audit-scope.mjs` and the kind is scoped: `skills`,
   `commands`, `agents`, `rules` and `code` always, `hooks` only where its `audit` entry carries a `scope_with` list -
   the paths every item's grade rests on besides its own files. Run
   `node .claude/kit/audit-scope.mjs scope <kind> [--full] [--max-age <days>] [--with <path>]... <root>...` with
   the entry's `roots` and one
   `--with` for each `scope_with` path, and `--max-age <days>` where the entry carries `max_age_days`: a carried
   grade older than that - 30 days without the key - is audited again, since a carried item is never checked
   against outside documentation. Every path the script takes - a root, a `--with` path, `--run` - is
   written from the repository root, never absolute. `full` after the command, or 'audit everything again' in
   chat, adds
   `--full`; it is no kind. Keep the output in `run.md`:
   - an `audit <item>` line is an item to audit - new, changed, graded below the target, or graded longer ago
     than the age limit. Those items are the
     planner's targets, and where the audit skill says 'every item' it means every one of them;
   - a `carried <item>` line is an item graded at the target, within the age limit, whose files have not changed
     since: it is not read
     or scored, and goes to the planner as printed, under `CARRIED:`;
   - the `Graded under:` line goes back to `record` in step 10.

   No `audit` line: start no seat. Print the scope lines and a scorecard of the carried grades, set the status
   `done - all <n> items carried`, record nothing and skip step 12. Where the script is absent, the kind is not
   scoped or `scope` exits with anything but 0, every item is audited, and the `audit-scope:` line it printed -
   on an exit other than 2, the last line of its stderr - goes on the size line and into the report.
2. **Settings.** Take the `kit status` line of the request, or run `node .claude/kit/settings.mjs`, and write `run.md`: the kind, the way in (one kind, or several with the queue file's path), `WRITE`, the planner's and the
   editor's model, the pass score and `Plan grade: on` or `off`, each with its source - the user's words in this
   session, the settings, or the default. The plan grade is off when that line's `scoring` is off or
   the run is report-only (`WRITE` is `false`); a
   grade the user asked for in their words turns it on, except after they said in this session to stop scoring. After
   a compaction, Read `run.md` and `ledger.md` before the next dispatch or ask - and, where `run.md` says several
   kinds, `references/all-kinds.md` and then its queue file: they are how the run outlives the summary. So `run.md`
   also holds what a summary drops: each seat's id and mode, added when the seat is dispatched - a later
   SendMessage needs it - and one `Next:` line, rewritten at every step, with the step the run is at and the one
   after it.
3. **Batches.** The targets - the items to audit, where step 1 scoped the kind - over 250,000 characters in total
   are split into batches under that size, a skill folder or an agent file never split, in name order. Under it,
   one batch.
4. **Size before spend.** No planner starts before the user has seen two lines, in this form:
   `Size: <kind> - <files> files, <total> characters, <N> batch(es), <seats> planner seat(s)` and
   `Models: audit <model>, review <model>, implement <model>` - `audit` is the planner seat's model, the
   `audit_model`. Where step 1 ran the scope, add its `Scope:` line
   and, where it printed them, its `age:` line and its line that the audit skill changed - the cue for `full`.
   One batch: add whether
   the plan is graded, and go on. More than one batch: stop and ask,
   since each batch is its own planner on the stronger model and a graded plan costs a round or more on top:

   ```ask
   This audit reads <total> characters in <N> batches: <N> planners on <model>, one more to merge them<, and the plan is graded>. Start?
   - 'All <N> batches (Recommended)' - the whole set is audited in one run
   - 'One batch first' - audit <the first batch's items> now, and decide on the rest from its report
   - 'Pick items' - name the items to audit; the batches are rebuilt from them
   - 'Cancel' - nothing is started
   ```

   Above three batches the mark moves: 'One batch first (Recommended)' is listed first and 'All <N> batches' second.
5. **Plan.** Dispatch one planner per batch, each with: the kind, the audit skill's folder, the repo root, its
   target paths, the run folder, the audit skill's parameters, the `checks` and `notes`, step 1's `CARRIED:`
   lines, and mode `audit`. At most two planner seats run at a time, a third batch waiting for a free seat - four
   where the request says `parallel` after the command, or 'side by side' in chat. A lone batch's dispatch says
   that no `set` seat runs. With more than one batch, then dispatch one more planner in mode `set` with only the
   batches' record and plan files, every batch's item ids and the `CARRIED:` lines: it adds the set-wide findings
   and merges everything into one `plan.md`.
6. **Open questions.** Whatever the planner returned as the user's to decide goes to the user in one
   AskUserQuestion call (at most four questions, each with a recommended option first). Outside auto-run, never
   answer one for the user. Write each answer to `run.md` with who took it and when. Where every answer is the
   recommended option - always so under auto-run - the plan already stands on it and the planner is not resumed:
   the answers go into the grade's `task.md` as decisions already made, and to the planner with step 10's verify
   message. An answer that differs goes to the same planner with SendMessage at once, since the plan changes.
7. **Grade.** First the freshness check: `git diff --stat <the plan's Baseline revision> -- <targets>` and
   `git status --porcelain -- <targets>` both print nothing, and, where the repository holds
   `.claude/kit/prove-plan.mjs`, `node .claude/kit/prove-plan.mjs --check <plan>` exits 0. Pass it one
   `--without` for each folder beside the plan named `<the plan's expected folder>-without-<edits>` whose edits
   the plan still holds - `expected-without-E5-E8` is `--without E5,E8`; a folder that names an edit struck
   since is stale - name it in `run.md` and pass it to
   nothing. A target that changed since the plan was written, or a check that fails, goes back to the planner
   with SendMessage - re-audit those items, prove the plan again - before anything is graded or asked. A plan
   with no edit - every audited item already at the target - is a report-only run from here: no check, no grade,
   no ask, no editor and no verify.

   Then, with `Plan grade: on`, load `refining-plans` and grade `plan.md` to `run.md`'s pass score. The task is
   the audit skill's goal and `baseline.md` - in a batched run the one the `set` seat wrote, never the batches'
   files - and, under 'Verified', the `Proved:` line of the check, with the instruction not to replay the edits
   and to read what a replay cannot show: whether each `New` says what its finding needs, the guards, the
   checks, a registered text's markers. An audit plan is graded twice at most; the limit is this flow's own:
   - the first grade at the pass score or more with no BLOCKER: send the planner each BLOCKER and MATERIAL the
     evidence confirms in one message, check each fix against its finding here, and go on with 'fixed after the
     grade, not re-graded'. A MINOR sends no message: list it in the report under the plan grade;
   - under the pass score, or with a BLOCKER: the same one message, then one more grade by a fresh reviewer. At
     the pass score or more, go on as above. Still under it, the confirmed findings are fixed and the plan waits
     for the user with its score path and open findings, under auto-run and `auto_approve` too: no third grade.

   A revision is always the planner's: never rewrite the plan here. Keep the score path.
8. **The ask.** A report-only run - `WRITE` false, or a plan with no edit - prints the report and the plan's path,
   records its baseline grades as step 10 says, and stops here; so does a run after a 'Report only' answer below.
   Otherwise show one row per
   item - baseline grade, planned edits, expected grade - and name every edit that stands on a ruling taken under
   auto-run, with its `New` text and whether it can be struck alone: the user has not seen that answer. The rows and
   those edits are printed whoever approves: with `auto_approve` on, only the ask below is not put. Then:

   ```ask
   Apply the audit plan - <N> edits in <M> files? Plan: <path>. Plan grade: <score path, or 'ungraded - <why>'>.
   - 'Apply all (Recommended)' - the editor applies every edit, then the planner verifies and re-grades
   - 'Pick' - choose which items' edits are applied; the rest stay in the plan
   - 'Report only' - nothing is edited; the report and the plan stay in the run folder
   ```

9. **Edit.** Repeat step 7's freshness check, its `--check` included, immediately before the editor is dispatched
   in every run - a fix after the grade changed the plan, whether or not the ask waited. After a 'Pick', first send the plan
   back to its author - the planner, or this session for a `retro-plan.md` - which moves the edits not picked out
   of `Edits`, proves the rest again and replaces the plan's expected files and checks, as the plan format says.
   The freshness check makes the plan's `Baseline`
   revision the snapshot the audit skill asks for: `git checkout <revision> -- <path>` restores a file, and the report
   gives the revision as the snapshot location. Where the audit skill names a snapshot folder, or the plan edits a
   file git does not track, copy each file the plan edits there first (`snapshot/` in the run folder where no folder
   is named). Dispatch the editor with: the plan's path, the repo root, the items picked, the `checks` commands and
   the ledger's path. The editor runs the plan's own checks as well as these.
10. **Verify.** Where the audited files reach a session through a copy the repo makes of them, refresh the copies
   first, after the kind's commit where the run makes one - and only where the repo's `notes` name a command that
   writes this repository's copies alone. Where they name none, or only one that writes other repositories too,
   run nothing: report the copies as stale, and say which later checks and which part of the verify read them.
   Then send the planner the ledger's path, the snapshot location and the answers of step 6 it was not sent, with
   SendMessage, mode `verify`: it runs the audit skill's verification phase on what was edited, re-grades those
   items and writes `final.md` and `grades.tsv`. Where this repo is the audit skills' home and the ledger marks
   no edit `SKIPPED` or `FAILED`, the message ends 'then mode `retro`', so step 12 costs no resume of its own;
   where an edit round follows, the retro goes with the last round's verify. A batched run verifies side
   by side: each batch's own planner gets that message in one turn and writes `final-<n>.md` for its items, then
   the `set` planner is sent those files, re-checks the set-wide findings and merges them into `final.md`. An edit
   the ledger marks `SKIPPED` or `FAILED` is rewritten by the planner against the file as it now is, and steps 9 and
   10 run again - at most the audit skill's `MAX_ITERATIONS` rounds in all, four where it names none.

   Then record the grades, where step 1 ran the scope:
   `node .claude/kit/audit-scope.mjs record <kind> --run <run folder> --grades <run folder>/grades.tsv --under <the two hashes of step 1's 'Graded under:' line> [--with <path>]... <root>...`,
   with step 1's paths and roots, as soon as the last `final.md` is written - in a run that takes its kinds one
   at a time, before any later kind's plan is applied, so that no grade is stored beside the hash of a later edit. A report-only
   run records the same way at step 8, its baseline grades standing. A run that stops before its verify records
   nothing, so the items it edited read `changed` next time. Keep what `record` printed in `run.md` and print
   its `Recorded:` line and each `skipped` line in the report; where it exits with anything but 0, print its
   `audit-scope:` line - on an exit other than 2, the last line of its stderr - there instead and go on. Where
   another kind's plan was applied after this kind's planner started and edits a
   path under
   this kind's roots or its `scope_with`, do not record the kind: the edited items then read `changed` next time.
11. **Report.** Print the audit skill's output contract from `final.md`, then the scorecard - the quality before
    the edits against the quality after them, from the audit's own grades, the
    baseline as `baseline.md` gives it - corrected by the `set` seat where a batch missed a finding - and each
    carried item counted at its carried grade on both sides. Items the audit skill names as not scored - 'no
    code' for `code` - are left out of `<n>`, of 'At grade A' and of the mean, and their number goes on the
    scorecard's last line:

    ```text
    Scorecard: <kind> - <n> items
    At grade A:  <before> -> <after>
    Mean grade:  <before, numeric> -> <after, numeric>
    Lowest item: <name> <grade> -> <name> <grade>
    Plan grade:  <score path, or 'ungraded - <why>'>
    Carried:     <c> of <n> items, graded <oldest date> to <newest date> - only where step 1 scoped the kind
    Not scored:  <k> items - <the audit skill's name for them> - only where the audit skill names such items
    ```

    Then `final.md`'s 'Still open' list, one line each: with `auto_approve` on no ask showed the
    user an edit that stands on a ruling, and this is the list they act on. Then one line per seat with the model
    it ran on, and the run folder. Commit nothing: a commit waits for the
    user's word.
12. **Self-review.** Only where this repo is the audit skills' home - `shared/skills/repo-audit-plugin/` exists in
    it. Anywhere else the audit skills are locked copies and this step is skipped: no `retro` message, no
    `retro.md`. What went wrong in such a run - a seat that failed, an edit marked `SKIPPED`, a plan sent back -
    is already in the report's own lines. In the home, the audit then audits itself - how its own instructions
    served this run, never the audited files again. A report-only run does it after step 8.
    - **Analyze.** Each planner wrote its file with its last verify, as step 10's message asked; a planner that
      got no such message - a report-only run - is sent one, all in one turn, mode `retro`. Each writes `retro.md`
      (`retro-<n>.md` for a batch, `retro-set.md` for the `set` seat) with at most five findings on the audit
      skill, its references and this flow.
      Add your own from `run.md`, `ledger.md` and the plan's grade rounds: a seat that failed, an edit marked
      `SKIPPED`, a plan sent back, a finding the grader raised about the plan's shape, an ask that should not have
      been needed. Every finding cites the run record it happened in and the instruction line it traces to.
    - **Rank.** Merge them into one list in `retro.md`, the costliest first: a wrong result that verification
      caught outranks work done twice, which outranks friction, and a finding several seats hit outranks one seat's.
      Keep the top seven and print them, one line each. A run with nothing to report says so: no finding is
      invented to fill the list.
    - **Improve.** Each kept finding carries the exact edit that would have prevented it. Write those edits as
      `retro-plan.md` in the plan's format and take it through steps 7 to 9 as a plan of its own, then run the
      repo's `checks`. A
      paragraph a kind's report gives under 'Currency hand-off' - a correction to an audit skill's own
      `references/currency.md` - is one more edit of that plan, outside the seven: no other step of the run lands it.
    - **The bar never moves.** No self-review edit loosens a rubric line, a floor, a grade band or a guard, drops
      a step, or makes this run's grades read better; such a finding is listed as the user's to decide, with its
      evidence, and is never planned. This run's grades are not re-scored after it.

## The plan

Its format is `references/plan-format.md`; the planner writes to it and the editor reads by it. The rule under it:
every edit carries its exact text. An instruction such as 'tighten the wording' is a decision left to the editor, and
the plan is sent back to the planner for the text.

## Signs it was skipped

- A run started on a mention of an audit, with no ask for one.
- A run of several kinds started with `references/all-kinds.md` unread.
- A planner started on a batched run before the size ask was answered or, under auto-run, ruled.
- This session read the audited files or scored an item itself.
- An edit landed before the ask or its ruling, or the editor changed something the plan does not list.
- 'Apply all' taken with `auto_approve` off, on the strength of auto-run alone.
- A plan graded or applied after one of its targets changed.
- `Plan grade: on` and the ask shows no score path.
- The report does not say which model each seat ran on, has no scorecard, or the run folder has no `run.md`.
- In the audit skills' home, a run that ends with no `retro.md`; anywhere, a self-review edit that lowers the
  audit's own bar.
- More planner seats planning at once than the cap in force: two, or four with `parallel`.
- A carried item read or scored with its files unchanged, an item with a changed file carried, or a scoped run
  that ends with no `Recorded:` line and no reason for it.
- An audit plan graded a third time, or approved by the run under the pass score.
