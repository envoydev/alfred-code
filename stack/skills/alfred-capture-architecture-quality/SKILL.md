---
name: alfred-capture-architecture-quality
description: "Judges the project's architecture as it stands - a reasoned strengths/weaknesses assessment, tiered and gated, recomputed fresh every run from the structure map, the code and any recorded decisions. Use when the user asks to assess, evaluate or judge the architecture, or asks what its weaknesses, risks or tradeoffs are. Deliberate only, never mid-build; reads the decision log but never writes to it, and keeps no version of its own output - the findings are a cache, not a record. Not for building the map itself, fixing what it finds, judging the code against its own quality rules (alfred-capture-code-quality), code style, or test coverage - the assessment keeps only structural testability blockers, never coverage gaps."
---

# Project Architecture Quality Analyzer - Judge the Architecture (Deliberate)

You are the judgment seat for this run: you read the project's architecture map, verify what matters against the code, and reason out a candid strengths/weaknesses assessment - gated, tiered, and written fresh every time. `<docs-path>/quality/ASSESSMENT.md` is the only file you write. `references/run-in-full.md` carries every rule below with its reasons - read it on a first run; `references/evidence.md` holds the measurements.

- **`quality/` carries no `watch.json`, so it is no docs domain** - the docs engine never sections, versions or asks about it; findings are recomputed for whatever branch you are on. Read `references/doc-shape.md` before JUDGE - its findings gate, count rule, three buckets, shape and format budget are this skill's contract.
- **Reads decisions, never writes them - hard rule.** The decision log (`<docs-path>/decisions/`, or the project's ADR home) is what gate question 4 reads; a candidate worth deciding is a Proposed decision in the report and the doc, for a person to write. Code that contradicts a decision is reported, never adjudicated.
- **No zero-drift shortcut** - every run reads fresh and writes fresh.
- **Model check at run start.** No `model` pin, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings, so set the session to Opus with `/model` before a run; not on Opus, say so in the first thing the user sees.

## Execution modes

DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available, ask ONE question before GATHER - architecture-analyzer seats (recommended: they absorb the reads) or in-session - unless the quality loop already picked the mode. INLINE characterizes the modules yourself, serena-first and bounded, then JUDGE identically.

## The run

1. **ORIENT** - read `<docs-path>/architecture/ARCHITECTURE.md` (no map: say so and stop, pointing at the architecture capture; a stale map is read and its gap noted), the existing `ASSESSMENT.md` (re-measurements fold into its entries), and the decision log.
2. **GATHER** - architecture-analyzer per module of the map's Project structure table, in one message, briefed toward smells and violations (over-build included) and patterns in use. You are the expensive seat: never read the codebase wholesale yourself - navigation-server lookups and ranged reads for spot-verification only; a spilled `tool-results/*.txt` digest is grepped, never read whole.
3. **JUDGE** - every smell is a hypothesis until it clears `references/doc-shape.md`'s findings gate: all four questions answered explicitly, a re-measurement folded into its existing entry, every survivor recorded. Coverage never enters the weakness list - only a structural testability blocker does. Hunt over-build repo-wide (single-implementation interfaces, speculative layers, dead flexibility, hand-rolled stdlib, one-call dependencies), each with its tag and a counted cut, ranked in the Summary with `net: -N lines, -M dependencies possible`. A Known ceilings row whose 'revisit when' came true is a Must-fix candidate; one with none is flagged. A Must-fix remediation that would erode a listed strength names the tension or is tiered structural.
4. **RE-GATHER on the gaps** - a contradiction on a CHECKABLE fact: settle it with the cheapest deterministic probe in-session first, re-dispatching only for a judgment conflict. **Hard cap: 3 gather rounds**, then write what is established and mark the rest uncertain.
5. **WRITE** - REPLACE `<docs-path>/quality/ASSESSMENT.md` wholesale (READ it first, never `rm`), composed in-session and landed in one write, per `references/doc-shape.md`; `wc -l` it against the ~300-line target and spill if over. Write nothing else.
6. **REPORT** - the file written, gather rounds used, the assessment's shape (bucket counts, the Must-fix tier tally, the top fixes for the architecture loop, the over-build `net:` line), Proposed decisions, anything unverified. Then the receipt lines, one per field, UNCONDITIONAL:

| Field | Content |
|---|---|
| `References:` | which of this skill's `references/` files this run actually Read |
| `Decisions:` | the decision records step 1 actually opened, or `none found at <path looked>` |
| `Findings gate:` | candidates considered, passed, routed to Worth knowing, folded into an existing entry, and rejected (naming the question each rejected one failed) |
| `Write:` | created / refreshed, and the post-write line count against the ~300 target |
| `Model:` | what the session is on NOW and the exact `/model` command for the USER to paste - `raised for this run - run /model <prior model> to drop back`, `already on Opus before this run started - nothing to reset` (only when you can point at the message that proves it), or `not on Opus - the judgment above ran on <model>` |

## Don't game it
An honest weakness beats a flattering omission, and a deliberate tradeoff is labelled a tradeoff. The finding count is an output, never a target, in either direction - zero gate-passing weaknesses is a complete result, and twenty-five real ones are all recorded. Re-measure every COUNTABLE claim a digest returns before it enters an entry.
