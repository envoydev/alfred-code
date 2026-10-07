'use strict';
// THE PLUGIN LAYER - what this run enables, at which scope, and what it takes back out.
//
// From Phase 3 onward the plugins ARE the delivery: the skills, agents, hooks and (Phase 6) MCP
// servers all arrive through the project's own closure, and the copy route is the escape hatch.
// So the decisions here are the install.
//
// Five rules, each one measured:
//
//   - THE CLOSURE IS COMPUTED ONCE, by `selection-plugins.js`, and it is fed skill/agent lines only
//     when the skills route is on and mcp lines only when the MCP route is. Whatever comes back is
//     exactly what this combination of routes needs enabled.
//   - A FAILURE TO COMPUTE IT DROPS BOTH ROUTES TO COPY, together and loudly. Half a closure would
//     leave a project with neither the plugin's copy of an item nor its own.
//   - `claude plugin update` IS A NO-OP ON A PLUGIN THAT IS NOT INSTALLED, and says nothing about
//     one that is installed but DISABLED. So update must install an absent plugin and enable a
//     parked one BEFORE it updates - measured: two added plugins still `disabled` after a run,
//     recovered by hand over eight messages and ~1.05M of context.
//   - THE PLUGIN'S OWN SCOPE WINS on update, read from the listing: `claude plugin update --scope
//     <other>` is a silent no-op, so passing the INSTALL's scope left every user-scoped plugin on
//     its old version under a project install.
//   - VERSIONS ARE READ BACK. `claude plugin update` reports success whether or not anything moved.
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const { BRAND, alwaysOn, marketOf, marketKey } = require('./brand.js');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

// 2.2.0: no plugin is pinned to a scope any more - each OPTIONAL item (a browser engine, a desktop server, an
// LSP, claude-hud) goes where the user chose it (`--scope-of`, `itemScope` below), the required ones follow the
// run. Kept as a name for the callers that still read it.
const USER_SCOPE_PLUGINS = [];
// claude-hud: the user's OFF wins. A user who disabled it keeps it off. Measured on Claude Code 2.1.282: `plugin update` over a user-disabled
// claude-hud leaves `enabledPlugins` false, `plugin install --scope user -y` flips it back to true - so
// a listed, disabled one is only ever updated, never enabled or re-installed. An absent one is installed.
const USER_OFF_WINS = ['claude-hud'];
const offByUser = (spec, listing) => USER_OFF_WINS.includes(bareName(spec)) && fieldOf(listing, spec, 'enabled') === false;

const OFFICIAL_MARKETPLACE = 'anthropics/claude-plugins-official';
const STACK_MARKETPLACE = BRAND.slug;
// The FRESH-install spelling. An install keeps the marketplace key it was registered under, which the
// run resolves (brand.js marketKey) and spells every stack spec with - never this constant.
const CORE_SPEC = `${BRAND.core}@${BRAND.marketplace}`;

// The plugins every install carries beside the core from ANOTHER marketplace - required, never a pick
// (R27). None since 2.2.0: claude-hud is an optional pick, recommended (meta/recommendations.json
// always.plugins), the user's ruling of 2026-10-06 - only the core and the three alfred- servers are required.
// Never a `dependencies` entry of the core either: `claude plugin update` over an older core installs none a
// release adds, and a plugin missing one is disabled at load, its commands with it (measured on 2.1.280).
const CORE_DEP_PLUGINS = [];
const HUD_SPEC = 'claude-hud@claude-hud';

// `...=false` restores the copy route - the documented contract, and the only value either twin
// ever promised. (The sh twin read anything but the literal 'true' as off and the ps1 anything but
// 'false' as on; on every documented value they agree, and this takes the documented reading.)
const pluginRoutes = (env = {}) => ({
    hooks: envOf(env, 'HOOKS_VIA_PLUGIN') !== 'false',
    skills: envOf(env, 'SKILLS_VIA_PLUGIN') !== 'false',
    mcps: envOf(env, 'MCPS_VIA_PLUGIN') !== 'false',
});

const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills || routes.mcps);

// C5 (R101 N6, widened by final review A): at project and user scope the routes decide COMMITTED state -
// the hooks wired in settings.json, the core switched off there on the full copy route. Claude Code puts
// settings.local.json's env into every process it starts, so a switch the runner holds there reaches
// this run looking like a deliberate one. Where the run's value IS the local file's and settings.json
// says otherwise, settings.json decides (unset = the plugin route), with one line. A shell export the
// local file does not hold is the invocation's own and stands; at local scope the local file is the
// install's own settings, so the run's value stands there too.
function committedRoutes({ env = {}, shared = {}, personal = {}, scope, log = () => {} })
{
    const routes = pluginRoutes(env);
    if (scope === 'local') return routes;
    for (const [route, suffix] of [['hooks', 'HOOKS_VIA_PLUGIN'], ['skills', 'SKILLS_VIA_PLUGIN'], ['mcps', 'MCPS_VIA_PLUGIN']])
    {
        const run = envOf(env, suffix);
        if (run === undefined || run === '' || run !== envOf(personal || {}, suffix)) continue;
        const committed = envOf(shared || {}, suffix);
        if (committed === run) continue;
        routes[route] = committed !== 'false';
        log(`routes: ALFRED_CODE_${suffix}=${run} comes from settings.local.json - personal, so this ${scope}-scope run follows settings.json (${committed === undefined || committed === '' ? 'unset' : committed}${routes[route] ? ' - the plugin route' : ' - the copy route'})`);
    }
    return routes;
}

// The same routes read from a project's own `.claude/` - settings.json is the shared env, settings.local.json
// the personal one (an unreadable file reads as empty). N6: the installer, setup's derivation
// (derive-state.js) and update's new-item classification (update-preflight.js) all read them here.
function committedRoutesAt({ env = {}, claudeDir, scope = 'project', log = () => {} })
{
    const envIn = (name) =>
    {
        try { const e = parseJson(fs.readFileSync(path.join(claudeDir, name), 'utf8')).env; return e && typeof e === 'object' && !Array.isArray(e) ? e : {}; }
        catch { return {}; }
    };
    return committedRoutes({ env, shared: envIn('settings.json'), personal: envIn('settings.local.json'), scope, log });
}

