#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Three routes into ONE decision: a DELIBERATE orchestration run - a capture, a loop, a solve
// flow - must start in a session that is not already carrying a finished run's history.
//   PreToolUse (Skill)      - the run arrives as a Skill call. Blocks (exit 2).
//   UserPromptExpansion     - the run arrives as a SLASH COMMAND, which emits NO Skill event at
//                             all: measured 4 of 4 runs slash-injected, ZERO Skill tool_use events
//                             in 45 messages, two captures entered at 150k and 164k, both ungated.
//                             The event fires exactly on a typed command and names it
//                             (`command_name`), and its matcher lists the orchestration commands, so
//                             no ordinary prompt spawns this hook (2.1.5 M14 - it was UserPromptSubmit,
//                             which fired on every prompt and parsed a `<command-name>` marker, missing
//                             one typed with a leading space). This route INJECTS the ask; it never
//                             blocks, because a blocked expansion shows its reason to the user only -
//                             the run would be lost and the model would never learn why. Every typed
//                             task-* / capture-* / loop-* / issue-* command also gets the MODE BANNER
//                             (auto-mode ON or OFF, and how the session meets a full context).
//   SessionStart (compact)  - the harness has just auto-compacted, which is PROOF the session
//                             reached the ceiling the gate exists for (the harness's own compaction
//                             point, which moves with the window), at a moment a Stop may never come (measured: 23m27s /
//                             277 messages / +178k ctx, zero Stop events; and a conforming
//                             solve-task run emits zero Stops BY DESIGN). Injects, cannot block. The rule existed as
// prose in the generated capabilities rule and lost every time it was tested: measured across 4
// sessions, one of which NAMED the fresh-session need in its own text ('a fresh session is the
// right home for a loop like this') and then ran the loop anyway, to 380k tokens per message.
// Same step run fresh in the next session cost 134k. This is that rule mechanized.
//   UserPromptSubmit        - the mode prompt (modePrompt: an old flag's pointer, `--mode-auto-run-off` ending auto-run
//                             for the session, the takeover notice; any other typed prompt is input to the run - the
//                             user's ruling of 2026-10-15), else the idle-gap offer (audit 2026-10-10 C09): the prompt ending a
//                             gap past the clock route's hours injects the offer once per gap. It runs beside the
//                             two other prompt hooks, in parallel, and reads one 1MB tail; it never judges a command.
// A review of the code starting on the Skill, Agent or expansion route also takes the REVIEW SNAPSHOT the commit guard
// reads (below), whatever the fresh-session decision is.
//
// The incoming skill must be one of the orchestration entry points below - everything else passes -
// and then EITHER trigger is enough: the session's context is already past the threshold, or - on
// the slash route only - this session has already made one typed run (see priorOrchestrationRun
// below, which is what reaches the chained case the size trigger structurally cannot).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
const nodePath = require('path');
// 2.8.0: the hooks' state lives under <data root>/state/ (layout.js) - the auto-mode stamp in approvals/, the PreCompact
// snapshot in sessions/; the pre-2.8.0 <docs-path>/flow/ is still read for the 2.x line, and is the only home when
// layout.js is not beside this file.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let unattended = () => false;
// hook-prelude.js harnessPrompt - a prompt the harness wrote (a task notice, a command's output, a seat's hand-back).
let harnessPrompt = (prompt) => /^\s*<(?:task-notification|local-command-stdout|local-command-caveat)>/.test(String(prompt || ''));
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    unattended = prelude.unattended || unattended;
    harnessPrompt = prelude.harnessPrompt || harnessPrompt;
    if (prelude.standDown('guard-fresh-session-start')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge
// GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
let cursorOff = false;
try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
if (cursorOff) process.exit(0);

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
  process.exit = (code) => {
    if (code === 2) {
      try {
        const fs = require('fs');
        const path = require('path');
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
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();
// One MEASUREMENT row in the hook-blocks ledger: it carries a `mode`, which the analyzer reads as a probe, never a
// block. Best-effort - a lost row is a lost measurement, never a changed turn.
function ledgerRow(row) {
  try {
    const dir = (() => { try { return require('./layout.js').statsPath(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), ['hook-blocks']); } catch { return nodePath.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), docsRootEnv(), 'hook-blocks'); } })();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(nodePath.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: nodePath.basename(__filename), event: payload.hook_event_name || '', tool: payload.tool_name || '', ...row,
    }) + '\n');
  } catch { /* never throws */ }
}
const UNATTENDED_SKIP = 'skip: nobody is at the terminal - logged, not offered';

const EVENT = payload.hook_event_name || '';
const IS_SKILL_CALL = payload.tool_name === 'Skill';
// THE POST-COMPACTION HOLD (audit 2026-10-10 C09). The compact start below only INJECTS - SessionStart cannot block -
// and the injection lost to the harness's own summary line, 'Continue the conversation from where it left off without
// asking the user any further questions', every time it was measured: six sessions went straight on (7fae0c39 ignored
// it three times in one 80-minute turn, ~11.8M cache-read; adaa2ef3 built on for 101 messages). So the compact start
// leaves a one-shot marker, and the first call that CHANGES something after it - an edit, a shell command, a dispatch,
// a phase Skill call - is denied once with the measured numbers, until an AskUserQuestion is answered or the turn says
// the rest is a single short step. Reads (Read, Grep, Glob) pass: the plan header is read first.
const HOLD_TOOL_RE = /^(?:Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Monitor|Agent|Task|Skill)$/;
const IS_HOLD_CALL = HOLD_TOOL_RE.test(String(payload.tool_name || '')) && (EVENT === 'PreToolUse' || !EVENT);
// THE REVIEW SNAPSHOT (2026-10-22, the user's ruling 'Snapshot at review'): a review of the code starting - the model's
// review skill, a verifier or reviewer seat, the typed command - records what each changed file holds, so the commit
// guard can tell a file rewritten since with its code unchanged from one edited since (hook-prelude.js snapshotReview).
// Before the early exits below: a seat's dispatch leaves at the first of them.
{
  const input = payload.tool_input || {};
  // [tool, name, the arguments a review reads its target from]
  const typedArgs = () => (typeof payload.command_args === 'string' ? payload.command_args
    : (String(payload.prompt || '').match(/^\s*\/[A-Za-z0-9:_-]+\s*([\s\S]*)$/) || [])[1] || '');
  const call = IS_SKILL_CALL && (EVENT === 'PreToolUse' || !EVENT) ? ['Skill', input.skill || input.name, input.args]
    : /^(?:Agent|Task)$/.test(String(payload.tool_name || '')) && (EVENT === 'PreToolUse' || !EVENT) ? ['Agent', input.subagent_type, input.prompt]
      : EVENT === 'UserPromptExpansion' ? ['Skill', payload.command_name, typedArgs()] : null;
  try {
    const pre = require('./hook-prelude.js');
    const project = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    if (call && pre.codeReviewCall(call[0], call[1])) {
      const base = payload.cwd || project;
      const targets = call[0] === 'Agent' ? pre.briefTargets(call[2], base) : pre.reviewTargets(call[1], call[2], base);
      pre.snapshotReview(project, payload.session_id, { toolUseId: payload.tool_use_id, targets });
    }
  } catch { /* never blocks the call */ }
}
function compactHoldFile() {
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-compact-${key}.hold`);
}
// THE ASK-GAP ARM (audit 2026-10-20 C49, 8a1fb350): an ask answered after a long idle never reached the idle-gap offer -
// that route reads the gap since the last reply at a TYPED prompt, and here the gap sat inside the ask (posted 01:09,
// answered 05:57); the first call after it re-cached ~170k and 52 messages ran at 198-244k. So a changing call whose
// newest answered AskUserQuestion waited `ALFRED_CODE_FRESH_SESSION_AFTER_HOURS` or more leaves the idle route's hold,
// once per ask (a marker naming its tool_use id). The common case pays one 256KB tail read and a substring test.
function askGapArm() {
  try {
    const n = parseFloat(envOf(process.env, 'FRESH_SESSION_AFTER_HOURS'));
    const hours = Number.isNaN(n) || n < 0 ? 2 : n;
    const p = payload.transcript_path;
    if (!(hours > 0) || !p || payload.agent_id) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const text = buf.toString('utf8');
    if (!text.includes('"AskUserQuestion"')) return null;
    let ask = null;
    let answeredAt = NaN;
    for (const line of text.split('\n')) {
      if (line.includes('"AskUserQuestion"') && line.includes('"assistant"')) {
        try {
          const o = JSON.parse(line);
          const use = o.type === 'assistant' && Array.isArray(o.message && o.message.content)
            && o.message.content.find((b) => b && b.type === 'tool_use' && b.name === 'AskUserQuestion');
          if (use) { ask = { id: String(use.id || ''), at: Date.parse(o.timestamp || '') }; answeredAt = NaN; }
        } catch { /* the window's cut first line */ }
      } else if (ask && ask.id && line.includes('"tool_result"') && line.includes(ask.id)) {
        try {
          const o = JSON.parse(line);
          if (o.type === 'user' && Array.isArray(o.message && o.message.content)
            && o.message.content.some((b) => b && b.type === 'tool_result' && b.tool_use_id === ask.id)) answeredAt = Date.parse(o.timestamp || '');
        } catch { /* a cut row */ }
      }
    }
    if (!ask || !ask.id || !Number.isFinite(ask.at) || !Number.isFinite(answeredAt)) return null;
    const gapH = (answeredAt - ask.at) / 3600000;
    if (gapH < hours) return null;
    const key = String(p || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
    const marker = nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-askgap-${key}.armed`);
    try { if (fs.readFileSync(marker, 'utf8').trim() === ask.id) return null; } catch { /* not armed for this ask */ }
    return { id: ask.id, gapH: Math.round(gapH * 10) / 10, marker };
  } catch { return null; }
}
const ASK_GAP = IS_HOLD_CALL && !IS_SKILL_CALL ? askGapArm() : null;
// The common case - no hold pending - leaves before anything else is read.
if (IS_HOLD_CALL && !IS_SKILL_CALL && !ASK_GAP && !fs.existsSync(compactHoldFile())) process.exit(0);
if (!IS_SKILL_CALL && !IS_HOLD_CALL && !['UserPromptExpansion', 'UserPromptSubmit', 'SessionStart', 'PreCompact', 'PostModelSwitch'].includes(EVENT)) process.exit(0);

// The fresh-session arithmetic lives in fresh-session.js beside this hook, shared with
// guard-stop-contract.js. An update from an older install can run this hook before that file
// lands: the stand-in keeps every fresh-session offer OFF and the rest of this hook running.
let fresh;
try { fresh = require(require('path').join(__dirname, 'fresh-session.js')); } catch {
  fresh = {
    use() {}, freshAt: (k, d) => d, FRESH_AT_200K: 0, FRESH_AT_300K: 0, FRESH_AT_1M: 0, FRESH_OFF: true, COMPACT_INSTEAD: false,
    sessionModelId: () => null, tableWindow: () => null, recordSessionModel: () => false, knownWindow: () => null,
    ctxThreshold: () => null, MIN_RECOVERABLE_SHARE: 0.4, coldFloor: () => null, worthResuming: () => false,
    transcriptSize: () => 0, freshAskAnsweredThisTurn: () => false, askAnsweredSince: () => true,
  };
}
fresh.use(payload);
// THE SESSION'S MODEL (the user's ruling, 2026-10-21): every SessionStart saves the `model` it carries and a /model switch
// the `to_model`, so the window is the model's own capacity from the first prompt on (fresh-session.js readModelId). Only
// the compaction start goes on from here.
// A seat's own compaction runs the SessionStart hooks inside the seat, its agent_id on the payload (loading audit
// 2026-10-21 G3, 77 of 77 compacted seats in transcripts): the model, the snapshot pointer, the hold and the offer are
// the main session's, so none of them is written or said there.
if (EVENT === 'SessionStart' && payload.agent_id) process.exit(0);
if (EVENT === 'SessionStart' || EVENT === 'PostModelSwitch') {
  fresh.recordSessionModel(EVENT === 'PostModelSwitch' ? payload.to_model : payload.model);
  if (EVENT === 'PostModelSwitch' || String(payload.source || '') !== 'compact') process.exit(0);
}
const { FRESH_OFF, COMPACT_INSTEAD, ctxThreshold, worthResuming } = fresh;
// COMPACT INSTEAD's one line, said at the compaction start and at the first orchestration run of a session.
const COMPACT_NOTE = 'This project compacts instead of offering a fresh session (ALFRED_CODE_AUTO_COMPACT=1): past its '
  + "window's trigger the session compacts and the work goes on from the summary.";

