#!/usr/bin/env node
// tools.js - the scripted half of /capture-preferences tools: the tools doc (TOOLS-PREFERENCES.md - which tools each job
// uses first, what each is for, which servers stay with the main session), this machine's inventory of every tool it
// reaches, the order each session and seat is told at its start, and the inventory's refresh on update. The doc is the
// user's decisions and may be committed; the inventory is this machine's facts and never is. The hooks
// (preferences-session.js) and the installer (install/docs.js) require this file from the snapshot.
//
// Usage, from the project root:
//   node .claude/skills/capture-preferences/scripts/tools.js lint      the doc against the adapter table and the inventory
//   node .../tools.js next                                             the id a new entry takes
//   node .../tools.js inventory [--session-tools <file>] [--label <prefix>=own:<label>]...
//                     every MCP server this project reaches and its tools, written to <data root>/state/tools-inventory.json
//   node .../tools.js order [--seat <agent file>]                      the start line the main session, or that seat, is sent
//   node .../tools.js validate                                         the `!! tools:` rows validate prints
//   node .../tools.js refresh                                          the inventory re-read where its registrations changed (update)
//   --project <dir>   the project root (default: the current directory)
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const prefs = require('./preferences.js');
const client = require('./mcp-client.js');

const TOOLS_DOC = 'TOOLS-PREFERENCES.md';
// The doc's cap. The main session gets every entry at every start, and each rank's Load clause spells its tools in full,
// so the line itself has a cap too: with the personal push beside it, one hook output stays well under Claude Code's.
const TOOLS_CAP = 3000;
const TOOLS_LINE_CAP = 4000;
const TOOLS_FIELD = /^- (Job|Order|Purpose|Held|Deny|Why):\s*(.*?)\s*$/;
const ADAPTERS = path.join(__dirname, 'tool-adapters.json');
const PREFS_DIR = 'preferences';
const TYPE = /^(?:own:[a-z0-9][\w-]*|[A-Za-z][\w-]*)$/;
const TOOL = /^[\w.-]+$/;
// One server's listing; the capture runs them in parallel, so a capture takes about this long whatever it finds.
const LIST_TIMEOUT_MS = 30000;
const PLUGIN_LIST_TIMEOUT_MS = 45000;

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const isLink = (file) => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };
const shown = (projectRoot, abs) =>
{
    const rel = path.relative(projectRoot, abs);
    return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs).split(path.sep).join('/');
};

// ---------------------------------------------------------------- the adapter table

let adapterCache = null;
// The built table beside this script (scripts/tool-adapters.js builds it from meta/tool-adapters.json).
function readAdapters()
{
    if (!adapterCache) adapterCache = JSON.parse(fs.readFileSync(ADAPTERS, 'utf8'));
    return adapterCache;
}
const isOwn = (type) => String(type).startsWith('own:');

// ---------------------------------------------------------------- the doc

// The doc where the other preferences docs are looked for: this checkout, then a linked worktree's main checkout. A doc
// that is a link is never read and never passed over for another copy - the start line pastes its purposes, and a cloned
// repo could point one anywhere (the rule preferences.js keeps, audit 2026-10-21 PF-1).
function readToolsDoc(projectRoot)
{
    for (const dir of prefs.prefsDirs(projectRoot))
    {
        const abs = path.join(dir, TOOLS_DOC);
        if (isLink(abs)) return null;
        const text = readText(abs);
        if (text !== null) return { text, abs, rel: shown(projectRoot, abs) };
    }
    return null;
}

// One `Order:` rank: a built-in alone, or a type followed by the tools of it that serve the job.
function parseRank(text, builtins)
{
    const t = String(text).trim();
    const m = /^(\S+)(?:\s+(.*))?$/.exec(t);
    if (!m || !TYPE.test(m[1])) return { error: `rank '${t}' is not '<type> <tool>, ...' or a built-in` };
    const rest = (m[2] || '').trim();
    if (builtins.includes(m[1])) return rest ? { error: `${m[1]} is a built-in and takes no tools` } : { rank: { kind: 'builtin', name: m[1] } };
    const tools = rest ? rest.split(',').map((x) => x.trim()) : [];
    if (tools.some((x) => !TOOL.test(x))) return { error: `rank '${t}' is not '<type> <tool>, ...' or a built-in` };
    return { rank: { kind: 'server', type: m[1], tools } };
}

// The doc's entries with their ranks and deny lists; `problems` are the ranks that do not parse.
function parseToolsDoc(text, adapters = readAdapters())
{
    const builtins = adapters.builtins || [];
    const problems = [];
    const entries = prefs.parseSections(text, TOOLS_FIELD).map((s) =>
    {
        const f = s.fields;
        const label = s.id || `\`## ${s.heading}\``;
        const ranks = [];
        if (f.Order !== undefined)
            for (const part of String(f.Order).split('>'))
            {
                const r = parseRank(part, builtins);
                if (r.error) problems.push(`${label}: ${r.error}`);
                else ranks.push(r.rank);
            }
        const deny = String(f.Deny || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) =>
        {
            const [type, tool] = x.split(/\s+/);
            return { type, tool: tool || null };
        });
        return {
            id: s.id, heading: s.heading, job: f.Job === undefined ? null : f.Job.trim(), hasOrder: f.Order !== undefined, ranks,
            purpose: f.Purpose || '', held: String(f.Held || '').split(',').map((x) => x.trim()).filter(Boolean), deny, why: f.Why || '',
        };
    });
    return { entries, problems };
}

// The inventory server an own: type names on this machine, or null.
const ownServer = (inventory, type) => Object.values((inventory && inventory.servers) || {}).find((s) => s && s.type === type) || null;

