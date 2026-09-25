#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// The short-answer contract (baseline-interaction.md: 'at most 3 sentences plus points', 'if the
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
//   prose: nine corrections and nine redrafts of one report, 1.64M cache-read, no ask.
// Stop wiring: an answer whose prose (code blocks, tables and inline spans excluded) runs past the
//   hard cap with no depth request in the user's own message is blocked, and the model re-answers
//   at budget. The answer measured is the payload's `last_assistant_message`; the transcript's
//   assistant row is the fallback, and the user's own message always comes from the transcript.
//   Deliberately a wall-of-text catch, not a byte-counter: the soft budget lives in the reminder
//   because a Stop block cannot unsay text the user already read - it can only add more.
// SessionStart wiring: re-emits the budget as additionalContext whenever the harness rebuilds the
//   context (startup, resume, clear, compact) - a compaction drops the UserPromptSubmit injection.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('guard-answer-length')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving (the installers rename the
// key in place on the next install/update).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.claude/docs';
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge

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
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          tool: payload.tool_name || '',
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
const HARD_CAP = 1800; // block: double the budget with no depth request = a wall of text
// An explicit depth request in the user's OWN words lifts the cap for that turn. Deliberately
// narrow: 'explain X' does NOT qualify - the rule caps explanations too ('whether it is work
// output or an explanation'); only an ask for depth, length or a written document does.
const DEPTH_RE = /\b(in detail|detailed|more detail|deep ?dive|in ?depth|elaborate|expand on|walk me through|step[- ]by[- ]step|full (breakdown|analysis|report|list|picture|write[- ]?up)|comprehensive|thorough(ly)?|verbose|long(er)? (answer|version|form)|everything (you|about)|write (me )?(a|the) (plan|report|doc|document|spec|summary)|don'?t (be )?(short|brief))\b/i;
// The same ask in the user's other languages. Kept as its own pattern because JS \b is ASCII-only -
// a word boundary around a Cyrillic stem never matches, so these are matched as bare substrings
// (stems only: 'детальн' covers детально / детальніше / детальный).
const DEPTH_RE_CYR = /(детальн|докладн|подробн|розгорнут|развернут|покроков|пошагов|крок за кроком|шаг за шагом|розпиши|распиши|розбір|разбор|напиши план|повністю|полностью|поясни глибше|глибше|глубже)/i;

// A first-person retraction of something this run already said. 'Sorry' alone is not one, and
// neither is a correction the run is making to somebody else's work - the exemption is for the
// disclosure the short answer would erase.
const SELF_CORRECTION_RE = /\b(i (was|got) (wrong|mistaken|it wrong)|my (earlier|previous|last) (claim|statement|answer|read|number|assertion|verdict)|correcting (myself|my)|i need to correct|to correct (myself|what i)|retract(ing)? (that|my)|(that|this) was (wrong|incorrect) (of me|on my part)|earlier i (said|claimed|reported|told you))\b/i;
// The report shapes this stack's own skills MANDATE. A field required by the output contract is
// not the run's prose - cutting it makes the report non-conforming.
// A MARKDOWN HEADING is required, not just the word: 'Recommendation first, then why' is the
// house answer shape, so matching a bolded lead-in would have exempted almost every answer and
// left the cap unenforced.
const MANDATED_FIELD_RE = /^\s{0,3}#{2,6}\s+\S{0,40}?\b(verdict|findings?|protocol check|waste analysis|blockers?|material|minor|evidence|punch[- ]list|assumptions?|not[- ]stack|fill in)\b/im;

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

function lastMessages() {
  let assistant = null;
  let user = null;
  let userTs = NaN;
  for (const line of tailLines()) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // partial first line of the tail window
    }
    if (!o || !o.message) continue;
    // One logical assistant turn is written as SEVERAL jsonl rows sharing one message.id (a
    // thinking row, then the text row). Keeping only the last row read the wall of text as an
    // empty fragment and passed it silently - the same defect measured six times in the stop
    // contract's own transcript reader, which is why both now merge by id.
    if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      const id = o.message.id;
      if (assistant && id && assistant.message.id === id) {
        assistant.message.content = assistant.message.content.concat(o.message.content);
        if (o.message.usage) assistant.message.usage = o.message.usage;
      } else {
        assistant = { ...o, message: { ...o.message, content: o.message.content.slice() } };
      }
    }
    if (o.type === 'user') {
      const c = o.message.content;
      // A tool_result arrives as a user message - only a real typed turn counts.
      const typed = typeof c === 'string'
        ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      if (typed.trim()) { user = typed; userTs = Date.parse(o.timestamp); }
    }
  }
  return { assistant, user, userTs };
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
const BUDGET_TEXT =
        `Answer budget (baseline-interaction.md, house rule): at most 3 sentences plus bullet ` +
        `points, ~${BUDGET} characters of prose. Lead with the result and stop - no preamble, no ` +
        `restating the request, no listing what you considered, no caveat paragraph. Code, ` +
        `tables and command output are exempt and do not count. Write more ONLY if THIS message ` +
        `asked for depth, in English, Ukrainian or Russian (in detail / walk me through / write a plan; детально, ` +
        `покроково, розпиши); 'explain' by itself does ` +
        `not - explanations are capped too, and short means plainer words, never compressed jargon. ` +
        `House voice, same rule, same source: single dashes, never em-dashes, and single quotes in ` +
        `prose - in the answer AND in an AskUserQuestion's own text, which no Stop hook reads.`;

