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
    const flow = path.join(root, '.alfred', 'docs', 'flow');
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
    p.stamp('monitor-sess.json', 1);   // the monitor's state is no stamp - its 2.1.5 turn log and context marker neither
    p.stamp('monitor-sess.jsonl', 1);
    p.stamp('monitor-sess.context', 1);
    p.stamp('turn-edits-sess', 1);     // nor is the turn check's old edit list
    p.stamp('turn-check-sess', 1);     // or its Stop marker
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
    assert.match(mine, /\.alfred\/docs\/flow\/COMPACT-STATE/);
    const other = ctx(p.run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'someone-else' }));
    assert.doesNotMatch(other, /COMPACT-STATE/, 'another session was pointed at this snapshot');
});

test('compact-state: with every fresh-session offer off, the compact start still points at the snapshot - and says nothing else', () =>
{
    const p = project();
    const off = { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0' };
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
    const tp = p.transcript([usageRow('f', { cache_creation_input_tokens: 90000 }), usageRow('a', { cache_read_input_tokens: 316849 })]);
    p.run({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: tp });
    assert.ok(!fs.existsSync(path.join(p.flow, 'compact-points.json')), 'a /compact the user typed is no ceiling reached');
    p.run({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: tp });
    fs.appendFileSync(tp, JSON.stringify(boundary('auto', 317321)) + '\n');   // the harness writes the boundary after PreCompact
    p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp });
    const rows = JSON.parse(fs.readFileSync(path.join(p.flow, 'compact-points.json'), 'utf8'));
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
        fs.writeFileSync(path.join(p.flow, 'compact-points.json'), JSON.stringify([{ at: new Date().toISOString(), model: 'claude-sonnet-5', tokens: 120000 }]));
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.ctxThreshold(), 400000, "another model's point is not this model's");
        fs.writeFileSync(path.join(p.flow, 'compact-points.json'), '{not json');
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
        { ...usageRow('a', { cache_read_input_tokens: pre - 300 }), timestamp: ago(0.1) }, boundary('auto', pre)];
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
        const point = JSON.parse(fs.readFileSync(path.join(p.flow, 'compact-points.json'), 'utf8')).pop();
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
    assert.match(startText(p.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }, env)),
        /without asking the user any further questions' - that is the harness's default line, and this hook supersedes it/);
    // audit 2026-10-20 C12, add5a91e: before any post-compaction reading, a shell call that writes nothing passes
    assert.strictEqual(call(p, tp, 'Bash', { tool_input: { command: 'cat .alfred/docs/flow/COMPACT-STATE' } }), 0, 'a reading shell call passes');
    after(tp, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(p, tp, 'Read'), 0, 'a read is never held');
    assert.strictEqual(call(p, tp, 'Edit', { agent_id: 'seat-1' }), 0, "a seat's call is the parent's work in flight");
    const held = p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: tp }, env);
    assert.strictEqual(held.status, 2, 'the first edit is held');
    assert.match(held.stderr, /~120k tokens per message/, 'the measured post-compaction carry');
    assert.match(held.stderr, /~40k, this session's own first message/, 'and the cold floor');
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
    const ta = a.transcript(rows);
    fs.mkdirSync(a.flow, { recursive: true });
    fs.writeFileSync(path.join(a.flow, 'APPROVAL'), 'AUTO - "run it overnight"\n');
    a.run({ hook_event_name: 'SessionStart', source: 'compact', transcript_path: ta }, env);
    after(ta, usageRow('b', { cache_read_input_tokens: 120000 }));
    assert.strictEqual(call(a, ta, 'Edit'), 0, 'a live AUTO waiver holds nothing');
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
    assert.match(text, /~290k tokens of context/);
    assert.match(text, /~78k, this session's own first message/);
    assert.match(text, /Resume in a fresh session \(Recommended\)/);
    assert.strictEqual(prompt(p, tp).stdout, '', 'once per gap - the next prompt of the same gap is not offered again');
    const ledger = fs.readdirSync(log, { recursive: true }).filter((f) => String(f).endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(log, String(f)), 'utf8')).join('')
        + (fs.existsSync(path.join(p.root, '.alfred', 'docs', 'hook-blocks')) ? fs.readdirSync(path.join(p.root, '.alfred', 'docs', 'hook-blocks')).map((f) => fs.readFileSync(path.join(p.root, '.alfred', 'docs', 'hook-blocks', f), 'utf8')).join('') : '');
    assert.match(ledger, /"kind":"idle-gap-offer"/, 'one probe row records it');
    const q = project();
    assert.strictEqual(prompt(q, q.transcript(rows(1.9))).stdout, '', 'under the 2h knob: no offer');
    assert.match(prompt(q, q.transcript(rows(2.1))).stdout, /sat idle 2\.1h/, 'over it: the offer');
    const off = project();
    assert.strictEqual(prompt(off, off.transcript(rows(19)), {}, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).stdout, '', '0 switches the route off');
    const w = project();
    assert.strictEqual(prompt(w, w.transcript(rows(19, 100000))).stdout, '', 'a carry mostly the cold floor is no offer');
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
    assert.match(held.stderr, /sat idle 19(?:\.0)?h/);
    assert.match(held.stderr, /~290k tokens per message/);
    assert.match(held.stderr, /~78k, this session's own first message/);
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
    assert.match(held.stderr, /last ask waited 4\.8h for its answer/);
    assert.match(held.stderr, /~290k tokens per message/);
    assert.match(held.stderr, /~78k, this session's own first message/);
    const ledger = fs.readFileSync(path.join(s.p.root, '.alfred', 'docs', 'hook-blocks', `${s.p.sid}.jsonl`), 'utf8');
    assert.match(ledger, /"kind":"idle-gap-offer"[^\n]*"via":"ask-answer"/, 'one probe row says where it came from');
    fs.appendFileSync(s.tp, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'f2',
        content: 'Your questions have been answered: "Fresh?"="Continue here"' }] } }) + '\n');
    assert.strictEqual(s.edit().status, 0, 'the fresh-session ask answered releases it');
    assert.strictEqual(s.edit().status, 0, 'and the same long ask never arms it twice');
    assert.strictEqual(setup(1.9).edit().status, 0, 'under the 2h knob: no hold');
    assert.strictEqual(setup(2.1).edit().status, 2, 'over it: held');
    assert.strictEqual(setup(4.8, { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }).edit().status, 0, '0 switches it off');
    assert.strictEqual(setup(4.8, { ALFRED_CODE_UNATTENDED: '1' }).edit().status, 0, 'nobody at the terminal: no hold');
    assert.strictEqual(setup(4.8, {}, 100000).edit().status, 0, 'a carry mostly the cold floor: no hold');
    const seat = setup(4.8);
    assert.strictEqual(seat.p.run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, transcript_path: seat.tp, agent_id: 'seat-1' },
        { ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'askgap-')) }).status, 0, 'a seat is never held');
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
    const rows = fs.readFileSync(path.join(p.root, '.alfred', 'docs', 'hook-blocks', `${p.sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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
});
