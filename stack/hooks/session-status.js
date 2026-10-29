'use strict';
// session-status.js - the session status file (2026-10-29): what the stack does at a full context, published per main
// session for session-inspector at <cwd>/.claude/session-inspector/status/<session id>.json, schema 1. A public
// contract: a field is never renamed, dropped or retyped, only added. No stdin and no process of its own -
// history-session.js calls it at SessionStart and Stop, guard-answer.js at UserPromptSubmit, each inside a try.
// Fail-open: nothing here throws, and a failed write leaves no half-written file.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FIELDS = Object.freeze(['schema', 'session', 'fullContext', 'updatedAt', 'model', 'window', 'resumeAt', 'autoRun', 'scorer', 'handoffPrompt']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PRUNE_MS = 7 * 86400000;
const SLOW_MS = 200;
const MAX_BASES = 32;
const PROMPT_MAX = 1000;
const EXCLUDE_COMMENT = '# alfred-code: session-inspector status files';
// history-session's SessionStart timeout is 10s, and a timed-out hook's output - the history start block with it - is
// discarded: no exclude spawn starts past 8s of the process's life.
const EXCLUDE_DEADLINE_MS = 8000;
const DAY_MS = 86400000;
const PRUNE_NAME = /^[A-Za-z0-9_-]{1,128}\.json(?:\.\d+\.tmp)?$/;
const STATUS_PARTS = ['.claude', 'session-inspector', 'status'];

// The engines, each loaded on first use: an unchanged prompt pays one small file read, never fresh-session's load.
const ENGINE_FILES = { fresh: './fresh-session.js', prelude: './hook-prelude.js', history: './history.js', layout: './layout.js' };
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
  const out = { resolved: true, env: given.env || process.env, clock: given.clock || Date.now, uptime: given.uptime, exec: given.exec };
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

