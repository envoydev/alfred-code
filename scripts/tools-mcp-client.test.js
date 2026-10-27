'use strict';
// The MCP list client the tools capture and the pins refresh share: initialize, then tools/list, over stdio or HTTP,
// with each tool's read-only / destructive hints and its first required string argument. A fixture server stands in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { listStdio, listHttp, listServer, expand, commandPlan } = require('../stack/skills/capture-preferences/scripts/mcp-client.js');
const rt = require('./install/runtime.js');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-'));
const FIXTURE = path.join(DIR, 'fixture.js');
fs.writeFileSync(FIXTURE, `'use strict';
const mode = process.argv[2] || 'ok';
if (process.env.FIXTURE_PID) require('fs').writeFileSync(process.env.FIXTURE_PID, String(process.pid));
if (mode === 'exit') process.exit(0);
const tools = [
    { name: 'lookup', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, depth: { type: 'number' } }, required: ['depth', 'symbol'] } },
    { name: 'wipe', annotations: { destructiveHint: true }, inputSchema: { type: 'object', properties: {} } },
];
if (mode === 'echoenv') tools.push({ name: String(process.env.FIXTURE_NAME), inputSchema: { type: 'object' } });
let buf = '';
process.stdin.on('data', (chunk) => {
    buf += chunk;
    let at;
    while ((at = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, at); buf = buf.slice(at + 1);
        const msg = JSON.parse(line);
        if (mode === 'hang') continue;
        const say = (o) => { if (mode === 'garbage') process.stdout.write('not json\\n'); process.stdout.write(JSON.stringify(o) + '\\n'); };
        if (msg.id === 1) say({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } });
        if (msg.id === 2) say({ jsonrpc: '2.0', id: 2, result: { tools } });
    }
});
setInterval(() => {}, 1000);
`);
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return fn(); };

test('listStdio returns names, hints and the first required string argument', async () =>
{
    const r = await listStdio(process.execPath, [FIXTURE, 'ok']);
    assert.deepStrictEqual(r, { ok: true, tools: [
        { name: 'lookup', readOnly: true, destructive: null, target: 'symbol' },
        { name: 'wipe', readOnly: null, destructive: true, target: null }] });
});

test('hang is killed at the timeout', async () =>
{
    const pidFile = path.join(DIR, 'hang.pid');
    const r = await listStdio(process.execPath, [FIXTURE, 'hang'], { env: { ...process.env, FIXTURE_PID: pidFile }, timeoutMs: 1000 });
    assert.deepStrictEqual(r, { ok: false, why: 'timed out at 1s' });
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(await until(() => !alive(pid), 2000), 'the hung child is gone');
});

test('exit before an answer is a failure, not a hang', async () =>
{
    const started = Date.now();
    const r = await listStdio(process.execPath, [FIXTURE, 'exit'], { timeoutMs: 20000 });
    assert.deepStrictEqual(r, { ok: false, why: 'exited before tools/list' });
    assert.ok(Date.now() - started < 10000);
});

test('a command that cannot start is a failure', async () =>
{
    const r = await listStdio(path.join(DIR, 'no-such-binary'), []);
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /could not start/);
});

test('garbage lines are skipped', async () =>
{
    const r = await listStdio(process.execPath, [FIXTURE, 'garbage']);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.tools.map((t) => t.name), ['lookup', 'wipe']);
});

test('listServer expands ${VAR}, ${VAR:-default} and ${CLAUDE_PLUGIN_ROOT}', async () =>
{
    const env = { ...process.env };
    delete env.NAME;
    const r = await listServer({ command: process.execPath, args: ['${CLAUDE_PLUGIN_ROOT}/fixture.js', 'echoenv'], env: { FIXTURE_NAME: '${NAME:-fallback}' } }, { env, pluginRoot: DIR });
    assert.strictEqual(r.ok, true);
    assert.ok(r.tools.some((t) => t.name === 'fallback'), JSON.stringify(r));
    assert.strictEqual(expand('${A}-${B:-b}-${C}', { A: 'a' }, null), 'a-b-');
    assert.strictEqual(expand('${CLAUDE_PLUGIN_ROOT}/x', {}, '/root'), '/root/x');
});