// `claude plugin list --json` -> one row per plugin NAME. A row carrying a projectPath belongs to
// that project and is dropped unless it is this one; where both exist, THIS project's row wins over
// the account-level one. Anything unparseable is an empty listing, never a crash: the callers all
// treat 'the listing cannot say' as a real answer. `marketplace` keeps only that marketplace's rows,
// BEFORE the per-name pick: the official marketplace ships plugins named like stack entries
// (`serena`, `sentry`, `playwright`), and a name-only read took theirs for ours. `byMarketplace`
// keeps one row per name@marketplace instead, for a pass whose specs come from several, read through
// `fieldOf` with the full spec. `everyScope` keeps one per name@marketplace@scope: the same plugin at
// the account and in this project is two installs, and a migration moves only its own scope's.
// A Windows drive path is compared case-blind: the file system is, and the listing's projectPath can
// spell the drive or a folder unlike git's root (`c:\WINDOWS` against `C:\Windows`) - a case-exact
// compare dropped this project's rows, and uninstall then left them behind without a word.
const projectKey = (p) => (/^[A-Za-z]:[\\/]/.test(p) ? path.win32.resolve(p).toLowerCase() : path.resolve(p));

function parsePluginList(json, projectRoot, { marketplace, byMarketplace = false, everyScope = false } = {})
{
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return []; }
    const rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : []);
    const here = projectKey(projectRoot || '.');
    const best = new Map();
    for (const row of rows)
    {
        if (!row || typeof row !== 'object') continue;
        const [name, market = ''] = String(row.id ?? '').split('@');
        if (!name) continue;
        if (marketplace && market !== marketplace) continue;
        const pp = row.projectPath;
        if (pp && projectKey(String(pp)) !== here) continue;
        const rank = pp ? 0 : 1;                      // this project first, then the account rows
        const key = everyScope ? `${name}@${market}@${row.scope ?? ''}` : byMarketplace ? `${name}@${market}` : name;
        const prev = best.get(key);
        if (prev && prev.rank <= rank) continue;
        best.set(key, {
            rank, name, marketplace: market,
            version: String(row.version ?? '?'),
            scope: String(row.scope ?? ''),
            enabled: row.enabled !== false,
        });
    }
    return [...best.values()].map(({ rank, ...row }) => row);
}

// `name` alone, or a full `name@marketplace` spec - which never matches another marketplace's row of
// the same name (the official `serena`, `sentry`, `playwright`). A row that names no marketplace
// matches either way.
const fieldOf = (listing, name, key) =>
{
    const [bare, market] = String(name).split('@');
    const row = (listing || []).find((r) => r.name === bare && (!market || !r.marketplace || r.marketplace === market));
    return row ? row[key] : undefined;
};

const bareName = (spec) => String(spec).split('@')[0];

// 2.2.0: an optional item's own scope, the user's choice (`--scope-of`): `user` is every project on the account,
// `project` this project at the run's own scope - `project` itself when the run is a user-scope one. '' when the
// user made no choice for it.
function itemScope(spec, installScope, scopes = {})
{
    const chosen = (scopes || {})[bareName(spec)];
    if (chosen === 'user') return 'user';
    if (chosen === 'project') return installScope === 'user' ? 'project' : installScope;
    return '';
}

// The optional items that carry a scope of their own (args.js SCOPED_ITEMS): the browser engines, the desktop
// servers, the LSP pair and claude-hud. The core and the three alfred- servers follow the run.
const scopedItem = (spec) => require('./args.js').SCOPED_ITEMS.includes(bareName(spec));

// Install scope for one plugin: where the LISTING says it lives (an existing install is kept where it is - only
// configure's choice moves it, `moveScoped`), else the user's choice for it, else the run's scope - an optional
// item on a user-scope run lands in this project, since 'global' is only ever chosen per item.
function scopeFor(spec, installScope, listing, scopes = {})
{
    const known = fieldOf(listing, spec, 'scope');
    if (known) return known;
    return itemScope(spec, installScope, scopes) || (installScope === 'user' && scopedItem(spec) ? 'project' : installScope);
}

// 2.2.0: an optional item the user gave a scope (`--scope-of`) that is installed at ANOTHER scope moves there -
// installed at the chosen scope first, so a failed install leaves the old row serving, then the old row
// uninstalled. Leaving `user` takes the item from every other project on the account, said in one `!!` line with
// the command that puts it back; a project or local row is this project's alone. An engine or desktop server left
// off keeps its off-state. A row of another project never shows here (parsePluginList drops it). Returns the specs
// installed this run and the moves, so the passes after it read each at its new scope.
function moveScoped({ plugins = [], rows = [], scope, scopes = {}, engines = [], isOn = () => undefined, cli, log = () => {}, note = () => {} })
{
    const moved = [];
    for (const spec of plugins)
    {
        const target = itemScope(spec, scope, scopes);
        if (!target) continue;
        const [name, market] = String(spec).split('@');
        const mine = rows.filter((r) => r.name === name && r.marketplace === market && r.version);
        const away = mine.filter((r) => r.scope && r.scope !== target);
        if (!away.length) continue;
        const wasOn = away.some((r) => { const said = isOn(spec, r.scope); return said === undefined ? r.enabled !== false : said; });
        if (!mine.some((r) => r.scope === target))
        {
            if (!cli(['plugin', 'install', spec, '--scope', target, '-y'], { quiet: true, expect: 'reported' }))
            {
                note(`plugin move failed: ${spec} - it stays at ${away.map((r) => r.scope).join(', ')} scope; to move it: claude plugin install ${spec} --scope ${target}, then claude plugin uninstall ${spec} --scope ${away[0].scope}`);
                continue;
            }
            if (engines.includes(spec) && !wasOn) switchOff(spec, target, { cli, log, note });
        }
        for (const r of away)
        {
            if (!cli(['plugin', 'uninstall', spec, '--scope', r.scope, '-y'], { quiet: true, expect: 'reported' }))
            { note(`plugin uninstall failed: ${spec} at ${r.scope} scope - it stays there beside the ${target}-scope install; remove it by hand: claude plugin uninstall ${spec} --scope ${r.scope}`); continue; }
            log(r.scope === 'user'
                ? `  !! plugin moved [user -> ${target}]: ${spec} - every other project on this account loses it; to keep it there too: claude plugin install ${spec} --scope user`
                : `plugin moved [${r.scope} -> ${target}]: ${spec} (your choice of scope)`);
        }
        moved.push({ spec, scope: target });
    }
    return moved;
}

