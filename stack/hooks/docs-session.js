#!/usr/bin/env node
// docs-session.js - makes the project's docs (every domain under the docs root) the starting point of a session
// and keeps them honest at its end.
//   SessionStart  -> folds merged branches' doc versions into mainline, then pushes ORIENTATION.md, this branch's
//                    overrides and conflicts, and how to read by section; snapshots the tree for the end check
//   SubagentStart -> the same orientation for a dispatched subagent (SessionStart context never reaches one), and
//                    the snapshot the finish ask below compares against
//   SubagentStop  -> what THAT agent WROTE, once: a file it wrote that also changed and hits watch.json blocks with
//                    the owning sections quoted, so whoever made the change says whether the docs still hold
//   PreToolUse    -> records reads of the docs and attributes each write to the agent that made it; holds the FIRST
//                    change under a source root until a section was read, handing the covering section over inline -
//                    what a merge just folded into mainline comes first
//   Stop          -> once per session, the same ask for what the SESSION wrote itself (a skill's work is main-session
//                    work) plus every change no actor claimed - a script's output, a tool this hook is not wired on
// ALFRED_CODE_DOCS_BLOCK=0 / ALFRED_CODE_DOCS_GATE=0 / ALFRED_CODE_DOCS_ASK=0 turn the three parts off.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way, so a skewed copy (this hook beside an older or missing engine/prelude) still orients instead
// of crashing.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let unattended = () => false;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    unattended = prelude.unattended || unattended;
    off = prelude.standDown('docs-session');
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}

const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const MAX_HOLDS = 2;
const INLINE_CHARS = 3000;
const ASK_SECTIONS = 3;
const FILES_NAMED = 4;
const READ = 'node .claude/hooks/docs.js';

const readInput = () => { try { const v = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
// ONE spelling for every path this hook records, compares or matches against a source root: git answers in forward
// slashes, and on win32 `path.relative` answers in backslashes, so an unnormalised path matches nothing git reports -
// which silently took both the write attribution and the first-change gate's own root check down on every Windows
// session. Only the platform's OWN separator is translated: on posix a backslash is a legal character in a file name.
const toPosix = (p, sep = path.sep) => (sep === '/' ? p : String(p).split(sep).join('/'));
const statePath = (s, agent) => path.join(os.tmpdir(), `docs-session-${String(s || 'none').replace(/[^\w-]/g, '')}${agent ? `--${agent}` : ''}.json`);
const loadState = (s) => { let v = {}; try { v = JSON.parse(fs.readFileSync(statePath(s), 'utf8')); } catch {} return { consults: [], holds: 0, edits: 0, asked: false, snapshot: null, ...v }; };
// This hook's own litter: one state file per session plus one per actor, in a directory its sibling scan then reads.
// Swept opportunistically when a NEW state file appears - once per process, so a busy session pays it once and a
// tool call that only updates an existing file pays nothing. Bounded and fail-silent throughout: a slow, unreadable
// or undeletable temp directory must never cost this hook its 10s timeout. A file exactly at the cutoff is KEPT.
// The work is bounded by TIME rather than by a count of files: a count cap is reached first by the very litter this
// sweep exists to clear, and a sweep that gives up before it frees anything never shrinks the directory it is
// walking. 50ms out of the wired 10s, and whatever is left over is taken by the next run.
const SWEEP_MS = 7 * 24 * 3600 * 1000;
const SWEEP_BUDGET_MS = 50;
let swept = false;
function sweepOldState(now = Date.now(), dir = os.tmpdir()) {
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('docs-session-') || !f.endsWith('.json')) continue;
      if (Date.now() > deadline) return;
      try { if (now - fs.statSync(path.join(dir, f)).mtimeMs > SWEEP_MS) fs.rmSync(path.join(dir, f), { force: true }); } catch {}
    }
  } catch {}
}
const saveState = (s, v, agent) => {
  const file = statePath(s, agent);
  let fresh = false;
  try { fresh = !fs.existsSync(file); } catch {}
  try { fs.writeFileSync(file, JSON.stringify(v)); } catch {}
  if (fresh && !swept) { swept = true; sweepOldState(); }
};
// A dispatched agent gets a state file of its OWN, beside the session's and named for it. Same store, one key finer:
// agents run in parallel, and a shared file they all read-modify-write loses rows - a lost 'blocked' row is a SECOND
// block on an agent that already answered, which is worse than never asking.
const loadAgent = (s, agent) => { let v = {}; try { v = JSON.parse(fs.readFileSync(statePath(s, agent), 'utf8')); } catch {} return { snapshot: null, asked: [], warned: [], askedAt: '', blocked: false, answered: false, ...v }; };
// Both subagent payloads carry `agent_id` (documented on SubagentStart and SubagentStop alike) - that is the only
// field that tells two seats of ONE type apart. The published examples spell the same field 'agent-abc123' at start
// and 'def456' at stop, so the prefix is dropped before keying: a key that matched on only one of the two events
// would snapshot an agent and then ask a different one. With no id at all the type is the best key left, and two
// parallel seats of one type then share a snapshot and one block.
const agentKey = (input) => String(input.agent_id || input.agent_type || 'agent').replace(/^agent-/, '').replace(/[^\w-]/g, '').slice(0, 64) || 'agent';
// Who made a write. `agent_id` / `agent_type` are populated on a TOOL event only when the hook fires INSIDE a
// subagent, so the main session - and every skill, whose work is main-session work - records under one key of its
// own and its Stop can answer for what it wrote itself.
// The dot is load-bearing: agentKey strips every character outside [\w-], so no agent name can ever produce this
// key and no seat can land in the main session's file. Structural, not a convention to remember.
const MAIN_ACTOR = 'main.session';
const actorKey = (input) => (input.agent_id || input.agent_type ? agentKey(input) : MAIN_ACTOR);
// A write, attributed to the actor that made it. Banked only where the call is allowed to PROCEED (see preToolUse):
// a write this hook denies never lands, and crediting it would let a neighbour's change read as this seat's work.
const WROTE_CAP = 500;
function recordWrite(root, input, wrote) {
  if (envOf(process.env, 'DOCS_ASK') === '0') return; // the switch turns the part off, record included
  const key = actorKey(input);
  const a = loadAgent(input.session_id, key);
  const had = (a.wrote || []).length;
  const union = [...new Set([...(a.wrote || []), ...wrote])];
  if (union.length === had) return;
  // Past the cap an actor keeps its first WROTE_CAP paths and later ones are dropped, so a busy seat goes SILENT
  // rather than answering for files it never wrote. Right direction, invisible without this row.
  if (union.length > WROTE_CAP && had < WROTE_CAP) log(root, input, { event: 'wrote-cap', actor: key, cap: WROTE_CAP, dropped: union.length - WROTE_CAP });
  a.wrote = union.slice(0, WROTE_CAP);
  saveState(input.session_id, a, key);
}
// Every path the OTHER actors of this session recorded. READ only: writing here would race preToolUse, and a file
// that cannot be read simply leaves its paths unclaimed, which is the safe direction.
function otherActorWrites(session, exceptKey) {
  const prefix = `docs-session-${String(session || 'none').replace(/[^\w-]/g, '')}--`;
  const out = new Set();
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(prefix) || !f.endsWith('.json') || f === `${prefix}${exceptKey}.json`) continue;
      try { for (const p of JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), 'utf8')).wrote || []) out.add(p); } catch {}
    }
  } catch {}
  return out;
}
const emit = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
// SHELL ROUTE: the PowerShell tool is the same route under a second name - its payload carries
// `tool_input.command` exactly as Bash does, and both installer twins wire this hook on the matcher
// `Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep|Glob`. Judging only `Bash` left the first-change
// gate open on every Windows session and earned a doc read through PowerShell no consult credit.
const isShellTool = (n) => n === 'Bash' || n === 'PowerShell';
// One log file holds every session's rows, and two sessions interleave in it, so each row carries the id that
// tells them apart. It lives under the docs root beside hook-blocks/ and tools-usage/ - every other ledger in
// this stack does, and under .claude/ a project that commits that folder accumulated this one in git.
const log = (root, input, row) => {
  try {
    const dir = path.resolve(root, docsRootEnv());
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), session: input.session_id || '', ...row })}\n`);
  } catch {}
};

function orientation(root, docs) {
  let block = '';
  try { block = fs.readFileSync(docs.BLOCK_FILE, 'utf8').trim(); } catch {}
  // ORIENTATION.md stays architecture's own file, read exactly as before - a domain gets no per-domain twin.
  // The one line below is the part that used to name architecture/ as if it were the only docs folder; a
  // project whose docs are code-style/ and related-projects/ (no architecture/ at all) is named correctly here.
  let doms = [];
  try { doms = docs.domains(); } catch {}
  const rootRel = path.relative(root, docs.DOCS_ROOT).split(path.sep).join('/');
  // The first-look scan's file: read from manifests, never captured - pushed, but with the warning beside it. An
  // older engine copy beside this hook has no orientationState, and reads as not provisional.
  let provisional = false;
  try { provisional = typeof docs.orientationState === 'function' && docs.orientationState() === 'provisional'; } catch {}
  return [
    'How this project is documented - read this before deciding how to implement anything.',
    ...(block ? ['', block] : []),
    ...(provisional ? ['', 'This orientation is PROVISIONAL - a first-look scan of the manifests, not a capture: treat it as stale, verify a row against the code before relying on it; the architecture capture replaces it.'] : []),
    '',
    `The docs live under \`${rootRel}/\` (${doms.join(', ')}). Read them by section, not whole files:`,
    `\`${READ} where <path>\` names the sections covering a file; \`${READ} show <file>#<id>\` prints one.`,
    'For a specific symbol the CODE wins; the docs give the decisions, the conventions and the reasons.',
  ];
}

