'use strict';
// A hook run in THIS process, for the suites that drive one hook hundreds of times. A spawned node costs about 50ms
// on macOS (22ms of it node's own boot) and about six times that on the Windows runner; guard-stop-fresh.test.js ran
// in 65.7s spawned and 14.6s in-process, guard-stop-closes.test.js 13.8s and 6.2s (measured 2026-11-03). Not for a
// hook whose time is its own git calls: the commit gate's phrase matrix took 13.9s spawned and 13.4s in-process, so it
// stays spawned. guard-hooks.test.js stays spawned too: its 23 stop-contract runs in-process saved 5.6s of 112.5s, and
// its other hooks run in-process stalled the suite past ten minutes.
//
// It goes through shell-guards.js `runGuard` - the runner production already uses for the ten shell guards: the hook's
// source compiled as the main module, the payload on fd 0, process.exit ending it where it stands, stdout and stderr
// captured, argv and env put back. Here each call also gets the cwd and env a spawn would have had and a fresh copy of
// every stack hook module, so no module-level state (a memo, a cache) carries from one call to the next. A hook that
// ran on past an exit, or threw, fails the call - a process could do neither unseen.
//
// HOOK_TEST_SPAWN=1 spawns every call instead (a parity check by hand); hook-inprocess.test.js holds the two equal on
// a sample of payloads, and each suite keeps spawned cases of its own, so the process boundary stays tested.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');

function inProcess(hook, payload, { env = process.env, cwd = process.cwd() } = {})
{
    for (const key of Object.keys(require.cache)) if (key.startsWith(HOOKS + path.sep)) delete require.cache[key];
    const { runGuard } = require(path.join(HOOKS, 'shell-guards.js'));
    const savedEnv = { ...process.env };
    const savedCwd = process.cwd();
    const setEnv = (to) => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, to); };
    setEnv(env);
    process.chdir(cwd);
    let r;
    try { r = runGuard(path.join(HOOKS, hook), Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))); }
    finally
    {
        process.chdir(savedCwd);
        setEnv(savedEnv);
        for (const key of Object.keys(require.cache)) if (key.startsWith(HOOKS + path.sep)) delete require.cache[key];
    }
    if (r.error) throw new Error(`${hook} threw in-process: ${r.error.stack || r.error}`);
    if (r.swallowed) throw new Error(`${hook} ran on past its exit in-process - a catch around process.exit (stderr: ${r.stderr.slice(0, 300)})`);
    return { status: r.code, stdout: r.stdout, stderr: r.stderr };
}

function spawned(hook, payload, { env = process.env, cwd = process.cwd() } = {})
{
    const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env, cwd });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const runHook = (hook, payload, opts) => (process.env.HOOK_TEST_SPAWN === '1' ? spawned : inProcess)(hook, payload, opts);

module.exports = { runHook, inProcess, spawned, HOOKS };
