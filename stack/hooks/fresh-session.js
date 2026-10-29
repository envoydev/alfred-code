// fresh-session.js - the fresh-session ARITHMETIC guard-stop-contract.js and
// guard-fresh-session-start.js share: the trigger per window tier, which window this session runs
// in, and what a resume would recover. An ENGINE, copied beside the hooks and never wired (the
// docs.js / memory.js pattern): both hooks require it through __dirname, so the plugin cache and a
// copied install find it the same way, and model-windows.json is read from beside it.
// The two copies it replaces were identical, block for block, when they were moved here.
'use strict';
const fs = require('fs');
// Ships beside hook-prelude.js on both routes (never among the three engines copied alone), so the
// require is unconditional, the same assumption every other cross-file require here already makes.
const prelude = require('./hook-prelude.js');
const { envOf } = prelude;
// An ask the idle timeout closed is no answer (ruling S3); a prelude without the test reads none as timed out.
const askTimedOut = typeof prelude.askTimedOut === 'function' ? prelude.askTimedOut : () => false;

// The hook's parsed payload - the transcript path and cwd the reads below need. A hook calls
// use(payload) once, before its first call into this file.
let payload = {};
function use(p) {
  payload = p && typeof p === 'object' ? p : {};
  _knownWindow = undefined;
  _ignored = undefined;
  _started = undefined;
  _modelId = undefined;
  _floor = undefined;
  _firstUsage = undefined;
  _ttl = undefined;
  _settleRan = false;
}

// The trigger is an ABSOLUTE token count per WINDOW TIER, one environment variable each (the user's ruling of 2026-10-16;
// the percentage knob before them was inert at its default on both real tiers, so the clamps decided and the setting lied
// about what it controlled). Say when you want to be asked:
//   ALFRED_CODE_CONTEXT_WINDOW_FOR_1M   - the trigger on a 1M window, 1,000,000 and up (seeded 400,000)
//   ALFRED_CODE_CONTEXT_WINDOW_FOR_300K - the trigger on a 300K window, 300,000 up to 1M (seeded 280,000)
//   ALFRED_CODE_CONTEXT_WINDOW_FOR_200K - the trigger on a 200K window, 200,000 up to 300K (seeded 180,000)
//   ALFRED_CODE_CONTEXT_WINDOW_DEFAULT  - the trigger when the window is unknown or under 200K, or its tier's own value
//                                         is unset or garbage (seeded 180,000; unset or garbage reads as 180,000)
// The WINDOW is the session model's own capacity and nothing else (the user's ruling of 2026-10-21): a window takes the
// largest tier it reaches (tierKeyOf), and a trigger below its own tier's number is clamped inside it (ctxThreshold).
// The default is a TRIGGER, never a window: until 2026-10-21 it was the window an unlisted model was assumed to run in, so a
// session the hook could not place sat on the 300K tier's 280,000 whatever its real size. `0` on a tier turns that tier's
// offer off, `0` on the default the offer of a session with no tier. NOTE the 1M seed sits ABOVE the harness's own auto-compaction (measured preTokens 387,619 / 391,290 / 393,516 /
// 393,969 / 395,112 / 396,651 / 396,954 / 397,171 across three projects), so on that tier the Stop offer is usually
// unreachable by design and the SessionStart `compact` route is what reaches the user - lower the variable to be asked
// before the harness decides. Read through envOf - the key is passed with the ALFRED_CODE_ prefix, read by its suffix.
function freshAt(key, dflt) {
  const n = parseInt(envOf(process.env, String(key).replace(/^ALFRED_CODE_/, '')), 10);
  return Number.isNaN(n) || n < 0 ? dflt : n;   // unset or garbage takes the fallback; 0 is a real answer (off)
}
// The default's seed, and what it reads as when unset or garbage: it fires before compaction in every window of 200K or
// more, so a session the hook cannot place is never judged against a number past where the harness compacts.
const DEFAULT_SEED = 180000;
const DEFAULT_AT = freshAt('ALFRED_CODE_CONTEXT_WINDOW_DEFAULT', DEFAULT_SEED);
// The tier a window belongs to - the one rule the hooks and the installer's auto-compact seeding (settings.js
// compactWindowSeeds) both read: 1M and up, 300K and up, 200K and up; under 200K, or unknown, no tier (null).
function tierKeyOf(window) {
  const w = Number(window) || 0;
  return w >= 1000000 ? 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M' : w >= 300000 ? 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K'
    : w >= 200000 ? 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K' : null;
}
const FRESH_AT_1M = freshAt('ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', DEFAULT_AT);
const FRESH_AT_300K = freshAt('ALFRED_CODE_CONTEXT_WINDOW_FOR_300K', DEFAULT_AT);
const FRESH_AT_200K = freshAt('ALFRED_CODE_CONTEXT_WINDOW_FOR_200K', DEFAULT_AT);
const FRESH_AT = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: FRESH_AT_1M, ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: FRESH_AT_300K, ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: FRESH_AT_200K };
// COMPACT INSTEAD (the user's rulings, 2026-10-14 and 2026-10-16): ALFRED_CODE_AUTO_COMPACT=1 makes the project compact where
// it would have been offered a fresh session - the installer seeds each model's autoCompactWindow at its tier's trigger
// above (settings.js compactWindowSeeds), and every offer, ask, note and hold reads the gate as OFF: the switch, never a
// tier set to 0, is what turns the fresh-session hook off. `0` (the seed) keeps the offers; anything but `1` reads as `0`.
const COMPACT_INSTEAD = String(envOf(process.env, 'AUTO_COMPACT') || '').trim() === '1';
// `0` on all three tiers AND the DEFAULT (the trigger of a session with no tier) is the other whole off switch. The
// retired ALFRED_CODE_FRESH_SESSION_PCT / _DEFAULT are not read.
const FRESH_OFF = (FRESH_AT_1M === 0 && FRESH_AT_300K === 0 && FRESH_AT_200K === 0 && DEFAULT_AT === 0) || COMPACT_INSTEAD;

