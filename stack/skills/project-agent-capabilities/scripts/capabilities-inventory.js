#!/usr/bin/env node
// capabilities-inventory.js - the whole mechanical half of /project-agent-capabilities in ONE node
// pass: the precheck, the full inventory with a printed COUNT per layer (skills, seats, rules, MCP,
// plugins), the LIVE `claude mcp list`, the paste-ready MCP routing rows, the compare verdict that
// authorizes the write, and the post-write --verify. Node built-ins only - no install, no network,
// and no per-skill fork (the shell loop it replaces measured 4m13s on Git Bash).
//
// Usage, from the project root:
//   node .claude/skills/project-agent-capabilities/scripts/capabilities-inventory.js
//   node .../capabilities-inventory.js --body <composed-rule-file|->     the compare verdict
//   node .../capabilities-inventory.js --verify <rule-file>             exits 1 on failure
//   --project <dir>   the project root (default: the current directory)
//
// Every line it prints is a report field. A claim with no printed line behind it is not one.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const TEMPLATE_REL = 'references/generated-rule-template.md';
const RULE_REL = '.claude/rules/baseline-project-agent-capabilities.md';
// The orchestration skills that carry NO `disable-model-invocation` by design, so the architecture
// loop can invoke them - they belong with the slash-only set in the rule, marked as the exception.
const MODEL_INVOCABLE_BY_DESIGN = new Set(['project-architecture-analyzer', 'project-architecture-quality-analyzer']);
const HEAVY_NATIVE_DEPS = new Set(['chrome-devtools', 'appium-mcp']);
// One catalog server expands into one registration per kept browser; every installed-name reader
// maps them back to the catalog name, and so does the routing row.
const PLAYWRIGHT_SERVER = /^playwright-(chrome|msedge|firefox|webkit)$/;
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
    // An entry that exists and lists nothing ships nothing - `alfred-code-hooks` is hooks only.
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
            if (!byName.has(name)) byName.set(name, { state: e.enabled === false ? 'disabled' : 'enabled', installPath: e.installPath ? String(e.installPath) : null });
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

const routingKey = (name) => (PLAYWRIGHT_SERVER.test(name) ? 'playwright' : name);

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
            const m = /^- `([^`]+)`/.exec(l);
            cur = { key: m ? m[1] : null, text: l.trim() };
            if (cur.key) map.set(cur.key, cur);
        }
        else if (cur && /^[ \t]+\S/.test(l)) cur.text += ` ${l.trim()}`;
        else if (l.trim() === '') cur = null;
    }
    return map;
}

function routingRow(name, map)
{
    const key = routingKey(name);
    const hit = map.get(key);
    // A plugin server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, and the stack ships one
    // plugin per server under the same name - so both halves are this one name.
    if (!hit) return `- \`${name}\` - routing: see project docs. first call: \`ToolSearch select:\` plus the \`mcp__plugin_${name}_${name}__*\` names the session's own listing shows.`;
    let row = collapse(hit.text).replace(/<server>/g, name);
    if (key !== name) row = row.replace(`\`${key}\``, `\`${name}\``);
    return row;
}

// ---------------------------------------------------------------- the project, and the live rule

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*; an install not yet updated still
// carries the 1.x spelling (CLAUDE_STACK_DOCS_PATH), and one from before 0.2.43 the oldest of all
// (CLAUDE_DOCS_PATH) - this script has no hook-prelude.js to share, so the fallback order is inline.
const DOCS_PATH_KEYS = ['ALFRED_CODE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_DOCS_PATH']; // legacy-name

