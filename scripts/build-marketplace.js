#!/usr/bin/env node
'use strict';
// Generates the marketplace plugin ENTRIES from the computed placement. Nothing here creates a folder: every entry shares the repo root as its `source` and
// lists the skill folders and agent files it ships, which is the shape spike S9 proved
// (docs/plugin-migration-evidence.md). `stack/` stays the one home per piece.
//
//   node scripts/build-marketplace.js --write        regenerate meta/plugin-entries.json
//   node scripts/build-marketplace.js --check        exit 1 when that file is stale
//
// The live .claude-plugin/marketplace.json is NOT touched by --write, which only regenerates
// meta/plugin-entries.json; --write-marketplace is the Phase 3 transcription that applies those
// entries to the live file, leaving the generated hooks entry and the marketplace metadata alone.
//
//   node scripts/build-marketplace.js --write-marketplace   apply the entries to the live file
//
// The CORE entry is generated too, from Phase 3 on. It used to ship from `./setup-plugin`, whose
// own .claude-plugin/plugin.json was its manifest; its 21 skills and 8 agents live under stack/,
// outside that folder, and a `../` path out of a plugin root is undocumented (Phase 2 ruling R1
// refused to build on it). At `source: './'` nothing under setup-plugin/ is auto-discovered, so the
// entry carries every path explicitly - the guided-walk commands, the router skill, its placed skills and
// agents - plus the layer-table hook INLINE and the superpowers dependency that plugin.json used to
// declare. Dropping either on the way across would be a silent behaviour change.
const fs = require('node:fs');
const path = require('node:path');
const { placement, readRetiredEntries, CORE } = require('./plugin-placement.js');
const { timeoutFor } = require('./install/settings.js');

const REPO = path.resolve(__dirname, '..');
const ENTRIES_FILE = path.join(REPO, 'meta/plugin-entries.json');
const MARKETPLACE = path.join(REPO, '.claude-plugin/marketplace.json');

function readJson(file, what)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { throw new Error(`${what}: cannot read ${file} - ${err.message}`); }
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(`${what}: ${file} is not valid JSON - ${err.message}`); }
}

function marketplaceVersion(options = {})
{
    const mkt = options.marketplace || readJson(MARKETPLACE, 'marketplace.json');
    return (mkt.metadata && mkt.metadata.version) || '0.0.0';
}

// Every plugin hook runs as `node "<plugin root>/<file>"`. Shell form, launched through node and
// QUOTED, is the docs' own spelling for a plugin script ('Exec form and shell form',
// code.claude.com/docs/en/hooks) and the one 0.2.x shipped. A bare script path needs the exec bit,
// which git carries into the plugin cache verbatim - five hooks were committed 100644 and died
// 'permission denied' before a line ran - and a shebang, which Windows never honours. Args stay in
// the string: an `args` array switches to exec form, whose `command` must be a real executable.
const launch = (file, args) => `node "\${CLAUDE_PLUGIN_ROOT}/${file}"${args && args.length ? ` ${args.join(' ')}` : ''}`;

// The guided-walk COMMANDS and the router SKILL, the two things no other entry has. Read from
// setup-plugin's own plugin.json so one list stays the source of the command set, and re-rooted at
// the repo root the entry now ships from.
const SETUP_MANIFEST = path.join(REPO, 'setup-plugin/.claude-plugin/plugin.json');

