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
const { loadManifest, stackNames, stackOwnName } = require('./manifest.js');
const selection = require('./selection.js');
const plugins = require('./plugins.js');
const { pythonRequest } = require('../../stack/mcp/uv-python.js');
const { serenaHomeFor } = require('../../stack/mcp/serena-launch.js');
const dataRoot = require('../../stack/mcp/data-root.js');
const { copyRouteExclude, platformOf, prereqNotes, DESKTOP_OS } = require('../../stack/mcp/desktop-launch.js');
const mcp = require('./mcp.js');
const copy = require('./copy.js');
const settings = require('./settings.js');
const serena = require('./serena.js');
const memory = require('./memory.js');
const docs = require('./docs.js');
const { deriveState, writable, homeOf, splitPick, stackSeat } = require('../derive-state.js');
const { placement, readRetiredEntries, readRetiredPlugins, CORE } = require('../plugin-placement.js');
const seeds = require('./seeds.js');
const pinsLayer = require('./pins.js');
const stampLayer = require('./stamp.js');
const library = require('./library.js');
const uninstallLayer = require('./uninstall.js');
const runtime = require('./runtime.js');
const { envMigrations } = require('./env-migrations.js');
const { BRAND, LEGACY, marketOf } = require('./brand.js');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

const USAGE = `alfred-code - install or update the Claude Code stack into a project.

Usage: node ${path.basename(__filename)} <install|update|uninstall> [flags]

Action (one is REQUIRED, positional):
  install   first-time provision; wires .claude/settings.json
  update    refresh hooks/agents/rules and the runtimes at the release pins; idempotent
  uninstall remove what the stamp's ledger says the stack manages here, and nothing else

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
// R10: every deny entry a release has written into a project's settings besides the seat denies - the
// ledger removes no other, since a stamp is project text. A release that stops writing one keeps it here.
const SHIPPED_DENY = [...SECRET_DENY];
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
// shell-guards.js is the dispatcher the copy route wires for the picked shell guards (no catalog row).
const HOOK_MODULES = ['hook-prelude.js', 'fresh-session.js', 'shell-writes.js', 'hidden-chars.js', 'shell-guards.js'];
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
    try { args = parseArgs(argv); }
    catch (e) { err(`${USAGE}\nerror: ${e.message}\n`); return 1; }

    const home = env.HOME || env.USERPROFILE || '';
    // With no home and no CLAUDE_CONFIG_DIR the account dir would be a RELATIVE `.claude` - the
    // project's own, against the cwd - and an account key would land in its tracked settings.json.
    if (!home && !env.CLAUDE_CONFIG_DIR)
    {
        err('error: no account directory - HOME, USERPROFILE and CLAUDE_CONFIG_DIR are all unset; set one and run again\n');
        return 1;
    }
    const configDir = env.CLAUDE_CONFIG_DIR
        || path.join(home, args.space ? `.claude-${args.space}` : '.claude');
    // A-I5 (final review A, ruling): a `claude` spawned with the run's own env uses the account THAT env
    // names - with --space and no CLAUDE_CONFIG_DIR, the default one, while every write of the installer's
    // own lands in the space's. So every CLI spawn carries the space's account; one set already wins.
    const cliEnv = args.space && !env.CLAUDE_CONFIG_DIR ? { ...env, CLAUDE_CONFIG_DIR: configDir } : env;
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
    // R10: uninstall reads the stamp's ledger and nothing else - no stamp, or one from before the
    // ledger, is refused here, before any call is made or anything is written.
    if (args.action === 'uninstall')
    {
        const stamped = stampLayer.stampFiles({ projectRoot }).read;
        if (!stamped) { err(`error: no alfred-code install here - ${claudeDir} holds no stamp, so there is nothing to uninstall\n`); return 1; }
        if (!stampLayer.readLedger(stamped))
        {
            err('error: this install\'s stamp predates the install ledger, so what the stack wrote here cannot be told apart from what you did - run /alfred-code:update once (it records the ledger), then uninstall\n');
            return 1;
        }
    }
    let skillsDir = path.join(projectRoot, '.claude', 'skills');
    const mcpFile = path.join(projectRoot, '.mcp.json');
    // The memory database this install points at: the flag's level, else the path already registered,
    // else global. C9 (R136 r): CLAUDE_CONFIG_DIR alone names the account, but the global and scoped
    // databases live under the HOME - with none they would be a RELATIVE path, written into settings and
    // resolved against whatever cwd reads it. Refused like the no-home case above, before anything runs.
    // THE DATA ROOT (stack/mcp/data-root.js): the one folder this run lays the project's data under - the
    // docs, serena's folder and home, the browser profiles, a project-level memory database. Resolved before
    // the memory level, whose project database sits under it.
    const dataInfo = resolveDataRoot({ args, claudeDir, projectRoot, log });
    const level = memory.resolveLevel({
        flag: args.memoryLevel,
        registeredPath: registeredMemoryPath(mcpFile, claudeDir),
        home, space: args.space, projectRoot, root: dataInfo.root,
    });
    if (!home && !path.isAbsolute(level.dbPath))
    {
        err(`error: no home directory - HOME and USERPROFILE are unset, so the ${level.level} memory database would be the relative path ${level.dbPath}; set HOME, or pass --memory-level project\n`);
        return 1;
    }
    // R105: a `claude` found on PATH that cannot be STARTED (a batch file spawned without cmd.exe, a
    // missing interpreter) is said once, here, and the run goes on as without one - never a failure
    // line per plugin, and never a call that fails with no line at all.
    const claudeBroken = rt.which('claude', { env: cliEnv }) ? rt.unrunnable('claude', { cwd: projectRoot, env: cliEnv }) : null;
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
        ? rt.cliRunner('claude', { cwd: projectRoot, env: cliEnv, out: plain, fail: note })
        : () => false;
    // The marketplaces this run already refreshed, so no later pass pays the round trip twice.
    const refreshed = new Set();

    // THE MARKETPLACE KEY every stack spec of this run is spelled with: the key whose core is installed
    // (a 1.x install keeps `claude-stack`), else a registration of the stack's repo, else the current // legacy-name
    // name - read from the listings, never assumed (brand.js marketOf).
    const readRaw = () => (hasClaude ? rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: cliEnv }) : '');
    const readMarkets = () => (hasClaude ? plugins.parseMarketplaces(rt.capture('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: projectRoot, env: cliEnv })) : []);
    let market = BRAND.marketplace;
    let marketSeen = { listing: [], marketplaces: [] };
    let rawListing = null;

    if (args.action === 'uninstall')
        return runUninstall({ projectRoot, claudeDir, configDir, accountFile: path.join(cliEnv.CLAUDE_CONFIG_DIR || home, '.claude.json'), env, hasClaude, claudeBroken, cli, readRaw, readMarkets, log, note, err, failures: () => failures });

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
        const manifest = loadManifest(resolved.dir);
        // Task 3 (2.1.0): a legacy copy-route install that never wrote a stamp - the router's own test
        // (stamp.js legacyUnstamped), read BEFORE any layer prunes the old copies it is recognised by. Its
        // picks come off disk, and it is an install from before the ledger, like an older stamp's (below).
        const legacyUnstamped = !stampFile && stampLayer.legacyUnstamped(projectRoot, { manifest });
        // R10: the last run's ledger - what it wrote and manages here. Null for a stamp from before it
        // (and a 1.x account stamp, and an unstamped legacy install): each layer then falls back to its old
        // evidence. No stamp at all is otherwise a project the stack has managed nothing in yet, so whatever
        // is already there is the user's.
        const priorLedger = stampFile ? stampLayer.readLedger(stampFile) : legacyUnstamped ? null : stampLayer.emptyLedger();

        // A-I1 (final review A, ruling): an unmigrated 1.x GLOBAL install - the router's legacy-global
        // test - keeps the scope its account stamp names (`global` = user), whatever --scope arrives: the
        // 1.3.0 update body passes a model-judged one, and 'project' put the core beside the live
        // user-scope alias. A repo never set up is not one, and keeps the scope it was handed.
        if (unmigrated && stampLayer.legacyGlobalStamp(projectRoot, { ...env, CLAUDE_CONFIG_DIR: configDir }))
        {
            const raw = stampLayer.readStampScope(legacyAcct).toLowerCase();
            const legacyScope = raw === 'global' ? 'user' : raw;
            if (legacyScope && ENUMS.scope.values.includes(legacyScope))
            {
                if (args.scope && args.scope !== legacyScope)
                    log(`scope: this project is a 1.x global install - migrated at ${legacyScope} scope (the passed --scope ${args.scope} is ignored on this first run)`);
                args.scope = legacyScope;
            }
        }

        // I3 (R47): args.js left '' when --scope was not given. `update` takes the
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
        if (legacyUnstamped) log('no stamp: an unstamped legacy install - its picks are read from disk, an old name under its new one');

        // C5: at project and user scope a route switch only settings.local.json holds is personal, and
        // never decides what this run commits (plugins.js committedRoutes).
        const routes = plugins.committedRoutesAt({ env, claudeDir, scope: args.scope, log });
        // C10: the project memory level needs no refusal at user scope any more - on the full copy route,
        // the one route that registers memory itself, the registration lands in this project's .mcp.json
        // (mcp.registrationScope), so its path is this project's alone.

        // T16/R47 (I4): the migration is a WRITE - a real `update` only, never `--print-plan`
        // (configure and validate call it as a run that writes nothing), inside the try so an EACCES
        // is reported. C1/m1: a failed copy goes through `note`.
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
            const seeds = Object.fromEntries(rows.filter((r) => !r.written).map((r) => [r.key, [r.default, ...(r.former_defaults || [])]]));
            seeds.ALFRED_CODE_DOCS_VERSIONING = [docs.docsVersioningSeed({ projectRoot, docsPath: copy.resolveDocsRoot(projectRoot, args.scope) })];
            for (const [key, shippedSeed] of envMigrations(readJson(path.join(resolved.dir, 'meta', 'migrations.json'))).reseed)
                (seeds[key] ??= []).push(shippedSeed);
            const move = settings.leaveLocalScope({
                claudeDir,
                hookFiles: [...new Set(manifest.catalogs.hooks.map((e) => e.split('::')[0]))].concat('shell-guards.js'),
                mcpNames: manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS, mcp.renamedFrom(manifest.renamed.mcps)),
                denySpecs: SECRET_DENY, seeds, written: rows.filter((r) => r.written).map((r) => r.key), log, note,
                // R10: the ledger says exactly which local keys the stack wrote; the seeds are the fallback.
                ledgerEnv: priorLedger && priorLedger.env ? priorLedger.env['settings.local.json'] || {} : null,
                ledgerSettings: priorLedger && priorLedger.settings ? priorLedger.settings['settings.local.json'] || {} : null,
                ledgerDeny: priorLedger ? priorLedger.deny : null,
            });
            // Review finding 1: the ledger's deny rows follow what the move carried, so the writer below
            // claims in settings.json only what landed there - never an entry the team already held.
            if (move.ledgerDeny) priorLedger.deny = move.ledgerDeny;
        }

        // --- the six lists, narrowed to this project -------------------------------
        let lists = {
            skills: manifest.skills, agents: manifest.agents, rules: manifest.rules,
            hooks: manifest.hooks, plugins: manifest.plugins, mcps: manifest.mcps,
        };
        // The browser engines the last install INSTALLED, and the ones the user chose to enable (R67) -
        // the stamp's word, never the listing's flag: an engine left off is still installed, and a
        // project-scope flag can read a stale false (S22). On EVERY route (R116): a switch onto the copy
        // route finds no registration yet, and read from .mcp.json alone it wrote both lines blank - the
        // record a later switch back installs the engines from.
        // A stamp from before the 2.0.0 rename spells both lines `playwright-*` (`legacy`): the same record.
        const priorPw = stampLayer.readBrowserLines(stampFile);
        // null when the stamp has no such line (1.x, no stamp): nothing recorded, and the listing speaks.
        const stampEngines = priorPw.browsers;
        // The copy route's own switch (R116 j): the engines .mcp.json registers before this run, and on
        // each the settings files' disabledMcpjsonServers - an entry in any of them rejects the server.
        const mcpjsonOff = [path.join(claudeDir, 'settings.json'), path.join(claudeDir, 'settings.local.json'), path.join(configDir, 'settings.json')]
            .flatMap((f) => { const v = readJson(f).disabledMcpjsonServers; return Array.isArray(v) ? v : []; });
        const mcpjsonEngines = registeredEngines(mcpFile);
        // Registered under the CURRENT name: one .mcp.json still holds as `playwright-<engine>` registers
        // anew as `browser-<engine>`, so its off-state is listed anew too (mcp.mcpjsonSwitch).
        const mcpjsonCurrent = registeredEngines(mcpFile, { legacy: false });
        // An engine .mcp.json registers under its pre-rename name is switched off under that name.
        const liveCopy = (e) => (mcpjsonEngines.includes(e) ? !mcpjsonOff.includes(`browser-${e}`) && !mcpjsonOff.includes(`playwright-${e}`) : undefined);

        let picked = null;
        // The desktop servers drive THIS machine's own apps (stack/mcp/desktop-launch.js): each is kept on its
        // own OS only, and one left out is said in one line - never installed to fail at launch. `io.platform`
        // (the tests) or ALFRED_CODE_PLATFORM stands in for the OS. Gated BEFORE a closure too, so a server this
        // OS refuses brings no skill in either.
        const platform = io.platform || platformOf(env);
        const desktopSaid = new Set();
        const desktopLines = (lines) => lines.filter((l) =>
        {
            const m = /^mcp (\S+)$/.exec(String(l).trim());
            const gate = m ? mcp.desktopGate({ mcps: [m[1]], platform, market }) : null;
            if (!gate || gate.kept.length) return true;
            if (!desktopSaid.has(m[1])) log(gate.lines[0]);
            desktopSaid.add(m[1]);
            return false;
        });
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
                foreignSkill: skillTest({ skillsDir, stampFile, manifest, sourceDir: resolved.dir }).foreign,
                mcpServers: Object.keys(readJson(mcpFile).mcpServers || {}),
                listing, stackListing,
                // I2 / N5: the file this run writes, or at local scope settings.local.json laid over
                // settings.json for `env` and `permissions.deny` (settings.js readBackSettings).
                settings: settings.readBackSettings(claudeDir, leavingLocal && args.printPlan ? 'local' : args.scope),
                routes, manifest, sourceDir: resolved.dir,
                stampHooks: readStampHooks(stampFile),
                lastHooksRoute: stampLayer.readHooksRoute(stampFile),
                stampPicked: lastPicked, stampEngines,
                // 2.1.0: how the last run delivered the seats (null before 2.1.0 - its core carried the
                // always closure), and the seats whose deny the stack itself wrote (a deny gone from
                // one of those since is the user's hand-allow).
                seatsRoute: stampLayer.readSeatsRoute(stampFile),
                ledgerSeats: [...new Set(((priorLedger && priorLedger.deny) || []).map((d) => stackSeat(d.entry)).filter(Boolean))],
                always, marketplace: market, said: renaming.said, scope: cliScope, isOn: engineOn({ configDir, claudeDir }), log,
                sharedOnlyDeny: (leavingLocal && args.printPlan ? 'local' : args.scope) === 'local' ? settings.sharedOnlyDeny(claudeDir) : [],
                // C5: the copy route's hooks are committed wiring - read from settings.json alone there.
                committedEnv: (leavingLocal && args.printPlan ? 'local' : args.scope) === 'local' ? null : settings.readBackSettings(claudeDir, 'project', { sharedOnly: true }).env || {},
            });
            if (!back.installed)
            {
                err(`error: --installed-only found nothing installed under ${claudeDir} - run 'install' (or /alfred-code:setup) first\n`);
                return 1;
            }
            leftOut = selection.leftOut({ parked: back.parked, deny: back.deny });
            const withAdds = desktopLines(selection.addLines(back.lines, args.add, log));
            const graph = readJson(path.join(resolved.dir, 'meta', 'stack-graph.json'));
            // The always-on rules, skills and servers are locked: the read-back adopts them whatever the
            // disk says, so a drop of one would come straight back on the next update. (A skill's own
            // per-project lever is `skillOverrides`, which leaves the copy in place.)
            const locked = new Set([...(always.rules || []).map((n) => `rule ${n}`), ...(always.skills || []).map((n) => `skill ${n}`), ...(always.mcps || []).map((n) => `mcp ${n}`)]);
            for (const l of args.drop.filter((d) => locked.has(d)))
                log(`installed-only: --drop ${l} not applied - locked, every install carries it`);
            const drops = args.drop.filter((d) => !locked.has(d));
            // A drop runs BEFORE the closure, so an item something kept still requires comes straight
            // back and is reported - the walk's own closure would have kept it, and a drop the next
            // update's closure undoes is no drop at all.
            const withDrops = selection.dropLines(withAdds, drops, log);
            // Every seat rides the core (2.1.0), so a deny also stands for 'never picked' - a seat an --add
            // REQUIRES is taken with it (the add is the user's newest word); the closure over the kept
            // picks still leaves a denied seat out.
            const addSeats = new Set(graph.catalog && args.add.length ? require('../stack-select.js').computeClosure(graph, {
                skills: args.add.filter((l) => l.startsWith('skill ')).map((l) => l.slice(6)), agents: args.add.filter((l) => l.startsWith('agent ')).map((l) => l.slice(6)),
                rules: args.add.filter((l) => l.startsWith('rule ')).map((l) => l.slice(5)), mcps: [], plugins: [],
            }).agents : []);
            const closeDeny = back.deny.filter((d) => !addSeats.has(stackSeat(d)));
            const close = (lines, from, say) => selection.closeLines(lines, { from, graph: graph.catalog ? graph : null, parked: back.parked, deny: closeDeny, log: say });
            const from = desktopLines([...back.closeFrom, ...args.add]).filter((l) => !drops.includes(l));
            let closed = close(withDrops, from, log);
            // A layer the closure brought in (a skill requiring context7 in an install that carried
            // no server) is carried now, so the locked set joins it in THIS run - adopted only by the
            // next update, one update was not the fixed point.
            // An always seat this run's --drop switched off is not adopted back (its deny lands only now).
            const adopted = selection.adoptAlways({ lines: closed, always, log, deny: back.deny, coreOn: plugins.corePluginOn(routes) })
                .filter((l) => closed.includes(l) || !drops.includes(l));
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
        // A selection picks from every SHIPPED server - the opt-in rows (the desktop servers, `active: false`)
        // included; with none, the run takes the default list, which leaves them out.
        if (picked) lists = selection.applySelection({ ...lists, mcps: manifest.catalogs.mcps }, picked);
        // R83 a: the locked three are every install's. A plugin route adds their plugins in `pluginSet`;
        // the FULL copy route registers only what this list names, so they are put back here, before
        // the plan is printed, so the plan, the registrations and the stamp agree.
        if (!plugins.corePluginOn(routes)) lists.mcps = mcp.withLocked({ mcps: lists.mcps, catalog: manifest.catalogs.mcps, log });
        for (const line of args.add)
        {
            const [category, name] = line.split(' ');
            const key = Object.keys(selection.CATEGORY).find((k) => selection.CATEGORY[k].line === category);
            if (key === 'mcps' && desktopSaid.has(name)) continue;   // shipped, and left out by the OS gate above
            if (!(lists[key] || []).some((e) => selection.CATEGORY[key].name(e) === name))
                note(`--add ${line} names nothing this release ships - ignored`);
        }
        // A selection file is already closed, so the gate reads its server lines here (said once per name).
        const desktop = mcp.desktopGate({ mcps: lists.mcps, platform, market });
        lists.mcps = desktop.kept;
        for (const line of desktop.lines) if (!desktopSaid.has(line.split(' ')[1])) log(line);

        // --- the two entries assembled at install time -----------------------------
        const pins = args.printPlan
            ? { PW_PIN: '', SERENA_PIN: '', MEMORY_PIN: '', WINDOWS_DESKTOP_PIN: '', MACOS_DESKTOP_PIN: '', MEMORY_BACKEND: 'sqlite_vec' }
            : mcp.resolvePins({ pins: readJson(path.join(resolved.dir, 'meta', 'mcp-pins.json')).pins, log });

        const pw = mcp.expandPlaywright({
            mcps: lists.mcps,
            browsers: args.playwrightBrowsers,
            registered: [...new Set([...mcpjsonEngines, ...listedEngines, ...(stampEngines || [])])],
        });
        lists.mcps = pw.mcps;
        // Which of them are ENABLED: the user's answer when given, else each keeps its last recorded
        // choice and a new one is on. An answer naming an engine this run does not install is refused
        // here, before anything is written.
        const pwOn = mcp.playwrightEnabled({ kept: pw.browsers, flag: args.playwrightEnabled, prior: priorPw, live: liveCopy });
        if (pwOn.outside.length)
        {
            err(`error: --browser-enabled names ${pwOn.outside.join(',')}, which this run does not install (installs: ${pw.browsers.join(',') || 'none'}) - enable only an engine being installed\n`);
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
                const OUTCOME = /plugin pruned|add it back:|plugin removed|core moved to|context7-local removed/;
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
                if (!listing) listing = hasClaude ? plugins.parsePluginList(rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: cliEnv }), projectRoot) : [];
                const inv = selection.planInventory({
                    lists, listing, answered, leftOut, pluginCatalog: manifest.catalogs.plugins.map((id) => id.split('@')[0]),
                });
                // What configure's walk pre-selects for the browser: the kept engines, and of them the ones
                // ON NOW - the settings file where each is installed, which a /plugin toggle writes; the
                // stamp's last answer only where that file names nothing. Plugin route only.
                const isOn = engineOn({ configDir, claudeDir });
                const specOf = (e) => `browser-${e}@${market}`;
                inv.browser = mcp.playwrightLive({
                    kept: pw.browsers, prior: priorPw,
                    live: (e) => (routes.mcps ? isOn(specOf(e), plugins.scopeFor(specOf(e), cliScope, listing)) : liveCopy(e)),
                });
                fs.writeFileSync(args.planOut, JSON.stringify(inv, null, 2) + '\n');
            }
            return 0;
        }

        // --- the run ---------------------------------------------------------------
        // The data move: what is owed, what this run moves itself (a server no launcher starts on this
        // route), what it leaves to a launcher's next start - then where each class lives now, which is what
        // the copy route registers and the settings name.
        const lockedPlugin = Boolean(routes.mcps) || plugins.corePluginOn(routes);
        const launched = (cls) => (cls === 'serena' || cls === 'memory' ? lockedPlugin : Boolean(routes.mcps));
        const dataPlan = planDataMove({
            projectRoot, info: dataInfo, engines: pw.browsers, memoryProject: level.level === 'project', launched,
            answer: args.dataMove, stamped: (Boolean(stampFile) && fs.existsSync(stampFile)) || Boolean(legacyUnstamped), log, note,
        });
        const liveOf = (cls) => dataRoot.liveDir({ projectDir: projectRoot, cls, root: dataInfo.root, pending: dataPlan.pending, move: false }).dir;
        level.dbPath = liveMemoryPath({ level, projectRoot, home, liveOf, owed: dataPlan.pending.some((r) => r.cls === 'memory' && launched('memory')), registered: registeredMemoryPath(mcpFile, claudeDir) });
        const tokens = {
            SERENA_CONTEXT: 'claude-code', MEMORY_DB_PATH: level.dbPath,
            // The copy route's `uvx --python`: the same machine-level answer the plugin launchers use.
            // Read from the SEED's own tree, never the snapshot's: a snapshot older than the seed has no
            // such file, and its manifest then carries no @UV_PYTHON@ to resolve anyway.
            // A-I5: the account the run's claude calls use - a --space run's own, not the default one.
            UV_PYTHON: pythonRequest({ env: cliEnv, projectDir: projectRoot }),
            // serena's home in the platform's own separator: a '/' reaches cmd.exe on Windows - under the data
            // root, or in a 2.0.0 .serena not moved yet.
            SERENA_HOME: serenaHomeFor(process.platform, dataInfo.root, liveOf('serena')),
            // Each browser engine's profile folder (mcp.pwArgsFor spells the manifest's @BROWSER_DIR@ per engine).
            ...Object.fromEntries(dataRoot.ENGINES.map((e) => [`BROWSER_DIR_${e.toUpperCase()}`, liveOf(`browser-${e}`)])),
            SERENA_PIN: pins.SERENA_PIN, PW_PIN: pins.PW_PIN,
            MEMORY_PIN: pins.MEMORY_PIN, MEMORY_BACKEND: pins.MEMORY_BACKEND,
            WINDOWS_DESKTOP_PIN: pins.WINDOWS_DESKTOP_PIN, MACOS_DESKTOP_PIN: pins.MACOS_DESKTOP_PIN,
            // windows-desktop's tool gate on the copy route, which registers no launcher: the list the
            // launcher would pass, as Windows-MCP's own WINDOWS_MCP_EXCLUDE_TOOLS.
            WINDOWS_DESKTOP_EXCLUDE: copyRouteExclude({ env: cliEnv, projectDir: projectRoot }),
        };
        // The one remote server the copy route registers: documentation (Context7), the hosted transport only (2.0.0).
        const remotes = { documentation: mcp.CONTEXT7_REMOTE };
        // What a release retired from the MCP catalog and this run still prunes: the first update past
        // a retirement only (mcp.dueRetired) - after it, the name is the user's add-back registration.
        const versionDue = mcp.dueRetired({
            names: manifest.retired.mcps, rows: readRetiredPlugins(resolved.dir),
            lastVersion: stampLayer.readVersion(stampFile), compare: compareVersions,
        });
        // R10: at project scope the ledger answers exactly - a retired name's .mcp.json entry is due only
        // when the last run recorded it and nobody changed it since; the version gate is the fallback
        // for a stamp with no ledger, and for a name the file does not hold.
        const heldMcp = mcp.registrationsAt({ scope: 'project', mcpFile, projectRoot }).servers;
        const retiredMcpsDue = priorLedger && priorLedger.mcp && cliScope === 'project'
            ? manifest.retired.mcps.filter((n) => (heldMcp[n] ? priorLedger.mcp[n] === stampLayer.entryHash(heldMcp[n]) : versionDue.includes(n)))
            : versionDue;
        const ctx = {
            args, env, cliEnv, log, note, plain, cli, rt, source: resolved, manifest, lists, routes,
            projectRoot, claudeDir, skillsDir, configDir, mcpFile, home, stampFile,
            pins, tokens, remotes, level, hasClaude, claudeBroken, picked, answered, dropEntries, cliScope, refreshed,
            market, marketSeen, readMarkets, retiredMcpsDue, leavingLocal, ledger: priorLedger, legacyUnstamped,
            dataInfo, dataPlan, liveOf,
            // The MCP plugin and server names the 2.0.0 rename left behind (manifest `renamed.mcps`).
            legacyMcps: mcp.renamedFrom(manifest.renamed.mcps),
            // A-M2/M3: the account file a user- or local-scope registration lives in, the registrations
            // read from each scope (once per run), and the names kept as another server's.
            accountFile: path.join(cliEnv.CLAUDE_CONFIG_DIR || home, '.claude.json'),
            mcpRegs: {}, mcpForeign: new Map(), mcpSaid: new Set(),
            pw: { prior: priorPw, ...pwOn, mcpjson: mcp.mcpjsonSwitch({ routes, scope: mcp.registrationScope(routes, cliScope), kept: pw.browsers, enabled: pwOn.enabled, apply: pwOn.apply, registered: mcpjsonCurrent }) },
            // M9 (R132): what the full copy route switched off here - the stamp's record, this run's
            // own stand-down, and what a switch back could not enable yet.
            standDown: { prior: stampLayer.readStoodDown(stampFile), now: [], owed: null },
            // The desktop servers this project held before the run (its plugin rows, or on the copy route its
            // registrations) - set by the layer that reads them, so the prerequisites are said once.
            desktopHeld: null,
            // M3: the skills a same-named project folder kept from this run - never recorded as the stack's picks.
            foreignSkills: new Set(),
        };
        // R116 (j): an engine left off does not load. At project scope the copy route lists it in
        // disabledMcpjsonServers; at local and user scope no settings key reaches a registration, so
        // there the registration is the enable and an engine left off is not registered (R124 l).
        if (ctx.pw.mcpjson.unregistered.length)
            log(`browser: ${ctx.pw.mcpjson.off.join(',')} left off - not registered at ${cliScope} scope, where the registration is the enable (the stamp keeps it installed; /alfred-code:configure turns it on)`);
        else if (ctx.pw.mcpjson.off.length)
            log(`browser: ${ctx.pw.mcpjson.off.join(',')} left off - disabledMcpjsonServers keeps it from loading (taking it out of that list, or /alfred-code:configure, turns it on)`);

        const pinSnapshot = args.keepPins
            ? pinsLayer.snapshotPins({ files: pinFiles(ctx), log })
            : null;

        copy.removeDropped({
            drop: args.dropApplied || [], log, keep: (category, name) => category === 'skill' && foreignSkill(ctx, name),
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

        pruneDroppedCopies(ctx);
        stampLayer.writeStamp({
            source: resolved, action: args.action, scope: args.scope, configDir, projectRoot, mcpFile,
            hooksCatalog: manifest.catalogs.hooks, hooksRoute: ctx.routes.hooks ? 'plugin' : 'copy', seatsRoute: ctx.routes.skills ? 'plugin' : 'copy',
            version: releaseVersion(resolved.dir), log, note,
            picked: withoutForeign(stampPickLists(lists, stampPicks, carriedPicks), ctx.foreignSkills), playwright: pwEngines(ctx), playwrightEnabled: ctx.pw.enabled,
            stoodDown: stoodDownRecord(ctx),
            library: ctx.library || { skills: {}, agents: {}, rules: {} },
            ledger: ledgerOf(ctx),
            data: { root: dataInfo.root, pending: dataPlan.pending, kept: dataPlan.kept },
        });

        warmMemoryModel(ctx);
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
    desktopNotes(ctx);
    seeds.seedAccountKeys({ configDir: ctx.configDir, env: ctx.env, log: ctx.log, note: ctx.note });
    docsRootStep(ctx);
    installHooksAndRules(ctx);
    importMemory(ctx);
    const docsPath = copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope);
    docs.migrateDocsDomains({ projectRoot: ctx.projectRoot, docsPath, log: ctx.log });
    // The root states its own versioning to git (docs.ensureDocsIgnore) - after the settings pass, so
    // it reads the decision this run just wrote.
    try
    {
        const mode = copy.resolveDocsVersioning(ctx.projectRoot, ctx.args.scope) || docs.docsVersioningSeed({ projectRoot: ctx.projectRoot, docsPath });
        docs.ensureDocsIgnore({ projectRoot: ctx.projectRoot, docsPath, mode, log: ctx.log });
    }
    catch (err) { ctx.note(`${docsPath}/.gitignore could not be written (${err.message}) - add the docs root's machine state to the repo's own .gitignore`); }
    if (args.action === 'install') ctx.seededClaudeMd = seeds.seedClaudeMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, log: ctx.log, note: ctx.note });
    selection.respellRenamed({ projectRoot: ctx.projectRoot, renamed: ctx.manifest.renamed, log: ctx.log, note: ctx.note });
    if (plugins.corePluginOn(ctx.routes))
        selection.respellRosterSeats({ projectRoot: ctx.projectRoot, core: CORE, seats: placement().plugins[CORE].agents, log: ctx.log, note: ctx.note });
    dataRootLayer(ctx, docsPath);
    seeds.playwrightDownloads({
        browsers: pwEngines(ctx),
        pin: ctx.pins.PW_PIN,
        run: (engine) => ctx.rt.runNode !== undefined && npxInstall(ctx, engine),
        log: ctx.log,
    });
    downconvert(ctx);
}

// The data root's own files, once the docs root is settled: its `.gitignore` (docs.ensureDataIgnore - the
// docs stay visible to git, everything else is machine state), serena's project.yml seeded where serena
// reads it this run (the root, or a 2.0.0 .serena its launcher has not moved yet) and its home config
// pointing serena at the folder (the launcher writes it too - the installer's copy serves the copy route,
// which runs no launcher, and a `serena project index` run before any start). A 2.0.0 place still in use
// keeps its own `.gitignore`; a root the data left is removed once only its `.gitignore` remains.
function dataRootLayer(ctx, docsPath)
{
    const { projectRoot, log, note } = ctx;
    const root = ctx.dataInfo.root;
    try { docs.ensureDataIgnore({ projectRoot, root, docsPath, log }); }
    catch (err) { note(`${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore, keeping its docs/ folder visible`); }
    const navigation = ctx.lists.mcps.some((e) => e.startsWith('navigation|'));
    const serenaDir = ctx.liveOf('serena');
    serena.seedProject({ projectRoot, selected: navigation, dir: serenaDir, root, log });
    if (navigation && serenaDir !== dataRoot.LEGACY.serena)
    {
        try
        {
            const said = dataRoot.ensureSerenaConfig(path.join(projectRoot, ...`${serenaDir}/home`.split('/')), serenaDir);
            if (said !== 'current') log(`  serena: ${serenaDir}/home/serena_config.yml ${said === 'kept' ? 'names its own project folder - left as it is' : `${said} - the per-project folder is ${serenaDir}`}`);
        }
        catch (err) { note(`${serenaDir}/home/serena_config.yml could not be written (${err.message}) - serena falls back to .serena`); }
    }
    // A 2.0.0 place in use, or one holding data again after its move (a reader still on the old place wrote
    // there, and its own .gitignore left with the folder): kept out of git either way.
    const holdsAt = (rel) => { try { return fs.readdirSync(path.join(projectRoot, ...rel.split('/'))).some((n) => n !== '.gitignore'); } catch { return false; } };
    if (serenaDir === dataRoot.LEGACY.serena || holdsAt(dataRoot.LEGACY.serena))
    {
        try { serena.ensureSerenaIgnore({ projectRoot, selected: navigation || holdsAt(dataRoot.LEGACY.serena), log }); }
        catch (err) { note(`.serena/.gitignore could not be written (${err.message}) - add .serena/ to the repo's own .gitignore`); }
    }
    const legacyEngines = pwEngines(ctx).filter((e) => ctx.liveOf(`browser-${e}`) === dataRoot.legacyOf(`browser-${e}`) || holdsAt(dataRoot.legacyOf(`browser-${e}`)));
    try { mcp.ensurePlaywrightIgnore({ projectRoot, engines: legacyEngines, log }); }
    catch (err) { note(`.playwright/.gitignore could not be written (${err.message}) - add .playwright/ to the repo's own .gitignore`); }
    for (const old of new Set([ctx.dataInfo.prior, ...ctx.dataPlan.left].filter((r) => r && r !== root)))
        docs.pruneDataRoot({ projectRoot, root: old, log });
    // The 2.0.0 browser folder once every profile left it: only the stack's own `.gitignore` remains.
    const pw = path.join(projectRoot, dataRoot.LEGACY.browser);
    try
    {
        const names = fs.readdirSync(pw);
        if (names.length === 1 && names[0] === '.gitignore' && fs.readFileSync(path.join(pw, '.gitignore'), 'utf8') === '*\n')
        { fs.rmSync(pw, { recursive: true }); log(`  data root: ${dataRoot.LEGACY.browser}/ removed - every profile moved`); }
    }
    catch { /* absent, or not the stack's to remove */ }
    if (ctx.dataPlan.moved.length || ctx.dataPlan.pending.length)
        log(`data root: ${root} - ${ctx.dataPlan.moved.length} moved now, ${ctx.dataPlan.pending.length} waiting for a server's next start; restart the session`);
}

