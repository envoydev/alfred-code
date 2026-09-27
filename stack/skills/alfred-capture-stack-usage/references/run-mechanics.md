# Stack usage audit - run mechanics (steps 2-3)

Read at step 2, once the snapshot is on disk, and before the first analyzer call; the report's Environment rows carry `Mechanics: read` as the receipt. This file holds the command shapes - the body holds the rules about when each runs.

## The batch shape - a file, not a pipe

The harness's auto-mode classifier blocks a piped compound (`curl | tar || git clone`) verbatim, and a denied pipe costs a cold clone; a loop it reads fine, and at real scope a loop is unavoidable (a per-session command times N sessions is N calls). So write the batch to a file and execute the file - one simple command the classifier reads as one, with the loop inside the file rather than inside the command line:

```bash
cat > "$TMP/run.sh" <<'EOF'
for f in <the session files>; do
  sid=$(basename "$f" .jsonl)
  FLAGS=()                                   # optional flags go in an ARRAY, never an eval string
  [ -f "<docs-path>/tools-usage/$sid.jsonl" ] && FLAGS+=(--hook-log "<docs-path>/tools-usage/$sid.jsonl")
  [ -f "<docs-path>/hook-blocks/$sid.jsonl" ] && FLAGS+=(--hook-blocks "<docs-path>/hook-blocks/$sid.jsonl")
  node "<snapshot>/scripts/analyze-usage.js" "$f" --report-md "${FLAGS[@]}" --out "<out>/$sid/report-usage.md"
done
EOF
bash "$TMP/run.sh"
```

`<snapshot>` = `$TMP/repo` when the plugin cache or the clone fallback supplied it, `$TMP` when the archive extracted in place.

Two shapes in there are not style, they are what the harness accepts:

- **Optional flags go in a bash ARRAY** (`FLAGS=(); FLAGS+=(--hook-log "$f"); "${FLAGS[@]}"`), never an `eval` of a flags string: `eval` trips the harness's own `Auto-Mode Bypass` classifier, and the array rewrite of exactly that command ran 12 sessions with 0 errors (measured).
- **`--out <file>`, never a `>` redirect.** The classifier denies `analyze-usage.js ... --report-md > .../report-usage.md` verbatim - measured A/B in one run: the same command passed only after the target was renamed to a draft and `mv`'d into place, 6 Bash round trips and ~10.5 min lost. `--out` is the tool's own flag, so there is no redirect to read.

## The analyzer calls

- `node <snapshot>/scripts/analyze-usage.js <projects-dir>` - one-line rollup, to confirm which sessions matter (and the SUMMARY.md rollup table). The walk is RECURSIVE, so a whole collection root - `<corpus>/<project>/<session-id>/<session-id>.jsonl` with `subagents/` and the ledgers beside each - is one command, and a flat history folder is the same call. A session is any `*.jsonl` that is not under a `subagents/`, `tools-usage/` or `hook-blocks/` directory and not named `tool-usage-<sid>` / `hook-blocks-<sid>`: a dispatched seat is counted under its parent, and a ledger is not a session (it used to open a row per file with a `?` start).
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl>` - full report, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --json` - machine dump, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --report-md --out <out>/<sid>/report-usage.md` - the report SKELETON: machine-written tables (Environment, Session vintage, Tokens, Subagents, Skills, Generated docs, MCP, Inventory vs use, Tools, Efficiency scorecard, Context spikes, Hook-log join) plus the FILL IN judgment sections. Add `--hook-log` here too when the ledger exists (below).
- `node <snapshot>/scripts/analyze-usage.js --check-report <out>/<sid>/report-usage.md` - the LAST call of every bundle. It reads the FILLED report and prints one row per number in a judgment section that appears in no machine table of that same report and carries no `L<n>` locator resolving against the transcript beside it (an out-of-range `L<n>` is named too). Exit 1 while a row prints, 0 on `clean`. The bundle is not done until it prints `clean`.
- Non-default docs root: add `--docs-root <that root>` to every per-session call. Read the root off the always-on `.claude/rules/baseline-docs-root.md` rule text already in this prompt - never grep `.claude/settings.json` for it: that file also holds credentials, so the secret guard blocks the command carrying the read and the round trip costs ~0.19M tokens (measured). The analyzer's Generated-docs table watches only the default `.alfred/docs/` and the pre-2.0.0 `.claude/docs/` by default, so a custom root silently drops every doc touch. The flag covers BOTH routes (the Read/Write calls and the doc I/O routed through Bash); it used to reach only the first, which made the table disagree with itself.
- `--inventory <.claude dir>` / `--plugins <installed_plugins.json>` - what the INVENTORY vs USE block scores the session against. Both resolve on their own and neither is usually needed: the inventory is resolved PER SESSION from that session's own `cwd`'s `.claude` when that path exists on this machine (cached per cwd, so a one-project folder resolves once), falling back to the stack catalog beside the script (labeled `catalog (installed set unknown)` - it proves the stack SHIPS the artifact, never that this project installed it), and the plugin list to `$CLAUDE_CONFIG_DIR`, then `~/.claude/plugins/installed_plugins.json`. Per session, because a collection spans projects that installed different things: every name carries `installed K/M` beside `used N/M`, and a name no session installed is never reported as unused. Pass them when auditing a bundle collected from ANOTHER machine and that project's `.claude` is reachable here - a catalog-sourced denominator answers 'the stack has 77 skills', a project-sourced one answers 'this install has N'. The MCP side reads the `.mcp.json` beside a project inventory, and the servers seen in tool names otherwise.
- The INVENTORY vs USE block is the complement of every consumption table - which installed skill, agent, rule, plugin and MCP server the session never touched. It renders with no flag: the `INVENTORY vs USE` block in the full report, `## Inventory vs use` in the skeleton, `inventory` in `--json`, and in DIRECTORY mode the corpus answer - `installed in K of M sessions, used in N` per name plus the never-used set per layer, each name carrying its own install count where the installs differ. That is the one command 'unused in this corpus' used to need a throwaway script for; point it at the collection ROOT, not one project. Read the `how` column before scoring a row: a skill can be paid for in full through a seat's frontmatter preload and show zero calls; an always-on rule is in every prompt, so its use is not observable at all and says so; a path-scoped rule is scored from the records that name it (the harness's `nested_memory` attach and `guard-read-whole-file.js`'s shell-route notice) with a glob proxy over the touched files as the floor under them; and a plugin that ships only HOOKS can never score used, because a hook leaves no transcript record.
- Every per-session output carries the EFFICIENCY scorecard with no flag - the `EFFICIENCY` block in the full report, `## Efficiency scorecard` in the skeleton, `main.efficiency` plus `dispatchOverhead` in `--json`. A Windows session's shell calls arrive as the `PowerShell` tool and are read like Bash (measured: 34 of the 38 test runs in one collection ran through it, and every Bash-only counter reported zero for those sessions).

