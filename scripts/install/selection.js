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
//     reads back `hook none` itself when the copy route ran here and kept none (`readBack`).
//   - A HOOK THIS RELEASE ADDED REACHES AN EXISTING INSTALL ONLY HERE, so hooks are all-or-nothing
//     on the derived path: an install that HAS hooks gets every shipped one. The exception is a
//     DELIBERATE DROP - a hook named in the previous stamp and absent now was removed through
//     configure and stays removed.
//   - THE ALWAYS-ON BASELINE IS ADOPTED THE SAME WAY, with NO drop exception: the always set is
//     locked, so an always item absent from disk is adopted whatever the stamp says. A stamp naming
//     the shipped list once read as a drop of everything, and the memory rule never arrived. From
//     2.1.0 the always SKILLS are copies too, adopted the same way; an always SEAT rides the core and
//     is adopted unless the user denied it.
const fs = require('node:fs');
const path = require('node:path');
const { readInstalled, stampCarried, splitPick, homeOf, retiredHomeOf, stackSeat } = require('../derive-state.js');
const { hookDisabled, envOf } = require('../../stack/hooks/hook-prelude.js');
const { BRAND, LEGACY, currentName, rowOn } = require('./brand.js');
const { USER_OFF_WINS, corePluginOn, rowsOn } = require('./plugins.js');
const { currentMcp } = require('./mcp.js');
const { stackNames } = require('./manifest.js');

