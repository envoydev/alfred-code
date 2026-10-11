'use strict';

// analyze-usage-audit-1011.test.js - the analyzer defects the usage audit of 2026-10-11 measured on a consuming
// project's Windows sessions, one test per defect. Every fixture is a genericized shape of the rows the audited
// transcripts carried - Windows-shaped where the defect was (drive letters, backslash paths) - and runs on every OS.
// Each test failed on the analyzer before its fix (ANALYZE_USAGE_SCRIPT points the suite at another copy to show it).

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = process.env.ANALYZE_USAGE_SCRIPT || path.join(__dirname, 'analyze-usage.js');
// The version-row test spawns the instrumentation hook: the suite takes the containment helper every hook suite carries.
require('./hook-test-env').isolateHookSuite();

const line = (o) => JSON.stringify(o) + '\n';
const usage = (input, cc, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
const T = (n) => `2026-07-15T07:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
const WIN_CWD = 'C:\\work\\app';
const asst = (id, ts, content, extra = {}) => ({ type: 'assistant', timestamp: ts, cwd: WIN_CWD, message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content, ...extra } });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const sh = (id, command, extra = {}) => tool(id, 'Bash', { command, ...extra });
const res = (ts, id, content, isError) => ({ type: 'user', timestamp: ts, cwd: WIN_CWD, message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const human = (ts, text) => ({ type: 'user', timestamp: ts, cwd: WIN_CWD, parentUuid: `p-${ts}`, origin: { kind: 'human' }, message: { content: text } });
const hookRow = (ts, type, toolUseID, file, extra = {}) => ({ type: 'attachment', timestamp: ts, attachment: {
  type, hookName: `PreToolUse:${extra.tool || 'Bash'}`, hookEvent: 'PreToolUse', toolUseID, command: `node "\${CLAUDE_PLUGIN_ROOT}/stack/hooks/${file}"`, ...extra.at } });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-1011-')); }
function write(dir, rows, name = 'session.jsonl') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, rows.map(line).join(''));
  return file;
}
const run = (args) => JSON.parse(execFileSync('node', [SCRIPT, ...args, '--json'], { encoding: 'utf8' }));
const text = (args) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

// ae38c08f#5: a PreToolUse guard rewrote 2 of 149 Bash calls (`hookSpecificOutput.updatedInput`), one rewrite caused
// the next error, and the TOOLS row named no hook - the report blamed the model's own heredoc.
test('ae38c08f#5: a PreToolUse rewrite is counted per tool and names its hook beside the error the rewritten call returned', () => {
  const dir = tmp();
  try {
    const rewrite = (cmd) => ({ at: { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { command: cmd } } }), exitCode: 0, durationMs: 371 } });
    const rows = [
      human(T(0), 'check the hooks'),
      asst('m1', T(1), [sh('b1', "grep -n 'x' C:\\\\work\\\\app\\\\a.json; cat notes.txt")]),
      hookRow(T(1), 'hook_success', 'b1', 'shell-guards.js', rewrite("echo '# dropped'; grep -n 'x' a.json")),
      hookRow(T(1), 'hook_success', 'b1', 'instrument-tool-usage.js', { at: { stdout: '', exitCode: 0 } }),
      res(T(2), 'b1', "Exit code 2\n/usr/bin/bash: -c: line 1: unexpected EOF while looking for matching `''", true),
      asst('m2', T(3), [sh('b2', 'git status')]),
      // an allow that names updatedInput only inside its own context text rewrote nothing
      hookRow(T(3), 'hook_success', 'b2', 'shell-guards.js', { at: { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'no updatedInput here' } }) } }),
      res(T(4), 'b2', 'fatal: not a git repository', true),
      asst('m3', T(5), [sh('b3', 'env | grep -i path')]),
      hookRow(T(5), 'hook_success', 'b3', 'shell-guards.js', rewrite('node guard.js --redacted-env | grep -i path')),
      res(T(6), 'b3', 'PATH=[redacted]'),
    ];
    const file = write(dir, rows);
    const { main } = run([file]);
    assert.strictEqual(main.toolCalls.Bash.rewrites, 2, 'b1 and b3 were rewritten; b2 was not');
    assert.deepStrictEqual(main.rewritesByHook, { 'shell-guards.js': 2 });
    assert.deepStrictEqual(main.toolCalls.Bash.rewriteErrors, [{ ts: T(2), hooks: ['shell-guards.js'] }], 'only the rewritten call\'s error carries the hook');
    const out = text([file]);
    assert.match(out, /hook-rw/);
    assert.match(out, /2 call\(s\) ran with input a PreToolUse hook REWROTE \(updatedInput\): shell-guards\.js 2; 1 of them errored - Bash@07:00:02 after shell-guards\.js/);
    assert.match(out, /Bash +2 +07:00:02, 07:00:04 - 1 on a call a hook rewrote/);
    const md = text([file, '--report-md']);
    assert.match(md, /\| Bash \| 3 \| [^|]+ \| 2 \|  \|  \| 2 \|/);
    assert.match(md, /\| Bash \| 2 \| 07:00:02, 07:00:04 \| 07:00:02 shell-guards\.js \|/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