// The stack's own closure for this run. Returns the entries to enable, the library items copied, and
// the routes as they stand AFTER any fallback - the caller reads those, never the env again.
function resolveStackPlugins({ routes, selection, runSelection, log = () => {} })
{
    if (!routes.skills && !routes.mcps) return { entries: [], extraSkills: [], extraAgents: [], routes };

    let out;
    try { out = runSelection(selection); }
    catch (err)
    {
        const next = { ...routes, skills: false, mcps: false };
        log(`  !! ${err.message} - skills, agents and MCP servers stay on the copy route`);
        return { entries: [], extraSkills: [], extraAgents: [], routes: next };
    }

    const entries = (out.entries || []).filter(Boolean);
    const extraSkills = [];
    const extraAgents = [];
    for (const line of out.copy || [])
    {
        if (line.startsWith('skill ')) extraSkills.push(line.slice(6));
        else if (line.startsWith('agent ')) extraAgents.push(line.slice(6));
    }
    log(`plugins carry ${entries.length} entr(ies); library copied: ${extraSkills.length} skill(s), ${extraAgents.length} agent(s)`);
    return { entries, extraSkills, extraAgents, routes };
}

// The SELECTION lines `selection-plugins.js` reads, built from what each route actually needs.
function selectionLines({ routes, skills = [], agents = [], mcps = [] })
{
    const lines = [];
    if (routes.skills)
    {
        for (const s of skills) lines.push(`skill ${typeof s === 'string' ? s.split('|').pop() : s.name}`);
        for (const a of agents) lines.push(`agent ${String(typeof a === 'string' ? a.split('::')[0] : a.file).replace(/\.md$/, '')}`);
    }
    if (routes.mcps)
    {
        for (const m of mcps) lines.push(`mcp ${typeof m === 'string' ? m.split('|')[0] : m.name}`);
    }
    return lines;
}

// Everything this run hands to `claude plugin install`, in order: the third-party picks, then the
// stack's own entries (the core first, so the hooks it carries resolve in the same run that prunes
// the copied hooks they replace), then the core's companions. The hooks ride the CORE (2.0.0, 'Fold
// into core') whenever it is on - the selection names it on the skills and MCP routes, and the hooks
// route alone puts it here. While the core is on, the locked servers ride as plugins: the selection
// names them on the MCP route, and any it did not name join here. `coreDeps` join on every route -
// on the full copy route nothing else would bring them either.
function pluginSet({ routes, thirdParty = [], stackEntries = [], coreDeps = [], locked = [], market = BRAND.marketplace })
{
    const stack = [];
    if (corePluginOn(routes))
    {
        if (!stackEntries.some((spec) => bareName(spec) === BRAND.core)) stack.push(`${BRAND.core}@${market}`);
        stack.push(...stackEntries);
        for (const name of locked)
            if (!stack.some((spec) => bareName(spec) === name)) stack.push(`${name}@${market}`);
    }
    return [...thirdParty, ...stack, ...coreDeps];
}

// Every run installs the LATEST. `plugin install name@mp` refreshes its own marketplace, but it never
// moves a plugin that is already installed, and `plugin update` reads the local catalog as it stands
// (code.claude.com/docs/en/discover-plugins, 'Install plugins'; a third-party marketplace, this one
// included, has auto-update OFF by default) - so each marketplace the run's specs name is refreshed
// here, once per run: `refreshed` carries the names an earlier pass already did.
function refreshMarketplaces({ plugins, cli, refreshed = new Set() })
{
    for (const spec of plugins)
    {
        const mp = String(spec).split('@')[1];
        if (!mp || refreshed.has(mp)) continue;
        cli(['plugin', 'marketplace', 'update', mp], { quiet: true });
        refreshed.add(mp);
    }
}

// THE STACK'S MARKETPLACE KEY for this run. An install keeps the key it was registered under, and a
// second registration of the slug would list the stack twice - so the add runs only where the key is
// the current one: a no-op when it is registered already, the registration on a fresh account, whose
// key is then whatever the add actually produced (read back).
function stackMarket({ listing = [], marketplaces = [], readMarketplaces, cli, env = {} })
{
    const found = marketOf({ listing, marketplaces, env });
    if (found.key !== BRAND.marketplace) return found.key;
    // A registration under the key already - GitHub's, or a local or fork directory the user added (F1: the CLI
    // refuses a GitHub add over a directory of the same name and the run ended on a failure line).
    if ((Array.isArray(marketplaces) ? marketplaces : []).some((m) => m && m.name === BRAND.marketplace)) return found.key;
    cli(['plugin', 'marketplace', 'add', STACK_MARKETPLACE], { quiet: true });
    if (found.known || !readMarketplaces) return found.key;
    return marketKey({ listing, marketplaces: readMarketplaces(), env });
}

// Before the run reads its snapshot: the snapshot IS the newest core entry in the plugin cache, and
// only `plugin update` puts a newer one there - a refreshed catalog alone leaves the cache where it
// was, so the run would install the release it is replacing. EVERY installed stack entry, not the
// core alone: Claude Code launches an entry as the marketplace clone declares it (measured,
// docs/uv-python-pin-evidence.md), so after this refresh an entry left on its older version can name
// a file that version does not carry - and a run that stops at a question never reaches the apply
// step that would update it. Each at its OWN scope, because `plugin update --scope <other>` is a
// silent no-op. `listing` may be a function, read once.
// Returns the marketplace key the run uses.
function refreshStackSource({ listing = [], marketplaces = [], readMarketplaces, cli, refreshed = new Set(), log = () => {}, env = {} })
{
    const rows = (typeof listing === 'function' ? listing() : listing) || [];
    const market = stackMarket({ listing: rows, marketplaces, readMarketplaces, cli, env });
    refreshMarketplaces({ plugins: [`${BRAND.core}@${market}`], cli, refreshed });
    for (const row of rows)
    {
        if (row.marketplace !== market || !row.version || !row.scope) continue;
        log(`plugin update [${row.scope}]: ${row.name}@${market} (before the snapshot is read)`);
        cli(['plugin', 'update', `${row.name}@${market}`, '--scope', row.scope, '-y'], { quiet: true });
    }
    return market;
}

// THE PLAYWRIGHT ENGINES (R67): which to install and which of those to enable are both the user's
// answers. `engines` carries them for one run: `specs` (the engines in the set), `present` (the ones
// the stamp or the settings name as installed, for a listing the run could not read, with
// `presentScope` naming where each lives when that is not this run's scope), `off` (the ones an install this
// run makes is switched off after), `on` (the user's answer to APPLY to engines already installed, or
// null - no answer, nothing flipped) and `isOn(spec, scope)` (the settings file's word, or undefined).
const NO_ENGINES = { specs: [], present: [], presentScope: {}, off: [], on: null, isOn: () => undefined };
const enginePresent = (spec, before, engines) => engines.specs.includes(spec)
    && Boolean(fieldOf(before, spec, 'version') || engines.present.includes(spec));