// Problems fail lint; notes are true of this machine only (a teammate's own: type) or are a choice worth naming.
// `shapeOnly` leaves out what is true of this machine or this release - a ranked tool its server or pin lacks: the start
// line skips that rank and names it, and only a doc whose shape is broken loses the defaults.
function lintToolsDoc(text, { adapters = readAdapters(), inventory = null, shapeOnly = false } = {})
{
    const problems = [];
    const notes = [];
    const body = String(text || '');
    if (body.length > TOOLS_CAP) problems.push(`${TOOLS_DOC} is ${body.length} chars - the cap is ${TOOLS_CAP}`);
    const parsed = parseToolsDoc(body, adapters);
    problems.push(...parsed.problems);
    // An empty file, or text not in the shape, is broken - read as a doc ranking nothing, the defaults would fill every job.
    if (!parsed.entries.length) problems.push(`${TOOLS_DOC} holds no \`## T<n>\` entry - rank a job through /capture-preferences tools, or remove the file for the stack's defaults`);
    const types = adapters.types || {};
    const denied = parsed.entries.filter((e) => e.job === 'deny').flatMap((e) => e.deny);
    const jobs = new Map();
    for (const e of parsed.entries)
    {
        if (!e.id) { problems.push(`\`## ${e.heading}\` has no T<n> id`); continue; }
        if (!e.id.startsWith('T')) { problems.push(`${e.id} is not a T<n> id - this doc's entries are T1, T2, ...`); continue; }
        if (!e.job) { problems.push(`${e.id}: no Job: line`); continue; }
        if (e.job === 'deny')
        {
            if (e.hasOrder) problems.push(`${e.id}: the deny entry takes Deny:, not Order:`);
            if (!e.deny.length) problems.push(`${e.id}: no Deny: line`);
            for (const d of e.deny) if (!types[d.type] && !isOwn(d.type)) problems.push(`${e.id}: ${d.type} is neither a known type nor own:<label>`);
            continue;
        }
        if (!e.hasOrder) { problems.push(`${e.id}: no Order: line`); continue; }
        if (jobs.has(e.job)) problems.push(`${e.id}: ${e.job} is already ${jobs.get(e.job)}'s job`);
        else jobs.set(e.job, e.id);
        for (const r of e.ranks)
        {
            if (r.kind !== 'server') continue;
            const known = types[r.type];
            if (!known && !isOwn(r.type)) { problems.push(`${e.id}: ${r.type} is neither a known type nor own:<label>`); continue; }
            if (!r.tools.length) { problems.push(`${e.id}: ${r.type} names no tool - a server rank is the type and the tools of it that serve the job`); continue; }
            if (shapeOnly) { /* a tool's presence is this machine's or this pin's fact */ }
            else if (known)
            {
                for (const tool of r.tools) if (!known.tools.includes(tool)) problems.push(`${e.id}: ${r.type} ${tool} is not a tool of ${r.type} at ${known.version}`);
            }
            else
            {
                const server = ownServer(inventory, r.type);
                if (!server) notes.push(`${e.id}: ${r.type} has no inventory entry here - run /capture-preferences tools on this machine`);
                else for (const tool of r.tools) if (!(server.tools && server.tools[tool])) problems.push(`${e.id}: ${r.type} ${tool} is not a tool of ${r.type} here`);
            }
            for (const tool of r.tools)
                if (denied.some((d) => d.type === r.type && (!d.tool || d.tool === tool))) notes.push(`${e.id}: ${r.type} ${tool} is also denied - agents skip that rank`);
        }
    }
    return { problems, notes };
}

// The id a new entry takes: past every id in use and every retired one.
function nextToolsId(text)
{
    const used = [...prefs.parseSections(text, TOOLS_FIELD).map((s) => s.id), ...prefs.retiredIds(text)]
        .filter((id) => id && id.startsWith('T')).map((id) => Number(id.slice(1))).filter(Number.isInteger);
    return `T${used.length ? Math.max(...used) + 1 : 1}`;
}

// ---------------------------------------------------------------- the inventory file

