'use strict';
// The modes' one parser and its refusal check (hook-prelude.js modeFlags / autoRunRefusal), and the run marker's
// helpers: every hook that reads a mode calls these, so the grammar has one test table (stack-modes spec section 1).
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { modeFlags, autoRunRefusal, runMarkerFile, runMarkerSkill, writeRunMarker, otherSessionLive, FLOW_FAMILY_RE } = require('../stack/hooks/hook-prelude.js');

const EMPTY = { commands: [], family: false, run: [], request: '', autoRun: null, scoring: null, compact: null, mode: null, extra: false, flagOnly: false, old: [], level: null };

// The 2.2.0 old prefix, built at run time: the rename sweep fails any tracked file that spells an old name.
const OLD_FLOW = ['alfred', 'task-solve'].join('-');
const AUTO = '/alfred-code:mode:auto-run';
const SCORING = '/alfred-code:mode:scoring';
const COMPACT = '/alfred-code:mode:auto-compact';
const ROWS = [
    // a mode command line: the command alone on its line, then on or off
    [`${AUTO} on`, { mode: 'auto-run', autoRun: 'on', scoring: null, compact: null, extra: false, family: true, flagOnly: true, request: '', run: [], commands: [AUTO] }],
    [`${AUTO} off`, { mode: 'auto-run', autoRun: 'off', family: true, flagOnly: true }],
    [`${SCORING} on`, { mode: 'scoring', scoring: 'on', autoRun: null, compact: null, family: true, flagOnly: true, commands: [SCORING] }],
    [`${SCORING} OFF`, { mode: 'scoring', scoring: 'off', extra: false }],
    [`${COMPACT} on`, { mode: 'auto-compact', compact: 'on', autoRun: null, scoring: null, family: true, flagOnly: true }],
    [`${COMPACT} off`, { mode: 'auto-compact', compact: 'off', extra: false }],
    [`  ${COMPACT}   On  `, { mode: 'auto-compact', compact: 'on', request: '' }],
    [`${SCORING.toUpperCase()} on`, { mode: 'scoring', scoring: 'on' }],
    [SCORING, { mode: 'scoring', scoring: null, extra: false, family: true, flagOnly: true, request: '', commands: [SCORING] }],
    [`${SCORING} yes`, { mode: 'scoring', scoring: null, extra: true, family: true, flagOnly: true, request: '' }],
    [`${SCORING} on now`, { mode: 'scoring', scoring: null, extra: true }],
    [`${SCORING} on off`, { mode: 'scoring', scoring: null, extra: true }],
    [`${SCORING} /task-solve x`, { mode: 'scoring', scoring: null, extra: true, commands: [SCORING], request: '' }],
    [`${AUTO} --mode-auto-run-on`, { mode: 'auto-run', autoRun: null, extra: true, old: [] }],
    ['/alfred-code:mode:other on', { mode: null, scoring: null, autoRun: null, compact: null, extra: false }],
    ['/mode:scoring on', { mode: null, scoring: null }],
    ['/alfred-code:mode:scoring-x on', { mode: null, scoring: null }],
    [`/task-solve ${AUTO} on`, { mode: null, autoRun: null, family: true }],
    [`${AUTO} on\nfix the login`, { mode: 'auto-run', autoRun: null, extra: true }],
    ['<command-name>/alfred-code:mode:auto-run</command-name>\n<command-message>alfred-code:mode:auto-run</command-message>\n<command-args>on</command-args>',
        { mode: 'auto-run', autoRun: 'on', commands: [AUTO], family: true, flagOnly: true }],
    ['<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>off</command-args>', { mode: 'auto-run', autoRun: 'off' }],
    ['<command-name>/alfred-code:mode:auto-compact</command-name>\n<command-args></command-args>', { mode: 'auto-compact', compact: null, extra: false }],
    // the scoring level slot (stage 3): one more token of digits after on or off, scoring alone; the parser judges no range
    [`${SCORING} on 75`, { scoring: 'on', level: '75', extra: false }],
    [`${SCORING} off 85`, { scoring: 'off', level: '85', extra: false }],
    [`${SCORING} on 59`, { scoring: 'on', level: '59', extra: false }],
    [`${SCORING} on 101`, { scoring: 'on', level: '101', extra: false }],
    [`${SCORING} on`, { scoring: 'on', level: null }],
    [`${SCORING} 75`, { scoring: null, level: null, extra: true }],
    [`${SCORING} on 75 now`, { scoring: null, level: null, extra: true }],
    [`${SCORING} on high`, { scoring: null, level: null, extra: true }],
    [`${SCORING} on 7.5`, { scoring: null, level: null, extra: true }],
    [`${SCORING} on -75`, { scoring: null, level: null, extra: true }],
    [`${AUTO} on 75`, { autoRun: null, level: null, extra: true }],
    [`${COMPACT} off 75`, { compact: null, level: null, extra: true }],
    ['<command-name>/alfred-code:mode:scoring</command-name>\n<command-args>on 75</command-args>', { scoring: 'on', level: '75', extra: false }],
    // a retired flag switches nothing: the leading run is stripped into `old`
    ['/task-solve --mode-auto-run-on X', { family: true, autoRun: null, scoring: null, mode: null, old: ['--mode-auto-run-on'], run: ['--mode-auto-run-on'], request: 'X', flagOnly: false }],
    ['/task-solve --mode-auto-run-off X', { autoRun: null, old: ['--mode-auto-run-off'], request: 'X' }],
    ['/task-solve --mode-output-scorer-on --auto-mode --mode-x X', { scoring: null, autoRun: null, old: ['--mode-output-scorer-on', '--auto-mode', '--mode-x'], request: 'X' }],
    ['/task-solve --score-on --score-off --score-on X', { old: ['--score-on', '--score-off'], run: ['--score-on', '--score-off', '--score-on'], scoring: null }],
    ['/task-solve X --mode-auto-run-on', { old: [], run: [], autoRun: null, request: 'X --mode-auto-run-on' }],
    ['/task-solve --dry-run --mode-auto-run-on', { old: [], run: [], request: '--dry-run --mode-auto-run-on', autoRun: null }],
    ['/review-code --mode-auto-run-on X', { family: false, old: ['--mode-auto-run-on'], autoRun: null, request: 'X' }],
    ['--mode-auto-run-on X', EMPTY],
    ['', EMPTY],
    ['just text --mode-auto-run-on', EMPTY],
    ['<command-name>/task-solve</command-name>\n<command-message>task-solve</command-message>\n<command-args>--mode-auto-run-on X</command-args>',
        { commands: ['/task-solve'], family: true, autoRun: null, old: ['--mode-auto-run-on'], request: 'X' }],
    ['/loop-code-quality --mode-auto-run-on', { family: true, autoRun: null, old: ['--mode-auto-run-on'], flagOnly: true, request: '' }],
    // `/mode-auto-run <request>`: the typed request is its own waiver
    ['/mode-auto-run fix X', { autoRun: 'on', request: 'fix X', flagOnly: false, family: true, mode: null }],
    ['/mode-auto-run --mode-auto-run-on fix X', { autoRun: 'on', old: ['--mode-auto-run-on'], request: 'fix X' }],
    ['/mode-auto-run --mode-auto-run-off fix X', { autoRun: 'on', old: ['--mode-auto-run-off'], request: 'fix X' }],
    ['/mode-auto-run', { family: true, run: [], request: '', flagOnly: false, autoRun: null }],
    ['/mode-auto-run --mode-auto-run-off', { family: true, flagOnly: true, autoRun: null, old: ['--mode-auto-run-off'], request: '' }],
    // command groups, prefixes and spacing
    ['/habits-explain-topic /mode-output-scoring X', { commands: ['/habits-explain-topic', '/mode-output-scoring'], family: true, scoring: null, request: 'X' }],
    ['/a /b /c /d /task-solve X', { commands: ['/a', '/b', '/c', '/d', '/task-solve'], family: true, request: 'X' }],
    ['/a /b /c /d /e /task-solve X', { commands: ['/a', '/b', '/c', '/d', '/e', '/task-solve'], family: true, request: 'X' }],
    ['/task-solve /a /b /c /d /e /f X', { commands: ['/task-solve', '/a', '/b', '/c', '/d', '/e'], run: [], request: '/f X' }],
    ['/alfred-code:task-solve X', { commands: ['/alfred-code:task-solve'], family: true, request: 'X' }],
    [`/${OLD_FLOW} X`, { family: true, request: 'X' }],
    ['/task-solve `--mode-auto-run-on` X', { run: [], old: [], autoRun: null, request: '`--mode-auto-run-on` X' }],
    ['  /task-solve   fix  it  ', { family: true, request: 'fix  it' }],
];

