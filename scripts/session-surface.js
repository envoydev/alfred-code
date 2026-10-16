// THE SESSION SURFACE - what a fresh Claude Code session in ONE installed project is sent, row by row, and when.
// Lint check 33 measures the catalog in this repo; nothing measured an INSTALL: the rules and memory files the
// project holds, the skill and agent listings of every enabled plugin beside the stack's, what the hooks inject at
// session start, per turn, at a seat's dispatch and after compaction. The system audit (repo-audit-system) judges
// this map; the script only states it, so two runs over one install print the same rows.
//
//   node scripts/session-surface.js <projectRoot> [--json] [--config-dir <dir>] [--window <n>]
//        [--listing-fraction <f>] [--run-hooks] [--with-user] [--model <id>]
//
// Read-only unless --run-hooks: then each command hook on session start, per turn, seat dispatch and compaction
// runs once on a synthetic payload, inside the project, with the inherited stack env cleared and a temp dir of its
// own - meant for a throwaway fixture, since the hooks write their ledgers into the project as a session would.
// A write under the account dir or a stray docs root fails the run (exit 1). The listing budget's fraction is
// passed in (--listing-fraction, read from the skills docs at use); the script pins no figure of the harness.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawnCommand } = require('./install/runtime.js');
const { frontmatterOf, frontmatterValue, injectedRuleText, listedTools } = require('./always-on-surface.js');
const { findDuplicates } = require('./find-duplicate-rules.js');
const { scrubbed, strayWrites, strayRoots } = require('./hook-test-env.js');
const { BRAND } = require('./install/brand.js');

const ROOT = path.join(__dirname, '..');
// The listing truncates each entry here unless settings say otherwise (skillListingMaxDescChars, the skills docs).
const LISTING_MAX_DESC = 1536;
const HOOK_TIMEOUT_CAP = 30;   // seconds - a probe never waits out the 600-second default of an untimed hook
const SAMPLE_PROMPTS = ['fix the failing test in src/index.ts', 'what does this project do?'];
const SAMPLE_TOOLS = ['Bash', 'PowerShell', 'Monitor', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob',
    'Agent', 'Task', 'Skill', 'AskUserQuestion', 'WebFetch', 'WebSearch', 'ToolSearch', 'LSP'];
const SAMPLE_SOURCES = { SessionStart: ['startup', 'resume', 'clear', 'compact', 'fork'], PreCompact: ['manual', 'auto'] };
// Events whose matcher is silently ignored - they fire on every occurrence (code.claude.com/docs/en/hooks, the matcher
// table, read 2026-10-16).
const NO_MATCHER = new Set(['UserPromptSubmit', 'PostToolBatch', 'Stop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'WorktreeCreate', 'WorktreeRemove', 'MessageDisplay', 'CwdChanged']);
const LOAD_POINTS = ['session-start', 'per-turn', 'per-tool', 'path-scoped', 'seat-dispatch', 'compaction', 'stop'];

const readSoft = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
// { value } or { error }: a malformed file is a row of its own, never a crash and never silently empty.
function readJson(file)
{
    const text = readSoft(file);
    if (text === null) return { missing: true };
    try { return { value: JSON.parse(text.replace(/^\uFEFF/, '')) }; }
    catch (e) { return { error: e.message }; }
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const realOr = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const listMd = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; } };
const bodyOf = (text) => String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
// The MCP servers a seat's `tools:` grants, each as its tool prefix (`mcp__<server>`, `mcp__plugin_<plugin>_<server>`):
// a whole-server grant is the prefix itself, a one-tool grant the prefix plus `__<tool>`.
const grantedServers = (fm) => [...new Set(listedTools(fm).replace(/^ \(Tools: |\)$/g, '').split(',').map((t) => t.trim())
    .filter((t) => t.startsWith('mcp__')).map((t) => `mcp__${t.slice('mcp__'.length).split('__')[0]}`))];

// The names this repo ships, so an installed copy reads as the stack's and anything else as the project's own.
function stackInventory(root = ROOT)
{
    const names = (dir, pick) => { try { return new Set(fs.readdirSync(dir).map(pick).filter(Boolean)); } catch { return new Set(); } };
    const skills = names(path.join(root, 'stack', 'skills'), (f) => f);
    const rules = names(path.join(root, 'stack', 'rules'), (f) => (f.endsWith('.md') ? f.slice(0, -3) : ''));
    // A generated rule is one a capture skill writes: named as `.claude/rules/<name>.md` in a stack skill.
    const generated = new Set();
    const walk = (dir) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md'))
                for (const m of String(readSoft(p) || '').matchAll(/\.claude\/rules\/([a-z0-9-]+)\.md/g))
                    if (!rules.has(m[1])) generated.add(m[1]);
        }
    };
    walk(path.join(root, 'stack', 'skills'));
    let plugins = [];
    const manifest = readJson(path.join(root, 'meta', 'stack-manifest.json')).value || {};
    plugins = (manifest.plugins || []).map((p) => String((p && p.id) || p).split('@')[0]);
    return { skills, rules, generated, plugins: new Set(plugins) };
}

function accountPaths({ configDir, env = process.env, home = os.homedir() })
{
    const dir = configDir || env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    // The installer's own rule: the account file sits in CLAUDE_CONFIG_DIR when one is set, else in the home dir.
    const accountFile = configDir || env.CLAUDE_CONFIG_DIR ? path.join(dir, '.claude.json') : path.join(home, '.claude.json');
    return { dir, accountFile };
}

