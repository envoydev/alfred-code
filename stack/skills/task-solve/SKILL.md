---
name: task-solve
description: "Use to run a task through the gated single-chat vertical - 'run the task cycle', 'build this with approvals', 'with my sign-off'. Not a one-line edit."
disable-model-invocation: true
---

# Solve Task - the gated single-chat vertical

One task/feature/bug, six steps, and the user holds the gate between every two. The four twin
skills do the work; this skill owns the chain, the stops, the mode choices, and the state that
survives a compaction or a fresh session. It never designs, builds, or reviews anything itself.
The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a
run-time load.

## When to use

- The whole single-chat vertical with a hard user gate between every step: design -> plan audit -> user approval + build-mode choice -> build -> build review (skippable) -> done-gate.
- Not the dispatched multi-agent flow (task-solve-cross), not greenfield, and not a one-line edit.

## State - the plan file is truth and cursor

- **The plan file** (`<docs-path>/work/plans/<feature>.md`) is the durable truth: the tasks, every stamp this cycle adds (`Gated` block, `Approved` +
  build mode, `Conformance` verdict or `skipped`, `Completed`), per-task status + evidence - and its
  `Resume:` line is the one cursor (current step, chosen modes, next task), rewritten at EVERY stop and
  task tick. On any conflict with memory or the chat, the file wins.
- **Handoff notes** (the handoff bus, `node .claude/hooks/handoff.js`) are the seats' hand-offs in agents mode
  (`<feature>/<contract_version>/<seat>/<task>`), never a second cursor.

**On invocation, resume before starting:** `node .claude/hooks/handoff.js left <feature>` (the run's seat notes, by name;
`list <feature>/<contract_version>` prints them), and read the plan file's stamps and `Resume:` line. A cycle mid-flight resumes at its cursor - never restart a step whose stamp says it
already passed. A resume paste that lands in a chat still holding the earlier cycle's conversation (no
`/clear` between) is answered with one line - `/clear first, then paste it again` - and nothing else.
A NEW cycle starting after a finished one in this same session offers the fresh-session hand-off
in its first ask, after the in-session option. A cycle mid-build looks like:

```
plan <docs-path>/work/plans/csv.md:
  Gated: passed | Approved: 2026-07-16 - mode session
  Resume: step 4 BUILD - mode session - next task 2
  task 1 DONE (dotnet test green - 4 passed) | task 2 IN_PROGRESS
```

## The stop contract

A stop IS one AskUserQuestion call: report THREE named fields, then put the next move through the
AskUserQuestion tool - EVERY stop, the plain step-done ones included.

```
Result:    <one line> - <the artifact path>
Progress:  <N> of <M> steps
Leftovers: <what this run started and did not finish | none>
```

`none` is an answer, an omitted line is not; Markdown-bold (`**Result:**`) counts, a status table in
place of the names does not.

**Every ask marks exactly one option `(Recommended)`, listed first** - the move this stop's rule
recommends, the reason in its description. An ask with no mark is malformed: rebuild it before
sending. A multi-select question marks one option too - or asks each judgment item as its own yes/no
question; every option marked reads as a blanket approval. The templates below mark the usual pick;
a stop's own rule may move the mark, never add a second. A step-done stop:

```ask
<Step> done - <artifact path>. Continue to <next step>: <the one reason it is next>.
- '<Next step> (Recommended)' - <what it does, in one line>
- 'Route back to <step>' - <the gap or finding that sends it back>
- 'Resume in a fresh session' - required past the fresh-session trigger below
```
There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete; free text comes through the built-in Other. Where the harness has no such tool, list the same options in plain
text and END THE TURN.

