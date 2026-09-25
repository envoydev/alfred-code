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
//   ALFRED_CODE_FRESH_SESSION_DEFAULT - the trigger on anything else (default 180,000)
// `0` on any of them turns that case's offer off. NOTE the 1M default sits ABOVE the harness's own
// auto-compaction (measured preTokens 387,619 / 391,290 / 393,516 / 393,969 / 395,112 / 396,651 /
// 396,954 / 397,171 across three projects), so on that tier the Stop offer is usually unreachable
// by design and the SessionStart `compact` route is what reaches the user - lower the variable to
// be asked before the harness decides. Which WINDOW this session runs in is resolved below.
function freshAt(key, dflt) {
  const n = parseInt(process.env[key], 10);
  return Number.isNaN(n) || n < 0 ? dflt : n;   // garbage takes the default; 0 is a real answer (off)
}
const FRESH_AT_200K = freshAt('ALFRED_CODE_FRESH_SESSION_200K', 150000);
const FRESH_AT_1M = freshAt('ALFRED_CODE_FRESH_SESSION_1M', 400000);
// The DEFAULT covers every case that is not one of the two named windows: a window that cannot be
// read at all, and one that is neither 200k nor 1M (a `[500k]` model id, say). It must be REACHABLE
// on the smallest window it could be applied to, which is why it sits under 200,000. At 250,000 it
// sat ABOVE a 200k window entirely, so a session on that tier could never trip it and the gate
// silently did not exist - measured on a session that peaked at 187.2k (93.6% of its window) with
// both Stop hooks running and neither holding. An unproven window is assumed SMALL on purpose: an
// offer made a little early is one dismissible ask, re-armed only after 1.5x growth, while an offer
// that can never fire is no gate at all.
const FRESH_AT_DEFAULT = freshAt('ALFRED_CODE_FRESH_SESSION_DEFAULT', 180000);
// `0` on ALL THREE is the whole off switch. The retired CLAUDE_STACK_FRESH_SESSION_PCT is not read // legacy-name
// at all any more - a percentage of a window is not what this gate fires on.
const FRESH_OFF = FRESH_AT_200K === 0 && FRESH_AT_1M === 0 && FRESH_AT_DEFAULT === 0;

// --- which context WINDOW is this session running in? -------------------------------------
// ONE rule: the session's model id is looked up in `model-windows.json`, shipped beside this hook
// and replaced on every update, so a new model arrives with the release that lists it. A model the
// table does not list takes ALFRED_CODE_DEFAULT_CONTEXT_WINDOW (seeded 1000000); with that unset or
// garbage, no window is known and the DEFAULT trigger applies. Nothing else decides - not a
// `[1m]`/`[200k]` id suffix, not the carry, not a compaction. Those inferences each fixed one case
// and broke another (Sonnet 5 runs 1M on a bare id, so the suffix read offered a resume at ~252k),
// and a window that moves with the session's own history cannot be predicted by the person who set
// it. The table holds the API maximum from the Claude models docs; a session that runs smaller than
// its row is the table's error, corrected in the table.
// The id is the main transcript's last `message.model` - subagents write their own files, so a
// Haiku helper cannot answer for the session - else the settings `model` when it is a full id.
// Measured: the PreToolUse payload carries no model and no window, and no env var names either.
function sessionModelId() {
  try {
    const p = payload.transcript_path;
    if (p) {
      const size = fs.statSync(p).size;
      const start = Math.max(0, size - 512 * 1024);
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"model"')) continue;
        try {
          const o = JSON.parse(lines[i]);
          const m = o.type === 'assistant' && o.message && o.message.model;
          if (m && m !== '<synthetic>') return String(m);
        } catch { /* partial first line of the tail - skip */ }
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
// A key matches the id itself, a dated snapshot (`claude-haiku-4-5-20251001`) and a provider-prefixed
// id (`us.anthropic.claude-opus-5-v1:0`); the longest matching key wins.
function tableWindow() {
  const id = String(sessionModelId() || '').toLowerCase();
  if (!id) return null;
  let models = {};
  try { models = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'model-windows.json'), 'utf8')).models || {}; } catch { return null; }
  let best = null;
  for (const [key, n] of Object.entries(models)) {
    const k = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!(Number(n) >= 100000) || !new RegExp(`(^|[./])${k}($|[-@:[])`).test(id)) continue;
    if (!best || key.length > best.key.length) best = { key, n: Number(n) };
  }
  return best ? best.n : null;
}
function envWindow() {
  const n = parseInt(envOf(process.env, 'DEFAULT_CONTEXT_WINDOW'), 10);
  return n >= 100000 ? n : null;
}
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) _knownWindow = tableWindow() || envWindow();
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

module.exports = {
  use, freshAt, FRESH_AT_200K, FRESH_AT_1M, FRESH_AT_DEFAULT, FRESH_OFF, sessionModelId, tableWindow,
  envWindow, knownWindow, ctxThreshold, MIN_RECOVERABLE_SHARE, coldFloor, worthResuming, contextNow, lowestTrigger,
};
