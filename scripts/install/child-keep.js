'use strict';
// The root's installer side of the keep (workspace-child-stacks): it reads the workspace records at and below a root for what
// the root keeps for each set-aside child, and writes back the lines a run changed. The rules are pure, in
// scripts/workspace-include/keep.js and select.js. This file requires workspace.js, so workspace.js requires it only inside
// a function.

const path = require('node:path');
const ws = require('./workspace.js');
const stamp = require('./stamp.js');
const recordFile = require('../../stack/hooks/workspace-file.js');
const keep = require('../workspace-include/keep.js');
const select = require('../workspace-include/select.js');

const quiet = () => {};
// A kept key is compared with a child the way the hook's `keptLinesFor` does: case folded where the disk folds it.
const low = (text) => recordFile.low(text);
const lineOf = (entry) => `${entry.category} ${entry.name}`;
const isEntry = (line) => recordFile.isIgnoreEntry(...line.split(' '));
const childRoot = (root, rel) => path.join(root, ...rel.split('/'));
const ignoresOf = (root, rels, env) => Object.fromEntries(rels.map((rel) => [rel, ws.readWorkspace(childRoot(root, rel), { env }).view.ignores.map(lineOf)]));
const ownPicksOf = (root) => { const file = stamp.stampFiles({ projectRoot: root }).read; return (file && stamp.readOwnPicks(file)) || []; };

// Each readable record at or below `top`: the `subtree()` rows, the records ({ root, rel, view }) and each record's view by its row.
function recordsBelow(top, { env, dataRoot, log = quiet })
{
    const rows = ws.subtree(top, { env, log });
    const records = [];
    for (const row of rows.filter((entry) => entry.state === 'ok'))
    {
        const read = ws.readWorkspace(row.root, row.rel === '.' ? { env, dataRoot } : { env });
        if (read.state !== 'garbage') records.push({ root: row.root, rel: row.rel, view: read.view });
    }
    return { rows, records, viewsByParent: Object.fromEntries(records.map((record) => [record.rel, record.view])) };
}

// What the root's run keeps for set-aside children, read from the top's record and from each middle root's: { storeLines,
// rewrite, notes }. `storeLines` are the skills, agents and rules the store holds for a keep; `rewrite` each record root whose
// kept lines changed (a backstop line, a line read under a new name or dropped) with its new `keptFor`. Nothing is written
// here - the run holds the workspace lock.
function readKeep({ projectRoot, dataRoot, env = process.env, log = quiet, ownLines, priorOwn, renamed, retired })
{
    const out = { storeLines: [], rewrite: [], notes: [] };
    for (const record of recordsBelow(projectRoot, { env, dataRoot, log }).records)
    {
        const top = record.rel === '.';
        const { view } = record;
        const keptFor = view.keptFor || {};
        const asideRels = top ? select.setAsideRels(view) : [];
        const rels = [...new Set([...Object.keys(keptFor), ...asideRels])];
        if (!rels.length) continue;
        const ignoresByRel = ignoresOf(record.root, rels, env);
        const backstop = top && priorOwn ? keep.backstopLines(priorOwn.filter(isEntry), ownLines, retired, asideRels, ignoresByRel, keptFor, low) : {};
        const settled = keep.settleKept({ keptFor, children: view.children, backstop, childIgnores: ignoresByRel, rootLines: top ? ownLines : ownPicksOf(record.root), renamed, retired, low });
        out.storeLines.push(...keep.storeLines({ ...view, keptFor: settled.keptFor }, low));
        out.notes.push(...settled.notes);
        if (settled.changed) out.rewrite.push({ root: record.root, dataRoot: top ? dataRoot : undefined, keptFor: settled.keptFor });
    }
    out.storeLines = [...new Set(out.storeLines)].sort();
    return out;
}

// The `subtree()` rows below `top` that a parent's record sets aside, as the rels the records write them.
function asideRows(top, { env })
{
    const { rows, viewsByParent } = recordsBelow(top, { env });
    return select.asideRows(rows, viewsByParent);
}

// Writes each record's new kept lines, after the run's lock is released. A refused write is named and the next root run makes it.
function writeBack(rewrite, { top, log = quiet })
{
    for (const entry of rewrite)
    {
        const wrote = ws.writeWorkspace(entry.root, (record) => { record.keptFor = entry.keptFor; return record; }, { dataRoot: entry.dataRoot, runRoot: top, log: (line) => log(`  ${line}`) });
        if (!wrote.ok) log(`  !! workspace: the kept lines of ${path.relative(top, entry.root).split(path.sep).join('/') || '.'} were not written (${wrote.why}) - the next run on this root writes them`);
    }
}

module.exports = { recordsBelow, readKeep, asideRows, writeBack };
