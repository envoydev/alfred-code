'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, coreEntry, hooksBlock, parseHookWirings, mergeHooks, MANIFEST } = require('./build-marketplace.js');
const { CORE_DEP_PLUGINS } = require('./install/plugins.js');

const SCRIPT = path.join(__dirname, 'build-marketplace.js');
const run = (args, opts = {}) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });

// A hook's whole launch line: exec form's command and args, or shell form's command.
const line = (h) => [h.command, ...(h.args || [])].join(' ');
const entries = buildEntries();
const byName = Object.fromEntries(entries.map(e => [e.name, e]));

test('every entry is a manifest at the repo root and lists its own paths', () => {
    for (const e of entries)
    {
        assert.ok(!('source' in e) && !('strict' in e), `${e.name} is a manifest: the catalog says where it comes from`);
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

// 2026-11-14: the catalog moved to envoydev/plugins-marketplaces, which lists the core from this repo; the core's
// manifest is the root .claude-plugin/plugin.json, generated from the same entry.
test('--write-manifest writes the core entry as the plugin manifest, and a re-run changes nothing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const file = path.join(tmp, '.claude-plugin', 'plugin.json');
    try
    {
        run(['--write-manifest', '--manifest-file', file]);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), coreEntry(), 'the manifest is the core entry');
        const once = fs.readFileSync(file, 'utf8');
        assert.match(run(['--write-manifest', '--manifest-file', file]), /plugin manifest current/, 'a re-run changes nothing');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), once);
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the committed manifest is the generated core, and no marketplace file is shipped', () => {
    assert.deepStrictEqual(SHIPPED, coreEntry(), 'run `npm run plugin-manifest`');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json')), 'the catalog lives in envoydev/plugins-marketplaces');
    for (const key of ['source', 'strict', 'category', 'tags']) assert.ok(!(key in SHIPPED), `${key} is a catalog key, not a manifest one`);
});

