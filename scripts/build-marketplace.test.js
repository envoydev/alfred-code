'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, coreEntry, applyToMarketplace, unlistedRetired, hooksBlock, parseHookWirings, mergeHooks, FOLDED_ENTRIES } = require('./build-marketplace.js');
const { LEGACY } = require('./install/brand.js');
const { CORE_DEP_PLUGINS } = require('./install/plugins.js');
const { LOCKED } = require('./install/mcp.js');

const SCRIPT = path.join(__dirname, 'build-marketplace.js');
const run = (args, opts = {}) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });

const entries = buildEntries();
const byName = Object.fromEntries(entries.map(e => [e.name, e]));

test('every entry shares ONE source and lists its own paths', () => {
    for (const e of entries)
    {
        assert.strictEqual(e.source, './', `${e.name} must share the repo root as its source`);
        assert.strictEqual(e.strict, false, `${e.name} carries no plugin.json of its own`);
        assert.ok(e.version && e.author && e.description, `${e.name} needs version, author, description`);
        // The core also ships the router skill from setup-plugin/, which is not a stack skill.
        for (const s of e.skills || [])
            assert.ok(s.startsWith('./stack/skills/') || s === './setup-plugin/skills/alfred-code', `skill path: ${s}`);
        for (const a of e.agents || []) assert.ok(/^\.\/stack\/agents\/.+\.md$/.test(a), `agent path: ${a}`);
    }
});

// Phase 3 moved the core off ./setup-plugin, where its own plugin.json was the manifest. At the
// shared root nothing under setup-plugin/ is auto-discovered, so every path it used to get for free
// is listed - and the one that is easy to lose on the way across is the layer-table hook.
test('the core entry carries the commands, the router skill, the inline hook, and no dependency', () => {
    const core = byName['alfred-code'];
    assert.ok(core, 'the core entry is generated from Phase 3 on');
    assert.strictEqual(core.source, './');
    const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin/.claude-plugin/plugin.json'), 'utf8'));
    assert.strictEqual(core.commands.length, setup.commands.length, 'every guided-walk command ships');
    for (const c of core.commands) assert.ok(fs.existsSync(path.join(__dirname, '..', c)), `command path: ${c}`);
    assert.ok(core.skills.includes('./setup-plugin/skills/alfred-code'), 'the router skill ships');
    assert.ok(core.agents.length > 0, 'the core carries its placed agents');
    const wired = JSON.stringify(core.hooks);
    assert.ok(wired.includes('setup-plugin/hooks/guard-layer-table.js'), 'the layer-table guard is declared inline');
    assert.ok(wired.includes('${CLAUDE_PLUGIN_ROOT}'), 'and resolved through the plugin root');
    // Measured on 2.1.280: `claude plugin update` over an older core installs none of the dependencies
    // a release adds, and a plugin with one missing is disabled at load - its six commands with it, so
    // `/alfred-code:update` cannot repair the install. The core must load with nothing beside it.
    assert.strictEqual(core.dependencies, undefined, 'the core declares no dependencies - its companions are the installer\'s to install');
    assert.strictEqual(setup.dependencies, undefined, 'and plugin.json keeps none for a generator to carry back in');
});

test('the core is the only generated entry, listing skill FOLDERS and agent FILES that exist', () => {
    assert.deepStrictEqual(entries.map(e => e.name), ['alfred-code'], 'every skill is library, listed by no entry');
    const core = byName['alfred-code'];
    assert.deepStrictEqual(core.skills, ['./setup-plugin/skills/alfred-code'], '2.1.0: the router is the one skill the core carries - every stack skill is a project copy');
    assert.strictEqual(core.agents.length, 44, 'every seat rides the core');
    assert.ok(core.agents.includes('./stack/agents/integration-reviewer.md') && core.agents.includes('./stack/agents/aspnet-implementer.md'));
    for (const p of [...core.skills, ...core.agents])
        assert.ok(fs.existsSync(path.join(__dirname, '..', p)), `${p} must exist in the tree`);
});

