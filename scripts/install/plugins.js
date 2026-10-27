'use strict';
// THE PLUGIN LAYER - what this run enables, at which scope, and what it takes back out.
//
// From Phase 3 onward the plugins ARE the delivery: the skills, agents and hooks all arrive through the
// project's own closure, and the copy route is the escape hatch. The stack ships no MCP server (2.10.1).
// So the decisions here are the install.
//
// Five rules, each one measured:
//
//   - THE CLOSURE IS COMPUTED ONCE, by `selection-plugins.js`, and it is fed skill/agent lines only
//     when the skills route is on. Whatever comes back is exactly what the route needs enabled.
//   - A FAILURE TO COMPUTE IT DROPS THE ROUTE TO COPY, loudly. Half a closure would leave a project
//     with neither the plugin's copy of an item nor its own.
//   - `claude plugin update` IS A NO-OP ON A PLUGIN THAT IS NOT INSTALLED, and says nothing about
//     one that is installed but DISABLED. So update must install an absent plugin and enable a
//     parked one BEFORE it updates - measured: two added plugins still `disabled` after a run,
//     recovered by hand over eight messages and ~1.05M of context.
//   - THE PLUGIN'S OWN SCOPE WINS on update, read from the listing: `claude plugin update --scope
//     <other>` is a silent no-op, so passing the INSTALL's scope left every user-scoped plugin on
//     its old version under a project install.
//   - VERSIONS ARE READ BACK. `claude plugin update` reports success whether or not anything moved.
//
// And the scope rules every pass follows (code.claude.com/docs/en/plugins/cli-reference and /plugins/loading):
// every call names its scope (install and uninstall default to `user`); a plugin installed at several scopes
// is updated at EACH of them and the narrowest row is the one this project loads (local, project, user); an
// uninstall takes one scope's row and leaves the rest; a narrower scope switches a broader row off for itself
// alone (`overrideScope`); and a `managed` row is the admin's - updated there, never installed, removed,
// disabled or moved (`isManaged`).
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const { BRAND, alwaysOn, marketOf, marketKey } = require('./brand.js');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

// 2.2.0: no plugin is pinned to a scope any more - each OPTIONAL item (an LSP, claude-hud) goes where the
// user chose it (`--scope-of`, `itemScope` below), the required ones follow the
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
// always.plugins), the user's ruling of 2026-10-06 - only the core is required.
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
});

const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills);

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
    for (const [route, suffix] of [['hooks', 'HOOKS_VIA_PLUGIN'], ['skills', 'SKILLS_VIA_PLUGIN']])
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

// The install scopes `claude plugin list --json` reports, narrowest first: a plugin at several loads its
// narrowest row here (enabledPlugins precedence - local over project over user). `managed` is the admin's:
// `claude plugin update --scope managed` is the only call it takes. A row naming no scope ranks last.
const SCOPES = ['local', 'project', 'user', 'managed'];
const MANAGED = 'managed';
const isManaged = (scope) => scope === MANAGED;
const scopeRank = (scope) => (SCOPES.includes(scope) ? SCOPES.indexOf(scope) : SCOPES.length);

// Where THIS run switches off a row it does not want here: the row's own scope when it is the run's, or the
// run's settings scope when the row is BROADER - `claude plugin disable --scope <narrower>` over a broader row
// writes an override Claude Code honours for this scope alone, every other project keeping the plugin (the
// CLI reference's 'plugin enable', measured as I2 on 2.1.282). '' when the run cannot reach it: a managed row
// (the admin's), or one narrower than the run (a local row under a project run outranks anything it writes).
// A user-scope run switches its own rows at user scope; `standDownScope` keeps its copy-route stand-down here.
function overrideScope(rowScope, runScope)
{
    if (!rowScope || rowScope === runScope) return runScope;
    if (isManaged(rowScope) || scopeRank(rowScope) < scopeRank(runScope)) return '';
    return runScope;
}

