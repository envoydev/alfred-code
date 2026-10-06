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
// versioning from the absent-only seed, the memory level from what is already registered. Collapsing that into a default here would silently
// overwrite a project's own answer on every update.

const ENUMS = {
    scope: { values: ['', 'project', 'user', 'local'], text: "--scope must be 'project', 'user' or 'local'" },
    docsVersioning: { values: ['', 'git', 'local'], text: "--docs-versioning must be 'git' or 'local'" },
    memoryLevel: { values: ['', 'global', 'scoped', 'project'], text: "--memory-level must be 'global', 'scoped' or 'project'" },
    // The answer to the data move (docs.dataOffer): 'move' carries the docs, the navigation server's
    // folder, the browser profiles and a project-level memory database under the data root; 'keep' leaves
    // the layout as it is and no later update offers again. Not given, nothing moves. `--docs-move` is the
    // 2.0.0 spelling, read for one release.
    dataMove: { values: ['', 'move', 'keep'], text: "--data-move must be 'move' or 'keep'" },
};

// ONE canonical order, so a server list never depends on how the flag was typed.
const { ENGINES: PW_ENGINES } = require('../../stack/mcp/data-root.js');

const VALUED = new Map([
    ['--space', 'space'], ['--scope', 'scope'],
    ['--browsers', 'playwrightBrowsersRaw'], ['--browser-enabled', 'playwrightEnabledRaw'],
    // The pre-2.0.0 spellings (the playwright -> browser rename), read for one release: a command body
    // from before it still passes them. Never beside the new spelling of the same flag.
    ['--playwright-browsers', 'playwrightBrowsersRaw'], ['--playwright-enabled', 'playwrightEnabledRaw'],
    ['--docs-versioning', 'docsVersioning'], ['--memory-level', 'memoryLevel'],
    ['--data-move', 'dataMove'], ['--docs-move', 'dataMove'], ['--data-path', 'dataPath'],
    ['--selection', 'selection'], ['--source', 'source'], ['--plan-out', 'planOut'],
]);

const BOOLEAN = new Map([
    ['--github-cli', 'githubCli'], ['--keep-pins', 'keepPins'],
    ['--installed-only', 'installedOnly'], ['--print-plan', 'printPlan'], ['--skills-only', 'skillsOnly'],
    ['--rename-claude-md', 'renameClaudeMd'],
]);

// The flags 2.0.0 took out with the servers they configured (the sentry and context7-local cut, R26
// and R32): refused in one line, whatever the value, so a command body that still passes one fails
// before anything is written rather than reading as a choice nothing honours.
const REMOVED = new Map([
    ['--context7', 'context7 is the hosted server only'],
    ['--sentry-slug', 'the sentry server left the stack'],
    ['--sentry-auth', 'the sentry server left the stack'],
]);

const ALIASES = new Map([['--playwright-browsers', '--browsers'], ['--playwright-enabled', '--browser-enabled'], ['--docs-move', '--data-move']]);

