'use strict';
// workspace-include: the one file of the feature that touches the outside world - the workspace record, the stamp and the
// output. It gathers what the pure rules in select.js and keep.js need, and writes what they decide.

const path = require('node:path');
const ws = require('../install/workspace.js');
const stamp = require('../install/stamp.js');
const recordFile = require('../../stack/hooks/workspace-file.js');
const select = require('./select.js');
const keep = require('./keep.js');
const { FLAG, EXIT, READ, WRITE_WHY, ERROR_PREFIX, LINE, TOP_RELS, MIN_BELOW_DEPTH } = require('./constants.js');

const quiet = () => {};
// A kept key is compared with a child the way the hook's `keptLinesFor` does: case folded where the disk folds it.
const low = (text) => recordFile.low(text);
const childRoot = (root, rel) => path.join(root, ...rel.split('/'));
const writeCode = (why) => (why === WRITE_WHY.locked ? EXIT.locked : EXIT.failed);
const ignoreLinesOf = (root, rel, env) => ws.readWorkspace(childRoot(root, rel), { env }).view.ignores.map((entry) => `${entry.category} ${entry.name}`);
const ignoresOf = (root, rels, env) => Object.fromEntries(rels.map((rel) => [rel, ignoreLinesOf(root, rel, env)]));
const ownPicksOf = (root) => { const file = stamp.stampFiles({ projectRoot: root }).read; return (file && stamp.readOwnPicks(file)) || []; };

// The root's joined children with their states, and each project below them: { state, rows, below, file }.
function readInclude(root, { env, log = quiet })
{
    const none = (state, file = null) => ({ state, rows: [], below: [], file });
    if (!ws.workspaceOn({ env, projectRoot: root })) return none(READ.off);
    const read = ws.readWorkspace(root, { env });
    if (read.state === 'garbage') return none(READ.garbage, read.file);
    if (!read.view.children.length) return none(ws.roleOf(root, { env, log: quiet }).kind === 'root' ? READ.noChildren : READ.notRoot, read.file);
    const rows = ws.subtree(root, { env, log });
    const below = rows.filter((row) => row.depth >= MIN_BELOW_DEPTH && row.state === 'ok').map((row) => row.rel);
    return { state: READ.ok, rows: select.liveStates(select.childStates(read.view), rows, low), below, file: read.file };
}

// The answer merged into the record under its lock: { ok, code, why, rows }. A usage fault is code 2 with its text in `why`.
function writeInclude(root, answer, { env, log = quiet })
{
    const read = ws.readWorkspace(root, { env });
    if (read.state === 'garbage') { ws.sayGarbage(read.file, root, log); return { ok: false, code: EXIT.failed, why: WRITE_WHY.garbage, rows: [] }; }
    const faulty = select.answerError(answer, read.view.children);
    if (faulty) return { ok: false, code: EXIT.usage, why: faulty, rows: [] };
    const childIgnores = ignoresOf(root, Object.keys(read.view.keptFor), env);
    const rootLines = ownPicksOf(root);
    const written = ws.writeWorkspace(root, (record) =>
    {
        select.applyAnswer(record, answer, low);
        record.keptFor = keep.pruneKept(record.keptFor, childIgnores, rootLines);
    }, { env, log });
    if (!written.ok) return { ok: false, code: writeCode(written.why), why: written.why, rows: [] };
    return { ok: true, code: EXIT.ok, rows: select.liveStates(select.childStates(written.view), ws.subtree(root, { env, log: quiet }), low) };
}

// `line` kept for each set-aside child that does not ignore it: { ok, code, why, kept, ignoring }.
function writeKeep(root, line, { env, log = quiet })
{
    const failed = (code, why, ignoring = []) => ({ ok: false, code, why, kept: [], ignoring });
    const read = ws.readWorkspace(root, { env });
    if (read.state === 'garbage') { ws.sayGarbage(read.file, root, log); return failed(EXIT.failed, WRITE_WHY.garbage); }
    const isEntry = (text) => recordFile.isIgnoreEntry(...text.split(' '));
    const targets = keep.keepTargets(read.view, line, ignoresOf(root, select.setAsideRels(read.view), env), isEntry);
    if (targets.error) return failed(EXIT.usage, targets.error);
    if (!targets.kept.length) return { ok: true, code: EXIT.ok, kept: [], ignoring: targets.ignoring };
    const written = ws.writeWorkspace(root, (record) => { for (const rel of targets.kept) keep.addKept(record, rel, line, low); }, { env, log });
    if (!written.ok) return failed(writeCode(written.why), written.why, targets.ignoring);
    return { ok: true, code: EXIT.ok, kept: targets.kept, ignoring: targets.ignoring };
}

