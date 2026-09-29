#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Four wirings, one contract: the blocking-ask mandate (baseline-interaction.md) and the
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
//   It also carries the DONE-GATE PROBE, log-only: a close claiming the change done / fixed / passing /
//   works / ready over a turn with a source edit (a file tool's, or a shell write read through
//   shell-writes.js) writes one row per turn - `unrun` when the edit landed after the turn's last run
//   (ALFRED_CODE_DONE_GATE=0 off). And the RATIONALIZATION PROBE, log-only: a close dismissing a
//   failure in a turn with a red run, a skipped test or an added skip marker writes one row per turn.
// PostToolUse + PostToolUseFailure (Bash|PowerShell) wiring: LOG-ONLY - a red build or test run writes one
//   probe row per failure streak (where `alfred-habits-root-cause` was needed); the streak ends when every
//   command that ran red in it has run green again, or after an hour with no red run.
// SubagentStop wiring: a subagent that closes on a wait nobody will end, with no background work of
//   its own, is held once and told to do its directive (see the branch below for the field report).
// PreToolUse (AskUserQuestion) wiring: the judgement notes are INJECTED - `hookSpecificOutput.additionalContext`,
//   presence-only, never ranking an option - and land beside the user's ANSWER, so each is worded for
//   that moment. It carries the four checks that have no other route (stale ask scope, a recommendation
//   contradicting an un-actioned request, the fresh-session offer for a flow whose every stop is a tool
//   call, and a live credential). The one DENY is the house voice of the ask's own text, once per ask
//   text, carrying the corrected strings (I3, 2.1.4 audit). The fresh-session DENIAL this matcher used
//   to carry is gone for good: it fired mid-response and cost the user a red block every turn.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let unattended = () => false;
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    unattended = prelude.unattended || unattended;
    if (prelude.standDown('guard-stop-contract')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
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

// --- build and test runs: one classifier for the two method triggers -----------------------------
// A command is a build or test run when one of its segments STARTS with a known runner, after env
// assignments and wrappers (npx, time, env). Quoted strings and heredoc bodies are arguments, never
// the command: `grep -rn "npm test" docs` is a search. The KIND names the runner; the KEY is the run
// as typed, less its wrappers and redirections - `npm test` piped to `tail` is the same run as
// `npm test`, and `npm test -- -t cart` is a scoped run of it. This list is NARROW on purpose: a
// runner it misses costs the root-cause probe one row. The done gate asks a wider question below.
const SHELL_TOOL_RE = /^(?:Bash|PowerShell)$/;
const RUNNERS = [
  [/^(jest|vitest|mocha|ava|karma|pytest|tsc|playwright\s+test|cypress\s+run)(?=\s|$)/, (m) => m[1].replace(/\s+/g, ' ')],
  [/^(npm|pnpm|yarn|bun)\s+(?:run\s+)?(?!lint)(t|test|build|[\w:.-]*(?:test|build|check|typecheck|compile)[\w:.-]*)(?=\s|$)/, (m) => `${m[1]} ${m[2]}`],
  [/^node\s+(?:--[\w-]+(?:=\S+)?\s+)*--test(?=\s|$)/, () => 'node --test'],
  [/^(?:python3?|py)\s+-m\s+(pytest|unittest)(?=\s|$)/, (m) => m[1]],
  [/^dotnet\s+(build|test)(?=\s|$)/, (m) => `dotnet ${m[1]}`],
  [/^(ng|nx)\s+(build|test)(?=\s|$)/, (m) => `${m[1]} ${m[2]}`],
  [/^go\s+(build|test|vet)(?=\s|$)/, (m) => `go ${m[1]}`],
  [/^cargo\s+(build|test|check|clippy|nextest)(?=\s|$)/, (m) => `cargo ${m[1]}`],
  [/^(?:\.[\\/])?(mvnw?|gradlew?)(?:\.bat|\.cmd)?(?:\s+-[\w.=:-]+)*(?:\s+[\w:-]+)*?\s+(test|verify|package|install|compile|build|check|assemble)(?=\s|$)/, (m) => `${m[1].replace(/w$/, '')} ${m[2]}`],
];
const WRAPPER_RE = /^(?:[A-Za-z_]\w*=\S*|time|timeout\s+\S+|command|exec|nice|sudo|env(?:\s+-u\s+\S+|\s+-\w+)*|npx(?:\s+-[-\w]+)*|bunx|(?:pnpm|yarn)\s+(?:exec|dlx))\s+/;
const stripWrappers = (seg, re) => { for (let prev = ''; prev !== seg;) { prev = seg; seg = seg.replace(re, ''); } return seg; };
function buildTestRun(command) {
  const cmd = String(command || '')
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1(?=\s|$)/g, ' ')
    .replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, ' ')
    .replace(/\d*[<>]&\d*-?|&>>?/g, ' ');
  for (const raw of cmd.split(/&&|\|\||[;|&\n]/)) {
    const seg = stripWrappers(raw.trim().replace(/^[({]+\s*/, ''), WRAPPER_RE);
    for (const [re, name] of RUNNERS) {
      const m = re.exec(seg);
      if (m) return { kind: name(m), key: seg.replace(/\s*\d*>>?\s*\S+/g, '').replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}
const buildTestKind = (command) => (buildTestRun(command) || {}).kind || null;

// One MEASUREMENT row in the hook-blocks ledger: it carries a `mode`, which the analyzer reads as a
// probe and never as a block. Best-effort - a lost row is a lost measurement, never a changed turn.
function ledgerRow(row) {
  try {
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: path.basename(__filename), event: payload.hook_event_name || '', tool: payload.tool_name || '', ...row,
    }) + '\n');
  } catch { /* never throws */ }
}

// --- PostToolUse / PostToolUseFailure on Bash and PowerShell: a red run, measured ---------------------
// The fix that follows a red run is where a guess lands - where `alfred-habits-root-cause` is NEEDED.
// LOG-ONLY since 2026-09-25 (the user's ruling: rely on the skill's description and the flows that
// load it, and count the misses): a build or test command that FAILED writes one `mode: probe` row per
// failure streak and says nothing to the model. The row carries the run's `tool_use_id` and actor, so
// `analyze-usage.js --hook-blocks` reads the transcript after it - the skill loaded before the next
// fix, after it, or never. A piped run (`npm test | tail`) exits 0 whatever the tests did, so a green
// exit is read for the runner's own red summary too. The streak is per session and per actor - a
// subagent's red run is its own - and ONE per actor: a second spelling of the failing suite (`npm
// test`, then `npx vitest run`), or another red run inside the same stretch, is the same need. Each
// red run's KEY stays open until that run is green again (an unscoped green also closes its scoped
// runs; a scoped green never closes the full suite), and a new row comes only once no key is open. A
// key with no red run for an hour lapses, so a suite the session stopped running never mutes it.
const RED_SUMMARY_RE = /(?:^|\n)\s*(?:ℹ|#)\s*fail\s+[1-9]|\b[1-9]\d*\s+(?:failed|failing)\b|\bFailed:\s*[1-9]|\bBuild FAILED\b|\bBUILD (?:FAILED|FAILURE)\b|\berror (?:TS|CS|NG|MSB|NETSDK)\d+|(?:^|\n)npm (?:ERR!|error)\s|(?:^|\n)\s*FAIL\s|(?:^|\n)--- FAIL:|test result: FAILED|✘ \[ERROR\]|\berror\[E\d{4}\]|\berror: could not compile\b/;
// The Angular CLI's own verdict is a bare `Error:` line - too common in a passing run's logs to read
// as red for any other runner.
const NG_RED_RE = /(?:^|\n)Error: /;
// A run that SKIPPED tests says so in its own summary (node --test, jest, vitest, pytest, mocha's
// 'pending', dotnet's 'Skipped:'); an edit that adds a skip marker skips one at the source. Both are
// what the rationalization probe below counts as something to dismiss, beside a red run.
const SKIPPED_RE = /(?:^|\n)\s*(?:ℹ|#)\s*(?:skipped|skip)\s+[1-9]|\b[1-9]\d*\s+(?:skipped|pending)\b|\bSkipped:\s*[1-9]/;
const SKIP_MARKER_RE = /\b(?:it|test|describe|context)\.skip\s*\(|\bx(?:it|test|describe)\s*\(|\bSkip\s*=\s*["']|@pytest\.mark\.skip|\bt\.skip\s*\(|\[Ignore\b|@Disabled\b|\{\s*skip\s*:\s*true/;
const STREAK_TTL_MS = 60 * 60 * 1000;
function runFailed(p, kind) {
  if (p.hook_event_name === 'PostToolUseFailure') return p.is_interrupt ? null : true;
  const r = p.tool_response;
  const red = (text) => RED_SUMMARY_RE.test(text) || (/^(?:ng|nx) /.test(kind || '') && NG_RED_RE.test(text));
  if (typeof r === 'string') return red(r.slice(-4096));
  if (!r || typeof r !== 'object' || r.interrupted) return null;
  const code = r.exitCode !== undefined ? r.exitCode : r.exit_code;
  if (typeof code === 'number' && code !== 0) return true;
  return red(`${r.stdout || ''}\n${r.stderr || ''}`.slice(-4096));
}
if (payload.hook_event_name === 'PostToolUse' || payload.hook_event_name === 'PostToolUseFailure') {
  if (!SHELL_TOOL_RE.test(String(payload.tool_name || ''))) process.exit(0);
  const input = payload.tool_input;
  const runOf = buildTestRun(typeof input === 'string' ? input : input && input.command);
  const kind = runOf ? runOf.kind : null;
  const failed = kind ? runFailed(payload, kind) : null;
  if (failed === null) process.exit(0);
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9-]/g, '_').slice(-80);
  const stateFile = `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-rootcause-${safe(payload.session_id || 'nosession')}-${safe(payload.agent_id || 'main')}.json`;
  let streaks = {};
  try { streaks = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch { /* no streak yet */ }
  const now = Date.now();
  const open = Object.keys(streaks).filter((k) => now - Date.parse(streaks[k]) < STREAK_TTL_MS);
  const save = (next) => { try { fs.writeFileSync(stateFile, JSON.stringify(next)); } catch { /* a lost marker re-injects once - never a block */ } };
  if (!failed) {
    const left = open.filter((k) => k !== runOf.key && !k.startsWith(`${runOf.key} `));
    if (left.length !== Object.keys(streaks).length) save(Object.fromEntries(left.map((k) => [k, streaks[k]])));
    process.exit(0);
  }
  save({ ...Object.fromEntries(open.map((k) => [k, streaks[k]])), [runOf.key]: new Date(now).toISOString() });
  if (open.length) process.exit(0); // logged once already in this streak
  ledgerRow({
    mode: 'probe', kind: 'root-cause', reason: `probe: a red ${kind} run - logged, nothing injected`,
    detail: { run: kind, key: runOf.key, tool_use_id: payload.tool_use_id || null, agent: payload.agent_id || null, agent_type: payload.agent_type || null },
  });
  process.exit(0);
}

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
// alfred-loop-quality's two structural pauses - the run-start mode ask and the stage-close
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
// Only what the MODEL was sent counts. The CLI stores its own copy of every tool result beside the one
// it sends (`toolUseResult` - an Edit's whole `originalFile`, a Read's `file.content`), and that copy
// never reaches the model: pilot 3's guard-02 cells asked for rotation on a JWT the secret guard had
// kept out of context, found only in the Edit's `originalFile` (2 of 12 print finals replaced). A torn
// row - the tail window's first line, or one still being written - is judged up to the stored copy,
// which the CLI writes after `message`.
function visibleRow(line) {
  try {
    return JSON.stringify(JSON.parse(line), (k, v) => (k === 'toolUseResult' ? undefined : v));
  } catch {
    const at = line.indexOf('"toolUseResult"');
    return at < 0 ? line : line.slice(0, at);
  }
}
// The window is the whole session up to 64MB, read once per run: pilot 3's ecc guard-02 cells read the
// JWT 250-300KB before a print turn ended, outside the old 256KB tail (only the Edit's stored copy near
// the end had caught them). A 32MB transcript scans in about 110 ms.
let TAIL = null;
function transcriptTail() {
  if (TAIL !== null) return TAIL;
  const p = payload.transcript_path;
  if (!p) return (TAIL = '');
  const size = fs.statSync(p).size;
  const start = Math.max(0, size - 64 * 1024 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return (TAIL = buf.toString('utf8'));
}
// The newest row that put a credential shape in front of the model, or null.
function secretExposure() {
  try {
    let found = null;
    for (const line of transcriptTail().split('\n')) {
      if (!SECRET_SHAPE.test(line)) continue;
      const seen = visibleRow(line);
      // USER-role rows: both the tool_results the model's own reads returned, and the user's own
      // typed or pasted text. The assistant's own text is judged separately, by ROTATE_RE.
      if (!seen.includes('"tool_result"') && !/"type"\s*:\s*"user"/.test(seen)) continue;
      if (SECRET_SHAPE.test(seen)) found = line;
    }
    return found;
  } catch {
    return null;
  }
}
const secretInSession = () => secretExposure() !== null;

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
// again. Judged over the same window secretExposure reads, and fail-open like it.
// ALFRED_CODE_ROTATE_ASK=0 in the settings.json env turns the branch off for a user who accepts
// the exposure - the value is in the transcript either way, so that is theirs to decide.
const ROTATE_ASK_ON = envOf(process.env, 'ROTATE_ASK') !== '0';
const ROTATE_ANSWER_RE = /Your questions have been answered:[^\n]*?(rotat|revok|acknowledge and defer)/i;
// ANY answered or declined ask after this hook's own rotate-ask block is the answer to it (review of pilot 4, M3): a
// free-text 'Other' ('leave it, test token') or a question worded without 'rotate' matched nothing above, so the ask
// came back every turn. The block is the harness's hook-feedback row carrying ROTATE_ASK_HEAD - never a tool result,
// which is how the model reading this file would carry it.
const ROTATE_ASK_HEAD = 'A credential appears to have entered this session';
const ANY_ANSWER_RE = /"(?:content|text)"\s*:\s*"(?:Your questions have been answered:|The user (?:declined|chose not) to answer)/;
const isRotateBlock = (line) => line.includes(ROTATE_ASK_HEAD) && !line.includes('"tool_result"') && /Stop hook feedback|"stop_hook_summary"/.test(line);
function rotateAskAnswered() {
  try {
    let lastAnswer = -1;
    let lastShape = -1;
    let lastBlock = -1;
    transcriptTail().split('\n').forEach((line, i) => {
      if (isRotateBlock(line)) lastBlock = i;
      if (ROTATE_ANSWER_RE.test(line) || (lastBlock >= 0 && ANY_ANSWER_RE.test(line))) lastAnswer = i;
      if (SECRET_SHAPE.test(line) && SECRET_SHAPE.test(visibleRow(line))) lastShape = i;
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
// The matched text is the model's own prose, and a close can quote a credential - the row and the
// breadcrumb are files on disk, so a value in them is a second copy of the exposure. Redacted first.
function blockDetail(branch, matched) {
  const detail = { branch, matched: String(matched == null ? '' : matched).replace(new RegExp(SECRET_SHAPE.source, 'g'), '<redacted>').slice(0, 120) };
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
  if (payload.stop_hook_active) process.exit(0); // a continuation this hook caused - the once-marker's twin, never a loop
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

// --- Stop: the done-gate probe - a done claim over a turn's source edit, measured ---------------------
// 'Fixed' typed over a change nothing ran is the claim `alfred-habits-done-gate` exists to stop. LOG-ONLY
// since 2026-09-25: a close claiming the change done, fixed, passing, works or ready over a turn with a
// source edit writes one probe row per turn - `unrun` when the edit landed after the turn's last run, or
// none ran - and the analyzer counts the misses; it never holds the close.
// The CLAIM is a claim shape, never the word: 'how it works', 'a fixed trigger', 'the done gate', a
// second-person 'when you're ready' and a colour ('the header is green') pass, and a sentence saying
// it did not run disarms itself - only the skill's own 'not run - <why>' result line (a dash or colon
// after 'not run') disarms the close; 'Not tested on Windows.' is a caveat, never that line (C1).
// A source edit is a write that landed inside the project, outside `.claude/` and the docs root, on no
// prose file and none of git's own (`.gitignore`, `.gitattributes`, `.git/`): a file tool's, or a shell
// write (redirection, `tee`, in-place `sed`/`perl`, a copy or move destination, `rm`, an interpreter
// script's literal path) read through shell-writes.js - under a Bash-first harness the shell IS the
// write route. What a rule-following close writes after its check is none either (C2): a path git
// ignores (one `git check-ignore`, at a Stop that holds a claim over edits past the last run), and a
// path this turn created and then deleted - the scratch the quality-gates baseline says to delete.
// A RUN is wider than the root-cause list above,
// because here a miss counts an honest close as unrun: any shell command that is not a read, a write, git or a
// package install counts, and so does a dispatched agent (its own runs are in its own transcript).
// A run's own output file is no edit. A call a hook denied before it ran counts as neither.
const EDIT_TOOL_RE = /^(?:Edit|Write|MultiEdit|NotebookEdit)$/;
const DONE_GATE_SKILL_RE = /(?:^|:)alfred-habits-done-gate$/;
const DISPATCH_TOOL_RE = /^(?:Agent|Task)$/;
const PROSE_FILE_RE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;
// git's own bookkeeping, never a build input: setup's git-hygiene write lands here (B-M5)
const GIT_OWN_RE = /(?:^|[\\/])\.git(?:[\\/]|$|ignore$|attributes$)/i;
// a shell write that makes the whole file, so deleting that path later in the turn undoes it (C2)
const MAKES_WHAT_RE = /^(?:a shell redirection|a `tee` write|a copy\/move destination|an interpreter write)$/;
// what a run leaves behind, never a source file: `make test > test.log`, `| tee run.out`
const RUN_OUTPUT_RE = /\.(?:log|out|err|tmp|temp|bak|orig|rej|pid|trx)$/i;
// a shell write that changes no source content: a directory, a mode, an empty file
const NO_CONTENT_VERB_RE = /^(?:mkdir|rmdir|touch|chmod|chown)$/;
const DONE_NOISE_RE = /\bdone[- ](?:gate|word|claim)s?\b|\bdefinition of done\b/gi;
const NOT_RUN_RE = /\b(?:could ?n[o']?t|can ?n[o']?t|cannot|unable to|did ?n[o']?t|was ?n[o']?t able to|ha(?:ve|s) ?n[o']?t)\s+(?:yet\s+)?(?:be(?:en)?\s+)?(?:run|ran|build|built|test|tested|verif(?:y|ied)|execut(?:e|ed))\b|\bnot (?:yet )?(?:run|built|tested|verified)\b|\b(?:untested|unverified)\b/i;
// the result line `alfred-habits-done-gate` asks for in place of a claim: 'not run - <why>' (C1)
const NOT_RUN_LINE_RE = /^not (?:yet )?run\**\s*[-:\u2013\u2014]/i;
// 'when you're ready', 'once you are done reviewing' - the user's state, not the change's
const YOU_CLAUSE_RE = /\byou(?:'re|\u2019re|\s+are|\s+were|'ve been|\s+have been)\b[^,;]*/gi;
// 'once the cache warms', 'if it works for you' - a condition, never a claim
const COND_CLAUSE_RE = /\b(?:when|whenever|once|until|unless|if|as soon as)\b[^,;]*/gi;
const CLAIM_RES = [
  /^(?:all |now |everything(?:'s| is) )?(done|fixed|ready|works|passing|resolved)\b/i,
  /\b(?:is|are|'s|'re|was|were|be|been|now|looks?|seems?)\s+(?:now\s+|all\s+|fully\s+|already\s+)?(done|fixed|ready|working|passing|resolved)\b(?!\s+(?:by|at|on)\b)/i,
  /(?<!\b(?:how|what|why|where|whether|if)\s)\b(?:tests?|suites?|specs?|builds?|checks?|it|this|that|everything|all)\s+(?:now\s+|all\s+|should\s+|will\s+)?(pass(?:es|ing)?|works?|succeeds?)\b/i,
  /\b(works|passes)\s+(?:now|again|fine|correctly|as expected)\b/i,
  /\bI(?:'ve| have)?\s+(?:now\s+|just\s+)?(fixed)\b/i,
  // green only over a build or test subject - 'the header is green' is a colour
  /\b(?:tests?|suites?|specs?|builds?|ci|checks?|pipelines?|runs?)\s+(?:(?:is|are|'s|'re|was|were|looks?|seems?|stays?|now)\s+)*(?:all\s+)?(green)\b/i,
  /^all\s+(green)\b/i,
  // the signs `alfred-habits-done-gate` names: 'this fixes it', 'should be good to go', 'all set'
  /(?<!\b(?:how|what|why|whether|if)\s)\b(?:this|that|it|which)\s+(?:should\s+|will\s+|now\s+)?(fix(?:es)?)\s+(?:it|this|that|the|a|an)\b/i,
  /\b(good to go)\b/i,
  /(?:^|\b(?:is|are|'s|'re)\s+)all\s+(set)\b/i,
];
function doneClaim(text) {
  const sentences = String(text || '').replace(DONE_NOISE_RE, ' ').split(/(?<=[.!?])\s+|\n+/)
    .map((raw) => raw.trim().replace(/^(?:[-*>]|\d+\.)\s+/, '').replace(/^\*\*|\*\*$/g, ''));
  if (sentences.some((s) => NOT_RUN_LINE_RE.test(s))) return null; // the honest close the skill asks for
  for (const whole of sentences) {
    if (!whole || /\?["')\]*]*$/.test(whole)) continue; // a question claims nothing
    if (NOT_RUN_RE.test(whole)) continue; // this sentence says it did not run
    const s = whole.replace(YOU_CLAUSE_RE, ' ').replace(COND_CLAUSE_RE, ' ').replace(/^[\s,;:-]+/, '');
    for (const re of CLAIM_RES) {
      const m = re.exec(s);
      if (m && !/\b(?:not|never|no|nothing|yet to)\s+(?:\w+\s+)?$|n't\s+(?:\w+\s+)?$/i.test(s.slice(Math.max(0, m.index - 30), m.index + m[0].length - m[1].length))) return m[1];
    }
  }
  return null;
}

// --- what ran: the done gate's own, wider question --------------------------------------------------
// Not a run: a read, a navigation, a write verb, git, a shell keyword or builtin, and the PowerShell
// cmdlets of the same families (Invoke-Pester and the like stay runs).
const NOT_A_RUN_RE = new RegExp('^(?:' + [
  'cat', 'bat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'ls', 'll', 'dir', 'tree', 'wc', 'file',
  'stat', 'du', 'df', 'echo', 'printf', 'pwd', 'which', 'where', 'whereis', 'type', 'cd', 'pushd', 'popd', 'true', 'false', ':', 'sleep', 'wait',
  'date', 'whoami', 'hostname', 'uname', 'id', 'export', 'set', 'unset', 'alias', 'source', '\\.', 'diff', 'cmp', 'comm', 'sort', 'uniq', 'cut',
  'tr', 'paste', 'column', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'jq', 'yq', 'sed', 'awk', 'gawk', 'tee', 'cp', 'mv', 'rm', 'rmdir', 'mkdir',
  'touch', 'truncate', 'chmod', 'chown', 'ln', 'install', 'rsync', 'git', 'gh', 'open', 'xdg-open', 'start', 'code', 'clear', 'basename',
  'dirname', 'realpath', 'readlink', 'mktemp', 'history', 'kill', 'pkill', 'killall', 'ps', 'pgrep', 'lsof', 'xargs', 'base64', 'shasum',
  'sha256sum', 'md5', 'md5sum', 'cksum', 'zip', 'unzip', 'tar', 'gzip', 'gunzip', 'exit', 'return', 'read', 'for', 'while', 'until', 'do',
  'done', 'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'in', 'function', 'test', '\\[\\[?',
  '(?:get|set|add|out|write|select|where|foreach|measure|test|new|remove|copy|move|rename|resolve|split|join|format|sort|group|compare|convertto|convertfrom|clear|push|pop)-[a-z]+',
].join('|') + ')$', 'i');
// a package manager fetching or listing, never building or testing
const NOT_A_RUN_CMD_RE = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|remove|rm|uninstall|un|view|info|ls|list|outdated|why|config|init|link|login|whoami|pack|publish|version)|pip3?\s+(?:install|uninstall|list|show|freeze|download)|(?:python3?|py)\s+-m\s+pip|dotnet\s+(?:restore|add|new|tool|nuget|remove|list|sln)|(?:uv|poetry|pdm)\s+(?:add|remove|sync|lock|install|pip|show)|cargo\s+(?:add|remove|install|update|fetch)|go\s+(?:get|mod)|brew|apt(?:-get)?)(?=\s|$)/i;
const RUN_WRAPPER_RE = /^(?:[A-Za-z_]\w*=\S*|time|timeout\s+\S+|command|exec|nice|sudo|env(?:\s+-u\s+\S+|\s+-\w+)*|npx(?:\s+-[-\w]+)*|bunx|(?:pnpm|yarn)\s+(?:exec|dlx)|(?:uv|poetry|pipenv|hatch|pdm|rye)\s+run|bundle\s+exec|xvfb-run|then|do|else|if|while|until|!)\s+/;
let shellWrites = null;
try { shellWrites = require(require('path').join(__dirname, 'shell-writes.js')); } catch { /* a copy that runs before it lands counts no shell edit */ }
// A shell call, as ordered steps: { index, run } for a segment that ran something, { index, file,
// make, del, mkdir } for a written path, resolved from `root` through the call's own `cd`s - `make` a
// whole-file write, `del` a removal (`rm`, a move's source), `mkdir` a directory made (no edit, only
// what a later removal can undo). Without shell-writes.js beside the hook, the whole call is one run.
function shellSteps(command, root) {
  const cmd = String(command || '');
  if (!shellWrites) return cmd.trim() ? [{ index: 0, run: cmd.trim().replace(/\s+/g, ' ').slice(0, 60) }] : [];
  const scan = shellWrites.scanShell(cmd);
  const chars = scan.command.split('');
  for (const [a, b] of scan.quoted) for (let i = a; i < b; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  const masked = chars.join('').replace(/\d*[<>]&\d*-?|&>>?/g, (m) => ' '.repeat(m.length));
  const cuts = [...masked.matchAll(/&&|\|\||[;|&\n]/g)];
  const out = [];
  let from = 0;
  for (const cut of cuts.concat([{ index: masked.length, 0: '' }])) {
    const at = from;
    const end = cut.index;
    from = cut.index + cut[0].length;
    const text = masked.slice(at, end);
    if (!text.trim()) continue;
    const mine = scan.targets.filter((t) => t.index >= at && t.index < end);
    const kind = buildTestKind(text);
    const head = stripWrappers(text.trim().replace(/^[({]+\s*/, ''), RUN_WRAPPER_RE);
    const word = head.split(/\s+/)[0] || '';
    const edits = mine.some((t) => t.what === 'an in-place edit' || t.what === 'an interpreter write');
    if (kind || (!edits && word && !NOT_A_RUN_RE.test(word) && !NOT_A_RUN_CMD_RE.test(head))) {
      out.push({ index: at, run: kind || scan.command.slice(at, end).trim().replace(/\s+/g, ' ').slice(0, 60) });
      continue; // a run's own redirection is its output, never an edit
    }
    for (const t of mine) {
      const mkdir = t.verb === 'mkdir';
      if ((NO_CONTENT_VERB_RE.test(t.verb) && !mkdir) || /^a git write/.test(t.what)) continue;
      const raw = scan.expandVars(t.raw);
      if (shellWrites.isVar(raw) || raw.startsWith('~')) continue;
      const base = shellWrites.anchorAt(scan.cds, t.index, root);
      if (base === null && !require('path').isAbsolute(raw)) continue; // relative to a cd it cannot follow
      out.push({ index: t.index, file: require('path').resolve(base || root, raw), make: MAKES_WHAT_RE.test(t.what),
        del: t.verb === 'rm' || /^a move OUT/.test(t.what), mkdir });
    }
  }
  return out.sort((x, y) => x.index - y.index);
}
// C2: the edits git ignores, asked ONCE for every candidate. A deleted directory no longer says it was
// one, and `node_modules/` matches only the slash form, so a removal is asked both ways (a deleted
// TRACKED file an ignore pattern also matches answers to the slash form too - the one miss, accepted).
// Git echoes each ignored path as asked. No git, no repo (exit 128) or a timeout ignores nothing,
// which is the gate as it was.
function ignoredEdits(root, edits) {
  const byQuery = new Map();
  const ask = (q, e) => { if (!byQuery.has(q)) byQuery.set(q, []); byQuery.get(q).push(e); };
  for (const e of edits) {
    const q = e.rel.split(/[\\/]/).join('/');
    ask(q, e);
    if (e.del) ask(`${q}/`, e);
  }
  let out = '';
  try {
    const r = require('child_process').spawnSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root, input: [...byQuery.keys()].join('\0') + '\0', encoding: 'utf8', timeout: 3000, windowsHide: true,
    });
    if (!r.error && r.status === 0) out = r.stdout || '';
  } catch { /* no git: nothing is ignored */ }
  const hit = new Set();
  for (const q of out.split('\0')) for (const e of byQuery.get(q) || []) hit.add(e);
  return hit;
}

// The turn's source edits and runs, in order, after its last TYPED row.
function turnWork() {
  const p = payload.transcript_path;
  if (!p) return null;
  const path = require('path');
  const readRows = (tail) => {
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - tail);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const rows = [];
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (o && o.message) rows.push(o); } catch { /* the window's partial first line */ }
    }
    return { rows, partial: start > 0 };
  };
  const boundary = (rows) => {
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].type === 'user' && !rows[i].isCompactSummary && isTypedTurn(rows[i])) return i;
    return -1;
  };
  let { rows, partial } = readRows(2 * 1024 * 1024);
  let b = boundary(rows);
  if (b < 0 && partial) { ({ rows } = readRows(8 * 1024 * 1024)); b = boundary(rows); }
  const turn = rows.slice(b + 1);
  const results = new Map();
  for (const o of turn) {
    const c = o.type === 'user' && Array.isArray(o.message.content) ? o.message.content : [];
    for (const blk of c) {
      if (!blk || blk.type !== 'tool_result') continue;
      const text = typeof blk.content === 'string' ? blk.content
        : Array.isArray(blk.content) ? blk.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
      results.set(blk.tool_use_id, { error: blk.is_error === true, text });
    }
  }
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* compare the spelled root only */ }
  const relIn = (base, f) => { const rel = path.relative(base, f); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null; };
  const sourceEdit = (file) => {
    if (typeof file !== 'string' || !file || PROSE_FILE_RE.test(file)) return null;
    const f = path.resolve(root, file);
    for (const base of [root, realRoot]) {
      const rel = relIn(base, f);
      if (!rel) continue;
      if (rel.split(/[\\/]/)[0] === '.claude' || GIT_OWN_RE.test(rel) || relIn(path.resolve(base, docsRootEnv()), f)) return null;
      return rel;
    }
    return null;
  };
  // A red run RAN ('Exit code N'); a denial, a rejection or a timeout did not. A missing result counts
  // as a run (the transcript can lag, and the gate fails open) but never as an edit.
  const ranCode = (res) => /^\s*(?:Error:\s*)?Exit code -?\d+/i.test(res.text);
  let at = 0;
  const edits = []; // { at, rel, file, make, del, mkdir }, in order
  let lastRun = null;
  let skill = false;
  const red = [];      // build / test runs of this turn that went red (the root-cause list's runners)
  const skipped = [];  // ... and those whose summary reports a skipped test
  let skipEdit = false; // a source edit this turn that ADDED a skip marker
  for (const o of turn) {
    const c = o.type === 'assistant' && Array.isArray(o.message.content) ? o.message.content : [];
    for (const blk of c) {
      if (!blk || blk.type !== 'tool_use') continue;
      at += 1;
      const res = results.get(blk.id);
      const input = blk.input || {};
      const name = String(blk.name);
      if (name === 'Skill') {
        if (res && !res.error && DONE_GATE_SKILL_RE.test(String(input.skill || ''))) skill = true;
      } else if (EDIT_TOOL_RE.test(name)) {
        const file = input.file_path || input.notebook_path;
        const rel = res && !res.error ? sourceEdit(file) : null;
        if (rel) edits.push({ at, rel, file: path.resolve(root, file), make: name === 'Write' });
        const multi = Array.isArray(input.edits) ? input.edits : [];
        const added = [input.new_string, input.content, ...multi.map((e) => e && e.new_string)].filter((x) => typeof x === 'string').join('\n');
        const removed = [input.old_string, ...multi.map((e) => e && e.old_string)].filter((x) => typeof x === 'string').join('\n');
        if (rel && SKIP_MARKER_RE.test(added) && !SKIP_MARKER_RE.test(removed)) skipEdit = true;
      } else if (DISPATCH_TOOL_RE.test(name)) {
        if (!res || !res.error) lastRun = { at, kind: `the dispatched ${input.subagent_type || 'agent'}` };
      } else if (SHELL_TOOL_RE.test(name)) {
        if (res && res.error && !ranCode(res)) continue;
        const command = String(typeof input === 'string' ? input : input.command || '');
        const bt = res ? buildTestRun(command) : null;
        if (bt) {
          const out = res.text.slice(-4096);
          if ((res.error && ranCode(res)) || RED_SUMMARY_RE.test(out) || (/^(?:ng|nx) /.test(bt.kind) && NG_RED_RE.test(out))) red.push(bt.kind);
          if (SKIPPED_RE.test(out)) skipped.push(bt.kind);
        }
        for (const step of shellSteps(command, root)) {
          const pos = at + (step.index + 1) / (command.length + 2);
          if (step.run) lastRun = { at: pos, kind: step.run };
          else if (res && !RUN_OUTPUT_RE.test(step.file)) {
            const rel = sourceEdit(step.file);
            if (rel) edits.push({ at: pos, rel, file: step.file, make: step.make, del: step.del, mkdir: step.mkdir });
          }
        }
      }
    }
  }
  // A removal of a path this turn made (or of one inside a directory it made) undoes that path's
  // writes: neither they nor the removal changed the tree. Any other removal is an edit.
  const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
  const made = [];
  let kept = [];
  for (const e of edits) {
    if (e.del && made.some((m) => inside(e.file, m))) { kept = kept.filter((k) => !inside(k.file, e.file)); continue; }
    if (e.make || e.mkdir) made.push(e.file);
    if (!e.mkdir) kept.push(e);
  }
  const since = lastRun ? kept.filter((e) => e.at > lastRun.at) : kept;
  const ignored = since.length ? ignoredEdits(root, since) : new Set();
  const left = since.filter((e) => !ignored.has(e));
  const lastEdit = left.length ? left[left.length - 1] : null;
  const first = b >= 0 ? rows[b] : null;
  return { turnKey: first ? String(first.uuid || first.timestamp || 'turn') : 'noturn', lastEdit, lastRun,
    lastKept: kept.length ? kept[kept.length - 1] : null, skill, red, skipped, skipEdit };
}

// --- rationalization phrases (ECC comparison R8; LOG-ONLY - never holds, never injects) --------
// ECC's delivery gate warns on a regex over the close: 'skipping tests for now', 'pre-existing bug',
// 'tests are failing but I'll fix', 'leaving the failing tests'. Its four, plus the dismissals the
// local corpus replay found after a red run ('unrelated to this change', 'not related to this change',
// 'flaky', 'transient ... failures'). A phrase counts only beside something to dismiss in the SAME
// turn (the Stop branch checks that), so the replay wrote no row on any other close; a negated
// 'not a pre-existing failure' says the opposite and is no match.
const RATIONALIZATION_RE = /\b(?:this|that|it|these|those)(?:'s| is| are| was| were) (?:a |an )?pre[- ]?existing\b|(?<!\bnot (?:a |an )?)\bpre[- ]?existing\b[^.\n]{0,30}?\b(?:issue|bug|failure|problem|error|flak\w*)s?\b|\b(?:skip(?:ping|ped)?|disabl(?:e|ed|ing)|comment(?:ed|ing)? out) (?:the |this |that |these |those )?(?:\w+ )?(?:tests?|lint|coverage|type[- ]?check|specs?)\b[^.\n]{0,30}\bfor now\b|\b(?:tests?|coverage|build)\s+(?:are|is)\s+(?:still )?(?:failing|broken|red)\s+but\s+(?:i|we)\s*(?:'ll|can|will)\s+(?:fix|address|resolve|handle)|\b(?:not addressing|won'?t fix|leaving|ignoring) the (?:failing|broken|red|flaky) (?:tests?|builds?|specs?|integration tests?)\b|\bunrelated to (?:my|this|the|our) (?:change|changes|edit|edits|fix|work|diff|pr)\b|\b(?:not|isn'?t|aren'?t|wasn'?t|weren'?t) (?:caused by|related to|from|introduced by) (?:my|this|the|our) (?:change|changes|edit|edits|fix|diff)\b|\b(?:a |the |this |that |is |are |was |were |seems |looks |likely |probably |just )flaky\b|\bgood enough for now\b|\b(?:transient|intermittent)(?:ly)?\b[^.\n]{0,40}?\b(?:fail\w*|error\w*|flak\w*)\b/i;
function rationalization(text) {
  const m = String(text || '').replace(/`[^`\n]*`/g, ' ').replace(/[‘’]/g, "'").match(RATIONALIZATION_RE);
  return m ? m[0].replace(/\s+/g, ' ').slice(0, 60) : null;
}
// --- end rationalization phrases

// What the analyzer splits an unrun claim by - the user's two named exceptions. Both read the disk
// only when a row is written, at most once per turn.
// Does the project declare tests at all: a package.json test script other than npm init's
// placeholder, a runner config or a pytest config at the root, a Go module or a Cargo crate (their
// toolchain's test runner is always there), a test folder at the root or under src/, and a .NET test
// project or a test file (`*_test.go`, `*.test.*`, `*.spec.*`) up to two folders down.
const TEST_DIR_RE = /^(?:tests?|specs?|__tests__)$/i;
const TEST_CONFIG_RE = /^(?:(?:vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s|karma\.conf\.[cm]?js|pytest\.ini|conftest\.py|tox\.ini|go\.mod|Cargo\.toml)$/i;
const TEST_FILE_RE = /test[\w.]*\.csproj$|_test\.go$|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
function testsDeclared(root) {
  const path = require('path');
  try {
    const t = ((JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) || {}).scripts || {}).test;
    if (typeof t === 'string' && t.trim() && !/no test specified/i.test(t)) return 'declared';
  } catch { /* no package.json, or not JSON */ }
  const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  const walkable = (d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules';
  const top = list(root);
  if (top.some((d) => d.isFile() && (TEST_CONFIG_RE.test(d.name) || TEST_FILE_RE.test(d.name)))) return 'declared';
  if ([...top, ...list(path.join(root, 'src'))].some((d) => d.isDirectory() && TEST_DIR_RE.test(d.name))) return 'declared';
  for (const d of top.filter(walkable)) {
    const inner = list(path.join(root, d.name));
    if (inner.some((e) => e.isFile() && TEST_FILE_RE.test(e.name))) return 'declared';
    for (const e of inner.filter(walkable))
      if (list(path.join(root, d.name, e.name)).some((f) => f.isFile() && TEST_FILE_RE.test(f.name))) return 'declared';
  }
  return 'none-found';
}
// Does an instruction file forbid running tests: the project's CLAUDE.md, CLAUDE.local.md, AGENTS.md,
// .claude/CLAUDE.md and .claude/rules/*.md, then the account CLAUDE.md. The first matching line, named
// with its file. A line about HOW or WHEN to run them - which tests, how often, in which mode - is no
// rule against running them ('never run the full suite while iterating'), and the account file is read
// for every project, so one such line there would excuse every claim everywhere.
const NO_TEST_RULE_RE = /\b(?:do not|don['\u2019]?t|never|must not|should not|avoid)\b[^.\n]{0,40}\b(?:run|execut|launch)\w*\b[^.\n]{0,30}\btests?\b|\btests?\b[^.\n]{0,30}\b(?:must not|should not|are not to|cannot|can['\u2019]t) be (?:run|executed)\b/i;
const TEST_RULE_QUALIFIER_RE = /\b(?:full|whole|entire|all the|every|each|watch|while|until|before|after|only|again|twice|more than|in parallel)\b/i;
function noTestRule(root) {
  const path = require('path');
  const files = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', path.join('.claude', 'CLAUDE.md')].map((f) => path.join(root, f));
  try {
    for (const f of fs.readdirSync(path.join(root, '.claude', 'rules')).sort()) if (f.endsWith('.md')) files.push(path.join(root, '.claude', 'rules', f));
  } catch { /* no rules folder */ }
  files.push(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude'), 'CLAUDE.md'));
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const line = text.split('\n').find((l) => NO_TEST_RULE_RE.test(l) && !TEST_RULE_QUALIFIER_RE.test(l));
    if (line) return `${path.basename(f)}: ${line.trim().slice(0, 160)}`;
  }
  return null;
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
      ledgerRow({ tool: '', mode: 'skip-tool-end', kind: 'tool-ended-turn', reason: 'skip: the turn ended on a tool call - logged, not judged' });
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
  // The done-gate PROBE, log-only since 2026-09-25 (the user's ruling: rely on the skill's description
  // and the flows that load it, and count the misses). A claim over a turn with a source edit writes
  // one row per turn - `unrun` when the last edit came after the last run (or none ran), `ran` when a
  // run followed it - and never holds the close. It runs BEFORE every branch that can hold: a held
  // close's continuation arrives with stop_hook_active, so a probe placed after one never ran.
  // Everything it reads sits inside one try, so nothing it does can skip the branches below.
  try {
    const claim = envOf(process.env, 'DONE_GATE') !== '0' ? doneClaim(prose) : null;
    const work = claim ? turnWork() : null;
    const outcome = !work ? null : work.lastEdit ? 'unrun' : work.lastKept && work.lastRun ? 'ran' : null;
    const safe = (s) => String(s).replace(/[^a-zA-Z0-9-]/g, '_').slice(-80);
    const probed = outcome && `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-donegate-${safe(payload.session_id || 'nosession')}-${safe(work.turnKey)}.probed`;
    if (probed && !fs.existsSync(probed)) {
      try { fs.writeFileSync(probed, new Date().toISOString()); } catch { /* a lost marker logs the turn twice at most */ }
      const root = require('path').resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
      ledgerRow({
        tool: '', mode: 'probe', kind: 'done-gate', reason: `probe: a done claim, ${outcome} - logged, not held`,
        detail: { claim, file: (work.lastEdit || work.lastKept).rel, outcome, run: work.lastRun ? work.lastRun.kind : null,
          skill: work.skill, tests: testsDeclared(root), rule: noTestRule(root) },
      });
    }
  } catch { /* an unreadable turn is no proof of an edit - no row, and the branches below still run */ }
  // The RATIONALIZATION probe, log-only (the user's 'count first' ruling): a close dismissing a
  // failure ('unrelated to my change', 'pre-existing', 'flaky', 'skipping the tests for now') in a
  // turn that had a red build or test run, a run reporting a skipped test, or an edit adding a skip
  // marker writes one row per turn. The phrase is read first, so a close without one reads no
  // transcript. It sits before every holding branch for the done gate's reason.
  try {
    const phrase = rationalization(prose);
    const work = phrase ? turnWork() : null;
    const evidence = !work ? null : work.red.length ? 'red' : work.skipped.length ? 'skipped' : work.skipEdit ? 'skip-edit' : null;
    const safe = (s) => String(s).replace(/[^a-zA-Z0-9-]/g, '_').slice(-80);
    const probed = evidence && `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-rationalization-${safe(payload.session_id || 'nosession')}-${safe(work.turnKey)}.probed`;
    if (probed && !fs.existsSync(probed)) {
      try { fs.writeFileSync(probed, new Date().toISOString()); } catch { /* a lost marker logs the turn twice at most */ }
      ledgerRow({
        tool: '', mode: 'probe', kind: 'rationalization', reason: `probe: a dismissal after ${evidence === 'red' ? 'a red run' : 'a skipped test'} - logged, not held`,
        detail: { phrase, evidence, red: work.red, skipped: work.skipped, skipEdit: work.skipEdit },
      });
    }
  } catch { /* an unreadable turn logs nothing, and the branches below still run */ }
  // A live credential that has entered this session outranks every other close: it cannot be
  // undone by a later turn, and the transcript keeps the value whatever happens next. This branch
  // runs FIRST and fires on a clean close too - three measured exposures ended exactly there.
  const exposure = ROTATE_ASK_ON && !askJustAnswered() && !rotateAskAnswered()
    ? (ROTATE_RE.test(prose) ? { route: 'close' } : (() => { const row = secretExposure(); return row && !secretReadAllowed() ? { route: 'shape', row } : null; })())
    : null;
  // With nobody at the terminal (hook-prelude.js unattended - print mode, never an SDK session) the ask
  // cannot be answered and only replaced the final answer (pilot 3, 2 of 12 finals): one ledger row per
  // exposure records it instead, keyed on the row that exposed it, and the close stands.
  if (exposure && unattended(payload)) {
    const key = require('crypto').createHash('sha1').update(exposure.row || prose).digest('hex').slice(0, 16);
    const safe = (s) => String(s).replace(/[^a-zA-Z0-9-]/g, '_').slice(-80);
    const marker = `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-rotate-${safe(payload.session_id || 'nosession')}-${key}.logged`;
    if (!fs.existsSync(marker)) {
      try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* a lost marker logs the exposure twice at most */ }
      ledgerRow({ tool: '', mode: 'unattended', kind: 'rotate-ask',
        reason: `skip: a credential entered this session (${exposure.route === 'close' ? 'named for rotation in the close' : 'a shape the model was sent'}) and nobody is at the terminal - logged, not held` });
    }
  } else if (exposure) {
    // Which of the two routes found the credential, in the ledger row - they are tuned separately.
    blockDetail('rotate-ask', (prose.match(ROTATE_RE) || [])[0] || 'secret shape in a tool result or a pasted message');
    process.stderr.write(
      ROTATE_ASK_HEAD + ' - either named for rotation in this\n' +
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
  // Every branch below asks a PERSON something - a decision, a pending step, a fresh session - and
  // with nobody at the terminal (hook-prelude.js unattended) the block only buys another turn. The
  // probes above still log, and so does the credential branch - its row is the record of the exposure.
  if (unattended(payload)) {
    if (proseAsk(tail) || doneClose || endsOnQuestion) {
      ledgerRow({ tool: '', mode: 'unattended', kind: proseAsk(tail) ? 'prose-ask' : doneClose ? 'done-close' : 'ends-on-question',
        reason: 'skip: nobody is at the terminal - logged, not held' });
    }
    process.exit(0);
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
      'finished?" from the user 2-22 minutes later. Put the pending decision (continue or stop,\n' +
      'which deliverable next) through ONE AskUserQuestion call with the options you already\n' +
      'have in mind, recommended one marked. An uncommitted diff is held for the user\'s review:\n' +
      'a commit waits for their own word (baseline-git.md), so it is never the recommended\n' +
      'next move. If nothing is actually pending, say so in one line with no open next action\n' +
      'and stop.',
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


// --- PreToolUse on AskUserQuestion: INJECT the judgement notes, DENY only a house-voice slip -------
// This branch used to DENY an ask that carried no fresh-session option. That enforced the right
// thing at the wrong moment: the denial landed mid-response, so the run stopped the work it was
// doing to rebuild a question and the user watched a red block open every turn. The answer is not
// to abandon the surface - it is to stop deciding on it. The judgement notes below are emitted as
// `hookSpecificOutput.additionalContext`: presence only, never ranking an option. That context lands
// NEXT TO THE TOOL RESULT (code.claude.com/docs/en/hooks, 'Add context for Claude'), and an ask's
// result is the user's answer - so every note is worded for that moment ('the ask just answered ...
// verify, and re-ask if the answer depends on it'), never 'fix it before sending' (I3, 2.1.4 audit).
// The one exception is the ask's own house voice (5): deterministic, mechanical to fix, and only
// fixable BEFORE the ask ships, so it is denied once per ask text with the corrected strings - the
// guard-layer-table.js pattern. Five separate measured failures land on exactly this surface, and
// four of them have no other route:
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
//      more bundles). The prose half is injection only, because a Stop block cannot unsay text already
//      shipped; the ask's own text is denied once with the corrected strings, because it is not yet shipped.
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

    // 5. HOUSE VOICE on the ask's own text is the one check here that is deterministic and cheap, and the one
    // whose fix is mechanical - so it DENIES, carrying the corrected strings (I3, 2.1.4 audit): a note would
    // land next to the tool result, which for an ask is the user's answer, and 'fix the text before sending
    // it' arrived after it was sent. Once per ask text and session: the same ask re-sent unchanged passes with
    // the note, so a model that keeps the slip is never looped.
    const voice = [];
    if (/[\u2014\u2013]/.test(askText)) voice.push('an em- or en-dash (use a single dash)');
    if (/"/.test(askText)) voice.push('a double quote (use single quotes)');
    if (voice.length) {
      const fix = (t) => String(t).replace(/\s*[\u2014\u2013]\s*/g, ' - ').replace(/"/g, "'");
      const fixed = (((payload.tool_input || {}).questions) || []).map((q) => (q && typeof q === 'object' ? {
        ...q,
        ...(q.question !== undefined ? { question: fix(q.question) } : {}),
        ...(q.header !== undefined ? { header: fix(q.header) } : {}),
        ...(Array.isArray(q.options) ? { options: q.options.map((o) => (o && typeof o === 'object' ? { ...o, label: fix(o.label || ''), description: fix(o.description || '') } : o)) } : {}),
      } : q));
      const key = require('crypto').createHash('sha1').update(askText).digest('hex').slice(0, 16);
      const marker = `${envOf(process.env, 'HOOK_LOG_DIR') || require('os').tmpdir()}/guard-stop-askvoice-${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}-${key}.denied`;
      let first = true;
      try { fs.writeFileSync(marker, '', { flag: 'wx' }); } catch (e) { if (e && e.code === 'EEXIST') first = false; }
      if (first) {
        global.BLOCK_DETAIL = { branch: 'ask-voice', voice: voice.map((v) => v.split(' (')[0]) };
        process.stderr.write(`Blocked: this AskUserQuestion's own text carries ${voice.join(' and ')}. The house voice `
          + `(baseline-interaction.md) covers an ask's question, header, labels and descriptions, and the user reads them `
          + `as written. Re-send the SAME ask with these questions - only the dashes and quotes changed:\n`
          + `${JSON.stringify(fixed, null, 1)}\n`);
        process.exit(2);
      }
      notes.push(`The ask just sent carried ${voice.join(' and ')} after its first denial. Keep the house voice `
        + `(baseline-interaction.md) in every later ask: single dashes, single quotes.`);
    }

    // 1. STALE SCOPE: an option that names repository, remote or job state is a MEASUREMENT, and a
    // measurement taken before this turn is not evidence about now. Worded for where it lands - next to the
    // user's answer - so the model re-checks the scope the answer rests on rather than an ask already sent.
    if (/\b(commit|push|branch|pull request|\bPRs?\b|merge|rebase|stash|staged|unstaged|uncommitted|untracked|remote|upstream|deploy(ed|ment)?|pipeline|\bCI\b|workflow run|job)\b/i.test(askText)
        && !freshStateReadThisTurn()) {
      notes.push('The ask just answered named repository, remote or job state, and no `git status` / ' +
        '`git diff` / `gh` call in this turn backed it. Before acting on the answer, read that state FRESH; ' +
        'if it moved, say so and re-ask - a fifty-minute-old read had already been overtaken by another ' +
        'agent while an ask was on screen, and the answer it produced was discarded whole.');
    }

    // 2. CONTRADICTED REQUEST: the presence signal is two typed turns arriving before one reply.
    if (typedTurnsBeforeThisReply() >= 2) {
      notes.push('The user sent more than one message before the ask just answered. Check the answer, and ' +
        'the option it took, against BOTH before acting - an ask whose recommendation contradicted an ' +
        'un-actioned earlier request was taken by the user, who then re-typed that request verbatim. On a ' +
        'contradiction, name it and re-ask.');
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
          + `The ask just answered offered no fresh session: if the work goes on, put an option to resume in a `
          + `fresh session in the NEXT ask about what to do next, quoting those two absolute numbers in its `
          + `description - never a ratio.`);
      }
    }

    // 5. HOUSE VOICE, second surface: the prose THIS TURN wrote before the ask. No Stop hook reads
    // it, because the turn it belongs to ended on a tool call.
    const turnText = turnProseBeforeAsk();
    if (/[\u2014\u2015]/.test(turnText)) {
      notes.push(`The prose this turn wrote before the ask just answered carries an em-dash. The house voice is `
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
        notes.push('The ask just answered was a stop in a solve-task cycle, and it went out without its THREE '
          + 'named fields - `Result:` (one line plus the artifact path), `Progress:` (<N> of <M> steps), '
          + '`Leftovers:` (what this run started and did not finish, or `none`). State them in your next '
          + 'message, and before every later stop\'s ask. Markdown-bold spelling counts. Measured: 13 sessions '
          + 'loaded this contract and 5 used the fields at all, across 109 asks - the named form is what '
          + 'survives a compaction that eats the prose.');
      }
    }

    // 4. CREDENTIAL.
    // The Stop branch's own conditions: once per exposure, off under ROTATE_ASK=0, and not while the
    // user's SECRET-READ-ALLOW consent stands.
    if (ROTATE_ASK_ON && secretInSession() && !rotateAskAnswered() && !secretReadAllowed()) {
      notes.push('A credential-shaped value has already entered this session\'s tool results. It ' +
        'cannot be unsent, and the ask just answered did not settle its rotation. Before this turn ' +
        'closes, ask whether to rotate it now - name the key and its shape only, never the value.');
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
    return /<command-name>\s*\/?(?:[a-z0-9-]+:)?alfred-task-solve(-cross)?\s*<\/command-name>|"skill"\s*:\s*"[^"]*alfred-task-solve(-cross)?/.test(buf.toString('utf8'));
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
          if (!b || b.type !== 'tool_use' || !SHELL_TOOL_RE.test(String(b.name))) continue;
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

