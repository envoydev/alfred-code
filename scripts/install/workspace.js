'use strict';
// WORKSPACE LAYERING (spec docs: workspace layering design, section 2.1). A workspace ROOT folder holds an Alfred
// install, and the child projects under it hold their own installs that inherit the root's set and can ignore parts
// of it. Each project records its place in the tree in ONE machine-local file, `<data root>/workspace`:
//
//   parent <path>            at most one - `..` segments only, so moving the whole tree keeps it valid
//   parent none              a declined join, so the join is not asked again
//   child <path>             direct children only, relative, `/` separated
//   ignore <category> <name> an inherited item this project leaves out (never its own)
//
// A line the reader does not know is kept byte for byte and named; a duplicate entry is dropped on read. Every write
// takes `<data root>/workspace.lock` (created with `wx`, retried for 2 s, taken over when older than 30 s), reads,
// changes, writes a temp file and renames it into place - so two sibling inits cannot overwrite each other's `child`
// line.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataRootMod = require('../../stack/mcp/data-root.js');
const brand = require('./brand.js');
const runtime = require('./runtime.js');
const stamp = require('./stamp.js');

const CATEGORIES = Object.freeze(['skill', 'agent', 'rule', 'hook', 'plugin', 'env', 'mcp', 'secret', 'doc', 'instructions']);
const FILE = 'workspace';
const LOCK = 'workspace.lock';
const STEP_MS = 50;

// ------------------------------------------------------------------ the lines

const PARENT_RE = /^\.\.(\/\.\.)*$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const PATH_NAME_RE = /^[A-Za-z0-9._\/-]+$/;
const segmentsOk = (value) => value.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

function isChildPath(value)
{
    return typeof value === 'string' && value !== '' && !value.startsWith('/') && !/[:\\]/.test(value) && segmentsOk(value);
}

function isIgnoreName(category, name)
{
    if (!CATEGORIES.includes(category) || typeof name !== 'string') return false;
    if (NAME_RE.test(name)) return true;
    return (category === 'doc' || category === 'instructions') && PATH_NAME_RE.test(name) && segmentsOk(name);
}

// One line as an entry; `raw` keeps the line as written (no line ending) for the kinds rendered as written.
function parseLine(raw)
{
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return { kind: 'comment', raw };
    const [word, ...rest] = line.split(/\s+/);
    const value = rest.join(' ');
    if (word === 'parent')
    {
        if (value === 'none') return { kind: 'parent-none', raw };
        if (PARENT_RE.test(value)) return { kind: 'parent', value, raw };
    }
    else if (word === 'child')
    {
        if (isChildPath(value)) return { kind: 'child', value, raw };
    }
    else if (word === 'ignore' && rest.length === 2)
    {
        const [category, name] = rest;
        if ((category === 'docs' || category === 'memory') && name === 'root') return { kind: 'ignore', category, name, raw };
        if (isIgnoreName(category, name)) return { kind: 'ignore', category, name, raw };
    }
    return { kind: 'unknown', raw };
}

const keyOf = (e) => (e.kind === 'parent' || e.kind === 'parent-none' ? 'parent'
    : e.kind === 'child' ? `child ${e.value}`
        : e.kind === 'ignore' ? `ignore ${e.category} ${e.name}` : null);

// The model of a file's text. A leading BOM is dropped, CRLF reads as LF, and a duplicate entry - a second `parent`
// line included - keeps its first spelling: a second parent line is unknown, so it is named, never silently chosen.
function parseWorkspace(text)
{
    const body = String(text ?? '').replace(/^\uFEFF/, '');
    const lines = body.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const seen = new Set();
    const entries = [];
    for (const raw of lines)
    {
        const entry = parseLine(raw);
        const key = keyOf(entry);
        if (key && seen.has(key))
        {
            if (key === 'parent' && entries.find((e) => keyOf(e) === 'parent' && e.raw.trim() !== raw.trim())) entries.push({ kind: 'unknown', raw });
            continue;
        }
        if (key) seen.add(key);
        entries.push(entry);
    }
    return { entries };
}

