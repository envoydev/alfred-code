#!/usr/bin/env node
'use strict';
// The fixture's own proof, run at the freeze and whenever the harness host changes: every run is a
// fresh clone verified against bench/fixture.lock, then the database, the build and the full suite.
// Three runs serially, then two copies side by side - the case that once starved a shared database
// container. The suite (build + tests + lint) must stay under four minutes; restores are timed but
// never counted, because they measure the network rather than the fixture.
//
//   node bench/fixture/prove.js [--serial 3] [--parallel 2] [--limit 240] [--source <repo>] [--keep]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { verify, parseLock, LOCK_FILE } = require('./verify.js');
const { removeTree } = require('../lib/remove-tree.js');

const BASE_PORT = 55431;

function plan({ serial, parallel })
{
    const rounds = [];
    for (let i = 1; i <= serial; i++) rounds.push([{ id: `s${i}`, port: BASE_PORT }]);
    if (parallel > 0) rounds.push(Array.from({ length: parallel }, (_, i) => ({ id: `p${i + 1}`, port: BASE_PORT + i })));
    return rounds;
}

// What the fixture declares as its build and suite. The last step always runs, even after a failure.
function steps()
{
    return [
        { name: 'database up', cmd: ['docker', 'compose', 'up', '-d', '--wait'], timed: false },
        { name: 'dotnet restore', cmd: ['dotnet', 'restore'], timed: false },
        { name: 'dotnet build', cmd: ['dotnet', 'build', '--no-restore', '-c', 'Release'], timed: true },
        { name: 'dotnet test', cmd: ['dotnet', 'test', '--no-build', '-c', 'Release'], timed: true },
        { name: 'npm ci', cmd: ['npm', 'ci', '--prefix', 'web', '--no-audit', '--no-fund'], timed: false },
        { name: 'web lint', cmd: ['npm', 'run', 'lint', '--prefix', 'web'], timed: true },
        { name: 'web test', cmd: ['npm', 'test', '--prefix', 'web', '--', '--watch=false'], timed: true },
        { name: 'web build', cmd: ['npm', 'run', 'build', '--prefix', 'web'], timed: true },
        { name: 'database down', cmd: ['docker', 'compose', 'down', '-v'], timed: false, always: true },
    ];
}

function suiteSeconds(run)
{
    // Steps are timed to the tenth; the sum is too, or it prints as float drift.
    return Math.round(run.steps.filter((s) => s.timed).reduce((sum, s) => sum + s.seconds, 0) * 10) / 10;
}

function verdict(runs, limit)
{
    if (!runs.length) return { green: false, failures: ['no runs'] };
    const failures = [];
    for (const run of runs)
    {
        const bad = run.steps.find((s) => s.code !== 0);
        if (bad) { failures.push(`${run.id}: ${bad.name} exited ${bad.code}`); continue; }
        const secs = suiteSeconds(run);
        if (secs >= limit) failures.push(`${run.id}: suite took ${secs}s, the limit is under ${limit}s`);
    }
    return { green: failures.length === 0, failures };
}

function exec(cmd, { cwd, env, log })
{
    return new Promise((resolve) =>
    {
        const started = Date.now();
        const child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const out = fs.createWriteStream(log, { flags: 'a' });
        out.write(`\n$ ${cmd.join(' ')}\n`);
        child.stdout.pipe(out, { end: false });
        child.stderr.pipe(out, { end: false });
        child.on('error', (err) => { out.end(`${err.message}\n`); resolve({ code: 127, seconds: (Date.now() - started) / 1000 }); });
        child.on('close', (code) => { out.end(); resolve({ code: code === null ? 1 : code, seconds: Math.round((Date.now() - started) / 100) / 10 }); });
    });
}

async function runOne({ id, port }, { source, lock, workRoot, keep })
{
    const dir = path.join(workRoot, id);
    const log = path.join(workRoot, `${id}.log`);
    const run = { id, port, steps: [] };
    try { verify({ source, lock, dest: dir }); }
    catch (err) { run.steps.push({ name: 'verify', timed: false, seconds: 0, code: 1, error: err.message }); return run; }
    const env = { ...process.env, LENDING_DB_PORT: String(port), COMPOSE_PROJECT_NAME: `bench-fixture-${id}`, CI: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', NG_CLI_ANALYTICS: 'false' };
    let failed = false;
    for (const step of steps())
    {
        if (failed && !step.always) continue;
        const r = await exec(step.cmd, { cwd: dir, env, log });
        run.steps.push({ name: step.name, timed: step.timed, seconds: r.seconds, code: r.code });
        if (r.code !== 0 && !step.always) failed = true;
        console.log(`  ${id} ${step.name}: ${r.code === 0 ? 'ok' : `exit ${r.code}`} ${r.seconds}s`);
    }
    if (!keep) removeTree(dir);
    return run;
}

async function main(argv)
{
    const num = (flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : fallback; };
    const sourceAt = argv.indexOf('--source');
    const source = sourceAt >= 0 ? argv[sourceAt + 1] : path.join(__dirname, '..', '..');
    const limit = num('--limit', 240);
    const lock = parseLock(fs.readFileSync(LOCK_FILE, 'utf8'));
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prove-'));
    console.log(`fixture proof: ${lock.tag} @ ${lock.commit.slice(0, 12)}, logs in ${workRoot}`);
    const runs = [];
    for (const round of plan({ serial: num('--serial', 3), parallel: num('--parallel', 2) }))
        runs.push(...await Promise.all(round.map((copy) => runOne(copy, { source, lock, workRoot, keep: argv.includes('--keep') }))));
    for (const run of runs) console.log(`${run.id}: suite ${suiteSeconds(run)}s, total ${run.steps.reduce((s, x) => s + x.seconds, 0).toFixed(1)}s`);
    const v = verdict(runs, limit);
    console.log(v.green ? `fixture proof: GREEN (${runs.length} runs, limit ${limit}s)` : `fixture proof: RED\n  ${v.failures.join('\n  ')}`);
    return v.green ? 0 : 1;
}

if (require.main === module)
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`fixture proof failed: ${err.message}`); process.exitCode = 1; });

module.exports = { plan, steps, suiteSeconds, verdict };
