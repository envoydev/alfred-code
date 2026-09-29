'use strict';
// monitor-session.js - the injection-only live monitor (improvement plan 2.1). Three facts from the
// call stream, never a denial: one call repeated with identical input, a turn writing many files,
// and the context nearing this session's fresh-session trigger.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'monitor-session.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-session-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// A pinned environment: an empty account dir (no model from a real settings file), no seeded window,
// no trigger overrides, no docs root from the session running this suite.
const BASE_ENV = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-')) };
for (const k of ['ALFRED_CODE_DOCS_PATH', 'CLAUDE_DOCS_PATH', 'ALFRED_CODE_MONITOR', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_DEFAULT_CONTEXT_WINDOW',
    'ALFRED_CODE_FRESH_SESSION_200K', 'ALFRED_CODE_FRESH_SESSION_1M', 'ALFRED_CODE_FRESH_SESSION_DEFAULT'])
    delete BASE_ENV[k];
// envOf (hook-prelude.js, 2.0.0) now answers a bare CLAUDE_STACK_* the same way it answers // legacy-name
// ALFRED_CODE_* - so the same session-env leakage above reaches every 1.x-spelled setting too.
for (const k of Object.keys(BASE_ENV)) if (k.startsWith('CLAUDE_STACK_')) delete BASE_ENV[k]; // legacy-name

let seq = 0;
function session(env = {})
{
    const root = fs.mkdtempSync(path.join(TMP, `root-${seq++}-`));
    const sid = `s${seq}`;
    const hook = (payload) =>
    {
        const r = spawnSync(process.execPath, [HOOK], {
            input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: sid, cwd: root, ...payload }),
            encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: root, ...env },
        });
        assert.strictEqual(r.status, 0, `the monitor exited ${r.status}: ${r.stderr}`);
        return r.stdout;
    };
    const rows = () =>
    {
        try { return fs.readFileSync(path.join(root, '.alfred', 'docs', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
        catch { return []; }
    };
    const stateFile = path.join(root, '.alfred', 'docs', 'flow', `monitor-${sid}.jsonl`);
    const call = (tool, input, extra = {}) => hook({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, ...extra });
    const prompt = () => hook({ hook_event_name: 'UserPromptSubmit', prompt: 'next' });
    return { root, sid, hook, rows, stateFile, call, prompt };
}

test('monitor: a call repeated with identical input is noted at the fifth time, once per turn', () =>
{
    const s = session();
    for (let i = 0; i < 4; i++) s.call('Bash', { command: 'git status' });
    assert.strictEqual(s.rows().length, 0, 'four identical calls were noted');
    s.call('Bash', { command: 'git status' });
    const rows = s.rows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].mode, 'monitor');
    assert.strictEqual(rows[0].kind, 'repeat');
    assert.strictEqual(rows[0].tool, 'Bash');
    assert.strictEqual(rows[0].hook, 'monitor-session.js');
    assert.match(rows[0].reason, /Bash 5 times with identical input/);
    s.call('Bash', { command: 'git status' });
    assert.strictEqual(s.rows().length, 1, 'the sixth call in the same turn noted it again');
    s.call('Bash', { command: 'git status --short' });
    assert.strictEqual(s.rows().length, 1, 'a different input was counted with the first');
});

test('monitor: identical calls split across two turns are never noted', () =>
{
    const s = session();
    for (let i = 0; i < 3; i++) s.call('Read', { file_path: 'a.js' });
    s.prompt();
    for (let i = 0; i < 3; i++) s.call('Read', { file_path: 'a.js' });
    assert.strictEqual(s.rows().length, 0);
});

test('monitor: a subagent is counted under its own agent_id', () =>
{
    const s = session();
    for (let i = 0; i < 3; i++) s.call('Grep', { pattern: 'x' });
    for (let i = 0; i < 3; i++) s.call('Grep', { pattern: 'x' }, { agent_id: 'agent-a' });
    assert.strictEqual(s.rows().length, 0, 'the main session and a subagent shared one count');
    for (let i = 0; i < 2; i++) s.call('Grep', { pattern: 'x' }, { agent_id: 'agent-a' });
    const rows = s.rows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].detail.actor, 'agent-a');
});

