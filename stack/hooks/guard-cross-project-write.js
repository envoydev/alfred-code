#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Write + Edit + NotebookEdit + Bash): a session belongs to ONE
// project. Work in project A that turns out to need a change in project B - a sibling repo, a
// consumed package, a related service - is HANDED OFF, never applied: the session writes a task
// card for B and stops there. Reading and investigating B is untouched (no Read/Grep/Glob
// matcher), because deciding what B must do requires reading B.
//
// Why a hook and not prose: a cross-repo edit is a discrete event with a decidable test (does
// the write target resolve inside this project's root?), and the cost of getting it wrong is
// the expensive kind - a change landing in a repo whose tests, conventions, review and release
// this session never ran, invisible to the project that owns it.
//
// Reads pass. Writes inside the project root pass. Writes to the session's own scratch (the OS
// temp dir), to the Claude account dirs (~/.claude and the ~/.claude-<space> siblings - settings,
// memory, plugins), and to /dev pass. Everything else is blocked - and the block ENDS IN AN ASK:
// the denial mandates one AskUserQuestion (task card here - recommended; allow that tree for this
// session; drop), because a bare denial left the user out of the decision (the model wrote the
// card or just stopped). The 'allow' answer is honoured through a session receipt, below.
// On Bash the write-shaped verbs are judged where they actually land: a `cd`/`pushd` earlier in
// the same command moves the anchor for every relative path and every bare `git <mutating>` after
// it (`cd ../other && git commit` is the same write as `git -C ../other commit` - reproduced
// passing before this existed), while a `>` or a verb INSIDE a quoted string is prose, not a
// write (a commit message reading 'pipe > /other/f' blocked the commit - reproduced).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable, on a root
// that cannot be resolved, and on a target that cannot be judged (an unexpanded variable, a
// relative path after `cd -` or `cd $DIR`).
// Out of scope (same honesty as the sibling guards): a write hidden from a flat scan -
// `--git-dir=`/`--work-tree=`, `bash -c '...'`, `eval`, `xargs rm`, `find ... -delete`, a
// wrapper script - is NOT caught here; this guard reads the literal command.
const fs = require('fs');
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const os = require('os');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-cross-project-write');
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
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

