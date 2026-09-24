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
const path = require('node:path');
const { BRAND, LEGACY, alwaysOn, marketOf, marketKey } = require('./brand.js');

// claude-hud is a statusline HUD: a project-scoped install plus the global statusline enable
// mismatch, so every OTHER project warns 'plugin not cached'. It is user scope, always.
const USER_SCOPE_PLUGINS = ['claude-hud'];
// ...and required, but the user's OFF wins: its status line is account-wide, so a user who disabled it
// keeps it off in every project. Measured on Claude Code 2.1.282: `plugin update` over a user-disabled
// claude-hud leaves `enabledPlugins` false, `plugin install --scope user -y` flips it back to true - so
// a listed, disabled one is only ever updated, never enabled or re-installed. An absent one is installed.
const USER_OFF_WINS = ['claude-hud'];
const offByUser = (spec, listing) => USER_OFF_WINS.includes(bareName(spec)) && fieldOf(listing, spec, 'enabled') === false;

const OFFICIAL_MARKETPLACE = 'anthropics/claude-plugins-official';
const STACK_MARKETPLACE = BRAND.slug;
// The FRESH-install spelling. A 1.x install keeps its own marketplace key, which the run resolves
// (brand.js marketKey) and spells every stack spec with - never this constant.
const CORE_SPEC = `${BRAND.core}@${BRAND.marketplace}`;

// The plugins every install carries beside the core from OTHER marketplaces - required, never a pick
// (R27). Neither is a dependency of the core: `claude plugin update` over an older core installs none
// a release adds, and a plugin missing one is disabled at load, its commands with it (measured on
// 2.1.280) - so the run installs them. claude-hud keeps its user-scope pin above.
const CORE_DEP_PLUGINS = ['superpowers@claude-plugins-official', 'claude-hud@claude-hud'];

// `...=false` restores the copy route - the documented contract, and the only value either twin
// ever promised. (The sh twin read anything but the literal 'true' as off and the ps1 anything but
// 'false' as on; on every documented value they agree, and this takes the documented reading.)
const pluginRoutes = (env = {}) => ({
    hooks: env.ALFRED_CODE_HOOKS_VIA_PLUGIN !== 'false',
    skills: env.ALFRED_CODE_SKILLS_VIA_PLUGIN !== 'false',
    mcps: env.ALFRED_CODE_MCPS_VIA_PLUGIN !== 'false',
});

const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills || routes.mcps);

