#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Three wirings, one contract: the blocking-ask mandate (baseline-interaction.md) and the
// fresh-session construction check (the flow skills' stop contracts) both failed as prose in
// every audited strengthening - measured across 123 sessions: ~25 sessions ended turns on
// 'say the word' / 'want me to X?' prose (stalls of 13min-37h, one plaintext-credential
// decision dropped at /exit), and the 150k fresh-session option fired in ~0 of 50+ qualifying
// asks (0/11, 0/14, 0/7...) with the clause loaded verbatim. This hook is the mechanization.
//
// Stop wiring: a turn that ends on a decision-shaped question in PROSE (no AskUserQuestion
//   call in the final assistant message) is blocked - the model re-emits it as the tool call.
//   The text judged is the payload's `last_assistant_message` (the harness's own copy of the
//   turn's final text); the transcript tail is the fallback for a build that does not send it.
//   The same Stop wiring carries the fresh-session offer: on a CLEAN close past the
//   window-scaled trigger, the turn is held once so the user is asked whether to continue here
//   or resume fresh. It fires only after the work is done (never mid-response, which is what the
//   old PreToolUse denial did), and re-arms only when the context has grown 1.5x since the last
//   one - so a long session is asked once per real cost step, not once per question.
// SubagentStop wiring: a subagent that closes on a wait nobody will end, with no background work of
//   its own, is held once and told to do its directive (see the branch below for the field report).
// PreToolUse (AskUserQuestion) wiring: INJECTION ONLY - `hookSpecificOutput.additionalContext`,
//   presence-only, never ranks an option and never denies. It carries the four checks that have no
//   other route (stale ask scope, a recommendation contradicting an un-actioned request, the
//   fresh-session offer for a flow whose every stop is a tool call, and a live credential) plus the
//   house-voice check on the ask's own text. The DENIAL this matcher used to carry is gone for
//   good: it fired mid-response and cost the user a red block every turn.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('guard-stop-contract')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a
// project whose settings.json has not been migrated yet keeps resolving.
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
        fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
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

// The fresh-session arithmetic lives in fresh-session.js beside this hook, shared with
// guard-fresh-session-start.js. An update from an older install can run this hook before that file
// lands: the stand-in keeps every fresh-session offer OFF and the rest of this hook running.
let fresh;
try { fresh = require(require('path').join(__dirname, 'fresh-session.js')); } catch {
  fresh = {
    use() {}, freshAt: (k, d) => d, FRESH_AT_200K: 0, FRESH_AT_1M: 0, FRESH_AT_DEFAULT: 0, FRESH_OFF: true,
    sessionModelId: () => null, tableWindow: () => null, envWindow: () => null, knownWindow: () => null,
    ctxThreshold: () => null, MIN_RECOVERABLE_SHARE: 0.4, coldFloor: () => null, worthResuming: () => false,
  };
}
fresh.use(payload);
const { FRESH_OFF, ctxThreshold, coldFloor, worthResuming } = fresh;
// The CLOCK the same offer is judged against in the AskUserQuestion branch (never in the Stop
// branch, which blocks). Context is not the only thing that makes a resume worth it: 63.5% of the
// audited collection's cache-read was paid under the 1M window's own trigger, and the flows' stop
// contracts already say 'spans hours, or resumes after an idle gap' - as prose, which slipped in 3
// of 3 bundles that tested it. Hours, not tokens, and `0` switches this route off. Not seeded by
// the installers: the trigger NUMBERS are the user's ruling and this one is deliberately an
// override, not a setting, until the block rate says what it should be.
const FRESH_AFTER_HOURS = (() => {
  const n = parseFloat(envOf(process.env, 'FRESH_SESSION_AFTER_HOURS'));
  return Number.isNaN(n) || n < 0 ? 2 : n;
})();

// How far the context must grow before the fresh-session offer is made again (see below).
const REOFFER_GROWTH = 1.5;
// `/clear` is NOT in this list. It matched the token quoted as report CONTENT - a turn merely
// describing session hygiene ('every <=130k session opened with `/clear` + resumed from a file')
// silenced the offer at PEAK context (A/B replay: with the token exit 0, with the same sentence in
// prose exit 2). A report about session hygiene will always contain the words; only an OFFER counts.
// ...and a close that MENTIONS a fresh session is not a close that OFFERS one. Measured: a turn
// recommending a future audit of ITSELF 'from a fresh session' silenced its own overdue offer at
// ~561k, which then fired 9 messages and 5,080,000 cache-read later. So the exemption needs the
// phrase AND a continuation cue in the same sentence - the mandated resume block, or the offer to
// carry THIS work on somewhere else. Cues that merely recommend something ('worth', 'recommend')
// are deliberately NOT in the list: they are what the missed close was made of.
const FRESH_PHRASE = '(?:fresh session|new session|fresh chat)';
const FRESH_CUE = '(?:continu\\w+|resum\\w+|carry(?:ing)? (?:it|this|on)|pick(?:ing)? (?:it|this|the work) up'
  + '|restart\\w*|hand(?:ing)? (?:it|this) (?:off|over)|paste|plan file|resume block|move (?:it|this)|switch(?:ing)? to)';
