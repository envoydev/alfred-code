#!/usr/bin/env node
// docs-session.js - makes the project's docs (every domain under the docs root) the starting point of a session
// and keeps them honest at its end.
//   SessionStart  -> folds merged branches' doc versions into mainline, then pushes ORIENTATION.md, this branch's
//                    overrides and conflicts, and how to read by section; snapshots the tree for the end check
//   SubagentStart -> the same orientation for a dispatched subagent (SessionStart context never reaches one at
//                    dispatch; a seat's own compaction runs SessionStart inside it, with its agent_id), and the
//                    snapshot the finish ask below compares against
//   PreToolUse SubagentHandback -> what THAT agent WROTE, once, before its report leaves: a file it wrote that also
//                    changed and hits watch.json denies the hand-back with the owning sections quoted, so whoever made
//                    the change says whether the docs still hold, and the retried hand-back carries the answer
//   SubagentStop  -> the same ask for a seat that stopped without a hand-back (a harness with no such tool)
//   PreToolUse    -> records reads of the docs and attributes each write to the agent that made it; holds the FIRST
//                    change under a source root until a section was read, handing the covering section over inline -
//                    what a merge just folded into mainline comes first
//   Stop          -> once per session, the same ask for what the SESSION wrote itself (a skill's work is main-session
//                    work) plus every change no actor claimed - a script's output, a tool this hook is not wired on
// `docs-session:<part>` in ALFRED_CODE_HOOKS_OFF turns a part off - block, gate or ask (the env audit of 2026-10-21;
// the old ALFRED_CODE_DOCS_BLOCK / _GATE / _ASK at 0 still do for the 2.x line - hook-prelude.js partOff).
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
// The Stop chain (hook-prelude.js stopHeldThisCycle): without the prelude, any continuation stands down - the old reading.
let stopHeld = (input) => !!(input && input.stop_hook_active);
let markHeld = () => {};
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    unattended = prelude.unattended || unattended;
    if (prelude.stopHeldThisCycle) {
      stopHeld = (input) => prelude.stopHeldThisCycle('docs-session', input);
      markHeld = (input) => prelude.markStopHeld('docs-session', input);
    }
    off = prelude.standDown('docs-session');
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}

// A part's off switch (hook-prelude.js partOff); with no prelude, the old per-part keys alone.
const LEGACY_PART = { block: 'DOCS_BLOCK', gate: 'DOCS_GATE', ask: 'DOCS_ASK' };
let partOff = (hook, part) => envOf(process.env, LEGACY_PART[part]) === '0';
try { partOff = require('./hook-prelude.js').partOff || partOff; } catch { /* an install without the prelude reads the old keys */ }
const docsOff = (part) => partOff('docs-session', part);