// The hold itself. Released - never denied again - once an ask was answered after the compaction, the turn wrote the
// single-short-step line, a resume would recover too little (the engine's own worthResuming - audit 2026-10-10 C26,
// 758ce661: 120k carry over a 90k floor, the unconditional ask cost two turns), nobody is at the terminal (a live
// AUTO waiver included), or it has denied twice; a hold past 12h is stale. A seat's call is the parent's work in
// flight, never held. One `compact-hold` row (`idle-hold` on the idle route) records how it ended.
const SHORT_STEP_RE = /\b(?:single|one) short step\b/i;
function shortStepSince(from) {
  try {
    const p = payload.transcript_path;
    const size = fs.statSync(p).size;
    const start = Math.max(from, size - 8 * 1024 * 1024, 0);
    if (start >= size) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    for (const line of buf.toString('utf8').split('\n')) {
      if (!SHORT_STEP_RE.test(line)) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'assistant' && Array.isArray(o.message && o.message.content)
          && o.message.content.some((b) => b && b.type === 'text' && SHORT_STEP_RE.test(String(b.text || '')))) return true;
      } catch { /* a cut row */ }
    }
  } catch { /* unreadable - not stated */ }
  return false;
}
// The hold waits for WORK: a shell command that writes nothing (no write target, no git write, by shell-writes.js's
// reader) is the reading a question needs, so it passes and keeps the hold standing - on the idle route (audit 2026-10-11
// SD11) and the compaction route alike (audit 2026-10-20 C12, add5a91e: the first call after a compaction, a read-only
// `cat COMPACT-STATE; grep`, was denied before any post-compaction context could be read - the next call would have read
// 82k over a 74k floor and released the hold as not worth resuming, with no ask).
function writesNothing(command) {
  try {
    const sw = require(nodePath.join(__dirname, 'shell-writes.js'));
    const scan = sw.scanShell(String(command || ''));
    return !!String(command || '').trim() && !scan.targets.some((t) => t.raw !== '/dev/null') && !(scan.gitWrites && scan.gitWrites.length)
      && !(scan.unread && scan.unread.length);
  } catch { return false; }
}
function compactHold() {
  let hold;
  try { hold = JSON.parse(fs.readFileSync(compactHoldFile(), 'utf8')); } catch { return; }
  if (payload.agent_id || !hold || typeof hold !== 'object') return;
  const idle = hold.route === 'idle';
  if (/^(?:Bash|PowerShell|Monitor)$/.test(String(payload.tool_name || '')) && writesNothing((payload.tool_input || {}).command)) return;
  const kind = idle ? 'idle-hold' : 'compact-hold';
  const release = (outcome, detail) => {
    try { fs.unlinkSync(compactHoldFile()); } catch { /* already gone */ }
    ledgerRow({ mode: 'probe', kind, reason: `probe: ${idle ? 'idle-gap' : 'post-compaction'} hold released - ${outcome}`, detail: { outcome, ...(detail || {}) } });
  };
  const since = Number(hold.size) || 0;
  if (Date.now() - (Date.parse(hold.at) || 0) > 12 * 3600 * 1000) return release('stale');
  if (unattended(payload)) return release('unattended');
  if (fresh.askAnsweredSince(since)) return release('asked');
  if (shortStepSince(since)) return release('single-short-step');
  const ctx = typeof fresh.contextNow === 'function' ? fresh.contextNow() : 0;
  const floor = fresh.coldFloor();
  if (ctx > 0 && !worthResuming(ctx)) return release('not-worth-resuming', { ctx, floor });
  if ((Number(hold.denied) || 0) >= 2) return release('denied-twice', { ctx, floor });
  try { fs.writeFileSync(compactHoldFile(), JSON.stringify({ ...hold, denied: (Number(hold.denied) || 0) + 1 })); } catch { /* the cap still ends it */ }
  global.BLOCK_DETAIL = { branch: kind, ctx, floor };
  const carry = ctx > 0 ? `now carries ~${Math.round(ctx / 1000)}k tokens per message` : 'has no post-compaction context reading yet';
  const start = floor ? `~${Math.round(floor / 1000)}k, this session's own first message` : 'this install\'s cold floor';
  if (idle) {
    process.stderr.write(
      (hold.via === 'ask'
        ? `Held once: this session's last ask waited ${Number(hold.gapH) || 'over the set'}h for its answer, its prompt cache went cold, and the\n`
          + `fresh-session choice has not been put to the user yet. It ${carry}; a fresh session\n`
        : `Held once: this session sat idle ${Number(hold.gapH) || 'over the set'}h before this turn, its prompt cache went cold, and the\n`
          + `fresh-session choice offered at the prompt has not been put to the user yet. It ${carry}; a fresh session\n`)
      + `restarts at ${start}. Before this first change, put the choice to the user as ONE AskUserQuestion:\n`
      + `'Resume in a fresh session (Recommended)' quoting those two numbers (end the turn with the paste-ready resume\n`
      + `block and the plan or state file it resumes from), or continue here. If the remaining work is a single short\n`
      + `step, say so in one line - 'single short step: <what>' - and retry this call.`,
    );
    process.exit(2);
  }
  process.stderr.write(
    `Held once: this session AUTO-COMPACTED and the fresh-session choice has not been put to the user yet. It ${carry};\n`
    + `a fresh session restarts at ${start}. The compaction summary's closing line - continue 'without asking the user\n`
    + `any further questions' - is the harness's default, and this hold supersedes it. Before this call, put the choice to\n`
    + `the user as ONE AskUserQuestion: 'Resume in a fresh session (Recommended)' quoting those two numbers (end the turn\n`
    + `with the paste-ready resume block and the plan or state file it resumes from), or continue here. If the remaining\n`
    + `work is a single short step, say so in one line - 'single short step: <what>' - and retry this call.`,
  );
  process.exit(2);
}
// The ask-gap arm, decided once per ask: offers on, someone at the terminal and a resume worth it leave the idle hold (a
// standing hold is kept); either way the marker is written, so the next call does not re-read the ask.
function armAskGap() {
  try { fs.writeFileSync(ASK_GAP.marker, ASK_GAP.id); } catch { /* a lost marker re-judges the same ask, still once per hold */ }
  if (FRESH_OFF) return;
  const last = lastReply();
  const u = (last && last.usage) || {};
  const ctx = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
  const detail = { gapH: ASK_GAP.gapH, ctx, floor: fresh.coldFloor(), via: 'ask-answer' };
  if (!(ctx > 0) || !worthResuming(ctx)) return;
  if (unattended(payload)) { ledgerRow({ mode: 'unattended', kind: 'idle-gap-offer', reason: UNATTENDED_SKIP, detail }); return; }
  try {
    if (fs.existsSync(compactHoldFile())) return;
    fs.writeFileSync(compactHoldFile(), JSON.stringify({ at: new Date().toISOString(), size: fresh.transcriptSize(), denied: 0, route: 'idle', via: 'ask', gapH: ASK_GAP.gapH }));
  } catch { return; }
  ledgerRow({ mode: 'probe', kind: 'idle-gap-offer', reason: 'probe: the idle hold armed by an ask answered after a long gap', detail });
}
if (IS_HOLD_CALL && !IS_SKILL_CALL) {
  if (ASK_GAP) armAskGap();
  compactHold();
  process.exit(0);
}

// THE IDLE-GAP ROUTE (audit 2026-10-10 C09, ca65b406): a next-day prompt after 19h02m idle re-cached 262.7k and ran 14
// messages at 289.9k with no fresh-session offer - the clock route lives only in the stop contract's AskUserQuestion
// note, and that resume asked nothing. So the prompt that ENDS a gap of `ALFRED_CODE_FRESH_SESSION_AFTER_HOURS` (the
// clock route's own knob: default 2, `0` off) since the last reply injects the offer, once per gap, when a resume
// recovers enough of the carry (worthResuming) - a cold cache is the cheapest moment to go fresh. A harness notice is no
// return, a seat has no user, and nobody at the terminal gets one row instead.
function lastReply() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 1024 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    let last = null;
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.includes('"compact_boundary"') && /"subtype"\s*:\s*"compact_boundary"/.test(line)) { if (last) last.usage = null; continue; }
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type !== 'assistant' || !o.message || o.message.model === '<synthetic>') continue;
        const at = Date.parse(o.timestamp || '');
        if (!Number.isNaN(at)) last = { at, usage: o.message.usage || (last && last.usage) || null };
      } catch { /* the window's cut first line */ }
    }
    return last;
  } catch { return null; }
}
function idleGapOffer() {
  if (payload.agent_id || FRESH_OFF) return;
  const n = parseFloat(envOf(process.env, 'FRESH_SESSION_AFTER_HOURS'));
  const hours = Number.isNaN(n) || n < 0 ? 2 : n;
  if (!(hours > 0)) return;
  if (harnessPrompt(payload.prompt)) return;
  const last = lastReply();
  if (!last || !last.usage) return;
  const gapH = (Date.now() - last.at) / 3600000;
  if (gapH < hours) return;
  const u = last.usage;
  const ctx = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
  if (!(ctx > 0) || !worthResuming(ctx)) return;
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  const marker = nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-idle-${key}.offered`);
  try { if (fs.readFileSync(marker, 'utf8').trim() === String(last.at)) return; } catch { /* not offered for this gap */ }
  const floor = fresh.coldFloor();
  const detail = { gapH: Math.round(gapH * 10) / 10, ctx, floor };
  if (unattended(payload)) {
    ledgerRow({ mode: 'unattended', kind: 'idle-gap-offer', reason: UNATTENDED_SKIP, detail });
    return;
  }
  try { fs.writeFileSync(marker, String(last.at)); } catch { /* a lost marker offers twice at most */ }
  // The injection alone is spent on the first prompt even when that prompt is a question answered from context, and a
  // work prompt minutes later went unasked (audit 2026-10-11 SD11: fdce35ae ran 98 messages at 238.6k-412.6k, 2ca8e8ee
  // carried 342k-390k a message for 47). So the gap also leaves the compaction route's one-shot hold, marked `idle`:
  // the first CHANGING call after it is denied once with the numbers until an ask is answered (released as that hold
  // is - the single-short-step line, too little to recover, nobody at the terminal, two denials, 12h). A reading shell
  // call passes it. A compaction hold already standing is kept.
  try {
    if (!fs.existsSync(compactHoldFile())) {
      fs.writeFileSync(compactHoldFile(), JSON.stringify({ at: new Date().toISOString(), size: fresh.transcriptSize(), denied: 0, route: 'idle', gapH: detail.gapH }));
    }
  } catch { /* no hold - the injection below still goes out */ }
  sweepOffers();
  ledgerRow({ mode: 'probe', kind: 'idle-gap-offer', reason: 'probe: the fresh-session offer injected at a prompt after an idle gap', detail });
  const start = floor ? `~${Math.round(floor / 1000)}k, this session's own first message` : 'this install\'s cold floor';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `This session sat idle ${gapH.toFixed(1)}h since its last reply, so its prompt cache is cold: this `
        + `message re-writes all ~${Math.round(ctx / 1000)}k tokens of context, and every later turn re-sends them. A fresh `
        + `session restarts at ${start}. If this prompt starts or continues work, first put the choice to the user as ONE `
        + `AskUserQuestion: 'Resume in a fresh session (Recommended)' quoting those two numbers (end the turn with the `
        + `paste-ready resume block and the plan or state file it resumes from), or continue here. A question answered from `
        + `what is already in context needs no ask.`,
    },
  }));
}
// THE MODE PROMPT (stack-modes spec sections 2 and 5, 2026-10-27): auto-run lasts the session, so a typed prompt never
// ends it - neither a remark mid-run nor 'stop auto-mode' nor a new flow command (the user's ruling: a stop asked in
// words ends the RUN, which the model does by deleting its marker, and the mode stays on). Only `--mode-auto-run-off`
// in a family command's leading run ends the mode: it deletes this session's stamp and run marker. Each old flag gets
// its pointer line, an unknown `--mode-*` its reason, and a mode flag after a command outside the families says where
// flags count. While a run marker is open, a message that is no slash command is input to that run. A session whose
// stamp another session took (`taken-from:`) is told once. A harness prompt (a task notice, a command's output, a seat's
// hand-back - hook-prelude.js harnessPrompt, HK14) is nobody typing. Only this session's own AUTO stamp is read.
// Returns true when it wrote the prompt's context.
const AUTO_SELF_RE = /^(?:alfred-code:)?(?:alfred-)?mode-auto-run$/;
const OLD_FLAG_NOW = { '--auto-mode': '--mode-auto-run-on', '--score-on': '--mode-output-scorer-on', '--score-off': '--mode-output-scorer-off' };
const oldFlagLine = (flag) => `'${flag}' is now '${OLD_FLAG_NOW[flag]}'`
  + (flag === '--auto-mode' ? ' - this run is attended: ask as usual and take no (Recommended) option unasked' : '');
