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
// GATE 3 - retired: the 1.x alias gate, gone once every install moved onto the core.
//
// GATE 4 - a project never set up. A user-scope core enables every hook in EVERY repo the user
// opens, and a repo nobody ran /alfred-code:init in carries none of the rules the guards enforce -
// so a plugin-launched hook there does nothing and writes nothing (no `.alfred/docs/` ledger or
// history in a repo merely opened: R54). Set up means an install record in the project's `.claude/`,
// or its git top level's, or - for a linked worktree - the main checkout's: the stamp, or a copied
// engine. A copied hook is set up by definition. Three guards stay live even there (R86), each
// skipping its block row: what they stop cannot be undone, and a user-scope core is the only guard
// a repo never set up has.
//
// GATE 5 - the hook profile. The core entry's `hook_profile` userConfig (minimal / standard / strict,
// set in /config and stored in the ACCOUNT settings' `pluginConfigs` - never a project file) reaches
// every plugin hook as CLAUDE_PLUGIN_OPTION_HOOK_PROFILE. `minimal` keeps the three PROTECTIVE guards
// only; `standard`, absent or anything unknown is today's set; `strict` is standard with the seeded-off
// switches that are safe on read as on (STRICT_ON - the Stop build check). The project's csv still wins:
// a hook it names stays off under every profile. A copied hook gets no option variable, so it reads
// as standard.
//
// GATE 6 - a Cursor host. Cursor loads Claude Code hooks by default (a compatibility toggle) and turns a
// Claude Stop block into an automatic follow-up with no loop limit, so a hook that asks or blocks can loop
// a Cursor session forever. Under a Cursor PAYLOAD (cursorHost: a `cursor_version` field, or a camelCase
// event name - Claude's are PascalCase) only the three PROTECTIVE guards run; every other hook stands down
// silently and writes no ledger row, as under GATE 4. Judged from the payload ALONE, never from the
// environment: a `claude` session in Cursor's integrated terminal inherits Cursor's variables and keeps
// every hook. A hook makes the check itself, right after it parsed its own payload (cursorStandDown), so no
// stdin is read or patched here; anything unparseable is a Claude payload. The plugin's own rows are exec form
// (2026-11-05), which Cursor's schema lacks - a bridge of them runs a bare node that fails open - so in Cursor
// this gate serves the copy route's shell-form rows.
//
// Every gate FAILS OPEN. A hook that cannot read the settings file, or reads junk, runs normally: a
// guard that goes silent on a malformed file is a guard an attacker turns off by corrupting a file.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
// os.homedir() throws on Windows when USERPROFILE is set but empty - every hook loads this file, so it never may.
const homeDir = () => { try { return os.homedir() || process.env.HOME || ''; } catch { return process.env.HOME || ''; } };
const path = require('node:path');
// 2.8.0: the approval stamp lives in <data root>/state/approvals/ (layout.js, beside this file on both routes); the pre-2.8.0
// <docs>/flow/ is still read for the 2.x line, and is the only path when layout.js is not there.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
// The stack's variables (D4): each winner of `<data root>/.variables`, the settings and the linked members' files set on
// the process env once, before any hook reads one - for CLAUDE_PROJECT_DIR, else the project the cwd sits in.
try { if (layout && layout.applyVariables) layout.applyVariables(process.env.CLAUDE_PROJECT_DIR || layout.projectRootOf(process.cwd()).checkout); }
catch { /* the process env as it stands */ }

// STDOUT AND STDERR BLOCK. Node writes a pipe ASYNCHRONOUSLY on macOS, and process.exit() drops whatever the
// pipe has not taken yet: measured 2026-10-10, the secret guard's rewrite of a 100 KB command reached its reader
// as the first 65,536 bytes on Node 22.16 and 22.23 alike (8,192 on 22.16 for a smaller write), unparseable - so
// the harness ran the call unredacted. Every hook and CLI here exits through process.exit, so the streams are
// made blocking before the first write, as Node already makes a terminal: a write returns once the pipe holds
// it. A file and a Linux pipe are synchronous anyway. `_handle.setBlocking` is libuv's uv_stream_set_blocking,
// the call the set-blocking package makes; a stream without it keeps Node's default. Every hook loads this
// file first, so loading it is the call; a CLI makes it in its main block.
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}
blockingStdio();

// The wiring the installers write, in both spellings that shipped: quoted (current) and bare
// (through 0.2.4x). Only a `$CLAUDE_PROJECT_DIR/.claude/hooks/<file>` command counts - a user
// running their own copy of a same-named hook from their own path is NOT this hook's twin, and the
// plugin must keep working for them.
const COPIED_PREFIX = '$CLAUDE_PROJECT_DIR/.claude/hooks/';

function baseName(hook)
{
    return String(hook || '').trim().toLowerCase().replace(/\.js$/, '');
}

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset - the one reader every ordinary hook
// requires (env-reader in meta/shared-rules.json pins the inline copies).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}

// GATE 5. The core's `hook_profile` userConfig is a plain string, default `standard`: these are the
// three values it reads, and any other value is read as `standard`.
const HOOK_PROFILES = ['minimal', 'standard', 'strict'];
// The seeded-off switches strict turns on: a deterministic check, never a monitor that judges the
// model's habits (those stay log-only until measured) nor instrumentation (measurement, not a check).
const STRICT_ON = new Set(['TURN_CHECK']);

function hookProfile(env)
{
    const value = String((env || process.env).CLAUDE_PLUGIN_OPTION_HOOK_PROFILE || '').trim().toLowerCase();
    return HOOK_PROFILES.includes(value) ? value : 'standard';
}

// The rule loader carries the project's rules: no off-list or profile stands it down (workspace stage 4c).
const UNSWITCHABLE = new Set(['rules-session']);
function profileOff(hook, env)
{
    return hookProfile(env) === 'minimal' && !PROTECTIVE.has(baseName(hook)) && !UNSWITCHABLE.has(baseName(hook));
}

// A hook's own on-switch (`ALFRED_CODE_<suffix>=1`), with the profile applied: strict reads a STRICT_ON
// switch as on over the seeded 0. The csv needs no case here - a hook it names stood down before this. A DEFAULT_ON
// switch reads an unset key as its catalog default, on (the scoring since 2026-11-03, B1); only an explicit value but 1
// turns it off.
const DEFAULT_ON = new Set(['SCORING']);
function switchOn(suffix, env)
{
    const source = env || process.env;
    if (STRICT_ON.has(suffix) && hookProfile(source) === 'strict') return true;
    const value = envOf(source, suffix);
    if (value === undefined && DEFAULT_ON.has(suffix)) return true;
    return String(value || '').trim() === '1';
}

// A hook's OLD name in the csv still switches it off (audit 2026-10-20, the hooks track's minor list: the csv is the
// user's own text, and an update never rewrites it). Old name -> new, the manifest's `renamed.hooks`, copied here so the
// prelude stays standalone; hook-prelude.test.js holds the two equal. A value may name a PART (`<hook>:<part>`, E-batch B-m6:
// the retired memory-session.js's host traps live on as preferences-session's `host`): it switches that part off in partOff, never a hook.
const HOOK_RENAMED = Object.freeze({ 'guard-answer-length': 'communication-reminder', 'guard-answer': 'communication-reminder', 'memory-session': 'preferences-session:host',
    'guard-answer:scorer': 'communication-reminder:scoring', 'guard-answer:scoring': 'communication-reminder:scoring',
    'guard-stop-contract:scorer': 'guard-stop-contract:scoring' });   // until 4.0.0
function hookDisabled(hook, env)
{
    const source = env || process.env;
    const off = String(envOf(source, 'HOOKS_OFF') || '');
    if (!off.trim()) return false;
    const wanted = baseName(hook);
    if (!wanted || UNSWITCHABLE.has(wanted)) return false;
    return off.split(',').map(baseName).filter(Boolean).map((n) => HOOK_RENAMED[n] || n).filter((n) => !n.includes(':')).includes(wanted);
}

// A hook's PART is switched off as `<hook>:<part>` in the same csv (the env audit of 2026-10-21 folded six per-part keys
// into it). The old key at `0` still turns the part off for the 2.x line: an update folds it into the csv, and a plugin
// update can land before that update runs. Matching is exact like hookDisabled's; a part entry never stands the whole
// hook down. Part -> its old key suffix; meta/migrations.json's fold entries carry the same pairs.
const PART_SWITCHES = Object.freeze({
    'docs-session:block': 'DOCS_BLOCK', 'docs-session:gate': 'DOCS_GATE', 'docs-session:ask': 'DOCS_ASK',
    'guard-ungated-commit:push': 'PUSH_GATE', 'guard-stop-contract:rotate': 'ROTATE_ASK', 'guard-stop-contract:done': 'DONE_GATE',
});
function partOff(hook, part, env)
{
    const source = env || process.env;
    const wanted = `${baseName(hook)}:${String(part || '').trim().toLowerCase()}`;
    const legacy = PART_SWITCHES[wanted];
    if (legacy && String(envOf(source, legacy) || '').trim() === '0') return true;
    const off = String(envOf(source, 'HOOKS_OFF') || '');
    // each entry as `<hook>:<part>` with its hook half bare (a `.js` there too), then through the renames
    return off.split(',').map((e) => { const at = e.indexOf(':'); const k = at > 0 ? `${baseName(e.slice(0, at))}:${e.slice(at + 1).trim().toLowerCase()}` : baseName(e);
        return HOOK_RENAMED[k] || k; }).includes(wanted);
}

// Every hook entry in a settings file - its event, its matcher ('' when it has none) and its command - whatever
// the nesting. A file that does not parse holds none.
function wiredEntries(settingsFile)
{
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { return []; }
    const hooks = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.hooks : null;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
    const out = [];
    for (const [event, blocks] of Object.entries(hooks))
    {
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks)
        {
            if (!block || typeof block !== 'object') continue;
            const matcher = typeof block.matcher === 'string' ? block.matcher : '';
            const list = Array.isArray(block.hooks) ? block.hooks : [];
            for (const entry of list) if (entry && typeof entry.command === 'string') out.push({ event, matcher, command: entry.command });
        }
    }
    return out;
}

// HOW CLAUDE CODE READS A MATCHER (code.claude.com/docs/en/hooks, the matcher table, read 2026-10-30): `*`, '' or none
// fires on everything; one made only of letters, digits, `_`, `-`, spaces, `,` and `|` is a list of exact names split
// on `|` or `,`; anything else is a JavaScript regex, unanchored (`RegExp.prototype.test`).
const MATCH_ALL = (matcher) => matcher === '' || matcher === '*';
const NAME_LIST_RE = /^[A-Za-z0-9_\- ,|]+$/;
const namesOf = (matcher) => matcher.split(/[|,]/).map((n) => n.trim()).filter(Boolean);
function matcherFires(matcher, name)
{
    if (MATCH_ALL(matcher)) return true;
    if (NAME_LIST_RE.test(matcher)) return namesOf(matcher).includes(name);
    try { return new RegExp(matcher).test(name); }
    catch { return false; }
}
// Do these matchers (one event's twin entries) fire on every call the plugin row fires on? A name list is covered
// name by name; a regex row only by the same regex or a match-all - no other is known to fire on all it does.
function covers(matchers, row)
{
    if (matchers.some(MATCH_ALL)) return true;
    if (MATCH_ALL(row)) return false;
    if (NAME_LIST_RE.test(row)) return namesOf(row).every((name) => matchers.some((m) => matcherFires(m, name)));
    return matchers.includes(row);
}

