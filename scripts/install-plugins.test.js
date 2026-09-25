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
// A companion from another marketplace - a fixture: which plugin that is changes with the release (R72).
const CORE_DEPS = ['companion@elsewhere'];
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
    const mcps = ['serena|x', 'context7|@HTTP@'];
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES(), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer', 'mcp serena', 'mcp context7']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ mcps: false }), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ skills: false }), skills, agents, mcps }),
        ['mcp serena', 'mcp context7']);
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
test('set: a core companion is installed on every run, a stack entry or not', () =>
{
    const third = ['claude-hud@claude-plugins-official'];
    const entries = ['alfred-code@envoydev', ...LOCKED_SPECS];
    assert.deepStrictEqual(
        P.pluginSet({ routes: ROUTES(), thirdParty: third, stackEntries: entries, coreDeps: CORE_DEPS, locked: LOCKED }),
        [...third, ...entries, ...CORE_DEPS],
        'the core leads, the selection names the locked three once, the companion comes last');
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

// A retired name is the STACK's own plugin under the key the core is listed under, unless its row in
// meta/retired-plugins.json names another marketplace (ponytail, a third-party pick the stack dropped).
const RETIRED_ROWS = [
    { name: 'ponytail', marketplace: 'ponytail' },
    { name: 'sentry', addBack: 'claude plugin install sentry@claude-plugins-official --scope <scope>' },
    { name: 'angular-cli', addBack: 'claude mcp add angular-cli --scope <scope> -- npx -y @angular/cli mcp' },
];
const prow = (name, marketplace, scope, extra = {}) => ({ name, marketplace, version: '1.3.0', scope, enabled: true, ...extra });

test('retired: a retired plugin at this scope is uninstalled by its FULL spec, and an absent one is nothing to do', () =>
{
    const run = cli();
    const logs = [];
    const rows = [prow('ponytail', 'ponytail', 'project')];
    const gone = P.prunedRetired({ rows, retired: ['ponytail', 'never-installed'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone, ['ponytail']);
    assert.deepStrictEqual(run.matching(/uninstall/), ['plugin uninstall ponytail@ponytail --scope project -y']);
    assert.ok(logs.some((m) => /pruned \(retired upstream\) \[project\]: ponytail@ponytail/.test(m)), logs.join(' | '));
});

test('retired: a same-named plugin from ANOTHER marketplace is never the retired one - the official sentry stays', () =>
{
    const run = cli();
    const rows = [prow('sentry', 'claude-plugins-official', 'project'), prow('sentry', 'envoydev', 'project')];
    const gone = P.prunedRetired({ rows, retired: ['sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: run });
    assert.deepStrictEqual(gone, ['sentry']);
    assert.deepStrictEqual(run.matching(/uninstall/), ['plugin uninstall sentry@envoydev --scope project -y']);
    // Only the official one installed: nothing of the stack's to remove.
    const alone = cli();
    assert.deepStrictEqual(P.prunedRetired({ rows: [rows[0]], retired: ['sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: alone }), []);
    assert.deepStrictEqual(alone.calls, []);
});

test('retired: a 1.x install spells the retired name with ITS key, never the new one', () =>
{
    const run = cli();
    const key1x = 'claude-stack'; // legacy-name
    const rows = [prow('angular-cli', key1x, 'project'), prow('angular-cli', 'envoydev', 'project')];
    P.prunedRetired({ rows, retired: ['angular-cli'], retiredRows: RETIRED_ROWS, market: key1x, scope: 'project', cli: run });
    assert.deepStrictEqual(run.matching(/uninstall/), [`plugin uninstall angular-cli@${key1x} --scope project -y`]);
});

test('retired: a row at ANOTHER scope is kept and logged with its uninstall command - even beside one this run removes', () =>
{
    const run = cli();
    const logs = [];
    const rows = [prow('ponytail', 'ponytail', 'user'), prow('sentry', 'envoydev', 'user'), prow('sentry', 'envoydev', 'project')];
    const gone = P.prunedRetired({ rows, retired: ['ponytail', 'sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone, ['sentry']);
    assert.deepStrictEqual(run.matching(/uninstall/), ['plugin uninstall sentry@envoydev --scope project -y']);
    for (const spec of ['ponytail@ponytail', 'sentry@envoydev'])
        assert.ok(logs.some((m) => m.includes(`${spec} is installed at user scope`) && m.includes(`claude plugin uninstall ${spec} --scope user`)), `${spec}: ${logs.join(' | ')}`);
});

test('retired: each uninstall prints the add-back line of its row, at the scope it went from', () =>
{
    const logs = [];
    const rows = [prow('sentry', 'envoydev', 'project'), prow('angular-cli', 'envoydev', 'project'), prow('ponytail', 'ponytail', 'project')];
    P.prunedRetired({ rows, retired: ['sentry', 'angular-cli', 'ponytail'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: cli(), log: (m) => logs.push(m) });
    const at = (re) => logs.findIndex((m) => re.test(m));
    assert.ok(at(/add it back: claude plugin install sentry@claude-plugins-official --scope project$/) === at(/pruned .*: sentry@envoydev/) + 1, logs.join(' | '));
    assert.ok(at(/add it back: claude mcp add angular-cli --scope project -- npx -y @angular\/cli mcp$/) === at(/pruned .*: angular-cli@envoydev/) + 1, logs.join(' | '));
    assert.strictEqual(logs.filter((m) => /add it back/.test(m)).length, 2, 'a row with no add-back line prints none');
    // A refused uninstall prints no add-back line - the plugin is still there.
    const refused = [];
    P.prunedRetired({ rows: [rows[0]], retired: ['sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: cli(['uninstall']), log: (m) => refused.push(m) });
    assert.ok(!refused.some((m) => /add it back/.test(m)), refused.join(' | '));
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

// R70 (review I1): claude-hud is required, but its status line is account-wide, so a user who disabled
// it keeps it off. Measured on Claude Code 2.1.282: `plugin update` over a user-disabled claude-hud leaves
// `enabledPlugins` false, while `plugin install --scope user -y` flips it back to true - so update never
// enables it and install never re-installs it; both still update it, and an absent one is still installed.
const HUD_OFF = { name: 'claude-hud', marketplace: 'claude-hud', version: '0.8.0', scope: 'user', enabled: false };
const SP_OFF = { name: 'superpowers', marketplace: 'claude-plugins-official', version: '6.4.1', scope: 'user', enabled: false };

test('update: a claude-hud the user disabled stays off - updated, never enabled - while a parked pick in the set is enabled', () =>
{
    const run = cli();
    const report = P.updatePlugins({
        plugins: ['superpowers@claude-plugins-official', 'claude-hud@claude-hud'], scope: 'project', before: [SP_OFF, HUD_OFF],
        after: [SP_OFF, HUD_OFF].map((r) => (r.name === 'superpowers' ? { ...r, enabled: true } : r)), cli: run,
    });
    assert.deepStrictEqual(run.matching(/claude-hud@/), ['plugin update claude-hud@claude-hud --scope user -y'], run.calls.join('\n'));
    assert.ok(run.calls.includes('plugin enable superpowers@claude-plugins-official --scope user'), run.calls.join('\n'));
    assert.match(report.find((l) => /claude-hud/.test(l)), /plugin claude-hud: 0\.8\.0 but DISABLED - 'claude plugin enable claude-hud@claude-hud'/);
});

test('install: a claude-hud the user disabled is updated, never re-installed (install would enable it); an absent one is installed', () =>
{
    const off = cli();
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', before: [HUD_OFF], cli: off });
    assert.deepStrictEqual(off.matching(/claude-hud@/), ['plugin update claude-hud@claude-hud --scope user -y'], off.calls.join('\n'));
    const on = cli();
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', before: [{ ...HUD_OFF, enabled: true }], cli: on });
    assert.deepStrictEqual(on.matching(/claude-hud@/), ['plugin install claude-hud@claude-hud --scope user -y', 'plugin update claude-hud@claude-hud --scope user -y']);
    const absent = cli();
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', before: [], cli: absent });
    assert.deepStrictEqual(absent.matching(/claude-hud@/), ['plugin install claude-hud@claude-hud --scope user -y']);
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
    // Absent before the loop, there after it: this run installed it (claude-hud on a pre-R27 install),
    // which 'already newest' would hide.
    assert.match(report[0], /plugin absent: 1\.0\.0 \(installed this run\)/);
});

test('update: a third-party marketplace is registered before an absent plugin from it is installed', () =>
{
    const run = cli();
    P.updatePlugins({ plugins: ['claude-hud@claude-hud'], marketplaces: ['jarrodwatts/claude-hud'], scope: 'project', before: [], after: [], cli: run });
    const add = run.calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = run.calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(add >= 0 && inst > add, run.calls.join(' | '));
});

// --- the playwright engines: installed and enabled as the user picked (R67) ----------------------
// The CLI has no disabled install, so an engine the user chose NOT to enable is installed, then
// disabled at the SAME scope. An engine already installed never gets the install verb: over one,
// `install` turns a disabled engine back on, or adds an enabled project install beside a user-scope
// one (S28). It is updated in place, and switched only when the user answered (`on`); a switch the
// settings file shows already made is skipped, since a no-op enable or disable exits 1 (S28).

const PW = ['playwright-chrome@envoydev', 'playwright-firefox@envoydev'];
const ENG = (over = {}) => ({ specs: PW, present: [], presentScope: {}, off: [], on: null, isOn: () => undefined, ...over });
const PW_MOVES = /^plugin (install|disable|enable|update|uninstall) playwright-/;

test('install: a new engine is installed, and disabled right after only when the user chose it off', () =>
{
    const run = cli();
    P.installPlugins({ plugins: ['alfred-code@envoydev', ...PW], scope: 'project', engines: ENG({ off: ['playwright-firefox@envoydev'] }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin install playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
    ]);
    assert.deepStrictEqual(run.matching(/^plugin disable alfred-code/), [], 'only an engine chosen off is disabled');
});

test('install: an engine already installed never gets the install verb - it would switch a disabled one back on (S28)', () =>
{
    const run = cli();
    const before = [
        { name: 'playwright-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'playwright-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: false },
    ];
    P.installPlugins({ plugins: PW, scope: 'project', before, engines: ENG(), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope user -y',
    ], 'an installed engine was installed over, or its flag was flipped with no answer to apply');
});

test('install: on a listing it could not read, an engine the stamp names is present - updated, never installed over', () =>
{
    const run = cli();
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ present: ['playwright-chrome@envoydev'], off: PW }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
    ], 'a present engine was installed over or disabled - off is for an engine this run installs');
});

// Round 2, minor 2: blind, the settings file is a presence signal too - install writes the engine's
// enabledPlugins key and uninstall removes it (S28) - so an engine it names is updated where it lives.
test('install: on a listing it could not read, an engine present at user scope is updated there, never installed', () =>
{
    const run = cli();
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ present: PW, presentScope: { 'playwright-firefox@envoydev': 'user' } }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope user -y',
    ]);
});

test('install: the user\'s answer is applied to the installed engines - a switch already made is skipped, one at another scope is named', () =>
{
    const run = cli();
    const before = [
        { name: 'playwright-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'playwright-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'playwright-webkit', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: true },
    ];
    const specs = [...PW, 'playwright-webkit@envoydev'];
    const logs = [];
    const isOn = (spec) => ({ 'playwright-chrome@envoydev': true, 'playwright-firefox@envoydev': true })[spec];
    P.installPlugins({ plugins: specs, scope: 'project', before, engines: ENG({ specs, on: ['playwright-chrome@envoydev'], off: specs.slice(1), isOn }), cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
        'plugin update playwright-webkit@envoydev --scope user -y',
    ], 'chrome is on already (no enable that exits 1), firefox is switched off, a user-scope engine is left there');
    assert.ok(logs.some((m) => /playwright-webkit@envoydev is installed at user scope, not this run's .*claude plugin disable playwright-webkit@envoydev --scope user/.test(m)), logs.join(' | '));
    // Unknown state (no settings entry): the switch is made, and a refusal is noted with its command.
    const notes = [];
    P.installPlugins({ plugins: PW, scope: 'project', before, engines: ENG({ on: PW }), cli: cli(['enable playwright-firefox']), note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin enable failed: playwright-firefox@envoydev .*claude plugin enable playwright-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('install: a failed engine install runs no disable, and a failed disable is noted with its hand command', () =>
{
    const failed = cli(['install playwright-chrome']);
    const notes = [];
    P.installPlugins({ plugins: PW, scope: 'user', engines: ENG({ off: PW }), cli: failed, note: (m) => notes.push(m) });
    assert.deepStrictEqual(failed.matching(/^plugin disable /), ['plugin disable playwright-firefox@envoydev --scope user']);
    const stuck = cli(['disable playwright-firefox']);
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ off: PW }), cli: stuck, note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin disable failed: playwright-firefox@envoydev.*claude plugin disable playwright-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('update: an installed engine is updated in place and never flipped with no answer; an absent one comes back as last chosen', () =>
{
    const run = cli();
    const before = [
        { name: 'playwright-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'playwright-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
    ];
    const specs = [...PW, 'playwright-webkit@envoydev'];
    const report = P.updatePlugins({ plugins: specs, scope: 'project', before, after: before, engines: ENG({ specs, off: ['playwright-webkit@envoydev'] }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
        'plugin install playwright-webkit@envoydev --scope project -y',
        'plugin disable playwright-webkit@envoydev --scope project',
        'plugin update playwright-webkit@envoydev --scope project -y',
    ]);
    assert.ok(!report.some((l) => /DISABLED|claude plugin enable/.test(l)), `an engine left off was reported as something to enable: ${report.join(' | ')}`);
    // A parked plugin that is NOT an engine is still enabled, as before.
    const other = cli();
    P.updatePlugins({ plugins: ['playwright-firefox@envoydev'], scope: 'project', before, after: before, cli: other });
    assert.deepStrictEqual(other.matching(/^plugin enable /), ['plugin enable playwright-firefox@envoydev --scope project']);
});

test('update: an engine installed at ANOTHER scope is updated at that scope, and an absent one is disabled where it went', () =>
{
    const run = cli();
    const before = [{ name: 'playwright-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: false }];
    P.updatePlugins({ plugins: PW, scope: 'project', before, after: before, engines: ENG({ off: PW }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update playwright-chrome@envoydev --scope user -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
        'plugin update playwright-firefox@envoydev --scope project -y',
    ]);
});

// An engine the last install installed and this run no longer keeps is UNINSTALLED at this run's
// scope (I2) - left installed it reads back as listed and is kept again by the next update.
test('uninstall: an engine no longer kept goes at this scope; one at another scope is named; one not installed is nothing', () =>
{
    const run = cli();
    const logs = [];
    const rows = [
        { name: 'playwright-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'playwright-webkit', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: true },
        { name: 'playwright-firefox', marketplace: 'claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
    ];
    const gone = P.uninstallEngines({ specs: ['playwright-firefox@envoydev', 'playwright-webkit@envoydev', 'playwright-msedge@envoydev'], rows, scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), ['plugin uninstall playwright-firefox@envoydev --scope project -y']);
    assert.deepStrictEqual(gone, ['playwright-firefox@envoydev']);
    assert.ok(logs.some((m) => /^plugin uninstalled \[project\]: playwright-firefox@envoydev/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /playwright-webkit@envoydev is installed at user scope, not this run's .*claude plugin uninstall playwright-webkit@envoydev --scope user/.test(m)), logs.join(' | '));
    const notes = [];
    P.uninstallEngines({ specs: ['playwright-firefox@envoydev'], rows, scope: 'project', cli: cli(['uninstall']), note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin uninstall failed: playwright-firefox@envoydev .*claude plugin uninstall playwright-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('uninstall: on a listing it could not read, the uninstall is tried at this scope, and a refusal is said, never counted', () =>
{
    const run = cli(['uninstall playwright-webkit']);
    const logs = [];
    const notes = [];
    const gone = P.uninstallEngines({ specs: ['playwright-firefox@envoydev', 'playwright-webkit@envoydev'], rows: [], blind: true, scope: 'project', cli: run, log: (m) => logs.push(m), note: (m) => notes.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin uninstall playwright-firefox@envoydev --scope project -y',
        'plugin uninstall playwright-webkit@envoydev --scope project -y',
    ]);
    assert.deepStrictEqual(gone, ['playwright-firefox@envoydev']);
    assert.deepStrictEqual(notes, [], 'an engine already gone is no failure');
    assert.ok(logs.some((m) => /playwright-webkit@envoydev: not uninstalled - the plugin listing could not be read.*claude plugin uninstall playwright-webkit@envoydev --scope project/.test(m)), logs.join(' | '));
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

// R27: claude-hud is required - installed on every run beside the core, never a pick, and still at
// user scope (its status line is account-wide). The other four third-party plugins are optional picks,
// and so is superpowers (R72): a selection naming none of them installs none of them.
const OPTIONAL = ['security-guidance', 'claude-md-management', 'csharp-lsp', 'typescript-lsp'];

test('seed install: a selection naming no plugin still installs claude-hud at user scope, its marketplace first, and none of the optional four', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n');
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.indexOf('plugin install claude-hud@claude-hud --scope user -y');
    assert.ok(inst >= 0, `claude-hud was not installed at user scope:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
    for (const name of [...OPTIONAL, 'superpowers'])
        assert.ok(!calls.some((c) => c.startsWith(`plugin install ${name}@`)), `${name} is optional, yet a selection naming no plugin installed it:\n${calls.join('\n')}`);
});

test('seed install: a selection that still names claude-hud installs it once, and an optional pick it names is installed', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', `${HUD_SELECTION}plugin security-guidance\n`);
    assert.strictEqual(calls.filter((c) => /^plugin install claude-hud@/.test(c)).length, 1, calls.join('\n'));
    assert.ok(calls.includes('plugin install security-guidance@claude-plugins-official --scope project -y'), calls.join('\n'));
});

// An install from before R27 carries whichever of the four its walk picked, and may lack claude-hud:
// optional is not retired, so the read-back keeps each one it finds, and the required one is added.
test('seed update --installed-only: an older install keeps its optional plugins and gains claude-hud', POSIX_ONLY, () =>
{
    const row = (id, extra = {}) => ({ id, version: '1.0.0', scope: 'project', enabled: true, ...extra });
    const listing = JSON.stringify([
        row(`${OLD}@${OLD}`, { version: '1.3.0' }),
        ...['serena', 'context7', 'memory'].map((n) => row(`${n}@${OLD}`, { version: '1.3.0' })),
        row('superpowers@claude-plugins-official', { scope: 'user' }),
        row('security-guidance@claude-plugins-official'),
        row('csharp-lsp@claude-plugins-official'),
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'claude-stack.stamp'), 'version: 1.3.0\nsha: 0000000\n'); // legacy-name
    };
    const { calls } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only'], prepare });
    for (const name of ['security-guidance', 'csharp-lsp'])
    {
        assert.ok(calls.includes(`plugin update ${name}@claude-plugins-official --scope project -y`), `${name} was not kept:\n${calls.join('\n')}`);
        assert.ok(!calls.some((c) => c.startsWith(`plugin uninstall ${name}@`) || c.startsWith(`plugin disable ${name}@`)), `${name} was taken out:\n${calls.join('\n')}`);
    }
    for (const name of ['claude-md-management', 'typescript-lsp'])
        assert.ok(!calls.some((c) => c.startsWith(`plugin install ${name}@`)), `${name} was never picked, yet the update installed it:\n${calls.join('\n')}`);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.indexOf('plugin install claude-hud@claude-hud --scope user -y');
    assert.ok(inst >= 0, `the update did not add claude-hud:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});

// configure's keep-parked line for a disabled claude-hud reaches the installer as a --drop: the run
// keeps it off, and an install (which re-enables, measured) or an enable never touches it.
test('seed update --installed-only: a claude-hud the user disabled stays off, with or without configure\'s keep-parked --drop', POSIX_ONLY, () =>
{
    const row = (id, extra = {}) => ({ id, version: '2.0.0', scope: 'project', enabled: true, ...extra });
    const listing = JSON.stringify([
        ...['alfred-code', 'serena', 'context7', 'memory'].map((n) => row(`${n}@envoydev`)),
        row('superpowers@claude-plugins-official', { version: '6.4.1', scope: 'user' }),
        row('claude-hud@claude-hud', { version: '0.8.0', scope: 'user', enabled: false }),
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
    };
    for (const args of [['--installed-only'], ['--installed-only', '--drop', 'plugin claude-hud']])
    {
        const { calls } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args, prepare });
        const hud = calls.filter((c) => /^plugin (install|enable|update|uninstall|disable) claude-hud@/.test(c));
        assert.deepStrictEqual(hud, ['plugin update claude-hud@claude-hud --scope user -y'], `${args.join(' ')}:\n${calls.join('\n')}`);
    }
});

// R72: superpowers is an optional pick, never seeded. A selection that does not name it installs none;
// one that names it installs it from its own marketplace. And an install that already has it - every
// install before 2.0.0 does - keeps it: it lives in another marketplace, which no retirement pass
// touches (R32), so update refreshes it at the scope it sits at and never uninstalls or disables it.
const SP = 'superpowers@claude-plugins-official';
const spTouched = (calls, verbs) => calls.filter((c) => new RegExp(`^plugin (${verbs}) ${SP}( |$)`).test(c));

test('seed install: a selection that names no superpowers installs none, one that names it installs it', POSIX_ONLY, () =>
{
    const bare = seedRun('install', 'skill markdown-style\nrule markdown-docs\n').calls;
    assert.deepStrictEqual(spTouched(bare, 'install|enable|update'), [], bare.join('\n'));
    const picked = seedRun('install', 'skill markdown-style\nrule markdown-docs\nplugin superpowers\n').calls;
    assert.deepStrictEqual(spTouched(picked, 'install'), [`plugin install ${SP} --scope project -y`], picked.join('\n'));
});

const spListing = (scope) => JSON.stringify([
    ...['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })),
    { id: SP, version: '6.4.1', scope, enabled: true },
]);
const spPrepare = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'version: 1.3.0\nsha: 0000000\n');
};

test('seed update --installed-only: an install that has superpowers keeps it, refreshed at its own scope', POSIX_ONLY, () =>
{
    for (const scope of ['user', 'project'])
    {
        const { calls } = seedRun('update', 'skill markdown-style\n', { plugins: spListing(scope), args: ['--installed-only'], prepare: spPrepare });
        assert.deepStrictEqual(spTouched(calls, 'uninstall|disable'), [], `${scope}: superpowers was taken out:\n${calls.join('\n')}`);
        assert.deepStrictEqual(spTouched(calls, 'update'), [`plugin update ${SP} --scope ${scope} -y`], `${scope}: it was not kept:\n${calls.join('\n')}`);
    }
});

test('seed update: a selection that does not name an installed superpowers leaves it installed and enabled', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: spListing('project'), prepare: spPrepare });
    assert.deepStrictEqual(spTouched(calls, 'uninstall|disable'), [], calls.join('\n'));
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
    const key = 'claude-stack'; // legacy-name
    const rows = [
        { name: 'claude-stack-angular', marketplace: key, version: '1.2.0', scope: 'project', enabled: false },
        { name: 'claude-stack-aspnet', marketplace: key, version: '1.2.0', scope: 'user', enabled: true },
        { name: 'claude-stack-web-angular', marketplace: key, version: '1.2.0', scope: 'project', enabled: true },
        { name: 'ponytail', marketplace: 'ponytail', version: '1.0.0', scope: 'project', enabled: false },
    ];
    const carriers = ['claude-stack-angular', 'claude-stack-aspnet', 'claude-stack-web-angular'];
    const gone = P.prunedRetired({ rows, retired: [...carriers, 'ponytail'], retiredRows: RETIRED_ROWS, carriers, market: key, scope: 'project', cli: (a) => { calls.push(a.join(' ')); return true; }, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone.sort(), ['claude-stack-web-angular', 'ponytail'], 'a parked retired name that carries nothing still goes at this scope');
    assert.ok(!calls.some((c) => /claude-stack-angular@|claude-stack-aspnet@/.test(c)), calls.join(' | '));
    assert.ok(logs.some((m) => /claude-stack-angular@claude-stack is parked here - kept/.test(m) && /claude plugin uninstall claude-stack-angular@claude-stack --scope project/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /claude-stack-aspnet@claude-stack is installed at user scope/.test(m) && /claude plugin uninstall claude-stack-aspnet@claude-stack --scope user/.test(m)), logs.join(' | '));
});

test('prunedRetired retries a refused uninstall in a second pass', () =>
{
    const calls = [];
    const key = 'claude-stack'; // legacy-name
    const rows = [{ name: 'claude-stack-web-angular', marketplace: key, version: '1.2.0', scope: 'project' }, { name: 'claude-stack-angular', marketplace: key, version: '1.2.0', scope: 'project' }];
    let leafGone = false;
    const cli = (args) => { calls.push(args[2]); if (args[2] === `claude-stack-web-angular@${key}`) { leafGone = true; return true; } return leafGone; };
    const gone = P.prunedRetired({ rows, retired: ['claude-stack-angular', 'claude-stack-web-angular'], market: key, scope: 'project', cli });
    assert.deepStrictEqual(gone.sort(), ['claude-stack-angular', 'claude-stack-web-angular']);
    assert.deepStrictEqual(calls, [`claude-stack-angular@${key}`, `claude-stack-web-angular@${key}`, `claude-stack-angular@${key}`], 'the refusal is retried once, after the leaf');
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
    const out = P.migrateLegacy({ rows, scope, retired: carriers, carriers, cli: run, log: (m) => logs.push(m), note: (m) => notes.push(m) });
    return { out, run, logs, notes, moves: run.matching(/^plugin (install|uninstall|update|enable) /) };
}

test('migrate: a 1.x core at this scope - the new core is installed FIRST, then the leaves, the hooks alias and the core alias go', () =>
{
    const { out, moves } = migrate([row1x(OLD, 'project'), row1x(OLD_HOOKS, 'project'), row1x(`${OLD}-angular`, 'project'), row1x(`${OLD}-web-angular`, 'project')]);
    assert.deepStrictEqual(moves, [
        `plugin install alfred-code@${OLD} --scope project -y`,
        `plugin uninstall ${OLD}-web-angular@${OLD} --scope project -y`,
        `plugin uninstall ${OLD}-angular@${OLD} --scope project -y`,
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
        `plugin uninstall ${OLD}-angular@${OLD} --scope project -y`,
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
        at(`plugin uninstall ${OLD}-web-angular@${OLD} --scope project -y`),
        at(`plugin uninstall ${OLD}-angular@${OLD} --scope project -y`),
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
    const leaf = calls.indexOf(`plugin uninstall ${OLD}-angular@${OLD} --scope project -y`);
    const core = calls.indexOf(`plugin uninstall ${OLD}@${OLD} --scope project -y`);
    assert.ok(leaf >= 0 && core > leaf, stackMoves(calls).join('\n'));
    assert.strictEqual(calls.filter((c) => c === `plugin uninstall ${OLD}-angular@${OLD} --scope project -y`).length, 1, 'one retired pass, not two');
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
        `plan migrate: claude plugin uninstall ${OLD}-web-angular@${OLD} --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD}-angular@${OLD} --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD_HOOKS}@${OLD} --scope project -y`,
        `plan migrate: claude plugin uninstall ${OLD}@${OLD} --scope project -y`,
    ], out);
});

// The configure / validate read-back on a 1.x install: `--installed-only` under the key the stack was
// registered with, a 1.x stamp whose picks are homed in the 1.x core, a 1.x seat deny and a 1.x
// switch-off. The read-back must be the same install - the picks rehomed, the deny in one spelling,
// the hooks the user switched off still off - or the first 2.0.0 update turns them back on.
// 2.0.0 cut five MCP plugins (R26, R32). Update removes the stack's own - by its full spec under the
// key the core is listed under - and prints the line that adds each server back; the official
// catalog's same-named `sentry` and a row another scope carries are never touched.
const CUT = ['angular-cli', 'chrome-devtools', 'appium-mcp', 'sentry', 'context7-local'];
const cutListing = (key, core) => JSON.stringify([
    { id: `${core}@${key}`, version: '1.3.0', scope: 'project', enabled: true },
    ...CUT.map((n) => ({ id: `${n}@${key}`, version: '1.3.0', scope: 'project', enabled: true })),
    { id: 'sentry@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
    { id: `angular-cli@${key}`, version: '1.3.0', scope: 'user', enabled: true },
]);

test('seed update: the five cut MCP plugins go by their stack spec, each with its add-back line - the official sentry and a user-scope row stay', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: cutListing('envoydev', 'alfred-code') });
    const uninstalls = calls.filter((c) => /^plugin uninstall /.test(c));
    assert.deepStrictEqual(uninstalls.sort(), CUT.map((n) => `plugin uninstall ${n}@envoydev --scope project -y`).sort(), uninstalls.join('\n'));
    for (const n of CUT) assert.match(out, new RegExp(`pruned \\(retired upstream\\) \\[project\\]: ${n}@envoydev\\n==>     add it back: claude mcp add .*--scope project .*${n}`));
    assert.match(out, /add it back: claude mcp add --transport http --scope project sentry https:\/\/mcp\.sentry\.dev\/mcp/);
    assert.match(out, /angular-cli@envoydev is installed at user scope, not this run's - kept .*claude plugin uninstall angular-cli@envoydev --scope user/);
    assert.ok(!calls.some((c) => /^plugin (install|update|enable) (angular-cli|chrome-devtools|appium-mcp|sentry|context7-local)@/.test(c)), calls.join('\n'));
});

test('seed update: a 1.x project loses the cut plugins under ITS key while it moves across', POSIX_ONLY, () =>
{
    const key = 'claude-stack'; // legacy-name
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: cutListing(key, key) });
    const uninstalls = calls.filter((c) => /^plugin uninstall /.test(c));
    for (const n of CUT) assert.ok(uninstalls.includes(`plugin uninstall ${n}@${key} --scope project -y`), `${n}:\n${uninstalls.join('\n')}`);
    assert.ok(!uninstalls.some((c) => /@(envoydev|claude-plugins-official) /.test(c)), uninstalls.join('\n'));
    assert.ok(!uninstalls.some((c) => /--scope user/.test(c)), uninstalls.join('\n'));
});

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

// R94 (Task 18b fix round 1), the R56 probe end to end: a stamp with no `hooks-route:` line, ONE stack
// hook left in the folder and wired nowhere, the off list stored, the run on the hooks copy route. No
// stored switch and no wiring say the copy route made that file, so it is the plugin route's leftover:
// 16 of 17 hooks end on, never 1 of 17 with the other 16 named off.
test('seed update --installed-only: an unwired stack hook under a stamp with no hooks route is no pick - 16 of 17 stay on (R94)', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { result } = seedRun('update', 'skill markdown-style\n', {
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, plugins: listing, args: ['--installed-only'],
        prepare: (repo) =>
        {
            const claude = path.join(repo, '.claude');
            fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
            fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(claude, 'rules', 'baseline-interaction.md'), 'x\n');
            fs.writeFileSync(path.join(claude, 'hooks', 'guard-secret-value.js'), '// x\n');
            fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), `version: 1.3.0\nsha: 0000000\nshipped-hooks: ${shipped.join(',')}\n`);
            fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } }, null, 2));
        },
        inspect: (repo) => ({
            onDisk: fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort(),
            off: String(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).env.ALFRED_CODE_HOOKS_OFF).split(',').filter(Boolean).sort(),
        }),
    });
    assert.deepStrictEqual(result.off, ['guard-answer-length'], 'only the hook the user switched off is named off');
    assert.deepStrictEqual(result.onDisk, shipped.filter((h) => h !== 'guard-answer-length').map((h) => `${h}.js`).sort(), '16 of 17 hooks copied and on');
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

// configure and validate SHOW the --print-plan output. A plan records the uninstalls, it never runs
// them, so it must never print the outcome lines a run prints after one - a 'plugin pruned' or an
// 'add it back:' there reads as done. The notes that describe what the run would do stay, marked.
test('seed plan: --print-plan over a 1.x project with cut plugins prints no removal outcome - nothing ran', POSIX_ONLY, () =>
{
    const key = 'claude-stack'; // legacy-name
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: cutListing(key, key), args: ['--print-plan'] });
    assert.deepStrictEqual(calls.filter((c) => /^plugin (install|uninstall|update|enable) /.test(c)), [], calls.join('\n'));
    assert.ok(out.includes(`plan migrate: claude plugin uninstall sentry@${key} --scope project -y`), out);
    assert.ok(!/plugin pruned|add it back:|plugin removed/.test(out), out.split('\n').filter((l) => /plugin pruned|add it back:|plugin removed/.test(l)).join('\n'));
    assert.match(out, new RegExp(`^plan note: angular-cli@${key} is installed at user scope, not this run's - kept`, 'm'));
});

// --- R67 end to end: the engines installed and enabled as the user picked --------------------------
const PW_SELECTION = 'skill markdown-style\nrule markdown-docs\nmcp playwright\n';
const stampOf = (repo) => { try { return fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'); } catch { return ''; } };
const pwMoves = (calls) => calls.filter((c) => /^plugin (install|disable|enable|update|uninstall) playwright-/.test(c));
const ROW = (id, extra = {}) => ({ id, version: '1.0.0', scope: 'project', enabled: true, ...extra });
const CORE_ROWS = [ROW('alfred-code@envoydev'), ROW('serena@envoydev'), ROW('context7@envoydev'), ROW('memory@envoydev')];
// A project the stack installed: a copied rule (so --installed-only finds an install), the stamp, and
// optionally the project settings' enabledPlugins - the file the CLI writes an engine's on/off to.
const installedProject = (stamp, enabledPlugins) => (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
    if (stamp !== null) fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), `sha: abc\nversion: 2.0.0\n${stamp}`);
    if (enabledPlugins) fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins }));
};
// A `claude` that keeps its plugin listing the way the CLI does: install adds an enabled row (or turns
// an installed one back on, S28), uninstall removes it (exit 1 when there is none), enable and disable
// flip it. Everything else only answers 0.
const LIVE_CLAUDE = {
    claude: `exec "${process.execPath}" -e '
const fs = require("fs"); const a = process.argv.slice(1);
fs.appendFileSync(process.env.CLAUDE_STUB_LOG, a.join(" ") + "\\n");
const file = process.env.CLAUDE_STUB_PLUGINS;
if (a[0] !== "plugin") process.exit(0);
if (a[1] === "list") { process.stdout.write(fs.readFileSync(file, "utf8")); process.exit(0); }
if (!["install", "uninstall", "enable", "disable"].includes(a[1])) process.exit(0);
let rows; try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
const scope = a[a.indexOf("--scope") + 1]; const at = rows.findIndex((r) => r.id === a[2] && r.scope === scope);
if (a[1] === "install") { if (at < 0) rows.push({ id: a[2], version: "1.0.0", scope, enabled: true }); else rows[at].enabled = true; }
if (a[1] === "uninstall") { if (at < 0) process.exit(1); rows.splice(at, 1); }
if (a[1] === "enable" && at >= 0) rows[at].enabled = true;
if (a[1] === "disable" && at >= 0) rows[at].enabled = false;
fs.writeFileSync(file, JSON.stringify(rows));' -- "$@"`,
};
const listingOf = (repo) => JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'plugins.json'), 'utf8'));

test('seed install: a fresh install ENABLES every engine it installs - none is disabled - and the stamp records both sets', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('install', PW_SELECTION, { args: ['--playwright-browsers', 'firefox,chrome'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin install playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
    ]);
    assert.match(result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: chrome,firefox$/m);
    assert.match(out, /playwright: installs chrome,firefox; no enable answer given - one already installed keeps its on\/off, one installed now arrives on \(\/plugin toggles them\)/);
});

test('seed install --playwright-enabled: an engine the user did not enable is installed, then disabled at the same scope', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('install', PW_SELECTION, { args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin install playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
    ]);
    assert.match(result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: chrome$/m);
    assert.match(out, /playwright: installs chrome,firefox; enabled as picked: chrome \(\/plugin toggles them\)/);
    // none: every engine installed and left off.
    const none = seedRun('install', PW_SELECTION, { args: ['--playwright-browsers', 'chrome', '--playwright-enabled', 'none'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(none.calls), ['plugin install playwright-chrome@envoydev --scope project -y', 'plugin disable playwright-chrome@envoydev --scope project']);
    assert.match(none.result, /^playwright-enabled: $/m);
});

test('seed update --installed-only with no answer flips nothing - installed engines are updated in place, a never-stamped disabled one is left alone', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS,
        ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev', { enabled: false }),
        ROW('playwright-webkit@envoydev', { enabled: false }),
    ]);
    const { calls, result } = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
    ], 'an engine flag was flipped, an installed engine was installed over, or the never-stamped one was touched');
    assert.match(result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: chrome$/m, 'the recorded choice changed with no answer given');
});

test('seed update: the reviewer\'s probe - an engine a narrower install set leaves out is UNINSTALLED, and a plain update never brings it back', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev')]);
    const { calls, steps, outs, result } = seedRun(['update', 'update'], PW_SELECTION, {
        plugins, tools: LIVE_CLAUDE,
        args: [['--installed-only', '--playwright-browsers', 'chrome'], ['--installed-only']],
        prepare: installedProject('playwright-browsers: chrome,firefox\n'),
        each: (repo) => ({ stamp: (/^playwright-browsers: (.*)$/m.exec(stampOf(repo)) || [])[1], ids: listingOf(repo).map((r) => r.id) }),
        inspect: listingOf,
    });
    assert.deepStrictEqual(calls.filter((c) => /playwright-firefox/.test(c) && /^plugin (install|uninstall|enable) /.test(c)),
        ['plugin uninstall playwright-firefox@envoydev --scope project -y'], 'firefox was not uninstalled once, or came back');
    assert.match(outs[0], /plugin uninstalled \[project\]: playwright-firefox@envoydev \(no longer picked\)/);
    assert.deepStrictEqual(steps.map((s) => s.stamp), ['chrome', 'chrome'], 'the stamp did not stay chrome after both runs');
    assert.ok(!result.some((r) => r.id === 'playwright-firefox@envoydev'), 'firefox is installed again after the plain update');
    assert.ok(result.some((r) => r.id === 'playwright-chrome@envoydev' && r.enabled), 'chrome was lost or switched off');
});

test('seed update --drop mcp playwright: every engine the stamp names is uninstalled, never merely disabled', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev', { enabled: false })]);
    const { calls, result } = seedRun('update', PW_SELECTION, {
        plugins, tools: LIVE_CLAUDE, args: ['--installed-only', '--drop', 'mcp playwright'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n'),
        inspect: (repo) => ({ stamp: stampOf(repo), ids: listingOf(repo).map((r) => r.id) }),
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin uninstall playwright-chrome@envoydev --scope project -y',
        'plugin uninstall playwright-firefox@envoydev --scope project -y',
    ]);
    assert.ok(!result.ids.some((id) => id.startsWith('playwright-')), result.ids.join(','));
    assert.match(result.stamp, /^playwright-browsers: $/m);
});

test('seed update: an engine uninstalled by hand comes back in its last chosen state', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev')]);
    const off = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n'), inspect: stampOf });
    assert.match(off.out, /one installed now arrives on, except firefox \(last left off\)/);
    assert.deepStrictEqual(pwMoves(off.calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
        'plugin update playwright-firefox@envoydev --scope project -y',
    ], 'firefox, last left off, did not come back off');
    assert.match(off.result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: chrome$/m);
    const on = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome,firefox\n') });
    assert.deepStrictEqual(pwMoves(on.calls).filter((c) => /firefox/.test(c)), [
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
    ], 'firefox, last left on, came back off');
});

test('seed install (init re-run) over installed engines: no install verb - it would turn a disabled one back on (S28)', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev', { enabled: false })]);
    const { calls } = seedRun('install', PW_SELECTION, {
        plugins, args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n',
            { 'playwright-chrome@envoydev': true, 'playwright-firefox@envoydev': false }),
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
    ], 'an installed engine was installed over, or a switch the settings file shows made was made again');
});

test('seed update --playwright-enabled (configure): the answer is applied to the installed engines and recorded', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev', { enabled: false })]);
    const { calls, out, result } = seedRun('update', PW_SELECTION, {
        plugins, args: ['--installed-only', '--playwright-enabled', 'firefox'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n',
            { 'playwright-chrome@envoydev': true, 'playwright-firefox@envoydev': false }),
        inspect: stampOf,
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin disable playwright-chrome@envoydev --scope project',
        'plugin update playwright-firefox@envoydev --scope project -y',
        'plugin enable playwright-firefox@envoydev --scope project',
    ]);
    assert.match(out, /plugin enabled \[project\]: playwright-firefox@envoydev \(as picked/);
    assert.match(result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: firefox$/m);
});

// A listing the run cannot read shows every engine as absent. The STAMP then says which are new: an
// engine it names is taken as installed (updated, never installed over); only a new engine the user
// chose not to enable is disabled after its install.
test('seed install on a listing it cannot read: the stamp says which engines are new, and only a new one chosen off is disabled', POSIX_ONLY, () =>
{
    const fresh = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'] });
    assert.deepStrictEqual(pwMoves(fresh.calls), [
        'plugin install playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
    ], 'no stamp: every engine is new, and the one chosen off must be disabled');
    assert.match(fresh.out, /playwright: the plugin listing could not be read and neither the stamp nor the settings name an installed engine - each installs as new/);
    const noAnswer = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome'] });
    assert.deepStrictEqual(pwMoves(noAnswer.calls), ['plugin install playwright-chrome@envoydev --scope project -y'], 'no answer: nothing is disabled');
    const stamped = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'],
        prepare: installedProject('playwright-browsers: chrome\nplaywright-enabled: chrome\n', { 'playwright-chrome@envoydev': true }) });
    assert.deepStrictEqual(pwMoves(stamped.calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin disable playwright-firefox@envoydev --scope project',
    ], 'the stamped engine was installed over, or the new one was left on');
    assert.match(stamped.out, /playwright: the plugin listing could not be read - the stamp or the settings name chrome as installed \(updated in place\); the rest install as new/);
    // A 1.x stamp has no engine line: nothing is known, so each is installed, and with no answer none is disabled.
    const old = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome'], prepare: installedProject('') });
    assert.deepStrictEqual(pwMoves(old.calls), ['plugin install playwright-chrome@envoydev --scope project -y']);
});

test('seed install on the MCP copy route: --playwright-enabled is recorded, and said not applied - /mcp switches a registered server', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('install', PW_SELECTION, { env: { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [], 'the copy route installed or switched an engine plugin');
    assert.match(out, /playwright: --playwright-enabled is recorded but not applied on the MCP copy route - the engines are \.mcp\.json servers, \/mcp switches them/);
    assert.match(result, /^playwright-browsers: chrome,firefox\nplaywright-enabled: chrome$/m);
});

// --- round 2 ---------------------------------------------------------------------------------------
// Important 1, the reviewer's probe P1: the stamp says chrome and firefox are enabled, the user has
// since switched firefox off in /plugin, and configure adds webkit. The walk pre-selects the enable
// question from the plan's LIVE set, so the answer it passes leaves firefox off - no enable call.
test('seed configure: the enable question is pre-selected from the LIVE state - a /plugin switch-off survives adding webkit', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev')]);
    const planFile = (work) => path.join(work, 'plan.json');
    const plan = (work) => JSON.parse(fs.readFileSync(planFile(work), 'utf8')).playwright;
    // What configure does with the plan: today's sets pre-selected, webkit added and left ticked.
    const walk = (repo, work) => ['--installed-only', '--playwright-browsers', [...plan(work).installed, 'webkit'].join(','),
        '--playwright-enabled', [...plan(work).enabled, 'webkit'].join(',')];
    const { calls, steps, result } = seedRun(['update', 'update'], PW_SELECTION, {
        plugins,
        args: [(repo, work) => ['--installed-only', '--print-plan', '--plan-out', planFile(work)], walk],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome,firefox\n',
            { 'playwright-chrome@envoydev': true, 'playwright-firefox@envoydev': false }),
        each: (repo, i) => (i === 0 ? plan(path.dirname(repo)) : null),
        inspect: stampOf,
    });
    assert.deepStrictEqual(steps[0], { installed: ['chrome', 'firefox'], enabled: ['chrome'] }, 'the plan took the stamp over the settings file');
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope project -y',
        'plugin install playwright-webkit@envoydev --scope project -y',
        'plugin update playwright-webkit@envoydev --scope project -y',
    ], 'an engine whose live state the answer did not change was switched');
    assert.match(result, /^playwright-browsers: chrome,firefox,webkit\nplaywright-enabled: chrome,webkit$/m);
});

test('seed plan: an engine the settings file does not name falls back to the stamp\'s last answer', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev')]);
    const { result } = seedRun('update', PW_SELECTION, {
        plugins, args: [(repo, work) => ['--installed-only', '--print-plan', '--plan-out', path.join(work, 'plan.json')]],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n', { 'playwright-chrome@envoydev': true }),
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'plan.json'), 'utf8')).playwright,
    });
    assert.deepStrictEqual(result, { installed: ['chrome', 'firefox'], enabled: ['chrome'] }, 'firefox, off in the stamp and unnamed in settings, read as on');
});

