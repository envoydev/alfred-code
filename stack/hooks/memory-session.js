#!/usr/bin/env node
// memory-session.js - pushes the memory MCP's own stored memories into every session, the SessionStart
// half of the shared-memory pair (memory.js is the engine, copied beside this hook and not itself
// wired - same split as docs.js/docs-session.js). Whenever a memory registration is found, the push
// always names this project's own tag (even with nothing else to show - I5), so the model knows what
// to save under, especially inside a git worktree, where that name is the MAIN checkout's, never the
// worktree's own folder. A missing, locked or wrong-schema database, or a Node below 22.13 (memory.js's
// own selectForSession degrades to an empty selection there), selects nothing, and the push is then the
// tag and search lines alone. Fully silent only with no registration, garbage stdin, or any other error -
// exit 0 throughout, since a session start that cannot be enriched must never be a session start that fails.
'use strict';
const os = require('os');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
if (require.main === module) {
  try {
    const { standDown } = require('./hook-prelude.js');
    if (standDown('memory-session')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}

const CAP_BYTES = 4096;
const STDIN_TIMEOUT_MS = 2000;
const TOOL_SEARCH_LINE = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list';

// A plain `fs.readFileSync(0)` blocks forever when stdin never closes (a TTY, or a harness that keeps
// the pipe open) - this hook only ever needs `cwd` out of the payload, and that already has a
// process.cwd() fallback below, so giving up after STDIN_TIMEOUT_MS and treating the payload as empty
// costs nothing but the SessionStart push for that one unreadable call. The timer is deliberately NOT
// unref'd: a resumed stdin keeps the event loop alive on its own, and an unref'd stdin (tried first,
// measured) lets the loop see itself as empty and exit within milliseconds - before either the data/end
// event OR the timeout ever fires. `finish()`'s own `pause()` is what drops the ref once this settles;
// `process.exit(0)` right after `main()` below is the actual bound, independent of any of this.
function readStdinBounded(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { process.stdin.pause(); process.stdin.removeAllListeners('data'); process.stdin.removeAllListeners('end'); process.stdin.removeAllListeners('error'); } catch {}
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

const readInput = async () => {
  const raw = await readStdinBounded(STDIN_TIMEOUT_MS);
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
const emit = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));

async function main() {
  const input = await readInput();
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(input, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  if (input.hook_event_name !== 'SessionStart') return;
  const memory = require('./memory.js');
  const home = os.homedir();
  // Re-verify 3 S3: the project the session's directory belongs to (memory.js projectRootOf) - CLAUDE_PROJECT_DIR names the
  // directory the session started in, a subdirectory of the project when it started there. The memory is the project's
  // (a linked worktree's is its main checkout's); the docs root is the checkout's own. An older engine copy has no resolver.
  const start = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { checkout, project: root } = typeof memory.projectRootOf === 'function' ? memory.projectRootOf(start, { home }) : { checkout: start, project: start };
  process.env.CLAUDE_PROJECT_DIR = checkout;
  const dbPath = memory.registeredDbPath(root, { home });
  if (!dbPath) return; // no memory server registered for this project - nothing to push
  const level = memory.levelOfPath(dbPath, { home, projectRoot: root }) || 'unknown';
  const project = memory.projectName(root);
  // related-projects is read through docs.js's own docs-root resolution (ALFRED_CODE_DOCS_PATH in the
  // settings.json env, default '.alfred/docs') - never re-derived here. Its absence (an older or
  // missing docs.js copy) just means no related-project group this session, not a failed push.
  let related = [];
  try { related = memory.relatedProjects(checkout, require('./docs.js').DOCS_ROOT); } catch {}
  const { text } = memory.selectForSession(dbPath, { project, related, capBytes: CAP_BYTES });
  // Whenever a memory registration exists, the model needs its own project's tag to save under - even
  // (especially) inside a git worktree, where projectName() already names the MAIN checkout, never the
  // worktree's own folder (I5). Nothing selected: keep the push to just this line plus the search hint,
  // no header, no body - still short enough to never be worth suppressing.
  const tagLine = `This project's memory tag: project:${project}`;
  const searchLine = `Store, search or list more: ${TOOL_SEARCH_LINE}`;
  // The frame (memory.js's own two lines) sits between the header and the rows, so every recalled row
  // is read as context under it; an older engine copy without it prints the rows as before.
  const frame = Array.isArray(memory.MEMORY_FRAME) ? memory.MEMORY_FRAME : [];
  const lines = text
    ? [`Memory (memory MCP, ${level}):`, tagLine, ...frame, text, '', searchLine]
    : [tagLine, searchLine];
  emit('SessionStart', lines.join('\n'));
}

module.exports = { main };
if (require.main === module) {
  // process.exit(0) rather than letting the event loop drain on its own: a stdin handle the bounded
  // read above could not fully detach from must never keep this process alive past its own work.
  main().catch(() => {}).then(() => process.exit(0));
}
