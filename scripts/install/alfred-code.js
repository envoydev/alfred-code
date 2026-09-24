#!/usr/bin/env node
'use strict';
// THE NODE SEED - one installer instead of the sh / ps1 twins (Phase 7).
//
// Node is already a hard prerequisite (every hook runs on it), so this adds no runtime dependency
// and removes the twin-parity tax: a bug gets fixed once, a flag gets added once, and a Windows
// path is the same code path as a macOS one rather than a second implementation of it.
//
// This file is the ORDER and nothing else. Every decision lives in a layer module beside it, every
// side effect arrives as an injected function, and the sequence below is the shell's own - the one
// property a rewrite must not quietly change, because each step depends on what the previous one
// left on disk (the plugins are enabled before the copied files they replace are pruned; the stamp
// is written after every copy step, so it only ever names a revision that fully landed).
//
// The twins stay reachable behind `ALFRED_CODE_SEED=shell` for one release (R1): there is no
// Windows machine here, and `pwsh` on macOS proves PowerShell syntax, never Windows path semantics.
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, FLAG_LIST } = require('./args.js');
const { createSource } = require('./source.js');
const { loadManifest } = require('./manifest.js');
const selection = require('./selection.js');
const plugins = require('./plugins.js');
const { pythonRequest } = require('../../stack/mcp/uv-python.js');
const { serenaHomeFor } = require('../../stack/mcp/serena-launch.js');
const mcp = require('./mcp.js');
const copy = require('./copy.js');
const settings = require('./settings.js');
const serena = require('./serena.js');
const memory = require('./memory.js');
const docs = require('./docs.js');
const { deriveState, writable, homeOf, splitPick } = require('../derive-state.js');
const { placement, readRetiredEntries, CORE } = require('../plugin-placement.js');
const seeds = require('./seeds.js');
const pinsLayer = require('./pins.js');
const stampLayer = require('./stamp.js');
const library = require('./library.js');
const runtime = require('./runtime.js');
const { envMigrations } = require('./env-migrations.js');
const { BRAND, LEGACY, marketOf } = require('./brand.js');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

const USAGE = `alfred-code - install or update the Claude Code stack into a project.

Usage: node ${path.basename(__filename)} <install|update> [flags]

Action (one is REQUIRED, positional):
  install   first-time provision; wires .claude/settings.json
  update    refresh hooks/agents/rules and re-resolve the runtimes; idempotent

Named flags (any order, each optional): ${FLAG_LIST}

Every flag means exactly what it means on scripts/os/claude-stack.sh - this is a rewrite, not a
redesign. Run \`bash scripts/os/claude-stack.sh --help\` for what each one does.`;

// The fresh-install spelling. A 1.x install keeps its own marketplace key, so every stack spec of a
// run is spelled with the key it resolved (`ctx.market`), never with this constant.
const HOOKS_PLUGIN = `${BRAND.hooks}@${BRAND.marketplace}`;
const { CORE_DEP_PLUGINS } = plugins;
// D1: the frozen twins hardcode the 1.x names, which a 2.0.0 registration cannot resolve.
const SHELL_SEED_RETIRED = 'the shell seed was retired in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer'; // legacy-name
const SENTRY_URL = 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}';
const SENTRY_HEADER = 'Authorization: Sentry-Bearer ${SENTRY_ACCESS_TOKEN}';
// permissions.deny, the Read-tool half of the credential gate: it reaches the Read TOOL ONLY (a
// shell `cat` of a denied file is not blocked by anything here - guard-secret-value.js is that
// route). RETIRED_DENY are the four ACCOUNT-settings entries releases up to 0.2.62 wrote; they are
// dropped on every run, by exact string.
const SECRET_DENY = ['Read(.env)', 'Read(.env.*)', 'Read(*.pem)', 'Read(*.pfx)', 'Read(*.p12)', 'Read(*.key)'];
const RETIRED_DENY = [
    'Read(~/.claude/settings.json)', 'Read(~/.claude/settings.local.json)',
    'Read(~/.claude-*/settings.json)', 'Read(~/.claude-*/settings.local.json)',
];
// The three hook ENGINES and the window table are copied beside the hooks rather than wired: 22
// bodies shared with cursor-stack run `node .claude/hooks/docs.js`, and the history start block
// points at `node .claude/hooks/history.js rulings`.
const HOOK_ENGINES = ['docs.js', 'memory.js', 'history.js', 'model-windows.json'];

