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
// The frozen sh/ps1 twins were removed in 2.0.0 (Phase 7b, R33): `ALFRED_CODE_SEED=shell` (or the
// 1.x `CLAUDE_STACK_SEED`) no longer routes anywhere - it refuses with one line and exit 1, before // legacy-name
// this file does anything else (the D1 check, below).
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, FLAG_LIST, ENUMS } = require('./args.js');
const { createSource, compareVersions } = require('./source.js');
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
const { placement, readRetiredEntries, readRetiredPlugins, CORE } = require('../plugin-placement.js');
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
  update    refresh hooks/agents/rules and the runtimes at the release pins; idempotent

Named flags (any order, each optional): ${FLAG_LIST}

What each flag does is documented where it is set: the guided /alfred-code:setup, :update,
:configure and :validate commands (setup-plugin/commands/) name every flag they pass inline, and
the repo's CLAUDE.md covers the install surface end to end.`;

const { CORE_DEP_PLUGINS } = plugins;
// D1: the frozen twins hardcode the 1.x names, which a 2.0.0 registration cannot resolve.
const SHELL_SEED_RETIRED = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer'; // legacy-name
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
// What only a COPIED hook loads - the engines inline their own helpers and a plugin hook loads these
// from its own root - so the copy route ships them and the plugin route removes them with the hooks.
const HOOK_MODULES = ['hook-prelude.js', 'fresh-session.js', 'shell-writes.js'];
// The one rule copy.stampDocsRoot rewrites in place, after copyLibrary already hashed it - its
// bare name, matching a copyLibrary/stamp key (no .md).
const DOCS_ROOT_RULE = 'baseline-docs-root';

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
    // T16, R29: args.js already normalised 'global' to 'user', so the flag (once resolved, below) IS
    // the CLI scope - project|user|local pass straight through to every `claude plugin` / `claude
    // mcp` call. Only the plugins (and claude-hud, pinned to user regardless) follow the scope now:
    // the library copies, the rules, the hook engines, settings.json and the stamp live in the
    // project's `.claude/` at EVERY scope - the bodies run `node .claude/hooks/docs.js` from the
    // project, and the docs-root rule is stamped there.
    const claudeDir = path.join(projectRoot, '.claude');
    // R95: a git worktree whose own `.claude` holds no install record shares its main checkout's
    // install (the hooks count it set up). Every layer below reads and writes the tree the run is in,
    // so an install would lay a second one here and an update would find nothing and name setup -
    // stopped before anything is resolved, called or written, naming the checkout to run from.
    const worktreeOf = stampLayer.worktreeMain(cwd);
    if (worktreeOf)
    {
        err(`error: this is a git worktree of ${worktreeOf}, which holds the install - run the installer from there\n`);
        return 1;
    }
    let skillsDir = path.join(projectRoot, '.claude', 'skills');
    const mcpFile = path.join(projectRoot, '.mcp.json');
    // R105: a `claude` found on PATH that cannot be STARTED (a batch file spawned without cmd.exe, a
    // missing interpreter) is said once, here, and the run goes on as without one - never a failure
    // line per plugin, and never a call that fails with no line at all.
    const claudeBroken = rt.which('claude') ? rt.unrunnable('claude', { cwd: projectRoot, env }) : null;
    const hasClaude = claudeBroken === '';
    if (claudeBroken) note(`${claudeBroken} - the plugin and MCP layers were skipped`);

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
        ? rt.cliRunner('claude', { cwd: projectRoot, env, out: plain, fail: note })
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

        // What this run READS of the last install: the new stamp, else a 1.x install's under its old name,
        // else - a 1.x GLOBAL project not yet migrated - the account's own, read IN PLACE until the
        // refusal below has passed (m4: a refused update moves nothing). A --print-plan never migrates
        // and reads the account skills too - the same fallback library-check.js uses.
        const projectStamp = () => stampLayer.stampFiles({ scope: args.scope, configDir, projectRoot }).read;
        let stampFile = projectStamp();
        const legacyAcct = !stampFile && configDir ? path.join(configDir, LEGACY.stamp) : '';
        const unmigrated = Boolean(legacyAcct) && (args.action === 'update' || args.printPlan) && fs.existsSync(legacyAcct);
        if (unmigrated) stampFile = legacyAcct;
        if (unmigrated && args.printPlan) skillsDir = path.join(configDir, 'skills');

        // I3 (R47): args.js left '' when neither --scope nor SCOPE was given. `update` takes the
        // scope the LAST install actually used, from the stamp's own `scope:` line (a 1.x `global`
        // line maps to `user`, same as the CLI flag does); `install`, or an update with no stamp at
        // all to read, defaults to `project` - the floor every scope always had.
        if (!args.scope)
        {
            const rawStamped = args.action === 'update' && stampFile ? stampLayer.readStampScope(stampFile) : '';
            const stamped = rawStamped.toLowerCase() === 'global' ? 'user' : rawStamped.toLowerCase();
            // m2 (I3 minor): the stamp's `scope:` line reaches the CLI unvalidated otherwise - a
            // hand-edited or corrupted stamp (`scope: bogus`, or un-lowercased `scope: Global`) must
            // never flow straight into `claude plugin install ... --scope <value>`. m3: nor into this
            // log, which the model reads as tool output - named by its length only, the N1 rule.
            if (stamped && !ENUMS.scope.values.includes(stamped))
            { log(`  scope: the stamp's scope line (${rawStamped.length} chars) is not project|user|local - falling back to project`); }
            args.scope = stamped && ENUMS.scope.values.includes(stamped) ? stamped : 'project';
        }
        const cliScope = args.scope;

        log(`action: ${args.action} [scope=${args.scope}, account=${configDir}]`);

        const manifest = loadManifest(resolved.dir);
        const routes = plugins.pluginRoutes(env);
        // I5 (R47, fix round 2): memory is a LOCKED server - it bakes ONE path into a user-scope
        // registration only on the FULL copy route, where the installer registers it itself
        // (`claude mcp add -s user -e MCP_MEMORY_SQLITE_PATH=<path>`); on the MCP-copy-route-alone
        // combination memory still rides its own plugin, re-read per project by the launcher, so
        // that mix is safe. `!plugins.corePluginOn(routes)` is the full copy route - every one of
        // hooks/skills/mcps riding a copy instead of a plugin - exactly what R29's own refusal used
        // to guard, on the ONE route the plugin launcher's per-project re-read cannot cover.
        // m5: keyed on the RESOLVED level - with no flag, the .mcp.json registration's own path.
        const level = memory.resolveLevel({
            flag: args.memoryLevel,
            registeredPath: registeredMemoryPath(mcpFile, claudeDir),
            home, space: args.space, projectRoot,
        });
        if (level.level === 'project' && args.scope === 'user' && !plugins.corePluginOn(routes))
        {
            const what = level.from === 'flag' ? '--memory-level project' : `the memory level project (read from ${registeredMemoryPath(mcpFile) ? path.basename(mcpFile) : 'the settings env'})`;
            err(`error: ${what} is refused at --scope user on the full copy route `
                + "(ALFRED_CODE_HOOKS_VIA_PLUGIN=false, ALFRED_CODE_SKILLS_VIA_PLUGIN=false and ALFRED_CODE_MCPS_VIA_PLUGIN=false) - "
                + 'the registration bakes one path into every project of the account; use --scope project, pass --memory-level global or scoped, or keep any one route on the plugin\n');
            return 1;
        }

        // T16/R47 (I4): the migration is a WRITE - a real `update` only, never `--print-plan`
        // (configure and validate call it as a run that writes nothing), inside the try so an EACCES
        // is reported, and after the refusal above (m4). C1/m1: a failed copy goes through `note`.
        if (args.action === 'update' && !args.printPlan && unmigrated)
        {
            stampLayer.migrateLegacyGlobal({ configDir, projectRoot, renamed: manifest.renamed, log, note });
            stampFile = projectStamp();
        }

        // R78: an install moved off `local` scope carries the stack's own entries out of
        // settings.local.json first, so the read-back below and every write after it find them in
        // the file this run writes. A --print-plan moves nothing and reads the local overlay instead.
        // R96: an env key the stack seeded there goes - `seeds` is what THIS run would seed in its
        // place (the catalog default, the docs-versioning rule's answer), `written` the keys it writes
        // every run - and a value the user set stays local; no env key moves into settings.json.
        // N2: every seed the stack SHIPPED counts, so a reseed migration's old value is one too.
        const leavingLocal = Boolean(stampFile) && stampLayer.readStampScope(stampFile) === 'local' && args.scope !== 'local';
        if (leavingLocal && !args.printPlan)
        {
            const rows = readJson(path.join(resolved.dir, 'meta', 'environment.json')).env || [];
            const seeds = Object.fromEntries(rows.filter((r) => !r.written).map((r) => [r.key, [r.default]]));
            seeds.ALFRED_CODE_DOCS_VERSIONING = [docs.docsVersioningSeed({ projectRoot, docsPath: copy.resolveDocsRoot(projectRoot, args.scope) })];
            for (const [key, shippedSeed] of envMigrations(readJson(path.join(resolved.dir, 'meta', 'migrations.json'))).reseed)
                (seeds[key] ??= []).push(shippedSeed);
            settings.leaveLocalScope({
                claudeDir,
                hookFiles: [...new Set(manifest.catalogs.hooks.map((e) => e.split('::')[0]))],
                mcpNames: manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS),
                denySpecs: SECRET_DENY, seeds, written: rows.filter((r) => r.written).map((r) => r.key), log, note,
            });
        }

        // --- the six lists, narrowed to this project -------------------------------
        let lists = {
            skills: manifest.skills, agents: manifest.agents, rules: manifest.rules,
            hooks: manifest.hooks, plugins: manifest.plugins, mcps: manifest.mcps,
        };
        // The playwright engines the last install INSTALLED, and the ones the user chose to enable (R67) -
        // the stamp's word, never the listing's flag: an engine left off is still installed, and a
        // project-scope flag can read a stale false (S22). Kept on the plugin route only; on the copy
        // route the registrations in .mcp.json are the record.
        const priorPw = { browsers: stampLayer.readPlaywright(stampFile), enabled: stampLayer.readPlaywrightEnabled(stampFile) };
        // null when the stamp has no such line (1.x, no stamp): nothing recorded, and the listing speaks.
        const stampEngines = routes.mcps ? priorPw.browsers : null;

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
        // R109: a former stack pick is dropped here, once per run, and never touched on the machine.
        const formerSaid = new Set();
        // Task 22: a skill or seat a release renamed is read under its new name wherever an older
        // install or a caller names it the old way - the stamp's picks, a disk copy, a seat deny (in
        // readBack) and these selection lines - with one line per rename per run.
        const renaming = { renamed: manifest.renamed, log, said: new Set() };
        args.add = selection.renameLines(selection.dropFormerPicks({ lines: args.add, log, said: formerSaid }), renaming);
        args.drop = selection.renameLines(args.drop, renaming);
        if (args.installedOnly)
        {
            const raw = rawListing ?? readRaw();
            listing = plugins.parsePluginList(raw, projectRoot);
            selection.dropFormerPicks({ listing, lastVersion: stampLayer.readVersion(stampFile), compare: compareVersions, log, said: formerSaid });
            const stackListing = plugins.parsePluginList(raw, projectRoot, { marketplace: market });
            const lastPicked = selection.renamePicked(stampLayer.readPicked(stampFile), renaming);
            const back = selection.readBack({
                claudeDir, skillsDir,
                mcpServers: Object.keys(readJson(mcpFile).mcpServers || {}),
                listing, stackListing,
                // I2 / N5: the file this run writes, or at local scope settings.local.json laid over
                // settings.json for `env` and `permissions.deny` (settings.js readBackSettings).
                settings: settings.readBackSettings(claudeDir, leavingLocal && args.printPlan ? 'local' : args.scope),
                routes, manifest, sourceDir: resolved.dir,
                stampHooks: readStampHooks(stampFile),
                lastHooksRoute: stampLayer.readHooksRoute(stampFile),
                stampPicked: lastPicked, stampEngines,
                always, marketplace: market, said: renaming.said, log,
                sharedOnlyDeny: (leavingLocal && args.printPlan ? 'local' : args.scope) === 'local' ? settings.sharedOnlyDeny(claudeDir) : [],
            });
            if (!back.installed)
            {
                err(`error: --installed-only found nothing installed under ${claudeDir} - run 'install' (or /alfred-code:setup) first\n`);
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
        }
        else if (args.selection)
        {
            let text;
            try { text = fs.readFileSync(args.selection, 'utf8'); }
            catch { err(`selection file not found: ${args.selection}\n`); return 1; }
            picked = selection.parseSelection(selection.renameLines(selection.dropFormerPicks({ lines: text.split('\n'), log, said: formerSaid }), renaming).join('\n'));
            answered = { hooks: [...picked].some((l) => l.startsWith('hook ')), agents: true };
        }
        if (picked) lists = selection.applySelection(lists, picked);
        // R83 a: the locked three are every install's. A plugin route adds their plugins in `pluginSet`;
        // the FULL copy route registers only what this list names, so they are put back here, before
        // the plan is printed, so the plan, the registrations and the stamp agree.
        if (!plugins.corePluginOn(routes)) lists.mcps = mcp.withLocked({ mcps: lists.mcps, catalog: manifest.catalogs.mcps, log });
        for (const line of args.add)
        {
            const [category, name] = line.split(' ');
            const key = Object.keys(selection.CATEGORY).find((k) => selection.CATEGORY[k].line === category);
            if (!(lists[key] || []).some((e) => selection.CATEGORY[key].name(e) === name))
                note(`--add ${line} names nothing this release ships - ignored`);
        }

        // --- the two entries assembled at install time -----------------------------
        const pins = args.printPlan
            ? { PW_PIN: '', SERENA_PIN: '', MEMORY_PIN: '', MEMORY_BACKEND: 'sqlite_vec' }
            : mcp.resolvePins({ pins: readJson(path.join(resolved.dir, 'meta', 'mcp-pins.json')).pins, log });

        const pw = mcp.expandPlaywright({
            mcps: lists.mcps,
            browsers: args.playwrightBrowsers,
            registered: [...new Set([...registeredEngines(mcpFile), ...listedEngines, ...(stampEngines || [])])],
        });
        lists.mcps = pw.mcps;
        // Which of them are ENABLED: the user's answer when given, else each keeps its last recorded
        // choice and a new one is on. An answer naming an engine this run does not install is refused
        // here, before anything is written.
        const pwOn = mcp.playwrightEnabled({ kept: pw.browsers, flag: args.playwrightEnabled, prior: priorPw });
        if (pwOn.outside.length)
        {
            err(`error: --playwright-enabled names ${pwOn.outside.join(',')}, which this run does not install (installs: ${pw.browsers.join(',') || 'none'}) - enable only an engine being installed\n`);
            return 1;
        }

        if (args.printPlan)
        {
            for (const line of selection.renderPlan(lists)) plain(line);
            plain(`plan answered: hooks=${answered.hooks ? 'yes' : 'no'} agents=${answered.agents ? 'yes' : 'no'}`);
            plain(`plan routes: skills=${routes.skills ? 'plugin' : 'copy'} hooks=${routes.hooks ? 'plugin' : 'copy'} mcps=${routes.mcps ? 'plugin' : 'copy'}`);
            // A 1.x install's move, as the plugin pass would run it - recorded, never run.
            if (hasClaude && plugins.corePluginOn(routes))
            {
                const raw = rawListing ?? readRaw();
                const carriers = readRetiredEntries(resolved.dir).map((e) => e.name);
                const retiredRows = readRetiredPlugins(resolved.dir);
                const planned = [];
                // The recording cli answers every call as done, so the lines a run prints AFTER a
                // removal would claim one that never ran: a plan keeps only what describes the move.
                const OUTCOME = /plugin pruned|add it back:|plugin removed/;
                const planLog = (m) => { if (!OUTCOME.test(m)) plain(`plan note: ${String(m).trim()}`); };
                plugins.migrateLegacy({
                    rows: plugins.parsePluginList(raw, projectRoot, { everyScope: true }),
                    scope: cliScope, retired: [...new Set([...manifest.retired.plugins, ...retiredRows.map((r) => r.name), ...carriers])], retiredRows, carriers, log: planLog,
                    cli: (argv) => { planned.push(`claude ${argv.join(' ')}`); return true; },
                });
                for (const step of planned) plain(`plan migrate: ${step}`);
            }
            if (args.planOut)
            {
                if (!listing) listing = hasClaude ? plugins.parsePluginList(rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env }), projectRoot) : [];
                const inv = selection.planInventory({
                    lists, listing, answered, leftOut, pluginCatalog: manifest.catalogs.plugins.map((id) => id.split('@')[0]),
                });
                // What configure's walk pre-selects for playwright: the kept engines, and of them the ones
                // ON NOW - the settings file where each is installed, which a /plugin toggle writes; the
                // stamp's last answer only where that file names nothing. Plugin route only.
                const isOn = engineOn({ configDir, claudeDir });
                const specOf = (e) => `playwright-${e}@${market}`;
                inv.playwright = mcp.playwrightLive({
                    kept: pw.browsers, prior: priorPw,
                    live: (e) => (routes.mcps ? isOn(specOf(e), plugins.scopeFor(specOf(e), cliScope, listing)) : undefined),
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
            SERENA_PIN: pins.SERENA_PIN, PW_PIN: pins.PW_PIN,
            MEMORY_PIN: pins.MEMORY_PIN, MEMORY_BACKEND: pins.MEMORY_BACKEND,
        };
        // The one remote server the copy route registers: context7, the hosted transport only (2.0.0).
        const remotes = { context7: mcp.CONTEXT7_REMOTE };
        // What a release retired from the MCP catalog and this run still prunes: the first update past
        // a retirement only (mcp.dueRetired) - after it, the name is the user's add-back registration.
        const retiredMcpsDue = mcp.dueRetired({
            names: manifest.retired.mcps, rows: readRetiredPlugins(resolved.dir),
            lastVersion: stampLayer.readVersion(stampFile), compare: compareVersions,
        });
        const ctx = {
            args, env, log, note, plain, cli, rt, source: resolved, manifest, lists, routes,
            projectRoot, claudeDir, skillsDir, configDir, mcpFile, home, stampFile,
            pins, tokens, remotes, level, hasClaude, claudeBroken, picked, answered, dropEntries, cliScope, refreshed,
            market, marketSeen, readMarkets, retiredMcpsDue, pw: { prior: priorPw, ...pwOn },
        };
        if (!routes.mcps && pwOn.apply && pw.browsers.length)
            log('playwright: --playwright-enabled is recorded but not applied on the MCP copy route - the engines are .mcp.json servers, /mcp switches them');

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

        if (pinSnapshot)
        {
            pinsLayer.restorePins({ snapshot: pinSnapshot, files: pinFiles(ctx), log });
            // A restored pin value lands AFTER copyLibrary already hashed the agent it edited, so the
            // recorded hash is stale - re-hash what --keep-pins just touched, or the next check reads
            // a kept pin as drift.
            rehashKind(ctx.library && ctx.library.agents, path.join(claudeDir, 'agents'));
        }

        stampLayer.writeStamp({
            source: resolved, action: args.action, scope: args.scope, configDir, projectRoot, mcpFile,
            hooksCatalog: manifest.catalogs.hooks, hooksRoute: ctx.routes.hooks ? 'plugin' : 'copy',
            version: releaseVersion(resolved.dir), log, note,
            picked: stampPickLists(lists, stampPicks, carriedPicks), playwright: pwEngines(ctx), playwrightEnabled: ctx.pw.enabled,
            library: ctx.library || { skills: {}, agents: {}, rules: {} },
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
    seeds.seedAccountKeys({ configDir: ctx.configDir, env: ctx.env, log: ctx.log, note: ctx.note });
    installHooksAndRules(ctx);
    importMemory(ctx);
    docs.migrateDocsDomains({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope), log: ctx.log });
    if (args.action === 'install') seeds.seedClaudeMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, log: ctx.log, note: ctx.note });
    selection.respellRenamed({ projectRoot: ctx.projectRoot, renamed: ctx.manifest.renamed, log: ctx.log, note: ctx.note });
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

// Re-hash every currently-tracked library item of one kind after something OUTSIDE copyLibrary
// rewrote its file: the docs-root stamp, the copy-route MCP tool-name re-spelling, a restored
// --keep-pins value. A dozen files at most - cheap, and correctness here is what keeps `drift` from
// firing on content the installer itself just wrote.
function rehashKind(map, dir)
{
    for (const name of Object.keys(map || {})) map[name] = library.hashItem(path.join(dir, `${name}.md`));
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
    if (!ctx.hasClaude) { if (!ctx.claudeBroken) ctx.note('the claude CLI is not on PATH - the plugin and MCP layers were skipped'); return; }
    // One row per name@marketplace: the set mixes official picks with stack entries, and the official
    // catalog ships names the stack uses too.
    const readRaw = () => ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env });
    const readListing = () => plugins.parsePluginList(readRaw(), ctx.projectRoot, { byMarketplace: true });
    const raw = readRaw();
    const listing = plugins.parsePluginList(raw, ctx.projectRoot, { byMarketplace: true });
    const rows = plugins.parsePluginList(raw, ctx.projectRoot, { everyScope: true });
    const engines = playwrightMoves(ctx, { blind: !listingRead(raw), rows });
    // R107 / R111: what the copy route registers in .mcp.json after this layer must never also load as
    // a plugin. On the full copy route the stack's own rows go off first (the core, its 1.x ids and the
    // locked three); wherever the copy route registers a playwright engine, that engine's row goes.
    // Which rows are on is the settings file's word at each scope before the listing's (S22, S28).
    const isOn = engineOn(ctx);
    const stand = { rows, market: ctx.market, scope: ctx.cliScope, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note };
    if (!plugins.corePluginOn(ctx.routes)) plugins.copyRouteStandDown({ ...stand, locked: mcp.LOCKED });
    if (!ctx.routes.mcps) plugins.engineStandDown({ ...stand, engines: pwEngines(ctx) });
    let set = plugins.pluginSet({
        routes: ctx.routes, thirdParty: ctx.lists.plugins,
        stackEntries: ctx.stackEntries || [], coreDeps: CORE_DEP_PLUGINS, locked: mcp.LOCKED, market: ctx.market,
    });
    const marketplaces = plugins.extraMarketplaces(ctx.manifest.rows.plugins, set);
    // The per-stack entries retired in 1.3.0 come from the seed's own file, never the twins' lists:
    // only this route copies their picks before they go. The ones still installed after this run are
    // what the settings writer keeps a seat's old deny spelling for; an unreadable listing says
    // nothing, so it keeps them all.
    const carriers = readRetiredEntries(ctx.source.dir).map((e) => e.name);
    // The plugins a release cut (meta/retired-plugins.json) go the same way, each by its full spec and
    // with its add-back line - 2.0.0's five MCP entries among them.
    const retiredRows = readRetiredPlugins(ctx.source.dir);
    const retired = [...new Set([...ctx.manifest.retired.plugins, ...retiredRows.map((r) => r.name), ...carriers])];
    // A 1.x install is moved across first - the new core installed, then the old ids removed - before
    // the core is installed or updated below (plugins.migrateLegacy).
    const moved = plugins.corePluginOn(ctx.routes)
        ? plugins.migrateLegacy({ rows, scope: ctx.cliScope, retired, retiredRows, carriers, cli: ctx.cli, log: ctx.log, note: ctx.note })
        : { fresh: [], gone: [], removed: [], failed: null, ran: false };
    // A failed move leaves the old core carrying the guards; a second install of the new one beside it
    // would run both, and leave nothing for the next update to move.
    if (moved.failed) set = set.filter((spec) => spec !== moved.failed);
    // The 1.x core counts as a live home of its seat denies while any scope still carries its old id.
    const oldCore = rows.some((r) => r.name === LEGACY.core && !moved.removed.includes(r)) ? [LEGACY.core] : [];
    const installed = (gone = []) => (listing.length ? carriers.filter((n) => plugins.fieldOf(listing, n, 'version') && !gone.includes(n)).concat(oldCore) : null);
    ctx.liveCarriers = installed(moved.gone);
    if (ctx.args.action === 'update')
    {
        // A move that ran (or retried) pruned the retired entries already; a failed one removes nothing.
        const moving = moved.ran || moved.failed;
        const gone = moving ? moved.gone : plugins.prunedRetired({ rows, retired, retiredRows, carriers, market: ctx.market, scope: ctx.cliScope, cli: ctx.cli, log: ctx.log, note: ctx.note });
        ctx.liveCarriers = installed(gone);
        plugins.updatePlugins({
            plugins: set, scope: ctx.cliScope, marketplaces, before: listing, fresh: moved.fresh, refreshed: ctx.refreshed, engines, cli: ctx.cli, log: ctx.log, note: ctx.note,
            after: readListing,
        });
        for (const row of ctx.dropEntries || [])
        {
            const spec = `${row.name}@${row.marketplace}`;
            if (engines.uninstalled.includes(spec)) continue;
            // An entry enabled at ANOTHER scope belongs to that scope's install too - an account-wide
            // entry a project run disabled would vanish from every other project. Said, not done.
            if (row.scope !== ctx.cliScope) { ctx.log(`  ${spec} is enabled at ${row.scope} scope, not this run's - if nothing else needs it: claude plugin disable ${spec} --scope ${row.scope}`); continue; }
            if (ctx.cli(['plugin', 'disable', spec, '--scope', row.scope], { quiet: true, expect: 'reported' })) ctx.log(`plugin disabled [${row.scope}]: ${spec} (nothing kept needs it after --drop)`);
            else ctx.note(`plugin disable failed: ${spec} - disable it by hand: claude plugin disable ${spec} --scope ${row.scope}`);
        }
        return;
    }
    plugins.installPlugins({
        plugins: set, scope: ctx.cliScope, marketplaces, before: listing, fresh: moved.fresh, refreshed: ctx.refreshed, engines, cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
}

// THE PLAYWRIGHT ENGINES for the plugin pass (R67): installed and enabled as the user picked. First an
// engine the last install installed and this run no longer keeps is UNINSTALLED - left installed it
// reads back as listed and the next update keeps it again. Then the moves for the kept ones
// (plugins.js `engines`). A listing the run could not read shows every engine as absent, so the STAMP
// says which are installed already: only a new engine is installed, and switched off only when the
// user chose it off - a 1.x stamp names none, so each is installed, as before the line.
function playwrightMoves(ctx, { blind, rows })
{
    const none = { specs: [], present: [], presentScope: {}, off: [], on: null, isOn: () => undefined, uninstalled: [] };
    if (!ctx.routes.mcps) return none;
    const kept = pwEngines(ctx);
    const specOf = (e) => `playwright-${e}@${ctx.market}`;
    const prior = ctx.pw.prior.browsers || [];
    const uninstalled = plugins.uninstallEngines({
        specs: prior.filter((e) => !kept.includes(e)).map(specOf), rows, blind, scope: ctx.cliScope, cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
    if (!kept.length) return { ...none, uninstalled };
    // Blind, an engine is present when the stamp names it, or when a settings file carries its key -
    // install writes the key and uninstall removes it (S28) - at the scope whose file names it.
    const isOn = engineOn(ctx);
    const presentScope = {};
    const known = !blind ? [] : kept.filter((e) =>
    {
        const at = [ctx.cliScope, 'user'].find((s) => isOn(specOf(e), s) !== undefined);
        if (at && at !== ctx.cliScope) presentScope[specOf(e)] = at;
        return Boolean(at) || prior.includes(e);
    });
    if (blind)
        ctx.log(known.length
            ? `playwright: the plugin listing could not be read - the stamp or the settings name ${known.join(',')} as installed (updated in place); the rest install as new`
            : 'playwright: the plugin listing could not be read and neither the stamp nor the settings name an installed engine - each installs as new');
    const { enabled, off, apply } = ctx.pw;
    ctx.log(apply
        ? `playwright: installs ${kept.join(',')}; enabled as picked: ${enabled.join(',') || 'none'} (/plugin toggles them)`
        : `playwright: installs ${kept.join(',')}; no enable answer given - one already installed keeps its on/off, one installed now arrives on${off.length ? `, except ${off.join(',')} (last left off)` : ''} (/plugin toggles them)`);
    return {
        specs: kept.map(specOf), present: known.map(specOf), presentScope, off: off.map(specOf),
        on: apply ? enabled.map(specOf) : null, isOn, uninstalled,
    };
}

// The settings file's word on a plugin at one scope - true, false, or undefined when it says nothing.
// It is the file the CLI writes an enable or disable to, and the listing's own flag can be stale (S22).
const engineOn = ({ configDir, claudeDir }) => (spec, scope) =>
{
    const file = scope === 'user' ? path.join(configDir, 'settings.json')
        : path.join(claudeDir, scope === 'local' ? 'settings.local.json' : 'settings.json');
    const on = (readJson(file).enabledPlugins || {})[spec];
    return typeof on === 'boolean' ? on : undefined;
};

// `claude plugin list --json` answered with a listing - an array, or `{installed: [...]}` - rather than
// nothing or garbage, which parsePluginList reads as an empty listing either way.
function listingRead(raw)
{
    try { const data = JSON.parse(raw); return Array.isArray(data) || Boolean(data && Array.isArray(data.installed)); }
    catch { return false; }
}

// `claude mcp remove` of a server the scope does not hold exits 1 with this line - nothing to remove
// is nothing to report (measured on 2.1.282: '... in .mcp.json', '... in local scope', '... in user scope').
const MCP_ABSENT = /No MCP server named/;

function installMcps(ctx)
{
    if (!ctx.hasClaude) return;
    const retired = mcp.retiredMcps({ routes: ctx.routes, catalog: ctx.manifest.catalogs.mcps, authored: ctx.retiredMcpsDue });
    const addBack = (name) => (readRetiredPlugins(ctx.source.dir).find((r) => r.name === name) || {}).addBack;
    for (const name of retired)
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true, expect: MCP_ABSENT }))
        {
            ctx.log(`  mcp pruned: ${name}`);
            const back = ctx.retiredMcpsDue.includes(name) && addBack(name);
            if (back) ctx.log(`    add it back: ${back.split('<scope>').join(ctx.cliScope)}`);
        }

    if (ctx.routes.mcps)
    {
        ctx.log('mcp: carried by the plugins (serena, context7, memory, and the picks) - nothing registered here');
        return;
    }
    for (const name of mcp.playwrightDrop({ routes: ctx.routes, browsers: pwEngines(ctx) }))
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true, expect: MCP_ABSENT })) ctx.log(`  mcp removed: ${name}`);

    const live = ctx.lists.mcps.filter((e) => !(mcp.isLocked(e.split('|')[0]) && mcp.corePluginOn(ctx.routes)));
    for (const entry of live)
    {
        const name = entry.split('|')[0];
        const args = entry.slice(entry.indexOf('|') + 1);
        if (ctx.args.action === 'update') ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true, expect: MCP_ABSENT });
        else if (ctx.cli(['mcp', 'get', name], { quiet: true, expect: 'answer' })) { ctx.plain(`  mcp ${name} already configured - skipping`); continue; }
        ctx.log(`mcp [${ctx.args.scope}]: ${name}`);
        if (!ctx.cli(mcp.registerSpec({ name, args, scope: ctx.cliScope, remotes: ctx.remotes, tokens: ctx.tokens }), { expect: 'reported' }))
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
            ctx.cli(['mcp', 'remove', name, '-s', ctx.cliScope], { quiet: true, expect: MCP_ABSENT });
            ctx.cli(mcp.registerSpec({ name, args: entry.slice(entry.indexOf('|') + 1), scope: ctx.cliScope, remotes: ctx.remotes, tokens: ctx.tokens }), { quiet: true });
        },
        log: ctx.log, note: ctx.note,
    });
}

