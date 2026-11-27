'use strict';
// The warning for a node that rests on one nvm version folder: `nvm uninstall` of that version removes the node every
// alfred-code hook starts with. Pure - values in, a line or null out; the hook and the installer inject their own reads.
// A node reached through `~/.nvm/current/bin` (nvm makes the link on `nvm use` with NVM_SYMLINK_CURRENT=true) survives it.
const path = require('node:path');
const { WIN32, PATH_DELIMITER, NVM_VERSIONS_REL, NVM_CURRENT_BIN_REL, NODE_BIN, VERSION_FOLDER, WARNING } = require('./node-path-constants.js');

function versionFolderOf(execPath, home)
{
    if (typeof execPath !== 'string' || typeof home !== 'string' || !home) return null;
    const prefix = `${path.posix.join(home, NVM_VERSIONS_REL)}/`;
    if (!execPath.startsWith(prefix)) return null;
    const rest = execPath.slice(prefix.length).split('/');
    return rest.length > 1 && VERSION_FOLDER.test(rest[0]) && rest[0] !== '..' ? rest[0] : null;
}

function currentLinkHoldsNode(pathEnv, home, exists)
{
    if (typeof pathEnv !== 'string' || typeof exists !== 'function') return false;
    const currentBin = path.posix.join(home, NVM_CURRENT_BIN_REL);
    for (const entry of pathEnv.split(PATH_DELIMITER))
    {
        if (!entry || path.posix.normalize(entry).replace(/\/$/, '') !== currentBin) continue;
        try { if (exists(`${currentBin}/${NODE_BIN}`)) return true; } catch { /* unreadable: no node found here */ }
    }
    return false;
}

function nvmPathWarning({ execPath, pathEnv, home, platform, exists } = {})
{
    if (platform === WIN32) return null;
    const version = versionFolderOf(execPath, home);
    if (!version) return null;
    return currentLinkHoldsNode(pathEnv, home, exists) ? null : WARNING(version);
}

module.exports = { nvmPathWarning };