// THE DATA ROOT this run lays the project's data under (stack/mcp/data-root.js): the settings value this
// install reads (settings.local.json over settings.json - never a shell export), else the root the last
// stamp recorded, else `.alfred`. `--data-path` changes it only where no data would be stranded: with
// `--data-move move`, or when the current root holds nothing. `prior` is where the data may still be - the
// root this run leaves, or one the stamp names that a hand edit replaced.
function resolveDataRoot({ args, claudeDir, projectRoot, log })
{
    const stampRead = stampLayer.stampFiles({ projectRoot }).read;
    const recorded = stampRead ? stampLayer.readDataLines(stampRead) : { root: '', pending: [], kept: false };
    let current = recorded.root || dataRoot.DATA_ROOT_DEFAULT;
    let invalid = false;
    for (const name of ['settings.local.json', 'settings.json'])
    {
        const raw = (readJson(path.join(claudeDir, name)).env || {}).ALFRED_CODE_DATA_PATH;
        if (typeof raw !== 'string' || !raw) continue;
        const checked = dataRoot.checkDataPath(raw);
        if (checked.ok) current = checked.value;
        else { invalid = true; log(`data root: ALFRED_CODE_DATA_PATH '${raw}' in ${name} refused (${checked.why}) - ${current} used; fix or remove the value`); }
        break;
    }
    let root = current;
    if (args.dataPath && args.dataPath !== current)
    {
        const base = path.join(projectRoot, ...current.split('/'));
        let holds = false;
        try { holds = fs.readdirSync(base).some((n) => n !== '.gitignore'); } catch { holds = false; }
        if (holds && args.dataMove !== 'move')
            log(`data root: --data-path ${args.dataPath} not applied - ${current} holds this project's data; pass --data-move move to carry it there`);
        else root = args.dataPath;
    }
    const prior = root !== current ? current : (recorded.root && recorded.root !== root ? recorded.root : null);
    return { root, current, prior, recorded, invalid };
}

