---
name: loop-test-coverage
description: "Use when asked to raise the test coverage or run the coverage loop. Manual, /-only. Not for a measure-only run, code polish or architecture."
disable-model-invocation: true
---

# Test Coverage Loop - Measure, Triage, Fix (Deliberate)

You drive a deliberate loop that raises a project's test coverage to its requirement: run the capture, work the weak points by tier, reconcile the docs, loop until the requirement holds or the loop plateaus. Coverage lives OUTSIDE the build flows - implementers write each task's tests as part of done, but nothing in a build run measures coverage - so this loop is the user-controlled cadence where the accumulated gap gets worked. The named tradeoff of that model: a feature can land below the requirement between runs - this loop is where it catches up. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- The deliberate coverage analyze-triage-fix loop: it runs the capture-test-coverage capture, works the coverage doc's weak points by tier - structural gaps flagged for a user decision, never auto-applied - re-runs the capture to reconcile the docs, and loops until the requirement holds or the loop plateaus.
- Not for a measure-only run with no fixes (/capture-test-coverage alone), a code-quality polish (loop-quality), or an architecture / structure pass (loop-architecture-quality).

## Execution modes
When dispatch is available, ask ONE question before ANALYZE, via AskUserQuestion - work the fixes in the current session (INLINE), or dispatch the stack seats (DELEGATED)? - one option marked `(Recommended)` and listed first, the one the `habits-execution-strategy` verdict picks (`parallel seats` marks the seats), the reason in its description - then hold the answer for the run; no dispatch capability (a Cursor session, a non-stack project) is INLINE without asking. INLINE works every fix yourself in this session. DELEGATED dispatches each test-writing brief to the matching `<stack>-implementer` seat, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), up to 3 at once, routes a red build/test to the matching resolver, and runs a substantial refactor through the stack's designer -> implementers -> verifier vertical (this skill's own `references/domain-trio-protocol.md`). In DELEGATED mode, the mode ask's answer IS the dispatch consent for small test-writing briefs: write the `<docs-path>/flow/APPROVAL` stamp (`APPROVED small-tier - "<the answer, verbatim>"`) the moment that answer lands, and rewrite it as substantial-tier plan approvals arrive - the dispatch guard is deliberately tier-blind, so an unstamped small-brief dispatch just bounces. A surface with no matching seat runs INLINE regardless. In BOTH modes the instrumented run stays the capture's, in the main session - a coverage run never enters a dispatch brief (seat gates are fast; the capture owns the measurement).

## The loop

### 1. ANALYZE
Run the `capture-test-coverage` capture by INVOKING it - the Skill tool, never its protocol replayed from memory (where no Skill tool exists, Read its `SKILL.md` from the installed skills directory and follow it in-session). A Skill call the fresh-session guard blocks is the gate working, not a fault: put the choice through AskUserQuestion - 'Resume in a fresh session (Recommended)', ending this turn with the RESUME BLOCK / 'Continue here' - and on 'continue', re-issue the same Skill call: the answered offer lets it through until the context grows 1.5x past it. The load is step zero of ANALYZE, not optional homework: a round that has not loaded the capture this session has not run it, whatever it measured - unloaded rounds hand-roll their own aggregation, so no two rounds' numbers are comparable, and the class-level aggregation the protocol looks past hides uncovered lines an ad-hoc dig only finds by luck. It owns the detection, the instrumented runs, and the judgment, and it writes `<docs-path>/test-coverage/COVERAGE.md`. That doc is this loop's work list: the weak points, each carrying a tier (the routing key) and a simplify-testing action. The requirement and exclusions come from the doc; changing either is a user decision recorded there, never a loop shortcut.

### 2. TRIAGE + FIX by tier
Confirm the green baseline (build + tests) first, then take the weak points in leverage order:

