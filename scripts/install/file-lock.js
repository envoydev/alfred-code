'use strict';
// The installer's exclusive-create lock, shared by the workspace file and `.variables`: a lock file created with `wx`,
// retried every 50 ms for `retryMs`, taken over when its mtime is older than `staleMs` (a run that died holding it).
const fs = require('node:fs');

const STEP_MS = 50;

// Atomics.wait blocks without spinning; the installer and the CLI are synchronous throughout.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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
        let age = 0;
        try { age = now() - fs.statSync(lock).mtimeMs; }
        catch { continue; }                 // released between the open and the stat: try again at once
        if (age > staleMs)
        {
            try { fs.unlinkSync(lock); } catch { /* another run took it over first: the open decides */ }
            continue;
        }
        if (now() - start >= retryMs) return false;
        sleep(STEP_MS);
    }
}

module.exports = { STEP_MS, sleepMs, takeLock };
