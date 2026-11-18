'use strict';
// session-status.js - the session status file (2026-10-29): what the stack does at a full context, published per main
// session for session-inspector at <project root>/.alfred/state/sessions/status/<session id>.json, schema 1 (the data
// root's own .gitignore keeps it out of git; through 3.12.1 it was <root>/.claude/session-inspector/status/). A public
// contract: a field is never renamed, dropped or retyped, only added. No stdin and no process of its own -
// history-session.js calls it at SessionStart and Stop, guard-answer.js at UserPromptSubmit, each inside a try.
// Fail-open: nothing here throws, and a failed write leaves no half-written file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// `plan` came last in 3.12 (PF1 D12): a file without it is still read, and upgraded in place at its next write.
const FIELDS = Object.freeze(['schema', 'session', 'fullContext', 'updatedAt', 'model', 'window', 'resumeAt', 'autoRun', 'scorer', 'autoCompact',
  'handoffPrompt', 'plan']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PRUNE_MS = 7 * 86400000;
const SLOW_MS = 200;
const PROMPT_MAX = 1000;
const EXCLUDE_COMMENT = '# alfred-code: session-inspector status files';
// history-session's SessionStart timeout is 10s, and a timed-out hook's output - the history start block with it - is
// discarded: no exclude spawn starts past 8s of the process's life.
const EXCLUDE_DEADLINE_MS = 8000;
const DAY_MS = 86400000;
const PRUNE_NAME = /^[A-Za-z0-9_-]{1,128}\.json(?:\.\d+\.tmp)?$/;
const STATUS_PARTS = ['.claude', 'session-inspector', 'status'];
const STATUS_FOLDER_PARTS = Object.freeze(['state', 'sessions', 'status']);
// The reader gate (status-file-root design, Part 2): the mod that reads the file, under either name, in any marketplace.
const READER_PLUGIN_RE = /^(alfred-mods|session-inspector)@/;
const SETTINGS_FILE = 'settings.json';
const MANAGED_DROPIN_DIR = 'managed-settings.d';
const SWITCH = Object.freeze({ on: 'on', off: 'off' });
// The sweep (Part 3): a status file at the root younger than this may belong to a live session - the first age no
// session leaves one (an unchanged file only has its time moved once past 24 hours) - and the root's exclude line.
const SWEEP_ROOT_MIN_AGE_MS = 25 * 3600 * 1000;
const ROOT_FORM_LINE = '/.claude/session-inspector/status/';

// The engines, each loaded on first use: an unchanged prompt pays one small file read, never fresh-session's load.
const ENGINE_FILES = { fresh: './fresh-session.js', prelude: './hook-prelude.js', history: './history.js', layout: './layout.js', planStatus: './plan-status.js' };
const loaded = {};
const engine = (name) =>
{
  if (!(name in loaded)) { try { loaded[name] = require(ENGINE_FILES[name]); } catch { loaded[name] = null; } }
  return loaded[name];
};
// `deps` names what a test injects; anything it leaves out is the real engine, the process env and Date.now.
function depsOf(deps) {
  if (deps && deps.resolved) return deps;
  const given = deps && typeof deps === 'object' ? deps : {};
  const out = { resolved: true, env: given.env || process.env, clock: given.clock || Date.now, uptime: given.uptime, exec: given.exec, dataRoot: given.dataRoot };
  for (const name of Object.keys(ENGINE_FILES)) Object.defineProperty(out, name, { enumerable: true, get: () => (name in given ? given[name] : engine(name)) });
  return out;
}
const objectOf = (payload) => (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);
const posInt = (n) => (Number.isInteger(n) && n > 0 ? n : null);
const posix = (p) => String(p).split(path.sep).join('/');
const envOf = (d, suffix) =>
{
  if (d.prelude && d.prelude.envOf) return d.prelude.envOf(d.env, suffix);
  const value = d.env[`ALFRED_CODE_${suffix}`];
  return value === '' ? undefined : value;
};

// The base is the project root (status-file-root design, Part 1): a subfolder cwd never makes a folder of its own. The
// root is the project dir, else the cwd.
function baseOf(payload, env = process.env) {
  return rootOf(payload, env);
}
function rootOf(payload, env = process.env) {
  const p = objectOf(payload) || {};
  return env.CLAUDE_PROJECT_DIR || (typeof p.cwd === 'string' && p.cwd) || null;
}
// A base belongs to the project: inside its root by real path (case-folded on Windows), or inside a linked worktree
// whose main checkout is the project's (A8) - so a `cd ~` never writes into the account's own .claude/.
function ownBase(base, root, deps) {
  try {
    const L = depsOf(deps).layout;
    if (!L || !base || !root) return false;
    const b = L.dirKey(base);
    const r = L.dirKey(root);
    if (b === r || b.startsWith(r.endsWith(path.sep) ? r : `${r}${path.sep}`)) return true;
    const top = L.gitTopOf(base);
    const rootTop = L.gitTopOf(root);
    if (!top || !rootTop) return false;
    const main = L.worktreeMain(top);
    return Boolean(main) && L.dirKey(main) === L.dirKey(rootTop);
  } catch { return false; }
}
// A session-inspector or status folder that is a symbolic link is refused: a cloned repo could point it anywhere, and
// the prune would delete there. The root's own `.claude` may be one - users link it on purpose - but one below the
// root is the clone's to point (A8).
function linkedStatus(base, root, deps) {
  let atRoot = false;
  try { const L = depsOf(deps).layout; atRoot = Boolean(L) && L.dirKey(base) === L.dirKey(root); } catch { atRoot = false; }
  for (const n of atRoot ? [2, 3] : [1, 2, 3]) {
    try { if (fs.lstatSync(path.join(base, ...STATUS_PARTS.slice(0, n))).isSymbolicLink()) return true; } catch { /* absent */ }
  }
  return false;
}
// A control character in a path would break the exclude line apart, and a file the exclude cannot cover is never written.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const refusedBase = (base, root, deps) => CONTROL_RE.test(base) || !ownBase(base, root, deps) || linkedStatus(base, root, deps);
const legacyStatusDir = (base) => path.join(base, ...STATUS_PARTS);

// The status folder: <data root>/state/sessions/status. `d.dataRoot` is the uninstall's override.
function statusFolder(root, deps) {
  const d = depsOf(deps);
  return path.resolve(root, d.dataRoot || d.layout.dataRoot(d.env), ...STATUS_FOLDER_PARTS);
}
const isAbsoluteData = (raw) => path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw);
// A data-root segment that is a symbolic link or junction pointing outside its anchor is refused: a cloned repo could
// point it anywhere, and the prune would delete there. A relative data root is judged from `.alfred` down, anchored at
// the project root; an absolute one (a harness's, the user's) from `state` down, anchored at itself. A link that stays
// inside its anchor is followed, and one that cannot be resolved counts as outside.
function linkedState(root, deps) {
  try {
    const d = depsOf(deps);
    const L = d.layout;
    const raw = String(d.dataRoot || L.dataRoot(d.env));
    const absolute = isAbsoluteData(raw);
    const anchor = absolute ? path.resolve(raw) : root;
    const anchorKey = L.dirKey(anchor);
    const inside = (real) => { const key = L.dirKey(real); return key === anchorKey || key.startsWith(anchorKey.endsWith(path.sep) ? anchorKey : `${anchorKey}${path.sep}`); };
    let at = anchor;
    const segments = absolute ? STATUS_FOLDER_PARTS : [...raw.split('/').filter(Boolean), ...STATUS_FOLDER_PARTS];
    for (const segment of segments) {
      at = path.join(at, segment);
      let linked = false;
      try { linked = fs.lstatSync(at).isSymbolicLink(); } catch { continue; }   // absent: nothing to follow
      if (!linked) continue;
      let real = null;
      try { real = fs.realpathSync(at); } catch { return true; }
      if (!inside(real)) return true;
    }
    return false;
  } catch { return true; }
}