function main(argv, env = process.env, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) })
{
    const { out, err } = io;
    if (envOf(env, 'SEED') === 'shell') { err(`${SHELL_SEED_RETIRED}\n`); return 1; }
    const cwd = io.cwd || process.cwd();
    const rt = io.runtime || runtime;

    let failures = 0;
    const log = (m) => out(`==> ${m}\n`);
    const plain = (m) => out(`${m}\n`);
    const note = (m) => { failures += 1; out(`==>   !! ${m}\n`); };

    let args;
    try { args = parseArgs(argv, env); }
    catch (e) { err(`${USAGE}\nerror: ${e.message}\n`); return 1; }

    const home = env.HOME || env.USERPROFILE || '';
    const configDir = env.CLAUDE_CONFIG_DIR
        || path.join(home, args.space ? `.claude-${args.space}` : '.claude');
    const projectRoot = rt.gitRoot(cwd) || cwd;
    // The flag says project|global; the claude CLI says project|user. A global install puts the
    // skills and the stamp in the account dir and makes every plugin / MCP call user-scoped; the
    // rules, agents, hooks and settings.json stay in the project, exactly as on the twin - the
    // bodies run `node .claude/hooks/docs.js` from the project, and the docs-root rule is stamped there.
    const cliScope = args.scope === 'global' ? 'user' : 'project';
    const claudeDir = path.join(projectRoot, '.claude');
    const skillsDir = args.scope === 'global' ? path.join(configDir, 'skills') : path.join(projectRoot, '.claude', 'skills');
    // What this run READS of the last install: the new stamp, else a 1.x install's under its old name.
    const stampFile = stampLayer.stampFiles({ scope: args.scope, configDir, projectRoot }).read;
    const mcpFile = path.join(projectRoot, '.mcp.json');
    const hasClaude = rt.which('claude');

    const repoUrl = env.ALFRED_CODE_REPO_URL || 'https://github.com/envoydev/alfred-code';
    const source = createSource({
        configDir,
        sourceDir: args.source,
        repoUrl,
        log, note,
        gitRevision: rt.gitRevision,
        // The two outward routes: reached only when neither --source nor the plugin cache answered,
        // which is a machine with no `claude` CLI, or a first run before the core plugin lands.
        fetchArchive: () => rt.fetchArchive({ repoUrl }),
        clone: () => rt.cloneMain({ repoUrl }),
    });

    const cli = hasClaude
        ? rt.cliRunner('claude', { cwd: projectRoot, env, out: plain })
        : () => false;
    // The marketplaces this run already refreshed, so no later pass pays the round trip twice.
    const refreshed = new Set();

    // THE MARKETPLACE KEY every stack spec of this run is spelled with: the key whose core is installed
    // (a 1.x install keeps `claude-stack`), else a registration of the stack's repo, else the current // legacy-name
    // name - read from the listings, never assumed (brand.js marketOf).
    const readRaw = () => (hasClaude ? rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env }) : '');
    const readMarkets = () => (hasClaude ? plugins.parseMarketplaces(rt.capture('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: projectRoot, env })) : []);
    let market = BRAND.marketplace;
    let marketSeen = { listing: [], marketplaces: [] };
    let rawListing = null;

    try
    {
        // With no --source the snapshot is the newest core entry in the plugin cache - so the core is
        // updated FIRST, or the run installs the release it is replacing. A handed --source was
        // resolved by a command that already did this (setup-plugin/references/source-protocol.md).
        // A plan is read-only: it changes no plugin, so it reads the cache as it stands.
        if (!args.source && !args.printPlan && hasClaude && plugins.corePluginOn(plugins.pluginRoutes(env)))
        {
            market = plugins.refreshStackSource({
                listing: () => plugins.parsePluginList(readRaw(), projectRoot, { byMarketplace: true }),
                marketplaces: readMarkets(), readMarketplaces: readMarkets,
                cli, refreshed, log, env,
            });
            marketSeen = null;          // registered and refreshed already - bootstrapSource has nothing to add
        }
        else if (hasClaude)
        {
            rawListing = readRaw();
            marketSeen = { listing: plugins.parsePluginList(rawListing, projectRoot, { byMarketplace: true }), marketplaces: readMarkets() };
            market = marketOf({ ...marketSeen, env }).key;
        }
        if (market !== BRAND.marketplace) log(`marketplace: ${market} (the key this install was registered under)`);
        const resolved = source.resolve();
        if (!resolved) return 1;
        log(`action: ${args.action} [scope=${args.scope}, account=${configDir}]`);

        const manifest = loadManifest(resolved.dir);

        // --- the six lists, narrowed to this project -------------------------------
        let lists = {
            skills: manifest.skills, agents: manifest.agents, rules: manifest.rules,
            hooks: manifest.hooks, plugins: manifest.plugins, mcps: manifest.mcps,
        };
        const routes = plugins.pluginRoutes(env);

        let picked = null;
        // On --installed-only, what the user PICKED (disk, the stamp's picks, --add, what those
        // require) - the stamp records that, never everything the enabled entries carry, or the next
        // closure would run over items no one picked.
        let stampPicks = null;
        let carriedPicks = null;
        let listedEngines = [];
        // The whole listing, read once: the read-back, --plan-out and a --drop's disable all use it.
        let listing = null;
        // The stack entries a --drop took out of the plugin set - disabled by the plugins layer, or
        // the dropped skill keeps loading through them.
        let dropEntries = [];
        let leftOut = [];
        const always = readJson(path.join(resolved.dir, 'meta', 'recommendations.json')).always || {};
        // The off-state surfaces this run may write back: a walk's selection answers the agents
        // layer, and the hooks layer when it carries hook lines (none = every hook, as on disk); a
        // read-back answers only what it found evidence of.
        let answered = { hooks: true, agents: true };
        if (args.installedOnly)
        {
            const raw = rawListing ?? readRaw();
            listing = plugins.parsePluginList(raw, projectRoot);
            const stackListing = plugins.parsePluginList(raw, projectRoot, { marketplace: market });
            const lastPicked = stampLayer.readPicked(stampFile);
            const back = selection.readBack({
                claudeDir, skillsDir,
                mcpServers: Object.keys(readJson(mcpFile).mcpServers || {}),
                listing, stackListing,
                settings: readJson(path.join(claudeDir, 'settings.json')),
                routes, manifest, sourceDir: resolved.dir,
                stampHooks: readStampHooks(stampFile),
                stampPicked: lastPicked,
                always, marketplace: market, log,
            });
            if (!back.installed)
            {
                err(`error: --installed-only found nothing installed under ${claudeDir} - run 'install' (or /alfred-code:init) first\n`);
                return 1;
            }
            leftOut = selection.leftOut({ parked: back.parked, deny: back.deny });
            const withAdds = selection.addLines(back.lines, args.add, log);
            const graph = readJson(path.join(resolved.dir, 'meta', 'stack-graph.json'));
            // The always-on rules and servers are locked: the read-back adopts them whatever the disk
            // says, so a drop of one would come straight back on the next update.
            const locked = new Set([...(always.rules || []).map((n) => `rule ${n}`), ...(always.mcps || []).map((n) => `mcp ${n}`)]);
            for (const l of args.drop.filter((d) => locked.has(d)))
                log(`installed-only: --drop ${l} not applied - locked, every install carries it`);
            const drops = args.drop.filter((d) => !locked.has(d));
            // A drop runs BEFORE the closure, so an item something kept still requires comes straight
            // back and is reported - the walk's own closure would have kept it, and a drop the next
            // update's closure undoes is no drop at all.
            const withDrops = selection.dropLines(withAdds, drops, log);
            const close = (lines, from, say) => selection.closeLines(lines, { from, graph: graph.catalog ? graph : null, parked: back.parked, deny: back.deny, log: say });
            const from = [...back.closeFrom, ...args.add].filter((l) => !drops.includes(l));
            let closed = close(withDrops, from, log);
            // A layer the closure brought in (a skill requiring context7 in an install that carried
            // no server) is carried now, so the locked set joins it in THIS run - adopted only by the
            // next update, one update was not the fixed point.
            const adopted = selection.adoptAlways({ lines: closed, always, log });
            if (adopted.length > closed.length)
                closed = close(adopted, [...from, ...adopted.filter((l) => !closed.includes(l))], log);
            args.dropApplied = drops.filter((l) => !closed.includes(l));
            for (const l of drops.filter((d) => closed.includes(d)))
                log(`installed-only: --drop ${l} not applied - something kept requires it (named in the required line above)`);
            if (args.dropApplied.length)
                dropEntries = droppedByDrop({ kept: close(withAdds, [...back.closeFrom, ...args.add], () => {}), closed, stackListing, sourceDir: resolved.dir, drop: args.dropApplied, routes, market, log });
            stampPicks = new Set(closed.filter((l) => back.closeFrom.includes(l) || args.add.includes(l) || !withDrops.includes(l)));
            // A blind read keeps every pick the last stamp recorded and this run cannot see, verbatim
            // with its home, so the next update with a readable listing still carries it across.
            if (back.blind && lastPicked)
            {
                const unseen = (line) => (e) => !stampPicks.has(`${line} ${splitPick(e).name}`) && !args.dropApplied.includes(`${line} ${splitPick(e).name}`);
                carriedPicks = { skills: lastPicked.skills.filter(unseen('skill')), agents: lastPicked.agents.filter(unseen('agent')) };
            }
            picked = selection.parseSelection(closed.join('\n'));
            answered = back.answered;
            listedEngines = back.engines;
            if (back.context7Local && !args.context7Given)
            { args.context7 = 'local'; log('installed-only: context7 stays local - its local entry is enabled here'); }
        }
        else if (args.selection)
        {
            let text;
            try { text = fs.readFileSync(args.selection, 'utf8'); }
            catch { err(`selection file not found: ${args.selection}\n`); return 1; }
            picked = selection.parseSelection(text);
            answered = { hooks: [...picked].some((l) => l.startsWith('hook ')), agents: true };
        }
        if (picked) lists = selection.applySelection(lists, picked);
        for (const line of args.add)
        {
            const [category, name] = line.split(' ');
            const key = Object.keys(selection.CATEGORY).find((k) => selection.CATEGORY[k].line === category);
            if (!(lists[key] || []).some((e) => selection.CATEGORY[key].name(e) === name))
                note(`--add ${line} names nothing this release ships - ignored`);
        }

        // --- the two entries assembled at install time -----------------------------
        const pins = args.printPlan
            ? { CTX7_PIN: '', PW_PIN: '', SERENA_PIN: '', MEMORY_PIN: '', CD_PIN: '', AP_PIN: '', MEMORY_BACKEND: 'sqlite_vec' }
            : mcp.resolvePins({ npmLatest: npmLatest(rt), pypiLatest: pypiLatest(rt), log });

        const level = memory.resolveLevel({
            flag: args.memoryLevel,
            registeredPath: registeredMemoryPath(mcpFile),
            home, space: args.space, projectRoot,
        });

        // context7 travels as ONE catalog row with two transports: the hosted remote, or the npx
        // one that `--context7 local` adds beside it.
        lists.mcps = mcp.resolveContext7(lists.mcps, { mode: args.context7, pin: pins.CTX7_PIN });

        const pw = mcp.expandPlaywright({
            mcps: lists.mcps,
            browsers: args.playwrightBrowsers,
            registered: [...new Set([...registeredEngines(mcpFile), ...listedEngines])],
            enabled: args.playwrightEnabled,
        });
        lists.mcps = pw.mcps;

        if (args.printPlan)
        {
            for (const line of selection.renderPlan(lists)) plain(line);
            plain(`plan answered: hooks=${answered.hooks ? 'yes' : 'no'} agents=${answered.agents ? 'yes' : 'no'}`);
            plain(`plan routes: skills=${routes.skills ? 'plugin' : 'copy'} hooks=${routes.hooks ? 'plugin' : 'copy'} mcps=${routes.mcps ? 'plugin' : 'copy'}`);
            if (args.planOut)
            {
                if (!listing) listing = hasClaude ? plugins.parsePluginList(rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env }), projectRoot) : [];
                const inv = selection.planInventory({
                    lists, listing, answered, leftOut, pluginCatalog: manifest.catalogs.plugins.map((id) => id.split('@')[0]),
                });
                fs.writeFileSync(args.planOut, JSON.stringify(inv, null, 2) + '\n');
            }
            return 0;
        }

        // --- the run ---------------------------------------------------------------
        const tokens = {
            SERENA_CONTEXT: 'claude-code', MEMORY_DB_PATH: level.dbPath,
            // The copy route's `uvx --python`: the same machine-level answer the plugin launchers use.
            // Read from the SEED's own tree, never the snapshot's: a snapshot older than the seed has no
            // such file, and its manifest then carries no @UV_PYTHON@ to resolve anyway.
            UV_PYTHON: pythonRequest({ env, projectDir: projectRoot }),
            // serena's home in the platform's own separator: a '/' reaches cmd.exe on Windows.
            SERENA_HOME: serenaHomeFor(),
            SERENA_PIN: pins.SERENA_PIN, PW_PIN: pins.PW_PIN, CTX7_PIN: pins.CTX7_PIN,
            MEMORY_PIN: pins.MEMORY_PIN, CD_PIN: pins.CD_PIN, AP_PIN: pins.AP_PIN, MEMORY_BACKEND: pins.MEMORY_BACKEND,
        };
        const remotes = {
            sentry: { url: SENTRY_URL, header: args.sentryAuth === 'oauth' ? '' : SENTRY_HEADER },
            context7: mcp.CONTEXT7_REMOTE,
        };
        const ctx = {
            args, env, log, note, plain, cli, rt, source: resolved, manifest, lists, routes,
            projectRoot, claudeDir, skillsDir, configDir, mcpFile, home, stampFile,
            pins, tokens, remotes, level, hasClaude, picked, answered, dropEntries, cliScope, refreshed,
            market, marketSeen, readMarkets,
        };

        const pinSnapshot = args.keepPins
            ? pinsLayer.snapshotPins({ files: pinFiles(ctx), log })
            : null;

        copy.removeDropped({
            drop: args.dropApplied || [], log,
            dirs: { skill: skillsDir, agent: path.join(claudeDir, 'agents'), rule: path.join(claudeDir, 'rules'), hook: path.join(claudeDir, 'hooks') },
            shipped: {
                skill: manifest.catalogs.skills.map((e) => e.split('|').pop()),
                agent: manifest.agents.map((e) => e.replace(/\.md$/, '')),
                rule: manifest.rules.map((e) => e.replace(/\.md$/, '')),
                hook: manifest.catalogs.hooks.map((e) => e.split('::')[0].replace(/\.js$/, '')),
            },
        });
        runLayers(ctx);

        if (pinSnapshot) pinsLayer.restorePins({ snapshot: pinSnapshot, files: pinFiles(ctx), log });

        stampLayer.writeStamp({
            source: resolved, action: args.action, scope: args.scope, configDir, projectRoot, mcpFile,
            hooksCatalog: manifest.catalogs.hooks, version: releaseVersion(resolved.dir), log, note,
            picked: stampPickLists(lists, stampPicks, carriedPicks),
            library: ctx.library || { skills: {}, agents: {} },
        });

        summarise(ctx, failures);
        return failures ? 0 : 0;   // fail-soft by design: a step that failed is REPORTED, never fatal
    }
    catch (e)
    {
        err(`error: ${e.message}\n`);
        return 1;
    }
    finally { source.cleanup(); }
}