// Minor 1: a dropped engine whose uninstall did not happen is still listed, and enabled. The next
// plain update must not read it back as kept - the stamp stays the user's choice.
test('seed update: a dropped engine still installed is never kept again - the stamp holds, and the log names its uninstall', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev')]);
    const { calls, out, result } = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: chrome\nplaywright-enabled: chrome\n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls).filter((c) => /firefox/.test(c)), [], 'the dropped engine was touched');
    assert.match(result, /^playwright-browsers: chrome\nplaywright-enabled: chrome$/m, 'the leftover was written back as kept');
    assert.match(out, /playwright-firefox@envoydev is installed but not among the browsers the last install kept .*claude plugin uninstall playwright-firefox@envoydev --scope project/);
    // Every engine dropped, one left over: nothing is kept, and chrome is never installed as a default.
    const all = seedRun('update', PW_SELECTION, { plugins: JSON.stringify([...CORE_ROWS, ROW('playwright-chrome@envoydev')]), args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: \nplaywright-enabled: \n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(all.calls), []);
    assert.match(all.result, /^playwright-browsers: $/m);
});

// Minor 2: blind, an engine the settings file names is present - at the scope whose file names it -
// and gets `update`, never the install verb that would turn it back on (S28).
test('seed install on a listing it cannot read: an engine the settings name is updated where it lives, never installed', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', PW_SELECTION, {
        plugins: 'not json', args: ['--playwright-browsers', 'chrome,firefox,webkit'],
        prepare: (repo, work) =>
        {
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'playwright-chrome@envoydev': false } }));
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', 'settings.json'), JSON.stringify({ enabledPlugins: { 'playwright-firefox@envoydev': true } }));
        },
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update playwright-chrome@envoydev --scope project -y',
        'plugin update playwright-firefox@envoydev --scope user -y',
        'plugin install playwright-webkit@envoydev --scope project -y',
    ], 'an engine the settings show installed got the install verb');
    assert.match(out, /playwright: the plugin listing could not be read - the stamp or the settings name chrome,firefox as installed \(updated in place\); the rest install as new/);
});