const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;
// 2.8.0: the hooks' state lives under <data root>/state/ (layout.js); the pre-2.8.0 <docs-path>/flow/ is still read for
// the 2.x line, and is the only path when layout.js is not beside this file.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
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
      if (!f.startsWith('docs-session-') || !/\.json(?:\.\d+\.tmp)?$/.test(f)) continue;
      if (Date.now() > deadline) return;
      try { if (now - fs.statSync(path.join(dir, f)).mtimeMs > SWEEP_MS) fs.rmSync(path.join(dir, f), { force: true }); } catch {}
    }
  } catch {}
}
const saveState = (s, v, agent) => {
  const file = statePath(s, agent);
  let fresh = false;
  try { fresh = !fs.existsSync(file); } catch {}
  // Written whole or not at all: a parallel PreToolUse call read a half-written file as `{snapshot: null}` and saved it
  // back, losing the session's snapshot - 1 in 40 rounds at 4 parallel calls, 6 in 10 at 24 - and with it the Stop ask
  // (audit 2026-10-08). A rename replaces the file in one step; where it cannot (a reader holding it open on win32), the
  // direct write is the old behaviour.
  const tmp = `${file}.${process.pid}.tmp`;
  let staged = false;
  try { fs.writeFileSync(tmp, JSON.stringify(v)); staged = true; fs.renameSync(tmp, file); }
  catch { try { fs.rmSync(tmp, { force: true }); if (staged) fs.writeFileSync(file, JSON.stringify(v)); } catch {} }
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
// The first-change gate's record, per actor (loading audit 2026-10-21 G4): a section a seat was handed never reached the
// main context, and the main session's read never reached a seat. A pre-2.8.x session file's top-level fields are the
// main session's.
function gateOf(state, input) {
  const key = actorKey(input);
  if (!state.gate || typeof state.gate !== 'object' || Array.isArray(state.gate)) state.gate = {};
  if (!state.gate[key]) {
    state.gate[key] = key === MAIN_ACTOR
      ? { consults: Array.isArray(state.consults) ? state.consults : [], holds: Number(state.holds) || 0, candidates: !!state.candidates }
      : { consults: [], holds: 0, candidates: false };
  }
  return state.gate[key];
}
// A worktree a seat was given under `.claude/worktrees/<n>/` mirrors the project: its paths are judged as the project's.
const unWorktree = (p) => { const m = /^\.claude\/worktrees\/[^/]+\/(.+)$/.exec(p); return m ? m[1] : p; };
// The checkout an actor's writes belong to, recorded beside them so another session on the same project can tell its
// own paths from one of another project's (both are project-relative). On win32 the case is folded, as the file system does.
const rootKey = (root) => { const k = toPosix(path.resolve(String(root || '.'))); return process.platform === 'win32' ? k.toLowerCase() : k; };
// The temp dir listed once per Stop and shared by both attribution reads below (52,840 entries cost 78ms to list twice).
const tmpEntries = () => { try { return fs.readdirSync(os.tmpdir()); } catch { return []; } };
// A write, attributed to the actor that made it. Banked only where the call is allowed to PROCEED (see preToolUse):
// a write this hook denies never lands, and crediting it would let a neighbour's change read as this seat's work.
const WROTE_CAP = 500;
function recordWrite(root, input, wrote) {
  if (docsOff('ask')) return; // the switch turns the part off, record included
  const key = actorKey(input);
  const a = loadAgent(input.session_id, key);
  const had = (a.wrote || []).length;
  const union = [...new Set([...(a.wrote || []), ...wrote])];
  if (union.length === had && a.root === rootKey(root)) return;
  a.root = rootKey(root);
  // Past the cap an actor keeps its first WROTE_CAP paths and later ones are dropped, so a busy seat goes SILENT
  // rather than answering for files it never wrote. Right direction, invisible without this row.
  if (union.length > WROTE_CAP && had < WROTE_CAP) log(root, input, { event: 'wrote-cap', actor: key, cap: WROTE_CAP, dropped: union.length - WROTE_CAP });
  a.wrote = union.slice(0, WROTE_CAP);
  saveState(input.session_id, a, key);
}
// When the actor first ran a shell command that may WRITE files no parser can name (a build, a generator, a script). The
// Stop ask's 'no actor claimed' bucket - how a script's output is asked about - counts only when the main session ran
// such a command (the 2026-10-17 usage audit: a session that only read was asked about another session's uncommitted
// diff, which no claim of that session named). A read is every step one of READ_STEP.
const READ_STEP = /^(?:git\s+(?:-C\s+\S+\s+)?(?:status|diff|log|show|branch|rev-parse|ls-files|ls-tree|grep|blame|remote|fetch|describe|tag\s+(?:-l|--list|--contains|--points-at)|config\s+--get|check-ignore|merge-base|rev-list|shortlog|cat-file|for-each-ref|stash\s+list|worktree\s+list)\b|(?:ls|cat|head|tail|grep|egrep|fgrep|rg|wc|echo|printf|pwd|which|type|test|\[|\[\[|stat|file|sort|uniq|cut|tr|date|jq|diff|cmp|du|df|tree|true|false|sleep|cd|pushd|popd|basename|dirname|realpath|readlink|whoami|uname|env|printenv|gh)\b|sed\s+-n\b|awk\b(?![^|;&]*>)|find\b(?![^|;&]*(?:-delete|-exec|-ok))|node\s+\S*docs\.js\s+(?:show|status|stale|lint|find)\b)/;
function recordRun(input, command) {
  if (docsOff('ask') || !command) return;
  const steps = String(command).split(/\|\||&&|[;|\n]/).map((x) => x.trim().replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '')).filter(Boolean);
  if (steps.every((x) => READ_STEP.test(x) && !/(?:^|\s)\d?>>?\s*(?!\/dev\/null|&)/.test(x))) return;
  const key = actorKey(input);
  const a = loadAgent(input.session_id, key);
  if (a.ran) return;
  a.ran = Date.now();
  saveState(input.session_id, a, key);
}
// The files a `git stash` in this command moves into or out of the working tree, read BEFORE it runs: a push takes the
// tree's changes (its pathspec after `--`, untracked files with -u / -a), a pop or apply brings the named entry's. No
// parser names them as targets, so a sibling session's stash push read as this session's change at its Stop - 'you
// changed <file>' for a file it never touched (audit 2026-10-20 C25, c5287cc1) - and a stash this session
// applied read as its own authoring (7c1af769). Moved is not authored: recorded apart from `wrote`, it claims the file for
// its session against the others and is never asked about itself. 1.5s per git call; a failure records nothing.
function stashMoves(command, base, root) {
  if (!shellReader || !/\bstash\b/.test(command)) return [];
  const lines = (dir, args) => {
    try {
      return require('child_process').execFileSync(...require('./hook-prelude.js').gitSafe(['-c', 'core.quotePath=false', ...args], { cwd: dir, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }))
        .toString('utf8').split('\n').filter(Boolean);
    } catch { return []; }
  };
  const out = new Set();
  let calls = [];
  try { calls = shellReader.gitCalls(command); } catch { return []; }
  for (const g of calls) {
    if (g.sub !== 'stash') continue;
    const dir = g.dirs && g.dirs.length ? path.resolve(base, ...g.dirs) : base;
    const argv = g.argv || [];
    const verb = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'push';
    const rest = verb === argv[0] ? argv.slice(1) : argv;
    let files = [];
    if (verb === 'pop' || verb === 'apply') {
      const ref = rest.find((w) => !w.startsWith('-')) || 'stash@{0}';
      files = lines(dir, ['stash', 'show', '--name-only', '--include-untracked', '--relative', ref]);
      if (!files.length) files = lines(dir, ['stash', 'show', '--name-only', '--relative', ref]);
    } else if (verb === 'push' || verb === 'save') {
      const at = rest.indexOf('--');
      const spec = verb === 'push' && at >= 0 ? rest.slice(at + 1) : [];
      files = lines(dir, ['diff', '--name-only', '--relative', 'HEAD', '--', ...spec]);
      if (rest.some((w) => /^(?:-u|--include-untracked|-a|--all)$/.test(w))) files.push(...lines(dir, ['ls-files', '--others', '--exclude-standard', '--', ...spec]));
    }
    for (const f of files) out.add(toPosix(path.relative(root, path.resolve(dir, f))));
  }
  return [...out].filter((p) => p && !p.startsWith('..'));
}
function recordMoved(root, input, moved) {
  if (docsOff('ask') || !moved.length) return;
  const key = actorKey(input);
  const a = loadAgent(input.session_id, key);
  a.root = rootKey(root);
  a.moved = [...new Set([...(a.moved || []), ...moved])].slice(0, WROTE_CAP);
  saveState(input.session_id, a, key);
}
// Every path the OTHER actors of this session recorded, written or moved. READ only: writing here would race preToolUse, and a file
// that cannot be read simply leaves its paths unclaimed, which is the safe direction.
function otherActorWrites(session, exceptKey, entries = tmpEntries()) {
  const prefix = `docs-session-${String(session || 'none').replace(/[^\w-]/g, '')}--`;
  const out = new Set();
  for (const f of entries) {
    if (!f.startsWith(prefix) || !f.endsWith('.json') || f === `${prefix}${exceptKey}.json`) continue;
    try { const v = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), 'utf8')); for (const p of [...(v.wrote || []), ...(v.moved || [])]) out.add(p); } catch {}
  }
  return out;
}
// Every path an actor of ANOTHER session recorded on this same checkout since `since` (the snapshot's epoch seconds).
// Two sessions on one project - a second terminal, a parallel run - each saw the other's edits as a change no actor of
// their own claimed, so a read-only session was asked about a migration the other session wrote (2026-10-16, an aspnet
// project on 2.5.0). A state file last written before the snapshot, or one with no `root` (written before this record),
// claims nothing: an unread claim leaves the change the session's, the safe direction. READ only, like the seats' read.
function otherSessionWrites(session, root, since, entries = tmpEntries()) {
  const own = `docs-session-${String(session || 'none').replace(/[^\w-]/g, '')}--`;
  const key = rootKey(root);
  const out = new Set();
  if (!Number.isFinite(since)) return out;
  for (const f of entries) {
    if (!f.startsWith('docs-session-') || !f.includes('--') || !f.endsWith('.json') || f.startsWith(own)) continue;
    try {
      const file = path.join(os.tmpdir(), f);
      if (fs.statSync(file).mtimeMs / 1000 < since) continue;
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (v.root === key) for (const p of [...(v.wrote || []), ...(v.moved || [])]) out.add(p);
    } catch {}
  }
  return out;
}
// The untracked-at-start line rides the SessionStart block when there is one, and goes out alone when there is not.
let startNote = '';
const emit = (event, text) => {
  const body = event === 'SessionStart' && startNote ? `${text}\n\n${startNote}` : text;
  if (event === 'SessionStart') startNote = '';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: body } }));
};
// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is shell-writes.js's one list,
// shipped beside this hook on both routes. Judging only `Bash` left the first-change gate open on every Windows
// session and earned a doc read through PowerShell no consult credit; a copy that runs before the module lands
// judges the file tools alone.
let isShellTool = () => false;
let shellReader = null;
try { shellReader = require(path.join(__dirname, 'shell-writes.js')); ({ isShellTool } = shellReader); } catch { /* see above */ }
// A navigation server's two edit tools (Serena's, I12): each changes a source file, named in `tool_input.relative_path`
// (toolPaths reads it), so its first change is held like an Edit's. The stack ships no server (2026-10-24): the tools are
// matched by name under whatever server the user registered.
const NAV_EDIT = /^mcp__.+__(?:rename_symbol|safe_delete_symbol)$/;
// One log file holds every session's rows, and two sessions interleave in it, so each row carries the id that
// tells them apart. It lives beside hook-blocks/ and tools-usage/ in the data root's statistics/ (2.8.0, layout.js) -
// every ledger in this stack does, never committed; before 2.8.0, under the docs root, which is still read.
const planDirsOf = (root) => (layout ? layout.planDirs(root) : [path.resolve(root, docsRootEnv(), 'plans')]);
const docsLogFile = (root) => (layout ? layout.statsPath(root, ['docs-log.jsonl']) : path.join(path.resolve(root, docsRootEnv()), 'docs-log.jsonl'));
const log = (root, input, row) => {
  try {
    const file = docsLogFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), session: input.session_id || '', ...row })}\n`);
  } catch {}
};

// R5 (release 3): each linked ancestor whose docs root holds a domain, nearest first, named read-only - main session
// only, a seat works from its brief. The areas follow docs.js domains()'s rule, read here: that module is bound to
// this project's own docs root.
function workspaceDocsLines(input, root, docs) {
  if (input.agent_id || !layout || typeof layout.ancestorPrefsDirs !== 'function') return [];
  let dirs = [];
  try { dirs = layout.ancestorPrefsDirs(root); } catch { return []; }
  const reserved = docs.RESERVED_DOMAIN_NAMES || new Set();
  const out = [];
  for (const { dir } of dirs) {
    const docsRoot = path.dirname(dir);
    let areas = [];
    try {
      areas = fs.readdirSync(docsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !reserved.has(e.name))
        .map((e) => e.name)
        .filter((n) => n === 'architecture' || fs.existsSync(path.join(docsRoot, n, 'watch.json')))
        .sort();
    } catch { /* no docs root there */ }
    if (areas.length) out.push(`Workspace root docs (read-only): ${docsRoot} - ${areas.join(', ')}`);
  }
  return out;
}

function orientation(root, docs) {
  let block = '';
  try { block = fs.readFileSync(docs.BLOCK_FILE, 'utf8').trim(); } catch {}
  // A copy of the footer below pasted into the file is dropped, not pushed twice (docs.js HOOK_FOOTER; an older engine
  // beside this hook has none, and the block goes out as written).
  if (docs.HOOK_FOOTER) block = block.split('\n').filter((l) => !docs.HOOK_FOOTER.test(l)).join('\n').trim();
  // The 4KB cap is enforced here, not only reported by lint: an 11,901-byte file pushed the block past the harness's
  // 10,000-character context cap, which swaps it for a path and a preview - the where / show lines at its end were
  // lost (audit 2026-10-08).
  const BLOCK_CAP = 4096;
  if (block.length > BLOCK_CAP) block = `${block.slice(0, BLOCK_CAP)}\n... (ORIENTATION.md continues past its 4KB cap - \`${READ} lint\` names the overrun; read the rest by section)`;
  // ORIENTATION.md stays architecture's own file, read exactly as before - a domain gets no per-domain twin.
  // The one line below is the part that used to name architecture/ as if it were the only docs folder; a
  // project whose docs are preferences/ and awareness/ (no architecture/ at all) is named correctly here.
  let doms = [];
  try { doms = durableOf(docs); } catch {}
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
  // A compaction or a /clear dropped the sections this actor read: its gate holds again (a seat's own compaction runs
  // this hook inside the seat, with its agent_id - only that seat's gate re-arms).
  if (input.source === 'compact' || input.source === 'clear') {
    Object.assign(gateOf(state, input), { consults: [], holds: 0, candidates: false });
    saveState(input.session_id, state);
  }
  // Repair the branch snapshots BEFORE looking for merged branches, so a snapshot repaired here is promotable in
  // this session and not only the next one.
  try { docs.refreshBaseMeta(); } catch {}
  let promoted = [];
  try { promoted = docs.autoPromote(); } catch {}
  // A row with changed=false is a standing, already-reported conflict - skip it, or it would be re-logged and
  // re-announced at every session start.
  const landed = promoted.filter((p) => p.changed);
  for (const p of landed) log(root, input, { event: 'promote', branch: p.branch, how: p.how, results: p.results });
  if (docsOff('block')) return;
  let st = null;
  try { st = docs.status(); } catch {}
  const lines = orientation(root, docs);
  const extra = workspaceDocsLines(input, root, docs);
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
  const repair = integrityLine(docs);
  if (repair) extra.push(repair);
  if (st && st.overrides.length) extra.push(`You are on branch ${st.branch}. ${st.overrides.length} doc section(s) hold this branch's own decisions and replace mainline's in every read: ${st.overrides.slice(0, 6).join(', ')}${st.overrides.length > 6 ? ` ... (\`${READ} status\`)` : ''}.`);
  // Each list is cut at six names with a count and the command that lists the rest (audit 2026-10-20, the hooks track's
  // minor list: three lists here had no cap, so a long-lived branch could push the read lines past the start cap).
  const six = (list) => `${list.slice(0, 6).join(', ')}${list.length > 6 ? ` (+${list.length - 6} more: \`${READ} status\`)` : ''}`;
  if (st && st.conflicts.length) extra.push(`Conflicts: ${six(st.conflicts)} - mainline changed lines this branch also changed; \`${READ} show <id> --conflict\` shows both, \`${READ} set <id>\` saves the reconciled text.`);
  if (st && st.mainline && st.deletedUnmerged.length) extra.push(`Doc versions of deleted branches never detected as merged: ${six(st.deletedUnmerged)} - \`${READ} promote <branch>\` folds one in, \`${READ} prune <branch>\` drops it.`);
  if (st && st.mainline && st.liveOnMainline && st.liveOnMainline.length) extra.push(`Doc versions of branches sitting on mainline with no proof they merged: ${six(st.liveOnMainline)} - one that was merged fast-forward looks exactly like one that only caught up, so nothing was folded in; if it landed, \`${READ} promote <branch>\`.`);
  if (st && st.outgrown) extra.push(`${st.outgrown} section(s) describe code that changed since they were written - each says so when opened, and the code wins there.`);
  // With no doc file to read by section (a provisional orientation alone, or a domain whose every file is protected),
  // the gate has nothing to hand over - it stands down, so the line announcing it goes too.
  let readable = true;
  try { readable = durableDocFiles(docs).length > 0; } catch {}
  if (!docsOff('gate') && readable) {
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
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(input, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  process.env.CLAUDE_PROJECT_DIR = root;
  // before the domain gate: a plan file lives under the docs root whether or not a domain does
  if (event === 'PreToolUse' && stampedPlanWrite(input, root)) return;
  if (event === 'PreToolUse' && stampAfterTimeoutWrite(input, root)) return;
  if (event === 'SessionStart') {
    const stranded = sweepStrandedRoot(root);
    if (stranded !== null) log(root, input, { event: 'stranded-root', from: LEGACY_DOCS_ROOT, files: stranded });
    startNote = recordUntracked(input, root);
  }
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
  // before the domain gate: a first capture writes architecture/ before any domain exists
  if (event === 'PreToolUse' && seatHold(input, root, docs)) return;
  // A domain is any top-level folder under the docs root holding a watch.json (architecture counts even
  // without one - see docs.js's own domains()). A project whose docs are preferences/ and awareness/,
  // with no architecture/ at all, must still get the SessionStart block, the gate and the finish ask - so the
  // whole-hook gate reads every domain, not one hardcoded folder. An empty list is still the right reason to
  // return: nothing under the docs root declares itself a domain. A RECOMPUTED domain (docs.js recomputed - quality/'s
  // assessment, rewritten from the code at each capture) does not count: alone it gets no start block, gate or ask.
  if (!durableOf(docs).length) {
    // R5: a child with no domain of its own still learns where its workspace root's docs are.
    const ws = event === 'SessionStart' && !docsOff('block') ? workspaceDocsLines(input, root, docs) : [];
    if (ws.length) emit('SessionStart', ws.join('\n'));
    return;
  }
  const state = loadState(input.session_id);
  if (event === 'SessionStart') return sessionStart(input, root, docs, state);
  if (event === 'SubagentStart') return subagentStart(input, root, docs);
  if (event === 'SubagentStop') return subagentStop(input, root, docs);
  if (event === 'PreToolUse' && input.tool_name === HANDBACK_TOOL) return handback(input, root, docs);
  if (event === 'PreToolUse') return preToolUse(input, root, docs, state);
  if (event === 'Stop') return stop(input, root, docs, state);
}

// What was untracked before the session began is not the session's change (pilot 3: ~150 files the harness left
// untracked drove 19 commit-gate denials, and one close committed them). The list is keyed by HEAD and written ONCE
// per HEAD: a resume, a compact start, a fresh-session hand-off and a /clear all find it and keep it, so the files an
// earlier session of the same change created stay that change's own; a commit moves HEAD and the next session takes a
// fresh snapshot. guard-ungated-commit.js reads the same key: out of the receipt's count, and a git add that would
// sweep one in is blocked unless the user names it. Root-relative, spelled as git lists them with core.quotePath=false,
// at most UNTRACKED_CAP paths (past it a path reads as the change's own), and a record past SWEEP_MS goes when the
// next one is written. Only a session's FIRST start (`source` startup, clear, or none) may take a snapshot, and it
// names the record it used in `untracked-session-<sid>`: a compact or resume start reuses that record and never
// snapshots, since a HEAD the session itself moved has no record yet and a snapshot then lists the session's own new
// files as pre-existing (audit 2026-10-10 C09, session c6142301: 7 of its own files, and the commit guard would have
// blocked their git add). guard-ungated-commit.js reads the session's pointer first.
const UNTRACKED_CAP = 20000;

// A docs move (`--data-move move`) can leave the old default behind holding hook state: the move's own tool call
// ends in PostToolUse hooks that still read the session's old docs root, and their recursive mkdir rebuilds the
// folder the move just emptied (2.2.0 upgrade: one monitor row in .claude/docs/flow). The next session start folds
// it into the live root - a .jsonl appends, any other file moves when the live root lacks it and is dropped when it
// holds one, the newer copy - then removes the emptied folders. Only a root holding nothing but hook state and OS
// litter is touched: one doc, one other entry or one file git tracks there leaves all of it where it is.
const LEGACY_DOCS_ROOT = '.claude/docs';
const STATE_DIRS = new Set(['flow', 'hook-blocks', 'history', 'tools-usage']);
const STATE_FILES = new Set(['docs-log.jsonl']);
const OS_LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
function sweepStrandedRoot(root) {
  const from = path.resolve(root, LEGACY_DOCS_ROOT);
  const to = path.resolve(root, docsRootEnv());
  const inside = (a, b) => { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (inside(from, to) || inside(to, from)) return null;
  let entries;
  try { entries = fs.readdirSync(from, { withFileTypes: true }); } catch { return null; }
  // A case-insensitive file system answers both spellings of one folder: the same inode is the same root.
  try { const a = fs.statSync(from); const b = fs.statSync(to); if (a.ino === b.ino && a.dev === b.dev) return null; } catch { /* no live root yet */ }
  const state = (e) => (e.isDirectory() && STATE_DIRS.has(e.name)) || (e.isFile() && (STATE_FILES.has(e.name) || OS_LITTER.has(e.name)));
  if (!entries.every(state)) return null;
  try {
    const tracked = require('child_process').execFileSync(...require('./hook-prelude.js').gitSafe(['ls-files', '-z', '--', LEGACY_DOCS_ROOT], { cwd: root, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
    if (tracked.length) return null;
  } catch { /* no repo: nothing is tracked */ }
  let files = 0;
  // Where a stranded entry goes: its 2.8.0 home (layout.js) - a receipt in state/approvals/, other flow/ scratch in
  // state/sessions/, a session record in state/history/, a ledger in statistics/ - read the way the hooks read it
  // (findState / findStats: the live copy a pre-2.8.0 docs root still holds wins), so the fold never writes the docs root's
  // retired flow/ or hook-blocks/. Without layout.js beside this hook, the pre-2.8.0 docs root as before.
  const homeOf = (top, name) => {
    if (!layout) return path.join(to, ...(top ? [top] : []), name);
    if (top === 'flow') return layout.findState(root, layout.flowKind(name), name);
    if (top === 'history') return layout.findState(root, 'history', name);
    return layout.findStats(root, top ? [top, name] : [name]);
  };
  const fold = (src, dst, top) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const a = path.join(src, e.name);
      // the stranded root's own entries are the state folders; one level down each entry takes its layout home
      const b = top === undefined ? (e.isDirectory() ? null : homeOf('', e.name)) : top === null ? path.join(dst, e.name) : homeOf(top, e.name);
      if (e.isDirectory()) { fold(a, b, top === undefined ? e.name : null); fs.rmdirSync(a); continue; }
      if (!e.isFile() || OS_LITTER.has(e.name)) { fs.rmSync(a, { force: true }); continue; }
      files++;
      if (!fs.existsSync(b)) { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); continue; }
      if (e.name.endsWith('.jsonl')) fs.appendFileSync(b, `\n${fs.readFileSync(a, 'utf8')}`);
      fs.rmSync(a, { force: true });
    }
  };
  try { fold(from, to, undefined); fs.rmdirSync(from); } catch { return null; /* a partial fold leaves the rest for the next start */ }
  return files;
}

// 2.8.0: the records and pointers are session scratch, <data root>/state/sessions/ (layout.js); one an older hook left
// in the pre-2.8.0 <docs-path>/flow/ is still read, so a session it started keeps its record.
function recordUntracked(input, root) {
  let file;
  let list;
  try {
    const legacyFlow = path.resolve(root, docsRootEnv(), 'flow');
    const find = (name) => (layout ? layout.findState(root, 'sessions', name) : path.join(legacyFlow, name));
    const sid = String(input.session_id || '').replace(/[^\w.-]/g, '_');
    const pointer = sid ? `untracked-session-${sid}` : '';
    const later = input.source === 'compact' || input.source === 'resume';
    if (later && pointer) {
      try {
        const named = path.basename(fs.readFileSync(find(pointer), 'utf8').trim());
        if (named.startsWith('untracked-at-start-') && fs.existsSync(find(named))) file = find(named);
      } catch { /* no pointer - an older start, or none */ }
    }
    if (!file) {
      let head = '';
      try { head = require('child_process').execFileSync(...require('./hook-prelude.js').gitSafe(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).toString().trim(); } catch { /* no commit yet, or no repo - ls-files below tells them apart */ }
      file = find(`untracked-at-start-${/^[0-9a-f]{7,64}$/.test(head) ? head : 'unborn'}`);
    }
    if (fs.existsSync(file)) list = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    else if (later) return '';
    else {
      const out = require('child_process').execFileSync(...require('./hook-prelude.js').gitSafe(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'],
        { cwd: root, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).toString('utf8');
      // The stack's own files are never the change: the docs root, and the data root's state/ and statistics/.
      const own = [docsRootEnv(), ...(layout ? ['state', 'statistics'].map((d) => path.join(layout.dataRoot(), d)) : [])]
        .map((d) => toPosix(path.relative(root, path.resolve(root, d)))).filter((d) => d && !d.startsWith('..'));
      const inDocs = (f) => own.some((d) => f === d || f.startsWith(`${d}/`));
      list = out.split('\0').filter((f) => f && !f.includes('\n') && !inDocs(f)).slice(0, UNTRACKED_CAP);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, list.map((f) => `${f}\n`).join(''));
      sweepRecords(path.dirname(file));
    }
    if (pointer && !later) {
      const at = layout ? layout.statePath(root, 'sessions', pointer) : path.join(legacyFlow, pointer);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, `${path.basename(file)}\n`);
    }
  } catch { return ''; }
  if (!list.length) return '';
  const rel = toPosix(path.relative(root, file));
  return `${list.length} path${list.length === 1 ? ' was' : 's were'} untracked when this change started (at this HEAD) - not its change: a commit stages ${list.length === 1 ? 'it' : 'them'} only when the user names ${list.length === 1 ? 'it' : 'them'} (${rel}).`;
}
function sweepRecords(dir, now = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('untracked-at-start-') && !f.startsWith('untracked-session-')) continue;
      const full = path.join(dir, f);
      if (now - fs.statSync(full).mtimeMs > SWEEP_MS) fs.rmSync(full, { force: true });
    }
  } catch { /* a sweep never fails the start */ }
}

// Claude Code's own seats that write no project code: the orientation block is ~1-4KB they never use and the snapshot
// feeds an ask they never earn (deep hooks review 2026-10-16). A stack seat or general-purpose still gets both.
const NO_DOCS_SEATS = new Set(['Explore', 'Plan', 'claude-code-guide', 'statusline-setup']);

// After a git merge of committed docs, or a hand edit: the two breakages that make a doc untrustworthy to read.
// Read by the engine's own integrity pass - the two checks alone, one parse per file: the whole lint re-parsed every
// doc per watch id (492ms at 40 docs, 2,301ms at 100, audit 2026-10-08). An older engine beside this hook has none.
function integrityLine(docs) {
  let broken = [];
  try { broken = typeof docs.integrity === 'function' ? docs.integrity() : docs.lint().problems.filter((p) => /^(merge conflict markers|duplicate id)/.test(p)); } catch {}
  return broken.length ? `The docs need a repair before they are trusted: ${broken.slice(0, 3).join('; ')}${broken.length > 3 ? ` (+${broken.length - 3} more: \`${READ} lint\`)` : ''}.` : '';
}

function subagentStart(input, root, docs) {
  if (NO_DOCS_SEATS.has(input.agent_type)) return;
  // The snapshot is what makes the finish ask possible, and it is NOT the orientation block: the block's switch
  // must not blind the ask, and the ask's switch must not cost a snapshot nobody will read.
  if (!docsOff('ask')) {
    const key = agentKey(input);
    const a = loadAgent(input.session_id, key);
    // Only the first start writes it: where two seats fold onto one key, the earlier snapshot keeps both their
    // changes in view instead of hiding the first agent's work behind the second's start.
    if (!a.snapshot) { try { a.snapshot = docs.snapshot(); } catch {} saveState(input.session_id, a, key); }
  }
  // A seat reads the same docs, so it is told the same repair line the session start carries (loading audit G8).
  if (!docsOff('block')) emit('SubagentStart', [...orientation(root, docs), integrityLine(docs)].filter(Boolean).join('\n'));
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
  // statistics/ first, then the pre-2.8.0 log under the docs root, which an older docs.js copy still writes until the
  // update moves the folders - a set logged in either answers the ask
  for (const file of new Set([docsLogFile(root), path.join(path.resolve(root, docsRootEnv()), 'docs-log.jsonl')])) {
    try {
      const size = fs.statSync(file).size;
      const len = Math.min(size, LEDGER_TAIL);
      // The tail is read first, and widened to the whole file only when every row in it was NEWER than the ask - the
      // one case where the set can still lie further back, and the one case where a window would otherwise report a
      // rewrite that happened as a section nobody touched.
      if (!scanLedger(file, size, len, since, want, done) && len < size) scanLedger(file, size, size, since, want, done);
    } catch {}
  }
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
// A section whose own text names a file a watch entry hit, verbatim, answers before the entries' sections (audit
// 2026-10-10 C23, session f6c591fa): each is a queue of its own ahead of theirs, so the round-robin below takes it
// first. Only the files already hit are matched, so the ask fires exactly when it did before.
function namedFirst(docs, hits, keep = () => true) {
  if (typeof docs.namingSections !== 'function') return hits;
  let named = [];
  try { named = docs.namingSections(hits.flatMap((h) => h.files), ASK_SECTIONS, keep); } catch { return hits; }
  return [...named.map((n) => ({ kind: 'names the file', files: n.files, sections: [n.id], domain: n.domain })), ...hits];
}

// A RECOMPUTED domain's sections (docs.js recomputed: rewritten from the code at each capture, so reading one is no
// orientation and a seat never answers for one). Each reader is guarded, so an older engine reads every domain durable.
const isRecomputedDomain = (docs, d) => { try { return typeof docs.recomputed === 'function' && docs.recomputed(d); } catch { return false; } };
const isRecomputedRef = (docs, ref) => { try { return typeof docs.refRecomputed === 'function' && docs.refRecomputed(ref); } catch { return false; } };
const durableOf = (docs) => (typeof docs.durableDomains === 'function' ? docs.durableDomains() : docs.domains());
function durableDocFiles(docs) {
  const dirs = durableOf(docs).map((d) => docs.domainDir(d));
  return docs.docFiles().filter((f) => dirs.some((d) => !path.relative(d, f).startsWith('..')));
}

// The close ask's two pools: the durable sections first, up to the cap, then the recomputed ones in the slots left -
// a weakness section never takes a durable section's place, whichever names the file. `rcHits` is the recomputed
// pool's own hit list (the close adds the seats' files to it); a section is placed by the domain its ref resolves to.
function askPools(docs, hits, limit, exclude = () => false, rcHits = hits) {
  const durable = sectionRefs(docs, namedFirst(docs, hits, (n) => !isRecomputedDomain(docs, n.domain)), limit, (id) => exclude(id) || isRecomputedRef(docs, id));
  const left = limit - durable.asks.length;
  if (left <= 0 || !rcHits.length) return durable;
  const rc = sectionRefs(docs, namedFirst(docs, rcHits, (n) => isRecomputedDomain(docs, n.domain)), left, (id) => exclude(id) || !isRecomputedRef(docs, id));
  return { asks: [...durable.asks, ...rc.asks], warnings: [...durable.warnings, ...rc.warnings].slice(0, limit) };
}

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
      // the round stops at the cap too: it resolved every hit's next id first, so ~300 hits cost the Stop ask its
      // timeout (137 / 738 / 2,261ms at 1 / 30 / 100 hits, audit 2026-10-08)
      if (asks.length >= limit && !(canWarn && warnings.length < limit)) break;
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
// so the ask lands with that agent, once, for the files THAT agent changed (its start snapshot against the tree now).
// WHEN it lands decides whether it counts: a seat reports through its SubagentHandback tool call, and the report is
// with the caller the moment that call returns. Asked at SubagentStop, all 48 asks of two weeks came after the hand-back
// and 41 of them were the transcript's last row - nothing acted on them (deep hooks review 2026-10-16). So the ask is a
// PreToolUse deny of the FIRST hand-back that owes one (the seat stays in its turn, answers, and sends the report again
// with the docs line), and SubagentStop asks only a seat that stopped without a hand-back. PreToolUse fires on that tool:
// 35 hook runs recorded in seat transcripts. Cursor has no such tool, so its seats keep the SubagentStop route.
const HANDBACK_TOOL = 'SubagentHandback';

// The row an answered ask writes. It states what HAPPENED to the sections we asked about - which of them the agent
// rewrote through `docs.js set` - and nothing claims to know what it meant. Logged once and nothing more: no dedupe rests
// on it, because an agent that simply went on and one that rewrote every section are otherwise the same event.
function answerRow(root, input, a, key, reply) {
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
  log(root, input, { event: 'ask-answer', agent: key, via: a.via || 'stop', sections: asked, warned: a.warned || [], rewrote, outcome, saidDocsOk: saidDocsOk(reply) });
}

function handback(input, root, docs) {
  if (docsOff('ask') || !input.agent_id) return;
  const key = agentKey(input);
  const a = loadAgent(input.session_id, key);
  const report = (input.tool_input || {}).message;
  // the hand-back sent after our ask: it passes, and says what the ask came to
  if (a.blocked) { if (!a.answered) answerRow(root, input, a, key, report); return; }
  const reason = seatAsk(input, root, docs, a, key, HANDBACK_LAST);
  if (!reason) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

function subagentStop(input, root, docs) {
  if (docsOff('ask')) return;
  const key = agentKey(input);
  const a = loadAgent(input.session_id, key);
  // The stop our own block caused, or a seat asked at its hand-back that stopped without sending it again.
  if (input.stop_hook_active || a.blocked) {
    if (a.blocked && !a.answered) answerRow(root, input, a, key, input.last_assistant_message);
    return;
  }
  const reason = seatAsk(input, root, docs, a, key, SEAT_REPORT_LAST);
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// The ask itself, shared by both routes: null when this agent owes none, else the reason - and the agent's state then
// records it (blocked, the asked ids, the instant), so neither route asks it twice.
function seatAsk(input, root, docs, a, key, closing) {
  // One block per agent, whatever it answered, and never one for an agent whose start was never seen: with no
  // snapshot there is nothing that says what this agent changed, and a guess would ask the wrong seat.
  if (a.blocked || !a.snapshot || typeof docs.askRef !== 'function') return null;
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
    return null;
  }
  if (noWatch(docs)) return null;
  let changed;
  let hits = [];
  try {
    changed = docs.changedSince(a.snapshot);
    if (!changed.files.length && !changed.dirs.length) return null;
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
      return null;
    }
    hits = docs.watchHits(mineFiles, mineDirs);
  } catch { return null; }
  if (!hits.length) return null;
  // Dedupe on the pair (agent, section), never the section alone: two agents in one run often touch the same
  // section, and the second is the one most likely to notice the first's rewrite only covered half the change.
  // A seat never answers for a recomputed section: its own loop recomputes it, and the close asks it (stop, rcHits).
  const durableHits = hits.filter((h) => !isRecomputedDomain(docs, h.domain));
  if (!durableHits.length) return null;
  const { asks, warnings } = sectionRefs(docs, namedFirst(docs, durableHits, (n) => !isRecomputedDomain(docs, n.domain)), ASK_SECTIONS, (id) => a.asked.includes(id) || isRecomputedRef(docs, id));
  if (!asks.length && !warnings.length) return null;
  const files = [...new Set(hits.flatMap((h) => h.files))];
  const reason = finishAsk(docs, files, asks, warnings, closing);
  a.blocked = true;
  a.via = input.hook_event_name === 'PreToolUse' ? 'handback' : 'stop';
  // Only ASK ids: a warning can never appear in setsSince (the write refusal means `docs.js set` never
  // records one), so folding its id in here would only ever pull the outcome below toward 'partial' or
  // 'unchanged' for a section nothing was ever asking to be rewritten. Warning ids are tracked separately,
  // in a.warned, purely so the ask-answer row above can name them - never read back into an outcome.
  a.asked = [...a.asked, ...asks.map((r) => r.id)];
  a.warned = [...(a.warned || []), ...warnings.map((r) => r.id)];
  // The instant the ask was made, so a rewrite that landed before it is never counted as an answer to it.
  a.askedAt = new Date().toISOString();
  saveState(input.session_id, a, key);
  log(root, input, { event: 'ask-update', agent: key, agentType: input.agent_type || '', via: a.via, sections: asks.map((r) => r.id), warnings: warnings.map((r) => r.id), files: files.slice(0, 5), kinds: [...new Set(hits.map((h) => h.kind))] });
  blockRow(root, input, reason);
  return reason;
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

// The paths a shell command WRITES, not every path it mentions: shell-writes.js's own reading (redirects, tee, in-place
// sed/perl, cp/mv, rm/mkdir/touch, an interpreter's script), so this hook and the guards never disagree on what a write is,
// plus the writers only a source project cares about (a migration, a scaffold, a patch, dd). `grep -n X src/... 2>/dev/null`
// writes nothing, and neither does `dotnet test tests/Api > run.log`. A write whose target cannot be named counts as a
// write under the first source root.
const UNKNOWN_SOURCE_WRITE = '<unknown source write>';
function projectWrites(command) {
  const out = [];
  const flagged = (rest, ...names) => { const o = rest.findIndex((w) => names.includes(w)); return o >= 0 && rest[o + 1] ? rest[o + 1] : UNKNOWN_SOURCE_WRITE; };
  for (const g of shellReader.gitCalls(command)) {
    if (g.sub === 'apply') out.push(UNKNOWN_SOURCE_WRITE);
    else if (g.sub === 'restore' || (g.sub === 'checkout' && g.argv.includes('--'))) {
      const at = g.argv.indexOf('--');
      out.push(...(at >= 0 ? g.argv.slice(at + 1) : g.argv).filter((w) => !w.startsWith('-')));
    }
  }
  for (const w of shellReader.commandWords(command)) {
    if (w.name === 'dotnet' && w.argv[0] === 'new') out.push(flagged(w.argv, '-o', '--output'));
    else if (w.name === 'dotnet' && w.argv[0] === 'ef' && w.argv[1] === 'migrations' && /^(add|remove)$/.test(w.argv[2] || '')) out.push(flagged(w.argv, '-p', '--project'));
    else if (w.name === 'dd') out.push(...w.argv.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)));
  }
  return out;
}
// An interpreter write through a computed path is UNKNOWN_INTERPRETER_WRITE - a source write only under a root the command
// names (unknownRoots), where a patch or a migration with no project (UNKNOWN_SOURCE_WRITE) always is one; a `$NAME`
// target is expanded from the same command's assignment, and one still holding a `$` names no file - it filled
// COMPACT-STATE's 'files written' with `$S/demo.pw` and `$G` (audit 2026-10-10, sessions 68da4b6b, 758ce661).
const UNKNOWN_INTERPRETER_WRITE = '<unknown interpreter write>';
const isUnknown = (t) => t === UNKNOWN_SOURCE_WRITE || t === UNKNOWN_INTERPRETER_WRITE;
function writeTargets(command) {
  if (!shellReader) return [];
  const scan = shellReader.scanShell(String(command), {});
  const out = scan.targets.map((t) => (t.unknown ? UNKNOWN_INTERPRETER_WRITE : scan.expandVars(String(t.raw || ''))))
    .filter((t) => t && !t.startsWith('/dev/null') && (isUnknown(t) || !t.includes('$')));
  return [...new Set([...out, ...projectWrites(command)])];
}
// The source roots a write the shell route could not name may land in: each root the command itself names as a path
// segment. A `node -e` writing to a computed `$TMP/final.json`, naming no root, writes no source (audit 2026-10-20 C25,
// 4f2bfdee: held twice as 'Before changing src/*', five messages to clear). A root that is the project itself ('.', '')
// is named by every command, as before.
function unknownRoots(command, roots) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return roots.filter((r) => {
    const x = String(r).replace(/^\.\//, '').replace(/\/+$/, '');
    return !x || x === '.' || new RegExp(`(?:^|[^\\w.-])${esc(x)}(?:/|[^\\w.-]|$)`).test(String(command));
  });
}
const relative = (root, paths) => [...new Set(paths.map((p) => toPosix(path.relative(root, path.resolve(root, p.replace(/^['"]|['"]$/g, ''))))).filter((p) => p && !p.startsWith('..')))];

// Only reading a section's text is a consult: `where`, `toc` and listings point at sections without reading them.
// `docRoots` is a LIST now, one entry per domain (each domain's own root, project-relative) - a project can be
// documented in preferences/ or awareness/ alone, and a read under any one of them is a real consult, not
// just one under architecture/. Deliberately NOT the whole docs root: DOCS_ROOT also holds work/, quality/
// and .branches/ (the hooks' ledgers before 2.8.0), none of which is a section covering a file, and crediting
// any of them would turn the gate off by accident for a session that merely happens to touch one. A branch
// override under .branches/ is not credited either, on the same reasoning - it mixes real override text
// (<id>.md) with pure internal state (BASE.json, .base/, .conflict markers), and the intended way to read an
// override is `docs.js show <ref>`, which the branch above already credits wherever the text physically lives.
// Stricter since the audit of 2026-10-08, which unlocked the hold with a Glob of `references/`, an `ls`, a Read of
// `watch.json`, `echo "docs.js show x"` and a show of a ref that does not exist - none of them read a section:
// a `show` counts only where the shell RUNS it (a quoted string holding spaces is text) and only for a ref the engine
// resolves; a file read counts only for a doc file (`.md`), by Read or Grep, or by a shell command that READS (a reading
// verb, no write) - never a listing.
const SHELL_READ_VERB = /(?:^|[\s;&|(])(?:cat|head|tail|sed|awk|grep|rg|less|more|bat|nl|type|get-content|gc|select-string)\b/i;
function consultedBy(input, paths, docRoots, docs, plansRels = []) {
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const command = typeof t.command === 'string' ? t.command : '';
  let run = command;
  try {
    if (shellReader && typeof shellReader.quotedSpans === 'function') {
      const chars = command.split('');
      for (const [a, b] of shellReader.quotedSpans(command)) if (/\s/.test(command.slice(a, b))) for (let i = a; i < b && i < chars.length; i++) chars[i] = ' ';
      run = chars.join('');
    }
  } catch { run = command; }
  if (/docs\.js["']?[ \t]+show[ \t]/.test(run)) {
    const resolves = (r) => {
      if (!docs || typeof docs.findFile !== 'function') return true;
      try { if (!docs.findFile(r.split('#')[0])) return false; } catch { return false; }
      try { return !r.includes('#') || typeof docs.askRef !== 'function' || !!docs.askRef(r); } catch { return true; }
    };
    return (run.match(/docs\.js["']?[ \t]+show[ \t]+[\w#.\/-]+(?:[ \t]+[\w#.\/-]+)*/g) || [])
      .flatMap((r) => r.split(/[ \t]+/).slice(2))
      // a path under the docs root resolves like its ref (docs.js stripDocsRoot, audit 2026-10-20 C27)
      .filter((r) => !r.startsWith('-') && /^[\w./][\w.\/-]*(#[\w-]+)?$/.test(r))
      .filter(resolves)
      .filter((r) => !isRecomputedRef(docs, r));
  }
  if (/docs\.js[ \t]+(toc|where|files|status|lint|watch|stale)\b/.test(command)) return [];
  const underDocs = (p) => docRoots.some((d) => p === d || p.startsWith(`${d}/`));
  const reads = /^Read$/.test(name) || (isShellTool(name) && !writeTargets(command).length && SHELL_READ_VERB.test(run));
  // a Grep reads the text of what it searches, a doc folder included; a Read or a shell read names its file
  const hits = paths.filter((p) => underDocs(p) && (name === 'Grep' ? !/\.(?:json|jsonl)$/i.test(p) : /\.md$/i.test(p)));
  if (hits.length && (name === 'Grep' || reads)) return hits;
  // A resume reads its plan, and the plan's `Oriented:` line names the sections the design read: those sections count as
  // read, so the first edit of a /clear resume is not held for docs the plan already carries (audit 2026-10-20 C25,
  // 6dba16e2 / b5f384d2 / 1b432dd2: 3 of 3 resumes of one story opened on that hold). A plan naming none earns nothing.
  if (plansRels.length && reads) {
    const plans = paths.filter((p) => /\.md$/i.test(p) && plansRels.some((d) => p.startsWith(`${d}/`) && !p.slice(d.length + 1).includes('/')));
    return plans.flatMap((p) => orientedRefs(path.resolve(process.env.CLAUDE_PROJECT_DIR || '.', p), docs));
  }
  return [];
}
// The section refs a plan's `Oriented:` lines name that the engine resolves - `project-structure#inventory, PROJECT-CAPABILITIES#build,
// PROJECT-CODE-PREFERENCES.md lines 30-99` gives the first two. The first 64KB of the plan is read, where its header sits.
const ORIENTED_LINE = /^[\s>*_-]*Oriented\**\s*:(.*)$/gim;
function orientedRefs(abs, docs) {
  if (!docs || typeof docs.askRef !== 'function') return [];
  let text = '';
  try {
    const fd = fs.openSync(abs, 'r');
    try { const buf = Buffer.alloc(64 * 1024); text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)); } finally { fs.closeSync(fd); }
  } catch { return []; }
  const out = new Set();
  for (const m of text.matchAll(ORIENTED_LINE)) {
    for (const r of m[1].match(/[A-Za-z][\w.\/-]*#[\w-]+/g) || []) {
      try { if (docs.askRef(r) && !isRecomputedRef(docs, r)) out.add(r); } catch { /* an unresolved name earns nothing */ }
    }
  }
  return [...out];
}

// No domain declares a watch entry or a new-module rule, so no change can hit one: watchHits() would return nothing.
function noWatch(docs) {
  try { const w = docs.loadWatch(); return !w.watch.length && !w.newModule.length; } catch { return false; }
}

// A skip with nobody at the terminal is one `mode: unattended` row in the hook-blocks ledger, as every other asking hook
// writes it - it went to docs-log.jsonl alone, which the block-rate tally never reads (audit 2026-10-08).
// One row per kind per session (audit 2026-10-20 H11: a row on every Stop and every held write - 145 rows, 61 in one
// session - said nothing the first did not): an exclusive marker in the hook temp dir claims the kind; a marker that
// already stands skips the row, and a dir that takes no marker writes it, the old behaviour.
function unattendedRow(root, input, kind) {
  try {
    let prelude = null;
    try { prelude = require('./hook-prelude.js'); } catch { /* no prelude */ }
    const dir = (prelude && typeof prelude.envOf === 'function' && prelude.envOf(process.env, 'HOOK_LOG_DIR')) || os.tmpdir();
    const part = (v) => String(v || '').replace(/[^\w.-]/g, '_').slice(-80);
    try {
      fs.writeFileSync(path.join(dir, `alfred-docs-unattended-${part(input.session_id || 'nosession')}-${part(kind)}`), new Date().toISOString(), { flag: 'wx' });
      if (prelude && typeof prelude.sweepStale === 'function') prelude.sweepStale(dir, 'alfred-docs-unattended-');
    } catch (e) { if (e && e.code === 'EEXIST') return; }
  } catch {}
  try {
    const dir = layout ? layout.statsPath(root, ['hook-blocks']) : path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'docs-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', mode: 'unattended', kind, reason: `${kind} skipped - nobody at the terminal` })}\n`);
  } catch {}
}
function blockRow(root, input, reason) {
  try {
    const dir = layout ? layout.statsPath(root, ['hook-blocks']) : path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'docs-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', reason: String(reason).split('\n')[0].slice(0, 200) })}\n`);
  } catch {}
}

