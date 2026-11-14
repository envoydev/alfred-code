'use strict';
// PreCompact capture (improvement plan 2.2): guard-fresh-session-start.js writes
// <docs-path>/flow/COMPACT-STATE before a compaction - the live plan file, the open flow stamps with
// their ages, the files this session wrote - with no model call, and the SessionStart `compact`
// injection points at it.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-fresh-session-start.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const BASE_ENV = { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-')) };
for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT', 'ALFRED_CODE_DOCS_ASK',
    'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K', 'ALFRED_CODE_AUTO_COMPACT'])
    delete BASE_ENV[k];
// The seeds an install writes (meta/environment.json): a tier left unset reads as ALFRED_CODE_CONTEXT_WINDOW_DEFAULT (the
// user's ruling of 2026-10-21). The engine the C08 cases require in-process reads them at load, so process.env carries them too.
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
Object.assign(BASE_ENV, WINDOW_SEEDS);
Object.assign(process.env, WINDOW_SEEDS);
delete process.env.ALFRED_CODE_AUTO_COMPACT;

let seq = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, `root-${seq++}-`));
    // docs-session keeps its attribution state in os.tmpdir(); a private temp dir per case keeps a
    // planted state from reaching the next case. os.tmpdir() reads TMPDIR on POSIX and TEMP / TMP on
    // Windows, so all three are pointed at it.
    const tmpdir = fs.mkdtempSync(path.join(TMP, `tmp-${seq}-`));
    const sid = `sess-${seq}`;
    const run = (payload, env = {}, hook = HOOK) => spawnSync(process.execPath, [hook], {
        input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: sid, cwd: root, ...payload }),
        encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: root, TMPDIR: tmpdir, TEMP: tmpdir, TMP: tmpdir, ...env },
    });
    // 2.8.0 layout: the snapshot and the compaction record live in <data root>/state/sessions/, the stamps in
    // state/approvals/; `flow` is the pre-2.8.0 folder a 2.7.0 hook wrote all three to
    const flow = path.join(root, '.alfred', 'docs', 'flow');
    const sessions = path.join(root, '.alfred', 'state', 'sessions');
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    const state = path.join(sessions, `COMPACT-STATE-${sid}`);
    const stamp = (name, minutesOld, dir = approvals) =>
    {
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, name);
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
    return { root, sid, tmpdir, run, flow, sessions, approvals, state, stamp, wrote, transcript };
}
const toolUse = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

test('compact-state: PreCompact writes the live plan, the flow stamps with ages and the files this session wrote', () =>
{
    const p = project();
    p.stamp('APPROVAL', 30);
    p.stamp('COMMIT-GATE', 2);
    // what the pre-2.8.0 flow/ held beside the receipts: the monitor's state is no stamp - its 2.1.5 turn log and context
    // marker neither - nor is the turn check's old edit list, or its Stop marker
    for (const f of ['monitor-sess.json', 'monitor-sess.jsonl', 'monitor-sess.context', 'turn-edits-sess', 'turn-check-sess']) p.stamp(f, 1, p.flow);
    p.wrote('main.session', ['scripts/a.js', 'stack/hooks/b.js']);
    p.wrote('agent-x', ['stack/hooks/b.js', 'docs/c.md']);
    const tp = p.transcript([
        toolUse('Read', { file_path: '/r/docs/superpowers/plans/2026-01-01-old.md' }),
        toolUse('Edit', { file_path: '/r/.alfred/docs/superpowers/plans/2026-09-20-live.md', old_string: 'a', new_string: 'b' }),
        toolUse('Bash', { command: 'git status' }),
    ]);
    const r = p.run({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null, transcript_path: tp });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'PreCompact printed something');
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, new RegExp(`^session: ${p.sid}$`, 'm'));
    assert.match(text, /^trigger: auto$/m);
    assert.match(text, /^live plan: \/r\/\.alfred\/docs\/superpowers\/plans\/2026-09-20-live\.md$/m);
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
    const plans = path.join(p.root, '.alfred', 'docs', 'plans');
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(path.join(plans, 'a.md'), 'a');
    fs.writeFileSync(path.join(plans, 'b.md'), 'b');
    const old = new Date(Date.now() - 3600000);
    fs.utimesSync(path.join(plans, 'a.md'), old, old);
    p.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: p.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(p.state, 'utf8'), /^live plan: \.alfred\/docs\/plans\/b\.md \(newest under the docs root\)$/m);

    // An install whose update has not moved the plans yet still reads them from the former superpowers/plans/.
    const former = project();
    const legacy = path.join(former.root, '.alfred', 'docs', 'superpowers', 'plans');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'c.md'), 'c');
    former.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: former.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(former.state, 'utf8'), /^live plan: \.alfred\/docs\/superpowers\/plans\/c\.md \(newest under the docs root\)$/m);

    // 2.8.0: plans live under work/plans/, read before the legacy plans/ an update has not moved yet.
    const work = project();
    for (const [sub, f] of [[['work', 'plans'], 'd.md'], [['plans'], 'e.md']]) {
        fs.mkdirSync(path.join(work.root, '.alfred', 'docs', ...sub), { recursive: true });
        fs.writeFileSync(path.join(work.root, '.alfred', 'docs', ...sub, f), f);
    }
    work.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: work.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(work.state, 'utf8'), /^live plan: \.alfred\/docs\/work\/plans\/d\.md \(newest under the docs root\)$/m);

    // PF1: a plan call names the live plan by its folder; with none in the transcript a folder plan newer than every flat
    // file is the newest, an older one leaves the flat pick
    const { planFolder: pf } = require('./plan-folder-fixture.js');
    const call = project();
    pf(call.root, 'csv');
    call.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: call.transcript([toolUse('Bash', { command: 'node .claude/hooks/plan-status.js start --plan csv --task 1' })]) });
    assert.match(fs.readFileSync(call.state, 'utf8'), /^live plan: \.alfred\/docs\/work\/plans\/csv\/$/m);
    const newer = project();
    const flat = path.join(newer.root, '.alfred', 'docs', 'work', 'plans', 'old.md');
    fs.mkdirSync(path.dirname(flat), { recursive: true });
    fs.writeFileSync(flat, 'old');
    const hour = new Date(Date.now() - 3600000);
    fs.utimesSync(flat, hour, hour);
    pf(newer.root, 'csv');
    newer.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: newer.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(newer.state, 'utf8'), /^live plan: \.alfred\/docs\/work\/plans\/csv\/ \(newest under the docs root\)$/m);
    const older = project();
    const folder = pf(older.root, 'csv');
    for (const f of [folder.md, path.join(folder.dir, 'status.json')]) fs.utimesSync(f, hour, hour);
    fs.writeFileSync(path.join(older.root, '.alfred', 'docs', 'work', 'plans', 'new.md'), 'new');
    older.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: older.transcript([toolUse('Bash', { command: 'ls' })]) });
    assert.match(fs.readFileSync(older.state, 'utf8'), /^live plan: \.alfred\/docs\/work\/plans\/new\.md \(newest under the docs root\)$/m);

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
    assert.match(mine, /\.alfred\/state\/sessions\/COMPACT-STATE/);
    const other = ctx(p.run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'someone-else' }));
    assert.doesNotMatch(other, /COMPACT-STATE/, 'another session was pointed at this snapshot');
});

test('compact-state: with every fresh-session offer off, the compact start still points at the snapshot - and says nothing else', () =>
{
    const p = project();
    const off = { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' };
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

// ---- audit 2026-10-10 C08 / C09 / C26: the active flow, the measured compaction point, the post-compaction hold ----
const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const usageRow = (id, usage, text = 'ok') => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', content: [{ type: 'text', text }], usage } });
const boundary = (trigger, preTokens) => ({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger, preTokens } });
const startText = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

test('compact-state: a slash flow is named with its body path, and the compact start says to read it again (6ed392a5)', () =>
{
    const p = project();
    const skill = path.join(p.root, '.claude', 'skills', 'task-solve');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: task-solve\n---\nbody\n');
    const tp = p.transcript([userRow('<command-name>/task-solve</command-name>'), usageRow('a1', { cache_read_input_tokens: 900 })]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, /^active flow: \/task-solve \(slash command - its body is not re-attached after a compaction\)$/m);
    assert.match(text, /^flow body: .*\/\.claude\/skills\/task-solve\/SKILL\.md$/m);
    const start = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }));
    assert.match(start, /\/task-solve, typed as a slash command, so its body was NOT carried through the compaction - Read .*SKILL\.md again/);
    // a Skill-tool run's body IS re-attached by the harness - named, never re-read
    const q = project();
    const tq = q.transcript([userRow('go'), toolUse('Skill', { skill: 'task-solve' })]);
    q.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tq });
    assert.match(fs.readFileSync(q.state, 'utf8'), /^active flow: \/task-solve \(Skill call/m);
    assert.doesNotMatch(startText(q.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tq })), /typed as a slash command/);
    // a marker quoted in a tool result is no run
    const r = project();
    const tr = r.transcript([{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '<command-name>/task-solve</command-name>' }] } }]);
    r.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tr });
    assert.match(fs.readFileSync(r.state, 'utf8'), /^active flow: none found$/m);
});

test('compact-state: a Windows plan path - backslashes, as Claude Code writes file_path there - is the live plan (gate, Windows leg)', () =>
{
    const p = project();
    const tp = p.transcript([toolUse('Edit', { file_path: 'C:\\r\\.alfred\\docs\\plans\\2026-10-11-live.md', old_string: 'a', new_string: 'b' })]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    assert.match(fs.readFileSync(p.state, 'utf8'), /^live plan: C:\\r\\\.alfred\\docs\\plans\\2026-10-11-live\.md$/m);
});

test('compact-state: an automatic compaction records its context, and the trigger is held under it (C08)', () =>
{
    const p = project();
    const fresh = require('../stack/hooks/fresh-session.js');
    // timed rows, as every real transcript's: a row with no time is an unknown gap, held for the settle pass (R133)
    const t = (ms) => new Date(Date.now() - ms).toISOString();
    const tp = p.transcript([{ ...usageRow('f', { cache_creation_input_tokens: 90000 }), timestamp: t(5000) }, { ...usageRow('a', { cache_read_input_tokens: 316849 }), timestamp: t(2000) }]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: tp });
    assert.ok(!fs.existsSync(path.join(p.sessions, 'compact-points.json')), 'a /compact the user typed is no ceiling reached');
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    fs.appendFileSync(tp, JSON.stringify({ ...boundary('auto', 317321), timestamp: t(0) }) + '\n');   // the harness writes the boundary after PreCompact
    p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp });
    const rows = JSON.parse(fs.readFileSync(path.join(p.sessions, 'compact-points.json'), 'utf8'));
    assert.deepStrictEqual(rows.map((r) => [r.model, r.tokens]), [['claude-opus-5-5', 316849], ['claude-opus-5-5', 317321]]);
    assert.doesNotMatch(fs.readFileSync(p.state, 'utf8'), /compact-points/, 'the record is no flow stamp');
    // the engine reads it: the 1M tier's 400k trigger is held at 90% of the lowest point, 285,164 (requires the model
    // row - claude-opus-5-5 is 1M in model-windows.json)
    const saved = { ...process.env };
    try
    {
        process.env.CLAUDE_PROJECT_DIR = p.root;
        process.env.CLAUDE_CONFIG_DIR = BASE_ENV.CLAUDE_CONFIG_DIR;
        delete process.env.ALFRED_CODE_CONTEXT_WINDOW_FOR_1M;
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
        delete process.env.CLAUDE_CODE_AUTOCOMPACT_WINDOW;
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 285164);
        fs.writeFileSync(path.join(p.sessions, 'compact-points.json'), JSON.stringify([{ at: new Date().toISOString(), model: 'claude-sonnet-5', tokens: 120000 }]));
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 400000, "another model's point is not this model's");
        fs.writeFileSync(path.join(p.sessions, 'compact-points.json'), '{not json');
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 400000, 'a garbage record reads as none');
        // the documented auto-compact window lowers the window it is judged in, never the tier: the tier is the model's own
        // window (1M), so its 400k trigger stands inside a 500k window, and inside the 400k one the installer seeds from that
        // same trigger it is held at 90% of it - never the DEFAULT 300k a lowered window used to pick (2026-10-14)
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '500000';
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 500000);
        assert.strictEqual(fresh.ctxThreshold(), 400000);
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '400000';
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 360000);
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
        const set = (file, json) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json)); };
        set(path.join(p.root, '.claude', 'settings.json'), { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 200000 } }, autoCompactWindow: 600000 });
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 200000, "a model's own entry wins over the file's top-level key");
        set(path.join(p.root, '.claude', 'settings.json'), { autoCompactWindow: 'auto' });
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 1000000, "'auto' is no window");
        // audit HK03: the USER file's top-level key is 'Scope: Any file' with no model limit (settings-reference) - it
        // lowers an Opus 5.5 window like any other file's
        set(path.join(BASE_ENV.CLAUDE_CONFIG_DIR, 'settings.json'), { autoCompactWindow: 500000 });
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 500000, "the USER file's top-level key reaches Opus 5.5");
        set(path.join(BASE_ENV.CLAUDE_CONFIG_DIR, 'settings.json'), {});
    }
    finally { process.env = saved; }
});