// The in-process sandbox the two hooks-route interruption tests share (NM1, N4): a git project, a
// recording `claude` stub listing the core and the three locked servers, dead uvx/npx/npm/curl, and
// the entry's own `main` (per install-args.test.js's precedent), so a genuine fault can be raised
// mid-run and caught by main's own outer try/catch exactly as a real crash would be.
const HOOK_ENGINES = ['docs.js', 'memory.js', 'history.js', 'model-windows.json'];
function hooksRouteSandbox(prefix, selection = 'skill markdown-style\n')
{
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const { main } = require('./install/alfred-code.js');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const pluginsFile = path.join(work, 'plugins.json');
    fs.writeFileSync(pluginsFile, JSON.stringify(['alfred-code', 'serena', 'context7', 'memory']
        .map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true }))));
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
    for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const selFile = path.join(work, 'sel.txt');
    fs.writeFileSync(selFile, selection);
    const env = {
        HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: pluginsFile,
    };
    const copyEnv = { ...env, ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' };
    const hooksDir = path.join(repo, '.claude', 'hooks');
    return {
        work, repo, env, copyEnv, hooksDir,
        run: (action, runEnv, out = () => {}) => main([...action, '--selection', selFile, '--source', ROOT], runEnv, { out, err: () => {}, cwd: repo }),
        stamp: () => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
        onDisk: () => fs.readdirSync(hooksDir).sort(),
        hooksOff: () =>
        {
            const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
            return String((settings.env && settings.env.ALFRED_CODE_HOOKS_OFF) || '').split(',').filter(Boolean);
        },
        cleanup: () => fs.rmSync(work, { recursive: true, force: true }),
    };
}