// What the data move owes and does this run. A pending line carried from the last run stays while its data
// still sits at `from` and its target is this root's; one whose server no launcher starts on this route is
// retried inline. `--data-move move` moves every class whose data is elsewhere: inline where no launcher
// runs (the copy route - a browser profile a browser holds, or a database a server has open, waits), else
// recorded for the launcher, which moves it at the server's next start. `keep` cancels what is owed and
// marks the layout kept. No answer moves nothing and names the offer.
function planDataMove({ projectRoot, info, engines, memoryProject, launched, answer, stamped, log, note })
{
    const abs = (rel) => path.join(projectRoot, ...rel.split('/'));
    // A folder holding nothing but its `.gitignore` holds no data (data-root.js reads it the same way).
    // A link is no data (M5: the project memory folder's 2.0.0 place, linked to its moved folder).
    const holds = (rel) => { try { return !fs.lstatSync(abs(rel)).isSymbolicLink() && fs.readdirSync(abs(rel)).some((n) => n !== '.gitignore'); } catch { return false; } };
    const same = (a, b) => a.cls === b.cls && a.from === b.from && a.to === b.to;
    const server = (cls) => (cls === 'serena' ? 'navigation' : cls === 'memory' ? 'memory' : cls);
    const inline = (row) =>
    {
        // M2: serena's own check too - on the copy route the session running this installer has its serena open there.
        const busy = row.cls.startsWith('browser-') ? dataRoot.profileLocks : row.cls === 'memory' ? dataRoot.busyDbs : row.cls === 'serena' ? dataRoot.serenaBusy : () => [];
        const held = busy(abs(row.from));
        if (held.length) return { ok: false, why: `held open: ${held.join(', ')}` };
        const r = dataRoot.movePlace({ projectDir: projectRoot, cls: row.cls, from: row.from, to: row.to });
        if (r.state !== 'moved') return { ok: false, why: r.why || r.state };
        // M5: the project memory folder's 2.0.0 place is linked back, as the home folder is.
        return { ok: true, said: r.linked ? ', the old path linked to it (git lists the link: ignore it in the project\'s .gitignore or .git/info/exclude)'
            : r.linked === false ? ` - the old path could not be linked (${r.why}); Cursor and any install still naming ${row.from} do not see it until pointed at ${row.to}` : '' };
    };
    const moved = [];
    // A root a recorded move has now emptied (its launcher ran) is pruned by the data-root layer.
    const left = info.recorded.pending.filter((p) => !holds(p.from)).map((p) => dataRoot.rootOfPlace(p.cls, p.from)).filter(Boolean);
    let pending = info.recorded.pending.filter((p) => holds(p.from) && p.to === dataRoot.targetOf(p.cls, info.root));
    // A target that already holds the data was filled by its launcher's move; what sits at `from` now was
    // written after it, by a reader still on the old place (a second session's server, or Cursor's). The line
    // clears - kept, every later run would wait for a move that already ran and ask for a restart forever -
    // and the leftover is named once here; later runs see it as a plain clash (below).
    pending = pending.filter((p) =>
    {
        if (!holds(p.to)) return true;
        log(`  !! data root: ${p.from} still holds data after the move to ${p.to} - remove or merge it`);   // a warning, not a failed step
        return false;
    });
    let kept = info.recorded.kept && answer !== 'move';
    if (answer === 'keep') { kept = true; pending = []; }
    pending = pending.filter((p) =>
    {
        if (launched(p.cls)) return true;
        const r = inline(p);
        if (r.ok) { moved.push(p); left.push(dataRoot.rootOfPlace(p.cls, p.from)); log(`data root: moved ${p.from} -> ${p.to}${r.said}`); }
        else log(`data root: ${p.from} not moved yet (${r.why}) - the next run tries again`);
        return !r.ok;
    });
    const rows = stamped ? dataRoot.dataMovePlan({ projectRoot, root: info.root, prior: info.prior, engines, memory: memoryProject }) : [];
    const open = rows.filter((r) => !pending.some((p) => same(p, r)));
    if (answer === 'move')
    {
        for (const row of open)
        {
            if (row.conflict) { note(`data root: ${row.from} not moved - ${row.to} already holds data; move or remove one of them, then run /alfred-code:update --data-move move`); continue; }
            if (launched(row.cls))
            {
                pending.push({ cls: row.cls, from: row.from, to: row.to });
                log(`data root: ${row.from} -> ${row.to} moves at the ${server(row.cls)} server's next start, once nothing holds it - restart the session`);
                continue;
            }
            const r = inline(row);
            if (r.ok) { moved.push(row); log(`data root: moved ${row.from} -> ${row.to}${r.said}`); }
            else { pending.push({ cls: row.cls, from: row.from, to: row.to }); log(`data root: ${row.from} not moved yet (${r.why}) - the next run tries again`); }
        }
    }
    else if (open.length && !kept)
    {
        // A clash is no offer: a move would overwrite nothing, so it never runs until one side is cleared.
        for (const row of open.filter((r) => r.conflict))
            if (!info.recorded.pending.some((p) => same(p, row))) log(`data root: ${row.from} still holds data beside ${row.to} - remove or merge it; nothing moved`);
        const offered = open.filter((r) => !r.conflict);
        if (offered.length) log(`data root: ${offered.map((r) => r.from).join(', ')} sit outside ${info.root} - /alfred-code:update offers the move to ${info.root} (--data-move move|keep); nothing moved`);
    }
    return { pending, kept, moved, rows, left: [...new Set(left.filter((r) => r && r !== info.root))] };
}