// The shell's own order. Every step depends on what the one before it left on disk.
function runLayers(ctx)
{
    const { args } = ctx;
    bootstrapSource(ctx);
    installSkillsAndAgents(ctx);
    installPlugins(ctx);
    installMcps(ctx);
    seeds.seedAccountKeys({ configDir: ctx.configDir, sentrySlug: ctx.args.sentrySlug, env: ctx.env, log: ctx.log, note: ctx.note });
    installHooksAndRules(ctx);
    importMemory(ctx);
    docs.migrateDocsDomains({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot), log: ctx.log });
    if (args.action === 'install') seeds.seedClaudeMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, log: ctx.log, note: ctx.note });
    serena.seedProject({
        projectRoot: ctx.projectRoot,
        selected: ctx.lists.mcps.some((e) => e.startsWith('serena|')),
        log: ctx.log,
    });
    seeds.playwrightDownloads({
        browsers: ctx.lists.mcps.filter((e) => e.startsWith('playwright-')).map((e) => e.split('|')[0].slice(11)),
        pin: ctx.pins.PW_PIN,
        run: (engine) => ctx.rt.runNode !== undefined && npxInstall(ctx, engine),
        log: ctx.log,
    });
    downconvert(ctx);
}

// A first run with no plugin cache installs the core entry FIRST, so its cache can serve the same
// run - which is what makes the common run download nothing at all.
//
// The registration goes through the plugin layer's one rule: a 1.x key is registered already (a second
// registration of the new slug would list the stack twice), and a fresh account's key is whatever the
// add produced - read back here, before the first spec is spelled with it.
function bootstrapSource(ctx)
{
    if (!ctx.hasClaude || !plugins.corePluginOn(ctx.routes)) return;
    if (ctx.marketSeen)
        ctx.market = plugins.stackMarket({ ...ctx.marketSeen, readMarketplaces: ctx.readMarkets, cli: ctx.cli, env: ctx.env });
    plugins.refreshMarketplaces({ plugins: [`${BRAND.core}@${ctx.market}`], cli: ctx.cli, refreshed: ctx.refreshed });
}

