'use strict';
// One template per arm and pin: the fixture cloned at its locked commit, the arm's setup commands
// run against it, then its onboarding prompts - all with the template's OWN account dir and home,
// never the host's. It is built in place and marked READY last, so a failed step or a killed driver
// leaves nothing that could be served: the next build wipes it and starts over. Every cell then gets
// a full copy, with the template's absolute paths rewritten to the cell's own, so no cell reads or
// writes another's account state.
//
// Between setup and onboarding the template is made what a user who set the arm up interactively would
// have, the same way for every arm: the MCP servers it installed and its own plugin code are
// pre-approved in its local settings (the 'always allow' answers print mode cannot give), and each
// server is started once with a long connect timeout so its uv cache is warm before any session. After
// onboarding the CLI's plugin list is recorded beside READY, and a template whose onboarding left the
// arm's expected outputs missing is refused - a half-installed arm is never measured.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { templatePaths } = require('./cells.js');
const { resolve } = require('./arms.js');
const { sessionEnv, pickAuth, sessionTmp } = require('./env.js');
const fixture = require('../fixture/verify.js');
const { removeTree } = require('./remove-tree.js');
const { assertIsolated } = require('./isolation.js');
const { installShims } = require('./dotnet-shim.js');
const { commitSetup, git } = require('./session.js');

const READY = 'READY.json';
const STEP_TIMEOUT_MS = 20 * 60 * 1000;
const REWRITE_MAX_BYTES = 4 * 1024 * 1024;
// A cold uvx install of a Python MCP server takes longer than Claude Code's 30 s default (MCP_TIMEOUT).
const WARM_TIMEOUT_MS = String(10 * 60 * 1000);
// What a failed build keeps to read, under `<template>.failed`: everything else is wiped.
const KEPT_ON_FAILURE = ['onboarding', 'plugins.json', 'grants.json', 'mcp-warm.txt'];

// A READY from before the setup commit existed names no setupCommit: its clone would start every cell among the
// arm's untracked install files, so it is rebuilt rather than served.
function isReady(paths, hash)
{
    try
    {
        const ready = JSON.parse(fs.readFileSync(path.join(paths.dir, READY), 'utf8'));
        return ready.hash === hash && typeof ready.setupCommit === 'string';
    }
    catch { return false; }
}

function runStep(argv, { cwd, env, logFile })
{
    const fd = fs.openSync(logFile, 'a');
    try
    {
        fs.writeSync(fd, `\n$ ${argv.join(' ')}\n`);
        return spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', fd, fd], timeout: STEP_TIMEOUT_MS });
    }
    finally { fs.closeSync(fd); }
}

