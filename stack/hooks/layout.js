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
// move map the installer applies (scripts/install/docs.js migrateLayout). Only fs and path are required: the engines
// copy this file beside themselves (HOOK_ENGINES) and load it with no prelude.
const fs = require('fs');
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
    for (let at = from; ;)
    {
        if (dirKey(at) === dirKey(home)) return '';
        let git = null;
        try { git = fs.statSync(path.join(at, '.git')); } catch { /* not this level */ }
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

module.exports = {
    dataRoot, docsRoot, flowKind, statePath, statsPath, legacyStatePath, legacyStatsPath, findState, findStats, planDirs, LAYOUT_MOVES,
    PLAN_ID, planIdOf, approvalPath, approvalStamps, projectRootOf, gitTopOf, worktreeMain, holdsRecord, dirKey,
};