// An engine the user chose not to enable. The CLI has no disabled install, so the install is followed
// by a disable at the SAME scope; a disable that fails leaves the engine on and says how to finish.
function switchOff(spec, scope, { cli, log, note })
{
    if (cli(['plugin', 'disable', spec, '--scope', scope], { quiet: true, expect: 'reported' })) log(`plugin disabled [${scope}]: ${spec} (installed, left off as picked - /plugin turns it on)`);
    else note(`plugin disable failed: ${spec} - it stays enabled; disable it by hand: claude plugin disable ${spec} --scope ${scope}`);
}

// An engine already installed NEVER gets the install verb: over one, `install` turns a disabled
// engine back on, or adds an enabled project install beside a user-scope one (docs/plugin-cli-evidence.md
// S28). It is updated at its own scope, and switched only to the user's answer - at this run's scope
// only, since one at another scope is every project's install there. A switch the settings file shows
// already made is skipped: a no-op enable or disable exits 1 (S28), which would read as a failure.
function engineInPlace(spec, { scope, scopes = {}, before, engines, cli, log, note })
{
    const at = fieldOf(before, spec, 'version') ? scopeFor(spec, scope, before, scopes) : ((engines.presentScope || {})[spec] || scopeFor(spec, scope, [], scopes));
    log(`plugin update [${at}]: ${spec}`);
    cli(['plugin', 'update', spec, '--scope', at, '-y']);
    if (!engines.on) return;
    const want = engines.on.includes(spec);
    const verb = want ? 'enable' : 'disable';
    if (at !== scope) { log(`  ${spec} is installed at ${at} scope, not this run's - not switched there, it is every project's install; to switch it: claude plugin ${verb} ${spec} --scope ${at}`); return; }
    if (engines.isOn(spec, at) === want) return;
    if (cli(['plugin', verb, spec, '--scope', at], { quiet: true, expect: 'reported' })) log(`plugin ${verb}d [${at}]: ${spec} (as picked - /plugin toggles it)`);
    else note(`plugin ${verb} failed: ${spec} - ${verb} it by hand: claude plugin ${verb} ${spec} --scope ${at}`);
}

// The engines the last install installed and this run no longer keeps (a narrower
// --browsers, a --drop of mcp browser): each is uninstalled at this run's scope by its
// full spec, or it reads back as installed and the next update keeps it again. One at another scope is
// every project's install there - it stays and the command is named. On a listing the run could not
// read (`blind`) the uninstall is tried at this run's scope, and a refusal most likely means the
// engine is gone already - said with the command, never counted as a failure. `rows` holds every scope
// (`parsePluginList` everyScope). Returns the specs uninstalled.
function uninstallEngines({ specs = [], rows = [], blind = false, scope, cli, log = () => {}, note = () => {} })
{
    const gone = [];
    const drop = (spec) =>
    {
        const ok = cli(['plugin', 'uninstall', spec, '--scope', scope, '-y'], { quiet: true, expect: 'reported' });
        if (ok) { log(`plugin uninstalled [${scope}]: ${spec} (no longer picked)`); gone.push(spec); }
        return ok;
    };
    for (const spec of specs)
    {
        const [bare, mp] = spec.split('@');
        if (blind)
        {
            if (!drop(spec)) log(`  ${spec}: not uninstalled - the plugin listing could not be read, so it may be gone already; if /plugin still lists it: claude plugin uninstall ${spec} --scope ${scope}`);
            continue;
        }
        const here = rows.filter((r) => r.name === bare && r.marketplace === mp && r.version);
        for (const r of here.filter((x) => x.scope && x.scope !== scope))
            log(`  ${spec} is installed at ${r.scope} scope, not this run's - kept for the projects that use it: claude plugin uninstall ${spec} --scope ${r.scope}`);
        if (here.some((r) => !r.scope || r.scope === scope) && !drop(spec))
            note(`plugin uninstall failed: ${spec} - remove it by hand: claude plugin uninstall ${spec} --scope ${scope}`);
    }
    return gone;
}

