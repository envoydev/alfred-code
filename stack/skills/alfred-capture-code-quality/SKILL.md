---
name: alfred-capture-code-quality
description: "Use when the user asks to assess, audit or judge the code quality, or which of the project's own quality rules the code breaks - a tiered, gated assessment against the numbered prompts under the loops folder, the convention rules and the recorded code style, every finding tied to its file:line and rule, recomputed fresh each run into quality/CODE-ASSESSMENT.md. Deliberate only, never mid-build; fixes nothing and never writes the decision log. Not for fixing the findings (/alfred-loop-quality), the architecture (alfred-capture-architecture-quality), test coverage (the coverage capture), recording the code style (alfred-capture-code-style), a security audit (/security-review or the security-auditor seat) or one diff (alfred-task-verify-code)."
---

# Code Quality Capture - Judge the Code Against Its Rules (Deliberate)

You are the judgment seat for this run: you gather the project's quality rules, have the code judged against them module by module, and reason out a gated, tiered assessment - written fresh every time you run. Deliberate only, never mid-build: a person or the quality loop starts it, and it changes no code.

- `<docs-path>/quality/CODE-ASSESSMENT.md` - the reasoned, tiered findings. The only file you write.

**`quality/` carries no `watch.json`, so it is no docs domain** - the docs engine never sections, versions or asks about it; findings are recomputed for whatever branch you are on. Read `references/doc-shape.md` before JUDGE - its findings gate, count rule, three buckets, shape and format budget are this skill's contract, not suggestions.

**Reads decisions, never writes them - hard rule.** The decision log (`<docs-path>/decisions/`, or the project's ADR home) and the project CLAUDE.md's recorded choices are what gate question 4 reads; a candidate worth deciding rather than fixing is a Proposed decision, for a person to accept by writing it. `alfred-loop-quality`, which drives this skill across rounds, holds the same rule.

**No zero-drift shortcut** - every run reads fresh and writes fresh.

**Model check, at run start rather than after.** The judgment is the expensive kind, and this skill carries NO `model` pin, deliberately: a skill-level pin lasts only for the turn it activates in, so set the session itself to Opus with `/model` before a run. When this session is not on Opus, say so in the first thing the user sees; the REPORT step's `Model:` line closes the loop.

## Execution modes

DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available, ask ONE question before GATHER, via AskUserQuestion - judge the modules via code-quality-analyzer seats (recommend it: the cheap seats absorb the reads), or in-session? - unless a calling flow (the quality loop) already picked the run's mode, which is inherited, never re-asked.

- **DELEGATED** - dispatch code-quality-analyzer per module as below; the gate, the tiers and the writing stay here.
- **INLINE** (chosen, or no dispatch - Cursor, or a scope too small to fan out): judge the modules yourself, serena-first and bounded, by the seat's own finding shape, and continue at JUDGE identically.

## The run

### 1. ORIENT - the rules, the modules, the prior read
Collect the rule sources in precedence order (`references/rule-sources.md` says what each one carries): the numbered stage prompts under `<docs-path>/loops/`, listed with this one command from the project root, then `<docs-path>/code-style/CODE-STYLE.md`, then the stack's path-scoped convention rules for the file families the target holds.

```bash
L="<docs-path>/loops"
if [ -d "$L" ]; then echo "loops: present"; ls "$L" | grep -E '^[0-9]+\..+\.md$' | grep -Ev '^0+\.' | sort -t. -k1,1n; else echo "loops: absent"; fi
```

No `loops/` folder, or one with no stage prompt: say so in the report and judge against the convention rules and `CODE-STYLE.md` alone - never seed the folder, never invent a rubric.

**No rule source at all - stop.** No stage prompt under `loops/`, no `CODE-STYLE.md` and no convention rule attaching to a file family the target holds: say so in one line and stop before GATHER, writing nothing - a doc judged against nothing reads as clean code. Name the two ways to get rules: record the code style with `alfred-capture-code-style`, or run `/alfred-loop-quality`, which seeds the `loops/` starter set.

Then the modules inside the target (the invocation's scope, else the whole project): the architecture map's Project structure table, else the top-level source folders from one listing - a missing map is a note, never a blocker. Read `<docs-path>/quality/CODE-ASSESSMENT.md` if it exists - not ground truth, but gate question 3 folds a re-measurement into its entries - and the decision log plus the project CLAUDE.md's recorded choices, which gate question 4 depends on.

### 2. GATHER - code-quality-analyzer per module, in parallel
Dispatch code-quality-analyzer per module - in a single message where the modules are independent. Each brief carries the module's paths, the rule list (the loops prompt paths, the RELEVANT `CODE-STYLE.md` sections pasted rather than the whole doc, the convention rules attaching to the module's file families), `depth:` for a module too large for one seat, and `memory: none`. You are the expensive seat: never read the codebase wholesale yourself - the navigation server and ranged `Read` are for spot-verification of one finding only. A digest spilled to `tool-results/*.txt` is grepped, never read whole.

### 3. JUDGE - in-session
Every `F` line is a candidate until it clears `references/doc-shape.md`'s findings gate: all four questions answered explicitly, the precedence rule applied, a re-measurement folded into its existing entry (never new, never re-tiered upward), and every survivor recorded - the pass never stops early. Re-measure every COUNTABLE claim a seat returns (a class count, a scan total) before it enters an entry. One entry per rule per module, with its severity (the rule's own scale) and its tier - the loop's routing key. Cross-check every Must-fix remediation against the other rules handed this run: a fix that would breach another rule names the tension and satisfies both, or the precedence in `references/doc-shape.md` decides, or it is tiered structural - a fix that trades one finding for another makes the loop oscillate. A `handoff:` line is not a finding here: architecture restructuring belongs to the architecture-quality capture and a coverage gap to the coverage capture - count them in the report, never in the doc.

