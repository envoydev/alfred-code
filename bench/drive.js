#!/usr/bin/env node
'use strict';
// The benchmark driver: one run is every (arm, task, rep) cell in a seeded order that interleaves the
// arms, each cell a fresh copy of its arm's template and one measured session.
//
//   node bench/drive.js --arms ours,ecc,bare --tasks <ids|all|group:x> --reps 3 --parallel 3
//                       [--seed n] [--model id --effort e] [--run id] [--resume] [--mode plain|flow]
//                       [--auth ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN] [--wait-on-limit <hours>]
//                       [--work-root <dir>]
//
// Templates and cell work dirs live under the work root (the OS temp dir by default), never inside
// this repository: the driver refuses a work root with a CLAUDE.md or a .claude/ above it.
//
// One driver per run (a lock with its pid), and a resume trusts the disk alone: a finished cell is
// never rerun, a cell another worker still holds is left alone, anything else is wiped and run
// again. A resume re-reads the run's own record and refuses when an arm, a task or the CLI changed
// since the run started - a run is one configuration or it is two runs. Progress prints COUNTS only.
//
// A usage limit (a subscription's window) is not the arm's fail: the limited cell is set aside
// unfinished, the queue stops taking cells, and the drive either exits with the resume line or, with
// --wait-on-limit, probes every 20 minutes and carries on in the same drive once the limit clears.
// The CLI's version is read again before every session: an update landing mid-run stops the drive,
// because the sessions after it would run a different Claude Code than the run recorded.
//
// --mode flow runs the flow block: only tasks that name a kind (the four the pre-registration names),
// each cell driven through the Agent SDK with the arm's own entry for that kind and a scripted
// approver (lib/flow.js), on the same templates as the plain block. The SDK must be the one built
// for the CLI the run drives, and a resume refuses a changed SDK or a changed flow entry.
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
const { removeTree } = require('./lib/remove-tree.js');
const { pickAuth } = require('./lib/env.js');
const limitLib = require('./lib/limit.js');
const { assertIsolated } = require('./lib/isolation.js');
const poolLib = require('./lib/pool.js');
const flowLib = require('./lib/flow.js');
const readsLib = require('./lib/reads.js');