## Reading a transcript by hand - one LINE can be 50k tokens

A transcript row is one JSONL line, and a single row carries a whole tool result: measured, 53,849
tokens for ONE line, and three Reads of the same copy failed on the harness's own 25k cap - the
last of them at `offset=6, limit=1`, which is a single line. Never Read a transcript copy to find
something; the analyzer's `--json` answers most of it already. When a specific row is needed,
extract it with `jq -c` per line and CUT the output - `jq -c` alone still emits the 50k-token row:

```bash
sed -n '250p' "$f" | jq -c '{type, ts: .timestamp, role: .message.role}'          # one row, keys only
jq -c '{type, ts: .timestamp}' "$f" | cut -c1-300 | sed -n '200,260p'             # a window of rows
sed -n '250p' "$f" | jq -r '.message.content[]? | select(.type=="text") | .text' | cut -c1-2000
sed -n '250p' "$f" | jq -r '.message.content[]? | select(.type=="tool_use") | .name'
```

`cut -c` is what bounds the result. A `jq` over a 40MB transcript is seconds; a Read of it is a
denial plus the retry.

## The ledger test - one command per session, its output quoted

Never assert a ledger's absence from a prose instruction; run this for each audited session and quote what it prints:

```bash
for d in tools-usage hook-blocks; do
  f="<docs-path>/$d/<sid>.jsonl"
  [ -f "$f" ] && echo "$d: $f ($(wc -l < "$f") rows)" || echo "$d: absent"
done
```

`absent` in the report means that command printed `absent` for that session. The instrumentation ledgers: `ALFRED_CODE_INSTRUMENT=1` writes one per session/agent id under `<docs-path>/tools-usage/<sid>.jsonl` (or wherever `ALFRED_CODE_INSTRUMENT_LOG` pointed) - check that folder for the session's own id and its dispatched agents' ids; on a hit add `--hook-log <ledger>` to the per-session calls - it joins the who-fired-what identity side the transcript alone cannot attribute. No ledger: skip the flag and say so in the report. The guard-block ledger: `<docs-path>/hook-blocks/<sid>.jsonl`, checked the same way; on a hit add `--hook-blocks <that file>` - the session's OWN file. The tool narrows a directory to `<session-id>.jsonl`, but name the file anyway: it says which session you meant. That ledger is the only record of WHICH guard denied a call (the transcript names the denied tool and nothing else), and a block costs its denial text plus the retried turn, so the per-hook block rate is what says a gate earns its keep.
