---
name: capture-usage-report
description: "Use when asked to analyze the stack usage or audit this project's sessions for token and tool cost. Manual, /-only. Not for live cost or fixing findings."
disable-model-invocation: true
---

# Usage Report - token/tool report on stack skill runs

You audit what alfred-code skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data next to it, so a later agent can re-analyze without re-collecting. The question every bundle answers is whether Claude Code with the stack is EFFICIENT in this project - in tokens (what the session paid against what it delivered) and in effectiveness (did the work land, how many corrections it took, how many claims had a check behind them) - so the analyzer prints an efficiency scorecard per session and the report carries an authored efficiency verdict built from it. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

Run the audit from a FRESH session that names the target session id(s) - never from the tail of the session being audited. The work is offline (a node script plus report writing) and needs none of the audited chat's context, and an in-session run re-sends its whole accumulated context on every message for a report a fresh session produces from ~20k.

## When to use

- The token and tool usage audit of alfred-code skill runs in THIS project; also for 'whether the stack is efficient here'.
- It finds EVERY session transcript with a stack-skill run (or the SESSIONS named), runs the stack's analyze-usage.js over each, and writes a per-session report (tokens, tool calls, the efficiency scorecard, waste, protocol check, verdict) plus the raw data for a follow-up agent, and a cross-session SUMMARY.md when several sessions are audited.
- Not for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices.

## Inputs

### SESSIONS - which of this project's sessions to audit