// Audit 2026-10-20 C10 (81ebfa5f, 1aebc759, b28289bf): a 350k window in settings.local.json had no effect - three sessions
// compacted at 466.8k-469.7k - while the asks quoted 350k. Once this project's own compactions show it, the key is no
// window, and the start hook says so once.
test('compact-state: a configured auto-compact window the compactions show was not honoured stops being quoted (audit 2026-10-20 C10)', () =>
{
    const fresh = require('../stack/hooks/fresh-session.js');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const local = (p, mtimeHoursAgo) => {
        const f = path.join(p.root, '.claude', 'settings.local.json');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 350000 } } }));
        const t = new Date(Date.now() - mtimeHoursAgo * 3600000);
        fs.utimesSync(f, t, t);
    };
    const rows = (startedH, pre) => [{ ...usageRow('f', { cache_creation_input_tokens: 80000 }), timestamp: ago(startedH) },
        { ...usageRow('a', { cache_read_input_tokens: pre - 300 }), timestamp: ago(0.1) }, { ...boundary('auto', pre), timestamp: ago(0.09) }];
    const engine = (p, tp, sid) => { fresh.use({ transcript_path: tp, cwd: p.root, session_id: sid }); return fresh; };
    const saved = { ...process.env };
    try
    {
        process.env.CLAUDE_CONFIG_DIR = BASE_ENV.CLAUDE_CONFIG_DIR;
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
        delete process.env.CLAUDE_CODE_AUTOCOMPACT_WINDOW;
        const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'acw-')) };
        // the key written 2h ago, a session started 1h ago compacts at 466.8k: not honoured
        const p = project();
        local(p, 2);
        const tp = p.transcript(rows(1, 466800));
        process.env.CLAUDE_PROJECT_DIR = p.root;
        assert.strictEqual(engine(p, tp, p.sid).autoCompactWindow(), 350000, 'before any compaction the key is the window');
        const start = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env));
        assert.match(start, /The 350k autoCompactWindow in \.claude\/settings\.local\.json was not honoured: this project compacted at ~467k/);
        assert.match(start, /`\/autocompact <value>` saves a window for this model in the user settings/);
        const point = JSON.parse(fs.readFileSync(path.join(p.sessions, 'compact-points.json'), 'utf8')).pop();
        assert.ok(Date.parse(point.started) <= Date.now() - 0.9 * 3600000, 'the point records when its session started');
        assert.strictEqual(engine(p, tp, p.sid).autoCompactWindow(), null, 'the key is no window now');
        assert.strictEqual(fresh.knownWindow(), 1000000, 'the model\'s own window stands');
        assert.doesNotMatch(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env)), /not honoured/, 'said once per session');
        // a NEW session of the same project reads the recorded point: its banner quotes no 350k window, and says why once
        const tp2 = path.join(p.root, 'second.jsonl');
        fs.writeFileSync(tp2, [{ ...usageRow('g', { cache_creation_input_tokens: 80000 }), timestamp: ago(0.2) }].map((r) => JSON.stringify(r)).join('\n') + '\n');
        const banner = () => p.run({ hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'task-solve', command_args: 'fix it',
            prompt: '/task-solve fix it', transcript_path: tp2, session_id: 'second' }, env).stdout;
        const first = banner();
        assert.match(first, /was not honoured: this project compacted at ~467k/);
        assert.doesNotMatch(first, /350k auto-compact window/, 'the banner never quotes the key as the window');
        assert.doesNotMatch(banner(), /not honoured/, 'once per session');
        // boundary: a compaction within 5% of the window is the window honoured
        const b = project();
        local(b, 2);
        const tb = b.transcript(rows(1, 367000));
        process.env.CLAUDE_PROJECT_DIR = b.root;
        assert.doesNotMatch(b.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tb }, env).stdout, /not honoured/);
        assert.strictEqual(engine(b, tb, b.sid).autoCompactWindow(), 350000, '367k under a 350k window is within the slack');
        // a key written AFTER the session started (mid-session) proves nothing about the key: Claude Code reads it at start
        const m = project();
        local(m, 0.5);
        const tm = m.transcript(rows(1, 466800));
        process.env.CLAUDE_PROJECT_DIR = m.root;
        assert.doesNotMatch(m.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tm }, env).stdout, /not honoured/);
        assert.strictEqual(engine(m, tm, m.sid).autoCompactWindow(), 350000);
        // audit 2026-10-20 (hooks minor list): a USER-scope file is named `~/`-relative with `/`, never its whole path
        const u = project();
        const home = fs.mkdtempSync(path.join(TMP, 'home-'));
        const userFile = path.join(home, '.claude', 'settings.json');
        fs.mkdirSync(path.dirname(userFile), { recursive: true });
        fs.writeFileSync(userFile, JSON.stringify({ autoCompactWindow: 350000 }));
        const two = new Date(Date.now() - 2 * 3600000);
        fs.utimesSync(userFile, two, two);
        const tu = u.transcript(rows(1, 466800));
        const userEnv = { ...env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'acw-u-')) };
        const said = startText(u.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tu }, userEnv));
        assert.match(said, /The 350k autoCompactWindow in ~\/\.claude\/settings\.json was not honoured/);
        assert.ok(!said.includes(home), 'the home folder\'s own name is never printed');
    }
    finally { process.env = saved; }
});

test('compact-state: the first change after an automatic compaction is held once, with both numbers (C09)', () =>
{
    const log = fs.mkdtempSync(path.join(TMP, 'hold-'));
    const env = { ALFRED_CODE_HOOK_LOG_DIR: log };
    const rows = [usageRow('f', { cache_creation_input_tokens: 40000 }), usageRow('a', { cache_read_input_tokens: 316000 }), boundary('auto', 317000),
        { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary ... Continue the conversation from where it left off without asking the user any further questions.' } }];
    const after = (tp, row) => fs.appendFileSync(tp, JSON.stringify(row) + '\n');
    const call = (p, tp, tool, extra = {}) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, transcript_path: tp, ...extra }, env).status;
    const p = project();
    const tp = p.transcript(rows);
    const started = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env));
    assert.match(started, /without asking the user any further questions' - that is the harness's default line, and this hook supersedes it/);
    assert.match(started, /when a fresh session would pay back with the cache warm/, 'the start states the cache-aware verdict');
    assert.doesNotMatch(started, /recover a real share/, 'and no longer the 40% rule');
    // audit 2026-10-20 C12, add5a91e: before any post-compaction reading, a shell call that writes nothing passes
    assert.strictEqual(call(p, tp, 'Bash', { tool_input: { command: 'cat .alfred/docs/flow/COMPACT-STATE' } }), 0, 'a reading shell call passes');
    after(tp, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(p, tp, 'Read'), 0, 'a read is never held');
    assert.strictEqual(call(p, tp, 'Edit', { agent_id: 'seat-1' }), 0, "a seat's call is the parent's work in flight");
    const held = p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: tp }, env);
    assert.strictEqual(held.status, 2, 'the first edit is held');
    assert.match(held.stderr, /~120k tokens per message/, 'the measured post-compaction carry');
    assert.match(held.stderr, /A fresh session restarts at ~40k, written new at 1\.25x/, 'and the cold floor, priced');
    assert.strictEqual(call(p, tp, 'Bash'), 2, 'still held - no ask yet');
    assert.strictEqual(call(p, tp, 'Edit'), 0, 'two denials, then it gives way - never a loop');
    const q = project();
    const tq = q.transcript(rows);
    q.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tq }, env);
    after(tq, usageRow('b', { cache_read_input_tokens: 120000 }));
    after(tq, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q', content: 'Your questions have been answered: "Fresh?"="Continue here"' }] } });
    assert.strictEqual(call(q, tq, 'Write'), 0, 'an answered ask releases it');
    const s = project();
    const ts = s.transcript(rows);
    s.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: ts }, env);
    after(ts, usageRow('b', { cache_read_input_tokens: 120000 }, 'Single short step: rename the one test.'));
    assert.strictEqual(call(s, ts, 'Edit'), 0, 'the stated exemption releases it');
    const w = project();
    const tw = w.transcript([usageRow('f', { cache_creation_input_tokens: 90000 }), boundary('auto', 317000)]);
    w.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tw }, env);
    after(tw, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(w, tw, 'Edit'), 0, 'a carry mostly the cold floor (758ce661: 120k over 90k) is no hold');
    const m = project();
    const tm = m.transcript([usageRow('f', { cache_creation_input_tokens: 40000 }), boundary('manual', 200000)]);
    m.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tm }, env);
    after(tm, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(m, tm, 'Edit'), 0, 'a /compact the user typed is no hold');
    const a = project();
    // audit 2026-10-30 HK-03: a hand-written waiver counts where the user typed its words
    const ta = a.transcript([{ type: 'user', message: { role: 'user', content: 'run it overnight' } }, ...rows]);
    fs.mkdirSync(a.flow, { recursive: true });
    fs.writeFileSync(path.join(a.flow, 'APPROVAL'), 'AUTO - "run it overnight"\n');
    a.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: ta }, env);
    after(ta, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(a, ta, 'Edit'), 0, 'a live AUTO waiver holds nothing');
});

// AC-6 (session be3a0031): after 9.8h idle the hold asked for a fresh session while its own quoted payback was ~26
// messages for a task of ~3. Beside 'a single short step', the hold names a second exit - work shorter than the payback
// it quotes - in every text it prints, and the line releases a hold when its count is under the quoted payback.
test('compact-state: every hold text names the fewer-than-payback exit, and its line releases a hold it beats (AC-6)', () =>
{
    const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'payback-')) };
    const rows = [usageRow('f', { cache_creation_input_tokens: 40000 }), usageRow('a', { cache_read_input_tokens: 316000 }), boundary('auto', 317000)];
    const EXIT = /or fewer messages than the payback, say so in one line [-(] ?'single short step: <what>' or 'fewer messages than the payback: <what>, ~N messages'/;
    const after = (tp, text) => fs.appendFileSync(tp, JSON.stringify(usageRow('c', { cache_read_input_tokens: 120000 }, text)) + '\n');
    const edit = (s) => s.p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: s.tp }, env);
    const armed = () =>
    {
        const p = project();
        const tp = p.transcript(rows);
        const started = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env));
        fs.appendFileSync(tp, JSON.stringify(usageRow('b', { cache_read_input_tokens: 120000 })) + '\n');
        return { p, tp, started };
    };
    const a = armed();
    assert.match(a.started.replace(/\s+/g, ' '), EXIT, 'the compact start names both exits');
    const held = edit(a);
    assert.strictEqual(held.status, 2);
    assert.match(held.stderr.replace(/\s+/g, ' '), EXIT, 'the compaction hold names both exits');
    const n = Number((/pays back in about (\d+) messages/.exec(held.stderr) || [])[1]);
    assert.ok(n > 2, held.stderr);
    after(a.tp, `fewer messages than the payback: rename the test, ~${n} messages`);
    assert.strictEqual(edit(a).status, 2, 'a count at the quoted payback is no exit');
    const b = armed();
    assert.strictEqual(edit(b).status, 2);
    after(b.tp, `Fewer messages than the payback: rename the one test, ~${n - 1} messages.`);
    assert.strictEqual(edit(b).status, 0, 'a count under the quoted payback releases the hold');
    const ledger = fs.readFileSync(path.join(b.p.root, '.alfred', 'statistics', 'hook-blocks', `${b.p.sid}.jsonl`), 'utf8');
    assert.match(ledger, /"kind":"compact-hold"[^\n]*"outcome":"fewer-than-payback"/, 'its own release row');
    const c = armed();
    after(c.tp, 'fewer messages than the payback: fix the typo, ~2 messages');
    assert.strictEqual(edit(c).status, 0, 'said before any hold quoted a payback, the line form is taken as the single-short-step line is');
    const d = armed();
    assert.strictEqual(edit(d).status, 2);
    after(d.tp, 'fewer messages than the payback: rename the test');
    assert.strictEqual(edit(d).status, 2, 'a line naming no count is no exit');
});

test('compact-state: the hold reaches an edit and a shell call through their one-process dispatchers (C09, 7fae0c39 / 84eedb4b)', () =>
{
    // The measured sessions went on with Bash and Edit after the compaction; both tools carry only their dispatcher
    // (2.1.5 M3), which runs the hook in-process from the manifest's folded rows.
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'hold-via-')) };
    const rows = [usageRow('f', { cache_creation_input_tokens: 40000 }), usageRow('a', { cache_read_input_tokens: 316000 }), boundary('auto', 317000)];
    const p = project();
    const tp = p.transcript(rows);
    const via = (hook, tool, input) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp }, env, hook);
    assert.strictEqual(via(SHELL, 'Bash', { command: 'ls' }).status, 0, 'no hold pending: the dispatcher passes');
    assert.strictEqual(via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' }).status, 0);
    p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env);
    fs.appendFileSync(tp, JSON.stringify(usageRow('b', { cache_read_input_tokens: 120000 })) + '\n');
    assert.strictEqual(via(FILES, 'Read', { file_path: path.join(p.root, 'a.txt') }).status, 0, 'a read is never held');
    // audit 2026-10-20 C12, add5a91e: a shell call that writes nothing is the reading the ask needs - it passes
    assert.strictEqual(via(SHELL, 'Bash', { command: 'cat .alfred/docs/flow/COMPACT-STATE; grep -rlE "x" src' }).status, 0, 'a reading shell call is never held');
    const shell = via(SHELL, 'Bash', { command: 'echo x > a.txt' });
    assert.strictEqual(shell.status, 2, 'the first changing shell call after the compaction is held');
    assert.match(shell.stderr, /Held once: this session AUTO-COMPACTED/);
    assert.match(shell.stderr, /~120k tokens per message/);
    const edit = via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' });
    assert.strictEqual(edit.status, 2, 'an edit is held through the file dispatcher');
    assert.match(edit.stderr, /Held once/);
    assert.strictEqual(via(SHELL, 'Bash', { command: 'echo y > a.txt' }).status, 0, 'two denials, then it gives way - the cap is shared by both routes');
});

test('compact-state: the prompt ending an idle gap past the clock hours is offered a fresh session once (C09, ca65b406)', () =>
{
    const log = fs.mkdtempSync(path.join(TMP, 'idle-'));
    const env = { ALFRED_CODE_HOOK_LOG_DIR: log };
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const at = (row, h) => ({ ...row, timestamp: ago(h) });
    // ca65b406: 19h02m idle, then a prompt at 289.9k over a 77.6k floor
    const rows = (h, carry = 289900) => [at(usageRow('f', { cache_creation_input_tokens: 77600 }), h + 1), at(usageRow('l', { cache_read_input_tokens: carry }), h)];
    const prompt = (p, tp, extra = {}, more = {}) => p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next card', transcript_path: tp, ...extra }, { ...env, ...more });
    const p = project();
    const tp = p.transcript(rows(19));
    const r = prompt(p, tp);
    assert.strictEqual(r.status, 0);
    const text = startText(r);
    assert.match(text, /sat idle 19\.0h since its last reply/);
    assert.match(text, /This session carries ~290k tokens per message/);
    assert.match(text, /A fresh session restarts at ~78k, written new at 1\.25x/);
    assert.match(text, /this message has already re-written the context, so the choice is priced as from now/);
    assert.match(text, /Resume in a fresh session \(Recommended\)/);
    assert.strictEqual(prompt(p, tp).stdout, '', 'once per gap - the next prompt of the same gap is not offered again');
    const ledger = fs.readdirSync(log, { recursive: true }).filter((f) => String(f).endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(log, String(f)), 'utf8')).join('')
        + (fs.existsSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks')) ? fs.readdirSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks')).map((f) => fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', f), 'utf8')).join('') : '');
    assert.match(ledger, /"kind":"idle-gap-offer"/, 'one probe row records it');
    // an explicit hour count overrides the cache life (usage audit 2026-11-03 U16); these rows wrote no split
    const q = project();
    assert.strictEqual(prompt(q, q.transcript(rows(1.9)), {}, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }).stdout, '', 'under an explicit 2h: no offer');
    assert.match(prompt(q, q.transcript(rows(2.1)), {}, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }).stdout, /sat idle 2\.1h/, 'over it: the offer');
    const off = project();
    assert.strictEqual(prompt(off, off.transcript(rows(19)), {}, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).stdout, '', '0 switches the route off');
    const w = project();
    assert.strictEqual(prompt(w, w.transcript(rows(19, 100000))).stdout, '', 'a carry mostly the cold floor is no offer');
    // the mode block's auto-compact (/alfred-code:mode:auto-compact on writes it into the checkout's settings.local.json
    // since 3.11.0, the per-session switch file gone): no fresh-session ask is made
    const sw = project();
    const modeFile = path.join(sw.root, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(modeFile), { recursive: true });
    fs.writeFileSync(modeFile, `${JSON.stringify({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }, null, 2)}\n`);
    assert.strictEqual(prompt(sw, sw.transcript(rows(19))).stdout, '', 'auto-compact on: no idle-gap offer');
    fs.writeFileSync(modeFile, `${JSON.stringify({ env: { ALFRED_CODE_AUTO_COMPACT: '0' } }, null, 2)}\n`);
    assert.match(prompt(sw, sw.transcript(rows(19))).stdout, /sat idle 19\.0h/, 'switched off again: the offer is back');
    const n = project();
    assert.strictEqual(prompt(n, n.transcript(rows(19)), { prompt: '<task-notification><task-id>b1</task-id></task-notification>' }).stdout, '', 'a harness notice is no return');
    const s = project();
    assert.strictEqual(prompt(s, s.transcript(rows(19)), { agent_id: 'seat-1' }).stdout, '', 'a seat has no user');
    const c = project();
    assert.strictEqual(prompt(c, c.transcript([...rows(19), boundary('auto', 300000)])).stdout, '', 'the context past a compaction is unknown');
    const u = project();
    assert.strictEqual(prompt(u, u.transcript(rows(19)), {}, { ALFRED_CODE_UNATTENDED: '1' }).stdout, '', 'nobody at the terminal: no offer');
    assert.strictEqual(project().run('garbage', env).status, 0, 'garbage stdin never blocks');
});

