# Hook audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Five dimensions, 100 points per hook. Every point cites its evidence. A dimension below its floor caps the grade at B whatever the total.

**D1 - Placement (15 pts, floor 9).** The job is deterministic (a gate at a discrete event, a reaction, a record) and not a judgment dressed as a regex; a static allow or deny that the permission system can express is not re-implemented as a hook; the event fits the job (`PreToolUse` gates, `PostToolUse` reacts, `Stop` gives the verdict, `UserPromptSubmit` and `SessionStart` inject, a hook whose `Stop` needs the final text reads `last_assistant_message`, never the lagging transcript); no second hook does the same job on the same event; the handler runs on every platform the stack installs to.

**D2 - Contract correctness (20 pts, floor 12).** A block is exit 2 (or a `permissionDecision: "deny"` / `decision: "block"` on exit 0) and never exit 1; JSON fields at the right nesting - `permissionDecision`, `permissionDecisionReason`, `additionalContext`, `updatedInput` inside `hookSpecificOutput` with `hookEventName`, `continue` / `stopReason` / `systemMessage` at the top; the deny reason is written for the model (it is the only party that sees a deny reason) and names the escape; matchers verified against the rules (case-sensitive; exact strings or `|` / `,` lists; any other character makes an unanchored regex, so `Edit.*` also matches `NotebookEdit`; MCP tools as `mcp__<server>__<tool>` with `.*` required to cover a server; no matcher on the events that ignore one - `UserPromptSubmit`, `Stop`, `PostToolBatch`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `MessageDisplay`; `DirectoryAdded` takes one - how the directory was added); the `if` field used where it saves a spawn, never as the hard gate (it is best-effort); exec form (`args`) or a quoted `"$CLAUDE_PROJECT_DIR"` shell form; stdin parsed with a JSON parser; an unexpanded `$VAR` never judged; a `Stop` hook reading `stop_hook_active` (Claude Code overrides a Stop hook that blocks eight times in a row without progress; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` moves the cap); a path check on `tool_input.file_path` that normalises Windows backslashes and matches a segment (the path is always absolute); at most ONE hook rewriting a given tool's input through `updatedInput` (with two, the last to finish wins); every output string under the 10,000-character cap; a `timeout` on every wired entry.

**D3 - Cost and latency (10 pts, floor 5).** Per-call latency measured on the hot events (`PreToolUse` / `PostToolUse` fire on every matching call); heavy checks (a build, a whole-suite run, a type check) moved to `Stop` or run `async` (`asyncRewake` where a background failure must wake the model); side-effect-only work (logging, notification) `async`; matchers and `if` as narrow as the job allows; the block rate read against its denominator over the week; the denial text lean (its length is paid on every block plus the retried turn); the ledger write itself cheap (append, one row).

**D4 - Safety of the hook itself (20 pts, floor 12).** Inputs validated, shell variables quoted, path traversal checked, absolute paths through the project placeholder; no network egress, no write to any `settings*.json`, no permission rewrite, no credential VALUE in any output (presence only, redacted views where a rewrite is the answer); receipts session-own, expiring, and never containing the project root itself; a quoted string in a command read as prose, a runtime expression that only counts read as not a dump; a hook tightens and never loosens (no `allow` that would skip a prompt the mode would have raised; a `PermissionRequest` `allow` cannot override a deny rule anyway); no infinite `Stop` loop; the denial ends in a decision (the ask) rather than a retry storm; the untrusted-repo posture stated (a committed hook runs in `-p` without a trust dialog, so `--bare` or a hooks-off run is the review posture for a repo you did not write).

**D5 - Evidence and observability (20 pts, floor 12).** A measured incident behind the gate, quoted; tests replaying that shape on EVERY route the hook covers (tool and shell, and `PowerShell` where the stack installs to Windows), plus the false positive it once produced; a ledger row per block carrying hook, event, tool and reason; the analyzer's per-hook block rate read this run; the observation week honoured for anything seeded within it; the wiring proven from `/hooks` (the read-only browser, which also names the settings file each entry came from) or the debug log, not from a restart (settings edits are picked up by the file watcher, so a restart proves nothing); a claimed behavioural change carried by sessions recorded after it.

**D6 - Fit with the root (15 pts, floor 9).** Scored from the Phase 0 fit map, both sides quoted. The hook `mechanizes` a mandate that lives in a house rule or skill (an `orphan` gate has no why the next maintainer can read); every receipt it `honours` is written by a named skill step with the scope and lifetime the hook reads; its denial `names` the governing rule and the tool-loading line where the escape needs a deferred tool; no `double home` (the prose mandate retired to a pointer); no `contradicts` row standing (a flow step or agent action the hook denies with no receipt path is a MATERIAL defect - the flow loses or the hook loses, never both live); no `shadows` row (an injection that repeats an always-on rule's text pays for it twice). For a child hook the same dimension reads its `collides` / `duplicates` / `contradicts` rows: a shared event with overlapping jobs or conflicting decisions, a house job done twice, or injected guidance against a house rule each fail the floor, and the resolution is owned by the plugin audit (`repo-audit-plugin`, its D5 fit dimension) - this audit reports the row and the recommended home.

## Set-level defects

Scored once for the whole set and blocking every implicated hook from A until resolved:

- A coverage gap: a must-never action with no hook, no permission rule and no recorded decline.
- A double home: a hook and a live prose mandate for the same trigger.
- A route gap: a gate on one route to an action and none on another (the tool but not the shell, the shell but not the PowerShell tool).
- A wiring drift: the manifest, the generated core entry, the copy-route writer and a deployed `settings.json` disagreeing on events, matchers, timeout or the retired set.
- A collision: two hooks on one event and matcher with overlapping jobs and no recorded order and cost - a house pair, or a house hook and a child hook.
- A contradiction: a rule, skill step or agent brief instructing what a hook denies, with no receipt path between them.
- An unbounded child hook on a hot event: a plugin entry with no timeout on `PreToolUse` / `PostToolUse` / `Stop` / `UserPromptSubmit`, since one stalled child freezes the session for ten minutes and the stack cannot stamp it.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A hook reaches A / 9 only when the total is 90 or more and every dimension clears its floor. A hook that exits 1 where it means to block, or that judges an unparsed input, is capped at C whatever else it does - a gate that does not gate has no other merit to average in.
