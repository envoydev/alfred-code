#!/usr/bin/env node
// history-session.js - SessionStart + Stop. Thin: the engine history.js sits beside it (copied, not
// wired - the docs.js / memory.js split). Stop upserts this session's entry under <data root>/state/history/.
// SessionStart does the same (it pins the start commit), prunes, and injects the last entries of
// THIS branch - what they committed, left dirty and ruled. No model call; ALFRED_CODE_HISTORY is how many earlier sessions the start block
// shows (seeded 3, at most 10; the block's cap is 150 chars plus 150 per session), and `0` is off.
// Fail-open in every direction: no engine, garbage stdin, no git, a locked file - exit 0, print nothing.
// History never blocks a turn. Its Stop process also runs check-turn-build.js's step (the user's ruling of 2026-10-16:
// that hook started a node process every turn to read a switch that is off in every project) - with the check's own
// gates, so either one switched off leaves the other running, and only the check can block. `wiringRows` folds the
// check's Stop row into this hook's, for the generated plugin entry and the copy route alike.
'use strict';
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open: no prelude runs the hook - envOf falls back to the bare ALFRED_CODE_ read
// (pre-2.0.0 behaviour) the same way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// History stood down still runs the turn check it carries, so the gate is a flag, never an exit.
let historyOff = false;
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    historyOff = prelude.standDown('history-session');
  } catch { /* an install without the prelude runs the hook unchanged */ }
}

// The rows that ride this hook's Stop process: each one's own Stop row goes once this hook's Stop row is wired. A row
// is `file::matcher[::args]` or { file, matcher, args } - the shape the dispatchers fold (shell-guards.js wiringRows).
const RIDERS = ['check-turn-build'];
function wiringRows(rows) {
  const list = [...(rows || [])];
  const parts = (row) => {
    const [file = '', matcher = '', args = ''] = String(row.file ?? row).split('::');
    return { name: String(row.file ?? file).replace(/\.js$/, ''), matcher: row.matcher ?? matcher, args: String(row.args ?? args).trim() };
  };
  const stopRow = (p, name) => p.name === name && p.matcher === '@Stop' && !p.args;
  if (!list.some((row) => stopRow(parts(row), 'history-session'))) return list;
  return list.filter((row) => !RIDERS.some((name) => stopRow(parts(row), name)));
}

const STDIN_TIMEOUT_MS = 2000;

// Bounded like memory-session.js: a stdin that never closes must not hold the hook past its budget.
function readStdinBounded(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { process.stdin.pause(); process.stdin.removeAllListeners(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => finish(data));
      process.stdin.on('error', () => finish(data));
      process.stdin.resume();
    } catch { finish(''); }
  });
}

// The history half: fail-open and silent, whatever happens here the turn check still runs. It returns the entry upsert
// wrote, for the status file's branch, or null.
function history(payload) {
  if (historyOff) return null;
  let H;
  try { H = require(path.join(__dirname, 'history.js')); } catch { return null; }
  const count = H.historyCount(envOf(process.env, 'HISTORY'));
  if (!count) return null;
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return null;
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const event = payload.hook_event_name || '';
  try {
    if (event === 'Stop') {
      return H.upsert(root, payload);
    } else if (event === 'SessionStart' && !payload.agent_id) {
      // A seat's own compaction runs SessionStart inside the seat with the MAIN session's id (loading audit 2026-10-21
      // G3): it would rewrite the main session's entry and inject the branch history into a seat - neither happens.
      const entry = H.upsert(root, payload);
      H.prune(H.historyDir(root), 200, 180);
      const block = entry ? H.renderStartBlock(H.lastForBranch(root, entry.branch, count, entry.session), H.historyCap(count), root) : '';
      if (block) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } }));
      return entry;
    }
  } catch { /* history never costs the turn check */ }
  return null;
}

// The session status file (session-status.js, 2026-10-29): written under this hook's own gates, after its output -
// ALFRED_CODE_HISTORY=0 is no gate, the file is written with no handoff prompt. No stdout.
function status(payload, entry) {
  if (historyOff) return;
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  try {
    const S = require(path.join(__dirname, 'session-status.js'));
    const event = payload.hook_event_name || '';
    if (event === 'SessionStart' && !payload.agent_id) S.onSessionStart(payload, entry);
    else if (event === 'Stop') S.onStop(payload, entry);
  } catch { /* the status file never costs the turn */ }
}

// The turn check's step, when its file ships beside this one; its own gates decide whether it runs at all.
function turnCheck(payload) {
  let step;
  try { step = require('./check-turn-build.js').stopCheck; } catch { return { code: 0, stderr: '' }; }
  try { return typeof step === 'function' ? step(payload) : { code: 0, stderr: '' }; } catch { return { code: 0, stderr: '' }; }
}

async function main() {
  let payload;
  try { payload = JSON.parse(await readStdinBounded(STDIN_TIMEOUT_MS)); } catch { return 0; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  const entry = history(payload);
  status(payload, entry);
  if ((payload.hook_event_name || '') !== 'Stop') return 0;
  const r = turnCheck(payload);
  if (r.code === 2 && r.stderr) { process.stderr.write(r.stderr); return 2; }
  return 0;
}

module.exports = { main, wiringRows, RIDERS };
if (require.main === module) main().catch(() => 0).then((code) => process.exit(code === 2 ? 2 : 0));
