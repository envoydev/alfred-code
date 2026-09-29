#!/usr/bin/env node
// history-session.js - SessionStart + Stop. Thin: the engine history.js sits beside it (copied, not
// wired - the docs.js / memory.js split). Stop upserts this session's entry under <docs-path>/history/.
// SessionStart does the same (it pins the start commit), prunes, and injects the last three entries of
// THIS branch - what they committed, left dirty and ruled. No model call; ALFRED_CODE_HISTORY=0 is off.
// Fail-open in every direction: no engine, garbage stdin, no git, a locked file - exit 0, print nothing.
// History never blocks a turn.
'use strict';
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open: no prelude runs the hook - envOf falls back to the bare ALFRED_CODE_ read
// (pre-2.0.0 behaviour) the same way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('history-session')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}

const STDIN_TIMEOUT_MS = 2000;
const BLOCK_CAP = 600;

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

async function main() {
  if (envOf(process.env, 'HISTORY') === '0') return;
  let H;
  try { H = require(path.join(__dirname, 'history.js')); } catch { return; }
  let payload;
  try { payload = JSON.parse(await readStdinBounded(STDIN_TIMEOUT_MS)); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const event = payload.hook_event_name || '';
  if (event === 'Stop') {
    H.upsert(root, payload);
  } else if (event === 'SessionStart') {
    const entry = H.upsert(root, payload);
    H.prune(H.historyDir(root), 200, 180);
    const block = entry ? H.renderStartBlock(H.lastForBranch(root, entry.branch, 3, entry.session), BLOCK_CAP) : '';
    if (block) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } }));
  }
}

module.exports = { main };
if (require.main === module) main().catch(() => {}).then(() => process.exit(0));