// Remove each named copy the stack itself shipped. A file no list names is the project's own and is
// never touched.
function pruneCopies(ctx, dir, names, label, why)
{
    for (const name of names)
    {
        const target = path.join(dir, name);
        if (!fs.existsSync(target)) continue;
        fs.rmSync(target, { recursive: true, force: true });
        ctx.log(`  ${label} pruned (${why}): ${name}`);
    }
}

function installSkillsAndAgents(ctx)
{
    const closure = plugins.resolveStackPlugins({
        routes: ctx.routes,
        runSelection: () => runSelectionPlugins(ctx),
        log: ctx.log,
    });
    ctx.routes = closure.routes;
    ctx.stackEntries = closure.entries;

    // On the plugin route only the LIBRARY travels by copy, and a leftover copy SHADOWS the plugin's
    // own with no error and no sign in the transcript - so the prune runs BEFORE the enable.
    const skillNames = ctx.lists.skills.map((e) => e.split('|').pop());
    // The same holds for a seat: a project agent outranks the plugin's own, so a leftover copy keeps
    // the old seat running. What a release retired goes on either route.
    const agentsDir = path.join(ctx.claudeDir, 'agents');
    pruneCopies(ctx, ctx.skillsDir, ctx.manifest.retired.skills, 'skill', 'retired upstream');
    pruneCopies(ctx, agentsDir, ctx.manifest.retired.agents, 'agent', 'retired upstream');
    if (ctx.routes.skills)
    {
        // A core item's copy would shadow the plugin's own; a library item this run did not pick is
        // switched off, and its absence is how.
        const core = placement().plugins[CORE];
        const unpicked = (names, picked) => names.filter((n) => !picked.includes(n));
        const skills = unpicked(ctx.manifest.skills.map((e) => e.split('|').pop()), closure.extraSkills);
        const agents = unpicked(ctx.manifest.agents.map((f) => f.replace(/\.md$/, '')), closure.extraAgents);
        pruneCopies(ctx, ctx.skillsDir, skills.filter((n) => core.skills.includes(n)), 'skill', 'now carried by a plugin');
        pruneCopies(ctx, ctx.skillsDir, skills.filter((n) => !core.skills.includes(n)), 'skill', 'library item not picked');
        pruneCopies(ctx, agentsDir, agents.filter((n) => core.agents.includes(n)).map((n) => `${n}.md`), 'agent', 'now carried by a plugin');
        pruneCopies(ctx, agentsDir, agents.filter((n) => !core.agents.includes(n)).map((n) => `${n}.md`), 'agent', 'library item not picked');
        ctx.library = library.copyLibrary({
            sourceDir: ctx.source.dir, skillsDir: ctx.skillsDir, agentsDir,
            skills: closure.extraSkills, agents: closure.extraAgents,
            stamped: stampLayer.readLibrary(ctx.stampFile), log: ctx.log, note: ctx.note,
        });
        return;
    }

    fs.mkdirSync(ctx.skillsDir, { recursive: true });
    for (const name of skillNames)
    {
        const src = path.join(ctx.source.dir, 'stack', 'skills', name);
        if (!fs.existsSync(src)) { ctx.note(`skill '${name}' not found in the stack source`); continue; }
        fs.rmSync(path.join(ctx.skillsDir, name), { recursive: true, force: true });
        fs.cpSync(src, path.join(ctx.skillsDir, name), { recursive: true });
        ctx.log(`skill [${ctx.args.scope}]: ${name}`);
    }

    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'agents'), label: 'agent',
        destDir: agentsDir, files: ctx.lists.agents, log: ctx.log, note: ctx.note,
    });
}

