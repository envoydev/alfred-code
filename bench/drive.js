#!/usr/bin/env node
'use strict';
// The benchmark driver: one run is every (arm, task, rep) cell in a seeded order that interleaves the
// arms, each cell a fresh copy of its arm's template and one measured session.
//
//   node bench/drive.js --arms ours,ecc,bare --tasks <ids|all|group:x> --reps 3 --parallel 3
//                       [--seed n] [--model id --effort e] [--run id] [--resume] [--mode plain]
//
// One driver per run (a lock with its pid), and a resume trusts the disk alone: a finished cell is
// never rerun, a cell another worker still holds is left alone, anything else is wiped and run
// again. A resume re-reads the run's own record and refuses when an arm, a task or the CLI changed
// since the run started - a run is one configuration or it is two runs. Progress prints COUNTS only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const armsLib = require('./lib/arms.js');
const cellsLib = require('./lib/cells.js');
const { cells: order } = require('./lib/shuffle.js');
const lock = require('./lib/lock.js');
const template = require('./lib/template.js');
const session = require('./lib/session.js');
const fixture = require('./fixture/verify.js');

const BENCH_DIR = __dirname;
const DEFAULTS = {
    benchDir: BENCH_DIR,
    armsDir: path.join(BENCH_DIR, 'arms'),
    tasksDir: path.join(BENCH_DIR, 'tasks'),
    pricesFile: path.join(BENCH_DIR, '..', 'meta', 'model-prices.json'),
    preregFile: path.join(BENCH_DIR, 'PREREGISTRATION.md'),
    root: path.join(BENCH_DIR, '..'),
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readTask(dir, id)
{
    const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8'));
    if (meta.id !== id) throw new Error(`task ${id}: meta.json names '${meta.id}'`);
    if (!(typeof meta.timeLimitMin === 'number' && meta.timeLimitMin > 0)) throw new Error(`task ${id}: timeLimitMin is not a positive number`);
    if (typeof meta.startRef !== 'string' || !meta.startRef) throw new Error(`task ${id}: no startRef`);
    const prompt = fs.readFileSync(path.join(dir, id, 'prompt.md'), 'utf8');
    // The start state beyond the ref (session.prepare): each step's patch is part of the task's
    // identity, so a resume refuses a changed one the way it refuses a changed prompt.
    const setup = meta.setup || [];
    if (!Array.isArray(setup)) throw new Error(`task ${id}: setup is not a list`);
    const setupHash = crypto.createHash('sha256');
    setup.forEach((step, i) =>
    {
        if (!step || typeof step.patch !== 'string' || !step.patch) throw new Error(`task ${id}: setup step ${i + 1} names no patch`);
        const file = path.join(dir, id, step.patch);
        if (path.relative(path.join(dir, id), file).startsWith('..') || !fs.existsSync(file)) throw new Error(`task ${id}: setup patch ${step.patch} is not in the task`);
        setupHash.update(JSON.stringify(step)).update(fs.readFileSync(file));
    });
    return {
        id, group: meta.group || null, tags: meta.tags || [], timeLimitMin: meta.timeLimitMin, startRef: meta.startRef, setup,
        prompt, promptSha256: sha256(prompt), setupSha256: setup.length ? setupHash.digest('hex') : null,
    };
}

function selectTasks(dir, spec)
{
    const ids = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'meta.json')))
        .map((e) => e.name)
        .sort();
    const all = ids.map((id) => readTask(dir, id));
    if (spec === 'all')
    {
        if (!all.length) throw new Error(`no tasks in ${dir}`);
        return all;
    }
    if (String(spec).startsWith('group:'))
    {
        const group = spec.slice('group:'.length);
        const picked = all.filter((t) => t.group === group);
        if (!picked.length) throw new Error(`no task in group '${group}'`);
        return picked;
    }
    const wanted = String(spec).split(',').filter(Boolean);
    for (const id of wanted) if (!ids.includes(id)) throw new Error(`no task '${id}' in ${dir}`);
    return all.filter((t) => wanted.includes(t.id));
}

function cliVersion(claude)
{
    try { return execFileSync(claude[0], [...claude.slice(1), '--version'], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH } }).toString().trim(); }
    catch { throw new Error('the claude CLI did not answer --version'); }
}

function harnessCommit(root)
{
    try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
}

function writeJson(file, value)
{
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
}

