'use strict';
// THE SCOPE RULES - every scope Claude Code offers, read from its docs (code.claude.com/docs/en/plugins/cli-reference,
// /plugins/loading, /mcp, /managed-mcp; checked 2026-10-08):
//   1. the three alfred- servers install at the core's scope (user scope when the core is the admin's alone);
//   2. a plugin at several scopes loads its narrowest row (local, project, user);
//   3. an uninstall takes one scope's row and leaves the rest;
//   4. an update refreshes every scope a plugin or a stack registration is installed at;
//   5. a narrower scope switches a broader one's plugin or server off for itself alone;
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
const mcp = require('./install/mcp.js');
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
const LOCKED = ['alfred-navigation', 'alfred-documentation', 'alfred-memory'];
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
    const log = [];
    const rows = [row('alfred-code', 'user'), row('alfred-navigation', 'local'), row('alfred-memory', 'managed')];
    const off = P.copyRouteStandDown({ rows, scope: 'project', locked: LOCKED, isOn: () => undefined, cli: run, log: (l) => log.push(l) });
    assert.deepStrictEqual(run.calls, ['plugin disable alfred-code@envoydev --scope project']);
    assert.deepStrictEqual(off, [{ scope: 'project', spec: 'alfred-code@envoydev' }]);
    assert.ok(log.some((l) => /alfred-navigation@envoydev is enabled at local scope/.test(l)), log.join('\n'));
    assert.ok(log.some((l) => /alfred-memory@envoydev is installed at managed scope - your organization's managed settings own it/.test(l)), log.join('\n'));
    assert.ok(!log.join('\n').includes('--scope managed'), 'never a --scope managed command');
    // A re-run with the override in place calls nothing.
    const again = cli();
    P.copyRouteStandDown({ rows, scope: 'project', locked: LOCKED, isOn: (spec, scope) => (spec === 'alfred-code@envoydev' && scope === 'project' ? false : undefined), cli: again });
    assert.deepStrictEqual(again.calls, []);
});

