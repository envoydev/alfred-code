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
// opens, and a repo nobody ran /alfred-code:setup in carries none of the rules the guards enforce -
// so a plugin-launched hook there does nothing and writes nothing (no `.alfred/docs/` ledger or
// history in a repo merely opened: R54). Set up means an install record in the project's `.claude/`,
// or its git top level's, or - for a linked worktree - the main checkout's: the stamp, or a copied
// engine. A copied hook is set up by definition. Four guards stay live even there (R86, IM2), each
// skipping its block row: what they stop cannot be undone, and a user-scope core is the only guard
// a repo never set up has.
//
// GATE 5 - the hook profile. The core entry's `hook_profile` userConfig (minimal / standard / strict,
// set in /config and stored in the ACCOUNT settings' `pluginConfigs` - never a project file) reaches
// every plugin hook as CLAUDE_PLUGIN_OPTION_HOOK_PROFILE. `minimal` keeps the four PROTECTIVE guards
// only; `standard`, absent or anything unknown is today's set; `strict` is standard with the seeded-off
// switches that are safe on read as on (STRICT_ON - the Stop build check). The project's csv still wins:
// a hook it names stays off under every profile. A copied hook gets no option variable, so it reads
// as standard.
//
// GATE 6 - a Cursor host. Cursor loads Claude Code hooks by default (a compatibility toggle) and turns a
// Claude Stop block into an automatic follow-up with no loop limit, so a hook that asks or blocks can loop
// a Cursor session forever. Under a Cursor PAYLOAD (cursorHost: a `cursor_version` field, or a camelCase
// event name - Claude's are PascalCase) only the four PROTECTIVE guards run; every other hook stands down
// silently and writes no ledger row, as under GATE 4. Judged from the payload ALONE, never from the
// environment: a `claude` session in Cursor's integrated terminal inherits Cursor's variables and keeps
// every hook. A hook makes the check itself, right after it parsed its own payload (cursorStandDown), so no
// stdin is read or patched here; anything unparseable is a Claude payload.
//
// Every gate FAILS OPEN. A hook that cannot read the settings file, or reads junk, runs normally: a
// guard that goes silent on a malformed file is a guard an attacker turns off by corrupting a file.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
// os.homedir() throws on Windows when USERPROFILE is set but empty - every hook loads this file, so it never may.
const homeDir = () => { try { return os.homedir() || process.env.HOME || ''; } catch { return process.env.HOME || ''; } };
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

function profileOff(hook, env)
{
    return hookProfile(env) === 'minimal' && !PROTECTIVE.has(baseName(hook));
}

// A hook's own on-switch (`ALFRED_CODE_<suffix>=1`), with the profile applied: strict reads a STRICT_ON
// switch as on over the seeded 0. The csv needs no case here - a hook it names stood down before this.
function switchOn(suffix, env)
{
    const source = env || process.env;
    if (STRICT_ON.has(suffix) && hookProfile(source) === 'strict') return true;
    return String(envOf(source, suffix) || '').trim() === '1';
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
// itself and skips its block row there instead. The desktop exec gate joined them (final review IM2, the
// user's ruling of 2026-09-29): the macOS Shell it gates is a shell the other three never see.
const PROTECTIVE = new Set(['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push', 'guard-desktop-exec']);

// UNATTENDED - nobody is at the terminal, so a Stop block or an offer reaches no person: it only buys
// the model another turn (pilot 2, 2026-09-27: 8 of 12 print-mode cells ended on 'docs ok', nine
// em-dash blocks re-sent finished answers). Not a gate every hook runs - the hooks that ASK call it at
// the ask; a denial that protects something never does. True on ALFRED_CODE_UNATTENDED=1 (exactly
// '1', init-plan.js's switch), or when the transcript's newest row carrying an `entrypoint` says
// `sdk-cli`: every conversation row of a `claude -p` transcript does, an interactive one says `cli`,
// and bookkeeping rows (last-prompt, atis-latch, cost-state) carry none (measured, 12 pilot-2 cells).
// The newest row decides, so a resumed session is judged by who is there now. Anything unreadable - no
// file, an empty one, a torn or garbage LAST row - is a person: the behaviour they expect.
const TRANSCRIPT_WINDOWS = [256 * 1024, 8 * 1024 * 1024];

function transcriptEntrypoint(file)
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
            if (isRow && typeof row.entrypoint === 'string') return row.entrypoint;
        }
        // Nothing complete in this window: one row longer than it - read the wider one.
        if (start === 0 || !last) return null;
    }
    return null;
}

function unattended(input, env)
{
    try
    {
        const source = env || process.env;
        if (String(source.ALFRED_CODE_UNATTENDED || '').trim() === '1') return true;
        // The CLI's own answer first (review A, M8): 2.1.283 sets CLAUDE_CODE_ENTRYPOINT to sdk-cli in print mode,
        // rewriting an inherited cli, and keeps an SDK launch's own value - one read, no torn row, and right for a
        // resumed session before its first new row. Set to anything, it decides; unset, the transcript does.
        const entry = String(source.CLAUDE_CODE_ENTRYPOINT || '').trim();
        if (entry) return entry === 'sdk-cli';
        const file = input && typeof input === 'object' && typeof input.transcript_path === 'string' ? input.transcript_path : '';
        return file !== '' && transcriptEntrypoint(file) === 'sdk-cli';
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
        if (!name || PROTECTIVE.has(name)) return false;
        return cursorHost(input);
    }
    catch { return false; }
}

