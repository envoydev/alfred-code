'use strict';
// NO MCP SERVER FLOATS. Every npm / PyPI server the stack ships launches a version someone committed
// (the plugin route, from meta/mcp-pins.json) or the install resolved (the copy route). Two servers
// the 2.0.0 cut removed ran `@latest` on both routes until 1.1.0, so two installs a week apart ran
// different server code from one stack release; playwright, the npm server left, is the witness.
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
const PINNED = { playwright: '@playwright/mcp', serena: 'serena-agent', memory: 'mcp-memory-service' };

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
    const args = (pins) => mcpServerShapes({ pins })['playwright-chrome'].servers['playwright-chrome'].args.slice(0, 2);
    assert.deepStrictEqual(args({ playwright: { version: '9.8.7', spelling: '@<v>' } }), ['-y', '@playwright/mcp@9.8.7']);
    // A pin that never resolved ships unpinned - npx then takes the newest, which is what @latest
    // said out loud; the fallback is the same, only the default moved.
    assert.deepStrictEqual(args({ playwright: { version: null } }), ['-y', '@playwright/mcp']);
});

test('the seed resolves the pin at install, and a failed lookup falls through to unpinned', () =>
{
    const found = mcp.resolvePins({ npmLatest: (pkg) => ({ '@playwright/mcp': '0.0.90' })[pkg] || '', pypiLatest: () => '' });
    assert.strictEqual(found.PW_PIN, '@0.0.90');
    const logs = [];
    const offline = mcp.resolvePins({ npmLatest: () => { throw new Error('offline'); }, pypiLatest: () => '', log: (m) => logs.push(m) });
    assert.strictEqual(offline.PW_PIN, '');
    assert.ok(logs.some((m) => m.includes('could not resolve playwright latest')), logs.join(' | '));
});

// End to end on the MCP copy route: the manifest row's placeholder must reach .mcp.json as a
// version, or as nothing - a literal `@PW_PIN@` is a package name npx cannot find.
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const SELECTION = 'skill markdown-style\nmcp playwright\n';
const NPM = 'case "$2" in @playwright/mcp) echo 0.0.90 ;; *) exit 1 ;; esac';
const servers = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers;
const launch = (repo) => ((servers(repo)['playwright-chrome'] || {}).args || []).slice(0, 2);

test('seed install on the MCP copy route writes the server at the resolved pin', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: NPM, curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, ['-y', '@playwright/mcp@0.0.90']);
});

test('seed install offline: the server is written unpinned, never with a placeholder or @latest', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: 'exit 1', curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, ['-y', '@playwright/mcp']);
    assert.match(out, /could not resolve playwright latest - installing unpinned/);
});

test('seed update over an install still on @latest rewrites the row to the pin', POSIX_ONLY, () =>
{
    const old = { mcpServers: {
        'playwright-chrome': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome'], env: {} },
        'my-browser': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--isolated'], env: {} },
    } };
    const prepare = (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(old, null, 2) + '\n');
    const inspect = (repo) => ({ pw: launch(repo), mine: servers(repo)['my-browser'] });
    const { result } = seedRun('update', SELECTION, { env: COPY_ROUTE, tools: { npm: NPM, curl: 'exit 1' }, prepare, inspect });
    assert.deepStrictEqual(result.pw, ['-y', '@playwright/mcp@0.0.90']);
    assert.deepStrictEqual(result.mine, old.mcpServers['my-browser'], "the user's own server was touched");
});
