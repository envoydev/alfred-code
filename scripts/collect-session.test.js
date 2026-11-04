'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeSession, line } = require('./collect-fixture.js');
const { parseArgs, collect, scanTranscript, UsageError } = require('./collect-session.js');
const { STORES } = require('./collect-stores.js');
const { samePath } = require('./test-paths.js');

// One collect of a fixture session: into <root>/out unless args name --out, the fixture's temp dir searched unless
// args name --tmp (the real temp dir is never read), the fixture's isolated env and clock.
function attempt(fx, args = [], deps = {})
{
    const argv = [fx.transcript, ...args];
    if (!args.includes('--out')) argv.push('--out', fx.out);
    if (!args.includes('--tmp')) argv.push('--tmp', fx.tmp);
    try { return collect(parseArgs(argv), { env: fx.env, now: fx.now, ...deps }); }
    catch (e) { if (e instanceof UsageError) return { code: 2, message: e.message }; throw e; }
}
function run(fx, args = [], deps = {})
{
    const r = attempt(fx, args, deps);
    assert.strictEqual(r.code, 0, r.message);
    const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : fx.out;
    return JSON.parse(fs.readFileSync(path.join(out, 'collected.json'), 'utf8'));
}
// The store's primary row (a denied file adds a row of the same id after it).
const row = (rc, id) => rc.stores.find((s) => s.id === id);
function grepBundle(out, text)
{
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) =>
    {
        const full = path.join(dir, e.name);
        if (e.name.includes(text)) return true;
        if (e.isDirectory()) return walk(full);
        return e.isFile() && fs.readFileSync(full).includes(text);
    });
    return fs.existsSync(out) && walk(out);
}

test('copies the transcript, subagents and the sibling folder entry for entry', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const rc = run(fx);
    for (const f of [`${fx.sid}.jsonl`, 'subagents/agent-a1.jsonl', 'subagents/agent-a1.meta.json', 'tool-results/r1.txt', 'custom-title.json'])
        assert.ok(fs.existsSync(path.join(fx.out, f)), f);
    assert.strictEqual(fs.readFileSync(path.join(fx.out, `${fx.sid}.jsonl`), 'utf8'), fs.readFileSync(fx.transcript, 'utf8'));
    assert.strictEqual(rc.collector, 1);
    assert.strictEqual(rc.session, fx.sid);
    assert.deepStrictEqual(rc.window, { from: '2026-11-01T10:00:00.000Z', to: '2026-11-01T11:02:00.000Z' });
    assert.deepStrictEqual(rc.stores.map((s) => s.id).filter((id, i, a) => a.indexOf(id) === i), STORES.map((s) => s.id));
    assert.strictEqual(row(rc, 'transcript').status, 'copied');
    assert.strictEqual(row(rc, 'session-folder').status, 'copied');
    assert.ok(!grepBundle(fx.out, fx.otherSid), 'no file of the other session');
});

test('usage errors exit 2 and write nothing', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const o = fx.out;
    const tryArgv = (argv) =>
    {
        try { return collect(parseArgs(argv), { env: fx.env, now: fx.now }); }
        catch (e) { if (e instanceof UsageError) return { code: 2, message: e.message }; throw e; }
    };
    const garbage = fx.write('garbage/g.jsonl', 'not json\n{"type":"mode"}\n');
    const noCwd = fx.write('nocwd/n.jsonl', line({ type: 'user', timestamp: '2026-11-01T10:00:00.000Z', message: { content: 'x' } }));
    for (const argv of [[], [fx.transcript], [fx.transcript, '--out'], [fx.transcript, '--out', o, '--bogus'],
        [fx.transcript, '--out', o, '--text', 'all'], [path.join(fx.root, 'missing.jsonl'), '--out', o],
        [garbage, '--out', o], [noCwd, '--out', o]])
    {
        const r = tryArgv(argv);
        assert.strictEqual(r.code, 2, `${JSON.stringify(argv.map((a) => path.basename(String(a))))}: ${r.message}`);
        assert.ok(r.message, 'a message names the error');
        assert.ok(!fs.existsSync(o), `${argv.length} args: out not created`);
    }
    assert.match(tryArgv([garbage, '--out', o]).message, /no session rows/);
});

test('an --out inside the transcript\'s own <sid>/ folder is refused', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const inside = path.join(fx.folder, fx.sid, 'audit');
    const r = attempt(fx, ['--out', inside]);
    assert.strictEqual(r.code, 2);
    assert.ok(!fs.existsSync(inside));
    const beside = attempt(fx, ['--out', fx.folder]);
    assert.strictEqual(beside.code, 2, 'the transcript\'s own folder is refused too');
});

test('an --out holding another session\'s collected.json is refused', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.out, 'collected.json'), JSON.stringify({ collector: 1, session: fx.otherSid }));
    const r = attempt(fx);
    assert.strictEqual(r.code, 2);
    assert.deepStrictEqual(fs.readdirSync(fx.out), ['collected.json']);
});

test('the config dir comes from the transcript path', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const rc = run(fx, [], { env: { ...fx.env, CLAUDE_CONFIG_DIR: path.join(fx.root, 'elsewhere') } });
    assert.strictEqual(rc.configDir, fx.config);
});

test('the auditing env\'s ALFRED_CODE_DATA_PATH is ignored', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const rc = run(fx, [], { env: { ...fx.env, ALFRED_CODE_DATA_PATH: 'elsewhere' } });
    assert.strictEqual(rc.dataRoot, '.alfred');
    assert.strictEqual(rc.docsRoot, '.alfred/docs');
});

test('a custom data root in settings.json and an absolute --data-root are both taken', (t) =>
{
    const fx = makeSession({ dataPath: '.data' }); t.after(fx.cleanup);
    assert.strictEqual(run(fx).dataRoot, '.data');
    const abs = path.join(fx.root, 'scratch-data');
    fs.mkdirSync(abs);
    const rc = run(fx, ['--out', path.join(fx.root, 'out2'), '--data-root', abs]);
    // layout.js spells the setting with '/' on every OS, so the receipt's dataRoot is compared as one place
    assert.ok(samePath(rc.dataRoot, abs), `${rc.dataRoot} is ${abs}`);
    assert.strictEqual(rc.docsRoot, path.join(abs, 'docs'));
});

test('a transcript line longer than the 1 MB chunk is read whole', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const plan = path.join(fx.docsRoot, 'work', 'plans', 'big.md');
    const file = fx.write('big/b.jsonl', [
        line({ type: 'user', timestamp: '2026-11-01T10:00:00.000Z', cwd: fx.project, message: { content: 'go' } }),
        line({ type: 'assistant', timestamp: '2026-11-01T10:01:00.000Z', message: { content: [
            { type: 'text', text: 'x'.repeat(3 * 1048576) },
            { type: 'tool_use', id: 't9', name: 'Write', input: { file_path: plan, content: '#' } }] } }),
        line({ type: 'user', timestamp: '2026-11-01T10:02:00.000Z', message: { content: 'ok' } }),
    ].join(''));
    const s = scanTranscript(file, { fs });
    assert.strictEqual(s.rows, 3);
    assert.ok(s.written.has(plan));
    assert.strictEqual(s.cwd, fx.project);
    assert.strictEqual(s.lastTs, '2026-11-01T10:02:00.000Z');
});

test('a run killed before the receipt leaves the earlier collected.json intact', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    run(fx);
    const before = fs.readFileSync(path.join(fx.out, 'collected.json'));
    const dying = { ...fs, renameSync: (a, b) => { if (String(b).endsWith('collected.json')) throw new Error('killed'); return fs.renameSync(a, b); } };
    const r = attempt(fx, [], { fs: dying, now: fx.now + 1000 });
    assert.strictEqual(r.code, 2);
    assert.ok(before.equals(fs.readFileSync(path.join(fx.out, 'collected.json'))));
});

// ---- Task 3: stores in the data root found by name ----------------------------------------------------------------

