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

// A test file `--tests` may name: the suite's own `*.test.js` (run-tests.js PATTERN).
const TEST_FILE = /\.test\.js$/;

// How long one leg's process runs before the gate kills it. The win leg runs the whole suite alone in a VM after the
// other legs, and took 36 minutes on a warm VM and over 45 after a fresh boot (2026-11-26).
const LEG_TIMEOUT_MS = Object.freeze({ mac: 45 * 60 * 1000, linux: 45 * 60 * 1000, win: 60 * 60 * 1000 });

// `2026-11-26T16:25:06` - the part of an ISO boot time up to the second.
const BOOT_SECOND_LENGTH = 19;

module.exports = { WIN_NODE, WIN_STAGE, TEST_FILE, LEG_TIMEOUT_MS, BOOT_SECOND_LENGTH };
