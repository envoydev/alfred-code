'use strict';
// ALFRED_CODE_MAXIMUM_RUN_AGENTS (the user's task of 2026-10-27, spec docs/superpowers/specs/2026-10-27-maximum-run-agents-design.md):
// how many of a session's agents may run at once. The registry under <data root>/state/sessions/, the dispatch guard's
// deny, the start and stop events, the Stop reconcile and its one continuation, and the line the flows read.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const cap = require(path.join(HOOKS, 'agent-cap.js'));

test('capOf: the one parse rule (AC6)', () =>
{
    const v = (x) => cap.capOf(x === undefined ? {} : { ALFRED_CODE_MAXIMUM_RUN_AGENTS: x });
    for (const x of [undefined, '', 'abc', '7.5', '3abc', '-1', ' ']) assert.strictEqual(v(x), 5, String(x));
    assert.strictEqual(v(' 3 '), 3);
    assert.strictEqual(v('0'), 0);
    assert.strictEqual(v('50'), 50);
    assert.strictEqual(v('51'), 50);
});

// ---- the registry (Task 2): real files in a temp data root, `now` handed in ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cap-'));
const MIN = 60 * 1000;
const freshReg = (sid = 'sess-1') =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    return { root, reg: cap.openRegistry(root, sid, {}) };
};
const names = (reg) => { try { return fs.readdirSync(reg.dir).filter((f) => f.startsWith(`AGENT-CAP-${reg.sid}`)).sort(); } catch { return []; } };
const entry = (reg, kind, id) => JSON.parse(fs.readFileSync(path.join(reg.dir, `AGENT-CAP-${reg.sid}-${kind}-${id}`), 'utf8'));
const put = (reg, kind, id, body) =>
{
    fs.mkdirSync(reg.dir, { recursive: true });
    fs.writeFileSync(path.join(reg.dir, `AGENT-CAP-${reg.sid}-${kind}-${id}`), JSON.stringify(body));
};
const touched = (file, ms) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); fs.utimesSync(file, ms / 1000, ms / 1000); return file; };
const probes = () => { const rows = []; return { rows, probe: (kind, reason) => rows.push({ kind, reason }) }; };

test('openRegistry and cleanId: no id climbs out of the sessions folder (AC13)', () =>
{
    assert.doesNotMatch(cap.cleanId('../../x/y'), /\/|\.\./);
    assert.strictEqual(cap.cleanId('agent-abc123', { agent: true }), 'abc123');
    assert.strictEqual(cap.cleanId('agent-abc123'), 'agent-abc123', 'only an agent id loses the prefix');
    assert.strictEqual(cap.cleanId('x'.repeat(100)).length, 64);
    assert.strictEqual(cap.cleanId(''), '');
    assert.strictEqual(cap.cleanId('../..'), '', 'nothing but separators is no id');
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    assert.strictEqual(cap.openRegistry(root, '', {}), null);
    assert.strictEqual(cap.openRegistry(root, undefined, {}), null);
    const reg = cap.openRegistry(root, '../../etc', {});
    assert.ok(reg.dir.startsWith(path.join(root, '.alfred', 'state', 'sessions')));
    assert.doesNotMatch(reg.sid, /\/|\.\./);
});

test('the start and stop events (AC3)', () =>
{
    const { reg } = freshReg();
    const T = Date.now();
    cap.addPending(reg, 'toolu_1', { type: 'Explore', parent: '', now: T });
    cap.addPending(reg, 'toolu_2', { type: 'alfred-code:wpf-implementer', parent: 'seat9', now: T + 1000 });
    cap.startAgent(reg, { agentId: 'a1', type: 'alfred-code:wpf-implementer', transcript: '', now: T + 2000 });
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-sess-1-P-toolu_1', 'AGENT-CAP-sess-1-R-a1'], 'the pending file of its type went, not the oldest');
    assert.strictEqual(entry(reg, 'R', 'a1').parent, 'seat9', 'and its parent rode along');
    cap.startAgent(reg, { agentId: 'agent-a2', type: 'Plan', transcript: '', now: T + 3000 });
    assert.ok(!names(reg).includes('AGENT-CAP-sess-1-P-toolu_1'), 'no type match: the oldest pending file');
    assert.ok(names(reg).includes('AGENT-CAP-sess-1-R-a2'), 'the agent- prefix is stripped');
    cap.startAgent(reg, { agentId: 'a3', type: 'Explore', transcript: '', now: T + 4000 });
    assert.ok(names(reg).includes('AGENT-CAP-sess-1-R-a3'), 'a start with no pending file still writes its running file');
    const before = names(reg);
    cap.stopAgent(reg, { agentId: 'a3', now: T + 5000 });
    assert.deepStrictEqual(names(reg), before, 'a stop deletes nothing');
    assert.strictEqual(entry(reg, 'R', 'a3').stop, T + 5000);
    cap.stopAgent(reg, { agentId: 'a3', now: T + 6000 });
    assert.strictEqual(entry(reg, 'R', 'a3').stop, T + 6000, 'a second stop only moves stop');
    cap.startAgent(reg, { agentId: 'a3', type: 'Explore', transcript: '', now: T + 7000 });
    assert.strictEqual(entry(reg, 'R', 'a3').stop, undefined, 'a resume clears it');
});

test('a stop stores a reported transcript only inside the session\'s folder (AC13)', () =>
{
    const { reg } = freshReg();
    const sessionDir = path.join(TMP, 'proj-x');
    cap.startAgent(reg, { agentId: 'a1', type: 'Explore', transcript: path.join(sessionDir, 's', 'subagents', 'agent-a1.jsonl'), now: Date.now() });
    cap.stopAgent(reg, { agentId: 'a1', transcriptPath: '/etc/passwd', sessionDir, now: Date.now() });
    assert.strictEqual(entry(reg, 'R', 'a1').transcript, path.join(sessionDir, 's', 'subagents', 'agent-a1.jsonl'), 'outside: the derived path stays');
    const inside = path.join(sessionDir, 's', 'subagents', 'agent-a1-b.jsonl');
    cap.stopAgent(reg, { agentId: 'a1', transcriptPath: inside, sessionDir, now: Date.now() });
    assert.strictEqual(entry(reg, 'R', 'a1').transcript, inside);
});

