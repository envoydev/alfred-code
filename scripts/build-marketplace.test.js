'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, coreEntry, applyToMarketplace, retiredMarketplaceEntries, aliasEntries, hooksBlock, parseHookWirings, mergeHooks, FOLDED_ENTRIES } = require('./build-marketplace.js');
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
    assert.deepStrictEqual(entries.map(e => e.name), ['alfred-code'], 'every other skill and agent is library, listed by no entry');
    const core = byName['alfred-code'];
    assert.ok(core.skills.includes('./stack/skills/alfred-task-solve-cross'));
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
            { name: 'serena', source: './', description: 'generated elsewhere', mcpServers: {} },
        ],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'alfred-code');
    assert.strictEqual(core.source, './', 'the core is re-sourced to the shared root');
    assert.ok(Array.isArray(core.commands) && core.commands.length, 'and carries its commands now');
    const other = after.plugins.find(p => p.name === 'serena');
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

// Rulings R24 and 'retired aliases' (docs/rebrand-evidence.md S20-S25): 2.0.0 ships no `renames` map
// - a rename strands a 1.x install with zero hooks and skills (S11, S16). The 1.x ids stay LISTED.
test('the two 1.x ids are generated retired aliases: the core under its old name, and an empty hooks id', () => {
    const [core, hooks] = aliasEntries();
    const wantDescription = `RETIRED in 2.0.0 - Alfred Code under its 1.x name. Run /${LEGACY.core}:update: it installs alfred-code and removes this entry.`;
    assert.strictEqual(core.name, LEGACY.core);
    assert.strictEqual(core.description, wantDescription);
    assert.deepStrictEqual({ ...core, name: 'alfred-code', description: coreEntry().description }, coreEntry(), 'the core alias is the 2.0.0 core, renamed');
    // S20: validated under --strict with no component but an explicit empty skills list - omitting
    // the key would auto-discover the shared root's skill folders.
    assert.deepStrictEqual(Object.keys(hooks), ['name', 'source', 'description', 'version', 'author', 'strict', 'skills']);
    assert.strictEqual(hooks.name, LEGACY.hooks);
    assert.strictEqual(hooks.source, './');
    assert.strictEqual(hooks.description, wantDescription);
    assert.strictEqual(hooks.strict, false);
    assert.deepStrictEqual(hooks.skills, []);
    assert.strictEqual(hooks.version, core.version);
    assert.deepStrictEqual(hooks.author, core.author);
    assert.ok(!/—/.test(wantDescription), 'house voice: no em-dash');
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
    // the baseline. The two 1.x aliases are the core under its old name and an empty id, so the old
    // core's alias counts as the core for a retired entry, whose frozen dependency still names it.
    for (const e of SHIPPED.plugins)
    {
        if (e.name === 'alfred-code' || e.name === LEGACY.core || e.name === LEGACY.hooks || LOCKED.includes(e.name)) continue;
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
test('claude-hud is the plugin the installer adds from another marketplace on every run, and superpowers is not', () => {
    assert.strictEqual(shippedBy['alfred-code'].dependencies, undefined);
    assert.deepStrictEqual(CORE_DEP_PLUGINS, ['claude-hud@claude-hud']);
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
    const mkt = applyToMarketplace({ plugins: [{ name: 'claude-stack-gone', source: './' }, { name: 'third-party', source: './x' }] }, buildEntries(), { retired: ['claude-stack-gone'] }); // legacy-name
    assert.strictEqual(mkt.plugins.find((p) => p.name === 'claude-stack-gone'), undefined); // legacy-name
    assert.ok(mkt.plugins.find((p) => p.name === 'third-party'), 'a name nobody retired is kept');
});

// The retired entries keep their FROZEN dependencies. `claude-stack` is listed again, as the core's // legacy-name
// alias, so a retired entry a 1.x install `plugin update`s before the seed runs still resolves the
// dependency it names (reverting 5c's mapping onto the new core's name).
test('retiredMarketplaceEntries keeps every frozen dependency verbatim', () => {
    const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-entries.json'), 'utf8')).entries;
    const list = retiredMarketplaceEntries();
    assert.deepStrictEqual(list.map((e) => [e.name, e.dependencies]), frozen.map((e) => [e.name, e.dependencies]));
    const byName = Object.fromEntries(list.map((e) => [e.name, e]));
    assert.deepStrictEqual(byName['claude-stack-csharp'].dependencies, [LEGACY.core], 'a terminal entry names the 1.x core');
    assert.ok(shippedBy[LEGACY.core], 'which the live marketplace lists, as the alias');
});

// Ruling 'retired aliases': 2.0.0 ships NO renames map (S11/S16 - a rename strands a 1.x install
// with zero hooks and skills), and no hooks entry (the fold). The live file is what a CLI reads.
test('the live marketplace carries no renames key, no hooks entry, and both 1.x aliases as generated', () => {
    assert.ok(!('renames' in SHIPPED), 'a renames key would move a 1.x install onto an id it never installs');
    assert.strictEqual(shippedBy['alfred-code-hooks'], undefined, 'the hooks ride the core');
    for (const alias of aliasEntries())
        assert.deepStrictEqual(shippedBy[alias.name], alias, `${alias.name} is listed exactly as generated`);
    assert.strictEqual(SHIPPED.plugins.filter((p) => /^RETIRED/.test(p.description || '')).length, 22, '20 retired per-stack entries plus the two aliases');
});

test('--write-marketplace drops a renames key and the hooks entry, and lists both aliases', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const file = path.join(tmp, 'marketplace.json');
    const stale = JSON.parse(JSON.stringify(SHIPPED));
    stale.renames = { [LEGACY.core]: 'alfred-code', [LEGACY.hooks]: 'alfred-code-hooks' };
    stale.plugins = stale.plugins.filter((p) => p.name !== LEGACY.core && p.name !== LEGACY.hooks)
        .concat({ name: 'alfred-code-hooks', source: './', description: 'pre-fold', hooks: { Stop: [] } });
    fs.writeFileSync(file, JSON.stringify(stale, null, 2) + '\n');
    try
    {
        run(['--write-marketplace', '--marketplace-file', file]);
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(!('renames' in after), 'the renames key is deleted');
        assert.strictEqual(after.plugins.find((p) => p.name === 'alfred-code-hooks'), undefined, 'the hooks entry is dropped');
        for (const alias of aliasEntries()) assert.deepStrictEqual(after.plugins.find((p) => p.name === alias.name), alias);
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
    const own = [...files].filter((f) => f.startsWith('setup-plugin/')).length;
    const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const word = (n) => (n < 20 ? UNITS[n] : ['twenty', 'thirty', 'forty'][Math.floor(n / 10) - 2] + (n % 10 ? `-${UNITS[n % 10]}` : ''));
    const scripted = core.skills.filter((s) => fs.existsSync(path.join(__dirname, '..', s, 'scripts'))).map((s) => path.basename(s));
    const references = fs.readdirSync(path.join(__dirname, '..', 'setup-plugin', 'references')).length;
    const row = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').split('\n').find((l) => l.startsWith('| **Starts** |'));
    const m = /which is (\S+) command bodies, (\S+) skills \(only `([^`]+)` ships a script\), (\S+) agents, (\S+) references and (\S+) hooks - the core's own (\S+) .*?and the (\S+) stack hooks/.exec(row || '');
    assert.ok(m, `the Starts row names what the core carries: ${row}`);
    assert.deepStrictEqual(m.slice(1), [word(core.commands.length), word(core.skills.length), scripted.join(), word(core.agents.length),
        word(references), word(files.size), word(own), word(files.size - own)]);
    assert.doesNotMatch(row, /entries carrying this project's skills|needs no call of its own/, 'no clause stale since 1.3.0');
});