// INSTALL: register the marketplaces, refresh them, then install each plugin at its scope - and
// update one the listing already carries, which `install` leaves where it was. A failure is noted
// and the run continues - fail-soft, like every other layer. `fresh` names what this run installed
// already (a rename or a move): nothing is left to do for it. A playwright engine goes the
// `engineInPlace` way when installed, and is switched off right after its install when the user chose
// it off (`engines`, above).
function installPlugins({ plugins, scope, scopes = {}, marketplaces = [], before = [], fresh = [], refreshed = new Set(), engines = NO_ENGINES, cli, log = () => {}, note = () => {} })
{
    cli(['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE], { quiet: true });
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    // The official catalog first on every run, whatever the set: Claude Code registers it only on
    // its first INTERACTIVE launch, so an install before that failed every official plugin.
    refreshMarketplaces({ plugins: ['@claude-plugins-official', ...plugins], cli, refreshed });

    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        if (enginePresent(spec, before, engines)) { engineInPlace(spec, { scope, scopes, before, engines, cli, log, note }); continue; }
        // An optional item already installed is refreshed where it lives, never doubled at the run's scope (2.2.0);
        // a required one is installed at the run's scope and its own row updated where it lives.
        const pscope = scopedItem(spec) ? scopeFor(spec, scope, before, scopes) : scope;
        if (offByUser(spec, before))
        {
            const at = scopeFor(spec, scope, before, scopes);
            log(`plugin [${at}]: ${spec} is disabled - kept off, updated only`);
            cli(['plugin', 'update', spec, '--scope', at, '-y'], { quiet: true });
            continue;
        }
        log(`plugin [${pscope}]: ${spec}`);
        // -y: the marketplace-command consent prompt cannot be answered when stdin is not a TTY,
        // which is every guided run.
        if (!cli(['plugin', 'install', spec, '--scope', pscope, '-y'], { expect: 'reported' })) { note(`plugin ${spec} failed`); continue; }
        if (fieldOf(before, spec, 'version'))
            cli(['plugin', 'update', spec, '--scope', scopeFor(spec, scope, before, scopes), '-y'], { quiet: true });
        else if (engines.off.includes(spec)) switchOff(spec, pscope, { cli, log, note });
    }
}

// A retired name's FULL spec: the stack's own plugin under the key the core is listed under, unless its row in meta/retired-plugins.json names another marketplace -
// a third-party pick the stack dropped. Never the bare name: the official catalog ships a `sentry` too.
function retiredSpec(name, market, retiredRows = [])
{
    if (String(name).includes('@')) return String(name);
    const row = retiredRows.find((r) => r && r.name === name);
    return `${name}@${(row && row.marketplace) || market}`;
}

// Whether this run still prunes a retired name. A row whose add-back line reinstalls the very plugin
// the prune removes (a third-party pick the stack dropped) goes on the first update past its
// retirement only - while the last install's stamp predates `retiredIn`: from then on a row under
// that spec is the user's own, put back with that line, the rule the retired MCP registrations follow
// (mcp.dueRetired). With no stamp version the stack never installed it. Any other name - no row, an
// add-back that registers a server, no add-back at all - is pruned every run, as before.
function retirementDue({ name, rows = [], lastVersion = '', compare })
{
    const row = rows.find((r) => r && r.name === name);
    if (!row || !row.retiredIn || !/^claude plugin install /.test(String(row.addBack || ''))) return true;
    return Boolean(lastVersion) && typeof compare === 'function' && compare(lastVersion, row.retiredIn) < 0;
}

// The rows of `name@<market>` for each name, at any scope, that are ON: the settings file's word at the
// row's scope when it names the plugin, else the listing's flag - which read a running project-scope
// core as off (docs/plugin-cli-evidence.md S22), while a switch the file shows made already exits 1 (S28).
function rowsOn({ rows = [], names = [], market, isOn = () => undefined })
{
    const on = (r) => { const said = isOn(`${r.name}@${r.marketplace}`, r.scope); return said === undefined ? Boolean(r.enabled) : said; };
    return names.flatMap((name) => rows.filter((r) => r.name === name && r.marketplace === market && on(r)));
}

// THE FULL COPY ROUTE runs beside none of the stack's own plugins (R107): the locked servers come back
// to .mcp.json there, and a core or locked-server plugin left enabled would run each server twice and
// list every core skill beside its copy. A switch from a plugin route disables them BEFORE anything is
// registered - the core and the locked three, only as `name@<stack key>` (a same-named plugin of
// another marketplace is not ours) and only rows of the run's scope (a row at another scope serves
// other projects: named with its command, never disabled). A row already off is left alone, so a
// re-run calls nothing.
//
// AT USER SCOPE (I2, R132) a row serves every project of the account while the copies land in this one
// alone, so it is switched off HERE ONLY: `disable --scope project` over a user-scope install writes
// this project's enabledPlugins false, which Claude Code honours over the user row while every other
// project keeps it (measured on 2.1.282). Each off is returned as `{ scope, spec }` - the stamp's
// `stood-down` record, the one thing a switch back enables (restoreStoodDown).
const standDownScope = (scope) => (scope === 'user' ? 'project' : scope);
function copyRouteStandDown({ rows = [], market = BRAND.marketplace, scope, locked = [], isOn, cli, log = () => {}, note = () => {} })
{
    const off = [];
    const at = standDownScope(scope);
    for (const row of rowsOn({ rows, names: [BRAND.core, ...locked], market, isOn }))
    {
        const spec = `${row.name}@${market}`;
        if (row.scope !== scope)
        {
            log(`  ${spec} is enabled at ${row.scope} scope, not this run's - the full copy route runs beside it; if nothing else needs it: claude plugin disable ${spec} --scope ${row.scope}`);
            continue;
        }
        // Already off in this project (a re-run): the settings file there says so.
        if (at !== row.scope && isOn(spec, at) === false) continue;
        const why = 'the full copy route carries it as copies'
            + (at !== row.scope ? `; this project only - the ${row.scope}-scope install stays on for every other project` : '');
        if (cli(['plugin', 'disable', spec, '--scope', at], { quiet: true, expect: 'reported' }))
        {
            log(`plugin disabled [${at}]: ${spec} (${why})`);
            off.push({ scope: at, spec });
        }
        else note(`plugin disable failed: ${spec} - it runs beside the full copy route; disable it by hand: claude plugin disable ${spec} --scope ${at}`);
    }
    return off;
}

// THE SWITCH BACK (R116, M9): only what the full copy route switched off comes back on - the stamp's
// `stood-down` record, at the scope it was written - never a core the user switched off themselves,
// which the settings file cannot tell apart. An entry the plugin set carries and its settings file
// there still names off is enabled, leaves before the core (the stand-down's order reversed). The
// entries still owed (a failed enable) are returned for the stamp; the rest are done or moot.
function restoreStoodDown({ record = [], plugins = [], isOn, cli, log = () => {}, note = () => {} })
{
    const restored = [];
    const owed = [];
    for (const entry of [...record].reverse())
    {
        if (!plugins.includes(entry.spec) || isOn(entry.spec, entry.scope) !== false) continue;
        if (cli(['plugin', 'enable', entry.spec, '--scope', entry.scope], { quiet: true, expect: 'reported' }))
        {
            log(`plugin enabled [${entry.scope}]: ${entry.spec} (the full copy route switched it off here)`);
            restored.push(entry.spec);
        }
        else
        {
            owed.unshift(entry);
            note(`plugin enable failed: ${entry.spec} - it stays off here until it is enabled; the next update retries it, or: claude plugin enable ${entry.spec} --scope ${entry.scope}`);
        }
    }
    return { restored, owed };
}

// THE PLAYWRIGHT ENGINES the copy route registers in .mcp.json load as nothing else (R111): each one's
// `playwright-<engine>@<stack key>` row at the run's scope is UNINSTALLED before the registration - on
// or off (R116). Not disabled: a disabled engine is the user's own off-state, which the plugin route
// never switches back without an answer, while an absent one it installs back as last chosen (the
// stamp's two playwright lines). A row left off goes too, so the stamp is the ONE record a later switch
// back reads - kept, it would overrule a choice the user made on the copy route, where the on/off lives
// in disabledMcpjsonServers. A row at another scope serves other projects: named with its command when on.
//
// C11 (R137 N1): AT USER SCOPE ON THE FULL COPY ROUTE (`hereOnly`) the engine is registered in this
// project's .mcp.json (mcp.registrationScope) while its user-scope row serves every project of the
// account - an uninstall took it from all of them. It is switched off HERE ONLY, the way the core is
// (copyRouteStandDown): `disable --scope project`, returned as `{ scope, spec }` for the stamp's
// `stood-down` record, which the switch back enables (restoreStoodDown). One already off here, or off
// at user scope, calls nothing. Returns `{ gone, off }`.
//
// I8: THE DESKTOP SERVERS the copy route registers go the same way - `desktop` names each one this run
// registers in .mcp.json (the OS gate already left out one this machine cannot run). Left enabled, its
// plugin row ran Windows-MCP or MacOS-MCP a second time beside the registration: two UI-automation
// servers on one desktop and two tool sets. The plugin route installs it back from the MCP picks.
function engineStandDown({ rows = [], market = BRAND.marketplace, scope, engines = [], desktop = [], hereOnly = false, legacy = [], isOn, cli, log = () => {}, note = () => {} })
{
    const gone = [];
    const off = [];
    // `legacy`: the full copy route's old `playwright-<engine>` ids (the 2.0.0 rename) - whichever are
    // installed, since no swap runs with the core off; they go the same way as the engines kept here.
    const names = [...engines.map((e) => `browser-${e}`), ...desktop, ...legacy];
    const on = new Set(rowsOn({ rows, names, market, isOn }));
    const ours = names.flatMap((name) => rows.filter((r) => r.name === name && r.marketplace === market));
    const at = standDownScope(scope);
    for (const row of ours)
    {
        const spec = `${row.name}@${market}`;
        if (row.scope !== scope)
        {
            if (on.has(row)) log(`  ${spec} is enabled at ${row.scope} scope, not this run's - it loads beside its .mcp.json registration; if nothing else needs it: claude plugin uninstall ${spec} --scope ${row.scope}`);
            continue;
        }
        if (hereOnly && at !== scope)
        {
            if (!on.has(row) || isOn(spec, at) === false) continue;
            if (cli(['plugin', 'disable', spec, '--scope', at], { quiet: true, expect: 'reported' }))
            {
                log(`  !! plugin disabled [${at}]: ${spec} (the copy route registers it in .mcp.json; this project only - the ${scope}-scope install stays on for every other project)`);
                off.push({ scope: at, spec });
            }
            else note(`plugin disable failed: ${spec} - it loads beside its .mcp.json registration; disable it by hand: claude plugin disable ${spec} --scope ${at}`);
            continue;
        }
        if (cli(['plugin', 'uninstall', spec, '--scope', scope, '-y'], { quiet: true, expect: 'reported' }))
        {
            log(`plugin uninstalled [${scope}]: ${spec} (the copy route registers it in .mcp.json; the plugin route installs it back as last chosen)`);
            gone.push(spec);
        }
        else note(`plugin uninstall failed: ${spec} - it loads beside its .mcp.json registration; remove it by hand: claude plugin uninstall ${spec} --scope ${scope}`);
    }
    return { gone, off };
}

// C12 (Task 8a concern 5): an install moved OFF local scope. Its settings leave settings.local.json
// (settings.js leaveLocalScope), but a plugin row at local scope stays where only this checkout sees
// it - a clone of the project-scope install got none, and every update went on updating the local
// rows. Each spec of the run's set whose only row here is at local scope is installed at the new scope,
// then uninstalled at local; one with a row at the new scope already loses only its local row. A
// playwright engine left off locally arrives off (the user's own off-state); an item the user gave its own
// scope is moveScoped's. Returns `{ moved, dropped }`: the specs installed this run, and the ones whose local row went.
function moveLocalRows({ plugins = [], rows = [], scope, scopes = {}, engines = [], isOn = () => undefined, cli, log = () => {}, note = () => {} })
{
    const moved = [];
    const dropped = [];
    const unLocal = (spec) => cli(['plugin', 'uninstall', spec, '--scope', 'local', '-y'], { quiet: true, expect: 'reported' })
        || (note(`plugin uninstall failed: ${spec} at local scope - it loads there beside the ${scope}-scope install; remove it by hand: claude plugin uninstall ${spec} --scope local`), false);
    for (const spec of plugins)
    {
        const [name, market] = String(spec).split('@');
        // An item the user gave its own scope moves there instead (moveScoped).
        if (itemScope(spec, scope, scopes)) continue;
        const mine = rows.filter((r) => r.name === name && r.marketplace === market);
        const local = mine.find((r) => r.scope === 'local');
        if (!local) continue;
        if (mine.some((r) => r.scope === scope))
        {
            if (unLocal(spec)) { log(`plugin moved [local -> ${scope}]: ${spec} (installed at ${scope} scope already - the local row went)`); dropped.push(spec); }
            continue;
        }
        if (!cli(['plugin', 'install', spec, '--scope', scope, '-y'], { quiet: true, expect: 'reported' }))
        {
            note(`plugin move failed: ${spec} - it stays at local scope; to move it: claude plugin install ${spec} --scope ${scope}, then claude plugin uninstall ${spec} --scope local`);
            continue;
        }
        const said = isOn(spec, 'local');
        if (engines.includes(spec) && !(said === undefined ? local.enabled : said)) switchOff(spec, scope, { cli, log, note });
        unLocal(spec);
        log(`plugin moved [local -> ${scope}]: ${spec}`);
        moved.push(spec);
    }
    return { moved, dropped };
}

// A-I4 (final review A): claude-hud draws nothing until its status line is set, which /alfred-code:init
// does - so a claude-hud installed (this run, or before) with NO `statusLine` in any settings file this project
// reads (the account's, and since 2.2.0 the project's own two - a project-scope claude-hud's line is in
// settings.local.json) is said once. A statusLine that is there, whoever set it, is the user's choice; a
// claude-hud the user switched off stays off (USER_OFF_WINS); a file that cannot be read says nothing.
function hudStatusLineMissing({ plugins = [], listing = [], settingsFile, settingsFiles = [settingsFile] })
{
    const spec = HUD_SPEC;
    if ((!plugins.includes(spec) && !fieldOf(listing, spec, 'version')) || offByUser(spec, listing)) return false;
    for (const file of settingsFiles.filter(Boolean))
    {
        let data = {};
        try { const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); data = raw.trim() ? JSON.parse(raw) : {}; }
        catch (err) { if (err.code !== 'ENOENT') return false; }
        if (!data || typeof data !== 'object' || Array.isArray(data) || 'statusLine' in data) return false;
    }
    return true;
}

