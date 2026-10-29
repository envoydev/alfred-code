# Project Architecture Quality Analyzer - Judge the Architecture (Deliberate)

**Contents:** When to use - Execution modes (the run gate, DELEGATED / INLINE) - The run (1. ORIENT, 2. GATHER, 3. JUDGE, 4. RE-GATHER, 5. WRITE, 6. REPORT) - Don't game it.

You are the judgment seat for this run: you read the project's architecture map, verify what matters against the code, and reason out a candid strengths/weaknesses assessment - gated, tiered, and written fresh every time you run.

- `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md` - the reasoned, tiered evaluation. The doc you write; over target its detail spills to `<docs-path>/quality/references/<topic>.md`, replaced wholesale with it. Its entries' watch goes into `<docs-path>/quality/watch.json` through the engine's merge.

**`quality/` is a recomputed docs domain - rebuilt whole every run, watched, never versioned; `references/architecture-quality-doc-shape.md` says why.** Read `references/architecture-quality-doc-shape.md` before JUDGE - the findings gate, the count rule, the three buckets, the shape, the sections and the format budget are this skill's contract, not suggestions; the same file also says exactly which engine machinery applies to this doc and why.

**Reads decisions, never writes them - hard rule.** Reads the decision log, never writes it - a Proposed decision is named for a person to accept; doc-shape has the domain shape. Code that contradicts a recorded decision is reported as observed, never adjudicated.

**No first-run/update split, no zero-drift shortcut.** Every other capture in this stack skips its expensive work when nothing changed since the last stamp; this one cannot, because 'nothing changed in the code' does not mean 'nothing changed in what should be recorded' - a person may have just accepted a decision this run needs to fold in, or the last round may have shipped a fix. Every run reads fresh and writes fresh - the INLINE verify-and-rewrite path below re-measures every entry too.

**Model: the session's.** The judgment runs on the model the session is on; ask for no switch - a measured capture A/B found Sonnet at xhigh matching Opus at the same cost. No `model` pin either - a skill-level pin lasts only for the turn it activates in. The REPORT step's `Model:` line names the model the judgment ran on.

The measurements behind these rules live in `references/architecture-quality-evidence.md` - an audit appendix, not a run-time load.

## When to use

- It judges the project's architecture as it stands - a reasoned strengths/weaknesses assessment, tiered and gated,
  recomputed fresh every run from the structure map, the code and any recorded decisions.
- Deliberate only, never mid-build; reads the decision log but never writes to it, and keeps no version of its own
  output - the findings are a cache, not a record.
- Not for building the map itself, fixing what it finds, judging the code against its own quality rules
  (the code-quality part), code style, or test coverage - the assessment keeps only structural testability
  blockers, never coverage gaps.

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack.

## Execution modes

**Run gate - a run no calling flow started asks first.** The run dispatches seats and replaces ARCHITECTURE-ASSESSMENT.md, and a conversational 'what are the risks here?' can match this skill. So unless a mode word follows the topic (a calling flow started this run) or capture-quality's chain ask already answered it, put this ask before GATHER (joined with the mode ask below where that fires, one AskUserQuestion call). No answer, no run.

```ask
Run a fresh architecture assessment and replace ARCHITECTURE-ASSESSMENT.md?
- 'Run the assessment and replace ARCHITECTURE-ASSESSMENT.md (Recommended)' - a fresh judgment, seats as picked in the mode ask
- 'Answer from the existing ARCHITECTURE-ASSESSMENT.md only' - nothing dispatched, nothing written; with no ARCHITECTURE-ASSESSMENT.md yet the run stops here
```

DELEGATED vs INLINE keys on dispatch capability, not file presence - agent files on disk with no Agent tool to dispatch them is still INLINE. When dispatch is available, ask ONE question before GATHER, via AskUserQuestion - hunt weaknesses and strengths via architecture-analyzer seats (recommend it: the cheap seats absorb the reads), or in-session? - unless a calling flow (a mode word after the topic) or the chain ask already picked the run's mode, which is inherited, never re-asked.

```ask
Hunt the weaknesses and strengths of <the modules> through the architecture-analyzer seats or in this session?
- 'Through the seats (Recommended)' - the cheap seats absorb the reads; the judgment and the write stay here
- 'In this session' - navigation-tools-first and bounded, no dispatch
```