const inventoryPath = (projectRoot) => path.resolve(projectRoot, prefs.dataRoot(projectRoot), 'state', 'tools-inventory.json');
// The inventory, null when there is none, 'garbage' when the file is not one.
function readInventory(projectRoot)
{
    const text = readText(inventoryPath(projectRoot));
    if (text === null) return null;
    try
    {
        const inv = JSON.parse(text);
        return inv && typeof inv === 'object' && inv.servers && typeof inv.servers === 'object' ? inv : 'garbage';
    }
    catch { return 'garbage'; }
}
const usableInventory = (inv) => (inv && inv !== 'garbage' ? inv : null);
// Written beside itself and renamed over the file, so a reader never meets half an inventory.
function writeInventory(projectRoot, inventory)
{
    const file = inventoryPath(projectRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- what this project reaches

const accountFileOf = (env = process.env) => path.join(env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');

// One scope's registrations, read-only, judged as scripts/install/mcp.js registrationsAt judges them (a test holds the
// two equal): `claude mcp get` would start the server to health-check it, and a known type is never started. The account
// file is the CLI's own and whole only as an object; a 0-byte, array or scalar one is unreadable.
function registrationsAt(scope, { projectRoot, accountFile })
{
    const file = scope === 'project' ? path.join(projectRoot, '.mcp.json') : accountFile;
    let data;
    try { const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); data = raw.trim() ? JSON.parse(raw) : scope === 'project' ? {} : null; }
    catch (err) { return { state: err.code === 'ENOENT' ? 'absent' : 'unreadable', servers: {} }; }
    if (scope !== 'project' && (!data || typeof data !== 'object' || Array.isArray(data))) return { state: 'unreadable', servers: {} };
    let servers = data && data.mcpServers;
    if (scope === 'local')
    {
        const projects = (data && data.projects) || {};
        let real = projectRoot;
        try { real = fs.realpathSync(projectRoot); } catch { /* the path as given */ }
        servers = (projects[projectRoot] || projects[real] || {}).mcpServers;
    }
    return { state: 'read', servers: servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {} };
}
function registrations({ projectRoot, accountFile = accountFileOf() })
{
    return Object.fromEntries(['project', 'user', 'local'].map((scope) => [scope, registrationsAt(scope, { projectRoot, accountFile })]));
}

const readJsonFile = (file) => { try { return JSON.parse((readText(file) || 'null').replace(/^\uFEFF/, '')); } catch { return null; } };
// `enabledPlugins` as the settings resolve it for this project: the account file, then the project's settings.json, then
// its settings.local.json, the later winning - the order capture-awareness's inventory reads them in.
function enabledPlugins(projectRoot, env = process.env)
{
    const state = new Map();
    const account = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
    for (const file of [account, path.join(projectRoot, '.claude', 'settings.json'), path.join(projectRoot, '.claude', 'settings.local.json')])
    {
        const data = readJsonFile(file);
        const map = data && typeof data === 'object' ? data.enabledPlugins : null;
        if (map && typeof map === 'object' && !Array.isArray(map))
            for (const [id, on] of Object.entries(map)) state.set(String(id).split('@')[0], on === true);
    }
    return state;
}

// `claude plugin list --json`: one row per plugin name, its narrowest install scope deciding (local, then project, then
// user), another project's project-scope row left out - the reading capture-awareness's inventory makes of it.
const SCOPES = ['local', 'project', 'user', 'managed'];
const scopeRank = (row) => (SCOPES.includes(row.scope) ? SCOPES.indexOf(row.scope) : (row.projectPath ? 1 : 2));
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
function pluginRows(out, projectRoot)
{
    let rows;
    try { const data = JSON.parse(out); rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : []); }
    catch { return []; }
    const here = realOf(projectRoot);
    const byName = new Map();
    for (const e of rows)
    {
        if (!e || typeof e !== 'object') continue;
        const name = String(e.id || e.name || '').split('@')[0];
        if (!name) continue;
        if (e.projectPath && realOf(String(e.projectPath)) !== here) continue;
        const row = { name, enabled: e.enabled === true, installPath: e.installPath ? String(e.installPath) : null, scope: e.scope ? String(e.scope) : null,
            projectPath: e.projectPath ? String(e.projectPath) : null, servers: e.mcpServers && typeof e.mcpServers === 'object' && !Array.isArray(e.mcpServers) ? e.mcpServers : {} };
        const prev = byName.get(name);
        if (!prev || scopeRank(row) < scopeRank(prev)) byName.set(name, row);
    }
    return [...byName.values()];
}
// A plugin server's launch: the listing's own when it carries one, else the plugin's .mcp.json, its plugin.json, or its
// marketplace entry's inline mcpServers (the stack's own shape).
function pluginDef(row, server)
{
    const has = (d) => d && typeof d === 'object' && (d.command || d.url);
    if (has(row.servers[server])) return row.servers[server];
    if (!row.installPath) return {};
    const fromMap = (data) => { const map = data && (data.mcpServers || data); return map && typeof map === 'object' && has(map[server]) ? map[server] : null; };
    const mcpJson = fromMap(readJsonFile(path.join(row.installPath, '.mcp.json')));
    if (mcpJson) return mcpJson;
    const manifest = readJsonFile(path.join(row.installPath, '.claude-plugin', 'plugin.json'));
    if (manifest && manifest.mcpServers && typeof manifest.mcpServers === 'object' && has(manifest.mcpServers[server])) return manifest.mcpServers[server];
    const market = readJsonFile(path.join(row.installPath, '.claude-plugin', 'marketplace.json'));
    const entry = market && Array.isArray(market.plugins) ? market.plugins.find((p) => p && p.name === row.name) : null;
    return (entry && entry.mcpServers && has(entry.mcpServers[server]) && entry.mcpServers[server]) || {};
}
function claudePluginList(projectRoot)
{
    const plan = client.commandPlan('claude', ['plugin', 'list', '--json'], { cwd: projectRoot });
    if (plan.why) return Promise.resolve({ ok: false });
    const r = spawnSync(plan.cmd, plan.args, { ...plan.opts, cwd: projectRoot, encoding: 'utf8', timeout: PLUGIN_LIST_TIMEOUT_MS, windowsHide: true });
    return Promise.resolve(r.status === 0 && String(r.stdout || '').trim() ? { ok: true, out: r.stdout } : { ok: false });
}

// ---------------------------------------------------------------- one server: its type, its prefix, its registration

// A launch word naming the package, bare or at a version (`pkg@1.2.3`, `pkg==1.2.3`, `pkg[extra]==1.2.3`).
function packageVersion(word, pkg)
{
    if (word === pkg) return { version: null };
    if (!word.startsWith(pkg)) return null;
    const m = /^(?:\[[^\]]*\])?(?:@|==)([^\s@=]+)$/.exec(word.slice(pkg.length));
    return m ? { version: m[1] } : null;
}
// The known type a registration is, and whether it runs at the table's pinned version - read from the table, never started.
function classify(def, { plugin = null, adapters = readAdapters() } = {})
{
    const types = Object.entries(adapters.types || {});
    if (plugin) for (const [type, t] of types) if (t.stack.includes(plugin)) return { type, version: t.version, atPin: true };
    const d = def && typeof def === 'object' ? def : {};
    let host = null;
    try { host = d.url ? new URL(String(d.url)).host : null; } catch { host = null; }
    if (host) for (const [type, t] of types) if (t.hosts.includes(host)) return { type, version: null, atPin: t.version === null };
    const words = [d.command, ...(Array.isArray(d.args) ? d.args : [])].filter((w) => w !== undefined && w !== null).map(String);
    for (const [type, t] of types)
        for (const pkg of t.packages)
            for (const word of words)
            {
                const m = packageVersion(word, pkg);
                if (m) return { type, version: m.version, atPin: m.version !== null && m.version === t.version };
            }
    return { type: null, version: null, atPin: false };
}
// What a refresh compares: the launch, never its env or headers - a rotated key lists the same tools.
function registrationHash(def)
{
    const d = def && typeof def === 'object' ? def : {};
    const shape = { type: d.type || null, command: d.command || null, args: Array.isArray(d.args) ? d.args.map(String) : [], url: d.url || null };
    return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}
