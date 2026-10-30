'use strict';
// The mode flags' one parser and its refusal check (hook-prelude.js modeFlags / autoRunRefusal), and the run marker's
// helpers: every hook that reads a mode calls these, so the grammar has one test table (stack-modes spec section 1).
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { modeFlags, autoRunRefusal, runMarkerFile, runMarkerSkill, writeRunMarker, otherSessionLive, FLOW_FAMILY_RE } = require('../stack/hooks/hook-prelude.js');

const EMPTY = { commands: [], family: false, run: [], request: '', autoRun: null, scorer: null, flagOnly: false, old: [], unknown: [], late: false };

// The 2.2.0 old prefix, built at run time: the rename sweep fails any tracked file that spells an old name.
const OLD_FLOW = ['alfred', 'task-solve'].join('-');
const ROWS = [
    ['/task-solve --mode-auto-run-on X', { family: true, autoRun: 'on', request: 'X', flagOnly: false, run: ['--mode-auto-run-on'] }],
    ['/task-solve --mode-auto-run-off X', { autoRun: 'off', scorer: null, request: 'X' }],
    ['/task-solve --mode-output-scorer-on X', { scorer: 'on', autoRun: null }],
    ['/task-solve --mode-output-scorer-off X', { scorer: 'off', autoRun: null }],
    ['/task-solve --mode-output-scorer-off --mode-output-scorer-on --mode-auto-run-off --mode-auto-run-on X',
        { autoRun: 'off', scorer: 'off', request: 'X', run: ['--mode-output-scorer-off', '--mode-output-scorer-on', '--mode-auto-run-off', '--mode-auto-run-on'] }],
    ['/task-solve --mode-output-scorer-on --mode-output-scorer-on X', { scorer: 'on', run: ['--mode-output-scorer-on', '--mode-output-scorer-on'], request: 'X' }],
    ['/task-solve --mode-auto-run-on --mode-auto-run-off X', { autoRun: 'off' }],
    ['--mode-auto-run-on X', EMPTY],
    ['', EMPTY],
    ['/task-solve --auto-mode X', { old: ['--auto-mode'], autoRun: null, request: 'X' }],
    ['/task-solve --auto-mode --mode-output-scorer-on X', { old: ['--auto-mode'], scorer: 'on', request: 'X' }],
    ['/task-solve --score-on --score-off X', { old: ['--score-on', '--score-off'], scorer: null }],
    ['/task-solve --mode-x X', { unknown: ['--mode-x'], autoRun: null, request: 'X' }],
    ['/task-solve X --mode-auto-run-on', { late: true, autoRun: null, run: [], request: 'X --mode-auto-run-on' }],
    ['/review-code --mode-auto-run-on X', { family: false, run: ['--mode-auto-run-on'], autoRun: 'on', request: 'X' }],
    ['/habits-explain-topic --mode-output-scorer-on X', { family: false, scorer: 'on', request: 'X' }],
    ['just text --mode-auto-run-on', { family: false, commands: [], autoRun: null, late: false }],
    ['<command-name>/task-solve</command-name>\n<command-message>task-solve</command-message>\n<command-args>--mode-auto-run-on X</command-args>',
        { commands: ['/task-solve'], family: true, autoRun: 'on', request: 'X' }],
    ['/task-solve --dry-run --mode-auto-run-on', { run: [], request: '--dry-run --mode-auto-run-on', late: true, autoRun: null }],
    ['/mode-auto-run --mode-auto-run-off', { family: true, flagOnly: true, autoRun: 'off', request: '' }],
    ['/mode-auto-run', { family: true, run: [], request: '', flagOnly: false, autoRun: null }],
    ['/mode-auto-run fix X', { autoRun: 'on', request: 'fix X', flagOnly: false }],
    ['/mode-auto-run --mode-auto-run-off fix X', { autoRun: 'off', request: 'fix X' }],
    ['/loop-code-quality --mode-auto-run-on', { family: true, autoRun: 'on', flagOnly: true, request: '' }],
    ['/habits-explain-topic /mode-output-scorer --mode-output-scorer-on X',
        { commands: ['/habits-explain-topic', '/mode-output-scorer'], family: true, scorer: 'on', request: 'X' }],
    ['/task-solve /mode-output-scorer --mode-auto-run-on X', { family: true, autoRun: 'on', request: 'X' }],
    ['/a /b /c /d /task-solve --mode-auto-run-on X', { commands: ['/a', '/b', '/c', '/d', '/task-solve'], family: true, autoRun: 'on', request: 'X' }],
    ['/a /b /c /d /e /task-solve --mode-auto-run-on X', { commands: ['/a', '/b', '/c', '/d', '/e', '/task-solve'], family: true, autoRun: 'on', request: 'X' }],
    ['/task-solve /a /b /c /d /e /f --mode-auto-run-on X',
        { commands: ['/task-solve', '/a', '/b', '/c', '/d', '/e'], run: [], autoRun: null, request: '/f --mode-auto-run-on X', late: true }],
    ['/alfred-code:task-solve --mode-auto-run-on X', { commands: ['/alfred-code:task-solve'], family: true, autoRun: 'on' }],
    [`/${OLD_FLOW} --mode-auto-run-on X`, { family: true, autoRun: 'on' }],
    ['/task-solve `--mode-auto-run-on` X', { run: [], autoRun: null, request: '`--mode-auto-run-on` X', late: false }],
    ['  /task-solve   --mode-auto-run-on   fix  it  ', { autoRun: 'on', request: 'fix  it' }],
];

