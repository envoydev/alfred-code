'use strict';
// One measured session: `claude -p` in the cell's clone, with the shared session's flags, the cell's
// own account dir and home, and a wall-clock limit the driver enforces itself (print mode has none).
// A flow cell (lib/flow.js) is the same session driven through the Agent SDK: only the DRIVER - the
// part that starts the CLI and waits for it - differs, so its start state, diff, transcript copy,
// redaction, limit detection and record are this file's, the same as a plain cell's.
// Before it starts, the clone's state is recorded as a tree, so the diff is exactly what the session
// changed - never what the arm's setup left behind. After it ends, the transcript and its subagents
// are copied out of the cell's account dir, and any auth value is redacted from every file written
// to results: a model that runs `env` would otherwise put the key into the transcript.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const lock = require('./lock.js');
const { sessionEnv, pickAuth, sessionTmp } = require('./env.js');
const { limitHit } = require('./limit.js');
const { removeTree } = require('./remove-tree.js');
const { assertIsolated } = require('./isolation.js');
const { installShims } = require('./dotnet-shim.js');
const { composeProject, composeDown } = require('./compose.js');

const WIN = process.platform === 'win32';
// What the stacks keep in the clone for themselves - docs roots and their hook ledgers, serena's LSP
// cache, browser profiles, a project-level memory database, Claude Code's own .claude/ - is never the
// task's change. The diff that is graded and measured leaves these top-level folders out, the same for
// every arm; state.txt beside it lists what they changed (names only - a language server cache runs to
// hundreds of megabytes).
const DIFF_EXCLUDES = ['.alfred', '.claude', '.memory-mcp', '.playwright', '.serena'];
const MIN_SECRET = 8;
const ONBOARD_TIMEOUT_MS = 60 * 60 * 1000;

// The session's own temp dir is readable by the Read tool: the sandbox lets its commands write there,
// but in print mode the Read tool is refused outside the working directory (measured: b4-probe-d8,
// 'you haven't granted it yet'). The grant goes before --session-id, which ends the flag's list.
function sessionArgv({ prompt, session, sessionId, tmp })
{
    return [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--model', session.model, '--effort', session.effort, '--permission-mode', session.permissionMode,
        '--settings', session.settingsFile, ...(tmp ? ['--allowedTools', `Read(/${tmp}/**)`] : []), '--session-id', sessionId, prompt,
    ];
}

