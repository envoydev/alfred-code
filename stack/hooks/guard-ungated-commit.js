#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matcher: Bash): the PUBLISH ceremony, mechanized - one hook because commit
// and push are one gate family and share the receipt machinery, the heredoc blanking and the
// quote masking below. A non-trivial
// `git commit` runs only after the house review gate (task-verify-code or review-code, plus
// review-security on auth/crypto/data-access paths) or the user's explicit waiver -
// recorded as a receipt file the gate step writes. Prose measured unreliable: 8 ungated
// commit events across 6 audited sessions, including one where the git rule was
// provably read into context the same session and skipped anyway, and one commit with
// no user authorization at all. Trivial diffs pass untouched (the rule's own
// typo/one-line exemption, judged from the working-tree diff). exit 2 = block
// (stderr fed back to the model); exit 0 = allow.
// The PUBLISH half: `git push` and `gh pr merge` put the work where other people (and CI) get
// it, and NOTHING gated them - replayed across four bundles, every push and merge passed every
// guard. In one session the FIRST state-changing act of the run published unpushed commits 18
// minutes before any receipt existed, and 40 files reached a shared `develop` ungated. Same
// receipt shape, its own file (<data root>/state/approvals/PUSH-GATE), and `guard-ungated-commit:push` in ALFRED_CODE_HOOKS_OFF turns
// it off for a repo whose remote is already gated by branch protection or a required review.
// Receipt lifecycle: the gate step writes <data root>/state/approvals/COMMIT-GATE when its checks
// pass (VERIFIED <scope>) or the user explicitly waives (WAIVED - "<their words>");
// the commit turn clears it after the commit lands. Receipts older than
// MAX_RECEIPT_AGE_MS are treated as absent - the stale-stamp lesson from the approval
// gate (a leftover stamp silently authorized later, unrelated runs).
const fs = require('fs');
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;
// 2.8.0 layout (layout.js, copied beside this hook): receipts in <data root>/state/approvals/, session scratch in
// state/sessions/, the session records in state/history/; null on an older copy route, which keeps the pre-2.8.0 paths.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
const path = require('path');
const { execSync, execFileSync, spawnSync } = require('child_process');
// Every git this guard runs: fsmonitor off, no optional locks (hook-prelude.js gitSafe, audit 2026-10-20 H2) - the same two
// inline when the prelude is absent, since a protective read must not skip git or run a repository's own program.
const gitSafe = (() => { try { return require('./hook-prelude.js').gitSafe; } catch { return (argv, opts = {}) => ['git', ['-c', 'core.fsmonitor=false', ...argv], { ...opts, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' } }]; } })();

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-ungated-commit');
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
// shell-writes.js is the one home of reading a shell command (2.1.6 re-verify 3 R3-M3, R3-M4): its walker finds each git
// call as a COMMAND WORD - past assignments, keywords and wrappers - and walks the call's options word by word. The regex
// family this guard kept here matched the options instead, and a run of them backtracked: `git` + 36 x ' -c' +
// '; git push' took 67s. A `git` in another command's arguments (`echo git push`) is no call (R3-m7), and a heredoc
// body or a quoted span is data, never a call. The guard ships beside the module; a copy that runs before it lands
// judges nothing.
let nativePath = null;
try { ({ nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
if (!nativePath) process.exit(0);
const sw = require(path.join(__dirname, 'shell-writes.js'));
// A git ALIAS runs another git command - or, with `!`, a shell command - and git resolves it before it runs: `git ci -m
// x` with `alias.ci = commit` committed ungated on every tree (2.1.6 review T20). A script handed to a shell - `sh -c
// '...'` (an alias's included), a literal piped to `sh`, a heredoc into it, `eval '...'`, a script FILE a shell runs -
// runs as shell too (review re-verify N2 / N4, re-verify 2 R2-M5 / R2-m2). shell-writes.js is the one home of that reader
// (`gitText`, shared with the force-push and rm guards, seam M3): aliases expanded, every carried script joined after a
// newline, one scan budget (hook-prelude.js) bounding the whole read. What it leaves unread gates as a commit, never
// passes (re-verify 3 R3-m4): `unreadAt` names a call whose alias could not be read, and any text the budget or the
// depth stopped in when what is left names git at all.
const gitCwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const gitRead = sw.gitText(String((payload.tool_input || {}).command || ''), gitCwd);
const { command, parsed, calls } = gitRead;
// The text of the simple command a call stands in, one line - what a denial names.
const actText = (c) => command.slice(c.at, c.stop).trim().replace(/\s+/g, ' ');
// `git commit`'s own argv: the options whose value is the next word (short letters, long names -
// a long one may be cut to a unique prefix, as git's parser allows), the flags this scan reads, and
// the paths it names, with or without `--`. `-u` and `-S` take an attached value only.
const COMMIT_VALUE_SHORT = 'mFCct';
const COMMIT_VALUE_LONG = ['message', 'file', 'author', 'date', 'cleanup', 'fixup', 'squash', 'template', 'reuse-message', 'reedit-message', 'trailer', 'pathspec-from-file'];
const COMMIT_FLAGS = ['all', 'only', 'include', 'dry-run', 'interactive', 'amend'];
function commitArgs(args) {
  const known = [...COMMIT_VALUE_LONG, ...COMMIT_FLAGS];
  const flags = new Set();
  const paths = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) { paths.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const typed = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const hits = known.filter((n) => n.startsWith(typed));
      const name = known.includes(typed) ? typed : (typed && hits.length === 1 ? hits[0] : typed);
      flags.add(`--${name}`);
      if (eq < 0 && COMMIT_VALUE_LONG.includes(name)) i++;
      continue;
    }
    if (a.length > 1 && a.startsWith('-')) {
      for (let k = 1; k < a.length; k++) {
        flags.add(`-${a[k]}`);
        if (COMMIT_VALUE_SHORT.includes(a[k])) { if (k === a.length - 1) i++; break; }
        if ('uS'.includes(a[k])) break;
      }
      continue;
    }
    paths.push(a);
  }
  return { flags, paths };
}
// A commit dry run commits nothing (R3-m7). A git call whose SUBCOMMAND is not a plain literal - `git $C`,
// `git $(echo commit)` - cannot be judged at all, and reading it as 'not a commit' is what an obfuscation leans on, so it
// gates like a commit; so does a call the reader left unread (above).
const commitCall = calls.find((c) => c.sub === 'commit' && !commitArgs(c.argv).flags.has('--dry-run'));
const opaqueCall = commitCall ? null : calls.find((c) => c.opaque);
const commitMatch = commitCall ? { index: commitCall.at, call: commitCall, opaque: false }
  : opaqueCall ? { index: opaqueCall.at, call: opaqueCall, opaque: true }
    : gitRead.unreadAt >= 0 ? { index: gitRead.unreadAt, call: null, opaque: true } : null;
// The publish half is on by default and switched off per install for a repo whose remote already
// gates the branch (protection rules, a required review): `guard-ungated-commit:push` in ALFRED_CODE_HOOKS_OFF, or the old
// ALFRED_CODE_PUSH_GATE=0 for the 2.x line (hook-prelude.js partOff).
const PUSH_GATE_ON = !(() => { try { return require('./hook-prelude.js').partOff('guard-ungated-commit', 'push'); } catch { return envOf(process.env, 'PUSH_GATE') === '0'; } })();
// The PUBLISH verbs, found as command words the way the commit verb is, so a `git push` inside a report's prose or a
// commit message is text, not an act - the false-positive pair this gate MUST not reproduce cost 430,740 tokens when a
// report write was denied for quoting a merge command. `--dry-run` / `-n` publishes nothing, and neither does a push
// with nothing ahead of its upstream.
// Past `git push`, a publish is read by CONCEPT on every transport (forge.js): a merge or a branch write through any CLI
// (`gh pr merge`, `glab mr merge`, `az repos pr update --status completed`, one nobody listed), a raw API call, or an
// MCP tool (`accept_merge_request`, `repo_pull_request_write {autoComplete: true}`, `push_files`) needs the same receipt.
// A forge call whose verb the lexicon does not know is an ask - a deny when nobody is at the terminal to answer it.
let publishMatch = null;
let askMatch = null;
let forgeLib = null;
try { forgeLib = require(path.join(__dirname, 'forge.js')); } catch { /* an install without it: the git parse alone */ }
const isMcpCall = /^mcp__/.test(String(payload.tool_name || ''));
const HISTORY_MOVER = new Set(['commit', 'merge', 'cherry-pick', 'am', 'rebase', 'revert', 'pull', 'reset']);
if (PUSH_GATE_ON) {
  const known = (r) => r && r.strength === 'known' && forgeLib.PUBLISH.has(r.concept);
  if (isMcpCall) {
    let r = null;
    try { r = forgeLib && forgeLib.classify(payload); } catch { r = null; }
    const act = `${String(payload.tool_name).replace(/^mcp__/, '')} ${JSON.stringify(payload.tool_input || {}).slice(0, 120)}`;
    if (known(r)) publishMatch = { index: 0, call: null, git: false, act, forge: r };
    else if (r && r.strength === 'unknown') askMatch = { ...r, act };
  } else {
    const push = calls.find((c) => c.sub === 'push');
    let acts = [];
    if (!push && parsed && forgeLib) { try { acts = forgeLib.classifyCommand(command, gitCwd, { parsed }); } catch { acts = []; } }
    const pub = acts.find(known);
    const spanText = (r) => command.slice(r.at, r.end).trim().replace(/\s+/g, ' ');
    if (push) publishMatch = { index: push.at, call: push, git: true, act: actText(push) };
    else if (pub) publishMatch = { index: pub.at, call: null, git: false, act: spanText(pub), forge: pub };
    else {
      const unknown = acts.find((r) => r.strength === 'unknown');
      if (unknown) askMatch = { ...unknown, act: spanText(unknown) };
    }
  }
}

// --- add -N without a chained reset -------------------------------------------------------
// The commit checkpoint's ask derives the scope with a survey that never moves the index (`git diff HEAD --stat; git ls-files -o
// --exclude-standard`): the older `git add -N . && ...; git reset -q` unstaged a session's own `git rm` deletions (audit
// 2026-10-10, session f24eb967). A bare `git add -N .` left its
// intent-to-add entries open across 6 more Bash calls in one measured session, ending in an
// 8-call fsck/dangling-blob forensic chase and an unrequested re-stage that flipped a partially
// staged file to fully staged. Independent of commit/push - it fires on its own. Scoped to the
// WHOLE-TREE shape (`-N .`, or -N with no pathspec): `git add -N <new file>` before a `git add -p`
// is a deliberate staging move with one file's entry to clear, not the survey this rule is about.
const addN = calls.find((c) => c.sub === 'add' && c.argv.some((a) => a === '-N' || a === '--intent-to-add')
  && c.argv.every((a) => a.startsWith('-') || a === '.'));
const INDEX_FREE_SURVEY = 'git diff HEAD --stat; git ls-files -o --exclude-standard';
if (addN && !calls.some((c) => c.sub === 'reset')) {
  process.stderr.write(
    `Blocked: ${actText(addN)} with no git reset in the same call - intent-to-add entries stay\n` +
    `open across every Bash call after this one until something clears them (measured: 6 calls open,\n` +
    `an 8-call fsck/dangling-blob chase, and an unrequested re-stage that flipped a partially staged\n` +
    `file to fully staged). Survey the scope without touching the index - the tracked diff, then the\n` +
    `untracked files:\n` +
    `  ${INDEX_FREE_SURVEY}\n` +
    `(the commit checkpoint's survey - a reset after -N would unstage work already staged).`,
  );
  process.exit(2);
}
// A bare `git reset -q` resets the WHOLE index, so chained after the survey it unstages every hunk the user had staged
// (audit 2026-10-10: a read-only verifier seat ran it in session 05c925e9; in f24eb967 it unstaged a `git rm` and cost
// an amend). Judged only when the index holds staged work: the survey that leaves the index alone passes it.
const bareReset = addN && calls.find((c) => c.sub === 'reset' && c.at > addN.at && c.argv.every((a) => /^-(?:q|-quiet|-mixed)$/.test(a)));
if (bareReset) {
  let staged = false;
  try {
    execFileSync(...gitSafe(['diff', '--cached', '--quiet'], { cwd: gitRead.callDir(addN), timeout: 5000, stdio: 'ignore' }));
  } catch (e) { staged = e && e.status === 1; }
  if (staged) {
    process.stderr.write(
      `Blocked: ${actText(bareReset)} after ${actText(addN)} resets the WHOLE index, and the index holds staged work\n` +
      `now - the survey would unstage it. Survey without touching the index:\n` +
      `  ${INDEX_FREE_SURVEY}\n` +
      `or reset only the paths -N added: git reset -q -- <those paths>.`,
    );
    process.exit(2);
  }
}

// Every `git add` in the command - judged below against what was untracked before the session started, so a bare
// `git add -A` in its own call is read too.
const addCalls = calls.filter((c) => c.sub === 'add');
// The ask for a forge call the lexicon cannot read: the user decides whether it publishes. Nobody at the terminal (print
// mode, auto-mode) cannot answer an ask, so there it is a deny naming the act. The asked act is ledgered (`asked`) for the
// ref watch, so a move the user approved reads as explained.
// Where the act ledger lives: the repo root the receipts are read from once it is resolved below, the project before.
function forgeRoot() {
  try { return root; } catch { return process.env.CLAUDE_PROJECT_DIR || gitCwd; }
}
function forgeAsk(r) {
  let nobody = false;
  try { nobody = require('./hook-prelude.js').unattended(payload); } catch { nobody = false; }
  const what = String(r.act || '').slice(0, 200);
  if (nobody) {
    process.stderr.write(`Blocked: ${what} - a forge call the stack cannot classify (${r.why}), and nobody is at the terminal to\n` +
      `confirm it publishes nothing. If it merges, pushes or releases, run habits-commit-checkpoint's publish half first; if it\n` +
      `does not, add its verb to <data root>/forge-lexicon.json.`);
    process.exit(2);
  }
  forgeLib.recordAct(forgeRoot(), payload.session_id, { ...r, asked: true });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `${what} - a forge call the stack cannot classify (${r.why}). Approve only if it merges, pushes and releases nothing; a publish needs the checkpoint's receipt.` } }));
  process.exit(0);
}
if (!commitMatch && !publishMatch && !addCalls.length) { if (askMatch) forgeAsk(askMatch); process.exit(0); }

// Resolve the repo the act actually runs in: a `cd <sibling> && git commit` or a
// `git -C <sibling> push` executes in a DIFFERENT repo than this hook's default root,
// so the diff/receipt checks below would silently judge the wrong tree (measured: a
// cross-repo commit's ledger cwd named the home repo while the commit ran in the sibling).
// Git Bash / MSYS spell a Windows path in POSIX MOUNT form (`/c/Users/...`, `/cygdrive/c/...`),
// which node on win32 resolves against the CURRENT drive instead - the same falsehood that made
// the cross-project guard block a session's own temp cleanup. Translate before resolving; off
// Windows the spelling is a real POSIX path and is never touched.
// The shell's own cwd is where git starts: a session working in a git worktree of its project keeps
// CLAUDE_PROJECT_DIR on the main checkout, so anchoring there judged the main tree's diff and let a
// worktree commit through ungated whenever main was clean (measured on 2.1.283).
const projectDir = process.env.CLAUDE_PROJECT_DIR || '';
// The directory a git call runs in: its piece's cwd moved by every cd before it there (PowerShell's Set-Location and
// Push-Location too), then the call's own `-C` chain - read the same way for the add sweep, the commit's set and the
// scan (2.1.6 review B1). A cd the guard cannot follow (`cd $DIR`) leaves the piece's own cwd.
const callDir = gitRead.callDir;
// the FIRST of the acts anchors the repo - everything before it moved the cwd
const firstAct = [commitMatch && (commitMatch.call || { at: commitMatch.index, dirs: [] }),
  publishMatch && (publishMatch.call || { at: publishMatch.index, dirs: [] }), addCalls[0]].filter(Boolean).sort((a, b) => a.at - b.at)[0];
let root = callDir(firstAct);
// The diff and the receipt belong to the repo git runs in. When that is the project's own repo, the
// project dir stays the anchor: a subfolder cwd, or a project that is a subfolder of its repo, reads
// the receipt where the session writes it.
const topOf = (dir) => {
  try { return fs.realpathSync.native(execFileSync(...gitSafe(['rev-parse', '--show-toplevel'], { cwd: dir, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).toString().trim()); } catch { return null; }
};
const gitTop = topOf(root);
if (projectDir && gitTop && gitTop === topOf(projectDir)) root = projectDir;
else if (gitTop) root = gitTop;
// git's own stderr stays out of the hook's: the @{u} probes print `fatal: no upstream` on every
// first push, and the harness shows the model the hook's stderr as the denial reason.
const git = (args) => execSync(`git -c core.fsmonitor=false ${args}`, { cwd: root, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).toString().trim();
// The files this act would commit. The stack's own docs root is excluded: the receipt is written
// INTO it moments before the act, so counting it inflated both the trivial-diff bar and the spec
// check - a conformant `spec: 3 files` read as covering 3 of 4 because the fourth was the receipt.
const docsPrefix = () => {
  let d = docsRootEnv().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!d) return null;
  // An ABSOLUTE docs root can still sit INSIDE the repo, and then the receipt this gate is reading
  // counts as one of the changed files its own `spec:` line is measured against - so a conformant
  // receipt fails its own count and the gate blocks the commit it just authorized. Relativize
  // against the repo root and exclude it whenever it lands inside; a root genuinely outside the
  // tree has nothing to exclude.
  if (path.isAbsolute(d)) {
    const rel = path.relative(root, d).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return null;
    d = rel;
  }
  return `${d}/`;
};
// What was untracked when this change started (docs-session.js writes it once per HEAD at session start,
// root-relative, spelled with core.quotePath=false) is not the change: out of the count and the trivial bar, and a
// git add that would sweep it in is blocked below. The record for this HEAD first; a commit made since the session
// started has none yet, so the newest record stands - a path it lists that is still untracked is still not the change,
// and one it lists that got committed no longer matters. No record at all - an older install, no SessionStart - is an
// empty set. Before either: the record this session's first start used, named in `untracked-session-<sid>` (audit
// 2026-10-10 C09), so a HEAD the session moved never hands it another session's snapshot.
let preExistingCache;
// 2.8.0: state/sessions/ first, then the pre-2.8.0 <docs-path>/flow/ an older hook wrote them to.
function preExistingRecord() {
  const dirs = [...new Set([layout && layout.statePath(root, 'sessions', ''), path.resolve(root, docsRootEnv(), 'flow')].filter(Boolean))];
  const sid = String((payload && payload.session_id) || '').replace(/[^\w.-]/g, '_');
  if (sid) {
    for (const dir of dirs) {
      try {
        const named = path.basename(fs.readFileSync(path.join(dir, `untracked-session-${sid}`), 'utf8').trim());
        const hit = dirs.map((d) => path.join(d, named)).find((f) => fs.existsSync(f));
        if (named.startsWith('untracked-at-start-') && hit) return hit;
      } catch { /* no pointer here - an older start */ }
    }
  }
  let head = '';
  try { head = git('rev-parse --verify -q HEAD'); } catch { head = ''; }
  const name = `untracked-at-start-${/^[0-9a-f]{7,64}$/.test(head) ? head : 'unborn'}`;
  const own = dirs.map((d) => path.join(d, name)).find((f) => fs.existsSync(f));
  if (own) return own;
  let newest = null;
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith('untracked-at-start-')) continue;
        const m = fs.statSync(path.join(dir, f)).mtimeMs;
        if (!newest || m > newest.m) newest = { f: path.join(dir, f), m };
      }
    } catch { /* no such folder - no record */ }
  }
  return newest ? newest.f : null;
}
function preExisting() {
  if (preExistingCache) return preExistingCache;
  const file = preExistingRecord();
  try { preExistingCache = new Set(file ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []); } catch { preExistingCache = new Set(); }
  return preExistingCache;
}
// The project a changed file belongs to, for the push-scope check: the name under a common
// monorepo container (apps/libs/packages/projects/services/modules - the shape `nx test auth`
// names), else the top-level directory. A root-level file names no project - it is workspace-wide
// by construction, which is why a doc or single-file push never needs a scope: line.
// A plain top-level directory is a project only when it carries its OWN build manifest: in an
// ordinary repo `scripts/`, `docs/` and `src/` are folders, not projects, and counting them would
// demand a scope: line on every push that spans two directories.
const MANIFESTS = ['package.json', 'pom.xml', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'build.gradle', 'build.gradle.kts'];
const ownsManifest = (dir) => {
  try {
    const entries = fs.readdirSync(path.join(root, dir));
    return entries.some((e) => MANIFESTS.includes(e) || /\.(csproj|sln|fsproj|vbproj)$/i.test(e));
  } catch { return false; }
};
function projectOf(f) {
  const parts = f.replace(/\\/g, '/').split('/');
  if (parts.length < 2) return null;
  if (parts.length >= 3 && /^(apps|libs|packages|projects|services|modules)$/i.test(parts[0])) return parts[1];
  return ownsManifest(parts[0]) ? parts[0] : null;
}
// The projects a PUBLISH is taking out: the commits ahead of upstream, not the working tree (a
// push's spec already draws that distinction). Docs-root files are excluded the same way
// commitSet() excludes them - the receipt lives there and names no project of its own.
// A FIRST push has no upstream to diff against, and the scope check read no project at all (audit 2026-10-08): its
// commits are the ones no remote branch holds yet.
function pushTouchedProjects() {
  let files = [];
  try { files = git('diff @{u}..HEAD --name-only').split('\n').filter(Boolean); }
  catch {
    try { files = git('log --name-only --format= HEAD --not --remotes').split('\n').filter(Boolean); } catch { files = []; }
  }
  const pre = docsPrefix();
  const out = new Set();
  for (const f of files) {
    if (pre && f.replace(/\\/g, '/').startsWith(pre)) continue;
    const p = projectOf(f);
    if (p) out.add(p);
  }
  return [...out];
}