test('name-matched stores take this session\'s files and no other session\'s', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const rc = run(fx);
    for (const id of ['hook-blocks', 'tools-usage', 'history', 'scorer', 'sessions:COMPACT-STATE-', 'sessions:AGENT-CAP-',
        'sessions:SCORER-', 'sessions:preferences-', 'forge:ACTS-', 'forge:PAUSE-', 'session-inspector'])
        assert.strictEqual(row(rc, id).status, 'copied', id);
    assert.strictEqual(row(rc, 'sessions:SCORER-').files, 2, 'SCORER- takes SCORER-HELD-');
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'sessions', 'scorer', fx.sid, 'draft.md')));
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'statistics', 'hook-blocks', `${fx.sid}.jsonl`)));
    assert.strictEqual(row(rc, 'hook-blocks').to, `data/statistics/hook-blocks/${fx.sid}.jsonl`);
    assert.strictEqual(row(rc, 'sessions:unlisted').status, 'absent');
    assert.ok(!grepBundle(fx.out, fx.otherSid), 'no file names the other session');
    assert.ok(!grepBundle(fx.out, 'OTHER'), 'no file holds the other session\'s content');
});

test('an entry naming the session under no listed prefix is taken as unlisted prefix', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    fx.write(path.join(fx.dataRoot, 'state', 'sessions', `NEWTHING-${fx.sid}`), 'new');
    fx.write(path.join(fx.dataRoot, 'state', 'forge', `ODD-${fx.sid}.json`), 'odd');
    const rc = run(fx);
    const r = row(rc, 'sessions:unlisted');
    assert.strictEqual(r.status, 'copied');
    assert.strictEqual(r.why, 'unlisted prefix');
    assert.strictEqual(r.files, 1);
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'sessions', `NEWTHING-${fx.sid}`)));
    assert.strictEqual(row(rc, 'forge:unlisted').status, 'copied');
});

test('a ledger in its pre-2.8.0 docs-root home is taken and marked legacy home', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'hook-blocks', `${fx.sid}.jsonl`), line({ session: fx.sid, hook: 'x' }));
    const rc = run(fx);
    const r = row(rc, 'hook-blocks');
    assert.strictEqual(r.status, 'copied');
    assert.strictEqual(r.why, 'legacy home');
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'statistics', 'hook-blocks', `${fx.sid}.jsonl`)));
});

test('tools-usage: instrumentation off, a per-agent file, a redirected log', (t) =>
{
    const off = makeSession({ instrument: '0' }); t.after(off.cleanup);
    const r0 = row(run(off), 'tools-usage');
    assert.strictEqual(r0.status, 'absent');
    assert.strictEqual(r0.why, 'instrumentation off');

    const agent = makeSession({ stores: true }); t.after(agent.cleanup);
    agent.write(path.join(agent.dataRoot, 'statistics', 'tools-usage', 'a1.jsonl'), line({ session: agent.sid, agent_id: 'a1', tool: 'Grep' }));
    const r1 = row(run(agent), 'tools-usage');
    assert.strictEqual(r1.status, 'copied');
    assert.strictEqual(r1.files, 2);
    assert.ok(fs.existsSync(path.join(agent.out, 'data', 'statistics', 'tools-usage', 'a1.jsonl')));

    const red = makeSession({}); t.after(red.cleanup);
    const log = red.write('shared/usage.jsonl', [
        line({ session: red.sid, tool: 'Read' }), line({ session: red.otherSid, tool: 'Read', detail: 'OTHER' }),
        line({ session: red.sid, tool: 'Bash' }), 'torn{', ''].join(''));
    red.write(path.join(red.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_INSTRUMENT_LOG: log } }));
    const r2 = row(run(red), 'tools-usage');
    assert.strictEqual(r2.status, 'filtered');
    assert.strictEqual(r2.matched, 'redirect');
    assert.strictEqual(r2.rows, 2);
    assert.ok(!grepBundle(red.out, 'OTHER'));
    assert.strictEqual(fs.readFileSync(log, 'utf8').split('\n').length, 4, 'the redirected log is left as it was');
});

test('the session-inspector status file lands in context/', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    run(fx);
    const got = JSON.parse(fs.readFileSync(path.join(fx.out, 'context', 'session-inspector-status.json'), 'utf8'));
    assert.strictEqual(got.session, fx.sid);
});

test('no data root and an empty one', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fs.rmSync(fx.dataRoot, { recursive: true, force: true });
    const rc = run(fx);
    assert.ok(fs.existsSync(path.join(fx.out, `${fx.sid}.jsonl`)));
    const dataRows = rc.stores.filter((s) => /^(hook-blocks|tools-usage|history|scorer|sessions:|forge:)/.test(s.id));
    assert.ok(dataRows.length >= 20, `${dataRows.length} data-root rows`);
    for (const s of dataRows)
    {
        assert.strictEqual(s.status, 'absent', s.id);
        assert.strictEqual(s.why, `no data root: ${fx.dataRoot}`, s.id);
    }
    fs.mkdirSync(fx.dataRoot);
    const rc2 = run(fx, ['--out', path.join(fx.root, 'out2')]);
    for (const s of rc2.stores.filter((x) => /^(hook-blocks|history|scorer|sessions:|forge:)/.test(x.id)))
        assert.strictEqual(s.why, 'not written', s.id);
});

test('the untracked pointer brings the untracked-at-start record it names', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const sessions = path.join(fx.dataRoot, 'state', 'sessions');
    let r = row(run(fx), 'sessions:untracked-');
    assert.strictEqual(r.files, 2);
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'sessions', 'untracked-at-start-abc123')));
    assert.ok(!fs.existsSync(path.join(fx.out, 'data', 'state', 'sessions', 'untracked-at-start-def456')));
    fs.writeFileSync(path.join(sessions, `untracked-session-${fx.sid}`), '../x');
    fx.write(path.join(fx.dataRoot, 'state', 'x'), 'outside');
    r = row(run(fx, ['--out', path.join(fx.root, 'out2')]), 'sessions:untracked-');
    assert.strictEqual(r.files, 1, 'a pointer naming a path outside the folder brings the pointer alone');
    fs.writeFileSync(path.join(sessions, `untracked-session-${fx.sid}`), 'untracked-at-start-missing');
    r = row(run(fx, ['--out', path.join(fx.root, 'out3')]), 'sessions:untracked-');
    assert.strictEqual(r.files, 1, 'a pointer naming a missing record brings the pointer alone');
});

test('a pruned history reads pruned', (t) =>
{
    const history = (fx, n) =>
    {
        const dir = path.join(fx.dataRoot, 'state', 'history');
        fs.mkdirSync(dir, { recursive: true });
        const when = new Date(fx.lastMs + 1000);
        for (let i = 0; i < n; i++)
        {
            const f = path.join(dir, `other-${i}.json`);
            fs.writeFileSync(f, '{}');
            fs.utimesSync(f, when, when);
        }
    };
    const at199 = makeSession({}); t.after(at199.cleanup);
    history(at199, 199);
    assert.strictEqual(row(run(at199), 'history').why, 'not written');
    const at200 = makeSession({}); t.after(at200.cleanup);
    history(at200, 200);
    assert.strictEqual(row(run(at200), 'history').why, 'pruned');
    const DAYS_180 = 15552000000;
    const old = makeSession({ lastRowAgeMs: DAYS_180 }); t.after(old.cleanup);
    assert.strictEqual(row(run(old), 'history').why, 'not written');
    const older = makeSession({ lastRowAgeMs: DAYS_180 + 1000 }); t.after(older.cleanup);
    assert.strictEqual(row(run(older), 'history').why, 'pruned');
});

// ---- Task 4: stores under another root - forge, preferences, handoff - and approvals ------------------------------

const { execFileSync } = require('node:child_process');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

test('a linked-worktree session finds forge and handoff under the main checkout', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    git(fx.project, 'init', '-q');
    git(fx.project, 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = path.join(fx.root, 'wt');
    git(fx.project, 'worktree', 'add', '-q', wt);
    // an installed main checkout: handoff.js puts the store under the main checkout only when it holds a record
    fx.write(path.join(fx.project, '.claude', 'alfred-code.stamp'), 'version: 3.8.0\n');
    fx.write(path.join(fx.dataRoot, 'state', 'forge', `ACTS-${fx.sid}.jsonl`), line({ session: fx.sid, act: 'push' }));
    fx.write(path.join(fx.dataRoot, 'state', 'handoff', 'feat.jsonl'), line({ name: 'feat/1/seat', text: 'note', at: '2026-11-01T10:30:00.000Z' }));
    const rc = run(fx, ['--project', wt]);
    const main = fs.realpathSync.native(fx.project);
    for (const id of ['forge:ACTS-', 'handoff'])
    {
        assert.ok(['copied', 'filtered'].includes(row(rc, id).status), `${id}: ${row(rc, id).status}`);
        assert.strictEqual(row(rc, id).root, main, id);
    }
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'forge', `ACTS-${fx.sid}.jsonl`)));
});

