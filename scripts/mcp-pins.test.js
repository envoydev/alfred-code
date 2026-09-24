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

test('the seed takes each pin from the release, never from a registry', () =>
{
    const release = JSON.parse(read('meta/mcp-pins.json')).pins;
    const found = mcp.resolvePins({ pins: release });
    assert.strictEqual(found.PW_PIN, `@${release.playwright.version}`);
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
const SELECTION = 'skill markdown-style\nmcp playwright\n';
const RECORD = (tool) => `printf '${tool} %s\\n' "$*" >> "$HOME/registry.log"; echo 9.9.9`;
const REGISTRY = { npm: RECORD('npm'), curl: RECORD('curl') };
const PW = `@playwright/mcp@${JSON.parse(read('meta/mcp-pins.json')).pins.playwright.version}`;
const servers = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers;
const launch = (repo) => ((servers(repo)['playwright-chrome'] || {}).args || []).slice(0, 2);
const asked = (repo) => { try { return fs.readFileSync(path.join(path.dirname(repo), 'registry.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };

test('seed install on the MCP copy route writes the server at the release pin and asks no registry', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: REGISTRY, inspect: (repo) => ({ launch: launch(repo), asked: asked(repo) }) });
    assert.deepStrictEqual(result.launch, ['-y', PW]);
    assert.deepStrictEqual(result.asked, [], 'the seed asked a registry for a version');
});

test('seed install with the registry unreachable writes the same release pin, never a placeholder or @latest', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, { env: COPY_ROUTE, tools: { npm: 'exit 1', curl: 'exit 1' }, inspect: launch });
    assert.deepStrictEqual(result, ['-y', PW]);
    assert.doesNotMatch(out, /could not resolve|installing unpinned/);
});

test('seed update over an install still on @latest rewrites the row to the pin', POSIX_ONLY, () =>
{
    const old = { mcpServers: {
        'playwright-chrome': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome'], env: {} },
        'my-browser': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--isolated'], env: {} },
    } };
    const prepare = (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(old, null, 2) + '\n');
    const inspect = (repo) => ({ pw: launch(repo), mine: servers(repo)['my-browser'] });
    const { result } = seedRun('update', SELECTION, { env: COPY_ROUTE, tools: REGISTRY, prepare, inspect });
    assert.deepStrictEqual(result.pw, ['-y', PW]);
    assert.deepStrictEqual(result.mine, old.mcpServers['my-browser'], "the user's own server was touched");
});
