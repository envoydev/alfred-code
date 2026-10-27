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

// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred.
const dataRoot = (env = process.env) => String(envOf(env, 'DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.alfred';
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
    { from: 'test-coverage', base: 'docs', to: 'quality/test-coverage' },
    { from: 'loops', base: 'docs', to: 'quality/loops' },
    { from: 'tutorial', base: 'docs', to: 'explanations' },   // the explainer's folder (item 6, 2026-10-25)
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
function settingFrom({ env, projectDir, suffix, key })
{
    const read = key ? (e) => e[key] : (e) => envOf(e, suffix);
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
    const value = rest.join(' ');
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
    'ALFRED_CODE_FORGE_WATCH', 'ALFRED_CODE_WORKSPACE',
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

module.exports = {
    dataRoot, docsRoot, flowKind, statePath, statsPath, legacyStatePath, legacyStatsPath, findState, findStats, planDirs, LAYOUT_MOVES,
    PLAN_ID, planIdOf, approvalPath, approvalStamps, projectRootOf, gitTopOf, worktreeMain, holdsRecord, dirKey,
    settingFrom, checkDataPath, dataRootOf, workspaceOn, wsLine, ownWorkspace, workspaceChain,
    VARIABLE_KEYS, MEMBER_NEVER, DOTENV_LINE, COMMENT_LINE, unquote, readDotenv, readText, mainCounterpart, variablesOf, hooksOffOf, applyVariables,
};