// The harness's own git, blind to the host's global config: ignore rules come from the clone alone.
function git(repo, args, { index, home, extraEnv } = {})
{
    const env = { PATH: process.env.PATH, HOME: home || os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, ...extraEnv };
    if (index) env.GIT_INDEX_FILE = index;
    if (WIN) Object.assign(env, { SystemRoot: process.env.SystemRoot });
    return execFileSync('git', ['-C', repo, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).toString();
}

// Every file the clone holds, ignored ones aside, as one tree - through a throwaway index, so the
// clone's own index and status are exactly what the session will see.
function snapshot(cell, name)
{
    const index = path.join(cell.work, `.bench-index-${name}`);
    fs.rmSync(index, { force: true });
    try
    {
        git(cell.repo, ['add', '-A'], { index, home: cell.home });
        return git(cell.repo, ['write-tree'], { index, home: cell.home }).trim();
    }
    finally { fs.rmSync(index, { force: true }); }
}

// A committed setup step carries a fixed identity and date, so every rebuild of the start state -
// the session's and the grader's - lands on the same commit.
const SETUP_IDENTITY = {
    GIT_AUTHOR_NAME: 'Lending Desk', GIT_AUTHOR_EMAIL: 'dev@lendingdesk.invalid', GIT_AUTHOR_DATE: '2026-09-01T09:00:00Z',
    GIT_COMMITTER_NAME: 'Lending Desk', GIT_COMMITTER_EMAIL: 'dev@lendingdesk.invalid', GIT_COMMITTER_DATE: '2026-09-01T09:00:00Z',
};

// The arm's setup and onboarding output, committed once in its template (lib/template.js) the way a user commits a
// fresh install: one local commit, the same rule for every arm, by a fixed identity set for that command alone. A
// cell starts on it, so a stack's commit gate never meets the ~150 untracked install files pilot 3 left in every
// flow cell. Claude Code keeps .claude/settings.local.json out of git when it writes the file; the harness writes
// the grants by hand, so it adds the same pattern itself - in the clone's own exclude file, which travels with the
// clone to every cell and to the grader (a tracked local settings file would also need workspace trust).
const SETUP_COMMIT = {
    message: 'chore: project setup',
    env: { GIT_AUTHOR_NAME: 'Lending Desk', GIT_AUTHOR_EMAIL: 'setup@lendingdesk.invalid', GIT_COMMITTER_NAME: 'Lending Desk', GIT_COMMITTER_EMAIL: 'setup@lendingdesk.invalid' },
};
const LOCAL_SETTINGS = '**/.claude/settings.local.json';

function commitSetup(repo, { home })
{
    const exclude = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'info/exclude'], { home }).trim());
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!text.split('\n').includes(LOCAL_SETTINGS))
    {
        fs.mkdirSync(path.dirname(exclude), { recursive: true });
        fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${LOCAL_SETTINGS}\n`);
    }
    git(repo, ['add', '-A'], { home });
    git(repo, ['commit', '--quiet', '--no-verify', '--allow-empty', '-m', SETUP_COMMIT.message], { home, extraEnv: SETUP_COMMIT.env });
    return git(repo, ['rev-parse', 'HEAD'], { home }).trim();
}

// HEAD when it is a template's setup commit, else null (a fresh fixture clone, a template from before it existed).
function setupCommitAt(repo, { home })
{
    const [email, subject] = git(repo, ['log', '-1', '--format=%ae%n%s'], { home }).split('\n');
    return email === SETUP_COMMIT.env.GIT_AUTHOR_EMAIL && subject === SETUP_COMMIT.message ? git(repo, ['rev-parse', 'HEAD'], { home }).trim() : null;
}

// A task whose start state must hold a credential (does the session keep it out of its diff?) writes
// `@BENCH_PLANTED_JWT@` in its setup patch, and the value is made here: a JWT shape the credential
// count sees, derived from the task id so the session and the grader rebuild the same commit. Never a
// literal in the repo - this tree is public, and a committed one trips every secret scanner that
// reads it, the stack's own commit guard first. A task's hidden tests pin the SHA-256 of the value,
// so a change here re-pins them - `prove-tasks.js` fails the reference until it does.
const PLANTED_JWT = '@BENCH_PLANTED_JWT@';
function plantedJwt(task)
{
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signed = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'bench-planted', task, iat: 1788253200 })}`;
    return `${signed}.${crypto.createHash('sha256').update(signed).digest('base64url')}`;
}

function applySetupPatch(cell, file, task)
{
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes(PLANTED_JWT)) return git(cell.repo, ['apply', '--whitespace=nowarn', file], { home: cell.home });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-plant-'));
    try
    {
        const planted = path.join(dir, path.basename(file));
        fs.writeFileSync(planted, text.split(PLANTED_JWT).join(plantedJwt(task)));
        return git(cell.repo, ['apply', '--whitespace=nowarn', planted], { home: cell.home });
    }
    // A cleanup failure must never read as 'the patch does not apply'.
    finally { try { removeTree(dir); } catch { /* left for the OS temp sweep */ } }
}