// The rows the core's own manifest wires each hook FILE on (its basename, no `.js`): read once per process from the
// plugin.json at the plugin root this prelude ships in - the plugin cache is the whole repo. A snapshot from before
// the catalog left the repo (2026-11-14) declares the core as an entry of its marketplace.json instead.
let coreRowsCache = null;
function coreManifest()
{
    const root = path.join(__dirname, '..', '..', '.claude-plugin');
    try
    {
        const own = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
        if (own && own.name === CORE_PLUGIN) return own;
    }
    catch { /* an older snapshot: the marketplace entry below */ }
    const market = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'), 'utf8'));
    return (Array.isArray(market && market.plugins) ? market.plugins : []).find((p) => p && p.name === CORE_PLUGIN);
}
function coreRows()
{
    if (coreRowsCache) return coreRowsCache;
    const rows = new Map();
    try
    {
        const core = coreManifest();
        const hooks = core && core.hooks && typeof core.hooks === 'object' ? core.hooks : {};
        for (const [event, blocks] of Object.entries(hooks))
            for (const block of Array.isArray(blocks) ? blocks : [])
                for (const h of block && Array.isArray(block.hooks) ? block.hooks : [])
                {
                    // Exec form names the script in `args` (build-marketplace.js launch); shell form in the command line.
                    const line = [h && h.command, ...(h && Array.isArray(h.args) ? h.args : [])].filter((x) => typeof x === 'string').join(' ');
                    const file = /([\w.-]+)\.js(?=["'\s]|$)/.exec(line);
                    if (!file) continue;
                    const name = file[1].toLowerCase();
                    if (!rows.has(name)) rows.set(name, []);
                    rows.get(name).push({ event, matcher: typeof block.matcher === 'string' ? block.matcher : '' });
                }
    }
    catch { /* no declaration: no row, so nothing yields */ }
    coreRowsCache = rows;
    return rows;
}

// The plugin rows THIS run of the hook stands for. A caller that knows its call says so (`{ event, tool }` - the file
// dispatcher, per call). A guard the plugin's dispatcher runs in its own process stands for that dispatcher's row on the
// tools the dispatcher runs it for. Any other run is one of the hook's own rows in the core entry, so all of them.
function pluginRowsOf(wanted, call)
{
    if (call && typeof call.event === 'string' && call.event) return [{ event: call.event, matcher: typeof call.tool === 'string' ? call.tool : '' }];
    const main = require.main;
    const host = main && typeof main.filename === 'string' ? baseName(path.basename(main.filename)) : '';
    if (host && host !== wanted && path.dirname(main.filename) === __dirname && (host === 'shell-guards' || host === 'file-guards'))
    {
        const ex = main.exports || {};
        if (host === 'shell-guards') return typeof ex.MATCHER === 'string' ? [{ event: 'PreToolUse', matcher: ex.MATCHER }] : [];
        const tools = ex.TOOLS instanceof Map ? ex.TOOLS.get(wanted) : null;
        return Array.isArray(tools) && tools.length ? [{ event: 'PreToolUse', matcher: tools.join('|') }] : [];
    }
    return coreRows().get(wanted) || [];
}

// GATE 2 (HK-02, audit 2026-10-30). The plugin copy yields only to a REAL twin: the copied file on disk at
// `<project>/.claude/hooks/<hook>.js`, and entries naming it - in settings.json or settings.local.json (a local-scope
// install, M4, R54) - that cover EVERY plugin row this run stands for: the same event, a matcher firing on each tool
// the row fires on. A string naming the twin anywhere - any event, matcher `Nothing`, no file - stood every plugin
// guard down, the dispatchers' protective ones included (replayed: `rm -rf ~`, `git push --force origin main` and a
// Read of `.env` all passed). Anything unread - no rows, no file, an unparseable settings file - is no twin.
function yieldToCopiedTwin(hook, env, call)
{
    const source = env || process.env;
    if (!source || !source.CLAUDE_PLUGIN_ROOT) return false;   // this IS the copied hook
    const root = source.CLAUDE_PROJECT_DIR;
    if (!root) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    const hooksDir = path.join(root, '.claude', 'hooks');
    if (path.resolve(__dirname) === path.resolve(hooksDir)) return false;   // the copy itself, under an inherited plugin root
    const target = (COPIED_PREFIX + wanted + '.js').toLowerCase();
    let twins = ['settings.json', 'settings.local.json'].flatMap((name) => wiredEntries(path.join(root, '.claude', name))).filter(({ command }) =>
    {
        const clean = command.replace(/"/g, '').trim().toLowerCase();
        return clean === target || clean.startsWith(target + ' ');
    });
    const session = call && typeof call.session === 'string' && call.session ? call.session : callSession;
    // A repo merely opened with no twin gets no snapshot (nothing is written there); a set-up repo takes it on the first
    // call even with none wired, so the call that plants a twin has already fixed the session's wiring.
    const atStart = session && (twins.length || !neverSetUp(source)) ? twinSnapshot(root, session, source) : null;
    if (atStart) twins = twins.filter((t) => atStart.has(twinKey(t)));
    if (!twins.length) return false;
    try { if (!fs.statSync(path.join(hooksDir, `${wanted}.js`)).isFile()) return false; }
    catch { return false; }
    const rows = pluginRowsOf(wanted, call);
    return rows.length > 0 && rows.every((row) => covers(twins.filter((t) => t.event === row.event).map((t) => t.matcher), row.matcher));
}

// E1-3: a twin is one wired when the SESSION BEGAN. Claude Code reads its hooks at session start, so a copied file and
// its entry written later (a `--with-sensitive` write, a stray edit) run nothing this session - and yielding to them stood
// every plugin guard down with nobody judging. `twins-<session>.json` under the data root's sessions folder holds the
// `event|matcher|command` key of each copied entry wired then: the fresh-session hook writes it on SessionStart (startup,
// resume, clear, fork), else the first call that names the session does (exclusive create - a SessionStart hook switched
// off, at the cost that a twin written before that call counts). Unreadable or unwritable: null, and today's yield holds.
// A dispatcher names its session once (`useSession`), so every guard it runs in-process is narrowed by it too.
let callSession;
function useSession(id) { callSession = typeof id === 'string' && id ? id : undefined; }
const twinKey = (t) => `${t.event}|${t.matcher}|${t.command}`;
const twinMemo = new Map();
const twinFileOf = (root, sessionId, env) => (layout && root && sessionId ? layout.statePath(root, 'sessions', `twins-${safeSession(sessionId)}.json`, env) : null);
function writeTwinSnapshot(root, sessionId, env = process.env, { exclusive = false } = {})
{
    const file = twinFileOf(root, sessionId, env);
    if (!file) return false;
    twinMemo.delete(file);
    const keys = [...new Set(['settings.json', 'settings.local.json'].flatMap((name) => wiredEntries(path.join(root, '.claude', name)))
        .filter(({ command }) => command.replace(/"/g, '').trim().toLowerCase().startsWith(COPIED_PREFIX.toLowerCase())).map(twinKey))];
    try
    {
        const dir = path.dirname(file);
        fs.mkdirSync(dir, { recursive: true });
        sweepStale(dir, 'twins-');
        if (exclusive) { fs.writeFileSync(file, JSON.stringify(keys), { flag: 'wx' }); return true; }
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(keys));
        fs.renameSync(tmp, file);
        return true;
    }
    catch { return false; }
}
function twinSnapshot(root, sessionId, env = process.env)
{
    const file = twinFileOf(root, sessionId, env);
    if (!file) return null;
    if (twinMemo.has(file)) return twinMemo.get(file);
    const read = () =>
    {
        const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(keys) && keys.every((k) => typeof k === 'string') ? new Set(keys) : null;
    };
    let wired = null;
    try { wired = read(); }
    catch (e)
    {
        if (e && e.code === 'ENOENT')
        {
            writeTwinSnapshot(root, sessionId, env, { exclusive: true });
            try { wired = read(); } catch { wired = null; }
        }
    }
    twinMemo.set(file, wired);
    return wired;
}

const CORE_PLUGIN = 'alfred-code';

const INSTALL_RECORDS = [['alfred-code.stamp'], ['hooks', 'docs.js']];

// The checkouts whose record speaks for `dir`: itself, its git top level, and - for a linked worktree,
// whose `.git` is a FILE - the main checkout it belongs to. The record is machine-local and `.claude/`
// ignored, so `git worktree add` (Claude Code's `.claude/worktrees/<n>` too) carries none of its own.
// Files alone: `gitdir: <main>/.git/worktrees/<n>`, then that dir's `commondir` (else the layout's own
// `../..`). A home directory reached by walking up is skipped - its `.claude/` is the account dir.
function checkoutsOf(dir)
{
    const roots = [dir];
    const between = []; // the folders from `dir` up to the top: a package of a monorepo may hold its own install (seam m3)
    for (let at = dir, up; ; at = up)
    {
        const dotGit = path.join(at, '.git');
        let stat = null;
        try { stat = fs.statSync(dotGit); } catch { /* not this level */ }
        if (stat)
        {
            if (at !== dir && at !== homeDir()) roots.push(...between, at);
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
        if (at !== dir) between.push(at);
        up = path.dirname(at);
        if (up === at || up === homeDir()) return roots; // the home directory is never a project's top (its `.claude/` is the account dir)
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
// itself and skips its block row there instead. The desktop exec gate that joined them (final review IM2) left in
// complexity stage 1 (B12): 0 fires in 442 sessions, and the stack ships no desktop server since 2.10.1.
const PROTECTIVE = new Set(['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push']);
// The hooks that answer a Cursor payload in Cursor's own shape, so GATE 6 lets them through (the rule loader, workspace stage 4a).
const CURSOR_RUNS = new Set(['rules-session']);

// UNATTENDED - no person can answer (print mode, or auto-run once the user is away), so a Stop block or an offer reaches no person: it only buys
// the model another turn (pilot 2, 2026-09-27: 8 of 12 print-mode cells ended on 'docs ok', nine
// em-dash blocks re-sent finished answers). Not a gate every hook runs - the hooks that ASK call it at
// the ask; a denial that protects something never does. True on ALFRED_CODE_UNATTENDED=1 (exactly
// '1', init-plan.js's switch), or when the transcript's newest row carrying an `entrypoint` says
// `sdk-cli`: every conversation row of a `claude -p` transcript does, an interactive one says `cli`,
// and bookkeeping rows (last-prompt, atis-latch, cost-state) carry none (measured, 12 pilot-2 cells).
// The newest row decides, so a resumed session is judged by who is there now. Anything unreadable - no
// file, an empty one, a torn or garbage LAST row - is a person: the behaviour they expect.
const TRANSCRIPT_WINDOWS = [256 * 1024, 8 * 1024 * 1024];

function transcriptField(file, key)
{
    let size;
    try { size = fs.statSync(file).size; } catch { return null; }
    for (const span of TRANSCRIPT_WINDOWS)
    {
        const start = Math.max(0, size - span);
        let text;
        const fd = fs.openSync(file, 'r');
        try
        {
            const buf = Buffer.alloc(size - start);
            fs.readSync(fd, buf, 0, buf.length, start);
            text = buf.toString('utf8');
        }
        finally { fs.closeSync(fd); }
        const lines = text.split('\n');
        if (start > 0) lines.shift();   // cut mid-row
        let last = true;
        for (let i = lines.length - 1; i >= 0; i--)
        {
            const line = lines[i].trim();
            if (!line) continue;
            let row = null;
            try { row = JSON.parse(line); } catch { /* judged below */ }
            const isRow = row !== null && typeof row === 'object' && !Array.isArray(row);
            if (last && !isRow) return null;
            last = false;
            if (isRow && typeof row[key] === 'string') return row[key];
        }
        // Nothing complete in this window: one row longer than it - read the wider one.
        if (start === 0 || !last) return null;
    }
    return null;
}

// How long after the user's newest typed prompt a session under a live auto-run stamp counts as unattended (card item 11).
const AWAY_AFTER_MS = 10 * 60 * 1000;
// Whether the user is away under a live stamp: the newest row the user TYPED (typedRowText) in the transcript's tail
// windows is AWAY_AFTER_MS old or more. No transcript, no typed row in the widest window, or one with no timestamp is
// away - the stamp's old reading.
function userAway(input, now = Date.now())
{
    const file = input && typeof input === 'object' && typeof input.transcript_path === 'string' ? input.transcript_path : '';
    const at = file ? lastTypedAt(file) : 0;
    return !at || now - at >= AWAY_AFTER_MS;
}
// The timestamp (ms) of the newest typed row in the transcript's tail windows, else 0.
function lastTypedAt(file)
{
    let size;
    try { size = fs.statSync(file).size; } catch { return 0; }
    for (const span of TRANSCRIPT_WINDOWS)
    {
        const start = Math.max(0, size - span);
        let text;
        try
        {
            const fd = fs.openSync(file, 'r');
            try { const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); text = buf.toString('utf8'); }
            finally { fs.closeSync(fd); }
        }
        catch { return 0; }
        const lines = text.split('\n');
        if (start > 0) lines.shift();   // cut mid-row
        for (let i = lines.length - 1; i >= 0; i--)
        {
            if (!isTypedCandidate(lines[i])) continue;
            const row = rowOf(lines[i]);
            if (typedRowText(row)) return tsOfRow(row);
        }
        if (start === 0) return 0;
    }
    return 0;
}

// A live AUTO waiver is nobody at the terminal too (audit 2026-10-10 C08 / C09). The user's 'take every recommended
// option' is written to <data root>/state/approvals/APPROVAL with an `AUTO - "<their words>"` first line, and the dispatch guard reads
// it as consent for THIS session only: under 8h old and not written before the session's transcript was born (a
// birthtime equal to the ctime is a filesystem's fallback, unknown - the age cap still holds). While it is live a
// person-directed ask has nobody to answer it - measured: a fresh-session Stop block demanding an ask while three
// seats ran under AUTO (9a4ef375), and a post-compaction 'ask the user' that a literal follower would have ended an
// overnight run on (c6142301). The project root is the env's or the payload's own cwd, never this process's cwd.
const AUTO_STAMP_MAX_MS = 8 * 60 * 60 * 1000;
// A stamp an auto-run start writes (guard-fresh-session-start.js, at a typed `/alfred-code:mode:auto-run on` or a typed
// `/mode-auto-run <request>`) names its session on a `session: <id>` line. It is live for THAT session for as
// long as the session runs - an unattended loop outlives the 8h a hand-written stamp gets - and never for another session
// in the same project, which the age and birth checks cannot tell apart from it. A week is the backstop for a stamp whose
// session died without its `/alfred-code:mode:auto-run off`.
const SESSION_STAMP_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// The standing auto-run (spec 3.5): the mode file's own ALFRED_CODE_AUTO_RUN=1, honoured where git vouches the file is this
// machine's alone; memoised per process and root, and a copy without the helper honours nothing.
const standingAt = new Map();
// The own file's 1, or a workspace member's (mode inheritance D2: a joined child that holds no value of its own).
const heldHere = (root) =>
{
    try { const modes = require('./mode-settings.js'); return modes.autoRunHeld(root) === 'own' || (modes.autoRunInherited(root) || {}).held === 'own'; }
    catch { return false; }
};
const autoRunStanding = (root) => { if (!standingAt.has(root)) standingAt.set(root, heldHere(root)); return standingAt.get(root); };
// How long auto-run lasts, for the banner, the run contract and the Stop hold: the standing variable carries into new
// sessions, a /mode-auto-run <request> stamp lasts its session (stage 3's final review, finding 7).
const autoLasts = (root) => (root && autoRunStanding(root) ? 'auto-run stays on, new sessions included, until' : 'auto-run stays on for the session until');
// The approval stamp's state for this payload: its path, first line, named session and whether it is live. null when absent.
// With `planId`, that plan's own stamp (<data root>/state/approvals/<plan id>/APPROVAL, layout.js approvalPath); without
// it, the root one - auto-mode's, and a pre-2.8.0 skill copy's.
function approvalStamp(input, env, planId)
{
    try
    {
        const source = env || process.env;
        const payload = input && typeof input === 'object' ? input : {};
        const root = source.CLAUDE_PROJECT_DIR || (typeof payload.cwd === 'string' ? payload.cwd : '');
        if (!root) return null;
        if (!planId && payload.session_id && autoRunStanding(root))   // every named session, no stamp file read
            return { file: layout ? layout.findState(root, 'approvals', 'APPROVAL', source) : '', first: 'AUTO - "ALFRED_CODE_AUTO_RUN=1"',
                session: String(payload.session_id), skill: '', live: true, mtimeMs: Date.now() };
        if (planId && !layout) return null;
        const file = planId ? layout.approvalPath(root, planId, source)
            : layout ? layout.findState(root, 'approvals', 'APPROVAL', source) : path.resolve(root, envOf(source, 'DOCS_PATH') || '.alfred/docs', 'flow', 'APPROVAL');
        const stamp = fs.statSync(file);
        if (!stamp.isFile()) return null;
        const fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(2048);
        let n = 0;
        try { n = fs.readSync(fd, head, 0, head.length, 0); }
        finally { fs.closeSync(fd); }
        const text = head.toString('utf8', 0, n);
        const first = text.split('\n')[0].trim();
        const session = (/^session:[ \t]*(\S+)/m.exec(text) || [])[1] || '';
        const skill = (/^skill:[ \t]*(\S+)/m.exec(text) || [])[1] || '';
        const age = Date.now() - stamp.mtimeMs;
        let live;
        if (session) live = age <= SESSION_STAMP_MAX_MS && String(payload.session_id || '') === session;
        else
        {
            live = age <= AUTO_STAMP_MAX_MS;
            if (live && typeof payload.transcript_path === 'string' && payload.transcript_path)
            {
                try
                {
                    const t = fs.statSync(payload.transcript_path);
                    const born = t.birthtimeMs && t.birthtimeMs !== t.ctimeMs ? t.birthtimeMs : 0;
                    if (born && stamp.mtimeMs < born) live = false;
                }
                catch { /* no transcript - the age cap decides */ }
            }
        }
        // The root AUTO stamp is the user's waiver only where the transcript shows the user typing it (audit 2026-10-30
        // HK-03): a stamp the model wrote by hand opened the dispatch gate and the stop contract's ask answering. A plan's
        // own stamp is a workflow gate and keeps the rule above.
        const verified = !live || planId || !/^AUTO\b/.test(first) ? true : autoStampVerified({ file, text, first, session, mtimeMs: stamp.mtimeMs }, payload);
        return { file, first, session, skill, live: live && verified, mtimeMs: stamp.mtimeMs };
    }
    catch { return null; }
}
function autoStampLive(input, env)
{
    const stamp = approvalStamp(input, env);
    return Boolean(stamp && stamp.live && /^AUTO\b/.test(stamp.first));
}

// --- TRANSCRIPT READS (audit 2026-10-30 HK-03, FA-4) ----------------------------------------------------------------
// The auto-run stamp's proof reads the transcript's typed rows and the AskUserQuestion answers below. A receipt file is no
// consent in this file any more: a chat yes opens no guard (guards ask instead, 2026-11-25), and the proof receipts
// (COMMIT-GATE, PUSH-GATE, APPROVAL) are read by their own guards.
// A payload with no transcript (a CLI run, a test fixture) keeps the time rule alone: every real session carries one.
const SCAN_CHUNK = 4 * 1024 * 1024;
const ROW_PARSE_MAX = 4 * 1024 * 1024;
// Every line of `file` that holds one of `needles`, in file order: onLine(lineBuffer, byteOffset). A needle is searched in
// the raw bytes and only a line it hits is handed on, so a long transcript costs its read and no per-line work. `from`
// starts the read at a line's first byte.
function linesWith(file, needles, onLine, from = 0)
{
    let fd;
    try
    {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const keys = needles.map((n) => Buffer.from(n));
        const chunk = Buffer.alloc(Math.min(SCAN_CHUNK, Math.max(1, size - from)));
        let carry = Buffer.alloc(0);
        let base = from;
        let pos = from;
        while (pos < size)
        {
            const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - pos), pos);
            if (n <= 0) break;
            pos += n;
            const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
            const end = pos >= size ? buf.length : buf.lastIndexOf(10) + 1;
            const starts = new Set();
            for (const key of keys)
            {
                let at = buf.indexOf(key);
                while (at !== -1 && at < end)
                {
                    starts.add(at === 0 ? 0 : buf.lastIndexOf(10, at - 1) + 1);
                    const nl = buf.indexOf(10, at);
                    at = nl === -1 ? -1 : buf.indexOf(key, nl + 1);
                }
            }
            for (const s of [...starts].sort((a, b) => a - b))
            {
                const nl = buf.indexOf(10, s);
                onLine(buf.subarray(s, nl === -1 || nl > end ? end : nl), base + s);
            }
            carry = Buffer.from(buf.subarray(end));
            base += end;
        }
    }
    catch { /* an unreadable file is read as far as it went */ }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}
const rowOf = (line) => { if (line.length > ROW_PARSE_MAX) return null; try { return JSON.parse(line.toString('utf8')); } catch { return null; } };
// The text of a turn the user TYPED: a user row, never a meta row (a skill body, an expansion), a compaction summary or a
// sidechain row (both the model's words - the final review of 2026-10-30 FA-2: `AUTO - "Pending Tasks"` was proven by a
// summary), a tool result (an ask's answer is the harness's row) or a harness prompt (a task notice, a command's output, a
// seat's hand-back). The tagged `<command-name>` / `<command-args>` row of a typed command is the user's. A `!` line's rows
// (`<bash-input>`, `<bash-stdout>`, `<bash-stderr>`) and a local command's are the harness's whole, as a command's output
// row is (LOCAL_ONLY_RE; review fix pass run B m6: a literal `</bash-stdout>` inside the output cut the span strip short,
// and a path printed after it read as typed and opened writes, U20).
function typedRowText(row)
{
    if (!row || row.type !== 'user' || row.isMeta || row.isCompactSummary || row.isSidechain) return '';
    const c = row.message && row.message.content;
    if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) return '';
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('\n') : '';
    return text.trim() && !harnessPrompt(text) && !LOCAL_ONLY_RE.test(text) ? text : '';
}
// 'on' / 'off' when a typed line switches auto-run (the one parser), else null.
const autoEventOf = (text) => { const f = modeFlags(text); return f.family && f.autoRun ? f.autoRun : null; };
const normLabel = (t) => String(t).replace(/\s*\(recommended\)\s*$/i, '').replace(/["'“‘”’]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const tsOfRow = (row) => { const t = Date.parse(row && row.timestamp); return Number.isFinite(t) ? t : 0; };
// An answered ask's labels (each answer and its comma-split parts), or null for no answer row or one the idle timeout closed.
function answerLabelsOf(row)
{
    const result = row && row.toolUseResult;
    const answers = result && typeof result === 'object' ? result.answers : null;
    if (!answers || typeof answers !== 'object' || askTimedOut(result)) return null;
    const labels = [];
    for (const a of Object.values(answers)) for (const one of [a, ...String(a).split(/,\s*/)]) if (normLabel(one)) labels.push(normLabel(one));
    return labels.length ? labels : null;
}
// Whether a person gave an answer row's answer (D25): its own `permissionDecision.source` (2.1.323) opens `user`, never `hook`.
const byUser = (row) => { const s = row && row.permissionDecision && row.permissionDecision.source; return typeof s === 'string' && s.startsWith('user'); };
const ANSWER_NEEDLE = '"answers":';
const AUTO_NEEDLE = 'auto-run';
// An AskUserQuestion call in an assistant row, as Claude Code serializes it (compact JSON, the needles above alike).
const ASK_NEEDLE = '"name":"AskUserQuestion"';
const isTypedCandidate = (line) => line.includes('"type":"user"') && !line.includes('"tool_result"');
// 'on' / 'off' when a transcript line is a typed row switching auto-run, else null: the one typed-line read every judge of
// auto-run shares. With `session`, a row naming another session is none.
function typedAutoEvent(line, session)
{
    if (!line.includes(AUTO_NEEDLE) || !isTypedCandidate(line)) return null;
    const row = rowOf(line);
    if (!row || (session && row.sessionId && row.sessionId !== session)) return null;
    return autoEventOf(typedRowText(row));
}
// An answer is the user's only as the result of an AskUserQuestion call (the final review of 2026-10-30 FA-4: an
// `answers`-shaped result under another tool's id counted as one). The ids of the AskUserQuestion calls an assistant row
// makes, and the ids a user row's tool results answer.
const askCallIds = (row) => { const c = row && row.type === 'assistant' && row.message && row.message.content;
    return Array.isArray(c) ? c.filter((b) => b && b.type === 'tool_use' && b.name === 'AskUserQuestion' && typeof b.id === 'string').map((b) => b.id) : []; };
const resultIds = (row) => { const c = row && row.type === 'user' && row.message && row.message.content;
    return Array.isArray(c) ? c.filter((b) => b && b.type === 'tool_result' && typeof b.tool_use_id === 'string').map((b) => b.tool_use_id) : []; };
// The AUTO stamp's proof (HK-03). A stamp the start hook wrote names its session and records the transcript's size when
// it was written (`transcript-size:`); it counts when a typed row turning auto-run on sits near that offset - the prompt
// row lands just before the hook on some builds and just after it on others, and the model's Skill route writes it up to
// lastTypedPrompt's 4MB tail after the row - read by position - AND no typed row turns auto-run off after the newest such
// row (the final review of 2026-10-30 FA-1: a stamp the model rewrote over an old on-row, after the user typed the
// off-flag, got the model's own SHOW ask answered and opened the secret receipt). The off read is a typed-line read from that row to the end, and an off-row of any session in this file counts.
// Its quoted words are the typed line's or, on the Skill route, the model's args, so they are never matched. A stamp with
// no `session:` line is task-solve's hand-written waiver: its quoted words (the text after `AUTO -` when unquoted;
// whitespace collapsed, double quotes single, the first 400 characters, at least 8 - a shorter quote matches any turn)
// must appear in a turn the user typed in this session, letter case aside, or the user answered 'Start AUTO here' to an
// AskUserQuestion with auto-run off - never a Skill call alone (the 2026-10-14 ruling 'narrow to a typed user turn'). No
// transcript: the time rule alone, as before. A proof is kept per stamp and transcript size within one process.
// 200MB measured: the positioned read 5ms, the off read from an on-row at the start about 95ms (paid only while a
// session-named stamp is live), the hand-written scan 125ms.
const AUTO_NEAR = 64 * 1024;
const AUTO_WINDOW = 5 * 1024 * 1024;
const AUTO_WORDS_MIN = 8;
const autoProofs = new Map();
const normWords = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/"/g, "'");
// Whether a typed row turns auto-run off anywhere in `file` from byte `from` (a line's first byte) on.
function typedAutoOffFrom(file, from)
{
    let off = false;
    linesWith(file, [AUTO_NEEDLE], (line) => { if (!off && typedAutoEvent(line, '') === 'off') off = true; }, from);
    return off;
}
function typedAutoOnNear(file, offset, session)
{
    let fd;
    try
    {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        let judged = -1;
        for (const span of [AUTO_NEAR, AUTO_WINDOW])
        {
            const from = Math.max(0, offset - span);
            const to = Math.min(size, offset + span);
            if (to <= from) continue;
            const buf = Buffer.alloc(to - from);
            const n = fs.readSync(fd, buf, 0, buf.length, from);
            const view = buf.subarray(0, n);
            // the newest whole typed on-row of this session in the span, as the byte just past it
            let newest = -1;
            let at = view.indexOf(AUTO_NEEDLE);
            while (at !== -1)
            {
                const prev = at === 0 ? -1 : view.lastIndexOf(10, at - 1);
                const nl = view.indexOf(10, at);
                const whole = (prev !== -1 || from === 0) && (nl !== -1 || from + n >= size);
                const line = view.subarray(prev + 1, nl === -1 ? n : nl);
                if (whole && typedAutoEvent(line, session) === 'on') newest = nl === -1 ? from + n : from + nl + 1;
                at = nl === -1 ? -1 : view.indexOf(AUTO_NEEDLE, nl + 1);
            }
            if (newest > judged)
            {
                judged = newest;
                if (!typedAutoOffFrom(file, newest)) return true;
            }
        }
        return false;
    }
    catch { return false; }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}
function typedWordsOrStart(file, words)
{
    const want = words.toLowerCase();
    let auto = false;
    let found = false;
    const asks = new Set();
    // E1-1 (inventory A): read to the end - a typed off flag after the words or the answer ends the waiver, as it ends the
    // hook's own stamp, and the words typed again after it start it again.
    linesWith(file, ['"type":"user"', ANSWER_NEEDLE, ASK_NEEDLE], (line) =>
    {
        if (line.includes(ASK_NEEDLE)) for (const id of askCallIds(rowOf(line))) asks.add(id);
        if (isTypedCandidate(line))
        {
            const text = typedRowText(rowOf(line));
            if (!text) return;
            const ev = autoEventOf(text);
            if (ev) auto = ev === 'on';
            if (ev === 'off') { found = false; return; }
            const tagged = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text);
            const asLine = tagged ? `/${tagged[1]} ${(/<command-args>([\s\S]*?)(?:<\/command-args>|$)/.exec(text) || [])[1] || ''}` : '';
            if ([text, asLine].some((t) => t && normWords(t).toLowerCase().includes(want))) found = true;
            return;
        }
        if (line.includes('"toolUseResult"'))
        {
            const row = rowOf(line);
            const labels = answerLabelsOf(row);
            if (labels && !auto && byUser(row) && labels.some((l) => l.startsWith('start auto here'))
                && resultIds(row).some((id) => asks.has(id))) found = true;
        }
    });
    return found;
}
function autoStampVerified(stamp, payload)
{
    const tp = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    let size = -1;
    try { const st = tp !== '' ? fs.statSync(tp) : null; size = st && st.isFile() ? st.size : -1; } catch { size = -1; }
    if (size < 0) return true;
    const key = `${stamp.file}|${stamp.mtimeMs}|${tp}|${size}`;
    if (autoProofs.has(key)) return autoProofs.get(key);
    let ok = false;
    if (stamp.session)
    {
        const offset = Number((/^transcript-size:[ \t]*(\d+)/m.exec(stamp.text) || [])[1]);
        ok = Number.isFinite(offset) && typedAutoOnNear(tp, offset, stamp.session);
    }
    else
    {
        const quoted = /^AUTO\b[^"]*"([\s\S]*)"\s*$/.exec(stamp.first);
        const words = normWords(quoted ? quoted[1] : stamp.first.replace(/^AUTO\b\s*-?\s*/, '')).slice(0, 400);
        ok = words.length >= AUTO_WORDS_MIN && typedWordsOrStart(tp, words);
    }
    autoProofs.set(key, ok);
    return ok;
}

// --- the modes: ONE parser every reader of a mode calls --------------------------------------------------------------
// A MODE COMMAND LINE is `/alfred-code:mode:<scoring|auto-run|auto-compact>` first on the line: with exactly `on` or
// `off` after it the mode's field is set, bare it only names the mode, and anything else is `extra` - nothing switches.
// It reads as a flag-only `mode-` line (`family`, `flagOnly`, no request), so it opens no run. Any other typed line
// opens with a command group - the first `/name` plus up to five more right after it, the terminal's skill stacking
// as far as a hook can tell it (a `/word` that is no skill still joins; that only moves where the request starts).
// The mode-like tokens right after the group are retired flags: stripped into `old`, they switch nothing. The first
// other token ends that run, so `--dry-run` and prose stay in the request.
const FLOW_FAMILY_RE = /^(?:alfred-code:)?(?:alfred-)?(?:task|capture|loop|issue|mode)-[a-z][a-z0-9-]*$/;
// The grader's skill names, the shipped one first: a copy, a typed stack or a run under the old name acts until 4.0.0.
const SCORING_SKILLS = Object.freeze(['mode-output-scoring', 'mode-output-scorer']);   // legacy name, until 4.0.0
const MODE_COMMAND_RE = /^\/alfred-code:mode:(scoring|auto-run|auto-compact)$/i;
const MODE_FIELD = { scoring: 'scoring', 'auto-run': 'autoRun', 'auto-compact': 'compact' };
const MODE_LIKE_RE = /^--(?:mode-[a-z][a-z0-9-]*|auto-mode|score-(?:on|off))$/;
const COMMAND_TOKEN_RE = /^\/[A-Za-z0-9:_-]+$/;
const COMMAND_GROUP_MAX = 6;
const commandSkill = (command) => bareSkill(String(command).replace(/^\//, ''));
function modeFlags(text)
{
    const flags = { commands: [], family: false, run: [], request: '', autoRun: null, scoring: null, compact: null, mode: null, extra: false, flagOnly: false,
        old: [], level: null, rounds: null };
    if (typeof text !== 'string') return flags;
    const tagged = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text);
    const line = tagged ? `/${tagged[1]} ${(/<command-args>([\s\S]*?)(?:<\/command-args>|$)/.exec(text) || [])[1] || ''}` : text;
    const tokens = [...line.matchAll(/\S+/g)];
    if (!tokens.length || !COMMAND_TOKEN_RE.test(tokens[0][0])) return flags;
    const mode = MODE_COMMAND_RE.exec(tokens[0][0]);
    if (mode)
    {
        // scoring alone takes one or two more tokens of digits after on or off - the level, then the rounds; the caller judges each range
        const slots = /^scoring$/i.test(mode[1]) && tokens.length >= 3 && tokens.length <= 4 && tokens.slice(2).every((t) => /^\d+$/.test(t[0])) ? tokens.slice(2).map((t) => t[0]) : [];
        const [level = null, rounds = null] = slots;
        const word = tokens.length === 2 || slots.length ? tokens[1][0].toLowerCase() : '';
        Object.assign(flags, { commands: [tokens[0][0]], family: true, flagOnly: true, mode: mode[1].toLowerCase(), extra: tokens.length > 1 && word !== 'on' && word !== 'off' });
        if (!flags.extra && word) Object.assign(flags, { [MODE_FIELD[flags.mode]]: word, level, rounds });
        return flags;
    }
    let i = 0;
    while (i < tokens.length && flags.commands.length < COMMAND_GROUP_MAX && COMMAND_TOKEN_RE.test(tokens[i][0])) flags.commands.push(tokens[i++][0]);
    while (i < tokens.length && MODE_LIKE_RE.test(tokens[i][0])) flags.run.push(tokens[i++][0]);
    flags.request = i < tokens.length ? line.slice(tokens[i].index).trim() : '';
    flags.family = flags.commands.some((c) => FLOW_FAMILY_RE.test(c.slice(1).toLowerCase()));
    flags.old = [...new Set(flags.run)];
    flags.flagOnly = flags.run.length > 0 && flags.request === '';
    // `/mode-auto-run <request>`: the typed request is its own waiver, so the line reads as an auto-run start (round-3 M3).
    if (flags.request && flags.commands.some((c) => commandSkill(c) === 'mode-auto-run')) flags.autoRun = 'on';
    return flags;
}
// Another session is RUNNING when its own transcript, beside this one, was written within the last ten minutes - the
// same idle span the docs hook reads as the user being away. A stamp left by a finished run, or by the session a
// fresh-session hand-off came from, is no live run, so a new start replaces it.
const OTHER_LIVE_MS = 10 * 60 * 1000;
function otherSessionLive(transcriptPath, otherSessionId)
{
    try
    {
        if (!transcriptPath || !/^[\w-]+$/.test(String(otherSessionId))) return false;
        const t = path.join(path.dirname(transcriptPath), `${otherSessionId}.jsonl`);
        return Date.now() - fs.statSync(t).mtimeMs <= OTHER_LIVE_MS;
    }
    catch { return false; }
}
// Why an auto-run start is refused, or '' - one check the start hook and the ON line share, so the line never lists
// a mode the start did not take (spec section 3).
function autoRunRefusal(input, env, flags)
{
    const payload = input && typeof input === 'object' ? input : {};
    const source = env || process.env;
    const f = flags && typeof flags === 'object' ? flags : modeFlags('');
    if (payload.agent_id) return 'a seat never starts auto-run';
    if (f.mode === 'auto-run') return '';   // the mode command writes the variable, never a stamp: no run or data root to refuse (D4)
    const commands = Array.isArray(f.commands) ? f.commands : [];
    if (!f.request && commands.some((c) => commandSkill(c) === 'mode-auto-run')) return 'type the request after /mode-auto-run';
    const root = source.CLAUDE_PROJECT_DIR || (typeof payload.cwd === 'string' ? payload.cwd : '');
    if (!root) return '';
    const current = approvalStamp({ ...payload, cwd: root }, source);
    const sid = String(payload.session_id || '');
    if (current && current.session && current.session !== sid && otherSessionLive(payload.transcript_path, current.session))
    {
        const rel = path.relative(root, current.file).split(path.sep).join('/') || current.file;
        return `another session (${current.session.slice(0, 8)}) is running a stamped run in this checkout right now, and ${rel} is its approval - `
            + `it ends with /alfred-code:mode:auto-run off there, or delete ${rel} to take over, then type the command again`;
    }
    let dir = layout ? path.dirname(layout.statePath(root, 'approvals', 'APPROVAL', source)) : path.resolve(root, '.alfred');
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    try { fs.accessSync(dir, fs.constants.W_OK); }
    catch { return 'the data root cannot be written'; }
    return '';
}
// Auto-run for this prompt: the family run's -off, its -on when nothing refuses it, else the root stamp live for this
// session and opening AUTO. One decision for communication-reminder's lines and the session status file; a throw is off.
function autoRunFor(input, env, flags)
{
    try
    {
        const payload = input && typeof input === 'object' ? input : {};
        if (flags && flags.autoRun === 'off') return false;
        // the prompt's own -on counts only while the hook that writes the stamp runs (R092): with it switched off no
        // stamp is written, so only a live stamp says ON
        if (flags && flags.autoRun === 'on' && !hookDisabled('guard-fresh-session-start', env) && !autoRunRefusal(payload, env, flags)) return true;
        const stamp = approvalStamp(payload, env);
        return Boolean(stamp && stamp.live && stamp.session && stamp.session === String(payload.session_id || '') && /^AUTO\b/.test(stamp.first));
    }
    catch { return false; }
}
// THE PLUGIN'S OWN COMMANDS ARE NEVER AUTO-RUN'S (the user's ruling, 2026-11-20): the stack's auto-run answers no ask of a
// typed /alfred-code:init, update, configure or validate - their walk asks go to the user; since B3 (2026-11-27) the same holds for
// every plugin's /<plugin>:init, update, configure, validate, install and setup (R4: an /alfred-tools:update ask was answered). A walk runs from its typed command
// to the next typed slash command or to its close. Inside it stay: a built-in command (its output row follows it), a mode
// command, a compaction whose summary names the walk, and a reply typed after an ask, a question or a cut-off tool call. A
// reply typed after the assistant's last text, when that text asks nothing, is the walk's close passed. A walk older than
// the transcript's tail is read from the whole file. Only the ask answering and communication-reminder's line read it: the readers
// of `unattended` still see auto-run as nobody at the terminal.
const PLUGIN_WALK_RE = /(?:<command-name>|^\s*)\/[a-z0-9-]+:(init|update|configure|validate|install|setup)(?=<\/command-name>|\s|$)/;
const SUMMARY_WALK_RE = /(?<![\w/.-])\/[a-z0-9-]+:(init|update|configure|validate|install|setup)\b/;
const WALK_MODE_COMMAND_RE = /(?:<command-name>|^\s*)\/alfred-code:mode:/;
const SLASH_PROMPT_RE = /^\s*(?:<command-(?:message|name)>|\/[A-Za-z][\w:-]*(?:\s|$))/;
const NOT_TYPED_RE = /^\s*<(?:bash-(?:input|stdout|stderr)|local-command-(?:stdout|stderr|caveat))\b/;
const LOCAL_OUTPUT_RE = /^\s*<local-command-(?:stdout|stderr)>/;
const WALK_TAIL_BYTES = 2 * 1024 * 1024;
const rowContentText = (row) => {
    const content = row && row.message && row.message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content) || content.some((b) => b && b.type === 'tool_result')) return null;
    const texts = content.filter((b) => b && b.type === 'text').map((b) => b.text || '');
    return texts.length ? texts.join('\n') : null;
};
// The text of a row the user typed, else null: a tool result, a meta, seat or harness row is no typed turn.
function typedPrompt(row)
{
    if (!row || row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary || !row.message) return null;
    const text = rowContentText(row);
    if (text === null || !text.trim() || harnessPrompt(text) || NOT_TYPED_RE.test(text)) return null;
    return text;
}
// The walk a prompt opens, '' for a slash command that ends one, 'keep' for one that leaves it as it is, null for a reply.
function walkOfPrompt(prompt)
{
    const text = String(prompt || '');
    const walk = PLUGIN_WALK_RE.exec(text);
    if (walk) return walk[1];
    if (WALK_MODE_COMMAND_RE.test(text)) return 'keep';
    return SLASH_PROMPT_RE.test(text) ? '' : null;
}
// Whether the assistant row closes its turn on text that asks nothing - the walk's close, when a reply follows it.
function closedOnText(row)
{
    const content = row && row.message && row.message.content;
    const last = Array.isArray(content) ? content.filter((b) => b && (b.type === 'text' || b.type === 'tool_use')).pop() : null;
    return Boolean(last && last.type === 'text' && !/\?\s*$/.test(String(last.text || '')));
}
// THE ONE FLOW-END RULE (card items 5, 7 and 12, 2026-11-23) - the compact state, the auto-run walk guard and the stop
// guard's solve-task cycle all read it. A flow a typed slash command or a Skill call opened ends at the first prompt the user
// types after it that is another slash command (a mode command excepted, and a built-in whose output row follows it), or a
// reply typed after an assistant turn that closed on text asking nothing - its close was passed. An answer to an ask, a
// reply to a question and one after a cut-off tool call stay inside. A compaction ends nothing by itself: the rows before
// it decide (a summary that only MENTIONS a walk kept a closed one open, fecb88be).
function promptEndsFlow(prompt, closedBefore)
{
    const walk = walkOfPrompt(prompt);
    if (walk === 'keep') return false;
    return walk !== null || Boolean(closedBefore);
}
// The rule for a reader that goes forward row by row and keeps `track` ({} to start; plain fields, so a reader may persist
// it): 'end' when this row's prompt ends the open flow, 'undo' when this row shows the last end was a built-in command's
// (its output row), else ''. A caller opening a flow on the same row applies the end first.
function flowEndStep(track, row)
{
    if (!row || row.isSidechain) return '';
    if (row.type === 'assistant')
    {
        const content = row.message && row.message.content;
        if (Array.isArray(content) && content.some((b) => b && (b.type === 'text' || b.type === 'tool_use'))) track.closed = closedOnText(row);
        return '';
    }
    if (row.type !== 'user') return '';
    if (track.slash && LOCAL_OUTPUT_RE.test(String(rowContentText(row) || ''))) { track.slash = false; return 'undo'; }
    const prompt = typedPrompt(row);
    if (prompt === null) return '';
    track.slash = walkOfPrompt(prompt) === '';
    const ends = promptEndsFlow(prompt, track.closed);
    track.closed = false;
    return ends ? 'end' : '';
}
// The plugin walk the rows end inside ('init', 'update', 'configure', 'validate', 'install' or 'setup'), '' for none, null when no row decides
// (no typed slash command and no compaction in the rows). `replyAfter`: a reply typed after the last row, the prompt now.
// Pure: rows are parsed objects.
function pluginWalkOf(rows, replyAfter = false)
{
    let ended = false;        // a reply typed after the walk's close
    let summarised = '';      // the walk a compaction summary names: kept only when the rows before it say it was open
    // the assistant row a reply at `at` answers: the newest one before it, never past an earlier typed row
    const replyAt = (at) =>
    {
        for (let k = at - 1; k >= 0; k--)
        {
            if (typedPrompt(rows[k]) !== null) return;
            if (rows[k] && rows[k].type === 'assistant') { if (closedOnText(rows[k])) ended = true; return; }
        }
    };
    if (replyAfter) replyAt(rows.length);
    for (let i = rows.length - 1; i >= 0; i--)
    {
        const row = rows[i];
        if (row && row.type === 'user' && row.isCompactSummary)
        {
            const named = SUMMARY_WALK_RE.exec(String(rowContentText(row) || ''));
            if (!named || ended) return '';
            summarised = summarised || named[1];
            continue;
        }
        const prompt = typedPrompt(row);
        const walk = walkOfPrompt(prompt);
        if (walk === null)
        {
            if (prompt !== null && promptEndsFlow(prompt, false) === false) replyAt(i);
            continue;
        }
        if (walk === 'keep') continue;
        const next = rows[i + 1];
        if (walk === '' && next && next.type === 'user' && LOCAL_OUTPUT_RE.test(String(rowContentText(next) || ''))) continue;
        return walk && !ended && (!summarised || walk === summarised) ? walk : '';
    }
    return null;
}
// The plugin walk this payload runs inside: this prompt's own command first, then the transcript - its tail, else the whole
// file when the tail decides nothing. A throw is ''.
function pluginWalkNow(input, prompt = null)
{
    try
    {
        const own = prompt === null ? null : walkOfPrompt(prompt);
        if (own !== null && own !== 'keep') return own;
        const file = input && input.transcript_path;
        if (!file) return '';
        const size = fs.statSync(file).size;
        const read = (from) =>
        {
            const fd = fs.openSync(file, 'r');
            let text = '';
            try { const buf = Buffer.alloc(size - from); fs.readSync(fd, buf, 0, buf.length, from); text = buf.toString('utf8'); }
            finally { fs.closeSync(fd); }
            const lines = text.split('\n');
            if (from > 0) lines.shift();
            const rows = [];
            for (const line of lines) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* a torn row */ } }
            return pluginWalkOf(rows, own === null && prompt !== null);
        };
        const from = Math.max(0, size - WALK_TAIL_BYTES);
        let walk = read(from);
        if (walk === null && from > 0) walk = read(0);
        return walk || '';
    }
    catch { return ''; }
}
// Why no fresh-session ask is made for this payload, else '': the project's variable (the mode file's, as the loader set it),
// then auto-run for this prompt - the typed line first (autoRunFor). The v1 session switch file is gone (mode commands v2).
const COMPACT_SAID = { project: 'ALFRED_CODE_AUTO_COMPACT=1', 'auto-run': 'auto-run is on' };
function compactCause(input, env = process.env, flags = null)
{
    try
    {
        if (String(envOf(env, 'AUTO_COMPACT') || '').trim() === '1') return 'project';
        return autoRunFor(input && typeof input === 'object' ? input : {}, env, flags) ? 'auto-run' : '';
    }
    catch { return ''; }
}
// The run marker: one per session, open while a run in auto-run goes (spec section 2). The Stop hold, its cap and the
// dispatch guard's run-active reads key on it; the mode itself lives in the root APPROVAL stamp for the session.
function runMarkerFile(root, sessionId, env = process.env)
{
    if (!layout || !root || !sessionId) return null;
    return layout.statePath(root, 'sessions', `AUTO-RUN-${safeSession(sessionId)}`, env);
}
// The run a typed line opens: its first flow command, past the scoring (a stack's grader opens no run) and past a
// `/mode-auto-run` with no request (a flag-only mode line switches, it opens nothing).
function runMarkerSkill(flags)
{
    const f = flags && typeof flags === 'object' ? flags : {};
    for (const command of Array.isArray(f.commands) ? f.commands : [])
    {
        const name = commandSkill(command);
        if (!FLOW_FAMILY_RE.test(name) || SCORING_SKILLS.includes(name) || (name === 'mode-auto-run' && !f.request)) continue;
        return name;
    }
    return '';
}
// The same skill, prompt and prompt id already on disk leave the file and its mtime: the cap of 50 counts per marker
// mtime, and a second expansion of one typed line must not reset it (round-3 M2). The line typed again is a new prompt
// with its own `prompt_id` (code.claude.com/docs/en/hooks, 'Common input fields'), so it rewrites the file and the cap
// counts from 1 (R096); a payload with no id keeps the skill and hash rule.
function writeRunMarker(root, sessionId, skill, promptText, env = process.env, promptId = '')
{
    const file = runMarkerFile(root, sessionId, env);
    if (!file || !skill) return false;
    const prompt = require('node:crypto').createHash('sha1').update(String(promptText || '')).digest('hex').slice(0, 12);
    const id = String(promptId || '').replace(/[^\w-]/g, '').slice(0, 64);
    try
    {
        const old = fs.readFileSync(file, 'utf8');
        if ((/^skill:[ \t]*(\S+)/m.exec(old) || [])[1] === skill && (/^prompt:[ \t]*(\S+)/m.exec(old) || [])[1] === prompt
            && ((/^prompt-id:[ \t]*(\S+)/m.exec(old) || [])[1] || '') === id) return true;
    }
    catch { /* none yet */ }
    try
    {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `skill: ${skill}\nprompt: ${prompt}\nat: ${new Date().toISOString()}\n${id ? `prompt-id: ${id}\n` : ''}`);
        return true;
    }
    catch { return false; }
}

// A UserPromptSubmit prompt the HARNESS wrote, not the user: a task notice, a command's output, and a seat's hand-back
// ('Another Claude session sent a message:' over an `<agent-message>` frame - its transcript row is `isMeta` with
// `origin.kind: peer`, which the payload does not carry). One test for every hook that reads a prompt as someone typing
// (audit 2026-10-14 HK14: a hand-back ended auto-mode, drew the answer budget - 351 of 960 injections in a week - and
// reset the turn of the since-removed session monitor).
const HARNESS_PROMPT_RE = /^\s*(?:<(?:task-notification|local-command-stdout|local-command-caveat|agent-message)\b|Another Claude session sent a message:)/;
function harnessPrompt(prompt)
{
    return HARNESS_PROMPT_RE.test(String(prompt || ''));
}

// IDLE COMPACTION (2026-10-30): Claude Code compacts a session on its own about an hour after the last reply, before the
// prompt cache expires (`idleCompaction`, on by default), once its context is at or over CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS
// (code.claude.com/docs/en/env-vars: default 200000, a value under 100000 raised to it, one that is no positive whole
// number ignored). Its boundary says only `trigger: auto`; the `system` / `informational` row after it ('Compacted while
// idle, ...') is written after the compact start's hooks run, so a hook judges by the timing and fresh-session.js's settle
// pass confirms from the notice. Such a compaction is no context limit, so it lowers no fresh-session trigger. The notice
// has two spellings: the terminal's, and VS Code's and the desktop app's ('Compacted using a summary written while you were
// away', code.claude.com/docs/en/settings-reference, 'Idle compaction in VS Code and the desktop app').
const IDLE_NOTICE_RE = /^Compacted (?:while idle\b|using a summary written while you were away\b)/;
const IDLE_GAP_MS = 50 * 60000;
// A session id a points row may join into a path: Claude Code's are UUIDs; a separator or a leading dot never steers a read.
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function idleFloor(env)
{
    const raw = String((env || process.env).CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS || '').trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : 0;
    return n > 0 ? Math.max(n, 100000) : 200000;
}
function isIdleNotice(row)
{
    if (!row || row.type !== 'system' || row.subtype !== 'informational') return false;
    const c = row.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text || '').join('') : '';
    return IDLE_NOTICE_RE.test(text);
}
// A user row that cannot start a model call: a compaction summary, a meta row (a local command's caveat, a reminder), a
// `!` line's rows and a local command's output. A command row (`<command-name>` / `<command-message>`) is judged by the
// caller: a local command's output row follows it, a prompt command's model call does not.
const LOCAL_ONLY_RE = /^\s*<(?:bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat)>/;
function localOnlyRow(row)
{
    if (!row || row.type !== 'user') return false;
    if (row.isMeta || row.isCompactSummary) return true;
    const c = row.message && row.message.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) && c[0] && c[0].type === 'text' ? String(c[0].text || '') : '';
    return LOCAL_ONLY_RE.test(text);
}
// The timing verdict: 50 minutes or more from the last reply to the compaction's start, nothing since that could start a
// model call, and the context at or over the idle floor.
function idleByTiming({ gapMs, promptSince, preTokens, floor } = {})
{
    if (![gapMs, preTokens, floor].every(Number.isFinite)) return false;
    return gapMs >= IDLE_GAP_MS && !promptSince && preTokens >= floor;
}

// TEXT A HOOK CANNOT READ (deep hooks review 2026-10-16, the user's ruling: the hooks read English only). Their word lists
// are English, so a text whose letters are 30% or more outside ASCII is one they cannot judge - measured, the Ukrainian the
// user and the model wrote read 72-100%, an English prompt quoting UI copy at most 29.7% - and each hook takes its safe
// side: an auto-mode ask waits for the user, a length is logged and not held. A Latin-script language reads as English and
// its words are missed by the lists, as they always were. (A commit consent is stricter: any non-ASCII letter in the
// quote, guard-ungated-commit.js.)
const UNREADABLE_SHARE = 0.3;
function unreadable(text)
{
    const letters = String(text || '').match(/\p{L}/gu) || [];
    if (!letters.length) return false;
    const foreign = letters.filter((c) => c > '\u007f').length;
    return foreign / letters.length >= UNREADABLE_SHARE;
}

// SHORT-LIVED LINKS (the user's ruling, 2026-10-14). A download link that carries its own short-lived token - Jira's
// media `?token=<JWT>`, good for about 10 minutes; an S3 presigned URL's `X-Amz-Credential=AKIA...` - matched the
// credential shapes, so the secret guard refused the fetch in every session and the stop contract could ask to rotate a
// token that expires by itself. A token in a URL's QUERY whose link states a lifetime of an hour or less - the JWT's own
// `exp` (and `exp - iat`, when it carries one), S3's `X-Amz-Expires` - is a capability for that fetch, not a login.
// `shortLivedLinks` names each one (host, seconds left, kind, never the value) and `withoutShortLived` blanks them out of
// a text, so every OTHER shape in it is still judged. A header, a token outside a URL, one with no lifetime or a longer
// one keeps every check. The JWT is decoded, never verified: a forged short `exp` buys nothing a forger did not have.
const SHORT_LIVED_MAX_S = 60 * 60;
const LINK_RE = /https?:\/\/[^\s'"`<>\\]+/gi;
const LINK_JWT_RE = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
function jwtClaims(token)
{
    try { return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
    catch { return null; }
}
function linkTokens(link, nowS)
{
    let url;
    try { url = new URL(link); }
    catch { return []; }
    const out = [];
    for (const [key, value] of url.searchParams)
    {
        if (!LINK_JWT_RE.test(value)) continue;
        const claims = jwtClaims(value);
        const exp = claims && typeof claims === 'object' ? Number(claims.exp) : NaN;
        const iat = claims && typeof claims === 'object' && claims.iat !== undefined ? Number(claims.iat) : null;
        if (!Number.isFinite(exp) || exp - nowS > SHORT_LIVED_MAX_S) continue;
        if (iat !== null && (!Number.isFinite(iat) || exp - iat > SHORT_LIVED_MAX_S)) continue;
        out.push({ token: value, key, host: url.host, seconds: Math.max(0, Math.round(exp - nowS)), kind: 'jwt' });
    }
    const credential = /^((?:AKIA|ASIA)[0-9A-Z]{16})\//.exec(url.searchParams.get('X-Amz-Credential') || '');
    const expires = Number(url.searchParams.get('X-Amz-Expires'));
    if (credential && url.searchParams.get('X-Amz-Signature') && Number.isFinite(expires) && expires > 0 && expires <= SHORT_LIVED_MAX_S)
        out.push({ token: credential[1], key: 'X-Amz-Credential', host: url.host, seconds: expires, kind: 's3' });
    return out;
}
// A JSON-escaped ampersand is the link's own `&`: a Go CLI's JSON prints `&`, and a transcript row escapes that
// backslash again.
const unescapeLinks = (text) => String(text || '').replace(/\\+u0026/g, '&');
function shortLivedLinks(text, now = Date.now())
{
    const out = [];
    for (const m of unescapeLinks(text).matchAll(LINK_RE)) out.push(...linkTokens(m[0], now / 1000));
    return out;
}
function withoutShortLived(text, now = Date.now())
{
    return unescapeLinks(text).replace(LINK_RE, (link) =>
    {
        let kept = link;
        for (const t of linkTokens(link, now / 1000)) kept = kept.split(t.token).join('<short-lived>');
        return kept;
    });
}

// Print mode: CLAUDE_CODE_ENTRYPOINT is the CLI's own answer (review A, M8) - 2.1.283 sets it to sdk-cli in print mode,
// rewriting an inherited cli, and keeps an SDK launch's own value: one read, no torn row, and right for a resumed
// session before its first new row. Set to anything, it decides; unset, the transcript's last `entrypoint` does.
function printMode(input, env = process.env)
{
    try
    {
        const source = env || process.env;
        const entry = String(source.CLAUDE_CODE_ENTRYPOINT || '').trim();
        if (entry) return entry === 'sdk-cli';
        const file = input && typeof input === 'object' && typeof input.transcript_path === 'string' ? input.transcript_path : '';
        return file !== '' && transcriptField(file, 'entrypoint') === 'sdk-cli';
    }
    catch { return false; }
}

function unattended(input, env)
{
    try
    {
        const source = env || process.env;
        if (String(source.ALFRED_CODE_UNATTENDED || '').trim() === '1') return true;
        // Auto-run alone is no absence (card item 11, 3d4c416d: three Stops judged 'nobody at the terminal' 28 s to 74 s
        // after the user typed): a live stamp reads as away only once the user's newest typed prompt is AWAY_AFTER_MS old.
        if (autoStampLive(input, source)) return userAway(input);
        return printMode(input, source);
    }
    catch { return false; }
}

// GATE 6. The payload alone says the host: Cursor sends `cursor_version`, and its event names are camelCase
// (`preToolUse`, `stop`) where Claude Code's are PascalCase. Anything else, junk included, is Claude.
function cursorHost(input)
{
    try
    {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
        if (typeof input.cursor_version === 'string' && input.cursor_version.trim() !== '') return true;
        return typeof input.hook_event_name === 'string' && /^[a-z]/.test(input.hook_event_name);
    }
    catch { return false; }
}

// Guards ask instead of block (2026-11-25). A guard that stops a PreToolUse call hands its reason to askOrBlock: where a
// person can answer, Claude Code's own permission prompt shows the guard's first sentence (Yes runs the call; No refuses it
// and ends the turn, and the model gets the full reason at the user's next message - asked-calls.js); where nobody can, the
// call is denied with the full reason, as before.
const ASKED_PREFIX = 'A guard asked the user about this call: ';
// After a No, Claude Code ends the turn and the model writes nothing until the user does (live, 2026-11-27, 2.1.332).
const ASK_RECOMMENDATION = 'Recommended: No, unless you meant this call - after a No, Claude stops until you write.';
const ASK_CONTEXT_MIDDLE = '. If the result shows the call ran, the user approved it - do not redo it. If the user declined: ';
const ASK_SENTENCE_MAX = 400;
const BLOCK_LEAD_RE = /^(?:Blocked|Held once): /;
const SENTENCE_END_RE = /^[\s\S]*?[.!?](?=\s|$)/;
// A code span (`...`) is read whole first, so a `.` or `..` path word inside one (`cd ..`) is no sentence stop; text with an
// unpaired backtick takes the plain read above.
const SPAN_SENTENCE_END_RE = /^(?:`[^`]*`|[^`])*?[.!?](?=\s|$)/;
const NO_ANSWER_MODES = new Set(['dontAsk', 'bypassPermissions']);
const SUBAGENT_HANDBACK = 'SubagentHandback';
const guardLabel = (guard) =>
{
    try { return guard ? `alfred-code ${guard}` : 'alfred-code'; }
    catch { return 'alfred-code'; }
};

// Whether a person can answer a prompt for this call. False for anything but a plain-object payload, the handback tool, a
// Cursor payload, a mode that never prompts, ALFRED_CODE_UNATTENDED=1, print mode and the rollback switch
// ALFRED_CODE_GUARD_ASK=0. It never reads the auto-run stamp: an idle user under auto-run is asked. A throw reads as false.
function canAsk(input, env = process.env)
{
    try
    {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
        if (input.tool_name === SUBAGENT_HANDBACK) return false;
        if (cursorHost(input)) return false;
        if (NO_ANSWER_MODES.has(input.permission_mode)) return false;
        const source = env || process.env;
        if (String(source.ALFRED_CODE_UNATTENDED || '').trim() === '1') return false;
        if (printMode(input, source)) return false;
        return String(envOf(source, 'GUARD_ASK') ?? '').trim() !== '0';
    }
    catch { return false; }
}

// The guard name an options argument carries; a missing or hostile argument gives ''.
function guardOf(opts)
{
    try { return (opts && opts.guard) || ''; }
    catch { return ''; }
}

// The reason as text; a reason whose conversion throws reads as the fallback line.
function reasonText(reason, guard)
{
    try { return String(reason); }
    catch { return `${guardLabel(guard)}: a guard blocked this call.`; }
}

// The first sentence of a reason for the prompt: a leading 'Blocked: ' or 'Held once: ' dropped, line breaks joined into
// spaces, cut after the first . ! or ? that a space or the end follows - a backtick code span read whole, never cut inside -
// capped at 400 characters (cut at a word, then '...').
function firstSentence(text)
{
    const joined = text.trim().replace(BLOCK_LEAD_RE, '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
    const cut = (SPAN_SENTENCE_END_RE.exec(joined) || SENTENCE_END_RE.exec(joined) || [joined])[0].trim();
    if (cut.length <= ASK_SENTENCE_MAX) return cut;
    const room = cut.slice(0, ASK_SENTENCE_MAX - 3);
    const atWord = room.lastIndexOf(' ');
    return `${(atWord > 0 ? room.slice(0, atWord) : room).trimEnd()}...`;
}

// A No at the prompt drops the hook's additionalContext, so the call is recorded for the next prompt's relay (asked-calls.js).
function recordAskedCall(input, guard, reason, opts)
{
    try { require('./asked-calls.js').recordAsked(input, guard, reason, (opts && opts.env) || process.env); }
    catch { /* an install without the module only loses the relay */ }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The verdict a block writes - never throws. `ask` carries the user's text and, as additionalContext, the model's, and is
// recorded for the relay after a No (a No drops that context; the runner's inner pass records a guard twice, and the note says it once);
// `deny` carries today's full reason and no additionalContext. `opts.updatedInput` (a plain object) rides an ask only:
// Claude Code runs an approved ask with it, so a Yes keeps the input change the guard writes on an allowed call.
function blockVerdict(input, reason, opts)
{
    let text;
    let guard = '';
    try
    {
        const { env = process.env, guard: named = '', updatedInput } = opts || {};
        guard = named;
        text = String(reason);
        const output = { hookEventName: 'PreToolUse' };
        if (!canAsk(input, env))
            return { decision: 'deny', hookSpecificOutput: { ...output, permissionDecision: 'deny', permissionDecisionReason: text } };
        recordAskedCall(input, guard, text, opts);
        const sentence = firstSentence(text) || 'a guard blocked this call.';
        const spoken = sentence.replace(/[.!?]+$/, '');
        return { decision: 'ask', hookSpecificOutput: { ...output, permissionDecision: 'ask',
            permissionDecisionReason: `${guardLabel(guard)}: ${sentence}\n${ASK_RECOMMENDATION}`,
            additionalContext: `${ASKED_PREFIX}${spoken}${ASK_CONTEXT_MIDDLE}${text}`,
            ...(isPlainObject(updatedInput) ? { updatedInput } : {}) } };
    }
    catch
    {
        return { decision: 'deny', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
            permissionDecisionReason: typeof text === 'string' ? text : `${guardLabel(guard)}: a guard blocked this call.` } };
    }
}

// Writes the verdict as the hook's one JSON object and returns the decision. A Cursor deny also writes the reason to stderr
// (blockExitCode then gives 2). Sets global.BLOCK_VERDICT for the block row. It never exits - the site does. A throw
// anywhere in it writes a fixed deny (never no output, which Claude Code reads as a hook error that lets the call run).
function askOrBlock(input, reason, opts)
{
    let wrote = false;
    try
    {
        const named = guardOf(opts);
        const verdict = blockVerdict(input, reason, opts);
        const denied = verdict.decision === 'deny';
        const said = denied ? verdict.hookSpecificOutput.permissionDecisionReason : reasonText(reason, named);
        global.BLOCK_VERDICT = { decision: verdict.decision, reason: said };
        wrote = true;
        try { process.stdout.write(JSON.stringify({ hookSpecificOutput: verdict.hookSpecificOutput })); } catch { /* a closed pipe */ }
        if (denied && cursorHost(input))
            try { process.stderr.write(`${said}\n`); } catch { /* a closed pipe */ }
        return verdict.decision;
    }
    catch
    {
        if (wrote) return 'deny';
        const said = reasonText(reason, guardOf(opts));
        try { global.BLOCK_VERDICT = { decision: 'deny', reason: said }; } catch { /* a hostile global */ }
        try
        {
            process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: said } }));
        }
        catch { /* a closed pipe */ }
        return 'deny';
    }
}