function coreEntry(options = {})
{
    const place = options.placement || placement(options);
    const plug = place.plugins[CORE];
    const setup = readJson(options.setupManifest || SETUP_MANIFEST, 'setup-plugin/plugin.json');
    const commands = (setup.commands || []).map(c => `./setup-plugin/${String(c).replace(/^\.\//, '')}`);
    if (!commands.length) throw new Error('build-marketplace: setup-plugin/plugin.json lists no commands - the core entry would ship no guided walk');
    const entry = {
        name: CORE,
        source: './',
        description: setup.description,
        version: options.version || marketplaceVersion(options),
        author: options.author || { name: 'envoydev', url: 'https://github.com/envoydev' },
        strict: false,
        category: 'development',
        tags: ['setup', 'installer', 'skills', 'agents', 'mcp', 'bootstrap'],
        commands,
        skills: ['./setup-plugin/skills/alfred-code'].concat(plug.skills.map(s => `./stack/skills/${s}`)),
        agents: plug.agents.map(a => `./stack/agents/${a}.md`),
        // The layer-table guard used to be auto-discovered from setup-plugin/hooks/hooks.json. At
        // the shared root it is not, so it is declared inline - the shape Phase 2 proved for the
        // thirteen stack hooks.
        hooks: {
            PreToolUse: [{
                matcher: 'AskUserQuestion',
                hooks: [{ type: 'command', command: launch('setup-plugin/hooks/guard-layer-table.js'), timeout: 10 }],
            }],
            // Library copies move only on /alfred-code:update, so a session on a newer stack says
            // so once - at startup, never on a resume or a compaction.
            SessionStart: [{
                matcher: 'startup',
                hooks: [{ type: 'command', command: launch('setup-plugin/hooks/library-stamp.js'), timeout: 10 }],
            }],
        },
    };
    return entry;
}

function buildEntries(options = {})
{
    const place = options.placement || placement(options);
    const version = options.version || marketplaceVersion(options);
    const author = options.author || { name: 'envoydev', url: 'https://github.com/envoydev' };
    // One entry: the core. Every other skill and agent is LIBRARY - listed by no entry, copied into
    // a project per pick (plugin-placement.js says why).
    return [coreEntry({ ...options, placement: place, version, author })];
}

// The 1.x -> 2.x plugin rename, ONE constant: Claude Code reads it from the marketplace's own
// top-level `renames` key to move an existing install's `enabledPlugins` entries at the next
// session start (`claude-stack@claude-stack` -> `alfred-code@claude-stack`; the marketplace KEY
// itself never migrates - docs/rebrand-evidence.md S1/S4/S9). The frozen `meta/retired-entries.json`
// still spells its own dependency on the core in the same 1.x names, so this map does double duty:
// `applyRenames` writes it into the live file, and `retiredMarketplaceEntries` below translates a
// retired entry's `claude-stack` / `claude-stack-hooks` dependency through the same pairs - every
// other dependency is another retired entry's own frozen name and is left alone.
const MARKETPLACE_RENAMES = { 'claude-stack': 'alfred-code', 'claude-stack-hooks': 'alfred-code-hooks' }; // legacy-name

// Writes the `renames` map onto the live marketplace, in place. Never a null value for either key -
// a null DROPS the key at startup, before the seed can copy a retired entry's picks (plan decision
// D2) - so this always writes the full two-pair object, never a partial or emptied one.
function applyRenames(mkt, renames = MARKETPLACE_RENAMES)
{
    mkt.renames = { ...renames };
    return mkt;
}

// The retired per-stack entries, listed for their last release under a RETIRED description. The
// shape is the one 1.2.0 shipped, so an installed entry resolves the same files until update
// removes it.
function retiredMarketplaceEntries(options = {})
{
    const version = options.version || marketplaceVersion(options);
    const author = options.author || { name: 'envoydev', url: 'https://github.com/envoydev' };
    return readRetiredEntries(options.repo).map((row) =>
    {
        const entry = {
            name: row.name,
            source: './',
            description: 'RETIRED in 1.3.0 - run /alfred-code:update: it copies the skills and agents you picked into the project and removes this entry.',
            version,
            author,
            strict: false,
        };
        if (row.skills.length) entry.skills = row.skills.map((s) => `./stack/skills/${s}`);
        if (row.agents.length) entry.agents = row.agents.map((a) => `./stack/agents/${a}.md`);
        entry.dependencies = row.dependencies.map((d) => MARKETPLACE_RENAMES[d] || d);
        return entry;
    });
}

