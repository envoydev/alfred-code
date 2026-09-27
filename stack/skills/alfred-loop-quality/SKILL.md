---
name: alfred-loop-quality
description: "Use when the user asks to run the quality loop, the code-quality loop or the loops pipeline - the deliberate analyze-triage-fix loop over the code, manual and /-only: each round recomputes the code-quality assessment against the project's own rules (the numbered prompts under the loops folder, the convention rules, the recorded code style) and works its fixable findings by tier. `staged` keeps the numbered-prompt pipeline, one stage at a time. Not for architecture restructuring (alfred-loop-architecture-quality), measuring or raising test coverage (the coverage capture and loop), an assessment with no fixes (alfred-capture-code-quality alone), or a single diff (alfred-task-verify-code or /security-review)."
disable-model-invocation: true
---

# Code Quality Loop - Analyze, Triage, Fix (Deliberate)

You drive a deliberate loop that improves a project's code against its own rules: each round the code-quality capture recomputes `<docs-path>/quality/CODE-ASSESSMENT.md`, you work its fixable findings by tier, and you loop until they are resolved or the loop plateaus. The assessment is never yours to write or prune. User-invoked only (`/alfred-loop-quality`); the architecture counterpart is `alfred-loop-architecture-quality`. Scope a large codebase with TARGET. No `model` pin: set the session to Opus with `/model` for the run - the mode ask says so when it is not. `references/loop-in-full.md` carries every step below with its reasons and a worked run - read it on a first round; `references/evidence.md` holds the measurements.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available, ask ONE question before ANALYZE - this session, or the stack seats - and hold it; the capture inherits it. No dispatch is INLINE. Every ask falls back to plain-text options without the tool.

- **DELEGATED** - the main session dispatches every seat (the capture's analyzers, an implementer for a small fix, the domain designer / implementers / verifier for a substantial one), always the NAMED domain seats; a surface with none is fixed INLINE and said so.
- **INLINE** - the same steps in-session, smallest blast radius first, loading each edited file family's convention skill.
- **STAGED** - the pre-2.0.0 numbered-prompt run, ONLY when the invocation names it (`/alfred-loop-quality staged [TARGET]`) or a resume block names `RUN-STATE.md`: then Read `references/staged-mode.md` and run it exactly as written; its companions (`rules.md`, `stage-close.md`, `delegated-mode.md`, `worked-example.md`, `bootstrap.md`) are read at the step that names them.

**The rule source** is the numbered prompts under `<docs-path>/loops/`, used exactly as they are - never rewritten or renumbered, and never seed the starter set around a folder of the user's files. Missing or empty: seed the starter set per `references/bootstrap.md` before round 1. The `0.`-numbered file is FIX discipline, held for every fix and folded into every brief.

## The loop

### 1. ANALYZE
Round 1 opens with the green baseline (a red one fixed or recorded first) and records the sweep baseline (HEAD, or `git stash create` on a dirty tree). Then INVOKE `alfred-capture-code-quality` (the Skill call), handing it the mode and TARGET; it recomputes `<docs-path>/quality/CODE-ASSESSMENT.md`. A call the fresh-session guard blocks is the gate working: ask fresh session (recommended) vs continue here - never retry it. Its Must-fix findings are the work list, the tier the routing key; Worth-knowing and Deliberate-tradeoff entries are left alone.

### 2. TRIAGE + FIX by tier
In rank order, green baseline confirmed, the fix discipline held:

- **small** - dispatch the matching domain implementer with the module's small findings batched into one scoped brief (`references/loop-mechanics.md`, `memory: none`); an ambiguity is decided by precedent and appended to `<docs-path>/loops/DECISIONS.md`.
- **substantial** - the domain solution-designer decomposes it; `alfred-task-verify-plan` gates the plan (a real invocation, `plan_review: approved|waived`); get the user's approval on that plan before building, via AskUserQuestion; stamp it - `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"`. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool; an earlier session's leftover stamp is not consent (the protected-path prompt and a refused write: the full reference); then the domain implementers build and the domain verifier gates it (`references/domain-trio-protocol.md`). Re-tier only through the ask - a shrunk item still asks before any dispatch.
- **structural** - do NOT auto-apply: apply / decline / defer through AskUserQuestion. Decline or defer adds it to this run's declined set - an in-context list only, never written to a file.

Keep the build and tests green across the round; a red goes to the stack's resolver seat, or is fixed in-session - never carried into the next finding.

### 3. LOOP or STOP
Read `references/loop-mechanics.md` now (the report's `Mechanics` line is the receipt). Decide off the finding set already in context: **SATISFIED** (no fixable finding left), **PLATEAU** (the fixable-finding set equals the previous round's and none is now resolvable), **CAPPED**, **BLOCKED** (only unapproved structural findings). A LOOP verdict runs the fresh-session ask first and carries its receipt: `next: fresh-session | continue - "<the user's answer, verbatim>"`. On STOP after a shipped fix: the final build + tests and the anti-gaming sweep (`references/anti-gaming-sweep.md` - any hit is a BLOCKER), then reconcile ONCE with the capture. When this session is already past the fresh-session trigger, the same fresh-session choice above applies before the capture runs. The final report's fields are `references/loop-mechanics.md`'s, `memories purged: <names|none>` among them. Uncommitted work goes through AskUserQuestion (commit now / hold) - never a prose 'your call' bullet - and what the round started gets tear-down-vs-keep through the same AskUserQuestion call.

## Bounded and honest
- **Hard cap: 3 improve rounds.** Each round boundary is a fresh-session resume point - a step: at every LOOP decision ask fresh session (recommended) vs continue here; on 'fresh', end the turn with the RESUME BLOCK from `references/loop-mechanics.md` and nothing else.
- Never weaken, skip or delete a test or an assertion to resolve a finding; the smallest change that resolves each one; the tier is the routing authority - no silent upgrade or downgrade.

## Rules
- The main session is the only orchestrator; every dispatched seat carries no Agent tool, so the fan-out stays flat.
- Substantial and structural changes wait for approval; small fixes proceed. In DELEGATED mode the mode answer IS the small-tier consent: write `APPROVED small-tier - "<the answer, verbatim>"` the moment it lands (a resumed session quotes the RESUME BLOCK's mode line); the answer covers the whole round.
- Orchestration only - the rules live in the loops prompts and convention skills, the judgment in the capture, the build knowledge in the seats.
