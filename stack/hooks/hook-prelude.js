#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// The gates every stack hook runs before it does anything, kept in ONE file because a copy
// of the same twelve lines inlined in every hook is a chance to drift per hook. The hooks already reach
// siblings this way (`require('./docs.js')`, `model-windows.json` through `__dirname`), so this is
// the established shape rather than a new one.
//
// GATE 1 - ALFRED_CODE_HOOKS_OFF. A csv of hook names a project does not want. It replaces the
// guided walk's hooks LAYER: selection used to mean 'do not copy this file', and once the hooks
// arrive through a plugin there is no file to leave out - the whole set ships together and a
// project turns one off by naming it. Matching is exact on the base name, `.js` optional, case and
// surrounding space ignored; a PREFIX never matches, so `guard-secret` does not silence
// `guard-secret-value`.
//
// GATE 2 - the migration window. Between the release that starts shipping hooks through the plugin
// and the update run that prunes the copies, a project can carry BOTH: the copied hook files
// wired in `.claude/settings.json` (or `settings.local.json`) and the same hooks enabled through the plugin. Every guard
// would then fire twice - two denials for one command, two block rows in the ledger, two
// AskUserQuestions. The PLUGIN copy is the one that steps aside, because the copied one is what the
// project's own settings file points at and is the older, already-trusted route.
//
// GATE 3 - the 1.x alias. 2.0.0 lists the 1.x core id as a RETIRED alias carrying the 2.0.0 core,
// hooks included (docs/rebrand-evidence.md S20), and an installed alias refreshes into that content
// at the next session (S21). A 1.x core left at user scope, seen from a project the seed already
// moved onto `alfred-code`, would fire every guard twice (S23, and S26: two plugins carrying the
// byte-identical command both run) - so the ALIAS's copy steps aside whenever the project or the
// account enables the new core AND that core is installed where it can load.
//
// GATE 4 - a project never set up. A user-scope core enables every hook in EVERY repo the user
// opens, and a repo nobody ran /alfred-code:setup in carries none of the rules the guards enforce -
// so a plugin-launched hook there does nothing and writes nothing (no `.claude/docs/` ledger or
// history in a repo merely opened: R54). Set up means an install record in the project's `.claude/`,
// or its git top level's, or - for a linked worktree - the main checkout's: the stamp (2.x, or the
// 1.x name), or a copied engine (a 1.x global install kept its stamp in the account dir, never its
// engines). A copied hook is set up by definition. Three guards stay live even there (R86), each
// skipping its block row: what they stop cannot be undone, and a user-scope core is the only guard
// a repo never set up has.
//
// Every gate FAILS OPEN. A hook that cannot read the settings file, or reads junk, runs normally: a
// guard that goes silent on a malformed file is a guard an attacker turns off by corrupting a file.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The wiring the installers write, in both spellings that shipped: quoted (current) and bare
// (through 0.2.4x). Only a `$CLAUDE_PROJECT_DIR/.claude/hooks/<file>` command counts - a user
// running their own copy of a same-named hook from their own path is NOT this hook's twin, and the
// plugin must keep working for them.
const COPIED_PREFIX = '$CLAUDE_PROJECT_DIR/.claude/hooks/';

function baseName(hook)
{
    return String(hook || '').trim().toLowerCase().replace(/\.js$/, '');
}

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*. A hook runs at 2.0.0 before the // legacy-name
// project's own update renames its settings, so the old name answers until then.
function envOf(env, suffix)
{
    const fresh = env[`ALFRED_CODE_${suffix}`];
    if (fresh !== undefined && fresh !== '') return fresh;
    const old = env[`CLAUDE_STACK_${suffix}`]; // legacy-name
    if (old !== undefined && old !== '') return old;
    return suffix === 'DOCS_PATH' ? env.CLAUDE_DOCS_PATH : old; // legacy-name
}

function hookDisabled(hook, env)
{
    const source = env || process.env;
    const off = String(envOf(source, 'HOOKS_OFF') || '');
    if (!off.trim()) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    return off.split(',').map(baseName).filter(Boolean).includes(wanted);
}

// Every command string in the settings file, whatever the event and matcher nesting.
function wiredCommands(settingsFile)
{
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { return []; }
    const hooks = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.hooks : null;
    if (!hooks || typeof hooks !== 'object') return [];
    const out = [];
    for (const blocks of Object.values(hooks))
    {
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks)
        {
            const list = block && Array.isArray(block.hooks) ? block.hooks : [];
            for (const entry of list) if (entry && typeof entry.command === 'string') out.push(entry.command);
        }
    }
    return out;
}