function serialize(entries)
{
    return JSON.stringify({
        generatedBy: 'build-marketplace',
        note: 'Generated by scripts/build-marketplace.js from meta/recommendations.json + meta/stack-graph.json. Do not edit by hand; run `npm run marketplace`.',
        entries,
    }, null, 2) + '\n';
}

// Puts the hooks entry into the live marketplace, in place, leaving every other entry - the
// hand-written core included - exactly where it was. The entry is GENERATED from the installer's
// wiring table, so this is a transcription, never a place to hand-edit a matcher.
function applyHooksPlugin(mkt, entry)
{
    const wanted = entry || hooksPlugin();
    const plugins = Array.isArray(mkt.plugins) ? mkt.plugins : (mkt.plugins = []);
    const at = plugins.findIndex(p => p && p.name === wanted.name);
    if (at >= 0) plugins[at] = wanted; else plugins.push(wanted);
    return mkt;
}

// Applies the generated entries to the live marketplace, the CORE entry included from Phase 3 on.
// Anything the generator does not own - the hooks entry, a hand-written extra - keeps its place,
// except a RETIRED name the entries no longer carry: it would keep a dead entry installable.
function applyToMarketplace(mkt, entries, { retired = [] } = {})
{
    const kept = (mkt.plugins || []).filter(p => !entries.some(e => e.name === p.name) && !retired.includes(p.name));
    mkt.plugins = kept.concat(entries);
    return mkt;
}

// ---------------------------------------------------------------------------------------------
// The hooks plugin entry. The wiring table has ONE home - the `HOOKS=(...)` array in
// scripts/os/claude-stack.sh, where each row is `file::matcher::args` and a matcher starting with
// `@` names its own event (`@Stop`, `@SessionStart:compact`) instead of PreToolUse. Parsing that
// array rather than retyping it is what keeps the plugin wiring and the settings.json wiring from
// drifting while both routes exist, and the lint fails when the generated entry goes stale.
//
// The hooks are declared INLINE in the marketplace entry, not through a `hooks/hooks.json` at the
// shared root: spike S9 assert (c) measured that a shared root is auto-discovered by every entry
// over it, and the Phase 1 and Phase 2 spikes measured that an inline block gives each entry its
// own hooks, fired once, for all six event types the stack uses.
const INSTALLER_SH = path.join(REPO, 'scripts/os/claude-stack.sh');

function parseHookWirings(file)
{
    const src = fs.readFileSync(file || INSTALLER_SH, 'utf8');
    const start = src.indexOf('\nHOOKS=(');
    if (start < 0) throw new Error('build-marketplace: no HOOKS=( array in the installer - the wiring table moved');
    const end = src.indexOf('\n)', start);
    if (end < 0) throw new Error('build-marketplace: the HOOKS=( array is not closed');
    const out = [];
    for (const line of src.slice(start, end).split('\n'))
    {
        const m = line.match(/^\s*"([^"]+)"/);
        if (!m) continue;
        const [file_, rawMatcher, rawArgs] = m[1].split('::');
        const wiring = { file: file_ };
        if (rawMatcher && rawMatcher.startsWith('@'))
        {
            const [event, matcher] = rawMatcher.slice(1).split(':');
            wiring.event = event;
            if (matcher) wiring.matcher = matcher;
        }
        else
        {
            wiring.event = 'PreToolUse';
            if (rawMatcher) wiring.matcher = rawMatcher;
        }
        const args = String(rawArgs || '').trim();
        if (args) wiring.args = args.split(/\s+/);
        out.push(wiring);
    }
    if (!out.length) throw new Error('build-marketplace: the HOOKS=( array parsed to nothing');
    return out;
}

function hooksBlock(wirings)
{
    const block = {};
    for (const w of wirings || parseHookWirings())
    {
        const list = block[w.event] || (block[w.event] = []);
        let group = list.find(b => String(b.matcher) === String(w.matcher));
        if (!group)
        {
            group = w.matcher === undefined ? { hooks: [] } : { matcher: w.matcher, hooks: [] };
            list.push(group);
        }
        group.hooks.push({ type: 'command', command: launch(`stack/hooks/${w.file}`, w.args), timeout: timeoutFor(w.file) });
    }
    return block;
}

