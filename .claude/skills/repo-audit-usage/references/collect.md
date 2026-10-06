# Usage audit - Phase A collect

Read at Phase A - skipped entirely when the evidence answer was to audit what is already collected.

Once per project in `projects[]`; the Q-DATA answer picks that project's route. Destination is
always `<alfred-code repo>/docs/session-investigation/<project>/`.

**Route 1 - the data is already generated.** Copy the WHOLE bundle set the project holds -
`SUMMARY.md`, `_rollup.txt` as `rollup.txt`, and every per-session folder entire - out of
`<project>/.alfred/docs/usage-report/` (`alfred-code-usage-report/` on an install not updated since 2.1.6; or its `ALFRED_CODE_DOCS_PATH` root - the settings value wins; `<data root>/docs` since 2.1.0, `.claude/docs` on an install from before 2.0.0 that kept its old root). Add the
two ledgers per session from that same root (`tools-usage/<sid>.jsonl`, `hook-blocks/<sid>.jsonl`)
where the bundle does not already carry them. Nothing is generated. A session in scope with no
bundle is reported as missing, and generated only under the `fill-gaps` answer.

**Route 2 - generate, `authored` sections.** `/capture-usage-report` must run in a fresh
session INSIDE that project's root - it is the only route that fills the judgment sections. Invoke
it with the scope answer, let it write one bundle per session plus its `SUMMARY.md` under the
project's docs root, then copy the set as in route 1. For a project you are not in, name it as a
run the user starts there, and carry on with the other projects rather than blocking.

**Route 3 - generate, `skeleton` sections.** Nothing runs inside the audited project - Claude Code
already stores its history, and this route reads it from here.

1. Resolve each project's history folder: one folder per project under `<config-dir>/projects/`,
   named by the absolute project path with every `/` replaced by `-`. There can be MORE THAN ONE
   config dir (`~/.claude` plus any `CLAUDE_CONFIG_DIR` space), so glob `~/.claude*/projects/` and
   take every match, not the first. No folder means no history on this machine: record the project
   as skipped, create no empty bundle, carry on.
2. Rollup once per history folder - `node scripts/analyze-usage.js <history-dir> --out <file>` (the
   rollup already leaves the live session out, `CLAUDE_CODE_SESSION_ID`; `--exclude-session <id>` drops
   another) - apply the scope answer, drop what is already collected, and print the resolved session
   list (the list, never the analyzer output).
3. Write `<DEST>/<project>/<session-id>/` per session:

| Artifact | How |
|---|---|
| `analyzer.json` | `node scripts/analyze-usage.js <transcript> --json --out .../analyzer.json` - `--out`, never a `>` redirect, which the permission classifier denies |
| `analyzer-full.txt` | the same call without `--json` |
| `report-usage.md` | `--report-md --out <file>` (skeleton), or the authored file from the project route |
| `<session-id>.jsonl` | copy of the transcript - ground truth, and the ONLY artifact carrying the actual messages |
| `subagents/` | copy of the transcript's sibling folder when it exists |
| `tool-usage-<sid>.jsonl` | the instrumentation ledger from the project's docs root (`<project>/.alfred/docs/tools-usage/<sid>.jsonl`, or its `ALFRED_CODE_DOCS_PATH` root) |
| `hook-blocks-<sid>.jsonl` | the guard-block ledger from the same root - the only place naming WHICH hook denied a call |

   Pass `--hook-log <ledger>`, `--hook-blocks <that session's file, never the directory>` and
   `--docs-root <root>` for a non-default docs path; say so per session when a ledger is absent.
4. Write `<DEST>/<project>/rollup.txt`, and `SUMMARY.md` when the project contributed more than one
   session, so the audit's Phase 0 has its orientation file.

Report the collection before going on: projects collected and by which route, projects skipped for missing history,
sessions per project, total size, both gitignore checks. On the `collect only` answer, stop here
and name the audit as the next run.
