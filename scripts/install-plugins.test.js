'use strict';
// THE PLUGIN LAYER OF THE NODE SEED - Phase 7, T3.
//
// The plugins ARE the delivery from Phase 3 onward, so these decisions are the install: which
// entries, at which scope, and what comes back out. The twin sandbox tests in mcp-verify.test.js
// keep proving the shell route, which still ships for one release (R1).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const P = require('./install/plugins.js');

// A recording CLI: every call is kept, and `fails` names the argv words that make one fail.
function cli(fails = [])
{
    const calls = [];
    const run = (argv) =>
    {
        calls.push(argv.join(' '));
        return !fails.some((f) => argv.join(' ').includes(f));
    };
    run.calls = calls;
    run.matching = (re) => calls.filter((c) => re.test(c));
    return run;
}

const ROUTES = (over = {}) => ({ hooks: true, skills: true, mcps: true, ...over });
const COPY = ROUTES({ hooks: false, skills: false, mcps: false });
const CORE_DEPS = ['superpowers@claude-plugins-official'];
const LOCKED = ['serena', 'context7', 'memory'];
const LOCKED_SPECS = LOCKED.map((n) => `${n}@envoydev`);

// --- the route switches ---------------------------------------------------

test('routes: every route defaults ON, and only the documented `false` turns one off', () =>
{
    assert.deepStrictEqual(P.pluginRoutes({}), { hooks: true, skills: true, mcps: true });
    assert.deepStrictEqual(P.pluginRoutes({ ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' }), { hooks: true, skills: true, mcps: false });
    assert.strictEqual(P.pluginRoutes({ ALFRED_CODE_HOOKS_VIA_PLUGIN: 'true' }).hooks, true);
});

test('routes: the core plugin is on while ANY route is - that is when its companions are installed', () =>
{
    assert.strictEqual(P.corePluginOn(ROUTES({ skills: false, mcps: false })), true);
    assert.strictEqual(P.corePluginOn(COPY), false);
});

// --- reading `claude plugin list --json` ----------------------------------

test('plugin-list: THIS project\'s row wins over the account row, and another project\'s is dropped', () =>
{
    const listing = P.parsePluginList(JSON.stringify({ installed: [
        { id: 'alfred-code@envoydev', version: '0.9.0', scope: 'user', enabled: true },
        { id: 'alfred-code@envoydev', version: '1.0.0', scope: 'project', enabled: true, projectPath: '/repo' },
        { id: 'other@x', version: '2.0.0', scope: 'project', enabled: true, projectPath: '/elsewhere' },
    ] }), '/repo');
    assert.deepStrictEqual(listing, [{ name: 'alfred-code', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true }]);
});

test('plugin-list: a marketplace filter runs BEFORE the per-name pick - a same-named foreign row never wins', () =>
{
    const json = JSON.stringify({ installed: [
        { id: 'serena@claude-plugins-official', version: '9', scope: 'project', enabled: true, projectPath: '/repo' },
        { id: 'serena@envoydev', version: '1', scope: 'user', enabled: true },
    ] });
    assert.deepStrictEqual(P.parsePluginList(json, '/repo', { marketplace: 'envoydev' }).map((r) => r.version), ['1']);
    assert.deepStrictEqual(P.parsePluginList(json, '/repo').map((r) => r.marketplace), ['claude-plugins-official']);
    // byMarketplace: one row per name@marketplace, so a pass over specs from BOTH reads each its own
    const both = P.parsePluginList(json, '/repo', { byMarketplace: true });
    assert.deepStrictEqual(both.map((r) => `${r.name}@${r.marketplace} ${r.version}`), ['serena@claude-plugins-official 9', 'serena@envoydev 1']);
    assert.strictEqual(P.fieldOf(both, 'serena@envoydev', 'version'), '1');
});

test('plugin-list: a missing `enabled` is enabled, and garbage is an EMPTY listing, never a crash', () =>
{
    assert.strictEqual(P.parsePluginList('[{"id":"a@m","version":"1"}]', '/repo')[0].enabled, true);
    assert.strictEqual(P.parsePluginList('{"installed":[{"id":"a@m","enabled":false}]}', '/repo')[0].enabled, false);
    assert.deepStrictEqual(P.parsePluginList('not json', '/repo'), []);
    assert.deepStrictEqual(P.parsePluginList('', '/repo'), []);
    assert.deepStrictEqual(P.parsePluginList('{"installed":[null,7,{"id":""}]}', '/repo'), []);
});

// --- the closure ----------------------------------------------------------

test('closure: the selection carries skill/agent lines only for the skills route, mcp lines only for the MCP route', () =>
{
    const skills = ['a|project-foo'];
    const agents = ['ng-implementer.md::sonnet'];
    const mcps = ['serena|x', 'sentry|@HTTP@'];
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES(), skills, agents, mcps, context7Mode: 'local' }),
        ['skill project-foo', 'agent ng-implementer', 'mcp serena', 'mcp sentry', 'mcp context7-local']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ mcps: false }), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ skills: false }), skills, agents, mcps }),
        ['mcp serena', 'mcp sentry']);
});