function installHooksAndRules(ctx)
{
    // NM1 (fix round 3): on the PLUGIN route the prune below deletes the copies, so the route line is
    // patched on the existing stamp FIRST - a run dying after the prune never leaves a stale 'copy'
    // over an emptied folder. N4: the copy route never marks here - 'copy' before a single copy has
    // landed reads back as the user's None; it marks once the copies are in (N7, below).
    // m9: and only when a stack hook copy is there to prune - with none (a copy-route None) the prune
    // destroys no evidence, and an early 'plugin' would read that None back as every hook on.
    const catalogHooks = [...new Set(ctx.manifest.catalogs.hooks.map((e) => e.split('::')[0]))];
    if (ctx.routes.hooks && catalogHooks.some((f) => fs.existsSync(path.join(ctx.claudeDir, 'hooks', f))))
        stampLayer.markHooksRoute(stampLayer.stampPath({ projectRoot: ctx.projectRoot }), 'plugin');
    // On the plugin route a copied hook is dead weight once unwired, so its file goes too; what a
    // release retired goes on either route, file and wiring together.
    pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), ctx.manifest.retired.hooks, 'hook', 'retired upstream');
    if (ctx.routes.hooks) pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), catalogHooks.concat(HOOK_MODULES), 'hook', 'now carried by a plugin');
    pruneCopies(ctx, path.join(ctx.claudeDir, 'rules'), ctx.manifest.retired.rules, 'rule', 'retired upstream');

    // Only the three ENGINES and the window table are copied; the hooks themselves ride their plugin.
    const hookFiles = ctx.routes.hooks
        ? HOOK_ENGINES
        : [...new Set(ctx.lists.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, HOOK_MODULES);
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'hooks'), label: 'hook',
        destDir: path.join(ctx.claudeDir, 'hooks'), files: hookFiles, exec: true, log: ctx.log, note: ctx.note,
    });
    // N7: a copy error throws, so here every hook copy has landed - the copies are the record now, and
    // the line says so before the settings write below blanks the stored list on the full copy route. A
    // 'plugin' line over stack copies then only ever means a copy run that died part way (m8).
    if (!ctx.routes.hooks) stampLayer.markHooksRoute(stampLayer.stampPath({ projectRoot: ctx.projectRoot }), 'copy');
    // No plugin ever carries a rule, so every rule is a LIBRARY copy on every route - the hash lands
    // in the stamp beside the skills and agents one. `ctx.library` may already carry skills/agents
    // from the plugin route above; on the copy route this is its first write.
    ctx.library = ctx.library || { skills: {}, agents: {} };
    // The docs-root rule is compared and written with its root already substituted, so an update
    // that changes nothing about it neither rewrites it nor says it did (Task 8a concern 7).
    // On the copy route the tool-name re-spelling is rendered the same way, for every rule, so a rule
    // the re-spelling touches is not rewritten and logged on every run (R111).
    const docsRoot = copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope);
    const bare = ctx.routes.skills ? [] : bareNames(ctx);
    const respell = (text) => mcp.respellToolNames(text, bare);
    const ruleNames = ctx.lists.rules.map((f) => f.replace(/\.md$/, ''));
    const render = { [`rules/${DOCS_ROOT_RULE}`]: (text) => respell(text.split('__DOCS_ROOT__').join(docsRoot)) };
    if (bare.length) for (const name of ruleNames) if (name !== DOCS_ROOT_RULE) render[`rules/${name}`] = respell;
    const rulesLibrary = library.copyLibrary({
        sourceDir: ctx.source.dir, rulesDir: path.join(ctx.claudeDir, 'rules'),
        rules: ruleNames,
        render,
        stamped: stampLayer.readLibrary(ctx.stampFile), log: ctx.log, note: ctx.note,
    });
    ctx.library.rules = rulesLibrary.rules;
    // A copy this run did not write may still hold the placeholder: stampDocsRoot substitutes it IN
    // PLACE, after copyLibrary already hashed it - re-hash the one file it touches, or `drift` fires
    // on every check from here on.
    copy.stampDocsRoot(ctx.projectRoot, { scope: ctx.args.scope, log: ctx.log, note: ctx.note });
    if (Object.hasOwn(ctx.library.rules, DOCS_ROOT_RULE))
        ctx.library.rules[DOCS_ROOT_RULE] = library.hashItem(path.join(ctx.claudeDir, 'rules', `${DOCS_ROOT_RULE}.md`));

    const catalog = readJson(path.join(ctx.source.dir, 'meta', 'environment.json')).env || [];
    const migrations = envMigrations(readJson(path.join(ctx.source.dir, 'meta', 'migrations.json')));
    const wired = ctx.routes.hooks ? [] : ctx.lists.hooks;
    // ONE derivation decides what this project does NOT take (Phase 8): the hooks named off and the
    // seats denied. It runs whenever the run holds a selection: one a walk answered, or the one
    // --installed-only read back from this very state (`selection.readBack`), which writes it back
    // as it was - and only for the surfaces the read found evidence of (`writable`). No selection
    // at all (a bare install) writes no off-state, with one exception: on the hooks copy route with
    // the core on, ALFRED_CODE_HOOKS_OFF is the complement of what the run wires and is written EVERY
    // run - a bare install wires every hook, so it writes an empty list over whatever was stored.
    const state = ctx.picked ? deriveState({ selectionText: [...ctx.picked].join('\n'), sourceDir: ctx.source.dir }) : null;
    const hookName = (e) => e.split('::')[0].replace(/\.js$/, '');
    const { hooksOff, hooksAnswered, agentDeny, agentAllow } = writable(state, {
        routes: ctx.routes, answered: ctx.answered,
        wired: ctx.routes.hooks ? null : [...new Set(ctx.lists.hooks.map(hookName))],
        shipped: [...new Set(ctx.manifest.catalogs.hooks.map(hookName))],
    });
    // T16/R47 (I1): at `local` scope the stack's own settings writes are machine-personal - they go
    // to settings.local.json, never the shared settings.json; every other scope keeps the shared
    // file. settingsTarget is the one helper every write site names, so this and importMemory's own
    // target cannot drift apart.
    settings.writeSettings({
        file: settings.settingsTarget(ctx.claudeDir, ctx.args.scope),
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
            seed: docs.docsVersioningSeed({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope) }),
        },
        mcpNames: ctx.routes.mcps ? [] : ctx.lists.mcps.map((e) => e.split('|')[0]),
        mcpOff: (ctx.routes.mcps ? ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS) : []).concat(ctx.retiredMcpsDue),
        memoryDb: ctx.level.dbPath,
        hooksOff, hooksAnswered,
        // N6: at local scope settings.json still applies beneath the local file, so what it holds is no
        // gap for a seed to fill - a local default would hide it.
        inheritedEnv: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).env : null,
        // R99: at every other scope settings.local.json applies OVER settings.json, so a stack key it
        // holds is written back there - where the read-back found it and where it takes effect.
        localFile: ctx.args.scope === 'local' ? null : path.join(ctx.claudeDir, 'settings.local.json'),
        renamed: ctx.manifest.renamed,
        log: ctx.log, note: ctx.note,
    });
}