// The base is the live cwd (spec A1), else the project dir; the root is the project dir, else the cwd.
function baseOf(payload, env = process.env) {
  const p = objectOf(payload) || {};
  return (typeof p.cwd === 'string' && p.cwd) || env.CLAUDE_PROJECT_DIR || null;
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
const statusDir = (base) => path.join(base, ...STATUS_PARTS);

function statusFile(payload, deps) {
  try {
    const d = depsOf(deps);
    const p = objectOf(payload);
    if (!p || p.agent_id) return null;
    const id = String(p.session_id || '');
    if (!ID_RE.test(id)) return null;
    const base = baseOf(p, d.env);
    const root = rootOf(p, d.env);
    if (!base || !root || !path.isAbsolute(base)) return null;
    if (!fs.statSync(base).isDirectory()) return null;   // a vanished cwd: never rebuilt by mkdirSync
    if (refusedBase(base, root, d)) return null;
    return path.join(statusDir(base), `${id}.json`);
  } catch { return null; }
}

function scorerField(state) {
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
    return `Read ${open.plan}, check that branch ${branch} is checked out, and continue from its Resume: line (${open.resume}).`.slice(0, PROMPT_MAX);
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
  const out = { schema: 1, session: id, fullContext: 'off', updatedAt: new Date().toISOString(), model: null, window: null, resumeAt: null, autoRun: false, scorer: null, handoffPrompt: null };
  try {
    if ('autoRun' in f) out.autoRun = Boolean(f.autoRun);
    else if (d.prelude && d.prelude.autoRunFor) out.autoRun = d.prelude.autoRunFor(p, d.env, null);
  } catch { out.autoRun = false; }
  // Auto-run offers no fresh session - the session compacts (guard-fresh-session-start's context line) - whatever the
  // trigger; nor does a session nobody attends (hook-prelude.js unattended: the gate leaves the pointer, never the offer).
  let noOffer = out.autoRun;
  try { noOffer = noOffer || Boolean(d.prelude && d.prelude.unattended && d.prelude.unattended(p, d.env)); } catch { /* attended */ }
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
    else if (d.prelude && d.prelude.scorerState && root) out.scorer = scorerField(d.prelude.scorerState(root, id, d.env));
  } catch { out.scorer = null; }
  try {
    if ('handoffPrompt' in f) out.handoffPrompt = typeof f.handoffPrompt === 'string' && f.handoffPrompt ? f.handoffPrompt.slice(0, PROMPT_MAX) : null;
    else {
      const entry = f.entry !== undefined ? f.entry : d.history && d.history.entryFor && root ? d.history.entryFor(root, id) : null;
      out.handoffPrompt = handoffPrompt(root, entry && typeof entry.branch === 'string' ? entry.branch : '', d);
    }
  } catch { out.handoffPrompt = null; }
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

// The folder list: every base a session of this project wrote a status file under, absolute with `/`, at most 32.
const listFile = (root, d) => (d.layout ? d.layout.statePath(root, 'sessions', 'status-folders.json', d.env) : null);
function readList(root, d) {
  try {
    const list = JSON.parse(fs.readFileSync(listFile(root, d), 'utf8'));
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
function appendBase(root, base, d) {
  try {
    const list = readList(root, d);
    const entry = posix(base);
    if (list.includes(entry)) return;
    list.push(entry);
    while (list.length > MAX_BASES) list.shift();
    writeList(root, list, d);
  } catch { /* the next session start lists it */ }
}

const readStatusFile = (file, id) => {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) && s.schema === 1 && s.session === id && FIELDS.every((k) => k in s) ? s : null;
  } catch { return null; }
};
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const sameButTime = (a, b) => FIELDS.every((k) => k === 'updatedAt' || same(a[k], b[k]));

// 'always' writes; 'modes' (UserPromptSubmit) compares autoRun and the scorer first and builds only on a difference;
// 'changed' (Stop) writes when any field but updatedAt differs, carrying the prompt's autoRun and scorer from the file.
function writeStatus(payload, fields, { when = 'always', deps } = {}) {
  const d = depsOf(deps);
  let file = null;
  let tmp = null;
  let t0 = 0;
  try {
    file = statusFile(payload, d);
    if (!file) return 'skipped';
    const p = objectOf(payload);
    const id = String(p.session_id);
    t0 = d.clock();
    const current = readStatusFile(file, id);
    const f = { ...(fields && typeof fields === 'object' ? fields : {}) };
    if (when === 'modes') {
      if (current && same(current.autoRun, f.autoRun) && same(current.scorer, f.scorer)) return 'unchanged';
      if (current) f.handoffPrompt = current.handoffPrompt;
    } else if (when === 'changed' && current) {
      f.autoRun = current.autoRun;
      f.scorer = current.scorer;
    }
    let next = buildStatus(p, f, d);
    if (when === 'changed' && current) {
      if (sameButTime(next, current)) {
        // a live session's file never reaches the prune age
        try { if (Date.now() - fs.statSync(file).mtimeMs > DAY_MS) { const now = new Date(); fs.utimesSync(file, now, now); } } catch { /* the next Stop */ }
        return 'unchanged';
      }
      const again = readStatusFile(file, id);   // a prompt landing since the first read keeps its values
      // a changed autoRun changes fullContext too: rebuilt, the handoff prompt carried so history is not read twice
      if (again && !same(again.autoRun, next.autoRun)) next = buildStatus(p, { ...f, autoRun: again.autoRun, scorer: again.scorer, handoffPrompt: next.handoffPrompt }, d);
      else if (again) next.scorer = again.scorer;
    }
    const dir = path.dirname(file);
    const dirExisted = fs.existsSync(dir);
    const fileExisted = fs.existsSync(file);
    fs.mkdirSync(dir, { recursive: true });
    tmp = `${file}.${process.pid}.tmp`;
    try { fs.unlinkSync(tmp); } catch { /* none there */ }
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(tmp, file);
    tmp = null;
    const ms = Math.max(0, d.clock() - t0);
    probeRow(p, { kind: 'status-write', result: ms > SLOW_MS ? 'slow' : 'ok', ms }, d);
    const base = path.dirname(path.dirname(path.dirname(dir)));
    const root = rootOf(p, d.env);
    if (!fileExisted && root) appendBase(root, base, d);
    if (!dirExisted && p.hook_event_name !== 'SessionStart') ensureExcluded([base], d);
    return 'written';
  } catch {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* none */ } }
    if (file) probeRow(payload, { kind: 'status-write', result: 'failed', ms: Math.max(0, (() => { try { return d.clock() - t0; } catch { return 0; } })()) }, d);
    return 'skipped';
  }
}