// NM1 (fix round 3): the route line was written only at the very END of a run, after
// installHooksAndRules had already pruned the other route's copies - a run that died in between left
// a STALE route over a folder the prune had already emptied. The fault is raised from the log sink
// right after the prune's own log lines - the same effect a real process death would have.
test('seed: a throw right after the hooks prune still leaves the stamp\'s hooks-route in sync, never stale (NM1)', POSIX_ONLY, () =>
{
    const s = hooksRouteSandbox('nm1-');
    try
    {
        // Step 1: install on the COPY route - every stack hook lands on disk, the stamp says 'copy'.
        assert.strictEqual(s.run(['install'], s.copyEnv), 0, 'the setup install failed');
        assert.match(s.stamp(), /^hooks-route: copy$/m);
        assert.ok(s.onDisk().some((f) => !HOOK_ENGINES.includes(f)), 'setup did not copy any stack hook');

        // Step 2: update on the PLUGIN route (default) - interrupted by a thrown fault the instant the
        // hooks prune's OWN follow-up copy step logs its first line ('current:' or 'installed ->',
        // copy.installFromSource's two), i.e. strictly after both prune calls have run to completion.
        const r2 = s.run(['update', '--installed-only'], s.env,
            (line) => { if (/ hook (current: |installed -> )/.test(line)) throw new Error('FAULT: simulated death right after the hooks prune'); });
        assert.strictEqual(r2, 1, 'the interrupted run must fail, not silently finish past the fault');
        assert.deepStrictEqual(s.onDisk(), [...HOOK_ENGINES].sort(), 'the prune itself must have completed before the fault fired');

        // The route line the interrupted run left behind must ALREADY say 'plugin' - the folder is
        // empty of stack hooks (this run's own reality), never the previous run's stale 'copy'.
        assert.match(s.stamp(), /^hooks-route: plugin$/m,
            'NM1: an interrupted run left a stale hooks-route over a folder its own prune had emptied');

        // Step 3: a genuine copy-route update --installed-only next must read the marker it actually
        // left (plugin/unknown), never mistake the empty folder for a real copy-route None.
        let out3 = '';
        assert.strictEqual(s.run(['update', '--installed-only'], s.copyEnv, (line) => { out3 += line; }), 0, out3);
        const off = s.hooksOff();
        assert.deepStrictEqual(off, [], `NM1: the interrupted run's stale marker read back as a false None (every hook off): ${off.join(',')}`);
    }
    finally { s.cleanup(); }
});