test('preferences records are found under the first checkout holding the preferences folder', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    git(fx.project, 'init', '-q');
    const pkg = path.join(fx.project, 'pkg');
    fs.mkdirSync(pkg);
    fx.write(path.join(fx.docsRoot, 'preferences', 'tools.md'), '# tools');
    fx.write(path.join(fx.dataRoot, 'state', 'sessions', `preferences-${fx.sid}-main.json`), '{"marks":[]}');
    fx.write(path.join(fx.dataRoot, '.variables'), 'ALFRED_CODE_TURN_CHECK=1\n');
    const before = { ...process.env };
    const rc = run(fx, ['--project', pkg]);
    assert.deepStrictEqual({ ...process.env }, before, 'loading the prelude left the collector\'s env as it was');
    const r = row(rc, 'sessions:preferences-');
    assert.strictEqual(r.status, 'copied');
    assert.strictEqual(r.root, fs.realpathSync.native(fx.project));
});

test('approvals are taken by their session line', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const approvals = path.join(fx.dataRoot, 'state', 'approvals');
    fx.write(path.join(approvals, 'COMMIT-GATE'), `VERIFIED review-code\nsession: ${fx.sid}\n`);
    fx.write(path.join(approvals, 'plans', 'p1', 'APPROVAL'), `APPROVED\nsession: ${fx.otherSid}\n`);
    fx.write(path.join(approvals, 'NOTE'), `see session: ${fx.sid} above\n`);
    const rc = run(fx);
    const r = row(rc, 'approvals');
    assert.strictEqual(r.status, 'copied');
    assert.strictEqual(r.files, 1);
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'approvals', 'COMMIT-GATE')));
    assert.ok(!grepBundle(fx.out, fx.otherSid));
});

test('handoff rows are taken inside the window, with the overlap count', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fs.rmSync(path.join(fx.folder, `${fx.otherSid}.jsonl`));
    const iso = (ms) => new Date(ms).toISOString();
    const note = (ms, text) => line({ name: 'feat/1/seat', text, at: iso(ms) });
    fx.write(path.join(fx.dataRoot, 'state', 'handoff', 'feat.jsonl'), [
        note(fx.firstMs, 'in-first'), note(fx.firstMs - 1000, 'out-before'), note(fx.lastMs + 120000, 'in-tail'),
        note(fx.lastMs + 119000, 'in-tail-under'), note(fx.lastMs + 121000, 'out-after')].join(''));
    // a transcript in another projects/* folder spanning the window, its head and tail lines carrying no timestamp
    fx.write(path.join(fx.config, 'projects', '-elsewhere', 'x.jsonl'), [
        line({ type: 'last-prompt', lastPrompt: 'x' }), line({ type: 'user', timestamp: iso(fx.firstMs - 3600000), message: { content: 'a' } }),
        line({ type: 'user', timestamp: iso(fx.lastMs + 3600000), message: { content: 'b' } }), line({ type: 'bridge-session' })].join(''));
    // and one wholly before the window
    fx.write(path.join(fx.config, 'projects', '-elsewhere', 'y.jsonl'),
        line({ type: 'user', timestamp: iso(fx.firstMs - 7200000), message: { content: 'a' } }));
    const r = row(run(fx), 'handoff');
    assert.strictEqual(r.status, 'filtered');
    assert.strictEqual(r.matched, 'window');
    assert.strictEqual(r.rows, 3);
    assert.strictEqual(r.overlap, 1);
    const body = fs.readFileSync(path.join(fx.out, 'data', 'state', 'handoff', 'feat.jsonl'), 'utf8');
    assert.deepStrictEqual(body.trim().split('\n').map((l) => JSON.parse(l).text), ['in-first', 'in-tail', 'in-tail-under']);
});

test('requireQuiet puts back every env key a module sets or changes on load', (t) =>
{
    const { requireQuiet } = require('./collect-stores.js');
    const fx = makeSession({}); t.after(fx.cleanup);
    const probe = fx.write('probe/env-probe.js', "process.env.COLLECT_QUIET_ADDED = '1'; process.env.COLLECT_QUIET_CHANGED = 'after'; module.exports = 7;\n");
    process.env.COLLECT_QUIET_CHANGED = 'before';
    t.after(() => { delete process.env.COLLECT_QUIET_CHANGED; delete process.env.COLLECT_QUIET_ADDED; });
    assert.strictEqual(requireQuiet(probe), 7);
    assert.strictEqual(process.env.COLLECT_QUIET_ADDED, undefined);
    assert.strictEqual(process.env.COLLECT_QUIET_CHANGED, 'before');
});

// ---- Task 5: shared stores by row, the whole stores, context.json --------------------------------------------------

test('docs-log keeps the session\'s rows, streamed, a torn line counted', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const rows = [];
    let size = 0;
    let ours = 0;
    // fill to just under 1 MB, then one row straddling the 1 MB boundary, then fill past 2.5 MB
    const add = (o) => { const l = line(o); rows.push(l); size += Buffer.byteLength(l); };
    for (let i = 0; size < 1048576 - 2000; i++)
    {
        const mine = i % 3 === 0;
        if (mine) ours += 1;
        add({ at: '2026-11-01T10:10:00.000Z', session: mine ? fx.sid : fx.otherSid, event: 'write', target: `docs/f${i}.md`, pad: 'p'.repeat(200) });
    }
    add({ at: '2026-11-01T10:20:00.000Z', session: fx.sid, event: 'straddle', target: 'docs/straddle.md', pad: 'q'.repeat(5000) });
    ours += 1;
    for (let i = 0; size < 2.5 * 1048576; i++)
    {
        const mine = i % 4 === 0;
        if (mine) ours += 1;
        add({ at: '2026-11-01T10:30:00.000Z', session: mine ? fx.sid : fx.otherSid, event: 'read', target: `docs/g${i}.md`, pad: 'r'.repeat(300) });
    }
    fx.write(path.join(fx.dataRoot, 'statistics', 'docs-log.jsonl'), rows.join('') + '{"at":"torn');
    const r = row(run(fx), 'docs-log');
    assert.strictEqual(r.status, 'filtered');
    assert.strictEqual(r.matched, 'row');
    assert.strictEqual(r.rows, ours);
    assert.strictEqual(r.torn, 1);
    const body = fs.readFileSync(path.join(fx.out, 'data', 'statistics', 'docs-log.jsonl'), 'utf8');
    assert.ok(body.includes('"event":"straddle"'));
    assert.ok(!body.includes(fx.otherSid));
});