test('listHttp initializes, echoes the session id and reads an SSE answer', async () =>
{
    const seen = [];
    const server = http.createServer((req, res) =>
    {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () =>
        {
            const msg = JSON.parse(body);
            seen.push({ method: msg.method, session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization || null });
            if (msg.method === 'initialize')
            {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }));
                return;
            }
            if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
            if (req.headers['mcp-session-id'] !== 's1') { res.writeHead(400); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'search', annotations: { readOnlyHint: true }, inputSchema: { required: ['query'], properties: { query: { type: 'string' } } } }] } })}\n\n`);
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try
    {
        const url = `http://127.0.0.1:${server.address().port}/mcp`;
        const r = await listServer({ type: 'http', url, headers: { Authorization: 'Bearer ${TOKEN}' } }, { env: { TOKEN: 't0k' } });
        assert.deepStrictEqual(r, { ok: true, tools: [{ name: 'search', readOnly: true, destructive: null, target: 'query' }] });
        assert.deepStrictEqual(seen.map((s) => s.method), ['initialize', 'notifications/initialized', 'tools/list']);
        assert.strictEqual(seen[2].session, 's1');
        assert.ok(seen.every((s) => s.auth === 'Bearer t0k'));
    }
    finally { server.close(); }
});

test('an unreachable HTTP server is a failure', async () =>
{
    const r = await listHttp('http://127.0.0.1:9/mcp', { timeoutMs: 2000 });
    assert.strictEqual(r.ok, false);
});

test('an sse registration is not listed', async () =>
{
    assert.deepStrictEqual(await listServer({ type: 'sse', url: 'http://127.0.0.1:9/sse' }), { ok: false, why: 'sse transport - taken from the session listing' });
    assert.deepStrictEqual(await listServer({}), { ok: false, why: 'no command or url' });
});

test('commandPlan matches install/runtime.js on win32', () =>
{
    const resolve = (bin) => ({ npx: 'C:\\n\\npx.cmd', uvx: 'C:\\u\\uvx.exe', node: 'C:\\n\\node.exe' })[bin] || '';
    for (const [bin, argv] of [['npx', ['-y', 'a b&c', '%PATH%']], ['uvx', ['--from', 'x', 'y']], ['node', ['s.js']], ['missing', []], ['npx', ['two\nlines']]])
        assert.deepStrictEqual(commandPlan(bin, argv, { env: {} }, { platform: 'win32', resolve }), rt.commandPlan(bin, argv, { env: {} }, { platform: 'win32', resolve }));
    assert.deepStrictEqual(commandPlan('npx', ['-y'], {}, { platform: 'darwin' }), { cmd: 'npx', args: ['-y'], opts: {} });
});

