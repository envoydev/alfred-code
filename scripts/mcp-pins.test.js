'use strict';
// NO MCP SERVER FLOATS. Every npm / PyPI server the stack ships launches the version the release
// committed in meta/mcp-pins.json - on the plugin route through the generated entries, on the copy
// route and for the browser download through the seed, which asks no registry (R35). Two servers the
// 2.0.0 cut removed ran `@latest` on both routes until 1.1.0, and until 2.0.0 the seed resolved the
// registry's latest at install - either way two installs a week apart ran different server code from
// one stack release; playwright, the npm server left, is the witness.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mcp = require('./install/mcp.js');
const { mcpServerShapes } = require('./build-marketplace.js');
const { PACKAGES } = require('./refresh-mcp-pins.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FLOATING = /[\w@/.-]+@latest\b/;
const PINNED = { browser: '@playwright/mcp', navigation: 'serena-agent', memory: 'mcp-memory-service', 'windows-desktop': 'windows-mcp', 'macos-desktop': 'macos-mcp' };

test('no shipped MCP launch line runs a package on @latest - manifest or generated plugin entries', () =>
{
    const manifest = JSON.parse(read('meta/stack-manifest.json'));
    const floatingRows = manifest.mcps.filter((r) => FLOATING.test(r.args)).map((r) => r.name);
    assert.deepStrictEqual(floatingRows, [], 'meta/stack-manifest.json still launches a floating package');
    const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
    const floatingEntries = marketplace.plugins
        .flatMap((p) => Object.entries(p.mcpServers || {}).map(([name, s]) => [name, (s.args || []).join(' ')]))
        .filter(([, args]) => FLOATING.test(args)).map(([name]) => name);
    assert.deepStrictEqual(floatingEntries, [], 'a generated plugin entry still launches a floating package');
});

test('the release pins cover every package server, and the generator spells a pin or ships unpinned - never @latest', () =>
{
    assert.deepStrictEqual(Object.keys(PACKAGES).sort(), Object.keys(PINNED).sort(), 'refresh-mcp-pins resolves a different set');
    const pins = JSON.parse(read('meta/mcp-pins.json')).pins;
    assert.deepStrictEqual(Object.keys(pins).sort(), Object.keys(PINNED).sort(), 'meta/mcp-pins.json pins a server the stack no longer ships');
    for (const [name, pkg] of Object.entries(PINNED))
    {
        assert.strictEqual(PACKAGES[name].package, pkg, `refresh-mcp-pins resolves the wrong package for ${name}`);
        assert.ok(pins[name].package === pkg && /^\d+\.\d+\.\d+/.test(pins[name].version || ''), `meta/mcp-pins.json has no committed pin for ${name}`);
    }
    // The entry starts the browser launcher (the profile's place is the project's data root), which hands
    // npx the package it is given.
    const args = (pins) => { const a = mcpServerShapes({ pins })['browser-chrome'].servers['browser-chrome'].args; return a.slice(a.indexOf('--package'), a.indexOf('--package') + 2); };
    assert.deepStrictEqual(args({ browser: { version: '9.8.7', spelling: '@<v>' } }), ['--package', '@playwright/mcp@9.8.7']);
    // A pin that never resolved ships unpinned - npx then takes the newest, which is what @latest
    // said out loud; the fallback is the same, only the default moved.
    assert.deepStrictEqual(args({ browser: { version: null } }), ['--package', '@playwright/mcp']);
});

test('the seed takes each pin from the release, never from a registry', () =>
{
    const release = JSON.parse(read('meta/mcp-pins.json')).pins;
    const found = mcp.resolvePins({ pins: release });
    assert.strictEqual(found.PW_PIN, `@${release.browser.version}`);
    // Every module of the seed, not only its entry: a lookup moved into a layer is the same lookup.
    const modules = fs.readdirSync(path.join(ROOT, 'scripts', 'install')).filter((f) => f.endsWith('.js'));
    assert.ok(modules.includes('alfred-code.js') && modules.includes('mcp.js'), `the seed's modules were not found: ${modules.join(',')}`);
    for (const file of modules)
        assert.ok(!/npmLatest|pypiLatest|npm', \['view'|pypi\.org/.test(read(`scripts/install/${file}`)), `scripts/install/${file} still carries a registry lookup`);
});

// End to end on the MCP copy route: the manifest row's placeholder must reach .mcp.json as the
// release's version - a literal `@PW_PIN@` is a package name npx cannot find. The registry answers a
// NEWER version and records every call, so a lookup that still happened shows twice.
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const SELECTION = 'skill markdown-style\nmcp browser\n';
const RECORD = (tool) => `printf '${tool} %s\\n' "$*" >> "$HOME/registry.log"; echo 9.9.9`;
const REGISTRY = { npm: RECORD('npm'), curl: RECORD('curl') };
const PW = `@playwright/mcp@${JSON.parse(read('meta/mcp-pins.json')).pins.browser.version}`;
const servers = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers;
// The row starts through the project-root anchor (`node -e <ROOT_BOOT> -- checkout`, re-verify 3 S2/S3); the launch is what it runs.
const launch = (repo) =>
{
    const { command, args = [] } = servers(repo)['browser-chrome'] || {};
    const words = command === 'node' && args[0] === '-e' && args[2] === '--' ? args.slice(4) : [command, ...args];
    return words.slice(0, 3);
};
const asked = (repo) => { try { return fs.readFileSync(path.join(path.dirname(repo), 'registry.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };

test('seed install on the MCP copy route writes the server at the release pin and asks no registry', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: REGISTRY, inspect: (repo) => ({ launch: launch(repo), asked: asked(repo) }) });
    assert.deepStrictEqual(result.launch, ['npx', '-y', PW]);
    assert.deepStrictEqual(result.asked, [], 'the seed asked a registry for a version');
});

test('seed install with the registry unreachable writes the same release pin, never a placeholder or @latest', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: 'exit 1', curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, ['npx', '-y', PW]);
    assert.doesNotMatch(out, /could not resolve|installing unpinned/);
});

test('seed update over an install still on @latest rewrites the row to the pin', POSIX_ONLY, () =>
{
    const old = { mcpServers: {
        'browser-chrome': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome'], env: {} },
        'my-browser': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--isolated'], env: {} },
    } };
    const prepare = (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(old, null, 2) + '\n');
    const inspect = (repo) => ({ pw: launch(repo), mine: servers(repo)['my-browser'] });
    const { result } = seedRun('update', SELECTION, { env: COPY_ROUTE, tools: REGISTRY, prepare, inspect });
    assert.deepStrictEqual(result.pw, ['npx', '-y', PW]);
    assert.deepStrictEqual(result.mine, old.mcpServers['my-browser'], "the user's own server was touched");
});

// A PyPI refresh takes the newest release the stack's PINNED Python can install (uv-python.js). The
// launchers start every uvx server on it, so a pin past its floor fails at launch - windows-mcp 0.8.6
// (2026-09-26) needs Python 3.14 while 0.8.5 runs on 3.12 and up.
test('refresh-mcp-pins: a PyPI pin never moves past what the pinned Python can install', () =>
{
    const { newestFor, admits } = require('./refresh-mcp-pins.js');
    const file = (requires, extra = {}) => [{ requires_python: requires, yanked: false, ...extra }];
    const json = { info: { version: '0.8.6' }, releases: {
        '0.8.4': file('>=3.12'), '0.8.5': file('>=3.12'), '0.8.6': file('>=3.14'),
        '0.9.0rc1': file('>=3.12'), '0.8.7': file('>=3.12', { yanked: true }), '0.8.10': [],
    } };
    assert.strictEqual(newestFor(json, '3.13'), '0.8.5');
    assert.strictEqual(newestFor(json, '3.14'), '0.8.6');
    assert.strictEqual(newestFor({ info: { version: '1.0.0' }, releases: { '1.0.0': file(null) } }, '3.13'), '1.0.0', 'no floor declared admits any Python');
    assert.strictEqual(newestFor({ info: { version: '2.0.0' }, releases: { '2.0.0': file('>=3.14') } }, '3.13'), null, 'nothing installable is no pin, never a pin that fails at launch');
    for (const [spec, ok] of [['>=3.11', true], ['>=3.12,<3.14', true], ['>3.13', false], ['<3.13', false], ['~=3.12', true], ['!=3.13.*', false], ['==3.13.*', true], ['>=3.13.1', false]])
        assert.strictEqual(admits(spec, '3.13'), ok, spec);
});

// M38: a by-hand `serena project index` in the shipped docs ran the newest serena-agent while the server ran the
// pin - the next release would index with one version and serve with another. Every shipped spelling names the
// release pin and its dependency cut-off (M24), the same the server starts on; this test goes red on a pin bump
// until the docs follow.
test('M38 every shipped serena index command names the release pin and the cut-off', () =>
{
    const file = JSON.parse(read('meta/mcp-pins.json'));
    const want = `--exclude-newer ${file.refreshed}T23:59:59Z --from serena-agent@${file.pins.navigation.version} serena project index`;
    const sites = [];
    const walk = (dir) =>
    {
        for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const rel = path.join(dir, d.name);
            if (d.isDirectory()) walk(rel);
            else if (/\.md$/.test(d.name)) for (const m of read(rel).matchAll(/uvx\s+--python[^`]*?serena\s+project\s+index/g)) sites.push([rel, m[0].replace(/\s+/g, ' ')]);
        }
    };
    for (const dir of ['setup-plugin', 'stack']) walk(dir);
    assert.ok(sites.length >= 4, `the post-install and update index lines are found: ${sites.length}`);
    for (const [rel, line] of sites) assert.ok(line.endsWith(want), `${rel}: ${line}`);
});

// R7: the stack's serena context copies serena-agent's own claude-code.yml at the pin, and a later serena could add
// an editing tool that context would then serve unwatched. The shipped YAML records the upstream file's sha256; the
// refresh keeps the navigation pin where it is until the new release's claude-code.yml hashes the same - i.e. until
// someone re-diffs the stack's file against it and records the new hash.
async function refreshRun({ navigation = '9.9.9', context = 'same', recorded = true, lists = {} } = {})
{
    const os = require('node:os');
    const { main } = require('./refresh-mcp-pins.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-pins-'));
    const pinsFile = path.join(dir, 'mcp-pins.json');
    const toolsFile = path.join(dir, 'mcp-tools.json');
    const contextFile = path.join(dir, 'navigation-context.yml');
    fs.copyFileSync(path.join(ROOT, 'meta', 'mcp-pins.json'), pinsFile);
    fs.writeFileSync(toolsFile, JSON.stringify({ servers: { memory: { version: 'old', tools: ['kept_tool'] } } }));
    const upstream = 'name: claude-code\nexcluded_tools: []\n';
    const sha = require('node:crypto').createHash('sha256').update(upstream).digest('hex');
    fs.writeFileSync(contextFile, `${recorded ? `# upstream: serena-agent 1.7.0 claude-code.yml sha256 ${sha}\n` : ''}name: alfred-code\n`);
    const out = [];
    const current = JSON.parse(fs.readFileSync(pinsFile, 'utf8')).pins;
    const rc = await main(['--write'], {
        pinsFile, toolsFile, contextFile, log: (l) => out.push(l), today: () => '2026-10-01',
        npmLatest: () => current.browser.version,
        pypiLatest: (pkg) => (pkg === 'serena-agent' ? navigation : Object.values(current).find((r) => r.package === pkg).version),
        upstreamContext: () => (context === 'same' ? upstream : context),
        listTools: (name) => (Object.hasOwn(lists, name) ? lists[name] : null),
    });
    const result = { rc, text: out.join('\n'), pins: JSON.parse(fs.readFileSync(pinsFile, 'utf8')), tools: JSON.parse(fs.readFileSync(toolsFile, 'utf8')) };
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
}

test('R7 refresh-mcp-pins: a serena bump whose claude-code context changed is refused until it is re-diffed', async () =>
{
    const was = JSON.parse(read('meta/mcp-pins.json')).pins.navigation.version;
    const changed = await refreshRun({ context: 'name: claude-code\nexcluded_tools: []\nnew_tool: yes\n' });
    assert.strictEqual(changed.pins.pins.navigation.version, was, 'the navigation pin stays');
    assert.match(changed.text, /navigation: .* -> 9\.9\.9 REFUSED - serena-agent 9\.9\.9's claude-code\.yml is not the one stack\/mcp\/navigation-context\.yml was diffed against/);
    assert.strictEqual(changed.rc, 1, 'a refused bump is a failed refresh');
    const none = await refreshRun({ recorded: false });
    assert.strictEqual(none.pins.pins.navigation.version, was, 'no recorded hash refuses too');
    assert.match(none.text, /REFUSED - .*records no upstream sha256/);
    const unreadable = await refreshRun({ context: null });
    assert.strictEqual(unreadable.pins.pins.navigation.version, was, 'an unreadable upstream context refuses');
    const same = await refreshRun();
    assert.strictEqual(same.pins.pins.navigation.version, '9.9.9', 'an unchanged upstream context lets the bump through');
    assert.strictEqual(same.rc, 0);
    assert.strictEqual(same.pins.refreshed, '2026-10-01');
});

// M31: the refresh records each pinned server's tool names beside the pins (meta/mcp-tools.json), which lint check 62
// reads; a server it cannot list keeps its committed list and is said NOT CHECKED - a refresh on a plane changes nothing.
test('M31 refresh-mcp-pins: --write records each server\'s tool names, and keeps a list it could not read', async () =>
{
    const got = await refreshRun({ lists: { browser: ['browser_navigate', 'browser_click'] } });
    assert.deepStrictEqual(got.tools.servers.browser.tools, ['browser_click', 'browser_navigate'], 'sorted');
    assert.strictEqual(got.tools.servers.browser.version, JSON.parse(read('meta/mcp-pins.json')).pins.browser.version);
    assert.deepStrictEqual(got.tools.servers.memory.tools, ['kept_tool'], 'an unlisted server keeps what it had');
    assert.match(got.text, /tools memory: NOT CHECKED/);
});

test('M31 meta/mcp-tools.json lists every pinned server at its pin, and the desktop launcher\'s gate names the same Windows tools', () =>
{
    const pins = JSON.parse(read('meta/mcp-pins.json')).pins;
    const tools = JSON.parse(read('meta/mcp-tools.json')).servers;
    for (const [name, row] of Object.entries(pins))
    {
        assert.ok(tools[name] && tools[name].tools.length, `${name} has a tool list`);
        assert.strictEqual(tools[name].version, row.version, `${name}'s list is for the pinned version`);
    }
    assert.ok(tools.documentation && tools.documentation.tools.includes('query-docs'), 'the hosted documentation server is listed');
    const { WINDOWS_TOOLS } = require('../stack/mcp/desktop-launch.js');
    assert.deepStrictEqual([...WINDOWS_TOOLS].sort(), [...tools['windows-desktop'].tools].sort());
});