// The exit code a block site returns: 2 only for a deny on a Cursor payload, which reads exit 2 as the block.
const blockExitCode = (input, decision) => (decision === 'deny' && cursorHost(input) ? 2 : 0);

// GATE 6's call. A hook runs it ONCE, right after it has parsed its own payload (`if (prelude.cursorStandDown(
// payload, __filename)) process.exit(0)`): true only for a Cursor payload and a NON-protective hook, never for
// a CLI invocation. No stdin is read here - the hook already holds the payload, so no bounded read moves and
// nothing is patched. scripts/hook-prelude.test.js fails when a non-protective hook file lacks the call.
function cursorStandDown(input, file, argv)
{
    try
    {
        if (isCliInvocation(argv)) return false;
        const name = baseName(path.basename(String(file || '')));
        if (!name || PROTECTIVE.has(name) || CURSOR_RUNS.has(name)) return false;
        return cursorHost(input);
    }
    catch { return false; }
}

// The one call every hook makes: true means do nothing at all, exit 0, print nothing. `setUp: false` skips
// GATE 4 alone - for a hook that keeps one check live in a repo never set up and reads neverSetUp() itself
// (the dispatch guard's implementer gate, M9). `twin: false` leaves GATE 3 to the caller: a hook run as its own process
// calls yieldToCopiedTwin once it has read the payload's session (E-batch final review M1).
function standDown(hook, env, argv, { setUp = true, call, twin = true } = {})
{
    try
    {
        if (isCliInvocation(argv)) return false;
        return hookDisabled(hook, env) || profileOff(hook, env) || (twin && yieldToCopiedTwin(hook, env, call))
            || (setUp && neverSetUp(env) && !PROTECTIVE.has(baseName(hook)));
    }
    catch { return false; }
}

