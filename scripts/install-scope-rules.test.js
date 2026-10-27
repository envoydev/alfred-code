'use strict';
// THE SCOPE RULES - every scope Claude Code offers, read from its docs (code.claude.com/docs/en/plugins/cli-reference,
// /plugins/loading, /mcp, /managed-mcp; checked 2026-10-08):
//   1. (retired 2026-10-24 with the servers: no server installs beside the core);
//   2. a plugin at several scopes loads its narrowest row (local, project, user);
//   3. an uninstall takes one scope's row and leaves the rest;
//   4. an update refreshes every scope a plugin is installed at;
//   5. a narrower scope switches a broader one's plugin off for itself alone;
//   6. scope moves and removals come only from install (setup) and configure - pinned in the command bodies;
//   7. every mutating CLI call names its scope;
//   8. managed scope is update-only - never installed to, removed from or overridden.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const P = require('./install/plugins.js');
const settings = require('./install/settings.js');
const stamp = require('./install/stamp.js');
const { itemScopes } = require('./install/selection.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

function cli(fails = [])
{
    const calls = [];
    const run = (argv) => { calls.push(argv.join(' ')); return !fails.some((f) => argv.join(' ').includes(f)); };
    run.calls = calls;
    run.matching = (re) => calls.filter((c) => re.test(c));
    return run;
}
const row = (name, scope, extra = {}) => ({ name, marketplace: 'envoydev', version: '2.2.2', scope, enabled: true, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scope-rules-'));

// --- rule 2: the narrowest row ---------------------------------------------------------

test('rule 2: one plugin at several scopes reads its narrowest row - local over project over user over managed', () =>
{
    const here = path.resolve('/work/app');
    const json = JSON.stringify([
        { id: 'x@envoydev', version: '4', scope: 'managed', enabled: true },
        { id: 'x@envoydev', version: '3', scope: 'user', enabled: true },
        { id: 'x@envoydev', version: '2', scope: 'project', enabled: true, projectPath: here },
        { id: 'x@envoydev', version: '1', scope: 'local', enabled: true, projectPath: here },
    ]);
    assert.strictEqual(P.parsePluginList(json, here)[0].scope, 'local');
    // In any listed order.
    assert.strictEqual(P.parsePluginList(JSON.stringify(JSON.parse(json).reverse()), here)[0].scope, 'local');
    assert.strictEqual(P.parsePluginList(JSON.stringify(JSON.parse(json).slice(0, 3)), here)[0].scope, 'project');
    assert.strictEqual(P.parsePluginList(JSON.stringify(JSON.parse(json).slice(0, 2)), here)[0].scope, 'user');
    assert.strictEqual(P.parsePluginList(JSON.stringify(JSON.parse(json).slice(0, 1)), here)[0].scope, 'managed');
    assert.deepStrictEqual(P.scopesOf(P.parsePluginList(json, here, { everyScope: true }), 'x@envoydev'), ['local', 'project', 'user', 'managed']);
});

test('rule 2: the on/off this project loads is the narrowest settings file that names the plugin', () =>
{
    const said = { 'x@envoydev': { user: true, project: false } };
    const isOn = (spec, scope) => (said[spec] || {})[scope];
    assert.strictEqual(P.effectiveOn(isOn, 'x@envoydev'), false, 'a project off beats a user on');
    assert.strictEqual(P.effectiveOn(() => undefined, 'x@envoydev'), undefined, 'no file names it');
    const rows = P.withEffective([row('x', 'user'), row('y', 'managed', { enabled: false })], isOn);
    assert.strictEqual(rows[0].enabled, false);
    assert.strictEqual(rows[1].enabled, false, 'a managed row keeps its own flag');
});

// --- rule 5: the reach of a narrower scope ----------------------------------------------

test('rule 5: a run switches off its own scope\'s row, a BROADER row as an override at its own scope, never a narrower or managed one', () =>
{
    const cases = [
        ['project', 'project', 'project'], ['user', 'project', 'project'], ['local', 'project', ''], ['managed', 'project', ''],
        ['local', 'local', 'local'], ['project', 'local', 'local'], ['user', 'local', 'local'], ['managed', 'local', ''],
        ['user', 'user', 'user'], ['project', 'user', ''], ['local', 'user', ''], ['managed', 'user', ''],
        ['', 'project', 'project'],
    ];
    for (const [rowScope, run, want] of cases) assert.strictEqual(P.overrideScope(rowScope, run), want, `${rowScope || '(none)'} under a ${run} run`);
});

test('rule 5: the full copy route switches a broader core off for this project alone and records it; a narrower or managed row is named', () =>
{
    const run = cli();
    const off = P.copyRouteStandDown({ rows: [row('alfred-code', 'user')], scope: 'project', isOn: () => undefined, cli: run });
    assert.deepStrictEqual(run.calls, ['plugin disable alfred-code@envoydev --scope project']);
    assert.deepStrictEqual(off, [{ scope: 'project', spec: 'alfred-code@envoydev' }]);
    for (const [scope, said] of [['local', /alfred-code@envoydev is enabled at local scope, not this run's/], ['managed', /alfred-code@envoydev is installed at managed scope - your organization's managed settings own it/]])
    {
        const narrow = cli();
        const log = [];
        assert.deepStrictEqual(P.copyRouteStandDown({ rows: [row('alfred-code', scope)], scope: 'project', isOn: () => undefined, cli: narrow, log: (l) => log.push(l) }), []);
        assert.deepStrictEqual(narrow.calls, [], scope);
        assert.match(log.join('\n'), said);
        assert.ok(!log.join('\n').includes('--scope managed'), 'never a --scope managed command');
    }
    // A re-run with the override in place calls nothing.
    const again = cli();
    P.copyRouteStandDown({ rows: [row('alfred-code', 'user')], scope: 'project', isOn: (spec, scope) => (spec === 'alfred-code@envoydev' && scope === 'project' ? false : undefined), cli: again });
    assert.deepStrictEqual(again.calls, []);
});

// --- rule 4 and 8: every scope updated, managed update-only -----------------------------

test('rule 4: update refreshes a plugin at EVERY scope it is installed at, managed included, and enables only where this project loads it', () =>
{
    const run = cli();
    const rows = [row('alfred-code', 'project'), row('alfred-code', 'user'), row('alfred-code', 'managed'),
        row('typescript-lsp', 'user', { marketplace: 'claude-plugins-official' }), row('typescript-lsp', 'local', { marketplace: 'claude-plugins-official' })];
    P.updatePlugins({ plugins: ['alfred-code@envoydev', 'typescript-lsp@claude-plugins-official'], scope: 'project', before: P.parsePluginList(JSON.stringify(rows.map((r) => ({ ...r, id: `${r.name}@${r.marketplace}` }))), '.'), rows, cli: run, after: [] });
    const scopesOf = (name) => run.matching(new RegExp(`^plugin update ${name}@`)).map((c) => /--scope (\w+)/.exec(c)[1]).sort();
    assert.deepStrictEqual(scopesOf('alfred-code'), ['managed', 'project', 'user']);
    assert.deepStrictEqual(scopesOf('typescript-lsp'), ['local', 'user']);
    assert.deepStrictEqual(run.matching(/^plugin (install|enable|disable|uninstall) /), [], 'the admin\'s row and the user\'s rows are only updated');
    assert.ok(!run.calls.some((c) => /--scope managed/.test(c) && !/^plugin update /.test(c)), 'managed takes update only');
});

test('rule 8: a plugin the admin installed is updated at managed scope and never installed beside it', () =>
{
    const run = cli();
    const log = [];
    const rows = [row('claude-hud', 'managed', { marketplace: 'claude-hud' })];
    P.installPlugins({ plugins: ['claude-hud@claude-hud'], scope: 'project', before: rows, rows, cli: run, log: (l) => log.push(l) });
    assert.deepStrictEqual(run.matching(/claude-hud@claude-hud/), ['plugin update claude-hud@claude-hud --scope managed -y']);
    assert.match(log.join('\n'), /installed by your organization's managed settings, updated only/);
});

test('rule 8: no prune or move touches a managed row - each is named without a --scope managed command', () =>
{
    const log = [];
    const run = cli();
    P.prunedRetired({ rows: [row('old-x', 'managed')], retired: ['old-x'], scope: 'project', cli: run, log: (l) => log.push(l) });
    const moved = P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [row('claude-hud', 'managed', { marketplace: 'claude-hud' })], scope: 'project', scopes: { 'claude-hud': 'user' }, cli: run });
    assert.deepStrictEqual(run.calls, [], run.calls.join('\n'));
    assert.deepStrictEqual(moved, []);
    assert.ok(log.length >= 1, log.join('\n'));
    assert.ok(log.every((l) => /managed scope - your organization's managed settings own it/.test(l)), log.join('\n'));
    assert.ok(!log.join('\n').includes('--scope managed'));
});

// --- rule 3: one scope's row -------------------------------------------------------------

// A retired plugin's project and local rows are THIS project's, so the prune takes both; a user row serves every project
// of the account and is named with its command, never removed.
test('rule 3: a retired plugin pruned under a project run takes this project\'s rows and leaves the user row, named', () =>
{
    const run = cli();
    const log = [];
    P.prunedRetired({ rows: [row('old-x', 'user'), row('old-x', 'project'), row('old-x', 'local')], retired: ['old-x'], scope: 'project', cli: run, log: (l) => log.push(l) });
    assert.deepStrictEqual(run.calls, ['plugin uninstall old-x@envoydev --scope project -y', 'plugin uninstall old-x@envoydev --scope local -y']);
    assert.strictEqual(log.filter((l) => /old-x@envoydev is installed at user scope, not this run's - kept for the projects that use it/.test(l)).length, 1, log.join('\n'));
});

// --- every scope, read back --------------------------------------------------------------

test('scopes: the read-back names local and managed items as such, and an item at several reads its narrowest', () =>
{
    const at = (name, scope) => ({ name, version: '1', scope });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'user'), at('typescript-lsp', 'local'), at('csharp-lsp', 'managed')]),
        { 'claude-hud': 'global', 'typescript-lsp': 'local', 'csharp-lsp': 'managed' });
    assert.deepStrictEqual(itemScopes([at('typescript-lsp', 'project')]), { 'typescript-lsp': 'project' });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'user'), at('claude-hud', 'local'), at('claude-hud', 'project')]), { 'claude-hud': 'local' });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'managed'), at('claude-hud', 'user')]), { 'claude-hud': 'global' });
    assert.strictEqual(P.itemScope('claude-hud@claude-hud', 'project', { 'claude-hud': 'local' }), 'local');
    assert.strictEqual(P.scopeFor('claude-hud@claude-hud', 'project', [], { 'claude-hud': 'local' }), 'local');
});

