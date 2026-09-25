---
name: project-solve-task
description: "Use to run a task, feature, or bug through the whole single-chat vertical with a hard user gate between every step: design -> plan audit -> user approval + build-mode choice -> build -> build review (skippable) -> done-gate. Every stop is a real pause - switch model or effort, add context, or edit the plan before saying go - and the plan file plus a serena cycle note make every step resumable after compaction or in a fresh session. Trigger on run the task cycle, build this with approvals, gated implementation, step-by-step with my sign-off. Not the dispatched multi-agent flow (project-solve-cross-task), not greenfield, and not a one-line edit."
disable-model-invocation: true
---

# Solve Task - the gated single-chat vertical

One task/feature/bug, six steps, and the user holds the gate between every two. The four twin
skills do the work; this skill owns the chain, the stops, the mode choices, and the state that
survives a compaction or a fresh session. It never designs, builds, or reviews anything itself.
The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a
run-time load.

## State - two layers, split by durability

- **The plan file** (`<docs-path>/superpowers/plans/<feature>.md`) is the durable truth: the tasks, every stamp this cycle adds (`Gated`, `Approved` +
  build mode, `Conformance` verdict or `skipped`, `Completed`), per-task status + evidence. On any
  conflict with memory or the chat, the file wins.
- **The serena cycle note** (`write_memory` named `<feature>__cycle`) is the working cursor:
  current step, chosen modes, resume pointer (plan path + next task), any mid-task scratch worth
  carrying. Update it at EVERY stop and after every task tick; it is never more than one step
  stale when compaction hits. Local and disposable - everything essential is in the plan file.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the feature's cycle
note (or an equivalent direct read of `.serena/memories/` - the note's content is the contract,
not the tool route), and read the plan file's stamps. A cycle mid-flight resumes at its cursor - never restart a
step whose stamp says it already passed. A NEW cycle starting after a finished one in this same
session recommends the fresh-session hand-off in its first ask - the finished cycle's carried
context compounds into every later call. A cycle mid-build looks like:

```
plan <docs-path>/superpowers/plans/csv-export.md:
  Gated: passed | Approved: 2026-07-16 - mode session
  task 1 DONE (dotnet test green - 4 passed) | task 2 IN_PROGRESS
cycle note 'csv-export__cycle': step 4 BUILD - resume at task 2, mode session
```

## The stop contract

A stop IS one AskUserQuestion call: report THREE named fields, then put the next move through the
AskUserQuestion tool - EVERY stop, the plain step-done ones included.

```
Result:    <one line> - <the artifact path>
Progress:  <N> of <M> steps
Leftovers: <what this run started and did not finish | none>
```

Named fields, not prose about them: the named form survives a compaction where the prose
equivalent does not, and `Leftovers:` exists because an unreviewed fix delta otherwise sits
unnoticed - `none` is an answer, an omitted line is not. Markdown-bold (`**Result:**`) is the same
format and counts; a status table instead of the names does not. The stop-contract hook reads the
turn's prose and the ask's own text for all three names and says so when one is missing (measured:
13 sessions loaded this contract, 5 used the fields at all, across 109 asks).
There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete - the next step (named), the route-back where the step surfaced gaps or findings, the
fresh-session resume on a long cycle (below), any conflict's real resolutions - the
recommendation marked per that stop's own rule, free text always available via the built-in
Other. This is not a preference: a contract scoped to 'decision-carrying' stops lets a run
classify every plain stop out of the mandate and stall in prose - a question with options gets
answered, a prose 'how shall I proceed' gets skimmed. Where the harness has no such tool, list the same options in plain text
and END THE TURN. The question never closes the user's window: they can interrupt it to switch
model or effort, paste context, or edit the plan file directly, then answer - and the stop is
the cheap point to run the next step in a fresh session (`/clear`): resume needs only the plan
file + cycle note, so the step starts at a few k of context - in a long cycle the carried-forward
context is the single biggest token cost (a resume restarts at 21.5-59.4% of the carried context with zero
re-work - state those two absolute numbers to the user, never a ratio). On a long cycle this is a step,
not an offer to remember: once the cycle has crossed the install's fresh-session trigger for its context
window (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window),
spans hours, or resumes after an idle gap, the fresh-session resume IS one of the next ask's options - every
ask until it is taken or the cycle closes. The two absolute numbers are handed to you, not
estimated: on any of those three conditions the stop-contract hook injects this session's measured
carry per message and the cold floor a fresh one restarts at, before the ask is built - quote those,
and if the injection is absent say the numbers are unmeasured rather than inventing a fraction. And HONOR the answer: when the user picks it, the
turn ends with a short ack plus the paste-ready resume block - no 'one more step', no new work
in this chat. This is a CONSTRUCTION check, not a memory: before
emitting any stop's AskUserQuestion, ask 'has this cycle crossed the trigger?' - if yes and the
option list has no fresh-session entry, the question is malformed, rebuild it - only a per-ask
check survives a long cycle. The selected answer is the go; silence is not, and a stop that only narrates is not a stop.

