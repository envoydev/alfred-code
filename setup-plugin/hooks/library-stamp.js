#!/usr/bin/env node
'use strict';
// SessionStart, core entry: plugins update themselves, LIBRARY copies move only on
// /alfred-code:update. When the project's copies are from an older release than the stack that is
// running, say so once per session - to the user (who runs the update) and to the model (so it does
// not trust a copy's content as current). Silent in every other case, and never fails a session.
//
// The project's own stamp is the one read: a repo never set up gets silence (B-I1).
//
// THE 2.1.0 SKEW WINDOW. 2.1.0 moved every skill out of the core into the project and every seat into
// the core, each unpicked one denied. The core updates itself (another project's update, auto-update);
// the copies and the denies move only on this project's /alfred-code:update. A stamp from before the
// move (no `seats-route:` line) under a core at or past 2.1.0 is that window - the house skills the
// rules name are not installed yet and every seat is listed - so the line says it in those words.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// STACK HOOK GATES (2.1.5 M4) - the core's hook-prelude.js from the plugin root: the csv opt-out, `hook_profile:
// minimal` and a Cursor payload stand it down; GATE 4 is skipped (`setUp: false`) - the stamp
// reads below already say nothing in a repo never set up.
const PRELUDE = path.join(__dirname, '..', '..', 'stack', 'hooks', 'hook-prelude.js');

function main()
{
    let off = false;
    try { off = require(PRELUDE).standDown('library-stamp', process.env, process.argv, { setUp: false }); } catch { /* no prelude: run */ }
    if (off) return;
    let input = {};
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}; } catch { input = {}; }
    let cursorOff = false;
    try { cursorOff = require(PRELUDE).cursorStandDown(input, __filename); } catch { /* no prelude: run */ }
    if (cursorOff) return;
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    let readLibrary, validItemName, stampFile, readSeatsRoute;
    try
    {
        ({ readLibrary, validItemName, readSeatsRoute } = require(path.join(root, 'scripts', 'install', 'stamp.js')));
        ({ stampFile } = require(path.join(root, 'scripts', 'install', 'brand.js')));
    }
    catch { return; }
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const projectStampFile = stampFile(path.join(project, '.claude')).read;
    const lib = readLibrary(projectStampFile);
    if (!lib || !lib.version) return;
    let stack = '';
    try { stack = JSON.parse(fs.readFileSync(path.join(root, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; } catch { return; }
    // Both are echoed into the session, and the stamp is a project file a clone can fill with any
    // text: only a plain release number is ever read as one.
    const release = /^\d+\.\d+\.\d+$/;
    if (!release.test(String(lib.version)) || !release.test(String(stack))) return;
    const n = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
    const newer = (x, y) => (x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : (x[2] || 0) > (y[2] || 0));
    const [a, b] = [n(stack), n(lib.version)];
    const older = newer(a, b);
    const MOVE = [2, 1, 0];
    const moved = older && !newer(MOVE, a) && newer(MOVE, b) && !(readSeatsRoute && readSeatsRoute(projectStampFile));
    // I6 (R47, fix round 1): a personal skill in the ACCOUNT dir overrides a project library copy of
    // the same name (Claude Code runs personal over project) - flagged here too, whether or not the
    // stamp is stale, since library-check.js's own read only runs on demand (validate/status).
    // N1/N2: a name is validated before it is ever joined against the account skills/ dir - this
    // line's own comment above promises only a plain name is echoed into the session, and a name
    // that fails the check is dropped before the isDir probe, never echoed.
    const acctSkillsDir = path.join(account, 'skills');
    const shadowed = Object.keys(lib.skills || {}).filter((name) =>
    {
        if (!validItemName(name, acctSkillsDir)) return false;
        let isDir = false;
        try { isDir = fs.statSync(path.join(acctSkillsDir, name)).isDirectory(); } catch { isDir = false; }
        return isDir;
    });
    if (!older && !shadowed.length) return;
    const parts = [];
    if (moved) parts.push(`this project's skills and seats are from ${lib.version}, and 2.1.0 moved every skill into the project and every seat into the core (the stack is ${stack}) - until /alfred-code:update runs here the house skills the rules name are not installed and every seat is listed undenied: run /alfred-code:update now`);
    else if (older) parts.push(`this project's library copies are from ${lib.version}, the stack is ${stack} - run /alfred-code:update to take the newer skills and agents`);
    if (shadowed.length) parts.push(`an account skill overrides this project's own copy of the same name (Claude Code runs personal over project): ${shadowed.join(', ')} - remove the account copy once every project has updated`);
    const line = `alfred-code: ${parts.join('; ')}.`;
    process.stdout.write(JSON.stringify({ systemMessage: line, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } }));
}

try { main(); } catch { /* fail open: a session never breaks on this line */ }