function sessionStart(input, root, docs, state) {
  if (!state.snapshot) { try { state.snapshot = docs.snapshot(); } catch {} saveState(input.session_id, state); }
  // Repair the branch snapshots BEFORE looking for merged branches, so a snapshot repaired here is promotable in
  // this session and not only the next one.
  try { docs.refreshBaseMeta(); } catch {}
  let promoted = [];
  try { promoted = docs.autoPromote(); } catch {}
  // A row with changed=false is a standing, already-reported conflict - skip it, or it would be re-logged and
  // re-announced at every session start.
  const landed = promoted.filter((p) => p.changed);
  for (const p of landed) log(root, input, { event: 'promote', branch: p.branch, how: p.how, results: p.results });
  if (envOf(process.env, 'DOCS_BLOCK') === '0') return;
  let st = null;
  try { st = docs.status(); } catch {}
  const lines = orientation(root, docs);
  const extra = [];
  for (const p of landed) {
    const ok = p.results.filter((x) => x.result !== 'conflict');
    const bad = p.results.filter((x) => x.result === 'conflict');
    // The ids, the way the branch-override line beside it names its own: a count tells the session that something
    // it has not read just changed, and nothing about what to read. Six ids, then a count - the block is paid for
    // by every session.
    const names = ok.length ? ` and now hold its decisions: ${ok.slice(0, 6).map((x) => x.id).join(', ')}${ok.length > 6 ? ` (+${ok.length - 6} more)` : ''}` : '';
    extra.push(`Branch ${p.branch} was merged: ${ok.length} doc section(s) folded into mainline${names}.${bad.length ? ` To reconcile: ${bad.map((x) => `${x.id} (\`${READ} show ${x.id} --conflict ${p.branch}\`, then \`${READ} set ${x.id}\`)`).join(', ')}.` : ''}`);
  }
  if (st && st.detached) extra.push('Detached HEAD: the docs are read-only until a branch is checked out.');
  // The declared mode wins over what git does, so where the two disagree the session is told before it writes a doc:
  // one line, the engine's own wording, and nothing at all when the install declares nothing or the two agree.
  if (st && st.mismatch) extra.push(st.mismatch);
  // Branch versions nothing can reach under git versioning. Only `docs.js status` knew, and nothing runs that by
  // itself - so a decision written under the overlay model sat unreadable and unmentioned, session after session.
  // Nothing sweeps them either - the 30-day sweep stands down under git versioning - so this line comes back every
  // session. It is a prompt only if it names the command that ends it, with the branch filled in; a placeholder
  // would make it a nag. The field is guarded like its neighbours: an older engine beside this hook returns a
  // status without it, and an unguarded read would throw away the whole block.
  if (st && st.stranded && st.stranded.length) extra.push(`Doc versions stranded by this install's git versioning: ${st.stranded.slice(0, 6).join(', ')}${st.stranded.length > 6 ? ` (+${st.stranded.length - 6} more)` : ''} - nothing reads or promotes .branches/ any more, and this line returns every session until they are gone: re-apply what is still wanted with \`${READ} set <file>#<id>\`, then end it with \`${READ} prune ${st.stranded[0]}\`${st.stranded.length > 1 ? ' (one prune per name)' : ''}.`);
  // After a git merge of committed docs, or a hand edit: the two breakages that make a doc untrustworthy to read.
  let broken = [];
  try { broken = docs.lint().problems.filter((p) => /^(merge conflict markers|duplicate id)/.test(p)); } catch {}
  if (broken.length) extra.push(`The docs need a repair before they are trusted: ${broken.slice(0, 3).join('; ')}${broken.length > 3 ? ` (+${broken.length - 3} more: \`${READ} lint\`)` : ''}.`);
  if (st && st.overrides.length) extra.push(`You are on branch ${st.branch}. ${st.overrides.length} doc section(s) hold this branch's own decisions and replace mainline's in every read: ${st.overrides.slice(0, 6).join(', ')}${st.overrides.length > 6 ? ` ... (\`${READ} status\`)` : ''}.`);
  if (st && st.conflicts.length) extra.push(`Conflicts: ${st.conflicts.join(', ')} - mainline changed lines this branch also changed; \`${READ} show <id> --conflict\` shows both, \`${READ} set <id>\` saves the reconciled text.`);
  if (st && st.mainline && st.deletedUnmerged.length) extra.push(`Doc versions of deleted branches never detected as merged: ${st.deletedUnmerged.join(', ')} - \`${READ} promote <branch>\` folds one in, \`${READ} prune <branch>\` drops it.`);
  if (st && st.mainline && st.liveOnMainline && st.liveOnMainline.length) extra.push(`Doc versions of branches sitting on mainline with no proof they merged: ${st.liveOnMainline.join(', ')} - one that was merged fast-forward looks exactly like one that only caught up, so nothing was folded in; if it landed, \`${READ} promote <branch>\`.`);
  if (st && st.outgrown) extra.push(`${st.outgrown} section(s) describe code that changed since they were written - each says so when opened, and the code wins there.`);
  // With no doc file to read by section (a provisional orientation alone, or a domain whose every file is protected),
  // the gate has nothing to hand over - it stands down, so the line announcing it goes too.
  let readable = true;
  try { readable = docs.docFiles().length > 0; } catch {}
  if (envOf(process.env, 'DOCS_GATE') !== '0' && readable) {
    let roots = ['src', 'tests'];
    try { roots = docs.loadWatch().sourceRoots; } catch {}
    extra.push(`Before your first change under ${roots.map((x) => `${x}/`).join(' or ')}, read the section covering the file.`);
  }
  emit('SessionStart', [...lines, ...(extra.length ? ['', ...extra] : [])].join('\n'));
}