test('--check exits non-zero when the generated file is stale, zero when it is current', () => {
    assert.doesNotThrow(() => run(['--check']), 'the committed meta/plugin-entries.json must be current');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const stale = path.join(tmp, 'plugin-entries.json');
    fs.writeFileSync(stale, JSON.stringify({ generatedBy: 'build-marketplace', entries: [] }, null, 2) + '\n');
    let code = 0;
    try { run(['--check', '--entries', stale]); } catch (err) { code = err.status; }
    assert.strictEqual(code, 1, 'a stale entries file fails the check');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('--write is idempotent - a second run changes nothing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const out = path.join(tmp, 'plugin-entries.json');
    run(['--write', '--entries', out]);
    const first = fs.readFileSync(out, 'utf8');
    run(['--write', '--entries', out]);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), first, 'byte-identical on a re-run');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('applying to a marketplace rewrites the core and leaves what the generator does not own', () => {
    const before = {
        name: 'envoydev',
        metadata: { version: '9.9.9' },
        plugins: [
            { name: 'alfred-code', source: './setup-plugin', description: 'the pre-Phase-3 entry', category: 'development' },
            { name: 'navigation', source: './', description: 'generated elsewhere', mcpServers: {} },
        ],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'alfred-code');
    assert.strictEqual(core.source, './', 'the core is re-sourced to the shared root');
    assert.ok(Array.isArray(core.commands) && core.commands.length, 'and carries its commands now');
    const other = after.plugins.find(p => p.name === 'navigation');
    assert.strictEqual(other.description, 'generated elsewhere', 'an entry this generator does not own is untouched');
    assert.strictEqual(after.plugins.length, 1 + entries.length, 'the other entry plus every generated entry');
});

// 2.0.0 folds the hooks into the core (user ruling 'Fold into core in 2.0.0'): a separate hooks
// entry left in the live file would stay installable, and every guard it carries would fire beside
// the core's own copy.
test('applying to a marketplace drops the folded hooks entry, and nothing else it does not own', () => {
    assert.deepStrictEqual(FOLDED_ENTRIES, ['alfred-code-hooks']);
    const before = { plugins: [
        { name: 'alfred-code-hooks', source: './', description: 'the pre-fold hooks entry', hooks: { Stop: [] } },
        { name: 'third-party', source: './x' },
    ] };
    const after = applyToMarketplace(before, entries);
    assert.strictEqual(after.plugins.find((p) => p.name === 'alfred-code-hooks'), undefined, 'the stale hooks entry is gone');
    assert.ok(after.plugins.find((p) => p.name === 'third-party'), 'a hand entry is kept');
});

test('the core carries every stack hook inline, its own two first in each event', () => {
    const core = coreEntry();
    const stack = hooksBlock(parseHookWirings());
    const commands = (block, event) => (block[event] || []).flatMap((g) => g.hooks.map((h) => `${g.matcher}|${h.command}|${h.timeout}`));
    for (const event of Object.keys(stack))
        for (const c of commands(stack, event))
            assert.ok(commands(core.hooks, event).includes(c), `the core must carry ${event} ${c}`);
    const own = (event) => commands(core.hooks, event).filter((c) => c.includes('/setup-plugin/hooks/'));
    assert.deepStrictEqual(own('PreToolUse').length + own('SessionStart').length, 2, 'the core keeps its own two hooks');
    assert.match(core.hooks.PreToolUse[0].hooks[0].command, /setup-plugin\/hooks\/guard-layer-table\.js/, 'the layer-table guard leads PreToolUse');
    assert.match(core.hooks.SessionStart[0].hooks[0].command, /setup-plugin\/hooks\/library-stamp\.js/, 'the library-stamp line leads SessionStart');
    const total = (block) => Object.values(block).flat().reduce((n, g) => n + g.hooks.length, 0);
    assert.strictEqual(total(core.hooks), total(stack) + 2, 'nothing doubled, nothing lost');
});

test('mergeHooks keeps one group per matcher, the first block\'s hooks first', () => {
    const own = { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ command: 'own' }] }], SessionStart: [{ matcher: 'startup', hooks: [{ command: 'stamp' }] }] };
    const stack = { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'rm' }] }, { matcher: 'AskUserQuestion', hooks: [{ command: 'stop' }] }], Stop: [{ hooks: [{ command: 'contract' }] }] };
    const merged = mergeHooks(own, stack);
    assert.deepStrictEqual(merged.PreToolUse, [
        { matcher: 'AskUserQuestion', hooks: [{ command: 'own' }, { command: 'stop' }] },
        { matcher: 'Bash', hooks: [{ command: 'rm' }] },
    ]);
    assert.deepStrictEqual(merged.SessionStart, own.SessionStart);
    assert.deepStrictEqual(merged.Stop, stack.Stop);
    assert.deepStrictEqual(own.PreToolUse[0].hooks, [{ command: 'own' }], 'the inputs are not mutated');
});