function installPlugins(ctx)
{
    if (!ctx.hasClaude) { ctx.note('the claude CLI is not on PATH - the plugin and MCP layers were skipped'); return; }
    // One row per name@marketplace: the set mixes official picks with stack entries, and the official
    // catalog ships names the stack uses too.
    const readListing = () => plugins.parsePluginList(ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env }), ctx.projectRoot, { byMarketplace: true });
    const listing = readListing();
    const set = plugins.pluginSet({
        routes: ctx.routes, thirdParty: ctx.lists.plugins, hooksPlugin: `${BRAND.hooks}@${ctx.market}`,
        stackEntries: ctx.stackEntries || [], coreDeps: CORE_DEP_PLUGINS, locked: mcp.LOCKED, market: ctx.market,
    });
    const marketplaces = plugins.extraMarketplaces(ctx.manifest.rows.plugins, set);
    // The per-stack entries retired in 1.3.0 come from the seed's own file, never the twins' lists:
    // only this route copies their picks before they go. The ones still installed after this run are
    // what the settings writer keeps a seat's old deny spelling for; an unreadable listing says
    // nothing, so it keeps them all.
    const carriers = readRetiredEntries(ctx.source.dir).map((e) => e.name);
    // The 1.x core counts as a live home of its seat denies while the listing still carries its old id
    // (a rename no session has taken yet) - never uninstalled here: it IS the core.
    const oldCore = listing.some((r) => r.name === LEGACY.core) ? [LEGACY.core] : [];
    const installed = (gone = []) => (listing.length ? carriers.filter((n) => plugins.fieldOf(listing, n, 'version') && !gone.includes(n)).concat(oldCore) : null);
    ctx.liveCarriers = installed();
    if (ctx.args.action === 'update')
    {
        const gone = plugins.prunedRetired({ listing, retired: [...new Set([...ctx.manifest.retired.plugins, ...carriers])], carriers, scope: ctx.cliScope, cli: ctx.cli, log: ctx.log });
        ctx.liveCarriers = installed(gone);
        plugins.updatePlugins({
            plugins: set, scope: ctx.cliScope, marketplaces, before: listing, refreshed: ctx.refreshed, cli: ctx.cli, log: ctx.log,
            after: readListing,
        });
        for (const row of ctx.dropEntries || [])
        {
            const spec = `${row.name}@${row.marketplace}`;
            // An entry enabled at ANOTHER scope belongs to that scope's install too - an account-wide
            // entry a project run disabled would vanish from every other project. Said, not done.
            if (row.scope !== ctx.cliScope) { ctx.log(`  ${spec} is enabled at ${row.scope} scope, not this run's - if nothing else needs it: claude plugin disable ${spec} --scope ${row.scope}`); continue; }
            if (ctx.cli(['plugin', 'disable', spec, '--scope', row.scope], { quiet: true })) ctx.log(`plugin disabled [${row.scope}]: ${spec} (nothing kept needs it after --drop)`);
            else ctx.note(`plugin disable failed: ${spec} - disable it by hand: claude plugin disable ${spec} --scope ${row.scope}`);
        }
        return;
    }
    plugins.installPlugins({
        plugins: set, scope: ctx.cliScope, marketplaces, before: listing, refreshed: ctx.refreshed, cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
}

function installMcps(ctx)
{
    if (!ctx.hasClaude) return;
    const retired = mcp.retiredMcps({ routes: ctx.routes, catalog: ctx.manifest.catalogs.mcps, authored: ctx.manifest.retired.mcps });
    for (const name of retired)
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true })) ctx.log(`  mcp pruned: ${name}`);

    if (ctx.routes.mcps)
    {
        ctx.log('mcp: carried by the plugins (serena, context7, memory, and the picks) - nothing registered here');
        return;
    }
    for (const name of mcp.playwrightDrop({ routes: ctx.routes, browsers: pwEngines(ctx) }))
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true })) ctx.log(`  mcp removed: ${name}`);

    const live = ctx.lists.mcps.filter((e) => !(mcp.isLocked(e.split('|')[0]) && mcp.corePluginOn(ctx.routes)));
    for (const entry of live)
    {
        const name = entry.split('|')[0];
        const args = entry.slice(entry.indexOf('|') + 1);
        if (ctx.args.action === 'update') ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true });
        else if (ctx.cli(['mcp', 'get', name], { quiet: true })) { ctx.plain(`  mcp ${name} already configured - skipping`); continue; }
        ctx.log(`mcp [${ctx.args.scope}]: ${name}`);
        if (!ctx.cli(mcp.registerSpec({ name, args, scope: ctx.cliScope, remotes: ctx.remotes, tokens: ctx.tokens })))
            ctx.note(`mcp ${name} failed`);
    }

    // Read the RESULT back: `claude mcp add` over an existing name exits 0 without writing.
    const expects = live.map((e) => mcp.expectShape({
        name: e.split('|')[0], args: e.slice(e.indexOf('|') + 1), remotes: ctx.remotes, tokens: ctx.tokens,
    }));
    if (ctx.args.scope === 'project') mcp.verifyProject({ mcpFile: ctx.mcpFile, expects, log: ctx.log });
    else mcp.verifyUser({
        expects, scope: ctx.cliScope,
        getShape: (name) => ctx.rt.capture('claude', ['mcp', 'get', name], { cwd: ctx.projectRoot, env: ctx.env }),
        reregister: (name) =>
        {
            const entry = live.find((e) => e.split('|')[0] === name);
            ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true });
            ctx.cli(mcp.registerSpec({ name, args: entry.slice(entry.indexOf('|') + 1), scope: ctx.cliScope, remotes: ctx.remotes, tokens: ctx.tokens }), { quiet: true });
        },
        log: ctx.log, note: ctx.note,
    });
}