test('closure: a failure to compute it drops BOTH routes to copy, together and loudly', () =>
{
    // Half a closure would leave the project with neither the plugin's copy of an item nor its own.
    const logs = [];
    const out = P.resolveStackPlugins({
        routes: ROUTES(),
        runSelection: () => { throw new Error('selection-plugins.js is not in this source'); },
        log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out.routes, { hooks: true, skills: false, mcps: false });
    assert.deepStrictEqual(out.entries, []);
    assert.ok(logs.some((m) => /not in this source.*stay on the copy route/.test(m)), logs.join(' | '));
});

test('closure: the entries come back with the extras split into skills and agents', () =>
{
    const out = P.resolveStackPlugins({
        routes: ROUTES(),
        runSelection: () => ({ entries: ['alfred-code@envoydev', 'web-angular@envoydev', ''], copy: ['skill project-extra', 'agent lone-analyzer', 'noise'] }),
    });
    assert.deepStrictEqual(out.entries, ['alfred-code@envoydev', 'web-angular@envoydev']);
    assert.deepStrictEqual(out.extraSkills, ['project-extra']);
    assert.deepStrictEqual(out.extraAgents, ['lone-analyzer']);
});

test('closure: the full copy route asks for no closure at all', () =>
{
    const out = P.resolveStackPlugins({ routes: COPY, runSelection: () => assert.fail('the copy route computed a closure') });
    assert.deepStrictEqual(out.entries, []);
});

// --- the set, and the core's companions ------------------------------------

// The core declares no dependencies: `claude plugin update` over an older core installs none a
// release adds, and a plugin missing one is disabled at load, commands and all (measured on 2.1.280).
// So the run installs the companions itself, whatever else the set holds.
test('set: superpowers is installed on every run, a stack entry or not', () =>
{
    const third = ['claude-hud@claude-plugins-official'];
    const entries = ['alfred-code@envoydev', ...LOCKED_SPECS];
    assert.deepStrictEqual(
        P.pluginSet({ routes: ROUTES(), thirdParty: third, stackEntries: entries, coreDeps: CORE_DEPS, locked: LOCKED }),
        [...third, ...entries, ...CORE_DEPS],
        'the core leads, the selection names the locked three once, superpowers comes last');
    assert.deepStrictEqual(P.pluginSet({ routes: COPY, thirdParty: third, stackEntries: [], coreDeps: CORE_DEPS, locked: LOCKED }),
        [...third, ...CORE_DEPS], 'the full copy route registers the locked three instead of installing them');
});

test('set: with the MCP route off and the core on, the locked three are installed as plugins', () =>
{
    // The selection names no MCP plugin on that route, and nothing else would bring them in now.
    const set = P.pluginSet({ routes: ROUTES({ mcps: false }), stackEntries: ['alfred-code@envoydev'], coreDeps: CORE_DEPS, locked: LOCKED });
    assert.deepStrictEqual(set, ['alfred-code@envoydev', ...LOCKED_SPECS, ...CORE_DEPS]);
});

// 2.0.0 folds the hooks into the core ('Fold into core in 2.0.0'): no run installs a hooks entry, and
// the core carries the hooks whenever it is on - with the skills and MCP routes both on copy (or
// dropped there by a failed closure), the hooks route alone still puts the core in the set.
test('set: no hooks entry ever, and the hooks route alone brings the core', () =>
{
    for (const routes of [ROUTES(), ROUTES({ mcps: false }), ROUTES({ skills: false, mcps: false }), COPY])
    {
        const set = P.pluginSet({ routes, stackEntries: routes.skills || routes.mcps ? ['alfred-code@envoydev'] : [], coreDeps: CORE_DEPS, locked: LOCKED });
        assert.ok(!set.some((spec) => /-hooks@/.test(spec)), `no hooks entry: ${set.join(' ')}`);
    }
    const hooksOnly = P.pluginSet({ routes: ROUTES({ skills: false, mcps: false }), stackEntries: [], coreDeps: CORE_DEPS, locked: LOCKED, market: OLD });
    assert.deepStrictEqual(hooksOnly, [`alfred-code@${OLD}`, ...LOCKED.map((n) => `${n}@${OLD}`), ...CORE_DEPS], 'the core leads, spelled with the run\'s key');
});

// --- scope ----------------------------------------------------------------

test('scope: claude-hud is user scope whatever the run says, and the LISTING wins when it can speak', () =>
{
    assert.strictEqual(P.scopeFor('claude-hud@m', 'project', []), 'user');
    assert.strictEqual(P.scopeFor('alfred-code@envoydev', 'project', []), 'project');
    // `claude plugin update --scope <other>` is a silent no-op, so the plugin's OWN scope wins.
    assert.strictEqual(P.scopeFor('alfred-code@envoydev', 'project', [{ name: 'alfred-code', version: '1', scope: 'user', enabled: true }]), 'user');
});

test('marketplaces: a third-party source is registered only for a plugin this run installs', () =>
{
    const rows = [{ id: 'claude-hud@claude-hud', marketplace: 'jarrodwatts/claude-hud' }, { id: 'csharp-lsp@claude-plugins-official' }];
    assert.deepStrictEqual(P.extraMarketplaces(rows, ['claude-hud@claude-hud', 'csharp-lsp@claude-plugins-official']), ['jarrodwatts/claude-hud']);
    assert.deepStrictEqual(P.extraMarketplaces(rows, ['csharp-lsp@claude-plugins-official']), []);
    assert.deepStrictEqual(P.extraMarketplaces(undefined, ['claude-hud@claude-hud']), []);
});

// --- install --------------------------------------------------------------

test('install: the official marketplace is registered and refreshed BEFORE the first plugin install', () =>
{
    // Claude Code registers it only on its first INTERACTIVE launch, so an install before that
    // failed every official plugin with 'not found in marketplace'.
    const run = cli();
    P.installPlugins({ plugins: ['superpowers@claude-plugins-official'], scope: 'project', cli: run });
    const first = run.calls.findIndex((c) => /plugin install/.test(c));
    assert.ok(run.calls.slice(0, first).some((c) => c.includes(`marketplace add ${P.OFFICIAL_MARKETPLACE}`)), run.calls.join(' | '));
    assert.ok(run.calls.slice(0, first).some((c) => /marketplace update claude-plugins-official/.test(c)), run.calls.join(' | '));
});

test('install: every install carries -y and its own scope, and a failure is noted without aborting', () =>
{
    const run = cli(['plugin install bad@m']);
    const notes = [];
    P.installPlugins({ plugins: ['bad@m', 'claude-hud@m', 'good@m'], scope: 'project', cli: run, note: (m) => notes.push(m) });
    assert.deepStrictEqual(run.matching(/^plugin install/), [
        'plugin install bad@m --scope project -y',
        'plugin install claude-hud@m --scope user -y',
        'plugin install good@m --scope project -y',
    ]);
    assert.deepStrictEqual(notes, ['plugin bad@m failed']);
});

test('update: a stuck upgrade - the core on, its companions absent - installs each one, not one per run', () =>
{
    // What `claude plugin update` left behind on a real 0.2.87 -> 1.0.0 upgrade.
    const run = cli();
    const set = P.pluginSet({ routes: ROUTES(), stackEntries: ['alfred-code@envoydev', ...LOCKED_SPECS], coreDeps: CORE_DEPS, locked: LOCKED });
    P.updatePlugins({
        plugins: set, scope: 'project', cli: run, log: () => {},
        before: [{ name: 'alfred-code', version: '1.0.0', scope: 'user', enabled: true }],
        after: [],
    });
    assert.deepStrictEqual(run.matching(/^plugin install /).map((c) => c.split(' ')[2]), [...LOCKED_SPECS, ...CORE_DEPS]);
});

// --- latest ---------------------------------------------------------------
// `plugin install name@mp` refreshes its own marketplace, but an ALREADY-installed plugin is never
// moved by `install`, and `plugin update` reads the local catalog as it stands - so a run that does
// not refresh first calls a stale catalog 'latest' (code.claude.com/docs/en/discover-plugins,
// 'Install plugins'; third-party marketplaces have auto-update OFF by default).

test('install: every marketplace the run installs from is refreshed once, before its first install', () =>
{
    const run = cli();
    P.installPlugins({ plugins: ['a@m', 'b@m', 'alfred-code@envoydev', 'superpowers@claude-plugins-official'], scope: 'project', cli: run });
    const firstInstall = run.calls.findIndex((c) => /^plugin install /.test(c));
    for (const mp of ['m', 'envoydev', 'claude-plugins-official'])
    {
        const at = run.calls.indexOf(`plugin marketplace update ${mp}`);
        assert.ok(at >= 0 && at < firstInstall, `${mp} not refreshed before the installs: ${run.calls.join(' | ')}`);
        assert.strictEqual(run.matching(new RegExp(`^plugin marketplace update ${mp}$`)).length, 1, `${mp} refreshed more than once`);
    }
});

test('install: a plugin ALREADY installed is updated at its own scope; a fresh one is not', () =>
{
    const run = cli();
    const before = [{ name: 'old', version: '1.0.0', scope: 'user', enabled: true }];
    P.installPlugins({ plugins: ['old@m', 'new@m'], scope: 'project', before, cli: run });
    assert.deepStrictEqual(run.matching(/^plugin update /), ['plugin update old@m --scope user -y']);
    const inst = run.calls.indexOf('plugin install old@m --scope project -y');
    assert.ok(inst >= 0 && inst < run.calls.indexOf('plugin update old@m --scope user -y'), run.calls.join(' | '));
});

test('install: an official plugin of the same NAME is not the stack\'s - it neither triggers nor scopes the update', () =>
{
    // The official marketplace ships `serena`, `sentry` and `playwright`; a name-only read took
    // their row for ours, and an update at THEIR scope is a silent no-op on ours.
    const official = { name: 'serena', marketplace: 'claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true };
    const fresh = cli();
    P.installPlugins({ plugins: ['serena@envoydev'], scope: 'project', before: [official], cli: fresh });
    assert.deepStrictEqual(fresh.matching(/^plugin update /), [], 'the stack serena was not installed before - nothing to update');
    const both = cli();
    const ours = { name: 'serena', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true };
    P.installPlugins({ plugins: ['serena@envoydev'], scope: 'user', before: [official, ours], cli: both });
    assert.deepStrictEqual(both.matching(/^plugin update /), ['plugin update serena@envoydev --scope project -y']);
});

test('install: a marketplace this run already refreshed is not refreshed again', () =>
{
    const run = cli();
    P.installPlugins({ plugins: ['alfred-code@envoydev', 'a@m'], scope: 'project', cli: run, refreshed: new Set(['envoydev']) });
    assert.deepStrictEqual(run.matching(/^plugin marketplace update (envoydev|m)$/), ['plugin marketplace update m']);
});

test('update: every marketplace the specs name is refreshed before the first update', () =>
{
    const run = cli();
    const before = [{ name: 'live', version: '1.0.0', scope: 'project', enabled: true }];
    P.updatePlugins({ plugins: ['live@m', 'alfred-code@envoydev'], scope: 'project', before, after: before, cli: run });
    const firstUpdate = run.calls.findIndex((c) => /^plugin (install|update) /.test(c));
    for (const mp of ['m', 'envoydev'])
    {
        const at = run.calls.indexOf(`plugin marketplace update ${mp}`);
        assert.ok(at >= 0 && at < firstUpdate, `${mp}: ${run.calls.join(' | ')}`);
    }
});

test('source: EVERY installed stack entry is updated at its own scope before the snapshot is read', () =>
{
    // Not the core alone: the entry Claude Code launches is read from the refreshed catalog, so an
    // entry left on the older version can name a file that version's cache does not carry (the serena
    // launcher over a 1.1.0 cache) - and a run that stops at a question never reaches its apply step.
    const run = cli();
    const refreshed = new Set();
    P.refreshStackSource({
        listing: [
            { name: 'alfred-code', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: true },
            { name: 'serena', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
            { name: 'serena', marketplace: 'claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true },
            { name: 'alfred-code-hooks', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        ],
        cli: run, refreshed,
    });
    assert.deepStrictEqual(run.calls, [
        'plugin marketplace add envoydev/alfred-code',
        'plugin marketplace update envoydev',
        'plugin update alfred-code@envoydev --scope user -y',
        'plugin update serena@envoydev --scope project -y',
        'plugin update alfred-code-hooks@envoydev --scope project -y',
    ]);
    assert.ok(refreshed.has('envoydev'), 'the later passes must not refresh it again');
});

test('source: with no core installed there is nothing to update - the refresh alone runs', () =>
{
    const run = cli();
    P.refreshStackSource({ listing: [], cli: run });
    assert.deepStrictEqual(run.matching(/^plugin update /), []);
    assert.ok(run.calls.includes('plugin marketplace update envoydev'), run.calls.join(' | '));
});

// --- retired --------------------------------------------------------------

test('retired: a retired plugin is uninstalled at ITS OWN scope, and an absent one is nothing to do', () =>
{
    const run = cli();
    const logs = [];
    const listing = [{ name: 'ponytail', version: '0.3.0', scope: 'user', enabled: true }];
    const gone = P.prunedRetired({ listing, retired: ['ponytail', 'never-installed'], scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone, ['ponytail']);
    assert.deepStrictEqual(run.matching(/uninstall/), ['plugin uninstall ponytail --scope user -y']);
    assert.ok(logs.some((m) => /pruned \(retired upstream\) \[user\]: ponytail/.test(m)), logs.join(' | '));
});

// --- update ---------------------------------------------------------------

test('update: an ABSENT plugin is installed and a PARKED one enabled, both before the update call', () =>
{
    // `claude plugin update` is a no-op on a plugin that is not installed and says nothing about one
    // that is disabled - measured: two added plugins still `disabled` after the run.
    const run = cli();
    const before = [
        { name: 'parked', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'live', version: '1.0.0', scope: 'project', enabled: true },
    ];
    P.updatePlugins({ plugins: ['absent@m', 'parked@m', 'live@m'], scope: 'project', before, after: before, cli: run });
    assert.deepStrictEqual(run.matching(/^plugin (install|enable|update) /), [
        'plugin install absent@m --scope project -y',
        'plugin update absent@m --scope project -y',
        'plugin enable parked@m --scope project',
        'plugin update parked@m --scope project -y',
        'plugin update live@m --scope project -y',
    ]);
});

test('update: the version is READ BACK, and each outcome gets its own line', () =>
{
    const before = [
        { name: 'moved', version: '1.0.0', scope: 'user', enabled: true },
        { name: 'still', version: '2.0.0', scope: 'user', enabled: true },
        { name: 'parked', version: '1.0.0', scope: 'user', enabled: false },
    ];
    const after = [
        { name: 'moved', version: '1.1.0', scope: 'user', enabled: true },
        { name: 'still', version: '2.0.0', scope: 'user', enabled: true },
        { name: 'parked', version: '1.0.0', scope: 'user', enabled: false },
    ];
    const report = P.updatePlugins({ plugins: ['moved@m', 'still@m', 'parked@m', 'gone@m'], scope: 'user', before, after, cli: cli() });
    assert.match(report[0], /plugin moved: 1\.0\.0 -> 1\.1\.0/);
    assert.match(report[1], /plugin still: 2\.0\.0 \(already newest\)/);
    assert.match(report[2], /plugin parked: 1\.0\.0 but DISABLED/);
    assert.match(report[3], /plugin gone: NOT installed - the install above did not take/);
});

test('update: the listing is read AFTER the loop, never before it', () =>
{
    // `claude plugin update` reports success whether or not anything moved, so a report built from
    // the pre-loop listing would call every adopted plugin 'NOT installed'.
    let asked = 0;
    const report = P.updatePlugins({
        plugins: ['absent@m'], scope: 'project', before: [], cli: cli(),
        after: () => { asked += 1; return [{ name: 'absent', version: '1.0.0', scope: 'project', enabled: true }]; },
    });
    assert.strictEqual(asked, 1);
    assert.match(report[0], /plugin absent: 1\.0\.0 \(already newest\)/);
});

test('update: a third-party marketplace is registered before an absent plugin from it is installed', () =>
{
    const run = cli();
    P.updatePlugins({ plugins: ['claude-hud@claude-hud'], marketplaces: ['jarrodwatts/claude-hud'], scope: 'project', before: [], after: [], cli: run });
    const add = run.calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = run.calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(add >= 0 && inst > add, run.calls.join(' | '));
});

// --- the seed, end to end, against a recording CLI --------------------------------------------------
// The cases above prove what each function does with what it is HANDED; these prove the seed hands
// it. Measured on the 1.0.0 release check: the seed called installPlugins with no marketplaces, so a
// fresh account failed claude-hud with 'not found in marketplace' while every unit case stayed green.
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const HUD_SELECTION = 'skill markdown-style\nrule markdown-docs\nplugin claude-hud\n';

test('seed install: claude-hud\'s marketplace is registered before claude-hud is installed', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', HUD_SELECTION);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(inst >= 0, `claude-hud was never installed:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});

test('seed install: with no --source, the core is updated FIRST and the run installs from the newer cache', POSIX_ONLY, () =>
{
    // The stub's `plugin update alfred-code@envoydev` lands 9.9.9 beside the stale 0.0.1, exactly
    // what the real CLI does to the cache; a seed that resolved its snapshot first would use 0.0.1.
    // A cache entry is a real directory (the resolver skips a symlinked one); its children link to
    // this tree, so the run installs from the working copy without copying it.
    const entry = (work, ver) => path.join(work, 'acct', 'plugins', 'cache', 'envoydev', 'alfred-code', ver);
    const listing = JSON.stringify([{ id: 'alfred-code@envoydev', version: '0.0.1', scope: 'user', enabled: true }]);
    const { calls, out } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        source: null,
        plugins: listing,
        // A regression must fail here, never fall back to cloning the real repository.
        env: { ALFRED_CODE_REPO_URL: 'file:///nonexistent/alfred-code' },
        prepare: (repo, work) =>
        {
            fs.mkdirSync(entry(work, '0.0.1'), { recursive: true });
            for (const name of ['stack', 'meta', 'scripts', 'setup-plugin', '.claude-plugin'])
                fs.symlinkSync(path.join(ROOT, name), path.join(entry(work, '0.0.1'), name));
        },
        tools: {
            claude: [
                'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
                'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
                // Once only: a second `ln -s` onto an existing link would plant the link INSIDE this tree.
                'if [ "$1 $2 $3" = "plugin update alfred-code@envoydev" ] && [ ! -d "$CLAUDE_CONFIG_DIR/plugins/cache/envoydev/alfred-code/9.9.9" ]; then',
                '  new="$CLAUDE_CONFIG_DIR/plugins/cache/envoydev/alfred-code/9.9.9"; mkdir -p "$new"',
                `  for n in stack meta scripts setup-plugin .claude-plugin; do ln -s ${JSON.stringify(ROOT)}/$n "$new/$n"; done`,
                'fi',
                'exit 0',
            ].join('\n'),
        },
    });
    const update = calls.indexOf('plugin update alfred-code@envoydev --scope user -y');
    assert.ok(update >= 0, `the core was never updated:\n${calls.join('\n')}`);
    assert.match(out, /source: plugin cache \S*9\.9\.9/, 'the run read the stale cache entry, not the one the update landed');
});

test('seed plan: --print-plan with no --source changes no plugin - it reads the cache as it stands', POSIX_ONLY, () =>
{
    const entry = (work) => path.join(work, 'acct', 'plugins', 'cache', 'envoydev', 'alfred-code', '0.0.1');
    const { calls } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        source: null,
        args: ['--print-plan'],
        plugins: JSON.stringify([{ id: 'alfred-code@envoydev', version: '0.0.1', scope: 'user', enabled: true }]),
        env: { ALFRED_CODE_REPO_URL: 'file:///nonexistent/alfred-code' },
        prepare: (repo, work) =>
        {
            fs.mkdirSync(entry(work), { recursive: true });
            for (const name of ['stack', 'meta', 'scripts', 'setup-plugin', '.claude-plugin'])
                fs.symlinkSync(path.join(ROOT, name), path.join(entry(work), name));
        },
    });
    assert.deepStrictEqual(calls.filter((c) => /^plugin (update|install|enable|marketplace (add|update)) /.test(c)), [], calls.join('\n'));
});

test('seed install: a run that installs no claude-hud registers no marketplace for it', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n');
    assert.ok(!calls.some((c) => /marketplace add jarrodwatts\/claude-hud/.test(c)), calls.join('\n'));
});

test('seed update: an absent claude-hud gets its marketplace before the install', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', HUD_SELECTION);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(inst >= 0, `claude-hud was never installed:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});

// A retired per-stack entry is the migration's only record of the user's off-state and of other
// projects' picks: a PARKED one keeps its items out for as long as it stays installed, and one at
// ANOTHER scope is every other project's too. Both stay; the run says how to remove them by hand.
test('prunedRetired keeps a parked carrier and one at another scope, and says so', () =>
{
    const calls = [];
    const logs = [];
    const listing = [
        { name: 'claude-stack-angular', version: '1.2.0', scope: 'project', enabled: false },
        { name: 'claude-stack-aspnet', version: '1.2.0', scope: 'user', enabled: true },
        { name: 'claude-stack-web-angular', version: '1.2.0', scope: 'project', enabled: true },
        { name: 'ponytail', version: '1.0.0', scope: 'user', enabled: false },
    ];
    const carriers = ['claude-stack-angular', 'claude-stack-aspnet', 'claude-stack-web-angular'];
    const gone = P.prunedRetired({ listing, retired: [...carriers, 'ponytail'], carriers, scope: 'project', cli: (a) => { calls.push(a.join(' ')); return true; }, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone.sort(), ['claude-stack-web-angular', 'ponytail'], 'an ordinary retired name still goes at its own scope');
    assert.ok(!calls.some((c) => /claude-stack-angular |claude-stack-aspnet /.test(c)), calls.join(' | '));
    assert.ok(logs.some((m) => /claude-stack-angular is parked here - kept/.test(m) && /claude plugin uninstall claude-stack-angular --scope project/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /claude-stack-aspnet is installed at user scope/.test(m) && /claude plugin uninstall claude-stack-aspnet --scope user/.test(m)), logs.join(' | '));
});

test('prunedRetired retries a refused uninstall in a second pass', () =>
{
    const calls = [];
    const listing = [{ name: 'claude-stack-web-angular', version: '1.2.0', scope: 'project' }, { name: 'claude-stack-angular', version: '1.2.0', scope: 'project' }];
    let leafGone = false;
    const cli = (args) => { calls.push(args[2]); if (args[2] === 'claude-stack-web-angular') { leafGone = true; return true; } return leafGone; };
    const gone = P.prunedRetired({ listing, retired: ['claude-stack-angular', 'claude-stack-web-angular'], scope: 'project', cli });
    assert.deepStrictEqual(gone.sort(), ['claude-stack-angular', 'claude-stack-web-angular']);
    assert.deepStrictEqual(calls, ['claude-stack-angular', 'claude-stack-web-angular', 'claude-stack-angular'], 'the refusal is retried once, after the leaf');
});

// --- 2.0.0: a 1.x account keeps its marketplace KEY and its ids ---------------------------------------
// A registered marketplace's key never changes, so a 1.x install's stack stays under `claude-stack`, // legacy-name
// and a forced move (`marketplace remove`) would uninstall it from every project on the machine. The
// seed reads the key from the listing (the key whose core is installed, under either name) and spells
// every stack spec with it. 2.0.0 ships no rename: the two 1.x ids stay listed as RETIRED aliases
// (docs/rebrand-evidence.md S20-S22), so every row is updated by its own id, and the old core row is a
// DIFFERENT plugin from the new one - `update` over the new id fails `not_installed` (S19).
const OLD = 'claude-stack'; // legacy-name
const OLD_HOOKS = `${OLD}-hooks`;
const row1x = (name, scope, extra = {}) => ({ name, marketplace: OLD, version: '1.3.0', scope, enabled: true, ...extra });
const NEW_CORE = (scope, extra = {}) => ({ name: 'alfred-code', marketplace: OLD, version: '2.0.0', scope, enabled: true, ...extra });

test('plugin-list: a 1.x row is its own plugin - no rename note is read, and the new core never matches the old id', () =>
{
    const note = [{ type: 'plugin-renamed', plugin: OLD, marketplace: OLD, related: 'alfred-code' }];
    const listing = P.parsePluginList(JSON.stringify([{ id: `${OLD}@${OLD}`, version: '1.3.0', scope: 'user', noteDetails: note }]), '/repo', { byMarketplace: true });
    assert.deepStrictEqual(listing, [row1x(OLD, 'user')], 'the row carries no `renamed` field');
    assert.strictEqual(P.fieldOf(listing, `alfred-code@${OLD}`, 'version'), undefined, 'the old core row is not the new core');
    assert.strictEqual(P.fieldOf(listing, 'alfred-code', 'version'), undefined, 'not by the bare name either');
    assert.strictEqual(P.fieldOf([row1x(OLD_HOOKS, 'user')], `alfred-code@${OLD}`, 'version'), undefined, 'nor the hooks alias the new core');
    assert.strictEqual(P.fieldOf(listing, `${OLD}@${OLD}`, 'version'), '1.3.0', 'the old id still finds its own row');
});

test('plugin-list: everyScope keeps one row per name@marketplace@scope, so a core at two scopes is two rows', () =>
{
    const rows = P.parsePluginList(JSON.stringify([
        { id: `${OLD}@${OLD}`, version: '1.3.0', scope: 'user' },
        { id: `${OLD}@${OLD}`, version: '1.3.0', scope: 'project', projectPath: '/repo' },
        { id: `${OLD}@${OLD}`, version: '1.3.0', scope: 'project', projectPath: '/other' },
    ]), '/repo', { everyScope: true });
    assert.deepStrictEqual(rows.map((r) => r.scope).sort(), ['project', 'user'], 'another project\'s row is still dropped');
});

test('source: a 1.x account - the old key is refreshed and every row updated by its OWN id', () =>
{
    const run = cli();
    const listing = [row1x(OLD, 'user'), row1x(OLD_HOOKS, 'project'), row1x('serena', 'project')];
    const key = P.refreshStackSource({ listing, cli: run });
    assert.strictEqual(key, OLD);
    assert.deepStrictEqual(run.calls, [
        `plugin marketplace update ${OLD}`,
        `plugin update ${OLD}@${OLD} --scope user -y`,
        `plugin update ${OLD_HOOKS}@${OLD} --scope project -y`,
        `plugin update serena@${OLD} --scope project -y`,
    ], 'no second registration of the new slug, and no new id - the retired alias lands 2.0.0 under the old name (S21)');
});

test('source: a fresh account registers the stack and takes the key the add produced', () =>
{
    const run = cli();
    const key = P.refreshStackSource({ listing: [], marketplaces: [], readMarketplaces: () => [{ name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }], cli: run });
    assert.strictEqual(key, 'envoydev');
    assert.deepStrictEqual(run.calls, ['plugin marketplace add envoydev/alfred-code', 'plugin marketplace update envoydev']);
});

test('source: both keys registered - the one carrying the installed core is used, the other left alone', () =>
{
    const run = cli();
    const marketplaces = [{ name: OLD, source: 'github', repo: `envoydev/${OLD}` }, { name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }];
    const key = P.refreshStackSource({ listing: [NEW_CORE('user')], marketplaces, cli: run });
    assert.strictEqual(key, OLD);
    assert.ok(!run.calls.some((c) => / envoydev(\/|$)/.test(c)), run.calls.join(' | '));
});

test('set: the locked servers ride the run\'s marketplace key', () =>
{
    const set = P.pluginSet({ routes: ROUTES({ mcps: false }), stackEntries: [`alfred-code@${OLD}`], coreDeps: CORE_DEPS, locked: LOCKED, market: OLD });
    assert.deepStrictEqual(set, [`alfred-code@${OLD}`, ...LOCKED.map((n) => `${n}@${OLD}`), ...CORE_DEPS]);
});

// --- 2.0.0: the migration (ruling R24) ------------------------------------------------------------------
// The new core is INSTALLED at the old core's scope and key - never `update`d, it was never installed
// under any name (S19) - and only once that took, the retired per-stack entries go (leaves first), then
// the hooks alias, then the core alias (S22). A failed install removes nothing: the old core is the one
// thing still carrying the guards.
const LEAVES = [`${OLD}-web-angular`, `${OLD}-angular`];
function migrate(rows, { scope = 'project', fails = [], carriers = LEAVES } = {})
{
    const run = cli(fails);
    const logs = [];
    const notes = [];
    const out = P.migrateLegacy({ rows, listing: rows, scope, retired: carriers, carriers, cli: run, log: (m) => logs.push(m), note: (m) => notes.push(m) });
    return { out, run, logs, notes, moves: run.matching(/^plugin (install|uninstall|update|enable) /) };
}

test('migrate: a 1.x core at this scope - the new core is installed FIRST, then the leaves, the hooks alias and the core alias go', () =>
{
    const { out, moves } = migrate([row1x(OLD, 'project'), row1x(OLD_HOOKS, 'project'), row1x(`${OLD}-angular`, 'project'), row1x(`${OLD}-web-angular`, 'project')]);
    assert.deepStrictEqual(moves, [
        `plugin install alfred-code@${OLD} --scope project -y`,
        `plugin uninstall ${OLD}-web-angular --scope project -y`,
        `plugin uninstall ${OLD}-angular --scope project -y`,
        `plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`,
        `plugin uninstall ${OLD}@${OLD} --scope project -y`,
    ]);
    assert.deepStrictEqual(out.fresh, [`alfred-code@${OLD}`], 'the install outcome is what counts it enabled');
    assert.deepStrictEqual(out.gone, LEAVES);
});

test('migrate: the new core takes the OLD ROW\'s key - a user-scope run moves the user-scope core', () =>
{
    const { moves } = migrate([{ ...row1x(OLD, 'user'), marketplace: 'envoydev' }, row1x(OLD, 'project')], { scope: 'user', carriers: [] });
    assert.deepStrictEqual(moves, [
        'plugin install alfred-code@envoydev --scope user -y',
        `plugin uninstall ${OLD}@envoydev --scope user -y`,
    ], 'the project-scope row belongs to that project\'s own run');
});

test('migrate: a 1.x core at ANOTHER scope is kept and logged with its uninstall command - nothing installed', () =>
{
    const { out, moves, logs } = migrate([row1x(OLD, 'user'), row1x(OLD_HOOKS, 'user')]);
    assert.deepStrictEqual(moves, []);
    assert.deepStrictEqual(out.fresh, []);
    assert.ok(logs.some((m) => /installed at user scope/.test(m) && m.includes(`claude plugin uninstall ${OLD}@${OLD} --scope user`)), logs.join(' | '));
});

test('migrate: a moved project still names the 1.x core another scope carries', () =>
{
    const { moves, logs } = migrate([row1x(OLD, 'project'), row1x(OLD, 'user')], { carriers: [] });
    assert.deepStrictEqual(moves, [`plugin install alfred-code@${OLD} --scope project -y`, `plugin uninstall ${OLD}@${OLD} --scope project -y`]);
    assert.ok(logs.some((m) => m.includes(`claude plugin uninstall ${OLD}@${OLD} --scope user`)), logs.join(' | '));
});

test('migrate: the old and the new core both at this scope - no install, and the removals an earlier run left are retried in order', () =>
{
    // An earlier move installed the new core, but an uninstall did not take (refused, or cut short):
    // the next run finishes it rather than leaving both cores' hooks running.
    const { out, moves } = migrate([NEW_CORE('project'), row1x(OLD, 'project'), row1x(OLD_HOOKS, 'project'), row1x(`${OLD}-angular`, 'project')]);
    assert.deepStrictEqual(moves, [
        `plugin uninstall ${OLD}-angular --scope project -y`,
        `plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`,
        `plugin uninstall ${OLD}@${OLD} --scope project -y`,
    ]);
    assert.deepStrictEqual(out.fresh, [], 'nothing was installed this run');
    assert.strictEqual(out.ran, true, 'the retired pass ran here - the caller runs no second one');
    assert.deepStrictEqual(migrate([NEW_CORE('project'), row1x(OLD_HOOKS, 'project')], { carriers: [] }).moves,
        [`plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`], 'a hooks alias left alone is retried too');
});

test('migrate: no old row left at this scope - nothing to move', () =>
{
    for (const rows of [[NEW_CORE('project')], [], [NEW_CORE('project'), row1x(OLD, 'user'), row1x(OLD_HOOKS, 'user')]])
    {
        const { out, moves } = migrate(rows);
        assert.deepStrictEqual(moves, [], JSON.stringify(rows));
        assert.deepStrictEqual(out.fresh, []);
        assert.strictEqual(out.ran, false);
    }
    // The new core at ANOTHER scope does not cover this one.
    assert.deepStrictEqual(migrate([row1x(OLD, 'project'), NEW_CORE('user')], { carriers: [] }).moves[0], `plugin install alfred-code@${OLD} --scope project -y`);
});

test('migrate: a failed install removes NOTHING and names the exact install command', () =>
{
    const { out, moves, notes } = migrate([row1x(OLD, 'project'), row1x(OLD_HOOKS, 'project'), row1x(`${OLD}-angular`, 'project')], { fails: ['plugin install alfred-code'] });
    assert.deepStrictEqual(moves, [`plugin install alfred-code@${OLD} --scope project -y`]);
    assert.deepStrictEqual(out.fresh, []);
    assert.strictEqual(out.failed, `alfred-code@${OLD}`);
    assert.ok(notes.some((m) => m.includes(`claude plugin install alfred-code@${OLD} --scope project -y`)), notes.join(' | '));
});

test('update: a plugin this run installed is not installed, enabled or updated again, and a stale flag never reads it parked (S22)', () =>
{
    const run = cli();
    const after = [NEW_CORE('project', { enabled: false })];
    const report = P.updatePlugins({ plugins: [`alfred-code@${OLD}`], scope: 'project', before: [], after, fresh: [`alfred-code@${OLD}`], cli: run });
    assert.deepStrictEqual(run.matching(/^plugin (install|enable|update) /), []);
    assert.ok(!/DISABLED|NOT installed/.test(report[0]), report[0]);
    assert.match(report[0], /plugin alfred-code: 2\.0\.0 \(installed this run\)/);
});

test('update: the core is locked on - a stale disabled flag runs no enable and reads no DISABLED (S22)', () =>
{
    const run = cli();
    const rows = [NEW_CORE('project', { enabled: false }), { name: 'serena', marketplace: OLD, version: '1.0.0', scope: 'project', enabled: false }];
    const specs = ['alfred-code', 'serena'].map((n) => `${n}@${OLD}`);
    const report = P.updatePlugins({ plugins: specs, scope: 'project', before: rows, after: rows, cli: run });
    assert.deepStrictEqual(run.matching(/^plugin enable /), [`plugin enable serena@${OLD} --scope project`], 'a parked ordinary entry is still enabled');
    assert.match(report[0], /plugin alfred-code: 2\.0\.0 \(already newest\)/);
    assert.match(report[1], /plugin serena: 1\.0\.0 but DISABLED/);
});

test('install: a plugin this run installed is not installed again', () =>
{
    const run = cli();
    P.installPlugins({ plugins: [`alfred-code@${OLD}`, `serena@${OLD}`], scope: 'project', fresh: [`alfred-code@${OLD}`], cli: run });
    assert.deepStrictEqual(run.matching(/^plugin install /), [`plugin install serena@${OLD} --scope project -y`]);
});

// The seed end to end: a 1.x project listing drives the install and the removals in order.
const LISTING_1X = JSON.stringify([OLD, OLD_HOOKS, `${OLD}-web-angular`, `${OLD}-angular`].map((n) => ({ id: `${n}@${OLD}`, version: '1.3.0', scope: 'project', enabled: true })));
const stackMoves = (calls) => calls.filter((c) => /^plugin (install|uninstall|update|enable) /.test(c) && (c.includes(OLD) || / alfred-code/.test(c)));

test('seed update: a 1.x project install is moved across - alfred-code installed under the old key, then the old ids removed, leaves first', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: LISTING_1X });
    const at = (c) => calls.indexOf(c);
    const install = at(`plugin install alfred-code@${OLD} --scope project -y`);
    const order = [
        install,
        at(`plugin uninstall ${OLD}-web-angular --scope project -y`),
        at(`plugin uninstall ${OLD}-angular --scope project -y`),
        at(`plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`),
        at(`plugin uninstall ${OLD}@${OLD} --scope project -y`),
    ];
    assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `out of order:\n${stackMoves(calls).join('\n')}`);
    assert.ok(!calls.some((c) => c.startsWith(`plugin update alfred-code@${OLD}`)), 'the new core is installed, never updated (S19)');
    assert.strictEqual(calls.filter((c) => c.startsWith('plugin install alfred-code@')).length, 1, 'installed once');
    const specs = calls.filter((c) => /^plugin (install|update|enable) /.test(c)).map((c) => c.split(' ')[2]);
    assert.ok(!specs.some((s) => /^(alfred-code|serena|context7|memory)(-hooks)?@envoydev$/.test(s)), `a stack spec under the new key:\n${specs.join('\n')}`);
    assert.ok(!calls.includes('plugin marketplace add envoydev/alfred-code'), calls.join('\n'));
});