test('monitor: the repeat row says how many files were written between the repeats', () =>
{
    // The week of log-only rows has to tell a stuck loop (nothing written between runs) from a test
    // re-run after each edit - the same command, legitimately.
    const s = session();
    for (let i = 0; i < 5; i++)
    {
        s.call('Bash', { command: 'npm test' });
        if (i < 4) s.call('Edit', { file_path: path.join(s.root, 'src.js'), old_string: `${i}`, new_string: `${i + 1}` });
    }
    const [row] = s.rows();
    assert.strictEqual(row.kind, 'repeat');
    assert.strictEqual(row.detail.writesBetween, 4);
});

test('monitor: past 20 distinct files written in one turn, one scope note', () =>
{
    const s = session();
    for (let i = 0; i < 20; i++) s.call('Write', { file_path: path.join(s.root, `f${i}.js`), content: 'x' });
    s.call('Edit', { file_path: path.join(s.root, 'f0.js'), old_string: 'x', new_string: 'y' });
    assert.strictEqual(s.rows().length, 0, 'twenty distinct files (one written twice) were noted');
    s.call('Write', { file_path: path.join(s.root, 'f20.js'), content: 'x' });
    const rows = s.rows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'scope');
    assert.strictEqual(rows[0].detail.files, 21);
    s.call('Write', { file_path: path.join(s.root, 'f21.js'), content: 'x' });
    assert.strictEqual(s.rows().length, 1, 'the scope note repeated in the same turn');
});

// The trigger comes from fresh-session.js: no model and no seeded window take the DEFAULT tier,
// 180,000 - so 80% of it is 144,000.
function transcriptAt(s, ctx)
{
    const p = path.join(s.root, 'transcript.jsonl');
    const rows = [
        { type: 'user', message: { role: 'user', content: 'go' } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: ctx - 10, input_tokens: 10 } } },
    ];
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}

test('monitor: the context note fires at 80% of the fresh-session trigger, once per session', () =>
{
    const under = session();
    under.call('Read', { file_path: 'a' }, { transcript_path: transcriptAt(under, 143999) });
    assert.strictEqual(under.rows().length, 0, 'one token under 80% was noted');

    const at = session();
    const tp = transcriptAt(at, 144000);
    at.call('Read', { file_path: 'a' }, { transcript_path: tp });
    const rows = at.rows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'context');
    assert.strictEqual(rows[0].detail.context, 144000);
    assert.strictEqual(rows[0].detail.trigger, 180000);
    at.prompt();
    at.call('Read', { file_path: 'b' }, { transcript_path: tp });
    assert.strictEqual(at.rows().length, 1, 'the context note fired twice in one session');
});