// UPDATE: uninstall the retired plugins this project carries AT THIS RUN'S SCOPE, each by its full
// spec. A name that is not installed here is not an error, it is nothing to do. `rows` holds every
// scope (`parsePluginList` everyScope); a bare `listing` is read the same way.
//
// A USER row is every other project's install too: it stays, and the run names the command that removes
// it; a project or local row at another scope than the run's is still this project's, and goes. After
// each uninstall the row's add-back line is printed: the retirement takes the plugin, never the user's
// way back to the server.
function prunedRetired({ rows, listing, retired = [], retiredRows = [], market = BRAND.marketplace, scope, cli, log = () => {}, note = () => {} })
{
    const all = rows || listing || [];
    const gone = [];
    const addBack = (name) => (retiredRows.find((r) => r && r.name === name) || {}).addBack;
    let left = [];
    for (const name of [...new Set(retired)])
    {
        const spec = retiredSpec(name, market, retiredRows);
        const [bare, mp] = spec.split('@');
        for (const r of all.filter((x) => x.name === bare && x.marketplace === mp && x.version))
        {
            const at = r.scope || scope;
            // A project or local row in the listing is THIS project's (parsePluginList drops another project's), so
            // it goes whatever the run's scope - the user's report of 2026-10-06: the Discover tab still listed the
            // retired entries a project-scope row kept installed under a local-scope run. Only a user row is shared.
            if (at !== scope && at === 'user')
                log(`  ${spec} is installed at ${at} scope, not this run's - kept for the projects that use it; the update run at that scope removes it: claude plugin uninstall ${spec} --scope ${at}`);
            else if (!left.some((x) => x.spec === spec && x.scope === at)) left.push({ spec, name: bare, scope: at });
        }
    }
    // A retired entry can declare another as a dependency and the CLI refuses to remove a dependency
    // first, so a refusal is retried once everything else in the pass has gone.
    for (let pass = 0; pass < 2 && left.length; pass++)
    {
        const next = [];
        for (const item of left)
        {
            if (cli(['plugin', 'uninstall', item.spec, '--scope', item.scope, '-y'], { quiet: true, expect: 'reported' }))
            {
                log(`  plugin pruned (retired upstream) [${item.scope}]: ${item.spec}`);
                const back = addBack(item.name);
                if (back) log(`    add it back: ${back.split('<scope>').join(item.scope)}`);
                // A-I2: the old local mode had the user switch the hosted server off, and nothing else turns it on.
                if (item.name === 'context7-local') log('  !! context7-local removed - if you ran /mcp disable context7 for it, run /mcp enable context7');
                gone.push(item.name);
            }
            else next.push(item);
        }
        left = next;
    }
    for (const item of left) note(`plugin uninstall failed: ${item.spec} - remove it by hand: claude plugin uninstall ${item.spec} --scope ${item.scope}`);
    return gone;
}

