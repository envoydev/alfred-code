'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('./test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { drive, selectTasks } = require('./drive.js');

const { makeWorld, OAUTH } = require('./test/world.js');
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

// Every arm's sessions share one FAKE_LIMIT_FILE: from the nth session started, each ends on a limit.
function limitWorld(t, from, extra = {})
{
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bench-limit-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const limitFile = path.join(dir, 'limit.json');
    fs.writeFileSync(limitFile, JSON.stringify({ from }));
    const env = { FAKE_LIMIT_FILE: limitFile };
    const w = makeWorld(t, { arms: { a1: { env }, a2: { env } }, tasks: { t1: {}, t2: {} } });
    Object.assign(w.opts, { reps: 1, parallel: 1 }, extra);
    w.limitFile = limitFile;
    w.started = () => { try { return fs.statSync(`${limitFile}.count`).size; } catch { return 0; } };
    w.setAside = () => { try { return fs.readdirSync(path.join(w.runDir, 'limited')); } catch { return []; } };
    w.record = () => JSON.parse(fs.readFileSync(path.join(w.runDir, 'run.json'), 'utf8'));
    return w;
}

test('a usage limit stops the queue: the limited cell is set aside unfinished, and no later cell starts', async (t) =>
{
    const w = limitWorld(t, 2);
    const res = await drive(w.opts);
    assert.deepStrictEqual([res.counts.ok, res.counts.limited, res.ran, res.paused], [1, 1, 1, true]);
    assert.strictEqual(sessions(w.bench).length, 1);
    assert.strictEqual(w.setAside().length, 1);
    assert.strictEqual(w.started(), 2, 'cells 3 and 4 never started');
    assert.ok(w.lines.includes('paused: usage limit (Claude AI usage limit reached|1790000000) - node bench/drive.js --run r-test --resume'), w.lines.join('\n'));
    const first = w.record().drives[0];
    assert.strictEqual(first.counts.limited, 1);
    assert.deepStrictEqual(first.pauses.map((p) => [Boolean(p.startedAt), Boolean(p.endedAt), p.text]), [[true, false, 'Claude AI usage limit reached|1790000000']]);
});

test('a resume after the limit re-runs the set-aside cell from scratch and keeps the set-aside copy', async (t) =>
{
    const w = limitWorld(t, 2);
    await drive(w.opts);
    fs.rmSync(w.limitFile);
    const res = await drive({ ...w.opts, resume: true });
    assert.deepStrictEqual([res.ran, res.skipped, res.counts.limited, res.paused], [3, 1, 0, false]);
    assert.strictEqual(sessions(w.bench).length, 4);
    assert.strictEqual(w.setAside().length, 1);
});

test('cells running in parallel when the limit lands are all set aside, none finished', async (t) =>
{
    const w = limitWorld(t, 1, { parallel: 2 });
    const res = await drive(w.opts);
    assert.deepStrictEqual([res.counts.limited, res.ran, res.paused], [2, 0, true]);
    assert.strictEqual(sessions(w.bench).length, 0);
    assert.strictEqual(w.setAside().length, 2);
    assert.strictEqual(w.started(), 2);
});

test('--wait-on-limit probes until the limit clears, then finishes the run in the same drive', async (t) =>
{
    const w = limitWorld(t, 2);
    let probes = 0;
    const probe = async ({ auth }) =>
    {
        probes += 1;
        assert.strictEqual(auth, 'ANTHROPIC_API_KEY');
        if (probes < 3) return { ok: false, text: 'still limited' };
        fs.rmSync(w.limitFile);
        return { ok: true, text: null };
    };
    const res = await drive({ ...w.opts, waitOnLimit: 1, sleep: async () => {}, probe });
    assert.strictEqual(probes, 3);
    assert.deepStrictEqual([res.ran, res.counts.limited, res.paused], [4, 1, false]);
    assert.strictEqual(sessions(w.bench).length, 4);
    const pause = w.record().drives[0].pauses[0];
    assert.ok(pause.startedAt && pause.endedAt);
    assert.strictEqual(pause.probes, 3);
});