function yieldToCopiedTwin(hook, env)
{
    const source = env || process.env;
    if (!source || !source.CLAUDE_PLUGIN_ROOT) return false;   // this IS the copied hook
    const root = source.CLAUDE_PROJECT_DIR;
    if (!root) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    const target = (COPIED_PREFIX + wanted + '.js').toLowerCase();
    // A local-scope install wires its copies in settings.local.json (M4, R54) - both files count.
    const commands = ['settings.json', 'settings.local.json'].flatMap((name) => wiredCommands(path.join(root, '.claude', name)));
    for (const command of commands)
    {
        const clean = command.replace(/"/g, '').trim().toLowerCase();
        if (clean === target || clean.startsWith(target + ' ')) return true;
    }
    return false;
}

// The alias is recognised by its plugin root: the CLI caches a plugin at
// `<config>/plugins/cache/<marketplace>/<plugin>/<version>`, so the alias runs from a directory
// whose PARENT is the 1.x core's name - the new core's never is, whatever its marketplace key.
const CORE_PLUGIN = 'alfred-code';
const ALIAS_PLUGIN = 'claude-stack'; // legacy-name

function launchedFromAlias(root)
{
    const parts = String(root || '').split(/[\\/]+/).filter(Boolean);
    return parts.length >= 2 && parts[parts.length - 2].toLowerCase() === ALIAS_PLUGIN;
}

// `enabledPlugins` of one settings file: an ABSENT file enables nothing; one that exists and cannot
// be read or parsed returns null - the caller runs the hook.
function enabledIn(file)
{
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { return err && err.code === 'ENOENT' ? new Map() : null; }
    const map = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.enabledPlugins : null;
    return new Map(map && typeof map === 'object' && !Array.isArray(map) ? Object.entries(map) : []);
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// A settings key is not a loaded plugin: a committed settings file names `alfred-code@<key>` for a
// teammate whose core never installed (no marketplace, a declined trust prompt), and yielding then
// leaves that session with no guard at all. So the named core counts only with its row in the CLI's
// own `<config>/plugins/installed_plugins.json` - at user scope, or for THIS project - and that row's
// cache directory on disk. Anything unreadable is not installed: the alias runs.
function coreInstalled(account, root, ids)
{
    let plugins;
    try { plugins = JSON.parse(fs.readFileSync(path.join(account, 'plugins', 'installed_plugins.json'), 'utf8')).plugins; }
    catch { return false; }
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return false;
    const here = realOf(root);
    for (const id of ids)
        for (const row of [].concat(plugins[id] || []))
        {
            if (!row || typeof row !== 'object' || typeof row.installPath !== 'string' || !isDir(row.installPath)) continue;
            if (row.scope === 'user' || (typeof row.projectPath === 'string' && samePath(realOf(row.projectPath), here))) return true;
        }
    return false;
}

function aliasYieldsToCore(env)
{
    const source = env || process.env;
    if (!source || !launchedFromAlias(source.CLAUDE_PLUGIN_ROOT)) return false;
    const root = source.CLAUDE_PROJECT_DIR;
    if (!root) return false;
    const account = source.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude');
    // Lowest scope first, so the project and then its local file win for a key more than one names.
    const merged = new Map();
    for (const file of [path.join(account, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')])
    {
        const enabled = enabledIn(file);
        if (!enabled) return false;
        for (const [id, value] of enabled) merged.set(id, value);
    }
    const cores = [...merged].filter(([id, value]) => value === true && String(id).split('@')[0] === CORE_PLUGIN).map(([id]) => id);
    return cores.length > 0 && coreInstalled(account, root, cores);
}

const INSTALL_RECORDS = [['alfred-code.stamp'], ['claude-stack.stamp'], ['hooks', 'docs.js']]; // legacy-name

// The checkouts whose record speaks for `dir`: itself, its git top level, and - for a linked worktree,
// whose `.git` is a FILE - the main checkout it belongs to. The record is machine-local and `.claude/`
// ignored, so `git worktree add` (Claude Code's `.claude/worktrees/<n>` too) carries none of its own.
// Files alone: `gitdir: <main>/.git/worktrees/<n>`, then that dir's `commondir` (else the layout's own
// `../..`). A home directory reached by walking up is skipped - its `.claude/` is the account dir.
function checkoutsOf(dir)
{
    const roots = [dir];
    for (let at = dir, up; ; at = up)
    {
        const dotGit = path.join(at, '.git');
        let stat = null;
        try { stat = fs.statSync(dotGit); } catch { /* not this level */ }
        if (stat)
        {
            if (at !== dir && at !== os.homedir()) roots.push(at);
            if (!stat.isFile()) return roots;
            const line = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
            if (!line) return roots;
            const gitdir = path.resolve(at, line[1]);
            let common = null;
            try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); }
            catch { if (path.basename(path.dirname(gitdir)) === 'worktrees') common = path.dirname(path.dirname(gitdir)); }
            if (common && path.basename(common) === '.git') roots.push(path.dirname(common));
            return roots;
        }
        up = path.dirname(at);
        if (up === at) return roots;
    }
}

function neverSetUp(env)
{
    const source = env || process.env;
    if (!source || !source.CLAUDE_PLUGIN_ROOT) return false;   // a copied hook: the project wired it
    const root = source.CLAUDE_PROJECT_DIR;
    if (!root) return false;
    return !checkoutsOf(path.resolve(root)).some((at) => INSTALL_RECORDS.some((record) => fs.existsSync(path.join(at, '.claude', ...record))));
}

// Three of these files are also CLIs the model and the commands run by hand -
// `guard-secret-value.js --presence <file> KEY ...`, `--redacted`, `--redacted-env`. A hook
// invocation never carries an argument (every catalog row's args field is empty), so a leading
// `--<flag>` says this is the CLI, and a CLI is never gated: switching a guard off must not take
// away the sanctioned way to READ a credential's presence.
function isCliInvocation(argv)
{
    return /^--/.test(String((argv || process.argv)[2] || ''));
}

// R86: what these stop cannot be undone, so GATE 4 never stands them down - each reads neverSetUp()
// itself and skips its block row there instead.
const PROTECTIVE = new Set(['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push']);

// The one call every hook makes: true means do nothing at all, exit 0, print nothing.
function standDown(hook, env, argv)
{
    try
    {
        if (isCliInvocation(argv)) return false;
        return hookDisabled(hook, env) || yieldToCopiedTwin(hook, env) || aliasYieldsToCore(env)
            || (neverSetUp(env) && !PROTECTIVE.has(baseName(hook)));
    }
    catch { return false; }
}

module.exports = { hookDisabled, yieldToCopiedTwin, aliasYieldsToCore, neverSetUp, checkoutsOf, INSTALL_RECORDS, PROTECTIVE, standDown, isCliInvocation, COPIED_PREFIX, CORE_PLUGIN, ALIAS_PLUGIN, envOf };