// --- which context WINDOW is this session running in? -------------------------------------
// ONE rule: the session model's FULL id is looked up in `model-windows.json`, shipped beside this hook
// and replaced on every update, so a new model arrives with the release that lists it. That row is the model's
// capacity; a model the table does not list has NO known window (the user's ruling of 2026-10-21) and takes
// ALFRED_CODE_CONTEXT_WINDOW_DEFAULT as its trigger - no window is assumed for it. Two MEASURED facts can only lower a
// known window (audit 2026-10-10 C08): the install's own auto-compact window when a setting names it, and the lowest
// compaction point this project recorded for the model (autoCompactWindow / observedCompaction below). Nothing else
// decides - not a `[1m]`/`[200k]` id suffix, not the carry. Those inferences each fixed one case
// and broke another (Sonnet 5 runs 1M on a bare id, so the suffix read offered a resume at ~252k),
// and a window that moves with the session's own history cannot be predicted by the person who set
// it. The table holds the API maximum from the Claude models docs; a session that runs smaller than
// its row is the table's error, corrected in the table.
// The id comes from two places, and the NEWER one wins:
// - the model SessionStart and PostModelSwitch hand guard-fresh-session-start.js, saved per session in
//   `<data root>/state/sessions/models.json` (recordSessionModel). Verified in the hooks reference
//   (code.claude.com/docs/en/hooks, read 2026-10-21): SessionStart is the only event whose input carries `model` - it
//   may be left out, after /clear for one - and PostModelSwitch carries `to_model`; no event carries a window size.
//   It is the only id there is before the session's first reply.
// - the main transcript's last `message.model` - subagents write their own files, so a Haiku helper cannot answer for
//   the session - or the harness's `model` attachment row (`identity.modelId`, re-written after every compaction).
//   Right after a compaction the harness re-attaches 0.4-0.6MB (invoked skill bodies, the instructions, the agent
//   listing) before the next assistant row, so a 512KB tail held no model and the window fell to the DEFAULT tier
//   (audit 2026-10-10 C08: 180,000 for a 1M session in 6 ledgers). The read widens once to 8MB.
// The settings `model` key is never read: it holds what was typed, an alias like `sonnet` that names no capacity - the
// user's report of 2026-10-21, where `sonnet` matched no row and a 1M session was judged on a 300k default window.
// Measured: the PreToolUse payload carries no model and no window, and no env var names either.
// Memoized per payload (audit 2026-10-20, the hooks track's minor list: a UserPromptExpansion read up to 8MB five or six
// times for one answer); `use()` clears it.
let _modelId;
function sessionModelId() {
  if (_modelId === undefined) _modelId = readModelId();
  return _modelId;
}
function readModelId() {
  const saved = savedModel();
  const seen = transcriptModel();
  if (saved && seen && seen.at > saved.at) return seen.model;   // a reply after the record names the model it ran on
  return saved ? saved.model : seen ? seen.model : null;
}
// The transcript's last model row: { model, at } - `at` is the row's timestamp, NaN when it has none.
function transcriptModel() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    for (const span of [512 * 1024, 8 * 1024 * 1024]) {
      const start = Math.max(0, size - span);
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(size - start);
      try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"model"') && !lines[i].includes('"modelId"')) continue;
        try {
          const o = JSON.parse(lines[i]);
          const m = o.type === 'assistant' ? o.message && o.message.model
            : o.type === 'attachment' && o.attachment && o.attachment.type === 'model' ? o.attachment.identity && o.attachment.identity.modelId : null;
          if (m && m !== '<synthetic>') return { model: String(m), at: Date.parse(o.timestamp || '') };
        } catch { /* partial first line of the tail - skip */ }
      }
      if (start === 0) break;
    }
  } catch { /* unreadable transcript */ }
  return null;
}
// The model this session's SessionStart / PostModelSwitch saved: { model, at } (at in ms), or null.
const SAVED_MODELS = 40;
function savedModelsFile() {
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  return require('./layout.js').statePath(root, 'sessions', 'models.json');
}
function readSavedModels() {
  try {
    const rows = JSON.parse(fs.readFileSync(savedModelsFile(), 'utf8'));
    return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
  } catch { return {}; }
}
function savedModel() {
  const sid = String(payload.session_id || '');
  const row = sid ? readSavedModels()[sid] : null;
  const at = row && Date.parse(row.at || '');
  return row && typeof row.model === 'string' && row.model && Number.isFinite(at) ? { model: row.model, at } : null;
}
// Saves the model a SessionStart (`model`) or PostModelSwitch (`to_model`) names for this session, keeping the newest
// SAVED_MODELS sessions. No session id or no model saves nothing - the transcript answers then.
function recordSessionModel(model) {
  try {
    const sid = String(payload.session_id || '');
    const id = String(model || '').trim();
    if (!sid || !id) return false;
    const rows = readSavedModels();
    rows[sid] = { model: id, at: new Date().toISOString() };
    const kept = Object.entries(rows).filter(([, r]) => r && Number.isFinite(Date.parse(r.at || '')))
      .sort(([, a], [, b]) => Date.parse(a.at) - Date.parse(b.at)).slice(-SAVED_MODELS);
    const file = savedModelsFile();
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(kept), null, 1) + '\n');
    fs.renameSync(tmp, file);
    _modelId = undefined;
    _knownWindow = undefined;
    return true;
  } catch { return false; }
}
// A key matches the id itself, a dated snapshot (`claude-haiku-4-5-20251001`, Vertex's `@20251101`), a
// Bedrock version (`-v1:0`), Claude Code's `[1m]` suffix and a provider-prefixed id
// (`us.anthropic.claude-opus-5-v1:0`); the longest matching key wins. Nothing else may follow the key: a
// bare `-` let `claude-opus-5-5` read as a snapshot of `claude-opus-5` and take its window silently (2.1.5 M6).
// The one key rule for both tables keyed by model: the windows here, the cache read rates below.
function modelKey(id, keys) {
  const s = String(id || '').toLowerCase();
  if (!s) return null;
  let best = null;
  for (const key of keys) {
    const k = String(key).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(^|[./])${k}(?=$|-\\d{8}(?!\\d)|-v\\d|@|:|\\[)`).test(s)) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best;
}
function tableWindow() {
  const id = sessionModelId();
  if (!id) return null;
  let models = {};
  try { models = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'model-windows.json'), 'utf8')).models || {}; } catch { return null; }
  const key = modelKey(id, Object.keys(models).filter((k) => Number(models[k]) >= 100000));
  return key ? Number(models[key]) : null;
}
// The install's own AUTO-COMPACT window, when it is set (code.claude.com/docs/en/model-config, 'Set the auto-compact
// window': 'how full the context window can get before Claude Code compacts'; settings-reference `autoCompactWindow` /
// `modelSettings`). Read in the documented order: the environment variable (both spellings the docs use), then each
// settings file from the highest scope down - a `modelSettings` entry for this session's model before that file's
// top-level key. The top-level key counts in EVERY file, the user's included: the settings reference gives it 'Scope:
// Any file' and no model limit (re-read 2026-10-14, audit HK03) - the Opus 5 / Fable 5.1 limit on the user file is
// `effortLevel`'s, and skipping it here left a user window under the trigger (390k) unread until a compaction was recorded.
// 'auto', garbage or a value outside 100K-1M is no window. This only ever LOWERS the window: the harness caps the
// auto-compact window at the model's own.
// The configured window and where it came from: `{ n, source, mtimeMs }` - the env name with no mtime, or the settings
// file with its mtime (the moment the value could first take effect, at the next session start).
function configuredCompactWindow() {
  const valid = (v) => { const n = typeof v === 'number' ? v : /^\d+$/.test(String(v || '').trim()) ? parseInt(v, 10) : NaN; return n >= 100000 && n <= 1000000 ? n : null; };
  for (const k of ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_AUTOCOMPACT_WINDOW']) {
    const n = valid(process.env[k]);
    if (n) return { n, source: k, mtimeMs: null };
  }
  try {
    const path = require('path');
    const os = require('os');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude');
    const id = String(sessionModelId() || '').toLowerCase();
    const files = [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(account, 'settings.json')];
    for (const file of files) {
      let s;
      try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!s || typeof s !== 'object') continue;
      const per = s.modelSettings && typeof s.modelSettings === 'object' && id
        ? Object.entries(s.modelSettings).find(([k]) => k.toLowerCase() === id || id.endsWith(`/${k.toLowerCase()}`) || id.endsWith(`.${k.toLowerCase()}`)) : null;
      const n = valid(per && per[1] && per[1].autoCompactWindow) || valid(s.autoCompactWindow);
      if (n) { let mtimeMs = null; try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* read a moment ago */ } return { n, source: file, mtimeMs }; }
    }
  } catch { /* no root, no home */ }
  return null;
}
// A configured window the harness did NOT honour (audit 2026-10-20 C10, 81ebfa5f / 1aebc759 / b28289bf): a 350k
// `modelSettings.<model>.autoCompactWindow` in the project's settings.local.json, and three sessions compacted at
// 466.8k-469.7k while the asks quoted 350k. The settings reference does not say which scopes Claude Code reads the key
// from, so no cause is claimed - only the measurement: an automatic compaction this project recorded for the model, more
// than 5% above the configured window, by a session that STARTED after the value was written (the key is read at session
// start only, so a session already running when it was written proves nothing; an env window counts this session's own
// points). Then the key is no window: the asks stop quoting it, and the start hook says once that it was not honoured.
const IGNORED_SLACK = 1.05;
let _ignored;
function compactWindowIgnored() {
  if (_ignored !== undefined) return _ignored;
  _ignored = null;
  try {
    const c = configuredCompactWindow();
    const id = String(sessionModelId() || '').toLowerCase();
    if (!c || !id) return _ignored;
    const sid = String(payload.session_id || '');
    const mine = (r) => sid && r.session === sid && (c.mtimeMs == null || (sessionStartedAt() || 0) >= c.mtimeMs);
    const after = (r) => c.mtimeMs != null && Date.parse(r.started || '') >= c.mtimeMs;
    const over = truePoints().filter((r) => r.model === id && Number(r.tokens) > c.n * IGNORED_SLACK && (mine(r) || after(r)));
    if (over.length) _ignored = { configured: c.n, seen: Math.max(...over.map((r) => Number(r.tokens))), source: c.source };
  } catch { /* unreadable - the key stands */ }
  return _ignored;
}
function autoCompactWindow() {
  const c = configuredCompactWindow();
  return c && !compactWindowIgnored() ? c.n : null;
}
// When this session started: the transcript's first timestamped row (its first 64KB).
let _started;
function sessionStartedAt() {
  if (_started !== undefined) return _started;
  _started = null;
  try {
    const fd = fs.openSync(String(payload.transcript_path || ''), 'r');
    const buf = Buffer.alloc(64 * 1024);
    let n = 0;
    try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    const m = buf.toString('utf8', 0, n).match(/"timestamp"\s*:\s*"([^"]+)"/);
    const t = m ? Date.parse(m[1]) : NaN;
    if (Number.isFinite(t)) _started = t;
  } catch { /* no transcript */ }
  return _started;
}
// The compaction points this PROJECT has measured: each automatic compaction leaves its context in
// `<data root>/state/sessions/compact-points.json` (guard-fresh-session-start.js writes it at PreCompact and at the compact
// start; the pre-2.8.0 `<docs>/flow/` one is read until the first write moves its rows), and
// the lowest one for this session's model in the last 30 days is a fact about where the harness compacts here - which
// the model's row cannot know (audit 2026-10-10 C08: 29 compactions of one project at 300-400k against a 400k trigger,
// so the Stop offer could not fire before the harness compacted).
const COMPACT_POINTS_DAYS = 30;
function compactPointsFile(write = false) {
  const path = require('path');
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  let layout = null;
  try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
  if (layout) return write ? layout.statePath(root, 'sessions', 'compact-points.json') : layout.findState(root, 'sessions', 'compact-points.json');
  return path.resolve(root, envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`, 'flow', 'compact-points.json'); // pre-2.8.0, no layout.js here
}
function readCompactPoints() {
  try {
    const rows = JSON.parse(fs.readFileSync(compactPointsFile(), 'utf8'));
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && Number(r.tokens) >= 50000 && typeof r.model === 'string') : [];
  } catch { return []; }
}
function recordCompactPoint(tokens, model, { held } = {}) {
  try {
    const n = Math.round(Number(tokens));
    if (!(n >= 50000) || !model) return false;
    const cut = Date.now() - COMPACT_POINTS_DAYS * 86400000;
    const rows = readCompactPoints().filter((r) => Date.parse(r.at) >= cut);
    const started = sessionStartedAt();
    rows.push({ at: new Date().toISOString(), session: String(payload.session_id || ''), model: String(model).toLowerCase(), tokens: n,
      ...(started ? { started: new Date(started).toISOString() } : {}), ...(held ? { held: true } : {}) });
    const file = compactPointsFile(true);
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows.slice(-40), null, 1) + '\n');
    fs.renameSync(tmp, file);
    _ignored = undefined;
    _knownWindow = undefined;
    return true;
  } catch { return false; }
}
// The points that count. A HELD one - a compaction after a 50-minute gap, so perhaps Claude Code's idle compaction
// (hook-prelude.js idleByTiming) - counts only once the settle pass found no idle notice after its boundary.
function truePoints() {
  if (!_settleRan) { _settleRan = true; settleCompactPoints(); }
  return readCompactPoints().filter((r) => !r.held);
}
// --- the settle pass (2026-10-30): each pending point confirmed against its own transcript ---------
// Once per process. A row with no session, or one that is no id (hook-prelude.js SESSION_ID_RE), is out of reach: kept,
// counted, never read. Else, read the transcript beside this session's own: missing 10 min on - dropped (untied); not
// 30 s old - wait; its boundary's idle notice - dropped; no boundary while the session went on 10 min, or after an hour -
// dropped (untied); a boundary 30 s past with no notice - settled, a true point. Untied is DROPPED, not kept: a kept one
// can hold a wrong trigger for 30 days, a dropped true one costs until the next real compaction (the seeded tier till then).
const SETTLE_BUDGET = 64 * 1024 * 1024;
const READ_CAP = 32 * 1024 * 1024;
const READ_SLACK = 1200000;
let _settleRan = false;
const pointKey = (r) => `${r.at}|${r.session}|${r.tokens}`;
function settleCompactPoints({ now = Date.now(), budgetBytes = SETTLE_BUDGET, capBytes = READ_CAP } = {}) {
  const res = { dropped: 0, settled: 0 };
  try {
    const own = String(payload.transcript_path || '');
    const sid = String(payload.session_id || '');
    const path = require('path');
    const byFile = new Map();
    for (const r of readCompactPoints()) {
      const at = Date.parse(r.at);
      if (r.settled || !r.session || !prelude.SESSION_ID_RE.test(String(r.session)) || !Number.isFinite(at) || !own) continue;
      if (now < at + 30000) continue;
      const file = r.session === sid ? own : path.join(path.dirname(own), `${r.session}.jsonl`);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(r);
    }
    const decide = new Map();
    let spent = 0;
    for (const [file, rows] of byFile) {
      let st = null;
      try { st = fs.statSync(file); } catch { /* missing */ }
      if (!st) { for (const r of rows) if (now >= Date.parse(r.at) + 600000) decide.set(pointKey(r), 'drop'); continue; }
      // one window per run of rows under 15 min apart, so the hours between two compactions are never read
      const sorted = rows.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const runs = [];
      for (const r of sorted) {
        const last = runs[runs.length - 1];
        if (last && Date.parse(r.at) - Date.parse(last[last.length - 1].at) <= 900000) last.push(r); else runs.push([r]);
      }
      for (const run of runs) {
        if (spent >= budgetBytes) break;
        const w = readWindow(file, Date.parse(run[0].at) - 120000, Date.parse(run[run.length - 1].at) + 750000, { capBytes });
        spent += w.bytes;
        // a row is decided only on what the read reached: a cut read decides nothing it stopped short of, and an hour on drops it
        const reached = (t) => w.reachedTo >= t + READ_SLACK;
        for (const r of run) {
          const at = Date.parse(r.at);
          const b = w.boundaries.find((x) => x.trigger === 'auto' && x.at - (Number(x.durationMs) || 0) - 120000 <= at && at <= x.at + 120000);
          if (!reached(b ? b.at + 30000 : at + 750000)) { if (now >= at + 3600000) decide.set(pointKey(r), 'drop'); continue; }
          if (!b) { if (st.mtimeMs >= at + 600000 || now >= at + 3600000) decide.set(pointKey(r), 'drop'); continue; }
          if (w.notices.some((n) => n >= b.at - 1000 && n <= b.at + 30000)) decide.set(pointKey(r), 'drop');
          else if (now >= b.at + 30000) decide.set(pointKey(r), 'settle');
        }
      }
    }
    if (!decide.size) return res;
    // applied to a fresh read, by key: a point another hook recorded since this pass began survives it
    const rows = [];
    for (const r of readCompactPoints()) {
      const d = decide.get(pointKey(r));
      if (d === 'drop') { res.dropped++; continue; }
      if (d === 'settle' && !r.settled) {
        const { held, ...rest } = r;
        rows.push({ ...rest, settled: true });
        res.settled++;
        continue;
      }
      rows.push(r);
    }
    if (!res.dropped && !res.settled) return res;
    const out = compactPointsFile(true);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 1) + '\n');
    fs.renameSync(tmp, out);
    _ignored = undefined;
    _knownWindow = undefined;
  } catch { /* the points stand as they are; the next pass tries again */ }
  return res;
}
// A point's WINDOW of its transcript, never the whole file (real ones run to hundreds of MB): a binary search over 64KB
// blocks by the newest timestamp in each, for the first block 20 min before `fromMs` - the slack over the worst lag a row
// was measured to sit behind the newest before it (14.5 min over the twelve largest transcripts, 2026-10-30) - then one
// forward read until the newest timestamp passes `toMs` + the slack, or `capBytes`. Only boundary and notice lines parse.
// `reachedTo`: the newest timestamp the forward read saw, Infinity once it read to the file's end.
function readWindow(file, fromMs, toMs, { slackMs = READ_SLACK, capBytes = READ_CAP } = {}) {
  const out = { boundaries: [], notices: [], bytes: 0, reachedTo: NaN };
  const TS_RE = /"timestamp"\s*:\s*"([^"]+)"/g;
  const newest = (text) => {
    let best = NaN;
    for (const m of text.matchAll(TS_RE)) { const t = Date.parse(m[1]); if (Number.isFinite(t) && !(t <= best)) best = t; }
    return best;
  };
  const take = (line) => {
    if (!line.includes('"compact_boundary"') && !line.includes('Compacted ')) return;   // either notice spelling (hook-prelude.js)
    let o;
    try { o = JSON.parse(line); } catch { return; }   // a garbage line, or one still being written
    const at = Date.parse((o && o.timestamp) || '');
    if (!Number.isFinite(at)) return;
    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const m = o.compactMetadata || {};
      out.boundaries.push({ at, durationMs: Number(m.durationMs), preTokens: Number(m.preTokens), trigger: m.trigger });
    } else if (prelude.isIdleNotice(o)) out.notices.push(at);
  };
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const BLOCK = 64 * 1024;
    const probe = Buffer.alloc(BLOCK);
    // the newest timestamp from block `i` on, reading up to 16 blocks past a stretch with none (one huge row)
    const stamp = (k) => {
      const n = fs.readSync(fd, probe, 0, BLOCK, k * BLOCK);
      out.bytes += n;
      return newest(probe.toString('utf8', 0, n));
    };
    // ... and with none ahead (a row of over 1 MB whose timestamp ends it), the nearest one behind stands for the block
    const blockAt = (i) => {
      for (let k = i; k < i + 16 && k * BLOCK < size; k++) { const t = stamp(k); if (Number.isFinite(t)) return t; }
      for (let k = i - 1; k >= 0 && k > i - 16; k--) { const t = stamp(k); if (Number.isFinite(t)) return t; }
      return NaN;
    };
    let lo = 0;
    let hi = Math.ceil(size / BLOCK);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = blockAt(mid);
      if (!Number.isFinite(t) || t >= fromMs - slackMs) hi = mid; else lo = mid + 1;
    }
    let pos = Math.max(0, lo - 1) * BLOCK;
    const first = pos;
    const chunk = Buffer.alloc(1024 * 1024);
    let rest = '';
    let seen = NaN;
    let read = 0;
    while (pos < size && read < capBytes && !(seen >= toMs + slackMs)) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      pos += n;
      read += n;
      out.bytes += n;
      const lines = (rest + chunk.toString('utf8', 0, n)).split('\n');
      rest = lines.pop();
      if (first > 0 && read === n) lines.shift();   // the block's cut first line
      for (const line of lines) {
        const t = newest(line);
        if (Number.isFinite(t) && !(t <= seen)) seen = t;
        take(line);
      }
    }
    if (rest) take(rest);   // the file's last line, with no newline after it yet
    out.reachedTo = pos >= size ? Infinity : seen;
  } finally { fs.closeSync(fd); }
  return out;
}
// --- the idle compaction (2026-10-30) ------------------------------------------------------------
// What a compaction's transcript says about it, from a 4MB tail: the last main-thread reply before it, whether anything
// that could start a model call came since (a typed prompt, a prompt command, a task notification, a tool result - a
// local command or a `!` line cannot), its start and context, and at the boundary the idle notice when already written.
const COMMAND_ROW_RE = /^\s*<command-(?:name|message)>/;
const LOCAL_OUTPUT_RE = /^\s*<local-command-std(?:out|err)>/;
function rowText(o) {
  const c = o && o.message && o.message.content;
  return typeof c === 'string' ? c : Array.isArray(c) && c[0] && c[0].type === 'text' ? String(c[0].text || '') : '';
}
function compactionFacts({ atBoundary = false } = {}) {
  const p = String(payload.transcript_path || '');
  if (!p) return null;
  const size = fs.statSync(p).size;
  const from = Math.max(0, size - 4 * 1024 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(size - from);
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  const rows = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') rows.push(o); } catch { /* the tail's cut first line */ }
  }
  let b = -1;
  if (atBoundary) {
    for (let i = rows.length - 1; i >= 0 && b < 0; i--) if (rows[i].type === 'system' && rows[i].subtype === 'compact_boundary') b = i;
    if (b < 0) return null;
  }
  const before = b < 0 ? rows : rows.slice(0, b);
  let reply = -1;
  for (let i = before.length - 1; i >= 0 && reply < 0; i--) {
    const o = before[i];
    if (o.type === 'assistant' && !o.isSidechain && o.message && o.message.model !== '<synthetic>') reply = i;
  }
  // a command row is a prompt command unless a local command's output row follows it
  let promptSince = false;
  let command = false;
  for (const o of before.slice(reply + 1)) {
    if (o.type !== 'user') continue;
    if (prelude.localOnlyRow(o)) { if (LOCAL_OUTPUT_RE.test(rowText(o))) command = false; continue; }
    if (COMMAND_ROW_RE.test(rowText(o))) { command = true; continue; }
    promptSince = true;
    break;
  }
  if (command) promptSince = true;
  const lastReplyAt = reply < 0 ? NaN : Date.parse(before[reply].timestamp || '');
  if (!atBoundary) return { lastReplyAt, promptSince, start: Date.now(), preTokens: NaN, boundaryAt: NaN, notice: false };
  const meta = rows[b].compactMetadata || {};
  const boundaryAt = Date.parse(rows[b].timestamp || '');
  const duration = Number(meta.durationMs);
  let notice = false;
  for (const o of rows.slice(b + 1)) {
    if (o.type === 'system' && o.subtype === 'compact_boundary') break;
    if (prelude.isIdleNotice(o) && Math.abs(Date.parse(o.timestamp || '') - boundaryAt) <= 30000) notice = true;
  }
  return { lastReplyAt, promptSince, start: boundaryAt - (Number.isFinite(duration) ? duration : 0), preTokens: Number(meta.preTokens), boundaryAt, notice };
}
// The verdict on this session's compaction: `idle` - the notice, else the timing (hook-prelude.js idleByTiming); `held`
// - `idle`, or a gap of 50 minutes or more whatever came since and whatever the tokens (PreCompact's count is the last
// reply's input side, 1-5k under the boundary's preTokens, so a floor test there lets an idle one through). A reader that
// fails answers neither, and the point is recorded as before.
function idleCompaction({ atBoundary = false, preTokens } = {}) {
  try {
    const f = compactionFacts({ atBoundary });
    if (!f) return { idle: false, held: false };
    const gapMs = f.start - f.lastReplyAt;
    const idle = f.notice || prelude.idleByTiming({ gapMs, promptSince: f.promptSince, preTokens: atBoundary ? f.preTokens : Number(preTokens),
      floor: prelude.idleFloor(process.env) });
    return { idle: !!idle, held: !!idle || (Number.isFinite(gapMs) && gapMs >= prelude.IDLE_GAP_MS) };
  } catch { return { idle: false, held: false }; }
}
function observedCompaction() {
  const id = String(sessionModelId() || '').toLowerCase();
  if (!id) return null;
  const cut = Date.now() - COMPACT_POINTS_DAYS * 86400000;
  const seen = truePoints().filter((r) => r.model === id && Date.parse(r.at) >= cut).map((r) => Number(r.tokens));
  return seen.length ? Math.min(...seen) : null;
}
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) {
    const table = tableWindow();
    const acw = autoCompactWindow();
    _knownWindow = acw && (!table || acw < table) ? acw : table;
  }
  return _knownWindow;
}
// The trigger this session is judged against: the tier of the model's own capacity (tierKeyOf), else - no known
// capacity, one under 200K - ALFRED_CODE_CONTEXT_WINDOW_DEFAULT itself, so the offer always has a number behind it.
function ctxThreshold() {
  const window = knownWindow();
  // The TIER is the model's own capacity, its table row - an auto-compact window only lowers the room the trigger must
  // fit in (the clamp below). Tiering by the lowered window put a 1M model under a 400k compaction window on another
  // tier's trigger (2026-10-14).
  const tier = tierKeyOf(tableWindow());
  let at = tier ? FRESH_AT[tier] : DEFAULT_AT;
  // A trigger at or above the window it applies to can never be reached, and a gate that cannot
  // fire is the gate not existing. Honour the number that was set up to the point it goes
  // unreachable, then clamp it back inside the window.
  if (at > 0 && window && at >= window) at = Math.floor(window * 0.9);
  // ... and a trigger the harness's MEASURED compaction point sits under is the same unreachable gate: it is held at
  // 90% of the lowest automatic compaction this project recorded for this model. The seeded tier numbers are untouched.
  const seen = at > 0 ? observedCompaction() : null;
  if (seen && at >= seen * 0.9) at = Math.floor(seen * 0.9);
  return at > 0 ? at : null;   // 0 = this trigger's offer is switched off
}
// --- what a fresh session restarts at: the session's own cold floor ---------------------------
// A large share of the carry can be the INSTALL's own standing inventory - system prompt, CLAUDE.md, the always-on
// rules - which a fresh session pays again on its first message (87k-134k across the nine audited projects). The
// verdict below prices that restart against the warm cache.
// The floor is the FIRST main-session reply's usage, read forward from the head in 512KB chunks up to 8MB: a head of
// attachment rows or a long paste once hid it in a single 512KB read (and the floor then read as unmeasured), and a
// sidechain or `<synthetic>` row stood in for it. Lines split on the newline byte, the bytes past a chunk's last one
// carried into the next, so a line - and a multibyte character on the cut - is decoded whole. Memoized per payload.
const FLOOR_CHUNK = 512 * 1024;
const FLOOR_READ_MAX = 8 * 1024 * 1024;
let _floor;
let _firstUsage;
function replyUsage(line) {
  if (!line.includes('"assistant"')) return null;
  let o;
  try { o = JSON.parse(line); } catch { return null; }   // a partial or shapeless row - keep looking
  if (!o || o.type !== 'assistant' || o.isSidechain || !o.message || o.message.model === '<synthetic>') return null;
  const u = o.message.usage && typeof o.message.usage === 'object' ? o.message.usage : null;
  // a reply that reports no tokens (an error row) is no floor - one read as 0 left the session unmeasured for good
  return u && (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0) > 0 ? u : null;
}
function setFloor(u) { _firstUsage = u; _floor = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0); }
function readFloor() {
  if (_floor !== undefined) return;
  _floor = null;
  _firstUsage = null;
  let fd;
  try {
    const p = payload.transcript_path;
    if (!p) return;
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(FLOOR_CHUNK);
    let carry = Buffer.alloc(0);
    let pos = 0;
    let eof = false;
    while (pos < FLOOR_READ_MAX) {
      const n = fs.readSync(fd, buf, 0, Math.min(FLOOR_CHUNK, FLOOR_READ_MAX - pos), pos);
      if (n <= 0) { eof = true; break; }
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let nl = data.indexOf(0x0a); nl !== -1; nl = data.indexOf(0x0a, start)) {
        const u = replyUsage(data.toString('utf8', start, nl));
        start = nl + 1;
        if (u) { setFloor(u); return; }
      }
      carry = Buffer.from(data.subarray(start));
    }
    // a last line with no newline is whole only at the end of the file
    const u = eof && carry.length ? replyUsage(carry.toString('utf8')) : null;
    if (u) setFloor(u);
  } catch { /* unreadable - no floor */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}
