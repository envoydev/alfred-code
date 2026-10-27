'use strict';
// The tools inventory: every MCP server this project reaches - the registrations at each scope, the enabled plugins'
// servers, and the session's own listing for what cannot be listed - each known type at its pin read from the adapter
// table and never started, every other one listed once with its tools' hints. Env and header values never leave it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOOLS = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js');
const tools = require(TOOLS);
const mcp = require('./install/mcp.js');

const adapters = tools.readAdapters();
const NAV = 'mcp__plugin_alfred-navigation_alfred-navigation__'; // mcp-fixture

function sandbox()
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-inv-')));
    const root = path.join(work, 'repo');
    const config = path.join(work, 'config');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.mkdirSync(config);
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' };
    const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    return {
        work, root, config, env, write,
        mcpJson: (servers) => write(path.join(root, '.mcp.json'), { mcpServers: servers }),
        account: (value) => write(path.join(config, '.claude.json'), value),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
}
const noPlugins = async () => ({ ok: true, out: '[]' });
const spyList = (answer) =>
{
    const calls = [];
    const list = async (def, opts) => { calls.push({ def, opts }); return typeof answer === 'function' ? answer(def) : answer; };
    return { calls, list };
};
const take = (s, extra = {}) => tools.takeInventory({ projectRoot: s.root, env: s.env, adapters, listPlugins: noPlugins, now: () => '2026-10-24T10:00:00Z', ...extra });

test('registrations matches install/mcp.js on every account-file shape', () =>
{
    const s = sandbox();
    try
    {
        const accountFile = path.join(s.config, '.claude.json');
        const mcpFile = path.join(s.root, '.mcp.json');
        const valid = JSON.stringify({ firstStartTime: '2026-01-01', mcpServers: { u: { command: 'u' } }, projects: { [s.root]: { mcpServers: { l: { command: 'l' } } } } });
        for (const body of [valid, `\uFEFF${valid}`, '[]', '', 'garbage{', '7', null])
        {
            if (body === null) fs.rmSync(accountFile, { force: true }); else fs.writeFileSync(accountFile, body);
            const ours = tools.registrations({ projectRoot: s.root, accountFile });
            for (const scope of ['user', 'local'])
            {
                const theirs = mcp.registrationsAt({ scope, mcpFile, accountFile, projectRoot: s.root });
                assert.deepStrictEqual({ state: ours[scope].state, servers: ours[scope].servers }, { state: theirs.state, servers: theirs.servers }, `${scope} over ${JSON.stringify(body)}`);
            }
        }
        for (const body of ['{"mcpServers":{"p":{"command":"p"}}}', '', 'garbage{', '[]', null])
        {
            if (body === null) fs.rmSync(mcpFile, { force: true }); else fs.writeFileSync(mcpFile, body);
            const ours = tools.registrations({ projectRoot: s.root, accountFile }).project;
            const theirs = mcp.registrationsAt({ scope: 'project', mcpFile, accountFile, projectRoot: s.root });
            assert.deepStrictEqual({ state: ours.state, servers: ours.servers }, { state: theirs.state, servers: theirs.servers }, `project over ${JSON.stringify(body)}`);
        }
    }
    finally { s.done(); }
});

test('local scope finds the project by its real path', () =>
{
    const s = sandbox();
    try
    {
        const link = path.join(s.work, 'link');
        fs.symlinkSync(s.root, link);
        s.account({ projects: { [s.root]: { mcpServers: { l: { command: 'l' } } } } });
        assert.deepStrictEqual(tools.registrations({ projectRoot: link, accountFile: path.join(s.config, '.claude.json') }).local.servers, { l: { command: 'l' } });
    }
    finally { s.done(); }
});

