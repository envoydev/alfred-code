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
const { envOf } = require('./hook-prelude.js');

// The hook's parsed payload - the transcript path and cwd the reads below need. A hook calls
// use(payload) once, before its first call into this file.
let payload = {};
function use(p) {
  payload = p && typeof p === 'object' ? p : {};
  _knownWindow = undefined;
}

// The trigger is an ABSOLUTE token count per WINDOW TIER, one environment variable each - the
// percentage knob it replaces was inert at its default on both real tiers (200k x 40% fell under
// the floor, 1M x 40% sat over the ceiling), so the clamps decided and the setting lied about what
// it controlled. Three numbers, no arithmetic: say when you want to be asked.
//   ALFRED_CODE_FRESH_SESSION_200K    - the trigger on a 200k window (default 150,000, measured)
//   ALFRED_CODE_FRESH_SESSION_1M      - the trigger on a 1M window (default 400,000)
//   ALFRED_CODE_FRESH_SESSION_DEFAULT - the trigger on anything else (default 300,000)
// `0` on any of them turns that case's offer off. NOTE the 1M default sits ABOVE the harness's own
// auto-compaction (measured preTokens 387,619 / 391,290 / 393,516 / 393,969 / 395,112 / 396,651 /
// 396,954 / 397,171 across three projects), so on that tier the Stop offer is usually unreachable
// by design and the SessionStart `compact` route is what reaches the user - lower the variable to
// be asked before the harness decides. Which WINDOW this session runs in is resolved below.
// Read through envOf - the key is passed with the ALFRED_CODE_ prefix and read by its suffix.
function freshAt(key, dflt) {
  const n = parseInt(envOf(process.env, String(key).replace(/^ALFRED_CODE_/, '')), 10);
  return Number.isNaN(n) || n < 0 ? dflt : n;   // garbage takes the default; 0 is a real answer (off)
}
const FRESH_AT_200K = freshAt('ALFRED_CODE_FRESH_SESSION_200K', 150000);
const FRESH_AT_1M = freshAt('ALFRED_CODE_FRESH_SESSION_1M', 400000);
// The DEFAULT covers every case that is not one of the two named windows: a window that cannot be
// read at all, and one that is neither 200k nor 1M (a `[500k]` model id, say). Seeded at 300,000 to
// match ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: on that window ctxThreshold clamps it to 90% (270,000).
// It is NOT reachable on a window below it - a 200k window that cannot be read, say - so a session
// there can run past its window without an offer; lower the variable for such models (it sat at
// 180,000 until 2.1.6 for exactly that reason).
const FRESH_AT_DEFAULT = freshAt('ALFRED_CODE_FRESH_SESSION_DEFAULT', 300000);
// `0` on ALL THREE is the whole off switch. The retired ALFRED_CODE_FRESH_SESSION_PCT is not read
// at all any more - a percentage of a window is not what this gate fires on.
const FRESH_OFF = FRESH_AT_200K === 0 && FRESH_AT_1M === 0 && FRESH_AT_DEFAULT === 0;

