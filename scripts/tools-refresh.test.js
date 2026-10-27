'use strict';
// The inventory's refresh on update: each recorded server whose registration changed is listed again (in parallel,
// each capped), a known type at its pin is re-read from the table and never started, an unchanged one is never started,
// a gone one leaves, and a ranked tool the new listing lacks is named. Nothing is written when nothing changed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOOLS = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js');
const tools = require(TOOLS);

delete process.env.ALFRED_CODE_DATA_PATH;
delete process.env.ALFRED_CODE_DOCS_PATH;

const adapters = tools.readAdapters();
const NAV = 'mcp__plugin_alfred-navigation_alfred-navigation__'; // mcp-fixture
const JIRA = { command: 'npx', args: ['-y', 'jira-mcp@1.0.0'] };
const jiraTools = (names) => ({ ok: true, tools: names.map((name) => ({ name, readOnly: true, destructive: null, target: 'query' })) });
const TWELVE = Array.from({ length: 12 }, (_, i) => (i === 0 ? 'search' : `tool_${i}`));

function sandbox()
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-refresh-')));
    const root = path.join(work, 'repo');
    const config = path.join(work, 'config');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.mkdirSync(config);
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
    const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    const inventoryFile = path.join(root, '.alfred', 'state', 'tools-inventory.json');
    return {
        work, root, config, env, write, inventoryFile,
        mcpJson: (servers) => write(path.join(root, '.mcp.json'), { mcpServers: servers }),
        bytes: () => fs.readFileSync(inventoryFile, 'utf8'),
        inventory: () => JSON.parse(fs.readFileSync(inventoryFile, 'utf8')),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
}
const spy = (answer) =>
{
    const calls = [];
    return { calls, list: async (def, opts) => { calls.push({ def, opts }); return typeof answer === 'function' ? answer(def) : answer; } };
};
const noPlugins = async () => ({ ok: true, out: '[]' });
// The capture once: the project's jira registration listed with twelve tools.
async function captured(s)
{
    s.mcpJson({ jira: JIRA });
    const { inventory } = await tools.takeInventory({ projectRoot: s.root, env: s.env, adapters, listPlugins: noPlugins, list: spy(jiraTools(TWELVE)).list, now: () => '2026-10-24' });
    tools.writeInventory(s.root, inventory);
}
const refresh = (s, extra = {}) => tools.refreshInventory({ projectRoot: s.root, env: s.env, adapters, listPlugins: noPlugins, ...extra });

test('no inventory: nothing runs', async () =>
{
    const s = sandbox();
    try
    {
        const l = spy(jiraTools(TWELVE));
        s.mcpJson({ jira: JIRA });
        assert.deepStrictEqual(await refresh(s, { list: l.list }), { state: 'none', lines: [] });
        assert.strictEqual(l.calls.length, 0);
        assert.ok(!fs.existsSync(s.inventoryFile));
    }
    finally { s.done(); }
});

test('an unchanged registration is not started', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        const before = s.bytes();
        const l = spy(jiraTools(['other']));
        assert.deepStrictEqual(await refresh(s, { list: l.list }), { state: 'unchanged', lines: [] });
        assert.strictEqual(l.calls.length, 0);
        assert.strictEqual(s.bytes(), before);
    }
    finally { s.done(); }
});

test('a changed registration is re-listed and replaced', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        const next = { ...JIRA, args: ['-y', 'jira-mcp@2.0.0'] };
        s.mcpJson({ jira: next });
        const l = spy(jiraTools(TWELVE));
        const r = await refresh(s, { list: l.list });
        assert.strictEqual(r.state, 'refreshed');
        assert.deepStrictEqual(r.lines, ['tools: mcp__jira__ re-listed - 12 tools']); // mcp-fixture
        assert.strictEqual(l.calls.length, 1);
        assert.strictEqual(l.calls[0].opts.timeoutMs, 30000);
        const entry = s.inventory().servers.mcp__jira__;
        assert.strictEqual(entry.registration, tools.registrationHash(next));
        assert.strictEqual(entry.type, 'own:jira', 'the own label is kept');
        assert.strictEqual(entry.listed, 'exchange');
    }
    finally { s.done(); }
});

test('a server that cannot be re-listed keeps its entry', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        const before = s.bytes();
        s.mcpJson({ jira: { ...JIRA, args: ['-y', 'jira-mcp@2.0.0'] } });
        const r = await refresh(s, { list: spy({ ok: false, why: 'timed out at 30s' }).list });
        assert.deepStrictEqual(r, { state: 'unchanged', lines: ['!! tools: mcp__jira__ could not be re-listed (timed out at 30s) - its recorded tools stand'] }); // mcp-fixture
        assert.strictEqual(s.bytes(), before, 'the old registration stays, so the next update tries again');
    }
    finally { s.done(); }
});

test('a registration that is gone leaves the inventory', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        s.mcpJson({});
        const r = await refresh(s, { list: spy(jiraTools(TWELVE)).list });
        assert.deepStrictEqual(r, { state: 'refreshed', lines: ['tools: mcp__jira__ is no longer registered - dropped from the inventory'] }); // mcp-fixture
        assert.deepStrictEqual(s.inventory().servers, {});
    }
    finally { s.done(); }
});

