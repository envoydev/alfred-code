---
name: capture-usage-report
description: "Use when asked to analyze the stack usage or audit this project's sessions for token and tool cost. Manual, /-only. Not for live cost or fixing findings."
disable-model-invocation: true
---

# Usage Report - token/tool report on stack skill runs

You audit what alfred-code skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data next to it, so a later agent can re-analyze without re-collecting. The question every bundle answers is whether Claude Code with the stack is EFFICIENT in this project - in tokens (what the session paid against what it delivered) and in effectiveness (did the work land, how many corrections it took, how many claims had a check behind them) - so the analyzer prints an efficiency scorecard per session and the report carries an authored efficiency verdict built from it. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

Run the audit from a FRESH session that names the target session id(s) - never from the tail of the session being audited. The work is offline and needs none of the audited chat's context, while an in-session run re-sends its whole context on every message - quote the floor the stop hook measured for this install, or say it is unmeasured, never a fixed figure.

## When to use

- The token and tool usage audit of alfred-code skill runs in THIS project; also for 'whether the stack is efficient here'.
- Not for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices.

**auto-mode.** `--auto-mode` as the first word of the arguments is a mode flag, not a target: the run goes unattended. Each stop takes its `(Recommended)` option and an answered ask is the go, in the same turn; an ask without one waits for the user, the fresh-session hand-off is never taken, nothing is pushed, merged, deployed or sent out, and the hook's `AUTO` stamp in `<data root>/state/approvals/APPROVAL` is the run's approval: write no APPROVED or AUTO line over it, and only the close of the run its `skill:` line names deletes it.

## Privacy rule
The report body carries aggregates, tool names, token counts, and file PATHS only - never code or file contents. The raw-data copies exist for re-analysis and follow the `git check-ignore` consent test in step 4.

## Inputs

### SESSIONS - which of this project's sessions to audit