test('every core hook runs in exec form: node itself, the script its first argument, no shell', () => {
    // On Windows a shell-form hook starts three processes (Git Bash's launcher, bash, node) and a Git Bash console;
    // exec form starts node alone (code.claude.com/docs/en/hooks, 'Exec form and shell form', Claude Code 2.1.139+).
    const core = coreEntry();
    const hooks = Object.values(core.hooks).flat().flatMap((g) => g.hooks);
    assert.ok(hooks.length > 20, 'the core carries the stack hooks');
    for (const h of hooks) {
        assert.strictEqual(h.command, 'node', `exec form runs node itself: ${JSON.stringify(h)}`);
        assert.ok(Array.isArray(h.args) && h.args.length >= 1, `exec form has args: ${JSON.stringify(h)}`);
        const m = /^\$\{CLAUDE_PLUGIN_ROOT\}\/((?:stack|setup-plugin)\/hooks\/[\w-]+\.js)$/.exec(h.args[0]);
        assert.ok(m, `the first argument is the script under the plugin root, unquoted: ${h.args[0]}`);
        assert.ok(fs.existsSync(path.join(__dirname, '..', m[1])), `the script exists: ${m[1]}`);
        for (const a of h.args) assert.ok(!/["'\s]/.test(a), `an argument carries no quote or blank: ${a}`);
    }
});

test('the core carries every stack hook inline, its own two first in each event', () => {
    const core = coreEntry();
    const stack = hooksBlock(parseHookWirings());
    const commands = (block, event) => (block[event] || []).flatMap((g) => g.hooks.map((h) => `${g.matcher}|${line(h)}|${h.timeout}`));
    for (const event of Object.keys(stack))
        for (const c of commands(stack, event))
            assert.ok(commands(core.hooks, event).includes(c), `the core must carry ${event} ${c}`);
    const own = (event) => commands(core.hooks, event).filter((c) => c.includes('/setup-plugin/hooks/'));
    assert.deepStrictEqual(own('PreToolUse').length + own('SessionStart').length + own('PostToolUse').length, 9,
        'the core keeps its own two hooks, the layer gate on three wirings plus its five table prints');
    // F4 (2026-10-28): the paste check voids at PostToolUse, where the ask's own message is on disk.
    const post = core.hooks.PostToolUse.find((g) => g.matcher === 'AskUserQuestion');
    assert.match(line(post.hooks[0]), /setup-plugin\/hooks\/guard-layer-table\.js/, 'the layer gate leads PostToolUse AskUserQuestion');
    assert.match(line(core.hooks.PreToolUse[0].hooks[0]), /setup-plugin\/hooks\/guard-layer-table\.js/, 'the layer-table guard leads PreToolUse');
    // 2026-10-21: the walk's next step is judged too - on Bash, spawned only for a `node` call.
    const bash = core.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.deepStrictEqual([bash.hooks[0].if, /guard-layer-table\.js/.test(line(bash.hooks[0]))], ['Bash(node *)', true], 'the layer gate rides Bash behind its if filter');
    assert.match(line(core.hooks.SessionStart[0].hooks[0]), /setup-plugin\/hooks\/library-stamp\.js/, 'the library-stamp line leads SessionStart');
    const total = (block) => Object.values(block).flat().reduce((n, g) => n + g.hooks.length, 0);
    assert.strictEqual(total(core.hooks), total(stack) + 9, 'nothing doubled, nothing lost');
});

// 2026-11-10: the decision table is printed when it is made - a PostToolUse Bash handler per table script, each behind
// its own `if` ('The `if` field holds exactly one permission rule ... define a separate hook handler for each',
// code.claude.com/docs/en/hooks), the set held to the hook's own TABLE_SCRIPT line, read from its source (the hook
// reads stdin at its top level, so no test requires it).
test('the layer gate prints tables at PostToolUse Bash: one if-filtered handler per table script', () => {
    const core = coreEntry();
    const bash = core.hooks.PostToolUse.find((g) => g.matcher === 'Bash');
    assert.ok(bash, 'a PostToolUse Bash group');
    const ours = bash.hooks.filter((h) => /guard-layer-table\.js/.test(line(h)));
    const rules = ours.map((h) => h.if);
    assert.deepStrictEqual(rules, ['Bash(node *stack-select.js*)', 'Bash(node *workspace.js*)', 'Bash(node *plugin-settings.js*)',
        'Bash(node *audit-install.js*)', 'Bash(node *update-preflight.js*)']);
    const src = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'hooks', 'guard-layer-table.js'), 'utf8');
    const m = /^const TABLE_SCRIPT = \/\(\?:([\w|-]+)\)\\\.js\\b\/;$/m.exec(src);
    assert.ok(m, 'the hook declares TABLE_SCRIPT on its own line');
    assert.deepStrictEqual(rules.map((r) => /\*([\w-]+)\.js\*/.exec(r)[1]).sort(), m[1].split('|').sort(), 'one handler per script the hook prints for');
    for (const h of ours) assert.strictEqual(h.timeout, 10);
    // Final review (2026-11-10): handlers equal in command and args could be merged as one whatever their `if` - the hooks page
    // promises nothing for that - so each carries its script's name as a second arg (no leading '--': no CLI invocation).
    assert.strictEqual(new Set(ours.map((h) => line(h))).size, ours.length, `five distinct launch lines: ${ours.map((h) => line(h)).join(' | ')}`);
    for (const h of ours) assert.ok(!String(h.args[1] || '').startsWith('--'), line(h));
});