// The task's start state: its ref, then each setup patch in order - left uncommitted, or committed on
// a new branch (`commitOn`). The session and the grader both build it here and nowhere else.
function prepare({ cell, startRef, setup = [], taskDir, task })
{
    // A template's setup commit sits on the fixture commit the tasks start from: the cell starts ON it, because a
    // checkout of the start ref would drop the arm's setup, and a start ref anywhere else is refused.
    const onSetup = startRef ? setupCommitAt(cell.repo, { home: cell.home }) : null;
    if (onSetup)
    {
        const parent = git(cell.repo, ['rev-parse', 'HEAD^'], { home: cell.home }).trim();
        const start = git(cell.repo, ['rev-parse', `${startRef}^{commit}`], { home: cell.home }).trim();
        if (parent !== start) throw new Error(`the template's setup commit sits on ${parent.slice(0, 12)}, not on the start ref ${startRef} (${start.slice(0, 12)}) - a checkout there would drop the arm's setup`);
    }
    else if (startRef) git(cell.repo, ['checkout', '--quiet', startRef], { home: cell.home });
    for (const step of setup)
    {
        if (step.commitOn) git(cell.repo, ['checkout', '--quiet', '-b', step.commitOn], { home: cell.home });
        try { applySetupPatch(cell, path.join(taskDir, step.patch), task); }
        catch (e) { throw new Error(`task ${task}: setup patch ${step.patch} does not apply: ${String(e.stderr || e.message).trim()}`); }
        if (step.commitOn)
        {
            git(cell.repo, ['add', '-A'], { home: cell.home });
            git(cell.repo, ['commit', '--quiet', '--no-verify', '-m', step.message || step.patch], { home: cell.home, extraEnv: SETUP_IDENTITY });
        }
    }
}

function findTranscript(config, sessionId)
{
    const projects = path.join(config, 'projects');
    let dirs;
    try { dirs = fs.readdirSync(projects); }
    catch { return null; }
    for (const d of dirs)
    {
        const file = path.join(projects, d, `${sessionId}.jsonl`);
        if (fs.existsSync(file)) return file;
    }
    return null;
}

function countJsonl(dir)
{
    let n = 0;
    try
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.isDirectory()) n += countJsonl(path.join(dir, e.name));
            else if (e.name.endsWith('.jsonl')) n += 1;
        }
    }
    catch { /* none */ }
    return n;
}

function redact(dir, secrets)
{
    if (!secrets.length) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '.lock') redact(p, secrets); continue; }
        if (!e.isFile()) continue;
        let text = fs.readFileSync(p, 'utf8');
        let changed = false;
        for (const { name, value } of secrets)
        {
            if (!text.includes(value)) continue;
            text = text.split(value).join(`<redacted:${name}>`);
            changed = true;
        }
        if (changed) fs.writeFileSync(p, text);
    }
}

function kill(child, signal)
{
    try
    {
        if (WIN) child.kill(signal);
        else process.kill(-child.pid, signal);
    }
    catch { /* already gone */ }
}

// The plain driver: `claude -p` with the prompt, its stdout and stderr into the cell's files, stopped
// at the time limit. A driver returns how the CLI ended ({ code, signal, error, timedOut, started,
// ended }), plus `failed` (a reason the session is an error though the CLI exited 0) and `extra` (its
// own fields for session.json).
async function plainDriver({ cell, prompt, session, sessionId, tmp, env, claude, timeLimitMin, graceMs })
{
    const argv = sessionArgv({ prompt, session, sessionId, tmp });
    const out = fs.openSync(cell.stdout, 'w');
    const err = fs.openSync(cell.stderr, 'w');
    const started = Date.now();
    let timedOut = false;
    const result = await new Promise((resolve) =>
    {
        // detached: the session leads its own process group, so a stop reaches every build and
        // test it started, not only the CLI.
        const child = spawn(claude[0], [...claude.slice(1), ...argv], { cwd: cell.repo, env, stdio: ['ignore', out, err], detached: !WIN });
        let killer = null;
        const limit = setTimeout(() =>
        {
            timedOut = true;
            kill(child, 'SIGTERM');
            killer = setTimeout(() => kill(child, 'SIGKILL'), graceMs);
        }, timeLimitMin * 60 * 1000);
        child.on('error', (e) => { clearTimeout(limit); clearTimeout(killer); resolve({ code: null, signal: null, error: e.code || e.message }); });
        child.on('exit', (code, signal) => { clearTimeout(limit); clearTimeout(killer); resolve({ code, signal, error: null }); });
    });
    fs.closeSync(out);
    fs.closeSync(err);
    return { ...result, timedOut, started, ended: Date.now(), failed: null, extra: {} };
}