// --- the correction streak: N short human turns in a row, each right after a long answer -----
// The interaction rule says a re-ask on the SAME deliverable is ONE format AskUserQuestion, not
// another redraft. It shipped as prose and lost: nine corrections, nine redrafts, 1.64M cache-read,
// no ask. The detector is tuned on that one session - three short turns (under 200 chars), each
// following an assistant answer over 1,500 chars of prose - and it only INJECTS a line, so a wrong
// guess costs one sentence of context, never a turn. Watched for a week before it grows.
const STREAK_TURNS = 3;
const STREAK_SHORT = 200;
const STREAK_LONG = 1500;
function correctionStreak(currentPrompt) {
  try {
    const turns = [];   // in order: { role, len } - assistant rows merged by message.id, prose only
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
        turns.push({ role: 'user', len: lastUserText.length });
      }
    }
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

if (payload.hook_event_name === 'UserPromptSubmit') {
  const repeat = repeatsLastPrompt(payload.prompt) ? ' VERBATIM RE-ASK: this prompt is identical to ' +
    'the previous one. The last answer missed - do not re-answer it longer or from a different angle. ' +
    'Ask ONE AskUserQuestion about the goal, with the readings you are choosing between as options ' +
    '(measured: three identical turns, /model and /effort escalated between them, before the run asked).'
    : '';
  const streak = correctionStreak(payload.prompt);
  const extra = streak >= STREAK_TURNS
    ? ' FORMAT ASK: ' + streak + ' consecutive short turns, each after a long answer. If these are ' +
      'corrections of the SAME deliverable, the house rule (baseline-interaction) says the next act is ONE ' +
      'AskUserQuestion on the format - shape, length, language, what to keep - not another redraft ' +
      '(measured: nine corrections and nine redrafts of one report with no ask, 1.64M cache-read).'
    : '';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: BUDGET_TEXT + extra + repeat },
  }));
  process.exit(0);
}

// A COMPACTION rebuilds the context without the injection and emits no UserPromptSubmit, so the
// budget simply disappears for the rest of the session: measured absent for 74 of 195 messages in
// one session and 277 of 366 (75.7%) in another, where the close came in at 1.44x the hard cap -
// all four compactMetadata.preservedMessages records carry preserved:false for the budget's uuid.
// A co-installed plugin's banner WAS re-injected at every compaction, so this route is proven.
// Any hook whose whole value is an INJECTION needs this wiring; a hook that only BLOCKS does not.
if (payload.hook_event_name === 'SessionStart') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: BUDGET_TEXT },
  }));
  process.exit(0);
}