const FLAGS_COUNT_ONLY = 'mode flags count only after a task-, capture-, loop-, issue- or mode- command - stack /mode-output-scorer to grade this request';
const relToRoot = (root, file) => nodePath.relative(root, file).split(nodePath.sep).join('/') || file;
function modePrompt() {
  const sid = String(payload.session_id || '');
  const prompt = String(payload.prompt || '');
  if (!sid || payload.agent_id || harnessPrompt(prompt)) return false;
  let pre;
  try { pre = require('./hook-prelude.js'); } catch { return false; }
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const markerFile = pre.runMarkerFile(root, sid);
  if (markerFile) {
    pre.sweepStale(nodePath.dirname(markerFile), 'AUTO-RUN-');
    pre.sweepStale(nodePath.dirname(markerFile), 'AUTO-TAKEN-');
  }
  const flags = pre.modeFlags(prompt);
  const lines = [];
  // a mode flag typed with no command before it switches nothing (spec section 2's grammar); said, so a user who typed
  // `--mode-auto-run-off` alone mid-run is not left thinking the mode ended (final review m9, re-graded)
  const bare = /^\s*(--mode-[\w-]+|--auto-mode|--score-on|--score-off)(?=\s|$)/.exec(prompt);
  if (bare && !flags.commands.length) {
    ledgerRow({ mode: 'auto', kind: 'mode-flag-bare', reason: `${bare[1]} typed with no command before it switches nothing` });
    lines.push(`'${bare[1]}' typed alone switches nothing: mode flags count only right after a command - `
      + '`/mode-auto-run --mode-auto-run-off` ends auto-run for the session, `/mode-output-scorer --mode-output-scorer-off` the scorer. Tell the user so in one line.');
  }
  for (const flag of flags.old) {
    ledgerRow({ mode: 'auto', kind: 'mode-flag-old', reason: `the old flag ${flag} starts nothing - ${OLD_FLAG_NOW[flag]} replaces it` });
    lines.push(oldFlagLine(flag));
  }
  if (flags.run.length && !flags.family) lines.push(FLAGS_COUNT_ONLY);
  else {
    for (const flag of flags.unknown) {
      ledgerRow({ mode: 'auto', kind: 'mode-flag-unknown', reason: `${flag} is no mode flag` });
      lines.push(`'${flag}' is no mode flag - the four are --mode-auto-run-on|off and --mode-output-scorer-on|off`);
    }
    let stamp = null;
    try { stamp = pre.approvalStamp({ ...payload, cwd: root }); } catch { stamp = null; }
    const own = Boolean(stamp && stamp.session === sid && /^AUTO\b/.test(stamp.first));
    const markerOpen = Boolean(markerFile && fs.existsSync(markerFile));
    if (flags.family && flags.autoRun === 'off') {
      let ended = false;
      if (own) try { fs.rmSync(stamp.file); ended = true; } catch { /* left: the mode stays on */ }
      if (markerOpen) try { fs.rmSync(markerFile); ended = true; } catch { /* left: the hold reads it */ }
      if (ended) ledgerRow({ mode: 'auto', kind: 'auto-end', reason: 'auto-run ended: the user typed --mode-auto-run-off' });
      lines.push('auto-run is OFF for this session: each decision goes to the user again and a turn is no longer sent back at its Stop. '
        + '`--mode-auto-run-on` right after the next task, capture, loop, issue or mode command turns it on again.');
    } else {
      // the takeover notice: this session's mode went to another session's start
      if (stamp && stamp.session && stamp.session !== sid) {
        let from = '';
        try { from = (/^taken-from:[ \t]*(\S+)/m.exec(fs.readFileSync(stamp.file, 'utf8').slice(0, 2048)) || [])[1] || ''; } catch { from = ''; }
        const said = markerFile ? nodePath.join(nodePath.dirname(markerFile), nodePath.basename(markerFile).replace(/^AUTO-RUN-/, 'AUTO-TAKEN-')) : '';
        if (from === sid && said && !fs.existsSync(said)) {
          try {
            fs.mkdirSync(nodePath.dirname(said), { recursive: true });
            fs.writeFileSync(said, `${stamp.session}\n`);
            lines.push(`auto-run is OFF here - session ${stamp.session.slice(0, 8)} took it; \`--mode-auto-run-on\` after a command takes it back`);
          } catch { /* no mark, no notice: said next time */ }
        }
      }
      // a message typed mid-run is input to the run; a typed command opens its own run and gets the contract instead
      if (own && stamp.live && markerOpen && !/^\s*\//.test(prompt)) {
        const rel = relToRoot(root, markerFile);
        ledgerRow({ mode: 'auto', kind: 'auto-input', reason: 'auto-run kept: a prompt typed mid-run is input to the run' });
        lines.push('auto-run stays ON: the user typed this message while the run goes on, so it is INPUT to the run - answer '
          + 'or apply it, then carry on with the run\'s next step; each ask still takes its (Recommended) option. If this message '
          + `asks to stop or pause the run, print its close and delete ${rel} - that ends this run; auto-run stays on until --mode-auto-run-off.`);
      }
    }
  }
  if (!lines.length) return false;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') } }));
  return true;
}
if (EVENT === 'UserPromptSubmit') {
  if (!modePrompt()) idleGapOffer();
  process.exit(0);
}

// PreCompact: the last moment the whole transcript is still there. Write what a resume needs to
// <data root>/state/sessions/COMPACT-STATE-<session> - one per session, so a parallel session's PreCompact never
// overwrites it (loading audit 2026-10-21 G10) - the live plan file, the open flows, the open flow stamps with their ages, the files this session wrote
// (from docs-session's per-actor attribution state) - with no model call; the SessionStart `compact`
// injection below points at it. Never blocks a compaction: every failure only leaves a line out.
const projectRoot = () => process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const legacyFlow = () => nodePath.resolve(projectRoot(), docsRootEnv(), 'flow');
const COMPACT_NAME = () => `COMPACT-STATE-${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_').slice(-80)}`;
const COMPACT_STATE = () => (layout ? layout.statePath(projectRoot(), 'sessions', COMPACT_NAME()) : nodePath.join(legacyFlow(), COMPACT_NAME()));
const FILES_SHOWN = 50;
function livePlan() {
  // The LAST plan file a tool call touched in the transcript tail, else the newest plan under the docs root.
  try {
    const p = payload.transcript_path;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 2 * 1024 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"tool_use"') || !/plans[\\/]/.test(lines[i])) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      const blocks = (o && o.message && Array.isArray(o.message.content)) ? o.message.content : [];
      for (let j = blocks.length - 1; j >= 0; j--) {
        const input = blocks[j] && blocks[j].type === 'tool_use' ? blocks[j].input || {} : {};
        const hit = String(input.file_path || input.command || '').match(/[^\s'"]*plans[\\/][^\s'"]+\.md/g);
        if (hit) return hit[hit.length - 1];
      }
    }
  } catch { /* no transcript - fall through to the docs root */ }
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    // work/plans/ since 2.8.0; plans/ (2.2.2) and superpowers/plans/ until an update moves them (layout.js LAYOUT_MOVES,
    // docs.migratePlans).
    for (const sub of [['work', 'plans'], ['plans'], ['superpowers', 'plans']]) {
      const dir = nodePath.resolve(root, docsRootEnv(), ...sub);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      const newest = names.filter((f) => f.endsWith('.md'))
        .map((f) => ({ f, t: fs.statSync(nodePath.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
      if (newest) return `${nodePath.relative(root, nodePath.join(dir, newest.f)).split(nodePath.sep).join('/')} (newest under the docs root)`;
    }
  } catch { /* no plans folder */ }
  return null;
}
// The open stamps: every receipt in <data root>/state/approvals/, then one a pre-2.8.0 hook or skill copy left in the old
// flow/ - only a receipt's name there (layout.js flowKind), never the session scratch it shared the folder with.
function flowStamps() {
  const seen = new Map();
  const list = (dir, keep) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (seen.has(f) || !keep(f)) continue;
        seen.set(f, Math.round((Date.now() - fs.statSync(nodePath.join(dir, f)).mtimeMs) / 60000));
      }
    } catch { /* no such folder */ }
  };
  if (layout) {
    const approvals = nodePath.dirname(layout.statePath(projectRoot(), 'approvals', 'APPROVAL'));
    list(approvals, (f) => { try { return fs.statSync(nodePath.join(approvals, f)).isFile(); } catch { return false; } });
    // a plan's own stamp (per-plan approvals, 2026-10-20), named <plan id>/APPROVAL
    for (const file of layout.approvalStamps ? layout.approvalStamps(projectRoot()) : []) {
      const f = nodePath.relative(approvals, file).split(nodePath.sep).join('/');
      if (f === 'APPROVAL' || seen.has(f)) continue;
      try { seen.set(f, Math.round((Date.now() - fs.statSync(file).mtimeMs) / 60000)); } catch { /* gone meanwhile */ }
    }
  }
  // the retired monitor's state (its turn log and context marker) and the turn check's marker (an edit list before
  // 2026-10-16) are working state, not stamps
  list(legacyFlow(), layout ? (f) => layout.flowKind(f) === 'approvals'
    : (f) => !/^COMPACT-STATE/.test(f) && f !== 'compact-points.json' && !/^monitor-.*\.(?:json|jsonl|context)$/.test(f) && !/^turn-(?:edits|check)-/.test(f));
  return [...seen].map(([f, age]) => ({ f, age })).sort((a, b) => a.f.localeCompare(b.f));
}
function sessionWrites() {
  const os = require('os');
  const prefix = `docs-session-${String(payload.session_id || 'none').replace(/[^\w-]/g, '')}--`;
  const out = new Set();
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
      try { for (const w of JSON.parse(fs.readFileSync(nodePath.join(os.tmpdir(), f), 'utf8')).wrote || []) out.add(String(w)); } catch { /* one broken actor file */ }
    }
  } catch { /* no tmpdir */ }
  return [...out];
}

