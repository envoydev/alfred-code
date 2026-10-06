#!/usr/bin/env node
// capabilities-inventory.js - the whole mechanical half of /alfred-capture-agent-capabilities in ONE node
// pass: the precheck, the full inventory with a printed COUNT per layer (skills, seats, rules, MCP,
// plugins), the LIVE `claude mcp list`, the paste-ready MCP routing rows, the compare verdict that
// authorizes the write, and the post-write --verify. Node built-ins only - no install, no network,
// and no per-skill fork (the shell loop it replaces measured 4m13s on Git Bash).
//
// Usage, from the project root:
//   node .claude/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory.js
//   node .../capabilities-inventory.js --body <composed-rule-file|->     the compare verdict
//   node .../capabilities-inventory.js --verify <rule-file>             exits 1 on failure
//   --project <dir>   the project root (default: the current directory)
//
// Every line it prints is a report field. A claim with no printed line behind it is not one.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const TEMPLATE_REL = 'references/generated-rule-template.md';
const RULE_REL = '.claude/rules/alfred-project-agent-capabilities.md';
// The orchestration skills that carry NO `disable-model-invocation` by design, so the architecture and
// code-quality loops can invoke them - they belong with the slash-only set in the rule, marked as the exception.
const MODEL_INVOCABLE_BY_DESIGN = new Set(['alfred-capture-architecture', 'alfred-capture-architecture-quality', 'alfred-capture-code-quality']);
// One catalog server expands into one registration per kept browser; every installed-name reader
// maps them back to the catalog name, and so does the routing row.
const PLAYWRIGHT_SERVER = /^browser-(chrome|msedge|firefox|webkit)$/;
const SEAT_ROLES = ['-solution-designer', '-implementer', '-verifier'];
const REQUIRED_HEADINGS = ['## Orchestration skills', '## Subagent seats', '## MCP routing'];