// What the run says about a row it leaves alone, with the command that reaches it - never `--scope managed`,
// which the CLI refuses for everything but update.
const leftAt = (spec, scope, verb = 'uninstall') => (isManaged(scope)
    ? `${spec} is installed at managed scope - your organization's managed settings own it; only an admin removes or switches it`
    : `claude plugin ${verb} ${spec} --scope ${scope}`);

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
        // The narrowest scope first (local, project, user, managed); a row naming no scope by its projectPath.
        const rank = SCOPES.includes(row.scope) ? scopeRank(row.scope) : (pp ? 1 : 2);
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

// Every scope `spec` is installed at, narrowest first, from rows read with `everyScope` - the scopes an update
// refreshes. A row naming no scope stands for the run's (`fallback`).
function scopesOf(rows, spec, fallback = '')
{
    const [bare, market] = String(spec).split('@');
    const at = (rows || []).filter((r) => r.name === bare && (!market || !r.marketplace || r.marketplace === market) && r.version)
        .map((r) => r.scope || fallback).filter(Boolean);
    return [...new Set(at)].sort((a, b) => scopeRank(a) - scopeRank(b));
}

// A plugin the admin installed (a managed row) is not installed again beside it: managed settings
// enable or block it everywhere, so a second row would change nothing but the version it loads.
const adminOwned = (rows, spec) => scopesOf(rows, spec).some(isManaged);

// A stack row already at the snapshot's own release needs no `plugin update`: the source step (the protocol's
// resolve, or refreshStackSource) updated every stack entry before the run read its snapshot, the snapshot IS the
// newest entry, and every marketplace entry ships at the one release version. Updating it again spawned the CLI
// once more per row for 'already at the latest version' (audit 2026-10-11, session 5b9ce9c5: six rows, on a machine
// where the resolve alone ran 240.8 s). `release` is `{ market, version }`; no version read skips nothing.
function atRelease(rows, spec, scope, release)
{
    if (!release || !release.version || !release.market) return false;
    const [name, market] = String(spec).split('@');
    if (market !== release.market) return false;
    return (rows || []).some((r) => r.name === name && r.marketplace === market && r.scope === scope && r.version === release.version);
}

// Update `spec` at every scope it is installed at - the admin's managed row included, the one call
// that scope takes - except a scope whose stack row is at the snapshot's release already. Returns the scopes.
function updateEvery(spec, at, { cli, log = () => {}, quiet = true, rows = [], release = null })
{
    for (const scope of at)
    {
        if (atRelease(rows, spec, scope, release)) { log(`plugin current [${scope}]: ${spec} (already ${release.version}, the snapshot's release)`); continue; }
        log(`plugin update [${scope}]: ${spec}`);
        cli(['plugin', 'update', spec, '--scope', scope, '-y'], quiet ? { quiet: true } : undefined);
    }
    return at;
}

// 2.2.0: an optional item's own scope, the user's choice (`--scope-of`): `user` is every project on the account,
// `project` this project at the run's own scope - `project` itself when the run is a user-scope one - and `local`
// this checkout alone. '' when the user made no choice for it. Never `managed`: no run installs there.
function itemScope(spec, installScope, scopes = {})
{
    const chosen = (scopes || {})[bareName(spec)];
    if (chosen === 'user' || chosen === 'local') return chosen;
    if (chosen === 'project') return installScope === 'user' ? 'project' : installScope;
    return '';
}