function main() {
  const input = readInput();
  const event = input.hook_event_name;
  if (!event) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  process.env.CLAUDE_PROJECT_DIR = root;
  // On the PLUGIN route this hook runs from the marketplace clone, where docs.js/memory.js/
  // history.js are all tracked - so a never-set-up project under a user-scope core never reaches
  // this line (M1, R47 fix round 1: the require always resolves there). The case that CAN happen is
  // a partial or skewed copy on the HOOKS COPY ROUTE (ALFRED_CODE_HOOKS_VIA_PLUGIN=false), where
  // docs.js failed to land beside this file - exit silently for exactly THAT missing-module case,
  // like every other fail-open path here; a syntax error or any other load failure in a PRESENT
  // engine is a genuine bug and must surface on stderr, not be swallowed.
  let docs;
  try { docs = require('./docs.js'); }
  catch (e) { if (e.code === 'MODULE_NOT_FOUND' && /docs\.js/.test(e.message)) return; throw e; }
  // A domain is any top-level folder under the docs root holding a watch.json (architecture counts even
  // without one - see docs.js's own domains()). A project whose docs are code-style/ and related-projects/,
  // with no architecture/ at all, must still get the SessionStart block, the gate and the finish ask - so the
  // whole-hook gate reads every domain, not one hardcoded folder. An empty list is still the right reason to
  // return: nothing under the docs root declares itself a domain.
  if (!docs.domains().length) return;
  const state = loadState(input.session_id);
  if (event === 'SessionStart') return sessionStart(input, root, docs, state);
  if (event === 'SubagentStart') return subagentStart(input, root, docs);
  if (event === 'SubagentStop') return subagentStop(input, root, docs);
  if (event === 'PreToolUse') return preToolUse(input, root, docs, state);
  if (event === 'Stop') return stop(input, root, docs, state);
}

function subagentStart(input, root, docs) {
  // The snapshot is what makes the finish ask possible, and it is NOT the orientation block: the block's switch
  // must not blind the ask, and the ask's switch must not cost a snapshot nobody will read.
  if (envOf(process.env, 'DOCS_ASK') !== '0') {
    const key = agentKey(input);
    const a = loadAgent(input.session_id, key);
    // Only the first start writes it: where two seats fold onto one key, the earlier snapshot keeps both their
    // changes in view instead of hiding the first agent's work behind the second's start.
    if (!a.snapshot) { try { a.snapshot = docs.snapshot(); } catch {} saveState(input.session_id, a, key); }
  }
  if (envOf(process.env, 'DOCS_BLOCK') !== '0') emit('SubagentStart', orientation(root, docs).join('\n'));
}