function installHooksAndRules(ctx)
{
    // On the plugin route a copied hook is dead weight once unwired, so its file goes too; what a
    // release retired goes on either route, file and wiring together.
    const catalogHooks = [...new Set(ctx.manifest.catalogs.hooks.map((e) => e.split('::')[0]))];
    pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), ctx.manifest.retired.hooks, 'hook', 'retired upstream');
    if (ctx.routes.hooks) pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), catalogHooks, 'hook', 'now carried by a plugin');
    pruneCopies(ctx, path.join(ctx.claudeDir, 'rules'), ctx.manifest.retired.rules, 'rule', 'retired upstream');

    // Only the three ENGINES and the window table are copied; the hooks themselves ride their plugin.
    const hookFiles = ctx.routes.hooks
        ? HOOK_ENGINES
        : [...new Set(ctx.lists.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, 'hook-prelude.js', 'fresh-session.js');
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'hooks'), label: 'hook',
        destDir: path.join(ctx.claudeDir, 'hooks'), files: hookFiles, exec: true, log: ctx.log, note: ctx.note,
    });
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'rules'), label: 'rule',
        destDir: path.join(ctx.claudeDir, 'rules'), files: ctx.lists.rules, log: ctx.log, note: ctx.note,
    });
    copy.stampDocsRoot(ctx.projectRoot, { log: ctx.log, note: ctx.note });

    const catalog = readJson(path.join(ctx.source.dir, 'meta', 'environment.json')).env || [];
    const migrations = envMigrations(readJson(path.join(ctx.source.dir, 'meta', 'migrations.json')));
    const wired = ctx.routes.hooks ? [] : ctx.lists.hooks;
    // ONE derivation decides what this project does NOT take (Phase 8): the hooks named off and the
    // seats denied. It runs whenever the run holds a selection: one a walk answered, or the one
    // --installed-only read back from this very state (`selection.readBack`), which writes it back
    // as it was - and only for the surfaces the read found evidence of (`writable`). No selection
    // at all (a bare install) writes no off-state.
    const state = ctx.picked ? deriveState({ selectionText: [...ctx.picked].join('\n'), sourceDir: ctx.source.dir }) : null;
    const { hooksOff, hooksAnswered, agentDeny, agentAllow } = writable(state, { routes: ctx.routes, answered: ctx.answered });
    settings.writeSettings({
        file: path.join(ctx.claudeDir, 'settings.json'),
        catalog, migrations, hookSpecs: wired,
        denySpecs: SECRET_DENY, retiredDeny: RETIRED_DENY, agentDeny, agentAllow,
        retiredEntries: readRetiredEntries(ctx.source.dir).map((e) => e.name), liveEntries: ctx.liveCarriers || null,
        // On the copy route a --drop'd hook is unwired like a retired one - the writer keeps a merely
        // unselected hook's entries on purpose, so the drop has to name it.
        retiredHooks: ctx.manifest.retired.hooks.concat(ctx.routes.hooks
            ? catalogHooks
            : (ctx.args.dropApplied || []).filter((l) => l.startsWith('hook ')).map((l) => `${l.slice(5)}.js`)),
        docsVersioning: {
            value: ctx.args.docsVersioning,
            seed: docs.docsVersioningSeed({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot) }),
        },
        mcpNames: ctx.routes.mcps ? [] : ctx.lists.mcps.map((e) => e.split('|')[0]),
        mcpOff: ctx.routes.mcps ? ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS) : [],
        memoryDb: ctx.level.dbPath,
        sentryAuth: ctx.args.sentryAuth || 'token',
        hooksOff, hooksAnswered,
        log: ctx.log, note: ctx.note,
    });
}