### 4. RE-GATHER on the gaps
Where a finding is unclear or a module came back PARTIAL, dispatch code-quality-analyzer again on exactly that module and rule. Where two seats contradict each other on a CHECKABLE fact, settle it with the cheapest deterministic probe in-session first (`grep -c`, a navigation-server lookup, the stack's own command) and re-dispatch only for a judgment conflict no command settles. **Hard cap: 3 gather rounds.** Still unsettled after 3: write what is established, mark what is uncertain and what would settle it - never guess to fill an entry.

### 5. WRITE - <docs-path>/quality/CODE-ASSESSMENT.md, per references/doc-shape.md
No write gate - REPLACE the file wholesale every run: READ it first if it exists so the Write is legal, then Write the fresh judgment over it, composed whole in-session and landed in one write. Write ONLY `<docs-path>/quality/CODE-ASSESSMENT.md` - never source, never the loops prompts, never the decision log. After the write, `wc -l` it against the ~300-line target and run the spill pass now if it is over.

### 6. REPORT
Confirm the file written (created vs refreshed), then lean: gather rounds used, the assessment's shape (bucket counts, Must-fix tier and severity tallies, per-rule counts, the top fixes for the quality loop), hand-offs by destination, Proposed decisions, and anything unverified with what would settle it. Then the receipt lines - one per field, UNCONDITIONAL:

Six fields - `References:`, `Rules:`, `Decisions:`, `Findings gate:`, `Write:`, `Model:` - each filled per `references/report-receipt.md`, read at this step.

No re-paste of the doc body - point to the file.

## Don't game it
An honest finding beats a flattering omission, and a rule the project chose not to follow is a Deliberate tradeoff, not a defect. The finding count is an output, never a target, in either direction: inflating a preference into a finding to look thorough, and dropping a real one to keep the list tidy, are the same dishonesty - zero gate-passing findings is a complete result said plainly, and forty real ones are all recorded.