function hooksPlugin(options = {})
{
    return {
        name: 'alfred-code-hooks',
        source: './',
        description: 'The seventeen alfred-code hooks, wired inline: the deterministic gates (force-push, catastrophic rm, whole-file reads, credential reads, ungated dispatch and commit, cross-project writes, weakened check configs, the stop contract, the answer budget, the fresh-session offer), a session monitor that never denies, plus the docs, memory and session-history hooks.',
        version: options.version || marketplaceVersion(options),
        author: options.author || { name: 'envoydev', url: 'https://github.com/envoydev' },
        strict: false,
        hooks: hooksBlock(options.wirings),
        dependencies: [CORE],
    };
}

// ---------------------------------------------------------------------------------------------
// The MCP plugin entries. Eight servers leave <repo>/.mcp.json and arrive as plugin-declared
// `mcpServers`, one plugin per server family. Two rulings shape what is written here, both in
// docs/superpowers/plans/2026-09-20-plugin-native-migration-phase-6.md and both measured:
//
//   R1 - the plugin is NAMED for its server (`serena`, not `alfred-code-mcp-serena`), because the
//        plugin name sits inside every tool name: `mcp__plugin_<plugin>_<server>__<tool>`, repeated
//        837 times across the shipped surfaces. The short name costs 14,000 fewer characters.
//   R3 - the version pins are resolved at RELEASE time from meta/mcp-pins.json, never from the
//        registry during a build and never at launch. `node scripts/refresh-mcp-pins.js --write`
//        moves a pin; a null version ships unpinned, the same fallback the installer had.
//
// Per-project values cannot come from the project settings.json: a plugin MCP entry expands only
// the SHELL and the ACCOUNT settings env (measured 2026-09-22 - S10's note to the contrary is
// retracted in docs/plugin-migration-evidence.md). What a plugin server DOES get is a cwd equal to
// the project dir, so the one server that needs a per-project value - memory, whose db path is the
// install's level choice - goes through a launcher that reads the project itself.
const PINS_FILE = path.join(REPO, 'meta/mcp-pins.json');

function readPins(options = {})
{
    const pins = options.pins || readJson(PINS_FILE, 'mcp-pins').pins || {};
    // '@<v>' for the npx/uvx packages, '==<v>' inside memory's extras brackets. A null version is
    // the offline fallback the installer already had: ship unpinned rather than ship nothing.
    const suffix = name =>
    {
        const row = pins[name];
        if (!row || !row.version) return '';
        return String(row.spelling || '@<v>').replace('<v>', row.version);
    };
    return { suffix, pins };
}

// The four browsers the playwright catalog entry expands into - ONE PLUGIN EACH, not one plugin
// declaring four servers. A plugin's servers all load together, so four in one entry would put four
// copies of playwright's tool schemas in every session of a project that kept a single browser; the
// registration route never did that (it wrote one server per KEPT engine), and the selection already
// knows which engines those are. One plugin per engine keeps that, and drops the `/mcp disable`
// step the one-entry shape would have needed.
const PW_ENGINES = ['chrome', 'msedge', 'firefox', 'webkit'];

// INVARIANT: one plugin, one server, SAME NAME. A plugin server's tools are addressed
// `mcp__plugin_<plugin>_<server>__<tool>`, so this is what makes every shipped tool name
// `mcp__plugin_<n>_<n>__<tool>` for a single `<n>` - readable, and mechanical to generate. Lint
// check 53 fails on any entry that breaks it.