test('classify', () =>
{
    assert.deepStrictEqual(tools.classify({}, { plugin: 'alfred-navigation', adapters }), { type: 'serena', version: '2.1.0', atPin: true });
    assert.deepStrictEqual(tools.classify({ command: 'uvx', args: ['--from', 'serena-agent==2.1.0', 'serena', 'start-mcp-server'] }, { adapters }), { type: 'serena', version: '2.1.0', atPin: true });
    assert.strictEqual(tools.classify({ command: 'uvx', args: ['--from', 'serena-agent@1.0.0', 'serena'] }, { adapters }).atPin, false);
    assert.deepStrictEqual(tools.classify({ type: 'http', url: 'https://mcp.context7.com/mcp' }, { adapters }), { type: 'context7', version: null, atPin: true });
    assert.deepStrictEqual(tools.classify({ command: 'npx', args: ['-y', '@upstash/context7-mcp@2.0.0'] }, { adapters }), { type: 'context7', version: '2.0.0', atPin: false });
    assert.deepStrictEqual(tools.classify({ command: 'npx', args: ['-y', '@upstash/context7-mcp'] }, { adapters }), { type: 'context7', version: null, atPin: false });
    assert.deepStrictEqual(tools.classify({ command: 'node', args: ['memory-launch.js', '--package', 'mcp-memory-service[sqlite]==12.1.1'] }, { adapters }), { type: 'memory-service', version: '12.1.1', atPin: true });
    assert.deepStrictEqual(tools.classify({ command: 'node', args: ['browser-launch.js', '--package', '@playwright/mcp@0.0.83'] }, { adapters }).type, 'playwright');
    assert.strictEqual(tools.classify({ command: 'docker', args: ['run', 'jetbrains/mcp'] }, { adapters }).type, null);
    assert.strictEqual(tools.classify({ type: 'http', url: 'not a url' }, { adapters }).type, null);
});

test('prefixOf spells the names Claude Code gives a server\'s tools', () =>
{
    assert.strictEqual(tools.prefixOf('jetbrains', null), 'mcp__jetbrains__');
    assert.strictEqual(tools.prefixOf('my server.v2', null), 'mcp__my_server_v2__');
    assert.strictEqual(tools.prefixOf('alfred-navigation', 'alfred-navigation'), NAV);
});

test('a known type at its pin is read from the table and never started', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ 'alfred-navigation': { command: 'node', args: ['serena-launch.js', '--package', 'serena-agent@2.1.0'] } });
        const spy = spyList({ ok: false, why: 'must not run' });
        const { inventory, lines } = await take(s, { list: spy.list });
        assert.strictEqual(spy.calls.length, 0);
        const entry = inventory.servers['mcp__alfred-navigation__']; // mcp-fixture
        assert.strictEqual(entry.listed, 'table');
        assert.strictEqual(entry.type, 'serena');
        assert.strictEqual(entry.scope, 'project');
        assert.deepStrictEqual(Object.keys(entry.tools).sort(), adapters.types.serena.tools);
        assert.strictEqual(entry.tools.rename_symbol.destructive, true, 'an edit tool is marked');
        assert.ok(lines.includes(`tools: mcp__alfred-navigation__ - serena 2.1.0 - ${adapters.types.serena.tools.length} tools (table)`), lines.join('\n')); // mcp-fixture
        assert.strictEqual(inventory.version, 1);
        assert.strictEqual(inventory.captured, '2026-10-24');
    }
    finally { s.done(); }
});

test('an unknown server is listed and recorded with its hints', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ jetbrains: { command: 'node', args: ['idea.js'] } });
        const spy = spyList({ ok: true, tools: [{ name: 'find_usages', readOnly: true, destructive: null, target: 'symbolName' }] });
        const { inventory, lines } = await take(s, { list: spy.list });
        assert.strictEqual(spy.calls.length, 1);
        assert.deepStrictEqual(spy.calls[0].def, { command: 'node', args: ['idea.js'] });
        assert.strictEqual(spy.calls[0].opts.timeoutMs, 30000);
        const entry = inventory.servers.mcp__jetbrains__;
        assert.deepStrictEqual(entry.tools, { find_usages: { readOnly: true, destructive: null, target: 'symbolName' } });
        assert.strictEqual(entry.type, 'own:jetbrains');
        assert.strictEqual(entry.listed, 'exchange');
        assert.strictEqual(entry.registration, tools.registrationHash({ command: 'node', args: ['idea.js'] }));
        assert.ok(lines.includes('tools: mcp__jetbrains__ - own:jetbrains - 1 tools (exchange)'), lines.join('\n'));
    }
    finally { s.done(); }
});

test('a label given, or kept from the last inventory, names an own server', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ idea: { command: 'node' } });
        const spy = spyList({ ok: true, tools: [{ name: 'find_usages', readOnly: true, destructive: null, target: null }] });
        let { inventory } = await take(s, { list: spy.list, labels: { mcp__idea__: 'own:jetbrains' } });
        assert.strictEqual(inventory.servers.mcp__idea__.type, 'own:jetbrains');
        ({ inventory } = await take(s, { list: spy.list, previous: inventory }));
        assert.strictEqual(inventory.servers.mcp__idea__.type, 'own:jetbrains');
    }
    finally { s.done(); }
});