test('compact-points and models keep the session\'s entries; garbage reads unreadable', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const sessions = path.join(fx.dataRoot, 'state', 'sessions');
    const point = (s, tokens) => ({ at: '2026-11-01T10:40:00.000Z', session: s, model: 'claude-opus-5-5', tokens });
    fx.write(path.join(sessions, 'compact-points.json'), JSON.stringify([point(fx.sid, 150000), point(fx.otherSid, 160000), point(fx.sid, 170000)], null, 1));
    fx.write(path.join(sessions, 'models.json'), JSON.stringify({ [fx.sid]: { model: 'claude-opus-5-5', at: '2026-11-01T10:00:00.000Z' }, [fx.otherSid]: { model: 'claude-sonnet-5-5', at: '2026-11-01T10:00:00.000Z' } }, null, 1));
    const rc = run(fx);
    const cp = row(rc, 'compact-points');
    assert.strictEqual(cp.status, 'filtered');
    assert.strictEqual(cp.rows, 2);
    const points = JSON.parse(fs.readFileSync(path.join(fx.out, 'data', 'state', 'sessions', 'compact-points.json'), 'utf8'));
    assert.deepStrictEqual(points.map((p) => p.session), [fx.sid, fx.sid]);
    const models = JSON.parse(fs.readFileSync(path.join(fx.out, 'data', 'state', 'sessions', 'models.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(models), [fx.sid]);
    assert.strictEqual(row(rc, 'models').status, 'filtered');
    fs.writeFileSync(path.join(sessions, 'models.json'), 'not json');
    const r = attempt(fx, ['--out', path.join(fx.root, 'out2')]);
    assert.strictEqual(r.code, 0);
    const m = row(r.receipt, 'models');
    assert.strictEqual(m.status, 'unreadable');
    assert.match(m.why, /JSON/);
});

test('compact-points trimmed and aged out', (t) =>
{
    const DAY = 86400000;
    const point = (s, i) => ({ at: '2026-11-01T10:40:00.000Z', session: s, model: 'm', tokens: 100000 + i });
    const others = (n) => Array.from({ length: n }, (_, i) => point(`other-${i}`, i));
    const plant = (fx, rows) => fx.write(path.join(fx.dataRoot, 'state', 'sessions', 'compact-points.json'), JSON.stringify(rows, null, 1));
    const fx40 = makeSession({}); t.after(fx40.cleanup);
    plant(fx40, others(40));
    assert.strictEqual(row(run(fx40), 'compact-points').why, 'trimmed');
    const fx39 = makeSession({}); t.after(fx39.cleanup);
    plant(fx39, others(39));
    assert.strictEqual(row(run(fx39), 'compact-points').why, 'not written');
    for (const [age, want] of [[30 * DAY, 'not written'], [30 * DAY + 1000, 'aged out'], [30 * DAY - 1000, 'not written']])
    {
        const fx = makeSession({ lastRowAgeMs: age }); t.after(fx.cleanup);
        plant(fx, others(3));
        assert.strictEqual(row(run(fx), 'compact-points').why, want, `last row ${age} ms old`);
    }
});

test('the whole stores are read at collect time', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.project, '.claude', 'alfred-code.stamp'), 'version: 3.8.0\n');
    fx.write(path.join(fx.dataRoot, 'workspace'), 'members: []\n');
    fx.write(path.join(fx.dataRoot, 'state', 'tools-inventory.json'), '{"tools":[]}');
    const rc = run(fx);
    for (const [id, to] of [['stamp', 'context/alfred-code.stamp'], ['workspace', 'context/workspace'], ['tools-inventory', 'data/state/tools-inventory.json']])
    {
        assert.strictEqual(row(rc, id).status, 'copied', id);
        assert.strictEqual(row(rc, id).why, 'read at collect time', id);
        assert.ok(fs.existsSync(path.join(fx.out, ...to.split('/'))), to);
    }
    assert.strictEqual(row(rc, 'lsp-coverage').status, 'absent');
});

test('context.json carries the files\' catalog variables and the session\'s plugins, no other key', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_TURN_CHECK: '1', OTHER_TOKEN: 'marker-value' } }));
    fx.write(path.join(fx.config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
        'alfred-code@envoydev': [{ scope: 'user', version: '3.8.0', installPath: '/x' }],
        'lib@envoydev': [{ scope: 'project', projectPath: fx.project, version: '1.0.0' }, { scope: 'project', projectPath: path.join(fx.root, 'another'), version: '0.9.0' }],
    } }));
    run(fx);
    const c = JSON.parse(fs.readFileSync(path.join(fx.out, 'context.json'), 'utf8'));
    assert.strictEqual(c.variables.ALFRED_CODE_TURN_CHECK.value, '1');
    assert.ok(c.variables.ALFRED_CODE_TURN_CHECK.from);
    assert.ok(!('OTHER_TOKEN' in c.variables));
    assert.deepStrictEqual(c.plugins.map((p) => `${p.id} ${p.scope} ${p.version}`).sort(), ['alfred-code@envoydev user 3.8.0', 'lib@envoydev project 1.0.0']);
    assert.ok(!grepBundle(fx.out, 'marker-value'));
});

test('context.json is written with no data root', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fs.rmSync(fx.dataRoot, { recursive: true, force: true });
    const rc = run(fx);
    assert.ok(fs.existsSync(path.join(fx.out, 'context.json')));
    assert.strictEqual(row(rc, 'context').status, 'copied');
});

// Task 6 - docs, temp files and the privacy rules.
const MB = 1048576;
const skipped = (rc, id) => rc.stores.filter((s, i) => s.id === id && rc.stores.findIndex((x) => x.id === id) !== i);
// One docs-log row of the session naming project-relative paths.
function docsLog(fx, fields)
{
    const file = path.join(fx.dataRoot, 'statistics', 'docs-log.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line({ at: new Date(fx.firstMs + 20000).toISOString(), session: fx.sid, event: 'ask-update', ...fields }));
}
const projectRel = (fx, file) => path.relative(fx.project, file).split(path.sep).join('/');
// A link, or a skip where this machine cannot make one (a Windows account without the right).
function link(t, target, at, dir)
{
    try { fs.symlinkSync(target, at, dir ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'); return true; }
    catch (e) { t.skip(`no symlink here: ${e.code}`); return false; }
}

test('docs the session wrote are copied, capped at 1 MB a file and 20 MB in all', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'work', 'plans', 'p.md'), '# plan');
    const sized = { 'a-under.md': MB - 1, 'b-at.md': MB, 'c-over.md': MB + 1 };
    for (const [name, size] of Object.entries(sized)) fx.write(path.join(fx.docsRoot, 'work', name), 'x'.repeat(size));
    fx.write(path.join(fx.docsRoot, 'work', 'logged.md'), 'logged');
    fx.write(path.join(fx.project, 'src', 'app.js'), 'code');
    docsLog(fx, { files: [...Object.keys(sized).map((n) => projectRel(fx, path.join(fx.docsRoot, 'work', n))), 'src/app.js'], refs: ['work/a-under'] });
    docsLog(fx, { event: 'stamped-plan', target: projectRel(fx, path.join(fx.docsRoot, 'work', 'logged.md')) });
    const rc = run(fx);
    for (const f of ['docs/work/plans/p.md', 'docs/work/a-under.md', 'docs/work/b-at.md', 'docs/work/logged.md'])
        assert.ok(fs.existsSync(path.join(fx.out, f)), f);
    assert.ok(!fs.existsSync(path.join(fx.out, 'docs', 'work', 'c-over.md')));
    assert.ok(!grepBundle(fx.out, 'app.js') || !fs.existsSync(path.join(fx.out, 'docs', 'src')), 'no path outside the docs root');
    assert.strictEqual(row(rc, 'docs').status, 'copied');
    assert.strictEqual(row(rc, 'docs').matched, 'docs');
    assert.deepStrictEqual(skipped(rc, 'docs').map((s) => [s.status, s.file]), [['capped', 'docs/work/c-over.md']]);
    assert.match(skipped(rc, 'docs')[0].why, /1 MB a file/);

    const fx2 = makeSession({}); t.after(fx2.cleanup);
    const names = Array.from({ length: 21 }, (_, i) => `big-${String(i).padStart(2, '0')}.md`);
    for (const n of names) fx2.write(path.join(fx2.docsRoot, 'work', n), 'y'.repeat(MB));
    docsLog(fx2, { files: names.map((n) => projectRel(fx2, path.join(fx2.docsRoot, 'work', n))) });
    const rc2 = run(fx2);
    assert.strictEqual(row(rc2, 'docs').files, 20);
    assert.strictEqual(row(rc2, 'docs').bytes, 20 * MB);
    assert.ok(fs.existsSync(path.join(fx2.out, 'docs', 'work', 'big-19.md')));
    assert.ok(!fs.existsSync(path.join(fx2.out, 'docs', 'work', 'big-20.md')));
    assert.deepStrictEqual(skipped(rc2, 'docs').map((s) => [s.status, s.file]), [['capped', 'docs/work/big-20.md']]);
    assert.match(skipped(rc2, 'docs')[0].why, /20 MB in all/);
});