// ---------------------------------------------------------------- small IO helpers (all fail-soft)

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readDir = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
const statOf = (p) => { try { return fs.statSync(p); } catch { return null; } };
const slash = (p) => p.split(path.sep).join('/');
const relTo = (root, p) => slash(path.relative(root, p));
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function argOf(flag)
{
    const i = process.argv.indexOf(flag);
    return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function today()
{
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------- frontmatter, parsed by NODE

// A PyYAML import is not available everywhere and a run that died on ModuleNotFoundError still
// reported 'frontmatter parses' - so the parse is here, over the flat `key: value` block these
// rules and skills actually carry, and it says WHY it failed.
function parseFrontmatter(text)
{
    if (text === null) return { ok: false, error: 'file unreadable' };
    const lines = text.split(/\r?\n/);
    if (lines[0] !== '---') return { ok: false, error: 'no opening `---` on line 1' };
    const end = lines.indexOf('---', 1);
    if (end === -1) return { ok: false, error: 'no closing `---`' };
    const keys = {};
    let last = null;
    for (let i = 1; i < end; i++)
    {
        const line = lines[i];
        if (line.trim() === '') continue;
        const m = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
        if (m)
        {
            if (Object.prototype.hasOwnProperty.call(keys, m[1])) return { ok: false, error: `duplicate key \`${m[1]}\`` };
            last = m[1];
            keys[last] = m[2];
        }
        else if (last && /^[ \t]+\S/.test(line)) keys[last] += ` ${line.trim()}`;
        else return { ok: false, error: `line ${i + 1} is not \`key: value\`: ${collapse(line).slice(0, 60)}` };
    }
    if (Object.keys(keys).length === 0) return { ok: false, error: 'the frontmatter block is empty' };
    return { ok: true, keys, bodyFrom: end + 1 };
}

// The row is a ROUTER, not the skill's documentation: house first sentences run 460-588 chars, so
// the cap is the first CLAUSE at 120.
function firstClause(desc)
{
    if (!desc) return '';
    const d = collapse(desc).replace(/^["']/, '').replace(/["']$/, '');
    return d.split(/\.\s|\s-\s/)[0].slice(0, 120).trim();
}

// ---------------------------------------------------------------- the layers

function scanSkills(dir)
{
    const out = [];
    for (const e of readDir(dir))
    {
        if (!e.isDirectory()) continue;
        const text = readText(path.join(dir, e.name, 'SKILL.md'));
        if (text === null) continue;
        const fm = parseFrontmatter(text);
        const keys = fm.ok ? fm.keys : {};
        const name = collapse(keys.name || e.name);
        out.push({
            name,
            slashOnly: /^true$/i.test(collapse(keys['disable-model-invocation'] || '')),
            byDesign: MODEL_INVOCABLE_BY_DESIGN.has(name),
            clause: firstClause(keys.description),
            unreadable: fm.ok ? null : fm.error,
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

const scanAgents = (dir) => readDir(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort((a, b) => a.localeCompare(b));

// A seat from a plugin is addressable ONLY as `<plugin>:<agent>` - the bare name returns 'Agent
// type not found'. The family is the bare part, so the prefix comes off first.
const bareSeat = (s) => String(s).replace(/^[A-Za-z0-9_-]+:/, '');

function seatFamilies(seats)
{
    const fams = new Set();
    for (const raw of seats)
    {
        const s = bareSeat(raw);
        for (const role of SEAT_ROLES) if (s.endsWith(role)) fams.add(s.slice(0, -role.length));
    }
    return [...fams].sort((a, b) => a.localeCompare(b));
}

function scanRules(dir)
{
    const out = [];
    for (const e of readDir(dir))
    {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        const fm = parseFrontmatter(readText(path.join(dir, e.name)));
        const raw = fm.ok ? (fm.keys.paths || '') : '';
        const globs = raw ? collapse(raw).replace(/^\[|\]$/g, '').split(',').map((g) => g.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
        out.push({ name: e.name.replace(/\.md$/, ''), globs, pathScoped: globs.length > 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- the plugin-covered branch

// An install whose skills and agents come only from a plugin has no `.claude/skills` at all, and
// that is a NAMED branch, not an empty inventory. The roots are the ENABLED plugins this project
// actually carries - each listing row names its own `installPath` - never a walk of the config
// dir, which would sweep in every marketplace clone and every stale cached version on the machine.
// The entry's OWN item lists, read from the marketplace manifest that ships in the plugin root.
// Returns null when there is no such entry - a plugin with its own root, or a manifest shape this
// does not know - and the caller falls back to scanning the directory.
function entryItems(installPath, pluginName)
{
    let entry;
    try
    {
        const mk = JSON.parse(fs.readFileSync(path.join(installPath, '.claude-plugin', 'marketplace.json'), 'utf8'));
        entry = (mk.plugins || []).find((x) => x && x.name === pluginName);
    }
    catch { return null; }
    // An entry that exists and lists nothing ships nothing - an MCP entry, or the 1.x hooks alias.
    // Returning null there sent it to the directory scan, which handed back all 43 of the shared
    // root's seats under its name (measured: 85 seats where the truth is 42 plus one local extra).
    if (!entry) return null;
    const abs = (rel) => path.join(installPath, String(rel).replace(/^\.\//, ''));
    const skills = [];
    for (const rel of entry.skills || [])
    {
        const dir = abs(rel);
        const text = readText(path.join(dir, 'SKILL.md'));
        if (text === null) continue;
        const fm = parseFrontmatter(text);
        const keys = fm.ok ? fm.keys : {};
        const name = collapse(keys.name || path.basename(dir));
        skills.push({
            name,
            slashOnly: /^true$/i.test(collapse(keys['disable-model-invocation'] || '')),
            byDesign: MODEL_INVOCABLE_BY_DESIGN.has(name),
            clause: firstClause(keys.description),
            unreadable: fm.ok ? null : fm.error,
        });
    }
    const agents = (entry.agents || []).map((rel) => path.basename(String(rel)).replace(/\.md$/, ''));
    return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), agents: agents.sort((a, b) => a.localeCompare(b)) };
}

function pluginCoveredLayers(pluginRows)
{
    const skills = [];
    const seats = [];
    const from = [];
    for (const p of pluginRows)
    {
        if (p.state !== 'enabled' || !p.installPath) continue;
        // Two shapes. A plugin with its own root ships `skills/` and `agents/` there and a
        // directory scan is exact. A plugin that SHARES a repo root with its siblings (this stack,
        // from the release that moved them) has the WHOLE repo in its cache, so a scan counts every
        // sibling's items as its own - measured at 860 seats across 20 entries where the truth is
        // 43. The marketplace manifest inside that root is what says which items the entry ships,
        // so it is read first and the scan is only the fallback.
        const listed = entryItems(p.installPath, p.name);
        const s = listed ? listed.skills : [...scanSkills(path.join(p.installPath, 'skills')), ...scanSkills(path.join(p.installPath, 'stack', 'skills'))];
        const a = listed ? listed.agents : [...scanAgents(path.join(p.installPath, 'agents')), ...scanAgents(path.join(p.installPath, 'stack', 'agents'))];
        if (s.length || a.length) from.push(p.name);
        skills.push(...s);
        // The DISPATCH name, which is the only one that resolves - the rule this generates is read
        // at dispatch time, so a bare seat name in it is an instruction that fails.
        seats.push(...a.map((name) => `${p.name}:${name}`));
    }
    const seen = new Set();
    return {
        skills: skills.filter((s) => (seen.has(s.name) ? false : seen.add(s.name))).sort((a, b) => a.name.localeCompare(b.name)),
        seats: [...new Set(seats)].sort((a, b) => a.localeCompare(b)),
        from,
    };
}

// The seats `permissions.deny` switches off, merged across the account, project and local settings
// (deny rules merge across scopes) - `Agent(<dispatch name>)`, the exact name Claude Code matches. From
// 2.1.0 the core carries every seat and the project denies each one it did not pick: a denied seat is
// not in the listing (spike S3) and fails at dispatch, so the rule must never route to one. A 1.x core
// spelling still blocks the renamed seat (rebrand-evidence S6), so it reads as the core's. An
// unreadable file denies nothing.
function deniedSeats(projectRoot)
{
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const out = new Set();
    for (const file of [path.join(account, 'settings.json'), path.join(projectRoot, '.claude', 'settings.json'), path.join(projectRoot, '.claude', 'settings.local.json')])
    {
        let data = null;
        try { data = JSON.parse(readText(file) || 'null'); } catch { data = null; }
        const deny = data && data.permissions && Array.isArray(data.permissions.deny) ? data.permissions.deny : [];
        for (const rule of deny)
        {
            const m = /^Agent\(([^()\s]+)\)$/.exec(String(rule).trim());
            if (m) out.add(m[1].replace(/^claude-stack:/, 'alfred-code:')); // legacy-name
        }
    }
    return out;
}

// ---------------------------------------------------------------- the CLI probes

function claude(args, timeoutMs)
{
    const r = spawnSync(`claude ${args.join(' ')}`, { shell: true, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, reason: `timed out at ${Math.round(timeoutMs / 1000)}s` };
    if (r.signal) return { ok: false, reason: `killed (${r.signal})` };
    const out = `${r.stdout || ''}`;
    if (r.error || r.status === 127 || (!out.trim() && /not found|not recognized/i.test(`${r.stderr || ''}`))) return { ok: false, reason: 'CLI absent' };
    if (r.status !== 0 && !out.trim()) return { ok: false, reason: `exit ${r.status}` };
    return { ok: true, out };
}

// Order matters: the CLI's failure row reads `Failed to connect`, so a connected-first test would
// report a dead server as live - the one claim in this block nothing downstream can catch.
const mcpState = (s) => (/fail|error|refus|timed out/i.test(s) ? 'failed'
    : /disabl/i.test(s) ? 'disabled'
        : /connect/i.test(s) ? 'connected'
            : (s.replace(/[^\x20-\x7E]/g, '').trim() || 'unknown'));

// `claude mcp list` prints `<name>: <target> - <state>`. The name may carry spaces (a connector
// reaching the session from the account or the harness), and those rows are the whole reason the
// file alone is not the inventory - a run that read `.mcp.json` only wrote 'no issue-tracker
// connector is registered' while 41 of that connector's tools were live in the same session.
function parseMcpList(out)
{
    const rows = [];
    for (const line of out.split(/\r?\n/))
    {
        const t = line.trim();
        if (!t || /^Checking MCP server/i.test(t)) continue;
        const m = /^(\S.*?):[ \t]+(.*)$/.exec(t);
        if (!m) continue;
        const rest = m[2];
        const dash = rest.lastIndexOf(' - ');
        rows.push({ name: m[1].trim(), state: mcpState(dash > -1 ? rest.slice(dash + 3) : '') });
    }
    return rows;
}

function parsePluginList(out, projectRoot)
{
    const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    const here = real(projectRoot);
    const byName = new Map();
    let rows = null;
    try
    {
        const data = JSON.parse(out);
        rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : null);
    }
    catch { rows = null; }
    if (rows)
    {
        for (const e of rows)
        {
            if (!e || typeof e !== 'object') continue;
            const name = String(e.id || e.name || '').split('@')[0];
            // The listing is machine-global: a row carrying another repo's projectPath is a sibling's.
            if (!name || (e.projectPath && real(String(e.projectPath)) !== here)) continue;
            // `mcpServers` is on the rows of a plugin that declares a server, keyed by server name.
            const servers = e.mcpServers && typeof e.mcpServers === 'object' && !Array.isArray(e.mcpServers) ? Object.keys(e.mcpServers) : null;
            if (!byName.has(name)) byName.set(name, { state: e.enabled === false ? 'disabled' : 'enabled', installPath: e.installPath ? String(e.installPath) : null, servers });
        }
    }
    else
    {
        // An older CLI without --json prints blocks: `❯ <name>@<marketplace>` then `Status: <word>`.
        // It names no installPath, so a plugin-covered inventory cannot be read off it.
        let name = null;
        for (const line of out.split(/\r?\n/))
        {
            const head = /^\s*\S?\s*([A-Za-z0-9_.-]+)@[A-Za-z0-9_.-]+\s*$/.exec(line);
            if (head) { name = head[1]; if (!byName.has(name)) byName.set(name, { state: 'enabled', installPath: null }); continue; }
            const st = /^\s*Status:\s*\S?\s*([A-Za-z]+)/.exec(line);
            if (st && name) byName.set(name, { state: st[1].toLowerCase(), installPath: null });
        }
    }
    return [...byName].map(([name, row]) => ({ name, ...row })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- the routing map

const routingKey = (name) => (PLAYWRIGHT_SERVER.test(name) ? 'browser' : name);

// A row names one server, or several that share it (`- \`navigation\`, \`documentation\`, \`memory\` - ...`,
// the locked three, whose load lines live in their always-on baselines): every name maps to the same entry.
function routingMap()
{
    const lines = (readText(path.join(SKILL_DIR, TEMPLATE_REL)) || '').split(/\r?\n/);
    const start = lines.findIndex((l) => /^The routing map/.test(l));
    const map = new Map();
    if (start === -1) return map;
    let cur = null;
    for (let i = start + 1; i < lines.length; i++)
    {
        const l = lines[i];
        if (/^#{1,6} /.test(l)) break;
        if (/^- /.test(l))
        {
            const head = /^- ((?:`[^`]+`)(?:, `[^`]+`)*) - /.exec(l);
            const keys = head ? [...head[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
            cur = { keys, head: head ? head[1] : null, text: l.trim() };
            for (const key of keys) map.set(key, cur);
        }
        else if (cur && /^[ \t]+\S/.test(l)) cur.text += ` ${l.trim()}`;
        else if (l.trim() === '') cur = null;
    }
    return map;
}

// THE DATA ROOT a row names (`<data root>`): ALFRED_CODE_DATA_PATH, read like every launcher setting - the
// shell env, then settings.local.json, settings.json and the account settings.json - and refused back to
// `.alfred` where stack/mcp/data-root.js (checkDataPath) refuses it. That module is the one home, but this
// script ships inside a skill copy with no stack/mcp beside it, so the read is inline; a parity test
// (scripts/capabilities-rule.test.js) holds the two to one answer.
const DATA_ROOT_DEFAULT = '.alfred';
function dataRoot(projectRoot, env = process.env)
{
    let raw = String(env.ALFRED_CODE_DATA_PATH || '').trim();
    if (!raw)
    {
        const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
        for (const file of [path.join(projectRoot, '.claude', 'settings.local.json'), path.join(projectRoot, '.claude', 'settings.json'), path.join(account, 'settings.json')])
        {
            try { raw = String(((JSON.parse(readText(file) || 'null') || {}).env || {}).ALFRED_CODE_DATA_PATH || '').trim(); }
            catch { raw = ''; }
            if (raw) break;
        }
    }
    const value = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    const parts = value.split('/');
    const refused = !value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || /\s/.test(value) || /[$%`"'*?<>|:]/.test(value)
        || parts.some((p) => p === '.' || p === '..') || parts[0] === '.claude' || parts[0] === '.git';
    return refused ? DATA_ROOT_DEFAULT : value;
}

// The literal values a row carries into the rule: the generated rule is a pointer and cannot itself hold
// the slot it exists to resolve (a browser row told the model to prefix a filename with `<data root>/...`).
function fillSlots(row, server, slots = {})
{
    let out = row;
    if (slots.dataRoot) out = out.replace(/<data root>/g, slots.dataRoot);
    const engine = (PLAYWRIGHT_SERVER.exec(server) || [])[1];
    if (engine) out = out.replace(/<engine>/g, engine);
    if (slots.docsRoot) out = out.replace(/<docs-path>/g, String(slots.docsRoot).replace(/[\\/]+$/, ''));
    return out;
}
const UNRESOLVED_SLOT = /<(data root|engine|docs-path|server)>/g;

// Every row here is for a server REGISTERED in .mcp.json (every add-back line of the 2.0.0 cut lands
// there), and a registration's tools are `mcp__<name>__<tool>`. The catalog rows name the plugin
// spelling, `mcp__plugin_<name>_<name>__<tool>`, which finds nothing for a registration - so a row is
// re-spelled to the bare form before it is printed (R63).
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function routingRow(name, map, slots)
{
    const key = routingKey(name);
    const hit = map.get(key);
    if (!hit) return `- \`${name}\` - routing: see project docs. first call: \`ToolSearch select:\` plus the \`mcp__${name}__*\` names the session's own listing shows.`;
    let row = collapse(hit.text).replace(/<server>/g, name);
    if (key !== name) row = row.replace(`\`${key}\``, `\`${name}\``);
    return fillSlots(row.replace(new RegExp(`mcp__plugin_${escapeRe(name)}_${escapeRe(name)}__`, 'g'), `mcp__${name}__`), name, slots);
}

// A server an enabled PLUGIN provides - the default route, where nothing sits in .mcp.json (pilot 2:
// the empty routing block meant 'None registered' in the rule and 0 MCP calls in 12 cells). Its tools
// are `mcp__plugin_<plugin>_<server>__<tool>`: the catalog's own spelling for the stack's servers,
// whose plugin and server share a name, and re-spelled for one whose names differ.
function pluginRoutingRow(plugin, server, map, slots)
{
    const key = routingKey(server);
    const hit = map.get(key);
    if (!hit) return `- \`${server}\` - routing: see project docs. first call: \`ToolSearch select:\` plus the \`mcp__plugin_${plugin}_${server}__*\` names the session's own listing shows.`;
    let row = collapse(hit.text).replace(/<server>/g, server);
    if (key !== server) row = row.replace(`\`${key}\``, `\`${server}\``);
    return fillSlots(row.replace(new RegExp(`mcp__plugin_${escapeRe(server)}_${escapeRe(server)}__`, 'g'), `mcp__plugin_${plugin}_${server}__`), server, slots);
}

// Every row, in the order the servers come (registrations, then plugin servers): a row several servers
// share is printed ONCE, at its first server, naming only the ones present - a locked server the install
// lacks is not claimed. Its text names no tool, so it needs no re-spelling for either route.
function routingRowsFor(servers, map, slots)
{
    const out = [];
    const done = new Set();
    for (const s of servers)
    {
        const hit = map.get(routingKey(s.name));
        if (hit && hit.keys.length > 1)
        {
            if (done.has(hit)) continue;
            done.add(hit);
            const present = hit.keys.filter((k) => servers.some((o) => routingKey(o.name) === k));
            out.push(fillSlots(collapse(hit.text).replace(hit.head, present.map((k) => `\`${k}\``).join(', ')), s.name, slots));
        }
        else out.push(s.plugin ? pluginRoutingRow(s.plugin, s.name, map, slots) : routingRow(s.name, map, slots));
    }
    return out;
}

// `enabledPlugins` of the project's own settings, the local file winning a key both name.
function settingsPlugins(projectRoot)
{
    const merged = new Map();
    for (const file of ['settings.json', 'settings.local.json'])
    {
        let map = null;
        try { map = JSON.parse(readText(path.join(projectRoot, '.claude', file)) || 'null'); }
        catch { map = null; }
        map = map && typeof map === 'object' ? map.enabledPlugins : null;
        if (map && typeof map === 'object' && !Array.isArray(map)) for (const [id, on] of Object.entries(map)) merged.set(String(id).split('@')[0], on === true);
    }
    return merged;
}

// The servers the enabled plugins provide, one per server name. The CLI's listing is the authority
// when it answered (it resolves every scope and names each plugin's servers); a row from a CLI too old
// to carry `mcpServers` counts by the catalog's names. With no CLI, the project settings' enabledPlugins
// stand in, by the same catalog names - a plugin the catalog does not name cannot be judged from a key.
function pluginServers(projectRoot, pluginProbe, pluginRows, map)
{
    const out = [];
    const known = (name) => map.has(routingKey(name));
    if (pluginProbe.ok)
    {
        for (const p of pluginRows)
        {
            if (p.state !== 'enabled') continue;
            for (const server of p.servers || (known(p.name) ? [p.name] : [])) out.push({ plugin: p.name, server });
        }
    }
    else
    {
        for (const [name, on] of settingsPlugins(projectRoot)) if (on && known(name)) out.push({ plugin: name, server: name });
    }
    const seen = new Set();
    return out.filter((s) => (seen.has(s.server) ? false : seen.add(s.server))).sort((a, b) => a.server.localeCompare(b.server));
}

// ---------------------------------------------------------------- the project, and the live rule

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*; an install not yet updated still // legacy-name
// carries the 1.x spelling (CLAUDE_STACK_DOCS_PATH), and one from before 0.2.43 the oldest of all // legacy-name
// (CLAUDE_DOCS_PATH) - this script has no hook-prelude.js to share, so the fallback order is inline.
const DOCS_PATH_KEYS = ['ALFRED_CODE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_DOCS_PATH']; // legacy-name

function docsRoot(projectRoot)
{
    for (const key of DOCS_PATH_KEYS)
    {
        if (process.env[key]) return { value: process.env[key], from: `${key} in the environment` };
    }
    // A local-scope install writes the key into settings.local.json, which is read over settings.json (R99).
    for (const file of ['settings.local.json', 'settings.json'])
    {
        try
        {
            const env = (JSON.parse(readText(path.join(projectRoot, '.claude', file)) || '{}') || {}).env || {};
            for (const key of DOCS_PATH_KEYS)
            {
                if (env[key]) return { value: env[key], from: `${key} in .claude/${file} env` };
            }
        }
        catch { /* a malformed settings file is the next one's case, not a failure */ }
    }
    return { value: '.alfred/docs', from: 'the default - no ALFRED_CODE_DOCS_PATH set' };
}

// The stamp's two names: a 1.x install keeps `claude-stack.stamp` until an update rewrites it. This // legacy-name
// script ships inside a skill with no installer module beside it, so it names the old file itself.
const STAMPS = ['.claude/alfred-code.stamp', '.claude/claude-stack.stamp']; // legacy-name

function installStamp(projectRoot)
{
    const text = STAMPS.map((f) => readText(path.join(projectRoot, f))).find((t) => t !== null) ?? null;
    if (text === null) return null;
    const pick = (k) => (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(text) || [])[1];
    const sha = (pick('sha') || '').trim();
    const version = (pick('version') || '').trim();
    if (!sha && !version) return null;
    return `${version || 'no version'}@${sha.slice(0, 7) || 'no sha'}`;
}

// The precheck the shell form could never make print empty: its `find ... -newer` listed the start
// DIRECTORIES, whose mtime moves on every child create or rename (the rule's own save included),
// and `head -3` then filled with those three directories and hid the real changed files. FILES
// only, the generated rules excluded, newest first, and a COUNT before the names.
function precheck(projectRoot, rulePath)
{
    const ruleStat = statOf(rulePath);
    if (!ruleStat) return { first: true, hits: [] };
    const skipName = (n) => /^(alfred|baseline)-project-/.test(n) || n === 'project-code-style.md';
    const hits = [];
    const visit = (p, depth) =>
    {
        const st = statOf(p);
        if (!st) return;
        if (st.isDirectory())
        {
            if (depth > 6) return;
            for (const e of readDir(p)) visit(path.join(p, e.name), depth + 1);
            return;
        }
        if (!st.isFile() || skipName(path.basename(p)) || path.resolve(p) === path.resolve(rulePath)) return;
        if (st.mtimeMs > ruleStat.mtimeMs) hits.push({ path: relTo(projectRoot, p), mtime: st.mtimeMs });
    };
    for (const src of ['.claude/skills', '.claude/agents', '.claude/rules', '.mcp.json', ...STAMPS])
    {
        visit(path.join(projectRoot, src), 0);
    }
    hits.sort((a, b) => b.mtime - a.mtime);
    const captured = ((/^Captured:\s*(.+)$/m.exec(readText(rulePath) || '') || [])[1] || 'no Captured: line').trim();
    // Every update rewrites the stamp, a no-op one included, so a newer stamp alone said drift after each update and
    // the full compose that followed came out identical. When the stamp is the ONLY newer file, its revision is
    // compared with the one the rule's `Captured: <date> from <version>@<sha>` line recorded: the same revision is
    // no drift. A stamp with no revision, or a rule with no `from`, stays drift.
    const recorded = (/\bfrom\s+(\S+)\s*$/.exec(captured) || [])[1];
    const live = installStamp(projectRoot);
    if (hits.length && hits.every((h) => STAMPS.includes(h.path)) && live && recorded === live)
    {
        return { first: false, hits: [], captured, stampSame: live };
    }
    return { first: false, hits, captured };
}

const sectionsOf = (text) =>
{
    const map = new Map();
    let head = '(preamble)';
    let buf = [];
    for (const line of (text || '').split(/\r?\n/))
    {
        if (/^## /.test(line)) { map.set(head, buf.join('\n').trim()); head = line.trim(); buf = []; }
        else buf.push(line);
    }
    map.set(head, buf.join('\n').trim());
    return map;
};

const normalize = (t) => (t || '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');

// The Captured line is the run's date, so it never counts as a change: an identical rewrite stays skipped on a later day.
const withoutCaptured = (t) => t.replace(/^Captured:.*\n/m, '');

// The policy block ships VERBATIM from the skill - it is the ONE home of the house usage policy and
// its `policy-rev` stamp is what tells a current copy from a two-release-old one. The skill's copy
// carries the `<docs-path>` placeholder the generated rule must resolve, so the comparison puts it
// back before it compares.
function policyBlock(text)
{
    const lines = (text || '').split(/\r?\n/);
    const at = lines.findIndex((l) => /<!--\s*policy-rev:\s*[0-9a-f]+\s*-->/.test(l));
    if (at === -1) return { rev: null, lines: [] };
    const rev = (/policy-rev:\s*([0-9a-f]+)/.exec(lines[at]) || [])[1];
    const body = [];
    for (let i = at + 1; i < lines.length; i++)
    {
        if (/^#{1,6} /.test(lines[i]) || /^```/.test(lines[i])) break;
        body.push(lines[i]);
    }
    return { rev, lines: body.map((l) => l.trim()).filter(Boolean) };
}

function mcpRowsOf(text)
{
    const lines = (text || '').split(/\r?\n/);
    const at = lines.findIndex((l) => /^## MCP routing\s*$/.test(l));
    if (at === -1) return null;
    const rows = [];
    for (let i = at + 1; i < lines.length; i++)
    {
        const l = lines[i];
        if (/^## /.test(l)) break;
        if (/^- /.test(l)) rows.push(l.trim());
        else if (rows.length && /^[ \t]+\S/.test(l)) rows[rows.length - 1] += ` ${l.trim()}`;
    }
    return rows;
}

// ---------------------------------------------------------------- the three modes

function report(projectRoot)
{
    const out = [];
    const say = (label, value) => out.push(`${(`${label}:`).padEnd(11)}${value}`);
    const sub = (line) => out.push(`  ${line}`);

    const rulePath = path.join(projectRoot, RULE_REL);
    const ruleText = readText(rulePath);
    const docs = docsRoot(projectRoot);
    const stamp = installStamp(projectRoot);
    const map = routingMap();
    const slots = { dataRoot: dataRoot(projectRoot), docsRoot: docs.value };
    const skillPolicy = policyBlock(readText(path.join(SKILL_DIR, 'SKILL.md')));

    out.push('=== alfred-capture-agent-capabilities - inventory (one node pass, no per-skill fork) ===');
    say('PROJECT', projectRoot);
    say('DOCS ROOT', `${docs.value}  (from ${docs.from}) - every \`<docs-path>\` in the template is this literal`);
    say('CAPTURED', `${today()} from ${stamp || 'no stamp'}`);
    say('TEMPLATE', `${TEMPLATE_REL} - ${map.size} routing rows read`);

    const liveRev = policyBlock(ruleText).rev;
    say('RULE', ruleText === null
        ? `${RULE_REL} - absent, this is the FIRST capture`
        : `${RULE_REL} - ${Buffer.byteLength(ruleText)} bytes, policy-rev ${liveRev || 'none'} (skill: ${skillPolicy.rev || 'none'}${liveRev && skillPolicy.rev ? (liveRev === skillPolicy.rev ? ', current' : ', STALE - the stamped policy moved') : ''})`);

    const pre = precheck(projectRoot, rulePath);
    if (pre.first) say('PRECHECK', 'FIRST - no rule yet, capture everything');
    else if (pre.hits.length === 0) say('PRECHECK', `empty - 0 files newer than the rule (Captured: ${pre.captured}${pre.stampSame ? `; a stamp rewrite at the same revision ${pre.stampSame} is not drift` : ''}). Say so in one line and STOP, unless the user asked for a refresh or the machine-global plugin state is what changed.`);
    else
    {
        say('PRECHECK', `drift - ${pre.hits.length} file(s) newer than the rule (Captured: ${pre.captured})`);
        for (const h of pre.hits.slice(0, 3)) sub(h.path);
        if (pre.hits.length > 3) sub(`... and ${pre.hits.length - 3} more`);
    }

    const pluginProbe = claude(['plugin', 'list', '--json'], 30000);
    const pluginRows = pluginProbe.ok ? parsePluginList(pluginProbe.out, projectRoot) : [];

    let skills = scanSkills(path.join(projectRoot, '.claude', 'skills'));
    let seats = scanAgents(path.join(projectRoot, '.claude', 'agents'));
    const localCount = { skills: skills.length, seats: seats.length };
    const plug = pluginCoveredLayers(pluginRows);
    if (plug.from.length)
    {
        // UNION, never a fallback. The plugin route still copies the EXTRAS, so a branch that read
        // the plugins only when the local dir was EMPTY saw 25 skills and 1 seat on a plugin-native
        // install and generated the project's rule over that - measured; the real set is 79 and 43.
        // A local copy WINS a name clash: it is what the harness would load first.
        const seen = new Set(skills.map((s) => s.name));
        skills = [...skills, ...plug.skills.filter((s) => !seen.has(s.name))].sort((a, b) => a.name.localeCompare(b.name));
        // A seat copied under .claude/agents wins its name too: the project keeps it as its own (a tuned or
        // edited seat), and a flow dispatches the roster's spelling - the core's twin would run the stack's pins.
        seats = [...new Set([...seats, ...plug.seats.filter((s) => !seats.includes(bareSeat(s)))])].sort((a, b) => a.localeCompare(b));
        say('SOURCE', `PLUGIN-COVERED - ${plug.from.length} enabled plugin(s) carry ${plug.skills.length} skill(s) and ${plug.seats.length} seat(s), beside ${localCount.skills} skill(s) and ${localCount.seats} seat(s) copied under .claude/: ${plug.from.join(', ')}`);
    }
    else if (localCount.skills === 0 || localCount.seats === 0)
        say('SOURCE', `no local .claude/skills or .claude/agents${pluginProbe.ok ? ' and no enabled plugin carries them' : ' and the CLI is absent, so a plugin source cannot be read'} - say so and STOP rather than generate an empty rule over a good one`);

    const orchestration = skills.filter((s) => s.slashOnly || s.byDesign);
    say('SKILLS', `${skills.length} total, ${orchestration.length} orchestration (${orchestration.filter((s) => s.byDesign).length} model-invocable-by-design)`);
    for (const s of orchestration) sub(`/${s.name} - ${s.clause}${s.byDesign ? ' (model-invocable-by-design)' : ''}`);
    for (const s of skills.filter((s) => s.unreadable)) sub(`UNREADABLE ${s.name}: ${s.unreadable} - report it as unreadable, never fill it from memory`);

    const denied = deniedSeats(projectRoot);
    const offSeats = seats.filter((s) => denied.has(s));
    seats = seats.filter((s) => !denied.has(s));
    say('SEATS', `${seats.length} total${offSeats.length ? ` (${offSeats.length} denied in permissions.deny, left out)` : ''}`);
    sub(seats.join(', ') || 'none');
    const fams = seatFamilies(seats);
    sub(`seat families (${fams.length}): ${fams.join(', ') || 'none'}`);

    const rules = scanRules(path.join(projectRoot, '.claude', 'rules'));
    const scoped = rules.filter((r) => r.pathScoped);
    say('RULES', `${rules.length} total, ${rules.length - scoped.length} pathless, ${scoped.length} path-scoped`);
    sub(`pathless: ${rules.filter((r) => !r.pathScoped).map((r) => r.name).join(', ') || 'none'}`);
    for (const r of scoped) sub(`path-scoped: ${r.name} [${r.globs.join(', ')}]`);
    sub('coverage: cross-check the seat families above against these path-scoped rows - a family whose stack no rule names is a flag row');

    let registered = [];
    let mcpNote = '';
    const mcpRaw = readText(path.join(projectRoot, '.mcp.json'));
    if (mcpRaw === null) mcpNote = 'no .mcp.json';
    else
    {
        try { registered = Object.keys(JSON.parse(mcpRaw).mcpServers || {}).sort(); }
        catch (err) { mcpNote = `.mcp.json UNREADABLE (${err.message}) - report it as unreadable`; }
    }
    const live = claude(['mcp', 'list'], 45000);
    const liveRows = live.ok ? parseMcpList(live.out) : [];
    // A registration wins its name: the CLI ranks the project, local and user scopes above a plugin.
    const provided = pluginServers(projectRoot, pluginProbe, pluginRows, map).filter((s) => !registered.includes(s.server));
    say('MCP', `${registered.length} registered in .mcp.json${mcpNote ? ` (${mcpNote})` : ''}, ${provided.length} from enabled plugins, ${live.ok ? `${liveRows.length} live in \`claude mcp list\`` : `live list unavailable - ${live.reason}`}`);
    const liveByName = new Map(liveRows.map((r) => [r.name, r.state]));
    const liveOf = (name) => liveByName.get(name) || (live.ok ? 'not in the live list' : 'unknown');
    for (const name of registered) sub(`${name.padEnd(20)} registered  live: ${liveOf(name)}${routingKey(name) !== name ? `  routing: ${routingKey(name)}` : ''}`);
    // The live list names a plugin's server `plugin:<plugin>:<server>`.
    const pluginLive = new Set(provided.map((s) => `plugin:${s.plugin}:${s.server}`));
    for (const s of provided) sub(`${s.server.padEnd(20)} plugin      live: ${liveOf(`plugin:${s.plugin}:${s.server}`)}  from ${s.plugin}${routingKey(s.server) !== s.server ? `  routing: ${routingKey(s.server)}` : ''}`);
    for (const r of liveRows) if (!registered.includes(r.name) && !pluginLive.has(r.name)) sub(`${r.name.padEnd(20)} -           live: ${r.state}  (reaches the session from the account or the harness, not .mcp.json)`);
    sub(`MCP ROUTING rows - paste verbatim, one per registered or plugin-provided server (data root ${slots.dataRoot}):`);
    const servers = [...registered.map((name) => ({ name })), ...provided.map((s) => ({ name: s.server, plugin: s.plugin }))];
    for (const row of routingRowsFor(servers, map, slots)) sub(row);

    if (!pluginProbe.ok) say('PLUGINS', `${pluginProbe.reason} - OMIT the Plugins section from the rule rather than guess`);
    else
    {
        say('PLUGINS', `${pluginRows.length} after dedupe (state only - \`claude plugin list\` is machine-global, so it never says WHY)`);
        sub(pluginRows.map((p) => `${p.name} (${p.state})`).join(', ') || 'none');
    }

    // Inside the project, so a Write lands under print mode's acceptEdits too (a temp dir outside it was
    // refused in pilot 2); the docs root's own .gitignore keeps flow/ out of git.
    const body = `${String(docs.value).replace(/[\\/]+$/, '')}/flow/capabilities-body.md`;
    say('COMPARE', `no --body yet - compose the rule body, write it to \`${body}\`, then re-run with \`--body ${body}\`; that verdict is what authorizes the write, and the file is deleted once it is spent`);
    console.log(out.join('\n'));
    return 0;
}

function compare(projectRoot, bodyArg)
{
    const rulePath = path.join(projectRoot, RULE_REL);
    const composed = normalize(bodyArg === '-' ? fs.readFileSync(0, 'utf8') : readText(path.resolve(bodyArg)));
    if (composed === null || composed.trim() === '')
    {
        console.log(`COMPARE:   FAIL - the composed body at ${bodyArg} is empty or unreadable`);
        return 1;
    }
    const live = readText(rulePath);
    if (live === null)
    {
        console.log(`COMPARE:   differs - no rule yet, WRITE ${RULE_REL} (composed ${Buffer.byteLength(composed)} bytes)`);
        return 0;
    }
    if (withoutCaptured(normalize(live)) === withoutCaptured(composed))
    {
        console.log(`COMPARE:   identical - DO NOT WRITE (${Buffer.byteLength(live)} bytes). Report \`rule unchanged - ${Buffer.byteLength(live)} bytes, not rewritten\`.`);
        return 0;
    }
    const a = sectionsOf(withoutCaptured(normalize(live)));
    const b = sectionsOf(withoutCaptured(composed));
    const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
    console.log(`COMPARE:   differs - WRITE ${RULE_REL} in ONE call, whole file (live ${Buffer.byteLength(live)} bytes, composed ${Buffer.byteLength(composed)} bytes)`);
    console.log(`  sections changed: ${changed.join(' | ') || '(whitespace only)'}`);
    return 0;
}

function verify(projectRoot, ruleArg)
{
    const rulePath = path.resolve(ruleArg);
    const text = readText(rulePath);
    const fails = [];
    const line = (label, ok, detail) =>
    {
        if (!ok) fails.push(label);
        console.log(`${(`${label}:`).padEnd(15)}${ok ? 'ok' : 'FAIL'} - ${detail}`);
    };
    console.log(`=== verify ${slash(path.relative(projectRoot, rulePath)) || rulePath} ===`);
    if (text === null || text.trim() === '')
    {
        console.log('file:          FAIL - absent or empty');
        console.log('VERIFY:        FAIL (1 check)');
        return 1;
    }

    const fm = parseFrontmatter(text);
    line('frontmatter', fm.ok, fm.ok ? `parsed by node, keys: ${Object.keys(fm.keys).join(', ')}` : fm.error);
    line('description', !!(fm.ok && fm.keys.description), fm.ok && fm.keys.description ? 'present' : 'the generated rule needs a `description:` key');
    line('paths key', !(fm.ok && Object.prototype.hasOwnProperty.call(fm.keys, 'paths')), fm.ok && fm.keys.paths ? 'present - this rule is PATHLESS, a `paths:` key makes it a scoped rule' : 'absent, as a pathless rule needs');

    const skillPolicy = policyBlock(readText(path.join(SKILL_DIR, 'SKILL.md')));
    const rulePolicy = policyBlock(text);
    line('policy-rev', !!(rulePolicy.rev && skillPolicy.rev && rulePolicy.rev === skillPolicy.rev),
        rulePolicy.rev ? `${rulePolicy.rev} vs the skill's ${skillPolicy.rev || 'none'}` : 'no `<!-- policy-rev: ... -->` line - the stamped block was not copied with it');

    const docs = docsRoot(projectRoot).value;
    const back = rulePolicy.lines.map((l) => l.split(docs).join('<docs-path>'));
    const diffAt = skillPolicy.lines.findIndex((l, i) => back[i] !== l);
    const sameLen = back.length === skillPolicy.lines.length;
    line('policy block', sameLen && diffAt === -1,
        sameLen && diffAt === -1 ? `${back.length} lines, verbatim from the skill (\`<docs-path>\` resolved to ${docs})`
            : `differs from the skill at line ${diffAt === -1 ? back.length + 1 : diffAt + 1} of the block - it ships VERBATIM, re-copy it`);

    const missing = REQUIRED_HEADINGS.filter((h) => !new RegExp(`^${h}`, 'm').test(text));
    line('headings', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${REQUIRED_HEADINGS.length} inventory sections present (Plugins is optional - omitted when the CLI probe failed)`);

    const left = [...new Set([...text.matchAll(UNRESOLVED_SLOT)].map((m) => m[0]))];
    line('slots', left.length === 0, left.length ? `unresolved ${left.join(', ')} - re-paste the script's rows, which carry this project's literal values` : 'none left unfilled');

    const rows = mcpRowsOf(text);
    const bad = (rows || []).filter((r) => !/first call:/.test(r));
    line('mcp rows', rows !== null && bad.length === 0,
        rows === null ? 'no `## MCP routing` section'
            : bad.length ? `${bad.length} of ${rows.length} carry no 'first call:' - ${bad.map((r) => (/^- `([^`]+)`/.exec(r) || [, r.slice(0, 40)])[1]).join(', ')}`
                : `${rows.length} of ${rows.length} carry their 'first call:' line`);

    console.log(`VERIFY:        ${fails.length ? `FAIL (${fails.length} check(s): ${fails.join(', ')})` : 'PASS'}`);
    return fails.length ? 1 : 0;
}

// ---------------------------------------------------------------- entry

function main()
{
    if (process.argv.includes('--help') || process.argv.includes('-h'))
    {
        console.log(readText(__filename).split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
        return 0;
    }
    const projectRoot = path.resolve(argOf('--project') || process.cwd());
    const ruleArg = argOf('--verify');
    if (process.argv.includes('--verify') && !ruleArg) { console.log('--verify needs a rule file path'); return 2; }
    if (ruleArg) return verify(projectRoot, ruleArg);
    const bodyArg = argOf('--body');
    if (process.argv.includes('--body') && !bodyArg) { console.log('--body needs a file path (or `-` for stdin)'); return 2; }
    if (bodyArg) return compare(projectRoot, bodyArg);
    return report(projectRoot);
}

if (require.main === module) process.exitCode = main();

module.exports = { dataRoot, fillSlots, routingMap, routingRow, pluginRoutingRow, routingRowsFor };
