---
name: alfred-capture-stack-usage
description: "Use when the user asks to analyze the stack usage, audit all sessions for this project, or whether the stack is efficient here - the token and tool usage audit of alfred-code skill runs in THIS project. Manual, /-only. It finds EVERY session transcript with a stack-skill run (or the SESSIONS named), runs the stack's analyze-usage.js over each, and writes a per-session report (tokens, tool calls, the efficiency scorecard, waste, protocol check, verdict) plus the raw data for a follow-up agent, and a cross-session SUMMARY.md when several sessions are audited. NOT for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices."
disable-model-invocation: true
---

# Project Stack Usage Analyzer - token/tool report on stack skill runs

You audit what alfred-code skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data beside it. Every bundle answers whether the stack is EFFICIENT here - in tokens and in effectiveness - through the analyzer's scorecard and your authored verdict. Run it from a FRESH session naming the target session ids, never from the tail of the session audited. `references/audit-in-full.md` carries every step below with its reasons and the report's full section spec - read it on a first audit; `references/evidence.md` holds the measurements.

## Inputs
- **SESSIONS** - a scope the invocation names (ids, 'the last 3', a date, 'all') IS the answer. Otherwise, after step 1's grep, ONE AskUserQuestion with the real counts: up to 12 unaudited, oldest first (recommended - the batch bound), all matching (saying N over 12 forces compactions), today's sessions, current session only. Over the bound, audit the oldest 12 and name the resuming invocation.
- **SKILLS** - default DETECT: the stack skills that actually RAN (a `<command-name>` block or a Skill call - a mention is not a run). A single-chat run's cost is all main-context; a dispatch-mode run is expected to have subagents, and its interesting split is main against per-seat.

## The run

1. **FIND** - grep the session JSONLs under `~/.claude/projects/<encoded-project-path>/` for the invocation markers, noting each `<session-id>/subagents/` folder; resolve SESSIONS (the ask is the step - never a scope you picked). A scope that includes THIS session stops on ONE ask: exclude it (recommended) or hand off to a fresh session - never audit the live tail. Audit EVERY session in scope; a session whose `report-usage.md` exists with no `FILL IN` left is previously-audited and skipped.
2. **GET the analyzer** - look in the plugin cache before downloading:

```bash
TMP=$(mktemp -d)
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SRC=$(for d in "$CFG"/plugins/cache/*/alfred-code/* "$CFG"/plugins/cache/*/claude-stack/*; do   # legacy-name: a 1.x dir until orphaned
  [ -d "$d/stack/skills" ] && [ -d "$d/stack/agents" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$d"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
```

   With `$SRC` set, `cp -R "$SRC" "$TMP/repo"`. Only when it is empty:

```bash
curl -fsSL -o "$TMP/stack.tar.gz" https://github.com/envoydev/alfred-code/releases/latest/download/alfred-code.tar.gz
tar -xzf "$TMP/stack.tar.gz" -C "$TMP"
# archive route failed entirely? then:
git clone --depth 1 -b main https://github.com/envoydev/alfred-code "$TMP/repo"
```

   Separate simple commands, never a piped one-liner. Read `references/run-mechanics.md` now (the Environment rows carry `Mechanics: read`). Both routes failing: say so and stop, never rebuild the tool from memory. Record the snapshot revision; remove `$TMP` on every exit path.
3. **RUN** - the directory rollup once, then per session the full report, the `--json` dump and the `--report-md` skeleton (`--docs-root` when the root is not the default). Test for the ledgers with the reference's one command per session and quote its output: a hit adds `--hook-log` / `--hook-blocks`, an absence is said.
4. **WRITE** - read `references/diagnosis-discipline.md` first (`Discipline: read`). Per session, under `<docs-path>/alfred-code-usage-report/<session-id>/`: the filled `report-usage.md` (the analyzer's tables UNTOUCHED; you author the Environment rows, one `## Per skill run` section, and the five FILL IN sections - Guard blocks, Waste analysis, Protocol check, Efficiency verdict, Verdict - each per the discipline file), the `--json` dumps, a copy of the session `.jsonl` and `subagents/` (a COMMITTED docs root asks consent before raw transcripts), the guard-block ledger COPIED, the instrumentation ledgers MOVED. Then `node <snapshot>/scripts/analyze-usage.js --check-report <bundle>/report-usage.md` - the bundle is NOT done while it prints a row; re-run until `clean`.
5. **SUMMARIZE** - with more than one bundle, rewrite `<docs-path>/alfred-code-usage-report/SUMMARY.md` whole after EACH bundle closes: the directory rollup verbatim, one line per session, the cross-session judgment and scorecard copied from the `--json` dumps, and ONE closing line on whether the stack wastes tokens here, and where. Then `rm -rf "$TMP"`.

## Privacy and honesty
The report body carries aggregates, tool names, token counts and file PATHS only - never code or file contents. Numbers come from the analyzer, never memory; a protocol verdict cites the transcript turn; an absent ledger means identity is marked unavailable. Suggest once that `ALFRED_CODE_INSTRUMENT=1` adds the `--hook-log` join next time. The step-4 discipline is READ each run, never remembered.
