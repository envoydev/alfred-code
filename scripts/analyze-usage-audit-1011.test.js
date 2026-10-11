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

// 5b9ce9c5#7: Windows PreToolUse lag ran 788-5,616ms on 6 of 13 calls; the call joined by its own tool_use_id still read
// 'outside the ledger window' and the report printed a false 'ledger wired mid-session' cause.
test('5b9ce9c5#7: a call joined by any pass is covered whatever its stamp; only an unjoined call is judged by time', () => {
  const dir = tmp();
  try {
    const ms = (sec, frac) => `2026-07-15T07:00:${String(sec).padStart(2, '0')}.${frac}Z`;
    const rows = [
      human(ms(0, '000'), 'go'),
      asst('m1', ms(0, '100'), [sh('c1', 'dotnet build', { description: 'Build the solution' })]),
      res(ms(7, '000'), 'c1', 'ok'),
      asst('m2', ms(10, '000'), [tool('c2', 'Read', { file_path: 'C:\\work\\app\\src\\A.cs' })]),
      res(ms(10, '400'), 'c2', 'x'),
      asst('m3', ms(30, '000'), [sh('c3', 'git status', { description: 'Show status' })]),
      res(ms(30, '500'), 'c3', 'x'),
    ];
    const file = write(dir, rows);
    const ledger = path.join(dir, 'tools-usage.jsonl');
    fs.writeFileSync(ledger, [
      { ts: ms(5, '716'), session: 's', tool: 'Bash', detail: 'Build the solution', cwd: WIN_CWD, tool_use_id: 'c1', agent_id: null },   // 5.6s of lag, the ledger's first row
      { ts: ms(10, '300'), session: 's', tool: 'Read', detail: 'A.cs', cwd: WIN_CWD, tool_use_id: 'c2', agent_id: null },
    ].map(line).join(''));
    const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
    assert.deepStrictEqual([cov.matchedById, cov.inWin, cov.outside, cov.tailCalls, cov.lagJoined, cov.callPct], [2, 2, 1, 1, 1, 67]);
    const out = text([file, '--hook-log', ledger]);
    assert.match(out, /cross-check: 67% of tool calls are inside the ledger window - 2 of 3/);
    assert.match(out, /1 call outside the ledger window \(1 after its last row\)/, 'only the unjoined tail call is outside');
    assert.match(out, /joined: 2 call\(s\) - 2 by tool_use_id.*; 1 of them stamped outside the ledger window by hook lag, counted covered/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 2ca8e8ee#8: 5 `hook_cancelled` rows with `timedOut: true` against the 10s cap - the instrumentation hook x3 (46.1s),
// the layer-table gate and the stop contract on an ask (17.1s, so its shape gate never ran) - and the analyzer read
// none: the call whose instrumentation timed out printed as UNJOINED with the guess 'rejected before PreToolUse'.
test('2ca8e8ee#8: cancelled hook runs make a per-hook timeout row, and a timed-out instrumentation hook is named as the unjoined call\'s cause', () => {
  const dir = tmp();
  try {
    const cancel = (ts, id, file, ms, tool, timedOut = true, event = 'PreToolUse') => ({ type: 'attachment', timestamp: ts, attachment: {
      type: 'hook_cancelled', hookName: tool ? `${event}:${tool}` : event, toolUseID: id, hookEvent: event, command: `node "\${CLAUDE_PLUGIN_ROOT}/stack/hooks/${file}"`,
      durationMs: ms, ...(timedOut ? { timedOut: true, timeoutMs: 10000 } : {}) } });
    const rows = [
      human(T(0), 'go'),
      asst('m0', T(0), [tool('r0', 'Read', { file_path: 'C:\\work\\app\\a.cs' })]),
      res(T(1), 'r0', 'x'),
      asst('m1', T(5), [sh('b1', 'dotnet build', { description: 'Build' })]),
      cancel(T(56), 'b1', 'instrument-tool-usage.js', 46143, 'Bash'),
      res(T(57), 'b1', 'ok'),
      asst('m2', T(60), [tool('q1', 'AskUserQuestion', { questions: [{ question: 'Go?', options: [{ label: 'Yes (Recommended)' }, { label: 'No' }] }] })]),
      cancel(T(72), 'q1', 'instrument-tool-usage.js', 11639, 'AskUserQuestion'),
      cancel(T(72), 'q1', 'guard-layer-table.js', 11944, 'AskUserQuestion'),
      cancel(T(77), 'q1', 'guard-stop-contract.js', 17123, 'AskUserQuestion'),
      res(T(80), 'q1', 'User has answered your questions: "Go?"="Yes (Recommended)".'),
      cancel(T(81), null, 'monitor-session.js', 900, null, false, 'UserPromptSubmit'),
      asst('m3', T(90), [sh('b2', 'git status', { description: 'Status' })]),
      res(T(91), 'b2', 'x'),
    ];
    const file = write(dir, rows);
    const ledger = path.join(dir, 'tools-usage.jsonl');
    fs.writeFileSync(ledger, [
      { ts: '2026-07-15T07:00:00.200Z', session: 's', tool: 'Read', detail: 'a.cs', cwd: WIN_CWD, tool_use_id: 'r0', agent_id: null },
      { ts: '2026-07-15T07:01:30.200Z', session: 's', tool: 'Bash', detail: 'Status', cwd: WIN_CWD, tool_use_id: 'b2', agent_id: null },
    ].map(line).join(''));
    const j = run([file, '--hook-log', ledger]);
    assert.deepStrictEqual(j.main.hookTimeouts['instrument-tool-usage.js'], { timedOut: 2, cancelled: 0, maxMs: 46143, timeoutMs: 10000, events: { 'PreToolUse Bash': 1, 'PreToolUse AskUserQuestion': 1 } });
    assert.deepStrictEqual([j.main.hookTimeouts['monitor-session.js'].timedOut, j.main.hookTimeouts['monitor-session.js'].cancelled], [0, 1]);
    assert.deepStrictEqual(j.hookLog.coverage.unmatchedCalls.map((c) => [c.tool, c.cause]), [
      ['Bash', 'its instrumentation hook was cancelled at its timeout after 46.1s - no row was written'],
      ['AskUserQuestion', 'its instrumentation hook was cancelled at its timeout after 11.6s - no row was written'],
    ]);
    const out = text([file, '--hook-log', ledger]);
    assert.match(out, /HOOK TIMEOUTS/);
    assert.match(out, /instrument-tool-usage\.js +2 +46\.1s of a 10s cap +PreToolUse Bash, PreToolUse AskUserQuestion/);
    assert.match(out, /guard-stop-contract\.js +1 +17\.1s of a 10s cap +PreToolUse AskUserQuestion/);
    assert.match(out, /Bash@2026-07-15T07:00:05\.000Z \(its instrumentation hook was cancelled at its timeout after 46\.1s - no row was written\)/);
    const md = text([file, '--hook-log', ledger, '--report-md']);
    assert.match(md, /### Hook timeouts/);
    assert.match(md, /\| guard-layer-table\.js \| 1 \|  \| 11\.9s of a 10s cap \| PreToolUse AskUserQuestion \|/);
    assert.match(md, /\| monitor-session\.js \| 0 \| 1 \| 0\.9s \| UserPromptSubmit \|/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 5b9ce9c5#8 / a9e06780#7: the rule glob proxy scored `skill-authoring.md` and `markdown-docs.md` used from Reads of
// files outside the project - a temp-dir checkout and the plugin cache - which no path-scoped rule attaches to.
test('5b9ce9c5#8 / a9e06780#7: the rule glob proxy scores only paths under the session cwd, Windows spellings folded', () => {
  const dir = tmp();
  try {
    const read = (id, p) => tool(id, 'Read', { file_path: p });
    const rows = [
      human(T(0), 'go'),
      asst('m1', T(1), [
        read('r1', 'C:\\Users\\dev\\AppData\\Local\\Temp\\x.abc\\repo\\stack\\skills\\demo\\SKILL.md'),   // outside: the temp dir
        read('r2', 'C:\\Users\\dev\\.claude\\plugins\\cache\\m\\p\\1.0.0\\references\\walk.md'),         // outside: the plugin cache
        sh('s1', 'cat ../sibling/notes.md'),                                                              // outside: a sibling repo
      ]),
      res(T(2), 'r1', 'a'), res(T(2), 'r2', 'b'), res(T(2), 's1', 'c'),
    ];
    const outside = run([write(dir, rows, 'outside.jsonl')]).inventory;
    const used = (inv, name) => (inv.rules.find((r) => r.name === name) || {}).how || [];
    assert.deepStrictEqual(used(outside, 'markdown-docs.md'), [], 'three .md files outside the project attach nothing');
    assert.deepStrictEqual(used(outside, 'skill-authoring.md'), []);
    const inside = [
      ...rows,
      asst('m2', T(3), [
        read('r3', 'c:\\WORK\\app\\docs\\guide.md'),                // inside: another drive-letter and folder case
        sh('s2', 'cat /c/work/app/stack/skills/demo/SKILL.md'),    // inside: the Git Bash spelling
        read('r4', 'C:\\work\\app\\..\\other\\x.md'),              // climbs out: outside
      ]),
      res(T(4), 'r3', 'd'), res(T(4), 's2', 'e'), res(T(4), 'r4', 'f'),
    ];
    const inv = run([write(dir, inside, 'inside.jsonl')]).inventory;
    assert.deepStrictEqual(used(inv, 'markdown-docs.md'), ['glob proxy x2'], 'guide.md and SKILL.md, nothing outside');
    assert.deepStrictEqual(used(inv, 'skill-authoring.md'), ['glob proxy x1'], 'the in-project SKILL.md only');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 11b595da#3: a 4-message run whose first floor copy was a cache WRITE printed 'standing inventory ~76.3k tok/msg ...
// ~113% of cache-read' (76.3k x 4 = 305.2k over 269.5k cache-read, 55.9k cache-write beside it).
test('11b595da#3: the standing-floor share is measured against the context sent, never above 100%', () => {
  const dir = tmp();
  try {
    const msg = (id, ts, cc, cr) => ({ type: 'assistant', timestamp: ts, cwd: WIN_CWD, message: { id, model: 'claude-sonnet-5', usage: usage(3, cc, cr, 50), content: [{ type: 'text', text: 'x' }] } });
    const rows = [
      human(T(0), 'go'),
      msg('m1', T(1), 55900, 20400),    // the first copy of the floor is mostly a cache WRITE
      msg('m2', T(2), 0, 76300),
      msg('m3', T(3), 0, 81200),
      msg('m4', T(4), 0, 91600),
    ];
    const file = write(dir, rows);
    const out = text([file]);
    // floor 76,303 x 4 = 305,212 over 325,412 sent (269,500 read + 55,900 written + 12 input) = 94%
    assert.match(out, /standing inventory ~76\.3k tok\/msg .* ~94% of the context sent \(cache-read \+ cache-write \+ input\)/);
    assert.doesNotMatch(out, /% of cache-read/);
    assert.match(out, /standing floor +~76\.3k tok\/msg, ~94% of the context sent/);
    assert.match(text([file, '--report-md']), /\*\*Standing inventory\*\* ~76\.3k tokens\/message .* ~94% of the context sent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 5984019e#8: a conforming flow run reports each stop's `Result:` inside its AskUserQuestion, and the green-claims row
// read only end_turn prose - '1 of 1' over 9 ask results - nor did its regex read '<Name> <n> green' or '<Test> passes'.
test('5984019e#8: an ask\'s question is an answer surface, and a named suite with its count or a named test passing is a green claim', () => {
  const dir = tmp();
  try {
    const ask = (id, ts, q) => asst(id, ts, [tool(id, 'AskUserQuestion', { questions: [{ question: q, header: 'Next', multiSelect: false, options: [{ label: 'Go on (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }] })]);
    const said = (id, ts, t) => asst(id, ts, [{ type: 'text', text: t }], { stop_reason: 'end_turn' });
    const answered = (ts, id) => res(ts, id, 'User has answered your questions: "Next"="Go on (Recommended)".');
    const rows = [
      human(T(0), 'carry on'),
      ask('a1', T(1), 'Result: Builder 23/24, Editor 728 / Viewer 707 / Mailer 716 green, all uncommitted. What next?'),
      answered(T(2), 'a1'),
      human(T(10), 'fix the redo test'),
      asst('m1', T(11), [sh('t1', 'dotnet test Tests/App.Tests.csproj --filter Redo')]),
      res(T(12), 't1', 'Passed!  - Failed: 0, Passed: 1'),
      ask('a2', T(13), 'Result: Redo fixed, and Redo passes in full-suite order. Commit?'),
      answered(T(14), 'a2'),
      ask('a3', T(15), 'Result: Browser 700 passed, 3 skipped, 1 failed (Redo). Look at it?'),
      answered(T(16), 'a3'),
      ask('a4', T(17), 'The hook passes the value to the guard. It passes. Keep it?'),
      answered(T(18), 'a4'),
      said('m2', T(19), 'All 12 tests pass.'),
    ];
    const file = write(dir, rows);
    const e = run([file]).main.efficiency;
    assert.deepStrictEqual([e.greenClaims, e.greenClaimsInAsks, e.unverifiedGreenClaims], [3, 2, [T(1)]], 'a1 (no check in its turn), a2 and the end_turn line; a3 has a failure, a4 is no result');
    assert.match(text([file]), /green claims +1 of 3 claim\(s\) that a check passed landed in a turn that ran no check \(2 of the claims in an ask's question\) - at: 07:00:01/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