// THE MCP RENAMES (meta/stack-manifest.json `renamed.mcps`): 2.0.0 made serena, context7 and
// playwright-<engine> navigation, documentation and browser-<engine>, and 2.2.0 made navigation, documentation
// and memory alfred-navigation, alfred-documentation and alfred-memory. An install made before one
// holds the old rows; each one this run's set carries a successor for, at THIS run's scope, is SWAPPED
// there - the new one installed first, so a failed install leaves the old server running, then the old
// one removed, so the same server never loads twice after the run. An old row at ANOTHER scope serves
// the projects there too, and one not yet updated still spells the old tools (its agents' `tools:`, its
// navigation rule's `ToolSearch select:` line) - a swap there would strip them (I2). It is STOOD DOWN
// here instead: the successor installed at this run's scope, the old id disabled at this project's
// scope only (standDownScope - Claude Code honours it over a user row, I2 on 2.1.282), and one `!!`
// line naming its uninstall for when every project there has updated. The new one already there (a
// re-run after a partial one) is not installed again, and an old id already off here is not disabled
// again. A browser engine keeps the user's own on/off (the settings file's word at the old row's
// scope, or this run's enable answer); a locked server comes on, the way update enables a parked one.
// An old one whose successor this run does not carry (a dropped engine, the MCP copy route's engines)
// goes at this run's scope only - one at another scope is named with its command. Only this stack's
// marketplace: the official catalog ships a `serena` too. Returns `{ fresh, gone }`: the specs
// installed here, and the old rows removed.
function migrateRenamed({ rows = [], renamed = {}, set = [], market = BRAND.marketplace, scope, engines = NO_ENGINES, isOn = () => undefined, cli, log = () => {}, note = () => {} })
{
    const { currentMcp, renamedFrom } = require('./mcp.js');
    const olds = renamedFrom(renamed);
    const out = { fresh: [], gone: [] };
    const drop = (spec, at) => cli(['plugin', 'uninstall', spec, '--scope', at, '-y'], { quiet: true, expect: 'reported' });
    // The successors already at this run's scope, and the ones whose install failed this run (tried once).
    const here = new Set(rows.filter((r) => r.marketplace === market && r.scope === scope && r.version).map((r) => r.name));
    const failed = new Set();
    // This scope's own old rows first: an in-place uninstall clears the id's settings key here, which
    // would undo a stand-down disable written before it (the old id at both scopes).
    const mine = (r) => ((r.scope || scope) === scope ? 0 : 1);
    const oldRows = rows.filter((r) => olds.includes(r.name) && r.marketplace === market && r.version).sort((x, y) => mine(x) - mine(y));
    for (const row of oldRows)
    {
        const oldSpec = `${row.name}@${market}`;
        const newName = currentMcp(row.name, renamed);
        const newSpec = `${newName}@${market}`;
        const at = row.scope || scope;
        if (!set.includes(newSpec))
        {
            if (at !== scope) { log(`  ${oldSpec} is installed at ${at} scope, not this run's - renamed ${newName} and not carried here; kept for the projects that use it: claude plugin uninstall ${oldSpec} --scope ${at}`); continue; }
            if (drop(oldSpec, at)) { log(`  renamed: plugin ${oldSpec} removed [${at}] - renamed ${newSpec}, which this run does not carry`); out.gone.push(row); }
            else note(`plugin uninstall failed: ${oldSpec} - remove it by hand: claude plugin uninstall ${oldSpec} --scope ${at}`);
            continue;
        }
        if (failed.has(newName)) continue;
        const said = isOn(oldSpec, at);
        const wasOn = said === undefined ? row.enabled !== false : said;
        if (!here.has(newName))
        {
            if (!cli(['plugin', 'install', newSpec, '--scope', scope, '-y'], { expect: 'reported' }))
            {
                failed.add(newName);
                note(`plugin ${newSpec} failed - ${oldSpec} stays until it installs; the next update retries the rename`);
                continue;
            }
            here.add(newName);
            out.fresh.push(newSpec);
            const engine = /^browser-/.test(newName);
            if (engine && !(engines.on ? engines.on.includes(newSpec) : wasOn)) switchOff(newSpec, scope, { cli, log, note });
        }
        if (at !== scope) { standDownRenamed({ oldSpec, newSpec, at, here: standDownScope(scope), wasOn, isOn, cli, log, note }); continue; }
        if (drop(oldSpec, at)) { log(`  renamed: plugin ${oldSpec} -> ${newSpec} [${at}]`); out.gone.push(row); }
        else note(`plugin uninstall failed: ${oldSpec} - it loads beside ${newSpec}, the same server twice; remove it by hand: claude plugin uninstall ${oldSpec} --scope ${at}`);
    }
    return out;
}

