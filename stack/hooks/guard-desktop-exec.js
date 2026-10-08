#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// guard-desktop-exec.js - PreToolUse on the two desktop servers' process launchers (I10, the user's ruling
// of 2026-09-29: 'Gate + observe grants'). A desktop server drives the machine's own apps with the user's
// full rights, and two of its tools are not UI at all:
//   - Windows-MCP's `App` in mode `launch_executable` - a Popen of ANY executable with caller-given args
//     and cwd (wheel windows_mcp/tools/app.py:90 at the pinned 0.8.5: mode is launch / launch_executable /
//     resize / switch). Windows-MCP excludes tools by NAME, never by mode, so the launcher's exclude list
//     cannot take this mode away while App's UI modes stay - `powershell.exe -Command ...` still ran with
//     the PowerShell tool excluded.
//   - MacOS-MCP's `Shell` - a shell command the Bash-route guards (rm, secret, force-push, cross-project
//     write) never see. MacOS-MCP 0.4.6 has no exclude flag, so the tool itself is the gate's unit.
// Both are denied; App's `launch`, `switch` and `resize` pass. Both spellings: the plugin route's
// `mcp__plugin_<n>_<n>__<tool>` and the MCP copy route's bare server spelling, one pattern each below.
// 'Allow' is honoured through <docs-path>/flow/DESKTOP-EXEC-ALLOW (this session's own, under 8h): a line
// `App` opens every launch_executable, `Shell` every macOS shell call, an executable's path or file name
// that one executable, `*` both.
'use strict';
const fs = require('fs');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// PROTECTIVE (hook-prelude.js, final review IM2): live under `minimal`, a Cursor payload and a repo never set up,
// where it writes no block row (R54) - false fails open to logging.
let unsetRepo = false;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-desktop-exec');
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  if (off) process.exit(0);
}
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';

// The two tools, on both routes. Built as patterns so the copy route's bare spelling is never literal text
// (lint check 54 fails on it anywhere under stack/).
const WIN_APP = /^mcp__(?:plugin_windows-desktop_)?windows-desktop__App$/;
const MAC_SHELL = /^mcp__(?:plugin_macos-desktop_)?macos-desktop__Shell$/;

let payload;
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (!payload || typeof payload !== 'object') process.exit(0);

    // --- block telemetry (shared by every guard hook; keep the copies identical) ------------
    // A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
    // FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
    // the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
    // nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
    // scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
    // telemetry never changes the verdict and never throws.
    (() => {
        let last = '';
        const w = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
        const exit = process.exit.bind(process);
        process.exit = (code) =>
        {
            if (code === 2 && !unsetRepo)
            {
                try
                {
                    // `path` is required at module scope above.
                    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
                    // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
                        reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
                    }) + '\n');
                }
                catch { /* telemetry is never allowed to break the gate */ }
            }
            exit(code);
        };
    })();

const tool = String(payload.tool_name || '');
const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
const isApp = WIN_APP.test(tool);
const isShell = MAC_SHELL.test(tool);
// App's own default mode is `launch` (a Start-menu name), so only the named process mode is judged.
if (!isShell && !(isApp && String(input.mode || '').trim().toLowerCase() === 'launch_executable')) process.exit(0);

const ROOT = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const receipt = path.resolve(ROOT, docsRootEnv(), 'flow', 'DESKTOP-EXEC-ALLOW');
const executable = String(input.executable || input.path || input.name || '').trim();
const exeBase = executable.split(/[\\/]/).pop();
const allowed = (() => {
  try {
    const st = fs.statSync(receipt);
    let sessionStartMs = 0;
    try {
      const tr = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = tr.birthtimeMs && tr.birthtimeMs !== tr.ctimeMs ? tr.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > 8 * 60 * 60 * 1000 || (sessionStartMs && st.mtimeMs < sessionStartMs)) return false;
    const lines = fs.readFileSync(receipt, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.includes('*')) return true;
    if (isShell) return lines.includes('Shell');
    return lines.includes('App') || (executable !== '' && lines.some((l) => l === executable || (exeBase && l.toLowerCase() === exeBase.toLowerCase())));
  } catch { return false; }
})();
if (allowed) process.exit(0);

const receiptRel = path.relative(ROOT, receipt).split(path.sep).join('/');
if (isShell) {
  // The ledger keeps the command's VERB, as every other guard keeps a branch or a token: 120 characters of the command
  // carried whatever credential it held (audit 2026-10-08 row 40). A leading `NAME=value` is skipped, never recorded.
  const verb = (String(input.command || '').trim().split(/\s+/).find((w) => !/^[A-Za-z_]\w*=/.test(w)) || '').slice(0, 40);
  global.BLOCK_DETAIL = { tool: 'Shell', verb };
  process.stderr.write(
    `Blocked: the macOS desktop server's Shell tool runs a shell command outside every shell guard (the rm,\n` +
    `secret, force-push and cross-project write guards judge the Bash tool, not this one).\n` +
    `Run the command on the Bash tool instead, where those guards see it; drive the app itself through App,\n` +
    `Click, Type and Shortcut.\n\n` +
    `If the user wants it run through the desktop server, do not decide for them: end this turn with ONE\n` +
    `AskUserQuestion carrying, in this order -\n` +
    `  'Use the Bash tool instead (Recommended)' - the shell guards judge the command there\n` +
    `  'Allow the desktop Shell this session' - the command runs unjudged, with the user's full rights\n` +
    `On 'Allow', write the receipt ${receiptRel} with the line \`Shell\` and retry the SAME call. It is\n` +
    `honoured for this session only, under 8h.\n`,
  );
  process.exit(2);
}
global.BLOCK_DETAIL = { tool: 'App', mode: 'launch_executable', executable: executable.slice(0, 200) };
process.stderr.write(
  `Blocked: the Windows desktop server's App tool in mode launch_executable starts ANY process${executable ? ` (\`${executable}\`)` : ''}\n` +
  `with the user's full rights and caller-given arguments - the server switches tools off by name, never by\n` +
  `mode, so this guard is the gate. App's own modes pass: launch (a Start-menu name), switch and resize. A\n` +
  `build, a test run or a script belongs on the Bash tool, where the shell guards judge it.\n\n` +
  `If the user wants THIS process started, do not decide for them: end this turn with ONE AskUserQuestion\n` +
  `carrying, in this order -\n` +
  `  'Launch it by name or drive the UI instead (Recommended)' - App mode launch, then Click / Type\n` +
  `  'Allow this executable this session' - it starts with the user's full rights\n` +
  // The full path, not its file name: a file-name line opens that name in every directory (audit 2026-10-08 row 40).
  `On 'Allow', write the receipt ${receiptRel} with the line \`${executable || 'App'}\` (or \`App\` for every launch this\n` +
  `session) and retry the SAME call. It is honoured for this session only, under 8h.\n`,
);
process.exit(2);