function importMemory(ctx)
{
    if (ctx.level.level === 'project')
    {
        try { memory.ensureProjectIgnore(ctx.projectRoot, ctx.log); }
        catch (err) { ctx.note(`${memory.MEMORY_DIR}/.gitignore could not be written (${err.message}) - add the folder to the repo's own .gitignore`); }
    }
    // Task 18a I1: the notes import and the switch-off belong to /alfred-code:init (`memory.js init`),
    // which asks the level first and marks the stamp `initialised:`. Until that line holds a date, no
    // run imports - not setup's install, an update, or configure's apply with a level named - or the
    // notes land in a database the user never chose and the router skips init.
    if (!stampLayer.isInitialised(stampLayer.initialisedValue({ claudeDir: ctx.claudeDir })))
    {
        ctx.log("memory: the notes import waits for /alfred-code:init, which asks the level first - Claude's own memory stays on until then");
        return;
    }
    // I1 (R47): the switch-off is one of THIS run's own settings writes, so it follows the same
    // scope target as installHooksAndRules' own write - a local-scope install's `autoMemoryEnabled`
    // now lands in settings.local.json, never the shared file every teammate reads.
    const settingsFile = settings.settingsTarget(ctx.claudeDir, ctx.args.scope);
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

// The servers registered under their bare names, as the tool names spell them - every engine is
// `playwright`. Empty on the plugin route.
const bareNames = (ctx) => mcp.bareNamedMcps({ routes: ctx.routes, mcps: ctx.lists.mcps })
    .map((n) => n.replace(/^playwright-.*/, 'playwright'));

// COPY ROUTE ONLY: a registered server answers `mcp__<server>__<tool>`, never the plugin spelling
// the shipped files carry.
function downconvert(ctx)
{
    const bare = bareNames(ctx);
    if (!bare.length) return;
    if (ctx.routes.skills)
    {
        ctx.log(`  !! these servers are registered under their bare names but the skills and agents come from the plugins, which name the plugin spelling: ${bare.join(' ')} - set ALFRED_CODE_SKILLS_VIA_PLUGIN=false too, or leave them on the plugin route`);
        return;
    }
    const changed = mcp.downconvertToolNames({
        roots: [ctx.skillsDir, path.join(ctx.claudeDir, 'agents'), path.join(ctx.claudeDir, 'rules'), path.join(ctx.claudeDir, 'hooks')],
        bare, log: ctx.log,
    });
    // The re-spelling can rewrite any rule's content in place, after copyLibrary already hashed it -
    // re-hash every tracked rule (a dozen files at most) rather than tracking which ones changed.
    if (changed) rehashKind(ctx.library && ctx.library.rules, path.join(ctx.claudeDir, 'rules'));
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
    ctx.log(line);
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

// The level this project already has: a copy-route registration, else the settings key the plugin
// route's launcher reads (memory-launch.js, same file order: the local file first) - without it an
// update with no --memory-level reset a level init had set to the global default.
const registeredMemoryPath = (mcpFile, claudeDir) =>
{
    const entry = readJson(mcpFile).mcpServers?.memory;
    const p = entry && entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
    if (typeof p === 'string' && p) return p;
    for (const file of claudeDir ? ['settings.local.json', 'settings.json'] : [])
    {
        const env = readJson(path.join(claudeDir, file)).env || {};
        const v = env.ALFRED_CODE_MEMORY_DB || env.CLAUDE_STACK_MEMORY_DB; // legacy-name
        if (typeof v === 'string' && path.isAbsolute(v)) return v;
    }
    return '';
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
        mcps: ctx.lists.mcps,
    });
    const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stack-sel-')), 'selection.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const entries = ctx.rt.runNode(script, ['--selection', file, '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    if (!entries.ok) throw new Error(`plugin set not computed (${entries.stderr.split('\n')[0]})`);
    const copyList = ctx.rt.runNode(script, ['--selection', file, '--copy', '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return { entries: ctx.rt.lines(entries.stdout), copy: ctx.rt.lines(copyList.stdout) };
}

const npxInstall = (ctx, engine) => ctx.rt.capture('npx', ['-y', '-p', `@playwright/mcp${ctx.pins.PW_PIN}`, 'playwright', 'install', engine], { cwd: ctx.projectRoot, env: ctx.env }) !== '';

if (require.main === module)
{
    process.exitCode = main(process.argv.slice(2), process.env, {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
    });
}

module.exports = { main, USAGE, CORE_DEP_PLUGINS, HOOK_ENGINES, SECRET_DENY, RETIRED_DENY };