// A generated, project-owned file is not a stack item: the captures rewrite those.
const RULE_EXCLUDE = /^(alfred-project-.*|project-code-style)$/;
// docs.js / memory.js / history.js / fresh-session.js / shell-writes.js / hidden-chars.js are ENGINES, hook-prelude.js the shared gate
// module and shell-guards.js / file-guards.js the dispatchers that run the picked shell and file guards - none is a hook item.
const HOOK_EXCLUDE = /^(inject-code-style|docs|memory|history|hook-prelude|fresh-session|shell-writes|hidden-chars|shell-guards|file-guards)$/;
const PW_ENGINE = /^browser-(chrome|msedge|firefox|webkit)$/;
const PW_ORDER = ['chrome', 'msedge', 'firefox', 'webkit'];
const engineOf = (name) => (PW_ENGINE.exec(String(name)) || [])[1];

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
// excluded; a browser engine server collapses back to the one manifest entry it expands from.
// `skillsDir`: a 1.x global install kept its skills in the account dir, everything else in the project.
// `shippedHooks` (R56): the stack's hook names - `.claude/hooks/` is the user's folder too, and a file
// of their own there is no hook item; null (no catalog to go by) reads every non-engine file.
// `known` (manifest.js stackNames): the same for skills, seats and rules - only a name the stack ever
// shipped (the catalog, a renamed item's old name, a retired one) is an item, so a project's own skill is
// neither a pick nor install evidence; null reads every folder.
// `foreignSkill(name)` (M3): a folder under a catalog skill name that is the project's own, never a pick.
function deriveFromDisk({ claudeDir, skillsDir = path.join(claudeDir, 'skills'), mcpServers = [], plugins = [], knownPlugins = [], shippedHooks = null, known = null, foreignSkill = () => false })
{
    const lines = [];
    const ours = (kind, name) => !known || known[kind].has(name);
    for (const name of listDir(skillsDir, (d) => d.isDirectory()))
        if (ours('skills', name) && fs.existsSync(path.join(skillsDir, name, 'SKILL.md')) && !foreignSkill(name)) lines.push(`skill ${name}`);
    for (const f of listDir(path.join(claudeDir, 'agents'), (d) => d.isFile() && d.name.endsWith('.md')))
        if (ours('agents', f.replace(/\.md$/, ''))) lines.push(`agent ${f.replace(/\.md$/, '')}`);
    for (const f of listDir(path.join(claudeDir, 'rules'), (d) => d.isFile() && d.name.endsWith('.md')))
    {
        const name = f.replace(/\.md$/, '');
        if (!RULE_EXCLUDE.test(name) && ours('rules', name)) lines.push(`rule ${name}`);
    }
    for (const f of listDir(path.join(claudeDir, 'hooks'), (d) => d.isFile() && d.name.endsWith('.js')))
    {
        const name = f.replace(/\.js$/, '');
        if (!HOOK_EXCLUDE.test(name) && (!shippedHooks || shippedHooks.includes(name))) lines.push(`hook ${name}`);
    }
    const seenMcp = new Set();
    for (const server of mcpServers)
    {
        const name = String(server).replace(PW_ENGINE, 'browser');
        if (!seenMcp.has(name)) { seenMcp.add(name); lines.push(`mcp ${name}`); }
    }
    // Plugins are machine-level, so they come from the CLI listing rather than a project directory -
    // without this the fast path filtered PLUGINS to empty and `update` ran on nothing.
    const listedKnown = new Set(knownPlugins.map(nameOfPlugin));
    const seenPlugin = new Set();
    for (const p of plugins)
    {
        const name = nameOfPlugin(p);
        if (listedKnown.has(name) && !seenPlugin.has(name)) { seenPlugin.add(name); lines.push(`plugin ${name}`); }
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
    // A None adopts nothing either: a hook this release added stays off with the rest.
    if (!lines.some((l) => l.startsWith('hook ')) || lines.includes('hook none')) return lines;
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
// install does not carry AT ALL (no rule line, or no mcp line) stays absent. The always skills are
// adopted into any install that carries skills or rules (2.1.0: no plugin carries them, so a copy is
// the only way an install has them). An always SEAT rides the core and its off-switch is the deny,
// so it is adopted only while the core loads it (`coreOn`) and only when `deny` does not name it -
// on the full copy route absence on disk is its off-state, and adopting there would undo a drop.
function adoptAlways({ lines, always = {}, log = () => {}, deny = [], coreOn = false })
{
    const out = [...lines];
    const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
    const adopt = (category, name) =>
    {
        if (out.includes(`${category} ${name}`)) return;
        out.push(`${category} ${name}`);
        log(`installed-only: adopting ${category} ${name} - always shipped by this release and absent here`);
    };
    for (const [category, key] of [['rule', 'rules'], ['mcp', 'mcps']])
    {
        if (!out.some((l) => l.startsWith(`${category} `))) continue;
        for (const name of always[key] || []) adopt(category, name);
    }
    if (out.some((l) => /^(skill|rule) /.test(l))) for (const name of always.skills || []) adopt('skill', name);
    if (coreOn) for (const name of always.agents || []) if (!denied.has(name)) adopt('agent', name);
    return out;
}

// THE --installed-only READ-BACK, whole. The disk first (the copy routes, the extras, the rules),
// then the state each PLUGIN route writes - on those routes `.claude/` holds only the extras, and a
// disk-only read derived every seat and hook as dropped. The plugin state is read from the ENABLED
// entries of this stack's marketplace only: a parked entry stays parked, and another marketplace's
// `serena` or `sentry` is not ours. `answered` names the surfaces the read found EVIDENCE of; the
// caller writes nothing back for the others, so a listing that could not be read (no CLI, a failed
// call) switches nothing off instead of switching everything off for good.
// `seatsRoute`: the stamp's `seats-route:` (null on a stamp from before 2.1.0) - what the enabled core
// carried when the last install ran (derive-state readInstalled's `core`). `ledgerSeats`: the seats
// whose deny the last run's ledger records as the stack's own (`managed-deny`).
function readBack({ claudeDir, skillsDir, foreignSkill = () => false, mcpServers = [], listing = [], stackListing, settings, routes = {}, manifest, sourceDir, stampHooks = [], lastHooksRoute = null, stampPicked, stampEngines, always = {}, marketplace = BRAND.marketplace, said = new Set(), sharedOnlyDeny = [], committedEnv = null, scope, isOn = () => undefined, seatsRoute = null, ledgerSeats = [], log = () => {} })
{
    const shipped = [...new Set(manifest.catalogs.hooks.map(nameOfFile))];
    // A copy an older release wrote under a name this one renamed is the renamed item (`renamed` below).
    const renaming = { renamed: manifest.renamed, log, said };
    // An MCP name from before the 2.0.0 rename - a listing row, a .mcp.json server - is read under its
    // new one: the same server the user picked (manifest `renamed.mcps`).
    const cur = (name) => currentMcp(name, (manifest.renamed && manifest.renamed.mcps) || {});
    let lines = renameLines(deriveFromDisk({ claudeDir, skillsDir, mcpServers: mcpServers.map(cur), plugins: listing.map((r) => r.name), knownPlugins: manifest.plugins, shippedHooks: shipped, known: stackNames(manifest), foreignSkill }), renaming);
    const none = { lines, closeFrom: [], parked: [], deny: [], installed: false, answered: { hooks: false, agents: false }, engines: [] };
    const ours = (stackListing || listing).filter((r) => r.marketplace === marketplace);
    // On the plugin routes an install whose every pick an entry carries, with no rule copied, leaves
    // nothing on disk - its own enabled entries are the evidence then. Only this PROJECT's: an account
    // entry is every project's, and would read a project the stack never touched as installed.
    // The core counts as enabled whatever its flag (brand.js rowOn, S22).
    const ownEntries = ours.some((r) => rowOn(r) && (r.scope === 'project' || r.scope === 'local'));
    if (!hasInstall(lines) && !ownEntries) return none;

    // What the user PICKED - the disk and the stamp - is what the closure runs over; an item an
    // enabled entry merely carries is not a pick.
    const closeFrom = [...lines];
    // A 1.x listing can still name the core by its old name: the same entry. The hooks ride the core
    // (2.0.0), so the 1.x hooks id says nothing a core row does not.
    // With the stamp's record of the installed engines, an engine it does not name is not kept: a drop
    // whose uninstall failed, was refused, or sits at another scope is still listed, and read back here
    // it was written into the stamp again. It is left as it is and named with its command.
    const recordedEngines = routes.mcps && Array.isArray(stampEngines) ? stampEngines : null;
    const unrecorded = (r) => recordedEngines !== null && engineOf(cur(r.name)) && !recordedEngines.includes(engineOf(cur(r.name)));
    for (const r of ours.filter((x) => rowOn(x) && unrecorded(x)))
        log(`installed-only: ${r.name}@${r.marketplace} is installed but not among the browsers the last install kept - left as it is, not kept; remove it: claude plugin uninstall ${r.name}@${r.marketplace} --scope ${r.scope || 'project'}, or pick it again in /alfred-code:configure`);
    const names = ours.filter((r) => rowOn(r) && !unrecorded(r)).map((r) => currentName(cur(r.name)));
    const stored = renameDeny(settings && typeof settings === 'object' ? settings : {}, { ...renaming, sharedOnly: sharedOnlyDeny });
    const env = stored.env && typeof stored.env === 'object' ? stored.env : {};
    const deny = stored.permissions && Array.isArray(stored.permissions.deny) ? stored.permissions.deny : [];
    // The browser engines the last install INSTALLED (the stamp's `browser-engines:`): a
    // disabled row of one is the user's choice to leave it off (R67), still installed and kept, never
    // a parked entry - and the listing's flag is no evidence either way (S22). On every route (R116):
    // a switch onto the copy route has no registration yet, and read from .mcp.json alone it dropped
    // the engines and wrote the stamp's two lines blank.
    const pickedEngines = Array.isArray(stampEngines) ? stampEngines : [];
    const parked = ours.filter((r) => !rowOn(r) && !pickedEngines.includes(engineOf(cur(r.name)))).map((r) => currentName(cur(r.name)));
    // A 1.x settings file spells the switch-off CLAUDE_STACK_HOOKS_OFF until this run's env pass renames it. // legacy-name
    // A switch onto the FULL copy route disables the core (plugins.copyRouteStandDown), and that route
    // reads skills and seats from the disk - where a plugin-route install holds no seat (2.1.0) or, before
    // 2.1.0, none of the core's items, so they were never copied and loaded nowhere after the switch.
    // What the core carried is what the project runs today: read back as the skills route reads it, and
    // copied before the core goes off. The rows the stand-down disables - on at this run's scope by the settings file's word,
    // else the listing's flag (S22, S28).
    const leaving = !corePluginOn(routes)
        && rowsOn({ rows: ours, names: [BRAND.core, LEGACY.core], market: marketplace, isOn }).some((r) => !scope || r.scope === scope);
    // A retired entry carries its whole stack, picked or not, and the library copies what the
    // selection holds - so with the stamp's picks to go by, an item only an enabled retired entry
    // carries joins it only as a pick; one a kept pick requires comes back through the closure. A
    // stamp without picks takes everything (the adoption path below). The same picks gate the seats
    // a 2.1 core carries (readInstalled's `known`).
    const picks = ours.length && stampPicked
        ? new Set(['skill', 'agent'].flatMap((k) => (stampPicked[`${k}s`] || []).map((e) => `${k} ${splitPick(e).name}`)))
        : null;
    const core = seatsRoute === 'plugin' ? 'current' : seatsRoute === 'copy' ? 'none' : 'former';
    // The same holds for a switch onto the skills copy route with the core still on: the seats the core
    // carried last run (2.1.0 - none of them on disk) are what the project runs, and are copied now.
    const copying = leaving || (!routes.skills && corePluginOn(routes) && seatsRoute === 'plugin');
    const installed = readInstalled({ plugins: names, deny, hooksOff: envOf(env, 'HOOKS_OFF'), routes: copying ? { ...routes, skills: true } : routes, sourceDir, core, picks, managedSeats: ledgerSeats });
    // The walk's None held across a release: every hook the LAST release shipped is switched off, so
    // a hook this one added stays off too rather than arriving on alone.
    const noneBefore = routes.hooks && names.includes(BRAND.core) && stampHooks.length > 0
        && stampHooks.every((h) => hookDisabled(h, { ALFRED_CODE_HOOKS_OFF: String(envOf(env, 'HOOKS_OFF') || '') }));
    for (const line of noneBefore ? installed.filter((l) => !l.startsWith('hook ')).concat('hook none') : installed)
        if (!lines.includes(line)) lines.push(line);
    // A seat the stamp homes in the core ran on the core, whatever that release's placement: on a real
    // 2.0.x stamp these are always seats read above already, and on a stamp whose `seats-route:` line is
    // missing or garbled they keep the picks from reading as never run.
    if (core === 'former' && routes.skills && stampPicked && names.includes(BRAND.core))
    {
        const denied = new Set(deny.map(stackSeat).filter(Boolean));
        // A stamp is project text: only a seat this release ships is ever read back from it.
        const shippedSeats = new Set((manifest.agents || []).map(nameOfFile));
        const validSeat = (name) => shippedSeats.has(name);
        for (const entry of stampPicked.agents || [])
        {
            const { name, home } = splitPick(entry);
            if (home && currentName(home) === BRAND.core && validSeat(name) && !denied.has(name) && !lines.includes(`agent ${name}`)) lines.push(`agent ${name}`);
        }
    }
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
    // What a switch onto the full copy route copies is the disk that route reads its picks from - so
    // it is picked from this run on, or the next run's stamp would differ from this one's.
    if (copying)
        for (const line of installed)
            if (/^(skill|agent) /.test(line) && lines.includes(line) && !closeFrom.includes(line)) closeFrom.push(line);
    if (stampPicked === null && ours.length)
    {
        const adopted = installed.filter((l) => /^(skill|agent) /.test(l) && lines.includes(l) && !closeFrom.includes(l));
        closeFrom.push(...adopted);
        if (adopted.length) log(`installed-only: the stamp predates recorded picks - ${adopted.length} skills and seats the enabled entries carry are recorded as picked`);
    }
    // A stamp from before 2.1.0: what its core carried - the always closure - ran in this project, and
    // from this run on it is copies and allowed seats, which the next run reads back as picks (the disk,
    // and the stamp's picks gating the seats). Recorded as picked NOW, or the next run's stamp would
    // differ from this one's.
    if (core === 'former' && routes.skills && names.includes(BRAND.core))
    {
        const carried = installed.filter((l) => /^(skill|agent) /.test(l) && lines.includes(l) && !closeFrom.includes(l));
        closeFrom.push(...carried);
        log(`installed-only: the stamp predates 2.1.0 - its core is read as the always closure it carried: those skills become copies, and every seat this install never ran is denied${carried.length ? ` (${carried.length} carried items recorded as picked)` : ''}`);
    }

    // On a copy route, no hook on disk read as 'every hook' - the update copied and wired them all
    // back. Two installs leave none there, told apart ONLY by the stamp's `hooks-route:` (ruling R55 -
    // a leftover prelude is no evidence): the copy route ran last, so the user kept NONE; otherwise the
    // plugin route made this install, or the route is unknown (1.x, 2.0.0 before the line), and its
    // ALFRED_CODE_HOOKS_OFF is carried across, read the way that route reads it - nothing stored is
    // every hook, never a None. Only a STACK hook is a hook line at all (R56, deriveFromDisk above):
    // the user's own file there is neither evidence nor a pick.
    const stackHook = (l) => l.startsWith('hook ') && shipped.includes(l.slice(5));
    // m8: a stamp that says 'plugin' means the last FINISHED run left no stack hook here - the plugin
    // route prunes every copy - so one on disk now is a switch to the copy route that died part way,
    // never a pick. Its files are set aside and the rule above reads the stored list instead.
    // R94: with no `hooks-route:` line (1.x, 2.0.0 before the line) the last route is inferred from what
    // the copy route leaves behind - the STORED hooks switch set to false (either spelling; the run's
    // own switch says only where this run goes), or the folder's stack hooks wired as
    // `.claude/hooks/<name>.js`, since a copy route wires what it copies. Either one: the copies were the
    // picks (a pre-11b copy route left the unpicked out). Neither: the plugin route, set aside as above.
    // A folder holding only the user's own files, or a leftover prelude, carries no hook line at all
    // (R56), so under any route it is never read as the picks. `keptNone` below stays on the literal
    // stamp line (R55): an inferred route never makes an empty folder a None.
    // C5: at project and user scope the stored switch and HOOKS_OFF below are read from settings.json
    // alone (`committedEnv`) - what they decide is the committed wiring, never the runner's own file.
    const committed = committedEnv && typeof committedEnv === 'object' ? committedEnv : env;
    const viaOff = String(envOf(committed, 'HOOKS_VIA_PLUGIN') || '').trim().toLowerCase() === 'false';
    const wiring = JSON.stringify(stored.hooks && typeof stored.hooks === 'object' ? stored.hooks : {});
    const wiredCopy = lines.some((l) => stackHook(l) && wiring.includes(`/.claude/hooks/${l.slice(5)}.js`));
    const lastRoute = lastHooksRoute || (viaOff || wiredCopy ? 'copy' : 'plugin');
    if (!routes.hooks && lastRoute === 'plugin' && lines.some(stackHook))
    {
        lines = lines.filter((l) => !stackHook(l));
        for (let i = closeFrom.length - 1; i >= 0; i--) if (stackHook(closeFrom[i])) closeFrom.splice(i, 1);
        log(lastHooksRoute ? 'installed-only: the hooks copied here are an unfinished switch to the copy route, not a pick - reading ALFRED_CODE_HOOKS_OFF instead'
            : 'installed-only: the stamp names no hooks route, and nothing stored or wired says the copy route made the hooks copied here - read as the plugin route\'s leftovers, not a pick; reading ALFRED_CODE_HOOKS_OFF instead');
    }
    if (!routes.hooks && !lines.some(stackHook))
    {
        const keptNone = lastHooksRoute === 'copy';
        const off = String(envOf(committed, 'HOOKS_OFF') || '');
        const on = keptNone ? [] : off.trim() ? shipped.filter((h) => !hookDisabled(h, { ALFRED_CODE_HOOKS_OFF: off })) : null;
        if (on)
        {
            lines.push(...(on.length ? on.map((h) => `hook ${h}`) : ['hook none']));
            log(keptNone ? 'installed-only: the copy route kept no hook here - none is copied back'
                : `installed-only: no hook is copied here yet - copying the ${on.length} ALFRED_CODE_HOOKS_OFF does not name`);
        }
    }
    // The seats surface is answered by the core's row - its carriage and the deny list are the seat
    // state - or, when the last run did NOT carry the seats on the core (a stamp from before 2.1.0, a
    // copy route, no stamp at all), by the disk: its seat copies plus the always seats are then every seat
    // the project runs, so a run that is about to load the core (the legacy install it bootstraps, a
    // listing that could not be read) denies the rest in the same run. A 2.1 plugin-route install read
    // blind answers nothing - its seats are on no disk.
    const answered = { hooks: lines.some((l) => l.startsWith('hook ')), agents: names.includes(BRAND.core) || (corePluginOn(routes) && seatsRoute !== 'plugin') };
    const listedEngines = routes.mcps ? names.map(engineOf).filter(Boolean) : [];
    const engines = PW_ORDER.filter((e) => listedEngines.includes(e) || pickedEngines.includes(e));
    if (pickedEngines.length && !lines.includes('mcp browser'))
    {
        lines.push('mcp browser');
        log(`installed-only: keeping mcp browser - the last install installed ${pickedEngines.join(',')} (on or off, still installed)`);
    }
    // Adoption is for hooks read off DISK. Read from the core that carries them, ALFRED_CODE_HOOKS_OFF
    // is the whole answer already - a hook it does not name is on, a new release's included - and
    // adopting against an older stamp would switch back on the very hooks the user named there.
    if (!(routes.hooks && names.includes(BRAND.core)))
        lines = adoptHooks({ lines, catalog: manifest.catalogs.hooks, shippedBefore: stampHooks, log });
    const before = new Set(lines);
    lines = adoptAlways({ lines, always, log, deny, coreOn: corePluginOn(routes) });
    for (const line of lines)
        if ((/^(rule|mcp|plugin|hook) /.test(line) || (/^(skill|agent) /.test(line) && !before.has(line))) && !closeFrom.includes(line)) closeFrom.push(line);
    // No stack row at all: the listing could not be read (or nothing of ours is installed), so this
    // run cannot tell a pick the user dropped from one it merely cannot see.
    return { lines, closeFrom, parked, deny, installed: true, answered, engines, blind: !ours.length };
}

// R109: plugins the stack once offered and no longer does, each with the release that dropped it. NOT a
// retirement: each belongs to another marketplace, so no run installs, refreshes, disables or
// uninstalls one - an installed copy is the user's own. A pick of one (a selection line, an --add) is
// dropped with ONE line; the listed copy an older install picked is named on the first update past
// that release only (the retired-MCP pattern, mcp.dueRetired), and is silent after it. `said` carries
// the names already told across the run's calls, so one run says each once.
const FORMER_PLUGINS = { superpowers: '2.0.0' };
function dropFormerPicks({ lines = [], listing = [], lastVersion = '', compare, log = () => {}, said = new Set() } = {})
{
    const former = (l) =>
    {
        const m = /^plugin\s+(\S+)$/.exec(String(l).trim());
        const name = m && nameOfPlugin(m[1]);
        return name && Object.hasOwn(FORMER_PLUGINS, name) ? name : null;
    };
    const named = new Set(lines.map(former).filter(Boolean));
    for (const r of listing)
    {
        const name = r && nameOfPlugin(r.name || '');
        if (Object.hasOwn(FORMER_PLUGINS, name) && lastVersion && compare && compare(lastVersion, FORMER_PLUGINS[name]) < 0) named.add(name);
    }
    for (const name of named)
    {
        if (said.has(name)) continue;
        said.add(name);
        log(`plugin ${name}: no longer a stack pick (${FORMER_PLUGINS[name]}) - dropped from the picks; an installed copy stays as your own, never refreshed, disabled or uninstalled`);
    }
    return lines.filter((l) => !former(l));
}

// A skill or seat a release RENAMED (meta/stack-manifest.json `renamed`, old -> new). An older
// install names it the old way in the stamp's picks, a copy on disk, a seat deny and a selection line
// (--selection, --add, --drop); each is read under the new name here, so a pick is carried and a
// switch-off holds, and the old copy goes with the retired list. `said` makes it one line per rename
// per run, whichever of those places names it first.
const RENAMED_KIND = { skill: 'skills', agent: 'agents', rule: 'rules', mcp: 'mcps' };
function renamedTo({ renamed, kind, name, log = () => {}, said = new Set() })
{
    const to = ((renamed && renamed[RENAMED_KIND[kind]]) || {})[name];
    if (!to) return name;
    if (!said.has(`${kind} ${name}`)) { said.add(`${kind} ${name}`); log(`renamed: ${kind} ${name} -> ${to}`); }
    return to;
}

function renameLines(lines = [], opts = {})
{
    return lines.map((l) =>
    {
        const m = /^\s*(skill|agent|rule|mcp)\s+(\S+)\s*$/.exec(String(l));
        return m ? `${m[1]} ${renamedTo({ ...opts, kind: m[1], name: m[2] })}` : l;
    });
}

// The stamp's picks keep their `@home`: a later read-back decides from it whether the item moved.
function renamePicked(picked, opts = {})
{
    if (!picked) return picked;
    const each = (kind) => (entry) => { const { name, home } = splitPick(entry); const to = renamedTo({ ...opts, kind, name }); return home ? `${to}@${home}` : to; };
    return { ...picked, skills: (picked.skills || []).map(each('skill')), agents: (picked.agents || []).map(each('agent')) };
}

// The read-back's VIEW of the settings: a stack seat deny under any stack spelling reads under the
// new seat. The file itself is re-spelled by the writer (settings.js `renamed`). M1: `sharedOnly` -
// at local scope, the entries only settings.json holds - is a file that run never writes, so no
// rename happens there: each gets a note, never a `renamed:` line.
function renameDeny(settings, opts = {})
{
    const deny = settings && settings.permissions && Array.isArray(settings.permissions.deny) ? settings.permissions.deny : null;
    if (!deny) return settings;
    const untouched = new Set(opts.sharedOnly || []);
    const mapped = deny.map((entry) =>
    {
        const seat = stackSeat(entry);
        const held = untouched.has(entry);
        const to = seat ? renamedTo({ ...opts, kind: 'agent', name: seat, ...(held ? { log: () => {}, said: new Set() } : {}) }) : seat;
        if (held && to !== seat) (opts.log || (() => {}))(`installed-only: settings.json still names ${entry} - read as ${to}; a local-scope run never writes that file, a project-scope update re-spells it`);
        return to && to !== seat ? String(entry).replace(new RegExp(`:${seat}\\)$`), `:${to})`) : entry;
    });
    return { ...settings, permissions: { ...settings.permissions, deny: mapped } };
}

// R128 (Task 22 fix round 1): the names the stack itself wrote into a project - its seeded AGENTS.md
// and the generated rules (`alfred-project-*.md`, `project-code-style.md`) - follow a rename, so no
// session reads a command that no longer exists. Every run, on disk: each old skill or seat name is
// re-spelled as a whole token, longest first, never inside a longer name - so a file name that embeds
// one (`alfred-project-related-context.md`) stays. A user's own token equal to an old stack name is
// re-spelled too; the per-file line says how many, and a second run finds nothing.
// The 2.0.0 MCP rename in the same files: a tool spelling (the plugin form, or the bare one a copy-route
// registration answers) and a backticked server name, each as written by the capture that saw it.
// M46: the browser before one server per engine was ONE registration under the renamed name itself (1.x
// `playwright`), so its bare spelling follows to the first engine this project keeps - chrome when it keeps none,
// the default engine.
function mcpRespellPairs(renamedMcps = {}, engines = [])
{
    const { renamedFrom, currentMcp, PW_ENGINES } = require('./mcp.js');
    const out = {};
    for (const old of renamedFrom(renamedMcps))
    {
        const now = currentMcp(old, renamedMcps);
        out[`mcp__plugin_${old}_${old}__`] = `mcp__plugin_${now}_${now}__`;
        out[`mcp__${old}__`] = `mcp__${now}__`;
        out[`\`${old}\``] = `\`${now}\``;
    }
    const first = engines.find((e) => PW_ENGINES.includes(e)) || 'chrome';
    for (const [from, to] of Object.entries(renamedMcps || {}))
        if (to === 'browser') out[`mcp__${from}__`] = `mcp__${to}-${first}__`;
    return out;
}

// The rules a capture GENERATED into the project (`alfred-project-*`, `project-code-style`) - never a
// catalog rule, never one of the project's own.
function generatedRules(projectRoot)
{
    const rules = path.join(projectRoot, '.claude', 'rules');
    try { return fs.readdirSync(rules).filter((f) => /^(alfred-project-.+|project-code-style)\.md$/.test(f)).sort().map((f) => path.join(rules, f)); }
    catch { return []; }
}

// 2.1.6: the generated rules dropped the `baseline-` prefix. Their captures never re-run by themselves, so
// an existing `baseline-project-<x>.md` MOVES to `alfred-project-<x>.md` with its content kept (a rename of
// the file, never a copy or a rewrite). Only the four names the stack ever generated: a project's own
// `baseline-project-notes.md` is no file of ours. A file already there under the new name is a newer
// capture and wins; the old one stays and is named, since two of them would both load.
const GENERATED_RULE_NAMES = ['agent-capabilities', 'related-context', 'architecture', 'run-book'];
function moveGeneratedRules({ projectRoot, log = () => {}, note = () => {} })
{
    const rules = path.join(projectRoot, '.claude', 'rules');
    let moved = 0;
    for (const name of GENERATED_RULE_NAMES)
    {
        const from = path.join(rules, `baseline-project-${name}.md`);
        const to = path.join(rules, `alfred-project-${name}.md`);
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to))
        {
            // A capture already wrote the new name: the old file is what it superseded when it is byte-identical or no newer.
            let superseded = false;
            try { superseded = fs.readFileSync(from).equals(fs.readFileSync(to)) || fs.statSync(from).mtimeMs <= fs.statSync(to).mtimeMs; } catch { /* unreadable: keep and warn */ }
            if (!superseded) { log(`  !! .claude/rules/baseline-project-${name}.md is newer than alfred-project-${name}.md and differs - both load; merge what you need, then remove the old one`); continue; }
            try { fs.rmSync(from); log(`  removed: rule baseline-project-${name}.md - superseded by the alfred-project-${name}.md already there`); }
            catch (err) { note(`.claude/rules/baseline-project-${name}.md is superseded by alfred-project-${name}.md but could not be removed (${err.message}) - remove it by hand`); }
            continue;
        }
        try { fs.renameSync(from, to); moved += 1; log(`  moved: rule baseline-project-${name}.md -> alfred-project-${name}.md (content kept)`); }
        catch (err) { note(`.claude/rules/baseline-project-${name}.md could not be moved to alfred-project-${name}.md (${err.message}) - rename it by hand`); }
    }
    return moved;
}

