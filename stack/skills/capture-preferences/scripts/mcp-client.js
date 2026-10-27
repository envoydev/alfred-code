'use strict';
// One MCP exchange per server - initialize, then tools/list - over stdio or streamable HTTP, for the tools capture's
// inventory and its refresh on update (tools.js) and for the repo's pin refresh (scripts/refresh-mcp-pins.js, which
// requires this file). Each tool comes back with its read-only and destructive hints and its target - the first
// required string argument of its input schema - so the inventory records what a later phase needs without a second
// start. A server is never left running: the child is killed on the answer, on its exit, and at the timeout. Nothing
// here prints, so a registration's env and header values never leave the process that starts the server.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// ---------------------------------------------------------------- starting a command on every OS
// A copy of scripts/install/runtime.js commandPlan and its helpers: a copied skill cannot reach scripts/, and a user's
// server is often an npm shim (`npx.cmd`) that Node cannot start without cmd.exe. scripts/tools-mcp-client.test.js
// holds the two equal - change both or neither.
const STARTABLE = ['.com', '.exe', '.bat', '.cmd'];
const isFileOnDisk = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const envKey = (env, name) => Object.keys(env || {}).find((k) => k.toUpperCase() === name);
function resolveWin(cmd, env = process.env, isFile = isFileOnDisk)
{
    const read = (name) => { const k = envKey(env, name); return k ? String(env[k] || '') : ''; };
    const dirs = read('PATH').split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => path.win32.isAbsolute(d) && /^([A-Za-z]:\\|\\\\)/.test(d));
    const listed = (read('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter((e) => STARTABLE.includes(e));
    const own = path.win32.extname(cmd).toLowerCase();
    const names = STARTABLE.includes(own) ? [cmd] : listed.map((e) => cmd + e);
    for (const dir of dirs)
        for (const name of names)
        {
            const full = path.win32.join(dir, name);
            if (isFile(full)) return full;
        }
    return '';
}
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArg(arg)
{
    const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
    return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}
function commandPlan(bin, argv, opts, { platform = process.platform, resolve = resolveWin } = {})
{
    if (platform !== 'win32') return { cmd: bin, args: argv, opts };
    const env = (opts && opts.env) || process.env;
    const full = resolve(bin, env);
    if (!full) return { why: `${bin}: not found on PATH as a .exe, .com, .cmd or .bat` };
    if (!/\.(cmd|bat)$/i.test(full)) return { cmd: full, args: argv, opts };
    if (argv.some((a) => /[\r\n]/.test(String(a)))) return { why: `${bin}: an argument holds a line break, which cmd.exe cannot pass` };
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const line = [full.replace(CMD_META, '^$1'), ...argv.map(cmdArg)].join(' ');
    return { cmd: comspec, args: ['/d', '/s', '/c', `"${line}"`], opts: { ...opts, windowsVerbatimArguments: true } };
}
// The default start: the plan above, or a plain spawn whose failure arrives as its 'error' event.
function startCommand(bin, argv, opts)
{
    const plan = commandPlan(bin, argv, opts);
    return plan.why ? spawn(bin, argv, opts) : spawn(plan.cmd, plan.args, plan.opts);
}

// ---------------------------------------------------------------- one tool's facts
const hint = (annotations, key) => (annotations && typeof annotations[key] === 'boolean' ? annotations[key] : null);
function targetOf(schema)
{
    const props = (schema && schema.properties) || {};
    for (const name of Array.isArray(schema && schema.required) ? schema.required : [])
        if (props[name] && props[name].type === 'string') return name;
    return null;
}
const toolsOf = (result) => (result && Array.isArray(result.tools)
    ? result.tools.filter((t) => t && typeof t.name === 'string').map((t) => ({
        name: t.name, readOnly: hint(t.annotations, 'readOnlyHint'), destructive: hint(t.annotations, 'destructiveHint'), target: targetOf(t.inputSchema),
    }))
    : null);

const INIT = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'alfred-code-tools', version: '1' } };
const timedOut = (ms) => `timed out at ${Math.round(ms / 1000)}s`;