function importMemory(ctx)
{
    const settingsFile = path.join(ctx.projectRoot, '.claude', 'settings.json');
    const gate = memory.importGate({
        projectRoot: ctx.projectRoot, settingsFile,
        mcps: ctx.lists.mcps, rules: ctx.lists.rules,
        tools: { node: true, uvx: ctx.rt.which('uvx') },
    });
    const importer = path.join(ctx.source.dir, 'scripts', 'memory-import.js');
    const acct = ctx.env.CLAUDE_CONFIG_DIR ? ['--config-dir', ctx.configDir] : [];
    memory.importNotes({
        gate, importer, settingsFile,
        runImport: () =>
        {
            const r = ctx.rt.runNode(importer, ['--project-root', ctx.projectRoot, ...acct], { cwd: ctx.projectRoot, env: ctx.env });
            return { ok: r.ok, output: `${r.stdout}\n${r.stderr}` };
        },
        log: ctx.log,
    });
}

// COPY ROUTE ONLY: a registered server answers `mcp__<server>__<tool>`, never the plugin spelling
// the shipped files carry.
function downconvert(ctx)
{
    const bare = mcp.bareNamedMcps({ routes: ctx.routes, mcps: ctx.lists.mcps })
        .map((n) => n.replace(/^playwright-.*/, 'playwright'));
    if (!bare.length) return;
    if (ctx.routes.skills)
    {
        ctx.log(`  !! these servers are registered under their bare names but the skills and agents come from the plugins, which name the plugin spelling: ${bare.join(' ')} - set ALFRED_CODE_SKILLS_VIA_PLUGIN=false too, or leave them on the plugin route`);
        return;
    }
    mcp.downconvertToolNames({
        roots: [ctx.skillsDir, path.join(ctx.claudeDir, 'agents'), path.join(ctx.claudeDir, 'rules'), path.join(ctx.claudeDir, 'hooks')],
        bare, log: ctx.log,
    });
}

function summarise(ctx, failures)
{
    const hookFiles = new Set(ctx.lists.hooks.map((e) => e.split('::')[0]));
    let line = `  installed/refreshed this run - skills=${ctx.lists.skills.length}, plugins=${ctx.lists.plugins.length}`
        + `, mcps=${ctx.lists.mcps.length}, hooks=${hookFiles.size}, agents=${ctx.lists.agents.length}, rules=${ctx.lists.rules.length}`
        + `; memory=${ctx.level.level} (${ctx.level.dbPath})`;
    if (ctx.args.space) line += `; space=${ctx.args.space}`;
    line += ctx.args.keepPins ? '; keep-pins=on' : '; keep-pins=off (agent model/effort pins reset to catalog defaults)';
    const engines = pwEngines(ctx);
    if (engines.length) line += `; playwright=${engines.join(',')}`;
    ctx.log(`${line}; context7=${ctx.args.context7}`);
    if (failures) ctx.log(`  ${failures} step(s) reported a failure above - the rest of the run completed`);
}

