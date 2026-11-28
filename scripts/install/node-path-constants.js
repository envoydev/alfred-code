'use strict';
// The named values of the nvm path warning (install/node-path.js).

const WIN32 = 'win32';
const PATH_DELIMITER = ':';
const NVM_DIR_REL = '.nvm';
const NVM_VERSIONS_REL = 'versions/node';
const NVM_CURRENT_BIN_REL = 'current/bin';
const NODE_BIN = 'node';
// One folder of nvm's versions directory, as nvm names it ('v24.11.0'); the folder name is echoed into the session.
const VERSION_FOLDER = /^[\w.-]+$/;
const NVM_HOME_BASE = '~/.nvm';
const WARNING = (version, base = NVM_HOME_BASE) => `node comes from one nvm version folder (${base}/versions/node/${version}). Removing that version stops every alfred-code hook, and every shell and file call is then refused. The fix, in your shell profile (zsh: ~/.zprofile): export NVM_SYMLINK_CURRENT=true, then run 'nvm alias default ${version}' and 'nvm use default', and put ${base}/current/bin on the PATH. nvm makes the 'current' link only on 'nvm use' with NVM_SYMLINK_CURRENT=true.`;

module.exports = { WIN32, PATH_DELIMITER, NVM_DIR_REL, NVM_VERSIONS_REL, NVM_CURRENT_BIN_REL, NODE_BIN, VERSION_FOLDER, NVM_HOME_BASE, WARNING };