test('the count: the liveness boundaries (AC4)', () =>
{
    const now = Date.now();
    const { reg } = freshReg();
    put(reg, 'P', 'p59', { type: 'Explore', at: now - 59 * 1000, parent: '' });
    put(reg, 'P', 'p61', { type: 'Explore', at: now - 61 * 1000, parent: '' });
    put(reg, 'R', 'r1159', { type: 'Plan', at: now - (12 * MIN - 1000), parent: '' });
    put(reg, 'R', 'r1201', { type: 'Plan', at: now - (12 * MIN + 1000), parent: '' });
    const quiet = touched(path.join(TMP, 'tq', 'quiet.jsonl'), now - 40 * 1000);
    put(reg, 'R', 'stopped', { type: 'Plan', at: now - MIN, parent: '', transcript: quiet, stop: now - 30 * 1000 });
    const sent = touched(path.join(TMP, 'ts', 'sent.jsonl'), now - 24 * 1000);
    put(reg, 'R', 'sentback', { type: 'Plan', at: now - MIN, parent: '', transcript: sent, stop: now - 30 * 1000 });
    put(reg, 'R', 'garbage', 'not json at all');
    fs.writeFileSync(path.join(reg.dir, `AGENT-CAP-${reg.sid}-R-torn`), '{"type":');
    const p = probes();
    const c = cap.count(reg, { now, probe: p.probe });
    assert.strictEqual(c.running, 3, JSON.stringify(c));
    assert.deepStrictEqual([...c.counted].sort(), ['P-p59', 'R-r1159', 'R-sentback']);
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-sess-1-P-p59', 'AGENT-CAP-sess-1-R-r1159', 'AGENT-CAP-sess-1-R-sentback', 'AGENT-CAP-sess-1-R-stopped']);
    assert.deepStrictEqual(p.rows.map((r) => r.kind), ['agent-cap-expired'], 'one row for the file that expired with no stop');
    cap.count(reg, { now: now + 2 * MIN + 1000, probe: () => {} });
    assert.ok(!names(reg).includes('AGENT-CAP-sess-1-R-stopped'), 'a stopped file is gone 2 minutes after its stop');
});

// Final review M1 (re-graded Important): a hand-back's PostToolUse rows land up to 3.65 s after the call (183 subagent
// transcripts, 40 past one second), so a transcript written a few seconds after the stop is the stop's own tail, not a
// hold that sent the seat back. Past 5 s it is a sent-back seat.
test('the count: a transcript written within 5 s of the stop is the stop\'s own tail (final review M1)', () =>
{
    const now = Date.now();
    const { reg } = freshReg();
    const tail = touched(path.join(TMP, 'tt', 'tail.jsonl'), now - 30 * 1000 + 3700);
    put(reg, 'R', 'tail', { type: 'Plan', at: now - MIN, parent: '', transcript: tail, stop: now - 30 * 1000 });
    const back = touched(path.join(TMP, 'tb', 'back.jsonl'), now - 30 * 1000 + 5200);
    put(reg, 'R', 'back', { type: 'Plan', at: now - MIN, parent: '', transcript: back, stop: now - 30 * 1000 });
    assert.deepStrictEqual([...cap.count(reg, { now, probe: () => {} }).counted], ['R-back']);
});

test('the count: a seat waiting on its own agent counts past 12 minutes (AC4)', () =>
{
    const now = Date.now();
    const { reg } = freshReg();
    put(reg, 'R', 'seat', { type: 'issue-diagnoser-ci', at: now - 20 * MIN, parent: '' });
    put(reg, 'R', 'child', { type: 'evidence-gatherer', at: now - MIN, parent: 'seat' });
    const c = cap.count(reg, { now, probe: () => {} });
    assert.strictEqual(c.running, 2);
    assert.ok(names(reg).includes('AGENT-CAP-sess-1-R-seat'));
    assert.deepStrictEqual(c.types.sort(), ['evidence-gatherer', 'issue-diagnoser-ci']);
});

test('the lock: held past 1.5 s fails, older than 5 s is broken (AC8)', () =>
{
    const { reg } = freshReg();
    const lock = path.join(reg.dir, `AGENT-CAP-${reg.sid}.lock`);
    fs.mkdirSync(reg.dir, { recursive: true });
    fs.writeFileSync(lock, '');
    const t0 = Date.now();
    const held = cap.withLock(reg, () => 1);
    const took = Date.now() - t0;
    assert.strictEqual(held.ok, false);
    assert.ok(took >= 1400 && took < 4000, `waited ${took} ms`);
    const old = (Date.now() - 6000) / 1000;
    fs.utimesSync(lock, old, old);
    assert.deepStrictEqual(cap.withLock(reg, () => 7), { ok: true, value: 7 });
    assert.ok(!fs.existsSync(lock), 'the lock is released after fn');
    assert.deepStrictEqual(cap.withLock(reg, () => { throw new Error('boom'); }), { ok: true, value: undefined }, 'a throw inside fails open');
    assert.ok(!fs.existsSync(lock));
});