// m9 (fix round 5): the plugin route's early mark stands in for the prune's evidence, so it is written
// only when a stack hook copy is there to prune. A full-copy-route None has none: marking 'plugin' over
// it, then dying, made the next copy-route read switch every hook back on.
test('seed: a copy-route None survives a plugin-route run that dies after the mark point (m9)', POSIX_ONLY, () =>
{
    const s = hooksRouteSandbox('m9-', 'skill markdown-style\nhook none\n');
    const fullCopy = { ...s.env, ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const stackHooks = () => s.onDisk().filter((f) => !HOOK_ENGINES.includes(f) && !['hook-prelude.js', 'fresh-session.js'].includes(f));
    try
    {
        // Step 1: the full copy route with the user's None - the stamp says 'copy', no stack hook copied.
        assert.strictEqual(s.run(['install'], fullCopy), 0, 'the setup install failed');
        assert.match(s.stamp(), /^hooks-route: copy$/m);
        assert.deepStrictEqual(stackHooks(), [], 'the None copied a hook');

        // Step 2: a plugin-route update that dies at its first engine copy - past the mark point.
        const r2 = s.run(['update', '--installed-only'], s.env,
            (line) => { if (/ hook (current: |installed -> )/.test(line)) throw new Error('FAULT: simulated death after the mark point'); });
        assert.strictEqual(r2, 1, 'the interrupted run must fail');
        assert.match(s.stamp(), /^hooks-route: copy$/m, 'm9: the mark overwrote a None that had no copy to prune');

        // Step 3: back on the full copy route, the None holds.
        let out3 = '';
        assert.strictEqual(s.run(['update', '--installed-only'], fullCopy, (line) => { out3 += line; }), 0, out3);
        assert.deepStrictEqual(stackHooks(), [], `m9: the None came back as every hook on: ${stackHooks().join(',')}`);
    }
    finally { s.cleanup(); }
});

// m8 (fix round 5): a plugin -> copy run that dies after SOME hook copies leaves a partial folder under
// a stamp that still says 'plugin'. The next copy-route read took those files as the user's picks and
// switched the rest off (12 of 17 in the reviewer's probe). Until a copy run finishes they are no
// record: the stored ALFRED_CODE_HOOKS_OFF is read instead (R55), else every hook is on. m12 (Task 16b):
// on both copy routes - the full one records its picks as the copies alone, so there the disk says it.
test('seed: a plugin-to-copy run that dies after some hook copies never reads the partial folder as picks (m8)', POSIX_ONLY, () =>
{
    const OFF = ['guard-answer-length', 'instrument-tool-usage'];
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((e) => e.split('::')[0].replace(/\.js$/, '')))];
    const kept = shipped.filter((h) => !OFF.includes(h));
    for (const route of ['mixed', 'full copy'])
        for (const [label, selection, wantOff] of [
            ['nothing stored', 'skill markdown-style\n', []],
            ['two stored off', `skill markdown-style\n${kept.map((h) => `hook ${h}\n`).join('')}`, OFF],
        ])
        {
            const s = hooksRouteSandbox('m8-', selection);
            const copyEnv = route === 'mixed' ? s.copyEnv : { ...s.copyEnv, ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
            const offOnDisk = () => shipped.filter((h) => !s.onDisk().includes(`${h}.js`)).sort();
            const what = `${route}, ${label}`;
            try
            {
                // Step 1: install on the PLUGIN route - the stamp says 'plugin', the off list is stored.
                assert.strictEqual(s.run(['install'], s.env), 0, `${what}: the setup install failed`);
                assert.deepStrictEqual(s.hooksOff().sort(), [...wantOff].sort(), `${what}: setup`);

                // Step 2: a copy-route update that dies right after its fifth hook copy lands.
                let copies = 0;
                const r2 = s.run(['update', '--installed-only'], copyEnv,
                    (line) => { if (/ hook installed -> /.test(line) && ++copies === 5) throw new Error('FAULT: simulated death after five hook copies'); });
                assert.strictEqual(r2, 1, `${what}: the interrupted run must fail`);
                assert.strictEqual(s.onDisk().filter((f) => !HOOK_ENGINES.includes(f)).length, 5, `${what}: five hook copies must have landed`);
                assert.match(s.stamp(), /^hooks-route: plugin$/m);

                // Step 3: a genuine copy-route update --installed-only keeps exactly the stored off list -
                // in the stored list on the mixed route, in the copies on the full one.
                let out3 = '';
                assert.strictEqual(s.run(['update', '--installed-only'], copyEnv, (line) => { out3 += line; }), 0, out3);
                assert.deepStrictEqual(offOnDisk(), [...wantOff].sort(), `m8 (${what}): the partial copy was read as the user's picks`);
                if (route === 'mixed') assert.deepStrictEqual(s.hooksOff().sort(), [...wantOff].sort(), `m8 (${what}): the stored list`);
            }
            finally { s.cleanup(); }
        }
});

