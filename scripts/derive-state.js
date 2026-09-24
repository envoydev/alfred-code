#!/usr/bin/env node
'use strict';
// THE ONE DERIVATION - what a selection means for a project, decided once.
//
//   node scripts/derive-state.js --selection <file> [--source <dir>] [--marketplace <name>]
//   node scripts/derive-state.js --floor --plugins <enabled entries, csv> [--settings <file>]
//
// Before this script, four readers answered the same question in their own words: the three guided
// walks described what the install would write, and the seed computed it again in code. That is how
// a route change reaches three of them and not the fourth. Every one of them now runs this and
// REPORTS its output, so a disagreement is a diff of one JSON object rather than an argument
// between two prose paragraphs.
//
// It owns no engine of its own. The closure is `stack-select.js`, the placement is
// `selection-plugins.js`, and this script is the third thing they never covered: what the project
// carries that it did NOT pick, and what can be switched off about it.
//
// Three rules, one per surface, each measured:
//
//   - AGENTS have a real lever. Spike S3: `permissions.deny: ["Agent(<plugin>:<name>)"]` drops the
//     seat from the listing and its description from the bill, -434 tokens for one seat. With 43
//     seats shipped that is the largest trim left. The scoped identifier is the measured address;
//     the docs give the general form as `Agent(AgentName)` ('Agent (subagents)',
//     code.claude.com/docs/en/permissions), which is the spelling for a project-local seat. It is written only for a seat an ENABLED plugin
//     carries: a seat in a plugin this project never enabled is not loaded at all, so denying it is
//     noise now and a trap later - the day that plugin is enabled, the stale entry silently drops a
//     seat the user just asked for.
//   - A CORE SKILL has none. Spike S2: `skillOverrides` moved 0 tokens on a plugin skill under
//     either the bare or the scoped key, and the 2026-09-24 library test found why - a plugin skill
//     is locked on. So a core skill the selection did not pick is REPORTED as undroppable, and there
//     is deliberately no `off` key to mistake for a lever. Every OTHER skill is a LIBRARY copy, and
//     a copy is droppable: deleted by a drop, or switched per project through `skillOverrides`.
//   - HOOKS are switched off by NAME, against the whole shipped catalog, because the core carries
//     every one whatever the project picked (`ALFRED_CODE_HOOKS_OFF`, Phase 2; the core since 2.0.0).
const fs = require('node:fs');
const path = require('node:path');

const { pluginsFor, readSelection, parseSelectionText, itemsOf } = require('./selection-plugins.js');
const { placement, descriptionChars, readRetiredEntries, CORE } = require('./plugin-placement.js');
const { loadManifest } = require('./install/manifest.js');
const { hookDisabled } = require('../stack/hooks/hook-prelude.js');
const { pluginRoutes, corePluginOn } = require('./install/plugins.js');
const { BRAND, LEGACY, currentName } = require('./install/brand.js');

const REPO = path.resolve(__dirname, '..');

// The scoped identifier - the address S1's dispatch finding and S3's deny measurement both used.
// `Tool(param:value)` rules exist too, but only for a direct field of the tool's input ('Match by
// input parameter', code.claude.com/docs/en/permissions) - so a plugin named like an Agent field
// (`model`, `isolation`) would be read as one; every stack entry starts `alfred-code` - or, written
// by a 1.x release, the old core name (brand.js LEGACY).
const denySpec = (agent, plugin) => `Agent(${plugin}:${agent})`;

// The seat a stack deny names, under ANY stack entry's spelling, 1.x ones included - null for a
// user's own entry.
const SEAT_DENY = new RegExp(`^Agent\\((?:${BRAND.core}|${LEGACY.core})[a-z0-9-]*:([A-Za-z0-9_-]+)\\)$`);
const stackSeat = (spec) => (SEAT_DENY.exec(String(spec)) || [])[1] || null;