// 2.2.1 (the user's ruling of 2026-10-06): no RETIRED alias is listed - the two 1.x ids and every id `renamed.mcps`
// left behind (a browser engine renamed by its prefix) are out of the live file, which an update migrates without.
const RETIRED_ALIAS_NAMES = [LEGACY.core, LEGACY.hooks, ...Object.keys(require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).renamed.mcps)
    .flatMap((old) => (old === 'playwright' ? ['chrome', 'msedge', 'firefox', 'webkit'].map((e) => `${old}-${e}`) : [old]))];
test('no RETIRED alias is generated or listed: the 1.x ids and the renamed MCP ids are gone', () => {
    assert.strictEqual(RETIRED_ALIAS_NAMES.length, 11, 'the two 1.x ids, serena, context7, the four playwright engines and the three 2.2.0 ids');
    for (const name of RETIRED_ALIAS_NAMES) assert.strictEqual(shippedBy[name], undefined, `${name} is still listed`);
    assert.strictEqual(SHIPPED.plugins.filter((p) => /^RETIRED/.test(p.description || '')).length, 0, 'no RETIRED row at all');
    assert.ok(!('aliasEntries' in require('./build-marketplace.js')) && !('mcpAliasEntries' in require('./build-marketplace.js')), 'no generator is left to bring one back');
});

test('malformed input fails loudly rather than emitting a short list', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const bad = path.join(tmp, 'stack-graph.json');
    fs.writeFileSync(bad, '{ not json');
    let code = 0;
    let out = '';
    try { run(['--write', '--graph', bad, '--entries', path.join(tmp, 'e.json')]); }
    catch (err) { code = err.status; out = String(err.stderr || ''); }
    assert.strictEqual(code, 1);
    assert.match(out, /stack-graph|JSON/i, 'the failure names what could not be read');
    assert.ok(!fs.existsSync(path.join(tmp, 'e.json')), 'nothing is written on a failed read');
    fs.rmSync(tmp, { recursive: true, force: true });
});

// Phase 4. The dependency edges were generated in Phase 1; from here they are load-bearing, because
// the installer stopped installing superpowers itself. Claude Code enables a plugin's dependencies
// at the same scope and refuses to disable one while a dependent is enabled
// (code.claude.com/docs/en/plugin-dependencies), so a broken edge is a project without the plugin
// 27 skills and agents cite, not a warning.
const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
const shippedBy = Object.fromEntries(SHIPPED.plugins.map(e => [e.name, e]));

test('every shipped entry reaches the core through its dependencies, with no cycle', () => {
    // Every MCP entry is the exception, and by design: the installer installs the core on every run, a
    // plugin that depends on nothing can never be disabled at load by a missing one, and one that names
    // the core blocks each core disable while it is on (I7) - an alias naming the 2.x core is unmet for
    // the not-yet-updated installs it exists for (I6). An MCP entry carries servers and nothing else,
    // which is how applyMcpPlugins recognises one. Everything else must reach the core, or enabling it
    // would not enable the baseline. The two 1.x aliases are the core under its old name and an empty
    // id, so the old core's alias counts as the core for a retired entry, whose frozen dependency still
    // names it.
    const mcpOnly = (p) => p.mcpServers && !p.skills && !p.agents && !p.commands && !p.hooks;
    for (const e of SHIPPED.plugins)
    {
        if (e.name === 'alfred-code' || e.name === LEGACY.core || e.name === LEGACY.hooks || LOCKED.includes(e.name) || mcpOnly(e)) continue;
        const seen = new Set();
        const stack = [e.name];
        while (stack.length)
        {
            const name = stack.pop();
            if (seen.has(name)) continue;
            seen.add(name);
            for (const d of shippedBy[name] ? shippedBy[name].dependencies || [] : [])
            {
                if (typeof d !== 'string') continue;          // cross-marketplace, checked below
                assert.ok(shippedBy[d], `${name} depends on ${d}, which this marketplace does not ship`);
                assert.notStrictEqual(d, e.name, `${e.name} and ${d} depend on each other`);
                stack.push(d);
            }
        }
        assert.ok(seen.has('alfred-code') || seen.has(LEGACY.core), `${e.name} does not reach the core plugin - enabling it would not enable the baseline`);
    }
});