// The deliberate entry points: each one opens a multi-phase run with its own state file, so a
// fresh session resuming from that file is always cheaper than continuing on carried context.
// The review and per-phase seats are here because they are the same population, measured: one
// session started `task-verify-code` at 364.6k and `security-review` at 383.1k, together 13.7M
// cache-read - 27% of the whole session - for 20.5k of output, and the offer arrived nine minutes
// after that spend. `capture-awareness` is here because the stack's own next-steps card
// tells the user to run it after every update (its 2026-10-16 parts keep their old names here for an old copy). The guided plugin commands are here because
// they are multi-phase walks too, and the slash route is what finally reaches them.
const ORCHESTRATION = /^((alfred-)?(loop-(quality|code-quality|architecture-quality|test-coverage)|capture-(architecture|architecture-quality|awareness|code-quality|code-style|project-code-style|preferences|test-coverage|usage-report|related-projects|agent-awareness|project-awareness|agent-capabilities|project-capabilities)|task-(solve|solve-cross|build-from-scratch|version-upgrade|design|verify-plan|implement|verify-code)|mode-auto-run|issue-diagnoser|review-code|review-security)|security-review|alfred-code:(init|update|configure|validate))$/;
// a plugin-namespaced Skill call arrives as `<plugin>:<skill>`; the guided commands are
// matched on their FULL name, so a bare `/setup` from some other plugin is not read as one of them - and only this
// stack's own namespace is stripped, so another plugin's `other:task-solve` is not this stack's run (audit 2026-10-08)
const isOrchestration = (n) => ORCHESTRATION.test(n) || ORCHESTRATION.test(n.replace(/^alfred-code:/, ''));
let skill = '';
if (IS_SKILL_CALL) {
  skill = String((payload.tool_input || {}).skill || (payload.tool_input || {}).name || '');
} else if (EVENT === 'UserPromptExpansion') {
  // The harness names the typed command (`command_name`). The typed prompt's own `/name` settles a plugin
  // command's namespace when the name arrives bare - the guided walks count only as `alfred-code:<walk>`.
  const named = String(payload.command_name || '');
  const typed = (String(payload.prompt || '').match(/^\s*\/([A-Za-z0-9:_-]+)/) || [])[1] || '';
  skill = typed && (!named || typed.replace(/^.*:/, '') === named.replace(/^.*:/, '')) ? typed : named;
}
// --- a `disable-model-invocation` skill is the USER's to type, and this is what enforces it ---
// Every project's generated capabilities rule used to stamp 'the harness BLOCKS the Skill call'.
// Measured BOTH WAYS: one CLI build (2.1.229) denied the model's Skill call on a flagged skill
// with a tool_use_error, and in another session it did not - a user typed the command with a
// LEADING SPACE, so no `<command-name>` marker fired, and the model reached the flagged skill through a `Skill` tool call four seconds
// later - body injected, run started. An ASSERTED harness behaviour is the weakest form of a gate,
// and one that varies by build is no gate at all, so the assertion became this gate. Only the MODEL's own Skill call is denied: a slash turn
// arrives as UserPromptExpansion and never reaches here, so the user's own route is untouched. No env
// switch - the verdict is the skill's own frontmatter, not a judgment that can be wrong.
// A skill has TWO homes: copied into `.claude/skills/` (the 0.2.x route, and still where an EXTRA
// lands), or served from an enabled plugin's cache. Reading only the project copy made this gate
// silently stop firing for every skill a plugin carries - the catch below swallowed the missing
// file, and 13 skills carry the flag. So every home is tried, in the order Claude Code resolves a name:
// the PERSONAL copy (`<config dir>/skills/`) first - 'personal over project' (code.claude.com/docs/en/skills),
// so reading the project copy first judged the copy that never runs (2.1.5 M10) - then the project copy,
// then the plugin caches.
// A plugin COMMAND and the router skill carry the flag too - the seven guided commands and `alfred-code` itself, 8 of
// the 21 flagged entries, were never resolved, so a model's `Skill(alfred-code:setup)` ran (audit 2026-10-08). Each
// plugin root is read at every home its entries ship from: `stack/skills`, `skills`, `setup-plugin/skills`,
// `commands` and `setup-plugin/commands`.
const pluginHeads = (base, bare) => [
  nodePath.join(base, 'stack', 'skills', bare, 'SKILL.md'), nodePath.join(base, 'skills', bare, 'SKILL.md'),
  nodePath.join(base, 'setup-plugin', 'skills', bare, 'SKILL.md'), nodePath.join(base, 'commands', `${bare}.md`),
  nodePath.join(base, 'setup-plugin', 'commands', `${bare}.md`),
];
function skillHeads(root, skill) {
  const bare = skill.replace(/^.*:/, '');
  const cfg = process.env.CLAUDE_CONFIG_DIR || nodePath.join(process.env.HOME || process.env.USERPROFILE || '', '.claude');
  const out = [nodePath.join(cfg, 'skills', bare, 'SKILL.md'), nodePath.join(root, '.claude', 'skills', bare, 'SKILL.md'),
    nodePath.join(cfg, 'commands', `${bare}.md`), nodePath.join(root, '.claude', 'commands', `${bare}.md`)];
  const cache = nodePath.join(cfg, 'plugins', 'cache');
  // <cache>/<marketplace>/<plugin>/<version>/stack/skills/<bare>/SKILL.md - the plugin is known when the call carries a
  // scoped name, and is a short scan otherwise. A plugin's COMMANDS are read only under its namespace: a name with no
  // colon is a personal or project command or a built-in (audit 2026-10-20 H10: the built-in `init` matched the core's
  // `commands/init.md` and was denied as disable-model-invocation); a plugin SKILL still answers to its bare name.
  const want = skill.includes(':') ? skill.slice(0, skill.indexOf(':')) : null;
  const heads = (base) => pluginHeads(base, bare).filter((f) => want || !/[\\/]commands[\\/][^\\/]+\.md$/.test(f));
  // The running plugin's own root is the copy that is loaded, so it is read before any cached one.
  const running = process.env.CLAUDE_PLUGIN_ROOT;
  if (running && (!want || nodePath.basename(nodePath.dirname(running)) === want)) out.push(...heads(running));
  let markets = [];
  try { markets = fs.readdirSync(cache); } catch { return out; }
  for (const market of markets) {
    let plugins = [];
    try { plugins = fs.readdirSync(nodePath.join(cache, market)); } catch { continue; }
    for (const plugin of plugins) {
      if (want && plugin !== want) continue;
      let versions = [];
      try { versions = fs.readdirSync(nodePath.join(cache, market, plugin)); } catch { continue; }
      for (const version of versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
        out.push(...heads(nodePath.join(cache, market, plugin, version)));
      }
    }
  }
  return out;
}

// The newest orchestration run this session started, and how: a SLASH command's body arrives once, as the expansion,
// and is not re-attached after a compaction (the harness's `invoked_skills` attachment carries Skill-TOOL bodies only),
// so a slash flow resumed from the summary alone - audit 2026-10-10 C09, 6ed392a5: the close ask dropped the
// template's 'Commit now' option and both verbatim close lines, then a clarify, a re-ask and a typed redo. The whole
// transcript is read in chunks (PreCompact is rare and the run's marker sits at its head).
// The flows open at the compaction: the newest typed slash flow and every orchestration run the Skill tool started after
// it (a slash /task-solve building through Skill(task-implement) - loading audit 2026-10-21 G2), the newest last, at most
// FLOW_CHAIN. Each Skill-route run carries how many Skill calls came after it: the harness re-attaches the newest skills'
// first 5,000 tokens each within 25,000 in all (code.claude.com/docs/en/skills, verified 2026-10-21), so an older run
// can come back cut or not at all.
const FLOW_CHAIN = 3;
function activeFlow() {
  try {
    const p = payload.transcript_path;
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    let found = null;
    let chain = [];
    let skillCalls = 0;
    try {
      const CHUNK = 4 * 1024 * 1024;
      let carry = '';
      for (let at = 0; at < size; at += CHUNK) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - at));
        fs.readSync(fd, buf, 0, buf.length, at);
        const lines = (carry + buf.toString('utf8')).split('\n');
        carry = at + buf.length < size ? lines.pop() : '';
        for (const line of lines) {
          if (line.includes('<command-name>') && line.includes('"type":"user"') && !line.includes('"tool_result"') && isHumanTurn(line)) {
            const c = (JSON.parse(line).message || {}).content;
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.type === 'text' && x.text) || '').join('\n') : '';
            const m = /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/.exec(text);
            if (m && isOrchestration(m[1])) { found = { name: m[1], route: 'slash' }; chain = [found]; }
          } else if (line.includes('"Skill"') && line.includes('"tool_use"') && line.includes('"type":"assistant"')) {
            try {
              for (const b of JSON.parse(line).message.content || []) {
                const n = b && b.type === 'tool_use' && b.name === 'Skill' ? String((b.input || {}).skill || (b.input || {}).name || '') : '';
                if (!n) continue;
                skillCalls += 1;
                if (!isOrchestration(n)) continue;
                found = { name: n, route: 'skill', at: skillCalls };
                chain = [...chain.filter((r) => r.name !== n), found].slice(-FLOW_CHAIN);
              }
            } catch { /* a cut row */ }
          }
        }
      }
    } finally { fs.closeSync(fd); }
    if (!found) return null;
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    for (const run of chain) {
      run.body = skillHeads(root, run.name).find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
      run.after = run.route === 'skill' ? skillCalls - run.at : 0;
      try { run.chars = run.body ? fs.statSync(run.body).size : 0; } catch { run.chars = 0; }
      // re-read: a slash body is never re-attached; a Skill body past ~5,000 tokens comes back cut, and one with five
      // or more Skill calls after it can fall out of the 25,000-token budget
      run.reread = run.route === 'slash' || run.chars > REATTACH_CHARS || run.after >= REATTACH_LATER;
    }
    found.chain = chain;
    return found;
  } catch { return null; }
}
const REATTACH_CHARS = 18000;
const REATTACH_LATER = 5;
// The context this compaction happened at, kept per project for the fresh-session trigger (fresh-session.js
// observedCompaction - audit 2026-10-10 C08). PreCompact carries no token count (code.claude.com/docs/en/hooks), so it
// records the last real model call's context; the compact start below adds the boundary row's own `preTokens`.
function recordCompaction(tokens) {
  if (typeof fresh.recordCompactPoint === 'function' && tokens) fresh.recordCompactPoint(tokens, fresh.sessionModelId());
}
function boundaryPreTokens() {
  try {
    const p = payload.transcript_path;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 4 * 1024 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"compact_boundary"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        if (o.subtype === 'compact_boundary') return o.compactMetadata || {};
      } catch { /* a cut row */ }
    }
  } catch { /* unreadable */ }
  return null;
}
if (EVENT === 'PreCompact') {
  try {
    if (String(payload.trigger || '') === 'auto') {
      const u = lastUsage();
      if (u) recordCompaction((u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0));
    }
  } catch { /* the snapshot below still runs */ }
  try {
    const plan = livePlan();
    const stamps = flowStamps();
    const wrote = sessionWrites();
    const flow = activeFlow();
    const lines = [
      '# COMPACT-STATE - written by guard-fresh-session-start.js at PreCompact, no model call. Read it before re-orienting.',
      `session: ${payload.session_id || ''}`,
      `written: ${new Date().toISOString()}`,
      `trigger: ${payload.trigger || ''}`,
      `live plan: ${plan || 'none found'}`,
      flow ? `active flow: /${flow.name} (${flow.route === 'slash' ? 'slash command - its body is not re-attached after a compaction' : 'Skill call - the harness re-attaches its body up to 5,000 tokens'})` : 'active flow: none found',
      ...(flow && flow.body ? [`flow body: ${flow.body.split(nodePath.sep).join('/')}`] : []),
      ...(flow && flow.chain && flow.chain.length ? ['open flows:', ...flow.chain.map((r) => `  /${r.name} - ${r.route === 'slash' ? 'slash command' : 'Skill call'}`
        + `${r.body ? ` - body ${r.body.split(nodePath.sep).join('/')}` : ''}${r.route === 'skill' ? ` (${r.chars} chars, ${r.after} Skill calls after it)` : ''}${r.reread ? ' - re-read' : ''}`)] : []),
      stamps.length ? 'flow stamps:' : 'flow stamps: none',
      ...stamps.map((s) => `  ${s.f} - ${s.age} min old`),
      `files written this session (${wrote.length})${wrote.length ? ':' : ''}`,
      ...wrote.slice(0, FILES_SHOWN).map((w) => `  ${w}`),
      ...(wrote.length > FILES_SHOWN ? [`  ... and ${wrote.length - FILES_SHOWN} more`] : []),
    ];
    fs.mkdirSync(nodePath.dirname(COMPACT_STATE()), { recursive: true });
    fs.writeFileSync(COMPACT_STATE(), lines.join('\n') + '\n');
    try { require('./hook-prelude.js').sweepStale(nodePath.dirname(COMPACT_STATE()), 'COMPACT-STATE-'); } catch { /* no prelude: no sweep */ }
  } catch { /* a snapshot that cannot be written never stands in the compaction's way */ }
  process.exit(0);
}
// The pointer the compact start carries: only to a snapshot of THIS session, written within the hour - plus, when the
// session's newest run was a SLASH flow, the line that puts its body back before the next step.
function compactPointer() {
  try {
    const candidates = layout ? [layout.findState(projectRoot(), 'sessions', COMPACT_NAME()), layout.findState(projectRoot(), 'sessions', 'COMPACT-STATE')] : [COMPACT_STATE()];
    const file = candidates.find((f) => fs.existsSync(f)) || candidates[0];
    if (Date.now() - fs.statSync(file).mtimeMs > 60 * 60 * 1000) return '';
    const state = fs.readFileSync(file, 'utf8').split('\n');
    if (!payload.session_id || !state.includes(`session: ${payload.session_id}`)) return '';
    const rel = nodePath.relative(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), file).split(nodePath.sep).join('/');
    // Every open flow the snapshot marks `re-read` (G2, G9); a snapshot without the block (an older hook) names the
    // newest run alone, re-read only when it was typed as a slash command.
    const open = state.slice(state.indexOf('open flows:') + 1).filter((l, i, a) => state.includes('open flows:') && /^ {2}\//.test(l) && a.slice(0, i).every((x) => /^ {2}\//.test(x)));
    const rows = open.length ? open.filter((l) => / - re-read$/.test(l)).map((l) => {
      const m = /^ {2}(\/\S+) - (slash command|Skill call)(?: - body (.+?))?(?: \((\d+) chars, (\d+) Skill calls after it\))? - re-read$/.exec(l) || [];
      return { name: m[1], slash: m[2] === 'slash command', body: m[3], chars: Number(m[4]) || 0, after: Number(m[5]) || 0 };
    }).filter((r) => r.name) : (() => {
      const flow = (state.find((l) => /^active flow: \/\S+ \(slash command/.test(l)) || '').match(/^active flow: (\/\S+)/);
      return flow ? [{ name: flow[1], slash: true, body: (state.find((l) => l.startsWith('flow body: ')) || '').slice('flow body: '.length).trim() }] : [];
    })();
    const read = (r) => (r.body ? `Read ${r.body} again before its next step` : 're-read its SKILL.md before its next step');
    const why = (r) => (r.slash ? `${r.name}, typed as a slash command, so its body was NOT carried through the compaction`
      : `${r.name}, a Skill call whose body the harness re-attaches only within 5,000 tokens each and 25,000 in all (${r.chars > REATTACH_CHARS ? `${r.chars} chars here` : `${r.after} Skill calls came after it`})`);
    const flowLine = rows.length
      ? ` This session's open ${rows.length > 1 ? 'flows are' : 'run is'} ${rows.map((r) => `${why(r)} - ${read(r)}`).join('; ')}`
        + ` (${rows.length > 1 ? 'their' : 'its'} stop asks and close lines are templates the summary does not keep).`
      : '';
    return `The PreCompact hook saved what this session had open at ${rel} - the live plan, the active flow, the flow stamps with their ages, the files it wrote. Read it before anything else.${flowLine}`;
  } catch { return ''; }
}

if (IS_SKILL_CALL && skill) {
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    // the flag lives in the frontmatter - read the head, never the body
    let head = '';
    for (const file of skillHeads(root, skill)) {
      let fd;
      try { fd = fs.openSync(file, 'r'); } catch { continue; }
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = (buf.toString('utf8', 0, n).split(/^---\s*$/m)[1] || '');
      break;
    }
    if (/^disable-model-invocation:\s*true\s*$/m.test(head)) {
      process.stderr.write(
        `Blocked: ${skill} is marked disable-model-invocation - it is the USER's to type, never yours\n` +
        `to call. Do not retry it under another spelling and do not spend the turn explaining that you\n` +
        `cannot: name the command, say in ONE line what it does, and hand the turn back so the user\n` +
        `can run /${skill} themselves.`,
      );
      process.exit(2);
    }
  } catch { /* no such skill on disk, or unreadable - not this guard's business */ }
}