An invocation that names the scope (session ids, 'the last 3', a since-date, 'all') IS the answer - never re-ask; the one exception is a scope that includes the CURRENT session, which always routes through the fresh-session self-check below (that ask resolves HOW to honor the fresh-session rule, it does not re-ask the scope). Otherwise resolve the candidates first (step 1's grep), then ask ONE question via AskUserQuestion, each option carrying its real count:

- **Up to 12 unaudited, oldest first (recommended)** - the batch bound, and re-run for the rest.
- **All matching** - every transcript with a stack-skill run, N unaudited, and say plainly that N over 12 will force compactions.
- **Today's sessions** - the matching transcripts started today, N.
- **Current session only** - routes through the fresh-session self-check below (exclude it from this run, or hand the invocation to a fresh session - it is never audited from its own tail).
- A custom scope arrives via the built-in Other.

Hold the answer for the run. **The batch is BOUNDED at 12 bundles per run and the marker goes on the bounded option, not the largest one** - the biggest scope marked Recommended is what forces compactions. Over the bound, audit the oldest 12, then close the run naming exactly what is left and the invocation that resumes it.

### SKILLS - the skill names to hunt in the transcripts

Default: DETECT - sweep the transcripts for the stack skills that actually RAN (a `<command-name>` slash block or a Skill-tool call against the installed roster; a name appearing only in injected AGENTS.md/CLAUDE.md/rules text is a mention, not a run) and audit those, stating the detected list in the report. The user can name specific skills instead to narrow the audit.

Two run modes, opposite expectations:

- A single-chat skill (the `task-design` / `task-implement` / `task-verify-plan` trio) runs in-session and dispatches NOTHING - its cost is all main-context, so the interesting numbers are tool-result sizes and cache behavior.
- A dispatch-mode run (`task-solve-cross`, an agents build mode, a capture fan-out, a DELEGATED quality loop) is the reverse: subagents are EXPECTED, and the interesting split is main-session vs per-seat cost - the analyzer reads the session's `subagents/` files and emits both.

## The run

### 1. FIND the transcripts
Claude Code writes one JSONL per session under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<encoded-project-path>/` - the folder whose name is this project's absolute path with every non-alphanumeric character replaced by a dash. List `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/` and take the folder whose name matches, rather than computing it. Grep the `*.jsonl` files there for each SKILLS name (on the DETECT default: for the invocation markers of any installed stack skill) and list which session file(s) contain which skill RUN - invocation markers only, never bare mentions. A `<session-id>/subagents/` folder next to a session file belongs to that session - note it (for the default trio, its existence is already a finding; see the report shape).

With the matches listed, resolve SESSIONS: unless the invocation itself named the scope, this step IS an AskUserQuestion call - fire the run-start ask above with the counts this grep just produced, and only then continue. Never pick a scope yourself and never default to the current session on a bare invocation - the tool call is the step, the prose form of it gets skipped. Self-check before anything runs: when the resolved scope includes the session this audit is running in, stop, restate the fresh-session rule, and put the resolution through ONE AskUserQuestion - **Exclude current session (recommended)**: drop the current id from the scope and note it for the next fresh-session run; **Hand off to a fresh session**: end the turn with the invocation to paste there - never resolve it silently and never audit the live session's own tail; the prose rule alone does not hold, this check is the gate. Then audit EVERY session in the chosen scope - never just the newest, never a silent subset; each audited session gets its own step-4 bundle. One bound keeps repeated sweeps sane, and the test is the REPORT, not the folder: a session is previously-audited when `<docs-path>/usage-report/<session-id>/report-usage.md` exists AND carries no `FILL IN` section - skip that one, list it as previously-audited, and re-audit only on an explicit ask. The folder alone is not the test: it becomes true at the SKELETON write, long before the report is authored, so a run resumed after an interruption would skip its own unfinished bundles as done.

### 2. GET the analyzer
It ships in the stack's source repo, not in this project. LOOK BEFORE DOWNLOADING: where the stack is installed as plugins, the agent tool's own plugin cache already holds the whole repo (`stack/`, `scripts/`, `meta/` and all - it is the repo root the marketplace entries are sourced from), so the newest valid entry there is the snapshot. Downloading before looking is what tripped the harness classifier in 4 audited bundles, and it pays ~1.8s for a 1.4MB archive already on disk:

```bash
TMP=$(mktemp -d "${TMPDIR:-/tmp}/alfred-code.XXXXXX")   # the template names the dir: macOS mktemp -d alone ignores $TMPDIR
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SRC=$(for d in "$CFG"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || [ "$PN" = claude-stack ] || continue   # legacy-name: a 1.x dir until orphaned
  [ -d "$d/stack/skills" ] && [ -d "$d/stack/agents" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$d"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "tmp: $TMP"
echo "src: ${SRC:-absent}"
```

Each Bash call is its own shell, so `$TMP` and `$SRC` are gone by the next call: every later command pastes the two paths this block PRINTED, written `<tmp>` and `<src>` below. Then, when it printed a `src:` path, `cp -R "<src>" "<tmp>/repo"` - nothing is downloaded. Only on `src: absent`:

```bash
curl -fsSL -o "<tmp>/stack.tar.gz" https://github.com/envoydev/alfred-code/releases/latest/download/alfred-code.tar.gz
tar -xzf "<tmp>/stack.tar.gz" -C "<tmp>"
# archive route failed entirely? then:
git clone --depth 1 -b main https://github.com/envoydev/alfred-code "<tmp>/repo"
```

This is `setup-plugin/references/source-protocol.md`'s own lookup order - the entries are keyed by VERSION and the newest valid one wins, so a new release is picked up the moment the plugin updates. Run these as SEPARATE simple commands, not a piped one-liner - the harness's auto-mode classifier blocks the compound verbatim. Then Read `references/run-mechanics.md` now - the batch shape (a loop in a file, never a pipe on the command line), every analyzer flag, and the ledger test live there, and the report's Environment rows carry the receipt `Mechanics: read`. The tool is `scripts/analyze-usage.js` inside the extracted snapshot. Both fetches fail: say so and stop - never rebuild the tool from memory. Record the snapshot revision (the archive's `RELEASE-SOURCE` file, or the clone's HEAD) for the report's Environment section. Remove `<tmp>` at the end of the run, on every exit path - success, failure, or abort.

### 3. RUN it
The directory rollup once, to confirm which sessions matter; then per audited session the full report, the `--json` dump and the `--report-md` skeleton (machine-written tables plus the FILL IN judgment sections), with `--docs-root <root>` on every per-session call when `ALFRED_CODE_DOCS_PATH` names a non-default root - the exact calls are in the mechanics reference.

**Test for the ledgers, never assert their absence.** The test is the reference's one command per session, and its OUTPUT is what the report quotes: `absent` in the report means that command printed `absent`. On a hit, the per-session calls gain `--hook-log <ledger>` (the instrumentation ledger - the who-fired-what identity side the transcript cannot attribute) and `--hook-blocks <file>` (the session's OWN guard-block ledger - the only record of WHICH guard denied a call). No ledger: skip the flag and say so in the report.

### 4. WRITE - one folder per session
Read `references/diagnosis-discipline.md` now, before the first authored row of the first bundle - its checks are this step's gate, not homework: every authored section below is written against them, and the report's Environment rows carry the receipt `Discipline: read`.

Everything for a session lands in `<docs-path>/usage-report/<session-id>/`:

- `report-usage.md` - the filled `--report-md` skeleton: the analyzer's tables stay UNTOUCHED (a number a tool prints cannot be misquoted), and you author only the FILL IN sections, shaped per the section spec below.
- The `--json` dump(s).
- A copy of the session `.jsonl` and its `subagents/` folder when present - the complete raw data, co-located so another agent can analyze it without hunting - only on the consent test below.
- The session's guard-block ledger, COPIED from `<docs-path>/hook-blocks/<sid>.jsonl` and renamed `hook-blocks-<sid>.jsonl` when it exists - one row per BLOCK, naming the hook that fired. Copied rather than moved: the ledger is the project's own running record of what its gates denied. Absent means no block fired this session - say that rather than leaving the reader to guess.
- The session's instrumentation ledgers, MOVED (not copied) from `<docs-path>/tools-usage/` and renamed `tool-usage-<sid>.jsonl` - the session's own and its dispatched agents'. The move is deliberate: an audited run's ledgers live with its bundle, and the collection folder drains as runs get audited instead of accumulating forever; a session not audited this run keeps its ledger in place.

Raw transcripts carry full conversation content - code, file contents, possibly secrets - so the copy is keyed on what git will do with it, never on which docs root is the default. Before the first copy run `git check-ignore -q "<docs-path>/usage-report/<session-id>/x.jsonl"`. Exit 0: git keeps the copies out (the stack's docs `.gitignore` does in both versioning modes) - copy. Any other exit (1 is a folder git can commit, 128 no repo at all): ONE ask before any copy, the answer held for the run:

```ask
Raw transcripts would land in <docs-path>/usage-report/, a folder git can commit. Keep them out of the bundle.
- 'Report and --json dumps only (Recommended)' - the report and the dumps carry counts, tool names and paths, never code
- 'Copy the raw transcripts too' - the whole conversation, code and file contents included, lands where git can commit it
```

Without the copy the bundle holds the report and the `--json` dumps only, and its Environment rows say `raw transcripts: not copied - <the check's exit>`.

`report-usage.md` = the skeleton plus your judgment. The machine sections (Environment, Tokens, Subagent dispatches, Skills, Generated docs, MCP, Inventory vs use, Tools, Efficiency scorecard, Context spikes, Hook-log join - whichever the run emits) stay as printed; `Inventory vs use` is the complement of the consumption tables - what this install HAS against what the session touched, with the unused names collapsed per layer - so a non-use finding cites that section's own row instead of the stack's full catalog, and its source line says whether the denominator came from this project's `.claude` or from the catalog (a directory run resolves the installed set per session and prints `installed K of M, used N`, so 'never used in this collection' is one command over the collection root); you add the Environment rows only you know, insert ONE authored section - `## Per skill run` - between the machine tables and Waste analysis, and fill the skeleton's FIVE FILL IN sections (Guard blocks, Waste analysis, Protocol check, Efficiency verdict, Verdict). `references/diagnosis-discipline.md` owns what each of those sections must carry and the checks every row passes before it is written - one section there per section here, in this order. The sections, one line each:

**## Environment** - append the rows the analyzer cannot know: OS, project stack(s), analyzer snapshot revision, which session file covers which skill run, and the `Mechanics: read` and `Discipline: read` receipts. Models, wall-clock, the Claude Code version and the whole `## Session vintage` block (the install the session loaded, and per skill run whether the body it loaded differs from the current source) arrive machine-written - leave them, and check every 'the session broke rule X' claim against them.

**## Per skill run** (one subsection per SKILLS entry found) - tokens and tool-call counts cited from the tables, whether the run PRODUCED anything, the top 10 most expensive tool RESULTS, the context-growth spikes and their causes, skill/plugin attribution with the main and subagent split, and the dispatch picture, mode-aware.

**## Guard blocks** - a required fill, not a section to pass through: the skeleton's *'EITHER no guard fired OR the ledger was never written - say which, do not infer'* line is a QUESTION addressed to you, answered from the step-3 ledger test's own output in one of the reference's three shapes.

**## Waste analysis** - the specific places token use was disproportionate, each with evidence, ranked by tokens wasted.

**## Protocol check** - for each skill, did the run follow its own protocol? Judge against that skill's own SKILL.md steps and cite turns, never assume. The SHAPE is a table - one row per NUMBERED STEP plus one per hard clause: `step | PASS / VIOLATED / NOT VISIBLE | the turn (timestamp) that settles it` - and its scope is the SESSION, not the skill windows.

**## Efficiency verdict** - two lines, both mandatory, built from the scorecard rows: the TOKEN VERDICT (delivered / cost / avoidable share as a measured number, never an adjective - a session that spent heavily and delivered is a PASS, say so) and the EFFECTIVENESS line (did the work land, how many corrections, how many green claims had no check behind them, how many stops went unheld).

**## Verdict** - one table: skill | worked as intended (y/n) | biggest strength | biggest waste source | one concrete suggestion.

Then append the full-report analyzer outputs verbatim at the end of the doc (they contain only counts, tool names, and paths - no code).

**CHECK the filled report before the bundle is done.** `node <snapshot>/scripts/analyze-usage.js --check-report <bundle>/report-usage.md` prints one row per number in a judgment section that appears in no machine table of that same report and carries no `L<n>` locator that resolves against the transcript beside it. **The bundle is NOT done while it prints a row**: fix each - quote the machine row the number comes from, add the locator, or drop the claim - and re-run until it prints `clean`. The check is the gate, not a suggestion: judgment numbers that contradicted the machine tables three lines above them were the single largest defect family in the audited set.

### 5. SUMMARIZE - the project-wide picture

When this run audited more than one session, or bundles from prior runs already sit in `<docs-path>/usage-report/`, write `<docs-path>/usage-report/SUMMARY.md` - replaced whole, never an append log.

**Rewrite it after EACH bundle closes, not once at the end of the run.** The command that writes a bundle's report writes the summary row in the same turn, so a run that is interrupted, compacted or handed off still leaves a SUMMARY.md naming every bundle finished so far - a summary held to the end is the first thing a long run loses. Rewriting it is cheap: the rows come from the bundles' own `--json` dumps.

- The analyzer's directory rollup table verbatim (`node <snapshot>/scripts/analyze-usage.js <projects-dir>`) - the machine-written per-session totals.
- One line per audited session: id, start date, headline verdict, bundle path.
- A short cross-session judgment, cited from the bundles: the ctx/msg trend across sessions, waste patterns that recur in more than one session (a one-off is the session's finding; a repeat is the stack's), and per-skill cost across sessions where the same skill ran several times.
- The scorecard across sessions: one row per practice with the collection's totals and their denominators (cache misses and the tokens they re-cached, compaction re-reads, build-dir reads, scoped against whole-suite runs, checked commits, green claims with no check, correction streaks beside the short-after-long count, long answers, heavy seats) - these are the numbers a hook or rule change is read from after a week, so they are copied from the `--json` dumps, never re-derived - closing with ONE line: does this stack, in this project, waste tokens, and where.

Then `rm -rf "<tmp>"`.

## Privacy rule
The report body carries aggregates, tool names, token counts, and file PATHS only - never code or file contents. The raw-data copies exist for re-analysis and follow the `git check-ignore` consent test above.

## Don't game it
Numbers come from the analyzer's output, never estimated from memory - a claim without an analyzer line behind it does not go in the report. A protocol-check verdict cites the transcript turn that proves it. If the ledger was absent, the identity attribution is marked unavailable rather than inferred. Suggest - once, briefly - that a re-run with the `instrument-tool-usage` hook active (it ships with the rest; `ALFRED_CODE_INSTRUMENT=1`, and it must not be named in `ALFRED_CODE_HOOKS_OFF`) would add the `--hook-log` join next time; do not block on it.

The step-4 discipline is READ this run, never remembered: a bundle whose Environment rows carry no `Discipline: read` receipt was authored without the checks, and hand-written analysis is the failure mode those checks exist to replace - every wrong or mislabeled claim they guard against came from a report written without them. When a check and your recollection of the transcript disagree, re-open the transcript; the check wins.
