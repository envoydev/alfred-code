'use strict';
// The warning for a node that rests on one nvm version folder: `nvm uninstall` of that version removes the node every
// alfred-code hook starts with. Values in, a line or null out; the hook and the installer inject `exists`, and `nvmDir`
// (NVM_DIR) and `realpath` default to the environment and the disk, as a custom NVM_DIR and a symlinked HOME need.
// A node reached through `<nvm dir>/current/bin` (nvm makes the link on `nvm use` with NVM_SYMLINK_CURRENT=true) survives it.
const fs = require('node:fs');
const path = require('node:path');
const { WIN32, PATH_DELIMITER, NVM_DIR_REL, NVM_VERSIONS_REL, NVM_CURRENT_BIN_REL, NODE_BIN, VERSION_FOLDER, NVM_HOME_BASE, WARNING } = require('./node-path-constants.js');

function realpathOrSame(value)
{
    try { return fs.realpathSync(value); } catch { return value; }
}

function realOf(realpath, value)
{
    try
    {
        const real = realpath(value);
        return typeof real === 'string' && real ? real : value;
    }
    catch { return value; }
}

// Every spelling of the nvm folders this run can name: under the home and the NVM_DIR value, each as written and as
// the disk resolves it. `base` is how the warning names the folder.
function nvmRoots(home, nvmDir, realpath)
{
    const named = [{ dir: path.posix.join(home, NVM_DIR_REL), base: NVM_HOME_BASE }];
    if (typeof nvmDir === 'string' && nvmDir)
    {
        const dir = path.posix.normalize(nvmDir).replace(/\/$/, '');
        named.push({ dir, base: dir });
    }
    const roots = [];
    for (const { dir, base } of named)
        for (const spelled of [dir, realOf(realpath, dir)])
            if (!roots.some((root) => root.dir === spelled)) roots.push({ dir: spelled, base });
    return roots;
}

function versionFolderOf(execPath, roots, realpath)
{
    if (typeof execPath !== 'string') return null;
    for (const spelled of [execPath, realOf(realpath, execPath)])
    {
        for (const { dir, base } of roots)
        {
            const prefix = `${path.posix.join(dir, NVM_VERSIONS_REL)}/`;
            if (!spelled.startsWith(prefix)) continue;
            const rest = spelled.slice(prefix.length).split('/');
            if (rest.length > 1 && VERSION_FOLDER.test(rest[0]) && rest[0] !== '..') return { version: rest[0], base };
        }
    }
    return null;
}

function currentLinkHoldsNode(pathEnv, roots, exists)
{
    if (typeof pathEnv !== 'string' || typeof exists !== 'function') return false;
    const currentBins = roots.map(({ dir }) => path.posix.join(dir, NVM_CURRENT_BIN_REL));
    for (const entry of pathEnv.split(PATH_DELIMITER))
    {
        if (!entry) continue;
        const spelled = path.posix.normalize(entry).replace(/\/$/, '');
        if (!currentBins.includes(spelled)) continue;
        try { if (exists(`${spelled}/${NODE_BIN}`)) return true; } catch { /* unreadable: no node found here */ }
    }
    return false;
}

function nvmPathWarning({ execPath, pathEnv, home, platform, exists, nvmDir = process.env.NVM_DIR, realpath = realpathOrSame } = {})
{
    if (platform === WIN32) return null;
    if (typeof home !== 'string' || !home) return null;
    const roots = nvmRoots(home, nvmDir, realpath);
    const found = versionFolderOf(execPath, roots, realpath);
    if (!found) return null;
    return currentLinkHoldsNode(pathEnv, roots, exists) ? null : WARNING(found.version, found.base);
}

module.exports = { nvmPathWarning };
