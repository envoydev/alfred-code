---
name: alfred-task-solve
description: "Use to run a task, feature, or bug through the whole single-chat vertical with a hard user gate between every step: design -> plan audit -> user approval + build-mode choice -> build -> build review (skippable) -> done-gate. Every stop is a real pause - switch model or effort, add context, or edit the plan before saying go - and the plan file plus a navigation server cycle note make every step resumable after compaction or in a fresh session. Trigger on run the task cycle, build this with approvals, gated implementation, step-by-step with my sign-off. Not the dispatched multi-agent flow (alfred-task-solve-cross), not greenfield, and not a one-line edit."
disable-model-invocation: true
---

# Solve Task - the gated single-chat vertical

One task/feature/bug, six steps, and the user holds the gate between every two. The four twin
skills do the work; this skill owns the chain, the stops, the mode choices, and the state that
survives a compaction or a fresh session - it never designs, builds, or reviews anything itself.
`references/evidence.md` holds the measurements behind these rules - an audit appendix, not a
run-time load.

## State - two layers, split by durability

- **The plan file** (`<docs-path>/superpowers/plans/<feature>.md`) is the durable truth: the tasks, every stamp (`Gated`, `Approved` + mode, `Conformance`, `Completed`), per-task status + evidence. It wins any conflict.
- **The navigation server cycle note** (`write_memory` named `<feature>__cycle`) is the cursor: current step, chosen modes, resume pointer - updated at EVERY stop and task tick.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the cycle note (or
read `.serena/memories/`), and read the plan file's stamps. A cycle mid-flight resumes at its
cursor - never re-run a stamped step. A resumed cycle reads `references/stops-and-resume.md`
before its first ask.

## The stop contract

A stop IS one AskUserQuestion call: report THREE named fields, then put the next move through the
AskUserQuestion tool - EVERY stop, the plain step-done ones included.

```
Result:    <one line> - <the artifact path>
Progress:  <N> of <M> steps
Leftovers: <what this run started and did not finish | none>
```

Named fields, not prose (bold counts, a table does not); `none` is an answer, an omitted line is not. There is no non-decision stop: 'what happens next' is itself the decision.
Where the harness has no such tool, list the same options in plain text and END THE TURN.

**Every ask marks exactly one option `(Recommended)`, listed first** - the move this stop's rule
recommends, the reason in its description; an ask with no mark is malformed, rebuild it before
sending. A stop's own rule may move the mark, never add
a second. A step-done stop:

```ask
<Step> done - <artifact path>. Continue to <next step>: <why it is next>.
- '<Next step> (Recommended)' - <what it does>
- 'Route back to <step>' - <the gap that sends it back>
- 'Resume in a fresh session' - required past the trigger below
```