test('only the core carries a cross-marketplace dependency, and the allowlist names exactly what is reached', () => {
    const reached = new Set();
    for (const e of SHIPPED.plugins)
        for (const d of e.dependencies || [])
        {
            if (typeof d === 'string') continue;                                  // same marketplace
            if (d.marketplace === SHIPPED.name) continue;                         // ... written the long way
            assert.strictEqual(e.name, 'alfred-code', `${e.name} reaches outside the marketplace; only the core may`);
            assert.ok(d.marketplace, `${e.name}'s dependency on ${d.name} names no marketplace`);
            reached.add(d.marketplace);
        }
    assert.deepStrictEqual([...reached].sort(), [...(SHIPPED.allowCrossMarketplaceDependenciesOn || [])].sort(),
        'allowCrossMarketplaceDependenciesOn must name exactly the marketplaces the entries reach into - a missing name fails the install with a cross-marketplace error, an extra one widens trust for nothing');
});

// R109: superpowers is no stack pick at all, so no run adds it on its own.
// claude-hud is the one plugin from another marketplace every run installs.
// 2.2.0: claude-hud is an optional pick (the user's ruling of 2026-10-06), so no plugin rides beside the core.
test('no plugin is added from another marketplace on every run - claude-hud is a pick, superpowers none', () => {
    assert.strictEqual(shippedBy['alfred-code'].dependencies, undefined);
    assert.deepStrictEqual(CORE_DEP_PLUGINS, []);
    assert.ok(!CORE_DEP_PLUGINS.some((spec) => spec.split('@')[0] === 'superpowers'), `CORE_DEP_PLUGINS still names superpowers: ${CORE_DEP_PLUGINS.join(', ')}`);
});

// The three servers a project can never drop ship as standalone entries the installer installs beside
// the core - locked by the installer putting them back on every run, not by a dependency edge that
// disables the core when one is missing.
test('the three locked MCP plugins ship standalone, one server each, depending on nothing', () => {
    for (const name of LOCKED)
    {
        assert.ok(shippedBy[name], `${name} is locked, but this marketplace does not ship it`);
        assert.strictEqual(shippedBy[name].dependencies, undefined, `${name} depends on nothing, so it never loads disabled`);
        assert.deepStrictEqual(Object.keys(shippedBy[name].mcpServers || {}), [name],
            `${name} must carry exactly one server of its own name, or its tools stop being mcp__plugin_${name}_${name}__<tool>`);
    }
});

// The desktop servers drive the machine's own apps: each one plugin, one server of its own name, a
// droppable pick that depends on nothing (I7), started through the launcher that pins the Python and
// refuses on the other OS. windows-desktop ships with shell, registry, process and file-system control
// switched off (I10: FileSystem writes, moves and deletes where no house guard looks).
test('the two desktop MCP plugins: one server each, launched through desktop-launch.js at the release pin', () => {
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins;
    const cut = ['--exclude-newer', `${JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).refreshed}T23:59:59Z`];
    const want = {
        'windows-desktop': ['--server', 'windows-desktop', '--package', `windows-mcp==${pins['windows-desktop'].version}`, ...cut, '--', 'serve', '--exclude-tools', 'PowerShell,Registry,Process,FileSystem'],
        'macos-desktop': ['--server', 'macos-desktop', '--package', `macos-mcp==${pins['macos-desktop'].version}`, ...cut, '--', 'serve'],
    };
    for (const [name, args] of Object.entries(want))
    {
        const entry = shippedBy[name];
        assert.ok(entry, `${name} is not in the marketplace`);
        assert.deepStrictEqual(Object.keys(entry.mcpServers), [name], `${name} must carry exactly one server of its own name`);
        assert.strictEqual(entry.dependencies, undefined, `${name} depends on nothing - a dependency on the core blocks every core disable while it is on (I7)`);
        const server = entry.mcpServers[name];
        assert.strictEqual(server.command, 'node');
        assert.deepStrictEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/stack/mcp/desktop-launch.js', ...args]);
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'stack', 'mcp', 'desktop-launch.js')), 'the launcher the entry names is not in the tree');
    }
});