test('a credentials file, a secret-binding doc and a credential-shaped doc are denied, never copied', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    // Built from parts, so no credential-shaped literal sits in this file.
    const shaped = 'gh' + 'p_' + 'A1b2'.repeat(9);
    const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
    const docs = {
        'credentials.local.env': 'A=b\n',
        'notes.md': '# notes\nAPI_TOKEN=abcd1234\n',
        't.md': `the token ${shaped} leaked\n`,
        'k.md': `${pem}\nMIIE\n`,
        'pw.md': 'db:\n  password: hunter2\n',
        'ok.md': 'key: value\n"apiKey": "ALFRED_CODE_X"\nPASSWORD=\n"next": "line"\nMY_KEY=abc\n',
    };
    for (const [name, text] of Object.entries(docs)) fx.write(path.join(fx.docsRoot, name), text);
    docsLog(fx, { files: Object.keys(docs).map((n) => projectRel(fx, path.join(fx.docsRoot, n))) });
    const rc = run(fx);
    assert.ok(fs.existsSync(path.join(fx.out, 'docs', 'ok.md')));
    for (const name of ['credentials.local.env', 'notes.md', 't.md', 'k.md', 'pw.md']) assert.ok(!fs.existsSync(path.join(fx.out, 'docs', name)), name);
    assert.deepStrictEqual(skipped(rc, 'docs').map((s) => [s.status, s.file, s.why]), [
        ['denied', 'docs/credentials.local.env', 'never copied: *.env'],
        ['denied', 'docs/k.md', 'private key'],
        ['denied', 'docs/notes.md', 'secret key API_TOKEN'],
        ['denied', 'docs/pw.md', 'secret key password'],
        ['denied', 'docs/t.md', 'credential shape'],
    ]);
    for (const value of ['abcd1234', shaped, 'MIIE', 'hunter2']) assert.ok(!grepBundle(fx.out, value), 'no value in the bundle');
});

test('the .secrets marker reaches no bundle file in either mode', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    fx.write(path.join(fx.dataRoot, '.secrets'), 'K=marker-q7\n');
    fx.write(path.join(fx.dataRoot, 'state', 'sessions', 'scorer', fx.sid, '.secrets'), 'K=marker-q7\n');
    for (const mode of ['copy', 'withhold'])
    {
        const out = path.join(fx.root, `out-${mode}`);
        const rc = run(fx, ['--out', out, '--text', mode]);
        assert.ok(!grepBundle(out, 'marker-q7'), mode);
        if (mode === 'copy')
        {
            assert.ok(fs.existsSync(path.join(out, 'data', 'state', 'sessions', 'scorer', fx.sid, 'draft.md')));
            assert.deepStrictEqual(skipped(rc, 'scorer').map((s) => [s.status, s.file, s.why]),
                [['denied', `data/state/sessions/scorer/${fx.sid}/.secrets`, 'never copied: .secrets']]);
        }
    }
});

test('a symlink is never followed', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const outside = fx.write('outside/secret.txt', 'outside-q8');
    const autoRun = path.join(fx.dataRoot, 'state', 'sessions', `AUTO-RUN-${fx.sid}`);
    fs.rmSync(autoRun);
    if (!link(t, outside, autoRun, false)) return;
    link(t, path.dirname(outside), path.join(fx.dataRoot, 'state', 'sessions', 'scorer', fx.sid, 'linked'), true);
    // A docs path whose parent folder is a link resolves outside the docs root.
    fx.write('elsewhere/x.md', 'elsewhere-q9');
    fs.mkdirSync(path.join(fx.docsRoot, 'work'), { recursive: true });
    link(t, path.join(fx.root, 'elsewhere'), path.join(fx.docsRoot, 'work', 'linked'), true);
    docsLog(fx, { files: [projectRel(fx, path.join(fx.docsRoot, 'work', 'linked', 'x.md'))] });
    const rc = run(fx);
    assert.strictEqual(row(rc, 'sessions:AUTO-RUN-').status, 'denied');
    assert.deepStrictEqual(skipped(rc, 'sessions:AUTO-RUN-').map((s) => [s.status, s.file, s.why]),
        [['denied', `data/state/sessions/AUTO-RUN-${fx.sid}`, 'symlink']]);
    assert.deepStrictEqual(skipped(rc, 'scorer').map((s) => [s.status, s.file, s.why]),
        [['denied', `data/state/sessions/scorer/${fx.sid}/linked`, 'symlink']]);
    assert.deepStrictEqual(skipped(rc, 'docs').map((s) => [s.status, s.file, s.why]),
        [['denied', 'docs/work/linked/x.md', 'outside its root']]);
    assert.ok(!grepBundle(fx.out, 'outside-q8'));
    assert.ok(!grepBundle(fx.out, 'elsewhere-q9'));
});

test('temp files naming the session or its transcript key are taken; none -> no temp file', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const tmpA = path.join(fx.root, 'tmpA');
    const key = fx.transcript.replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
    fx.write(path.join(tmpA, `alfred-bg-note-${fx.sid}-main`), 'note');
    fx.write(path.join(fx.tmp, `guard-fresh-compact-${key}.hold`), 'hold');
    fx.write(path.join(fx.tmp, `guard-read-${fx.sid}`), 'API_TOKEN=abcd1234\n');
    fx.write(path.join(fx.tmp, 'docs-session-x'), fx.sid);
    fx.write(path.join(fx.tmp, `alfred-v8-a-${fx.sid}.bin`), 'bin');
    fx.write(path.join(fx.tmp, 'guard-stop-contract.log'), `${fx.sid}\n`);
    fx.write(path.join(fx.tmp, `alfred-bg-note-${fx.otherSid}-main`), 'other');
    fx.write(path.join(fx.tmp, `unrelated-${fx.sid}`), 'unrelated');
    const rc = run(fx, ['--tmp', tmpA, '--tmp', fx.tmp]);
    const tmpRow = row(rc, 'tmp');
    assert.strictEqual(tmpRow.status, 'copied');
    assert.strictEqual(tmpRow.matched, 'tmp');
    assert.deepStrictEqual(fs.readdirSync(path.join(fx.out, 'tmp')).sort(), [`alfred-bg-note-${fx.sid}-main`, `guard-fresh-compact-${key}.hold`].sort());
    assert.deepStrictEqual(skipped(rc, 'tmp').map((s) => [s.status, s.file, s.why]), [['denied', `tmp/guard-read-${fx.sid}`, 'secret key API_TOKEN']]);

    const fx2 = makeSession({}); t.after(fx2.cleanup);
    const empty = path.join(fx2.root, 'empty');
    fs.mkdirSync(empty);
    const rc2 = run(fx2, ['--tmp', empty, '--tmp', fx2.tmp]);
    assert.strictEqual(row(rc2, 'tmp').status, 'absent');
    assert.match(row(rc2, 'tmp').why, /^no temp file/);
    for (const part of [empty, fx2.tmp, '--tmp']) assert.ok(row(rc2, 'tmp').why.includes(part), part);
});

// Task 7 - the gate, withhold, swept, re-run and the top-level copies.
const crypto = require('node:crypto');
// Every file under `dir` but the ones `skip` names, as 'path sha1' lines.
function treeHash(dir, skip = [])
{
    const lines = [];
    const walk = (at) =>
    {
        for (const e of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const full = path.join(at, e.name);
            const rel = path.relative(dir, full).split(path.sep).join('/');
            if (skip.includes(rel)) continue;
            if (e.isDirectory()) { lines.push(`${rel}/`); walk(full); }
            else lines.push(`${rel} ${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}`);
        }
    };
    walk(dir);
    return lines;
}
const isEmptyOrGone = (dir) => !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
const TEXT_ROWS = () => STORES.filter((s) => s.cls === 'text').map((s) => s.id);

test('the gate: not ignored refuses, allow-tracked writes, ignored writes, outside a repo writes', (t) =>
{
    const fx = makeSession({ git: true }); t.after(fx.cleanup);
    const out = path.join(fx.project, 'bundles', 's1');
    const r = attempt(fx, ['--out', out]);
    assert.strictEqual(r.code, 2);
    assert.ok(isEmptyOrGone(out), 'nothing written');
    assert.match(r.message, new RegExp(`bundles/s1/${fx.sid}\\.jsonl`));
    assert.match(r.message, /--allow-tracked/);
    assert.match(r.message, /ignore/);
    assert.strictEqual(run(fx, ['--out', out, '--allow-tracked']).gate, 'allow-tracked');

    const fx2 = makeSession({ git: true, gitignore: 'bundles/\n' }); t.after(fx2.cleanup);
    assert.strictEqual(run(fx2, ['--out', path.join(fx2.project, 'bundles', 's1')]).gate, 'ignored');
    assert.strictEqual(run(fx2).gate, 'no work tree');
});

