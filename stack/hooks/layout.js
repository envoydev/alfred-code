'use strict';
// layout.js - THE ONE HOME of the 2.8.0 data-root layout (the user's rulings of 2026-10-20). The data root holds
// three things, grouped by who writes them and whether they are committed:
//   <data root>/docs/         what the project is - committed when ALFRED_CODE_DOCS_VERSIONING is git
//   <data root>/state/        the hooks' live state - approvals/ (what the user said yes to), sessions/ (scratch
//                             for running sessions) and history/ (one record per session); never committed
//   <data root>/statistics/   the ledgers - hook-blocks/, tools-usage/, usage-report/, docs-log.jsonl; never committed
// Before 2.8.0 all of it sat under the docs root. The core plugin updates its hooks itself, while the folders move
// only when /alfred-code:update runs, so a hook WRITES the new path and READS the new path first, the old one second
// (findState / findStats / planDirs) - for the rest of the 2.x line; the fallback goes in 3.0. LAYOUT_MOVES is the
// move map the installer applies (scripts/install/docs.js migrateLayout). Only Node's own modules are required (fs, path,
// os): the engines copy this file beside themselves (HOOK_ENGINES) and load it with no prelude.
const fs = require('fs');
const os = require('os');
const path = require('path');

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset (env-reader in meta/shared-rules.json pins the copies).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}

// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred - a relative value
// checkDataPath refuses reads as .alfred, an absolute one (a harness's scratch, which the installer refuses) is kept.
const dataRoot = (env = process.env) => { const raw = String(envOf(env, 'DATA_PATH') || '').trim().replace(/\\/g, '/'); if (/^(?:\/|[A-Za-z]:\/)/.test(raw)) return raw.replace(/\/+$/, '') || '.alfred'; const v = raw.replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, ''); return v && !/\s|[$%`"'*?<>|:]|(?:^|\/)\.{1,2}(?:\/|$)|^\.(?:claude|git)(?:\/|$)/.test(v) ? v : '.alfred'; };
const docsRoot = (env = process.env) => envOf(env, 'DOCS_PATH') || `${dataRoot(env)}/docs`;

// A receipt the user's yes writes (the approval, the commit and push gates, every *-ALLOW) is an approval; every
// other file the hooks kept in the old flow/ is session scratch.
const APPROVAL_NAME = /^(?:APPROVAL|COMMIT-GATE|PUSH-GATE|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-ALLOW)$/;
const flowKind = (name) => (APPROVAL_NAME.test(String(name)) ? 'approvals' : 'sessions');

const STATE_KINDS = new Set(['approvals', 'sessions', 'history', 'forge', 'handoff']);
const kindOf = (kind) =>
{
    if (!STATE_KINDS.has(kind)) throw new Error(`layout: unknown state kind '${kind}'`);
    return kind;
};

const statePath = (root, kind, name, env = process.env) => path.resolve(root, dataRoot(env), 'state', kindOf(kind), name);
const statsPath = (root, parts, env = process.env) => path.resolve(root, dataRoot(env), 'statistics', ...parts);
const legacyStatePath = (root, kind, name, env = process.env) =>
    path.resolve(root, docsRoot(env), kindOf(kind) === 'history' ? 'history' : 'flow', name);
const legacyStatsPath = (root, parts, env = process.env) => path.resolve(root, docsRoot(env), ...parts);

const exists = (file) =>
{
    try { return fs.existsSync(file); }
    catch { return false; }
};
// The new path when it exists, else the old one when IT exists, else the new path (where a write would go).
const pick = (fresh, legacy) => (exists(fresh) || !exists(legacy) ? fresh : legacy);
const findState = (root, kind, name, env = process.env) => pick(statePath(root, kind, name, env), legacyStatePath(root, kind, name, env));
const findStats = (root, parts, env = process.env) => pick(statsPath(root, parts, env), legacyStatsPath(root, parts, env));

// Where a plan file lives: work/plans/, and the pre-2.8.0 plans/ for the 2.x line.
const planDirs = (root, env = process.env) => [path.resolve(root, docsRoot(env), 'work', 'plans'), path.resolve(root, docsRoot(env), 'plans')];

// PER-PLAN APPROVALS (2026-10-20): an implementer brief names its plan on a `plan: <id>` line, and only that plan's
// stamp, <data root>/state/approvals/<id>/APPROVAL, passes it - one APPROVAL for the project let a second session's plan
// dispatch on the first one's yes. The id is the plan file's name without `.md`, or a run's own id; a path or a file
// name on the line is reduced to it. undefined: no line (a pre-2.8.0 brief); null: a line holding no valid id.
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function planIdOf(text)
{
    const line = /^plan:[ \t]*(.*)$/m.exec(String(text || ''));
    if (!line) return undefined;
    const value = line[1].trim();
    const name = value.split(/[\\/]/).pop().replace(/\.md$/i, '');
    return value && !/\s/.test(value) && PLAN_ID.test(name) ? name : null;
}
const approvalPath = (root, planId, env = process.env) =>
{
    if (planId === undefined || planId === null || planId === '') return statePath(root, 'approvals', 'APPROVAL', env);
    if (!PLAN_ID.test(String(planId))) throw new Error(`layout: '${planId}' is no plan id (${PLAN_ID.source})`);
    return statePath(root, 'approvals', path.join(String(planId), 'APPROVAL'), env);
};
// The root stamp and every plan's, the ones that exist, root first then by plan id.
function approvalStamps(root, env = process.env)
{
    const dir = statePath(root, 'approvals', '', env);
    const out = [];
    if (exists(path.join(dir, 'APPROVAL'))) out.push(path.join(dir, 'APPROVAL'));
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return out; }
    for (const e of entries.filter((d) => d.isDirectory() && PLAN_ID.test(d.name)).map((d) => d.name).sort())
    {
        const file = path.join(dir, e, 'APPROVAL');
        if (exists(file)) out.push(file);
    }
    return out;
}

// The move map, `from` relative to the docs root; `to` relative to `base` - the data root or the docs root.
const COVERAGE_RENAME = Object.freeze({ 'COVERAGE.md': 'COVERAGE-QUALITY.md', raw: 'coverage-raw' });
// The architecture map's home since the capture-awareness merge (2026-10-29): the map and its ORIENTATION take awareness
// names, the rest keep theirs; watch.json is no entry, so the mover merges it into awareness's on its own.
const ARCH_RENAME = Object.freeze({
    'ARCHITECTURE.md': 'ARCHITECTURE-AWARENESS.md', 'ORIENTATION.md': 'ARCHITECTURE-ORIENTATION-AWARENESS.md', 'BRANCH-DELTA.md': 'BRANCH-DELTA.md',
    references: 'references', history: 'history',
});
// Which file is the project's run book (the project split, 2026-10-29): the new name, else the old one an install not
// yet updated holds, else the new name (nothing captured yet). One home for the code's readers; docs.js re-exports it,
// and awareness-state.js keeps its own two-name list, held to this one by a test.
function runBookKey(docsDir)
{
    const has = (key) => exists(path.join(docsDir, 'awareness', `${key}.md`));
    return has('RUN-AND-DEBUG-AWARENESS') || !has('PROJECT-AWARENESS') ? 'RUN-AND-DEBUG-AWARENESS' : 'PROJECT-AWARENESS';
}
const LAYOUT_MOVES = Object.freeze([
    { from: 'flow', base: 'data', split: 'flow' },
    { from: 'history', base: 'data', to: 'state/history' },
    { from: 'hook-blocks', base: 'data', to: 'statistics/hook-blocks' },
    { from: 'tools-usage', base: 'data', to: 'statistics/tools-usage' },
    { from: 'usage-report', base: 'data', to: 'statistics/usage-report' },
    { from: 'docs-log.jsonl', base: 'data', to: 'statistics/docs-log.jsonl', file: true },
    { from: 'plans', base: 'docs', to: 'work/plans' },
    { from: 'specs', base: 'docs', to: 'work/specs' },
    { from: 'diagnoses', base: 'docs', to: 'work/diagnoses' },
    { from: 'cross-project-tasks', base: 'docs', to: 'work/cross-project-tasks' },
    { from: 'related-context', base: 'docs', to: 'work/cross-project-tasks' },
    // The coverage doc's home since capture-quality (2026-10-29): a 2.8+ install moves from quality/test-coverage/, an
    // older one straight from test-coverage/ - the 2.8 row first, so its doc wins where both homes exist. `rename` maps
    // the first segment under `from` to its name under `to`; an entry it does not name stays, named in the log.
    { from: 'quality/test-coverage', base: 'docs', to: 'quality', rename: COVERAGE_RENAME },
    { from: 'test-coverage', base: 'docs', to: 'quality', rename: COVERAGE_RENAME },
    { from: 'loops', base: 'docs', to: 'quality/loops' },
    { from: 'tutorial', base: 'docs', to: 'explanations' },   // the explainer's folder (item 6, 2026-10-25)
    // The architecture map's home since the capture-awareness merge (2026-10-29). LINT ONLY: lint 65 names the old home
    // with its renames, migrateLayout skips the row, and docs.migrateArchitecture moves the folder with its watch merge,
    // overlays and refs - one mover.
    { from: 'architecture', base: 'docs', to: 'awareness', rename: ARCH_RENAME, lintOnly: true },
    { from: '.branches', removeIfEmpty: true },
].map(Object.freeze));

// THE PROJECT A FOLDER BELONGS TO (moved here from the retired memory engine, 2026-10-24). The launch directory of a
// command or a seat's Bash, bounded the way hook-prelude's set-up gate reads a folder: the checkout is the git top level
// (gitTopOf), or the nearest folder between the start and that top level holding the install record; with no git it is
// the start alone. Nothing above the checkout's top level is read - a record planted in a shared ancestor would redirect
// the state (T1). A home directory is never passed: its .claude/ is the account dir.
//   checkout  the folder the session works in.
//   project   the install the checkout belongs to - in a linked worktree the main checkout whenever that one holds a record,
//             so a seat in a worktree writes the state the main session and the next seat read.
const INSTALL_RECORDS = [['alfred-code.stamp'], ['hooks', 'docs.js']];
const holdsRecord = (dir) => INSTALL_RECORDS.some((r) => fs.existsSync(path.join(dir, '.claude', ...r)));

function realpathOrSelf(p)
{
    try { return fs.realpathSync.native(p); } catch { /* not there */ }
    try { return fs.realpathSync(p); } catch { /* not there */ }
    // Not created yet: its deepest existing folder resolved natively, the rest re-attached (an 8.3 parent kept short
    // while its project resolved long - 2.1.7, the windows-2025 job).
    const abs = path.resolve(p);
    const rest = [];
    for (let dir = abs; ;)
    {
        const up = path.dirname(dir);
        if (up === dir) return abs;
        rest.unshift(path.basename(dir));
        dir = up;
        try { return path.join(fs.realpathSync.native(dir), ...rest); } catch { /* keep climbing */ }
    }
}
// The form two directory spellings are compared in: folded on Windows, where names are case-insensitive.
const dirKey = (p) => { const r = realpathOrSelf(p); return path.sep === '\\' ? r.toLowerCase() : r; };

// The main checkout of a linked worktree (a `.git` FILE naming `<main>/.git/worktrees/<n>`), read from the files alone.
function worktreeMain(top)
{
    try
    {
        // A `.git` folder is a main checkout: no read (a hook start pays for the throw).
        if (!fs.statSync(path.join(top, '.git'), { throwIfNoEntry: false })?.isFile()) return null;
        const line = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(top, '.git'), 'utf8'));
        if (!line) return null;
        const gitdir = path.resolve(top, line[1]);
        let common = null;
        try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); }
        catch { if (path.basename(path.dirname(gitdir)) === 'worktrees') common = path.dirname(path.dirname(gitdir)); }
        return common && path.basename(common) === '.git' ? path.dirname(common) : null;
    }
    catch { return null; }
}

// The checkout's git top level: the first folder at or above `from` holding a `.git`, '' when a home or '/' comes first.
// A `.git` another user owns is no repository (git(1) SECURITY, safe.directory). `uid` is null where the platform has none.
const ownUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);
function gitTopOf(from, { home = require('os').homedir(), uid = ownUid() } = {})
{
    const homeKey = dirKey(home);
    for (let at = from; ;)
    {
        if (dirKey(at) === homeKey) return '';
        let git = null;
        try { git = fs.statSync(path.join(at, '.git'), { throwIfNoEntry: false }) || null; } catch { /* not this level */ }
        if (git) return uid === null || git.uid === uid ? at : '';
        const up = path.dirname(at);
        if (up === at) return '';
        at = up;
    }
}

function projectRootOf(start, { home = require('os').homedir() } = {})
{
    const from = path.resolve(start || process.cwd());
    const top = gitTopOf(from, { home });
    if (!top) return { checkout: from, project: from };
    let checkout = top;
    for (let at = from; at !== top; at = path.dirname(at)) if (holdsRecord(at)) { checkout = at; break; }
    const main = worktreeMain(top);
    if (main) for (const at of [path.join(main, path.relative(top, checkout)), main]) if (holdsRecord(at)) return { checkout, project: at };
    return { checkout, project: checkout };
}

// ---- the workspace chain (workspace layering, release 2) -------------------------------------------------------------
// The hook-side twin of scripts/install/workspace.js chain(): the hooks cannot require the installer, so the same files
// are read here with Node's own modules alone. scripts/layout-workspace.test.js holds the two equal on every tree, and
// the two readers below are byte-for-byte copies of stack/mcp/data-root.js's (data-path-setting in meta/shared-rules.json).

// One ALFRED_CODE_<suffix> setting as a script outside a session sees it: the shell env, then this machine's file before
// the shared one, then the account's.
function settingFrom({ env, projectDir, suffix })
{
    const read = (e) => envOf(e, suffix);
    const own = String(read(env) || '').trim();
    if (own || !projectDir) return own;
    const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const file of [
        path.join(projectDir, '.claude', 'settings.local.json'),
        path.join(projectDir, '.claude', 'settings.json'),
        path.join(account, 'settings.json'),
    ])
    {
        try
        {
            const value = String(read((JSON.parse(fs.readFileSync(file, 'utf8')) || {}).env || {}) || '').trim();
            if (value) return value;
        }
        catch { /* absent, unreadable or malformed: the next file answers */ }
    }
    return '';
}

// The data root a setting names, or why it is refused.
function checkDataPath(raw)
{
    const value = String(raw ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (!value) return { ok: false, why: 'the data root is empty' };
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return { ok: false, why: `${value} is absolute - the data root is a folder inside the project` };
    if (/\s/.test(value)) return { ok: false, why: `${value} holds a space - the navigation server's home reaches cmd.exe unquoted on Windows` };
    if (/[$%`"'*?<>|:]/.test(value)) return { ok: false, why: `${value} holds a character a shell or a server placeholder would read` };
    const parts = value.split('/');
    if (parts.some((p) => p === '.' || p === '..')) return { ok: false, why: `${value} has a . or .. segment - the data root stays inside the project` };
    if (parts[0] === '.claude') return { ok: false, why: `${value} is under .claude/, where Claude Code prompts for every write` };
    if (parts[0] === '.git') return { ok: false, why: `${value} is under .git/` };
    return { ok: true, value };
}

// The data root in effect for a folder: its setting when usable, else .alfred.
function dataRootOf(root, { env = process.env } = {})
{
    const raw = settingFrom({ env, projectDir: root, suffix: 'DATA_PATH' });
    const checked = raw ? checkDataPath(raw) : { ok: false };
    return checked.ok ? checked.value : '.alfred';
}

const WS_CATEGORIES = ['skill', 'agent', 'rule', 'hook', 'plugin', 'env', 'mcp', 'secret', 'doc', 'instructions'];
const WS_NAME = /^[A-Za-z0-9._-]+$/;
const WS_PATH_NAME = /^[A-Za-z0-9._\/-]+$/;
const wsSegmentsOk = (value) => value.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
// One workspace line as { key, kind, value } - workspace.js parseLine's reading; an unknown line has no key.
function wsLine(raw)
{
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return { kind: 'comment' };
    const [word, ...rest] = line.split(/\s+/);
    // The text after the keyword and its separators, inner whitespace kept - parseLine's reading (R062): a child named
    // `a  b` read as `a b` never matched its back-reference, so the hooks saw no chain for it.
    const value = line.slice(word.length).replace(/^\s+/, '');
    if (word === 'parent')
    {
        if (value === 'none') return { key: 'parent', kind: 'parent-none', raw: line };
        if (/^\.\.(\/\.\.)*$/.test(value)) return { key: 'parent', kind: 'parent', value, raw: line };
    }
    else if (word === 'role')
    {
        if (value === 'root' || value === 'standalone') return { key: 'role', kind: 'role', value };
    }
    else if (word === 'above')
    {
        if (value === 'none' || /^\.\.(\/\.\.)*$/.test(value)) return { key: 'above', kind: 'above', value };
    }
    else if (word === 'child')
    {
        if (value !== '' && !value.startsWith('/') && !/[:\\]/.test(value) && wsSegmentsOk(value)) return { key: `child ${value}`, kind: 'child', value };
    }
    else if (word === 'ignore' && rest.length === 2)
    {
        const [category, name] = rest;
        const fixed = (category === 'docs' || category === 'memory') && name === 'root';
        const named = WS_CATEGORIES.includes(category) && (WS_NAME.test(name)
            || ((category === 'doc' || category === 'instructions') && WS_PATH_NAME.test(name) && wsSegmentsOk(name)));
        if (fixed || named) return { key: `ignore ${category} ${name}`, kind: 'ignore', category, name };
    }
    return { kind: 'unknown' };
}
// A workspace file's view, { parent, children, ignores }: a BOM dropped, CRLF as LF, a repeated entry kept at its first
// spelling (workspace.js parseWorkspace and viewOf); an unreadable or absent file is an empty view.
function wsView(file)
{
    const view = { parent: null, children: [], ignores: [] };
    let text = '';
    try { if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return view; text = fs.readFileSync(file, 'utf8'); } catch { return view; }
    const seen = new Set();
    for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/))
    {
        const e = wsLine(raw);
        if (!e.key || seen.has(e.key)) continue;
        seen.add(e.key);
        if (e.kind === 'parent') view.parent = e.value;
        else if (e.kind === 'child') view.children.push(e.value);
        else if (e.kind === 'ignore') view.ignores.push({ category: e.category, name: e.name });
    }
    return view;
}
const wsFile = (root, env) => path.join(root, ...dataRootOf(root, { env }).split('/'), 'workspace');
const wsReal = (p) =>
{
    try { return fs.realpathSync.native(p); }
    catch { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
};
// workspace.js realKey: the real path, `/` separated, case-folded on darwin and win32.
const wsKey = (p) =>
{
    const key = wsReal(p).split(path.sep).join('/');
    return process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key;
};
const wsRel = (from, to) => path.relative(from, to).split(path.sep).join('/');
const wsIsDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

// The switch, ALFRED_CODE_WORKSPACE: on by default since 3.0.0, off only at `0` - a launch `0` freezes it, else the
// loader's steps 2 to 4 (settings.local.json, the project's .variables, the settings env over the launch env), so a file
// `0` beats a launch `1`; never a member's file.
// install/workspace.js workspaceOn calls this one.
function workspaceOn({ env = {}, projectRoot })
{
    if (String(env.ALFRED_CODE_WORKSPACE) === '0') return false;
    return switchValueOn(ownLayers(projectRoot, env).values[SWITCH_KEY]);
}

// The project's own workspace file: its parent line and its ignore lines.
function ownWorkspace(projectRoot, { env = process.env } = {})
{
    const view = wsView(wsFile(wsReal(projectRoot), env));
    return { parent: view.parent, ignores: view.ignores };
}

// The linked members above a project, nearest first: { members: [{ root, rel, dataRoot, ignores }], notes, ignores } -
// `ignores` the project's own workspace file's, read once for the loader; `startData` the start's data root when the
// caller already read it. A hop needs
// a strict ancestor holding a stamp whose workspace file lists this folder as a child (workspace.js chain()). An
// ancestor's data root is read with the account alone, never the run's ALFRED_CODE_DATA_PATH. The kill switch is the
// caller's to apply: this reads the chain whatever it says.
function workspaceChain(projectRoot, { env = process.env, maxDepth = 8, startData } = {})
{
    // Each folder's real path and key once per walk: a hop's parent is the next hop's current, and the realpath call is
    // most of a hop's cost (the loader walks this on every hook start).
    const reals = new Map();
    const realOf = (p) => { if (!reals.has(p)) reals.set(p, wsReal(p)); return reals.get(p); };
    const keyOf = (p) =>
    {
        const key = realOf(p).split(path.sep).join('/');
        return process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key;
    };
    const start = realOf(projectRoot);
    const upEnv = { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR };
    const members = [];
    const notes = [];
    const seen = new Set([keyOf(start)]);
    let current = start;
    let file = startData ? path.join(start, ...startData.split('/'), 'workspace') : wsFile(start, env);
    let view = wsView(file);
    const startIgnores = view.ignores;
    while (members.length < maxDepth && view.parent)
    {
        const value = view.parent;
        const refuse = (why) => notes.push(`!! workspace: parent ${value} in ${wsRel(start, file)} ignored - ${why}`);
        const parent = path.resolve(current, ...value.split('/'));
        const label = wsRel(start, parent) || '.';
        if (!wsIsDir(parent)) { refuse(`${label} is missing`); break; }
        const up = path.relative(keyOf(parent), keyOf(current));
        if (!up || up.startsWith('..') || path.isAbsolute(up)) { refuse(`${label} is not a folder above this one`); break; }
        if (!fs.existsSync(path.join(parent, '.claude', 'alfred-code.stamp'))) { refuse(`${label} holds no Alfred install`); break; }
        const parentData = dataRootOf(parent, { env: upEnv });
        const parentFile = path.join(parent, ...parentData.split('/'), 'workspace');
        const parentView = wsView(parentFile);
        if (!parentView.children.some((c) => keyOf(path.join(parent, ...c.split('/'))) === keyOf(current)))
        {
            refuse(`${label} does not list this folder as a child`);
            break;
        }
        const key = keyOf(parent);
        if (seen.has(key)) { refuse(`${label} is already in the chain`); break; }
        seen.add(key);
        members.push({ root: realOf(parent), rel: label, dataRoot: parentData, ignores: parentView.ignores });
        current = parent;
        file = parentFile;
        view = parentView;
    }
    return { members, notes, ignores: startIgnores };
}

// ---- the stack's variables (workspace roles and variables, D3 / D4) --------------------------------------------------
// `<data root>/.variables` holds the stack's ALFRED_CODE_* values, one KEY=value per line, read in ONE nearest-wins order:
// a launch `0` of the switch, the project's settings.local.json (a machine-local value kept from 2.x), the project's own
// file, the process env, then each linked member's file while the switch is on. applyVariables sets each winner on the
// process env once, so every envOf copy reads it unchanged.

// The catalog keys a `.variables` line may set: meta/environment.json's rows but the data root (the file cannot name its
// own place) and the hook switch-offs (D7: they stay in the settings Claude Code protects). Inline because meta/ never
// ships into a project; layout-variables.test.js holds it to the catalog.
const VARIABLE_KEYS = Object.freeze([
    'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_INSTRUMENT', 'ALFRED_CODE_CORRECTION_NUDGE', 'ALFRED_CODE_TURN_CHECK',
    'ALFRED_CODE_SCORER', 'ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_SCORER_OUTPUTS', 'ALFRED_CODE_SCORER_ROUNDS',
    'ALFRED_CODE_HISTORY', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K',
    'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K', 'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT', 'ALFRED_CODE_AUTO_COMPACT',
    'ALFRED_CODE_MAXIMUM_RUN_AGENTS', 'ALFRED_CODE_MEMORY', 'ALFRED_CODE_FRESH_SESSION_AFTER_HOURS',
    'ALFRED_CODE_FRESH_SESSION_PAYBACK', 'ALFRED_CODE_FORGE_WATCH', 'ALFRED_CODE_WORKSPACE',
]);
const VARIABLE_SET = new Set(VARIABLE_KEYS);
// Never taken from a member: the docs mode is this project's own layout (release 1's ENV_NEVER), and the chain cannot
// decide the switch that gates it.
const MEMBER_NEVER = new Set(['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_WORKSPACE']);
const HOOKS_OFF_KEY = 'ALFRED_CODE_HOOKS_OFF';
const SWITCH_KEY = 'ALFRED_CODE_WORKSPACE';
// The switch's value as read: off only at `0`, unset included as on (D9).
const switchValueOn = (value) => String(value) !== '0';

// The dotenv reader of the `.secrets` grammar (secret-chain.js reads its stores through it; guard-sensitive-data.test.js
// holds the guard, data-root.js and this to one fixture): optional `export`, quotes stripped, `#` / `;` comments.
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2');
const DOTENV_LINES = /\r?\n/;
const COMMENT_LINE = /^\s*(?:[#;]|$)/;
const swap16 = (buf) => Buffer.from(buf.subarray(0, buf.length - (buf.length % 2))).swap16();
// A file is text in the encoding its writer chose: a BOM decides it; without one, NUL bytes on every other position of
// the first 64 bytes and none on the rest decide UTF-16.
function readText(file)
{
    const buf = fs.readFileSync(file);
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
    if (buf[0] === 0xfe && buf[1] === 0xff) return swap16(buf.subarray(2)).toString('utf16le');
    const head = buf.subarray(0, 64);
    if (head.length >= 4)
    {
        let even = 0;
        let odd = 0;
        for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) odd++; else even++; }
        const half = head.length >> 1;
        if (even === 0 && odd >= half * 0.9) return buf.toString('utf16le');
        if (odd === 0 && even >= half * 0.9) return swap16(buf).toString('utf16le');
    }
    return buf.toString('utf8').replace(/^\uFEFF/, '');
}
// { values, bad } of one dotenv file - `bad` the line numbers that are no KEY=value line; null for no file, a folder or
// a file that cannot be read.
function readDotenv(file)
{
    let text = '';
    try
    {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) return null;
        text = readText(file);
    }
    catch { return null; }
    const values = {};
    const bad = [];
    text.split(DOTENV_LINES).forEach((line, i) =>
    {
        if (COMMENT_LINE.test(line)) return;
        const m = line.match(DOTENV_LINE);
        if (m) values[m[1]] = unquote(m[2]);
        else bad.push(i + 1);
    });
    return { values, bad };
}

// A settings file's `env` object, or null when it is absent, unparseable or holds none.
function settingsEnv(file)
{
    try
    {
        if (!fs.statSync(file, { throwIfNoEntry: false })) return null;
        // A Windows editor's BOM is no reason to drop the file's values (Claude Code reads it).
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        return data && typeof data === 'object' && data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : null;
    }
    catch { return null; }
}
// A set value as envOf reads one: '' (and null) is unset; anything else as text.
// One lookup per key: on process.env each read is a getenv.
const valueIn = (from, key) =>
{
    const value = from && Object.hasOwn(from, key) ? from[key] : undefined;
    return value === '' || value === null || value === undefined ? undefined : String(value);
};
const csvOf = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Keys whose value is a credential - the SAME string as meta/environment.json `secret_key_pattern` (lint check 31 holds
// the copies equal): a file holding one is a credential file to the secret guard, so its note points to the store.
const SECRET_KEY_SOURCE = '(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$';
const SECRET_KEY_RE = new RegExp(SECRET_KEY_SOURCE, 'i');

// What one `.variables` file says beyond its values: each line that is no pair, each key named like a credential (with
// the `.secrets` beside it), and each other ALFRED_CODE_ key the loader never reads from a file (D7). Never a value.
function fileNotes(read, label, secrets)
{
    if (!read) return [];
    const notes = read.bad.map((n) => `!! variables: ${label} line ${n} is not a KEY=value line - not read`);
    for (const key of Object.keys(read.values))
    {
        if (VARIABLE_SET.has(key)) continue;
        if (SECRET_KEY_RE.test(key)) { notes.push(`!! variables: ${key} in ${label} looks like a credential - keep it in ${secrets}`); continue; }
        if (!/^ALFRED_CODE_[A-Za-z0-9_]+$/.test(key)) continue;
        notes.push(key === HOOKS_OFF_KEY
            ? `!! variables: ${HOOKS_OFF_KEY} in ${label} is not read - it lives in .claude/settings.json`
            : `!! variables: ${key} in ${label} is not read - only the stack's variables are; a guard switch stays in .claude/settings.json`);
    }
    return notes;
}

// The main worktree's counterpart of a folder in a linked worktree, or null - the store's fallback (secret-chain.js).
function mainCounterpart(checkout)
{
    try
    {
        const top = gitTopOf(checkout);
        const main = top && worktreeMain(top);
        return main ? path.join(main, path.relative(top, checkout)) : null;
    }
    catch { return null; }
}
// The project's own file: the checkout's, else the main worktree's (a gitignored file a new worktree lacks).
function ownVariables(checkout, env, mainOf, checkoutData)
{
    const fileAt = (place, data = dataRootOf(place, { env })) => path.join(place, ...data.split('/'), '.variables');
    const file = fileAt(checkout, checkoutData);
    const read = readDotenv(file);
    if (read) return { file, read, place: checkout };
    const main = mainOf();
    if (main && dirKey(main) !== dirKey(checkout))
    {
        const other = fileAt(main);
        const otherRead = readDotenv(other);
        if (otherRead) return { file: other, read: otherRead, place: main };
    }
    return { file, read: null, place: checkout };
}

// Steps 1 to 4 for every key - the project alone, what the switch is read from. Step 4 outside a session reads what a
// session lays over its launch env: the project's settings.json, then the account's (in a hook the two agree).
// `layers` 'files' reads the project's own three files alone, 'team' its two shared ones (see variablesOf).
function ownLayers(projectRoot, env, layers = 'all')
{
    const checkout = path.resolve(projectRoot);
    const claude = path.join(checkout, '.claude');
    const all = layers === 'all';
    const local = layers === 'team' ? null : settingsEnv(path.join(claude, 'settings.local.json'));
    const shared = settingsEnv(path.join(claude, 'settings.json'));
    const account = all ? settingsEnv(path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')) : null;
    let main;
    const mainOf = () => (main === undefined ? (main = mainCounterpart(checkout)) : main);
    // dataRootOf's answer from the three files already read (settingFrom's order: the env, local, shared, account).
    const dataPath = [env, local, shared, account].map((e) => String((e && envOf(e, 'DATA_PATH')) || '').trim()).find(Boolean);
    const checked = dataPath ? checkDataPath(dataPath) : { ok: false };
    const dataRoot = checked.ok ? checked.value : '.alfred';
    const own = ownVariables(checkout, env, mainOf, dataRoot);
    const values = {};
    const from = {};
    const notes = fileNotes(own.read, own.place === checkout ? '.variables' : '.variables of the main worktree', `${dataRoot}/.secrets`);
    for (const key of VARIABLE_KEYS)
    {
        if (all && key === SWITCH_KEY && String(env[key]) === '0') { values[key] = '0'; from[key] = 'env'; continue; }
        let value = valueIn(local, key);
        if (value !== undefined)
        {
            values[key] = value;
            from[key] = 'settings.local.json';
            notes.push(`variables: ${key} set in .claude/settings.local.json (it overrides .variables here)`);
            continue;
        }
        value = own.read ? valueIn(own.read.values, key) : undefined;
        if (value !== undefined) { values[key] = value; from[key] = 'own'; continue; }
        value = valueIn(shared, key) ?? valueIn(account, key) ?? (all ? valueIn(env, key) : undefined);
        if (value !== undefined) { values[key] = value; from[key] = 'env'; }
    }
    return { checkout, main: mainOf, dataRoot, local, shared, values, from, notes };
}

// The whole read: every key's winner, where it came from, the notes, and the merged HOOKS_OFF csv (D4): the project's
// entries (settings.local.json over settings.json, R99) plus each member's `<hook>:<part>` entries - a member's
// whole-hook entry never reaches a child (release 1) - up to an `ignore env ALFRED_CODE_HOOKS_OFF`.
function resolveVariables(projectRoot, env, which = 'all')
{
    const layers = ownLayers(projectRoot, env, which);
    const { values, from, notes } = layers;
    const hooksOffAt = (local, shared) => csvOf(local && Object.hasOwn(local, HOOKS_OFF_KEY) ? local[HOOKS_OFF_KEY] : (shared || {})[HOOKS_OFF_KEY]);
    const hooksOff = hooksOffAt(layers.local, layers.shared);
    if (which === 'all' && switchValueOn(values[SWITCH_KEY]))
    {
        const project = layers.main() || layers.checkout;
        const chain = workspaceChain(project, { env, startData: project === layers.checkout ? layers.dataRoot : undefined });
        const skip = new Set(chain.ignores.filter((i) => i.category === 'env').map((i) => i.name));
        for (const member of chain.members)
        {
            const file = path.join(member.root, ...member.dataRoot.split('/'), '.variables');
            const read = readDotenv(file);
            notes.push(...fileNotes(read, `.variables of ${member.rel}`, `${member.rel}/${member.dataRoot}/.secrets`));
            for (const key of VARIABLE_KEYS)
            {
                if (values[key] !== undefined || MEMBER_NEVER.has(key) || skip.has(key) || !read) continue;
                const value = valueIn(read.values, key);
                if (value !== undefined) { values[key] = value; from[key] = member.rel; }
            }
            if (!skip.has(HOOKS_OFF_KEY))
            {
                const claude = path.join(member.root, '.claude');
                hooksOff.push(...hooksOffAt(settingsEnv(path.join(claude, 'settings.local.json')), settingsEnv(path.join(claude, 'settings.json'))).filter((e) => e.includes(':')));
            }
            for (const i of member.ignores) if (i.category === 'env') skip.add(i.name);
        }
    }
    return { values, from, notes, hooksOff: [...new Set(hooksOff)].join(',') };
}

// `layers`: 'all' (the D4 order, what a hook reads), 'files' (the project's settings.local.json, .variables and
// settings.json - no account file, process env or member: a session's env carries settings.local.json's values, so a
// script deciding what a file holds reads the files) or 'team' (the two files a teammate shares, no settings.local.json).
function variablesOf(projectRoot, { env = process.env, layers = 'all' } = {})
{
    const { values, from, notes } = resolveVariables(projectRoot, env, layers);
    return { values, from, notes };
}
const hooksOffOf = (projectRoot, { env = process.env } = {}) => resolveVariables(projectRoot, env).hooksOff;

// Each winner set on `env` once per env object (a second call returns []); the HOOKS_OFF csv becomes the union of what
// `env` holds (a launch or account switch-off) and the merge - an entry is only ever added. Returns the keys set.
const APPLIED = new WeakSet();
function applyVariables(projectRoot, env = process.env)
{
    if (APPLIED.has(env)) return [];
    APPLIED.add(env);
    const { values, hooksOff } = resolveVariables(projectRoot, env);
    const set = [];
    for (const [key, value] of Object.entries(values)) if (env[key] !== value) { env[key] = value; set.push(key); }
    const held = csvOf(env[HOOKS_OFF_KEY]);
    const union = [...new Set([...held, ...csvOf(hooksOff)])];
    if (union.length > held.length) { env[HOOKS_OFF_KEY] = union.join(','); set.push(HOOKS_OFF_KEY); }
    return set;
}

// ---- release 3: an ancestor's memory folder and docs root, fs/path only ----------------------------------------------
// The managed settings file per OS - a twin of scripts/install/workspace.js managedSettingsFile, which no hook requires.
function managedSettingsFile(platform = process.platform, env = process.env)
{
    if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
    if (platform === 'win32') return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json');
    return '/etc/claude-code/managed-settings.json';
}
const readObject = (file) =>
{
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
    catch { return null; }
};
// R6: `autoMemoryDirectory` where Claude Code reads it first - the managed drop-ins (merged after the file in alphabetical
// order, so the last wins), the managed file, the member's settings.local.json, its settings.json, the account's.
// `trusted` reads only the files a cloned repo cannot ship - the managed ones, the account's, and the settings.local.json
// Claude Code reads (localSettingsFile) when `untracked(file)` vouches for it. The untrusted read takes that same file
// first, then a leftover in the start folder, then settings.json (E-batch 300-memdirs: a session started in a sub-folder
// read the start folder's file alone, while Claude Code reads the repo root's - the main checkout's for a worktree).
function autoMemorySetting(root, { account, home, managed, trusted = false, untracked = () => false, platform = process.platform })
{
    const dropDir = path.join(path.dirname(managed), 'managed-settings.d');
    let drops = [];
    try { drops = fs.readdirSync(dropDir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort().reverse().map((n) => path.join(dropDir, n)); }
    catch { /* no drop-in folder */ }
    const local = trusted ? localSettingsFile(root, { home, platform }) : path.join(root, '.claude', 'settings.local.json');
    const rootLocal = trusted ? null : localSettingsFile(root, { home, platform });
    const project = trusted ? (local ? [local] : []) : [...new Set([rootLocal, local].filter(Boolean)), path.join(root, '.claude', 'settings.json')];
    for (const file of [...drops, managed, ...project, path.join(account, 'settings.json')])
    {
        const value = (readObject(file) || {}).autoMemoryDirectory;
        if (typeof value !== 'string' || !value.trim()) continue;
        const v = value.trim();
        // Claude Code takes an absolute path or one starting `~/` alone (memory docs): any other value is no setting.
        const dir = /^~[\\/]/.test(v) ? path.join(home, v.slice(2)) : path.isAbsolute(v) ? path.resolve(v) : null;
        if (!dir || (trusted && file === local && !untracked(local))) continue;
        return dir;
    }
    return null;
}
// The folder Claude Code keeps a project's auto memory in (A5, docs/workspace-layering-evidence.md): the setting, else
// `<account>/projects/<name>/memory`, `<name>` the git top (a worktree's main checkout) with every character outside
// [A-Za-z0-9] as `-`. Past 200 characters Claude Code keeps the first 200 and appends `-<hash>` (memoryNameHash).
// [] when CLAUDE_CODE_PROJECT_DIR_NAME renames the folder and no setting names it.
const MEMORY_NAME_MAX = 200;
// The `<hash>` (R068, read from Claude Code 2.1.318's own code): base 36 of the absolute Java string hash of the git top
// as Claude Code spells it - UTF-16 code units, 32-bit wrap. One folder per project, so a sibling sharing the first 200
// characters is never taken for it.
function memoryNameHash(p)
{
    let h = 0;
    for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
}
// Claude Code's own rule for that name (code.claude.com/docs/en/sessions, 'Name the project directory yourself', read
// 2026-11-04): only beside CLAUDE_CONFIG_DIR, and only 1-64 letters, digits, - or _ that spell no Windows device name;
// any other value keeps the derived folder (R069).
const WIN_DEVICE_RE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const projectDirNamed = (env) => Boolean(env.CLAUDE_CONFIG_DIR) && /^[A-Za-z0-9_-]{1,64}$/.test(String(env.CLAUDE_CODE_PROJECT_DIR_NAME || '')) && !WIN_DEVICE_RE.test(String(env.CLAUDE_CODE_PROJECT_DIR_NAME));
// The `autoMemoryDirectory` Claude Code applies here, or null: the first read memoryDirsOf makes, with no trust filter.
function memoryDirSetting(root, { env = process.env, home = require('os').homedir(), managed = managedSettingsFile(process.platform, env), platform = process.platform } = {})
{
    return autoMemorySetting(root, { account: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), home, managed, platform });
}
function memoryDirsOf(root, { env = process.env, home = require('os').homedir(), managed = managedSettingsFile(process.platform, env), platform = process.platform } = {})
{
    const set = memoryDirSetting(root, { env, home, managed, platform });
    return set ? [set] : defaultMemoryDirs(root, { env, home, platform });
}
// The folder Claude Code keys a git top's memory by (2.1.318's own rule, R068's review): a linked worktree's main
// checkout only when the worktree's admin folder links back to this `.git` (a worktree moved without `git worktree
// repair` keys by itself), and a bare repository's worktree by the bare folder. Any doubt keys by the top itself.
function memoryKeyOf(top)
{
    try
    {
        const dotGit = path.join(top, '.git');
        if (!fs.lstatSync(dotGit, { throwIfNoEntry: false })?.isFile()) return top;
        const text = fs.readFileSync(dotGit, 'utf8').trim();
        if (!text.startsWith('gitdir:')) return top;
        const regular = (f) => fs.lstatSync(f, { throwIfNoEntry: false })?.isFile();
        const admin = path.resolve(top, text.slice(7).trim());
        if (!regular(path.join(admin, 'commondir'))) return top;
        const common = path.resolve(admin, fs.readFileSync(path.join(admin, 'commondir'), 'utf8').trim());
        if (path.resolve(path.dirname(admin)) !== path.join(common, 'worktrees')) return top;
        if (!regular(path.join(admin, 'gitdir'))) return top;
        const back = fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim();
        if (path.sep === '/' && [top, admin, back, common].some((p) => p.includes('\\'))) return top;
        if (fs.realpathSync(path.resolve(admin, back)) !== path.join(fs.realpathSync(top), '.git')) return top;
        if (path.basename(common) !== '.git') return fs.existsSync(path.join(common, '.git')) ? top : common;
        return path.dirname(common);
    }
    catch { return top; }
}
// The default place alone, whatever a setting names: what docs mode's switch back to default would use (memory P3).
function defaultMemoryDirs(root, { env = process.env, home = require('os').homedir(), platform = process.platform } = {})
{
    const account = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    if (projectDirNamed(env)) return [];
    const top = gitTopOf(root, { home });
    const spelled = realpathOrSelf(top ? memoryKeyOf(top) : root).normalize('NFC');
    const name = spelled.replace(/[^A-Za-z0-9]/g, '-');
    const projects = path.join(account, 'projects');
    if (name.length <= MEMORY_NAME_MAX) return [path.join(projects, name, 'memory')];
    const head = `${name.slice(0, MEMORY_NAME_MAX)}-`;
    const exact = path.join(projects, `${head}${memoryNameHash(spelled)}`, 'memory');
    if (platform !== 'win32') return [exact];
    // Claude Code names the folder from the cwd as TYPED, and on Windows that case need not be the real one (probe A5),
    // so neither the name's case nor its hash is known there: every `<first 200>-*` folder is listed, case ignored - but
    // an ancestor's own computed folder, which a workspace child shares the first 200 with, is never this project's.
    const ancestors = new Set();
    for (let up = path.dirname(spelled); up !== path.dirname(up); up = path.dirname(up))
    {
        if (up.replace(/[^A-Za-z0-9]/g, '-').length <= MEMORY_NAME_MAX) break;
        ancestors.add(`${head}${memoryNameHash(up)}`.toLowerCase());
    }
    let names = [];
    try { names = fs.readdirSync(projects).filter((n) => n.toLowerCase().startsWith(head.toLowerCase()) && n.length > head.length && !ancestors.has(n.toLowerCase())); }
    catch { /* no projects folder yet */ }
    const listed = names.sort().map((n) => path.join(projects, n, 'memory'));
    return listed.some((d) => d.toLowerCase() === exact.toLowerCase()) ? listed : [exact, ...listed];
}
// The settings.local.json Claude Code reads in a git repository (settings docs, 'Where Claude Code keeps the local file
// in a git repository', v2.1.211): the repository root's - a linked worktree's main checkout's - for every sub-folder;
// on Windows the start folder's. Null where no file is vouched for: no repository, one rooted at home (gitTopOf gives
// ''), and a start folder below the top on Windows - a file there may be an archive's, dropped into the repository.
function localSettingsFile(root, { home = require('os').homedir(), platform = process.platform } = {})
{
    const top = gitTopOf(root, { home });
    if (!top) return null;
    if (platform === 'win32') return dirKey(top) === dirKey(root) ? path.join(root, '.claude', 'settings.local.json') : null;
    return path.join(worktreeMain(top) || top, '.claude', 'settings.local.json');
}
// R171: a start folder's settings.local.json that Claude Code 2.1.211+ no longer keeps there (it keeps the file at the
// repository root, localSettingsFile) and that sets autoMemoryDirectory: { file, dir, rootFile }, else null. Claude Code
// still reads the older file while the root one sets no key, but the write guard trusts only the root file, so the
// install, the audit and the guard name the move. Windows keeps the start folder's file: never one there. `dir` is taken
// as autoMemorySetting takes it - absolute or `~/`, a relative value is no setting.
function staleLocalMemory(root, { platform = process.platform, home = require('os').homedir() } = {})
{
    try
    {
        if (platform === 'win32') return null;
        const rootFile = localSettingsFile(root, { home, platform });
        if (!rootFile || dirKey(path.dirname(path.dirname(rootFile))) === dirKey(root)) return null;
        const file = path.join(root, '.claude', 'settings.local.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const value = data && typeof data === 'object' && !Array.isArray(data) ? data.autoMemoryDirectory : null;
        if (typeof value !== 'string' || !value.trim()) return null;
        const v = value.trim();
        const dir = /^~[\\/]/.test(v) ? path.join(home, v.slice(2)) : path.isAbsolute(v) ? path.resolve(v) : null;
        return dir ? { file, dir, rootFile } : null;
    }
    catch { return null; }
}
// Every such file below `top`: a breadth-first walk that enters no .git, no node_modules and no dot-folder but .claude,
// at most `maxDepth` folders down, counting every entry it reads - past `maxEntries` it stops with `cut`.
function staleLocalMemoryFiles(top, { maxEntries = 20000, maxDepth = 6, platform = process.platform, home = require('os').homedir() } = {})
{
    const found = [];
    if (platform === 'win32') return { found, cut: false };
    let seen = 0;
    const queue = [[top, 0]];
    for (let q = 0; q < queue.length; q++)
    {
        const [dir, depth] = queue[q];
        if (depth > 0 && fs.existsSync(path.join(dir, '.claude', 'settings.local.json')))
        {
            const hit = staleLocalMemory(dir, { platform, home });
            if (hit) found.push(hit);
        }
        if (depth >= maxDepth) continue;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries)
        {
            if (++seen > maxEntries) return { found, cut: true };
            if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules' || (e.name.startsWith('.') && e.name !== '.claude')) continue;
            queue.push([path.join(dir, e.name), depth + 1]);
        }
    }
    return { found, cut: false };
}
// The autoMemoryDirectory set where no repo can ship it (the managed settings, the account's, a settings.local.json
// `untracked` vouches for), or null: the folder the write guard may open for the project's own memory. A project's
// settings.json, or a settings.local.json git tracks, can arrive in a clone and name any folder (~/.ssh, a sibling
// repo), so neither is trusted to widen a gate. `untracked` is the caller's: this file spawns nothing.
function trustedMemoryDir(root, { env = process.env, home = require('os').homedir(), managed = managedSettingsFile(process.platform, env), untracked, platform = process.platform } = {})
{
    return autoMemorySetting(root, { account: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), home, managed, trusted: true, untracked, platform });
}
// R2: an ancestor's docs root from its own settings (a leftover ALFRED_CODE_DOCS_PATH, settings.local.json first), never
// the child's env, else `<its data root>/docs` - absolute.
function docsRootOf(root, { env = process.env, dataRoot } = {})
{
    for (const file of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json')])
    {
        const value = ((readObject(file) || {}).env || {}).ALFRED_CODE_DOCS_PATH;
        if (typeof value === 'string' && value.trim()) return path.resolve(root, value.trim());
    }
    const data = dataRoot || dataRootOf(root, { env: { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR } });
    return path.resolve(root, ...data.split('/'), 'docs');
}

// ---- memory P3: Claude Code's own memory in the docs root (ALFRED_CODE_MEMORY=docs) ----------------------------------
// The installer (scripts/install/memory-dir.js), tools.js and the session start read the place, the setting and the
// refusal from here alone, so the three never disagree. Nothing here spawns: the git tracked check is the caller's.

// `<docs root>/memory` of the MAIN checkout, absolute and real: one folder for a checkout and each linked worktree.
function docsMemoryDir(root, { env = process.env } = {})
{
    return realpathOrSelf(path.join(docsRootOf(mainCounterpart(path.resolve(root)) || path.resolve(root), { env }), 'memory'));
}

// Why docs mode cannot be written here, verbatim in the installer's `!!` line, the plan line and the validate row.
const DOCS_MEMORY_REFUSAL = Object.freeze({
    symlink: '.claude is a symlink, so Claude Code reads its settings.local.json as the repository\'s',
    elsewhere: 'this project is below its repository root: Claude Code reads this project\'s .claude/settings.local.json only as a leftover beside the root\'s, for sessions started here, and the root\'s value wins - docs mode is written at a repository root only',
    tracked: '.claude/settings.local.json is tracked in git, so Claude Code reads it as the repository\'s - untrack it (git rm --cached .claude/settings.local.json, then add it to .gitignore) to allow docs mode',
    garbage: '.claude/settings.local.json is not valid JSON - fix it, then run /alfred-code:update again',
    unreadable: '.claude/settings.local.json cannot be read - give it read access, then run /alfred-code:update again',
    own: '.claude/settings.local.json sets its own autoMemoryDirectory - yours, so it stays',
});

// R4 and the plan's two more causes (D2), first match wins: a symlinked `.claude`; a project below its repository root
// outside Windows (Claude Code reads the root's file, and this one only as a leftover the root's value outranks); the
// file tracked (`tracked(file)`, the caller's git check, asked whether or not the file is on disk); not a JSON object; an `autoMemoryDirectory` of the user's own -
// one equal to `wanted` is accepted (D3), and one `ours(value)` vouches for is the stack's. Null: docs mode can be written.
function docsMemoryRefusal(root, { wanted, tracked = () => false, ours = () => false, home = require('os').homedir(), platform = process.platform } = {})
{
    const at = path.resolve(root);
    const claude = path.join(at, '.claude');
    const file = path.join(claude, 'settings.local.json');
    const refuse = (why) => ({ why, text: DOCS_MEMORY_REFUSAL[why] });
    let link = false;
    try { link = fs.lstatSync(claude).isSymbolicLink(); } catch { /* no .claude yet */ }
    if (link) return refuse('symlink');
    const read = localSettingsFile(at, { home, platform });
    if (read)
    {
        const counterpart = mainCounterpart(at);
        const allowed = [file, counterpart && path.join(counterpart, '.claude', 'settings.local.json')].filter(Boolean).map(dirKey);
        if (!allowed.includes(dirKey(read))) return refuse('elsewhere');
    }
    // Asked before the file is read: one git still indexes after the update removed it is tracked too (D11).
    if (tracked(file)) return refuse('tracked');
    if (!fs.existsSync(file)) return null;
    // An empty file reads as {} (settings.js readSettings, the 2026-10-20 ruling); one that cannot be read is no JSON error.
    let text;
    try { text = readText(file); } catch { return refuse('unreadable'); }
    if (!text.trim()) return null;
    let data;
    try { data = JSON.parse(text); } catch { return refuse('garbage'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return refuse('garbage');
    if (!Object.hasOwn(data, 'autoMemoryDirectory')) return null;
    const value = data.autoMemoryDirectory;
    if (ours(value)) return null;
    if (typeof value === 'string' && wanted)
    {
        const v = value.trim();
        const dir = /^~[\\/]/.test(v) ? path.join(home, v.slice(2)) : path.isAbsolute(v) ? path.resolve(v) : null;
        if (dir && dirKey(dir) === dirKey(wanted)) return null;
    }
    return refuse('own');
}

// The stamp's row for the stack's own `autoMemoryDirectory`: the folder named by its place under the project
// (`<project>/.alfred/docs/memory`), never by this machine's absolute path - a stamp committed with `.claude/` reaches
// teammates whose checkouts sit elsewhere, and an absolute hash read their stack-written value as their own (P3 review,
// finding 1). A folder outside the project keeps its absolute form. `root` is the checkout the value was computed from.
const memoryRowText = (form) => require('crypto').createHash('sha256').update(JSON.stringify(form)).digest('hex');
function memoryRowHash(value, root)
{
    const v = String(value);
    const rel = path.relative(realpathOrSelf(path.resolve(root)), realpathOrSelf(path.resolve(v)));
    return memoryRowText(rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `<project>/${rel.split(path.sep).join('/')}` : v);
}
// Whether a value is the one a row was recorded for: its absolute form (a row outside the project, or one an earlier
// build recorded), else any trailing part of it as a place under the project - so a moved folder, a data-root move
// and another machine's checkout all still read as the stack's.
const MEMORY_ROW_DEPTH = 12;
function memoryRowMatches(value, hash)
{
    if (typeof value !== 'string' || !value.trim() || typeof hash !== 'string' || !hash) return false;
    if (memoryRowText(value) === hash) return true;
    const parts = value.trim().split(/[\\/]+/).filter(Boolean);
    for (let n = 1; n <= Math.min(parts.length, MEMORY_ROW_DEPTH); n++)
        if (memoryRowText(`<project>/${parts.slice(-n).join('/')}`) === hash) return true;
    return false;
}

// The top-level `.md` files of a memory folder, sorted; [] when it is absent or cannot be read.
function memoryFiles(dir)
{
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/.test(e.name)).map((e) => e.name).sort(); }
    catch { return []; }
}

// OD5: a workspace child in the same repository that reads `docs` from a member, and whose effective setting is already
// that member's docs memory (Claude Code reads the repository root's settings.local.json, the member's row): it shares
// it, so nothing is written here. { member: <rel>, dir } or null. The chain starts where variablesOf starts it, and the
// mode's source is read from the files and the members alone: a hook's or a script's loader has already applied the
// members' values to its process env (applyVariables), where they would read as a launch value of the child's own.
function docsMemoryShare(root, { env = process.env, home = require('os').homedir(), managed = managedSettingsFile(process.platform, env), platform = process.platform } = {})
{
    const at = path.resolve(root);
    const chainEnv = Object.fromEntries(['CLAUDE_CONFIG_DIR', SWITCH_KEY].filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
    const { values, from } = variablesOf(at, { env: chainEnv });
    if (values.ALFRED_CODE_MEMORY !== 'docs') return null;
    const member = workspaceChain(mainCounterpart(at) || at, { env: chainEnv }).members.find((m) => m.rel === from.ALFRED_CODE_MEMORY);
    if (!member) return null;
    const setting = memoryDirSetting(at, { env, home, managed, platform });
    const dir = docsMemoryDir(member.root, { env });
    return setting && dirKey(setting) === dirKey(dir) ? { member: member.rel, dir } : null;
}
// The folder a checkout's workspace chain is read from: a linked worktree's main counterpart, whose workspace file the
// worktree lacks (it is gitignored), as resolveVariables reads it.
const chainProjectOf = (projectRoot) => mainCounterpart(projectRoot) || projectRoot;
// R3: each linked member's preferences folder, nearest first, read-only, while the switch is on. `skip` holds the files an
// `ignore doc <file>` here or in a nearer member drops for THAT member (R0); `ignore docs root` drops the member and every
// one past it, as it drops their docs roots.
function ancestorPrefsDirs(projectRoot, { env = process.env } = {})
{
    if (!workspaceOn({ env, projectRoot })) return [];
    const chain = workspaceChain(chainProjectOf(projectRoot), { env });
    const skip = new Set();
    let dropped = false;
    const take = (ignores) =>
    {
        for (const i of ignores || [])
        {
            if (i.category === 'doc') { skip.add(i.name); if (i.name.startsWith('preferences/')) skip.add(i.name.slice('preferences/'.length)); }
            else if (i.category === 'docs' && i.name === 'root') dropped = true;
        }
    };
    take(chain.ignores);
    const out = [];
    // F25: each entry names its member's role - the chain's last member is the workspace root, its first the parent.
    const top = chain.members.length - 1;
    chain.members.forEach((m, i) =>
    {
        if (dropped) return;
        const role = i === top ? 'root' : i === 0 ? 'parent' : 'ancestor';
        out.push({ dir: path.join(docsRootOf(m.root, { env, dataRoot: m.dataRoot }), 'preferences'), skip: new Set(skip), role });
        take(m.ignores);
    });
    return out;
}
// The workspace root (D3's 'root'): the chain's last linked member, null with no parent. The switch is the caller's.
function topMember(projectRoot, { env = process.env } = {})
{
    const { members } = workspaceChain(chainProjectOf(projectRoot), { env });
    return members.length ? members[members.length - 1] : null;
}

// R6: the workspace root's (the top member's) memory folder, read-only to a child. Null at a root or with the switch at 0,
// past an `ignore memory root` here or in a nearer member (R0), and unless exactly one of the root's folders is not one of
// the child's own (a shared account-level value is the child's own memory, not the root's to show).
function workspaceMemoryOf(projectRoot, { env = process.env, home = require('os').homedir(), managed = managedSettingsFile(process.platform, env), platform = process.platform } = {})
{
    if (!workspaceOn({ env, projectRoot })) return null;
    const chain = workspaceChain(chainProjectOf(projectRoot), { env });
    const { members } = chain;
    if (!members.length) return null;
    const ignored = (ignores) => (ignores || []).some((i) => i.category === 'memory' && i.name === 'root');
    if (ignored(chain.ignores) || members.slice(0, -1).some((m) => ignored(m.ignores))) return null;
    // The child's own folders come off first: on Windows past 200 the root's listing holds the child's folder too.
    const own = new Set(memoryDirsOf(projectRoot, { env, home, managed, platform }).map(dirKey));
    const found = memoryDirsOf(members[members.length - 1].root, { env, home, managed, platform }).filter((d) => !own.has(dirKey(d)));
    return found.length === 1 ? found[0] : null;
}

module.exports = {
    dataRoot, docsRoot, flowKind, statePath, statsPath, legacyStatePath, legacyStatsPath, findState, findStats, planDirs, LAYOUT_MOVES, ARCH_RENAME, runBookKey,
    PLAN_ID, planIdOf, approvalPath, approvalStamps, projectRootOf, gitTopOf, worktreeMain, holdsRecord, dirKey,
    settingFrom, checkDataPath, dataRootOf, workspaceOn, wsLine, ownWorkspace, workspaceChain,
    memoryDirsOf, defaultMemoryDirs, memoryDirSetting, trustedMemoryDir, localSettingsFile, staleLocalMemory, staleLocalMemoryFiles, docsRootOf, topMember,
    docsMemoryDir, DOCS_MEMORY_REFUSAL, docsMemoryRefusal, memoryRowHash, memoryRowMatches, memoryFiles, docsMemoryShare, realpathOrSelf, managedSettingsFile, ancestorPrefsDirs, workspaceMemoryOf, chainProjectOf,
    VARIABLE_KEYS, MEMBER_NEVER, DOTENV_LINE, COMMENT_LINE, unquote, readDotenv, readText, mainCounterpart, variablesOf, hooksOffOf, applyVariables,
};
