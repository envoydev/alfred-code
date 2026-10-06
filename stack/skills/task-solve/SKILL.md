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

## State - two layers, split by durability

- **The plan file** (`<docs-path>/plans/<feature>.md`) is the durable truth: the tasks, every stamp this cycle adds (`Gated`, `Approved` +
  build mode, `Conformance` verdict or `skipped`, `Completed`), per-task status + evidence. On any
  conflict with memory or the chat, the file wins.
- **The navigation server cycle note** (`write_memory` named `<feature>/cycle`) is the working cursor:
  current step, chosen modes, resume pointer (plan path + next task). Update it at EVERY stop and
  after every task tick. Local and disposable - everything essential is in the plan file.

**On invocation, resume before starting:** `list_memories` with `topic: '<feature>'` -> `read_memory` the feature's cycle
note (or read `<data root>/serena/memories/<feature>/cycle.md` - its content is the contract; a pre-2.1.6 one is
`<feature>__cycle.md`), and read the plan file's stamps. A cycle mid-flight resumes at its cursor - never restart a
step whose stamp says it already passed. A NEW cycle starting after a finished one in this same
session recommends the fresh-session hand-off in its first ask. A cycle mid-build looks like:

```
plan <docs-path>/plans/csv-export.md:
  Gated: passed | Approved: 2026-07-16 - mode session
  task 1 DONE (dotnet test green - 4 passed) | task 2 IN_PROGRESS
cycle note 'csv-export/cycle': step 4 BUILD - resume at task 2, mode session
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
place of the names does not. The stop-contract hook names a missing field.

**Every ask marks exactly one option `(Recommended)`, listed first** - the move this stop's rule
recommends, the reason in its description. An ask with no mark is malformed: rebuild it before
sending. The templates below mark the usual pick; a stop's own rule may move the mark, never add a
second. A step-done stop:

```ask
<Step> done - <artifact path>. Continue to <next step>: <the one reason it is next>.
- '<Next step> (Recommended)' - <what it does, in one line>
- 'Route back to <step>' - <the gap or finding that sends it back>
- 'Resume in a fresh session' - required past the fresh-session trigger below
```
There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete (the next step named, the route-back, the fresh-session resume, a conflict's real
resolutions); free text comes through the built-in Other. Where the harness has no such tool, list the same options in plain
text and END THE TURN. The user may interrupt the question to switch model or effort, paste context
or edit the plan file, then answer.

**The fresh-session resume.** A stop is the cheap point to run the next step in a fresh session
(`/clear`): resume needs only the plan file + cycle note, and restarts at 21.5-59.4% of the carried context with zero
re-work - state those two absolute numbers to the user, never a ratio. Once the cycle has crossed the install's
fresh-session trigger for its context window (150,000 tokens on a 200k window, 400,000 on a 1M one, 300,000 on
any other window), spans hours, or resumes after an idle gap, the fresh-session resume IS one of the next ask's
options - every ask until it is taken or the cycle closes. On those conditions the stop-contract hook injects the
two measured numbers (this session's carry per message, a fresh one's cold floor): quote them, or say they are unmeasured.
And HONOR the answer: when the user picks it, the turn ends with a short ack plus the paste-ready resume block -
no 'one more step', no new work in this chat. This is a CONSTRUCTION check, not a memory: before emitting any
stop's AskUserQuestion, ask 'has this cycle crossed the trigger?' - if yes and the option list has no
fresh-session entry, rebuild it. The selected answer is the go; silence is not, and a stop that only narrates is not a stop.

**Autonomy waiver (AUTO).** When the user explicitly asks for a no-stops run ('run all
recommended without asking me'), never self-authorize silently - write `<docs-path>/flow/APPROVAL`
with first line `AUTO - "<their words, verbatim>"`, say in one line that stops are waived under it, and take each stop's recommended option; the
pre-commit checkpoint and its receipt still apply. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. `references/step-mechanics.md` holds the rest: the write routes, a refused write, and the AUTO stamp's lifetime across steps 4-6.

## Size first

State the size in ONE line before anything else - `Size: <trivial|small|standard|cross> - <the
signal that decided it>` - then run only that row's steps. The size can be raised mid-run, never
lowered.

| Size | Signals | Steps that run |
|---|---|---|
| trivial | one file, no new dependency, no behaviour a test would see (typo, comment, format, rename inside a file) | edit -> scoped check -> close. No design, no audit, no stop |
| small | up to 3 files in one domain, no new dependency, no public contract touched | plan inline -> build -> verifier -> close. One stop, the close |
| standard | anything else in one domain | the full gated vertical below |
| cross | more than one domain | the cross-domain orchestrator (`/task-solve-cross`, the user's command) |

Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## Full spec - design and audit as one step

On `standard`, check the request before step 1. A FULL spec names the surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests or acceptance criteria). A request that misses any item, spans more than one stack, or touches an auth, secret or payment path (access, visibility, ownership and personal data count) keeps every gate below, and so does any doubt. `scripts/spec-check.js` reads the request for all five; state its verdict in one line, `Spec: <full|not full> - <path> - <its reason>`:

```bash
SPEC=.claude/skills/task-solve/scripts/spec-check.js
[ -f "$SPEC" ] || SPEC=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/*; do
  f="$d/stack/skills/task-solve/scripts/spec-check.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SPEC" ]; then node "$SPEC" <<'REQUEST'
<the user's request, verbatim>
REQUEST
else echo 'path: gated - spec-check not found'; fi
```

Its `path: gated` is final. Its `path: merged` you may raise to gated, never lower.

On `path: merged`, steps 1 and 2 are ONE step: the design and the plan audit both in this session (neither twin asks its mode), no stop between them. A gap the audit finds that the spec settles is fixed in the plan in the same step and named in the ask; a gap only the user can settle stamps the gaps and takes step 2's stop. Step 3's read comes first (`mechanics: read` in `Result:`), then ONE approval ask in place of step 3's:

```ask
Full spec - designed and audited in one step (<the Gated: verdict>). Build it as planned <in this session | through the seats>: <the mode-fit reason>.
- 'Build as planned - in this session (Recommended)' - <why the tasks fit one chat>
- 'Build as planned - dispatch the agent seats' - <independent tasks that build in parallel>
- 'Not yet - changes needed' - edit the plan, or say what changes in Other
```

The stamps are step 2's and step 3's (`Gated: passed`, `Approved: <date> - mode <session|agents>`), and the mark moves to the seats option on step 3's mode-fit rule.

## The steps

Each step that names a skill INVOKES it via the Skill tool - and re-invokes it for every new
cycle in the same chat, even when an earlier cycle loaded it. One exception: a capture named in a
close-out line (step 6) is a POINTER for the user to type, never a call this run makes.

1. **DESIGN** - run `task-design`, with `habits-clarify` loaded first. It writes the plan file -
   the artifact, not the chat - with its design rules settled IN it (seams, each card's `log_points`,
   the `## Decisions` ledger), so step 5 reviews against a plan that already decided them. *Stop* -
   none on a full spec, where step 2 follows in the same step (above).
2. **GATE** - run `task-verify-plan` over the plan file. It stamps `Gated: passed` or the gaps,
   which route back to step 1 on the user's word. A declined audit is stamped `Gated: skipped by user
   - <their words>` - never blank, never a faked pass. *Stop.*
3. **APPROVE** - Read `references/step-mechanics.md` now - the mode-fit rule for this ask, the
   build bar, the step-4 reviewer-fit rule and step 6's doc-drift surfaces are its content, not
   homework; this stop's `Result:` line carries `mechanics: read` as the receipt. Then present the
   gated plan and put the gate through ONE question whose options each NAME the mode:

   ```ask
   The plan is gated. Build it <in this session | through the seats>: <the mode-fit reason>.
   - 'Approve - build in this session (Recommended)' - <why the tasks fit one chat>
   - 'Approve - dispatch the agent seats' - <independent tasks that build in parallel>
   - 'Not yet - changes needed' - edit the plan, or say what changes in Other
   ```

   The mark moves to the seats option when the mode-fit rule picks it for THIS plan - a fixed
   default is not a recommendation. Approval and mode arrive as one answer; a typed Other answer that
   omits the mode is re-asked, never defaulted (a mode the invocation named leaves only approve /
   not-yet - restate it). Stamp `Approved: <date> - mode <session|agents>` into the plan file, quoting
   the selected answer as the approval words - nothing builds without it. Agents mode exists only
   where subagent dispatch is available; otherwise offer session only and say so.
4. **BUILD** - per the approved mode:
   - *session*: run `task-implement` - it marks, ticks and resumes each task in the plan file.
   - *agents*: fan the plan's task cards out to the matching `<stack>-implementer` seats, each
     dispatched exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries
     it) - a flat fan-out, the main session the only orchestrator. Write the approval gate file first,
     quoting this step's approval verbatim (the dispatch hook blocks an unstamped implementer), and
     DELETE it when the fan-out completes, before the step-5 stop - a live stamp can authorize an
     unrelated dispatch for up to 8h. A red build/test routes per the
     repair-agent rules; tick the same plan file per task as reports land. MINT the run's contract
     version - `<the plan's Approved: date>-<plan slug>` - and put it in EVERY dispatch prompt
     verbatim, with the seat's memory-handoff line:
     `mcp__plugin_alfred-navigation_alfred-navigation__write_memory('<feature>/<contract_version>/<seat>/<task>', ...)`. Each seat's green gate
     stays fast - build + fast tests, never integration replays or another minutes-long run; the
     slow full run happens once, in this session, at the step-5 review / step-6 done-gate.
   Both modes build to the step mechanics' bar, and the plan's `## Decisions` ledger grows as they
   land. A mid-build how-to-build question is a protocol violation. Build-time stops are for what the
   BUILD cannot decide - scope beyond the plan, a decision the plan left open that the code now
   forces, an EXTERNAL blocker (a dependency down, a credential missing, a locked file). A tool the
   environment blocks is not yet a blocker: `task-implement`'s in-session route comes first
   ('When the plan meets reality'). State what blocks, what is done and what is not, then ONE ask:

   ```ask
   <What blocks task N>. <The in-session route> finishes it here - the task cannot close without it.
   - 'Re-scope around it - <the in-session route> (Recommended)' - <what the route does, one line>
   - 'Drop the blocked part and close on the rest' - <what stays unbuilt>
   - 'Wait for the blocker to clear' - the run stops here until you say go
   ```

   Never offer 'retry the same command' or 'you run it' - nobody on the other side of a scripted
   run can.
   *Stop* - and this stop chooses the reviewer for step 5:

   ```ask
   The build is green. Review it <inline | through the seat>: <the reviewer-fit reason>.
   - 'task-verify-code in-session (Recommended)' - no dispatch, stays in this context
   - 'The <stack>-verifier seat' - isolated eyes, frontmatter model unless you name one
   - 'Skip - straight to the done-gate' - stamped as skipped, never the recommendation
   ```

   The mark moves to the seat when the reviewer-fit rule picks it for the assembled diff.
5. **CONFORMANCE** (unless skipped - a skip is stamped `Conformance: skipped by user`) - INVOKE the reviewer chosen at the step-4 stop: a Skill tool call on
   `task-verify-code`, or an Agent dispatch of the seat - reviewing from memory of an earlier
   load is not running it, and a COMMIT-GATE receipt may only name a review that ran. Point it at the
   plan file - its task cards and `## Decisions` ledger. The protocol is `task-verify-code`'s;
   the `<stack>-verifier` seat runs the same one dispatched.
   Deviations and findings become a punch list routed back to step 4 - and the fix delta gets the
   SAME reviewer again before anything is stamped `Completed`: a punch-list fix is unreviewed code.
   Stamp the verdict. *Stop.*
6. **CLOSE** - apply any fixes the step-5 review handed back, then the done gate
   (load `habits-done-gate` - each acceptance criterion demonstrated by a run this session,
   quoted). Stamp `Completed: <date>` with the per-task evidence table, and name the `## Decisions`
   ledger by its entry count, never re-pasted. The stamp CLOSES this plan file: print one line with it
   - `Completed - the next scope starts a NEW plan file, not this one`. Purge the notes - `mcp__plugin_alfred-navigation_alfred-navigation__delete_memory` each
   note under `topic: '<feature>'` (cycle and seat notes) plus a pre-2.1.6 run's flat `<feature>__*` - stating
   `memories purged: <names|none>` in the close report, then the purge count (`references/step-mechanics.md`). *Stop* - and this stop is where the
   close-out decisions live: anything PENDING (an uncommitted diff, an unpushed commit, a deferred
   item, a cross-repo follow-up) goes into the ask's options; only a cycle with nothing pending
   ends on the report alone. An uncommitted diff is held for the user's review - a commit waits
   for their word (`alfred-git.md`):

   ```ask
   The feature is done and verified; the diff is uncommitted. Hold it for your review first.
   - 'Hold - review the diff first (Recommended)' - nothing is committed; the diff stays as it is
   - 'Commit now' - runs `habits-commit-checkpoint` in full, then commits
   - '<Another real fork>' - a deferred item or a cross-repo follow-up, when one exists
   ```

   A picked commit runs `habits-commit-checkpoint` whole - formatter, review, security
   half, receipt - never a shortcut because the review already ran.
   New scope arriving in-chat after `Completed:` is a NEW cycle in a NEW plan file (a stamped file
   is a record) - re-enter step 1, or say plainly that the work is running ungated and why; never
   build it on a casual 'yes, add it'. A change a sibling repo must follow is handed off as a FILE in
   THIS repo - a task card under `<docs-path>/cross-project-tasks/` (the cross-project write guard
   blocks the sibling's tree) or a navigation-server note - after reading the sibling's actual source.
   **Doc-drift awareness** - one line at most in the close report, never auto-run: a change on an
   architecture-critical surface (listed in `references/step-mechanics.md`) names
   `/capture-architecture` (diff-scoped, cheap); substantial code + tests with the coverage doc
   absent or stamped before the change names `/capture-test-coverage`.

## Do not

- Never pass a stop without the user's explicit word, and never approve the plan yourself - the
  APPROVE stamp records the user's decision, not yours; an answer that names no build mode
  approves nothing.
- Never end a stop's turn without its AskUserQuestion (or the plain-text fallback's option
  list).
- Never dispatch a seat the user did not choose at a stop - dispatch is explicit-only house-wide.
- Never keep cycle state only in chat: a stamp or tick that is not in the plan file does not
  exist. The navigation-server note is a cursor, never the truth.
- Never re-run a stamped step on resume; pick up at the cursor.