- **small** (missing tests on existing seams) - a scoped brief: the module, the uncovered symbols, the behavior each test must pin. Write them INLINE, or DELEGATED dispatch the stack's implementer with the brief - the brief states `memory: none` (a scoped test brief has no navigation-server hand-off; one that does hand a note names it literally, read side included - memory hygiene: `references/domain-trio-protocol.md`). Tests assert behavior - a test written to touch lines is gamed coverage, not progress.
- **substantial** (a testability refactor, or 'no test infrastructure') - designer-led with approval. 'No test infrastructure' goes FIRST when it is on the list - nothing else is measurable until a harness exists: propose the runner the stack's house testing skill records as its default (absent one, the framework's own documented default, cited), and on approval wire the runner + coverage output and land the first tests. Each substantial item runs four acts in order:
  1. **Plan it** - turn the simplify-testing action into a plan; a refactor for testability is still a refactor.
  2. **Get the user's approval before building** - present the plan, ask via AskUserQuestion - 'Approve and build (Recommended)' / 'Changes needed' (plain-text options where the harness lacks the tool).
  3. **Record the approving answer.** DELEGATED: write `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` - the selected answer IS those words (the dispatch hook blocks an unstamped implementer; delete the file when the run completes). Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate.
  4. **Build and gate it** - INLINE yourself, DELEGATED through the domain trio.
- **structural** - do NOT auto-apply. Present the gap, the reasoning, and the rework, then ask the decision via AskUserQuestion - 'Defer (Recommended)' / 'Apply - routes as substantial' / 'Decline', the reason in each option's description (plain-text options where the harness lacks the tool); declined -> flagged in the final report. **decline or defer adds the gap to this run's declined set** - an in-context list only, never written to a file: the same gap reappearing in the next round's fresh capture is checked against it and skipped without a second ask. A fresh session starts clean and may ask again.

Keep build and tests green across the round - a red routes to the matching resolver (DELEGATED) or is fixed inline before the next weak point.

A fix that rewrites or deletes an EXISTING spec flagged `red-check pending` (the capture digest's suite-quality label - the spec's name promises a behavior the audit says it never guards) runs the red-check FIRST: temporarily break that behavior and run the spec.

- **Still green** proves the flag: fix the spec and require RED against the same break before restoring.
- **Goes red** means a false positive: leave the spec and report the disproof in the round outcome, so the step-3 reconcile records `red-check: disproved <date>` on the entry (the doc is the capture's to write; later captures honor the recorded disproof instead of re-flagging).

The label has no other enforcement point - this step is it.

### 3. UPDATE DOCS
Re-run the capture: `<docs-path>/test-coverage/COVERAGE.md` and the raw results reconcile with what landed - closed weak points drop off, the numbers refresh, anything the fixes exposed is added. The doc is regenerated by the capture, never hand-edited here. COVERAGE.md is the only doc this loop maintains - `<docs-path>/quality/ASSESSMENT.md` is the findings capture's, reconciled at its own cadence, never touched from here.

### 4. LOOP or STOP
Decide off the reconciled numbers the step-3 capture just produced, not by eye - they are already in this context (re-read `<docs-path>/test-coverage/COVERAGE.md` only after a compaction or when the in-context picture is genuinely stale, never as a per-round habit). On a LOOP verdict, run the fresh-session ask (Bounded and honest) before the next round - the resume invocation names the rounds already consumed so the 3-round cap survives a resume. The round verdict line carries the ask's receipt - `next: fresh-session | continue - "<the user's answer, verbatim>"` - and that receipt can only come from the AskUserQuestion answer; a verdict line without it is an unfinished step 4:

- **SATISFIED** - every measured surface meets the requirement, and only user-declined structural items or recorded overrides remain.
- **PLATEAU** - the weak-point set equals the previous round's and none is now resolvable - stop rather than re-run identically.
- **CAPPED** - the improve-round cap is reached (see Bounded and honest).
- **BLOCKED** - only structural gaps remain and the user has not approved a rework.

Then the final report - one line per field, a table for the per-surface numbers (the close is an answer like any other and the answer-length hook blocks a wall of prose; tables are exempt): the outcome and round; per-surface coverage before -> after; each weak point resolved (tier + the change that closed it); the deferred items; the reconciled docs' state; the build + tests baseline at stop; and `memories purged: <names|none>`, fold-first (the trio reference's receipt, restated here because a loop round does not load that reference). When the report closes with uncommitted work and no next round queued, the commit decision goes through AskUserQuestion - 'Hold - review the diff first (Recommended)' / 'Commit now', which runs `habits-commit-checkpoint` whole - never a prose 'your call' bullet, which drifts unresolved while the uncommitted set grows. The same close names what this round's runs started and still have up - a Docker container or compose stack, seeded integration-test data, a background process - and puts tear-down-vs-keep through the same AskUserQuestion call (teardown recommended; started-nothing is said plainly, and what the round did not start is never touched).