function renderEntry(e)
{
    if (e.kind === 'parent') return `parent ${e.value}`;
    if (e.kind === 'parent-none') return 'parent none';
    if (e.kind === 'child') return `child ${e.value}`;
    if (e.kind === 'ignore') return `ignore ${e.category} ${e.name}`;
    return e.raw.replace(/\r$/, '');
}

const renderWorkspace = (model) => model.entries.map((e) => `${renderEntry(e)}\n`).join('');

function viewOf(model)
{
    const view = { parent: null, parentNone: false, children: [], ignores: [], unknown: [] };
    for (const e of model.entries)
    {
        if (e.kind === 'parent') view.parent = e.value;
        else if (e.kind === 'parent-none') view.parentNone = true;
        else if (e.kind === 'child') view.children.push(e.value);
        else if (e.kind === 'ignore') view.ignores.push({ category: e.category, name: e.name });
        else if (e.kind === 'unknown') view.unknown.push(e.raw.trim());
    }
    return view;
}

// ------------------------------------------------------------------ the mutators

function setParent(model, rel)
{
    if (rel !== null && rel !== 'none' && !PARENT_RE.test(String(rel))) throw new Error(`workspace: parent ${rel} is not a run of .. segments`);
    const at = model.entries.findIndex((e) => e.kind === 'parent' || e.kind === 'parent-none');
    model.entries = model.entries.filter((e) => e.kind !== 'parent' && e.kind !== 'parent-none');
    if (rel === null) return model;
    const entry = rel === 'none' ? { kind: 'parent-none', raw: 'parent none' } : { kind: 'parent', value: rel, raw: `parent ${rel}` };
    model.entries.splice(at < 0 ? 0 : at, 0, entry);
    return model;
}

function addChild(model, rel)
{
    if (!isChildPath(rel)) throw new Error(`workspace: child ${rel} is not a relative path inside the project`);
    if (!model.entries.some((e) => e.kind === 'child' && e.value === rel)) model.entries.push({ kind: 'child', value: rel, raw: `child ${rel}` });
    return model;
}

function removeChild(model, rel)
{
    model.entries = model.entries.filter((e) => !(e.kind === 'child' && e.value === rel));
    return model;
}

function addIgnore(model, category, name)
{
    const fixed = (category === 'docs' || category === 'memory') && name === 'root';
    if (!fixed && !isIgnoreName(category, name)) throw new Error(`workspace: ignore ${category} ${name} is not a known category and name`);
    if (!model.entries.some((e) => e.kind === 'ignore' && e.category === category && e.name === name))
        model.entries.push({ kind: 'ignore', category, name, raw: `ignore ${category} ${name}` });
    return model;
}

function removeIgnore(model, category, name)
{
    model.entries = model.entries.filter((e) => !(e.kind === 'ignore' && e.category === category && e.name === name));
    return model;
}

// ------------------------------------------------------------------ the file

// The env an ANCESTOR's data root is read with: only the account, so the run's own ALFRED_CODE_DATA_PATH never
// names another project's root, while settingFrom still reads the account this run uses - an empty env would read
// the real ~/.claude/settings.json inside a throwaway-account run.
const ancestorEnv = (env = {}) => ({ CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR });

// { file } for the project's workspace file, or { why } when a handed data root is refused. A handed `dataRoot`
// is the root init's walk chose before any setting names it (`register --data-path`).
function locate(projectRoot, { env = {}, dataRoot } = {})
{
    let root;
    if (dataRoot !== undefined && dataRoot !== null && dataRoot !== '')
    {
        const checked = dataRootMod.checkDataPath(dataRoot);
        if (!checked.ok) return { why: checked.why };
        root = checked.value;
    }
    else root = dataRootMod.dataRootOf({ env, projectDir: projectRoot }).root;
    const dir = path.join(projectRoot, ...root.split('/'));
    return { root, dir, file: path.join(dir, FILE), lock: path.join(dir, LOCK) };
}

function workspacePath(projectRoot, opts = {})
{
    const at = locate(projectRoot, opts);
    if (!at.file) throw new Error(`workspace: data root refused - ${at.why}`);
    return at.file;
}