test('a ranked tool that is gone is named', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        s.write(path.join(s.root, '.alfred', 'docs', 'preferences', 'TOOLS-PREFERENCES.md'),
            '# Tools preferences\n\nUpdated: 2026-10-24\n\n## T1 - Tickets\n<!-- id: t1 -->\n- Job: tickets\n- Order: own:jira search, tool_1\n');
        s.mcpJson({ jira: { ...JIRA, args: ['-y', 'jira-mcp@2.0.0'] } });
        const r = await refresh(s, { list: spy(jiraTools(['tool_1', 'tool_2'])).list });
        assert.deepStrictEqual(r.lines, ['tools: mcp__jira__ re-listed - 2 tools', // mcp-fixture
            '!! tools: own:jira search is gone from mcp__jira__ - its rank is skipped until /capture-preferences tools runs again']); // mcp-fixture
    }
    finally { s.done(); }
});

test('a re-run changes nothing', async () =>
{
    const s = sandbox();
    try
    {
        await captured(s);
        s.mcpJson({ jira: { ...JIRA, args: ['-y', 'jira-mcp@2.0.0'] } });
        assert.strictEqual((await refresh(s, { list: spy(jiraTools(TWELVE)).list })).state, 'refreshed');
        const before = s.bytes();
        const l = spy(jiraTools(TWELVE));
        assert.deepStrictEqual(await refresh(s, { list: l.list }), { state: 'unchanged', lines: [] });
        assert.strictEqual(l.calls.length, 0);
        assert.strictEqual(s.bytes(), before);
    }
    finally { s.done(); }
});

test('a known type is re-read from the table, never started', async () =>
{
    const s = sandbox();
    try
    {
        // a table entry recorded by an older stack (one tool its pin has since dropped) and a project registration moved onto
        // the pinned package
        s.mcpJson({ docs: { type: 'http', url: 'https://mcp.context7.com/mcp' } });
        tools.writeInventory(s.root, { version: 1, captured: '2026-10-01', servers: {
            [NAV]: { name: 'alfred-navigation', prefix: NAV, scope: 'plugin', plugin: 'alfred-navigation', type: 'serena', version: '1.9.0', registration: 'x', listed: 'table', tools: { old_tool: { readOnly: null, destructive: null, target: null } } },
            mcp__docs__: { name: 'docs', prefix: 'mcp__docs__', scope: 'project', type: 'own:docs', version: null, registration: tools.registrationHash({ command: 'old-docs' }), listed: 'exchange', tools: { lookup: { readOnly: true, destructive: null, target: null } } }, // mcp-fixture
        } });
        const l = spy(jiraTools(['nope']));
        const r = await refresh(s, { list: l.list });
        assert.strictEqual(l.calls.length, 0, 'nothing started');
        assert.strictEqual(r.state, 'refreshed');
        const inv = s.inventory().servers;
        assert.deepStrictEqual(Object.keys(inv[NAV].tools).sort(), adapters.types.serena.tools);
        assert.strictEqual(inv[NAV].version, '2.1.0');
        assert.strictEqual(inv.mcp__docs__.type, 'context7', 'the registration is a known type now'); // mcp-fixture
        assert.strictEqual(inv.mcp__docs__.listed, 'table'); // mcp-fixture
        assert.deepStrictEqual(r.lines, [`tools: ${NAV} re-read from the table - ${adapters.types.serena.tools.length} tools`, 'tools: mcp__docs__ re-read from the table - 2 tools']); // mcp-fixture
    }
    finally { s.done(); }
});

test('an account file it cannot read keeps every user and local entry', async () =>
{
    const s = sandbox();
    try
    {
        tools.writeInventory(s.root, { version: 1, captured: '2026-10-01', servers: {
            mcp__mine__: { name: 'mine', prefix: 'mcp__mine__', scope: 'user', type: 'own:mine', version: null, registration: 'x', listed: 'exchange', tools: {} }, // mcp-fixture
        } });
        s.write(path.join(s.config, '.claude.json'), 'garbage{');
        const before = s.bytes();
        const l = spy(jiraTools(['a']));
        assert.deepStrictEqual(await refresh(s, { list: l.list }), { state: 'unchanged', lines: [] });
        assert.strictEqual(l.calls.length, 0);
        assert.strictEqual(s.bytes(), before);
    }
    finally { s.done(); }
});

test('the refresh command prints its lines', () =>
{
    const s = sandbox();
    try
    {
        tools.writeInventory(s.root, { version: 1, captured: '2026-10-01', servers: {
            mcp__gone__: { name: 'gone', prefix: 'mcp__gone__', scope: 'project', type: 'own:gone', version: null, registration: 'x', listed: 'exchange', tools: {} }, // mcp-fixture
        } });
        const r = spawnSync(process.execPath, [TOOLS, 'refresh', '--project', s.root], { encoding: 'utf8', env: { ...s.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout, 'tools: mcp__gone__ is no longer registered - dropped from the inventory\n'); // mcp-fixture
    }
    finally { s.done(); }
});

// The plugin listing is a CLI start of up to 45 s: read once per refresh, however many plugin entries need it.
test('the plugin listing is read once for every plugin entry', async () =>
{
    const s = sandbox();
    try
    {
        const entry = (n) => ({ name: n, prefix: `mcp__plugin_${n}_${n}__`, scope: 'plugin', plugin: n, type: `own:${n}`, version: null, registration: 'x', listed: 'exchange', tools: {} });
        tools.writeInventory(s.root, { version: 1, captured: '2026-10-01', servers: Object.fromEntries(['a', 'b', 'c'].map((n) => [`mcp__plugin_${n}_${n}__`, entry(n)])) });
        let calls = 0;
        const listPlugins = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { ok: false }; };
        assert.deepStrictEqual(await tools.refreshInventory({ projectRoot: s.root, env: s.env, adapters, listPlugins, list: spy(jiraTools(['x'])).list }), { state: 'unchanged', lines: [] });
        assert.strictEqual(calls, 1);
    }
    finally { s.done(); }
});