// The memory database the settings (and a copy-route registration) name: where the file LIVES now. A
// project database the memory launcher still owes a move names its new place - the launcher moves it there
// and every reader falls back until then (data-root.js liveMemoryDb); otherwise the place it sits, so a
// server with no launcher never opens a second, empty database beside it. The registered spelling is kept
// when it names that same file.
function liveMemoryPath({ level, projectRoot, home, liveOf, owed, registered })
{
    let live = level.dbPath;
    if (level.level === 'project' && !owed)
    {
        const found = path.join(projectRoot, ...liveOf('memory').split('/'), 'memory.db');
        if (fs.existsSync(found)) live = found;
    }
    else if (level.level === 'global' || level.level === 'scoped') live = dataRoot.liveMemoryDb(level.dbPath, { home, projectRoot });
    // The same file under another spelling of its directory (macOS /var -> /private/var) keeps the registered
    // one - never a 2.0.0 folder name reaching the moved database through its link, which is re-spelled.
    const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    const sameFolder = registered && path.basename(path.dirname(registered)) === path.basename(path.dirname(live));
    return sameFolder && fs.existsSync(registered) && real(registered) === real(live) ? registered : live;
}

// The docs root this run leaves in effect, and the one-time move out of the old default
// (docs.LEGACY_DOCS_ROOT, docs.docsMovePlan). Never silent: with no --docs-move answer the old root stays in effect - written
// back as the stack's own value when the key is absent, so the hooks keep reading where the docs are -
// and the offer is named for /alfred-code:update to ask. `ctx.docsPath` is the settings write
// (applyEnv 3b), `ctx.docsRoot` the root the rules are stamped with.
function docsRootStep(ctx)
{
    const { args, log, note } = ctx;
    const managed = ctx.ledger && ctx.ledger.env ? Object.assign({}, ...Object.values(ctx.ledger.env)) : null;
    const stamped = (Boolean(ctx.stampFile) && fs.existsSync(ctx.stampFile)) || Boolean(ctx.legacyUnstamped);
    const views = docs.docsMoveViews({ claudeDir: ctx.claudeDir, scope: args.scope });
    const to = `${ctx.dataInfo.root}/docs`;
    const plan = docs.docsMovePlan({ projectRoot: ctx.projectRoot, ...views, ledger: managed, stamped, to, kept: ctx.dataInfo.recorded.kept });
    ctx.docsPath = null;
    ctx.docsVersioningCarry = null;
    if (plan.state !== 'offer' && args.dataMove) log(`docs move: nothing to offer (${plan.why}) - the docs stay where they are`);
    if (plan.state === 'repoint')
    {
        ctx.docsPath = { value: plan.to, own: 'stack', why: 'the old root held nothing' };
        log(`docs root: ${plan.from} holds nothing - re-pointed to ${plan.to}`);
        selection.respellDocsRoot({ projectRoot: ctx.projectRoot, from: plan.from, to: plan.to, log, note });
    }
    // A first install lays the docs under the data root it was given - unless a docs root is already set.
    else if (!stamped && plan.state === 'none' && !['ALFRED_CODE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_DOCS_PATH'].some((k) => views.env[k] || (views.personal && views.personal[k]))) // legacy-name
        ctx.docsPath = { value: to, own: 'stack', why: 'the data root' };
    else if (plan.state === 'offer')
    {
        const held = { value: plan.from, own: 'stack', why: 'its docs are still there' };
        const count = plan.tracked.length + plan.untracked.length;
        if (args.dataMove === 'keep')
        {
            ctx.docsPath = { value: plan.from, own: plan.from === docs.LEGACY_DOCS_ROOT ? 'user' : 'stack', why: '--data-move keep' };
            log(`docs root: kept at ${plan.from} - ALFRED_CODE_DOCS_PATH is yours from here on; no update offers the move again`);
        }
        else if (args.dataMove === 'move' && plan.conflicts.length)
        {
            ctx.docsPath = held;
            note(`docs root: not moved - ${plan.conflicts.length} file(s) already at ${plan.to}: ${plan.conflicts.slice(0, 5).join(', ')} - move or remove them, then run /alfred-code:update again`);
        }
        else if (args.dataMove === 'move')
        {
            const moved = docs.moveDocsRoot({ projectRoot: ctx.projectRoot, plan });
            if (moved.ok)
            {
                ctx.docsPath = { value: plan.to, own: 'stack', why: '--data-move move' };
                selection.respellDocsRoot({ projectRoot: ctx.projectRoot, from: plan.from, to: plan.to, log, note });
                // A move keeps what git saw: an old root git ignored, with nothing tracked, stays out of git
                // as a `local` root (its own `.gitignore` of `*`) - unless this run names a versioning itself.
                if (plan.ignored && !args.docsVersioning) ctx.docsVersioningCarry = 'local';
                log(`docs root: moved ${plan.from} -> ${plan.to} (${moved.moved} file(s), ${moved.gitMoved} through git mv${moved.gitMoved ? ' - staged as renames, commit them' : ''})`
                    + ' - the rule is re-stamped; a session started before this still holds the old root in its loaded rule, so restart it');
            }
            else
            {
                ctx.docsPath = held;
                note(`docs root: not moved - ${moved.error}; every file is back under ${plan.from}`);
            }
        }
        else
        {
            ctx.docsPath = held;
            log(`docs root: ${plan.from}${plan.from === docs.LEGACY_DOCS_ROOT ? ' is the old default and' : ''} holds ${count} file(s) - /alfred-code:update offers the move to ${plan.to} (--data-move move|keep); nothing moved`);
        }
    }
    // A settings file that cannot be read says nothing about the root, so the rule keeps the root it was
    // stamped with rather than falling to the default the unreadable file would read as.
    const unreadable = plan.state === 'none' && /cannot be read$/.test(plan.why);
    ctx.docsRoot = ctx.docsPath ? ctx.docsPath.value
        : (unreadable && copy.stampedDocsRoot(ctx.projectRoot)) || copy.resolveDocsRoot(ctx.projectRoot, args.scope);
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
// A copy git tracks is the project's own commit, not a stale stack copy - this repo keeps its
// plugin-authoring skill in .claude/skills after the catalog retired it. Outside a work tree, or with
// git missing, nothing counts as tracked.
function gitTracks(ctx, target)
{
    const r = ctx.rt.spawnCommand('git', ['ls-files', '-z', '--', target], { cwd: path.dirname(target), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 && String(r.stdout || '').length > 0;
}

function pruneCopies(ctx, dir, names, label, why, { keepTracked = false, keep = null } = {})
{
    for (const name of names)
    {
        const target = path.join(dir, name);
        if (!fs.existsSync(target)) continue;
        if (keep && keep(name))
        {
            ctx.log(`  ${label} kept (${why}, but the project's own - the stamp does not record it): ${name}`);
            continue;
        }
        if (keepTracked && gitTracks(ctx, target))
        {
            ctx.log(`  ${label} kept (${why}, tracked in git): ${name}`);
            continue;
        }
        fs.rmSync(target, { recursive: true, force: true });
        ctx.log(`  ${label} pruned (${why}): ${name}`);
    }
}

// M3: a skill folder already in `.claude/skills` the stack may treat as its own copy (`claims`) - the stamp
// records it (a library hash, or a pick), only the stack uses the name (manifest.js stackOwnName), or its
// SKILL.md carries the stack's own heading (the shipped frontmatter `name` and `description`: a copy whose body,
// references or tool spellings moved on is still the stack's; a project's own skill has words of its own). Any
// other folder under a catalog name is the project's (`foreign`): never overwritten, pruned, dropped or read back
// as a pick - named, and left out of the stamp. Read once per run, from the stamp as the run found it.
function skillTest({ skillsDir, stampFile, manifest, sourceDir })
{
    const lib = stampLayer.readLibrary(stampFile) || {};
    const picked = stampLayer.readPicked(stampFile) || { skills: [] };
    const recorded = new Set([...Object.keys(lib.skills || {}), ...picked.skills.map((e) => e.split('@')[0])]);
    const names = stackNames(manifest);
    const heading = (file) =>
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
        const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        const key = (k) => ((front && new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(front[1])) || [])[1];
        return front ? `${key('name')}\n${key('description')}` : null;
    };
    const stackText = (name) =>
    {
        const ours = heading(path.join(sourceDir, 'stack', 'skills', name, 'SKILL.md'));
        return Boolean(ours) && heading(path.join(skillsDir, name, 'SKILL.md')) === ours;
    };
    const claims = (name) => recorded.has(name) || stackOwnName(names, 'skills', name) || stackText(name);
    const foreign = (name) => fs.existsSync(path.join(skillsDir, name)) && !claims(name);
    return { claims, foreign };
}
const skillTestOf = (ctx) => (ctx.skillTest ||= skillTest({ skillsDir: ctx.skillsDir, stampFile: ctx.stampFile, manifest: ctx.manifest, sourceDir: ctx.source.dir }));
const skillClaim = (ctx) => skillTestOf(ctx).claims;
const foreignSkill = (ctx, name) => skillTestOf(ctx).foreign(name);
const foreignLine = (name) => `  !! skill kept: ${name} - a project skill of that name the stamp does not record, so it is yours; the stack's ${name} is not installed here - rename or remove yours, then /alfred-code:configure adds it`;
function withoutForeign(picked, foreign)
{
    if (!foreign || !foreign.size) return picked;
    return { ...picked, skills: (picked.skills || []).filter((e) => !foreign.has(String(e).split('@')[0])) };
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

    // On the plugin route every skill travels by copy and every seat rides the core (2.1.0). A seat's
    // leftover copy - a 2.0.x library seat, or the copy route's - lists BESIDE the core's own under
    // another name, so it goes BEFORE the enable. What a release retired goes on either route.
    const skillNames = ctx.lists.skills.map((e) => e.split('|').pop());
    const agentsDir = path.join(ctx.claudeDir, 'agents');
    pruneCopies(ctx, ctx.skillsDir, ctx.manifest.retired.skills, 'skill', 'retired upstream', { keepTracked: true });
    pruneCopies(ctx, agentsDir, ctx.manifest.retired.agents, 'agent', 'retired upstream', { keepTracked: true });
    if (ctx.routes.skills)
    {
        // A library item this run did not pick is switched off, and its absence is how; a seat the core
        // carries is pruned as a copy - unless the project edited it since the stack wrote it (its hash
        // no longer the stamp's): kept, said, and its recorded hash carried, so library-check reports it
        // as edited and no later run deletes it either.
        const core = placement().plugins[CORE];
        const stamped = stampLayer.readLibrary(ctx.stampFile);
        const unpicked = (names, picked) => names.filter((n) => !picked.includes(n));
        const skills = unpicked(ctx.manifest.skills.map((e) => e.split('|').pop()), closure.extraSkills);
        const agents = unpicked(ctx.manifest.agents.map((f) => f.replace(/\.md$/, '')), closure.extraAgents);
        const edited = (n) =>
        {
            const was = stamped && stamped.agents && stamped.agents[n];
            const now = was && library.hashItem(path.join(agentsDir, `${n}.md`));
            return Boolean(now && now !== was);
        };
        // I4: a copy whose model / effort differ from the stack's is the user's tuning, whatever its hash says -
        // 2.0.0's --keep-pins re-hashed a copy after restoring its pins, so a tuned copy reads as unedited. No
        // setting overrides a plugin seat's own frontmatter (code.claude.com/docs/en/sub-agents, 'Choose a
        // model': the dispatch's model, then the definition's, then CLAUDE_CODE_SUBAGENT_MODEL for all), so the
        // tuning survives only as the project copy, dispatched by its bare name.
        const tuning = (n) =>
        {
            const pairs = (file) => pinsLayer.KEYS.map((k) => [k, pinsLayer.readPin(file, k)]).filter(([, v]) => v);
            const mine = pairs(path.join(agentsDir, `${n}.md`));
            const stack = Object.fromEntries(pairs(path.join(ctx.source.dir, 'stack', 'agents', `${n}.md`)));
            if (!mine.length || mine.every(([k, v]) => stack[k] === v)) return null;
            const say = (list) => list.map(([k, v]) => `${k}=${v}`).join(', ');
            return `its model/effort (${say(mine)}) differ from the stack's (${say(pinsLayer.KEYS.map((k) => [k, stack[k]]).filter(([, v]) => v))})`;
        };
        const keptSeats = agents.filter((n) => core.agents.includes(n) && (edited(n) || tuning(n)));
        for (const n of keptSeats)
        {
            const why = [edited(n) ? 'edited in the project since the stack copied it' : '', tuning(n) || ''].filter(Boolean).join(' - ');
            ctx.log(`  agent kept: ${n}.md - ${why}, so it is yours; dispatched as '${n}' (the project copy) - the capabilities rule names it that way, so a flow runs it and never ${CORE}:${n}, which still lists beside it; delete the copy to use the plugin's seat`);
        }
        const foreign = (n) => foreignSkill(ctx, n);
        pruneCopies(ctx, ctx.skillsDir, skills.filter((n) => core.skills.includes(n)), 'skill', 'now carried by a plugin', { keep: foreign });
        pruneCopies(ctx, ctx.skillsDir, skills.filter((n) => !core.skills.includes(n)), 'skill', 'library item not picked', { keep: foreign });
        pruneCopies(ctx, agentsDir, agents.filter((n) => core.agents.includes(n) && !keptSeats.includes(n)).map((n) => `${n}.md`), 'agent', 'now carried by a plugin');
        pruneCopies(ctx, agentsDir, agents.filter((n) => !core.agents.includes(n)).map((n) => `${n}.md`), 'agent', 'library item not picked');
        ctx.library = library.copyLibrary({
            sourceDir: ctx.source.dir, skillsDir: ctx.skillsDir, agentsDir,
            skills: closure.extraSkills, agents: closure.extraAgents,
            stamped, claims: (kind, name) => kind !== 'skills' || skillClaim(ctx)(name), log: ctx.log, note: ctx.note,
        });
        for (const n of ctx.library.foreign) ctx.foreignSkills.add(n);
        for (const n of keptSeats) ctx.library.agents[n] = stamped.agents[n];
        return;
    }

    // C17: each copy is written as the text it holds on this route (copyRender) and only when that
    // differs, so a re-run over unchanged skills and seats rewrites nothing.
    fs.mkdirSync(ctx.skillsDir, { recursive: true });
    for (const name of skillNames)
    {
        const src = path.join(ctx.source.dir, 'stack', 'skills', name);
        if (!fs.existsSync(src)) { ctx.note(`skill '${name}' not found in the stack source`); continue; }
        if (foreignSkill(ctx, name)) { ctx.log(foreignLine(name)); ctx.foreignSkills.add(name); continue; }
        if (copy.syncTree({ src, dest: path.join(ctx.skillsDir, name), render: copyRender(ctx, 'skill') })) ctx.log(`skill [${ctx.args.scope}]: ${name}`);
        else ctx.log(`  skill current: ${name}`);
    }

    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'agents'), label: 'agent',
        destDir: agentsDir, files: ctx.lists.agents, render: copyRender(ctx, 'agent'), log: ctx.log, note: ctx.note,
    });
}

