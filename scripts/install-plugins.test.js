'use strict';
// THE PLUGIN LAYER OF THE NODE SEED - Phase 7, T3.
//
// The plugins ARE the delivery from Phase 3 onward, so these decisions are the install: which
// entries, at which scope, and what comes back out. The twin sandbox tests in mcp-verify.test.js
// keep proving the shell route, which still ships for one release (R1).
const test = require('node:test');
// 2.1.5 M5: two seed cases spawn the copied engines and the rm guard - no inherited stack env, entrypoint or project
// dir reaches them, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const P = require('./install/plugins.js');

// A recording CLI: every call is kept, and `fails` names the argv words that make one fail.
function cli(fails = [])
{
    const calls = [];
    const expects = [];
    const run = (argv, opts = {}) =>
    {
        calls.push(argv.join(' '));
        expects.push(opts.expect);
        return !fails.some((f) => argv.join(' ').includes(f));
    };
    run.calls = calls;
    // What each call told the runner to expect of a failure (R105): undefined means the runner prints it.
    run.expectOf = (re) => calls.map((c, i) => [c, expects[i]]).filter(([c]) => re.test(c)).map(([, e]) => e);
    run.matching = (re) => calls.filter((c) => re.test(c));
    return run;
}

const ROUTES = (over = {}) => ({ hooks: true, skills: true, mcps: true, ...over });
const COPY = ROUTES({ hooks: false, skills: false, mcps: false });
// A companion from another marketplace - a fixture: which plugin that is changes with the release (R72).
const CORE_DEPS = ['companion@elsewhere'];
const LOCKED = ['alfred-navigation', 'alfred-documentation', 'alfred-memory'];
const LOCKED_SPECS = LOCKED.map((n) => `${n}@envoydev`);

// --- the route switches ---------------------------------------------------