test('a failed list falls back to the session names, else is recorded failed', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ jira: { type: 'http', url: 'https://jira.example/mcp' }, slack: { command: 'slack-mcp' } });
        const spy = spyList({ ok: false, why: 'timed out at 30s' });
        const { inventory, lines } = await take(s, { list: spy.list, sessionTools: ['mcp__jira__search', 'mcp__jira__get_issue'] });
        assert.strictEqual(inventory.servers.mcp__jira__.listed, 'session');
        assert.deepStrictEqual(Object.keys(inventory.servers.mcp__jira__.tools), ['get_issue', 'search']);
        assert.strictEqual(inventory.servers.mcp__slack__.listed, 'failed');
        assert.strictEqual(inventory.servers.mcp__slack__.why, 'timed out at 30s');
        assert.deepStrictEqual(inventory.servers.mcp__slack__.tools, {});
        assert.ok(lines.includes('tools: mcp__slack__ - own:slack - 0 tools (failed: timed out at 30s)'), lines.join('\n'));
    }
    finally { s.done(); }
});

test('servers only the session lists are recorded from its names', async () =>
{
    const s = sandbox();
    try
    {
        const { inventory } = await take(s, { list: spyList({ ok: false, why: 'x' }).list, sessionTools: ['mcp__claude_ai_Claude_Docs__batch', 'mcp__claude_ai_Claude_Docs__guide', 'Read', ''] });
        const entry = inventory.servers.mcp__claude_ai_Claude_Docs__;
        assert.strictEqual(entry.scope, 'session');
        assert.strictEqual(entry.type, 'own:claude_ai_claude_docs');
        assert.deepStrictEqual(Object.keys(entry.tools), ['batch', 'guide']);
        assert.strictEqual(Object.keys(inventory.servers).length, 1);
    }
    finally { s.done(); }
});

test('env and header values never reach the output', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ secret: { command: 'node', args: ['s.js'], env: { TOKEN: 'hunter2' } }, web: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer hunter2' } } });
        const spy = spyList({ ok: true, tools: [{ name: 'go', readOnly: null, destructive: null, target: null }] });
        const { inventory, lines } = await take(s, { list: spy.list });
        assert.ok(!JSON.stringify(inventory).includes('hunter2'));
        assert.ok(!lines.join('\n').includes('hunter2'));
        assert.strictEqual(tools.registrationHash({ command: 'node', args: ['s.js'], env: { TOKEN: 'hunter2' } }), tools.registrationHash({ command: 'node', args: ['s.js'], env: { TOKEN: 'other' } }));
        assert.notStrictEqual(tools.registrationHash({ command: 'node', args: ['s.js'] }), tools.registrationHash({ command: 'node', args: ['t.js'] }));
    }
    finally { s.done(); }
});

test('a name at several scopes is taken where Claude Code takes it: local, then project, then user', async () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ jira: { command: 'p' } });
        s.account({ mcpServers: { jira: { command: 'u' } }, projects: { [s.root]: { mcpServers: { jira: { command: 'l' } } } } });
        const spy = spyList({ ok: true, tools: [] });
        let { inventory } = await take(s, { list: spy.list });
        assert.deepStrictEqual(spy.calls.map((c) => c.def.command), ['l']);
        assert.strictEqual(inventory.servers.mcp__jira__.scope, 'local');
        s.account({ mcpServers: { jira: { command: 'u' } } });
        ({ inventory } = await take(s, { list: spy.list }));
        assert.strictEqual(inventory.servers.mcp__jira__.scope, 'project');
        fs.rmSync(path.join(s.root, '.mcp.json'));
        ({ inventory } = await take(s, { list: spy.list }));
        assert.strictEqual(inventory.servers.mcp__jira__.scope, 'user');
    }
    finally { s.done(); }
});