// THE STOP CHAIN (hooks audit 2026-10-08, S1). Three hooks can block a Stop (the stop contract,
// docs-session, the turn build check; answer length did until 2026-10-20), and `stop_hook_active` is true whenever Claude Code continues because ANY of
// them blocked ('true when Claude Code is already continuing as a result of a stop hook' - code.claude.com/docs/en/
// hooks, Stop input). A blocker that stood down on the flag alone never judged the close rewritten after a SIBLING's
// block ('Build fixed. Should I commit?' passed the stop contract). So each blocker marks its own block
// (markStopHeld) and stands down on a continuation only when IT held this cycle (stopHeldThisCycle): every blocker
// judges each rewritten close once more and blocks at most ONCE per cycle, so three blockers make at most three
// continuations - never a loop - with Claude Code's 8-consecutive-continuation cap the outer guard. A Stop with the
// flag false opens a new cycle and clears the hook's marker. Where a marker could not be written (an unwritable dir)
// a continuation stands down, the old reading - judging again there could block again.
function stopMarkerFile(hook, input, env)
{
    const dir = envOf(env || process.env, 'HOOK_LOG_DIR') || os.tmpdir();
    const part = (s) => String(s || '').replace(/[^\w.-]/g, '_').slice(-80);
    return path.join(dir, `alfred-stop-held-${baseName(hook)}-${part(input.hook_event_name)}-${part(input.session_id || 'nosession')}-${part(input.agent_id || 'main')}`);
}