- **DELEGATED** - dispatch architecture-analyzer per module as below; reasoning and writing stay here.
- **INLINE** (chosen, or no dispatch, or a scope too small to fan out): characterize the modules yourself, navigation-tools-first and bounded, and continue at JUDGE identically. Its one lighter path: when the state script (capture-quality's chain block) reports `architecture-quality: current`, VERIFY + REWRITE - re-measure every recorded entry against the code, fold in the decisions accepted since, then the same whole-file Write. The run gate then takes this form; a run whose HEAD moved - the loop's reconcile after shipped fixes included - runs in full:

```ask
ARCHITECTURE-ASSESSMENT.md is as of this HEAD on a clean tree. Verify and rewrite it, or run the assessment in full?
- 'Verify and rewrite at this HEAD (Recommended)' - every recorded entry re-measured, the accepted decisions folded in, one whole-file Write
- 'Run the full assessment and replace ARCHITECTURE-ASSESSMENT.md' - a fresh judgment, seats as picked in the mode ask
- 'Answer from the existing ARCHITECTURE-ASSESSMENT.md only' - nothing dispatched, nothing written
```

## The run

### 1. ORIENT
Read `<docs-path>/architecture/ARCHITECTURE.md` - the map `capture-architecture` writes, the structural facts every weakness and strength traces to. No map at all: say so and stop, pointing at that capture - there is nothing to judge yet. A map whose own `Captured:` stamp is far behind HEAD is still read (a stale map is a claim to verify, not a blocker) - note the gap in the report rather than blocking on it.

Read `<docs-path>/preferences/ARCHITECTURE-PREFERENCES.md` when present: its `A<n>` entries are the top rule source (`references/architecture-quality-doc-shape.md`), and `node .claude/skills/capture-preferences/scripts/preferences.js check --all --area architecture` locates the breaches of the ones with a `Check:`.

Read `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md` if it already exists - not ground truth, but its entries are what gate question 3 ('is it actually new') folds a re-measurement into, so an unchanged finding keeps its existing shape rather than opening a duplicate. Read the project's decision log when present (`<docs-path>/decisions/`, or wherever the project keeps ADRs): each accepted decision is declared intent to reconcile against, and a tradeoff it records deliberately lands as a Deliberate tradeoff, not a weakness - gate question 4 depends on this read having happened.

### 2. GATHER - architecture-analyzer per module, in parallel
Dispatch architecture-analyzer per module/topic named in the map's Project structure table, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - in a single message where the areas are independent, up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` at once (default 5). Brief each dispatch toward the fifth verdict item (smells / violations, over-build included) and the fourth (patterns in use), the raw material weaknesses and strengths are built from - the five-part verdict shape holds regardless. Where you read preferences above, the preferences hook hands each architecture-analyzer the `ARCHITECTURE-PREFERENCES.md` entries at its start during this run, with the order to report a departure as a smell by id, so a brief never lists them - a departure from one with no `Check:` line comes back in the digest instead of by chance. Open each brief with the line `Run: architecture quality`: where no hook ran (hooks off, another host), the seat reads the doc itself on that mark. You are the expensive seat: never read the codebase wholesale yourself - the navigation tools (a file's outline, a symbol, its callers) and `Read` are for light orientation and spot-verification of one edge only. A digest the harness spilled to a persisted `tool-results/*.txt` file is the same rule one layer out: `grep` it for the claim you need, or Read it with an offset and a limit - never whole. After the dispatch, end the turn: each hand-back arrives on its own, and a notification poll only re-sends the context.

### 3. JUDGE - in-session
Treat a smell or a pattern as a hypothesis, never a finding, until it clears `references/architecture-quality-doc-shape.md`'s findings gate. Run the gate on EVERY candidate before it is written down: all four questions answered explicitly, the external-preference rule applied, a re-measurement of an already-recorded limit folded into its existing entry - never opened as new, never re-tiered upward for gaining a number - and every gate-passing survivor recorded: the reasoning pass never stops early because the list already looks long enough. Coverage never enters the weakness list: missing or weak tests, low coverage, absent test infrastructure are the test-coverage-quality part's capture and its COVERAGE-QUALITY.md, not architecture findings - a digest smell of that kind is dropped here, and what stays is only the *structural* testability blocker.

**The over-build lens, repo-wide.** Hunt what the code carries past its need: an interface with a single implementation, a speculative layer no second caller crosses, dead flexibility (options nobody sets, a generic one type fills), a hand-rolled piece the stdlib or framework ships, a dependency one call site uses. Each candidate takes the findings gate like any other - its 'what breaks' is the next developer's time, or a dependency's upgrade and advisory cost - plus one of the five over-build tags (delete / stdlib / native / yagni / shrink) and its measured cut: the lines and dependencies it removes, counted, never estimated. Survivors land in Must fix; the Summary ranks them biggest cut first and closes with `net: -N lines, -M dependencies possible`.

**Known ceilings.** The map's Known ceilings section (`ARCHITECTURE.md#known-ceilings`), when present, lists the shortcuts builds took on purpose, one `where | limit | revisit when` row each. A row whose 'revisit when' has come true in the code (a second instance now runs, the list now pages) is a Must-fix candidate through the gate like any other; a row with no 'revisit when' is flagged in the REPORT for a person to supply one - a ceiling nobody can revisit is a permanent shortcut by default.

Strength-check every Must-fix remediation against the Strengths list before it lands: a fix that would erode a listed strength names the tension in its entry and is shaped to preserve it, or the tradeoff is declared and the weakness tiered structural.

