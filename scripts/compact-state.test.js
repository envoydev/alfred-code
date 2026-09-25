'use strict';
// PreCompact capture (improvement plan 2.2): guard-fresh-session-start.js writes
// <docs-path>/flow/COMPACT-STATE before a compaction - the live plan file, the open flow stamps with
// their ages, the files this session wrote - with no model call, and the SessionStart `compact`
// injection points at it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-fresh-session-start.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const BASE_ENV = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-')) };
for (const k of ['ALFRED_CODE_DOCS_PATH', 'CLAUDE_DOCS_PATH', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_DEFAULT_CONTEXT_WINDOW', 'ALFRED_CODE_DOCS_ASK',
    'ALFRED_CODE_FRESH_SESSION_200K', 'ALFRED_CODE_FRESH_SESSION_1M', 'ALFRED_CODE_FRESH_SESSION_DEFAULT'])
    delete BASE_ENV[k];

let seq = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, `root-${seq++}-`));
    // docs-session keeps its attribution state in os.tmpdir(); a private temp dir per case keeps a
    // planted state from reaching the next case. os.tmpdir() reads TMPDIR on POSIX and TEMP / TMP on
    // Windows, so all three are pointed at it.
    const tmpdir = fs.mkdtempSync(path.join(TMP, `tmp-${seq}-`));
    const sid = `sess-${seq}`;
    const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], {
        input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: sid, cwd: root, ...payload }),
        encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: root, TMPDIR: tmpdir, TEMP: tmpdir, TMP: tmpdir, ...env },
    });
    const flow = path.join(root, '.claude', 'docs', 'flow');
    const state = path.join(flow, 'COMPACT-STATE');
    const stamp = (name, minutesOld) =>
    {
        fs.mkdirSync(flow, { recursive: true });
        const f = path.join(flow, name);
        fs.writeFileSync(f, 'x\n');
        const t = new Date(Date.now() - minutesOld * 60000);
        fs.utimesSync(f, t, t);
    };
    const wrote = (actor, paths) => fs.writeFileSync(path.join(tmpdir, `docs-session-${sid}--${actor}.json`), JSON.stringify({ wrote: paths }));
    const transcript = (rows) =>
    {
        const p = path.join(root, 'transcript.jsonl');
        fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
        return p;
    };
    return { root, sid, tmpdir, run, flow, state, stamp, wrote, transcript };
}
const toolUse = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

test('compact-state: PreCompact writes the live plan, the flow stamps with ages and the files this session wrote', () =>
{
    const p = project();
    p.stamp('APPROVAL', 30);
    p.stamp('COMMIT-GATE', 2);
    p.stamp('monitor-sess.json', 1);   // the monitor's state is no stamp
    p.stamp('turn-edits-sess', 1);     // nor is the turn check's edit list
    p.wrote('main.session', ['scripts/a.js', 'stack/hooks/b.js']);
    p.wrote('agent-x', ['stack/hooks/b.js', 'docs/c.md']);
    const tp = p.transcript([
        toolUse('Read', { file_path: '/r/docs/superpowers/plans/2026-01-01-old.md' }),
        toolUse('Edit', { file_path: '/r/.claude/docs/superpowers/plans/2026-09-20-live.md', old_string: 'a', new_string: 'b' }),
        toolUse('Bash', { command: 'git status' }),
    ]);
    const r = p.run({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null, transcript_path: tp });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'PreCompact printed something');
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, new RegExp(`^session: ${p.sid}$`, 'm'));
    assert.match(text, /^trigger: auto$/m);
    assert.match(text, /^live plan: \/r\/\.claude\/docs\/superpowers\/plans\/2026-09-20-live\.md$/m);
    assert.match(text, /^ {2}APPROVAL - 30 min old$/m);
    assert.match(text, /^ {2}COMMIT-GATE - 2 min old$/m);
    assert.doesNotMatch(text, /monitor-sess/);
    assert.doesNotMatch(text, /turn-edits-/);
    assert.match(text, /^files written this session \(3\):$/m);
    for (const f of ['scripts/a.js', 'stack/hooks/b.js', 'docs/c.md']) assert.match(text, new RegExp(`^ {2}${f.replace(/\./g, '\\.')}$`, 'm'));
});

