---
name: alfred-loop-quality
description: "Use when the user asks to run the quality loop, the code-quality loop or the loops pipeline - the deliberate analyze-triage-fix loop over the code, manual and /-only: each round recomputes the code-quality assessment against the project's own rules (the numbered prompts under the loops folder, the convention rules, the recorded code style) and works its fixable findings by tier. `staged` keeps the numbered-prompt pipeline, one stage at a time. Not for architecture restructuring (alfred-loop-architecture-quality), measuring or raising test coverage (the coverage capture and loop), an assessment with no fixes (alfred-capture-code-quality alone), or a single diff (alfred-task-verify-code or /security-review)."
disable-model-invocation: true
---

# Code Quality Loop - Analyze, Triage, Fix (Deliberate)

You drive a deliberate loop that improves a project's code against its own rules: each round the code-quality capture judges the code and recomputes `<docs-path>/quality/CODE-ASSESSMENT.md`, you work its fixable findings by tier, and you loop until they are resolved or the loop plateaus. The assessment is never yours to write or prune - the capture recomputes it fresh every round. It runs only when a user invokes it (`/alfred-loop-quality`), never automatically; the architecture counterpart is `alfred-loop-architecture-quality`. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

Best run in Claude Code, where you can dispatch the analysis and build seats and edit files across rounds. On a large codebase, scope it - point TARGET at one module or subtree per run. This skill carries NO `model` pin (the judgment runs in-session, in the capture): set the session to Opus with `/model` for the run and switch back at the final report. The run-start mode ask carries the check: when the session is not on Opus, the ask says so - the switch happens before any judgment is spent.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence - a project can carry the agent files on disk with no Agent tool to dispatch them, which is still INLINE. When dispatch is available, ask ONE question before ANALYZE, via AskUserQuestion - run the loop in the current session, or dispatch the stack seats? - then hold the answer for the run; the capture inherits it and never re-asks. No dispatch capability is INLINE without asking. Every AskUserQuestion below falls back to plain-text options where the harness lacks the tool.

- **DELEGATED** (the user chose agents) - the main session dispatches every seat - the capture's code-quality-analyzers, then an implementer for a small fix or the domain designer / implementers / verifier for a substantial one - never doing their work itself. Seats are always the NAMED domain seats, never a generic one; a surface with no matching installed seat is fixed INLINE and said so.
- **INLINE** (the user chose the current session - or forced: Cursor, a non-stack project, a scope too small to fan out) - the same steps in-session: the capture judges in-session, then you apply the fixable findings directly, smallest blast radius first, loading the convention skill of each file family you edit.
- **STAGED** (the pre-2.0.0 numbered-prompt run, kept for a project that relies on it) - each stage prompt runs in numeric order as its own review-fix loop to that prompt's bar, with no assessment and no tiers. Reached ONLY when the invocation names it (`/alfred-loop-quality staged [TARGET]`) or resumes a staged run (its RESUME BLOCK names `RUN-STATE.md`); then Read `references/staged-mode.md` and run it exactly as written - its own mode ask, stages, stage closes and final report - instead of everything below. The default run never switches into it on its own.

## The rule source - the loops folder
The numbered prompt files under `<docs-path>/loops/` are the rules the capture judges the code against - each stage prompt's bar is a rule. An existing folder is used exactly as it is - never rewrite or renumber a prompt, and never seed the starter set around a folder that already holds `.md` files, which are the user's. Missing or empty: Read `references/bootstrap.md` and seed the starter set silently before round 1's ANALYZE - a missing folder is never a reason to pause. The `0.`-numbered file is FIX discipline, not a rule: read it once, hold it for every fix, and fold it into every implementer brief; re-read it after a compaction or a resume.

## The loop

### 1. ANALYZE
Round 1 opens with the green baseline (build + tests, command-first) - a red one is fixed first through the matching resolver or recorded, so the round is measured against a green start - and records the sweep baseline: HEAD, or on a dirty tree the sha `git stash create` prints. The final anti-gaming sweep diffs against it.

Then the code-quality capture, a Skill call - `alfred-capture-code-quality`, which judges the code against the loops prompts, the convention rules and the recorded code style and recomputes `<docs-path>/quality/CODE-ASSESSMENT.md` fresh; it has no zero-drift shortcut, so it always runs in full. Hand it the run's mode and TARGET. A Skill call the fresh-session guard blocks is the gate working, not a fault: put the choice through AskUserQuestion (run it in a fresh session, recommended, ending this turn with the RESUME BLOCK; or continue here, following the capture's protocol in-session by reading its `SKILL.md`). Never retry a blocked call.