**The fresh-session resume.** A fresh session (`/clear`) resumes from the plan file alone, with
zero re-work. Once the cycle has crossed the install's
fresh-session trigger (400,000 tokens on a window of 1M or more, 280,000 on one of 300k up to 1M, 180,000 on any other), spans hours, or resumes after a 2h+ idle gap, the fresh-session resume IS one of the next ask's
options - every ask until it is taken or the cycle closes. Below all three (a new cycle's first ask and the compaction stop aside), no ask
carries it and no resume block prints unless the user asks; hours and gaps are the hook's clock, never your guess.
The stop-contract hook injects the two measured numbers (this session's carry per message, a fresh one's cold floor): quote THIS stop's, or say they are unmeasured.
Mark the fresh option only when a hook's fresh-session text in this session says a fresh session pays back, and then it goes first, the in-session option after it unmarked; on Claude Code the stop-contract hook drops it where one does not, and when that leaves one option it refuses the ask - then take the option it names.
Check the trigger before each ask, never from memory. And HONOR the answer: when the user picks it, the turn ENDS with this
block, after the answer - no new work in this chat. The fence holds the command alone: the plan's `Resume:`
line holds the step.

````
**Resume in a fresh session** - in <the project root>, type `/clear`, then paste and send:
```text
/task-solve <plan file>
```
Next: <its first move> -> <the steps left>.
````

**Autonomy waiver (AUTO).** When the user explicitly asks for a no-stops run ('run all
recommended without asking me'), never self-authorize silently - write `<data root>/state/approvals/APPROVAL`
with first line `AUTO - "<their words, verbatim>"`, say in one line that stops are waived under it, and take each stop's recommended option; the
pre-commit checkpoint and its receipt still apply. A session past the trigger, or one that already closed a cycle, first puts ONE ask - 'Start AUTO here (Recommended)', then the fresh-session resume - and AUTO starts after its answer. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<data root>/state/approvals/APPROVAL` with the Write tool. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. `references/step-mechanics.md` holds the rest.

## Size first

State the size in ONE line before anything else - `Size: <trivial|small|standard|cross> - <the
signal that decided it>`, never below the `size floor:` the full-spec check prints (run it first, on
every size) - then run only that row's steps; it rides the first stop's `Result:`, `Spec:` beside it.
The size can be raised mid-run, never lowered - re-checked before a trivial or small close
(`references/full-spec.md`); a small close's `Result:` carries `review: <reviewer> - <its verdict>`.

| Size | Signals | Steps that run |
|---|---|---|
| trivial | one file, no new dependency, no behaviour a test would see (typo, comment, format, rename inside a file) | edit -> scoped check -> close. No design, no audit, no stop |
| small | up to 3 files in one domain, no new dependency, no public contract touched | plan inline -> build -> `task-verify-code` inline, no ask -> `habits-done-gate` -> close. One stop, the close |
| standard | anything else in one domain | the full gated vertical below |
| cross | more than one domain | the cross-domain orchestrator (`/task-solve-cross`, the user's command) |

Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## Full spec - design and audit as one step

On `standard`, the same check decides this step. A FULL spec names the surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests or acceptance criteria). A request that misses any item, spans more than one stack, or touches an auth, secret or payment path (access, visibility, ownership and personal data count) keeps every gate below, and so does any doubt. `scripts/spec-check.js` reads the request for all five; state its verdict in one line, `Spec: <full|not full> - <path> - <its reason>`. Run it by the lookup in `references/full-spec.md`.

Its `path: gated` is final. Its `path: merged` you may raise to gated, never lower.

On `path: merged`, steps 1 and 2 are ONE step, run by `references/full-spec.md`. Step 3's read and its `habits-execution-strategy` load come first (`mechanics: read` in `Result:`), then the audit's eight-field block printed as stamped into the plan - never the bare verdict - then ONE approval ask in place of step 3's:

```ask
Full spec - designed and audited in one step (<the Passes: line>; <the Gated: verdict>). Build it as planned <in this session | through the seats>: <the mode-fit reason>.
- 'Build as planned - in this session (Recommended)' - <why the tasks fit one chat>
- 'Build as planned - dispatch the agent seats' - <independent tasks that build in parallel>
- 'Not yet - changes needed' - edit the plan, or I ask what to change
```

The stamps are step 2's and step 3's (`Gated: passed`, `Approved: <date> - mode <session|agents>`), and the mark moves to the seats option on step 3's mode-fit rule.

## The steps

Each step that names a skill INVOKES it via the Skill tool - again on every new cycle in the same
chat, even when an earlier cycle loaded it. One exception: a capture named in a
close-out line (step 6) is a POINTER for the user to type, never a call this run makes.

1. **DESIGN** - run `task-design`, with `habits-clarify` loaded first. It writes the plan file -
   the artifact, not the chat - with its design rules settled IN it, so step 5 reviews against a plan that already decided them. *Stop* -
   none on a full spec, where step 2 follows in the same step (above).
2. **GATE** - run `task-verify-plan` over the plan file in the mode step 1 ran - no mode ask. It
   stamps its eight-field block into the plan: `Gated: passed`; `passed - <N> fixes applied` for the
   non-judgment fixes it landed in this step, each named in the stop's `Result:` line; or the gaps,
   which route back to step 1 on the user's word. A `judgment` item is never applied in-step - each
   gets its own ask:

   ```ask
   Audit judgment: <the item>. Keep or apply?
   - 'Keep the plan as written (Recommended)' - the plan stands
   - 'Apply it to the plan' - <the audit's reason>
   ```

   A declined audit is stamped `Gated: skipped by user - <their words>` - never
   blank, never a faked pass. *Stop* - except on a pass with no open item, where step 3's approval
   ask is this stop too ('Not yet' is the route-back).
3. **APPROVE** - Read `references/step-mechanics.md` now - this ask's mode-fit rule and the
   mechanics of steps 4-6 are its content, not homework; this stop's `Result:` line carries `mechanics: read` as the receipt. Then load
   `habits-execution-strategy` (the Skill tool); its `Execution:` line is the
   mode-fit reason. Then present the gated plan and put the gate through ONE question whose
   options each NAME the mode:

   ```ask
   The plan is gated. Build it <in this session | through the seats>: <the mode-fit reason>.
   - 'Approve - build in this session (Recommended)' - <why the tasks fit one chat>
   - 'Approve - dispatch the agent seats' - <independent tasks that build in parallel>
   - 'Not yet - changes needed' - edit the plan, or I ask what to change
   ```

   The mark moves to the seats option when the mode-fit rule picks it for THIS plan. Approval and mode arrive as one answer; a typed Other answer that
   omits the mode is re-asked, never defaulted (a mode the invocation named leaves only approve /
   not-yet - restate it). Stamp `Approved: <date> - mode <session|agents>` into the plan file, quoting
   the selected answer as the approval words - nothing builds without it.
4. **BUILD** - per the approved mode:
   - *session*: run `task-implement` - it marks, ticks and resumes each task in the plan file.
   - *agents*: fan the task cards out to the matching `<stack>-implementer` seats, each dispatched
     exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), by the
     step mechanics' dispatch rules - the approval stamp first, the contract version and the card's
     docs anchors in every brief, no isolation, no `model:` override.
   Both modes build to the step mechanics' bar, its build-time stop list included. State what blocks
   and what is done, then ONE ask - never 'retry the same command' or 'you run it':

   ```ask
   <What blocks task N>. <The in-session route> finishes it here - the task cannot close without it.
   - 'Re-scope around it - <the in-session route> (Recommended)' - <what the route does, one line>
   - 'Drop the blocked part and close on the rest' - <what stays unbuilt>
   - 'Wait for the blocker to clear' - the run stops here until you say go
   ```

   The harness compacting the context mid-build is a stop too (under AUTO, one line, then continue):

   ```ask
   Context compacted during task <N>; the plan file holds every tick. Fresh: <the cold floor>, here: <carry>.
   - 'Continue the build here (Recommended)' - on the compacted summary
   - 'Resume in a fresh session' - the resume block ends this turn; this chat stops here
   ```

   *Stop* at the build's end - and this stop chooses the reviewer for step 5. Its first sentence is
   the gate's own verdict line, quoted; a red the run root-caused outside the diff is quoted red,
   its cause named, never called green:

   ```ask
   <The gate's verdict line, quoted>. Review it <inline | through the seat>: <the reviewer-fit reason>.
   - 'task-verify-code in-session (Recommended)' - no dispatch, stays in this context
   - 'The <stack>-verifier seat' - isolated eyes, frontmatter model unless you name one
   - 'Skip - straight to the done-gate' - stamped as skipped, never the recommendation
   ```

   The mark moves to the seat when the reviewer-fit rule picks it for the assembled diff.
5. **CONFORMANCE** (unless skipped - a skip is stamped `Conformance: skipped by user`) - INVOKE the reviewer chosen at the step-4 stop, and
   re-review each punch-list fix, by the step mechanics' conformance rules. Stamp
   `Conformance: <verdict> - <reviewer>, <the pass that cleared the last fix delta>`; the stop's
   `Result:` carries the review's named fields as it emitted them. *Stop.*
6. **CLOSE** - apply any fixes the step-5 review handed back, then the done gate
   (load `habits-done-gate` - each acceptance criterion, and each Verify or Done-when bullet of a
   card the ask cited, demonstrated by a run this session, quoted). Stamp `Completed: <date>` with the per-task evidence table - it
   closes this plan file - and name the `## Decisions` ledger by its entry count, never re-pasted. Purge the notes - `node .claude/hooks/handoff.js purge <feature>` - then the purge count (`references/step-mechanics.md`).
   The close stop's `Result:` line carries the receipts - `Completed <date>, notes purged: <names|none>` -
   plus `Deviations: <each Decisions entry that departs from the Asked: words, one apiece | none>`,
   under AUTO the user's first sight of them.
   *Stop* - this stop is where the close-out decisions live: anything PENDING (an uncommitted diff, an
   unpushed commit, a deferred item, a cross-repo follow-up) goes into the ask; only a cycle with nothing
   pending ends on the report alone. An uncommitted diff waits for the user's pick (`GIT-PREFERENCES.md`):

   ```ask
   The feature is done and verified; the diff is uncommitted. Commit it on this machine?
   - 'Commit now (Recommended)' - runs `habits-commit-checkpoint` in full, then commits
   - 'Hold - review the diff first' - nothing is committed; the diff stays as it is
   ```

   A deferred item or follow-up is a SECOND question in the same AskUserQuestion call, never an
   option beside the diff's:

   ```ask
   Next: <the deferred item or follow-up>. It opens a NEW cycle in a NEW plan file.
   - 'Start it here (Recommended)' - a new cycle in this chat, from step 1
   - 'Leave it for later' - named in Leftovers
   - 'Start it in a fresh session' - the resume block ends this turn; this context stays behind
   ```

   An unpushed commit is its own question too (several branches: the merge order):

   ```ask
   <sha> on <branch> (<N> commits) is not pushed to <remote><; merge <A> before <B> - why>.
   - 'Hold - push later (Recommended)' - nothing leaves this machine
   - 'Push now' - the checkpoint's publish half takes this answer as its confirmation
   ```

   A picked commit runs the checkpoint whole, formatter included.
   New scope arriving in-chat after `Completed:` is a NEW cycle in a NEW plan file (a stamped file
   is a record, never appended to) - re-enter step 1, or state in one `ungated: <why>` line that the
   work runs outside the cycle; never build it on a casual 'yes, add it'. A change a sibling repo must
   follow is handed off as a FILE in THIS repo - a task card under `<docs-path>/work/cross-project-tasks/`
   - and printed as a paste-ready block, by the step mechanics' hand-off rules.
   **Doc-drift awareness** - one line at most in the close report, never auto-run, by the surface
   list in `references/step-mechanics.md`.

## Do not

- Never pass a stop without the user's explicit word, and never approve the plan yourself - the
  APPROVE stamp records the user's decision, not yours; an answer that names no build mode
  approves nothing.
- Never dispatch a seat the user did not choose at a stop - dispatch is explicit-only house-wide.
- Never keep cycle state only in chat or a note: a stamp, tick or cursor not in the plan file does
  not exist.
- Never re-run a stamped step on resume; pick up at the cursor.
