#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matcher: Bash): the PUBLISH ceremony, mechanized - one hook because commit
// and push are one gate family and share the receipt machinery, the heredoc blanking and the
// quote masking below. A non-trivial
// `git commit` runs only after the house review gate (alfred-task-verify-code, plus
// /security-review on auth/crypto/data-access paths) or the user's explicit waiver -
// recorded as a receipt file the gate step writes. Prose measured unreliable: 8 ungated
// commit events across 6 audited sessions, including one where baseline-git.md was
// provably read into context the same session and skipped anyway, and one commit with
// no user authorization at all. Trivial diffs pass untouched (the rule's own
// typo/one-line exemption, judged from the working-tree diff). exit 2 = block
// (stderr fed back to the model); exit 0 = allow.
// The PUBLISH half: `git push` and `gh pr merge` put the work where other people (and CI) get
// it, and NOTHING gated them - replayed across four bundles, every push and merge passed every
// guard. In one session the FIRST state-changing act of the run published unpushed commits 18
// minutes before any receipt existed, and 40 files reached a shared `develop` ungated. Same
// receipt shape, its own file (<docs-root>/flow/PUSH-GATE), and ALFRED_CODE_PUSH_GATE=0 turns
// it off for a repo whose remote is already gated by branch protection or a required review.
// Receipt lifecycle: the gate step writes <docs-root>/flow/COMMIT-GATE when its checks
// pass (VERIFIED <scope>) or the user explicitly waives (WAIVED - "<their words>");
// the commit turn clears it after the commit lands. Receipts older than
// MAX_RECEIPT_AGE_MS are treated as absent - the stale-stamp lesson from the approval
// gate (a leftover stamp silently authorized later, unrelated runs).
const fs = require('fs');
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const path = require('path');
const { execSync, execFileSync, spawnSync } = require('child_process');

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
const command = String((payload.tool_input || {}).command || '');
// The publish half is on by default and switched off per install for a repo whose remote already
// gates the branch (protection rules, a required review). Any value but "0" leaves it on.
const PUSH_GATE_ON = envOf(process.env, 'PUSH_GATE') !== '0';
// A heredoc body is DATA, not shell: a plan document, a commit-message draft or a receipt that
// merely describes `git commit` is inert text. Matching it blocked a 47KB plan write and cost a
// full re-author of the same document (~19.8k output + 24.4k cache-write, ~3 minutes), and a
// second session lost a plan-doc write the same way. Blank the payload spans before matching,
// keeping the character count so commitMatch.index still points into the real command.
const scanned = command.replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => m.replace(/[^\n]/g, ' '),
);
// A QUOTED span is data for exactly the same reason a heredoc body is: a grep pattern, an echo
// label or a search term that merely CONTAINS `git commit` invokes nothing. Blanking it matters
// twice over. It blocked the stack's OWN mandated sweep (alfred-capture-stack-usage greps every
// `git commit` event in a transcript) - and the session then completed that sweep by obfuscating
// the token, which is the dangerous half: the evasion the false positive TAUGHT defeats this gate
// on a genuine commit. Replayed on the pre-fix hook: `grep -o 'git commit' f` exit 2,
// `echo 'run git commit later'` exit 2, but `C=commit; git $C -m x` exit 0 and
// `git "com""mit" -m x` exit 0. Length is preserved so commitMatch.index still points into
// the real command, and the fill is a NON-space so the span stays one opaque argument token:
// blanking `git -C "<sibling>" commit` to spaces dissolved the -C argument and the whole match
// with it, which un-gated a commit in another checkout (caught by this hook's own tests).
const scannedQuoted = scanned
  .replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, 'x'))
  .replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, 'x'));
