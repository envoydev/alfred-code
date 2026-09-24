'use strict';
// THE SELECTION - which of the six manifest lists this run actually installs.
//
// Two ways in, and they meet in the same filter:
//
//   - `--selection <file>`: one `category name` per line, from a guided walk. The filter INTERSECTS
//     with the manifest, so a name the manifest does not carry can never be installed - which is
//     what makes a user-authored skill or rule safe by construction.
//   - `--installed-only`: derive that file from what the target already carries, then refresh
//     exactly that. The update fast path.
//
// Three rules that are each a bug that shipped:
//
//   - A SELECTION WITH NO `hook` LINES INSTALLS EVERY HOOK. Hooks joined the walk later, so a file
//     written before that layer must keep its install-everything behaviour. `--installed-only`
//     answers this by emptying the hook list itself when the disk carries none.
//   - A HOOK THIS RELEASE ADDED REACHES AN EXISTING INSTALL ONLY HERE, so hooks are all-or-nothing
//     on the derived path: an install that HAS hooks gets every shipped one. The exception is a
//     DELIBERATE DROP - a hook named in the previous stamp and absent now was removed through
//     configure and stays removed.
//   - THE ALWAYS-ON BASELINE IS ADOPTED THE SAME WAY, with NO drop exception: the always set is
//     locked, so an always item absent from disk is adopted whatever the stamp says. A stamp naming
//     the shipped list once read as a drop of everything, and the memory rule never arrived.
const fs = require('node:fs');
const path = require('node:path');
const { readInstalled, stampCarried, splitPick, homeOf, retiredHomeOf, stackSeat } = require('../derive-state.js');
const { hookDisabled, envOf } = require('../../stack/hooks/hook-prelude.js');
const { BRAND, currentName, rowOn } = require('./brand.js');

// A generated, project-owned file is not a stack item: the captures rewrite those.
const RULE_EXCLUDE = /^(baseline-project-.*|project-code-style)$/;
// docs.js / memory.js / history.js / fresh-session.js are ENGINES and hook-prelude.js the shared gate module - none is a hook.
const HOOK_EXCLUDE = /^(inject-code-style|docs|memory|history|hook-prelude|fresh-session)$/;
const PW_ENGINE = /^playwright-(chrome|msedge|firefox|webkit)$/;

const nameOfSkill = (entry) => String(entry).split('|').pop();
const nameOfMcp = (entry) => String(entry).split('|')[0];
const nameOfPlugin = (entry) => String(entry).split('@')[0];
const nameOfFile = (entry) => String(entry).split('::')[0].replace(/\.(md|js)$/, '');

const CATEGORY = {
    skills: { line: 'skill', name: nameOfSkill },
    plugins: { line: 'plugin', name: nameOfPlugin },
    mcps: { line: 'mcp', name: nameOfMcp },
    agents: { line: 'agent', name: nameOfFile },
    rules: { line: 'rule', name: nameOfFile },
    hooks: { line: 'hook', name: nameOfFile },
};

// '#' comments and blank lines ignored, exactly as the shell's grep -qxF sees them.
function parseSelection(text)
{
    const picked = new Set();
    for (const raw of String(text).split('\n'))
    {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        picked.add(line);
    }
    return picked;
}

// Keep only the entries the selection names. HOOKS are the special case: no `hook` line at all
// means the file predates the hooks layer, and every hook stays.
function applySelection(lists, picked)
{
    const hasHooks = [...picked].some((l) => l.startsWith('hook '));
    const out = {};
    for (const [key, { line, name }] of Object.entries(CATEGORY))
    {
        const entries = lists[key] || [];
        if (key === 'hooks' && !hasHooks) { out.hooks = [...entries]; continue; }
        out[key] = entries.filter((entry) => picked.has(`${line} ${name(entry)}`));
    }
    return out;
}

