'use strict';
// THE ONE-TIME MOVE INTO `.alfred` (the fixed root, 2026-11-11). The data root is always `.alfred`; an earlier release
// let a project name another folder. Every installer run but `--print-plan` and `uninstall` plans from what the reader
// found (stack/mcp/data-root.js dataRootOf) and moves the stack's own entries of such a folder into `.alfred`, before the
// run's first write. Deleted whole at the support floor.
//
// The rules:
// - only the entries the stack owns by name move (ROOT_ENTRIES and a `.gitignore` with the stack's header); anything
//   else stays in the old folder, which then stays, and the run's line names it;
// - ENTRY BY ENTRY, never one rename of a folder onto `.alfred`; an empty target folder is cleared first, so nothing nests;
// - `state/` and `statistics/` merge file by file - the hooks may already have written them under `.alfred`; any other
//   entry both folders hold is a clash, and a clash stops the run before its first write;
// - the secrets store never sits in a folder whose .gitignore does not cover it: `.alfred/.gitignore` first, the store
//   after every other entry and only where git ignores its target, the old folder's .gitignore last - COPIED where the
//   old folder keeps entries of its own, so what it kept out of git (an older server's browser profile) stays out;
// - the user's data is never deleted: a rename each, one duplicate hook state file dropped for the copy the hooks read.
const fs = require('node:fs');
const path = require('node:path');
const dataRoot = require('../../stack/mcp/data-root.js');
const runtime = require('./runtime.js');

const TARGET = dataRoot.DATA_ROOT_DEFAULT;
const MERGED = ['state', 'statistics'];
const IGNORE = '.gitignore';
const STORES = dataRoot.SECRET_FILES;

const at = (projectRoot, rel) => path.join(projectRoot, ...String(rel).split('/'));
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
const names = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const textOf = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const ownsIgnore = (text) => text !== null && !text.includes(dataRoot.DATA_IGNORE_HEAD);
// Whether git tracks a file at or under a project-relative path; false with no git or no repository.
function tracks(rt, projectRoot, rel)
{
    const r = rt.spawnCommand('git', ['ls-files', '--', rel], { cwd: projectRoot, encoding: 'utf8' });
    return r.status === 0 && Boolean(String(r.stdout || '').trim());
}

