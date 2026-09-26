'use strict';
// One template per arm and pin: the fixture cloned at its locked commit, the arm's setup commands
// run against it, then its onboarding prompts - all with the template's OWN account dir and home,
// never the host's. It is built in place and marked READY last, so a failed step or a killed driver
// leaves nothing that could be served: the next build wipes it and starts over. Every cell then gets
// a full copy, with the template's absolute paths rewritten to the cell's own, so no cell reads or
// writes another's account state.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { templatePaths } = require('./cells.js');
const { resolve } = require('./arms.js');
const { sessionEnv, pickAuth } = require('./env.js');
const fixture = require('../fixture/verify.js');
const { removeTree } = require('./remove-tree.js');

const READY = 'READY.json';
const STEP_TIMEOUT_MS = 20 * 60 * 1000;
const REWRITE_MAX_BYTES = 4 * 1024 * 1024;

function isReady(paths, hash)
{
    try { return JSON.parse(fs.readFileSync(path.join(paths.dir, READY), 'utf8')).hash === hash; }
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

function build({ arm, session, benchDir, root, fixtureSource, lock, onboard, base = process.env, auth })
{
    const paths = templatePaths({ benchDir, arm: arm.name, hash: arm.hash });
    if (isReady(paths, arm.hash)) return { paths, built: false };

    const repoRoot = root || path.dirname(benchDir);
    const logFile = `${paths.dir}.setup.log`;
    removeTree(paths.dir);
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
        const setupEnv = sessionEnv({ base, session, arm, config: paths.config, home: paths.home, auth: false });
        arm.setup.forEach((step, i) =>
        {
            const argv = resolve(step, vars);
            const r = runStep(argv, { cwd: paths.repo, env: setupEnv, logFile });
            if (r.error || r.status !== 0) throw new Error(`${arm.name} setup step ${i + 1} (${argv[0]}) ${stepFailure(r)} - see ${logFile}`);
        });

        if (arm.onboarding.length && typeof onboard !== 'function') throw new Error(`${arm.name}: onboarding prompts but no onboarding runner`);
        // The driver names the run's credential; a caller that names none gets the only one set, or none.
        const onboardAuth = auth || (session.auth.some((name) => base[name]) ? pickAuth(session.auth, base) : false);
        const onboardEnv = sessionEnv({ base, session, arm, config: paths.config, home: paths.home, auth: onboardAuth });
        arm.onboarding.forEach((prompt, i) =>
        {
            try { onboard(prompt, { cwd: paths.repo, config: paths.config, home: paths.home, env: onboardEnv, index: i + 1, dir: paths.dir }); }
            catch (err) { throw new Error(`${arm.name} onboarding ${i + 1}: ${err.message}`); }
        });

        fs.writeFileSync(path.join(paths.dir, READY), `${JSON.stringify({ arm: arm.name, hash: arm.hash, pin: arm.pin, fixtureCommit: commit, builtAt: new Date().toISOString() }, null, 2)}\n`);
        return { paths, built: true, fixtureCommit: commit };
    }
    catch (err)
    {
        removeTree(paths.dir);
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

// `parts` narrows the copy - the grader needs the clone alone - but the rewrite always maps all three,
// so a copied file names exactly what it named in the session's cell.
function copyInto(paths, cell, { parts = ['config', 'home', 'repo'] } = {})
{
    if (fs.existsSync(cell.work) && fs.readdirSync(cell.work).length) throw new Error(`${cell.work} is not empty - reset the cell first`);
    for (const d of parts) fs.cpSync(paths[d], cell[d], { recursive: true, verbatimSymlinks: true });
    const pairs = ['config', 'home', 'repo'].map((d) => [paths[d], cell[d]]);
    // The plugin cache is the plugins' own code, installed from a marketplace: it names no account path.
    const skip = [path.join(cell.config, 'plugins', 'cache')];
    for (const d of parts) rewrite(cell[d], pairs, skip);
}

module.exports = { build, copyInto, READY };
