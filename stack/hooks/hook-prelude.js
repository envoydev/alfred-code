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
// 2.8.0: the approval stamp lives in <data root>/state/approvals/ (layout.js, beside this file on both routes); the pre-2.8.0
// <docs>/flow/ is still read for the 2.x line, and is the only path when layout.js is not there.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }

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

// A hook's OLD name in the csv still switches it off (audit 2026-10-20, the hooks track's minor list: the csv is the
// user's own text, and an update never rewrites it). Old name -> new, the manifest's `renamed.hooks`, copied here so the
// prelude stays standalone; hook-prelude.test.js holds the two equal.
const HOOK_RENAMED = Object.freeze({ 'guard-answer-length': 'guard-answer' });
function hookDisabled(hook, env)
{
    const source = env || process.env;
    const off = String(envOf(source, 'HOOKS_OFF') || '');
    if (!off.trim()) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    return off.split(',').map(baseName).filter(Boolean).map((n) => HOOK_RENAMED[n] || n).includes(wanted);
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
    return off.split(',').some((entry) => {
        const at = entry.indexOf(':');
        return at > 0 && `${baseName(entry.slice(0, at))}:${entry.slice(at + 1).trim().toLowerCase()}` === wanted;
    });
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

// A live AUTO waiver is nobody at the terminal too (audit 2026-10-10 C08 / C09). The user's 'take every recommended
// option' is written to <data root>/state/approvals/APPROVAL with an `AUTO - "<their words>"` first line, and the dispatch guard reads
// it as consent for THIS session only: under 8h old and not written before the session's transcript was born (a
// birthtime equal to the ctime is a filesystem's fallback, unknown - the age cap still holds). While it is live a
// person-directed ask has nobody to answer it - measured: a fresh-session Stop block demanding an ask while three
// seats ran under AUTO (9a4ef375), and a post-compaction 'ask the user' that a literal follower would have ended an
// overnight run on (c6142301). The project root is the env's or the payload's own cwd, never this process's cwd.
const AUTO_STAMP_MAX_MS = 8 * 60 * 60 * 1000;
// A stamp an auto-mode start writes (guard-fresh-session-start.js, `--auto-mode` opening a task, capture, loop or issue call) names its session on
// a `session: <id>` line. It is live for THAT session for as long as the run takes - an unattended loop outlives the 8h a
// hand-written stamp gets - and never for another session in the same project, which the age and birth checks cannot
// tell apart from it. A week is the backstop for a stamp whose run died without its close.
const SESSION_STAMP_MAX_MS = 7 * 24 * 60 * 60 * 1000;
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
        if (planId && !layout) return null;
        const file = planId ? layout.approvalPath(root, planId, source)
            : layout ? layout.findState(root, 'approvals', 'APPROVAL', source) : path.resolve(root, envOf(source, 'DOCS_PATH') || `${envOf(source, 'DATA_PATH') || '.alfred'}/docs`, 'flow', 'APPROVAL');
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
        return { file, first, session, skill, live, mtimeMs: stamp.mtimeMs };
    }
    catch { return null; }
}
function autoStampLive(input, env)
{
    const stamp = approvalStamp(input, env);
    return Boolean(stamp && stamp.live && /^AUTO\b/.test(stamp.first));
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

function unattended(input, env)
{
    try
    {
        const source = env || process.env;
        if (String(source.ALFRED_CODE_UNATTENDED || '').trim() === '1') return true;
        if (autoStampLive(input, source)) return true;
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
const STALE_MS = 7 * 24 * 3600 * 1000;
const STALE_BUDGET_MS = 50;
const SWEEP_EVERY_MS = 24 * 3600 * 1000;
const sweptStale = new Set();
const sweepStamp = (dir, prefix) => path.join(dir, `.alfred-sweep-${String(prefix).replace(/[^\w-]/g, '_')}`);
function sweepStale(dir, prefix, { now = Date.now(), maxAgeMs = STALE_MS, everyMs = SWEEP_EVERY_MS } = {})
{
    const key = `${dir}\u0000${prefix}`;
    if (!dir || !prefix || sweptStale.has(key)) return 0;
    sweptStale.add(key);
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


// THE SCORER'S SHARED STATE (habits-output-scorer, 2026-10-25). guard-answer reads it for the injected lines and the
// flags, the stop contract for the backstop and the seal, so both judge one state from one reader.
//
// Prose only: code blocks, tables, quotes, inline spans and link targets are dropped, so a name the user quotes is talk,
// never a request. guard-answer.js keeps its own copy, since it runs without this file (prose-of in
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
const SCORER_AUTOMATIC = Object.freeze(['designer-plan', 'root-cause', 'inline-plan']);
const SCORER_PHRASES = Object.freeze({ 'designer-plan': 'designer plan file', 'root-cause': 'root-cause verdict', 'inline-plan': 'inline plan' });
function wholeIn(value, min, max, otherwise)
{
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (!/^\d+$/.test(s)) return otherwise;
    const n = Number(s);
    return n >= min && n <= max ? n : otherwise;
}
const scorerLevel = (env = process.env) => wholeIn(envOf(env, 'SCORER_LEVEL'), 60, 100, 80);
const scorerRounds = (env = process.env) => wholeIn(envOf(env, 'SCORER_ROUNDS'), 1, 10, 3);
// The csv read case-insensitively and trimmed; a name outside the three is reported back, and no valid name is all three.
function scorerOutputs(env = process.env)
{
    const names = String(envOf(env, 'SCORER_OUTPUTS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const outputs = SCORER_AUTOMATIC.filter((n) => names.includes(n));
    return { outputs: outputs.length ? outputs : [...SCORER_AUTOMATIC], ignored: [...new Set(names.filter((n) => !SCORER_AUTOMATIC.includes(n)))] };
}

// A session id as a file or folder name: a separator, a space or any other character outside [\w.-] becomes `_`, and a
// whole `.` or `..` is `_`, so no id names a path outside the scorer's folder (R31).
function safeSession(id)
{
    const s = String(id === undefined || id === null ? '' : id).replace(/[^\w.-]/g, '_');
    return /^\.*$/.test(s) ? '_' : s;
}
const scorerPath = (prefix) => (root, sessionId, env = process.env) => (layout ? layout.statePath(root, 'sessions', `${prefix}${safeSession(sessionId)}`, env) : null);
// The session's switch (`on` / `off` from --score-on / --score-off), the backstop's one-hold-per-cycle marker, and the
// names an ignored ALFRED_CODE_SCORER_OUTPUTS entry was already reported under - one sweep prefix takes all three.
const scorerFile = scorerPath('SCORER-');
const scorerHeldFile = scorerPath('SCORER-HELD-');
const scorerNotedFile = scorerPath('SCORER-NOTED-');
function readScorerFile(root, sessionId, env = process.env)
{
    try
    {
        const file = scorerFile(root, sessionId, env);
        if (!file) return null;
        const first = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
        return first === 'on' || first === 'off' ? first : 'garbage';
    }
    catch { return null; }
}
// Usable first: either hook standing down or its `scorer` part switched off, or no loadable copy of the skill, makes the
// scorer unusable - no line, no hold, stacks included. A user-invocable-only copy still grades a typed stack, so it is
// usable but never on by itself. Then the session's flag file, else ALFRED_CODE_SCORER; a garbage file reads as absent.
function scorerState(root, sessionId, env = process.env)
{
    const state = { usable: false, on: false, level: 80, rounds: 3, outputs: [...SCORER_AUTOMATIC], ignored: [], source: 'env', file: null };
    try
    {
        Object.assign(state, { level: scorerLevel(env), rounds: scorerRounds(env), ...scorerOutputs(env) });
        state.file = readScorerFile(root, sessionId, env);
        if (standDown('guard-answer', env, []) || partOff('guard-answer', 'scorer', env)
            || standDown('guard-stop-contract', env, []) || partOff('guard-stop-contract', 'scorer', env)) return state;
        const copy = skillCopyState(root, 'habits-output-scorer', env);
        if (copy === 'absent' || copy === 'off') return state;
        state.usable = true;
        if (copy === 'user-invocable-only') return state;
        if (state.file === 'on' || state.file === 'off') { state.source = 'flag'; state.on = state.file === 'on'; }
        else state.on = switchOn('SCORER', env);
        return state;
    }
    catch { return { ...state, usable: false, on: false }; }
}

// A typed stack names the skill as a word of the prose: the slash form anywhere, a `<command-args>` row counting (the `>`
// and `<`), or the bare name right after a usage word - 'using', 'with', 'via', 'run', 'stack', 'through'. A bare name in
// other prose ('why did habits-output-scorer not run?') is talk about the tool, never a stack (final review 4).
const STACK_RE = /(?:^|[\s(>])(?:\/|(?:using|with|via|run|stack|through)\s+(?:the\s+)?)habits-output-scorer(?=[\s.,;:)!?<]|$)/i;
const stackNamed = (text) => STACK_RE.test(proseOf(String(text || '')));

// The skills that READ a plan rather than write one (the backstop's T2 exemption), and the names producerMarks looks for.
const PLAN_READERS = Object.freeze(['task-implement', 'task-verify-plan', 'task-verify-code']);
const MARKED = Object.freeze([...PLAN_READERS, 'habits-output-scorer']);
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
// 50ms budget. A symlink is never followed.
function sweepScorerFolders(dir, { now = Date.now() } = {})
{
    if (!dir) return 0;
    const stamp = sweepStamp(dir, 'scorer');
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
// history.js, memory.js) spell the same two inline; a test sweeps every hook file for a git spawn that does neither.
const GIT_SAFE_CONFIG = Object.freeze(['-c', 'core.fsmonitor=false']);
function gitSafe(argv, opts = {})
{
    return ['git', [...GIT_SAFE_CONFIG, ...argv], { ...opts, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' } }];
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
        if (/(?:^|-)test-coverage(?:-|$)/.test(b)) return 'loop-test-coverage';
        if (/(?:^|-)quality(?:-|$)/.test(b)) return 'loop-code-quality';
    }
    return b;
}
// A review the checkpoint names: the house verify skills and loops, review-code and review-security, or a verifier /
// reviewer seat - never Claude Code's built-in reviews (2026-10-22, the user's ruling 'use ours').
const REVIEW_SKILL = /(?:^|:)(?:(?:project-|task-)?verify-(?:code|plan)|quality-loop|(?:alfred-)?loop-(?:quality|code-quality|architecture-quality|test-coverage)|review-(?:code|security))$/i;
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

module.exports = { HOUSE_DASH, blockingStdio, hookDisabled, partOff, PART_SWITCHES, HOOK_RENAMED, hookProfile, profileOff, switchOn, HOOK_PROFILES, STRICT_ON, yieldToCopiedTwin, neverSetUp, cursorHost, cursorStandDown, checkoutsOf, INSTALL_RECORDS, PROTECTIVE, standDown, isCliInvocation, unattended, autoStampLive, approvalStamp, harnessPrompt, unreadable, UNREADABLE_SHARE, shortLivedLinks, withoutShortLived, SHORT_LIVED_MAX_S, AUTO_STAMP_MAX_MS, COPIED_PREFIX, CORE_PLUGIN, envOf, stopHeldThisCycle, markStopHeld, stopMarkerFile, scanBudget, SCAN_LIMITS, gitSafe, GIT_SAFE_CONFIG, ASK_TIMEOUT_RE, askTimedOut, askTimeoutMarker, sweepStale, sweepStamp, capLog, STALE_MS, SWEEP_EVERY_MS, bareSkill, reviewKind, REVIEW_SKILL, REVIEW_SEAT, codeReviewCall, reviewTargets, reviewCovers, briefTargets, REVIEW_PROOF, reviewProof, REVIEW_SNAPSHOT, snapshotReview, readReviewSnapshots, heldByReview, proseOf, skillCopyState, oursLoadable, SCORER_AUTOMATIC, SCORER_PHRASES, scorerLevel, scorerRounds, scorerOutputs, safeSession, scorerFile, scorerHeldFile, scorerNotedFile, readScorerFile, scorerState, STACK_RE, stackNamed, PLAN_READERS, producerMarks, sweepScorerFolders };
