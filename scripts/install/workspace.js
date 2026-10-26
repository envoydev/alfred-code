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
const { readJson, parseJson } = require('./json-file.js');
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

// ------------------------------------------------------------------ the switch

// ALFRED_CODE_WORKSPACE, a catalog row the installers never write. A `0` in the launch env, or in the settings env
// that applies here (settings.local.json over settings.json), freezes the workspace: a session applies a settings
// `env` over its launch env, so a launch `1` cannot thaw a settings `0`. An unreadable settings file holds nothing.
function workspaceOn({ env = {}, projectRoot })
{
    if (String(env.ALFRED_CODE_WORKSPACE) === '0') return false;
    const valueIn = (name) =>
    {
        const data = readJson(path.join(projectRoot, '.claude', name));
        return data && data.env && typeof data.env === 'object' ? data.env.ALFRED_CODE_WORKSPACE : undefined;
    };
    const local = valueIn('settings.local.json');
    const value = local !== undefined ? local : valueIn('settings.json');
    return String(value) !== '0';
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

// update's join ask (spec 3): `workspace: join <rel>` for a checkout below an installed folder whose file names no parent
// yet, `\trejoin` once its parent line stands but the parent no longer lists it (hop rule 4 alone - AC18's recovery, the
// consent left with the person). Null otherwise, and with the switch off.
function joinLine(projectRoot, { env = process.env, exec = runtime.execCommand } = {})
{
    if (!workspaceOn({ env, projectRoot })) return null;
    const v = joinVerdict(projectRoot, { env, exec });
    if (!v.ok) return null;
    const view = readWorkspace(projectRoot, { env }).view;
    if (view.parentNone) return null;
    if (!view.parent) return `workspace: join ${v.parent.rel}`;
    const linked = chain(projectRoot, { env, maxDepth: 1 });
    if (linked.members.length) return null;
    if (realKey(path.resolve(realOf(projectRoot), ...view.parent.split('/'))) !== realKey(v.parent.root)) return null;
    return linked.notes.some((n) => n.endsWith('does not list this folder as a child')) ? `workspace: join ${v.parent.rel}\trejoin` : null;
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

// Never passed down: the data root and the docs mode are this project's own layout, and a `seed: false` row is set
// only in the launch environment or by hand.
const ENV_NEVER = new Set(['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_DOCS_VERSIONING']);
const HOOKS_OFF = 'ALFRED_CODE_HOOKS_OFF';
const csv = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// What a child's env takes from its parent: `seeds` (the value each not-own key should hold), `force` (the present keys
// whose value differs from its seed) and `own` (the keys the child set itself - sticky once own). `childEnv` is the
// env of the file this run writes, `beneath` the env of the file Claude Code lays it over (a local-scope child's
// settings.json, the team's): a key only there is own, so no parent value is written over it for this machine alone.
function childEnv({ catalog, parentEnv = {}, childEnv: here = {}, beneath = {}, ownPrior, ledgerRows = {}, flagKeys = [], ignores = [] })
{
    const first = ownPrior === null || ownPrior === undefined;
    const own = new Set(first ? [] : ownPrior);
    const ignored = new Set(ignores.filter((i) => i.category === 'env').map((i) => i.name));
    const seeds = {};
    const force = [];
    for (const row of catalog)
    {
        const key = row.key;
        if (ENV_NEVER.has(key) || row.seed === false) continue;
        const present = Object.hasOwn(here, key);
        const value = present ? String(here[key]) : undefined;
        const parentValue = Object.hasOwn(parentEnv, key) ? String(parentEnv[key]) : String(row.default);
        if (flagKeys.includes(key)) own.add(key);
        else if (!present && Object.hasOwn(beneath, key)) own.add(key);
        else if (present && !own.has(key))
        {
            const row0 = ledgerRows[key];
            if (first) { if (value !== parentValue) own.add(key); }
            else if (row0) { if (valueHashOf(value) !== row0) own.add(key); }
            else if (value !== String(row.default) && value !== parentValue) own.add(key);
        }
        if (own.has(key)) continue;
        let target = ignored.has(key) ? String(row.default) : parentValue;
        if (key === HOOKS_OFF && !ignored.has(key))
        {
            const whole = csv(here[key] ?? beneath[key]).filter((e) => !e.includes(':'));
            const parts = csv(parentEnv[key]).filter((e) => e.includes(':'));
            target = [...new Set([...whole, ...parts])].join(',');
        }
        seeds[key] = target;
        if (present && value !== target) force.push(key);
    }
    return { seeds, force: force.sort(), own: [...own].sort() };
}
const valueHashOf = (v) => stamp.valueHash(v);

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
function ancestorExcludes(ancestorRoot, { childIgnores = [] } = {})
{
    const { GENERATED_FILES } = require('./selection.js');
    const seeds = require('./seeds.js');
    const { hashItem } = require('./library.js');
    const claudeDir = path.join(ancestorRoot, '.claude');
    const stampFile = path.join(claudeDir, brand.BRAND.stamp);
    const rulesDir = path.join(claudeDir, 'rules');
    const out = [];
    const library = stamp.readLibrary(stampFile);
    for (const name of Object.keys((library && library.rules) || {})) out.push(path.join(rulesDir, `${name}.md`));
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

// ------------------------------------------------------------------ the installer's steps (spec 2.1-2.5)

// The parent's plan-out as JSON, or { why } - absent, unparseable, or one whose run could not see the parent's set.
function readPlan(file)
{
    let plan;
    try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { why: e.code === 'ENOENT' ? 'no plan was written' : 'the plan does not parse' }; }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { why: 'the plan does not parse' };
    if (Number(plan.failures) > 0) return { why: `the plan's run reported ${plan.failures} failure(s)` };
    if (Array.isArray(plan.unreadable) && plan.unreadable.length) return { why: `the plan's run could not read ${plan.unreadable.join(' and ')}` };
    if (plan.blind) return { why: 'the plan is blind - its plugin listing could not be read' };
    return { plan };
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
function prepare({ projectRoot, env = process.env, args, sourceDir, rt = runtime, log = () => {}, note = () => {}, tmpDir = os.tmpdir() })
{
    const read = stamp.stampFiles({ projectRoot }).read;
    const base = { on: true, parent: null, members: [], ignores: [], parentLines: null, ownPrior: read ? stamp.readOwnPicks(read) : null, ownEnvPrior: read ? stamp.readOwnEnv(read) : null, parentEnv: {} };
    if (args.action === 'uninstall' || !workspaceOn({ env, projectRoot })) return { ...base, on: false };
    const checked = args.dataPath ? dataRootMod.checkDataPath(args.dataPath) : null;
    const ownDataRoot = checked && checked.ok ? checked.value : undefined;
    const own = readWorkspace(projectRoot, { env, dataRoot: ownDataRoot });
    const where = own.file ? relPosix(realOf(projectRoot), own.file) : 'the workspace file';
    for (const raw of own.view.unknown) log(`  !! workspace: ${where} line '${raw}' is not understood - left as it is`);
    const { members, notes } = chain(projectRoot, { env, ownDataRoot });
    for (const n of notes) log(`  ${n}`);
    const at = { ...base, members, ignores: own.view.ignores };
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
    at.parentEnv = settingsEnv(parent.root);
    return at;
}

// The run's set as `<category> <name>` lines, from the lists it installs.
function listLines(lists)
{
    const { CATEGORY } = require('./selection.js');
    return uniqSorted(Object.entries(CATEGORY).flatMap(([key, c]) => (lists[key] || []).map((e) => `${c.line} ${c.name(e)}`)));
}

// Before the settings pass: a joined child whose parent was read gets the parent's env as seeds and forces
// (childEnv); any other run leaves `workspaceEnv` null, so the env layer runs as a standalone one would - a force
// against an unread parent would reset every inherited value to its catalog default.
function envStep(ctx)
{
    const w = ctx.workspace;
    ctx.workspaceEnv = null;
    ctx.workspaceOwnEnv = null;
    if (!w || !w.on || !w.parentLines) return;
    const local = ctx.args.scope === 'local';
    const target = local ? 'settings.local.json' : 'settings.json';
    const envIn = (name) => { const data = readJson(path.join(ctx.claudeDir, name)); return data && data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {}; };
    const catalog = (readJson(path.join(ctx.source.dir, 'meta', 'environment.json')).env) || [];
    const flagKeys = [ctx.args.memory && 'ALFRED_CODE_MEMORY', ctx.args.docsVersioning && 'ALFRED_CODE_DOCS_VERSIONING', ctx.args.autoCompact && 'ALFRED_CODE_AUTO_COMPACT'].filter(Boolean);
    const r = childEnv({
        catalog, parentEnv: w.parentEnv, childEnv: envIn(target), beneath: local ? envIn('settings.json') : {},
        ownPrior: w.ownEnvPrior, ledgerRows: ((ctx.ledger && ctx.ledger.env) || {})[target] || {}, flagKeys, ignores: w.ignores,
    });
    ctx.workspaceEnv = { seeds: r.seeds, force: r.force };
    ctx.workspaceOwnEnv = r.own;
}

// After the settings pass: the excludes for every stamped folder above (joined or not), then the own lines. It never
// writes a `child` line into a parent - the back-reference is the consent record. Frozen, it touches nothing: the
// member rows still present are carried by the ledger, and so are the own lines. Returns { created } - true when the
// excludes made settings.local.json, which the caller names when git does not ignore it.
function workspaceStep(ctx)
{
    const w = ctx.workspace || { on: false, members: [], ownPrior: null, ownEnvPrior: null };
    ctx.ownPicks = w.ownPrior;
    ctx.ownEnv = w.ownEnvPrior;
    if (!w.on) return { created: false };
    const want = excludeGlobs(stampedAncestors(ctx.projectRoot, { env: ctx.env }).flatMap((root) => ancestorExcludes(root, { childIgnores: w.ignores })), process.platform);
    const prior = ((ctx.ledger && ctx.ledger.settings) || {})['settings.local.json'] || {};
    const { syncMembers, MEMBER_PATH } = require('./settings.js');
    // A standalone project - nothing stamped above, no excludes recorded - leaves settings.local.json alone.
    const recorded = Object.keys(prior).some((row) => { const m = MEMBER_PATH.exec(row); return m && m[1] === 'claudeMdExcludes'; });
    const r = want.length || recorded
        ? syncMembers({ file: path.join(ctx.claudeDir, 'settings.local.json'), arrayPath: 'claudeMdExcludes', want: uniqSorted(want), prior, log: ctx.log, note: ctx.note })
        : { rows: {}, created: false };
    ctx.workspaceRows = r.rows;
    if (w.members.length)
    {
        const final = listLines(ctx.lists);
        ctx.ownPicks = w.parentLines || w.ownPrior !== null
            ? ownPicksAfter({ prior: w.ownPrior, final, parentLines: w.parentLines, added: ctx.userAdds || [], blind: Boolean(ctx.workspaceBlind) })
            : null;
        if (ctx.workspaceOwnEnv) ctx.ownEnv = ctx.workspaceOwnEnv;
    }
    return { created: Boolean(r.created) };
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

// The file written back in its own shape: the indent of its first indented line, its line ending, its BOM - through a
// temp file beside it and a rename.
function writeLike(file, text, data)
{
    const indentLine = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => /^[ \t]+\S/.test(l));
    const indent = indentLine ? indentLine.match(/^[ \t]+/)[0] : '  ';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = `${text.startsWith('\uFEFF') ? '\uFEFF' : ''}${JSON.stringify(data, null, indent).split('\n').join(eol)}${eol}`;
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(tmp, body); fs.renameSync(tmp, file); }
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

module.exports = {
    CATEGORIES, workspaceOn, parseWorkspace, renderWorkspace, viewOf,
    setParent, addChild, removeChild, addIgnore, removeIgnore,
    ancestorEnv, workspacePath, readWorkspace, writeWorkspace, moveWorkspace,
    realKey, findParent, sameRepo, isCheckout, joinVerdict, joinLine, chain, subtree, rescan,
    planLines, effectiveLists, delta, ownPicksAfter, childEnv, stampedAncestors, ancestorExcludes, excludeGlobs,
    readPlan, prepare, listLines, envStep, workspaceStep,
    INSTRUCTION_KEY, accountPaths, claudeMdAbove, accountStamps, instructionsBothState, instructionsBothLine, applyAccountInstructions, removeAccountInstructions, lastHolder,
};