// N7 (Task 16b): the full copy route writes ALFRED_CODE_HOOKS_OFF '' at the end of the hooks layer (no
// core, the copies are the record), while its `hooks-route: copy` line waited for the final stamp. A
// run that died in between left FINISHED copies under a stale 'plugin' line, and m8's set-aside then read
// the blanked list: every hook back on. The line is now patched as soon as the hook copies land. Both
// copy routes, dying on the memory import's line - the first step after the hooks layer.
test('seed: a copy-route run that dies after the hooks layer keeps the user\'s hook picks, never every hook (N7)', POSIX_ONLY, () =>
{
    const OFF = ['guard-answer-length', 'instrument-tool-usage'];
    const { loadManifest } = require('./install/manifest.js');
    const kept = [...new Set(loadManifest(ROOT).catalogs.hooks.map((e) => e.split('::')[0].replace(/\.js$/, '')))].filter((h) => !OFF.includes(h));
    for (const route of ['full copy', 'mixed'])
    {
        const s = hooksRouteSandbox('n7-', `skill markdown-style\n${kept.map((h) => `hook ${h}\n`).join('')}`);
        const copyEnv = route === 'mixed' ? s.copyEnv : { ...s.copyEnv, ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
        const hooksOnDisk = () => s.onDisk().filter((f) => f.endsWith('.js') && kept.concat(OFF).includes(f.replace(/\.js$/, ''))).map((f) => f.replace(/\.js$/, '')).sort();
        try
        {
            assert.strictEqual(s.run(['install'], s.env), 0, `${route}: the setup install failed`);
            assert.deepStrictEqual(s.hooksOff().sort(), [...OFF].sort(), `${route}: setup`);

            // Step 2: every hook copy and the settings write land, then the run dies.
            const r2 = s.run(['update', '--installed-only'], copyEnv,
                (line) => { if (/memory notes import|notes import was skipped|notes import waits|^memory: /.test(line)) throw new Error('FAULT: simulated death after the hooks layer'); });
            assert.strictEqual(r2, 1, `${route}: the interrupted run must fail`);
            assert.deepStrictEqual(hooksOnDisk(), [...kept].sort(), `${route}: the hooks layer did not finish`);
            if (route === 'full copy') assert.deepStrictEqual(s.hooksOff(), [], 'the full copy route blanks the stored list - the precondition');
            assert.match(s.stamp(), /^hooks-route: copy$/m, `N7 (${route}): the finished copies were left under a stale route line`);

            // Step 3: the next copy-route update keeps exactly the 15 the user picked.
            let out3 = '';
            assert.strictEqual(s.run(['update', '--installed-only'], copyEnv, (line) => { out3 += line; }), 0, out3);
            assert.deepStrictEqual(hooksOnDisk(), [...kept].sort(), `N7 (${route}): the two hooks the user switched off came back`);
        }
        finally { s.cleanup(); }
    }
});

// N4 (fix round 4): NM1's mirror. The early mark once wrote 'copy' too, before any hook copy had
// landed - so a plugin -> copy run that died before its first copy left 'hooks-route: copy' over a
// folder holding no stack hook, and the next copy-route update read that as the user's own None and
// switched every hook off. The fault is deterministic: a read-only .claude/hooks makes the first
// hook copy throw EACCES.
test('seed: a plugin-to-copy run that dies before the first hook copy never reads back as every hook off (N4)', POSIX_ONLY, () =>
{
    const s = hooksRouteSandbox('n4-');
    try
    {
        // Step 1: install on the PLUGIN route - the stamp says 'plugin', only the engines are on disk.
        assert.strictEqual(s.run(['install'], s.env), 0, 'the setup install failed');
        assert.match(s.stamp(), /^hooks-route: plugin$/m);
        assert.deepStrictEqual(s.onDisk(), [...HOOK_ENGINES].sort(), 'the plugin route copies only the engines');

        // Step 2: update on the COPY route, dying at the first hook copy.
        fs.chmodSync(s.hooksDir, 0o555);
        let r2;
        try { r2 = s.run(['update', '--installed-only'], s.copyEnv); }
        finally { fs.chmodSync(s.hooksDir, 0o755); }
        assert.strictEqual(r2, 1, 'the interrupted run must fail, not silently finish past the fault');
        assert.deepStrictEqual(s.onDisk(), [...HOOK_ENGINES].sort(), 'no stack hook may have landed before the fault');
        assert.match(s.stamp(), /^hooks-route: plugin$/m,
            'N4: an interrupted run marked the copy route before a single hook copy had landed');

        // Step 3: a genuine copy-route update --installed-only must keep every hook on.
        let out3 = '';
        assert.strictEqual(s.run(['update', '--installed-only'], s.copyEnv, (line) => { out3 += line; }), 0, out3);
        const off = s.hooksOff();
        assert.deepStrictEqual(off, [], `N4: an interrupted plugin-to-copy run read back as a None (every hook off): ${off.join(',')}`);
    }
    finally { s.cleanup(); }
});