// Fresh: validate the invocation and write the run's record. Resume: the record IS the invocation,
// and today's arms, tasks and CLI must still match it.
function configure(o, runP, version)
{
    const exists = fs.existsSync(runP.runJson);
    if (!o.resume)
    {
        if (exists) throw new Error(`${o.run} already exists - pass --resume to finish it`);
        if (!Number.isInteger(o.reps) || o.reps < 1) throw new Error(`--reps '${o.reps}' is not a count from 1`);
        if (!Array.isArray(o.arms) || !o.arms.length) throw new Error('--arms names no arm');
        const loaded = armsLib.load({ dir: o.armsDir, names: o.arms, override: { model: o.model, effort: o.effort, cliVersion: version } });
        const tasks = selectTasks(o.tasksDir, o.tasks || 'all');
        const seed = o.seed !== undefined ? o.seed : crypto.randomInt(0, 2 ** 31);
        if (!Number.isInteger(seed)) throw new Error(`--seed '${o.seed}' is not an integer`);
        const prices = fs.readFileSync(o.pricesFile);
        let table = null;
        try { table = JSON.parse(prices); }
        catch { /* named below */ }
        // The analyzer prices a run from this snapshot; a table it cannot read would price every cell at nothing.
        if (!table || !Array.isArray(table.models) || !table.models.length) throw new Error(`the price table ${o.pricesFile} lists no models - the run's cost could not be measured`);
        fs.writeFileSync(runP.prices, prices);
        const theLock = o.lock || fixture.parseLock(fs.readFileSync(fixture.LOCK_FILE, 'utf8'));
        const record = {
            run: o.run, createdAt: new Date().toISOString(), mode: 'plain', seed, reps: o.reps,
            model: loaded.session.model, effort: loaded.session.effort, permissionMode: loaded.session.permissionMode,
            cliVersion: version, harnessCommit: harnessCommit(o.root),
            arms: loaded.arms.map((a) => ({ name: a.name, pin: a.pin, hash: a.hash })),
            tasks: tasks.map(({ prompt, ...t }) => t),
            fixture: { tag: theLock.tag, commit: theLock.commit },
            prereg: fs.existsSync(o.preregFile) ? { sha256: sha256(fs.readFileSync(o.preregFile)) } : null,
            prices: { file: 'prices.json', sha256: sha256(prices) },
            drives: [],
        };
        writeJson(runP.runJson, record);
        return { record, loaded, tasks };
    }
    if (!exists) throw new Error(`${o.run} has no run.json - nothing to resume`);
    const record = JSON.parse(fs.readFileSync(runP.runJson, 'utf8'));
    if (record.cliVersion !== version) throw new Error(`the Claude Code version changed since ${o.run} started (${record.cliVersion} -> ${version})`);
    const loaded = armsLib.load({ dir: o.armsDir, names: record.arms.map((a) => a.name), override: { model: record.model, effort: record.effort, cliVersion: version } });
    for (const a of loaded.arms)
    {
        if (a.hash !== record.arms.find((r) => r.name === a.name).hash) throw new Error(`arm ${a.name} changed since ${o.run} started`);
    }
    const tasks = selectTasks(o.tasksDir, record.tasks.map((t) => t.id).join(','));
    for (const t of tasks)
    {
        const was = record.tasks.find((r) => r.id === t.id);
        if (t.promptSha256 !== was.promptSha256 || (t.setupSha256 || null) !== (was.setupSha256 || null)) throw new Error(`task ${t.id} changed since ${o.run} started`);
    }
    return { record, loaded, tasks };
}

