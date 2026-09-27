---
name: alfred-loop-architecture-quality
description: "The deliberate architecture analyze-assess-improve loop. Use when the user asks to run the architecture quality loop or to analyze and improve the architecture; manual, /-only. It recaptures the structure map and the pros/cons findings every round, works the Must-fix weaknesses by tier - structural ones flagged for a user decision, never auto-applied - proposes but never writes any decision the run turns up, and loops until the fixable cons resolve or plateau. NOT for a code-quality polish (alfred-loop-quality), a single feature build (alfred-task-solve-cross), a capture-only run with no fixes (/alfred-capture-architecture alone), or test-suite and coverage weaknesses - the deliberate coverage analyze-and-improve loop covers those."
disable-model-invocation: true
---

# Architecture Quality Loop - Analyze, Assess, Improve (Deliberate)

You drive a deliberate loop that improves a project's architecture: analyze it, get a reasoned assessment, work the fixable weaknesses by tier, reconcile the map, and loop until they are resolved or the loop plateaus. The assessment is never yours to write or prune. User-invoked only (`/alfred-loop-architecture-quality`); the code counterpart is `alfred-loop-quality`. Scope a large codebase to one context per run. No `model` pin, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings - set the session to Opus with `/model`; the mode ask says so when it is not. `references/loop-in-full.md` carries every step below with its reasons and a worked run - read it on a first round; `references/evidence.md` holds the measurements.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available, ask ONE question before ANALYZE - this session, or the stack seats - and hold it; no dispatch is INLINE, never offering seats that cannot run. Every ask falls back to plain-text options without the tool.

- **DELEGATED** - the main session dispatches every seat (architecture-analyzer for gathering, an implementer for a small fix, the domain designer / implementers / verifier for a substantial one) and stays the orchestrator - never a re-entry into the full router.
- **INLINE** - the same steps in-session, smallest blast radius first.

## The loop

1. **ANALYZE + ASSESS** - two Skill calls in order: `alfred-capture-architecture` for the map, then the deliberate pros/cons capture matched from your skill list by what it covers, which recomputes `<docs-path>/quality/ASSESSMENT.md` fresh. Past the fresh-session trigger (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window) the guard blocks EACH call - the gate working: ask fresh session (recommended) vs continue here per blocked call, never a retry. The Must-fix weaknesses are the work list, the tier the routing key; Worth-knowing and Deliberate-tradeoff entries are left alone. A drained list takes a **lens sweep** per `references/loop-mechanics.md`, not a re-run of the capture.
2. **TRIAGE + FIX by tier**, in leverage order, green baseline first, every fix held against the Strengths list (a fix that would erode one stops - a structural decision):
   - **small** - a scoped brief to the domain implementer (`references/loop-mechanics.md`, `memory: none`).
   - **substantial** - decompose with the domain designer; gate the plan with `alfred-task-verify-plan` (a real invocation, `plan_review: approved|waived`); get the user's approval via AskUserQuestion; stamp it - `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"`. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool; an earlier session's leftover stamp is not consent (the protected-path prompt and a refused write: the full reference); then build and verify through the domain trio (`references/domain-trio-protocol.md`). Re-tier only through the ask - a shrunk item still asks before any dispatch.
   - **structural** - never auto-applied: apply / decline / defer. Decline or defer adds it to this run's declined set - an in-context list only, never written to a file.
   Keep the build and tests green across the round; a red goes to the stack's resolver seat or is fixed in-session first.
3. **LOOP or STOP** - read `references/loop-mechanics.md` now (the report's `Mechanics` line is the receipt). Decide off the weakness set in context: **SATISFIED**, **PLATEAU** (the fixable-weakness set equals the previous round's and none is now resolvable), **CAPPED**, **BLOCKED**. A LOOP verdict runs the fresh-session ask first and carries its receipt: `next: fresh-session | continue - "<the user's answer, verbatim>"`. On STOP after a shipped fix, reconcile ONCE - the map capture's UPDATE path, then the findings capture (a lighter substitute asks first). The final report's fields are `references/loop-mechanics.md`'s, `memories purged: <names|none>` among them. Uncommitted work goes through AskUserQuestion (commit now / hold) - never a prose 'your call' bullet - and what the round started gets tear-down-vs-keep through the same AskUserQuestion call.

## Bounded and honest
- **Hard cap: 3 improve rounds.** Each round boundary is a fresh-session resume point - a step: at every LOOP decision ask fresh session (recommended) vs continue here, the fresh option always present; on 'fresh', end the turn with the RESUME BLOCK from `references/loop-mechanics.md` and nothing else.
- Never weaken a test or delete an assertion to make a con look resolved; the smallest change that resolves each weakness; the tier is the routing authority - no silent upgrade or downgrade.

## Rules
- The main session is the only orchestrator; every dispatched seat carries no Agent tool, so the fan-out stays flat.
- Substantial and structural changes wait for approval; small fixes proceed. In DELEGATED mode the mode answer IS the small-tier consent: write `APPROVED small-tier - "<the answer, verbatim>"` the moment it lands (a resumed session quotes the RESUME BLOCK's mode line); the answer covers the whole round.
- Orchestration only - the map is the architecture capture's, the judgment the pros/cons capture's, the build knowledge the seats'.