function mcpServerShapes(options = {})
{
    const { suffix } = readPins(options);
    const proj = '${CLAUDE_PROJECT_DIR}';
    const root = '${CLAUDE_PLUGIN_ROOT}';
    const playwright = {};
    for (const engine of PW_ENGINES)
    {
        const name = `playwright-${engine}`;
        playwright[name] = {
            description: `playwright (${engine}) as a plugin: drive a real ${engine} browser for visual checks and web app verification. One plugin per engine, so a project pays only for the browsers it picked; the profile and the screenshot output dir live under the project's .playwright/${engine}.`,
            servers: {
                [name]: {
                    command: 'npx',
                    args: ['-y', `@playwright/mcp${suffix('playwright')}`, '--browser', engine,
                        `--user-data-dir`, `${proj}/.playwright/${engine}`,
                        `--output-dir`, `${proj}/.playwright/${engine}/output`],
                },
            },
        };
    }
    return {
        // --- the three locked servers -----------------------------------------------------------
        serena: {
            locked: true,
            description: 'serena as a plugin: LSP symbol navigation for the house stack. Per-project SERENA_HOME (.serena/home) keeps its registry, memories, logs and LSP cache out of every other project; --project-from-cwd self-activates the repo, which works because a plugin server\'s cwd IS the project dir (measured). Dashboard off, pinned PyPI package rather than a git ref, started through a launcher that pins the Python its compiled dependencies have wheels for (3.13; the x64 build on Windows on ARM).',
            servers: {
                serena: {
                    // The launcher, not uvx directly: it hands uvx the Python this MACHINE needs
                    // (stack/mcp/uv-python.js) - a fixed --python here is wrong on one OS or another.
                    command: 'node',
                    // SERENA_HOME stays RELATIVE: it resolves against the server's cwd, which is the
                    // project. An absolute path here would pool every project into one home.
                    env: { SERENA_HOME: '.serena/home' },
                    args: [`${root}/stack/mcp/serena-launch.js`, '--package', `serena-agent${suffix('serena')}`, '--', 'start-mcp-server',
                        // Always claude-code inside a Claude Code plugin; the ide-assistant value is
                        // cursor-stack's, and its own registration keeps it.
                        '--context', 'claude-code', '--enable-web-dashboard', 'false', '--project-from-cwd'],
                },
            },
        },
        context7: {
            locked: true,
            description: 'context7 as a plugin: up-to-date library, framework, SDK and CLI documentation, which beats recalled API knowledge. The hosted remote server - no local process, and no key in any file. This is the one the core depends on, so it can never be dropped; `--context7 local` adds the context7-local entry beside it for the npx transport.',
            servers: {
                context7: {
                    type: 'http',
                    url: 'https://mcp.context7.com/mcp',
                    // ':-' so an UNSET key sends an EMPTY header = the keyless free tier. A literal
                    // ${CONTEXT7_API_KEY} is rejected as an invalid key on every call (measured), and
                    // an unset ${VAR} with no default stays literal in a plugin entry too (S14).
                    headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' },
                },
            },
        },
        // The local transport is its OWN entry, not a second server in the one above: two servers in
        // one plugin both load, so every session would pay context7's schemas twice. `--context7
        // local` enables this one, and the installer prints the `/mcp disable context7` line - the
        // remote stays INSTALLED because the core depends on it, which is what keeps context7 locked.
        'context7-local': {
            description: 'context7 over the local npx transport, as a plugin: the same up-to-date library and framework documentation as the hosted server, run as a local process instead - for a setup that bakes CONTEXT7_API_KEY into the registration rather than reading it from the account settings. Added by `--context7 local`; disable the hosted `context7` server beside it, or both answer.',
            servers: {
                'context7-local': { command: 'npx', args: ['-y', `@upstash/context7-mcp${suffix('context7')}`] },
            },
        },
        memory: {
            locked: true,
            description: 'memory as a plugin: the shared recall the stack reads at every session start - preferences, corrections, project facts and agent lessons, searchable by meaning. The database path is the install\'s level choice (global, scoped or project), so this one server starts through a launcher that reads the project\'s own settings.json - a plugin entry cannot expand a PROJECT env key (measured).',
            servers: {
                memory: {
                    // The launcher, not uvx directly: cwd is the project, so it can read
                    // <cwd>/.claude/settings.json for ALFRED_CODE_MEMORY_DB and exec uvx itself.
                    command: 'node',
                    args: [`${root}/stack/mcp/memory-launch.js`, '--package',
                        `mcp-memory-service[sqlite]${suffix('memory')}`],
                    env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec',
                        // A shared file with several writers: the busy timeout is not optional.
                        MCP_MEMORY_SQLITE_PRAGMAS: 'busy_timeout=15000' },
                },
            },
        },
        // --- the five droppable servers ---------------------------------------------------------
        ...playwright,
        'angular-cli': {
            description: 'The Angular CLI MCP server as a plugin: workspace-aware Angular tooling. Unpinned on purpose - it matches the ng the workspace itself resolves.',
            servers: { 'angular-cli': { command: 'npx', args: ['-y', '@angular/cli', 'mcp'] } },
        },
        'chrome-devtools': {
            description: 'chrome-devtools as a plugin: browser and extension debugging through a full Chrome. Heavy, and it needs a real Chrome on the machine, so no stack seeds it - it is an opt-in pick.',
            servers: { 'chrome-devtools': { command: 'npx', args: ['-y', `chrome-devtools-mcp${suffix('chrome-devtools')}`] } },
        },
        'appium-mcp': {
            description: 'The official Appium MCP server as a plugin: native mobile end-to-end driving with the embedded UiAutomator2 and XCUITest drivers. Needs Xcode and/or the Android SDK plus Java, so no stack seeds it - it arrives pre-selected on an appium or webdriverio dependency.',
            servers: { 'appium-mcp': { command: 'npx', args: ['-y', `appium-mcp${suffix('appium-mcp')}`] } },
        },
        sentry: {
            description: 'Sentry\'s hosted remote MCP as a plugin: issues, events and releases from the project\'s own Sentry org. SENTRY_SLUG and SENTRY_ACCESS_TOKEN live in the ACCOUNT settings.json env; the auth header is built by a helper so the token never reaches a command line, and oauth mode simply sends no header.',
            servers: {
                sentry: {
                    type: 'http',
                    // The slug expands from the ACCOUNT settings env, which a plugin url DOES read
                    // (measured). Never '${SENTRY_SLUG:-}': the trailing slash 404s.
                    url: 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}',
                    // headersHelper is a STRING command - the object form is silently rejected and
                    // takes the whole server down to 'MCP servers (0)' (measured, S11). Settings-env
                    // keys do NOT expand here, so the helper reads the token itself; ${CLAUDE_PROJECT_DIR}
                    // does expand, and the helper needs it because its own cwd is the PLUGIN root.
                    // Both paths QUOTED: the string runs through a shell, so a space in either one
                    // split it - the script unfound, or the project's oauth pin unread.
                    headersHelper: `node "${root}/stack/mcp/sentry-headers.js" "${proj}"`,
                },
            },
        },
    };
}

