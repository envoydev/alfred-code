#!/usr/bin/env node
// guard-config-protection.js - PreToolUse (Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Monitor, and a filesystem
// server's write_file / edit_file / move_file under any registration name - SYS-02, below).
// Two checks, on every route and under every stand-down: a write that switches a PROTECTIVE guard off asks the user
// (SYS-01, below), and so does a write to a project rule source or the workspace file (THE RULE STORE, below). The
// lint-config judge that shared this file - a change to an existing lint, format or strictness config, and the
// CONFIG-EDIT-ALLOW receipt that opened one - left in complexity stage 1 (B11): 0 fires in 442 sessions.
// So `guard-config-protection` in the hooks off-list, and the old ALFRED_CODE_CONFIG_PROTECT=0, switch nothing off.
'use strict';
const fs = require('fs');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// The stand-downs are read (the prelude's gate contract, which hook-prelude.test.js holds every hook to) and none is
// applied: the guard switch-off half (SYS-01, below) holds under every one of them. R86: a repo never set up gets no
// block row from that half.
let off = false;
let unsetRepo = false;
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-config-protection');
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
}

// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
// data-root-reader (meta/shared-rules.json): the data root is always .alfred. An absolute ALFRED_CODE_DATA_PATH is a
// harness's scratch and is kept; anything else is .alfred.
const dataRoot = (env = process.env) => { const raw = String(envOf(env, 'DATA_PATH') || '').trim().replace(/\\/g, '/'); return /^(?:\/|[A-Za-z]:\/)/.test(raw) ? raw.replace(/\/+$/, '') || '.alfred' : '.alfred'; };
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${dataRoot()}/docs`;

// Git Bash / MSYS spell a Windows path in POSIX mount form; translate before any resolution.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }

// A JSONC comment ends where the text says, never inside a string: a `"https://..."` value is no `//` comment.
function stripJsonComments(s) {
  let out = '';
  for (let i = 0, n = s.length; i < n;) {
    if (s[i] === '"') { let j = i + 1; while (j < n && s[j] !== '"') j += s[j] === '\\' ? 2 : 1; out += s.slice(i, j + 1); i = j + 1; }
    else if (s[i] === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i += 1; }
    else if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; }
    else { out += s[i]; i += 1; }
  }
  return out;
}

let payload;
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (!payload || typeof payload !== 'object') process.exit(0);
// GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - read for the contract; SYS-01 holds under it.
let cursorOff = false;
try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }

    // --- block telemetry (shared by every guard hook; keep the copies identical) ------------
    // A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
    // FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
    // the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
    // nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
    // scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
    // telemetry never changes the verdict and never throws.
    (() => {
        let last = '';
        const w = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
        const exit = process.exit.bind(process);
        process.exit = (code) =>
        {
            if (code === 2 && !unsetRepo)
            {
                try
                {
                    // `path` is required at module scope above.
                    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
                    // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = (() => { try { return require('./layout.js').statsPath(root, ['hook-blocks']); } catch { return path.resolve(root, docsRootEnv(), 'hook-blocks'); } })();
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
                        // WHO was blocked and on which call: a seat's block is its own row (audit 2026-10-10 C07, 0498718d - seat
                        // blocks read as the main session's), and the call id joins the row to the transcript without a clock.
                        agent: payload.agent_id || null,
                        tool_use_id: payload.tool_use_id || null,
                        reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
                    }) + '\n');
                }
                catch { /* telemetry is never allowed to break the gate */ }
            }
            exit(code);
        };
    })();

const ROOT = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const CWD = payload.cwd || ROOT;
const resolveIn = (p) => path.resolve(CWD, nativePath(p));

// The text the call leaves. An edit is judged on the WHOLE file it leaves: a fragment can cut a setting in half
// (`<TreatWarningsAsErrors>` -> `<TreatWarningsAsErrors Condition="false">` names no closing tag, so neither side read a
// pair - audit 2026-10-08). An old_string the file does not hold falls back to the fragments (`applied: false`), the edit
// Claude Code will refuse anyway. null when the file cannot be read.
function appliedChange(ti, abs) {
  const edits = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string, replace_all: ti.replace_all }];
  const whole = typeof ti.content === 'string';
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  let applied = whole ? ti.content : text;
  for (const e of whole ? [] : edits) {
    const o = e && typeof e.old_string === 'string' ? e.old_string : '';
    if (!o || !applied.includes(o)) { applied = null; break; }
    const n = e && typeof e.new_string === 'string' ? e.new_string : '';
    applied = e.replace_all ? applied.split(o).join(n) : applied.replace(o, () => n);
  }
  if (applied !== null) return { before: text, after: applied, applied: true };
  return { before: edits.map((e) => (e && e.old_string) || '').join('\n'), after: edits.map((e) => (e && e.new_string) || '').join('\n'), applied: false };
}
// The shell route's one reader (scanShell, carriedScripts, the copy plans); without it the shell route is not judged.
let shell = null;
try { shell = require(path.join(__dirname, 'shell-writes.js')); } catch { shell = null; }
// The text every `s` script the command carries leaves of `before` ({ text, applied } - applied counts the scripts), or
// null when one cannot be compiled. The guard switch-off half (SYS-01) reads an in-place edit so.
function sedApplied(command, before) {
  const ere = /(?:^|\s)-(?:[a-zA-Z]*[Er][a-zA-Z]*)\b/.test(command) || /\bperl\b/.test(command);
  const toJs = (re) => (ere ? re : re.replace(/\\([(){}+?|])|([(){}+?|])/g, (m, esc, bare) => (esc ? esc : `\\${bare}`)));
  const repl = (r) => r.replace(/\\(\d)|\\&|&|\$/g, (m, d) => (d ? `$${d}` : m === '\\&' ? '&' : m === '&' ? '$&' : '$$'));
  const addr = '(\\d+|\\$|\\/(?:[^/\\\\]|\\\\.)*\\/)';
  const SCRIPT = new RegExp(`^${addr}?(?:,${addr})?\\s*s([/|#,:@!])((?:(?!\\3)[^\\\\]|\\\\.)*)\\3((?:(?!\\3)[^\\\\]|\\\\.)*)\\3([gip0-9]*)$`);
  const words = (command.match(/'[^']*'|"(?:[^"\\]|\\.)*"|\S+/g) || []).map((w) => w.replace(/^['"]|['"]$/g, ''));
  let text = before;
  let applied = 0;
  for (const w of words) {
    for (const part of w.split(/;\s*/)) {
      const m = SCRIPT.exec(part.trim());
      if (!m) continue;
      let pat; let from = null; let to = null;
      try {
        pat = new RegExp(toJs(m[4]), `${m[6].includes('g') ? 'g' : ''}${/[iI]/.test(m[6]) ? 'i' : ''}`);
        const at = (a) => (a === undefined ? null : /^\d+$/.test(a) ? Number(a) : a === '$' ? Infinity : new RegExp(toJs(a.slice(1, -1))));
        from = at(m[1]); to = at(m[2]);
      } catch { return null; }
      const lines = text.split('\n');
      let inRange = false;
      const hit = (spec, i, line) => (typeof spec === 'number' ? (spec === Infinity ? i === lines.length - 1 : i + 1 === spec) : spec.test(line));
      text = lines.map((line, i) => {
        let on;
        if (from === null) on = true;
        else if (to === null) on = hit(from, i, line);
        else { if (!inRange && hit(from, i, line)) { inRange = true; on = true; } else if (inRange) { on = true; if (hit(to, i, line)) inRange = false; } else on = false; }
        return on ? line.replace(pat, repl(m[5])) : line;
      }).join('\n');
      applied += 1;
    }
  }
  return { text, applied };
}