// C17 / B seam: what a copy-route copy holds - the shipped text with the MCP tool names this run
// registers bare re-spelled to them (the rules render the same way), and on the FULL copy route a
// seat's `alfred-code:<skill>` preloads bare, since no core plugin serves that spelling there. Null
// when nothing changes - every plugin route.
function copyRender(ctx, kind)
{
    const bare = ctx.routes.skills ? [] : bareNames(ctx);
    const preloads = kind === 'agent' && !mcp.corePluginOn(ctx.routes);
    if (!bare.length && !preloads) return null;
    return (text) =>
    {
        const out = mcp.respellToolNames(text, bare);
        return preloads ? copy.respellPreloads(out, CORE) : out;
    };
}

function installPlugins(ctx)
{
    if (!ctx.hasClaude) { if (!ctx.claudeBroken) ctx.note('the claude CLI is not on PATH - the plugin and MCP layers were skipped'); return; }
    // One row per name@marketplace: the set mixes official picks with stack entries, and the official
    // catalog ships names the stack uses too.
    const readRaw = () => ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.cliEnv });
    const readListing = () => plugins.parsePluginList(readRaw(), ctx.projectRoot, { byMarketplace: true });
    const raw = readRaw();
    const listing = plugins.parsePluginList(raw, ctx.projectRoot, { byMarketplace: true });
    const rows = plugins.parsePluginList(raw, ctx.projectRoot, { everyScope: true });
    const blind = !listingRead(raw);
    if (ctx.routes.mcps) ctx.desktopHeld = new Set(rows.filter((r) => r.marketplace === ctx.market && DESKTOP_OS[r.name]).map((r) => r.name));
    const engines = playwrightMoves(ctx, { blind, rows });
    // R107 / R111: what the copy route registers in .mcp.json after this layer must never also load as
    // a plugin. On the full copy route the stack's own rows go off (the core, its 1.x ids and the locked
    // three) - after the retired carriers that depend on the old core are pruned (M3), and before the
    // MCP layer registers anything; wherever the copy route registers a playwright engine, that engine's
    // row goes. Which rows are on is the settings file's word at each scope before the listing's (S22,
    // S28). M4 (R132): a listing that could not be read is no list of rows - one loud line names what
    // could not be switched off, and nothing is acted on.
    const isOn = engineOn(ctx);
    const copyRoute = !plugins.corePluginOn(ctx.routes);
    const stand = { rows, market: ctx.market, scope: ctx.cliScope, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note };
    if (blind && (copyRoute || !ctx.routes.mcps)) ctx.note(blindStandDown(ctx, copyRoute));
    // C11: at user scope on the full copy route an engine's user-scope row is switched off here only, and
    // joins the core's in the stamp's stood-down record.
    // The 2.0.0 rename: on the full copy route an old id is stood down with its successor's name - the
    // core is off there, so no swap runs (plugins.migrateRenamed); on a plugin route it is swapped below.
    const legacyEngines = copyRoute ? ctx.legacyMcps.filter((n) => n.startsWith('playwright-')) : [];
    const legacyLocked = copyRoute ? ctx.legacyMcps.filter((n) => !n.startsWith('playwright-')) : [];
    const engineOff = !ctx.routes.mcps && !blind ? plugins.engineStandDown({ ...stand, engines: pwEngines(ctx), hereOnly: copyRoute, legacy: legacyEngines }).off : [];
    const standDown = () => { if (copyRoute && !blind) ctx.standDown.now = [...engineOff, ...plugins.copyRouteStandDown({ ...stand, locked: [...mcp.LOCKED, ...legacyLocked] })]; };
    let set = plugins.pluginSet({
        routes: ctx.routes, thirdParty: ctx.lists.plugins,
        stackEntries: ctx.stackEntries || [], coreDeps: CORE_DEP_PLUGINS, locked: mcp.LOCKED, market: ctx.market,
    });
    const marketplaces = plugins.extraMarketplaces(ctx.manifest.rows.plugins, set);
    // C12: an install moved off local scope takes its plugin rows along - installed at the new scope, the
    // local row uninstalled. What moved is installed this run (`fresh`); the listing reads each at its
    // new scope from here on.
    const relocated = ctx.leavingLocal && !blind
        ? plugins.moveLocalRows({
            plugins: set, rows, scope: ctx.cliScope, engines: pwEngines(ctx).map((e) => `browser-${e}@${ctx.market}`),
            isOn, cli: ctx.cli, log: ctx.log, note: ctx.note,
        })
        : { moved: [], dropped: [] };
    for (const row of listing)
        if ([...relocated.moved, ...relocated.dropped].includes(`${row.name}@${row.marketplace}`)) row.scope = ctx.cliScope;
    // A-I4: said once, after the plugin pass on either action. Marked `!!`, like every line a user acts
    // on: a 1.x install's first 2.0.0 run is the 1.x update body's, which shows only its own grep and
    // the `!!` lines update-preflight --log forwards.
    const hudLine = () =>
    {
        if (plugins.hudStatusLineMissing({ plugins: set, listing, settingsFile: path.join(ctx.configDir, 'settings.json') }))
            ctx.log('  !! claude-hud has no status line yet - run /alfred-code:init to set it up');
    };
    // The per-stack entries retired in 1.3.0 come from the seed's own file, never the twins' lists:
    // only this route copies their picks before they go. The ones still installed after this run are
    // what the settings writer keeps a seat's old deny spelling for; an unreadable listing says
    // nothing, so it keeps them all.
    const carriers = readRetiredEntries(ctx.source.dir).map((e) => e.name);
    // The plugins a release cut (meta/retired-plugins.json) go the same way, each by its full spec and
    // with its add-back line - 2.0.0's five MCP entries among them.
    const retiredRows = readRetiredPlugins(ctx.source.dir);
    // A retired third-party pick goes on the first update past its retirement only (plugins.retirementDue):
    // after it, a row under that spec is the user's own, put back with the add-back line.
    const lastVersion = stampLayer.readVersion(ctx.stampFile);
    const retired = [...new Set([...ctx.manifest.retired.plugins, ...retiredRows.map((r) => r.name), ...carriers])]
        .filter((name) => plugins.retirementDue({ name, rows: retiredRows, lastVersion, compare: compareVersions }));
    // A 1.x install is moved across first - the new core installed, then the old ids removed - before
    // the core is installed or updated below (plugins.migrateLegacy).
    const moved = plugins.corePluginOn(ctx.routes)
        ? plugins.migrateLegacy({ rows, scope: ctx.cliScope, retired, retiredRows, carriers, cli: ctx.cli, log: ctx.log, note: ctx.note })
        : { fresh: [], gone: [], removed: [], failed: null, ran: false };
    // A failed move leaves the old core carrying the guards; a second install of the new one beside it
    // would run both, and leave nothing for the next update to move.
    if (moved.failed) set = set.filter((spec) => spec !== moved.failed);
    // The 2.0.0 rename (plugins.migrateRenamed): each old MCP id at this run's scope swapped for its
    // successor, one at another scope stood down here only, on either action - a setup over an older
    // install would otherwise run both. A
    // listing the run could not read shows no old row: the ids a pre-rename stamp implies are named.
    const renamedMove = plugins.corePluginOn(ctx.routes) && !blind
        ? plugins.migrateRenamed({ rows, renamed: ctx.manifest.renamed.mcps, set, market: ctx.market, scope: ctx.cliScope, engines, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note })
        : { fresh: [], gone: [] };
    if (blind && predatesRename(ctx))
        ctx.log(`  !! the plugin listing could not be read, and this install predates the 2.0.0 rename - an old id still installed loads beside its successor; check /plugin, or: ${ctx.legacyMcps.map((n) => `claude plugin uninstall ${n}@${ctx.market} --scope ${ctx.cliScope}`).join('; ')}`);
    const fresh = [...moved.fresh, ...relocated.moved, ...renamedMove.fresh];
    // The 1.x core counts as a live home of its seat denies while any scope still carries its old id.
    const oldCore = rows.some((r) => r.name === LEGACY.core && !moved.removed.includes(r)) ? [LEGACY.core] : [];
    const installed = (gone = []) => (listing.length ? carriers.filter((n) => plugins.fieldOf(listing, n, 'version') && !gone.includes(n)).concat(oldCore) : null);
    ctx.liveCarriers = installed(moved.gone);
    // The switch back (R116, M9): what the full copy route switched off comes back on - the record only.
    const back = copyRoute ? { restored: [], owed: null }
        : plugins.restoreStoodDown({ record: ctx.standDown.prior, plugins: set, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note });
    ctx.standDown.owed = back.owed;
    if (ctx.args.action === 'update')
    {
        // A move that ran (or retried) pruned the retired entries already; a failed one removes nothing.
        const moving = moved.ran || moved.failed;
        const gone = moving ? moved.gone : plugins.prunedRetired({ rows, retired, retiredRows, carriers, market: ctx.market, scope: ctx.cliScope, cli: ctx.cli, log: ctx.log, note: ctx.note });
        ctx.liveCarriers = installed(gone);
        standDown();
        plugins.updatePlugins({
            plugins: set, scope: ctx.cliScope, marketplaces, before: listing, fresh, restored: back.restored, refreshed: ctx.refreshed, engines, cli: ctx.cli, log: ctx.log, note: ctx.note,
            after: readListing,
        });
        hudLine();
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
    standDown();
    plugins.installPlugins({
        plugins: set, scope: ctx.cliScope, marketplaces, before: listing, fresh, refreshed: ctx.refreshed, engines, cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
    hudLine();
}

// The desktop servers' prerequisites (stack/mcp/desktop-launch.js prereqNotes), said ONCE: on the run
// that brings a server into this project - its plugin row, or on the copy route its registration, was not
// there before - never on every update after it. No claude CLI installs nothing, so nothing is said.
function desktopNotes(ctx)
{
    if (!ctx.desktopHeld) return;
    const uvx = Boolean(ctx.rt.which('uvx'));
    for (const entry of ctx.lists.mcps)
    {
        const name = String(entry).split('|')[0];
        if (!DESKTOP_OS[name] || ctx.desktopHeld.has(name)) continue;
        for (const line of prereqNotes(name, { uvx })) ctx.log(line);
    }
}

// M4 (R132): the one line for a listing the run could not read on a copy route - what would have been
// switched off, each with its command, so nothing runs beside its .mcp.json registration unsaid.
function blindStandDown(ctx, copyRoute)
{
    const at = plugins.standDownScope(ctx.cliScope);
    const cmds = [
        ...(copyRoute ? [BRAND.core, ...mcp.LOCKED].map((n) => `claude plugin disable ${n}@${ctx.market} --scope ${at}`) : []),
        ...pwEngines(ctx).map((e) => (copyRoute && at !== ctx.cliScope
            ? `claude plugin disable browser-${e}@${ctx.market} --scope ${at}`
            : `claude plugin uninstall browser-${e}@${ctx.market} --scope ${ctx.cliScope}`)),
    ];
    return `the plugin listing could not be read, so no stack plugin was switched off before the copy route registers its servers - any still enabled runs beside its registration; check /plugin, or: ${cmds.join('; ')}`;
}

// M9 (R132): the stamp's `stood-down` record after this run. On the full copy route: the earlier record,
// less an entry the settings file there names on again (the user turned it back on), plus what this run
// switched off. On a plugin route: what the switch back still owes - or the whole record when it never
// ran (no claude CLI).
function stoodDownRecord(ctx)
{
    const { prior, now, owed } = ctx.standDown;
    if (plugins.corePluginOn(ctx.routes)) return owed || prior;
    const isOn = engineOn(ctx);
    const kept = prior.filter((e) => isOn(e.spec, e.scope) !== true);
    const key = (e) => `${e.scope}:${e.spec}`;
    return [...kept, ...now.filter((e) => !kept.some((k) => key(k) === key(e)))];
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
    const specOf = (e) => `browser-${e}@${ctx.market}`;
    // A pre-rename stamp's engines were installed as playwright-<engine>: none of them is a browser-<engine>
    // to update in place or to uninstall - the rename swap (plugins.migrateRenamed) owns those rows.
    const prior = ctx.pw.prior.legacy ? [] : (ctx.pw.prior.browsers || []);
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
            ? `browser: the plugin listing could not be read - the stamp or the settings name ${known.join(',')} as installed (updated in place); the rest install as new`
            : 'browser: the plugin listing could not be read and neither the stamp nor the settings name an installed engine - each installs as new');
    const { enabled, off, apply } = ctx.pw;
    ctx.log(apply
        ? `browser: installs ${kept.join(',')}; enabled as picked: ${enabled.join(',') || 'none'} (/plugin toggles them)`
        : `browser: installs ${kept.join(',')}; no enable answer given - one already installed keeps its on/off, one installed now arrives on${off.length ? `, except ${off.join(',')} (last left off)` : ''} (/plugin toggles them)`);
    return {
        specs: kept.map(specOf), present: known.map(specOf), presentScope, off: off.map(specOf),
        on: apply ? enabled.map(specOf) : null, isOn, uninstalled,
    };
}

// An install made before the 2.0.0 rename: its stamp spells the browser lines the old way, or names an
// old locked server among what it carried.
function predatesRename(ctx)
{
    if (ctx.pw.prior.legacy) return true;
    let text = '';
    try { text = fs.readFileSync(ctx.stampFile, 'utf8'); } catch { return false; }
    const carried = ((/^installed-always-mcps:(.*)$/m.exec(text) || [])[1] || '').split(',').map((n) => n.trim());
    return ctx.legacyMcps.some((n) => carried.includes(n));
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

// The registrations one scope holds, read once per run (mcp.registrationsAt).
function registrationsAt(ctx, scope)
{
    ctx.mcpRegs[scope] ||= mcp.registrationsAt({ scope, mcpFile: ctx.mcpFile, accountFile: ctx.accountFile, projectRoot: ctx.projectRoot });
    return ctx.mcpRegs[scope];
}

// A-M2 / A-M3: 'stack' when `name` at `scope` is a registration of the stack's own shape (the package it
// launches, or the url it calls - mcp.identityOf), 'absent' when the scope holds none under the name (no
// call to make), 'foreign' when it is another server the user registered under the same name - kept and
// named once per run - and 'unreadable' when the file cannot be read, which removes nothing, said once.
// M-F5-1: `live` says whether THIS run currently wants `name` active - a locked server, or a playwright
// engine this project keeps. Only then is a foreign collision under it something the user must act on, so
// only then does the kept line carry `!!`; a name nothing collides with in practice (a dropped engine, a
// name this version never registers) still logs the kept line, but plain.
function registrationOf(ctx, name, scope, live)
{
    const regs = registrationsAt(ctx, scope);
    const once = (key, line) => { if (!ctx.mcpSaid.has(key)) ctx.log(line); ctx.mcpSaid.add(key); };
    if (regs.state === 'unreadable')
    {
        once(`unreadable:${scope}`, `  !! mcp: ${regs.file} could not be read - no ${scope}-scope registration was removed; fix the file and re-run`);
        return 'unreadable';
    }
    const entry = regs.servers[name];
    if (!entry) return 'absent';
    ctx.mcpIdentities ||= mcp.stackIdentities({
        catalog: ctx.manifest.catalogs.mcps, remotes: ctx.remotes, tokens: ctx.tokens, retiredRows: readRetiredPlugins(ctx.source.dir), renamed: ctx.manifest.renamed.mcps,
    });
    if ((ctx.mcpIdentities[name] || new Set()).has(mcp.identityOf(entry))) return 'stack';
    once(`${scope}:${name}`, `  ${live ? '!! ' : ''}mcp ${name}: the ${scope}-scope registration is not the stack's (another server under the same name) - kept; if it should go: claude mcp remove ${name} -s ${scope}`);
    ctx.mcpForeign.set(name, scope);
    return 'foreign';
}

// A registration at local, project or user scope outranks every plugin server (mcp.shadowingRegistrations):
// one calling a carried plugin's url takes its place, so the stack's plugin-spelled tool names resolve
// nothing, and one under a carried plugin's name starts a second server. The run prunes only its own
// scope, so what is left is the user's own or serves other projects - each named once with its remove
// command. A same-named one registrationOf already named as foreign is not said twice.
function warnShadowed(ctx, carried)
{
    const scopes = {};
    for (const scope of ['local', 'project', 'user'])
        scopes[scope] = mcp.registrationsAt({ scope, mcpFile: ctx.mcpFile, accountFile: ctx.accountFile, projectRoot: ctx.projectRoot }).servers;
    for (const row of mcp.shadowingRegistrations({ plugins: carried, scopes }))
    {
        if (row.kind === 'beside' && ctx.mcpForeign.get(row.name) === row.scope) continue;
        const remove = `claude mcp remove ${row.name} -s ${row.scope}`;
        ctx.log(row.kind === 'replaces'
            ? `  !! mcp ${row.name} (${row.scope} scope) calls the url of the ${row.plugin} plugin, so Claude Code connects to it instead and the stack's mcp__plugin_${row.plugin}_${row.plugin}__ tools never load - if nothing else needs it: ${remove}`
            : `  mcp ${row.name} (${row.scope} scope) starts beside the ${row.plugin} plugin's own server - two ${row.plugin} servers in every session here; if nothing else needs it: ${remove}`);
    }
}

function installMcps(ctx)
{
    if (!ctx.hasClaude) return;
    const retired = mcp.retiredMcps({ routes: ctx.routes, catalog: ctx.manifest.catalogs.mcps, authored: ctx.retiredMcpsDue, legacy: ctx.legacyMcps });
    const addBack = (name) => (readRetiredPlugins(ctx.source.dir).find((r) => r.name === name) || {}).addBack;
    // M-F5-1: the names this run currently wants active - the locked three (always) and a playwright
    // engine this project keeps - shared by every registrationOf call below so the `!!` marker lands only
    // where a collision is actionable.
    const liveMcpNames = new Set([...mcp.LOCKED, ...pwEngines(ctx).map((e) => `browser-${e}`)]);
    // A-M2 / A-M3: a user-scope removal of a stack name, and a retired name's at any scope, takes only a
    // registration of the stack's own shape - another under the name is the user's (a server added back
    // with the add-back line included). An absent one costs no call.
    // A name the 2.0.0 rename left behind is no name this release registers, so it goes only in the
    // stack's own shape at every scope - the user's own server under an old name is theirs.
    const mayRemove = (name, scope) => (scope !== 'user' && !ctx.retiredMcpsDue.includes(name) && !ctx.legacyMcps.includes(name)) || registrationOf(ctx, name, scope, liveMcpNames.has(name)) === 'stack';
    // R10: a .mcp.json entry this release no longer writes goes only when the ledger recorded it and
    // nobody changed it since - one it does not list, or an edited one, is the user's, kept and said
    // once. No ledger (an older stamp) or no entry: the rule above. Never applied to a server this run
    // registers again - its shape is the stack's to keep (the verify pass).
    const ledgerMcp = ctx.ledger && ctx.ledger.mcp;
    const mayPrune = (name, scope, fallback = mayRemove) =>
    {
        const entry = scope === 'project' && ledgerMcp ? registrationsAt(ctx, 'project').servers[name] : null;
        if (!entry) return fallback(name, scope);
        if (ledgerMcp[name] === stampLayer.entryHash(entry)) return true;
        if (!ctx.mcpSaid.has(`ledger:${name}`))
            ctx.log(`  mcp ${name}: kept - the .mcp.json entry is not the one the stack wrote (${Object.hasOwn(ledgerMcp, name) ? 'changed since' : 'the ledger does not list it'}), so it is yours; if it should go: claude mcp remove ${name} -s project`);
        ctx.mcpSaid.add(`ledger:${name}`);
        ctx.mcpForeign.set(name, 'project');
        return false;
    };
    const prune = (name, scope) =>
    {
        if (!ctx.cli(['mcp', 'remove', name, '-s', scope], { quiet: true, expect: MCP_ABSENT })) return;
        ctx.log(`  mcp pruned: ${name}`);
        const back = ctx.retiredMcpsDue.includes(name) && addBack(name);
        if (back) ctx.log(`    add it back: ${back.split('<scope>').join(scope)}`);
    };
    for (const name of retired)
        if (mayPrune(name, ctx.cliScope)) prune(name, ctx.cliScope);
    // F7 (R22g): the user-scope FULL copy route registers in THIS project's .mcp.json (C10), which the
    // loop above never reaches at user scope - so a user-scope run registering anywhere else (the plugin
    // route, or the MCP copy route with the core on) prunes the stack's own registrations there. Only a
    // name the file holds costs a call, and only the stack's own shape goes (A-M2's rule, not the project
    // scope's by-name one): the user's own server under a stack name is kept, named once with its remove
    // command, and keeps its approval.
    if (ctx.cliScope === 'user' && mcp.registrationScope(ctx.routes, ctx.cliScope) !== 'project')
    {
        // I-F7-1: never a bare `playwright` - no user-scope run writes one there, and its identity is the
        // package name only, so one in the file is the user's own (often a committed team file).
        const held = registrationsAt(ctx, 'project');
        const names = [...new Set([...ctx.retiredMcpsDue, ...ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]), ...mcp.PW_SERVERS, ...ctx.legacyMcps])]
            .filter((name) => name !== 'playwright');
        // ... and it keeps its approval, like any server kept as the user's own.
        if (held.servers.playwright) ctx.mcpForeign.set('playwright', 'project');
        // An unreadable file is said once (registrationOf's line) and nothing in it is removed.
        if (held.state === 'unreadable') registrationOf(ctx, names[0], 'project', false);
        for (const name of names)
            if (held.servers[name] && mayPrune(name, 'project', () => registrationOf(ctx, name, 'project', liveMcpNames.has(name)) === 'stack')) prune(name, 'project');
    }

    // Whatever still sits ABOVE a plugin this run carries once the prunes are done (read fresh - they
    // changed the files): named, never removed here.
    if (mcp.corePluginOn(ctx.routes))
        warnShadowed(ctx, ctx.routes.mcps ? [...mcp.LOCKED, ...pwEngines(ctx).map((e) => `browser-${e}`)] : mcp.LOCKED);

    if (ctx.routes.mcps)
    {
        ctx.log('mcp: carried by the plugins (navigation, documentation, memory, and the picks) - nothing registered here');
        return;
    }
    const scope = mcp.registrationScope(ctx.routes, ctx.cliScope);
    // R124 (l): at local and user scope an engine left off is not registered - one an earlier run
    // registered goes with the dropped engines.
    const unregistered = ctx.pw.mcpjson.unregistered;
    // C10's user-scope full copy route registers in this project's .mcp.json, where the retired pass above
    // (at user scope) never reaches: an old name an earlier run put there goes with the drops.
    const dropped = [...new Set(mcp.playwrightDrop({ routes: ctx.routes, browsers: pwEngines(ctx) }).concat(unregistered, scope !== ctx.cliScope ? ctx.legacyMcps : []))];
    for (const name of dropped)
    {
        // An old name the retired pass above already pruned at this very scope costs no second call.
        if (scope === ctx.cliScope && ctx.legacyMcps.includes(name)) continue;
        if (mayPrune(name, scope) && ctx.cli(['mcp', 'remove', name, '-s', scope], { quiet: true, expect: MCP_ABSENT })) ctx.log(`  mcp removed: ${name}`);
    }

    // A user-scope registration of the user's own under a stack name stays theirs: not re-registered,
    // not verified (the verify's re-register would remove it).
    const live = ctx.lists.mcps.filter((e) => !(mcp.isLocked(e.split('|')[0]) && mcp.corePluginOn(ctx.routes)))
        .filter((e) => !unregistered.includes(e.split('|')[0]))
        .filter((e) => scope !== 'user' || registrationOf(ctx, e.split('|')[0], 'user', true) !== 'foreign');
    // C10: a user-scope run on the full copy route registers in .mcp.json; what an earlier one registered
    // at user scope still reaches every project on the account, and another user-scope install there
    // still loads it until its own update - so it is named with its command, never removed here. N5: so is
    // an engine this run drops (or a 1.x single `playwright`) - the drop above removed it from .mcp.json.
    // M-F5-2: `playwright`'s identity is the package name only (mcp.identityOf) - it cannot tell the
    // stack's 1.x registration apart from the user's own `npx @playwright/mcp` under the same bare name,
    // so authorship is never claimed there; every other name (an engine suffix, or serena/context7/memory)
    // is the stack's own naming, so the authored wording stays.
    if (scope !== ctx.cliScope && ctx.cliScope === 'user')
        for (const name of [...new Set([...live.map((e) => e.split('|')[0]), ...dropped])])
            if (registrationOf(ctx, name, 'user', liveMcpNames.has(name)) === 'stack')
                ctx.log(name === 'playwright'
                    ? '  playwright is registered at user scope - if an earlier stack run added it and no other project uses it: claude mcp remove playwright -s user; if you added it yourself, keep it'
                    : `  !! mcp: ${name} still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run /alfred-code:update: claude mcp remove ${name} -s user`);
    ctx.desktopHeld = new Set(Object.keys(mcp.registrationsAt({ scope, mcpFile: ctx.mcpFile, accountFile: ctx.accountFile, projectRoot: ctx.projectRoot }).servers).filter((n) => DESKTOP_OS[n]));
    const registered = [];
    for (const entry of live)
    {
        const name = entry.split('|')[0];
        const args = entry.slice(entry.indexOf('|') + 1);
        if (ctx.args.action === 'update') { if (mayRemove(name, scope)) ctx.cli(['mcp', 'remove', name, '-s', scope], { quiet: true, expect: MCP_ABSENT }); }
        // `claude mcp get` answers from every scope, so at project scope .mcp.json itself is the answer -
        // a user-scope server of the same name is not this project's registration.
        else if (scope === 'project'
            ? Boolean(mcp.registrationsAt({ scope, mcpFile: ctx.mcpFile, projectRoot: ctx.projectRoot }).servers[name])
            : ctx.cli(['mcp', 'get', name], { quiet: true, expect: 'answer' })) { ctx.plain(`  mcp ${name} already configured - skipping`); continue; }
        ctx.log(`mcp [${scope}]: ${name}`);
        if (!ctx.cli(mcp.registerSpec({ name, args, scope, remotes: ctx.remotes, tokens: ctx.tokens }), { expect: 'reported' }))
            ctx.note(`mcp ${name} failed`);
        else registered.push(name);
    }

    // R10: what this run registers in .mcp.json is the stack's, whatever the file held before. Review
    // finding 7: at local and user scope, what it actually registered (a name it skipped as already
    // configured may be the user's) - read back from the account file by the ledger.
    if (scope === 'project') ctx.mcpWritten = live.map((e) => e.split('|')[0]);
    else ctx.mcpWrittenAt = { [scope]: registered };
    // Read the RESULT back: `claude mcp add` over an existing name exits 0 without writing.
    const expects = live.map((e) => mcp.expectShape({
        name: e.split('|')[0], args: e.slice(e.indexOf('|') + 1), remotes: ctx.remotes, tokens: ctx.tokens,
    }));
    if (scope === 'project') mcp.verifyProject({ mcpFile: ctx.mcpFile, expects, log: ctx.log });
    else ctx.mcpWrittenAt[scope].push(...mcp.verifyUser({
        expects, scope,
        // N4: at user scope only a registration the account file showed as the stack's is re-registered -
        // the re-register removes first, and one it could not read (or did not hold) may be the user's.
        owned: (name) => scope !== 'user' || registrationOf(ctx, name, 'user', liveMcpNames.has(name)) === 'stack',
        getShape: (name) => ctx.rt.capture('claude', ['mcp', 'get', name], { cwd: ctx.projectRoot, env: ctx.cliEnv }),
        reregister: (name) =>
        {
            const entry = live.find((e) => e.split('|')[0] === name);
            ctx.cli(['mcp', 'remove', name, '-s', scope], { quiet: true, expect: MCP_ABSENT });
            ctx.cli(mcp.registerSpec({ name, args: entry.slice(entry.indexOf('|') + 1), scope, remotes: ctx.remotes, tokens: ctx.tokens }), { quiet: true });
        },
        log: ctx.log, note: ctx.note,
    }).repaired);
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
        destDir: path.join(ctx.claudeDir, 'hooks'), files: hookFiles, exec: true, render: copyRender(ctx, 'hook'), log: ctx.log, note: ctx.note,
    });
    // The copies are CommonJS; a `"type": "module"` project would load them as ESM (copy.commonJsScope).
    copy.commonJsScope({ dir: path.join(ctx.claudeDir, 'hooks'), stackFiles: catalogHooks.concat(HOOK_ENGINES, HOOK_MODULES), log: ctx.log, note: ctx.note });
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
    const docsRoot = ctx.docsRoot || copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope);
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
    copy.stampDocsRoot(ctx.projectRoot, { scope: ctx.args.scope, value: docsRoot, log: ctx.log, note: ctx.note });
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
    const trusted = mcp.mcpjsonTrusted({ routes: ctx.routes, scope: mcp.registrationScope(ctx.routes, ctx.cliScope), mcps: ctx.lists.mcps, off: ctx.pw.mcpjson.off });
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
    const localSettings = path.join(ctx.claudeDir, 'settings.local.json');
    const hadLocal = fs.existsSync(localSettings);
    const written = settings.writeSettings({
        // R10: the last run's ledger, and the wirings the RELEASE writes (none on the plugin route) - a
        // hook this run did not select keeps its wiring, one the release dropped loses it.
        ledger: { prior: ctx.ledger, releaseHooks: ctx.routes.hooks ? [] : ctx.manifest.catalogs.hooks, shippedDeny: SHIPPED_DENY },
        file: settings.settingsTarget(ctx.claudeDir, ctx.args.scope),
        // A local-scope run leaves the stack's stale wiring and 1.x keys in settings.json - it removes them there.
        sharedFile: ctx.args.scope === 'local' ? path.join(ctx.claudeDir, 'settings.json') : null,
        catalog, migrations, hookSpecs: wired,
        denySpecs: SECRET_DENY, retiredDeny: RETIRED_DENY, agentDeny, agentAllow,
        retiredEntries: readRetiredEntries(ctx.source.dir).map((e) => e.name), liveEntries: ctx.liveCarriers || null,
        // On the copy route a --drop'd hook is unwired like a retired one - the writer keeps a merely
        // unselected hook's entries on purpose, so the drop has to name it.
        retiredHooks: ctx.manifest.retired.hooks.concat(ctx.routes.hooks
            ? catalogHooks
            : (ctx.args.dropApplied || []).filter((l) => l.startsWith('hook ')).map((l) => `${l.slice(5)}.js`)),
        docsVersioning: {
            value: ctx.args.docsVersioning || ctx.docsVersioningCarry || '',
            why: ctx.args.docsVersioning ? '--docs-versioning' : ctx.docsVersioningCarry ? 'the old root was kept out of git' : '',
            seed: docs.docsVersioningSeed({ projectRoot: ctx.projectRoot, docsPath: docsRoot }),
        },
        docsPath: ctx.docsPath,
        // The data root this run lays the data under: written when it differs from the file's value - a
        // root a move carried the data to, or a first install's chosen one - never over a value the run
        // refused (resolveDataRoot says so), which stays the user's to fix.
        dataPath: ctx.dataInfo.invalid ? null : { value: ctx.dataInfo.root, why: ctx.dataInfo.root !== ctx.dataInfo.current ? '--data-path' : 'the data root' },
        // R124 (m): trust exactly the .mcp.json servers this run registered and lets load; every other
        // stack name leaves the list (a plugin-carried locked server, an engine left off, anything at
        // local or user scope). A name the user added is not a stack name and stays.
        mcpNames: trusted,
        // A-M3: a .mcp.json server kept as the user's own under a retired name keeps its approval too.
        mcpOff: ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS, ctx.legacyMcps)
            .filter((n) => !trusted.includes(n)).concat(ctx.retiredMcpsDue)
            .filter((n) => ctx.mcpForeign.get(n) !== 'project'),
        mcpjsonDisable: ctx.pw.mcpjson.disable, mcpjsonEnable: ctx.pw.mcpjson.enable,
        memoryDb: ctx.level.dbPath,
        hooksOff, hooksAnswered,
        // N6: at local scope settings.json still applies beneath the local file, so what it holds is no
        // gap for a seed to fill - a local default would hide it.
        inheritedEnv: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).env : null,
        // R99: at every other scope settings.local.json applies OVER settings.json, so a stack key it
        // holds is written back there - where the read-back found it and where it takes effect.
        localFile: ctx.args.scope === 'local' ? null : path.join(ctx.claudeDir, 'settings.local.json'),
        // C5: on the hooks copy route HOOKS_OFF mirrors the committed wiring, so it lands in settings.json
        // even where the runner's local file holds a value of their own (which keeps applying to them).
        sharedKeys: !ctx.routes.hooks && ctx.args.scope !== 'local' ? ['ALFRED_CODE_HOOKS_OFF'] : [],
        // C3: at local scope an old skillOverrides key in settings.json is set under its new name here.
        inheritedOverrides: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).skillOverrides : null,
        // baseline-git's no-attribution rule, enforced by the setting; at local scope settings.json's own value stays.
        attribution: { inherited: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).attribution : null },
        // R6: isolated seats branch from this HEAD; at local scope settings.json's own value stays.
        worktreeBase: { inherited: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).worktree : null },
        renamed: ctx.manifest.renamed,
        log: ctx.log, note: ctx.note,
    });
    ctx.managedSettings = written.managed || null;
    // C8: Claude Code keeps settings.local.json out of commits only when IT creates the file
    // (code.claude.com/docs/en/settings) - one this run created, and git does not ignore, is named. F7: it
    // is the user's to act on (a machine path would be committed), so it carries the `!!` marker the 1.x
    // update body's grep and every `warn:` pass read.
    if (!hadLocal && fs.existsSync(localSettings)
        && ctx.rt.spawnCommand('git', ['check-ignore', '-q', '--', path.relative(ctx.projectRoot, localSettings)], { cwd: ctx.projectRoot, stdio: 'ignore' }).status === 1)
        ctx.log(`  !! settings.local.json: created for this machine's own values (the memory database path) - git does not ignore it here; add ${path.relative(ctx.projectRoot, localSettings).split(path.sep).join('/')} to .gitignore`);
    // M1 (R132): the account file rejects a .mcp.json server as well, and the installer never edits it -
    // an engine this run enabled that it still lists is named with its file, never left to look on.
    const accountFile = path.join(ctx.configDir, 'settings.json');
    const accountOff = readJson(accountFile).disabledMcpjsonServers;
    const enabledNow = ctx.routes.mcps ? [] : (ctx.pw.enabled || []).map((e) => `browser-${e}`).filter((n) => ctx.pw.mcpjson.enable.includes(n));
    for (const name of (Array.isArray(accountOff) ? accountOff : []).filter((n) => enabledNow.includes(n)))
        ctx.log(`browser: ${name} is still rejected by ${accountFile}'s disabledMcpjsonServers - the installer never edits the account file; take it out there to load it`);
}

