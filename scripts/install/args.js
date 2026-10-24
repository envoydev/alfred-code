'use strict';
// THE FLAG SURFACE - the shell twin's `usage()` block, in Node.
//
// Phase 7 is a rewrite, never a behaviour change, so every flag keeps its spelling, its enum, its
// lower-casing and its refusal text. Two spellings are accepted for each valued flag - `--flag
// value` and `--flag=value` - because both twins accept both and a command body in the wild uses
// whichever it was written with.
//
// Everything here refuses BEFORE the run writes anything. That is the rule the shell states about
// `--docs-versioning` and it is worth everywhere: a typo that reaches settings.json is read back by
// the next run as a deliberate choice, and nothing downstream can tell the difference.
//
// An empty string is not a default. It means 'not given', and a later rule decides - the docs
// versioning from the absent-only seed. Collapsing that into a default here would silently overwrite a project's own
// answer on every update.

const ENUMS = {
    scope: { values: ['', 'project', 'user', 'local'], text: "--scope must be 'project', 'user' or 'local'" },
    docsVersioning: { values: ['', 'git', 'local'], text: "--docs-versioning must be 'git' or 'local'" },
    // The answer to the data move (docs.dataOffer): 'move' carries the sensitive-data file under the data root;
    // 'keep' leaves it where it is and no later update offers again. Not given, nothing moves. `--docs-move` is the
    // 2.0.0 spelling, read for one release.
    dataMove: { values: ['', 'move', 'keep'], text: "--data-move must be 'move' or 'keep'" },
    // The answer to update's docs-move ask (docs.docsMovePlan `handSet`, 2.8.0): a docs root the user set by hand moves
    // to <data root>/docs only on 'move', `--docs-root-leave` naming what stays. No keep: every docs file of the stack's
    // belongs under the data root (the user's answer of 2026-10-20). Not given, nothing moves and the next update asks.
    docsRootMove: { values: ['', 'move'], text: "--docs-root-move must be 'move'" },
    // Compact instead of offering a fresh session (ALFRED_CODE_AUTO_COMPACT, settings.js applyEnv): setup's screen-B
    // answer, written over the value already there. Not given, the absent-only seed (`0`) stands.
    autoCompact: { values: ['', 'on', 'off'], text: "--auto-compact must be 'on' or 'off'" },
    // 'docs' joins once the docs memory mode ships (spec P3).
    memory: { values: ['', 'default', 'custom'], text: "--memory must be 'default' or 'custom'" },
    // Where the project's instruction files (AGENTS.md, CLAUDE.md) live - init's and configure's answer: a seed is written
    // there and a file at the other place moves (seeds.placeInstructionFiles). Not given, nothing moves and a seed goes to
    // .claude/.
    instructionsAt: { values: ['', 'root', 'claude'], text: "--instructions-at must be 'root' or 'claude'" },
    // The instruction file's name - init's and configure's answer: a seed takes it, a file of the other name at the root
    // and in .claude/ is renamed (seeds.renameInstructionFiles), and the stamp keeps it. Not given, the stamp's answer
    // stands, else AGENTS.md.
    instructionsFile: { values: ['', 'agents', 'claude'], text: "--instructions-file must be 'agents' or 'claude'" },
    // Uninstall's answer for an unedited instruction-file seed - /alfred-code:uninstall asks it (the user's ask of
    // 2026-10-23). Not given, the seed stays and the log names this flag; an edited one is the project's either way.
    instructionsSeed: { values: ['', 'keep', 'remove'], text: "--instructions-seed must be 'keep' or 'remove'" },
};

const VALUED = new Map([
    ['--scope', 'scope'],
    ['--docs-versioning', 'docsVersioning'],
    ['--data-move', 'dataMove'], ['--docs-move', 'dataMove'], ['--data-path', 'dataPath'], ['--docs-root-move', 'docsRootMove'], ['--docs-root-leave', 'docsRootLeaveRaw'], ['--auto-compact', 'autoCompact'], ['--memory', 'memory'],
    ['--instructions-at', 'instructionsAt'], ['--instructions-file', 'instructionsFile'], ['--instructions-seed', 'instructionsSeed'],
    ['--selection', 'selection'], ['--source', 'source'], ['--plan-out', 'planOut'],
]);

const BOOLEAN = new Map([
    ['--forge-cli', 'forgeCli'], ['--keep-pins', 'keepPins'],
    ['--installed-only', 'installedOnly'], ['--print-plan', 'printPlan'], ['--skills-only', 'skillsOnly'],
]);