// Audit 2026-10-11 SD11: the injection was spent on the first prompt after the gap even when that prompt was a question
// answered from context, and the work prompt minutes later went unasked (fdce35ae: 98 messages at 238.6k-412.6k;
// 2ca8e8ee: 47 at 342k-390k). The gap leaves the compaction route's hold, marked idle: reads pass, the first change is held.
test('compact-state: the idle gap leaves a hold the first change meets, released as the compaction hold is (audit 2026-10-11 SD11)', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'idle-hold-')) };
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const rows = (carry = 289900) => [{ ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(20) }, { ...usageRow('l', { cache_read_input_tokens: carry }), timestamp: ago(19) }];
    const setup = (more = {}, carry) => {
        const p = project();
        const tp = p.transcript(rows(carry));
        const offer = p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'is the export done?', transcript_path: tp }, { ...env, ...more });
        const via = (hook, tool, input) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp }, { ...env, ...more }, hook);
        return { p, tp, offer, via, edit: () => via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' }) };
    };
    const s = setup();
    assert.match(startText(s.offer), /sat idle 19\.0h/, 'the injection still goes out');
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'git status --short; git log --oneline -3 2>/dev/null' }).status, 0, 'a reading shell call answers a question unheld');
    assert.strictEqual(s.via(FILES, 'Read', { file_path: path.join(s.p.root, 'a.txt') }).status, 0, 'a read is never held');
    assert.strictEqual(s.p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'ok, go ahead and fix it', transcript_path: s.tp }, env).stdout, '', 'the work prompt is not injected again');
    const held = s.edit();
    assert.strictEqual(held.status, 2, 'fdce35ae: the work prompt\'s first change is held');
    assert.match(held.stderr.replace(/\s+/g, ' '), /sat idle 19(?:\.0)?h before this turn and its prompt cache went cold; the turns since have re-written it, so the choice is priced as from now/);
    assert.match(held.stderr, /~290k tokens per message/);
    assert.match(held.stderr, /A fresh session restarts at ~78k, written new at 1\.25x/);
    assert.match(held.stderr.replace(/\s+/g, ' '), /or fewer messages than the payback, say so in one line - 'single short step: <what>' or 'fewer messages than the payback: <what>, ~N messages' - and retry/, 'AC-6: the idle hold names both exits');
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'echo x > a.txt' }).status, 2, 'a writing shell call is a change');
    assert.strictEqual(s.edit().status, 0, 'two denials, then it gives way');
    const a = setup();
    fs.appendFileSync(a.tp, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Your questions have been answered: "Fresh?"="Continue here"' }] } }) + '\n');
    assert.strictEqual(a.edit().status, 0, 'an ask answered after the gap releases it');
    const t = setup();
    fs.appendFileSync(t.tp, JSON.stringify({ type: 'assistant', message: { id: 'z', content: [{ type: 'text', text: 'single short step: fix the typo' }] } }) + '\n');
    assert.strictEqual(t.edit().status, 0, 'the single-short-step line releases it');
    assert.strictEqual(setup({ ALFRED_CODE_UNATTENDED: '1' }).edit().status, 0, 'nobody at the terminal: no hold');
    assert.strictEqual(setup({}, 100000).edit().status, 0, 'a carry mostly the cold floor: no offer, no hold');
    assert.strictEqual(setup({ ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).edit().status, 0, 'the route off: no hold');
    const c = project();
    const tc = c.transcript([...rows(), boundary('auto', 300000)]);
    c.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tc }, env);
    fs.appendFileSync(tc, JSON.stringify({ ...usageRow('b', { cache_read_input_tokens: 300000 }), timestamp: ago(19) }) + '\n');
    c.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next', transcript_path: tc }, env);
    assert.match(c.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(c.root, 'a.txt') }, transcript_path: tc }, env, FILES).stderr,
        /AUTO-COMPACTED/, 'a compaction hold already standing is kept');
});

// Audit 2026-10-20 C49, 8a1fb350: an ask posted at 01:09 and answered at 05:57 never reached the idle-gap offer - no
// typed prompt ended the gap - and 52 messages ran at 198-244k after the cache went cold. The answer arms the idle hold.
test('compact-state: an ask answered after a long gap leaves the idle hold for the first change (audit 2026-10-20 C49)', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const rows = (gapH, carry = 289900) => [
        { ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(gapH + 1) },
        { type: 'assistant', timestamp: ago(gapH), message: { id: 'q', model: 'claude-opus-5-5', usage: { cache_read_input_tokens: carry },
            content: [{ type: 'tool_use', id: 'toolu_ask1', name: 'AskUserQuestion', input: { questions: [{ question: 'Push now?' }] } }] } },
        { type: 'user', timestamp: ago(0.01), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask1',
            content: 'Your questions have been answered: "Push now?"="Push (Recommended)"' }] } },
    ];
    const setup = (gapH, more = {}, carry) => {
        const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'askgap-')), ...more };
        const p = project();
        const tp = p.transcript(rows(gapH, carry));
        const via = (hook, tool, input) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp }, env, hook);
        return { p, tp, via, edit: () => via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' }) };
    };
    const s = setup(4.8);
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'git status --short' }).status, 0, 'a reading shell call passes - the hold stands');
    const held = s.via(SHELL, 'Bash', { command: 'git push origin develop' });
    assert.strictEqual(held.status, 2, 'the first change after the answer is held');
    assert.match(held.stderr.replace(/\s+/g, ' '), /last ask waited 4\.8h for its answer and its prompt cache went cold; the turns since have re-written it, so the choice is priced as from now/);
    assert.match(held.stderr, /~290k tokens per message/);
    assert.match(held.stderr, /A fresh session restarts at ~78k, written new at 1\.25x/);
    const ledger = fs.readFileSync(path.join(s.p.root, '.alfred', 'statistics', 'hook-blocks', `${s.p.sid}.jsonl`), 'utf8');
    assert.match(ledger, /"kind":"idle-gap-offer"[^\n]*"via":"ask-answer"/, 'one probe row says where it came from');
    fs.appendFileSync(s.tp, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'f2',
        content: 'Your questions have been answered: "Fresh?"="Continue here"' }] } }) + '\n');
    assert.strictEqual(s.edit().status, 0, 'the fresh-session ask answered releases it');
    assert.strictEqual(s.edit().status, 0, 'and the same long ask never arms it twice');
    assert.strictEqual(setup(1.9, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }).edit().status, 0, 'under an explicit 2h: no hold');
    assert.strictEqual(setup(2.1, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }).edit().status, 2, 'over it: held');
    assert.strictEqual(setup(4.8, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).edit().status, 0, '0 switches it off');
    assert.strictEqual(setup(4.8, { ALFRED_CODE_UNATTENDED: '1' }).edit().status, 0, 'nobody at the terminal: no hold');
    assert.strictEqual(setup(4.8, {}, 100000).edit().status, 0, 'a carry mostly the cold floor: no hold');
    const seat = setup(4.8);
    assert.strictEqual(seat.p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: seat.tp, agent_id: 'seat-1' },
        { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'askgap-')) }).status, 0, 'a seat is never held');
});

// Usage audit 2026-11-03 U15-1: the user answered the long-gap ask, then typed a new prompt - they are back, and the prompt
// route judges that prompt's own gap - yet the ask's hold still denied the first change after it.
test('U15-1: a typed prompt after the gap answer releases the idle hold', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const rows = [
        { ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(5.8) },
        { type: 'assistant', timestamp: ago(4.8), message: { id: 'q', model: 'claude-opus-5-5', usage: { cache_read_input_tokens: 289900 },
            content: [{ type: 'tool_use', id: 'toolu_ask9', name: 'AskUserQuestion', input: { questions: [{ question: 'Push now?' }] } }] } },
        { type: 'user', timestamp: ago(0.01), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask9',
            content: 'Your questions have been answered: "Push now?"="Push (Recommended)"' }] } },
    ];
    const setup = () => {
        const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'askgap-typed-')) };
        const p = project();
        const tp = p.transcript(rows);
        const via = (hook, tool, input) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp }, env, hook);
        const user = (content) => fs.appendFileSync(tp, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content } }) + '\n');
        return { p, tp, via, user, edit: () => via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' }) };
    };
    const s = setup();
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'git status --short' }).status, 0, 'a reading call arms the hold and passes');
    s.user('go on and push it');
    assert.strictEqual(s.edit().status, 0, 'the typed prompt released it');
    const ledger = fs.readFileSync(path.join(s.p.root, '.alfred', 'statistics', 'hook-blocks', `${s.p.sid}.jsonl`), 'utf8');
    assert.match(ledger, /"kind":"idle-hold"[^\n]*"outcome":"typed-after-answer"/, 'one release row names why');
    const n = setup();
    assert.strictEqual(n.via(SHELL, 'Bash', { command: 'git status --short' }).status, 0);
    n.user('<task-notification><task-id>b1</task-id><status>completed</status></task-notification>');
    n.user([{ type: 'text', text: 'Stop hook feedback: held' }]);
    assert.strictEqual(n.edit().status, 2, 'a harness notice or a Stop hook feedback row is no typed prompt: still held');
    const b = setup();
    b.user('push it now');
    assert.strictEqual(b.edit().status, 0, 'typed before the first call after the answer: the arm and the release in one call');
});

// Usage audit 2026-11-03 U16: the idle offer waited the knob's seeded 2h, past the cache life on every route - a
// subscription's main conversation caches for 1h, an API key's for 5m (code.claude.com/docs/en/prompt-caching) - so the
// gap's first message had paid the cold re-write long before anyone was asked. The wait now follows the cache life the
// last main-conversation reply wrote; no split is the fallback, one hour; an explicit hour count still overrides.
test('compact-state: the idle wait follows the cache life the last reply wrote (usage audit 2026-11-03 U16)', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
    const life = (ttl, carry = 289900) => ({ cache_read_input_tokens: carry, cache_creation_input_tokens: 400,
        ...(ttl ? { cache_creation: { ephemeral_1h_input_tokens: ttl === '1h' ? 400 : 0, ephemeral_5m_input_tokens: ttl === '5m' ? 400 : 0 } } : {}) });
    const reply = (gapMin, ttl, extra = []) => [{ ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(gapMin + 30) },
        { ...usageRow('l', life(ttl)), timestamp: ago(gapMin) }, ...extra];
    const offered = (rows, more = {}) =>
    {
        const p = project();
        const r = p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next card', transcript_path: p.transcript(rows) },
            { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'wait-')), ...more });
        assert.strictEqual(r.status, 0, r.stderr);
        return r.stdout ? startText(r) : '';
    };
    assert.strictEqual(offered(reply(4, '5m')), '', '5m cache, 4 minutes idle: still warm, no offer');
    assert.match(offered(reply(6, '5m')), /sat idle 6 min since its last reply/, '5m cache, 6 minutes idle: the offer');
    assert.strictEqual(offered(reply(59, '1h')), '', '1h cache, 59 minutes: no offer');
    assert.match(offered(reply(61, '1h')), /sat idle 1\.0h since its last reply/, '1h cache, 61 minutes: the offer');
    assert.strictEqual(offered(reply(54, null)), '', 'no split: the one-hour fallback - 54 minutes, no offer');
    assert.match(offered(reply(66, null)), /sat idle 1\.1h/, 'no split: 66 minutes, the offer');
    const zero = [{ ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(90) },
        { ...usageRow('l', { cache_read_input_tokens: 289900, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }), timestamp: ago(30) }];
    assert.strictEqual(offered(zero), '', 'both splits zero: the fallback - 30 minutes, no offer');
    assert.strictEqual(offered(reply(114, '5m'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }), '', 'an explicit 2 overrides a 5m cache: 1.9h, no offer');
    assert.match(offered(reply(126, '5m'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }), /sat idle 2\.1h/, 'and 2.1h offers');
    assert.strictEqual(offered(reply(600, '1h'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }), '', '0 is still off');
    assert.match(offered(reply(6, '5m'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: 'garbage' }), /sat idle 6 min/, 'a garbage value follows the cache');
    assert.match(offered(reply(6, '5m'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: 'cache' }), /sat idle 6 min/, 'the seed word follows it too');
    // a seat's row in the main transcript is no main-conversation reply: its 1-minute-old row neither resets the gap
    // nor sets the life
    const seatRow = { ...usageRow('s', life('1h')), isSidechain: true, timestamp: ago(1) };
    assert.match(offered(reply(6, '5m', [seatRow])), /sat idle 6 min/, 'a sidechain row is skipped');
    // garbage lines among the rows are skipped, never thrown on
    const p = project();
    const tp = path.join(p.root, 'transcript.jsonl');
    fs.writeFileSync(tp, ['{"cut', JSON.stringify(reply(6, '5m')[0]), 'not json', JSON.stringify(reply(6, '5m')[1]), '[1,2]', 'null'].join('\n') + '\n');
    const g = p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next card', transcript_path: tp }, { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'wait-')) });
    assert.match(startText(g), /sat idle 6 min/, 'garbage lines are skipped');
    const ledger = fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8');
    assert.match(ledger, /"kind":"idle-gap-offer"[^\n]*"wait":"cache"[^\n]*"waitMin":5/, 'the probe row says which wait it took');

    // the ask-gap arm waits the life the ask's own reply wrote
    const askRows = (gapMin, ttl) => [
        { ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(gapMin + 60) },
        { type: 'assistant', timestamp: ago(gapMin + 1), message: { id: 'q', model: 'claude-opus-5-5', usage: life(ttl),
            content: [{ type: 'tool_use', id: 'toolu_ask1', name: 'AskUserQuestion', input: { questions: [{ question: 'Push now?' }] } }] } },
        { type: 'user', timestamp: ago(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask1',
            content: 'Your questions have been answered: "Push now?"="Push (Recommended)"' }] } },
    ];
    const edit = (rows, more = {}) =>
    {
        const q = project();
        const tq = q.transcript(rows);
        return q.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(q.root, 'a.txt'), old_string: 'a', new_string: 'b' }, transcript_path: tq },
            { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'wait-ask-')), ...more }, FILES);
    };
    assert.strictEqual(edit(askRows(4, '5m')).status, 0, 'a 5m ask answered in 4 minutes: no hold');
    const held = edit(askRows(6, '5m'));
    assert.strictEqual(held.status, 2, 'answered in 6 minutes: held');
    assert.match(held.stderr.replace(/\s+/g, ' '), /last ask waited 6 min for its answer/);
    assert.strictEqual(edit(askRows(59, '1h')).status, 0, 'a 1h ask answered in 59 minutes: no hold');
    assert.strictEqual(edit(askRows(61, '1h')).status, 2, 'in 61 minutes: held');
    assert.strictEqual(edit(askRows(54, null)).status, 0, 'no split: the one-hour fallback');
    assert.strictEqual(edit(askRows(66, null)).status, 2, 'past it: held');
    assert.strictEqual(edit(askRows(6, '5m'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '2' }).status, 0, 'an explicit 2 overrides the cache');
    assert.strictEqual(edit(askRows(600, '1h'), { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).status, 0, '0 is off');
    // Claude Code's idle compaction (the one-hour cache only) between the ask and its answer: the context past it is unknown, no hold
    const compacted = askRows(66, '1h');
    compacted.splice(2, 0, { ...boundary('auto', 290000), timestamp: ago(5) });
    assert.strictEqual(edit(compacted).status, 0, 'an idle compaction inside the gap leaves no hold');
});