const docsRoot = docsRootEnv();
// 2.8.0: every receipt lives in <data root>/state/approvals/ (layout.js); the pre-2.8.0 flow/ one a 2.7.0 skill copy writes
// is still read for the 2.x line, and is the only path when layout.js is not beside this file. A read takes the new file,
// else the old one; a denial says to write the new one.
const receiptRead = (name) => (layout ? layout.findState(root, 'approvals', name) : path.resolve(root, docsRoot, 'flow', name));
const receiptWrite = (name) => (layout ? layout.statePath(root, 'approvals', name) : path.resolve(root, docsRoot, 'flow', name));
// What an act never commits, as prefixes relative to the repo top `top` (each only when inside it): the docs root, and from
// 2.8.0 the data root's state/ and statistics/ - the receipt is written into state/approvals/ moments before the act, and
// counting it would inflate the trivial bar and the spec: check (git ignores both through the data root's .gitignore, which
// a repo set up by hand may lack).
function ownPrefixes(top) {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const base = real(root);
  const dirs = [path.resolve(base, docsRootEnv())];
  if (layout) dirs.push(path.resolve(base, layout.dataRoot(), 'state'), path.resolve(base, layout.dataRoot(), 'statistics'));
  return dirs.map((d) => path.relative(top, real(d)).split(path.sep).join('/'))
    .filter((r) => r && r !== '..' && !r.startsWith('../') && !path.isAbsolute(r)).map((r) => `${r}/`);
}
const MAX_RECEIPT_AGE_MS = 2 * 60 * 60 * 1000; // 2h - the gate runs right before the act; re-stamping is one Write
// The RECEIPT CONTRACT. Every clause here was bought with a receipt that passed the gate and
// recorded nothing: `authorized: "what time is it?"` exit 0, `authorized: ""` exit 0 - the only
// discriminator the first version applied was the presence of a quote character.
//   auth   - the quoted span must be non-empty AND carry a consent verb. A question, a filename or
//            an empty pair of quotes is not somebody asking for this commit.
//   label  - a span CHARACTER-IDENTICAL to an option label in this transcript is the MODEL's own
//            words, not the user's (measured: `authorized: "Commit now (Recommended)"`, marker and
//            all, prescribed by a skill while the denial text demanded 'their words, verbatim').
//            Consent given by picking an option has its own spelling: `answered: <label>`.
//   head   - the review covered a TREE. Without the sha, a receipt written before three more edits
//            landed still reads as this diff's review.
//   spec   - and it covered a SET of files: one measured receipt asserted a review of a 17-file diff
//            in which 9 files had been read.
//   probe  - a VERIFIED line that names a review must carry its live-probe result: one receipt
//            asserted a passing review with no build/test output and no probe at all. Spelled
//            case-insensitively with an optional hyphen or space - `live probe = ...` is conformant.
//   scope  - and a PUSH whose probe ran something must say what it covered: `workspace` (or the
//            project list it ran). One project's narrow test run passed both gates once, CI broke
//            right after the push, and 6.4M tokens of triage followed. Required only when the
//            commit set going out touches more than one identifiable project - a docs-only or
//            single-project push names nothing extra.
//   security- a VERIFIED line that claims a security review must carry a `security:` line naming
//            the categories checked (auth, secrets, injection, data-access, ...) - the honesty rule
//            alfred-security.md sets. Twice measured: a receipt read 'inline security review (0
//            findings)' with zero category text anywhere in the turn.
//   carried- a stamp minted from a carried resume block says so, or the freshness check is
//            silently satisfied by a re-mint of a 9h30m-old answer.
// A PENDING draft placeholder matches the bare prefix, so the prefix alone is never the test
// (measured: a PENDING draft sat gate-passing for ~2 minutes).
const CONSENT_VERB = /\b(commit|commits|committing|push|pushes|pushing|land|lands|landing|ship|ships|shipping|merge|merges|merging|publish|publishes|publishing|release|releases|releasing|go ahead|do it|approve[ds]?|yes)\b/i;
// A WAIVED quote names the review it skips (audit 2026-10-08): skip / waive, without or no review / check / tests, 'just
// <act>', 'anyway', 'as is'.
const WAIVER_WORDS = /\b(?:skip|skips|skipping|skipped|waive[sd]?|waiving|anyway|regardless|as[\s-]is|without\s+(?:the\s+|a\s+|any\s+)?(?:review|check|verification|verify|tests?|testing|probe)|no\s+(?:review|check|verification|tests?|probe)|(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:review|check|verify|test)|just\s+(?:commit|push|merge|ship|land|publish|release|do\s+it|go))\b/i;
// Opening a pull request asks for the publish under it (2.1.6 H3): the checkpoint skill fires on 'open the PR', and the
// user's own words were refused as consent. The verb and the PR noun count only together - a bare 'PR' or 'look at the
// PR' asks for nothing - and only as an ask (review m1 / m2): the verb opens, creates, raises or submits the PR ('make'
// and 'file' edit one), 'up' may follow it and one word may sit before the noun ('open up a draft PR'), no question or
// negation leads it ('did you', 'never'), and the noun is not followed by what is ABOUT the PR (its description,
// template, comment, review, title, body, link or page) or by 'in the browser'.
const CONSENT_PR = /(?<!\b(?:did|didn't|do|does|don't|never|not|no)\s+(?:you\s+|we\s+|i\s+)?)\b(?:open|opens|opening|create|creates|creating|raise|raises|raising|submit|submits|submitting)(?:\s+up)?\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+)?(?:PR|pull[\s-]?request)s?\b(?!\s+(?:description|template|comment|review|title|body|link|page)s?\b|\s+in\s+(?:the\s+)?browser\b)/i;
// A quote is read to its OWN closing mark: an apostrophe inside double quotes ("let's open a PR", "don't push") is text,
// not the end (review re-verify N3). Consent is then read per CLAUSE and per GATE (re-verify 2 R2-M3: a deferral
// anywhere refused 'commit now, push later', a clause ran across ' - ' and 'but', and 'push is not needed', 'stop
// committing', 'why did you push?' and 'hold the commit' read as consent):
//   - a clause ends at . ! ? ; , :, a spaced dash, or 'but / then';
//   - positive idioms are blanked first ('don't forget to', 'no need to', 'no problem', 'never mind');
//   - a consent verb is refused by a negation before it in its clause, 'stop / hold / wait with' right before it, a
//     negation right after it ('is not needed'), a deferral in its own clause ('later', 'tomorrow', 'after I'), a next
//     clause that only answers no ('open a PR? not yet'), or the user keeping the act ('I will push it myself');
//   - a verb after an article or a possessive is a noun ('the commit message') unless an act verb leads it ('do the
//     commit'), a noun followed by a state is a statement ('commit is broken'), a why / who / 'did you' clause asks
//     nothing;
//   - a bare answer word closing the verb's clause refuses it ('commit yes, push no' - re-verify 3 R3-M1);
//   - a publish conditioned on CI ('push after CI', 'when CI is green') consents to nothing now: CI runs on the push;
//   - a refused verb of the gate's OWN class refuses that gate ('commit it, don't push' opens the commit, not the
//     push);
//   - each gate consents on its OWN act (re-verify 3 R3-M1: 'commit it' in a PUSH-GATE receipt published): the
//     COMMIT-GATE on any act verb left standing (a push takes the commit with it), the PUSH-GATE on a publish verb or
//     a PR opened, and a generic yes ('go ahead', 'yes') counts for a gate only when the quote names no act
//     of the other class ('go ahead and commit' consents to no push);
//   - a quote past 1,000 characters is no answer (R3-m10), and each clause is found by a binary search over the
//     sorted clause bounds, so the reader stays linear in the quote;
//   - ENGLISH ONLY (deep hooks review 2026-10-16, the user's ruling): a quote holding any letter outside ASCII is no
//     consent - the Ukrainian lists it replaced read 'committed it, don't push' and 'I committed the changes, check them'
//     (written in Ukrainian) as consent. The denial says to ask instead: a picked option is `answered: <label>`,
//     whatever language the user answered in.
const QUOTED = /"([^"\n]*)"|“([^”\n]*)”|'([^'\n]*)'|‘([^’\n]*)’/;
const CLAUSE_END = /[.!?;,:]|\s[-\u2013\u2014]\s|\s(?:but|then)\s/gi;
const POSITIVE_IDIOM = /\b(?:don'?t forget(?: to)?|no (?:need|problem|issues?|worries|rush)(?: to \w+)?|never mind|not sure [^,.;]*? but|(?:i )?don'?t mind)\b/gi;
const NEGATION_BEFORE = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|won'?t|shouldn'?t|can'?t|cannot|without)\b/i;
const STOP_BEFORE = /\b(?:stop|quit|hold off(?: on)?|hold|wait with|wait on)\s+(?:(?:the|with the)\s+)?$/i;
const BARE_NO_AFTER = /^[^\p{L}\p{N}]*(?:no|nope)[^\p{L}\p{N}]*$/iu;
const NEGATION_AFTER = /^[^\p{L}\p{N}]*(?:[\p{L}'-]+\s+){0,2}?(?:is(?:n'?t| not)|are(?:n'?t| not)|was(?:n'?t| not)|not (?:needed|necessary|required|now|yet|today)|would be a mistake)(?!\p{L})/iu;
const STATEMENT_AFTER = /^\s+(?:is|was|are|were|has been|looks|seems)\s+(?!(?:fine|ok|okay|good|allowed|approved|welcome|alright|all right|safe)\b)/i;
const DEFERRAL_CLAUSE = /\b(?:not yet|not now|later|hold off|tomorrow|after (?:i|you|we)\b|once (?:i|you)\b|when i\b)/i;
// A wait on CI defers a push, a publish, a release or a ship, but not a MERGE: 'merge it once CI is green' is the ordinary
// way to ask for the merge CI gates (2.1.6 re-verify 4 R4-m1).
const CI_DEFERRAL = /\b(?:after|once|when|until|till|as soon as) (?:the )?(?:ci|checks?|pipeline)\b/i;
const MERGE_VERB = /^merge/i;
const USER_KEEPS = /\bmyself\b/i;
const NOUN_BEFORE = /\b(?:the|a|an|this|that|my|your|its|our|last|first|previous|next)\s+$/i;
const ACT_BEFORE = /\b(?:do|make|create|go ahead with|proceed with|run|finish|approve)\s+(?:the|a|an|this|that|your)\s+$/i;
const WHY_CLAUSE = /^\s*(?:why|who|did you|have you|what)\b/i;
const ANSWERED_NO = /^[^\p{L}\p{N}]*(?:no|nope|not yet|not now|later)[^\p{L}\p{N}]*$/iu;
const CLASS_COMMIT = /^(?:commit|land)/i;
const CLASS_PUSH = /^(?:push|publish|release|ship|merge|land)|\bPR\b|pull|^(?:open|create|raise|submit)/i;
const GENERIC_CONSENT = /^(?:go ahead|do it|approve[ds]?|yes)/i;
const CONSENT_QUOTE_CAP = 1000;
// The first bound past `i` in the sorted bounds, by binary search.
function boundAfter(bounds, i) {
  let lo = 0;
  let hi = bounds.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bounds[mid] <= i) lo = mid + 1; else hi = mid; }
  return lo;
}
// A quote holding any letter outside ASCII: the lists cannot read it, so it is no consent (the header, ENGLISH ONLY).
const foreignQuote = (text) => /[^\x00-\x7f]/.test(String(text).replace(/[^\p{L}]/gu, ''));
const FOREIGN_HINT = ' - the gate reads a quote in English only; ask with AskUserQuestion (English labels) and write the picked option as `answered: <the chosen label>`';
function consentIn(text, gate) {
  if (text.length > CONSENT_QUOTE_CAP || foreignQuote(text)) return false;
  const clean = text.replace(POSITIVE_IDIOM, (m) => ' '.repeat(m.length));
  const bounds = [0];
  for (const b of clean.matchAll(CLAUSE_END)) bounds.push(b.index + b[0].length);
  bounds.push(clean.length + 1);
  const clauseOf = (i) => {
    const k = boundAfter(bounds, i);
    return [bounds[k - 1] || 0, Math.min(k < bounds.length ? bounds[k] : clean.length, clean.length)];
  };
  const own = gate === 'PUSH-GATE' ? CLASS_PUSH : CLASS_COMMIT;
  let ownHit = false;
  let otherHit = false;
  let genericHit = false;
  for (const re of [CONSENT_VERB, CONSENT_PR]) {
    for (const m of clean.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
      const [a, z] = clauseOf(m.index);
      const clause = clean.slice(a, z);
      const before = clean.slice(a, m.index);
      const after = clean.slice(m.index + m[0].length, z);
      if ((NOUN_BEFORE.test(before) && !ACT_BEFORE.test(before)) || WHY_CLAUSE.test(clause)) continue;
      const nk = boundAfter(bounds, z);
      const nextEnd = nk < bounds.length ? bounds[nk] : undefined;
      const answeredNo = nextEnd !== undefined && ANSWERED_NO.test(clean.slice(z, nextEnd));
      const negated = answeredNo || NEGATION_BEFORE.test(before) || STOP_BEFORE.test(before) || NEGATION_AFTER.test(after)
        || BARE_NO_AFTER.test(after) || DEFERRAL_CLAUSE.test(clause) || (CI_DEFERRAL.test(clause) && !MERGE_VERB.test(m[0].trim())) || USER_KEEPS.test(clause);
      const word = m[0].trim();
      if (negated && own.test(word)) return false;
      if (negated || STATEMENT_AFTER.test(after)) continue;
      if (GENERIC_CONSENT.test(word)) genericHit = true;
      else if (gate !== 'PUSH-GATE' || CLASS_PUSH.test(word)) ownHit = true;
      else otherHit = true;
    }
  }
  return ownHit || (genericHit && !otherHit);
}