// The plan, nothing read past the folders and nothing written:
// { stop, sources: [{ root, steps: [{ entry, how: 'move' | 'merge' | 'ignore' | 'copy', tracked }], kept }], pending, empty }.
// `stop` is the run's stop line - a team's folder under a local-scope run, then a clash, then a `.alfred/.gitignore` of
// the project's own that would let git take the store.
function planFixedRoot({ projectRoot, info, scope, rt = runtime })
{
    const plan = { stop: null, sources: [], pending: [], empty: [] };
    const stops = { team: [], clash: [], exposed: [] };
    const planned = new Set();                                          // the entries an earlier source puts under .alfred
    let ignoreText = textOf(at(projectRoot, `${TARGET}/${IGNORE}`));    // as found, then as each source's plan leaves it
    for (const root of info.sources || [])
    {
        const dir = at(projectRoot, root);
        const owned = dataRoot.stackEntries(dir);
        const order = [...dataRoot.ROOT_ENTRIES.filter((e) => !STORES.includes(e)), ...STORES, IGNORE].filter((e) => owned.includes(e));
        const kept = names(dir).filter((e) => !owned.includes(e)).sort();
        // One source's two store names are its own pair; a store `.alfred` holds, or an earlier source brings, is a clash.
        const storeTaken = STORES.some((s) => planned.has(s) || there(at(projectRoot, `${TARGET}/${s}`)));
        const steps = [];
        const clash = [];
        for (const entry of order)
        {
            const target = at(projectRoot, `${TARGET}/${entry}`);
            let how = 'clash';
            if (entry === IGNORE)
            {
                const mine = textOf(path.join(dir, IGNORE));
                if (!ownsIgnore(ignoreText) || ignoreText === mine) { how = kept.length ? 'copy' : 'ignore'; ignoreText = mine; }
            }
            else if (STORES.includes(entry)) { if (!storeTaken) how = 'move'; }
            else if (!planned.has(entry) && (!there(target) || (isDir(target) && !names(target).length))) how = 'move';
            else if (MERGED.includes(entry) && isDir(path.join(dir, entry)) && (planned.has(entry) || isDir(target))) how = 'merge';
            if (how === 'clash') { clash.push(entry); continue; }
            if (entry !== IGNORE) planned.add(entry);
            steps.push({ entry, how, tracked: tracks(rt, projectRoot, `${root}/${entry}`) });
        }
        if (scope === 'local')
        {
            const shared = (info.candidates || []).some((c) => c.from === 'settings.json' && dataRoot.sameRoot(projectRoot, c.root, root));
            const why = shared ? 'named in .claude/settings.json' : tracks(rt, projectRoot, root) ? 'tracked by git' : '';
            if (why) stops.team.push(`  !! data root: ${root} is the team's (${why}) - a project-scope update moves it; nothing changed`);
        }
        if (clash.length) stops.clash.push(`  !! data root: ${root} and ${TARGET} both hold ${clash.join(', ')} - merge them into ${TARGET} by hand, then run /alfred-code:update`);
        const open = ownsIgnore(ignoreText) ? steps.filter((s) => STORES.includes(s.entry) && dataRoot.gitIgnores(projectRoot, `${TARGET}/${s.entry}`) === false).map((s) => s.entry) : [];
        if (open.length) stops.exposed.push(`  !! data root: ${TARGET}/${IGNORE} does not keep ${open.join(', ')} out of git - add it there, then run /alfred-code:update`);
        plan.sources.push({ root, steps, kept });
    }
    const first = [stops.team, stops.clash, stops.exposed].find((lines) => lines.length);
    if (first) plan.stop = first.join('\n');
    // A store an earlier run could not move (the stamp's `data-pending:` line), unless a source's own plan carries it.
    for (const row of (info.recorded && info.recorded.pending) || [])
    {
        const name = path.posix.basename(row.from);
        const dir = path.posix.dirname(row.from);
        if (!STORES.includes(name) || !isFile(at(projectRoot, row.from))) continue;
        if ([TARGET, ...plan.sources.map((s) => s.root)].some((r) => dataRoot.sameRoot(projectRoot, r, dir))) continue;
        plan.pending.push({ from: row.from, to: `${TARGET}/${name}`, free: !STORES.some((s) => planned.has(s) || there(at(projectRoot, `${TARGET}/${s}`))) });
    }
    for (const c of info.candidates || [])
    {
        if (plan.empty.includes(c.root) || dataRoot.sameRoot(projectRoot, c.root, TARGET)) continue;
        if (isDir(at(projectRoot, c.root)) && !names(at(projectRoot, c.root)).length) plan.empty.push(c.root);
    }
    return plan;
}

// One entry to its place under `.alfred`: '' when it moved, else the reason. A tracked one goes through `git mv` (the
// history kept, staged as a rename), with the plain rename behind it when git refuses; `replace` is the .gitignore,
// which lands over the file already there.
function moveOne({ rt, projectRoot, from, to, tracked, replace })
{
    try
    {
        if (!replace && isDir(to)) fs.rmdirSync(to);        // the empty target folder the plan saw: cleared, never nested into
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (tracked)
        {
            const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/');
            try { rt.execCommand('git', ['mv', ...(replace ? ['-f'] : []), '--', rel(from), rel(to)], { cwd: projectRoot, stdio: 'ignore' }); return ''; }
            catch { /* git refused - a conflicted index, a target it will not write: the rename below */ }
        }
        if (replace) { fs.renameSync(from, to); return ''; }
        const moved = dataRoot.moveEntry(from, to, { file: isFile(from) });
        return moved.state === 'moved' ? '' : moved.why || moved.state;
    }
    catch (err) { return err.code || err.message; }
}