test('enabled plugin servers are listed with the plugin prefix and CLAUDE_PLUGIN_ROOT', async () =>
{
    const s = sandbox();
    try
    {
        const jb = path.join(s.work, 'plugins', 'jb');
        const files = path.join(s.work, 'plugins', 'files');
        s.write(path.join(files, '.mcp.json'), { mcpServers: { db: { command: 'db-mcp' } } });
        const rows = [
            { id: 'jb@market', enabled: true, scope: 'user', installPath: jb, mcpServers: { idea: { command: '${CLAUDE_PLUGIN_ROOT}/run' } } },
            { id: 'files@market', enabled: true, scope: 'user', installPath: files, mcpServers: { db: {} } },
            { id: 'off@market', enabled: false, scope: 'user', installPath: jb, mcpServers: { x: { command: 'x' } } },
            { id: 'alfred-navigation@envoydev', enabled: true, scope: 'project', projectPath: s.root, installPath: jb, mcpServers: { 'alfred-navigation': { command: 'node' } } },
            { id: 'elsewhere@market', enabled: true, scope: 'project', projectPath: path.join(s.work, 'other'), installPath: jb, mcpServers: { y: { command: 'y' } } },
        ];
        const spy = spyList({ ok: true, tools: [{ name: 'q', readOnly: true, destructive: null, target: null }] });
        const { inventory } = await take(s, { list: spy.list, listPlugins: async () => ({ ok: true, out: JSON.stringify(rows) }) });
        assert.deepStrictEqual(Object.keys(inventory.servers).sort(), [NAV, 'mcp__plugin_files_db__', 'mcp__plugin_jb_idea__']); // mcp-fixture
        assert.strictEqual(inventory.servers[NAV].listed, 'table');
        assert.strictEqual(inventory.servers.mcp__plugin_jb_idea__.plugin, 'jb'); // mcp-fixture
        const idea = spy.calls.find((c) => c.def.command === '${CLAUDE_PLUGIN_ROOT}/run');
        assert.strictEqual(idea.opts.pluginRoot, jb);
        assert.ok(spy.calls.some((c) => c.def.command === 'db-mcp'), 'a def the listing leaves out is read from the plugin\'s .mcp.json');
    }
    finally { s.done(); }
});

test('no CLI answer: the stack plugins come from enabledPlugins', async () =>
{
    const s = sandbox();
    try
    {
        s.write(path.join(s.root, '.claude', 'settings.json'), { enabledPlugins: { 'alfred-navigation@envoydev': true, 'alfred-memory@envoydev': false } });
        const { inventory, lines } = await take(s, { list: spyList({ ok: false, why: 'x' }).list, listPlugins: async () => ({ ok: false }) });
        assert.deepStrictEqual(Object.keys(inventory.servers), [NAV]);
        assert.strictEqual(inventory.servers[NAV].listed, 'table');
        assert.ok(lines.includes('tools: the claude CLI did not answer - plugin servers taken from the settings\' enabledPlugins'));
    }
    finally { s.done(); }
});

test('the CLI writes the inventory under the data root it reads', { skip: process.platform === 'win32' && 'a sh stub stands in for claude' }, () =>
{
    const s = sandbox();
    try
    {
        const bin = path.join(s.work, 'bin');
        s.write(path.join(bin, 'claude'), '#!/bin/sh\necho "[]"\n');
        fs.chmodSync(path.join(bin, 'claude'), 0o755);
        s.write(path.join(s.root, '.claude', 'settings.json'), { env: { ALFRED_CODE_DATA_PATH: 'data' } });
        s.write(path.join(s.work, 'session.txt'), 'mcp__claude_ai_Claude_Docs__batch\nmcp__claude_ai_Claude_Docs__guide\n');
        const r = spawnSync(process.execPath, [TOOLS, 'inventory', '--project', s.root, '--session-tools', path.join(s.work, 'session.txt')],
            { encoding: 'utf8', env: { ...s.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        const file = path.join(s.root, 'data', 'state', 'tools-inventory.json');
        const inv = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(inv.version, 1);
        assert.ok(inv.servers.mcp__claude_ai_Claude_Docs__);
        assert.match(r.stdout, /tools: inventory written - data\/state\/tools-inventory\.json/);
        assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['tools-inventory.json'], 'no temp file is left');
    }
    finally { s.done(); }
});

test('a garbage inventory reads as garbage, an absent one as null', () =>
{
    const s = sandbox();
    try
    {
        assert.strictEqual(tools.readInventory(s.root), null);
        s.write(tools.inventoryPath(s.root), 'garbage{');
        assert.strictEqual(tools.readInventory(s.root), 'garbage');
        s.write(tools.inventoryPath(s.root), '[]');
        assert.strictEqual(tools.readInventory(s.root), 'garbage');
        tools.writeInventory(s.root, { version: 1, captured: '2026-10-24', servers: {} });
        assert.deepStrictEqual(tools.readInventory(s.root), { version: 1, captured: '2026-10-24', servers: {} });
    }
    finally { s.done(); }
});