// --- Claude Code's bundled reviews are not this stack's (the user's ruling of 2026-10-22, 'Stop the model using theirs') ---
// The stack reviews with /review-code and /review-security, which borrowed the method; the model's - or a seat's - call
// to the bundled /code-review or /security-review is denied with a pointer. A skill of that name on disk (the user's
// own, a project's, another plugin's) is no built-in and passes, and a typed command never reaches this route. So does
// every call while the model cannot load ours (the skew window before /alfred-code:update, or skillOverrides switched
// it off): a deny then would leave the model with no reviewer at all (final review 2026-10-22, I1). Ours is a library
// copy - personal or project - never the core's own stack/skills source in the plugin cache.
// `guard-fresh-session-start:builtin-review` in ALFRED_CODE_HOOKS_OFF switches this part off.
const BUILTIN_REVIEW = { 'code-review': '/review-code', 'security-review': '/review-security' };
// The copy and skillOverrides read live in the prelude (skillCopyState, shared with the scorer); no prelude skips the deny.
const oursLoadable = (root, ours) => { try { return require('./hook-prelude.js').oursLoadable(root, ours); } catch { return false; } };
if (IS_SKILL_CALL && Object.prototype.hasOwnProperty.call(BUILTIN_REVIEW, skill.trim().replace(/^\//, ''))) {
  const name = skill.trim().replace(/^\//, '');
  let off = false;
  try { off = require('./hook-prelude.js').partOff('guard-fresh-session-start', 'builtin-review'); } catch { /* no prelude: the part is on */ }
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  if (!off && !skillHeads(root, name).some((f) => fs.existsSync(f)) && oursLoadable(root, BUILTIN_REVIEW[name].slice(1))) {
    global.BLOCK_DETAIL = { branch: 'builtin-review', skill: name };
    process.stderr.write(
      `Blocked: ${name} is Claude Code's built-in review, not this stack's. Use ${BUILTIN_REVIEW[name]} instead - load it\n` +
      `with the Skill tool; never retry the built-in under another spelling. If the user asked for the built-in by name,\n` +
      `say so: the user can type /${name} themselves.\n`,
    );
    process.exit(2);
  }
}
// A phase Skill call after a compaction is a change like any other (the post-compaction hold above).
if (IS_SKILL_CALL) compactHold();

// THE GATED STOPS (audit 2026-10-10 C19, b35afe70: spec-check printed `path: gated`, the plan was written and
// task-verify-plan ran 8s later with no stop, the gate's stop folded into the approval ask, and the 5 gaps the audit
// fixed were never named - the one stop the user saw in 38 minutes was the approval). In a solve-task cycle whose spec
// check printed `path: gated`, the GATE skill waits for a stop after the DESIGN skill, and the BUILD skill for one after
// the GATE: an answered ask or a typed prompt since that step's own Skill call and its last plan-file write. Denied once per step call, then it
// passes with a row; a seat's call and nobody at the terminal (an AUTO waiver included - the flow waives its stops)
// are never held. The marker sits at the cycle's head - 14.6MB and a compaction before the gate call in b35afe70 - so
// the whole transcript is read, in 4MB chunks, on these two skill calls only.
function transcriptLines(each) {
  const p = payload.transcript_path;
  const size = fs.statSync(p).size;
  const fd = fs.openSync(p, 'r');
  try {
    const dec = new (require('string_decoder').StringDecoder)('utf8');   // a chunk edge never splits a character
    let at = 0;
    let carry = '';
    while (at < size) {
      const buf = Buffer.alloc(Math.min(4 * 1024 * 1024, size - at));
      fs.readSync(fd, buf, 0, buf.length, at);
      at += buf.length;
      const parts = (carry + dec.write(buf)).split('\n');
      carry = parts.pop();
      for (const line of parts) each(line);
    }
    if (carry) each(carry);
  } finally { fs.closeSync(fd); }
}
function gatedStepHold() {
  const name = String(skill || '').replace(/^alfred-code:/, '').replace(/^alfred-/, '');
  const prev = name === 'task-verify-plan' ? 'task-design' : name === 'task-implement' ? 'task-verify-plan' : null;
  if (!prev || payload.agent_id || unattended(payload)) return;
  const MARK_RE = /<command-name>\s*\/?(?:alfred-code:)?(?:alfred-)?task-solve\s*<\/command-name>|"skill"\s*:\s*"(?:alfred-code:)?(?:alfred-)?task-solve"/;
  // spec-check.js's own two closing lines, never the skill body's backticked mention
  const PATH_RE = /(?:^|\\n)spec: [^"\n]*?\\npath: (gated|merged)\b/;
  const ANSWER_RE = /"(?:content|text)"\s*:\s*"(?:Your questions have been answered:|The user answered:|The user (?:declined|chose not) to answer)/;
  const STEP_RE = new RegExp(`"skill"\\s*:\\s*"(?:alfred-code:)?(?:alfred-)?${prev}"`);
  let gated = false;
  let stepId = null;
  let stopped = false;
  // The DESIGN's stop comes after its ARTIFACT: an ask answered before the plan reached disk is the design's own clarify
  // question (b35afe70: its one ask before the gate was L122's, and the plan went to disk through `cat > $P <<'EOF'` at
  // L1503). The gate's stamp and step 3's `Approved:` line write the plan again, after the stop, and move nothing.
  const needsArtifact = prev === 'task-design';
  let artifact = !needsArtifact;
  try {
    transcriptLines((line) => {
      if (!line) return;
      const isUser = /"type"\s*:\s*"user"/.test(line);
      const isAssistant = !isUser && /"type"\s*:\s*"assistant"/.test(line);
      const result = isUser && line.includes('"tool_result"');
      if (MARK_RE.test(line) && (isUser ? !result : isAssistant && line.includes('"tool_use"'))) { gated = false; stepId = null; stopped = false; return; }
      if (result) {
        const m = PATH_RE.exec(line);
        if (m) gated = m[1] === 'gated';
        if (stepId && artifact && ANSWER_RE.test(line)) stopped = true;
        return;
      }
      if (isUser && stepId && artifact && isHumanTurn(line) && !/"content"\s*:\s*"\s*Stop hook feedback:/.test(line)) { stopped = true; return; }
      if (!isAssistant || !line.includes('"tool_use"')) return;
      const fileWrite = /"name"\s*:\s*"(?:Write|Edit|MultiEdit)"/.test(line) && /"file_path"\s*:\s*"[^"]*plans[\\/]+[^"]*\.md"/.test(line);
      const shellWrite = /"name"\s*:\s*"(?:Bash|PowerShell)"/.test(line) && /plans[\\/]+[^"\s\\]*\.md/.test(line) && /(?:>|\btee\b|Set-Content|Out-File)/.test(line);
      if (stepId && (fileWrite || shellWrite)) { artifact = true; return; }
      if (STEP_RE.test(line)) {
        try {
          const b = (JSON.parse(line).message.content || []).find((x) => x && x.type === 'tool_use' && x.name === 'Skill' && STEP_RE.test(JSON.stringify(x.input || {})));
          if (b) { stepId = String(b.id || 'step'); stopped = false; artifact = !needsArtifact; }
        } catch { /* a cut row */ }
      }
    });
  } catch { return; }   // unreadable - never held
  if (!gated || !stepId || stopped) return;
  const key = String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  const marker = nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-gated-${key}-${stepId.replace(/[^\w-]/g, '_').slice(-40)}.denied`);
  if (fs.existsSync(marker)) {
    ledgerRow({ mode: 'probe', kind: 'gated-stop', reason: 'probe: a gated step ran after its once-deny with no stop', detail: { skill: name, after: prev } });
    return;
  }
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { return; }   // no marker, no deny - never a loop
  global.BLOCK_DETAIL = { branch: 'gated-stop', skill: name, after: prev };
  const step = prev === 'task-design' ? 'step 1 DESIGN' : 'step 2 GATE';
  process.stderr.write(
    `Held once: this solve-task cycle's spec check printed \`path: gated\`, so ${step} ends with a STOP before ${name} runs,\n`
    + `and none landed since ${prev} ran. Put the stop to the user now: \`Result:\` (the plan path${prev === 'task-verify-plan' ? ', and each fix the gate applied, named' : ''}), \`Progress:\`\n`
    + `and \`Leftovers:\`, then ONE AskUserQuestion with the next step recommended${prev === 'task-verify-plan' ? ' - on a gate pass with no open item, step 3\'s approval ask is this stop' : ''}.\n`
    + `Call ${name} after the answer.`,
  );
  process.exit(2);
}

// --- AUTO-RUN: `--mode-auto-run-on` turns auto-run on for the SESSION (stack-modes spec section 2, 2026-10-27; it was
// auto-mode, a per-run `--auto-mode`, from the user's ruling of 2026-10-14) ---
// The flag counts only in the leading run right after a typed task, capture, loop, issue or mode command (hook-prelude.js
// modeFlags, the one parser): anywhere else it is the request's own text, and a prose prompt never starts it.
// `/mode-auto-run <request>` is its own waiver. The flag is the user's waiver, so this hook writes the AUTO stamp itself,
// naming the session (hook-prelude.js approvalStamp), BEFORE the run's first step, and keeps a stamp already live for
// this session. From there every hook that asks a person reads the session as unattended, and the stop contract answers
// each ask that marks a Recommended option. The stamp is the MODE; each typed family command under it opens a RUN -
// the marker `<data root>/state/sessions/AUTO-RUN-<session>` (hook-prelude.js writeRunMarker), which the Stop hold and
// the dispatch guard read and the run's close deletes. `--mode-auto-run-off` alone ends the mode (modePrompt, above).
// A seat never starts one: the session that dispatched it owns the run. A digit is part of a skill name (`task-migrate-v2`).
const AUTO_SKILL_RE = /^(?:alfred-code:)?(?:alfred-)?(?:task|capture|loop|issue|mode)-[a-z][a-z0-9-]*$/;   // hook-prelude.js FLOW_FAMILY_RE
function autoArgs() {
  if (IS_SKILL_CALL) return String((payload.tool_input || {}).args || '');
  if (EVENT !== 'UserPromptExpansion') return '';
  if (typeof payload.command_args === 'string') return payload.command_args;
  return String(payload.prompt || '').replace(/^\s*\/[A-Za-z0-9:_-]+/, '');
}
// The typed line this expansion came from: the prompt as typed, else the command and its arguments.
const typedLine = () => (typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt : `/${skill} ${autoArgs()}`);
// The Skill route is the MODEL's call, so the flag on its args is the model's: it writes or keeps the stamp only when the
// user's newest TYPED prompt is itself a family command whose leading run turns auto-run on (audit HK04 replayed a
// self-start: 'look at the cache layer' typed, then Skill(task-implement, 'auto-mode') opened the implementer gate).
// A harness row (a skill body, a seat's hand-back, a task notice, a tool result) is no typed prompt.
function lastTypedPrompt() {
  try {
    const p = payload.transcript_path;
    if (!p) return '';
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 4 * 1024 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"user"')) continue;
      let row;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      if (!row || row.type !== 'user' || row.isMeta || row.isCompactSummary || row.isSidechain) continue;
      const c = row.message && row.message.content;
      if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) continue;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('\n') : '';
      if (!text.trim() || harnessPrompt(text)) continue;
      return text;
    }
  } catch { /* no transcript - no typed word */ }
  return '';
}
// Why this command's auto-run did not start, for the banner: a refusal the user cannot see is a run they think is
// unattended and is not (a side review of the hooks track, 2026-10-20). hook-prelude.js autoRunRefusal is the one check
// the ON line shares, so the two never disagree.
let autoRefused = '';
// The line's flags, for the banner's near-miss note.
let autoFlags = null;
function autoModeStart() {
  const sid = String(payload.session_id || '');
  if (!sid || payload.agent_id || !AUTO_SKILL_RE.test(skill)) return null;
  let pre;
  try { pre = require('./hook-prelude.js'); } catch { return null; }   // no prelude: the run asks as it always has
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const flags = pre.modeFlags(IS_SKILL_CALL ? `/${skill} ${autoArgs()}` : typedLine());
  autoFlags = flags;
  // the prompt's own -off wins over the stamp, in either event order: no marker, no contract
  if (flags.autoRun === 'off') return null;
  const current = pre.approvalStamp({ ...payload, cwd: root });
  const liveHere = Boolean(current && current.live && current.session === sid && /^AUTO\b/.test(current.first));
  let typed = flags;
  if (IS_SKILL_CALL) {
    if (flags.autoRun !== 'on' || !flags.run.includes('--mode-auto-run-on')) return null;
    typed = pre.modeFlags(lastTypedPrompt());
    if (!typed.family || typed.autoRun !== 'on') {
      ledgerRow({ mode: 'auto', kind: 'auto-start-refused', reason: `auto-run: ${skill} called with --mode-auto-run-on, but the user's newest typed prompt is no family command turning it on` });
      return null;
    }
  } else if (AUTO_SELF_RE.test(skill) && !flags.request && !flags.run.length) {
    // an empty /mode-auto-run starts nothing, whatever the session's mode
    autoRefused = pre.autoRunRefusal({ ...payload, cwd: root }, undefined, flags);
    return null;
  }
  if (flags.autoRun !== 'on' && !liveHere) return null;
  let kept = liveHere;
  if (!liveHere) {
    const refusal = pre.autoRunRefusal({ ...payload, cwd: root }, undefined, typed);
    if (refusal) {
      autoRefused = refusal;
      ledgerRow({ mode: 'auto', kind: 'auto-start-refused', reason: `auto-run: ${skill} - ${refusal}` });
      return null;
    }
    // written to <data root>/state/approvals/; approvalStamp reads it there, then the pre-2.8.0 flow/
    const file = layout ? layout.statePath(root, 'approvals', 'APPROVAL') : nodePath.resolve(root, docsRootEnv(), 'flow', 'APPROVAL');
    // The user's words, verbatim but for the line breaks and double quotes the stamp's one-line quote cannot hold.
    const words = (IS_SKILL_CALL ? `/${skill} ${autoArgs()}` : typedLine()).replace(/\s+/g, ' ').trim().replace(/"/g, "'").slice(0, 400);
    const from = current && current.session && current.session !== sid && /^AUTO\b/.test(current.first) ? current.session : '';
    try {
      fs.mkdirSync(nodePath.dirname(file), { recursive: true });
      fs.writeFileSync(file, `AUTO - "${words}"\nsession: ${sid}\nskill: ${skill}\nat: ${new Date().toISOString()}\n${from ? `taken-from: ${from}\n` : ''}`);
    } catch { return null; }   // no stamp, no auto-run: the run asks as it always has
    // the stamp this one replaces, left in the pre-2.8.0 flow/, would be read again once the new one goes
    if (current && current.file !== file) try { fs.rmSync(current.file, { force: true }); } catch { /* the new one wins while it stands */ }
    if (from) ledgerRow({ mode: 'auto', kind: 'auto-takeover', reason: `auto-run: session ${sid.slice(0, 8)} took the stamp of idle session ${from.slice(0, 8)}`, detail: { from: from.slice(0, 8), to: sid.slice(0, 8) } });
    kept = false;
  }
  const stampFile = kept ? current.file : (layout ? layout.statePath(root, 'approvals', 'APPROVAL') : nodePath.resolve(root, docsRootEnv(), 'flow', 'APPROVAL'));
  ledgerRow({ mode: 'auto', kind: 'auto-start', reason: `auto-run: ${kept ? 'the live stamp kept' : 'stamp written'} for ${skill}`, detail: { skill, kept } });
  // The run: a typed family command opens (or replaces) the marker; the model's Skill call rides the one open.
  const markerFile = pre.runMarkerFile(root, sid);
  const runSkill = IS_SKILL_CALL ? skill.replace(/^alfred-code:/, '') : pre.runMarkerSkill(flags);
  const opened = !IS_SKILL_CALL && runSkill ? pre.writeRunMarker(root, sid, runSkill, typedLine()) : false;
  return { file: relToRoot(root, stampFile), marker: markerFile && (opened || IS_SKILL_CALL) ? relToRoot(root, markerFile) : '', run: runSkill || skill.replace(/^alfred-code:/, ''), kept };
}
const auto = (IS_SKILL_CALL && (EVENT === 'PreToolUse' || !EVENT)) || EVENT === 'UserPromptExpansion' ? autoModeStart() : null;
// --- the MODE BANNER (the user's ruling, 2026-10-15) ---
// A typed task, capture, loop, issue or mode command opens its first reply with two lines saying how this session
// will behave during the run: whether auto-run is on (each ask answered with its Recommended option, or each one waiting
// for the user), and how it meets a full context - it compacts (auto-run, or ALFRED_CODE_AUTO_COMPACT=1), or it offers
// a fresh session at its trigger - with the numbers behind it, from the same engine every offer reads. Once per typed
// command: the expansion fires once, and the lines say they are not repeated. Never on a phase's Skill call, a seat's or
// a session nobody is at. It rides AFTER whatever else this expansion injects, so each of those keeps its own shape.
const BANNER_RE = AUTO_SKILL_RE;   // every family a banner opens can run in auto-run (capture joined 2026-10-17, mode 2026-10-27)
const BANNER_HEAD = 'Open your reply to this command with these two lines, exactly as written, and never repeat them in a later reply:';
const tokens = (n) => (n >= 1000000 && n % 1000000 === 0 ? `${n / 1000000}M` : `${Math.round(n / 1000)}k`);
// A configured auto-compact window this project's own compactions show was not honoured (fresh-session.js
// compactWindowIgnored - audit 2026-10-20 C10): said ONCE per session, wherever the session first meets it (a compaction
// start or a banner), naming the documented route that applies a window to the running session. No cause is claimed.
function acwIgnoredNote() {
  try {
    const ig = typeof fresh.compactWindowIgnored === 'function' ? fresh.compactWindowIgnored() : null;
    if (!ig || payload.agent_id) return '';
    const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
    const marker = nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-acw-${key}.said`);
    if (fs.existsSync(marker)) return '';
    fs.writeFileSync(marker, String(ig.seen));
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const rel = nodePath.relative(root, ig.source);
    // in git's spelling on every platform, so a Windows session reads the same path the docs and the user's own commands use
    // A user-scope file outside the project reads `~/`-relative, `/` on every platform too (audit 2026-10-20, the hooks
    // track's minor list: the account settings path printed whole, with the home folder's name and Windows separators).
    const home = require('os').homedir();
    const fromHome = home ? nodePath.relative(home, ig.source) : '';
    const where = /^CLAUDE_CODE_/.test(ig.source) ? ig.source
      : rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel) ? rel.split(nodePath.sep).join('/')
        : fromHome && !fromHome.startsWith('..') && !nodePath.isAbsolute(fromHome) ? `~/${fromHome.split(nodePath.sep).join('/')}`
          : String(ig.source).split(nodePath.sep).join('/');
    return `The ${tokens(ig.configured)} autoCompactWindow in ${where} was not honoured: this project compacted at ~${tokens(ig.seen)} `
      + 'after it was set, so it is not quoted as the window. `/autocompact <value>` saves a window for this model in the user settings '
      + 'and applies it to the running session (code.claude.com/docs/en/model-config) - say so to the user once, never claim the old value holds.';
  } catch { return ''; }
}
function modeBanner(autoOn) {
  const model = fresh.sessionModelId();
  // the model's own capacity, never a declared default: with none known, no window is quoted and the trigger is said
  // as ALFRED_CODE_CONTEXT_WINDOW_DEFAULT's
  const window = fresh.tableWindow();
  const room = `its ${window ? `${tokens(window)} ` : ''}context window${model ? ` (${model})` : ''}`;
  const acw = fresh.autoCompactWindow();
  // Claude Code caps an auto-compact window at the model's context window (code.claude.com/docs/en/model-config, 'Set
  // the auto-compact window', verified 2026-10-21), so one past the capacity - a /model switch to a smaller model - is
  // quoted as the capacity it compacts at
  const where = acw && window && acw > window
    ? `as it nears its ${tokens(window)} context window (its ${tokens(acw)} auto-compact window is capped there${model ? `, ${model}` : ''})`
    : acw
      ? `as it nears its ${tokens(acw)} auto-compact window (${window ? `of ${tokens(window)}` : 'context'}${model ? `, ${model}` : ''})`
      : `at Claude Code's own point in ${room}`;
  const name = `/${skill.replace(/^alfred-code:/, '')}`;
  const mode = autoOn
    ? `**Auto-run: ON** for ${name} - every question takes its (Recommended) option without waiting for you; one with no `
      + 'recommended option, or whose recommendation acts outward (push, merge, deploy, publish, a PR), still waits. A message you type mid-run is input to the run; auto-run stays on for this session until you type `/mode-auto-run --mode-auto-run-off`.'
    : `**Auto-run: OFF** for ${name} - each question waits for your answer.`
      + (autoRefused ? ` (auto-run did NOT start: ${autoRefused}.)`
        : autoFlags && autoFlags.late ? ' (mode flags count only right after the command: `--mode-auto-run-on` there starts auto-run.)' : '');
  const at = ctxThreshold();
  const ctxLine = autoOn
    ? `**Context:** no fresh-session hand-off - the session auto-compacts ${where} and the run goes on from the summary and its state files.`
    : COMPACT_INSTEAD
      ? `**Context:** auto-compact is on (ALFRED_CODE_AUTO_COMPACT=1) - the session compacts ${where} instead of offering a fresh session.`
      : FRESH_OFF || at === null
        ? `**Context:** the fresh-session offers are off - the session compacts ${where}.`
        : `**Context:** session refresh - past ~${tokens(at)} tokens ${window ? `of ${room}` : `(ALFRED_CODE_CONTEXT_WINDOW_DEFAULT - the size of ${room} is not known)`}, the run offers to resume in a fresh session from its state file instead of compacting.`;
  const acwNote = acwIgnoredNote();
  return `${acwNote ? `${acwNote}\n\n` : ''}${BANNER_HEAD}\n${mode}\n${ctxLine}`;
}
// Nobody at the terminal is judged WITHOUT the session's own AUTO stamp (a payload with no session id reads none): that
// stamp is the auto-run this banner reports ON, and the person who typed the command is there to read it. A print-mode
// run, ALFRED_CODE_UNATTENDED=1 or a hand-written stamp still reads as nobody.
const banner = EVENT === 'UserPromptExpansion' && !payload.agent_id && BANNER_RE.test(skill) && !unattended({ ...payload, session_id: '' })
  ? modeBanner(Boolean(auto)) : '';
// Every UserPromptExpansion output goes through here, the banner after the text; `leave` is an exit with nothing else to say.
function expansionOut(text) {
  const body = [text, banner].filter(Boolean).join('\n\n');
  if (body) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext: body } }));
}
function leave() {
  if (EVENT === 'UserPromptExpansion') expansionOut('');
  process.exit(0);
}
// The solve flow a /mode-auto-run code change follows by reading it: the library copy the model could load - personal, then
// project, the prelude's order - while skillOverrides leaves it on or user-invocable-only; never the plugin cache's own
// stack/skills source, which is no copy. A copy skillOverrides turns off is said as such (M8), never as not installed.
function solveFlowLine() {
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  let state = 'absent';
  try { state = require('./hook-prelude.js').skillCopyState(root, 'task-solve'); } catch { /* no prelude: none named */ }
  const cfg = process.env.CLAUDE_CONFIG_DIR || nodePath.join(process.env.HOME || process.env.USERPROFILE || '', '.claude');
  const file = state === 'on' || state === 'user-invocable-only'
    ? [nodePath.join(cfg, 'skills', 'task-solve', 'SKILL.md'), nodePath.join(root, '.claude', 'skills', 'task-solve', 'SKILL.md')].find((f) => fs.existsSync(f))
    : null;
  if (file) return `Solve flow: ${file} - on the code route Read it whole and follow it as this run's flow; its references/ and scripts/ paths are under ${nodePath.dirname(file)}.`;
  return state === 'off' ? 'Solve flow: switched off here - a code change goes under Left for you.' : 'Solve flow: not installed here - a code change goes under Left for you.';
}
if (auto && !auto.marker) {
  // a mode line switched auto-run on and opened no run (spec section 6): a flag-only one is said once and does nothing
  // more; one carrying a request (`/mode-output-scorer --mode-auto-run-on <request>`) runs it under the mode (final review I2)
  if (EVENT === 'UserPromptExpansion') expansionOut(auto.kept ? '' : autoFlags && autoFlags.request
    ? `auto-run is ON for this session (${auto.file}) - this line's request runs under it: each ask takes its (Recommended) `
      + 'option; one with no marked option, or whose recommendation acts outward (push, merge, deploy, publish, a PR), waits for the user.'
    : `auto-run is ON for this session (${auto.file}) - no run started: `
      + 'the next task, capture, loop, issue or mode command runs under it, each ask taking its (Recommended) option. Do nothing else for this line.');
  process.exit(0);
}
if (auto) {
  const contract = `auto-run is ON for this /${auto.run} run: auto-run is on for this session (${auto.file} holds the user's words), and ${auto.marker} marks this run. `
    + 'Nobody answers until the run ends. '
    + '(1) Every stop takes its (Recommended) option: an AskUserQuestion whose every question marks one is answered with it by the stop hook, '
    + 'and one carrying a question that marks none - or whose recommended option acts outward (push, merge, deploy, publish, open a PR, post, send, delete a remote, rotate, reset, drop) - waits for the user, so put only those; '
    + "write every AskUserQuestion's questions and labels in English while auto-run is on - the hook reads English only and an ask it cannot read waits for the user - and the rest of the run in the user's language. "
    + `(2) Do not end a turn between steps: the Stop hook sends you back while ${auto.marker} stands. A wait on work this session started is a one-line turn end; the harness wakes you when it lands. `
    + '(3) Commit through the usual gates; never push, merge, deploy or send anything out - list those for the user in the close (an unpushed commit is a Leftovers line, never an ask). '
    + '(4) The fresh-session offers are off and the fresh-session hand-off is never taken or recommended: the session compacts at its auto-compact window and the run goes on from its own state files. '
    + "(5) A leading run of mode flags ('--mode-auto-run-on' and the rest) is mode switches, not a target - leave it out of the run's arguments. "
    + `(6) The stamp is the session's approval: never write an APPROVED or AUTO line over it and never delete it - only the user's --mode-auto-run-off ends auto-run. An answered ask is the go - carry on in the same turn. `
    + `(7) When the whole run is finished, print its close and delete ${auto.marker} if its \`skill:\` line names this run - that ends this run; auto-run stays on for the session until --mode-auto-run-off. `
    + `(8) A message the user types mid-run is input to the run: take it in and carry on; if it asks to stop the run, print its close and delete ${auto.marker}.`
    + (AUTO_SELF_RE.test(auto.run) ? ` ${solveFlowLine()}` : '');
  if (EVENT === 'UserPromptExpansion') expansionOut(contract);
  else process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: contract } }));
  process.exit(0);
}
// M7: a refused /mode-auto-run start offers no fresh session - nothing runs, so there is nothing to resume; nor does a
// /mode-auto-run line with no request, which only flips a switch (final review I3)
if (EVENT === 'UserPromptExpansion' && AUTO_SELF_RE.test(skill) && (autoRefused || (!auto && autoFlags && !autoFlags.request))) leave();
if (IS_SKILL_CALL && (EVENT === 'PreToolUse' || !EVENT)) gatedStepHold();

