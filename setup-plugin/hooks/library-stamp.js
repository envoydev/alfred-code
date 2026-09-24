#!/usr/bin/env node
'use strict';
// SessionStart, core entry: plugins update themselves, LIBRARY copies move only on
// /alfred-code:update. When the project's copies are from an older release than the stack that is
// running, say so once per session - to the user (who runs the update) and to the model (so it does
// not trust a copy's content as current). Silent in every other case, and never fails a session.
//
// The project's own stamp first; a project with none of its own falls back to the account dir - a
// 1.x GLOBAL install kept its stamp there, and this project has not yet run the `update` that moves
// it (migrateLegacyGlobal, stamp.js). Every 2.x install writes its stamp into the project at every
// scope, so this fallback only ever fires in that migration window. Each under either name: a
// project the 1.x release installed holds the old stamp until its first update (brand.js stampFile -
// the new name wins).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main()
{
    let input = {};
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}; } catch { input = {}; }
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    let readLibrary, stampFile;
    try
    {
        ({ readLibrary } = require(path.join(root, 'scripts', 'install', 'stamp.js')));
        ({ stampFile } = require(path.join(root, 'scripts', 'install', 'brand.js')));
    }
    catch { return; }
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const lib = readLibrary(stampFile(path.join(project, '.claude')).read || stampFile(account).read);
    if (!lib || !lib.version) return;
    let stack = '';
    try { stack = JSON.parse(fs.readFileSync(path.join(root, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; } catch { return; }
    // Both are echoed into the session, and the stamp is a project file a clone can fill with any
    // text: only a plain release number is ever read as one.
    const release = /^\d+\.\d+\.\d+$/;
    if (!release.test(String(lib.version)) || !release.test(String(stack))) return;
    const n = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
    const [a, b] = [n(stack), n(lib.version)];
    const older = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : (a[2] || 0) > (b[2] || 0);
    if (!older) return;
    const line = `alfred-code: this project's library copies are from ${lib.version}, the stack is ${stack} - run /alfred-code:update to take the newer skills and agents.`;
    process.stdout.write(JSON.stringify({ systemMessage: line, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } }));
}

try { main(); } catch { /* fail open: a session never breaks on this line */ }