// The dry run. One hook wired on two tools is ONE hook in the plan.
function renderPlan(lists)
{
    const seen = new Set();
    const hooks = (lists.hooks || []).map(nameOfFile).filter((n) => !seen.has(n) && seen.add(n));
    return [
        `plan skills: ${(lists.skills || []).map(nameOfSkill).join(' ')}`,
        `plan plugins: ${(lists.plugins || []).map(nameOfPlugin).join(' ')}`,
        `plan mcps: ${(lists.mcps || []).map(nameOfMcp).join(' ')}`,
        `plan agents: ${(lists.agents || []).map(nameOfFile).join(' ')}`,
        `plan rules: ${(lists.rules || []).map(nameOfFile).join(' ')}`,
        `plan hooks: ${hooks.join(' ')}`,
    ].map((l) => l.replace(/: $/, ':'));
}

const listDir = (dir, test) =>
{
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(test).map((d) => d.name); }
    catch { return []; }
};

// What the TARGET carries, read off disk. Generated project-owned files and the engine modules are
// excluded; a playwright engine server collapses back to the one manifest entry it expands from.
// `skillsDir`: a global install keeps its skills in the account dir, everything else in the project.
function deriveFromDisk({ claudeDir, skillsDir = path.join(claudeDir, 'skills'), mcpServers = [], plugins = [], knownPlugins = [] })
{
    const lines = [];
    for (const name of listDir(skillsDir, (d) => d.isDirectory()))
        if (fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) lines.push(`skill ${name}`);
    for (const f of listDir(path.join(claudeDir, 'agents'), (d) => d.isFile() && d.name.endsWith('.md')))
        lines.push(`agent ${f.replace(/\.md$/, '')}`);
    for (const f of listDir(path.join(claudeDir, 'rules'), (d) => d.isFile() && d.name.endsWith('.md')))
    {
        const name = f.replace(/\.md$/, '');
        if (!RULE_EXCLUDE.test(name)) lines.push(`rule ${name}`);
    }
    for (const f of listDir(path.join(claudeDir, 'hooks'), (d) => d.isFile() && d.name.endsWith('.js')))
    {
        const name = f.replace(/\.js$/, '');
        if (!HOOK_EXCLUDE.test(name)) lines.push(`hook ${name}`);
    }
    const seenMcp = new Set();
    for (const server of mcpServers)
    {
        const name = String(server).replace(PW_ENGINE, 'playwright');
        if (!seenMcp.has(name)) { seenMcp.add(name); lines.push(`mcp ${name}`); }
    }
    // Plugins are machine-level, so they come from the CLI listing rather than a project directory -
    // without this the fast path filtered PLUGINS to empty and `update` ran on nothing.
    const known = new Set(knownPlugins.map(nameOfPlugin));
    const seenPlugin = new Set();
    for (const p of plugins)
    {
        const name = nameOfPlugin(p);
        if (known.has(name) && !seenPlugin.has(name)) { seenPlugin.add(name); lines.push(`plugin ${name}`); }
    }
    // None listed is none picked. No fallback to the manifest's set, even when the CLI could not be
    // read: update INSTALLS an absent plugin, so that fallback put all five on a project whose user
    // had picked none of them.
    return lines;
}

// The FILE layers only. Plugins are machine-level and servers come from a shared file; neither is
// evidence that THIS target has an install.
const hasInstall = (lines) => lines.some((l) => /^(skill|agent|rule|hook) /.test(l));

// Hooks: adopt every shipped one, except a name the PREVIOUS stamp shipped and disk no longer has.
function adoptHooks({ lines, catalog = [], shippedBefore = [], log = () => {} })
{
    if (!lines.some((l) => l.startsWith('hook '))) return lines;
    const have = new Set(lines.filter((l) => l.startsWith('hook ')).map((l) => l.slice(5)));
    const dropped = new Set(shippedBefore);
    const out = [...lines];
    for (const entry of catalog)
    {
        const name = nameOfFile(entry);
        if (have.has(name)) continue;
        if (dropped.has(name)) { log(`installed-only: hook ${name} was dropped from this install - leaving it out`); continue; }
        out.push(`hook ${name}`);
        have.add(name);
        log(`installed-only: adopting hook ${name} - shipped by this release and absent here`);
    }
    return out;
}

