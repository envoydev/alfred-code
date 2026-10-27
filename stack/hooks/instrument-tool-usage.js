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
// This hook rides the core plugin (2.0.0 - no shell gate wrapper): the generated entry launches it
// on matcher '.*' as a plain `node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/instrument-tool-usage.js"`, so
// when the switch is off the per-call cost is a node spawn that exits at the check below, not a
// shell test. The switch is `ALFRED_CODE_INSTRUMENT` in .claude/settings.json env, seeded "0": flip
// it to "1" for a measured benchmark / audit run (optionally ALFRED_CODE_INSTRUMENT_LOG=<path>),
// back to "0" after. The env check below is what actually gates every call.
//
// Output: one JSONL row per matched call at
//   $ALFRED_CODE_INSTRUMENT_LOG  (default: <data root>/statistics/tools-usage/<session-or-agent-id>.jsonl,
//   the data root resolved from ALFRED_CODE_DATA_PATH - stack/hooks/layout.js)
// Coverage note: PreToolUse fires for the session's tool calls; where the running Claude
// Code build propagates PreToolUse into dispatched subagents, their internal Skill / MCP
// calls are captured too - verify coverage against a known run before trusting a tally.

// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;

// `1` only, as environment.json reads it: `true` once switched this hook on where the copy route's shell gate kept it
// off (audit 2026-10-08 row 29). The gate went in 3.0.0 - the switch lives in .variables, which no shell test reads.
if (String(envOf(process.env, 'INSTRUMENT') || '').trim() !== '1') process.exit(0); // off unless explicitly switched on

// pinned copy of guard-secret-value.js SECRET_SHAPE, no g flag (shared-rules: credential-literal-shapes)
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// A dispatch description, a search pattern and a Bash description are the model's own text, and a token rode in them
// verbatim (replayed: `ghp_...`, `sk-ant-...`). Masked on the whole text, then cut, so a cut never splits a token out
// of its shape.
const hint = (s, cap = 60) => String(s).replace(new RegExp(SECRET_SHAPE.source, 'g'), '[redacted]').slice(0, cap);

// The stack version this hook ran from, read from disk once per call, never from the model: the plugin route's own
// manifest two folders up (`<plugin root>/setup-plugin/.claude-plugin/plugin.json`), else the copy route's install
// stamp beside its `.claude/hooks/` folder, else null. A report then names the install a session LOADED when the stamp
// is gone or was rewritten after it (audit 2026-10-11 SD14: ~8 calls spent deriving one by hand).
function stackVersion(fs, path) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    if (m && m.name === 'alfred-code' && m.version) return String(m.version).slice(0, 40);
  } catch { /* not the plugin route */ }
  try {
    const v = /^version:[ \t]*(\S+)/m.exec(fs.readFileSync(path.join(__dirname, '..', 'alfred-code.stamp'), 'utf8'));
    if (v) return v[1].slice(0, 40);
  } catch { /* no stamp beside a copied hook */ }
  return null;
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw || '{}');
    const tool = ev.tool_name || '';
    if (!tool) { process.exit(0); }
    // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards.
    let cursorOff = false;
    try { cursorOff = require('./hook-prelude.js').cursorStandDown(ev, __filename); } catch { /* no prelude: run */ }
    if (cursorOff) process.exit(0);
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
    else if (tool === 'Task' || tool === 'Agent') detail = input.subagent_type || input.subagentType || (input.description ? hint(input.description) : null);
    else if (input.file_path) detail = path.basename(String(input.file_path));
    else if (input.pattern) detail = hint(input.pattern);
    // Bash `description` is the model's to write and it is often omitted (measured: 10 of 11 rows
    // in one session, so the whole session read as detail-blind). Fall back to the command's VERB -
    // the first token, plus a second one only when it is a bare subcommand (`git commit`, `npm
    // test`): no path, no flag, no argument, so nothing sensitive can ride along.
    else if (tool === 'Bash') {
      if (input.description) detail = hint(input.description);
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
      // the skill slug, a seat type or a basename can carry a token as well, so every detail is masked once more
      detail: detail == null ? null : hint(detail, 200),
      cwd: ev.cwd || null,
      // ADDED fields only (the row's pinned contract): the call's own id, so a reader joins a row to its call instead of
      // guessing by tool and time - a batched message runs its calls after it finishes streaming, 0.8-12s past their
      // timestamps (audit 2026-10-10 C07: 31 calls of one session read UNJOINED beside their own 30 rows) - and the
      // subagent the call ran in, null in the main session.
      tool_use_id: ev.tool_use_id || null,
      agent_id: ev.agent_id || null,
      version: stackVersion(fs, path),
    };
    const dir = process.env.CLAUDE_PROJECT_DIR || ev.cwd || '.';
    // one ledger per session/agent id - the filename matches the transcript's id for the --hook-log join
    const sid = String(ev.session_id || 'session').replace(/[^A-Za-z0-9._-]/g, '');
    // 2.8.0: the data root's statistics/ (layout.js beside this hook); the pre-2.8.0 docs root on an older copy route
    let out = envOf(process.env, 'INSTRUMENT_LOG');
    if (!out) {
      try { out = require('./layout.js').statsPath(dir, ['tools-usage', `${sid}.jsonl`]); }
      catch { out = path.resolve(dir, docsRootEnv(), 'tools-usage', `${sid}.jsonl`); } // pre-2.8.0, no layout.js here
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  } catch {
    // never break a tool call because instrumentation hiccuped
  }
  process.exit(0);
});