function coldFloor() { readFloor(); return _floor; }
// The first reply's usage object (its cached share is reported beside the verdict); null when the floor is unread.
function firstUsage() { readFloor(); return _firstUsage; }

// --- the cache-aware VERDICT: does a fresh session pay back with the prompt cache warm? ---------------------------------
// Prices in thousandths of the model's input price, held equal to meta/model-prices.json by fresh-verdict.test.js: a
// cached re-read per model, a new cache write per TTL. Continuing re-reads this session's carry every message; a fresh
// session writes its floor new (a full write - sequential sessions rarely share a prefix) and re-reads what a resume
// reads (RESUME_READ, an upper bound). Over P messages fresh is cheaper exactly when G * (w - r) < P * (ctx - G) * r,
// G = F + R - every term an integer, so the boundary is exact. The cache is judged warm on every route: by the time a
// hook speaks the request it rides has already been paid (spec 2026-10-28, 'The finding that shapes the design').
const RESUME_READ = 13000;
const CACHE_READ_RATES = Object.freeze({ 'claude-opus-5-5': 50, 'claude-sonnet-5-5': 50, 'claude-fable-5-1': 25, 'claude-mythos-5-1': 25 });
const OTHER_READ_RATE = 100;   // an unknown model over-states the read: more offers, the old direction
const WRITE_RATES = Object.freeze({ '1h': 2000, '5m': 1250 });
const PAYBACK_DEFAULT = 30;
function readRateOf(id) {
  const key = modelKey(id, Object.keys(CACHE_READ_RATES));
  return key ? CACHE_READ_RATES[key] : OTHER_READ_RATE;
}
// ALFRED_CODE_FRESH_SESSION_PAYBACK: a whole number from 0 to 1000; anything else is 30, and 0 lets no offer pay.
function paybackOf(env = process.env) {
  const raw = envOf(env, 'FRESH_SESSION_PAYBACK');
  const s = raw === undefined || raw === null ? '' : String(raw).trim();
  return /^\d+$/.test(s) && Number(s) <= 1000 ? Number(s) : PAYBACK_DEFAULT;
}
// The session's cache TTL: the newest main-session reply that WROTE cache says which (`cache_creation`'s 1h or 5m
// split), read backward from a 64KB tail widened once to 1MB. It reads on past a `compact_boundary` - the TTL is the
// session's, not the context's - and skips a line that does not parse (the tail's cut first one included). No split
// found is the API default, 5m. `version` is the newest parsed row's Claude Code version. Memoized per payload.
let _ttl;
function cacheTtl() {
  if (_ttl === undefined) _ttl = readTtl();
  return _ttl;
}
function readTtl(tail = 64 * 1024) {
  let version = null;
  try {
    const p = payload.transcript_path;
    if (p) {
      const size = fs.statSync(p).size;
      const start = Math.max(0, size - tail);
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(size - start);
      try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        let o;
        try { o = JSON.parse(lines[i]); } catch { continue; }
        if (!o || typeof o !== 'object') continue;
        if (version === null && typeof o.version === 'string') version = o.version;
        if (o.type !== 'assistant' || o.isSidechain || !o.message || o.message.model === '<synthetic>') continue;
        const split = o.message.usage && o.message.usage.cache_creation;
        if (!split) continue;
        if (split.ephemeral_1h_input_tokens > 0) return { ttl: '1h', ttlFrom: 'split', version };
        if (split.ephemeral_5m_input_tokens > 0) return { ttl: '5m', ttlFrom: 'split', version };
      }
      if (start > 0 && tail < 1024 * 1024) return readTtl(1024 * 1024);
    }
  } catch { /* unreadable - the default */ }
  return { ttl: '5m', ttlFrom: 'fallback', version };
}
// The verdict at this carry. No reading (ctx 0), an unmeasured floor and P 0 each answer no: the arithmetic cannot be
// done, and no route offers at an unknown carry. `breakEven` is the messages fresh needs to pay back, rounded up; null
// when the carry is no more than G (or unread). `readShare` is reported, never priced.
function freshVerdict(ctx) {
  const floor = coldFloor();
  const unmeasured = !(floor > 0);
  const { ttl, ttlFrom, version } = cacheTtl();
  const readRate = readRateOf(sessionModelId());
  const writeRate = WRITE_RATES[ttl];
  const payback = paybackOf();
  const u = firstUsage();
  const readShare = unmeasured || !u ? null : Math.round(1000 * (u.cache_read_input_tokens || 0) / floor) / 1000;
  const carry = Number(ctx) > 0 ? Math.floor(Number(ctx)) : 0;
  const G = unmeasured ? null : floor + RESUME_READ;
  let breakEven = null;
  let pays = false;
  if (carry > 0 && G !== null && carry > G) {
    const cost = G * (writeRate - readRate);
    const saving = (carry - G) * readRate;
    breakEven = Math.floor(cost / saving);
    if (breakEven * saving < cost) breakEven += 1;   // integer ceiling, whatever the float quotient rounded to
    pays = payback > 0 && cost < payback * saving;
  }
  return { pays, ttl, ttlFrom, version, readRate, writeRate, floor: unmeasured ? null : floor, resumeRead: RESUME_READ, readShare, payback, breakEven, unmeasured };
}
// A rate in thousandths as the texts print it: 50 -> '0.05x', 2000 -> '2x'.
const rateX = (thousandths) => `${Number((thousandths / 1000).toFixed(3))}x`;
const kTokens = (n) => `~${Math.round(n / 1000)}k`;
// What the hooks say (spec section 3): the two absolute numbers and the break-even, never a ratio of the carry.
function payText(ctx, v) {
  if (!v || !v.pays) return '';
  return `This session carries ${kTokens(ctx)} tokens per message; with the cache warm (${v.ttl} TTL) a turn re-reads it at ${rateX(v.readRate)} the input price. `
    + `A fresh session restarts at ${kTokens(v.floor)}, written new at ${rateX(v.writeRate)}, and pays back in about ${v.breakEven} messages.`;
}
function notPayText(ctx, v) {
  if (!v || v.pays || v.unmeasured || !(ctx > 0)) return '';
  if (v.payback === 0) return `This session carries ${kTokens(ctx)} tokens per message; fresh-session offers are off here (ALFRED_CODE_FRESH_SESSION_PAYBACK is 0).`;
  if (v.breakEven === null) {
    return `This session carries ${kTokens(ctx)} tokens per message, no more than a fresh session's ${kTokens(v.floor)} floor plus the ${kTokens(v.resumeRead)} it re-reads, `
      + 'so a fresh session saves nothing.';
  }
  return `This session carries ${kTokens(ctx)} tokens per message; with the cache warm (${v.ttl} TTL) a turn re-reads it at ${rateX(v.readRate)}. `
    + `A fresh session restarts at ${kTokens(v.floor)}, written new at ${rateX(v.writeRate)}, and would pay back only after about ${v.breakEven} messages, `
    + (v.breakEven > v.payback ? `past the ${v.payback}-message window.` : `no sooner than the ${v.payback}-message window ends.`);
}
// The verdict's probe row for the hook-blocks ledger (`mode: probe`, which the block rate skips): what each route decided,
// beside the retired 40% rule's answer (`share40`; an unread floor or carry answered yes), so a suppressed offer counts.
function verdictRow(route, ctx, v) {
  const floor = v.floor;
  return {
    mode: 'probe', kind: 'fresh-verdict', reason: `probe: fresh-session verdict on the ${route} route - ${v.pays ? 'pays' : 'does not pay'}`,
    detail: {
      route, ctx, floor, ttl: v.ttl, ttlFrom: v.ttlFrom, version: v.version, readRate: v.readRate, readShare: v.readShare,
      breakEven: v.breakEven, payback: v.payback, resumeRead: v.resumeRead, pays: v.pays,
      share40: !(ctx > 0) || !(floor > 0) ? true : (ctx - floor) >= ctx * 0.4,
      // nobody at the terminal: such a row was never put to a person, so the reopen counts can leave it out
      unattended: typeof prelude.unattended === 'function' ? !!prelude.unattended(payload) : false,
    },
  };
}
// That row at most once per session per route per value of `pays` (an exclusive marker in the hook log dir); null when
// it was written already or the marker cannot be.
function verdictProbe(route, ctx, v) {
  try {
    const dir = envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir();
    const key = String(payload.session_id || payload.transcript_path || 'nosession').replace(/[^\w-]/g, '_').slice(-80);
    fs.writeFileSync(require('path').join(dir, `guard-fresh-verdict-${key}-${String(route).replace(/[^\w-]/g, '_')}-${v.pays}`), new Date().toISOString(), { flag: 'wx' });
    if (typeof prelude.sweepStale === 'function') prelude.sweepStale(dir, 'guard-fresh-verdict-');
  } catch { return null; }
  return verdictRow(route, ctx, v);
}
// True when a fresh session is worth offering: the verdict pays. An unread floor or carry answers no.
function worthResuming(ctx) {
  return freshVerdict(ctx).pays;
}