// The `enabledPlugins` object of one settings file, or null: a file that is missing, unreadable, not JSON or holding no
// plain object there adds nothing.
function enabledPluginsOf(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const plugins = data && typeof data === 'object' ? data.enabledPlugins : null;
    return plugins && typeof plugins === 'object' && !Array.isArray(plugins) ? plugins : null;
  } catch { return null; }
}
// The settings files that can enable a plugin, lowest layer first: the user's, the project's, the local file Claude Code
// reads for the root, the managed file and its drop-ins in name order.
function settingsLayers(root, env, d) {
  const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const managed = d.layout.managedSettingsFile();
  const dropDir = path.join(path.dirname(managed), MANAGED_DROPIN_DIR);
  let drops = [];
  try { drops = fs.readdirSync(dropDir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort().map((n) => path.join(dropDir, n)); } catch { /* none */ }
  return [path.join(account, SETTINGS_FILE), path.join(root, '.claude', SETTINGS_FILE), d.layout.modeFile(root), managed, ...drops];
}
// Whether the mod that reads the status file is on: the variable first, else the merged `enabledPlugins`. Any failure
// reads as off - a write that cannot be justified is not made.
function readerOn(root, env, deps) {
  try {
    const d = depsOf(deps);
    const source = env && typeof env === 'object' ? env : d.env;
    const word = String(envOf({ prelude: d.prelude, env: source }, 'SESSION_STATUS') || '').trim().toLowerCase();
    if (word === SWITCH.on) return true;
    if (word === SWITCH.off) return false;
    if (!root || !d.layout) return false;
    const merged = {};
    for (const file of settingsLayers(root, source, d)) Object.assign(merged, enabledPluginsOf(file));
    return Object.keys(merged).some((key) => READER_PLUGIN_RE.test(key) && merged[key] === true);
  } catch { return false; }
}
const msSince = (from) => Math.round(Number(process.hrtime.bigint() - from) / 1e4) / 100;

// The file a write goes to, and whether a linked data-root segment refused it. `readerIsOn`, when a boolean, is the
// caller's one read of the reader gate.
function statusTarget(payload, deps, readerIsOn) {
  const none = { file: null, refused: false };
  try {
    const d = depsOf(deps);
    const p = objectOf(payload);
    if (!p || p.agent_id) return none;
    const id = String(p.session_id || '');
    if (!ID_RE.test(id)) return none;
    const root = rootOf(p, d.env);
    if (!root || !path.isAbsolute(root) || !d.layout) return none;
    if (!(typeof readerIsOn === 'boolean' ? readerIsOn : readerOn(root, d.env, d))) return none;
    if (!fs.statSync(root).isDirectory()) return none;   // a vanished root: never rebuilt by mkdirSync
    if (CONTROL_RE.test(root)) return none;
    if (linkedState(root, d)) return { file: null, refused: true };
    return { file: path.join(statusFolder(root, d), `${id}.json`), refused: false };
  } catch { return none; }
}
const statusFile = (payload, deps, readerIsOn) => statusTarget(payload, deps, readerIsOn).file;

const compactOn = (p, d) => (d.prelude && d.prelude.compactCause ? Boolean(d.prelude.compactCause(p, d.env)) : null);
// The prompt writes an auto-compact-only change at once; a window's own change waits for the Stop.
const compactSame = (s, p, d) => { try { return !s.autoCompact || s.autoCompact.on === compactOn(p, d); } catch { return true; } };
function scoringField(state) {
  return state && typeof state === 'object' && state.usable ? { on: Boolean(state.on), level: state.level, rounds: state.rounds } : null;
}

// The prompt that resumes this session's work: its newest open plan on the branch, with the plan's Resume: text (spec 3).
function handoffPrompt(root, branch, deps) {
  try {
    const d = depsOf(deps);
    const H = d.history;
    if (!H || !H.openPlan || !root) return null;
    const count = H.historyCount(envOf(d, 'HISTORY'));
    if (!count || !branch || branch === 'HEAD') return null;
    const open = H.openPlan(root, branch, count);
    if (!open) return null;
    // PF1 (R26): a folder plan is resumed through the writer script, which prints its state and its open cards
    if (open.dir) return `Run node .claude/hooks/plan-status.js resume --plan ${open.dir}, check that branch ${branch} is checked out, and continue from its Resume: line (${open.resume}).`.slice(0, PROMPT_MAX);
    // PF1 flat plan - until 4.0.0
    return `Read ${open.plan}, check that branch ${branch} is checked out, and continue from its Resume: line (${open.resume}).`.slice(0, PROMPT_MAX);
  } catch { return null; }
}

// The plan the session works on (PF1 D12): its folder relative to the root, forward slashes, one trailing slash - or
// null for anything that is no plan folder by shape, no directory, outside the root or a plan whose status.json says it
// is completed. An absent or unreadable status.json, or an engine that did not load, keeps the folder (PF1 F7).
function planField(root, candidate, deps) {
  try {
    if (typeof candidate !== 'string' || !candidate || typeof root !== 'string' || !root) return null;
    const d = depsOf(deps);
    const L = d.layout;
    if (!L || typeof L.planOf !== 'function' || typeof L.realpathOrSelf !== 'function') return null;
    const abs = path.resolve(root, candidate.replace(/\\/g, '/'));
    const plan = L.planOf(abs);
    if (!plan || plan.shape !== 'folder' || path.resolve(plan.dir) !== abs) return null;
    if (!fs.statSync(abs).isDirectory()) return null;
    const rel = path.relative(L.realpathOrSelf(root), L.realpathOrSelf(abs));
    if (!rel || path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return null;
    const P = d.planStatus;
    if (P && typeof P.readStatus === 'function') {
      const read = P.readStatus(abs);
      if (read && read.ok && read.status && read.status.completedAt) return null;
    }
    return `${posix(rel)}/`;
  } catch { return null; }
}

// The schema 1 object. `fields` may carry autoRun, scorer and handoffPrompt as they go in the file, and the history
// `entry` (undefined: read it); anything it leaves out is computed as at SessionStart.
function buildStatus(payload, fields, deps) {
  const d = depsOf(deps);
  const p = objectOf(payload) || {};
  const f = fields && typeof fields === 'object' ? fields : {};
  const id = String(p.session_id || '');
  const root = rootOf(p, d.env);
  const out = { schema: 1, session: id, fullContext: 'off', updatedAt: new Date().toISOString(), model: null, window: null, resumeAt: null,
    autoRun: false, scorer: null, autoCompact: null, handoffPrompt: null, plan: null };
  try {
    if ('autoRun' in f) out.autoRun = Boolean(f.autoRun);
    else if (d.prelude && d.prelude.autoRunFor) out.autoRun = Boolean(d.prelude.autoRunFor(p, d.env, null));   // R118
  } catch { out.autoRun = false; }
  // Auto-run offers no fresh session - the session compacts (guard-fresh-session-start's context line) - whatever the
  // trigger; nor does a session nobody attends (hook-prelude.js unattended) or one that compacts instead (compactCause).
  let noOffer = out.autoRun;
  try { noOffer = noOffer || Boolean(d.prelude && ((d.prelude.unattended && d.prelude.unattended(p, d.env)) || (d.prelude.compactCause && d.prelude.compactCause(p, d.env)))); } catch { /* attended */ }
  if (noOffer) out.fullContext = 'compact';
  try {
    const F = d.fresh;
    if (F) {
      F.use(p);
      const model = F.sessionModelId();
      const at = F.ctxThreshold();
      out.model = typeof model === 'string' && model ? model : null;
      out.window = posInt(F.knownWindow());
      out.resumeAt = posInt(at);
      out.fullContext = noOffer || F.COMPACT_INSTEAD ? 'compact' : F.FRESH_OFF || at == null ? 'off' : 'fresh-session';
    }
  } catch { /* the engine's fields stay null */ }
  try {
    if ('scorer' in f) out.scorer = f.scorer || null;
    else if (d.prelude && d.prelude.scoringState && root) out.scorer = scoringField(d.prelude.scoringState(root, id, d.env));
  } catch { out.scorer = null; }
  try { const on = compactOn(p, d); if (d.fresh && on !== null) out.autoCompact = { on, at: on ? posInt(d.fresh.autoCompactWindow()) : null }; }
  catch { out.autoCompact = null; }   // null: the engine cannot be loaded
  try {
    if ('handoffPrompt' in f) out.handoffPrompt = typeof f.handoffPrompt === 'string' && f.handoffPrompt ? f.handoffPrompt.slice(0, PROMPT_MAX) : null;
    else {
      const entry = f.entry !== undefined ? f.entry : d.history && d.history.entryFor && root ? d.history.entryFor(root, id) : null;
      out.handoffPrompt = handoffPrompt(root, entry && typeof entry.branch === 'string' ? entry.branch : '', d);
    }
  } catch { out.handoffPrompt = null; }
  if ('plan' in f) out.plan = planField(root, f.plan, d);
  return out;
}

// One probe row in the hook-blocks ledger guard-answer's ledgerRow writes; its own failure is swallowed.
function probeRow(payload, row, d) {
  try {
    const p = objectOf(payload) || {};
    const root = rootOf(p, d.env);
    if (!root || !d.layout) return;
    const dir = d.layout.statsPath(root, ['hook-blocks'], d.env);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(p.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), `${JSON.stringify({
      ts: new Date().toISOString(), hook: 'session-status.js', event: p.hook_event_name || '', tool: '', mode: 'probe', ...row,
    })}\n`);
  } catch { /* never throws */ }
}

// The legacy folder list: the bases an older release wrote a status file under, absolute with `/`; nothing appends to it now, and the sweep (removeStatus) is its only editor.
// `dataRoot` is the uninstall's alone: the folder an older install's data still sits in. A hook never hands one.
const listFile = (root, d) => (d.dataRoot ? path.join(root, ...String(d.dataRoot).split('/'), 'state', 'sessions', 'status-folders.json')
  : d.layout ? d.layout.statePath(root, 'sessions', 'status-folders.json', d.env) : null);
// The list's text, or null: only a regular file (no link, FIFO or device) under 64 KB is read - 32 entries are a few
// KB, and a link to a FIFO or /dev/zero stalled the session start (R134).
const LIST_MAX = 64 * 1024;
function readListText(file) {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() && st.size <= LIST_MAX ? fs.readFileSync(file, 'utf8') : null;
  } catch { return null; }
}
function readList(root, d) {
  try {
    const list = JSON.parse(readListText(listFile(root, d)));
    return Array.isArray(list) ? list.filter((b) => typeof b === 'string') : [];
  } catch { return []; }
}
function writeList(root, list, d) {
  const file = listFile(root, d);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw err; }
}
const readStatusFile = (file, id) => {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) && s.schema === 1 && s.session === id && FIELDS.every((k) => k === 'plan' || k in s) ? s : null;
  } catch { return null; }
};
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
// A carried value as the file should hold it: autoRun true only as the boolean, a scorer only as null or an object - a
// hand-edited "false" read as true (R136).
const autoRunOf = (s) => s.autoRun === true;
const scoringOf = (s) => (s.scorer && typeof s.scorer === 'object' && !Array.isArray(s.scorer) ? s.scorer : null);
const sameButTime = (a, b) => FIELDS.every((k) => k === 'updatedAt' || same(a[k], b[k]));