// --- rule 7: every mutating call names its scope -----------------------------------------

test('rule 7: every plugin and MCP call that changes something names its scope - plugins default to user, MCP servers to local, so none may go unnamed', () =>
{
    const dir = path.join(ROOT, 'scripts', 'install');
    const bad = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')))
    {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const m of text.matchAll(/\[\s*'(plugin|mcp)',\s*'(install|uninstall|enable|disable|update|add|remove)'[^\]]*\]/g))
        {
            if (m[1] === 'plugin' && m[2] === 'add') continue;
            const call = m[0];
            if (!/'--scope'|'-s'/.test(call)) bad.push(`${file}: ${call}`);
        }
    }
    assert.deepStrictEqual(bad, [], bad.join('\n'));
});

// --- MCP: the narrower deny an earlier release wrote -------------------------------------

test('rule 5 (MCP): the deny entry is written once, lifted only in its own shape, and a list that is not a list is left alone', () =>
{
    const dir = tmp();
    const file = path.join(dir, 'settings.json');
    try
    {
        const log = [];
        // Missing file: made.
        assert.deepStrictEqual(settings.applyMcpDeny({ file, add: ['macos-control'], log: (l) => log.push(l) }), { added: ['macos-control'], lifted: [] });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deniedMcpServers, [{ serverName: 'macos-control' }]);
        // Re-run: nothing written.
        const mtime = fs.statSync(file).mtimeMs;
        settings.applyMcpDeny({ file, add: ['macos-control'] });
        assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
        // The user's own rows stay, and keep their order; a lift takes only the bare serverName row.
        fs.writeFileSync(file, JSON.stringify({ permissions: { deny: ['Read(.env)'] }, deniedMcpServers: [{ serverUrl: 'https://bad/*' }, { serverName: 'macos-control' }, { serverName: 'macos-control', note: 'mine' }] }));
        assert.deepStrictEqual(settings.applyMcpDeny({ file, lift: ['macos-control'] }), { added: [], lifted: ['macos-control'] });
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(after.deniedMcpServers, [{ serverUrl: 'https://bad/*' }, { serverName: 'macos-control', note: 'mine' }]);
        assert.deepStrictEqual(after.permissions, { deny: ['Read(.env)'] });
        // A list emptied by the lift goes.
        fs.writeFileSync(file, JSON.stringify({ deniedMcpServers: [{ serverName: 'x' }] }));
        settings.applyMcpDeny({ file, lift: ['x'] });
        assert.ok(!('deniedMcpServers' in JSON.parse(fs.readFileSync(file, 'utf8'))));
        // Not a list, or garbage: nothing changes, said.
        for (const body of ['{"deniedMcpServers": {"serverName": "x"}}', '{ nope'])
        {
            fs.writeFileSync(file, body);
            const notes = [];
            assert.strictEqual(settings.applyMcpDeny({ file, add: ['y'], note: (n) => notes.push(n) }), null);
            assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
            assert.strictEqual(notes.length, 1);
        }
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rule 5 (MCP): the stamp\'s mcp-denied line round-trips, and a hand-edited entry of another shape is dropped', () =>
{
    const dir = tmp();
    try
    {
        const file = path.join(dir, 'alfred-code.stamp');
        fs.writeFileSync(file, 'version: 2.2.2\nmcp-denied: project:macos-control, local:chrome-control, user:x, managed:y, project:../evil\n');
        assert.deepStrictEqual(stamp.readMcpDenied(file), [{ scope: 'project', name: 'macos-control' }, { scope: 'local', name: 'chrome-control' }]);
        assert.deepStrictEqual(stamp.readMcpDenied(path.join(dir, 'none')), []);
        const base = { sha: 'abc', hooks: [], alwaysRules: [], alwaysMcps: [] };
        assert.match(stamp.renderStamp({ ...base, mcpDenied: [{ scope: 'project', name: 'macos-control' }] }), /^mcp-denied: project:macos-control$/m);
        assert.doesNotMatch(stamp.renderStamp(base), /mcp-denied/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- end to end through the seed ---------------------------------------------------------

const coreRows = (scope, extra = []) => JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.2.2', scope, enabled: true }, ...extra]);
const installed = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
};

test('seed update: each stack entry and third-party pick is updated at every scope it is installed at, the admin\'s managed row included', POSIX_ONLY, () =>
{
    const listing = coreRows('project', [
        { id: 'alfred-code@envoydev', version: '2.2.2', scope: 'user', enabled: true },
        { id: 'alfred-code@envoydev', version: '2.2.2', scope: 'managed', enabled: true },
    ]);
    const { calls, out } = seedRun('update', 'rule markdown-docs\n', { plugins: listing, args: ['--installed-only', '--scope', 'project'], prepare: installed });
    const core = calls.filter((c) => /^plugin update alfred-code@envoydev /.test(c)).map((c) => /--scope (\w+)/.exec(c)[1]);
    assert.deepStrictEqual([...new Set(core)].sort(), ['managed', 'project', 'user'], `${out}\n${calls.join('\n')}`);
    assert.ok(!calls.some((c) => /--scope managed/.test(c) && !/^plugin update /.test(c)), calls.join('\n'));
    assert.ok(!calls.some((c) => /^plugin install alfred-code@/.test(c)), 'the admin\'s core is not installed beside');
});

test('seed install: a core the admin installed alone is updated at managed scope, and nothing is installed beside it', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.2.2', scope: 'managed', enabled: true }]);
    for (const scope of ['project', 'local', 'user'])
    {
        const { calls } = seedRun('install', 'rule markdown-docs\n', { plugins: listing, args: ['--scope', scope] });
        assert.ok(!calls.some((c) => /^plugin install alfred-/.test(c)), `${scope}:\n${calls.join('\n')}`);
        assert.ok(calls.includes('plugin update alfred-code@envoydev --scope managed -y'), `${scope}:\n${calls.join('\n')}`);
        assert.ok(!calls.some((c) => /--scope managed/.test(c) && !/^plugin update /.test(c)), calls.join('\n'));
    }
});

// An earlier release switched a broader server off for this project alone (a `deniedMcpServers` row and the stamp's
// `mcp-denied:` record). Uninstall lifts what the record names in its own shape; a row of the user's own stays.
test('seed uninstall: the deny entries an earlier release wrote are lifted, a row of the user\'s own stays', POSIX_ONLY, () =>
{
    const { result, outs } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        plugins: coreRows('project'),
        args: [['--scope', 'project'], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const file = path.join(repo, '.claude', 'settings.json');
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            data.deniedMcpServers = [{ serverName: 'macos-control' }, { serverName: 'mine' }];
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
            fs.writeFileSync(stampFile, `${fs.readFileSync(stampFile, 'utf8').replace(/\n*$/, '')}\nmcp-denied: project:macos-control\n`);
            return null;
        },
        inspect: (repo) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).deniedMcpServers; } catch { return 'gone'; } },
    });
    assert.deepStrictEqual(result, [{ serverName: 'mine' }], outs[1]);
});
