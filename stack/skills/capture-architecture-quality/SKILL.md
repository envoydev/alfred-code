---
name: capture-architecture-quality
description: "Use when asked to assess, evaluate or judge the architecture, or its weaknesses, risks or tradeoffs. Not for code-rule findings (capture-code-quality)."
---

# Project Architecture Quality Analyzer - Judge the Architecture (Deliberate)

You are the judgment seat for this run: you read the project's architecture map, verify what matters against the code, and reason out a candid strengths/weaknesses assessment - gated, tiered, and written fresh every time you run.

- `<docs-path>/quality/ASSESSMENT.md` - the reasoned, tiered evaluation. The doc you write; over target its detail spills to `<docs-path>/quality/references/<topic>.md`, replaced wholesale with it.

**`quality/` carries no `watch.json` and is therefore not a docs domain at all.** The engine (`node .claude/hooks/docs.js`) never sections it, never versions it per branch, never asks about it at session end - that machinery exists to make a doc survive a branch switch, and there is nothing here worth making survive: weaknesses and strengths are a function of the map plus the code, recomputable on demand for whatever branch you are on. Versioning them would be storing a cache and calling it a record. Read `references/doc-shape.md` before JUDGE - the findings gate, the count rule, the three buckets, the shape and the format budget are this skill's contract, not suggestions; the same file also says exactly what engine machinery this skill skips and why.

**Reads decisions, never writes them - hard rule.** `<docs-path>/decisions/` is a domain like any other (`references/doc-shape.md` has the shape) rather than an ad-hoc folder - its own `watch.json` declares every document in it `notOwned`, so the engine itself refuses every write to it, from any actor; where the domain has not been seeded on this project yet, read the ADRs wherever it keeps them instead. Either way it is a person's own record of what the project decided on purpose, and this skill's own findings gate asks 'has the project already decided this' before it opens a weakness - an analyzer that could write its own answer would be marking its own homework against its own gate. When this run turns up a candidate worth deciding rather than fixing (a repeatedly-declined Must-fix entry, a tradeoff worth recording), it names the proposal in the report and in the doc's Proposed decisions - the claim, the reason, what it costs - and a person accepts it by writing the decision themselves. When the code instead CONTRADICTS an existing decision, the session hook warns rather than asks (`references/doc-shape.md` says what a person does about it) - this skill's own job there is unchanged: report what the run observed, never adjudicate it. `loop-architecture-quality`, which drives this skill across rounds, holds the same rule: it proposes, it never writes.

**No first-run/update split, no zero-drift shortcut.** Every other capture in this stack skips its expensive work when nothing changed since the last stamp; this one cannot, because 'nothing changed in the code' does not mean 'nothing changed in what should be recorded' - a person may have just accepted a decision this run needs to fold in, or the last round may have shipped a fix. Every run reads fresh and writes fresh.

**Model check, at run start rather than after.** This judgment is the expensive kind, and this skill carries NO `model` pin, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings, so a multi-turn run returns to the session model, so set the session itself to Opus with `/model` before a run and drop it back after. When this session is not on Opus, say so in the first thing the user sees (inside the mode ask where one fires, otherwise the opening line) so the switch can happen before the judgment is spent; the REPORT step's `Model:` line closes the loop.

The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- It judges the project's architecture as it stands - a reasoned strengths/weaknesses assessment, tiered and gated,
  recomputed fresh every run from the structure map, the code and any recorded decisions.
- Deliberate only, never mid-build; reads the decision log but never writes to it, and keeps no version of its own
  output - the findings are a cache, not a record.
- Not for building the map itself, fixing what it finds, judging the code against its own quality rules
  (capture-code-quality), code style, or test coverage - the assessment keeps only structural testability
  blockers, never coverage gaps.

## Execution modes

DELEGATED vs INLINE keys on dispatch capability, not file presence - agent files on disk with no Agent tool to dispatch them is still INLINE. When dispatch is available, ask ONE question before GATHER, via AskUserQuestion - hunt weaknesses and strengths via architecture-analyzer seats (recommend it: the cheap seats absorb the reads), or in-session? - unless a calling flow (the quality loop) already picked the run's mode, which is inherited, never re-asked.

- **DELEGATED** - dispatch architecture-analyzer per module as below; reasoning and writing stay here.
- **INLINE** (chosen, or no dispatch - Cursor, or a scope too small to fan out): characterize the modules yourself, navigation-server-first and bounded, and continue at JUDGE identically.

## The run

### 1. ORIENT
Read `<docs-path>/architecture/ARCHITECTURE.md` - the map `capture-architecture` writes, the structural facts every weakness and strength traces to. No map at all: say so and stop, pointing at that capture - there is nothing to judge yet. A map whose own `Captured:` stamp is far behind HEAD is still read (a stale map is a claim to verify, not a blocker) - note the gap in the report rather than blocking on it.

Read `<docs-path>/quality/ASSESSMENT.md` if it already exists - not ground truth, but its entries are what gate question 3 ('is it actually new') folds a re-measurement into, so an unchanged finding keeps its existing shape rather than opening a duplicate. Read the project's decision log when present (`<docs-path>/decisions/`, or wherever the project keeps ADRs): each accepted decision is declared intent to reconcile against, and a tradeoff it records deliberately lands as a Deliberate tradeoff, not a weakness - gate question 4 depends on this read having happened.

