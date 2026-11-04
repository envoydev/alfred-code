'use strict';
// One path equality for tests (O1, burn-down 2026-11-04). Windows spells one folder several ways - a forward slash, a
// drive letter's case, CI's 8.3 temp (RUNNER~1) - and the JS resolver (fs.realpathSync) keeps whichever spelling it was
// handed, so a test comparing two spellings went red on Windows only, again and again. realLong is the real path by its
// long name (the native resolver), samePath compares two of them. A path a test hands to production code keeps the
// spelling production uses; only a COMPARE goes through here. Lint check 71 pins the older non-native calls.
const fs = require('node:fs');
const path = require('node:path');

// The real path by its long name, spelled with path.sep and its case kept. A path that does not exist yet resolves
// through its nearest existing ancestor, the rest appended as given.
function realLong(p)
{
    const tail = [];
    let at = path.resolve(p);
    for (;;)
    {
        try { return path.join(fs.realpathSync.native(at), ...tail.reverse()); }
        catch (err)
        {
            const up = path.dirname(at);
            if (up === at || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) return path.join(at, ...tail.reverse());
            tail.push(path.basename(at));
            at = up;
        }
    }
}

// Two spellings of one place; case folded on win32 only, where the file system ignores it.
function samePath(a, b)
{
    const [x, y] = [realLong(a), realLong(b)];
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

module.exports = { realLong, samePath };
