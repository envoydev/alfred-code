# Solve Task - step mechanics

Read by `task-solve` at step 3 APPROVE, before the approve ask is built; complete on its own.
The rules here are each applied at the step named: the mode-fit rule (step 3), the APPROVAL
stamp's write mechanics and lifetime (step 3 onward), the agents-mode dispatch rules and the build
bar (step 4), the background-run line (any wait of minutes), the reviewer-fit rule (the step-4 stop), the conformance run (step 5), and the purge, the sibling hand-off and the
doc-drift surface list (step 6). The
step-3 stop's `Result:` line carries `mechanics: read` - the line that proves this file was loaded
this cycle, not remembered from an earlier one.

## Contents

- Mode fit - the step-3 approve ask
- The APPROVAL stamp - writing it, and its lifetime
- Agents-mode dispatch - step 4
- The build bar - both modes
- Background runs - the one start line
- Reviewer fit - the step-4 stop's recommendation
- Conformance - step 5
- The step-6 notes purge
- The sibling hand-off - step 6
- Doc-drift surfaces - the step-6 close line

## Mode fit - the step-3 approve ask

Two build modes, the recommendation decided per plan by the `Execution:` verdict that
`habits-execution-strategy` gave for it, the reason in the option's description:

- **session** - `task-implement` runs the tasks in this chat. Fits when the tasks are few,
  serial, or one stack's.
- **agents** - each task card goes to its stack's `<stack>-implementer` seat, up to 3 at once,
  frontmatter models unless the user names one. Fits when the plan holds independent tasks that
  can build in parallel (the measured multi-slice exception: built inline, such a plan cost a
  multiple of its dispatched build).

The verdict maps straight to the mark: `parallel seats` recommends agents, `serial` or `batched`
recommends session. The plan's `Approved:` line is written after this ask is answered, quoting the answer - never
in the edit that appends the gate block, ahead of the ask. A plan whose cards own their files and verify alone recommends agents - building
it one card after another loses time and buys no quality. A fixed default is not a recommendation. Agents mode exists only where subagent dispatch is
available; where it is not, the ask offers session only and says so.

## The APPROVAL stamp - writing it, and its lifetime

The waiver's root stamp, its `AUTO` first line and the 'an earlier session's stamp is not consent' rule
are in `SKILL.md`, and step 4's per-plan APPROVED stamp is under 'Agents-mode dispatch' below; these are the mechanics around both.

- A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces
  because the guard reads the absolute path.
- If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier,
  stop and put the choice through AskUserQuestion - 'Retry the stamp (Recommended)' / 'Run this stage inline' -
  rather than retrying blind or dispatching around the gate.
- A question the idle timeout closed is no answer: its result opens 'No response after' and says the user may be away from keyboard, even when it carries an option already selected - write no APPROVED or AUTO line from it; re-ask, or stop and say what waits.
- **Lifetime.** The AUTO stamp lives until step 6's close deletes it or the session ends - a
  resumed session re-writes it only from the user's waiver words typed in THAT session, else the
  next dispatch asks. Step 4's
  delete-when-fan-out-completes applies to per-plan APPROVED stamps, and a step-5 punch-list
  re-dispatch under AUTO rides the still-live waiver.
- **Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack.
- **Under auto-run an unpushed commit is a `Leftovers:` line, never an ask** - the hook leaves an ask naming a push to
  the user, and in the same AskUserQuestion call it would hold the commit question too (audit 2026-10-14 SKF-03).
- **Under AUTO nobody is at the terminal** (audit 2026-10-10, sessions c6142301 and 9a4ef375: an overnight run
  asked for a fresh session nobody could take, and a waived close printed none of its fields). So the fresh-session
  offer and the post-compaction hold are logged, not asked - the hooks read a live AUTO stamp as unattended - and the
  fresh-session option is never taken, since nobody is there to paste the resume block. Every stop still prints its
  `Result:` / `Progress:` / `Leftovers:` lines, and the close its receipts: they are the user's first sight of the run.
- **The fresh-session numbers are this stop's.** The stop-contract hook injects the carry and the cold floor at each
  stop; a figure injected at an earlier stop is stale (e6a68237 quoted a 74-minute-old 192k while the request carried
  284.5k). An idle gap is the clock route's `ALFRED_CODE_FRESH_SESSION_AFTER_HOURS` (default 2): the prompt that
  ends it is offered the fresh session by the hook, and the next ask lists it.

## Agents-mode dispatch - step 4

Each task card goes to its stack's `<stack>-implementer` seat, dispatched exactly as the roster
spells it (`alfred-code:<seat>` where the core plugin carries it) - a flat fan-out with the main
session the only orchestrator:

