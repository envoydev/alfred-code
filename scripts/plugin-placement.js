'use strict';
// Where every skill and agent lives. Placement is COMPUTED from meta/recommendations.json +
// meta/stack-graph.json, never hand-written, so `stack/` stays the one home per piece and a new skill
// lands by the same rule as every other.
//
// The rule, whole:
//   1. Close the ALWAYS selection. Everything in it is the CORE plugin, enabled in every install.
//   2. Everything else is LIBRARY: shipped in this repo, listed by no marketplace entry, copied into
//      a project per pick by the installer.
//
// Why not a plugin per stack (the 1.0 rule, owner sets named in GROUP_NAMES): a plugin skill is
// LOCKED on. Claude Code resolves a plugin skill's `skillOverrides` value to 'on' before any
// setting is read, and a `Skill(...)` deny removes nothing from the listing - both measured in the
// 2026-09-24 library test on 2.1.281. So a skill that rode a per-stack plugin could never be
// switched off in the one project that did not want it; a project COPY can - deleted, or set to
// 'off' / 'name-only' in `skillOverrides`, or hidden by a `paths:` line until a matching file is
// touched. The per-stack entries v1.2.0 shipped are frozen in meta/retired-entries.json for their
// one release of transition.
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

    const core = computeClosure(graph, recs.always);
    const coreSkills = new Set(core.skills);
    const coreAgents = new Set(core.agents);
    const plugins = { [CORE]: { skills: [...core.skills].sort(), agents: [...core.agents].sort(), dependencies: [] } };

    const library = { skills: [], agents: [] };
    for (const name of Object.keys(graph.skills)) if (!coreSkills.has(name)) library.skills.push(name);
    for (const name of Object.keys(graph.agents)) if (!coreAgents.has(name)) library.agents.push(name);
    library.skills.sort();
    library.agents.sort();
    return { plugins, library, stacks };
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

// The per-stack entries 1.2.0 shipped, frozen when they retired: listed in the marketplace for one
// release so an installed one keeps working until update copies its picks into the project. The
// file stays while the names are retired - it is the only record of what each entry carried; an
// unreadable one reads as nothing retiring.
function readRetiredEntries(repo = REPO)
{
    try { return JSON.parse(fs.readFileSync(path.join(repo, 'meta/retired-entries.json'), 'utf8')).entries || []; }
    catch { return []; }
}

module.exports = { placement, costOf, costToday, descriptionChars, mergeSelections, readJson, readRetiredEntries, CORE, LIBRARY };