// --- small readers ---------------------------------------------------------

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }

// The stamp's picked lines, `name@home` - the home is what tells a later read-back that an item
// MOVED rather than left with an entry the user removed. An extra has no home and stays plain.
function stampPickLists(lists, picks, carried = null)
{
    const place = placement();
    const out = {};
    for (const [key, kind, line] of [['skills', 'skills', 'skill'], ['agents', 'agents', 'agent']])
        out[key] = lists[key].map(selection.CATEGORY[key].name)
            .filter((name) => !picks || picks.has(`${line} ${name}`))
            .map((name) => { const home = homeOf(place, kind, name); return home ? `${name}@${home}` : name; })
            .concat(carried ? carried[key] : []);
    return out;
}

function readStampHooks(file)
{
    try { return (/^shipped-hooks: (.*)$/m.exec(fs.readFileSync(file, 'utf8')) || [])[1].split(',').filter(Boolean); }
    catch { return []; }
}

function releaseVersion(sourceDir)
{
    try { return JSON.parse(fs.readFileSync(path.join(sourceDir, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; }
    catch { return ''; }
}

// What a --drop did to the plugin set: the entries it took out (disabled later, dependents first),
// and every dropped skill an entry the project still needs goes on carrying - reported, since no
// setting can unload a plugin skill (spike S2).
function droppedByDrop({ kept, closed, stackListing, sourceDir, drop, routes, market, log })
{
    const place = placement();
    // Only the entries a PLUGIN route put there: on the skills copy route no stack entry carries this
    // project's items, and on the MCP copy route no server entry does - another install's are not ours.
    const ours = (name) => (place.plugins[name] ? routes.skills : routes.mcps);
    const setOf = (lines) => deriveState({ selectionText: lines.join('\n'), sourceDir }).plugins.map((p) => p.split('@')[0]).filter(ours);
    const deps = Object.fromEntries(Object.entries(place.plugins).map(([name, p]) => [name, p.dependencies || []]));
    const after = deriveState({ selectionText: closed.join('\n'), sourceDir });
    for (const line of drop)
    {
        const [category, name] = line.split(' ');
        if (routes.skills && category === 'skill' && after.skills.carried.includes(name))
            log(`installed-only: skill ${name} stays loaded - ${homeOf(place, 'skills', name)} carries it and a kept item needs that entry`);
    }
    return selection.droppedEntries({ before: setOf(kept), after: setOf(closed), listing: stackListing, deps, marketplace: market });
}

const registeredMemoryPath = (mcpFile) =>
{
    const entry = readJson(mcpFile).mcpServers?.memory;
    const p = entry && entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
    return typeof p === 'string' && p ? p : '';
};

const registeredEngines = (mcpFile) => Object.keys(readJson(mcpFile).mcpServers || {})
    .map((n) => (/^playwright-(chrome|msedge|firefox|webkit)$/.exec(n) || [])[1])
    .filter(Boolean);

const pwEngines = (ctx) => ctx.lists.mcps.filter((e) => e.startsWith('playwright-')).map((e) => e.split('|')[0].slice(11));

const pinFiles = (ctx) => pinsLayer.pinFiles({
    projectRoot: ctx.projectRoot, skillsDir: ctx.skillsDir,
    agents: ctx.lists.agents, skills: ctx.lists.skills,
});

function runSelectionPlugins(ctx)
{
    const script = path.join(ctx.source.dir, 'scripts', 'selection-plugins.js');
    if (!fs.existsSync(script)) throw new Error('selection-plugins.js is not in this source');
    const lines = plugins.selectionLines({
        routes: ctx.routes, skills: ctx.lists.skills, agents: ctx.lists.agents,
        mcps: ctx.lists.mcps, context7Mode: ctx.args.context7,
    });
    const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stack-sel-')), 'selection.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const entries = ctx.rt.runNode(script, ['--selection', file, '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    if (!entries.ok) throw new Error(`plugin set not computed (${entries.stderr.split('\n')[0]})`);
    const copyList = ctx.rt.runNode(script, ['--selection', file, '--copy', '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return { entries: ctx.rt.lines(entries.stdout), copy: ctx.rt.lines(copyList.stdout) };
}

const npmLatest = (rt) => (pkg) => rt.capture('npm', ['view', pkg, 'version'], { env: { ...process.env, npm_config_fetch_timeout: '15000' } }).trim();
const pypiLatest = (rt) => (pkg) =>
{
    const body = rt.capture('curl', ['-fsSL', '--max-time', '15', `https://pypi.org/pypi/${pkg}/json`]);
    try { return JSON.parse(body).info.version; } catch { return ''; }
};

const npxInstall = (ctx, engine) => ctx.rt.capture('npx', ['-y', '-p', `@playwright/mcp${ctx.pins.PW_PIN}`, 'playwright', 'install', engine], { cwd: ctx.projectRoot, env: ctx.env }) !== '';

if (require.main === module)
{
    process.exitCode = main(process.argv.slice(2), process.env, {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
    });
}

module.exports = { main, USAGE, HOOKS_PLUGIN, CORE_DEP_PLUGINS, HOOK_ENGINES, SECRET_DENY, RETIRED_DENY };