function docsRoot(projectRoot)
{
    for (const key of DOCS_PATH_KEYS)
    {
        if (process.env[key]) return { value: process.env[key], from: `${key} in the environment` };
    }
    try
    {
        const env = (JSON.parse(readText(path.join(projectRoot, '.claude', 'settings.json')) || '{}') || {}).env || {};
        for (const key of DOCS_PATH_KEYS)
        {
            if (env[key]) return { value: env[key], from: `${key} in .claude/settings.json env` };
        }
    }
    catch { /* a malformed settings.json is the default's case, not a failure */ }
    return { value: '.claude/docs', from: 'the default - no ALFRED_CODE_DOCS_PATH set' };
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
    const skipName = (n) => n.startsWith('baseline-project-') || n === 'project-code-style.md';
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
    return { first: false, hits, captured: ((/^Captured:\s*(.+)$/m.exec(readText(rulePath) || '') || [])[1] || 'no Captured: line').trim() };
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
    const skillPolicy = policyBlock(readText(path.join(SKILL_DIR, 'SKILL.md')));

    out.push('=== project-agent-capabilities - inventory (one node pass, no per-skill fork) ===');
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
    else if (pre.hits.length === 0) say('PRECHECK', `empty - 0 files newer than the rule (Captured: ${pre.captured}). Say so in one line and STOP, unless the user asked for a refresh or the machine-global plugin state is what changed.`);
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
        seats = [...new Set([...seats, ...plug.seats])].sort((a, b) => a.localeCompare(b));
        say('SOURCE', `PLUGIN-COVERED - ${plug.from.length} enabled plugin(s) carry ${plug.skills.length} skill(s) and ${plug.seats.length} seat(s), beside ${localCount.skills} skill(s) and ${localCount.seats} seat(s) copied under .claude/: ${plug.from.join(', ')}`);
    }
    else if (localCount.skills === 0 || localCount.seats === 0)
        say('SOURCE', `no local .claude/skills or .claude/agents${pluginProbe.ok ? ' and no enabled plugin carries them' : ' and the CLI is absent, so a plugin source cannot be read'} - say so and STOP rather than generate an empty rule over a good one`);

    const orchestration = skills.filter((s) => s.slashOnly || s.byDesign);
    say('SKILLS', `${skills.length} total, ${orchestration.length} orchestration (${orchestration.filter((s) => s.byDesign).length} model-invocable-by-design)`);
    for (const s of orchestration) sub(`/${s.name} - ${s.clause}${s.byDesign ? ' (model-invocable-by-design)' : ''}`);
    for (const s of skills.filter((s) => s.unreadable)) sub(`UNREADABLE ${s.name}: ${s.unreadable} - report it as unreadable, never fill it from memory`);

    say('SEATS', `${seats.length} total`);
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
    say('MCP', `${registered.length} registered in .mcp.json${mcpNote ? ` (${mcpNote})` : ''}, ${live.ok ? `${liveRows.length} live in \`claude mcp list\`` : `live list unavailable - ${live.reason}`}`);
    const liveByName = new Map(liveRows.map((r) => [r.name, r.state]));
    for (const name of registered) sub(`${name.padEnd(20)} registered  live: ${liveByName.get(name) || (live.ok ? 'not in the live list' : 'unknown')}${routingKey(name) !== name ? `  routing: ${routingKey(name)}` : ''}`);
    for (const r of liveRows) if (!registered.includes(r.name)) sub(`${r.name.padEnd(20)} -           live: ${r.state}  (reaches the session from the account or the harness, not .mcp.json)`);
    const heavy = registered.filter((n) => HEAVY_NATIVE_DEPS.has(n));
    sub(`heavy native deps registered: ${heavy.join(', ') || 'none'}`);
    sub('MCP ROUTING rows - paste verbatim, one per REGISTERED server:');
    for (const name of registered) sub(routingRow(name, map));

    if (!pluginProbe.ok) say('PLUGINS', `${pluginProbe.reason} - OMIT the Plugins section from the rule rather than guess`);
    else
    {
        say('PLUGINS', `${pluginRows.length} after dedupe (state only - \`claude plugin list\` is machine-global, so it never says WHY)`);
        sub(pluginRows.map((p) => `${p.name} (${p.state})`).join(', ') || 'none');
    }

    say('COMPARE', 'no --body yet - compose the rule body, write it to a scratch file, then re-run with `--body <file>`; that verdict is what authorizes the write');
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
    if (normalize(live) === composed)
    {
        console.log(`COMPARE:   identical - DO NOT WRITE (${Buffer.byteLength(live)} bytes). Report \`rule unchanged - ${Buffer.byteLength(live)} bytes, not rewritten\`.`);
        return 0;
    }
    const a = sectionsOf(normalize(live));
    const b = sectionsOf(composed);
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

process.exitCode = main();
