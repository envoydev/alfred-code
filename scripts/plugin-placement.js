'use strict';
// Where every skill and agent lives. Placement is COMPUTED from meta/stack-graph.json, never
// hand-written, so `stack/` stays the one home per piece and a new skill or seat lands by the same
// rule as every other.
//
// The rule, whole (seats left the core after 3.17):
//   1. Every SEAT is LIBRARY: a folder the installer copies into the project's store per pick and links
//      from `.claude/agents`, like a skill. The core carries no seat, so a seat the selection did not
//      pick has no copy and no listing, and the installer writes no `Agent(...)` deny row for one.
//      Through 3.17 every seat rode the core and an unpicked one was switched off by
//      `permissions.deny: ["Agent(alfred-code:<seat>)"]` (spike S3: -434 tokens); `formerSeats` below is
//      that placement, read only to bring such an install across.
//   2. Every SKILL is LIBRARY: shipped in this repo, listed by no marketplace entry, copied into a
//      project per pick by the installer.
//
// Why skills are never plugin items: a plugin skill is LOCKED on. Claude Code resolves a plugin
// skill's `skillOverrides` value to 'on' before any setting is read, and a `Skill(...)` deny removes
// nothing from the listing - both measured in the 2026-09-24 library test on 2.1.281. A project COPY
// can be switched off - deleted, set to 'off' / 'name-only' in `skillOverrides`, or hidden by a
// `paths:` line until a matching file is touched. A seat's lever was the deny list, which let it ride the
// plugin through 3.17; it is a library copy now like a skill, so an unpicked seat has no copy at all, and a seat's
// bare `skills:` preload resolves the project copy (plugin-migration evidence S6). Before 2.1.0 the core carried
// the always closure instead (`formerCore` below), and every other seat was a library copy too.
const fs = require('node:fs');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');

const REPO = path.resolve(__dirname, '..');
const CORE = 'alfred-code';
const LIBRARY = 'library';

function readJson(rel)
{
    return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
}

function mergeSelections(...selections)
{
    const out = { skills: [], agents: [], rules: [], mcps: [], plugins: [], hooks: [] };
    for (const sel of selections)
        for (const key of Object.keys(out)) out[key] = out[key].concat(sel[key] || []);
    for (const key of Object.keys(out)) out[key] = [...new Set(out[key])];
    return out;
}

// One description line is what an item costs on every message of every session that carries it.
function descriptionChars(kind, name)
{
    const file = kind === 'skill'
        ? path.join(REPO, 'stack/skills', name, 'SKILL.md')
        : path.join(REPO, 'stack/agents', name + '.md');
    const m = fs.readFileSync(file, 'utf8').match(/^description:\s*(.*)$/m);
    return m ? m[1].length : 0;
}

function placement(options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    const recs = options.recs || readJson('meta/recommendations.json');
    const stacks = Object.keys(recs.stacks);
    const plugins = { [CORE]: { skills: [], agents: [], dependencies: [] } };
    const library = { skills: Object.keys(graph.skills).sort(), agents: Object.keys(graph.agents).sort() };
    return { plugins, library, stacks };
}

// Every seat the release ships. Before 3.18 the core carried all of them (the stamp's `seats-route: plugin`), which is how a
// plugin-route install is read back: the seats that ran are these minus the denied.
function formerSeats(options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    return Object.keys(graph.agents).sort();
}

// The current always closure, a superset of what 2.0.x carried (harmless while the always skills stay
// locked, so update adopts them). A 2.0.x install was written under that placement - its read-back goes
// by it until its first 2.1 update stamps `seats-route:` - and the 1.x alias keeps listing it, so a
// straggler still on that id keeps its habit skills until it updates.
function formerCore(options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    const recs = options.recs || readJson('meta/recommendations.json');
    const closed = computeClosure(graph, recs.always);
    return { skills: [...closed.skills].sort(), agents: [...closed.agents].sort() };
}

// What a project pays: the core plus its stacks' library closure, each item counted once - which
// is per-item selection by construction, so `costOf` and `costToday` agree for every combination.
function costOf(place, stacks, options = {})
{
    const today = costToday(stacks, options);
    return { ...today, plugins: [CORE] };
}

// What the same project pays TODAY: per-item selection, no plugin anywhere.
function costToday(stacks, options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    const recs = options.recs || readJson('meta/recommendations.json');
    const closed = computeClosure(graph, mergeSelections(recs.always, ...[...new Set(stacks)].map(s => recs.stacks[s] || {})));
    let chars = 0;
    for (const s of closed.skills) chars += descriptionChars('skill', s);
    for (const a of closed.agents) chars += descriptionChars('agent', a);
    return { chars, skills: closed.skills.length, agents: closed.agents.length };
}

// The plugins a release took out of the stack, each with the marketplace it came from when that is
// not the stack's own and the line that adds its server back (meta/retired-plugins.json). Unreadable
// reads as nothing retiring.
function readRetiredPlugins(repo = REPO)
{
    try { return JSON.parse(fs.readFileSync(path.join(repo, 'meta/retired-plugins.json'), 'utf8')).plugins || []; }
    catch { return []; }
}

module.exports = { placement, formerCore, formerSeats, costOf, costToday, descriptionChars, mergeSelections, readJson, readRetiredPlugins, CORE, LIBRARY };
