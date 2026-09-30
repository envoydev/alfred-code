# Code Quality Loop - loop mechanics

Step-scoped mechanics for the default `alfred-loop-quality` run: the seat brief shapes (step 2), the
RESUME BLOCK (step 3, on a 'fresh' answer) and the final report's field rules (step 3, on STOP). The
body's step 3 Reads this file whole and the report's `Mechanics` line is the receipt; step 2 reads its
own section when it dispatches. Every rule here is binding - this file holds the shape, the body holds
the step. The staged run has its own mechanics (`stage-close.md`) and never uses this file.

## Seat brief shapes - step 2

- **small-tier implementer brief** - ONE brief per module batching its small findings: per finding the
  file:line, the rule it breaks, the smallest correct change already decided and the check that proves
  it; then the `0.`-numbered fix discipline's text folded in whole; then `memory: none` - a scoped fix
  has no navigation-server hand-off. A brief that does hand a note names it literally, read side included (memory
  hygiene: `references/domain-trio-protocol.md`).
- **substantial-tier designer brief** - the finding, its assessment entry (rule, severity, remediation)
  as the requirement, and the fix discipline; the designer returns the decomposition, and the body's
  step 2 gates and approves it before any implementer runs.
- **Before any brief** - trace each finding to its exact line with a deterministic locator (the navigation server for a
  symbol, grep for a text pattern) and note the sibling pattern the fix must mirror; a brief written
  from an untraced finding ships the capture's guess. A finding whose seat already quoted the locator
  and its reproducing output is traced - do not re-derive it.

## RESUME BLOCK - step 3, on 'fresh'

When the fresh-session ask answers 'fresh', end the turn with this block and nothing else - no 'one more
step', no new work in this chat. The new session must be able to start from the block alone:

```text
RESUME - alfred-loop-quality
Invocation: /alfred-loop-quality <TARGET> - resumed round <N of 3> (rounds consumed: <list>)
Mode: <DELEGATED | INLINE> - "<the mode answer, verbatim>"
Read first: <docs-path>/loops/0.<name>.md (the fix discipline, when present) - step 1 recomputes <docs-path>/quality/CODE-ASSESSMENT.md fresh, so there is nothing to resume from in that file
Sweep baseline: <sha recorded at round 1> - the final anti-gaming sweep diffs against it
Baseline: build <green | red: what>, tests <green | red: what>, last commit <sha | none>, pushed <yes | no>
Remaining findings, rank order (titles, not C-numbers - a fresh capture may re-rank):
  1. <finding title> - <severity> - <tier> - <rule> - <remediation, one line>
Deferred: <structural items declined or undecided | none>
```

The invocation names the rounds already consumed so the 3-round cap survives the resume, and names no
`RUN-STATE.md` - that file is the staged run's, and an invocation naming it resumes staged. On a RESUMED
session no mode ask fires: the `Mode:` line is what the body's Rules have the small-tier stamp quote.
The declined set does NOT carry across the resume - it lives in context only, so the new session starts
with a clean one.

## Final report - field rules, step 3 on STOP

One line per field, a table where a field lists several items - the close is an answer like any other
and the answer-length hook blocks a wall of prose; tables are exempt.

- **Outcome** - SATISFIED / PLATEAU / CAPPED / BLOCKED, and on which round. CAPPED means the CUMULATIVE
  round cap was reached, counted across sessions through the resume invocation. A session ending because
  the user chose the fresh-session option with fixable findings left is a LOOP handoff, not CAPPED.
- **Resolved** - each finding fixed, its rule, its tier, and the change that closed it.
- **Deferred** - structural items the user declined or has not decided this run - never silently dropped.
- **Proposed decisions** - each declined-but-recurring finding, in the shape the assessment's Proposed
  decisions carries: the claim, the reason, what it costs. This loop never writes the decision log.
- **Docs** - `quality/CODE-ASSESSMENT.md: recomputed` at stop, or `skipped - nothing shipped`. The loop
  never EDITS that doc or a loops prompt; a touch count on either in a loop-authored diff is a defect.
- **Baseline** - build + tests green at stop (or the red that blocked it), plus the push state when
  commits exist.
- **Anti-gaming** - the sweep over the cumulative diff against the sweep baseline: clean, or what was
  reverted and which fix gamed it; `not run - nothing shipped` when the run changed nothing.
- **Memories** - `memories purged: <names|none>`, fold-first per `references/domain-trio-protocol.md`.
- **Next actions** - when Deferred items wait on the operator, a ranked what-to-do list ships IN this
  report, not on request.
- **Mechanics** - `loop-mechanics.md: read`, then `bootstrap.md: <yes|n/a>` - the receipt that this file was read this step (`bootstrap.md: yes` when the run seeded the loops folder, else `n/a`).

Then the two closing asks the body mandates, both through AskUserQuestion and never a prose bullet: the
commit decision (commit now / hold) when work is uncommitted and no round is queued, and tear-down-vs-keep
for anything the round started and still has up.
