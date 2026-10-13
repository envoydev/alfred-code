#!/usr/bin/env node
'use strict';
// ONE leg of the local CI gate (`scripts/gate.js`): what a GitHub runner does for this repo, run on
// whatever machine this file is started on - the Mac itself, a node container, a Windows VM.
//
// It is copied next to a git bundle and started there, with the one helper it needs beside it
// (install/runtime.js - the Windows-safe spawn every repo script starts commands through, R105).
// The steps are the two workflows' own: a CI-style checkout (full history, the pushed branch, a local
// `main` - ci.yml), `npm install --no-audit --no-fund`, `npm run lint` (lint.yml) and `npm test`.
// npm and git start through that helper, which resolves npm.cmd on Windows as a runner's shell does.
//
// The verdict is stricter than an exit code, because an exit code once lied: `npm test` on Windows
// ran ZERO tests and exited 0 (ci.yml has the story). A leg passes only when every step exits 0, the
// TAP summary was printed, at least one test ran, and none failed or was cancelled.
//
// Where it runs is part of the fidelity: the clone sits OUTSIDE the temp tree, as a runner's checkout
// does (a test assumes a real project is never under the temp dir), and the env keeps the machine's own
// temp dir and git config - only `tempDir` moves temp, for a user like SYSTEM whose temp nothing cleans.
//
//   node gate-leg.js <config.json>
// config: { bundle, gateRef, mainRef, branch, name, work, tempDir?, concurrency?, keep? } - the last
// stdout line is `ALFRED-GATE-RESULT <json>`; the exit code is 0 only for a pass.
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');

const RESULT = 'ALFRED-GATE-RESULT ';
const STEP = 'ALFRED-GATE-STEP ';
// `concurrency` caps the test workers when legs share one machine's cores, about the 3 a runner has.
const steps = ({ concurrency } = {}) => [
    { name: 'install', args: ['install', '--no-audit', '--no-fund'], fatal: true },
    { name: 'lint', args: ['run', 'lint'] },
    { name: 'test', args: ['test', '--', '--test-reporter=tap', ...(concurrency ? [`--test-concurrency=${Number(concurrency)}`] : [])], tap: true },
];

// The tools CI's runner images carry that some tests need; a leg without one skips (or fails) those
// tests where CI runs them, so the result names what is missing.
const CI_TOOLS = ['bash', 'pwsh'];

// What a runner does NOT have: the caller's git plumbing (a pre-push hook runs with GIT_DIR and
// friends set, and a child git would act on the caller's repo), npm's run-script variables, a
// Claude Code session's variables, the stack's own switches. Everything else passes through
// (PATH, proxies, certificates).
function runnerEnv(env, { tmp, platform = process.platform, exists = fs.existsSync } = {})
{
    const out = {};
    for (const [k, v] of Object.entries(env))
    {
        if (/^(GIT_|npm_|CLAUDE|ALFRED_CODE_)/i.test(k) || /^(NODE_OPTIONS|NODE_TEST_CONTEXT|INIT_CWD)$/i.test(k)) continue;
        out[k] = v;
    }
    setEnv(out, 'CI', 'true');
    if (tmp) for (const k of ['TMPDIR', 'TEMP', 'TMP']) setEnv(out, k, tmp);
    if (platform === 'win32') gitUnixTools(out, { exists });
    return out;
}

// Windows keeps one variable under any letter case ('Path'); a second spelling would make two.
function setEnv(env, name, value)
{
    for (const k of Object.keys(env)) if (k !== name && k.toUpperCase() === name.toUpperCase()) delete env[k];
    env[name] = value;
}

function envKey(env, name)
{
    return Object.keys(env).find(k => k.toUpperCase() === name) || name;
}

// Where a command resolves on the env's PATH ('' when it does not) - a plain search, no spawn.
function onPath(cmd, env, { platform = process.platform, exists = fs.existsSync } = {})
{
    const sep = platform === 'win32' ? ';' : ':';
    const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
    const join = platform === 'win32' ? path.win32.join : path.posix.join;
    for (const dir of String(env[envKey(env, 'PATH')] || '').split(sep).filter(Boolean))
        for (const ext of exts) if (exists(join(dir, cmd + ext))) return join(dir, cmd + ext);
    return '';
}

// A GitHub Windows runner reaches `bash` through Git's bin\\bash.exe, the launcher that puts Git's
// /usr/bin first inside the shell; a Git for Windows install with the default PATH option has only
// git. The leg adds that dir. Not usr\\bin: its raw bash keeps System32 first, so a script's `sort`
// became Windows' sort.exe ('Input file specified two times' - measured).
function gitUnixTools(env, { exists = fs.existsSync } = {})
{
    const opts = { platform: 'win32', exists };
    if (onPath('bash', env, opts)) return;
    const git = onPath('git', env, opts);
    if (!git) return;
    const bin = path.win32.join(path.win32.dirname(path.win32.dirname(git)), 'bin');
    const key = envKey(env, 'PATH');
    if (exists(path.win32.join(bin, 'bash.exe'))) env[key] = [env[key], bin].filter(Boolean).join(';');
}

function missingTools(env, seams)
{
    return CI_TOOLS.filter(t => !onPath(t, env, seams));
}