// CI on windows-2025, 2026-10-27: 8 dispatches at cap 5 let 6 through. A lock another process is deleting while a third
// stats it sits 'delete pending' on Windows, and an exclusive create of it fails EPERM (EBUSY on a sharing violation),
// not EEXIST - read as 'no lock to take', the dispatch passed unjudged. Both wait like a held lock.
test('the lock: a create refused EPERM or EBUSY waits like a held lock (Windows delete-pending)', () =>
{
    const { reg } = freshReg();
    const lock = path.join(reg.dir, `AGENT-CAP-${reg.sid}.lock`);
    const open = fs.openSync;
    const refusals = ['EPERM', 'EBUSY'];
    fs.openSync = (file, ...rest) =>
    {
        if (file === lock && refusals.length) throw Object.assign(new Error('refused'), { code: refusals.shift() });
        return open(file, ...rest);
    };
    try { assert.deepStrictEqual(cap.withLock(reg, () => 3), { ok: true, value: 3 }); }
    finally { fs.openSync = open; }
    assert.deepStrictEqual(refusals, [], 'both refusals were retried');
    assert.ok(!fs.existsSync(lock));
});

// Final review I1: a lock whose stat fails - released between the failed create and the stat, or a dangling link - read as
// infinitely old, so a waiter deleted whatever lock a third process had just taken and both ran inside. A failed stat
// now waits like a held lock. A dangling symlink is the deterministic stand-in: the exclusive create sees it, the stat
// does not - and the old code spun on it forever (`rmSync` with `force` passes over a dangling link), so the call runs in
// a child process with a timeout.
test('the lock: one whose stat fails is waited on, never broken (final review I1)', { skip: process.platform === 'win32' }, () =>
{
    const { reg } = freshReg();
    const lock = path.join(reg.dir, `AGENT-CAP-${reg.sid}.lock`);
    fs.mkdirSync(reg.dir, { recursive: true });
    fs.symlinkSync(path.join(reg.dir, 'nowhere'), lock);
    const script = `const cap = require(${JSON.stringify(path.join(HOOKS, 'agent-cap.js'))}); let ran = false; `
        + `const held = cap.withLock(${JSON.stringify(reg)}, () => { ran = true; }); process.stdout.write(JSON.stringify({ ok: held.ok, ran }));`;
    const r = require('node:child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 8000 });
    assert.strictEqual(r.signal, null, 'withLock returned instead of spinning');
    assert.deepStrictEqual(JSON.parse(r.stdout), { ok: false, ran: false }, 'never taken');
    assert.ok(fs.lstatSync(lock).isSymbolicLink(), 'and not deleted');
});

// The same race under load: eight processes each take the lock 200 times and claim a sentinel inside it with an exclusive
// create. Two holders at once is an overlap; the shipped code measured 27-134 per run (6 of 7 runs).
test('the lock: eight processes taking it 200 times each never overlap inside it (final review I1)', () =>
{
    const { reg } = freshReg();
    fs.mkdirSync(reg.dir, { recursive: true });
    const sentinel = path.join(reg.dir, 'inside');
    const script = [
        `const cap = require(${JSON.stringify(path.join(HOOKS, 'agent-cap.js'))});`,
        `const fs = require('fs');`,
        `const reg = ${JSON.stringify(reg)};`,
        `let overlaps = 0;`,
        `for (let i = 0; i < 200; i++) cap.withLock(reg, () => {`,
        `  try { fs.closeSync(fs.openSync(${JSON.stringify(sentinel)}, 'wx')); } catch { overlaps++; return; }`,
        `  fs.rmSync(${JSON.stringify(sentinel)}, { force: true });`,
        `});`,
        `process.stdout.write(String(overlaps));`,
    ].join('\n');
    const { spawn } = require('node:child_process');
    return Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) =>
    {
        const p = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d) => { out += d; });
        p.on('close', () => resolve(Number(out) || 0));
    }))).then((counts) => assert.strictEqual(counts.reduce((a, b) => a + b, 0), 0, `overlaps per process: ${counts.join(', ')}`));
});

test('the Stop reconcile (S4 event 4.1)', () =>
{
    const now = Date.now();
    // no id matches: the N most recently active are kept
    const a = freshReg();
    for (let i = 1; i <= 5; i++) put(a.reg, 'R', `x${i}`, { type: 'Explore', at: now - i * MIN, parent: '' });
    const pa = probes();
    const tasks = [{ type: 'subagent', id: 'nope1', status: 'running' }, { type: 'subagent', id: 'nope2', status: 'running' },
        { type: 'subagent', id: 'nope3', status: 'completed' }, { type: 'shell', id: 'b1', status: 'running' }];
    assert.strictEqual(cap.reconcile(a.reg, tasks, { now, probe: pa.probe }), 3);
    assert.deepStrictEqual(names(a.reg), ['AGENT-CAP-sess-1-R-x1', 'AGENT-CAP-sess-1-R-x2']);
    assert.deepStrictEqual(pa.rows.map((r) => r.kind), ['agent-cap-reconciled']);
    // ids match: exactly the files not in flight go, a counted stopped one included
    const b = freshReg();
    put(b.reg, 'R', 'k1', { type: 'Explore', at: now - MIN, parent: '' });
    put(b.reg, 'R', 'gone', { type: 'Explore', at: now - MIN, parent: '' });
    const sent = touched(path.join(TMP, 'tr', 'sent.jsonl'), now - 10 * 1000);
    put(b.reg, 'R', 'sentback', { type: 'Plan', at: now - MIN, parent: '', transcript: sent, stop: now - 20 * 1000 });
    put(b.reg, 'R', 'k2', { type: 'Plan', at: now - MIN, parent: '' });
    put(b.reg, 'P', 'main', { type: 'Explore', at: now - 1000, parent: '' });
    put(b.reg, 'P', 'seatown', { type: 'evidence-gatherer', at: now - 1000, parent: 'k1' });
    const inflight = [{ type: 'subagent', id: 'agent-k1', status: 'running' }, { type: 'subagent', id: 'k2', status: 'running' },
        { type: 'subagent', id: 'gone', status: 'completed' }];
    cap.reconcile(b.reg, inflight, { now, probe: () => {} });
    assert.deepStrictEqual(names(b.reg), ['AGENT-CAP-sess-1-P-seatown', 'AGENT-CAP-sess-1-R-k1', 'AGENT-CAP-sess-1-R-k2'],
        'the main session\'s pending file and the two not in flight went; the seat\'s pending file stayed');
    // no background_tasks: nothing is touched
    const c = freshReg();
    put(c.reg, 'R', 'y', { type: 'Explore', at: now - MIN, parent: '' });
    put(c.reg, 'P', 'main', { type: 'Explore', at: now - 1000, parent: '' });
    assert.strictEqual(cap.reconcile(c.reg, undefined, { now, probe: () => {} }), 0);
    assert.strictEqual(names(c.reg).length, 2);
});