if (EVENT !== 'SessionStart' && !isOrchestration(skill)) leave();

// SessionStart carries no run name and nothing measurable - the transcript has just been REPLACED
// by its summary - so the compaction event itself is the evidence, and the offer goes out on it.
if (EVENT === 'SessionStart') {
  if (String(payload.source || '') !== 'compact') process.exit(0);
  const pointer = compactPointer();
  const boundary = boundaryPreTokens();
  // The boundary row's own measurement of where the harness compacted (fresh-session.js observedCompaction).
  if (boundary && boundary.trigger === 'auto' && boundary.preTokens) recordCompaction(boundary.preTokens);
  // a configured window this compaction (or an earlier one) shows was not honoured is said here, once (C10)
  const acwNote = acwIgnoredNote();
  const withNote = (t) => (acwNote ? (t ? `${t} ${acwNote}` : acwNote) : t);
  // Nobody at the terminal (hook-prelude.js unattended) has nobody to ask: the pointer, never the offer - and the
  // skipped offer leaves its row (review A, M3). A compaction the USER asked for (`/compact`) is no ceiling reached.
  const quiet = !FRESH_OFF && unattended(payload);
  if (quiet) ledgerRow({ mode: 'unattended', kind: 'compact-offer', reason: UNATTENDED_SKIP });
  const manual = !!boundary && boundary.trigger === 'manual';
  const after = 'Two more things for the moment after a compaction. The summary above is the harness' + String.fromCharCode(39) + 's own ' +
    'and it is in English: keep answering in the language of the user' + String.fromCharCode(39) + 's own prompts, unless a loaded skill or the personal preferences doc (PERSONAL-PREFERENCES.md) sets the answer language (measured: ' +
    'two sessions switched to English right after compacting). And when a plan or state file is ' +
    'live, re-read its HEADER first - it holds the anchors and the next step - before re-orienting ' +
    'from the code (measured: a resume grepped the tree and read a 10k-char source range before ' +
    'opening the plan whose header already named the ranges).' + (pointer ? ` ${pointer}` : '');
  if (FRESH_OFF || quiet || manual) {
    // Compacting IS this project's answer to a full context (fresh-session.js COMPACT_INSTEAD): the summary's own
    // 'continue' line stands, and the two notes after it still apply.
    const text = withNote(manual ? after : COMPACT_INSTEAD ? `${COMPACT_NOTE} Continue the work from the summary. ${after}` : pointer);
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
    process.exit(0);
  }
  // The one-shot hold the first changing call meets (compactHold, above), keyed by the transcript's size now: an ask
  // answered past it releases it.
  try {
    fs.writeFileSync(compactHoldFile(), JSON.stringify({ at: new Date().toISOString(), size: fresh.transcriptSize(), denied: 0 }));
    sweepOffers();
  } catch { /* no hold - the injection below still goes out */ }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'This session just AUTO-COMPACTED, which means it reached the point where the harness compacts ' +
        'and the harness - not the user - decided what to drop. The summary closes by telling you to continue ' +
        String.fromCharCode(39) + 'without asking the user any further questions' + String.fromCharCode(39) + ' - that is the harness' + String.fromCharCode(39) + 's ' +
        'default line, and this hook supersedes it. Your first change after the compaction (an edit, a shell command, a ' +
        'dispatch) is checked against this session' + String.fromCharCode(39) + 's measured context and its own first message: when a ' +
        'fresh session would recover a real share, the change is held and the hold names both numbers for ONE ' +
        'AskUserQuestion - resume in a fresh session (recommended - end this turn with the paste-ready invocation and ' +
        'the state file or plan file it resumes from), or continue here on the summary; when it would recover too ' +
        'little the change goes through and you continue here. Never put the choice without those two numbers. If ' +
        'the remaining work is a single short step, say so in one line (' + String.fromCharCode(39) + 'single short step: <what>' + String.fromCharCode(39) + ') and just finish it. ' +
        withNote(after),
    },
  }));
  process.exit(0);
}

