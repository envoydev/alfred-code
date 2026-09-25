#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Three routes into ONE decision: a DELIBERATE orchestration run - a capture, a loop, a solve
// flow - must start in a session that is not already carrying a finished run's history.
//   PreToolUse (Skill)      - the run arrives as a Skill call. Blocks (exit 2).
//   UserPromptSubmit        - the run arrives as a SLASH COMMAND, which emits NO Skill event at
//                             all: measured 4 of 4 runs slash-injected, ZERO Skill tool_use events
//                             in 45 messages, two captures entered at 150k and 164k, both ungated.
//                             This route INJECTS the ask; it never denies, because a
//                             UserPromptSubmit exit 2 ERASES the user's prompt and shows the
//                             reason to the user only - the run would be lost and the model would
//                             never learn why.
//   SessionStart (compact)  - the harness has just auto-compacted, which is PROOF the session
//                             reached the ceiling the gate exists for (~390k measured across three
//                             projects), at a moment a Stop may never come (measured: 23m27s /
//                             277 messages / +178k ctx, zero Stop events; and a conforming
//                             solve-task run emits zero Stops BY DESIGN). Injects, cannot block. The rule existed as
// prose in the generated capabilities rule and lost every time it was tested: measured across 4
// sessions, one of which NAMED the fresh-session need in its own text ('a fresh session is the
// right home for a loop like this') and then ran the loop anyway, to 380k tokens per message.
// Same step run fresh in the next session cost 134k. This is that rule mechanized.
//
// The incoming skill must be one of the orchestration entry points below - everything else passes -
// and then EITHER trigger is enough: the session's context is already past the threshold, or - on
// the slash route only - this session has already made one typed run (see priorOrchestrationRun
// below, which is what reaches the chained case the size trigger structurally cannot).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
const nodePath = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('guard-fresh-session-start')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
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
const EVENT = payload.hook_event_name || '';
const IS_SKILL_CALL = payload.tool_name === 'Skill';
if (!IS_SKILL_CALL && EVENT !== 'UserPromptSubmit' && EVENT !== 'SessionStart' && EVENT !== 'PreCompact') process.exit(0);

// The fresh-session arithmetic lives in fresh-session.js beside this hook, shared with
// guard-stop-contract.js. An update from an older install can run this hook before that file
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
const { FRESH_OFF, ctxThreshold, worthResuming } = fresh;