// Which plugin carries each agent - the deny spelling needs the home, not just the name.
function agentHomes(place)
{
    const homes = new Map();
    for (const [plugin, items] of Object.entries(place.plugins))
        for (const agent of items.agents) if (!homes.has(agent)) homes.set(agent, plugin);
    return homes;
}

// The two kinds selection-plugins does not read: they are copied and wired by NAME, so nothing has
// to resolve them to a plugin.
const pickedLines = (text) =>
{
    const picked = { rules: new Set(), hooks: new Set() };
    for (const line of String(text).split('\n'))
    {
        const m = line.trim().match(/^(rule|hook)\s+(\S+)$/);
        if (m) picked[m[1] === 'rule' ? 'rules' : 'hooks'].add(m[2].replace(/\.(md|js)$/, ''));
    }
    return picked;
};

// `selection` is a FILE; `selectionText` is the same lines already in hand, which is what the
// installer holds on the --installed-only route where nothing was written to disk.
function deriveState({ selection, selectionText, sourceDir = REPO, marketplace = 'envoydev' } = {})
{
    // readSelection throws with the path in the message when the file is unreadable; an empty
    // install derived from a missing file is the failure mode this refuses to have.
    const picked = selectionText === undefined ? readSelection(selection) : parseSelectionText(selectionText);
    const flat = pickedLines(selectionText === undefined ? fs.readFileSync(selection, 'utf8') : selectionText);

    const place = placement();
    const { plugins, copy } = pluginsFor(picked, { placement: place });
    const enabled = plugins.map((p) => `${p}@${marketplace}`);

    const carried = itemsOf(plugins, { placement: place });
    const homes = agentHomes(place);

    const off = carried.agents.filter((a) => !picked.agents.has(a));
    // The seats an enabled plugin carries AND the selection kept, plus the library seats it copies.
    // Their specs exist for one job: clearing a deny a PREVIOUS run wrote, so a seat added back
    // through configure actually comes back - a library seat's under the core spelling a retired
    // entry's deny also carries (install/settings.js); clearing a seat clears every spelling of it.
    const kept = carried.agents.filter((a) => picked.agents.has(a)).concat(copy.agents);
    const shipped = [...new Set(loadManifest(sourceDir).catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')))];
    // No hook line at all means every hook, exactly as the installer's copy filter reads it - a
    // selection that never reached the hooks layer answers nothing about hooks.
    const hooksAnswered = flat.hooks.size > 0;
    const hooksOn = hooksAnswered ? shipped.filter((h) => flat.hooks.has(h)) : shipped;
    const hooksOff = hooksAnswered ? shipped.filter((h) => !flat.hooks.has(h)) : [];

    return {
        plugins: enabled,
        skills: {
            picked: [...picked.skills].sort(),
            carried: carried.skills,
            library: copy.skills,
            // No `off` key, deliberately: R1 of the phase plan. Nothing can drop these.
            undroppable: carried.skills.filter((s) => !picked.skills.has(s)),
        },
        agents: {
            on: [...picked.agents].sort(),
            off,
            deny: off.map((a) => denySpec(a, homes.get(a) || CORE)),
            allow: kept.map((a) => denySpec(a, homes.get(a) || CORE)),
            library: copy.agents,
        },
        rules: { copy: [...flat.rules].sort() },
        hooks: { on: hooksOn, off: hooksOff, answered: hooksAnswered },
        mcps: [...picked.mcps].sort(),
        env: { ALFRED_CODE_HOOKS_OFF: hooksOff.join(',') },
    };
}

// The entry the hooks ride - the core, since 2.0.0 folded the hooks entry into it - and the one MCP
// family that fans a catalog row out into several plugins.
const HOOKS_HOME = BRAND.core;
const catalogServer = (name) => String(name)
    .replace(/^playwright-(chrome|msedge|firefox|webkit)$/, 'playwright');

// THE INVERSE, for a run that asks nothing (`update --installed-only`): the selection lines the
// project carries NOW on each plugin route. On those routes `.claude/` holds only the library copies, so the
// disk read alone found no seat and no hook - and the derivation above then switched every one of
// them off. Each surface is read from the state ITS route writes: the enabled entries' contents
// minus the seats `permissions.deny` names, the hook catalog minus ALFRED_CODE_HOOKS_OFF, the MCP
// entries folded onto the catalog. Deriving from these lines writes back the state they came from,
// which is how a seat or hook the user switched off survives an update. `plugins` is this stack's
// ENABLED entries only (`install/selection.js` readBack filters the listing); a surface whose route
// is off, or whose entry is absent, reads back nothing and the caller's disk read decides.
function readInstalled({ plugins = [], deny = [], hooksOff, routes = {}, sourceDir = REPO } = {})
{
    // A 1.x listing's core is the same entry under its old name, and it carries the hooks.
    const names = [...new Set(plugins.map((p) => currentName(String(p).split('@')[0])))];
    const lines = [];
    if (routes.skills)
    {
        const place = placement();
        const carried = itemsOf(names.filter((n) => place.plugins[n]), { placement: place });
        // By SEAT, under any stack entry's spelling: a release that moves a seat to another entry
        // changes its deny spelling, and the seat the user switched off must stay off across it.
        const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
        for (const s of carried.skills) lines.push(`skill ${s}`);
        for (const a of carried.agents) if (!denied.has(a)) lines.push(`agent ${a}`);
        // An entry retired in 1.3.0 that is still enabled here: its items are what the project runs
        // today, so they read back as installed until update copies the picks and removes it.
        const retired = new Map(readRetiredEntries(sourceDir).map((e) => [e.name, e]));
        for (const name of names.filter((n) => retired.has(n)))
        {
            for (const s of retired.get(name).skills) if (!lines.includes(`skill ${s}`)) lines.push(`skill ${s}`);
            for (const a of retired.get(name).agents) if (!denied.has(a) && !lines.includes(`agent ${a}`)) lines.push(`agent ${a}`);
        }
    }
    const manifest = loadManifest(sourceDir);
    if (routes.hooks && names.includes(HOOKS_HOME))
    {
        // The prelude's own matcher, so the read-back honours exactly the spellings the hooks do.
        const env = { ALFRED_CODE_HOOKS_OFF: String(hooksOff || '') };
        const shipped = [...new Set(manifest.catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')))];
        const on = shipped.filter((h) => !hookDisabled(h, env));
        for (const h of on) lines.push(`hook ${h}`);
        // Every hook off is the walk's None, and reads back as it was written - no hook line at all
        // would mean 'every hook' to the next derivation.
        if (!on.length) lines.push('hook none');
    }
    if (routes.mcps)
    {
        const catalog = new Set(manifest.catalogs.mcps.map((row) => row.split('|')[0]));
        for (const server of new Set(names.map(catalogServer))) if (catalog.has(server)) lines.push(`mcp ${server}`);
    }
    return lines;
}

// The item's home entry under THIS release's placement, or null for a library item (copied, never carried).
const homeOf = (place, kind, name) => Object.keys(place.plugins).find((p) => place.plugins[p][kind].includes(name)) || null;

// The retired entry that carried a library item in 1.2.0, or null - the one other place a project's
// off-state for it can live while that entry is still installed (parked, or its seat denied).
const retiredHomeOf = (kind, name, retired = readRetiredEntries()) => (retired.find((e) => e[kind].includes(name)) || {}).name || null;

// A stamp's picked entry is `name@home` - the entry that carried it when it was stamped (plain
// `name` for a library copy, which the disk holds and no entry carries).
const splitPick = (entry) => { const [name, home = ''] = String(entry).split('@'); return { name, home: home || null }; };

// What the LAST install carried that the current placement alone would lose: an item a release
// MOVED out of an entry this project still has enabled, into one it has not enabled. Only a real
// move counts - the stamped home differs from the current one, and the stamped home is still
// enabled here (an entry the user uninstalled or parked took its items with it) - and never past
// the user's own off-state: the new home parked, or the seat denied under any spelling.
function stampCarried({ stamp = {}, enabled = [], parked = [], deny = [], routes = {} } = {})
{
    if (!routes.skills) return [];
    const place = placement();
    const on = new Set(enabled.map(currentName));
    const off = new Set(parked.map(currentName));
    const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
    const retiredNames = new Set(readRetiredEntries().map((e) => e.name));
    const lines = [];
    for (const [kind, line] of [['skills', 'skill'], ['agents', 'agent']])
        for (const entry of stamp[kind] || [])
        {
            // A 1.x stamp homes a core pick `@claude-stack`: the same entry, never a moved-from one. // legacy-name
            const { name, home: stamped } = splitPick(entry);
            const was = stamped && currentName(stamped);
            const home = homeOf(place, kind, name);
            // Homed in a retired entry that is still enabled, library now: carried as a pick.
            if (was && retiredNames.has(was) && on.has(was) && !home)
            {
                if (!(kind === 'agents' && denied.has(name))) lines.push(`${line} ${name}`);
                continue;
            }
            if (!was || !home || home === was || !on.has(was) || off.has(home)) continue;
            if (kind === 'agents' && denied.has(name)) continue;
            lines.push(`${line} ${name}`);
        }
    return lines;
}

// What taking ONE item would add beyond itself - the item's closure (a rule pulls the skills and
// seats it attaches) split into the entries it would enable that are not enabled now, and the
// library items it would copy that the project has not copied yet. An offer is cheap only when
// both are empty.
function costOfTaking({ category, name, place, graph, enabled, copied })
{
    if (!graph) return { enables: [], copies: [] };
    const { computeClosure } = require('./stack-select.js');
    const closure = computeClosure(graph, { [`${category}s`]: [name] });
    const items = [...closure.skills.map((s) => ['skills', s]), ...closure.agents.map((a) => ['agents', a])];
    const homes = new Set(items.map(([kind, n]) => homeOf(place, kind, n)).filter(Boolean));
    const have = { skills: new Set((copied && copied.skills) || []), agents: new Set((copied && copied.agents) || []) };
    const copies = items
        .filter(([kind, n]) => !homeOf(place, kind, n) && !have[kind].has(n) && !(`${category}s` === kind && n === name))
        .map(([kind, n]) => `${kind === 'skills' ? 'skill' : 'agent'} ${n}`)
        .sort();
    return { enables: [...homes].filter((h) => !enabled || !enabled.has(h)).sort(), copies };
}

// THE NEW-ITEM VERDICT, one row per item a release added:
//   arrives  - this refresh brings it, on (a hook on the plugin route always does: the installer
//              enables the core that carries it whatever the listing says, so only HOOKS_OFF can say no);
//   renamed  - a copied item under a new name whose OLD copy is on disk: the update carries it;
//   offer    - only the user's yes brings it; `recommend` is `take` only for a rule whose closure
//              enables no entry and copies no library item the project lacks (`copied`, the
//              project's own copies), and `enables` / `copies` name what a yes would add;
//   off      - the user's own off-state names it: a denied seat, a hook in HOOKS_OFF, every hook
//              switched off before (`noneBefore` - the walk's None), a parked entry;
//   unknown  - the plugin listing could not be read (`plugins` null); never offered on a guess.
// A renamed item carries `from`, and `wasOff` when the OLD name was switched off - the installer
// matches the off-state by name, so the new name comes on and the report must say so.
function classifyNew({ added = [], plugins = [], parked = [], deny = [], hooksOff, noneBefore = false, routes = {}, always = {}, hasHooks = true, copied = null, sourceDir = REPO } = {})
{
    const place = placement();
    const manifest = loadManifest(sourceDir);
    let graph = null;
    try { graph = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta', 'stack-graph.json'), 'utf8')); } catch { graph = null; }
    const ships = {
        skill: new Set(manifest.skills.map((e) => String(e).split('|').pop())),
        agent: new Set(manifest.agents.map((e) => String(e).replace(/\.md$/, ''))),
        rule: new Set(manifest.rules.map((e) => String(e).replace(/\.md$/, ''))),
        hook: new Set(manifest.catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, ''))),
    };
    const enabled = plugins === null ? null : new Set(plugins.map((p) => currentName(String(p).split('@')[0])));
    const off = new Set(parked.map(currentName));
    const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
    const hookOff = (h) => hookDisabled(h, { ALFRED_CODE_HOOKS_OFF: String(hooksOff || '') });
    const rows = [];
    for (const { category, name, from, oldOnDisk } of added)
    {
        if (!ships[category] || !ships[category].has(name)) continue;
        const row = { category, name, verdict: 'offer', entry: null };
        if (category === 'rule') { if ((always.rules || []).includes(name)) row.verdict = 'arrives'; }
        else if (category === 'hook')
        {
            if (routes.hooks)
            {
                row.entry = HOOKS_HOME;
                row.verdict = hookOff(name) || noneBefore ? 'off' : 'arrives';
            }
            else if (hasHooks && !noneBefore) row.verdict = 'arrives';
        }
        else
        {
            row.entry = routes.skills ? homeOf(place, `${category}s`, name) : null;
            if (row.entry)
            {
                if (enabled === null) row.verdict = 'unknown';
                else if (off.has(row.entry) || (category === 'agent' && denied.has(name))) row.verdict = 'off';
                else if (enabled.has(row.entry)) row.verdict = 'arrives';
            }
        }
        if (from)
        {
            row.from = from;
            // The old copy is pruned whatever the new name's verdict - an arriving rename leaves it too.
            if (oldOnDisk) row.oldOnDisk = true;
            if (row.verdict === 'offer' && oldOnDisk) row.verdict = 'renamed';
            if ((category === 'agent' && denied.has(from)) || (category === 'hook' && hookOff(from))) row.wasOff = true;
        }
        if (row.verdict === 'offer')
        {
            Object.assign(row, costOfTaking({ category, name, place, graph, enabled, copied }));
            row.recommend = category === 'rule' && !row.enables.length && !row.copies.length ? 'take' : 'leave';
        }
        rows.push(row);
    }
    return rows;
}

// What of a derived state this run may WRITE. A walk's selection answers both surfaces; a read-back
// answers only what it found evidence of (`answered`), so a failed `claude plugin list` writes
// nothing instead of switching every hook and seat off. The off-lists exist only on the routes
// that load through a plugin: on the copy routes absence from disk is the off-state.
// `wired` / `shipped`: the hook names this run copies and wires, and every hook the release ships -
// the installer passes both on the hooks copy route.
function writable(state, { routes = {}, answered = { hooks: true, agents: true }, wired = null, shipped = [] } = {})
{
    const hooks = Boolean(state && state.hooks.answered && answered.hooks !== false);
    const agents = Boolean(state && answered.agents && routes.skills);
    // The hooks copy route with the core on: the core carries every hook, and a hook the project does
    // not wire has no twin to stand down for, so this name is its only off-switch. The list is the
    // complement of what the run WIRES, whatever the read-back answered - a pre-11b install never
    // wrote one, absence on disk being its off-state.
    const besideCore = !routes.hooks && corePluginOn(routes) && Array.isArray(wired);
    return {
        // Otherwise written whenever the CORE is on; on the full copy route there is no core, and
        // absence is off.
        hooksOff: besideCore ? shipped.filter((h) => !wired.includes(h)) : hooks && corePluginOn(routes) ? state.hooks.off : [],
        hooksAnswered: besideCore || hooks,
        agentDeny: agents ? state.agents.deny : [],
        agentAllow: agents ? state.agents.allow : [],
        // Carried without a pick only where a plugin carries skills; the copy route copies the picks.
        undroppable: state && routes.skills ? state.skills.undroppable : [],
    };
}

// THE FLOOR the stack's own entries add to every message: the description of each model-invocable
// skill they carry (a `disable-model-invocation` skill's is not in context - 'Control who invokes a
// skill', code.claude.com/docs/en/skills) and of each seat not denied (spike S3: a denied seat
// leaves the Agent listing). Status reports it; before this the seats were not counted at all.
// Read from the FRONTMATTER only: a body line or a code fence showing the key is not the flag.
const manualOnlyText = (text) => /^disable-model-invocation:\s*true\s*$/m.test((/^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text)) || [])[1] || '');
const manualOnly = (skill) =>
{
    try { return manualOnlyText(fs.readFileSync(path.join(REPO, 'stack', 'skills', skill, 'SKILL.md'), 'utf8')); }
    catch { return false; }
};

function floor({ plugins = [], deny = [] } = {})
{
    const place = placement();
    const named = [...new Set(plugins.map((p) => currentName(String(p).split('@')[0])).filter(Boolean))];
    // A retired entry still enabled here loads what it carried every session until update removes it.
    const retired = readRetiredEntries().filter((e) => named.includes(e.name));
    const entries = named.filter((n) => place.plugins[n] || retired.some((e) => e.name === n)).sort();
    const carried = itemsOf(entries, { placement: place, retired });
    // The EXACT spelling Claude Code matches - the seat under its home entry (a retired entry's own
    // name while it is installed). A deny left under an entry the seat has since moved out of hides
    // nothing until the next install rewrites it.
    const homes = agentHomes(place);
    for (const e of retired) for (const a of e.agents) if (!homes.has(a)) homes.set(a, e.name);
    const specs = new Set(Array.isArray(deny) ? deny.map(String) : []);
    // A core seat's 1.x spelling still hides it after the rename (docs/rebrand-evidence.md S6).
    const denied = new Set(carried.agents.filter((a) => specs.has(denySpec(a, homes.get(a) || CORE))
        || (!homes.has(a) || homes.get(a) === CORE) && specs.has(denySpec(a, LEGACY.core))));
    const skills = carried.skills.filter((s) => !manualOnly(s));
    const seats = carried.agents.filter((a) => !denied.has(a));
    const sum = (kind, names) => names.reduce((n, name) => n + descriptionChars(kind, name), 0);
    // `skipped`: the entries this count does not cover - the MCP entries, and any other plugin. The
    // caller counts them as any other plugin; a name dropped here without a word is how a floor
    // under-reports. The core's hooks ride it, and their SessionStart injections are text a script
    // cannot size ahead - the caller counts those as the core's hooks, not here.
    const out = {
        entries,
        skipped: named.filter((n) => !place.plugins[n]).sort(),
        skills: { count: skills.length, chars: sum('skill', skills) },
        agents: { count: seats.length, denied: carried.agents.filter((a) => denied.has(a)), chars: sum('agent', seats) },
    };
    out.chars = out.skills.chars + out.agents.chars;
    return out;
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    if (argv.includes('--floor'))
    {
        // Every --settings file counts: deny rules merge across the account, project and local
        // scopes, so a seat switched off in any of them is off. An unreadable file denies nothing.
        const deny = [];
        argv.forEach((a, i) =>
        {
            if (a !== '--settings' || !argv[i + 1]) return;
            let stored = {};
            try { stored = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')); } catch { stored = {}; }
            if (stored && stored.permissions && Array.isArray(stored.permissions.deny)) deny.push(...stored.permissions.deny);
        });
        const plugins = String(arg('--plugins') || '').split(',').map((p) => p.trim()).filter(Boolean);
        console.log(JSON.stringify(floor({ plugins, deny }), null, 2));
        return 0;
    }
    const selection = arg('--selection');
    if (!selection)
    {
        console.error('usage: derive-state.js --selection <file> [--source <dir>] [--marketplace <name>]\n       derive-state.js --floor --plugins <enabled entries, csv> [--settings <settings.json>]...\n       derive-state.js --delta --installed <inventory.json> --selection <file> [--picked <walk file>]');
        return 1;
    }
    if (argv.includes('--delta'))
    {
        // One line per change, `add <line>` / `drop <line>`, each passed on as --add / --drop.
        const installed = JSON.parse(fs.readFileSync(path.resolve(arg('--installed')), 'utf8'));
        const pickedFile = arg('--picked');
        const { add, drop, keptOff, keepParked } = delta({
            installed, selectionText: fs.readFileSync(path.resolve(selection), 'utf8'),
            picked: pickedFile ? JSON.parse(fs.readFileSync(path.resolve(pickedFile), 'utf8')) : null,
        });
        // `none` is the walk's no-op verdict: nothing to add or drop. The other two kinds are what
        // the run leaves off, printed either way.
        const lines = [...add.map((l) => `add ${l}`), ...drop.map((l) => `drop ${l}`)];
        console.log([...(lines.length ? lines : ['none']), ...keptOff.map((l) => `kept-off ${l}`), ...keepParked.map((l) => `keep-parked ${l}`)].join('\n'));
        return 0;
    }
    const state = deriveState({
        selection: path.resolve(selection),
        sourceDir: arg('--source') ? path.resolve(arg('--source')) : REPO,
        marketplace: arg('--marketplace') || 'envoydev',
    });
    // What THIS environment's routes write, by the installer's own rule - so a walk reporting the
    // derivation before the install reports the copy routes as writing no off-state.
    const routes = pluginRoutes(process.env);
    console.log(JSON.stringify({ ...state, routes, written: writable(state, { routes }) }, null, 2));
    return 0;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

// configure and validate walk from the read-back inventory to a closed selection; what differs is
// what they APPLY, as the --add / --drop lines `update --installed-only` takes - never a whole
// --selection, which on the plugin route rebuilds the install from what is on disk. Hooks read as
// the installer reads them: no hook line at all means that layer was never answered, `hook none`
// means every hook off.
//
// What the user switched off stays off unless the walk PICKED it (`picked`, the walk's own running
// file in the inventory's shape): a seat denied, an item of a parked retired entry (`left_out`) or a parked
// catalog plugin (`parked_plugins`) that the closure merely re-requires is `keptOff`, never an add.
// And the read-back enables a parked catalog plugin like any other it finds, so every one the walk
// did not pick is `keepParked` - passed as a --drop whenever the installer runs, but no reason on
// its own to run it.
function delta({ installed = {}, selectionText, picked = null })
{
    const want = new Set(String(selectionText).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
    const hooksAnswered = [...want].some((l) => l.startsWith('hook '));
    const layers = { skills: 'skill', agents: 'agent', rules: 'rule', hooks: 'hook', mcps: 'mcp', plugins: 'plugin' };
    const nameOf = (e) => (e && typeof e === 'object' ? e.name : String(e));
    const chose = new Set();
    for (const [layer, cat] of Object.entries(layers))
        for (const e of (picked && picked[layer]) || []) chose.add(`${cat} ${nameOf(e)}`);
    const off = new Set([...(installed.left_out || []), ...(installed.parked_plugins || []).map((n) => `plugin ${n}`)]);
    const add = [], drop = [], keptOff = [];
    for (const [layer, cat] of Object.entries(layers))
    {
        const have = new Set((installed[layer] || []).map(nameOf));
        for (const line of want)
        {
            if (!line.startsWith(`${cat} `) || line === 'hook none' || have.has(line.slice(cat.length + 1))) continue;
            (off.has(line) && !chose.has(line) ? keptOff : add).push(line);
        }
        if (layer === 'hooks' && !hooksAnswered) continue;
        for (const name of have) if (!want.has(`${cat} ${name}`)) drop.push(`${cat} ${name}`);
    }
    const keepParked = (installed.parked_plugins || []).map((n) => `plugin ${n}`).filter((l) => !chose.has(l));
    return { add, drop, keptOff, keepParked };
}

module.exports = {
    delta, stampCarried, classifyNew, homeOf, retiredHomeOf, splitPick, deriveState, readInstalled, writable, floor, manualOnlyText, denySpec, stackSeat, agentHomes, REPO };
