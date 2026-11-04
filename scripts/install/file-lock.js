'use strict';
// The installer's exclusive-create lock, shared by the workspace file and `.variables`: a lock file created with `wx`,
// retried every 50 ms for `retryMs`, taken over when its mtime is older than `staleMs` (a run that died holding it).
const fs = require('node:fs');

const STEP_MS = 50;

// Atomics.wait blocks without spinning; the installer and the CLI are synchronous throughout.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

// true once this run holds the lock, false when another run held it past `retryMs`. A lock older than `staleMs`
// (by its mtime) is a run that died holding it, and is taken over.
function takeLock(lock, { now, sleep, retryMs, staleMs })
{
    const start = now();
    for (;;)
    {
        try
        {
            fs.closeSync(fs.openSync(lock, 'wx'));
            return true;
        }
        catch (e)
        {
            if (!e || e.code !== 'EEXIST') throw e;
        }
        // A lock this run cannot read or remove - a dangling link, a directory named like it, a read-only file on
        // Windows - waits out `retryMs` like a live one, never spins (R065). Only a lock gone by the time of the stat
        // or the unlink (another run released or took it over) is tried again at once.
        let age = 0;
        let stuck = false;
        try { age = now() - fs.statSync(lock).mtimeMs; }
        catch (e) { if (e && e.code === 'ENOENT' && !isLink(lock)) continue; stuck = true; }
        if (!stuck && age > staleMs)
        {
            try { fs.unlinkSync(lock); continue; }
            catch (e) { if (e && e.code === 'ENOENT') continue; }
        }
        if (now() - start >= retryMs) return false;
        sleep(STEP_MS);
    }
}

module.exports = { STEP_MS, sleepMs, takeLock };