// A plan stamped `Completed:` is a record (task-solve's CLOSE): new scope after it opens a NEW plan file, or runs under a
// stated `ungated: <why>`. Four form fixes were written into a stamped plan and counted as that cycle's files (audit
// 2026-10-10, session 84eedb4b). A write to `<docs-path>/work/plans/<name>.md` carrying a Completed stamp is denied unless
// every line it adds or removes is a stamp line (Gated / Approved / Conformance / Completed / Status / Deviations /
// Result) - an Edit by its strings, a Write against the file on disk, a shell write always (its change cannot be read).
// The close that WRITES the stamp is not yet closed (the 2026-10-17 usage audit: its own edits right after `Completed:`
// landed - the memories line, a tick, the leftovers - were denied): a write adding the stamp leaves a marker naming the
// transcript's size, and the same actor's later writes to that plan pass until the close stop is put to the user - an
// AskUserQuestion answered, or a prompt typed, after the marker.
const STAMP_LINE = /^\s*(?:[>*-]\s*)*\**\s*(?:Gated|Approved|Conformance|Completed|Status|Deviations|Result)\b/i;
const COMPLETED_STAMP = /^\s*(?:[>*-]\s*)*\**\s*Completed\**\s*:/im;
function closeMarker(input, abs) {
  const id = `${input.session_id || 'nosession'}-${input.agent_id || 'main'}`.replace(/[^\w.-]/g, '_');
  const h = require('crypto').createHash('sha1').update(abs).digest('hex').slice(0, 12);
  return path.join(require('os').tmpdir(), `alfred-close-${id}-${h}`);
}
function markClose(input, abs) {
  try {
    const size = input.transcript_path ? fs.statSync(input.transcript_path).size : 0;
    fs.writeFileSync(closeMarker(input, abs), String(size));
  } catch { /* no marker: the stamp guard judges as before */ }
}
function closeStillOpen(input, abs) {
  let at;
  try { at = parseInt(fs.readFileSync(closeMarker(input, abs), 'utf8'), 10); } catch { return false; }
  if (!Number.isFinite(at) || typeof input.transcript_path !== 'string' || !input.transcript_path) return false;
  let tail;
  try {
    const fd = fs.openSync(input.transcript_path, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < at || size - at > 8 * 1024 * 1024) return false;
      const buf = Buffer.alloc(size - at);
      fs.readSync(fd, buf, 0, buf.length, at);
      tail = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return false; }
  const asks = new Set();
  for (const line of tail.split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const c = o && o.message && o.message.content;
    if (o.type === 'assistant' && Array.isArray(c)) for (const b of c) { if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion') asks.add(b.id); }
    if (o.type !== 'user' || o.isMeta) continue;
    if (typeof c === 'string' ? !/^\s*(?:Stop hook feedback:|<task-notification>)/.test(c) : Array.isArray(c) && c.some((b) => b && b.type === 'text' && !/^\s*(?:Stop hook feedback:|<system-reminder>)/.test(b.text || ''))) return false;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result' && asks.has(b.tool_use_id))) return false;
  }
  return true;
}
// Ruling S3 (the user's, 2026-10-20): an AskUserQuestion closed by Claude Code's idle timeout is no answer. The answer
// hook writes this session's timeout marker on such a close and removes it on the next answered ask or typed prompt;
// while it stands, writing an APPROVED / AUTO line into the APPROVAL stamp (`<data root>/state/approvals/`, or the
// pre-2.8.0 `<docs-path>/flow/` a 2.7.0 skill copy names) - a file tool or a shell write that
// carries the word - is denied, so no stamp records an approval nobody gave (the dispatch guard holds the gated
// dispatch too). A seat's call, a delete of the stamp, and any other flow file pass.
function stampAfterTimeoutWrite(input, root) {
  if (input.agent_id) return false;
  let marker = '';
  try { const pre = require('./hook-prelude.js'); if (typeof pre.askTimeoutMarker === 'function') marker = pre.askTimeoutMarker(input.session_id); } catch { return false; }
  if (!marker || !fs.existsSync(marker)) return false;
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const stamps = [layout && layout.statePath(root, 'approvals', 'APPROVAL'), path.resolve(root, docsRootEnv(), 'flow', 'APPROVAL')]
    .filter(Boolean).map((f) => path.resolve(real(path.dirname(f)), path.basename(f)));
  // a plan's own stamp, <data root>/state/approvals/<plan id>/APPROVAL (per-plan approvals, 2026-10-20) - its folder may
  // not exist yet, so it is judged by its parent's real path
  const approvalsDir = layout ? real(layout.statePath(root, 'approvals', '')) : null;
  const planStamp = (at) => Boolean(approvalsDir) && path.basename(at) === 'APPROVAL' && Boolean(layout.PLAN_ID)
    && layout.PLAN_ID.test(path.basename(path.dirname(at))) && real(path.dirname(path.dirname(at))) === approvalsDir;
  let stamp = stamps[0];
  const isStamp = (abs) => { const at = path.resolve(real(path.dirname(abs)), path.basename(abs)); if (!stamps.includes(at) && !planStamp(at)) return false; stamp = at; return true; };
  const STAMP_WORD = /^\s*(?:APPROVED|AUTO)\b/m;
  let hit = false;
  if (/^(?:Edit|Write|MultiEdit)$/.test(name) && typeof t.file_path === 'string' && isStamp(path.resolve(root, t.file_path))) {
    const added = name === 'Write' ? String(t.content || '') : (name === 'Edit' ? [t] : Array.isArray(t.edits) ? t.edits : []).map((e) => String((e && e.new_string) || '')).join('\n');
    hit = STAMP_WORD.test(added);
  } else if (isShellTool(name) && typeof t.command === 'string' && /\b(?:APPROVED|AUTO)\b/.test(t.command)) {
    const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
    hit = writeTargets(t.command).some((w) => !isUnknown(w) && isStamp(path.resolve(base, w.replace(/^['"]|['"]$/g, ''))));
  }
  if (!hit) return false;
  const rel = toPosix(path.relative(root, stamp));
  const reason = `Blocked: the question timed out - re-ask. ${rel} would record an approval, but the last AskUserQuestion\n`
    + "was closed by Claude Code's idle timeout ('No response after ...'), so nobody answered it. Re-ask through ONE\n"
    + 'AskUserQuestion when the user is back and write the stamp from their answer.';
  log(root, input, { event: 'stamp-after-timeout', target: rel });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  return true;
}
function stampedPlanWrite(input, root) {
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  // work/plans/ since 2.8.0, the legacy plans/ until an update moves it (layout.js planDirs)
  const plansDirs = planDirsOf(root).map(real);
  const isPlan = (abs) => /\.md$/i.test(abs) && plansDirs.includes(real(path.dirname(abs)));
  const textOf = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
  const lineCounts = (str) => { const m = new Map(); for (const l of String(str || '').split(/\r?\n/)) m.set(l, (m.get(l) || 0) + 1); return m; };
  const onlyStamps = (before, after) => {
    const a = lineCounts(before);
    const b = lineCounts(after);
    const moved = (x, y) => [...x].every(([l, n]) => (y.get(l) || 0) >= n || !l.trim() || STAMP_LINE.test(l));
    return moved(a, b) && moved(b, a);
  };
  let hit = null;
  if (/^(?:Edit|Write|MultiEdit)$/.test(name) && typeof t.file_path === 'string' && t.file_path) {
    const abs = path.resolve(root, t.file_path);
    const text = isPlan(abs) ? textOf(abs) : null;
    if (text != null && COMPLETED_STAMP.test(text)) {
      const edits = name === 'Edit' ? [t] : name === 'MultiEdit' ? (Array.isArray(t.edits) ? t.edits : []) : null;
      const ok = edits ? edits.every((e) => e && onlyStamps(e.old_string, e.new_string)) : onlyStamps(text, t.content);
      if (!ok && !closeStillOpen(input, abs)) hit = abs;
    } else if (text != null) {
      const edits = name === 'Edit' ? [t] : name === 'MultiEdit' ? (Array.isArray(t.edits) ? t.edits : []) : null;
      const adds = edits ? edits.some((e) => e && COMPLETED_STAMP.test(String(e.new_string || '')) && !COMPLETED_STAMP.test(String(e.old_string || ''))) : COMPLETED_STAMP.test(String(t.content || ''));
      if (adds) markClose(input, abs);
    }
  } else if (isShellTool(name) && typeof t.command === 'string') {
    const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
    for (const w of writeTargets(t.command)) {
      if (isUnknown(w)) continue;
      const abs = path.resolve(base, w.replace(/^['"]|['"]$/g, ''));
      const text = isPlan(abs) ? textOf(abs) : null;
      if (text != null && COMPLETED_STAMP.test(text) && !closeStillOpen(input, abs)) { hit = abs; break; }
    }
  }
  if (!hit) return false;
  const rel = toPosix(path.relative(root, hit));
  const reason = `Blocked: ${rel} is stamped Completed: - a stamped plan is the record of a closed cycle, never appended to.\n`
    + 'New scope after Completed: is a NEW cycle in a NEW plan file (task-solve from step 1), or work stated to run outside\n'
    + 'the cycle in one `ungated: <why>` line. Only a stamp line (Gated, Approved, Conformance, Completed, Status, Deviations)\n'
    + 'may change in this file, through the Edit tool.';
  log(root, input, { event: 'stamped-plan', target: rel });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  return true;
}

// capture-architecture's step 5 writes only once verification is FINISHED, and prose did not hold it: the run announced
// 'Verification is done', made its first Edit, then dispatched a sixth analyzer and kept editing while it ran (audit
// 2026-10-20 C43, add5a91e: 114 reference Edits interleaved with probes, the context compacted mid-write). So a write
// under `<docs-path>/architecture/` by the main session - a file tool, a shell write, a `docs.js set` of an architecture
// ref - is denied while a capture analyzer seat this session dispatched has not handed back. Once per dispatch: the same
// write sent again while that seat is still out passes as a logged `seat-bypass`. A seat's own call, an unreadable
// transcript and the gate part's off switch (`docs-session:gate`) release it. Placed before the domain gate, since a first capture writes
// architecture/ before any domain exists.
const ANALYZER_SEAT = /^(?:alfred-code:)?(?:architecture|code-quality|code-style|related-project|test-coverage)-analyzer$/;
const SEAT_WINDOW = 8 * 1024 * 1024;
const SEAT_HELD_CAP = 200;
function architectureWrites(input, root, docs) {
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
  const arch = path.resolve(root, docsRootEnv(), 'architecture');
  const archs = [...new Set([arch, real(arch) || arch])];
  const inside = (abs) => archs.some((a) => { const rel = path.relative(a, abs); return !rel.startsWith('..') && !path.isAbsolute(rel); });
  // a new file has no real path yet: its folder's (macOS /tmp is /private/tmp) decides
  const under = (abs) => inside(abs) || inside(real(abs) || path.join(real(path.dirname(abs)) || path.dirname(abs), path.basename(abs)));
  const out = [];
  if (/^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) {
    for (const p of [t.file_path, t.notebook_path]) if (typeof p === 'string' && p && under(path.resolve(root, p))) out.push(p);
  } else if (isShellTool(name) && typeof t.command === 'string') {
    const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
    for (const w of writeTargets(t.command)) if (!isUnknown(w) && under(path.resolve(base, w.replace(/^['"]|['"]$/g, '')))) out.push(w);
    for (const m of t.command.matchAll(/docs\.js["']?[ \t]+set[ \t]+['"]?([\w#.\/-]+)/g)) {
      let file = null;
      try { file = docs && typeof docs.findFile === 'function' ? docs.findFile(m[1].split('#')[0]) : null; } catch { /* an unresolved ref */ }
      if (/^architecture\//.test(m[1]) || (file && under(file))) out.push(m[1]);
    }
  }
  return out;
}
// The capture analyzers this session dispatched that have not handed back, read from the transcript where the last read
// stopped (`scan.at`), at most its newest 8MB - a dispatch before that window is unknown and holds nothing. An Agent call
// ends with its tool_result unless the result says it went to the background; a background seat ends with a DELIVERED
// task notification carrying a status, or its `[Subagent hand-back]` message (the stop contract's reading: a queue
// `enqueue` row is not delivered yet), or a TaskStop naming it. null when the transcript cannot be read.
function seatsOut(transcriptPath, scan) {
  let at = scan && Number.isFinite(scan.at) ? scan.at : 0;
  let out = scan && scan.out && typeof scan.out === 'object' ? { ...scan.out } : {};
  let buf;
  let from;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < at) { at = 0; out = {}; }
      from = Math.max(at, size - SEAT_WINDOW);
      if (from > at) out = {};
      buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const start = from > at ? buf.indexOf(0x0a) + 1 : 0; // a window cut mid-row drops that row
  const end = buf.lastIndexOf(0x0a);
  if (end < start) return { at: from + start, out };
  const settle = (named) => { for (const [id, s] of Object.entries(out)) if (named(id) || (s.agent && named(s.agent))) delete out[id]; };
  const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '');
  for (const line of buf.toString('utf8', start, end + 1).split('\n')) {
    if (!line) continue;
    const dispatch = line.includes('-analyzer') && line.includes('"tool_use"');
    const notice = line.includes('<task-notification>') || line.includes('<agent-message');
    const ids = Object.keys(out);
    const touches = ids.length > 0 && ids.some((id) => line.includes(id) || (out[id].agent && line.includes(out[id].agent)));
    if (!dispatch && !notice && !touches) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || o.isSidechain) continue;
    const content = o.message && o.message.content;
    if (o.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_use') continue;
        const inp = b.input && typeof b.input === 'object' ? b.input : {};
        if (/^(?:Agent|Task)$/.test(b.name) && ANALYZER_SEAT.test(String(inp.subagent_type || ''))) {
          out[b.id] = { type: String(inp.subagent_type).replace(/^alfred-code:/, ''), desc: String(inp.description || '').slice(0, 80) };
        } else if (/^(?:TaskStop|KillShell|KillBash)$/.test(b.name)) {
          const named = JSON.stringify(inp);
          settle((id) => named.includes(id));
        }
      }
      continue;
    }
    if (o.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result' || !out[b.tool_use_id]) continue;
        const r = textOf(b.content);
        const meta = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {};
        if (!b.is_error && (meta.status === 'async_launched' || meta.isAsync === true || /\bAsync agent launched\b/i.test(r))) {
          out[b.tool_use_id].agent = String(meta.agentId || (/\bagentId:\s*([\w-]+)/.exec(r) || [])[1] || '');
        } else delete out[b.tool_use_id]; // its report, or a launch that failed
      }
    }
    if (!notice) continue;
    const att = o.type === 'attachment' && o.attachment && o.attachment.type === 'queued_command' ? o.attachment.prompt : '';
    const note = o.type === 'user' ? textOf(content) : o.type === 'queue-operation' ? (o.operation === 'enqueue' ? '' : o.content) : att;
    if (typeof note !== 'string' || !note) continue;
    for (const n of note.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
      if (!/<status>[^<]+<\/status>/.test(n[1])) continue;
      const named = [/<task-id>([^<]+)<\/task-id>/.exec(n[1]), /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(n[1])].filter(Boolean).map((m) => m[1].trim());
      settle((id) => named.includes(id));
    }
    for (const m of note.matchAll(/<agent-message from="([\w-]+)">\s*\[Subagent hand-back\]/g)) settle((id) => id === m[1]);
  }
  return { at: from + end + 1, out };
}
function seatHold(input, root, docs) {
  if (input.agent_id || docsOff('gate')) return false;
  const writes = architectureWrites(input, root, docs);
  if (!writes.length || typeof input.transcript_path !== 'string' || !input.transcript_path) return false;
  const state = loadState(input.session_id);
  const scan = seatsOut(input.transcript_path, state.seatScan);
  if (!scan) return false;
  state.seatScan = scan;
  const out = Object.entries(scan.out);
  const held = new Set(Array.isArray(state.seatHeld) ? state.seatHeld : []);
  const fresh = out.filter(([id]) => !held.has(id));
  const target = toPosix(String(writes[0]));
  if (!fresh.length) {
    if (out.length) log(root, input, { event: 'seat-bypass', target, seats: out.map(([, s]) => s.type) });
    saveState(input.session_id, state);
    return false;
  }
  state.seatHeld = [...held, ...fresh.map(([id]) => id)].slice(-SEAT_HELD_CAP);
  saveState(input.session_id, state);
  const named = out.map(([, s]) => (s.desc ? `${s.type} ('${s.desc}')` : s.type));
  const reason = [
    `Held: ${target} is an architecture doc, and ${out.length} analyzer seat(s) this session dispatched have not handed back: ${named.join(', ')}.`,
    'The architecture write comes after verification is FINISHED (capture-architecture step 5). Wait for the hand-back - its',
    'notification wakes this session, so no polling - fold its digest in, then write. This hold is made once per dispatch.',
  ].join('\n');
  log(root, input, { event: 'seat-hold', target, seats: out.map(([, s]) => s.type) });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  return true;
}

function preToolUse(input, root, docs, state) {
  const paths = toolPaths(input, root);
  // One root per domain, not one hardcoded architecture/ - a project documented only in preferences/ must still
  // get credit for reading it. domains() is already required to succeed for this hook to have run at all (see
  // main()'s own gate above), so no extra guard is needed here.
  // A recomputed domain is left out: reading the assessment is no orientation, so it earns no credit.
  const docRoots = durableOf(docs).map((d) => toPosix(path.relative(root, docs.domainDir(d))));
  // Only these tools can name a source target, so nothing else pays for the watch list.
  const name = input.tool_name || '';
  const fileWrite = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name) || NAV_EDIT.test(name);
  const isWrite = fileWrite || isShellTool(name);
  let roots = ['src', 'tests'];
  if (isWrite) { try { roots = docs.loadWatch().sourceRoots; } catch {} }
  const command = typeof (input.tool_input || {}).command === 'string' ? input.tool_input.command : '';
  if (isShellTool(name)) {
    recordRun(input, command);
    recordMoved(root, input, stashMoves(command, typeof input.cwd === 'string' && input.cwd ? input.cwd : root, root));
  }
  const shellWrites = isShellTool(name) ? writeTargets(command) : null;
  let wrote = [];
  if (fileWrite) wrote = paths;
  else if (shellWrites) {
    wrote = relative(root, shellWrites.flatMap((x) => (x === UNKNOWN_SOURCE_WRITE ? [`${roots[0]}/*`]
      : x === UNKNOWN_INTERPRETER_WRITE ? unknownRoots(command, roots).map((r) => `${r}/*`) : [x])));
  }
  // A PreToolUse write is INTENT. It is banked at each exit below that lets the call PROCEED and never on the deny,
  // so a write this hook holds is not credited to the seat that tried it. Banked before the source-root filter,
  // because a watch entry may name a path no source root covers and a write this hook never judges is still a write.
  // An unnamed write still marks its actor as one that wrote (seatAsk), whether or not it maps to a source root.
  const attribute = () => {
    const all = shellWrites && shellWrites.some(isUnknown) ? [...wrote, UNKNOWN_SOURCE_WRITE] : wrote;
    if (all.length) recordWrite(root, input, all);
  };
  // The preferences docs earn no credit here (audit 2026-10-21 PF-8): they carry no covers, and reading the personal doc
  // said nothing about the section that governs the target - preferences-session.js hands them over itself.
  let prefsDir = null;
  try { prefsDir = docs.domainDir('preferences'); } catch {}
  const notPrefs = (f) => !prefsDir || !f || path.relative(prefsDir, f).startsWith('..');
  const prefsRef = (c) => {
    if (!prefsDir) return false;
    if (!String(c).includes('#') && /\.md$/i.test(String(c))) return !notPrefs(path.resolve(root, String(c)));
    try { const f = docs.findFile(String(c).split('#')[0]); return !!f && !notPrefs(f); } catch { return false; }
  };
  const gate = gateOf(state, input);
  const consults = consultedBy(input, paths, docRoots, docs, planDirsOf(root).map((d) => toPosix(path.relative(root, d)))).filter((c) => !prefsRef(c));
  if (consults.length) {
    // One shell command can read a doc AND write a file - the shape the orientation block and the gate together
    // teach - so the read must not swallow the write.
    attribute();
    gate.consults.push(...consults);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: consults.slice(0, 5), tool: input.tool_name });
    return;
  }
  if (!isWrite) return;
  const inRoots = (p) => roots.some((x) => p === x || p.startsWith(`${x}/`));
  let targets = wrote.map(unWorktree).filter(inRoots);
  // A run artifact is no source change (audit 2026-10-11 SD09, session 5f9fec85: `rm -f` of a git-ignored `.trx` under
  // a test project's TestResults/ was held and a 3,606-char section pasted beside it). A path git ignores, or one under a
  // TestResults/ folder, leaves the hold's targets; a tracked file is never ignored, so its edit is still held.
  if (targets.length) {
    const ignored = new Set(String(docs.git(['check-ignore', '--stdin'], { input: targets.join('\n'), stdio: ['pipe', 'pipe', 'ignore'] }) || '').split('\n').filter(Boolean));
    targets = targets.filter((p) => !ignored.has(p) && !/(?:^|\/)TestResults\//.test(p));
  }
  if (!targets.length) { attribute(); return; }
  const allow = () => {
    attribute();
    state.edits++;
    saveState(input.session_id, state);
    if (state.edits === 1) log(root, input, { event: 'first-edit', target: targets[0], consulted: gate.consults.length > 0 });
  };
  if (docsOff('gate') || gate.consults.length || gate.candidates) { allow(); return; }
  // The preferences docs are preferences-session.js's to hand over (the user's ruling of 2026-10-21): both holds land in
  // ONE combined denial through file-guards.js, so a section pasted here too would show twice. Their domain is left out
  // of this hold - what it can read, and what it pastes or names.
  // Nothing under the docs root can be read by section, so a hold would only point at an empty list.
  let readable = true;
  try { readable = durableDocFiles(docs).filter(notPrefs).length > 0; } catch {}
  if (!readable) { allow(); return; }
  if (gate.holds >= MAX_HOLDS) { log(root, input, { event: 'bypass', target: targets[0], holds: gate.holds }); allow(); return; }
  // Nobody at the terminal (hook-prelude.js unattended): the hold is still logged as a bypass, never made.
  if (unattended(input)) { log(root, input, { event: 'bypass', target: targets[0], why: 'unattended' }); unattendedRow(root, input, 'docs hold'); allow(); return; }
  gate.holds++;
  saveState(input.session_id, state);
  let hits = [];
  try { hits = docs.where(targets, 3).filter((h) => notPrefs(h.file) && !isRecomputedRef(docs, h.id)); } catch {}
  // Only a section that DECLARES a cover of the target is pasted (audit 2026-10-10 C03 / C23: a word match on a
  // cover-less section was pasted as 'the convention this change follows' for a test helper - ab61627f, f24eb967 - and
  // a module-size inventory for a one-line fix - 8f44a003); word-only hits are named as candidates, and the hold does
  // not repeat. The code style is a preferences doc since 2026-10-21, handed over by preferences-session.js.
  const covering = hits.filter((h) => { try { return h.covers && h.covers.length > 0 && docs.matches(h.covers, targets[0]); } catch { return false; } });
  const first = covering[0];
  const shown = (h) => `${h.id} (${h.chars} chars, \`${READ} show ${h.id}\`)`;
  let reason;
  if (!hits.length) {
    reason = `Docs not read yet in this session. Before changing ${targets[0]}, see what is documented: ${READ} files`;
  } else if (!first) {
    gate.candidates = true;
    saveState(input.session_id, state);
    reason = [
      `Docs not read yet in this session. No section declares ${targets[0]}; these name its words:`,
      ...hits.map((h) => `  ${shown(h)}`),
      '',
      'Read one if it bears on this change; otherwise make the change as it is - this hold does not repeat.',
    ].join('\n');
  } else {
    const alsoCovering = covering.filter((h) => h !== first);
    const words = hits.filter((h) => !covering.includes(h));
    const body = first.text.length > INLINE_CHARS ? `${first.text.slice(0, INLINE_CHARS)}\n... (${first.text.length - INLINE_CHARS} more chars: \`${READ} show ${first.id}\`)` : first.text;
    gate.consults.push(first.id);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: [first.id], tool: 'gate-inline' });
    reason = [
      `Docs not read yet in this session. ${first.id} covers ${targets[0]} - here it is:`,
      '', body, '',
      ...(alsoCovering.length ? [`Also covering it: ${alsoCovering.map(shown).join(', ')}`, ''] : []),
      ...(words.length ? [`Naming its words: ${words.map(shown).join(', ')}`, ''] : []),
      'That is the documented context for this path. Now make the change.',
    ].join('\n');
  }
  log(root, input, { event: 'hold', target: targets[0], offered: hits.map((h) => h.id), via: first ? 'cover' : hits.length ? 'words' : 'none' });
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
  // A recomputed section is written in place on every branch (docs.js set), so under local versioning on a branch it
  // lands at once: an ask of only those says so, and a mixed one words the branch lines for the rest and names them.
  const inPlace = refs.filter((r) => isRecomputedRef(docs, r.id));
  const kept = refs.length - inPlace.length;
  const tail = mode === 'git'
    ? [`         and commit the doc${one ? '' : 's'} with your code, so ${one ? 'it travels' : 'they travel'} with this branch.`]
    : mainline || !kept
      ? [`         and ${one ? 'it lands' : 'they land'} in the shared docs at once. Nothing to commit.`]
      : [
        `         and ${kept === 1 ? 'it is' : 'they are'} stored for branch ${branch} only. ${kept === 1 ? 'It moves' : 'They move'} into the`,
        `         shared docs by ${kept === 1 ? 'itself' : 'themselves'} once this branch is merged. Nothing to commit.`,
        ...(inPlace.length ? [`         ${inPlace.map((r) => r.id).join(', ')} ${inPlace.length === 1 ? 'is' : 'are'} rewritten from the code, so ${inPlace.length === 1 ? 'it lands' : 'they land'} in the shared docs at once.`] : []),
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
    // where the new text comes from (audit 2026-10-11 SD09, session 2ca8e8ee: the model grepped and read docs.js twice to
    // find out, ~1.0M): a file on stdin, as `show` prints the section
    ...refs.map((r) => `           ${READ} set ${r.id} --expect ${r.hash} < <file holding its new text>`),
    `         (the section's new text as \`show\` prints it - from a file as above, or piped in)`,
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
// ...and a seat's reply is what its caller receives: the 'docs ok' line alone replaced a report whose contract ends on
// literal `status:` and `contract_version:` lines (the implementer seats), so the ask says to keep them (audit 2026-10-08).
const SEAT_REPORT_LAST = [
  'This reply is what your caller receives: the docs line first, then your report as your brief asks for it -',
  'its status: and contract_version: lines, where it has them, unchanged.',
];
// ...and at the hand-back the report has not left yet: it goes again, with the docs line, once the ask is answered.
const HANDBACK_LAST = [
  'Your report was NOT delivered. Answer this first, then call SubagentHandback again: the docs line first',
  '(docs ok, or the section you rewrote), then your report unchanged - its status: and contract_version: lines,',
  'where it has them, as they were.',
];
function finishAsk(docs, files, asks, warnings = [], closing = [], dead = []) {
  const named = `${files.slice(0, FILES_NAMED).join(', ')}${files.length > FILES_NAMED ? ` and ${files.length - FILES_NAMED} more` : ''}`;
  const parts = [`Docs check: you changed ${named}`];
  if (warnings.length) parts.push('', ...warnLines(files, warnings));
  if (asks.length) parts.push('', ...askLines(docs, files, asks));
  if (dead.length) parts.push('', ...dead.map((d) => `${d.file} ${d.id} - its Scope: \`${d.glob}\` reaches no file since this session's change - ask the user to run /capture-preferences to re-scope ${d.id}`));
  if (closing.length) parts.push('', ...closing);
  return parts.join('\n');
}

// The IDLE spans of this session: gaps of at least 10 minutes between two consecutive transcript rows, when no model
// call and no tool of this session ran. An unclaimed change whose file was last written well inside one was made
// outside the session - the user's own edit in an IDE during a break (audit 2026-10-11 SD09, session fdce35ae: 'you
// changed Directory.Build.props' for a version bump made in a 4h33m gap). The newest 32MB of the transcript is read; a
// file written within 30s of either edge, or with no transcript, stays the session's.
const IDLE_GAP_MS = 10 * 60 * 1000;
const IDLE_EDGE_MS = 30 * 1000;
function idleSpans(transcriptPath) {
  try {
    const size = fs.statSync(transcriptPath).size;
    const from = Math.max(0, size - 32 * 1024 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - from);
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
    const times = [];
    for (const m of buf.toString('utf8').matchAll(/"timestamp"\s*:\s*"([^"]+)"/g)) { const t = Date.parse(m[1]); if (Number.isFinite(t)) times.push(t); }
    times.sort((a, b) => a - b);
    const spans = [];
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] >= IDLE_GAP_MS) spans.push([times[i - 1] + IDLE_EDGE_MS, times[i] - IDLE_EDGE_MS]);
    return spans;
  } catch { return []; }
}
function changedWhileIdle(root, files, transcriptPath) {
  const spans = transcriptPath ? idleSpans(transcriptPath) : [];
  if (!spans.length) return new Set();
  const out = new Set();
  for (const f of files) {
    let t;
    try { t = fs.statSync(path.join(root, f)).mtimeMs; } catch { continue; }
    if (spans.some(([a, b]) => t > a && t < b)) out.add(f);
  }
  return out;
}

// Work this session launched that is still out at Stop, from the harness's own registry - the Stop payload's
// `background_tasks` (code.claude.com/docs/en/hooks, 'Stop input': empty when nothing is in flight; the stop contract
// reads the same field). Any unsettled entry counts: a watch that resumes the build is the pause this defers for. No
// registry in the payload (an older Claude Code) reads as none, the old behaviour.
const MAX_DEFERS = 3;
const SETTLED_STATUS = /^(?:completed?|done|failed|killed|stopped|cancell?ed|error|finished)$/i;
const liveBackgroundWork = (input) => input.hook_event_name === 'Stop' && Array.isArray(input.background_tasks)
  && input.background_tasks.some((t) => t && typeof t === 'object' && !SETTLED_STATUS.test(String(t.status || '')));

// A code or architecture preference entry whose Scope: reaches no file (D4 of the docs-watch spec): the capture's own
// reader decides (preferences.js deadScopes, beside these hooks where preferences-session.js finds it). The user's words
// are never rewritten - the close names the entry. No copy, a throw or no row adds nothing.
let prefsReader;
function deadScopeRows(root) {
  if (prefsReader === undefined) {
    try { prefsReader = require(path.join(__dirname, '..', 'skills', 'capture-preferences', 'scripts', 'preferences.js')); } catch { prefsReader = null; }
  }
  if (!prefsReader || typeof prefsReader.deadScopes !== 'function' || typeof prefsReader.scopeOf !== 'function') return [];
  try {
    // The vanished file is matched by the reader that found the Scope: dead, so every spelling it reads (a folder, a
    // bare path, a file-name glob, a rooted glob) is judged one way (final review I2).
    return prefsReader.deadScopes(root).map((r) => ({ file: path.basename(String((r.doc && r.doc.file) || '')), id: r.id, glob: r.glob, part: prefsReader.scopeOf(r.glob)[0] }))
      .filter((r) => r.part && typeof r.part.test === 'function')
      .map(({ part, ...r }) => ({ ...r, matches: part.test }));
  } catch { return []; }
}

// A recomputed hit the capture already saw: its domain's watch.json was written after this session started and after
// every file the hit names last changed (a deleted file has no time, so it keeps the hit). A quality loop recomputes the
// assessment at its stop, after its fixes, so those fixes are not asked again; a fix made after the recompute is.
function captureSaw(root, docs, h, startedAt) {
  let w;
  try { w = fs.statSync(path.join(docs.domainDir(h.domain), 'watch.json')).mtimeMs; } catch { return false; }
  if (!(w >= (startedAt + 1) * 1000)) return false;
  return h.files.every((f) => { try { return fs.statSync(path.join(root, f)).mtimeMs <= w; } catch { return false; } });
}

// The same check for work done outside any subagent - and the only cover skills have, since a skill has no end
// event of its own and its work lands here.
function stop(input, root, docs, state) {
  // Once per session (state.asked); a continuation a SIBLING Stop hook caused is judged, since what it rewrote is this
  // session's change too (hook-prelude.js, the Stop chain - audit 2026-10-08 S1).
  if (docsOff('ask') || stopHeld(input) || state.asked || !state.snapshot) return;
  if (typeof docs.askRef !== 'function') return;
  // Nothing watched and no dead Scope: to name, nothing to ask: the tree diff it would pay for (47-261ms, every turn)
  // can only end in no hit (audit 2026-10-08).
  const watched = !noWatch(docs);
  let scopeRows = watched ? null : deadScopeRows(root);
  if (!watched && !scopeRows.length) return;
  let changed;
  let hits = [];
  let rcHits = [];
  let dead = [];
  try {
    changed = docs.changedSince(state.snapshot);
    if (!changed.files.length && !changed.dirs.length) return;
    // What the SESSION answers for: what it wrote ITSELF - a skill's work is main-session work, and its tool events
    // carry no agent id - plus every change no actor claimed at all, which is how a script's output and a write
    // through a tool this hook is not wired on still get asked about. What a SEAT wrote is that seat's to answer
    // for and it was already asked there; repeating it here is the same block twice in a row, which is how a gate
    // earns itself a `docs-session:ask` off switch. Attribution, not a subtraction: the session is asked about its own
    // later change to a section a seat answered for earlier.
    const main = loadAgent(input.session_id, MAIN_ACTOR);
    const mine = new Set(main.wrote || []);
    const entries = tmpEntries();
    const seats = otherActorWrites(input.session_id, MAIN_ACTOR, entries);
    // a change another session on this checkout recorded as its own write is that session's to answer for: logged, not asked
    const others = otherSessionWrites(input.session_id, root, state.snapshot.at, entries);
    const theirs = changed.files.filter((f) => !mine.has(f) && !seats.has(f) && others.has(f));
    if (theirs.length) log(root, input, { event: 'changed-by-other-session', files: theirs.slice(0, 5) });
    // a change this session only moved with git stash (stashMoves) was authored elsewhere: logged, not asked
    const moved = new Set(main.moved || []);
    const stashed = changed.files.filter((f) => !mine.has(f) && !seats.has(f) && !others.has(f) && moved.has(f));
    if (stashed.length) log(root, input, { event: 'changed-by-git-stash', files: stashed.slice(0, 5) });
    // an unclaimed change counts only when this session ran a command that may write (recordRun); in a session that only
    // read and edited through its tools, it is another writer's - logged, not asked
    const unclaimed = (f) => !seats.has(f) && !others.has(f) && !moved.has(f);
    const unrun = main.ran ? [] : changed.files.filter((f) => !mine.has(f) && unclaimed(f));
    if (unrun.length) log(root, input, { event: 'changed-unclaimed', files: unrun.slice(0, 5) });
    const claimed = changed.files.filter((f) => mine.has(f) || (unclaimed(f) && main.ran));
    // an unclaimed change made while the session sat idle is the user's own, outside this session: logged, not asked
    const outside = changedWhileIdle(root, claimed.filter((f) => !mine.has(f)), input.transcript_path);
    if (outside.size) log(root, input, { event: 'changed-outside-session', files: [...outside].slice(0, 5) });
    const files = claimed.filter((f) => !outside.has(f));
    const dirs = changed.dirs.filter((d) => files.some((f) => f.startsWith(`${d}/`)));
    // A seat was never asked a recomputed section, so the close asks it over the seats' files too.
    const seatFiles = changed.files.filter((f) => seats.has(f) && !others.has(f) && !files.includes(f));
    const gone = [...files, ...seatFiles].filter((f) => !fs.existsSync(path.join(root, f)));
    if (gone.length) {
      if (!scopeRows) scopeRows = deadScopeRows(root);
      dead = scopeRows.filter((r) => gone.some((f) => r.matches(f)));
    }
    if (!files.length && !dirs.length && !seatFiles.length && !dead.length) return;
    if (watched) {
      hits = docs.watchHits(files, dirs).filter((h) => !isRecomputedDomain(docs, h.domain));
      if (typeof docs.refRecomputed === 'function') {
        const all = [...files, ...seatFiles];
        rcHits = docs.watchHits(all, changed.dirs.filter((d) => all.some((f) => f.startsWith(`${d}/`))))
          .filter((h) => isRecomputedDomain(docs, h.domain) && !captureSaw(root, docs, h, state.snapshot.at));
      }
    }
  } catch { return; }
  if (!hits.length && !rcHits.length && !dead.length) return;
  const { asks, warnings } = hits.length || rcHits.length ? askPools(docs, hits, ASK_SECTIONS, undefined, rcHits) : { asks: [], warnings: [] };
  if (!asks.length && !warnings.length && !dead.length) return;
  const files = [...new Set([...hits, ...rcHits].flatMap((h) => h.files))];
  for (const f of [...new Set(changed.files)]) if (!files.includes(f) && dead.some((r) => r.matches(f))) files.push(f);
  const deadIds = dead.map((r) => `${r.file} ${r.id}`);
  // Nobody at the terminal (hook-prelude.js unattended): the ask would only turn the final answer into
  // 'docs ok' (8 of 12 print-mode cells, pilot 2). Logged, never made.
  if (unattended(input)) {
    log(root, input, { event: 'ask-skipped', why: 'unattended', sections: asks.map((r) => r.id), deadScopes: deadIds, files: files.slice(0, 5) });
    unattendedRow(root, input, 'docs finish ask');
    return;
  }
  // A turn that ends while work this session launched still runs is a PAUSE, not the close: the ask waits for a later
  // Stop, since it is made once per session and spent here it never reaches the real close (audit 2026-10-20 C25,
  // 0685cd0b: 'coded, but I can't build or test it yet' under a background watch drew 10 messages of doc edits at ~310k
  // for code that had not built). At most MAX_DEFERS times, so a server left running all session cannot silence it.
  if (liveBackgroundWork(input) && (state.deferred || 0) < MAX_DEFERS) {
    state.deferred = (state.deferred || 0) + 1;
    saveState(input.session_id, state);
    log(root, input, { event: 'ask-deferred', why: 'background work running', deferred: state.deferred, sections: asks.map((r) => r.id), deadScopes: deadIds, files: files.slice(0, 5) });
    return;
  }
  state.asked = true;
  saveState(input.session_id, state);
  const reason = finishAsk(docs, files, asks, warnings, SUMMARY_LAST, dead);
  log(root, input, { event: 'ask-update', sections: asks.map((r) => r.id), warnings: warnings.map((r) => r.id), deadScopes: deadIds, files: files.slice(0, 5), kinds: [...new Set([...hits, ...rcHits].map((h) => h.kind))] });
  blockRow(root, input, reason);
  markHeld(input);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

module.exports = { writeTargets, consultedBy, toolPaths, toPosix, sweepOldState, saveState, loadState, sectionRefs, otherSessionWrites, unknownRoots, stashMoves, seatsOut, architectureWrites };
if (require.main === module) {
  try { main(); if (startNote) { const note = startNote; startNote = ''; emit('SessionStart', note); } } catch (error) { process.stderr.write(`docs-session: ${error.message}\n`); }
}