// I7: Claude Code refuses to disable a plugin an enabled one depends on ('new-core is still required by
// pw', measured on 2.1.284), so an MCP entry naming the core blocked the full copy route's core stand-down
// and a user's own core disable while a browser or desktop row was on. Since 2.1.0 the core carries no
// skill those servers need, and the installer installs the core on every run: no MCP entry names it.
test('no generated MCP entry declares a dependency - none may block a core disable (I7)', () => {
    const { mcpPlugins } = require('./build-marketplace.js');
    for (const entry of mcpPlugins())
    {
        assert.strictEqual(entry.dependencies, undefined, `${entry.name} declares ${JSON.stringify(entry.dependencies)}`);
        assert.ok(shippedBy[entry.name], `${entry.name} is not in the live marketplace`);
        assert.strictEqual(shippedBy[entry.name].dependencies, undefined, `the live ${entry.name} entry still declares a dependency`);
    }
});

// Both upstreams send PostHog usage events unless ANONYMIZED_TELEMETRY is 'false' (read in each wheel's
// lifespan: windows-mcp 0.8.5 and macos-mcp 0.4.6 __main__.py, default 'true'). A server driving the
// user's own desktop starts with it off.
test('the two desktop MCP plugins start their upstream with its telemetry off', () => {
    for (const name of ['windows-desktop', 'macos-desktop'])
        assert.deepStrictEqual(shippedBy[name].mcpServers[name].env, { ANONYMIZED_TELEMETRY: 'false' }, `${name} must pass ANONYMIZED_TELEMETRY=false`);
});

// M24: every uvx-started server passes the release's dependency cut-off (the pins file's refreshed day, its last
// second UTC) to its launcher, beside the pin it was generated with; the npx browser has no uvx and takes none.
test('M24 each uvx MCP entry hands its launcher the release cut-off, and the browser entries none', () =>
{
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8'));
    const cutoff = `${pins.refreshed}T23:59:59Z`;
    for (const name of ['alfred-navigation', 'alfred-memory', 'windows-desktop', 'macos-desktop'])
    {
        const args = shippedBy[name].mcpServers[name].args;
        const at = args.indexOf('--exclude-newer');
        assert.ok(at > 0 && args[at + 1] === cutoff, `${name}: ${args.join(' ')}`);
        const rest = args.indexOf('--');
        assert.ok(rest < 0 || at < rest, `${name}: the cut-off is a launcher flag, before the server's own arguments`);
    }
    for (const engine of ['chrome', 'msedge', 'firefox', 'webkit'])
        assert.ok(!shippedBy[`browser-${engine}`].mcpServers[`browser-${engine}`].args.includes('--exclude-newer'));
});

// M25: Context7 documents `Context7-API-Key` (or Authorization: Bearer) and warns a header name with an underscore
// can be dropped by a proxy, which silently drops a keyed user to the free tier. Probed 2026-09-29: an empty
// Context7-API-Key is the anonymous tier, a bogus one is 'Invalid API key' - the server reads the name.
test('M25 the documentation entry sends the key as Context7-API-Key, empty when unset', () =>
{
    const server = shippedBy['alfred-documentation'].mcpServers['alfred-documentation'];
    assert.deepStrictEqual(server.headers, { 'Context7-API-Key': '${CONTEXT7_API_KEY:-}' });
    const { CONTEXT7_REMOTE } = require('./install/mcp.js');
    assert.strictEqual(CONTEXT7_REMOTE.header, 'Context7-API-Key: ${CONTEXT7_API_KEY:-}', 'the copy route sends the same header');
});