## Example
INLINE, one round over a two-surface workspace:
1. **ANALYZE** - the capture writes COVERAGE.md: the .NET API at 84% vs 90% (two small weak points - uncovered error branches in `InvoiceService` - and one substantial: `PaymentGateway` news up its `HttpClient`, untestable), the Angular app at 91% - meets.
2. **TRIAGE + FIX** - green baseline confirmed. Small: write the four branch tests, suite green. Substantial: plan the seam (inject the handler), get approval, apply + test.
3. **UPDATE DOCS** - re-run the capture: the .NET surface reads 92%, the closed weak points drop off.
4. **LOOP or STOP** - every surface meets the requirement -> **SATISFIED**; report.

## Bounded and honest
- **Hard cap: 3 improve rounds** - each round re-runs the instrumented capture; do not loop chasing the last decimal.
- **Each round boundary is a fresh-session resume point** - the reconciled `<docs-path>/test-coverage/COVERAGE.md` is the handoff; carried-forward conversation (not tool output) is what a fresh session sheds. A step, not advice: at each LOOP decision, ask via AskUserQuestion - resume in a fresh session from the reconciled doc (recommended) vs continue here; on 'fresh', end the turn with this RESUME BLOCK and nothing else - the new session must be able to start from it alone, and the invocation names the rounds already consumed so the 3-round cap survives:

  ```text
  RESUME - loop-test-coverage
  Invocation: /loop-test-coverage <scope> - resumed round <N of 3> (rounds consumed: <list>)
  Read first: <docs-path>/test-coverage/COVERAGE.md - its ## Resume section RANGED, never the whole file - and the requirement and exclusions it records; then the coverage capture's own protocol (the Skill tool, or its SKILL.md from the installed skills directory where no Skill tool exists) - the ANALYZE step's protocol owner, which a fresh session has never read
  Remaining weak points, tier order:
    1. <surface - symbol> - <tier> - <the action, one line>
  ```
- The percentage is the proxy, pinned behavior is the goal: never pad with assertion-free tests, never weaken or delete an existing test (one exception: a spec the step-2 red-check just PROVED vacuous - the check exists to authorize exactly that rewrite or delete), never widen exclusions or lower the requirement to reach SATISFIED - those two belong to the user, recorded in the doc.
- A testability refactor stays behavior-preserving - the existing suite is green before and after - and the tier on each weak point is the routing authority: no silent upgrade of a small gap into a rewrite, no downgrade of a structural one past its approval gate.

## Rules
- The main session is the only orchestrator; the seats it dispatches carry no Agent tool, so the fan-out stays flat.
- The instrumented run never enters a seat's dispatch brief - measurement is the capture's, in the main session, in both modes.
- Implementers keep writing each task's tests in every build flow (the `habits-done-gate` bar) - this loop is the deliberate catch-up cadence, not a substitute for that.
- Keep this skill orchestration only: measurement judgment lives in the capture; build knowledge lives in the domain seats and house skills. A pure code-quality polish is `loop-quality`; architecture weaknesses are `loop-architecture-quality`'s.
