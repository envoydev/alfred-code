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
    scope: { values: ['project', 'global'], text: "--scope must be 'project' or 'global'" },
    docsVersioning: { values: ['', 'git', 'local'], text: "--docs-versioning must be 'git' or 'local'" },
    memoryLevel: { values: ['', 'global', 'scoped', 'project'], text: "--memory-level must be 'global', 'scoped' or 'project'" },
};

// ONE canonical order, so a server list never depends on how the flag was typed.
const PW_ENGINES = ['chrome', 'msedge', 'firefox', 'webkit'];

const VALUED = new Map([
    ['--space', 'space'], ['--scope', 'scope'],
    ['--playwright-browsers', 'playwrightBrowsersRaw'], ['--playwright-enabled', 'playwrightEnabled'],
    ['--docs-versioning', 'docsVersioning'], ['--memory-level', 'memoryLevel'],
    ['--selection', 'selection'], ['--source', 'source'], ['--plan-out', 'planOut'],
]);

const BOOLEAN = new Map([
    ['--github-cli', 'githubCli'], ['--keep-pins', 'keepPins'],
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

const FLAG_LIST = '--space, --scope, --memory-level, --playwright-browsers, --playwright-enabled, --docs-versioning, --github-cli, --keep-pins, --selection, --installed-only, --add, --drop, --print-plan, --plan-out, --skills-only, --source';

// One selection line, the shape the walks write: `<category> <name>`.
const ADD_LINE = /^(skill|agent|rule|hook|mcp|plugin) [A-Za-z0-9._-]+$/;

function fail(message)
{
    const err = new Error(message);
    err.usage = true;
    throw err;
}

const lower = (v) => String(v ?? '').toLowerCase();

function parseArgs(argv, env = {})
{
    const out = {
        action: '', space: '', scope: '',
        playwrightBrowsersRaw: '', playwrightEnabled: '', docsVersioning: '', memoryLevel: '',
        selection: '', source: '', planOut: '',
        githubCli: false, keepPins: false, installedOnly: false, printPlan: false, skillsOnly: false,
        add: [], drop: [],
    };

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
            out[VALUED.get(name)] = value;
            continue;
        }

        if (arg.startsWith('-')) fail(`unknown argument '${arg}' (named flags only: ${FLAG_LIST})`);
        if (out.action) fail(`unknown argument '${arg}' (named flags only: ${FLAG_LIST})`);
        out.action = arg;
    }

    if (!out.action) fail(`an action is required, positional: install or update (named flags: ${FLAG_LIST})`);
    if (!['install', 'update'].includes(out.action)) fail(`the action must be 'install' or 'update' (got '${out.action}')`);
    for (const flag of ['add', 'drop'])
        if (out[flag].length && !out.installedOnly) fail(`--${flag} needs --installed-only - a walk writes its picks into the --selection file`);
    if (out.planOut && !out.printPlan) fail('--plan-out needs --print-plan - it writes the inventory the plan prints');

    // --space is baked into a path (~/.claude-<space>, memory_<space>.db), so its characters are
    // checked here rather than discovered as a broken directory name later. Its CASING is
    // significant - it names a directory - which is why it is the one value not lower-cased.
    if (out.space && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(out.space))
        fail(`--space '${out.space}' must start alphanumeric; chars [A-Za-z0-9._-]`);

    // The flag wins, else the environment, else the default. The two enums are lower-cased so a
    // non-canonical casing like 'Global' is accepted the same as on the case-insensitive twin.
    out.scope = lower(out.scope || env.SCOPE || 'project');
    out.docsVersioning = lower(out.docsVersioning);
    out.memoryLevel = lower(out.memoryLevel);

    for (const [key, { values, text }] of Object.entries(ENUMS))
        if (!values.includes(out[key])) fail(`${text} (got '${out[key]}')`);

    // A global install registers ONE memory server for every project of the account, so its db
    // cannot live inside one repo: every other project would share that file, and it would go when
    // the repo goes.
    if (out.memoryLevel === 'project' && out.scope === 'global')
        fail('--memory-level project cannot be used with --scope global - a global install shares one db across every project of the account; pick global or scoped');

    out.playwrightBrowsers = [];
    if (out.playwrightBrowsersRaw)
    {
        const want = lower(out.playwrightBrowsersRaw).split(',').map((s) => s.trim()).filter(Boolean);
        for (const engine of want)
            if (!PW_ENGINES.includes(engine))
                fail(`--playwright-browsers takes chrome, msedge, firefox, webkit (got '${engine}')`);
        out.playwrightBrowsers = PW_ENGINES.filter((e) => want.includes(e));
        // A value that names no engine at all (`,`) is a typo, never 'no flag'.
        if (!out.playwrightBrowsers.length)
            fail('--playwright-browsers needs at least one of chrome, msedge, firefox, webkit');
    }
    delete out.playwrightBrowsersRaw;

    out.playwrightEnabled = lower(out.playwrightEnabled);
    if (out.playwrightEnabled)
    {
        if (!PW_ENGINES.includes(out.playwrightEnabled))
            fail(`--playwright-enabled takes chrome, msedge, firefox, webkit (got '${out.playwrightEnabled}')`);
        // Given ALONE it is legal - the engine is added to the set. Given beside an explicit set, it
        // has to be in it, or the run would print a switch-on line for a server it never registers.
        if (out.playwrightBrowsers.length && !out.playwrightBrowsers.includes(out.playwrightEnabled))
            fail(`--playwright-enabled must be one of the kept engines (${out.playwrightBrowsers.join(' ')}), got '${out.playwrightEnabled}'`);
    }

    return out;
}

module.exports = { parseArgs, PW_ENGINES, FLAG_LIST };