// Context comes from the last assistant message's usage, same source the stop contract uses: a
// `<synthetic>` row's zero usage is skipped, and a last row bigger than the window retries over 8MB.
function lastUsage(tail = 512 * 1024) {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - tail);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let usage = null;
    for (const line of buf.toString('utf8').split('\n')) {
      // the usage above a compaction boundary is the pre-compaction context (audit 2026-10-10 C08)
      if (line.includes('"compact_boundary"') && /"subtype"\s*:\s*"compact_boundary"/.test(line)) { usage = null; continue; }
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'assistant' && o.message && o.message.usage && o.message.model !== '<synthetic>') usage = o.message.usage;
      } catch { /* partial first line of the tail window - skip */ }
    }
    if (!usage && start > 0 && tail < 8 * 1024 * 1024) return lastUsage(8 * 1024 * 1024);
    return usage;
  } catch {
    return null;
  }
}
// --- a PRIOR deliberate run in this session is its own trigger ----------------------------
// The size trigger alone missed the measured shape: four deliberate flows chained with zero
// `/clear` boundaries, 199.1k average context per message for well under 30k of actual tool
// output, and not one of them was gated - each run STARTED under the threshold and crossed it only
// while running, by which time the history the next run re-sends is already the bill. So a SECOND
// deliberate run carries its own evidence - a previous run's own marker in this session's
// transcript - and the offer fires at ANY context size. The size trigger stays for the single-run
// case. Completion is deliberately NOT required: a prior run still in flight makes the case for a
// fresh session stronger, not weaker. What IS required is a human turn between the two, so a run
// re-entering its own skill mid-flight is never read as a second run.
const CHAIN_TAIL = 8 * 1024 * 1024;   // measured over the audited corpus: p90 transcript 0.7MB, largest 10.6MB
// A `user` record the harness wrote is not the user speaking. Measured 2026-09-14: a slash skill's
// own body lands as an `isMeta` user record on the very next line, so every run's FIRST sub-skill
// call read its own start as a prior run and offered a fresh session inside a fresh session.
// The other harness-written kinds in the corpus: compact summaries, local-command output and
// task notifications.
function isHumanTurn(line) {
  let row;
  try { row = JSON.parse(line); } catch { return false; }
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return false;
  const c = row.message && row.message.content;
  const t = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find((x) => x && x.type === 'text') || {}).text || '' : '');
  return !/^\s*<(local-command-stdout|local-command-caveat|task-notification)>/.test(t);
}
function priorOrchestrationRun() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - CHAIN_TAIL);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    // A RUN is what the user typed: the slash route's `<command-name>` marker in a HUMAN turn's own
    // prompt. The marker as text anywhere else is not a run - measured 2026-09-15, 28 of 73 markers
    // in the corpus sat in tool results (a `sed` over a test file, a transcript dump), and one
    // replayed session was offered a fresh session for a run nobody typed. A `Skill` tool_use is
    // NOT a run either: a solve flow calls its own phases (solution-design, implementer,
    // verify-code) that way, and its approval step puts a human turn between them, so counting them
    // read ONE gated cycle as a chain (measured 2026-09-14: the build step of a single cycle was
    // offered a fresh session).
    const re = /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/;
    // ONE test does both jobs: an earlier run counts only when a HUMAN turn follows it - a `user`
    // record that is not a tool_result. That excludes the prompt being judged whether or not its row
    // is on disk yet, because nothing human follows it - and when it is NOT (UserPromptExpansion fires
    // as the command expands), the command being judged is itself the human turn after the last
    // answered run, which the return below counts. It also keeps the SAME command chained twice,
    // which matching the last hit by NAME did not.
    // ...and a typed marker is not a RUN until the model answered it. Measured (AUDIT/_tools/
    // dupslash.js): 7 of 115 sessions re-submitted an orchestration command before any assistant
    // turn - a mis-typed or superseded command, or a double submit 3-4s apart - and the human turn
    // that followed made this read the abandoned one as a finished prior run. Worst case: a fresh
    // post-`/clear` build resume was told to start a fresh session, the user rejected the ask and
    // quit with 0 of 2 tasks built and 100% of the session's 86.7k tokens spent on the detour. So
    // the marker needs a real ASSISTANT turn between it and the next human turn: a run nobody
    // answered carried no history for the next run to re-send, which is the whole cost this
    // trigger is about.
    // ...and an answer is not a RUN until it WORKED: audit 2026-10-20 C13, 24841a36 - the model gate's one-line refusal
    // ('switch to Sonnet and run it again'), after a single probe call, read as a finished run and the re-typed command was
    // told to start a fresh session. A run counts once its answer made RUN_MIN_CALLS tool calls, the whole run's calls
    // counted across the human turns inside it; an ask is a call, so a run that stopped to ask and went on still counts.
    const RUN_MIN_CALLS = 2;
    let seenRun = false;
    let calls = 0;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      // A row that carries BOTH type strings is a user row quoting a transcript, not an answer:
      // it is skipped, which errs toward making no offer - the direction the measured harm was in.
      if (seenRun && /"type"\s*:\s*"assistant"/.test(line) && !/"type"\s*:\s*"user"/.test(line)
          && !/"model"\s*:\s*"<synthetic>"/.test(line)) {
        calls += (line.match(/"type"\s*:\s*"tool_use"/g) || []).length;
        continue;
      }
      if (!line.includes('"type":"user"') || line.includes('"tool_result"') || !isHumanTurn(line)) continue;
      if (seenRun && calls >= RUN_MIN_CALLS) return true;
      const c = (JSON.parse(line).message || {}).content;
      const m = re.exec(typeof c === 'string' ? c : (Array.isArray(c) ? c.map((x) => (x && x.type === 'text' && x.text) || '').join('\n') : ''));
      if (m && isOrchestration(m[1])) { seenRun = true; calls = 0; }
    }
    // The command being judged, not on disk yet, is the human turn after an answered run.
    return EVENT === 'UserPromptExpansion' && seenRun && calls >= RUN_MIN_CALLS;
  } catch {
    return false;   // unreadable transcript - the size trigger still covers this session
  }
}
// ONE chained offer per session: once the user has answered it, a retry of the same run goes
// through. This trigger has no number to grow, so repeating it would only print an answered
// question again.
function compactNoteFile() {
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return nodePath.join(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), `guard-fresh-compactnote-${key}.said`);
}
function chainedOfferFile() {
  const os = require('os');
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${envOf(process.env, 'HOOK_LOG_DIR') || os.tmpdir()}/guard-fresh-chained-${key}.offered`;
}
// The chained offer is SPENT only once an ask was answered after it, like the size offer: the file records the
// transcript's size when it was injected (`size <n>`). Written at injection alone, an offer injected on a prompt the
// client double-submitted landed on the abandoned branch and silenced the live one (audit 2026-10-10 C09, ca65b406:
// 53 messages on cycle 1's history, ~9.3M of 35.1M cache-read). A file from before this line carries no size: spent.
function chainedOfferSpent() {
  let text;
  try { text = fs.readFileSync(chainedOfferFile(), 'utf8'); } catch { return false; }
  const m = /^size (\d+)/.exec(text.trim());
  return !m || fresh.askAnsweredSince(parseInt(m[1], 10));
}
// The SIZE offer's re-arm. The denial mandates an AskUserQuestion whose second answer is 'run it
// here anyway with the cost stated' - and until 0.2.74 nothing honoured that answer: no receipt, no
// state, no re-arm, so the retry re-blocked on the identical call and the route the guard itself
// offered was a route the guard denied (measured 2026-09-12: the same Skill call replayed twice,
// exit 2 both times). That is the failure DISCARD-ALLOW was bought for on the rm guard and
// CROSS-WRITE-ALLOW on the cross-project guard. The sibling `guard-stop-contract.js` already solved
// it for its own fresh-session offer with exactly this shape, so this is the shape used here:
// record the context the offer was made at, and stay silent until the context has grown REOFFER_GROWTH
// times past it. An answered question is not re-asked; a run that has since doubled its carry is a
// new question, because the number the offer is about has changed.
const REOFFER_GROWTH = 1.5;
function sizeOfferFile() {
  const os = require('os');
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${envOf(process.env, 'HOOK_LOG_DIR') || os.tmpdir()}/guard-fresh-size-${key}.offered`;
}
// The offer file holds the context it was made at and the transcript's size then: the offer counts as ANSWERED only
// once an ask was answered past that size. Written at the deny alone, the identical retry passed with no ask between
// (audit 2026-10-08, replayed 2 then 0). A file from before this line carries no size and reads as answered.
function sizeOfferedAt() {
  try { return parseInt(fs.readFileSync(sizeOfferFile(), 'utf8'), 10) || 0; } catch { return 0; }
}
function sizeOfferAnswered() {
  try {
    const at = fs.readFileSync(sizeOfferFile(), 'utf8').trim().split(/\s+/)[1];
    return at === undefined || fresh.askAnsweredSince(parseInt(at, 10) || 0);
  } catch { return true; }
}
function recordSizeOffer(ctx) {
  try { fs.writeFileSync(sizeOfferFile(), `${ctx} ${fresh.transcriptSize()}`); } catch { /* never let state break the gate */ }
  sweepOffers();
}
// State hygiene when an offer is written (hook-prelude.js sweepStale, audit 2026-10-08 S9): offers past 7 days go.
function sweepOffers() {
  try {
    const pre = require('./hook-prelude.js');
    if (typeof pre.sweepStale === 'function') pre.sweepStale(envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir(), 'guard-fresh-');
  } catch { /* no prelude: nothing swept */ }
}