test('seed update: the moved core is counted enabled from its install - the listing\'s stale project-scope flag is never read (S22)', POSIX_ONLY, () =>
{
    const after = JSON.stringify([{ id: `alfred-code@${OLD}`, version: '2.0.0', scope: 'project', enabled: false }]);
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: LISTING_1X,
        tools: {
            claude: [
                'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
                `if [ "$1 $2 $3" = "plugin install alfred-code@${OLD}" ]; then printf '%s' '${after}' > "$CLAUDE_STUB_PLUGINS"; fi`,
                'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
                'exit 0',
            ].join('\n'),
        },
    });
    assert.ok(calls.includes(`plugin install alfred-code@${OLD} --scope project -y`), calls.join('\n'));
    assert.ok(!calls.some((c) => c.startsWith(`plugin enable alfred-code@${OLD}`)), `the fresh install was read back as parked:\n${stackMoves(calls).join('\n')}`);
    assert.ok(!/plugin alfred-code: .*DISABLED/.test(out), out);
    assert.match(out, /plugin alfred-code: 2\.0\.0 \(installed this run\)/);
});

test('seed update: a failed install of the new core removes nothing and prints the command to run', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: LISTING_1X,
        tools: {
            claude: [
                'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
                'if [ "$1 $2" = "plugin install" ] && [ "${3%%@*}" = "alfred-code" ]; then exit 1; fi',
                'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
                'exit 0',
            ].join('\n'),
        },
    });
    assert.deepStrictEqual(calls.filter((c) => c.startsWith('plugin uninstall ')), [], 'nothing is removed while the old core carries the guards');
    assert.strictEqual(calls.filter((c) => c.startsWith('plugin install alfred-code@')).length, 1, 'no second attempt beside the old core');
    assert.ok(out.includes(`claude plugin install alfred-code@${OLD} --scope project -y`), out);
});

