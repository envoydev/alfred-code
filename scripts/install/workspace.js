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
const path = require('node:path');
const dataRootMod = require('../../stack/mcp/data-root.js');

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

module.exports = {
    CATEGORIES, parseWorkspace, renderWorkspace, viewOf,
    setParent, addChild, removeChild, addIgnore, removeIgnore,
    ancestorEnv, workspacePath, readWorkspace, writeWorkspace, moveWorkspace,
};