// M11: a capture bakes the LITERAL docs root into its generated pointer rule (a rule cannot resolve a
// setting at load), so a data move that carried the docs from `from` to `to` re-stamps each of them, as the
// installer re-stamps alfred-docs-root. Only the root as a whole path segment is replaced (`.alfred/docs`
// never inside `.alfred/docs-old` or `x/.alfred/docs`); a rule naming it nowhere is left as it is.
function respellDocsRoot({ projectRoot, from, to, log = () => {}, note = () => {} })
{
    if (!from || !to || from === to) return 0;
    const escape = (o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_./-])${escape(from)}(?![A-Za-z0-9_.-])`, 'g');
    const done = [];
    for (const file of generatedRules(projectRoot))
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const out = text.replace(re, to);
        if (out === text) continue;
        try { fs.writeFileSync(file, out); done.push(path.basename(file)); }
        catch (err) { note(`${path.basename(file)} still names the docs root ${from} and could not be re-stamped (${err.message}) - re-run its capture`); }
    }
    if (done.length) log(`  docs root: ${done.length} generated rule(s) re-stamped: ${from} -> ${to} (${done.join(', ')})`);
    return done.length;
}

function respellRenamed({ projectRoot, renamed, engines = [], log = () => {}, note = () => {} })
{
    // A rule is named in a seeded AGENTS.md by its path (`.claude/rules/baseline-git.md`), so its pairs are the
    // file names without the extension; the four generated pointers moved by moveGeneratedRules follow the same way.
    const rules = Object.fromEntries(Object.entries((renamed && renamed.rules) || {}).map(([o, n]) => [o.replace(/\.md$/, ''), n.replace(/\.md$/, '')]));
    const generated = Object.fromEntries(GENERATED_RULE_NAMES.map((g) => [`baseline-project-${g}`, `alfred-project-${g}`]));
    const pairs = { ...((renamed && renamed.skills) || {}), ...((renamed && renamed.agents) || {}), ...rules, ...generated };
    const olds = Object.keys(pairs).sort((a, b) => b.length - a.length);
    const escape = (o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mcpPairs = mcpRespellPairs((renamed && renamed.mcps) || {}, engines);
    const mcpOlds = Object.keys(mcpPairs).sort((a, b) => b.length - a.length);
    if (!olds.length && !mcpOlds.length) return 0;
    const re = olds.length ? new RegExp(`(?<![A-Za-z0-9_-])(${olds.map(escape).join('|')})(?![A-Za-z0-9_-])`, 'g') : null;
    const mcpRe = mcpOlds.length ? new RegExp(mcpOlds.map(escape).join('|'), 'g') : null;
    let total = 0;
    for (const file of [path.join(projectRoot, 'AGENTS.md'), path.join(projectRoot, '.claude', 'AGENTS.md'), path.join(projectRoot, 'CLAUDE.md'), path.join(projectRoot, '.claude', 'CLAUDE.md'), ...generatedRules(projectRoot)])
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        let n = 0;
        let m = 0;
        let out = re ? text.replace(re, (old) => { n += 1; return pairs[old]; }) : text;
        if (mcpRe) out = out.replace(mcpRe, (old) => { m += 1; return mcpPairs[old]; });
        if (!n && !m) continue;
        const rel = path.relative(projectRoot, file).split(path.sep).join('/');
        try { fs.writeFileSync(file, out); }
        catch (err) { note(`${rel} names ${n + m} old skill, seat or MCP name(s) and could not be re-spelled (${err.message})`); continue; }
        total += n + m;
        if (n) log(`  renamed: ${rel} - ${n} old skill or seat name(s) re-spelled to the new names`);
        if (m) log(`  renamed: ${rel} - ${m} old MCP tool or server name(s) re-spelled to the new names`);
    }
    return total;
}

// THE ROSTER'S SEAT SPELLING (M6). The generated capabilities rule names each seat as it resolves, and flows
// dispatch a seat exactly as that roster spells it. A plugin seat answers only to `<core>:<seat>` (a bare name
// is 'Agent type not found'), so a roster written before the seats moved onto the core - a 2.0.0 library seat,
// listed bare - sends every flow to a seat that does not resolve. Its `## Subagent seats` list is re-spelled:
// a bare core seat with no project copy takes the core's name; a seat whose project copy is kept (a tuned or
// edited seat, `.claude/agents/<seat>.md`) is named bare, the copy's own name - the one a flow should run. A
// name the core does not carry, and every line that is not a plain name list, is left as written.
function respellRosterSeats({ projectRoot, core, seats = [], log = () => {}, note = () => {} })
{
    const file = path.join(projectRoot, '.claude', 'rules', 'alfred-project-agent-capabilities.md');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
    const carried = new Set(seats);
    const copied = (seat) => fs.existsSync(path.join(projectRoot, '.claude', 'agents', `${seat}.md`));
    const lines = text.split('\n');
    let inSeats = false;
    let changed = 0;
    for (let i = 0; i < lines.length; i += 1)
    {
        if (/^## /.test(lines[i])) { inSeats = /^## Subagent seats\s*$/.test(lines[i]); continue; }
        if (!inSeats || !lines[i].trim()) continue;
        const names = lines[i].split(',').map((t) => t.trim());
        if (!names.every((t) => /^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)?$/.test(t))) continue;
        const spelled = names.map((t) =>
        {
            const bare = t.startsWith(`${core}:`) ? t.slice(core.length + 1) : t;
            if (t.includes(':') && bare === t) return t;   // another plugin's seat
            if (!carried.has(bare)) return t;
            return copied(bare) ? bare : `${core}:${bare}`;
        });
        const out = [...new Set(spelled)].join(', ');
        if (out === names.join(', ')) continue;
        changed += spelled.filter((t, n) => t !== names[n]).length || 1;
        lines[i] = out;
    }
    if (!changed) return 0;
    try { fs.writeFileSync(file, lines.join('\n')); }
    catch (err) { note(`.claude/rules/alfred-project-agent-capabilities.md names ${changed} seat(s) the core answers under ${core}:<seat> and could not be re-spelled (${err.message}) - re-run /alfred-capture-agent-capabilities`); return 0; }
    log(`  roster: alfred-project-agent-capabilities.md - ${changed} seat name(s) re-spelled to how they resolve (${core}:<seat> on the core, bare for a kept project copy)`);
    return changed;
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
const foldMcp = (name) => (PW_ENGINE.test(name) ? 'browser' : name);
//
// `pluginCatalog` is every plugin the catalog names, the core's companions included: an
// enabled one is installed whatever the selection says (a companion every run adds, or an optional
// pick the user installed - kept, never removed), or an
// unchanged walk would add it back on every run. `leftOut` is what the user switched off - the
// seats denied, the items of a parked entry - so the walk's closure cannot quietly turn it back on.
// A disabled claude-hud is parked but gets no DISABLED row: that row's accept action is an enable,
// and the user's off wins for it (plugins.js USER_OFF_WINS).
function planInventory({ lists, listing = [], answered, pluginCatalog = [], leftOut = [] })
{
    const uniq = (xs) => [...new Set(xs)];
    const rowOf = new Map(listing.map((r) => [r.name, r]));
    const pickedMcps = new Set((lists.mcps || []).map(nameOfMcp));
    const picked = uniq([...(lists.plugins || []).map(nameOfPlugin), ...pluginCatalog.filter((n) => rowOf.has(n) && rowOf.get(n).enabled)]);
    return {
        skills: uniq((lists.skills || []).map(nameOfSkill)),
        agents: uniq((lists.agents || []).map(nameOfFile)),
        rules: uniq((lists.rules || []).map(nameOfFile)),
        hooks: uniq((lists.hooks || []).map(nameOfFile)),
        mcps: uniq((lists.mcps || []).map((e) => foldMcp(nameOfMcp(e)))),
        plugins: picked.filter((n) => rowOf.has(n) && rowOf.get(n).enabled).map((n) => ({ name: n, scope: rowOf.get(n).scope })),
        // A kept engine the user left off (R67) is their choice, not a parked entry to switch back on.
        plugins_disabled: listing.filter((r) => !rowOn(r) && !USER_OFF_WINS.includes(r.name) && !(engineOf(r.name) && pickedMcps.has(r.name))).map((r) => r.name),
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
// The core (the hooks ride it) and the three locked servers are never queued: a drop of them is
// refused before it gets here anyway.
const NEVER_DISABLED = new Set([BRAND.core, 'navigation', 'documentation', 'memory']);
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
    addLines, closeLines, dropLines, dropFormerPicks, renameLines, renamePicked, renameDeny, moveGeneratedRules, respellRenamed, respellRosterSeats, respellDocsRoot, generatedRules, parseSelection, applySelection, renderPlan, deriveFromDisk, hasInstall,
    adoptHooks, adoptAlways, readBack, planInventory, leftOut, droppedEntries, CATEGORY, RULE_EXCLUDE, HOOK_EXCLUDE, FORMER_PLUGINS,
};
