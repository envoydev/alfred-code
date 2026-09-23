'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { drive, selectTasks } = require('./drive.js');

const { makeWorld } = require('./test/world.js');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

function world(t)
{
    const w = makeWorld(t, {
        arms: { a1: { env: { FAKE_EDIT: 'a1.txt' } }, a2: { env: { FAKE_EDIT: 'a2.txt' }, onboarding: ['/init'] } },
        tasks: { t1: { group: 'api' }, t2: { group: 'web' } },
    });
    w.opts.reps = 2;
    return w;
}

const sessions = (bench) =>
{
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'session.json') out.push(p); } };
    walk(path.join(bench, 'results', 'r-test'));
    return out.sort();
};

test('a 2 arms x 2 tasks x 2 reps run completes, records itself, and reports counts only', async (t) =>
{
    const w = world(t);
    const res = await drive(w.opts);
    assert.deepStrictEqual([res.ran, res.failed, res.skipped], [8, 0, 0]);
    assert.strictEqual(sessions(w.bench).length, 8);
    const run = JSON.parse(fs.readFileSync(path.join(w.bench, 'results', 'r-test', 'run.json'), 'utf8'));
    assert.strictEqual(run.seed, 7);
    assert.deepStrictEqual(run.arms.map((a) => a.name), ['a1', 'a2']);
    assert.ok(run.arms.every((a) => /^[0-9a-f]{64}$/.test(a.hash)));
    assert.strictEqual(run.cliVersion, '0.0.0-fake (Claude Code)');
    assert.strictEqual(run.prices.sha256, sha(w.prices));
    assert.strictEqual(sha(path.join(w.bench, 'results', 'r-test', 'prices.json')), sha(w.prices));
    assert.strictEqual(run.prereg, null);
    assert.deepStrictEqual(run.tasks.map((x) => x.id), ['t1', 't2']);
    assert.ok(!fs.existsSync(path.join(w.bench, 'work', 'r-test')), 'no cell work dir outlives its cell');
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test', '.lock')), 'the run lock is released');
    for (const l of w.lines) assert.doesNotMatch(l, /Do t[12]/, 'progress never prints a prompt');
    assert.ok(w.lines.some((l) => /8\/8/.test(l)));
    const onboarding = path.join(w.bench, 'results', 'r-test', 'onboarding', 'a2', '1.jsonl');
    assert.ok(fs.existsSync(onboarding), 'the onboarding transcript is kept with the run');
    assert.ok(!fs.readFileSync(onboarding, 'utf8').includes('world-test-auth-value-0123456789'));
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test', 'onboarding', 'a1')), 'an arm with no onboarding has none');
});

test('--resume after a killed driver runs only the cells it left unfinished', async (t) =>
{
    const w = world(t);
    await drive(w.opts);
    const all = sessions(w.bench);
    const before = new Map(all.map((f) => [f, fs.readFileSync(f, 'utf8')]));
    for (const f of all.slice(0, 3)) fs.rmSync(f);
    const runDir = path.join(w.bench, 'results', 'r-test');
    fs.mkdirSync(path.join(runDir, '.lock'));
    fs.writeFileSync(path.join(runDir, '.lock', 'pid'), `${deadPid()}\n`);
    const res = await drive({ ...w.opts, resume: true, seed: undefined, reps: undefined, arms: undefined, tasks: undefined });
    assert.deepStrictEqual([res.ran, res.skipped], [3, 5]);
    for (const f of all.slice(3)) assert.strictEqual(fs.readFileSync(f, 'utf8'), before.get(f), 'a finished cell is never rerun');
    assert.strictEqual(sessions(w.bench).length, 8);
});

test('a second driver on the same run refuses', async (t) =>
{
    const w = world(t);
    const runDir = path.join(w.bench, 'results', 'r-test');
    fs.mkdirSync(path.join(runDir, '.lock'), { recursive: true });
    fs.writeFileSync(path.join(runDir, '.lock', 'pid'), `${process.ppid}\n`);
    await assert.rejects(drive(w.opts), /r-test is being driven by pid/);
});

test('no auth variable set is refused before anything is built', async (t) =>
{
    const w = world(t);
    await assert.rejects(drive({ ...w.opts, base: { PATH: process.env.PATH } }), /no auth variable is set \(ANTHROPIC_API_KEY\)/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test')));
});

test('a run is never restarted over itself, and a resume refuses an arm changed since it started', async (t) =>
{
    const w = world(t);
    await drive({ ...w.opts, reps: 1 });
    await assert.rejects(drive({ ...w.opts, reps: 1 }), /r-test already exists - pass --resume/);
    const armFile = path.join(w.opts.armsDir, 'a1.json');
    fs.writeFileSync(armFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(armFile, 'utf8')), env: { FAKE_EDIT: 'other.txt' } }));
    await assert.rejects(drive({ ...w.opts, resume: true }), /arm a1 changed since r-test started/);
});

test('flow mode is refused until its approver exists', async (t) =>
{
    const w = world(t);
    await assert.rejects(drive({ ...w.opts, mode: 'flow' }), /flow mode/);
});

test('tasks select by id list, all, or group', (t) =>
{
    const w = world(t);
    assert.deepStrictEqual(selectTasks(w.opts.tasksDir, 'all').map((x) => x.id), ['t1', 't2']);
    assert.deepStrictEqual(selectTasks(w.opts.tasksDir, 'group:web').map((x) => x.id), ['t2']);
    assert.deepStrictEqual(selectTasks(w.opts.tasksDir, 't2,t1').map((x) => x.id), ['t1', 't2']);
    assert.throws(() => selectTasks(w.opts.tasksDir, 't9'), /no task 't9'/);
    assert.throws(() => selectTasks(w.opts.tasksDir, 'group:none'), /no task in group 'none'/);
});

test('the command line: every flag parsed, a resume needs its run, an unknown flag is named', () =>
{
    const { parseArgs } = require('./drive.js');
    const o = parseArgs(['--arms', 'ours,bare', '--tasks', 'group:api', '--reps', '3', '--parallel', '2', '--seed', '9', '--model', 'claude-opus-5-5', '--effort', 'high', '--run', 'r1']);
    assert.deepStrictEqual(o, { arms: ['ours', 'bare'], tasks: 'group:api', reps: 3, parallel: 2, seed: 9, model: 'claude-opus-5-5', effort: 'high', run: 'r1' });
    assert.match(parseArgs(['--arms', 'ours']).run, /^r\d{8}T\d{6}$/);
    assert.throws(() => parseArgs(['--resume']), /--resume needs --run/);
    assert.throws(() => parseArgs(['--rep', '3']), /unknown argument --rep/);
    assert.throws(() => parseArgs(['--reps']), /--reps needs a value/);
});