// `claude plugin list --json` -> one row per plugin NAME. A row carrying a projectPath belongs to
// that project and is dropped unless it is this one; where both exist, THIS project's row wins over
// the account-level one. Anything unparseable is an empty listing, never a crash: the callers all
// treat 'the listing cannot say' as a real answer. `marketplace` keeps only that marketplace's rows,
// BEFORE the per-name pick: the official marketplace ships plugins named like stack entries
// (`serena`, `sentry`, `playwright`), and a name-only read took theirs for ours. `byMarketplace`
// keeps one row per name@marketplace instead, for a pass whose specs come from several, read through
// `fieldOf` with the full spec. `everyScope` keeps one per name@marketplace@scope: the same plugin at
// the account and in this project is two installs, and the 1.x migration moves only its own scope's.
function parsePluginList(json, projectRoot, { marketplace, byMarketplace = false, everyScope = false } = {})
{
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return []; }
    const rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : []);
    const here = path.resolve(projectRoot || '.');
    const best = new Map();
    for (const row of rows)
    {
        if (!row || typeof row !== 'object') continue;
        const [name, market = ''] = String(row.id ?? '').split('@');
        if (!name) continue;
        if (marketplace && market !== marketplace) continue;
        const pp = row.projectPath;
        if (pp && path.resolve(String(pp)) !== here) continue;
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
// matches either way. A 1.x row answers only to its OWN id: 2.0.0 lists the old ids as retired
// aliases, a different plugin from the new core (docs/rebrand-evidence.md S20) - read as the core, it
// would have the run `update` a core never installed, which fails `not_installed` (S19).
const fieldOf = (listing, name, key) =>
{
    const [bare, market] = String(name).split('@');
    const row = (listing || []).find((r) => r.name === bare && (!market || !r.marketplace || r.marketplace === market));
    return row ? row[key] : undefined;
};

const bareName = (spec) => String(spec).split('@')[0];

// Install scope for one plugin: claude-hud is pinned to user, everything else follows the run -
// unless the LISTING already says where it lives, which wins on update.
function scopeFor(spec, installScope, listing)
{
    const known = fieldOf(listing, spec, 'scope');
    if (known) return known;
    return USER_SCOPE_PLUGINS.includes(bareName(spec)) ? 'user' : installScope;
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
// on the full copy route nothing else would bring superpowers either.
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

// THE STACK'S MARKETPLACE KEY for this run. A 1.x install keeps its key (`claude-stack`), and a // legacy-name
// second registration of the new slug would list the stack twice - so the add runs only where the
// key is the current one: a no-op when it is registered already, the registration on a fresh
// account, whose key is then whatever the add actually produced (read back).
function stackMarket({ listing = [], marketplaces = [], readMarketplaces, cli, env = {} })
{
    const found = marketOf({ listing, marketplaces, env });
    if (found.key !== BRAND.marketplace) return found.key;
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
// silent no-op.
//
// Each row by its OWN id, a 1.x one included: 2.0.0 lists the old ids as retired aliases carrying the
// 2.0.0 core, so updating one lands 2.0.0 in the cache under the old name (docs/rebrand-evidence.md
// S21), and the plugin pass moves the install across. `listing` may be a function, read once.
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
// already (the 1.x migration): nothing is left to do for it.
function installPlugins({ plugins, scope, marketplaces = [], before = [], fresh = [], refreshed = new Set(), cli, log = () => {}, note = () => {} })
{
    cli(['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE], { quiet: true });
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    // The official catalog first on every run, whatever the set: Claude Code registers it only on
    // its first INTERACTIVE launch, so an install before that failed every official plugin.
    refreshMarketplaces({ plugins: ['@claude-plugins-official', ...plugins], cli, refreshed });

    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        const pscope = USER_SCOPE_PLUGINS.includes(bareName(spec)) ? 'user' : scope;
        if (offByUser(spec, before))
        {
            log(`plugin [${pscope}]: ${spec} is disabled - kept off, updated only`);
            cli(['plugin', 'update', spec, '--scope', scopeFor(spec, scope, before), '-y'], { quiet: true });
            continue;
        }
        log(`plugin [${pscope}]: ${spec}`);
        // -y: the marketplace-command consent prompt cannot be answered when stdin is not a TTY,
        // which is every guided run.
        if (!cli(['plugin', 'install', spec, '--scope', pscope, '-y'])) { note(`plugin ${spec} failed`); continue; }
        if (fieldOf(before, spec, 'version'))
            cli(['plugin', 'update', spec, '--scope', scopeFor(spec, scope, before), '-y'], { quiet: true });
    }
}

// A retired name's FULL spec: the stack's own plugin under the key the core is listed under (a 1.x
// install keeps its old one), unless its row in meta/retired-plugins.json names another marketplace -
// a third-party pick the stack dropped. Never the bare name: the official catalog ships a `sentry` too.
function retiredSpec(name, market, retiredRows = [])
{
    if (String(name).includes('@')) return String(name);
    const row = retiredRows.find((r) => r && r.name === name);
    return `${name}@${(row && row.marketplace) || market}`;
}

// UPDATE: uninstall the retired plugins this project carries AT THIS RUN'S SCOPE, each by its full
// spec. A name that is not installed here is not an error, it is nothing to do. `rows` holds every
// scope (`parsePluginList` everyScope); a bare `listing` is read the same way.
//
// A row at ANOTHER scope is every other project's install too: it stays, and the run names the
// command that removes it. A CARRIER - a per-stack entry retired in 1.3.0 - is also the migration's
// record: parked, it is the user's off-state for its items, which have no other home once it is gone,
// so it stays at this scope as well. After each uninstall the row's add-back line is printed: the
// retirement takes the plugin, never the user's way back to the server.
function prunedRetired({ rows, listing, retired = [], retiredRows = [], carriers = [], market = BRAND.marketplace, scope, cli, log = () => {} })
{
    const all = rows || listing || [];
    const gone = [];
    const addBack = (name) => (retiredRows.find((r) => r && r.name === name) || {}).addBack;
    let left = [];
    for (const name of [...new Set(retired)])
    {
        const spec = retiredSpec(name, market, retiredRows);
        const [bare, mp] = spec.split('@');
        const carrier = carriers.includes(bare);
        for (const r of all.filter((x) => x.name === bare && x.marketplace === mp && x.version))
        {
            const at = r.scope || scope;
            if (carrier && r.enabled === false)
                log(`  ${spec} is parked here - kept, so its skills and seats stay off; remove it by hand once they may come back: claude plugin uninstall ${spec} --scope ${at}`);
            else if (at !== scope)
                log(`  ${spec} is installed at ${at} scope, not this run's - kept for the projects that use it; the update run at that scope ${carrier ? 'copies its picks and removes it' : 'removes it'}: claude plugin uninstall ${spec} --scope ${at}`);
            else if (!left.some((x) => x.spec === spec)) left.push({ spec, name: bare });
        }
    }
    // A per-stack leaf declares its shared entries as dependencies and the CLI refuses to remove a
    // dependency first, so a refusal is retried once everything else in the pass has gone.
    for (let pass = 0; pass < 2 && left.length; pass++)
    {
        const next = [];
        for (const item of left)
        {
            if (cli(['plugin', 'uninstall', item.spec, '--scope', scope, '-y'], { quiet: true }))
            {
                log(`  plugin pruned (retired upstream) [${scope}]: ${item.spec}`);
                const back = addBack(item.name);
                if (back) log(`    add it back: ${back.split('<scope>').join(scope)}`);
                gone.push(item.name);
            }
            else next.push(item);
        }
        left = next;
    }
    return gone;
}

// THE 1.x MOVE. 2.0.0 ships no rename: the 1.x ids stay listed as RETIRED aliases - the core's alias
// carries the 2.0.0 core under its old name, the hooks alias nothing (docs/rebrand-evidence.md S20) -
// so the install is moved here, at the old core's own scope and key. The new core is INSTALLED, never
// `update`d (it was never installed under any name, S19), and only once that took, the retired
// per-stack entries go the `prunedRetired` way, then the hooks alias, then the core alias - the order
// their dependencies allow (S22). A failed install removes NOTHING, since the old core is what still
// carries the guards; an old core at another scope is every other project's install too, so it stays
// and is named. The new core already here beside a 1.x id at this scope is a move an earlier run did
// not finish (an uninstall refused, or cut short): the install is skipped and the removals retried,
// in the same order. `ran` says the retired pass ran here. `rows` keeps every scope
// (`parsePluginList` everyScope), which is what `prunedRetired` reads too - under the old core's key.
function migrateLegacy({ rows = [], scope, retired = [], retiredRows = [], carriers = [], cli, log = () => {}, note = () => {} })
{
    const out = { fresh: [], gone: [], removed: [], failed: null, ran: false };
    const named = (name, key) => rows.filter((r) => r.name === name && (!key || r.marketplace === key));
    const here = (name, key) => named(name, key).some((r) => r.scope === scope);
    const kept = (r) => log(`  ${r.name}@${r.marketplace} is installed at ${r.scope} scope, not this run's - kept for the projects that use it; the update run at that scope moves it across: claude plugin uninstall ${r.name}@${r.marketplace} --scope ${r.scope}`);
    for (const r of named(LEGACY.core).filter((x) => x.scope !== scope)) kept(r);
    const core = named(LEGACY.core).find((r) => r.scope === scope && !here(BRAND.core, r.marketplace));
    const left = core ? null : [...named(LEGACY.core), ...named(LEGACY.hooks)].find((r) => r.scope === scope && here(BRAND.core, r.marketplace));
    if (!core && !left) return out;

    const key = (core || left).marketplace;
    const spec = `${BRAND.core}@${key}`;
    if (core)
    {
        const install = ['plugin', 'install', spec, '--scope', scope, '-y'];
        log(`plugin [${scope}]: ${spec} (moves the 1.x install across - installed before its old ids go)`);
        if (!cli(install))
        {
            out.failed = spec;
            note(`the 1.x install was not moved - 'claude ${install.join(' ')}' failed, so nothing was removed and the old core keeps the guards running; run it by hand, then update again`);
            return out;
        }
        out.fresh.push(spec);
    }
    else log(`plugin [${scope}]: ${spec} is installed beside a 1.x id - the removals an earlier move left are retried`);
    out.ran = true;
    out.gone = prunedRetired({ rows, retired, retiredRows, carriers, market: key, scope, cli, log });
    for (const name of [LEGACY.hooks, LEGACY.core])
        for (const r of named(name, key))
        {
            if (r.scope !== scope) { if (name === LEGACY.hooks) kept(r); continue; }
            const id = `${name}@${key}`;
            if (cli(['plugin', 'uninstall', id, '--scope', scope, '-y'], { quiet: true }))
            { log(`  plugin removed (a 1.x id, now a retired alias) [${scope}]: ${id}`); out.removed.push(r); }
            else note(`plugin uninstall failed: ${id} - its hooks run beside the new core's until it goes; the next update retries it, or: claude plugin uninstall ${id} --scope ${scope}`);
        }
    return out;
}

// The third-party marketplaces THIS run needs registered: the source each installed plugin's
// manifest row names. A source for a plugin the run does not install is never added to the account.
function extraMarketplaces(rows, set)
{
    return [...new Set((rows || []).filter((r) => r.marketplace && set.includes(r.id)).map((r) => r.marketplace))];
}

// UPDATE: adopt, enable, update, then READ THE VERSIONS BACK. An absent plugin is INSTALLED here, so
// its marketplace is registered first, exactly as the install pass does. `fresh` names what this run
// installed already (the 1.x migration): it is not touched again, and it is ENABLED - its install
// said so, while the listing's own flag can read a fresh project-scope install as disabled
// (docs/rebrand-evidence.md S22).
function updatePlugins({ plugins, scope, marketplaces = [], before = [], after, fresh = [], refreshed = new Set(), cli, log = () => {} })
{
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    refreshMarketplaces({ plugins, cli, refreshed });
    for (const spec of plugins)
    {
        if (fresh.includes(spec)) continue;
        const pscope = scopeFor(spec, scope, before);
        if (!fieldOf(before, spec, 'version'))
        {
            log(`plugin install [${pscope}]: ${spec}`);
            cli(['plugin', 'install', spec, '--scope', pscope, '-y']);
        }
        // The core is locked on (brand.js alwaysOn): its flag is no reason to act. A user-disabled
        // claude-hud stays off (USER_OFF_WINS).
        else if (fieldOf(before, spec, 'enabled') === false && !alwaysOn(bareName(spec)) && !offByUser(spec, before))
        {
            log(`plugin enable [${pscope}]: ${spec} (installed but disabled)`);
            cli(['plugin', 'enable', spec, '--scope', pscope]);
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

module.exports = {
    OFFICIAL_MARKETPLACE, STACK_MARKETPLACE, CORE_SPEC, USER_SCOPE_PLUGINS, USER_OFF_WINS, CORE_DEP_PLUGINS,
    pluginRoutes, corePluginOn, parsePluginList, parseMarketplaces, fieldOf, scopeFor, migrateLegacy,
    resolveStackPlugins, selectionLines, pluginSet,
    refreshMarketplaces, stackMarket, refreshStackSource, installPlugins, prunedRetired, updatePlugins, extraMarketplaces,
};
