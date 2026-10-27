#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// The short-answer contract (alfred-interaction.md: 'at most 3 sentences plus points', 'if the
// user wants deeper detail they will ask') failed as prose the same way every other house mandate
// did: the user re-asked for it as a BRAND NEW rule while both rule copies carried it verbatim,
// and the memory record holds four separate 'you write too much text' / 'shorter and simpler'
// corrections across sessions. Prose guards measured ignored 1/5-1/3 of the time; mechanisms held.
// This hook is the mechanization.
//
// UserPromptSubmit wiring: appends the answer budget to the turn's context, where it lands LAST -
//   immediately before the answer is written, not 30 bullets deep in an always-on rule. It also
//   carries the FORMAT ASK on a correction streak: the third consecutive short human turn that
//   follows a long answer gets one line naming the interaction rule's 're-ask on the SAME
//   deliverable -> ONE format AskUserQuestion' - injection only, never a denial. Measured lost as
//   prose: nine corrections and nine redrafts of one report, 1.64M cache-read, no ask. And it writes
//   the CORRECTION probe: one ledger row per correction turn (ALFRED_CODE_CORRECTION_NUDGE, seeded
//   `log`; `inject` adds the save line).
//   And the modes' lines (stack-modes spec section 3): `--mode-output-scorer-on|off` in a family command's leading run
//   switch the scorer for the session, an on line names what to grade, a typed stack gets the stacked line - the state is
//   the prelude's, shared with the stop contract; while auto-run is on, its line; and the user-visible ON line, a
//   `systemMessage` listing the modes on.
// No Stop wiring since 2026-10-20 (the user's ruling): the length cap and the em-dash block at Stop are gone - the
//   answer budget is the interaction rule's, injected here, never enforced by a block.
// SessionStart:compact wiring: re-emits the budget (and the modes' context lines, never the ON line) as additionalContext after a compaction, which drops the
//   UserPromptSubmit injection; startup, resume and clear get it from the first prompt (deep hooks review 2026-10-16).
// PostToolUse AskUserQuestion wiring: an answer typed into an ask's Other field is the user speaking through a tool
//   result - one probe row, the correction test over it, and a note to open a path it names (audit 2026-10-10 C15).
// Never blocks: every route exits 0. Fail-open on anything unparseable.
const fs = require('fs');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let harnessPrompt = (prompt) => /^\s*<task-notification>/.test(String(prompt || ''));   // hook-prelude.js harnessPrompt
let scorer = null;   // the prelude, for the modes' state and lines - no prelude, no scorer, no auto-run line, no ON line (R32)
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    harnessPrompt = prelude.harnessPrompt || harnessPrompt;
    if (prelude.scorerState) scorer = prelude;
    if (prelude.standDown('guard-answer')) process.exit(0);
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

const BUDGET = 900; // soft: ~3 sentences plus points, the rule's own shape