// --- which context WINDOW is this session running in? -------------------------------------
// ONE rule: the session's model id is looked up in `model-windows.json`, shipped beside this hook
// and replaced on every update, so a new model arrives with the release that lists it. A model the
// table does not list takes ALFRED_CODE_DEFAULT_CONTEXT_WINDOW (seeded 300000); with that unset or
// garbage, no window is known and the DEFAULT trigger applies. Two MEASURED facts can only lower it (audit
// 2026-10-10 C08): the install's own auto-compact window when a setting names it, and the lowest compaction point
// this project recorded for the model (autoCompactWindow / observedCompaction below). Nothing else decides - not a
// `[1m]`/`[200k]` id suffix, not the carry. Those inferences each fixed one case
// and broke another (Sonnet 5 runs 1M on a bare id, so the suffix read offered a resume at ~252k),
// and a window that moves with the session's own history cannot be predicted by the person who set
// it. The table holds the API maximum from the Claude models docs; a session that runs smaller than
// its row is the table's error, corrected in the table.
// The id is the main transcript's last `message.model` - subagents write their own files, so a
// Haiku helper cannot answer for the session - else the settings `model` when it is a full id.
// Measured: the PreToolUse payload carries no model and no window, and no env var names either.
// Right after a compaction the harness re-attaches 0.4-0.6MB (invoked skill bodies, the instructions, the agent
// listing) before the next assistant row, so a 512KB tail held no model and the window fell to the DEFAULT tier
// (audit 2026-10-10 C08: 180,000 for a 1M session in 6 ledgers). The read widens once to 8MB, and the harness's
// own `model` attachment row (`identity.modelId`, re-written after every compaction) answers as well.
function sessionModelId() {
  try {
    const p = payload.transcript_path;
    if (p) {
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
            if (m && m !== '<synthetic>') return String(m);
          } catch { /* partial first line of the tail - skip */ }
        }
        if (start === 0) break;
      }
    }
  } catch { /* unreadable transcript - try settings */ }
  try {
    const path = require('path');
    const os = require('os');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude');
    for (const f of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(account, 'settings.json')]) {
      try {
        const m = JSON.parse(fs.readFileSync(f, 'utf8')).model;
        if (m) return String(m);
      } catch { /* absent or not JSON - next file */ }
    }
  } catch { /* no home and no cwd */ }
  return null;
}
// A key matches the id itself, a dated snapshot (`claude-haiku-4-5-20251001`, Vertex's `@20251101`), a
// Bedrock version (`-v1:0`), Claude Code's `[1m]` suffix and a provider-prefixed id
// (`us.anthropic.claude-opus-5-v1:0`); the longest matching key wins. Nothing else may follow the key: a
// bare `-` let `claude-opus-5-5` read as a snapshot of `claude-opus-5` and take its window silently (2.1.5 M6).
function tableWindow() {
  const id = String(sessionModelId() || '').toLowerCase();
  if (!id) return null;
  let models = {};
  try { models = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'model-windows.json'), 'utf8')).models || {}; } catch { return null; }
  let best = null;
  for (const [key, n] of Object.entries(models)) {
    const k = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!(Number(n) >= 100000) || !new RegExp(`(^|[./])${k}(?=$|-\\d{8}(?!\\d)|-v\\d|@|:|\\[)`).test(id)) continue;
    if (!best || key.length > best.key.length) best = { key, n: Number(n) };
  }
  return best ? best.n : null;
}
function envWindow() {
  const n = parseInt(envOf(process.env, 'DEFAULT_CONTEXT_WINDOW'), 10);
  return n >= 100000 ? n : null;
}
// The install's own AUTO-COMPACT window, when it is set (code.claude.com/docs/en/model-config, 'Set the auto-compact
// window': 'how full the context window can get before Claude Code compacts'; settings-reference `autoCompactWindow` /
// `modelSettings`). Read in the documented order: the environment variable (both spellings the docs use), then each
// settings file from the highest scope down - a `modelSettings` entry for this session's model before that file's
// top-level key. A top-level key in the USER file is skipped: the docs scope it to Opus 5, Fable 5.1 and earlier
// models, and a newer model keeps its own tuned window, which no file names - the compaction record below measures it.
// 'auto', garbage or a value outside 100K-1M is no window. This only ever LOWERS the window: the harness caps the
// auto-compact window at the model's own.
function autoCompactWindow() {
  const valid = (v) => { const n = typeof v === 'number' ? v : /^\d+$/.test(String(v || '').trim()) ? parseInt(v, 10) : NaN; return n >= 100000 && n <= 1000000 ? n : null; };
  for (const k of ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_AUTOCOMPACT_WINDOW']) {
    const n = valid(process.env[k]);
    if (n) return n;
  }
  try {
    const path = require('path');
    const os = require('os');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude');
    const id = String(sessionModelId() || '').toLowerCase();
    const files = [[path.join(root, '.claude', 'settings.local.json'), true], [path.join(root, '.claude', 'settings.json'), true], [path.join(account, 'settings.json'), false]];
    for (const [file, topLevelApplies] of files) {
      let s;
      try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!s || typeof s !== 'object') continue;
      const per = s.modelSettings && typeof s.modelSettings === 'object' && id
        ? Object.entries(s.modelSettings).find(([k]) => k.toLowerCase() === id || id.endsWith(`/${k.toLowerCase()}`) || id.endsWith(`.${k.toLowerCase()}`)) : null;
      const n = valid(per && per[1] && per[1].autoCompactWindow) || (topLevelApplies ? valid(s.autoCompactWindow) : null);
      if (n) return n;
    }
  } catch { /* no root, no home */ }
  return null;
}
// The compaction points this PROJECT has measured: each automatic compaction leaves its context in
// `<docs>/flow/compact-points.json` (guard-fresh-session-start.js writes it at PreCompact and at the compact start), and
// the lowest one for this session's model in the last 30 days is a fact about where the harness compacts here - which
// the model's row cannot know (audit 2026-10-10 C08: 29 compactions of one project at 300-400k against a 400k trigger,
// so neither the Stop offer nor the monitor's note could fire before the harness compacted).
const COMPACT_POINTS_DAYS = 30;
function compactPointsFile() {
  const path = require('path');
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  return path.resolve(root, envOf(process.env, 'DOCS_PATH') || '.alfred/docs', 'flow', 'compact-points.json');
}
function readCompactPoints() {
  try {
    const rows = JSON.parse(fs.readFileSync(compactPointsFile(), 'utf8'));
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && Number(r.tokens) >= 50000 && typeof r.model === 'string') : [];
  } catch { return []; }
}
function recordCompactPoint(tokens, model) {
  try {
    const n = Math.round(Number(tokens));
    if (!(n >= 50000) || !model) return false;
    const cut = Date.now() - COMPACT_POINTS_DAYS * 86400000;
    const rows = readCompactPoints().filter((r) => Date.parse(r.at) >= cut);
    rows.push({ at: new Date().toISOString(), session: String(payload.session_id || ''), model: String(model).toLowerCase(), tokens: n });
    const file = compactPointsFile();
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows.slice(-40), null, 1) + '\n');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}
function observedCompaction() {
  const id = String(sessionModelId() || '').toLowerCase();
  if (!id) return null;
  const cut = Date.now() - COMPACT_POINTS_DAYS * 86400000;
  const seen = readCompactPoints().filter((r) => r.model === id && Date.parse(r.at) >= cut).map((r) => Number(r.tokens));
  return seen.length ? Math.min(...seen) : null;
}
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) {
    const table = tableWindow() || envWindow();
    const acw = autoCompactWindow();
    _knownWindow = acw && (!table || acw < table) ? acw : table;
  }
  return _knownWindow;
}
// The trigger this session is judged against. The two named tiers each own a variable; every
// other answer - including 'the window could not be read' - takes the DEFAULT one, so the offer
// always has a number behind it. Guessing a TIER instead was the failure: reading an unknown
// window as 200k offered a 1M account the resume at 150k, and reading it as 1M never offered a
// 200k account anything at all.
function ctxThreshold() {
  const window = knownWindow();
  let at = window === 200000 ? FRESH_AT_200K
    : window === 1000000 ? FRESH_AT_1M
      : FRESH_AT_DEFAULT;
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
// --- what a resume would actually RECOVER: the session's own cold floor ----------------------
// The trigger is absolute context, and a large share of it can be the INSTALL's own standing
// inventory - system prompt, CLAUDE.md, the always-on rules, every MCP tool schema - which a fresh
// session pays again on its first message. Measured across the nine projects in the audited
// collection that floor runs 87k-134k per message, and one 18-minute single-command run that
// STARTED from `/clear` (first message 103,964) tripped the 150,000 gate at 159,363 after ~55k of
// actual conversation: the ask and its close cost two messages and 320,973 context and moved
// nothing. So the offer also asks what it would BUY - the part of the carry a resume does NOT
// re-pay - and stays quiet while that is under 40% of what a message now costs. This is not a
// percentage of the WINDOW (the retired PCT knob, where the clamps decided and the number lied);
// it is read from this session's own first message, and an unreadable floor answers yes, which is
// the behaviour that shipped before it. On an install whose floor is most of its window the offer
// therefore goes quiet by design - a resume that recovers 16k per message is not worth a turn, and
// the harness's own compaction covers that session.
const MIN_RECOVERABLE_SHARE = 0.4;
function coldFloor() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(Math.min(fs.statSync(p).size, 512 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);   // the HEAD of the file - message 1, not the tail
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue;
      try {
        const u = JSON.parse(line).message.usage;
        if (u) return (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
      } catch { /* a partial or shapeless row - keep looking */ }
    }
    return null;
  } catch { return null; }
}
// True when a resume is worth a turn: the carry MINUS this session's own floor is a real share of
// what every message now costs. Anything unreadable - no floor, no context figure - answers yes.
function worthResuming(ctx) {
  const floor = coldFloor();
  if (!ctx || floor === null || floor <= 0) return true;
  return (ctx - floor) >= ctx * MIN_RECOVERABLE_SHARE;
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
// The LOWEST trigger any window could resolve to, without reading the model: every live tier's own
// number, or 90% of the smallest window the table accepts when the clamp would bring it down. A
// context under a share of this cannot be past that share of the real trigger, so the per-call
// caller skips the model lookup (a second 512KB scan) until it can matter. null = every tier off.
function lowestTrigger() {
  const live = [FRESH_AT_200K, FRESH_AT_1M, FRESH_AT_DEFAULT].filter((n) => n > 0);
  return live.length ? Math.min(...live, 90000) : null;
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
            if (b && b.type === 'tool_result' && ANSWERED_RE.test(typeof b.content === 'string' ? b.content
              : Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('') : '')) answered.add(b.tool_use_id);
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
          if (b && b.type === 'tool_result' && ANSWERED_RE.test(typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('') : '')) answered.add(b.tool_use_id);
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
// Was any ask answered (or declined) in the transcript past byte `from` - the size an offer recorded?
function askAnsweredSince(from) {
  return /Your questions have been answered:|The user answered:|The user (?:declined|chose not) to answer/i.test(transcriptText(from, 8 * 1024 * 1024));
}

module.exports = {
  use, freshAt, FRESH_AT_200K, FRESH_AT_1M, FRESH_AT_DEFAULT, FRESH_OFF, sessionModelId, tableWindow,
  envWindow, knownWindow, ctxThreshold, MIN_RECOVERABLE_SHARE, coldFloor, worthResuming, contextNow, lowestTrigger,
  autoCompactWindow, recordCompactPoint, observedCompaction, compactPointsFile,
  transcriptSize, isTypedTurn, freshAskAnsweredThisTurn, freshAskAnsweredCtx, askAnsweredSince,
};
