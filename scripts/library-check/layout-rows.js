'use strict';
// The layout rows as decisions on gathered facts: values in, rows out. effects.js gathers the facts from the project.
const { ROW, NOTE_ROWS, KIND, FILE, WHY, rulePath, linkPath, settingsPath } = require('./constants.js');

const row = (name, path, why) => ({ row: name, path, why, note: NOTE_ROWS.has(name) });

// facts.rules: null where the rules are not judged (a fallback `.claude/rules` store), else
//   { picked: names this level writes natively, hasText: those with text in a store, onDisk: { name: 'marked' | 'unmarked' }, exempt }.
function ruleRows(rules)
{
    if (!rules) return [];
    const picked = new Set(rules.picked);
    const hasText = new Set(rules.hasText);
    const exempt = new Set(rules.exempt);
    const rows = [];
    for (const name of rules.picked)
    {
        const state = rules.onDisk[name];
        if (!state && hasText.has(name)) rows.push(row(ROW.nativeMissing, rulePath(name), WHY.nativeMissing));
        else if (state === 'unmarked' && !exempt.has(name)) rows.push(row(ROW.nativeUnmarked, rulePath(name), WHY.nativeUnmarked));
    }
    for (const [name, state] of Object.entries(rules.onDisk))
        if (state === 'marked' && !picked.has(name)) rows.push(row(ROW.nativeUnpicked, rulePath(name), WHY.nativeUnpicked));
    return rows;
}

// links: { expected: names that need a link or copy, picked: names this level picks, onDisk: { name: { link, live, intoStore } } }.
function linkRows(kind, links)
{
    if (!links) return [];
    const picked = new Set(links.picked);
    const rows = [];
    for (const name of links.expected)
        if (!links.onDisk[name]) rows.push(row(ROW.linkMissing, linkPath(kind, name), WHY.linkMissing));
    for (const [name, entry] of Object.entries(links.onDisk))
    {
        if (!entry.link || (!entry.intoStore && !entry.listed)) continue;
        if (!entry.live) rows.push(row(ROW.linkDangling, linkPath(kind, name), WHY.linkDangling));
        else if (entry.intoStore && !picked.has(name)) rows.push(row(ROW.linkUnpicked, linkPath(kind, name), WHY.linkUnpicked));
    }
    return rows;
}

const denyRows = (denies) => denies.map(({ file, seat }) => row(ROW.seatDenyLeft, settingsPath(file), WHY.seatDenyLeft(seat, file)));
const excludeRows = (excludes) => (excludes && (excludes.missing || excludes.stale)
    ? [row(ROW.excludeDrift, settingsPath(FILE.local), WHY.excludeDrift(excludes.missing, excludes.stale))] : []);
const sharedRows = (root) => (root ? [row(ROW.agentsSharedRepo, `.claude/${KIND.agents}`, WHY.agentsSharedRepo(root))] : []);

function layoutRows(facts)
{
    return [...ruleRows(facts.rules), ...linkRows(KIND.skills, facts.links.skills), ...linkRows(KIND.agents, facts.links.agents),
        ...denyRows(facts.denies), ...excludeRows(facts.excludes), ...sharedRows(facts.sharedRepo)];
}

module.exports = { layoutRows };