test('rule 5: on the full copy route an engine\'s broader row is switched off here; on the MCP copy route its command is named', () =>
{
    const rows = [row('browser-chrome', 'user')];
    const full = cli();
    const r1 = P.engineStandDown({ rows, scope: 'local', engines: ['chrome'], hereOnly: true, isOn: () => undefined, cli: full });
    assert.deepStrictEqual(full.calls, ['plugin disable browser-chrome@envoydev --scope local']);
    assert.deepStrictEqual(r1.off, [{ scope: 'local', spec: 'browser-chrome@envoydev' }]);
    const part = cli();
    const log = [];
    P.engineStandDown({ rows, scope: 'project', engines: ['chrome'], isOn: () => undefined, cli: part, log: (l) => log.push(l) });
    assert.deepStrictEqual(part.calls, [], 'nothing switched at another scope off the full copy route');
    assert.match(log.join('\n'), /claude plugin disable browser-chrome@envoydev --scope project/);
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

test('rule 1 + 8: a core installed only at managed scope sends the three alfred- servers to user scope, said once; one the admin carries too is left to it', () =>
{
    const log = [];
    const core = [row('alfred-code', 'managed')];
    assert.deepStrictEqual(P.requiredScopes({ rows: core, locked: LOCKED, log: (l) => log.push(l) }),
        { 'alfred-navigation': 'user', 'alfred-documentation': 'user', 'alfred-memory': 'user' });
    assert.strictEqual(log.filter((l) => /^ {2}!! alfred-code is installed only by your organization's managed settings/.test(l)).length, 1, log.join('\n'));
    assert.deepStrictEqual(P.requiredScopes({ rows: [...core, row('alfred-memory', 'managed')], locked: LOCKED }), { 'alfred-navigation': 'user', 'alfred-documentation': 'user' });
    // A core the user installed (alone, or beside the admin's) keeps the run's scope for all three.
    assert.deepStrictEqual(P.requiredScopes({ rows: [row('alfred-code', 'project')], locked: LOCKED }), {});
    assert.deepStrictEqual(P.requiredScopes({ rows: [...core, row('alfred-code', 'local')], locked: LOCKED }), {});
    assert.deepStrictEqual(P.requiredScopes({ rows: [], locked: LOCKED }), {}, 'no core yet: the run installs it at its own scope');
    // installPlugins carries the pin through: the core is updated at managed, each server installed at user.
    const run = cli();
    const pinned = P.requiredScopes({ rows: core, locked: LOCKED });
    P.installPlugins({ plugins: ['alfred-code@envoydev', ...LOCKED.map((n) => `${n}@envoydev`)], scope: 'project', pinned, before: core, rows: core, cli: run });
    assert.deepStrictEqual(run.matching(/^plugin (install|update) alfred-code@/), ['plugin update alfred-code@envoydev --scope managed -y']);
    for (const n of LOCKED) assert.deepStrictEqual(run.matching(new RegExp(`^plugin install ${n}@`)), [`plugin install ${n}@envoydev --scope user -y`]);
});

test('rule 8: no prune, rename, move or uninstall touches a managed row - each is named without a --scope managed command', () =>
{
    const log = [];
    const run = cli();
    P.prunedRetired({ rows: [row('old-x', 'managed')], retired: ['old-x'], scope: 'project', cli: run, log: (l) => log.push(l) });
    P.uninstallEngines({ specs: ['browser-chrome@envoydev'], rows: [row('browser-chrome', 'managed')], scope: 'project', cli: run, log: (l) => log.push(l) });
    const moved = P.moveScoped({ plugins: ['claude-hud@claude-hud'], rows: [row('claude-hud', 'managed', { marketplace: 'claude-hud' })], scope: 'project', scopes: { 'claude-hud': 'user' }, cli: run });
    P.migrateRenamed({ rows: [row('navigation', 'managed')], renamed: { navigation: 'alfred-navigation' }, set: ['alfred-navigation@envoydev'], scope: 'project', cli: run, log: (l) => log.push(l) });
    assert.deepStrictEqual(run.calls, [], run.calls.join('\n'));
    assert.deepStrictEqual(moved, []);
    assert.ok(log.length >= 3, log.join('\n'));
    assert.ok(log.every((l) => /managed scope - your organization's managed settings own it/.test(l)), log.join('\n'));
    assert.ok(!log.join('\n').includes('--scope managed'));
});

test('rule 4: an engine installed at two scopes is updated at both, and switched only where this project loads it', () =>
{
    const run = cli();
    const rows = [row('browser-chrome', 'user'), row('browser-chrome', 'project')];
    const before = P.parsePluginList(JSON.stringify(rows.map((r) => ({ ...r, id: `${r.name}@envoydev`, projectPath: r.scope === 'user' ? undefined : process.cwd() }))), process.cwd(), { byMarketplace: true });
    const engines = { specs: ['browser-chrome@envoydev'], present: [], presentScope: {}, off: [], on: [], isOn: () => true };
    P.updatePlugins({ plugins: ['browser-chrome@envoydev'], scope: 'project', before, rows, engines, cli: run, after: [] });
    assert.deepStrictEqual(run.matching(/^plugin update /).map((c) => /--scope (\w+)/.exec(c)[1]), ['project', 'user']);
    assert.deepStrictEqual(run.matching(/^plugin (enable|disable) /), ['plugin disable browser-chrome@envoydev --scope project']);
});

// --- rule 3: one scope's row -------------------------------------------------------------

test('rule 3: an engine dropped at project scope leaves its user and local rows', () =>
{
    const run = cli();
    const log = [];
    P.uninstallEngines({ specs: ['browser-chrome@envoydev'], rows: [row('browser-chrome', 'user'), row('browser-chrome', 'project'), row('browser-chrome', 'local')], scope: 'project', cli: run, log: (l) => log.push(l) });
    assert.deepStrictEqual(run.calls, ['plugin uninstall browser-chrome@envoydev --scope project -y']);
    assert.strictEqual(log.filter((l) => /kept for the projects that use it/.test(l)).length, 2, log.join('\n'));
});

// --- every scope, read back --------------------------------------------------------------

test('scopes: the read-back names local and managed items as such, and an item at several reads its narrowest', () =>
{
    const at = (name, scope) => ({ name, version: '1', scope });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'user'), at('typescript-lsp', 'local'), at('csharp-lsp', 'managed'), at('browser-chrome', 'project')]),
        { 'claude-hud': 'global', 'typescript-lsp': 'local', 'csharp-lsp': 'managed', 'browser-chrome': 'project' });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'user'), at('claude-hud', 'local'), at('claude-hud', 'project')]), { 'claude-hud': 'local' });
    assert.deepStrictEqual(itemScopes([at('claude-hud', 'managed'), at('claude-hud', 'user')]), { 'claude-hud': 'global' });
    assert.strictEqual(P.itemScope('claude-hud@claude-hud', 'project', { 'claude-hud': 'local' }), 'local');
    assert.strictEqual(P.scopeFor('claude-hud@claude-hud', 'project', [], { 'claude-hud': 'local' }), 'local');
});