// The bases the exclude check covers: the cwd, then every listed base, each the project's and holding a status folder.
function statusBases(root, cwd, deps) {
  const d = depsOf(deps);
  const out = [];
  const seen = new Set();
  try {
    for (const b of [cwd, ...readList(root, d)]) {
      if (typeof b !== 'string' || !path.isAbsolute(b)) continue;
      const key = d.layout ? d.layout.dirKey(b) : b;
      if (seen.has(key)) continue;
      seen.add(key);
      if (refusedBase(b, root, d)) continue;
      try { if (fs.statSync(statusDir(b)).isDirectory()) out.push(b); } catch { /* no folder */ }
    }
  } catch { /* what was found */ }
  return out;
}

// At SessionStart: every status file over 7 days old under the cwd and the listed bases goes, this session's own kept;
// a listed base that is not the project's, is a link or has lost its folder leaves the list.
function pruneStatus(root, cwd, sessionId, now, deps) {
  const d = depsOf(deps);
  let count = 0;
  try {
    const own = `${sessionId}.json`;
    const passed = new Map();
    const visit = (b) => {
      if (typeof b !== 'string' || !path.isAbsolute(b)) return false;
      const key = d.layout ? d.layout.dirKey(b) : b;
      if (passed.has(key)) return passed.get(key);
      let ok = false;
      if (!refusedBase(b, root, d)) {
        let names = null;
        try { names = fs.readdirSync(statusDir(b)); } catch { names = null; }
        if (names) {
          ok = true;
          for (const name of names) {
            if (!PRUNE_NAME.test(name) || name === own) continue;
            const file = path.join(statusDir(b), name);
            try {
              const st = fs.lstatSync(file);
              if (st.isFile() && now - st.mtimeMs > PRUNE_MS) { fs.unlinkSync(file); count++; }
            } catch { /* gone, or not ours to remove */ }
          }
        }
      }
      passed.set(key, ok);
      return ok;
    };
    visit(cwd);
    let raw = null;
    try { raw = fs.readFileSync(listFile(root, d), 'utf8'); } catch { raw = null; }
    if (raw !== null) {
      const kept = readList(root, d).filter((b) => visit(b)).map(posix);
      let before = null;
      try { before = JSON.parse(raw); } catch { before = null; }
      if (!same(before, kept)) writeList(root, kept, d);
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

// The callers' one line each.
function onSessionStart(payload, entry) {
  try {
    const p = objectOf(payload);
    if (!p || p.agent_id || !ID_RE.test(String(p.session_id || ''))) return;
    const d = depsOf();
    writeStatus(p, { entry }, { when: 'always', deps: d });
    const root = rootOf(p, d.env);
    const base = baseOf(p, d.env);
    if (!root || !base) return;
    pruneStatus(root, base, String(p.session_id), Date.now(), d);
    for (const result of ensureExcluded(statusBases(root, base, d), d)) {
      if (result === 'failed' || result === 'late') probeRow(p, { kind: 'status-exclude', result }, d);
    }
  } catch { /* fail-open */ }
}
function onStop(payload, entry) {
  try { return writeStatus(payload, { entry }, { when: 'changed' }); } catch { return 'skipped'; }
}
function onPrompt(payload, modes) {
  try {
    if (!modes || typeof modes.autoRun !== 'boolean') return 'skipped';
    return writeStatus(payload, { autoRun: modes.autoRun, scorer: scorerField(modes.scorer) }, { when: 'modes' });
  } catch { return 'skipped'; }
}

module.exports = {
  FIELDS, ID_RE, PRUNE_MS, SLOW_MS, MAX_BASES, PROMPT_MAX, EXCLUDE_COMMENT, EXCLUDE_DEADLINE_MS,
  baseOf, rootOf, ownBase, statusFile, scorerField, handoffPrompt, buildStatus, writeStatus, statusBases, pruneStatus,
  ensureExcluded, onSessionStart, onStop, onPrompt,
};
