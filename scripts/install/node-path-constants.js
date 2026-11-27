'use strict';
// The named values of the nvm path warning (install/node-path.js).

const WIN32 = 'win32';
const PATH_DELIMITER = ':';
const NVM_VERSIONS_REL = '.nvm/versions/node';
const NVM_CURRENT_BIN_REL = '.nvm/current/bin';
const NODE_BIN = 'node';
// One folder of nvm's versions directory, as nvm names it ('v24.11.0'); the folder name is echoed into the session.
const VERSION_FOLDER = /^[\w.-]+$/;
const WARNING = (version) => `node comes from one nvm version folder (~/${NVM_VERSIONS_REL}/${version}). Removing that version stops every alfred-code hook, and every shell and file call is then refused. The fix, in your shell profile (zsh: ~/.zprofile): export NVM_SYMLINK_CURRENT=true, then run 'nvm alias default ${version}' and 'nvm use default', and put ~/${NVM_CURRENT_BIN_REL} on the PATH. nvm makes the 'current' link only on 'nvm use' with NVM_SYMLINK_CURRENT=true.`;

module.exports = { WIN32, PATH_DELIMITER, NVM_VERSIONS_REL, NVM_CURRENT_BIN_REL, NODE_BIN, VERSION_FOLDER, WARNING };
