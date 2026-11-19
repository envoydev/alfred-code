'use strict';
// REMOVE-NESTED'S GUARD (2026-11-19 review, BLOCKER 1) - the removal runs with the nested folder as the project root, but a
// folder-level link inside it (`.alfred`, `.claude/skills`, `.claude/settings.local.json`...) can point at the REPOSITORY TOP's
// install, and every helper the steps call follows a link: it read, hashed, deleted or rewrote the root's file. Two layers:
//   refusal()  before anything moves - each path a step reaches that is a link, or resolves outside the folder, stops the verb
//   guard()    in front of every delete and write - a target whose real folder is not the nested folder is skipped and named
const fs = require('node:fs');
const path = require('node:path');
const { GUARDED_PATHS } = require('./nested-constants.js');

const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const lstatOf = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const isLink = (p) => Boolean(lstatOf(p) && lstatOf(p).isSymbolicLink());
const toPosix = (p) => p.split(path.sep).join('/');
const within = (dir, base) => dir === base || dir.startsWith(base + path.sep);

// Where a link points, for the refusal line: its own text, else the real path.
function pointsAt(p)
{
    try { return fs.readlinkSync(p); }
    catch { return realOf(p) || 'somewhere else'; }
}

// The first path under `nested` a step would reach that is a link or resolves outside `nested`, as the `!!` text; null when none.
// `rel` names the folder below the root, `extra` the paths below `nested` the stamp adds (its own file, the tool-ignore files).
function refusal({ nested, rel, extra = [] })
{
    for (const sub of [...GUARDED_PATHS, ...extra])
    {
        const at = path.join(nested, ...sub.split('/'));
        const st = lstatOf(at);
        if (!st) continue;
        if (st.isSymbolicLink()) return `${rel}/${sub} is a link to ${pointsAt(at)} - nothing is removed through a link; replace it with the real folder or file, or remove it, and run again`;
        const real = realOf(at);
        if (!real || !within(real, nested)) return `${rel}/${sub} resolves to ${real ? toPosix(real) : 'a path outside this folder'}, outside ${rel} - nothing is removed through it`;
    }
    return null;
}

// The one gate for a delete (`canRemove`) and a write (`canWrite`): the target's real folder is the nested folder or below it
// (a target that is not there has nothing to delete).
// A target that is itself a link is only unlinked by a delete - never followed - and no write goes through one.
function guardFor(nested)
{
    const base = realOf(nested);
    const folderOk = (target) => { const real = realOf(path.dirname(target)); return Boolean(base && real && within(real, base)); };
    return {
        canRemove: (target) => !lstatOf(target) || folderOk(target),
        canWrite: (target) => folderOk(target) && !isLink(target),
    };
}

// The ledger without the rows of the settings files named in `blocked`, so the settings pass leaves those files alone.
function ledgerWithout(ledger, blocked)
{
    const drop = (rows) => Object.fromEntries(Object.entries(rows || {}).filter(([name]) => !blocked.includes(name)));
    return { ...ledger, env: drop(ledger.env), settings: drop(ledger.settings),
        deny: (ledger.deny || []).filter((d) => !blocked.includes(d.file)), hooks: (ledger.hooks || []).filter((h) => !blocked.includes(h.file)) };
}

module.exports = { refusal, guardFor, ledgerWithout, pointsAt };