function importMemory(ctx)
{
    // A project database its launcher still owes a move keeps its old folder's own .gitignore, and moves with
    // it - a file written at the new place first would make that place look taken.
    if (ctx.level.level === 'project' && !ctx.dataPlan.pending.some((p) => p.cls === 'memory'))
    {
        try { memory.ensureProjectIgnore(ctx.projectRoot, ctx.log, ctx.level.dbPath); }
        catch (err) { ctx.note(`${memory.MEMORY_DIR}/.gitignore could not be written (${err.message}) - add the folder to the repo's own .gitignore`); }
    }
    // Task 18a I1: the notes import and the switch-off belong to /alfred-code:init (`memory.js init`),
    // which asks the level first and marks the stamp `initialised:`. Until that line holds a date, no
    // run imports - not setup's install, an update, or configure's apply with a level named - or the
    // notes land in a database the user never chose and the router skips init.
    // I1 (R47): the switch-off is one of THIS run's own settings writes, so it follows the same
    // scope target as installHooksAndRules' own write - a local-scope install's `autoMemoryEnabled`
    // now lands in settings.local.json, never the shared file every teammate reads.
    const settingsFile = settings.settingsTarget(ctx.claudeDir, ctx.args.scope);
    if (!stampLayer.isInitialised(stampLayer.initialisedValue({ claudeDir: ctx.claudeDir })))
    {
        // Pilot 2 (2026-09-27): init's own switch-off hit EPERM inside the sandbox, so auto-memory stayed
        // on in every cell. With NO notes there is nothing to import and nothing the level choice could
        // change, so this run - outside the session - switches it off now, behind the same replacement
        // gate; init only reports it. Any note, or folders it cannot read, keeps the old path. uvx is part of
        // the gate like at the other two switch-off sites: the memory server launches through it and init is
        // what installs uv, so without it the replacement cannot start yet (review A, I1).
        const early = memory.importGate({ projectRoot: ctx.projectRoot, settingsFile, mcps: ctx.lists.mcps, rules: ctx.lists.rules,
            tools: { node: true, uvx: ctx.rt.which('uvx') } });
        if (!early.go && !early.already && early.reason) ctx.log(early.reason);
        if (early.already)
        {
            ctx.log("memory: Claude's own memory is already off - /alfred-code:init still asks the level");
            return;
        }
        if (early.go && memory.countNotes({ projectRoot: ctx.projectRoot, configDir: ctx.configDir, home: ctx.home }) === 0)
        {
            ctx.log("memory: no Claude memory notes for this project - nothing to import, so Claude's own memory is off from this install; /alfred-code:init still asks the level");
            memory.writeSwitchOff(settingsFile, { log: ctx.log });
            return;
        }
        ctx.log("memory: the notes import waits for /alfred-code:init, which asks the level first - Claude's own memory stays on until then");
        return;
    }
    const gate = memory.importGate({
        projectRoot: ctx.projectRoot, settingsFile,
        mcps: ctx.lists.mcps, rules: ctx.lists.rules,
        tools: { node: true, uvx: ctx.rt.which('uvx') },
    });
    const importer = path.join(ctx.source.dir, 'scripts', 'memory-import.js');
    const acct = ctx.cliEnv.CLAUDE_CONFIG_DIR ? ['--config-dir', ctx.configDir] : [];
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

// The servers this run registers under their bare names - each engine under its own
// (`playwright-<engine>`), the name its tools answer to. An engine left off at user or local scope is not
// registered (the registration is the enable there), so it keeps the plugin spelling. Empty on the plugin
// route. F7: every engine used to map to `playwright`, a name no run registers, so a copied seat kept
// the plugin spelling of the engine the run had registered bare.
const bareNames = (ctx) => mcp.bareNamedMcps({ routes: ctx.routes, mcps: ctx.lists.mcps })
    .filter((n) => !ctx.pw.mcpjson.unregistered.includes(n));

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

// --- R10 THE LEDGER ------------------------------------------------------------------------------
// What this run leaves the stamp to record as MANAGED here (stamp.js `managed-*`). The settings half
// comes from the writer; a file it did not write this run keeps the keys the last run recorded that
// still hold the value it wrote. The .mcp.json half and the copies are read off disk at the end, so they
// are what the run actually left.
function ledgerOf(ctx)
{
    const prior = ctx.ledger || {};
    // Review finding 5: a settings file this run could not read was not written either, so what the last
    // run recorded there still stands - read as {} it would drop every entry, and nothing restores them
    // once the file is fixed.
    const unreadable = (name) => { try { settings.readSettings(path.join(ctx.claudeDir, name)); return false; } catch { return true; } };
    const envNow = (name) => { const env = readJson(path.join(ctx.claudeDir, name)).env; return env && typeof env === 'object' ? env : {}; };
    const still = (name, keys) => (unreadable(name) ? { ...keys }
        : Object.fromEntries(Object.entries(keys || {}).filter(([k, h]) => Object.hasOwn(envNow(name), k) && stampLayer.valueHash(envNow(name)[k]) === h)));
    const part = ctx.managedSettings || { env: {}, deny: prior.deny || [], hooks: prior.hooks || [], settings: {} };
    const env = { ...part.env };
    for (const [name, keys] of Object.entries(prior.env || {})) if (!env[name]) env[name] = still(name, keys);
    const holderNow = (name, obj) => { const a = readJson(path.join(ctx.claudeDir, name))[obj]; return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; };
    const settingsKeys = { ...(part.settings || {}) };
    for (const [name, keys] of Object.entries(prior.settings || {}))
        if (!settingsKeys[name]) settingsKeys[name] = unreadable(name) ? { ...keys } : Object.fromEntries(Object.entries(keys).filter(([at, h]) =>
        {
            const [obj, key] = at.split('.');
            return Object.hasOwn(holderNow(name, obj), key) && stampLayer.valueHash(JSON.stringify(holderNow(name, obj)[key])) === h;
        }));
    const servers = mcp.registrationsAt({ scope: 'project', mcpFile: ctx.mcpFile, projectRoot: ctx.projectRoot }).servers;
    // Review finding 7: the copy route's local- and user-scope registrations, read back from the account
    // file - what this run registered there, or what the last run recorded, still unchanged. Nothing is
    // adopted with no record, and an account file that cannot be read keeps the record as it was.
    const mcpAt = {};
    for (const scope of ['local', 'user'])
    {
        const regs = mcp.registrationsAt({ scope, accountFile: ctx.accountFile, projectRoot: ctx.projectRoot });
        const was = (prior.mcpAt || {})[scope] || {};
        const now = regs.state === 'unreadable' ? { ...was } : mcp.managedMcp({ servers: regs.servers, prior: was, written: (ctx.mcpWrittenAt || {})[scope] || [] });
        if (Object.keys(now).length) mcpAt[scope] = now;
    }
    return {
        env, deny: part.deny, hooks: part.hooks,
        mcp: mcp.managedMcp({ servers, prior: prior.mcp || null, written: ctx.mcpWritten || [], adopt: (name, entry) => stackShaped(ctx, name, entry) }),
        mcpAt,
        files: managedFiles(ctx),
        settings: settingsKeys,
    };
}

// The fallback's evidence for a .mcp.json entry with no ledger to read: a name the stack registers (or
// retired) in the stack's own shape - the package it launches or the url it calls (mcp.identityOf).
function stackShaped(ctx, name, entry)
{
    const names = new Set([...ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]), ...mcp.PW_SERVERS, ...ctx.manifest.retired.mcps, ...ctx.legacyMcps]);
    if (!names.has(name)) return false;
    ctx.mcpIdentities ||= mcp.stackIdentities({
        catalog: ctx.manifest.catalogs.mcps, remotes: ctx.remotes, tokens: ctx.tokens, retiredRows: readRetiredPlugins(ctx.source.dir), renamed: ctx.manifest.renamed.mcps,
    });
    return (ctx.mcpIdentities[name] || new Set()).has(mcp.identityOf(entry));
}

