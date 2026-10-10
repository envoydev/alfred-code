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
for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_DEFAULT_CONTEXT_WINDOW', 'ALFRED_CODE_DOCS_ASK',
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
    p.stamp('turn-edits-sess', 1);     // nor is the turn check's edit list
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
        delete process.env.ALFRED_CODE_FRESH_SESSION_1M;
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
        // the documented auto-compact window lowers the window it is judged in: 500k is neither tier - the DEFAULT 300k
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '500000';
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 500000);
        assert.strictEqual(fresh.ctxThreshold(), 300000);
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
        const set = (file, json) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json)); };
        set(path.join(p.root, '.claude', 'settings.json'), { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 200000 } }, autoCompactWindow: 600000 });
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 200000, "a model's own entry wins over the file's top-level key");
        set(path.join(p.root, '.claude', 'settings.json'), { autoCompactWindow: 'auto' });
        set(path.join(BASE_ENV.CLAUDE_CONFIG_DIR, 'settings.json'), { autoCompactWindow: 500000 });
        fresh.use({ transcript_path: tp, cwd: p.root });
        assert.strictEqual(fresh.knownWindow(), 1000000, "'auto' is no window, and the USER file's top-level key does not reach Opus 5.5 (settings-reference)");
        set(path.join(BASE_ENV.CLAUDE_CONFIG_DIR, 'settings.json'), {});
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
