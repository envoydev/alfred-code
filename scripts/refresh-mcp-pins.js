'use strict';
// THE MCP VERSION PINS - resolved deliberately, never during an install.
//
// Until Phase 6 the installer asked npm and PyPI for `latest` on every run and wrote the answer
// into .mcp.json, so two installs a week apart silently ran different server code from the same
// stack release. A plugin entry is static JSON in the marketplace, so there is no install-time step
// to ask in - and that is the better contract anyway: a pin moves when someone commits a move.
//
//   node scripts/refresh-mcp-pins.js            # report what would change, write nothing
//   node scripts/refresh-mcp-pins.js --write    # resolve and write meta/mcp-pins.json and meta/mcp-tools.json
//
// Offline or a dead registry is NOT a failure: the row keeps the pin it had, and the report says
// which ones could not be checked. A row that never resolved carries `null`, which the generator
// reads as 'ship unpinned' - the same fallback the installer had.
//
// THE SERENA GATE (R7). stack/mcp/navigation-context.yml copies serena-agent's own claude-code.yml minus the
// editing tools no house hook sees, and records that upstream file's sha256 on its `# upstream:` line. A later
// serena could add an editing tool the stack's context would then serve unwatched, so a navigation bump goes
// through only when the new release's claude-code.yml hashes the same; otherwise the pin stays, the report says
// REFUSED and the run exits 1 - re-diff the file against the new context, record its hash, and refresh again.
//
// THE TOOL LISTS (M31). --write also records each pinned server's tool names in meta/mcp-tools.json, which lint
// check 62 holds every shipped `mcp__plugin_<p>_<p>__<tool>` spelling to: a pin bump that renames or drops a tool
// is a lint finding, not a silent drop. A server this machine cannot list keeps its committed list (NOT CHECKED).
// A navigation tool absent from the committed list prints '!! navigation: new tool <name>': the claude-code.yml
// hash proves the context file, not that serena added no editing tool.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn
const { PYTHON, excludeNewerOf } = require('../stack/mcp/uv-python.js');

const REPO = path.join(__dirname, '..');
const PINS = path.join(REPO, 'meta', 'mcp-pins.json');
const TOOLS = path.join(REPO, 'meta', 'mcp-tools.json');
const CONTEXT = path.join(REPO, 'stack', 'mcp', 'navigation-context.yml');
const CONTEXT_IN_WHEEL = 'serena/resources/config/contexts/claude-code.yml';
const UPSTREAM_LINE = /^# upstream: serena-agent (\S+) claude-code\.yml sha256 ([0-9a-f]{64})\s*$/m;

// registry: how to ask, and the spelling the pin takes inside the server's own command line.
const PACKAGES = {
    'browser':    { registry: 'npm',  package: '@playwright/mcp',       spelling: '@<v>' },
    'navigation': { registry: 'pypi', package: 'serena-agent',          spelling: '@<v>' },
    // The memory pin is spelled '==<v>' INSIDE the extras brackets ('mcp-memory-service[sqlite]==<v>'),
    // not '@<v>' like the others, which have no extras suffix to sit next to.
    'memory':     { registry: 'pypi', package: 'mcp-memory-service',    spelling: '==<v>' },
    'windows-desktop': { registry: 'pypi', package: 'windows-mcp',      spelling: '==<v>' },
    'macos-desktop':   { registry: 'pypi', package: 'macos-mcp',        spelling: '==<v>' },
};

function npmLatest(pkg)
{
    try
    {
        const out = rt.execCommand('npm', ['view', pkg, 'version'],
            { encoding: 'utf8', timeout: 30000, env: { ...process.env, npm_config_fetch_timeout: '15000' } });
        return out.trim() || null;
    }
    catch { return null; }
}

// Does a `requires_python` specifier admit this Python? `x.y` against the clauses PyPI carries (>=, >,
// <, <=, ==, !=, ~=, a trailing .* on == / !=). A clause it cannot read admits - the launch says so.
const vparts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
function vcmp(a, b)
{
    const x = vparts(a);
    const y = vparts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}
function admits(spec, python)
{
    for (const clause of String(spec || '').split(',').map((c) => c.trim()).filter(Boolean))
    {
        const m = /^(~=|==|!=|>=|<=|>|<)\s*([0-9][0-9.]*)(\.\*)?$/.exec(clause);
        if (!m) continue;
        const [, op, want, star] = m;
        const head = star ? vparts(python).slice(0, vparts(want).length).join('.') : python;
        const c = vcmp(head, want);
        const ok = { '>=': c >= 0, '>': c > 0, '<=': c <= 0, '<': c < 0, '==': c === 0, '!=': c !== 0,
            '~=': c >= 0 && vcmp(vparts(python).slice(0, vparts(want).length - 1).join('.'), vparts(want).slice(0, -1).join('.')) === 0 }[op];
        if (!ok) return false;
    }
    return true;
}