// 2.1.7 (the user's ruling of 2026-10-06): the per-stack entries retired in 1.3.0 left the Discover tab. Update
// migrates one still installed from meta/retired-entries.json alone, so the frozen file stays while the listing goes.
test('the per-stack entries retired in 1.3.0 are no longer listed, and an applied marketplace drops them', () =>
{
    const names = unlistedRetired();
    assert.strictEqual(names.length, 20, 'the frozen record still names every entry 1.2.0 shipped');
    for (const name of names) assert.strictEqual(shippedBy[name], undefined, `${name} is still listed`);
    const mkt = applyToMarketplace({ plugins: [{ name: 'claude-stack-angular', source: './' }, { name: 'third-party', source: './x' }] }, buildEntries()); // legacy-name
    assert.strictEqual(mkt.plugins.find((p) => p.name === 'claude-stack-angular'), undefined, 'a live listing is dropped'); // legacy-name
    assert.ok(mkt.plugins.find((p) => p.name === 'third-party'), 'a name nobody retired is kept');
});

test('a retired name missing from the frozen file is dropped from the marketplace', () =>
{
    const mkt = applyToMarketplace({ plugins: [{ name: 'claude-stack-gone', source: './' }, { name: 'third-party', source: './x' }] }, buildEntries(), { retired: ['claude-stack-gone'] }); // legacy-name
    assert.strictEqual(mkt.plugins.find((p) => p.name === 'claude-stack-gone'), undefined); // legacy-name
    assert.ok(mkt.plugins.find((p) => p.name === 'third-party'), 'a name nobody retired is kept');
});

// The live file carries NO renames map (S11/S16 - a rename strands an install) and no hooks entry (the fold).
test('the live marketplace carries no renames key and no hooks entry', () => {
    assert.ok(!('renames' in SHIPPED), 'a renames key would move an install onto an id it never installs');
    assert.strictEqual(shippedBy['alfred-code-hooks'], undefined, 'the hooks ride the core');
});

test('--write-marketplace drops a renames key, the hooks entry and a stale 1.x alias', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const file = path.join(tmp, 'marketplace.json');
    const stale = JSON.parse(JSON.stringify(SHIPPED));
    stale.renames = { [LEGACY.core]: 'alfred-code', [LEGACY.hooks]: 'alfred-code-hooks' };
    stale.plugins = stale.plugins.concat({ name: 'alfred-code-hooks', source: './', description: 'pre-fold', hooks: { Stop: [] } },
        { name: LEGACY.core, source: './', description: 'RETIRED in 2.0.0', skills: [] }, { name: LEGACY.hooks, source: './', description: 'RETIRED in 2.0.0', skills: [] });
    fs.writeFileSync(file, JSON.stringify(stale, null, 2) + '\n');
    try
    {
        run(['--write-marketplace', '--marketplace-file', file]);
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(!('renames' in after), 'the renames key is deleted');
        assert.strictEqual(after.plugins.find((p) => p.name === 'alfred-code-hooks'), undefined, 'the hooks entry is dropped');
        for (const name of [LEGACY.core, LEGACY.hooks]) assert.strictEqual(after.plugins.find((p) => p.name === name), undefined, `${name} is dropped`);
        const once = fs.readFileSync(file, 'utf8');
        assert.match(run(['--write-marketplace', '--marketplace-file', file]), /marketplace current/, 'a re-run changes nothing');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), once);
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('--hooks-entry prints the core hooks block and writes nothing', () => {
    const before = fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8');
    const printed = JSON.parse(run(['--hooks-entry']));
    assert.deepStrictEqual(printed, coreEntry().hooks);
    assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'), before);
});

test('the core entry wires the library-stamp line at session start, startup only, with a timeout', () =>
{
    const core = buildEntries().find((e) => e.name === 'alfred-code');
    const start = core.hooks.SessionStart;
    assert.ok(Array.isArray(start) && start.length >= 1, JSON.stringify(core.hooks));
    assert.strictEqual(start[0].matcher, 'startup', 'its own group leads the event');
    assert.strictEqual(start[0].hooks.length, 1, 'no stack hook shares the startup matcher');
    assert.match(start[0].hooks[0].command, /setup-plugin\/hooks\/library-stamp\.js/);
    assert.strictEqual(start[0].hooks[0].timeout, 10);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'setup-plugin', 'hooks', 'library-stamp.js')));
});