// PreCompact: the last moment the whole transcript is still there. Write what a resume needs to the
// flow dir - the live plan file, the open flow stamps with their ages, the files this session wrote
// (from docs-session's per-actor attribution state) - with no model call; the SessionStart `compact`
// injection below points at it. Never blocks a compaction: every failure only leaves a line out.
const COMPACT_STATE = () => nodePath.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), docsRootEnv(), 'flow', 'COMPACT-STATE');
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
      if (!lines[i].includes('"tool_use"') || !lines[i].includes('plans/')) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      const blocks = (o && o.message && Array.isArray(o.message.content)) ? o.message.content : [];
      for (let j = blocks.length - 1; j >= 0; j--) {
        const input = blocks[j] && blocks[j].type === 'tool_use' ? blocks[j].input || {} : {};
        const hit = String(input.file_path || input.command || '').match(/[^\s'"]*plans\/[^\s'"]+\.md/g);
        if (hit) return hit[hit.length - 1];
      }
    }
  } catch { /* no transcript - fall through to the docs root */ }
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = nodePath.resolve(root, docsRootEnv(), 'superpowers', 'plans');
    const newest = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
      .map((f) => ({ f, t: fs.statSync(nodePath.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    if (newest) return `${nodePath.relative(root, nodePath.join(dir, newest.f)).split(nodePath.sep).join('/')} (newest under the docs root)`;
  } catch { /* no plans folder */ }
  return null;
}
function flowStamps() {
  try {
    const dir = nodePath.dirname(COMPACT_STATE());
    return fs.readdirSync(dir)
      // the monitor's state and the turn check's edit list are working state, not stamps
      .filter((f) => f !== 'COMPACT-STATE' && !/^monitor-.*\.json$/.test(f) && !/^turn-edits-/.test(f))
      .map((f) => ({ f, age: Math.round((Date.now() - fs.statSync(nodePath.join(dir, f)).mtimeMs) / 60000) }))
      .sort((a, b) => a.f.localeCompare(b.f));
  } catch { return []; }
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
if (EVENT === 'PreCompact') {
  try {
    const plan = livePlan();
    const stamps = flowStamps();
    const wrote = sessionWrites();
    const lines = [
      '# COMPACT-STATE - written by guard-fresh-session-start.js at PreCompact, no model call. Read it before re-orienting.',
      `session: ${payload.session_id || ''}`,
      `written: ${new Date().toISOString()}`,
      `trigger: ${payload.trigger || ''}`,
      `live plan: ${plan || 'none found'}`,
      stamps.length ? 'flow stamps:' : 'flow stamps: none',
      ...stamps.map((s) => `  ${s.f} - ${s.age} min old`),
      `files written this session (${wrote.length})${wrote.length ? ':' : ''}`,
      ...wrote.slice(0, FILES_SHOWN).map((w) => `  ${w}`),
      ...(wrote.length > FILES_SHOWN ? [`  ... and ${wrote.length - FILES_SHOWN} more`] : []),
    ];
    fs.mkdirSync(nodePath.dirname(COMPACT_STATE()), { recursive: true });
    fs.writeFileSync(COMPACT_STATE(), lines.join('\n') + '\n');
  } catch { /* a snapshot that cannot be written never stands in the compaction's way */ }
  process.exit(0);
}
// The pointer the compact start carries: only to a snapshot of THIS session, written within the hour.
function compactPointer() {
  try {
    const file = COMPACT_STATE();
    if (Date.now() - fs.statSync(file).mtimeMs > 60 * 60 * 1000) return '';
    const mine = fs.readFileSync(file, 'utf8').split('\n').includes(`session: ${payload.session_id || ''}`);
    if (!mine || !payload.session_id) return '';
    const rel = nodePath.relative(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), file).split(nodePath.sep).join('/');
    return `The PreCompact hook saved what this session had open at ${rel} - the live plan, the flow stamps with their ages, the files it wrote. Read it before anything else.`;
  } catch { return ''; }
}

// The deliberate entry points: each one opens a multi-phase run with its own state file, so a
// fresh session resuming from that file is always cheaper than continuing on carried context.
// The review and per-phase seats are here because they are the same population, measured: one
// session started `alfred-task-verify-code` at 364.6k and `security-review` at 383.1k, together 13.7M
// cache-read - 27% of the whole session - for 20.5k of output, and the offer arrived nine minutes
// after that spend. `alfred-capture-agent-capabilities` is here because the stack's own next-steps card
// tells the user to run it after every update. The guided plugin commands are here because
// they are multi-phase walks too, and the UserPromptSubmit route is what finally reaches them.
const ORCHESTRATION = /^(alfred-(loop-(quality|architecture-quality|test-coverage)|capture-(architecture|code-style|test-coverage|stack-usage|related-projects|agent-capabilities)|task-(solve|solve-cross|build-from-scratch|version-upgrade|design|verify-plan|implement|verify-code)|issue-diagnoser)|security-review|alfred-code:(init|setup|update|configure|validate))$/;
// a plugin-namespaced Skill call arrives as `<plugin>:<skill>`; the guided commands are
// matched on their FULL name, so a bare `/setup` from some other plugin is not read as one of them
const isOrchestration = (n) => ORCHESTRATION.test(n) || ORCHESTRATION.test(n.replace(/^.*:/, ''));
let skill = '';
if (IS_SKILL_CALL) {
  skill = String((payload.tool_input || {}).skill || (payload.tool_input || {}).name || '');
} else if (EVENT === 'UserPromptSubmit') {
  // A slash turn reaches this event as the expanded prompt: the harness wraps the invocation in a
  // `<command-name>` marker (confirmed twice from live transcripts, matching origin.kind 'human'),
  // and a hand-typed `/name` is the same intent spelled without it.
  const prompt = String(payload.prompt || '');
  const m = prompt.match(/<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/)
    || prompt.match(/(?:^|\s)\/([A-Za-z0-9:_-]+)/);
  skill = m ? m[1] : '';
}
// --- a `disable-model-invocation` skill is the USER's to type, and this is what enforces it ---
// Every project's generated capabilities rule used to stamp 'the harness BLOCKS the Skill call'.
// Measured BOTH WAYS: one CLI build (2.1.229) denied the model's Skill call on a flagged skill
// with a tool_use_error, and in another session it did not - a user typed the command with a
// LEADING SPACE, so no `<command-name>` marker fired, and the model reached the flagged skill through a `Skill` tool call four seconds
// later - body injected, run started. An ASSERTED harness behaviour is the weakest form of a gate,
// and one that varies by build is no gate at all, so the assertion became this gate. Only the MODEL's own Skill call is denied: a slash turn
// arrives as UserPromptSubmit and never reaches here, so the user's own route is untouched. No env
// switch - the verdict is the skill's own frontmatter, not a judgment that can be wrong.
// A skill has TWO homes: copied into `.claude/skills/` (the 0.2.x route, and still where an EXTRA
// lands), or served from an enabled plugin's cache. Reading only the project copy made this gate
// silently stop firing for every skill a plugin carries - the catch below swallowed the missing
// file, and 13 skills carry the flag. So both homes are tried, project copy first.
function skillHeads(root, skill) {
  const bare = skill.replace(/^.*:/, '');
  const out = [nodePath.join(root, '.claude', 'skills', bare, 'SKILL.md')];
  const cfg = process.env.CLAUDE_CONFIG_DIR || nodePath.join(process.env.HOME || process.env.USERPROFILE || '', '.claude');
  const cache = nodePath.join(cfg, 'plugins', 'cache');
  // <cache>/<marketplace>/<plugin>/<version>/stack/skills/<bare>/SKILL.md - the plugin is known
  // when the call carries a scoped name, and is a short scan otherwise.
  const want = skill.includes(':') ? skill.slice(0, skill.indexOf(':')) : null;
  let markets = [];
  try { markets = fs.readdirSync(cache); } catch { return out; }
  for (const market of markets) {
    let plugins = [];
    try { plugins = fs.readdirSync(nodePath.join(cache, market)); } catch { continue; }
    for (const plugin of plugins) {
      if (want && plugin !== want) continue;
      let versions = [];
      try { versions = fs.readdirSync(nodePath.join(cache, market, plugin)); } catch { continue; }
      for (const version of versions) {
        out.push(nodePath.join(cache, market, plugin, version, 'stack', 'skills', bare, 'SKILL.md'));
        out.push(nodePath.join(cache, market, plugin, version, 'skills', bare, 'SKILL.md'));
      }
    }
  }
  return out;
}

if (IS_SKILL_CALL && skill) {
  const bare = skill.replace(/^.*:/, '');
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
        `can run /${bare} themselves.`,
      );
      process.exit(2);
    }
  } catch { /* no such skill on disk, or unreadable - not this guard's business */ }
}