// 'always' writes; 'modes' (UserPromptSubmit) compares autoRun and the scorer first and builds only on a difference;
// 'changed' (Stop) writes when any field but updatedAt differs, carrying the prompt's autoRun and scorer from the file;
// 'plan' (a plan call at PreToolUse, PF1 R28) compares the checked folder with the file's first and carries the rest.
// `gate` (the prompt's stand-down) runs only once a write is due - after the compare, never on an unchanged prompt (R137).
function writeStatus(payload, fields, { when = 'always', deps, gate, on } = {}) {
  const d = depsOf(deps);
  let file = null;
  let tmp = null;
  let t0 = 0;
  let gateMs = 0;
  try {
    const gateFrom = process.hrtime.bigint();
    const target = statusTarget(payload, d, on);
    file = target.file;
    gateMs = msSince(gateFrom);
    if (!file) {
      if (target.refused) probeRow(payload, { kind: 'status-write', result: 'refused', ms: 0, gateMs }, d);
      return 'skipped';
    }
    const p = objectOf(payload);
    const id = String(p.session_id);
    t0 = d.clock();
    const current = readStatusFile(file, id);
    const f = { ...(fields && typeof fields === 'object' ? fields : {}) };
    // PF1 D12: every write carries the plan the file holds, checked again; a file from before the key is written once
    // whatever else changed, so it gains the key (R2)
    const upgrade = Boolean(current) && !('plan' in current);
    if (current && !('plan' in f)) f.plan = current.plan;
    const root = rootOf(p, d.env);
    if (when === 'changed' && !f.plan) {
      // PF1 (R30): at Stop, a file with no plan takes the history record's folder plan - the session's newest plan write
      // or plan call - when the fresh-session hook set none (it is off, or the plan was named before 3.12)
      const entry = f.entry !== undefined ? f.entry : d.history && d.history.entryFor && root ? d.history.entryFor(root, id) : null;
      f.entry = entry;   // buildStatus takes it as read: the record is read once per write
      const named = entry && typeof entry.plan === 'string' ? entry.plan.replace(/\\/g, '/') : '';
      if (named && root && !named.startsWith('~/') && !path.posix.isAbsolute(named) && !/^[A-Za-z]:\//.test(named) && d.layout && d.layout.planOf) {
        const plan = d.layout.planOf(path.resolve(root, named));
        if (plan && plan.shape === 'folder') f.plan = plan.dir;
      }
    }
    if (when === 'plan') {
      // PF1 (R28): the plan call's folder, checked, against the file's - equal is unchanged, with no build and no write
      const want = planField(root, f.plan, d);
      if (!upgrade && current && same(current.plan, want)) return 'unchanged';
      // a --plan naming no folder on disk (a typo) names no plan: the session keeps the one it has (final review, finding 3)
      if (want === null && current && root && !fs.existsSync(path.resolve(root, String(f.plan).replace(/\\/g, '/')))) return 'unchanged';
      if (gate && !gate()) return 'skipped';
      f.plan = want;
      if (current) { f.autoRun = autoRunOf(current); f.scorer = scoringOf(current); f.handoffPrompt = current.handoffPrompt; }
    } else if (when === 'modes') {
      // ...unless the file says auto-run without compact - an older core's file, corrected now, not at the next Stop (R116)
      if (!upgrade && current && compactSame(current, p, d) && same(current.autoRun, f.autoRun) && same(current.scorer, f.scorer)
        && (current.autoRun !== true || current.fullContext === 'compact')) return 'unchanged';
      if (gate && !gate()) return 'skipped';
      if (current) f.handoffPrompt = current.handoffPrompt;
    } else if (when === 'changed' && current) {
      f.autoRun = autoRunOf(current);
      f.scorer = scoringOf(current);
    }
    let next = buildStatus(p, f, d);
    if (when === 'changed' && current) {
      if (!upgrade && sameButTime(next, current)) {
        // a live session's file never reaches the prune age
        try { if (Date.now() - fs.statSync(file).mtimeMs > DAY_MS) { const now = new Date(); fs.utimesSync(file, now, now); } } catch { /* the next Stop */ }
        return 'unchanged';
      }
      const again = readStatusFile(file, id);   // a prompt landing since the first read keeps its values
      // a changed autoRun changes fullContext too: rebuilt, the handoff prompt carried so history is not read twice
      if (again && autoRunOf(again) !== next.autoRun) next = buildStatus(p, { ...f, autoRun: autoRunOf(again), scorer: scoringOf(again), handoffPrompt: next.handoffPrompt }, d);
      else if (again) next.scorer = scoringOf(again);
      // PF1: a plan call landing since the first read keeps its plan
      if (again && !same(again.plan, current.plan)) next.plan = planField(root, again.plan, d);
    } else if (when === 'modes') {
      // A Stop writing the handoff prompt since the first read keeps it: the rename would undo it (R135).
      const again = readStatusFile(file, id);
      if (again && !same(again.handoffPrompt, current ? current.handoffPrompt : null)) next.handoffPrompt = again.handoffPrompt;
      // PF1: a plan call landing since the first read keeps its plan
      if (again && !same(again.plan, current ? current.plan : null)) next.plan = planField(root, again.plan, d);
    } else if (when === 'plan' && current) {
      // a prompt's or a Stop's values that landed since the first read are kept; a changed autoRun rebuilds fullContext
      const again = readStatusFile(file, id);
      if (again && autoRunOf(again) !== next.autoRun) next = buildStatus(p, { ...f, autoRun: autoRunOf(again), scorer: scoringOf(again), handoffPrompt: again.handoffPrompt }, d);
      else if (again) { next.scorer = scoringOf(again); next.handoffPrompt = again.handoffPrompt; }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    tmp = `${file}.${process.pid}.tmp`;
    try { fs.unlinkSync(tmp); } catch { /* none there */ }
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(tmp, file);
    tmp = null;
    const ms = Math.max(0, d.clock() - t0);
    probeRow(p, { kind: 'status-write', result: ms > SLOW_MS ? 'slow' : 'ok', ms, gateMs }, d);
    return 'written';
  } catch {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* none */ } }
    if (file) probeRow(payload, { kind: 'status-write', result: 'failed', ms: Math.max(0, (() => { try { return d.clock() - t0; } catch { return 0; } })()), gateMs }, d);
    return 'skipped';
  }
}