const FRESH_RE = new RegExp(`${FRESH_CUE}[^.!?\\n]{0,80}${FRESH_PHRASE}|${FRESH_PHRASE}[^.!?\\n]{0,80}${FRESH_CUE}`, 'i');
// Decision-shaped prose endings measured in the corpus. Deliberately narrow: a plain
// clarifying question is not matched - only the offer-and-wait shapes that stalled sessions.
// The object class admits a dot that is NOT sentence-ending (`\.(?!\s|$)`): the plain
// `[^.?!\n]` excluded every dotted path, so 'Want me to update CLAUDE.md?' and the same offer
// naming `.gitignore` / `package.json` / `settings.json` / `SKILL.md` all escaped the gate - the
// offers most likely to be made in THIS repo were exactly the ones it could not see (measured
// across the audited corpus). A dot followed by space or end still terminates, so the match
// cannot span a sentence boundary.
// `your call` carries a negative lookbehind for `not `/`never `: the bare token matched inside a
// NEGATION, so 'the closure is held here, not your call' - a sentence stating that nothing is
// being asked - was blocked as an ask (measured: one step-12 post-check, 174,321 cache-read on the
// retried turn). A negated 'your call' is the opposite of an offer, and this hook's own denial
// texts prescribe that phrasing.
// The IMPERATIVE offer is the same stall without a question mark: 'Confirm you want that dropped,
// or I can stash it instead' held a real decision for 11.5 minutes and matched nothing here, since
// every shape above is either a question or a hand-back idiom (measured). An imperative addressed
// to the user, and an 'or I can X instead' alternative, are offers - they wait exactly like a '?'.
// The measured additions (7 findings, 7 bundles, each tested FALSE against the regex as it stood):
//   - the model QUOTES its own token, so the literal `say go` missed `say 'go'` and `Say 'allowed'`
//     five times in one session while the user's anger visibly escalated. The quoted form lives in
//     the CLAUSE-anchored pattern below, over the tokens the corpus actually asked for ('go',
//     'yes', 'allowed', 'proceed').
//   - 'if you say yes', 'Say yes and I'll build it' - the conditional hand-back; 52s later the user
//     asked 'Have you implemented?'.
//   - 'tell me to push and I'll run the push gate first' and a bare '...then tell me.' - the
//     imperative hand-back with no qualifier. Both live in the CLAUSE-anchored pattern below.
//   - 'Or let me do it: ...' - the bulleted two-path offer with no question mark; the 'or i can X
//     instead' alternative added earlier did not reach it.
const PROSE_ASK_RE = /\b(say the word|say go|if you say (?:yes|go|ok|so)\b|just say so|or let me [a-z]|want me to (?:[^.?!\n]|\.(?!\s|$)){0,80}\?|shall i (?:[^.?!\n]|\.(?!\s|$)){0,80}\?|should i (?:[^.?!\n]|\.(?!\s|$)){0,80}\?|(?<!\bnot )(?<!\bnever )your call\b|let me know (when|if|whether)|give me the word|tell me (if|when|whether) you want|tell me which\b|confirm (you want|whether|if|that you)\b|or i can [^.\n]{0,60}\binstead\b|paste (this|that|it) and i'?ll|run this to unblock|i'?ll [^.\n]{0,60}(the moment|as soon as|once) you\b|worth your decision)/i;
// A RETROSPECTIVE '(your call)' is a note about a decision the user already took, not an offer of
// one: 'Requirement recorded: 90% line coverage after exclusions (your call).' was blocked as an
// ask on a close that held no question at all (measured). The discriminator is narrow on purpose -
// the parenthetical AND a record verb in the same sentence - so a genuine 'keep both or drop one
// (your call)' still blocks.
// The closed `(your call)` was too literal: '(your call, environment-sensitive)' - the same
// retrospective note with one clause inside the parenthesis - was blocked on a close holding no
// question mark at all, and the forced retry cost 298,289 cache-read and ~6 minutes. The paren may
// carry a trailing clause; it still has to be a parenthetical beside a record verb.
const RETRO_YOUR_CALL_RE = /\b(record(ed)?|noted?|logged|captured|set|chosen|decided|kept|applied|confirmed|excluded?|skipped|ran|run)\b[^.\n]{0,120}\(your call[^)\n]{0,60}\)/i;
// The imperative hand-backs, both anchored to a CLAUSE START, which is what keeps them off ordinary
// narration. Measured unheld: '...then tell me. From there I drive Task 4' (the user asked 'Why you
// stopped?' five minutes later) and 'tell me to push and I'll run the push gate first'. An offline
// replay over 348 real turn-ending closes in this account's transcripts is what set the two
// exclusions: without the clause anchor 'Did anything tell me to change how I read?' and 'the docs
// say yes to both spellings' block, and without the if/when/whether lookahead the closing courtesy
// 'Tell me if it happens again on 0.2.80' does - three false blocks bought for nothing, since
// 'tell me if/when/whether you want' is already an alternative above.
// The quoted token is the other measured half: the model writes its own hand-back word in quotes,
// so the literal `say go` saw none of the five asks it made in one session.
const PROSE_ASK_CLAUSE_RE = /(?:^|[\n.;:,!?)\]-]\s*|\b(?:then|and|or|so|when|otherwise)\s+)(?:(?:just |please )?tell me\b(?!\s+(?:if|when|whenever|whether|why|what|how)\b)|(?:just |then )?say\s+['"‘’“”]?(?:go|yes|ok|okay|allowed|proceed|approved?)['"‘’“”]?\b)/i;
// project-quality-loop's two structural pauses - the run-start mode ask and the stage-close
// fresh-session ask - live in its SKILL.md as sentences, so the loop can word them as a statement
// that ends on no '?' ('Continue in a fresh session from the loops folder (recommended), or
// continue here.') and the question shape never sees them (improvement plan 2.5). Each needs the
// alternative offered, or a clause start, so a RECORD of the answer ('Mode: DELEGATED - the user
// chose to dispatch...', 'continue: fresh') and narration ('I'll close this stage once...') pass.
const LOOP_ASK_RES = [
  /(?:^|[\n.;:!?]\s*)which mode\b/i,
  /\brun (?:the pipeline |it |this )?(?:inline|here|in (?:this|the current) session)\b[^.\n?]{0,80}\bor\b[^.\n?]{0,40}\bdispatch\b/i,
  /\b(?:inline|in this session)\s+or\s+(?:delegated|dispatch(?:ed)?)\b/i,
  /(?:^|[\n.;:!?]\s*)(?:shall i |should i |do we |ok to )?close this stage\b[^.\n?]{0,80}\bor\b/i,
  /\b(?:continue|resume|start) (?:in )?a fresh session\b[^.\n?]{0,100}\bor\b[^.\n?]{0,40}\b(?:continue|stay|keep going|carry on)(?: \w+){0,2} here\b/i,
  /\b(?:continue|stay|keep going|carry on) here\b[^.\n?]{0,60}\bor\b[^.\n?]{0,40}\b(?:a )?fresh session\b/i,
];
function proseAskMatch(text) {
  const m = (text.match(PROSE_ASK_RE) || [])[0] || '';
  if (m && /^your call$/i.test(m.trim()) && RETRO_YOUR_CALL_RE.test(text)) return null;
  if (m) return m;
  const c = (text.match(PROSE_ASK_CLAUSE_RE) || [])[0] || '';
  if (c) return c.trim();
  for (const re of LOOP_ASK_RES) { const l = (text.match(re) || [])[0]; if (l) return l.trim(); }
  return null;
}
function proseAsk(text) {
  return proseAskMatch(text) !== null;
}
// A close with NO question of any shape: the named step is done and a next action sits
// un-taken, stated as fact. Measured in 4 projects - the user answers it with 'are you
// finished?' after 2-22 minutes, so the shape is a stop, not a status line. Both halves must
// hit: something finished, and something still pending on the user or on a running job.
const DONE_RE = /\b(done|complete[d]?|finished|committed|landed|green|all tests pass|ready)\b/i;
// `next steps?`: the plural is what a mandated close header actually reads ('Next steps:'), and the
// singular-only pattern let every card carrying it past the gate (measured: the doneClose check
// could not fire on the one shape it was written for). `when you say so` is the same hand-back the
// prose branch knows as 'just say so' - measured on 'everything is staged and ready to commit when
// you say so', which stalled 2h20m and then re-cached 146.8k.
const PENDING_RE = /\b(not pushed|nothing pushed|awaiting|waiting (on|for)|still running|pending your|next steps?|remains?|left to do|yet to|whenever you|when you'?re ready|(when|whenever|once) you say so|un-?pushed)\b/i;
// DONE_RE and PENDING_RE judge PROSE, and three measured false positives came from reading
// something else. A block costs the whole turn, so the two halves are tested against a SCRUBBED
// copy of the close:
//   - an inline code span is payload, not talk;
//   - a PATH is not a claim: '/health/ready' made DONE_RE read a readiness report into an endpoint
//     list;
//   - a NEGATION says the opposite of a pending item: 'Nothing I started is still running' was read
//     as a stall and blocked a genuinely clean close at ~505k context - one extra round trip, ~1.01M
//     tokens, the most expensive single false positive in the audited collection.
// Only the matched span is removed, so a real pending item later in the same sentence still counts.
const NEGATED_PENDING_RE = /\b(?:nothing|none of (?:it|them|those|the \w+)|no (?:jobs?|tasks?|runs?|steps?|work|processes?|background work))\b[^.\n]{0,60}?\b(?:is|are|'s|remains?|stays?)\s+(?:still\s+|currently\s+)?(?:running|executing|pending|waiting|queued|in progress|outstanding|left|open)\b|\bno longer (?:running|pending|waiting|queued|in progress)\b/gi;
function closeProse(text) {
  return text
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/(?:^|\s)(?:~|\.{1,2})?\/[^\s`)\]]*/g, ' ')
    .replace(/\b\w[\w.-]*\/[\w.-]+\/[\w.-]*/g, ' ')
    .replace(NEGATED_PENDING_RE, ' ');
}
// The one close that names a next step WITHOUT stalling: the run says so. The guided plugin walks
// (setup / configure / update / validate) end on a suggestion card - reload the session, re-run the
// capabilities capture - and close it with one verbatim line (pinned in shared-rules.json):
// 'Nothing is pending on this run - these are yours to run when you choose.'
// That sentence is the ambiguity the doneClose branch exists to
// catch, resolved in the text itself: nothing waits on the model, so nothing is asked. Narrow on
// purpose - the disclaimer must name the RUN or the model as the side with nothing pending; a
// bare 'nothing pending' already passed, and 'pending your review' still stalls.
// The walks print it CONDITIONALLY - only when their card owes the user nothing. A still-required
// user action (revoke the old token, fill in a credential, run a rotation) is pending by
// definition, and a close carrying one goes through the ask instead; measured: one close stated
// 'Still owed: revoke the old token in Sentry's dashboard' and this line in the same message,
// which is a stall wearing the finished-close sentence.
// A job the session is WAITING on, and the waiter it names. Both halves must hit for the
// done-close exemption: a run-state verb alone ('the migration is still running') can still be a
// stall, and a waiter alone is a promise about nothing. Verbs and waiters are listed as SYNONYM
// SETS on purpose - 'running' vs 'executing' decided a block once, which is the failure that
// retired the noun list this replaces.
const BACKGROUND_RE = /\b((still |currently )?(running|executing|in progress|in flight|queued|processing)|backgrounded|in the background)\b/i;
const WAITER_RE = /\b(will notify|notify (on|when)|i'?ll (report back|update you|come back|merge|check)|report back|monitor is armed|watching (it|the run|for)|in the background|backgrounded|on completion|when it (finishes|completes|goes green|lands))\b/i;
const NOTHING_PENDING_RE = /\bnothing(?: (?:else|more))?(?: is)? pending (?:on|from) (?:me|my side|my end|this run|the run|this turn)\b/i;

// --- read the transcript tail (last ~512KB) and pull the last assistant message ---
// A last row bigger than the window (a huge Write input) leaves only a partial line, so an empty
// read retries once over 8MB rather than reporting no message.
function lastAssistantMessage(tail = 512 * 1024) {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - tail);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    let last = null;
    // The context figure comes from the last REAL model call: a `<synthetic>` row (an interrupt, an
    // API error) carries zero usage and would read a hot session as empty.
    let contextUsage = null;
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
        if (o.message.usage && o.message.model !== '<synthetic>') contextUsage = o.message.usage;
        // One logical assistant turn is written as SEVERAL jsonl lines sharing one message.id
        // (a thinking line, then the text line). Taking the last line as the whole message made
        // the hook read an empty-text or tool_use-only fragment and pass silently - measured: 6
        // sessions where an offline replay of this same hook blocks the turn the live run let
        // through, stalls of 15-74 minutes. Merge every line carrying the same id.
        const id = o.message.id;
        if (last && id && last.message.id === id) {
          last.message.content = last.message.content.concat(o.message.content);
          if (o.message.usage) last.message.usage = o.message.usage;
        } else {
          last = { ...o, message: { ...o.message, content: o.message.content.slice() } };
        }
      } catch { /* partial first line of the tail window - skip */ }
    }
    if (!last) return start > 0 && tail < 8 * 1024 * 1024 ? lastAssistantMessage(8 * 1024 * 1024) : null;
    last.contextUsage = contextUsage;
    return last;
  } catch (err) {
    breadcrumb(`transcript read failed: ${err && err.message}`);
    return null;
  }
}

// Did the user JUST answer an AskUserQuestion, or decline one with 'clarify'? Three separate
// measured defects share this one blind spot, and all three are this hook demanding a tool-shaped
// ask for a decision the tool had already settled:
//   1. the acknowledgement of an answer given 3.9 SECONDS earlier was blocked; the user went
//      silent for 1h32m and quit with the work still refused;
//   2. a close restating a choice the user made 21 seconds earlier was blocked, and the forced
//      re-ask REVERSED that choice;
//   3. after an ask is declined with 'clarify' the harness itself instructs prose - and this hook
//      blocked it, deadlocking the turn (0 steps executed, 532.0k wasted, a manual redo 2h26m later).
// Judged over the tail's last 8KB and deliberately fail-OPEN: for a gate with a measured
// false-positive problem, missing one real block is far cheaper than manufacturing another.
function askJustAnswered() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 8 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return /Your questions have been answered:|The user (declined|chose not) to answer|tool use was rejected/i.test(buf.toString('utf8'));
  } catch {
    return false;
  }
}

// --- credential exposure ------------------------------------------------------------------
// SEVEN measured exposures across the audited corpus, and the two shapes need two different
// detectors, because in three of them the run NOTICED and in one it never did:
//   NOTICED  - the close names the exposure and prescribes rotation as a prose bullet. Every
//              such turn passed every branch of this hook; the user read it and quit without
//              acting (19m, 1h40m, and one 2m02s before /exit). A rotation verb beside a
//              credential noun is a pending DECISION, not a status line.
//   UNNOTICED- the session's FIRST tool call `cat`ed an account settings.json whole and printed
//              two live tokens; both closes were credential-free, so nothing in the assistant's
//              own text could ever have caught it. The values existed only in a tool_result.
// The token VALUE is never read into a variable, never logged and never printed - only its shape
// is matched, and the denial names the shape alone.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const ROTATE_RE = /\b(rotate|revoke|purge|scrub|regenerate)\b[^\n]{0,120}\b(credential|token|secret|key|dsn|password|api[- ]?key|history)\b/i;
// A third shape, and the one the two above could not see: the USER pastes the credential into
// chat. Measured on the single bundle in the audited collection that had to ship with NO
// transcript at all - a live API key entered that session by paste, the run's own closes were
// credential-free, and every branch of this hook passed. So the shape test runs over USER-role
// records too, not only over tool results: the guard covered every route the MODEL can take to a
// credential and none of the one route the USER takes. This is still turn-END detection; catching
// it at paste time would need a UserPromptSubmit wiring this hook does not have, and the exposure
// is already on disk by then either way - what matters is that the rotate ask happens at all.
function secretInSession() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      // USER-role rows: both the tool_results the model's own reads returned, and the user's own
      // typed or pasted text. The assistant's own text is judged separately, by ROTATE_RE.
      if (!line.includes('"toolUseResult"') && !line.includes('"tool_result"')
        && !/"type"\s*:\s*"user"/.test(line)) continue;
      if (SECRET_SHAPE.test(line)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// The secret guard's receipt is the user's CONSENT to a value being in this transcript - the remote
// user who asked to see it, or to have it placed where a blind copy cannot reach. A shape that
// entered under a live receipt is not re-asked for rotation every turn; the receipt is read with
// the same session scope the guard applies (under 8h, this session's own transcript). Its path is
// pinned in shared-rules.json with the guard's.
function secretReadAllowed() {
  try {
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const receipt = path.resolve(root, docsRootEnv(), 'flow', 'SECRET-READ-ALLOW');
    const st = fs.statSync(receipt);
    let sessionStartMs = 0;
    try {
      const t = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = t.birthtimeMs && t.birthtimeMs !== t.ctimeMs ? t.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > 8 * 60 * 60 * 1000 || (sessionStartMs && st.mtimeMs < sessionStartMs)) return false;
    return fs.readFileSync(receipt, 'utf8').split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#'));
  } catch {
    return false; // absent or unreadable - no consent recorded
  }
}

// The rotate ask comes ONCE per exposure. The shape stays in the transcript, so the detector kept
// re-demanding the ask on every later turn - a decision the user had already made ('tired of these
// messages'). An answered rotate ask (the harness's own 'Your questions have been answered' row
// naming rotation, or the defer option) covers every credential shape that entered the session
// BEFORE it - tool results and the user's own pastes alike; only a shape that arrives after it asks
// again. Judged over the same 256KB tail secretInSession reads, and fail-open like it.
// ALFRED_CODE_ROTATE_ASK=0 in the settings.json env turns the branch off for a user who accepts
// the exposure - the value is in the transcript either way, so that is theirs to decide.
const ROTATE_ASK_ON = envOf(process.env, 'ROTATE_ASK') !== '0';
const ROTATE_ANSWER_RE = /Your questions have been answered:[^\n]*?(rotat|revok|acknowledge and defer)/i;
function rotateAskAnswered() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let lastAnswer = -1;
    let lastShape = -1;
    buf.toString('utf8').split('\n').forEach((line, i) => {
      if (ROTATE_ANSWER_RE.test(line)) lastAnswer = i;
      if (SECRET_SHAPE.test(line)) lastShape = i;
    });
    return lastAnswer >= 0 && lastAnswer > lastShape;
  } catch {
    return false;
  }
}

// A silent fail-open is indistinguishable from a clean turn, which is how the misses above
// stayed invisible across 74 audited bundles. Every path that declines to judge says so.
// Name the BRANCH that fired and the substring that matched it, in the ledger row AND in the
// breadcrumb. This hook has four blocking branches and the row carried only the denial's first
// line, which is the same text for every turn one branch denies - so a block that matched none of
// the published triggers could not be reconstructed at all (measured: one status turn blocked at
// 142,455 cache-read, and this audit hit the same wall three times). A block that cannot be
// explained cannot be tuned, and an untunable gate is the one the model learns to work around.
function blockDetail(branch, matched) {
  const detail = { branch, matched: String(matched == null ? '' : matched).slice(0, 120) };
  global.BLOCK_DETAIL = detail;
  breadcrumb(`block ${branch}: ${detail.matched}`);
}
function breadcrumb(why) {
  try {
    const dir = envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir();
    fs.appendFileSync(`${dir}/guard-stop-contract.log`, `${new Date().toISOString()} ${why}\n`);
  } catch { /* never let logging break the gate */ }
}

// --- SubagentStop: a subagent that stops on a wait nobody will end ------------------------------
// Field report (2026-09-19, win32, v2.1.268): a fork with a multi-step brief made 2 tool calls in 18s,
// wrote nothing, and closed on "That wakeup wasn't the right tool here (no /loop in play) - cancelled
// it. I'll just wait for the pilot fork's completion notification." The pilot fork, the wakeup and the
// wait were the PARENT's: a fork inherits the parent's whole history, and the harness's own
// <fork-boilerplate> ('you are NOT a continuation of that agent') did not stop it reading that history
// as its own situation. A subagent that ends its turn with no background work of its own is never
// notified or re-invoked, so the stop was final and the brief silently dropped. Exit 2 on SubagentStop
// continues the subagent's conversation (hooks reference, exit-code table), so it is held ONCE when
// BOTH hold:
//   - its close claims a first-person wait, or it called ScheduleWakeup itself (the main session's
//     /loop pacing - never a subagent's job);
//   - its OWN rows (after the fork boilerplate; every row for a plain subagent) launched nothing that
//     could report back: no run_in_background call, no Agent / Task, no Monitor.
// No readable transcript is no proof it started nothing, so that passes.
const WAIT_CLAIM_RE = /\b(?:I(?:['’]ll| will| am going to|['’]m going to|['’]m| am)|let me)\s+(?:just\s+|now\s+|simply\s+)?(?:wait|waiting|hold(?:ing)? off)\b|\bwaiting\s+(?:for|on)\s+(?:the|its|their|a|an|that)\b[^.]{0,80}\b(?:notification|to (?:finish|complete|report|land|return))\b/i;
function subagentOwnTools(file) {
  let rows;
  try {
    if (!file || fs.statSync(file).size > 50 * 1024 * 1024) return null;
    rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return null; }
  const textOf = (r) => {
    const c = r && r.message && r.message.content;
    if (typeof c === 'string') return c;
    return Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
  };
  let start = 0;
  rows.forEach((r, i) => { if (r.type === 'user' && textOf(r).includes('<fork-boilerplate>')) start = i + 1; });
  const tools = [];
  for (const r of rows.slice(start)) {
    const c = r.type === 'assistant' && r.message && r.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use') tools.push(b);
  }
  return tools;
}
if (payload.hook_event_name === 'SubagentStop') {
  const text = (typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '').replace(/```[\s\S]*?```/g, ' ');
  const tools = subagentOwnTools(payload.agent_transcript_path);
  if (!tools) process.exit(0);
  const wakeup = tools.some((b) => b.name === 'ScheduleWakeup');
  const claim = WAIT_CLAIM_RE.exec(text.slice(-800));
  if (!wakeup && !claim) process.exit(0);
  const reportsBack = tools.some((b) => (b.input && b.input.run_in_background === true) || /^(Agent|Task|Monitor)$/.test(b.name));
  if (reportsBack) process.exit(0);
  const key = String(payload.agent_id || payload.agent_transcript_path).replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  const held = `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-subagent-${key}.held`;
  if (fs.existsSync(held)) process.exit(0); // held once already - never a loop
  try { fs.writeFileSync(held, new Date().toISOString()); } catch { /* the hold still fires; only the once-marker is lost */ }
  blockDetail('subagent-wait', claim ? claim[0] : 'ScheduleWakeup');
  process.stderr.write(
    'You are a subagent, and you started no background work of your own - nothing will notify or re-invoke you, '
    + 'so ending this turn ends your task undone. The wait, wakeup, loop or other agents in the history above '
    + 'belong to the session that dispatched you, not to you. Do the task in your directive now. '
    + "If you truly cannot, reply with 'BLOCKED: <reason>' and stop.\n");
  process.exit(2);
}

if (payload.hook_event_name === 'Stop') {
  if (payload.stop_hook_active) process.exit(0); // continuation we caused - never loop
  // The harness sends the turn's final text as `last_assistant_message` (Stop / SubagentStop) and
  // documents the transcript as written ASYNCHRONOUSLY - it can lag the in-memory turn, which is
  // how a live decision stop reads as the previous turn's clean close. The field wins; the
  // transcript tail is the fallback for a build that does not send it.
  let text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  if (!text.trim()) {
    const last = lastAssistantMessage();
    if (!last) { breadcrumb('Stop: no assistant message readable - passing'); process.exit(0); }
    const blocks = last.message.content;
    const hasToolUse = blocks.some((b) => b && b.type === 'tool_use');
    if (hasToolUse) {
      // The turn ended on a tool call, not prose - nothing to judge. LOGGED, never denied: how often a
      // Stop lands here is the number that says whether this early exit hides closes it should read.
      try {
        const path = require('path');
        const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || '',
          tool: '',
          mode: 'skip-tool-end',
          kind: 'tool-ended-turn',
          reason: 'skip: the turn ended on a tool call - logged, not judged',
        }) + '\n');
      } catch { /* a log row never changes the verdict and never throws */ }
      process.exit(0);
    }
    text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
    if (!text.trim()) { breadcrumb('Stop: merged message carries no text - passing'); process.exit(0); }
  }
  // Fenced spans are PAYLOAD, not prose: the fresh-session contract asks the turn to end with a
  // paste-ready resume block, and judging inside that fence made this hook block its own mandated
  // deliverable (measured: DONE_RE matched `green` and PENDING_RE matched `NOT pushed`, both inside
  // the fence; replay exit 2 at both window tiers). guard-answer-length.js's proseOf() has stripped
  // fences for the length cap all along - this is the same rule for the contract check.
  const prose = text.replace(/```[\s\S]*?```/g, ' ');
  const tail = prose.slice(-1500); // the offer lives at the end of the turn
  // ... and the done/pending halves read it with code spans, paths and negations removed (see
  // closeProse): each of those cost a measured false block on a close that asked nothing.
  const closeTail = closeProse(tail);
  // The phrase list only ever covered the shapes MEASURED in the corpus, so an ordinary
  // decision question ('What's the deploy target?', 'Which one should we go with?') walked
  // straight past it (reproduced). A turn that ends on a question and hands nothing to a tool is
  // the shape the contract is about, whatever words it uses.
  const endsOnQuestion = /\?["')\]]*\s*$/.test(tail.trim())
    || /\b(which|what|who|where|when|how|should|do you|would you|prefer)\b[^?]{0,120}\?\s*$/i.test(tail.trim());
  // ...but a question ABOUT something already settled, or a rhetorical aside mid-report, is not a
  // stop: require the question to be the turn's last word, which the tests above already encode.
  const doneClose = DONE_RE.test(closeTail) && PENDING_RE.test(closeTail) && !/\?/.test(tail)
    // A background job the user has no say over is a status line, not a pending decision -
    // blocking it forced an AskUserQuestion over 'tests are still running in CI' (reproduced).
    // ...and the harness's own idiom for a backgrounded job is part of that shape. Without these
    // spellings a pure status line ('Waiting on CI run <id> in the background - I'll merge when it
    // goes green') was blocked, and the denial's own prescribed escape then tripped PROSE_ASK_RE:
    // one status close, two blocks, from two branches of this hook (measured, 87k re-sent).
    // The THIRD spelling is the run-state VERB plus a named waiter, with no job noun anywhere: the
    // two noun-anchored forms above blocked 'the integration half (~6-7 min) is still running and
    // will notify on completion' only because the noun was 'half', and then passed the SAME close
    // reworded a minute later - 'still running' is in PENDING_RE and 'still executing' is not
    // (measured, 121,858 cache-read on the retried turn). A gate a synonym defeats teaches the
    // model to reword rather than to close properly, so the verb and the waiter are SYNONYM SETS.
    && !/\b(ci|pipeline|workflow|build|suite|tests?|job|deploy(ment)?)\b[^.\n]{0,40}\b((still )?(running|in progress|queued|pending)|in the background|backgrounded)\b/i.test(tail)
    && !/\b(in the background|backgrounded|i'?ll report back|watching (it|the run|for))\b/i.test(tail)
    && !(BACKGROUND_RE.test(tail) && WAITER_RE.test(tail))
    // ...and a close that says the run itself has nothing pending is finished, not stalled.
    && !NOTHING_PENDING_RE.test(tail);
  // A live credential that has entered this session outranks every other close: it cannot be
  // undone by a later turn, and the transcript keeps the value whatever happens next. This branch
  // runs FIRST and fires on a clean close too - three measured exposures ended exactly there.
  if (ROTATE_ASK_ON && !askJustAnswered() && !rotateAskAnswered() && (ROTATE_RE.test(prose) || (secretInSession() && !secretReadAllowed()))) {
    // Which of the two routes found the credential, in the ledger row - they are tuned separately.
    blockDetail('rotate-ask', (prose.match(ROTATE_RE) || [])[0] || 'secret shape in a tool result or a pasted message');
    process.stderr.write(
      'A credential appears to have entered this session - either named for rotation in this\n' +
      'turn, matched by shape in a tool result, or pasted into the chat. Measured seven times in\n' +
      'the audited corpus:\n' +
      'the run states it as a closing bullet, the user reads it and does not act (19m, 1h40m,\n' +
      'and one that quit 2m02s later with the token still live). A pasted or printed secret\n' +
      'CANNOT be unsent - it is in the transcript on disk and in every later request - so the\n' +
      'only open question is whether it gets rotated. End this turn with ONE AskUserQuestion:\n' +
      "'Rotate it now (Recommended)' and 'Acknowledge and defer'. Name the credential by its KEY\n" +
      'and its shape only - never repeat the value, and never pass it to a tool.\n' +
      'This ask comes once: answered, it covers every credential already in this session, and only\n' +
      'a new exposure asks again. ALFRED_CODE_ROTATE_ASK=0 in the settings.json env turns it off.',
    );
    process.exit(2);
  }
  if (!proseAsk(tail) && !doneClose && !endsOnQuestion) {
    // The turn closed cleanly - the work is DONE, which is the only moment this offer belongs at.
    // Past the window-scaled trigger, ask once per cost step whether to carry on here or resume
    // fresh; a turn that already made the offer, and a session already asked at this cost step,
    // both pass untouched.
    const usage = (() => { const l = lastAssistantMessage(); return (l && l.contextUsage) || null; })();
    if (!usage || FRESH_OFF) process.exit(0);
    const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
    // null = this window's trigger is 0, which is the user switching the offer off.
    const _fresh_at = ctxThreshold();
    if (_fresh_at === null || ctx <= _fresh_at) process.exit(0);
    if (!worthResuming(ctx)) {
      breadcrumb(`Stop: fresh-session offer skipped, ctx ${ctx} is mostly this session's own cold floor`);
      process.exit(0);
    }
    if (FRESH_RE.test(prose)) process.exit(0); // the OFFER is prose - a fenced example is not one
    const since = lastBlockCtx();
    if (since && ctx < since * REOFFER_GROWTH) {
      breadcrumb(`Stop: fresh-session offer skipped, ctx ${ctx} has not grown ${REOFFER_GROWTH}x since ${since}`);
      process.exit(0);
    }
    recordBlockCtx(ctx);
    blockDetail('fresh-session', `ctx ${ctx} > trigger ${_fresh_at}`);
    // The floor is this session's OWN first message when it is readable - the number the user can
    // check - and the measured range across the audited projects when it is not.
    const _floor = coldFloor();
    const floorLine = _floor ? `measured at ~${Math.round(_floor / 1000)}k per message on this session's first turn`
      : 'measured at 87-134k per message across the projects in the audit';
    process.stderr.write(
      // The old text claimed a resume 'costs roughly a tenth'. Eleven measurements put it at
      // 21.5-59.4% of the carried context, never under 21%, with a measured predecessor/successor
      // pair at 38.75% - so the ratio was 2-6x optimistic and it reached users verbatim inside the
      // option descriptions they then acted on. State the absolute number instead, and the number
      // the model can actually read: this turn's own per-message context.
      `The work in this turn is finished and this session now carries ~${Math.round(ctx / 1000)}k tokens per\n` +
      `message - every further turn re-sends all of it. A fresh session restarts at this\n` +
      `session's own cold floor, ${floorLine},\n` +
      `so the resume saves the difference (NOT a tenth of the carry - quote the two absolute\n` +
      `numbers, never a ratio). Before continuing here, put the choice to the user with ONE\n` +
      `AskUserQuestion call: first option 'Resume in a fresh session (Recommended)' carrying those\n` +
      `two numbers, second option continuing here. Say in the description that the harness's own\n` +
      `auto-compaction would recover a similar floor unaided, so what the resume buys is the\n` +
      `difference plus keeping the choice theirs. If they pick the resume, answer with a short ack\n` +
      `and the paste-ready\n` +
      `resume block only - do not start new work in this chat. Add nothing else to this turn: the\n` +
      `report you just wrote stands.`,
    );
    process.exit(2);
  }
  // Both remaining branches DEMAND an AskUserQuestion. If one was just answered - or declined with
  // 'clarify', which the harness answers by instructing prose - the decision is already settled and
  // demanding it again is the measured failure documented at askJustAnswered().
  if (askJustAnswered()) {
    breadcrumb('Stop: an AskUserQuestion was just answered or declined - not re-asking');
    process.exit(0);
  }
  if (doneClose && !proseAsk(tail)) {
    blockDetail('done-close', `${(closeTail.match(DONE_RE) || [])[0]} + ${(closeTail.match(PENDING_RE) || [])[0]}`);
    process.stderr.write(
      'This turn reports the step done and leaves the next action pending, stated as a fact\n' +
      'rather than asked. Measured across four projects: that close draws a literal "are you\n' +
      'finished?" from the user 2-22 minutes later. Put the pending decision (push or hold,\n' +
      'continue or stop, which deliverable next) through ONE AskUserQuestion call with the\n' +
      'options you already have in mind, recommended one marked. If nothing is actually\n' +
      'pending, say so in one line with no open next action and stop.',
    );
    process.exit(2);
  }
  blockDetail(proseAsk(tail) ? 'prose-ask' : 'ends-on-question',
    proseAskMatch(tail) || tail.trim().slice(-80));
  // The fresh-session cue used to be the literal '~150k tokens per message' - a number that is only
  // this session's trigger on a 200k window. On a 1M one the real trigger is 400,000, so two re-asks
  // measured at 267k and 352k were told to add an option the mechanism did not want (and correctly
  // did not carry). Print what this session actually measures and what this window actually uses.
  const _carry = (() => {
    const l = lastAssistantMessage();
    const u = (l && l.contextUsage) || null;
    return u ? (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0) : 0;
  })();
  const _trigger = ctxThreshold();
  const freshLine = _trigger === null
    ? 'The fresh-session offer is switched off on this install, so no resume option is expected.\n'
    : (_carry
      ? `This session carries ~${Math.round(_carry / 1000)}k tokens per message and this window's\n`
        + `fresh-session trigger is ${Math.round(_trigger / 1000)}k - past it, the resume option belongs in the\n`
        + 'same ask.\n'
      : `This window's fresh-session trigger is ${Math.round(_trigger / 1000)}k per message and this turn's own\n`
        + 'carry could not be read - past the trigger, the resume option belongs in the same ask.\n');
  process.stderr.write(
    'This turn ends on a decision-shaped question in prose. Per baseline-interaction.md a\n' +
    'blocking ask goes through the AskUserQuestion tool - a prose-only question gets skipped\n' +
    'in live runs (measured stalls: 13 minutes to 37 hours; one security decision died at\n' +
    '/exit). Re-emit the pending decision as ONE AskUserQuestion call with concrete options\n' +
    '(recommended one marked). ' + freshLine +
    'If the turn truly holds no decision -\n' +
    'the question was rhetorical or informational - restate the close WITHOUT question\n' +
    'phrasing and stop.',
  );
  process.exit(2);
}

// The context at which this session last blocked an ask for carrying no fresh-session option.
// The FIRST block is what makes the choice informed; repeating it on every later ask only
// prints an error the user has already answered (reported from a real session sitting at ~203k
// per message, where every ask opened with the same red block). So the offer is re-required
// only when the context has grown by half again since the last block - 150k -> 225k -> 337k:
// still an escalation, but one that tracks the cost actually growing rather than the ask count.
function lastBlockCtx() {
  try {
    return parseInt(fs.readFileSync(blockStateFile(), 'utf8'), 10) || 0;
  } catch {
    return 0;
  }
}
function recordBlockCtx(ctx) {
  try { fs.writeFileSync(blockStateFile(), String(ctx)); } catch { /* never let state break the gate */ }
}
function blockStateFile() {
  const os = require('os');
  const key = String(payload.transcript_path || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${envOf(process.env, 'HOOK_LOG_DIR') || os.tmpdir()}/guard-stop-fresh-${key}.blocked`;
}


// --- PreToolUse on AskUserQuestion: INJECT, never deny ---------------------
// This branch used to DENY an ask that carried no fresh-session option. That enforced the right
// thing at the wrong moment: the denial landed mid-response, so the run stopped the work it was
// doing to rebuild a question and the user watched a red block open every turn. The answer is not
// to abandon the surface - it is to stop deciding on it. This branch now emits
// `hookSpecificOutput.additionalContext` and NOTHING else: presence only, never ranks an option,
// never denies. Five separate measured failures land on exactly this surface, and four of them
// have no other route:
//   1. STALE SCOPE - an ask built on a fifty-minute-old `git status`; the sibling was committed and
//      pushed by another agent while the ask was on screen, and the user's answer was discarded
//      whole (third measured instance; baseline-git.md has mandated the fresh read twice, as prose).
//   2. CONTRADICTED REQUEST - two prompts arrived in one turn, the run answered the second and put
//      an ask whose Recommended option asserted the opposite of the first; the user took the
//      recommendation, then re-typed their first prompt verbatim 2m54s later.
//   3. FRESH SESSION - the Stop wiring cannot see a flow whose every stop is a tool call, which is
//      every CONFORMING solve-task run. This is the only route that reaches those mid-turn.
//   4. CREDENTIAL - the rotation choice belongs in the ask the turn is already making.
//   5. HOUSE VOICE - the em-dash / single-quote rule is measured 0 for 10, and an ask's own text is
//      a surface no Stop hook reads at all. The same check runs over the PROSE THIS TURN WROTE
//      BEFORE the ask: guard-answer-length.js reads the turn's final text only, so a report that
//      ends on a tool call is scanned by nobody (measured: 5 em-dashes in one such report, plus two
//      more bundles). Injection only here, because a Stop block cannot unsay text already shipped.
//   6. FLOW STOP FIELDS - a solve-task stop reports Result / Progress / Leftovers before its ask.
//      Measured across the collection: 13 sessions loaded that contract, 5 used the fields even
//      once, across 109 asks - one session missed all 12 of its own stops.
if (payload.tool_name === 'AskUserQuestion') {
  const notes = [];
  try {
    // Build the ask's text from its FIELDS. JSON.stringify would introduce double quotes of its
    // own and make the house-voice check fire on every ask ever made.
    const parts = [];
    for (const q of ((payload.tool_input || {}).questions) || []) {
      if (!q) continue;
      parts.push(String(q.question || ''), String(q.header || ''));
      for (const o of q.options || []) {
        if (!o) continue;
        parts.push(String(o.label || ''), String(o.description || ''));
      }
    }
    const askText = parts.join('\n');

    const voice = [];
    if (/[\u2014\u2013]/.test(askText)) voice.push('an em- or en-dash (use a single dash)');
    if (/"/.test(askText)) voice.push('a double quote (use single quotes)');
    if (voice.length) {
      notes.push(`This ask's own text carries ${voice.join(' and ')}. baseline-interaction.md's ` +
        `house voice covers an AskUserQuestion's question, header, labels and descriptions - a ` +
        `surface no Stop hook reads. Fix the text before sending it.`);
    }

    // 1. STALE SCOPE: an option that names repository, remote or job state is a MEASUREMENT, and a
    // measurement taken before this turn is not evidence about now.
    if (/\b(commit|push|branch|pull request|\bPRs?\b|merge|rebase|stash|staged|unstaged|uncommitted|untracked|remote|upstream|deploy(ed|ment)?|pipeline|\bCI\b|workflow run|job)\b/i.test(askText)
        && !freshStateReadThisTurn()) {
      notes.push('An option here names repository, remote or job state and no `git status` / ' +
        '`git diff` / `gh` call ran in this turn. Derive that scope FRESH before asking - a ' +
        'fifty-minute-old read had already been overtaken by another agent while the ask was on ' +
        'screen, and the answer it produced was discarded whole.');
    }

    // 2. CONTRADICTED REQUEST: the presence signal is two typed turns arriving before one reply.
    if (typedTurnsBeforeThisReply() >= 2) {
      notes.push('The user sent more than one message before this reply. Check every option, and ' +
        'the Recommended one first, against BOTH - an ask whose recommendation contradicted an ' +
        'un-actioned earlier request was taken by the user, who then re-typed that request verbatim.');
    }

    // 3. FRESH SESSION. No recordBlockCtx here: this is a note, not the ask itself, so it must not
    // consume the cost step the Stop wiring's real offer is owed.
    // TWO routes to the same note. The context one is the trigger; the CLOCK one is the flows' own
    // 'spans hours / resumes after an idle gap' clause, which is prose and slipped in 3 of 3 bundles
    // that tested it - measured: 12 asks over 3h+ and a two-day idle gap carried no option at all
    // and the resume then re-carried ~346k. The clock route makes no offer the resume would not pay
    // for: worthResuming() is the same arithmetic the size trigger uses, so a carry that is mostly
    // this install's own cold floor stays quiet however long the session has been open.
    if (!FRESH_OFF && !FRESH_RE.test(askText)) {
      const u = (() => { const l = lastAssistantMessage(); return (l && l.contextUsage) || null; })();
      const ctx = u ? (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0) : 0;
      const since = lastBlockCtx();
      const at = ctxThreshold();   // null = this window's trigger is switched off
      const clock = sessionClock();
      const overHours = FRESH_AFTER_HOURS > 0 && Math.max(clock.spanH, clock.gapH) >= FRESH_AFTER_HOURS;
      const overCtx = at !== null && ctx > at;
      if ((overCtx || (overHours && ctx > 0 && worthResuming(ctx))) && !(since && ctx < since * REOFFER_GROWTH)) {
        // The two ABSOLUTE numbers the flows' stop step has to quote and measured 0 of 2 in one run
        // and 'a fraction of the token cost' in another: what a message costs now, and what a fresh
        // one starts at. Both are read from this session, never estimated.
        const floor = coldFloor();
        const why = overCtx
          ? `is past this window's fresh-session trigger (${at === null ? 'off' : Math.round(at / 1000) + 'k'})`
          : `has been open ${Math.max(clock.spanH, clock.gapH).toFixed(1)}h`;
        notes.push(`This session carries ~${Math.round(ctx / 1000)}k tokens per message, ${why}, and every `
          + `further turn re-sends all of it. A fresh session restarts at `
          + `${floor ? `~${Math.round(floor / 1000)}k - this session's own first message` : 'this install\'s cold floor, 87-134k across the audited projects'}. `
          + `If this ask is about what to do NEXT, add an option to resume in a fresh session and `
          + `quote those two absolute numbers in its description - never a ratio.`);
      }
    }

    // 5. HOUSE VOICE, second surface: the prose THIS TURN wrote before the ask. No Stop hook reads
    // it, because the turn it belongs to ended on a tool call.
    const turnText = turnProseBeforeAsk();
    if (/[\u2014\u2015]/.test(turnText)) {
      notes.push(`The prose this turn wrote before this ask carries an em-dash. The house voice is `
        + `single dashes (baseline-interaction.md), and the turn's final text is the only surface `
        + `the answer-length hook reads - anything written before a tool call is checked here or `
        + `nowhere. Use single dashes for the rest of this turn.`);
    }

    // 6. FLOW STOP FIELDS: a solve-task stop names three fields before its ask. Bold counts - it is
    // what the sessions that did comply actually wrote.
    if (solveTaskCycle()) {
      const field = (name) => new RegExp(`(^|\\n)\\s*(?:[-*+]\\s*)?\\**${name}:`, 'i');
      const stamped = (t) => field('Result').test(t) && field('Progress').test(t) && field('Leftovers').test(t);
      if (!stamped(turnText) && !stamped(askText)) {
        notes.push('This is a stop in a solve-task cycle. Its contract reports THREE named fields '
          + 'before the ask - `Result:` (one line plus the artifact path), `Progress:` (<N> of <M> '
          + 'steps), `Leftovers:` (what this run started and did not finish, or `none`). Markdown-bold '
          + 'spelling counts. Measured: 13 sessions loaded this contract and 5 used the fields at all, '
          + 'across 109 asks - the named form is what survives a compaction that eats the prose.');
      }
    }

    // 4. CREDENTIAL.
    if (secretInSession()) {
      notes.push('A credential-shaped value has already entered this session\'s tool results. It ' +
        'cannot be unsent. If this ask closes the turn, one of its questions must be whether to ' +
        'rotate it now - name the key and its shape only, never the value.');
    }
  } catch { /* fail-open: an injection is never worth breaking an ask over */ }

  if (notes.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notes.join('\n\n') },
    }));
  }
  process.exit(0);
}