test('the copy route ships agent-cap.js beside the copied hooks (AC16)', () =>
{
    assert.ok(require('./install/alfred-code.js').HOOK_MODULES.includes('agent-cap.js'));
});

test('the count stays fast: 50 running files (S7)', () =>
{
    const now = Date.now();
    const { reg } = freshReg();
    for (let i = 0; i < 50; i++)
    {
        const t = touched(path.join(TMP, 'fast', `t${i}.jsonl`), now - 1000);
        put(reg, 'R', `f${i}`, { type: 'Explore', at: now - 2000, parent: '', transcript: t });
    }
    const runs = [];
    for (let i = 0; i < 20; i++)
    {
        const t0 = process.hrtime.bigint();
        const r = cap.withLock(reg, () => cap.count(reg, { now, probe: () => {} }));
        runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
        assert.strictEqual(r.value.running, 50);
    }
    runs.sort((x, y) => x - y);
    const median = runs[10];
    console.log(`# agent-cap: the median locked count over 50 running files took ${median.toFixed(2)} ms`);
    assert.ok(median < 50, `median ${median} ms`);
});

test('openRegistry sweeps AGENT-CAP- files untouched for 7 days, whatever their session (S4 The files)', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const dir = path.join(root, '.alfred', 'state', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'AGENT-CAP-other-R-x1');
    const fresh = path.join(dir, 'AGENT-CAP-other-R-x2');
    fs.writeFileSync(old, '{}');
    fs.writeFileSync(fresh, '{}');
    const eightDays = (Date.now() - 8 * 24 * 3600 * 1000) / 1000;
    fs.utimesSync(old, eightDays, eightDays);
    cap.openRegistry(root, 'sess-1', {});
    assert.ok(!fs.existsSync(old), 'the 8-day-old file is swept');
    assert.ok(fs.existsSync(fresh), 'a fresh one stays');
});