// --- transcript tail (last ~512KB): the final assistant message and the user's last real turn ---
function tailLines() {
  const p = payload.transcript_path;
  if (!p) return [];
  const size = fs.statSync(p).size;
  const start = Math.max(0, size - 512 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8').split('\n');
}

// Prose only: code blocks, tables, inline spans and link targets are the parts a short answer is
// allowed to be long in - they carry the payload, not the talking.
function proseOf(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

// The budget text, one copy for both routes that inject it.
// The rule (alfred-interaction.md) is the budget's home, cached once; this per-turn copy carries only the delta that
// needs the last-position slot (audit 2026-10-14 RU06: the full 751-char text rode every prompt and session start, saved
// in the transcript each turn - ~22.5K chars over a 30-turn session).
const BUDGET_TEXT =
        `Answer budget (alfred-interaction.md): 3 sentences plus bullets, ~${BUDGET} characters of prose, result first; fit it before sending. ` +
        `Code, tables and command output are exempt. Only THIS message's depth words lift it (in detail / walk me ` +
        `through / step by step / teach me / ELI5 / write a plan), and an entry of the user's personal preferences doc sets it. Single dashes and single quotes, an ` +
        `AskUserQuestion's text included.`;

// --- the correction streak: N short human turns in a row, each right after a long answer -----
// The interaction rule says a re-ask on the SAME deliverable is ONE format AskUserQuestion, not
// another redraft. It shipped as prose and lost: nine corrections, nine redrafts, 1.64M cache-read,
// no ask. The detector is tuned on that one session - three short turns (under 200 chars), each
// following an assistant answer over 1,500 chars of prose - and it only INJECTS a line, so a wrong
// guess costs one sentence of context, never a turn. Watched for a week before it grows.
const STREAK_TURNS = 3;
const STREAK_SHORT = 200;
const STREAK_LONG = 1500;
// In order: { role, len } - assistant rows merged by message.id, prose only; a user turn also keeps
// its text, and an interruption row is marked, because it sits between an answer and its correction.
function conversationTurns() {
  const turns = [];
  let lastId = null;
  let lastUserText = '';
  for (const line of tailLines()) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || !o.message) continue;
    if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      const text = o.message.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
      const len = proseOf(text).length;
      const id = o.message.id;
      const prev = turns[turns.length - 1];
      if (id && id === lastId && prev && prev.role === 'assistant') prev.len += len;
      else turns.push({ role: 'assistant', len });
      lastId = id || null;
    } else if (o.type === 'user' && !o.isMeta) {
      const c = o.message.content;
      const typed = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      // tool results, harness markers and slash commands are not corrections
      if (!typed.trim() || /^\s*</.test(typed)) continue;
      lastUserText = typed.trim();
      turns.push({ role: 'user', len: lastUserText.length, text: lastUserText, interrupt: /^\[Request interrupted by user/.test(lastUserText) });
    }
  }
  return { turns, lastUserText };
}
function correctionStreak(currentPrompt) {
  try {
    const { turns, lastUserText } = conversationTurns();
    // the prompt being submitted is the last turn - unless the transcript already holds it
    const now = String(currentPrompt || '').trim();
    if (now && now !== lastUserText && !/^</.test(now)) turns.push({ role: 'user', len: now.length });
    let streak = 0;
    for (let i = turns.length - 1; i >= 1; i -= 2) {
      const u = turns[i];
      const a = turns[i - 1];
      if (u.role !== 'user' || a.role !== 'assistant' || u.len === 0 || u.len > STREAK_SHORT || a.len < STREAK_LONG) break;
      streak += 1;
    }
    return streak;
  } catch { return 0; }
}

