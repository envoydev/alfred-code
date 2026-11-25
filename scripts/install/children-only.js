'use strict';
// Which skills a workspace root links only for its children (root-children-only-picks). Pure: values in, names out. The
// reader beside it (children-only-read.js) loads the catalogs and the root's files and hands them here.

const path = require('node:path');

const hasEvidence = (entry) => !!entry && Object.values(entry).some((signal) => Array.isArray(signal) && signal.length > 0);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const listOf = (entry, key) => (isObject(entry) && Array.isArray(entry[key]) ? entry[key] : []);

// { evidence, globs } for each name: `evidence` when evidence.skills holds a signal for it; `globs` the paths of each rule that
// loads it, and of each rule of each stack that seeds it. A rule or a stack of the wrong shape gives no glob, so the skill
// it would have signalled is trimmed by nothing.
function signalsOf({ names, evidence, graph, stacks })
{
    const rules = isObject(graph.rules) ? graph.rules : {};
    const evidenceSkills = isObject(evidence.skills) ? evidence.skills : {};
    const pathsOf = (rule) => listOf(rules[rule], 'paths');
    const out = new Map();
    for (const name of names)
    {
        const globs = new Set();
        for (const rule of Object.keys(rules)) if (listOf(rules[rule], 'skills').includes(name)) pathsOf(rule).forEach((glob) => globs.add(glob));
        for (const stack of Object.values(isObject(stacks) ? stacks : {}))
        {
            if (!listOf(stack, 'skills').includes(name)) continue;
            for (const rule of listOf(stack, 'rules')) pathsOf(rule).forEach((glob) => globs.add(glob));
        }
        out.set(name, { evidence: hasEvidence(evidenceSkills[name]), globs: [...globs] });
    }
    return out;
}

const matchesAny = (globs, files) => files.some((file) => globs.some((glob) => path.posix.matchesGlob(file, glob)));

// The sorted names the root lists by name alone: linked, not locked, held by a child, signalled, and with no signal hitting the
// root's own files - and none at all while a joined child shares the root's repository, whose sessions read the root's bare keys.
function trimmedSkills({ linked, locked, children, signals, evidenceHits, rootFiles })
{
    if (children.some((child) => child.sameRepo)) return [];
    const heldByChild = new Set(children.flatMap((child) => child.skills));
    return [...new Set(linked)].filter((name) =>
    {
        if (locked.has(name) || !heldByChild.has(name) || evidenceHits.has(name)) return false;
        const signal = signals.get(name);
        if (!signal || (!signal.evidence && !signal.globs.length)) return false;
        return !matchesAny(signal.globs, rootFiles);
    }).sort();
}

module.exports = { signalsOf, trimmedSkills };