test('seed update: a project holding the new core AND a 1.x id retries the removals and installs nothing', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([`alfred-code@${OLD}`, `${OLD}@${OLD}`, `${OLD}-angular@${OLD}`].map((id) => ({ id, version: '2.0.0', scope: 'project', enabled: true })));
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: listing });
    assert.ok(!calls.some((c) => c.startsWith('plugin install alfred-code@')), `the core was installed again:\n${stackMoves(calls).join('\n')}`);
    const leaf = calls.indexOf(`plugin uninstall ${OLD}-angular --scope project -y`);
    const core = calls.indexOf(`plugin uninstall ${OLD}@${OLD} --scope project -y`);
    assert.ok(leaf >= 0 && core > leaf, stackMoves(calls).join('\n'));
    assert.strictEqual(calls.filter((c) => c === `plugin uninstall ${OLD}-angular --scope project -y`).length, 1, 'one retired pass, not two');
    assert.ok(calls.includes(`plugin update alfred-code@${OLD} --scope project -y`), 'the installed core is updated as usual');
});

test('seed plan --installed-only: a stale disabled flag on the core leaves out no core item and shows no DISABLED core (S22)', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory']
        .map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: !n.startsWith('alfred-code') })));
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] } }));
    };
    const { result } = seedRun('update', 'skill markdown-style\n', {
        plugins: listing, prepare, args: ['--installed-only', '--print-plan', '--plan-out', 'plan.json'],
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, 'plan.json'), 'utf8')),
    });
    assert.deepStrictEqual(result.left_out, ['agent code-style-analyzer'], 'only the denied seat - no core item for the flag');
    assert.ok(!result.plugins_disabled.some((n) => n.startsWith('alfred-code')), result.plugins_disabled.join(','));
    assert.ok(result.skills.includes('markdown-style'), result.skills.join(','));
});