// The one call every hook makes: true means do nothing at all, exit 0, print nothing. `setUp: false` skips
// GATE 4 alone - for a hook that keeps one check live in a repo never set up and reads neverSetUp() itself
// (the dispatch guard's implementer gate, M9).
function standDown(hook, env, argv, { setUp = true } = {})
{
    try
    {
        if (isCliInvocation(argv)) return false;
        return hookDisabled(hook, env) || profileOff(hook, env) || yieldToCopiedTwin(hook, env)
            || (setUp && neverSetUp(env) && !PROTECTIVE.has(baseName(hook)));
    }
    catch { return false; }
}

// THE STOP CHAIN (hooks audit 2026-10-08, S1). Four hooks can block a Stop (the stop contract, answer length,
// docs-session, the turn build check), and `stop_hook_active` is true whenever Claude Code continues because ANY of
// them blocked ('true when Claude Code is already continuing as a result of a stop hook' - code.claude.com/docs/en/
// hooks, Stop input). A blocker that stood down on the flag alone never judged the close rewritten after a SIBLING's
// block ('Build fixed. Should I commit?' passed the stop contract). So each blocker marks its own block
// (markStopHeld) and stands down on a continuation only when IT held this cycle (stopHeldThisCycle): every blocker
// judges each rewritten close once more and blocks at most ONCE per cycle, so four blockers make at most four
// continuations - never a loop - with Claude Code's 8-consecutive-continuation cap the outer guard. A Stop with the
// flag false opens a new cycle and clears the hook's marker. Where a marker could not be written (an unwritable dir)
// a continuation stands down, the old reading - judging again there could block again.
function stopMarkerFile(hook, input, env)
{
    const dir = envOf(env || process.env, 'HOOK_LOG_DIR') || os.tmpdir();
    const part = (s) => String(s || '').replace(/[^\w.-]/g, '_').slice(-80);
    return path.join(dir, `alfred-stop-held-${baseName(hook)}-${part(input.hook_event_name)}-${part(input.session_id || 'nosession')}-${part(input.agent_id || 'main')}`);
}

function stopHeldThisCycle(hook, input, env)
{
    if (!input || typeof input !== 'object' || !input.stop_hook_active)
    {
        try { if (input && typeof input === 'object') fs.rmSync(stopMarkerFile(hook, input, env), { force: true }); } catch { /* the next block rewrites it */ }
        return false;
    }
    try
    {
        const file = stopMarkerFile(hook, input, env);
        if (fs.existsSync(file)) return true;
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
// fresh-session offers, the read guard's range logs, the Stop-chain markers above, `<docs>/flow/monitor-*` and
// `trivial-*` - was never pruned. sweepStale removes the FILES in `dir` named with `prefix` and untouched for 7 days,
// once per (dir, prefix) per process, inside a 50ms budget of its own (the docs-session sweep's pattern: a bounded,
// fail-silent pass a hook makes when it writes its own state). A file exactly at the cutoff is kept.
const STALE_MS = 7 * 24 * 3600 * 1000;
const STALE_BUDGET_MS = 50;
const sweptStale = new Set();
function sweepStale(dir, prefix, { now = Date.now(), maxAgeMs = STALE_MS } = {})
{
    const key = `${dir}\u0000${prefix}`;
    if (!dir || !prefix || sweptStale.has(key)) return 0;
    sweptStale.add(key);
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

// Did `hook` (another Stop blocker) hold this cycle, at or after `sinceMs` (this turn's typed prompt)? Read-only - the
// answer-length hook's yield to the stop contract. The two run in parallel on a turn's first Stop, so a false there
// only drops the yield line; on a continuation the sibling's marker is on disk.
function stopHeldBy(hook, input, sinceMs, env)
{
    try
    {
        const st = fs.statSync(stopMarkerFile(hook, input, env));
        return !Number.isFinite(sinceMs) || st.mtimeMs >= sinceMs;
    }
    catch { return false; }
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

// The dashes the house voice replaces with a single dash - the em-dash, the en-dash and the horizontal bar - ONE class for
// the stop contract's ask deny and the answer-length Stop block, which disagreed ([\u2014\u2013] vs [\u2014\u2015], audit 2026-10-08).
const HOUSE_DASH = /[\u2014\u2013\u2015]/;

module.exports = { HOUSE_DASH, hookDisabled, hookProfile, profileOff, switchOn, HOOK_PROFILES, STRICT_ON, yieldToCopiedTwin, neverSetUp, cursorHost, cursorStandDown, checkoutsOf, INSTALL_RECORDS, PROTECTIVE, standDown, isCliInvocation, unattended, COPIED_PREFIX, CORE_PLUGIN, envOf, stopHeldThisCycle, markStopHeld, stopHeldBy, stopMarkerFile, scanBudget, SCAN_LIMITS, sweepStale, capLog, STALE_MS };