// A filesystem server the user registers (audit 2026-11-03 SYS-02; HK-26 gave the secret guard its read route): the
// reference server's schemas (@modelcontextprotocol/server-filesystem, src/filesystem/server.ts in
// github.com/modelcontextprotocol/servers, read 2026-11-03) - `write_file` { path, content } is judged as a Write,
// `edit_file` { path, edits: [{ oldText, newText }], dryRun } as an edit (each first exact match replaced, lib.ts
// applyFileEdits; a dry run writes nothing, and an oldText the file does not hold falls back to the fragments, the file
// tool's rule), and `move_file` { source, destination } by what it removes and what it lands. Matched by the tool's
// name under any registration; a relative path is read at the project root and a leading `~` expanded, as the server
// does (lib.ts validatePath). A field that is no string names no file.
const FS_WRITE_TOOL = /^mcp__.+__(?:write_file|edit_file|move_file)$/;
const fsPath = (p) => {
  if (typeof p !== 'string' || !p.trim()) return null;
  const home = require('os').homedir();
  const n = nativePath(p === '~' || /^~[\\/]/.test(p) ? (home ? path.join(home, p.slice(1)) : p) : p);
  return path.resolve(ROOT, n);
};

// Both sides as REAL paths: the same file spelled through a symlinked root read as outside (audit 2026-10-08). A file not
// created yet resolves through its deepest existing folder, the rest re-attached: left as spelled, a short 8.3 parent
// (RUNNER~1) or a symlinked one read as outside a root that resolved long (3.6.0 CI).
const real = (p) => {
  const abs = path.resolve(p);
  const rest = [];
  for (let dir = abs; ;) {
    try { return path.join(fs.realpathSync.native(dir), ...rest); } catch { /* keep climbing */ }
    const up = path.dirname(dir);
    if (up === dir) return abs;
    rest.unshift(path.basename(dir));
    dir = up;
  }
};
// 2.8.0: an ALLOW receipt lives in <data root>/state/approvals/ (layout.js); the pre-2.8.0 flow/ one is still read for the
// 2.x line, and is the only path when layout.js is not beside this file.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
// The receipt reader (hook-prelude.js). No prelude, no reader: every receipt here reads shut.
let receipts = null;
try { receipts = require('./hook-prelude.js'); } catch { receipts = null; }

// ---- SYS-01 (system audit 2026-11-03, BLOCKER): a write that switches a PROTECTIVE guard off --------------------------
// The hooks read their off-list (the HOOKS_OFF csv) from the settings `env` (hook-prelude.js GATE 1: layout.js applies the project's
// settings.local.json and settings.json at every hook start, and Claude Code hands each hook the env of the user, project,
// local - the repository root's since 2.1.211 - and managed files), and Claude Code's `disableAllHooks: true` stands every
// hook down. So a write adding the rm, secret or force-push guard (hook-prelude.js PROTECTIVE) to the csv, or
// setting disableAllHooks, stood that guard down from the next call on, and no guard judged it (replayed under
// bypassPermissions). Such a write is denied with ONE ask on every route this guard covers - a file tool and a filesystem
// server judged on the file it leaves, a shell write on the JSON it carries (a heredoc body, a quoted literal, a copied
// file) and by name for the rest, an in-place sed applied in memory - and GUARD-OFF-ALLOW is a SECURITY receipt
// (hook-prelude.js securityReceipt: this session's, under 8h, after the user's own 'Allow this guard switch-off' to this
// denial with auto-run off). It runs before every stand-down - the csv (naming this guard first would open the protective
// ones), `minimal`, a repo never set up (no block row there, R86), a Cursor payload, the old CONFIG_PROTECT=0. Removing a
// guard from the list, or any other key, passes. Not read: `.variables` (layout.js never reads HOOKS_OFF there, D7) and a
// workspace member's files (they hand a child `<hook>:<part>` entries only, and no protective guard has a part). Review fix
// pass run B: a copy, move, link, install, rsync, Copy-Item or tar / unzip extract is judged by the watched files it LANDS
// (landedAt below; a folder destination takes the source's last name), content it cannot read asks, `sponge` writes, a
// new hooks entry wiring a copied twin (TWIN_GUARDED) is a switch-off, and so is a twin file written while the plugin route
// is live. Ceilings: a destination or a value the shell computes, a runtime script that builds the JSON, a git checkout or
// clone laying a settings file down, and another extract tool. The core switched off in `enabledPlugins` or by the CLI is
// THE PLUGIN SWITCH-OFF, below.
const PROTECTIVE_GUARDS = (() => { try { return [...receipts.PROTECTIVE]; } catch { return ['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push']; } })();
const RENAMED_HOOKS = (receipts && receipts.HOOK_RENAMED) || {};
// The key as envOf spells every stack setting: the prefix, then the suffix.
const HOOKS_OFF_SUFFIX = 'HOOKS_OFF';
const HOOKS_OFF_KEY = `ALFRED_CODE_${HOOKS_OFF_SUFFIX}`;
const GUARD_OFF = 'GUARD-OFF-ALLOW';
const GUARD_OFF_LABEL = 'Allow this guard switch-off';
const HOME_DIR = (() => { try { return require('os').homedir() || ''; } catch { return process.env.HOME || ''; } })();
const foldCase = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
const under = (dir, file) => { const r = path.relative(dir, file); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : null; };
const shownAs = (file) => { const r = real(file); const inRoot = under(real(ROOT), r); if (inRoot) return inRoot; const inHome = HOME_DIR ? under(real(HOME_DIR), r) : null; return inHome ? `~/${inHome}` : r; };
let watched = null;
// The settings file `abs` is, as { abs, shown }, or null: the project's two, the repository root's local one Claude Code
// reads for a sub-folder or a worktree (layout.js localSettingsFile), the account's, the managed file and its drop-ins.
function settingsAt(abs) {
  if (!watched) {
    watched = { files: new Map(), dropIns: null };
    const add = (file) => { if (file) watched.files.set(foldCase(real(file)), shownAs(file)); };
    add(path.join(ROOT, '.claude', 'settings.json'));
    add(path.join(ROOT, '.claude', 'settings.local.json'));
    try { add(layout && layout.localSettingsFile(ROOT)); } catch { /* no repository */ }
    const account = process.env.CLAUDE_CONFIG_DIR || (HOME_DIR ? path.join(HOME_DIR, '.claude') : '');
    if (account) add(path.join(account, 'settings.json'));
    try {
      const managed = layout && layout.managedSettingsFile(process.platform);
      if (managed) { add(managed); watched.dropIns = foldCase(real(path.join(path.dirname(managed), 'managed-settings.d'))); }
    } catch { /* no managed path */ }
  }
  const r = real(abs);
  const shown = watched.files.get(foldCase(r));
  if (shown) return { abs: r, shown };
  if (watched.dropIns && /\.json$/i.test(r) && foldCase(path.dirname(r)) === watched.dropIns) return { abs: r, shown: r };
  return null;
}
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const offEntry = (e) => { const n = String(e).trim().toLowerCase().replace(/\.js$/, ''); return RENAMED_HOOKS[n] || n; };
// THE COPIED TWIN (review fix pass run B M2): hook-prelude.js yieldToCopiedTwin stands a plugin hook down beside a copy at
// `<project>/.claude/hooks/<hook>.js` that a project settings entry wires - the copy route's own shape. A hooks entry
// naming the shell or file dispatcher, a protective guard or the cross-project guard (whose transcript rule every
// security receipt rests on) under `.claude/hooks/` therefore switches the plugin's guard off once the file is there,
// and the file stands it down once an entry names it. The installer writes both through its own process on the copy
// route (`ALFRED_CODE_HOOKS_VIA_PLUGIN=false`), never through a tool this guard judges, so only the model's writes ask.
const TWIN_GUARDED = [...new Set(['shell-guards', 'file-guards', ...PROTECTIVE_GUARDS, 'guard-cross-project-write'])];
const TWIN_RE = new RegExp(`(?:^|[\\\\/"'\\s=])\\.claude[\\\\/]+hooks[\\\\/]+(${TWIN_GUARDED.join('|')})\\.js(?![\\w.-])`, 'gi');
const twinNames = (text) => new Set([...String(text || '').matchAll(TWIN_RE)].map((m) => m[1].toLowerCase()));
// Every hook command a settings object wires, whatever the event or matcher (the twin rule's own reading is narrower).
function wiredTwins(data) {
  const out = new Set();
  const hooks = data && data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks) ? data.hooks : {};
  for (const blocks of Object.values(hooks)) for (const block of Array.isArray(blocks) ? blocks : [])
    for (const h of block && Array.isArray(block.hooks) ? block.hooks : []) if (h && typeof h.command === 'string') for (const n of twinNames(h.command)) out.add(n);
  return out;
}
// The off-list key as the hooks read it: on win32 the environment is case-insensitive, so `alfred_code_hooks_off` is the
// same variable (review fix pass run B m8) - every spelling is read and their guards united.
const offListText = (env) => Object.keys(env).filter((k) => (process.platform === 'win32' ? k.toUpperCase() === HOOKS_OFF_KEY : k === HOOKS_OFF_KEY))
  .map((k) => (env[k] == null ? '' : String(env[k]))).join(',');