// How long this session has been open, and the longest IDLE gap inside its tail - both in hours,
// both read from the transcript's own `timestamp` rows so a clock skew or a paused machine cannot
// invent one. The newest row is 'now': a wall-clock read would make the number depend on when the
// hook happened to run.
function sessionClock() {
  try {
    const p = payload.transcript_path;
    if (!p) return { spanH: 0, gapH: 0 };
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    fs.readSync(fd, head, 0, head.length, 0);
    const start = Math.max(0, size - 256 * 1024);
    const tailBuf = Buffer.alloc(size - start);
    fs.readSync(fd, tailBuf, 0, tailBuf.length, start);
    fs.closeSync(fd);
    const at = (line) => {
      const m = /"timestamp"\s*:\s*"([^"]+)"/.exec(line);
      const t = m ? Date.parse(m[1]) : NaN;
      return Number.isNaN(t) ? null : t;
    };
    let first = null;
    for (const line of head.toString('utf8').split('\n')) { const t = at(line); if (t) { first = t; break; } }
    let prev = null; let gap = 0; let last = null;
    for (const line of tailBuf.toString('utf8').split('\n')) {
      const t = at(line);
      if (!t) continue;
      if (prev && t - prev > gap) gap = t - prev;
      prev = t; last = t;
    }
    const H = 3600 * 1000;
    return { spanH: first && last && last > first ? (last - first) / H : 0, gapH: gap / H };
  } catch {
    return { spanH: 0, gapH: 0 };   // unreadable clock - this route simply does not fire
  }
}