async function run({ cell, prompt, session, arm, timeLimitMin, startRef, setup = [], taskDir, claude = ['claude'], docker = ['docker'], base = process.env, graceSec, auth, shared, driver = plainDriver })
{
    const authName = auth || pickAuth(session.auth, base);
    assertIsolated(cell.repo, 'the cell');
    fs.mkdirSync(cell.results, { recursive: true });
    const got = lock.acquire(cell.results);
    if (!got.ok) throw new Error(`${cell.arm}/${cell.task}/r${cell.rep} is held by pid ${got.holder}`);
    let sessionTmpDir = null;
    try
    {
        prepare({ cell, startRef, setup, taskDir, task: cell.task });
        const baseTree = snapshot(cell, 'base');
        const sessionId = crypto.randomUUID();
        sessionTmpDir = sessionTmp();
        const bin = installShims({ bin: path.join(cell.work, 'bin'), PATH: base.PATH });
        // The cell's own compose project (lib/compose.js): taken down before the session and again after it.
        const compose = { project: composeProject(cell) };
        const env = { ...sessionEnv({ base, session, arm, config: cell.config, home: cell.home, auth: authName, tmp: sessionTmpDir, bin, shared }), COMPOSE_PROJECT_NAME: compose.project };
        const graceMs = (graceSec !== undefined ? graceSec : session.graceSec) * 1000;
        compose.before = composeDown({ project: compose.project, env, cwd: cell.work, docker });
        let result;
        try { result = await driver({ cell, prompt, session, sessionId, tmp: sessionTmpDir, env, claude, timeLimitMin, graceMs }); }
        finally { compose.after = composeDown({ project: compose.project, env, cwd: cell.work, docker }); }
        const { started, ended, timedOut } = result;

        const transcript = findTranscript(cell.config, sessionId);
        if (transcript)
        {
            fs.copyFileSync(transcript, cell.transcript);
            const subs = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
            if (fs.existsSync(subs)) fs.cpSync(subs, cell.subagents, { recursive: true });
        }
        const endTree = snapshot(cell, 'end');
        const exclude = DIFF_EXCLUDES.map((p) => `:(top,exclude)${p}`);
        fs.writeFileSync(cell.diff, git(cell.repo, ['diff', '--binary', '--no-color', '--no-ext-diff', baseTree, endTree, '--', '.', ...exclude], { home: cell.home }));
        fs.writeFileSync(path.join(cell.results, 'state.txt'), git(cell.repo, ['diff', '--name-status', '--no-color', '--no-renames', baseTree, endTree, '--', ...DIFF_EXCLUDES.map((p) => `:(top)${p}`)], { home: cell.home }));

        redact(cell.results, authSecrets(session, base));

        // A timeout is the arm's pre-registered failure, whatever its stderr says: it is never set aside.
        const limit = timedOut ? { hit: false } : limitHit({ stdoutFile: cell.stdout, stderrFile: cell.stderr });
        if (limit.hit) return setAside(cell, { sessionId, limitText: limit.text, exitCode: result.code, signal: result.signal, started, ended, model: session.model, effort: session.effort });

        let outcome = 'ok';
        if (timedOut) outcome = 'timeout';
        else if (result.error || result.failed || result.code !== 0) outcome = 'error';
        const record = {
            run: cell.run, arm: cell.arm, task: cell.task, rep: cell.rep, sessionId, outcome,
            exitCode: result.code, signal: result.signal, spawnError: result.error,
            startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), wallMs: ended - started, timeLimitMin,
            model: session.model, effort: session.effort, startRef: startRef || null, setup, baseTree, endTree, diffExcludes: DIFF_EXCLUDES,
            transcript: Boolean(transcript), subagents: countJsonl(cell.subagents), compose, ...result.extra,
        };
        // Written last and whole: a session.json that parses is what marks the cell done.
        const tmp = `${cell.session}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
        fs.renameSync(tmp, cell.session);
        return record;
    }
    finally
    {
        if (sessionTmpDir) removeTree(sessionTmpDir);
        lock.release(cell.results);
    }
}

// A cell a usage limit stopped is not finished: its files, already redacted, move to
// results/<run>/limited/ for the record, and its own dir keeps only the lock, so the next drive or
// resume runs it again from scratch and the grader never sees it.
function setAside(cell, info)
{
    const runDir = path.resolve(cell.results, '..', '..', '..');
    const dest = path.join(runDir, 'limited', `${cell.arm}-${cell.task}-r${cell.rep}-${new Date(info.ended).toISOString().replace(/[-:.]/g, '')}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(cell.results, dest, { recursive: true, filter: (src) => path.basename(src) !== '.lock' });
    for (const entry of fs.readdirSync(cell.results)) if (entry !== '.lock') fs.rmSync(path.join(cell.results, entry), { recursive: true, force: true });
    const record = {
        run: cell.run, arm: cell.arm, task: cell.task, rep: cell.rep, sessionId: info.sessionId, outcome: 'limited', limitText: info.limitText,
        exitCode: info.exitCode, signal: info.signal, startedAt: new Date(info.started).toISOString(), endedAt: new Date(info.ended).toISOString(),
        wallMs: info.ended - info.started, model: info.model, effort: info.effort,
    };
    fs.writeFileSync(path.join(dest, 'session.limited.json'), `${JSON.stringify(record, null, 2)}\n`);
    return { ...record, setAside: dest };
}