// The always-on baseline, with NO drop exception - the set is locked, like serena. A layer this
// install does not carry AT ALL (no rule line, or no mcp line) stays absent.
function adoptAlways({ lines, always = {}, log = () => {} })
{
    const out = [...lines];
    for (const [category, key] of [['rule', 'rules'], ['mcp', 'mcps']])
    {
        if (!out.some((l) => l.startsWith(`${category} `))) continue;
        for (const name of always[key] || [])
        {
            if (out.includes(`${category} ${name}`)) continue;
            out.push(`${category} ${name}`);
            log(`installed-only: adopting ${category} ${name} - always shipped by this release and absent here`);
        }
    }
    return out;
}

// THE --installed-only READ-BACK, whole. The disk first (the copy routes, the extras, the rules),
// then the state each PLUGIN route writes - on those routes `.claude/` holds only the extras, and a
// disk-only read derived every seat and hook as dropped. The plugin state is read from the ENABLED
// entries of this stack's marketplace only: a parked entry stays parked, and another marketplace's
// `serena` or `sentry` is not ours. `answered` names the surfaces the read found EVIDENCE of; the
// caller writes nothing back for the others, so a listing that could not be read (no CLI, a failed
// call) switches nothing off instead of switching everything off for good.
function readBack({ claudeDir, skillsDir, mcpServers = [], listing = [], stackListing, settings, routes = {}, manifest, sourceDir, stampHooks = [], stampPicked, always = {}, marketplace = BRAND.marketplace, log = () => {} })
{
    let lines = deriveFromDisk({ claudeDir, skillsDir, mcpServers, plugins: listing.map((r) => r.name), knownPlugins: manifest.plugins });
    const none = { lines, closeFrom: [], parked: [], deny: [], installed: false, answered: { hooks: false, agents: false }, engines: [], context7Local: false };
    const ours = (stackListing || listing).filter((r) => r.marketplace === marketplace);
    // On the plugin routes an install whose every pick an entry carries, with no rule copied, leaves
    // nothing on disk - its own enabled entries are the evidence then. Only this PROJECT's: an account
    // entry is every project's, and would read a project the stack never touched as installed.
    // The core and the hooks entry count as enabled whatever their flag (brand.js rowOn, S22).
    const ownEntries = ours.some((r) => rowOn(r) && (r.scope === 'project' || r.scope === 'local'));
    if (!hasInstall(lines) && !ownEntries) return none;

    // What the user PICKED - the disk and the stamp - is what the closure runs over; an item an
    // enabled entry merely carries is not a pick.
    const closeFrom = [...lines];
    // A 1.x listing can still name the core and the hooks entry by their old names: the same entries.
    const names = ours.filter(rowOn).map((r) => currentName(r.name));
    const stored = settings && typeof settings === 'object' ? settings : {};
    const env = stored.env && typeof stored.env === 'object' ? stored.env : {};
    const deny = stored.permissions && Array.isArray(stored.permissions.deny) ? stored.permissions.deny : [];
    const parked = ours.filter((r) => !rowOn(r)).map((r) => currentName(r.name));
    // A 1.x settings file spells the switch-off CLAUDE_STACK_HOOKS_OFF until this run's env pass renames it. // legacy-name
    const installed = readInstalled({ plugins: names, deny, hooksOff: envOf(env, 'HOOKS_OFF'), routes, sourceDir });
    // The walk's None held across a release: every hook the LAST release shipped is switched off, so
    // a hook this one added stays off too rather than arriving on alone.
    const noneBefore = routes.hooks && names.includes(BRAND.hooks) && stampHooks.length > 0
        && stampHooks.every((h) => hookDisabled(h, { ALFRED_CODE_HOOKS_OFF: String(envOf(env, 'HOOKS_OFF') || '') }));
    // A retired entry carries its whole stack, picked or not, and the library copies what the
    // selection holds - so with the stamp's picks to go by, an item only an enabled retired entry
    // carries joins it only as a pick; one a kept pick requires comes back through the closure. A
    // stamp without picks takes everything (the adoption path below).
    const picks = ours.length && stampPicked
        ? new Set(['skill', 'agent'].flatMap((k) => (stampPicked[`${k}s`] || []).map((e) => `${k} ${splitPick(e).name}`)))
        : null;
    const { placement, readRetiredEntries } = require('../plugin-placement.js');
    const place = picks ? placement() : null;
    const retired = picks ? readRetiredEntries() : [];
    const unpickedRetired = (line) =>
    {
        const m = picks && /^(skill|agent) (\S+)$/.exec(line);
        if (!m || picks.has(line) || homeOf(place, `${m[1]}s`, m[2])) return false;
        return names.includes(retiredHomeOf(`${m[1]}s`, m[2], retired));
    };
    for (const line of noneBefore ? installed.filter((l) => !l.startsWith('hook ')).concat('hook none') : installed)
        if (!lines.includes(line) && !unpickedRetired(line)) lines.push(line);
    if (noneBefore && installed.some((l) => l.startsWith('hook ') && l !== 'hook none'))
        log('installed-only: every hook was switched off - the hooks this release added stay off too');
    // Only with a listing to say which entries are enabled and parked - without one the stamp would
    // re-enable them.
    if (ours.length && stampPicked)
        for (const line of stampCarried({ stamp: stampPicked, enabled: names, parked, deny, routes }))
            if (!lines.includes(line)) { lines.push(line); log(`installed-only: keeping ${line} - the last install carried it and this release moved it`); }
    if (stampPicked)
        for (const [kind, line] of [['skills', 'skill'], ['agents', 'agent']])
            for (const entry of stampPicked[kind] || [])
            {
                const pick = `${line} ${splitPick(entry).name}`;
                if (lines.includes(pick) && !closeFrom.includes(pick)) closeFrom.push(pick);
            }
    // A stamp that never recorded its picks (an older release, the shell twin): the skills and seats
    // the enabled entries carry are the best evidence of what was picked - that release enabled them
    // for its selection. Taken as picks once, so the stamp this run writes records them, instead of an
    // empty line that would leave a moved item nothing to carry it across.
    if (stampPicked === null && ours.length)
    {
        const adopted = installed.filter((l) => /^(skill|agent) /.test(l) && lines.includes(l) && !closeFrom.includes(l));
        closeFrom.push(...adopted);
        if (adopted.length) log(`installed-only: the stamp predates recorded picks - ${adopted.length} skills and seats the enabled entries carry are recorded as picked`);
    }

    const answered = { hooks: lines.some((l) => l.startsWith('hook ')), agents: names.includes(BRAND.core) };
    const engines = routes.mcps ? names.map((n) => (/^playwright-(chrome|msedge|firefox|webkit)$/.exec(n) || [])[1]).filter(Boolean) : [];
    const context7Local = Boolean(routes.mcps) && names.includes('context7-local');
    // Adoption is for hooks read off DISK. Read from the hooks entry, ALFRED_CODE_HOOKS_OFF is the
    // whole answer already - a hook it does not name is on, a new release's included - and adopting
    // against an older stamp would switch back on the very hooks the user named there.
    if (!(routes.hooks && names.includes(BRAND.hooks)))
        lines = adoptHooks({ lines, catalog: manifest.catalogs.hooks, shippedBefore: stampHooks, log });
    lines = adoptAlways({ lines, always, log });
    for (const line of lines) if (/^(rule|mcp|plugin|hook) /.test(line) && !closeFrom.includes(line)) closeFrom.push(line);
    // No stack row at all: the listing could not be read (or nothing of ours is installed), so this
    // run cannot tell a pick the user dropped from one it merely cannot see.
    return { lines, closeFrom, parked, deny, installed: true, answered, engines, context7Local, blind: !ours.length };
}