// Review fix pass, run B (M4): since U16 the idle wait follows the cache - 5 minutes on an API key - and the two idle
// routes kept no decline. A fresh-session ask answered 'Continue here' past the wait read as a NEW slow ask: the next
// changing call armed the hold again and was denied at once, and the next prompt past the wait offered again, at the
// carry the user had just declined. Now a fresh-session ask never arms the ask route, and both idle routes wait for the
// carry to grow REOFFER_GROWTH (1.5x) past the newest answered fresh-session ask, as the Stop and tick routes do.
test('compact-state: a declined fresh-session ask is not re-offered by the idle routes until the carry grows 1.5x (review fix M4)', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
    const life5m = (carry) => ({ cache_read_input_tokens: carry, cache_creation_input_tokens: 400,
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 400 } });
    const floorRow = () => ({ ...usageRow('f', { cache_creation_input_tokens: 77600 }), timestamp: ago(240) });
    const reply = (id, carry, min) => ({ ...usageRow(id, life5m(carry)), timestamp: ago(min) });
    const FRESH = { questions: [{ question: 'This session carries ~290k tokens per message. Resume in a fresh session, or continue here?', header: 'Session',
        multiSelect: false, options: [{ label: 'Resume in a fresh session (Recommended)', description: 'restarts at ~78k' }, { label: 'Continue here', description: 'keeps the carry' }] }] };
    const PUSH = { questions: [{ question: 'Push now?', header: 'Push', multiSelect: false, options: [{ label: 'Push (Recommended)', description: 'x' }, { label: 'Hold', description: 'y' }] }] };
    const ask = (id, input, carry, min) => ({ type: 'assistant', timestamp: ago(min), message: { id: `m-${id}`, model: 'claude-opus-5-5', usage: life5m(carry),
        content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input }] } });
    const answer = (id, pick, min) => ({ type: 'user', timestamp: ago(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
        content: `Your questions have been answered: ${pick}` }] } });
    const declined = (carry = 290000) => [floorRow(), reply('r0', carry - 1000, 40), ask('toolu_fresh1', FRESH, carry, 30), answer('toolu_fresh1', '"Resume?"="Continue here"', 23)];
    const world = (rows, more = {}) =>
    {
        const p = project();
        const tp = p.transcript(rows);
        const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'decline-')), ...more };
        const via = (hook, tool, input) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp }, env, hook);
        const edit = () => via(FILES, 'Edit', { file_path: path.join(p.root, 'a.txt'), old_string: 'a', new_string: 'b' });
        const prompt = () => { const r = p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next card', transcript_path: tp }, env); assert.strictEqual(r.status, 0, r.stderr); return r.stdout ? startText(r) : ''; };
        const add = (...more) => fs.appendFileSync(tp, more.map((r) => JSON.stringify(r)).join('\n') + '\n');
        const ledger = () => { try { return fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8'); } catch { return ''; } };
        return { p, tp, env, via, edit, prompt, add, ledger, hold: holdOf({ tmpdir: env.ALFRED_CODE_HOOK_LOG_DIR }, tp) };
    };

    // THE DECLINE LOOP: the fresh-session ask, answered 'Continue here' 7 minutes on (past the 5-minute wait), is no new
    // slow ask - the next change goes through and no hold is left.
    const d = world(declined());
    assert.strictEqual(d.edit().status, 0, 'the change after a slow decline is not held');
    assert.ok(!fs.existsSync(d.hold), 'no hold was armed');
    assert.strictEqual(d.edit().status, 0, 'nor on the call after it');
    assert.doesNotMatch(d.ledger(), /"kind":"idle-gap-offer"/, 'no ask-route offer row');
    // the next prompt past the 5-minute wait, at about the carry just declined: no offer
    d.add(reply('r1', 291000, 7));
    assert.strictEqual(d.prompt(), '', 'a 7-minute gap at the declined carry is not offered again');
    // the same gap with no decline before it IS offered - the 5-minute cache's own wait, unchanged
    const plain = world([floorRow(), reply('r1', 291000, 7)]);
    assert.match(plain.prompt(), /sat idle 7 min since its last reply/, 'no decline: the 5-minute wait offers');

    // The reviewer's chain: a slow ordinary ask arms the hold, the model puts the fresh-session choice, the user takes
    // longer than the wait to decline it - the change after it passes, and every call after that too.
    const c = world([floorRow(), reply('r0', 289000, 40), ask('toolu_push', PUSH, 290000, 30), answer('toolu_push', '"Push now?"="Push (Recommended)"', 23)]);
    assert.strictEqual(c.edit().status, 2, 'the slow ordinary ask holds the first change');
    c.add(ask('toolu_fresh1', FRESH, 290500, 22), answer('toolu_fresh1', '"Resume?"="Continue here"', 15));
    assert.strictEqual(c.edit().status, 0, 'the declined choice releases it');
    assert.strictEqual(c.edit().status, 0, 'and no new hold comes from the slow decline');
    assert.strictEqual(c.via(SHELL, 'Bash', { command: 'echo y > b.txt' }).status, 0, 'a writing shell call passes too');
    assert.ok(!fs.existsSync(c.hold), 'no hold left standing');

    // GROWTH: a later slow ordinary ask under 1.5x the declined carry arms nothing; past it, one hold.
    const under = world([...declined(), reply('r1', 400000, 12), ask('toolu_push', PUSH, 420000, 10), answer('toolu_push', '"Push now?"="Hold"', 3)]);
    assert.strictEqual(under.edit().status, 0, '420k is under 1.5x the 290k declined: no hold');
    assert.doesNotMatch(under.ledger(), /"kind":"idle-gap-offer"/);
    const over = world([...declined(), reply('r1', 430000, 12), ask('toolu_push', PUSH, 440000, 10), answer('toolu_push', '"Push now?"="Hold"', 3)]);
    const held = over.edit();
    assert.strictEqual(held.status, 2, '440k is past 1.5x the 290k declined: held');
    assert.match(held.stderr.replace(/\s+/g, ' '), /last ask waited 7 min for its answer/);
    assert.match(over.ledger(), /"kind":"idle-gap-offer"[^\n]*"via":"ask-answer"/, 'one offer row');
    over.add(answer('toolu_x', '"Fresh?"="Continue here"', 1));
    assert.strictEqual(over.edit().status, 0, 'an answer releases it');
    assert.strictEqual(over.edit().status, 0, 'and the same ask never arms it twice');
    // the exact step: each usage row carries 400 written tokens beside its read, so the declined carry is 290,400 and the
    // step 435,600 - one under is no hold, at it is held
    const at = (ctx) => world([...declined(), reply('r1', ctx - 1400, 12), ask('toolu_push', PUSH, ctx - 400, 10), answer('toolu_push', '"Push now?"="Hold"', 3)]).edit().status;
    assert.strictEqual(at(435599), 0, 'one under the step: no hold');
    assert.strictEqual(at(435600), 2, 'at the step: held');
    // the prompt route: under 1.5x no offer, past it one offer, once per gap
    const pu = world([...declined(), reply('r1', 420000, 7)]);
    assert.strictEqual(pu.prompt(), '', '420k at the prompt: no offer');
    assert.ok(!fs.existsSync(pu.hold), 'and no hold');
    const po = world([...declined(), reply('r1', 440000, 7)]);
    const offer = po.prompt();
    assert.match(offer, /sat idle 7 min since its last reply/, '440k at the prompt: the offer');
    assert.match(offer, /This session carries ~440k tokens per message/);
    assert.strictEqual(po.prompt(), '', 'once per gap');
    assert.ok(fs.existsSync(po.hold), 'the offer leaves the idle hold');
    // a second decline, at 441k, moves the step to the newest answer: 600k waits, 670k is offered
    const twice = (carry) => [floorRow(), reply('r0', 289000, 120), ask('toolu_fresh1', FRESH, 290000, 110), answer('toolu_fresh1', '"Resume?"="Continue here"', 103),
        reply('r1', 440000, 60), ask('toolu_fresh2', FRESH, 441000, 50), answer('toolu_fresh2', '"Resume?"="Continue here"', 43), reply('r2', carry, 7)];
    assert.strictEqual(world(twice(600000)).prompt(), '', '600k is under 1.5x the 441k declined second: no offer');
    assert.match(world(twice(670000)).prompt(), /~670k tokens per message/, '670k is past it: the offer');

    // A fresh-session ask answered past the wait arms nothing even with no earlier decline - the user just chose.
    const first = world([floorRow(), reply('r0', 289000, 40), ask('toolu_fresh1', FRESH, 290000, 30), answer('toolu_fresh1', '"Resume?"="Continue here"', 23)]);
    assert.strictEqual(first.edit().status, 0, 'a slow fresh-session answer is no slow ask');

    // UNATTENDED, unchanged: a slow ordinary ask with no decline writes the unattended row and holds nothing; a prompt past
    // the wait injects nothing and writes its row.
    const u = world([floorRow(), reply('r0', 289000, 40), ask('toolu_push', PUSH, 290000, 30), answer('toolu_push', '"Push now?"="Push (Recommended)"', 23)], { ALFRED_CODE_UNATTENDED: '1' });
    assert.strictEqual(u.edit().status, 0, 'nobody at the terminal: no hold');
    assert.match(u.ledger(), /"mode":"unattended"[^\n]*"kind":"idle-gap-offer"/, 'the unattended row is written');
    const up = world([floorRow(), reply('r1', 291000, 7)], { ALFRED_CODE_UNATTENDED: '1' });
    assert.strictEqual(up.prompt(), '', 'nobody at the terminal: no injection');
    assert.match(up.ledger(), /"mode":"unattended"[^\n]*"kind":"idle-gap-offer"/);
});