test('the gate: a failed check-ignore refuses, and --allow-tracked still writes', () =>
{
    const { gate } = require('./collect-privacy.js');
    const failing = (_cmd, args) =>
    {
        if (args.includes('rev-parse')) return Buffer.from(process.cwd() + '\n');
        throw Object.assign(new Error('fatal'), { status: 128, stderr: Buffer.from('fatal: broken index\n') });
    };
    const refused = gate(path.join(process.cwd(), 'b'), ['x.jsonl'], { execFileSync: failing });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.why, /check-ignore failed \(fatal: broken index\)/);
    assert.deepStrictEqual(gate(path.join(process.cwd(), 'b'), ['x.jsonl'], { execFileSync: failing, allowTracked: true }), { ok: true, why: 'allow-tracked' });
    const missing = () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }); };
    assert.deepStrictEqual(gate(process.cwd(), ['x'], { execFileSync: missing }), { ok: true, why: 'git not found' });
    // the real route: a git no PATH entry holds fails to start
    assert.deepStrictEqual(gate(process.cwd(), ['x'], { env: { PATH: path.join(process.cwd(), 'no-such-bin') } }), { ok: true, why: 'git not found' });
});

test('an ignore rule for *.jsonl alone refuses a bundle holding docs', (t) =>
{
    const fx = makeSession({ git: true, gitignore: '*.jsonl\n' }); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'work', 'plans', 'p.md'), '# plan');
    const r = attempt(fx, ['--out', path.join(fx.project, 'bundles', 's1')]);
    assert.strictEqual(r.code, 2);
    assert.doesNotMatch(r.message, /\.jsonl - /);
});

test('the gate compares real paths through a symlinked temp root', (t) =>
{
    const fx = makeSession({ git: true, gitignore: 'bundles/\n' }); t.after(fx.cleanup);
    const via = path.join(fx.root, 'via');
    if (!link(t, fx.project, via, true)) return;
    const rc = run(fx, ['--out', path.join(via, 'bundles', 's1')]);
    assert.strictEqual(rc.gate, 'ignored');
});

test('the gate names a path with a space and an apostrophe', (t) =>
{
    const fx = makeSession({ git: true, gitignore: 'bundle dir/\n' }); t.after(fx.cleanup);
    assert.strictEqual(run(fx, ['--out', path.join(fx.project, 'bundle dir', 'it\'s')]).gate, 'ignored');
    const r = attempt(fx, ['--out', path.join(fx.project, 'other dir', 'it\'s')]);
    assert.strictEqual(r.code, 2);
    assert.ok(r.message.includes(`other dir/it's/${fx.sid}.jsonl`), r.message);
});

test('withhold writes no text path and passes the gate', (t) =>
{
    const fx = makeSession({ git: true, stores: true }); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'work', 'plans', 'p.md'), '# plan');
    fx.write(path.join(fx.tmp, `alfred-bg-note-${fx.sid}-main`), 'note');
    const out = path.join(fx.project, 'bundles', 'w');
    const rc = run(fx, ['--out', out, '--text', 'withhold']);
    assert.strictEqual(rc.gate, 'withhold');
    for (const id of ['transcript', 'subagents', 'session-folder', 'history', 'scorer', 'docs', 'tmp', 'forge:ACTS-'])
    {
        const r = row(rc, id);
        assert.strictEqual(r.status, 'withheld', id);
        assert.ok(r.files > 0 && r.bytes > 0, id);
    }
    for (const id of TEXT_ROWS()) assert.notStrictEqual(row(rc, id).status, 'copied', id);
    for (const p of [`${fx.sid}.jsonl`, 'subagents', 'docs', 'tmp', 'tool-results', 'custom-title.json']) assert.ok(!fs.existsSync(path.join(out, p)), p);
    assert.ok(fs.existsSync(path.join(out, 'data', 'statistics', 'hook-blocks', `${fx.sid}.jsonl`)), 'meta is written');
    assert.ok(!grepBundle(out, 'draft'));
});

test('swept: a session store older than 7 days', (t) =>
{
    const DAY = 86400000;
    const at7 = makeSession({ lastRowAgeMs: 7 * DAY }); t.after(at7.cleanup);
    const past = makeSession({ lastRowAgeMs: 7 * DAY + 1000 }); t.after(past.cleanup);
    const rcAt = run(at7);
    const rcPast = run(past);
    for (const id of ['sessions:COMPACT-STATE-', 'scorer', 'forge:ACTS-'])
    {
        assert.deepStrictEqual([row(rcAt, id).status, row(rcAt, id).why], ['absent', 'not written'], id);
        assert.deepStrictEqual([row(rcPast, id).status, row(rcPast, id).why], ['absent', 'swept'], id);
    }
    assert.strictEqual(row(rcPast, 'tmp').why, 'swept');
    assert.strictEqual(row(rcPast, 'history').why, 'not written', 'history is pruned, never swept');
});

test('a second run over unchanged inputs is byte-identical but collectedAt', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'work', 'plans', 'p.md'), '# plan');
    fx.write(path.join(fx.tmp, `alfred-bg-note-${fx.sid}-main`), 'note');
    const first = run(fx);
    const before = treeHash(fx.out, ['collected.json']);
    const second = run(fx, [], { now: fx.now + 5000 });
    assert.deepStrictEqual(treeHash(fx.out, ['collected.json']), before);
    assert.notStrictEqual(second.collectedAt, first.collectedAt);
    assert.deepStrictEqual({ ...second, collectedAt: 0 }, { ...first, collectedAt: 0 });
    // The second copies at the bundle's top are plain files holding the ledgers' bytes.
    for (const [top, data] of [[`hook-blocks-${fx.sid}.jsonl`, `data/statistics/hook-blocks/${fx.sid}.jsonl`], [`tool-usage-${fx.sid}.jsonl`, `data/statistics/tools-usage/${fx.sid}.jsonl`]])
    {
        assert.ok(!fs.lstatSync(path.join(fx.out, top)).isSymbolicLink(), top);
        assert.strictEqual(fs.readFileSync(path.join(fx.out, top), 'utf8'), fs.readFileSync(path.join(fx.out, data), 'utf8'), top);
    }
});

test('a store gone from the source but in the bundle is kept', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const points = path.join(fx.dataRoot, 'state', 'sessions', 'compact-points.json');
    const theirs = { at: new Date(fx.firstMs).toISOString(), session: fx.otherSid, model: 'm', tokens: 90000 };
    fx.write(points, JSON.stringify([{ ...theirs, session: fx.sid }, theirs]));
    run(fx);
    const keptFiles = [`data/state/sessions/COMPACT-STATE-${fx.sid}`, 'data/state/sessions/compact-points.json'];
    const before = keptFiles.map((f) => fs.readFileSync(path.join(fx.out, f), 'utf8'));
    fs.rmSync(path.join(fx.dataRoot, 'state', 'sessions', `COMPACT-STATE-${fx.sid}`));
    fs.writeFileSync(points, JSON.stringify([theirs]));
    const rc = run(fx);
    assert.deepStrictEqual([row(rc, 'sessions:COMPACT-STATE-').status, row(rc, 'sessions:COMPACT-STATE-').why], ['kept', 'from an earlier capture']);
    assert.deepStrictEqual([row(rc, 'compact-points').status, row(rc, 'compact-points').rows], ['kept', 1]);
    assert.deepStrictEqual(keptFiles.map((f) => fs.readFileSync(path.join(fx.out, f), 'utf8')), before);
    // A tools-usage ledger the source no longer holds reads moved.
    fs.rmSync(path.join(fx.dataRoot, 'statistics', 'tools-usage', `${fx.sid}.jsonl`));
    const rc2 = run(fx);
    assert.deepStrictEqual([row(rc2, 'tools-usage').status, row(rc2, 'tools-usage').why, row(rc2, 'tools-usage').rows], ['moved', 'in the bundle; the project\'s copy was moved', 2]);
});

test('the project tree hashes the same before and after a collect', (t) =>
{
    const fx = makeSession({ stores: true, git: true }); t.after(fx.cleanup);
    fx.write(path.join(fx.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_FOO: 'own' } }));
    fx.write(path.join(fx.project, '.claude', 'settings.json'), JSON.stringify({ hand: 'added', env: { ALFRED_CODE_DATA_PATH: '.alfred' } }));
    fx.write(path.join(fx.dataRoot, 'state', 'sessions', 'own-file'), 'mine');
    fx.write(path.join(fx.docsRoot, 'work', 'plans', 'p.md'), '# plan');
    git(fx.project, 'add', '-A');
    git(fx.project, 'commit', '-qm', 'base');
    const before = treeHash(fx.project);
    run(fx);
    assert.deepStrictEqual(treeHash(fx.project), before);
});