The capture's output is this loop's work list: the assessment's Must-fix findings - each with its rule, its file:line, its severity and its tier, the tier being the routing key; counts are outputs, never targets. The Worth-knowing and Deliberate-tradeoff buckets are left alone - never 'fix' a recorded choice - and a finding you decline this round goes on the in-run declined set (step 2) rather than being asked about again before this run ends.

### 2. TRIAGE + FIX by tier
Take the open findings in the assessment's rank order (severity first) with the green baseline confirmed, so a regression is visible. Every fix holds the fix discipline. Route each by its tier:

- **small** (a localized edit) - dispatch the matching domain implementer with the module's small findings batched into one scoped brief - shape in `references/loop-mechanics.md`; it states `memory: none` unless it hands a note, which it then names literally. An ambiguity the remediation leaves open is decided by the codebase's own precedent, never asked, and appended to `<docs-path>/loops/DECISIONS.md` with that precedent. Re-run build + tests.
- **substantial** (a designer-led multi-task change) - five steps in order, none of them optional:
  1. **Decompose** - dispatch the domain solution-designer to turn the remediation into a decomposition.
  2. **Gate the plan** - `alfred-task-verify-plan`, an actual Skill invocation, recording `plan_review: approved|waived`.
  3. **Get the user's approval on that plan before building** - never fan out against an unapproved plan. Present the plan and ask via AskUserQuestion: approve-and-build vs changes-needed, free text via Other.
  4. **Stamp the approval**, in four parts:
     - *Shape* - write `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"`; the selected answer IS those words. The dispatch hook blocks an unstamped implementer; delete the file when the run completes.
     - *Path* - Write the stamp at the ABSOLUTE path `$CLAUDE_PROJECT_DIR/<docs-path>/flow/APPROVAL` with the Write tool. `.claude/` is a protected path, so the first write in a session prompts: take the prompt's 'allow Claude to edit its own settings for this session' option. A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces.
     - *Ownership* - the stamp belongs to the session that dispatches, written when its own decision lands and deleted at its own close; an earlier session's leftover stamp is not consent.
     - *Refused* - if BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this fix inline) rather than retrying blind or dispatching around the gate.
  5. **Build and verify** - fan the tasks out to the domain implementers, then gate the assembled result with the domain verifier, looping its punch-list back. This is the domain-trio vertical (this skill's own `references/domain-trio-protocol.md`), dispatched directly.

  Re-tier only through the ask: when the designer's findings SHRINK the item ('this is actually small'), the re-tier still routes through an AskUserQuestion before any implementer dispatch - a self-declared downgrade that proceeds on the old small-tier stamp is the silent downgrade this tiering forbids.
- **structural** (a risky, cross-cutting rework) - do NOT auto-apply. Present the finding, its rule and the remediation, then ask the decision via AskUserQuestion - apply (routes as substantial) vs decline vs defer. **decline or defer adds the entry to this run's declined set** - an in-context list only, never written to a file: the same finding reappearing in the next round's fresh capture is checked against it and skipped without a second ask. A fresh session starts clean and may ask again - an undecided finding stays undecided until someone writes it to the decision log.

Keep the build and tests green across the round: after each fix batch, re-run them, and a red routes to the matching build- or test-failure resolver seat for that stack, where the project installed one, before the next finding. With no matching seat installed, fix the red in-session - never carry a red into the next finding.

### 3. LOOP or STOP
Read `references/loop-mechanics.md` now - the RESUME BLOCK shape and the final report's field rules are this step's gate; the report's `Mechanics` line is the receipt. Decide off the finding set the capture returned this round - it is already in this context; do not re-run the capture mid-decision just to re-read it. On a LOOP verdict, run the fresh-session ask (Bounded and honest) before the next round. The round verdict line carries the ask's receipt - `next: fresh-session | continue - "<the user's answer, verbatim>"` - and that receipt can only come from the AskUserQuestion answer. Decide off the set, not by eye:

- **SATISFIED** - no fixable (small/substantial) finding remains; only recorded tradeoffs and user-declined structural items are left.
- **PLATEAU** - the fixable-finding set equals the previous round's and none is now resolvable - stop rather than re-run identically.
- **CAPPED** - you reached the round cap (see Bounded and honest).
- **BLOCKED** - only structural findings remain and the user has not approved a rework - report and stop.

On STOP, when any fix shipped: run the final build + tests, then the anti-gaming sweep - Read `references/anti-gaming-sweep.md` and run its four commands against the sweep baseline, reading the cumulative diff for a gamed bar (a disabled or skipped test, a new warning suppression, a swallowed exception, a weakened assertion, a lowered threshold). Any hit is a BLOCKER: revert the shortcut, fix what it dodged, re-run the gate. Then reconcile ONCE: run the capture again so `<docs-path>/quality/CODE-ASSESSMENT.md` reflects the code as it now stands (this run's declined set still applies). When this session is already past the fresh-session trigger, the same fresh-session choice above applies before the capture runs. Substituting anything lighter goes through an AskUserQuestion first. A run that shipped nothing skips both. Then emit the final report with the fields `references/loop-mechanics.md` defines: **Outcome**, **Resolved**, **Deferred**, **Proposed decisions**, **Docs**, **Baseline**, **Anti-gaming**, **Memories** (`memories purged: <names|none>`, fold-first), **Next actions**, **Mechanics**.

When the report closes with uncommitted work and no next round queued, the commit decision goes through AskUserQuestion (commit now / hold) - never a prose 'your call' bullet. The same close names what this round's runs started and still have up - a Docker container or compose stack, seeded integration-test data, a background process - and puts tear-down-vs-keep through the same AskUserQuestion call (teardown recommended; started-nothing is said plainly, and what the round did not start is never touched).

## Example

DELEGATED, one run over `src/Orders/`, with the 1.x starter prompts in `loops/`:
1. **ANALYZE** - green baseline; the capture fans code-quality-analyzer out per module and writes three Must-fix findings: a **small** BLOCKER (a swallowed refund exception, `loops/2.code-quality.md`), a **small** MINOR (a vague `data` parameter, `loops/3.naming.md`), a **substantial** MAJOR (one handler class carrying three unrelated jobs).
2. **FIX by tier** - the two small findings go to the aspnet-implementer in one brief; the substantial one through the aspnet-solution-designer, the plan gate and the user's approval, then the implementers and the aspnet-verifier.
3. **LOOP or STOP** - the round-2 capture returns no fixable finding -> **SATISFIED**; the sweep is clean, the capture reconciles the doc, then the report.

## Bounded and honest
- **Hard cap: 3 improve rounds.** Do not loop indefinitely chasing the last debatable finding.
- **Each round boundary is a fresh-session resume point** - carried-forward conversation (not tool output) dominates session cost, and the loops folder plus a fresh capture is the handoff. A step, not advice: at each LOOP decision, ask via AskUserQuestion - resume in a fresh session (recommended) vs continue here, the fresh-session option ALWAYS one of the ask's options; on 'fresh', end the turn with the RESUME BLOCK shaped in `references/loop-mechanics.md` and nothing else.
- Never weaken, skip or delete a test or an assertion to make a finding look resolved - that is a new finding, not a fix, and the anti-gaming sweep exists to catch it.
- Make the smallest change that resolves each finding; a rewrite that introduces new findings makes the loop diverge.
- The tier is the routing authority - do not silently upgrade a small finding into a rewrite, or downgrade a structural one to sneak it past the approval gate.

## Rules
- The main session is the only orchestrator: every seat it dispatches - the capture's code-quality-analyzers, the domain designer / implementers / verifier / resolvers - carries no Agent tool, so the fan-out stays flat; analysis and fix are separate dispatches from here, never one nested one.
- Substantial and structural changes are gated on user approval before building; small localized fixes proceed. In DELEGATED mode, the mode ask's answer IS the dispatch consent for small-tier fixes: write the `<docs-path>/flow/APPROVAL` stamp (`APPROVED small-tier - "<the answer, verbatim>"`) the moment that answer lands, and rewrite it as substantial-tier approvals arrive - the dispatch guard is deliberately tier-blind, so an unstamped small-tier dispatch just bounces. On a RESUMED session no mode ask fires - the small-tier stamp then quotes the RESUME BLOCK's own mode line (`APPROVED small-tier - resumed round <N>, "<the block's mode line, verbatim>"`). The mode answer covers the WHOLE round - its fixes go to the seats, never inline under a DELEGATED answer.
- Keep this skill orchestration only. The rules live in the loops prompts and the convention skills, the judgment in the capture, the build knowledge in the domain seats.