// Usage audit 2026-11-03 U13: past the trigger, the fresh-session offer waited for a Stop - and a build that ticks its plan
// card by card emits none between tasks, so the next task ran at the full carry. A tick past the trigger now arms the
// hold, and the next task's first change is the one put to the user; the plan's Resume line is the cursor.
test('compact-state: a plan task ticked DONE past the trigger holds the next task\'s first change (usage audit 2026-11-03 U13)', () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const SHELL = path.join(HOOKS, 'shell-guards.js');
    const FILES = path.join(HOOKS, 'file-guards.js');
    const plan = (statuses, resume = 'next task 2') => ['# Export - plan', '', 'Asked: "export the rows"', `Resume: ${resume}`, '', '## Tasks', '',
        ...statuses.flatMap((s, i) => [`### Task ${i + 1} - slice ${i + 1}`, '', `- status: ${s}`, '- estimate: 10m', ''])].join('\n');
    const DONE = '- status: DONE (`npm test` - 12 passed)';
    const setup = ({ statuses = ['IN_PROGRESS', 'TODO', 'TODO'], carry = 450000, floor = 40000, env: more = {}, head = [], mid = [] } = {}) =>
    {
        const p = project();
        const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'tick-')), ...more };
        const tp = p.transcript([...head, usageRow('f', { cache_creation_input_tokens: floor }), ...mid, usageRow('a', { cache_read_input_tokens: carry })]);
        const file = path.join(p.root, '.alfred', 'docs', 'work', 'plans', 'export.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, plan(statuses));
        const via = (hook, tool, input, extra = {}) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp, ...extra }, env, hook);
        // the tick as a build writes it: judged at PreToolUse, then the edit lands
        const tick = (old = '- status: IN_PROGRESS', next = DONE, extra = {}) =>
        {
            const r = via(FILES, 'Edit', { file_path: file, old_string: old, new_string: next }, extra);
            if (r.status === 0) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(old, next));
            return r;
        };
        const edit = () => via(FILES, 'Edit', { file_path: path.join(p.root, 'src.js'), old_string: 'a', new_string: 'b' });
        const ledger = () => { try { return fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8'); } catch { return ''; } };
        const stopFile = path.join(env.ALFRED_CODE_HOOK_LOG_DIR, `guard-stop-fresh-${tp.replace(/[^a-zA-Z0-9]/g, '_').slice(-80)}.blocked`);
        return { p, tp, env, file, via, tick, edit, ledger, stopFile };
    };
    const answered = (id, q = 'Fresh?') => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Your questions have been answered: "${q}"="Continue here"` }] } });

    const s = setup();
    assert.strictEqual(s.tick().status, 0, 'the tick itself is never held');
    assert.strictEqual(s.via(FILES, 'Edit', { file_path: s.file, old_string: 'Resume: next task 2', new_string: 'Resume: next task 2 - nothing mid-task' }).status, 0,
        "the plan's own edits pass - the Resume line, the Decisions ledger");
    fs.writeFileSync(s.file, fs.readFileSync(s.file, 'utf8').replace('Resume: next task 2', 'Resume: next task 2 - nothing mid-task'));
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'git status --short' }).status, 0, 'a reading shell call passes');
    assert.strictEqual(s.via(FILES, 'Read', { file_path: s.file }).status, 0, 'a read passes');
    const held = s.edit();
    assert.strictEqual(held.status, 2, "the next task's first change is held");
    const said = held.stderr.replace(/\s+/g, ' ');
    assert.match(said, /plan task 'Task 1 - slice 1' was just ticked DONE in \.alfred\/docs\/work\/plans\/export\.md/);
    assert.match(said, /\(now: 'next task 2 - nothing mid-task'\)/, 'the Resume line as it stands at the denial');
    assert.match(said, /~450k tokens per message/);
    assert.match(said, /A fresh session restarts at ~40k/);
    assert.match(said, /'Resume in a fresh session \(Recommended\)'/);
    assert.match(said, /or fewer messages than the payback, say so in one line - 'single short step: <what>' or 'fewer messages than the payback: <what>, ~N messages' - and retry/, 'AC-6: the tick hold names both exits');
    assert.match(s.ledger(), /"kind":"tick-offer"/, 'one probe row records the arm');
    assert.strictEqual(s.via(SHELL, 'Bash', { command: 'echo x > src.js' }).status, 2, 'a writing shell call is a change too');
    assert.strictEqual(s.edit().status, 0, 'two denials, then it gives way');
    assert.match(s.ledger(), /"kind":"tick-hold"[^\n]*"outcome":"denied-twice"/);

    const a = setup();
    a.tick();
    fs.appendFileSync(a.tp, JSON.stringify(answered('q1')) + '\n');
    assert.strictEqual(a.edit().status, 0, 'an answered ask releases it');
    const o = setup();
    o.tick();
    fs.writeFileSync(o.stopFile, '452000');
    assert.strictEqual(o.edit().status, 0, 'the Stop made the offer since: released');
    assert.match(o.ledger(), /"kind":"tick-hold"[^\n]*"outcome":"offered-at-stop"/);

    // every way a build writes the tick
    const both = setup();
    both.tick('- status: IN_PROGRESS\n- estimate: 10m\n\n### Task 2 - slice 2\n\n- status: TODO', `${DONE}\n- estimate: 10m\n\n### Task 2 - slice 2\n\n- status: IN_PROGRESS`);
    assert.strictEqual(both.edit().status, 2, 'a tick that also starts the next card holds');
    const multi = setup();
    multi.via(FILES, 'MultiEdit', { file_path: multi.file, edits: [{ old_string: '- status: IN_PROGRESS', new_string: DONE }, { old_string: 'Resume: next task 2', new_string: 'Resume: next task 2 (fresh)' }] });
    assert.strictEqual(multi.edit().status, 2, 'a MultiEdit tick holds');
    const write = setup();
    write.via(FILES, 'Write', { file_path: write.file, content: plan(['DONE (`npm test` - 12 passed)', 'TODO', 'TODO']) });
    assert.strictEqual(write.edit().status, 2, 'a Write that ticks holds');
    const parked = setup({ statuses: ['IN_PROGRESS', 'TODO', 'IN_PROGRESS\n- needs: the integration run'] });
    parked.tick();
    assert.strictEqual(parked.edit().status, 2, "a card parked on a run (needs:) is no work in flight");

    const none = (label, t, args = []) => { t.tick(...args); assert.strictEqual(t.edit().status, 0, label); return t; };
    none('under the trigger: no hold', setup({ carry: 300000 }));
    none('the last task: the finish step is next, no hold', setup({ statuses: ['DONE (x)', 'DONE (x)', 'IN_PROGRESS'] }));
    none('another card still in flight: no hold', setup({ statuses: ['IN_PROGRESS', 'IN_PROGRESS', 'TODO'] }));
    none('a tick that closes the plan with Completed: no hold', setup({ statuses: ['DONE (x)', 'IN_PROGRESS', 'TODO'] }), ['- status: IN_PROGRESS', `${DONE}\n\nCompleted: 2026-11-03`]);
    const un = none('nobody at the terminal: no hold', setup({ env: { ALFRED_CODE_UNATTENDED: '1' } }));
    assert.match(un.ledger(), /"mode":"unattended"[^\n]*"kind":"tick-offer"/, 'logged, not offered');
    none('the project compacts instead (AUTO_COMPACT=1): no hold', setup({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }));
    none('a fresh session would not pay back: no hold', setup({ floor: 420000 }));
    const auto = setup({ head: [{ type: 'user', message: { role: 'user', content: 'run it overnight' } }] });
    fs.mkdirSync(auto.p.flow, { recursive: true });
    fs.writeFileSync(path.join(auto.p.flow, 'APPROVAL'), 'AUTO - "run it overnight"\n');
    none('a live AUTO waiver: no hold', auto);
    none("a seat's tick: no hold", setup(), [undefined, undefined, { agent_id: 'seat-1' }]);
    const grown = setup();
    fs.writeFileSync(grown.stopFile, '400000');
    none('the Stop offered at 400k: 450k has not grown 1.5x, no hold', grown);
    const askRow = { type: 'assistant', message: { id: 'q', model: 'claude-opus-5-5', usage: { cache_read_input_tokens: 400000 },
        content: [{ type: 'tool_use', id: 'toolu_f1', name: 'AskUserQuestion', input: { questions: [{ question: 'Resume in a fresh session?' }] } }] } };
    none('a fresh-session ask answered at 400k: no hold before 600k', setup({ mid: [askRow, answered('toolu_f1', 'Resume in a fresh session?')] }));
    // the tick's own offer counts as spent: the next tick waits for the carry to grow 1.5x
    const twice = setup({ statuses: ['IN_PROGRESS', 'TODO', 'TODO', 'TODO'] });
    twice.tick();
    fs.appendFileSync(twice.tp, JSON.stringify(usageRow('b', { cache_read_input_tokens: 455000 }, 'single short step: none left in this card')) + '\n');
    assert.strictEqual(twice.edit().status, 0, 'the single-short-step line releases it');
    none('the next tick at 455k: no hold', twice, ['- status: TODO', DONE]);
    fs.appendFileSync(twice.tp, JSON.stringify(usageRow('c', { cache_read_input_tokens: 700000 })) + '\n');
    twice.tick('- status: TODO', DONE);
    assert.strictEqual(twice.edit().status, 2, 'grown past 1.5x (700k over 450k): held again');

    // missing, empty and garbage input never block, and arm nothing
    const g = setup();
    const plans = path.join(g.p.root, '.alfred', 'docs', 'work', 'plans');
    assert.strictEqual(g.via(FILES, 'MultiEdit', { file_path: g.file, edits: 'garbage' }).status, 0);
    assert.strictEqual(g.via(FILES, 'Edit', { file_path: path.join(plans, 'gone.md'), old_string: '- status: IN_PROGRESS', new_string: DONE }).status, 0, 'a plan not on disk');
    assert.strictEqual(g.via(FILES, 'Write', { file_path: path.join(plans, 'new.md'), content: plan(['DONE (x)', 'TODO']) }).status, 0, 'a new plan written with a card DONE');
    assert.strictEqual(g.via(FILES, 'Edit', { file_path: path.join(g.p.root, 'notes', 'status.md'), old_string: 'x', new_string: DONE }).status, 0, 'a file outside a plans folder');
    fs.writeFileSync(path.join(plans, 'empty.md'), '');
    assert.strictEqual(g.via(FILES, 'Write', { file_path: path.join(plans, 'empty.md'), content: DONE }).status, 0, 'an empty plan');
    assert.strictEqual(g.via(FILES, 'Edit', { file_path: g.file, old_string: 'no such text', new_string: DONE }).status, 0, 'an edit that matches nothing');
    assert.strictEqual(g.edit().status, 0, 'none of them armed a hold');
    assert.strictEqual(g.p.run('{not json', {}, FILES).status, 0, 'garbage stdin');
});

// The cache-aware verdict (spec 2026-10-28, sections 1-3): claude-opus-5-5 reads at 0.05x, the 1h split writes at 2x and
// the payback window is 30, so over a 79k floor a fresh session pays back past a 211,600 carry - and never at ctx 0.
test('compact-state: the chained, hold and idle routes offer only where a fresh session pays back with the cache warm', () =>
{
    const F = 79000;
    const H1 = { cache_creation_input_tokens: F, cache_creation: { ephemeral_1h_input_tokens: F, ephemeral_5m_input_tokens: 0 } };
    const read = (n) => ({ cache_read_input_tokens: n });
    const PAYS = /This session carries ~250k tokens per message; with the cache warm \(1h TTL\) a turn re-reads it at 0\.05x the input price\. A fresh session restarts at ~79k, written new at 2x, and pays back in about 23 messages\./;
    const ledgerOf = (p) => { try { return fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8'); } catch { return ''; } };

    // The chained run (the second typed command): judged on the verdict alone, no size floor.
    const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
    const result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
    const call = (id, usage) => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }], ...(usage ? { usage } : {}) } });
    const said = (id, text, usage) => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', content: [{ type: 'text', text }], ...(usage ? { usage } : {}) } });
    const chain = (ctx, head) => [...(head ? [user('x'.repeat(600 * 1024))] : []), user('<command-name>/capture-awareness</command-name>'),
        call('c1', ctx ? H1 : null), result(), call('c2', ctx ? read(F) : null), result(), said('c3', 'captured', ctx ? read(F) : null),
        user('now the quality loop'), said('c4', 'ok', ctx ? read(ctx) : null), user('<command-name>/loop-code-quality</command-name>')];
    const slash = (ctx, head) => {
        const p = project();
        const r = p.run({ hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'loop-code-quality', command_args: '',
            prompt: '/loop-code-quality', transcript_path: p.transcript(chain(ctx, head)) }, { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'pay-chain-')) });
        assert.strictEqual(r.status, 0, r.stderr);
        return (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '').replace(/(?:^|\n\n)Open your reply to this command with these two lines[\s\S]*$/, '');
    };
    assert.strictEqual(slash(100000), '', '100k does not pay back');
    assert.strictEqual(slash(200000), '', '200k does not either - the 40% rule offered it');
    assert.strictEqual(slash(0), '', 'no reading: no offer');
    assert.strictEqual(slash(100000, true), '', 'a floor behind a 600KB head is read, and 100k over it does not pay');
    const chained = slash(250000);
    assert.match(chained, /ALREADY run one/, '250k pays back - the offer');
    assert.match(chained, PAYS, 'priced with the cache warm');
    assert.doesNotMatch(chained, /re-sends/, 'no re-send claim');

    // The compaction hold: holds where it pays, releases where it does not, and waits out a call with no reading.
    const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'pay-hold-')) };
    const rows = [usageRow('f', H1), usageRow('a', read(316000)), boundary('auto', 317000)];
    const edit = (p, tp) => p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: tp }, env);
    const low = project();
    const tl = low.transcript(rows);
    low.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tl }, env);
    fs.appendFileSync(tl, JSON.stringify(usageRow('b', read(110000))) + '\n');
    assert.strictEqual(edit(low, tl).status, 0, '110k does not pay back: the change goes through');
    assert.match(ledgerOf(low), /"kind":"compact-hold"[^\n]*"outcome":"not-worth-resuming"/, 'released, one row');
    const zero = project();
    const tz = zero.transcript(rows);
    zero.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tz }, env);
    assert.strictEqual(edit(zero, tz).status, 0, 'ctx 0 - no reading after the compaction: the call passes');
    const holdFile = path.join(env.ALFRED_CODE_HOOK_LOG_DIR, `guard-fresh-compact-${tz.replace(/[^a-zA-Z0-9]/g, '_').slice(-80)}.hold`);
    assert.ok(fs.existsSync(holdFile), 'the hold stays armed');
    assert.strictEqual(JSON.parse(fs.readFileSync(holdFile, 'utf8')).denied, 0, 'no denial spent');
    fs.appendFileSync(tz, JSON.stringify(usageRow('b', read(250000))) + '\n');
    const held = edit(zero, tz);
    assert.strictEqual(held.status, 2, 'the next changing call, at 250k, is held');
    assert.match(held.stderr, PAYS, 'with the paying text');
    assert.doesNotMatch(held.stderr, /re-sends|re-writes all/);

    // The idle-gap offer after a 3h gap.
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const idle = (carry) => {
        const p = project();
        const tp = p.transcript([{ ...usageRow('f', H1), timestamp: ago(4) }, { ...usageRow('l', read(carry)), timestamp: ago(3) }]);
        const r = p.run({ hook_event_name: 'UserPromptSubmit', prompt: 'next card', transcript_path: tp }, { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'pay-idle-')) });
        return r.stdout ? startText(r) : '';
    };
    assert.strictEqual(idle(100000), '', '100k after 3h: no offer');
    const offer = idle(250000);
    assert.match(offer, /sat idle 3\.0h since its last reply; this message has already re-written the context, so the choice is priced as from now: /);
    assert.match(offer, PAYS);
});

// Audit 2026-10-10 C19, b35afe70: spec-check printed `path: gated`, the plan was written and task-verify-plan ran 8s
// later with no stop; the one stop the user saw in 38 minutes was the approval.
test('gated stops: a gated cycle\'s gate and build skills wait for a stop after the step before them (C19)', () =>
{
    const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
    let k = 0;
    const call = (name, input, out) => { const id = `g${++k}`; return [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }]; };
    const spec = (p) => call('Bash', { command: 'node spec-check.js "add the export"' },
        `surface: no\nbehaviour: yes - export\nverified: no\nstacks: 1 - node\nsecurity: no\nspec: not full - surface; verified\npath: ${p}`);
    const design = call('Skill', { skill: 'task-design' }, 'Launching skill: task-design');
    const plan = call('Write', { file_path: 'docs/plans/2026-10-10-export.md', content: '# plan' }, 'ok');
    const answered = call('AskUserQuestion', { questions: [] }, 'Your questions have been answered: "Design done. Audit it?"="Audit (Recommended)". You can now continue.');
    const base = [typed('<command-name>/task-solve</command-name>'), ...call('Skill', { skill: 'task-solve' }, 'Its `path: gated` is final.'), ...spec('gated'), ...design, ...plan];
    const skillCall = (s, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: s }, ...extra });
    const p = project();
    const tp = p.transcript(base);
    const r = p.run({ ...skillCall('task-verify-plan'), transcript_path: tp });
    assert.strictEqual(r.status, 2, 'the gate skill right after the design is held');
    assert.match(r.stderr, /spec check printed `path: gated`, so step 1 DESIGN ends with a STOP before task-verify-plan/);
    const again = p.run({ ...skillCall('task-verify-plan'), transcript_path: tp });
    assert.strictEqual(again.status, 0, 'held once per step call - never a loop');
    const rows = fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(rows.some((x) => x.mode === 'probe' && x.kind === 'gated-stop'), 'the pass after the deny is a row');
    const pass = (name, rowsOf, s = 'task-verify-plan', extra = {}, env = {}) => { const q = project(); assert.strictEqual(q.run({ ...skillCall(s, extra), transcript_path: q.transcript(rowsOf) }, env).status, 0, name); };
    pass('an answered ask after the design releases it', [...base, ...answered]);
    pass('a typed prompt after the design releases it', [...base, typed('looks good, audit it')]);
    pass('a merged path is never held', [typed('<command-name>/task-solve</command-name>'), ...spec('merged'), ...design, ...plan]);
    pass('the skill body naming `path: gated` is no spec check', [typed('<command-name>/task-solve</command-name>'), ...call('Skill', { skill: 'task-solve' }, 'Its `path: gated` is final.'), ...design, ...plan]);
    pass('a seat is never held', base, 'task-verify-plan', { agent_id: 'a1' });
    pass('nobody at the terminal waives the stops', base, 'task-verify-plan', {}, { ALFRED_CODE_UNATTENDED: '1' });
    pass('another skill is never held', base, 'habits-clarify');
    const gate = call('Skill', { skill: 'alfred-code:task-verify-plan' }, 'Launching skill: task-verify-plan');
    const q = project();
    const b = q.run({ ...skillCall('alfred-code:task-implement'), transcript_path: q.transcript([...base, ...answered, ...gate]) });
    assert.strictEqual(b.status, 2, 'the build skill right after the gate is held');
    assert.match(b.stderr, /step 2 GATE ends with a STOP before task-implement/);
    pass('the build after the approval ask passes', [...base, ...answered, ...gate, ...answered], 'task-implement');
    // b35afe70: the design's own clarify ask (L122) was answered BEFORE the plan was written - no stop after the artifact
    const c = project();
    const mid = [typed('<command-name>/task-solve</command-name>'), ...spec('gated'), ...design, ...answered, ...plan];
    assert.strictEqual(c.run({ ...skillCall('task-verify-plan'), transcript_path: c.transcript(mid) }).status, 2, 'a clarify ask answered mid-design is no stop');
    const stamp = call('Edit', { file_path: 'docs/plans/2026-10-10-export.md', old_string: 'x', new_string: 'Gated: passed' }, 'ok');
    const d = project();
    assert.strictEqual(d.run({ ...skillCall('task-implement'), transcript_path: d.transcript([...base, ...answered, ...gate, ...answered, ...stamp]) }).status, 0,
        'step 3\'s Approved: stamp after the approval answer moves nothing');
    // PF1: a folder plan's Markdown reaching disk is the design's artifact, as the flat write is
    const folderPlan = call('Write', { file_path: '.alfred/docs/work/plans/csv/csv.md', content: '# plan' }, 'ok');
    const e = project();
    assert.strictEqual(e.run({ ...skillCall('task-verify-plan'), transcript_path: e.transcript([typed('<command-name>/task-solve</command-name>'), ...spec('gated'), ...design, ...folderPlan]) }).status, 2,
        'a folder plan is the design\'s artifact');
});