**The fresh-session resume.** Past the install's fresh-session trigger for its context window
(150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window), across hours,
or after an idle gap, the fresh-session resume IS one of every ask's options - a CONSTRUCTION check
per ask. A resume restarts at 21.5-59.4% of the carried context with zero re-work - state those two absolute numbers to the user, never a ratio
(the stop-contract hook injects this session's; absent it, they are unmeasured). HONOR the answer: when the user picks it,
the turn ends with a short ack plus the paste-ready resume block - no new work here.

**AUTO.** An explicit no-stops ask ('run all recommended without asking me') is honored only
through the AUTO stamp - read `references/step-mechanics.md` before any step runs past a stop.

## Size first

State the size in ONE line before anything else - `Size: <trivial|small|standard|cross> - <the
signal>` - then run only that row's steps; it can be raised mid-run, never lowered.

Read `references/size.md` for the four rows - their signals and the steps each runs.

Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## The steps

Each named skill is INVOKED via the Skill tool, again every new cycle; a capture named at close is
a POINTER for the user to type.

1. **DESIGN** - run `alfred-task-design`, with `alfred-habits-clarify` loaded first; its plan file
   is the artifact. *Stop.*
2. **GATE** - `alfred-task-verify-plan` stamps `Gated: passed` or the gaps (back to step 1 on the
   user's word); a declined audit is `Gated: skipped by user - <their words>`. *Stop.*
3. **APPROVE** - Read `references/step-mechanics.md` now (this stop's `Result:` carries `mechanics:
   read`), then ONE question whose options NAME the mode:

   ```ask
   The plan is gated. Build it <here | through the seats>: <the mode-fit reason>.
   - 'Approve - build in this session (Recommended)' - <why the tasks fit one chat>
   - 'Approve - dispatch the agent seats' - <independent tasks that build in parallel>
   - 'Not yet - changes needed' - edit the plan, or say what changes
   ```

   The mark moves to the seats when the mode-fit rule picks them; an answer naming no mode is
   re-asked. Stamp `Approved: <date> - mode <session|agents>`, quoting it; nothing builds without
   it. No dispatch: offer session only.
4. **BUILD** - *session*: `alfred-task-implement`, which ticks each task in the plan file.
   *agents*: the flat fan-out per `references/step-mechanics.md`; each seat's green gate stays fast - build + fast tests, never integration replays or another minutes-long run; the slow full run happens once, in this session, at the step-5 review / step-6 done-gate.
   Build-time stops are only scope beyond the plan, a decision the code forces, and an EXTERNAL
   blocker - a how-to-build question is a protocol violation. A tool the environment blocks
   takes `alfred-task-implement`'s in-session route first (an EF migration: the design-time
   factory's project, else hand-written). Then ONE ask:

   ```ask
   <What blocks task N>. <The in-session route> finishes it here - the task cannot close without it.
   - 'Re-scope around it - <the in-session route> (Recommended)' - <what it does>
   - 'Drop the blocked part and close on the rest' - <what stays unbuilt>
   - 'Wait for the blocker to clear' - the run stops until you say go
   ```

   Never offer 'retry the same command' or 'you run it'. *Stop* - choosing step 5's reviewer:

   ```ask
   The build is green. Review it <inline | through the seat>: <the reviewer-fit reason>.
   - 'alfred-task-verify-code in-session (Recommended)' - no dispatch, stays in this context
   - 'The <stack>-verifier seat' - isolated eyes; the mark moves here per the reviewer-fit rule
   - 'Skip - straight to the done-gate' - stamped as skipped
   ```

5. **CONFORMANCE** - INVOKE the chosen reviewer (a Skill call, or the seat's dispatch - a receipt
   names only a review that ran) against the plan file; a skip is stamped `Conformance: skipped by
   user`. Findings go back to step 4, the fix delta to the SAME reviewer. Stamp the verdict. *Stop.*
6. **CLOSE** - apply the fixes, then the done gate (`alfred-habits-done-gate`: every acceptance
   criterion run and quoted). Stamp `Completed: <date>` with the per-task evidence and print
   `Completed - the next scope starts a NEW plan file, not this one`. Read `references/close.md`
   now - the note deletes and the `memories purged: <names|none>` line, new scope, a sibling repo's
   change, the Doc-drift awareness line. *Stop* - anything pending goes into the close ask; an
   uncommitted diff is held for the user's review, since a commit waits for their word
   (`baseline-git.md`):

   ```ask
   The feature is done and verified; the diff is uncommitted. Hold it for your review first.
   - 'Hold - review the diff first (Recommended)' - nothing is committed
   - 'Commit now' - runs `alfred-habits-commit-checkpoint` in full, then commits
   - '<Another real fork>' - a deferred item or a follow-up, when one exists
   ```

   A picked commit runs `alfred-habits-commit-checkpoint` whole - never a shortcut because the
   review already ran.

## Do not

- Never pass a stop without the user's explicit word, and never approve the plan yourself.
- Never end a stop's turn without its AskUserQuestion (or the plain-text option list).
- Never dispatch a seat the user did not choose at a stop - dispatch is explicit-only.
- Never keep cycle state only in chat: a stamp not in the plan file does not exist.