async function drive(opts)
{
    const o = { ...DEFAULTS, parallel: 1, mode: 'plain', claude: ['claude'], base: process.env, log: (l) => console.log(l), platform: process.platform, ...opts };
    if (o.platform === 'win32') throw new Error('the harness runs on macOS and Linux only - its host protection is Claude Code\'s sandbox, which Windows does not have (D4, D12)');
    if (o.mode !== 'plain') throw new Error(`flow mode is not built yet - its scripted approver is carried to B4 (D11); run --mode plain`);
    if (!Number.isInteger(o.parallel) || o.parallel < 1) throw new Error(`--parallel '${o.parallel}' is not a count from 1`);
    const runP = cellsLib.runPaths({ benchDir: o.benchDir, run: o.run });

    const common = armsLib.load({ dir: o.armsDir, names: [] }).session;
    if (!common.auth.some((name) => o.base[name])) throw new Error(`no auth variable is set (${common.auth.join(' or ')}) - the sessions could not call the model`);
    const version = cliVersion(o.claude);

    fs.mkdirSync(runP.dir, { recursive: true });
    const held = lock.acquire(runP.dir);
    if (!held.ok) throw new Error(`${o.run} is being driven by pid ${held.holder}`);
    const startedAt = new Date().toISOString();
    try
    {
        if (held.reclaimed) o.log(`${o.run}: took over the lock of a stopped driver (pid ${held.reclaimed})`);
        const { record, loaded, tasks } = configure(o, runP, version);

        const templates = {};
        for (const arm of loaded.arms)
        {
            const built = template.build({
                arm, session: loaded.session, benchDir: o.benchDir, root: o.root, fixtureSource: o.fixtureSource, lock: o.lock, base: o.base,
                onboard: (prompt, where) => session.onboardSync({ prompt, where, session: loaded.session, claude: o.claude, base: o.base }),
            });
            templates[arm.name] = built.paths;
            o.log(`template ${arm.name}: ${built.built ? 'built' : 'reused'}`);
            const onboarding = path.join(built.paths.dir, 'onboarding');
            if (fs.existsSync(onboarding)) fs.cpSync(onboarding, path.join(runP.dir, 'onboarding', arm.name), { recursive: true });
        }

        const armBy = Object.fromEntries(loaded.arms.map((a) => [a.name, a]));
        const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
        const list = order({ arms: loaded.arms.map((a) => a.name), tasks: tasks.map((t) => t.id), reps: record.reps, seed: record.seed })
            .map((c) => cellsLib.cellPaths({ benchDir: o.benchDir, run: o.run, ...c }));
        const parts = cellsLib.partition(list);
        o.log(`${o.run}: ${list.length} cells - ${parts.done.length} done, ${parts.live.length} live elsewhere, ${parts.todo.length} to run`);

        const counts = { ok: 0, timeout: 0, error: 0, failed: 0 };
        const failures = [];
        const queue = [...parts.todo];
        let finished = 0;
        const worker = async () =>
        {
            while (queue.length)
            {
                const cell = queue.shift();
                const task = taskBy[cell.task];
                try
                {
                    cellsLib.reset(cell);
                    template.copyInto(templates[cell.arm], cell);
                    const rec = await session.run({ cell, prompt: task.prompt, session: loaded.session, arm: armBy[cell.arm], timeLimitMin: task.timeLimitMin, startRef: task.startRef, setup: task.setup, taskDir: path.join(o.tasksDir, task.id), claude: o.claude, base: o.base });
                    counts[rec.outcome] += 1;
                }
                catch (err)
                {
                    counts.failed += 1;
                    failures.push(`${cell.arm}/${cell.task}/r${cell.rep}: ${err.message.split('\n')[0]}`);
                }
                finally
                {
                    // The work dir holds the cell's raw account dir, auth values included: never kept.
                    fs.rmSync(cell.work, { recursive: true, force: true });
                    finished += 1;
                    o.log(`${finished}/${parts.todo.length} - ok ${counts.ok}, timeout ${counts.timeout}, error ${counts.error}, harness failure ${counts.failed}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(o.parallel, parts.todo.length) }, worker));
        for (const f of failures) o.log(`harness failure: ${f}`);
        if (!parts.live.length) fs.rmSync(path.join(o.benchDir, 'work', o.run), { recursive: true, force: true });

        const ran = counts.ok + counts.timeout + counts.error;
        const latest = JSON.parse(fs.readFileSync(runP.runJson, 'utf8'));
        latest.drives.push({ pid: process.pid, startedAt, endedAt: new Date().toISOString(), parallel: o.parallel, ran, failed: counts.failed, skipped: parts.done.length + parts.live.length, counts });
        writeJson(runP.runJson, latest);
        return { ran, failed: counts.failed, skipped: parts.done.length + parts.live.length, counts };
    }
    finally { lock.release(runP.dir); }
}

function parseArgs(argv)
{
    const o = {};
    for (let i = 0; i < argv.length; i++)
    {
        const a = argv[i];
        const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
        if (a === '--arms') o.arms = next().split(',').filter(Boolean);
        else if (a === '--tasks') o.tasks = next();
        else if (a === '--reps') o.reps = Number(next());
        else if (a === '--parallel') o.parallel = Number(next());
        else if (a === '--seed') o.seed = Number(next());
        else if (a === '--model') o.model = next();
        else if (a === '--effort') o.effort = next();
        else if (a === '--mode') o.mode = next();
        else if (a === '--run') o.run = next();
        else if (a === '--resume') o.resume = true;
        else throw new Error(`unknown argument ${a}`);
    }
    if (o.resume && !o.run) throw new Error('--resume needs --run <id>');
    if (!o.run) o.run = `r${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    return o;
}

if (require.main === module)
{
    let o;
    try { o = parseArgs(process.argv.slice(2)); }
    catch (err) { console.error(`drive: ${err.message}`); process.exit(2); }
    drive(o).then(
        (res) => { console.log(`${o.run}: ran ${res.ran}, skipped ${res.skipped}, harness failures ${res.failed}`); process.exitCode = res.failed ? 1 : 0; },
        (err) => { console.error(`drive: ${err.message}`); process.exitCode = 1; });
}

module.exports = { drive, selectTasks, parseArgs, readTask };