// An old id at another scope, with its successor now installed at this run's: switched off for THIS
// project only, unless the settings there say it is off already or it was never on (a re-run changes
// nothing). The `!!` line is said once, on the run that switches it off; the kept row is named every run.
function standDownRenamed({ oldSpec, newSpec, at, here, wasOn, isOn, cli, log, note })
{
    const uninstall = `claude plugin uninstall ${oldSpec} --scope ${at}`;
    const kept = `${oldSpec} is installed at ${at} scope - kept for every project there that has not updated yet (their tools still use the old name); once each has run /alfred-code:update: ${uninstall}`;
    const offHere = isOn(oldSpec, here);
    if (offHere === false || (offHere === undefined && !wasOn)) { log(`  ${kept}`); return; }
    if (cli(['plugin', 'disable', oldSpec, '--scope', here], { quiet: true, expect: 'reported' }))
        log(`  !! renamed: plugin ${oldSpec} -> ${newSpec} [${here}] - ${oldSpec} disabled for this project only; ${kept}`);
    else note(`plugin disable failed: ${oldSpec} - it loads beside ${newSpec}, the same server twice; disable it for this project: claude plugin disable ${oldSpec} --scope ${here}`);
}

// The third-party marketplaces THIS run needs registered: the source each installed plugin's
// manifest row names. A source for a plugin the run does not install is never added to the account.
function extraMarketplaces(rows, set)
{
    return [...new Set((rows || []).filter((r) => r.marketplace && set.includes(r.id)).map((r) => r.marketplace))];
}

// UPDATE: adopt, enable, update, then READ THE VERSIONS BACK. An absent plugin is INSTALLED here, so
// its marketplace is registered first, exactly as the install pass does. `fresh` names what this run
// installed already (a rename or a move): it is not touched again, and it is ENABLED - its install
// said so, while the listing's own flag can read a fresh project-scope install as disabled
// (docs/plugin-cli-evidence.md S22). A playwright engine is never enabled for its flag - the user's own
// off-state, which only their answer (`engines.on`) switches - and an absent one is installed as on
// install: switched off after when the user chose it off.
function updatePlugins({ plugins, scope, scopes = {}, marketplaces = [], before = [], after, fresh = [], restored = [], refreshed = new Set(), engines = NO_ENGINES, cli, log = () => {}, note = () => {} })
{
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    refreshMarketplaces({ plugins, cli, refreshed });
    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        if (enginePresent(spec, before, engines)) { engineInPlace(spec, { scope, scopes, before, engines, cli, log, note }); continue; }
        const pscope = scopeFor(spec, scope, before, scopes);
        if (!fieldOf(before, spec, 'version'))
        {
            log(`plugin install [${pscope}]: ${spec}`);
            if (cli(['plugin', 'install', spec, '--scope', pscope, '-y']) && engines.off.includes(spec)) switchOff(spec, pscope, { cli, log, note });
        }
        // The core is locked on (brand.js alwaysOn): its flag is no reason to act (S22), and a core the
        // full copy route switched off came back through restoreStoodDown already - `restored`, whose
        // listing flag is stale now. A user-disabled claude-hud stays off (USER_OFF_WINS).
        else if (fieldOf(before, spec, 'enabled') === false && !alwaysOn(bareName(spec)) && !offByUser(spec, before) && !restored.includes(spec))
        {
            log(`plugin enable [${pscope}]: ${spec} (installed but disabled)`);
            // A stale listing flag (S22) makes this a no-op enable, which exits 1 saying 'Plugin "<spec>" is
            // already enabled at <scope> scope' (measured on 2.1.282, project and user scope - M8, R132).
            cli(['plugin', 'enable', spec, '--scope', pscope], { expect: /is already enabled/ });
        }
        log(`plugin update [${pscope}]: ${spec}`);
        cli(['plugin', 'update', spec, '--scope', pscope, '-y']);
    }

    const now = typeof after === 'function' ? after() : (after || []);
    const report = [];
    for (const spec of plugins)
    {
        const name = bareName(spec);
        const was = fieldOf(before, spec, 'version');
        const is = fieldOf(now, spec, 'version');
        let line;
        if (fresh.includes(spec)) line = `  plugin ${name}: ${is ? `${is} (installed this run)` : 'installed this run'}`;
        else if (!is) line = `  plugin ${name}: NOT installed - the install above did not take (is the marketplace reachable?)`;
        else if (!engines.specs.includes(spec) && fieldOf(now, spec, 'enabled') === false && !alwaysOn(name)) line = `  plugin ${name}: ${is} but DISABLED - 'claude plugin enable ${spec}' turns it back on`;
        else if (!was) line = `  plugin ${name}: ${is} (installed this run)`;
        else if (was !== is) line = `  plugin ${name}: ${was} -> ${is}`;
        else line = `  plugin ${name}: ${is} (already newest)`;
        log(line);
        report.push(line);
    }
    return report;
}

// `claude plugin marketplace list --json` -> its rows (evidence S7), or [] for anything unreadable.
function parseMarketplaces(json)
{
    try { const rows = typeof json === 'string' ? JSON.parse(json) : json; return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : []; }
    catch { return []; }
}

module.exports = {
    OFFICIAL_MARKETPLACE, STACK_MARKETPLACE, CORE_SPEC, USER_SCOPE_PLUGINS, USER_OFF_WINS, CORE_DEP_PLUGINS, HUD_SPEC, itemScope, scopedItem, moveScoped,
    pluginRoutes, committedRoutes, committedRoutesAt, corePluginOn, parsePluginList, parseMarketplaces, fieldOf, scopeFor, migrateRenamed,
    resolveStackPlugins, selectionLines, pluginSet,
    refreshMarketplaces, stackMarket, refreshStackSource, installPlugins, prunedRetired, retirementDue, updatePlugins, extraMarketplaces, uninstallEngines,
    copyRouteStandDown, restoreStoodDown, standDownScope, engineStandDown, rowsOn, moveLocalRows, hudStatusLineMissing,
};