// The newest FINAL release, not yanked, that the stack's pinned Python can install - every uvx server
// starts on that one interpreter (stack/mcp/uv-python.js), so a pin past its floor fails at launch
// (windows-mcp 0.8.6 needs 3.14). null when no release qualifies: the row keeps its committed pin.
function newestFor(json, python)
{
    const releases = (json && json.releases) || {};
    const ok = Object.keys(releases)
        .filter((v) => /^[0-9]+(\.[0-9]+)*$/.test(v))
        .filter((v) => releases[v].length && releases[v].every((f) => !f.yanked) && admits(releases[v][0].requires_python, python))
        .sort(vcmp);
    return ok.length ? ok[ok.length - 1] : null;
}

function pypiLatest(pkg)
{
    try
    {
        const out = rt.execCommand('curl', ['-fsSL', '--max-time', '20', `https://pypi.org/pypi/${pkg}/json`],
            { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
        return newestFor(JSON.parse(out), PYTHON);
    }
    catch { return null; }
}

function readPins(file = PINS)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { note: '', refreshed: null, pins: {} }; }
}

// --- a wheel's files, read straight from PyPI (no pip, no unzip) ------------------------------------------
// A wheel is a zip: the central directory at its end names each entry, its method (0 stored, 8 deflated), sizes
// and local header. Enough for a py3 wheel; zip64 archives are not read (a wheel past 4GB is not one of ours).
function zipEntries(buf, want)
{
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) return {};
    const count = buf.readUInt16LE(end + 10);
    let at = buf.readUInt32LE(end + 16);
    const out = {};
    for (let n = 0; n < count && buf.readUInt32LE(at) === 0x02014b50; n += 1)
    {
        const method = buf.readUInt16LE(at + 10);
        const size = buf.readUInt32LE(at + 20);
        const nameLen = buf.readUInt16LE(at + 28);
        const extra = buf.readUInt16LE(at + 30);
        const comment = buf.readUInt16LE(at + 32);
        const local = buf.readUInt32LE(at + 42);
        const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
        at += 46 + nameLen + extra + comment;
        if (!want(name)) continue;
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + size);
        out[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    }
    return out;
}

function wheelFiles(pkg, version, want)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-wheel-'));
    try
    {
        const meta = JSON.parse(rt.execCommand('curl', ['-fsSL', '--max-time', '20', `https://pypi.org/pypi/${pkg}/${version}/json`],
            { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }));
        const wheel = (meta.urls || []).find((u) => u.packagetype === 'bdist_wheel' && /-py3-none-any\.whl$/.test(u.filename));
        if (!wheel) return null;
        const file = path.join(dir, wheel.filename);
        rt.execCommand('curl', ['-fsSL', '--max-time', '120', '-o', file, wheel.url], { timeout: 150000 });
        return zipEntries(fs.readFileSync(file), want);
    }
    catch { return null; }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// serena-agent's own claude-code.yml at a version, or null when it cannot be read.