const authSecrets = (session, base) => session.auth.map((name) => ({ name, value: base[name] })).filter((s) => typeof s.value === 'string' && s.value.length >= MIN_SECRET);

// An arm's onboarding prompt, run once into its template with the same flags as every measured
// session. Its transcript is kept beside the template (`onboarding/<n>.jsonl`, redacted), because
// onboarding is a cost the arm pays and the report shows in its own column.
function onboardSync({ prompt, where, session, claude = ['claude'], base = process.env })
{
    const sessionId = crypto.randomUUID();
    const dir = path.join(where.dir, 'onboarding');
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.openSync(path.join(dir, `${where.index}.stdout.jsonl`), 'w');
    const err = fs.openSync(path.join(dir, `${where.index}.stderr.log`), 'w');
    let r;
    try
    {
        r = spawnSync(claude[0], [...claude.slice(1), ...sessionArgv({ prompt, session, sessionId, tmp: where.tmp })], { cwd: where.cwd, env: where.env, stdio: ['ignore', out, err], timeout: ONBOARD_TIMEOUT_MS, killSignal: 'SIGKILL' });
    }
    finally
    {
        fs.closeSync(out);
        fs.closeSync(err);
    }
    const transcript = findTranscript(where.config, sessionId);
    if (transcript)
    {
        fs.copyFileSync(transcript, path.join(dir, `${where.index}.jsonl`));
        const subs = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
        if (fs.existsSync(subs)) fs.cpSync(subs, path.join(dir, `${where.index}`, 'subagents'), { recursive: true });
    }
    redact(dir, authSecrets(session, base));
    const limit = limitHit({ stdoutFile: path.join(dir, `${where.index}.stdout.jsonl`), stderrFile: path.join(dir, `${where.index}.stderr.log`) });
    if (limit.hit) throw new Error(`usage limit during onboarding (${limit.text}) - resume the run after it resets`);
    if (r.error) throw new Error(`session ${r.error.code === 'ETIMEDOUT' ? 'timed out' : `failed: ${r.error.code || r.error.message}`}`);
    if (r.status !== 0) throw new Error(`session exited ${r.status === null ? r.signal : r.status}`);
    if (!transcript) throw new Error('session left no transcript');
    return { sessionId };
}

module.exports = { sessionArgv, run, plainDriver, kill, prepare, applySetupPatch, plantedJwt, onboardSync, snapshot, redact, findTranscript, git, commitSetup, DIFF_EXCLUDES, SETUP_COMMIT };
