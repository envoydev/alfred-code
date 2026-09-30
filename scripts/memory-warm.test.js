'use strict';
// THE MEMORY MODEL PRE-WARM (live check F2, 2026-09-29). The memory service downloads its embedding model
// (~166MB of ONNX files into ~/.cache/mcp_memory) on its FIRST start: 33s cold against Claude Code's 30s MCP
// connect budget, and a server that misses it is cached as failed, so the next session does not start it at
// all. `memory.js warm` fetches the model once, outside any session: the service the project runs, started
// against a SCRATCH database (never the user's), one search to load the model, then shut down - bounded.
// The installer runs it on a machine that has uvx; init's plan lists it for the machine that does not yet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const ENGINE = path.join(__dirname, '..', 'stack', 'hooks', 'memory.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-warm-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const MARKER = ['.cache', 'mcp_memory', 'onnx_models', 'all-MiniLM-L6-v2', 'onnx', 'model.onnx'];

// A stand-in for the memory service: JSON-RPC over stdio, the model 'downloaded' (the marker written under
// HOME) when a search needs an embedding. `mode` 'silent' never answers; the database path it was handed is
// recorded, so a test can prove the user's own database was never opened.
function fakeService(name, mode = 'ok')
{
    const file = path.join(TMP, `${name}-service.js`);
    const record = path.join(TMP, `${name}-record.json`);
    fs.writeFileSync(file, `
const fs = require('fs'); const path = require('path');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ db: process.env.MCP_MEMORY_SQLITE_PATH || null }));
if (${JSON.stringify(mode)} === 'silent') { setInterval(() => {}, 1000); return; }
let buf = '';
process.stdin.on('data', (c) => {
  buf += c; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    let result = {};
    if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } };
    if (msg.method === 'tools/call') {
      const marker = path.join(process.env.HOME, ${JSON.stringify(MARKER)}.join(path.sep));
      fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, 'onnx');
      result = { content: [{ type: 'text', text: '[]' }] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`);
    return { file, got: () => { try { return JSON.parse(fs.readFileSync(record, 'utf8')); } catch { return null; } } };
}

// A plugin root whose marketplace entry declares the memory server as the fake - the shape `--plugin-root` reads.
function pluginRoot(name, service)
{
    const root = path.join(TMP, `${name}-plugin`);
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'envoydev', plugins: [
        { name: 'memory', mcpServers: { memory: { command: process.execPath, args: [service], env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec' } } } },
    ] }));
    return root;
}

function warm(name, { mode = 'ok', timeout = 20000, cached = false } = {})
{
    const home = path.join(TMP, `${name}-home`);
    fs.mkdirSync(home, { recursive: true });
    if (cached) { fs.mkdirSync(path.join(home, ...MARKER.slice(0, -1)), { recursive: true }); fs.writeFileSync(path.join(home, ...MARKER), 'onnx'); }
    const service = fakeService(name, mode);
    const r = spawnSync(process.execPath, [ENGINE, 'warm', '--plugin-root', pluginRoot(name, service.file), '--timeout', String(timeout)],
        { cwd: home, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: timeout + 20000 });
    return { r, home, service, out: `${r.stdout}${r.stderr}` };
}

test('warm: a cold machine - the service loads its model against a scratch database, and the model is cached after', () =>
{
    const { r, home, service, out } = warm('cold');
    assert.strictEqual(r.status, 0, out);
    assert.match(r.stdout, /^memory warm: ready \(\d+s\)$/m, out);
    assert.ok(fs.existsSync(path.join(home, ...MARKER)), 'the model is in the cache');
    const db = service.got().db;
    assert.ok(db && /alfred-memory-warm-/.test(db) && !db.startsWith(home), `a scratch database, never the user's: ${db}`);
    assert.ok(!fs.existsSync(path.dirname(db)), 'the scratch folder is removed');
});

test('warm: a cached model starts nothing', () =>
{
    const { r, service, out } = warm('cached', { cached: true });
    assert.strictEqual(r.status, 0, out);
    assert.match(r.stdout, /^memory warm: cached$/m, out);
    assert.strictEqual(service.got(), null, 'the service was never started');
});

test('warm: a service that never answers is bounded - one failure line, exit 1, the server stopped', () =>
{
    const { r, out } = warm('silent', { mode: 'silent', timeout: 1500 });
    assert.strictEqual(r.status, 1, out);
    assert.match(r.stdout, /^memory warm: failed - .*timed out/m, out);
});

// The installer, outside any session, fetches it once on a machine with uvx - through the snapshot's own launcher.
test('installer: the memory model is fetched ahead on a machine with uvx; switched off, nothing runs', POSIX_ONLY, () =>
{
    const service = fakeService('installer');
    const uvx = `exec "${process.execPath}" "${service.file}"`;
    const on = seedRun('install', 'rule alfred-memory\nmcp memory\n', { args: ['--scope', 'project'], tools: { uvx }, env: { ALFRED_CODE_MEMORY_WARM: undefined } });
    assert.match(on.out, /memory: the embedding model is cached now \(\d+s\) - the memory server's first start fits Claude Code's 30s connect budget/, on.out);
    assert.ok(service.got() && /alfred-memory-warm-/.test(service.got().db), 'the launcher was handed the scratch database');
    const off = seedRun('install', 'rule alfred-memory\nmcp memory\n', { args: ['--scope', 'project'], tools: { uvx } });
    assert.doesNotMatch(off.out, /embedding model/, 'the sandbox default keeps it off');
    // No uvx yet (init installs it): one line says so, nothing starts, and no failure is reported.
    const bare = seedRun('install', 'rule alfred-memory\nmcp memory\n', { args: ['--scope', 'project'], tools: { uvx: null }, env: { ALFRED_CODE_MEMORY_WARM: undefined } });
    assert.match(bare.out, /memory: the embedding model \(~166MB\) is fetched at the memory server's first start - uvx is not here yet/, bare.out);
    assert.doesNotMatch(bare.out, /!! memory: the embedding model/, bare.out);
    // A service that cannot start (the sandbox's uvx exits 1): one warning with the command, never a failed step.
    const broken = seedRun('install', 'rule alfred-memory\nmcp memory\n', { args: ['--scope', 'project'], env: { ALFRED_CODE_MEMORY_WARM: undefined } });
    assert.match(broken.out, /!! memory: the embedding model \(~166MB\) could not be fetched ahead \(.+\) - .* run node \.claude\/hooks\/memory\.js warm/, broken.out);
    assert.doesNotMatch(broken.out, /step\(s\) reported a failure/, broken.out);
});
