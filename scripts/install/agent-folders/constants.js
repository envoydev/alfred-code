'use strict';

// The agent-folder pass (workspace versioning, D4 / D8): which folders it keeps out of git and the texts it writes there.
const { CLAUDE_IGNORE, CLAUDE_VERSIONING_IGNORE, CURSOR_VERSIONING_IGNORE } = require('../../../stack/mcp/data-root.js');

const FOLDER = Object.freeze({ claude: '.claude', cursor: '.cursor' });
const FOLDERS = Object.freeze([FOLDER.claude, FOLDER.cursor]);

const IGNORE_FILE = '.gitignore';

// A file holding one of these byte for byte is the stack's; any other content is the project's.
const STACK_TEXTS = Object.freeze([CLAUDE_IGNORE, CLAUDE_VERSIONING_IGNORE, CURSOR_VERSIONING_IGNORE]);

const ACTION = Object.freeze({ write: 'write', remove: 'remove', keep: 'keep', tell: 'tell' });

const SCOPE_LOCAL = 'local';
const VERSIONING_LOCAL = 'local';

const trackedNotice = (folder) => `!! ${folder}: git tracks files under it - versioning local cannot hide it; untrack them (git rm -r --cached ${folder}) to keep it out`;

module.exports = {
    FOLDER, FOLDERS, IGNORE_FILE, STACK_TEXTS, ACTION, SCOPE_LOCAL, VERSIONING_LOCAL, trackedNotice,
    CLAUDE_IGNORE, CLAUDE_VERSIONING_IGNORE, CURSOR_VERSIONING_IGNORE,
};
