#!/usr/bin/env node
'use strict';

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('instrument-tool-usage')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}

// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// instrument-tool-usage.js - env-gated PreToolUse instrumentation (wired by default, OFF by default).
//
// Why: the orchestrator cannot see which Skill / MCP a dispatched subagent loaded or
// called - only that subagent's aggregate token/tool_use totals. That makes a real run's
// tool / skill / MCP usage un-auditable (an audit or benchmark can only ASSESS it, not
// MEASURE it). This hook logs every tool call - built-ins (Read / Edit / Grep / Bash / Task / ...)
// plus `Skill` and `mcp__*` - as one JSONL line so a run can be tallied exactly. It NEVER blocks
// a call - it observes and exits 0.
//
// The installer wires this on matcher '.*' behind a shell gate - `[ "$ALFRED_CODE_INSTRUMENT" != "1" ] ||` -
// so when the switch is off the per-call cost is a shell test, never a node spawn. The switch is
// `ALFRED_CODE_INSTRUMENT` in .claude/settings.json env, seeded "0": flip it to "1" for a measured
// benchmark / audit run (optionally ALFRED_CODE_INSTRUMENT_LOG=<path>), back to "0" after. The env check
// below is the belt for a gate-less manual wiring: only the literal value 1 (or true) records.
//
// Output: one JSONL row per matched call at
//   $ALFRED_CODE_INSTRUMENT_LOG  (default: <docs-path>/tools-usage/<session-or-agent-id>.jsonl,
//   the docs root resolved from ALFRED_CODE_DOCS_PATH like every generated artifact)
// Coverage note: PreToolUse fires for the session's tool calls; where the running Claude
// Code build propagates PreToolUse into dispatched subagents, their internal Skill / MCP
// calls are captured too - verify coverage against a known run before trusting a tally.

// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.claude/docs';

const sw = String(envOf(process.env, 'INSTRUMENT') || '').toLowerCase();
if (sw !== '1' && sw !== 'true') process.exit(0); // off unless explicitly switched on ("0"/"false"/unset = no-op)

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw || '{}');
    const tool = ev.tool_name || '';
    if (!tool) { process.exit(0); }
    const input = ev.tool_input || {};
    const path = require('path');
    const fs = require('fs');
    // Every tool call is logged (built-ins like Read/Edit/Grep/Bash/Task + Skill + mcp__*).
    // `detail` is a lightweight, non-sensitive hint per tool family - NEVER a command body,
    // file contents, or a full payload: the skill slug, the mcp server, a file's basename,
    // a search pattern, or a Bash step's description.
    let detail = null;
    if (tool === 'Skill') detail = input.skill || input.name || null;
    // A PLUGIN server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, so the segment between
    // the double underscores is `plugin_<plugin>_<server>`, not the server. Server names carry no
    // underscore, so dropping `plugin_<plugin>_` is one split - and a bare `mcp__<server>__` row
    // from a pre-1.0.0 registration still reads the same.
    else if (tool.startsWith('mcp__')) {
      const seg = tool.split('__')[1] || null;
      detail = seg && seg.startsWith('plugin_') ? (seg.slice(7).split('_').slice(1).join('_') || seg) : seg;
    }
    // A dispatch row with no detail cannot say WHICH seat ran - 65 of 65 Agent rows in an audited
    // corpus carried `detail: null`, so the ledger could name the cost of dispatching and never the
    // seat. The seat type is the one field that makes those rows readable, and it is not sensitive.
    else if (tool === 'Task' || tool === 'Agent') detail = input.subagent_type || input.subagentType || (input.description ? String(input.description).slice(0, 60) : null);
    else if (input.file_path) detail = path.basename(String(input.file_path));
    else if (input.pattern) detail = String(input.pattern).slice(0, 60);
    // Bash `description` is the model's to write and it is often omitted (measured: 10 of 11 rows
    // in one session, so the whole session read as detail-blind). Fall back to the command's VERB -
    // the first token, plus a second one only when it is a bare subcommand (`git commit`, `npm
    // test`): no path, no flag, no argument, so nothing sensitive can ride along.
    else if (tool === 'Bash') {
      if (input.description) detail = String(input.description).slice(0, 60);
      else {
        const tok = String(input.command || '').trim().split(/\s+/).filter(Boolean);
        const verb = tok[0] && /^[A-Za-z][\w.-]*$/.test(tok[0]) ? tok[0] : null;
        const sub = verb && tok[1] && /^[a-z][a-z0-9:._-]*$/.test(tok[1]) ? tok[1] : null;
        detail = verb ? (sub ? `${verb} ${sub}` : verb) : null;
      }
    }
    const rec = {
      ts: new Date().toISOString(),
      session: ev.session_id || null,
      tool,
      detail,
      cwd: ev.cwd || null,
    };
    const dir = process.env.CLAUDE_PROJECT_DIR || ev.cwd || '.';
    // one ledger per session/agent id - the filename matches the transcript's id for the --hook-log join
    const sid = String(ev.session_id || 'session').replace(/[^A-Za-z0-9._-]/g, '');
    const docsRoot = docsRootEnv();
    const out =
      envOf(process.env, 'INSTRUMENT_LOG') ||
      path.resolve(dir, docsRoot, 'tools-usage', `${sid}.jsonl`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  } catch {
    // never break a tool call because instrumentation hiccuped
  }
  process.exit(0);
});