// Every copy outside the library this run made - the engines, and on the copy routes the hooks, their
// modules, the skills and the seats - hashed as they stand now, plus a copy the last run recorded that
// is still here unchanged (a hook, skill or seat this run did not select stays on disk, and stays ours).
function managedFiles(ctx)
{
    const out = {};
    const put = (rel, at) => { const h = library.hashItem(at); if (h) out[rel] = h; };
    const hooks = ctx.routes.hooks ? HOOK_ENGINES : [...new Set(ctx.lists.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, HOOK_MODULES);
    for (const f of hooks) put(`hooks/${f}`, path.join(ctx.claudeDir, 'hooks', f));
    if (!ctx.routes.skills)
    {
        for (const n of ctx.lists.skills.map((e) => e.split('|').pop())) put(`skills/${n}`, path.join(ctx.skillsDir, n));
        for (const a of ctx.lists.agents) put(`agents/${a}`, path.join(ctx.claudeDir, 'agents', a));
    }
    // A CLAUDE.md this run seeded is the template's until init fills it in - from then on it is the project's.
    if (ctx.seededClaudeMd) put('CLAUDE.md', path.join(ctx.claudeDir, 'CLAUDE.md'));
    // No ledger to read (an older stamp): a CLAUDE.md still byte for byte the seed is the stack's.
    const claudeMd = path.join(ctx.claudeDir, 'CLAUDE.md');
    if (!(ctx.ledger && ctx.ledger.files) && !out['CLAUDE.md'] && fs.existsSync(claudeMd)
        && fs.readFileSync(claudeMd, 'utf8') === seeds.claudeMdBody({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir })) put('CLAUDE.md', claudeMd);
    for (const [rel, h] of Object.entries((ctx.ledger && ctx.ledger.files) || {}))
        if (!out[rel] && library.hashItem(ledgerPath(ctx, rel)) === h) out[rel] = h;
    return out;
}

const ledgerPath = (ctx, rel) => (rel.startsWith('skills/') ? path.join(ctx.skillsDir, rel.slice(7)) : path.join(ctx.claudeDir, ...rel.split('/')));

// R10: a copy the last run recorded that this RELEASE no longer ships at all goes - when it still holds
// what the stack wrote; an edited one is the user's and stays, said. The `retired` lists still prune by
// name for a stamp from before the ledger.
function pruneDroppedCopies(ctx)
{
    const files = (ctx.ledger && ctx.ledger.files) || {};
    if (!Object.keys(files).length) return;
    const shipped = new Set([
        ...[...new Set(ctx.manifest.catalogs.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, HOOK_MODULES).map((f) => `hooks/${f}`),
        ...ctx.manifest.catalogs.skills.map((e) => `skills/${e.split('|').pop()}`),
        ...ctx.manifest.agents.map((a) => `agents/${a}`), 'CLAUDE.md',
    ]);
    for (const [rel, h] of Object.entries(files))
    {
        if (shipped.has(rel)) continue;
        const at = ledgerPath(ctx, rel);
        const now = library.hashItem(at);
        if (!now) continue;
        if (now !== h) { ctx.log(`  ${rel}: kept - the stack copied it and this release no longer ships it, but it was changed since, so it is yours`); continue; }
        if (/^(skills|agents)\//.test(rel) && gitTracks(ctx, at)) { ctx.log(`  ${rel}: kept - the stack copied it and this release no longer ships it, but git tracks it here, so it is yours`); continue; }
        fs.rmSync(at, { recursive: true, force: true });
        ctx.log(`  ${rel} removed - the stack copied it and this release no longer ships it`);
    }
}

// THE UNINSTALL ORDER (uninstall.js holds the decisions): plugin rows, then .mcp.json and the local- and
// user-scope registrations, then the settings entries, then the copies, then the stamp - last, and only
// when nothing failed.
function runUninstall({ projectRoot, claudeDir, configDir, accountFile, env, hasClaude, claudeBroken, cli, readRaw, readMarkets, log, note, err, failures })
{
    const file = stampLayer.stampFiles({ projectRoot }).read;
    const raw = stampLayer.readStampScope(file).toLowerCase();
    const scope = raw === 'global' ? 'user' : ENUMS.scope.values.includes(raw) ? raw : 'project';
    const ledger = stampLayer.readLedger(file);
    log(`action: uninstall [scope=${scope}, account=${configDir}]`);
    // Review finding 3: a listing that did not answer is no empty list - acted on, it removes no plugin
    // row and then deletes the stamp that lists them. Refused before any change, so a retry finishes.
    const rawList = hasClaude ? readRaw() : '';
    if (hasClaude && !listingRead(rawList))
    {
        err('error: `claude plugin list --json` did not answer with a plugin listing, so the stack\'s plugin rows cannot be told apart - nothing was removed; fix what that command prints, then run uninstall again\n');
        return 1;
    }
    if (hasClaude)
    {
        const market = marketOf({ listing: plugins.parsePluginList(rawList, projectRoot, { byMarketplace: true }), marketplaces: readMarkets(), env }).key;
        const manifest = loadManifest(path.join(__dirname, '..', '..'));
        uninstallLayer.removePlugins({
            rows: plugins.parsePluginList(rawList, projectRoot, { everyScope: true }), market, scope,
            thirdParty: [...manifest.catalogs.plugins, ...CORE_DEP_PLUGINS], cli, log, note,
        });
        log(`  the marketplace registration is the account's, kept for other projects: claude plugin marketplace remove ${market} (once none uses it)`);
    }
    else if (!claudeBroken) note('the claude CLI is not on PATH - no plugin row was removed; run uninstall again where it is');
    const { removed } = mcp.removeManagedMcp({ mcpFile: path.join(projectRoot, '.mcp.json'), managed: ledger.mcp || {}, log, note });
    uninstallLayer.removeScopedMcp({
        mcpAt: ledger.mcpAt || {}, cli, log, note,
        readAt: (scope) => mcp.registrationsAt({ scope, accountFile, projectRoot }),
    });
    // M4: read before the settings pass removes ALFRED_CODE_DATA_PATH - the stamp's record first.
    const keptRoot = stampLayer.readDataLines(file).root || dataRoot.dataRootOf({ env: {}, projectDir: projectRoot }).root;
    settings.removeManagedSettings({ claudeDir, ledger, shippedDeny: SHIPPED_DENY, mcpRemoved: removed, scope, log, note });
    uninstallLayer.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), library: stampLayer.readLibrary(file) || {}, files: ledger.files || {}, log });
    const memoryOff = ['settings.json', 'settings.local.json'].some((n) => readJson(path.join(claudeDir, n)).autoMemoryEnabled === false);
    log(`  kept, yours or your data: a CLAUDE.md you filled in, the data root (the docs, the navigation index, the browser profiles - ${keptRoot}/, or a 2.0.0 .serena/ / .playwright/), the memory database${memoryOff ? '; autoMemoryEnabled: false stays - Claude\'s own memory is off until you remove that key' : ''}`);
    if (failures()) { log(`  stamp kept - ${path.basename(file)} still lists what is left; run uninstall again to finish`); return 0; }
    fs.rmSync(file, { force: true });
    log(`  stamp removed: ${path.basename(file)} - every item the ledger listed is gone, or named above as kept`);
    try { if (!fs.readdirSync(claudeDir).length) fs.rmdirSync(claudeDir); } catch { /* the project's own .claude stays */ }
    return 0;
}