// A SUBAGENT's Skill call (the payload carries agent_id) is a phase of work its parent dispatched:
// the carry read here is the parent session's, and a seat has no user to answer the offer - so
// neither trigger judges it.
if (payload.agent_id) leave();
// COMPACT INSTEAD: no offer is made here, and the run is told once per session - its own stop asks offer the
// fresh-session hand-off past the trigger, and the stop contract denies an ask that still carries one.
if (COMPACT_INSTEAD) {
  let first = true;
  try { fs.writeFileSync(compactNoteFile(), new Date().toISOString(), { flag: 'wx' }); sweepOffers(); } catch (e) { first = !(e && e.code === 'EEXIST'); }
  const note = first ? `${COMPACT_NOTE} So /${skill} puts no fresh-session option in any ask and never ends a turn to move to a new session.` : '';
  if (EVENT === 'UserPromptExpansion') expansionOut(note);
  else if (note) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } }));
  process.exit(0);
}
const usage = lastUsage();
// A session with no readable usage has ctx 0: the size trigger cannot fire, the chained one still can.
const ctx = usage
  ? (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0)
  : 0;
const FRESH_AT = ctxThreshold();   // null = this window's trigger is switched off
// Both triggers are subject to the same question - what a resume would actually recover - so the
// gate and the offer can never sit on different arithmetic in one session.
const sizeAlreadyOffered = sizeOfferedAt();
// An offer stands until an ask answers it; an ask THIS turn that already put the fresh-session choice to the user
// (task-solve's stop asks carry it) is that answer for the phase Skill call that follows (audit 2026-10-08).
const overSize = !FRESH_OFF && FRESH_AT !== null && ctx > FRESH_AT && worthResuming(ctx)
  && (!sizeAlreadyOffered || !sizeOfferAnswered() || ctx >= sizeAlreadyOffered * REOFFER_GROWTH)
  && !(IS_SKILL_CALL && fresh.freshAskAnsweredThisTurn());
// The chained trigger judges only a run the user TYPED (the slash route); a Skill call is a phase
// of a run already in flight, and the size trigger still covers that route.
const chained = EVENT === 'UserPromptExpansion' && !FRESH_OFF && !overSize && worthResuming(ctx)
  && !chainedOfferSpent() && priorOrchestrationRun();
if (!overSize && !chained) leave();
// Nobody at the terminal (hook-prelude.js unattended) has nobody to offer it to: one row, and no offer state is
// spent, so a person resuming the session later is still offered it (review A, M3).
if (unattended(payload)) {
  ledgerRow({ mode: 'unattended', kind: chained ? 'chained-offer' : 'size-offer', reason: UNATTENDED_SKIP, detail: { skill, ctx } });
  leave();
}
if (chained) {
  try { fs.writeFileSync(chainedOfferFile(), `size ${fresh.transcriptSize()} ${new Date().toISOString()}`); } catch { /* never let state break the gate */ }
  sweepOffers();
}
// Written on BOTH routes. The slash route injects rather than denies, but it is the same offer to
// the same user about the same number, so answering it there must silence the Skill route too.
if (overSize) recordSizeOffer(ctx);

const why = chained
  ? `is a deliberate orchestration run and this session has ALREADY run one - every turn of the\n`
    + `new run re-sends the finished run's whole history (measured: four flows chained with no\n`
    + `/clear boundary drove 199.1k tokens per message for under 30k of actual tool output).`
    // the session's own number, as the size variant states it - an ask that said 'size unmeasured' two seconds after the
    // size variant had quoted ~404k (audit 2026-10-10 C09, c6142301)
    + (ctx > 0 ? `\nThis session already carries ~${Math.round(ctx / 1000)}k tokens per message.` : '')
  : `is a deliberate orchestration run and this session already carries ~${Math.round(ctx / 1000)}k tokens\n`
    + `per message of another run's history - every turn of the new run re-sends all of it\n`
    + `(measured: the same step cost 260k/message chained vs 134k fresh).`;

// The slash route only ADDS context - a blocked expansion shows its reason to the user, not the
// model - so it states the same thing as an instruction and lets the model ask.
if (EVENT === 'UserPromptExpansion') {
  expansionOut(
    `/${skill} ${why.replace(/\n/g, ' ')} ` +
    `Do NOT start the run yet. Put it to the user as ONE AskUserQuestion: start it in a fresh ` +
    `session (recommended - end this turn with the paste-ready invocation and the state file it ` +
    `resumes from), or run it here anyway with the cost stated.`,
  );
  process.exit(0);
}

process.stderr.write(
  `Blocked: ${skill} ${why}\n`
  + `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n`
  + `this turn with the paste-ready invocation and the state file it resumes from), or run it\n`
  + `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