**Autonomy waiver (AUTO).** When the user explicitly asks for a no-stops run ('run all
recommended without asking me'), do not silently self-authorize past the stops - the contract
has a receipted path: write `<docs-path>/flow/APPROVAL` with first line
`AUTO - "<their words, verbatim>"` (the same file-backed waiver `project-solve-cross-task`
uses), say in one line that stops are waived under it, and proceed taking each stop's
recommended option; the pre-commit checkpoint and its receipt still apply. Write the stamp at the ABSOLUTE path `$CLAUDE_PROJECT_DIR/<docs-path>/flow/APPROVAL` with the Write tool. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. `references/step-mechanics.md` carries the rest of the mechanics - the protected-path prompt, why a relative write bounces the dispatch, what to do when the harness refuses both write routes, and the AUTO stamp's lifetime across steps 4-6.

## Size first

State the size in ONE line before anything else - `Size: <trivial|small|standard|cross> - <the
signal that decided it>` - then run only that row's steps. The size can be raised mid-run, never
lowered.

| Size | Signals | Steps that run |
|---|---|---|
| trivial | one file, no new dependency, no behaviour a test would see (typo, comment, format, rename inside a file) | edit -> scoped check -> close. No design, no audit, no stop |
| small | up to 3 files in one domain, no new dependency, no public contract touched | plan inline -> build -> verifier -> close. One stop, the close |
| standard | anything else in one domain | the full gated vertical below |
| cross | more than one domain | the cross-domain orchestrator |

Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## The steps

Each step that names a skill INVOKES it via the Skill tool - and re-invokes it for every new
cycle in the same chat, even when an earlier cycle already loaded it: 'it is still in context'
runs the step off stale framing and freezes cost attribution on the wrong skill. One exception:
a capture named in a close-out line (step 6) is a POINTER for the user to type, never a call this
run makes.

1. **DESIGN** - run `project-solution-design`, with `project-clarify` loaded first - it settles an
   ask with more than one reading and passes a clear one straight through. It writes the plan to
   the plans folder above; the file, not the chat, is the artifact - and that skill's design rules are settled
   IN it (every seam passes the decision-level rules, every task card carries its `log_points`, the
   `## Decisions` ledger holds every judgment call with its precedent or an explicit none), so step 5
   reviews the built code against a plan that already decided all three. *Stop.*
2. **GATE** - run `project-verify-plan` over the plan file. It stamps `Gated: passed` or the gaps
   found. Gaps route back to step 1 on the user's word. A user who declines the audit gets the
   same honest ledger as step 5: stamp `Gated: skipped by user - <their words>` and continue -
   never leave the field blank or fake a pass. *Stop.*
3. **APPROVE** - Read `references/step-mechanics.md` now - the mode-fit rule for this ask, the
   build bar, the step-4 reviewer-fit rule and step 6's doc-drift surfaces are its content, not
   homework; this stop's `Result:` line carries `mechanics: read` as the receipt. Then present the
   gated plan and put the gate through the stop contract's decision mechanism as ONE question
   whose options each NAME the mode: 'Approve - build in this session', 'Approve - dispatch the
   agent seats', 'Not yet - changes needed'. Mark recommended the mode that fits THIS plan per the
   mode-fit rule, with the reason in the option's description - a fixed default is not a
   recommendation. Approval and mode arrive as one answer by construction - the bare 'go'
   that names no mode cannot happen; a typed Other answer that omits the mode is re-asked, never
   defaulted. (When the invocation already named the mode, the question carries only approve /
   not-yet - restate the mode you are stamping.) Stamp
   `Approved: <date> - mode <session|agents>`
   into the plan file, quoting the selected answer as the user's approval words. Nothing builds
   without this stamp. Agents mode exists only where subagent dispatch is available; otherwise
   offer session only and say so rather than pretending.
4. **BUILD** - per the approved mode:
   - *session*: run `project-implementer` - it marks each task `IN_PROGRESS` before code, ticks it
     `DONE` with evidence after its green gate, and keeps the plan's resume note current.
   - *agents*: fan the plan's task cards out to the matching `<stack>-implementer` seats - flat
     fan-out per the shared policy `project-solve-cross-task` owns (write its approval gate file
     first, quoting this step's user approval verbatim - the dispatch hook blocks an unstamped
     implementer; DELETE that gate file when the fan-out completes, before the step-5 stop - a
     stamp left live can silently authorize an unrelated later dispatch for up to 8h), the main
     session the only
     orchestrator; a red build/test routes per the repair-agent rules; tick the same plan file
     per task as reports land. MINT the run's contract version - `<the plan's Approved: date>-<plan
     slug>` - and put it in EVERY dispatch prompt verbatim, with the seat's memory-handoff line
     spelled out: `write_memory('<feature>__<contract_version>__<seat>__<task>', ...)`. Each
     seat's green gate stays fast -
     build + fast tests, never
     integration replays or another minutes-long run; the slow full run
     happens once, in this session, at the step-5 review / step-6 done-gate.
   Both modes build to the bar the step mechanics reference states, and the plan's `## Decisions`
   ledger grows as they land. A mid-build how-to-build question is a protocol violation. Build-time stops are for what the BUILD cannot decide, and
   there are three: scope beyond the plan, a decision the plan left open that the code now forces,
   and an EXTERNAL blocker the run cannot resolve (a service or test dependency down, a credential
   missing, a locked file). State the blocker and what is done and what is not, then put the next
   move through ONE AskUserQuestion like every other stop - wait for the blocker to clear, re-scope
   the task around it (name the alternate route), or drop the blocked part and close on the rest.
   A blocker stated in prose with no ask leaves the user to supply the next move unprompted.
   *Stop* - and this stop chooses the reviewer for step 5, through the same decision mechanism:
   'project-verify-code in-session' - no dispatch, stays in this context; 'the stack's
   `<stack>-verifier` seat' - isolated eyes, frontmatter model unless the user names one; or
   'skip' - straight to step 6's done-gate. Mark recommended what fits the assembled diff per the
   reviewer-fit rule, reason stated; skip is never the recommendation.
5. **CONFORMANCE** (unless skipped - a skip is stamped `Conformance: skipped by user`, an honest
   record, not a silent gap) - INVOKE the reviewer chosen at the step-4 stop: in-session means a
   Skill tool call on `project-verify-code`, the seat means an Agent dispatch - recording the
   choice and reviewing from memory of an earlier load is not running it, and a COMMIT-GATE
   receipt may only name a review that actually ran. Point it at the plan file so it reviews against the plan - its task cards and its `## Decisions`
   ledger - not in isolation. The review protocol -
   build + tests rerun, plan conformance, stack traps, the live-run probe, the wire-contract trace -
   is `project-verify-code`'s (the inline default, twin of the verifier seat); the `<stack>-verifier`
   seat runs the same protocol dispatched.
   Deviations and findings become a punch list routed back to step 4 - and the fix delta gets the
   SAME reviewer again before anything is stamped `Completed`: a punch-list fix is unreviewed code.
   Stamp the verdict. *Stop.*
6. **CLOSE** - apply any fixes the step-5 review handed back, then the done gate
   (load `project-done-gate` - the whole feature's acceptance criteria, each one
   demonstrated by a run this session, quoted, not assumed). Stamp `Completed: <date>` with the
   per-task evidence table, and name the `## Decisions` ledger by its entry count - never re-pasted
   into the close. The stamp CLOSES this plan file: print one line with it - `Completed - the next
   scope starts a NEW plan file, not this one` - so the rule is on screen at the moment it starts
   applying, not only in this skill's body. Delete or archive the cycle note, and in an agents-mode run purge the
   run's minted seat notes too - `mcp__plugin_serena_serena__delete_memory` each `<feature>__<contract_version>__*`
   note - stating `memories purged: <names|none>` in the close report; the close is incomplete while
   this run's deletes trail its writes. *Stop* - and this stop is where the
   close-out decisions live: anything PENDING (an uncommitted diff, an unpushed commit, a deferred
   item, a cross-repo follow-up) goes into the ask's options - commit now / hold / whatever the
   real fork is; only a cycle with nothing pending ends on the report alone.
   New scope arriving in-chat after `Completed:` is a NEW cycle in a NEW plan file (a stamped file
   is a record, never a place to append) - re-enter step 1, or say plainly that the work is running
   ungated and why; never build it on a casual 'yes, add it'. Measured: 8 scope additions over one
   55-hour session with zero plan-file writes and no ungated statement either.
   When the change affects a sibling repo's client, the handoff is a
   FILE in THIS repo - a task card under `<docs-path>/cross-project-tasks/` (the cross-project
   write guard blocks a write into the sibling's tree; reading it stays open) or a serena note -
   never chat-only prose - and verify the sibling's actual source before writing what it must do.
   **Doc-drift awareness** - one line at most in the close report, the user decides, never
   auto-run: when the landed change touched an architecture-critical surface (the list is in
   `references/step-mechanics.md`), say so and name
   `/project-architecture-analyzer` (update mode is diff-scoped and cheap); when substantial
   code + tests landed and the coverage doc is absent or its stamp predates the change, name
   `/project-test-coverage-analyzer` the same way.

## Do not

- Never pass a stop without the user's explicit word, and never approve the plan yourself - the
  APPROVE stamp records the user's decision, not yours; an answer that names no build mode
  approves nothing.
- Never end a stop's turn without its AskUserQuestion (or the plain-text fallback's option
  list) - a turn that narrates the result and waits offers the user nothing to answer.
- Never dispatch a seat the user did not choose at a stop - dispatch is explicit-only house-wide.
- Never keep cycle state only in chat: a stamp or tick that is not in the plan file does not
  exist. The serena note is a cursor, never the truth.
- Never re-run a stamped step on resume; pick up at the cursor.