test('compact-state: compact-points.json is read from state/sessions/, else from the legacy flow/ (2.8.0)', () =>
{
    const p = project();
    const fresh = require('../stack/hooks/fresh-session.js');
    const tp = p.transcript([usageRow('f', { cache_creation_input_tokens: 90000 }), usageRow('a', { cache_read_input_tokens: 100000 })]);
    const point = (dir, tokens) =>
    {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'compact-points.json'), JSON.stringify([{ at: new Date().toISOString(), model: 'claude-opus-5-5', tokens }]));
    };
    const saved = { ...process.env };
    try
    {
        process.env.CLAUDE_PROJECT_DIR = p.root;
        process.env.CLAUDE_CONFIG_DIR = BASE_ENV.CLAUDE_CONFIG_DIR;
        for (const k of ['ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_AUTOCOMPACT_WINDOW']) delete process.env[k];
        point(p.flow, 300000);
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 270000, 'only the legacy record: read, 90% of its point');
        point(p.sessions, 200000);
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 180000, 'the new one wins');
    }
    finally { process.env = saved; }
});

test('compact-state: the snapshot lands in state/sessions/ and lists the stamps of state/approvals/ and the legacy flow/ (2.8.0)', () =>
{
    const p = project();
    p.stamp('APPROVAL', 5);
    p.stamp('COMMIT-GATE', 7, p.flow);
    fs.writeFileSync(path.join(p.flow, 'untracked-at-start-abc1234'), 'x\n');
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: p.transcript([]) });
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, /^flow stamps:\n  APPROVAL - 5 min old\n  COMMIT-GATE - 7 min old$/m, 'a receipt in either home, nothing else');
    assert.ok(!fs.existsSync(path.join(p.flow, 'COMPACT-STATE')), 'nothing written to the legacy flow/');
    const start = p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: p.transcript([]) });
    assert.match(start.stdout, /saved what this session had open at \.alfred\/state\/sessions\/COMPACT-STATE/);
});

test('compact-state: a plan\'s stamp is listed as <plan id>/APPROVAL, an empty plan folder not at all (per-plan approvals)', () =>
{
    const p = project();
    p.stamp('APPROVAL', 4, path.join(p.approvals, 'cart'));
    fs.mkdirSync(path.join(p.approvals, 'empty'), { recursive: true });
    p.stamp('COMMIT-GATE', 6);
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: p.transcript([]) });
    const text = fs.readFileSync(p.state, 'utf8');
    assert.match(text, /^flow stamps:\n  cart\/APPROVAL - 4 min old\n  COMMIT-GATE - 6 min old$/m);
});

// ---- loading audit 2026-10-21: G2 nested flows, G9 Skill-route bodies, G10 one snapshot per session, G3 a seat's own
// compaction, PF-23 the personal doc's answer language ----------------------------------------------------------------
const skillFile = (p, name, chars = 100) =>
{
    const dir = path.join(p.root, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n${'x'.repeat(chars)}\n`);
};

test('G2: a slash flow that calls another flow through the Skill tool keeps both, and the compact start re-reads the slash one', () =>
{
    const p = project();
    skillFile(p, 'task-solve');
    skillFile(p, 'task-implement');
    const tp = p.transcript([userRow('<command-name>/task-solve</command-name>'), toolUse('Skill', { skill: 'task-implement' }), usageRow('a1', { cache_read_input_tokens: 900 })]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    const state = fs.readFileSync(p.state, 'utf8');
    assert.match(state, /^open flows:$/m);
    assert.match(state, /^ {2}\/task-solve - slash command - body .*task-solve\/SKILL\.md - re-read$/m);
    assert.match(state, /^ {2}\/task-implement - Skill call - body .*task-implement\/SKILL\.md \(\d+ chars, 0 Skill calls after it\)$/m, 'a short newest Skill run is not marked re-read');
    const start = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }));
    assert.match(start, /\/task-solve, typed as a slash command, so its body was NOT carried through the compaction - Read .*task-solve\/SKILL\.md again/);
    assert.doesNotMatch(start, /Read .*task-implement\/SKILL\.md/, 'a short newest Skill body comes back whole');
});

test('G9: a Skill-route body past the 5,000-token re-attach, or one pushed out by later Skill calls, is re-read', () =>
{
    const p = project();
    skillFile(p, 'task-implement', 19000);
    const tp = p.transcript([userRow('go'), toolUse('Skill', { skill: 'task-implement' })]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    assert.match(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp })), /\/task-implement, a Skill call whose body .*Read .*task-implement\/SKILL\.md again/);
    const q = project();
    skillFile(q, 'task-implement');
    const later = Array.from({ length: 5 }, (_, i) => toolUse('Skill', { skill: `habits-${i}` }));
    const tq = q.transcript([userRow('go'), toolUse('Skill', { skill: 'task-implement' }), ...later]);
    q.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tq });
    assert.match(startText(q.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tq })), /Read .*task-implement\/SKILL\.md again/);
});

test('G10: each session keeps its own snapshot - another session\'s PreCompact never takes this one\'s pointer', () =>
{
    const p = project();
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' });
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', session_id: 'parallel-session' });
    assert.match(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact' })), /COMPACT-STATE/);
    assert.match(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'parallel-session' })), /COMPACT-STATE-parallel-session/);
});

test('G3: a seat\'s own compaction start says nothing, arms no hold and records no model', () =>
{
    const p = project();
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' });
    const r = p.run({ hook_event_name: 'SessionStart', source: 'compact', agent_id: 'agent-3', agent_type: 'alfred-code:web-angular-implementer', model: 'claude-haiku-5-5' });
    assert.strictEqual(r.stdout, '', r.stdout);
    assert.deepStrictEqual(fs.readdirSync(p.tmpdir).filter((f) => f.startsWith('guard-fresh-compact-')), []);
});

test('PF-23: after a compaction the answer language follows the personal preferences doc too', () =>
{
    const p = project();
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto' });
    assert.match(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact' })), /unless a loaded skill or the personal preferences doc \(PERSONAL-PREFERENCES\.md\) sets the answer language/);
});

// ---- 2026-10-30: Claude Code's idle compaction (about an hour after the last reply, before the prompt cache expires)
// is no context limit, so it never lowers the fresh-session trigger nor the status file's resumeAt (the user's must-hold).
const STATUS_JS = path.join(__dirname, '..', 'stack', 'hooks', 'session-status.js');
const FRESH_JS = path.join(__dirname, '..', 'stack', 'hooks', 'fresh-session.js');
const MIN = 60000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const stamped = (row, msAgo) => ({ ...row, timestamp: ago(msAgo) });
const IDLE_TEXT = 'Compacted while idle, before the prompt cache expired · turn off with "idleCompaction": false in settings.json';
const idleNotice = (atMs) => ({ type: 'system', subtype: 'informational', content: IDLE_TEXT, timestamp: new Date(atMs + 600).toISOString() });
const summaryRow = (atMs) => ({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued ...' }, timestamp: new Date(atMs).toISOString() });
const boundaryRow = (preTokens, atMs) => ({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens, durationMs: 49000 }, timestamp: new Date(atMs).toISOString() });
// the engine and the status file, read the way a hook process reads them: a child with this session's payload
function engine(p, tp, code, env = {})
{
    const script = `const S = require(${JSON.stringify(STATUS_JS)}); const F = require(${JSON.stringify(FRESH_JS)});`
        + ` const payload = { session_id: ${JSON.stringify(p.sid)}, cwd: ${JSON.stringify(p.root)}, transcript_path: ${JSON.stringify(tp)} }; F.use(payload);`
        + ` const out = (() => { ${code} })(); process.stdout.write(JSON.stringify(out === undefined ? null : out));`;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8',
        env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: p.root, TMPDIR: p.tmpdir, TEMP: p.tmpdir, TMP: p.tmpdir, ...env } });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}
const thresholdOf = (p, tp, env) => engine(p, tp, 'return F.ctxThreshold();', env);
const resumeAtOf = (p, tp, env) => engine(p, tp, 'return S.buildStatus(payload, { entry: null }).resumeAt;', env);
const settle = (p, tp, now, env) => engine(p, tp, `return F.settleCompactPoints({ now: ${now} });`, env);
const pointsOf = (p) => { try { return JSON.parse(fs.readFileSync(path.join(p.sessions, 'compact-points.json'), 'utf8')); } catch { return []; } };
const holdOf = (p, tp) => path.join(p.tmpdir, `guard-fresh-compact-${tp.replace(/[^a-zA-Z0-9]/g, '_').slice(-80)}.hold`);
// one compaction through the real hooks: PreCompact, then the boundary and its summary, then the compact start
function compaction(p, rows, { preTokens, env = {} } = {})
{
    const tp = path.join(p.root, 'transcripts', `${p.sid}.jsonl`);
    fs.mkdirSync(path.dirname(tp), { recursive: true });
    fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const before = { threshold: thresholdOf(p, tp, env), resumeAt: resumeAtOf(p, tp, env) };
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp }, env);
    const bAt = Date.now();
    fs.appendFileSync(tp, [boundaryRow(preTokens, bAt), summaryRow(bAt)].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const start = startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env));
    return { tp, bAt, before, start, state: fs.readFileSync(p.state, 'utf8'),
        after: { threshold: thresholdOf(p, tp, env), resumeAt: resumeAtOf(p, tp, env) } };
}
const reply = (tokens, msAgo, id = 'r1') => stamped(usageRow(id, { cache_read_input_tokens: tokens }), msAgo);

test('idle compaction: an idle compaction leaves the threshold and resumeAt unchanged', () =>
{
    const p = project();
    const c = compaction(p, [stamped(userRow('go on'), 60 * MIN), reply(230000, 55 * MIN)], { preTokens: 232000 });
    assert.strictEqual(c.before.threshold, 400000);
    assert.match(c.state, /^trigger: auto \(idle\)$/m);
    assert.match(c.start, /compacted while idle/);
    assert.doesNotMatch(c.start, /AUTO-COMPACTED/);
    assert.ok(!fs.existsSync(holdOf(p, c.tp)), 'no compact hold: no fresh session is offered');
    assert.deepStrictEqual(c.after, c.before, 'the threshold and resumeAt are unchanged');
    const rows = pointsOf(p);
    assert.deepStrictEqual(rows.map((r) => [r.tokens, r.held]), [[230000, true], [232000, true]]);
    fs.appendFileSync(c.tp, JSON.stringify(idleNotice(c.bAt)) + '\n');
    settle(p, c.tp, c.bAt + 31000);
    assert.deepStrictEqual(pointsOf(p).filter((r) => r.session === p.sid), [], 'the notice drops both');
    assert.strictEqual(thresholdOf(p, c.tp), 400000);
});

test('idle compaction: a compaction after a prompt that follows a long break is still recorded', () =>
{
    const toolUse60 = { ...stamped(usageRow('t1', { cache_read_input_tokens: 230000 }), 60 * MIN) };
    toolUse60.message = { ...toolUse60.message, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 3600' } }] };
    const cases = {
        prompt: [reply(230000, 55 * MIN), stamped(userRow('next step please'), 1 * MIN)],
        notification: [reply(230000, 55 * MIN), stamped(userRow('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>'), 1 * MIN)],
        'tool result': [toolUse60, stamped({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done' }] } }, 1000)],
    };
    for (const [name, rows] of Object.entries(cases))
    {
        const p = project();
        const c = compaction(p, rows, { preTokens: 232000 });
        assert.match(c.start, /AUTO-COMPACTED/, name);
        assert.match(c.state, /^trigger: auto$/m, name);
        assert.ok(fs.existsSync(holdOf(p, c.tp)), `${name}: the fresh-session hold is armed`);
        assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held]), [[230000, true], [232000, true]], `${name}: held after a 50-min gap`);
        assert.deepStrictEqual(c.after, c.before, `${name}: nothing lowered before the transcript is read`);
        settle(p, c.tp, c.bAt + 31000);
        assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held, r.settled]), [[230000, undefined, true], [232000, undefined, true]], name);
        assert.strictEqual(thresholdOf(p, c.tp), 207000, `${name}: 90% of the lower point`);
        assert.strictEqual(resumeAtOf(p, c.tp), 207000, name);
    }
});

test('idle compaction: a local command or a ! line since the reply is no prompt', () =>
{
    const caveat = { type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>The command below was run directly in Claude Code, not sent to you.</local-command-caveat>' } };
    const cases = {
        'local command': [reply(230000, 55 * MIN), stamped(caveat, 54 * MIN), stamped(userRow('<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>\n<command-args></command-args>'), 54 * MIN),
            stamped(userRow('<local-command-stdout>Reloaded 4 plugins</local-command-stdout>'), 54 * MIN)],
        '! line': [reply(230000, 55 * MIN), stamped(userRow('<bash-input> git status</bash-input>'), 54 * MIN), stamped(userRow('<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>'), 54 * MIN)],
    };
    for (const [name, rows] of Object.entries(cases))
    {
        const p = project();
        const c = compaction(p, rows, { preTokens: 232000 });
        assert.match(c.start, /compacted while idle/, name);
        assert.match(c.state, /^trigger: auto \(idle\)$/m, name);
        assert.ok(!fs.existsSync(holdOf(p, c.tp)), name);
        assert.deepStrictEqual(c.after, c.before, name);
    }
});

test('idle compaction: a compaction under the floor is not called idle', () =>
{
    const p = project();
    const c = compaction(p, [reply(150000, 55 * MIN)], { preTokens: 151000 });
    assert.match(c.start, /AUTO-COMPACTED/);
    assert.match(c.state, /^trigger: auto$/m);
    assert.deepStrictEqual(pointsOf(p).map((r) => r.held), [true, true], 'held by the gap alone');
    assert.deepStrictEqual(c.after, c.before);
    settle(p, c.tp, c.bAt + 31000);
    assert.strictEqual(thresholdOf(p, c.tp), 135000, 'counted once no notice came');
    for (const floor of ['120000', '50000'])   // 50000 is raised to 100,000
    {
        const q = project();
        const d = compaction(q, [reply(150000, 55 * MIN)], { preTokens: 151000, env: { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: floor } });
        assert.match(d.start, /compacted while idle/, floor);
        assert.match(d.state, /^trigger: auto \(idle\)$/m, floor);
    }
});

test('idle compaction: an idle compaction at the floor is held at PreCompact too', () =>
{
    // PreCompact counts the last reply's input side, 1-5k under the boundary's preTokens in real sessions
    const p = project();
    const c = compaction(p, [reply(198000, 55 * MIN)], { preTokens: 200000 });
    assert.match(c.state, /^trigger: auto$/m, "PreCompact's count is under the floor");
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held]), [[198000, true], [200000, true]]);
    assert.deepStrictEqual(c.after, c.before);
    assert.match(c.start, /compacted while idle/);
});

test('idle compaction: a reply with no timestamp is never called idle, and is held for the settle pass (R133)', () =>
{
    const p = project();
    const c = compaction(p, [usageRow('a', { cache_read_input_tokens: 316849 })], { preTokens: 317321 });
    assert.match(c.start, /AUTO-COMPACTED/);
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held]), [[316849, true], [317321, true]]);
    assert.deepStrictEqual(c.after, c.before, 'a held point moves nothing until it settles');
    settle(p, c.tp, c.bAt + 31000);
    assert.strictEqual(thresholdOf(p, c.tp), 285164, 'a plain boundary settles it and it counts');
});

test('idle compaction: a last reply with no time is held, and the settle pass decides it (R133)', () =>
{
    const untimed = () => { const r = reply(230000, 5 * MIN); delete r.timestamp; return r; };
    const p = project();
    const c = compaction(p, [stamped(userRow('go on'), 10 * MIN), untimed()], { preTokens: 232000 });
    assert.match(c.state, /^trigger: auto$/m, 'never called idle');
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held]), [[230000, true], [232000, true]]);
    settle(p, c.tp, c.bAt + 31000);
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.held, r.settled]), [[230000, undefined, true], [232000, undefined, true]]);
    const q = project();
    const d = compaction(q, [stamped(userRow('go on'), 10 * MIN), untimed()], { preTokens: 232000 });
    fs.appendFileSync(d.tp, JSON.stringify(idleNotice(d.bAt)) + '\n');
    settle(q, d.tp, d.bAt + 31000);
    assert.deepStrictEqual(pointsOf(q).filter((r) => r.session === q.sid), [], 'the idle notice drops both');
});

test('idle compaction: a transcript with no reply, or none on disk (R133)', () =>
{
    const p = project();
    // no reply names the model, so the session's saved model does (the SessionStart record)
    fs.mkdirSync(p.sessions, { recursive: true });
    fs.writeFileSync(path.join(p.sessions, 'models.json'), JSON.stringify({ [p.sid]: { model: 'claude-opus-5-5', at: new Date(Date.now() - 20 * MIN).toISOString() } }));
    const c = compaction(p, [stamped(userRow('go on'), 10 * MIN)], { preTokens: 232000 });
    assert.ok(pointsOf(p).length > 0 && pointsOf(p).every((r) => r.held === true), JSON.stringify(pointsOf(p)));
    settle(p, c.tp, c.bAt + 31000);
    assert.ok(pointsOf(p).every((r) => r.held === undefined), JSON.stringify(pointsOf(p)));
    const q = project();
    const r = q.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: path.join(q.root, 'transcripts', 'gone.jsonl') });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(pointsOf(q).every((x) => x.held !== true), JSON.stringify(pointsOf(q)));
});

// ---- the settle pass: each pending point confirmed against its own transcript (2026-10-30) ----
// A project whose points belong to other sessions, their transcripts beside the payload's own.
function history(rowsBySession, { own = 'cur-0' } = {})
{
    const p = project();
    const dir = path.join(p.root, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const tp = path.join(dir, `${own}.jsonl`);
    fs.writeFileSync(tp, JSON.stringify(stamped(usageRow('c', { cache_read_input_tokens: 1000 }), 1000)) + '\n');
    const write = (sid, rows) => fs.writeFileSync(path.join(dir, `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const [sid, rows] of Object.entries(rowsBySession)) if (rows) write(sid, rows);
    const points = (rows) => { fs.mkdirSync(p.sessions, { recursive: true }); fs.writeFileSync(path.join(p.sessions, 'compact-points.json'), JSON.stringify(rows, null, 1) + '\n'); };
    return { p, dir, tp, write, points, file: path.join(p.sessions, 'compact-points.json') };
}
const point = (session, tokens, atMs, extra = {}) => ({ at: new Date(atMs).toISOString(), session, model: 'claude-opus-5-5', tokens, ...extra });
const DAY = 86400000;
// in a child, counting the bytes read from (and the opens of) files whose name holds `watch`
const counted = (watch, call) => `const fs = require('fs'); const fds = new Set(); let bytes = 0, opens = 0; const oo = fs.openSync, rs = fs.readSync;`
    + ` fs.openSync = function (f, ...a) { const fd = oo.call(fs, f, ...a); if (String(f).includes(${JSON.stringify(watch)})) { fds.add(fd); opens++; } return fd; };`
    + ` fs.readSync = function (fd, ...a) { const n = rs.call(fs, fd, ...a); if (fds.has(fd)) bytes += n; return n; };`
    + ` const r = (() => { ${call} })(); return { r, bytes, opens };`;