// Task 8 - moving the tools-usage ledger.
const rowsIn = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;
const bundleIn = (fx) => path.join(fx.dataRoot, 'statistics', 'usage-report', fx.sid);
const srcLedger = (fx, dir = 'tools-usage') => path.join(fx.dataRoot, 'statistics', dir, `${fx.sid}.jsonl`);
const outLedger = (fx, out, dir = 'tools-usage') => path.join(out, 'data', 'statistics', dir, `${fx.sid}.jsonl`);
const usageRow = (fx, n) => line({ ts: new Date(fx.firstMs + n * 1000).toISOString(), session: fx.sid, tool: 'Read', tool_use_id: `u${n}` });

test('--move-tool-usage is refused outside the project\'s data root', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const r = attempt(fx, ['--move-tool-usage']);
    assert.strictEqual(r.code, 2);
    assert.match(r.message, /--move-tool-usage/);
    assert.ok(isEmptyOrGone(fx.out));
    assert.ok(fs.existsSync(srcLedger(fx)), 'the ledger stays');
});

test('the move renames into an empty bundle; a later hook row opens a new source file', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const out = bundleIn(fx);
    const rc = run(fx, ['--out', out, '--move-tool-usage']);
    assert.deepStrictEqual([row(rc, 'tools-usage').status, row(rc, 'tools-usage').rows], ['moved', 2]);
    assert.ok(!fs.existsSync(srcLedger(fx)), 'moved, not copied');
    assert.strictEqual(rowsIn(outLedger(fx, out)), 2);
    assert.strictEqual(rowsIn(path.join(out, `tool-usage-${fx.sid}.jsonl`)), 2);
    fs.appendFileSync(srcLedger(fx), usageRow(fx, 9));
    assert.strictEqual(rowsIn(srcLedger(fx)), 1);
    assert.strictEqual(rowsIn(outLedger(fx, out)), 2, 'the bundle keeps its own file');
});

test('a move into a bundle holding the ledger keeps the earlier rows and adds the new', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const out = bundleIn(fx);
    fx.write(outLedger(fx, out), [1, 2, 3].map((n) => usageRow(fx, n)).join(''));
    const rc = run(fx, ['--out', out, '--move-tool-usage']);
    assert.deepStrictEqual([row(rc, 'tools-usage').status, row(rc, 'tools-usage').rows], ['moved', 5]);
    assert.strictEqual(rowsIn(outLedger(fx, out)), 5);
    assert.strictEqual(rowsIn(path.join(out, `tool-usage-${fx.sid}.jsonl`)), 5);
    assert.ok(!fs.existsSync(srcLedger(fx)));
    assert.ok(!fs.existsSync(`${outLedger(fx, out)}.incoming`));
});

test('a leftover .incoming and a merged ledger beside it lose and double no row', (t) =>
{
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const out = bundleIn(fx);
    fx.write(outLedger(fx, out), [1, 2, 3, 4, 5].map((n) => usageRow(fx, n)).join(''));
    fx.write(`${outLedger(fx, out)}.incoming`, [4, 5, 6].map((n) => usageRow(fx, n)).join(''));
    fs.rmSync(srcLedger(fx));
    const rc = run(fx, ['--out', out, '--move-tool-usage']);
    assert.strictEqual(rowsIn(outLedger(fx, out)), 6);
    assert.ok(!fs.existsSync(`${outLedger(fx, out)}.incoming`));
    assert.deepStrictEqual([row(rc, 'tools-usage').status, row(rc, 'tools-usage').rows], ['moved', 6]);
});

test('EXDEV falls back to copy, compare, unlink; a size change keeps the source', (t) =>
{
    const exdevFor = (src, extra = {}) => ({
        ...fs, ...extra,
        renameSync: (a, b) => { if (a === src) throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' }); return fs.renameSync(a, b); },
    });
    const fx = makeSession({ stores: true }); t.after(fx.cleanup);
    const rc = run(fx, ['--out', bundleIn(fx), '--move-tool-usage'], { fs: exdevFor(srcLedger(fx)) });
    assert.strictEqual(row(rc, 'tools-usage').status, 'moved');
    assert.ok(!fs.existsSync(srcLedger(fx)));
    assert.strictEqual(rowsIn(outLedger(fx, bundleIn(fx))), 2);

    const fx2 = makeSession({ stores: true }); t.after(fx2.cleanup);
    const src = srcLedger(fx2);
    const grows = exdevFor(src, {
        copyFileSync: (a, b, mode) => { fs.copyFileSync(a, b, mode); if (a === src) fs.appendFileSync(src, usageRow(fx2, 9)); },
    });
    const rc2 = run(fx2, ['--out', bundleIn(fx2), '--move-tool-usage'], { fs: grows });
    assert.deepStrictEqual([row(rc2, 'tools-usage').status, row(rc2, 'tools-usage').why],
        ['copied', 'copied - size changed during the move, the project keeps its ledger']);
    assert.strictEqual(rowsIn(src), 3, 'the source is kept');
    assert.strictEqual(rowsIn(outLedger(fx2, bundleIn(fx2))), 2);
});

test('a redirected log is filtered, never moved', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const log = fx.write('shared/usage.jsonl', [line({ session: fx.sid, tool: 'Read' }), line({ session: fx.otherSid, tool: 'Read' }), ''].join(''));
    fx.write(path.join(fx.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_INSTRUMENT_LOG: log } }));
    const before = fs.readFileSync(log, 'utf8');
    const rc = run(fx, ['--out', bundleIn(fx), '--move-tool-usage']);
    assert.strictEqual(row(rc, 'tools-usage').status, 'filtered');
    assert.strictEqual(fs.readFileSync(log, 'utf8'), before);
});

test('an older bundle whose top-level ledger is the only copy keeps its rows when re-collected', (t) =>
{
    for (const move of [false, true])
    {
        const fx = makeSession({ stores: true }); t.after(fx.cleanup);
        const out = bundleIn(fx);
        const hb = (n) => line({ ts: new Date(fx.firstMs + n * 1000).toISOString(), session: fx.sid, hook: `h${n}` });
        fx.write(path.join(out, `tool-usage-${fx.sid}.jsonl`), [11, 12, 13].map((n) => usageRow(fx, n)).join(''));
        fx.write(path.join(out, `hook-blocks-${fx.sid}.jsonl`), [1, 2].map(hb).join(''));
        fs.writeFileSync(srcLedger(fx, 'hook-blocks'), [1, 2, 3].map(hb).join(''));
        run(fx, ['--out', out, ...(move ? ['--move-tool-usage'] : [])]);
        assert.strictEqual(rowsIn(outLedger(fx, out)), 5, `tools-usage, move ${move}`);
        assert.strictEqual(rowsIn(path.join(out, `tool-usage-${fx.sid}.jsonl`)), 5, `top tools-usage, move ${move}`);
        assert.strictEqual(rowsIn(outLedger(fx, out, 'hook-blocks')), 3, `hook-blocks, move ${move}`);
        assert.strictEqual(rowsIn(path.join(out, `hook-blocks-${fx.sid}.jsonl`)), 3, `top hook-blocks, move ${move}`);
    }
});

module.exports = { attempt, run, row, grepBundle };

test('tailTs ends on a 64 KB tail of untimestamped lines that opens on a newline', (t) =>
{
    const { spawnSync } = require('node:child_process');
    const fx = makeSession({}); t.after(fx.cleanup);
    const file = path.join(fx.root, 'aligned.jsonl');
    const head = line({ timestamp: '2026-11-01T10:00:00.000Z', type: 'user' });
    const pad = (n) => line({ pad: 'a'.repeat(n - line({ pad: '' }).length) });
    // the newline closing `head` sits exactly at size - 64 KB, and nothing after it carries a top-level timestamp
    fs.writeFileSync(file, head + pad(40000) + pad(65535 - 40000));
    assert.strictEqual(fs.statSync(file).size - head.length, 65535);
    const probe = `process.stdout.write(String(require(${JSON.stringify(path.join(__dirname, 'collect-stores.js'))}).tailTs(require('node:fs'), ${JSON.stringify(file)})))`;
    const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(r.signal, null, 'tailTs never returned');
    assert.strictEqual(r.stdout, String(Date.parse('2026-11-01T10:00:00.000Z')));
});