test('compact-state: with no plan in the transcript the newest plan under the docs root is taken, else none', () =>
{
    const p = project();
    const plans = path.join(p.root, '.claude', 'docs', 'superpowers', 'plans');
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(path.join(plans, 'a.md'), 'a');
    fs.writeFileSync(path.join(plans, 'b.md'), 'b');
    const old = new Date(Date.now() - 3600000);
    fs.utimesSync(path.join(plans, 'a.md'), old, old);
    p.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: p.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(p.state, 'utf8'), /^live plan: \.claude\/docs\/superpowers\/plans\/b\.md \(newest under the docs root\)$/m);

    const none = project();
    none.run({ hook_event_name: 'PreCompact', trigger: 'manual' });
    const text = fs.readFileSync(none.state, 'utf8');
    assert.match(text, /^live plan: none found$/m);
    assert.match(text, /^flow stamps: none$/m);
    assert.match(text, /^files written this session \(0\)/m);
});

test('compact-state: the file list is capped at 50 with the rest counted', () =>
{
    const p = project();
    p.wrote('main.session', Array.from({ length: 51 }, (_, i) => `f${i}.js`));
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' });
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, /^files written this session \(51\):$/m);
    assert.match(text, /^ {2}\.\.\. and 1 more$/m);
    assert.doesNotMatch(text, /^ {2}f50\.js$/m);
});

test('compact-state: garbage stdin, a garbage transcript and a garbage attribution file never block', () =>
{
    const p = project();
    assert.strictEqual(p.run('{nope').status, 0);
    fs.writeFileSync(path.join(p.root, 'bad.jsonl'), '{not json\n[1, 2\n');
    fs.mkdirSync(p.flow, { recursive: true });
    p.wrote('main.session', ['ok.js']);
    fs.writeFileSync(path.join(p.tmpdir, `docs-session-${p.sid}--broken.json`), '{nope');
    const r = p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: path.join(p.root, 'bad.jsonl') });
    assert.strictEqual(r.status, 0);
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, /^live plan: none found$/m);
    assert.match(text, /^files written this session \(1\):\n {2}ok\.js$/m, 'the readable actor was lost with the broken one');
});

test('compact-state: the compact injection points at the snapshot of THIS session only', () =>
{
    const p = project();
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' });
    const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    const mine = ctx(p.run({ hook_event_name: 'SessionStart', source: 'compact' }));
    assert.match(mine, /AUTO-COMPACTED/, 'the fresh-session ask is gone');
    assert.match(mine, /\.claude\/docs\/flow\/COMPACT-STATE/);
    const other = ctx(p.run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'someone-else' }));
    assert.doesNotMatch(other, /COMPACT-STATE/, 'another session was pointed at this snapshot');
});

test('compact-state: with every fresh-session offer off, the compact start still points at the snapshot - and says nothing else', () =>
{
    const p = project();
    const off = { ALFRED_CODE_FRESH_SESSION_200K: '0', ALFRED_CODE_FRESH_SESSION_1M: '0', ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' };
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' }, off);
    const r = p.run({ hook_event_name: 'SessionStart', source: 'compact' }, off);
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /COMPACT-STATE/);
    assert.doesNotMatch(text, /AUTO-COMPACTED/);
    // and with no snapshot, nothing at all, as before
    const q = project();
    assert.strictEqual(q.run({ hook_event_name: 'SessionStart', source: 'compact' }, off).stdout, '');
});

test('compact-state: ALFRED_CODE_HOOKS_OFF naming the hook writes nothing', () =>
{
    const p = project();
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' }, { ALFRED_CODE_HOOKS_OFF: 'guard-fresh-session-start' });
    assert.ok(!fs.existsSync(p.state));
});