function readAt(file)
{
    try
    {
        const text = fs.readFileSync(file, 'utf8');
        const model = parseWorkspace(text);
        return { file, state: 'ok', text, model, view: viewOf(model) };
    }
    catch (e)
    {
        const model = { entries: [] };
        return { file, state: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', text: '', model, view: viewOf(model) };
    }
}

function readWorkspace(projectRoot, opts = {})
{
    const at = locate(projectRoot, opts);
    if (!at.file)
    {
        const model = { entries: [] };
        return { file: null, state: 'unreadable', model, view: viewOf(model), why: at.why };
    }
    const { text, ...got } = readAt(at.file);
    return got;
}

// Atomics.wait blocks without spinning; the installer and the CLI are synchronous throughout.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// true once this run holds the lock, false when another run held it past `retryMs`. A lock older than `staleMs`
// (by its mtime) is a run that died holding it, and is taken over.
function takeLock(lock, { now, sleep, retryMs, staleMs })
{
    const start = now();
    for (;;)
    {
        try
        {
            fs.closeSync(fs.openSync(lock, 'wx'));
            return true;
        }
        catch (e)
        {
            if (!e || e.code !== 'EEXIST') throw e;
        }
        let age = 0;
        try { age = now() - fs.statSync(lock).mtimeMs; }
        catch { continue; }                 // released between the open and the stat: try again at once
        if (age > staleMs)
        {
            try { fs.unlinkSync(lock); } catch { /* another run took it over first: the open decides */ }
            continue;
        }
        if (now() - start >= retryMs) return false;
        sleep(STEP_MS);
    }
}

// Reads, changes and writes the project's workspace file under its lock. `mutate(model)` changes the model in place
// (or returns a new one). Nothing is written when the change leaves the rendered file as it was, so a hand-saved
// file keeps its bytes until a line in it really changes.
function writeWorkspace(projectRoot, mutate, { env = {}, dataRoot, now = Date.now, sleep = sleepMs, retryMs = 2000, staleMs = 30000 } = {})
{
    const empty = viewOf({ entries: [] });
    const at = locate(projectRoot, { env, dataRoot });
    if (!at.file) return { ok: false, why: 'unwritable', view: empty, wrote: false };
    try { fs.mkdirSync(at.dir, { recursive: true }); }
    catch { return { ok: false, why: 'unwritable', view: empty, wrote: false }; }
    let held = false;
    try
    {
        held = takeLock(at.lock, { now, sleep, retryMs, staleMs });
        if (!held) return { ok: false, why: 'locked', view: readAt(at.file).view, wrote: false };
        const current = readAt(at.file);
        if (current.state === 'unreadable') return { ok: false, why: 'unwritable', view: current.view, wrote: false };
        const before = renderWorkspace(current.model);
        const model = mutate(current.model) || current.model;
        const after = renderWorkspace(model);
        if (after === before) return { ok: true, view: viewOf(model), wrote: false };
        const tmp = `${at.file}.${process.pid}.${Date.now()}.tmp`;
        try
        {
            fs.writeFileSync(tmp, after);
            fs.renameSync(tmp, at.file);
        }
        catch
        {
            try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ }
            return { ok: false, why: 'unwritable', view: current.view, wrote: false };
        }
        return { ok: true, view: viewOf(model), wrote: true };
    }
    catch
    {
        return { ok: false, why: 'unwritable', view: empty, wrote: false };
    }
    finally
    {
        if (held) try { fs.unlinkSync(at.lock); } catch { /* already gone */ }
    }
}