const FLAG_LIST = '--space, --scope, --memory-level, --browsers, --browser-enabled, --docs-versioning, --data-path, --data-move, --github-cli, --keep-pins, --selection, --installed-only, --add, --drop, --print-plan, --plan-out, --skills-only, --rename-claude-md, --source';

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
        action: '', space: '', scope: '',
        playwrightBrowsersRaw: '', playwrightEnabledRaw: '', docsVersioning: '', memoryLevel: '', dataMove: '', dataPath: '',
        selection: '', source: '', planOut: '',
        githubCli: false, keepPins: false, installedOnly: false, printPlan: false, skillsOnly: false,
        add: [], drop: [],
    };

    const given = new Set();
    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const name = arg.startsWith('--') && eq > -1 ? arg.slice(0, eq) : arg;

        if (REMOVED.has(name)) fail(`${name} was removed in 2.0.0 - ${REMOVED.get(name)}; drop the flag`);
        if (BOOLEAN.has(name) && name === arg) { out[BOOLEAN.get(name)] = true; continue; }

        // Repeatable: each --add is an item the user said yes to, each --drop one they switched off,
        // on top of what the install reads back.
        if (name === '--add' || name === '--drop')
        {
            const value = eq > -1 && name !== arg ? arg.slice(eq + 1) : argv[++i];
            if (!value || !ADD_LINE.test(value.trim())) fail(`${name} takes '<skill|agent|rule|hook|mcp|plugin> <name>' (got '${value || ''}')`);
            out[name.slice(2)].push(value.trim());
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

    // --space is baked into a path (~/.claude-<space>, memory_<space>.db), so its characters are
    // checked here rather than discovered as a broken directory name later. Its CASING is
    // significant - it names a directory - which is why it is the one value not lower-cased.
    if (out.space && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(out.space))
        fail(`--space '${out.space}' must start alphanumeric; chars [A-Za-z0-9._-]`);

    // I3 (R47): the flag, else '' - NOT a default of 'project' here, the same 'an empty string means
    // not given' rule this file's own header states for docsVersioning and memoryLevel. `update` without
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
    out.memoryLevel = lower(out.memoryLevel);
    out.dataMove = lower(out.dataMove);
    // The data root is a folder INSIDE the project (stack/mcp/data-root.js checkDataPath says what is refused
    // and why) - refused here, before a path that would prompt, escape the project or break a server lands.
    if (out.dataPath)
    {
        const checked = require('../../stack/mcp/data-root.js').checkDataPath(out.dataPath);
        if (!checked.ok) fail(`--data-path: ${checked.why}`);
        out.dataPath = checked.value;
    }

    for (const [key, { values, text }] of Object.entries(ENUMS))
        if (!values.includes(out[key])) fail(`${text} (got '${out[key]}')`);

    // R29 (T16) / I5 (R47) / C10: the memory db path is resolved PER PROJECT by the PLUGIN launcher (it
    // reads the CURRENT project's settings at launch, never a value baked into the registration), and
    // the FULL copy route - the one route that registers memory itself - registers it in THIS project's
    // .mcp.json at every scope (mcp.registrationScope). So `--memory-level project` is safe at every
    // CLI scope, and nothing here or in alfred-code.js refuses it.
    out.playwrightBrowsers = [];
    if (out.playwrightBrowsersRaw)
    {
        const want = lower(out.playwrightBrowsersRaw).split(',').map((s) => s.trim()).filter(Boolean);
        for (const engine of want)
            if (!PW_ENGINES.includes(engine))
                fail(`--browsers takes chrome, msedge, firefox, webkit (got '${engine}')`);
        out.playwrightBrowsers = PW_ENGINES.filter((e) => want.includes(e));
        // A value that names no engine at all (`,`) is a typo, never 'no flag'.
        if (!out.playwrightBrowsers.length)
            fail('--browsers needs at least one of chrome, msedge, firefox, webkit');
    }
    delete out.playwrightBrowsersRaw;

    // Which of the installed engines to ENABLE (R67): a csv, `all` or `none`. Absent is null - 'not
    // asked', which the run reads as every engine on for a fresh install and no flip on an update.
    out.playwrightEnabled = null;
    if (out.playwrightEnabledRaw)
    {
        const want = lower(out.playwrightEnabledRaw).split(',').map((s) => s.trim()).filter(Boolean);
        const word = want.filter((w) => w === 'all' || w === 'none');
        if (word.length && want.length > 1) fail('--browser-enabled takes all or none ALONE, never beside an engine');
        if (!want.length) fail('--browser-enabled needs all, none, or at least one of chrome, msedge, firefox, webkit');
        for (const engine of want)
            if (!word.length && !PW_ENGINES.includes(engine))
                fail(`--browser-enabled takes all, none, or chrome, msedge, firefox, webkit (got '${engine}')`);
        out.playwrightEnabled = word[0] === 'all' ? 'all' : PW_ENGINES.filter((e) => want.includes(e));
        // Beside an explicit install set it is checked here; without one, the run checks it against
        // the set it resolves, before anything is written.
        const outside = Array.isArray(out.playwrightEnabled) && out.playwrightBrowsers.length
            ? out.playwrightEnabled.filter((e) => !out.playwrightBrowsers.includes(e)) : [];
        if (outside.length)
            fail(`--browser-enabled names ${outside.join(',')}, which --browsers does not install (${out.playwrightBrowsers.join(',')}) - enable only an engine being installed`);
    }
    delete out.playwrightEnabledRaw;

    return out;
}

module.exports = { parseArgs, PW_ENGINES, FLAG_LIST, ENUMS };