// The context the LAST assistant message carried, read BACKWARDS from a small tail - for a hook that
// fires on every tool call, where the Stop hooks' 512KB forward scan would be paid hundreds of times
// a session. A tail holding no usage row widens once; anything unreadable is 0 (nothing to report).
function contextNow(tail = 64 * 1024) {
  try {
    const p = payload.transcript_path;
    if (!p) return 0;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - tail);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      // A compaction boundary ends the read: a usage row above it is the PRE-compaction context, and reading it 12s after
      // the compaction reported 315,542 where the real context was 98,553 (audit 2026-10-10 C08) - unknown until the
      // first assistant row after the boundary lands.
      if (lines[i].includes('"compact_boundary"')) {
        try { if (JSON.parse(lines[i]).subtype === 'compact_boundary') return 0; } catch { /* a cut row - read on */ }
      }
      if (!lines[i].includes('"usage"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        const u = o.type === 'assistant' && o.message && o.message.model !== '<synthetic>' && o.message.usage;
        if (u) return (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
      } catch { /* partial first line of the tail - skip */ }
    }
    return start > 0 && tail < 1024 * 1024 ? contextNow(1024 * 1024) : 0;
  } catch { return 0; }
}
// ---- the asks this session answered (moved from guard-stop-contract.js, audit 2026-10-08) ------------------------------
// The transcript's bytes from `from` on, the newest `max` at most; '' when there is none.
function transcriptText(from = 0, max = 512 * 1024) {
  try {
    const p = payload.transcript_path;
    if (!p) return '';
    const size = fs.statSync(p).size;
    const start = Math.max(from, size - max, 0);
    if (start >= size) return '';
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
function transcriptSize() { try { return fs.statSync(String(payload.transcript_path || '')).size; } catch { return 0; } }
// A user row is a TYPED turn only when it carries text and no tool_result - a tool result arrives as a user message.
function isTypedTurn(o) {
  const c = o.message.content;
  if (typeof c === 'string') return !o.isMeta && c.trim().length > 0;
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b && b.type === 'tool_result')) return false;
  return !o.isMeta && c.some((b) => b && b.type === 'text' && String(b.text || '').trim());
}
// Did an AskUserQuestion THIS turn (since the last typed prompt) put the fresh-session choice, and get answered?
// Measured (8b5dcb1a): a capture skill's own gate asked 'Fresh session (Recommended) / Continue here', the user
// answered, and the fresh-session block on the close forced an identical second ask; task-solve's stop asks carry
// 'Resume in a fresh session', and after 'Implement' the phase Skill call was denied with the same question. The
// choice is made either way - 'Continue here' included. A Stop hook's own feedback row is no typed prompt. Fail-open.
const FRESH_ASK_RE = /(?:fresh session|new session|fresh chat)/i;
// Both answer wordings: a picked option, and a free-text one ('The user answered:' - 7 of 12 answers in audit
// 2026-10-10 session 4f1c2ebb, whose 4-second acknowledgement the Stop branch then blocked).
const ANSWERED_RE = /^\s*(?:Your questions have been answered:|The user answered:)/;
const blockText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('') : '');
// A tool_result block of a user row that ANSWERS an ask: one of the two answer wordings, and no idle timeout - in the
// text or the row's own `toolUseResult.afkTimeoutMs` (ruling S3: a dialog closed with some picks made still says so).
const answeredBlock = (o, b, re = ANSWERED_RE) => !!b && b.type === 'tool_result' && re.test(blockText(b))
  && !askTimedOut(blockText(b)) && !askTimedOut(o && o.toolUseResult);
