'use strict';

// Where the win leg looks for node.exe in the VM, past SYSTEM's own PATH: the installer's folder, and each signed-in
// user's nvm for Windows (NVM_HOME in that user's hive), in its `installs\v<x>` layout and its older `v<x>` one.
const WIN_NODE = Object.freeze({
    programFiles: 'C:\\Program Files\\nodejs\\node.exe',
    nvmHomeKey: 'NVM_HOME',
    nvmLayouts: Object.freeze(['installs\\v*\\node.exe', 'v*\\node.exe']),
    // The override: a node.exe path for a VM the probe cannot read.
    config: 'gate.windowsNode',
    env: 'GATE_WINDOWS_NODE',
    // One probe line: `<path>|<version>`.
    separator: '|',
});

// The leg folder under the run's work dir, and the files the gate copies there from the share.
const WIN_STAGE = Object.freeze({ folder: 'leg', legScript: 'gate-leg.js', config: 'win.json', bundle: 'repo.bundle' });

module.exports = { WIN_NODE, WIN_STAGE };