function mcpPlugins(options = {})
{
    const shapes = options.shapes || mcpServerShapes(options);
    const version = options.version || marketplaceVersion(options);
    const author = options.author || { name: 'envoydev', url: 'https://github.com/envoydev' };
    return Object.entries(shapes).map(([name, spec]) =>
    {
        const entry = {
            name,
            source: './',
            description: spec.description,
            version,
            author,
            strict: false,
            mcpServers: spec.servers,
        };
        // The locked three depend on nothing: the installer puts them beside the core on every run,
        // and an entry with no dependency can never be disabled at load for a missing one. The
        // droppable five are ordinary picks and name the core the way the hooks entry does.
        if (!spec.locked) entry.dependencies = [CORE];
        return entry;
    });
}

function applyMcpPlugins(mkt, entries)
{
    const wanted = entries || mcpPlugins();
    const plugins = Array.isArray(mkt.plugins) ? mkt.plugins : (mkt.plugins = []);
    for (const w of wanted)
    {
        const at = plugins.findIndex(p => p && p.name === w.name);
        if (at >= 0) plugins[at] = w; else plugins.push(w);
    }
    // PRUNE what this generator used to own. An MCP entry carries servers and nothing else, so it
    // is recognisable without a list of past names - which matters, because a regeneration that
    // only adds leaves a renamed or split entry (playwright -> one plugin per engine) behind in the
    // marketplace, enabled on every machine that already installed it.
    const keep = new Set(wanted.map(w => w.name));
    const ownedByMcp = p => p && p.mcpServers && !p.skills && !p.agents && !p.commands && !p.hooks;
    for (let i = plugins.length - 1; i >= 0; i--)
        if (ownedByMcp(plugins[i]) && !keep.has(plugins[i].name)) plugins.splice(i, 1);
    return mkt;
}