// --- correction-turn test (the one single-turn test; analyze-usage.js carries the pinned copy) ---
// The old test was a SHAPE - a short turn right after a 1,500+ char answer - so it counted whatever
// the user said next: replayed over the local transcripts, 51 of its 60 hits were status checks,
// questions and requests (and it missed the corrections that followed a short answer). A correction
// is now a short typed turn that follows an answer of any length AND carries a correction marker -
// in-sample, 3 of the replay's 52 hits were not corrections. A STRONG marker counts anywhere; a WEAK
// one (an opening 'but', 'instead', 'it should') only in a turn that asks nothing, where it is a
// correction rather than a challenge. 'why can't you' is a question about a limit, not a correction.
// Audit 2026-10-20 C20: 'why you' after an explain verb ('Explain why you chose X', 4a210c3c) asks for an explanation,
// and a 'not working' / 'doesn't work' inside a stated reason ('push without ci, because it's not working', 3a8a1ee3) is
// the user's remark about their own system - neither counts.
const CORRECTION_STRONG_RE = /^\W*(?:no|nope|nah|wrong|incorrect|not (?:that|this|what|quite|like that|right|correct)|undo|revert|roll ?back)\b|(?:^|[.,;:!?]\s*|\b(?:but|and|please|pls|so|then|also|just)\s+)(?:do not|don'?t|dont|never|stop \w+ing)\b|\byou (?:did not|didn'?t|didnt|have not|haven'?t|havent|should not|shouldn'?t|forgot|missed|ignored|broke|skipped|removed|deleted|dropped|lost|said|told)\b|(?<!\b(?:explain|describe|tell me|show me|clarify|walk me through)\b[^.!?\n]{0,40})\bwhy (?:did |do |are |have |haven'?t |didn'?t |would |were )?you\b(?! (?:cannot|can'?t|can not|couldn'?t)\b)|\bi (?:said|asked|told you|meant|wanted|did not ask|didn'?t ask|never asked|already (?:said|told|asked))\b|\b(?:still|again) (?:there|broken|fail\w*|wrong|the same|red|happen\w*|error\w*|doesn'?t|does not|isn'?t|is not|not)\b|\bsame (?:error|issue|problem|bug)\b|\b(?:that'?s|that is|this is|it'?s|it is) (?:wrong|incorrect|not (?:right|correct|what|how|it))\b|\bnot what i\b|\bi (?:do not|don'?t|dont|did not|didn'?t) (?:want|need|like)\b|(?<!\b(?:because|cause|coz|cuz)\b[^.,!?\n]{0,40})(?:\b(?:does not|doesn'?t|did not|didn'?t) (?:fit|work|help|make sense)\b|\bnot working\b)|\b(?:too (?:long|much text|verbose|many words|complicated|complex)|a lot of text|less text|shorter|simpler|more concise)\b/i;
const CORRECTION_WEAK_RE = /^\W*but\b|^\W*(?:ok(?:ay)?|yes|yeah|fine|sure|good|right)\b\W*but\b|^\W*stop\b|\binstead\b|(?<!\b(?:what|which|how|whether|where|when|who|why)\b[^.,;:!?\n]{0,60})\b(?:it|this|that|they|these|those|there) should(?:n'?t| not| have| be| stay| use| go)\b/i;
function correctionMarker(text) {
  const t = String(text || '').replace(/[‘’]/g, "'").trim();
  const m = t.match(CORRECTION_STRONG_RE) || (!t.includes('?') && t.match(CORRECTION_WEAK_RE));
  return m ? m[0].trim().slice(0, 40) : null;
}
// --- end correction-turn test

// The prompt being submitted, judged by the test above: it follows an assistant answer (an
// interruption row between them does not count) and is a typed turn of at most STREAK_SHORT chars.
function correctionTurn(currentPrompt) {
  try {
    const now = String(currentPrompt || '').trim();
    if (!now || now.length > STREAK_SHORT || /^[</]/.test(now)) return null;
    const marker = correctionMarker(now);
    if (!marker) return null;
    const { turns } = conversationTurns();
    let end = turns.length;
    if (end && turns[end - 1].role === 'user' && turns[end - 1].text === now) end -= 1; // the prompt's own row
    for (let i = end - 1; i >= 0; i -= 1) {
      if (turns[i].role === 'assistant') return marker;
      if (!turns[i].interrupt) return null;
    }
    return null;
  } catch { return null; }
}

// One MEASUREMENT row in the hook-blocks ledger (a `mode`, so the analyzer reads a probe, never a
// block). Best-effort - a lost row is a lost measurement, never a changed turn.
function ledgerRow(row) {
  try {
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = (() => { try { return require('./layout.js').statsPath(root, ['hook-blocks']); } catch { return path.resolve(root, docsRootEnv(), 'hook-blocks'); } })();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: path.basename(__filename), event: payload.hook_event_name || '', tool: '', ...row,
    }) + '\n');
  } catch { /* never throws */ }
}