// THE MEMORY MODEL, FETCHED AHEAD (live check F2). The memory service downloads its embedding model (~166MB)
// on its first start - 33s cold against Claude Code's 30s MCP connect budget, and a server that misses it is
// cached as failed, so the next session does not start it either. This run is outside any session, so on a
// machine with uvx it fetches the model once through the snapshot's own launcher (stack/hooks/memory.js warm,
// a scratch database, bounded); without uvx init installs it and its plan lists the same command.
// ALFRED_CODE_MEMORY_WARM=0 in the run's environment switches it off.
function warmMemoryModel(ctx)
{
    if (!['install', 'update'].includes(ctx.args.action)) return;
    if (!ctx.lists.mcps.some((e) => e.split('|')[0] === 'memory')) return;
    if (String((ctx.env || {}).ALFRED_CODE_MEMORY_WARM || '') === '0') return;
    const engine = path.join(ctx.source.dir, 'stack', 'hooks', 'memory.js');
    let cached = false;
    try { cached = require(engine).modelCached(ctx.home || require('node:os').homedir()); } catch { cached = false; }
    if (cached) return;
    if (!ctx.rt.which('uvx'))
    {
        ctx.log('memory: the embedding model (~166MB) is fetched at the memory server\'s first start - uvx is not here yet; /alfred-code:init installs it and fetches the model');
        return;
    }
    const WARM_MS = 240000;
    const r = ctx.rt.runNode(engine, ['warm', '--root', ctx.projectRoot, '--plugin-root', ctx.source.dir, '--timeout', String(WARM_MS)],
        { cwd: ctx.projectRoot, env: ctx.env, timeout: WARM_MS + 20000 });
    const said = (/^memory warm: (.*)$/m.exec(r.stdout) || [])[1] || (r.stderr.trim().split('\n').pop() || 'no answer');
    const ready = /^ready \((\d+)s\)$/.exec(said);
    if (r.ok && (ready || said === 'cached'))
        ctx.log(`memory: the embedding model is cached now${ready ? ` (${ready[1]}s)` : ''} - the memory server's first start fits Claude Code's 30s connect budget`);
    else
        ctx.log(`  !! memory: the embedding model (~166MB) could not be fetched ahead (${said.replace(/^failed - /, '')}) - the memory server's first start fetches it and can miss Claude Code's 30s connect budget; run node .claude/hooks/memory.js warm before the next session`);
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
    if (engines.length) line += `; browser=${engines.join(',')}`;
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

// Under its pre-rename name too (`playwright-<engine>`, 2.0.0) - an older copy-route install's engines -
// unless `legacy` is false.
const registeredEngines = (mcpFile, { legacy = true } = {}) => [...new Set(Object.keys(readJson(mcpFile).mcpServers || {})
    .map((n) => ((legacy ? /^(?:browser|playwright)-(chrome|msedge|firefox|webkit)$/ : /^browser-(chrome|msedge|firefox|webkit)$/).exec(n) || [])[1])
    .filter(Boolean))];

const pwEngines = (ctx) => ctx.lists.mcps.filter((e) => e.startsWith('browser-')).map((e) => e.split('|')[0].slice('browser-'.length));

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
