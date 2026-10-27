'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, coreEntry, applyToMarketplace, hooksBlock, parseHookWirings, mergeHooks, FOLDED_ENTRIES } = require('./build-marketplace.js');
const { CORE_DEP_PLUGINS } = require('./install/plugins.js');

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
    assert.strictEqual(core.agents.length, 45, 'every seat rides the core');
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

test('applying to a marketplace rewrites the core, leaves a hand entry and drops every MCP server entry', () => {
    const before = {
        name: 'envoydev',
        metadata: { version: '9.9.9' },
        plugins: [
            { name: 'alfred-code', source: './setup-plugin', description: 'the pre-Phase-3 entry', category: 'development' },
            { name: 'third-party', source: './x', description: 'a hand entry' },
            // the stack ships no server since 2026-10-24: an entry a release before left listed would stay installable
            { name: 'alfred-navigation', source: './', description: 'an older release\'s server', mcpServers: { 'alfred-navigation': { command: 'node' } } },
        ],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'alfred-code');
    assert.strictEqual(core.source, './', 'the core is re-sourced to the shared root');
    assert.ok(Array.isArray(core.commands) && core.commands.length, 'and carries its commands now');
    assert.strictEqual(after.plugins.find(p => p.name === 'third-party').description, 'a hand entry', 'an entry this generator does not own is untouched');
    assert.strictEqual(after.plugins.find(p => p.name === 'alfred-navigation'), undefined, 'a server entry is dropped');
    assert.strictEqual(after.plugins.length, 1 + entries.length, 'the hand entry plus every generated entry');
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
    assert.deepStrictEqual(own('PreToolUse').length + own('SessionStart').length, 3, 'the core keeps its own two hooks, the layer gate on two matchers');
    assert.match(core.hooks.PreToolUse[0].hooks[0].command, /setup-plugin\/hooks\/guard-layer-table\.js/, 'the layer-table guard leads PreToolUse');
    // 2026-10-21: the walk's next step is judged too - on Bash, spawned only for a `node` call.
    const bash = core.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.deepStrictEqual([bash.hooks[0].if, /guard-layer-table\.js/.test(bash.hooks[0].command)], ['Bash(node *)', true], 'the layer gate rides Bash behind its if filter');
    assert.match(core.hooks.SessionStart[0].hooks[0].command, /setup-plugin\/hooks\/library-stamp\.js/, 'the library-stamp line leads SessionStart');
    const total = (block) => Object.values(block).flat().reduce((n, g) => n + g.hooks.length, 0);
    assert.strictEqual(total(core.hooks), total(stack) + 3, 'nothing doubled, nothing lost');
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

// 2026-10-24 (the user's ruling): the stack ships no MCP server. Every server entry and the six 2.4.0 aliases left the live
// file, and each has a retired row whose add-back registers the record's own entry under its original name.
test('the live marketplace lists no MCP server entry, and every id it listed has a retired row with an add-json add-back', () => {
    assert.deepStrictEqual(SHIPPED.plugins.filter((p) => p.mcpServers).map((p) => p.name), [], 'no entry carries a server');
    for (const name of ['mcpPlugins', 'mcpAliasEntries', 'LISTED_ALIASES', 'mcpServerShapes', 'applyMcpPlugins'])
        assert.ok(!(name in require('./build-marketplace.js')), `${name} is gone with the entries`);
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    const record = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stack', 'mcp', 'original-mcps.json'), 'utf8')).mcpServers;
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stack', 'mcp', 'shipped-mcps.json'), 'utf8')).original;
    const listed = [...Object.keys(original), 'browser-chrome', 'browser-msedge', 'browser-firefox', 'browser-webkit', 'windows-desktop', 'macos-desktop'];
    for (const name of listed)
    {
        const row = rows.find((r) => r.name === name);
        assert.ok(row, `${name} has a retired row`);
        assert.strictEqual(row.retiredIn, '2.10.1');
        assert.ok(row.registration && (row.registration.package || row.registration.url), `${name}: what the stack registered`);
        const m = String(row.addBack).match(/^claude mcp add-json --scope <scope> (\S+) '(.+)'$/);
        assert.ok(m, `${name}: ${row.addBack}`);
        assert.deepStrictEqual(JSON.parse(m[2]), record[m[1]], `${name}: the add-back is the record's ${m[1]} entry`);
    }
    const retired = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).retired.mcps;
    for (const name of [...Object.keys(original), 'browser']) assert.ok(retired.includes(name), `${name} is in retired.mcps`);
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
    // would not enable the baseline.
    const mcpOnly = (p) => p.mcpServers && !p.skills && !p.agents && !p.commands && !p.hooks;
    for (const e of SHIPPED.plugins)
    {
        if (e.name === 'alfred-code' || mcpOnly(e)) continue;
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

// R109: superpowers is no stack pick at all, so no run adds it on its own.
// claude-hud is the one plugin from another marketplace every run installs.
// 2.2.0: claude-hud is an optional pick (the user's ruling of 2026-10-06), so no plugin rides beside the core.
test('no plugin is added from another marketplace on every run - claude-hud is a pick, superpowers none', () => {
    assert.strictEqual(shippedBy['alfred-code'].dependencies, undefined);
    assert.deepStrictEqual(CORE_DEP_PLUGINS, []);
    assert.ok(!CORE_DEP_PLUGINS.some((spec) => spec.split('@')[0] === 'superpowers'), `CORE_DEP_PLUGINS still names superpowers: ${CORE_DEP_PLUGINS.join(', ')}`);
});

test('a retired name is dropped from the marketplace, and a name nobody retired is kept', () =>
{
    const mkt = applyToMarketplace({ plugins: [{ name: 'gone-entry', source: './' }, { name: 'third-party', source: './x' }] }, buildEntries(), { retired: ['gone-entry'] });
    assert.strictEqual(mkt.plugins.find((p) => p.name === 'gone-entry'), undefined);
    assert.ok(mkt.plugins.find((p) => p.name === 'third-party'), 'a name nobody retired is kept');
});

// The live file carries NO renames map (S11/S16 - a rename strands an install) and no hooks entry (the fold).
test('the live marketplace carries no renames key and no hooks entry', () => {
    assert.ok(!('renames' in SHIPPED), 'a renames key would move an install onto an id it never installs');
    assert.strictEqual(shippedBy['alfred-code-hooks'], undefined, 'the hooks ride the core');
});

test('--write-marketplace drops a renames key and the hooks entry', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const file = path.join(tmp, 'marketplace.json');
    const stale = JSON.parse(JSON.stringify(SHIPPED));
    stale.renames = { 'old-core': 'alfred-code' };
    stale.plugins = stale.plugins.concat({ name: 'alfred-code-hooks', source: './', description: 'pre-fold', hooks: { Stop: [] } });
    fs.writeFileSync(file, JSON.stringify(stale, null, 2) + '\n');
    try
    {
        run(['--write-marketplace', '--marketplace-file', file]);
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(!('renames' in after), 'the renames key is deleted');
        assert.strictEqual(after.plugins.find((p) => p.name === 'alfred-code-hooks'), undefined, 'the hooks entry is dropped');
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

test('the core entry wires the library-stamp line at a startup, a clear and a resume - never a compaction - with a timeout', () =>
{
    const core = buildEntries().find((e) => e.name === 'alfred-code');
    const start = core.hooks.SessionStart;
    assert.ok(Array.isArray(start) && start.length >= 1, JSON.stringify(core.hooks));
    assert.strictEqual(start[0].matcher, 'startup|clear|resume', 'its own group leads the event (loading audit 2026-10-21 G12)');
    assert.strictEqual(start[0].hooks.length, 1, 'no stack hook shares its matcher');
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
    // So is a hook history-session's Stop process runs (the turn build check, 2026-10-16).
    const ridden = (core.hooks.Stop || []).some((g) => g.hooks.some((h) => /history-session\.js"/.test(h.command)));
    if (ridden) for (const g of require('../stack/hooks/history-session.js').RIDERS) files.add(`stack/hooks/${g}.js`);
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
    if (ridden) assert.match(row, /the turn build check \(`check-turn-build\.js`\) inside `history-session\.js`'s Stop/, 'and the hook that runs the turn check');
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