// The name Claude Code gives a server's tools: `mcp__<server>__`, a plugin's `mcp__plugin_<plugin>_<server>__`.
const safeName = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, '_');
const prefixOf = (name, plugin) => (plugin ? `mcp__plugin_${safeName(plugin)}_${safeName(name)}__` : `mcp__${safeName(name)}__`);
const ownLabel = (name) => `own:${String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'}`;
const tableTools = (t) => Object.fromEntries(t.tools.map((n) => [n, { readOnly: null, destructive: t.edit.includes(n) ? true : null, target: null }]));
const listedTools = (list) => Object.fromEntries(list.map((t) => [t.name, { readOnly: t.readOnly, destructive: t.destructive, target: t.target }]));
const namesTools = (names) => Object.fromEntries([...names].sort().map((n) => [n, { readOnly: null, destructive: null, target: null }]));

// Every server this project reaches, by the name its tools carry. A name at several scopes is taken where Claude Code
// takes it - local, then project, then user; an enabled plugin's servers sit under their own plugin prefix.
async function candidates({ projectRoot, env, listPlugins, lines })
{
    const regs = registrations({ projectRoot, accountFile: accountFileOf(env) });
    const byName = new Map();
    for (const scope of ['user', 'project', 'local'])
        for (const [name, def] of Object.entries(regs[scope].servers)) byName.set(name, { name, scope, plugin: null, pluginRoot: null, def: def && typeof def === 'object' ? def : {} });
    const out = [...byName.values()];
    const listing = await listPlugins(projectRoot);
    if (listing && listing.ok)
    {
        for (const row of pluginRows(listing.out, projectRoot))
        {
            if (!row.enabled) continue;
            for (const server of Object.keys(row.servers)) out.push({ name: server, scope: 'plugin', plugin: row.name, pluginRoot: row.installPath, def: pluginDef(row, server) });
        }
    }
    else
    {
        lines.push('tools: the claude CLI did not answer - plugin servers taken from the settings\' enabledPlugins');
        const stackNames = new Set(Object.values(readAdapters().types || {}).flatMap((t) => t.stack));
        for (const [name, on] of enabledPlugins(projectRoot, env)) if (on && stackNames.has(name)) out.push({ name, scope: 'plugin', plugin: name, pluginRoot: null, def: {} });
    }
    return out;
}

// The inventory: a known type at its pin from the table, every other server listed once (all in parallel, each capped),
// a failed one from the session's own names, and the servers only the session lists (a claude.ai connector) from those.
async function takeInventory({ projectRoot, env = process.env, adapters = readAdapters(), sessionTools = [], listPlugins = claudePluginList, list = client.listServer, now = () => new Date().toISOString(), previous = null, labels = {} })
{
    const lines = [];
    const session = new Map();
    for (const raw of sessionTools)
    {
        const name = String(raw || '').trim();
        const at = name.lastIndexOf('__');
        if (!name.startsWith('mcp__') || at <= 'mcp_'.length) continue;
        const prefix = name.slice(0, at + 2);
        if (!session.has(prefix)) session.set(prefix, new Set());
        session.get(prefix).add(name.slice(at + 2));
    }
    const was = (prefix) => (previous && previous.servers && previous.servers[prefix]) || null;
    const found = await candidates({ projectRoot, env, listPlugins, lines });
    const servers = {};
    await Promise.all(found.map(async (c) =>
    {
        const prefix = prefixOf(c.name, c.plugin);
        const cls = classify(c.def, { plugin: c.plugin, adapters });
        const keptType = was(prefix) && isOwn(was(prefix).type) ? was(prefix).type : null;
        const entry = {
            name: c.name, prefix, scope: c.scope, ...(c.plugin ? { plugin: c.plugin } : {}),
            type: cls.type || labels[prefix] || keptType || ownLabel(c.name), version: cls.version, registration: registrationHash(c.def),
        };
        if (cls.type && cls.atPin) Object.assign(entry, { listed: 'table', tools: tableTools(adapters.types[cls.type]) });
        else
        {
            const r = await list(c.def, { env, pluginRoot: c.pluginRoot, timeoutMs: LIST_TIMEOUT_MS });
            if (r.ok) Object.assign(entry, { listed: 'exchange', tools: listedTools(r.tools) });
            else if (session.has(prefix)) Object.assign(entry, { listed: 'session', why: r.why, tools: namesTools(session.get(prefix)) });
            else Object.assign(entry, { listed: 'failed', why: r.why, tools: {} });
        }
        servers[prefix] = entry;
    }));
    for (const [prefix, names] of session)
    {
        if (servers[prefix]) continue;
        const name = prefix.slice('mcp__'.length, -2);
        servers[prefix] = { name, prefix, scope: 'session', type: labels[prefix] || (was(prefix) && isOwn(was(prefix).type) ? was(prefix).type : ownLabel(name)), version: null, registration: null, listed: 'session', tools: namesTools(names) };
    }
    const sorted = Object.fromEntries(Object.keys(servers).sort().map((k) => [k, servers[k]]));
    for (const e of Object.values(sorted))
        lines.push(`tools: ${e.prefix} - ${e.type}${e.version ? ` ${e.version}` : ''} - ${Object.keys(e.tools).length} tools (${e.listed}${e.why && e.listed === 'failed' ? `: ${e.why}` : ''})`);
    return { inventory: { version: 1, captured: String(now()).slice(0, 10), servers: sorted }, lines };
}

// ---------------------------------------------------------------- the refresh on update