test('seed plan: --print-plan lists the move as planned and changes no plugin', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: LISTING_1X, args: ['--print-plan'] });
    assert.deepStrictEqual(calls.filter((c) => /^plugin (install|uninstall|update|enable) /.test(c)), [], calls.join('\n'));
    const planned = out.split('\n').filter((l) => l.startsWith('plan migrate: '));
    assert.deepStrictEqual(planned, [
        `plan migrate: claude plugin install alfred-code@${OLD} --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD}-web-angular --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD}-angular --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD}@${OLD} --scope project -y`,
    ], out);
});

// The configure / validate read-back on a 1.x install: `--installed-only` under the key the stack was
// registered with, a 1.x stamp whose picks are homed in the 1.x core, a 1.x seat deny and a 1.x
// switch-off. The read-back must be the same install - the picks rehomed, the deny in one spelling,
// the hooks the user switched off still off - or the first 2.0.0 update turns them back on.
test('seed update --installed-only: a 1.x install under its old key keeps its picks, its deny and its hooks-off', POSIX_ONLY, () =>
{
    const row = (id) => ({ id, version: '2.0.0', scope: 'user', enabled: true });
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => row(`${n}@${OLD}`)));
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'claude-stack.stamp'), // legacy-name
            `version: 1.3.0\nsha: 0000000\npicked-skills: markdown-style@${OLD}\npicked-agents: security-auditor@${OLD}\n`);
        fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
            permissions: { deny: [`Agent(${OLD}:code-style-analyzer)`] },
            env: { CLAUDE_STACK_HOOKS_OFF: 'guard-answer-length' }, // legacy-name
        }, null, 2));
    };
    const { result, out } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only'], prepare,
        inspect: (repo) =>
        {
            const claude = path.join(repo, '.claude');
            const stamp = fs.existsSync(path.join(claude, 'alfred-code.stamp')) ? fs.readFileSync(path.join(claude, 'alfred-code.stamp'), 'utf8') : '';
            const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
            return {
                picks: [(/^picked-skills: (.*)$/m.exec(stamp) || [])[1], (/^picked-agents: (.*)$/m.exec(stamp) || [])[1]],
                oldStamp: fs.existsSync(path.join(claude, 'claude-stack.stamp')), // legacy-name
                deny: settings.permissions.deny.filter((d) => d.includes('code-style-analyzer')),
                env: settings.env,
            };
        } });
    assert.ok(/marketplace: claude-stack/.test(out), out); // legacy-name
    assert.ok(result.picks[0] && result.picks[0].split(',').includes('markdown-style@alfred-code'), `skills: ${result.picks[0]}`);
    assert.ok(result.picks[1] && result.picks[1].split(',').includes('security-auditor@alfred-code'), `agents: ${result.picks[1]}`);
    assert.strictEqual(result.oldStamp, false, 'the 1.x stamp is left beside the new one');
    assert.deepStrictEqual(result.deny, ['Agent(alfred-code:code-style-analyzer)'], 'the deny in one spelling');
    assert.strictEqual(result.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-length', 'the hooks the user switched off stay off');
    assert.ok(!('CLAUDE_STACK_HOOKS_OFF' in result.env), 'the 1.x key is renamed, not left beside the new one'); // legacy-name
});

