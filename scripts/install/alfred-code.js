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
// The frozen sh/ps1 twins were removed in 2.0.0 (Phase 7b, R33): `ALFRED_CODE_SEED=shell` no longer
// routes anywhere - it refuses with one line and exit 1, before this file does anything else (the D1
// check, below).
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, FLAG_LIST, ENUMS } = require('./args.js');
const { createSource, compareVersions } = require('./source.js');
const { loadManifest, stackNames, stackOwnName } = require('./manifest.js');
const selection = require('./selection.js');
const plugins = require('./plugins.js');
const dataRoot = require('../../stack/mcp/data-root.js');
const mcp = require('./mcp.js');
const copy = require('./copy.js');
const settings = require('./settings.js');
const docs = require('./docs.js');
const { deriveState, writable, homeOf, splitPick, stackSeat } = require('../derive-state.js');
const { placement, readRetiredPlugins, CORE } = require('../plugin-placement.js');
const seeds = require('./seeds.js');
const pinsLayer = require('./pins.js');
const stampLayer = require('./stamp.js');
const library = require('./library.js');
const skillHeadings = require('./skill-headings.js');
const ruleOpenings = require('./rule-openings.js');
const { shippedText } = require('./retired-rules.js');
const uninstallLayer = require('./uninstall.js');
const toolIgnoresLayer = require('./tool-ignores.js');
const runtime = require('./runtime.js');
const { readJson } = require('./json-file.js');
const { envMigrations } = require('./env-migrations.js');
const { BRAND, marketOf } = require('./brand.js');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

const USAGE = `alfred-code - install or update the Claude Code stack into a project.

Usage: node ${path.basename(__filename)} <install|update|uninstall> [flags]

Action (one is REQUIRED, positional):
  install   first-time provision; wires .claude/settings.json
  update    refresh the skills, seats, rules and hooks to the release; idempotent
  uninstall remove what the stamp's ledger says the stack manages here, and nothing else

Named flags (any order, each optional): ${FLAG_LIST}

What each flag does is documented where it is set: the guided /alfred-code:init, :update,
:configure and :validate commands (setup-plugin/commands/) name every flag they pass inline, and
the repo's CLAUDE.md covers the install surface end to end.`;

const { CORE_DEP_PLUGINS } = plugins;
// D1: the frozen twins are gone; the setting that chose them refuses.
const SHELL_SEED_RETIRED = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer';
// permissions.deny, the Read-tool half of the credential gate. A bare name matches at any depth (gitignore semantics,
// code.claude.com/docs/en/permissions: 'Read(.env)' and 'Read(**/.env)' are equivalent) and reaches the Read tool, Grep and
// Glob best-effort, and the Bash file commands Claude Code recognizes (cat, head, tail, sed, tee) - never a command that
// reads a file without naming it, so guard-secret-value.js stays the shell's gate. `.sensitive-data` is the project's own
// store under the data root (stack/mcp/data-root.js). RETIRED_DENY are the four ACCOUNT-settings entries releases up to
// 0.2.62 wrote; they are dropped on every run, by exact string.
const SECRET_DENY = ['Read(.env)', 'Read(.env.*)', 'Read(*.pem)', 'Read(*.pfx)', 'Read(*.p12)', 'Read(*.key)', 'Read(.sensitive-data)'];
// The tool denies 2.5.0 to 2.10.0 wrote: the memory server's unused tools (audit 2026-10-14 PL8) and Playwright MCP's
// browser_run_code_unsafe (audit 2026-10-21 mcps T1-2), in both route spellings. The stack ships no MCP server since 2.10.1,
// so no run writes one; each stays a SHIPPED deny, so the ledger pass lifts a row an earlier run wrote (settings.js).
const MEMORY_SERVER = 'alfred-memory';
function memoryToolsAtPin(dir)
{
    const row = ((readJson(path.join(dir, 'meta', 'mcp-tools.json')) || {}).servers || {})[MEMORY_SERVER];
    return row && Array.isArray(row.tools) ? row.tools.filter((t) => typeof t === 'string' && /^[a-z0-9_]+$/.test(t)) : [];
}
const toolSpelling = (server, bare) => (bare ? `mcp__${server}__` : `mcp__plugin_${server}_${server}__`); // mcp-fixture
const memoryDenyShipped = (dir) => memoryToolsAtPin(dir).flatMap((t) => [`${toolSpelling(MEMORY_SERVER, false)}${t}`, `${toolSpelling(MEMORY_SERVER, true)}${t}`]);
const BROWSER_TOOLS_OFF = ['browser_run_code_unsafe'];
function browserToolsAtPin(dir)
{
    const row = ((readJson(path.join(dir, 'meta', 'mcp-tools.json')) || {}).servers || {}).browser;
    return row && Array.isArray(row.tools) ? BROWSER_TOOLS_OFF.filter((t) => row.tools.includes(t)) : [];
}
// Each engine's server under its 2.4.0 name and its retired `browser-<engine>` alias.
const browserDenyShipped = (dir) => ['chrome', 'msedge', 'firefox', 'webkit'].flatMap((e) => [`${e}-control`, `browser-${e}`])
    .flatMap((server) => browserToolsAtPin(dir).flatMap((t) => [`${toolSpelling(server, false)}${t}`, `${toolSpelling(server, true)}${t}`]));