// The inventory brought up to date without a capture: an older release's server plugin and every registration of a known
// type at its pin are re-read from the table, a registration whose launch changed is listed again (all in parallel, each
// capped), one that is gone leaves, and every other server is never started. A server that cannot be listed keeps its entry and its old
// registration, so the next update tries again. Written only when something changed; a scope it cannot read keeps its own.
async function refreshInventory({ projectRoot, env = process.env, adapters = readAdapters(), list = client.listServer, listPlugins = claudePluginList })
{
    const raw = readInventory(projectRoot);
    if (raw === null) return { state: 'none', lines: [] };
    if (raw === 'garbage') return { state: 'none', lines: ['!! tools: tools-inventory.json is not valid JSON - re-run /capture-preferences tools'] };
    const accountFile = accountFileOf(env);
    const scopes = new Map();
    const scopeOf = (scope) => { if (!scopes.has(scope)) scopes.set(scope, registrationsAt(scope, { projectRoot, accountFile })); return scopes.get(scope); };
    // The promise is kept, not its answer: the entries ask in parallel, and the listing is one CLI start of up to 45 s.
    let plugins = null;
    const pluginsOf = () => (plugins ||= Promise.resolve(listPlugins(projectRoot)).then((r) => (r && r.ok ? pluginRows(r.out, projectRoot) : 'unread'), () => 'unread'));
    const stackType = (e) => (e.scope === 'plugin' && e.plugin ? classify({}, { plugin: e.plugin, adapters }).type : null);
    // The current launch: a def, 'gone', or 'unread' (its scope or the plugin listing could not be read).
    async function current(e)
    {
        if (e.scope === 'plugin')
        {
            const rows = await pluginsOf();
            if (rows === 'unread') return 'unread';
            const row = rows.find((r) => r.name === e.plugin);
            return row && row.servers[e.name] ? { def: pluginDef(row, e.name), pluginRoot: row.installPath } : 'gone';
        }
        const regs = scopeOf(e.scope);
        if (regs.state === 'unreadable') return 'unread';
        const def = regs.servers[e.name];
        return def === undefined ? 'gone' : { def: def && typeof def === 'object' ? def : {}, pluginRoot: null };
    }
    const fromTable = ({ why, ...e }, type, extra) => ({ ...e, type, version: adapters.types[type].version, ...extra, listed: 'table', tools: tableTools(adapters.types[type]) });
    async function next(e)
    {
        if (!e || typeof e !== 'object' || !e.prefix || e.scope === 'session' || !e.registration) return { keep: true };
        const own = stackType(e);
        if (own) return { entry: fromTable(e, own, { registration: e.registration }), how: 'table' };
        const now = await current(e);
        if (now === 'unread') return { keep: true };
        if (now === 'gone') return { gone: true };
        const hash = registrationHash(now.def);
        const cls = classify(now.def, { plugin: e.plugin || null, adapters });
        if (cls.type && cls.atPin) return { entry: { ...fromTable(e, cls.type, { registration: hash }), version: cls.version }, how: 'table' };
        if (hash === e.registration && e.listed !== 'table') return { keep: true };
        const r = await list(now.def, { env, pluginRoot: now.pluginRoot, timeoutMs: LIST_TIMEOUT_MS });
        if (!r.ok) return { keep: true, failed: r.why || 'no answer' };
        const { why, ...rest } = e;
        return { entry: { ...rest, type: cls.type || (isOwn(e.type) ? e.type : ownLabel(e.name)), version: cls.version, registration: hash, listed: 'exchange', tools: listedTools(r.tools) }, how: 'exchange' };
    }
    const keys = Object.keys(raw.servers);
    const results = await Promise.all(keys.map((k) => next(raw.servers[k])));
    const lines = [];
    const servers = {};
    const touched = [];
    keys.forEach((k, i) =>
    {
        const e = raw.servers[k];
        const r = results[i];
        if (r.gone) { lines.push(`tools: ${e.prefix} is no longer registered - dropped from the inventory`); return; }
        if (r.keep)
        {
            if (r.failed) lines.push(`!! tools: ${e.prefix} could not be re-listed (${r.failed}) - its recorded tools stand`);
            servers[k] = e;
            return;
        }
        servers[k] = r.entry;
        if (JSON.stringify(r.entry) === JSON.stringify(e)) return;
        touched.push(r.entry);
        const n = Object.keys(r.entry.tools).length;
        lines.push(r.how === 'table' ? `tools: ${e.prefix} re-read from the table - ${n} tools` : `tools: ${e.prefix} re-listed - ${n} tools`);
    });
    const changed = touched.length > 0 || Object.keys(servers).length !== keys.length;
    // A ranked tool the new listing lacks: named once here, for the servers this run changed - the start line skips its rank.
    const doc = touched.length ? readToolsDoc(projectRoot) : null;
    if (doc)
    {
        const said = new Set();
        for (const entry of parseToolsDoc(doc.text, adapters).entries)
            for (const rank of entry.ranks || [])
            {
                if (rank.kind !== 'server') continue;
                const sv = touched.find((t) => t.type === rank.type);
                for (const tool of sv ? rank.tools : [])
                {
                    const key = `${rank.type} ${tool}`;
                    if (sv.tools[tool] || said.has(key)) continue;
                    said.add(key);
                    lines.push(`!! tools: ${key} is gone from ${sv.prefix} - its rank is skipped until /capture-preferences tools runs again`);
                }
            }
    }
    if (!changed) return { state: 'unchanged', lines };
    writeInventory(projectRoot, { ...raw, servers });
    return { state: 'refreshed', lines };
}

// ---------------------------------------------------------------- the order each actor is told

// What the main session reaches: every built-in, each enabled stack plugin's server, each project registration of a known
// type, and each inventory server still registered - a plugin's while its plugin stays enabled, a project one while
// .mcp.json still holds its name. A type served twice is taken where first found, the stack's own plugin first. The
// account file is not read: it is the CLI's and can run to megabytes, and the hook runs at every start.
function mainReach({ projectRoot, env = process.env, adapters = readAdapters(), inventory = null })
{
    const types = adapters.types || {};
    const inv = (inventory && inventory !== 'garbage' && inventory.servers) || {};
    const servers = new Map();
    const add = (type, prefix, fallback) =>
    {
        if (servers.has(type)) return;
        const listed = inv[prefix] && Object.keys(inv[prefix].tools || {});
        servers.set(type, { prefix, tools: new Set(listed && listed.length ? listed : fallback) });
    };
    const enabled = enabledPlugins(projectRoot, env);
    for (const [type, t] of Object.entries(types))
        for (const plugin of t.stack) if (enabled.get(plugin) === true) add(type, prefixOf(plugin, plugin), t.tools);
    const project = registrationsAt('project', { projectRoot, accountFile: accountFileOf(env) }).servers;
    for (const [name, def] of Object.entries(project))
    {
        const c = classify(def, { adapters });
        if (c.type) add(c.type, prefixOf(name), types[c.type].tools);
    }
    for (const sv of Object.values(inv))
    {
        if (!sv || !sv.type || !sv.prefix) continue;
        if (sv.plugin && enabled.get(sv.plugin) !== true) continue;
        if (sv.scope === 'project' && !Object.prototype.hasOwnProperty.call(project, sv.name)) continue;
        add(sv.type, sv.prefix, []);
    }
    return { builtins: new Set(adapters.builtins || []), servers, load: true };
}