// The flags 2.0.0 took out with the servers they configured (the sentry and context7-local cut, R26
// and R32): refused in one line, whatever the value, so a command body that still passes one fails
// before anything is written rather than reading as a choice nothing honours.
const REMOVED = new Map([
    ['--context7', 'context7 is the hosted server only'],
    ['--sentry-slug', 'the sentry server left the stack'],
    ['--sentry-auth', 'the sentry server left the stack'],
]);

// The flags 2.10.1 took out with the servers they configured (the stack ships no MCP server): ACCEPTED with their
// value and ignored, one line each (`ignored`, which the installer logs) - not refused like the 2.0.0 ones, because a
// session started before the update still runs the older command body, which passes them to this snapshot's installer.
const RETIRED_FLAGS = new Map([
    ['--memory-level', 'the memory server left the stack'],
    ['--browsers', 'the browser servers left the stack'],
    ['--browser-enabled', 'the browser servers left the stack'],
    ['--playwright-browsers', 'the browser servers left the stack'],
    ['--playwright-enabled', 'the browser servers left the stack'],
]);

// 2.2.0: the OPTIONAL items, each installed at its own scope - global (the CLI's `user`, every project on the
// account), this project (the run's own scope; `project` when the run is a user-scope one) or local (this checkout
// alone). Never managed: no run installs there. The core follows --scope.
const SCOPED_ITEMS = ['typescript-lsp', 'csharp-lsp', 'claude-hud'];
// The servers that took a scope of their own until 2.10.1 (and the three that followed --scope): an older walk still passes
// `--scope-of <server>=...`, so the line is ignored like a retired flag, never refused.
const RETIRED_SCOPED = new Set(['browser', 'chrome-control', 'msedge-control', 'firefox-control', 'webkit-control',
    'windows-control', 'macos-control', 'mobile-control', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']);
const SCOPE_OF = /^([a-z0-9-]+)=(global|user|project|local)$/;

const ALIASES = new Map([['--docs-move', '--data-move']]);

const FLAG_LIST = '--scope, --docs-versioning, --data-path, --data-move, --docs-root-move, --docs-root-leave, --auto-compact, --memory, --instructions-at, --instructions-file, --instructions-seed, --forge-cli, --keep-pins, --selection, --installed-only, --add, --drop, --scope-of, --print-plan, --plan-out, --skills-only, --source';

// One selection line, the shape the walks write: `<category> <name>`.
const ADD_LINE = /^(skill|agent|rule|hook|mcp|plugin) [A-Za-z0-9._-]+$/;

function fail(message)
{
    const err = new Error(message);
    err.usage = true;
    throw err;
}

const lower = (v) => String(v ?? '').toLowerCase();

function parseArgs(argv)
{
    const out = {
        action: '', scope: '',
        docsVersioning: '', dataMove: '', dataPath: '', docsRootMove: '', docsRootLeaveRaw: '', autoCompact: '', memory: '', instructionsAt: '', instructionsFile: '', instructionsSeed: '',
        selection: '', source: '', planOut: '',
        forgeCli: false, keepPins: false, installedOnly: false, printPlan: false, skillsOnly: false,
        add: [], drop: [], scopeOf: {}, ignored: [],
    };

    const given = new Set();
    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const name = arg.startsWith('--') && eq > -1 ? arg.slice(0, eq) : arg;

        if (REMOVED.has(name)) fail(`${name} was removed in 2.0.0 - ${REMOVED.get(name)}; drop the flag`);
        if (BOOLEAN.has(name) && name === arg) { out[BOOLEAN.get(name)] = true; continue; }
        if (RETIRED_FLAGS.has(name))
        {
            if (!(eq > -1 && name !== arg)) i++;
            out.ignored.push(`${name} ignored - ${RETIRED_FLAGS.get(name)} in 2.10.1`);
            continue;
        }

        // Repeatable: each --add is an item the user said yes to, each --drop one they switched off,
        // on top of what the install reads back.
        if (name === '--add' || name === '--drop')
        {
            const value = eq > -1 && name !== arg ? arg.slice(eq + 1) : argv[++i];
            if (!value || !ADD_LINE.test(value.trim())) fail(`${name} takes '<skill|agent|rule|hook|mcp|plugin> <name>' (got '${value || ''}')`);
            out[name.slice(2)].push(value.trim());
            continue;
        }

        // Repeatable: `--scope-of <item>=<global|project|local>`, one optional item's own scope.
        if (name === '--scope-of')
        {
            const value = lower(eq > -1 && name !== arg ? arg.slice(eq + 1) : argv[++i]).trim();
            const m = SCOPE_OF.exec(value);
            if (!m) fail(`--scope-of takes '<item>=<global|project|local>' (got '${value}')`);
            if (RETIRED_SCOPED.has(m[1])) { out.ignored.push(`--scope-of ${m[1]} ignored - the server left the stack in 2.10.1`); continue; }
            if (!SCOPED_ITEMS.includes(m[1]))
                fail(`--scope-of: '${m[1]}' has no scope of its own - one of ${SCOPED_ITEMS.join(', ')}; the core follows --scope`);
            out.scopeOf[m[1]] = m[2] === 'project' || m[2] === 'local' ? m[2] : 'user';
            continue;
        }

        if (VALUED.has(name))
        {
            // `--flag=` is a flag given a value that happens to be empty, which is a typo, not an
            // omission - the same refusal either way.
            const value = eq > -1 && name !== arg ? arg.slice(eq + 1) : argv[++i];
            if (!value) fail(`${name} needs a value`);
            // The flag's other spelling already given: ambiguous, whichever came first.
            const flag = ALIASES.get(name) || name;
            const old = [...ALIASES].find(([, now]) => now === flag)?.[0];
            const twin = name === flag ? old : flag;
            if (twin && given.has(twin)) fail(`${flag} and ${old} are one flag - pass ${flag} alone`);
            given.add(name);
            out[VALUED.get(name)] = value;
            continue;
        }

        if (arg.startsWith('-')) fail(`unknown argument '${arg}' (named flags only: ${FLAG_LIST})`);
        if (out.action) fail(`unknown argument '${arg}' (named flags only: ${FLAG_LIST})`);
        out.action = arg;
    }

    if (!out.action) fail(`an action is required, positional: install, update or uninstall (named flags: ${FLAG_LIST})`);
    if (!['install', 'update', 'uninstall'].includes(out.action)) fail(`the action must be 'install', 'update' or 'uninstall' (got '${out.action}')`);
    for (const flag of ['add', 'drop'])
        if (out[flag].length && !out.installedOnly) fail(`--${flag} needs --installed-only - a walk writes its picks into the --selection file`);
    if (out.planOut && !out.printPlan) fail('--plan-out needs --print-plan - it writes the inventory the plan prints');

    // I3 (R47): the flag, else '' - NOT a default of 'project' here, the same 'an empty string means
    // not given' rule this file's own header states for docsVersioning. `update` without
    // it takes the scope the LAST install actually used, from the stamp's own `scope:` line
    // (alfred-code.js, once it has read the stamp); an `install` (nothing to read yet) resolves '' to
    // 'project' right there too. Collapsing to 'project' HERE, before that stamp read, is exactly the
    // bug this fixes - a later update on a user/local install silently fell back to project scope.
    // A-M4: never an ambient `SCOPE` - another tool's variable made a project run account-wide.
    out.scope = lower(out.scope || '');
    // 'global' is the 2.x name for the CLI's own 'user' scope - a 1.x command body still passes it,
    // and it is aliased here so nothing downstream ever sees a fourth spelling.
    if (out.scope === 'global') out.scope = 'user';
    out.docsVersioning = lower(out.docsVersioning);
    out.dataMove = lower(out.dataMove);
    out.docsRootMove = lower(out.docsRootMove);
    out.autoCompact = lower(out.autoCompact);
    out.memory = lower(out.memory);
    out.instructionsAt = lower(out.instructionsAt);
    out.instructionsFile = lower(out.instructionsFile);
    out.instructionsSeed = lower(out.instructionsSeed);
    if (out.instructionsSeed && out.action !== 'uninstall') fail('--instructions-seed is uninstall\'s answer - install and update never remove the seed');
    // The data root is a folder INSIDE the project (stack/mcp/data-root.js checkDataPath says what is refused
    // and why) - refused here, before a path that would prompt or escape the project lands.
    if (out.dataPath)
    {
        const checked = require('../../stack/mcp/data-root.js').checkDataPath(out.dataPath);
        if (!checked.ok) fail(`--data-path: ${checked.why}`);
        out.dataPath = checked.value;
    }

    for (const [key, { values, text }] of Object.entries(ENUMS))
        if (!values.includes(out[key])) fail(`${text} (got '${out[key]}')`);
    // The entries update's docs-root ask named as the team's own (docs.docsMovePlan `leave`): top-level names, a folder's
    // trailing slash dropped, left where they are while the rest move - so only beside a move.
    out.docsRootLeave = out.docsRootLeaveRaw.split(',').map((s) => s.trim().replace(/[\\/]+$/, '')).filter(Boolean);
    if (out.docsRootLeave.length && out.docsRootMove !== 'move') fail('--docs-root-leave needs --docs-root-move move - it names what stays while the rest move');
    if (out.docsRootLeave.some((n) => /[\\/]/.test(n) || n === '.' || n === '..'))
        fail('--docs-root-leave names top-level entries of the old docs root, comma-separated (architecture/,decisions/)');

    return out;
}

module.exports = { parseArgs, FLAG_LIST, ENUMS, SCOPED_ITEMS };