// Every settings layer the session merges, lowest first; each one read or reported unreadable.
function settingsLayers(projectRoot, account)
{
    const layers = [
        { scope: 'user', file: path.join(account.dir, 'settings.json') },
        { scope: 'project', file: path.join(projectRoot, '.claude', 'settings.json') },
        { scope: 'local', file: path.join(projectRoot, '.claude', 'settings.local.json') },
    ];
    return layers.map((l) => ({ ...l, ...readJson(l.file) }));
}

// enabledPlugins merged across the layers (a later layer wins a key), each spec with the scope that enabled it.
function enabledPlugins(layers)
{
    const out = new Map();
    for (const l of layers)
        for (const [spec, on] of Object.entries((l.value && l.value.enabledPlugins) || {}))
        {
            if (on === false) out.delete(spec);
            else if (on) out.set(spec, l.scope);
        }
    return out;
}

const ownerOfPlugin = (spec, inventory) =>
{
    const [name, market] = spec.split('@');
    if (market === BRAND.marketplace) return 'house';
    return inventory.plugins.has(name) ? `plugin:${name}` : 'user';
};

// One enabled plugin's components, from its cache copy and its marketplace entry: the entry may carry every
// manifest field inline (a marketplace entry is a full manifest), and the default folders load beside them.
function pluginComponents(spec, account, projectRoot)
{
    const [name, market] = spec.split('@');
    const registry = readJson(path.join(account.dir, 'plugins', 'installed_plugins.json')).value || {};
    const rows = ((registry.plugins || {})[spec] || []);
    const here = realOr(projectRoot);
    const row = rows.find((r) => r.scope !== 'user' && r.projectPath && realOr(r.projectPath) === here)
        || rows.find((r) => r.scope === 'user') || rows[0];
    if (!row || !row.installPath || !isDir(row.installPath)) return { name, market, missing: true };
    const root = row.installPath;
    const markets = readJson(path.join(account.dir, 'plugins', 'known_marketplaces.json')).value || {};
    const mpDir = (markets[market] && markets[market].installLocation) || path.join(account.dir, 'plugins', 'marketplaces', market);
    const catalog = readJson(path.join(mpDir, '.claude-plugin', 'marketplace.json')).value || {};
    const entry = ((catalog.plugins || []).find((p) => p && p.name === name)) || {};
    const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json')).value || {};
    const field = (k) => (entry[k] !== undefined ? entry[k] : manifest[k]);
    const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const inRoot = (p) => path.join(root, String(p).replace(/^\.\//, ''));
    const mdFiles = (paths, fallback) =>
    {
        const list = asList(paths);
        const from = list.length ? list.map(inRoot) : [path.join(root, fallback)];
        const out = [];
        for (const p of from)
            if (isDir(p)) for (const f of listMd(p)) out.push(path.join(p, f));
            else if (p.endsWith('.md') && fs.existsSync(p)) out.push(p);
        return out;
    };
    const skillDirs = [];
    for (const p of [...asList(field('skills')).map(inRoot), path.join(root, 'skills')])
    {
        if (!isDir(p)) continue;
        if (fs.existsSync(path.join(p, 'SKILL.md'))) skillDirs.push(p);
        else for (const d of fs.readdirSync(p)) if (fs.existsSync(path.join(p, d, 'SKILL.md'))) skillDirs.push(path.join(p, d));
    }
    const jsonOrObject = (v) => (typeof v === 'string' ? readJson(inRoot(v)).value || {} : v || {});
    const hookMaps = [jsonOrObject(field('hooks')), readJson(path.join(root, 'hooks', 'hooks.json')).value || {}];
    const servers = { ...(readJson(path.join(root, '.mcp.json')).value || {}).mcpServers, ...jsonOrObject(field('mcpServers')) };
    const lsp = { ...(readJson(path.join(root, '.lsp.json')).value || {}), ...jsonOrObject(field('lspServers')) };
    return {
        name, market, root, version: row.version || '',
        skills: [...new Set(skillDirs)].map((d) => path.join(d, 'SKILL.md')),
        commands: mdFiles(field('commands'), 'commands'),
        agents: mdFiles(field('agents'), 'agents'),
        hooks: hookMaps.map((h) => (h && h.hooks && typeof h.hooks === 'object' && !Array.isArray(h.hooks) ? h.hooks : h)),
        servers: servers.mcpServers || servers,
        lsp,
    };
}

// The memory files a session loads at launch (code.claude.com/docs/en/memory, read 2026-10-16): CLAUDE.md,
// .claude/CLAUDE.md and CLAUDE.local.md in the project and every directory above it, root first; AGENTS.md and
// .claude/AGENTS.md in their place only while none of those three sits anywhere on that path. `@path` imports
// expand, four hops deep, skipping code spans and fenced blocks. The user's own ~/.claude/CLAUDE.md is --with-user's.
const CLAUDE_FILES = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'];
const AGENTS_FILES = ['AGENTS.md', path.join('.claude', 'AGENTS.md')];
function importsOf(text)
{
    const prose = String(text).replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, '').replace(/`[^`\n]*`/g, '');
    return [...prose.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[^\s@`]*[/.][^\s@`]*)/g)].map((m) => m[1].replace(/[.,;:)]+$/, ''));
}
function memoryFiles(projectRoot)
{
    const chain = [];
    for (let dir = projectRoot; ; dir = path.dirname(dir))
    {
        chain.unshift(dir);
        if (path.dirname(dir) === dir) break;
    }
    const present = (names) => chain.flatMap((dir) => names.map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p)));
    const claude = present(CLAUDE_FILES);
    const found = claude.length ? claude : present(AGENTS_FILES);
    const out = [];
    const seen = new Set();
    const add = (abs, hops, via) =>
    {
        if (seen.has(abs) || hops > 4) return;
        seen.add(abs);
        const shownAs = path.relative(projectRoot, abs) || path.basename(abs);
        const text = readSoft(abs);
        if (text === null) { out.push({ source: shownAs, chars: 0, note: `import from ${via} - missing` }); return; }
        const sent = injectedRuleText(text);
        out.push({ source: shownAs, chars: sent.length, note: via ? `imported by ${via}` : 'memory file', text: sent });
        for (const target of importsOf(text))
            add(target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : path.resolve(path.dirname(abs), target), hops + 1, shownAs);
    };
    for (const f of found) add(f, 0, '');
    return out;
}

const parseList = (fm, key) =>
{
    const inline = frontmatterValue(fm, key);
    if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
    const m = new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]+-[ \\t]+.*(?:\\r?\\n|$))+)`, 'm').exec(fm);
    return m ? m[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean) : [];
};

