'use strict';
// THE OLD-NAME HOLD (B4): the named values of the scan that holds the `.sensitive-data` -> `.secrets` rename while a
// file the user owns still names the old store.

const MAX_SCAN_FILES = 20000;
const MAX_FILE_BYTES = 1024 * 1024;
// The whole scan reads at most this many bytes of text; past it the scan stops and the rename waits, as at the file cap.
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
// A file is binary when a NUL byte sits in its first bytes (git's own test), so only this much is read to tell.
const NUL_PROBE_BYTES = 8192;

const OLD_STORE_NAME = '.sensitive-data';
const NEW_STORE_NAME = '.secrets';

// The old name as a whole name: not inside a longer one (`x.sensitive-data`, `.sensitive-data.bak`, `.sensitive-data-old`).
const OLD_NAME_PATTERN = /(?<![\w.-])\.sensitive-data(?![\w-]|\.\w)/;

// The lines AGENTS.template.md carried in released versions, seeded verbatim into a project's AGENTS.md: the stack's text,
// not a reference. Each is compared to a trimmed line. First: 54b8ca43..before 1bc2b8d0; second: 1bc2b8d0..before 4fe8d23a;
// third: 4fe8d23a up to the reword that dropped the old name.
const OLD_TEMPLATE_LINES = Object.freeze([
    'cert / .sensitive-data blocks.',
    'cert / .secrets / .sensitive-data blocks.',
    "cert / .secrets / .sensitive-data blocks, in each machine's .claude/settings.local.json.",
]);

// Always scanned, tracked or not: the files a tool reads a path from.
const EXTRA_FILES = Object.freeze(['.mcp.json']);
const SETTINGS_DIR = '.claude';
const SETTINGS_FILE_PATTERN = /^settings[^/]*\.json$/;

// What the report says the scan covers.
const SCAN_COVERS = 'tracked text files under 1 MB, .mcp.json and .claude/settings*.json';

// What the installer itself writes and replaces on each update under `.claude/`: the copies its own lists name (installed.js),
// its stamp and `.gitignore`, and the `alfred-` prefix every rule the stack names or generates carries. The run books
// `repointRunBooks` edits are passed in by the effects layer, from the data root's own list.
const STACK_OWN_FILES = Object.freeze(['alfred-code.stamp', '.gitignore']);
const STACK_RULE_PREFIX = 'alfred-';
// The deny row the installer writes into a settings file (SECRET_DENY): the user's own row names a path.
const INSTALLER_DENY_ROW = /"Read\(\.sensitive-data\)"/g;

module.exports = {
    OLD_TEMPLATE_LINES, SCAN_COVERS, MAX_SCAN_FILES, MAX_FILE_BYTES, MAX_SCAN_BYTES, NUL_PROBE_BYTES, OLD_STORE_NAME, NEW_STORE_NAME, OLD_NAME_PATTERN, EXTRA_FILES, SETTINGS_DIR,
    SETTINGS_FILE_PATTERN, STACK_OWN_FILES, STACK_RULE_PREFIX, INSTALLER_DENY_ROW,
};