// Review I3 / N3: the README's trust surface counts what the package holds - it said one hook while
// the core ran nineteen, and one skill while it carried twenty-three. Every count comes from
// `coreEntry()` (the references from their folder), so the row cannot drift from the entry again.
test('the README trust surface counts what the core entry carries', () =>
{
    const core = coreEntry();
    const files = new Set(Object.values(core.hooks).flat().flatMap((g) => g.hooks)
        .map((h) => /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/.exec(h.command)[1]));
    // A dispatcher is a runner, not a hook: the guards it runs in-process are the hooks.
    const dispatcher = require('../stack/hooks/shell-guards.js');
    const fileDispatcher = require('../stack/hooks/file-guards.js');
    const dispatched = files.delete(`stack/hooks/${dispatcher.SELF}.js`);
    if (dispatched) for (const g of dispatcher.GUARDS) files.add(`stack/hooks/${g}.js`);
    const fileDispatched = files.delete(`stack/hooks/${fileDispatcher.SELF}.js`);
    if (fileDispatched) for (const g of fileDispatcher.NAMES) files.add(`stack/hooks/${g}.js`);
    const own = [...files].filter((f) => f.startsWith('setup-plugin/')).length;
    const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const word = (n) => (n < 20 ? UNITS[n] : ['twenty', 'thirty', 'forty'][Math.floor(n / 10) - 2] + (n % 10 ? `-${UNITS[n % 10]}` : ''));
    const scripted = core.skills.filter((s) => fs.existsSync(path.join(__dirname, '..', s, 'scripts'))).map((s) => path.basename(s));
    const references = fs.readdirSync(path.join(__dirname, '..', 'setup-plugin', 'references')).length;
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'install-footprint.md'), 'utf8');
    const row = doc.split('\n').find((l) => l.startsWith('Nothing else executes from the package itself.'));
    const m = /The package itself is (\S+) command bodies, (\S+) skills? \((?:the `\/alfred-code` router; )?(?:only ((?:`[^`]+`(?:, | and )?)+) ships? a script|none ships a script)\), (\S+) agents, (\S+) references and (\S+) hooks - the core's own (\S+) .*?and the (\S+) stack hooks/.exec(row || '');
    assert.ok(m, `docs/install-footprint.md names what the core carries: ${row}`);
    m[3] = [...String(m[3] || '').matchAll(/`([^`]+)`/g)].map((x) => x[1]).join(); // the skills that ship a script, as a list
    assert.deepStrictEqual(m.slice(1), [word(core.commands.length), word(core.skills.length), scripted.join(), word(core.agents.length),
        word(references), word(files.size), word(own), word(files.size - own)]);
    assert.doesNotMatch(row, /entries carrying this project's skills|needs no call of its own/, 'no clause stale since 1.3.0');
    if (dispatched) assert.match(row, new RegExp(`${word(dispatcher.GUARDS.length)} of them run in-process by one dispatcher \\(\`${dispatcher.SELF}\\.js\`\\)`), 'the row names the dispatcher that runs the shell guards');
    if (fileDispatched) assert.match(row, new RegExp(`${word(fileDispatcher.GUARDS.length)} by another \\(\`${fileDispatcher.SELF}\\.js\`\\) on the file tools`), 'and the one that runs the file guards');
});

// Review finding 2: code.claude.com/docs/en/plugins-reference - 'If you declare `options` on any field,
// users on Claude Code versions before v2.1.271 can't load the plugin'. The core carries every guard, so
// no userConfig field of the core declares one - generated or committed.
test('no userConfig field of the core declares options, so an older CLI still loads it', () => {
    const fields = (list) => list.flatMap((e) => Object.entries(e.userConfig || {}).map(([k, f]) => [`${e.name}.${k}`, f]));
    const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8')).plugins
        .filter((e) => e.name === coreEntry().name);
    const all = [...fields([coreEntry()]), ...fields(committed), ...fields(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8')).entries)];
    assert.ok(all.some(([k]) => k.endsWith('.hook_profile')), 'the hook profile field is still declared');
    for (const [key, field] of all) assert.ok(!Object.hasOwn(field, 'options'), `${key} declares options`);
    const profile = coreEntry().userConfig.hook_profile;
    assert.strictEqual(profile.default, 'standard');
    for (const name of ['minimal', 'standard', 'strict']) assert.match(profile.description, new RegExp(`\\b${name}\\b`), `the description names ${name}`);
});