// HK-22 retired (2026-11-04): the Haiku stop judge missed its gate (median 125 of 161 against the regex's 122, flips 24;
// docs/stop-judge-gate-evidence.md), so its row, its prompt file and the generator's prompt path went with it (D7).
test('the manifest carries no prompt row and the generator no prompt path', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    assert.strictEqual(manifest.hooks.some((r) => r.type === 'prompt'), false, 'no prompt row');
    assert.strictEqual('promptWiring' in require('./build-marketplace.js'), false, 'no prompt path in the generator');
    assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'stack', 'hooks', 'stop-judge-prompt.txt')), false, 'no prompt file');
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
test('the live manifest carries no MCP server, and every id the catalog listed has a retired row with an add-json add-back', () => {
    assert.strictEqual(SHIPPED.mcpServers, undefined, 'the core carries no server');
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
const SHIPPED = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

test('the shipped core declares no dependency, so it loads with nothing beside it', () => {
    assert.strictEqual(SHIPPED.dependencies, undefined);
    assert.strictEqual(SHIPPED.allowCrossMarketplaceDependenciesOn, undefined);
});

// R109: superpowers is no stack pick at all, so no run adds it on its own.
// claude-hud is the one plugin from another marketplace every run installs.
// 2.2.0: claude-hud is an optional pick (the user's ruling of 2026-10-06), so no plugin rides beside the core.
test('no plugin is added from another marketplace on every run - claude-hud is a pick, superpowers none', () => {
    assert.strictEqual(SHIPPED.dependencies, undefined);
    assert.deepStrictEqual(CORE_DEP_PLUGINS, []);
    assert.ok(!CORE_DEP_PLUGINS.some((spec) => spec.split('@')[0] === 'superpowers'), `CORE_DEP_PLUGINS still names superpowers: ${CORE_DEP_PLUGINS.join(', ')}`);
});

// The live manifest carries NO renames map (S11/S16 - a rename strands an install).
test('the live manifest carries no renames key', () => {
    assert.ok(!('renames' in SHIPPED), 'a renames key would move an install onto an id it never installs');
});

test('--hooks-entry prints the core hooks block and writes nothing', () => {
    const before = fs.readFileSync(MANIFEST, 'utf8');
    const printed = JSON.parse(run(['--hooks-entry']));
    assert.deepStrictEqual(printed, coreEntry().hooks);
    assert.strictEqual(fs.readFileSync(MANIFEST, 'utf8'), before);
});

test('the core entry wires the library-stamp line at a startup, a clear and a resume - never a compaction - with a timeout', () =>
{
    const core = buildEntries().find((e) => e.name === 'alfred-code');
    const start = core.hooks.SessionStart;
    assert.ok(Array.isArray(start) && start.length >= 1, JSON.stringify(core.hooks));
    assert.strictEqual(start[0].matcher, 'startup|clear|resume|fork', 'its own group leads the event (loading audit 2026-10-21 G12; a fork, audit 2026-10-30 HK-24)');
    assert.strictEqual(start[0].hooks.length, 1, 'no stack hook shares its matcher');
    assert.match(line(start[0].hooks[0]), /setup-plugin\/hooks\/library-stamp\.js/);
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
        .map((h) => /^\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)$/.exec(h.args[0])[1]));
    // A dispatcher is a runner, not a hook: the guards it runs in-process are the hooks.
    const dispatcher = require('../stack/hooks/shell-guards.js');
    const fileDispatcher = require('../stack/hooks/file-guards.js');
    const dispatched = files.delete(`stack/hooks/${dispatcher.SELF}.js`);
    if (dispatched) for (const g of dispatcher.GUARDS) files.add(`stack/hooks/${g}.js`);
    const fileDispatched = files.delete(`stack/hooks/${fileDispatcher.SELF}.js`);
    if (fileDispatched) for (const g of fileDispatcher.NAMES) files.add(`stack/hooks/${g}.js`);
    // So is a hook history-session's Stop process runs (the turn build check, 2026-10-16).
    const ridden = (core.hooks.Stop || []).some((g) => g.hooks.some((h) => /history-session\.js$/.test(line(h))));
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
    assert.deepStrictEqual(core.commands, ['./setup-plugin/commands/'], 'the core entry lists the commands folder');
    const commandCount = require('./lint-skills.js').commandFiles(path.join(__dirname, '..', 'setup-plugin', 'commands')).length;
    assert.deepStrictEqual(m.slice(1), [word(commandCount), word(core.skills.length), scripted.join(), word(core.agents.length),
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
    const committed = [JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))];
    const all = [...fields([coreEntry()]), ...fields(committed), ...fields(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8')).entries)];
    assert.ok(all.some(([k]) => k.endsWith('.hook_profile')), 'the hook profile field is still declared');
    for (const [key, field] of all) assert.ok(!Object.hasOwn(field, 'options'), `${key} declares options`);
    const profile = coreEntry().userConfig.hook_profile;
    assert.strictEqual(profile.default, 'standard');
    for (const name of ['minimal', 'standard', 'strict']) assert.match(profile.description, new RegExp(`\\b${name}\\b`), `the description names ${name}`);
});

// Audit 2026-11-03 SYS-06: the core's description names what the stack ships - no MCP server since 2.10.1. The
// catalog's own metadata moved to envoydev/plugins-marketplaces with it.
test('the manifest description names no MCP server', () => {
    assert.doesNotMatch(SHIPPED.description, /\bMCP\b/i);
});

// O2 (inventory A): a filesystem server's read_media_file reads a file like read_file; the core entry wires the secret
// guard on it too.
test('O2: the filesystem read row names read_media_file', () => {
  const hooks = JSON.stringify(byName['alfred-code'].hooks || {});
  const m = /"matcher":"(\^mcp__\.\+__\([^"]*read_text_file[^"]*\)\$)"/.exec(hooks);
  assert.ok(m, 'the core entry carries the filesystem read row');
  const re = new RegExp(m[1].replace(/\\\\/g, '\\'));
  assert.ok(re.test('mcp__x__read_media_file'), 'read_media_file'); // mcp-fixture
  assert.ok(re.test('mcp__x__read_text_file'), 'read_text_file still'); // mcp-fixture
  assert.ok(!re.test('mcp__x__read_media_file_x'), 'anchored'); // mcp-fixture
});