test('settle: the history cleanup drops a point followed by the notice and keeps one that isn\'t', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({
        'aaaa-1': [boundaryRow(230500, t0 + 49000), idleNotice(t0 + 49000)],
        'bbbb-2': [boundaryRow(368500, t0 + 49000)],
    });
    h.points([point('aaaa-1', 230000, t0), point('bbbb-2', 368000, t0), point('cccc-3', 300000, t0)]);   // written by 3.4.0: no held, no settled
    const p = Object.assign(h.p, { sid: 'cur-0' });
    assert.strictEqual(thresholdOf(p, h.tp), 331200, '90% of 368k: A dropped (idle), C dropped (untied), B settled');
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.session, r.tokens, r.settled]), [['bbbb-2', 368000, true]]);
    const bytes = fs.readFileSync(h.file);
    const mtime = fs.statSync(h.file).mtimeMs;
    assert.strictEqual(thresholdOf(p, h.tp), 331200);
    assert.ok(fs.readFileSync(h.file).equals(bytes) && fs.statSync(h.file).mtimeMs === mtime, 'a second read writes nothing');
});

test('settle: a point read while its compaction runs is kept', () =>
{
    const at = Date.now() - 60000;
    const h = history({ 'dddd-4': [stamped(usageRow('d', { cache_read_input_tokens: 250000 }), 61000)] });
    h.points([point('dddd-4', 250000, at)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    settle(p, h.tp, at + 31000);
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.tokens, r.settled]), [[250000, undefined]], 'no boundary yet: kept, pending');
    assert.strictEqual(thresholdOf(p, h.tp), 225000, 'counted while it waits');
    const later = new Date(at + 11 * MIN);
    fs.utimesSync(path.join(h.dir, 'dddd-4.jsonl'), later, later);
    settle(p, h.tp, at + 11 * MIN);
    assert.deepStrictEqual(pointsOf(p), [], 'the session went on with no boundary of it: untied, dropped');
});