// Review M3: a hooks-copy-route install made before the hooks rode the core never wrote
// ALFRED_CODE_HOOKS_OFF - absence on disk was the off-state. Once the core carries every hook, the
// first update must name each hook the project does not wire, and a None must not come back.
test('seed update --installed-only: a pre-11b hooks-copy-route install - its picks stay wired, the rest are named off, a None holds', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    // `off`: a plugin-route install flipped to the copies - no prelude, no hook on disk, the off-state
    // in ALFRED_CODE_HOOKS_OFF. `route`: the stamp's `hooks-route:` line, which a pre-11b stamp lacks.
    const layout = (kept, off, route) => (repo) =>
    {
        const claude = path.join(repo, '.claude');
        fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
        fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(claude, 'rules', 'baseline-interaction.md'), 'x\n');
        for (const f of [...(off ? [] : ['hook-prelude']), ...kept]) fs.writeFileSync(path.join(claude, 'hooks', `${f}.js`), '// x\n');
        fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), `version: 1.3.0\nsha: 0000000\nshipped-hooks: ${shipped.join(',')}\n${route ? `hooks-route: ${route}\n` : ''}`);
        fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({
            hooks: { PreToolUse: kept.map((h) => ({ matcher: 'Bash', hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${h}.js"`, timeout: 10 }] })) },
            env: { ALFRED_CODE_HOOKS_OFF: (off || []).join(',') },
        }, null, 2));
    };
    const inspect = (repo) => ({
        onDisk: fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort(),
        off: String(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).env.ALFRED_CODE_HOOKS_OFF).split(',').filter(Boolean).sort(),
    });
    const run = (kept, off, route) => seedRun('update', 'skill markdown-style\n', { env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, plugins: listing, args: ['--installed-only'], prepare: layout(kept, off, route), inspect }).result;
    const kept = ['guard-protected-force-push', 'guard-secret-value'];
    const two = run(kept);
    assert.deepStrictEqual(two.onDisk, kept.map((h) => `${h}.js`), 'the picked hooks stay copied');
    assert.deepStrictEqual(two.off, shipped.filter((h) => !kept.includes(h)).sort(), 'every hook the project does not wire is named off');
    const none = run([], undefined, 'copy');
    assert.deepStrictEqual(none.onDisk, [], 'the None holds: nothing is copied back');
    assert.deepStrictEqual(none.off, [...shipped].sort(), 'and the core keeps every hook quiet');
    const noneOwn = run(['my-hook'], undefined, 'copy');
    assert.deepStrictEqual(noneOwn.onDisk, [], 'the None holds beside the user\'s own hook file too');
    assert.deepStrictEqual(noneOwn.off, [...shipped].sort());
    // Ruling R55: without the stamp's route the None cannot be told from a plugin-route leftover, and
    // every guard silent is the worse mistake - a pre-11b None comes back as every hook.
    const unknown = run([]);
    assert.deepStrictEqual(unknown.onDisk, shipped.map((h) => `${h}.js`).sort(), 'no hooks-route line: every hook is copied');
    assert.deepStrictEqual(unknown.off, [], 'and none is named off');
    const flip = run([], kept);
    assert.deepStrictEqual(flip.onDisk, shipped.filter((h) => !kept.includes(h)).map((h) => `${h}.js`).sort(), 'a flip copies the hooks the plugin route ran');
    assert.deepStrictEqual(flip.off, [...kept].sort(), 'and keeps the ones it had named off');
});