function freshAskAnsweredThisTurn() {
  try {
    const lines = transcriptText().split('\n');
    const answered = new Set();
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!o || !o.message) continue;
      const c = o.message.content;
      if (o.type === 'user') {
        if (Array.isArray(c)) {
          for (const b of c) {
            if (answeredBlock(o, b)) answered.add(b.tool_use_id);
          }
        }
        if (isTypedTurn(o) && !(typeof c === 'string' && /^Stop hook feedback:/.test(c))) return false;
        continue;
      }
      if (o.type !== 'assistant' || !Array.isArray(c)) continue;
      for (const b of c) {
        if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion' && answered.has(b.id) && FRESH_ASK_RE.test(JSON.stringify(b.input || {}))) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
// The context, in tokens, at the NEWEST answered AskUserQuestion that put the fresh-session choice - in any turn of the
// newest 8MB - read from the usage of the model call that made the ask; 0 when there is none. The Stop offer counts it
// as its own last offer, so a choice answered one typed turn back is not asked again until the carry grows past the
// re-offer step (audit 2026-10-11 SD11, session 7f8803eb: 'Continue in fresh session' answered, the next turn's close
// carrying the asked-for resume prompt was blocked and the re-ask denied by the user, 878.8k cache-read).
function freshAskAnsweredCtx() {
  try {
    const lines = transcriptText(0, 8 * 1024 * 1024).split('\n');
    const answered = new Set();
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!o || !o.message || !Array.isArray(o.message.content)) continue;
      const c = o.message.content;
      if (o.type === 'user') {
        for (const b of c) {
          if (answeredBlock(o, b)) answered.add(b.tool_use_id);
        }
        continue;
      }
      if (o.type !== 'assistant') continue;
      if (!c.some((b) => b && b.type === 'tool_use' && b.name === 'AskUserQuestion' && answered.has(b.id) && FRESH_ASK_RE.test(JSON.stringify(b.input || {})))) continue;
      const u = o.message.usage || {};
      return (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    }
    return 0;
  } catch {
    return 0;
  }
}
// Was any ask answered (or declined) in the transcript past byte `from` - the size an offer recorded? Only an ask's own
// tool_result counts - the answer wordings opening it - never the same words inside a file a Read or a shell call printed,
// and never an ask the idle timeout closed (audit 2026-10-20, the hooks track's minor list; ruling S3).
const ANSWERED_OR_DECLINED_RE = /^\s*(?:Your questions have been answered:|The user answered:|The user (?:declined|chose not) to answer)/i;
function askAnsweredSince(from) {
  for (const line of transcriptText(from, 8 * 1024 * 1024).split('\n')) {
    if (!line.includes('tool_result')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.type !== 'user' || !o.message || !Array.isArray(o.message.content)) continue;
    if (o.message.content.some((b) => answeredBlock(o, b, ANSWERED_OR_DECLINED_RE))) return true;
  }
  return false;
}

module.exports = {
  use, freshAt, FRESH_AT_200K, FRESH_AT_300K, FRESH_AT_1M, DEFAULT_AT, DEFAULT_SEED, tierKeyOf, FRESH_OFF, COMPACT_INSTEAD, sessionModelId,
  tableWindow, recordSessionModel, knownWindow, ctxThreshold, coldFloor, firstUsage, worthResuming, contextNow,
  RESUME_READ, CACHE_READ_RATES, WRITE_RATES, modelKey, readRateOf, paybackOf, cacheTtl, freshVerdict, rateX, payText, notPayText,
  verdictRow, verdictProbe,
  autoCompactWindow, configuredCompactWindow, compactWindowIgnored, sessionStartedAt, recordCompactPoint, observedCompaction, compactPointsFile,
  truePoints, compactionFacts, idleCompaction, settleCompactPoints, readWindow,
  transcriptSize, isTypedTurn, freshAskAnsweredThisTurn, freshAskAnsweredCtx, askAnsweredSince,
};