// A section ref is spelled three ways on the CLI ('patterns#orders', 'references/patterns#orders',
// 'patterns.md#orders'), all resolving to the same section, so the ledger and the ask are compared in one spelling.
const normRef = (ref) => {
  const i = String(ref).indexOf('#');
  return i < 0 ? '' : `${path.basename(String(ref).slice(0, i), '.md')}#${String(ref).slice(i + 1)}`;
};
// The rows we are looking for were appended seconds ago, by the agent we just blocked, so the END of the file is
// where they are - and a ledger that has run for months is not read into memory to answer that.
const LEDGER_TAIL = 256 * 1024;
// One window of the ledger, newest rows last. Returns whether it reached back PAST the ask: a window that did not is
// a window that may have cut the answer off, which is the only reason to read more.
function scanLedger(file, size, len, since, want, done) {
  let reachedOlder = len >= size;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue;
    // The first line of a tail is usually the back half of a row - it parses as nothing and is skipped.
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (String(row.at) < since) { reachedOlder = true; continue; }
    if (row.event === 'doc-set' && want.has(normRef(row.ref))) done.add(normRef(row.ref));
  }
  return reachedOlder;
}
// What the agent DID about the ask is a fact the engine already records: `docs.js set` writes a doc-set row naming
// the section it wrote. That is read here instead of the agent's prose, which says what it MEANT and can say the
// opposite of what happened - a refusal quoting the phrase it is declining, a finished rewrite closing in its own
// words. Only a set at or after the ask counts: a rewrite from before it answers a different question.
function setsSince(root, since, ids) {
  const want = new Set(ids.map(normRef));
  if (!want.size || !since) return [];
  const done = new Set();
  try {
    const file = path.join(path.resolve(root, docsRootEnv()), 'docs-log.jsonl');
    const size = fs.statSync(file).size;
    const len = Math.min(size, LEDGER_TAIL);
    // The tail is read first, and widened to the whole file only when every row in it was NEWER than the ask - the
    // one case where the set can still lie further back, and the one case where a window would otherwise report a
    // rewrite that happened as a section nobody touched.
    if (!scanLedger(file, size, len, since, want, done) && len < size) scanLedger(file, size, size, since, want, done);
  } catch {}
  return ids.filter((id) => done.has(normRef(id)));
}
// A SEPARATE signal, never the outcome: whether the agent gave the ask's own words as its answer. The phrase has to
// BE the reply - a line of its own, bare or quoted or bulleted - so a sentence that merely contains it, which is how
// an agent declines ("I cannot truthfully reply 'docs ok'"), is not read as saying it.
const DOCS_OK_LINE = /^[\s>*_`'"-]*docs ok[\s.!*_`'"]*$/i;
const saidDocsOk = (text) => String(text == null ? '' : text).split(/\r?\n/).some((l) => DOCS_OK_LINE.test(l));

// A watch.json entry's sections are stored verbatim, and watchHits tags every hit with the domain that entry
// came from. Two domains can declare the exact same bare spelling ('patterns#orders'), each meaning its OWN
// file - so resolving is done per hit, never by flattening every hit's ids into one Set first (that dedupe is
// what used to let one domain's watch entry collapse onto another's, or drop an id neither of them meant).
// docs.protectedRef is tried FIRST, scoped to the hit's OWN domain: a domain's own notOwned file drops out of
// domainFiles entirely, so a bare id that names it can resolve UNIQUELY to a different domain's same-named
// file instead of being flagged ambiguous - the qualified fallback below never even runs in that case,
// because the bare form already (wrongly) succeeds. Checking the hit's own domain for a protected match before
// any bare resolution runs closes that hole: a hit is never answered by a different domain's file. Only once
// protectedRef says no does the ordinary bare-then-qualified resolution run, unchanged from before - bare
// first is still safe there, since a bare key that is genuinely ambiguous between two ordinary (non-protected)
// files still throws in parseRef and askRef still catches it, same as always.
function resolveHit(docs, h, id) {
  // Guarded like askRef's own callers below: an older docs.js copy beside this hook has no protectedRef
  // at all, and the safe degradation there is the resolution this file already had, not a thrown error.
  const warn = typeof docs.protectedRef === 'function' ? docs.protectedRef(h.domain, id) : null;
  if (warn) return { warn };
  const ask = docs.askRef(id) || docs.askRef(`${h.domain}/${id}`);
  return ask ? { ask } : null;
}

// Two pools, not one: an ask offers a rewrite, a warning offers none, and they must never compete for the
// same slots - a warning that lost its place to an ask which merely sorted earlier would be the exact
// silence this task exists to end. Filled by ROUND-ROBIN across hits (one id per hit per pass) rather than
// the straight walk this replaced, which let the first hit - hits arrive in domain-alphabetical order - fill
// every slot in a pool before a later domain's hit was ever tried; measured with four domains, only the
// first plus one more ever got named. Round-robin means no domain is starved purely by where its name
// sorts. Each pool is still capped at `limit` on its own. Deduped on the RESOLVED ref's id, not the raw
// watch.json spelling, since two domains' identical bare spellings resolve to two different final refs.
// A queue is one watch ENTRY, not one domain, so this also reorders sections within a single domain once
// it has more than one matching entry - deliberately kept, not a side effect to undo: breadth across
// entries (naming more DIFFERENT decisions) is worth more at the cap than depth into the one that sorted
// first. A project with only one matching entry per hit sees no change at all.
function sectionRefs(docs, hits, limit, exclude = () => false) {
  const seenAsk = new Set();
  const seenWarn = new Set();
  const asks = [];
  const warnings = [];
  const queues = hits.map((h) => ({ h, ids: [...h.sections] }));
  // Almost no install declares notOwned anywhere, so almost no run can ever fill the warning pool - and
  // resolveHit's fallback, askRef, walks allSections() (every doc file, re-read and re-parsed) on every
  // call. Without knowing that up front, `warnings.length < limit` never goes false when warnings stay 0
  // forever, so the loop below keeps draining every remaining id - one full walk each - just to keep
  // confirming what this one cheap check (one domain's declared list, not a file read) already knows.
  // Measured in isolation (30 doc files x 15 sections, 30 watch ids offered, cap 3, no domain declaring
  // notOwned): the old shape called resolveHit all 30 times (42.6ms median); this one stops at 3, the same
  // 3 asks it always found (4.2ms median) - a ~10x cut, growing with corpus size since each stopped call
  // was its own full walk.
  // notOwnedOf, not unowned: the cheap pre-check must read the SAME list the warning itself matches on
  // (protectedRef -> notOwnedOf), which is what a domain DECLARED plus architecture's implicit ORIENTATION.md.
  // Reading the declared list alone made this say 'no domain can warn' where the effective list still can,
  // and the loop then stops before a warning the expensive path would have produced - one idea spelled twice,
  // with the optimisation holding the shorter spelling. Guarded like resolveHit above: an older docs.js copy
  // beside this hook exports no notOwnedOf, and the safe degradation there is the declared list it does have.
  const effectiveNotOwned = (d) => (typeof docs.notOwnedOf === 'function' ? docs.notOwnedOf(d) : docs.unowned(d));
  const canWarn = [...new Set(queues.map((q) => q.h.domain))].some((d) => { try { return effectiveNotOwned(d).length > 0; } catch { return true; } });
  let more = true;
  while (more && (asks.length < limit || (canWarn && warnings.length < limit))) {
    more = false;
    for (const q of queues) {
      if (!q.ids.length) continue;
      more = true;
      const resolved = resolveHit(docs, q.h, q.ids.shift());
      if (!resolved) continue;
      if (resolved.warn) {
        if (warnings.length >= limit || seenWarn.has(resolved.warn.id) || exclude(resolved.warn.id)) continue;
        seenWarn.add(resolved.warn.id);
        warnings.push(resolved.warn);
      } else {
        if (asks.length >= limit || seenAsk.has(resolved.ask.id) || exclude(resolved.ask.id)) continue;
        seenAsk.add(resolved.ask.id);
        asks.push(resolved.ask);
      }
    }
  }
  return { asks, warnings };
}

// The agent that made a change is the only context that knows why it was made - the main session usually does not -
// so the ask lands here, once, for the files THAT agent changed (its start snapshot against the tree now).
function subagentStop(input, root, docs) {
  if (envOf(process.env, 'DOCS_ASK') === '0') return;
  const key = agentKey(input);
  const a = loadAgent(input.session_id, key);
  // The stop our own block caused. The row it writes states what HAPPENED to the sections we asked about - which of
  // them the agent rewrote through `docs.js set` - and nothing claims to know what it meant by stopping. Logged once
  // and nothing more: no dedupe rests on it, because an agent that simply stopped and one that rewrote every section
  // are otherwise the same event.
  if (input.stop_hook_active) {
    if (a.blocked && !a.answered) {
      a.answered = true;
      saveState(input.session_id, a, key);
      const asked = a.asked || [];
      const rewrote = setsSince(root, a.askedAt, asked);
      // Three states because two cannot tell them apart: where several sections were asked about, rewriting one of
      // them is neither the job done nor nothing done, and that middle case is the one worth counting.
      const outcome = rewrote.length === 0 ? 'unchanged' : rewrote.length === asked.length ? 'rewritten' : 'partial';
      // Separate from `sections` on purpose (see the comment on a.warned below): a warning-only turn reads
      // sections: [], outcome: 'unchanged' - true, not false, but indistinguishable from a turn nothing ever
      // asked about at all. `warned` is what lets the block ledger tell the two apart without joining back
      // to the ask-update row that named them.
      log(root, input, { event: 'ask-answer', agent: key, sections: asked, warned: a.warned || [], rewrote, outcome, saidDocsOk: saidDocsOk(input.last_assistant_message) });
    }
    return;
  }
  // One block per agent, whatever it answered, and never one for an agent whose start was never seen: with no
  // snapshot there is nothing that says what this agent changed, and a guess would ask the wrong seat.
  if (a.blocked || !a.snapshot || typeof docs.askRef !== 'function') return;
  // What THIS agent wrote, not what the tree did. `changedSince` is a whole-TREE diff, so a seat that opened nothing
  // was otherwise told it changed whatever the writer running BESIDE it changed - and this stack dispatches in
  // parallel by design. A seat that wrote nothing is silent (the brief's read-only seats, now true under parallel
  // dispatch); a seat that wrote is judged on its own files, and the tree still has to agree they CHANGED.
  const own = a.wrote || [];
  if (!own.length) {
    // Every route to a missed ask ends here: a tool event carrying no agent fields, a write through a tool this hook
    // is not wired on, the two events spelling the key differently, the write cap, a separator that never matched.
    // The block RATE is what says a gate earns its keep, so the silence is logged rather than looking like a gate
    // nobody needed. A read-only seat logs one row too - that is the same fact, honestly counted.
    log(root, input, { event: 'ask-skipped', why: 'no write attributed to this agent', agent: key, agentType: input.agent_type || '' });
    return;
  }
  let changed;
  let hits = [];
  try {
    changed = docs.changedSince(a.snapshot);
    if (!changed.files.length && !changed.dirs.length) return;
    let mineFiles;
    if (own.includes(UNKNOWN_SOURCE_WRITE)) {
      // A write the shell route could not name ('git apply', 'dotnet ef migrations add' with no --project). The seat
      // did write and nothing says what, so it answers for everything no OTHER actor claimed - which keeps it honest
      // about its own work without handing it the file a seat beside it wrote.
      const others = otherActorWrites(input.session_id, key);
      mineFiles = changed.files.filter((f) => !others.has(f));
    } else {
      const mine = new Set(own);
      mineFiles = changed.files.filter((f) => mine.has(f));
    }
    const mineDirs = changed.dirs.filter((d) => mineFiles.some((f) => f.startsWith(`${d}/`)));
    if (!mineFiles.length && !mineDirs.length) {
      log(root, input, { event: 'ask-skipped', why: 'nothing this agent wrote changed', agent: key, wrote: own.length });
      return;
    }
    hits = docs.watchHits(mineFiles, mineDirs);
  } catch { return; }
  if (!hits.length) return;
  // Dedupe on the pair (agent, section), never the section alone: two agents in one run often touch the same
  // section, and the second is the one most likely to notice the first's rewrite only covered half the change.
  const { asks, warnings } = sectionRefs(docs, hits, ASK_SECTIONS, (id) => a.asked.includes(id));
  if (!asks.length && !warnings.length) return;
  const files = [...new Set(hits.flatMap((h) => h.files))];
  const reason = finishAsk(docs, files, asks, warnings);
  a.blocked = true;
  // Only ASK ids: a warning can never appear in setsSince (the write refusal means `docs.js set` never
  // records one), so folding its id in here would only ever pull the outcome below toward 'partial' or
  // 'unchanged' for a section nothing was ever asking to be rewritten. Warning ids are tracked separately,
  // in a.warned, purely so the ask-answer row above can name them - never read back into an outcome.
  a.asked = [...a.asked, ...asks.map((r) => r.id)];
  a.warned = [...(a.warned || []), ...warnings.map((r) => r.id)];
  // The instant the ask was made, so a rewrite that landed before it is never counted as an answer to it.
  a.askedAt = new Date().toISOString();
  saveState(input.session_id, a, key);
  log(root, input, { event: 'ask-update', agent: key, agentType: input.agent_type || '', sections: asks.map((r) => r.id), warnings: warnings.map((r) => r.id), files: files.slice(0, 5), kinds: [...new Set(hits.map((h) => h.kind))] });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// What the tool is about to touch, project-relative.
function toolPaths(input, root) {
  const t = input.tool_input || {};
  const out = [];
  for (const p of [t.file_path, t.path, t.relative_path, t.notebook_path]) if (typeof p === 'string' && p) out.push(p);
  if (typeof t.command === 'string') {
    for (const w of t.command.split(/[\s;|&<>()'"`]+/)) {
      if (/[\w.-]\/[\w.-]/.test(w)) out.push(w.replace(/^[^\w./~-]+|[,:]+$/g, '').replace(/:\d+(:\d+)?$/, ''));
    }
  }
  return [...new Set(out.map((p) => toPosix(path.relative(root, path.resolve(root, p)))).filter((p) => p && !p.startsWith('..')))];
}

// The paths a shell command WRITES, not every path it mentions: redirect targets (never /dev/null or a file
// descriptor), tee arguments, files edited in place by sed/perl, cp/mv destinations, rm/mkdir/touch arguments, and the
// project a migration or a patch lands in. `grep -n X src/... 2>/dev/null` writes nothing, and neither does
// `dotnet test tests/Api > run.log`. A write whose target cannot be named counts as a write under the first source root.
const UNKNOWN_SOURCE_WRITE = '<unknown source write>';
function writeTargets(command) {
  let c = String(command);
  // A heredoc body is content, not shell: `x => y` inside it is no redirect.
  c = c.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0]);
  // Quoted text is an argument, not syntax - kept only as a redirect target.
  c = c.replace(/(>>?\s*)?(["'])((?:(?!\2)[^\\]|\\.)*)\2/g, (m, redirect, q, body) => (redirect ? `${redirect}${body.replace(/\s/g, '_')}` : 'QUOTED'));
  const out = [];
  for (const m of c.matchAll(/(?:^|[^\w&<>=-])(?:\d|&)?>>?\|?\s*([^\s;|&<>()]+)/g)) if (m[1] !== '/dev/null' && !/^&/.test(m[1])) out.push(m[1]);
  for (const simple of c.split(/&&|\|\||[;|\n]/)) {
    const words = simple.trim().split(/\s+/).filter(Boolean);
    while (words.length && (/^\w+=/.test(words[0]) || /^(sudo|env|nohup|time|command|xargs)$/.test(words[0]))) words.shift();
    const [cmd, ...rest] = words;
    const args = rest.filter((w) => !w.startsWith('-') && !/^\d?>|^</.test(w));
    if (!cmd) continue;
    if (cmd === 'tee') out.push(...args);
    else if (cmd === 'sed' && rest.some((w) => /^-[a-zA-Z]*i/.test(w) || w === '--in-place')) out.push(...args.filter((w) => w !== 'QUOTED' && !/^s\W/.test(w)));
    else if (cmd === 'perl' && rest.some((w) => /^-[a-zA-Z]*i/.test(w))) out.push(...args.filter((w) => w !== 'QUOTED'));
    else if (/^(cp|mv|install|ln|rsync)$/.test(cmd)) { const t = rest.indexOf('-t'); out.push(t >= 0 && rest[t + 1] ? rest[t + 1] : args[args.length - 1]); }
    else if (/^(rm|rmdir|mkdir|touch|truncate)$/.test(cmd)) out.push(...args);
    else if (cmd === 'chmod') out.push(...args.slice(1));
    else if (cmd === 'dd') out.push(...rest.filter((w) => w.startsWith('of=')).map((w) => w.slice(3)));
    else if (cmd === 'dotnet' && rest[0] === 'new') { const o = rest.findIndex((w) => w === '-o' || w === '--output'); out.push(o >= 0 && rest[o + 1] ? rest[o + 1] : UNKNOWN_SOURCE_WRITE); }
    else if (cmd === 'dotnet' && rest[0] === 'ef' && rest[1] === 'migrations' && /^(add|remove)$/.test(rest[2] || '')) { const o = rest.findIndex((w) => w === '-p' || w === '--project'); out.push(o >= 0 && rest[o + 1] ? rest[o + 1] : UNKNOWN_SOURCE_WRITE); }
    else if (cmd === 'git' && rest[0] === 'apply') out.push(UNKNOWN_SOURCE_WRITE);
    else if (cmd === 'git' && (rest[0] === 'restore' || (rest[0] === 'checkout' && rest.includes('--')))) out.push(...rest.slice(rest.includes('--') ? rest.indexOf('--') + 1 : 1).filter((w) => !w.startsWith('-')));
  }
  return [...new Set(out.filter((t) => t && t !== 'QUOTED'))];
}
const relative = (root, paths) => [...new Set(paths.map((p) => toPosix(path.relative(root, path.resolve(root, p.replace(/^['"]|['"]$/g, ''))))).filter((p) => p && !p.startsWith('..')))];

// Only reading a section's text is a consult: `where`, `toc` and listings point at sections without reading them.
// `docRoots` is a LIST now, one entry per domain (each domain's own root, project-relative) - a project can be
// documented in code-style/ or related-projects/ alone, and a read under any one of them is a real consult, not
// just one under architecture/. Deliberately NOT the whole docs root: DOCS_ROOT also holds hook-blocks/,
// docs-log.jsonl, .branches/ and cross-project-tasks/, none of which is a section covering a file, and crediting
// any of them would turn the gate off by accident for a session that merely happens to touch one. A branch
// override under .branches/ is not credited either, on the same reasoning - it mixes real override text
// (<id>.md) with pure internal state (BASE.json, .base/, .conflict markers), and the intended way to read an
// override is `docs.js show <ref>`, which the branch above already credits wherever the text physically lives.
function consultedBy(input, paths, docRoots) {
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const command = typeof t.command === 'string' ? t.command : '';
  if (/docs\.js[ \t]+show[ \t]/.test(command)) {
    return (command.match(/docs\.js[ \t]+show[ \t]+[\w#.\/-]+(?:[ \t]+[\w#.\/-]+)*/g) || [])
      .flatMap((r) => r.split(/[ \t]+/).slice(2))
      .filter((r) => !r.startsWith('-') && /^[A-Za-z][\w.\/-]*(#[\w-]+)?$/.test(r));
  }
  if (/docs\.js[ \t]+(toc|where|files|status|lint|watch|stale)\b/.test(command)) return [];
  const isDoc = (p) => docRoots.some((d) => p === d || p.startsWith(`${d}/`));
  const hits = paths.filter(isDoc);
  if (hits.length && (/^(Read|Grep|Glob)$/.test(name) || (isShellTool(name) && !writeTargets(command).length))) return hits;
  return [];
}

function blockRow(root, input, reason) {
  try {
    const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'docs-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', reason: String(reason).split('\n')[0].slice(0, 200) })}\n`);
  } catch {}
}

function preToolUse(input, root, docs, state) {
  const paths = toolPaths(input, root);
  // One root per domain, not one hardcoded architecture/ - a project documented only in code-style/ must still
  // get credit for reading it. domains() is already required to succeed for this hook to have run at all (see
  // main()'s own gate above), so no extra guard is needed here.
  const docRoots = docs.domains().map((d) => toPosix(path.relative(root, docs.domainDir(d))));
  // Only these six tools can name a source target, so nothing else pays for the watch list.
  const name = input.tool_name || '';
  const isWrite = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name) || isShellTool(name);
  let roots = ['src', 'tests'];
  if (isWrite) { try { roots = docs.loadWatch().sourceRoots; } catch {} }
  const command = typeof (input.tool_input || {}).command === 'string' ? input.tool_input.command : '';
  const shellWrites = isShellTool(name) ? writeTargets(command) : null;
  let wrote = [];
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) wrote = paths;
  else if (shellWrites) wrote = relative(root, shellWrites.map((x) => (x === UNKNOWN_SOURCE_WRITE ? `${roots[0]}/*` : x)));
  // A PreToolUse write is INTENT. It is banked at each exit below that lets the call PROCEED and never on the deny,
  // so a write this hook holds is not credited to the seat that tried it. Banked before the source-root filter,
  // because a watch entry may name a path no source root covers and a write this hook never judges is still a write.
  const attribute = () => { if (wrote.length) recordWrite(root, input, shellWrites && shellWrites.includes(UNKNOWN_SOURCE_WRITE) ? [...wrote, UNKNOWN_SOURCE_WRITE] : wrote); };
  const consults = consultedBy(input, paths, docRoots);
  if (consults.length) {
    // One shell command can read a doc AND write a file - the shape the orientation block and the gate together
    // teach - so the read must not swallow the write.
    attribute();
    state.consults.push(...consults);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: consults.slice(0, 5), tool: input.tool_name });
    return;
  }
  if (!isWrite) return;
  const inRoots = (p) => roots.some((x) => p === x || p.startsWith(`${x}/`));
  const targets = wrote.filter(inRoots);
  if (!targets.length) { attribute(); return; }
  const allow = () => {
    attribute();
    state.edits++;
    saveState(input.session_id, state);
    if (state.edits === 1) log(root, input, { event: 'first-edit', target: targets[0], consulted: state.consults.length > 0 });
  };
  if (envOf(process.env, 'DOCS_GATE') === '0' || state.consults.length) { allow(); return; }
  // Nothing under the docs root can be read by section, so a hold would only point at an empty list.
  let readable = true;
  try { readable = docs.docFiles().length > 0; } catch {}
  if (!readable) { allow(); return; }
  if (state.holds >= MAX_HOLDS) { log(root, input, { event: 'bypass', target: targets[0], holds: state.holds }); allow(); return; }
  // Nobody at the terminal (hook-prelude.js unattended): the hold is still logged as a bypass, never made.
  if (unattended(input)) { log(root, input, { event: 'bypass', target: targets[0], why: 'unattended' }); allow(); return; }
  state.holds++;
  saveState(input.session_id, state);
  let hits = [];
  try { hits = docs.where(targets, 3); } catch {}
  let reason;
  if (!hits.length) {
    reason = `Docs not read yet in this session. Before changing ${targets[0]}, see what is documented: ${READ} files`;
  } else {
    const [first, ...rest] = hits;
    const body = first.text.length > INLINE_CHARS ? `${first.text.slice(0, INLINE_CHARS)}\n... (${first.text.length - INLINE_CHARS} more chars: \`${READ} show ${first.id}\`)` : first.text;
    state.consults.push(first.id);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: [first.id], tool: 'gate-inline' });
    reason = [
      `Docs not read yet in this session. ${first.id} covers ${targets[0]} - here it is:`,
      '', body, '',
      ...(rest.length ? [`Also covering it: ${rest.map((h) => `${h.id} (${h.chars} chars, \`${READ} show ${h.id}\`)`).join(', ')}`, ''] : []),
      'That is the convention this change follows. Now make the change.',
    ].join('\n');
  }
  log(root, input, { event: 'hold', target: targets[0], offered: hits.map((h) => h.id) });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

// The one ask this hook makes - a finished agent's SubagentStop and the main session's Stop send the same shape, so
// there is a single thing to learn. It has to be answerable by someone who has never read these docs: the section
// named the way a person would say it, the file it sits in, its CURRENT first sentence to compare the change
// against, and what each answer costs. The quoted line is ONE sentence (docs.js caps it at 200 chars), so the ask is
// a fixed size whatever the section grew to. The --expect hash is of the text being shown here: a rewrite of a
// section that moved meanwhile is refused instead of silently dropping whoever moved it.
function askLines(docs, files, refs) {
  const one = refs.length === 1;
  const subject = files.length === 1 ? 'this file' : 'these files';
  let mode = 'git';
  let branch = '';
  let mainline = true;
  try { mode = docs.docsMode(); branch = docs.branch() || ''; mainline = docs.isMainline(branch); } catch {}
  // What saving the doc costs, which is the whole difference between the two versioning modes. On mainline under
  // local versioning there is no overlay and nothing to commit, so neither of the other two lines is true there.
  const tail = mode === 'git'
    ? [`         and commit the doc${one ? '' : 's'} with your code, so ${one ? 'it travels' : 'they travel'} with this branch.`]
    : mainline
      ? [`         and ${one ? 'it lands' : 'they land'} in the shared docs at once. Nothing to commit.`]
      : [
        `         and ${one ? 'it is' : 'they are'} stored for branch ${branch} only. ${one ? 'It moves' : 'They move'} into the`,
        `         shared docs by ${one ? 'itself' : 'themselves'} once this branch is merged. Nothing to commit.`,
      ];
  return [
    ...(one
      ? [`One section documents ${subject} - '${refs[0].heading}', in ${refs[0].file}:`, `  "${refs[0].first}"`]
      : [`${refs.length} sections document ${subject}:`, ...refs.flatMap((r) => ['', `  '${r.heading}', in ${r.file}:`, `    "${r.first}"`])]),
    '',
    one ? 'Does your change still leave that true?' : 'Do your changes still leave those true?',
    '',
    '  Yes -> reply: docs ok',
    `  No  -> rewrite ${one ? 'the section' : 'each section your change made untrue'}, then run`,
    ...refs.map((r) => `           ${READ} set ${r.id} --expect ${r.hash}`),
    ...tail,
  ];
}

// The warning half - a protected section quoted exactly the way an ask quotes one, so it reads the same at a
// glance, but with no command anywhere near it: this engine's own write refusal already means nothing here
// can save a rewrite of that file, so offering `set` would be a command nobody may act on. It has to be
// readable without knowing any of this machinery: name what happened in plain words (a person owns this
// text), quote it, and say what to do about a contradiction - report it, not fix it.
function warnLines(files, refs) {
  const one = refs.length === 1;
  const subject = files.length === 1 ? 'this file' : 'these files';
  return [
    ...(one
      ? [`A DECISION recorded by a person covers ${subject} - '${refs[0].heading}', in ${refs[0].file}:`, `  "${refs[0].first}"`]
      : [`${refs.length} DECISIONS recorded by a person cover ${subject}:`, ...refs.flatMap((r) => ['', `  '${r.heading}', in ${r.file}:`, `    "${r.first}"`])]),
    '',
    one
      ? 'If your change makes that untrue, say so in your answer - this engine cannot rewrite it, only a person can.'
      : 'If your change makes any of those untrue, say so in your answer - this engine cannot rewrite them, only a person can.',
  ];
}

// The warning block leads, the ask block follows - never merged into a single confusing one, and the
// warning never borrows a command from its neighbour, because none of the lines it prints ever comes from
// askLines. An ask can be discharged with one reply ('docs ok') and ends the turn as far as a reader can
// tell; a warning can never be discharged at all. Printing it after that affordance would let a reader who
// answers the ask stop reading before ever reaching it, so the undischargeable half comes first.
// At Stop the reply to this block IS the session's last message - the one a print or SDK host reads, and the one a
// person scrolls back to - so it asks for the summary after the docs line (pilot 4: all 8 flow cells ended on
// 'docs ok'). A seat's reply at SubagentStop is its report to the caller and keeps the shape it has.
const SUMMARY_LAST = [
  'This reply is your last message, so it carries the task summary: the docs line first (docs ok, or',
  'the section you rewrote), then what you did in at most three lines.',
];
function finishAsk(docs, files, asks, warnings = [], closing = []) {
  const named = `${files.slice(0, FILES_NAMED).join(', ')}${files.length > FILES_NAMED ? ` and ${files.length - FILES_NAMED} more` : ''}`;
  const parts = [`Docs check: you changed ${named}`];
  if (warnings.length) parts.push('', ...warnLines(files, warnings));
  if (asks.length) parts.push('', ...askLines(docs, files, asks));
  if (closing.length) parts.push('', ...closing);
  return parts.join('\n');
}

// The same check for work done outside any subagent - and the only cover skills have, since a skill has no end
// event of its own and its work lands here.
function stop(input, root, docs, state) {
  if (envOf(process.env, 'DOCS_ASK') === '0' || input.stop_hook_active || state.asked || !state.snapshot) return;
  if (typeof docs.askRef !== 'function') return;
  let changed;
  let hits = [];
  try {
    changed = docs.changedSince(state.snapshot);
    if (!changed.files.length && !changed.dirs.length) return;
    // What the SESSION answers for: what it wrote ITSELF - a skill's work is main-session work, and its tool events
    // carry no agent id - plus every change no actor claimed at all, which is how a script's output and a write
    // through a tool this hook is not wired on still get asked about. What a SEAT wrote is that seat's to answer
    // for and it was already asked there; repeating it here is the same block twice in a row, which is how a gate
    // earns itself a ALFRED_CODE_DOCS_ASK=0. Attribution, not a subtraction: the session is asked about its own
    // later change to a section a seat answered for earlier.
    const mine = new Set(loadAgent(input.session_id, MAIN_ACTOR).wrote || []);
    const seats = otherActorWrites(input.session_id, MAIN_ACTOR);
    const files = changed.files.filter((f) => mine.has(f) || !seats.has(f));
    const dirs = changed.dirs.filter((d) => files.some((f) => f.startsWith(`${d}/`)));
    if (!files.length && !dirs.length) return;
    hits = docs.watchHits(files, dirs);
  } catch { return; }
  if (!hits.length) return;
  const { asks, warnings } = sectionRefs(docs, hits, ASK_SECTIONS);
  if (!asks.length && !warnings.length) return;
  const files = [...new Set(hits.flatMap((h) => h.files))];
  // Nobody at the terminal (hook-prelude.js unattended): the ask would only turn the final answer into
  // 'docs ok' (8 of 12 print-mode cells, pilot 2). Logged, never made.
  if (unattended(input)) { log(root, input, { event: 'ask-skipped', why: 'unattended', sections: asks.map((r) => r.id), files: files.slice(0, 5) }); return; }
  state.asked = true;
  saveState(input.session_id, state);
  const reason = finishAsk(docs, files, asks, warnings, SUMMARY_LAST);
  log(root, input, { event: 'ask-update', sections: asks.map((r) => r.id), warnings: warnings.map((r) => r.id), files: files.slice(0, 5), kinds: [...new Set(hits.map((h) => h.kind))] });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

module.exports = { writeTargets, consultedBy, toolPaths, toPosix, sweepOldState };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`docs-session: ${error.message}\n`); }
}