// The assistant prose written in THIS turn, before the ask now being made: every text block after
// the last typed user row. That is the surface guard-answer-length.js cannot reach, because the
// message it belongs to ends on a tool call.
function turnProseBeforeAsk() {
  try {
    const p = payload.transcript_path;
    if (!p) return '';
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!o || !o.message) continue;
      if (o.type === 'user' && isTypedTurn(o)) break;   // the turn boundary
      if (o.type === 'assistant' && Array.isArray(o.message.content)) {
        out.unshift(o.message.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n'));
      }
    }
    // Fenced spans are payload, not prose - the same rule the Stop branch applies to a close.
    return out.join('\n').replace(/```[\s\S]*?```/g, ' ');
  } catch {
    return '';
  }
}

// Is this ask a stop inside a solve-task cycle? The cheap, transcript-local proof: the flow was
// invoked in this session, by its slash marker or as a Skill call. A session that never ran the
// flow is never asked for the flow's stamp.
function solveTaskCycle() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return /<command-name>\s*\/?project-solve-(cross-)?task\s*<\/command-name>|"skill"\s*:\s*"[^"]*project-solve-(cross-)?task/.test(buf.toString('utf8'));
  } catch {
    return false;
  }
}

// Did a repository/remote state read run since the last typed user turn? The ask's scope has to be
// derived at ask time, and the cheap proof of that is a state-reading call in the same turn.
function freshStateReadThisTurn() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    // walk BACKWARDS to the turn boundary - the last typed (non-tool_result) user row
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || !o.message) continue;
      if (o.type === 'user' && isTypedTurn(o)) return false;
      if (o.type === 'assistant' && Array.isArray(o.message.content)) {
        for (const b of o.message.content) {
          if (!b || b.type !== 'tool_use' || b.name !== 'Bash') continue;
          const cmd = String((b.input && b.input.command) || '');
          if (/\bgit\s+(status|diff|log|show|rev-parse|rev-list|ls-files|fetch)\b|\bgh\s+(pr|run|api|repo)\b/.test(cmd)) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// A user row is a TYPED turn only when it carries text and no tool_result - a tool result arrives
// as a user message, and counting those made every turn look like a multi-prompt turn.
function isTypedTurn(o) {
  const c = o.message.content;
  if (typeof c === 'string') return !o.isMeta && c.trim().length > 0;
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b && b.type === 'tool_result')) return false;
  return !o.isMeta && c.some((b) => b && b.type === 'text' && String(b.text || '').trim());
}

// How many typed turns the user sent before the reply now in progress. Two or more is the shape
// that produced the contradicted-recommendation failure.
function typedTurnsBeforeThisReply() {
  try {
    const p = payload.transcript_path;
    if (!p) return 0;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let run = 0;
    let last = 0;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || !o.message) continue;
      if (o.type === 'user' && isTypedTurn(o)) { run += 1; continue; }
      if (o.type === 'assistant' && run > 0) { last = run; run = 0; }
    }
    return run > 0 ? run : last;
  } catch {
    return 0;
  }
}