// ---------------------------------------------------------------- stdio
// The listed server and everything it started go at the end, and its pipes are let go, so the caller exits: a launcher
// that does not pass SIGTERM on (cmd.exe under an npm shim, a shell script) would keep a hung server and the pipes it holds
// alive past a kill of the direct child. On POSIX the child leads its own process group, which is killed whole; on
// Windows taskkill takes the tree. A listing leaves nothing worth a graceful stop.
function stopTree(child, { platform = process.platform, spawnFn = spawn } = {})
{
    if (!child) return;
    for (const s of [child.stdin, child.stdout, child.stderr]) { try { if (s) s.destroy(); } catch { /* gone */ } }
    try { child.unref(); } catch { /* gone */ }
    if (!child.pid) return;
    if (platform === 'win32')
    {
        try { spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref(); } catch { /* gone */ }
        return;
    }
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}
// Every listing in flight, so a caller stopped mid-run can take them down with it (stopAll).
const live = new Set();
function stopAll()
{
    for (const stop of [...live]) stop();
}
function listStdio(command, args = [], { env = process.env, cwd, timeoutMs = 30000, spawn: start = startCommand } = {})
{
    return new Promise((resolve) =>
    {
        let child;
        let done = false;
        let timer = null;
        const finish = (value) =>
        {
            if (done) return;
            done = true;
            clearTimeout(timer);
            live.delete(stop);
            stopTree(child);
            resolve(value);
        };
        const stop = () => finish({ ok: false, why: 'stopped' });
        try { child = start(command, args, { stdio: ['pipe', 'pipe', 'ignore'], env, windowsHide: true, detached: process.platform !== 'win32', ...(cwd ? { cwd } : {}) }); }
        catch (err) { resolve({ ok: false, why: `could not start (${err.code || err.name})` }); return; }
        live.add(stop);
        timer = setTimeout(() => finish({ ok: false, why: timedOut(timeoutMs) }), timeoutMs);
        const send = (msg) => { try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`); } catch { finish({ ok: false, why: 'its stdin closed' }); } };
        child.on('error', (err) => finish({ ok: false, why: `could not start (${err.code || err.name})` }));
        // 'close', not 'exit': the streams are drained by then, so an answer sent just before the server quits is read.
        child.on('close', () => finish({ ok: false, why: 'exited before tools/list' }));
        child.stdin.on('error', () => finish({ ok: false, why: 'exited before tools/list' }));
        let buf = '';
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
                if (!msg || typeof msg !== 'object') continue;
                if (msg.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/list', params: {} }); }
                else if (msg.id === 2)
                {
                    const tools = toolsOf(msg.result);
                    finish(tools ? { ok: true, tools } : { ok: false, why: 'tools/list returned no tool list' });
                }
            }
        });
        send({ id: 1, method: 'initialize', params: INIT });
    });
}

// ---------------------------------------------------------------- streamable HTTP
// A JSON answer, or the `data:` lines of an event stream joined - the two shapes a streamable HTTP server may send.
const answerOf = (text) => JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') || text);
async function listHttp(url, { headers = {}, timeoutMs = 30000 } = {})
{
    const signal = AbortSignal.timeout(timeoutMs);
    const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
    const post = (msg, session) => fetch(url, { method: 'POST', signal, headers: session ? { ...base, 'Mcp-Session-Id': session } : base, body: JSON.stringify({ jsonrpc: '2.0', ...msg }) });
    try
    {
        const init = await post({ id: 1, method: 'initialize', params: INIT });
        if (!init.ok) return { ok: false, why: `initialize answered ${init.status}` };
        const session = init.headers.get('mcp-session-id');
        await init.text();
        const note = await post({ method: 'notifications/initialized' }, session);
        await note.text();
        const res = await post({ id: 2, method: 'tools/list', params: {} }, session);
        if (!res.ok) return { ok: false, why: `tools/list answered ${res.status}` };
        const tools = toolsOf(answerOf(await res.text()).result);
        return tools ? { ok: true, tools } : { ok: false, why: 'tools/list returned no tool list' };
    }
    // Never the message: fetch puts the URL in it, and a URL's userinfo or query can hold a credential.
    catch (err) { return { ok: false, why: err && err.name === 'TimeoutError' ? timedOut(timeoutMs) : `unreachable (${(err && err.cause && err.cause.code) || (err && err.name) || 'error'})` }; }
}

// ---------------------------------------------------------------- a registration as Claude Code stores it
// `${VAR}` and `${VAR:-default}` from the environment, `${CLAUDE_PLUGIN_ROOT}` from the plugin's install path - the
// expansions Claude Code applies to a server's command, args, env, url and headers. An unset variable with no
// default is empty.
function expand(value, env = process.env, pluginRoot = null)
{
    return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) =>
    {
        if (name === 'CLAUDE_PLUGIN_ROOT' && pluginRoot) return pluginRoot;
        const v = env[name];
        return v !== undefined && v !== '' ? v : (fallback !== undefined ? fallback : '');
    });
}
const expandMap = (map, env, pluginRoot) => Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {}).map(([k, v]) => [k, expand(v, env, pluginRoot)]));

function listServer(def, { env = process.env, pluginRoot = null, timeoutMs = 30000, spawn: start } = {})
{
    const d = def && typeof def === 'object' ? def : {};
    const kind = String(d.type || (d.url ? 'http' : 'stdio')).toLowerCase();
    if (kind === 'sse') return Promise.resolve({ ok: false, why: 'sse transport - taken from the session listing' });
    if (kind === 'http' && d.url) return listHttp(expand(d.url, env, pluginRoot), { headers: expandMap(d.headers, env, pluginRoot), timeoutMs });
    if (!d.command) return Promise.resolve({ ok: false, why: 'no command or url' });
    const args = Array.isArray(d.args) ? d.args.map((a) => expand(a, env, pluginRoot)) : [];
    const childEnv = { ...env, ...expandMap(d.env, env, pluginRoot) };
    return listStdio(expand(d.command, env, pluginRoot), args, { env: childEnv, timeoutMs, ...(start ? { spawn: start } : {}), ...(d.cwd ? { cwd: expand(d.cwd, env, pluginRoot) } : {}) });
}

module.exports = { listStdio, listHttp, listServer, stopAll, expand, commandPlan, resolveWin };
