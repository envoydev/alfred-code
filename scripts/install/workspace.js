'use strict';
// WORKSPACE LAYERING (spec docs: workspace layering design, section 2.1). A workspace ROOT folder holds an Alfred
// install, and the child projects under it hold their own installs that inherit the root's set and can ignore parts
// of it. Each project records its place in the tree in ONE machine-local record, `<data root>/workspace.json` (spec:
// the workspace.json design, 2026-11-10), read through the one reader `stack/hooks/workspace-file.js`:
//
//   parent    a run of `..` segments, so moving the whole tree keeps it valid - or role `root` / `standalone`, never both
//   above     the nearest stamped folder above when the role was last answered (a `..` run, or `none`) - update's tree-change test
//   children  direct children only, relative, `/` separated
//   ignore    category -> names: an inherited item this project leaves out (never its own)
//
// The old line file `<data root>/workspace` is still read, and converted at this installer's next write of the record:
// the writer folds it in, renames workspace.json into place and deletes it. An unknown key is kept and named; an invalid
// value is kept, never applied, until a mutation sets its key. A garbage workspace.json (not JSON) is never written over:
// every read of it here asks nothing and names it once. Every write takes `<data root>/workspace.lock` (created with
// `wx`, retried for 2 s, taken over when older than 30 s), reads, changes, writes a temp file and renames it into place -
// so two sibling inits cannot overwrite each other's `children` entry.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataRootMod = require('../../stack/mcp/data-root.js');
const workspaceFile = require('../../stack/hooks/workspace-file.js');
const brand = require('./brand.js');
const { readJson, parseJson, formatOf, stringifyLike } = require('./json-file.js');
const { sleepMs, takeLock } = require('./file-lock.js');
const runtime = require('./runtime.js');
const stamp = require('./stamp.js');

const { CATEGORIES, PARENT_RE, JSON_NAME, LEGACY_NAME, LOCK_NAME, isChildPath, isIgnoreName, emptyRecord, readRecord, viewOf, renderRecord } = workspaceFile;

// ------------------------------------------------------------------ the mutators, on a record (workspace-file.js emptyRecord's shape)

// A parent excludes a role: setting one clears the other. `none` is the 2.11 spelling of role standalone.
function setParent(record, rel)
{
    if (rel === 'none') return setRole(record, 'standalone');
    if (rel !== null && !PARENT_RE.test(String(rel))) throw new Error(`workspace: parent ${rel} is not a run of .. segments`);
    record.parent = rel;
    if (rel !== null) { record.role = null; record.parentNone = false; }
    return record;
}

// The answered role, or null to drop it; a role excludes a parent.
function setRole(record, value)
{
    if (value !== null && value !== 'root' && value !== 'standalone') throw new Error(`workspace: role ${value} is not root or standalone`);
    record.role = value;
    record.parentNone = false;
    if (value !== null) record.parent = null;
    return record;
}

// The nearest stamped folder above at the last answer (`none` when there was none), or null to drop it.
function setAbove(record, rel)
{
    if (rel !== null && rel !== 'none' && !PARENT_RE.test(String(rel))) throw new Error(`workspace: above ${rel} is not a run of .. segments or none`);
    record.above = rel;
    return record;
}

function addChild(record, rel)
{
    if (!isChildPath(rel)) throw new Error(`workspace: child ${rel} is not a relative path inside the project`);
    if (!record.children.includes(rel)) record.children.push(rel);
    return record;
}

function removeChild(record, rel)
{
    record.children = record.children.filter((c) => c !== rel);
    return record;
}

function addIgnore(record, category, name)
{
    const fixed = (category === 'docs' || category === 'memory') && name === 'root';
    if (!fixed && !isIgnoreName(category, name)) throw new Error(`workspace: ignore ${category} ${name} is not a known category and name`);
    const list = record.ignore[category] || (record.ignore[category] = []);
    if (!list.includes(name)) list.push(name);
    return record;
}

function removeIgnore(record, category, name)
{
    const list = (record.ignore[category] || []).filter((n) => n !== name);
    if (list.length) record.ignore[category] = list;
    else delete record.ignore[category];
    return record;
}

// ------------------------------------------------------------------ the switch

// ALFRED_CODE_WORKSPACE, a catalog row the installers never write. On by default since 3.0.0 (D9): only a `0` turns it
// off. The hooks' loader decides it (layout.js workspaceOn): a launch `0` freezes it, else
// settings.local.json, the project's .variables, then the settings env over the launch env.
function workspaceOn({ env = {}, projectRoot })
{
    return require('../../stack/hooks/layout.js').workspaceOn({ env, projectRoot });
}

// ------------------------------------------------------------------ the file

// { root, dir, file, legacy, lock } for the project's record - `file` workspace.json, `legacy` the old line file - or
// { why } when a handed data root is refused. A handed `dataRoot` is the root the caller's reader already
// found (an older install's folder, until its update moves it).
function locate(projectRoot, { dataRoot } = {})
{
    let root;
    if (dataRoot !== undefined && dataRoot !== null && dataRoot !== '')
    {
        const checked = dataRootMod.checkDataPath(dataRoot);
        if (!checked.ok) return { why: checked.why };
        root = checked.value;
    }
    else root = dataRootMod.dataRootOf({ projectDir: projectRoot }).root;
    const dir = path.join(projectRoot, ...root.split('/'));
    return { root, dir, file: path.join(dir, JSON_NAME), legacy: path.join(dir, LEGACY_NAME), lock: path.join(dir, LOCK_NAME) };
}

function workspacePath(projectRoot, opts = {})
{
    const at = locate(projectRoot, opts);
    if (!at.file) throw new Error(`workspace: data root refused - ${at.why}`);
    return at.file;
}

// { file, state, source, record, view, problems } - `state` is `ok`, `absent`, `garbage` (workspace.json is no JSON
// object; its record reads empty) or `unreadable` (a refused data root, `why`); `file` the path the record was read from.
function readWorkspace(projectRoot, opts = {})
{
    const at = locate(projectRoot, opts);
    if (!at.file) return { file: null, state: 'unreadable', source: null, record: emptyRecord(), view: viewOf(emptyRecord()), problems: [], why: at.why };
    const read = readRecord(at.dir);
    return { file: read.file, state: read.state, source: read.source, singular: read.singular, record: read.record, view: viewOf(read.record), problems: read.problems };
}

// The one line for a garbage record, `rel` the file's path from the folder the run reads from.
const garbageLine = (rel) => `!! workspace: ${rel} is not valid JSON - fix it by hand; the workspace pass neither reads nor writes it until then`;
// Named once per run, wherever it is met first.
const garbageSaid = new Set();
function sayGarbage(file, from, log)
{
    const key = realKey(file);
    if (garbageSaid.has(key)) return;
    garbageSaid.add(key);
    log(garbageLine(relPosix(realOf(from), realOf(file)) || path.basename(file)));
}
const printLine = (line) => process.stdout.write(`${line}\n`);

// The records this process converted, for olderProjectLines: { root, record, own, runRoot }.
let conversions = [];
function takeConversions()
{
    const taken = conversions;
    conversions = [];
    return taken;
}

const shownValue = (v) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));
// The rendered object's value at an invalid entry's key (`parent`, `ignore.skill`).
const valueAt = (object, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? (k in v ? v[k] : v[workspaceFile.PLURAL[k]]) : undefined), object);

// Reads, changes and writes the project's record under its lock. `mutate(record)` changes the record in place (or
// returns a new one). A write is due when the record renders differently after the change, or when the old line file is
// there - the conversion: workspace.json is written in the shape of the text it had (formatOf), renamed into place, and
// then the old file is deleted with one log line. A hand-saved workspace.json keeps its bytes until a value changes. A
// result's `wrote` says the file was written, `changed` that its values changed - a conversion alone writes, changing none. A
// garbage workspace.json is never written over (`why: 'garbage'`). `runRoot` is the run's own project (default
// `projectRoot`): the log lines name paths from it, and a conversion of another project's record is named by
// olderProjectLines.
function writeWorkspace(projectRoot, mutate, { dataRoot, runRoot, plural = false, log = () => {}, now = Date.now, sleep = sleepMs, retryMs = 2000, staleMs = 30000 } = {})
{
    const empty = viewOf(emptyRecord());
    const fail = (why, view = empty) => ({ ok: false, why, view, wrote: false, changed: false, converted: false });
    const at = locate(projectRoot, { dataRoot });
    if (!at.file) return fail('unwritable');
    try { fs.mkdirSync(at.dir, { recursive: true }); }
    catch { return fail('unwritable'); }
    const from = runRoot || projectRoot;
    let held = false;
    try
    {
        held = takeLock(at.lock, { now, sleep, retryMs, staleMs });
        if (!held) return fail('locked', viewOf(readRecord(at.dir).record));
        const current = readRecord(at.dir);
        if (current.state === 'garbage') { sayGarbage(current.file, from, log); return fail('garbage'); }
        const before = JSON.stringify(renderRecord(current.record, current.unknown, current.invalid, current.singular));
        const record = mutate(current.record) || current.record;
        const object = renderRecord(record, current.unknown, current.invalid, current.singular && !plural);
        const converting = current.source === 'legacy' || current.source === 'both';
        const changed = JSON.stringify(object) !== before;
        if (!converting && !changed) return { ok: true, view: viewOf(record), wrote: false, changed: false, converted: false };
        const tmp = `${at.file}.${process.pid}.${Date.now()}.tmp`;
        try
        {
            fs.writeFileSync(tmp, stringifyLike(object, formatOf(current.text ?? '')));
            fs.renameSync(tmp, at.file);
        }
        catch
        {
            try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ }
            return fail('unwritable', viewOf(current.record));
        }
        const fileRel = relPosix(from, at.file);
        for (const bad of current.invalid)
        {
            if (bad.entry) continue;
            const value = valueAt(object, bad.key);
            if (JSON.stringify(value) === JSON.stringify(bad.value)) continue;
            log(value === undefined ? `workspace: ${fileRel}: invalid ${bad.key} ${shownValue(bad.value)} dropped`
                : `workspace: ${fileRel}: invalid ${bad.key} ${shownValue(bad.value)} replaced by ${shownValue(value)}`);
        }
        if (converting)
        {
            // The old file goes only once workspace.json is in place; a delete that fails leaves the union, which the next write folds.
            try { fs.rmSync(at.legacy, { force: true }); } catch { /* read as 'both' until the next write */ }
            const where = relPosix(from, projectRoot) || 'this project';
            const named = current.problems.length ? ` (${current.problems.join('; ')})` : '';
            log(`workspace: ${relPosix(from, at.dir)}/${LEGACY_NAME} converted to ${JSON_NAME}${named} - restart any session open in ${where} since before this run`);
            conversions.push({ root: realOf(projectRoot), record, own: realKey(projectRoot) === realKey(from), runRoot: realOf(from) });
        }
        return { ok: true, view: viewOf(record), wrote: true, changed, converted: converting };
    }
    catch
    {
        return fail('unwritable');
    }
    finally
    {
        if (held) try { fs.unlinkSync(at.lock); } catch { /* already gone */ }
    }
}

// The run's own record converted to workspace.json before the workspace pass reads it - whatever ALFRED_CODE_WORKSPACE
// says: the conversion carries every value, so the switch's freeze still holds for the content. Writes nothing on a
// converted project. { ok, why, converted }.
function convertOwn({ projectRoot, env = process.env, dataRoot, log = () => {} })
{
    const r = writeWorkspace(projectRoot, (record) => record, { env, dataRoot, runRoot: projectRoot, log });
    return { ok: r.ok, why: r.why, converted: Boolean(r.converted) };
}

// The first release that reads workspace.json - the version bump that ships it sets this (review I3, 2026-11-10).
const JSON_SINCE = '3.10.0';
const PLURAL_SINCE = '3.11.0';   // the first release that reads the plural ignore keys (workspace-file.js PLURAL)

