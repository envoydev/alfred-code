'use strict';
const path = require('node:path');
const { SERVER_PACKAGE, TYPESCRIPT_PACKAGE, TSSERVER_FILE, PACKAGE_FILE, SHIM_PACKAGES, STATE } = require('./constants.js');

// The server's package folder from its bin: up from the file the bin resolves to, else below npm's Windows shim.
// '' when neither holds it.
function serverPackageDir(bin, { realpath, readName })
{
    const start = realpath(bin) || bin;
    for (let dir = path.dirname(start); ; dir = path.dirname(dir))
    {
        if (readName(path.join(dir, PACKAGE_FILE)) === SERVER_PACKAGE) return dir;
        if (path.dirname(dir) === dir) break;
    }
    const shimSide = path.join(path.dirname(start), SHIM_PACKAGES, SERVER_PACKAGE);
    return readName(path.join(shimSide, PACKAGE_FILE)) === SERVER_PACKAGE ? shimSide : '';
}

// Whether the server can start: the TypeScript it resolves from its own package holds tsserver.js. 'unknown' when the
// package cannot be found, so an unusual install is never reported broken.
function tsServerState(bin, seams)
{
    if (!bin) return STATE.unknown;
    const pkg = serverPackageDir(bin, seams);
    if (!pkg) return STATE.unknown;
    const entry = seams.resolveFrom(TYPESCRIPT_PACKAGE, pkg);
    if (!entry) return STATE.missing;
    return seams.exists(path.join(path.dirname(entry), TSSERVER_FILE)) ? STATE.ok : STATE.missing;
}

module.exports = { tsServerState, serverPackageDir };