test('routes: every route defaults ON, and only the documented `false` turns one off', () =>
{
    assert.deepStrictEqual(P.pluginRoutes({}), { hooks: true, skills: true, mcps: true });
    assert.deepStrictEqual(P.pluginRoutes({ ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' }), { hooks: true, skills: true, mcps: false });
    assert.strictEqual(P.pluginRoutes({ ALFRED_CODE_HOOKS_VIA_PLUGIN: 'true' }).hooks, true);
});

// M7 (Task 18b fix round 1): each switch is read under its ALFRED_CODE_ name alone, and an empty value
// is unset - the route stays on.
test('routes: each switch turns off its own route, and an empty value reads as unset (M7)', () =>
{
    assert.deepStrictEqual(P.pluginRoutes({ ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' }),
        { hooks: false, skills: false, mcps: false });
    assert.deepStrictEqual(P.pluginRoutes({ ALFRED_CODE_HOOKS_VIA_PLUGIN: '', ALFRED_CODE_SKILLS_VIA_PLUGIN: '', ALFRED_CODE_MCPS_VIA_PLUGIN: '' }),
        { hooks: true, skills: true, mcps: true });
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

test('plugin-list: a Windows projectPath matches this project whatever its letter case, and another project still does not (W-1)', () =>
{
    const json = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '2.0.0', scope: 'project', projectPath: 'c:\\WINDOWS\\SystemTemp\\p\\repo' },
        { id: 'alfred-navigation@envoydev', version: '2.0.0', scope: 'project', projectPath: 'C:/Windows/SystemTemp/p/repo/' },
        { id: 'alfred-memory@envoydev', version: '2.0.0', scope: 'project', projectPath: 'C:\\Windows\\SystemTemp\\p\\other' },
    ]);
    const rows = P.parsePluginList(json, 'C:\\Windows\\SystemTemp\\p\\repo', { everyScope: true });
    assert.deepStrictEqual(rows.map((r) => r.name), ['alfred-code', 'alfred-navigation']);
    // a POSIX path keeps its exact spelling: another case is another directory there
    assert.deepStrictEqual(P.parsePluginList(JSON.stringify([{ id: 'a@m', scope: 'project', projectPath: '/Repo' }]), '/repo'), []);
});

test('plugin-list: a marketplace filter runs BEFORE the per-name pick - a same-named foreign row never wins', () =>
{
    const json = JSON.stringify({ installed: [
        { id: 'alfred-navigation@claude-plugins-official', version: '9', scope: 'project', enabled: true, projectPath: '/repo' },
        { id: 'alfred-navigation@envoydev', version: '1', scope: 'user', enabled: true },
    ] });
    assert.deepStrictEqual(P.parsePluginList(json, '/repo', { marketplace: 'envoydev' }).map((r) => r.version), ['1']);
    assert.deepStrictEqual(P.parsePluginList(json, '/repo').map((r) => r.marketplace), ['claude-plugins-official']);
    // byMarketplace: one row per name@marketplace, so a pass over specs from BOTH reads each its own
    const both = P.parsePluginList(json, '/repo', { byMarketplace: true });
    assert.deepStrictEqual(both.map((r) => `${r.name}@${r.marketplace} ${r.version}`), ['alfred-navigation@claude-plugins-official 9', 'alfred-navigation@envoydev 1']);
    assert.strictEqual(P.fieldOf(both, 'alfred-navigation@envoydev', 'version'), '1');
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
    const mcps = ['alfred-navigation|x', 'alfred-documentation|@HTTP@'];
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES(), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer', 'mcp alfred-navigation', 'mcp alfred-documentation']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ mcps: false }), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ skills: false }), skills, agents, mcps }),
        ['mcp alfred-navigation', 'mcp alfred-documentation']);
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
    const hooksOnly = P.pluginSet({ routes: ROUTES({ skills: false, mcps: false }), stackEntries: [], coreDeps: CORE_DEPS, locked: LOCKED, market: KEY });
    assert.deepStrictEqual(hooksOnly, [`alfred-code@${KEY}`, ...LOCKED.map((n) => `${n}@${KEY}`), ...CORE_DEPS], 'the core leads, spelled with the run\'s key');
});

// --- scope ----------------------------------------------------------------

test('scope: an optional item goes where the user chose (default the run\'s scope), and the LISTING wins when it can speak', () =>
{
    // 2.2.0: claude-hud is no longer pinned to user scope - the user's ruling of 2026-10-06, 'Project for all'.
    assert.strictEqual(P.scopeFor('claude-hud@m', 'project', []), 'project');
    assert.strictEqual(P.scopeFor('claude-hud@m', 'project', [], { 'claude-hud': 'user' }), 'user');
    assert.strictEqual(P.scopeFor('claude-hud@m', 'local', [], { 'claude-hud': 'project' }), 'local', 'project means this project, at the run\'s scope');
    assert.strictEqual(P.scopeFor('claude-hud@m', 'user', [], { 'claude-hud': 'project' }), 'project', 'a user-scope run puts a project choice at project scope');
    assert.strictEqual(P.scopeFor('claude-hud@m', 'project', [{ name: 'claude-hud', marketplace: 'm', version: '1', scope: 'user', enabled: true }], { 'claude-hud': 'project' }), 'user', 'an existing row is kept where it is - only moveScoped moves it');
    assert.strictEqual(P.scopeFor('claude-hud@m', 'user', []), 'project', 'an optional item on a user-scope run defaults to this project');
    assert.strictEqual(P.scopeFor('browser-chrome@envoydev', 'user', []), 'project');
    assert.strictEqual(P.scopeFor('alfred-navigation@envoydev', 'user', []), 'user', 'a required item follows the run');
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
        'plugin install claude-hud@m --scope project -y',
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
    // The official marketplace ships plugins named like stack entries (`serena`, `sentry`, `playwright`
    // collided before the 2.0.0 rename); a same-named one stands in for them here. A name-only read took
    // their row for ours, and an update at THEIR scope is a silent no-op on ours.
    const official = { name: 'alfred-navigation', marketplace: 'claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true };
    const fresh = cli();
    P.installPlugins({ plugins: ['alfred-navigation@envoydev'], scope: 'project', before: [official], cli: fresh });
    assert.deepStrictEqual(fresh.matching(/^plugin update /), [], 'the stack serena was not installed before - nothing to update');
    const both = cli();
    const ours = { name: 'alfred-navigation', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true };
    P.installPlugins({ plugins: ['alfred-navigation@envoydev'], scope: 'user', before: [official, ours], cli: both });
    assert.deepStrictEqual(both.matching(/^plugin update /), ['plugin update alfred-navigation@envoydev --scope project -y']);
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
            { name: 'alfred-navigation', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
            { name: 'alfred-navigation', marketplace: 'claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true },
            { name: 'alfred-code-hooks', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        ],
        cli: run, refreshed,
    });
    assert.deepStrictEqual(run.calls, [
        'plugin marketplace add envoydev/alfred-code',
        'plugin marketplace update envoydev',
        'plugin update alfred-code@envoydev --scope user -y',
        'plugin update alfred-navigation@envoydev --scope project -y',
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

test('retired: an uninstall still refused after the retry pass is noted with its command, never left silent (R105)', () =>
{
    const run = cli(['uninstall sentry@envoydev']);
    const notes = [];
    const gone = P.prunedRetired({ rows: [prow('sentry', 'envoydev', 'project')], retired: ['sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: run, note: (m) => notes.push(m) });
    assert.deepStrictEqual(gone, []);
    assert.strictEqual(run.matching(/uninstall/).length, 2, 'tried, then retried once');
    // The prune reports its own leftovers, so the runner is told not to print each refusal as well.
    assert.deepStrictEqual(run.expectOf(/uninstall/), ['reported', 'reported']);
    assert.deepStrictEqual(notes, ['plugin uninstall failed: sentry@envoydev - remove it by hand: claude plugin uninstall sentry@envoydev --scope project']);
});

test('R105: a call whose failure the caller notes itself is marked reported; one nobody reports is left to the runner', () =>
{
    const notes = [];
    const run = cli(['plugin install', 'plugin disable']);
    P.installPlugins({ plugins: ['x@mp', 'browser-webkit@envoydev'], scope: 'project', engines: { specs: [], present: [], presentScope: {}, off: ['browser-webkit@envoydev'], on: null, isOn: () => undefined }, cli: run, note: (m) => notes.push(m) });
    assert.deepStrictEqual(run.expectOf(/^plugin install /), ['reported', 'reported']);
    assert.deepStrictEqual(run.expectOf(/^plugin marketplace (add|update) /).filter(Boolean), [], 'a marketplace call is never silenced');
    assert.deepStrictEqual(notes, ['plugin x@mp failed', 'plugin browser-webkit@envoydev failed']);
    const up = cli(['plugin install']);
    P.updatePlugins({ plugins: ['y@mp'], scope: 'project', cli: up, after: [] });
    assert.deepStrictEqual(up.expectOf(/^plugin (install|update) /), [undefined, undefined], 'update notes no failed install itself - the runner prints it');
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

test('retired: an install under another key spells the retired name with ITS key, never the default one', () =>
{
    const run = cli();
    const rows = [prow('angular-cli', KEY, 'project'), prow('angular-cli', 'envoydev', 'project')];
    P.prunedRetired({ rows, retired: ['angular-cli'], retiredRows: RETIRED_ROWS, market: KEY, scope: 'project', cli: run });
    assert.deepStrictEqual(run.matching(/uninstall/), [`plugin uninstall angular-cli@${KEY} --scope project -y`]);
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

test('retired: a project or local row of THIS project goes whatever the run scope - only a user row is shared', () =>
{
    const run = cli();
    const logs = [];
    const rows = [prow('sentry', 'envoydev', 'local'), prow('ponytail', 'ponytail', 'project'), prow('angular-cli', 'envoydev', 'user')];
    const gone = P.prunedRetired({ rows, retired: ['sentry', 'ponytail', 'angular-cli'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'local', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone.sort(), ['ponytail', 'sentry']);
    assert.deepStrictEqual(run.matching(/uninstall/).sort(), ['plugin uninstall ponytail@ponytail --scope project -y', 'plugin uninstall sentry@envoydev --scope local -y']);
    assert.ok(logs.some((m) => /add it back: claude plugin install sentry@claude-plugins-official --scope local/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /angular-cli@envoydev is installed at user scope/.test(m)), logs.join(' | '));
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
    // 2.2.0: an absent one goes where the user chose - this project by default, the account on `--scope-of claude-hud=user`.
    const absent = cli();
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', before: [], cli: absent });
    assert.deepStrictEqual(absent.matching(/claude-hud@/), ['plugin install claude-hud@claude-hud --scope project -y']);
    const account = cli();
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', scopes: { 'claude-hud': 'user' }, before: [], cli: account });
    assert.deepStrictEqual(account.matching(/claude-hud@/), ['plugin install claude-hud@claude-hud --scope user -y']);
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

const PW = ['browser-chrome@envoydev', 'browser-firefox@envoydev'];
const ENG = (over = {}) => ({ specs: PW, present: [], presentScope: {}, off: [], on: null, isOn: () => undefined, ...over });
const PW_MOVES = /^plugin (install|disable|enable|update|uninstall) browser-/;

test('install: a new engine is installed, and disabled right after only when the user chose it off', () =>
{
    const run = cli();
    P.installPlugins({ plugins: ['alfred-code@envoydev', ...PW], scope: 'project', engines: ENG({ off: ['browser-firefox@envoydev'] }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
    ]);
    assert.deepStrictEqual(run.matching(/^plugin disable alfred-code/), [], 'only an engine chosen off is disabled');
});

test('install: an engine already installed never gets the install verb - it would switch a disabled one back on (S28)', () =>
{
    const run = cli();
    const before = [
        { name: 'browser-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'browser-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: false },
    ];
    P.installPlugins({ plugins: PW, scope: 'project', before, engines: ENG(), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope user -y',
    ], 'an installed engine was installed over, or its flag was flipped with no answer to apply');
});

test('install: on a listing it could not read, an engine the stamp names is present - updated, never installed over', () =>
{
    const run = cli();
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ present: ['browser-chrome@envoydev'], off: PW }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
    ], 'a present engine was installed over or disabled - off is for an engine this run installs');
});

// Round 2, minor 2: blind, the settings file is a presence signal too - install writes the engine's
// enabledPlugins key and uninstall removes it (S28) - so an engine it names is updated where it lives.
test('install: on a listing it could not read, an engine present at user scope is updated there, never installed', () =>
{
    const run = cli();
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ present: PW, presentScope: { 'browser-firefox@envoydev': 'user' } }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope user -y',
    ]);
});

test('install: the user\'s answer is applied to the installed engines - a switch already made is skipped, one at another scope is named', () =>
{
    const run = cli();
    const before = [
        { name: 'browser-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'browser-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'browser-webkit', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: true },
    ];
    const specs = [...PW, 'browser-webkit@envoydev'];
    const logs = [];
    const isOn = (spec) => ({ 'browser-chrome@envoydev': true, 'browser-firefox@envoydev': true })[spec];
    P.installPlugins({ plugins: specs, scope: 'project', before, engines: ENG({ specs, on: ['browser-chrome@envoydev'], off: specs.slice(1), isOn }), cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
        'plugin update browser-webkit@envoydev --scope user -y',
    ], 'chrome is on already (no enable that exits 1), firefox is switched off, a user-scope engine is left there');
    assert.ok(logs.some((m) => /browser-webkit@envoydev is installed at user scope, not this run's .*claude plugin disable browser-webkit@envoydev --scope user/.test(m)), logs.join(' | '));
    // Unknown state (no settings entry): the switch is made, and a refusal is noted with its command.
    const notes = [];
    P.installPlugins({ plugins: PW, scope: 'project', before, engines: ENG({ on: PW }), cli: cli(['enable browser-firefox']), note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin enable failed: browser-firefox@envoydev .*claude plugin enable browser-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('install: a failed engine install runs no disable, and a failed disable is noted with its hand command', () =>
{
    const failed = cli(['install browser-chrome']);
    const notes = [];
    P.installPlugins({ plugins: PW, scope: 'user', engines: ENG({ off: PW }), cli: failed, note: (m) => notes.push(m) });
    // A user-scope run puts a fresh engine in this project (2.2.0: global only when chosen per item).
    assert.deepStrictEqual(failed.matching(/^plugin disable /), ['plugin disable browser-firefox@envoydev --scope project']);
    const stuck = cli(['disable browser-firefox']);
    P.installPlugins({ plugins: PW, scope: 'project', engines: ENG({ off: PW }), cli: stuck, note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin disable failed: browser-firefox@envoydev.*claude plugin disable browser-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('update: an installed engine is updated in place and never flipped with no answer; an absent one comes back as last chosen', () =>
{
    const run = cli();
    const before = [
        { name: 'browser-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: true },
        { name: 'browser-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
    ];
    const specs = [...PW, 'browser-webkit@envoydev'];
    const report = P.updatePlugins({ plugins: specs, scope: 'project', before, after: before, engines: ENG({ specs, off: ['browser-webkit@envoydev'] }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
        'plugin install browser-webkit@envoydev --scope project -y',
        'plugin disable browser-webkit@envoydev --scope project',
        'plugin update browser-webkit@envoydev --scope project -y',
    ]);
    assert.ok(!report.some((l) => /DISABLED|claude plugin enable/.test(l)), `an engine left off was reported as something to enable: ${report.join(' | ')}`);
    // A parked plugin that is NOT an engine is still enabled, as before.
    const other = cli();
    P.updatePlugins({ plugins: ['browser-firefox@envoydev'], scope: 'project', before, after: before, cli: other });
    assert.deepStrictEqual(other.matching(/^plugin enable /), ['plugin enable browser-firefox@envoydev --scope project']);
});

test('update: an engine installed at ANOTHER scope is updated at that scope, and an absent one is disabled where it went', () =>
{
    const run = cli();
    const before = [{ name: 'browser-chrome', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: false }];
    P.updatePlugins({ plugins: PW, scope: 'project', before, after: before, engines: ENG({ off: PW }), cli: run });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin update browser-chrome@envoydev --scope user -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
        'plugin update browser-firefox@envoydev --scope project -y',
    ]);
});

// An engine the last install installed and this run no longer keeps is UNINSTALLED at this run's
// scope (I2) - left installed it reads back as listed and is kept again by the next update.
test('uninstall: an engine no longer kept goes at this scope; one at another scope is named; one not installed is nothing', () =>
{
    const run = cli();
    const logs = [];
    const rows = [
        { name: 'browser-firefox', marketplace: 'envoydev', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'browser-webkit', marketplace: 'envoydev', version: '1.0.0', scope: 'user', enabled: true },
        { name: 'browser-firefox', marketplace: 'claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
    ];
    const gone = P.uninstallEngines({ specs: ['browser-firefox@envoydev', 'browser-webkit@envoydev', 'browser-msedge@envoydev'], rows, scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), ['plugin uninstall browser-firefox@envoydev --scope project -y']);
    assert.deepStrictEqual(gone, ['browser-firefox@envoydev']);
    assert.ok(logs.some((m) => /^plugin uninstalled \[project\]: browser-firefox@envoydev/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /browser-webkit@envoydev is installed at user scope, not this run's .*claude plugin uninstall browser-webkit@envoydev --scope user/.test(m)), logs.join(' | '));
    const notes = [];
    P.uninstallEngines({ specs: ['browser-firefox@envoydev'], rows, scope: 'project', cli: cli(['uninstall']), note: (m) => notes.push(m) });
    assert.ok(notes.some((m) => /plugin uninstall failed: browser-firefox@envoydev .*claude plugin uninstall browser-firefox@envoydev --scope project/.test(m)), notes.join(' | '));
});

test('uninstall: on a listing it could not read, the uninstall is tried at this scope, and a refusal is said, never counted', () =>
{
    const run = cli(['uninstall browser-webkit']);
    const logs = [];
    const notes = [];
    const gone = P.uninstallEngines({ specs: ['browser-firefox@envoydev', 'browser-webkit@envoydev'], rows: [], blind: true, scope: 'project', cli: run, log: (m) => logs.push(m), note: (m) => notes.push(m) });
    assert.deepStrictEqual(run.matching(PW_MOVES), [
        'plugin uninstall browser-firefox@envoydev --scope project -y',
        'plugin uninstall browser-webkit@envoydev --scope project -y',
    ]);
    assert.deepStrictEqual(gone, ['browser-firefox@envoydev']);
    assert.deepStrictEqual(notes, [], 'an engine already gone is no failure');
    assert.ok(logs.some((m) => /browser-webkit@envoydev: not uninstalled - the plugin listing could not be read.*claude plugin uninstall browser-webkit@envoydev --scope project/.test(m)), logs.join(' | '));
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

// 2.2.0 (the user's ruling of 2026-10-06, superseding R27): claude-hud is an OPTIONAL pick, recommended - the
// walk marks it - at the scope the user chose, this project by default. The LSP pair are optional picks too
// (2.0.0 retired the other two), and so is superpowers (R72): a selection naming none of them installs none.
const OPTIONAL = ['csharp-lsp', 'typescript-lsp', 'claude-hud'];

test('seed install: a selection naming no plugin installs none - claude-hud included', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n');
    for (const name of [...OPTIONAL, 'superpowers'])
        assert.ok(!calls.some((c) => c.startsWith(`plugin install ${name}@`)), `${name} is optional, yet a selection naming no plugin installed it:\n${calls.join('\n')}`);
    assert.ok(!calls.includes('plugin marketplace add jarrodwatts/claude-hud'), 'its marketplace is registered only for an install');
});

test('seed install: a picked claude-hud goes to this project by default, its marketplace first, and to the account on --scope-of claude-hud=user', POSIX_ONLY, () =>
{
    for (const [args, scope] of [[[], 'project'], [['--scope-of', 'claude-hud=user'], 'user'], [['--scope-of', 'claude-hud=global'], 'user']])
    {
        const { calls } = seedRun('install', HUD_SELECTION, { args });
        const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
        const inst = calls.indexOf(`plugin install claude-hud@claude-hud --scope ${scope} -y`);
        assert.ok(inst >= 0, `${args.join(' ')}: claude-hud was not installed at ${scope} scope:\n${calls.join('\n')}`);
        assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
        assert.strictEqual(calls.filter((c) => /^plugin install claude-hud@/.test(c)).length, 1, calls.join('\n'));
    }
});

test('seed install: a selection that still names claude-hud installs it once, and an optional pick it names is installed', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', `${HUD_SELECTION}plugin csharp-lsp\n`);
    assert.strictEqual(calls.filter((c) => /^plugin install claude-hud@/.test(c)).length, 1, calls.join('\n'));
    assert.ok(calls.includes('plugin install csharp-lsp@claude-plugins-official --scope project -y'), calls.join('\n'));
});

// An older install carries whichever optional plugins its walk picked, and may lack claude-hud: optional is
// not retired, so the read-back keeps each one it finds and adds none (claude-hud is a pick since 2.2.0) -
// while a pick 2.0.0 retired leaves this scope, never updated.
test('seed update --installed-only: an older install keeps its optional plugins, loses a retired one and gains no claude-hud', POSIX_ONLY, () =>
{
    const row = (id, extra = {}) => ({ id, version: '1.0.0', scope: 'project', enabled: true, ...extra });
    const listing = JSON.stringify([
        row('alfred-code@envoydev', { version: '1.3.0' }),
        ...['alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@envoydev`, { version: '1.3.0' })),
        row('superpowers@claude-plugins-official', { scope: 'user' }),
        row('security-guidance@claude-plugins-official'),
        row('csharp-lsp@claude-plugins-official'),
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'version: 1.3.0\nsha: 0000000\n');
    };
    const { calls } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only'], prepare });
    assert.ok(calls.includes('plugin update csharp-lsp@claude-plugins-official --scope project -y'), `csharp-lsp was not kept:\n${calls.join('\n')}`);
    assert.ok(!calls.some((c) => c.startsWith('plugin uninstall csharp-lsp@') || c.startsWith('plugin disable csharp-lsp@')), `csharp-lsp was taken out:\n${calls.join('\n')}`);
    assert.ok(calls.includes('plugin uninstall security-guidance@claude-plugins-official --scope project -y'), `the retired pick stayed:\n${calls.join('\n')}`);
    assert.ok(!calls.includes('plugin update security-guidance@claude-plugins-official --scope project -y'), `the retired pick was updated:\n${calls.join('\n')}`);
    for (const name of ['claude-md-management', 'typescript-lsp'])
        assert.ok(!calls.some((c) => c.startsWith(`plugin install ${name}@`)), `${name} was never picked, yet the update installed it:\n${calls.join('\n')}`);
    assert.ok(!calls.some((c) => /^plugin install claude-hud@/.test(c)), `the update added claude-hud, which the install never picked:\n${calls.join('\n')}`);
});

// configure's keep-parked line for a disabled claude-hud reaches the installer as a --drop: the run
// keeps it off, and an install (which re-enables, measured) or an enable never touches it.
test('seed update --installed-only: a claude-hud the user disabled stays off, with or without configure\'s keep-parked --drop', POSIX_ONLY, () =>
{
    const row = (id, extra = {}) => ({ id, version: '2.0.0', scope: 'project', enabled: true, ...extra });
    const listing = JSON.stringify([
        ...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@envoydev`)),
        row('superpowers@claude-plugins-official', { version: '6.4.1', scope: 'user' }),
        row('claude-hud@claude-hud', { version: '0.8.0', scope: 'user', enabled: false }),
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
    };
    for (const args of [['--installed-only'], ['--installed-only', '--drop', 'plugin claude-hud']])
    {
        const { calls } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args, prepare });
        // A disabled one is no read-back pick (2.2.0), so the run leaves it as it is - never installed or enabled.
        const hud = calls.filter((c) => /^plugin (install|enable|update|uninstall|disable) claude-hud@/.test(c));
        assert.deepStrictEqual(hud.filter((c) => !/^plugin update /.test(c)), [], `${args.join(' ')}:\n${calls.join('\n')}`);
    }
});

// R109: superpowers is no stack pick any more. It lives in another marketplace, so this is no
// retirement (R32): no run installs, refreshes, disables or uninstalls it - an installed copy is the
// user's own - and a pick of it (a selection line, an --add, the copy an older install picked) is
// dropped with ONE line. The listed copy is named on the first update past 2.0.0 only.
const SP = 'superpowers@claude-plugins-official';
const spTouched = (calls, verbs) => calls.filter((c) => new RegExp(`^plugin (${verbs}) ${SP}( |$)`).test(c));
const SP_ANY = 'install|enable|update|uninstall|disable';
const spLines = (out) => (String(out).match(/^.*plugin superpowers: no longer a stack pick.*$/gm) || []);

test('seed install: a selection that still names superpowers installs nothing, and says so once', POSIX_ONLY, () =>
{
    const bare = seedRun('install', 'skill markdown-style\nrule markdown-docs\n');
    assert.deepStrictEqual(spTouched(bare.calls, SP_ANY), [], bare.calls.join('\n'));
    assert.deepStrictEqual(spLines(bare.out), []);
    const picked = seedRun('install', 'skill markdown-style\nrule markdown-docs\nplugin superpowers\n');
    assert.deepStrictEqual(spTouched(picked.calls, SP_ANY), [], picked.calls.join('\n'));
    assert.strictEqual(spLines(picked.out).length, 1, picked.out);
});

const spListing = (scope) => JSON.stringify([
    ...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })),
    { id: SP, version: '6.4.1', scope, enabled: true },
]);
const spPrepare = (version) => (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), `version: ${version}\nsha: 0000000\n`);
};

test('seed update --installed-only: an installed superpowers is left as the user\'s own, and named once on the first update past 2.0.0', POSIX_ONLY, () =>
{
    for (const scope of ['user', 'project'])
    {
        const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: spListing(scope), args: ['--installed-only', '--add', 'plugin superpowers'], prepare: spPrepare('1.3.0') });
        assert.deepStrictEqual(spTouched(calls, SP_ANY), [], `${scope}: the stack touched it:\n${calls.join('\n')}`);
        assert.strictEqual(spLines(out).length, 1, `${scope}: the listed copy and the --add are one line:\n${out}`);
        assert.doesNotMatch(out, /--add plugin superpowers names nothing/, 'said once, never twice');
    }
    const later = seedRun('update', 'skill markdown-style\n', { plugins: spListing('user'), args: ['--installed-only'], prepare: spPrepare('2.0.0') });
    assert.deepStrictEqual(spTouched(later.calls, SP_ANY), [], later.calls.join('\n'));
    assert.deepStrictEqual(spLines(later.out), [], 'past 2.0.0 the listed copy is simply the user\'s own');
});

test('seed update: a selection that does not name an installed superpowers leaves it installed and enabled', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: spListing('project'), prepare: spPrepare('1.3.0') });
    assert.deepStrictEqual(spTouched(calls, SP_ANY), [], calls.join('\n'));
});

test('seed update: an absent claude-hud gets its marketplace before the install', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', HUD_SELECTION);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(inst >= 0, `claude-hud was never installed:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});

test('prunedRetired retries a refused uninstall in a second pass', () =>
{
    const calls = [];
    const key = 'envoydev';
    const rows = [{ name: 'dep-leaf', marketplace: key, version: '1.2.0', scope: 'project' }, { name: 'dep-base', marketplace: key, version: '1.2.0', scope: 'project' }];
    let leafGone = false;
    const cli = (args) => { calls.push(args[2]); if (args[2] === `dep-leaf@${key}`) { leafGone = true; return true; } return leafGone; };
    const gone = P.prunedRetired({ rows, retired: ['dep-base', 'dep-leaf'], market: key, scope: 'project', cli });
    assert.deepStrictEqual(gone.sort(), ['dep-base', 'dep-leaf']);
    assert.deepStrictEqual(calls, [`dep-base@${key}`, `dep-leaf@${key}`, `dep-base@${key}`], 'the refusal is retried once, after the leaf');
});

// --- the marketplace KEY the core is listed under ----------------------------------------------------
// A registered marketplace's key never changes, and a forced move (`marketplace remove`) would uninstall
// the stack from every project on the machine. So the seed reads the key from the listing (the key whose
// core is installed) and spells every stack spec with it - here a key other than the default.
const KEY = 'other-key';
const NEW_CORE = (scope, extra = {}) => ({ name: 'alfred-code', marketplace: KEY, version: '2.0.0', scope, enabled: true, ...extra });

test('plugin-list: everyScope keeps one row per name@marketplace@scope, so a core at two scopes is two rows', () =>
{
    const rows = P.parsePluginList(JSON.stringify([
        { id: `alfred-code@${KEY}`, version: '2.0.0', scope: 'user' },
        { id: `alfred-code@${KEY}`, version: '2.0.0', scope: 'project', projectPath: '/repo' },
        { id: `alfred-code@${KEY}`, version: '2.0.0', scope: 'project', projectPath: '/other' },
    ]), '/repo', { everyScope: true });
    assert.deepStrictEqual(rows.map((r) => r.scope).sort(), ['project', 'user'], 'another project\'s row is still dropped');
});

test('source: a core under another key - that key is refreshed and every row under it updated by its OWN id', () =>
{
    const run = cli();
    const listing = [NEW_CORE('user'), { ...NEW_CORE('project'), name: 'alfred-navigation' }, { ...NEW_CORE('project'), name: 'serena', marketplace: 'claude-plugins-official' }];
    const key = P.refreshStackSource({ listing, cli: run });
    assert.strictEqual(key, KEY);
    assert.deepStrictEqual(run.calls, [
        `plugin marketplace update ${KEY}`,
        `plugin update alfred-code@${KEY} --scope user -y`,
        `plugin update alfred-navigation@${KEY} --scope project -y`,
    ], 'no registration of the default key, and no row of another marketplace');
});

test('source: a fresh account registers the stack and takes the key the add produced', () =>
{
    const run = cli();
    const key = P.refreshStackSource({ listing: [], marketplaces: [], readMarketplaces: () => [{ name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }], cli: run });
    assert.strictEqual(key, 'envoydev');
    assert.deepStrictEqual(run.calls, ['plugin marketplace add envoydev/alfred-code', 'plugin marketplace update envoydev']);
});

// Live check F1: a local or fork marketplace registered under the stack's key. The GitHub add over it is refused
// ('its network source differs from the one declared for it in settings') and the run ended on a failure line -
// the refusal is what kept the local tree, so the add is simply not made over a registration of that name.
test('source: a marketplace already registered under the stack\'s key - a local directory - is never re-added from GitHub', () =>
{
    const run = cli();
    const key = P.refreshStackSource({
        listing: [{ name: 'alfred-code', marketplace: 'envoydev', version: '2.1.0', scope: 'project', enabled: true }],
        marketplaces: [{ name: 'envoydev', source: 'directory', path: '/work/alfred-code' }],
        cli: run,
    });
    assert.strictEqual(key, 'envoydev');
    assert.ok(!run.calls.some((c) => c.startsWith('plugin marketplace add')), run.calls.join(' | '));
    assert.ok(run.calls.includes('plugin marketplace update envoydev'), run.calls.join(' | '));
});

test('source: both keys registered - the one carrying the installed core is used, the other left alone', () =>
{
    const run = cli();
    const marketplaces = [{ name: KEY, source: 'github', repo: 'envoydev/alfred-code' }, { name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }];
    const key = P.refreshStackSource({ listing: [NEW_CORE('user')], marketplaces, cli: run });
    assert.strictEqual(key, KEY);
    assert.ok(!run.calls.some((c) => / envoydev(\/|$)/.test(c)), run.calls.join(' | '));
});

test('set: the locked servers ride the run\'s marketplace key', () =>
{
    const set = P.pluginSet({ routes: ROUTES({ mcps: false }), stackEntries: [`alfred-code@${KEY}`], coreDeps: CORE_DEPS, locked: LOCKED, market: KEY });
    assert.deepStrictEqual(set, [`alfred-code@${KEY}`, ...LOCKED.map((n) => `${n}@${KEY}`), ...CORE_DEPS]);
});

test('update: a plugin this run installed is not installed, enabled or updated again, and a stale flag never reads it parked (S22)', () =>
{
    const run = cli();
    const after = [NEW_CORE('project', { enabled: false })];
    const report = P.updatePlugins({ plugins: [`alfred-code@${KEY}`], scope: 'project', before: [], after, fresh: [`alfred-code@${KEY}`], cli: run });
    assert.deepStrictEqual(run.matching(/^plugin (install|enable|update) /), []);
    assert.ok(!/DISABLED|NOT installed/.test(report[0]), report[0]);
    assert.match(report[0], /plugin alfred-code: 2\.0\.0 \(installed this run\)/);
});

test('update: the core is locked on - a stale disabled flag runs no enable and reads no DISABLED (S22)', () =>
{
    const run = cli();
    const rows = [NEW_CORE('project', { enabled: false }), { name: 'navigation', marketplace: KEY, version: '1.0.0', scope: 'project', enabled: false }];
    const specs = ['alfred-code', 'navigation'].map((n) => `${n}@${KEY}`);
    const report = P.updatePlugins({ plugins: specs, scope: 'project', before: rows, after: rows, cli: run });
    assert.deepStrictEqual(run.matching(/^plugin enable /), [`plugin enable navigation@${KEY} --scope project`], 'a parked ordinary entry is still enabled');
    assert.match(report[0], /plugin alfred-code: 2\.0\.0 \(already newest\)/);
    assert.match(report[1], /plugin navigation: 1\.0\.0 but DISABLED/);
});

test('install: a plugin this run installed is not installed again', () =>
{
    const run = cli();
    P.installPlugins({ plugins: [`alfred-code@${KEY}`, `alfred-navigation@${KEY}`], scope: 'project', fresh: [`alfred-code@${KEY}`], cli: run });
    assert.deepStrictEqual(run.matching(/^plugin install /), [`plugin install alfred-navigation@${KEY} --scope project -y`]);
});

test('seed plan --installed-only: a stale disabled flag on the core leaves out no core item and shows no DISABLED core (S22)', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
        .map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: !n.startsWith('alfred-code') })));
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
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

// 2.0.0 also retired the two third-party picks the plugins audit (2026-09-26) found no install using -
// claude-md-management (0 uses in 230 sessions; the core's CLAUDE.md skill does its job) and
// security-guidance (a billed review per stop and commit with 0 findings). Update uninstalls each row at
// this run's scope by its official spec and prints the line that adds it back; a row at another scope
// is every other project's install, so it stays and is named.
test('seed update: claude-md-management and security-guidance leave a project-scope install with their add-back lines - a user-scope row stays, named', POSIX_ONLY, () =>
{
    const row = (id, scope = 'project') => ({ id, version: '1.0.0', scope, enabled: true });
    const listing = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '2.0.0', scope: 'project', enabled: true },
        row('claude-md-management@claude-plugins-official'),
        row('security-guidance@claude-plugins-official'),
        row('security-guidance@claude-plugins-official', 'user'),
        row('csharp-lsp@claude-plugins-official'),
    ]);
    // An install stamped before the retirement.
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'version: 1.3.0\nsha: 0000000\n');
    };
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: listing, prepare });
    const uninstalls = calls.filter((c) => /^plugin uninstall /.test(c));
    assert.deepStrictEqual(uninstalls.sort(), ['plugin uninstall claude-md-management@claude-plugins-official --scope project -y',
        'plugin uninstall security-guidance@claude-plugins-official --scope project -y'], uninstalls.join('\n'));
    for (const n of ['claude-md-management', 'security-guidance'])
        assert.match(out, new RegExp(`pruned \\(retired upstream\\) \\[project\\]: ${n}@claude-plugins-official\\n==>     add it back: claude plugin install ${n}@claude-plugins-official --scope project\\n`), out);
    assert.match(out, /security-guidance@claude-plugins-official is installed at user scope, not this run's - kept .*claude plugin uninstall security-guidance@claude-plugins-official --scope user/);
    assert.ok(!calls.some((c) => /^plugin (install|update|enable) (claude-md-management|security-guidance)@/.test(c)), calls.join('\n'));
});

// The add-back line installs the very same spec the prune removes, so the prune runs on the first
// update past the retirement only - the stamp's version before `retiredIn`. From then on a row under
// that spec is the user's own, put back with that line: kept, and nothing said about it.
test('retirementDue: a retired pick whose add-back reinstalls it is due only while the stamp predates its retirement', () =>
{
    const rows = [
        { name: 'security-guidance', marketplace: 'claude-plugins-official', retiredIn: '2.0.0', addBack: 'claude plugin install security-guidance@claude-plugins-official --scope <scope>' },
        { name: 'sentry', retiredIn: '2.0.0', addBack: 'claude mcp add --transport http --scope <scope> sentry https://mcp.sentry.dev/mcp' },
        { name: 'ponytail', marketplace: 'ponytail', retiredIn: '0.2.85' },
    ];
    const cmp = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
    const due = (name, lastVersion) => P.retirementDue({ name, rows, lastVersion, compare: cmp });
    assert.strictEqual(due('security-guidance', '1.3.0'), true, 'the first update past the retirement');
    assert.strictEqual(due('security-guidance', '2.0.0'), false, 'a row after it is the user\'s own');
    assert.strictEqual(due('security-guidance', ''), false, 'no stamp version: the stack never installed it');
    assert.strictEqual(due('sentry', '2.0.0'), true, 'an add-back that registers a server never reinstalls the pruned plugin');
    assert.strictEqual(due('ponytail', '9.0.0'), true, 'no add-back line: pruned every run, as before');
    assert.strictEqual(due('gone-entry', '2.0.0'), true, 'a name with no row: pruned every run');
});

test('seed update: a retired pick an install stamped at its retirement or later carries is the user\'s own - kept, nothing said', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '2.0.0', scope: 'project', enabled: true },
        { id: 'security-guidance@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\nsha: 0000000\n');
    };
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: listing, prepare });
    assert.ok(!calls.some((c) => /^plugin uninstall security-guidance@/.test(c)), calls.join('\n'));
    assert.doesNotMatch(out, /security-guidance/, out);
});

test('seed update: a project under another key loses the cut plugins under ITS key', POSIX_ONLY, () =>
{
    const key = KEY;
    const { calls } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: cutListing(key, 'alfred-code') });
    const uninstalls = calls.filter((c) => /^plugin uninstall /.test(c));
    for (const n of CUT) assert.ok(uninstalls.includes(`plugin uninstall ${n}@${key} --scope project -y`), `${n}:\n${uninstalls.join('\n')}`);
    assert.ok(!uninstalls.some((c) => /@(envoydev|claude-plugins-official) /.test(c)), uninstalls.join('\n'));
    assert.ok(!uninstalls.some((c) => /--scope user/.test(c)), uninstalls.join('\n'));
});

// The configure / validate read-back on an install under another key: `--installed-only` under the key
// the stack was registered with keeps the stamp's picks, the seat deny and the hooks switched off.
test('seed update --installed-only: an install under another key keeps its picks, its deny and its hooks-off', POSIX_ONLY, () =>
{
    const row = (id) => ({ id, version: '2.0.0', scope: 'user', enabled: true });
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@${KEY}`)));
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'),
            'version: 2.0.0\nsha: 0000000\npicked-skills: markdown-style\npicked-agents: security-auditor@alfred-code\n');
        fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
            permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] },
            env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' },
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
                deny: settings.permissions.deny.filter((d) => d.includes('code-style-analyzer')),
                env: settings.env,
            };
        } });
    assert.ok(new RegExp(`marketplace: ${KEY}`).test(out), out);
    assert.ok(result.picks[0] && result.picks[0].split(',').includes('markdown-style'), `skills (a copy since 2.1.0, no plugin home): ${result.picks[0]}`);
    assert.ok(result.picks[1] && result.picks[1].split(',').includes('security-auditor@alfred-code'), `agents: ${result.picks[1]}`);
    assert.deepStrictEqual(result.deny, ['Agent(alfred-code:code-style-analyzer)'], 'the deny in one spelling');
    assert.strictEqual(result.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-length', 'the hooks the user switched off stay off');
});

// Review M3: a hooks-copy-route install made before the hooks rode the core never wrote
// ALFRED_CODE_HOOKS_OFF - absence on disk was the off-state. Once the core carries every hook, the
// first update must name each hook the project does not wire, and a None must not come back.
test('seed update --installed-only: a pre-11b hooks-copy-route install - its picks stay wired, the rest are named off, a None holds', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    // `off`: a plugin-route install flipped to the copies - no prelude, no hook on disk, the off-state
    // in ALFRED_CODE_HOOKS_OFF. `route`: the stamp's `hooks-route:` line, which a pre-11b stamp lacks.
    const layout = (kept, off, route) => (repo) =>
    {
        const claude = path.join(repo, '.claude');
        fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
        fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(claude, 'rules', 'alfred-interaction.md'), 'x\n');
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
// every hook but the one named off ends on, never the one left in the folder with every other one named off.
test('seed update --installed-only: an unwired stack hook under a stamp with no hooks route is no pick - every hook but the one named off stays on (R94)', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { result } = seedRun('update', 'skill markdown-style\n', {
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, plugins: listing, args: ['--installed-only'],
        prepare: (repo) =>
        {
            const claude = path.join(repo, '.claude');
            fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
            fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(claude, 'rules', 'alfred-interaction.md'), 'x\n');
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
    assert.deepStrictEqual(result.onDisk, shipped.filter((h) => h !== 'guard-answer-length').map((h) => `${h}.js`).sort(), 'every hook but the one named off copied and on');
});

// Re-review N1: the copy route's own modules (hook-prelude.js, fresh-session.js, shell-writes.js, hidden-chars.js, shell-guards.js) are no catalog hook,
// so a plugin-route stint that pruned only the catalog left them behind - and the next copy-route run
// read that leftover prelude as the copy route's own None, switching every hook off. The plugin route
// removes them with the hooks, so copy -> plugin -> copy comes back with the plugin route's answer.
test('seed: copy -> plugin -> copy hands the plugin route\'s hooks back, never a None', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const copies = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' };
    const MODULES = ['hook-prelude.js', 'fresh-session.js', 'shell-writes.js', 'hidden-chars.js', 'shell-guards.js', 'file-guards.js'];
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
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { result } = seedRun('install', 'skill markdown-style\n', { plugins: listing, inspect: (repo) =>
    {
        const work = path.dirname(repo);
        const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'CLAUDE_PROJECT_DIR', 'ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_UV_PYTHON', 'ALFRED_CODE_MEMORY_DB', 'MCP_MEMORY_SQLITE_PATH']) delete env[k];
        const runs = [['docs.js', 'status'], ['memory.js', 'level', repo], ['history.js', 'rulings']].map(([file, ...argv]) =>
        {
            const r = spawnSync(process.execPath, [path.join(repo, '.claude', 'hooks', file), ...argv], { cwd: repo, env, encoding: 'utf8' });
            return { file, status: r.status, stderr: r.stderr };
        });
        return { files: fs.readdirSync(path.join(repo, '.claude', 'hooks')).sort(), runs };
    } });
    assert.deepStrictEqual(result.files, ['docs.js', 'history.js', 'memory.js', 'model-windows.json', 'package.json'], 'only the engines, the window table and the CommonJS marker');
    for (const run of result.runs)
    {
        assert.strictEqual(run.status, 0, `${run.file}: ${run.stderr}`);
        assert.ok(!/Cannot find module/.test(run.stderr), `${run.file}: ${run.stderr}`);
    }
});

// A project whose own package.json says `"type": "module"` makes Node load every `.js` under it as
// ESM - `.claude/hooks/` included - and the hooks are CommonJS: the copied engines crashed on `require`,
// and on the copy route a copied guard died with exit 1, which Claude Code treats as a non-blocking
// error, so `rm -rf ~` ran (reproduced on 6855900). A `{"type":"commonjs"}` package.json beside the
// copies scopes them back; a user's own package.json there is theirs and is never overwritten.
test('seed: the copied hooks run as CommonJS in a "type": "module" project, on both routes', POSIX_ONLY, () =>
{
    const { spawnSync } = require('node:child_process');
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const esm = (repo) => fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'esm-app', type: 'module' }));
    const inspect = (repo) =>
    {
        const work = path.dirname(repo);
        const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), CLAUDE_PROJECT_DIR: repo };
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_UV_PYTHON', 'ALFRED_CODE_MEMORY_DB', 'MCP_MEMORY_SQLITE_PATH']) delete env[k];
        const hooks = path.join(repo, '.claude', 'hooks');
        const runs = [['docs.js', 'status'], ['memory.js', 'level', repo], ['history.js', 'rulings']].map(([file, ...argv]) =>
        {
            const r = spawnSync(process.execPath, [path.join(hooks, file), ...argv], { cwd: repo, env, encoding: 'utf8' });
            return { file, status: r.status, stderr: r.stderr };
        });
        const rm = fs.existsSync(path.join(hooks, 'guard-catastrophic-rm.js'))
            ? spawnSync(process.execPath, [path.join(hooks, 'guard-catastrophic-rm.js')], { cwd: repo, env, encoding: 'utf8',
                input: JSON.stringify({ session_id: 'esm', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf ~' } }) }).status
            : null;
        const marker = path.join(hooks, 'package.json');
        return { runs, rm, marker: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null };
    };
    const plugin = seedRun('install', 'skill markdown-style\n', { plugins: listing, prepare: esm, inspect }).result;
    const copyRoute = seedRun('install', 'skill markdown-style\nhook guard-catastrophic-rm\n', { plugins: listing, prepare: esm, inspect,
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' } }).result;
    for (const [route, r] of [['plugin', plugin], ['copy', copyRoute]])
    {
        assert.deepStrictEqual(JSON.parse(r.marker || 'null'), { type: 'commonjs' }, `${route} route: the CommonJS marker is written beside the copies`);
        for (const run of r.runs) assert.strictEqual(run.status, 0, `${route} route, ${run.file}: ${run.stderr}`);
    }
    assert.strictEqual(copyRoute.rm, 2, 'copy route: the copied guard still BLOCKS rm -rf ~ (exit 2, never the fail-open 1)');
    // the user's own package.json in that folder is theirs: kept byte for byte, and the run says why
    const own = '{ "type": "module", "private": true }\n';
    const kept = seedRun('install', 'skill markdown-style\n', { plugins: listing,
        prepare: (repo) => { esm(repo); fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'package.json'), own); },
        inspect: (repo) => fs.readFileSync(path.join(repo, '.claude', 'hooks', 'package.json'), 'utf8') });
    assert.strictEqual(kept.result, own, 'a package.json the user wrote there is never overwritten');
    assert.match(kept.out, /hooks\/package\.json/, 'and the run names it');
});

// Ruling R55: a plugin-route project kept the copy route's prelude from an earlier copy-route stint
// (an older release pruned only the catalog hooks), and its stamp has no `hooks-route:` line. Its first
// run on the copy route must not read that leftover as the user's None.
test('seed update --installed-only: a plugin-route project with a leftover prelude keeps its hooks on the copy route', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const prepare = (off) => (repo) =>
    {
        const claude = path.join(repo, '.claude');
        fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
        fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(claude, 'rules', 'alfred-interaction.md'), 'x\n');
        for (const f of ['hook-prelude.js', 'fresh-session.js', 'docs.js', 'memory.js']) fs.writeFileSync(path.join(claude, 'hooks', f), '// x\n');
        fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), `version: 1.3.0\nsha: 0000000\nshipped-hooks: ${shipped.join(',')}\n`);
        fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: off } }, null, 2));
    };
    const inspect = (repo) => ({
        onDisk: fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort(),
        off: String(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).env.ALFRED_CODE_HOOKS_OFF || '').split(',').filter(Boolean).sort(),
        route: (/^hooks-route: (.*)$/m.exec(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8')) || [])[1],
    });
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '1.3.0', scope: 'project', enabled: true })));
    const run = (off) => seedRun('update', 'skill markdown-style\n', { env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, plugins: listing,
        args: ['--installed-only'], prepare: prepare(off), inspect }).result;
    const all = run('');
    assert.deepStrictEqual(all.onDisk, shipped.map((h) => `${h}.js`).sort(), 'every hook is copied, never a None');
    assert.deepStrictEqual(all.off, []);
    assert.strictEqual(all.route, 'copy', 'and the stamp now records the route');
    const one = run('guard-answer-length');
    assert.deepStrictEqual(one.onDisk, shipped.filter((h) => h !== 'guard-answer-length').map((h) => `${h}.js`).sort(), 'the stored off list is kept');
    assert.deepStrictEqual(one.off, ['guard-answer-length']);
});

// configure and validate SHOW the --print-plan output. A plan never runs an uninstall, so it must never
// print the outcome lines a run prints after one - a 'plugin pruned' or an 'add it back:' there reads as done.
test('seed plan: --print-plan over a project with cut plugins prints no removal outcome - nothing ran', POSIX_ONLY, () =>
{
    const key = KEY;
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: cutListing(key, 'alfred-code'), args: ['--print-plan'] });
    assert.deepStrictEqual(calls.filter((c) => /^plugin (install|uninstall|update|enable) /.test(c)), [], calls.join('\n'));
    assert.ok(!/plugin pruned|add it back:|plugin removed/.test(out), out.split('\n').filter((l) => /plugin pruned|add it back:|plugin removed/.test(l)).join('\n'));
});

// --- R67 end to end: the engines installed and enabled as the user picked --------------------------
const PW_SELECTION = 'skill markdown-style\nrule markdown-docs\nmcp browser\n';
const stampOf = (repo) => { try { return fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'); } catch { return ''; } };
const pwMoves = (calls) => calls.filter((c) => /^plugin (install|disable|enable|update|uninstall) browser-/.test(c));
const ROW = (id, extra = {}) => ({ id, version: '1.0.0', scope: 'project', enabled: true, ...extra });
const CORE_ROWS = [ROW('alfred-code@envoydev'), ROW('alfred-navigation@envoydev'), ROW('alfred-documentation@envoydev'), ROW('alfred-memory@envoydev')];
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
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
    ]);
    assert.match(result, /^browser-engines: chrome,firefox\nbrowser-enabled: chrome,firefox$/m);
    assert.match(out, /browser: installs chrome,firefox; no enable answer given - one already installed keeps its on\/off, one installed now arrives on \(\/plugin toggles them\)/);
});

test('seed install --browser-enabled: an engine the user did not enable is installed, then disabled at the same scope', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('install', PW_SELECTION, { args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
    ]);
    assert.match(result, /^browser-engines: chrome,firefox\nbrowser-enabled: chrome$/m);
    assert.match(out, /browser: installs chrome,firefox; enabled as picked: chrome \(\/plugin toggles them\)/);
    // none: every engine installed and left off.
    const none = seedRun('install', PW_SELECTION, { args: ['--playwright-browsers', 'chrome', '--playwright-enabled', 'none'], inspect: stampOf });
    assert.deepStrictEqual(pwMoves(none.calls), ['plugin install browser-chrome@envoydev --scope project -y', 'plugin disable browser-chrome@envoydev --scope project']);
    assert.match(none.result, /^browser-enabled: $/m);
});

test('seed update --installed-only with no answer flips nothing - installed engines are updated in place, a never-stamped disabled one is left alone', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS,
        ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev', { enabled: false }),
        ROW('browser-webkit@envoydev', { enabled: false }),
    ]);
    const { calls, result } = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
    ], 'an engine flag was flipped, an installed engine was installed over, or the never-stamped one was touched');
    assert.match(result, /^browser-engines: chrome,firefox\nbrowser-enabled: chrome$/m, 'the recorded choice changed with no answer given');
});

test('seed update: the reviewer\'s probe - an engine a narrower install set leaves out is UNINSTALLED, and a plain update never brings it back', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev')]);
    const { calls, steps, outs, result } = seedRun(['update', 'update'], PW_SELECTION, {
        plugins, tools: LIVE_CLAUDE,
        args: [['--installed-only', '--playwright-browsers', 'chrome'], ['--installed-only']],
        prepare: installedProject('browser-engines: chrome,firefox\n'),
        each: (repo) => ({ stamp: (/^browser-engines: (.*)$/m.exec(stampOf(repo)) || [])[1], ids: listingOf(repo).map((r) => r.id) }),
        inspect: listingOf,
    });
    assert.deepStrictEqual(calls.filter((c) => /browser-firefox/.test(c) && /^plugin (install|uninstall|enable) /.test(c)),
        ['plugin uninstall browser-firefox@envoydev --scope project -y'], 'firefox was not uninstalled once, or came back');
    assert.match(outs[0], /plugin uninstalled \[project\]: browser-firefox@envoydev \(no longer picked\)/);
    assert.deepStrictEqual(steps.map((s) => s.stamp), ['chrome', 'chrome'], 'the stamp did not stay chrome after both runs');
    assert.ok(!result.some((r) => r.id === 'browser-firefox@envoydev'), 'firefox is installed again after the plain update');
    assert.ok(result.some((r) => r.id === 'browser-chrome@envoydev' && r.enabled), 'chrome was lost or switched off');
});

test('seed update --drop mcp browser: every engine the stamp names is uninstalled, never merely disabled', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev', { enabled: false })]);
    const { calls, result } = seedRun('update', PW_SELECTION, {
        plugins, tools: LIVE_CLAUDE, args: ['--installed-only', '--drop', 'mcp browser'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n'),
        inspect: (repo) => ({ stamp: stampOf(repo), ids: listingOf(repo).map((r) => r.id) }),
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin uninstall browser-chrome@envoydev --scope project -y',
        'plugin uninstall browser-firefox@envoydev --scope project -y',
    ]);
    assert.ok(!result.ids.some((id) => id.startsWith('browser-')), result.ids.join(','));
    assert.match(result.stamp, /^browser-engines: $/m);
});

test('seed update: an engine uninstalled by hand comes back in its last chosen state', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev')]);
    const off = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n'), inspect: stampOf });
    assert.match(off.out, /one installed now arrives on, except firefox \(last left off\)/);
    assert.deepStrictEqual(pwMoves(off.calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
        'plugin update browser-firefox@envoydev --scope project -y',
    ], 'firefox, last left off, did not come back off');
    assert.match(off.result, /^browser-engines: chrome,firefox\nbrowser-enabled: chrome$/m);
    const on = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome,firefox\n') });
    assert.deepStrictEqual(pwMoves(on.calls).filter((c) => /firefox/.test(c)), [
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
    ], 'firefox, last left on, came back off');
});

test('seed install (init re-run) over installed engines: no install verb - it would turn a disabled one back on (S28)', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev', { enabled: false })]);
    const { calls } = seedRun('install', PW_SELECTION, {
        plugins, args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n',
            { 'browser-chrome@envoydev': true, 'browser-firefox@envoydev': false }),
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
    ], 'an installed engine was installed over, or a switch the settings file shows made was made again');
});

test('seed update --playwright-enabled (configure): the answer is applied to the installed engines and recorded', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev', { enabled: false })]);
    const { calls, out, result } = seedRun('update', PW_SELECTION, {
        plugins, args: ['--installed-only', '--playwright-enabled', 'firefox'],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n',
            { 'browser-chrome@envoydev': true, 'browser-firefox@envoydev': false }),
        inspect: stampOf,
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin disable browser-chrome@envoydev --scope project',
        'plugin update browser-firefox@envoydev --scope project -y',
        'plugin enable browser-firefox@envoydev --scope project',
    ]);
    assert.match(out, /plugin enabled \[project\]: browser-firefox@envoydev \(as picked/);
    assert.match(result, /^browser-engines: chrome,firefox\nbrowser-enabled: firefox$/m);
});

// A listing the run cannot read shows every engine as absent. The STAMP then says which are new: an
// engine it names is taken as installed (updated, never installed over); only a new engine the user
// chose not to enable is disabled after its install.
test('seed install on a listing it cannot read: the stamp says which engines are new, and only a new one chosen off is disabled', POSIX_ONLY, () =>
{
    const fresh = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'] });
    assert.deepStrictEqual(pwMoves(fresh.calls), [
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
    ], 'no stamp: every engine is new, and the one chosen off must be disabled');
    assert.match(fresh.out, /browser: the plugin listing could not be read and neither the stamp nor the settings name an installed engine - each installs as new/);
    const noAnswer = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome'] });
    assert.deepStrictEqual(pwMoves(noAnswer.calls), ['plugin install browser-chrome@envoydev --scope project -y'], 'no answer: nothing is disabled');
    const stamped = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'],
        prepare: installedProject('browser-engines: chrome\nbrowser-enabled: chrome\n', { 'browser-chrome@envoydev': true }) });
    assert.deepStrictEqual(pwMoves(stamped.calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
    ], 'the stamped engine was installed over, or the new one was left on');
    assert.match(stamped.out, /browser: the plugin listing could not be read - the stamp or the settings name chrome as installed \(updated in place\); the rest install as new/);
    // A stamp with no engine line: nothing is known, so each is installed, and with no answer none is disabled.
    const old = seedRun('install', PW_SELECTION, { plugins: 'not json', args: ['--playwright-browsers', 'chrome'], prepare: installedProject('') });
    assert.deepStrictEqual(pwMoves(old.calls), ['plugin install browser-chrome@envoydev --scope project -y']);
});

// R116 (j): applied on the MCP copy route too - an engine left off is registered AND named in
// disabledMcpjsonServers, so it does not load (install-mcp.test.js has the re-run and the user's own switch).
test('seed install on the MCP copy route: --playwright-enabled is applied through disabledMcpjsonServers, never an engine plugin', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('install', PW_SELECTION, { env: { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        args: ['--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'],
        inspect: (repo) => ({ stamp: stampOf(repo), settings: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')) }) });
    assert.deepStrictEqual(pwMoves(calls), [], 'the copy route installed or switched an engine plugin');
    assert.match(out, /browser: firefox left off - disabledMcpjsonServers keeps it from loading/);
    assert.deepStrictEqual(result.settings.disabledMcpjsonServers, ['browser-firefox']);
    assert.match(result.stamp, /^browser-engines: chrome,firefox\nbrowser-enabled: chrome$/m);
});

// --- round 2 ---------------------------------------------------------------------------------------
// Important 1, the reviewer's probe P1: the stamp says chrome and firefox are enabled, the user has
// since switched firefox off in /plugin, and configure adds webkit. The walk pre-selects the enable
// question from the plan's LIVE set, so the answer it passes leaves firefox off - no enable call.
test('seed configure: the enable question is pre-selected from the LIVE state - a /plugin switch-off survives adding webkit', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev')]);
    const planFile = (work) => path.join(work, 'plan.json');
    const plan = (work) => JSON.parse(fs.readFileSync(planFile(work), 'utf8')).browser;
    // What configure does with the plan: today's sets pre-selected, webkit added and left ticked.
    const walk = (repo, work) => ['--installed-only', '--playwright-browsers', [...plan(work).installed, 'webkit'].join(','),
        '--playwright-enabled', [...plan(work).enabled, 'webkit'].join(',')];
    const { calls, steps, result } = seedRun(['update', 'update'], PW_SELECTION, {
        plugins,
        args: [(repo, work) => ['--installed-only', '--print-plan', '--plan-out', planFile(work)], walk],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome,firefox\n',
            { 'browser-chrome@envoydev': true, 'browser-firefox@envoydev': false }),
        each: (repo, i) => (i === 0 ? plan(path.dirname(repo)) : null),
        inspect: stampOf,
    });
    assert.deepStrictEqual(steps[0], { installed: ['chrome', 'firefox'], enabled: ['chrome'] }, 'the plan took the stamp over the settings file');
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope project -y',
        'plugin install browser-webkit@envoydev --scope project -y',
        'plugin update browser-webkit@envoydev --scope project -y',
    ], 'an engine whose live state the answer did not change was switched');
    assert.match(result, /^browser-engines: chrome,firefox,webkit\nbrowser-enabled: chrome,webkit$/m);
});

test('seed plan: an engine the settings file does not name falls back to the stamp\'s last answer', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev')]);
    const { result } = seedRun('update', PW_SELECTION, {
        plugins, args: [(repo, work) => ['--installed-only', '--print-plan', '--plan-out', path.join(work, 'plan.json')]],
        prepare: installedProject('browser-engines: chrome,firefox\nbrowser-enabled: chrome\n', { 'browser-chrome@envoydev': true }),
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'plan.json'), 'utf8')).browser,
    });
    assert.deepStrictEqual(result, { installed: ['chrome', 'firefox'], enabled: ['chrome'] }, 'firefox, off in the stamp and unnamed in settings, read as on');
});

// Minor 1: a dropped engine whose uninstall did not happen is still listed, and enabled. The next
// plain update must not read it back as kept - the stamp stays the user's choice.
test('seed update: a dropped engine still installed is never kept again - the stamp holds, and the log names its uninstall', POSIX_ONLY, () =>
{
    const plugins = JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev'), ROW('browser-firefox@envoydev')]);
    const { calls, out, result } = seedRun('update', PW_SELECTION, { plugins, args: ['--installed-only'],
        prepare: installedProject('browser-engines: chrome\nbrowser-enabled: chrome\n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(calls).filter((c) => /firefox/.test(c)), [], 'the dropped engine was touched');
    assert.match(result, /^browser-engines: chrome\nbrowser-enabled: chrome$/m, 'the leftover was written back as kept');
    assert.match(out, /browser-firefox@envoydev is installed but not among the browsers the last install kept .*claude plugin uninstall browser-firefox@envoydev --scope project/);
    // Every engine dropped, one left over: nothing is kept, and chrome is never installed as a default.
    const all = seedRun('update', PW_SELECTION, { plugins: JSON.stringify([...CORE_ROWS, ROW('browser-chrome@envoydev')]), args: ['--installed-only'],
        prepare: installedProject('browser-engines: \nbrowser-enabled: \n'), inspect: stampOf });
    assert.deepStrictEqual(pwMoves(all.calls), []);
    assert.match(all.result, /^browser-engines: $/m);
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
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'browser-chrome@envoydev': false } }));
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', 'settings.json'), JSON.stringify({ enabledPlugins: { 'browser-firefox@envoydev': true } }));
        },
    });
    assert.deepStrictEqual(pwMoves(calls), [
        'plugin update browser-chrome@envoydev --scope project -y',
        'plugin update browser-firefox@envoydev --scope user -y',
        'plugin install browser-webkit@envoydev --scope project -y',
    ], 'an engine the settings show installed got the install verb');
    assert.match(out, /browser: the plugin listing could not be read - the stamp or the settings name chrome,firefox as installed \(updated in place\); the rest install as new/);
});

// The in-process sandbox the two hooks-route interruption tests share (NM1, N4): a git project, a
// recording `claude` stub listing the core and the three locked servers, dead uvx/npx/npm/curl, and
// the entry's own `main` (per install-args.test.js's precedent), so a genuine fault can be raised
// mid-run and caught by main's own outer try/catch exactly as a real crash would be.
// package.json: the CommonJS marker copy.commonJsScope writes beside every copy, engines included.
const HOOK_ENGINES = ['docs.js', 'memory.js', 'history.js', 'model-windows.json', 'package.json'];
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
    fs.writeFileSync(pluginsFile, JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
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

// O-1: `claude` is looked up on the run's OWN PATH, the one every claude call is spawned with. The
// lookup read the installer process's PATH instead, so a parent with no claude on it (a CI runner)
// skipped the whole plugin layer while the run's env held a working one.
test('seed: `claude` is looked up on the run\'s own PATH, never the installer process\'s (O-1)', POSIX_ONLY, () =>
{
    const s = hooksRouteSandbox('o1-');
    const parentPath = process.env.PATH;
    try
    {
        process.env.PATH = String(parentPath).split(path.delimiter)
            .filter((d) => d && !fs.existsSync(path.join(d, 'claude'))).join(path.delimiter);
        assert.strictEqual(s.run(['install'], s.env), 0, 'the install failed');
        const log = s.env.CLAUDE_STUB_LOG;
        const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
        assert.match(calls, /^plugin list --json$/m, 'the claude on the run\'s PATH was never called');
    }
    finally
    {
        process.env.PATH = parentPath;
        s.cleanup();
    }
});

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
    const stackHooks = () => s.onDisk().filter((f) => !HOOK_ENGINES.includes(f) && !['hook-prelude.js', 'fresh-session.js', 'shell-writes.js', 'hidden-chars.js', 'shell-guards.js', 'file-guards.js'].includes(f));
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

// C5 (R101 N6, widened by final review A): at project (and user) scope the routes and the copy route's
// HOOKS_OFF decide COMMITTED state - the hooks wired in settings.json, the core switched off there. A
// value settings.local.json holds is the runner's own: Claude Code puts it into every process it starts
// here, so where the run's value IS the local file's, settings.json decides. A shell export the local
// file does not hold is the invocation's own and stands; at local scope the local file is the install's.
test('routes: at project scope a route switch only settings.local.json holds is read from settings.json (C5)', () =>
{
    const logs = [];
    const log = (m) => logs.push(m);
    const personal = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const env = { ...personal, ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    assert.deepStrictEqual(P.committedRoutes({ env, shared: {}, personal, scope: 'project', log }), { hooks: true, skills: true, mcps: false },
        'the two switches the local file holds came from it; the shell export stands');
    assert.strictEqual(logs.length, 2, logs.join('\n'));
    assert.match(logs[0], /^routes: ALFRED_CODE_HOOKS_VIA_PLUGIN=false comes from settings\.local\.json - personal, so this project-scope run follows settings\.json \(unset - the plugin route\)$/);
    // settings.json holding the same value: nothing to override, nothing said.
    const quiet = [];
    assert.deepStrictEqual(P.committedRoutes({ env, shared: env, personal, scope: 'project', log: (m) => quiet.push(m) }), P.pluginRoutes(env));
    assert.deepStrictEqual(quiet, []);
    // settings.json naming the other route: its value decides.
    assert.strictEqual(P.committedRoutes({ env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'true' }, shared: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }, personal: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'true' }, scope: 'user' }).hooks, false);
    // Local scope: the local file IS the install's settings.
    assert.deepStrictEqual(P.committedRoutes({ env, shared: {}, personal, scope: 'local' }), P.pluginRoutes(env));
});

test('seed: a personal ALFRED_CODE_HOOKS_VIA_PLUGIN=false in settings.local.json does not move the committed settings.json onto the hooks copy route (C5)', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { outs, result } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: listing, args: [[], ['--installed-only']],
        // Claude Code puts the local file's env into the run's process: the second step carries it.
        env: [{}, { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const file = path.join(repo, '.claude', 'settings.local.json');
            fs.writeFileSync(file, JSON.stringify({ env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' } }));
            return null;
        },
        inspect: (repo) => ({
            hooks: fs.existsSync(path.join(repo, '.claude', 'hooks')) ? fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => /^guard-/.test(f)) : [],
            wiring: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).hooks,
            stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
        }),
    });
    assert.deepStrictEqual(result.hooks, [], 'the runner\'s personal switch copied the hooks into the project');
    assert.ok(!JSON.stringify(result.wiring || {}).includes('/.claude/hooks/'), 'the committed settings.json wires copied hooks');
    assert.match(result.stamp, /^hooks-route: plugin$/m);
    assert.match(outs[1], /routes: ALFRED_CODE_HOOKS_VIA_PLUGIN=false comes from settings\.local\.json - personal, so this project-scope run follows settings\.json \(unset - the plugin route\)/, outs[1]);
});

test('seed: on a switch to the hooks copy route the committed wiring follows settings.json\'s ALFRED_CODE_HOOKS_OFF, never the runner\'s local one (C5, N6)', POSIX_ONLY, () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { result } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: listing, args: [[], ['--installed-only']],
        env: [{}, { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' }],
        each: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } }));
            return null;
        },
        inspect: (repo) => ({
            onDisk: fs.readdirSync(path.join(repo, '.claude', 'hooks')).filter((f) => shipped.includes(f.replace(/\.js$/, ''))).sort(),
            shared: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
            local: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')),
        }),
    });
    assert.deepStrictEqual(result.onDisk, shipped.map((h) => `${h}.js`).sort(), `the runner's local HOOKS_OFF decided the committed copies: ${result.onDisk.length} of ${shipped.length}`);
    assert.ok(JSON.stringify(result.shared.hooks).includes('/.claude/hooks/guard-answer-length.js'), 'the committed wiring left out the hook the runner switched off for themselves');
    assert.strictEqual(result.shared.env.ALFRED_CODE_HOOKS_OFF, '', 'the complement of the committed wiring lands in settings.json');
    assert.strictEqual(result.local.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-length', 'the runner\'s own switch-off stays theirs, and still applies to them');
});

// A-I2 (final review A): the old local mode printed `/mcp disable context7` for the hosted server. The prune of
// context7-local leaves that switch-off in place, so the locked docs server is gone with no line saying so.
test('retired: a context7-local prune says how to switch the hosted context7 back on (A-I2)', () =>
{
    const line = '  !! context7-local removed - if you ran /mcp disable context7 for it, run /mcp enable context7';
    const logs = [];
    const gone = P.prunedRetired({ rows: [prow('context7-local', 'envoydev', 'project'), prow('sentry', 'envoydev', 'project')], retired: ['context7-local', 'sentry'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: cli(), log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone, ['context7-local', 'sentry']);
    assert.strictEqual(logs.filter((m) => m === line).length, 1, logs.join(' | '));
    const refused = [];
    P.prunedRetired({ rows: [prow('context7-local', 'envoydev', 'project')], retired: ['context7-local'], retiredRows: RETIRED_ROWS, market: 'envoydev', scope: 'project', cli: cli(['uninstall']), log: (m) => refused.push(m) });
    assert.ok(!refused.includes(line), 'nothing was removed');
});

// C12 (Task 8a concern 5): an install moved off local scope carried its settings out of settings.local.json
// (R78) but left every plugin row at local scope, where only this checkout sees it - a teammate cloning the
// project-scope install got no plugins, and each update went on updating the local rows. A row of the run's
// set found only at local scope is installed at the new scope, then uninstalled at local; a playwright
// engine left off stays off (the user's own off-state). claude-hud keeps its user scope.
test('seed update: a move off local scope moves each plugin row found only at local scope to the new one, an engine left off staying off (C12)', POSIX_ONLY, () =>
{
    const rows = [
        ...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory', 'browser-chrome'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'local', enabled: true })),
        { id: 'browser-firefox@envoydev', version: '2.0.0', scope: 'local', enabled: false },
        { id: 'typescript-lsp@claude-plugins-official', version: '1.0.0', scope: 'local', enabled: true },
        { id: 'claude-hud@claude-hud', version: '0.8.0', scope: 'user', enabled: true },
    ];
    const { calls, outs } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\nplugin typescript-lsp\nmcp browser\n', {
        plugins: JSON.stringify(rows),
        args: [['--scope', 'local', '--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'chrome'], ['--scope', 'project']],
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
    });
    const out = outs[1];
    const moves = calls.filter((c) => /^plugin (install|uninstall|disable|enable|update) /.test(c) && !/claude-hud/.test(c));
    const specs = ['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory', 'browser-chrome', 'browser-firefox'].map((n) => `${n}@envoydev`).concat('typescript-lsp@claude-plugins-official');
    for (const spec of specs)
    {
        const inst = moves.indexOf(`plugin install ${spec} --scope project -y`);
        const gone = moves.indexOf(`plugin uninstall ${spec} --scope local -y`);
        assert.ok(inst > -1 && gone > inst, `${spec} was not moved:\n${moves.join('\n')}\n${out}`);
        assert.ok(out.includes(`plugin moved [local -> project]: ${spec}`), out);
    }
    assert.ok(moves.includes('plugin disable browser-firefox@envoydev --scope project'), `the engine's off-state was lost:\n${moves.join('\n')}`);
    assert.ok(!moves.includes('plugin disable browser-chrome@envoydev --scope project'), 'an engine left on was switched off');
    assert.deepStrictEqual(moves.filter((c) => / --scope local/.test(c) && !/^plugin uninstall /.test(c)), [], 'a local row was still acted on');
    assert.ok(!calls.some((c) => /^plugin (install|uninstall) claude-hud@claude-hud --scope (project|local)/.test(c)), 'claude-hud left user scope');
});

// A-I4 (final review A): claude-hud is installed beside the core every run, while its status line is set by
// /alfred-code:init alone - an account init never reached shows no HUD, and nothing said why. With no
// statusLine in the account settings the run says so once; a statusLine of the user's own (another tool's)
// is their choice, and a claude-hud they switched off stays off - neither says anything.
test('seed install: claude-hud with no status line in the account settings names /alfred-code:init; a foreign status line or a user-disabled HUD says nothing (A-I4)', POSIX_ONLY, () =>
{
    const LINE = /claude-hud has no status line yet - run \/alfred-code:init to set it up/g;
    const run = (accountSettings, plugins = '[]') => seedRun('install', HUD_SELECTION, {
        plugins,
        prepare: (repo, work) =>
        {
            if (!accountSettings) return;
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', 'settings.json'), JSON.stringify(accountSettings));
        },
    }).out;
    assert.strictEqual((run(null).match(LINE) || []).length, 1, 'no account settings file');
    assert.strictEqual((run({ env: {} }).match(LINE) || []).length, 1, 'an account settings file with no statusLine');
    assert.doesNotMatch(run({ statusLine: { type: 'command', command: 'my-line' } }), LINE);
    assert.doesNotMatch(run(null, JSON.stringify([{ id: 'claude-hud@claude-hud', version: '0.8.0', scope: 'user', enabled: false }])), LINE);
});

// --- the 2.0.0 rename: an old MCP plugin is swapped for its successor where it is installed ---------
// serena, context7 and playwright-<engine> are navigation, documentation and browser-<engine> now. An
// install made before the rename holds the old rows; update installs the new one at the scope the
// listing reports for the old one, then removes the old one there - never both loading at once after
// the run, and the new one before the old goes, so a failed install leaves the server running.
const RENAMED_MCPS = { serena: 'alfred-navigation', context7: 'alfred-documentation', playwright: 'browser' };
const oldRow = (name, over = {}) => ({ name, marketplace: 'envoydev', version: '1.3.0', scope: 'project', enabled: true, ...over });
const RENAME_SET = ['alfred-code@envoydev', 'alfred-navigation@envoydev', 'alfred-documentation@envoydev', 'alfred-memory@envoydev', 'browser-chrome@envoydev', 'browser-firefox@envoydev'];

// I2 (final review of the rename): a user-scope old row serves every project on the account, and a project
// not yet updated still spells the old tools (its library agents' `tools:`, its navigation rule's
// `ToolSearch select:` line). A project-scope run swapping it at user scope stripped them all. An old row at
// ANOTHER scope is stood down here instead: the successor installed at this run's scope, the old id
// disabled here only, and one `!!` line naming its uninstall for when every project has updated.
test('rename: an old row at this run\'s scope is swapped in place; one at another scope is stood down here only (I2)', () =>
{
    const run = cli();
    const logs = [];
    const rows = [oldRow('serena'), oldRow('context7', { scope: 'user' }), oldRow('playwright-chrome'), oldRow('memory')];
    const out = P.migrateRenamed({ rows, renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.calls, [
        'plugin install alfred-navigation@envoydev --scope project -y',
        'plugin uninstall serena@envoydev --scope project -y',
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin uninstall playwright-chrome@envoydev --scope project -y',
        'plugin install alfred-documentation@envoydev --scope project -y',
        'plugin disable context7@envoydev --scope project',
    ], 'this scope\'s own old rows first, then the stand-downs');
    assert.deepStrictEqual(out.fresh, ['alfred-navigation@envoydev', 'browser-chrome@envoydev', 'alfred-documentation@envoydev'], 'installed this run - the install and update passes leave them alone');
    assert.deepStrictEqual(out.gone.map((r) => r.name), ['serena', 'playwright-chrome'], 'the user-scope row is still installed');
    const bang = logs.filter((m) => /^\s*!!/.test(m));
    assert.strictEqual(bang.length, 1, logs.join('\n'));
    assert.match(bang[0], /context7@envoydev.*user scope.*every project.*claude plugin uninstall context7@envoydev --scope user/);
});

test('rename: a re-run over a stood-down old row changes nothing - the successor is here, the old id is off here (I2)', () =>
{
    const run = cli();
    const logs = [];
    const isOn = (spec, scope) => (spec === 'context7@envoydev' && scope === 'project' ? false : undefined);
    const rows = [oldRow('context7', { scope: 'user' }), oldRow('alfred-documentation', { version: '2.0.0' })];
    const out = P.migrateRenamed({ rows, renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', isOn, cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.calls, []);
    assert.deepStrictEqual(out, { fresh: [], gone: [] });
    assert.ok(!logs.some((m) => /^\s*!!/.test(m)), `said loud a second time:\n${logs.join('\n')}`);
    assert.ok(logs.some((m) => /claude plugin uninstall context7@envoydev --scope user/.test(m)), 'the kept row is still named');
});

// Found by the I2 temp-project proof: the old id at BOTH scopes (a user row, and this project's own). The
// user row went first, then the in-place uninstall of the project row cleared the `false` its disable had
// written - the user row loaded here beside its successor, and the successor was installed twice.
test('rename: an old id at this scope and at user scope - swapped here first, the successor installed once, then the user row disabled here (I2)', () =>
{
    const run = cli();
    P.migrateRenamed({ rows: [oldRow('serena', { scope: 'user' }), oldRow('serena')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: run });
    assert.deepStrictEqual(run.calls, [
        'plugin install alfred-navigation@envoydev --scope project -y',
        'plugin uninstall serena@envoydev --scope project -y',
        'plugin disable serena@envoydev --scope project',
    ]);
    const failing = cli(['install alfred-navigation']);
    const notes = [];
    P.migrateRenamed({ rows: [oldRow('serena', { scope: 'user' }), oldRow('serena')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: failing, note: (m) => notes.push(m) });
    assert.deepStrictEqual(failing.calls, ['plugin install alfred-navigation@envoydev --scope project -y'], 'a failed successor is tried once, and nothing old is touched');
    assert.strictEqual(notes.length, 1, notes.join('\n'));
});

test('rename: a user-scope run swaps a user-scope old row at user scope; a user-scope engine left off arrives off here (I2)', () =>
{
    const run = cli();
    P.migrateRenamed({ rows: [oldRow('serena', { scope: 'user' })], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'user', cli: run });
    assert.deepStrictEqual(run.calls, ['plugin install alfred-navigation@envoydev --scope user -y', 'plugin uninstall serena@envoydev --scope user -y']);
    const off = cli();
    const isOn = (spec, scope) => (spec === 'playwright-firefox@envoydev' && scope === 'user' ? false : undefined);
    P.migrateRenamed({ rows: [oldRow('playwright-firefox', { scope: 'user', enabled: false })], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', isOn, cli: off });
    assert.deepStrictEqual(off.calls, ['plugin install browser-firefox@envoydev --scope project -y', 'plugin disable browser-firefox@envoydev --scope project'],
        'an old id already off at its own scope and never on here needs no disable');
});

test('rename: a browser engine the user left off arrives off; a locked server arrives on, as update enables a parked one', () =>
{
    const run = cli();
    const isOn = (spec) => ({ 'playwright-firefox@envoydev': false, 'serena@envoydev': false })[spec];
    P.migrateRenamed({ rows: [oldRow('playwright-firefox'), oldRow('serena')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', isOn, cli: run });
    assert.deepStrictEqual(run.calls, [
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin disable browser-firefox@envoydev --scope project',
        'plugin uninstall playwright-firefox@envoydev --scope project -y',
        'plugin install alfred-navigation@envoydev --scope project -y',
        'plugin uninstall serena@envoydev --scope project -y',
    ]);
    // An enable answer given this run wins over the old row's state.
    const answered = cli();
    P.migrateRenamed({ rows: [oldRow('playwright-firefox')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', isOn,
        engines: { on: ['browser-firefox@envoydev'] }, cli: answered });
    assert.deepStrictEqual(answered.matching(/disable/), [], 'the answer switches it on');
});

test('rename: the new one already there is not installed again - only the old one goes (a re-run after a partial one)', () =>
{
    const run = cli();
    P.migrateRenamed({ rows: [oldRow('serena'), oldRow('alfred-navigation', { version: '2.0.0' })], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: run });
    assert.deepStrictEqual(run.calls, ['plugin uninstall serena@envoydev --scope project -y']);
});

test('rename: an old one this run does not carry goes at this scope only - at another it is named, kept for the projects there', () =>
{
    const run = cli();
    const logs = [];
    const set = ['alfred-code@envoydev', 'alfred-navigation@envoydev'];
    P.migrateRenamed({ rows: [oldRow('playwright-webkit'), oldRow('playwright-msedge', { scope: 'user' })], renamed: RENAMED_MCPS, set, market: 'envoydev', scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.calls, ['plugin uninstall playwright-webkit@envoydev --scope project -y']);
    assert.ok(logs.some((m) => /playwright-msedge@envoydev is installed at user scope.*claude plugin uninstall playwright-msedge@envoydev --scope user/.test(m)), logs.join('\n'));
});

test('rename: a failed install removes nothing; a failed removal is said with its command; another marketplace\'s same name is never touched', () =>
{
    const notes = [];
    const failing = cli(['install alfred-navigation']);
    P.migrateRenamed({ rows: [oldRow('serena')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: failing, note: (m) => notes.push(m) });
    assert.deepStrictEqual(failing.matching(/uninstall/), [], 'the old server keeps running when its successor did not install');
    assert.ok(notes.some((m) => /navigation@envoydev failed - serena@envoydev stays/.test(m)), notes.join('\n'));
    const stuck = cli(['uninstall serena']);
    const more = [];
    P.migrateRenamed({ rows: [oldRow('serena')], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: stuck, note: (m) => more.push(m) });
    assert.ok(more.some((m) => /claude plugin uninstall serena@envoydev --scope project/.test(m)), more.join('\n'));
    const official = cli();
    P.migrateRenamed({ rows: [oldRow('serena', { marketplace: 'claude-plugins-official' })], renamed: RENAMED_MCPS, set: RENAME_SET, market: 'envoydev', scope: 'project', cli: official });
    assert.deepStrictEqual(official.calls, [], 'the official serena is the user\'s own');
});

// The seed end to end: an install made before the rename (its stamp spells the browser lines the old
// way, its listing holds the old ids, firefox left off in the settings file) is updated. The old rows
// are swapped at their own scope - the user-scope context7 at user scope - each new one before its old
// one goes, firefox arrives off, and nothing new is installed at this scope beside a swapped one.
const OLD_ROWS = [ROW('alfred-code@envoydev'), ROW('serena@envoydev'), ROW('context7@envoydev', { scope: 'user' }), ROW('alfred-memory@envoydev'),
    ROW('playwright-chrome@envoydev'), ROW('playwright-firefox@envoydev', { enabled: false })];
test('seed update over a pre-rename install: every old id is swapped where it is installed, and the engines keep their on/off', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', PW_SELECTION, {
        plugins: JSON.stringify(OLD_ROWS),
        args: ['--installed-only'],
        prepare: installedProject('playwright-browsers: chrome,firefox\nplaywright-enabled: chrome\n', { 'playwright-firefox@envoydev': false }),
        inspect: (repo) => stampOf(repo),
    });
    const moves = calls.filter((c) => /^plugin (install|uninstall|disable|enable) /.test(c));
    const at = (c) => moves.indexOf(c);
    for (const [from, to, scope] of [['serena', 'alfred-navigation', 'project'], ['playwright-chrome', 'browser-chrome', 'project'], ['playwright-firefox', 'browser-firefox', 'project']])
    {
        const install = `plugin install ${to}@envoydev --scope ${scope} -y`;
        const remove = `plugin uninstall ${from}@envoydev --scope ${scope} -y`;
        assert.ok(at(install) >= 0 && at(remove) > at(install), `${from} -> ${to} at ${scope}:\n${moves.join('\n')}`);
        assert.strictEqual(moves.filter((c) => c.startsWith(`plugin install ${to}@`)).length, 1, `${to} installed once:\n${moves.join('\n')}`);
        assert.match(out, new RegExp(`renamed: plugin ${from}@envoydev -> ${to}@envoydev \\[${scope}\\]`));
    }
    // I2: the user-scope context7 serves every project on the account - stood down here, never removed.
    const install = 'plugin install alfred-documentation@envoydev --scope project -y';
    assert.ok(at(install) >= 0 && at('plugin disable context7@envoydev --scope project') > at(install), moves.join('\n'));
    assert.ok(!moves.some((c) => /context7@envoydev --scope user|alfred-documentation@envoydev --scope user/.test(c)), `the account-wide row was touched:\n${moves.join('\n')}`);
    assert.match(out, /!! .*context7@envoydev.*claude plugin uninstall context7@envoydev --scope user/);
    assert.deepStrictEqual(moves.filter((c) => /^plugin disable browser-/.test(c)), ['plugin disable browser-firefox@envoydev --scope project'], moves.join('\n'));
    assert.match(result, /^browser-engines: chrome,firefox$/m, 'the stamp records the engines under the new line');
    assert.match(result, /^browser-enabled: chrome$/m);
    assert.doesNotMatch(result, /^playwright-/m, 'the old lines are not written again');
});

test('seed update over a pre-rename install with a listing it cannot read: the old ids are named with their commands, nothing is guessed', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', PW_SELECTION, {
        plugins: 'not json',
        args: ['--installed-only'],
        prepare: installedProject('installed-always-mcps: serena,context7,memory\nplaywright-browsers: chrome\nplaywright-enabled: chrome\n', null),
    });
    assert.deepStrictEqual(calls.filter((c) => /^plugin uninstall (serena|context7|playwright-)/.test(c)), [], 'a blind run removes nothing it cannot see');
    assert.match(out, /!! the plugin listing could not be read, and this install predates the 2\.0\.0 rename.*claude plugin uninstall serena@envoydev --scope project/);
    // The stamp's old engine line names what the OLD ids installed - never a browser-<engine> already there.
    assert.ok(calls.includes('plugin install browser-chrome@envoydev --scope project -y'), calls.join('\n'));
});

// --- 2.2.0: each optional item at the scope the user chose (--scope-of) ------------------------------------------
// The user's rulings of 2026-10-06: an optional item (engine, desktop server, LSP, claude-hud) goes where the user
// chose, this project by default; an existing install is KEPT where it is on update, and only an explicit choice
// (configure's --scope-of) moves it - installed at the new scope first, so a failed install leaves it serving, then
// removed at the old one. Leaving user scope takes it from every other project, said loud with the way back.
const hudRow = (scope, over = {}) => ({ name: 'claude-hud', marketplace: 'claude-hud', version: '0.8.0', scope, enabled: true, ...over });
test('moveScoped: a choice moves the item - installed at the new scope first, then removed at the old; no choice moves nothing', () =>
{
    const run = cli();
    const logs = [];
    const moved = P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user')], scope: 'project', scopes: { 'claude-hud': 'project' }, cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(run.calls, ['plugin install claude-hud@claude-hud --scope project -y', 'plugin uninstall claude-hud@claude-hud --scope user -y']);
    assert.deepStrictEqual(moved, [{ spec: 'claude-hud@claude-hud', scope: 'project' }]);
    assert.ok(logs.some((m) => /^\s*!! plugin moved \[user -> project\]: claude-hud@claude-hud - every other project on this account loses it; .*claude plugin install claude-hud@claude-hud --scope user/.test(m)), logs.join('\n'));
    const up = cli();
    const upLogs = [];
    P.moveScoped({ plugins: ['typescript-lsp@claude-plugins-official'], rows: [{ name: 'typescript-lsp', marketplace: 'claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true }],
        scope: 'project', scopes: { 'typescript-lsp': 'user' }, cli: up, log: (m) => upLogs.push(m) });
    assert.deepStrictEqual(up.calls, ['plugin install typescript-lsp@claude-plugins-official --scope user -y', 'plugin uninstall typescript-lsp@claude-plugins-official --scope project -y']);
    assert.ok(upLogs.some((m) => /^plugin moved \[project -> user\]/.test(m)) && !upLogs.some((m) => /!!/.test(m)), 'a project row is this project\'s alone - no loud line');
    for (const scopes of [{}, { 'claude-hud': 'user' }])
    {
        const still = cli();
        assert.deepStrictEqual(P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user')], scope: 'project', scopes, cli: still }), []);
        assert.deepStrictEqual(still.calls, [], `${JSON.stringify(scopes)}: no choice, or the scope it already has, moves nothing`);
    }
    const absent = cli();
    assert.deepStrictEqual(P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [], scope: 'project', scopes: { 'claude-hud': 'user' }, cli: absent }), [], 'nothing installed is nothing to move');
    assert.deepStrictEqual(absent.calls, []);
});

test('moveScoped: a failed install removes nothing; a row already at the target loses only the old one; an engine left off arrives off', () =>
{
    const notes = [];
    const failing = cli(['plugin install claude-hud']);
    assert.deepStrictEqual(P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user')], scope: 'project', scopes: { 'claude-hud': 'project' }, cli: failing, note: (m) => notes.push(m) }), []);
    assert.deepStrictEqual(failing.matching(/uninstall/), [], 'the old row keeps serving');
    assert.ok(notes.some((m) => /plugin move failed: claude-hud@claude-hud - it stays at user scope; .*claude plugin install claude-hud@claude-hud --scope project, then claude plugin uninstall claude-hud@claude-hud --scope user/.test(m)), notes.join('\n'));
    // Scope rule 3: a row already at the target moves nothing, and a BROADER row at another scope stays, named.
    const both = cli();
    const bothLogs = [];
    P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user'), hudRow('project')], scope: 'project', scopes: { 'claude-hud': 'project' }, cli: both, log: (m) => bothLogs.push(m) });
    assert.deepStrictEqual(both.calls, []);
    assert.ok(bothLogs.some((m) => /claude-hud@claude-hud is installed at user scope too - kept for the projects that use it/.test(m)), bothLogs.join('\n'));
    // The row this project loads moves; one narrower than the target goes too (it would outrank it), a broader one stays.
    const three = cli();
    P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user'), hudRow('project'), hudRow('local')], scope: 'project', scopes: { 'claude-hud': 'project' }, cli: three });
    assert.deepStrictEqual(three.calls, ['plugin uninstall claude-hud@claude-hud --scope local -y']);
    const toLocal = cli();
    P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user'), hudRow('project')], scope: 'project', scopes: { 'claude-hud': 'local' }, cli: toLocal });
    assert.deepStrictEqual(toLocal.calls, ['plugin install claude-hud@claude-hud --scope local -y', 'plugin uninstall claude-hud@claude-hud --scope project -y']);
    const toUser = cli();
    P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('project'), hudRow('local')], scope: 'project', scopes: { 'claude-hud': 'user' }, cli: toUser });
    assert.deepStrictEqual(toUser.calls, ['plugin install claude-hud@claude-hud --scope user -y', 'plugin uninstall claude-hud@claude-hud --scope local -y', 'plugin uninstall claude-hud@claude-hud --scope project -y']);
    const engine = cli();
    P.moveScoped({ plugins: ['browser-firefox@envoydev'], rows: [{ name: 'browser-firefox', marketplace: 'envoydev', version: '2.1.8', scope: 'user', enabled: false }],
        scope: 'project', scopes: { 'browser-firefox': 'project' }, engines: ['browser-firefox@envoydev'], cli: engine });
    assert.deepStrictEqual(engine.calls, ['plugin install browser-firefox@envoydev --scope project -y', 'plugin disable browser-firefox@envoydev --scope project', 'plugin uninstall browser-firefox@envoydev --scope user -y']);
    // A local run's 'project' is the run's own scope - this checkout.
    const local = cli();
    P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [hudRow('user')], scope: 'local', scopes: { 'claude-hud': 'project' }, cli: local });
    assert.deepStrictEqual(local.matching(/^plugin install/), ['plugin install claude-hud@claude-hud --scope local -y']);
});

// The seed end to end: an update keeps each optional item where it is (the user's 'Keep, configure moves'), and the
// --scope-of configure passes moves it; a re-run with the same choice changes nothing.
test('seed update --installed-only: optional items stay where they are, and --scope-of moves one (configure\'s route)', POSIX_ONLY, () =>
{
    const row = (id, extra = {}) => ({ id, version: '2.1.8', scope: 'project', enabled: true, ...extra });
    const listing = JSON.stringify([
        ...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@envoydev`)),
        row('claude-hud@claude-hud', { version: '0.8.0', scope: 'user' }),
        row('typescript-lsp@claude-plugins-official', { version: '1.0.0' }),
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
    };
    const sel = 'skill markdown-style\nplugin claude-hud\nplugin typescript-lsp\n';
    const kept = seedRun('update', sel, { plugins: listing, args: ['--installed-only'], prepare });
    const moves = (calls) => calls.filter((c) => /^plugin (install|uninstall) (claude-hud|typescript-lsp)@/.test(c));
    assert.deepStrictEqual(moves(kept.calls), [], `no choice moves nothing:\n${kept.calls.join('\n')}`);
    assert.ok(kept.calls.includes('plugin update claude-hud@claude-hud --scope user -y') && kept.calls.includes('plugin update typescript-lsp@claude-plugins-official --scope project -y'), kept.calls.join('\n'));
    const moved = seedRun('update', sel, { plugins: listing, args: ['--installed-only', '--scope-of', 'claude-hud=project', '--scope-of', 'typescript-lsp=global'], prepare });
    for (const [spec, from, to] of [['claude-hud@claude-hud', 'user', 'project'], ['typescript-lsp@claude-plugins-official', 'project', 'user']])
        assert.deepStrictEqual(moves(moved.calls).filter((c) => c.includes(` ${spec} `)), [`plugin install ${spec} --scope ${to} -y`, `plugin uninstall ${spec} --scope ${from} -y`], moved.calls.join('\n'));
    assert.match(moved.out, /!! plugin moved \[user -> project\]: claude-hud@claude-hud/);
    assert.ok(!moved.calls.includes('plugin install claude-hud@claude-hud --scope user -y'), 'the moved item is not installed back at its old scope');
});