// After a conversion: each project whose older release would now misread - a child a converted record lists, the parent
// a converted record names, and the owner of a converted record not this run's own - when its stamp names a release
// before JSON_SINCE, on either route (its copied engines are its own). One `!!` line each, the run's own project never.
function olderProjectLines({ conversions: list = [], release, compare, env = process.env })
{
    if (!release || !compare) return [];
    // A member at JSON_SINCE or later reads workspace.json; a tree not yet at it (the unreleased one) compares with its own.
    const floor = compare(JSON_SINCE, release) > 0 ? release : JSON_SINCE;
    const out = [];
    const seen = new Set();
    const inside = (dir, top) => { const rel = path.relative(realKey(top), realKey(dir)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
    for (const c of list)
    {
        const runRoot = c.runRoot || c.root;
        seen.add(realKey(runRoot));
        const candidates = [];
        if (!c.own) candidates.push([c.root, inside(c.root, runRoot) ? 'child' : 'parent']);
        if (c.record.parent) candidates.push([path.resolve(c.root, ...c.record.parent.split('/')), 'parent']);
        for (const child of c.record.children) candidates.push([path.join(c.root, ...child.split('/')), 'child']);
        for (const [dir, kind] of candidates)
        {
            const key = realKey(dir);
            if (seen.has(key) || !isDir(dir)) continue;
            const file = stamp.stampFiles({ projectRoot: dir }).read;
            const version = file ? stamp.readVersion(file) : '';
            if (!version || compare(version, floor) >= 0) continue;
            seen.add(key);
            const label = relPosix(runRoot, realOf(dir)) || '.';
            out.push(`!! workspace: ${label} runs an older release - it reads the old workspace file, which is now ${JSON_NAME}; update ${label} next${kind === 'child' ? " (or take 'the children too')" : ''}`);
        }
    }
    return out;
}

// ------------------------------------------------------------------ the tree

const realOf = (p) =>
{
    try { return fs.realpathSync.native(p); }
    catch { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
};
// One spelling per folder: the hooks' tree key (layout.js pathKey) - the real path, `/` separated, case-folded where the
// filesystem folds case by default. One home, so the installer and the hooks never key a folder two ways. The path alone:
// callers hand realKey to Array.map, whose index must never reach pathKey's platform.
const realKey = (p) => require('../../stack/hooks/layout.js').pathKey(p);
const relPosix = (from, to) => path.relative(from, to).split(path.sep).join('/');
const isStamped = (dir) => fs.existsSync(path.join(dir, '.claude', brand.BRAND.stamp));
const isDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

// The nearest stamped folder above the project, as { root, rel } - never the account dir, whose `.claude/` may hold
// a stamp of its own. Walked from the real path, so a link's spelling never picks another tree.
function findParent(projectRoot, { env = process.env } = {})
{
    const start = realOf(projectRoot);
    const accounts = new Set([realKey(stamp.accountDir(env)), realKey(path.join(os.homedir(), '.claude'))]);
    for (let dir = path.dirname(start); ; dir = path.dirname(dir))
    {
        if (dir === start) return null;
        if (!accounts.has(realKey(path.join(dir, '.claude'))) && isStamped(dir)) return { root: dir, rel: relPosix(start, dir) };
        if (path.dirname(dir) === dir) return null;
    }
}

// The real top level of the checkout holding `dir`, or null outside one.
function topOf(dir, exec)
{
    try { return realKey(String(exec('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })).trim()); }
    catch { return null; }
}

function sameRepo(childRoot, parentRoot, { exec = runtime.execCommand } = {})
{
    const child = topOf(childRoot, exec);
    return child !== null && child === topOf(parentRoot, exec);
}

const isCheckout = (projectRoot, { exec = runtime.execCommand } = {}) => topOf(projectRoot, exec) === realKey(projectRoot);

// Whether this project may join the stamped folder above it: a project inside the parent's own repo is that repo's
// folder, not a child, and a plain folder has no install record of its own to keep apart.
function joinVerdict(projectRoot, { env = process.env, exec = runtime.execCommand } = {})
{
    const parent = findParent(projectRoot, { env });
    if (!parent) return { parent: null, ok: false };
    if (sameRepo(projectRoot, parent.root, { exec })) return { parent, ok: false, why: 'same-repo' };
    if (!isCheckout(projectRoot, { exec })) return { parent, ok: false, why: 'not-a-checkout' };
    return { parent, ok: true };
}

// ------------------------------------------------------------------ the role (roles spec D1, D2)

// The derived role: a child of `rel` when the parent hop holds; else a root by `role root` or any `child` line; else
// standalone. `asked` is false while the file holds no role, parent or above line (status:
// `standalone (no role recorded)` - never 'not asked', which elsewhere is a verdict to skip an ask: Sonnet skipped the
// init role ask on it, F28 in the fix run).
function roleOf(projectRoot, { env = process.env, log = printLine } = {})
{
    const read = readWorkspace(projectRoot, { env });
    // A garbage record is no role at all: nothing is derived from it, and it is named once.
    if (read.state === 'garbage') { sayGarbage(read.file, realOf(projectRoot), log); return { kind: 'unknown', asked: true }; }
    const view = read.view;
    // So is a parent whose own record is garbage: the chain cannot say whether it still lists this project.
    const parentRead = view.parent ? readWorkspace(path.resolve(realOf(projectRoot), ...view.parent.split('/'))) : null;
    if (parentRead && parentRead.state === 'garbage') { sayGarbage(parentRead.file, realOf(projectRoot), log); return { kind: 'unknown', asked: true }; }
    const children = view.children.length;
    const asked = Boolean(view.role || view.parent || view.above);
    if (view.parent && chain(projectRoot, { env, maxDepth: 1 }).members.length) return { kind: 'child', rel: view.parent, children, asked: true };
    if (view.role === 'root' || children) return { kind: 'root', children, asked };
    return { kind: 'standalone', asked };
}

const childCount = (n) => `${n} ${n === 1 ? 'child' : 'children'}`;
// status's words for a roleOf answer; null (the switch off) reads `workspace off`.
function roleText(role)
{
    if (!role) return 'workspace off';
    if (role.kind === 'unknown') return 'unknown - the workspace record is not valid JSON';
    if (role.kind === 'child') return `child of ${role.rel}${role.children ? `, root of ${childCount(role.children)}` : ''}`;
    if (role.kind === 'root') return role.children ? `root of ${childCount(role.children)}` : 'root, no child yet';
    return role.asked ? 'standalone' : 'standalone (no role recorded)';
}

const WHY = {
    'same-repo': (rel) => `${rel} is the same git repository - this folder is part of it, not a project of its own`,
    'not-a-checkout': (rel) => `this folder is no git checkout of its own, so it keeps no install record apart from ${rel}`,
};

// The role question for `when` (init, configure or update), its options Recommended first, each with the `--answer` word
// it runs: { case, rel, options, answers, why? }, or null when nothing is asked - always at ALFRED_CODE_WORKSPACE=0.
// update asks only on a tree change: never answered with a joinable folder above, `above` naming another folder than
// the nearest stamped one now, a child whose chain is empty, or a stamped folder between a child and its parent. A
// folder above that cannot be joined asks nothing, and `above` stays until an answer rewrites it.
function roleAsk(projectRoot, { env = process.env, exec = runtime.execCommand, when = 'configure', log = printLine } = {})
{
    if (!workspaceOn({ env, projectRoot })) return null;
    // A garbage record here, or in the parent it names, raises no ask: the line names the file, fixed by hand.
    const root = realOf(projectRoot);
    const own = readWorkspace(projectRoot, { env });
    if (own.state === 'garbage') { sayGarbage(own.file, root, log); return null; }
    if (own.view.parent)
    {
        const parentRead = readWorkspace(path.resolve(root, ...own.view.parent.split('/')));
        if (parentRead.state === 'garbage') { sayGarbage(parentRead.file, root, log); return null; }
    }
    const v = joinVerdict(projectRoot, { env, exec });
    const near = v.parent;
    const opt = (label, answer) => ({ label, answer });
    const out = (kind, rel, opts, extra = {}) => ({ case: kind, rel, options: opts.map((o) => o.label), answers: opts.map((o) => o.answer), ...extra });
    const join = near && v.ok ? [opt(`Join ${near.rel}`, `join:${near.rel}`)] : [];
    if (when === 'init')
    {
        if (near && v.ok) return out('init-child', near.rel, [opt(`Child of ${near.rel} (Recommended)`, 'child'), opt('Standalone', 'standalone'), opt('Root', 'root')]);
        if (near) return out('init-why', near.rel, [opt('Standalone (Recommended)', 'standalone'), opt('Root', 'root')], { why: WHY[v.why](near.rel) });
        return out('init-none', null, isCheckout(projectRoot, { exec })
            ? [opt('Standalone (Recommended)', 'standalone'), opt('Root', 'root')] : [opt('Root (Recommended)', 'root'), opt('Standalone', 'standalone')]);
    }
    const role = roleOf(projectRoot, { env, log });
    const keep = opt('Keep (Recommended)', 'stay');
    if (when === 'configure')
    {
        if (role.kind === 'child') return out('configure-child', role.rel, [keep, opt('Leave and become standalone', 'leave:standalone'), opt('Leave and become a root', 'leave:root')]);
        if (role.kind === 'root') return out('configure-root', near ? near.rel : null, [keep, ...join, opt('Become standalone', 'standalone')]);
        return out('configure-standalone', near ? near.rel : null, [keep, ...join, opt('Become a root', 'root')]);
    }
    const view = own.view;
    if (view.parent && role.kind !== 'child')
    {
        const lost = chain(projectRoot, { env, maxDepth: 1 }).notes.some((n) => n.endsWith('does not list this folder as a child'));
        if (lost) return out('rejoin', view.parent, [opt(`Rejoin ${view.parent} (Recommended)`, 'rejoin'), opt('Become standalone', 'leave:standalone')]);
        return out('parent-gone', view.parent, [opt('Become standalone (Recommended)', 'leave:standalone'), ...join]);
    }
    if (role.kind === 'child')
    {
        if (near && v.ok && near.rel !== view.parent && near.rel !== view.above)
            return out('between', near.rel, [opt(`Stay child of ${view.parent} (Recommended)`, 'stay'), opt(`Join ${near.rel}`, `join:${near.rel}`)]);
        return null;
    }
    if (!near || !v.ok) return null;
    if (!view.role && !view.above) return out('never', near.rel, [opt(`Join ${near.rel} (Recommended)`, `join:${near.rel}`), opt(`Stay ${role.kind}`, role.kind)]);
    // A role with no above line (a 2.12 `parent none`, a hand-typed role) was answered before above existed: quiet.
    if (view.above !== null && near.rel !== view.above) return out('above', near.rel, [opt(`Join ${near.rel} (Recommended)`, `join:${near.rel}`), opt(`Keep ${role.kind}`, 'stay')]);
    return null;
}

// The join itself: the parent's `child` line first, then this project's `parent` line - so a reader never finds a parent
// line whose parent does not list it; a role line goes, and `above` is written when the join is an answer to the role ask.
// { ok, code, rel, lines } - code 3 when a file is locked, 1 when one could not be written.
function register(projectRoot, { env = process.env, exec = runtime.execCommand, dataRoot, above = false } = {})
{
    const root = realOf(projectRoot);
    const v = joinVerdict(root, { env, exec });
    if (!v.parent) return { ok: false, code: 2, lines: [`!! workspace: no installed folder above ${root} - nothing to join`] };
    if (!v.ok) return { ok: false, code: 2, lines: [`!! workspace: ${v.parent.rel} cannot take this folder as a child (${v.why})`] };
    const childRel = relPosix(v.parent.root, root);
    const said = [];
    const log = (l) => said.push(l);
    const up = writeWorkspace(v.parent.root, (m) => addChild(m, childRel), { runRoot: root, log });
    if (!up.ok && up.why === 'locked') return { ok: false, code: 3, lines: [...said, `!! workspace: the workspace file in ${v.parent.rel} is locked by another run - nothing was written; the join is offered again at the next update`] };
    if (!up.ok && up.why === 'garbage') return { ok: false, code: 1, lines: [...said, `!! workspace: the workspace record in ${v.parent.rel} is garbage (not valid JSON) - nothing was joined; fix it by hand, then join again`] };
    if (!up.ok) return { ok: false, code: 1, lines: [...said, `!! workspace: the workspace file in ${v.parent.rel} could not be written (${up.why}) - nothing was joined`] };
    const here = writeWorkspace(root, (m) => setAbove(setRole(setParent(m, v.parent.rel), null), above ? v.parent.rel : null), { env, dataRoot, log });
    if (!here.ok)
    {
        // The parent's line alone is a child the chain never reaches: take it back, unless it was there before (a
        // conversion alone writes the parent's file without adding the line).
        if (up.changed) writeWorkspace(v.parent.root, (m) => removeChild(m, childRel), { runRoot: root });
        const state = here.why === 'locked' ? 'locked by another run' : here.why === 'garbage' ? 'garbage (not valid JSON)' : 'not writable';
        return { ok: false, code: here.why === 'locked' ? 3 : 1, lines: [...said, `!! workspace: this project's workspace file is ${state} - nothing was joined; the join is offered again at the next update`] };
    }
    return { ok: true, code: 0, rel: v.parent.rel, lines: [...said, `workspace: parent ${v.parent.rel} ${here.changed ? 'written' : 'kept'}`, `workspace: child ${childRel} ${up.changed ? 'written' : 'kept'} in ${v.parent.rel}`] };
}

// The stamp's managed-env line with `change(rows)` applied to its `.variables` rows - the rest of the stamp kept.
function editVariablesLedger(projectRoot, change)
{
    const file = stamp.stampFiles({ projectRoot }).read;
    if (!file) return;
    const ledger = stamp.readLedger(file) || stamp.emptyLedger();
    const env = { ...(ledger.env || {}) };
    env['.variables'] = change({ ...(env['.variables'] || {}) });
    if (!Object.keys(env['.variables']).length) delete env['.variables'];
    stamp.markLine(file, 'managed-env', stamp.renderLedger({ env })[0].slice('managed-env: '.length));
}

// A stack seed: the value still at its managed-env ledger hash AND the catalog default, or an old seed a reseed migration
// moves (the update would reset it anyway - the scorer's 0 and empty list, B1 of the 2026-11-03 usage audit) - an
// installer answer off the default (`--auto-compact on`, a walk's value) is ledgered the same way and is the project's own (D5).
let catalogSeeds = null;
function isSeed(key, value, rows)
{
    if (!catalogSeeds)
    {
        const meta = path.join(__dirname, '..', '..', 'meta');
        const reseed = require('./env-migrations.js').envMigrations(JSON.parse(fs.readFileSync(path.join(meta, 'migrations.json'), 'utf8'))).reseed;
        catalogSeeds = new Map(JSON.parse(fs.readFileSync(path.join(meta, 'environment.json'), 'utf8')).env
            .map((r) => [r.key, [r.default ?? '', ...reseed.filter(([k]) => k === r.key).map(([, bad]) => bad)].map(String)]));
    }
    return Boolean(rows[key]) && rows[key] === stamp.valueHash(value) && (catalogSeeds.get(key) || []).includes(String(value));
}

// A join's prune (D5): every stack seed (isSeed) in the joiner's `.variables` leaves (with its row) and the members'
// value reaches the project; a typed, changed or answered key, and DOCS_VERSIONING and WORKSPACE, stay as the project's
// own. One line names the count kept. A joiner whose values still sit in settings (a 2.12 project the update walk joins
// before the installer moves them) gets `join-prune: settings` in its stamp, so the next settings pass prunes them there
// (envPlan) - a 2.12 child that never answered a join keeps every value (the spec's Migration).
function pruneOnJoin(projectRoot, { env = process.env, log = () => {} } = {})
{
    const variables = require('./variables.js');
    const layout = require('../../stack/hooks/layout.js');
    const file = variables.fileOf(projectRoot, { env });
    const values = variables.read(file).values;
    const stampFile = stamp.stampFiles({ projectRoot }).read;
    const rows = ((stampFile && stamp.readLedger(stampFile)) || { env: {} }).env?.['.variables'] || {};
    const dropped = [];
    const own = [];
    for (const [key, value] of Object.entries(values))
    {
        if (!layout.VARIABLE_KEYS.includes(key)) continue;
        if (!layout.MEMBER_NEVER.has(key) && isSeed(key, value, rows)) dropped.push(key);
        else own.push(key);
    }
    const ledgerEnv = ((stampFile && stamp.readLedger(stampFile)) || { env: {} }).env || {};
    if (['settings.json', 'settings.local.json'].some((f) => Object.keys(ledgerEnv[f] || {}).some((k) => layout.VARIABLE_KEYS.includes(k))))
        stamp.markLine(stampFile, 'join-prune', 'settings');
    if (dropped.length)
    {
        const done = variables.write(file, Object.fromEntries(dropped.map((k) => [k, null])));
        if (done.why) { log(`!! workspace: ${path.relative(projectRoot, file)} could not be written (${done.why}) - its stack seeds stay and beat the workspace's values until the next join`); return { dropped: [], own }; }
        editVariablesLedger(projectRoot, (r) => { for (const k of dropped) delete r[k]; return r; });
    }
    if (dropped.length || own.length)
        log(`workspace: ${own.length} of this project's values kept as its own (${own.join(', ') || 'none'}) - ${dropped.length} stack seed${dropped.length === 1 ? '' : 's'} dropped, so the workspace's value reaches it`);
    return { dropped, own };
}

// Leaving a tree (D5): every value the project reads through the chain is written into its own `.variables` first, so
// nothing changes - a member's seed (its value at the member's ledger hash) keeps a seed's ledger row here. With the
// parent gone there is no chain to read: the keys the project does not hold read the stack's defaults now, named, and
// the next update seeds them as a standalone's.
function keepOnLeave(projectRoot, { env = process.env, log = () => {} } = {})
{
    const variables = require('./variables.js');
    const layout = require('../../stack/hooks/layout.js');
    const root = realOf(projectRoot);
    const view = readWorkspace(root, { env }).view;
    const members = chain(root, { env }).members;
    const file = variables.fileOf(root, { env });
    if (!members.length)
    {
        const held = variables.read(file).values;
        const defaults = layout.VARIABLE_KEYS.filter((k) => !layout.MEMBER_NEVER.has(k) && held[k] === undefined);
        if (view.parent && defaults.length) log(`workspace: ${view.parent} is gone - ${defaults.length} values read the stack's defaults here now (${defaults.join(', ')}); the next update seeds them`);
        return { written: [], defaults };
    }
    const { values, from } = layout.variablesOf(root, { env });
    const byRel = new Map(members.map((m) => [m.rel, m]));
    const updates = {};
    const seeds = {};
    for (const key of layout.VARIABLE_KEYS)
    {
        const member = byRel.get(from[key]);
        if (!member || values[key] === undefined) continue;
        updates[key] = values[key];
        const memberStamp = stamp.stampFiles({ projectRoot: member.root }).read;
        const rows = ((memberStamp && stamp.readLedger(memberStamp)) || { env: {} }).env?.['.variables'] || {};
        if (rows[key] === stamp.valueHash(values[key])) seeds[key] = rows[key];
    }
    const written = Object.keys(updates);
    if (!written.length) return { written, defaults: [] };
    const done = variables.write(file, updates);
    if (done.why) { log(`!! workspace: ${path.relative(root, file)} could not be written (${done.why}) - nothing was left; the values would change`); return { written: [], defaults: [], why: done.why }; }
    if (Object.keys(seeds).length) editVariablesLedger(root, (r) => ({ ...r, ...seeds }));
    log(`workspace: ${written.length} values this project read from the workspace written into ${path.relative(root, file).split(path.sep).join('/')} (${written.join(', ')}) - each reads the same after it leaves`);
    return { written, defaults: [] };
}

// Workspace stage 3: a child leaving its workspace keeps each item it linked from above - copied as it stands into its
// own store and linked there - so its next session lists the same skills. Never on its own uninstall.
function copyIn(child, log = () => {})
{
    const links = require('./links.js');
    const file = path.join(child, '.claude', brand.BRAND.stamp);
    const prior = stamp.readLinks(file);
    for (const e of prior)   // a copy entry too: its file goes into the child's store, or the sync below would drop it
    {
        const own = path.join(child, '.alfred', 'stack', e.path);
        let target;
        try { target = fs.realpathSync(path.join(child, '.claude', e.path)); } catch { continue; }
        if (fs.existsSync(own)) continue;
        fs.mkdirSync(path.dirname(own), { recursive: true });
        fs.cpSync(target, own, { recursive: true });
    }
    const want = prior.map((e) => ({ kind: e.path.split('/')[0], name: e.path.split('/')[1].replace(/\.md$/, '') }));
    stamp.markLine(file, 'links', stamp.linksValue(links.syncLinks({ projectRoot: child, want, prior, log })) || null);
}

// One answer to the role ask: { ok, code, lines }. Every answer rewrites `above`, so the same tree is never asked twice.
function applyRole(projectRoot, answer, { env = process.env, exec = runtime.execCommand, dataRoot } = {})
{
    const root = realOf(projectRoot);
    const lines = [];
    const log = (l) => lines.push(l);
    const fail = (code, line) => ({ ok: false, code, lines: [...lines, line] });
    const nearRel = () => { const p = findParent(root, { env }); return p ? p.rel : 'none'; };
    const write = (mutate) =>
    {
        const r = writeWorkspace(root, mutate, { env, dataRoot, log });
        return r.ok ? null : fail(r.why === 'locked' ? 3 : 1, `!! workspace: this project's workspace file could not be written (${r.why})`);
    };
    const view = readWorkspace(root, { env, dataRoot }).view;
    const role = roleOf(root, { env, log });
    // A garbage record here or in the parent: roleOf named it; an answer would rewrite links it cannot read.
    if (role.kind === 'unknown') return fail(1, '!! workspace: a workspace record this project reads is not valid JSON - nothing was changed; fix it by hand, then answer again');
    const leave = (to) =>
    {
        keepOnLeave(root, { env, log });
        const r = leaveParent({ projectRoot: root, env, dataRoot, log });
        if (r.why) return fail(r.why === 'locked' ? 3 : 1, `!! ${r.line}`);
        copyIn(root, log);   // only once the leave holds: a failed one keeps the child linked to its root
        return write((m) => setAbove(setRole(m, to), nearRel())) || { ok: true, code: 0, lines: [...lines, `role: ${to}`] };
    };
    const joinHere = (rel) =>
    {
        const v = joinVerdict(root, { env, exec });
        if (!v.parent || !v.ok || (rel !== null && v.parent.rel !== rel)) return fail(2, `!! workspace: ${rel || 'the folder above'} is not a folder this project can join${v.parent && !v.ok ? ` (${v.why})` : ''}`);
        if (view.parent && view.parent !== v.parent.rel)
        {
            const r = leaveParent({ projectRoot: root, env, dataRoot, log });
            if (r.why) return fail(r.why === 'locked' ? 3 : 1, `!! ${r.line}`);
        }
        const r = register(root, { env, exec, dataRoot, above: true });
        lines.push(...r.lines);
        if (!r.ok) return { ok: false, code: r.code, lines };
        pruneOnJoin(root, { env, log });
        return { ok: true, code: 0, lines: [...lines, `role: child of ${r.rel}`] };
    };
    if (answer === 'stay') return write((m) => setAbove(m, nearRel())) || { ok: true, code: 0, lines: [...lines, `role: ${roleText(roleOf(root, { env, log }))}`] };
    if (answer === 'leave:standalone' || answer === 'leave:root')
    {
        if (!view.parent) return fail(2, '!! workspace: this project has no parent to leave');
        return leave(answer.slice('leave:'.length));
    }
    if (answer === 'standalone' || answer === 'root')
    {
        if (role.kind === 'child') return leave(answer);
        if (answer === 'standalone' && view.children.length)
            return fail(2, `!! workspace: this project is the root of ${view.children.join(', ')} - each child leaves first (its configure), or /alfred-code:uninstall here releases them`);
        return write((m) => setAbove(setRole(m, answer), nearRel())) || { ok: true, code: 0, lines: [...lines, `role: ${answer}`] };
    }
    if (answer === 'child') return joinHere(null);
    if (answer === 'rejoin')
    {
        if (!view.parent) return fail(2, '!! workspace: this project names no parent to rejoin');
        return joinHere(view.parent);
    }
    if (answer.startsWith('join:')) return joinHere(answer.slice('join:'.length));
    return fail(2, '!! workspace: --answer takes standalone, root, child, join:<rel>, leave:standalone, leave:root, stay or rejoin');
}

// The project's ancestors through its `parent` lines, nearest first. A hop counts only to a real strict ancestor that
// holds a stamp and whose own file lists this folder as `child` (the N1 rule): project text alone can never pull an
// unrelated folder - or its secrets - into the chain. The first refused hop ends it with one `!!` note, returned for
// the caller to log (never through the installer's `note`, which counts a failure).
function chain(projectRoot, { maxDepth = 8, ownDataRoot } = {})
{
    const start = realOf(projectRoot);
    const members = [];
    const notes = [];
    const seen = new Set([realKey(start)]);
    let current = start;
    let read = readWorkspace(start, { dataRoot: ownDataRoot });
    while (members.length < maxDepth && read.view.parent)
    {
        const value = read.view.parent;
        const where = read.file ? relPosix(start, read.file) : 'the workspace file';
        const refuse = (why) => notes.push(`!! workspace: parent ${value} in ${where} ignored - ${why}`);
        const parent = path.resolve(current, ...value.split('/'));
        const label = relPosix(start, parent) || '.';
        if (!isDir(parent)) { refuse(`${label} is missing`); break; }
        const up = path.relative(realKey(parent), realKey(current));
        if (!up || up.startsWith('..') || path.isAbsolute(up)) { refuse(`${label} is not a folder above this one`); break; }
        if (!isStamped(parent)) { refuse(`${label} holds no Alfred install`); break; }
        const parentRead = readWorkspace(parent);
        if (parentRead.state === 'garbage') { refuse(`${relPosix(start, parentRead.file)} is not valid JSON`); break; }
        if (!parentRead.view.children.some((c) => realKey(path.join(parent, ...c.split('/'))) === realKey(current)))
        {
            refuse(`${label} does not list this folder as a child`);
            break;
        }
        const key = realKey(parent);
        if (seen.has(key)) { refuse(`${label} is already in the chain`); break; }
        seen.add(key);
        const dataRoot = dataRootMod.dataRootOf({ projectDir: parent }).root;
        members.push({ root: realOf(parent), rel: label, dataRoot, view: parentRead.view });
        current = parent;
        read = parentRead;
    }
    return { members, notes };
}

// The project and every descendant its `child` lines reach, pre-order. A child folder that is missing or holds no
// stamp is `gone`, and nothing below it is read.
function subtree(projectRoot, { env = process.env, maxDepth = 8, log = printLine } = {})
{
    const top = realOf(projectRoot);
    const rows = [{ root: top, rel: '.', depth: 0, parentRel: null, state: 'ok' }];
    const seen = new Set([realKey(top)]);
    // A garbage record is named, and nothing below it is read.
    const viewAt = (dir) => { const r = readWorkspace(dir); if (r.state !== 'garbage') return r.view; sayGarbage(r.file, top, log); return null; };
    const walk = (dir, rel, depth, view) =>
    {
        if (depth >= maxDepth || !view) return;
        for (const c of view.children)
        {
            const child = path.join(dir, ...c.split('/'));
            const key = realKey(child);
            if (seen.has(key)) continue;
            seen.add(key);
            const childRel = rel === '.' ? c : `${rel}/${c}`;
            const ok = isDir(child) && isStamped(child);
            rows.push({ root: ok ? realOf(child) : child, rel: childRel, depth: depth + 1, parentRel: rel, state: ok ? 'ok' : 'gone' });
            if (ok) walk(child, childRel, depth + 1, viewAt(child));
        }
    };
    walk(top, '.', 0, viewAt(top));
    return rows;
}

const RESCAN_SKIP = new Set(['.git', 'node_modules', '.claude']);

// Stamped folders under the project with no `parent` in their record, nor a 2.11 `parent none` line still in the old
// file - projects installed before their root, offered as children. A stamped folder ends the walk down that branch:
// what is below it is that project's.
function rescan(projectRoot, { maxDepth = 5, env = process.env, log = printLine } = {})
{
    const top = realOf(projectRoot);
    const dataRoot = dataRootMod.dataRootOf({ projectDir: top }).root.split('/')[0];
    const found = [];
    const walk = (dir, depth) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const d of entries)
        {
            if (!d.isDirectory() || d.isSymbolicLink() || RESCAN_SKIP.has(d.name) || (dir === top && d.name === dataRoot)) continue;
            const child = path.join(dir, d.name);
            if (isStamped(child))
            {
                const read = readWorkspace(child);
                // a garbage record is no project to offer: named, and left to be fixed by hand
                if (read.state === 'garbage') sayGarbage(read.file, top, log);
                else if (!read.view.parent && !read.view.parentNone) found.push(relPosix(top, child));
                continue;
            }
            if (depth + 1 < maxDepth) walk(child, depth + 1);
        }
    };
    walk(top, 0);
    return found.sort();
}

// ------------------------------------------------------------------ the merged lists

// A child's set is its parent's minus what it ignores plus its own picks, as `<category> <name>` lines - the
// spelling `--add` / `--drop` take, so a delta feeds the installer's own add and drop flow unchanged.
const PLAN_KEYS = { skills: 'skill', agents: 'agent', rules: 'rule', hooks: 'hook', mcps: 'mcp' };
const uniqSorted = (xs) => [...new Set(xs)].sort();

function planLines(plan)
{
    const lines = [];
    for (const [key, line] of Object.entries(PLAN_KEYS))
        for (const name of (plan && Array.isArray(plan[key]) ? plan[key] : [])) lines.push(`${line} ${name}`);
    for (const p of (plan && Array.isArray(plan.plugins) ? plan.plugins : [])) if (p && p.name) lines.push(`plugin ${p.name}`);
    return uniqSorted(lines);
}

function effectiveLists({ parentLines, ignores = [], own = [] })
{
    const ignored = new Set(ignores.map((i) => `${i.category} ${i.name}`));
    return uniqSorted([...parentLines.filter((l) => !ignored.has(l)), ...own]);
}

function delta({ effective, installed })
{
    const want = new Set(effective);
    const have = new Set(installed);
    return { add: uniqSorted(effective.filter((l) => !have.has(l))), drop: uniqSorted(installed.filter((l) => !want.has(l))) };
}

// The picks that are this child's own after a run - the stamp's `own-picks:` line, which tells an inherited item from
// one the child chose. `null` means no line. A blind read-back (the plugin listing could not be read) sees only part
// of the set, so the prior line is carried as it was.
function ownPicksAfter({ prior, final, parentLines, added = [], blind = false })
{
    if (blind) return prior;
    const kept = new Set(final);
    const parent = new Set(parentLines || []);
    if (prior === null || prior === undefined) return uniqSorted(parentLines ? final.filter((l) => !parent.has(l)) : final);
    const grown = parentLines ? final.filter((l) => !parent.has(l)) : added;
    return uniqSorted([...prior, ...grown].filter((l) => kept.has(l)));
}

// ------------------------------------------------------------------ the env

const csv = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Step 5 of the loader (layout.js resolveVariables) alone: what the workspace chain hands this project, nearest member
// first, `ignore env K` lines stopping K from that member on; never a layout MEMBER_NEVER key.
function chainValues(projectRoot, { env = process.env } = {})
{
    const layout = require('../../stack/hooks/layout.js');
    const out = {};
    if (!layout.workspaceOn({ env, projectRoot })) return out;
    // The installer's own chain: a member whose data an update has not moved yet is read where it sits.
    const { members } = chain(projectRoot);
    const skip = new Set((readWorkspace(realOf(projectRoot)).view.ignores || []).filter((i) => i.category === 'env').map((i) => i.name));
    for (const member of members)
    {
        const read = layout.readDotenv(path.join(member.root, ...member.dataRoot.split('/'), '.variables'));
        for (const [key, value] of Object.entries((read && read.values) || {}))
            if (layout.VARIABLE_KEYS.includes(key) && !layout.MEMBER_NEVER.has(key) && !skip.has(key) && !Object.hasOwn(out, key)) out[key] = value;
        for (const i of member.view.ignores || []) if (i.category === 'env') skip.add(i.name);
    }
    return out;
}

// What the settings pass seeds and drops for a joined child (workspace roles and variables, D5), or null for any other
// run. A child seeds only what it owns - the catalog default for each `ignore env K` it holds - and the chain hands it
// the rest. A 2.12 child the switch joined by hand copied its parent's values (its stamp's `own-env:` line names the keys
// it set itself): each copy still at its ledger hash, and given the same value by the chain now, goes (`copies`); a copy
// the chain would answer otherwise - a parent not updated yet - stays as the child's own, so no value changes. Its
// HOOKS_OFF loses the part entries a member's settings hold (`hooksOffDrop`), which the loader merges back at load.
// A project the role answer joined while its 2.12 values still sat in settings (pruneOnJoin's `join-prune: settings`
// stamp line - the update walk answers BEFORE the installer): each stack seed (isSeed) goes from settings as the prune
// drops it from `.variables` (`seeds`) - never DOCS_VERSIONING or an `ignore env` key - and the workspace's value
// reaches it. The stamp the run writes carries no such line, so it prunes once.
// A project whose own file names a parent it cannot reach - the switch at 0 (frozen) or a link that does not hold - gets
// the same plan with nothing to drop: a default seeded now would shadow the chain once it reads again.
function envPlan(ctx)
{
    const w = ctx.workspace;
    if (!w || ctx.args.action === 'uninstall') return null;
    const linked = Boolean(w.on && w.members.length);
    const dataRoot = w.fileRoot ?? (ctx.dataInfo ? ctx.dataInfo.root : undefined);
    let view = { ignores: w.ignores };
    if (!linked)
    {
        const read = readWorkspace(ctx.projectRoot, { env: ctx.env, dataRoot });
        // A garbage record: the plan of a project whose parent cannot be reached - no chained key seeded, so no default lands
        // in `.variables` to shadow the chain once the record is fixed by hand.
        if (read.state === 'garbage') return { linked: false, ignored: [], copies: [], seeds: [], hooksOffDrop: [], memberEnv: {} };
        view = read.view;
    }
    if (!linked && !(view && view.parent)) return null;
    const plan = { linked, ignored: (view.ignores || []).filter((i) => i.category === 'env').map((i) => i.name), copies: [], seeds: [], hooksOffDrop: [], memberEnv: {} };
    if (!linked) return plan;
    // D4 step 5 for the settings pass's own readers (the compaction windows, the memory switch): what the members hand it.
    plan.memberEnv = chainValues(ctx.projectRoot, { env: ctx.env });
    const read = stamp.stampFiles({ projectRoot: ctx.projectRoot }).read;
    const own = read ? stamp.readOwnEnv(read) : null;
    const layout = require('../../stack/hooks/layout.js');
    const target = ctx.args.scope === 'local' ? 'settings.local.json' : 'settings.json';
    const data = readJson(path.join(ctx.claudeDir, target));
    const env = data && data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {};
    const rows = ((ctx.ledger && ctx.ledger.env) || {})[target] || {};
    if (own === null)
    {
        if (read && stamp.readJoinPrune(read))
            for (const [key, value] of Object.entries(env))
                if (layout.VARIABLE_KEYS.includes(key) && !layout.MEMBER_NEVER.has(key) && !plan.ignored.includes(key) && isSeed(key, value, rows)) plan.seeds.push(key);
        return plan;
    }
    const chained = plan.memberEnv;
    for (const [key, value] of Object.entries(env))
    {
        if (!layout.VARIABLE_KEYS.includes(key) || own.includes(key) || layout.MEMBER_NEVER.has(key)) continue;
        if (rows[key] === stamp.valueHash(value) && chained[key] === String(value)) plan.copies.push(key);
    }
    const memberParts = new Set(w.members.flatMap((m) => csv(settingsEnv(m.root).ALFRED_CODE_HOOKS_OFF)).filter((e) => e.includes(':')));
    plan.hooksOffDrop = csv(env.ALFRED_CODE_HOOKS_OFF).filter((e) => e.includes(':') && memberParts.has(e));
    return plan;
}

// ------------------------------------------------------------------ the excludes (spec 2.5)

// Every stamped folder above the project, nearest first, joined or not: Claude Code loads an ancestor's rules and
// AGENTS.md into any project below it, so each one's Alfred files are excluded wherever a project sits under it.
function stampedAncestors(projectRoot, { env = process.env, maxDepth = 8 } = {})
{
    const out = [];
    let at = projectRoot;
    while (out.length < maxDepth)
    {
        const found = findParent(at, { env });
        if (!found) break;
        out.push(found.root);
        at = found.root;
    }
    return out;
}

// An ancestor's Alfred-managed files a child must not load a second time (absolute paths): its library rule copies,
// the generated rules, and its seeded AGENTS.md while it still hashes to the seed - an edited one is the user's
// instructions and stays. `ignore instructions <file>` adds one more of the ancestor's files.
function ancestorExcludes(ancestorRoot, { childIgnores = [], nearer = [] } = {})
{
    const { GENERATED_FILES } = require('./selection.js');
    const seeds = require('./seeds.js');
    const { hashItem } = require('./library.js');
    const claudeDir = path.join(ancestorRoot, '.claude');
    const stampFile = path.join(claudeDir, brand.BRAND.stamp);
    const rulesDir = path.join(claudeDir, 'rules');
    const out = [];
    const library = stamp.readLibrary(stampFile);
    // A library rule only while it loads natively here and the child ignores it or a nearer member holds that name (4c).
    const dropped = (f) => childIgnores.some((i) => i.category === 'rule' && `${i.name}.md` === f)
        || nearer.some((r) => ['.claude', '.alfred/stack'].some((d) => fs.existsSync(path.join(r, d, 'rules', f))));
    for (const f of Object.keys((library && library.rules) || {}).map((n) => `${n}.md`))
        if (fs.existsSync(path.join(rulesDir, f)) && dropped(f)) out.push(path.join(rulesDir, f));
    for (const name of GENERATED_FILES)
    {
        const file = path.join(rulesDir, `${name}.md`);
        if (fs.existsSync(file)) out.push(file);
    }
    const ledger = stamp.readLedger(stampFile);
    const held = (ledger && ledger.files && ledger.files['AGENTS.md']) || '';
    if (held)
    {
        const seed = seeds.locateSeed(ancestorRoot, stamp.readInstructionsFile(stampFile), held);
        try { if (seed && hashItem(seed) === held) out.push(seed); }
        catch { /* unreadable: no seed to exclude */ }
    }
    for (const i of childIgnores)
    {
        if (i.category !== 'instructions') continue;
        const file = path.join(ancestorRoot, ...i.name.split('/'));
        if (fs.existsSync(file)) out.push(file);
    }
    return [...new Set(out)];
}
const chainExcludes = (ancestors, self, childIgnores) =>
    ancestors.flatMap((root, i) => ancestorExcludes(root, { childIgnores, nearer: [self, ...ancestors.slice(0, i)] }));

const GLOB_META = new Set(['*', '?', '[', '{', '}', '(', ')']);

// One `claudeMdExcludes` glob per path, in the form probed on macOS 2.1.310 and Windows 2.1.309
// (docs/workspace-layering-evidence.md): a metacharacter as a one-character class (`[(]`), never a `\` escape, which
// missed on brackets; and where the filesystem folds case, every cased letter as a class of both cases (`[aA]`, `[üÜ]`
// too), since Windows matched the typed spelling case-sensitively. `]`, the space and `.` need nothing.
function excludeGlobs(paths, platform = process.platform)
{
    const folds = platform === 'win32' || platform === 'darwin';
    const out = [];
    for (const p of paths)
    {
        let spelled = fs.existsSync(p) ? realOf(p) : p;
        spelled = platform === 'win32' ? spelled.replace(/\\/g, '/') : spelled.split(path.sep).join('/');
        let glob = '';
        for (const c of spelled)
        {
            if (GLOB_META.has(c)) { glob += `[${c}]`; continue; }
            const lo = c.toLowerCase();
            const up = c.toUpperCase();
            glob += folds && lo !== up && [...lo].length === 1 && [...up].length === 1 ? `[${lo}${up}]` : c;
        }
        out.push(glob);
    }
    return [...new Set(out)];
}

// Workspace stage 3: the `skill` and `agent` lines each joined member below `root` picked itself (its stamp's `own-picks`),
// walked `maxDepth` folders deep - an `agent` line only from a member on the root's seats route (ruling 7). A member whose
// stamp holds no such line adds nothing and is named; a stamped folder whose chain does not end at `root` is passed over.
function memberPicks(root, { seatsRoute = 'plugin', maxDepth = 8 } = {})
{
    const top = realOf(root);
    const lines = new Set();
    const notes = [];
    const visit = (dir) =>
    {
        const members = chain(dir).members;
        if (!members.length || realOf(members[members.length - 1].root) !== top) return;
        const file = path.join(dir, '.claude', brand.BRAND.stamp);
        const picks = stamp.readOwnPicks(file);
        if (!picks) { notes.push(`member ${relPosix(top, dir)} not counted: its stamp holds no own-picks line`); return; }
        for (const l of picks) if (/^(skill|rule) /.test(l) || (l.startsWith('agent ') && stamp.readSeatsRoute(file) === seatsRoute)) lines.add(l);
    };
    const walk = (dir, depth) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* unreadable: nothing below */ }
        for (const d of entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !RESCAN_SKIP.has(e.name)))
        {
            if (isStamped(path.join(dir, d.name))) visit(path.join(dir, d.name));
            if (depth + 1 < maxDepth) walk(path.join(dir, d.name), depth + 1);
        }
    };
    walk(top, 0);
    return { lines: [...lines].sort(), notes };
}

// Workspace stage 3: a joined child's own pick, put into its top's store under the top's lock (`copy(dir)` writes it) and
// recorded on the top's stamp - its library hash (the copy route: its managed-files row) and, unless the top picked it
// itself, its member-picks entry. 'added' | 'present' | 'locked' | 'not-held' (the top's kind is not linkable).
function addToStore({ root, kind, name, copy, route = 'plugin', from = root, log = () => {} })
{
    const links = require('./links.js');
    const home = kind === 'rules' ? { store: true, dir: links.storeOf(root, 'rules') } : links.homeOf(root, kind);   // a rule is never linked (4c)
    if (!home.store) return 'not-held';
    const [rel, item, at] = [relPosix(from, root) || '.', path.join(home.dir, links.fileOf(kind, name)), locate(root)];
    let held = false;
    try { fs.mkdirSync(at.dir, { recursive: true }); held = takeLock(at.lock, { now: Date.now, sleep: sleepMs, retryMs: 500, staleMs: 30000 }); }
    catch { held = false; }
    if (!held) { log(`  !! store: ${rel} is locked - ${kind}/${name} is added at the next run`); return 'locked'; }
    try
    {
        const present = fs.existsSync(item);
        if (!present) { fs.mkdirSync(home.dir, { recursive: true }); copy(home.dir); log(`store: ${kind}/${name} added to ${rel}/.alfred/stack`); }
        const file = path.join(root, '.claude', brand.BRAND.stamp);
        const hash = require('./library.js').hashItem(item);
        const pairs = (map) => Object.entries(map).map(([n, h]) => `${n}=${h}`).join(',');
        if (route === 'plugin' || kind === 'rules') stamp.markLine(file, `library-${kind}`, pairs({ ...stamp.readLibrary(file)?.[kind], [name]: hash }));
        else stamp.markLine(file, 'managed-files', pairs({ ...((stamp.readLedger(file) || {}).files || {}), [`${kind}/${links.fileOf(kind, name)}`]: hash }));
        const line = `${kind.slice(0, -1)} ${name}`;
        const own = ((stamp.readPicked(file) || {})[kind] || []).some((e) => e.split('@')[0] === name);
        if (!own) stamp.markLine(file, 'member-picks', [...new Set([...(stamp.readMemberPicks(file) || []), line])].map((l) => l.replace(' ', '/')).sort().join(','));
        return present ? 'present' : 'added';
    }
    finally { try { fs.unlinkSync(at.lock); } catch { /* already gone */ } }
}

// ------------------------------------------------------------------ refresh below (2026-11-10)

// The user's report: a child session loaded the root's rules twice. A project's own run writes `claudeMdExcludes` for
// every stamped folder above it (workspaceStep), so the duplicates came from a child installed before its root, or a rule
// the root added later - until that child's own next run. This brings that write forward from the root's install or
// update: every stamped project below (depth `maxDepth`, RESCAN_SKIP, no link followed, a stamped folder walked into)
// whose own switch is on gets the excludes its own run would write, synced against ITS OWN ledger, under its workspace
// lock. Only that array moves, a member its ledger does not hold is the user's and stays, and every other ledger row is
// re-rendered byte for byte. A failed stamp write puts the settings file back (or removes it, when this made it), so no
// row is ever on disk without its ledger row. Returns { refreshed, current, skipped } as relative posix paths.
// Workspace stage 3: a moved member below `top` re-links what it links plus the top's own items of each linked kind, less
// what it or a member between ignores, under its own lock. A child with no `links:` line is not moved yet: its update does it.
function relink(child, top, rel, ignores, log)
{
    const links = require('./links.js');
    const file = path.join(child, '.claude', brand.BRAND.stamp);
    const prior = stamp.readLinks(file);
    const { members } = chain(child);
    if (!/^links:/m.test(readOr(file)) || !members.length || realOf(members[members.length - 1].root) !== top) return;
    const topFile = path.join(top, '.claude', brand.BRAND.stamp);
    const held = new Set(stamp.readMemberPicks(topFile) || []);
    const off = new Set([...ignores, ...members.slice(0, -1).flatMap((m) => m.view.ignores || [])].map((i) => `${i.category} ${i.name}`));
    const lib = stamp.readLibrary(topFile) || {};
    const rows = Object.keys((stamp.readLedger(topFile) || {}).files || {}).map((r) => r.split('/'));
    const want = [...prior.map((e) => ({ kind: e.path.split('/')[0], name: e.path.split('/')[1].replace(/\.md$/, '') }))];
    for (const kind of links.KINDS.filter((k) => links.homeOf(child, k).store))
        for (const name of [...Object.keys(lib[kind] || {}), ...rows.filter((r) => r[0] === kind).map((r) => r[1].replace(/\.md$/, ''))])
            if (!held.has(`${kind.slice(0, -1)} ${name}`) && !off.has(`${kind.slice(0, -1)} ${name}`)) want.push({ kind, name });
    const at = locate(child);
    let got = false;
    try { got = takeLock(at.lock, { now: Date.now, sleep: sleepMs, retryMs: 500, staleMs: 30000 }); }
    catch { got = false; }
    if (!got) { log(`  !! workspace: ${rel} is locked - its links refresh on its next run`); return; }
    const once = [...new Map(want.map((w) => [`${w.kind}/${w.name}`, w])).values()];
    try { stamp.markLine(file, 'links', stamp.linksValue(links.syncLinks({ projectRoot: child, members, want: once, prior, log: (l) => log(`  ${rel}: ${l.trim()}`) })) || null); }
    finally { try { fs.unlinkSync(at.lock); } catch { /* already gone */ } }
}

function refreshBelow({ projectRoot, env = process.env, log = () => {}, warnUnignored = () => {}, maxDepth = 5, retryMs = 500, release = '', compare } = {})
{
    const { syncMembers, MEMBER_PATH } = require('./settings.js');
    const top = realOf(projectRoot);
    const ownData = dataRootMod.dataRootOf({ projectDir: top }).root.split('/')[0];
    const below = [];
    const walk = (dir, depth) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const d of entries)
        {
            if (!d.isDirectory() || d.isSymbolicLink() || RESCAN_SKIP.has(d.name) || (dir === top && d.name === ownData)) continue;
            const child = path.join(dir, d.name);
            if (isStamped(child)) below.push(child);
            if (depth + 1 < maxDepth) walk(child, depth + 1);
        }
    };
    walk(top, 0);
    // An update (`release`) writes this project's ignore keys plural once - held while a project below runs a release that reads none.
    const own = release ? readWorkspace(top) : null;
    const due = Boolean(own && own.singular && own.view.ignores.some((i) => workspaceFile.PLURAL[i.category]));
    const older = due && below.sort().map((dir) => [dir, stamp.readVersion(path.join(dir, '.claude', brand.BRAND.stamp))]).find(([, v]) => v && compare(v, compare(PLURAL_SINCE, release) > 0 ? release : PLURAL_SINCE) < 0);
    if (older) log(`  workspace.json keeps its singular keys: ${relPosix(top, older[0])} is at ${older[1]}`);
    else if (due) writeWorkspace(top, (record) => record, { runRoot: top, plural: true, log });
    const out = { refreshed: [], current: [], skipped: [] };
    // A child's switch and its ancestors are read with the account alone: this run's launch values are not the child's.
    // A launch `0` still freezes the child's switch, as it would its own run.
    const childEnv = { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, ...(env.ALFRED_CODE_WORKSPACE !== undefined ? { ALFRED_CODE_WORKSPACE: env.ALFRED_CODE_WORKSPACE } : {}) };
    const isExclude = (row) => { const m = MEMBER_PATH.exec(row); return Boolean(m) && m[1] === 'claudeMdExcludes'; };
    for (const child of below.sort())
    {
        const rel = relPosix(top, child);
        const skip = (why) => { out.skipped.push(rel); if (why) log(`  !! workspace: ${rel} ${why}`); };
        let on = false;
        try { on = workspaceOn({ env: childEnv, projectRoot: child }); }
        catch { on = false; }
        if (!on) { skip(''); continue; }
        const ownRead = readWorkspace(child);
        if (ownRead.state === 'garbage') { out.skipped.push(rel); sayGarbage(ownRead.file, top, (l) => log(`  ${l}`)); continue; }
        relink(child, top, rel, ownRead.view.ignores || [], log);
        const claudeDir = path.join(child, '.claude');
        const file = path.join(claudeDir, 'settings.local.json');
        const stampFile = path.join(claudeDir, brand.BRAND.stamp);
        const ledger = stamp.readLedger(stampFile);
        if (!ledger) { skip('- its stamp holds no ledger to record the rows in; its excludes refresh on its next run'); continue; }
        const settingsMap = ledger.settings || {};
        const prior = settingsMap['settings.local.json'] || {};
        let want;
        try
        {
            const ignores = ownRead.view.ignores || [];
            const ancestors = stampedAncestors(child, { env: childEnv });
            want = uniqSorted(excludeGlobs(chainExcludes(ancestors, child, ignores), process.platform));
        }
        catch (e) { skip(`- its excludes could not be worked out (${e.message}); left as it is`); continue; }
        if (!want.length && !Object.keys(prior).some(isExclude)) { out.current.push(rel); log(`workspace: ${rel} - excludes current`); continue; }
        const at = locate(child);
        if (!at.file) { skip(`- its data root is refused (${at.why}); left as it is`); continue; }
        let held = false;
        try
        {
            fs.mkdirSync(at.dir, { recursive: true });
            held = takeLock(at.lock, { now: Date.now, sleep: sleepMs, retryMs, staleMs: 30000 });
        }
        catch { held = false; }
        if (!held) { skip('is locked - its excludes refresh on its next run'); continue; }
        try
        {
            let before = null;
            try { before = fs.readFileSync(file); }
            catch (e) { if (!e || e.code !== 'ENOENT') { skip(`- its settings.local.json cannot be read (${e && e.code}); left as it is`); continue; } }
            const notes = [];
            const r = syncMembers({ file, arrayPath: 'claudeMdExcludes', want, prior, log: () => {}, note: (m) => notes.push(m) });
            if (r.refused) { skip(`- ${notes[0] || 'its settings.local.json cannot be read'}`); continue; }
            const mine = Object.fromEntries(Object.entries(prior).filter(([row]) => isExclude(row)));
            const same = Object.keys(mine).length === Object.keys(r.rows).length && Object.entries(r.rows).every(([row, h]) => mine[row] === h);
            if (!r.changed && same) { out.current.push(rel); log(`workspace: ${rel} - excludes current`); continue; }
            const local = { ...Object.fromEntries(Object.entries(prior).filter(([row]) => !isExclude(row))), ...r.rows };
            const next = { ...settingsMap, 'settings.local.json': local };
            if (!Object.keys(local).length) delete next['settings.local.json'];
            try { stamp.markLine(stampFile, 'managed-settings', stamp.settingsLine(next)); }
            catch (e)
            {
                try { if (before === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, before); }
                catch { /* named below either way */ }
                skip(`- its stamp could not be written (${e && e.code}); its settings.local.json is as it was`);
                continue;
            }
            if (r.created) warnUnignored(child, file);
            out.refreshed.push(rel);
            log(`workspace: ${rel} - excludes refreshed (${Object.keys(r.rows).length} rules)`);
        }
        finally { try { fs.unlinkSync(at.lock); } catch { /* already gone */ } }
    }
    return out;
}