// --- the verbatim re-ask: the same question, typed again ------------------------------------
// Measured in three sessions of one day: the user re-sent an identical question 2-3 times (one of
// them escalating /model and /effort between the tries) before the run recognized the
// miscommunication and asked what was meant. 'Ambiguous goal: ask' was loaded, verbatim, in the
// session that took three. A repeat is evidence the last answer missed the goal, not evidence the
// answer needs to be longer - so the FIRST repeat is the signal.
// Only the last typed turn is compared, and only a prompt long enough to be a question: a repeated
// 'continue' / 'go on' is pacing. The prompt row is already on disk when this hook fires, so a
// trailing copy of the prompt itself is dropped before the comparison - otherwise every turn would
// read as its own repeat.
const REPEAT_MIN_CHARS = 15;
function repeatsLastPrompt(currentPrompt) {
  try {
    const now = String(currentPrompt || '').trim();
    if (now.length < REPEAT_MIN_CHARS || /^\s*[</]/.test(now)) return false;
    const typed = [];
    let answered = true;   // has an assistant row followed the last typed turn?
    for (const line of tailLines()) {
      if (!line.includes('"user"') && !line.includes('"assistant"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || !o.message) continue;
      if (o.type === 'assistant') { answered = true; continue; }
      if (o.type !== 'user' || o.isMeta) continue;
      const c = o.message.content;
      const t = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      if (!t.trim() || /^\s*[</]/.test(t.trim())) continue;
      typed.push(t.trim());
      answered = false;
    }
    // The prompt row is written BEFORE this hook fires on some builds and after it on others. It is
    // this turn's own row exactly when no assistant row follows it - that trailing copy is dropped,
    // or every turn would read as its own repeat.
    if (!answered && typed.length && typed[typed.length - 1] === now) typed.pop();
    return typed.length > 0 && typed[typed.length - 1] === now;
  } catch { return false; }
}

// --- the answer TYPED into an ask (audit 2026-10-10 C15 / C07) ----------------------------------------------------
// An answer written into an AskUserQuestion's Other field is the user speaking, but it arrives as a tool result, so the
// prompt-time readers above never saw it: two corrections typed there ('Why you bother me ... Right now!') logged no
// correction row and the session's lesson never reached memory (4f1c2ebb), a project fact typed there was neither logged
// nor saved (8f44a003), and an answer naming a folder was re-read as the hand-off destination and never opened
// (69dbed46). So each answer that matches none of the offered labels writes one `ask-answer-typed` row, a short one
// carrying a correction marker also writes the `correction` row (the same test, the same nudge mode), and one naming a
// path gets a note to open it and restate what it changes before acting. Log and inject only - it never blocks.
const PATH_IN_ANSWER_RE = /(?:^|[\s'"(`])((?:~|\.{1,2})?\/?(?:[\w.@-]+\/){2,}[\w.@-]*)/;
// The save line both correction routes inject. A correction often carries a PROJECT FACT (audit 2026-10-10, T5
// cross-track, 84eedb4b: 'api from develop is for current version' - a branch pairing acted on, never stored) or a stated
// preference (audit 2026-10-11 SD16, session ce9d4811: 'I do not want it global but per project scope' was never stored and
// restated 3 minutes later). The stack depends on no memory server since 2026-10-24, so the line names the two homes that
// outlast the session: the preferences docs for how the user wants the work done, Claude Code's own memory for the rest.
const SAVE_LINE = 'keep what it teaches before continuing - a preference it states (\'per project, never global\') as an entry '
  + 'in the preferences docs (/capture-preferences), and the lesson or a project fact it states (a branch, an environment, a '
  + 'version pairing) in Claude Code\'s own memory';
function typedAnswers(p) {
  const questions = Array.isArray(p.tool_input && p.tool_input.questions) ? p.tool_input.questions : [];
  let answers = p.tool_response && typeof p.tool_response === 'object' && p.tool_response.answers && typeof p.tool_response.answers === 'object'
    ? p.tool_response.answers : null;
  if (!answers) {
    // the text form: The user answered: "Q"="A" (one pair per question)
    const t = typeof p.tool_response === 'string' ? p.tool_response : JSON.stringify(p.tool_response || '');
    answers = {};
    for (const m of t.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) answers[m[1]] = m[2];
  }
  const out = [];
  for (const [q, a] of Object.entries(answers)) {
    const answer = String(a || '').trim();
    if (!answer) continue;
    const spec = questions.find((x) => x && String(x.question || '').trim() === q.trim());
    const labels = new Set(((spec && spec.options) || []).map((o) => String((o && o.label) || '').trim()));
    const parts = spec && spec.multiSelect ? answer.split(/,\s*/) : [answer];
    if (labels.size && parts.every((x) => labels.has(x.trim()))) continue;
    out.push({ question: q, answer });
  }
  return out;
}
// An ask the idle timeout closed is no answer (ruling S3, hook-prelude.js `askTimedOut`): the session's timeout marker is
// written, one `ask-timeout` probe row, and a note that the run may go on on its own judgment but holds no approval -
// the dispatch guard denies the next implementer dispatch on a stamp written after it, once. An answered ask, or a
// typed prompt, clears the marker.
const ASK_TIMEOUT_NOTE = 'The question above timed out - nobody answered it (Claude Code closed the idle dialog). '
  + 'It is no answer: no approval, no consent, no pick. Go on only with steps that need no decision; never write an '
  + 'APPROVAL or AUTO stamp, commit or dispatch on it - re-ask when the user is back.';
const timeoutMarker = () => { try { const p = require('./hook-prelude.js'); return typeof p.askTimeoutMarker === 'function' ? p.askTimeoutMarker(payload.session_id) : null; } catch { return null; } };
const askTimedOut = (r) => { try { const p = require('./hook-prelude.js'); return typeof p.askTimedOut === 'function' && p.askTimedOut(r); } catch { return false; } };
if (payload.hook_event_name === 'PostToolUse' && payload.tool_name === 'AskUserQuestion' && askTimedOut(payload.tool_response)) {
  const marker = timeoutMarker();
  try { if (marker) fs.writeFileSync(marker, new Date().toISOString()); } catch { /* a dir that takes no marker: the note still goes */ }
  ledgerRow({ mode: 'probe', kind: 'ask-timeout', reason: 'probe: an ask closed by the idle timeout - no answer',
    detail: { afkTimeoutMs: Number(payload.tool_response && payload.tool_response.afkTimeoutMs) || null } });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ASK_TIMEOUT_NOTE } }));
  process.exit(0);
}
const clearTimeoutMarker = () => { const m = timeoutMarker(); try { if (m) fs.rmSync(m, { force: true }); } catch { /* fail-open */ } };
if (payload.hook_event_name === 'PostToolUse' && payload.tool_name === 'AskUserQuestion') {
  clearTimeoutMarker();
  const typed = (() => { try { return typedAnswers(payload); } catch { return []; } })();
  if (!typed.length) process.exit(0);
  const nudgeMode = String(envOf(process.env, 'CORRECTION_NUDGE') || 'log').trim().toLowerCase();
  const notes = [];
  for (const { answer } of typed) {
    const marker = nudgeMode === '0' || nudgeMode === 'off' || answer.length > STREAK_SHORT ? null : correctionMarker(answer);
    // a URL is no path to open
    const named = (answer.replace(/\b\w+:\/\/\S+/g, ' ').match(PATH_IN_ANSWER_RE) || [])[1] || null;
    ledgerRow({ mode: 'probe', kind: 'ask-answer-typed', reason: 'probe: an ask answered in its own words, not an offered label',
      detail: { chars: answer.length, correction: marker, path: !!named } });
    if (marker) {
      const inject = nudgeMode === 'inject';
      ledgerRow({ mode: 'probe', kind: 'correction', injected: inject, reason: `probe: a correction typed into an ask - ${inject ? 'save line injected' : 'logged, nothing injected'}`,
        detail: { marker, chars: answer.length, via: 'ask-answer' } });
      if (inject) notes.push(`CORRECTION: the answer typed into the ask reads as a correction - ${SAVE_LINE}`);
    }
    if (named) {
      notes.push(`The answer typed into the ask names a path (${named}). Open it before acting, and restate in visible text, one sentence, what the answer changes - a typed answer is often a redirect, and one naming a folder was re-read as a hand-off destination and never opened.`);
    }
  }
  if (notes.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join(' ') } }));
  process.exit(0);
}