// `--add`: the items the user said yes to (update's new-item ask, configure's add), on top of the
// read-back. Duplicates are dropped; each real addition is logged.
function addLines(lines, add = [], log = () => {})
{
    const out = [...lines];
    for (const line of add) if (!out.includes(line)) { out.push(line); log(`installed-only: adding ${line} - named by --add`); }
    return out;
}

// The read-back CLOSED through the graph, as the frozen twin does: a dependency a new release
// introduced, or one an --add pulls in, arrives with what needs it. `from` is what the user picked;
// hook lines are leaf picks and pass through untouched (`hook none` included), and a name the graph
// does not know - the user's own item - is left where it is.
function closeLines(lines, { from = [], graph, parked = [], deny = [], log = () => {} } = {})
{
    if (!graph || !graph.catalog) { log('installed-only: closure skipped - no dependency graph in this source'); return [...lines]; }
    const { computeClosure, findUnknownNames, dropUnknownNames, categoryOf } = require('../stack-select.js');
    const key = { skill: 'skills', agent: 'agents', rule: 'rules', mcp: 'mcps', plugin: 'plugins' };
    const raw = { skills: [], agents: [], rules: [], mcps: [], plugins: [] };
    for (const l of from) { const [cat, ...rest] = String(l).split(' '); if (key[cat]) raw[key[cat]].push(rest.join(' ')); }
    const unknown = findUnknownNames(graph, raw);
    const known = unknown.length ? dropUnknownNames(raw, unknown) : raw;
    // The user's own off-state wins over a requirement: a parked entry stays parked and a denied seat
    // stays denied - left out and said so, never switched back on behind them. A left-out item's own
    // requirements go with it: its node is blanked and the closure recomputed until nothing new is
    // left out.
    const { placement, readRetiredEntries } = require('../plugin-placement.js');
    const place = placement();
    const retired = readRetiredEntries();
    const off = new Set(parked);
    const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
    const offReason = (category, name) =>
    {
        // A library item's home is the retired entry that carried it, while that entry is installed.
        const kind = `${category}s`;
        const home = category === 'skill' || category === 'agent' ? homeOf(place, kind, name) || retiredHomeOf(kind, name, retired) : null;
        if (home && off.has(home)) return `its entry ${home} is parked here`;
        if (category === 'agent' && denied.has(name)) return 'switched off in permissions.deny';
        return null;
    };
    const left = new Map();
    let g = graph;
    let closure = computeClosure(g, known);
    for (;;)
    {
        let grew = false;
        for (const [name, why] of Object.entries(closure.reasons))
        {
            const category = categoryOf(closure, name);
            const reason = offReason(category, name);
            if (reason && !left.has(name)) { left.set(name, { category, why, reason }); grew = true; }
        }
        if (!grew) break;
        const blank = (kind, empty) => Object.fromEntries(Object.entries(g[kind]).map(([n, node]) => [n, left.has(n) ? empty : node]));
        g = { ...g, skills: blank('skills', { mcps: [], plugins: [] }), agents: blank('agents', { skills: [], agents: [], mcps: [], plugins: [] }) };
        closure = computeClosure(g, known);
    }
    const out = [...lines];
    for (const [name, { category, why, reason }] of left)
        if (!out.includes(`${category} ${name}`)) log(`installed-only: required: ${category} ${name} - ${why}; left out, ${reason}`);
    for (const [name, why] of Object.entries(closure.reasons))
    {
        const line = `${categoryOf(closure, name)} ${name}`;
        if (left.has(name) || out.includes(line)) continue;
        out.push(line);
        log(`installed-only: required: ${line} - ${why}`);
    }
    return out;
}