// The docs' three rules (hooks, the matcher table): `*`, empty or none match all; only letters, digits, `_`, `-`,
// spaces, `,` and `|` is an exact name or a list split on `|` or `,`; anything else is an UNANCHORED regex. An event
// with no matcher support ignores the field.
function matches(matcher, value, event = '')
{
    if (NO_MATCHER.has(event) || matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
    const m = String(matcher);
    if (/^[A-Za-z0-9_\- ,|]+$/.test(m)) return m.split(/[|,]/).map((x) => x.trim()).includes(value);
    try { return new RegExp(m).test(value); } catch { return false; }
}

function collectHooks(sources)
{
    const out = [];
    for (const { owner, label, map, pluginRoot, pluginData } of sources)
        for (const [event, groups] of Object.entries(map || {}))
            for (const g of Array.isArray(groups) ? groups : [])
                for (const h of (g && Array.isArray(g.hooks) ? g.hooks : []))
                {
                    const script = /([^/\\"'\s]+\.(?:js|mjs|cjs|sh|ps1|py))/.exec(String(h.command || ''));
                    out.push({ event, matcher: g.matcher, owner, label, type: h.type || 'command', command: h.command || '',
                        timeout: h.timeout, script: script ? script[1] : (h.type || 'command'), pluginRoot, pluginData });
                }
    return out;
}

function runHook(hook, payload, ctx)
{
    if (hook.type !== 'command') return { skipped: `type ${hook.type} - not run` };
    const env = { ...ctx.env };
    if (hook.pluginRoot) { env.CLAUDE_PLUGIN_ROOT = hook.pluginRoot; env.CLAUDE_PLUGIN_DATA = hook.pluginData; }
    const command = String(hook.command)
        .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, hook.pluginRoot || '')
        .replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, hook.pluginData || '')
        .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, ctx.projectRoot);
    const seconds = Math.min(Number(hook.timeout) || 600, HOOK_TIMEOUT_CAP);
    const started = Date.now();
    // A plain `node "<script>" [args]` line - every hook the stack ships - starts node itself: on Windows a timeout kills
    // only the shell, and the node child it started holds the pipes open until it ends on its own (the gate's Windows leg,
    // 2026-10-16). Any other line is a shell line, through the one spawn route (M6) - bash on Windows, where no sh is.
    const opts = { cwd: ctx.projectRoot, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: seconds * 1000 };
    const plain = /^node\s+("[^"]+"|\S+)((?:\s+(?:"[^"]*"|\S+))*)\s*$/.exec(command.trim());
    const argv = plain && !/[|&;<>$`]/.test(command) ? [...command.trim().slice(4).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] === undefined ? m[2] : m[1])) : null;
    const r = argv ? spawnSync(process.execPath, argv, opts) : spawnCommand(process.platform === 'win32' ? 'bash' : 'sh', ['-c', command], opts);
    const ms = Date.now() - started;
    if (r.error && r.error.code === 'ETIMEDOUT') return { timedOut: true, ms, seconds };
    const stdout = String(r.stdout || '').trim();
    let context = '';
    let decision = '';
    try
    {
        const j = JSON.parse(stdout);
        const spec = j.hookSpecificOutput || {};
        context = [spec.additionalContext, j.systemMessage].filter(Boolean).join('\n');
        decision = spec.permissionDecision || j.decision || '';
    }
    catch { context = stdout; }
    if (r.status === 2) { decision = decision || 'block'; context = [context, String(r.stderr || '').trim()].filter(Boolean).join('\n'); }
    return { status: r.status, ms, context, decision };
}

// The probe's session: one id across every event, so state a hook keeps per session carries across like a real one.
function probeContext(projectRoot, account, layers, options)
{
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'session-surface-')));
    const settingsEnv = Object.assign({}, ...layers.map((l) => (l.value && l.value.env) || {}));
    const env = { ...scrubbed(process.env), ...settingsEnv, CLAUDE_PROJECT_DIR: projectRoot, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
    if (options.configDir) env.CLAUDE_CONFIG_DIR = account.dir;
    const transcript = path.join(tmp, 'transcript.jsonl');
    fs.writeFileSync(transcript, '');
    const base = { session_id: `surface-${process.pid}`, cwd: projectRoot, transcript_path: transcript, permission_mode: 'default' };
    return { tmp, env, projectRoot, base, model: options.model };
}

// What the probe wrote: every file under the project and the account dir (its caches and transcripts aside) is
// snapshotted before the first hook and compared after the last, so a file the fixture wrote a moment earlier never
// reads as the probe's. A write outside the project fails the run; one inside is listed, as a session would leave it.
const ACCOUNT_SKIP = ['projects', path.join('plugins', 'cache'), path.join('plugins', 'marketplaces'), 'backups', 'statsig', 'todos', 'shell-snapshots'];
function snapshot(root, skip = [])
{
    const out = new Map();
    const walk = (dir, depth) =>
    {
        if (depth > 8) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const p = path.join(dir, e.name);
            if (skip.includes(path.relative(root, p))) continue;
            if (e.isDirectory()) walk(p, depth + 1);
            else { try { const st = fs.statSync(p); out.set(p, `${st.mtimeMs}:${st.size}`); } catch { /* gone */ } }
        }
    };
    walk(root, 0);
    return out;
}
const changed = (before, after) => [...after].filter(([p, sig]) => before.get(p) !== sig).map(([p]) => p);

function probeWrites(before, projectRoot, account, tmp, since)
{
    const inProject = (p) => !path.relative(projectRoot, p).startsWith('..');
    const project = changed(before.project, snapshot(projectRoot, ['.git'])).map((p) => path.relative(projectRoot, p));
    // The docs roots a hook falls back to when it mis-resolves the project - the suites' stray roots and the probe's
    // own temp dir's - are watched by time: none of them exists before a probe.
    const fallback = [...strayRoots(), ...['.alfred', '.claude'].map((d) => path.join(tmp, d, 'docs'))];
    const stray = [...changed(before.account, snapshot(account.dir, ACCOUNT_SKIP)), ...strayWrites(since, fallback)].filter((p) => !inProject(p));
    return { project: [...new Set(project)].sort(), stray: [...new Set(stray)].sort() };
}

function surface(projectRoot, options = {})
{
    projectRoot = realOr(projectRoot);
    const inventory = options.inventory || stackInventory();
    const account = accountPaths({ configDir: options.configDir, env: options.env || process.env, home: options.home || os.homedir() });
    const rows = [];
    const flags = [];
    const notMeasured = [];
    const add = (row) => rows.push({ note: '', ...row });
    const rel = (p) => path.relative(projectRoot, p) || '.';

    const layers = settingsLayers(projectRoot, account);
    for (const l of layers)
        if (l.error) flags.push({ kind: 'unreadable', detail: `${l.scope} settings (${l.scope === 'user' ? '~config/settings.json' : rel(l.file)}) is not valid JSON - ${l.error}; read as empty` });
    // Every layer shapes the session, the user's included; --with-user only decides what is SHOWN as the user's own.
    const userLayer = (l) => l.scope === 'user';
    const values = (key) => layers.map((l) => l.value && l.value[key]).filter((v) => v !== undefined && v !== null);
    const deny = values('permissions').flatMap((p) => (Array.isArray(p.deny) ? p.deny : []));
    const deniedAgents = new Set(deny.map((d) => (/^Agent\((.+)\)$/.exec(d) || [])[1]).filter(Boolean));
    const overrides = Object.assign({}, ...values('skillOverrides').filter((v) => typeof v === 'object'));
    const maxDesc = Number(values('skillListingMaxDescChars').pop()) || LISTING_MAX_DESC;

    // Memory files and pathless rules - sent at session start; path-scoped rules wait for a matching read.
    const injections = [];
    for (const m of memoryFiles(projectRoot))
    {
        // The stack seeds AGENTS.md from its template and the project writes its top; CLAUDE.md is the project's own.
        const owner = path.basename(m.source) === 'AGENTS.md' ? 'generated' : 'project';
        add({ loadPoint: 'session-start', owner, source: m.source, chars: m.chars, note: m.note });
        if (m.text) injections.push({ path: `memory:${m.source}`, text: m.text, injected: false });
    }
    const ruleOwner = (name) => (inventory.rules.has(name) ? 'house' : inventory.generated.has(name) ? 'generated' : 'project');
    const installedSkillNames = new Set();
    const skillEntries = [];
    // Where a file is printed from: the project's own path, `<plugin>:<path in the plugin>`, or `~config/<path>`.
    const shown = (file, pluginName, pluginRoot) => (pluginRoot ? `${pluginName}:${path.relative(pluginRoot, file)}`
        : file.startsWith(projectRoot) ? rel(file) : `~config/${path.relative(account.dir, file)}`);
    const pushSkill = (file, owner, plugin = {}, command = false) =>
    {
        const text = readSoft(file);
        if (text === null) return;
        const fm = frontmatterOf(text);
        const name = frontmatterValue(fm, 'name') || (command ? path.basename(file, '.md') : path.basename(path.dirname(file)));
        installedSkillNames.add(name);
        skillEntries.push({ file, owner, name, listed: plugin.name ? `${plugin.name}:${name}` : name, fm, body: bodyOf(text), source: shown(file, plugin.name, plugin.root) });
    };
    const ruleFiles = [];
    const walkRules = (dir, owner) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name)))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walkRules(p, owner);
            else if (e.name.endsWith('.md')) ruleFiles.push({ file: p, owner: owner || ruleOwner(e.name.slice(0, -3)) });
        }
    };
    walkRules(path.join(projectRoot, '.claude', 'rules'), '');
    if (options.withUser) walkRules(path.join(account.dir, 'rules'), 'user');

    // Skills: the project's copies, the user's own (with --with-user), and every enabled plugin's.
    for (const d of (() => { try { return fs.readdirSync(path.join(projectRoot, '.claude', 'skills')).sort(); } catch { return []; } })())
        pushSkill(path.join(projectRoot, '.claude', 'skills', d, 'SKILL.md'), inventory.skills.has(d) ? 'house' : 'project');
    if (options.withUser)
        for (const d of (() => { try { return fs.readdirSync(path.join(account.dir, 'skills')).sort(); } catch { return []; } })())
            pushSkill(path.join(account.dir, 'skills', d, 'SKILL.md'), 'user');
    if (options.withUser)
    {
        const userMemory = path.join(account.dir, 'CLAUDE.md');
        const text = readSoft(userMemory);
        if (text !== null) add({ loadPoint: 'session-start', owner: 'user', source: '~config/CLAUDE.md', chars: injectedRuleText(text).length, note: 'user memory file' });
    }

    const agentEntries = [];
    const pushAgent = (file, owner, prefix) =>
    {
        const text = readSoft(file);
        if (text === null) return;
        const fm = frontmatterOf(text);
        if (!fm.trim()) return;   // a file with no frontmatter is no seat
        const name = frontmatterValue(fm, 'name') || path.basename(file, '.md');
        agentEntries.push({ file, owner, name, listed: prefix ? `${prefix}:${name}` : name, fm, body: bodyOf(text) });
    };
    for (const f of listMd(path.join(projectRoot, '.claude', 'agents'))) pushAgent(path.join(projectRoot, '.claude', 'agents', f), 'project', '');
    if (options.withUser) for (const f of listMd(path.join(account.dir, 'agents'))) pushAgent(path.join(account.dir, 'agents', f), 'user', '');

    const hookSources = [];
    for (const l of layers)
    {
        if (!l.value || !l.value.hooks) continue;
        if (userLayer(l) && !options.withUser) continue;
        hookSources.push({ owner: userLayer(l) ? 'user' : 'project', label: `${l.scope} settings`, map: l.value.hooks });
    }
    const servers = [];
    const mcpJson = readJson(path.join(projectRoot, '.mcp.json'));
    if (mcpJson.error) flags.push({ kind: 'unreadable', detail: `.mcp.json is not valid JSON - ${mcpJson.error}` });
    const approved = new Set(values('enabledMcpjsonServers').flat());
    for (const [n, s] of Object.entries((mcpJson.value && mcpJson.value.mcpServers) || {}))
        servers.push({ name: n, tool: `mcp__${n}`, owner: 'project', scope: 'project (.mcp.json)', spec: s, note: approved.size && !approved.has(n) ? 'not approved in enabledMcpjsonServers' : '' });
    const acct = readJson(account.accountFile);
    if (acct.value)
    {
        const proj = (acct.value.projects || {})[projectRoot] || (acct.value.projects || {})[path.resolve(projectRoot)] || {};
        for (const [n, s] of Object.entries(proj.mcpServers || {})) servers.push({ name: n, tool: `mcp__${n}`, owner: 'project', scope: 'local', spec: s });
        for (const [n, s] of Object.entries(acct.value.mcpServers || {})) servers.push({ name: n, tool: `mcp__${n}`, owner: 'user', scope: 'user', spec: s });
    }

    // Enabled plugins - the stack's own entries, the third-party plugins it installs, and the user's.
    const plugins = enabledPlugins(layers);
    let userPluginsHidden = 0;
    // A hidden plugin's servers still answer a seat's grant, so a grant naming one is no dangling cite.
    const hiddenServerTools = new Set();
    for (const [spec, scope] of plugins)
    {
        const owner = ownerOfPlugin(spec, inventory);
        if (owner === 'user' && !options.withUser)
        {
            userPluginsHidden += 1;
            const hidden = pluginComponents(spec, account, projectRoot);
            if (!hidden.missing) for (const n of Object.keys(hidden.servers || {})) hiddenServerTools.add(`mcp__plugin_${hidden.name}_${n}`);
            continue;
        }
        const c = pluginComponents(spec, account, projectRoot);
        if (c.missing) { flags.push({ kind: 'dangling', detail: `${spec} is enabled (${scope}) but not in the plugin cache - it loads nothing` }); continue; }
        const data = path.join(account.dir, 'plugins', 'data', `${c.name}-${c.market}`.replace(/[^A-Za-z0-9_-]/g, '-'));
        for (const f of c.skills) pushSkill(f, owner, c);
        for (const f of c.commands) pushSkill(f, owner, c, true);
        for (const f of c.agents) pushAgent(f, owner, c.name);
        for (const map of c.hooks) hookSources.push({ owner, label: spec, map, pluginRoot: c.root, pluginData: data });
        for (const [n, s] of Object.entries(c.servers || {})) servers.push({ name: n, tool: `mcp__plugin_${c.name}_${n}`, owner, scope: `plugin ${spec}`, spec: s, pluginRoot: c.root });
        for (const [n, s] of Object.entries(c.lsp || {}))
            add({ loadPoint: 'session-start', owner, source: `${c.name}:.lsp.json`, chars: 0, note: `language server ${n} (${(s && s.command) || '?'}) - diagnostics arrive per edit, no standing text` });
    }
    if (userPluginsHidden) notMeasured.push(`${userPluginsHidden} plugin(s) enabled outside the stack - shown with --with-user`);

    for (const r of ruleFiles)
    {
        const text = readSoft(r.file) || '';
        const fm = frontmatterOf(text);
        const sent = injectedRuleText(text);
        const source = r.owner === 'user' ? `~config/${path.relative(account.dir, r.file)}` : rel(r.file);
        const globs = parseList(fm, 'paths');
        if (globs.length)
        {
            const named = [...installedSkillNames].filter((n) => new RegExp(`\`${n.replace(/[-]/g, '\\-')}\``).test(sent));
            add({ loadPoint: 'path-scoped', owner: r.owner, source, chars: sent.length, note: `paths ${globs.join(', ')}${named.length ? ` - names ${named.join(', ')}` : ''}` });
        }
        else
        {
            add({ loadPoint: 'session-start', owner: r.owner, source, chars: sent.length, note: 'pathless rule' });
            injections.push({ path: `rule:${source}`, text: sent, injected: false });
        }
    }

    // The skill listing: description plus when_to_use, truncated per entry; a manual-only skill is not in it.
    const nameCount = new Map();
    let manualOnly = 0;
    for (const s of skillEntries)
    {
        const bare = s.name;
        nameCount.set(bare, [...(nameCount.get(bare) || []), s]);
        const ov = String(overrides[s.name] || '');
        if (/^true$/i.test(frontmatterValue(s.fm, 'disable-model-invocation')) || ov === 'off' || ov === 'user-invocable-only') { manualOnly += 1; continue; }
        const desc = frontmatterValue(s.fm, 'description') + frontmatterValue(s.fm, 'when_to_use');
        const chars = ov === 'name-only' ? s.listed.length : Math.min(desc.length, maxDesc) + s.listed.length;
        add({ loadPoint: 'session-start', owner: s.owner, source: s.source, chars, note: `skill listing ${s.listed}${desc.length > maxDesc ? ` (truncated from ${desc.length})` : ''}`, listing: 'skill' });
    }
    // A bare name beside a namespaced one shadows it; two namespaces sharing a bare name only overlap - `/setup`
    // then names two commands, and the user has to know which plugin's they mean.
    const nameFlag = (what, name, homes) => flags.push({ kind: homes.every((h) => h.listed.includes(':')) ? 'name-overlap' : 'name-shadow',
        detail: `${what} '${name}' is ${what === 'skill' ? 'listed' : 'defined'} by ${homes.map((h) => `${h.owner} ${h.listed}`).join(' and ')}` });
    for (const [name, homes] of nameCount) if (homes.length > 1) nameFlag('skill', name, homes);

    // The agent listing: `<name>: <description> (Tools: ...)`; a denied seat leaves it (spike S3,
    // docs/plugin-migration-evidence.md). Its body and preloaded skills are paid at dispatch, not here.
    // A seat's grant of a server this install does not run is a dangling cite: the grant reaches nothing, and its
    // `(Tools: ...)` listing still spells the server out.
    const serverTools = new Set([...servers.map((s) => s.tool), ...hiddenServerTools]);
    const agentCount = new Map();
    let denied = 0;
    for (const a of agentEntries)
    {
        agentCount.set(a.name, [...(agentCount.get(a.name) || []), a]);
        if (deniedAgents.has(a.listed) || deniedAgents.has(a.name)) { denied += 1; continue; }
        const chars = a.listed.length + frontmatterValue(a.fm, 'description').length + listedTools(a.fm).length;
        add({ loadPoint: 'session-start', owner: a.owner, source: a.listed, chars, note: 'agent listing', listing: 'agent' });
        const absent = grantedServers(a.fm).filter((t) => !serverTools.has(t));
        if (absent.length) flags.push({ kind: 'dangling', detail: `seat ${a.listed} is granted ${absent.join(', ')} - no such server in this install` });
        const preload = parseList(a.fm, 'skills');
        const preloadChars = preload.reduce((n, p) => n + ((skillEntries.find((s) => s.name === p.split(':').pop()) || {}).body || '').length, 0);
        add({ loadPoint: 'seat-dispatch', owner: a.owner, source: a.listed, chars: a.body.trim().length + preloadChars, seat: true,
            note: `seat body ${a.body.trim().length}${preload.length ? ` + preloaded ${preload.join(', ')} ${preloadChars}` : ''}` });
    }
    for (const [name, homes] of agentCount) if (homes.length > 1) nameFlag('agent', name, homes);
    if (denied) notMeasured.push(`${denied} denied seat(s) left out of the agent listing`);

    // MCP servers: the tool schemas are deferred behind tool search, and a server's instructions arrive at runtime.
    const endpoints = new Map();
    for (const s of servers)
    {
        const spec = s.spec || {};
        const expand = (v) => String(v).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, s.pluginRoot || '');
        const key = spec.url ? `url ${spec.url}` : `cmd ${[spec.command, ...(spec.args || [])].map(expand).join(' ')}`;
        endpoints.set(key, [...(endpoints.get(key) || []), `${s.name} (${s.scope})`]);
        notMeasured.push(`MCP server ${s.name} (${s.owner}, ${s.scope}) - its instructions and deferred tool names arrive at runtime${s.note ? `; ${s.note}` : ''}`);
    }
    for (const [key, regs] of endpoints) if (regs.length > 1) flags.push({ kind: 'mcp-endpoint', detail: `${regs.join(' and ')} launch one endpoint (${key}) - the lower-ranked registration's tools never load` });

    // Hooks: listed per event; run on a synthetic payload with --run-hooks.
    const hooks = collectHooks(hookSources);
    const shared = new Map();
    for (const event of new Set(hooks.map((h) => h.event)))
    {
        const samples = /^(Pre|Post)ToolUse/.test(event) ? SAMPLE_TOOLS : SAMPLE_SOURCES[event] || [''];
        for (const v of samples)
        {
            const owners = [...new Set(hooks.filter((h) => h.event === event && matches(h.matcher, v, event)).map((h) => h.owner))];
            if (owners.length < 2) continue;
            const key = `${event}\0${owners.sort().join(', ')}`;
            shared.set(key, [...(shared.get(key) || []), v || '(every)']);
        }
    }
    for (const [key, hits] of shared)
    {
        const [event, owners] = key.split('\0');
        flags.push({ kind: 'shared-event', detail: `${event} ${hits.join('|')}: wired by ${owners} - all run in parallel, no order between them` });
    }

    const loadPointOf = (event) => ({ SessionStart: 'session-start', UserPromptSubmit: 'per-turn', UserPromptExpansion: 'per-turn', PreToolUse: 'per-tool',
        PostToolUse: 'per-tool', SubagentStart: 'seat-dispatch', PreCompact: 'compaction', Stop: 'stop', SubagentStop: 'stop' }[event] || 'per-tool');
    const writes = { project: [], stray: [] };
    const ran = new Set();
    if (options.runHooks)
    {
        const ctx = probeContext(projectRoot, account, layers, options);
        const since = Date.now();
        const before = { project: snapshot(projectRoot, ['.git']), account: snapshot(account.dir, ACCOUNT_SKIP) };
        const seat = (agentEntries.find((a) => a.owner === 'house' && !deniedAgents.has(a.listed)) || {}).listed || 'general-purpose';
        const runs = [
            { event: 'SessionStart', value: 'startup', point: 'session-start', payload: { source: 'startup', model: ctx.model } },
            ...SAMPLE_PROMPTS.map((prompt) => ({ event: 'UserPromptSubmit', value: '', point: 'per-turn', payload: { prompt }, label: prompt })),
            { event: 'SubagentStart', value: seat, point: 'seat-dispatch', payload: { agent_type: seat, agent_id: 'surface-seat' } },
            { event: 'PreCompact', value: 'auto', point: 'compaction', payload: { trigger: 'auto', custom_instructions: '' } },
            { event: 'SessionStart', value: 'compact', point: 'compaction', payload: { source: 'compact', model: ctx.model } },
        ];
        try
        {
            for (const run of runs)
                for (const h of hooks.filter((x) => x.event === run.event && matches(x.matcher, run.value, run.event)))
                {
                    ran.add(h);
                    const r = runHook(h, { ...ctx.base, hook_event_name: run.event, ...run.payload }, ctx);
                    const where = `${run.event}${run.value ? `:${run.value}` : ''}${run.label ? ` '${run.label}'` : ''}`;
                    if (r.skipped) { add({ loadPoint: run.point, owner: h.owner, source: h.script, chars: 0, note: `${where} - ${r.skipped}` }); continue; }
                    if (r.timedOut) { flags.push({ kind: 'hook-timeout', detail: `${h.owner} ${h.script} on ${where} ran past ${r.seconds}s` }); continue; }
                    add({ loadPoint: run.point, owner: h.owner, source: h.script, chars: r.context.length, note: `${where} - exit ${r.status}, ${r.ms}ms${r.decision ? `, ${r.decision}` : ''}`, hook: true, run: where });
                    if (r.context) injections.push({ path: `hook:${h.owner}:${h.script}:${run.event}`, text: r.context, injected: true });
                }
        }
        finally
        {
            Object.assign(writes, probeWrites(before, projectRoot, account, ctx.tmp, since));
            fs.rmSync(ctx.tmp, { recursive: true, force: true });
        }
    }
    else notMeasured.push('hook output at session start, per turn, dispatch and compaction - not run (pass --run-hooks on a throwaway fixture)');
    for (const h of hooks.filter((x) => !ran.has(x)))
    {
        const point = loadPointOf(h.event);
        const can = h.event === 'PreToolUse' ? 'may deny' : /^(PostToolUse|UserPromptExpansion)$/.test(h.event) ? 'may inject' : /Stop$/.test(h.event) ? 'may block the stop' : 'may inject';
        add({ loadPoint: point, owner: h.owner, source: h.script, chars: 0, note: `${h.event}${h.matcher ? ` ${h.matcher}` : ''} - ${can}, timeout ${h.timeout || 'default'}`, hook: true });
    }
    for (const w of writes.stray) flags.push({ kind: 'stray-write', detail: `a hook wrote outside the project: ${w.startsWith(account.dir) ? `~config/${path.relative(account.dir, w)}` : w}` });

    // An injection that repeats a rule or memory file is paid twice.
    const overlapFiles = injections.map((i) => ({ path: i.path, text: i.text }));
    if (overlapFiles.some((f) => f.path.startsWith('hook:')))
        for (const f of findDuplicates({ files: overlapFiles, registry: {} }))
        {
            const homes = f.homes.map((h) => h.file);
            if (!homes.some((h) => h.startsWith('hook:')) || !homes.some((h) => !h.startsWith('hook:'))) continue;
            flags.push({ kind: 'injection-overlap', detail: `${homes.join(' and ')} share '${f.homes[0].text.slice(0, 90)}' (score ${f.score.toFixed(2)})` });
        }

    const sum = (pred) => rows.filter(pred).reduce((n, r) => n + r.chars, 0);
    const byOwner = {};
    for (const r of rows.filter((x) => x.loadPoint === 'session-start')) byOwner[r.owner] = (byOwner[r.owner] || 0) + r.chars;
    const listingChars = sum((r) => r.listing === 'skill');
    const window = Number(options.window) || 200000;
    const fraction = Number(options.listingFraction) || 0;
    // The fraction is of the window in TOKENS and the harness counts the listing in chars, four to a token:
    // measured '39 skills, 19901 chars > 8000 budget' at a 200K window and the 0.01 default (CLAUDE.md, 2.1.284).
    const listingBudget = fraction ? Math.floor(window * fraction * 4) : null;
    // Lint check 33's cap, read from its one home so the two never disagree.
    const cap = Number((/const ALWAYS_ON_MAX = (\d+);/.exec(readSoft(path.join(ROOT, 'scripts', 'lint-skills.js')) || '') || [])[1]) || null;
    // One turn is one prompt's injection, one dispatch is the biggest seat plus what every dispatch is injected;
    // summing the samples or the seats would state a cost no session pays.
    const perRun = (point) =>
    {
        const by = new Map();
        for (const r of rows.filter((x) => x.loadPoint === point && x.hook)) by.set(r.run || '', (by.get(r.run || '') || 0) + r.chars);
        return Math.max(0, ...by.values());
    };
    const perPoint = (p) => (p === 'per-turn' ? perRun(p)
        : p === 'seat-dispatch' ? Math.max(0, ...rows.filter((r) => r.loadPoint === p && r.seat).map((r) => r.chars)) + sum((r) => r.loadPoint === p && r.hook)
            : sum((r) => r.loadPoint === p));
    const totals = {
        perLoadPoint: Object.fromEntries(LOAD_POINTS.map((p) => [p, perPoint(p)])),
        sessionStartByOwner: byOwner,
        skillListing: { chars: listingChars, entries: rows.filter((r) => r.listing === 'skill').length, manualOnly, budget: listingBudget,
            status: listingBudget === null ? 'not computed' : listingChars > listingBudget ? 'over' : listingChars === listingBudget ? 'at' : 'within' },
        agentListing: { chars: sum((r) => r.listing === 'agent'), entries: rows.filter((r) => r.listing === 'agent').length, denied },
        alwaysOnCap: cap,
        window,
    };
    if (listingBudget !== null && listingChars > listingBudget)
        flags.push({ kind: 'listing-budget', detail: `skill listing ${listingChars} chars is over the ${listingBudget} budget (${fraction} of a ${window}-token window, four chars a token) - the least-used descriptions are dropped whole` });
    // The harness lists its own bundled skills inside the same budget, and no file here holds them.
    if (listingBudget !== null) notMeasured.push(`Claude Code's own bundled skills share the ${listingBudget}-char listing budget and are not counted - '${totals.skillListing.status}' is the stack's and its plugins' share alone (/doctor estimates the whole listing)`);
    // No machine path leaves the map: the account dir, the project and the home dir print as names, so a report
    // pasted from it carries shapes, never a local path (the repo is public, and so is what is said about it).
    // Every path prints with forward slashes, so a map reads the same on every OS (the gate's Windows leg, 2026-10-16).
    const tidy = (text) => [[account.dir, '~config'], [projectRoot, '<project>'], [os.homedir(), '~']]
        .reduce((t, [from, to]) => t.split(from).join(to), String(text)).split(path.sep).join('/');
    for (const f of flags) f.detail = tidy(f.detail);
    for (const r of rows) { r.source = tidy(r.source); r.note = tidy(r.note); }
    return { project: path.basename(projectRoot), rows, flags, totals, notMeasured: notMeasured.map(tidy), writes };
}