// ------------------------------------------------------------------ the installer's steps (spec 2.1-2.5)

// Why a parent's plan cannot be inherited from - its run reported failures, could not read a file, or could not read its
// plugin listing - or null when it can. stack-select's --inherited reads the same three (R066).
function planDoubt(plan)
{
    if (Number(plan.failures) > 0) return `the plan's run reported ${plan.failures} failure(s)`;
    if (Array.isArray(plan.unreadable) && plan.unreadable.length) return `the plan's run could not read ${plan.unreadable.join(' and ')}`;
    if (plan.blind) return 'the plan is blind - its plugin listing could not be read';
    return null;
}

// The parent's plan-out as JSON, or { why } - absent, unparseable, or one whose run could not see the parent's set.
function readPlan(file)
{
    let plan;
    try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { why: e.code === 'ENOENT' ? 'no plan was written' : 'the plan does not parse' }; }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { why: 'the plan does not parse' };
    const doubt = planDoubt(plan);
    return doubt ? { why: doubt } : { plan };
}

// The env a project's settings apply: settings.local.json over settings.json.
function settingsEnv(root)
{
    const envIn = (name) => { const data = readJson(path.join(root, '.claude', name)); return data && data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {}; };
    return { ...envIn('settings.json'), ...envIn('settings.local.json') };
}