- **The stamp first.** Write the approval gate file first - first line `APPROVED <contract_version> - "<the step-3 answer, verbatim>"` (under auto-run the hook's `AUTO` stamp already stands - leave it)
  (the dispatch hook blocks an unstamped implementer). It is the plan's own - `<plan id>` is the plan file's name without `.md`. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<data root>/state/approvals/<plan id>/APPROVAL` with the Write tool, and give every implementer brief the line `plan: <plan id>` - the dispatch hook passes a brief only on its own plan's stamp. DELETE it when the fan-out completes,
  before the step-5 stop: a live stamp can authorize an unrelated dispatch for up to 8h.
- **The contract version.** MINT it - `<the plan's Approved: date>-<plan slug>` - and put it in EVERY
  dispatch prompt verbatim, with the seat's literal note name:
  `note: <feature>/<contract_version>/<seat>/<task>` (the seat stores its note under that name on the handoff bus).
- **The card's docs anchors ride the brief** - the `docs.js where <file>` section ids the design
  read for the card's files - so the seat reads those sections instead of re-orienting or skipping
  it (measured: 0 docs reads in 18 of 18 seat transcripts whose briefs named none).
- **No isolation.** Dispatch into the shared tree, never a separate worktree: the seats build on the
  plan, keys and files this cycle has not committed, which a worktree cut from HEAD does not hold
  (measured: a worktree seat stopped and re-dispatched).
- **No `model:` override.** The seat's frontmatter pin is its model; a dispatch names one only when
  the user did. An execution method the user named (a subagent-driven one) sets the ORDER of the
  dispatches, never the seat type or its model (measured: 19 of 19 dispatches overridden).
- **Fast seat gates.** Each seat's green gate stays fast - build + fast tests, never integration
  replays or another minutes-long run; the slow full run happens once, in this session, at the
  step-5 review / step-6 done-gate. A red build/test routes per the repair-agent rules; tick the
  same plan file per task as reports land.

## The build bar - both modes

Both modes build to the bar `task-implement` and every `<stack>-implementer` seat carry - the
quality loop's five stages met on the first pass, comments carrying the why, each judgment call
decided against the codebase's precedent - and the plan's `## Decisions` ledger grows as they
land: appended directly in session mode, folded in from each seat's `decisions:` report lines as
its report lands in agents mode. A mid-build how-to-build question is a protocol violation.
Build-time stops are for what the BUILD cannot decide - scope beyond the plan, a decision the plan
left open that the code now forces, an EXTERNAL blocker (a dependency down, a credential missing, a
locked file). A tool the environment blocks is not yet a blocker: `task-implement`'s in-session route
comes first. A return with no closing status line - a seat stopped at its `maxTurns` (Claude Code marks the output partial from 2.1.246) or killed mid-task - is never DONE and never resumed as-is, since a resume hands a runaway a fresh budget: re-dispatch it ONCE with a scoped resume brief (its handoff note and partial diff name what landed); a second status-less return from that task goes to the user as BLOCKED.

## Background runs - the one start line

A run of minutes (a suite, a container build, a migration, a CI run) is watched by ONE wait whose
command ends on the result or a crash - a background `until` on the result line, or a `Monitor` whose
filter matches the success line AND every failure signature and exits on either. Its start gets one
line to the user: what runs, and when it should finish. Then the turn says nothing about it until
that wait ends - no reply per sample or per poll (measured: 35 short finals of progress cost ~5.07M
tokens in one session, 23 pings ~4.82M in another) - and never goes silent past the finish time it
gave: a run still going then gets one line with the new estimate (measured the other way: users asked
'is it still running?' 3 and 2 times when nothing was said).

## Reviewer fit - the step-4 stop's recommendation

Three options, one recommended, reason stated:

- **'task-verify-code in-session'** - a routine diff: no dispatch, stays in this context.
- **'the stack's `<stack>-verifier` seat'** - the diff is large, trips a risk trigger (auth,
  migration, concurrency, security, a big refactor), or was built in this session and deserves
  eyes that did not write it; frontmatter model unless the user names one.
- **'skip'** - straight to step 6's done-gate; never the recommendation.

For a broader sweep the user can run `/review-code --depth deep` themselves - it is not part of
this flow. The user can inspect the diff themselves at this stop before answering.

## Conformance - step 5

The reviewer the step-4 stop chose RUNS: a Skill tool call on `task-verify-code`, or an Agent dispatch
of the seat - reviewing from memory of an earlier load is not running it, and a COMMIT-GATE receipt may
only name a review that ran. Point it at the plan file - its task cards and `## Decisions` ledger.
Deviations and findings become a punch list routed back to step 4 - and the fix delta gets the SAME
reviewer again before anything is stamped: a punch-list fix is unreviewed code. Then the body's
`Conformance:` stamp.

## The step-6 notes purge

**The purge is counted, not claimed.** At close, from the project root: `node .claude/hooks/handoff.js left <feature>` with the feature's slug - its first line counts what is left of the feature's handoff notes, each listed `note <name>` below it, read from the bus, so no recollection decides it; an unreadable store prints no number and exits 1. Above zero the close is not done - purge the rest, then count again.

## The sibling hand-off - step 6

A change a sibling repo must follow is written as a task card under
`<docs-path>/work/cross-project-tasks/` (the cross-project write guard blocks the sibling's tree), after reading the sibling's actual source: for each client action the card tells the sibling
to wire, its handler there, and each backend route that handler calls confirmed to exist in THIS repo (one grep
over the endpoint files) - a route that does not exist leaves the bullet out. The close then prints it beside
the card as the docs-root rule's hand-off block, ready to paste into the sibling's session, so nobody has to ask for it inline (measured:
the 12th 'write it here as markdown' ask in one project, each a full-context turn). A reply drafted for
another session waits for the commit / publish answer, so every id it quotes is final.

## Doc-drift surfaces - the step-6 close line

An architecture-critical surface, any one of which earns the close report's one-line pointer to
the architecture capture: a schema / EF migration, a new module or project, a moved boundary or
dependency direction, a changed cross-stack seam or eventing contract, a new external dependency.
Such a change names `/capture-architecture` (diff-scoped, cheap); substantial code + tests with the
coverage doc absent or stamped before the change names `/capture-test-coverage`.

A build, test or run command this cycle proved wrong - a red the documented command gave and a changed
flag or path turned green - is doc drift too, whatever the code surface: the close line names the
AGENTS.md line or the run-book section (`<docs-path>/awareness/PROJECT-AWARENESS.md`) that still
prints the old command, beside the command that worked. A plan's `## Decisions` entry is not that
record - the plan closes, the run book is what the next session reads.