// At SessionStart: every status file over 7 days old in the status folder goes, this session's own kept; a linked
// folder is skipped. The legacy folders and the list are the sweep's alone (removeStatus).
function pruneStatus(root, sessionId, now, deps) {
  const d = depsOf(deps);
  let count = 0;
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root) || !d.layout || linkedState(root, d)) return 0;
    const own = `${sessionId}.json`;
    const folder = statusFolder(root, d);
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return 0; }
    for (const name of names) {
      if (!PRUNE_NAME.test(name) || name === own) continue;
      const file = path.join(folder, name);
      try {
        const st = fs.lstatSync(file);
        if (st.isFile() && now - st.mtimeMs > PRUNE_MS) { fs.unlinkSync(file); count++; }
      } catch { /* gone, or not ours to remove */ }
    }
  } catch { /* what was pruned */ }
  return count;
}

// Out of git: `/<base from its top>/.claude/session-inspector/status/` in the common dir's info/exclude, one gitSafe
// spawn per common dir - a main checkout and its linked worktrees share one.
function excludeLine(top, base) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const rel = posix(path.relative(real(top), real(base)));
  if (CONTROL_RE.test(rel)) return null;
  const escaped = rel.replace(/[\\*?[]/g, (c) => `\\${c}`);
  return escaped ? `/${escaped}/.claude/session-inspector/status/` : '/.claude/session-inspector/status/';
}
function excludeOne(common, top, base) {
  try {
    const line = excludeLine(top, base);
    if (!line) return 'skipped';
    const file = path.join(common, 'info', 'exclude');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
    if (text.split(/\r?\n/).some((l) => l.trim() === line)) return 'present';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    fs.appendFileSync(file, `${text && !text.endsWith('\n') ? eol : ''}${EXCLUDE_COMMENT}${eol}${line}${eol}`);
    return 'added';
  } catch { return 'failed'; }
}
function ensureExcluded(bases, deps) {
  const d = depsOf(deps);
  const list = Array.isArray(bases) ? bases : [];
  const out = list.map(() => 'skipped');
  try {
    const L = d.layout;
    if (!L) return out;
    const uptime = d.uptime || (() => process.uptime() * 1000);
    const exec = d.exec || execFileSync;
    const groups = new Map();
    list.forEach((base, i) => {
      const top = L.gitTopOf(base);
      if (!top) return;
      const key = L.dirKey(L.worktreeMain(top) || top);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ i, base, top });
    });
    let late = false;
    for (const items of groups.values()) {
      if (late || uptime() > EXCLUDE_DEADLINE_MS) { late = true; for (const it of items) out[it.i] = 'late'; continue; }
      let common = null;
      try {
        const [cmd, argv, opts] = d.prelude.gitSafe(['-C', items[0].top, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
        const answer = String(exec(cmd, argv, opts)).trim();
        common = answer ? path.resolve(items[0].top, answer) : null;
      } catch { common = null; }
      for (const it of items) out[it.i] = common ? excludeOne(common, it.top, it.base) : 'failed';
    }
  } catch { /* what was decided */ }
  return out;
}