test('settle: a held point never counts before the notice decides', () =>
{
    const bAt = Date.now() - 5000;
    const h = history({ 'eeee-5': [boundaryRow(240000, bAt)] });
    h.points([point('eeee-5', 240000, bAt + 600, { held: true })]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    settle(p, h.tp, bAt + 5000);
    assert.deepStrictEqual(pointsOf(p).map((r) => r.held), [true], 'pending');
    assert.strictEqual(thresholdOf(p, h.tp), 400000, 'a held point counts toward nothing');
    fs.appendFileSync(path.join(h.dir, 'eeee-5.jsonl'), JSON.stringify(idleNotice(bAt)) + '\n');
    settle(p, h.tp, bAt + 31000);
    assert.deepStrictEqual(pointsOf(p), [], 'the notice drops it');
});

test('settle: a large transcript is never read whole', () =>
{
    const h = history({});
    const big = path.join(h.dir, 'ffff-6.jsonl');
    const t0 = Date.now() - 20 * 3600000;
    const pad = 'x'.repeat(900);
    const fd = fs.openSync(big, 'w');
    let bAt = 0;
    for (let i = 0; i < 64000; i += 1000)
    {
        const chunk = [];
        for (let j = i; j < i + 1000; j++)
        {
            chunk.push(JSON.stringify({ type: 'user', message: { role: 'user', content: pad }, timestamp: new Date(t0 + j * 1000).toISOString() }));
            if (j === 32000) { bAt = t0 + j * 1000; chunk.push(JSON.stringify(boundaryRow(260000, bAt))); }
        }
        fs.writeSync(fd, chunk.join('\n') + '\n');
    }
    fs.closeSync(fd);
    assert.ok(fs.statSync(big).size >= 60 * 1024 * 1024);
    h.points([point('ffff-6', 259000, bAt - 49000), point('ffff-6', 260000, bAt + 600)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const first = engine(p, h.tp, counted('ffff-6', `return F.settleCompactPoints({ now: ${bAt + 31000} });`));
    assert.deepStrictEqual(first.r, { dropped: 0, settled: 2 });
    assert.ok(first.bytes <= 6 * 1024 * 1024, `read ${first.bytes} bytes of a 64 MB transcript`);
    const again = engine(p, h.tp, counted('ffff-6', 'let t; for (let i = 0; i < 5; i++) { F.use(payload); t = F.ctxThreshold(); } return t;'));
    assert.deepStrictEqual([again.r, again.bytes], [233100, 0], 'a settled row is never read again');
    for (let i = 0; i < 3; i++) assert.strictEqual(engine(p, h.tp, counted('ffff-6', 'return F.ctxThreshold();')).bytes, 0);
    // a session that ended 1 s after its boundary still settles, at the next pass of any session
    const e = history({ 'gggg-7': [boundaryRow(270000, Date.now() - 2 * MIN)] });
    const ended = Date.now() - 2 * MIN;
    e.points([point('gggg-7', 270000, ended + 600, { held: true })]);
    const q = Object.assign(e.p, { sid: 'cur-0' });
    const one = engine(q, e.tp, counted('gggg-7', `return F.settleCompactPoints({ now: ${ended + 31000} });`));
    assert.deepStrictEqual([one.r, one.opens], [{ dropped: 0, settled: 1 }, 1]);
});

test('settle: a pass stops at its budget', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({ 'hhhh-1': [boundaryRow(300000, t0 + 49000)], 'hhhh-2': [boundaryRow(310000, t0 + 49000)], 'hhhh-3': [boundaryRow(320000, t0 + 49000)] });
    h.points([point('hhhh-1', 300000, t0), point('hhhh-2', 310000, t0), point('hhhh-3', 320000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    assert.deepStrictEqual(engine(p, h.tp, `return F.settleCompactPoints({ now: ${Date.now()}, budgetBytes: 1 });`), { dropped: 0, settled: 1 });
    assert.deepStrictEqual(pointsOf(p).map((r) => r.settled), [true, undefined, undefined]);
    assert.deepStrictEqual(engine(p, h.tp, `return F.settleCompactPoints({ now: ${Date.now()}, budgetBytes: 1 });`), { dropped: 0, settled: 1 });
});

test('settle: a session id that is no id is never read', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({});
    fs.writeFileSync(path.join(h.p.root, 'x.jsonl'), JSON.stringify(boundaryRow(300000, t0 + 49000)) + '\n');
    h.points([point('../x', 300000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const before = fs.readFileSync(h.file);
    const r = engine(p, h.tp, counted('x.jsonl', 'return F.ctxThreshold();'));
    assert.deepStrictEqual([r.r, r.opens], [270000, 0], 'kept and counted, never read');
    assert.ok(fs.readFileSync(h.file).equals(before), 'never rewritten');
});

test('settle: the settle keeps a point recorded during it', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({ 'iiii-1': [boundaryRow(300000, t0 + 49000)] });
    h.points([point('iiii-1', 300000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    // another writer records a point while this pass reads the transcript
    engine(p, h.tp, `const fs = require('fs'); const oo = fs.openSync; let done = false;`
        + ` fs.openSync = function (f, ...a) { if (!done && String(f).endsWith('iiii-1.jsonl')) { done = true; const file = F.compactPointsFile(true);`
        + ` const rows = JSON.parse(fs.readFileSync(file, 'utf8')); rows.push({ at: new Date().toISOString(), session: 'new-9', model: 'claude-opus-5-5', tokens: 280000 });`
        + ` fs.writeFileSync(file, JSON.stringify(rows)); } return oo.call(fs, f, ...a); }; return F.settleCompactPoints({ now: ${Date.now()} });`);
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.session, r.settled]), [['iiii-1', true], ['new-9', undefined]]);
});

test('settle: the VS Code and desktop notice drops an idle point too', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const away = { type: 'system', subtype: 'informational', timestamp: new Date(t0 + 49600).toISOString(),
        content: 'Compacted using a summary written while you were away · turn off with "idleCompaction": false in settings.json' };
    const h = history({ 'kkkk-1': [boundaryRow(240000, t0 + 49000), away] });
    h.points([point('kkkk-1', 240000, t0, { held: true })]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    assert.strictEqual(thresholdOf(p, h.tp), 400000);
    assert.deepStrictEqual(pointsOf(p), [], 'dropped as idle, never settled');
});

// a transcript of 1 KB rows `stepMs` apart, with an auto boundary after each index in `at`; rows past `rows` none
function spaced(file, { t0, rows, stepMs, at = [], row = (_, ts) => ({ type: 'user', message: { role: 'user', content: 'x'.repeat(900) }, timestamp: ts }) })
{
    const out = [];
    const bAts = [];
    for (let i = 0; i < rows; i++)
    {
        out.push(JSON.stringify(row(i, new Date(t0 + i * stepMs).toISOString())));
        if (at.includes(i)) { const bAt = t0 + i * stepMs + 1000; bAts.push(bAt); out.push(JSON.stringify(boundaryRow(260000 + i, bAt))); }
    }
    fs.writeFileSync(file, out.join('\n') + '\n');
    return bAts;
}

test('settle: points hours apart in one transcript each get their own window', () =>
{
    const h = history({});
    const t0 = Date.now() - 2 * DAY;
    const [b1, b2] = spaced(path.join(h.dir, 'llll-1.jsonl'), { t0, rows: 8000, stepMs: 10000, at: [200, 7800] });
    assert.ok(b2 - b1 > 20 * 3600000 && fs.statSync(path.join(h.dir, 'llll-1.jsonl')).size > 7.5 * 1024 * 1024);
    h.points([point('llll-1', 260200, b1 - 49000), point('llll-1', 260200, b1 + 600), point('llll-1', 267800, b2 - 49000), point('llll-1', 267800, b2 + 600)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const r = engine(p, h.tp, counted('llll-1', `return F.settleCompactPoints({ now: ${Date.now()}, capBytes: 1024 * 1024 });`));
    assert.deepStrictEqual(r.r, { dropped: 0, settled: 4 }, 'a read capped short of the later boundary drops none of its points');
    assert.ok(r.bytes <= 3 * 1024 * 1024, `two windows, never the hours between: read ${r.bytes} of 8 MB`);
});

test('settle: a read cut short never settles a point whose notice it did not reach', () =>
{
    const h = history({});
    const file = path.join(h.dir, 'mmmm-1.jsonl');
    const bAt = Date.now() - 5 * MIN;
    const filler = Array.from({ length: 1600 }, () => JSON.stringify({ type: 'progress', data: 'y'.repeat(1000), timestamp: new Date(bAt + 300).toISOString() }));
    fs.writeFileSync(file, [JSON.stringify(boundaryRow(240000, bAt)), ...filler, JSON.stringify(idleNotice(bAt))].join('\n') + '\n');
    h.points([point('mmmm-1', 240000, bAt + 600, { held: true })]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const call = (now) => engine(p, h.tp, `return F.settleCompactPoints({ now: ${now}, capBytes: 1024 * 1024 });`);
    assert.deepStrictEqual(call(bAt + 31000), { dropped: 0, settled: 0 }, 'the notice lies past the cap: wait');
    assert.deepStrictEqual(pointsOf(p).map((r) => r.held), [true]);
    assert.deepStrictEqual(call(bAt + 61 * MIN), { dropped: 1, settled: 0 }, 'an hour on, still unread: dropped, never counted');
});

test('settle: a row longer than one probe still lands the search at its window', () =>
{
    const h = history({});
    const file = path.join(h.dir, 'nnnn-1.jsonl');
    const t0 = Date.now() - 2 * DAY;
    // rows of 1.2 MB, 30 min apart, the timestamp the last key - a probe inside one finds none ahead within 1 MB
    const huge = (_, ts) => ({ type: 'user', message: { role: 'user', content: 'z'.repeat(1200 * 1024) }, timestamp: ts });
    const [bAt] = spaced(file, { t0, rows: 12, stepMs: 30 * MIN, at: [8], row: huge });
    h.points([point('nnnn-1', 260008, bAt + 600)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const r = engine(p, h.tp, counted('nnnn-1', `return F.settleCompactPoints({ now: ${Date.now()}, capBytes: 4 * 1024 * 1024 });`));
    assert.deepStrictEqual(r.r, { dropped: 0, settled: 1 }, 'the search landed by the boundary, not at the file start');
});

test('settle: garbage in, the threshold as with no points, no throw', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({ 'jjjj-1': null });
    fs.writeFileSync(path.join(h.dir, 'jjjj-1.jsonl'), '{not json\n\u0000\u0001garbage\n' + JSON.stringify(boundaryRow(300000, t0 + 49000)) + '\n{"type":"system","subtype":"compact_boundary","timestamp":"never"}\n');
    const p = Object.assign(h.p, { sid: 'cur-0' });
    fs.mkdirSync(p.sessions, { recursive: true });
    fs.writeFileSync(h.file, '{not json');
    assert.strictEqual(thresholdOf(p, h.tp), 400000);
    h.points([point('jjjj-1', 300000, t0), { at: 'yesterday', session: 'jjjj-1', model: 'claude-opus-5-5', tokens: 290000 }]);
    assert.strictEqual(thresholdOf(p, h.tp), 270000, 'the garbage lines skipped, the boundary found and the point settled');
    assert.deepStrictEqual(pointsOf(p).map((r) => [r.at, r.settled]), [[new Date(t0).toISOString(), true], ['yesterday', undefined]]);
});

// R130-R132: a pass bounded by its budget past the first window, one unreadable transcript skipped alone, a device name
// never opened.
test('R130: past the first window a pass reads at most its budget plus the probe blocks, and a window the budget cut decides nothing', () =>
{
    const h = history({});
    const t0 = Date.now() - 2 * DAY;
    const bAt = t0 + 49000;
    fs.writeFileSync(path.join(h.dir, 'qqqq-1.jsonl'), JSON.stringify(boundaryRow(300000, bAt)) + '\n');
    const filler = Array.from({ length: 6000 }, () => JSON.stringify({ type: 'progress', data: 'y'.repeat(1000), timestamp: new Date(bAt + 300).toISOString() }));
    fs.writeFileSync(path.join(h.dir, 'qqqq-2.jsonl'), [JSON.stringify(boundaryRow(300000, bAt)), ...filler].join('\n') + '\n');
    h.points([point('qqqq-1', 300000, t0), point('qqqq-2', 300000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const MB = 1024 * 1024;
    const r = engine(p, h.tp, counted('qqqq-', `return F.settleCompactPoints({ now: ${Date.now()}, budgetBytes: ${MB}, capBytes: ${4 * MB} });`));
    assert.ok(r.bytes <= 2 * MB, `read ${r.bytes}: the 1 MB budget plus the probe blocks`);
    assert.deepStrictEqual(r.r, { dropped: 0, settled: 1 }, 'the first settles; the one the budget cut waits for the next pass');
    assert.deepStrictEqual(pointsOf(p).map((x) => [x.session, x.settled]), [['qqqq-1', true], ['qqqq-2', undefined]]);
});

test('R131: a point whose transcript cannot be read (a directory) does not stop the next one settling', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({ 'rrrr-2': [boundaryRow(300000, t0 + 49000)] });
    fs.mkdirSync(path.join(h.dir, 'rrrr-1.jsonl'));
    h.points([point('rrrr-1', 300000, t0), point('rrrr-2', 300000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    assert.deepStrictEqual(engine(p, h.tp, `return F.settleCompactPoints({ now: ${Date.now()} });`), { dropped: 0, settled: 1 });
    assert.deepStrictEqual(pointsOf(p).map((x) => [x.session, x.settled]), [['rrrr-1', undefined], ['rrrr-2', true]]);
});

test('R132: a row naming a Windows device (CON, nul) is kept and never read', () =>
{
    const t0 = Date.now() - 2 * DAY;
    const h = history({});
    h.points([point('CON', 300000, t0), point('nul', 300000, t0)]);
    const p = Object.assign(h.p, { sid: 'cur-0' });
    const r = engine(p, h.tp, counted('CON', `return F.settleCompactPoints({ now: ${Date.now()} });`));
    assert.deepStrictEqual([r.r, r.opens], [{ dropped: 0, settled: 0 }, 0]);
    assert.deepStrictEqual(pointsOf(p).map((x) => x.session), ['CON', 'nul']);
});

// ---- PF1 plan 2: a plan-status call sets the session plan and arms the tick hold on done; the hold passes plan calls ----
const { planFolder, PLANS: PLAN_ROOT } = require('./plan-folder-fixture.js');
const ENGINE = 'node .claude/hooks/plan-status.js';
const HOOKS_DIR = path.join(__dirname, '..', 'stack', 'hooks');
const SHELL = path.join(HOOKS_DIR, 'shell-guards.js');
const FILES = path.join(HOOKS_DIR, 'file-guards.js');
const heredoc = (verb, rest, body) => `${ENGINE} ${verb} ${rest} <<'EOF'\n${body}\nEOF`;
// setup() of the U13 tick test with a folder plan in place of export.md: the carry past the trigger, the hooks fed
// PreToolUse payloads. more.hold writes a hold file of that route before the first call.
function folderSetup(planOpts = {}, more = {})
{
    const p = project();
    const env = { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'pf-tick-')) };
    const tp = p.transcript([usageRow('f', { cache_creation_input_tokens: 40000 }), usageRow('a', { cache_read_input_tokens: more.carry || 450000 })]);
    const plan = planFolder(p.root, 'csv', { session: p.sid, ...planOpts });
    const via = (hook, tool, input, extra = {}) => p.run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, transcript_path: tp, ...extra }, env, hook);
    const edit = () => via(FILES, 'Edit', { file_path: path.join(p.root, 'src.js'), old_string: 'a', new_string: 'b' });
    const ledger = () => { try { return fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', `${p.sid}.jsonl`), 'utf8'); } catch { return ''; } };
    const statusFile = () => path.join(p.root, '.claude', 'session-inspector', 'status', `${p.sid}.json`);
    const resetStatus = () => fs.rmSync(statusFile(), { force: true });
    if (more.hold)
    {
        const hold = { at: new Date().toISOString(), size: 0, denied: 0, route: more.hold, ctx: 450000 };
        if (more.hold === 'idle') hold.gapMs = 3 * 3600 * 1000;
        if (more.hold === 'tick')
        {
            plan.run(['done', '--plan', 'csv', '--task', '1'], 'result: ok 1\n');
            Object.assign(hold, { plan: plan.md, dir: plan.dir, rel: plan.rel, taskId: '1', task: 'Task 1 - slice 1', resume: 'next task 2' });
        }
        fs.writeFileSync(path.join(env.ALFRED_CODE_HOOK_LOG_DIR, `guard-fresh-compact-${tp.replace(/[^a-zA-Z0-9]/g, '_').slice(-80)}.hold`), JSON.stringify(hold));
    }
    return { p, tp, env, plan, via, edit, ledger, statusFile, resetStatus };
}

test('PF1 tick: a done call past the trigger holds the next task\'s first change; the plan calls pass', () =>
{
    const s = folderSetup({ approve: true, start: ['1'] });
    const done = () => s.via(SHELL, 'Bash', { command: heredoc('done', `--plan ${PLAN_ROOT}/csv --task 1`, 'result: npm test - 12 passed') });
    assert.strictEqual(done().status, 0, 'the tick itself is never held');
    s.plan.run(['done', '--plan', 'csv', '--task', '1'], 'result: npm test - 12 passed\n');   // the call lands
    assert.strictEqual(s.via(SHELL, 'Bash', { command: heredoc('cursor', '--plan csv', 'note: step 4 BUILD - mode session') }).status, 0, 'cursor passes');
    s.plan.run(['cursor', '--plan', 'csv'], 'note: step 4 BUILD - mode session\n');
    assert.strictEqual(s.via(SHELL, 'Bash', { command: `${ENGINE} resume --plan csv` }).status, 0, 'resume passes');
    const held = s.edit();
    assert.strictEqual(held.status, 2, 'the next source edit is held');
    const said = held.stderr.replace(/\s+/g, ' ');
    assert.match(said, /plan task 'Task 1 - slice 1' was just ticked DONE in \.alfred\/docs\/work\/plans\/csv\//);
    assert.match(said, /\(now: 'step 4 BUILD - mode session - next task 2'\)/, 'the status on disk at the denial');
    assert.match(said, /a plan-status\.js cursor call passes/);
    assert.match(s.ledger(), /"kind":"tick-offer"/);
});

test('PF1 tick: not armed on the last task, with another task in flight, under the trigger, or for a seat', () =>
{
    const arms = (opts, extra = {}, more = {}) =>
    {
        const s = folderSetup({ approve: true, start: ['1'], ...opts }, more);
        s.via(SHELL, 'Bash', { command: `${ENGINE} done --plan csv --task ${opts.tick || '1'}` }, extra.payload);
        return /"kind":"tick-offer"/.test(s.ledger());
    };
    assert.strictEqual(arms({}), true, 'the base case arms');
    assert.strictEqual(arms({ cards: 1 }), false, 'the last task');
    assert.strictEqual(arms({ start: ['1', '2'] }), false, 'another task is in_progress');
    assert.strictEqual(arms({ start: ['1'], block: ['2'] }), true, 'a blocked task is parked');
    assert.strictEqual(arms({}, {}, { carry: 100000 }), false, 'under the trigger');
    assert.strictEqual(arms({}, { payload: { agent_id: 'a1' } }), false, 'a seat');
    assert.strictEqual(arms({ start: [], tick: '2' }), false, 'a todo task: the engine refuses the done (R27)');
});

test('PF1 tick: a done that did not land leaves no hold (R27); unreadable status arms nothing', () =>
{
    const s = folderSetup({ approve: true, start: ['1'] });
    s.via(SHELL, 'Bash', { command: `${ENGINE} done --plan csv --task 1` });          // no result: line - refused by the engine
    assert.strictEqual(s.edit().status, 0, 'the task is still in_progress on disk: the hold is dropped');
    assert.match(s.ledger(), /"kind":"tick-hold"[^\n]*"outcome":"not-landed"/);
    const g = folderSetup({ approve: true, start: ['1'] });
    fs.writeFileSync(path.join(g.plan.dir, 'status.json'), '{');
    g.via(SHELL, 'Bash', { command: `${ENGINE} done --plan csv --task 1` });
    assert.doesNotMatch(g.ledger(), /tick-offer/);
});

test('PF1: the plan call sets the session plan - four spellings name one folder, complete and a seat set nothing', () =>
{
    const s = folderSetup({ approve: true });
    const plan = () => { try { return JSON.parse(fs.readFileSync(s.statusFile(), 'utf8')).plan; } catch { return undefined; } };
    for (const ref of ['csv', `${PLAN_ROOT}/csv`, `${PLAN_ROOT}/csv/csv.md`, `${PLAN_ROOT.replace(/\//g, '\\')}\\csv\\`])
    {
        s.resetStatus();
        s.via(SHELL, 'Bash', { command: `${ENGINE} start --plan ${ref} --task 1` });
        assert.strictEqual(plan(), `${PLAN_ROOT}/csv/`, ref);
    }
    s.resetStatus();
    s.via(SHELL, 'Bash', { command: `${ENGINE} complete --plan csv` });
    s.via(SHELL, 'Bash', { command: `${ENGINE} list` });
    s.via(SHELL, 'Bash', { command: `${ENGINE} show --plan csv` });
    s.via(SHELL, 'Bash', { command: `${ENGINE} start --plan "$P" --task 1` });
    s.via(SHELL, 'Bash', { command: `${ENGINE} start --plan csv --task 1` }, { agent_id: 'a1' });
    assert.strictEqual(plan(), undefined, 'complete, list, show, a variable ref and a seat write no status file');
    s.via(SHELL, 'Bash', { command: `${ENGINE} resume --plan csv` });
    assert.strictEqual(plan(), `${PLAN_ROOT}/csv/`, 'resume sets it');
});

test('PF1: the hold passes every plan call on its three routes, and still holds a call that also writes a file (F4)', () =>
{
    const ps = `${ENGINE} done --plan csv --task 1 @'\nresult: ok\n'@`;
    for (const route of ['compact', 'idle', 'tick'])
    {
        const s = folderSetup({ approve: true, start: ['1'] }, { hold: route });
        assert.strictEqual(s.via(SHELL, 'Bash', { command: `${ENGINE} resume --plan csv` }).status, 0, `${route}: resume`);
        assert.strictEqual(s.via(SHELL, 'Bash', { command: heredoc('done', '--plan csv --task 1', 'result: a > b') }).status, 0, `${route}: done with a heredoc`);
        assert.strictEqual(s.via(SHELL, 'PowerShell', { command: ps }).status, 0, `${route}: a PowerShell here-string`);
        assert.strictEqual(s.via(SHELL, 'Bash', { command: `${ENGINE} resume --plan csv > out.txt` }).status, 2, `${route}: a call that also writes a file`);
    }
});