test('modeFlags: a mode command line switches, a retired flag only lands in `old`, and nothing else is read', () => {
    assert.ok(ROWS.length >= 40, 'the table holds at least 40 rows');
    for (const [input, want] of ROWS)
    {
        const got = modeFlags(input);
        for (const [key, value] of Object.entries(want)) assert.deepStrictEqual(got[key], value, `${JSON.stringify(input)} -> ${key}`);
    }
    for (const bad of [undefined, null, 42, {}]) assert.deepStrictEqual(modeFlags(bad), EMPTY, `${String(bad)} reads as no command`);
    assert.deepStrictEqual(Object.keys(modeFlags('/task-solve X')).sort(), Object.keys(EMPTY).sort(), 'no field past the table\'s');
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
    const on = modeFlags('/alfred-code:mode:auto-run on');

    const seat = sandbox();
    assert.strictEqual(autoRunRefusal({ ...seat.input, agent_id: 'a1' }, seat.env, on), 'a seat never starts auto-run');

    const bare = sandbox();
    assert.strictEqual(autoRunRefusal(bare.input, bare.env, modeFlags('/mode-auto-run')), 'type the request after /mode-auto-run');
    assert.strictEqual(autoRunRefusal(bare.input, bare.env, modeFlags('/mode-auto-run --mode-auto-run-on')), 'type the request after /mode-auto-run', 'a retired flag is no request');
    assert.strictEqual(autoRunRefusal(bare.input, bare.env, on), '', 'the mode command needs no request');

    const other = sandbox();
    const stamp = path.join(other.root, '.alfred', 'state', 'approvals', 'APPROVAL');
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, 'AUTO - "/alfred-code:mode:auto-run on"\nsession: other-session-1234\nskill: alfred-code:mode:auto-run\n');
    fs.writeFileSync(path.join(path.dirname(other.transcript), 'other-session-1234.jsonl'), '');
    const why = autoRunRefusal(other.input, other.env, on);
    assert.match(why, /another session \(other-se\)/);
    assert.match(why, /\.alfred\/state\/approvals\/APPROVAL/);
    assert.match(why, /it ends with \/alfred-code:mode:auto-run off there/);
    assert.doesNotMatch(why, /--mode-/);
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
    try { assert.strictEqual(autoRunRefusal(ro.input, ro.env, modeFlags('/alfred-code:mode:auto-run on')), 'the data root cannot be written'); }
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

test('run marker: runMarkerSkill picks the first flow name past mode-output-scoring; writeRunMarker writes skill/prompt/at and leaves the same skill and prompt untouched', () => {
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scoring /task-solve X')), 'task-solve');
    assert.strictEqual(runMarkerSkill(modeFlags('/alfred-code:loop-code-quality')), 'loop-code-quality');
    assert.strictEqual(runMarkerSkill(modeFlags('/task-solve --mode-auto-run-on X')), 'task-solve', 'a retired flag does not stop the run it rides on');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scoring X')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scorer /task-solve X')), 'task-solve');   // legacy
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-output-scorer X')), '');   // legacy
    assert.strictEqual(runMarkerSkill(modeFlags('/review-code X')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-auto-run --mode-auto-run-on')), '');
    assert.strictEqual(runMarkerSkill(modeFlags('/mode-auto-run fix X')), 'mode-auto-run');
    for (const line of ['/alfred-code:mode:auto-run on', '/alfred-code:mode:auto-run off', '/alfred-code:mode:scoring on', '/alfred-code:mode:auto-compact on', '/alfred-code:mode:auto-run'])
        assert.strictEqual(runMarkerSkill(modeFlags(line)), '', `${line} opens no run`);
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

// Why no fresh-session ask is made (the mode-commands spec, section 4): the project's variable, this session's live
// auto-run, the session's own auto-compact switch - in that order; the typed line first, the file second.
test('compactCause: project, auto-run, mode, in that order; garbage adds none', () => {
    const { compactCause, compactFile, COMPACT_SAID } = require('../stack/hooks/hook-prelude.js');
    assert.deepStrictEqual(COMPACT_SAID, { project: 'ALFRED_CODE_AUTO_COMPACT=1', 'auto-run': 'auto-run is on', mode: '/alfred-code:mode:auto-compact on' });
    const { root } = sandbox();
    const input = { session_id: 's1', cwd: root };
    const env = { CLAUDE_PROJECT_DIR: root };
    const file = compactFile(root, 's1', env);
    assert.strictEqual(file, path.join(root, '.alfred', 'state', 'sessions', 'AUTO-COMPACT-s1'));
    assert.strictEqual(compactFile(root, '../x', env), path.join(root, '.alfred', 'state', 'sessions', 'AUTO-COMPACT-.._x'));
    assert.strictEqual(compactFile(root, '', env), null);
    const write = (text) => { fs.rmSync(file, { recursive: true, force: true }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    assert.strictEqual(compactCause(input, env), '', 'nothing set');
    for (const [text, want] of [['on\nat: 2026-11-12T00:00:00.000Z\n', 'mode'], ['on', 'mode'], ['on\r\n', 'mode'], ['off\nat: x\n', ''], ['', ''], ['maybe\n', ''], ['ON\n', ''], ['at: x\non\n', '']])
    {
        write(text);
        assert.strictEqual(compactCause(input, env), want, JSON.stringify(text));
    }
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.strictEqual(compactCause(input, env), '', 'a folder is no switch');
    fs.rmSync(file, { recursive: true });
    // the typed line first: this prompt's own on / off, before the writer's file is there
    assert.strictEqual(compactCause(input, env, modeFlags('/alfred-code:mode:auto-compact on')), 'mode', 'on, no file yet');
    assert.strictEqual(compactCause(input, { ...env, ALFRED_CODE_HOOKS_OFF: 'guard-fresh-session-start' }, modeFlags('/alfred-code:mode:auto-compact on')), '', 'the writer is off: nothing would be stored');
    write('on\n');
    assert.strictEqual(compactCause(input, env, modeFlags('/alfred-code:mode:auto-compact off')), '', 'off, the file still on');
    assert.strictEqual(compactCause(input, env, modeFlags('/alfred-code:mode:auto-compact')), 'mode', 'the bare command reads the file');
    assert.strictEqual(compactCause(input, env, modeFlags('/task-solve X')), 'mode');
    assert.strictEqual(compactCause({ session_id: 's2', cwd: root }, env), '', 'another session\'s switch');
    // auto-run outranks the session's switch, the project's variable outranks both
    const stamp = path.join(root, '.alfred', 'state', 'approvals', 'APPROVAL');
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, 'AUTO - "/alfred-code:mode:auto-run on"\nsession: s1\n');
    assert.strictEqual(compactCause(input, env), 'auto-run');
    assert.strictEqual(compactCause(input, env, modeFlags('/alfred-code:mode:auto-compact off')), 'auto-run', 'off takes back only the session\'s own on');
    assert.strictEqual(compactCause(input, env, modeFlags('/alfred-code:mode:auto-run off')), 'mode', 'this prompt ends auto-run; the switch still holds');
    fs.rmSync(file);
    assert.strictEqual(compactCause({ session_id: 's2', cwd: root }, env), '', 'a stamp naming another session');
    assert.strictEqual(compactCause({ session_id: 's2', cwd: root }, env, modeFlags('/alfred-code:mode:auto-run on')), 'auto-run', 'this prompt starts auto-run for s2 over an idle stamp');
    assert.strictEqual(compactCause(input, { ...env, ALFRED_CODE_AUTO_COMPACT: '1' }), 'project');
    assert.strictEqual(compactCause(input, { ...env, ALFRED_CODE_AUTO_COMPACT: ' 1 ' }), 'project');
    assert.strictEqual(compactCause(input, { ...env, ALFRED_CODE_AUTO_COMPACT: '0' }), 'auto-run');
    fs.rmSync(stamp);
    assert.strictEqual(compactCause(input, { ...env, ALFRED_CODE_AUTO_COMPACT: 'true' }), '', 'only 1 is the project switch');
    for (const bad of [null, undefined, 42, {}]) assert.strictEqual(compactCause(bad, env), '', `${String(bad)} never throws`);
    write('on\n');
    assert.strictEqual(compactCause(input, {}), 'mode', 'the payload\'s cwd is the root when the env names none');
});
