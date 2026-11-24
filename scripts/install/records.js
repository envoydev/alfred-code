'use strict';
// One reader for what the stack recorded for a skill or a seat copy. The record lives on two stamp
// lines - the `library-*` hash a library copy wrote, and the `managed-files` row (`skills/<n>`,
// `agents/<n>.md`) the plugin route's ledger keeps - and every caller asks through this view.
const path = require('node:path');
const { readLibrary } = require('./stamp.js');
const { hashItem } = require('./library.js');
const { RECORD_KIND, VIEW_MAP, LEDGER_ROW } = require('./records-constants.js');
const { agentAt } = require('./links.js');

// The library lines win; a ledger row fills only an item they lack. `ledger` is `stamp.readLedger`'s
// result (or null): `files` is null when the stamp has no managed-files line, which holds nothing.
function recordView(stampFile, ledger)
{
    const library = stampFile ? readLibrary(stampFile) : null;
    const view = { skills: { ...(library?.skills || {}) }, agents: { ...(library?.agents || {}) }, rules: { ...(library?.rules || {}) }, ledgerHeld: false };
    const files = ledger?.files;
    if (!files || typeof files !== 'object') return view;
    view.ledgerHeld = true;
    for (const kind of Object.values(RECORD_KIND))
    {
        const { prefix, suffix } = LEDGER_ROW[kind];
        const into = view[VIEW_MAP[kind]];
        for (const [row, hash] of Object.entries(files))
        {
            if (!row.startsWith(prefix) || !row.endsWith(suffix)) continue;
            const name = row.slice(prefix.length, row.length - suffix.length);
            if (name && !name.includes('/') && !Object.hasOwn(into, name)) into[name] = hash;
        }
    }
    return view;
}

function recordOf(view, kind, name)
{
    const map = view?.[VIEW_MAP[kind]];
    return map && Object.hasOwn(map, name) ? map[name] : null;
}

// True only with a record to compare and a file to hash: a copy nothing recorded is never 'edited'.
function editedSince(view, kind, name, file)
{
    const record = recordOf(view, kind, name);
    if (!record) return false;
    let now;
    try { now = hashItem(file); }
    catch { return false; }
    return now !== null && now !== record;
}

// The carry invariant: a skill or seat the records hold, on disk at another hash, that this run did not rewrite
// keeps the hash recorded for it, so an edited copy's record survives a run that leaves the copy alone.
// `rewritten` is the set of ledger rows the run wrote itself; `dirOf` maps a kind to the folder its copies sit in.
function carriedRows(view, dirOf, rewritten)
{
    const out = {};
    for (const kind of Object.values(RECORD_KIND))
    {
        const { prefix, suffix } = LEDGER_ROW[kind];
        for (const name of Object.keys(view?.[VIEW_MAP[kind]] || {}))
        {
            const row = `${prefix}${name}${suffix}`;
            if (rewritten.has(row) || !editedSince(view, kind, name, (kind === RECORD_KIND.agent ? agentAt(dirOf[kind], name) : path.join(dirOf[kind], `${name}${suffix}`)))) continue;
            out[row] = recordOf(view, kind, name);
        }
    }
    return out;
}

module.exports = { recordView, recordOf, editedSince, carriedRows };