// --- the modes (stack-modes spec section 3): the session's flags and the lines that name them ----------------------
// The prompt's own flags count only in a family command's leading run (hook-prelude.js modeFlags). A mode's state for
// this prompt is that flag, else the stored state - computed here, never read back after the start hook's write, since
// the two hooks run in parallel: auto-run's -on counts only when autoRunRefusal says '', else the stamp live for this
// session decides; the scorer's flag writes the session's SCORER- file, which outranks ALFRED_CODE_SCORER. A seat's
// prompt and a missing prelude carry no line. Each line rides after the budget with one leading space.
const AUTO_LINE = 'auto-run: on for this session - each ask takes its (Recommended) option; only --mode-auto-run-off after a command ends it';
function scorerPhrases(outputs) {
  const p = outputs.map((o) => scorer.SCORER_PHRASES[o]);
  return p.length > 1 ? `${p.slice(0, -1).join(', ')} or ${p[p.length - 1]}` : p[0];
}
function scorerOnLine(s, auto) {
  return `scorer: on (level ${s.level}, rounds ${s.rounds}, ${s.source}${auto ? ', auto-run' : ''}) - load mode-output-scorer before releasing a ${scorerPhrases(s.outputs)}; --mode-output-scorer-off after a command stops it`;
}
// An ignored ALFRED_CODE_SCORER_OUTPUTS name is ledgered once per session and name: the names already reported sit in
// the session's SCORER-NOTED- file, and a name that file cannot take is not ledgered, so no prompt repeats it (R25).
function noteIgnored(root, sid, ignored) {
  if (!ignored.length) return;
  const file = scorer.scorerNotedFile(root, sid, process.env);
  if (!file) return;
  let seen = [];
  try { seen = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* none noted yet */ }
  const fresh = ignored.filter((n) => !seen.includes(n));
  if (!fresh.length) return;
  try {
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    fs.appendFileSync(file, fresh.map((n) => `${n}\n`).join(''));
  } catch { return; }
  for (const name of fresh) {
    ledgerRow({ mode: 'probe', kind: 'scorer-outputs-ignored', reason: `probe: ALFRED_CODE_SCORER_OUTPUTS names '${name}', which is no automatic output - ignored`, detail: { name } });
  }
}
// auto-run for this prompt: the family run's -off, its -on when nothing refuses it, else the stamp live for this session.
function autoRunNow(flags) {
  try {
    if (flags && flags.autoRun === 'off') return false;
    if (flags && flags.autoRun === 'on' && !scorer.autoRunRefusal(payload, process.env, flags)) return true;
    const stamp = scorer.approvalStamp(payload, process.env);
    return Boolean(stamp && stamp.live && stamp.session && stamp.session === String(payload.session_id || '') && /^AUTO\b/.test(stamp.first));
  } catch { return false; }
}
// The scorer for this prompt: its flag written first, then the state; a flag the file cannot take still counts here.
function scorerNow(flags, root, sid) {
  try {
    const nodePath = require('path');
    const flag = flags ? flags.scorer : null;
    const file = flag && sid ? scorer.scorerFile(root, sid, process.env) : null;
    if (file) {
      try {
        const before = scorer.readScorerFile(root, sid, process.env);
        fs.mkdirSync(nodePath.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${flag}\nat: ${new Date().toISOString()}\n`);
        if (before !== flag) ledgerRow({ mode: 'probe', kind: 'scorer-flag', reason: `probe: the scorer switched ${flag} for this session`, detail: { state: flag } });
      } catch { /* a data root that cannot be written - the flag holds for this prompt only */ }
    }
    // State hygiene (R11): the SCORER- files and the draft folders, each at most once a day per dir.
    try {
      const sessions = nodePath.dirname(scorer.scorerFile(root, 'x', process.env));
      scorer.sweepStale(sessions, 'SCORER-');
      scorer.sweepScorerFolders(nodePath.join(sessions, 'scorer'));
    } catch { /* no layout - nothing of ours to sweep */ }
    const s = scorer.scorerState(root, sid, process.env);
    if (s.file === 'garbage') ledgerRow({ mode: 'probe', kind: 'scorer-file-garbage', reason: 'probe: the session\'s scorer file holds neither on nor off - read as absent' });
    noteIgnored(root, sid, s.ignored);
    const switchable = s.usable && s.copy !== 'user-invocable-only';
    if (switchable && flag) Object.assign(s, { on: flag === 'on', source: 'flag' });
    return { ...s, flag: switchable ? flag : null };
  } catch { return null; }
}
// The modes for this payload, once: `prompt` is the typed text (null on the compaction route - no flags, no stack,
// no ON line). Returns the context lines and the ON line's text ('' when no mode is on).
function modesText(prompt) {
  // The agent cap's line (agent-cap.js startLine): '' at the default 5, so a session that never set it pays nothing.
  let cap = '';
  try { if (!payload.agent_id) cap = require('./agent-cap.js').startLine(process.env); } catch { /* no module: no line */ }
  cap = cap ? ` ${cap}` : '';
  const none = { context: cap, message: '' };
  try {
    if (!scorer || payload.agent_id) return none;
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const sid = payload.session_id;
    const parsed = prompt === null ? null : scorer.modeFlags(String(prompt || ''));
    const flags = parsed && parsed.family ? parsed : null;   // a reader acts on the leading run only after a family command
    const auto = autoRunNow(flags);
    const s = scorerNow(flags, root, sid);
    const lines = [];
    if (s && s.usable) {
      if (s.flag === 'off') lines.push('scorer: off for this session');
      else if (s.on) lines.push(scorerOnLine(s, auto));
      // a flag-only line switches and starts nothing, so it is no stack (spec section 4, round-0 M7)
      if (prompt !== null && scorer.stackNamed(prompt) && !(parsed && parsed.flagOnly)) {
        lines.push(`scorer: stacked for this request (level ${s.level}, rounds ${s.rounds}) - grade this request's output with mode-output-scorer before releasing it`);
      }
    }
    if (auto) lines.push(AUTO_LINE);
    const on = [auto ? 'auto-run' : '', s && s.usable && s.on ? `output-scorer (level ${s.level})` : ''].filter(Boolean);
    return { context: lines.map((l) => ` ${l}`).join('') + cap, message: prompt !== null && on.length ? `Modes ON: ${on.join(', ')}` : '' };
  } catch { return none; }
}

if (payload.hook_event_name === 'UserPromptSubmit') {
  // A harness prompt is no user turn: no budget, no correction test (audit 2026-10-10 C25, 758ce661: the 780-char
  // budget rode a background gate's completion notice, ~195 tokens carried on every later message; 2026-10-14 HK14: and
  // every seat's hand-back - 351 of 960 injections in a week).
  if (harnessPrompt(payload.prompt)) process.exit(0);
  clearTimeoutMarker();
  // A denial the agent cap recorded lives for one typed prompt: the Stop half never continues once the user moved on.
  try {
    const agentCap = require('./agent-cap.js');
    const reg = agentCap.openRegistry(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), payload.session_id, process.env);
    if (reg) agentCap.clearDenied(reg);
  } catch { /* no module: nothing recorded */ }
  const repeat =repeatsLastPrompt(payload.prompt) ? ' VERBATIM RE-ASK: this prompt is identical to ' +
    'the previous one. The last answer missed - do not re-answer it longer or from a different angle. ' +
    'Ask ONE AskUserQuestion about the goal, with the readings you are choosing between as options ' +
    '(measured: three identical turns, /model and /effort escalated between them, before the run asked).'
    : '';
  const streak = correctionStreak(payload.prompt);
  const extra = streak >= STREAK_TURNS
    ? ' FORMAT ASK: ' + streak + ' consecutive short turns, each after a long answer. If these are ' +
      'corrections of the SAME deliverable, the house rule (alfred-interaction) says the next act is ONE ' +
      'AskUserQuestion on the format - shape, length, language, what to keep - not another redraft ' +
      '(measured: nine corrections and nine redrafts of one report with no ask, 1.64M cache-read).'
    : '';
  // The correction nudge, LOG-ONLY by default (the user's 'count first' ruling): 38 of 38 and then
  // 35 of 35 measured corrections were never saved anywhere. ALFRED_CODE_CORRECTION_NUDGE:
  // `log` (the seed, and the value when absent) writes one row per correction turn and injects
  // nothing; `inject` also hands the save line back; `0` (or `off`) is off.
  const nudgeMode = String(envOf(process.env, 'CORRECTION_NUDGE') || 'log').trim().toLowerCase();
  const marker = nudgeMode === '0' || nudgeMode === 'off' ? null : correctionTurn(payload.prompt);
  const inject = !!marker && nudgeMode === 'inject';
  if (marker) {
    ledgerRow({ mode: 'probe', kind: 'correction', injected: inject,
      reason: `probe: a correction turn - ${inject ? 'save line injected' : 'logged, nothing injected'}`,
      detail: { marker, chars: String(payload.prompt).trim().length } });
  }
  const nudge = inject ? ` CORRECTION: this reads as a correction - ${SAVE_LINE}` : '';
  const modes = modesText(payload.prompt);
  // The ON line is a systemMessage beside the context: the user sees it, the model reads the context lines (spec section 3).
  process.stdout.write(JSON.stringify({
    ...(modes.message ? { systemMessage: modes.message } : {}),
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: BUDGET_TEXT + extra + repeat + nudge + modes.context },
  }));
  process.exit(0);
}

// A COMPACTION rebuilds the context without the injection and emits no UserPromptSubmit, so the
// budget simply disappears for the rest of the session: measured absent for 74 of 195 messages in
// one session and 277 of 366 (75.7%) in another, where the close came in at 1.44x the hard cap -
// all four compactMetadata.preservedMessages records carry preserved:false for the budget's uuid.
// A co-installed plugin's banner WAS re-injected at every compaction, so this route is proven.
// Any hook whose whole value is an INJECTION needs this wiring; a hook that only BLOCKS does not.
// A seat's own compaction runs this inside the seat (its agent_id on the payload, loading audit 2026-10-21 G3): a
// seat's report has its own shape, so no budget goes there.
if (payload.hook_event_name === 'SessionStart' && !payload.agent_id) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: BUDGET_TEXT + modesText(null).context },
  }));
  process.exit(0);
}


process.exit(0);