function stepFailure(r)
{
    if (r.error) return r.error.code === 'ENOENT' ? 'was not found' : `failed: ${r.error.code || r.error.message}`;
    if (r.signal) return `was killed by ${r.signal}`;
    return `exited ${r.status}`;
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// The CLI's own read-back of what the template installed: the list the README asks for beside READY.
function pluginList(claude, { cwd, env, logFile, arm, when })
{
    const r = spawnSync(claude[0], [...claude.slice(1), 'plugin', 'list', '--json'], { cwd, env, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    fs.appendFileSync(logFile, `\n$ claude plugin list --json (${when})\n${r.stderr || ''}`);
    if (r.error || r.status !== 0) throw new Error(`${arm} plugin list (${when}) ${stepFailure(r)} - see ${logFile}`);
    const list = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
    if (!Array.isArray(list)) throw new Error(`${arm} plugin list (${when}) printed no JSON list - see ${logFile}`);
    return list;
}

// MCP servers registered outside a plugin: user and local scope in the account's .claude.json, project
// scope in the clone's .mcp.json (which print mode connects without an approval).
function registeredServers({ config, repo })
{
    const account = readJson(path.join(config, '.claude.json')) || {};
    const projects = account.projects || {};
    let real = repo;
    try { real = fs.realpathSync(repo); }
    catch { /* judged by the path given */ }
    const local = (projects[repo] || projects[real] || {}).mcpServers || {};
    const project = (readJson(path.join(repo, '.mcp.json')) || {}).mcpServers || {};
    return [...Object.keys(account.mcpServers || {}), ...Object.keys(local), ...Object.keys(project)];
}

// The rules a user who answered 'always allow' holds, derived from what the arm installed and never from a
// list per arm: every tool of each enabled plugin's servers and of each registered server, and reads of
// the arm's own plugin code and marketplaces (its skills and commands read their own files).
function grantRules({ plugins, registered, config })
{
    const enabled = plugins.filter((p) => p && p.enabled);
    const known = readJson(path.join(config, 'plugins', 'known_marketplaces.json')) || {};
    const markets = Object.values(known).map((m) => m && m.installLocation).filter((d) => typeof d === 'string' && d);
    return [...new Set([
        ...enabled.flatMap((p) => Object.keys(p.mcpServers || {}).map((server) => `mcp__plugin_${String(p.id).split('@')[0]}_${server}__*`)),
        ...registered.map((server) => `mcp__${server}__*`),
        ...[...markets, ...enabled.map((p) => p.installPath).filter((d) => typeof d === 'string' && d)].map((d) => `Read(/${path.resolve(d)}/**)`),
    ])];
}

// Into the clone's .claude/settings.local.json: an untracked local file is applied in print mode without
// the workspace trust a project .claude/settings.json allow rule needs. Merged, never replaced.
function grant(repo, rules)
{
    if (!rules.length) return;
    const file = path.join(repo, '.claude', 'settings.local.json');
    const settings = fs.existsSync(file) ? readJson(file) : {};
    if (!settings || typeof settings !== 'object') throw new Error(`${file} is not JSON - the arm's own local settings cannot be merged`);
    const permissions = settings.permissions || {};
    const allow = permissions.allow || [];
    settings.permissions = { ...permissions, allow: [...allow, ...rules.filter((r) => !allow.includes(r))] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, settings);
}

// Starts every configured server once with a long connect timeout, so the shared uv cache is warm and a
// session's server connects inside the default one. Its output is kept, never judged here: a server that
// cannot connect is the arm's own state, and the B4 read names it.
function warm(claude, { cwd, env, file, logFile })
{
    const r = spawnSync(claude[0], [...claude.slice(1), 'mcp', 'list'], { cwd, env: { ...env, MCP_TIMEOUT: WARM_TIMEOUT_MS }, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const text = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n[warm-up ${stepFailure(r)}]\n` : ''}`;
    fs.writeFileSync(file, text);
    fs.appendFileSync(logFile, `\n$ claude mcp list (MCP_TIMEOUT=${WARM_TIMEOUT_MS})\n${text}`);
}

function keepFailure(paths)
{
    const kept = `${paths.dir}.failed`;
    const present = KEPT_ON_FAILURE.filter((name) => fs.existsSync(path.join(paths.dir, name)));
    if (!present.includes('onboarding')) return null;
    for (const name of present) fs.cpSync(path.join(paths.dir, name), path.join(kept, name), { recursive: true });
    return kept;
}

function build({ arm, session, benchDir, workRoot, root, fixtureSource, lock, onboard, base = process.env, auth, claude = ['claude'], shared = {} })
{
    const paths = templatePaths({ benchDir, workRoot, arm: arm.name, hash: arm.hash });
    // Its onboarding runs in its repo, and every cell is a copy of it: nothing above it may carry instructions.
    assertIsolated(paths.dir, 'the template', { inclusive: true });
    if (isReady(paths, arm.hash)) return { paths, built: false };

    const repoRoot = root || path.dirname(benchDir);
    const logFile = `${paths.dir}.setup.log`;
    removeTree(paths.dir);
    removeTree(`${paths.dir}.failed`);
    fs.rmSync(logFile, { force: true });
    try
    {
        fs.mkdirSync(paths.config, { recursive: true });
        fs.mkdirSync(paths.home, { recursive: true });
        const theLock = lock || fixture.parseLock(fs.readFileSync(fixture.LOCK_FILE, 'utf8'));
        const { commit } = fixture.verify({ source: fixtureSource || repoRoot, lock: theLock, dest: paths.repo });
        // The clone's origin is this repository, whose other branches carry a stack: cut it.
        execFileSync('git', ['-C', paths.repo, 'remote', 'remove', 'origin'], { stdio: 'pipe' });

        const vars = { template: paths.dir, repo: paths.repo, config: paths.config, home: paths.home, src: paths.src, bench: benchDir, root: repoRoot, pin: arm.pin.value, arm: arm.name };
        const setupEnv = sessionEnv({ base, session, arm, config: paths.config, home: paths.home, auth: false, shared });
        arm.setup.forEach((step, i) =>
        {
            const argv = resolve(step, vars);
            const r = runStep(argv, { cwd: paths.repo, env: setupEnv, logFile });
            if (r.error || r.status !== 0) throw new Error(`${arm.name} setup step ${i + 1} (${argv[0]}) ${stepFailure(r)} - see ${logFile}`);
        });

        // Every arm's template gets the fixture's packages once, outside the sandbox and before its
        // onboarding: NuGet cannot restore inside the sandbox, and every cell would pay the same download.
        for (const argv of session.restore || [])
        {
            const r = runStep(argv, { cwd: paths.repo, env: setupEnv, logFile });
            if (r.error || r.status !== 0) throw new Error(`${arm.name} package restore (${argv.join(' ')}) ${stepFailure(r)} - see ${logFile}`);
        }

        const granted = new Set();
        const grantFrom = (when) =>
        {
            const plugins = pluginList(claude, { cwd: paths.repo, env: setupEnv, logFile, arm: arm.name, when });
            const rules = grantRules({ plugins, registered: registeredServers({ config: paths.config, repo: paths.repo }), config: paths.config });
            grant(paths.repo, rules);
            for (const r of rules) granted.add(r);
            writeJson(path.join(paths.dir, 'grants.json'), [...granted]);
            return plugins;
        };
        grantFrom('after setup');
        warm(claude, { cwd: paths.repo, env: setupEnv, file: path.join(paths.dir, 'mcp-warm.txt'), logFile });

        if (arm.onboarding.length && typeof onboard !== 'function') throw new Error(`${arm.name}: onboarding prompts but no onboarding runner`);
        // The driver names the run's credential; a caller that names none gets the only one set, or none.
        const onboardAuth = auth || (session.auth.some((name) => base[name]) ? pickAuth(session.auth, base) : false);
        const bin = installShims({ bin: path.join(paths.dir, 'bin'), PATH: base.PATH });
        arm.onboarding.forEach((prompt, i) =>
        {
            const tmp = sessionTmp();
            try
            {
                const env = sessionEnv({ base, session, arm, config: paths.config, home: paths.home, auth: onboardAuth, tmp, bin, shared, onboarding: true });
                onboard(prompt, { cwd: paths.repo, config: paths.config, home: paths.home, env, tmp, index: i + 1, dir: paths.dir });
            }
            catch (err) { throw new Error(`${arm.name} onboarding ${i + 1}: ${err.message}`); }
            finally { removeTree(tmp); }
        });

        // Onboarding can install more; the list recorded is the one the cells get.
        writeJson(path.join(paths.dir, 'plugins.json'), grantFrom('after onboarding'));
        for (const rel of arm.expects || [])
        {
            const file = path.join(paths.repo, rel);
            if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error(`${arm.name} onboarding left ${rel} missing or empty - the arm is not set up, so no cell may run on it`);
        }

        // What setup and onboarding left, committed once like a user commits a fresh install (session.js
        // commitSetup); the lock then checks the commit it sits on, so no setup step can move the start state.
        const setupCommit = commitSetup(paths.repo, { home: paths.home });
        const parent = git(paths.repo, ['rev-parse', 'HEAD^'], { home: paths.home }).trim();
        if (parent !== theLock.commit) throw new Error(`${arm.name}: the setup commit sits on ${parent}, the fixture lock records ${theLock.commit} - a setup step moved the clone`);

        fs.writeFileSync(path.join(paths.dir, READY), `${JSON.stringify({ arm: arm.name, hash: arm.hash, pin: arm.pin, fixtureCommit: commit, setupCommit, builtAt: new Date().toISOString() }, null, 2)}\n`);
        return { paths, built: true, fixtureCommit: commit, setupCommit };
    }
    catch (err)
    {
        const kept = keepFailure(paths);
        removeTree(paths.dir);
        if (kept) err.message = `${err.message} - its onboarding is kept at ${kept}`;
        throw err;
    }
}

function rewrite(dir, pairs, skip)
{
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries)
    {
        const p = path.join(dir, e.name);
        if (e.isDirectory())
        {
            if (e.name === '.git' || e.name === 'node_modules' || skip.includes(p)) continue;
            rewrite(p, pairs, skip);
            continue;
        }
        if (!e.isFile()) continue;
        if (fs.statSync(p).size > REWRITE_MAX_BYTES) continue;
        const buf = fs.readFileSync(p);
        if (buf.includes(0)) continue;
        let text = buf.toString('utf8');
        if (!pairs.some(([from]) => text.includes(from))) continue;
        for (const [from, to] of pairs) text = text.split(from).join(to);
        fs.writeFileSync(p, text);
    }
}

// A path's OS-resolved spelling, when it differs from the one given: os.tmpdir() is a symlink on
// macOS (/var -> /private/var), so a value a subprocess wrote by resolving its own cwd (rather than
// echoing the argument it was given) can name a template path by a spelling paths.* never uses.
function realSpelling(p)
{
    try
    {
        const real = fs.realpathSync(p);
        return real === p ? null : real;
    }
    catch { return null; }
}

const SETTINGS_FILE = /^settings.*\.json$/;

// A value the rewrite above could not map - past REWRITE_MAX_BYTES, say - would point a session at the
// template's own config, home or repo: a directory the NEXT template build wipes, and this cell's own
// copy of the same tree sits right beside it unused. Refused rather than served.
function assertNoTemplateLeak(paths, cell)
{
    const dir = path.join(cell.repo, '.claude');
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    const names = ['config', 'home', 'repo'].flatMap((d) => [paths[d], realSpelling(paths[d])]).filter(Boolean);
    for (const e of entries)
    {
        if (!e.isFile() || !SETTINGS_FILE.test(e.name)) continue;
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
        const hit = names.find((name) => text.includes(name));
        if (hit) throw new Error(`${cell.arm}/${cell.task}/r${cell.rep}: .claude/${e.name} still names the template ${hit}`);
    }
}

// `parts` narrows the copy - the grader needs the clone alone - but the rewrite always maps all three,
// so a copied file names exactly what it named in the session's cell.
function copyInto(paths, cell, { parts = ['config', 'home', 'repo'] } = {})
{
    if (fs.existsSync(cell.work) && fs.readdirSync(cell.work).length) throw new Error(`${cell.work} is not empty - reset the cell first`);
    for (const d of parts) fs.cpSync(paths[d], cell[d], { recursive: true, verbatimSymlinks: true });
    // The realpath spelling goes FIRST: /private/var/X literally contains /var/X as a substring, so the
    // given-spelling pair would otherwise partial-match inside an unprocessed realpath occurrence and
    // leave a stray /private prefix glued to the cell's own (given-spelling) path.
    const pairs = ['config', 'home', 'repo'].flatMap((d) =>
    {
        const real = realSpelling(paths[d]);
        return real ? [[real, cell[d]], [paths[d], cell[d]]] : [[paths[d], cell[d]]];
    });
    // The plugin cache is the plugins' own code, installed from a marketplace: it names no account path.
    // Nor do the restored packages, thousands of files no account path lives in.
    const skip = [path.join(cell.config, 'plugins', 'cache'), path.join(cell.home, '.nuget', 'packages')];
    for (const d of parts) rewrite(cell[d], pairs, skip);
    if (parts.includes('repo'))
    {
        try { assertNoTemplateLeak(paths, cell); }
        catch (err) { removeTree(cell.work); throw err; }
    }
}

module.exports = { build, copyInto, grantRules, READY };