// The optional items that carry a scope of their own (args.js SCOPED_ITEMS): the LSP pair and claude-hud. The
// core follows the run.
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
// the command that puts it back; a project or local row is this project's alone. A row of another project never
// shows here (parsePluginList drops it). Returns the specs
// installed this run and the moves, so the passes after it read each at its new scope.
function moveScoped({ plugins = [], rows = [], scope, scopes = {}, cli, log = () => {}, note = () => {} })
{
    const moved = [];
    for (const spec of plugins)
    {
        const target = itemScope(spec, scope, scopes);
        if (!target) continue;
        const [name, market] = String(spec).split('@');
        const mine = rows.filter((r) => r.name === name && r.marketplace === market && r.version);
        // What moves is the row this project loads (the narrowest), plus any row narrower than the target, which would
        // still outrank it here. A BROADER row at a third scope stays for the projects that use it - a move takes one
        // place, never every one (scope rule 3) - and a managed row is the admin's and never moves.
        const own = mine.filter((r) => r.scope && !isManaged(r.scope)).sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));
        const away = own.filter((r, i) => r.scope !== target && (i === 0 || scopeRank(r.scope) < scopeRank(target)));
        for (const r of own.filter((x) => x.scope !== target && !away.includes(x)))
            log(`  ${spec} is installed at ${r.scope} scope too - kept for the projects that use it: claude plugin uninstall ${spec} --scope ${r.scope}`);
        if (!away.length) continue;
        if (!mine.some((r) => r.scope === target))
        {
            if (!cli(['plugin', 'install', spec, '--scope', target, '-y'], { quiet: true, expect: 'reported' }))
            {
                note(`plugin move failed: ${spec} - it stays at ${away.map((r) => r.scope).join(', ')} scope; to move it: claude plugin install ${spec} --scope ${target}, then claude plugin uninstall ${spec} --scope ${away[0].scope}`);
                continue;
            }
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
    if (!routes.skills) return { entries: [], extraSkills: [], extraAgents: [], routes };

    let out;
    try { out = runSelection(selection); }
    catch (err)
    {
        const next = { ...routes, skills: false };
        log(`  !! ${err.message} - skills and agents stay on the copy route`);
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
function selectionLines({ routes, skills = [], agents = [] })
{
    const lines = [];
    if (routes.skills)
    {
        for (const s of skills) lines.push(`skill ${typeof s === 'string' ? s.split('|').pop() : s.name}`);
        for (const a of agents) lines.push(`agent ${String(typeof a === 'string' ? a.split('::')[0] : a.file).replace(/\.md$/, '')}`);
    }
    return lines;
}

// Everything this run hands to `claude plugin install`, in order: the third-party picks, then the
// stack's own entries (the core first, so the hooks it carries resolve in the same run that prunes
// the copied hooks they replace), then the core's companions. The hooks ride the CORE (2.0.0, 'Fold
// into core') whenever it is on - the selection names it on the skills route, and the hooks route alone
// puts it here. `coreDeps` join on every route - on the full copy route nothing else would bring them
// either.
function pluginSet({ routes, thirdParty = [], stackEntries = [], coreDeps = [], market = BRAND.marketplace })
{
    const stack = [];
    if (corePluginOn(routes))
    {
        if (!stackEntries.some((spec) => bareName(spec) === BRAND.core)) stack.push(`${BRAND.core}@${market}`);
        stack.push(...stackEntries);
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

// INSTALL: register the marketplaces, refresh them, then install each plugin at its scope - and
// update one the listing already carries, which `install` leaves where it was. A failure is noted
// and the run continues - fail-soft, like every other layer. `fresh` names what this run installed
// already (a move): nothing is left to do for it. `rows` (every scope's, parsePluginList everyScope) names
// each scope an installed plugin is updated at.
function installPlugins({ plugins, scope, scopes = {}, marketplaces = [], before = [], rows = before, fresh = [], refreshed = new Set(), release = null, cli, log = () => {}, note = () => {} })
{
    cli(['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE], { quiet: true });
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    // The official catalog first on every run, whatever the set: Claude Code registers it only on
    // its first INTERACTIVE launch, so an install before that failed every official plugin.
    refreshMarketplaces({ plugins: ['@claude-plugins-official', ...plugins], cli, refreshed });

    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        const every = scopesOf(rows, spec);
        // The admin's install (a managed row) is updated there and never doubled at another scope.
        if (adminOwned(rows, spec))
        {
            log(`plugin [managed]: ${spec} - installed by your organization's managed settings, updated only`);
            updateEvery(spec, every, { cli, log, rows, release });
            continue;
        }
        // An optional item already installed is refreshed where it lives, never doubled at the run's scope (2.2.0);
        // a required one is installed at the run's scope and every row of it updated.
        const pscope = scopedItem(spec) ? scopeFor(spec, scope, before, scopes) : scope;
        if (offByUser(spec, before))
        {
            log(`plugin [${scopeFor(spec, scope, before, scopes)}]: ${spec} is disabled - kept off, updated only`);
            updateEvery(spec, every.length ? every : [scopeFor(spec, scope, before, scopes)], { cli, rows, release });
            continue;
        }
        log(`plugin [${pscope}]: ${spec}`);
        // -y: the marketplace-command consent prompt cannot be answered when stdin is not a TTY,
        // which is every guided run.
        if (!cli(['plugin', 'install', spec, '--scope', pscope, '-y'], { expect: 'reported' })) { note(`plugin ${spec} failed`); continue; }
        if (fieldOf(before, spec, 'version'))
            updateEvery(spec, every.length ? every : [scopeFor(spec, scope, before, scopes)], { cli, rows, release });
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

// Whether `spec` is on in THIS project by the settings files: the narrowest of local, project and user that
// names it decides (enabledPlugins precedence, code.claude.com/docs/en/plugins/loading), so a narrower scope's
// off over a broader row reads off. undefined when no file names it. Managed settings sit above all three and
// are not read here - a managed row says so itself.
function effectiveOn(isOn, spec)
{
    for (const scope of ['local', 'project', 'user'])
    {
        const said = isOn(spec, scope);
        if (said !== undefined) return said;
    }
    return undefined;
}

// The listing's rows with each `enabled` flag set to the settings files' word where one names the plugin
// (effectiveOn) - the flag alone reads a broader row on under a narrower scope's off, and a running
// project-scope core off (S22). A managed row keeps its flag: the admin's settings decide it.
const withEffective = (rows, isOn) => (rows || []).map((r) =>
{
    if (isManaged(r.scope)) return r;
    const said = effectiveOn(isOn, `${r.name}@${r.marketplace}`);
    return said === undefined ? r : { ...r, enabled: said };
});

// The rows of `name@<market>` for each name, at any scope, that are ON: the settings file's word at the
// row's scope when it names the plugin, else the listing's flag - which read a running project-scope
// core as off (docs/plugin-cli-evidence.md S22), while a switch the file shows made already exits 1 (S28).
function rowsOn({ rows = [], names = [], market, isOn = () => undefined })
{
    const on = (r) => { const said = isOn(`${r.name}@${r.marketplace}`, r.scope); return said === undefined ? Boolean(r.enabled) : said; };
    return names.flatMap((name) => rows.filter((r) => r.name === name && r.marketplace === market && on(r)));
}

// THE FULL COPY ROUTE runs beside none of the stack's own plugins (R107): a core left enabled would run
// every hook twice and list every core seat beside its copy. A switch from a plugin route disables it
// BEFORE anything is copied - only as `name@<stack key>` (a same-named plugin of another marketplace is
// not ours) and only rows of the run's scope (a row at another scope serves
// other projects: named with its command, never disabled). A row already off is left alone, so a
// re-run calls nothing.
//
// AT USER SCOPE (I2, R132) a row serves every project of the account while the copies land in this one
// alone, so it is switched off HERE ONLY: `disable --scope project` over a user-scope install writes
// this project's enabledPlugins false, which Claude Code honours over the user row while every other
// project keeps it (measured on 2.1.282). Each off is returned as `{ scope, spec }` - the stamp's
// `stood-down` record, the one thing a switch back enables (restoreStoodDown).
const standDownScope = (scope) => (scope === 'user' ? 'project' : scope);
function copyRouteStandDown({ rows = [], market = BRAND.marketplace, scope, isOn, cli, log = () => {}, note = () => {} })
{
    const off = [];
    const at = standDownScope(scope);
    for (const row of rowsOn({ rows, names: [BRAND.core], market, isOn }))
    {
        const spec = `${row.name}@${market}`;
        // A BROADER row (user under a project or local run, project under a local one) is switched off here
        // alone - the override `overrideScope` names; a narrower or managed row is out of this run's reach.
        if (row.scope !== scope && !overrideScope(row.scope, scope))
        {
            log(isManaged(row.scope) ? `  ${leftAt(spec, row.scope)} - the full copy route runs beside it`
                : `  ${spec} is enabled at ${row.scope} scope, not this run's - the full copy route runs beside it; if nothing else needs it: claude plugin disable ${spec} --scope ${row.scope}`);
            continue;
        }
        // Already off in this project (a re-run): the settings file there says so.
        if (at !== row.scope && isOn(spec, at) === false) continue;
        const why = 'the full copy route carries it as copies'
            + (at !== row.scope ? `; this ${at === 'local' ? 'checkout' : 'project'} only - the ${row.scope}-scope install stays on ${row.scope === 'user' ? 'for every other project' : 'for everyone else'}` : '');
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

// C12 (Task 8a concern 5): an install moved OFF local scope. Its settings leave settings.local.json
// (settings.js leaveLocalScope), but a plugin row at local scope stays where only this checkout sees
// it - a clone of the project-scope install got none, and every update went on updating the local
// rows. Each spec of the run's set whose only row here is at local scope is installed at the new scope,
// then uninstalled at local; one with a row at the new scope already loses only its local row. An item the
// user gave its own scope is moveScoped's. Returns `{ moved, dropped }`: the specs installed this run, and the ones whose local row went.
function moveLocalRows({ plugins = [], rows = [], scope, scopes = {}, cli, log = () => {}, note = () => {} })
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
// way back to the server. `backTo(name, scope, line)` may take a line instead (true when it did) - the run's one
// block of the 2.10.1 servers' add-back lines.
function prunedRetired({ rows, listing, retired = [], retiredRows = [], market = BRAND.marketplace, scope, cli, backTo = null, log = () => {}, note = () => {} })
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
            if (isManaged(at)) log(`  ${leftAt(spec, at)} - kept`);
            else if (at !== scope && at === 'user')
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
                if (back && !(backTo && backTo(item.name, item.scope, back))) log(`    add it back: ${back.split('<scope>').join(item.scope)}`);
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

// A retired SERVER plugin's key the project's own settings files still switch on while no install of it reaches this project
// (a teammate's committed `alfred-navigation@envoydev`): Claude Code would look for a plugin the marketplace no longer lists.
// The key goes - only for a row whose add-back registers the server (`claude mcp add-json`), only where `rows` (every scope's
// listing, before the prune) holds no row of that spec, and never on a listing that could not be read (`blind`). A row the
// prune just uninstalled was reached, and the CLI takes its key with it.
function dropStaleRetired({ rows = [], blind = false, retiredRows = [], market = BRAND.marketplace, claudeDir, log = () => {}, note = () => {} })
{
    if (blind) return [];
    const specs = retiredRows.filter((r) => r && /^claude mcp add-json /.test(String(r.addBack || '')))
        .map((r) => ({ spec: retiredSpec(r.name, market, retiredRows), since: r.retiredIn }))
        .filter(({ spec }) => !rows.some((x) => `${x.name}@${x.marketplace}` === spec));
    const dropped = [];
    for (const name of ['settings.json', 'settings.local.json'])
    {
        const file = path.join(claudeDir, name);
        if (!fs.existsSync(file)) continue;
        let data;
        try { data = parseJson(fs.readFileSync(file, 'utf8')); }
        catch { note(`${name} could not be read - a retired server plugin's enabledPlugins key there was left as it is`); continue; }
        const on = data && typeof data === 'object' && !Array.isArray(data) ? data.enabledPlugins : null;
        if (!on || typeof on !== 'object' || Array.isArray(on)) continue;
        const gone = specs.filter(({ spec }) => Object.hasOwn(on, spec));
        if (!gone.length) continue;
        for (const { spec, since } of gone)
        {
            delete on[spec];
            dropped.push(spec);
            log(`  ${name}: enabledPlugins entry ${spec} removed - the stack retired that plugin in ${since} and no install of it reaches this project`);
        }
        if (!Object.keys(on).length) delete data.enabledPlugins;
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    return dropped;
}

// The plugin ids an install record reaches in this project: an account-wide record (no projectPath), or this project's
// own - its path compared as given and as the file system resolves it (macOS /var is /private/var).
function reachedIds(rows, projectRoot)
{
    const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
    const here = new Set([projectKey(projectRoot), projectKey(real(projectRoot))]);
    const ours = (pp) => here.has(projectKey(pp)) || here.has(projectKey(real(pp)));
    return new Set(rows.filter((r) => r && r.id && (!r.projectPath || ours(String(r.projectPath)))).map((r) => String(r.id)));
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
// (docs/plugin-cli-evidence.md S22). Every plugin is updated at EACH scope it is installed
// at (`rows`, every scope's) - the admin's managed row included, the one call that scope takes - while an
// enable runs only where this project loads it, never at managed scope.
function updatePlugins({ plugins, scope, scopes = {}, marketplaces = [], before = [], rows = before, after, fresh = [], restored = [], refreshed = new Set(), release = null, cli, log = () => {}, note = () => {} })
{
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    refreshMarketplaces({ plugins, cli, refreshed });
    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        const pscope = scopeFor(spec, scope, before, scopes);
        const every = scopesOf(rows, spec);
        if (adminOwned(rows, spec))
        {
            log(`plugin [managed]: ${spec} - installed by your organization's managed settings, updated only`);
            updateEvery(spec, every, { cli, log, quiet: false, rows, release });
            continue;
        }
        if (!fieldOf(before, spec, 'version'))
        {
            log(`plugin install [${pscope}]: ${spec}`);
            cli(['plugin', 'install', spec, '--scope', pscope, '-y']);
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
        updateEvery(spec, every.includes(pscope) ? every : [pscope, ...every], { cli, log, quiet: false, rows, release });
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
        else if (fieldOf(now, spec, 'enabled') === false && !alwaysOn(name)) line = `  plugin ${name}: ${is} but DISABLED - 'claude plugin enable ${spec}' turns it back on`;
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

// The plugins THIS project's settings switch on that no install record reaches (audit 2026-10-10, session 758ce661: a
// project's settings enabled a browser engine, the capabilities rule listed it, and the only record was another
// project's - the session had no browser tools and nothing said why). The settings' word is effectiveOn's, over the
// three files the CLI writes; a record reaches when parsePluginList keeps it (this project's own, or an account-wide
// one). `listing` is `claude plugin list --json`'s text. Each entry: the spec, the file that switches it on, and how
// many other projects hold a record of it. A plugin a REGISTERED marketplace lists with a relative-path source loads
// from that marketplace's copy with no install record (audit 2026-10-14 PL14, measured on 2.1.300: a SessionStart hook
// of such a plugin fired with `plugin list` empty, and with its only record another project's; a marketplace declared
// in project settings alone loaded nothing) - so it is reached. `marketplaces` is `claude plugin marketplace list
// --json`'s rows; with none, every spec needs a record, the reading before the measurement.
function unreachedPlugins({ listing, projectRoot, configDir, marketplaces = [] })
{
    const claudeDir = path.join(projectRoot, '.claude');
    const files = { local: path.join(claudeDir, 'settings.local.json'), project: path.join(claudeDir, 'settings.json'), user: path.join(configDir, 'settings.json') };
    const enabledIn = (file) =>
    {
        try { const e = parseJson(fs.readFileSync(file, 'utf8')).enabledPlugins; return e && typeof e === 'object' && !Array.isArray(e) ? e : {}; }
        catch { return {}; }
    };
    const enabled = Object.fromEntries(Object.entries(files).map(([scope, file]) => [scope, enabledIn(file)]));
    const isOn = (spec, scope) => (typeof enabled[scope][spec] === 'boolean' ? enabled[scope][spec] : undefined);
    let rows = [];
    try { const data = JSON.parse(listing); rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : []); }
    catch { rows = []; }
    // parsePluginList's reach - a row with no projectPath is account-wide, one with a projectPath is that project's -
    // with the path compared as given and as the file system resolves it (macOS /var is /private/var).
    const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
    const here = new Set([projectKey(projectRoot), projectKey(real(projectRoot))]);
    const ours = (pp) => here.has(projectKey(pp)) || here.has(projectKey(real(pp)));
    const reached = reachedIds(rows, projectRoot);
    const catalogs = new Map();
    const fromCatalog = (spec) =>
    {
        const at = spec.lastIndexOf('@');
        if (at <= 0) return false;
        const [name, key] = [spec.slice(0, at), spec.slice(at + 1)];
        if (!catalogs.has(key))
        {
            const row = parseMarketplaces(marketplaces).find((r) => r.name === key);
            const dir = row && (row.installLocation || row.path);
            let entries = [];
            try { entries = dir ? parseJson(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins || [] : []; }
            catch { entries = []; }
            catalogs.set(key, Array.isArray(entries) ? entries : []);
        }
        return catalogs.get(key).some((e) => e && e.name === name && typeof e.source === 'string' && e.source.startsWith('./'));
    };
    const out = [];
    for (const spec of [...new Set(Object.values(enabled).flatMap((e) => Object.keys(e)))].sort())
    {
        if (effectiveOn(isOn, spec) !== true || reached.has(spec) || fromCatalog(spec)) continue;
        const scope = ['local', 'project', 'user'].find((s) => isOn(spec, s) !== undefined);
        const elsewhere = rows.filter((r) => r && r.id === spec && r.projectPath && !ours(String(r.projectPath))).length;
        out.push({ spec, file: files[scope], elsewhere });
    }
    return out;
}

module.exports = {
    OFFICIAL_MARKETPLACE, STACK_MARKETPLACE, CORE_SPEC, USER_SCOPE_PLUGINS, USER_OFF_WINS, CORE_DEP_PLUGINS, HUD_SPEC, itemScope, scopedItem, moveScoped,
    SCOPES, isManaged, scopeRank, overrideScope, scopesOf, adminOwned, atRelease, leftAt, effectiveOn, withEffective,
    pluginRoutes, committedRoutes, committedRoutesAt, corePluginOn, parsePluginList, parseMarketplaces, fieldOf, scopeFor,
    resolveStackPlugins, selectionLines, pluginSet,
    refreshMarketplaces, stackMarket, refreshStackSource, installPlugins, prunedRetired, dropStaleRetired, retirementDue, updatePlugins, extraMarketplaces,
    copyRouteStandDown, restoreStoodDown, standDownScope, rowsOn, moveLocalRows, hudStatusLineMissing, unreachedPlugins,
};

// `node scripts/install/plugins.js unreached [projectRoot] [--listing <file>] [--marketplaces <file>]` -
// /alfred-code:status's read: one `unreached: <spec>\t<settings file>\t<why>` line per plugin the settings switch on
// that loads nothing here, else `unreached: none`. Without --listing it asks `claude plugin list --json` and
// `claude plugin marketplace list --json`; a plugin listing it cannot read says so. With --listing, the marketplaces
// come from --marketplaces alone (none when it is absent), so a test never spawns the CLI.
if (require.main === module)
{
    require('../../stack/hooks/hook-prelude.js').blockingStdio();
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
    const listingFile = flag('--listing');
    const marketplacesFile = flag('--marketplaces');
    const [cmd, root] = argv;
    if (cmd !== 'unreached') { console.error('usage: plugins.js unreached [projectRoot] [--listing <file>] [--marketplaces <file>]'); process.exit(2); }
    const projectRoot = path.resolve(root || '.');
    const { capture } = require('./runtime.js');
    let listing = '';
    try { listing = listingFile ? fs.readFileSync(listingFile, 'utf8') : capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot }); }
    catch { listing = ''; }
    let marketplaces = '[]';
    try { marketplaces = marketplacesFile ? fs.readFileSync(marketplacesFile, 'utf8') : (listingFile ? '[]' : capture('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: projectRoot })); }
    catch { marketplaces = '[]'; }
    let readable = false;
    try { const data = JSON.parse(listing); readable = Array.isArray(data) || Boolean(data && Array.isArray(data.installed)); }
    catch { readable = false; }
    if (!readable) { console.log('unreached: unknown - the plugin listing could not be read'); process.exit(0); }
    const { accountDir } = require('./stamp.js');
    const found = unreachedPlugins({ listing, projectRoot, configDir: accountDir(), marketplaces });
    for (const u of found)
    {
        const file = path.relative(projectRoot, u.file).startsWith('..') ? u.file : path.relative(projectRoot, u.file).split(path.sep).join('/');
        console.log(`unreached: ${u.spec}\t${file}\t${u.elsewhere ? `installed for ${u.elsewhere} other project(s) only` : 'no install record'} - switched on, loads nothing here; /alfred-code:configure adds it back, or: claude plugin install ${u.spec} --scope project`);
    }
    if (!found.length) console.log('unreached: none');
}