// A real `git commit` subcommand (allowing -C/-c/global flags between), not e.g. `git log --grep commit`.
let commitMatch = scannedQuoted.match(/\bgit(\s+-[cC]?\s*\S+|\s+--\S+)*\s+commit\b/);
if (!commitMatch) {
  // ...and a `git` whose SUBCOMMAND is not a plain literal cannot be judged at all: `git $C`,
  // `git ${VERB}`, `git $(echo commit)`, `git "com""mit"`. Reading those as 'not a commit' is
  // precisely what makes the obfuscation above work, so they are UNJUDGEABLE and gate like a
  // commit rather than passing. A quoted literal that normalizes to `commit` is a commit.
  const re = /(?:^|[;&|(]\s*|\s)git\s+((?:(?:-[cC]\s*\S+|--\S+)\s+)*)(\S+)/g;
  let m;
  while ((m = re.exec(command))) {
    const sub = m[2];
    const spliced = sub.replace(/["']/g, '');
    if (/[$`]/.test(sub) || (spliced === 'commit' && /["']/.test(sub))) {
      commitMatch = { 0: m[0].trim(), index: m.index, opaque: true };
      break;
    }
  }
}
// The PUBLISH verbs. Matched on the same quote-masked copy the commit verb is, so a `git push`
// inside a report's prose or a commit message is text, not an act - the false-positive pair this
// gate MUST not reproduce cost 430,740 tokens when a report write was denied for quoting a merge
// command. `--dry-run` / `-n` publishes nothing, and neither does a push with nothing ahead of
// its upstream.
const publishMatch = PUSH_GATE_ON
  ? (scannedQuoted.match(/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+push\b/)
    || scannedQuoted.match(/(?:^|[;&|(]\s*|\s)gh\s+pr\s+merge\b/))
  : null;

// --- add -N without a chained reset -------------------------------------------------------
// baseline-git.md:9 mandates the scope survey as ONE Bash call with the reset chained on the
// end: `git add -N . && git diff HEAD --stat; git reset -q`. A bare `git add -N .` left its
// intent-to-add entries open across 6 more Bash calls in one measured session, ending in an
// 8-call fsck/dangling-blob forensic chase and an unrequested re-stage that flipped a partially
// staged file to fully staged. Independent of commit/push - it fires on its own. Scoped to the
// WHOLE-TREE shape (`-N .`, or -N with no pathspec): `git add -N <new file>` before a `git add -p`
// is a deliberate staging move with one file's entry to clear, not the survey this rule is about.
const addNMatch = scannedQuoted.match(/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+add\s+(?:-N|--intent-to-add)(?:\s+\.)?\s*(?=$|[;&|)])/)
  || scannedQuoted.match(/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+add\s+\.\s+(?:-N|--intent-to-add)\s*(?=$|[;&|)])/);
if (addNMatch && !/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+reset\b/.test(scannedQuoted)) {
  process.stderr.write(
    `Blocked: ${addNMatch[0].trim()} with no git reset in the same call - intent-to-add entries stay\n` +
    `open across every Bash call after this one until something clears them (measured: 6 calls open,\n` +
    `an 8-call fsck/dangling-blob chase, and an unrequested re-stage that flipped a partially staged\n` +
    `file to fully staged). Chain the reset onto the SAME call, the shape baseline-git.md:9 gives:\n` +
    `  git add -N . && git diff HEAD --stat; git reset -q\n` +
    `Retry with the reset included.`,
  );
  process.exit(2);
}

// Every `git add` in the command, by the offset of its `git` - judged below against what was untracked before the
// session started, so a bare `git add -A` in its own call is read too.
const addCalls = [...scannedQuoted.matchAll(/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+add\b/g)].map((m) => m.index + m[0].search(/git/));
if (!commitMatch && !publishMatch && !addCalls.length) process.exit(0);

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
let root = payload.cwd || projectDir || process.cwd();
const MOUNT_RE = /^(?:\/cygdrive)?\/([A-Za-z])(?=\/|$)/;
const nativePath = (p) => (process.platform === 'win32'
  ? String(p).replace(MOUNT_RE, (m, d) => `${d.toUpperCase()}:\\`)
  : String(p));
const unq = (s) => s.replace(/^["']|["']$/g, '');
// the FIRST of the two acts anchors the cd scan - everything before it moved the cwd
const actIndex = Math.min(
  commitMatch ? commitMatch.index : Number.MAX_SAFE_INTEGER,
  publishMatch ? publishMatch.index : Number.MAX_SAFE_INTEGER,
  addCalls.length ? addCalls[0] : Number.MAX_SAFE_INTEGER,
);
// PowerShell moves the cwd with Set-Location (sl, chdir) or Push-Location (pushd), a -Path or
// -LiteralPath name optional - the matcher claims that tool, so its spelling anchors the same way.
// The directory the LAST cd before `index` moved to, resolved from `base` (unchanged when there is none).
const cdBefore = (base, index) => {
  const cds = [...command.slice(0, index).matchAll(/(?:^|&&|;|\n|\|)\s*(?:cd|chdir|pushd|set-location|sl|push-location)\s+(?:-(?:literal)?path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/gi)];
  return cds.length ? path.resolve(base, nativePath(unq(cds[cds.length - 1][1]))) : base;
};
root = cdBefore(root, actIndex);
// the match came off the quote-masked copy, so read the -C ARGUMENT back out of the real
// command - the mask keeps the offsets, not the path (a masked `-C "<sibling>"` resolved to a
// directory of x's, judged this repo instead, and let the sibling commit through ungated).
const rawOf = (m) => (m && !m.opaque ? command.substr(m.index, m[0].length) : (m ? m[0] : ''));
const dashC = rawOf(publishMatch || commitMatch).match(/\s-C\s*("[^"]+"|'[^']+'|\S+)/);
if (dashC) root = path.resolve(root, nativePath(unq(dashC[1])));
// The diff and the receipt belong to the repo git runs in. When that is the project's own repo, the
// project dir stays the anchor: a subfolder cwd, or a project that is a subfolder of its repo, reads
// the receipt where the session writes it.
const topOf = (dir) => {
  try { return fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { return null; }
};
const gitTop = topOf(root);
if (projectDir && gitTop && gitTop === topOf(projectDir)) root = projectDir;
else if (gitTop) root = gitTop;
// git's own stderr stays out of the hook's: the @{u} probes print `fatal: no upstream` on every
// first push, and the harness shows the model the hook's stderr as the denial reason.
const git = (args) => execSync(`git ${args}`, { cwd: root, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
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
// What was untracked when this session started (docs-session.js writes it once per session, root-relative, spelled
// with core.quotePath=false) is not the session's change: out of the count and the trivial bar, and a git add that
// would sweep it in is blocked below. No record - an older install, no SessionStart, no session id - is an empty set.
function preExisting() {
  const sid = String(payload.session_id || '').replace(/[^\w-]/g, '');
  if (!sid) return new Set();
  try { return new Set(fs.readFileSync(path.resolve(root, docsRootEnv(), 'flow', `untracked-at-start-${sid}`), 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); }
}
function changedFiles() {
  const pre = docsPrefix();
  const before = preExisting();
  const keep = (f) => f && !(pre && f.replace(/\\/g, '/').startsWith(pre));
  const tracked = git('diff HEAD --name-only').split('\n').filter(keep);
  const untracked = git('-c core.quotePath=false ls-files --others --exclude-standard').split('\n').filter((f) => keep(f) && !before.has(f));
  return { tracked, untracked, count: tracked.length + untracked.length };
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
// changedFiles() excludes them - the receipt lives there and names no project of its own.
function pushTouchedProjects() {
  let files = [];
  try { files = git('diff @{u}..HEAD --name-only').split('\n').filter(Boolean); } catch { files = []; }
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
//            baseline-security.md sets. Twice measured: a receipt read 'inline security review (0
//            findings)' with zero category text anywhere in the turn.
//   carried- a stamp minted from a carried resume block says so, or the freshness check is
//            silently satisfied by a re-mint of a 9h30m-old answer.
// A PENDING draft placeholder matches the bare prefix, so the prefix alone is never the test
// (measured: a PENDING draft sat gate-passing for ~2 minutes).
const CONSENT_VERB = /\b(commit|commits|committing|push|pushes|pushing|land|lands|landing|ship|ships|shipping|merge|merges|merging|publish|publishes|publishing|release|releases|releasing|go ahead|do it|approve[ds]?|yes)\b/i;
const CONSENT_VERB_CYR = /(коміт|комміт|закоміт|запуш|пуш|залив|злий|мерж|злит|відправ|отправ|випуст|выпуст|дава[йй]|погоджу|согласен|схвал|так, |да, )/i;
const QUOTED = /["'“‘”’]([^"'“‘”’]*)["'“‘”’]/;

// The transcript tail, read once and shared by the two checks that need it. 256KB is the same
// window every other guard reads; a receipt is minted within a turn or two of its evidence.
let _tail;
function tail() {
  if (_tail !== undefined) return _tail;
  _tail = '';
  try {
    const tp = payload.transcript_path;
    if (tp) {
      const size = fs.statSync(tp).size;
      const start = Math.max(0, size - 256 * 1024);
      const fd = fs.openSync(tp, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      _tail = buf.toString('utf8');
    }
  } catch { _tail = ''; }
  return _tail;
}
// Is this exact string one of the assistant's own AskUserQuestion option labels? Compared with the
// `(Recommended)` marker STRIPPED, because the harness stores the marked label as the user's answer
// (correction 3) - so the marker's presence proves nothing either way.
function isOwnOptionLabel(span) {
  const norm = (t) => String(t).replace(/\s*\(recommended\)\s*$/i, '').trim().toLowerCase();
  const want = norm(span);
  if (!want) return false;
  for (const m of tail().matchAll(/"label"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    let lbl;
    try { lbl = JSON.parse(`"${m[1]}"`); } catch { lbl = m[1]; }
    if (norm(lbl) === want) return true;
  }
  return false;
}
// A skill the user TYPED writes no Skill call, only the harness's `<command-name>` row, and it is
// as much a run of that skill as the model's own call (measured: slash-run loops, zero Skill events).
const skillCallRan = () => /"name"\s*:\s*"Skill"|<command-name>\/(?:[\w-]+:)?(?:alfred|project)-[\w-]+<\/command-name>/.test(tail());

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
  const field = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*:?[ \\t]*(.*)$`, 'im').exec(text);
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
    return m ? m[1].trim() : null;
  };
  const consents = (t) => CONSENT_VERB.test(t) || CONSENT_VERB_CYR.test(t);

  if (waived) {
    const w = quotedOf(first);
    if (!w) r.problem = 'the WAIVED line carries no quoted words - a waiver is the user\'s own sentence, in quotes, on that line';
    return r;
  }

  // --- VERIFIED: consent -------------------------------------------------------------------
  const authorized = quotedOf(field('authorized'));
  const answered = field('answered') || field('answer');
  if (authorized) {
    if (!consents(authorized)) {
      r.problem = `the authorized: quote (${JSON.stringify(authorized).slice(0, 60)}) carries no commit / push / land / ship verb - it records the user saying something, not the user asking for THIS act`;
      return r;
    }
    if (isOwnOptionLabel(authorized)) {
      r.problem = 'the authorized: quote is character-identical to an option label THIS run wrote - that is the model\'s sentence, not the user\'s. Consent given by picking an option is spelled `answered: <the chosen label>` instead';
      return r;
    }
  } else if (answered) {
    if (!answered.replace(/^option\s+\d+\s*/i, '').replace(/["'“‘”’]/g, '').trim()) {
      r.problem = 'the answered: line names no option';
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
  const h = head.replace(/[^0-9a-fA-F]/g, '');
  if (realHead && h && !realHead.startsWith(h) && !h.startsWith(realHead)) {
    r.problem = `head: ${head} is not this repo's HEAD (${realHead.slice(0, 12)}) - the review ran against a different commit`;
    return r;
  }
  const spec = field('spec');
  if (!spec) {
    r.problem = 'no spec: line naming the file set reviewed (measured: a receipt asserted a review of a 17-file diff in which 9 files had been read)';
    return r;
  }
  // The count is compared against the working tree only for a COMMIT: a publish's spec names the
  // commit set leaving the machine, which has nothing to do with what is uncommitted here.
  const claimed = (opts && opts.countAgainstTree) ? /(\d+)\s*files?\b/i.exec(spec) : null;
  if (claimed) {
    let actual = 0;
    try { actual = changedFiles().count; } catch { actual = 0; }
    if (actual && Number(claimed[1]) < actual) {
      r.problem = `spec: claims ${claimed[1]} file(s) but the tree has ${actual} uncommitted - review the rest, or narrow what this act commits`;
      return r;
    }
  }
  if (!/live[-\s_]?probe/i.test(bodyText)) {
    r.problem = 'no live-probe line - a VERIFIED review states what it actually ran, either the quoted output or `NOT RUN - <reason>` (spelled live-probe, live probe or live_probe)';
    return r;
  }
  // The probe's SCOPE (push only - opts.touchedProjects is set only for PUSH-GATE): a receipt
  // naming one project's narrow run passed both gates once and CI broke right after the push.
  // Required only when the probe actually ran something AND the commit set going out touches
  // more than one identifiable project - a NOT RUN probe, a single-project push, or a pure docs
  // diff names nothing extra.
  const probeLine = (bodyText.match(/^\s*live[-\s_]?probe\s*:?[ \t]*(.*)$/im) || [])[1] || '';
  const probeRan = !/\bNOT RUN\b/i.test(probeLine);
  if (opts && opts.touchedProjects && opts.touchedProjects.length && probeRan) {
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
  // A security-flavored VERIFIED line must name what it checked - baseline-security.md's honesty
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
  // The loop arm names both spellings: the 1.x `quality-loop` and the 2.0.0 `alfred-loop-<name>`
  // family - the rename left this arm matching nothing, so a receipt naming the loop minted consent.
  if (/\b(project-)?verify-(code|plan)\b|\bquality-loop\b|\balfred-loop-[a-z-]+/i.test(first) && !skillCallRan() && !field('carried')) {
    r.problem = `the VERIFIED line names a verify skill but no Skill call ran in this session - if this review is carried from an earlier cycle say so: \`carried: <cycle id>, reviewed <date>\``;
    return r;
  }
  return r;
}

// touchedProjects is computed only for PUSH-GATE - it drives the diff-vs-upstream git call the
// scope check needs, and a COMMIT-GATE receipt is never judged against it.
const receiptOpts = (name) => ({
  countAgainstTree: name === 'COMMIT-GATE',
  touchedProjects: name === 'PUSH-GATE' ? pushTouchedProjects() : null,
});
function readReceipt(name) {
  const gate = path.resolve(root, docsRoot, 'flow', name);
  let stale = false;
  let body = '';
  try {
    const age = Date.now() - fs.statSync(gate).mtimeMs;
    if (age > MAX_RECEIPT_AGE_MS) stale = true;
    else body = fs.readFileSync(gate, 'utf8');
  } catch {
    // absent or unreadable - no gate receipt
  }
  if (stale) return { gate, stale, waived: false, verified: false, problem: null };
  return { gate, stale, ...judgeReceipt(body, receiptOpts(name)) };
}
// An atomic write-receipt-then-act command carries its own receipt: the gate file is
// written (with a VERIFIED/WAIVED line in the same command text) before git runs. Blocking
// it would reject the receipt discipline this gate exists to enforce (measured: the
// write+act+clear-in-one-call shape is the corpus's dominant conforming pattern).
// All matches are bound to the segment BEFORE the act (a commit message merely mentioning
// COMMIT-GATE VERIFIED is not a receipt), and the receipt must be WRITTEN, not merely
// mentioned: requiring the words anywhere in that text let a single
// `echo "... VERIFIED ... authorized: ..." > notes.txt` satisfy the gate on a real dirty tree
// (reproduced). The redirect/tee/printf/cat has to target a path ending in flow/<NAME>.
function carriesOwnReceipt(name, upto) {
  const pre = command.slice(0, upto);
  if (!pre.includes(name)) return false;
  const writes = new RegExp(`(?:>>?|\\btee\\s+(?:-a\\s+)?|\\bprintf\\b[^>]*>>?|\\bcat\\s*>>?)\\s*["']?(\\S*flow\\/${name})\\b`);
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
if (publishMatch) {
  const act = rawOf(publishMatch).trim().replace(/\s+/g, ' ');
  const isGitPush = /\bgit\b/.test(act);
  // a dry run publishes nothing, and neither does a push with nothing ahead of its upstream
  const dryRun = /\s--dry-run\b/.test(command) || (isGitPush && /\bpush\b[^;|&]*\s-n\b/.test(command));
  let ahead = true;
  if (isGitPush) {
    try { ahead = git('log @{u}..HEAD --oneline').length > 0; } catch { ahead = true; } // no upstream = a new branch, which publishes
  }
  if (!dryRun && ahead && !carriesOwnReceipt('PUSH-GATE', publishMatch.index)) {
    const r = readReceipt('PUSH-GATE');
    if (!((r.waived || r.verified) && !r.problem)) {
      process.stderr.write(
        (r.stale
          ? `Blocked: ${act} - the publish receipt at ${r.gate} is older than 2h and is treated as absent (a stale receipt from an earlier round did not review THIS push).\n`
          : r.problem
            ? `Blocked: ${act} - the publish receipt at ${r.gate} does not hold: ${r.problem}.\n`
            : `Blocked: ${act} without the publish gate receipt.\n`) +
          `Pushing and merging are where the work leaves this machine - other people and CI get it,\n` +
          `and a shared branch cannot be un-pushed quietly. Measured across four sessions: every\n` +
          `push and merge passed every guard, one of them publishing 40 files to a shared develop\n` +
          `and one running before any review receipt existed at all.\n\n` +
          `Say what is being published and to which branch, get the user's answer, then write\n` +
          `${r.gate}\n` +
          `with these lines:\n` +
          `  VERIFIED <what is being published, one phrase>\n` +
          `  authorized: "<the user's words asking for THIS publish, verbatim>"   (or, when they\n` +
          `    picked an option instead of typing, answered: <the chosen label>)\n` +
          `  head: <git rev-parse HEAD>\n` +
          `  spec: <N files - the set this publish covers>\n` +
          `  live-probe: <what you actually ran, or NOT RUN - <reason>>\n` +
          `  scope: <workspace, or the project list the probe ran - required when this push touches\n` +
          `    more than one project>\n` +
          `The quoted words must carry a publish verb and must not be an option label this run\n` +
          `wrote. If they EXPLICITLY waived it this conversation, write WAIVED - "<their words,\n` +
          `verbatim>" instead; never fabricate either quote. Then retry, and clear the file once\n` +
          `it lands.\n` +
          `A repo whose remote is already gated (branch protection, a required review) can turn\n` +
          `this half off for good: ALFRED_CODE_PUSH_GATE=0 in the settings.json env block.`,
      );
      process.exit(2);
    }
  }
}

// --- the COMMIT gate ----------------------------------------------------------------------
if (!commitMatch && !addCalls.length) process.exit(0);

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
// Shell words, quote-aware (`git add "cfg file.js"` is one path) - shell-writes.js beside this hook.
let shellWords = (text) => text.trim().split(/\s+/).filter(Boolean).map(unq);
try { ({ shellWords } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* a copy that runs before it lands splits on whitespace */ }
function lineFinding(file, text, lineNo) {
  if (/^(<{7}|>{7}) /.test(text)) return 'a conflict marker';
  if (SECRET_SHAPE.test(text) || PEM_PRIVATE.test(text)) return 'a credential-shaped literal';
  const hidden = hiddenChars ? hiddenChars.hiddenInLine(text, lineNo, file, () => true) : [];
  if (hidden.length) return `a hidden character U+${hidden[0]} - write it as an escape`;
  if (/\.(md|mdx|txt|rst)$/i.test(file)) return '';
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && /(^|[^\w.'"`])debugger\s*;?\s*$/.test(text)) return 'a debugger statement';
  if (/\.cs$/.test(file) && /\bDebugger\.(Break|Launch)\s*\(/.test(text)) return 'Debugger.Break / Launch';
  if (TEST_FILE.test(file) && /\b(fdescribe|fit)\s*\(|\b(describe|it|test)\.only\s*\(/.test(text)) return 'a focused test';
  return '';
}
// The words of the git call starting at `index`: the segment ends on the QUOTE-MASKED copy (a `;` in a
// commit message is text), then the real text is split quote-aware. `afterVerb` drops `git`, its
// global options and the verb itself.
const callWords = (index) => {
  const rest = scannedQuoted.slice(index);
  const end = rest.search(/[;&|\n]/);
  return shellWords(command.slice(index, index + (end < 0 ? rest.length : end)));
};
const afterVerb = (words) => {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
  return words.slice(i + 1);
};
// A `<docs-path>/flow/<name>` ALLOW receipt's lines - the USER's answer to a block, this session's own, under 8h.
function allowLines(name) {
  const file = path.resolve(root, docsRootEnv(), 'flow', name);
  try {
    const st = fs.statSync(file);
    let sessionStartMs = 0;
    try {
      const tr = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = tr.birthtimeMs && tr.birthtimeMs !== tr.ctimeMs ? tr.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs <= 8 * 60 * 60 * 1000 && !(sessionStartMs && st.mtimeMs < sessionStartMs)) {
      return { file, lines: fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) };
    }
  } catch { /* absent or unreadable - nothing allowed */ }
  return { file, lines: [] };
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
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* keep the spelling */ }
  const swept = new Set();
  for (const at of addCalls) {
    const words = callWords(at);
    let cwd = cdBefore(payload.cwd || projectDir || process.cwd(), at);
    for (let i = 1; i < words.length && words[i].startsWith('-'); i += words[i] === '-C' || words[i] === '-c' ? 2 : 1) {
      if (words[i] === '-C' && words[i + 1]) cwd = path.resolve(cwd, nativePath(words[i + 1]));
    }
    try { cwd = fs.realpathSync(cwd); } catch { /* git reports the missing directory itself */ }
    const args = afterVerb(words);
    const flags = args.slice(0, args.includes('--') ? args.indexOf('--') : args.length).filter((a) => a.startsWith('-'));
    const quiet = flags.some((a) => /^--(intent-to-add|dry-run|patch|interactive|edit|update|refresh)$/.test(a) || (/^-[^-]/.test(a) && /[nNpieu]/.test(a.slice(1))));
    if (quiet) continue;
    const top = topOf(cwd);
    if (!top) continue;
    const r = spawnSync('git', ['-c', 'core.quotePath=false', 'add', '--dry-run', ...args], { cwd, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
    const rel = (name) => path.relative(root, path.resolve(root, docsRootEnv(), 'flow', name)).split(path.sep).join('/');
    const sid = String(payload.session_id || '').replace(/[^\w-]/g, '');
    process.stderr.write(
      `Blocked: this git add stages ${swept.length} path(s) that were untracked before this session started -\n` +
      `${swept.slice(0, 15).map((f) => `  ${f}`).join('\n')}\n` +
      (swept.length > 15 ? `  ... and ${swept.length - 15} more\n` : '') +
      `They are not this session's change (the list: ${rel(`untracked-at-start-${sid}`)}). Stage the session's own\n` +
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
function commitScope() {
  const scope = { dryRun: false, tracked: false, untracked: false, paths: [], commitPaths: [], mode: '' };
  if (!commitMatch.opaque) {
    const { flags, paths } = commitArgs(afterVerb(callWords(commitMatch.index)));
    scope.dryRun = flags.has('--dry-run');
    scope.tracked = flags.has('-a') || flags.has('--all') || flags.has('--pathspec-from-file');
    if (paths.length) {
      scope.commitPaths = paths;
      scope.mode = flags.has('-i') || flags.has('--include') ? 'include' : 'only';
    }
  }
  const before = scannedQuoted.slice(0, commitMatch.index);
  const addRe = /(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]?\s*\S+|\s+--\S+)*\s+add\b/g;
  let m;
  while ((m = addRe.exec(before))) {
    const args = afterVerb(callWords(m.index + m[0].search(/git/)));
    if (args.some((a) => /^(-N|--intent-to-add)$/.test(a))) continue; // a scope survey stages nothing
    if (args.some((a) => /^(-u|--update)$/.test(a))) scope.tracked = true;
    if (args.some((a) => /^(-A|--all)$/.test(a) || a === '.' || a === ':/')) { scope.tracked = true; scope.untracked = true; continue; }
    scope.paths.push(...args.filter((a) => !a.startsWith('-')));
  }
  return scope;
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
    const r = spawnSync('git', [...q, ...args], { cwd: root, timeout: 5000, maxBuffer: budget, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.error && r.error.code !== 'ENOBUFS') throw r.error;
    if (!r.error && r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}`);
    const text = (r.stdout || Buffer.alloc(0)).subarray(0, budget).toString('utf8');
    budget -= Buffer.byteLength(text);
    return text;
  };
  const list = (args) => execFileSync('git', [...q, args[0], '-z', ...args.slice(1)], { cwd: root, timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
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
      const r = spawnSync('git', ['cat-file', '--batch-check=%(objectsize)'], { cwd: top, input: rows.map((x) => `:${x.path}`).join('\n') + '\n', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
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
  const { file: allowFile, lines: allow } = allowLines('STAGED-SCAN-ALLOW');
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
// Trivial-diff exemption: total churn across the uncommitted tree (staged + unstaged -
// a chained `git add && git commit` stages mid-command, so staged-only would undercount).
// <= 2 files and <= 15 changed lines is the typo/one-line class; anything bigger gates.
// Untracked files count too: `git diff HEAD` never lists them, so a feature landing in NEW
// files only (`git add -A && git commit`) read as 'nothing to commit' and passed ungated
// (reproduced: three 40-line new files, exit 0). An untracked file is one row and its line
// count is its churn - the same arithmetic a staged add gets.
try {
  const pre = docsPrefix();
  const rows = git('diff HEAD --numstat').split('\n')
    .filter((r) => r && !(pre && (r.split('\t')[2] || '').replace(/\\/g, '/').startsWith(pre)));
  let files = rows.length;
  let lines = rows.reduce((n, r) => {
    const [a, d] = r.split('\t');
    return n + (parseInt(a, 10) || 0) + (parseInt(d, 10) || 0);
  }, 0);
  for (const f of changedFiles().untracked) {
    files += 1;
    if (files > 2) break; // already past the bar - no need to size the rest
    try { lines += fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(Boolean).length; } catch { /* unreadable - the row alone counts */ }
  }
  if (files === 0) process.exit(0); // nothing to commit - let git say so
  if (files <= 2 && lines <= 15) process.exit(0);
} catch {
  process.exit(0); // not a git repo / git unavailable - never block on our own failure
}
const c = readReceipt('COMMIT-GATE');
if ((c.waived || c.verified) && !c.problem) process.exit(0);
process.stderr.write(
  (c.stale
    ? `Blocked: git commit - the gate receipt at ${c.gate} is older than 2h and is treated as absent (a stale receipt from an earlier round is not this diff's review).\n`
    : c.problem
      ? `Blocked: git commit - the gate receipt at ${c.gate} does not hold: ${c.problem}.\n`
      : `Blocked: git commit on a non-trivial diff without the pre-commit gate receipt.\n`) +
    `The checkpoint (the alfred-habits-commit-checkpoint skill - load it) runs BEFORE a non-trivial commit: the formatter, then\n` +
    `the house review alfred-task-verify-code - plus /security-review when the diff touches\n` +
    `auth/crypto/secrets/payment/data-access paths (baseline-security.md). When those pass, write\n` +
    `${c.gate}\n` +
    `with these lines:\n` +
    `  VERIFIED <what was reviewed, one phrase>\n` +
    `  authorized: "<the user's words asking for THIS commit, verbatim>"   (or, when they picked\n` +
    `    an option instead of typing, answered: <the chosen label>)\n` +
    `  head: <git rev-parse HEAD>\n` +
    `  spec: <N files - the set the review covered>\n` +
    `  live-probe: <what you actually ran, or NOT RUN - <reason>>\n` +
    `The VERIFIED line proves the review ran; the authorized line proves the user asked for the\n` +
    `commit, and its quote must carry a commit verb and must not be an option label this run\n` +
    `wrote (measured: a self-written VERIFIED receipt passed this gate on a commit no user\n` +
    `requested, and 'authorized: "what time is it?"' passed it too).\n` +
    `Then retry the commit. If the user EXPLICITLY waived the gate this conversation, write\n` +
    `WAIVED - "<their words, verbatim>" instead; never fabricate either quote, and 'commit\n` +
    `it' alone is an instruction to commit, not a waiver of the review. Do not split a real\n` +
    `change into tiny commits to slip under this gate's trivial-diff exemption. Clear the\n` +
    `file once the commit lands (after the LAST commit when one receipt covers a batch).`,
);
process.exit(2);