### 4. RE-GATHER on the gaps
Where a smell is unclear or a claim uncovered, dispatch architecture-analyzer again on exactly that topic. Where two digests contradict each other on a CHECKABLE fact, settle it with the cheapest deterministic probe in-session first - a `grep -c`, a navigation lookup, the stack's own command - and re-dispatch only for a judgment conflict no command can settle. **Hard cap: 3 gather rounds.** Still unsettled after 3: write what is established, mark what is uncertain and what would settle it - never guess to fill an entry.

### 5. WRITE - <docs-path>/quality/ARCHITECTURE-ASSESSMENT.md, per references/architecture-quality-doc-shape.md
No diff check here - once the run gate is answered, REPLACE the file wholesale every run: READ it first if it exists so the Write is legal (an `rm` first is denied by the auto-mode classifier), then Write the fresh judgment over it. Compose the whole doc in-session and land it in one Write of the whole file - never a per-claim edit stream: no Edit, no `sed`, no patch of the old text, the spill pass included (it is a second whole-file Write). A calling flow's brief that names what shipped or what remains is context for the REPORT, never the scope: a 'reconcile' run still gathers, judges and writes the whole assessment - a patched old file carries the old judgment forward. Write ONLY `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md`, over target its `<docs-path>/quality/references/<topic>.md` spill files, and `quality/watch.json` through the merge - never the map, never source, never the decision log. Each Strength and Must-fix entry is a `###` section with its id and covers (doc-shape's Sections, ids and covers). After the write, `wc -l` it against the ~300-line target; over target, run the spill pass now - this run owns the doc, and no other flow will.

Then the watch, per doc-shape's Write mechanics: pipe one entry per located Strength and Must-fix section to `node .claude/hooks/docs.js watch-merge quality --seed '{"recomputed":true,"notOwned":["CODE-ASSESSMENT.md","COVERAGE-QUALITY.md","references/**"]}' --kinds 'weakness: ' 'strength: '`, then run `node .claude/hooks/docs.js lint quality` (clean) and `node .claude/hooks/docs.js watch <one located file>` (names its entry). A red result is this run's own finding, fixed before the REPORT. An engine whose answer opens `usage: docs.js where` (it knows no merge) predates this skill: skip the merge and both checks, and say so in the REPORT; a line opening `watch-merge:` is this call's own error - fix the call and run it again.

### 6. REPORT
Confirm the file written (created vs refreshed), then lean: gather rounds used and whether the picture settled within the cap, the assessment's shape (per-bucket counts, the Must-fix tier tally, the top few highest-leverage fixes `loop-architecture-quality` should take first, the over-build `net:` line), any Proposed decisions this run surfaced, anything unverified and what would settle it. Then the receipt lines - one per field, UNCONDITIONAL:

| Field | Content |
|---|---|
| `References:` | which of this skill's `references/` files this run actually Read |
| `Decisions:` | the decision records step 1 actually opened, or `none found at <path looked>` |
| `Preferences:` | the `A<n>` entries judged and the check's `checked:` and `by hand:` lines, or `none - no ARCHITECTURE-PREFERENCES.md` |
| `Findings gate:` | candidates considered, passed, routed to Worth knowing, folded into an existing entry, and rejected (naming the question each rejected one failed) |
| `Write:` | created / refreshed, and the post-write line count against the ~300 target |
| `Watch:` | the merge's `watch-merge quality: ...` line and the entry the watch check named, or `skipped - the engine predates watch-merge` |
| `Run gate:` | the answer verbatim, or `invoked by the quality loop` |
| `Ceilings:` | the Known-ceilings rows with no 'revisit when', for a person to supply one, or `none` |
| `Model:` | the model the judgment ran on, and the exact `/model` command for the USER to paste when the run raised it - `<model> - the judgment above ran on it`, or `raised for this run - run /model <prior model> to drop back` (only when a message in this session shows the user switched for this run) |

No re-paste of the doc body - point to the file. A next command named for the user (the quality loop, a re-run) is offered to run here first, and `Start it in a fresh session: /clear, then <command>` after it, in the option labels when it is an ask. Mark the fresh option only when a hook's fresh-session text in this session says a fresh session pays back, and then it goes first, the in-session option after it unmarked; on Claude Code the stop-contract hook drops it where one does not, and when that leaves one option it refuses the ask - then take the option it names.

## Don't game it
An honest weakness beats a flattering omission, and a deliberate tradeoff is labelled a tradeoff, not a defect. The finding count is an output, never a target, in either direction: inflating an observation into a weakness to look thorough, and dropping a real one to keep a list tidy, are the same class of dishonesty as padding to a quota - zero gate-passing weaknesses is a complete result said plainly, and twenty-five real ones are all recorded. Re-measure every COUNTABLE claim a digest returns before it enters an entry: counts are the measured failure mode, and a too-clean look is not the trigger.