function upstreamContext(version)
{
    const files = wheelFiles('serena-agent', version, (name) => name === CONTEXT_IN_WHEEL);
    return files && typeof files[CONTEXT_IN_WHEEL] === 'string' ? files[CONTEXT_IN_WHEEL] : null;
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// R7: may the navigation pin move from `was` to `now`? Only when the new release's claude-code.yml is the file the
// stack's context was diffed against (the `# upstream:` line's sha256).
function serenaGate({ was, now, contextFile = CONTEXT, fetch = upstreamContext })
{
    if (!now || now === was) return { ok: true };
    let recorded = null;
    try { recorded = UPSTREAM_LINE.exec(fs.readFileSync(contextFile, 'utf8')); } catch { /* unreadable: no record */ }
    const rel = 'stack/mcp/navigation-context.yml';
    if (!recorded) return { ok: false, why: `${rel} records no upstream sha256 (its '# upstream: serena-agent <v> claude-code.yml sha256 <hex>' line)` };
    const text = fetch(now);
    if (typeof text !== 'string') return { ok: false, why: `serena-agent ${now}'s claude-code.yml could not be read - nothing checked it against ${rel}` };
    const hash = sha256(text);
    if (hash === recorded[2]) return { ok: true, note: `its claude-code.yml is unchanged since ${recorded[1]}` };
    return { ok: false, why: `serena-agent ${now}'s claude-code.yml is not the one ${rel} was diffed against (${recorded[1]}, sha256 ${recorded[2].slice(0, 12)}; now ${hash.slice(0, 12)}) - re-diff the file against it, record the new line, and refresh again` };
}

// --- the tool lists ----------------------------------------------------------------------------------------
// One MCP exchange over stdio: initialize, then tools/list; the names, or null on any failure or the timeout.
function stdioTools(command, args, { env = process.env, timeoutMs = 240000 } = {})
{
    return new Promise((resolve) =>
    {
        let child;
        try { child = rt.spawnCommandAsync(command, args, { stdio: ['pipe', 'pipe', 'ignore'], env, windowsHide: true }); }
        catch { resolve(null); return; }
        let buf = '';
        let done = false;
        const finish = (value) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } resolve(value); };
        const timer = setTimeout(() => finish(null), timeoutMs);
        const send = (msg) => { try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`); } catch { finish(null); } };
        child.on('error', () => finish(null));
        child.on('exit', () => finish(null));
        child.stdin.on('error', () => finish(null));
        child.stdout.on('data', (chunk) =>
        {
            buf += chunk.toString('utf8');
            let at;
            while ((at = buf.indexOf('\n')) >= 0)
            {
                const line = buf.slice(0, at);
                buf = buf.slice(at + 1);
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                if (msg.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/list', params: {} }); }
                else if (msg.id === 2) finish(msg.result && Array.isArray(msg.result.tools) ? msg.result.tools.map((t) => t.name) : null);
            }
        });
        send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'refresh-mcp-pins', version: '1' } } });
    });
}

async function httpTools(url)
{
    try
    {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), signal: AbortSignal.timeout(30000) });
        const text = await res.text();
        const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') || text;
        const msg = JSON.parse(data);
        return msg.result && Array.isArray(msg.result.tools) ? msg.result.tools.map((t) => t.name) : null;
    }
    catch { return null; }
}

const DESKTOP_TOOL = /@mcp\.tool\(\s*name\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g;

// Each pinned server's tool names, at the pin and the release cut-off: serena's own full list, the stdio servers'
// tools/list (the browser with every optional capability on), the hosted documentation server's tools/list, and
// the desktop servers' `@mcp.tool(name=...)` names read from the wheel - they run only on their own OS.
async function listTools(name, row, { cutoff = '' } = {})
{
    const v = row && row.version;
    const cut = cutoff ? ['--exclude-newer', cutoff] : [];
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-tools-'));
    try
    {
        if (name === 'navigation')
        {
            const out = rt.execCommand('uvx', ['--python', PYTHON, ...cut, '--from', `serena-agent@${v}`, 'serena', 'tools', 'list', '--all', '-q'],
                { encoding: 'utf8', timeout: 600000, env: { ...process.env, SERENA_HOME: path.join(scratch, 'home') } });
            const names = out.split('\n').map((l) => l.trim()).filter((l) => /^[a-z][a-z0-9_]*$/.test(l));
            return names.length ? names : null;
        }
        if (name === 'memory')
            return await stdioTools('uvx', ['--python', PYTHON, ...cut, '--with', 'numpy', '--from', `mcp-memory-service[sqlite]==${v}`, 'memory', 'server'],
                { env: { ...process.env, MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec', MCP_MEMORY_SQLITE_PATH: path.join(scratch, 'memory.db') } });
        if (name === 'browser')
            return await stdioTools('npx', ['-y', `@playwright/mcp@${v}`, '--caps', 'vision,pdf,devtools', '--headless', '--isolated', '--output-dir', scratch]);
        if (name === 'documentation') return await httpTools('https://mcp.context7.com/mcp');
        if (name === 'windows-desktop' || name === 'macos-desktop')
        {
            const files = wheelFiles(PACKAGES[name].package, v, (f) => f.endsWith('.py'));
            const names = files ? [...new Set(Object.values(files).flatMap((t) => [...t.matchAll(DESKTOP_TOOL)].map((m) => m[1])))] : [];
            return names.length ? names : null;
        }
        return null;
    }
    catch { return null; }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// The servers with a tool list: every pinned package plus the hosted documentation server (no version).
const TOOL_SERVERS = [...Object.keys(PACKAGES), 'documentation'];

async function main(argv, deps = {})
{
    const d = {
        npmLatest, pypiLatest, upstreamContext, listTools, log: (l) => console.log(l),
        pinsFile: PINS, toolsFile: TOOLS, contextFile: CONTEXT, today: () => new Date().toISOString().slice(0, 10), ...deps,
    };
    const write = argv.includes('--write');
    const current = readPins(d.pinsFile);
    const pins = {};
    const report = [];
    let refused = false;
    for (const [name, spec] of Object.entries(PACKAGES))
    {
        const was = (current.pins && current.pins[name] && current.pins[name].version) || null;
        const now = spec.registry === 'npm' ? d.npmLatest(spec.package) : d.pypiLatest(spec.package);
        // Unreachable keeps the committed pin: a refresh run on a plane must not unpin the stack.
        let version = now || was;
        if (name === 'navigation' && now && now !== was)
        {
            const gate = serenaGate({ was, now, contextFile: d.contextFile, fetch: d.upstreamContext });
            if (!gate.ok) { refused = true; version = was; report.push(`  ${name}: ${was || 'unpinned'} -> ${now} REFUSED - ${gate.why}`); }
            else report.push(`  ${name}: ${was || 'unpinned'} -> ${now} (${gate.note})`);
        }
        else if (!now) report.push(`  ${name}: NOT CHECKED (registry unreachable) - keeping ${was || 'unpinned'}`);
        else if (now === was) report.push(`  ${name}: ${now} (unchanged)`);
        else report.push(`  ${name}: ${was || 'unpinned'} -> ${now}`);
        pins[name] = { package: spec.package, registry: spec.registry, spelling: spec.spelling, version };
    }
    d.log(report.join('\n'));
    if (!write) { d.log('\nnothing written - re-run with --write to commit these pins'); return refused ? 1 : 0; }
    const refreshed = d.today();
    const out = {
        generatedBy: 'refresh-mcp-pins',
        note: 'The MCP runtime versions the generated plugin entries pin to, and (refreshed) the day that is the uvx servers\' dependency cut-off: each starts with --exclude-newer <refreshed>T23:59:59Z, so the whole tree is fixed, not only the top package. Refreshed deliberately with `node scripts/refresh-mcp-pins.js --write`, never during an install or by hand - a pin newer than the cut-off would not resolve. A null version ships unpinned.',
        refreshed,
        pins,
    };
    fs.writeFileSync(d.pinsFile, JSON.stringify(out, null, 2) + '\n');
    d.log(`\npins written: ${path.relative(REPO, d.pinsFile)}`);

    let tools;
    try { tools = JSON.parse(fs.readFileSync(d.toolsFile, 'utf8')); } catch { tools = {}; }
    const servers = { ...((tools && tools.servers) || {}) };
    const lines = [];
    for (const name of TOOL_SERVERS)
    {
        const row = pins[name] || { version: null };
        const got = await d.listTools(name, row, { cutoff: excludeNewerOf(refreshed) });
        if (name === 'navigation' && Array.isArray(got) && servers[name])
            for (const t of new Set(got)) if (!servers[name].tools.includes(t)) lines.push(`  !! navigation: new tool ${t} - an editing tool no house hook sees would go unwatched`);
        if (Array.isArray(got) && got.length) { servers[name] = { version: row.version, tools: [...new Set(got)].sort() }; lines.push(`  tools ${name}: ${got.length}`); }
        else lines.push(`  tools ${name}: NOT CHECKED - keeping ${servers[name] ? `the ${servers[name].version || 'hosted'} list` : 'no list'}`);
    }
    fs.writeFileSync(d.toolsFile, JSON.stringify({
        generatedBy: 'refresh-mcp-pins',
        note: 'Each pinned MCP server\'s tool names at its pin (the hosted documentation server has none), written by `node scripts/refresh-mcp-pins.js --write`. Lint check 62 fails a shipped mcp__plugin_<p>_<p>__<tool> spelling whose tool is not listed here.',
        servers: Object.fromEntries(Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))),
    }, null, 2) + '\n');
    d.log(`${lines.join('\n')}\ntools written: ${path.relative(REPO, d.toolsFile)}`);
    return refused ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((rc) => process.exit(rc), (err) => { console.error(err); process.exit(1); });
module.exports = { PACKAGES, readPins, main, newestFor, admits, serenaGate, zipEntries, listTools, UPSTREAM_LINE, TOOL_SERVERS };