if (EVENT !== 'SessionStart' && !isOrchestration(skill)) process.exit(0);

// SessionStart carries no run name and nothing measurable - the transcript has just been REPLACED
// by its summary - so the compaction event itself is the evidence, and the offer goes out on it.
if (EVENT === 'SessionStart') {
  if (String(payload.source || '') !== 'compact') process.exit(0);
  const pointer = compactPointer();
  if (FRESH_OFF) {
    if (pointer) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: pointer } }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'This session just AUTO-COMPACTED, which means it reached the harness ceiling (~390k ' +
        'tokens per message measured) and the harness - not the user - decided what to drop. ' +
        'Before continuing, put the choice to the user as ONE AskUserQuestion: resume in a fresh ' +
        'session (recommended - end this turn with the paste-ready invocation and the state file ' +
        'or plan file it resumes from), or continue here on the summary with the cost stated. If ' +
        'the remaining work is a single short step, say so and just finish it instead of asking. ' +
        'Two more things for the moment after a compaction. The summary above is the harness' + String.fromCharCode(39) + 's own ' +
        'and it is in English: keep answering in the language of the user' + String.fromCharCode(39) + 's own prompts (measured: ' +
        'two sessions switched to English right after compacting). And when a plan or state file is ' +
        'live, re-read its HEADER first - it holds the anchors and the next step - before re-orienting ' +
        'from the code (measured: a resume grepped the tree and read a 10k-char source range before ' +
        'opening the plan whose header already named the ranges).' + (pointer ? ` ${pointer}` : ''),
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
    // record that is not a tool_result. That excludes the prompt being judged without having to
    // guess whether it is on disk yet (it is: the prompt row is written before UserPromptSubmit
    // fires), because nothing human follows it. It also keeps the SAME command chained twice,
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
    let seenRun = false;
    let answered = false;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      // A row that carries BOTH type strings is a user row quoting a transcript, not an answer:
      // it is skipped, which errs toward making no offer - the direction the measured harm was in.
      if (seenRun && !answered && /"type"\s*:\s*"assistant"/.test(line) && !/"type"\s*:\s*"user"/.test(line)
          && !/"model"\s*:\s*"<synthetic>"/.test(line)) {
        answered = true;
        continue;
      }
      if (!line.includes('"type":"user"') || line.includes('"tool_result"') || !isHumanTurn(line)) continue;
      if (seenRun && answered) return true;
      const c = (JSON.parse(line).message || {}).content;
      const m = re.exec(typeof c === 'string' ? c : (Array.isArray(c) ? c.map((x) => (x && x.type === 'text' && x.text) || '').join('\n') : ''));
      if (m && isOrchestration(m[1])) { seenRun = true; answered = false; }
    }
    return false;
  } catch {
    return false;   // unreadable transcript - the size trigger still covers this session
  }
}
// ONE chained offer per session: once the user has answered it, a retry of the same run goes
// through. This trigger has no number to grow, so repeating it would only print an answered
// question again.
function chainedOfferFile() {
  const os = require('os');
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${envOf(process.env, 'HOOK_LOG_DIR') || os.tmpdir()}/guard-fresh-chained-${key}.offered`;
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
function sizeOfferedAt() {
  try { return parseInt(fs.readFileSync(sizeOfferFile(), 'utf8'), 10) || 0; } catch { return 0; }
}
function recordSizeOffer(ctx) {
  try { fs.writeFileSync(sizeOfferFile(), String(ctx)); } catch { /* never let state break the gate */ }
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
const overSize = !FRESH_OFF && FRESH_AT !== null && ctx > FRESH_AT && worthResuming(ctx)
  && (!sizeAlreadyOffered || ctx >= sizeAlreadyOffered * REOFFER_GROWTH);
// The chained trigger judges only a run the user TYPED (the slash route); a Skill call is a phase
// of a run already in flight, and the size trigger still covers that route.
const chained = EVENT === 'UserPromptSubmit' && !FRESH_OFF && !overSize && worthResuming(ctx)
  && !fs.existsSync(chainedOfferFile()) && priorOrchestrationRun();
if (!overSize && !chained) process.exit(0);
if (chained) {
  try { fs.writeFileSync(chainedOfferFile(), new Date().toISOString()); } catch { /* never let state break the gate */ }
}
// Written on BOTH routes. The slash route injects rather than denies, but it is the same offer to
// the same user about the same number, so answering it there must silence the Skill route too.
if (overSize) recordSizeOffer(ctx);

const why = chained
  ? `is a deliberate orchestration run and this session has ALREADY run one - every turn of the\n`
    + `new run re-sends the finished run's whole history (measured: four flows chained with no\n`
    + `/clear boundary drove 199.1k tokens per message for under 30k of actual tool output).`
  : `is a deliberate orchestration run and this session already carries ~${Math.round(ctx / 1000)}k tokens\n`
    + `per message of another run's history - every turn of the new run re-sends all of it\n`
    + `(measured: the same step cost 260k/message chained vs 134k fresh).`;

// UserPromptSubmit can only ADD context - exit 2 there erases the prompt and tells the user, not
// the model - so the slash route states the same thing as an instruction and lets the model ask.
if (EVENT === 'UserPromptSubmit') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `/${skill} ${why.replace(/\n/g, ' ')} ` +
        `Do NOT start the run yet. Put it to the user as ONE AskUserQuestion: start it in a fresh ` +
        `session (recommended - end this turn with the paste-ready invocation and the state file it ` +
        `resumes from), or run it here anyway with the cost stated.`,
    },
  }));
  process.exit(0);
}

process.stderr.write(
  `Blocked: ${skill} ${why}\n`
  + `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n`
  + `this turn with the paste-ready invocation and the state file it resumes from), or run it\n`
  + `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
