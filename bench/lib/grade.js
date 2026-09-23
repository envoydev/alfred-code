'use strict';
// Grading one cell: the cell's clone is re-created at its own path from its template, so the tree
// is byte for byte what the session started from - and that is CHECKED against the baseline tree
// the session recorded before its patch is applied. Then the task's hidden files go in and the
// grade.json commands run. What the harness caused is infrastructure, never the arm's fail: a mass
// connection failure, a grader timeout, a baseline that no longer matches, a template that is gone.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const template = require('./template.js');
const { snapshot, prepare } = require('./session.js');
const { sessionEnv } = require('./env.js');

// Pre-registered: over 50 failing tests AND a connection error in the same log.
const INFRA_MIN_FAILED = 50;
const CONNECTION = /connection refused|ECONNREFUSED|could not connect|Npgsql\.NpgsqlException|failed to connect|Cannot connect to the Docker daemon|DockerUnavailableException|Docker is either not running/i;

function failedCount(text)
{
    let most = 0;
    for (const m of text.matchAll(/Failed:\s+(\d+)/g)) most = Math.max(most, Number(m[1]));
    for (const m of text.matchAll(/(\d+)\s+failed\b/gi)) most = Math.max(most, Number(m[1]));
    const lines = text.split('\n').filter((l) => /^\s*(Failed|FAILED|✗|✖)\s+\S/.test(l)).length;
    return Math.max(most, lines);
}

function detectInfra(text, { threshold = INFRA_MIN_FAILED } = {})
{
    const n = failedCount(text);
    if (n > threshold && CONNECTION.test(text)) return `mass connection failure: ${n} failing tests with a connection error`;
    return null;
}

function writeJson(file, value)
{
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
}

function copyHidden(hiddenDir, repo)
{
    for (const e of fs.readdirSync(hiddenDir, { withFileTypes: true }))
    {
        if (e.name === 'grade.json') continue;
        fs.cpSync(path.join(hiddenDir, e.name), path.join(repo, e.name), { recursive: true, force: true });
    }
}

function gradeCell({ cell, tasksDir, templatePaths, session, base = process.env })
{
    const log = path.join(cell.results, 'grade.log');
    const record = JSON.parse(fs.readFileSync(cell.session, 'utf8'));
    const spec = JSON.parse(fs.readFileSync(path.join(tasksDir, cell.task, 'hidden', 'grade.json'), 'utf8'));
    const out = { hiddenPass: false, suiteGreen: false, infra: null, applied: false, baseMatches: false, commands: [], gradedAt: null };
    fs.writeFileSync(log, '');
    const note = (text) => fs.appendFileSync(log, text);
    const done = () => { out.gradedAt = new Date().toISOString(); writeJson(path.join(cell.results, 'grade.json'), out); return out; };

    fs.rmSync(cell.work, { recursive: true, force: true });
    try
    {
        if (!templatePaths || !fs.existsSync(path.join(templatePaths.dir, template.READY)))
        {
            out.infra = 'template missing - rebuild it before grading';
            return done();
        }
        template.copyInto(templatePaths, cell, { parts: ['repo'] });
        fs.mkdirSync(cell.home, { recursive: true });
        fs.mkdirSync(cell.config, { recursive: true });
        try { prepare({ cell, startRef: record.startRef, setup: record.setup || [], taskDir: path.join(tasksDir, cell.task), task: cell.task }); }
        catch (e)
        {
            out.infra = e.message;
            return done();
        }
        out.baseMatches = snapshot(cell, 'grade-base') === record.baseTree;
        if (!out.baseMatches)
        {
            out.infra = 'baseline differs from the session\'s - the template was rebuilt or changed';
            return done();
        }

        const patch = fs.existsSync(cell.diff) ? fs.readFileSync(cell.diff) : Buffer.alloc(0);
        if (patch.length)
        {
            const r = spawnSync('git', ['-C', cell.repo, 'apply', '--whitespace=nowarn', cell.diff], { stdio: ['ignore', 'pipe', 'pipe'] });
            note(`$ git apply diff.patch\n${r.stdout}${r.stderr}`);
            if (r.status !== 0) return done();
        }
        out.applied = true;
        copyHidden(path.join(tasksDir, cell.task, 'hidden'), cell.repo);

        const env = sessionEnv({ base, session, arm: { env: {} }, config: cell.config, home: cell.home, auth: false });
        const timeout = (spec.timeoutMin || 30) * 60 * 1000;
        let text = '';
        const runAll = (kind, list) => (list || []).every((argv) =>
        {
            const started = Date.now();
            const r = spawnSync(argv[0], argv.slice(1), { cwd: cell.repo, env, stdio: ['ignore', 'pipe', 'pipe'], timeout, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
            const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
            const body = `${r.stdout || ''}${r.stderr || ''}`;
            text += body;
            note(`\n$ [${kind}] ${argv.join(' ')}\n${body}`);
            out.commands.push({ kind, argv, exit: r.status, ms: Date.now() - started, timedOut });
            if (timedOut) out.infra = out.infra || `grader timeout: ${argv.join(' ')}`;
            return r.status === 0;
        });
        out.hiddenPass = runAll('hidden', spec.hidden);
        out.suiteGreen = runAll('suite', spec.suite);
        out.infra = out.infra || detectInfra(text);
        return done();
    }
    finally { fs.rmSync(cell.work, { recursive: true, force: true }); }
}

module.exports = { gradeCell, copyHidden, detectInfra, failedCount, INFRA_MIN_FAILED };