// UNINSTALL (audit 2026-11-03 SYS-03): what this module wrote for the project goes - under the root and each listed base,
// every file a status write names (`<id>.json`, a crashed write's `.tmp`), then the `status/`, `session-inspector/` and
// `.claude/` folders each only once empty; each exclude pair it added for those bases (the comment with the anchored line
// right under it); and the list of bases. Never a file session-inspector keeps there (HANDOFF.md, plans/, scores/), a
// file no status write names, a refused base (outside the project, a linked folder), a line of the user's own, nor
// another project's pair still in use in a shared git dir. A stack pair whose status folder exists in NONE of the
// repository's work trees goes too (E-batch SYS-03: a base the list had dropped kept its pair): it excludes nothing, and
// the next write re-adds it (`excludeOne`). Only a non-root pair is swept - the root-form pair goes through the list alone -
// and with no worktree listing (git failed or timed out) nothing is swept, today's reading.
// THE SWEEP (status-file-root design, Part 3): with `options` - `except` (a base left whole) or `rootMinAgeMs` (a file
// at the root, or in a listed linked worktree's own top, younger than that stays: a new-version session owns it) - the
// same care runs at SessionStart over the folders earlier versions left. A base still holding a status file, or one whose
// exclude group the deadline did not reach, keeps its list entry and its pair; the list is rewritten to those and removed
// only when none is left. An uninstall past the deadline keeps the list the same way. Returns { files, folders, lines } (and `bases` kept, when sweeping, and `late`, the bases not reached, when any); fail-open like the rest.
function holdsStatusFile(dir) {
  try {
    return fs.readdirSync(dir).some((name) => { try { return PRUNE_NAME.test(name) && fs.lstatSync(path.join(dir, name)).isFile(); } catch { return false; } });
  } catch { return false; }
}
const isFolder = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };
// A list that is a link, a FIFO or any non-file is never replaced or removed by a sweep; an absent one may be written.
const listReplaceable = (file) => { try { return fs.lstatSync(file).isFile(); } catch { return true; } };
// Whether a work tree's own exclude file may hold the stack's pair: a file that is there without the marker comment, or a
// `.git` folder with none, holds nothing to take. A `.git` that is a file (a linked work tree) is read by git, so it may.
function excludeMayHoldPair(top) {
  try {
    if (!fs.statSync(path.join(top, '.git')).isDirectory()) return true;
    try { return fs.readFileSync(path.join(top, '.git', 'info', 'exclude'), 'utf8').includes(EXCLUDE_COMMENT); } catch (e) { return !(e && e.code === 'ENOENT'); }
  } catch { return true; }
}
// The uninstall's take of the data-root status files: each distinct folder of the kept data root (`d.dataRoot`) and of the
// one the hook writes to, its status files and then the folder itself once empty. A folder behind a link that leaves the
// project is left alone. The exclude lines are the legacy sweep's; no line covers these files.
function removeStateStatus(root, d, out) {
  const seen = new Set();
  for (const where of [d, { ...d, dataRoot: undefined }]) {
    let folder;
    try {
      folder = statusFolder(root, where);
      const key = d.layout.dirKey(folder);
      if (seen.has(key)) continue;
      seen.add(key);
      if (linkedState(root, where)) continue;
    } catch { continue; }
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!PRUNE_NAME.test(name)) continue;
      try {
        const file = path.join(folder, name);
        if (!fs.lstatSync(file).isFile()) continue;
        fs.unlinkSync(file);
        out.files++;
      } catch { /* gone */ }
    }
    try { fs.rmdirSync(folder); out.folders.push(folder); } catch { /* not empty, or gone */ }
  }
}
function removeStatus(root, deps, options) {
  const d = depsOf(deps);
  const opt = options && typeof options === 'object' ? options : {};
  const sweeping = opt.except !== undefined || opt.rootMinAgeMs !== undefined;
  const out = { files: 0, folders: [], lines: 0 };
  if (sweeping) out.bases = 0;
  try {
    if (typeof root !== 'string' || !root || !path.isAbsolute(root) || !d.layout) return out;
    const L = d.layout;
    const rootKey = L.dirKey(root);
    const exceptKey = typeof opt.except === 'string' && opt.except ? L.dirKey(opt.except) : null;
    const minAge = opt.rootMinAgeMs > 0 ? opt.rootMinAgeMs : 0;
    const now = d.clock();
    const rootTop = minAge ? L.gitTopOf(root) : '';
    // the age a file in this base must reach before the sweep takes it: the root's and a linked worktree's own top (a
    // new-version session started there owns it); any other subfolder is an older version's litter, swept at any age
    const minAgeOf = (b) => {
      if (!sweeping || !minAge) return 0;
      const key = L.dirKey(b);
      if (key === rootKey) return minAge;
      const top = L.gitTopOf(b);
      return top && L.dirKey(top) === key && !(rootTop && L.dirKey(rootTop) === key) ? minAge : 0;
    };
    const bases = [];
    const seen = new Set();
    const listed = readList(root, d);
    for (const b of [root, ...listed]) {
      if (typeof b !== 'string' || !path.isAbsolute(b)) continue;
      const key = L.dirKey(b);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!refusedBase(b, root, d)) bases.push(b);
    }
    // what stays whole after the sweep: the except base while its folder exists, any base still holding a status file
    const holding = new Set();
    for (const b of bases) {
      const dir = legacyStatusDir(b);
      const key = L.dirKey(b);
      if (exceptKey && key === exceptKey) { if (isFolder(dir)) holding.add(key); continue; }
      const youngerThan = minAgeOf(b);
      let names = null;
      try { names = fs.readdirSync(dir); } catch { names = null; }
      for (const name of names || []) {
        if (!PRUNE_NAME.test(name)) continue;
        const file = path.join(dir, name);
        try {
          const st = fs.lstatSync(file);
          if (!st.isFile() || (youngerThan && now - st.mtimeMs < youngerThan)) continue;
          fs.unlinkSync(file);
          out.files++;
        } catch { /* gone */ }
      }
      if (sweeping && holdsStatusFile(dir)) holding.add(key);
      // the folders this module made, innermost first, each only once empty; the root's .claude is the uninstall's
      const tops = key === rootKey ? [dir, path.dirname(dir)] : [dir, path.dirname(dir), path.join(b, '.claude')];
      for (const at of tops) {
        try { if (fs.readdirSync(at).length) break; fs.rmdirSync(at); out.folders.push(at); } catch { break; }
      }
    }
    const uptime = d.uptime || (() => process.uptime() * 1000);
    const exec = d.exec || execFileSync;
    const groups = new Map();
    for (const base of bases) {
      const top = L.gitTopOf(base);
      if (!top) continue;
      const line = excludeLine(top, base);
      if (!line) continue;
      const key = L.dirKey(L.worktreeMain(top) || top);
      if (!groups.has(key)) groups.set(key, { top, drop: new Set(), keep: new Set(), bases: [] });
      const group = groups.get(key);
      group.bases.push(L.dirKey(base));
      (holding.has(L.dirKey(base)) ? group.keep : group.drop).add(line);
    }
    const late = new Set();
    let past = false;
    for (const { top, drop, keep, bases: members } of groups.values()) {
      if (!drop.size) continue;
      if (past || uptime() > EXCLUDE_DEADLINE_MS) {
        past = true;
        // a group whose exclude file cannot hold a pair has nothing to be late for
        if (excludeMayHoldPair(top)) for (const key of members) late.add(key);
        continue;
      }
      let common = null;
      try {
        const [cmd, argv, opts] = d.prelude.gitSafe(['-C', top, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
        const answer = String(exec(cmd, argv, opts)).trim();
        common = answer ? path.resolve(top, answer) : null;
      } catch { common = null; }
      if (!common) continue;
      const file = path.join(common, 'info', 'exclude');
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      // every work tree of the repository, listed once; null when git could not answer
      let trees = null;
      try {
        if (uptime() > EXCLUDE_DEADLINE_MS) { if (!sweeping) for (const key of members) late.add(key); throw new Error('past the deadline'); }
        const [cmd, argv, opts] = d.prelude.gitSafe(['-C', top, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
        trees = String(exec(cmd, argv, opts)).split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).trim()).filter(Boolean);
      } catch { trees = null; }
      // the root form is one line of the common exclude, shared by the main checkout and every linked worktree: a sweep keeps
      // it while any work tree git lists still holds a legacy status file (an older release's session there writes it), and
      // when the list could not be read
      const rootFormNeeded = sweeping && (!trees || trees.some((tree) => holdsStatusFile(legacyStatusDir(tree))));
      // a line a base still holding a file needs, an except base's root form and a root form a work tree still needs are never dropped
      const droppable = (line) => !keep.has(line) && !(line === ROOT_FORM_LINE && (exceptKey || rootFormNeeded));
      const unused = (line) => {
        const m = /^\/(.+)\/\.claude\/session-inspector\/status\/$/.exec(line);
        if (!m || !trees || !trees.length) return false;
        const rel = m[1].replace(/\\(.)/g, '$1');
        return !trees.some((t) => { try { return fs.statSync(path.join(t, rel, '.claude', 'session-inspector', 'status')).isDirectory(); } catch { return false; } });
      };
      // each row with its own line ending, so every other byte of the file stays as it was
      const rows = text.match(/[^\n]*\n|[^\n]+$/g) || [];
      const bare = (r) => r.replace(/\r?\n$/, '').trim();
      const kept = [];
      let dropped = 0;
      for (let i = 0; i < rows.length; i++) {
        if (bare(rows[i]) === EXCLUDE_COMMENT && i + 1 < rows.length && droppable(bare(rows[i + 1])) && (drop.has(bare(rows[i + 1])) || unused(bare(rows[i + 1])))) { i++; dropped++; continue; }
        kept.push(rows[i]);
      }
      if (!dropped) continue;
      try { fs.writeFileSync(file, kept.join('')); out.lines += dropped; } catch { /* left as it was */ }
    }
    if (!sweeping) removeStateStatus(root, d, out);
    const listPath = listFile(root, d);
    // an uninstall that ran out of time keeps the list, cut to the bases not reached, so a run again finds their pairs
    if (late.size) out.late = late.size;
    if (!sweeping && !late.size) { try { fs.rmSync(listPath, { force: true }); } catch { /* none */ } return out; }
    const stay = bases.filter((b) => holding.has(L.dirKey(b)) || late.has(L.dirKey(b))).map(posix);
    if (sweeping) out.bases = stay.length;
    if (listPath && listReplaceable(listPath)) {
      try {
        if (!stay.length) fs.rmSync(listPath, { force: true });
        else if (!same(listed.map(posix), stay)) writeList(root, stay, d);
      } catch { /* the next start sweeps again */ }
    }
  } catch { /* what was done */ }
  return out;
}

// The modes a status names, in the words and order of the first prompt's ON line (guard-answer.js); '' when none is on.
function modesLine(s) {
  const [sc, ac] = s && typeof s === 'object' ? [scoringOf(s), s.autoCompact || {}] : [null, {}];
  const on = [s && s.autoRun === true && 'auto-run', sc && sc.on && `scoring (level ${sc.level})`,
    ac.on && `auto-compact${posInt(ac.at) ? ` (at ${Math.round(ac.at / 1000)}k)` : ''}`].filter(Boolean);
  return on.length ? `Modes ON: ${on.join(', ')}` : '';
}

// Whether the sweep has work: the list names an absolute base, or the root holds the legacy status folder. Nothing writes
// in either any more, so the reader's state no longer matters. An empty or absent list and no folder cost one list read.
function sweepDue(root, d) {
  try {
    return readList(root, d).some((b) => path.isAbsolute(b)) || isFolder(legacyStatusDir(root));
  } catch { return false; }
}

// The callers' one line each. The session start returns the modes line (startup, resume, clear - a compaction says none).
// `deps` is a test's seam: history-session.js hands none.
function onSessionStart(payload, entry, deps) {
  let line = '';
  try {
    const p = objectOf(payload);
    if (!p || p.agent_id || !ID_RE.test(String(p.session_id || ''))) return '';
    const d = depsOf(deps);
    const root = rootOf(p, d.env);
    // once per SessionStart (a compact start included): an install without the mod leaves one timed row at the start, never one per turn
    const gateFrom = process.hrtime.bigint();
    const on = readerOn(root, d.env, d);
    if (!on) probeRow(p, { kind: 'status-gate', result: 'off', ms: msSince(gateFrom) }, d);
    writeStatus(p, { entry }, { when: 'always', deps: d, on });
    if (['startup', 'resume', 'clear'].includes(p.source)) line = modesLine(readStatusFile(statusFile(p, d, on) || '', String(p.session_id))
      || buildStatus(p, { entry, handoffPrompt: null }, d));
    if (!root) return line;
    if (path.isAbsolute(root) && sweepDue(root, d)) {
      const sweepFrom = process.hrtime.bigint();
      const swept = removeStatus(root, d, { rootMinAgeMs: SWEEP_ROOT_MIN_AGE_MS });
      if (swept.files || swept.lines) probeRow(p, { kind: 'status-sweep', files: swept.files, lines: swept.lines, bases: swept.bases, ms: msSince(sweepFrom) }, d);
    }
    pruneStatus(root, String(p.session_id), Date.now(), d);
  } catch { /* fail-open */ }
  return line;
}
function onStop(payload, entry) {
  try { return writeStatus(payload, { entry }, { when: 'changed' }); } catch { return 'skipped'; }
}
// PF1 (D12, R28): a plan call at PreToolUse names the plan the session works on; a seat's call sets nothing.
function onPlan(payload, folder, gate) {
  try {
    const p = objectOf(payload);
    if (!p || p.agent_id || typeof folder !== 'string' || !folder) return 'skipped';
    return writeStatus(p, { plan: folder }, { when: 'plan', gate: typeof gate === 'function' ? gate : undefined });
  } catch { return 'skipped'; }
}
function onPrompt(payload, modes, gate) {
  try {
    if (!modes || typeof modes.autoRun !== 'boolean') return 'skipped';
    return writeStatus(payload, { autoRun: modes.autoRun, scorer: scoringField(modes.scoring) }, { when: 'modes', gate: typeof gate === 'function' ? gate : undefined });
  } catch { return 'skipped'; }
}

module.exports = {
  FIELDS, ID_RE, PRUNE_MS, SLOW_MS, PROMPT_MAX, EXCLUDE_COMMENT, EXCLUDE_DEADLINE_MS,
  baseOf, rootOf, ownBase, readerOn, statusFile, scoringField, handoffPrompt, planField, buildStatus, writeStatus, statusFolder, linkedState, pruneStatus,
  ensureExcluded, removeStatus, onSessionStart, onStop, onPrompt, onPlan, modesLine,
};
