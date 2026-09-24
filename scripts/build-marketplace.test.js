'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, applyToMarketplace, retiredMarketplaceEntries, applyRenames, MARKETPLACE_RENAMES } = require('./build-marketplace.js');
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
// is listed - and the two that are easy to lose on the way across are the layer-table hook and the
// superpowers dependency.
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
    assert.deepStrictEqual(entries.map(e => e.name), ['alfred-code'], 'every other skill and agent is library, listed by no entry');
    const core = byName['alfred-code'];
    assert.ok(core.skills.includes('./stack/skills/project-solve-cross-task'));
    assert.ok(core.agents.includes('./stack/agents/integration-reviewer.md'));
    assert.ok(!core.skills.includes('./stack/skills/angular-conventions'), 'a library skill is not in the core');
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
            { name: 'alfred-code-hooks', source: './', description: 'generated elsewhere', hooks: { Stop: [] } },
        ],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'alfred-code');
    assert.strictEqual(core.source, './', 'the core is re-sourced to the shared root');
    assert.ok(Array.isArray(core.commands) && core.commands.length, 'and carries its commands now');
    const hooksEntry = after.plugins.find(p => p.name === 'alfred-code-hooks');
    assert.strictEqual(hooksEntry.description, 'generated elsewhere', 'an entry this generator does not own is untouched');
    assert.strictEqual(after.plugins.length, 1 + entries.length, 'the hooks entry plus every generated entry');
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
    // The three locked MCP servers are the exception, and by design: the installer installs them
    // beside the core on every run, and a plugin that depends on nothing can never be disabled at
    // load by a missing one. Everything else must reach the core, or enabling it would not enable
    // the baseline.
    for (const e of SHIPPED.plugins)
    {
        if (e.name === 'alfred-code' || LOCKED.includes(e.name)) continue;
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
        assert.ok(seen.has('alfred-code'), `${e.name} does not reach the core plugin - enabling it would not enable the baseline`);
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

test('superpowers is the one plugin the installer adds from another marketplace, on every run', () => {
    assert.strictEqual(shippedBy['alfred-code'].dependencies, undefined);
    assert.deepStrictEqual(CORE_DEP_PLUGINS, ['superpowers@claude-plugins-official']);
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

test('the retired entries stay listed for one release, marked retired', () =>
{
    const mkt = applyToMarketplace({ plugins: [] }, buildEntries().concat(retiredMarketplaceEntries()));
    const angular = mkt.plugins.find((p) => p.name === 'claude-stack-angular');
    assert.ok(angular, 'still listed');
    assert.match(angular.description, /^RETIRED/);
    assert.ok(angular.skills.includes('./stack/skills/angular-conventions'));
    assert.strictEqual(mkt.plugins.filter((p) => /^RETIRED/.test(p.description || '')).length, 20);
});

test('a retired name missing from the frozen file is dropped from the marketplace', () =>
{
    const mkt = applyToMarketplace({ plugins: [{ name: 'claude-stack-gone', source: './' }, { name: 'third-party', source: './x' }] }, buildEntries(), { retired: ['claude-stack-gone'] });
    assert.strictEqual(mkt.plugins.find((p) => p.name === 'claude-stack-gone'), undefined);
    assert.ok(mkt.plugins.find((p) => p.name === 'third-party'), 'a name nobody retired is kept');
});

// Requirement 2 (task-5c): the frozen meta/retired-entries.json still spells its own dependency on
// the core in 1.x names - build-marketplace.js is what translates it, so a retired entry keeps
// reaching the core through the renamed marketplace shape (build-marketplace.test.js:125, legacy
// failure 1 of Task 2's report).
test('retiredMarketplaceEntries translates the frozen claude-stack / claude-stack-hooks dependency, keeps every other one', () => {
    const list = retiredMarketplaceEntries();
    const retiredByName = Object.fromEntries(list.map((e) => [e.name, e]));
    // A terminal entry named the frozen core name directly.
    assert.deepStrictEqual(retiredByName['claude-stack-csharp'].dependencies, ['alfred-code']);
    assert.deepStrictEqual(retiredByName['claude-stack-aspnet-data'].dependencies, ['alfred-code']);
    // A non-terminal entry still names another retired entry by its own frozen name - untouched.
    assert.deepStrictEqual(retiredByName['claude-stack-aspnet'].dependencies, ['claude-stack-aspnet-data', 'claude-stack-csharp', 'claude-stack-dotnet']);
    for (const e of list) assert.ok(!e.dependencies.includes('claude-stack') && !e.dependencies.includes('claude-stack-hooks'), `${e.name} still names an unrenamed core dependency`);
});

// Requirement 1 (task-5c): the top-level `renames` map Claude Code reads to move a 1.x install's
// `enabledPlugins` keys at startup (docs/rebrand-evidence.md S1/S4/S9) - ONE constant, never a null
// value (plan decision D2: a null drops the key before the seed can copy a retired entry's picks).
test('applyRenames writes the 1.x -> 2.x plugin map onto the live marketplace, never a null value', () => {
    const mkt = applyRenames({ plugins: [] });
    assert.deepStrictEqual(mkt.renames, { 'claude-stack': 'alfred-code', 'claude-stack-hooks': 'alfred-code-hooks' });
    for (const [from, to] of Object.entries(MARKETPLACE_RENAMES))
    {
        assert.notStrictEqual(to, null, `${from} must never rename to null`);
        assert.strictEqual(typeof to, 'string');
    }
});

test('the core entry wires the library-stamp line at session start, startup only, with a timeout', () =>
{
    const core = buildEntries().find((e) => e.name === 'alfred-code');
    const start = core.hooks.SessionStart;
    assert.ok(Array.isArray(start) && start.length === 1, JSON.stringify(core.hooks));
    assert.strictEqual(start[0].matcher, 'startup');
    assert.match(start[0].hooks[0].command, /setup-plugin\/hooks\/library-stamp\.js/);
    assert.strictEqual(start[0].hooks[0].timeout, 10);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'setup-plugin', 'hooks', 'library-stamp.js')));
});
