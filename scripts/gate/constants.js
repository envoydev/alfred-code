'use strict';

// Where the win leg looks for node.exe in the VM, past SYSTEM's own PATH: the installer's folder, each signed-in
// user's nvm for Windows (NVM_HOME in that user's hive), and the default nvm homes in every profile folder - a VM the
// gate started has nobody signed in, so no user hive is loaded. Each nvm home in its `installs\v<x>` layout and its
// older `v<x>` one.
const WIN_NODE = Object.freeze({
    programFiles: 'C:\\Program Files\\nodejs\\node.exe',
    nvmHomeKey: 'NVM_HOME',
    nvmLayouts: Object.freeze(['installs\\v*\\node.exe', 'v*\\node.exe']),
    profileList: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList',
    profilePathKey: 'ProfileImagePath',
    profileNvmHomes: Object.freeze(['AppData\\Local\\Author Software\\nvm', 'AppData\\Roaming\\nvm']),
    // The override: a node.exe path for a VM the probe cannot read.
    config: 'gate.windowsNode',
    env: 'GATE_WINDOWS_NODE',
    // One probe line: `<path>|<version>`.
    separator: '|',
});

// The leg folder under the run's work dir, and the files the gate copies there from the share.
const WIN_STAGE = Object.freeze({ folder: 'leg', legScript: 'gate-leg.js', config: 'win.json', bundle: 'repo.bundle' });

module.exports = { WIN_NODE, WIN_STAGE };
