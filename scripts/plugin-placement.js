'use strict';
// Where every skill and agent lives. Placement is COMPUTED from meta/stack-graph.json, never
// hand-written, so `stack/` stays the one home per piece and a new skill or seat lands by the same
// rule as every other.
//
// The rule, whole (2.1.0):
//   1. Every SEAT rides the CORE plugin, enabled in every install. A seat the selection did not pick
//      is switched off per project by `permissions.deny: ["Agent(alfred-code:<seat>)"]` - spike S3
//      measured the seat leave the listing and its description leave the bill (-434 tokens).
//   2. Every SKILL is LIBRARY: shipped in this repo, listed by no marketplace entry, copied into a
//      project per pick by the installer.
//
// Why skills are never plugin items: a plugin skill is LOCKED on. Claude Code resolves a plugin
// skill's `skillOverrides` value to 'on' before any setting is read, and a `Skill(...)` deny removes
// nothing from the listing - both measured in the 2026-09-24 library test on 2.1.281. A project COPY
// can be switched off - deleted, set to 'off' / 'name-only' in `skillOverrides`, or hidden by a
// `paths:` line until a matching file is touched. A seat has its lever in the deny list, so it can
// ride the plugin, and a seat's bare `skills:` preload resolves the project copy (plugin-migration
// evidence S6). Before 2.1.0 the core carried the always closure instead (`formerCore` below), and
// every other seat was a library copy too.
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
    const plugins = { [CORE]: { skills: [], agents: Object.keys(graph.agents).sort(), dependencies: [] } };
    const library = { skills: Object.keys(graph.skills).sort(), agents: [] };
    return { plugins, library, stacks };
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

module.exports = { placement, formerCore, costOf, costToday, descriptionChars, mergeSelections, readJson, readRetiredPlugins, CORE, LIBRARY };