test('a file gone between the listing and the copy reads absent, the rest of its store collected', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const gone = (op) => Object.assign(new Error(`ENOENT: no such file or directory, ${op}`), { code: 'ENOENT' });
    const sid = path.join(path.dirname(fx.transcript), fx.sid);
    const atItem = path.join(sid, 'custom-title.json');
    const atCopy = path.join(sid, 'tool-results', 'r1.txt');
    fs.writeFileSync(path.join(sid, 'tool-results', 'r2.txt'), 'kept');
    const churn = {
        ...fs,
        lstatSync: (p, o) => { if (p === atItem) throw gone('lstat'); return fs.lstatSync(p, o); },
        copyFileSync: (a, b, m) => { if (a === atCopy) throw gone('copyfile'); return fs.copyFileSync(a, b, m); },
    };
    const rc = run(fx, [], { fs: churn });
    const folder = row(rc, 'session-folder');
    assert.strictEqual(folder.status, 'copied');
    assert.strictEqual(folder.files, 1);
    assert.deepStrictEqual(skipped(rc, 'session-folder').map((s) => [s.status, s.file, s.why]).sort(), [
        ['absent', 'custom-title.json', 'vanished during the collect'],
        ['absent', 'tool-results/r1.txt', 'vanished during the collect'],
    ]);
    assert.ok(fs.existsSync(path.join(fx.out, 'tool-results', 'r2.txt')));
    assert.ok(!fs.existsSync(path.join(fx.out, 'tool-results', 'r1.txt')));

    // every file of a store gone: the store reads absent, never copied with nothing in it
    const fx2 = makeSession({}); t.after(fx2.cleanup);
    const sid2 = path.join(path.dirname(fx2.transcript), fx2.sid);
    const all = { ...fs, lstatSync: (p, o) => { if (path.dirname(p) === sid2 && path.basename(p) !== 'subagents') throw gone('lstat'); return fs.lstatSync(p, o); } };
    const rc2 = run(fx2, [], { fs: all });
    assert.deepStrictEqual([row(rc2, 'session-folder').status, row(rc2, 'session-folder').why], ['absent', 'vanished during the collect']);
});

test('collect-privacy.js and collect-fixture.js start git through runtime.js, never child_process', () =>
{
    for (const f of ['collect-privacy.js', 'collect-fixture.js'])
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, f), 'utf8'), /require\(['"](?:node:)?child_process['"]\)/, f);
});

// ---------- the burn-down of 2026-11-04 (O2, O3, R165, R166, R168) ----------

// O2: the collector judged a doc by the hook's credential shapes, and the GitLab personal token was not one of them.
test('SECRET_SHAPE matches a GitLab personal token', () =>
{
    const { SECRET_SHAPE } = require('./credential-shapes.js');
    assert.strictEqual(SECRET_SHAPE.test(`the token ${'glpat' + '-' + 'x'.repeat(20)} here`), true);
    assert.strictEqual(SECRET_SHAPE.test('glpat' + '-' + 'x'.repeat(19)), false, 'one under the shape');
});

test('a doc holding a GitLab token is denied, never copied', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const token = 'glpat' + '-' + 'Ab1_'.repeat(6);
    fx.write(path.join(fx.docsRoot, 'gl.md'), `the token ${token} leaked\n`);
    docsLog(fx, { files: [projectRel(fx, path.join(fx.docsRoot, 'gl.md'))] });
    const rc = run(fx);
    assert.ok(!fs.existsSync(path.join(fx.out, 'docs', 'gl.md')));
    assert.deepStrictEqual(skipped(rc, 'docs').map((s) => [s.status, s.file, s.why]), [['denied', 'docs/gl.md', 'credential shape']]);
    assert.ok(!grepBundle(fx.out, token), 'no value in the bundle');
});

test('the GitLab prefix in prose with a short tail is no token', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'prose.md'), `GitLab tokens open with ${'glpat' + '-' + 'abc'} and more\n`);
    docsLog(fx, { files: [projectRel(fx, path.join(fx.docsRoot, 'prose.md'))] });
    const rc = run(fx);
    assert.ok(fs.existsSync(path.join(fx.out, 'docs', 'prose.md')));
    assert.deepStrictEqual(skipped(rc, 'docs'), []);
});

// O3: a doc the session wrote through the docs engine from Bash was never collected - the engine's log rows named no
// session, and its doc-set row names the doc under `wrote`.
test('docs written through docs.js are collected', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.docsRoot, 'architecture', 'references', 'patterns.md'), '# patterns\n\n## orders\n<!-- id: orders -->\nOld rule.\n');
    const engine = path.join(__dirname, '..', 'stack', 'hooks', 'docs.js');
    const env = { ...fx.env, CLAUDE_PROJECT_DIR: fx.project, CLAUDE_CODE_SESSION_ID: fx.sid, ALFRED_CODE_DOCS_VERSIONING: '' };
    const r = require('node:child_process').spawnSync(process.execPath, [engine, 'set', 'patterns#orders'],
        { cwd: fx.project, input: '## orders\n<!-- id: orders -->\nRefunds are ledgered first.\n', encoding: 'utf8', env });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const rc = run(fx);
    assert.match(fs.readFileSync(path.join(fx.out, 'docs', 'architecture', 'references', 'patterns.md'), 'utf8'), /ledgered first/);
    assert.strictEqual(row(rc, 'docs-log').rows, 1);
});

// R165: an unlisted state file held no `held` names, so once the hook swept it a re-collect read it absent though
// the bundle kept it.
test('an unlisted file swept from the source reads kept on a re-collect', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    const name = `odd-${fx.sid}.json`;
    const file = path.join(fx.dataRoot, 'state', 'sessions', name);
    fx.write(file, '{}\n');
    assert.strictEqual(row(run(fx), 'sessions:unlisted').status, 'copied');
    fs.rmSync(file);
    const again = row(run(fx), 'sessions:unlisted');
    assert.deepStrictEqual([again.status, again.files], ['kept', 1]);
    assert.ok(fs.existsSync(path.join(fx.out, 'data', 'state', 'sessions', name)));
});

// R166: a bundle under a folder a store walks by name was taken as that store's item - each re-run copied the bundle
// into itself one level deeper.
test('an --out inside a store\'s source root is refused', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    for (const out of [path.join(fx.dataRoot, 'state', 'sessions', `${fx.sid}-audit`), path.join(fx.dataRoot, 'state', 'forge'), path.join(fx.docsRoot, 'audit')])
    {
        const r = attempt(fx, ['--out', out]);
        assert.strictEqual(r.code, 2, out);
        assert.match(r.message, /lies inside .* - pick a folder outside it/);
        assert.ok(!fs.existsSync(out), `nothing written: ${out}`);
    }
});

test('an --out beside the data root is accepted', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    for (const out of [path.join(fx.dataRoot, 'statistics', 'usage-report', fx.sid), path.join(fx.dataRoot, 'audits', fx.sid)])
    {
        const rc = run(fx, ['--out', out]);
        assert.strictEqual(rc.session, fx.sid, out);
    }
});

// R168: the session-inspector status copy is a meta store, kept when text is withheld - and its handoffPrompt quotes
// the open plan's Resume: line, conversation text.
test('a withhold bundle\'s session-inspector status copy has handoffPrompt null', (t) =>
{
    const fx = makeSession({}); t.after(fx.cleanup);
    fx.write(path.join(fx.project, '.claude', 'session-inspector', 'status', `${fx.sid}.json`),
        JSON.stringify({ schema: 1, session: fx.sid, title: 't', handoffPrompt: 'Resume: the plan text' }));
    run(fx, ['--text', 'withhold']);
    const copy = JSON.parse(fs.readFileSync(path.join(fx.out, 'context', 'session-inspector-status.json'), 'utf8'));
    assert.deepStrictEqual([copy.handoffPrompt, copy.title], [null, 't']);
    const consent = path.join(fx.root, 'out-consent');
    run(fx, ['--out', consent]);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(consent, 'context', 'session-inspector-status.json'), 'utf8')).handoffPrompt, 'Resume: the plan text');
});
