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
const { BRAND, currentName, marketOf, marketKey } = require('./brand.js');

// claude-hud is a statusline HUD: a project-scoped install plus the global statusline enable
// mismatch, so every OTHER project warns 'plugin not cached'. It is user scope, always.
const USER_SCOPE_PLUGINS = ['claude-hud'];

const OFFICIAL_MARKETPLACE = 'anthropics/claude-plugins-official';
const STACK_MARKETPLACE = BRAND.slug;
// The FRESH-install spelling. A 1.x install keeps its own marketplace key, which the run resolves
// (brand.js marketKey) and spells every stack spec with - never this constant.
const CORE_SPEC = `${BRAND.core}@${BRAND.marketplace}`;

// The plugin every install carries beside the core from ANOTHER marketplace. It is not a dependency
// of the core: `claude plugin update` over an older core installs none a release adds, and a plugin
// missing one is disabled at load, its commands with it (measured on 2.1.280) - so the run installs it.
const CORE_DEP_PLUGINS = ['superpowers@claude-plugins-official'];

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
// `fieldOf` with the full spec. `renamed` is the NEW name a refreshed catalog gave the row (a
// `plugin-renamed` note on the old id, docs/rebrand-evidence.md S9) - the id `plugin update` takes.
function parsePluginList(json, projectRoot, { marketplace, byMarketplace = false } = {})
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
        const key = byMarketplace ? `${name}@${market}` : name;
        const prev = best.get(key);
        if (prev && prev.rank <= rank) continue;
        const note = (Array.isArray(row.noteDetails) ? row.noteDetails : []).find((n) => n && n.type === 'plugin-renamed' && n.related);
        best.set(key, {
            rank, name, marketplace: market,
            version: String(row.version ?? '?'),
            scope: String(row.scope ?? ''),
            enabled: row.enabled !== false,
            ...(note ? { renamed: String(note.related) } : {}),
        });
    }
    return [...best.values()].map(({ rank, ...row }) => row);
}

// `name` alone, or a full `name@marketplace` spec - which never matches another marketplace's row of
// the same name (the official `serena`, `sentry`, `playwright`). A row that names no marketplace
// matches either way. A 1.x row is found by the name it goes by now - its rename note, or the old core
// and hooks names - so a renamed plugin is updated in place, never installed beside itself.
const fieldOf = (listing, name, key) =>
{
    const [bare, market] = String(name).split('@');
    const named = (r) => r.name === bare || r.renamed === bare || currentName(r.name) === bare;
    const row = (listing || []).find((r) => named(r) && (!market || !r.marketplace || r.marketplace === market));
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
function selectionLines({ routes, skills = [], agents = [], mcps = [], context7Mode })
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
        // The local context7 transport is its OWN entry beside the hosted one: two servers in one
        // plugin both load, so local mode ADDS a plugin rather than swapping a server.
        if (context7Mode === 'local') lines.push('mcp context7-local');
    }
    return lines;
}

