---
name: alfred-loop-test-coverage
description: "Use when the user asks to raise the test coverage or run the coverage loop - the deliberate coverage analyze-triage-fix loop. Manual, /-only. It runs the alfred-capture-test-coverage capture, works the coverage doc's weak points by tier - structural gaps flagged for a user decision, never auto-applied - re-runs the capture to reconcile the docs, and loops until the requirement holds or the loop plateaus. NOT for a measure-only run with no fixes (/alfred-capture-test-coverage alone), a code-quality polish (alfred-loop-quality), or an architecture / structure pass (alfred-loop-architecture-quality)."
disable-model-invocation: true
---

# Test Coverage Loop - Measure, Triage, Fix (Deliberate)

You drive a deliberate loop that raises a project's test coverage to its requirement: run the capture, work the weak points by tier, reconcile the docs, loop until the requirement holds or the loop plateaus. Build flows never measure coverage, so this is the user-controlled cadence where the gap gets worked. `references/loop-in-full.md` carries every step below with its reasons and measurements - read it on a first round.

## Execution modes
When dispatch is available, ask ONE question before ANALYZE - INLINE (every fix in this session) or DELEGATED (test-writing briefs to the `<stack>-implementer` seats, up to 3 at once; a red to the resolver; a substantial refactor through the domain trio, `references/domain-trio-protocol.md`) - and hold it; no dispatch is INLINE. In DELEGATED mode the answer IS the dispatch consent for small briefs: write `<docs-path>/flow/APPROVAL` as `APPROVED small-tier - "<the answer, verbatim>"` the moment it lands. The instrumented run stays the capture's, in the main session, in both modes.

## The loop

1. **ANALYZE** - INVOKE the `alfred-capture-test-coverage` capture (the Skill tool, never its protocol from memory) - step zero, every round. Its `<docs-path>/test-coverage/COVERAGE.md` is the work list: weak points with a tier and a simplify-testing action; the requirement and exclusions are the user's, recorded there.
2. **TRIAGE + FIX by tier**, green baseline first:
   - **small** - a scoped brief (module, uncovered symbols, the behavior each test pins, `memory: none`); tests assert behavior, never touch lines.
   - **substantial** - 'no test infrastructure' first (propose the house default runner). Each item: plan it; get the user's approval via AskUserQuestion; record it - DELEGATED writes `<docs-path>/flow/APPROVAL` with `APPROVED <plan id> - "<the user's words, verbatim>"`. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool; an earlier session's leftover stamp is not consent (the protected-path prompt and a refused write: the full reference); then build and gate it.
   - **structural** - never auto-applied: apply / decline / defer through AskUserQuestion.
   Keep build and tests green across the round. A fix touching a spec flagged `red-check pending` breaks that behavior first: still green proves the flag (fix the spec, require RED); red disproves it (leave the spec, report the disproof).
3. **UPDATE DOCS** - re-run the capture; COVERAGE.md is regenerated, never hand-edited. `ASSESSMENT.md` is never touched from here.
4. **LOOP or STOP** - off the reconciled numbers already in context: **SATISFIED** (every surface meets the requirement), **PLATEAU** (the weak-point set equals the previous round's and none is now resolvable), **CAPPED** (the round cap), **BLOCKED** (only unapproved structural gaps). A LOOP verdict runs the fresh-session ask first, and the verdict line carries its receipt - `next: fresh-session | continue - "<the user's answer, verbatim>"`. The final report is a table (outcome, per-surface before -> after, weak points resolved and deferred, the baseline at stop, `memories purged: <names|none>`); uncommitted work goes through AskUserQuestion (commit now / hold) - never a prose 'your call' bullet; what the round started goes through tear-down-vs-keep through the same AskUserQuestion call.

## Bounded and honest
- **Hard cap: 3 improve rounds.** Each round boundary is a fresh-session resume point - ask it at every LOOP decision (fresh recommended); on 'fresh', end the turn with a RESUME BLOCK naming the rounds consumed, the remaining weak points in tier order, and the docs to read first (COVERAGE.md's `## Resume` section ranged, and the capture's protocol invoked).
- Never pad with assertion-free tests, weaken or delete an existing test (except a spec the red-check just proved vacuous), widen exclusions or lower the requirement - those two are the user's.
- A testability refactor preserves behavior, and the tier on each weak point is the routing authority - no silent upgrade or downgrade.

## Rules
- The main session is the only orchestrator; the seats carry no Agent tool, so the fan-out stays flat. The instrumented run never enters a dispatch brief.
- Orchestration only: measurement judgment is the capture's, build knowledge the seats' and house skills'; code-quality polish is `alfred-loop-quality`, architecture `alfred-loop-architecture-quality`.