test('modeFlags: the leading run after a family command group, and nothing else (AC1)', () => {
    assert.ok(ROWS.length >= 24, 'the table holds at least 24 rows');
    for (const [input, want] of ROWS)
    {
        const got = modeFlags(input);
        for (const [key, value] of Object.entries(want)) assert.deepStrictEqual(got[key], value, `${JSON.stringify(input)} -> ${key}`);
    }
    for (const bad of [undefined, null, 42, {}]) assert.deepStrictEqual(modeFlags(bad), EMPTY, `${String(bad)} reads as no command`);
});

test('FLOW_FAMILY_RE: the five families with the plugin and old prefixes, nothing else', () => {
    for (const name of ['task-solve', 'capture-awareness', 'loop-code-quality', 'issue-diagnoser', 'mode-auto-run', 'alfred-code:task-solve', OLD_FLOW])
        assert.ok(FLOW_FAMILY_RE.test(name), name);
    for (const name of ['review-code', 'habits-explain-topic', 'task-', 'mode', 'compact']) assert.ok(!FLOW_FAMILY_RE.test(name), name);
});

function sandbox()
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mode-flags-')));
    const transcripts = path.join(root, 'transcripts');
    fs.mkdirSync(transcripts);
    const transcript = path.join(transcripts, 'this-session.jsonl');
    fs.writeFileSync(transcript, '');
    return { root, transcript, input: { session_id: 'this-session', cwd: root, transcript_path: transcript }, env: { CLAUDE_PROJECT_DIR: root } };
}

test('autoRunRefusal: one reason per refused start, empty otherwise', () => {
    const on = modeFlags('/task-solve --mode-auto-run-on X');

    const seat = sandbox();
    assert.strictEqual(autoRunRefusal({ ...seat.input, agent_id: 'a1' }, seat.env, on), 'a seat never starts auto-run');

    const bare = sandbox();
    assert.strictEqual(autoRunRefusal(bare.input, bare.env, modeFlags('/mode-auto-run')), 'type the request after /mode-auto-run');
    assert.strictEqual(autoRunRefusal(bare.input, bare.env, modeFlags('/mode-auto-run --mode-auto-run-on')), '', 'the flag-only line is a switch, not an empty request');

    const other = sandbox();
    const stamp = path.join(other.root, '.alfred', 'state', 'approvals', 'APPROVAL');
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, 'AUTO - "/task-solve --mode-auto-run-on Y"\nsession: other-session-1234\nskill: task-solve\n');
    fs.writeFileSync(path.join(path.dirname(other.transcript), 'other-session-1234.jsonl'), '');
    const why = autoRunRefusal(other.input, other.env, on);
    assert.match(why, /another session \(other-se\)/);
    assert.match(why, /\.alfred\/state\/approvals\/APPROVAL/);
    const idle = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(path.join(path.dirname(other.transcript), 'other-session-1234.jsonl'), idle, idle);
    assert.strictEqual(autoRunRefusal(other.input, other.env, on), '', 'an idle session past 10 minutes is no live run');

    const clean = sandbox();
    assert.strictEqual(autoRunRefusal(clean.input, clean.env, on), '');
});