test('--wait-on-limit gives up after its hours and leaves the run resumable', async (t) =>
{
    const w = limitWorld(t, 2);
    let probes = 0;
    const res = await drive({ ...w.opts, waitOnLimit: 0.5, sleep: async () => {}, probe: async () => { probes += 1; return { ok: false, text: 'still limited' }; } });
    assert.strictEqual(probes, 2, 'probes at 20 and 40 minutes, then half an hour is spent');
    assert.deepStrictEqual([res.ran, res.paused], [1, true]);
    assert.ok(w.lines.includes('paused: usage limit (Claude AI usage limit reached|1790000000), last probe: still limited - node bench/drive.js --run r-test --resume'), w.lines.join('\n'));
    assert.strictEqual(w.record().drives[0].pauses[0].lastProbe, 'still limited');
    fs.rmSync(w.limitFile);
    assert.strictEqual((await drive({ ...w.opts, resume: true })).ran, 3);
});

test('--wait-on-limit is a budget PER pause: a second limit in the same drive gets its own hours', async (t) =>
{
    const w = limitWorld(t, 2);
    let probes = 0;
    const probe = async () =>
    {
        probes += 1;
        if (probes > 1) return { ok: false, text: 'still limited' };
        // The first pause clears; the limit comes back two sessions later (the re-run passes, the next cell hits it).
        fs.writeFileSync(w.limitFile, JSON.stringify({ from: 4 }));
        return { ok: true, text: null };
    };
    const res = await drive({ ...w.opts, waitOnLimit: 0.5, sleep: async () => {}, probe });
    assert.deepStrictEqual(w.record().drives[0].pauses.map((p) => p.probes), [1, 2]);
    assert.deepStrictEqual([res.ran, res.paused], [2, true]);
});

test('--wait-on-limit is a number of hours above 0', async (t) =>
{
    const { parseArgs } = require('./drive.js');
    assert.strictEqual(parseArgs(['--arms', 'bare', '--wait-on-limit', '12']).waitOnLimit, 12);
    const w = world(t);
    for (const bad of [0, -1, Number.NaN]) await assert.rejects(drive({ ...w.opts, waitOnLimit: bad }), /--wait-on-limit '.*' is not a number of hours above 0/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test')));
});

test('a Claude Code update mid-run stops the drive before the next session, never mixing versions', async (t) =>
{
    const w = world(t);
    let calls = 0;
    const OLD = '0.0.0-fake (Claude Code)';
    const NEW = '0.0.1-fake (Claude Code)';
    // Call 1 is the drive's start; calls 2 and 3 come before cells 1 and 2; the update lands before cell 3.
    const versionOf = () => { calls += 1; return calls <= 3 ? OLD : NEW; };
    const res = await drive({ ...w.opts, parallel: 1, versionOf, waitOnLimit: 1, sleep: async () => { throw new Error('a version change is never waited out'); } });
    assert.deepStrictEqual([res.ran, res.stopped], [2, `the Claude Code version changed mid-run (${OLD} -> ${NEW})`]);
    assert.strictEqual(sessions(w.bench).length, 2);
    assert.ok(w.lines.includes(`stopped: the Claude Code version changed mid-run (${OLD} -> ${NEW}) - put ${OLD} back and resume, or start a new run`), w.lines.join('\n'));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w.runDir, 'run.json'), 'utf8')).drives[0].stopped, res.stopped);
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
    await assert.rejects(drive({ ...w.opts, base: { PATH: process.env.PATH } }), /no auth variable is set \(ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN\)/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test')));
});

