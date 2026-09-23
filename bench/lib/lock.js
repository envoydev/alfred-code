'use strict';
// A directory lock: `mkdir <dir>/.lock` is atomic on every file system the harness runs on, and the
// pid written inside says who holds it. A holder that died - a killed driver, a reboot - is found by
// signalling its pid and the lock reclaimed, so a resume is never blocked by a corpse. The same code
// locks a whole run (one driver) and a single cell (one worker).
const fs = require('node:fs');
const path = require('node:path');

// A lock directory with no readable pid is one being created right now - live while this young.
const MID_CREATE_MS = 10000;

const lockDir = (dir) => path.join(dir, '.lock');

function holder(dir)
{
    try
    {
        const pid = Number(fs.readFileSync(path.join(lockDir(dir), 'pid'), 'utf8').trim());
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    catch { return null; }
}

// EPERM means the pid exists under another user - alive, just not ours to signal.
function alive(pid)
{
    try { process.kill(pid, 0); return true; }
    catch (err) { return err.code === 'EPERM'; }
}

function take(dir, pid)
{
    fs.mkdirSync(lockDir(dir));
    fs.writeFileSync(path.join(lockDir(dir), 'pid'), `${pid}\n`);
}

function acquire(dir, { pid = process.pid } = {})
{
    fs.mkdirSync(dir, { recursive: true });
    try { take(dir, pid); return { ok: true, reclaimed: null }; }
    catch (err) { if (err.code !== 'EEXIST') throw err; }

    const current = holder(dir);
    if (current != null && alive(current)) return { ok: false, holder: current };
    if (current == null)
    {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(lockDir(dir)).mtimeMs; } catch { /* gone meanwhile */ }
        if (age < MID_CREATE_MS) return { ok: false, holder: null };
    }
    fs.rmSync(lockDir(dir), { recursive: true, force: true });
    try { take(dir, pid); }
    catch (err)
    {
        // Another driver reclaimed it between our remove and our mkdir - it won.
        if (err.code === 'EEXIST') return { ok: false, holder: holder(dir) };
        throw err;
    }
    return { ok: true, reclaimed: current == null ? 'unreadable' : current };
}

function release(dir, { pid = process.pid } = {})
{
    if (holder(dir) !== pid) return false;
    fs.rmSync(lockDir(dir), { recursive: true, force: true });
    return true;
}

module.exports = { acquire, release, holder, alive };