// What a run needs from the workspace before it reads its own set: whether the workspace is on, the chain, this
// project's ignores and own lines, and the parent's lines - read from `--parent-plan`, or from the parent's own
// `update --installed-only --print-plan` (never inside a plan run, which reads nothing it would not print).
// `parentLines` stays null whenever the parent's set cannot be trusted, so nothing inherited is added or dropped.
function prepare({ projectRoot, env = process.env, args, sourceDir, rt = runtime, log = () => {}, note = () => {}, tmpDir = os.tmpdir(), dataRoot: ownDataRoot })
{
    const read = stamp.stampFiles({ projectRoot }).read;
    const base = { on: true, parent: null, members: [], ignores: [], parentLines: null, ownPrior: read ? stamp.readOwnPicks(read) : null };
    if (args.action === 'uninstall' || !workspaceOn({ env, projectRoot })) return { ...base, on: false };
    const own = readWorkspace(projectRoot, { env, dataRoot: ownDataRoot });
    // The run's own record is garbage: the workspace part is frozen, as at the switch's 0 - no members, nothing inherited
    // added or dropped, the own lines carried.
    if (own.state === 'garbage') { sayGarbage(own.file, realOf(projectRoot), (l) => log(`  ${l}`)); return { ...base, on: false, garbage: true }; }
    const where = own.file ? relPosix(realOf(projectRoot), own.file) : 'the workspace file';
    for (const problem of own.problems) log(`  !! workspace: ${where}: ${problem}`);
    const { members, notes } = chain(projectRoot, { env, ownDataRoot });
    for (const n of notes) log(`  ${n}`);
    const at = { ...base, members, ignores: own.view.ignores, fileRoot: ownDataRoot };
    if (!members.length)
    {
        if (args.parentPlan) log('  !! workspace: --parent-plan ignored - this project is not a joined child');
        return at;
    }
    const parent = members[0];
    at.parent = parent;
    const failed = (why) => { note(`workspace: the read-back of ${parent.rel} failed (${why}) - nothing inherited is added or dropped this run`); return at; };
    let got;
    if (args.parentPlan)
    {
        got = readPlan(args.parentPlan);
        if (got.plan && got.plan.root !== realKey(parent.root)) return failed(`the plan is from ${got.plan.root}`);
    }
    else if (args.printPlan) return at;
    else
    {
        const dir = fs.mkdtempSync(path.join(tmpDir, 'alfred-code-parent-'));
        const out = path.join(dir, 'plan.json');
        try
        {
            const r = rt.spawnCommand(process.execPath, [path.join(sourceDir, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', sourceDir,
                '--scope', stamp.installScope(parent.root), '--installed-only', '--print-plan', '--plan-out', out],
            { cwd: parent.root, env, timeout: 120000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            if (r.error) return failed(r.error.message);
            if (r.status !== 0) return failed(`the parent's run exited ${r.status}`);
            got = readPlan(out);
        }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    if (!got.plan) return failed(got.why);
    at.parentLines = planLines(got.plan);
    return at;
}

// A child's own word on what it inherits, kept in its workspace file so the next run's delta keeps it: a --drop of a
// line the parent holds becomes an `ignore` line, an --add of an ignored line lifts it (configure writes them first;
// validate and a hand-run update never did). Returns the ignores this run reads.
function recordWord({ projectRoot, env = process.env, dataRoot, parentLines, ignores = [], drops = [], adds = [], log = () => {} })
{
    const lineOf = (i) => `${i.category} ${i.name}`;
    const has = new Set(ignores.map(lineOf));
    const split = (l) => { const [category, name] = String(l).split(' '); return { category, name }; };
    const known = (l) => { const { category, name } = split(l); return ['skill', 'agent', 'rule', 'hook', 'plugin'].includes(category) && isIgnoreName(category, name); };
    const ignore = uniqSorted(drops.filter((l) => known(l) && parentLines.includes(l) && !has.has(l)));
    const lift = uniqSorted(adds.filter((l) => has.has(l)));
    if (!ignore.length && !lift.length) return ignores;
    const r = writeWorkspace(projectRoot, (m) =>
    {
        for (const l of ignore) addIgnore(m, split(l).category, split(l).name);
        for (const l of lift) removeIgnore(m, split(l).category, split(l).name);
        return m;
    }, { env, dataRoot, log: (l) => log(`  ${l}`) });
    if (!r.ok)
    {
        log(`  !! workspace: the ignore lines could not be written (${r.why}) - the next update takes ${[...ignore, ...lift].join(', ')} from the parent as before`);
        return ignores;
    }
    for (const l of ignore) log(`  workspace: ignore ${l} written - the parent's ${l} stays out of this project`);
    for (const l of lift) log(`  workspace: ignore ${l} removed - this project takes it from its parent again`);
    return [...ignores.filter((i) => !lift.includes(lineOf(i))), ...ignore.map(split)];
}

// The run's set as `<category> <name>` lines, from the lists it installs.
function listLines(lists)
{
    const { CATEGORY } = require('./selection.js');
    return uniqSorted(Object.entries(CATEGORY).flatMap(([key, c]) => (lists[key] || []).map((e) => `${c.line} ${c.name(e)}`)));
}

// After the settings pass: the excludes for every stamped folder above (joined or not), then the own lines. It never
// writes a `child` line into a parent - the back-reference is the consent record. Frozen, it touches nothing: the
// member rows still present are carried by the ledger, and so are the own lines. Returns { created } - true when the
// excludes made settings.local.json, which the caller names when git does not ignore it.
function workspaceStep(ctx)
{
    const w = ctx.workspace || { on: false, members: [], ownPrior: null };
    ctx.ownPicks = w.ownPrior;
    if (!w.on) { mcpHint(ctx); return { created: false }; }
    const ancestors = stampedAncestors(ctx.projectRoot, { env: ctx.env });
    const want = excludeGlobs(chainExcludes(ancestors, ctx.projectRoot, w.ignores), process.platform);
    const prior = ((ctx.ledger && ctx.ledger.settings) || {})['settings.local.json'] || {};
    const { syncMembers, MEMBER_PATH } = require('./settings.js');
    // A standalone project - nothing stamped above, nothing recorded - leaves settings.local.json alone.
    const recorded = (arrayPath) => Object.keys(prior).some((row) => { const m = MEMBER_PATH.exec(row); return m && m[1] === arrayPath; });
    const sync = (arrayPath, list) => (list.length || recorded(arrayPath)
        ? syncMembers({ file: path.join(ctx.claudeDir, 'settings.local.json'), arrayPath, want: uniqSorted(list), prior, log: ctx.log, note: ctx.note })
        : { rows: {}, created: false });
    const r = sync('claudeMdExcludes', want);
    // `ignore mcp <name>` for a server in an ancestor's .mcp.json, which reaches this project natively (probe P2): the
    // entry that hides it here. Every stamped folder above counts, linked or not, as for the excludes.
    const d = sync('disabledMcpjsonServers', mcpJsonIgnores(ancestors, w.ignores));
    const access = ancestorAccess(ctx, w);
    const a = sync('permissions.additionalDirectories', access.dirs);
    const n = sync('permissions.deny', access.deny);
    ctx.workspaceRows = { ...r.rows, ...d.rows, ...a.rows, ...n.rows };
    mcpHint(ctx);
    if (w.members.length)
    {
        const final = listLines(ctx.lists);
        ctx.ownPicks = w.parentLines || w.ownPrior !== null
            ? ownPicksAfter({ prior: w.ownPrior, final, parentLines: w.parentLines, added: ctx.userAdds || [], blind: Boolean(ctx.workspaceBlind) })
            : null;
    }
    return { created: Boolean(r.created || d.created || a.created || n.created) };
}

// The rule that stops Claude's own edit tools under `p` - permissions docs, 'Read and Edit': `//` is the filesystem root,
// and Windows paths match in POSIX form, `C:\x` as `/c/x`.
function editDenyRule(p, platform = process.platform)
{
    let posix = String(p).replace(/[\\/]+$/, '');
    if (platform === 'win32') posix = posix.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
    return `Edit(/${posix}/**)`;
}

// Release 3 (R1, R2, R8): what a child reads of its linked members and what it may never write. Each member's docs root
// is an additional directory with an Edit deny beside it, unless `ignore docs root` here or in a nearer member drops it
// (R0); every member's memory folder is denied, but one this project shares (its own memory). A deny beats every allow,
// so no folder holding this project, its docs root or its own memory is listed: the write guard alone keeps the rest
// of such a folder (its memory branch).
function ancestorAccess(ctx, w)
{
    const layout = require('../../stack/hooks/layout.js');
    const docsRootIgnored = (ignores) => (ignores || []).some((i) => i.category === 'docs' && i.name === 'root');
    const ownMemory = layout.memoryDirsOf(ctx.projectRoot, { env: ctx.env });
    const own = new Set(ownMemory.map(realKey));
    const mine = [ctx.projectRoot, layout.docsRootOf(ctx.projectRoot, { env: ctx.env }), ...ownMemory].map(realKey);
    const holdsMine = (dir) => { const key = realKey(dir); return mine.some((k) => k === key || k.startsWith(key.endsWith('/') ? key : `${key}/`)); };
    const dirs = [];
    const memory = [];
    let dropped = docsRootIgnored(w.ignores);
    for (const m of w.members || [])
    {
        const docs = layout.docsRootOf(m.root, { env: ctx.env, dataRoot: m.dataRoot });
        if (!dropped && !holdsMine(docs)) dirs.push(docs);
        for (const dir of layout.memoryDirsOf(m.root, { env: ctx.env })) if (!own.has(realKey(dir)) && !holdsMine(dir)) memory.push(dir);
        if (docsRootIgnored(m.view && m.view.ignores)) dropped = true;
    }
    return { dirs, deny: [...dirs, ...memory].map((p) => editDenyRule(p)) };
}

// ------------------------------------------------------------------ D8, a linked member's local MCP registrations

const ignoredMcp = (ignores) => (ignores || []).filter((i) => i.category === 'mcp').map((i) => i.name);
// The `ignore mcp` names some ancestor's .mcp.json registers.
function mcpJsonIgnores(ancestors, ignores)
{
    const names = ignoredMcp(ignores);
    if (!names.length) return [];
    const mcp = require('./mcp.js');
    const held = ancestors.map((root) => mcp.registrationsAt({ scope: 'project', mcpFile: path.join(root, '.mcp.json'), projectRoot: root }).servers);
    return names.filter((n) => held.some((servers) => Object.hasOwn(servers, n)));
}

// A folder's account-file key, compared case-folded with `\` as `/` (A8: Windows keeps the case typed at `cd`).
const foldKey = (p) => String(p).replace(/\\/g, '/').replace(/(.)\/+$/, '$1').toLowerCase();
// The account file's local-scope registrations for `root`: { state, servers, keys, user } - state 'ok', 'unreadable' (the
// file cannot be read, parsed or is no object), 'ambiguous' (two or more `projects` keys name the folder) or 'nokey' (none
// does, or there is no file); `user` is the top-level (user-scope) list. Read only, through json-file.js.
function localRegistrations({ accountFile, root })
{
    const none = (state, keys = [], user = {}) => ({ state, servers: {}, keys, user });
    let text;
    try { text = fs.readFileSync(accountFile, 'utf8'); }
    catch (e) { return none(e.code === 'ENOENT' ? 'nokey' : 'unreadable'); }
    let data;
    try { data = parseJson(text); }
    catch { return none('unreadable'); }
    if (!isObj(data)) return none('unreadable');
    const user = isObj(data.mcpServers) ? data.mcpServers : {};
    const projects = isObj(data.projects) ? data.projects : {};
    const want = new Set([foldKey(path.resolve(root)), foldKey(realOf(root))]);
    const keys = Object.keys(projects).filter((k) => want.has(foldKey(k)) || want.has(foldKey(realOf(k))));
    if (keys.length > 1) return none('ambiguous', keys, user);
    if (!keys.length) return none('nokey', keys, user);
    const held = projects[keys[0]];
    return { state: 'ok', servers: isObj(held) && isObj(held.mcpServers) ? held.mcpServers : {}, keys, user };
}
const parentRegistrations = ({ accountFile, parentRoot }) => localRegistrations({ accountFile, root: parentRoot });

// Since 2.10.1 the stack writes no MCP registration, so a child is told about a linked member's local-scope server it
// cannot see and is never given a copy (spec D8): one line per server, names only - never the entry's JSON or a value.
// A8, probed 2026-10-27 on Claude Code 2.1.311 with no model call: `claude mcp list` in a child under an ancestor's
// .mcp.json server never approved there lists it 'Pending approval', so sharing through the root's .mcp.json is
// approved once in each folder. `approval` is that verdict, a parameter so a test can pin the line both ways.
const APPROVE_ONCE = true;
function hintLine(name, rel, { approval = APPROVE_ONCE } = {})
{
    const n = stamp.validServerName(name) ? name : JSON.stringify(name);
    return `mcp ${n}: registered for ${rel} only (local scope) - not seen here. Share it: claude mcp add-json -s user, or the root's .mcp.json${approval ? ' - approve it once in this folder' : ''}; or copy it here: claude mcp get ${n} in ${rel}, then claude mcp add-json -s local ${n}`;
}

// The hint for `projectRoot`: each linked member's local-scope server not registered here at any scope, not in a
// .mcp.json here or in a folder above (which reaches this project natively, probe P2) and not under `ignore mcp` -
// the nearest member naming it wins. An unreadable account file, or two keys for this project or a member, is one
// `!!` line; a member with no key registers nothing locally, so it says nothing. Read only.
function hintLines(projectRoot, { env = process.env, accountFile = accountPaths(env).accountFile, approval } = {})
{
    const linked = chain(projectRoot, { env });
    if (!linked.members.length) return [];
    const here = localRegistrations({ accountFile, root: projectRoot });
    if (here.state === 'unreadable') return [`!! workspace: ${accountFile} could not be read - no MCP hint for the linked folders`];
    if (here.state === 'ambiguous') return [`!! workspace: ${accountFile} holds ${here.keys.length} entries for this project (${here.keys.join(', ')}) - no MCP hint for it`];
    const mcp = require('./mcp.js');
    const seen = new Set([...Object.keys(here.servers), ...Object.keys(here.user), ...ignoredMcp(readWorkspace(projectRoot, { env }).view.ignores)]);
    for (let dir = realOf(projectRoot); ; dir = path.dirname(dir))
    {
        for (const n of Object.keys(mcp.registrationsAt({ scope: 'project', mcpFile: path.join(dir, '.mcp.json'), projectRoot: dir }).servers)) seen.add(n);
        if (path.dirname(dir) === dir) break;
    }
    const lines = [];
    for (const member of linked.members)
    {
        const reg = localRegistrations({ accountFile, root: member.root });
        if (reg.state === 'ambiguous') { lines.push(`!! workspace: ${accountFile} holds ${reg.keys.length} entries for ${member.rel} (${reg.keys.join(', ')}) - no MCP hint for it`); continue; }
        for (const name of Object.keys(reg.servers).sort())
        {
            if (seen.has(name)) continue;
            seen.add(name);
            lines.push(hintLine(name, member.rel, { approval }));
        }
    }
    return lines;
}

const keptCopiesLine = (names) => `workspace: the MCP registrations an earlier release copied here (${names.join(', ')}) are kept as yours - nothing records them now; claude mcp remove <name> -s local takes one out`;

// An earlier release's D2 copies: the stamp's `workspace-mcp` rows and `state/workspace-mcp.json` go, the registrations
// stay as the user's, named in one line. Never a registration or the account file. Runs after the hint, which skips a
// server registered here, so a copy is never hinted.
function retireMcpCopies(ctx)
{
    const names = Object.keys(((ctx.ledger && ctx.ledger.workspaceMcp) || {}).local || {}).sort();
    const stateFile = path.join(ctx.projectRoot, ctx.dataInfo.root, 'state', 'workspace-mcp.json');
    const stateRemoved = fs.existsSync(stateFile);
    if (stateRemoved) fs.rmSync(stateFile, { force: true });
    if (names.length) ctx.log(`  ${keptCopiesLine(names)}`);
    ctx.workspaceMcp = null;
    return { rows: names.length, stateRemoved };
}

// After the excludes, in a child: the hint, then the older copies' record goes. Off, it is frozen: the rows stay as
// recorded and nothing is printed.
function mcpHint(ctx)
{
    const w = ctx.workspace || { on: false, members: [] };
    const prior = ((ctx.ledger && ctx.ledger.workspaceMcp) || {}).local || {};
    ctx.workspaceMcp = Object.keys(prior).length ? { local: prior } : null;
    if (!w.on) return;
    if (w.members.length) for (const line of hintLines(ctx.projectRoot, { env: ctx.env, accountFile: ctx.accountFile })) ctx.log(`  ${line}`);
    retireMcpCopies(ctx);
}

// ------------------------------------------------------------------ D5, the account instruction key (spec 3)

// A CLAUDE.md on a child's path silences every AGENTS.md below it; Claude Code loads both only where the account says
// so. The key lives in the ACCOUNT settings.json (configDir), the project list in the account file (accountFile) - two
// paths that differ while CLAUDE_CONFIG_DIR is unset, so every function takes the pair.
const INSTRUCTION_KEY = 'pluginConfigs.cc-plugin-agents-md@builtin.options.instructionFiles';
const INSTRUCTION_IDS = ['cc-plugin-agents-md@builtin', 'agents-md@builtin'];   // the second is the id before 2.1.285, read only
const INSTRUCTION_VALUE = 'claude-md-and-agents-md';

function accountPaths(env = process.env)
{
    const home = os.homedir();
    return { configDir: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), accountFile: path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json') };
}

// The first CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md in the project or a folder above it - the account dir's
// own CLAUDE.md is the user's memory, not a project file.
function claudeMdAbove(projectRoot, { env = process.env } = {})
{
    const account = realKey(accountPaths(env).configDir);
    let dir = realOf(projectRoot);
    for (;;)
    {
        for (const rel of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'])
        {
            const file = path.join(dir, rel);
            if (rel.startsWith('.claude') && realKey(path.join(dir, '.claude')) === account) continue;
            if (fs.existsSync(file)) return file;
        }
        const up = path.dirname(dir);
        if (up === dir) return null;
        dir = up;
    }
}

// The stamps of the projects the account file lists under `projects`, `except` left out - never a disk scan.
function accountStamps({ accountFile, except } = {})
{
    let text;
    try { text = fs.readFileSync(accountFile, 'utf8'); }
    catch (e) { return e.code === 'ENOENT' ? { state: 'ok', stamps: [] } : { state: 'unreadable', stamps: [] }; }
    let data;
    try { data = parseJson(text); }
    catch { return { state: 'unreadable', stamps: [] }; }
    const projects = data && typeof data.projects === 'object' && data.projects && !Array.isArray(data.projects) ? Object.keys(data.projects) : [];
    const skip = except ? realKey(except) : null;
    const stamps = [];
    for (const root of projects)
    {
        if (skip && realKey(root) === skip) continue;
        const read = stamp.stampFiles({ projectRoot: root }).read;
        if (read && fs.existsSync(read) && !stamps.includes(read)) stamps.push(read);
    }
    return { state: 'ok', stamps };
}

const declinedIn = (file) => stamp.readInstructionsBoth(file) === 'declined';

// What the account settings hold under either id: { state: 'ok', value } or { state: 'unreadable' }.
function accountValue(configDir)
{
    let text;
    try { text = fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'); }
    catch (e) { return e.code === 'ENOENT' ? { state: 'ok', values: [] } : { state: 'unreadable' }; }
    let data;
    try { data = parseJson(text); }
    catch { return { state: 'unreadable' }; }
    const values = INSTRUCTION_IDS.map((id) => ((((data || {}).pluginConfigs || {})[id] || {}).options || {}).instructionFiles).filter((v) => v !== undefined);
    return { state: 'ok', values, data, text };
}

// ask | set | declined | not-needed | standalone | unreadable - asked only in a joined child with a CLAUDE.md on its
// path, while neither the account's key nor any decline on the account answers it.
function instructionsBothState({ projectRoot, env = process.env, configDir, accountFile })
{
    // The kill switch freezes the workspace and asks nothing (AC16): no account key is offered either.
    if (!workspaceOn({ env, projectRoot })) return 'off';
    if (!chain(projectRoot, { env }).members.length) return 'standalone';
    if (!claudeMdAbove(projectRoot, { env })) return 'not-needed';
    const held = accountValue(configDir);
    if (held.state === 'unreadable') return 'unreadable';
    if (held.values.includes(INSTRUCTION_VALUE)) return 'set';
    const own = stamp.stampFiles({ projectRoot }).read;
    if (own && declinedIn(own)) return 'declined';
    const listed = accountStamps({ accountFile, except: projectRoot });
    if (listed.state === 'unreadable') return 'unreadable';
    return listed.stamps.some(declinedIn) ? 'declined' : 'ask';
}

// The line init-plan and update-preflight print for a state, or null when it asks nothing and has nothing to say.
function instructionsBothLine(state)
{
    if (state === 'ask') return 'instructions-both: ask';
    if (state === 'unreadable') return "instructions-both: not asked - the account's settings.json or .claude.json could not be read";
    return null;
}

// The file a write through `file` lands on: `file` itself, or the end of its chain of links, each link read from its own
// folder's REAL place as the OS reads it (a relative `..` under a linked folder) - a dangling end included, which the
// write then makes. A loop throws ELOOP before anything is written.
function linkTarget(file)
{
    let at = file;
    for (let hop = 0; hop < 40; hop++)
    {
        let st;
        try { st = fs.lstatSync(at); } catch { return at; }
        if (!st.isSymbolicLink()) return at;
        at = path.resolve(fs.realpathSync(path.dirname(at)), fs.readlinkSync(at));
    }
    throw Object.assign(new Error(`${file}: too many levels of symbolic links`), { code: 'ELOOP' });
}

// The file written back in its own shape (json-file.js formatOf: its BOM, line ends and indent) - through a
// temp file beside it and a rename. A LINK is written through, never replaced (review fix pass, run B, m7: a dotfiles
// link at the account settings.json became a plain file): the temp file and the rename go to the link's real file, in
// that file's own folder. Every writer here is an account settings.json writer - D5's apply and remove, and the
// auto-update answer (marketplace-autoupdate.js).
function writeLike(file, text, data)
{
    const body = stringifyLike(data, formatOf(text));
    const target = linkTarget(file);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(tmp, body); fs.renameSync(tmp, target); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ } throw e; }
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// D5's yes: the key under the current id. A value the user set under either id is kept, a file that does not parse
// is refused - each named in `why`.
function applyAccountInstructions({ configDir })
{
    const file = path.join(configDir, 'settings.json');
    const held = accountValue(configDir);
    if (held.state === 'unreadable') return { written: false, why: `${file} is not valid JSON - left as it is` };
    const hash = stamp.valueHash(JSON.stringify(INSTRUCTION_VALUE));
    if (held.values.includes(INSTRUCTION_VALUE)) return { written: false, why: 'already set' };
    if (held.values.length) return { written: false, why: `the account holds instructionFiles: ${held.values[0]} - the user's value is kept` };
    const data = held.data === undefined ? {} : held.data;
    if (!isObj(data) || (data.pluginConfigs !== undefined && !isObj(data.pluginConfigs))) return { written: false, why: `${file}: pluginConfigs is not an object - left as it is` };
    const configs = (data.pluginConfigs ??= {});
    const entry = (configs[INSTRUCTION_IDS[0]] ??= {});
    if (!isObj(entry) || (entry.options !== undefined && !isObj(entry.options))) return { written: false, why: `${file}: ${INSTRUCTION_IDS[0]} is not an object - left as it is` };
    (entry.options ??= {}).instructionFiles = INSTRUCTION_VALUE;
    try { fs.mkdirSync(configDir, { recursive: true }); writeLike(file, held.text === undefined ? '{}' : held.text, data); }
    catch (e) { return { written: false, why: `${file} could not be written (${e.code || e.message})` }; }
    return { written: true, hash };
}

// Uninstall's half: the key goes only while it still hashes to what the apply wrote; the containers it emptied go too.
function removeAccountInstructions({ configDir, hash })
{
    const file = path.join(configDir, 'settings.json');
    const held = accountValue(configDir);
    if (held.state === 'unreadable') return { removed: false, why: `${file} is not valid JSON - left as it is` };
    const entry = held.data && isObj(held.data.pluginConfigs) ? held.data.pluginConfigs[INSTRUCTION_IDS[0]] : null;
    const options = isObj(entry) && isObj(entry.options) ? entry.options : null;
    if (!options || !Object.hasOwn(options, 'instructionFiles')) return { removed: false, why: 'absent' };
    if (stamp.valueHash(JSON.stringify(options.instructionFiles)) !== hash) return { removed: false, why: 'changed since it was written - kept as the user\'s' };
    delete options.instructionFiles;
    if (!Object.keys(options).length) delete entry.options;
    if (!Object.keys(entry).length) delete held.data.pluginConfigs[INSTRUCTION_IDS[0]];
    if (!Object.keys(held.data.pluginConfigs).length) delete held.data.pluginConfigs;
    try { writeLike(file, held.text, held.data); }
    catch (e) { return { removed: false, why: `${file} could not be written (${e.code || e.message})` }; }
    return { removed: true };
}

// Whether this project's uninstall is the last on the account to record the key: `others` are the listed stamps that
// still carry a managed-account row. An unreadable account file is never 'last'.
function lastHolder({ accountFile, projectRoot })
{
    const listed = accountStamps({ accountFile, except: projectRoot });
    if (listed.state === 'unreadable') return { last: false, others: [], state: 'unreadable' };
    const others = listed.stamps.filter((f) => /^managed-account:[ \t]*\S/m.test(readOr(f)));
    return { last: !others.length, others, state: 'ok' };
}
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// ------------------------------------------------------------------ uninstall (spec 2.6)

// A parent's uninstall: each direct child that names it first gets every value it read through the chain written into
// its own `.variables` (D5's keep, so nothing changes), then loses its `parent` line and its stamp's `own-picks:` /
// `own-env:` lines, so it reads as standalone and every item it holds is its own; the parent's `child` lines go
// with them. A gone child has nothing to release. Returns the released children's lines.
function releaseChildren({ projectRoot, env = process.env, dataRoot, log = () => {}, note = () => {} })
{
    const root = realOf(projectRoot);
    const released = [];
    const stale = [];
    for (const rel of readWorkspace(root, { env, dataRoot }).view.children)
    {
        const child = path.join(root, ...rel.split('/'));
        if (!isDir(child) || !isStamped(child)) continue;
        const points = (record) => { const v = record.parent; return v && realKey(path.resolve(child, ...v.split('/'))) === realKey(root); };
        // A child that names another parent is that parent's: its line here is stale, and it is left as it is.
        const held = readWorkspace(child);
        if (!points(held.record)) { stale.push(rel); continue; }
        const kept = keepOnLeave(child, { env: { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR }, log: (l) => log(l.replace(/^workspace: /, `workspace: ${rel}: `)) });
        if (kept.why) { note(`workspace: ${rel} could not be released (${kept.why}) - run uninstall again`); continue; }
        copyIn(child, (l) => log(`workspace: ${rel}: ${l.trim()}`));
        const r = writeWorkspace(child, (m) => (points(m) ? setParent(m, null) : m), { runRoot: root, log });
        if (!r.ok) { note(`workspace: ${rel} could not be released (${r.why}) - run uninstall again`); continue; }
        const childStamp = stamp.stampFiles({ projectRoot: child }).read;
        // Its D2 copies stay as the user's own registrations: the rows and the parent hashes they were made from go.
        if (childStamp) for (const key of ['own-picks', 'own-env', 'workspace-mcp']) stamp.markLine(childStamp, key, null);
        if (held.file) fs.rmSync(path.join(path.dirname(held.file), 'state', 'workspace-mcp.json'), { force: true });
        log(`workspace: released ${rel} - it reads as standalone now, every item it holds its own`);
        released.push(rel);
    }
    if (released.length || stale.length) writeWorkspace(root, (m) => { for (const rel of [...released, ...stale]) removeChild(m, rel); return m; }, { env, dataRoot, log });
    return released;
}

// A child's uninstall, and the CLI's unregister: the parent's `child` line first, then this project's `parent` line.
// { left } or { left: false, why, line } - `why` is writeWorkspace's, `line` the sentence that names it.
function leaveParent({ projectRoot, env = process.env, dataRoot, log = () => {}, note = () => {} })
{
    const root = realOf(projectRoot);
    const own = readWorkspace(root, { env, dataRoot });
    if (!own.view.parent) return { left: false };
    const parent = path.resolve(root, ...own.view.parent.split('/'));
    const failed = (why, line) => { note(line); return { left: false, why, line }; };
    if (isDir(parent))
    {
        const childRel = relPosix(realOf(parent), root);
        const up = writeWorkspace(parent, (m) => removeChild(m, childRel), { runRoot: root, log });
        if (!up.ok) return failed(up.why, `workspace: the workspace file in ${own.view.parent} could not be changed (${up.why}) - nothing was removed`);
        if (up.changed) log(`workspace: child ${childRel} removed from ${own.view.parent}`);
    }
    const here = writeWorkspace(root, (m) => setParent(m, null), { env, dataRoot, log });
    if (!here.ok) return failed(here.why, `workspace: this project's workspace file could not be changed (${here.why})`);
    log(`workspace: parent ${own.view.parent} removed`);
    return { left: true };
}

// Before uninstall changes anything: the path, relative to the project, of each record it would write that reads garbage -
// this project's own (and then nothing more is read), the parent's its record names, each listed child's that is a
// stamped folder. Run past one, releaseChildren would file a garbage child as stale, and leaveParent would fail on a
// garbage parent after the files were already removed.
function garbageOnLeave({ projectRoot, env = process.env, dataRoot })
{
    const root = realOf(projectRoot);
    const own = readWorkspace(root, { env, dataRoot });
    if (own.state === 'garbage') return [relPosix(root, own.file)];
    const out = [];
    const check = (dir) => { const r = readWorkspace(dir); if (r.state === 'garbage') out.push(relPosix(root, r.file)); };
    if (own.view.parent)
    {
        const parent = path.resolve(root, ...own.view.parent.split('/'));
        if (isDir(parent)) check(parent);
    }
    for (const rel of own.view.children)
    {
        const child = path.join(root, ...rel.split('/'));
        if (isDir(child) && isStamped(child)) check(child);
    }
    return out;
}

// ------------------------------------------------------------------ the exclude check (spec 3)

// The managed settings file and its drop-in folder sit in one system directory per OS
// (https://code.claude.com/docs/en/managed-settings, 'Deploy a managed settings file': macOS
// /Library/Application Support/ClaudeCode/, Linux and WSL /etc/claude-code/, Windows C:\Program Files\ClaudeCode\ - the
// legacy C:\ProgramData path is not read). An MDM profile, an HKLM value or a server-managed policy is no file here; an
// auth key one of them sets is the residual the no-credentials line still catches.
function managedSettingsFile(platform = process.platform, env = process.env)
{
    if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
    if (platform === 'win32') return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json');
    return '/etc/claude-code/managed-settings.json';
}

// The process gets these names from the caller's env and nothing else (the probes' method,
// docs/workspace-layering-evidence.md); CLAUDE_CONFIG_DIR, HOME and USERPROFILE are the throwaway ones.
const PROBE_ENV = ['PATH', 'TMPDIR', 'SystemRoot', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA'];
const AUTH_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport'];
const AUTH_ENV = /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY)|AWS_\w+|GOOGLE_APPLICATION_CREDENTIALS)$/;
// The debug-log strings the probes recorded verbatim (Claude Code 2.1.309 / 2.1.310).
const NO_CREDENTIALS = 'Skipped: no usable OAuth, WIF, or API key';
// The default mode names what it loaded as one ', '-separated list; with the account's instructionFiles key set (both
// files) it names no file, only how many the scan kept after the excludes.
const AGENTS_LOADED = /AGENTS\.md loaded: (.+?)\s*$/gm;
const AGENTS_FOUND = /\(cc-plugin-agents-md\): AGENTS\.md, \.claude[\\/]AGENTS\.md found (\d+) of \d+ directories/;

// Every AGENTS.md and .claude/AGENTS.md on disk in the project's folder and each folder above it, the filesystem root
// left out - the folders the built-in plugin scans (2.1.310 logged 9 of them for a project 10 folders deep).
function agentsOnDisk(root)
{
    const out = [];
    for (let dir = root; path.dirname(dir) !== dir; dir = path.dirname(dir))
    {
        for (const rel of ['AGENTS.md', path.join('.claude', 'AGENTS.md')])
        {
            const p = path.join(dir, rel);
            try { if (fs.statSync(p).isFile()) out.push(p); }
            catch { /* none here */ }
        }
    }
    return out;
}

// The first settings layer the probe reads that could authenticate before a line is checked, as '<file> sets <key>'.
function authLayer(projectRoot, managedFile)
{
    const dropIns = path.join(path.dirname(managedFile), 'managed-settings.d');
    let drops = [];
    try { drops = fs.readdirSync(dropIns).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(dropIns, n)); }
    catch { /* no drop-in folder */ }
    const files = [path.join(projectRoot, '.claude', 'settings.json'), path.join(projectRoot, '.claude', 'settings.local.json'), managedFile, ...drops];
    for (const file of files)
    {
        const data = readJson(file);
        if (!isObj(data)) continue;
        const label = relPosix(projectRoot, file).startsWith('..') ? file : relPosix(projectRoot, file);
        const key = AUTH_KEYS.find((k) => data[k] !== undefined && data[k] !== null && data[k] !== '');
        if (key) return `${label} sets ${key}`;
        const envKey = isObj(data.env) ? Object.keys(data.env).find((k) => AUTH_ENV.test(k)) : null;
        if (envKey) return `${label} sets env.${envKey}`;
    }
    return null;
}

const pickEnv = (env, name) =>
{
    const key = process.platform === 'win32' ? Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) : name;
    return key !== undefined ? env[key] : undefined;
};

// One logged-out `claude -p hi` in the project: every loaded file an ancestor's excludes cover, and every ancestor seed
// AGENTS.md the built-in plugin's debug line names, is a miss. Never inside a session - it costs one CLI start.
function checkLoads({ projectRoot, env = process.env, configDir, claudeBin = 'claude', rt = runtime, now = () => new Date(), managedFile = managedSettingsFile() } = {})
{
    const root = realOf(projectRoot);
    const finish = (result) =>
    {
        const file = readWorkspace(root, { env }).file;
        if (file)
        {
            try
            {
                fs.mkdirSync(path.join(path.dirname(file), 'state'), { recursive: true });
                fs.writeFileSync(path.join(path.dirname(file), 'state', 'workspace-check.json'), `${JSON.stringify({ at: now().toISOString(), state: result.state, misses: result.misses })}\n`);
            }
            catch { /* the record is a convenience for status; the result stands without it */ }
        }
        return result;
    };
    const ancestors = stampedAncestors(root, { env });
    if (!ancestors.length) return finish({ state: 'skipped', misses: [], why: 'no installed folder above this project' });
    const skip = authLayer(root, managedFile);
    if (skip) return finish({ state: 'skipped', misses: [], why: skip });
    const ignores = readWorkspace(root, { env }).view.ignores;
    const excluded = new Map(chainExcludes(ancestors, root, ignores).map((p) => [realKey(p), realOf(p)]));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-check-loads-'));
    try
    {
        const home = path.join(tmp, 'home');
        const events = path.join(tmp, 'events');
        for (const dir of [home, events, path.join(tmp, 'acct')]) fs.mkdirSync(dir, { recursive: true });
        // One file per event: two hooks appending to one file at once both failed on Windows (the probes).
        const hook = path.join(tmp, 'hook.js');
        fs.writeFileSync(hook, `let s = '';\nprocess.stdin.on('data', (d) => { s += d; }).on('end', () => require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(events)}, \`\${Date.now()}-\${process.pid}-\${Math.random().toString(36).slice(2)}.json\`), s));\n`);
        const settings = { hooks: { InstructionsLoaded: [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"` }] }] } };
        // The account's AGENTS.md setting, that key alone: the probe loads AGENTS.md the way the user's sessions do.
        const held = accountValue(configDir || accountPaths(env).configDir);
        const entry = held.data && isObj(held.data.pluginConfigs) ? held.data.pluginConfigs[INSTRUCTION_IDS[0]] : undefined;
        if (entry !== undefined) settings.pluginConfigs = { [INSTRUCTION_IDS[0]]: entry };
        const settingsFile = path.join(tmp, 'hooks.json');
        fs.writeFileSync(settingsFile, JSON.stringify(settings));
        const log = path.join(tmp, 'run.log');
        const probeEnv = { CLAUDE_CONFIG_DIR: path.join(tmp, 'acct'), HOME: home, USERPROFILE: home };
        for (const name of PROBE_ENV) { const v = pickEnv(env, name); if (v !== undefined) probeEnv[name] = v; }
        const r = rt.spawnCommand(claudeBin, ['-p', 'hi', '--debug', '--debug-file', log, '--settings', settingsFile], { cwd: root, env: probeEnv, encoding: 'utf8', stdio: 'pipe', timeout: 90000 });
        let text;
        try { text = fs.readFileSync(log, 'utf8'); }
        catch { return finish({ state: 'error', misses: [], why: r.error ? `claude did not start (${r.error.message})` : 'the probe wrote no debug log' }); }
        if (!text.includes(NO_CREDENTIALS)) return finish({ state: 'authenticated', misses: [] });
        const loaded = [];
        for (const name of fs.readdirSync(events).sort())
        {
            try { const p = JSON.parse(fs.readFileSync(path.join(events, name), 'utf8')).file_path; if (typeof p === 'string') loaded.push(p); }
            catch { /* a half-written event file names nothing */ }
        }
        let listed = false;
        for (const m of text.matchAll(AGENTS_LOADED)) { listed = true; loaded.push(...m[1].split(/, (?=[\\/]|[A-Za-z]:[\\/])/)); }
        const found = listed || !settings.pluginConfigs ? null : AGENTS_FOUND.exec(text);
        if (found)
        {
            // The keyed mode only (a CLAUDE.md silences the default mode's scan, measured): more kept than the files the
            // excludes leave means the excluded ones load. Which of them, the log cannot say - every one is named, and one
            // update writes them all.
            const onDisk = agentsOnDisk(root);
            const shut = onDisk.filter((p) => excluded.has(realKey(p)));
            if (Number(found[1]) > onDisk.length - shut.length) loaded.push(...shut);
        }
        const misses = [...new Set(loaded.map((p) => excluded.get(realKey(p))).filter(Boolean))];
        return finish({ state: misses.length ? 'misses' : 'clean', misses });
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = {
    editDenyRule, ancestorAccess,
    CATEGORIES, emptyRecord, workspaceOn,
    setParent, setRole, setAbove, addChild, removeChild, addIgnore, removeIgnore,
    workspacePath, readWorkspace, writeWorkspace, garbageLine, sayGarbage, convertOwn, takeConversions, olderProjectLines, JSON_SINCE, PLURAL_SINCE,
    realKey, findParent, sameRepo, isCheckout, joinVerdict, roleOf, roleText, roleAsk, register, applyRole, pruneOnJoin, keepOnLeave, chain, subtree, rescan,
    planLines, effectiveLists, delta, ownPicksAfter, chainValues, envPlan, stampedAncestors, ancestorExcludes, excludeGlobs, refreshBelow, memberPicks, locate, addToStore, copyIn,
    readPlan, planDoubt, prepare, recordWord, listLines, workspaceStep, parentRegistrations, mcpHint, hintLine, hintLines,
    retireMcpCopies, keptCopiesLine, APPROVE_ONCE,
    INSTRUCTION_KEY, accountPaths, claudeMdAbove, accountStamps, instructionsBothState, instructionsBothLine, applyAccountInstructions, removeAccountInstructions, lastHolder,
    releaseChildren, leaveParent, garbageOnLeave, managedSettingsFile, checkLoads, writeLike,
};