// Everything this run hands to `claude plugin install`, in order: the third-party picks, then the
// stack's own entries (the hooks plugin first, so it resolves in the same run that prunes the
// copied hooks it replaces), then the core's companions. While the core is on, the locked servers
// ride as plugins: the selection names them on the MCP route, and any it did not name join here.
// `coreDeps` join on every route - on the full copy route nothing else would bring superpowers either.
function pluginSet({ routes, thirdParty = [], hooksPlugin, stackEntries = [], coreDeps = [], locked = [], market = BRAND.marketplace })
{
    const stack = [];
    if (corePluginOn(routes))
    {
        if (routes.hooks && hooksPlugin) stack.push(hooksPlugin);
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
// `listing` may be a function: it is read again AFTER the catalog refresh, because only a refreshed
// catalog marks a renamed row, and the old id then fails `not_found` (docs/rebrand-evidence.md S2,
// S9) - such a row is updated by the new id its note names, which also lands the renamed cache dir
// (S8). Returns the marketplace key the run uses.
function refreshStackSource({ listing = [], marketplaces = [], readMarketplaces, cli, refreshed = new Set(), log = () => {}, env = {} })
{
    const read = () => (typeof listing === 'function' ? listing() : listing) || [];
    const market = stackMarket({ listing: read(), marketplaces, readMarketplaces, cli, env });
    refreshMarketplaces({ plugins: [`${BRAND.core}@${market}`], cli, refreshed });
    for (const row of read())
    {
        if (row.marketplace !== market || !row.version || !row.scope) continue;
        const name = row.renamed || row.name;
        log(`plugin update [${row.scope}]: ${name}@${market} (before the snapshot is read)`);
        cli(['plugin', 'update', `${name}@${market}`, '--scope', row.scope, '-y'], { quiet: true });
    }
    return market;
}

// INSTALL: register the marketplaces, refresh them, then install each plugin at its scope - and
// update one the listing already carries, which `install` leaves where it was. A failure is noted
// and the run continues - fail-soft, like every other layer.
function installPlugins({ plugins, scope, marketplaces = [], before = [], refreshed = new Set(), cli, log = () => {}, note = () => {} })
{
    cli(['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE], { quiet: true });
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    // The official catalog first on every run, whatever the set: Claude Code registers it only on
    // its first INTERACTIVE launch, so an install before that failed every official plugin.
    refreshMarketplaces({ plugins: ['@claude-plugins-official', ...plugins], cli, refreshed });

    for (const spec of plugins)
    {
        const pscope = USER_SCOPE_PLUGINS.includes(bareName(spec)) ? 'user' : scope;
        log(`plugin [${pscope}]: ${spec}`);
        // -y: the marketplace-command consent prompt cannot be answered when stdin is not a TTY,
        // which is every guided run.
        if (!cli(['plugin', 'install', spec, '--scope', pscope, '-y'])) { note(`plugin ${spec} failed`); continue; }
        if (fieldOf(before, spec, 'version'))
            cli(['plugin', 'update', spec, '--scope', scopeFor(spec, scope, before), '-y'], { quiet: true });
    }
}

// UPDATE: uninstall the retired names this machine actually carries, at the scope the listing
// reports. A name that is not installed here is not an error, it is nothing to do.
//
// A CARRIER - a per-stack entry retired in 1.3.0 - is also the migration's record: parked, it is
// the user's off-state for its items, which have no other home once it is gone; at another scope it
// is every other project's install too. Either way it stays, and the run says how to remove it.
function prunedRetired({ listing, retired = [], carriers = [], scope, cli, log = () => {} })
{
    const gone = [];
    const kept = (name) =>
    {
        if (!carriers.includes(name)) return false;
        const at = fieldOf(listing, name, 'scope') || scope;
        if (fieldOf(listing, name, 'enabled') === false)
            log(`  ${name} is parked here - kept, so its skills and seats stay off; remove it by hand once they may come back: claude plugin uninstall ${name} --scope ${at}`);
        else if (at !== scope)
            log(`  ${name} is installed at ${at} scope, not this run's - kept for the projects that use it; the update run at that scope copies its picks and removes it: claude plugin uninstall ${name} --scope ${at}`);
        else return false;
        return true;
    };
    let left = retired.filter((name) => fieldOf(listing, name, 'version') && !kept(name));
    // A per-stack leaf declares its shared entries as dependencies and the CLI refuses to remove a
    // dependency first, so a refusal is retried once everything else in the pass has gone.
    for (let pass = 0; pass < 2 && left.length; pass++)
    {
        const next = [];
        for (const name of left)
        {
            const pscope = fieldOf(listing, name, 'scope') || scope;
            if (cli(['plugin', 'uninstall', name, '--scope', pscope, '-y'], { quiet: true }))
            {
                log(`  plugin pruned (retired upstream) [${pscope}]: ${name}`);
                gone.push(name);
            }
            else next.push(name);
        }
        left = next;
    }
    return gone;
}

// The third-party marketplaces THIS run needs registered: the source each installed plugin's
// manifest row names. A source for a plugin the run does not install is never added to the account.
function extraMarketplaces(rows, set)
{
    return [...new Set((rows || []).filter((r) => r.marketplace && set.includes(r.id)).map((r) => r.marketplace))];
}

// UPDATE: adopt, enable, update, then READ THE VERSIONS BACK. An absent plugin is INSTALLED here, so
// its marketplace is registered first, exactly as the install pass does.
function updatePlugins({ plugins, scope, marketplaces = [], before = [], after, refreshed = new Set(), cli, log = () => {} })
{
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });
    refreshMarketplaces({ plugins, cli, refreshed });
    for (const spec of plugins)
    {
        const pscope = scopeFor(spec, scope, before);
        if (!fieldOf(before, spec, 'version'))
        {
            log(`plugin install [${pscope}]: ${spec}`);
            cli(['plugin', 'install', spec, '--scope', pscope, '-y']);
        }
        else if (fieldOf(before, spec, 'enabled') === false)
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
        if (!is) line = `  plugin ${name}: NOT installed - the install above did not take (is the marketplace reachable?)`;
        else if (fieldOf(now, spec, 'enabled') === false) line = `  plugin ${name}: ${is} but DISABLED - 'claude plugin enable ${spec}' turns it back on`;
        else if (was && was !== is) line = `  plugin ${name}: ${was} -> ${is}`;
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
    OFFICIAL_MARKETPLACE, STACK_MARKETPLACE, CORE_SPEC, USER_SCOPE_PLUGINS, CORE_DEP_PLUGINS,
    pluginRoutes, corePluginOn, parsePluginList, parseMarketplaces, fieldOf, scopeFor,
    resolveStackPlugins, selectionLines, pluginSet,
    refreshMarketplaces, stackMarket, refreshStackSource, installPlugins, prunedRetired, updatePlugins, extraMarketplaces,
};