// Did the stop contract block THIS turn? Both hooks write one row per block to the same ledger
// (<docs-path>/hook-blocks/<session>.jsonl), so the row is the only cross-hook evidence there is -
// the two run as separate processes in an order nothing guarantees. Read the tail of this session's
// own file and accept a guard-stop-contract row from the last two minutes; anything older belongs
// to an earlier turn. Only a BLOCK counts: a row carrying a `mode` (the red-run injection, the skip
// at a tool-ended turn) blocked nothing, and yielding to it tells the model to obey a block it never
// saw - measured in the A/B, where the rewrite dropped the verification line. A row older than
// this turn's typed prompt is an earlier turn's, however recent: two minutes alone read the previous
// turn's block as this one's. Best-effort in every direction: an unreadable ledger means no yield.
function stopContractBlockedThisTurn(turnStartMs) {
  try {
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const file = path.resolve(root, docsRootEnv(), 'hook-blocks', `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-20);
    for (const line of rows) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || o.hook !== 'guard-stop-contract.js' || o.mode) continue;
      if (o.event !== 'Stop' && o.event !== 'SubagentStop') continue;
      const at = Date.parse(o.ts);
      if (Number.isFinite(turnStartMs) && at < turnStartMs) continue;
      if (Date.now() - at <= 2 * 60 * 1000) return true;
    }
    return false;
  } catch { return false; }
}

if (payload.hook_event_name === 'Stop') {
  if (payload.stop_hook_active) process.exit(0); // continuation we caused - one block per turn
  let last;
  let user;
  let userTs = NaN;
  // An unreadable transcript leaves the LENGTH half fail-open (no user row, so depth cannot be ruled
  // out), never the em-dash half: that reads last_assistant_message, which the payload carries anyway.
  let transcriptRead = true;
  try {
    ({ assistant: last, user, userTs } = lastMessages());
  } catch {
    transcriptRead = false;
  }
  // The harness's `last_assistant_message` is the turn's final text; the transcript is written
  // asynchronously and can lag it (documented), so the field wins and the transcript's assistant
  // row is the fallback. The user's message still comes from the transcript - the Stop payload
  // carries no prompt - so an unreadable transcript stays the fail-open pass above.
  let text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  if (!text.trim()) {
    if (!last) process.exit(0);
    const blocks = last.message.content;
    if (blocks.some((b) => b && b.type === 'tool_use')) process.exit(0); // ended on a tool call
    text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  const body = proseOf(text);
  // The OTHER half of the same injected rule, and the half nothing checked: 'single dashes, never
  // em-dashes'. Measured across four audited sessions - 32 em-dashes in 21,434 chars of prose in
  // one, 4 in another, 2 each in two more - with the budget text carrying that clause loaded THREE
  // times in the same transcript, so this is not a placement problem: the rule was injected every
  // turn and enforced on no surface. The Stop branch already holds the turn's prose, so it is one
  // more pass over text this hook has read anyway. Only the em-dash and its horizontal-bar twin are
  // checked - the same injection's 'single quotes in prose' clause is not, because a double quote
  // legitimately names a string value and the false positives would cost a turn each.
  const DASHES = /[\u2014\u2015]/g;
  const dashes = (body.match(DASHES) || []).length;
  let overLength = transcriptRead && body.length > HARD_CAP;
  if (!overLength && !dashes) process.exit(0);
  // The three length exemptions below excuse the LENGTH only. An em-dash is a character to
  // replace, not content to drop, so no exemption reaches it and the re-answer loses nothing.
  if (overLength && user && (DEPTH_RE.test(user) || DEPTH_RE_CYR.test(user))) overLength = false; // depth asked this turn
  // Two exemptions, both bought with measured damage: one forced re-answer went 3,184 -> 1,085
  // chars and took TWO of five headline findings and a self-correction disclosure with it. A cap
  // that deletes content the user needed is worse than the wall of text it replaced.
  //   - A SELF-CORRECTION cannot be re-answered shorter without being dropped: the shorter answer
  //     is, by construction, the one that does not mention the mistake.
  //   - A MANDATED REPORT FIELD belongs to the skill's own output contract, not to the run's
  //     talking. Trimming it makes the report non-conforming, which is a second failure.
  // Both are deliberately narrow, and neither is reachable by a run that simply wants to write
  // more: a bare 'sorry' does not match, and neither does a heading the stack does not mandate.
  if (overLength && SELF_CORRECTION_RE.test(text)) overLength = false;
  if (overLength && MANDATED_FIELD_RE.test(text)) overLength = false;
  if (!overLength && !dashes) process.exit(0);

  global.BLOCK_DETAIL = { branch: overLength && dashes ? 'length+em-dash' : overLength ? 'length' : 'em-dash',
    matched: overLength ? `${body.length} chars of prose` : `${dashes} em-dash(es)` };
  if (!overLength) {
    // Two Stop hooks can answer ONE stop, and until this existed they answered it with opposite
    // orders: this one said 'Re-send the SAME answer' while guard-stop-contract.js said 'Add
    // nothing else to this turn'. The model obeyed the second and the flagged text shipped
    // uncorrected. The other gate owns the turn - it is holding a decision or a fresh-session
    // offer - so this one yields and asks for the fix INSIDE that turn.
    process.stderr.write(
      `This answer uses ${dashes} em-dash(es). The house voice is single dashes - the rule is in\n` +
      `baseline-interaction.md and this hook injects it into every turn, including the one you just\n` +
      `answered (measured: 32 em-dashes in 21,434 characters of prose in one audited session, with\n` +
      `the rule loaded three times in the same transcript).\n` +
      (stopContractBlockedThisTurn(userTs)
        ? `guard-stop-contract.js has already blocked this same turn, so do what IT asks and fold the\n` +
          `dash fix into that turn - replace every em-dash with a single dash in the text you re-send.\n` +
          `Its instruction wins on everything else.`
        : `Re-send the SAME answer with every\n` +
          `em-dash replaced by a single dash - change nothing else, add no apology and no note about\n` +
          `the edit. If another hook blocked this same turn and asks for something else, do that and\n` +
          `fix the dashes inside the turn it asks for - never drop the fix because two hooks spoke.`),
    );
    process.exit(2);
  }

  process.stderr.write(
    (dashes ? `This answer also uses ${dashes} em-dash(es) - the house voice is single dashes, so\nreplace them while you are rewriting it.\n` : '') +
    `This answer is ${body.length} characters of prose - the house budget is ~${BUDGET} (about 3\n` +
    `sentences plus points) and the hard cap is ${HARD_CAP}. Code, tables and command output were\n` +
    `already excluded from that count, and nothing in the user's message asked for depth, so this\n` +
    `is the wall-of-text failure baseline-interaction.md exists to prevent (measured: repeated\n` +
    `'you write too much text' / 'shorter and simpler' corrections with the rule loaded verbatim).\n` +
    `Re-answer now at budget: the result first, then only what the user must act on. Cut preamble,\n` +
    `the recap of what they asked, the options you rejected, the caveats they did not ask for, and\n` +
    `every sentence about your own process. Do NOT apologize, do NOT explain the trim, and do NOT\n` +
    `append the short version to the long one - write the short answer alone. If the detail is\n` +
    `genuinely needed, say one line offering it instead of delivering it.\n` +
    (stopContractBlockedThisTurn()
      ? `guard-stop-contract.js blocked this same turn too: do what IT asks, and write that turn at\n` +
        `budget. Its instruction wins on everything else.`
      : ''),
  );
  process.exit(2);
}

process.exit(0);