function render(s)
{
    const out = [`session surface - ${s.project} (window ${s.totals.window})`];
    for (const point of LOAD_POINTS)
    {
        const rows = s.rows.filter((r) => r.loadPoint === point);
        if (!rows.length) continue;
        const per = { 'per-turn': ' a turn', 'seat-dispatch': ' the biggest dispatch', 'path-scoped': ' if every glob matches' }[point] || '';
        out.push('', `${point.toUpperCase()} - ${s.totals.perLoadPoint[point]} chars${per}`);
        for (const r of rows) out.push(`  ${r.owner.padEnd(18)} ${String(r.chars).padStart(6)}  ${r.source}${r.note ? ` - ${r.note}` : ''}`);
    }
    out.push('', 'FLAGS');
    if (!s.flags.length) out.push('  none');
    for (const f of s.flags) out.push(`  ${f.kind.padEnd(18)} ${f.detail}`);
    const t = s.totals;
    out.push('', 'TOTALS',
        `  session start ${t.perLoadPoint['session-start']} chars - ${Object.entries(t.sessionStartByOwner).map(([o, n]) => `${o} ${n}`).join(', ') || 'none'}`,
        `  a turn ${t.perLoadPoint['per-turn']}, the biggest dispatch ${t.perLoadPoint['seat-dispatch']}, after compaction ${t.perLoadPoint.compaction}`,
        `  skill listing ${t.skillListing.chars} chars in ${t.skillListing.entries} entries (${t.skillListing.manualOnly} manual-only left out) - budget ${t.skillListing.budget === null ? 'not computed (pass --listing-fraction from the skills docs)' : `${t.skillListing.budget}, ${t.skillListing.status} (bundled skills not counted)`}`,
        `  agent listing ${t.agentListing.chars} chars in ${t.agentListing.entries} entries (${t.agentListing.denied} denied)`,
        `  lint 33 cap ${t.alwaysOnCap === null ? 'unread' : `${t.alwaysOnCap} - it holds the catalog; this install's session start is ${Math.round((t.perLoadPoint['session-start'] / t.alwaysOnCap) * 100)}% of it`}`);
    if (s.writes.project.length) out.push('', `PROBE WRITES IN THE PROJECT - ${s.writes.project.length}`, ...s.writes.project.slice(0, 20).map((w) => `  ${w}`));
    if (s.notMeasured.length) out.push('', 'NOT MEASURED', ...s.notMeasured.map((n) => `  ${n}`));
    return out.join('\n');
}

function main(argv)
{
    const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const valued = new Set(['--config-dir', '--window', '--listing-fraction', '--model']);
    const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
    if (positional.length !== 1)
    {
        console.error('usage: session-surface.js <projectRoot> [--json] [--config-dir <dir>] [--window <n>] [--listing-fraction <f>] [--run-hooks] [--with-user] [--model <id>]');
        return 2;
    }
    const projectRoot = positional[0];
    if (!isDir(projectRoot)) { console.error(`session-surface: ${projectRoot} is not a directory`); return 1; }
    const s = surface(projectRoot, {
        configDir: arg('--config-dir'), window: arg('--window'), listingFraction: arg('--listing-fraction'),
        runHooks: argv.includes('--run-hooks'), withUser: argv.includes('--with-user'), model: arg('--model') || 'claude-sonnet-5-5',
    });
    process.stdout.write(`${argv.includes('--json') ? JSON.stringify(s, null, 2) : render(s)}\n`);
    return s.writes.stray.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { surface, render, matches, memoryFiles, importsOf, stackInventory, pluginComponents, main };