function main(argv)
{
    const arg = (flag, fallback) =>
    {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
    };
    const entriesFile = path.resolve(arg('--entries', ENTRIES_FILE));
    const options = {};
    if (argv.includes('--graph')) options.graph = readJson(path.resolve(arg('--graph')), 'stack-graph');
    if (argv.includes('--recs')) options.recs = readJson(path.resolve(arg('--recs')), 'recommendations');

    const place = placement(options);
    const entries = buildEntries({ ...options, placement: place });

    if (argv.includes('--mcp-entries'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const entries = mcpPlugins(options);
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const after = JSON.stringify(applyMcpPlugins(mkt, entries), null, 2) + '\n';
        if (before === after) { console.log(`mcp entries current: ${entries.length} plugins`); return 0; }
        fs.writeFileSync(file, after);
        const servers = entries.reduce((n, e) => n + Object.keys(e.mcpServers).length, 0);
        console.log(`mcp entries written: ${entries.length} plugins / ${servers} servers -> ${path.relative(REPO, file)}`);
        return 0;
    }

    if (argv.includes('--hooks-entry'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const after = JSON.stringify(applyHooksPlugin(mkt), null, 2) + '\n';
        if (before === after) { console.log('hooks entry current: no change'); return 0; }
        fs.writeFileSync(file, after);
        console.log(`hooks entry written: ${Object.keys(hooksPlugin().hooks).length} event(s) -> ${path.relative(REPO, file)}`);
        return 0;
    }

    const wanted = serialize(entries);
    if (argv.includes('--check'))
    {
        let have = null;
        try { have = fs.readFileSync(entriesFile, 'utf8'); } catch { /* absent counts as stale */ }
        if (have === wanted) { console.log(`plugin entries current: ${entries.length} entries`); return 0; }
        console.error(`plugin entries are STALE: ${path.relative(REPO, entriesFile)} - run \`npm run marketplace\``);
        return 1;
    }
    if (argv.includes('--write-marketplace'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const { loadManifest } = require('./install/manifest.js');
        const listed = entries.concat(retiredMarketplaceEntries());
        const applied = applyRenames(applyToMarketplace(mkt, listed, { retired: loadManifest(REPO).retired.plugins }));
        const after = JSON.stringify(applied, null, 2) + '\n';
        if (before === after) { console.log(`marketplace current: ${listed.length} entries`); return 0; }
        fs.writeFileSync(file, after);
        console.log(`marketplace written: ${listed.length} entries -> ${path.relative(REPO, file)}`);
        return 0;
    }
    if (argv.includes('--write'))
    {
        fs.writeFileSync(entriesFile, wanted);
        console.log(`plugin entries written: ${entries.length} entries -> ${path.relative(REPO, entriesFile)}`);
        return 0;
    }
    console.error('usage: build-marketplace.js --write | --write-marketplace | --check | --hooks-entry | --mcp-entries');
    return 1;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { buildEntries, coreEntry, retiredMarketplaceEntries, serialize, applyToMarketplace, applyHooksPlugin, applyMcpPlugins, applyRenames, MARKETPLACE_RENAMES, mcpPlugins, mcpServerShapes, readPins, PW_ENGINES, parseHookWirings, hooksBlock, hooksPlugin, get HOOKS_PLUGIN() { return hooksPlugin(); }, ENTRIES_FILE, PINS_FILE };