// opts.workSince (opt-in, the stop contract): a continuation that made a TOOL CALL after this hook's own block is new
// work, and its close is judged again - the marker is cleared and the cycle reopens (audit 2026-10-11 SD10, session
// 31da645f: after a prose-ask block the continuation ran an ask, a Skill, an Edit and a check, then closed on a new
// prose question nothing judged). A rewritten close with no call between stays held, so the once-per-close guard holds.
function toolCallSince(transcriptPath, sinceMs)
{
    const size = fs.statSync(transcriptPath).size;
    const from = Math.max(0, size - 2 * 1024 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - from);
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1)
    {
        const line = lines[i];
        if (!line.includes('"tool_use"') || !line.includes('"assistant"')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (!o || o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
        const at = Date.parse(o.timestamp || '');
        if (!Number.isFinite(at) || at <= sinceMs) continue;
        if (o.message.content.some((b) => b && b.type === 'tool_use')) return true;
    }
    return false;
}

function stopHeldThisCycle(hook, input, env, opts)
{
    if (!input || typeof input !== 'object' || !input.stop_hook_active)
    {
        try { if (input && typeof input === 'object') fs.rmSync(stopMarkerFile(hook, input, env), { force: true }); } catch { /* the next block rewrites it */ }
        return false;
    }
    try
    {
        const file = stopMarkerFile(hook, input, env);
        if (fs.existsSync(file))
        {
            if (opts && opts.workSince && input.hook_event_name === 'Stop' && typeof input.transcript_path === 'string')
            {
                let reopen = false;
                // the block's time is the ISO stamp markStopHeld wrote (a coarse-mtime file system rounds the mtime down)
                try
                {
                    const stamped = Date.parse(fs.readFileSync(file, 'utf8').trim());
                    reopen = toolCallSince(input.transcript_path, Math.max(fs.statSync(file).mtimeMs, Number.isFinite(stamped) ? stamped : 0));
                }
                catch { /* unreadable: held */ }
                if (reopen)
                {
                    fs.rmSync(file, { force: true });
                    return false;
                }
            }
            return true;
        }
        fs.accessSync(path.dirname(file), fs.constants.W_OK);
        return false;
    }
    catch { return true; }
}

function markStopHeld(hook, input, env)
{
    try { fs.writeFileSync(stopMarkerFile(hook, input, env), new Date().toISOString()); } catch { /* stopHeldThisCycle stands down where this cannot write */ }
}

// STATE HYGIENE (audit 2026-10-08 S9). The hooks' per-session state - the stop contract's markers and log, the
// fresh-session offers, the read guard's range logs, the Stop-chain markers above and
// `trivial-*` - was never pruned. sweepStale removes the FILES in `dir` named with `prefix` and untouched for 7 days,
// once per (dir, prefix) per process, inside a 50ms budget of its own (the docs-session sweep's pattern: a bounded,
// fail-silent pass a hook makes when it writes its own state). A file exactly at the cutoff is kept.
// The pass runs at most once a DAY per (dir, prefix) across processes: a stamp beside the state records the last one,
// so a hook call pays one stat, not a listing of the temp dir. Measured 2026-10-09: the two listings a Stop made of a
// 52,840-entry macOS temp dir were 78ms of a 136ms hook (47ms with the stamp), and the budget never bounded the listing.
// A folder inside the project that resolves outside it (a `sessions` link to another tree) is never stamped or swept:
// `project` (default CLAUDE_PROJECT_DIR) is compared by path, then by real path, and a throw reads as 'do not sweep'.
const STALE_MS = 7 * 24 * 3600 * 1000;
const STALE_BUDGET_MS = 50;
const SWEEP_EVERY_MS = 24 * 3600 * 1000;
const sweptStale = new Set();
const sweepStamp = (dir, prefix) => path.join(dir, `.alfred-sweep-${String(prefix).replace(/[^\w-]/g, '_')}`);
const underPath = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
// The path-only test folds case whatever the platform: a false 'inside' only sends the folder on to the real-path test.
const lowerPath = (p) => path.resolve(p).toLowerCase();
const realKey = (p) =>
{
    if (layout && layout.dirKey) return layout.dirKey(p);
    const real = path.resolve(fs.realpathSync.native(p));
    return path.sep === '\\' ? real.toLowerCase() : real;
};
function leavesProject(dir, project = process.env.CLAUDE_PROJECT_DIR)
{
    try
    {
        if (!project || !underPath(lowerPath(dir), lowerPath(project))) return false;
        return !underPath(realKey(dir), realKey(project));
    }
    catch { return true; }
}
function sweepStale(dir, prefix, { now = Date.now(), maxAgeMs = STALE_MS, everyMs = SWEEP_EVERY_MS, project = process.env.CLAUDE_PROJECT_DIR } = {})
{
    const key = `${dir}\u0000${prefix}`;
    if (!dir || !prefix || sweptStale.has(key)) return 0;
    sweptStale.add(key);
    if (leavesProject(dir, project)) return 0;
    const stamp = sweepStamp(dir, prefix);
    try { if (now - fs.statSync(stamp).mtimeMs < everyMs) return 0; } catch { /* no stamp yet - this call sweeps */ }
    // Claimed before the pass, so parallel hooks do not all list the dir; a dir that takes no stamp holds none of our state.
    try { fs.writeFileSync(stamp, ''); const t = new Date(now); fs.utimesSync(stamp, t, t); } catch { return 0; }
    const deadline = Date.now() + STALE_BUDGET_MS;
    let removed = 0;
    try
    {
        for (const name of fs.readdirSync(dir))
        {
            if (!name.startsWith(prefix)) continue;
            if (Date.now() > deadline) break;
            const file = path.join(dir, name);
            try
            {
                const st = fs.lstatSync(file);
                if (st.isFile() && now - st.mtimeMs > maxAgeMs) { fs.rmSync(file, { force: true }); removed++; }
            }
            catch { /* gone or unreadable - the next sweep */ }
        }
    }
    catch { /* no dir */ }
    return removed;
}
// An append-only log past `maxBytes` keeps its newest `keepBytes`, cut at a line start.
function capLog(file, maxBytes = 1024 * 1024, keepBytes = 256 * 1024)
{
    try
    {
        const size = fs.statSync(file).size;
        if (size <= maxBytes) return false;
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(Math.min(keepBytes, size));
        try { fs.readSync(fd, buf, 0, buf.length, size - buf.length); } finally { fs.closeSync(fd); }
        const nl = buf.indexOf(0x0a);
        fs.writeFileSync(file, nl >= 0 ? buf.subarray(nl + 1) : buf);
        return true;
    }
    catch { return false; }
}


// THE SCORING'S SHARED STATE (mode-output-scoring, 2026-10-25). communication-reminder reads it for the injected lines and the
// flags, the stop contract for the backstop and the seal, so both judge one state from one reader.
//
// Prose only: code blocks, tables, quotes, inline spans and link targets are dropped, so a name the user quotes is talk,
// never a request. communication-reminder.js keeps its own copy, since it runs without this file (prose-of in
// meta/shared-rules.json holds the two bodies equal).
function proseOf(text)
{
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*\|.*$/gm, '')
        .replace(/^\s*>.*$/gm, '')
        .replace(/`[^`\n]*`/g, '')
        .replace(/\]\([^)\s]*\)/g, ']')
        .replace(/\s+/g, ' ')
        .trim();
}

// Whether the model can load a library skill: `absent` (no personal or project copy - the core's own stack/skills
// source in the plugin cache is never one), else skillOverrides, the most local file first - `off` hides it,
// `user-invocable-only` keeps it from the model but not from the user's typed command - else `on`.
function skillCopyState(root, name, env = process.env)
{
    const cfg = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || env.USERPROFILE || '', '.claude');
    if (![path.join(cfg, 'skills', name, 'SKILL.md'), path.join(root, '.claude', 'skills', name, 'SKILL.md')].some((f) => fs.existsSync(f))) return 'absent';
    for (const f of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(cfg, 'settings.json')])
    {
        let o;
        try { o = JSON.parse(fs.readFileSync(f, 'utf8')).skillOverrides; } catch { continue; }
        if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, name))
        {
            const v = String(o[name]);
            return v === 'off' || v === 'user-invocable-only' ? v : 'on';
        }
    }
    return 'on';
}
const oursLoadable = (root, ours, env = process.env) => skillCopyState(root, ours, env) === 'on';

// The automatic outputs, in the order every list of them is printed, and the phrase the injected line names each by.
const SCORING_AUTOMATIC = Object.freeze(['designer-plan', 'root-cause', 'inline-plan']);
const SCORING_PHRASES = Object.freeze({ 'designer-plan': 'designer plan file', 'root-cause': 'root-cause verdict', 'inline-plan': 'inline plan for work started now' });
function wholeIn(value, min, max, otherwise)
{
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (!/^\d+$/.test(s)) return otherwise;
    const n = Number(s);
    return n >= min && n <= max ? n : otherwise;
}
const scoringLevel = (env = process.env) => wholeIn(envOf(env, 'SCORING_LEVEL'), 60, 100, 80);
const scoringRounds = (env = process.env) => wholeIn(envOf(env, 'SCORING_ROUNDS'), 1, 10, 3);
// The csv read case-insensitively and trimmed; a name outside the three is reported back. Unset, empty (an empty value is
// unset, as layout.js valueIn reads it) or a list naming no valid output is the catalog default, plan files only (B1,
// 2026-11-03): all three names grade every output.
const SCORING_OUTPUTS_DEFAULT = Object.freeze(['designer-plan']);
function scoringOutputs(env = process.env)
{
    const names = String(envOf(env, 'SCORING_OUTPUTS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const outputs = SCORING_AUTOMATIC.filter((n) => names.includes(n));
    return { outputs: outputs.length ? outputs : [...SCORING_OUTPUTS_DEFAULT], ignored: [...new Set(names.filter((n) => !SCORING_AUTOMATIC.includes(n)))] };
}

// A session id as a file or folder name: a separator, a space or any other character outside [\w.-] becomes `_`, and a
// whole `.` or `..` is `_`, so no id names a path outside the scoring's folder (R31).
function safeSession(id)
{
    const s = String(id === undefined || id === null ? '' : id).replace(/[^\w.-]/g, '_');
    return /^\.*$/.test(s) ? '_' : s;
}
const scoringPath = (prefix) => (root, sessionId, env = process.env) => (layout ? layout.statePath(root, 'sessions', `${prefix}${safeSession(sessionId)}`, env) : null);
// The backstop's one-hold-per-cycle marker and the names an ignored ALFRED_CODE_SCORING_OUTPUTS entry was already reported
// under - one sweep prefix takes both (and the v1 session switch files it leaves behind).
const scoringHeldFile = scoringPath('SCORING-HELD-');
const scoringNotedFile = scoringPath('SCORING-NOTED-');
// Usable first: either hook standing down or its `scoring` part switched off, or no loadable copy of the skill, makes the
// scoring unusable - no line, no hold, stacks included. A user-invocable-only copy still grades a typed stack, so it is
// usable but never on by itself. Then ALFRED_CODE_SCORING (on when unset, B1), which the mode file sets through the loader.
// Mode inheritance D3: where the scoring switch's value came from - the workspace member whose mode file holds it, else the env.
function scoringSource(root, env)
{
    try
    {
        const entry = require('./mode-settings.js').inheritedMode(root, 'ALFRED_CODE_SCORING', env);
        return entry ? `inherited from ${entry.from}` : 'env';
    }
    catch { return 'env'; }
}
function scoringState(root, sessionId, env = process.env)
{
    const state = { usable: false, on: false, level: 80, rounds: 3, outputs: [...SCORING_AUTOMATIC], ignored: [], source: 'env', copy: null };
    try
    {
        Object.assign(state, { level: scoringLevel(env), rounds: scoringRounds(env), ...scoringOutputs(env) });
        state.source = scoringSource(root, env);
        if (standDown('communication-reminder', env, []) || partOff('communication-reminder', 'scoring', env)
            || standDown('guard-stop-contract', env, []) || partOff('guard-stop-contract', 'scoring', env)) return state;
        const copy = SCORING_SKILLS.map((n) => skillCopyState(root, n, env)).find((c) => c !== 'absent') || 'absent';
        state.copy = copy;   // the ON line tells a user-invocable-only copy from a switch that is off
        if (copy === 'absent' || copy === 'off') return state;
        state.usable = true;
        if (copy === 'user-invocable-only') return state;
        state.on = switchOn('SCORING', env);
        return state;
    }
    catch { return { ...state, usable: false, on: false }; }
}

// A typed stack names the skill as a word of the prose: the slash form anywhere, a `<command-args>` row counting (the `>`
// and `<`), or the bare name right after a usage word - 'using', 'with', 'via', 'run', 'stack', 'through'. A bare name in
// other prose ('why did mode-output-scoring not run?') is talk about the tool, never a stack (final review 4).
const STACK_RE = /(?:^|[\s(>])(?:\/|(?:using|with|via|run|stack|through)\s+(?:the\s+)?)mode-output-scor(?:ing|er)(?=[\s.,;:)!?<]|$)/i;
const stackNamed = (text) => STACK_RE.test(proseOf(String(text || '')));

// The skills that READ a plan rather than write one (the backstop's T2 exemption), and the names producerMarks looks for.
const PLAN_READERS = Object.freeze(['task-implement', 'task-verify-plan', 'task-verify-code']);
const MARKED = Object.freeze([...PLAN_READERS, ...SCORING_SKILLS]);
// The names in `names` one raw transcript row marks: an assistant Skill call, or a typed user row (never a tool result)
// holding a `<command-name>`. A row cut short, or not JSON, marks nothing.
function producerMarks(line, names = MARKED)
{
    let row;
    try { row = JSON.parse(line); } catch { return []; }
    const found = new Set();
    const content = row && row.message && row.message.content;
    if (row && row.type === 'assistant' && Array.isArray(content))
        for (const c of content) if (c && c.type === 'tool_use' && c.name === 'Skill' && c.input) found.add(bareSkill(String(c.input.skill || '').replace(/^\//, '')));
    if (row && row.type === 'user')
    {
        const texts = typeof content === 'string' ? [content]
            : Array.isArray(content) && !content.some((c) => c && c.type === 'tool_result') ? content.filter((c) => c && c.type === 'text').map((c) => String(c.text || '')) : [];
        for (const t of texts) for (const m of t.matchAll(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/g)) found.add(bareSkill(m[1]));
    }
    return names.filter((n) => found.has(n));
}

// The draft folders, `<dir>/<session>/<slug>/`, which sweepStale (files only) does not take: a session folder goes once
// its newest file is older than STALE_MS (an empty one by its own time), at most once a day per dir, inside the same
// 50ms budget. A symlink is never followed, and a folder that leaves the project through a link is never stamped or swept (leavesProject).
function sweepScoringFolders(dir, { now = Date.now(), project = process.env.CLAUDE_PROJECT_DIR } = {})
{
    if (!dir || leavesProject(dir, project)) return 0;
    const stamp = sweepStamp(dir, 'scoring');
    try { if (now - fs.statSync(stamp).mtimeMs < SWEEP_EVERY_MS) return 0; } catch { /* no stamp yet - this call sweeps */ }
    try { fs.writeFileSync(stamp, ''); const t = new Date(now); fs.utimesSync(stamp, t, t); } catch { return 0; }
    const deadline = Date.now() + STALE_BUDGET_MS;
    const newest = (at, depth) =>
    {
        let n = -Infinity;
        for (const e of fs.readdirSync(at, { withFileTypes: true }))
        {
            const p = path.join(at, e.name);
            if (e.isFile()) n = Math.max(n, fs.statSync(p).mtimeMs);
            else if (e.isDirectory() && depth < 3) n = Math.max(n, newest(p, depth + 1));
        }
        return n;
    };
    let removed = 0;
    try
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (!e.isDirectory()) continue;
            if (Date.now() > deadline) break;
            const at = path.join(dir, e.name);
            try
            {
                const n = newest(at, 1);
                if (now - (n === -Infinity ? fs.statSync(at).mtimeMs : n) > STALE_MS) { fs.rmSync(at, { recursive: true, force: true }); removed++; }
            }
            catch { /* gone or unreadable - the next sweep */ }
        }
    }
    catch { /* no dir */ }
    return removed;
}

// THE SCAN BUDGET - how much a guard reads before it stops and judges the rest UNREAD, the one home every guard reads
// (2.1.6 re-verify 3 R3-M3, R3-m4). A shell command a guard judges can carry scripts it reads from disk, git aliases it
// expands, and scripts nested in scripts. Two limits bound it, both counts of WORK, never elapsed time - a verdict must
// not depend on how loaded the machine is (a wall-clock budget failed its own tests at a load average of 58):
// - bytes: the characters scanned - each text is charged before it is parsed (`take`): the command, every script read
//   from disk, every alias pass. The parsers are linear, so the count bounds the time on every machine;
// - depth: scripts nested in scripts (`deep`).
// - gitJudged: the destructive git calls the rm guard asks git about, one to three spawns each (`judge`); the rest of a
//   command that holds more is read as one whole-tree discard, never let through (2.1.6 seam review m4).
// Past either, `why` names the limit and the caller judges what is left CONSERVATIVELY - asked or gated like an alias
// that cannot be read, never let through: the verdict must not flip to allowed on size alone (a 1.1MB script writing
// outside was allowed where the same text at 0.99MB was denied, re-verify 3).
const SCAN_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, depth: 3, gitJudged: 48 });
function scanBudget(limits = {})
{
    const lim = { ...SCAN_LIMITS, ...limits };
    let bytes = 0;
    let judged = 0;
    let why = '';
    return {
        limits: lim,
        take(n)
        {
            bytes += Math.max(0, Number(n) || 0);
            if (!why && bytes > lim.bytes) why = `the ${lim.bytes}-byte scan budget`;
            return !why;
        },
        over: () => !!why,
        deep: (depth) => depth >= lim.depth,
        judge: () => ++judged <= lim.gitJudged,
        get why() { return why; },
        get bytes() { return bytes; },
    };
}

// GIT FROM A HOOK (audit 2026-10-20 H2) - the one spawn shape for every git a hook runs. A hook runs before the
// permission prompt, often in a repository the model only NAMED (a Read of a file in a sibling clone, a `cd` into a
// downloaded tree): a `core.fsmonitor` that repository's own config names is a program git starts on any status-like
// read, and an optional lock is a write. `gitSafe(argv, opts)` returns spawnSync / execFileSync's arguments with both
// switched off: `spawnSync(...gitSafe(['status'], { cwd }))`. The engines copied without this file (docs.js,
// history.js) spell the same two inline; a test sweeps every hook file for a git spawn that does neither.
// The temp roots a scratch write or a scratch commit lands under, realpathed: os.tmpdir(), and the harness's per-user
// scratch root /tmp/claude-<uid> with its macOS /private spelling (POSIX only). One home for guard-ungated-commit.js's
// scratch-commit rule and docs-session.js's scratch-write rule (usage audit 2026-11-03 U27-2).
function tempRoots()
{
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const realOr = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    return [...new Set([os.tmpdir(), ...(uid != null ? [`/tmp/claude-${uid}`, `/private/tmp/claude-${uid}`] : [])].map(realOr))];
}
const GIT_SAFE_CONFIG = Object.freeze(['-c', 'core.fsmonitor=false']);
function gitSafe(argv, opts = {})
{
    // windowsHide: a console window flashes on Windows without it
    return ['git', [...GIT_SAFE_CONFIG, ...argv], { ...opts, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true }];
}

// AN ASK NOBODY ANSWERED (ruling S3, 2026-10-20): Claude Code 2.1.304 closes an AskUserQuestion left idle past its
// auto-continue timeout itself - the tool result carries `afkTimeoutMs` ('Set when the dialog auto-resolved ...
// Absent on every human-resolved path', the bundle's output schema) and the model reads 'No response after <N>s - the
// user may be away from keyboard. Proceed using your best judgment ...' (code.claude.com/docs/en/tools-reference,
// 'Question auto-continue timeout'). That is no answer: no approval, no consent, no pick. `askTimedOut` takes the PostToolUse
// `tool_response`, a transcript row's `toolUseResult` or the result text; `askTimeoutMarker` is the per-session file the
// answer hook writes on a timeout and removes on the next answer or typed prompt, which the dispatch guard reads.
const ASK_TIMEOUT_RE = /\bNo response after \d+\s*s\s*(?:\u2014|\u2013|-{1,2})\s*the user may be away from keyboard/i;
function askTimedOut(response)
{
    if (response && typeof response === 'object' && !Array.isArray(response) && Number(response.afkTimeoutMs) > 0) return true;
    let text = '';
    try { text = typeof response === 'string' ? response : JSON.stringify(response || ''); } catch { return false; }
    return ASK_TIMEOUT_RE.test(String(text || ''));
}
function askTimeoutMarker(sessionId, env = process.env)
{
    const part = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_').slice(-80);
    return path.join(envOf(env, 'HOOK_LOG_DIR') || os.tmpdir(), `alfred-ask-timeout-${part}`);
}

// THE TOOL RESULT OF ONE CALL, read from the transcript's tail (the walk's byte budget, the raw-needle reader of the
// typed-row judges above). `{ found: true, isError, text }` for the newest row whose `tool_result` block carries the id; `{ found:
// false }` for no id, no file, an unreadable or torn one, or a result older than the tail (`tailBytes`, the walk's budget by default) - it never throws. `declinedByUser`
// is Claude Code's own rejection of a permission prompt: an error result that opens 'The user doesn't want to proceed with
// this tool use. The tool use was rejected' (read from real transcripts, 2026-11-26; the prompt of a hook `ask` ends the same
// way). The words are the host's, so a deny a hook wrote - 'hook error', 'Blocked: ' - is none.
const TOOL_RESULT_NOT_FOUND = Object.freeze({ found: false });
const DECLINED_OPENING_RE = /^\s*The user doesn['\u2019]t want to proceed with this tool use\. The tool use was rejected/;
function toolResultOf(transcriptPath, toolUseId, { tailBytes = WALK_TAIL_BYTES } = {})
{
    try
    {
        if (!transcriptPath || typeof transcriptPath !== 'string' || !toolUseId || typeof toolUseId !== 'string') return TOOL_RESULT_NOT_FOUND;
        const size = fs.statSync(transcriptPath).size;
        let found = null;
        linesWith(transcriptPath, [`"tool_use_id":${JSON.stringify(toolUseId)}`], (line) =>
        {
            const row = rowOf(line);
            const content = row && row.type === 'user' && row.message && row.message.content;
            const block = Array.isArray(content) ? content.find((b) => b && b.type === 'tool_result' && b.tool_use_id === toolUseId) : null;
            if (!block) return;
            const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('') : '';
            found = { found: true, isError: block.is_error === true, text };
        }, Math.max(0, size - tailBytes));
        return found || TOOL_RESULT_NOT_FOUND;
    }
    catch { return TOOL_RESULT_NOT_FOUND; }
}
const declinedByUser = (result) => Boolean(result && result.found && result.isError === true && typeof result.text === 'string' && DECLINED_OPENING_RE.test(result.text));

// A REVIEW, whatever its spelling - the one home of these words since 2026-10-22, when the session-start guard began to
// snapshot a review the commit guard judges. Every rename of a review (a 1.x `project-` name, the 2.0.0 `alfred-` prefix,
// a loop's older word order) kept the words that say what it reviews, so the kind is read from those words - never from
// a copy of the old names, which live only in the manifest's renamed map (guard-commit-gate.test.js runs each of its
// review rows through the gate). A loop needs `loop` in its name: a capture of the same words is no review.
const bareSkill = (s) => String(s || '').trim().toLowerCase().replace(/^[\w-]+:/, '').replace(/^alfred-/, '');
function reviewKind(s)
{
    const b = bareSkill(s);
    const verify = /(?:^|-)verify-(code|plan)$/.exec(b);
    if (verify) return `verify-${verify[1]}`;
    if (/(?:^|-)loop(?:-|$)/.test(b))
    {
        if (/(?:^|-)architecture-quality(?:-|$)/.test(b)) return 'loop-architecture-quality';
        if (/(?:^|-)test-coverage(?:-|$)/.test(b)) return 'loop-test-coverage-quality';
        if (/(?:^|-)quality(?:-|$)/.test(b)) return 'loop-code-quality';
    }
    return b;
}
// capture-quality's three parts and the topic words that pick each (2026-10-29): the one code home of the words - the
// router's topic table is the model's copy, held to this by lint check 70b.
const QUALITY_TOPICS = Object.freeze({
    'architecture-quality': Object.freeze(['architecture-quality', 'architecture']),
    'code-quality': Object.freeze(['code-quality', 'code']),
    'test-coverage-quality': Object.freeze(['test-coverage-quality', 'test-coverage', 'coverage']),
});
// An older copy's name runs its part for the update's skew window (spec A4), read from the words every rename kept - a
// capture's `capture-` word or the 2.0.0 `project-<part>-analyzer` shape, then the part's own words - never from a list
// of old names, which only the manifest's renamed map holds (its renamedTopics).
const OLD_CAPTURE = /^capture-|^project-[\w-]+-analyzer$/;
const OLD_PART = [
    ['architecture-quality', /(?:^|-)architecture-quality(?:-|$)/],
    ['test-coverage-quality', /(?:^|-)test-coverage(?:-|$)/],
    ['code-quality', /(?:^|-)code-quality(?:-|$)/],
];
// The part a capture-quality call runs: its first word past the mode flags, case-folded, looked up in QUALITY_TOPICS; a
// word holding a path character, or none, is the chain. '' for any other skill.
function qualityPart(skill, args)
{
    const b = bareSkill(skill);
    if (b !== 'capture-quality')
    {
        const hit = OLD_CAPTURE.test(b) && OLD_PART.find(([, re]) => re.test(b));
        return hit ? hit[0] : '';
    }
    const word = (String(args || '').trim().split(/\s+/).filter((w) => !MODE_LIKE_RE.test(w))[0] || '').toLowerCase();
    if (!word || /[/\\.]/.test(word)) return 'chain';
    return Object.keys(QUALITY_TOPICS).find((part) => QUALITY_TOPICS[part].includes(word)) || 'chain';
}
// A review the checkpoint names: the house verify skills and loops, review-code and review-security, or a verifier /
// reviewer seat - never Claude Code's built-in reviews (2026-10-22, the user's ruling 'use ours').
const REVIEW_SKILL = /(?:^|:)(?:(?:project-|task-)?verify-(?:code|plan)|quality-loop|(?:alfred-)?loop-(?:quality|code-quality|architecture-quality|test-coverage(?:-quality)?)|review-(?:code|security))$/i;
const REVIEW_SEAT = /verifier|reviewer/i;
// A call that reviews the CODE: a review skill other than the plan review, which reads none, or a review seat.
function codeReviewCall(tool, name)
{
    const n = String(name || '').trim();
    if (!n) return false;
    return tool === 'Skill' ? REVIEW_SKILL.test(n) && reviewKind(n) !== 'verify-plan' : REVIEW_SEAT.test(n);
}

// WHAT A REVIEW WAS POINTED AT (a sixth side note; the user's ruling 'Match path targets', 2026-10-22): review-code and
// review-security read their first arguments as the target, so the files and folders those arguments name that exist
// (resolved from `base`, realpaths) are what such a review covered; arguments that name no existing path - a branch, a
// PR - cover none of the uncommitted change. Null - the whole change - for one with no target argument (the change set)
// and for task-verify-code and a loop, which review the change. A seat's target is its brief (briefTargets below).
function reviewTargets(name, args, base)
{
    const kind = reviewKind(name);
    if (kind !== 'review-code' && kind !== 'review-security') return null;
    const words = String(args || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const out = [];
    let named = false;
    for (let i = 0; i < words.length; i++)
    {
        const w = words[i].replace(/^["']|["']$/g, '');
        if (w === '--depth') { i++; continue; }
        if (!w || w.startsWith('-')) continue;
        named = true;
        try { out.push(fs.realpathSync.native(path.resolve(base || process.cwd(), w))); } catch { /* a branch, a PR or no such path */ }
    }
    return named ? out : null;
}
// Whether a review pointed at `targets` covered the file at `abs` (a realpath).
function reviewCovers(targets, abs)
{
    return !targets || targets.some((t) => abs === t || abs.startsWith(t.endsWith(path.sep) ? t : t + path.sep));
}
// What a review SEAT was pointed at (2026-10-22, the user's 'Fix ALL left gaps': a seat cleared every file): its brief.
// A brief that reads the whole uncommitted change - `git diff` with no range, no second revision, no `--no-index` and no
// pathspec - covers the whole change (null). Otherwise the paths it names that exist, as review-code's arguments are read
// (a word shaped like a path: a `/` inside it, a trailing `/` or a file extension; a `:line` suffix dropped). A brief
// naming neither covers nothing ([]): what the seat read is free text no hook can judge.
function briefTargets(prompt, base)
{
    const text = String(prompt || '');
    for (const m of text.matchAll(/\bgit(?:\s+-C\s+\S+)?\s+diff\b([^\n;&|)`]*)/g))
    {
        const words = m[1].trim().split(/\s+/).filter(Boolean);
        if (words.includes('--') || words.includes('--no-index') || words.some((w) => w.includes('..'))) continue;
        if (words.filter((w) => !w.startsWith('-')).length <= 1) return null;
    }
    const out = new Set();
    for (const raw of text.split(/[\s,;()[\]{}<>]+/))
    {
        const w = raw.replace(/^[`'"@*]+|[`'"*.,:!?]+$/g, '').replace(/:\d+(?:[-:]\d+)*$/, '');
        if (!w || !(/[\w*.-]\/[\w*.-]/.test(w) || /\/$/.test(w) || /^[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(w))) continue;
        try { out.add(fs.realpathSync.native(path.resolve(base || process.cwd(), w))); } catch { /* names no path */ }
    }
    return [...out];
}
// The line a review's RESULT opens with (2026-10-22, the user's 'Fix ALL left gaps': a Skill review counted once it
// launched): `Findings:` for the reviews whose report carries that field - review-code, review-security, task-verify-code,
// task-verify-plan - and `Outcome:` for a loop's final report; bold, a list marker or a table cell around the word,
// and a ` - ` after it, count. A review counts once the session's text after its call - the model's own, or a seat's
// report - holds the line.
const REVIEW_PROOF = Object.freeze({ findings: /^[ \t>|*_-]*Findings(?:\*\*|__)?[ \t]*(?::|\||-[ \t])/m, outcome: /^[ \t>|*_-]*Outcome(?:\*\*|__)?[ \t]*(?::|\||-[ \t])/m });
const reviewProof = (name) => (/^loop-/.test(reviewKind(name)) ? 'outcome' : 'findings');

// THE REVIEW SNAPSHOT (2026-10-22, a side agent's note; the user's ruling 'Snapshot at review'). The commit guard asks
// for a review that started after the last change to every committed file, and a file's time moves when its code does
// not - a stash and pop, a branch round-trip. So when a review of the code starts, the session-start guard records the
// hash of every file the change holds, and the commit guard passes a file changed since whose bytes still match - only
// for a call that counted (its `id`, the call's tool_use_id: neither refused nor unfinished in the transcript). Byte for
// byte only (the user's 'Fix ALL left gaps', 2026-10-22): a whitespace-blind match passed a line moved out of a Python
// `if`, spacing inside a string and `rm -rf / tmp` for `/tmp`. Kept per session, the newest `kept` reviews; a file past
// `bytes`, past the first `files`, or past `total` bytes read for the call, is not recorded, so its time alone decides -
// the stricter rule, never a pass; `total` keeps the hashing well inside the hook's 10s timeout (review 2026-10-23). A
// review pointed at paths records only the files it covered (`targets`, reviewTargets and briefTargets above). One file
// per call, `review-snapshot-<session>@<call>.json`: two seats dispatched in one message start two hooks at once, and a
// shared file read, extended and renamed by each kept only the last one's snapshot (review 2026-10-23).
const REVIEW_SNAPSHOT = Object.freeze({ files: 2000, bytes: 4 * 1024 * 1024, total: 64 * 1024 * 1024, kept: 8, prefix: 'review-snapshot-' });
const snapshotName = (part) => String(part).replace(/[^\w.-]/g, '_').slice(-80);
// The session's snapshot files: the folder, and the name prefix every one of them carries.
function reviewSnapshotFile(root, sessionId, env = process.env)
{
    if (!layout || !sessionId) return null;
    const file = layout.statePath(root, 'sessions', `${REVIEW_SNAPSHOT.prefix}${snapshotName(sessionId)}@`, env);
    return file ? { dir: path.dirname(file), prefix: path.basename(file) } : null;
}
const contentHash = (buf) => require('node:crypto').createHash('sha1').update(buf).digest('hex');
function snapshotReview(root, sessionId, { env = process.env, now = Date.now(), toolUseId = null, targets = null, limits = REVIEW_SNAPSHOT } = {})
{
    const where = reviewSnapshotFile(root, sessionId, env);
    if (!where) return false;
    try
    {
        const { execFileSync } = require('node:child_process');
        const run = (argv, cwd) => execFileSync(...gitSafe(['-c', 'core.quotePath=false', ...argv], { cwd, timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).toString('utf8');
        const top = fs.realpathSync.native(run(['rev-parse', '--show-toplevel'], root).trim());
        let changed;
        try { changed = run(['diff', 'HEAD', '--name-only', '-z'], top); }
        catch { changed = run(['ls-files', '-c', '-z'], top); }   // no commit yet: every tracked file is new
        const names = [...new Set([...changed.split('\0'), ...run(['ls-files', '-o', '--exclude-standard', '-z'], top).split('\0')].filter(Boolean))];
        const files = {};
        let read = 0;
        for (const rel of names.slice(0, limits.files))
        {
            const abs = path.join(top, rel);
            if (!reviewCovers(targets, abs)) continue;
            try
            {
                const st = fs.statSync(abs);
                if (!st.isFile() || st.size > limits.bytes || read + st.size > limits.total) continue;
                read += st.size;
                files[abs] = contentHash(fs.readFileSync(abs));
            }
            catch { /* removed in the change: nothing to hold */ }
        }
        fs.mkdirSync(where.dir, { recursive: true });
        const file = path.join(where.dir, `${where.prefix}${snapshotName(toolUseId || `t${now}-${process.pid}`)}.json`);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ ts: now, id: toolUseId || null, files }));
        fs.renameSync(tmp, file);
        // the newest `kept` stay; another call's hook pruning at the same moment removes the same files
        for (const old of snapshotFiles(where).slice(limits.kept)) fs.rmSync(old.file, { force: true });
        sweepStale(where.dir, REVIEW_SNAPSHOT.prefix);
        return true;
    }
    catch { return false; }
}
// The session's snapshot files, newest first, each read back - an unreadable one is skipped.
function snapshotFiles(where)
{
    let names;
    try { names = fs.readdirSync(where.dir).filter((n) => n.startsWith(where.prefix) && n.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const n of names)
    {
        const file = path.join(where.dir, n);
        try
        {
            const r = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (r && r.files && typeof r.files === 'object') out.push({ file, review: r });
        }
        catch { /* half-written or garbage: holds nothing */ }
    }
    return out.sort((a, b) => (Number(b.review.ts) || 0) - (Number(a.review.ts) || 0));
}
function readReviewSnapshots(root, sessionId, env = process.env)
{
    const where = reviewSnapshotFile(root, sessionId, env);
    return where ? snapshotFiles(where).slice(0, REVIEW_SNAPSHOT.kept).map((s) => s.review) : [];
}
// Whether one of those reviews saw what `abs` holds now - or `content`, another version of it (its staged copy) - byte
// for byte.
function heldByReview(reviews, abs, content)
{
    if (!reviews.length) return false;
    let now;
    try { now = contentHash(content || fs.readFileSync(abs)); } catch { return false; }
    return reviews.some((r) => r.files[abs] === now);
}

// The dashes the house voice replaces with a single dash - the em-dash, the en-dash and the horizontal bar - ONE class for
// the stop contract's ask deny (the answer hook's Stop block shared it until 2026-10-20; they disagreed before audit 2026-10-08).
const HOUSE_DASH = /[\u2014\u2013\u2015]/;

module.exports = { HOUSE_DASH, transcriptField, toolResultOf, declinedByUser, blockingStdio, hookDisabled, partOff, PART_SWITCHES, HOOK_RENAMED, hookProfile, profileOff, switchOn, HOOK_PROFILES, STRICT_ON, yieldToCopiedTwin, useSession, writeTwinSnapshot, twinSnapshot, neverSetUp, cursorHost, cursorStandDown, checkoutsOf, INSTALL_RECORDS, PROTECTIVE, standDown, isCliInvocation, unattended, autoStampLive, approvalStamp, autoStampVerified, FLOW_FAMILY_RE, MODE_LIKE_RE, modeFlags, typedAutoEvent, OTHER_LIVE_MS, otherSessionLive, autoRunRefusal, autoRunFor, COMPACT_SAID, compactCause, runMarkerFile, runMarkerSkill, writeRunMarker, harnessPrompt, IDLE_NOTICE_RE, IDLE_GAP_MS, SESSION_ID_RE, idleFloor, isIdleNotice, localOnlyRow, idleByTiming, unreadable, UNREADABLE_SHARE, shortLivedLinks, withoutShortLived, SHORT_LIVED_MAX_S, AUTO_STAMP_MAX_MS, COPIED_PREFIX, CORE_PLUGIN, envOf, stopHeldThisCycle, markStopHeld, stopMarkerFile, scanBudget, SCAN_LIMITS, gitSafe, GIT_SAFE_CONFIG, tempRoots, ASK_TIMEOUT_RE, askTimedOut, askTimeoutMarker, sweepStale, sweepStamp, leavesProject, capLog, STALE_MS, SWEEP_EVERY_MS, bareSkill, reviewKind, REVIEW_SKILL, QUALITY_TOPICS, qualityPart, REVIEW_SEAT, codeReviewCall, reviewTargets, reviewCovers, briefTargets, REVIEW_PROOF, reviewProof, REVIEW_SNAPSHOT, snapshotReview, readReviewSnapshots, heldByReview, proseOf, skillCopyState, oursLoadable, SCORING_SKILLS, SCORING_AUTOMATIC, SCORING_PHRASES, scoringLevel, scoringRounds, scoringOutputs, safeSession, scoringHeldFile, scoringNotedFile, scoringState, STACK_RE, stackNamed, PLAN_READERS, producerMarks, sweepScoringFolders };
Object.assign(module.exports, { printMode, canAsk, blockVerdict, askOrBlock, blockExitCode, ASKED_PREFIX, autoRunStanding, autoLasts, byUser, pluginWalkOf, pluginWalkNow, promptEndsFlow, flowEndStep, userAway, AWAY_AFTER_MS });   // beside the one-line list, which a new name would push past 160