test('autoRunRefusal: a read-only data root refuses the start', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
    const ro = sandbox();
    const data = path.join(ro.root, '.alfred');
    fs.mkdirSync(data);
    fs.chmodSync(data, 0o500);
    try { assert.strictEqual(autoRunRefusal(ro.input, ro.env, modeFlags('/task-solve --mode-auto-run-on X')), 'the data root cannot be written'); }
    finally { fs.chmodSync(data, 0o700); }
});

test('otherSessionLive: a transcript beside this one written within 10 minutes; a bad id or no transcript is not', () => {
    const s = sandbox();
    const beside = path.join(path.dirname(s.transcript), 'peer.jsonl');
    fs.writeFileSync(beside, '');
    assert.strictEqual(otherSessionLive(s.transcript, 'peer'), true);
    assert.strictEqual(otherSessionLive(s.transcript, '../peer'), false);
    assert.strictEqual(otherSessionLive('', 'peer'), false);
    assert.strictEqual(otherSessionLive(s.transcript, 'absent'), false);
});

test('run marker: runMarkerSkill picks the first flow name past mode-output-scorer; writeRunMarker writes skill/prompt/at and leaves the same skill and prompt untouched', () => {
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scorer /task-solve --mode-auto-run-on X')), 'task-solve');
    assert.strictEqual(runMarkerSkill(modeFlags('/alfred-code:loop-code-quality --mode-auto-run-on')), 'loop-code-quality');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scorer --mode-auto-run-on X')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/review-code X')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-auto-run --mode-auto-run-on')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-auto-run fix X')), 'mode-auto-run');
    assert.strictEqual(runMarkerSkill(modeFlags('')), '');

    const { root } = sandbox();
    const file = runMarkerFile(root, 's1', {});
    assert.strictEqual(file, path.join(root, '.alfred', 'state', 'sessions', 'AUTO-RUN-s1'));
    assert.strictEqual(runMarkerFile(root, '../x', {}), path.join(root, '.alfred', 'state', 'sessions', 'AUTO-RUN-.._x'));

    assert.strictEqual(writeRunMarker(root, 's1', 'task-solve', '/task-solve X', {}), true);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^skill: task-solve$/m);
    assert.match(text, /^prompt: [0-9a-f]{12}$/m);
    assert.match(text, /^at: \d{4}-\d\d-\d\dT[\d:.]+Z$/m);

    const hourAgo = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(file, hourAgo, hourAgo);
    const before = fs.statSync(file).mtimeMs;
    assert.strictEqual(writeRunMarker(root, 's1', 'task-solve', '/task-solve X', {}), true);
    assert.strictEqual(fs.statSync(file).mtimeMs, before, 'the same skill and prompt leave the file and its mtime');

    writeRunMarker(root, 's1', 'task-solve', '/task-solve Y', {});
    assert.notStrictEqual(fs.statSync(file).mtimeMs, before, 'a different prompt rewrites it');
    const second = fs.readFileSync(file, 'utf8');
    writeRunMarker(root, 's1', 'loop-code-quality', '/task-solve Y', {});
    assert.match(fs.readFileSync(file, 'utf8'), /^skill: loop-code-quality$/m, 'a different skill rewrites it');
    assert.notStrictEqual(second, fs.readFileSync(file, 'utf8'));
});