// The `subtree()` rows a parent's record sets aside, with each parent's record read once.
function readAside(top, rows, { env })
{
    const rootByRel = new Map(rows.map((row) => [row.rel, row.root]));
    const views = Object.create(null);
    for (const parentRel of new Set(rows.map((row) => row.parentRel).filter((rel) => rel !== null && rel !== undefined)))
    {
        const dir = rootByRel.get(parentRel) || (TOP_RELS.includes(parentRel) ? top : childRoot(top, parentRel));
        views[parentRel] = ws.readWorkspace(dir, { env }).view;
    }
    return select.asideRows(rows, views);
}

// What `plan` and `cascade` skip: { skipped, heads, without } - the rels they run nothing in, the ones `plan` names, and a filter
// that takes a rel list (a disk walk's, say) less the skipped ones.
function readSkipped(top, rows, { env })
{
    const skipped = select.skippedRows(rows, readAside(top, rows, { env }));
    return { skipped, heads: select.asideHeads(rows, skipped), without: (rels) => select.withoutSkipped(rels, skipped, low) };
}

const usage = (text) => ({ code: EXIT.usage, line: `${ERROR_PREFIX}${text}` });
const writeFailure = (result) => (result.why === WRITE_WHY.garbage ? { code: result.code }
    : { code: result.code, line: `${ERROR_PREFIX}this project's workspace file could not be written (${result.why})` });

function runRead(read, { env, out })
{
    if (read.state === READ.notRoot) out(LINE.notRoot);
    else if (read.state === READ.noChildren) out(LINE.noChildren);
    else
    {
        for (const line of select.lines(read.rows, read.below)) out(line);
        // init-plan.js loads the installer's whole tree, so it is read only here, after every record this run needs.
        if (require('../init-plan.js').isUnattended(env)) out(LINE.unattended);
    }
    return { code: EXIT.ok };
}

// The verb: `values` maps each flag the command line named to its value. Returns { code, line } - a line is an error to print last.
function runInclude({ root, values }, { env, out })
{
    const faulty = select.flagError(values);
    if (faulty) return usage(faulty);
    const read = readInclude(root, { env, log: out });
    if (read.state === READ.off) { out(LINE.off); return { code: EXIT.ok }; }
    if (read.state === READ.garbage) { ws.sayGarbage(read.file, root, out); return { code: EXIT.failed }; }
    if (Object.hasOwn(values, FLAG.keep))
    {
        const kept = writeKeep(root, values[FLAG.keep], { env, log: out });
        if (kept.code === EXIT.usage) return usage(kept.why);
        if (!kept.ok) return writeFailure(kept);
        for (const line of keep.keepLines(values[FLAG.keep], kept.kept, kept.ignoring)) out(line);
        if (!kept.kept.length && !kept.ignoring.length) out(LINE.noneAside);
        return { code: EXIT.ok };
    }
    if (Object.hasOwn(values, FLAG.include) || Object.hasOwn(values, FLAG.setAside))
    {
        const saved = writeInclude(root, { include: select.csvOf(values[FLAG.include]), setAside: select.csvOf(values[FLAG.setAside]) }, { env, log: out });
        if (saved.code === EXIT.usage) return usage(saved.why);
        if (!saved.ok) return writeFailure(saved);
        for (const line of select.lines(saved.rows, [], true)) out(line);
        return { code: EXIT.ok };
    }
    return runRead(read, { env, out });
}

module.exports = { readInclude, writeInclude, writeKeep, readAside, readSkipped, runInclude };
