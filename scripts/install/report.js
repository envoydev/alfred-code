'use strict';
// One run's report: the items the run's writers added, updated, removed or kept as the user's own. The writers feed one
// collector; `line` renders it. Nothing here reads the disk.
const { EVENT, SESSION_KINDS, NAME_CAP, NAME_JOIN, NAME_OVERFLOW, DENY_KIND, DENY_ITEM, REPORT_PREFIX } = require('./report-constants.js');

// A seat is named without its `.md`; any other name is as the writer gave it (an exclude glob ends in `.md` and keeps it).
const itemName = (kind, name) => `${kind} ${kind === 'agent' ? String(name).replace(/\.md$/, '') : name}`;

function createReport()
{
    const events = Object.fromEntries(Object.values(EVENT).map((event) => [event, new Set()]));
    const denies = Object.fromEntries(Object.values(EVENT).map((event) => [event, new Set()]));
    const feed = (event) => (kind, name) => { (kind === DENY_KIND ? denies : events)[event].add(kind === DENY_KIND ? name : itemName(kind, name)); };
    // An item the run removed, added or re-pointed and then met again is one item that changed: updated, in neither of the
    // other two lists. `before` are the lists whose entry for it is moved.
    const again = (event, before) => (kind, name) =>
    {
        const item = itemName(kind, name);
        if (kind !== DENY_KIND && before.some((list) => events[list].delete(item))) events[EVENT.updated].add(item);
        else if (kind !== DENY_KIND && event === EVENT.added && events[EVENT.updated].has(item)) return;
        else feed(event)(kind, name);
    };
    const add = again(EVENT.added, [EVENT.removed]);
    // The deny rows count as one item, listed after the others.
    const names = (event) => [...events[event], ...(denies[event].size ? [DENY_ITEM(denies[event].size)] : [])];
    const listed = (event) =>
    {
        const all = names(event);
        if (!all.length) return '';
        return ` (${[...all.slice(0, NAME_CAP), ...(all.length > NAME_CAP ? [NAME_OVERFLOW] : [])].join(NAME_JOIN)})`;
    };
    return {
        add, update: again(EVENT.updated, [EVENT.removed, EVENT.added]), remove: feed(EVENT.removed), keep: feed(EVENT.kept),
        names,
        // True when the run added, updated or removed an item a session loads at its start (a rule or an agent).
        changedSessionItems: () => [EVENT.added, EVENT.updated, EVENT.removed].some((event) => [...events[event]].some((item) => SESSION_KINDS.includes(item.split(' ')[0]))),
        // `rel` is the level's path below the run's top, `.` for the top itself.
        line: (rel) => `${REPORT_PREFIX} ${rel}: added ${names(EVENT.added).length}${listed(EVENT.added)}, updated ${names(EVENT.updated).length}, removed ${names(EVENT.removed).length}${listed(EVENT.removed)}, kept, yours ${names(EVENT.kept).length}${listed(EVENT.kept)}`,
    };
}

module.exports = { createReport, itemName };