// The summary node's TAP reporter prints last, at column 0: `# tests 2967`, `# pass 2960`, ...
// null when it is absent - a run that died before its summary has no counts to trust.
function parseTapSummary(text)
{
    const counts = {};
    for (const m of String(text).matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) counts[m[1]] = Number(m[2]);
    if (counts.tests === undefined || counts.fail === undefined) return null;
    return { tests: counts.tests, pass: counts.pass || 0, fail: counts.fail, cancelled: counts.cancelled || 0, skipped: counts.skipped || 0, todo: counts.todo || 0 };
}

// The failing test names, indentation dropped - a failing subtest also fails its parent, so both show.
function failedTests(text, limit = 20)
{
    const out = [];
    for (const m of String(text).matchAll(/^\s*not ok \d+ - (.*)$/gm))
    {
        if (/#\s*TODO\b/i.test(m[1])) continue;
        out.push(m[1].trim());
        if (out.length >= limit) break;
    }
    return out;
}

function verdict(steps, tests)
{
    const reasons = [];
    for (const s of steps) if (s.status !== 0) reasons.push(`${s.name} exited ${s.status}`);
    if (steps.some(s => s.name === 'test') && !tests) reasons.push('the test run printed no TAP summary');
    if (tests)
    {
        if (tests.tests === 0) reasons.push('0 tests ran - a gate that runs nothing passes nothing');
        if (tests.fail > 0) reasons.push(`${tests.fail} test(s) failed`);
        if (tests.cancelled > 0) reasons.push(`${tests.cancelled} test(s) cancelled`);
    }
    if (!steps.some(s => s.name === 'test')) reasons.push('the tests never ran');
    return { ok: reasons.length === 0, reasons };
}

function runStep(step, cwd, env)
{
    return new Promise(resolve => {
        process.stdout.write(`${STEP}${step.name}\n`);
        const started = Date.now();
        const child = rt.spawnCommandAsync('npm', step.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let tap = '';
        child.stdout.on('data', d => { process.stdout.write(d); if (step.tap) tap += d; });
        child.stderr.on('data', d => process.stderr.write(d));
        child.on('error', err => { process.stderr.write(`npm ${step.args.join(' ')}: ${err.message}\n`); });
        child.on('close', code => resolve({ name: step.name, status: code === null ? -1 : code, ms: Date.now() - started, tap }));
    });
}

function checkout(cfg, repo, env)
{
    const git = (...args) => rt.execCommand('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    git('init', '-q');
    const refspecs = [`+${cfg.gateRef}:refs/remotes/origin/${cfg.branch}`];
    if (cfg.branch !== 'main') refspecs.push(`+${cfg.mainRef}:refs/remotes/origin/main`);
    git('fetch', '-q', '--no-tags', cfg.bundle, ...refspecs);
    git('checkout', '-q', '-B', cfg.branch, `refs/remotes/origin/${cfg.branch}`);
    // ci.yml: `git show-ref --verify --quiet refs/heads/main || git branch main origin/main`
    if (cfg.branch !== 'main') git('branch', 'main', 'refs/remotes/origin/main');
    return git('rev-parse', 'HEAD').trim();
}

async function main(cfgPath)
{
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg.work) throw new Error('the config names no work dir');
    const work = cfg.work;
    const repo = path.join(work, cfg.name || 'repo');
    const tmp = cfg.tempDir ? path.join(work, 'Temp') : null;
    fs.mkdirSync(repo, { recursive: true });
    if (tmp) fs.mkdirSync(tmp, { recursive: true });
    const result = { ok: false, node: process.version, platform: process.platform, steps: [], tests: null, failed: [], reasons: [] };
    const started = Date.now();
    try
    {
        process.stdout.write(`${STEP}checkout\n`);
        const t0 = Date.now();
        const env = runnerEnv(process.env, { tmp });
        result.missing = missingTools(env);
        try
        {
            result.head = checkout(cfg, repo, env);
            result.steps.push({ name: 'checkout', status: 0, ms: Date.now() - t0 });
        }
        catch (err)
        {
            process.stderr.write(String(err.stderr || err.message));
            result.steps.push({ name: 'checkout', status: 1, ms: Date.now() - t0 });
            throw Object.assign(new Error('checkout failed'), { reported: true });
        }
        for (const step of steps(cfg))
        {
            const r = await runStep(step, repo, env);
            if (step.tap) { result.tests = parseTapSummary(r.tap); result.failed = failedTests(r.tap); }
            result.steps.push({ name: r.name, status: r.status, ms: r.ms });
            if (step.fatal && r.status !== 0) break;
        }
    }
    catch (err)
    {
        if (!err.reported) process.stderr.write(`gate-leg: ${err.message}\n`);
    }
    Object.assign(result, verdict(result.steps, result.tests), { ms: Date.now() - started });
    if (!cfg.keep)
    {
        try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
        catch (err) { result.cleanup = `could not remove ${work}: ${err.message}`; }
    }
    else result.work = work;
    process.stdout.write(`\n${RESULT}${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
}

// stdout and stderr block, so a pipe gets every byte before process.exit (macOS writes a pipe async) - the
// prelude's blockingStdio, inline because a leg runs with only install/runtime.js beside it (blocking-stdio in meta/shared-rules.json).
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}

if (require.main === module)
{
    blockingStdio();
    const cfgPath = process.argv[2];
    if (!cfgPath) { console.error('usage: gate-leg.js <config.json>'); process.exit(2); }
    main(cfgPath).then(code => process.exit(code), err => { console.error(err); process.exit(1); });
}

module.exports = { RESULT, STEP, CI_TOOLS, runnerEnv, setEnv, onPath, missingTools, parseTapSummary, failedTests, verdict };
