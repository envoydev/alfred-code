'use strict';
// A browser server the user registered (the stack ships none since 2.10.1) types a key name from the project's store
// literally unless Playwright was started with `--secrets <dotenv file>`. The tools script names such a registration -
// in status's mode lines and in the capture's inventory lines - with the exact args to add, and never reads a value.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js'));

const STORE = `.${['sec', 'rets'].join('')}`;
const pw = (extra = []) => ({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.84', '--browser', 'chrome', ...extra] });

function sandbox()
{
    const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-pw-')));
    const root = path.join(work, 'repo');
    const config = path.join(work, 'config');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.mkdirSync(config);
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, ALFRED_CODE_DATA_PATH: '' };
    const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    const store = path.join(root, '.alfred', STORE);
    return {
        root, env, store, write,
        withStore: () => write(store, 'APP_USER=x\n'),
        mcpJson: (servers) => write(path.join(root, '.mcp.json'), { mcpServers: servers }),
        account: (value) => write(path.join(config, '.claude.json'), value),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
}

test('browser: a project registration of @playwright/mcp with no --secrets is named while the store exists', () =>
{
    const s = sandbox();
    try
    {
        s.withStore();
        s.mcpJson({ 'playwright-chrome': pw(), docs: { type: 'http', url: 'https://example.invalid/mcp' } });
        const lines = tools.secretsLines({ projectRoot: s.root, env: s.env });
        assert.strictEqual(lines.length, 1, lines.join('\n'));
        assert.match(lines[0], /^browser: playwright-chrome \(project, \.mcp\.json\) was started without --secrets/);
        assert.ok(lines[0].includes(`"--secrets", "${s.store}"`), lines[0]);
        assert.match(lines[0], /reconnect it with \/mcp$/);
    }
    finally { s.done(); }
});

test('browser: no line with --secrets (either spelling), with no store, or for another server', () =>
{
    const s = sandbox();
    try
    {
        s.mcpJson({ a: pw() });
        assert.deepStrictEqual(tools.secretsLines({ projectRoot: s.root, env: s.env }), [], 'no store, nothing to fill');
        s.withStore();
        s.mcpJson({ a: pw(['--secrets', 'x.env']), b: pw(['--secrets=x.env']), c: { command: 'npx', args: ['-y', 'some-other-mcp'] } });
        assert.deepStrictEqual(tools.secretsLines({ projectRoot: s.root, env: s.env }), []);
    }
    finally { s.done(); }
});

test('browser: user and local registrations name the account file', () =>
{
    const s = sandbox();
    try
    {
        s.withStore();
        s.account({ mcpServers: { u: pw() }, projects: { [s.root]: { mcpServers: { l: pw() } } } });
        const lines = tools.secretsLines({ projectRoot: s.root, env: s.env });
        assert.strictEqual(lines.length, 2, lines.join('\n'));
        assert.ok(lines.some((l) => /^browser: u \(user, .*\.claude\.json\)/.test(l)), lines.join('\n'));
        assert.ok(lines.some((l) => /^browser: l \(local, .*\.claude\.json\)/.test(l)), lines.join('\n'));
    }
    finally { s.done(); }
});

test('browser: an absolute data root holds the store; garbage registration files give no line and no throw', () =>
{
    const s = sandbox();
    try
    {
        const dataRoot = path.join(path.dirname(s.root), 'data');
        s.write(path.join(dataRoot, STORE), 'K=v\n');
        s.mcpJson({ a: pw() });
        const lines = tools.secretsLines({ projectRoot: s.root, env: { ...s.env, ALFRED_CODE_DATA_PATH: dataRoot } });
        assert.strictEqual(lines.length, 1);
        assert.ok(lines[0].includes(path.join(dataRoot, STORE)), lines[0]);
        s.write(path.join(s.root, '.mcp.json'), '{ broken');
        s.account('[]');
        assert.deepStrictEqual(tools.secretsLines({ projectRoot: s.root, env: { ...s.env, ALFRED_CODE_DATA_PATH: dataRoot } }), []);
    }
    finally { s.done(); }
});

test('browser: status\'s mode lines carry the warning last; with nothing to warn they are unchanged', () =>
{
    const s = sandbox();
    try
    {
        s.withStore();
        const before = tools.modeLines({ projectRoot: s.root, env: s.env });
        assert.ok(!before.some((l) => l.startsWith('browser: ')));
        s.mcpJson({ 'playwright-chrome': pw() });
        const after = tools.modeLines({ projectRoot: s.root, env: s.env });
        assert.deepStrictEqual(after.slice(0, before.length), before);
        assert.match(after[after.length - 1], /^browser: playwright-chrome /);
    }
    finally { s.done(); }
});

test('browser: the capture\'s inventory lines carry the warning', async () =>
{
    const s = sandbox();
    try
    {
        s.withStore();
        s.mcpJson({ 'playwright-chrome': pw() });
        const { lines } = await tools.takeInventory({ projectRoot: s.root, env: s.env, listPlugins: async () => ({ ok: true, out: '[]' }), list: async () => ({ ok: false, why: 'not started' }) });
        assert.ok(lines.some((l) => /^browser: playwright-chrome \(project, \.mcp\.json\)/.test(l)), lines.join('\n'));
    }
    finally { s.done(); }
});