// A data-root move carries the workspace file along (planDataMove moves only the secrets store, and leaves the old
// root in place while it holds anything else). Never over a file the new root already holds.
function moveWorkspace({ projectRoot, from, to, log = () => {} })
{
    const src = path.join(projectRoot, ...String(from).split('/'), FILE);
    const dst = path.join(projectRoot, ...String(to).split('/'), FILE);
    if (!fs.existsSync(src)) return 'absent';
    if (fs.existsSync(dst))
    {
        log(`  !! workspace: ${from}/${FILE} left in place - ${to}/${FILE} already exists`);
        return 'clash';
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    log(`  workspace: moved ${from}/${FILE} -> ${to}/${FILE}`);
    return 'moved';
}

// ------------------------------------------------------------------ the tree

const realOf = (p) =>
{
    try { return fs.realpathSync.native(p); }
    catch { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
};
// One spelling per folder: the real path (macOS /tmp is /private/tmp, a Windows 8.3 name is expanded), `/`
// separated, case-folded where the filesystem folds case by default.
const realKey = (p) =>
{
    const key = realOf(p).split(path.sep).join('/');
    return process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key;
};
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

// The project's ancestors through its `parent` lines, nearest first. A hop counts only to a real strict ancestor that
// holds a stamp and whose own file lists this folder as `child` (the N1 rule): project text alone can never pull an
// unrelated folder - or its secrets - into the chain. The first refused hop ends it with one `!!` note, returned for
// the caller to log (never through the installer's `note`, which counts a failure).
function chain(projectRoot, { env = process.env, maxDepth = 8, ownDataRoot } = {})
{
    const start = realOf(projectRoot);
    const members = [];
    const notes = [];
    const seen = new Set([realKey(start)]);
    let current = start;
    let read = readWorkspace(start, { env, dataRoot: ownDataRoot });
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
        const parentRead = readWorkspace(parent, { env: ancestorEnv(env) });
        if (!parentRead.view.children.some((c) => realKey(path.join(parent, ...c.split('/'))) === realKey(current)))
        {
            refuse(`${label} does not list this folder as a child`);
            break;
        }
        const key = realKey(parent);
        if (seen.has(key)) { refuse(`${label} is already in the chain`); break; }
        seen.add(key);
        const dataRoot = dataRootMod.dataRootOf({ env: ancestorEnv(env), projectDir: parent }).root;
        members.push({ root: realOf(parent), rel: label, dataRoot, view: parentRead.view });
        current = parent;
        read = parentRead;
    }
    return { members, notes };
}

// The project and every descendant its `child` lines reach, pre-order. A child folder that is missing or holds no
// stamp is `gone`, and nothing below it is read.
function subtree(projectRoot, { env = process.env, maxDepth = 8 } = {})
{
    const top = realOf(projectRoot);
    const rows = [{ root: top, rel: '.', depth: 0, parentRel: null, state: 'ok' }];
    const seen = new Set([realKey(top)]);
    const walk = (dir, rel, depth, view) =>
    {
        if (depth >= maxDepth) return;
        for (const c of view.children)
        {
            const child = path.join(dir, ...c.split('/'));
            const key = realKey(child);
            if (seen.has(key)) continue;
            seen.add(key);
            const childRel = rel === '.' ? c : `${rel}/${c}`;
            const ok = isDir(child) && isStamped(child);
            rows.push({ root: ok ? realOf(child) : child, rel: childRel, depth: depth + 1, parentRel: rel, state: ok ? 'ok' : 'gone' });
            if (ok) walk(child, childRel, depth + 1, readWorkspace(child, { env: ancestorEnv(env) }).view);
        }
    };
    walk(top, '.', 0, readWorkspace(top, { env }).view);
    return rows;
}

const RESCAN_SKIP = new Set(['.git', 'node_modules', '.claude']);

// Stamped folders under the project with no `parent` or `parent none` line - projects installed before their root,
// offered as children. A stamped folder ends the walk down that branch: what is below it is that project's.
function rescan(projectRoot, { maxDepth = 5, env = process.env } = {})
{
    const top = realOf(projectRoot);
    const dataRoot = dataRootMod.dataRootOf({ env, projectDir: top }).root.split('/')[0];
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
                const view = readWorkspace(child, { env: ancestorEnv(env) }).view;
                if (!view.parent && !view.parentNone) found.push(relPosix(top, child));
                continue;
            }
            if (depth + 1 < maxDepth) walk(child, depth + 1);
        }
    };
    walk(top, 0);
    return found.sort();
}

module.exports = {
    CATEGORIES, parseWorkspace, renderWorkspace, viewOf,
    setParent, addChild, removeChild, addIgnore, removeIgnore,
    ancestorEnv, workspacePath, readWorkspace, writeWorkspace, moveWorkspace,
    realKey, findParent, sameRepo, isCheckout, joinVerdict, chain, subtree, rescan,
};