// `--drop`: the items the user switched off (configure's drop, update carrying a renamed item's
// off-state onto its new name), removed after the closure. Dropping the last hook line keeps the
// hooks answered as `hook none` - no hook line at all would read as 'every hook'.
function dropLines(lines, drop = [], log = () => {})
{
    const had = lines.some((l) => l.startsWith('hook '));
    const out = lines.filter((l) => { const gone = drop.includes(l); if (gone) log(`installed-only: dropping ${l} - named by --drop`); return !gone; });
    if (had && !out.some((l) => l.startsWith('hook '))) out.push('hook none');
    return out;
}

// configure and validate read the install through this, never by hand: the read-back the update
// itself would write back, as the inventory JSON their walk takes (`stack-select --installed`). A
// hand inventory unioned what the entries CARRY without the denied seats, so every configure run
// switched them back on. A plugin the listing shows disabled is the third state validate keeps
// apart - parked, neither installed nor absent.
const foldMcp = (name) => (PW_ENGINE.test(name) ? 'playwright' : name === 'context7-local' ? 'context7' : name);
//
// `pluginCatalog` is every plugin the catalog names, the core's companions included: an
// enabled one is installed whatever the selection says (every run installs superpowers), or an
// unchanged walk would add it back on every run. `leftOut` is what the user switched off - the
// seats denied, the items of a parked entry - so the walk's closure cannot quietly turn it back on.
function planInventory({ lists, listing = [], answered, pluginCatalog = [], leftOut = [] })
{
    const uniq = (xs) => [...new Set(xs)];
    const rowOf = new Map(listing.map((r) => [r.name, r]));
    const picked = uniq([...(lists.plugins || []).map(nameOfPlugin), ...pluginCatalog.filter((n) => rowOf.has(n) && rowOf.get(n).enabled)]);
    return {
        skills: uniq((lists.skills || []).map(nameOfSkill)),
        agents: uniq((lists.agents || []).map(nameOfFile)),
        rules: uniq((lists.rules || []).map(nameOfFile)),
        hooks: uniq((lists.hooks || []).map(nameOfFile)),
        mcps: uniq((lists.mcps || []).map((e) => foldMcp(nameOfMcp(e)))),
        plugins: picked.filter((n) => rowOf.has(n) && rowOf.get(n).enabled).map((n) => ({ name: n, scope: rowOf.get(n).scope })),
        plugins_disabled: listing.filter((r) => !rowOn(r)).map((r) => r.name),
        parked_plugins: pluginCatalog.filter((n) => rowOf.has(n) && !rowOf.get(n).enabled),
        left_out: leftOut,
        answered,
    };
}