// --- rule 7: every mutating call names its scope -----------------------------------------

test('rule 7: every plugin and MCP call that changes something names its scope - plugins default to user, MCP servers to local', () =>
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
    // mcp.registerSpec builds the `mcp add` argv - its two forms both carry --scope.
    for (const form of [mcp.registerSpec({ name: 'x', args: '@HTTP@', scope: 'local' }), mcp.registerSpec({ name: 'x', args: 'npx -y pkg', scope: 'user' })])
        assert.ok(form.includes('--scope'), form.join(' '));
    assert.deepStrictEqual(bad, [], bad.join('\n'));
});

// --- MCP: managed config, narrower deny ------------------------------------------------

test('rule 8 (MCP): the admin\'s managed-mcp.json and managedMcpServers are read from the managed folder - nothing else', () =>
{
    const dir = tmp();
    try
    {
        assert.deepStrictEqual(mcp.adminMcp({ env: { ALFRED_CODE_MANAGED_DIR: dir } }), { dir, exclusive: false, names: new Set() });
        fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ managedMcpServers: { search: { type: 'http', url: 'https://x' } } }));
        fs.mkdirSync(path.join(dir, 'managed-settings.d'));
        fs.writeFileSync(path.join(dir, 'managed-settings.d', '10-team.json'), JSON.stringify({ managedMcpServers: { 'alfred-documentation': {} } }));
        fs.writeFileSync(path.join(dir, 'managed-settings.d', 'notes.txt'), '{ "managedMcpServers": { "ignored": {} } }');
        let got = mcp.adminMcp({ env: { ALFRED_CODE_MANAGED_DIR: dir } });
        assert.deepStrictEqual([got.exclusive, [...got.names].sort()], [false, ['alfred-documentation', 'search']]);
        fs.writeFileSync(path.join(dir, 'managed-mcp.json'), JSON.stringify({ mcpServers: { github: {} } }));
        got = mcp.adminMcp({ env: { ALFRED_CODE_MANAGED_DIR: dir } });
        assert.deepStrictEqual([got.exclusive, [...got.names].sort()], [true, ['alfred-documentation', 'github', 'search']]);
        // Garbage reads as nothing provided - never a crash.
        fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{ nope');
        assert.ok(!mcp.adminMcp({ env: { ALFRED_CODE_MANAGED_DIR: dir } }).names.has('search'));
        assert.strictEqual(mcp.adminMcp({ env: {}, platform: 'linux' }).dir, '/etc/claude-code');
        assert.strictEqual(mcp.adminMcp({ env: {}, platform: 'win32' }).dir, 'C:\\Program Files\\ClaudeCode');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rule 5 (MCP): the deny entry is written once, lifted only in its own shape, and a list that is not a list is left alone', () =>
{
    const dir = tmp();
    const file = path.join(dir, 'settings.json');
    try
    {
        const log = [];
        // Missing file: made.
        assert.deepStrictEqual(settings.applyMcpDeny({ file, add: ['macos-desktop'], log: (l) => log.push(l) }), { added: ['macos-desktop'], lifted: [] });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deniedMcpServers, [{ serverName: 'macos-desktop' }]);
        // Re-run: nothing written.
        const mtime = fs.statSync(file).mtimeMs;
        settings.applyMcpDeny({ file, add: ['macos-desktop'] });
        assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
        // The user's own rows stay, and keep their order; a lift takes only the bare serverName row.
        fs.writeFileSync(file, JSON.stringify({ permissions: { deny: ['Read(.env)'] }, deniedMcpServers: [{ serverUrl: 'https://bad/*' }, { serverName: 'macos-desktop' }, { serverName: 'macos-desktop', note: 'mine' }] }));
        assert.deepStrictEqual(settings.applyMcpDeny({ file, lift: ['macos-desktop'] }), { added: [], lifted: ['macos-desktop'] });
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(after.deniedMcpServers, [{ serverUrl: 'https://bad/*' }, { serverName: 'macos-desktop', note: 'mine' }]);
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
        fs.writeFileSync(file, 'version: 2.2.2\nmcp-denied: project:macos-desktop, local:browser-chrome, user:x, managed:y, project:../evil\n');
        assert.deepStrictEqual(stamp.readMcpDenied(file), [{ scope: 'project', name: 'macos-desktop' }, { scope: 'local', name: 'browser-chrome' }]);
        assert.deepStrictEqual(stamp.readMcpDenied(path.join(dir, 'none')), []);
        const base = { sha: 'abc', hooks: [], alwaysRules: [], alwaysMcps: [] };
        assert.match(stamp.renderStamp({ ...base, mcpDenied: [{ scope: 'project', name: 'macos-desktop' }] }), /^mcp-denied: project:macos-desktop$/m);
        assert.doesNotMatch(stamp.renderStamp(base), /mcp-denied/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- end to end through the seed ---------------------------------------------------------

const coreRows = (scope, extra = []) => JSON.stringify([
    ...['alfred-code', ...LOCKED].map((n) => ({ id: `${n}@envoydev`, version: '2.2.2', scope, enabled: true })),
    ...extra,
]);
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

test('seed install: a core the admin installed alone is updated at managed scope, and the three alfred- servers go to user scope with one !! line', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.2.2', scope: 'managed', enabled: true }]);
    for (const scope of ['project', 'local', 'user'])
    {
        const { calls, out } = seedRun('install', 'rule markdown-docs\n', { plugins: listing, args: ['--scope', scope] });
        assert.ok(!calls.some((c) => /^plugin install alfred-code@/.test(c)), `${scope}:\n${calls.join('\n')}`);
        assert.ok(calls.includes('plugin update alfred-code@envoydev --scope managed -y'), `${scope}:\n${calls.join('\n')}`);
        for (const n of LOCKED) assert.ok(calls.includes(`plugin install ${n}@envoydev --scope user -y`), `${scope}: ${n}\n${calls.join('\n')}`);
        assert.strictEqual((out.match(/!! alfred-code is installed only by your organization's managed settings/g) || []).length, 1, out);
        assert.ok(!calls.some((c) => /--scope managed/.test(c) && !/^plugin update /.test(c)), calls.join('\n'));
    }
});

test('seed update --installed-only --drop: an entry enabled at USER scope is switched off for this project alone, and the next update keeps it off', POSIX_ONLY, () =>
{
    const desktop = { id: 'macos-desktop@envoydev', version: '2.2.2', scope: 'user', enabled: true };
    const listing = coreRows('project', [desktop]);
    const env = { ALFRED_CODE_PLATFORM: 'darwin' };
    const sel = 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n';
    const { calls, outs, steps } = seedRun(['update', 'update'], sel, {
        plugins: listing, env, prepare: installed,
        args: [['--installed-only', '--scope', 'project', '--drop', 'mcp macos-desktop'], ['--installed-only', '--scope', 'project']],
        // The CLI writes the override the first run asked for; the stub records calls only, so it is written here.
        each: (repo, i) =>
        {
            const file = path.join(repo, '.claude', 'settings.json');
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (i === 0) { (data.enabledPlugins ||= {})['macos-desktop@envoydev'] = false; fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
            return fs.readFileSync(path.join(repo, '..', 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
        },
    });
    const first = calls.slice(0, steps[0]);
    const second = calls.slice(steps[0]);
    assert.ok(first.includes('plugin disable macos-desktop@envoydev --scope project'), `${outs[0]}\n${first.join('\n')}`);
    assert.ok(!first.some((c) => /macos-desktop@envoydev --scope user/.test(c) && !/^plugin update /.test(c)), 'the user row is never disabled or removed');
    assert.match(outs[0], /plugin disabled \[project\]: macos-desktop@envoydev \(nothing kept needs it after --drop - this project only, the user-scope install stays on for every other project\)/);
    assert.ok(!second.some((c) => /^plugin (install|enable) macos-desktop@/.test(c)), `the next update brought it back:\n${second.join('\n')}`);
});

test('seed update --installed-only --drop: a row NARROWER than the run (local under a project run) and a managed row are named, never switched', POSIX_ONLY, () =>
{
    for (const scope of ['local', 'managed'])
    {
        const listing = coreRows('project', [{ id: 'macos-desktop@envoydev', version: '2.2.2', scope, enabled: true }]);
        const { calls, out } = seedRun('update', 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n', {
            plugins: listing, env: { ALFRED_CODE_PLATFORM: 'darwin' }, prepare: installed,
            args: ['--installed-only', '--scope', 'project', '--drop', 'mcp macos-desktop'],
        });
        assert.ok(!calls.some((c) => /^plugin (disable|uninstall) macos-desktop@/.test(c)), `${scope}:\n${calls.join('\n')}`);
        assert.match(out, scope === 'managed' ? /macos-desktop@envoydev is installed at managed scope - your organization's managed settings own it/ : /macos-desktop@envoydev is enabled at local scope, narrower than this run's project/, out);
    }
});

test('seed install (MCP): a managed-mcp.json is said loud, and a server the managed config provides is never registered over', POSIX_ONLY, () =>
{
    const managed = tmp();
    try
    {
        fs.writeFileSync(path.join(managed, 'managed-settings.json'), JSON.stringify({ managedMcpServers: { 'macos-desktop': { type: 'http', url: 'https://desk' } } }));
        const env = { ALFRED_CODE_MANAGED_DIR: managed, ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' };
        const sel = 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n';
        const a = seedRun('install', sel, { env, account: true });
        assert.ok(!a.calls.some((c) => /^mcp (add|remove) .*macos-desktop/.test(c)), a.calls.join('\n'));
        assert.match(a.out, /mcp macos-desktop: provided by your organization's managed MCP config - not registered here/);
        assert.doesNotMatch(a.out, /managed-mcp\.json is deployed/);
        fs.writeFileSync(path.join(managed, 'managed-mcp.json'), JSON.stringify({ mcpServers: { github: {} } }));
        for (const route of [env, { ALFRED_CODE_MANAGED_DIR: managed }])
        {
            const b = seedRun('install', sel, { env: route, account: true });
            assert.match(b.out, /!! mcp: .*managed-mcp\.json is deployed - Claude Code loads only the servers it and the managed settings list/, b.out);
            assert.ok(!b.calls.some((c) => /^mcp add /.test(c)), b.calls.join('\n'));
        }
    }
    finally { fs.rmSync(managed, { recursive: true, force: true }); }
});

// The MCP copy route with the core on registers at the run's own scope, so a user-scope run leaves a user-scope
// registration in the account file - the BROADER registration a later project-scope install sits under.
const MCP_COPY = { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' };
const DESK = 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n';
const deskState = (repo) =>
{
    const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return ''; } };
    const json = (p) => { try { return JSON.parse(read(p)); } catch { return {}; } };
    return {
        user: (json('../acct/.claude.json').mcpServers || {})['macos-desktop'] || null,
        mcpjson: (json('.mcp.json').mcpServers || {})['macos-desktop'] || null,
        denied: json('.claude/settings.json').deniedMcpServers || null,
        line: (/^mcp-denied: (.*)$/m.exec(read('.claude/alfred-code.stamp')) || [])[1] || '',
    };
};

test('seed (MCP copy route): a configure drop under a user-scope registration denies it for this project alone, a re-add lifts it, and a re-run changes nothing', POSIX_ONLY, () =>
{
    const project = ['--installed-only', '--scope', 'project'];
    const { steps, outs } = seedRun(['install', 'install', 'update', 'update', 'update'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('project'),
        args: [['--scope', 'user'], ['--scope', 'project'], [...project, '--drop', 'mcp macos-desktop'], [...project, '--add', 'mcp macos-desktop'], project],
        each: deskState,
    });
    assert.ok(steps[0].user, `the user-scope run registered it at user scope:\n${outs[0]}`);
    assert.ok(steps[1].mcpjson, `the project-scope run registered it in .mcp.json:\n${outs[1]}`);
    // The drop: gone from this project's .mcp.json, denied here, the user-scope registration untouched.
    assert.strictEqual(steps[2].mcpjson, null, outs[2]);
    assert.deepStrictEqual(steps[2].denied, [{ serverName: 'macos-desktop' }], outs[2]);
    assert.strictEqual(steps[2].line, 'project:macos-desktop');
    assert.deepStrictEqual(steps[2].user, steps[0].user, 'the broader registration stays for every other project');
    // Picked again: the deny is lifted, the record gone.
    assert.strictEqual(steps[3].denied, null, outs[3]);
    assert.strictEqual(steps[3].line, '');
    assert.ok(steps[3].mcpjson, outs[3]);
    assert.match(outs[3], /settings\.json: deniedMcpServers - macos-desktop \(picked again\)/);
    // A plain re-run writes no deny and lifts nothing.
    assert.strictEqual(steps[4].denied, null);
    assert.doesNotMatch(outs[4], /deniedMcpServers/);
});

test('seed (MCP copy route): a drop with NO broader registration writes no deny; a local run denies in settings.local.json', POSIX_ONLY, () =>
{
    const project = ['--installed-only', '--scope', 'project'];
    const a = seedRun(['install', 'update'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('project'),
        args: [['--scope', 'project'], [...project, '--drop', 'mcp macos-desktop']], each: deskState,
    });
    assert.strictEqual(a.steps[1].denied, null, a.outs[1]);
    assert.strictEqual(a.steps[1].line, '');
    const local = ['--installed-only', '--scope', 'local'];
    const b = seedRun(['install', 'install', 'update'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('local'),
        args: [['--scope', 'user'], ['--scope', 'local'], [...local, '--drop', 'mcp macos-desktop']],
        inspect: (repo) => ({ ...deskState(repo), localDenied: (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')).deniedMcpServers; } catch { return null; } })() }),
    });
    assert.deepStrictEqual(b.result.localDenied, [{ serverName: 'macos-desktop' }], b.outs[2]);
    assert.strictEqual(b.result.denied, null, 'the shared settings.json is not touched by a local run');
    assert.strictEqual(b.result.line, 'local:macos-desktop');
});

test('seed uninstall: the deny entries the stack wrote are lifted, a row of the user\'s own stays', POSIX_ONLY, () =>
{
    const project = ['--installed-only', '--scope', 'project'];
    const { result, outs } = seedRun(['install', 'install', 'update', 'uninstall'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('project'),
        args: [['--scope', 'user'], ['--scope', 'project'], [...project, '--drop', 'mcp macos-desktop'], []],
        each: (repo, i) =>
        {
            if (i !== 2) return null;
            const file = path.join(repo, '.claude', 'settings.json');
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            data.deniedMcpServers.push({ serverName: 'mine' });
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            return null;
        },
        inspect: (repo) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).deniedMcpServers; } catch { return 'gone'; } },
    });
    assert.deepStrictEqual(result, [{ serverName: 'mine' }], outs[3]);
});

test('seed update (MCP copy route): the stack\'s registration at another account-file scope is refreshed there too, in this release\'s shape', POSIX_ONLY, () =>
{
    // A user-scope registration of the stack's own package on an older shape, beside this local-scope install's own.
    const { outs, calls, result } = seedRun(['install', 'update', 'update'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('local'),
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            if (i !== 0) return deskState(repo);
            const file = path.join(repo, '..', 'acct', '.claude.json');
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            const mine = Object.values(data.projects || {})[0].mcpServers['macos-desktop'];
            (data.mcpServers ||= {})['macos-desktop'] = { ...mine, args: [...(mine.args || []), '--stale-flag'] };
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            return null;
        },
        inspect: deskState,
    });
    assert.match(outs[1], /mcp refreshed \[user\]: macos-desktop/, outs[1]);
    assert.doesNotMatch(outs[2], /mcp refreshed/, 'a second update finds it current');
    assert.ok(calls.some((c) => /^mcp add --scope user macos-desktop/.test(c)), calls.join('\n'));
    assert.ok(!(result.user.args || []).includes('--stale-flag'), JSON.stringify(result.user));
});

test('seed install --scope local (MCP copy route): a user-scope registration of the same server is no local one - the pick is registered here and survives the update', POSIX_ONLY, () =>
{
    const { steps, outs, calls } = seedRun(['install', 'install', 'update'], DESK, {
        env: MCP_COPY, account: true, plugins: coreRows('local'),
        args: [['--scope', 'user'], ['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo) =>
        {
            const acct = JSON.parse(fs.readFileSync(path.join(repo, '..', 'acct', '.claude.json'), 'utf8'));
            const local = (Object.values(acct.projects || {})[0] || {}).mcpServers || {};
            return { local: local['macos-desktop'] || null, user: (acct.mcpServers || {})['macos-desktop'] || null };
        },
    });
    assert.ok(steps[0].user, outs[0]);
    assert.ok(steps[1].local, `the local install skipped it as configured:\n${outs[1]}`);
    assert.doesNotMatch(outs[1], /mcp macos-desktop already configured - skipping/);
    assert.ok(steps[2].local, `the update dropped the pick:\n${outs[2]}`);
    assert.doesNotMatch(outs[2], /mcps=3\b/);
    void calls;
});