test('capGates: the one gate function both hooks call (S4 Gates)', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const live = { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Agent' };
    const env = (extra = {}) => ({ CLAUDE_PROJECT_DIR: root, ...extra });
    const g = cap.capGates(live, env());
    assert.strictEqual(g.n, 5);
    assert.strictEqual(g.reg.sid, 's1');
    assert.strictEqual(g.root, root);
    assert.strictEqual(cap.capGates(live, env({ ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' })).n, 3);
    for (const [why, payload, extra] of [
        ['no session id', { ...live, session_id: '' }, {}],
        ['the part off', live, { ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch:cap' }],
        ['the guard off', live, { ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch' }],
        ['the stop contract off', live, { ALFRED_CODE_HOOKS_OFF: 'guard-stop-contract' }],
        ['minimal', live, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }],
        ['a repo never set up', live, { CLAUDE_PLUGIN_ROOT: path.join(TMP, 'plugin') }],
        ['a Cursor payload', { ...live, cursor_version: '1.7' }, {}],
        ['cap 0', live, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0' }],
    ]) assert.strictEqual(cap.capGates(payload, env(extra)), null, why);
    assert.strictEqual(cap.capGates(live, env(), { stop: true }).canContinue, true);
    assert.strictEqual(cap.capGates(live, env({ ALFRED_CODE_HOOKS_OFF: 'guard-answer' }), { stop: true }).canContinue, false,
        'guard-answer scopes .denied to its prompt, so with it off the Stop never continues');
});

// ---- the deny (Task 3): the dispatch guard spawned on real payloads in a temp project ----
const { spawnSync, spawn } = require('node:child_process');
const GUARD = path.join(HOOKS, 'guard-unapproved-dispatch.js');
const project = () => fs.mkdtempSync(path.join(TMP, 'hook-'));
const hookEnv = (root, extra = {}) => ({ ...process.env, CLAUDE_PROJECT_DIR: root, ...extra });
const agentPayload = (root, { sid = 's1', id = 'toolu_x', seat = 'alfred-code:aspnet-verifier', agent, agentType = 'Explore', extra = {} } = {}) => ({
    hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: id, session_id: sid, cwd: root,
    tool_input: { subagent_type: seat, prompt: 'review the change', description: 'review' },
    ...(agent ? { agent_id: agent, agent_type: agentType } : {}), ...extra,
});
const callHook = (hook, root, payload, env = {}) => spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(root, env) });
const regOf = (root, sid = 's1') => cap.openRegistry(root, sid, {});
const runningFiles = (reg, types, extra = {}) => types.forEach((type, i) => put(reg, 'R', `run${i}`, { type, at: Date.now(), parent: '', ...extra }));
const pendings = (reg) => names(reg).filter((n) => n.includes('-P-'));
const anyCapFile = (root) => { try { return fs.readdirSync(path.join(root, '.alfred', 'state', 'sessions')).filter((n) => /^AGENT-CAP-.*(?:-P-|\.denied)/.test(n)); } catch { return []; } };
const blockRows = (root, sid = 's1') =>
{
    try { return fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch { return []; }
};
const stampRun = (root) =>
{
    const f = path.join(root, '.alfred', 'state', 'approvals', 'APPROVAL');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'APPROVED plan-1 - "go"\n');
};

test('the deny: a sixth agent while five run, the key unset (AC1)', () =>
{
    const root = project();
    const reg = regOf(root);
    runningFiles(reg, ['Explore', 'Plan', 'alfred-code:aspnet-verifier', 'general-purpose', 'Explore']);
    const r = callHook(GUARD, root, agentPayload(root));
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /^5 of this session's agents are running and ALFRED_CODE_MAXIMUM_RUN_AGENTS is 5: /);
    for (const t of ['Explore', 'Plan', 'alfred-code:aspnet-verifier', 'general-purpose']) assert.ok(r.stderr.includes(t), t);
    assert.match(r.stderr, /\nDispatch this one when one hands back - its notice wakes you - and send the rest of a fan-out the same way\.\n/);
    assert.match(r.stderr, /\nThe setting is the user's - never change it yourself\./);
    assert.doesNotMatch(r.stderr, /lift|=0|\b0\b/, 'the denial never says how to lift the cap');
    assert.deepStrictEqual(blockRows(root).map((row) => row.detail && row.detail.branch), ['agent-cap']);
    assert.ok(fs.existsSync(cap.deniedOf(reg)), 'a main-session denial writes .denied');
    assert.deepStrictEqual(pendings(reg), []);
});

test('the deny: the type list stops at eight names, then the count of the rest', () =>
{
    const root = project();
    const reg = regOf(root);
    runningFiles(reg, Array.from({ length: 10 }, (_, i) => `seat-${i}`));
    const r = callHook(GUARD, root, agentPayload(root), { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '10' });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr.split('\n')[0], /: (?:seat-\d, ){7}seat-\d and 2 more$/);
});

test('8 dispatches at once at cap 5 on an empty registry: 5 pass, 3 are denied (AC2)', async () =>
{
    const root = project();
    const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve) =>
    {
        const c = spawn(process.execPath, [GUARD], { env: hookEnv(root), stdio: ['pipe', 'ignore', 'ignore'] });
        c.on('close', resolve);
        c.stdin.end(JSON.stringify(agentPayload(root, { id: `toolu_${i}` })));
    })));
    assert.deepStrictEqual(codes.sort(), [0, 0, 0, 0, 0, 2, 2, 2]);
    assert.strictEqual(pendings(regOf(root)).length, 5);
});

test('a dispatch another rule denies holds no slot (AC5)', () =>
{
    const root = project();
    const r = callHook(GUARD, root, agentPayload(root, { seat: 'alfred-code:aspnet-implementer' }));
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /without an approval gate/);
    assert.deepStrictEqual(pendings(regOf(root)), []);
});

test('the boundary: at exactly the cap denied, one under it passes (AC6)', () =>
{
    const at = project();
    runningFiles(regOf(at), ['Explore', 'Plan', 'Explore']);
    assert.strictEqual(callHook(GUARD, at, agentPayload(at), { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' }).status, 2);
    const under = project();
    runningFiles(regOf(under), ['Explore', 'Plan']);
    assert.strictEqual(callHook(GUARD, under, agentPayload(under), { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' }).status, 0);
    assert.strictEqual(pendings(regOf(under)).length, 1);
});

test('the stand-downs let the dispatch through and write nothing (AC7)', () =>
{
    for (const [why, env, extra] of [
        ['the part off', { ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch:cap' }, {}],
        ['the stop contract off', { ALFRED_CODE_HOOKS_OFF: 'guard-stop-contract' }, {}],
        ['minimal', { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }, {}],
        ['a repo never set up', { CLAUDE_PLUGIN_ROOT: path.join(TMP, 'plugin') }, {}],
        ['a Cursor payload', {}, { cursor_version: '1.7' }],
        ['no session id', {}, { session_id: '' }],
        ['cap 0', { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0' }, {}],
    ])
    {
        const root = project();
        runningFiles(regOf(root), ['Explore', 'Plan', 'Explore', 'Plan', 'Explore']);
        const r = callHook(GUARD, root, agentPayload(root, { extra }), env);
        assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
        assert.deepStrictEqual(anyCapFile(root), [], why);
    }
});

test('the event branches exit first, whatever the cap says, and never reach the dispatch rules (AC7, AC12)', () =>
{
    for (const env of [{}, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0' }, { ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch:cap' }])
    {
        const root = project();
        stampRun(root);
        const tp = path.join(root, 'session.jsonl');
        for (const payload of [
            { hook_event_name: 'SubagentStart', session_id: 's1', cwd: root, transcript_path: tp, agent_id: 'a1', agent_type: 'alfred-code:issue-diagnoser-ci' },
            { hook_event_name: 'SubagentStop', session_id: 's1', cwd: root, transcript_path: tp, agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: path.join(root, 's1', 'subagents', 'agent-a1.jsonl') },
            { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'toolu_s', session_id: 's1', cwd: root, tool_input: { to: 'a1', message: 'go on' } },
        ])
        {
            const r = callHook(GUARD, root, payload, env);
            assert.strictEqual(r.status, 0, `${payload.hook_event_name} ${payload.tool_name || ''} ${JSON.stringify(env)}: ${r.stderr}`);
        }
        assert.deepStrictEqual(blockRows(root), [], `no block row: ${JSON.stringify(env)}`);
    }
});

test('SubagentStart and SubagentStop through the guard record the agent (AC3)', () =>
{
    const root = project();
    const reg = regOf(root);
    const tp = path.join(root, 'projects', 'session.jsonl');
    assert.strictEqual(callHook(GUARD, root, agentPayload(root, { id: 'toolu_1', seat: 'Plan' })).status, 0);
    assert.strictEqual(callHook(GUARD, root, { hook_event_name: 'SubagentStart', session_id: 's1', cwd: root, transcript_path: tp, agent_id: 'agent-a1', agent_type: 'Plan' }).status, 0);
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-s1-R-a1']);
    assert.strictEqual(entry(reg, 'R', 'a1').transcript, path.join(root, 'projects', 's1', 'subagents', 'agent-a1.jsonl'), 'the derived transcript path');
    const reported = path.join(root, 'projects', 's1', 'subagents', 'agent-a1.jsonl');
    assert.strictEqual(callHook(GUARD, root, { hook_event_name: 'SubagentStop', session_id: 's1', cwd: root, transcript_path: tp, agent_id: 'a1', agent_type: 'Plan', agent_transcript_path: reported }).status, 0);
    assert.ok(entry(reg, 'R', 'a1').stop > 0);
});

test('nested: a seat\'s own dispatch is capped like the main session\'s (AC14)', () =>
{
    const seatCall = (root) => agentPayload(root, { seat: 'alfred-code:evidence-gatherer', agent: 'seat1', agentType: 'alfred-code:issue-diagnoser-ci' });
    const two = project();
    runningFiles(regOf(two), ['alfred-code:issue-diagnoser-ci']);
    fs.renameSync(path.join(regOf(two).dir, 'AGENT-CAP-s1-R-run0'), path.join(regOf(two).dir, 'AGENT-CAP-s1-R-seat1'));
    assert.strictEqual(callHook(GUARD, two, seatCall(two), { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' }).status, 0);
    const [p] = pendings(regOf(two));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(regOf(two).dir, p), 'utf8')).parent, 'seat1');
    const one = project();
    runningFiles(regOf(one), ['alfred-code:issue-diagnoser-ci']);
    const r = callHook(GUARD, one, seatCall(one), { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '1' });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /\nDo this step yourself - the session is at its cap\./);
    assert.ok(!fs.existsSync(cap.deniedOf(regOf(one))), 'a seat\'s denial writes no .denied');
});

test('a resume through SendMessage is judged against the cap (AC17)', () =>
{
    const setup = () =>
    {
        const root = project();
        const reg = regOf(root);
        runningFiles(reg, ['Explore', 'Plan']);
        put(reg, 'R', 'old', { type: 'alfred-code:aspnet-verifier', at: Date.now() - MIN, parent: '', transcript: '', stop: Date.now() - 30 * 1000 });
        return { root, reg };
    };
    const send = (root, to, env) => callHook(GUARD, root, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'toolu_m', session_id: 's1', cwd: root, tool_input: { to, message: 'go on' } }, env);
    const full = setup();
    const r = send(full.root, 'old', { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /^2 of this session's agents are running and ALFRED_CODE_MAXIMUM_RUN_AGENTS is 2: /);
    const room = setup();
    assert.strictEqual(send(room.root, 'old', { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' }).status, 0);
    const [p] = pendings(room.reg);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(room.reg.dir, p), 'utf8')).type, 'alfred-code:aspnet-verifier');
    for (const to of ['researcher', 'run0'])
    {
        const s = setup();
        assert.strictEqual(send(s.root, to, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' }).status, 0, to);
        assert.deepStrictEqual(pendings(s.reg), [], `${to}: a name or a running agent passes untouched`);
    }
});

test('a held lock lets the dispatch through with one agent-cap-unjudged row (AC8)', () =>
{
    const root = project();
    const reg = regOf(root);
    fs.mkdirSync(reg.dir, { recursive: true });
    fs.writeFileSync(path.join(reg.dir, 'AGENT-CAP-s1.lock'), '');
    const r = callHook(GUARD, root, agentPayload(root));
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(blockRows(root).map((row) => row.kind), ['agent-cap-unjudged']);
});

test('without agent-cap.js beside them the hooks run unchanged (AC16)', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'bare-'));
    for (const f of fs.readdirSync(HOOKS)) if ((f.endsWith('.js') || f.endsWith('.json')) && f !== 'agent-cap.js') fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
    const CRASH = /Cannot find module|TypeError|ReferenceError|SyntaxError/;
    const root = project();
    const guard = path.join(dir, 'guard-unapproved-dispatch.js');
    const denied = callHook(guard, root, agentPayload(root, { seat: 'alfred-code:aspnet-implementer' }));
    assert.strictEqual(denied.status, 2);
    assert.match(denied.stderr, /without an approval gate/);
    const other = callHook(guard, root, agentPayload(root));
    assert.strictEqual(other.status, 0);
    assert.doesNotMatch(other.stderr, CRASH);
    const stop = callHook(path.join(dir, 'guard-stop-contract.js'), root, { hook_event_name: 'Stop', session_id: 's1', cwd: root, background_tasks: [], last_assistant_message: 'Done.' });
    assert.strictEqual(stop.status, 0, stop.stderr);
    assert.doesNotMatch(stop.stderr, CRASH);
    const answer = callHook(path.join(dir, 'guard-answer.js'), root, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: root, prompt: 'hello' }, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' });
    assert.strictEqual(answer.status, 0);
    assert.doesNotMatch(answer.stderr, CRASH);
});

// ---- the events, the Stop half and the start line (Task 4) ----
const STOP = path.join(HOOKS, 'guard-stop-contract.js');
const ANSWER = path.join(HOOKS, 'guard-answer.js');
const stopEnv = (root, extra = {}) => ({ ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...extra });
const stopCall = (root, { env = {}, logEnv, ...extra } = {}) => callHook(STOP, root,
    { hook_event_name: 'Stop', session_id: 's1', cwd: root, last_assistant_message: 'Done.', background_tasks: [], ...extra },
    { ...(logEnv || stopEnv(root)), ...env });
const inflight = (...ids) => ids.map((id) => ({ id, type: 'subagent', status: 'running', agent_type: 'Explore' }));
const deniedAt = (root, body = { at: Date.now(), running: 5, cap: 5 }) =>
{
    const reg = regOf(root);
    fs.mkdirSync(reg.dir, { recursive: true });
    fs.writeFileSync(cap.deniedOf(reg), JSON.stringify(body));
    return reg;
};
const kinds = (root, sid = 's1') => blockRows(root, sid).map((row) => row.kind || (row.detail && row.detail.branch));

test('the generated hooks block wires the guard on SubagentStart, SubagentStop and Task|Agent|SendMessage (AC12)', () =>
{
    const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8')).entries;
    const hooks = entries[0].hooks;
    const wired = (event) => (hooks[event] || []).filter((m) => m.hooks.some((h) => /guard-unapproved-dispatch\.js/.test(h.command)));
    assert.deepStrictEqual(wired('PreToolUse').map((m) => m.matcher), ['Task|Agent|SendMessage']);
    assert.strictEqual(wired('SubagentStart').length, 1);
    assert.strictEqual(wired('SubagentStop').length, 1);
});

test('Stop reconciles by id: the agents not in flight and the main session\'s pendings go, one row (AC15)', () =>
{
    const root = project();
    const reg = regOf(root);
    put(reg, 'R', 'a1', { type: 'Explore', at: Date.now(), parent: '' });
    put(reg, 'R', 'a2', { type: 'Plan', at: Date.now(), parent: '' });
    put(reg, 'P', 'toolu_main', { type: 'Plan', at: Date.now(), parent: '' });
    put(reg, 'P', 'toolu_seat', { type: 'Plan', at: Date.now(), parent: 'a1' });
    assert.strictEqual(stopCall(root, { background_tasks: inflight('agent-a1') }).status, 0);
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-s1-P-toolu_seat', 'AGENT-CAP-s1-R-a1']);
    assert.deepStrictEqual(kinds(root), ['agent-cap-reconciled']);
});

test('Stop reconciles by recency when no id matches (AC15)', () =>
{
    const root = project();
    const reg = regOf(root);
    put(reg, 'R', 'old', { type: 'Explore', at: Date.now() - 3 * MIN, parent: '' });
    put(reg, 'R', 'new', { type: 'Plan', at: Date.now(), parent: '' });
    assert.strictEqual(stopCall(root, { background_tasks: inflight('zz') }).status, 0);
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-s1-R-new']);
    assert.deepStrictEqual(kinds(root), ['agent-cap-reconciled']);
});

test('Stop with no background_tasks deletes nothing and does not continue (AC15)', () =>
{
    const root = project();
    const reg = deniedAt(root);
    put(reg, 'R', 'a1', { type: 'Explore', at: Date.now(), parent: '' });
    assert.strictEqual(stopCall(root, { background_tasks: undefined }).status, 0);
    assert.ok(fs.existsSync(cap.deniedOf(reg)));
    assert.deepStrictEqual(names(reg), ['AGENT-CAP-s1-R-a1', 'AGENT-CAP-s1.denied']);
});

test('a denial with room again continues the turn once, and the next Stop passes (AC15)', () =>
{
    const root = project();
    const reg = deniedAt(root);
    put(reg, 'R', 'a1', { type: 'Explore', at: Date.now(), parent: '' });
    const logEnv = stopEnv(root);
    const first = stopCall(root, { background_tasks: inflight('a1'), logEnv });
    assert.strictEqual(first.status, 2, first.stderr);
    assert.match(first.stderr, /The agent cap denied a dispatch this turn, and 4 of the agents it counted have stopped since - send that dispatch again now\./);
    assert.ok(!fs.existsSync(cap.deniedOf(reg)), '.denied goes before the exit');
    assert.deepStrictEqual(kinds(root), ['agent-cap-continue']);
    const second = stopCall(root, { background_tasks: inflight('a1'), stop_hook_active: true, logEnv });
    assert.strictEqual(second.status, 0, second.stderr);
});

test('still at the cap, a seat\'s Stop, the gates off: no continuation (AC15)', () =>
{
    const full = project();
    const reg = deniedAt(full);
    runningFiles(reg, ['Explore', 'Plan', 'Explore', 'Plan', 'Explore']);
    assert.strictEqual(stopCall(full, { background_tasks: inflight('run0', 'run1', 'run2', 'run3', 'run4') }).status, 0);
    assert.ok(fs.existsSync(cap.deniedOf(reg)));
    const seat = project();
    assert.strictEqual(stopCall(seat, { agent_id: 'seat1', background_tasks: [] }).status, 0);
    deniedAt(seat);
    assert.strictEqual(stopCall(seat, { agent_id: 'seat1', background_tasks: [] }).status, 0);
    assert.ok(fs.existsSync(cap.deniedOf(regOf(seat))));
    for (const env of [{ ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0' }, { ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch:cap' }])
    {
        const root = project();
        const r = deniedAt(root);
        put(r, 'R', 'gone', { type: 'Explore', at: Date.now(), parent: '' });
        assert.strictEqual(stopCall(root, { background_tasks: [], env }).status, 0);
        assert.deepStrictEqual(names(r), ['AGENT-CAP-s1-R-gone', 'AGENT-CAP-s1.denied'], `${JSON.stringify(env)}: no reconcile, no continue`);
    }
    const answerOff = project();
    const r = deniedAt(answerOff);
    put(r, 'R', 'gone', { type: 'Explore', at: Date.now(), parent: '' });
    assert.strictEqual(stopCall(answerOff, { background_tasks: [], env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer' } }).status, 0);
    assert.deepStrictEqual(names(r), ['AGENT-CAP-s1.denied'], 'guard-answer off: reconciled, not continued');
});

test('a Stop that owes the scorer its grade does not continue for the cap (AC15)', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'mode-output-scorer'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'mode-output-scorer', 'SKILL.md'), '---\nname: mode-output-scorer\ndescription: x\n---\n');
    const tp = path.join(root, 'session.jsonl');
    const draft = path.join(root, '.alfred', 'state', 'sessions', 'scorer', 's1', 'x', 'ab12cd34.draft.md');
    fs.writeFileSync(tp, [
        { type: 'user', uuid: 'u1', message: { role: 'user', content: 'go' } },
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: draft, content: 'd' } }] } },
        { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const reg = deniedAt(root);
    const logEnv = stopEnv(root, { ALFRED_CODE_SCORER: '1' });
    const held = stopCall(root, { transcript_path: tp, background_tasks: [], logEnv });
    assert.strictEqual(held.status, 2, held.stderr);
    assert.deepStrictEqual(kinds(root), ['scorer'], 'the scorer holds first');
    const again = stopCall(root, { transcript_path: tp, background_tasks: [], stop_hook_active: true, logEnv });
    assert.strictEqual(again.status, 0, again.stderr);
    assert.ok(fs.existsSync(cap.deniedOf(reg)), 'still owed: the cap does not continue');
});

test('a typed prompt clears .denied, a harness prompt keeps it, and that Stop does not continue (AC15)', () =>
{
    const root = project();
    const reg = deniedAt(root);
    const prompt = (text) => callHook(ANSWER, root, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: root, prompt: text });
    assert.strictEqual(prompt('<task-notification>\n<task-id>x</task-id>\n</task-notification>').status, 0);
    assert.ok(fs.existsSync(cap.deniedOf(reg)), 'a harness prompt is no user turn');
    assert.strictEqual(prompt('now do the docs').status, 0);
    assert.ok(!fs.existsSync(cap.deniedOf(reg)));
    assert.strictEqual(stopCall(root, { background_tasks: [] }).status, 0);
});

test('the start line: none at 5 or unset, the number at 3, no cap at 0 - both answer routes and a seat\'s start (AC18)', () =>
{
    const root = project();
    const ctx = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    const routes = (env) => [
        callHook(ANSWER, root, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: root, prompt: 'hello' }, env),
        callHook(ANSWER, root, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's1', cwd: root }, env),
    ].map(ctx);
    for (const env of [{}, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '5' }]) for (const c of routes(env)) assert.doesNotMatch(c, /Agents at once/);
    for (const c of routes({ ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' })) assert.ok(c.includes('Agents at once: 3 (ALFRED_CODE_MAXIMUM_RUN_AGENTS)'), c);
    for (const c of routes({ ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0' })) assert.ok(c.includes('Agents at once: no cap'), c);
    const start = (env) => ctx(callHook(GUARD, root, { hook_event_name: 'SubagentStart', session_id: 's1', cwd: root, transcript_path: path.join(root, 't.jsonl'), agent_id: 'a9', agent_type: 'Explore' }, env));
    assert.strictEqual(start({ ALFRED_CODE_MAXIMUM_RUN_AGENTS: '3' }), 'Agents at once: 3 (ALFRED_CODE_MAXIMUM_RUN_AGENTS)');
    assert.strictEqual(start({}), '');
});

// ---- the flows (Task 5): every fan-out site names the cap, none keeps the old 3 or says how to lift it (AC11) ----
test('the fan-out flows read ALFRED_CODE_MAXIMUM_RUN_AGENTS: no pinned 3, no lift wording (AC11)', () =>
{
    const STACK = path.join(__dirname, '..', 'stack');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    const texts = walk(STACK).filter((f) => /\.md$/.test(f)).map((f) => [path.relative(STACK, f), fs.readFileSync(f, 'utf8')]);
    assert.deepStrictEqual(texts.filter(([, t]) => /up to 3 (?:implementers )?at once|capped at 3 implementers/.test(t)).map(([f]) => f), []);
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'shared-rules.json'), 'utf8'));
    const reg = (rules.rules || rules)['fan-out-cap'];
    const sites = [reg.owner, ...reg.sites];
    assert.ok(sites.length >= 21, `every S5 site is pinned: ${sites.length}`);
    for (const site of sites)
    {
        const text = fs.readFileSync(path.join(__dirname, '..', site.file), 'utf8');
        assert.ok(text.includes(site.marker), `${site.file}: ${site.marker}`);
        assert.match(site.marker, /ALFRED_CODE_MAXIMUM_RUN_AGENTS|up to the cap|'Agents at once'/, site.file);
        assert.doesNotMatch(text, /\blifts?\b.{0,40}\bcap\b|\bcap\b.{0,40}\blift/i, `${site.file} says how to lift the cap`);
    }
});

test('a resume by agent id is judged after its stopped file is gone - past 2 minutes or a Stop reconcile (round 3 M1)', () =>
{
    const ID = 'a0123456789abcdef';
    const send = (root, to, env) => callHook(GUARD, root, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'toolu_r', session_id: 's1', cwd: root, tool_input: { to, message: 'go on' } }, env);
    const full = project();
    runningFiles(regOf(full), ['Explore', 'Plan']);
    const r = send(full, ID, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' });
    assert.strictEqual(r.status, 2, 'an id-shaped `to` naming no counted agent is a resume');
    assert.match(r.stderr, /^2 of this session's agents are running and ALFRED_CODE_MAXIMUM_RUN_AGENTS is 2: /);
    const room = project();
    runningFiles(regOf(room), ['Explore']);
    assert.strictEqual(send(room, `agent-${ID}`, { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' }).status, 0);
    const [p] = pendings(regOf(room));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(regOf(room).dir, p), 'utf8')).type, 'agent');
    const named = project();
    runningFiles(regOf(named), ['Explore', 'Plan']);
    assert.strictEqual(send(named, 'researcher', { ALFRED_CODE_MAXIMUM_RUN_AGENTS: '2' }).status, 0, 'a name is still out of model');
});