// The SESSION's transcript, streamed once and shared by the checks that need it. A fixed 256KB tail missed a verify
// Skill call 265KB-1.33MB back and told three sessions 'no Skill call ran in this session' (audit 2026-10-10, sessions
// 229e2715, 84eedb4b x2, 9a4ef375); a receipt's evidence can sit anywhere in the session, so the whole file is read, line
// by line, newest 64MB at most (a work count, never time). One pass collects what the checks ask: whether a Skill ran,
// every AskUserQuestion option label the assistant wrote, and the user's own typed turns.
const TRANSCRIPT_SCAN_MAX = 64 * 1024 * 1024;
// A skill's bare name, a review's kind whatever its spelling, and the words that make a skill or a seat a review live in
// hook-prelude.js since 2026-10-22, shared with the session-start guard that snapshots a review this guard judges. With
// the prelude missing, or older than this hook, no review is seen - every check that needs one refuses, a carried review
// or the user's waiver still passes - where a throwing load let every commit and push through (the dispatcher fails a
// throwing guard open; review 2026-10-23).
const reviewWords = (() => { try { return require('./hook-prelude.js'); } catch { return {}; } })();
const NEVER = /(?!)/;
const bareSkill = reviewWords.bareSkill || ((s) => String(s || '').trim().toLowerCase().replace(/^[\w-]+:/, '').replace(/^alfred-/, ''));
const reviewKind = reviewWords.reviewKind || (() => null);
const REVIEW_SKILL = reviewWords.REVIEW_SKILL || NEVER;
const REVIEW_SEAT = reviewWords.REVIEW_SEAT || NEVER;
const reviewTargets = reviewWords.reviewTargets || (() => []);
const reviewCovers = reviewWords.reviewCovers || (() => false);
const briefTargets = reviewWords.briefTargets || (() => []);
const REVIEW_PROOF = reviewWords.REVIEW_PROOF || { findings: NEVER, outcome: NEVER };
const reviewProof = reviewWords.reviewProof || (() => 'findings');
const readReviewSnapshots = reviewWords.readReviewSnapshots || (() => []);
const heldByReview = reviewWords.heldByReview || (() => false);
const normQuote = (t) => String(t).replace(/\s*\(recommended\)\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
let _scan;
function transcriptScan() {
  if (_scan) return _scan;
  // ran: the bare name of every skill run - the model's Skill call or the user's typed slash command; reviews: when each
  // review started (ms); reviewSeat: a verifier or reviewer seat reported; codeReviews: when each review of the CODE
  // started (the plan review left out) and what it covered (null: the whole change); answers: each AskUserQuestion
  // answer, its labels and when it landed; done: the tool_use ids of the review calls that counted; typedDone: when each
  // typed review that counted started.
  _scan = { ran: new Set(), labels: new Set(), typed: [], reviews: [], reviewSeat: false, codeReviews: [], answers: [], refused: new Set(),
    done: new Set(), typedDone: [] };
  const tp = payload.transcript_path;
  if (!tp) return _scan;
  // A Skill or seat call counts once the scan is done, and only when its result was no error: a call another hook
  // refused, or a skill that does not exist, still leaves its tool_use row (a fifth side note, 2026-10-22: the
  // fresh-session gate refused review-code late in a session, and that call passed for the review). A review SEAT counts
  // only once it reported (a seventh side note; the user's ruling 'Seats must finish', 2026-10-22): a foreground seat's
  // result row is its report; a background one's is a launch notice (`toolUseResult.status: async_launched`), so it
  // counts at its `<task-notification>` naming its `<tool-use-id>` with `<status>completed</status>`. A review SKILL, the
  // model's call or the user's typed command, counts once its result line followed it (the user's 'Fix ALL left gaps',
  // 2026-10-22: a Skill review counted once it launched) - hook-prelude.js REVIEW_PROOF, in the model's own text or in the
  // report of a seat dispatched after the call (review-code and review-security hand a large change to one).
  const calls = [];
  const proofs = [];
  const seatIds = new Set();
  const seatDone = new Set();
  const agentAt = new Map();
  const proofsIn = (text, at, after = 0) => {
    for (const [kind, re] of Object.entries(REVIEW_PROOF)) if (re.test(text)) proofs.push({ at, kind, after });
  };
  const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n') : '');
  let rowNo = 0;
  let fd;
  try {
    const size = fs.statSync(tp).size;
    fd = fs.openSync(tp, 'r');
    let pos = Math.max(0, size - TRANSCRIPT_SCAN_MAX);
    let carry = pos > 0 ? null : '';
    const CHUNK = 4 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK);
    const tsOf = (row) => { const t = Date.parse(row && row.timestamp); return Number.isFinite(t) ? t : 0; };
    const onLine = (line) => {
      // each row's place in the transcript, a block's place inside its row
      const at = ++rowNo * 1000;
      if (line.length < 1024 * 1024 && (/"name"\s*:\s*"(?:Skill|Agent|Task)"/.test(line) || line.includes('"answers"')
        || (/"type"\s*:\s*"assistant"/.test(line) && /Findings|Outcome/.test(line)))) {
        let row = null;
        try { row = JSON.parse(line); } catch { row = null; }
        const c = row && row.message && row.message.content;
        if (row && row.type === 'assistant' && Array.isArray(c)) {
          c.forEach((b, i) => {
            if (!b) return;
            if (b.type === 'text' && typeof b.text === 'string') proofsIn(b.text, at + i);
            if (b.type !== 'tool_use' || !b.input) return;
            if (/^(?:Agent|Task)$/.test(b.name) && b.id) agentAt.set(String(b.id), at + i);
            const named = b.name === 'Skill' ? String(b.input.skill || b.input.command || '') : /^(?:Agent|Task)$/.test(b.name) ? String(b.input.subagent_type || '') : '';
            if (!named) return;
            const ts = tsOf(row);
            const base = row.cwd || projectDir || root;
            const seat = b.name !== 'Skill' && REVIEW_SEAT.test(named);
            const review = b.name === 'Skill' && REVIEW_SKILL.test(named.trim()) ? reviewKind(named) : null;
            if (seat && b.id) seatIds.add(String(b.id));
            calls.push({ id: b.id ? String(b.id) : '', at: at + i, seat, review, apply: () => {
              if (b.name === 'Skill') _scan.ran.add(bareSkill(named));
              if (seat) { _scan.reviews.push(ts); _scan.reviewSeat = true; _scan.codeReviews.push({ ts, targets: briefTargets(b.input.prompt, base) }); }
              if (review) _scan.reviews.push(ts);
              if (review && review !== 'verify-plan') _scan.codeReviews.push({ ts, targets: reviewTargets(named, b.input.args, base) });
            } });
          });
        }
        const answers = row && row.toolUseResult && row.toolUseResult.answers;
        if (answers && typeof answers === 'object') {
          const labels = [];
          for (const a of Object.values(answers)) for (const one of [a, ...String(a).split(/,\s*/)]) if (normQuote(one)) labels.push(normQuote(one));
          if (labels.length) _scan.answers.push({ ts: tsOf(row), labels, text: Object.values(answers).map(String).join(', ') });
        }
      }
      // a seat's own result: a review seat's report, unless it is a background seat's launch notice (a report past 1MB
      // is no notice), and any seat's report may carry a Skill review's result line
      if (agentAt.size && line.includes('"tool_result"')) {
        for (const id of new Set([...line.matchAll(/"tool_use_id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))) {
          const sentAt = agentAt.get(id);
          if (sentAt === undefined) continue;
          if (line.length >= 1024 * 1024) { if (seatIds.has(id)) seatDone.add(id); continue; }
          let row = null;
          try { row = JSON.parse(line); } catch { row = null; }
          const c = row && row.message && row.message.content;
          const own = Array.isArray(c) && c.find((x) => x && x.type === 'tool_result' && String(x.tool_use_id) === id);
          if (!own || own.is_error === true) continue;
          const text = textOf(own.content);
          if ((row.toolUseResult && row.toolUseResult.status === 'async_launched') || /^\s*Async agent launched/.test(text)) continue;
          if (seatIds.has(id)) seatDone.add(id);
          proofsIn(text, at, sentAt);
        }
      }
      // a background seat's completion, and the report it carries
      if (agentAt.size && line.includes('<task-notification>')) {
        let text = line;
        if (line.length < 1024 * 1024) {
          try { const row = JSON.parse(line); text = textOf(row && row.message && row.message.content) || line; } catch { text = line; }
        }
        for (const [block] of text.matchAll(/<task-notification>[\s\S]*?(?:<\/task-notification>|$)/g)) {
          const id = (/<tool-use-id>([^<]+)<\/tool-use-id>/.exec(block) || [])[1];
          if (!id || !agentAt.has(id) || (/<status>([a-z_]+)<\/status>/.exec(block) || [])[1] !== 'completed') continue;
          if (seatIds.has(id)) seatDone.add(id);
          if (text !== line) proofsIn(block, at, agentAt.get(id));
        }
      }
      // a call's error result: the call never ran (an error result is short; a longer row is a seat's report)
      if (line.includes('"tool_result"') && /"is_error"\s*:\s*true/.test(line) && line.length < 1024 * 1024) {
        let row = null;
        try { row = JSON.parse(line); } catch { row = null; }
        const c = row && row.message && row.message.content;
        if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result' && b.is_error === true && b.tool_use_id) _scan.refused.add(String(b.tool_use_id));
      }
      if (line.includes('"label"')) {
        for (const m of line.matchAll(/"label"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
          let lbl;
          try { lbl = JSON.parse(`"${m[1]}"`); } catch { lbl = m[1]; }
          _scan.labels.add(normQuote(lbl));
        }
      }
      // A turn the user TYPED: a user row whose content is text, never a tool_result (an ask's answer is the
      // harness's row) and never a meta row (a skill body, a command expansion).
      if (/"type"\s*:\s*"user"/.test(line) && !line.includes('"tool_result"') && line.length < 256 * 1024) {
        let row;
        try { row = JSON.parse(line); } catch { return; }
        if (!row || row.type !== 'user' || row.isMeta) return;
        const text = textOf(row.message && row.message.content);
        if (text && !/^\s*<(?:command-name|local-command|bash-|task-notification)/.test(text)) _scan.typed.push(normQuote(text));
        // a review the user TYPED as a slash command is a review run too, once its result line followed it
        const typedSkill = /<command-name>\/?([\w:-]+)<\/command-name>/.exec(text);
        if (typedSkill && REVIEW_SKILL.test(typedSkill[1])) {
          const name = typedSkill[1];
          const ts = tsOf(row);
          const review = reviewKind(name);
          const typedArgs = (/<command-args>([\s\S]*?)<\/command-args>/.exec(text) || [])[1];
          const base = row.cwd || projectDir || root;
          calls.push({ id: '', at, seat: false, review, apply: () => {
            _scan.ran.add(bareSkill(name));
            _scan.reviews.push(ts);
            _scan.typedDone.push(ts);
            if (review !== 'verify-plan') _scan.codeReviews.push({ ts, targets: reviewTargets(name, typedArgs, base) });
          } });
        } else if (typedSkill) _scan.ran.add(bareSkill(typedSkill[1]));
      }
    };
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = buf.toString('utf8', 0, n);
      const lines = text.split('\n');
      // the first line of a cut-in read is a torn row - dropped
      if (carry === null) { lines.shift(); carry = ''; }
      lines[0] = carry + lines[0];
      carry = lines.pop();
      for (const l of lines) onLine(l);
    }
    if (carry) onLine(carry);
  } catch { /* unreadable: nothing more collected */ }
  try { if (fd !== undefined) fs.closeSync(fd); } catch { /* closed */ }
  // Each result line closes the NEWEST open review when it is that review's kind, and nothing otherwise: a review left
  // unfinished stays open under a later one, and a loop's verifier reporting Findings closes no review-code before it.
  // A seat's report closes only a review started before the seat was sent.
  const reviewCalls = calls.filter((k) => k.review && !(k.id && _scan.refused.has(k.id)));
  const open = [];
  const proven = new Set();
  const events = [...reviewCalls.map((k) => ({ at: k.at, call: k })), ...proofs.map((p) => ({ at: p.at, proof: p }))].sort((a, b) => a.at - b.at);
  for (const e of events) {
    if (e.call) { open.push(e.call); continue; }
    const top = open[open.length - 1];
    if (top && reviewProof(top.review) === e.proof.kind && (!e.proof.after || e.proof.after > top.at)) proven.add(open.pop());
  }
  for (const k of calls) {
    if (k.id && _scan.refused.has(k.id)) continue;
    if (k.seat && !seatDone.has(k.id)) continue;   // a seat still running, or one whose result is not on record
    if (k.review && !proven.has(k)) continue;      // a review skill with no result line yet
    if (k.id) _scan.done.add(k.id);
    k.apply();
  }
  return _scan;
}
// Is this exact string one of the assistant's own AskUserQuestion option labels? Compared with the
// `(Recommended)` marker STRIPPED, because the harness stores the marked label as the user's answer
// (correction 3) - so the marker's presence proves nothing either way. A quote the user TYPED in a turn of
// their own is their words even when a label spells it too (audit 2026-10-10, session f24eb967: the user typed
// 'commit and push' after an ask had offered 'Commit and push', and the receipt quoting it was refused).
function isOwnOptionLabel(span) {
  const want = normQuote(span);
  if (!want) return false;
  const s = transcriptScan();
  if (!s.labels.has(want)) return false;
  return !s.typed.some((t) => t.includes(want));
}
// The session's latest ask answer, for a denial that names what the receipt should carry: a receipt quoted the user's
// typo ('commit and oush to develop') while the picked option sat in the transcript (audit 2026-10-10, session bda299a8).
function answerHint() {
  const a = transcriptScan().answers;
  if (!a.length) return '';
  const last = a[a.length - 1].text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return ` - this session's latest ask was answered "${last}"; a picked option is written \`answered: ${last}\``;
}
// A waiver given by picking an option (deep hooks review 2026-10-16: with a non-English quote no consent, a user who answers
// in another language waives through a click): `WAIVED - answered: <label>`, `format: skipped - answered: <label>`. Null when
// the line names no answered: label; else { problem } - empty when the label skips the review in WAIVER_WORDS, an ask
// THIS session answered carries it, and someone is at the terminal (under auto-mode the Recommended option answers itself,
// and a skipped review is never the run's own call).
function answeredWaiver(line) {
  const m = /\banswered:\s*(.+)$/i.exec(String(line || ''));
  if (!m) return null;
  const label = m[1].trim();
  if (!WAIVER_WORDS.test(label)) return { problem: `the answered: waiver (${JSON.stringify(label).slice(0, 60)}) skips no review - its label names the skip ('Skip the review and commit')` };
  if (!answeredAt(label)) return { problem: `the answered: waiver (${JSON.stringify(label).slice(0, 60)}) matches no ask answered in this session${answerHint()}` };
  let nobody = false;
  try { nobody = require('./hook-prelude.js').unattended(payload); } catch { nobody = false; }
  if (nobody) return { problem: 'the answered: waiver was given while nobody is at the terminal (auto-mode answers its own Recommended option) - a skipped review needs the user' };
  return { problem: null };
}
// When the latest answer carrying `label` landed, or 0 when no answer carries it.
function answeredAt(label) {
  const want = normQuote(String(label).replace(/^option\s+\d+\s*/i, '').replace(/["'\u201c\u2018\u201d\u2019]/g, ''));
  let at = 0;
  for (const a of transcriptScan().answers) if (a.ts > at && a.labels.includes(want)) at = a.ts;
  return at;
}

// Which skills ran in THIS session, by bare name, is the whole-session transcript scan's to say: the model's Skill call,
// or the harness's `<command-name>` row a skill the user TYPED leaves (measured: slash-run loops, zero Skill events). Only
// the NAME proves a review: any skill load once passed for one, so a receipt could claim a review that never ran
// (2026-10-22). The tool-usage ledger is no evidence (the user's 'Fix ALL left gaps', 2026-10-22): its row is written at
// PreToolUse and carries no target, no result and no refusal, so a review past the transcript scan is a review to run again.
// The reviews a VERIFIED line names, and of those the ones no run in this session meets, both sides read by kind -
// `verify-code` is met by `task-verify-code`, never by another skill.
const REVIEW_NAMED_RE = /(?<![\w-])[\w-]*?(?:verify-(?:code|plan)|quality-loop|coverage-loop|loop-(?:quality|code-quality|architecture-quality|test-coverage)|review-(?:code|security))(?![\w-])/gi;
// a name with no kind is none: a prelude without the review words gives every name null, and null matched null (review 2026-10-23)
const reviewsNamed = (line) => [...new Set([...String(line).matchAll(REVIEW_NAMED_RE)].map((m) => reviewKind(m[0])).filter(Boolean))];
function reviewsNotRun(line) {
  const named = reviewsNamed(line);
  if (!named.length) return [];
  const ran = new Set([...transcriptScan().ran].map(reviewKind));
  return named.filter((n) => !ran.has(n));
}
// Did ANY review of the code run in this session: a review skill (the model's call or the user's typed command - a plan
// review reads no code, so verify-plan alone is none) or a verifier / reviewer seat.
function codeReviewRan() {
  const s = transcriptScan();
  if (s.reviewSeat) return true;
  return [...s.ran].some((n) => { const k = reviewKind(n); return k !== 'verify-plan' && reviewsNamed(k).length > 0; });
}
// The reviews of the code this session ran that carry a time, each with what it covered (null: the whole change).
function timedCodeReviews() {
  return transcriptScan().codeReviews.filter((r) => r.ts > 0);
}
// When the newest review of the code in this session started (ms) - 0 when none carries a time, which judges nothing.
function lastCodeReviewMs() {
  const times = timedCodeReviews().map((r) => r.ts);
  return times.length ? Math.max(...times) : 0;
}
// The files this commit takes in that changed after the newest review COVERING each started, or that no review covered
// - a version no review saw (2026-10-22, a side agent's note; the user's ruling 'After the last edit'; a review pointed at
// paths covers those alone, the ruling 'Match path targets'), each as { rel, at }. The 2s slack is the receipt check's.
// A file gone from the tree whose index still stages a version of its own is late whatever the times say: that version is
// committed and its time is unknown (a staged removal commits no content and is skipped). A file a review's snapshot saw
// with the content it holds now passes whatever its time says: a stash and pop or a branch round-trip moved the time,
// not the code (a third side note; the user's ruling 'Snapshot at review' - hook-prelude.js snapshotReview).
function editedAfterReview() {
  const set = commitSet();
  let top = set.top;
  try { top = fs.realpathSync.native(set.top); } catch { /* the path as git gave it */ }
  const reviews = timedCodeReviews();
  const late = [];
  for (const rel of [...set.tracked.keys(), ...set.untracked]) {
    const abs = path.join(top, rel);
    let changed;
    try { changed = fs.statSync(abs).mtimeMs; } catch {
      if (!stagedBlob(top, rel)) continue;
      changed = Infinity;
    }
    const at = Math.max(0, ...reviews.filter((r) => reviewCovers(r.targets, abs)).map((r) => r.ts));
    if (!at || changed > at + 2000) late.push({ rel, at });
  }
  if (!late.length) return late;
  // only a snapshot whose call counted vouches: a refused or unfinished call's does not, and one taken for a typed
  // review (no call id) counts beside a typed review that counted, started within two minutes of it
  const { done, typedDone } = transcriptScan();
  const snaps = readReviewSnapshots(projectDir || root, payload.session_id)
    .filter((r) => (r.id ? done.has(String(r.id)) : typedDone.some((t) => Math.abs(t - Number(r.ts)) <= 120000)));
  return late.filter((f) => {
    const versions = versionsCommitted(top, f.rel);
    return !(versions.length && versions.every((v) => heldByReview(snaps, path.join(top, f.rel), v)));
  });
}
// The version of `rel` the index stages when it differs from HEAD's, or null - none of its own, or a staged removal.
function stagedBlob(top, rel) {
  const run = (args) => execFileSync(...gitSafe(args, { cwd: top, timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  try { run(['diff', '--cached', '--quiet', '--', `:(literal)${rel}`]); return null; } catch { /* the index stages a version */ }
  try { return run(['cat-file', 'blob', `:0:${rel}`]); } catch { return null; }
}
// The versions of `rel` the commit may take in: the work tree's, and the index's as well when it stages one of its own -
// a plain commit takes the index, `-a`, a named path or a chained add the tree - so a file the two differ on passes the
// snapshot only when a review saw both (2026-10-22: the snapshot read the tree alone, so staging an unreviewed version
// and putting the reviewed text back in the tree passed).
function versionsCommitted(top, rel) {
  const out = [];
  try { out.push(fs.readFileSync(path.join(top, rel))); } catch { /* not in the tree */ }
  const staged = stagedBlob(top, rel);
  if (staged && (!out.length || !staged.equals(out[0]))) out.push(staged);
  return out;
}

// The paths a spec: line names (`spec: 2 files - src/a.cs, src/b.cs`), as written: a word carrying a `/` or a file
// extension. A count-only spec (`spec: 3 files - the fixtures`) names none.
function specPaths(spec) {
  return String(spec || '').split(/[\s,;()]+/).map((w) => w.replace(/^[`'"]+|[`'".:]+$/g, ''))
    .filter((w) => w && !/^\d+$/.test(w) && (/[\w*-]\/[\w*.-]|\/$/.test(w) || /^[\w.*-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(w)));
}
// Why a head: that names an ANCESTOR of HEAD does not cover this act - or null when it does: no merge since it (a
// merge brings in work no review saw), every commit since it made after the receipt was written (under this review,
// never one that was already there), and every file those commits and this act take in inside the reviewed set - the
// paths spec: names, or, when it gives only a count, no more files than that count.
function batchProblem(h, spec, opts) {
  const top = gitTop || root;
  const run = (args) => execFileSync(...gitSafe(['-c', 'core.quotePath=false', ...args], { cwd: top, timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).toString('utf8');
  const different = 'the review ran against a different commit';
  try { run(['merge-base', '--is-ancestor', h, 'HEAD']); } catch { return different; }
  const fresh = 'review the tree as it stands and write head: as the output of git rev-parse HEAD';
  const files = new Set();
  try {
    if (run(['rev-list', '--merges', `${h}..HEAD`]).trim()) return `a merge landed since it and brings in work the review never saw - ${fresh}`;
    const floor = opts && opts.receiptMtimeMs ? Math.floor(opts.receiptMtimeMs / 1000) - 2 : 0;
    if (floor && run(['log', '--format=%ct', `${h}..HEAD`]).split('\n').some((t) => t && Number(t) < floor)) {
      return `a commit since it was made before this receipt was written, so the review never covered it - ${fresh}`;
    }
    for (const f of run(['diff', '--name-only', '-z', h, 'HEAD']).split('\0')) if (f) files.add(f);
  } catch { return different; }
  if (opts && opts.countAgainstTree) {
    try { const s = commitSet(); for (const f of s.tracked.keys()) files.add(f); for (const f of s.untracked) files.add(f); } catch { /* unborn or unreadable: the commits alone */ }
  }
  const own = ownPrefixes(top);
  for (const f of [...files]) if (own.some((p) => f.startsWith(p))) files.delete(f);
  const listed = specPaths(spec);
  const count = /(\d+)\s*files?\b/i.exec(String(spec || ''));
  if (listed.length && (!count || listed.length >= Number(count[1]))) {
    const covered = (f) => listed.some((p) => p === f || (p.endsWith('/') && f.startsWith(p)) || f.endsWith(`/${p}`));
    const outside = [...files].filter((f) => !covered(f));
    return outside.length ? `the commits since it and this act take in ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', ...' : ''}, which spec: never names - ${fresh}` : null;
  }
  if (!count) return `${different} - a receipt covering a batch of commits names its reviewed set in spec: (<N> files, or the paths)`;
  if (files.size > Number(count[1])) return `the commits since it plus this act take in ${files.size} files, more than the ${count[1]} its spec: covered - ${fresh}`;
  return null;
}

// One judge, two routes. The receipt written as its own file and the receipt written inside the
// same command as the act are the SAME document, so they answer to the same contract - otherwise
// the atomic shape (which this gate accepts by design) is a hole straight through every clause.
function judgeReceipt(body, opts) {
  // A receipt written through `printf` carries LITERAL backslash-n, not newlines.
  const text = String(body).replace(/\\n/g, '\n');
  // The verdict token, and the rest of ITS line. Anchoring to the start of a line read the atomic
  // shape as having no verdict at all, because there the line begins `printf 'VERIFIED ...`.
  const first = ((/\b(VERIFIED|WAIVED)\b[^\n]*/i.exec(text) || [''])[0]).trim();
  // Fields are read by PREFIX from any line, not by line number: a receipt that carries its
  // head/spec lines in a different order is still a conformant receipt.
  // The key is a whole word: `head` never reads a `header:` line (audit 2026-10-08).
  const field = (key) => {
    const m = new RegExp(`^\\s*${key}\\b\\s*:?[ \\t]*(.*)$`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const waived = /^WAIVED\b/.test(first);
  const verified = /^VERIFIED\b/.test(first);
  const r = { waived, verified, problem: null };
  if (!waived && !verified) return r;
  const bodyText = text;

  const quotedOf = (line) => {
    if (line == null) return null;
    if (/\bPENDING\b/i.test(line)) return null;
    const m = QUOTED.exec(line);
    return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]).trim() : null;
  };
  const consents = (t) => consentIn(t, opts && opts.gate);

  if (waived) {
    const w = quotedOf(first);
    const picked = answeredWaiver(first);
    if (!w && picked) { if (picked.problem) r.problem = picked.problem; return r; }
    if (!w) r.problem = 'the WAIVED line carries no quoted words - a waiver is the user\'s own sentence, in quotes, on that line, or `answered: <the label they picked>`';
    else if (foreignQuote(w)) r.problem = `the WAIVED quote (${JSON.stringify(w).slice(0, 60)}) is not in English${FOREIGN_HINT}`;
    // Any quote passed (audit 2026-10-08: `WAIVED - "what time is it?"` exit 0), the hole the authorized: clause closed.
    // A waiver names the review it skips; a plain 'commit it' is an instruction to commit, never a waiver
    // (habits-commit-checkpoint), and an option label this run wrote is the model's sentence, not the user's.
    else if (!WAIVER_WORDS.test(w)) r.problem = `the WAIVED quote (${JSON.stringify(w).slice(0, 60)}) waives nothing - a waiver is the user's own words skipping the review ('skip the review', 'just push', 'commit it without the check'); an instruction to commit is no waiver`;
    else if (isOwnOptionLabel(w)) r.problem = 'the WAIVED quote is character-identical to an option label THIS run wrote - that is the model\'s sentence, not the user\'s waiver';
    return r;
  }

  // --- VERIFIED: consent -------------------------------------------------------------------
  const authorized = quotedOf(field('authorized'));
  const answered = field('answered') || field('answer');
  if (authorized) {
    if (!consents(authorized)) {
      const verbs = opts && opts.gate === 'PUSH-GATE'
        ? "publish verb left standing (push, merge, release, ship) and opens no pull request - a commit-only answer ('commit it') consents to no push, and a generic yes counts only when no commit-only act is named"
        : 'commit verb left standing (commit, land, or a publish that takes the commit with it)';
      r.problem = authorized.length > CONSENT_QUOTE_CAP
        ? `the authorized: quote runs past ${CONSENT_QUOTE_CAP} characters - a consent is the user's own answer, quoted; this is no answer`
        : foreignQuote(authorized) ? `the authorized: quote (${JSON.stringify(authorized).slice(0, 60)}) is not in English${FOREIGN_HINT}`
        : `the authorized: quote (${JSON.stringify(authorized).slice(0, 60)}) carries no ${verbs} - a negation, a stop, a deferral or 'myself' in its clause refuses the verb; it records the user saying something, not the user asking for THIS act${answerHint()}`;
      return r;
    }
    if (isOwnOptionLabel(authorized)) {
      r.problem = `the authorized: quote is character-identical to an option label THIS run wrote - that is the model's sentence, not the user's. Consent given by picking an option is spelled \`answered: <the chosen label>\` instead${answerHint()}`;
      return r;
    }
  } else if (answered) {
    if (!answered.replace(/^option\s+\d+\s*/i, '').replace(/["'“‘”’]/g, '').trim()) {
      r.problem = `the answered: line names no option${answerHint()}`;
      return r;
    }
    // The ask must come AFTER a review: a commit ask answered before any review ran consented on 'suite and format pass'
    // alone, the review then running behind the answer (audit 2026-10-10, session a3d497f8). Judged only when the answer
    // and a review are both in the transcript; a review that ran before the answer passes, a re-review after it too.
    const at = answeredAt(answered);
    const reviews = transcriptScan().reviews.filter((t) => t > 0);
    if (at && reviews.length && Math.min(...reviews) > at) {
      r.problem = `the answered: ask (${answered.slice(0, 60)}) was answered before any review ran in this session - the commit ask comes after the review and names anything still owed; ask again now that the review has run`;
      return r;
    }
  } else {
    r.problem = 'no authorized: line carrying the user\'s quoted words, and no answered: line naming the option they picked';
    return r;
  }

  // --- VERIFIED: what was reviewed ---------------------------------------------------------
  const head = field('head');
  if (!head) {
    r.problem = 'no head: line - the review covered a TREE, and without its sha a receipt written before three more edits landed still reads as this diff\'s review';
    return r;
  }
  let realHead = '';
  try { realHead = git('rev-parse HEAD'); } catch { realHead = ''; }
  // The sha is the first 7-40 hex WORD on the line, lower-cased: stripping every other character read `head: unknown`
  // as no sha at all (it passed), and `head: <sha> (main)` or an upper-case sha as a different one (audit 2026-10-08).
  const h = ((/\b[0-9a-f]{7,40}\b/i.exec(head) || [''])[0]).toLowerCase();
  if (!h) {
    r.problem = `head: ${head.slice(0, 40)} names no commit sha - write the output of git rev-parse HEAD`;
    return r;
  }
  const spec = field('spec');
  if (realHead && !realHead.startsWith(h) && !h.startsWith(realHead)) {
    // One receipt covers a reviewed BATCH (habits-commit-checkpoint: clear it 'after the LAST commit'): commit 1 moves
    // HEAD, and demanding head: == HEAD sent three sessions to sed-rewrite head: to a sha the review never ran against
    // (audit 2026-10-10, sessions 516e653d, 84eedb4b, ab61627f). A head: that is an ANCESTOR of HEAD still names the
    // reviewed tree, and passes when every commit since it, plus what this act takes in, stays inside what the review
    // covered.
    const batch = batchProblem(h, spec, opts);
    if (batch) {
      r.problem = `head: ${head} is not this repo's HEAD (${realHead.slice(0, 12)}) - ${batch}`;
      return r;
    }
  }
  if (!spec) {
    r.problem = 'no spec: line naming the file set reviewed (measured: a receipt asserted a review of a 17-file diff in which 9 files had been read)';
    return r;
  }
  // The count is compared for a COMMIT only, against what THIS commit takes in (commitSet, 2.1.6 H2):
  // a publish's spec names the commit set leaving the machine, which has nothing to do with what is
  // uncommitted here.
  const claimed = (opts && opts.countAgainstTree) ? /(\d+)\s*files?\b/i.exec(spec) : null;
  if (claimed) {
    let actual = 0;
    try { actual = commitSet().count; } catch { actual = 0; }
    if (actual && Number(claimed[1]) < actual) {
      r.problem = `spec: claims ${claimed[1]} file(s) but this commit takes in ${actual} (the index, plus what -a, a chained git add or the paths it names add) - review the rest, or narrow what this act commits`;
      return r;
    }
  }
  if (!/live[-\s_]?probe/i.test(bodyText)) {
    r.problem = 'no live-probe line - a VERIFIED review states what it actually ran, either the quoted output or `NOT RUN - <reason>` (spelled live-probe, live probe or live_probe)';
    return r;
  }
  // The formatter CHECK over what the commit takes in (COMMIT-GATE only): the checkpoint formatted only the files the
  // session edited, and a commit shipped an unformatted inherited file that held CI's format gate red for 29.5h (audit
  // 2026-10-10, session e6a68237). The receipt records the check and its verdict, `format: <check command> - clean over
  // <N> staged files`; a quoted user waiver on the line (`format: skipped - "<their words>"`) stands in for it.
  if (opts && opts.gate === 'COMMIT-GATE') {
    const fmt = field('format');
    const fmtQuote = quotedOf(fmt);
    const fmtWaived = (fmtQuote && WAIVER_WORDS.test(fmtQuote) && !foreignQuote(fmtQuote) && !isOwnOptionLabel(fmtQuote)) || (!fmtQuote && answeredWaiver(fmt || '') && !answeredWaiver(fmt).problem);
    if (!fmtWaived && (!fmt || !/\bclean\b/i.test(fmt))) {
      r.problem = `${fmt ? `format: ${fmt.slice(0, 60)} carries no clean verdict` : 'no format: line'} - a commit receipt records the formatter CHECK run over every staged file, \`format: <the check command> - clean over <N> staged files\` (a project with no formatter: \`format: none configured - clean over <N> staged files\`; the user's own waiver: \`format: skipped - "<their words>"\`)`;
      return r;
    }
    // The review's verdict travels with the receipt: two sessions' reviews closed in prose and no Findings field reached
    // the user (audit 2026-10-10, sessions 349e4825, a3d497f8). `findings: <count by severity | none>`, or the user's
    // quoted waiver, the format: rule.
    const fnd = field('findings');
    const fndQuote = quotedOf(fnd);
    const fndWaived = (fndQuote && WAIVER_WORDS.test(fndQuote) && !foreignQuote(fndQuote) && !isOwnOptionLabel(fndQuote)) || (!fndQuote && answeredWaiver(fnd || '') && !answeredWaiver(fnd).problem);
    // a findings line that says the review was skipped is a waiver, and a waiver is the user's quoted words
    if (!fndWaived && (!(fnd && fnd.replace(/[-:\s]/g, '')) || /\b(?:skip(?:s|ped)?|waived?|not\s+run)\b/i.test(fnd))) {
      r.problem = `${fnd && fnd.replace(/[-:\s]/g, '') ? `findings: ${fnd.slice(0, 60)} skips the review with no quoted waiver` : 'no findings: line'} - a commit receipt carries the review's Findings field, copied: \`findings: <a count by severity, or none>\` (the user's own waiver: \`findings: skipped - "<their words>"\`)`;
      return r;
    }
    // The security half covers what the commit takes in: a receipt claimed a review over the full 11-file diff while the
    // security diff read 4 (audit 2026-10-10, session 390aebcb). `security: ... - over <N> files` is held to the set.
    const secOver = /\bover\s+(\d+)\s*files?\b/i.exec(field('security') || '');
    if (secOver) {
      let actual = 0;
      try { actual = commitSet().count; } catch { actual = 0; }
      if (actual && Number(secOver[1]) < actual) {
        r.problem = `security: covered ${secOver[1]} file(s) but this commit takes in ${actual} - the security half reads the FULL change set, untracked files included`;
        return r;
      }
    }
    // A staged file changed AFTER the receipt was written: the review never saw that version - a fix delta committed
    // under the review it was meant to get again (audit 2026-10-10, session f450ea64). The receipt's own write time is
    // the review's latest moment; 2s of clock slack.
    if (opts.receiptMtimeMs) {
      const later = [];
      try {
        const set = commitSet();
        for (const f of [...set.tracked.keys(), ...set.untracked]) {
          let m = 0;
          try { m = fs.statSync(path.resolve(set.top || gitTop || root, f)).mtimeMs; } catch { continue; }
          if (m > opts.receiptMtimeMs + 2000) later.push(f);
        }
      } catch { /* unreadable: nothing judged */ }
      if (later.length) {
        r.problem = `${later.slice(0, 3).join(', ')}${later.length > 3 ? ` and ${later.length - 3} more` : ''} changed after this receipt was written - the review never saw that version; review the delta again (the same reviewer) and rewrite the receipt`;
        return r;
      }
    }
  }
  // The probe's SCOPE (push only - opts.touchedProjects is set only for PUSH-GATE): a receipt
  // naming one project's narrow run passed both gates once and CI broke right after the push.
  // Required only when the probe actually ran something AND the commit set going out touches
  // more than one identifiable project - a NOT RUN probe, a single-project push, or a pure docs
  // diff names nothing extra.
  const probeLine = (bodyText.match(/^\s*live[-\s_]?probe\s*:?[ \t]*(.*)$/im) || [])[1] || '';
  const probeRan = !/\bNOT RUN\b/i.test(probeLine);
  // More than one project: a single-project push names its scope by the project itself (audit 2026-10-10, sessions
  // bda299a8 and bba03dad: `length` alone demanded the line on three one-project pushes, against this comment).
  if (opts && opts.touchedProjects && opts.touchedProjects.length > 1 && probeRan) {
    const scope = field('scope');
    if (!scope) {
      r.problem = `this push touches ${opts.touchedProjects.join(', ')} - no scope: line names what the probe covered (workspace, or the project list it ran)`;
      return r;
    }
    if (!/\b(workspace|whole\s+repo|entire\s+repo|monorepo|all\s+projects?)\b/i.test(scope)) {
      const named = scope.toLowerCase();
      const missing = opts.touchedProjects.filter((p) => !named.includes(p.toLowerCase()));
      if (missing.length) {
        r.problem = `scope: ${scope} - this push also touches ${missing.join(', ')}, which the probe never ran`;
        return r;
      }
    }
  }
  // A security-flavored VERIFIED line must name what it checked - alfred-security.md's honesty
  // rule calls a one-line 'no findings' nod not a review. Skipped when the review is `carried:`
  // from an earlier session - the categories were named THEN, not now.
  if (/\bsecurity\b/i.test(first) && !field('carried')) {
    const sec = field('security');
    if (!sec || /^(no findings?|none|n\/a|clean|ok|0 findings?)\.?$/i.test(sec.trim())) {
      r.problem = 'the VERIFIED line claims a security review but no security: line names the categories checked (auth, secrets, injection, data-access, ...) - an empty list is not a review';
      return r;
    }
  }
  // A stamp minted from a CARRIED resume block must say so, or a 9h30m-old answer mints fresh
  // consent in 45 seconds and defeats the freshness check.
  // The loop arm names both spellings: the 1.x `quality-loop` and the 2.0.0 `alfred-loop-<name>` and the 2.2.0 `loop-<name>`
  // family - the rename left this arm matching nothing, so a receipt naming the loop minted consent.
  const notRun = field('carried') ? [] : reviewsNotRun(first);
  if (notRun.length) {
    r.problem = `the VERIFIED line names ${notRun.join(', ')}, but no run of ${notRun.length > 1 ? 'them' : 'it'} in this session reached its result line (\`Findings:\`, a loop's \`Outcome:\`) - a launched, refused or unfinished review is not this review, nor another skill's load; if this review is carried from an earlier cycle say so: \`carried: <cycle id>, reviewed <date>\``;
    return r;
  }
  // A commit line that names NO review still needs one (2026-10-22, a side agent's note; the user's ruling 'Need any
  // review run'): free wording skipped the check above, so `VERIFIED the checkpoint` passed with no review in the session.
  // A line naming only the plan review names no review of the code. A whitespace-only diff is no exemption (the user's
  // 'Fix ALL left gaps', 2026-10-22): git's -w read `rm -rf / tmp` for `/tmp`, spacing inside a string and a Python
  // line moved out of its `if` as no change.
  const namesCodeReview = reviewsNamed(first).some((k) => k !== 'verify-plan');
  if (opts && opts.gate === 'COMMIT-GATE' && !field('carried') && !namesCodeReview && !codeReviewRan()) {
    r.problem = 'the VERIFIED line names no review and no review ran in this session - run review-code (task-verify-code for a planned build) and name it on the line; a review from an earlier cycle says `carried: <cycle id>, reviewed <date>`, and only the user can waive one';
    return r;
  }
  // And the review saw what is committed: a review early in a long session covered no file edited after it.
  if (opts && opts.gate === 'COMMIT-GATE' && !field('carried')) {
    const last = lastCodeReviewMs();
    const late = last ? editedAfterReview() : [];
    if (late.length) {
      const one = late.length === 1;
      const shown = late.slice(0, 5).map((f) => f.rel).join(', ') + (late.length > 5 ? `, and ${late.length - 5} more` : '');
      const at = Math.max(...late.map((f) => f.at));
      const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
      const why = at ? `changed after the last review of the code covering ${one ? 'it' : 'them'} started (${hhmm(at)})`
        : `${one ? 'is' : 'are'} in no review of the code this session ran (the last, at ${hhmm(last)}, was pointed at other paths, or was a seat whose brief named none of ${one ? 'it' : 'them'} and no \`git diff\` of the whole change)`;
      r.problem = `${shown} ${why} - no review saw that version; run review-code on ${one ? 'it' : 'those files'} and copy its Findings field into the receipt`;
      return r;
    }
  }
  return r;
}

// touchedProjects is computed only for PUSH-GATE - it drives the diff-vs-upstream git call the
// scope check needs, and a COMMIT-GATE receipt is never judged against it.
const receiptOpts = (name, receiptMtimeMs = 0) => ({
  gate: name,
  countAgainstTree: name === 'COMMIT-GATE',
  touchedProjects: name === 'PUSH-GATE' ? pushTouchedProjects() : null,
  receiptMtimeMs,
});
function readReceipt(name, notBeforeMs = 0) {
  const gate = receiptRead(name);
  const write = receiptWrite(name);
  let stale = false;
  let body = '';
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(gate).mtimeMs;
    const age = Date.now() - mtimeMs;
    if (age > MAX_RECEIPT_AGE_MS || (notBeforeMs && mtimeMs < notBeforeMs)) stale = true;
    else body = fs.readFileSync(gate, 'utf8');
  } catch {
    // absent or unreadable - no gate receipt
  }
  if (stale) return { gate, write, stale, waived: false, verified: false, problem: null };
  return { gate, write, stale, ...judgeReceipt(body, receiptOpts(name, mtimeMs)) };
}
// An atomic write-receipt-then-act command carries its own receipt: the gate file is
// written (with a VERIFIED/WAIVED line in the same command text) before git runs. Blocking
// it would reject the receipt discipline this gate exists to enforce (measured: the
// write+act+clear-in-one-call shape is the corpus's dominant conforming pattern).
// All matches are bound to the segment BEFORE the act (a commit message merely mentioning
// COMMIT-GATE VERIFIED is not a receipt), and the receipt must be WRITTEN, not merely
// mentioned: requiring the words anywhere in that text let a single
// `echo "... VERIFIED ... authorized: ..." > notes.txt` satisfy the gate on a real dirty tree
// (reproduced). The redirect/tee/printf/cat has to target a path ending in state/approvals/<NAME>, or the pre-2.8.0
// flow/<NAME> a 2.7.0 skill copy names.
function carriesOwnReceipt(name, upto) {
  const pre = command.slice(0, upto);
  if (!pre.includes(name)) return false;
  const writes = new RegExp(`(?:>>?|\\btee\\s+(?:-a\\s+)?|\\bprintf\\b[^>]*>>?|\\bcat\\s*>>?)\\s*["']?(\\S*(?:state\\/approvals|flow)\\/${name})\\b`);
  if (!writes.test(pre)) return false;
  // ...and it answers to the SAME contract as the file. Judging the atomic shape more leniently
  // made it the cheapest way to skip every clause below: one printf and the gate was satisfied.
  const j = judgeReceipt(pre, receiptOpts(name));
  return (j.waived || j.verified) && !j.problem;
}

// --- the PUBLISH gate ---------------------------------------------------------------------
// Pushing and merging are what put the work where other people and CI get it, and until this
// existed nothing gated either: replayed across four bundles, every `git push` and `gh pr merge`
// passed every guard. In one session the FIRST state-changing act published unpushed commits 18
// minutes before any receipt existed, and 40 files reached a shared `develop` ungated.
// `ahead` reads HEAD against ITS upstream, so a push of another ref - `git push origin feature`, `feature:main`, a tag -
// or of a set (`--all`, `--tags`, `--mirror`, `--follow-tags`) was judged by a level HEAD and ran ungated (audit
// 2026-10-08, replayed). Only the current branch, HEAD or `@` pushed under its own name rides the upstream reading.
const PUSH_SET_FLAG = /^--(?:all|branches|tags|mirror|follow-tags)$/;
const PUSH_VALUE_OPT = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
function pushNamesOtherRefs(argv) {
  let branch = '';
  try { branch = git('rev-parse --abbrev-ref HEAD'); } catch { branch = ''; }
  const own = new Set(['HEAD', '@', ...(branch && branch !== 'HEAD' ? [branch, `refs/heads/${branch}`] : [])]);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--') { positional.push(...argv.slice(i + 1).map(String)); break; }
    if (PUSH_SET_FLAG.test(a)) return true;
    if (PUSH_VALUE_OPT.has(a)) { i++; continue; }
    if (!a.startsWith('-')) positional.push(a);
  }
  return positional.slice(1).some((spec) => {
    const s = spec.replace(/^\+/, '');
    const cut = s.indexOf(':');
    const src = cut < 0 ? s : s.slice(0, cut);
    const dst = cut < 0 ? null : s.slice(cut + 1);
    return !own.has(src) || (dst !== null && !own.has(dst));
  });
}
// A receipt written before this session began is another session's decision (the dispatch guard's APPROVAL rule): a
// push does not move HEAD, so one receipt opened every later push of that head for 2h, in any session (audit
// 2026-10-08). The commit receipt takes the same floor (audit 2026-10-20 H4: a WAIVED one carries no `head:`, so it opened
// every session's commits for 2h). birthtime counts only where the filesystem reports it (a fallback equal to the ctime is
// unknown).
function sessionStartMs() {
  try {
    const st = fs.statSync(String(payload.transcript_path || ''));
    return st.birthtimeMs && st.birthtimeMs !== st.ctimeMs ? st.birthtimeMs : 0;
  } catch { return 0; }
}
if (publishMatch) {
  // The act is echoed into the denial and the ledger row: capped, and a credential in a remote URL masked - the secret
  // guard runs first on the shell route, but not when it is switched off (audit 2026-10-08).
  const act = publishMatch.act.replace(/(\/\/)[^@\s/]+@/g, '$1***@').slice(0, 200);
  const isGitPush = publishMatch.git;
  // a dry run publishes nothing (the push's own argv), and neither does a push with nothing ahead of its upstream
  const dryRun = isGitPush && publishMatch.call.argv.some((a) => a === '--dry-run' || /^-[A-Za-z]*n[A-Za-z]*$/.test(a));
  let ahead = true;
  if (isGitPush) {
    try { ahead = git('log @{u}..HEAD --oneline').length > 0; } catch { ahead = true; } // no upstream = a new branch, which publishes
    // `ahead` is read BEFORE the command runs, so a history mover chained ahead of the push - `git commit -am x && git push`,
    // `git merge feature && git push` - publishes what it makes on a branch level with upstream now (audit 2026-10-08: both
    // replayed exit 0 with no receipt). A mover, or a git call the reader could not judge, before the push counts as ahead.
    if (!ahead && calls.some((c) => c.at < publishMatch.index && (HISTORY_MOVER.has(c.sub) || c.opaque))) ahead = true;
    if (!ahead && pushNamesOtherRefs(publishMatch.call.argv || [])) ahead = true;
  }
  if (!dryRun && ahead && !carriesOwnReceipt('PUSH-GATE', publishMatch.index)) {
    const r = readReceipt('PUSH-GATE', sessionStartMs());
    if (!((r.waived || r.verified) && !r.problem)) {
      process.stderr.write(
        (r.stale
          ? `Blocked: ${act} - the publish receipt at ${r.gate} is older than 2h or was written before this session began, and is treated as absent (a stale receipt from an earlier round did not review THIS push).\n`
          : r.problem
            ? `Blocked: ${act} - the publish receipt at ${r.gate} does not hold: ${r.problem}.\n`
            : `Blocked: ${act} without the publish gate receipt.\n`) +
          `A publish leaves this machine for good. Run habits-commit-checkpoint's publish half (load it): say what goes to\n` +
          `which branch, get the user's answer, then write ${r.write} with the skill's scripts/receipt.js (\`push\`) - it\n` +
          `fills head: and spec: from git:\n` +
          `  VERIFIED <what is being published>\n` +
          `  authorized: "<the user's words asking for THIS publish, verbatim>"  (in English, or answered: <the label they picked>)\n` +
          `  live-probe: <what you ran, or NOT RUN - <reason>>   scope: <workspace, or the projects - when it spans several>\n` +
          `The quote carries a publish verb and is never an option label this run wrote. A waiver is WAIVED - "<their\n` +
          `words>" or WAIVED - answered: <the label they picked>. Never fabricate either; retry, and clear the file once it\n` +
          `lands. A remote already gated (branch protection) can turn this half off: guard-ungated-commit:push in ALFRED_CODE_HOOKS_OFF.`,
      );
      process.exit(2);
    }
  }
  // A merge lands the CHANGE's head, not this checkout's: the receipt's head: must be that head or a descendant of it
  // (forge.js unseenHead - read with plain git, so on every forge and transport; no change ref or no network leaves the
  // local-HEAD rule above standing). The atomic receipt in the command is the newest, then the file.
  if (!dryRun && ahead && forgeLib && publishMatch.forge && publishMatch.forge.concept === forgeLib.CONCEPTS.MERGE) {
    let text = command.slice(0, publishMatch.index);
    try { text += `\n${fs.readFileSync(receiptRead('PUSH-GATE'), 'utf8')}`; } catch { /* no file: the atomic receipt alone */ }
    const receiptHead = (/^\s*head:[^\n]*?\b([0-9a-f]{7,40})\b/im.exec(text) || [])[1];
    let unseen = null;
    try { unseen = forgeLib.unseenHead({ cwd: root, change: publishMatch.forge.change, sha: publishMatch.forge.head, receiptHead }); } catch { unseen = null; }
    if (unseen) {
      process.stderr.write(`Blocked: ${act} - ${unseen}.\n` +
        'The publish receipt reviewed a different tree than the one this merge lands; the checkpoint\'s publish half reviews the change as it stands.');
      process.exit(2);
    }
  }
  // Allowed: the act ledger the ref watch reads (forge.js recordAct) - what moved, where, from which head.
  if (!dryRun && ahead && forgeLib) {
    const f = publishMatch.forge || {};
    let head = f.head || null;
    if (!head) { try { head = git('rev-parse HEAD'); } catch { head = null; } }
    // A git push is one row per ref it names, so a push of feat/x never covers a move of main; one that names none of its
    // refs (--all, --tags) is one row with no target, which covers every move this turn.
    let refs = [f.ref || null];
    if (publishMatch.git && forgeLib.pushTargets) {
      refs = [];
      for (const p of calls.filter((c) => c.sub === 'push')) {
        const targets = forgeLib.pushTargets(p.argv || [], gitCwd);
        refs.push(...(targets || [null]));
      }
      if (!refs.length) refs = [null];
    }
    for (const ref of [...new Set(refs)]) forgeLib.recordAct(root, payload.session_id, { concept: f.concept || forgeLib.CONCEPTS.BRANCH, change: f.change, ref, head });
  }
}

// --- the COMMIT gate ----------------------------------------------------------------------
if (!commitMatch && !addCalls.length) { if (askMatch) forgeAsk(askMatch); process.exit(0); }

// --- staged-diff scan: facts a verifier misses and a formatter never sees ------------------------
// Conflict markers, a debugger, a focused test, a credential-shaped literal and a hidden character
// (hidden-chars.js beside this hook, the lint's own class) on an ADDED line of what THIS act commits. It runs before the trivial-diff exemption and before every commit-gate
// receipt - the review receipt is a different claim - and a hit the user means to keep is opened
// only by its own STAGED-SCAN-ALLOW receipt. What the act commits: the index; plus the unstaged
// tracked changes under `commit -a` or a chained `git add` (nothing is staged yet when this hook
// runs); plus the untracked files that add takes in. A commit NAMING paths commits their working
// tree against HEAD - alone under `--only` (the default), on top of the index under `--include`.
// At most 2MB of text is read: a binary file and a single file past the cap are skipped (their
// text is never read), and past the total the scan stops adding text but keeps every hit it found.
// The two shapes are COPIES of guard-secret-value.js, pinned by meta/shared-rules.json
// (credential-literal-shapes, credential-literal-pem). No g flag.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const PEM_PRIVATE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const SCAN_LIMIT = 2 * 1024 * 1024;
const TEST_FILE = /(^|\/)(__tests__|e2e|cypress)\/|\.(spec|test|cy|e2e)\.[cm]?[jt]sx?$/;
// Any file may open with a byte-order mark (Visual Studio writes one on a new .cs); past byte 0 it is hidden text.
let hiddenChars = null;
try { hiddenChars = require(path.join(__dirname, 'hidden-chars.js')); } catch { /* a copy that runs before it lands scans without the class */ }
function lineFinding(file, text, lineNo) {
  if (/^(<{7}|>{7}) /.test(text)) return 'a conflict marker';
  if (SECRET_SHAPE.test(text) || PEM_PRIVATE.test(text)) return 'a credential-shaped literal';
  const hidden = hiddenChars ? hiddenChars.hiddenInLine(text, lineNo, file, () => true) : [];
  if (hidden.length) return `a hidden character U+${hidden[0]} - write it as an escape`;
  if (/\.(md|mdx|txt|rst)$/i.test(file)) return '';
  // A comment-only line spells a pattern without running it; each shape below is a STATEMENT, not a call or a string.
  if (/^\s*(\/\/|\/\*|\*|#)/.test(text)) return '';
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && /(?:^|[;{}]|\)|\belse\b)\s*debugger\s*;?\s*\}?\s*$/.test(text)) return 'a debugger statement';
  if (/\.cs$/.test(file) && /\bDebugger\.(Break|Launch)\s*\(/.test(text)) return 'Debugger.Break / Launch';
  if (TEST_FILE.test(file) && /(?:^|[;{])\s*(?:(?:fdescribe|fit)\s*\(|(?:test\.)?(?:describe|it|test)\.only\s*\()/.test(text)) return 'a focused test';
  return '';
}
// A `<data root>/state/approvals/<name>` ALLOW receipt's lines (the pre-2.8.0 flow/ still read) - the USER's answer to a
// block, this session's own, under 8h. `write` is where a denial says to put one.
function allowLines(name) {
  const file = receiptRead(name);
  const write = receiptWrite(name);
  try {
    const st = fs.statSync(file);
    let sessionStartMs = 0;
    try {
      const tr = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = tr.birthtimeMs && tr.birthtimeMs !== tr.ctimeMs ? tr.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs <= 8 * 60 * 60 * 1000 && !(sessionStartMs && st.mtimeMs < sessionStartMs)) {
      return { file, write, lines: fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) };
    }
  } catch { /* absent or unreadable - nothing allowed */ }
  return { file, write, lines: [] };
}

// --- a git add that sweeps in what the session did not make --------------------------------------
// Pilot 3: ~150 files the harness left untracked before the session began were committed by a close's `git add`, and
// drove 13 'spec claims N file(s)' denials. git's own dry run says what each add would stage (top-relative, whatever
// the pathspec - `.`, `-A`, `:/`, a directory, a glob); a pre-existing path in it is SWEPT unless the call names that
// exact path, and a swept one passes only through UNTRACKED-ALLOW (a path, a directory ending in `/`, or `*`). A survey
// (`-N`), a dry run, a patch or edit session and a tracked-only `-u` stage no untracked path and are not judged.
function sweptPaths() {
  const before = preExisting();
  if (!before.size) return [];
  // `.native`, here and in topOf: a Windows temp dir is an 8.3 short name (`RUNNER~1`) the JS resolver keeps, while
  // git names the long one - the two never matched, so no sweep was ever blocked there (windows-2025 CI, 2026-09-27).
  let realRoot = root;
  try { realRoot = fs.realpathSync.native(root); } catch { /* keep the spelling */ }
  const swept = new Set();
  for (const call of addCalls) {
    const cwd = callDir(call);
    const args = call.argv;
    const flags = args.slice(0, args.includes('--') ? args.indexOf('--') : args.length).filter((a) => a.startsWith('-'));
    const quiet = flags.some((a) => /^--(intent-to-add|dry-run|patch|interactive|edit|update|refresh)$/.test(a) || (/^-[^-]/.test(a) && /[nNpieu]/.test(a.slice(1))));
    if (quiet) continue;
    const top = topOf(cwd);
    if (!top) continue;
    const r = spawnSync(...gitSafe(['-c', 'core.quotePath=false', 'add', '--dry-run', ...args], { cwd, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (r.error || r.status !== 0) continue; // the add itself will fail the same way - never block on it
    let rest = false;
    const named = new Set(args.filter((a) => { if (a === '--') { rest = true; return false; } return rest || !a.startsWith('-'); })
      .map((a) => path.relative(top, path.resolve(cwd, a)).split(path.sep).join('/')));
    for (const line of String(r.stdout).split('\n')) {
      const m = /^add '(.*)'$/.exec(line);
      if (!m || named.has(m[1])) continue;
      const rel = path.relative(realRoot, path.join(top, m[1])).split(path.sep).join('/');
      if (before.has(rel)) swept.add(rel);
    }
  }
  const { lines } = allowLines('UNTRACKED-ALLOW');
  return [...swept].filter((f) => !(lines.includes('*') || lines.includes(f) || lines.some((l) => l.endsWith('/') && f.startsWith(l))));
}
if (addCalls.length) {
  const swept = sweptPaths();
  if (swept.length) {
    global.BLOCK_DETAIL = { branch: 'untracked-sweep', count: swept.length };
    const rel = (name) => path.relative(root, receiptWrite(name)).split(path.sep).join('/');
    const record = preExistingRecord();
    process.stderr.write(
      `Blocked: this git add stages ${swept.length} path(s) that were untracked before this change started -\n` +
      `${swept.slice(0, 15).map((f) => `  ${f}`).join('\n')}\n` +
      (swept.length > 15 ? `  ... and ${swept.length - 15} more\n` : '') +
      `They are not this change (the list: ${record ? path.relative(root, record).split(path.sep).join('/') : 'none'}). Stage the change's own\n` +
      `paths by name instead - git add <path> ... When the user named these files as part of this change, write\n` +
      `${rel('UNTRACKED-ALLOW')} with one path (a directory ending in /, or *) per line and retry the SAME command;\n` +
      `otherwise do not decide for them: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
      `  'Stage only this session's paths (Recommended)'\n` +
      `  'Stage them too' - the user adds these files to the change\n` +
      `It is honoured for this session only, under 8h.\n`,
    );
    process.exit(2);
  }
}
if (!commitMatch) process.exit(0);
// What the commit takes in, read from the command: the commit's own flags and paths, and every `git add` before it.
// Each path is placed where ITS git call runs and handed to git as a top-relative `:(top)` pathspec - read from the
// repo top instead, a path named from a subfolder matched nothing, and 11 commit shapes counted as empty (2.1.6
// review B1). `unknown` marks a set the command does not spell out: a path word the shell expands (`$F`, `$(...)`,
// a backtick), a path outside this repo, an add fed by `xargs` or `--pathspec-from-file`, an interactive add or
// commit.
let scopeCache;
function commitScope() {
  if (scopeCache) return scopeCache;
  const scope = { dryRun: false, amend: false, tracked: false, untracked: false, paths: [], commitPaths: [], mode: '', unknown: !!commitMatch.opaque };
  const place = (dir, word) => {
    if (!gitTop || /[$`]/.test(word)) return null;
    if (word.startsWith(':')) return word === ':/' ? ':/' : null;
    const rel = path.relative(gitTop, path.resolve(dir, nativePath(word))).split(path.sep).join('/');
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
    return rel ? `:(top)${rel}` : ':/';
  };
  const placeAll = (dir, words, into) => {
    for (const w of words) {
      const p = place(dir, w);
      if (p === null) scope.unknown = true;
      into.push(p === null ? w : p);
    }
  };
  if (!commitMatch.opaque) {
    const { flags, paths } = commitArgs(commitMatch.call.argv);
    scope.dryRun = flags.has('--dry-run');
    scope.amend = flags.has('--amend');
    scope.tracked = flags.has('-a') || flags.has('--all') || flags.has('--pathspec-from-file');
    if (flags.has('-p') || flags.has('--patch') || flags.has('--interactive')) scope.unknown = true;
    if (paths.length) {
      placeAll(callDir(commitMatch.call), paths, scope.commitPaths);
      scope.mode = flags.has('-i') || flags.has('--include') ? 'include' : 'only';
    }
  }
  for (const call of addCalls) {
    if (call.at >= commitMatch.index) break;
    const args = call.argv;
    const flags = args.filter((a) => a.startsWith('-'));
    if (flags.some((a) => /^(-N|--intent-to-add|-n|--dry-run)$/.test(a))) continue; // a survey or a dry run stages nothing
    if (call.xargs || flags.some((a) => /^(--patch|--interactive|--edit|--pathspec-from-file(=.*)?)$/.test(a) || (/^-[^-]/.test(a) && /[pie]/.test(a.slice(1))))) {
      scope.unknown = true;
      continue;
    }
    if (flags.some((a) => /^(-u|--update)$/.test(a))) scope.tracked = true;
    if (flags.some((a) => /^(-A|--all)$/.test(a)) || args.includes(':/')) { scope.tracked = true; scope.untracked = true; continue; }
    placeAll(callDir(call), args.filter((a) => !a.startsWith('-')), scope.paths);
  }
  scopeCache = scope;
  return scope;
}
// The files a set of pathspecs covers, each with its churn against HEAD, named from the repo top: with no scope the
// whole tree, else the index plus what `-a`, a chained `git add` or the named paths (`--only` / `--include`) take in.
// Left out: the docs root, the data root's state/ (the receipt lives there) and statistics/, and what was untracked when
// the change began.
function measure(scope) {
  const top = gitTop || root;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const realRoot = real(root);
  const inTop = (r) => r && r !== '..' && !r.startsWith('../') && !path.isAbsolute(r);
  const rootRel = path.relative(top, realRoot).split(path.sep).join('/');
  const before = new Set([...preExisting()].map((f) => (inTop(rootRel) ? `${rootRel}/${f}` : f)));
  const own = ownPrefixes(top);
  const keep = (f) => f && !own.some((p) => f.startsWith(p));
  const run = (args) => execFileSync(...gitSafe(['-c', 'core.quotePath=false', ...args], { cwd: top, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).toString('utf8');
  const tracked = new Map();
  const numstat = (base, paths) => {
    const f = run([...base, '--numstat', '-z', ...(paths.length ? ['--', ...paths] : [])]).split('\0');
    for (let i = 0; i < f.length; i++) {
      const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(f[i]);
      if (!m) continue;
      const p = m[3] || f[i += 2]; // a rename: its old path, then the new one
      if (keep(p)) tracked.set(p, (parseInt(m[1], 10) || 0) + (parseInt(m[2], 10) || 0));
    }
  };
  const untracked = new Set();
  const others = (paths) => {
    for (const f of run(['ls-files', '-z', '--full-name', '--others', '--exclude-standard', ...(paths.length ? ['--', ...paths] : [])]).split('\0')) {
      if (keep(f) && !before.has(f)) untracked.add(f);
    }
  };
  if (!scope) {
    numstat(['diff', 'HEAD'], []);
    others([]);
  } else if (scope.mode === 'only') {
    numstat(['diff', 'HEAD'], scope.commitPaths);
    if (scope.untracked || scope.paths.length) others(scope.commitPaths);
  } else {
    numstat(['diff', '--cached'], []);
    if (scope.mode === 'include') numstat(['diff', 'HEAD'], scope.commitPaths);
    if (scope.tracked) numstat(['diff', 'HEAD'], []);
    else if (scope.paths.length) numstat(['diff', 'HEAD'], scope.paths);
    if (scope.untracked) others([]);
    else if (scope.paths.length) others(scope.paths);
  }
  return { top, tracked, untracked: [...untracked], count: tracked.size + untracked.size };
}
// The receipt's spec: is measured on what THIS commit takes in (2.1.6 H2): on the whole tree, narrowing a commit
// never helped - the A/B runs hit 'the tree has M uncommitted' in 12 of 12 PR runs, and 3 stopped there. The whole
// tree stands in when the command does not spell the set out (`unknown` above, `git $C`, a chained git call that
// moves the index some other way - `git rm`, `git mv`, `git stash pop`, ...), and when named paths resolve to
// nothing while the tree is dirty - a set the guard could not place, never an empty commit. An unborn HEAD throws,
// as `git diff HEAD` always did, and every caller fails open on it.
const INDEX_MOVER = new Set(['rm', 'mv', 'apply', 'am', 'stash', 'checkout', 'restore', 'reset', 'read-tree', 'update-index', 'merge', 'pull',
  'rebase', 'cherry-pick', 'revert']);
let commitSetCache;
function commitSet() {
  if (commitSetCache) return commitSetCache;
  git('rev-parse --verify -q HEAD');
  const moved = calls.some((c) => c.at < commitMatch.index && INDEX_MOVER.has(c.sub));
  const scope = commitMatch.opaque || moved ? null : commitScope();
  let set = measure(scope && !scope.unknown ? scope : null);
  if (scope && !scope.unknown && !set.count && (scope.paths.length || scope.commitPaths.length)) {
    const tree = measure(null);
    if (tree.count) set = tree;
  }
  commitSetCache = set;
  return set;
}
// The trivial bar is cumulative per SESSION (2.1.6 review M2, its recommended fix): this commit's own set plus what the
// session's earlier TRIVIAL commits took in, so one small commit stays exempt and a change split into small commits
// crosses the bar at the slice that takes the session past it - measured per commit, all six slices of a 60-line
// feature walked under it; measured on the whole tree, a staged one-liner beside unrelated dirty work gated (T18).
// What counts is the guard's own ledger, <data root>/state/sessions/trivial-<session>: one row per commit it let through under the
// bar (the HEAD it was made on, its files and their churn; an amend's row sits on the amended commit's parent and names
// the commit it replaces). A commit a receipt covered writes no row, and commits a pull, a merge or a rebase brought in
// have none (review re-verify N1: summing every commit since the start made a typo after a reviewed feature, or a
// one-liner after a pull, need a receipt). Rows are read (re-verify 2 R2-M4):
//   - once per attempt: a retry of the same commit (same HEAD, files and amended commit) is one row, the last one;
//   - while any of the row's files still differs between the session's start and HEAD, so a rebase or an amend that
//     rewrote the commit keeps its row, and a branch switch drops what it took away (keyed by ancestry instead, an
//     amend loop built a 43-line commit 14 lines at a time and a rebase dropped every row after the first);
//   - never when made on today's HEAD, or as this same amend retried: that commit has not landed.
// An amend adds its own lines to the rows of the commit it replaces, so each amend is one more slice of that commit.
// The session's start is the sha history-session.js pins at its first SessionStart (<data root>/state/history/<session>.json,
// else the pre-2.8.0 <docs-path>/history/ one,
// kept across a resume or compaction of the same session); a new session has a ledger of its own, so it begins a new
// change. A start the branch rewrote (an amend of it, a rebase) is read from where it meets HEAD (`git merge-base`).
// With no record (the history hook off) the ledger pins its own start - HEAD at the session's first judged commit, a
// `{"start"}` row - so a staged one-liner beside unrelated work is still this commit alone (re-verify 3 R3-m9). With no
// session in the payload, or a start that shares no history with HEAD, the bar is the whole tree, as it always was.
const SHA_RE = /^[0-9a-f]{7,64}$/;
function sessionStart() {
  const sid = String(payload.session_id || '').replace(/[^\w.-]/g, '_');
  if (!sid) return null;
  let sha = '';
  const record = layout ? layout.findState(projectDir || root, 'history', `${sid}.json`) : path.resolve(projectDir || root, docsRoot, 'history', `${sid}.json`);
  try { sha = String(JSON.parse(fs.readFileSync(record, 'utf8')).startSha || ''); } catch { sha = pinnedStart(); }
  if (!SHA_RE.test(sha)) return null;
  try { git(`merge-base --is-ancestor ${sha} HEAD`); return sha; } catch { /* rewritten, or elsewhere */ }
  try { const base = git(`merge-base ${sha} HEAD`); return SHA_RE.test(base) ? base : null; } catch { return null; }
}
const sessionId = () => String(payload.session_id || '').replace(/[^\w.-]/g, '_');
// A session an older hook started keeps its pre-2.8.0 ledger; a new one starts in state/sessions/.
const trivialLedger = () => (layout ? layout.findState(projectDir || root, 'sessions', `trivial-${sessionId()}`)
  : path.resolve(projectDir || root, docsRoot, 'flow', `trivial-${sessionId()}`));
// The start the ledger pinned for itself, pinned now when it has none.
function pinnedStart() {
  let text = '';
  try { text = fs.readFileSync(trivialLedger(), 'utf8'); } catch { /* no ledger yet */ }
  for (const line of text.split('\n')) {
    try { const row = JSON.parse(line); if (row && SHA_RE.test(String(row.start))) return row.start; } catch { /* a torn row */ }
  }
  try {
    const head = git('rev-parse HEAD');
    fs.mkdirSync(path.dirname(trivialLedger()), { recursive: true });
    fs.appendFileSync(trivialLedger(), `${JSON.stringify({ start: head })}\n`);
    sweepLedgers();
    return head;
  } catch { return ''; }
}
function ledgerRows(head, since) {
  let text = '';
  try { text = fs.readFileSync(trivialLedger(), 'utf8'); } catch { return []; }
  const byKey = new Map();
  for (const line of text.split('\n')) {
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || !SHA_RE.test(String(row.head)) || !row.files || typeof row.files !== 'object' || Array.isArray(row.files)) continue;
    const amendOf = SHA_RE.test(String(row.amendOf || '')) ? row.amendOf : '';
    if (row.head === head || amendOf === head) continue;
    byKey.set(JSON.stringify([row.head, amendOf, Object.keys(row.files).sort()]), row);
  }
  if (!byKey.size) return [];
  let still;
  try {
    still = new Set(execFileSync(...gitSafe(['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', since, 'HEAD'], {
      cwd: root, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    })).toString('utf8').split('\0').filter(Boolean));
  } catch { return []; }
  return [...byKey.values()].filter((row) => Object.keys(row.files).some((f) => still.has(f)));
}
// A trivial pass writes its row: this commit's own files, each with its churn (an untracked file's line count) - unless
// a receipt covers the commit, which then adds nothing to the bar.
function recordTrivial(set) {
  if (!set.own || !sessionId() || (!commitMatch.opaque && commitScope().dryRun)) return;
  try {
    const c = readReceipt('COMMIT-GATE', sessionStartMs());
    if ((c.waived || c.verified) && !c.problem) return;
  } catch { /* an unreadable receipt covers nothing */ }
  const files = {};
  for (const [p, churn] of set.own.tracked) files[p] = churn;
  for (const u of set.own.untracked) {
    try { files[u] = fs.readFileSync(path.join(set.top, u), 'utf8').split('\n').filter(Boolean).length; } catch { files[u] = 0; }
  }
  const row = { head: set.base, files, at: new Date().toISOString() };
  if (set.amendOf) row.amendOf = set.amendOf;
  try {
    fs.mkdirSync(path.dirname(trivialLedger()), { recursive: true });
    fs.appendFileSync(trivialLedger(), `${JSON.stringify(row)}\n`);
  } catch { /* an unwritable ledger only loosens the next commit's bar to this one */ }
  sweepLedgers();
}
// When this guard writes its ledger, other sessions' ledgers past 7 days go (hook-prelude.js sweepStale, audit
// 2026-10-08 S9) - the bar reads only this session's.
function sweepLedgers() {
  try { const pre = require('./hook-prelude.js'); if (typeof pre.sweepStale === 'function') pre.sweepStale(path.dirname(trivialLedger()), 'trivial-'); } catch { /* no prelude */ }
}
let barSetCache;
function barSet() {
  if (barSetCache) return barSetCache;
  git('rev-parse --verify -q HEAD');
  const since = sessionStart();
  if (!since) {
    barSetCache = { ...measure(null), own: null };
    return barSetCache;
  }
  const own = commitSet();
  const head = git('rev-parse HEAD');
  let base = head;
  let amendOf = null;
  if (!commitMatch.opaque && commitScope().amend) {
    try { base = git('rev-parse --verify -q HEAD~1'); amendOf = head; } catch { /* a root commit has no parent to record on */ }
  }
  // Each file's earlier rows count at most its net change since the start (re-verify 3 R3-m8): a squash done in two calls
  // - `git reset --soft <start>`, then one commit of the same lines - left both small commits' rows beside its own.
  const prior = new Map();
  for (const row of ledgerRows(head, since)) {
    for (const [p, churn] of Object.entries(row.files)) prior.set(p, (prior.get(p) || 0) + (Number(churn) || 0));
  }
  const net = new Map();
  if (prior.size) {
    try {
      const f = execFileSync(...gitSafe(['-c', 'core.quotePath=false', 'diff', '--numstat', '-z', '--no-renames', since, 'HEAD'], {
        cwd: root, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      })).toString('utf8').split('\0');
      for (const rec of f) {
        const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(rec);
        if (m) net.set(m[3], (parseInt(m[1], 10) || 0) + (parseInt(m[2], 10) || 0));
      }
    } catch { /* unreadable: the rows stand as written */ }
  }
  const tracked = new Map(own.tracked);
  for (const [p, churn] of prior) tracked.set(p, (tracked.get(p) || 0) + (net.has(p) || net.size ? Math.min(churn, net.get(p) || 0) : churn));
  barSetCache = { top: own.top, tracked, untracked: own.untracked, own, head, base, amendOf };
  return barSetCache;
}
// A name from a `+++ ` header: git ends a name holding a space with a TAB, and C-quotes one holding a
// quote, a backslash or a control character (core.quotePath=false keeps every other byte as written).
function headerName(raw) {
  let s = raw.replace(/\t$/, '');
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) {
    const ESC = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
    const bytes = [];
    const body = s.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '\\') {
        const ch = String.fromCodePoint(body.codePointAt(i));
        i += ch.length - 1;
        bytes.push(...Buffer.from(ch));
        continue;
      }
      const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); i += 3; continue; }
      const c = body[++i] ?? '';
      bytes.push(ESC[c] ?? c.charCodeAt(0));
    }
    s = Buffer.from(bytes).toString('utf8');
  }
  return s.replace(/^b\//, '');
}
function stagedFindings() {
  const scope = commitScope();
  if (scope.dryRun) return [];
  const out = [];
  let budget = SCAN_LIMIT;
  const top = gitTop || root;
  const q = ['-c', 'core.quotePath=false'];
  // git's text, cut at what the budget has left: an overflow keeps what was read, never throws it away.
  const readText = (args) => {
    if (budget <= 0) return '';
    const r = spawnSync(...gitSafe([...q, ...args], { cwd: root, timeout: 5000, maxBuffer: budget, stdio: ['ignore', 'pipe', 'ignore'] }));
    if (r.error && r.error.code !== 'ENOBUFS') throw r.error;
    if (!r.error && r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}`);
    const text = (r.stdout || Buffer.alloc(0)).subarray(0, budget).toString('utf8');
    budget -= Buffer.byteLength(text);
    return text;
  };
  const list = (args) => execFileSync(...gitSafe([...q, args[0], '-z', ...args.slice(1)], { cwd: root, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }))
    .toString('utf8').split('\0').filter(Boolean);
  // The files a diff would carry that are binary (numstat `-`) or past the cap on their own, sized from
  // the index for a staged diff and from the disk otherwise - left out, so none eats the budget.
  const bulky = (base, paths, fromIndex) => {
    const rows = [];
    const f = list([...base, '--numstat', ...(paths.length ? ['--', ...paths] : [])]);
    for (let i = 0; i < f.length; i++) {
      const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(f[i]);
      if (!m) continue;
      rows.push({ binary: m[1] === '-', path: m[3] || f[i += 2] });   // a rename: its old path, then the new one
    }
    let sizes = new Map();
    if (fromIndex && rows.length) {
      const r = spawnSync(...gitSafe(['cat-file', '--batch-check=%(objectsize)'], { cwd: top, input: rows.map((x) => `:${x.path}`).join('\n') + '\n', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }));
      const n = String(r.stdout || '').split('\n');
      sizes = new Map(rows.map((x, k) => [x.path, Number(n[k]) || 0]));
    }
    const sizeOf = (p) => { if (fromIndex) return sizes.get(p) || 0; try { return fs.statSync(path.join(top, p)).size; } catch { return 0; } };
    return rows.filter((x) => x.binary || sizeOf(x.path) > SCAN_LIMIT).map((x) => x.path);
  };
  // One pass over a -U0 diff. A hunk header says how many rows follow it, so a content row that
  // happens to start with `+++ ` is never read as the next file's header.
  const scanDiff = (base, paths, fromIndex) => {
    const skip = bulky(base, paths, fromIndex);
    const spec = skip.length ? [...(paths.length ? paths : [':/']), ...skip.map((p) => `:(top,literal,exclude)${p}`)] : paths;
    const found = [];
    let file = '', line = 0, left = 0;
    for (const row of readText([...base, '-U0', '--no-color', ...(spec.length ? ['--', ...spec] : [])]).split('\n')) {
      if (left > 0) {
        if (row.startsWith('\\')) continue; // "\ No newline at end of file"
        left -= 1;
        if (!row.startsWith('+')) continue;
        const hit = lineFinding(file, row.slice(1), line);
        if (hit) found.push({ file, line, hit });
        line += 1;
        continue;
      }
      if (row.startsWith('+++ ')) { file = headerName(row.slice(4)); continue; }
      const hunk = row.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) { line = Number(hunk[2]); left = (hunk[1] === undefined ? 1 : Number(hunk[1])) + (hunk[3] === undefined ? 1 : Number(hunk[3])); }
    }
    return found;
  };
  // An untracked file the act takes in, read from the disk: a file past the cap is skipped, a NUL in
  // its first 8KB marks it binary (git would not diff it as text either), and past the total budget
  // the read stops adding text.
  const scanLoose = (files) => {
    for (const f of files) {
      if (budget <= 0) return;
      let fd;
      try {
        const full = path.join(root, f);
        const st = fs.statSync(full);
        if (!st.isFile() || st.size > SCAN_LIMIT) continue;
        const buf = Buffer.alloc(Math.min(st.size, budget));
        fd = fs.openSync(full, 'r');
        fs.readSync(fd, buf, 0, buf.length, 0);
        if (buf.subarray(0, 8192).includes(0)) continue;
        budget -= buf.length;
        buf.toString('utf8').split('\n').forEach((row, i) => { const hit = lineFinding(f, row, i + 1); if (hit) out.push({ file: f, line: i + 1, hit }); });
      } catch { /* unreadable - skipped */ } finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  };
  const others = (paths) => list(['ls-files', '--others', '--exclude-standard', ...(paths.length ? ['--', ...paths] : [])]);
  try {
    if (scope.mode === 'only') {
      out.push(...scanDiff(['diff', 'HEAD'], scope.commitPaths, false));
      // a chained add stages an untracked path first, and the commit then takes it in
      if (scope.untracked || scope.paths.length) scanLoose(others(scope.commitPaths));
      return out;
    }
    const staged = scanDiff(['diff', '--cached'], [], true);
    if (scope.mode === 'include') {
      const named = new Set(list(['diff', 'HEAD', '--name-only', '--', ...scope.commitPaths]));
      out.push(...staged.filter((f) => !named.has(f.file)), ...scanDiff(['diff', 'HEAD'], scope.commitPaths, false));
    } else out.push(...staged);
    if (scope.tracked) out.push(...scanDiff(['diff'], [], false));
    else if (scope.paths.length) out.push(...scanDiff(['diff'], scope.paths, false));
    if (scope.untracked) scanLoose(others([]));
    else if (scope.paths.length) scanLoose(others(scope.paths));
  } catch { /* no repo or git unavailable - the hits already found still stand */ }
  return out;
}
{
  const found = stagedFindings();
  // 'Commit it as is' is the USER's answer, honoured through its own receipt: one `file`, `file:line`
  // or `*` per line; this session's own, under 8h.
  const { write: allowFile, lines: allow } = allowLines('STAGED-SCAN-ALLOW');
  const open = found.filter((f) => !(allow.includes('*') || allow.includes(f.file) || allow.includes(`${f.file}:${f.line}`)));
  if (open.length) {
    global.BLOCK_DETAIL = { branch: 'staged-scan', count: open.length };
    const allowRel = path.relative(root, allowFile).split(path.sep).join('/');
    process.stderr.write(
      `Blocked: the commit adds what must never land -\n${open.slice(0, 15).map((f) => `  ${f.file}:${f.line} - ${f.hit}`).join('\n')}\n` +
      (open.length > 15 ? `  ... and ${open.length - 15} more\n` : '') +
      `Remove it and stage again. This is a fact check on the diff, separate from the commit-gate receipt,\n` +
      `which does not open it. If a hit is MEANT to land (a test fixture, a documented sample), do not decide\n` +
      `for the user: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
      `  'Remove it and stage again (Recommended)'\n` +
      `  'Commit it as is' - the user keeps the line on purpose\n` +
      `On 'Commit it as is', write ${allowRel} with one \`file:line\` per kept hit and retry the SAME\n` +
      `command. It is honoured for this session only, under 8h.\n`,
    );
    process.exit(2);
  }
}
if (carriesOwnReceipt('COMMIT-GATE', commitMatch.index)) process.exit(0);
// A SCRATCH commit is no project history: git runs in a checkout other than the project's own, on a DETACHED HEAD, under
// the temp dir or the harness's scratch root (audit 2026-10-11 SD16, session 2ca8e8ee: a throwaway replay commit in a
// detached scratch worktree was held for the project's receipt). The staged scan above still ran; a branch, the
// project's own tree or a path outside the temp roots is gated as before.
if (commitMatch.call && gitTop && !(projectDir && gitTop === topOf(projectDir))) {
  const UID = typeof process.getuid === 'function' ? process.getuid() : null;
  const realOr = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const tmpRoots = [require('os').tmpdir(), ...(UID != null ? [`/tmp/claude-${UID}`, `/private/tmp/claude-${UID}`] : [])].map(realOr);
  const under = tmpRoots.some((d) => gitTop === d || gitTop.startsWith(d.endsWith(path.sep) ? d : d + path.sep));
  let detached = false;
  if (under) {
    try { execFileSync(...gitSafe(['symbolic-ref', '-q', 'HEAD'], { cwd: gitTop, timeout: 5000, stdio: 'ignore' })); } catch (e) { detached = !!e && e.status === 1; }
  }
  if (under && detached) process.exit(0);
}
// Trivial-diff exemption: total churn across this session's change - this commit plus what the session's
// earlier trivial commits took in (barSet, above; the whole uncommitted tree when no session start can be read).
// A chained `git add && git commit` stages mid-command, so the commit's set reads the add's own paths.
// <= 2 files and <= 15 changed lines is the typo/one-line class; anything bigger gates.
// Untracked files the commit takes in count too: `git diff HEAD` never lists them, so a feature landing in NEW
// files only (`git add -A && git commit`) read as 'nothing to commit' and passed ungated
// (reproduced: three 40-line new files, exit 0). An untracked file is one row and its line
// count is its churn - the same arithmetic a staged add gets.
try {
  const set = barSet();
  if (set.own && !set.own.count) process.exit(0); // this commit takes nothing in - let git say so
  let files = set.tracked.size;
  let lines = [...set.tracked.values()].reduce((n, c) => n + c, 0);
  for (const f of set.untracked) {
    files += 1;
    if (files > 2) break; // already past the bar - no need to size the rest
    try { lines += fs.readFileSync(path.join(set.top, f), 'utf8').split('\n').filter(Boolean).length; } catch { /* unreadable - the row alone counts */ }
  }
  if (files === 0) process.exit(0); // nothing to commit - let git say so
  if (files <= 2 && lines <= 15) { recordTrivial(set); process.exit(0); }
} catch {
  process.exit(0); // not a git repo / git unavailable - never block on our own failure
}
const c = readReceipt('COMMIT-GATE', sessionStartMs());
if ((c.waived || c.verified) && !c.problem) process.exit(0);
process.stderr.write(
  (c.stale
    ? `Blocked: git commit - the gate receipt at ${c.gate} is older than 2h or was written before this session began, and is treated as absent (a stale receipt from an earlier round or another session is not this diff's review).\n`
    : c.problem
      ? `Blocked: git commit - the gate receipt at ${c.gate} does not hold: ${c.problem}.\n`
      : `Blocked: git commit on a non-trivial diff without the pre-commit gate receipt.\n`) +
    `Run the checkpoint first (load habits-commit-checkpoint): the formatter, then task-verify-code or review-code, plus review-security\n` +
    `on auth, crypto, secrets, payment or data-access paths. Then write ${c.write} with the skill's scripts/receipt.js\n` +
    `(\`commit\`) - it fills head:, spec: and the counts from git:\n` +
    `  VERIFIED <what was reviewed, one phrase>\n` +
    `  authorized: "<the user's words asking for THIS commit, verbatim>"  (in English, or answered: <the label they picked>)\n` +
    `  live-probe: <what you ran, or NOT RUN - <reason>>\n` +
    `  format: <the formatter check> - clean over <N> staged files\n` +
    `  findings: <the review's Findings field - a count by severity, or none>\n` +
    `The quote carries a commit verb and is never an option label this run wrote. A waiver is WAIVED - "<their words>"\n` +
    `or WAIVED - answered: <the label they picked>; 'commit it' is no waiver. Never fabricate either, never split a change\n` +
    `to slip under the trivial bar, and clear the file after the batch's last commit (one receipt covers commits taking in\n` +
    `only the files its spec: names).`,
);
process.exit(2);
