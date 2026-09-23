#!/usr/bin/env node
'use strict';
// The free half of the tasks' solvability proof: per task, a fresh verified clone of the locked
// fixture at the task's start state (its ref and setup), where the hidden tests must FAIL; then a
// second clone with the task's reference.patch applied, where the hidden tests must PASS and the
// full suite stay green - the order the grader uses, so a reference that only passes because the
// hidden files landed first is caught. A task that fails either check is rewritten before any session
// runs on it. No model call; results land in results/prove-<stamp>/ (gitignored).
//
//   node bench/prove-tasks.js [--tasks all|<id,id>|group:<g>]
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const fixture = require('./fixture/verify.js');
const { selectTasks } = require('./drive.js');
const { prepare, git } = require('./lib/session.js');
const { copyHidden, detectInfra } = require('./lib/grade.js');
const { POSIX_ONLY } = require('./test/posix-only.js');

const BENCH_DIR = __dirname;
// What a session never gets, the proof does not need either: the commands run with the caller's
// warm package caches, minus every credential the arm files name.
const DROP = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'CLAUDE_PROJECT_DIR', 'CLAUDE_STACK_DOCS_PATH'];

function cloneAt({ dest, task, taskDir, fixtureSource, lock })
{
    fs.rmSync(dest, { recursive: true, force: true });
    fixture.verify({ source: fixtureSource, lock, dest });
    execFileSync('git', ['-C', dest, 'remote', 'remove', 'origin'], { stdio: 'pipe' });
    const cell = { repo: dest, home: path.join(path.dirname(dest), '.home') };
    fs.mkdirSync(cell.home, { recursive: true });
    prepare({ cell, startRef: task.startRef, setup: task.setup, taskDir, task: task.id });
    return cell;
}

function runAll(list, { cwd, env, timeoutMs, log })
{
    let text = '';
    let timedOut = false;
    const pass = (list || []).every((argv) =>
    {
        const r = spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
        const body = `${r.stdout || ''}${r.stderr || ''}`;
        text += body;
        log(`$ ${argv.join(' ')}\n${body}`);
        if (r.error && r.error.code === 'ETIMEDOUT') timedOut = true;
        return r.status === 0;
    });
    return { pass, infra: timedOut ? 'command timed out' : detectInfra(text) };
}

function proveTask({ task, tasksDir, workDir, fixtureSource, lock, env, log })
{
    const taskDir = path.join(tasksDir, task.id);
    const out = { id: task.id, group: task.group, ok: false, startFails: null, referencePasses: null, suiteGreen: null, infra: null, problems: [] };
    const spec = JSON.parse(fs.readFileSync(path.join(taskDir, 'hidden', 'grade.json'), 'utf8'));
    const timeoutMs = (spec.timeoutMin || 30) * 60 * 1000;
    const reference = path.join(taskDir, 'reference.patch');
    if (!fs.existsSync(reference))
    {
        out.problems.push('no reference.patch');
        return out;
    }

    const start = cloneAt({ dest: path.join(workDir, task.id, 'start'), task, taskDir, fixtureSource, lock });
    copyHidden(path.join(taskDir, 'hidden'), start.repo);
    const untouched = runAll(spec.hidden, { cwd: start.repo, env, timeoutMs, log });
    out.startFails = !untouched.pass;

    const solved = cloneAt({ dest: path.join(workDir, task.id, 'solved'), task, taskDir, fixtureSource, lock });
    try { git(solved.repo, ['apply', '--whitespace=nowarn', reference], { home: solved.home }); }
    catch (e)
    {
        out.problems.push(`reference.patch does not apply: ${String(e.stderr || e.message).trim()}`);
        return out;
    }
    copyHidden(path.join(taskDir, 'hidden'), solved.repo);
    const hidden = runAll(spec.hidden, { cwd: solved.repo, env, timeoutMs, log });
    const suite = runAll(spec.suite, { cwd: solved.repo, env, timeoutMs, log });
    out.referencePasses = hidden.pass;
    out.suiteGreen = suite.pass;
    out.infra = untouched.infra || hidden.infra || suite.infra || null;

    if (out.infra) out.problems.push(`infrastructure: ${out.infra} - rerun before judging`);
    if (!out.startFails) out.problems.push('the hidden tests pass on the untouched start');
    if (!out.referencePasses) out.problems.push('the hidden tests fail on the reference');
    else if (!out.suiteGreen) out.problems.push('the reference breaks the suite');
    out.ok = out.problems.length === 0;
    return out;
}

function proveTasks({ tasksDir = path.join(BENCH_DIR, 'tasks'), tasks = 'all', benchDir = BENCH_DIR, fixtureSource, lock, base = process.env, log = (l) => console.log(l) })
{
    const theLock = lock || fixture.parseLock(fs.readFileSync(fixture.LOCK_FILE, 'utf8'));
    const source = fixtureSource || path.join(BENCH_DIR, '..');
    const env = { ...base };
    for (const k of DROP) delete env[k];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(benchDir, 'results', `prove-${stamp}`);
    const workDir = path.join(benchDir, 'work', 'prove');
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'prove.log');
    const rows = [];
    try
    {
        for (const task of selectTasks(tasksDir, tasks))
        {
            fs.appendFileSync(logFile, `\n=== ${task.id}\n`);
            const r = proveTask({ task, tasksDir, workDir, fixtureSource: source, lock: theLock, env, log: (l) => fs.appendFileSync(logFile, `${l}\n`) });
            rows.push(r);
            log(`${r.ok ? 'proven' : 'NOT proven'}  ${r.id}${r.problems.length ? ` - ${r.problems.join('; ')}` : ''}`);
        }
    }
    finally { fs.rmSync(workDir, { recursive: true, force: true }); }

    const yn = (v) => (v === null ? '-' : v ? 'yes' : 'no');
    const md = ['| task | fails at start | reference passes | suite green | proven | problems |', '|---|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.id} | ${yn(r.startFails)} | ${yn(r.referencePasses)} | ${yn(r.suiteGreen)} | ${yn(r.ok)} | ${r.problems.join('; ')} |`)];
    fs.writeFileSync(path.join(dir, 'prove.md'), `${md.join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'prove.json'), `${JSON.stringify({ lock: theLock, tasks: rows }, null, 2)}\n`);
    return { dir, tasks: rows };
}

module.exports = { proveTasks, proveTask };

if (require.main === module)
{
    if (POSIX_ONLY)
    {
        console.error(POSIX_ONLY);
        process.exit(2);
    }
    const argv = process.argv.slice(2);
    const i = argv.indexOf('--tasks');
    const out = proveTasks({ tasks: i >= 0 ? argv[i + 1] : 'all' });
    console.log(`table: ${path.relative(process.cwd(), path.join(out.dir, 'prove.md'))}`);
    process.exit(out.tasks.every((r) => r.ok) ? 0 : 1);
}