### 2. GATHER - architecture-analyzer per module, in parallel
Dispatch architecture-analyzer per module/topic named in the map's Project structure table, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - in a single message where the areas are independent. Brief each dispatch toward the fifth verdict item (smells / violations, over-build included) and the fourth (patterns in use), the raw material weaknesses and strengths are built from - the five-part verdict shape holds regardless. You are the expensive seat: never read the codebase wholesale yourself - the navigation server (`get_symbols_overview`, `find_symbol` / `find_referencing_symbols`) and `Read` are for light orientation and spot-verification of one edge only. A digest the harness spilled to a persisted `tool-results/*.txt` file is the same rule one layer out: `grep` it for the claim you need, or Read it with an offset and a limit - never whole.

### 3. JUDGE - in-session
Treat a smell or a pattern as a hypothesis, never a finding, until it clears `references/doc-shape.md`'s findings gate. Run the gate on EVERY candidate before it is written down: all four questions answered explicitly, the external-preference rule applied, a re-measurement of an already-recorded limit folded into its existing entry - never opened as new, never re-tiered upward for gaining a number - and every gate-passing survivor recorded: the reasoning pass never stops early because the list already looks long enough. Coverage never enters the weakness list: missing or weak tests, low coverage, absent test infrastructure are `capture-test-coverage`'s capture and its COVERAGE.md, not architecture findings - a digest smell of that kind is dropped here, and what stays is only the *structural* testability blocker.

**The over-build lens, repo-wide.** Hunt what the code carries past its need: an interface with a single implementation, a speculative layer no second caller crosses, dead flexibility (options nobody sets, a generic one type fills), a hand-rolled piece the stdlib or framework ships, a dependency one call site uses. Each candidate takes the findings gate like any other - its 'what breaks' is the next developer's time, or a dependency's upgrade and advisory cost - plus one of the five over-build tags (delete / stdlib / native / yagni / shrink) and its measured cut: the lines and dependencies it removes, counted, never estimated. Survivors land in Must fix; the Summary ranks them biggest cut first and closes with `net: -N lines, -M dependencies possible`.

**Known ceilings.** The map's Known ceilings section (`ARCHITECTURE.md#known-ceilings`), when present, lists the shortcuts builds took on purpose, one `where | limit | revisit when` row each. A row whose 'revisit when' has come true in the code (a second instance now runs, the list now pages) is a Must-fix candidate through the gate like any other; a row with no 'revisit when' is flagged in the REPORT for a person to supply one - a ceiling nobody can revisit is a permanent shortcut by default.

Strength-check every Must-fix remediation against the Strengths list before it lands: a fix that would erode a listed strength names the tension in its entry and is shaped to preserve it, or the tradeoff is declared and the weakness tiered structural.

### 4. RE-GATHER on the gaps
Where a smell is unclear or a claim uncovered, dispatch architecture-analyzer again on exactly that topic. Where two digests contradict each other on a CHECKABLE fact, settle it with the cheapest deterministic probe in-session first - a `grep -c`, a navigation-server lookup, the stack's own command - and re-dispatch only for a judgment conflict no command can settle. **Hard cap: 3 gather rounds.** Still unsettled after 3: write what is established, mark what is uncertain and what would settle it - never guess to fill an entry.

### 5. WRITE - <docs-path>/quality/ASSESSMENT.md, per references/doc-shape.md
No write gate here (see doc-shape.md's Write mechanics) - REPLACE the file wholesale every run: READ it first if it exists so the Write is legal (an `rm` first is denied by the auto-mode classifier), then Write the fresh judgment over it. Compose the whole doc in-session and land it in one write (or one batched edit pass) - never a per-claim edit stream. Write ONLY `<docs-path>/quality/ASSESSMENT.md` and, over target, its `<docs-path>/quality/references/<topic>.md` spill files - never the map, never source, never the decision log. After the write, `wc -l` it against the ~300-line target; over target, run the spill pass now - this run owns the doc, and no other flow will.

### 6. REPORT
Confirm the file written (created vs refreshed), then lean: gather rounds used and whether the picture settled within the cap, the assessment's shape (per-bucket counts, the Must-fix tier tally, the top few highest-leverage fixes `loop-architecture-quality` should take first, the over-build `net:` line), any Proposed decisions this run surfaced, anything unverified and what would settle it. Then the receipt lines - one per field, UNCONDITIONAL:

| Field | Content |
|---|---|
| `References:` | which of this skill's `references/` files this run actually Read |
| `Decisions:` | the decision records step 1 actually opened, or `none found at <path looked>` |
| `Findings gate:` | candidates considered, passed, routed to Worth knowing, folded into an existing entry, and rejected (naming the question each rejected one failed) |
| `Write:` | created / refreshed, and the post-write line count against the ~300 target |
| `Model:` | what the session is on NOW and the exact `/model` command for the USER to paste - `raised for this run - run /model <prior model> to drop back`, `already on Opus before this run started - nothing to reset` (only when you can point at the message that proves it), or `not on Opus - the judgment above ran on <model>` |

No re-paste of the doc body - point to the file.

## Don't game it
An honest weakness beats a flattering omission, and a deliberate tradeoff is labelled a tradeoff, not a defect. The finding count is an output, never a target, in either direction: inflating an observation into a weakness to look thorough, and dropping a real one to keep a list tidy, are the same class of dishonesty as padding to a quota - zero gate-passing weaknesses is a complete result said plainly, and twenty-five real ones are all recorded. Re-measure every COUNTABLE claim a digest returns before it enters an entry: counts are the measured failure mode, and a too-clean look is not the trigger.