// R10: every deny entry a release has written into a project's settings besides the seat denies - the
// ledger removes no other, since a stamp is project text. A release that stops writing one keeps it here.
const SHIPPED_DENY = [...SECRET_DENY, ...memoryDenyShipped(path.join(__dirname, '..', '..')), ...browserDenyShipped(path.join(__dirname, '..', '..'))];
const RETIRED_DENY = [
    'Read(~/.claude/settings.json)', 'Read(~/.claude/settings.local.json)',
    'Read(~/.claude-*/settings.json)', 'Read(~/.claude-*/settings.local.json)',
];
// The hook ENGINES, the layout module they share and the window table are copied beside the hooks rather than wired: 22
// bodies shared with cursor-stack run `node .claude/hooks/docs.js`, and the history start block
// points at `node .claude/hooks/history.js rulings`.
const HOOK_ENGINES = ['docs.js', 'history.js', 'layout.js', 'handoff.js', 'model-windows.json'];
// I12: the serena context the full copy route copied into the project's .claude up to 2.10.0 - no run copies it now,
// so the ledger prunes an unchanged copy (pruneDroppedCopies).
const NAV_CONTEXT = 'navigation-context.yml';
// What only a COPIED hook loads - the engines inline their own helpers and a plugin hook loads these
// from its own root - so the copy route ships them and the plugin route removes them with the hooks.
// shell-guards.js and file-guards.js are the dispatchers the copy route wires for the picked shell and file guards (no catalog row).
const HOOK_MODULES = ['hook-prelude.js', 'fresh-session.js', 'shell-writes.js', 'hidden-chars.js', 'forge.js', 'forge-lexicon.json', 'shell-guards.js', 'file-guards.js'];
// The one rule copy.stampDocsRoot rewrites in place, after copyLibrary already hashed it - its
// bare name, matching a copyLibrary/stamp key (no .md).
const DOCS_ROOT_RULE = 'alfred-docs-root';
// The shipped rules that name the docs root by its literal path (a rule cannot resolve a setting at load), written with
// `__DOCS_ROOT__` substituted: the docs-root rule and the preferences pointer (2026-10-21).
const ROOTED_RULES = [DOCS_ROOT_RULE, 'alfred-preferences'];

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
    // A flag 2.10.1 retired with its server, passed by a command body an older session still runs.
    for (const line of args.ignored) log(line);

    const home = env.HOME || env.USERPROFILE || '';
    // With no home and no CLAUDE_CONFIG_DIR the account dir would be a RELATIVE `.claude` - the
    // project's own, against the cwd - and an account key would land in its tracked settings.json.
    if (!home && !env.CLAUDE_CONFIG_DIR)
    {
        err('error: no account directory - HOME, USERPROFILE and CLAUDE_CONFIG_DIR are all unset; set one and run again\n');
        return 1;
    }
    // The account is the one the run's own env names - CLAUDE_CONFIG_DIR, else ~/.claude - for the installer's writes
    // and every `claude` it spawns alike (the --space profile flag is gone, the user's ruling of 2026-10-23).
    const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const cliEnv = env;
    // The account file the CLI keeps its user- and local-scope MCP registrations in (mcp.registrationsAt).
    const accountFile = path.join(cliEnv.CLAUDE_CONFIG_DIR || home, '.claude.json');
    const projectRoot = rt.gitRoot(cwd, home) || cwd; // a repo at the home directory is no project's top (seam m3)
    // T16, R29: args.js already normalised 'global' to 'user', so the flag (once resolved, below) IS
    // the CLI scope - project|user|local pass straight through to every `claude plugin` / `claude
    // mcp` call. Only the plugins follow the scope now (an optional item - claude-hud, the LSP pair, an engine - at
    // the scope its `--scope-of` names, 2.2.0):
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
    const skillsDir = path.join(projectRoot, '.claude', 'skills');
    const mcpFile = path.join(projectRoot, '.mcp.json');
    // THE DATA ROOT (stack/mcp/data-root.js): the one folder this run lays the project's data under - the docs, the hooks'
    // state and statistics, the project's sensitive data.
    const dataInfo = resolveDataRoot({ args, claudeDir, projectRoot, log });
    // F1 (matrix 2.1.5 7e): the claude CLI replaces an account file it cannot parse (a 0-byte one too) at its first plugin
    // or mcp call and keeps the old one under backups/ in its config folder (measured on 2.1.284; `--version` leaves it
    // alone). Read here, before this run's own first call - uninstall reads it for the registrations an earlier release's
    // ledger recorded there.
    let accountUnread = mcp.registrationsAt({ scope: 'user', accountFile, projectRoot }).state === 'unreadable';
    const backupDirs = [path.join(path.dirname(accountFile), 'backups'), path.join(configDir, 'backups')];
    // R105: a `claude` found on PATH that cannot be STARTED (a batch file spawned without cmd.exe, a
    // missing interpreter) is said once, here, and the run goes on as without one - never a failure
    // line per plugin, and never a call that fails with no line at all.
    const claudeBroken = rt.which('claude', { env: cliEnv }) ? rt.unrunnable('claude', { cwd: projectRoot, env: cliEnv }) : null;
    const hasClaude = claudeBroken === '';
    if (claudeBroken) note(`${claudeBroken} - the plugin layer was skipped`);
    // Uninstall makes no such call: its own listing read meets the file and refuses (m3, runUninstall).
    if (accountUnread && hasClaude && args.action !== 'uninstall')
    {
        // The call that meets the corrupt file answers with the CLI's notice and none of its own output (measured on
        // 2.1.284: `plugin list --json` printed no listing), so the recovery is met here, by a read nothing uses.
        const before = new Set(mcp.accountBackups(backupDirs).map((b) => b.file));
        rt.capture('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: projectRoot, env: cliEnv });
        const made = mcp.accountBackups(backupDirs).filter((b) => !before.has(b.file)).pop();
        // m4: no new backup - the CLI replaced nothing (a torn read of a file another session was writing, or a shape it
        // rewrites in place), so the file is read again and the run goes on as it finds it.
        if (!made) accountUnread = mcp.registrationsAt({ scope: 'user', accountFile, projectRoot }).state === 'unreadable';
        const good = made ? mcp.accountBackups(backupDirs, 'good').filter((b) => b.ms < made.ms).pop() : null;
        if (made) log(`  !! ${accountFile} could not be read - the claude CLI replaced it with a fresh file and kept the old one as ${made.file}${good ? ` (its last good copy: ${good.file})` : ''}; anything the old file held is in that backup`);
        else if (accountUnread) log(`  !! ${accountFile} could not be read, and the claude CLI did not replace it - fix the file and re-run`);
    }

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

    // THE MARKETPLACE KEY every stack spec of this run is spelled with: the key whose core is installed,
    // else a registration of the stack's repo, else the current name - read from the listings, never
    // assumed (brand.js marketOf).
    const readRaw = () => (hasClaude ? rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: cliEnv }) : '');
    const readMarkets = () => (hasClaude ? plugins.parseMarketplaces(rt.capture('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: projectRoot, env: cliEnv })) : []);
    let market = BRAND.marketplace;
    let marketSeen = { listing: [], marketplaces: [] };
    let rawListing = null;

    if (args.action === 'uninstall')
        return runUninstall({ projectRoot, claudeDir, configDir, accountFile, accountUnread, backupDirs, env, hasClaude, claudeBroken, cli, readRaw, readMarkets, instructionsSeed: args.instructionsSeed, log, note, err, failures: () => failures });

    try
    {
        // With no --source the snapshot is the newest core entry in the plugin cache - so the core is
        // updated FIRST, or the run installs the release it is replacing. A handed --source was
        // resolved by a command that already did this (setup-plugin/references/source-protocol.md).
        // A plan is read-only: it changes no plugin, so it reads the cache as it stands.
        if (!args.source && !args.printPlan && hasClaude && plugins.corePluginOn(plugins.pluginRoutes(env)))
        {
            market = plugins.refreshStackSource({
                // Every scope's rows: an entry installed at several is refreshed at each of them.
                listing: () => plugins.parsePluginList(readRaw(), projectRoot, { everyScope: true }),
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

        // What this run READS of the last install: the project's stamp.
        const stampFile = stampLayer.stampFiles({ scope: args.scope, configDir, projectRoot }).read;
        const manifest = loadManifest(resolved.dir);
        // Task 3 (2.1.0): a legacy copy-route install that never wrote a stamp - the router's own test
        // (stamp.js legacyUnstamped), read BEFORE any layer prunes the old copies it is recognised by. Its
        // picks come off disk, and it is an install from before the ledger, like an older stamp's (below).
        const legacyUnstamped = !stampFile && stampLayer.legacyUnstamped(projectRoot, { manifest });
        // R10: the last run's ledger - what it wrote and manages here. Null for a stamp from before it
        // (and an unstamped legacy install): each layer then falls back to its old
        // evidence. No stamp at all is otherwise a project the stack has managed nothing in yet, so whatever
        // is already there is the user's.
        const priorLedger = stampFile ? stampLayer.readLedger(stampFile) : legacyUnstamped ? null : stampLayer.emptyLedger();
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
                hookFiles: [...new Set(manifest.catalogs.hooks.map((e) => e.split('::')[0]))].concat('shell-guards.js', 'file-guards.js'),
                mcpNames: [...manifest.retired.mcps, ...mcp.PW_SERVERS, ...mcp.renamedFrom(manifest.renamed.mcps)],
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
        let picked = null;
        // On --installed-only, what the user PICKED (disk, the stamp's picks, --add, what those
        // require) - the stamp records that, never everything the enabled entries carry, or the next
        // closure would run over items no one picked.
        let stampPicks = null;
        let carriedPicks = null;
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
            // Each row's on/off as this project loads it - a narrower scope's off over a broader row (a configure
            // drop at this scope) reads off, so the entry stays parked rather than coming back on.
            const effective = (rows) => plugins.withEffective(rows, engineOn({ configDir, claudeDir }));
            listing = effective(plugins.parsePluginList(raw, projectRoot));
            selection.dropFormerPicks({ listing, lastVersion: stampLayer.readVersion(stampFile), compare: compareVersions, log, said: formerSaid });
            const stackListing = effective(plugins.parsePluginList(raw, projectRoot, { marketplace: market }));
            const lastPicked = selection.renamePicked(stampLayer.readPicked(stampFile), renaming);
            const back = selection.readBack({
                claudeDir, skillsDir,
                foreignSkill: skillTest({ skillsDir, stampFile, manifest, sourceDir: resolved.dir }).foreign,
                listing, stackListing,
                // I2 / N5: the file this run writes, or at local scope settings.local.json laid over
                // settings.json for `env` and `permissions.deny` (settings.js readBackSettings).
                settings: settings.readBackSettings(claudeDir, leavingLocal && args.printPlan ? 'local' : args.scope),
                routes, manifest, sourceDir: resolved.dir,
                stampHooks: readStampHooks(stampFile),
                lastHooksRoute: stampLayer.readHooksRoute(stampFile),
                stampPicked: lastPicked,
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
                err(`error: --installed-only found nothing installed under ${claudeDir} - run 'install' (or /alfred-code:init) first\n`);
                return 1;
            }
            leftOut = selection.leftOut({ parked: back.parked, deny: back.deny });
            const withAdds = selection.addLines(back.lines, args.add, log);
            const graph = readJson(path.join(resolved.dir, 'meta', 'stack-graph.json'));
            // The always-on rules and skills are locked: the read-back adopts them whatever the
            // disk says, so a drop of one would come straight back on the next update. (A skill's own
            // per-project lever is `skillOverrides`, which leaves the copy in place.)
            const locked = new Set([...(always.rules || []).map((n) => `rule ${n}`), ...(always.skills || []).map((n) => `skill ${n}`)]);
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
            const from = [...back.closeFrom, ...args.add].filter((l) => !drops.includes(l));
            let closed = close(withDrops, from, log);
            // A layer the closure brought in is carried now, so the locked set joins it in THIS run - adopted only by the
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
        for (const line of args.add)
        {
            const [category, name] = line.split(' ');
            const key = Object.keys(selection.CATEGORY).find((k) => selection.CATEGORY[k].line === category);
            if (!(lists[key] || []).some((e) => selection.CATEGORY[key].name(e) === name))
                note(`--add ${line} names nothing this release ships - ignored`);
        }

        if (args.printPlan)
        {
            for (const line of selection.renderPlan(lists)) plain(line);
            plain(`plan answered: hooks=${answered.hooks ? 'yes' : 'no'} agents=${answered.agents ? 'yes' : 'no'}`);
            plain(`plan routes: skills=${routes.skills ? 'plugin' : 'copy'} hooks=${routes.hooks ? 'plugin' : 'copy'}`);
            if (args.planOut)
            {
                if (!listing) listing = hasClaude ? plugins.parsePluginList(rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: cliEnv }), projectRoot) : [];
                const inv = selection.planInventory({
                    lists, listing, answered, leftOut, pluginCatalog: manifest.catalogs.plugins.map((id) => id.split('@')[0]),
                });
                fs.writeFileSync(args.planOut, JSON.stringify(inv, null, 2) + '\n');
            }
            return 0;
        }

        // --- the run ---------------------------------------------------------------
        // The data move: the project's sensitive data, carried inline with a root change (planDataMove).
        const dataPlan = planDataMove({
            projectRoot, info: dataInfo,
            answer: args.dataMove, stamped: (Boolean(stampFile) && fs.existsSync(stampFile)) || Boolean(legacyUnstamped), log, note,
        });
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
            hasClaude, claudeBroken, picked, answered, dropEntries, cliScope, refreshed,
            market, marketSeen, readMarkets, retiredMcpsDue, leavingLocal, ledger: priorLedger, legacyUnstamped,
            dataInfo, dataPlan,
            // The MCP plugin and server names the 2.0.0 rename left behind (manifest `renamed.mcps`).
            legacyMcps: mcp.renamedFrom(manifest.renamed.mcps),
            // A-M2/M3: the account file a user- or local-scope registration lives in, the registrations
            // read from each scope (once per run), and the names kept as another server's.
            accountFile,
            mcpRegs: {}, mcpForeign: new Map(), mcpSaid: new Set(),
            // The deniedMcpServers entries an earlier release wrote (the stamp's mcp-denied: line).
            mcpDenied: { prior: stampLayer.readMcpDenied(stampFile), now: null },
            // M9 (R132): what the full copy route switched off here - the stamp's record, this run's
            // own stand-down, and what a switch back could not enable yet.
            standDown: { prior: stampLayer.readStoodDown(stampFile), now: [], owed: null },
            // M3: the skills a same-named project folder kept from this run - never recorded as the stack's picks.
            foreignSkills: new Set(),
            // The instruction file's name: this run's answer (--instructions-file), else the stamp's, else AGENTS.md.
            instructionsAnswer: args.instructionsFile || stampLayer.readInstructionsAnswer(stampFile),
            instructionsKind: args.instructionsFile || stampLayer.readInstructionsFile(stampFile),
        };
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
            source: resolved, action: args.action, scope: args.scope, configDir, projectRoot,
            hooksCatalog: manifest.catalogs.hooks, hooksRoute: ctx.routes.hooks ? 'plugin' : 'copy', seatsRoute: ctx.routes.skills ? 'plugin' : 'copy',
            version: releaseVersion(resolved.dir), log, note,
            picked: withoutForeign(stampPickLists(lists, stampPicks, carriedPicks), ctx.foreignSkills),
            stoodDown: stoodDownRecord(ctx),
            mcpDenied: ctx.mcpDenied.now || ctx.mcpDenied.prior,
            toolIgnores: ctx.toolIgnores || stampLayer.readToolIgnores(stampFile),
            library: ctx.library || { skills: {}, agents: {}, rules: {} },
            ledger: ledgerOf(ctx),
            data: { root: dataInfo.root, pending: dataPlan.pending, kept: dataPlan.kept },
            instructionsFile: ctx.instructionsAnswer,
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
// The clone's own exclude file, when the project is a git checkout - a re-include there follows a rename too.
function excludeFileOf(ctx)
{
    try
    {
        const rel = String(ctx.rt.execCommand('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: ctx.projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
        return rel ? [path.resolve(ctx.projectRoot, rel)] : [];
    }
    catch { return []; }
}

function runLayers(ctx)
{
    const { args } = ctx;
    // The tracked .mcp.json as the run found it: a retired registration's removal below keeps the rest in its order.
    const mcpBefore = mcp.snapshotMcp(ctx.mcpFile);
    bootstrapSource(ctx);
    installSkillsAndAgents(ctx);
    installPlugins(ctx);
    retireMcps(ctx);
    forgeCliStep(ctx);
    // The generated rules moved off the `baseline-` prefix in 2.1.6: before anything re-stamps or reads them.
    selection.moveGeneratedRules({ projectRoot: ctx.projectRoot, log: ctx.log, note: ctx.note });
    docsRootStep(ctx);
    installHooksAndRules(ctx);
    const docsPath = copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope);
    // After the settings pass, so the versioning is the decision this run just wrote.
    ignoreStep(ctx, docsPath);
    // A hand-set root still waiting on update's ask moves nothing yet - its folders are re-laid out only once it is
    // the data root's (final review 2026-10-20b: the layout pass moved a team's flow/ and history/ by name).
    if (!ctx.docsRootPending)
    {
        docs.migrateDocsDomains({ projectRoot: ctx.projectRoot, docsPath, rules: selection.generatedRules(ctx.projectRoot), instructions: selection.instructionFiles(ctx.projectRoot), log: ctx.log });
        // After the .gitignore names the new folder, so a raw transcript copy never lands unignored.
        try { docs.migrateUsageReport({ projectRoot: ctx.projectRoot, docsPath, dataPath: ctx.dataInfo.root, log: ctx.log }); }
        catch (err) { ctx.note(`the usage report folder could not be renamed under ${docsPath} (${err.message}) - it stays as alfred-code-usage-report/`); }
        try { docs.migratePlans({ projectRoot: ctx.projectRoot, docsPath, rules: selection.generatedRules(ctx.projectRoot), instructions: selection.instructionFiles(ctx.projectRoot), log: ctx.log }); }
        catch (err) { ctx.note(`the folders under ${docsPath}/superpowers could not be moved up (${err.message}) - move each one to ${docsPath}/ by hand`); }
        // After migratePlans, so superpowers/plans/ reaches plans/ first; after the .gitignore step, so a nested history/
        // .gitignore of the stack's is gone before history/ moves into the data root's state/.
        try { docs.migrateLayout({ projectRoot: ctx.projectRoot, docsPath, dataPath: ctx.dataInfo.root, log: ctx.log }); }
        catch (err) { ctx.note(`the 2.8.0 folder layout could not be applied under ${docsPath} (${err.message}) - every file is back where it was; re-run /alfred-code:update`); }
    }
    // An update moves the seed an earlier release wrote as .claude/CLAUDE.md - only while it is still unedited, only while
    // the install works with AGENTS.md (on a CLAUDE.md answer that file already has the name the user picked), and only
    // when no name answer came this run: an answer renames through renameInstructionFiles below.
    if (args.action === 'update' && ctx.instructionsKind === 'agents' && !args.instructionsFile)
        ctx.stackAgentsMd = seeds.moveSeededClaudeMd({
            projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, ledgerHash: (ctx.ledger && ctx.ledger.files && ctx.ledger.files['CLAUDE.md']) || '',
            hash: library.hashItem, tracked: (at) => gitTracks(ctx, at),
            gitMv: (from, to) => ctx.rt.execCommand('git', ['mv', '--', from, to], { cwd: path.dirname(from), stdio: 'ignore' }),
            log: ctx.log, note: ctx.note,
        }) === 'moved';
    // The name question's answer (init's, configure's and update's --instructions-file): each file of the other name is
    // renamed, a part's own included (seeds.js says why), unless a root or .claude/ file already carries the answer - before
    // the place move below, so a renamed file travels too.
    if (args.instructionsFile)
    {
        const renamed = seeds.renameInstructionFiles({
            projectRoot: ctx.projectRoot, kind: args.instructionsFile,
            tracked: (at) => gitTracks(ctx, at), ignoreFiles: excludeFileOf(ctx), parts: instructionParts(ctx),
            gitMv: (from, to) => ctx.rt.execCommand('git', ['mv', '--', from, to], { cwd: path.dirname(from), stdio: 'ignore' }),
            log: ctx.log, note: ctx.note,
        });
        // The renamed seed stays the stack's: its ledger row follows the new name (seeds.seedRowAfterRename says why).
        const files = ctx.ledger && ctx.ledger.files;
        if (renamed.length && files && files['AGENTS.md'])
            files['AGENTS.md'] = seeds.seedRowAfterRename(files['AGENTS.md'], ledgerPath(ctx, 'AGENTS.md'));
        // A 2.1.6 seed under its CLAUDE.md row, renamed on an `agents` answer, is the seed under its new name - taken over
        // as moveSeededClaudeMd's move takes it while unedited, so it is refreshed, ledgered and uninstalled; without this
        // the answer skipped that move and the seed passed to the project unsaid (review 2026-10-23).
        else if (files && files['CLAUDE.md'] && args.instructionsFile === 'agents' && renamed.includes('.claude/CLAUDE.md -> .claude/AGENTS.md'))
        {
            const row = seeds.seedRowAfterRename(files['CLAUDE.md'], path.join(ctx.projectRoot, '.claude', 'AGENTS.md'));
            if (row !== files['CLAUDE.md']) { files['AGENTS.md'] = row; delete files['CLAUDE.md']; ctx.stackAgentsMd = true; }
        }
    }
    // The place question's answer (init's and configure's --instructions-at): each instruction file at the other place
    // moves - after the renames above, so a renamed seed travels too, and before a seed is laid down there.
    if (args.instructionsAt)
        seeds.placeInstructionFiles({
            projectRoot: ctx.projectRoot, at: args.instructionsAt,
            tracked: (at) => gitTracks(ctx, at), ignored: (at) => gitIgnores(ctx, at),
            gitMv: (from, to) => ctx.rt.execCommand('git', ['mv', '--', from, to], { cwd: path.dirname(from), stdio: 'ignore' }),
            log: ctx.log, note: ctx.note,
        });
    if (args.action === 'install') ctx.stackAgentsMd = seeds.seedAgentsMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, at: args.instructionsAt, kind: ctx.instructionsKind, log: ctx.log, note: ctx.note });
    // Every move above done: where the seed the ledger records sits now, under either name (seeds.locateSeed) - read for its
    // refresh, its re-spelling, its ledger row and nothing else.
    ctx.seedFile = seeds.locateSeed(ctx.projectRoot, ctx.instructionsKind, (ctx.ledger && ctx.ledger.files && ctx.ledger.files['AGENTS.md']) || '');
    // An update brings a seed the stack still owns - just moved, or held by the ledger at its hash - onto this release's
    // template, so a template change reaches it; an edited one is the project's and only re-spelled below.
    if (args.action === 'update')
    {
        const held = ctx.ledger && ctx.ledger.files && ctx.ledger.files['AGENTS.md'];
        let unedited = false;
        try { unedited = Boolean(held) && library.hashItem(ledgerPath(ctx, 'AGENTS.md')) === held; } catch { /* unreadable: not ours to judge */ }
        if (ctx.stackAgentsMd || unedited)
            ctx.stackAgentsMd = seeds.refreshSeededAgentsMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, kind: ctx.instructionsKind, file: ctx.seedFile, log: ctx.log, note: ctx.note }) || ctx.stackAgentsMd;
    }
    // Only a seed the ledger still holds at its hash is the stack's to re-spell; a re-spelled one keeps its ledger row. The
    // AGENTS.md row is the seed under the install's name at the seed's place (the root on --instructions-at root), never
    // another file; the CLAUDE.md row is the 2.1.6 seed's.
    const seedRow = (rel) =>
    {
        const at = path.join(ctx.projectRoot, ...rel.split('/'));
        if (at === ledgerPath(ctx, 'AGENTS.md')) return 'AGENTS.md';
        return rel === '.claude/CLAUDE.md' && at === ledgerPath(ctx, 'CLAUDE.md') ? 'CLAUDE.md' : '';
    };
    ctx.respelledSeeds = new Set();
    selection.respellRenamed({
        // No MCP server ships since 2.10.1, so an old server spelling has no current one to take: skills and seats only.
        projectRoot: ctx.projectRoot, renamed: { ...ctx.manifest.renamed, mcps: {} }, docsPath,
        owned: (rel) =>
        {
            const row = seedRow(rel);
            if (!row) return false;
            if (row === 'AGENTS.md' && ctx.stackAgentsMd) return true;
            const held = ctx.ledger && ctx.ledger.files && ctx.ledger.files[row];
            return Boolean(held) && library.hashItem(ledgerPath(ctx, row)) === held;
        },
        onWrite: (rel) => ctx.respelledSeeds.add(seedRow(rel)),
        log: ctx.log, note: ctx.note,
    });
    if (plugins.corePluginOn(ctx.routes))
        selection.respellRosterSeats({ projectRoot: ctx.projectRoot, core: CORE, seats: placement().plugins[CORE].agents, docsPath, log: ctx.log, note: ctx.note });
    dataRootLayer(ctx, docsPath);
    mcp.keepMcpOrder({ mcpFile: ctx.mcpFile, before: mcpBefore });
}

// The run book's old credentials file goes into the project's sensitive data (data-root.js adoptCredentials): one line,
// keys by name and never a value; a clash or a store git would commit moves nothing and is said every run until fixed.
// Two docs roots are looked in: this run's (settings.json's at project scope, R98) and the one a session reads, where
// settings.local.json wins - a capture writes the run book under the latter.
function adoptCredentials(ctx, root, docsPath)
{
    const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const session = dataRoot.settingFrom({ env: process.env, projectDir: ctx.projectRoot, suffix: 'DOCS_PATH' });
    for (const at of [...new Set([docsPath, session].map(norm).filter(Boolean))]) adoptCredentialsAt(ctx, root, at);
}
function adoptCredentialsAt(ctx, root, docsPath)
{
    const { projectRoot, log } = ctx;
    const r = dataRoot.adoptCredentials({ projectDir: projectRoot, root, docsPath });
    if (r.state === 'moved')
        log(`  sensitive data: ${r.from} -> ${r.to} (${r.added.length ? `${r.added.join(', ')} added` : 'every key already there'}${r.added.length < r.keys.length ? `, ${r.keys.filter((k) => !r.added.includes(k)).join(', ')} already there` : ''})${r.repointed ? '; the run book names it now' : ''}`);
    else if (r.state === 'clash')
        log(`  !! sensitive data: ${r.from} not moved - ${r.to} holds ${r.keys.join(', ')} with another value; keep one value per key (drop it from one file), then run /alfred-code:update`);
    else if (r.state === 'exposed')
        log(`  !! sensitive data: ${r.from} not moved - git would commit ${r.to}; ignore it (the data root's .gitignore is the project's own), then run /alfred-code:update`);
    else if (r.state === 'empty') log(`  sensitive data: ${r.from} holds no KEY=value line - left as it is`);
    else if (r.state === 'blocked' || r.state === 'failed') log(`  !! sensitive data: ${r.from} not moved (${r.why}) - the next run tries again`);
}

// THE ONE .gitignore (the user's ruling of 2026-10-13): the data root's file carries the docs rules too
// (docs.ensureDataIgnore), so the docs root's own file goes when it is the stack's text, and so do the nested ones an
// earlier release wrote (docs.pruneNestedIgnores). A docs root outside the data root, or a data root whose file is the
// project's own, keeps the docs root's own file (docs.ensureDocsIgnore). ctx.dataIgnoreOk gates what may land under
// the root only once git keeps it out (the sensitive data).
const STACK_IGNORE = ['written', 'replaced', 'current'];
function ignoreStep(ctx, docsPath)
{
    const { projectRoot, log, note } = ctx;
    const root = ctx.dataInfo.root;
    let mode = null;
    try { mode = copy.resolveDocsVersioning(projectRoot, ctx.args.scope) || docs.docsVersioningSeed({ projectRoot, docsPath }); }
    catch (err) { note(`the docs versioning could not be read (${err.message}) - the .gitignore keeps the docs committed`); }
    let data = null;
    try { data = docs.ensureDataIgnore({ projectRoot, root, docsPath, mode, log }); }
    catch (err) { note(`${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore, keeping its docs/ folder visible`); }
    ctx.dataIgnoreOk = data !== null;
    const dataCovered = STACK_IGNORE.includes(data);
    let own = null;
    try { own = docs.ensureDocsIgnore({ projectRoot, docsPath, mode, covered: dataCovered && Boolean(dataRoot.docsInsideRoot({ root, docsPath })), log }); }
    catch (err) { note(`${docsPath}/.gitignore could not be written (${err.message}) - add the docs root's machine state to the repo's own .gitignore`); }
    const docsCovered = (dataCovered && Boolean(dataRoot.docsInsideRoot({ root, docsPath }))) || STACK_IGNORE.includes(own);
    try { docs.pruneNestedIgnores({ projectRoot, root, docsPath, docsCovered, dataCovered, log }); }
    catch (err) { note(`the nested .gitignore files could not be checked (${err.message}) - they stay as they are`); }
}

// The project's sensitive data exists from the first install on (data-root.js ensureSensitiveFile): one comment line,
// written only where git keeps it out; a store git would commit is said, never made.
function sensitiveFile(ctx, root)
{
    let r;
    try { r = dataRoot.ensureSensitiveFile({ projectDir: ctx.projectRoot, root }); }
    catch (err) { ctx.note(`${root}/.sensitive-data could not be written (${err.code || err.message}) - create it by hand, one KEY=value per line`); return; }
    if (r === 'written') ctx.log(`  sensitive data: ${root}/.sensitive-data written - empty, gitignored; put KEY=value lines in it by hand`);
    else if (r === 'exposed') ctx.log(`  !! sensitive data: ${root}/.sensitive-data not written - git would commit it (the data root's .gitignore is the project's own); ignore it, then run /alfred-code:update`);
    else if (r === 'blocked') ctx.log(`  !! sensitive data: ${root}/.sensitive-data is not a file - nothing written`);
}

// The data root's own files, once the docs root is settled: its `.gitignore` (written by ignoreStep - the
// docs follow their versioning, everything else is machine state), serena's project.yml seeded where serena
// reads it this run (the root, or a 2.0.0 .serena its launcher has not moved yet) and its home config
// pointing serena at the folder (the launcher writes it too - the installer's copy serves the copy route,
// which runs no launcher, and a `serena project index` run before any start). A 2.0.0 place still in use
// keeps its own `.gitignore`; a root the data left is removed once only its `.gitignore` remains.
function dataRootLayer(ctx, docsPath)
{
    const { projectRoot, log, note } = ctx;
    const root = ctx.dataInfo.root;
    if (ctx.dataIgnoreOk !== false)
    {
        adoptCredentials(ctx, root, docsPath);
        sensitiveFile(ctx, root);
    }
    // The project's own tree-walking tools skip the data root (tool-ignores.js): one marked line per ignore file.
    ctx.toolIgnores = toolIgnoresLayer.ensureToolIgnores({ projectRoot, root, prior: stampLayer.readToolIgnores(ctx.stampFile), log, note });
    for (const old of new Set([ctx.dataInfo.prior, ...ctx.dataPlan.left].filter((r) => r && r !== root)))
        docs.pruneDataRoot({ projectRoot, root: old, log });
    if (ctx.dataPlan.moved.length) log(`data root: ${root} - ${ctx.dataPlan.moved.length} moved now`);
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

// What the data move does this run: the project's sensitive-data file (data-root.js SENSITIVE_FILE) is the one class the
// stack still moves, inline, when the root changes. `--data-move move` moves it, `keep` marks the layout kept, and no
// answer moves nothing and names the offer. A `data-pending:` line an earlier release recorded for a server's launcher
// names data that is no longer the stack's (2.10.1: no server ships) - it is dropped, the data left where it is.
function planDataMove({ projectRoot, info, answer, stamped, log, note })
{
    const abs = (rel) => path.join(projectRoot, ...rel.split('/'));
    const isFile = (rel) => { try { return fs.lstatSync(abs(rel)).isFile(); } catch { return false; } };
    const moved = [];
    const left = [];
    // A sensitive-data move an earlier run could not make (a clash, a failed rename) is retried; any other class is dropped.
    let pending = info.recorded.pending.filter((p) => p.cls === 'sensitive' && isFile(p.from) && p.to === dataRoot.targetOf(p.cls, info.root));
    let kept = info.recorded.kept && answer !== 'move';
    if (answer === 'keep') { kept = true; pending = []; }
    const inline = (row) =>
    {
        const r = dataRoot.movePlace({ projectDir: projectRoot, cls: row.cls, from: row.from, to: row.to });
        if (r.state === 'moved') { moved.push(row); left.push(dataRoot.rootOfPlace(row.cls, row.from)); log(`data root: moved ${row.from} -> ${row.to}`); return true; }
        log(`data root: ${row.from} not moved yet (${r.why || r.state}) - the next run tries again`);
        return false;
    };
    pending = pending.filter((p) => !inline(p));
    const rows = stamped ? dataRoot.dataMovePlan({ projectRoot, root: info.root, prior: info.prior }) : [];
    const same = (a, b) => a.cls === b.cls && a.from === b.from && a.to === b.to;
    const open = rows.filter((r) => !pending.some((p) => same(p, r)));
    if (answer === 'move')
    {
        for (const row of open)
        {
            if (row.conflict) { note(`data root: ${row.from} not moved - ${row.to} already holds data; move or remove one of them, then run /alfred-code:update --data-move move`); continue; }
            if (!inline(row)) pending.push({ cls: row.cls, from: row.from, to: row.to });
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

// THE DOCS ROOT this run leaves in effect: <data root>/docs (2.8.0, the user's ruling of 2026-10-20 - docs.docsMovePlan).
// A leftover ALFRED_CODE_DOCS_PATH is drained: the stack's docs move from the root it names, then the key goes from both
// settings files (applyEnv 3b); a clash or a key a local-scope run cannot write moves nothing and keeps it, so the hooks
// keep reading where the docs are. A HAND-SET root (docs.docsMovePlan `handSet`) holding the stack's docs moves only on
// `--docs-root-move move`, the answer to update's ask: it may be the team's own `docs/`, and the stack's entries are
// picked by name, so the answer names the team's own (`--docs-root-leave`), which stay. No keep (the user's answers of
// 2026-10-20): with no answer nothing moves yet, and the next update asks again. `ctx.docsPath` is the settings decision (remove or keep),
// `ctx.docsRoot` the root the rules are stamped with.
function docsRootStep(ctx)
{
    const { args, log, note } = ctx;
    const stamped = (Boolean(ctx.stampFile) && fs.existsSync(ctx.stampFile)) || Boolean(ctx.legacyUnstamped);
    const to = `${ctx.dataInfo.root}/docs`;
    const ledgered = Object.values((ctx.ledger && ctx.ledger.env) || {}).map((m) => m && m.ALFRED_CODE_DOCS_PATH).filter(Boolean);
    const plan = docs.docsMovePlan({ projectRoot: ctx.projectRoot, ...docs.docsMoveViews({ claudeDir: ctx.claudeDir }), scope: args.scope, stamped, to, prior: ctx.dataInfo.prior, ledgered, leave: args.docsRootLeave || [] });
    ctx.docsPath = null;
    ctx.docsVersioningCarry = null;
    ctx.docsRootPending = false;
    const keep = { keep: true };
    for (const root of plan.shadowed) log(`docs root: ${root} (settings.json) was hidden by settings.local.json's root - not moved; take what you need from it by hand`);
    // A leave name that is none of the stack's entries: a typo must never move the folder it meant to keep.
    if (plan.unknown.length)
    {
        ctx.docsPath = plan.keys.length ? keep : null;
        ctx.docsRootPending = true;
        note(`docs root: --docs-root-leave names ${plan.unknown.join(', ')}, not one of the stack's entries at ${plan.from} (${plan.moves.join(', ') || 'none'}) - nothing moved; ALFRED_CODE_DOCS_PATH stays; run /alfred-code:update again`);
    }
    else if (plan.state === 'drop')
    {
        ctx.docsPath = { remove: true, why: `the docs root is ${to}` };
        if (plan.from && plan.from !== to) selection.respellDocsRoot({ projectRoot: ctx.projectRoot, from: plan.from, to, log, note });
    }
    else if (plan.state === 'blocked')
    {
        ctx.docsPath = keep;
        note(`docs root: ${plan.why} - nothing moved; take the key out of settings.json (the docs root is ${to}), then run /alfred-code:update`);
    }
    else if (plan.state === 'clash')
    {
        ctx.docsPath = keep;
        note(`docs root: ${plan.from} not moved - ${plan.conflicts.length} file(s) already at ${to}: ${plan.conflicts.slice(0, 5).join(', ')} - ALFRED_CODE_DOCS_PATH stays, so the hooks keep reading ${plan.from}; move or remove one side, then run /alfred-code:update`);
    }
    else if (plan.state === 'move' && plan.handSet && args.docsRootMove !== 'move')
    {
        ctx.docsPath = keep;
        ctx.docsRootPending = true;
        note(`docs root: ${plan.from} was set by hand - nothing moved yet; /alfred-code:update asks which of ${plan.moves.join(', ')} are the team's own - those stay, the rest move to ${to} (${plan.tracked.length + plan.untracked.length} file(s); ${plan.left.length ? `${plan.left.join(', ')} stay` : 'nothing else there'})`);
    }
    else if (plan.state === 'move')
    {
        const moved = docs.moveDocsRoot({ projectRoot: ctx.projectRoot, plan });
        if (moved.ok)
        {
            ctx.docsPath = { remove: true, why: `the docs moved to ${to}` };
            selection.respellDocsRoot({ projectRoot: ctx.projectRoot, from: plan.from, to, log, note });
            // A move keeps what git saw: an old root git ignored, with nothing tracked, stays out of git as a `local`
            // root - unless this run names a versioning itself.
            if (plan.ignored && !args.docsVersioning) ctx.docsVersioningCarry = 'local';
            log(`docs root: moved ${plan.from} -> ${to} (${moved.moved} file(s), ${moved.gitMoved} through git mv${moved.gitMoved ? ' - staged as renames, commit them' : ''})`
                + ' - the rule is re-stamped; a session started before this still holds the old root in its loaded rule, so restart it');
            if (plan.left.length) log(`docs root: ${plan.from} keeps ${plan.left.join(', ')} - not the stack's, left in place`);
        }
        else
        {
            ctx.docsPath = plan.keys.length ? keep : null;
            note(`docs root: not moved - ${moved.error}; every file is back under ${plan.from}`);
        }
    }
    // The root the hooks read after this run: the data root's, unless a key stays. A settings file that cannot be read
    // says nothing about the root, so the rule keeps the root it was stamped with.
    const kept = plan.keys.length && !(ctx.docsPath && ctx.docsPath.remove) ? plan.keys[plan.keys.length - 1].value : null;
    const unreadable = plan.state === 'none' && /cannot be read$/.test(plan.why);
    ctx.docsRoot = unreadable ? copy.stampedDocsRoot(ctx.projectRoot) || copy.resolveDocsRoot(ctx.projectRoot, args.scope) : kept || to;
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
// Each part's own instruction file (`web/AGENTS.md`) the AGENTS.md check finds - git's tracked and unignored files, or a
// walk outside git; dependency folders and nested repositories are skipped. The root and .claude/ ones are not parts.
function instructionParts(ctx)
{
    try { return require('../agents-md-check.js').findFiles(ctx.projectRoot).filter((rel) => rel.includes('/') && !rel.startsWith('.claude/')); }
    catch { return []; }
}

function gitTracks(ctx, target)
{
    const r = ctx.rt.spawnCommand('git', ['ls-files', '-z', '--', target], { cwd: path.dirname(target), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 && String(r.stdout || '').length > 0;
}

// An untracked path a .gitignore line keeps out of git - `git check-ignore` reads a tracked file as not ignored. Outside a
// repository it is no ignore at all.
function gitIgnores(ctx, target)
{
    const r = ctx.rt.spawnCommand('git', ['check-ignore', '-q', '--', target], { cwd: path.dirname(target), stdio: 'ignore' });
    return r.status === 0;
}

function pruneCopies(ctx, dir, names, label, why, { keepTracked = false, keep = null } = {})
{
    for (const name of names)
    {
        const target = path.join(dir, name);
        if (!fs.existsSync(target)) continue;
        if (keepTracked && gitTracks(ctx, target))
        {
            ctx.log(`  ${label} kept (${why}, tracked in git): ${name}`);
            continue;
        }
        const kept = keep && keep(name);
        if (typeof kept === 'string') { ctx.log(`  !! ${label} kept: ${name} - ${why}, but ${kept}`); continue; }
        if (kept)
        {
            ctx.log(`  ${label} kept (${why}, but the project's own - the stamp does not record it): ${name}`);
            continue;
        }
        fs.rmSync(target, { recursive: true, force: true });
        ctx.log(`  ${label} pruned (${why}): ${name}`);
    }
}

// A retired name is pruned only where the stack's own record holds it - the stamp's library hash for a skill, seat or rule,
// the ledger's row for a hook - and only while the copy still hashes to it: a bare name is as often the project's own, and
// an edit since is the user's. A skill or seat the stamp does not record still goes when only the stack uses its name.
// Returns false to prune, else the reason it stays.
function retiredKeep(ctx, kind, dir)
{
    const lib = stampLayer.readLibrary(ctx.stampFile) || {};
    const picked = stampLayer.readPicked(ctx.stampFile) || { agents: [] };
    const names = stackNames(ctx.manifest);
    const bare = (n) => n.replace(/\.md$/, '');
    return (name) =>
    {
        const held = kind === 'hook' ? ctx.ledger && ctx.ledger.files && ctx.ledger.files[`hooks/${name}`] : (lib[`${kind}s`] || {})[bare(name)];
        if (held) return library.hashItem(path.join(dir, name)) === held ? false : 'edited since the stack wrote it, so it is yours - merge what you need, then remove it by hand';
        const claimed = kind === 'skill' ? skillClaim(ctx)(name)
            : kind === 'agent' ? picked.agents.some((e) => e.split('@')[0] === bare(name)) || stackOwnName(names, 'agents', bare(name))
                : renamedRuleClaim(ctx, dir, bare(name), lib.rules || {});
        return claimed ? false : 'the stamp does not record it, so it is yours - remove it by hand if it is the stack\'s';
    };
}

// M3: a skill folder already in `.claude/skills` the stack may treat as its own copy (`claims`) - the stamp
// records it (a library hash, or a pick), only the stack uses the name (manifest.js stackOwnName), or its
// SKILL.md carries a heading the stack has shipped under that name (the frontmatter `name` and `description`, the
// current one or a past one from meta/skill-headings.json: a copy whose body, references or tool spellings moved on
// is still the stack's, and so is one copied before the stamp recorded skills; a project's own skill has words of its
// own). Any other folder under a catalog name is the project's (`foreign`): never overwritten, pruned, dropped or read
// back as a pick - named, and left out of the stamp. Read once per run, from the stamp as the run found it.
function skillTest({ skillsDir, stampFile, manifest, sourceDir })
{
    const lib = stampLayer.readLibrary(stampFile) || {};
    const picked = stampLayer.readPicked(stampFile) || { skills: [] };
    const recorded = new Set([...Object.keys(lib.skills || {}), ...picked.skills.map((e) => e.split('@')[0])]);
    const names = stackNames(manifest);
    const past = skillHeadings.pastHeadings(sourceDir);
    const heading = (file) =>
    {
        try { return skillHeadings.headingOf(fs.readFileSync(file, 'utf8')); } catch { return null; }
    };
    const stackText = (name) =>
    {
        const theirs = heading(path.join(skillsDir, name, 'SKILL.md'));
        if (!theirs) return false;
        return theirs === heading(path.join(sourceDir, 'stack', 'skills', name, 'SKILL.md'))
            || Boolean(past.get(name) && past.get(name).has(skillHeadings.headingHash(theirs)));
    };
    const claims = (name) => recorded.has(name) || stackOwnName(names, 'skills', name) || stackText(name);
    const foreign = (name) => fs.existsSync(path.join(skillsDir, name)) && !claims(name);
    return { claims, foreign };
}
const skillTestOf = (ctx) => (ctx.skillTest ||= skillTest({ skillsDir: ctx.skillsDir, stampFile: ctx.stampFile, manifest: ctx.manifest, sourceDir: ctx.source.dir }));
const skillClaim = (ctx) => skillTestOf(ctx).claims;
const foreignSkill = (ctx, name) => skillTestOf(ctx).foreign(name);
const foreignLine = (name) => `  !! skill kept: ${name} - a project skill of that name the stamp does not record, so it is yours; the stack's ${name} is not installed here - rename or remove yours, then /alfred-code:configure adds it`;
// The rule twin of the skill claim: a same-named rule file the stamp holds no hash for is the stack's when only the stack
// uses the name (`alfred-` prefix) or it opens with a first line the stack has shipped under that name - the current one,
// or a past one from meta/rule-openings.json: a pre-stamp copy of markdown-docs or devops-conventions opens with one of
// seven or six older sentences, and the current-line test alone kept every such copy as 'yours' (audit 2026-10-20 C23).
const ruleOpening = (file) =>
{
    try { return fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/).find((l) => l.trim()) || null; }
    catch { return null; }
};
const ruleClaim = (ctx) => (name) =>
{
    if (stackOwnName(stackNames(ctx.manifest), 'rules', name)) return true;
    const past = (ctx.ruleOpenings ||= ruleOpenings.pastOpenings(ctx.source.dir));
    return ruleOpenings.stackOpening(name, readText(path.join(ctx.claudeDir, 'rules', `${name}.md`)),
        readText(path.join(ctx.source.dir, 'stack', 'rules', `${name}.md`)), past);
};
// A RENAMED rule's old copy the stamp holds no hash for. Under a stamp that records no rule (a 0.2.x or 1.x stamp predates
// library-rules, or a garbled line) it is the stack's when it is byte for byte a text the stack shipped under the old name, or opens with its successor's
// first line: the baseline-* copies each open with their alfred-* heading. Under one that records rules it is the stack's only when the stamp records its
// SUCCESSOR and the copy is, byte for byte, a text the stack shipped under the old name (retired-rules.js): a 2.2.0 or
// 2.2.1 run kept all seven unjudged and recorded the alfred-* names (audit 2026-10-10 C10, 34,059 chars on every
// message), while a copy an earlier run kept as edited differs from every shipped text and stays. A retired name with no
// successor stays the user's - nothing shipped is left to compare it with.
function renamedRuleClaim(ctx, dir, name, recorded)
{
    const renamed = (ctx.manifest.renamed || {}).rules || {};
    const next = renamed[name];
    if (!next) return false;
    const file = path.join(dir, `${name}.md`);
    // A successor renamed since is still this copy's: `baseline-git` maps to `alfred-preferences` now, and a stamp from
    // before 2026-10-21 records `alfred-git`, whose own copy opens with the git heading the preferences rule lacks.
    const heirs = [next, ...Object.keys(renamed).filter((old) => renamed[old] === next && old !== name)];
    // A successor retired since leaves no heir a stamp will record again (`baseline-memory` -> the retired `alfred-memory`,
    // 2026-10-24): the shipped text alone decides.
    const retired = new Set(((ctx.manifest.retired || {}).rules || []).map((f) => f.replace(/\.md$/, '')));
    if (heirs.every((heir) => retired.has(heir))) return shippedText(name, readText(file));
    if (Object.keys(recorded).length) return heirs.some((heir) => Object.hasOwn(recorded, heir)) && shippedText(name, readText(file));
    if (shippedText(name, readText(file))) return true;
    const ours = ruleOpening(path.join(ctx.source.dir, 'stack', 'rules', `${next}.md`));
    return Boolean(ours) && ruleOpening(file) === ours;
}
function readText(file)
{
    try { return fs.readFileSync(file, 'utf8'); }
    catch { return null; }
}
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
    pruneCopies(ctx, ctx.skillsDir, ctx.manifest.retired.skills, 'skill', 'retired upstream', { keepTracked: true, keep: retiredKeep(ctx, 'skill', ctx.skillsDir) });
    pruneCopies(ctx, agentsDir, ctx.manifest.retired.agents, 'agent', 'retired upstream', { keepTracked: true, keep: retiredKeep(ctx, 'agent', agentsDir) });
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

// C17 / B seam: what a copy-route copy holds - the shipped text, with a seat's `alfred-code:<skill>` preloads bare on the
// FULL copy route, since no core plugin serves that spelling there. Null when nothing changes - every plugin route.
function copyRender(ctx, kind)
{
    if (kind !== 'agent' || mcp.corePluginOn(ctx.routes)) return null;
    return (text) => copy.respellPreloads(text, CORE);
}

function installPlugins(ctx)
{
    if (!ctx.hasClaude) { if (!ctx.claudeBroken) ctx.note('the claude CLI is not on PATH - the plugin layer was skipped'); return; }
    // One row per name@marketplace: the set mixes official picks with stack entries, and the official
    // catalog ships names the stack uses too.
    const readRaw = () => ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.cliEnv });
    const readListing = () => plugins.parsePluginList(readRaw(), ctx.projectRoot, { byMarketplace: true });
    const raw = readRaw();
    const listing = plugins.parsePluginList(raw, ctx.projectRoot, { byMarketplace: true });
    const rows = plugins.parsePluginList(raw, ctx.projectRoot, { everyScope: true });
    const blind = !listingRead(raw);
    // The full copy route copies the core's hooks and seats into the project, so the core's own row goes off (R107) -
    // which rows are on is the settings file's word at each scope before the listing's (S22, S28). M4 (R132): a listing
    // that could not be read is no list of rows - one loud line names what could not be switched off.
    const isOn = engineOn(ctx);
    const copyRoute = !plugins.corePluginOn(ctx.routes);
    const stand = { rows, market: ctx.market, scope: ctx.cliScope, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note };
    if (blind && copyRoute) ctx.note(blindStandDown(ctx));
    const standDown = () => { if (copyRoute && !blind) ctx.standDown.now = plugins.copyRouteStandDown(stand); };
    let set = plugins.pluginSet({
        routes: ctx.routes, thirdParty: ctx.lists.plugins,
        stackEntries: ctx.stackEntries || [], coreDeps: CORE_DEP_PLUGINS, market: ctx.market,
    });
    const marketplaces = plugins.extraMarketplaces(ctx.manifest.rows.plugins, set);
    // 2.2.0: each optional item at the scope the user chose for it (`--scope-of`); a required one follows the run.
    const scopes = ctx.args.scopeOf || {};
    // C12: an install moved off local scope takes its plugin rows along - installed at the new scope, the
    // local row uninstalled. What moved is installed this run (`fresh`); the listing reads each at its
    // new scope from here on.
    const relocated = ctx.leavingLocal && !blind
        ? plugins.moveLocalRows({
            plugins: set, rows, scope: ctx.cliScope, scopes,
            isOn, cli: ctx.cli, log: ctx.log, note: ctx.note,
        })
        : { moved: [], dropped: [] };
    for (const row of listing)
        if ([...relocated.moved, ...relocated.dropped].includes(`${row.name}@${row.marketplace}`)) row.scope = ctx.cliScope;
    // ... and the local rows that went are no scope the update pass refreshes.
    for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].scope === 'local' && relocated.dropped.includes(`${rows[i].name}@${rows[i].marketplace}`)) rows.splice(i, 1);
    // An optional item the user gave another scope than the one it is installed at moves there first, so the passes
    // below find it where it now lives. A listing that could not be read moves nothing.
    const rescoped = !blind
        ? plugins.moveScoped({
            plugins: set, rows, scope: ctx.cliScope, scopes, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note,
        })
        : [];
    for (const row of listing)
    {
        const hit = rescoped.find((m) => m.spec === `${row.name}@${row.marketplace}`);
        if (hit) row.scope = hit.scope;
    }
    // A-I4: said once, after the plugin pass on either action. Marked `!!`, like every line a user acts on.
    const hudLine = () =>
    {
        if (plugins.hudStatusLineMissing({ plugins: set, listing, settingsFiles: [path.join(ctx.configDir, 'settings.json'), ...['settings.json', 'settings.local.json'].map((f) => path.join(ctx.projectRoot, '.claude', f))] }))
            ctx.log('  !! claude-hud has no status line yet - run /alfred-code:init to set it up');
    };
    // The plugins a release cut (meta/retired-plugins.json) go the same way, each by its full spec and
    // with its add-back line - 2.0.0's five MCP entries and 2.10.1's server plugins among them.
    const retiredRows = readRetiredPlugins(ctx.source.dir);
    // A retired third-party pick goes on the first update past its retirement only (plugins.retirementDue):
    // after it, a row under that spec is the user's own, put back with the add-back line.
    const lastVersion = stampLayer.readVersion(ctx.stampFile);
    const retired = [...new Set([...ctx.manifest.retired.plugins, ...retiredRows.map((r) => r.name)])]
        .filter((name) => plugins.retirementDue({ name, rows: retiredRows, lastVersion, compare: compareVersions }));
    const fresh = [...relocated.moved, ...rescoped.map((m) => m.spec)];
    // The switch back (R116, M9): what the full copy route switched off comes back on - the record only.
    const back = copyRoute ? { restored: [], owed: null }
        : plugins.restoreStoodDown({ record: ctx.standDown.prior, plugins: set, isOn, cli: ctx.cli, log: ctx.log, note: ctx.note });
    ctx.standDown.owed = back.owed;
    // A stack row already at this snapshot's release is not updated again (plugins.atRelease): the source step
    // updated every stack entry before the snapshot was read (audit 2026-10-11, session 5b9ce9c5).
    const release = { market: ctx.market, version: releaseVersion(ctx.source.dir) };
    if (ctx.args.action === 'update')
    {
        plugins.prunedRetired({ rows, retired, retiredRows, market: ctx.market, scope: ctx.cliScope, cli: ctx.cli, log: ctx.log, note: ctx.note });
        standDown();
        plugins.updatePlugins({
            plugins: set, scope: ctx.cliScope, scopes, marketplaces, before: listing, rows, fresh, restored: back.restored, refreshed: ctx.refreshed, release, cli: ctx.cli, log: ctx.log, note: ctx.note,
            after: readListing,
        });
        hudLine();
        for (const row of ctx.dropEntries || [])
        {
            const spec = `${row.name}@${row.marketplace}`;
            // A drop switches the entry off where this run reaches it: at its own scope when that is the run's, and
            // over a BROADER row (user under a project run, project or user under a local one) as an override at the
            // run's scope - this project alone, every other project keeping it (plugins.overrideScope). A narrower
            // row outranks anything this run writes, and a managed one is the admin's: said, not done.
            const at = row.scope ? plugins.overrideScope(row.scope, ctx.cliScope) : ctx.cliScope;
            if (!at)
            {
                ctx.log(plugins.isManaged(row.scope) ? `  ${plugins.leftAt(spec, row.scope)} - not switched off`
                    : `  ${spec} is enabled at ${row.scope} scope, narrower than this run's ${ctx.cliScope} - it outranks anything written here; if nothing else needs it: claude plugin disable ${spec} --scope ${row.scope}`);
                continue;
            }
            if (isOn(spec, at) === false) continue;
            const here = at !== row.scope ? ` - this ${at === 'local' ? 'checkout' : 'project'} only, the ${row.scope}-scope install stays on ${row.scope === 'user' ? 'for every other project' : 'for everyone else'}` : '';
            if (ctx.cli(['plugin', 'disable', spec, '--scope', at], { quiet: true, expect: 'reported' })) ctx.log(`plugin disabled [${at}]: ${spec} (nothing kept needs it after --drop${here})`);
            else ctx.note(`plugin disable failed: ${spec} - disable it by hand: claude plugin disable ${spec} --scope ${at}`);
        }
        return;
    }
    standDown();
    plugins.installPlugins({
        plugins: set, scope: ctx.cliScope, scopes, marketplaces, before: listing, rows, fresh, refreshed: ctx.refreshed, release, cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
    hudLine();
}

// --forge-cli (init's forge ask, answered 'Install'): the CLI the origin's forge needs (forge-session.js cliPlan). Homebrew
// installs it on macOS - az then gains its devops extension, which its repos and pipelines groups live in; anywhere else,
// or with no Homebrew, the run names what to install by hand. Without the flag nothing is installed.
function forgeCliStep(ctx)
{
    if (!ctx.args.forgeCli) return;
    let plan;
    try
    {
        const fsn = require('../../stack/hooks/forge-session.js');
        plan = fsn.cliPlan(fsn.profile(ctx.projectRoot, { ...ctx.env, CLAUDE_PROJECT_DIR: ctx.projectRoot }), { platform: ctx.rt.platform || process.platform, hasBrew: Boolean(ctx.rt.which('brew', { env: ctx.env })) });
    }
    catch (err) { ctx.note(`forge CLI: the forge could not be read (${err.message}) - nothing installed`); return; }
    if (plan.action === 'none') return ctx.log('  forge CLI: none known for this forge - nothing installed');
    if (plan.action === 'present') return ctx.log(`  forge CLI: ${plan.cli} already on PATH`);
    if (plan.action === 'manual') return ctx.note(`forge CLI: ${plan.how}`);
    try
    {
        ctx.rt.execCommand('brew', ['install', plan.formula], { cwd: ctx.projectRoot, env: ctx.env, stdio: 'ignore' });
        if (plan.after) ctx.rt.execCommand(plan.after[0], plan.after.slice(1), { cwd: ctx.projectRoot, env: ctx.env, stdio: 'ignore' });
        ctx.log(`  forge CLI: ${plan.cli} installed (brew install ${plan.formula}${plan.after ? `, then ${plan.after.join(' ')}` : ''})`);
    }
    catch (err) { ctx.note(`forge CLI: brew install ${plan.formula} failed (${String(err.message).split('\n')[0]}) - ${plan.how}`); }
}

// M4 (R132): the one line for a listing the run could not read on the full copy route - the core row that would have been
// switched off, with its command, so its hooks never run beside the copies unsaid.
function blindStandDown(ctx)
{
    const at = plugins.standDownScope(ctx.cliScope);
    return `the plugin listing could not be read, so the core was not switched off before the copies land - if it is still enabled its hooks run beside them; check /plugin, or: claude plugin disable ${BRAND.core}@${ctx.market} --scope ${at}`;
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

// Whether `entry` registered under `name` launches the package a retired stack server ran or calls its url (mcp.identityOf,
// against meta/retired-plugins.json's `registration` rows) - read without a word; registrationOf below names a mismatch.
function stackIdentitiesOf(ctx)
{
    ctx.mcpIdentities ||= mcp.stackIdentities({ retiredRows: readRetiredPlugins(ctx.source.dir), renamed: ctx.manifest.renamed.mcps });
    return ctx.mcpIdentities;
}
function stackIdentity(ctx, name, entry)
{
    return (stackIdentitiesOf(ctx)[name] || new Set()).has(mcp.identityOf(entry));
}

// A-M2 / A-M3: 'stack' when `name` at `scope` is a registration of the stack's own shape (the package it
// launches, or the url it calls - mcp.identityOf), 'absent' when the scope holds none under the name (no
// call to make), 'foreign' when it is another server the user registered under the same name - kept and
// named once per run - and 'unreadable' when the file cannot be read, which removes nothing, said once.
function registrationOf(ctx, name, scope)
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
    if (stackIdentity(ctx, name, entry)) return 'stack';
    once(`${scope}:${name}`, `  mcp ${name}: the ${scope}-scope registration is not the stack's (another server under the same name) - kept; if it should go: claude mcp remove ${name} -s ${scope}`);
    ctx.mcpForeign.set(name, scope);
    return 'foreign';
}

// THE RETIRED SERVERS. The stack ships no MCP server since 2.10.1 and registers none; this step only takes out what an
// earlier release registered - a copy route's .mcp.json row, or its local- or user-scope one - at the run's own scope, on
// the first update past each retirement (mcp.dueRetired), and a name the 2.0.0 rename left behind on every run. Only the
// stack's own: at project scope the row the ledger recorded, unchanged; with no ledger, and at local and user scope, a
// registration launching the retired server's package or calling its url (A-M2). Anything else under the name is the
// user's - kept, named once with its remove command. The plugin rows go with the retired plugins (installPlugins).
function retireMcps(ctx)
{
    if (!ctx.hasClaude) return;
    const retired = mcp.retiredMcps({ authored: ctx.retiredMcpsDue, legacy: ctx.legacyMcps });
    const addBack = (name) => (readRetiredPlugins(ctx.source.dir).find((r) => r.name === name) || {}).addBack;
    const mayRemove = (name, scope) => registrationOf(ctx, name, scope) === 'stack';
    // R10: a .mcp.json entry goes only when the ledger recorded it and nobody changed it since - one it does not list, or
    // an edited one, is the user's, kept and said once. No ledger (an older stamp) or no entry: the rule above.
    const ledgerMcp = ctx.ledger && ctx.ledger.mcp;
    const mayPrune = (name, scope) =>
    {
        const entry = scope === 'project' && ledgerMcp ? registrationsAt(ctx, 'project').servers[name] : null;
        if (!entry) return mayRemove(name, scope);
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
    // F7 (R22g): a user-scope FULL copy route registered in THIS project's .mcp.json (C10), which the loop above never
    // reaches from a user-scope run - so the stack's own rows there go too. I-F7-1: never a bare `playwright` - its
    // identity is the package name only, so one in the file is the user's own (often a committed team file), and it keeps
    // its approval.
    if (ctx.cliScope === 'user')
    {
        const held = registrationsAt(ctx, 'project');
        if (held.servers.playwright) ctx.mcpForeign.set('playwright', 'project');
        const names = [...new Set([...retired, ...mcp.PW_SERVERS])].filter((name) => name !== 'playwright');
        // An unreadable file is said once (registrationOf's line) and nothing in it is removed.
        if (held.state === 'unreadable') registrationOf(ctx, names[0], 'project');
        for (const name of names)
            if (held.servers[name] && mayPrune(name, 'project')) prune(name, 'project');
    }
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
    pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), ctx.manifest.retired.hooks, 'hook', 'retired upstream', { keep: retiredKeep(ctx, 'hook', path.join(ctx.claudeDir, 'hooks')) });
    if (ctx.routes.hooks) pruneCopies(ctx, path.join(ctx.claudeDir, 'hooks'), catalogHooks.concat(HOOK_MODULES), 'hook', 'now carried by a plugin');

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
    const docsRoot = ctx.docsRoot || copy.resolveDocsRoot(ctx.projectRoot, ctx.args.scope);
    const ruleNames = ctx.lists.rules.map((f) => f.replace(/\.md$/, ''));
    const render = Object.fromEntries(ROOTED_RULES.map((name) => [`rules/${name}`, (text) => text.split('__DOCS_ROOT__').join(docsRoot)]));
    const rulesLibrary = library.copyLibrary({
        sourceDir: ctx.source.dir, rulesDir: path.join(ctx.claudeDir, 'rules'),
        rules: ruleNames,
        render,
        stamped: stampLayer.readLibrary(ctx.stampFile), claims: (kind, name) => kind !== 'rules' || ruleClaim(ctx)(name), log: ctx.log, note: ctx.note,
    });
    ctx.library.rules = rulesLibrary.rules;
    // After the new copies landed: a throw before this point leaves the old rules loading, never none.
    pruneCopies(ctx, path.join(ctx.claudeDir, 'rules'), ctx.manifest.retired.rules, 'rule', 'retired upstream', { keep: retiredKeep(ctx, 'rule', path.join(ctx.claudeDir, 'rules')) });
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
    const hookName = (e) => e.split('::')[0].replace(/\.js$/, '');
    const { hooksOff, hooksAnswered, agentDeny, agentAllow } = writable(state, {
        routes: ctx.routes, answered: ctx.answered,
        wired: ctx.routes.hooks ? null : [...new Set(ctx.lists.hooks.map(hookName))],
        shipped: [...new Set(ctx.manifest.catalogs.hooks.map(hookName))],
    });
    // T16/R47 (I1): at `local` scope the stack's own settings writes are machine-personal - they go
    // to settings.local.json, never the shared settings.json; every other scope keeps the shared
    // file. settingsTarget is the one helper every write site names.
    const localSettings = path.join(ctx.claudeDir, 'settings.local.json');
    const hadLocal = fs.existsSync(localSettings);
    const written = settings.writeSettings({
        // R10: the last run's ledger, and the wirings the RELEASE writes (none on the plugin route) - a
        // hook this run did not select keeps its wiring, one the release dropped loses it.
        ledger: { prior: ctx.ledger, releaseHooks: ctx.routes.hooks ? [] : ctx.manifest.catalogs.hooks, shippedDeny: [...new Set([...SHIPPED_DENY, ...memoryDenyShipped(ctx.source.dir), ...browserDenyShipped(ctx.source.dir)])] },
        file: settings.settingsTarget(ctx.claudeDir, ctx.args.scope),
        // A local-scope run leaves the stack's stale wiring and 1.x keys in settings.json - it removes them there.
        sharedFile: ctx.args.scope === 'local' ? path.join(ctx.claudeDir, 'settings.json') : null,
        catalog, migrations, hookSpecs: wired,
        denySpecs: SECRET_DENY, retiredDeny: RETIRED_DENY, agentDeny, agentAllow,
        // On the copy route a --drop'd hook is unwired like a retired one - the writer keeps a merely
        // unselected hook's entries on purpose, so the drop has to name it.
        retiredHooks: ctx.manifest.retired.hooks.concat(ctx.routes.hooks
            ? catalogHooks
            : (ctx.args.dropApplied || []).filter((l) => l.startsWith('hook ')).map((l) => `${l.slice(5)}.js`)),
        // `--auto-compact on|off`: setup's answer to 'offer a fresh session, or compact and go on?' (settings.js applyEnv 3d).
        autoCompact: ctx.args.autoCompact ? { value: ctx.args.autoCompact === 'on' ? '1' : '0' } : null,
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
        // No server is trusted: every name the stack ever registered leaves enabledMcpjsonServers - except one kept as the
        // user's own under that name, which keeps its approval (A-M3).
        mcpOff: [...ctx.manifest.retired.mcps, ...mcp.PW_SERVERS, ...ctx.legacyMcps].filter((n) => ctx.mcpForeign.get(n) !== 'project'),
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
        // the git preferences' no-attribution entry, enforced by the setting; at local scope settings.json's own value stays.
        attribution: { inherited: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).attribution : null },
        // R6: isolated seats branch from this HEAD; at local scope settings.json's own value stays.
        worktreeBase: { inherited: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }).worktree : null },
        // The per-model auto-compact window (settings.js compactWindowSeeds), in this project's own file at every scope (user
        // scope writes the project's settings.json too, never the account's). At local scope settings.json is the sibling it
        // never hides; the account file's own window outranks no project file, so a model it names is left to it.
        compactWindows: {
            models: readJson(path.join(ctx.source.dir, 'stack', 'hooks', 'model-windows.json')).models || {},
            inherited: ctx.args.scope === 'local' ? settings.readBackSettings(ctx.claudeDir, 'project', { sharedOnly: true }) : null,
            account: readJson(path.join(ctx.configDir, 'settings.json')),
        },
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
        ctx.log(`  !! settings.local.json: created for this machine's own values - git does not ignore it here; add ${path.relative(ctx.projectRoot, localSettings).split(path.sep).join('/')} to .gitignore`);
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
    // No run registers a server since 2.10.1: the .mcp.json and account rows are what an earlier run recorded and is still
    // there unchanged (retireMcps removes them on the first update past each retirement) - so a later run, or uninstall,
    // still knows them for the stack's.
    const servers = mcp.registrationsAt({ scope: 'project', mcpFile: ctx.mcpFile, projectRoot: ctx.projectRoot }).servers;
    const mcpAt = {};
    for (const scope of ['local', 'user'])
    {
        const regs = mcp.registrationsAt({ scope, accountFile: ctx.accountFile, projectRoot: ctx.projectRoot });
        const was = (prior.mcpAt || {})[scope] || {};
        const now = regs.state === 'unreadable' ? { ...was } : mcp.managedMcp({ servers: regs.servers, prior: was, written: [] });
        if (Object.keys(now).length) mcpAt[scope] = now;
    }
    return {
        env, deny: part.deny, hooks: part.hooks,
        // Delta F-UNREAD: a .mcp.json that cannot be read holds no evidence, so its ledger rows stand as the last run recorded them.
        mcp: registrationsAt(ctx, 'project').state === 'unreadable' && prior.mcp ? { ...prior.mcp } : mcp.managedMcp({ servers, prior: prior.mcp || null, written: [], adopt: (name, entry) => stackShaped(ctx, name, entry) }),
        mcpAt,
        files: managedFiles(ctx),
        settings: settingsKeys,
    };
}

// The fallback's evidence for a .mcp.json entry with no ledger to read: a name the stack registered (every one is retired
// now) in the stack's own shape - the package it launches or the url it calls (mcp.identityOf).
function stackShaped(ctx, name, entry)
{
    const names = new Set([...mcp.PW_SERVERS, ...ctx.manifest.retired.mcps, ...ctx.legacyMcps]);
    return names.has(name) && stackIdentity(ctx, name, entry);
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
    // An AGENTS.md this run seeded (or moved from its 2.1.6 CLAUDE.md name) is the template's until init fills it in - from then on it is the project's.
    if (ctx.stackAgentsMd) put('AGENTS.md', ledgerPath(ctx, 'AGENTS.md'));
    // No ledger to read (an older stamp): an AGENTS.md still byte for byte the seed is the stack's.
    const agentsMd = path.join(ctx.claudeDir, 'AGENTS.md');
    if (!(ctx.ledger && ctx.ledger.files) && !out['AGENTS.md'] && fs.existsSync(agentsMd)
        && readOrNull(agentsMd) === seeds.agentsMdBody({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir })) put('AGENTS.md', agentsMd);
    // A recorded file this run cannot read holds no evidence either way, so its row stands as the last run recorded it -
    // the settings rule (an unreadable file keeps its rows); hashing it threw and failed the whole run at its last step.
    for (const [rel, h] of Object.entries((ctx.ledger && ctx.ledger.files) || {}))
    {
        if (out[rel]) continue;
        let now;
        try { now = library.hashItem(ledgerPath(ctx, rel)); }
        catch { out[rel] = h; continue; }
        if (now === h || (ctx.respelledSeeds && ctx.respelledSeeds.has(rel))) out[rel] = now;
    }
    return out;
}
function readOrNull(file)
{
    try { return fs.readFileSync(file, 'utf8'); }
    catch { return null; }
}

// The AGENTS.md row is read where the seed sits, under the install's name - .claude/, or the root on --instructions-at root
// (seeds.seededAgentsMdPath).
const ledgerPath = (ctx, rel) => (rel === 'AGENTS.md' ? ctx.seedFile || seeds.seededAgentsMdPath(ctx.projectRoot, ctx.instructionsKind)
    : rel.startsWith('skills/') ? path.join(ctx.skillsDir, rel.slice(7)) : path.join(ctx.claudeDir, ...rel.split('/')));

// R10: a copy the last run recorded that this RELEASE no longer ships at all goes - when it still holds
// what the stack wrote; an edited one is the user's and stays, said. The `retired` lists prune under the
// same record test (`retiredKeep`).
function pruneDroppedCopies(ctx)
{
    const files = (ctx.ledger && ctx.ledger.files) || {};
    if (!Object.keys(files).length) return;
    const shipped = new Set([
        ...[...new Set(ctx.manifest.catalogs.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, HOOK_MODULES).map((f) => `hooks/${f}`),
        ...ctx.manifest.catalogs.skills.map((e) => `skills/${e.split('|').pop()}`),
        ...ctx.manifest.agents.map((a) => `agents/${a}`), 'AGENTS.md',
    ]);
    for (const [rel, h] of Object.entries(files))
    {
        if (shipped.has(rel)) continue;
        // The 2.1.6 seed's name: the move step already said where it went, or why it stayed - it is never pruned.
        if (rel === 'CLAUDE.md') continue;
        const at = ledgerPath(ctx, rel);
        const now = library.hashItem(at);
        if (!now) continue;
        if (rel === NAV_CONTEXT)
        {
            // No registration names it any more: the stack ships no navigation server since 2.10.1.
            if (now !== h) ctx.log(`  ${rel}: kept - the stack copied it for a navigation registration no release writes now, but it was changed since, so it is yours`);
            else { fs.rmSync(at, { force: true }); ctx.log(`  ${rel} removed - no navigation registration names it now`); }
            continue;
        }
        if (now !== h) { ctx.log(`  ${rel}: kept - the stack copied it and this release no longer ships it, but it was changed since, so it is yours`); continue; }
        if (/^(skills|agents)\//.test(rel) && gitTracks(ctx, at)) { ctx.log(`  ${rel}: kept - the stack copied it and this release no longer ships it, but git tracks it here, so it is yours`); continue; }
        fs.rmSync(at, { recursive: true, force: true });
        ctx.log(`  ${rel} removed - the stack copied it and this release no longer ships it`);
    }
}

// THE UNINSTALL ORDER (uninstall.js holds the decisions): plugin rows, then .mcp.json and the local- and
// user-scope registrations, then the settings entries, then the copies, then the stamp - last, and only
// when nothing failed.
function runUninstall({ projectRoot, claudeDir, configDir, accountFile, accountUnread, backupDirs, env, hasClaude, claudeBroken, cli, readRaw, readMarkets, instructionsSeed = '', log, note, err, failures })
{
    const file = stampLayer.stampFiles({ projectRoot }).read;
    const raw = stampLayer.readStampScope(file).toLowerCase();
    const scope = raw === 'global' ? 'user' : ENUMS.scope.values.includes(raw) ? raw : 'project';
    const ledger = stampLayer.readLedger(file);
    log(`action: uninstall [scope=${scope}, account=${configDir}]`);
    // Review finding 3: a listing that did not answer is no empty list - acted on, it removes no plugin
    // row and then deletes the stamp that lists them. Refused before any change, so a retry finishes.
    const before = new Set(mcp.accountBackups(backupDirs).map((b) => b.file));
    const rawList = hasClaude ? readRaw() : '';
    // Review 2.1.6 m3: the stack's local- and user-scope registrations live in the account file, and a claude call that
    // met it corrupt - this listing read, or a command's source step before the installer - moved them into the CLI's
    // backup. Removing nothing and deleting the stamp would leave them with no record once a copy is put back, so the run
    // refuses before any change, naming the backup: the account file unreadable at its start, or replaced since the stamp
    // - and in both, only while it holds none of the registrations the ledger records (re-verify N1: a copy put back, as
    // the CLI's own notice advises, ends the refusal).
    const made = accountUnread ? mcp.accountBackups(backupDirs).filter((b) => !before.has(b.file)).pop() : null;
    const noneHeld = (at, rows) => { const held = mcp.registrationsAt({ scope: at, accountFile, projectRoot }).servers; return !Object.keys(rows).some((n) => Object.hasOwn(held, n)); };
    const stamped = stampLayer.readInstalledAt(file);
    const lostAt = Object.entries(ledger.mcpAt || {}).filter(([at, rows]) => Object.keys(rows).length && noneHeld(at, rows))
        .map(([at, rows]) => [at, mcp.accountLoss({ backups: mcp.accountBackups(backupDirs), stamped, recorded: rows, held: {}, entry: false })])
        .filter(([, loss]) => loss.backup);
    const backup = made ? made.file : lostAt.length ? lostAt[0][1].backup : '';
    const lostLine = () =>
    {
        const at = Number((/\.(\d+)$/.exec(backup) || [])[1]);
        const good = mcp.accountBackups(backupDirs, 'good').filter((b) => b.ms < at).pop();
        err(`error: ${accountFile} ${made ? 'could not be read' : 'was replaced since the last run'} - the claude CLI kept the old one as ${backup}, and the stack's local- and user-scope registrations are in it; nothing was removed - put a whole copy back over ${accountFile} (that one fixed${good ? `, or the CLI's last good copy ${good.file}` : ''}), or run /alfred-code:update, which registers them again, then run uninstall again\n`);
    };
    if (hasClaude && !listingRead(rawList))
    {
        err('error: `claude plugin list --json` did not answer with a plugin listing, so the stack\'s plugin rows cannot be told apart - nothing was removed; fix what that command prints, then run uninstall again\n');
        if (backup) lostLine();
        return 1;
    }
    if (backup) { lostLine(); return 1; }
    if (hasClaude)
    {
        const market = marketOf({ listing: plugins.parsePluginList(rawList, projectRoot, { byMarketplace: true }), marketplaces: readMarkets(), env }).key;
        const manifest = loadManifest(path.join(__dirname, '..', '..'));
        uninstallLayer.removePlugins({
            rows: plugins.parsePluginList(rawList, projectRoot, { everyScope: true }), market, scope,
            thirdParty: [...manifest.catalogs.plugins, ...CORE_DEP_PLUGINS], cli, log, note,
        });
        // Never the bare form: with no --scope the CLI removes the declaration from EVERY scope and uninstalls every
        // plugin installed from it (a session ran it and lost four plugins other projects used - 2026-10-06 report).
        log(`  the marketplace registration is the account's, kept for other projects: claude plugin marketplace remove ${market} --scope user (once no project uses it - without --scope it is removed at every scope and every plugin installed from it goes too)`);
    }
    else if (!claudeBroken) note('the claude CLI is not on PATH - no plugin row was removed; run uninstall again where it is');
    const { removed } = mcp.removeManagedMcp({ mcpFile: path.join(projectRoot, '.mcp.json'), managed: ledger.mcp || {}, log, note });
    uninstallLayer.removeScopedMcp({
        mcpAt: ledger.mcpAt || {}, cli, log, note,
        readAt: (scope) => mcp.registrationsAt({ scope, accountFile, projectRoot }),
    });
    // The deniedMcpServers entries the stack wrote to switch a broader-scope server off here (the stamp's mcp-denied:
    // line) go with it - a row of the user's own shape stays.
    for (const at of ['local', 'project'])
    {
        const names = stampLayer.readMcpDenied(file).filter((e) => e.scope === at).map((e) => e.name);
        if (names.length) settings.applyMcpDeny({ file: path.join(claudeDir, at === 'local' ? 'settings.local.json' : 'settings.json'), lift: names, log, note });
    }
    // M4: read before the settings pass removes ALFRED_CODE_DATA_PATH - the stamp's record first.
    const keptRoot = stampLayer.readDataLines(file).root || dataRoot.dataRootOf({ env: {}, projectDir: projectRoot }).root;
    settings.removeManagedSettings({ claudeDir, ledger, shippedDeny: SHIPPED_DENY, mcpRemoved: removed, scope, log, note });
    uninstallLayer.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), library: stampLayer.readLibrary(file) || {}, files: ledger.files || {}, instructionsKind: stampLayer.readInstructionsFile(file), seed: instructionsSeed, log });
    toolIgnoresLayer.removeToolIgnores({ projectRoot, record: stampLayer.readToolIgnores(file), log, note });
    const memoryOff = ['settings.json', 'settings.local.json'].some((n) => readJson(path.join(claudeDir, n)).autoMemoryEnabled === false);
    log(`  kept, yours or your data: the instruction file (AGENTS.md or CLAUDE.md) if you filled it in or kept it, the data root (the docs, the navigation index, the browser profiles - ${keptRoot}/, or a 2.0.0 .serena/ / .playwright/), the memory database${memoryOff ? '; autoMemoryEnabled: false stays - Claude\'s own memory is off until you remove that key' : ''}`);
    if (failures()) { log(`  stamp kept - ${path.basename(file)} still lists what is left; run uninstall again to finish`); return 0; }
    fs.rmSync(file, { force: true });
    log(`  stamp removed: ${path.basename(file)} - every item the ledger listed is gone, or named above as kept`);
    try { if (!fs.readdirSync(claudeDir).length) fs.rmdirSync(claudeDir); } catch { /* the project's own .claude stays */ }
    return 0;
}

function summarise(ctx, failures)
{
    const hookFiles = new Set(ctx.lists.hooks.map((e) => e.split('::')[0]));
    let line = `  installed/refreshed this run - skills=${ctx.lists.skills.length}, plugins=${ctx.lists.plugins.length}`
        + `, hooks=${hookFiles.size}, agents=${ctx.lists.agents.length}, rules=${ctx.lists.rules.length}`;
    line += ctx.args.keepPins ? '; keep-pins=on' : '; keep-pins=off (agent model/effort pins reset to catalog defaults)';
    ctx.log(line);
    if (failures) ctx.log(`  ${failures} step(s) reported a failure above - the rest of the run completed`);
}

// --- small readers ---------------------------------------------------------

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
    // project's items - another install's are not ours.
    const ours = (name) => Boolean(place.plugins[name]) && routes.skills;
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

// A path inside the project as the project-relative path it is (forward slashes), '' for one outside it. Compared by real
// path through the nearest folder that exists - a database not created yet under a symlinked root (macOS /var -> /private/var)
// still reads as inside, never as a '../..' climb (re-verify 2 R3).
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
    });
    const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stack-sel-')), 'selection.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const entries = ctx.rt.runNode(script, ['--selection', file, '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    if (!entries.ok) throw new Error(`plugin set not computed (${entries.stderr.split('\n')[0]})`);
    const copyList = ctx.rt.runNode(script, ['--selection', file, '--copy', '--marketplace', ctx.market], { cwd: ctx.projectRoot, env: ctx.env });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return { entries: ctx.rt.lines(entries.stdout), copy: ctx.rt.lines(copyList.stdout) };
}

if (require.main === module)
{
    require('../../stack/hooks/hook-prelude.js').blockingStdio();
    process.exitCode = main(process.argv.slice(2), process.env, {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
    });
}

module.exports = { main, USAGE, CORE_DEP_PLUGINS, HOOK_ENGINES, HOOK_MODULES, forgeCliStep, SECRET_DENY, RETIRED_DENY, SHIPPED_DENY, BROWSER_TOOLS_OFF };
