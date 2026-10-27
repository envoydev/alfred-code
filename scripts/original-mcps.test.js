'use strict';
// The stack stopped shipping MCP servers on 2026-10-24 (the user's ruling). stack/mcp/original-mcps.json is each one's
// paste-ready .mcp.json entry under its original name; stack/mcp/shipped-mcps.json is the record of how it shipped.
// Nothing in the stack loads either file: update names original-mcps.json as the way back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'stack', 'mcp');
const original = JSON.parse(fs.readFileSync(path.join(DIR, 'original-mcps.json'), 'utf8'));
const shipped = JSON.parse(fs.readFileSync(path.join(DIR, 'shipped-mcps.json'), 'utf8'));
const pinOf = (name) => shipped.pins[name];

test('original-mcps.json is an .mcp.json holding every shipped server under its original name', () =>
{
    assert.deepStrictEqual(Object.keys(original), ['mcpServers']);
    const names = [...new Set(Object.values(shipped.original))].sort();
    assert.deepStrictEqual(Object.keys(original.mcpServers).sort(), names);
    for (const name of ['serena', 'context7', 'memory', 'playwright-chrome', 'playwright-msedge', 'playwright-firefox', 'playwright-webkit', 'windows-desktop', 'macos-desktop', 'appium-mcp'])
        assert.ok(original.mcpServers[name], name);
});

test('each paste-ready entry launches its pinned package with the stack\'s cut-off', () =>
{
    const s = original.mcpServers;
    const cut = `${shipped.pins.refreshed}T23:59:59Z`;
    const uv = (entry, spec) => { assert.strictEqual(entry.command, 'uvx'); assert.ok(entry.args.includes(spec), spec); assert.strictEqual(entry.args[entry.args.indexOf('--exclude-newer') + 1], cut); };
    uv(s.serena, `serena-agent@${pinOf('alfred-navigation').version}`);
    uv(s.memory, `mcp-memory-service[sqlite]==${pinOf('alfred-memory').version}`);
    uv(s['windows-desktop'], `windows-mcp==${pinOf('windows-control').version}`);
    uv(s['macos-desktop'], `macos-mcp==${pinOf('macos-control').version}`);
    assert.strictEqual(s['windows-desktop'].args[s['windows-desktop'].args.indexOf('--python') + 1], '3.14');
    assert.deepStrictEqual(s['windows-desktop'].args.slice(-2), ['--exclude-tools', 'PowerShell,Registry,Process,FileSystem']);
    for (const e of ['chrome', 'msedge', 'firefox', 'webkit'])
    {
        const a = s[`playwright-${e}`].args;
        assert.ok(a.includes(`@playwright/mcp@${pinOf('browser').version}`) && a.includes('--no-webmcp'), e);
        assert.strictEqual(a[a.indexOf('--browser') + 1], e);
    }
    assert.deepStrictEqual(s['appium-mcp'].args, ['-y', `appium-mcp@${pinOf('mobile-control').version}`]);
    assert.strictEqual(s['appium-mcp'].env.ALLOW_REMOTE_APP_URLS, 'false');
    assert.strictEqual(s.context7.url, 'https://mcp.context7.com/mcp');
    assert.strictEqual(s.memory.env.MCP_MEMORY_SQLITE_PATH, '${HOME}/.alfred-memory/memory.db', 'the global database every earlier install used');
});

test('a paste-ready entry needs no stack file, no install token and no machine path', () =>
{
    const text = JSON.stringify(original);
    assert.ok(!/CLAUDE_PLUGIN_ROOT|@[A-Z_]+@|-launch\.js|navigation-context/.test(text), text.match(/CLAUDE_PLUGIN_ROOT|@[A-Z_]+@|-launch\.js|navigation-context/));
    assert.ok(!/"(\/|[A-Za-z]:\\\\)(Users|home|private)/.test(text));
});

test('the record keeps the plugin-route entries, the copy-route arguments and the navigation context', () =>
{
    for (const name of ['alfred-navigation', 'alfred-documentation', 'alfred-memory', 'chrome-control', 'windows-control', 'macos-control', 'mobile-control'])
        assert.ok(shipped.plugin[name] && shipped.plugin[name].entry, name);
    assert.ok(shipped.plugin['alfred-navigation'].entry.args[0].endsWith('serena-launch.js'));
    for (const name of ['alfred-navigation', 'browser', 'alfred-memory', 'alfred-documentation', 'windows-control', 'macos-control', 'mobile-control'])
        assert.ok(shipped.copy[name] && typeof shipped.copy[name].args === 'string', name);
    assert.match(shipped.navigationContext, /excluded_tools:/);
    assert.ok(shipped.navigationContext.includes('write_memory'));
});