// Re-review N1: the copy route's own modules (hook-prelude.js, fresh-session.js) are no catalog hook,
// so a plugin-route stint that pruned only the catalog left them behind - and the next copy-route run
// read that leftover prelude as the copy route's own None, switching every hook off. The plugin route
// removes them with the hooks, so copy -> plugin -> copy comes back with the plugin route's answer.
test('seed: copy -> plugin -> copy hands the plugin route\'s hooks back, never a None', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const copies = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' };
    const MODULES = ['hook-prelude.js', 'fresh-session.js'];
    const read = (repo) => ({
        files: fs.readdirSync(path.join(repo, '.claude', 'hooks')),
        off: String(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).env.ALFRED_CODE_HOOKS_OFF || '').split(',').filter(Boolean).sort(),
    });
    const trip = (selection, prepare) => seedRun(['install', 'update', 'update'], selection, {
        plugins: listing, env: [copies, {}, copies], args: [[], ['--installed-only'], ['--installed-only']], each: read, prepare });
    // The user's own hook file beside the stack's is read back as a `hook` line too - no evidence of
    // what the STACK kept, so it must not turn the flip into 'every stack hook was dropped'.
    const ownHook = (repo) => { fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'my-hook.js'), '// mine\n'); };
    const hooksIn = (step) => step.files.filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort();

    const kept = ['guard-protected-force-push', 'guard-secret-value'];
    const two = trip(`skill markdown-style\n${kept.map((h) => `hook ${h}`).join('\n')}\n`);
    assert.ok(MODULES.every((m) => two.steps[0].files.includes(m)), 'the copy route copies its modules');
    assert.deepStrictEqual(two.steps[1].files.filter((f) => MODULES.includes(f) || shipped.includes(f.replace(/\.js$/, ''))), [],
        'the plugin route leaves no copied hook and no copy-route module behind');
    assert.deepStrictEqual(hooksIn(two.steps[2]), kept.map((h) => `${h}.js`), 'back on the copies: the two hooks the plugin route ran');
    assert.deepStrictEqual(two.steps[2].off, shipped.filter((h) => !kept.includes(h)).sort(), 'and the rest stay named off');

    const all = trip('skill markdown-style\n');
    assert.deepStrictEqual(hooksIn(all.steps[2]), shipped.map((h) => `${h}.js`).sort(), 'every hook the plugin route ran is copied back');
    assert.deepStrictEqual(all.steps[2].off, [], 'and none is named off');

    // A real copy-route None holds across an update, and across a plugin-route stint too - there the
    // core carries it as every hook named off.
    for (const [actions, env] of [[['install', 'update'], [copies, copies]], [['install', 'update', 'update'], [copies, {}, copies]]])
    {
        const none = seedRun(actions, 'skill markdown-style\nhook none\n', { plugins: listing, env, args: actions.map((a) => (a === 'install' ? [] : ['--installed-only'])), each: read });
        const last = none.steps[none.steps.length - 1];
        assert.deepStrictEqual(hooksIn(last), [], `${env.length} steps: the None holds`);
        assert.deepStrictEqual(last.off, [...shipped].sort(), `${env.length} steps: every hook named off`);
    }

    for (const [selection, want] of [[`skill markdown-style\n${kept.map((h) => `hook ${h}`).join('\n')}\n`, kept], ['skill markdown-style\n', shipped]])
    {
        const mine = trip(selection, ownHook);
        assert.deepStrictEqual(hooksIn(mine.steps[2]), want.map((h) => `${h}.js`).sort(), 'the user\'s own hook file changes nothing');
        assert.deepStrictEqual(mine.steps[2].off, shipped.filter((h) => !want.includes(h)).sort());
        assert.ok(mine.steps.every((step) => step.files.includes('my-hook.js')), 'and is never touched');
    }
});