// The project root is CLAUDE_PROJECT_DIR (the harness sets it for every hook). Without it - a
// manual wiring, a test - the nearest ancestor of the session cwd holding a .git is the root,
// because the cwd itself may be a SUBDIRECTORY the session cd-ed into, and taking that as the
// root called the project's own sibling folder 'outside' (reproduced).
function nearestRepoRoot(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}
const cwd0 = payload.cwd || process.cwd();
const root = process.env.CLAUDE_PROJECT_DIR || nearestRepoRoot(cwd0) || cwd0;
if (!root || !fs.existsSync(root)) process.exit(0); // no resolvable root - nothing to compare against
// Compare REAL paths on both sides or the gate misfires: on macOS /tmp is a symlink to
// /private/tmp and os.tmpdir() reports the /var/folders form of an already-/private path, so a
// raw string comparison calls the project's own file 'outside' and an allowed temp dir 'unknown'
// (both reproduced by this hook's tests before this existed). A target that does not exist yet
// has no realpath, so resolve the deepest ancestor that does and re-attach the remainder.
// Git Bash / MSYS spell a Windows path in POSIX MOUNT form - `/c/Users/...`, or `/cygdrive/c/...`.
// node on win32 does not know that spelling: path.resolve turns `/c/Users/u/AppData/Local/Temp/x`
// into a path on the CURRENT drive (`\c\Users\...`), which is neither the project nor the temp
// allowance, so a session cleaning up its own scratch was blocked (reported from a Windows session;
// the mis-resolve is pinned in this hook's tests through path.win32). Translate the mount form to
// the drive form before ANY resolution. Off Windows that same spelling is a real POSIX path and is
// never touched.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
// The NATIVE realpath returns the on-disk letter case (and a Windows 8.3 short name in full); the JS one keeps
// the case it is given, so `c:\...\proj\x.ts` against a root spelled `C:\...` read as outside (2.1.5 M9). A path
// that does not exist yet has no on-disk case, so on win32 the compare below folds case as well.
const real = (p) => { try { return (fs.realpathSync.native || fs.realpathSync)(p); } catch { return path.resolve(p); } };
const fold = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
// Memoised for the run: allowed() resolves a target, then inside() resolves it again against the root and every
// allowance - about ten climbs of existsSync plus a native realpath per write, and a 245KB chain of cd steps cost 8s
// of CPU on Windows, where each of those calls is slow (2.1.7, the windows-2025 job). Nothing on disk changes while
// the hook judges a command that has not run.
const realishSeen = new Map();
const realExisting = new Map(); // a folder -> its real path, or null when it does not exist
// The climb reads the cache first and touches the disk top-down from the deepest folder it already knows: a folder
// that does not exist has no children, so `cd pkg9 && cp a b9` costs one existsSync, never one per level.
function realish(p) {
  const key = String(p);
  if (realishSeen.has(key)) return realishSeen.get(key);
  const abs = path.resolve(nativePath(p));
  const chain = [abs]; // abs, its parent, ... up to the deepest folder the cache knows EXISTS, or the filesystem root
  const knownReal = (d) => realExisting.has(d) && realExisting.get(d) !== null;
  for (let i = 0; i < 64 && !knownReal(chain[chain.length - 1]); i++) {
    const up = path.dirname(chain[chain.length - 1]);
    if (up === chain[chain.length - 1]) break;
    chain.push(up);
  }
  let out = null;
  let known = -1; // the index in `chain` of the deepest folder found to exist
  for (let i = chain.length - 1; i >= 0; i--) {
    const dir = chain[i];
    if (!realExisting.has(dir)) realExisting.set(dir, fs.existsSync(dir) ? real(dir) : null);
    if (realExisting.get(dir) === null) {
      for (let j = i - 1; j >= 0; j--) realExisting.set(chain[j], null); // below a missing folder nothing exists
      break;
    }
    known = i;
  }
  if (known >= 0) out = path.join(realExisting.get(chain[known]), ...chain.slice(0, known).reverse().map((d) => path.basename(d)));
  if (out === null) out = abs;
  realishSeen.set(key, out);
  return out;
}
const ROOT = real(root);
const HOME = os.homedir() || '';
// `~\\x` is the Windows spelling of the same thing, and ALFRED_CODE_ALLOW_WRITE_OUTSIDE is
// where a user writes one by hand - unexpanded, the allowance stays a literal `~...` string,
// matches no path, and the tree the project genuinely owns is blocked (measured on windows-latest).
const expandTilde = (p) => (p === '~' || p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\')))
  && HOME ? path.join(HOME, p.slice(1)) : p;

// Anything under one of these may be written even though it is outside the project: the
// session's own scratch, the account-level Claude config (memory writes land here - blocking
// them breaks the memory system), the hook log dir, and device files. ALFRED_CODE_ALLOW_WRITE_OUTSIDE
// is the deliberate escape hatch: a list of extra roots (colon-separated, semicolon on Windows; a
// leading ~ expands) for the rare project that really does own a second tree (a generated-output
// dir, a deploy checkout). Each resolves with realish, not real: an allowance for a tree not created yet
// resolves through its existing ancestor exactly as a target does - real() kept a missing path as written, so an
// 8.3 short name or a link never met its target (measured on windows-latest).
const allowRoots = [
  os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/dev',
  envOf(process.env, 'HOOK_LOG_DIR'),
  ...(HOME ? [path.join(HOME, '.claude')] : []),
  ...(envOf(process.env, 'ALLOW_WRITE_OUTSIDE') || '').split(path.delimiter).map((s) => s.trim()),
].filter(Boolean).map(expandTilde).map(realish);

function inside(target, dir) {
  const t = fold(realish(target));
  const d = fold(dir);
  return t === d || t.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}
// An allowance that CONTAINS the project root would swallow the whole gate - every sibling
// repo would sit inside it too. On macOS os.tmpdir() is under /var/folders, so a project
// worked on from a temp dir is exactly that case (it is how this hook's own tests run).
const effectiveAllow = allowRoots.filter((d) => !inside(ROOT, d));
// The user's own allowance for THIS session. A block ends in an ask, and the 'allow' answer has
// to be honourable or the ask offers a route this guard then denies - the failure alfred-git
// records: an ask recommended a sibling-repo commit, the user took it, the guard denied it at the
// first git verb. So the answer is recorded as a receipt this guard reads:
// <docs-path>/flow/CROSS-WRITE-ALLOW, one root per line, '#' comments allowed. Session-scoped
// the way the dispatch guard's APPROVAL stamp is - older than 8h, or written before this session
// began (the transcript's birthtime, where the filesystem reports a real one), reads as absent -
// and a root that contains the project is dropped, the containment rule above.
// ALFRED_CODE_ALLOW_WRITE_OUTSIDE stays the permanent lever for a tree the project owns.
const RECEIPT = path.resolve(ROOT, docsRootEnv(), 'flow', 'CROSS-WRITE-ALLOW');
const MAX_RECEIPT_AGE_MS = 8 * 60 * 60 * 1000;
let receiptStale = false;
let receiptLines = [];
const receiptRoots = (() => {
  try {
    const st = fs.statSync(RECEIPT);
    let sessionStartMs = 0;
    try {
      const t = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = t.birthtimeMs && t.birthtimeMs !== t.ctimeMs ? t.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > MAX_RECEIPT_AGE_MS || (sessionStartMs && st.mtimeMs < sessionStartMs)) {
      receiptStale = true;
      return [];
    }
    receiptLines = fs.readFileSync(RECEIPT, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return receiptLines.map(expandTilde).map(realish).filter((d) => !inside(ROOT, d));
  } catch { return []; } // absent or unreadable - no allowance recorded
})();
// ~/.claude-<space> account dirs are siblings of ~/.claude, matched by prefix. The prefix is
// dropped only when the project itself sits under such a dir (the containment rule above) -
// checking whether the project sat under HOME instead disabled it for every real project, and a
// --space install's memory writes were blocked (reproduced).
const spacePrefix = HOME ? real(HOME) + path.sep + '.claude-' : null;
const spaceOk = spacePrefix && !fold(ROOT).startsWith(fold(spacePrefix));
function allowed(target) {
  const t = realish(target);
  if (inside(t, ROOT)) return true;
  if (effectiveAllow.some((d) => inside(t, d))) return true;
  if (receiptRoots.some((d) => inside(t, d))) return true; // the user's 'allow' for this session
  if (spaceOk && fold(t).startsWith(fold(spacePrefix))) return true;

  return false;
}
// Resolve the way the session sees it: the hook subprocess's cwd is not the Bash tool's
// persisted cwd, so a relative path is anchored to the project root first (same anchor the
// sibling guards use). A relative path that stays inside the root is the normal case and passes.
function resolveTarget(p, base) {
  const n = nativePath(p);
  if (path.isAbsolute(n)) return n;

  return path.resolve(base || ROOT, n);
}

const docsRoot = docsRootEnv();
// Name the other PROJECT, not the file: its repo root when one is findable (the nearest
// ancestor holding a .git), else the first path segment that diverges from this project.
const gitAt = new Map(); // a folder -> whether it holds a .git, for the run
const holdsGit = (dir) => { if (!gitAt.has(dir)) gitAt.set(dir, fs.existsSync(path.join(dir, '.git'))); return gitAt.get(dir); };
function otherProjectName(target) {
  let dir = path.dirname(realish(target));
  for (let i = 0; i < 64; i++) {
    if (holdsGit(dir)) return path.basename(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const parts = realish(target).split(path.sep);
  const rootParts = ROOT.split(path.sep);
  let i = 0;
  while (i < parts.length && i < rootParts.length && parts[i] === rootParts[i]) i++;
  // On win32 the DRIVE LETTER is the root segment - the analogue of the empty string POSIX
  // absolute paths start with - so a target on another drive diverges at index 0 and 'D:' was
  // reported as the other project's name. That also hid the glob bail-out below from a target
  // like `/run*.log`, which resolves onto the cwd's drive: the divergence was the drive, not the
  // glob, so a session cleaning its own scratch was blocked and told to hand off to 'D:'.
  if (parts[i] === '' || /^[A-Za-z]:$/.test(parts[i] || '')) i++;

  return parts[i] || path.basename(path.dirname(realish(target)));
}
// The other project's ROOT - what an 'allow' answer opens: its repo root when one is findable,
// else the first directory that diverges from this project (a file is never the unit).
function otherProjectRoot(target) {
  const t = realish(target);
  let dir = path.dirname(t);
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const parts = t.split(path.sep);
  const rootParts = ROOT.split(path.sep);
  let i = 0;
  while (i < parts.length && i < rootParts.length && parts[i] === rootParts[i]) i++;
  if (parts[i] === '' || /^[A-Za-z]:$/.test(parts[i] || '')) i++;
  return i < parts.length - 1 ? (parts.slice(0, i + 1).join(path.sep) || path.sep) : path.dirname(t);
}
// `shown` is the token the session wrote (or the resolved path after a cd); `abs` is where it lands.
function block(what, shown, abs = shown) {
  const other = otherProjectName(abs);
  const otherRoot = otherProjectRoot(abs);
  const docsRel = docsRoot.replace(/^\//, '');
  const receiptRel = path.join(docsRel, 'flow', 'CROSS-WRITE-ALLOW');
  process.stderr.write(
    `Blocked: ${what} targets '${shown}', which is outside this session's project\n` +
    `(${ROOT}). A session belongs to ONE project - a change another repo needs is HANDED OFF,\n` +
    `not applied here, because a change landing there skips that repo's tests, conventions,\n` +
    `review and release, and its own project never sees it.\n\n` +
    `Do not stop here, and do not decide for the user: end this turn with ONE AskUserQuestion\n` +
    `carrying these options, in this order -\n` +
    `  'Task card in this project (Recommended)' - written at\n` +
    `  ${path.join(docsRel, 'cross-project-tasks', '<other-project>.md')}\n` +
    `  naming the target repo and, per task: what must change and where (file + symbol, from your\n` +
    `  investigation), why this project needs it, the contract both sides must agree on, and how\n` +
    `  the other side can verify it; then finish YOUR side against the current behaviour of\n` +
    `  ${other}, or say plainly what is blocked until that task lands.\n` +
    `  'Allow writes into ${otherRoot} for this session' - on this answer write the receipt\n` +
    `  ${receiptRel} with that root on its own line, then retry the write. This guard honours\n` +
    `  the receipt for this session only: under 8h, and never one written before the session began.\n` +
    `  'Drop the change'.\n\n` +
    (receiptStale
      ? `A receipt at ${receiptRel} exists but is stale - older than 8h, or written before this\n` +
        `session began - so it records another run's decision; rewrite it only on a fresh 'allow'.\n`
      : '') +
    `Reading and investigating ${other} stays open - that is how the card gets specific.\n` +
    `A tree this project genuinely owns belongs in ALFRED_CODE_ALLOW_WRITE_OUTSIDE instead - permanent, no ask.`,
  );
  process.exit(2);
}

// --- fork-liveness PROBE - log-only, denies nothing ------------------------------------------
// A backgrounded turn continues under a NEW session id whose transcript opens as a copy of the
// parent's rows, and the user keeps talking to the OTHER copy. Measured once: the background copy
// ran five test cycles, killed the user's Word five times and edited the same method as the
// foreground for 15 minutes after the foreground's user had said stop - 10.44M cache-read, one
// edit collision. This branch appends a `mode: probe` row to the hook-blocks ledger whenever a
// mutating call runs while another session of the SAME LINEAGE - an ancestor whose id this
// transcript carries, or a sibling whose transcript carries one of those ids - touched its own
// transcript within FORK_LIVE_MS. A copied row carries the id twice - `sessionId` rewritten to the
// fork's own, `session_id` keeping the original (measured: 387 of 1,093 rows in one fork carried a
// parent's id, none by the camel-case key) - so both keys are read. The rows are read for a week
// before any denial is built on them: a backgrounded turn has no user to end a denial in an ask,
// and two deliberate sessions from one fork point would be held. Head-only reads keep it at a few
// ms per call; the head is 1MB because a fork's first rows can be the parent's whole compaction
// summary (measured: the first foreign id sat past 64KB in one fork).
const FORK_LIVE_MS = 60 * 1000;
const FORK_HEAD_BYTES = 1024 * 1024;
const SESSION_ID_RE = /"session_?[iI]d":"([0-9a-f]{8}-[0-9a-f-]{27})"/g;
const PROBE_SHELL = /\b(?:taskkill|pkill|killall|kill)\b|\b(?:dotnet|npm|pnpm|yarn|cargo|mvn|gradle|make|pytest|go)\s+(?:test|build|run)\b|\bgit\s+(?:-c\s+\S+\s+)*(?:checkout|restore|reset|clean|stash|commit|push|merge|rebase|cherry-pick|revert)\b|(?:^|[\s;&|(])(?:rm|mv|cp|mkdir|rmdir|touch|chmod|tee)\b|\bsed\s+(?:-[a-zA-Z]*i|--in-place)/;
function forkProbe(what, shown) {
  try {
    const tp = String(payload.transcript_path || '');
    const own = String(payload.session_id || '');
    if (!tp || !own || !fs.existsSync(tp)) return;
    const dir = path.dirname(tp);
    const head = (p) => {
      const fd = fs.openSync(p, 'r');
      const b = Buffer.alloc(FORK_HEAD_BYTES);
      const n = fs.readSync(fd, b, 0, b.length, 0);
      fs.closeSync(fd);
      return b.toString('utf8', 0, n);
    };
    const idsIn = (text) => { const s = new Set(); for (const m of text.matchAll(SESSION_ID_RE)) s.add(m[1]); return s; };
    const now = Date.now();
    const ancestors = [...idsIn(head(tp))].filter((id) => id !== own);
    if (!ancestors.length) return;   // not a fork - nothing shares this conversation
    const lineage = new Set([own, ...ancestors]);
    const live = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl') || f === path.basename(tp)) continue;
      const p = path.join(dir, f);
      let age;
      try { age = now - fs.statSync(p).mtimeMs; } catch { continue; }
      if (age > FORK_LIVE_MS) continue;
      const id = f.slice(0, -6);
      const related = ancestors.includes(id) ? 'ancestor'
        : [...idsIn(head(p))].some((x) => lineage.has(x)) ? 'sibling' : null;
      if (related) live.push({ id, relation: related, ageMs: Math.round(age) });
    }
    if (!live.length) return;
    const dirOut = path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dirOut, { recursive: true });
    fs.appendFileSync(path.join(dirOut, own + '.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      hook: path.basename(__filename),
      event: payload.hook_event_name || payload.tool_name || '',
      tool: payload.tool_name || '',
      mode: 'probe',
      kind: 'fork-liveness',
      reason: 'probe: ' + what + ' while a live ' + live[0].relation + ' session of this conversation (' + live[0].id + ', ' + live[0].ageMs + 'ms ago) - logged, not denied',
      detail: { what: String(shown).slice(0, 200), live },
    }) + '\n');
  } catch { /* a probe never changes a verdict and never throws */ }
}

const input = payload.tool_input || {};
const tool = payload.tool_name;

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
  const target = input.file_path || input.notebook_path;
  if (!target) process.exit(0);
  const abs = resolveTarget(String(target));
  forkProbe(tool + ' of a file', target);
  if (!allowed(abs)) block(`${tool} of a file`, String(target), abs);
  process.exit(0);
}

// What the command WRITES is parsed in shell-writes.js beside this hook - the heredoc blanking, the
// quoted spans, the write-shaped verbs and the interpreter scripts - shared with the done gate in
// guard-stop-contract.js, which counts the same targets as source edits. It ships with this hook on
// both routes; a copy that runs before it lands judges no shell command rather than crash.
// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is that module's one list.
let shell;
try { shell = require(path.join(__dirname, 'shell-writes.js')); } catch { process.exit(0); }
if (!shell.isShellTool(tool)) process.exit(0);
const rawCommand = String(input.command || '');
// A script FILE a shell runs is read from disk against the project root, and a git alias is expanded to what it runs
// (2.1.6 re-verify 2 R2-M5, R2-m1); an alias that cannot be read is not judged, like an unexpanded variable.
const scan = shell.scanShell(rawCommand, { cwd: ROOT, aliases: true });
const command = scan.command;
if (!command.trim()) process.exit(0);
if (PROBE_SHELL.test(command)) forkProbe('a shell mutation', command.slice(0, 160));

const { isVar } = shell;
// One normaliser per run: shell.anchorAt caches its compiled anchor by this function, so a fresh closure per write recompiled it each time.
const anchorNorm = (t) => nativePath(expandTilde(shell.unquote(t)));
const anchorAt = (index) => shell.anchorAt(scan.cds, index, ROOT, anchorNorm);
// Judge one path token found at `index` in the command: only a token that can land out of tree
// is resolved at all - an explicitly out-of-tree spelling (absolute, ~-rooted, reaching up with
// `..`), or any relative path once a `cd` has moved the anchor. A bare relative path with the
// anchor still at the project root is this project's own file - the case that must never block.
function judge(rawIn, index, what) {
  const raw = scan.expandVars(rawIn);
  if (isVar(raw)) return; // an unexpanded variable - cannot judge, don't guess
  const base = anchorAt(index);
  // `C:\\other\\f.txt` and `\\\\server\\share\\f.txt` are as explicit as a leading `/`, but neither
  // matches the POSIX spellings - so on Windows EVERY shell write to an absolute path fell
  // through this early return unjudged, while the same reach through Write/Edit was blocked
  // (measured on windows-latest: 5 of the guard's own shell cases passed the write through).
  const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\)/;
  const explicit = /^([~/]|\.\.[/\\])/.test(raw) || (process.platform === 'win32' && WIN_ABS.test(raw))
    || raw.includes('/../') || raw === '..';
  if (!explicit && base === ROOT) return;
  const expanded = nativePath(expandTilde(raw));
  if (!path.isAbsolute(expanded) && base === null) return; // relative from an unknown anchor
  const abs = resolveTarget(expanded, base);
  // A target whose own leading segment is a GLOB names no project, and the denial then built its
  // remedy out of the fabricated name - 'finish YOUR side against the current behaviour of `*`'.
  // Nothing can be handed off to a repo that cannot be named, so this passes rather than blocks. Asked only of a write
  // that is not allowed: the name climbs to the filesystem root for a .git, and asked of every write it cost a 245KB
  // chain of cd steps most of its time on Windows (2.1.7).
  if (allowed(abs)) return;
  if (/[*?\[]/.test(otherProjectName(abs))) return;
  // name the token the session wrote unless a cd moved it - then the resolved path says where it lands
  block(what, explicit ? raw : abs, abs);
}
// Only WRITE-shaped commands are considered, and only the paths they actually write to. A path
// that resolves inside the project - the overwhelming majority, relative paths included - never
// reaches the check, so the false-positive surface is limited to commands genuinely writing out
// of tree. The interpreter-script writes come last, as a literal path only.
for (const t of scan.targets) judge(t.raw, t.index, t.what);

// A bare `git <mutating>` after a `cd` out of tree writes THAT checkout - the same event as
// `git -C <dir>`, spelled the way a session actually spells it (reproduced: passed).
for (const index of scan.gitWrites) {
  const base = anchorAt(index);
  if (base && base !== ROOT && !allowed(base)) block('a git write in another checkout', base);
}

// What the reader left UNREAD - a script past the scan budget (hook-prelude.js), a script nested past its depth, a git
// alias it could not read - may write anywhere, so it is asked through the same receipt, never allowed: the verdict
// flipped to allowed on size alone (a 1.1MB script writing outside passed, the same text at 0.99MB was denied - 2.1.6
// re-verify 3 R3-m4). The 'allow' line is the script's own path, or `unread` for a command with no file.
const unread = scan.unread.slice();
if (scan.aliasUnreadAt >= 0) unread.push({ at: scan.aliasUnreadAt, why: 'a git alias it could not read', path: null });
for (const u of unread) {
  if (u.path ? receiptRoots.some((d) => inside(realish(u.path), d)) : receiptLines.includes('unread')) continue;
  const shown = u.path || 'this command';
  const receiptRel = path.join(docsRoot.replace(/^\//, ''), 'flow', 'CROSS-WRITE-ALLOW');
  global.BLOCK_DETAIL = { branch: 'unread', why: u.why };
  process.stderr.write(
    `Blocked: this guard could not read ${shown} (${u.why}), so it cannot say where it writes -\n` +
    `and a script it cannot read is never let through, since the same text a little shorter is judged.\n` +
    `Do not decide for the user: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
    `  'Allow ${shown} for this session (Recommended)' - when it is this project's own and writes only here:\n` +
    `  write ${receiptRel} with the line ${u.path || 'unread'} and retry the SAME command.\n` +
    `  'Drop it' - run a smaller piece the guard can read instead.\n` +
    `The receipt is honoured for this session only, under 8h.`,
  );
  process.exit(2);
}
process.exit(0);
