#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Write + Edit + NotebookEdit + Bash, and a filesystem server's four write tools under any
// registration name - SYS-02, below): a session belongs to ONE
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
// temp dir), to the Claude account dirs (~/.claude and the ~/.claude-<name> siblings - settings,
// memory; never their plugins/ code, THE INSTALLED PLUGINS' OWN CODE below), and to /dev pass.
// Everything else is blocked - and the block ENDS IN AN ASK:
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
// The command is read through shell-writes.js `scanShell`: a wrapper, `bash -c '...'`, `eval`, a heredoc into a shell, a
// script FILE a shell runs and a git alias are read as what they run, and what the reader cannot read is asked, never
// passed (below). A target word is expanded by the module's one expander first (audit 2026-10-30 HK-13): `$HOME`,
// `${HOME}`, `~`, `$USERPROFILE` / `$env:USERPROFILE`, `$PWD` after a followed cd, `$CLAUDE_PROJECT_DIR`, a name the
// command assigned and `$(echo ...)`; and the write verbs include `curl -o`, `wget -O` / `-P`, `tar -C` / `tar cf`,
// `unzip -d`, `dd of=`, `patch`, `git init` / `clone` / `apply --directory` and .NET's `[IO.File]::` writes (HK-14).
// Out of model (audit 2026-10-20 refreshed this list): a path the shell COMPUTES (`$(...)`, a loop
// variable), `xargs rm` fed a listing and `find ... -delete` - the rm guard judges the last two for what they destroy.
const fs = require('fs');
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred - a value the
// installer's checkDataPath refuses reads as .alfred here too, an absolute root (a harness's scratch) kept (E-batch Task 22's minor).
const dataRoot = (env = process.env) => { const raw = String(envOf(env, 'DATA_PATH') || '').trim().replace(/\\/g, '/'); if (/^(?:\/|[A-Za-z]:\/)/.test(raw)) return raw.replace(/\/+$/, '') || '.alfred'; const v = raw.replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, ''); return v && !/\s|[$%`"'*?<>|:]|(?:^|\/)\.{1,2}(?:\/|$)|^\.(?:claude|git)(?:\/|$)/.test(v) ? v : '.alfred'; };
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${dataRoot()}/docs`;
const os = require('os');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// The stand-downs are read here and applied as PLUGIN-ONLY mode (THE INSTALLED PLUGINS' OWN CODE, below): every project
// runs one installed copy of the guards, so a write into it is judged under every stand-down - a repo never set up, the
// opt-out, `minimal`, a Cursor host - as the config guard's switch-off half is (the user's ruling of 2026-11-03, a side
// agent's note: 'Run it in every project'). Only the plugin copy standing down beside a copied twin leaves at once - the
// twin judges the same write. R86: a repo never set up gets no block row.
let off = false;
let unsetRepo = false;
if (require.main === module) {
  let twin = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-cross-project-write');
    twin = off && prelude.yieldToCopiedTwin('guard-cross-project-write');
    unsetRepo = off && prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (twin) process.exit(0);
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
// Stood down by any gate: only a write into the installed plugins' code is judged (above).
const PLUGIN_ONLY = off || cursorOff;

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
    if (code === 2 && !unsetRepo) {
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
let resolveOn = null;
try { ({ resolveOn, nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
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
  // `/` from a C: project is C:\, whatever drive this hook process started on (shell-writes.js resolveOn)
  const abs = resolveOn ? resolveOn(p, ROOT) : path.resolve(nativePath(p));
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
// A relocated account dir (CLAUDE_CONFIG_DIR outside ~/.claude*) holds the same memory writes, and the harness's own
// scratch root (/tmp/claude-<uid>) is listed on its own so a project kept under /tmp, which drops /tmp itself by the
// containment rule below, can still write it (audit 2026-10-08 row 37).
const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const allowRoots = [
  os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/dev',
  ...(UID != null ? [`/tmp/claude-${UID}`, `/private/tmp/claude-${UID}`] : []),
  envOf(process.env, 'HOOK_LOG_DIR'),
  ...(HOME ? [path.join(HOME, '.claude')] : []),
  process.env.CLAUDE_CONFIG_DIR || '',
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
// F14 (the 2026-10-28 workspace run): a project kept under the harness's scratch root drops that whole root by the rule
// above, and with it this session's own scratchpad. Only <scratch root>/<one segment>/<session id> comes back - never
// another session's folder, and never a folder that holds the project itself.
const SESSION_ID = typeof payload.session_id === 'string' && /^[\w-]+$/.test(payload.session_id) ? payload.session_id : null;
const droppedScratch = UID == null ? [] : [`/tmp/claude-${UID}`, `/private/tmp/claude-${UID}`].map(realish)
  .filter((s) => !effectiveAllow.some((d) => fold(d) === fold(s)));
function sessionScratchAllowed(target) {
  if (!SESSION_ID) return false;
  const t = realish(target);
  return droppedScratch.some((s) => {
    if (!inside(t, s)) return false;
    const [segment, sid] = path.relative(s, t).split(path.sep);
    if (!segment || sid === undefined || fold(sid) !== fold(SESSION_ID)) return false;
    return !inside(ROOT, path.join(s, segment, sid));
  });
}
// The user's own allowance for THIS session. A block ends in an ask, and the 'allow' answer has
// to be honourable or the ask offers a route this guard then denies - the failure the git rule
// recorded: an ask recommended a sibling-repo commit, the user took it, the guard denied it at the
// first git verb. So the answer is recorded as a receipt this guard reads:
// <data root>/state/approvals/CROSS-WRITE-ALLOW (the pre-2.8.0 <docs-path>/flow/ one still read), one root per line, '#' comments
// allowed, read below as a security receipt (older than 8h, written before this session began, naming another session, or
// with no allow answer in the transcript, it reads as absent) - and a root that contains the project is dropped, the
// containment rule above.
// ALFRED_CODE_ALLOW_WRITE_OUTSIDE stays the permanent lever for a tree the project owns.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
const RECEIPT = layout ? layout.findState(ROOT, 'approvals', 'CROSS-WRITE-ALLOW') : path.resolve(ROOT, docsRootEnv(), 'flow', 'CROSS-WRITE-ALLOW');
// Where a denial says to write it, relative to the project.
const receiptRelOf = () => (layout ? path.relative(ROOT, layout.statePath(ROOT, 'approvals', 'CROSS-WRITE-ALLOW')) : path.join(docsRootEnv().replace(/^\//, ''), 'flow', 'CROSS-WRITE-ALLOW'));
// A security receipt (audit 2026-10-30 HK-03 / HK-16, hook-prelude.js securityReceipt): this session's own (`session:`),
// under 8h, and only after the user answered this guard's last denial with an 'Allow ... for this session' label, auto-run
// off. No prelude, no reader: shut.
let receipts = null;
try { receipts = require('./hook-prelude.js'); } catch { receipts = null; }
const ALLOW_LABEL = /^allow .+ for this session$/;
const held = receipts && receipts.securityReceipt ? receipts.securityReceipt(RECEIPT, payload, { marker: 'CROSS-WRITE-ALLOW', labels: [ALLOW_LABEL] }) : null;
const receiptLines = held && held.live ? held.lines : [];
const receiptRoots = receiptLines.map(expandTilde).map(realish).filter((d) => !inside(ROOT, d));
// The lines a denial tells the model to write, its session line first (HK-16), and why a receipt there is shut.
const writeLines = (lines) => (receipts && receipts.receiptLinesText ? receipts.receiptLinesText(payload, lines) : lines.map((l) => `  ${l}\n`).join(''));
const shutText = (rel) => (receipts && receipts.receiptShutText ? receipts.receiptShutText(held, rel) : '');
// ~/.claude-<name> account dirs (a second account's CLAUDE_CONFIG_DIR) are siblings of ~/.claude, matched by prefix.
// The prefix is dropped only when the project itself sits under such a dir (the containment rule above) -
// checking whether the project sat under HOME instead disabled it for every real project, and a
// second account's memory writes were blocked (reproduced).
const spacePrefix = HOME ? real(HOME) + path.sep + '.claude-' : null;
const spaceOk = spacePrefix && !fold(ROOT).startsWith(fold(spacePrefix));
// A LINKED WORKTREE of this project's own repository is the project (audit 2026-10-11 SD16, session 42951e5b: two Edits
// in a `git worktree add` sibling the session had just made were blocked as another project, and the ask that followed
// ended in the worktree's removal - 569.1k). Judged from the files git itself writes, no git call: the nearest folder
// holding `.git` above the target, its `.git` FILE's `gitdir:` line, and that gitdir's `commondir` - the common git dir
// must be this ROOT's own.
function commonGitDir(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return fold(real(dotGit));
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitdir = path.resolve(dir, nativePath(m[1]));
    let common = gitdir;
    try { common = path.resolve(gitdir, nativePath(fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim())); } catch { /* a gitdir with no commondir is its own */ }
    return fold(real(common));
  } catch { return null; }
}
function gitTopOf(p) {
  let dir = p;
  for (let i = 0; i < 64; i++) {
    if (holdsGit(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}
let rootCommon;
function sameRepoWorktree(t) {
  if (rootCommon === undefined) { const top = gitTopOf(ROOT); rootCommon = top ? commonGitDir(top) : null; }
  if (!rootCommon) return false;
  const top = gitTopOf(t);
  return !!top && commonGitDir(top) === rootCommon;
}
// R8 (release 3): a linked workspace member's memory folder is read-only from here (D3) - every member's, every match
// past 200 characters - so it is judged before the account-dir allowance that holds it. A folder that is also one of this
// project's own (a shared account-level value) is its own memory, and so is one of its own nested inside a member's.
let memoryDirs;
function memoryOf() {
  if (memoryDirs !== undefined) return memoryDirs;
  memoryDirs = { members: [], own: [] };
  try {
    if (!layout || typeof layout.memoryDirsOf !== 'function' || !layout.workspaceOn({ env: process.env, projectRoot: ROOT })) return memoryDirs;
    const own = layout.memoryDirsOf(ROOT).map(realish);
    const ownKeys = new Set(own.map(fold));
    const members = [];
    for (const m of layout.workspaceChain(layout.chainProjectOf(ROOT)).members) {
      for (const d of layout.memoryDirsOf(m.root)) {
        const dir = realish(d);
        // A folder holding this project is no member memory to it (a deny there would bar its own files).
        if (!ownKeys.has(fold(dir)) && !inside(ROOT, dir)) members.push({ dir, root: m.root });
      }
    }
    memoryDirs = { members, own };
  } catch { /* fail open: no member memory to guard */ }
  return memoryDirs;
}
// Member memory is compared case-folded on darwin too (R071): realish fixes the case only of a folder that exists, and
// APFS opens either spelling, so `-ROOT/memory` reached a member's folder not made yet. Only this deny side folds there -
// an allowance folded on a case-sensitive volume would open a sibling.
const memFold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? String(p).toLowerCase() : String(p));
const memInside = (target, dir) => {
  const t = memFold(realish(target));
  const d = memFold(dir);
  return t === d || t.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
};
// A target holding a glob (R072) is a member's memory when it CAN expand into one: its segments match the folder's in
// order (`*` and `?` within a segment, a `[...]` class) until the folder's run out, the rest anything - and a `**`
// segment (bash globstar) matches any number of folders, none included (final review m5: it counted as one).
const GLOB_CHAR = /[*?[]/;
const segGlob = (seg) => new RegExp(`^${seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^')}$`, 's');
function globReaches(target, dir) {
  const t = memFold(realish(target)).split(path.sep);
  const d = memFold(dir).split(path.sep);
  const seen = new Map();
  const segMatch = (pat, seg) => {
    if (!GLOB_CHAR.test(pat)) return pat === seg;
    try { return segGlob(pat).test(seg); } catch { return true; }
  };
  const reach = (i, j) => {
    if (j === d.length) return true;
    if (i === t.length) return false;
    const key = i * (d.length + 1) + j;
    if (seen.has(key)) return seen.get(key);
    const ok = t[i] === '**' ? reach(i + 1, j) || reach(i, j + 1) : segMatch(t[i], d[j]) && reach(i + 1, j + 1);
    seen.set(key, ok);
    return ok;
  };
  return reach(0, 0);
}
function memberMemory(t) {
  const { members, own } = memoryOf();
  const hit = members.find((m) => memInside(t, m.dir)) || (GLOB_CHAR.test(String(t)) && members.find((m) => globReaches(t, m.dir)));
  return hit && !own.some((o) => memInside(o, hit.dir) && memInside(t, o)) ? hit : null;
}
// The memory folder the user's own settings name outside the account dir (the managed or account settings.json, or a
// settings.local.json git does not track - never a file a clone can carry), whatever the switch says - unless it holds
// the project or the home folder, which would swallow the gate (the containment rule above).
// Claude Code's own test (permissions docs, 'When your local settings file needs trust'): a file git tracks, or one under
// a symlinked `.claude`, is the repository's - and so is one in a repository nested at `.claude` (a submodule). Untracked
// = a plain file in a real `.claude` and git answering 'no match' (exit 1) with no inherited GIT_* variable steering it;
// a tracked or staged file, no git or a timeout trusts nothing. Asked only when that file holds a valid setting the
// managed ones do not override.
function untrackedLocal(file) {
  const dir = path.dirname(file);
  const claude = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!claude || !claude.isDirectory() || fs.existsSync(path.join(dir, '.git'))) return false;
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) return false;
  const env = { GIT_OPTIONAL_LOCKS: '0' };
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  return require('child_process').spawnSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch', '--', ':(icase).claude/settings.local.json'],
    { cwd: path.dirname(dir), stdio: 'ignore', timeout: 3000, env }).status === 1;
}
let trustedMemory;
function ownMemory(t) {
  if (trustedMemory === undefined) {
    trustedMemory = null;
    try {
      const dir = layout && typeof layout.trustedMemoryDir === 'function' ? layout.trustedMemoryDir(ROOT, { untracked: untrackedLocal }) : null;
      if (dir && !inside(ROOT, realish(dir)) && !(HOME && inside(HOME, realish(dir)))) trustedMemory = realish(dir);
    } catch { /* fail closed: no allowance */ }
  }
  return trustedMemory !== null && inside(t, trustedMemory);
}
function memoryBlock(what, shown, hit) {
  global.BLOCK_DETAIL = { branch: 'ancestor-memory' };
  const { own } = memoryOf();
  const mine = own.length === 1 ? `This project's own memory is ${own[0]}.`
    : own.length ? `This project's own memory: ${own.join(', ')}.` : 'This project has no memory folder of its own yet.';
  process.stderr.write(
    `Blocked: ${what} targets '${shown}', the memory of ${hit.root} - a workspace member's memory is read-only from a\n` +
    `project below it. ${mine} A note that member should keep is written from its own session.`,
  );
  process.exit(2);
}
// A PATH THE USER TYPED (usage audit 2026-11-03 U20, the user's ruling: 'an absolute path in your typed message allows
// writes under that folder'): an ABSOLUTE path in a turn the user typed this session opens writes - a typed FOLDER
// under itself, a typed FILE that one file only (review fix pass run B m5: `~/.ssh/config` opened all of `~/.ssh`) - so a
// write the user named in their own words is not asked again (1e53bc45: a 6,338-token body generated twice; e95004e7: a
// 7m44s wait). File or folder is read off the disk: a trailing separator is a folder, an existing path is what it is,
// and a MISSING one is a file when its last name has an extension or is a dotfile (`r.md`, `.zshrc`) and a folder when
// it has neither (`out/gen`) - the narrower reading wins a doubt, so a typed `notes.d` that does not exist yet opens only
// itself, never writes under it. Read from the
// transcript where the write is judged (hook-prelude.js typedTurnTexts / typedPaths), never from a file the model writes
// (HK-03), and only once a write would otherwise be denied. The containment rule holds as for a receipt root: a typed
// folder holding the project opens nothing. A relative path, `~user`, a path in tool output, a harness row or the model's
// text opens nothing; the user accepted that a path inside text they pasted counts. The transcript itself stays shut
// (recordAt runs first).
let typedRoots = null;
function typedAllowed(t, within) {
  if (typedRoots === null) {
    typedRoots = [];
    try {
      const texts = receipts && receipts.typedTurnTexts ? receipts.typedTurnTexts(payload) : [];
      for (const text of texts) {
        for (const p of receipts.typedPaths(text, { home: HOME, native: nativePath })) {
          const at = realish(p.abs);
          let st = null;
          try { st = fs.statSync(at); } catch { st = null; }
          const base = path.basename(at);
          const isFile = !p.slash && (st ? !st.isDirectory() : /^\.[^.]|.\.[A-Za-z0-9]{1,10}$/.test(base));
          if (isFile) { typedRoots.push({ file: at }); continue; }
          if (!inside(ROOT, at)) typedRoots.push({ dir: at });
        }
      }
    } catch { typedRoots = []; }
  }
  if (!typedRoots.length) return false;
  // inside a carved plugin tree a typed folder opens only from the tree down, as an allowance does (the fresh review of
  // 2026-11-03: a typed `~/.claude` opened every plugin's code)
  return typedRoots.some((r) => (r.file ? fold(t) === fold(r.file) : inside(t, r.dir) && (!within || inside(r.dir, within))));
}
// THE INSTALLED PLUGINS' OWN CODE (the ~/.claude gap; the user's design of 2026-11-03): the account dir is an allowance
// because memory lands there - and so did `<account>/plugins/`, whose cache holds the very guards that judge this session,
// beside the install and marketplace registries; an Edit of `.../stack/hooks/guard-catastrophic-rm.js` switched that guard
// off unjudged. So `plugins/` under `~/.claude`, `CLAUDE_CONFIG_DIR` and every `~/.claude-<name>` - minus `plugins/data/`,
// where a plugin keeps its own state (`${CLAUDE_PLUGIN_DATA}`) - and the running plugin's own root (`CLAUDE_PLUGIN_ROOT`,
// wherever a `--plugin-dir` puts it) count as outside: a write there, or a removal of a folder holding one, is asked
// (`pluginBlock`) - in EVERY project, under every stand-down (PLUGIN_ONLY, at the top), since every project runs the one
// installed copy, and minus a plugin's own folder (`pluginsOwnFolder`, below). The project's own files pass first, so a
// plugin developed in this project is untouched. What opens it:
// the user's allow answer and its receipt, a folder the user typed, or an ALLOW_WRITE_OUTSIDE entry naming the tree or a
// folder in it - never a broader one (the whole account dir is the allowance this carve-out narrows).
const PLUGIN_TREES = [...new Set([HOME ? path.join(HOME, '.claude') : '', process.env.CLAUDE_CONFIG_DIR || '']
  .filter(Boolean).map((d) => realish(path.join(expandTilde(d), 'plugins'))))];
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ? realish(nativePath(expandTilde(process.env.CLAUDE_PLUGIN_ROOT))) : null;
const OWN_ALLOW = (envOf(process.env, 'ALLOW_WRITE_OUTSIDE') || '').split(path.delimiter).map((s) => s.trim()).filter(Boolean)
  .map(expandTilde).map(realish).filter((d) => !inside(ROOT, d));
const PLUGIN_STATE = 'data';
// A PLUGIN'S OWN FOLDER passes (the user's ruling of 2026-11-03, 'Let a plugin's own folder pass'): a folder right under
// `plugins/` named after a plugin that account's installed_plugins.json lists - claude-hud keeps its config in
// `plugins/claude-hud/`, and its setup and /claude-hud:configure asked once per session. Never the core's own name, never
// a name Claude Code keeps there itself (`CLAUDE_OWNED`), and with no readable registry no folder passes - so the cache,
// the marketplaces, the store, the registries and any name Claude Code adds later still ask.
const CORE_NAME = (() => { try { return require('./hook-prelude.js').CORE_PLUGIN; } catch { return 'alfred-code'; } })();
const CLAUDE_OWNED = new Set(['cache', 'marketplaces', 'data', 'store', 'synced', 'repos', '.trash'].map(fold));
const installedNames = new Map();
function pluginsOwnFolder(tree, t) {
  if (!inside(t, tree) || fold(t) === fold(tree)) return false;
  const first = t.slice(tree.length).split(path.sep).filter(Boolean)[0] || '';
  const name = fold(first);
  if (!name || CLAUDE_OWNED.has(name) || name === fold(CORE_NAME)) return false;
  if (!installedNames.has(tree)) {
    const names = new Set();
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(tree, 'installed_plugins.json'), 'utf8'));
      const plugins = reg && reg.plugins && typeof reg.plugins === 'object' && !Array.isArray(reg.plugins) ? reg.plugins : {};
      for (const id of Object.keys(plugins)) if (id.includes('@')) names.add(fold(id.slice(0, id.indexOf('@'))));
    } catch { /* no readable registry: no plugin's folder passes */ }
    installedNames.set(tree, names);
  }
  return installedNames.get(tree).has(name);
}
// The carved tree `t` (realish) lies in, or null.
function pluginTree(t) {
  for (const p of PLUGIN_TREES) if (inside(t, p) && !inside(t, path.join(p, PLUGIN_STATE))) return pluginsOwnFolder(p, t) ? null : p;
  if (spacePrefix && fold(t).startsWith(fold(spacePrefix))) {
    const [name, seg, sub] = t.slice(spacePrefix.length).split(path.sep);
    const tree = spacePrefix + name + path.sep + seg;
    if (name && seg && fold(seg) === fold('plugins') && !(sub && fold(sub) === fold(PLUGIN_STATE))) return pluginsOwnFolder(tree, t) ? null : tree;
  }
  if (PLUGIN_ROOT && inside(t, PLUGIN_ROOT)) return PLUGIN_ROOT;
  return null;
}
// The carved tree a REMOVAL of `t` takes with it: `t` holds one (`rm -rf ~/.claude`, `rm -rf ~/.claude-work`, a folder
// above every `~/.claude-<name>`), or lies in one.
function pluginTreeRemoved(t) {
  // only a tree that exists: a home with no plugins folder holds no plugin code to lose
  const held = [...PLUGIN_TREES, ...(PLUGIN_ROOT ? [PLUGIN_ROOT] : [])].find((p) => inside(p, t) && fs.existsSync(p));
  if (held) return held;
  if (spacePrefix) {
    const ft = fold(t);
    const fp = fold(spacePrefix);
    // `t` is a `~/.claude-<name>` folder itself, or a folder holding them all
    const name = ft.startsWith(fp) ? t.slice(spacePrefix.length) : null;
    if (name && !name.includes(path.sep) && fs.existsSync(path.join(t, 'plugins'))) return spacePrefix + name + path.sep + 'plugins';
    if (fp.startsWith(fold(t.endsWith(path.sep) ? t : t + path.sep))) {
      // a folder above them all: the first `~/.claude-<name>/plugins` that exists
      let names = [];
      try { names = fs.readdirSync(path.dirname(spacePrefix)); } catch { names = []; }
      const base = path.basename(spacePrefix);
      const hit = names.find((n) => n.startsWith(base) && n.length > base.length && fs.existsSync(path.join(path.dirname(spacePrefix), n, 'plugins')));
      if (hit) return path.join(path.dirname(spacePrefix), hit, 'plugins');
    }
  }
  return pluginTree(t);
}
// Whether the user's own allowances open `t` inside a carved tree.
const pluginOpened = (t, tree) => OWN_ALLOW.some((d) => inside(t, d) && inside(d, tree))
  || receiptRoots.some((d) => inside(t, d)) || typedAllowed(t, tree);
function allowed(target) {
  const t = realish(target);
  if (inside(t, ROOT)) return true;
  if (PLUGIN_ONLY) { const carved = pluginTree(t); return !carved || pluginOpened(t, carved); }
  if (memberMemory(t)) return false;
  const tree = pluginTree(t);
  if (tree) return pluginOpened(t, tree);
  if (ownMemory(t)) return true;
  if (effectiveAllow.some((d) => inside(t, d)) || sessionScratchAllowed(t)) return true;
  if (receiptRoots.some((d) => inside(t, d))) return true; // the user's 'allow' for this session
  if (spaceOk && fold(t).startsWith(fold(spacePrefix))) return true;
  if (sameRepoWorktree(t)) return true;
  if (typedAllowed(t)) return true; // a folder the user typed (U20)

  return false;
}
// THE TRANSCRIPT IS THE RECORD (final review 2026-10-30, FC): every receipt and hook reads the session's transcript for
// the user's own answers, and the config dir is a write allowance (memory lands there) - so a Write, an Edit or a shell
// append could forge an answer row. Inside the config dir (`CLAUDE_CONFIG_DIR`, else `~/.claude`) a write to or removal
// of a `*.jsonl` under `projects/` - and of the payload's own `transcript_path`, wherever it lives - is denied, and so is
// removing a folder that holds one or copying into a folder that holds one directly. No receipt or allowance opens it:
// the record is what every receipt reads. Reading it stays open (Read, grep, a copy out of it).
const CONFIG_DIR = (() => {
  const d = process.env.CLAUDE_CONFIG_DIR || (HOME ? path.join(HOME, '.claude') : '');
  return d ? realish(expandTilde(d)) : null;
})();
const PROJECTS_DIR = CONFIG_DIR ? realish(path.join(CONFIG_DIR, 'projects')) : null;
const TRANSCRIPT = typeof payload.transcript_path === 'string' && payload.transcript_path ? realish(expandTilde(payload.transcript_path)) : null;
const RECORD_FILE = /\.jsonl$/i;
const RECORDS_NEAR_ROOT = !!((TRANSCRIPT && inside(TRANSCRIPT, ROOT)) || (PROJECTS_DIR && (inside(PROJECTS_DIR, ROOT) || inside(ROOT, PROJECTS_DIR))));
// Whether removing a folder removes a record: the payload's own transcript under it, or a `.jsonl` under projects/ - a
// bounded walk (5,000 entries), past which it is taken to hold one.
function holdsRecord(dir) {
  if (TRANSCRIPT && inside(TRANSCRIPT, dir)) return true;
  if (!PROJECTS_DIR) return false;
  const start = inside(dir, PROJECTS_DIR) ? dir : inside(PROJECTS_DIR, dir) ? PROJECTS_DIR : null;
  if (!start) return false;
  const stack = [start];
  let seen = 0;
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > 5000) return true;
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (RECORD_FILE.test(e.name)) return true;
    }
  }
  return false;
}
// A copy or move INTO a folder lands on `<folder>/<name>`: a record when the folder holds one directly.
function intoRecords(dir) {
  if (TRANSCRIPT && fold(path.dirname(TRANSCRIPT)) === fold(dir)) return true;
  if (!PROJECTS_DIR || !inside(dir, PROJECTS_DIR)) return false;
  try { return fs.readdirSync(dir).some((n) => RECORD_FILE.test(n)); } catch { return false; }
}
// What a target does to a record: `remove` (rm, rmdir, a move's source, PowerShell's remove and move), `into` (a copy or
// move destination) or a plain write.
const recordKind = (what, verb) => (what === 'a copy/move destination' ? 'into'
  : what === 'a move OUT of another project' || /^(?:rm|rmdir|rimraf|move-item|mi|move)$/i.test(String(verb || '')) ? 'remove' : null);
function recordAt(target, kind) {
  const t = realish(target);
  if (TRANSCRIPT && fold(t) === fold(TRANSCRIPT)) return t;
  if (PROJECTS_DIR && RECORD_FILE.test(t) && inside(t, PROJECTS_DIR)) return t;
  if (kind === 'remove' && holdsRecord(t)) return t;
  if (kind === 'into' && intoRecords(t)) return t;
  return null;
}
function recordBlock(what, shown) {
  global.BLOCK_DETAIL = { branch: 'transcript' };
  process.stderr.write(
    `Blocked: ${what} targets '${shown}', which is or holds a session transcript - the record every receipt and hook\n` +
    `reads for the user's own answers. Nothing in a session writes, edits or removes one, and no receipt or allowance\n` +
    `opens it. Reading it stays open (Read, grep). Drop this step; a note to keep goes in the project's memory folder.\n`,
  );
  process.exit(2);
}
// Resolve the way the session sees it: the hook subprocess's cwd is not the Bash tool's persisted cwd, which the payload
// carries as `cwd` - so a shell path is anchored there (SHELL_CWD, the anchor the rm and config guards use), and a
// file-tool path, which the tools take absolute, at the project root. From `proj/sub`, `echo hi > ../x.txt` lands in
// the project and was blocked; from a sibling checkout `echo hi > x.txt` lands outside and passed (audit 2026-10-08
// row 23). A cwd that is missing, relative or gone is the project root, as before.
const SHELL_CWD = (() => {
  const c = typeof payload.cwd === 'string' && payload.cwd ? nativePath(payload.cwd) : '';
  return c && path.isAbsolute(c) && fs.existsSync(c) ? real(c) : ROOT;
})();
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
// The plugins-tree denial: no hand-off card (the tree is no project), dropping the change recommended.
function pluginBlock(what, shown, tree) {
  global.BLOCK_DETAIL = { branch: 'plugin-code' };
  const receiptRel = receiptRelOf();
  process.stderr.write(
    `Blocked: ${what} targets '${shown}', inside ${tree} - the installed plugins' own code and registries, where the\n` +
    `guards judging this session live; a change there can switch one off. A plugin's fix lands in its source repo.\n` +
    `End this turn with ONE AskUserQuestion, in this order -\n` +
    `  'Drop the change (Recommended)' - say what you meant to change and where its source lives.\n` +
    `  'Allow writes into ${tree} for this session' - write ${receiptRel} with exactly these lines\n` +
    `  and retry; it counts only after the user's own answer to this denial, never one auto-run gave (under 8h):\n` +
    writeLines([tree]) +
    shutText(receiptRel) +
    `Plugin state (plugins/${PLUGIN_STATE}/), memory, plans and settings stay open.`,
  );
  process.exit(2);
}
// A removal outside the project that takes a carved tree with it (`rm -rf ~/.claude`, a move of a folder holding the cache).
function judgeRemoval(abs, what, shown) {
  const t = realish(abs);
  if (inside(t, ROOT)) return;
  const tree = pluginTreeRemoved(t);
  if (tree && !pluginOpened(t, tree)) pluginBlock(what, shown, tree);
}
function block(what, shown, abs = shown) {
  const hit = memberMemory(realish(abs));
  if (hit) memoryBlock(what, shown, hit);
  const tree = pluginTree(realish(abs));
  if (tree) pluginBlock(what, shown, tree);
  const other = otherProjectName(abs);
  // The main block names its branch like the unread one below (audit 2026-10-20, the hooks track's minor list: every
  // other row of this guard carried none, so the ledger could not split a file-tool write from a shell one).
  global.BLOCK_DETAIL = { branch: /^(?:Write|Edit|MultiEdit|NotebookEdit) of a file$/.test(what) ? 'file-tool'
    : /^(?:write_file|edit_file|move_file|create_directory) /.test(what) ? 'mcp-file-write' : /git write/.test(what) ? 'git-write' : 'shell-write' };
  const otherRoot = otherProjectRoot(abs);
  // Absolute, the sibling named: the user pastes the hand-off into that repo's session, which finds the card by this path.
  const card = path.resolve(ROOT, docsRoot, 'work', 'cross-project-tasks', `${other}.md`);
  const receiptRel = receiptRelOf();
  // Cut to the ask and its options (deep hooks review 2026-10-16: 1,553 chars per denial); the why is repo-hooks.md's.
  process.stderr.write(
    `Blocked: ${what} targets '${shown}', outside this session's project (${ROOT}). A change another\n` +
    `repo needs is handed off, not applied here. End this turn with ONE AskUserQuestion, in this order -\n` +
    `  'Task card in this project (Recommended)' - write ${card}:\n` +
    `  per task what changes where (file + symbol), why, the shared contract, how ${other} verifies it;\n` +
    `  then finish your side, or say what is blocked until it lands.\n` +
    `  'Allow writes into ${otherRoot} for this session' - write ${receiptRel} with exactly these lines\n` +
    `  and retry; it counts only after the user's own answer to this denial, never one auto-run gave (under 8h):\n` +
    writeLines([otherRoot]) +
    `  'Drop the change'.\n` +
    shutText(receiptRel) +
    `Reading ${other} stays open. A tree this project owns belongs in ALFRED_CODE_ALLOW_WRITE_OUTSIDE.`,
  );
  process.exit(2);
}

const input = payload.tool_input || {};
const tool = payload.tool_name;

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
  const target = input.file_path || input.notebook_path;
  if (!target) process.exit(0);
  const abs = resolveTarget(String(target));
  if (!PLUGIN_ONLY && recordAt(abs, null)) recordBlock(`${tool} of a file`, String(target));
  if (!allowed(abs)) block(`${tool} of a file`, String(target), abs);
  process.exit(0);
}

// A filesystem server the user registers writes too (audit 2026-11-03 SYS-02; HK-26 gave the secret guard its read
// route): `write_file`, `edit_file` and `create_directory` take `path`, `move_file` takes `source` and `destination` - the
// reference server's schemas (@modelcontextprotocol/server-filesystem, src/filesystem/server.ts in
// github.com/modelcontextprotocol/servers, read 2026-11-03). Matched by the tool's name under any registration, since the
// stack ships no server. The server expands a leading `~` (lib.ts validatePath); a relative path is read at the project
// root, the file tools' anchor. A move takes its source OUT of where it stood, so both ends are judged, as `mv` is - its
// destination is the new path itself (the server refuses one that exists), a plain write; a field missing or not a
// string names no target.
const FS_WRITE_TOOL = /^mcp__.+__(?:write_file|edit_file|move_file|create_directory)$/;
if (FS_WRITE_TOOL.test(String(tool || ''))) {
  const verb = String(tool).replace(/^mcp__.+__/, '');
  const ends = verb === 'move_file'
    ? [[input.source, `${verb} of a source`, 'remove'], [input.destination, `${verb} to a destination`, null]]
    : [[input.path, `${verb} of a ${verb === 'create_directory' ? 'folder' : 'file'}`, null]];
  for (const [p, what, kind] of ends) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const abs = resolveTarget(expandTilde(p));
    if (!PLUGIN_ONLY && recordAt(abs, kind)) recordBlock(what, p);
    if (kind === 'remove') judgeRemoval(abs, what, p);
    if (!allowed(abs)) block(what, p, abs);
  }
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
// PowerShell's path separator is the backslash and its escape the backtick (audit 2026-10-20, the hooks track's minor list:
// `..\sib\x` named no parent on a POSIX host and passed) - read as `/`, as the config guard reads it.
const rawCommand = /^PowerShell$/i.test(String(tool || '')) ? String(input.command || '').replace(/\\/g, '/') : String(input.command || '');
// A script FILE a shell runs is read from disk against the shell's cwd, and a git alias is expanded to what it runs
// (2.1.6 re-verify 2 R2-M5, R2-m1); an alias that cannot be read is not judged, like an unexpanded variable.
const scan = shell.scanShell(rawCommand, { cwd: SHELL_CWD, aliases: true });
const command = scan.command;
if (!command.trim()) process.exit(0);

const { isVar } = shell;
// One normaliser per run: shell.anchorAt caches its compiled anchor by this function, so a fresh closure per write recompiled it each time.
const anchorNorm = (t) => nativePath(expandTilde(shell.unquote(t)));
const anchorAt = (index) => shell.anchorAt(scan.cds, index, SHELL_CWD, anchorNorm);
// Judge one path token found at `index` in the command: only a token that can land out of tree
// is resolved at all - an explicitly out-of-tree spelling (absolute, ~-rooted, reaching up with
// `..`), or any relative path once a `cd` has moved the anchor. A bare relative path with the
// anchor still at the project root is this project's own file - the case that must never block.
function judge(rawIn, index, what, verb) {
  const raw = scan.expandVars(rawIn, index);
  if (isVar(raw)) return; // an unexpanded variable - cannot judge, don't guess
  const base = anchorAt(index);
  // `C:\\other\\f.txt` and `\\\\server\\share\\f.txt` are as explicit as a leading `/`, but neither
  // matches the POSIX spellings - so on Windows EVERY shell write to an absolute path fell
  // through this early return unjudged, while the same reach through Write/Edit was blocked
  // (measured on windows-latest: 5 of the guard's own shell cases passed the write through).
  const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\)/;
  const explicit = /^([~/]|\.\.[/\\])/.test(raw) || (process.platform === 'win32' && WIN_ABS.test(raw))
    || raw.includes('/../') || raw === '..';
  if (!explicit && base === ROOT) {
    // this project's own file - unless a transcript sits in the project, or the project in the config dir's records
    if (!PLUGIN_ONLY && RECORDS_NEAR_ROOT && recordAt(resolveTarget(nativePath(raw), ROOT), recordKind(what, verb))) recordBlock(what, raw);
    return;
  }
  const expanded = nativePath(expandTilde(raw));
  if (!path.isAbsolute(expanded) && base === null) return; // relative from an unknown anchor
  const abs = resolveTarget(expanded, base);
  // A removal unlinks a symbolic link itself, never what it points at (audit 2026-10-10 C31, session 0d070bcc: `rm -f`
  // of the session's own scratch link to a sibling repo was blocked as a write into that repo, and the denial offered to
  // open the sibling). The link is judged where it LIVES - its folder resolved, its own name kept - unless a trailing
  // slash makes the shell follow it. Seeded into realish's cache, so the verdict and a denial's names read the same path.
  if (verb === 'rm' && !/[\\/]\.?$/.test(raw)) {
    let link = false;
    try { link = fs.lstatSync(abs).isSymbolicLink(); } catch { link = false; }
    if (link) {
      const at = path.join(realish(path.dirname(abs)), path.basename(abs));
      realishSeen.set(abs, at);
      realishSeen.set(at, at);
    }
  }
  // A target whose own leading segment is a GLOB names no project, and the denial then built its
  // remedy out of the fabricated name - 'finish YOUR side against the current behaviour of `*`'.
  // Nothing can be handed off to a repo that cannot be named, so this passes rather than blocks. Asked only of a write
  // that is not allowed: the name climbs to the filesystem root for a .git, and asked of every write it cost a 245KB
  // chain of cd steps most of its time on Windows (2.1.7).
  if (!PLUGIN_ONLY && recordAt(abs, recordKind(what, verb))) recordBlock(what, explicit ? raw : abs);
  if (recordKind(what, verb) === 'remove') judgeRemoval(abs, what, explicit ? raw : abs);
  if (allowed(abs)) return;
  // ...unless the glob can reach a member's memory (R072), which block() names.
  if (/[*?\[]/.test(otherProjectName(abs)) && !memberMemory(realish(abs))) return;
  // name the token the session wrote unless a cd moved it - then the resolved path says where it lands
  block(what, explicit ? raw : abs, abs);
}
// Only WRITE-shaped commands are considered, and only the paths they actually write to. A path
// that resolves inside the project - the overwhelming majority, relative paths included - never
// reaches the check, so the false-positive surface is limited to commands genuinely writing out
// of tree. The interpreter-script writes come last, as a literal path only.
for (const t of scan.targets) judge(t.raw, t.index, t.what, t.verb);

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
// plugin-only mode asks nothing of a script it cannot read: that ask covers every write, which the stand-down switched off
if (PLUGIN_ONLY) process.exit(0);
const unread = scan.unread.slice();
if (scan.aliasUnreadAt >= 0) unread.push({ at: scan.aliasUnreadAt, why: 'a git alias it could not read', path: null });
for (const u of unread) {
  if (u.path ? receiptRoots.some((d) => inside(realish(u.path), d)) : receiptLines.includes('unread')) continue;
  const shown = u.path || 'this command';
  const receiptRel = receiptRelOf();
  global.BLOCK_DETAIL = { branch: 'unread', why: u.why };
  process.stderr.write(
    `Blocked: this guard could not read ${shown} (${u.why}), so it cannot say where it writes -\n` +
    `and a script it cannot read is never let through, since the same text a little shorter is judged.\n` +
    `Do not decide for the user: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
    `  'Drop it (Recommended)' - run a smaller piece the guard can read instead.\n` +
    `  'Allow ${shown} for this session' - only when it is this project's own and writes only here:\n` +
    `  write ${receiptRel} with exactly these lines and retry the SAME command:\n` +
    writeLines([u.path || 'unread']) +
    `The receipt counts only after the user's own answer to this denial, never one auto-run gave - this session, under 8h.\n` +
    shutText(receiptRel),
  );
  process.exit(2);
}

process.exit(0);
