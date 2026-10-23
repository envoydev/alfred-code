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
// SubagentStart gets the tag line and the tool line: SessionStart context never reaches a seat at dispatch (its own
// compaction runs SessionStart inside it, with its agent_id), and a seat's
// handoff note is stored and read under that tag (alfred-memory.md) - the hook states it, the seat never guesses it. The
// tool line carries the seat carve-out: a stack seat holds no ToolSearch, its tools grant the server, so it calls the
// tools directly (the rule-side line moves here, audit 2026-10-14 RU10).
// Both pushes end on this HOST's shell traps (hostLines, audit 2026-10-14 RU13) - the one existing context hook that
// speaks at every session and seat start of an install, since the memory server is locked into all of them.
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
// How the memory tools load is the tool order's line (preferences-session.js). Switched off - the hook, or its tools part -
// that line is gone, so this push carries the load line again, as it did before the order came.
const TOOL_SEARCH_LINE = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list';
function orderOff() {
  try {
    const prelude = require('./hook-prelude.js');
    return prelude.hookDisabled('preferences-session') || prelude.partOff('preferences-session', 'tools');
  } catch { return false; }
}

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

// THE HOST'S SHELL TRAPS (audit 2026-10-14 RU13, the user's ruling). The always-on navigation rule carried the Windows Git
// Bash line into every macOS / Linux session and the zsh lines into every bash one; each host now gets only its own, here,
// at the session's and every seat's start. Keyed on this process's platform and $SHELL - the shell the Bash tool runs
// (shell-guards.js reads the same variable for its zsh rewrite). One rule text for every teammate still holds: a per-host
// line is no per-OS rule copy (the ruling rule-prose.test.js M68 pins), and the rule keeps a one-line pointer here.
const ZSH_LINES = [
  "- zsh aborts the WHOLE command on an unmatched bare path glob, status 1 like a genuine no-match, so an aborted scan reads as 'nothing there': list a path glob that may match nothing with `find <dir> -name '<pat>'`.",
  '- zsh never word-splits `$VAR`, so a command plus flags held in one variable runs as one word - use a function or an array.',
];
const WINDOWS_LINES = [
  "- On Windows (Git Bash): pass a `/tmp/x` path to native `node` through `cygpath -w` (or write under `$TEMP`); prefix a `git show <rev>:<path>` with `MSYS2_ARG_CONV_EXCL='*'`, or path conversion rewrites it; run PowerShell as a quoted-heredoc (`<<'EOF'`) `.ps1` via `-File \"$(cygpath -w <file>)\"`, never a double-quoted `-Command` (Bash expands its `$_`).",
];
function hostLines(platform = process.platform, shell = process.env.SHELL) {
  const name = String(shell || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  const lines = [...(platform === 'win32' ? WINDOWS_LINES : []), ...(name === 'zsh' ? ZSH_LINES : [])];
  return lines.length ? ['Shell commands on this host:', ...lines] : [];
}
const withHost = (lines) => { const host = hostLines(); return host.length ? [...lines, '', ...host] : lines; };

async function main() {
  const input = await readInput();
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(input, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  const event = input.hook_event_name;
  if (event !== 'SessionStart' && event !== 'SubagentStart') return;
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
  if (event === 'SubagentStart') {
    // How the memory tools load is the tool order's start line (preferences-session.js), resolved against the seat's tools.
    return emit('SubagentStart', withHost([`This project's memory tag: project:${memory.projectName(root)}`,
      ...(orderOff() ? [`Store, search or list more: ${TOOL_SEARCH_LINE} - a seat whose tools grant them, by name or as the whole server, has them loaded already and calls them directly.`] : [])]).join('\n'));
  }
  const level = memory.levelOfPath(dbPath, { home, projectRoot: root }) || 'unknown';
  const project = memory.projectName(root);
  // related-projects is read through docs.js's own docs-root resolution (<data root>/docs, a leftover
  // ALFRED_CODE_DOCS_PATH read first) - never re-derived here. Its absence (an older or
  // missing docs.js copy) just means no related-project group this session, not a failed push.
  let related = [];
  try { related = memory.relatedProjects(checkout, require('./docs.js').DOCS_ROOT); } catch {}
  const { text } = memory.selectForSession(dbPath, { project, related, capBytes: CAP_BYTES });
  // Whenever a memory registration exists, the model needs its own project's tag to save under - even
  // (especially) inside a git worktree, where projectName() already names the MAIN checkout, never the
  // worktree's own folder (I5). Nothing selected: keep the push to just this line, no header, no body.
  // How the tools load is the tool order's start line (preferences-session.js), never repeated here.
  const tagLine = `This project's memory tag: project:${project}`;
  const searchLines = orderOff() ? [`Store, search or list more: ${TOOL_SEARCH_LINE}`] : [];
  // The frame (memory.js's own two lines) sits between the header and the rows, so every recalled row
  // is read as context under it; an older engine copy without it prints the rows as before.
  const frame = Array.isArray(memory.MEMORY_FRAME) ? memory.MEMORY_FRAME : [];
  const lines = text
    ? [`Memory (memory MCP, ${level}):`, tagLine, ...frame, text, ...(searchLines.length ? ['', ...searchLines] : [])]
    : [tagLine, ...searchLines];
  emit('SessionStart', withHost(lines).join('\n'));
}

module.exports = { main, hostLines };
if (require.main === module) {
  // process.exit(0) rather than letting the event loop drain on its own: a stdin handle the bounded
  // read above could not fully detach from must never keep this process alive past its own work.
  main().catch(() => {}).then(() => process.exit(0));
}