test('two credentials and no --auth are refused before anything is built', async (t) =>
{
    const w = world(t);
    await assert.rejects(drive({ ...w.opts, base: { ...w.opts.base, CLAUDE_CODE_OAUTH_TOKEN: OAUTH } }),
        /more than one auth variable is set \(ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN\) - pass --auth <name>/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test')));
});

test('--auth picks the credential: run.json names it, and only it reaches a session', async (t) =>
{
    const rec = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bench-rec-')), 'record.json');
    t.after(() => fs.rmSync(path.dirname(rec), { recursive: true, force: true }));
    const w = makeWorld(t, { arms: { a1: { env: { FAKE_RECORD: rec } } }, tasks: { t1: {} } });
    await drive({ ...w.opts, base: { ...w.opts.base, CLAUDE_CODE_OAUTH_TOKEN: OAUTH }, auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w.runDir, 'run.json'), 'utf8')).auth, 'CLAUDE_CODE_OAUTH_TOKEN');
    const seen = JSON.parse(fs.readFileSync(rec, 'utf8')).env;
    assert.strictEqual(seen.CLAUDE_CODE_OAUTH_TOKEN, OAUTH);
    assert.ok(!('ANTHROPIC_API_KEY' in seen), 'the API key in the shell never reached the session');
});

test('a resume under a different credential is refused', async (t) =>
{
    const w = world(t);
    await drive({ ...w.opts, reps: 1, base: { PATH: process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: OAUTH } });
    await assert.rejects(drive({ ...w.opts, reps: 1, resume: true }), /the credential changed since r-test started \(CLAUDE_CODE_OAUTH_TOKEN -> ANTHROPIC_API_KEY\)/);
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

test('Windows is refused before anything is built', async (t) =>
{
    const w = world(t);
    await assert.rejects(drive({ ...w.opts, platform: 'win32' }), /macOS and Linux only/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test')));
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

test('a setup step must name a patch the task carries, and a changed patch refuses a resume', async (t) =>
{
    const bad = makeWorld(t, { arms: { a1: {} }, tasks: { t1: { setup: [{ patch: 'missing.patch' }] } } });
    assert.throws(() => selectTasks(bad.opts.tasksDir, 'all'), /task t1: setup patch missing\.patch is not in the task/);
    const odd = makeWorld(t, { arms: { a1: {} }, tasks: { t1: { setup: [{ commitOn: 'x' }] } } });
    assert.throws(() => selectTasks(odd.opts.tasksDir, 'all'), /task t1: setup step 1 names no patch/);

    const w = makeWorld(t, {
        arms: { a1: { env: { FAKE_EDIT: 'a1.txt' } } },
        tasks: { t1: { setup: [{ patch: 'wip.patch' }], files: { 'wip.patch': 'diff --git a/wip.txt b/wip.txt\nnew file mode 100644\n--- /dev/null\n+++ b/wip.txt\n@@ -0,0 +1 @@\n+one\n' } } },
    });
    const [task] = selectTasks(w.opts.tasksDir, 'all');
    assert.deepStrictEqual(task.setup, [{ patch: 'wip.patch' }]);
    assert.match(task.setupSha256, /^[0-9a-f]{64}$/);
    await drive(w.opts);
    fs.appendFileSync(path.join(w.opts.tasksDir, 't1', 'wip.patch'), ' ');
    await assert.rejects(drive({ ...w.opts, resume: true }), /task t1 changed since r-test started/);
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
    assert.strictEqual(parseArgs(['--arms', 'bare', '--auth', 'CLAUDE_CODE_OAUTH_TOKEN']).auth, 'CLAUDE_CODE_OAUTH_TOKEN');
    assert.throws(() => parseArgs(['--auth']), /--auth needs a value/);
});

test('a price table with no models is refused before anything is built', async (t) =>
{
    const w = world(t);
    const bad = path.join(w.dir, 'bad-prices.json');
    fs.writeFileSync(bad, '{"models":{}}');
    await assert.rejects(drive({ ...w.opts, pricesFile: bad }), /price table .* lists no models/);
    assert.ok(!fs.existsSync(path.join(w.bench, 'results', 'r-test', 'run.json')));
});