// A frontmatter list, as a comma line or a YAML list under the key; null when the key is absent.
function frontmatterList(frontmatter, key)
{
    const text = String(frontmatter || '');
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const lines = (block ? block[1] : text).split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at < 0) return null;
    const inline = lines[at].slice(key.length + 1).trim();
    if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const out = [];
    for (const l of lines.slice(at + 1))
    {
        const m = /^\s+-\s+(.+?)\s*$/.exec(l);
        if (!m) break;
        out.push(m[1].replace(/^['"]|['"]$/g, ''));
    }
    return out;
}
// What a seat reaches: what its `tools:` grants of the main reach - a whole server by its prefix, one tool by its full
// name, a built-in by its name - less its `disallowedTools`. A seat with no `tools:` line holds every tool, its MCP ones
// deferred, so it loads them as the main session does; a granted MCP tool is loaded already.
function seatReach(frontmatter, main)
{
    const granted = frontmatterList(frontmatter, 'tools');
    const denied = new Set(frontmatterList(frontmatter, 'disallowedTools') || []);
    const whole = (set, prefix) => set.has(prefix.slice(0, -2)) || set.has(`${prefix}*`);
    const grant = granted ? new Set(granted) : null;
    const builtins = new Set([...main.builtins].filter((b) => (!grant || grant.has(b)) && !denied.has(b)));
    const servers = new Map();
    for (const [type, sv] of main.servers)
    {
        if (whole(denied, sv.prefix)) continue;
        const tools = new Set([...sv.tools].filter((t) => (!grant || whole(grant, sv.prefix) || grant.has(sv.prefix + t)) && !denied.has(sv.prefix + t)));
        if (tools.size) servers.set(type, { prefix: sv.prefix, tools });
    }
    return { builtins, servers, load: !granted, parent: main };
}

// The table's default order for each job that has one, as doc entries.
const defaultEntries = (adapters) => Object.entries(adapters.jobs || {}).filter(([, j]) => Array.isArray(j.default)).map(([job, j]) => ({
    id: null, heading: job, job, hasOrder: true, purpose: '', held: [], deny: [], why: '', isDefault: true,
    ranks: j.default.map((x) => ((adapters.builtins || []).includes(x) ? { kind: 'builtin', name: x }
        : { kind: 'server', type: x, tools: (((adapters.types || {})[x] || {}).jobs || {})[job] || [] })),
}));

// Each job's ranks this actor can call, in the doc's order, and each rank it cannot with the reason. For an agent the
// deny list narrows the ranks, and a job left with no rank is left out whole - a seat is told only its own jobs. A job the
// user's doc ranks with nothing this actor reaches takes the stack's order for it (spec N1, N3): a seat would otherwise
// lose the job's line, and the main session its order.
function resolveOrder({ entries, adapters = readAdapters(), inventory = null, reach, agent = false })
{
    const types = adapters.types || {};
    const machine = reach.parent || reach;
    const denied = agent ? entries.filter((e) => e.job === 'deny').flatMap((e) => e.deny) : [];
    const isDenied = (type, tool) => denied.some((d) => d.type === type && (!d.tool || d.tool === tool));
    const fallbacks = defaultEntries(adapters);
    const jobs = [];
    const seen = new Set();
    // One entry's ranks this actor reaches, and the ones it does not with the reason.
    const ranksOf = (e) =>
    {
        const ranks = [];
        const skipped = [];
        // A default rank the actor cannot reach is the normal state since the stack ships no server (2.10.1), so it is left
        // out silently; one the user's doc chose is named, and so is a default whose server is here but mismatched.
        const quiet = (why) => e.isDefault && (why === 'not on this machine' || why === 'not in your tools');
        const skip = (label, why) => { if (!quiet(why)) skipped.push({ label, why }); };
        for (const r of e.ranks)
        {
            if (r.kind === 'builtin')
            {
                // A deferred built-in is loaded through ToolSearch like a server's tools (final review B2), so its rank names it.
                if (reach.builtins.has(r.name)) ranks.push({ label: r.name, names: (adapters.deferred || []).includes(r.name) ? [r.name] : [], builtin: true });
                else skip(r.name, machine.builtins.has(r.name) ? 'not in your tools' : 'not on this machine');
                continue;
            }
            // A rank lint rejects (an unknown type, no tools) is named by lint, not here.
            if (!r.tools.length || (!types[r.type] && !isOwn(r.type))) continue;
            if (isOwn(r.type) && !ownServer(inventory, r.type)) { skip(r.type, 'no inventory entry here'); continue; }
            const at = machine.servers.get(r.type);
            if (!at) { skip(r.type, 'not on this machine'); continue; }
            const gone = r.tools.filter((t) => !at.tools.has(t));
            if (gone.length) { skip(`${r.type} ${gone.join(', ')}`, `gone from ${at.prefix}`); continue; }
            let names = r.tools;
            if (agent)
            {
                names = names.filter((t) => !isDenied(r.type, t));
                if (!names.length) { skip(r.type, 'denied to agents'); continue; }
            }
            const mine = reach.servers.get(r.type);
            names = mine ? names.filter((t) => mine.tools.has(t)) : [];
            if (!names.length) { skip(r.type, 'not in your tools'); continue; }
            ranks.push({ label: `${r.type} ${names.join(', ')}`, names: names.map((t) => mine.prefix + t) });
        }
        return { ranks, skipped };
    };
    for (const e of entries)
    {
        if (!e.job || e.job === 'deny' || !e.hasOrder || seen.has(e.job)) continue;
        seen.add(e.job);
        const job = { job: e.job, purpose: e.purpose || ((adapters.jobs || {})[e.job] || {}).purpose || '', ranks: [], skipped: [], isDefault: !!e.isDefault, fellBack: false };
        Object.assign(job, ranksOf(e));
        const fallback = !e.isDefault && !job.ranks.length ? fallbacks.find((d) => d.job === e.job) : null;
        const stand = fallback ? ranksOf(fallback) : null;
        if (stand && stand.ranks.length)
        {
            job.ranks = stand.ranks;
            job.fellBack = true;
            // A seat is told the order it can use, not the user's ranks it cannot.
            if (agent) job.skipped = [];
        }
        if (job.ranks.length || !agent) jobs.push(job);
    }
    return jobs;
}

const PROBLEM_LINES = 3;
// The start line: one line per job that has a rank, then what was skipped, the doc's problems and the suggestion.
function startLine({ jobs, docRel = null, defaults = false, problems = [], suggest = false, load = true, fillNote = true })
{
    const stated = jobs.filter((j) => j.ranks.length);
    const skipped = jobs.flatMap((j) => j.skipped);
    if (!stated.length && !skipped.length && !problems.length) return '';
    const filled = !defaults && stated.some((j) => j.isDefault) ? ' (the stack\'s defaults for the jobs it leaves out)' : '';
    const source = defaults ? `the stack's defaults (no ${TOOLS_DOC})` : `the user's, from ${docRel}${filled}`;
    const render = (withLoad) =>
    {
        const lines = [`Tool order - ${source}: in each job use the first rank that serves the target before the next.`];
        for (const j of stated)
        {
            const names = j.ranks.flatMap((r) => r.names);
            lines.push(`- ${j.job}${j.purpose ? ` (${j.purpose})` : ''}: ${j.ranks.map((r) => r.label).join(' > ')}.${withLoad && names.length ? ` Load: ToolSearch select:${names.join(',')}` : ''}`);
        }
        if (skipped.length) lines.push(`Skipped here: ${skipped.map((x) => `${x.label} (${x.why})`).join(', ')}.`);
        if (fillNote) for (const j of stated.filter((x) => x.fellBack)) lines.push(`Filled in: ${j.job} - your ranks reach nothing here, so the stack's order stands in; fix them with /capture-preferences tools.`);
        for (const p of problems.slice(0, PROBLEM_LINES)) lines.push(`Doc problem: ${p}`);
        if (problems.length > PROBLEM_LINES) lines.push(`... and ${problems.length - PROBLEM_LINES} more - run tools.js lint`);
        if (!load && stated.some((j) => j.ranks.some((r) => r.names.length && !r.builtin))) lines.push('Call them directly - your tools grant them.');
        if (load && !withLoad) lines.push('Load clauses cut for size: load a rank\'s tools with ToolSearch by name before its first call.');
        if (suggest) lines.push('The user can rank their own with /capture-preferences tools.');
        return lines;
    };
    // Past the line's cap the Load clauses go first, then the tail - the head keeps the jobs the doc ranks first.
    let lines = render(load);
    if (lines.join('\n').length > TOOLS_LINE_CAP) lines = render(false);
    if (lines.join('\n').length <= TOOLS_LINE_CAP) return lines.join('\n');
    const cut = `... cut at ${TOOLS_LINE_CAP} chars - run tools.js order for the whole order`;
    const kept = [];
    let size = cut.length;
    for (const l of lines)
    {
        if (size + l.length + 1 > TOOLS_LINE_CAP) break;
        kept.push(l);
        size += l.length + 1;
    }
    return [...kept, cut].join('\n');
}

// The one call the hooks make. `seat` is null for the main session, `{ frontmatter }` for a stack seat, and 'other' for a
// built-in seat or another plugin's, which reaches what the main session does. A valid doc keeps the defaults for the
// jobs it does not rank; a malformed one states only the entries that resolve, never a default that could outrank the
// user's choice. Never throws: a start line is never worth a failed start.
// Each job's order for one actor, with the doc and its problems - what the start line states and the modes lines read.
function orderFor({ projectRoot, env = process.env, seat = null })
{
    const adapters = readAdapters();
    const inventory = usableInventory(readInventory(projectRoot));
    const main = mainReach({ projectRoot, env, adapters, inventory });
    const reach = seat && typeof seat === 'object' ? seatReach(seat.frontmatter, main) : main;
    const agent = seat !== null && seat !== undefined;
    const doc = readToolsDoc(projectRoot);
    let entries = defaultEntries(adapters);
    let problems = [];
    if (doc)
    {
        const own = parseToolsDoc(doc.text, adapters).entries;
        problems = lintToolsDoc(doc.text, { adapters, inventory, shapeOnly: true }).problems;
        const ranked = new Set(own.map((e) => e.job));
        // An over-cap doc states nothing but its problem: its entries are what overran.
        entries = doc.text.length > TOOLS_CAP ? [] : problems.length ? own : [...own, ...entries.filter((e) => !ranked.has(e.job))];
    }
    return { jobs: resolveOrder({ entries, adapters, inventory, reach, agent }), doc, problems, reach, agent };
}

function toolsLine({ projectRoot, env = process.env, seat = null, suggest = false })
{
    try
    {
        const { jobs, doc, problems, reach, agent } = orderFor({ projectRoot, env, seat });
        return startLine({ jobs, docRel: doc ? doc.rel : null, defaults: !doc, problems: agent ? [] : problems, suggest: suggest && !agent, load: reach.load, fillNote: !agent });
    }
    catch { return ''; }
}

// One job's ranks for one actor, by label: whether the user's doc ranks it, and whether the stack's order stood in.
function jobOrder({ projectRoot, env = process.env, job, seat = null })
{
    const { jobs, doc } = orderFor({ projectRoot, env, seat });
    const found = jobs.find((j) => j.job === job);
    return { ranks: found ? found.ranks.map((r) => r.label) : [], own: !!found && !found.isDefault, fellBack: !!found && found.fellBack, docRel: doc ? doc.rel : null };
}

// True once per project while it has no doc: the start line then suggests the capture. The marker is written first; one
// that cannot be written still says yes, so an unwritable state folder costs a repeat, never the line.
function suggestOnce(projectRoot)
{
    if (readToolsDoc(projectRoot)) return false;
    const marker = path.resolve(projectRoot, prefs.dataRoot(projectRoot), 'state', 'tool-preferences', 'suggested');
    if (fs.existsSync(marker)) return false;
    try { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, `${new Date().toISOString()}\n`); } catch { /* said again next start */ }
    return true;
}

// The `!! tools:` rows validate prints: a ranked type this machine cannot serve, and a registration changed since the
// inventory recorded it. The account file is read here - validate is asked for, not run at every start.
function validateRows(projectRoot, env = process.env)
{
    const rows = [];
    const raw = readInventory(projectRoot);
    if (raw === 'garbage') rows.push('!! tools: tools-inventory.json is not valid JSON - re-run /capture-preferences tools');
    const inventory = usableInventory(raw);
    const adapters = readAdapters();
    const doc = readToolsDoc(projectRoot);
    if (doc)
    {
        const main = mainReach({ projectRoot, env, adapters, inventory });
        const named = new Set();
        for (const e of parseToolsDoc(doc.text, adapters).entries)
        {
            if (!e.id || e.job === 'deny') continue;
            for (const r of e.ranks)
            {
                if (r.kind !== 'server' || named.has(`${e.id} ${r.type}`)) continue;
                named.add(`${e.id} ${r.type}`);
                if (isOwn(r.type) && !ownServer(inventory, r.type)) rows.push(`!! tools: ${e.id} ranks ${r.type}, which has no inventory entry on this machine - run /capture-preferences tools`);
                else if ((adapters.types[r.type] || isOwn(r.type)) && !main.servers.has(r.type)) rows.push(`!! tools: ${e.id} ranks ${r.type}, which this machine does not reach - add the server or change the rank through /capture-preferences tools`);
            }
        }
    }
    if (inventory)
    {
        const regs = registrations({ projectRoot, accountFile: accountFileOf(env) });
        for (const sv of Object.values(inventory.servers || {}))
        {
            if (!sv || !sv.registration || !regs[sv.scope] || regs[sv.scope].state === 'unreadable') continue;
            if (registrationHash(regs[sv.scope].servers[sv.name]) !== sv.registration) rows.push(`!! tools: ${sv.prefix} changed since the inventory was taken - run /alfred-code:update or /capture-preferences tools`);
        }
    }
    return rows;
}

// ---------------------------------------------------------------- the command line

function lintCommand(projectRoot)
{
    const doc = readToolsDoc(projectRoot);
    if (!doc) { console.log(`tools: no ${TOOLS_DOC} - the stack's defaults apply`); return 0; }
    const { problems, notes } = lintToolsDoc(doc.text, { inventory: usableInventory(readInventory(projectRoot)) });
    for (const p of problems) console.log(`${doc.rel}: ${p}`);
    for (const n of notes) console.log(`note: ${n}`);
    console.log(problems.length ? `tools: ${problems.length} problem(s)` : 'tools: ok');
    return problems.length ? 1 : 0;
}

async function inventoryCommand(projectRoot, sessionFile, labelArgs)
{
    const labels = {};
    for (const a of labelArgs)
    {
        const m = /^(mcp__[^=]+__)=(own:[a-z0-9][\w-]*)$/.exec(a);
        if (!m) { console.error(`tools: --label takes <prefix>=own:<label>, not '${a}'`); return 2; }
        labels[m[1]] = m[2];
    }
    const sessionTools = sessionFile ? String(readText(sessionFile) || '').split(/[\s,]+/).filter(Boolean) : [];
    const { inventory, lines } = await takeInventory({ projectRoot, sessionTools, labels, previous: usableInventory(readInventory(projectRoot)) });
    for (const l of lines) console.log(l);
    writeInventory(projectRoot, inventory);
    console.log(`tools: inventory written - ${shown(projectRoot, inventoryPath(projectRoot))}`);
    return 0;
}

async function refreshCommand(projectRoot)
{
    const { lines } = await refreshInventory({ projectRoot });
    for (const l of lines) console.log(l);
    return 0;
}

function main(argv)
{
    const [cmd, ...rest] = argv;
    const value = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
    const values = (name) => rest.flatMap((a, i) => (a === name && rest[i + 1] !== undefined ? [rest[i + 1]] : []));
    const projectRoot = path.resolve(value('--project') || process.cwd());
    if (cmd === 'lint') return lintCommand(projectRoot);
    if (cmd === 'inventory') return inventoryCommand(projectRoot, value('--session-tools'), values('--label'));
    if (cmd === 'order')
    {
        const seatFile = value('--seat');
        const seat = seatFile ? { frontmatter: readText(path.resolve(seatFile)) || '' } : null;
        const text = toolsLine({ projectRoot, seat });
        if (text) console.log(text);
        return 0;
    }
    if (cmd === 'refresh') return refreshCommand(projectRoot);
    if (cmd === 'validate')
    {
        for (const row of validateRows(projectRoot)) console.log(row);
        return 0;
    }
    if (cmd === 'next')
    {
        const doc = readToolsDoc(projectRoot);
        console.log(`Next: ${nextToolsId(doc ? doc.text : '')}`);
        return 0;
    }
    console.error('usage: tools.js lint | next | inventory [--session-tools <file>] [--label <prefix>=own:<label>] | order [--seat <file>] | validate | refresh  [--project <dir>]');
    return 2;
}

module.exports = {
    TOOLS_DOC, TOOLS_CAP, TOOLS_LINE_CAP, TOOLS_FIELD, PREFS_DIR, LIST_TIMEOUT_MS,
    readAdapters, readToolsDoc, parseToolsDoc, lintToolsDoc, nextToolsId, inventoryPath, readInventory, writeInventory,
    accountFileOf, registrations, enabledPlugins, pluginRows, classify, registrationHash, prefixOf, takeInventory, refreshInventory,
    mainReach, seatReach, resolveOrder, startLine, orderFor, toolsLine, jobOrder, suggestOnce, validateRows,
};

if (require.main === module)
{
    // A refresh the update stops at its cap, or a capture the user interrupts, takes the servers it is listing with it -
    // each leads a process group of its own - then dies of the signal as it would have.
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { client.stopAll(); process.kill(process.pid, signal); });
    Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
}