An invocation that names the scope (session ids, 'the last 3', a since-date, 'all') IS the answer - never re-ask; the one exception is a scope that includes the CURRENT session, which always routes through the fresh-session self-check below. Otherwise resolve the candidates first (step 1's grep), then ask ONE question via AskUserQuestion, each option carrying its real count:

```ask
Which sessions should the audit cover? <N> ran a stack skill, <U> unaudited.
- 'Up to 12 unaudited, oldest first (Recommended)' - the batch bound; a re-run takes the rest
- 'All matching (<U>)' - the run still closes at the bound and names the rest for a re-run
- 'Today's sessions (<T>)' - the matching transcripts started today
- 'Current session only' - the fresh-session self-check below; never audited from its own tail
```

A custom scope arrives via the built-in Other.

Hold the answer for the run. **The batch is BOUNDED - at 12 bundles, or at the first bundle boundary past this install's fresh-session trigger, whichever comes first - and the marker goes on the bounded option, not the largest one.** The gate that ends step 4 decides it after each bundle; on `CLOSE`, close the run naming exactly what is left and the invocation that resumes it.

### SKILLS - the skill names to hunt in the transcripts

Default: DETECT - sweep the transcripts for the stack skills that actually RAN (a `<command-name>` slash block or a Skill-tool call against the installed roster; a name appearing only in injected AGENTS.md/CLAUDE.md/rules text is a mention, not a run) and audit those, stating the detected list in the report. The user can name specific skills instead to narrow the audit.

Two run modes, opposite expectations:

- A single-chat skill (the `task-design` / `task-implement` / `task-verify-plan` trio) runs in-session and dispatches NOTHING - its cost is all main-context, so the interesting numbers are tool-result sizes and cache behavior.
- A dispatch-mode run (`task-solve-cross`, an agents build mode, a capture fan-out, a DELEGATED quality loop) is the reverse: subagents are EXPECTED, and the interesting split is main-session vs per-seat cost - the analyzer reads the session's `subagents/` files and emits both.

## The run

### 1. FIND the transcripts
Claude Code writes one JSONL per session under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<encoded-project-path>/` - the folder whose name is this project's absolute path with every non-alphanumeric character replaced by a dash. List `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/` and take the folder whose name matches, rather than computing it. Grep the `*.jsonl` files there for each SKILLS name (on the DETECT default: for the invocation markers of any installed stack skill) and list which session file(s) contain which skill RUN - invocation markers only, never bare mentions. A marker may carry a plugin prefix, so the pattern allows one: `grep -lE '<command-name>/?([A-Za-z0-9_-]+:)?(<names>)</command-name>|"skill":"([A-Za-z0-9_-]+:)?(<names>)"'`, with `<names>` the skill names joined by `|`; the core's `/alfred-code:*` command runs (setup, update, configure, validate, init) count as stack runs too. A `<session-id>/subagents/` folder next to a session file belongs to that session - note it (for the default trio, its existence is already a finding; see the report shape).

With the matches listed, resolve SESSIONS: unless the invocation itself named the scope, this step IS an AskUserQuestion call - fire the run-start ask above with the counts this grep just produced, and only then continue. Never pick a scope yourself and never default to the current session on a bare invocation. Self-check before anything runs: when the resolved scope includes the session this audit is running in, stop, restate the fresh-session rule, and put the resolution through ONE AskUserQuestion - never resolve it silently, never audit the live session's own tail:

```ask
The scope includes this session (<id>). How should it go?
- 'Exclude current session (Recommended)' - drop its id; note it for the next fresh-session run
- 'Hand off to a fresh session' - end the turn with the invocation to paste there
```

Then audit EVERY session in the chosen scope - never just the newest, never a silent subset; each audited session gets its own step-4 bundle. A previously-audited session is skipped and listed as previously-audited, re-audited only on an explicit ask - the test (the report, never the folder) is in `references/run-mechanics.md`, read at step 2.

### 2. GET the analyzer
It ships in the stack's source repo, not in this project. LOOK BEFORE DOWNLOADING: where the stack is installed as plugins, the agent tool's own plugin cache already holds the whole repo (`stack/`, `scripts/`, `meta/` and all - it is the repo root the marketplace entries are sourced from), so the newest valid entry there is the snapshot.

```bash
TMP=$(mktemp -d "${TMPDIR:-/tmp}/alfred-code.XXXXXX")   # the template names the dir: macOS mktemp -d alone ignores $TMPDIR
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SRC=$(for d in "$CFG"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
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

Run these as SEPARATE simple commands, not a piped one-liner - the harness's auto-mode classifier blocks the compound verbatim. Then Read `references/run-mechanics.md` now - the batch shape (a loop in a file, never a pipe on the command line), every analyzer flag, and the ledger test live there, and the report's Environment rows carry the receipt `Mechanics: read`. The tool is `scripts/analyze-usage.js` inside the extracted snapshot. Both fetches fail: say so and stop - never rebuild the tool from memory. Record the snapshot revision (the archive's `RELEASE-SOURCE` file, or the clone's HEAD) for the report's Environment section. Remove `<tmp>` on every exit path - success, failure or abort.

### 3. RUN it
The directory rollup once, to confirm which sessions matter; then per audited session the full report, the `--json` dump and the `--report-md` skeleton (machine-written tables plus the FILL IN judgment sections), with `--docs-root <root>` on every per-session call when a leftover `ALFRED_CODE_DOCS_PATH` names the root - the exact calls are in the mechanics reference.

**Test for the ledgers, never assert their absence.** The test is the reference's one command per session, and its OUTPUT is what the report quotes: `absent` in the report means that command printed `absent`. On a hit, the per-session calls gain `--hook-log <ledger>` (the instrumentation ledger - who fired what) and `--hook-blocks <file>` (the session's OWN guard-block ledger - WHICH guard denied a call). No ledger: skip the flag and say so in the report.

### 4. WRITE - one folder per session
Read `references/diagnosis-discipline.md` now, before the first authored row of the first bundle - its checks are this step's gate, not homework: every authored section below is written against them, and the report's Environment rows carry the receipt `Discipline: read`. The discipline is READ this run, never remembered: a bundle with no `Discipline: read` receipt was authored without the checks, and hand-written analysis is the failure mode they exist to replace. When a check and your recollection of the transcript disagree, re-open the transcript; the check wins.

**Who writes each bundle.** One session to audit, or no subagent dispatch: write it here. Two or more: one AUTHOR subagent per bundle, at most six at a time, each on a mid-tier model named in the dispatch (`model: 'sonnet'` on Claude Code's Agent call) - never a default seat, which takes this session's model (cost in `references/evidence.md`). Each gets `references/bundle-brief.md` filled in and returns one line; this session keeps step 5 and its spot check.

**Gather with the reader, never a helper script.** Each bundle starts with `node <snapshot>/stack/skills/capture-usage-report/scripts/transcript-view.js pack <transcript> <usage json> --out <tmp>/<sid>-evidence.md`: the typed prompts, every ask with its answer, the skill, command and dispatch runs, the errored tool results (the seats' too), and each moment the analyzer flagged with the rows before it - every line an `L<n>` locator. It quotes the transcript, so it stays in `<tmp>`, out of the bundle. A row it does not hold comes from the same script - `timeline`, `show <L>`, `grep <regex>` - never one written for the occasion.

Everything for a session lands in `<data root>/statistics/usage-report/<session-id>/` (`<data root>`: `.alfred`, or `ALFRED_CODE_DATA_PATH`):

- `report-usage.md` - the filled `--report-md` skeleton: the analyzer's tables stay UNTOUCHED (a number a tool prints cannot be misquoted), and you author only the FILL IN sections, shaped per the section spec below.
- The `--json` dump(s).
- A copy of the session `.jsonl` and its `subagents/` folder when present - the complete raw data, co-located so another agent can analyze it without hunting - only on the consent test below.
- The session's guard-block ledger, COPIED from `<data root>/statistics/hook-blocks/<sid>.jsonl` and renamed `hook-blocks-<sid>.jsonl` when it exists - one row per BLOCK, naming the hook that fired. Copied, never moved: the project keeps its own record. Absent means no block fired this session - say that rather than leaving the reader to guess.
- The session's instrumentation ledgers, MOVED (not copied) from `<data root>/statistics/tools-usage/` and renamed `tool-usage-<sid>.jsonl` - the session's own and its dispatched agents'. A session not audited this run keeps its ledger in place.

Raw transcripts carry full conversation content - code, file contents, possibly secrets - so the copy is keyed on what git will do with it. Before the first copy run `git check-ignore -q "<data root>/statistics/usage-report/<session-id>/x.jsonl"`. Exit 0: git keeps the copies out - copy. Any other exit (1 is a folder git can commit, 128 no repo at all): ONE ask before any copy, the answer held for the run:

```ask
Raw transcripts would land in <data root>/statistics/usage-report/, a folder git can commit. Keep them out of the bundle.
- 'Report and --json dumps only (Recommended)' - the report and the dumps carry counts, tool names and paths, never code
- 'Copy the raw transcripts too' - the whole conversation, code and file contents included, lands where git can commit it
```

Without the copy the bundle holds the report and the `--json` dumps only, and its Environment rows say `raw transcripts: not copied - <the check's exit>`.

`report-usage.md` = the skeleton plus your judgment. The machine sections (whichever the run emits - listed in `references/run-mechanics.md`, with what `Inventory vs use` scores) stay as printed, and a non-use finding cites the `Inventory vs use` row, never the stack's full catalog; then fill the skeleton's FIVE FILL IN sections (Guard blocks, Waste analysis, Protocol check, Efficiency verdict, Verdict), insert ONE authored `## Per skill run` (one subsection per SKILLS entry found) between the machine tables and Waste analysis, and append the Environment rows only you know (OS, project stack(s), analyzer snapshot revision, which session file covers which skill run, the `Mechanics: read` and `Discipline: read` receipts) - the Models, wall-clock, Claude Code version and `## Session vintage` rows arrive machine-written. `references/diagnosis-discipline.md` defines each section and the checks every row passes before it is written - one section there per section here, in this order.

Then append the full-report analyzer outputs verbatim at the end of the doc (they contain only counts, tool names, and paths - no code).

**CHECK the filled report before the bundle is done.** `node <snapshot>/scripts/analyze-usage.js --check-report <bundle>/report-usage.md` prints one row per number in a judgment section that appears in no machine table of that same report and carries no `L<n>` locator that resolves against the transcript beside it. **The bundle is NOT done while it prints a row**: fix each - quote the machine row the number comes from, add the locator, or drop the claim - and re-run until it prints `clean`.

**Then gate the batch - the bundle's last command, from the project root:** `node <snapshot>/stack/skills/capture-usage-report/scripts/bundle-gate.js --done <bundles closed this run> --summary <data root>/statistics/usage-report` - run here as each bundle closes, an author's too. It reads this session's context the way the fresh-session Stop offer does and rewrites SUMMARY.md's bundle list (step 5). `BUNDLE-GATE: next` runs the next bundle; `BUNDLE-GATE: CLOSE` ends the batch here - at 12 bundles, or past this install's fresh-session trigger - and the close names every session left and the invocation that resumes it from a fresh session. A line that says only the bound applies (no transcript found, context unknown after a compaction) still holds you to 12.

### 5. SUMMARIZE - the project-wide picture

When this run audited more than one session, or bundles from prior runs already sit in `<data root>/statistics/usage-report/`, write `SUMMARY.md` there - rewritten whole, never an append log.

**Its bundle list is rewritten after EACH bundle, by the gate call that ends step 4** (`--summary`): one row per bundle folder - id, start date, headline verdict, bundle path, an unfinished one marked in progress - between the gate's two marker comments. The sections below are written at the end of the run AROUND that block: keep the two markers and the rows between them as the gate wrote them, never hand-write those rows.

- The analyzer's directory rollup table verbatim (`node <snapshot>/scripts/analyze-usage.js <projects-dir>`) - the machine-written per-session totals.
- A short cross-session judgment, cited from the bundles: the ctx/msg trend across sessions, waste patterns that recur in more than one session (a one-off is the session's finding; a repeat is the stack's), and per-skill cost across sessions where the same skill ran several times.
- The spot check, when authors wrote the bundles: the two with the most flagged moments in their pack, one Waste row and the Verdict's cited `L<n>` each, re-opened with `transcript-view.js show` - a row the line does not bear out is fixed here or sent back to its author once, and the SUMMARY says which rows were checked and what held.
- The scorecard across sessions: one row per practice with the collection's totals and their denominators (cache misses and the tokens they re-cached, compaction re-reads, build-dir reads, scoped against whole-suite runs, checked commits, green claims with no check, correction streaks beside the short-after-long count, long answers, heavy seats) - copied from the `--json` dumps, never re-derived - closing with ONE line: does this stack, in this project, waste tokens, and where.

Then, alone in the run's last Bash call, `rm -rf "<tmp>"` with the printed path.

## Don't game it
Numbers come from the analyzer's output, never estimated from memory - a claim without an analyzer line behind it does not go in the report. A protocol-check verdict cites the transcript turn that proves it. If the ledger was absent, the identity attribution is marked unavailable rather than inferred. Suggest - once, briefly - that a re-run with the `instrument-tool-usage` hook active (it ships with the rest; `ALFRED_CODE_INSTRUMENT=1`, and it must not be named in `ALFRED_CODE_HOOKS_OFF`) would add the `--hook-log` join next time; do not block on it.