const BENCH_DIR = __dirname;
const DEFAULTS = {
    benchDir: BENCH_DIR,
    armsDir: path.join(BENCH_DIR, 'arms'),
    tasksDir: path.join(BENCH_DIR, 'tasks'),
    pricesFile: path.join(BENCH_DIR, '..', 'meta', 'model-prices.json'),
    preregFile: path.join(BENCH_DIR, 'PREREGISTRATION.md'),
    root: path.join(BENCH_DIR, '..'),
    probeEveryMs: 20 * 60 * 1000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    probe: limitLib.probe,
    sdk: flowLib.loadSdk,
};
const MODES = ['plain', 'flow'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readTask(dir, id)
{
    const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8'));
    if (meta.id !== id) throw new Error(`task ${id}: meta.json names '${meta.id}'`);
    if (!(typeof meta.timeLimitMin === 'number' && meta.timeLimitMin > 0)) throw new Error(`task ${id}: timeLimitMin is not a positive number`);
    if (typeof meta.startRef !== 'string' || !meta.startRef) throw new Error(`task ${id}: no startRef`);
    // The flow block's tasks name their kind, which picks the arm's own entry (arms/<arm>.json flow).
    if (meta.kind !== undefined && !armsLib.FLOW_KINDS.includes(meta.kind)) throw new Error(`task ${id}: kind '${meta.kind}' is not one of ${armsLib.FLOW_KINDS.join('|')}`);
    // The pool's exclusivity key: true keys the task by its own id (devops-01's shared Docker tag), a name keys every
    // task that names it (the Angular builds, lib/pool.js); absent is none.
    const named = meta.exclusive;
    if (![undefined, true, false].includes(named) && !(typeof named === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(named))) throw new Error(`task ${id}: exclusive ${JSON.stringify(named)} is neither true nor a resource name`);
    const exclusive = named === true ? id : (typeof named === 'string' ? named : null);
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
        exclusive, kind: meta.kind || null,
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

// A flow run: every task names its kind and every arm its entry for it, or nothing is written.
function checkFlow(arms, tasks)
{
    const kindless = tasks.filter((t) => !t.kind).map((t) => t.id);
    if (kindless.length) throw new Error(`flow mode runs only the flow tasks - ${kindless.join(', ')} ${kindless.length > 1 ? 'name' : 'names'} no kind`);
    for (const a of arms) if (!a.flow) throw new Error(`arm ${a.name} names no flow entry (flow in arms/${a.name}.json)`);
}

// Fresh: validate the invocation and write the run's record. Resume: the record IS the invocation,
// and today's arms, tasks and CLI must still match it.
function configure(o, runP, version, authName, workRoot, mode, sdk)
{
    const exists = fs.existsSync(runP.runJson);
    if (!o.resume)
    {
        if (exists) throw new Error(`${o.run} already exists - pass --resume to finish it`);
        if (!Number.isInteger(o.reps) || o.reps < 1) throw new Error(`--reps '${o.reps}' is not a count from 1`);
        if (!Array.isArray(o.arms) || !o.arms.length) throw new Error('--arms names no arm');
        const loaded = armsLib.load({ dir: o.armsDir, names: o.arms, override: { model: o.model, effort: o.effort, cliVersion: version } });
        const tasks = selectTasks(o.tasksDir, o.tasks || 'all');
        if (mode === 'flow') checkFlow(loaded.arms, tasks);
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
            run: o.run, createdAt: new Date().toISOString(), mode, seed, reps: o.reps,
            model: loaded.session.model, effort: loaded.session.effort, permissionMode: loaded.session.permissionMode,
            cliVersion: version, auth: authName, harnessCommit: harnessCommit(o.root), workRoot,
            arms: loaded.arms.map((a) => ({ name: a.name, pin: a.pin, hash: a.hash, ...(mode === 'flow' ? { flowHash: a.flowHash } : {}) })),
            ...(mode === 'flow' ? { sdk: { package: flowLib.SDK_PACKAGE, version: sdk.version, claudeCodeVersion: sdk.claudeCodeVersion } } : {}),
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
    // Named, never a value: the route decides who is billed and which limits a session meets.
    if (record.auth && record.auth !== authName) throw new Error(`the credential changed since ${o.run} started (${record.auth} -> ${authName})`);
    const loaded = armsLib.load({ dir: o.armsDir, names: record.arms.map((a) => a.name), override: { model: record.model, effort: record.effort, cliVersion: version } });
    for (const a of loaded.arms)
    {
        const was = record.arms.find((r) => r.name === a.name);
        if (a.hash !== was.hash) throw new Error(`arm ${a.name} changed since ${o.run} started`);
        if (mode === 'flow' && a.flowHash !== was.flowHash) throw new Error(`arm ${a.name}'s flow entry changed since ${o.run} started`);
    }
    if (mode === 'flow' && (record.sdk || {}).version !== sdk.version) throw new Error(`the Agent SDK changed since ${o.run} started (${(record.sdk || {}).version} -> ${sdk.version})`);
    const tasks = selectTasks(o.tasksDir, record.tasks.map((t) => t.id).join(','));
    for (const t of tasks)
    {
        const was = record.tasks.find((r) => r.id === t.id);
        // The kind picks a flow cell's entry, so in a flow run it is part of the task like its prompt.
        const kindChanged = mode === 'flow' && (t.kind || null) !== (was.kind || null);
        if (t.promptSha256 !== was.promptSha256 || (t.setupSha256 || null) !== (was.setupSha256 || null) || kindChanged) throw new Error(`task ${t.id} changed since ${o.run} started`);
    }
    return { record, loaded, tasks };
}

// Fresh: the passed work root, else the default. Resume: the one the run recorded - a run started
// before there was one ran under the bench dir, which the isolation check then refuses.
function resolveWorkRoot(o, runP)
{
    let root = o.workRoot || cellsLib.defaultWorkRoot();
    if (o.resume && fs.existsSync(runP.runJson))
    {
        const recorded = cellsLib.workRootOf(JSON.parse(fs.readFileSync(runP.runJson, 'utf8')), o.benchDir);
        const real = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };
        if (o.workRoot && real(o.workRoot) !== real(recorded)) throw new Error(`${o.run} runs under ${recorded} - not ${path.resolve(o.workRoot)}`);
        root = recorded;
    }
    assertIsolated(root, 'the work root', { inclusive: true });
    fs.mkdirSync(root, { recursive: true });
    return fs.realpathSync(root);
}

async function drive(opts)
{
    const o = { ...DEFAULTS, parallel: 1, claude: ['claude'], docker: ['docker'], base: process.env, log: (l) => console.log(l), platform: process.platform, ...opts };
    if (o.platform === 'win32') throw new Error('the harness runs on macOS and Linux only - its host protection is Claude Code\'s sandbox, which Windows does not have (D4, D12)');
    if (o.mode !== undefined && !MODES.includes(o.mode)) throw new Error(`--mode '${o.mode}' is not ${MODES.join(' or ')}`);
    if (!Number.isInteger(o.parallel) || o.parallel < 1) throw new Error(`--parallel '${o.parallel}' is not a count from 1`);
    if (o.waitOnLimit !== undefined && !(o.waitOnLimit > 0)) throw new Error(`--wait-on-limit '${o.waitOnLimit}' is not a number of hours above 0`);
    const runP = cellsLib.runPaths({ benchDir: o.benchDir, run: o.run });

    const common = armsLib.load({ dir: o.armsDir, names: [] }).session;
    const authName = pickAuth(common.auth, o.base, o.auth);
    const versionOf = o.versionOf || cliVersion;
    const version = versionOf(o.claude);

    fs.mkdirSync(runP.dir, { recursive: true });
    const held = lock.acquire(runP.dir);
    if (!held.ok) throw new Error(`${o.run} is being driven by pid ${held.holder}`);
    const startedAt = new Date().toISOString();
    try
    {
        if (held.reclaimed) o.log(`${o.run}: took over the lock of a stopped driver (pid ${held.reclaimed})`);
        const workRoot = resolveWorkRoot(o, runP);
        // A resume is the mode the run recorded; a --mode naming another is refused, never mixed in.
        let mode = o.mode || 'plain';
        if (o.resume && fs.existsSync(runP.runJson))
        {
            const recorded = JSON.parse(fs.readFileSync(runP.runJson, 'utf8')).mode || 'plain';
            if (o.mode && o.mode !== recorded) throw new Error(`${o.run} is a ${recorded} run - not ${o.mode}`);
            mode = recorded;
        }
        let sdk = null;
        let cli = null;
        if (mode === 'flow')
        {
            sdk = await o.sdk();
            flowLib.assertSdkMatches(sdk, version);
            cli = flowLib.cliPath(o.claude, o.base.PATH);
        }
        const { record, loaded, tasks } = configure(o, runP, version, authName, workRoot, mode, sdk);

        // One uv cache and one Python store for every template and cell: an MCP server launched through
        // uvx is installed once, at the template's warm-up, and starts inside the connect timeout after.
        const shared = { UV_CACHE_DIR: path.join(workRoot, 'uv', 'cache'), UV_PYTHON_INSTALL_DIR: path.join(workRoot, 'uv', 'python') };
        const templates = {};
        for (const arm of loaded.arms)
        {
            const built = template.build({
                arm, session: loaded.session, benchDir: o.benchDir, workRoot, root: o.root, fixtureSource: o.fixtureSource, lock: o.lock, base: o.base, auth: authName, claude: o.claude, shared,
                onboard: (prompt, where) => session.onboardSync({ prompt, where, session: loaded.session, claude: o.claude, base: o.base }),
            });
            templates[arm.name] = built.paths;
            o.log(`template ${arm.name}: ${built.built ? 'built' : 'reused'}`);
            const kept = path.join(runP.dir, 'onboarding', arm.name);
            const onboarding = path.join(built.paths.dir, 'onboarding');
            if (fs.existsSync(onboarding)) fs.cpSync(onboarding, kept, { recursive: true });
            // What the template installed and was granted, beside its onboarding: what the B4 read checks.
            for (const name of ['plugins.json', 'grants.json', 'mcp-warm.txt'])
            {
                const file = path.join(built.paths.dir, name);
                if (!fs.existsSync(file)) continue;
                fs.mkdirSync(kept, { recursive: true });
                fs.copyFileSync(file, path.join(kept, name));
            }
        }

        // What no cell may read (lib/reads.js): this checkout and, for a worktree, the main one that holds it.
        const hostRoots = readsLib.hostRoots(o.root);
        const armBy = Object.fromEntries(loaded.arms.map((a) => [a.name, a]));
        const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
        const list = order({ arms: loaded.arms.map((a) => a.name), tasks: tasks.map((t) => t.id), reps: record.reps, seed: record.seed })
            .map((c) => cellsLib.cellPaths({ benchDir: o.benchDir, workRoot, run: o.run, ...c }));
        const parts = cellsLib.partition(list);
        o.log(`${o.run}: ${list.length} cells - ${parts.done.length} done, ${parts.live.length} live elsewhere, ${parts.todo.length} to run`);

        const counts = { ok: 0, timeout: 0, error: 0, limited: 0, failed: 0 };
        const failures = [];
        const queue = [...parts.todo];
        const limited = [];
        const pauses = [];
        let paused = null;
        let stopped = null;
        let total = parts.todo.length;
        let finished = 0;
        // A task's exclusive key (meta.json, readTask) is the pool's only exclusivity: no two cells holding
        // the same key run at once, whatever arm or rep. devops-01 keys by its own id, because three arms
        // built and removed the same Docker tag on the shared daemon within 19 s in pilot 2. Every task
        // that changes web/ shares 'angular-build', because in pilot 4 every Angular build that overlapped
        // another cell's production build ran 2-30x slower, and the production builds that overlapped each
        // other either hit the Bash tool's timeout (three, the run's infra cells) or took 376-383 s. Every
        // other task keeps the run's own parallelism - its key is null, so the pool never serializes it.
        const cellTask = async (cell) =>
        {
            const task = taskBy[cell.task];
            try
            {
                cellsLib.reset(cell);
                template.copyInto(templates[cell.arm], cell);
                const driver = mode === 'flow' ? flowLib.driver({ sdk, cli, prompts: armBy[cell.arm].flow[task.kind] }) : undefined;
                const reads = readsLib.cellReads({ cell, workRoot, hostRoots, pluginSources: readsLib.pluginSourcesOf(cell) });
                const rec = await session.run({ cell, prompt: task.prompt, session: loaded.session, arm: armBy[cell.arm], timeLimitMin: task.timeLimitMin, startRef: task.startRef, setup: task.setup, taskDir: path.join(o.tasksDir, task.id), claude: o.claude, docker: o.docker, base: o.base, auth: authName, shared, reads, driver });
                counts[rec.outcome] += 1;
                if (rec.outcome === 'limited')
                {
                    limited.push(cell);
                    if (!paused) paused = { startedAt: new Date().toISOString(), text: rec.limitText, probes: 0 };
                }
            }
            catch (err)
            {
                counts.failed += 1;
                failures.push(`${cell.arm}/${cell.task}/r${cell.rep}: ${err.message.split('\n')[0]}`);
            }
            finally
            {
                // The work dir holds the cell's raw account dir, auth values included: never kept.
                removeTree(cell.work);
                finished += 1;
                o.log(`${finished}/${total} - ok ${counts.ok}, timeout ${counts.timeout}, error ${counts.error}, limited ${counts.limited}, harness failure ${counts.failed}`);
            }
        };
        // stop() is read before every dequeue, never mid-item: a version drift or a limit must stop the
        // pool from STARTING a new cell, exactly where the old inline check ran, but an already-started
        // cell always finishes.
        const shouldStop = () =>
        {
            if (paused || stopped) return true;
            const now = versionOf(o.claude);
            if (now !== record.cliVersion)
            {
                stopped = stopped || `the Claude Code version changed mid-run (${record.cliVersion} -> ${now})`;
                return true;
            }
            return false;
        };
        const workers = () => poolLib.run({ queue, parallel: o.parallel, exclusiveKey: (cell) => taskBy[cell.task].exclusive, stop: shouldStop, task: cellTask });
        await workers();
        let waitedMs = 0;
        while (paused)
        {
            // A limited cell goes back to the FRONT: it re-runs from scratch before anything new starts.
            total += limited.length;
            queue.unshift(...limited.splice(0));
            if (stopped || !o.waitOnLimit || waitedMs >= o.waitOnLimit * 3600 * 1000) break;
            await o.sleep(o.probeEveryMs);
            waitedMs += o.probeEveryMs;
            paused.probes += 1;
            const p = await o.probe({ claude: o.claude, session: loaded.session, base: o.base, auth: authName });
            if (!p.ok) { paused.lastProbe = p.text; continue; }
            paused.endedAt = new Date().toISOString();
            pauses.push(paused);
            paused = null;
            // The budget is per pause: a subscription's next window gets its own hours.
            waitedMs = 0;
            o.log(`${o.run}: the limit cleared after ${pauses[pauses.length - 1].probes} probes - carrying on`);
            await workers();
        }
        if (paused)
        {
            pauses.push(paused);
            if (!stopped) o.log(`paused: usage limit (${paused.text})${paused.lastProbe ? `, last probe: ${paused.lastProbe}` : ''} - node bench/drive.js --run ${o.run} --resume`);
        }
        if (stopped) o.log(`stopped: ${stopped} - put ${record.cliVersion} back and resume, or start a new run`);
        for (const f of failures) o.log(`harness failure: ${f}`);
        if (!parts.live.length) removeTree(path.join(workRoot, o.run));

        const ran = counts.ok + counts.timeout + counts.error;
        const latest = JSON.parse(fs.readFileSync(runP.runJson, 'utf8'));
        latest.drives.push({ pid: process.pid, startedAt, endedAt: new Date().toISOString(), parallel: o.parallel, ran, failed: counts.failed, skipped: parts.done.length + parts.live.length, counts, pauses, stopped });
        writeJson(runP.runJson, latest);
        return { ran, failed: counts.failed, skipped: parts.done.length + parts.live.length, counts, paused: Boolean(paused), stopped };
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
        else if (a === '--auth') o.auth = next();
        else if (a === '--wait-on-limit') o.waitOnLimit = Number(next());
        else if (a === '--work-root') o.workRoot = path.resolve(next());
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
        (res) => { console.log(`${o.run}: ran ${res.ran}, skipped ${res.skipped}, limited ${res.counts.limited}, harness failures ${res.failed}${res.stopped ? ` - stopped: ${res.stopped}` : res.paused ? ' - paused on a usage limit' : ''}`); process.exitCode = res.failed || res.stopped ? 1 : 0; },
        (err) => { console.error(`drive: ${err.message}`); process.exitCode = 1; });
}

module.exports = { drive, selectTasks, parseArgs, readTask };
