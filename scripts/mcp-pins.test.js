'use strict';
// NO MCP SERVER FLOATS. Every npm / PyPI server the stack ships launches a version someone committed
// (the plugin route, from meta/mcp-pins.json) or the install resolved (the copy route, the seed and
// the twins) - except angular-cli, which must match the workspace's own ng. chrome-devtools and
// appium-mcp ran `@latest` on both routes until 1.1.0, so two installs a week apart ran different
// server code from one stack release.
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
const PINNED = { 'chrome-devtools': 'chrome-devtools-mcp', 'appium-mcp': 'appium-mcp' };

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

test('the release pins cover both packages, and the generator spells a pin or ships unpinned - never @latest', () =>
{
    for (const [name, pkg] of Object.entries(PINNED))
    {
        assert.deepStrictEqual(PACKAGES[name], { registry: 'npm', package: pkg, spelling: '@<v>' }, `refresh-mcp-pins does not resolve ${name}`);
        const row = JSON.parse(read('meta/mcp-pins.json')).pins[name];
        assert.ok(row && row.package === pkg && /^\d+\.\d+\.\d+/.test(row.version || ''), `meta/mcp-pins.json has no committed pin for ${name}`);
    }
    const pinned = mcpServerShapes({ pins: {
        'chrome-devtools': { version: '9.8.7', spelling: '@<v>' },
        'appium-mcp': { version: '6.5.4', spelling: '@<v>' },
    } });
    assert.deepStrictEqual(pinned['chrome-devtools'].servers['chrome-devtools'].args, ['-y', 'chrome-devtools-mcp@9.8.7']);
    assert.deepStrictEqual(pinned['appium-mcp'].servers['appium-mcp'].args, ['-y', 'appium-mcp@6.5.4']);
    // A pin that never resolved ships unpinned - npx then takes the newest, which is what @latest
    // said out loud; the fallback is the same, only the default moved.
    const unresolved = mcpServerShapes({ pins: { 'chrome-devtools': { version: null }, 'appium-mcp': {} } });
    assert.deepStrictEqual(unresolved['chrome-devtools'].servers['chrome-devtools'].args, ['-y', 'chrome-devtools-mcp']);
    assert.deepStrictEqual(unresolved['appium-mcp'].servers['appium-mcp'].args, ['-y', 'appium-mcp']);
});

test('the seed resolves both pins at install, and a failed lookup falls through to unpinned', () =>
{
    const found = mcp.resolvePins({ npmLatest: (pkg) => ({ 'chrome-devtools-mcp': '1.9.0', 'appium-mcp': '1.94.2' })[pkg] || '', pypiLatest: () => '' });
    assert.strictEqual(found.CD_PIN, '@1.9.0');
    assert.strictEqual(found.AP_PIN, '@1.94.2');
    const logs = [];
    const offline = mcp.resolvePins({ npmLatest: () => { throw new Error('offline'); }, pypiLatest: () => '', log: (m) => logs.push(m) });
    assert.strictEqual(offline.CD_PIN, '');
    assert.strictEqual(offline.AP_PIN, '');
    for (const name of Object.keys(PINNED))
        assert.ok(logs.some((m) => m.includes(`could not resolve ${name} latest`)), `no unpinned line for ${name}: ${logs.join(' | ')}`);
});

// End to end on the MCP copy route: the manifest row's placeholder must reach .mcp.json as a
// version, or as nothing - a literal `@CD_PIN@` is a package name npx cannot find.
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const SELECTION = 'skill markdown-style\nmcp chrome-devtools\nmcp appium-mcp\n';
const NPM = 'case "$2" in chrome-devtools-mcp) echo 1.9.0 ;; appium-mcp) echo 1.94.2 ;; *) exit 1 ;; esac';
const launch = (repo) =>
{
    const servers = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers;
    return Object.fromEntries(Object.keys(PINNED).map((name) => [name, (servers[name] || {}).args || []]));
};

test('seed install on the MCP copy route writes both servers at the resolved pin', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: NPM, curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, { 'chrome-devtools': ['-y', 'chrome-devtools-mcp@1.9.0'], 'appium-mcp': ['-y', 'appium-mcp@1.94.2'] });
});

test('seed install offline: both servers are written unpinned, never with a placeholder or @latest', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: 'exit 1', curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, { 'chrome-devtools': ['-y', 'chrome-devtools-mcp'], 'appium-mcp': ['-y', 'appium-mcp'] });
    assert.match(out, /could not resolve chrome-devtools latest - installing unpinned/);
});

test('seed update over an install still on @latest rewrites both rows to the pin', POSIX_ONLY, () =>
{
    const old = { mcpServers: {
        'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], env: {} },
        'appium-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'appium-mcp@latest'], env: {} },
        'my-chrome': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--isolated'], env: {} },
    } };
    const prepare = (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(old, null, 2) + '\n');
    const inspect = (repo) => ({ ...launch(repo), mine: JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers['my-chrome'] });
    const { result } = seedRun('update', SELECTION, { env: COPY_ROUTE, tools: { npm: NPM, curl: 'exit 1' }, prepare, inspect });
    assert.deepStrictEqual(result['chrome-devtools'], ['-y', 'chrome-devtools-mcp@1.9.0']);
    assert.deepStrictEqual(result['appium-mcp'], ['-y', 'appium-mcp@1.94.2']);
    assert.deepStrictEqual(result.mine, old.mcpServers['my-chrome'], "the user's own server was touched");
});