test('monitor: a subagent never takes the context note, and a switched-off trigger gives none', () =>
{
    const sub = session();
    sub.call('Read', { file_path: 'a' }, { agent_id: 'agent-a', transcript_path: transcriptAt(sub, 170000) });
    assert.strictEqual(sub.rows().length, 0);
    const off = session({ ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' });
    off.call('Read', { file_path: 'a' }, { transcript_path: transcriptAt(off, 170000) });
    assert.strictEqual(off.rows().length, 0);
});

test('monitor: log mode (the default) writes rows and injects nothing; inject mode injects; 0 does nothing', () =>
{
    const log = session();
    let out = '';
    for (let i = 0; i < 5; i++) out += log.call('Bash', { command: 'ls' });
    assert.strictEqual(out, '', 'log mode injected');
    assert.strictEqual(log.rows()[0].injected, false);

    const inject = session({ ALFRED_CODE_MONITOR: 'inject' });
    for (let i = 0; i < 4; i++) assert.strictEqual(inject.call('Bash', { command: 'ls' }), '');
    const o = JSON.parse(inject.call('Bash', { command: 'ls' }));
    assert.strictEqual(o.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(o.hookSpecificOutput.additionalContext, /you repeated Bash 5 times with identical input - stop and change approach/);
    assert.strictEqual(inject.rows()[0].injected, true);

    const off = session({ ALFRED_CODE_MONITOR: '0' });
    for (let i = 0; i < 6; i++) assert.strictEqual(off.call('Bash', { command: 'ls' }), '');
    assert.strictEqual(off.rows().length, 0);
    assert.ok(!fs.existsSync(off.stateFile), 'the switched-off monitor still kept state');
});

test('monitor: garbage state, garbage stdin and an unwired event are silent and never block', () =>
{
    const s = session();
    fs.mkdirSync(path.dirname(s.stateFile), { recursive: true });
    fs.writeFileSync(s.stateFile, '{not json\n[1,2]\n{"torn":');
    for (let i = 0; i < 5; i++) s.call('Bash', { command: 'ls' });
    assert.strictEqual(s.rows().length, 1, 'garbage lines in the turn log did not leave a working count');
    assert.strictEqual(s.hook('{oops'), '');
    assert.strictEqual(s.hook(''), '');
    assert.strictEqual(s.hook({ hook_event_name: 'Stop' }), '');
});

test('monitor: ALFRED_CODE_HOOKS_OFF naming it switches it off', () =>
{
    const s = session({ ALFRED_CODE_HOOKS_OFF: 'guard-answer-length,monitor-session' });
    for (let i = 0; i < 5; i++) s.call('Bash', { command: 'ls' });
    assert.strictEqual(s.rows().length, 0);
});

test('monitor: one call over a 5,000-row turn log stays inside the 25ms budget', () =>
{
    // The log is the turn's (a prompt empties it), so 5,000 calls is a long turn: the call's own row, the
    // parse and the count over all of them are what each call pays.
    const { rowFor, parseLog, notesFor } = require(HOOK);
    const lines = [];
    for (let i = 0; i < 5000; i++) lines.push(JSON.stringify({ id: `r${i}`, a: 'main', t: 'Bash', k: `main|Bash|${i.toString(16).padStart(12, '0')}`, f: '' }));
    const payload = { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/x.js', content: 'y'.repeat(50000) } };
    const t0 = process.hrtime.bigint();
    lines.push(JSON.stringify(rowFor(payload, 'mine')));
    const rows = parseLog(lines.join('\n'));
    const notes = notesFor(rows, 'mine', { contextNow: () => 0, trigger: () => null });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 25, `one call took ${ms.toFixed(1)}ms`);
    assert.strictEqual(rows.length, 5001);
    assert.deepStrictEqual(notes, []);
});

test('monitor: parallel calls lose no count - each judges the order the log recorded (2.1.5 M15)', async () =>
{
    // Parallel tool calls fire their PostToolUse hooks in parallel. A read-modify-write of one state file
    // lost updates, so five identical calls could be noted never, or twice; and 21 parallel writes could
    // miss the scope note. Each call now appends its own row and counts the rows up to it.
    const { spawn } = require('node:child_process');
    const s = session();
    const fire = (payload) => new Promise((resolve) =>
    {
        const child = spawn(process.execPath, [HOOK], { env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: s.root }, stdio: ['pipe', 'ignore', 'ignore'] });
        child.on('close', resolve);
        child.stdin.end(JSON.stringify({ session_id: s.sid, cwd: s.root, hook_event_name: 'PostToolUse', ...payload }));
    });
    await Promise.all(Array.from({ length: 12 }, () => fire({ tool_name: 'Bash', tool_input: { command: 'git status' } })));
    assert.deepStrictEqual(s.rows().map((r) => r.kind), ['repeat'], 'twelve parallel identical calls: exactly one repeat note');
    await Promise.all(Array.from({ length: 24 }, (_, i) => fire({ tool_name: 'Write', tool_input: { file_path: `f${i}.ts`, content: 'x' } })));
    assert.deepStrictEqual(s.rows().map((r) => r.kind), ['repeat', 'scope'], '24 parallel writes of distinct files: exactly one scope note');
});
