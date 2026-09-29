'use strict';
// The MCP and plugin package's prose facts (2.1.5 Minors): each assertion holds a wrong claim absent and the
// right one present, where no subject suite fits. The evidence behind each is named beside it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const each = (dir, re) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).filter((f) => re.test(f)).map((f) => path.join(dir, f).split(path.sep).join('/'));

// M20: mcp-memory-service 11.13.0 and later list numpy>=1.24.0 among their core requires_dist (PyPI JSON).
test('M20 the memory launcher no longer says the service leaves numpy undeclared', () =>
{
    const text = read('stack/mcp/memory-launch.js');
    assert.doesNotMatch(text, /does not declare it/);
    assert.match(text, /declare it themselves \(numpy>=1\.24\.0/);
});

// M23: since 2.1.0 no skill rides the core; the skill is an always-on library copy.
test('M23 the claude-md-management retirement row calls the skill always-on, not the core\'s', () =>
{
    const text = read('meta/retired-plugins.json');
    assert.doesNotMatch(text, /the core's alfred-habits-adjust-claude-md skill/);
    assert.match(text, /the always-on alfred-habits-adjust-claude-md skill/);
});

// M29: each kept MCP server's launcher downloads and runs its pinned package at every session start, and serena
// fetches its language servers at run time - the Starts row said neither.
test('M29 the README Starts row says what each MCP plugin runs at session start', () =>
{
    const row = read('README.md').split('\n').find((l) => l.startsWith('| **Starts** |'));
    assert.ok(row, 'the Starts row');
    assert.match(row, /downloads and runs its pinned package/);
    for (const pkg of ['serena-agent', 'mcp-memory-service', '@playwright/mcp', 'windows-mcp', 'macos-mcp']) assert.ok(row.includes(pkg), pkg);
    assert.match(row, /language servers/);
});

// M24 behind a mirror: uv treats a file with no PEP 700 upload time as unavailable under a cut-off, and its error never
// names the cut-off (docs.astral.sh/uv/concepts/resolution, 'Reproducible resolutions'); `UV_EXCLUDE_NEWER=false` lifts
// it (docs.astral.sh/uv/reference/environment). The post-install connect check is where a server that will not start
// is read about, so the escape is named there.
test('M24 the post-install connect check names the escape for an index with no upload times', () =>
{
    const text = read('setup-plugin/references/post-install.md');
    const connect = text.slice(text.indexOf('**Then check they actually CONNECTED.**'), text.indexOf('**And check the plugins are ENABLED'));
    assert.match(connect, /publishes no upload times/);
    assert.match(connect, /`UV_EXCLUDE_NEWER=false`/);
    assert.match(connect, /`exclude-newer = false` in its `\[\[index\]\]` entry of the user-level\s+`uv\.toml`/);
});

// M32: a short tool name inside a call-shaped backtick is called as written and fails 'No such tool' (the pin
// serena-tools-are-deferred measured seven such failures), so the seats spell the full plugin name.
test('M32 the verifiers, the integration reviewer and the solve flow spell the navigation tools in full', () =>
{
    const seats = each('stack/agents', /(-verifier|integration-reviewer)\.md$/);
    assert.strictEqual(seats.length, 11);
    for (const f of seats)
    {
        const text = read(f);
        assert.doesNotMatch(text, /\(`get_symbols_overview` \/ `find_symbol`\)/, f);
        assert.match(text, /reopen it through the navigation server \(`mcp__plugin_navigation_navigation__get_symbols_overview` \/ `mcp__plugin_navigation_navigation__find_symbol`\)/, f);
    }
    const solve = read('stack/skills/alfred-task-solve/SKILL.md');
    assert.doesNotMatch(solve, /`write_memory\(/);
    assert.match(solve, /`mcp__plugin_navigation_navigation__write_memory\('<feature>__<contract_version>__<seat>__<task>'/);
});

// M33: the documentation server is locked into every install, so a seat names it by its role and never hedges
// on it being absent; what is left is the unreachable case.
test('M33 the seats name the locked documentation server one way and never as optional', () =>
{
    for (const f of each('stack/agents', /\.md$/))
    {
        const text = read(f);
        for (const stale of [/library-docs MCP/, /MCP that serves current library documentation/, /docs-lookup MCP/, /none installed/])
            assert.doesNotMatch(text, stale, `${f}: ${stale}`);
    }
    for (const f of ['angular-test-resolver', 'dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'console-implementer', 'ionic-angular-implementer',
        'console-solution-designer', 'devops-solution-designer', 'ionic-angular-solution-designer', 'wpf-solution-designer'])
        assert.match(read(`stack/agents/${f}.md`), /the documentation server/, f);
});

// M34: the house rule names a server by its role, never its upstream as a verb.
test('M34 no skill says serena-first or serena-navigate', () =>
{
    for (const f of each('stack/skills', /\.md$/)) assert.doesNotMatch(read(f), /serena-(first|navigat)/, f);
});

// M37: serena 1.7.0 has no call-hierarchy tool (serena tools list --all at the pin; meta/mcp-tools.json).
test('M37 the inventory page claims no call-hierarchy tool for the navigation server', () =>
{
    const row = read('docs/alfred-code.html').split('\n').find((l) => l.startsWith('  ["navigation", "MCP server"'));
    assert.ok(row);
    assert.doesNotMatch(row, /call-hierarchy/);
    assert.match(row, /find-references, implementations and declarations/);
});

// M40: the desktop ToolSearch lines load four tools each; the rest of the server's tools exist too, and the
// browser row already says so.
test('M40 both desktop ToolSearch lines say the session\'s listing names more tools', () =>
{
    const skill = read('stack/skills/desktop-automation/SKILL.md');
    const rule = read('stack/skills/alfred-capture-agent-capabilities/references/generated-rule-template.md');
    for (const server of ['windows-desktop', 'macos-desktop'])
    {
        assert.match(skill, new RegExp(`plus the other \`mcp__plugin_${server}_${server}__\\*\` names the session's own listing shows`), server);
        const row = rule.split('\n').find((l) => l.startsWith(`- \`${server}\``));
        assert.match(row, /plus the other `mcp__plugin_<server>_<server>__\*` names the session's own listing shows\.$/, server);
    }
});

// M42: the status example row is the default plugin route's target, at the pin.
test('M42 the status example row shows the plugin route launcher at the release pin', () =>
{
    const text = read('setup-plugin/commands/status.md');
    assert.doesNotMatch(text, /npx -y @playwright\/mcp@0\.0\.80/);
    assert.ok(text.includes('node .../browser-launch.js --package @playwright/mcp@<pin> --browser firefox'), 'the plugin-route shape, at the pin');
});

// M43: mcp-memory-service reads tags only from `metadata` (server/handlers/memory.py, 11.14.0 line 193); a top-level
// `tags` argument is dropped, and an untagged row is invisible to the session-start project filter.
test('M43 baseline-memory names metadata.tags for the project tag', () =>
{
    const text = read('stack/rules/baseline-memory.md');
    assert.match(text, /`metadata\.tags` `project:<name>`/);
});

// M44: the memory ToolSearch line had two homes no pin tied together.
test('M44 the memory ToolSearch line is pinned across its homes', () =>
{
    const pin = JSON.parse(read('meta/shared-rules.json')).rules['memory-toolsearch-line'];
    assert.ok(pin, 'a memory-toolsearch-line pin');
    const line = 'ToolSearch select:mcp__plugin_memory_memory__memory_store,mcp__plugin_memory_memory__memory_search,mcp__plugin_memory_memory__memory_list';
    assert.strictEqual(pin.owner.file, 'stack/rules/baseline-memory.md');
    assert.strictEqual(pin.owner.marker, line);
    assert.deepStrictEqual(pin.sites.map((s) => [s.file, s.marker]), [['stack/hooks/memory-session.js', line]]);
});

// M45: where the capabilities capture never ran, nothing told the main thread the browser tools are deferred.
test('M45 the live probe says the browser tools are deferred and loaded through ToolSearch', () =>
{
    const text = read('stack/skills/alfred-task-verify-code/references/live-probe.md').replace(/\s+/g, ' ');
    // Review 2.1.5 plugin, MINOR 3: 'defers MCP tools, its tools are deferred' read as a tautology.
    assert.doesNotMatch(text, /its tools are deferred/);
    assert.match(text, /Where the harness defers MCP tools, load the browser plugin's tools through ToolSearch, by the names the deferred listing shows, before you call it absent\./);
});

// R3: MacOS-MCP 0.4.6 has no exclude FLAG, but `[tools] exclude` in its config.toml removes a tool
// (macos_mcp/__main__.py: `for tool_name in cfg.tools.exclude: mcp.remove_tool(...)`; infrastructure/config.py).
test('R3 no page says MacOS-MCP cannot switch a tool off; each names the config.toml exclude', () =>
{
    const sites = {
        'stack/mcp/desktop-launch.js': /no exclude flag; its own config\.toml `\[tools\] exclude` removes/,
        'stack/skills/desktop-automation/references/macos.md': /no exclude flag; its own `~\/\.macos-mcp\/config\.toml` `\[tools\] exclude` removes/,
        'docs/alfred-code.html': /no exclude flag; its own config\.toml \[tools\] exclude removes/,
        'CLAUDE.md': /MacOS-MCP 0\.4\.6 has no exclude flag; its own config\.toml `\[tools\] exclude` removes/,
    };
    for (const [file, right] of Object.entries(sites))
    {
        const text = read(file);
        assert.doesNotMatch(text, /MacOS-MCP (0\.4\.6 )?has no (such )?flag|no flag to switch a tool off|no off switch|MacOS-MCP has no flag for it/, file);
        assert.match(text, right, file);
    }
});

// R13: MacOS-MCP 0.4.6 has no Screenshot tool - the image is Snapshot with use_vision (its __main__.py tool list).
test('R13 the macOS lines name a black vision snapshot, never a screenshot the server does not have', () =>
{
    for (const file of ['stack/mcp/desktop-launch.js', 'stack/skills/alfred-capture-agent-capabilities/references/generated-rule-template.md'])
    {
        const text = read(file);
        assert.doesNotMatch(text, /black screenshots/, file);
        assert.match(text, /a black vision snapshot/, file);
    }
});

// M35: the retired 1.x core alias carries these nine seats, and the renamed MCP aliases (serena, context7, playwright-*)
// keep serving their successor's server under the OLD name - so a 1.x install whose plugins update before its own
// update runs had seats whose grants named only the new spelling and resolved to nothing. For the 2.x line each alias
// seat also grants the old spelling of every renamed server it holds (an absent server's tool is inert), and denies
// the old spelling of every browser tool it denies. No other seat carries an old spelling.
test('M35 the 1.x alias seats also grant the renamed servers\' old spellings, and no other seat does', () =>
{
    const { mcpAliasEntries } = require('./build-marketplace.js');
    const alias = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p) => p.name === 'claude-stack'); // legacy-name
    const seats = alias.agents.map((a) => path.basename(a, '.md'));
    assert.strictEqual(seats.length, 9);
    const olds = mcpAliasEntries().map((e) => e.name);
    const line = (text, key) => ((text.split('\n').find((l) => l.startsWith(`${key}:`)) || '').slice(key.length + 1)).split(',').map((t) => t.trim()).filter(Boolean);
    const toOld = { navigation: 'serena', documentation: 'context7' };
    const oldOf = (spelling) =>
    {
        const m = /^mcp__plugin_([a-z-]+)_\1__(.+)$/.exec(spelling);
        if (!m) return null;
        const [, plugin, tool] = m;
        const old = toOld[plugin] || (plugin.startsWith('browser-') ? `playwright-${plugin.slice('browser-'.length)}` : null);
        return old ? `mcp__plugin_${old}_${old}__${tool}` : null;
    };
    for (const f of fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((n) => n.endsWith('.md')))
    {
        const text = read(`stack/agents/${f}`);
        const seat = path.basename(f, '.md');
        const tools = line(text, 'tools');
        const denied = line(text, 'disallowedTools');
        const hasOld = [...tools, ...denied].some((t) => olds.some((o) => t.startsWith(`mcp__plugin_${o}_${o}__`)));
        if (!seats.includes(seat)) { assert.ok(!hasOld, `${seat} is no alias seat and carries an old spelling`); continue; }
        for (const t of tools) { const old = oldOf(t); if (old) assert.ok(tools.includes(old), `${seat} grants ${t} but not ${old}`); }
        for (const t of denied) { const old = oldOf(t); if (old) assert.ok(denied.includes(old), `${seat} denies ${t} but not ${old}`); }
    }
});