// THE PLUGIN SWITCH-OFF (SYS-01b; a side agent's note, the user's design of 2026-11-03): `enabledPlugins` holding the core
// `alfred-code@<key>` at false - or a file that enabled it no longer enabling it, since a dropped key loads nothing
// (docs/plugin-cli-evidence.md S29) - stands EVERY Alfred Code guard down from the next session, wider than any off-list
// entry; so do `claude plugin disable|uninstall|remove` of the core and `disable --all` (pluginCliOff, below). The same ask
// and GUARD-OFF-ALLOW receipt. A reinstall or re-enable of the core later in the same command is no switch-off (the
// update notes' same-version re-release). Ceilings: a scoped `claude plugin marketplace remove` of the core's marketplace,
// and a dropped key on a route that cannot parse the file it leaves (a fragment, a shell write by name).
const CORE_PLUGIN = 'alfred-code';
const isCoreId = (k) => String(k).split('@')[0].toLowerCase() === CORE_PLUGIN;
// The core's key named `false`, by text: `"alfred-code@envoydev": false`, `["alfred-code@envoydev"] = false`.
const CORE_FALSE_RE = new RegExp(`(?<![\\w-])${CORE_PLUGIN}(?:@[\\w.-]+)?["'\\]\\s]*[:=]\\s*["']?false\\b`, 'i');
// What a settings text switches off - { off: the protective guards its csv names, all: disableAllHooks is true, twins: the
// guarded hooks it wires a copied twin of, core: enabledPlugins holds the core at false, coreOn: the core keys it holds at
// true } - read as JSON (a BOM, comments and trailing commas forgiven), or null when it is no object.
function offState(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  let data = null;
  for (const t of [src, stripJsonComments(src).replace(/,(\s*[}\]])/g, '$1')]) { try { data = JSON.parse(t); break; } catch { data = null; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const env = data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {};
  const csv = offListText(env);
  const plugins = data.enabledPlugins && typeof data.enabledPlugins === 'object' && !Array.isArray(data.enabledPlugins) ? data.enabledPlugins : {};
  const coreKeys = Object.keys(plugins).filter(isCoreId);
  return { off: new Set(csv.split(',').map(offEntry).filter((n) => PROTECTIVE_GUARDS.includes(n))), all: data.disableAllHooks === true, twins: wiredTwins(data),
    core: coreKeys.some((k) => plugins[k] === false), coreOn: new Set(coreKeys.filter((k) => plugins[k] === true)) };
}
// A text that is no settings object (a fragment, a command, a script) by what it names: a guard's name as a word,
// `disableAllHooks` unless set false, a guarded hook's path under `.claude/hooks/`, and the core's key named false. What
// it enables is unknown (`coreOn` undefined), so a dropped key is never read from it.
function namedState(text) {
  const s = String(text || '');
  return { off: new Set(PROTECTIVE_GUARDS.filter((n) => new RegExp(`(?<![\\w-])${n}(?:\\.js)?(?![\\w-])`, 'i').test(s))),
    all: /disableAllHooks/.test(s) && !/disableAllHooks["'\\\s]*[:=]\s*["']?false\b/i.test(s), twins: twinNames(s), core: CORE_FALSE_RE.test(s), coreOn: undefined };
}
const NOTHING_OFF = { off: new Set(), all: false, twins: new Set(), core: false, coreOn: new Set() };
const stateOf = (text) => (text == null ? NOTHING_OFF : offState(text) || namedState(text));
// The state of a file's WHOLE new text (a Write, an applied Edit, a copy's source): a text that is no settings object -
// empty, or JSON Claude Code cannot load - enables no plugin, so a core key it held is dropped.
const wholeState = (text) => (text == null ? NOTHING_OFF : offState(text) || { ...namedState(text), coreOn: new Set() });
const merged = (states) => {
  const known = states.filter((s) => s.coreOn);
  return { off: new Set(states.flatMap((s) => [...s.off])), all: states.some((s) => s.all), twins: new Set(states.flatMap((s) => [...s.twins])),
    core: states.some((s) => s.core), coreOn: known.length ? new Set(known.flatMap((s) => [...s.coreOn])) : undefined };
};
const switchedOff = (file, before, after) => {
  const added = [...after.off].filter((n) => !before.off.has(n));
  const twins = [...after.twins].filter((n) => !before.twins.has(n));
  const core = (after.core && !before.core) || Boolean(before.coreOn && before.coreOn.size && after.coreOn && !after.coreOn.size);
  return added.length || twins.length || (after.all && !before.all) || core ? { ...file, added, twins, all: after.all && !before.all, core } : null;
};
// The plugin route is live when this run is the plugin's copy (Claude Code sets CLAUDE_PLUGIN_ROOT for a plugin hook) and
// not the project's own copy under an inherited root - hook-prelude.js yieldToCopiedTwin's test.
const HOOKS_DIR = path.join(ROOT, '.claude', 'hooks');
const pluginLive = () => Boolean(process.env.CLAUDE_PLUGIN_ROOT) && foldCase(real(__dirname)) !== foldCase(real(HOOKS_DIR));
// The guarded hook a path is a copied twin of, as { abs, shown, name, twinFile } - only while the plugin route is live:
// on the copy route that file IS the guard, and the installer writes it.
function twinAt(abs) {
  if (!pluginLive()) return null;
  const r = real(abs);
  if (foldCase(path.dirname(r)) !== foldCase(real(HOOKS_DIR))) return null;
  const m = /^(.+)\.js$/i.exec(path.basename(r));
  const name = m ? m[1].toLowerCase() : '';
  return TWIN_GUARDED.includes(name) ? { abs: r, shown: shownAs(r), added: [], twins: [], all: false, twinFile: name } : null;
}
function guardOffFile(given) {
  const ti = given || payload.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (typeof target !== 'string' || !target) return null;
  const twin = twinAt(resolveIn(target));
  if (twin) return twin;
  const file = settingsAt(resolveIn(target));
  if (!file) return null;
  const beforeText = readOr(file.abs);
  const before = stateOf(beforeText);
  if (typeof ti.content === 'string') return switchedOff(file, before, wholeState(ti.content));
  if (typeof ti.new_source === 'string') return switchedOff(file, before, namedState(ti.new_source));
  const change = beforeText == null ? null : appliedChange(ti, file.abs);
  if (change && change.applied) return switchedOff(file, before, wholeState(change.after));
  // An edit Claude Code may still apply another way (its quote normalisation): judged on what it adds, by name.
  const edits = Array.isArray(ti.edits) ? ti.edits : [ti];
  return switchedOff(file, before, namedState(edits.map((e) => (e && typeof e.new_string === 'string' ? e.new_string : '')).join('\n')));
}
function guardOffFs() {
  const ti = payload.tool_input || {};
  const verb = String(payload.tool_name).replace(/^mcp__.+__/, '');
  if (verb === 'move_file') {
    // a rename: the source becomes the destination, a folder with everything under it
    const dest = fsPath(ti.destination);
    if (!dest) return null;
    const source = fsPath(ti.source);
    const gone = source && removedCore(source);
    if (gone) return gone;
    for (const l of landedAt(dest, source || null)) { const hit = judgeLanded(l, { how: 'a move' }); if (hit) return hit; }
    return null;
  }
  const abs = fsPath(ti.path);
  if (!abs) return null;
  if (verb === 'write_file') return typeof ti.content === 'string' ? guardOffFile({ file_path: abs, content: ti.content }) : null;
  if (ti.dryRun === true || !Array.isArray(ti.edits) || !ti.edits.length) return null;
  return guardOffFile({ file_path: abs, edits: ti.edits.map((e) => ({ old_string: e && typeof e.oldText === 'string' ? e.oldText : '', new_string: e && typeof e.newText === 'string' ? e.newText : '' })) });
}
// What a shell write can carry into a file: each JSON object it holds (a heredoc body, a quoted literal) read as settings,
// each existing file it names (a copy's source, a script - at most 16, 1MB each; never a settings file itself) read as
// settings or by name, and the rest of its text by name.
function carriedState(command, scan) {
  const states = [];
  let text = command;
  const blank = (a, b) => { text = text.slice(0, a) + text.slice(a, b).replace(/[^\n]/g, ' ') + text.slice(b); };
  let docs = [];
  try { docs = shell.heredocsOf(command); } catch { docs = []; }
  for (const h of docs) {
    const st = offState(command.slice(h.bodyStart, h.bodyEnd));
    if (st) { states.push(st); blank(h.bodyStart, h.bodyEnd); }
  }
  let spans = [];
  try { spans = shell.quotedSpans(shell.blankHeredocs(command)); } catch { spans = []; }
  for (const [a, b] of spans) {
    const inner = command.slice(a + 1, b - 1);
    if (!/^\s*\{/.test(inner)) continue;
    const st = offState(command[a] === '"' ? inner.replace(/\\(["\\$`])/g, '$1') : inner);
    if (st) { states.push(st); blank(a, b); }
  }
  const norm = (t) => nativePath(shell.unquote(t));
  let read = 0;
  for (const m of shell.blankHeredocs(text).matchAll(/'[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&|<>()]+/g)) {
    if (read >= 16) break;
    const word = shell.unquote(m[0]);
    if (!word || /^-/.test(word) || /[$`*?]/.test(word)) continue;
    let anchor = CWD;
    try { anchor = shell.anchorAt(scan.cds, m.index, CWD, norm) || CWD; } catch { anchor = CWD; }
    const abs = path.resolve(anchor, nativePath(word.replace(/^~(?=[\\/])/, HOME_DIR || '~')));
    let st = null;
    try { st = fs.statSync(abs); } catch { st = null; }
    if (!st || !st.isFile() || st.size > 1024 * 1024 || settingsAt(abs)) continue;
    read += 1;
    states.push(stateOf(readOr(abs)));
  }
  states.push(namedState(text));
  // what the command makes of these is unknown (a jq filter, a sponge, a concatenation), so no state here says which core
  // keys the file will hold: no dropped-key read (the fresh review of 2026-11-03: any JSON file word read as 'drops it')
  return { ...merged(states), coreOn: undefined };
}
// ---- WHAT A COPY, MOVE, LINK, EXTRACT OR DOWNLOAD LANDS (review fix pass run B M1) ------------------------------------
// Only a target spelled `*.json` was judged, so a switch-off copied INTO a watched folder passed: `cp <f> .claude/`,
// `cp -t .claude <f>`, `cd .claude && cp <f> .`, `mv <f> .claude`, `rsync <dir>/ .claude/`, `ln -sf <f> .claude/`,
// `tar -C .claude -xf x.tar`, and `jq ... f | sponge f` (sponge was no known writer). Now every watched path - each
// settings file settingsAt reads, a managed drop-in, and while the plugin route is live each guarded hook's twin path -
// that a call would land is judged on what lands there: a copy by its source as the verb lays it out (a folder
// destination takes the source's last name, rsync's trailing slash and cp's `/.` its contents, `--parents` its path, a
// glob in the last name expanded, `ln -s` the file its link points at), an extract by the archive's own entry (tar,
// gzipped or not, and zip, read here - `--strip-components` followed, `-j` by last name), a move by its source. When
// the content CANNOT be read - a source the shell computes, a missing file no step of the command writes, an archive
// in another compressor, a link inside an archive, a download - the call asks. A source the command itself writes first
// is judged on what the command carries (carriedState), with whatever is on disk now.
const ARCHIVE_MAX = 32 * 1024 * 1024;
let zlib = null;
try { zlib = require('zlib'); } catch { zlib = null; }
const isDirAt = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// The watched paths a landing is compared with: [{ w (folded real path), kind: 'settings' | 'twin' }].
function watchList() {
  settingsAt(ROOT);
  const list = [...watched.files.keys()].map((w) => ({ w, kind: 'settings' }));
  if (pluginLive()) for (const n of TWIN_GUARDED) list.push({ w: foldCase(real(path.join(HOOKS_DIR, `${n}.js`))), kind: 'twin' });
  return list;
}
// Each watched path at or under `base` (where `src` lands, as a file or a folder), with the source file that lands on
// it: [{ w, kind, from }] - `from` null when the source is unknown. `any` (an unknown source into a folder): a watched
// file directly in `base`, or anywhere under it for a recursive call.
function landedAt(base, src, { any = false, recursive = false } = {}) {
  const b = foldCase(real(base));
  const out = [];
  for (const { w, kind } of watchList()) {
    if (any) { const rel = under(b, w); if (rel && (recursive || !rel.includes('/'))) out.push({ w, kind, from: null }); continue; }
    if (w === b) { out.push({ w, kind, from: src }); continue; }
    const rel = under(b, w);
    if (rel) out.push({ w, kind, from: src ? path.join(src, rel) : null, deep: true, src });
  }
  const d = watched.dropIns;
  if (d) {
    if (any) { if (b === d || (recursive && under(b, d) !== null)) out.push({ w: d, kind: 'dropins', from: null }); }
    else if (foldCase(path.dirname(b)) === d && /\.json$/i.test(b)) out.push({ w: b, kind: 'settings', from: src });
    else if (b === d || under(b, d)) {
      const dir = src ? path.join(src, b === d ? '' : under(b, d)) : null;
      if (!dir) out.push({ w: d, kind: 'dropins', from: null });
      else if (isDirAt(dir)) for (const n of fs.readdirSync(dir).filter((x) => /\.json$/i.test(x)).slice(0, 64)) out.push({ w: path.join(d, n), kind: 'settings', from: path.join(dir, n) });
    }
  }
  return out;
}
// The hit a landing makes, or null. `ctx.carried(src)` says whether the command writes `src` itself (then it is judged
// on what the command carries), `ctx.how` names the route for an unread ask.
function judgeLanded(l, ctx = {}) {
  if (l.kind === 'twin') return twinAt(l.w);
  const unread = (why) => ({ abs: l.w, shown: l.kind === 'dropins' ? l.w : shownAs(l.w), added: [], twins: [], all: false, unread: why });
  if (l.kind === 'dropins') return unread(`${ctx.how || 'a write'} whose files this hook cannot read`);
  const file = settingsAt(l.w);
  if (!file) return null;
  const before = stateOf(readOr(file.abs));
  let afterText;
  if (Object.hasOwn(l, 'text')) afterText = l.text;
  else if (!l.from) return unread(`${ctx.how || 'a write'} from a source this hook cannot read`);
  else {
    const carried = ctx.carried && (ctx.carried(l.from) || (l.src && ctx.carried(l.src)));
    let st = null;
    try { st = fs.statSync(l.from); } catch { st = null; }
    // the command rewrites the source first, so what the core's enable keys will be there is unknown: no dropped-key read
    if (carried) return switchedOff(file, before, { ...merged([carried, st && st.isFile() ? stateOf(readOr(l.from)) : NOTHING_OFF]), coreOn: undefined });
    if (st && st.isDirectory()) return null; // a folder lands where the file was: nothing to read as settings
    if (!st) {
      // under a source folder that exists, a name it does not hold lands nothing
      if (l.deep && l.src && isDirAt(l.src)) return null;
      return unread(`${ctx.how || 'a write'} from ${l.from}, which does not exist yet, so this hook cannot read it`);
    }
    afterText = readOr(l.from);
    if (afterText == null) return unread(`${ctx.how || 'a write'} from ${l.from}, which this hook cannot read`);
  }
  if (afterText == null) return unread(`${ctx.how || 'an extract'} whose entry this hook cannot read`);
  return switchedOff(file, before, wholeState(afterText));
}
// A source word as the shell hands it on: [abs, ...] (a glob in its last name expanded, dotfiles only for a pattern
// opening with a dot), or null when the shell computes it.
function sourcesOf(word, resolveWord) {
  const abs = resolveWord(word);
  if (!abs) return null;
  if (!/[*?[]/.test(word)) return [abs];
  const dir = path.dirname(abs);
  if (/[*?[]/.test(dir)) return null;
  const pat = path.basename(abs);
  const re = new RegExp(`^${pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\\\[!/g, '[^').replace(/\\\[/g, '[')}$`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const hits = names.filter((n) => (pat.startsWith('.') || !n.startsWith('.')) && re.test(n));
  return hits.length > 256 ? null : hits.map((n) => path.join(dir, n));
}
// What one copy / move / link / install / rsync / Copy-Item lands: [{ w, kind, from, ... }].
function copyLanded(verb, plan, resolveWord) {
  if (!plan.dest) return [];
  const destAbs = resolveWord(plan.dest);
  if (!destAbs) return []; // a destination the shell computes: the stated ceiling
  const intoFolder = !plan.fileDest && (plan.intoDir || /[\\/]$/.test(plan.dest) || isDirAt(destAbs));
  const out = [];
  for (const raw of plan.sources) {
    const srcs = sourcesOf(raw, resolveWord);
    if (srcs === null) { out.push(...landedAt(destAbs, null, { any: intoFolder, recursive: plan.recursive })); continue; }
    const contents = (verb === 'rsync' && /[\\/]$/.test(raw)) || (verb === 'cp' && (raw === '.' || /[\\/]\.$/.test(raw)));
    const both = verb === 'cp' && /[\\/]$/.test(raw); // BSD cp lays a slashed folder's contents down, GNU the folder
    for (const s of srcs) {
      const bases = [];
      if (intoFolder) {
        if (!contents) bases.push(path.join(destAbs, plan.parents ? String(raw).replace(/^.*[\\/]\.[\\/]/, '').replace(/^[\\/]+/, '') : path.basename(s)));
        if (contents || both) bases.push(destAbs);
        if (!isDirAt(destAbs) && plan.sources.length === 1 && !plan.intoDir) bases.push(destAbs); // a new folder IS the copy
      } else bases.push(destAbs);
      for (const base of new Set(bases)) {
        // `ln -s` points at its source from the link's own folder
        const from = plan.symbolic && !path.isAbsolute(nativePath(raw)) ? path.resolve(path.dirname(base), nativePath(raw)) : s;
        // THE NULL DEVICE copies nothing in: `cp /dev/null f` empties f. Node on Windows reads `/dev/null` as C:\dev\null,
        // which is missing, so the empty text is stated, never read (3.7.1, the windows-2025 job); NUL is its Windows name.
        const empty = !plan.symbolic && (raw === '/dev/null' || (process.platform === 'win32' && /^nul$/i.test(String(raw))));
        out.push(...landedAt(base, from).map((l) => (empty && !l.deep ? { ...l, text: '' } : l)));
      }
    }
  }
  return out;
}
// An archive's entries as Map(key -> { type: 'file' | 'dir' | 'other', read() }), or null when it cannot be read.
function archiveBytes(file) {
  let st = null;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size > ARCHIVE_MAX) return null;
  try { return fs.readFileSync(file); } catch { return null; }
}
function tarEntries(file) {
  let buf = archiveBytes(file);
  if (!buf) return null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (!zlib) return null;
    try { buf = zlib.gunzipSync(buf, { maxOutputLength: ARCHIVE_MAX * 4 }); } catch { return null; }
  }
  const out = new Map();
  let longName = null;
  let paxPath = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) return out;
    const str = (a, n) => { const s = h.subarray(a, a + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString('utf8'); };
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (parseInt(str(148, 8).trim(), 8) !== sum || (h[124] & 0x80)) return null;
    const size = parseInt(str(124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > buf.length) return null;
    const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8')); paxPath = m ? m[1] : null; continue; }
    if (type === 'g' || type === 'K') continue;
    const name = longName || paxPath || (str(257, 5) === 'ustar' && str(345, 155) ? `${str(345, 155)}/${str(0, 100)}` : str(0, 100));
    longName = null;
    paxPath = null;
    const isFile = type === '0' || type === '7';
    out.set(name, { type: isFile ? 'file' : type === '5' ? 'dir' : 'other', read: () => (isFile ? data.toString('utf8') : null) });
    if (out.size > 100000) return null;
  }
  return null; // no end marker: a cut archive
}
function zipEntries(file) {
  const buf = archiveBytes(file);
  if (!buf || buf.length < 22 || !zlib) return null;
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  if (count === 0xffff || p === 0xffffffff) return null; // zip64
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const isLink = ((buf.readUInt32LE(p + 38) >>> 16) & 0o170000) === 0o120000;
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (/[\\/]$/.test(name)) { out.set(name, { type: 'dir', read: () => null }); continue; }
    const read = () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + comp);
      try { return method === 0 ? data.toString('utf8') : method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: ARCHIVE_MAX }).toString('utf8') : null; } catch { return null; }
    };
    out.set(name, { type: isLink ? 'other' : 'file', read });
  }
  return out;
}
// An entry's name as it lands under the destination ('/'-joined, `./` and a leading `/` dropped, `strip` leading parts
// cut), folded like the watched paths; null when the strip leaves nothing.
function entryKey(name, strip, junk) {
  let parts = String(name).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (junk) parts = parts.slice(-1);
  if (strip > 0) { if (parts.length <= strip) return null; parts = parts.slice(strip); }
  return parts.length ? foldCase(parts.join('/')) : null;
}
// What one extract lands: [{ w, kind, text }] - text null for an entry this hook cannot read; every watched path under a
// destination when the archive itself cannot be read.
function extractLanded(verb, argv, resolveWord, dests) {
  const isTar = verb === 'tar' || verb === 'bsdtar' || verb === 'gtar';
  const plan = isTar ? shell.tarPlan(argv) : shell.unzipPlan(argv);
  if (isTar ? plan.mode !== 'x' : !plan.extracts) return [];
  const archive = plan.archive ? resolveWord(plan.archive) : null;
  let entries = archive && !(isTar && (plan.renamed || plan.strip < 0)) ? (isTar ? tarEntries(archive) : zipEntries(archive)) : null;
  const byKey = new Map();
  const byAbs = new Map();
  for (const [name, entry] of entries || []) {
    if (isTar && plan.absolute && /^[\\/]/.test(name)) byAbs.set(foldCase(path.resolve(name)), entry);
    const k = entryKey(name, isTar ? plan.strip : 0, !isTar && plan.junk);
    if (k) byKey.set(k, entry);
  }
  const out = [];
  const pick = (w, kind, entry) => {
    if (!entry) return;
    if (kind === 'twin') { out.push({ w, kind }); return; }
    out.push({ w, kind, text: entry.type === 'file' ? entry.read() : null });
  };
  for (const dest of dests) {
    const d = resolveWord(dest);
    if (!d) continue;
    const base = foldCase(real(d));
    for (const { w, kind } of watchList()) {
      if (entries && plan.absolute && byAbs.has(w)) { pick(w, kind, byAbs.get(w)); continue; }
      const rel = under(base, w);
      if (!rel) continue;
      if (!entries) { out.push(kind === 'twin' ? { w, kind } : { w, kind, text: null }); continue; }
      pick(w, kind, byKey.get(foldCase(rel)));
    }
    const dropIns = watched.dropIns;
    const relD = dropIns ? (base === dropIns ? '' : under(base, dropIns)) : null;
    if (relD !== null) {
      if (!entries) out.push({ w: dropIns, kind: 'dropins' });
      else for (const [k, entry] of byKey) if (/\.json$/i.test(k) && path.posix.dirname(k) === (relD || '.')) pick(path.join(dropIns, path.posix.basename(k)), 'settings', entry);
    }
  }
  return out;
}
const COPY_FAMILY = new Set(['cp', 'mv', 'ln', 'install', 'rsync']);
const EXTRACTS = new Set(['tar', 'bsdtar', 'gtar', 'unzip']);
const DOWNLOADS = new Set(['curl', 'wget']);
// `claude plugin disable|uninstall|remove` of the core, or `disable --all` (SYS-01b): read in the command and in every
// script it carries (`bash -c '...'`), at a command position only (`shell-writes.js` `commandIndex`, past `sudo`, `env`
// and the rest of the wrapper list; the binary by its path too), with heredoc bodies, comments and quoted text blanked
// first - a commit message, a PR body or an `echo` naming the act is prose (the fresh review of 2026-11-03: a commit
// message quoting the command asked). A later `claude plugin install|enable` of the core joined by `&&` alone, at the
// same scope, is a reinstall and switches nothing off - `||`, `;` or a newline runs it whatever the removal did. Returns
// the off record, its receipt line the act with its options dropped (`claude plugin disable alfred-code@envoydev`).
const CLAUDE_BIN = /^claude(?:\.exe|\.cmd)?$/i;
const PLUGIN_OFF_VERBS = new Set(['disable', 'uninstall', 'remove']);
const PLUGIN_ON_VERBS = new Set(['install', 'i', 'enable']);
function pluginActs(text) {
  const src = shell.blankComments(shell.blankHeredocs(String(text || '')));
  const chars = src.split('');
  for (const [a, b] of shell.quotedSpans(src)) for (let i = a; i < b; i += 1) chars[i] = 'x';
  const masked = chars.join('');
  const acts = [];
  const seps = [];
  let from = 0;
  const read = (seg, at) => {
    const words = shell.shellWords(seg);
    const k = shell.commandIndex(words);
    if (!CLAUDE_BIN.test(String(words[k] || '').replace(/^.*[\\/]/, '')) || !/^plugins?$/.test(String(words[k + 1] || ''))) return;
    const verb = String(words[k + 2] || '');
    if (!PLUGIN_OFF_VERBS.has(verb) && !PLUGIN_ON_VERBS.has(verb)) return;
    const args = words.slice(k + 3);
    if (args.some((w) => /^(?:-h|--help)$/.test(w))) return;
    let scope = 'user';
    const ids = [];
    for (let i = 0; i < args.length; i += 1) {
      const w = args[i];
      if (/^(?:--scope|-s)$/.test(w)) { scope = String(args[i + 1] || '').toLowerCase(); i += 1; continue; }
      if (w.startsWith('--scope=')) { scope = w.slice(8).toLowerCase(); continue; }
      if (!w.startsWith('-')) ids.push(w);
    }
    const named = ids.find(isCoreId);
    const all = verb === 'disable' && args.some((w) => /^(?:-a|--all)$/.test(w));
    if (named || all) acts.push({ verb: verb === 'i' ? 'install' : verb, id: named || '--all', scope, at });
  };
  // a lone `&` cuts, never the `&` of `2>&1` / `&>`
  for (const m of masked.matchAll(/&&|\|\||(?<![<>&])&(?![>&])|[;\n|]/g)) {
    read(src.slice(from, m.index), seps.length);
    seps.push(m[0]);
    from = m.index + m[0].length;
  }
  read(src.slice(from), seps.length);
  return { acts, seps };
}
// The same plugin: one id, or a bare name beside any core id.
const sameCore = (a, b) => a.toLowerCase() === b.toLowerCase() || !a.includes('@') || !b.includes('@');
function pluginCliOff(texts) {
  for (const text of texts) {
    let parsed;
    try { parsed = pluginActs(text); } catch { continue; }
    const { acts, seps } = parsed;
    for (let i = 0; i < acts.length; i += 1) {
      const a = acts[i];
      if (!PLUGIN_OFF_VERBS.has(a.verb)) continue;
      const back = acts.slice(i + 1).some((b) => PLUGIN_ON_VERBS.has(b.verb) && b.id !== '--all' && b.scope === a.scope
        && (a.id === '--all' || sameCore(a.id, b.id)) && seps.slice(a.at, b.at).every((sp) => sp === '&&'));
      if (back) continue;
      const line = `claude plugin ${a.verb} ${a.id}`;
      return { abs: line, shown: line, added: [], twins: [], all: false, core: true, cli: true };
    }
  }
  return null;
}
// A REMOVAL (rm, a move's source) of a watched settings file that holds the core at true - or of a folder holding one,
// itself or under its `.claude/` - drops that key (the fresh review of 2026-11-03: `rm .claude/settings.json` and a `mv`
// of it passed). A folder deeper down, a glob and a shell write that empties the file are ceilings.
function removedCore(abs) {
  const files = [abs, ...['settings.json', 'settings.local.json'].flatMap((n) => [path.join(abs, n), path.join(abs, '.claude', n)])];
  for (const f of files) {
    const file = settingsAt(f);
    if (!file) continue;
    const before = stateOf(readOr(file.abs));
    if (before.coreOn && before.coreOn.size) return { ...file, added: [], twins: [], all: false, core: true, removed: true };
  }
  return null;
}
// The command and its scan, read once for both checks; null when there is no shell reader or nothing to read.
let scanned;
function shellScan() {
  if (scanned !== undefined) return scanned;
  let command = String((payload.tool_input || {}).command || '');
  if (/^PowerShell$/i.test(String(payload.tool_name || ''))) command = command.replace(/\\/g, '/');
  try { scanned = shell && command.trim() ? { command, scan: shell.scanShell(command, { cwd: CWD, landing: true }) } : null; } catch { scanned = null; }
  return scanned;
}
// A word as the shell resolves it where target t stands; null when the shell computes it.
function wordAt(scan, t, word) {
  const anchor = shell.anchorAt(scan.cds, t.index, CWD, (w) => nativePath(shell.unquote(w)));
  const raw = scan.expandVars(String(word || ''), t.index);
  if (!raw || shell.isVar(raw) || /[$`]/.test(raw)) return null;
  const spelled = nativePath(raw.replace(/^~(?=[\\/])/, HOME_DIR || '~'));
  if (anchor === null && !path.isAbsolute(spelled)) return null;
  return path.resolve(anchor || CWD, spelled);
}
function guardOffShell() {
  const read = shellScan();
  if (!read) return null;
  const { command, scan } = read;
  let carriedTexts = [];
  try { carriedTexts = shell.carriedScripts(command, { cwd: CWD }).map((sc) => sc.text); } catch { carriedTexts = []; }
  const cliOff = pluginCliOff([command, ...carriedTexts]);
  if (cliOff) return cliOff;
  const norm = (t) => nativePath(shell.unquote(t));
  let carried = null;
  const carriedNow = () => (carried || (carried = carriedState(command, scan)));
  // Every path an EARLIER step of this command fills (a redirect, a tee, a copy's destination, a mkdir - never a removal,
  // a move's own source or the call being judged): a source it names is judged on what the command carries.
  let written = null;
  const writtenBefore = (step) => (abs) => {
    if (!written) {
      written = [];
      for (const t of scan.targets) {
        if (t.verb === 'rm' || /^a move OUT/.test(String(t.what || ''))) continue;
        const raw = scan.expandVars(String(t.raw || ''), t.index);
        if (!raw || shell.isVar(raw)) continue;
        const anchor = shell.anchorAt(scan.cds, t.index, CWD, norm);
        const spelled = nativePath(raw.replace(/^~(?=[\\/])/, HOME_DIR || '~'));
        if (anchor === null && !path.isAbsolute(spelled)) continue;
        written.push({ at: foldCase(real(path.resolve(anchor || CWD, spelled))), index: t.index, argv: t.argv });
      }
    }
    const a = foldCase(real(abs));
    return written.some((w) => w.index < step.index && (!step.argv || w.argv !== step.argv) && (w.at === a || under(w.at, a) !== null || under(a, w.at) !== null)) ? carriedNow() : null;
  };
  const done = new Set();
  for (const t of scan.targets) {
    const resolveWord = (word) => wordAt(scan, t, word);
    const verb = String(t.verb || '').toLowerCase();
    if (t.verb === 'rm' || /^a move OUT/.test(String(t.what || ''))) {
      // a removal switches no guard off, but a settings file that enables the core takes its key with it
      const gone = resolveWord(t.raw);
      const hit = gone && removedCore(gone);
      if (hit) return hit;
      continue;
    }
    const ctx = { carried: writtenBefore(t), how: `a ${verb}` };
    if (Array.isArray(t.argv) && (COPY_FAMILY.has(verb) || shell.PS_COPY.has(verb) || EXTRACTS.has(verb))) {
      if (done.has(t.argv)) continue; // one call names several targets: its plan is read once
      done.add(t.argv);
      const landed = EXTRACTS.has(verb)
        ? extractLanded(verb, t.argv, resolveWord, scan.targets.filter((x) => x.argv === t.argv).map((x) => x.raw))
        : copyLanded(verb, shell.PS_COPY.has(verb) ? shell.psCopyPlan(verb, t.argv) : shell.copyPlan(verb, t.argv), resolveWord);
      for (const l of landed) { const hit = judgeLanded(l, ctx); if (hit) return hit; }
      continue;
    }
    const abs = resolveWord(t.raw);
    if (!abs) continue;
    if (DOWNLOADS.has(verb)) {
      // what a download writes does not exist when the hook fires
      const landed = isDirAt(abs) || /[\\/]$/.test(String(t.raw)) ? landedAt(abs, null, { any: true }) : landedAt(abs, null);
      for (const l of landed) { const hit = judgeLanded(l, { how: `a ${verb} download` }); if (hit) return hit; }
      continue;
    }
    const twin = twinAt(abs);
    if (twin) return twin;
    const file = settingsAt(abs);
    if (!file) continue;
    const beforeText = readOr(file.abs);
    const before = stateOf(beforeText);
    if (t.what === 'an in-place edit' && beforeText != null) {
      const edited = sedApplied(command, beforeText);
      if (edited && edited.applied) {
        const hit = switchedOff(file, before, wholeState(edited.text));
        if (hit) return hit;
        continue;
      }
    }
    // `dd if=<file> of=<settings>` lays that file down
    const ddIn = verb === 'dd' && Array.isArray(t.argv) ? t.argv.find((a) => a.startsWith('if=')) : null;
    const after = ddIn ? merged([carriedNow(), stateOf(readOr(resolveWord(ddIn.slice(3)) || ''))]) : carriedNow();
    const hit = switchedOff(file, before, after);
    if (hit) return hit;
  }
  return null;
}
function guardOffDenial(off) {
  const receiptFile = layout ? layout.findState(ROOT, 'approvals', GUARD_OFF) : path.resolve(ROOT, docsRootEnv(), 'flow', GUARD_OFF);
  const heldOff = receipts && receipts.securityReceipt ? receipts.securityReceipt(receiptFile, payload, { marker: GUARD_OFF, labels: [GUARD_OFF_LABEL] }) : null;
  if (heldOff && heldOff.live && (heldOff.lines.includes('*') || heldOff.lines.includes(off.shown) || heldOff.lines.includes(off.abs))) return;
  const receiptRel = path.relative(ROOT, layout ? layout.statePath(ROOT, 'approvals', GUARD_OFF) : receiptFile).split(path.sep).join('/');
  const twins = off.twins || [];
  const what = [...(off.added.length ? [`adds ${off.added.join(', ')} to ${HOOKS_OFF_KEY}`] : []), ...(off.all ? ['sets disableAllHooks: true'] : []),
    ...(off.core && !off.cli ? [`switches the ${CORE_PLUGIN} plugin off in enabledPlugins (false, or no longer true)`] : []),
    ...(twins.length ? [`wires a copied twin of ${twins.map((n) => `.claude/hooks/${n}.js`).join(', ')}, which the plugin's own stands down for`] : []),
    ...(off.twinFile ? [`puts a copy of ${off.twinFile}.js where the plugin's own stands down for it once a project settings entry names it`] : [])].join(' and ');
  const guarded = [...off.added, ...twins, ...(off.twinFile ? [off.twinFile] : [])];
  const names = off.all ? 'every hook' : off.core ? 'every Alfred Code guard' : guarded.length ? guarded.join(', ') : 'a protective guard';
  global.BLOCK_DETAIL = { branch: 'guard-off', file: off.shown, guards: guarded, all: off.all, ...(off.core ? { core: true } : {}), ...(off.unread ? { unread: true } : {}) };
  process.stderr.write(
    (off.unread
      ? `Blocked: this write lands ${off.shown} by ${off.unread} - what it switches off is unknown, and a settings file can stand a protective guard down from the next call on.\n`
      : off.cli
        ? `Blocked: \`${off.shown}\` switches the ${CORE_PLUGIN} plugin off, which stands every Alfred Code guard down from the next session on.\n`
        : off.removed
          ? `Blocked: removing ${off.shown} takes its enabledPlugins entry for the ${CORE_PLUGIN} plugin with it, which stands every Alfred Code guard down from the next session on.\n`
        : `Blocked: this write to ${off.shown} ${what}, which stands ${off.all ? 'every hook' : off.core ? 'every Alfred Code guard' : guarded.length > 1 ? 'those guards' : 'that guard'} down from the next ${off.core && !off.all ? 'session' : 'call'} on.\n`) +
    `The protective guards stop what cannot be undone (a recursive rm or a discard, a credential read, a force push),\n` +
    `so switching one off is the user's call, never the model's. End this turn with ONE AskUserQuestion,\n` +
    `in this order -\n` +
    `  'Keep the guards on (Recommended)' - leave the setting as it is\n` +
    `  '${GUARD_OFF_LABEL}' - the user wants ${names} off\n` +
    `On '${GUARD_OFF_LABEL}', write the receipt ${receiptRel} with exactly these lines and retry the SAME call:\n` +
    (receipts && receipts.receiptLinesText ? receipts.receiptLinesText(payload, [off.shown]) : `  ${off.shown}\n`) +
    `It counts only after the user's own answer to this denial, never one auto-run gave, for this session, under 8h.\n` +
    `Removing a guard from the list, or any other key, passes.\n` +
    (receipts && receipts.receiptShutText ? receipts.receiptShutText(heldOff, receiptRel) : ''),
  );
  process.exit(2);
}
{
  let switched = null;
  try {
    switched = FS_WRITE_TOOL.test(String(payload.tool_name || '')) ? guardOffFs()
      : shell && shell.isShellTool(payload.tool_name) ? guardOffShell() : guardOffFile();
  } catch { switched = null; /* a judge that throws passes the call: the guard fails open */ }
  if (switched) guardOffDenial(switched);
}

// ---- THE RULE STORE (workspace stage 4c) -------------------------------------------------------------------------------
// The rule loader sends what <project>/.alfred/stack/rules holds, and .alfred/workspace.json decides what a child inherits,
// so a write to a rule file, the rules or stack folder itself (an rm -r or a mv of either takes every rule out) or a workspace
// file asks the user - the path's shape decides, as spelled and as resolved, and a removal of .alfred whole is not this
// check's (it is the data root). A read writes nothing and passes. Cursor's preToolUse does not enforce an ask: exit 2 there.
const STORE_RE = /[\\/]\.alfred[\\/](?:stack(?:[\\/]rules(?:[\\/][^\\/]+)?)?|workspace\.json)$/i;
function storeWrite() {
  const ti = payload.tool_input || {};
  const name = String(payload.tool_name || '');
  const read = !FS_WRITE_TOOL.test(name) && shell && shell.isShellTool(name) ? shellScan() : null;
  const targets = FS_WRITE_TOOL.test(name) ? [ti.path, ti.source, ti.destination].map(fsPath)
    : read ? read.scan.targets.map((t) => wordAt(read.scan, t, t.raw))
      : [ti.file_path, ti.notebook_path].map((t) => (typeof t === 'string' && t ? resolveIn(t) : null));
  const hit = targets.find((t) => t && (STORE_RE.test(t) || STORE_RE.test(real(t))));
  return hit ? shownAs(hit) : null;
}
{
  let file = null;
  try { file = storeWrite(); } catch { file = null; /* fails open */ }
  if (file) {
    let cursor = false;
    try { cursor = require('./hook-prelude.js').cursorHost(payload); } catch { cursor = typeof payload.cursor_version === 'string'; }
    if (cursor) { process.stderr.write(`hand this edit to the user: ${file} is a project rule source\n`); process.exit(2); }
    const reason = `${file} is a project rule source (or the workspace file): confirm this write, or make the change with /alfred-code:configure`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }));
    process.exit(0);
  }
}

