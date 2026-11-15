# Usage audit - Phase A collect

Read at Phase A - skipped entirely when the evidence answer was to audit what is already collected.

Once per project in `projects[]`; the Q-DATA answer picks that project's route. Destination is
always `<DEST>/<project>/`, where `<DEST>` is the collection root step 0 found among `roots` (the first
root when none exists yet - create it, and prove it gitignored before the first copy).

**Route 1 - the data is already generated.** Copy the WHOLE bundle set the project holds -
the summary, the rollup as `rollup.txt`, and every per-session folder entire - out of the folder where the
plugin writes a project's usage reports (a `notes` line names it, with the older locations an install not yet
updated keeps them in). Then, for each copied session folder with no collector receipt: when that session's
transcript is on this machine (the history folders of route 3 step 1), run the collector a note names on that
transcript into that folder - it adds the ledgers, the state and the receipt beside the copy; else report
`collected: none (older bundle)` for it and add the project's ledgers for that session (a note names where they
live) where the bundle does not already carry them. No report is generated. A session in scope with no
bundle is reported as missing, and generated only under the `fill-gaps` answer. A plugin that writes no
per-project reports has no route 1: say so in Q-DATA.

**Route 2 - generate, `authored` sections.** The per-project report skill a note names must run in a fresh
session INSIDE that project's root - it is the only route that fills the judgment sections. Invoke
it with the scope answer, let it write one bundle per session plus its summary where it writes them, then copy
the set as in route 1. For a project you are not in, name it as a run the user starts there, and carry on with
the other projects rather than blocking. With no report skill named, route 2 does not exist.

**Route 3 - generate, `skeleton` sections.** Nothing runs inside the audited project - Claude Code
already stores its history, and this route reads it from here.

1. Resolve each project's history folder: one folder per project under `<config-dir>/projects/`,
   named by the absolute project path with every `/` replaced by `-`. There can be MORE THAN ONE
   config dir (`~/.claude` plus any `CLAUDE_CONFIG_DIR` space), so glob `~/.claude*/projects/` and
   take every match, not the first. No folder means no history on this machine: record the project
   as skipped, create no empty bundle, carry on.
2. Rollup once per history folder - the analyzer a note names, over the history folder, its output to a file
   (leave the live session out - `CLAUDE_CODE_SESSION_ID` names it - and any other the scope drops); with none,
   a `jq` count per transcript of messages, tokens deduped by message id and the first and last timestamps.
   Apply the scope answer, drop what is already collected, and print the resolved session list (the list,
   never the analyzer output).
3. Write `<DEST>/<project>/<session-id>/` per session, the collector first - it makes the folder:

| Artifact | How |
|---|---|
| the collector's bundle | the collector a note names, on the transcript, out to `<DEST>/<project>/<session-id>` - the transcript (ground truth, and the ONLY artifact carrying the actual messages), `subagents/`, its receipt, the collect-time context, the ledgers, the session's state, its docs and hook temp files. With none named: copy the transcript and its `<session-id>/` folder (`subagents/`, `tool-results/`) as they are, and record `collected: by hand (no collector)` |
| analyzer JSON | the analyzer a note names, on the COPY, never the original, in its JSON mode, written by its own output flag - never a `>` redirect, which the permission classifier denies |
| analyzer text | the same call without the JSON mode |
| a usage report | the analyzer's report-skeleton mode, or the authored file from the project route |

   The analyzer reads the ledgers beside the copy itself where it can; pass it a non-default docs path where a
   note says it takes one. A ledger the receipt names `absent` is reported per session with that row's reason.
4. Write `<DEST>/<project>/rollup.txt`, and `SUMMARY.md` when the project contributed more than one
   session, so the audit's Phase 0 has its orientation file.

Report the collection before going on: projects collected and by which route, projects skipped for missing history,
sessions per project, total size, both gitignore checks. On the `collect only` answer, stop here
and name the audit as the next run.