// `state/` or `statistics/` into the folder `.alfred` already holds, file by file: a free path moves; a ledger at both
// is appended to `.alfred`'s file; any other file at both keeps `.alfred`'s copy, the one the hooks read
// (docs.migrateLayout's rule). '' when the folder is merged and gone, else the reason.
function mergeDir(from, to)
{
    try
    {
        fs.mkdirSync(to, { recursive: true });
        for (const e of fs.readdirSync(from, { withFileTypes: true }))
        {
            const [a, b] = [path.join(from, e.name), path.join(to, e.name)];
            if (!there(b)) { fs.renameSync(a, b); continue; }
            if (e.isDirectory() !== isDir(b)) return e.isDirectory() ? 'ENOTDIR' : 'EISDIR';
            if (e.isDirectory())
            {
                const why = mergeDir(a, b);
                if (why) return why;
                continue;
            }
            if (e.name.endsWith('.jsonl'))
            {
                const [mine, theirs] = [fs.readFileSync(b), fs.readFileSync(a)];
                fs.appendFileSync(b, Buffer.concat([mine.length && mine[mine.length - 1] !== 0x0a ? Buffer.from('\n') : Buffer.alloc(0), theirs]));
            }
            fs.unlinkSync(a);
        }
        fs.rmdirSync(from);
        return '';
    }
    catch (err) { return err.code || err.message; }
}

// Plan, then move. { ok: false } with the stop line printed and nothing written, or at the first entry that fails -
// what moved stays moved, and the next update plans again and finishes. One line per source.
function moveToFixedRoot({ projectRoot, info, scope, rt = runtime, log = () => {} })
{
    const plan = planFixedRoot({ projectRoot, info, scope, rt });
    if (plan.stop) { log(plan.stop); return { ok: false }; }
    const ensureIgnore = () =>
    {
        try { dataRoot.ensureRootIgnore({ projectDir: projectRoot, root: TARGET }); return ''; }
        catch (err) { return err.code || err.message; }
    };
    for (const { root, steps, kept } of plan.sources)
    {
        const blocked = ensureIgnore();
        if (blocked) { log(`  !! data root: ${TARGET}/${IGNORE} could not be written (${blocked}) - nothing moved from ${root}; fix it, then run /alfred-code:update`); return { ok: false }; }
        const merged = [];
        for (const step of steps)
        {
            const from = at(projectRoot, `${root}/${step.entry}`);
            const to = at(projectRoot, `${TARGET}/${step.entry}`);
            let why;
            if (step.how === 'merge') { why = mergeDir(from, to); if (!why) merged.push(`${step.entry}/`); }
            else if (STORES.includes(step.entry) && dataRoot.gitIgnores(projectRoot, `${TARGET}/${step.entry}`) === false) why = `git would not ignore ${TARGET}/${step.entry}`;
            else if (step.how === 'copy') { try { fs.copyFileSync(from, to); why = ''; } catch (err) { why = err.code || err.message; } }
            else why = moveOne({ rt, projectRoot, from, to, tracked: step.tracked, replace: step.how === 'ignore' });
            if (why)
            {
                log(`  !! data root: ${root}/${step.entry} not moved (${why}) - what moved is in ${TARGET}, the rest is still in ${root}; fix it, then run /alfred-code:update`);
                return { ok: false };
            }
        }
        try { fs.rmdirSync(at(projectRoot, root)); } catch { /* an entry of the project's own keeps the folder */ }
        log(`  data root: moved ${root} to ${TARGET}${merged.length ? `, merged ${merged.join(' and ')}` : ''}${kept.length ? `, ${root} keeps ${kept.join(', ')} - not the stack's${steps.some((s) => s.how === 'copy') ? `, still under its ${IGNORE}` : ''}` : ''}`);
    }
    for (const row of plan.pending)
    {
        if (!row.free) { log(`  data root: ${row.from} not moved - ${row.to} already holds a store; merge them by hand`); continue; }
        let why = ensureIgnore();
        if (!why && dataRoot.gitIgnores(projectRoot, row.to) === false) why = `git would not ignore ${row.to}`;
        if (!why)
        {
            const moved = dataRoot.moveEntry(at(projectRoot, row.from), at(projectRoot, row.to), { file: true });
            if (moved.state !== 'moved') why = moved.why || moved.state;
        }
        log(why ? `  data root: ${row.from} not moved (${why})` : `  data root: moved ${row.from} -> ${row.to}`);
    }
    for (const root of plan.empty)
    {
        try { fs.rmdirSync(at(projectRoot, root)); log(`  data root: removed the empty ${root}`); }
        catch { /* held by another process: left */ }
    }
    return { ok: true };
}

module.exports = { planFixedRoot, moveToFixedRoot };