// The three engines stay COPIED on the plugin route - 22 shared bodies run `node .claude/hooks/docs.js` -
// so nothing they load may be a file that route removes.
test('seed: on the plugin route the copied engines still run, with no copy-route module beside them', POSIX_ONLY, () =>
{
    const { spawnSync } = require('node:child_process');
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { result } = seedRun('install', 'skill markdown-style\n', { plugins: listing, inspect: (repo) =>
    {
        const work = path.dirname(repo);
        const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'CLAUDE_PROJECT_DIR', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_STACK_UV_PYTHON', 'CLAUDE_STACK_MEMORY_DB', 'MCP_MEMORY_SQLITE_PATH']) delete env[k]; // legacy-name
        const runs = [['docs.js', 'status'], ['memory.js', 'level', repo], ['history.js', 'rulings']].map(([file, ...argv]) =>
        {
            const r = spawnSync(process.execPath, [path.join(repo, '.claude', 'hooks', file), ...argv], { cwd: repo, env, encoding: 'utf8' });
            return { file, status: r.status, stderr: r.stderr };
        });
        return { files: fs.readdirSync(path.join(repo, '.claude', 'hooks')).sort(), runs };
    } });
    assert.deepStrictEqual(result.files, ['docs.js', 'history.js', 'memory.js', 'model-windows.json'], 'only the engines and the window table');
    for (const run of result.runs)
    {
        assert.strictEqual(run.status, 0, `${run.file}: ${run.stderr}`);
        assert.ok(!/Cannot find module/.test(run.stderr), `${run.file}: ${run.stderr}`);
    }
});

// Ruling R55: a 1.x plugin-route project kept the copy route's prelude from an earlier copy-route
// stint (1.x pruned only the catalog hooks), and its stamp has no `hooks-route:` line. Its first 2.0.0
// run on the copy route must not read that leftover as the user's None.
test('seed update --installed-only: a 1.x plugin-route project with a leftover prelude keeps its hooks on the copy route', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const prepare = (off) => (repo) =>
    {
        const claude = path.join(repo, '.claude');
        fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
        fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(claude, 'rules', 'baseline-interaction.md'), 'x\n');
        for (const f of ['hook-prelude.js', 'fresh-session.js', 'docs.js', 'memory.js']) fs.writeFileSync(path.join(claude, 'hooks', f), '// x\n');
        fs.writeFileSync(path.join(claude, 'claude-stack.stamp'), `version: 1.3.0\nsha: 0000000\nshipped-hooks: ${shipped.join(',')}\n`); // legacy-name
        fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ env: { CLAUDE_STACK_HOOKS_OFF: off } }, null, 2)); // legacy-name
    };
    const inspect = (repo) => ({
        onDisk: fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort(),
        off: String(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).env.ALFRED_CODE_HOOKS_OFF || '').split(',').filter(Boolean).sort(),
        route: (/^hooks-route: (.*)$/m.exec(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8')) || [])[1],
    });
    const run = (off) => seedRun('update', 'skill markdown-style\n', { env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, plugins: LISTING_1X,
        args: ['--installed-only'], prepare: prepare(off), inspect }).result;
    const all = run('');
    assert.deepStrictEqual(all.onDisk, shipped.map((h) => `${h}.js`).sort(), 'every hook is copied, never a None');
    assert.deepStrictEqual(all.off, []);
    assert.strictEqual(all.route, 'copy', 'and the stamp now records the route');
    const one = run('guard-answer-length');
    assert.deepStrictEqual(one.onDisk, shipped.filter((h) => h !== 'guard-answer-length').map((h) => `${h}.js`).sort(), 'the 1.x off list is kept');
    assert.deepStrictEqual(one.off, ['guard-answer-length']);
});