// What the user switched off, as selection lines: every item a parked stack entry carries, and
// every seat `permissions.deny` names under a stack entry. The closure never crosses either.
function leftOut({ parked = [], deny = [] })
{
    const { placement, readRetiredEntries } = require('../plugin-placement.js');
    const place = placement();
    const retired = new Map(readRetiredEntries().map((e) => [e.name, e]));
    const out = [];
    for (const name of parked)
    {
        const entry = place.plugins[name] || retired.get(name);
        if (!entry) continue;
        for (const s of entry.skills) out.push(`skill ${s}`);
        for (const a of entry.agents) out.push(`agent ${a}`);
    }
    for (const seat of (Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean)) out.push(`agent ${seat}`);
    return [...new Set(out)];
}

// The stack entries a --drop took out of the plugin set (`before` / `after` are selection-plugins
// sets, MCP rows by catalog name), matched to the ENABLED listing rows, in the order the CLI accepts
// a disable: an entry goes only once nothing still queued depends on it.
//
// The core, the hooks entry and the three locked servers are never queued: the core depends on the
// servers, so the CLI would refuse, and a drop of them is refused before it gets here anyway.
const NEVER_DISABLED = new Set([BRAND.core, BRAND.hooks, 'serena', 'context7', 'memory']);
function droppedEntries({ before, after, listing = [], deps = {}, marketplace })
{
    const gone = new Set(before.filter((n) => !after.includes(n)));
    const queue = listing
        .filter((r) => r.marketplace === marketplace && r.enabled && !NEVER_DISABLED.has(currentName(r.name)) && gone.has(foldMcp(r.name)))
        .sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    while (queue.length)
    {
        const i = queue.findIndex((r) => !queue.some((o) => o !== r && (deps[o.name] || []).includes(r.name)));
        out.push(...queue.splice(i < 0 ? 0 : i, 1));
    }
    return out;
}

module.exports = {
    addLines, closeLines, dropLines, parseSelection, applySelection, renderPlan, deriveFromDisk, hasInstall,
    adoptHooks, adoptAlways, readBack, planInventory, leftOut, droppedEntries, CATEGORY, RULE_EXCLUDE, HOOK_EXCLUDE,
};
