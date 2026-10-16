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
      cancel(T(81), null, 'guard-answer-length.js', 900, null, false, 'UserPromptSubmit'),
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
    assert.deepStrictEqual([j.main.hookTimeouts['guard-answer-length.js'].timedOut, j.main.hookTimeouts['guard-answer-length.js'].cancelled], [0, 1]);
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
    assert.match(md, /\| guard-answer-length\.js \| 0 \| 1 \| 0\.9s \| UserPromptSubmit \|/);
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

// 7f8803eb#8: 29 screenshots priced on arrival only ('~78.2k tok') while their carry - each re-sent as cache-read on
// every later message until a compaction - was ~6.50M (12.6%), so no waste analysis or verdict named them.
test('7f8803eb#8: an image is priced on arrival AND as the cache-read it is carried for, until a compaction drops it', () => {
  const dir = tmp();
  try {
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4000) } };
    const at = (id, ts, cr, content) => ({ type: 'assistant', timestamp: ts, cwd: WIN_CWD, message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, cr, 100), content } });
    const rows = [
      human(T(0), 'check the screens'),
      at('m1', T(1), 10000, [tool('s1', 'mcp__plugin_desk_desk__Screenshot', {}), tool('s2', 'mcp__plugin_desk_desk__Screenshot', {})]), // mcp-fixture
      { type: 'user', timestamp: T(2), cwd: WIN_CWD, message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: [img] }, { type: 'tool_result', tool_use_id: 's2', content: [img] }] } },
      at('m2', T(3), 12100, [{ type: 'text', text: 'arrived' }]),   // +2,100: 100 of output, ~1,999 the two images
      at('m3', T(4), 12200, [{ type: 'text', text: 'carried once' }]),
      at('m4', T(5), 12300, [{ type: 'text', text: 'carried twice' }]),
      { type: 'system', timestamp: T(6), compactMetadata: { trigger: 'auto' } },
      at('m5', T(7), 5000, [{ type: 'text', text: 'after the compaction - dropped' }]),
    ];
    const file = write(dir, rows);
    const { main } = run([file]);
    assert.deepStrictEqual([main.imageTok, main.imageCarryTok], [1999, 3998], 'arrival once; carried on m3 and m4; nothing after the compaction');
    const out = text([file]);
    assert.match(out, /images 2 in tool results \(mcp__plugin_desk_desk__Screenshot 2\) ~2\.0k tok, from the context growth of the turns that carried 2 of them - that is their ARRIVAL; then CARRIED ~4\.0k tok of cache-read, re-sent on every later message until a compaction or \/clear dropped them \(7\.7% of cache-read\)/); // mcp-fixture
    assert.match(out, /image carry +2 image\(s\) in the main session: ~2\.0k tok on arrival \(2 measured\), ~4\.0k tok carried as cache-read by the later messages, 7\.7% of cache-read/);
    assert.match(text([file, '--report-md']), /then CARRIED ~4\.0k tok of cache-read/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// bca100bd#7: `grep -c '<a line naming a doc path>' .claude/AGENTS.md` read AGENTS.md, and GENERATED DOCS scored the doc
// named inside the PATTERN as read ('+1r via Bash') - a doc that no longer sat at that path.
test('bca100bd#7: a doc path inside a grep pattern is no read; the files grep reads still are', () => {
  const dir = tmp();
  try {
    const cmds = [
      "grep -c 'Run book: `.claude/docs/project-capabilities/PROJECT-CAPABILITIES.md`' .claude/AGENTS.md",
      'grep -n Foo .alfred/docs/architecture/ARCHITECTURE.md',
      "grep -e 'docs/x' -e '.alfred/docs/a/B.md' .alfred/docs/c/C.md",
      "cat .alfred/docs/d/D.md | grep -c '.alfred/docs/e/E.md'",
      "rg -l -g '*.md' '.alfred/docs/f/F.md' src",
      'grep -f .alfred/docs/g/G.md src/',
      "grep -A 3 '.alfred/docs/h/H.md' .alfred/docs/i/I.md",
      "git -C repo grep -n --regexp='.alfred/docs/j/J.md' -- .alfred/docs/k/K.md",
    ];
    const rows = [human(T(0), 'go'), asst('m1', T(1), cmds.map((c, k) => sh(`g${k}`, c))), ...cmds.map((c, k) => res(T(2), `g${k}`, 'hit'))];
    const touches = run([write(dir, rows)]).main.docTouches;
    const read = Object.keys(touches).filter((k) => touches[k].bashReads).sort();
    assert.deepStrictEqual(read, ['architecture/ARCHITECTURE.md', 'c/C.md', 'd/D.md', 'g/G.md', 'i/I.md', 'k/K.md'],
      'the pattern operands (the capabilities doc, B, E, F, H, J) are text grep searches for, never a file it reads');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// d9035363#7: `docs.js seed-ids` added 13 section ids to two docs and the GENERATED DOCS table printed 0 writes; `adr new`
// and `promote` rewrite docs without a `set` too.
test('d9035363#7: docs.js seed-ids, adr new and promote count as doc writes - on the files they name, else as their own row', () => {
  const dir = tmp();
  try {
    const DJS = 'node .claude/hooks/docs.js';
    const calls = [
      [`cd /c/work/app && ${DJS} seed-ids 2>&1 | tail -15; echo ---; ${DJS} lint 2>&1 | tail -3`, '13 ids added\n---\n0 problems, 2 notes'],
      [`${DJS} seed-ids`, 'ids added: .alfred/docs/code-style/CODE-STYLE.md (+9)\nids added: .alfred/docs/related-projects/RELATED-PROJECTS.md (+4)\n13 ids added'],
      [`${DJS} seed-ids`, '0 ids added'],
      [`${DJS} adr new 'Use one ledger'`, 'created .alfred/docs/decisions/0003-use-one-ledger.md - ADR-0003, status Proposed: write its Context, Decision and Consequences\nindex rewritten: .alfred/docs/decisions/DECISIONS.md (3 records)'],
      [`${DJS} promote feature-x`, 'ARCHITECTURE#overview: merged\nARCHITECTURE#data: conflict (both changed)'],
      [`${DJS} promote feature-y`, 'ARCHITECTURE#data: conflict (both changed)'],
    ];
    const rows = [human(T(0), 'go'), asst('m1', T(1), calls.map(([c], k) => sh(`d${k}`, c))), ...calls.map(([, out], k) => res(T(2), `d${k}`, out))];
    const t = run([write(dir, rows)]).main.docTouches;
    const w = Object.fromEntries(Object.entries(t).filter(([, d]) => d.bashWrites).map(([k, d]) => [k, d.bashWrites]));
    assert.deepStrictEqual(w, {
      '(docs.js seed-ids - section ids added, files not named)': 1,
      'code-style/CODE-STYLE.md': 1,
      'related-projects/RELATED-PROJECTS.md': 1,
      'decisions/0003-use-one-ledger.md': 1,
      'decisions/DECISIONS.md': 1,
      '(docs.js promote - sections folded into mainline)': 1,
    }, '0 ids added and an all-conflict promote write nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// d56562c7#2: the vintage graded a loaded body 'same' though three clauses had changed since - the headings were equal
// and the -50 char net delta sat inside the 64-char tolerance.
test('d56562c7#2: offsetting edits read DIFFERS by paragraph, and an expanded placeholder still reads same', () => {
  const dir = tmp();
  try {
    const claude = path.join(dir, 'install', '.claude');
    const skill = (name, body) => {
      fs.mkdirSync(path.join(claude, 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(claude, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: "fixture"\n---\n\n${body}`);
    };
    const now = '# Root cause\n\nFind the cause before the fix. Read the failure whole.\n\n## Steps\n\n1. Reproduce it.\n\n7. Ask ONE question with the redesign recommended.\n\nScope: read-only until the cause is named.\n';
    const then = '# Root cause\n\nFind the cause before the fix. Read the failure whole. Never guess at a fix first.\n\n## Steps\n\n1. Reproduce it.\n\n7. Ask a question.\n\nScope: the diagnosis stays read-only.\n';
    skill('habit-rc', now);
    skill('tool-run', '# Tool\n\nRun `node "${CLAUDE_SKILL_DIR}/scripts/total.js"` over the log.\n');
    const meta = (ts, id, dirName, body) => ({ type: 'user', timestamp: ts, cwd: WIN_CWD, isMeta: true, sourceToolUseID: id, message: { content: [{ type: 'text', text: `Base directory for this skill: ${dirName}\n\n${body}` }] } });
    const rows = [
      human(T(0), 'go'),
      asst('m1', T(1), [tool('k1', 'Skill', { skill: 'habit-rc' })]),
      res(T(2), 'k1', 'Launching skill: habit-rc'),
      meta(T(2), 'k1', 'C:\\work\\app\\.claude\\skills\\habit-rc', then),
      asst('m2', T(3), [tool('k2', 'Skill', { skill: 'tool-run' })]),
      res(T(4), 'k2', 'Launching skill: tool-run'),
      meta(T(4), 'k2', 'C:\\work\\app\\.claude\\skills\\tool-run', '# Tool\n\nRun `node "C:\\Users\\dev\\.claude\\plugins\\cache\\m\\p\\9.9.9\\skills\\tool-run/scripts/total.js"` over the log.\n'),
    ];
    const vin = run([write(dir, rows), '--inventory', claude]).inventory.vintage;
    const row = (n) => vin.rows.find((r) => r.name === n) || {};
    assert.ok(Math.abs(row('habit-rc').currentChars - row('habit-rc').loadedChars) < 64, 'the net delta sits inside the old tolerance');
    assert.match(row('habit-rc').verdict, /^DIFFERS - same sections, 3 of 6 paragraph\(s\) changed \([+-]\d+ chars\) in the current source$/);
    assert.strictEqual(row('tool-run').verdict, 'same', 'a placeholder the harness expanded to a Windows path is no edit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// d56562c7#3: `cat dist/register_service.bat` - a service-registration script two project files' PostBuild steps call -
// scored a build-dir read (~626 tok) and fed the avoidable share the TOKEN VERDICT sums.
test('d56562c7#3: a script under a build-looking folder is source, not a build-dir read; a dependency tree\'s script still is', () => {
  const dir = tmp();
  try {
    const rows = [
      human(T(0), 'go'),
      asst('m1', T(1), [
        sh('b1', 'cat dist/register_service.bat'),
        sh('b2', 'cat bin/run.sh'),
        tool('b3', 'Read', { file_path: 'C:\\work\\app\\dist\\Deploy.PS1' }),
        sh('b4', 'cat node_modules/pkg/install.sh'),
        sh('b5', 'cat dist/app.js'),
        sh('b6', 'cat obj/project.assets.json'),
      ]),
      ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id) => res(T(2), id, 'x'.repeat(100))),
    ];
    const b = run([write(dir, rows)]).main.efficiency.buildDirReads;
    assert.deepStrictEqual([b.calls, Object.keys(b.paths).sort()], [3, ['dist/app.js', 'node_modules/pkg/install.sh', 'obj/project.assets.json']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// cc87fa6c#3: the install stamp post-dated the session (a later update rewrote it), so the vintage block named no
// version the session LOADED; ~8 calls went on deriving it by hand from the loaded text.
test('cc87fa6c#3: the ledger row carries the stack version its hook ran from, and the vintage block names it when no stamp predates the session', () => {
  const dir = tmp();
  try {
    const hookSrc = path.join(__dirname, '..', 'stack', 'hooks', 'instrument-tool-usage.js');
    const log = path.join(dir, 'ledger.jsonl');
    const place = (rel) => { const to = path.join(dir, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(hookSrc, to); return to; };
    const fire = (hook) => require('node:child_process').spawnSync(process.execPath, [hook], { encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'C:\\work\\app\\a.ts' }, session_id: 's1' }),
      env: { ...process.env, ALFRED_CODE_INSTRUMENT: '1', ALFRED_CODE_INSTRUMENT_LOG: log } }).status;
    const manifest = (root, body) => {
      fs.mkdirSync(path.join(dir, root, 'setup-plugin', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(dir, root, 'setup-plugin', '.claude-plugin', 'plugin.json'), body);
    };
    // the plugin route: the manifest two folders above the hook
    manifest('plug', JSON.stringify({ name: 'alfred-code', version: '9.8.7' }));
    assert.strictEqual(fire(place('plug/stack/hooks/instrument-tool-usage.js')), 0);
    // the copy route: the stamp beside `.claude/hooks/`
    fs.mkdirSync(path.join(dir, 'proj', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'proj', '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 9.6.5\ninstalled: 2026-07-01T00:00:00Z\n');
    assert.strictEqual(fire(place('proj/.claude/hooks/instrument-tool-usage.js')), 0);
    // another plugin's manifest, a torn one and no file at all name nothing, and the row is still written
    manifest('other', JSON.stringify({ name: 'other', version: '1.0.0' }));
    assert.strictEqual(fire(place('other/stack/hooks/instrument-tool-usage.js')), 0);
    manifest('torn', '{"name": "alfred-code", "vers');
    assert.strictEqual(fire(place('torn/stack/hooks/instrument-tool-usage.js')), 0);
    assert.strictEqual(fire(place('bare/hooks/instrument-tool-usage.js')), 0);
    // this checkout's own hook reads its own manifest
    assert.strictEqual(fire(hookSrc), 0);
    const own = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const hrows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(hrows.map((r) => r.version), ['9.8.7', '9.6.5', null, null, null, own]);
    assert.strictEqual(Object.keys(hrows[0]).pop(), 'version', 'added after the pinned fields');

    // the analyzer: a session whose stamp was written after it, its ledger naming 2.2.2 on 2 of 3 rows
    const claude = path.join(dir, 'install', '.claude');
    fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'rules', 'a.md'), '# a\n');
    const file = write(dir, [human(T(0), 'go'), asst('m1', T(1), [tool('r1', 'Read', { file_path: 'C:\\work\\app\\a.ts' })]), res(T(2), 'r1', 'x')]);
    const ledger = (vers) => write(dir, vers.map((v, i) => ({ ts: T(1 + i), session: 's1', tool: 'Read', detail: 'a.ts', cwd: WIN_CWD,
      tool_use_id: i ? null : 'r1', agent_id: null, ...(v ? { version: v } : {}) })), 'ledger-in.jsonl');
    const md = (args) => text([file, '--report-md', '--inventory', claude, ...args]);
    fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'sha: abcdef1234567890\nversion: 2.3.0\ninstalled: 2026-07-16T00:00:00Z\n');
    const after = md(['--hook-log', ledger(['2.2.2', '2.2.2', null])]);
    assert.match(after, /\| Stack install \| v2\.3\.0 \(abcdef123456\), stamped 2026-07-16T00:00:00Z - INSTALLED AFTER this session/);
    assert.match(after, /\| Stack loaded \| v2\.2\.2 on 2 of 3 rows - the tool-usage ledger's `version`/);
    // no stamp: the install row points at the ledger's version instead of UNKNOWN; a mid-session update is two spans
    fs.rmSync(path.join(claude, 'alfred-code.stamp'));
    const gone = md(['--hook-log', ledger(['2.2.2', '2.3.0', '2.3.0'])]);
    assert.match(gone, /\| Stack install \| no `alfred-code\.stamp` reachable - the Stack loaded row names the version this session's hooks ran from \|/);
    assert.ok(gone.includes(`| Stack loaded | v2.2.2 on 1 of 3 rows (${T(1)} → ${T(1)}), v2.3.0 on 2 of 3 rows (${T(2)} → ${T(3)}) -`));
    assert.match(text([file, '--hook-log', ledger(['2.2.2', '2.3.0', '2.3.0'])]), /stack loaded: v2\.2\.2 on 1 of 3 rows/);
    // a ledger from a hook older than the field, and no ledger at all: UNKNOWN, unchanged
    for (const args of [['--hook-log', ledger([null, null])], []]) {
      const old = md(args);
      assert.match(old, /the install version this session loaded is UNKNOWN/);
      assert.doesNotMatch(old, /Stack loaded/);
    }
    assert.deepStrictEqual(run([file, '--hook-log', ledger(['2.2.2', null])]).hookLog.versions, { '2.2.2': { rows: 1, firstTs: T(1), lastTs: T(1) } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