// A URL's userinfo or query can hold a credential, and fetch puts the URL in its error message: a failed listing names
// the failure, never the URL, so nothing secret reaches the inventory or a printed line (the final review, C1).
test('a failed HTTP listing never names its URL', async () =>
{
    for (const url of ['http://bob:s3cr3t-pass@127.0.0.1:9/mcp', 'http://127.0.0.1:9/mcp?token=s3cr3t-pass'])
    {
        const r = await listServer({ type: 'http', url }, { timeoutMs: 5000 });
        assert.strictEqual(r.ok, false, url);
        assert.ok(!String(r.why).includes('s3cr3t') && !String(r.why).includes('bob'), r.why);
        assert.match(r.why, /^unreachable \(/, r.why);
    }
});

// A launcher that ignores SIGTERM, over a hung grandchild that holds the stdout pipe; each writes its pid under $TREE.
const WRAPPER = path.join(DIR, 'wrapper.js');
fs.writeFileSync(WRAPPER, `'use strict';
process.on('SIGTERM', () => {});
const fs = require('fs');
fs.writeFileSync(process.env.TREE + '/wrapper', String(process.pid));
require('child_process').spawn(process.execPath, ['-e', 'require("fs").writeFileSync(process.env.TREE + "/grandchild", String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
setInterval(() => {}, 1000);
`);

// A launcher that does not pass SIGTERM on (cmd.exe under an npm shim, a shell script) keeps a hung server and the pipes
// it holds alive past a kill of the direct child: the whole tree goes, and the caller exits (the final review, I5).
test('a hung server under a wrapper is killed with its tree, and the caller exits', { skip: process.platform === 'win32' && 'the POSIX process-group branch; Windows takes taskkill /T' }, () =>
{
    const wrapper = WRAPPER;
    const pids = path.join(DIR, 'tree');
    fs.mkdirSync(pids, { recursive: true });
    const client = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'mcp-client.js');
    const t0 = Date.now();
    const r = require('node:child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(client)}).listStdio(process.execPath, [${JSON.stringify(wrapper)}], { timeoutMs: 1000 }).then((x) => console.log(JSON.stringify(x)))`],
        { encoding: 'utf8', env: { ...process.env, TREE: pids }, timeout: 15000 });
    const took = Date.now() - t0;
    const living = [];
    try
    {
        for (const who of ['wrapper', 'grandchild'])
        {
            let pid = 0;
            try { pid = Number(fs.readFileSync(path.join(pids, who), 'utf8')); } catch { continue; }
            let alive = true;
            for (let i = 0; i < 40 && alive; i++) { try { process.kill(pid, 0); require('node:child_process').spawnSync('sleep', ['0.05']); } catch { alive = false; } }
            if (alive) living.push(`${who} ${pid}`);
        }
        assert.strictEqual(r.stdout.trim(), JSON.stringify({ ok: false, why: 'timed out at 1s' }), r.stderr);
        assert.ok(took < 5000, `the caller lived ${took} ms`);
        assert.deepStrictEqual(living, [], 'outlived the listing');
    }
    finally
    {
        for (const who of ['wrapper', 'grandchild']) { try { process.kill(Number(fs.readFileSync(path.join(pids, who), 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
    }
});

// The update kills a refresh still running at its 60 s cap, and the user may interrupt a capture: the listings in flight
// lead process groups of their own, so tools.js takes them down before it goes (the final review, I5).
test('tools.js stopped mid-listing takes the listed server and its tree with it', { skip: process.platform === 'win32' && 'POSIX signals; Windows relies on the per-listing cap' }, async () =>
{
    const wrapper = WRAPPER;
    const pids = path.join(DIR, 'tree-stop');
    fs.mkdirSync(pids, { recursive: true });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-stop-'));
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { slow: { command: process.execPath, args: [wrapper] } } }));
    const tools = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js');
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-stop-config-'));
    const child = require('node:child_process').spawn(process.execPath, [tools, 'inventory', '--project', root],
        { env: { ...process.env, TREE: pids, CLAUDE_CONFIG_DIR: config, PATH: path.dirname(process.execPath), ALFRED_CODE_DATA_PATH: '' }, stdio: 'ignore' });
    const living = [];
    try
    {
        assert.ok(await until(() => fs.existsSync(path.join(pids, 'grandchild')), 10000), 'the listing started');
        const exited = new Promise((r) => child.on('exit', (code, signal) => r(signal || code)));
        child.kill('SIGTERM');
        assert.strictEqual(await exited, 'SIGTERM', 'it still dies of the signal');
        for (const who of ['wrapper', 'grandchild'])
        {
            const pid = Number(fs.readFileSync(path.join(pids, who), 'utf8'));
            if (!(await until(() => !alive(pid), 2000))) living.push(`${who} ${pid}`);
        }
        assert.deepStrictEqual(living, [], 'outlived the stop');
    }
    finally
    {
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        for (const who of ['wrapper', 'grandchild']) { try { process.kill(Number(fs.readFileSync(path.join(pids, who), 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(config, { recursive: true, force: true });
    }
});
