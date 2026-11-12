#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash): enforce alfred-navigation.md's hard rule - "Read
// is for code you've ALREADY located, never to find a symbol." Blocks a whole-file Read of a
// large source file so navigation goes through the navigation tools (LSP documentSymbol -> goToDefinition, or the server the tool order names)
// first; on Bash it blocks the same dump routed around the Read tool (a bare `cat file.ts` -
// measured: one session cat-ed the exact file the Read matcher had blocked, unblocked, and a
// 47-file grep loop dumped ~19.8k tokens the guard never saw). It also caps CUMULATIVE ranged
// reads per file per session: 2-3 half-splits that reconstruct the whole file satisfied the
// per-call check in 7 files across one run with zero counter-examples, so past ~60% coverage
// the remainder goes through the navigation tools. A cat whose output is redirected into a file is a copy,
// not a dump, and passes. exit 2 = block (stderr fed back); exit 0 = allow.
const fs = require('fs');
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
// data-root-reader (meta/shared-rules.json): the data root is always .alfred. An absolute ALFRED_CODE_DATA_PATH is a
// harness's scratch and is kept; anything else is .alfred.
const dataRoot = (env = process.env) => { const raw = String(envOf(env, 'DATA_PATH') || '').trim().replace(/\\/g, '/'); return /^(?:\/|[A-Za-z]:\/)/.test(raw) ? raw.replace(/\/+$/, '') || '.alfred' : '.alfred'; };
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${dataRoot()}/docs`;
const os = require('os');
const pathMod = require('path');
// The judging budget (review M3 of 2.1.6), its thresholds in this one place. It counts WORK, never time, so a
// command gets the same verdict on any machine under any load: each judging step charges the characters it reads,
// past JUDGE_MAX_WORK the command is blocked - judged the conservative way, never let through. The credential guard
// carries the same budget. The count is `global.JUDGE_WORK`; a test preload lowers the ceiling through
// `global.JUDGE_WORK_MAX`.
// 20x the most any of 54,503 recorded commands cost (99,197), and about a second of judging
const JUDGE_MAX_WORK = 2000000;
const JUDGE_WORK = global.JUDGE_WORK = { used: 0, max: Number(global.JUDGE_WORK_MAX) || JUDGE_MAX_WORK };
class JudgeBudget extends Error {}
function judgeTick(units) { JUDGE_WORK.used += units; if (JUDGE_WORK.used > JUDGE_WORK.max) throw new JudgeBudget('work'); }

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-read-whole-file');
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
const GATED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)$/i; // any case: `BIG.TS` read whole passed
// The image formats the Read tool renders for the model (the vision page's supported formats), judged by pixels, not bytes.
const RENDERED_IMAGE = /\.(?:png|jpe?g|gif|webp)$/i;
// Same extensions, unanchored - a sweep command names its files inside a glob or a loop body,
// never as the string's own tail, so the anchored form above can never match a command line.
const GATED_EXT_ANY = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)\b/i;
// The SWEEP branch adds `md`. A loop over every SKILL.md in an install is the single most measured
// dump shape in the collection - 84.1KB from 35 files in one call, 120KB from 46 in another, and
// the only thing that stopped either was the harness's own persisted-output cap. Markdown is not
// symbol-navigable, so the single-file size check below deliberately still ignores it: one named
// `.md` file is a fine read, thirty-five of them in a loop is not.
const SWEEP_EXT_ANY = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html|md)\b/i;
// Small files are cheap to read whole. 200, not 100: measured across four real
// sessions (315 blocks), ~71% of blocks hit 100-200-line files where the forced
// navigation-server detour costs about what the whole-file read would - the guard only pays above 200.
// 400, not 200 (deep hooks review 2026-10-16, the user's ruling): 485 of 590 sized blocks (82%) in two weeks hit 200-400-line
// files, and after a block the model read about 80% of the file anyway, one request later. The range cap and every shell
// span rule bind only above this line count too.
const THRESHOLD = 400;
// The Read-tool half's size cap for a file with no line count to judge (below); the shell route's slice rule reads it too.
const BIG_BYTES = 60 * 1024;
const lineCountOf = (p) => {
  // Lines, not newline-split pieces: a final newline ends the last line, it does not start another -
  // counted as one, a 200-line file sat one over the threshold it is on.
  try { const t = fs.readFileSync(p, 'utf8'); return t ? t.replace(/\n$/, '').split('\n').length : 0; } catch { return 0; }
};
// Resolve a possibly-relative path the way the session sees it. The hook subprocess's own
// cwd is NOT the Bash tool's persisted cwd (a prior `cd` in another call moves it), so a bare
// relative path must be anchored - same anchor the sibling hooks use (measured: 10 relative
// `cat -n` dumps after a `cd` all resolved ENOENT -> lineCount 0 -> the guard silently passed
// ~20k tokens of whole-file dumps; reproduced: the same payload blocks from the project root).
const anchorDirs = [process.env.CLAUDE_PROJECT_DIR, payload.cwd, process.cwd()].filter((d) => typeof d === 'string' && d);
// A `cd <dir> &&` at the head of the command moves the anchor for everything after it, and a
// relative target then resolves nowhere - which failed CLOSED and denied the call. Add every
// literal `cd` target as one more candidate anchor; a variable or `-` target is unfollowable and
// simply contributes nothing. The sibling cross-project guard tracks the same thing positionally.
const CD_VERB = 'set-location|push-location|chdir|pushd|cd|sl';
const CD_RE = new RegExp(`(?:^|&&|\\|\\||;|\\n|\\(|\\|)\\s*(?:${CD_VERB})\\s+(?:-(?:literal)?path\\s+)?("[^"]+"|'[^']+'|[^\\s;|&()]+)`, 'gi');
// `$VAR` / `${VAR}` that this hook cannot see through. The sibling guard's rule, applied here for
// the same reason: 6 of 12 measured denials in one project named a `$R/...` target, and judging a
// path whose value is unknown is guessing, not gating.
const isVar = (s) => /\$\{?[A-Za-z_]/.test(s);
// A `VAR=value` set in the SAME command is knowable - expand those before giving up on a target.
const assignsOf = (cmd) => {
  const m = new Map();
  for (const a of String(cmd).matchAll(/(?:^|&&|\|\||;|\n|\s)([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g))
    m.set(a[1], a[2].replace(/^["']|["']$/g, ''));
  return m;
};
const expandWith = (assigns, s) => String(s).replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
  (m, br, bare) => (assigns.has(br || bare) ? assigns.get(br || bare) : m));
// Git Bash / MSYS spell a Windows path in POSIX MOUNT form (`/c/Users/...`, `/cygdrive/c/...`),
// which node on win32 resolves against the CURRENT drive instead - the same falsehood that made
// the cross-project guard block a session's own temp cleanup. Translate before resolving; off
// Windows the spelling is a real POSIX path and is never touched.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
// A git object a command prints whole (`git show HEAD:src/a.ts`, `:src/a.ts`), read once and sized as the file it is
// (audit 2026-10-30 HK-19): its spelling is the key the size and line checks below look up before the disk.
const VIRTUAL = new Map();
// The byte size of a possibly-relative path, anchored like the line count; 0 when it is no regular file.
const sizeOf = (raw) => {
  if (VIRTUAL.has(raw)) return VIRTUAL.get(raw).bytes;
  const p = nativePath(raw);
  for (const abs of pathMod.isAbsolute(p) ? [p] : anchorDirs.map((d) => pathMod.join(d, p))) {
    try { const st = fs.statSync(abs); return st.isFile() ? st.size : 0; } catch { /* next anchor */ }
  }
  return 0;
};
const resolveLineCount = (raw) => {
  if (VIRTUAL.has(raw)) return { lc: VIRTUAL.get(raw).lc, resolved: true };
  const p = nativePath(raw);
  if (pathMod.isAbsolute(p)) return { lc: lineCountOf(p), resolved: true };
  for (const d of anchorDirs) {
    const abs = pathMod.join(d, p);
    if (fs.existsSync(abs)) return { lc: lineCountOf(abs), resolved: true };
  }
  return { lc: 0, resolved: false };
};
// The path a possibly-relative target names on disk, anchored the same way, or null when nothing is there.
const resolvedPath = (raw) => {
  const p = nativePath(raw);
  for (const abs of pathMod.isAbsolute(p) ? [p] : anchorDirs.map((d) => pathMod.join(d, p))) if (fs.existsSync(abs)) return abs;
  return null;
};
// The first file a `find <start ...> -name|-iname <literal>` names that is too big to print whole, sized like a `cat` of it
// (audit 2026-10-20 H7: `find src -name big.ts -exec cat {} \;` printed a 900-line file unsized): a gated extension past
// THRESHOLD lines, any other past BIG_BYTES. The start points are the words after `find` up to its first expression word,
// anchored like any target; the walk skips `.git` and `node_modules` and stops judging past NAMED_FIND_CAP entries.
const NAMED_FIND_CAP = 20000;
function namedFindOverCap(text, name, folded) {
  const words = text.replace(/^[\s\S]*?\bfind\b/, '').trim().split(/\s+/);
  const starts = [];
  for (const w of words) {
    if (/^[-(!\\|;&]/.test(w)) { if (/^-[HLP]$/.test(w)) continue; break; }
    starts.push(w.replace(/^["']|["']$/g, ''));
  }
  const want = folded ? name.toLowerCase() : name;
  let seen = 0;
  for (const start of starts.length ? starts : ['.']) {
    if (isVar(start)) continue;
    const root = resolvedPath(start);
    if (!root) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (++seen > NAMED_FIND_CAP) return null;
        const p = pathMod.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') stack.push(p); continue; }
        if ((folded ? e.name.toLowerCase() : e.name) !== want) continue;
        let size = 0;
        try { size = fs.statSync(p).size; } catch { continue; }
        if (GATED_EXT.test(p)) {
          const lc = size > 8 * 1024 * 1024 ? Infinity : lineCountOf(p);
          if (lc > THRESHOLD) return { file: p, why: `${lc === Infinity ? 'over 8MB' : `${lc} lines`}, past the ${THRESHOLD}-line cap` };
        } else if (size > BIG_BYTES) return { file: p, why: `${size} bytes, past the ${BIG_BYTES}-byte cap` };
      }
    }
  }
  return null;
}
// Set by the shell matcher when the command cd's somewhere it cannot follow (a variable, `-`): a relative target that
// resolves nowhere may then sit under that unknown directory.
let unfollowedCd = false;
// The files a glob names, expanded one path segment at a time the way the shell does (a dotfile only for a segment
// opening with a dot), from the first anchor holding its literal head. Null when it cannot be sized: `**`, a bracket
// class the regex cannot take, a head no anchor holds, or past GLOB_SIZE_CAP entries read (audit 2026-10-20 C28: `WindowsServices/*/Program.cs`,
// a glob in a folder name, was denied as a sweep over two small entry points).
const GLOB_SIZE_CAP = 2000;
function globFiles(p) {
  if (p.includes('**')) return null;
  const parts = p.split('/');
  const first = parts.findIndex((s) => /[*?[]/.test(s));
  if (first < 0) return null;
  const head = parts.slice(0, first).join('/');
  const root = pathMod.isAbsolute(p) ? (head || '/') : anchorDirs.map((d) => pathMod.join(d, head)).find((d) => fs.existsSync(d));
  if (!root) return null;
  let level = [root];
  let read = 0;
  for (let k = first; k < parts.length; k++) {
    const seg = parts[k];
    if (!seg) continue;
    const next = [];
    if (!/[*?[]/.test(seg)) { for (const d of level) { const q = pathMod.join(d, seg); if (fs.existsSync(q)) next.push(q); } level = next; continue; }
    let re;
    try { re = new RegExp(`^${seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\[!/g, '[^')}$`); } catch { return null; }
    for (const d of level) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      read += names.length;
      if (read > GLOB_SIZE_CAP) return null;
      for (const n of names) if (re.test(n) && (seg.startsWith('.') || !n.startsWith('.'))) next.push(pathMod.join(d, n));
    }
    level = next;
  }
  return level;
}
// Do these files together print no more than one cat the size gate lets through (THRESHOLD lines, BIG_BYTES bytes)?
function smallFiles(files) {
  let lines = 0; let bytes = 0;
  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile()) continue;
    bytes += st.size;
    lines += lineCountOf(f);
    if (lines > THRESHOLD || bytes > BIG_BYTES) return false;
  }
  return true;
}
// A loop's `in` list the guard can size: literal paths, and globs `globFiles` expands (no `**`; a glob in a folder name
// too since audit 2026-10-20 C28), with no substitution or variable. True when every file it names together prints no more than one cat the size gate
// lets through - at most THRESHOLD lines and BIG_BYTES bytes in all - so the loop is no sweep: a loop over four small
// files, and one over two named task cards, were denied and the next calls cat the same files whole (audit
// 2026-10-10, sessions 49cb4b82 and fbfc2de4).
function smallLiteralLoop(list) {
  if (/[$`(<]/.test(list)) return false;
  const words = shellWordsOf(list.replace(/[;\s]+$/, "")).filter(Boolean);
  if (!words.length) return false;
  const files = [];
  for (const w of words) {
    const p = nativePath(w);
    if (!/[*?[]/.test(p)) { const at = resolvedPath(p); if (at) files.push(at); else if (unfollowedCd) return false; continue; }
    const matched = globFiles(p);
    if (!matched) return false; // a glob the guard cannot expand cannot be sized
    files.push(...matched);
  }
  return smallFiles(files);
}
// Trees no symbol lookup indexes: the data root (.alfred - the docs, the state, an old
// server's data), `.claude`, and the 2.0.0 `.serena` / `.playwright` folders. Naming a symbol lookup for a path under one
// of them hands the model a remedy that errors - measured twice, when the stack's navigation server skipped them: the
// denial named it for a `.claude/...` path and the redirect the model made from it failed. The ranged read is the remedy.
const UNINDEXED = /(?:^|[\\/])\.(?:claude|serena|playwright)(?:[\\/]|$)/;
const dataRootEnv = () => dataRoot();
const underDataRoot = (p) =>
{
  const root = dataRootEnv();
  if (!root || /[\s$]/.test(root)) return false;
  const norm = String(p).replace(/\\/g, '/');
  return norm === root || norm.startsWith(`${root}/`) || norm.includes(`/${root}/`);
};
// The hint must be EXECUTABLE, not just correct. The navigation tools can be deferred behind tool search in this
// harness, so naming them is not having them: measured, two sessions carried the rule text saying exactly that and still
// made 100 Bash calls and 0 navigation calls. The stack ships no server (2026-10-24), so the denial points at the one
// place that names this session's loader - the navigation line of the session-start tool order.
const LOAD_NAV = `  the navigation line of your session-start tool order - its ToolSearch select: loads them\n`
  + `  (a seat whose tools grant them calls them directly; the LSP tool needs no server)\n`;
// A markup template has no symbols a navigation tool indexes: get_symbols_overview on a 326-line Angular template
// was the remedy a denial named, and the session read the lines through `sed -n` instead (audit 2026-10-10, 81264f0d).
const MARKUP_EXT = /\.(?:html|razor|cshtml|xaml)$/i;
// A file OUTSIDE the project is in no index this session's navigation tools hold (audit 2026-10-11 SD16, 5984019e: a
// sibling repo's service worker was denied with the navigation remedy, the grep -C 3 fallback cut the handler that
// held the decisive line, and a wrong bug claim reached the user and two handoff memories for 12h).
function outsideProject(p) {
  const root = process.env.CLAUDE_PROJECT_DIR || '';
  const s = String(p || '');
  if (!root || !s || !pathMod.isAbsolute(s)) return false;
  const realOr = (x) => { try { return fs.realpathSync(x); } catch { return pathMod.resolve(x); } };
  const rel = pathMod.relative(realOr(root), realOr(s));
  return rel.startsWith('..') || pathMod.isAbsolute(rel);
}
const navHint = (p) => (MARKUP_EXT.test(String(p))
  ? `A markup template has no symbols to navigate - locate inside it instead:\n`
    + `  grep -n '<element, binding or text you need>' '${p}'   ->  then Read with offset+limit on the lines it names.`
  : UNINDEXED.test(String(p)) || underDataRoot(p)
  ? `No symbol lookup indexes this tree (the data root \`${dataRootEnv()}\`, \`.claude\`, the old \`.serena\` / \`.playwright\`).\n`
    + `Locate inside the file instead:\n`
    + `  grep -n '<pattern>' '${p}'   ->  then Read with offset+limit on the lines it names.`
  : outsideProject(p)
  ? `This file is outside the project, so no navigation index covers it. Locate inside the file instead:\n`
    + `  grep -n '<function, handler or key you need>' '${p}'   ->  then Read with offset+limit from the line it names\n`
    + `  through the end of that function (a grep -C window cuts a handler in half).`
  : `Locate first with the navigation tools your session-start tool order ranks: LSP documentSymbol on '${p}'\n` +
  `to list its symbols, goToDefinition / findReferences for one (or the navigation server the order names first),\n` +
  `then Read with offset+limit on the range they return. Where they are deferred, load them first with\n` +
  LOAD_NAV +
  `With none of them: grep -n '<symbol>' '${p}', then Read the range it names.`);

const input = payload.tool_input || {};

// A heredoc body is DATA, not shell: a plan or checklist that merely DESCRIBES a dangerous command
// is inert text, and matching it blocks a document write for its own prose (reproduced). Blank the
// payload spans, keeping the character count so any index into the command still holds - with
// shell-writes.js's blanker, which keeps each heredoc's FIRST line: `cat <<'EOF'; cat big.ts` runs its
// dump on that line, and blanking the whole match hid it (2.1.6 K1).
let blankHeredocs = (c) => c; // a copy that runs before shell-writes.js lands blanks nothing and judges every body as code
let heredocsOf = () => [];
let heredocBody = () => '';
let heredocVerbatim = () => false;
let heredocSubstitutions = () => [];
let commandIndex = () => 0;
let groupsAsCuts = (t) => t;
try { ({ blankHeredocs, heredocsOf, heredocBody, heredocVerbatim, heredocSubstitutions, commandIndex, groupsAsCuts } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
// A heredoc FED TO A SHELL is commands, the same as `sh -c '<script>'` (2.1.6): measured, `bash <<'EOF'` around a `cat`
// of a 1,000-line file passed, its body blanked as data. That body comes back in place, its own heredocs blanked in turn
// (and read back when a shell reads them), unless the shell's output is bounded by a filter or sent into a file.
// The spans are `heredocsOf`'s, the reader every guard shares, so every opener spelling it accepts is one here too
// (`<<\EOT` was never judged, seam M1).
function stripHeredocsOf(c, depth = 0) {
  const docs = heredocsOf(c);
  let out = hereStringsAsInline(blankHeredocs(c, docs));
  // A shell body nested past three levels is not read as data: it is judged out of budget and blocks, as the work
  // budget does - `cat big.ts` five `bash <<EOF` levels deep passed (audit 2026-10-08).
  if (depth > 3) {
    if (docs.some((h) => { const line = c.slice(h.lineStart, h.lineEnd); const word = heredocRunner(line, h.index - h.lineStart); return word && SHELL_RUNNER.test(word) && !heredocBounded(line, h.index - h.lineStart); })) throw new JudgeBudget('depth');
    return out;
  }
  for (const h of docs) {
    const line = c.slice(h.lineStart, h.lineEnd);
    const word = heredocRunner(line, h.index - h.lineStart);
    if (heredocBounded(line, h.index - h.lineStart)) continue;
    const body = heredocBody(c, h);
    if (!body) continue;
    if (!word && !heredocVerbatim(c, h)) { // data the shell expands: each `$( ... )` in it runs, its text put back in place (seam m5)
      for (const { from, to } of heredocSubstitutions(body)) out = out.slice(0, h.bodyStart + from) + body.slice(from, to) + out.slice(h.bodyStart + to);
      continue;
    }
    if (!word || !SHELL_RUNNER.test(word)) continue;
    out = out.slice(0, h.bodyStart) + stripHeredocsOf(body, depth + 1) + out.slice(h.bodyStart + body.length);
  }
  return out;
}
// A here-string is a one-line heredoc: `bash <<< 'cat f'` runs its word as commands. A SHELL's here-string is read in the
// judged view as its `-c` (three characters, as wide, a lone `-` before it blanked), so the segment loop below reads it as
// it reads `-c` (seam m2). A runtime's here-string, like any runtime script, is not read (complexity stage 1 A5).
function hereStringsAsInline(text) {
  if (!text.includes('<<<')) return text;
  let out = text;
  for (let i = text.indexOf('<<<'); i >= 0; i = text.indexOf('<<<', i + 3)) {
    const from = text.lastIndexOf('\n', i) + 1;
    const nl = text.indexOf('\n', i);
    const word = heredocRunner(text.slice(from, nl < 0 ? text.length : nl), i - from);
    if (!word || !SHELL_RUNNER.test(word)) continue;
    const dash = /(?<=\s)-\s+$/.exec(text.slice(from, i));
    if (dash) out = out.slice(0, from + dash.index) + ' '.repeat(dash[0].length) + out.slice(from + dash.index + dash[0].length);
    out = out.slice(0, i) + '-c ' + out.slice(i + 3);
  }
  return out;
}
// A pattern that matches the empty string matches every line: `^`, `.*`, `\s?`, an empty alternative.
function matchesEmpty(pat) {
  const p = pat.replace(/^\(\?[a-zA-Z]+\)/, '').replace(/^\^|\$$/g, '').replace(/\\[bBAzZ]/g, '');
  if (!p || /^\||\|$|[^\\]\|\|/.test(p)) return true;
  return /^(?:\.|\\[sSwWdD]|\[[^\]]*\]|[^\\()[\]|*+?{}.^$]|\((?:\?:)?[^()]*\))(?:[*?]|\{0(?:,\d*)?\})$/.test(p);
}
// What reads a heredoc's body is the COMMAND of the stage holding the `<<`, or of a stage piped from it on the same
// line - a whole word, never a substring (`cat > run-node.txt <<'EOF'` feeds no runtime); a redirect target is the file
// written. The runtime or shell word, or null. guard-secret-value.js's heredocReader is the same reading (shared-rules).
const POSIX_SHELL = /^(?:bash|sh|zsh|dash|ksh)$/i;
const SHELL_RUNNER = /^(?:bash|sh|zsh|dash|ksh|pwsh|powershell)$/i; // a body they read is commands
const RUNTIME_RUNNER = /^(?:node|nodejs|python(?:\d+(?:\.\d+)?)?|ruby|perl|php|deno|bun)$/i; // a body they read is a script
function heredocRunner(line, at) {
  judgeTick(line.length); // it re-reads the whole line per heredoc: charged, so a line of them hits the budget (audit 2026-10-21 H5)
  const own = line.slice(0, at).split(/&&|\|\||;|\|/).pop();
  const piped = line.slice(at).split(/&&|\|\||;/)[0].split('|').slice(1);
  for (const stage of [own, ...piped]) {
    // a subshell, a substitution or a `NAME=` prefix opens the stage's first word: `x=$(python3 - <<'EOF'` (seam m1)
    const words = stage.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^(?:[A-Za-z_]\w*=)?(?:\$\(|[(`"'])+/, ''));
    for (let k = 0; k < words.length; k++) {
      if (/^\d*[<>]+&?$/.test(words[k])) { k++; continue; }
      if (/^\d*[<>]/.test(words[k])) continue;
      const word = words[k].replace(/^["']|["']$/g, '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
      if (RUNTIME_RUNNER.test(word) || SHELL_RUNNER.test(word)) return stdinIsScript(word, words.slice(k + 1)) ? word : null;
    }
  }
  return null;
}
// Which STDIN_FLAGS row reads a heredoc runner's options (heredocRunner hands only these six).
function stdinKind(word) {
  return POSIX_SHELL.test(word) ? 'shell' : /^node/i.test(word) ? 'node' : /^python/i.test(word) ? 'python' : /^ruby/i.test(word) ? 'ruby' : /^perl/i.test(word) ? 'perl' : /^php/i.test(word) ? 'php' : null;
}
// The body is the program only when the program takes its SCRIPT from stdin: a script file named, or a script handed
// as -c / -e / -p / -m, makes the body that program's input data (`bash ./run.sh <<EOF`, `node -e '...' <<EOF`).
// An option's own value is no script file (`bash -euo pipefail`, `bash --rcfile x`, `node --stack-size 4096`,
// `python3 -X dev`). A runtime's `-` is stdin itself and the words after it are the script's argv
// (`python3 - out.txt <<EOF`); a shell's `-` or `--` only ends its options, so a next word is still a script file,
// while php's `--` hands the words after it to a script read from stdin (`php -- a b <<EOF`).
// Each interpreter's options, read the way its own parser does (review B1 of 2.1.6): a `script` letter takes the rest
// of its bundle or else the next word as the script, a `stdin` letter reads it from stdin, a `value` letter takes the
// rest of its bundle or else the next word, a `next` letter (a shell's o / O) takes the next word and lets the bundle
// go on (`-euo pipefail`), a `rest` letter takes only the rest of its bundle, a `digits` letter takes the digits
// after it and lets the bundle go on (`perl -lne`, `-0777ne`), a `flag` letter takes nothing. Long options:
// `longScript`, `longValue`, then `longFlag`. An option the table does not know is read as taking the next
// word, so a value is never mistaken for a script file - the body stays judged. A script option with no script
// word after it leaves the body judged too (`perl -we <<EOF`).
const STDIN_FLAGS = {
  shell: { script: 'c', stdin: 's', next: 'oO', value: '', rest: '', digits: '', flag: 'abBCDeEfhHiklmnpPrtTuvx',
    longScript: null, longValue: /^--(?:rcfile|init-file)$/,
    longFlag: /^--(?:debugger|dump-po-strings|dump-strings|help|login|noediting|noprofile|norc|posix|pretty-print|protected|restricted|verbose|version)$/ },
  node: { script: 'epc', stdin: '', next: '', value: 'rC', rest: '', digits: '', flag: 'ivh',
    longScript: /^--(?:eval|print|check)$/,
    longValue: /^--(?:experimental-(?:loader|default-type|config-file|sea-config|policy)|trace-event-(?:categories|file-pattern)|trace-require-module|inspect-port|allow-fs-(?:read|write))$/,
    longFlag: /^--(?:no-[\w-]+|experimental-[\w-]+|trace-[\w-]+|inspect(?:-brk|-wait)?|harmony[\w-]*|allow-[\w-]+|watch(?:-preserve-output)?|test(?:-only|-update-snapshots|-force-exit)?|enable-source-maps|abort-on-uncaught-exception|preserve-symlinks(?:-main)?|pending-deprecation|throw-deprecation|expose-gc|expose-internals|frozen-intrinsics|heap-prof|cpu-prof|insecure-http-parser|jitless|force-fips|enable-fips|interactive|prof|prof-process|report-on-signal|report-uncaught-exception|report-on-fatalerror|report-compact|zero-fill-buffers|permission|use-openssl-ca|use-bundled-ca|use-system-ca|openssl-legacy-provider|openssl-shared-config|build-snapshot|entry-url|strip-types|v8-options|version|help|completion-bash)$/ },
  python: { script: 'cm', stdin: '', next: '', value: 'WXQ', rest: '', digits: '', flag: 'bBdEhiIOPqRsSuvVx?',
    longScript: null, longValue: /^--check-hash-based-pycs$/, longFlag: /^--(?:help(?:-[\w-]+)?|version)$/ },
  ruby: { script: 'e', stdin: '', next: '', value: 'rICE', rest: 'FiKTWx', digits: '0', flag: 'acdlnpsSvwyUh',
    longScript: null, longValue: /^--(?:encoding|external-encoding|internal-encoding|dump|enable|disable)$/,
    longFlag: /^--(?:verbose|version|copyright|help|yydebug|jit|yjit|rjit)$/ },
  perl: { script: 'eE', stdin: '', next: '', value: 'IMm', rest: 'CdDFiVx', digits: '0l', flag: 'acfgnpsStTuUvwWXh',
    longScript: null, longValue: null, longFlag: null },
  php: { script: 'rfRF', stdin: '', next: '', value: 'BEcdzSt', rest: '', digits: '', flag: 'aCehHilmnqsvw?',
    longScript: /^--(?:run|file|process-code|process-file)$/, longValue: null,
    longFlag: /^--(?:interactive|no-chdir|profile-info|help|info|syntax-check|modules|no-php-ini|no-header|hide-args|syntax-highlight(?:ing)?|strip|usage|version|ini)$/ },
};
function stdinIsScript(word, rest) {
  const kind = stdinKind(word);
  if (!kind) return true;
  const f = STDIN_FLAGS[kind];
  const args = [];
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k].replace(/^["']|["']$/g, '');
    if (/^\d*[<>]+&?$/.test(w)) { k++; continue; } // a redirect and its target
    if (!/^\d*[<>]/.test(w)) args.push(w);
  }
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    const more = k + 1 < args.length;
    if (w === '-') return kind === 'shell' ? !more : true; // a runtime's script IS stdin; the words after it are its argv
    if (w === '--') return kind === 'php' || !more; // the end of the options: a next word is the script file
    if (w.startsWith('--')) {
      const name = w.replace(/=.*$/, '');
      if (f.longScript && f.longScript.test(name)) return !(w.includes('=') || more);
      if (w.includes('=')) continue; // an attached value
      if (f.longValue && f.longValue.test(name)) { k++; continue; }
      if (f.longFlag && f.longFlag.test(name)) continue;
      k++; continue; // an option this table does not know: its value is no script file
    }
    if (!(w.length > 1 && (w[0] === '-' || (kind === 'shell' && w[0] === '+')))) return false; // a script file
    let take = 0;
    for (let i = 1; i < w.length; i++) {
      const ch = w[i];
      const tail = i + 1 < w.length;
      if (f.stdin.includes(ch)) return true;
      if (f.script.includes(ch)) return !((tail && kind !== 'shell') || k + take + 1 < args.length);
      if (f.next.includes(ch)) { take++; continue; }
      if (f.value.includes(ch)) { if (!tail) take++; break; }
      if (f.rest.includes(ch)) break;
      if (f.digits.includes(ch)) { const d = /^(?:x[\dA-Fa-f]*|\d*)/.exec(w.slice(i + 1))[0]; i += ch === '0' ? d.length : /^\d*/.exec(w.slice(i + 1))[0].length; continue; }
      if (f.flag.includes(ch)) continue;
      take++; break; // a letter this table does not know: its value is no script file
    }
    k += take;
  }
  return true;
}
// Is a heredoc's program output bounded by a filter or sent into a file? The exemptions the segment loop gives a command.
const FILTER_PIPE = /\|\s*(head|tail|sed|grep|rg|wc|awk|cut|select-object|select|select-string|sls|measure-object|measure|findstr)\b/i;
const INTO_FILE = /(?:^|\s)1?>>?\s*[^&\s>]/;
function heredocBounded(line, at) {
  const own = line.slice(0, at).split(/&&|\|\||;|\|/).pop();
  const tail = line.slice(at).replace(/^<<-?\s*(['"]?)\w+\1/, '');
  return FILTER_PIPE.test(tail) || INTO_FILE.test(tail) || INTO_FILE.test(own);
}
// One per-session state file, shared by the cumulative read cap and the convention-rule announcer.
const sessionStateFile = () => pathMod.join(os.tmpdir(), `guard-read-${(payload.session_id || 'nosession').replace(/[^\w-]/g, '')}.json`);

// ---- the cumulative range cap, ONE rule for the Read tool and the shell's literal spans ---------------------------
// Merge this range into the coverage of the file; past CAP of its lines the remainder goes through the navigation
// server - two half-splits reconstructing the file are the whole-file read in two calls (measured). The ranges are ROWS
// appended to a per-session log before the verdict, never a read-merge-write of one object, which four parallel Reads
// of a file's quarters each passed against an empty state (8 of 10 trials, audit 2026-10-08). Each check replays the log
// up to its own row in append order, every earlier row judged by this same rule, so a row past the cap counts nothing
// and the last of a parallel batch sees the rows before it. The file is keyed by its real path (`./big.ts` reset the
// coverage `big.ts` had). Audit 2026-10-10 C11: a row counts only for the SAME actor (the main session, or one seat by
// its agent id - a seat's first read was blocked on its parent's and its siblings' rows, sessions 7491ab75, e499fc94,
// 3ce6b036) and the SAME file version (mtime and line count - rows read before an edit, one past the new EOF, blocked a
// 15% read at 90%), and a shell span (`sed -n a,bp`, `head`, `tail`, `awk 'NR>=a && NR<=b'`) is a row like a Read's:
// the cap was per route, and `sed -n` / `awk NR` read the rest of a file the Read half had just refused (c5000cb1,
// c6142301, 0498718d, 81264f0d).
const CAP = 0.6;
const actorKey = String(payload.agent_id || 'main');
// Seats the cap does not bind (audit 2026-10-14 HK16, the user's ruling): code-quality-analyzer reads code to judge it,
// and over 2026-10-07..14 its 85 runs made 143 of the 277 range-cap blocks (and 290 of all 588 read-guard blocks), while
// the verifiers made 9. The size and sweep gates still bind it. Bare or the house's own prefix - another plugin's seat
// of that name is not ours.
const RANGE_CAP_EXEMPT_SEATS = new Set(['code-quality-analyzer']);
const rangeCapExempt = () => payload.agent_id !== undefined && payload.agent_id !== null
  && RANGE_CAP_EXEMPT_SEATS.has(String(payload.agent_type || '').replace(/^alfred-code:/, ''));
const fileVersion = (abs, lineCount) => { try { return `${Math.floor(fs.statSync(abs).mtimeMs)}:${lineCount}`; } catch { return `?:${lineCount}`; } };
// The file's state in the working tree: 'new' (untracked or added), 'changed', or '' (clean, or no repo).
const treeState = (abs) => {
  try {
    const out = require('child_process').execFileSync(...require('./hook-prelude.js').gitSafe(['status', '--porcelain', '--', pathMod.basename(abs)],
      { cwd: pathMod.dirname(abs), timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).toString();
    const code = out.slice(0, 2);
    return !out ? '' : code === '??' || code[0] === 'A' ? 'new' : 'changed';
  } catch { return ''; }
};
function rangeCap(abs, shown, lineCount, a, b) {
  let fileKey = abs;
  try { fileKey = fs.realpathSync(abs); } catch { /* as resolved */ }
  const ver = fileVersion(fileKey, lineCount);
  const rangeLog = sessionStateFile().replace(/\.json$/, '-ranges.jsonl');
  const rowId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { fs.appendFileSync(rangeLog, JSON.stringify({ f: fileKey, a, b, id: rowId, ag: actorKey, v: ver }) + '\n'); } catch { /* best-effort */ }
  // State hygiene when this guard writes its state (hook-prelude.js sweepStale, audit 2026-10-08 S9): its session files
  // past 7 days go.
  try { const pre = require('./hook-prelude.js'); if (typeof pre.sweepStale === 'function') pre.sweepStale(os.tmpdir(), 'guard-read-'); } catch { /* no prelude */ }
  const mergeIn = (merged, x, y) => {
    const out = merged.concat([[x, y]]).sort((p, q) => p[0] - q[0]);
    const m = [];
    for (const iv of out) { const last = m[m.length - 1]; if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]); else m.push([iv[0], iv[1]]); }
    return m;
  };
  const coverOf = (m) => m.reduce((n, [x, y]) => n + (y - x + 1), 0);
  let merged = [];
  let prior = null; // the coverage before this range - what the cap still leaves readable
  let mine = false;
  try {
    for (const line of fs.readFileSync(rangeLog, 'utf8').split('\n')) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      // a row written before 2026-10-10 carries no actor or version: the main session's, of this version
      if (!row || row.f !== fileKey || (row.ag || 'main') !== actorKey || (row.v && row.v !== ver)) continue;
      const next = mergeIn(merged, row.a, Math.min(row.b, lineCount));
      if (row.id === rowId) { prior = merged; merged = next; mine = true; break; }
      if (coverOf(next) <= lineCount * CAP) merged = next; // an earlier row past the cap was blocked: it read nothing
    }
  } catch { /* no log - this range alone */ }
  if (!mine) { prior = merged; merged = mergeIn(merged, a, b); }
  const covered = coverOf(merged);
  if (covered <= lineCount * CAP || rangeCapExempt()) return;
  // A file the working tree ADDS is under review whole - a verifier seat left half of a new 251-line test file unread
  // behind this cap (audit 2026-10-10, session 05c925e9) - so its ranges complete it. A changed file names its diff.
  const state = treeState(fileKey);
  if (state === 'new') return;
  global.BLOCK_DETAIL = { branch: 'range-cap', covered: Math.round((100 * covered) / lineCount) };
  process.stderr.write(
    `Blocked: ranged reads of ${shown} now cover ${Math.round((100 * covered) / lineCount)}% of its ${lineCount} lines in this ${actorKey === 'main' ? 'session' : 'seat'} -\n` +
      `ranges of one file may cover at most ${Math.round(CAP * 100)}% of it, on the Read tool and the shell's sed -n / head / tail / awk NR\n` +
      `alike: reconstructing a large file from splits is the whole-file read the guard exists to stop\n` +
      `(measured: 2-3-call splits rebuilt 7 blocked files in one run). Read the located symbol's range, never halves.\n` +
      // the lines the cap still leaves (audit 2026-10-11 SD16, 5984019e: the denied Read held the decisive line, and a
      // targeted 24-line range would have passed at 31% - the denial never said how much was left)
      `${Math.max(0, Math.floor(lineCount * CAP) - coverOf(prior || []))} of its ${lineCount} lines are still readable by range here - spend them on the located\n` +
      `function's own lines (a grep -n of its name gives the start), not on the rest of this request.\n` +
      (state === 'changed' ? `Reviewing this change? Its diff is the review route: git diff HEAD -- '${shown}'\n` : '') +
      `A file with nothing to locate (a data table, a message map): grep -n '<the key you need>' '${shown}', then that range.\n` +
      `For the remainder:\n` + navHint(shown),
  );
  process.exit(2);
}

// The path-scoped convention rules attach on a Read / Write / Edit of a matching file and on a Bash command that counts as
// a READ of one (`cat` or `head` on a single file - code.claude.com/docs/en/memory, re-read 2026-10-14), never on a shell
// WRITE. Under a Bash-first working mode an edit therefore never attaches them: measured with a control for the first
// time, 19 Bash calls naming `.cs` files produced 0 attachments, while the session's single
// Read-tool call on a `.cs` file attached BOTH `.cs`-scoped rules 0.94 s later - so the C# rule was
// absent for the whole DESIGN, PLAN and GATE phase of a C# build. Corroborated at 0 attaches over
// 123 `.md` write targets and 54 authored docs. This hook already runs on every Bash call and
// already parses the extension, so it is the one place that can close the gap: it names the rule
// that governs the file, ONCE per rule per session, as non-blocking additionalContext.
const CONVENTION_RULES = [
  // Twin of the rule's paths (Designer + *Form.cs + *Form.*.cs); case-SENSITIVE so Platform.cs / Transform.cs stay plain C#.
  // An EF migration's `*.Designer.cs` under Migrations/ is schema work, never a form (audit 2026-10-14 RU12).
  [/^(?!.*(?:^|\/)Migrations\/).*(?:\.Designer\.cs\b|\w*Form(\.[^\s\/]+)?\.cs\b)/, 'winforms-conventions.md'],
  // Twin of sql-conventions.md's `**/Migrations/**/*.cs`: an EF migration is schema work (audit 2026-10-14 RU12).
  [/(?:^|\/)Migrations\/(?:[^\s\/]+\/)*[^\s\/]+\.cs$/, 'sql-conventions.md'],
  [/\.cs\b/i, 'csharp-conventions.md'],
  [/\.xaml\b/i, 'wpf-conventions.md'],
  // Twin of the rule's own `paths:`. The suffixes are the pre-v20 spelling; the directory shapes are
  // the current one - the Angular style guide now recommends suffix-less names, and the rule matches
  // `**/src/app/**/*.ts` for exactly that reason, so a write to `src/app/user-profile.ts` was being
  // announced as typescript-conventions.md alone.
  // Audit 2026-10-30 RU-03: both rows widened to every glob of the two rules - a template (`*.component.html`, an Ionic
  // `home.page.html` under src/app), `angular.json`, `src/global.scss`, `src/theme/**/*.scss` and the src/app / src/lib
  // stylesheets were never named on the shell route.
  [/\.(component|service|directive|pipe|guard|resolver|module|routes)\.ts\b|\.component\.html\b|(?:^|[\s"'=\/])angular\.json$|(?:^|[\s"'=\/])src\/(?:app|lib)\/[^\s"';|&]*\.(?:tsx?|html)\b/i, 'angular-conventions.md'],
  [/\.(component|global)\.(scss|css)\b|\bstyles\.(scss|css)\b|(?:^|[\s"'=\/])src\/(?:global\.scss|theme\/[^\s"';|&]*\.scss|(?:app|lib)\/[^\s"';|&]*\.(?:scss|css))\b/i, 'angular-styling-conventions.md'],
  [/\.tsx?\b/i, 'typescript-conventions.md'],
  [/\.(jsx?|mjs|cjs)\b/i, 'javascript-conventions.md'],
  [/\.sql\b/i, 'sql-conventions.md'],
  // Twin of the rule's own `paths:` - containers, compose, the three pipeline families, deploy scripts and env templates.
  [/\bDockerfile\b|\b(docker-)?compose[^\s]*\.ya?ml\b|\.github\/workflows\/[^\s]+\.ya?ml\b|\.github\/actions\/(?:\S+\/)?action\.ya?ml$|(?:^|\/)azure-pipelines[^\s\/]*\.ya?ml$|(?:^|\/)\.gitlab-ci\.yml$|(?:^|\/)deploy[^\s\/]*\.(?:sh|ps1)$|(?:^|\/)[^\s\/]*\.env\.(?:example|template)$/i, 'devops-conventions.md'],
  [/\.md\b/i, 'markdown-docs.md'],
];
// The announcement is HELD until the call is allowed, and only then marked as said: a denial and an
// injection are two different answers to the same tool call, and a rule announced into a turn that
// was blocked would be spent on a command that never ran.
// A command that only READS governed files does not need the rule - and worse, announcing there
// SPENDS it: the announcement is once per rule per session, so an inventory `sed -n '1,20p'` over
// every SKILL.md marked markdown-docs said, and the authoring Write minutes later got nothing.
// Measured twice, on an `awk | head -c 900` and on a `sed -n '1,20p'` loop, each re-paid across
// the following messages. So: a write verb or a redirection into a file, or no announcement.
// And the extension is read off the write TARGET, never off the command line: matching anywhere in
// the text named javascript-conventions.md for `node <installer>/stamp-compare.js > out.txt` - the
// EXECUTED script, not a write - in 3 of 5 measured bundles, and `2>/dev/null` on a read-only `find`
// tested TRUE as 'a redirection into a path' and spent the once-per-session announcement.
const shellWordsOf = (s) => {
  const out = [];
  let cur = ''; let q = null; let started = false;
  for (let i = 0; i < String(s).length; i++) {
    const c = String(s)[i];
    if (q) { if (c === q) q = null; else cur += c; started = true; continue; }
    if (c === '"' || c === '\'') { q = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    cur += c; started = true;
  }
  if (started) out.push(cur);
  return out;
};
// A sed/perl SCRIPT is an argument, not a path - `sed -i '' 's/a/b/' f.cs` names ONE target.
const SED_SCRIPT_ARG = /^(?:[sy]\/|\/.*\/[a-z]*$|\d*,?\$?[dpq=]$)/;
const RUN = '[^|;&\\n]*';
function writeTargets(text) {
  const out = [];
  const add = (t) => {
    const v = String(t).replace(/^["']|["']$/g, '');
    if (v && !v.startsWith('-') && !SED_SCRIPT_ARG.test(v) && !out.includes(v)) out.push(v);
  };
  const words = (s) => shellWordsOf(s).forEach(add);
  // A `>` inside a quoted span is text - a sed or perl script argument, a `<name>.spec.ts` placeholder in a quoted
  // `perl -e` - never a redirect (audit 2026-10-10, session f10cb06a: the notice named typescript-conventions.md off one).
  let quoted = [];
  try { quoted = require(pathMod.join(__dirname, 'shell-writes.js')).quotedSpans(text); } catch { quoted = []; }
  const inQuotes = (i) => quoted.some(([a, b]) => i >= a && i < b);
  // stdout into a path. A leading fd (`2>`, `&>`) and an fd target (`>&2`) are not a file write.
  for (const m of text.matchAll(/(?:^|[^>&\d])1?>>?\s*(?!&)("[^"]*"|'[^']*'|[^\s;|&()<>]+)/g)) if (!inQuotes(m.index + m[0].indexOf('>'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\btee\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:sed|perl)\\b((?=${RUN}\\s-[A-Za-z]*i\\b)${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:cp|mv|install|rsync)\\b(${RUN})`, 'g'))) {
    const w = shellWordsOf(m[1]).filter((x) => x && !x.startsWith('-'));
    if (w.length) add(w[w.length - 1]); // the DESTINATION is the write; the source is a read
  }
  for (const m of text.matchAll(new RegExp(`\\b(?:touch|patch)\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\bgit\\s+(?:apply|checkout|restore|mv)\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(/(?:writeFileSync|appendFileSync)\s*\(\s*(["'][^"']*["'])/g)) add(m[1]);
  for (const m of text.matchAll(/\bopen\s*\(\s*(["'][^"']*["'])\s*,\s*["'][wax]/g)) add(m[1]);
  return out;
}
// A rule that is not INSTALLED cannot be read: one measured bundle was told to read
// `javascript-conventions.md` in a project that has no JS and never installed that rule. A COPIED hook's
// sibling directory is the install's rules dir (`.claude/hooks/` -> `.claude/rules/`); a plugin-launched
// one's sibling is the plugin's `stack/rules` - the whole catalog, which named `winforms-conventions.md` to
// a project that never installed it (the 2026-09-26 benchmark pilot) - so only a `.claude/hooks` sibling
// counts, beside the project's own `.claude/rules`. With no rules directory anywhere this cannot be told,
// and the announcement is made rather than dropped.
const copiedSibling = pathMod.basename(__dirname) === 'hooks' && pathMod.basename(pathMod.dirname(__dirname)) === '.claude';
const ruleInstalled = (rule) => {
  let known = false;
  for (const d of [...(copiedSibling ? [pathMod.join(__dirname, '..', 'rules')] : []), ...anchorDirs.map((a) => pathMod.join(a, '.claude', 'rules'))]) {
    if (!fs.existsSync(d)) continue;
    known = true;
    if (fs.existsSync(pathMod.join(d, rule))) return true;
  }
  return !known;
};
// Stage 4c: where a rule store exists the loader's view decides - a store rule (a root's in a joined child too) is named
// by its path, a native one by .claude/rules. Read only once a write matched a rule; fail-open to the check above.
let loaded;
const ruleAt = (rule) => {
  if (loaded === undefined) {
    try {
      const r = require('./rules-session.js').rulesFor(anchorDirs[0] || process.cwd());
      const served = [...r.scoped, ...r.always].map((x) => [`${x.name}.md`, x.rel]);
      loaded = r.hasStore ? new Map([...r.natives.map((n) => [`${n}.md`, `.claude/rules/${n}.md`]), ...served]) : null;
    } catch { loaded = null; }
  }
  return loaded ? loaded.get(rule) || null : ruleInstalled(rule) ? `.claude/rules/${rule}` : null;
};
// The generated docs root is not governed by markdown-docs.md - the rule's own body says so - and
// neither is the install's own `.claude/` tree, so a `.md` target there names no rule - not even one
// whose pattern its NAME happens to carry (`next.js-upgrade.md`, `Dockerfile.md`): that would spend the
// rule's once-per-session announcement on a docs note.
// The docs root is RESOLVED, not assumed: hard-coding `.claude/` meant that with a docs root of
// `docs` (a pre-2.8.0 ALFRED_CODE_DOCS_PATH an update has not drained yet) a write to
// a doc under `docs/` still drew the announcement the rule says does not apply.
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNGOVERNED_MD = new RegExp(
  `(?:^|[\\s"'=])(?:\\./)?(?:\\.claude|${escapeRe(docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, ''))})/`);
function announceRules(text, extra = [], cds = []) {
  const docsRel = docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, '');
  const ungoverned = (t) => UNGOVERNED_MD.test(` ${t}`) || t.includes('.claude/') || t.includes(`${docsRel}/`);
  // A write outside the project - the session scratchpad, a temp folder - is governed by no rule of this project's
  // (audit 2026-10-10, session 8f44a003: a heredoc into the scratchpad drew javascript-conventions.md).
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || '';
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const roots = root ? [...new Set([pathMod.resolve(root), real(pathMod.resolve(root))])] : [];
  // A target is resolved where the shell stands when it is written: after `cd /tmp && cat > x.ts` the write is in /tmp,
  // never the project (audit 2026-10-10, session 49cb4b82). `cds` are shell-writes.js's, indexed into the same text.
  const cdBefore = (at) => {
    let d = null;
    for (const c of cds) if (at >= 0 && c.index < at) d = c[1] || c[0];
    return d && d !== '-' && !String(d).includes('$') ? d : null;
  };
  const inProject = (t, at = -1) => {
    if (!roots.length || isVar(t)) return true;
    const cd = cdBefore(at);
    const base = cd ? pathMod.resolve(anchorDirs[0] || root, nativePath(cd)) : (anchorDirs[0] || root);
    const abs = pathMod.resolve(base, nativePath(t));
    const absReal = pathMod.join(real(pathMod.dirname(abs)), pathMod.basename(abs));
    return [abs, absReal].some((a) => roots.some((r) => a === r || a.startsWith(r + pathMod.sep)));
  };
  const targets = [...writeTargets(String(text)).map((t) => [t, String(text).indexOf(t)]), ...extra.map((e) => (Array.isArray(e) ? e : [e, -1]))]
    .filter(([t, at]) => inProject(t, at)).map(([t]) => t);
  if (!targets.length) return;
  const hit = [];
  for (const t of targets) for (const [re, rule] of CONVENTION_RULES)
    if (re.test(t) && !hit.includes(rule) && !(/\.md\b/i.test(t) && ungoverned(t))) hit.push(rule);
  if (!hit.length) return;
  let state = {};
  const f = sessionStateFile();
  try { state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* fresh state */ }
  const said = state.__rules || [];
  const fresh = hit.filter((r) => !said.includes(r) && ruleAt(r));
  if (!fresh.length) return;
  const flush = () => {
    try {
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* fresh state */ }
      cur.__rules = (cur.__rules || []).concat(fresh);
      fs.writeFileSync(f, JSON.stringify(cur));
    } catch { /* best-effort */ }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `This command touches files governed by ${fresh.map((r) => `\`${ruleAt(r)}\``).join(' and ')}. `
          + `A path-scoped rule attaches on a FILE-TOOL touch only, so working through the shell never loads it - `
          + `read the rule and load the house-style skill it names before the next edit to those files.`,
      },
    }));
  };
  const exit = process.exit.bind(process);
  process.exit = (code) => { if (code === 0) flush(); exit(code); };
}

// The whole line of `text` holding the first match of `re` (as `[^\n]*?<re>[^\n]*` matched it, without that lazy
// prefix's rescan of the line from every start - review M3 of 2.1.6), or null.
function lineHolding(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const from = text.lastIndexOf('\n', m.index - 1) + 1;
  const nl = text.indexOf('\n', m.index + m[0].length);
  return [text.slice(from, nl < 0 ? text.length : nl)];
}
// ---- the verbs that print a whole file under another name (2.1.6) -------------------------------------------------------
// Found while fixing review item 5 of 2.1.6: nl, tac, sort, base64, dd if=, a copy onto /dev/stdout, curl file://, vim's
// print, an identity sed / awk / perl -p script, grep with an empty pattern and the rest each printed a source file whole
// past the cat check. wholeFiles names the files a pipeline segment prints whole, for the size gate cat already meets;
// a bounded run (cut of one field, bat -r, a real pattern, output into a file) names none. `grep .` stays an allowed
// filter.
// `while read l; do echo "$l"; done < file`: a read loop whose body echoes every line unconditionally is cat. One pass
// over the command's loop words, its answer kept for the command's every `done` stage.
let loopMemo = { command: null, echoes: false };
function readLoopEchoes(command) {
  if (loopMemo.command === command) return loopMemo.echoes;
  let echoes = false; let open = false; let read = false; let body = -1;
  for (const w of command.matchAll(/\b(while|read|do|done)\b/g)) {
    if (w[1] === 'while') { open = true; read = false; body = -1; }
    else if (w[1] === 'read') { if (open && body < 0) read = true; }
    else if (w[1] === 'do') { if (open && read && body < 0) body = w.index + 2; }
    else {
      const text = body >= 0 ? command.slice(body, w.index) : '';
      if (/\b(?:echo|printf)\b/.test(text) && !/\b(?:if|case|grep)\b|&&|\|\||\[\[?\s/.test(text)) echoes = true;
      open = false; read = false; body = -1;
    }
  }
  loopMemo = { command, echoes };
  return echoes;
}
// The command with the text inside each quoted span filled with `\x01`, index for index (newlines and the quotes kept),
// so a verb, a `;`, a `|` or a `>` inside a quoted string reads as the text it is: `grep -c 'cat -n' f` names a cat and
// runs none (2.1.6 - it was denied as a dump of f). A string a shell RUNS is left as it is - a shell's `-c` (bundled or
// not), `eval`, `watch`, `su -c`, `script -c`, `cmd /c`, `pwsh -Command` - and so is a backtick substitution inside double
// quotes; a segment piped into a shell is the caller's test. Quote pairing is only as good as its reader: an apostrophe
// in a `#` comment flips every span after it, so from a span opened after a comment on its line, and from one left
// unterminated, nothing more is filled. One pass, linear in the command.
const SHELL_RUNS = /\b(?:bash|sh|zsh|dash|ksh|fish|su|script|pwsh|powershell)\b/i;
// U25 (inventory A): a group `{ ...; }` or subshell `( ... )` whose stdout is redirected INTO a file copies what its commands
// print, as `cat a > b` does - the segment cuts split it at its own `;`, so the `cat` inside read as a dump. The spans
// [open, close, target] of each such group on the quote-filled text; a terminal device or an fd target (`>&2`) still prints, and a
// substitution's parens (`$(`, `<(`, `>(`, `=(`, `((`) open no group.
const GROUP_TO_FILE = /^[ \t]*(?:1|&)?>>?[ \t]*(?!&)([^\s;&|<>()]+)/;
const TERMINAL_OUT = /^\/dev\/(?:std(?:out|err)|tty|fd\/[12])$|^\/proc\/self\/fd\/[12]$/;
function redirectedGroups(filled) {
  const spans = [];
  const stack = [];
  for (let i = 0; i < filled.length; i++) {
    const c = filled[i];
    if (c === '\\') { i++; continue; }
    const before = i ? filled[i - 1] : ' ';
    if (c === '(') stack.push({ close: ')', at: i, text: '$<>=('.includes(before) || filled[i + 1] === '(' });
    else if (c === '{' && /[\s;&|(]/.test(before) && /\s/.test(filled[i + 1] || '')) stack.push({ close: '}', at: i, text: false });
    else if ((c === ')' || (c === '}' && /[\s;]/.test(before))) && stack.length && stack[stack.length - 1].close === c) {
      const open = stack.pop();
      const to = !open.text && GROUP_TO_FILE.exec(filled.slice(i + 1));
      if (to && !TERMINAL_OUT.test(to[1])) spans.push([open.at, i, to[1]]);
    }
  }
  return spans;
}
function quoteFilled(command) {
  const chars = command.split('');
  const held = [];
  let sep = -1; let p = 0; let nl = -1;
  for (const [a, b] of shellWrites ? shellWrites.quotedSpans(command) : []) {
    for (; p < a; p++) if (chars[p] === ';' || chars[p] === '&' || chars[p] === '|' || chars[p] === '\n') sep = p;
    if (nl < a) { nl = command.indexOf('\n', a); if (nl < 0) nl = command.length; }
    const resumed = held.length > 0 && command[a - 1] === ')';
    const q = resumed ? '"' : command[a];
    const paused = command[b] === '$' && command[b + 1] === '(';
    if (!paused && command[b - 1] !== q) break;
    if (!resumed && nl < b && /(?:^|[\s;&|()])#/.test(chars.slice(command.lastIndexOf('\n', a - 1) + 1, a).join(''))) break;
    let code;
    if (resumed) code = Boolean(held.pop());
    else {
      const stage = chars.slice(Math.max(sep + 1, a - 512), a).join('');
      code = (/(?:^|[ \t])-(?:[A-Za-z]*c|command)[ \t]+$/i.test(stage) && SHELL_RUNS.test(stage))
        || (/(?:^|[ \t])\/[ck][ \t]+$/i.test(stage) && /\bcmd\b/i.test(stage))
        || /\beval[ \t]+$/.test(stage) || /\bwatch\b/.test(stage);
    }
    if (paused) held.push(code);
    if (code) continue;
    let tick = false;
    for (let i = a; i < b; i++) {
      const c = chars[i];
      if (c === '\n' || (i === a && !resumed) || (i === b - 1 && !paused && c === q)) continue;
      if (q === '"' && c === '`') { tick = !tick; continue; }
      if (!tick) chars[i] = '\x01';
    }
  }
  return chars.join('');
}
// The first match of `re` whose verb (the match's first letter) stands outside every filled span of `hseg`.
function unquotedMatch(seg, hseg, re) {
  for (const m of seg.matchAll(new RegExp(re.source, re.flags.replace('g', '') + 'g'))) {
    if (hseg[m.index + m[0].search(/[A-Za-z]/)] !== '\x01') return m;
  }
  return null;
}
function wholeFiles(seg, command, hseg = seg) {
  const unq = (w) => String(w == null ? '' : w).replace(/^["']|["']$/g, '');
  const TERMINAL = /^\/dev\/(?:std(?:out|err)|tty|fd\/[12])$/;
  // operands and flag values; `short` holds the one-letter flags that take a value, `long` the long ones
  const parse = (args, short = '', long = /^$/) => {
    const ops = []; const vals = [];
    for (let i = 0; i < args.length; i++) {
      const w = unq(args[i]);
      if (w === '--') { ops.push(...args.slice(i + 1).map(unq)); break; }
      if (w === '-' || !w.startsWith('-') || /^-\d/.test(w)) { ops.push(w); continue; }
      if (w.startsWith('--')) { const eq = w.indexOf('='); const n = eq < 0 ? w : w.slice(0, eq); vals.push([n, eq >= 0 ? w.slice(eq + 1) : long.test(n) ? unq(args[++i]) : null]); continue; }
      for (let j = 1; j < w.length; j++) {
        if (!short.includes(w[j])) { vals.push(['-' + w[j], null]); continue; }
        vals.push(['-' + w[j], j + 1 < w.length ? w.slice(j + 1) : unq(args[++i])]);
        break;
      }
    }
    const val = (...n) => { const v = vals.find(([x]) => n.includes(x)); return v ? v[1] : undefined; };
    return { ops, vals, val, has: (...n) => vals.some(([x]) => n.includes(x)) };
  };
  const SIMPLE = { nl: 'bdfhilnsvw', tac: 's', rev: '', fmt: 'wgpdlt', expand: 't', unexpand: 't', fold: 'w', pr: 'hlowWsSNe', od: 'tjNAw', xxd: 'lscgo',
    hexdump: 'efns', base64: 'w', strings: 'not', paste: 'd', column: 'scNR', sort: 'ktoST', uniq: 'fsw', zcat: 'S', gzcat: 'S', zmore: '', zless: '' };
  const emptyPat = (p) => p === '' || matchesEmpty(p);
  const out = [];
  const stages = [];
  let from = 0;
  for (const s of hseg.matchAll(/(?<!\|)\|(?!\|)/g)) { stages.push(seg.slice(from, s.index)); from = s.index + 1; }
  stages.push(seg.slice(from));
  for (const stage of stages) {
    const words = stage.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const k = commandIndex(words); // past a body's keyword, a group's opener, assignments and shell-writes.js's one wrapper list (seam M2, delta 1); tidies `words` in place
    const verb = unq(words[k] || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    const stdin = []; const args = [];
    for (let i = k + 1; i < words.length; i++) {
      const w = words[i];
      if (/^\d*<$/.test(w)) { stdin.push(unq(words[++i])); continue; }
      if (/^\d*<[^<&]/.test(w)) { stdin.push(unq(w.replace(/^\d*</, ''))); continue; }
      if (/^\d*<</.test(w)) break;
      if (/^\d*>/.test(w) || /^&>/.test(w)) { if (/^(?:\d*>+&?|&>+)$/.test(w)) i++; continue; }
      args.push(w);
    }
    const files = (list) => out.push(...list.filter((x) => x && x !== '-'));
    if (verb === 'cat' || verb === 'tee') { files(stdin); continue; }
    if (verb === 'done') { if (readLoopEchoes(command)) files(stdin); continue; }
    if (verb === 'git') { files(gitPrinted(args.map(unq))); continue; }
    // the one print-verb table (shell-writes.js PRINT_VERBS, audit 2026-10-30 a0 / HK-19: `shuf big.ts` passed); the
    // table below stays for a shell-writes.js older than it
    const printed = verb !== 'cat' && shellWrites && typeof shellWrites.printedFiles === 'function' ? shellWrites.printedFiles(verb, args.map(unq)) : null;
    if (printed) { if (!printed.bounded) files([...printed.files, ...stdin]); continue; }
    if (Object.prototype.hasOwnProperty.call(SIMPLE, verb)) { files([...parse(args, SIMPLE[verb], /^--(?:tabs|width|lines|key|output|separator|suffix)$/).ops, ...stdin]); continue; }
    if (verb === 'bat' || verb === 'batcat') { const o = parse(args, 'lrHmp', /^--(?:line-range|language|highlight-line|map-syntax|paging|style|theme)$/); if (!o.has('-r', '--line-range')) files(o.ops); continue; }
    if (verb === 'cut') {
      const o = parse(args, 'dfcb', /^--(?:delimiter|fields|characters|bytes)$/);
      const cols = o.val('-c', '-b', '--characters', '--bytes'); const fields = o.val('-f', '--fields');
      const wide = (cols != null && /^1?-(\d*)$/.test(cols) && (!/\d$/.test(cols) || +cols.split('-')[1] >= 80)) || (fields != null && /^1?-$/.test(fields));
      if (wide) files([...o.ops, ...stdin]);
      continue;
    }
    if (verb === 'iconv') { const o = parse(args, 'fto', /^--(?:from-code|to-code|output)$/); const to = o.val('-o', '--output'); if (to === undefined || TERMINAL.test(to || '')) files([...o.ops, ...stdin]); continue; }
    if (verb === 'dd') { const kv = (n) => { const w = args.map(unq).find((a) => a.startsWith(n + '=')); return w === undefined ? null : w.slice(n.length + 1); }; const to = kv('of'); if (to == null || TERMINAL.test(to)) files(kv('if') ? [kv('if')] : stdin); continue; }
    if (verb === 'cp') { const o = parse(args, 'St', /^--(?:target-directory|suffix)$/); if (o.ops.length >= 2 && TERMINAL.test(o.ops[o.ops.length - 1])) files(o.ops.slice(0, -1)); continue; }
    if (verb === 'curl') {
      const o = parse(args, 'AbcCdDeEFHKmoPQrtTuUwxXyYz', /^--(?:url|output)$/);
      if (o.has('-O', '--remote-name', '--remote-name-all') || o.vals.some(([n, w]) => (n === '-o' || n === '--output') && w !== '-' && !TERMINAL.test(w || ''))) continue;
      files([...o.ops, ...o.vals.filter(([n]) => n === '--url').map(([, w]) => w || '')].filter((u) => /^file:/i.test(u)).map((u) => u.replace(/^file:(?:\/\/(?:localhost)?)?/i, '')));
      continue;
    }
    if (/^(?:vim?|nvim|gvim|rvim|ex|view|rview)$/.test(verb)) {
      // with no terminal the full-screen editor paints the file; ex mode prints only on a print command, or on commands
      // the guard cannot see (a -S / -s script, stdin)
      const cmds = []; const opened = []; let ex = verb === 'ex'; let unseen = stdin.length > 0 || /<</.test(stage);
      for (let i = 0; i < args.length; i++) {
        const w = unq(args[i]);
        if (w.startsWith('+')) cmds.push(w.slice(1));
        else if (w === '-c' || w === '--cmd') cmds.push(unq(args[++i]));
        else if (w === '-S' || (w === '-s' && !ex)) { unseen = true; i++; } else if (/^-[uUiTwWtq]$/.test(w)) i++;
        else if (/^-[a-zA-Z]*[eE]/.test(w)) ex = true;
        else if (!w.startsWith('-')) opened.push(w);
      }
      const PRINTS = /(?:^|[\s|%$.,;\d/])(?:p|pr|print|P|Print|nu|number|#|l|list|z|echo|redir|w\s*!|w(?:rite)?\s+(?:>>\s*)?\/dev\/(?:stdout|stderr|tty|fd\/[12]))(?=$|[\s|!])/;
      if (!ex || unseen || cmds.some((c) => PRINTS.test(c))) files(opened);
      continue;
    }
    if (verb === 'look') { const o = parse(args, 't'); if (o.ops.length >= 2 && o.ops[0] === '') files(o.ops.slice(1)); continue; }
    if (verb === 'split' || verb === 'gsplit') {
      const o = parse(args, 'abClnpt', /^--(?:suffix-length|bytes|line-bytes|lines|number|additional-suffix|separator|filter)$/);
      if (o.has('--filter') || /\//.test(o.val('-n', '--number') || '') || /^\/dev\//.test(o.ops[1] || '')) files([o.ops[0]]);
      continue;
    }
    if (verb === 'diff' || verb === 'comm') { const o = parse(args, verb === 'diff' ? 'UCLIxXF' : ''); if (o.ops.length === 2 && o.ops.includes('/dev/null')) files(o.ops); continue; }
    if (verb === 'sqlite3') { for (const m of stage.matchAll(/\breadfile\s*\(\s*(?:'([^']*)'|"([^"]*)")/gi)) files([m[1] !== undefined ? m[1] : m[2]]); continue; }
    if (/^(?:e|f)?grep$|^rg$/.test(verb)) {
      const o = parse(args, verb === 'rg' ? 'efmABCtTgMj' : 'efmABCdD', /^--(?:regexp|file|max-count|after-context|before-context|context|glob|type|type-not)$/);
      if (o.has('-c', '-l', '-L', '-q', '-o', '-m', '-f', '--count', '--files-with-matches', '--files-without-match', '--quiet', '--only-matching', '--max-count', '--file')) continue;
      const given = o.vals.filter(([n]) => n === '-e' || n === '--regexp').map(([, w]) => w || '');
      const pats = given.length ? given : o.ops.slice(0, 1);
      // An INVERTED grep prints the file minus its matches - `grep -v '^import' page.ts` printed whole in-project sources
      // after 39 Read denials (audit 2026-10-10, session 0498718d, 4.68M re-sent): judged by line count like `cat`.
      if (o.has('-v', '--invert-match')) { files([...(given.length ? o.ops : o.ops.slice(1)), ...stdin]); continue; }
      // basic regex (plain grep, no -E / -P): `|` is a literal and `\|` the alternation
      const bre = verb === 'grep' && !o.has('-E', '-P', '--extended-regexp', '--perl-regexp');
      if (pats.length && pats.map((p) => (bre ? p.replace(/\\\||\|/g, (m) => (m === '|' ? 'x' : '|')) : p)).every(emptyPat)) files([...(given.length ? o.ops : o.ops.slice(1)), ...stdin]);
      continue;
    }
    if (verb === 'sed' || verb === 'gsed') {
      const o = parse(args, 'efl', /^--(?:expression|file|line-length)$/);
      if (o.has('-i', '--in-place', '-f', '--file')) continue;
      const given = o.vals.filter(([n]) => n === '-e' || n === '--expression').map(([, w]) => w || '');
      const script = (given.length ? given : o.ops.slice(0, 1)).join(';').replace(/\s+/g, '');
      const quiet = o.has('-n', '--quiet', '--silent');
      const operands = given.length ? o.ops : o.ops.slice(1);
      if ((!quiet && /^;*$/.test(script) && (given.length || o.ops.length > 1)) || script === 'p' || (quiet && /^(?:1,\$)?p$/.test(script))) files([...operands, ...stdin]);
      continue;
    }
    if (/^[gmn]?awk$/.test(verb)) {
      const o = parse(args, 'fvF', /^--(?:file|assign|field-separator)$/);
      if (o.has('-f', '--file')) continue;
      const script = (o.ops[0] || '').replace(/\s+/g, '');
      if (/^(?:1|\/\/|NR(?:>0|>=1|!=0)?|\{print\}|\{print\$0\}|\{print[^{}]*\$0[^{}]*\}|(?:1|NR)\{print(?:\$0)?\})$/.test(script)) files([...o.ops.slice(1), ...stdin]);
      continue;
    }
    if (verb === 'perl' || verb === 'ruby') {
      // a -n / -p loop over the file operands: an identity script prints every line
      let loop = ''; let script = null; const rest = [];
      for (let i = 0; i < args.length; i++) {
        const w = unq(args[i]);
        if (script === null && /^-[a-zA-Z0-9]+$/.test(w)) {
          const b = w.slice(1).replace(/^[0-9]+/, '').replace(/[lw]/g, '');
          if (/[np]/.test(b)) loop = /p/.test(b) ? 'p' : 'n';
          if (/[eE]$/.test(b)) script = unq(args[++i]);
          continue;
        }
        rest.push(w);
      }
      const sc = (script || '').trim();
      const identity = loop === 'p' ? /^(?:1?;?)$/.test(sc) : loop === 'n' && /^(?:print|say|puts|p)(?:\s*\(?\s*\$_\s*\)?)?\s*;?$/.test(sc);
      if (loop && script !== null && identity) files([...rest, ...stdin]);
      continue;
    }
  }
  return out;
}
// ---- a git read that prints a file whole (audit 2026-10-30 HK-19) ---------------------------------------------------
// `git show HEAD:src/big.ts` (or `:src/big.ts`, the index) prints the blob, and a diff of a file the diff ADDS prints all
// of it: each passed while `cat` of the same file was blocked. The blob is read where git runs (cwd, `-C`) with
// `cat-file`, which runs no filter, and sized like the file; a diff naming paths lists the ones it adds
// (`--name-only --diff-filter=A`, no external diff or textconv) and each is sized from the work tree. A diff naming no
// path is the review route and stays unjudged, and so does a summary form (`--stat`, `--name-only`, `-s`).
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const DIFF_SUMMARY = /^--(?:stat|numstat|shortstat|dirstat[\w-]*|compact-summary|summary|name-only|name-status|raw|check|quiet|no-patch)(?:=|$)|^-s$/;
function gitOut(argv, dir) {
  const opts = { cwd: dir, timeout: 3000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] };
  let spawn;
  try { spawn = require('./hook-prelude.js').gitSafe(argv, opts); } catch { spawn = ['git', ['-c', 'core.fsmonitor=false', ...argv], { ...opts, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }]; }
  try { return require('child_process').execFileSync(...spawn); } catch (e) { return e && e.code === 'ENOBUFS' && e.stdout ? e.stdout : null; }
}
function blobToken(spec, dir) {
  if (!VIRTUAL.has(spec)) {
    const out = gitOut(['cat-file', 'blob', spec], dir);
    if (!out) return null;
    const text = out.toString('utf8');
    VIRTUAL.set(spec, { lc: text ? text.replace(/\n$/, '').split('\n').length : 0, bytes: out.length });
  }
  return spec;
}
function gitPrinted(words) {
  let dir = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '-C') { dir = pathMod.resolve(dir, nativePath(words[++i] || '')); continue; }
    if (GIT_GLOBAL_VALUE.has(w)) { i++; continue; }
    if (!w.startsWith('-')) break;
  }
  const sub = words[i];
  const rest = words.slice(i + 1);
  if (rest.some(isVar)) return [];
  // `<rev>:<path>`, `:<path>`, `:<stage>:<path>`, `<rev>:./<path>` - never `:/<text>`, a search of commit messages
  if (sub === 'show') return rest.filter((w) => !w.startsWith('-') && /^[^:\s]*:[^\s/]\S*$/.test(w)).map((w) => blobToken(w, dir)).filter(Boolean);
  if (sub !== 'diff') return [];
  let cached = false; let noIndex = false; let dashdash = false;
  const revs = []; const paths = [];
  for (const w of rest) {
    if (dashdash) { paths.push(w); continue; }
    if (w === '--') { dashdash = true; continue; }
    if (DIFF_SUMMARY.test(w)) return [];
    if (w === '--cached' || w === '--staged') { cached = true; continue; }
    if (w === '--no-index') { noIndex = true; continue; }
    if (w.startsWith('-')) continue;
    (fs.existsSync(pathMod.resolve(dir, nativePath(w))) ? paths : revs).push(w);
  }
  if (noIndex) { const ops = [...revs, ...paths]; return ops.length === 2 && ops.includes('/dev/null') ? ops.filter((o) => o !== '/dev/null') : []; }
  if (!paths.length || revs.some((r) => !/^[\w./~^@{}+:-]+$/.test(r))) return [];
  const listed = gitOut(['diff', '--no-ext-diff', '--no-textconv', '-z', '--name-only', '--diff-filter=A', ...(cached ? ['--cached'] : []), ...revs, '--', ...paths], dir);
  const top = listed && listed.length ? gitOut(['rev-parse', '--show-toplevel'], dir) : null;
  if (!top) return [];
  return listed.toString('utf8').split('\0').filter(Boolean).map((p) => pathMod.join(top.toString('utf8').trim(), p));
}
// ---- how many of a file's lines a pipeline segment prints (audit 2026-10-08) --------------------------------------------
// A pipe into a filter verb exempted the whole segment, so a filter that bounds nothing let the dump through: `cat big.ts
// | grep ""`, `| awk 1`, `| head -n 9999`; a literal span on the file itself passed the same way (`head -n 9999 big.ts`,
// `sed -n 1,99999p big.ts`). A segment's stages are cut where the shell cuts them (`fseg`, quotes filled).
function pipeStagesOf(seg, fseg) {
  const out = [];
  let from = 0;
  for (const s of fseg.matchAll(/(?<!\|)\|(?!\|)/g)) { out.push([seg.slice(from, s.index), fseg.slice(from, s.index)]); from = s.index + 1; }
  out.push([seg.slice(from), fseg.slice(from)]);
  return out;
}
const FILTER_STAGE = /^\s*(head|tail|sed|grep|rg|wc|awk|cut|select-object|select|select-string|sls|measure-object|measure|findstr)\b/i;
// The lines a head / tail stage lets through as a function of what it is fed, or null when the stage is not one: a count
// (`-n N`, `-N`, `--lines=N`), all but the last K (`head -n -K`), from line K on (`tail -n +K`), ten with no count, a byte
// count past BIG_BYTES as the whole input.
function headTailSpan(words) {
  const verb = String(words[0] || '').replace(/^.*[\\/]/, '').toLowerCase();
  if (verb !== 'head' && verb !== 'tail') return null;
  let n = '10'; let bytes = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/^["']|["']$/g, '');
    const m = w.match(/^(?:-n|--lines=?)(.*)$/) || w.match(/^-(\d+)$/) || w.match(/^(?:-c|--bytes=?)(.*)$/);
    if (!m) continue;
    bytes = /^(?:-c|--bytes)/.test(w);
    n = m[1] !== '' && !(w === '--lines' || w === '--bytes') ? m[1] : String(words[++i] || '').replace(/^["']|["']$/g, '');
  }
  if (bytes) { const b = parseInt(n, 10); return (lc) => (b > BIG_BYTES ? lc : 0); }
  const v = parseInt(n.replace(/^[+-]/, ''), 10);
  if (!Number.isFinite(v)) return null;
  // `.range(lc)` - the lines it prints of a file, as an interval the range cap logs (audit 2026-10-10 C11)
  const ranged = (fn, range) => Object.assign(fn, { range });
  if (verb === 'tail' && n.startsWith('+')) return ranged((lc) => Math.max(0, lc - v + 1), (lc) => [Math.max(1, v), lc]);
  if (verb === 'head' && n.startsWith('-')) return ranged((lc) => Math.max(0, lc - v), (lc) => [1, Math.max(1, lc - v)]);
  return verb === 'head' ? ranged((lc) => Math.min(v, lc), (lc) => [1, Math.min(v, lc)])
    : ranged((lc) => Math.min(v, lc), (lc) => [Math.max(1, lc - v + 1), lc]);
}
// What a segment's later stages let through of what its first stages print: null when a filter bounds it (the exemption it
// always had), else the lines printed as a function of a file's line count - every later filter an identity (wholeFiles'
// own rules, fed a marker on stdin) or a head / tail span, composed in order. `consumer` is set when a later stage is a
// program reading the output (`jq`, `python3`, `sort`): the size-only half below then judges nothing.
function segmentSpan(seg, fseg) {
  const stages = pipeStagesOf(seg, fseg).slice(1);
  if (!/\|\s*(head|tail|sed|grep|rg|wc|awk|cut|select-object|select|select-string|sls|measure-object|measure|findstr)\b/i.test(seg)) {
    return { printed: (lc) => lc, consumer: stages.length > 0 };
  }
  const MARK = '\u0002stdin';
  let printed = (lc) => lc;
  let filters = 0;
  let consumer = false;
  for (const [raw, filled] of stages) {
    if (!FILTER_STAGE.test(filled)) { consumer = true; continue; }
    filters++;
    const words = raw.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const span = headTailSpan(words.slice(commandIndex(words)));
    if (span) { const before = printed; printed = (lc) => span(before(lc)); continue; }
    if (wholeFiles(`${raw} < ${MARK}`, raw, `${filled} < ${MARK}`).includes(MARK)) continue;
    return null;
  }
  return filters ? { printed, consumer } : null; // a filter word the shell does not run as a stage (quoted) kept its old exemption
}
// The file operands a head / tail / `sed -n 'a,bp'` stage prints a literal span of, each with the lines it prints.
function spanFiles(seg, fseg) {
  const out = [];
  for (const [raw] of pipeStagesOf(seg, fseg)) {
    const words = raw.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const k = commandIndex(words);
    const own = words.slice(k);
    const verb = String(own[0] || '').replace(/^.*[\\/]/, '').toLowerCase();
    const awk = /^[gmn]?awk$/.test(verb);
    const valued = verb === 'head' || verb === 'tail' ? /^(?:-n|-c|--lines|--bytes)$/ : awk ? /^(?:-f|-v|-F|--file|--assign|--field-separator)$/ : /^(?:-e|--expression|-f|--file|-l|--line-length)$/;
    const ops = [];
    for (let i = 1; i < own.length; i++) {
      if (/^#/.test(own[i])) break; // a comment ends the words the command runs
      const w = own[i].replace(/^["']|["']$/g, '');
      if (valued.test(w)) { i++; continue; }
      if (/^\d*[<>]/.test(w)) { if (/^\d*[<>]+&?$/.test(w)) i++; continue; }
      if (w.startsWith('-')) continue;
      ops.push(w);
    }
    const span = headTailSpan(own);
    if (span && ops.length) { for (const f of ops) out.push({ f, printed: span, range: span.range }); continue; }
    const lines = (a, b) => ({ printed: (lc) => Math.max(0, Math.min(b, lc) - a + 1), range: (lc) => [a, Math.min(b, lc)] });
    if ((verb === 'sed' || verb === 'gsed') && own.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w)) && !own.some((w) => /^-[a-zA-Z]*i/.test(w) || /^--in-place/.test(w))) {
      const script = (ops[0] || '').replace(/\s+/g, '');
      const m = script.match(/^(\d+),(\d+|\$)p$/);
      if (m) {
        const a = +m[1]; const b = m[2] === '$' ? Infinity : +m[2];
        for (const f of ops.slice(1)) out.push({ f, ...lines(a, b) });
      }
    }
    // `awk 'NR>=a && NR<=b' f` (with or without `{print}`), `awk 'NR==a,NR==b' f` and an open `awk 'NR>=a' f`: a literal
    // line span like sed's - it read the rest of a file the cap had refused (audit 2026-10-10, c6142301, 0498718d).
    if (awk && !own.some((w) => /^-(?:f|-file)$/.test(w))) {
      const script = (ops[0] || '').replace(/\s+/g, '').replace(/\{print(?:\$0)?;?\}$/, '');
      const m = script.match(/^NR(>=|>)(\d+)(?:&&NR(<=|<)(\d+))?$/) || script.match(/^NR==(\d+),NR==(\d+)$/);
      if (m) {
        const [a, b] = m.length === 3 ? [+m[1], +m[2]]
          : [m[1] === '>' ? +m[2] + 1 : +m[2], m[4] === undefined ? Infinity : m[3] === '<' ? +m[4] - 1 : +m[4]];
        if (a <= b) for (const f of ops.slice(1)) out.push({ f, ...lines(a, b) });
      }
    }
  }
  return out;
}
// A `cat` / `nl` / `tac` handed a substitution that lists files (`cat $(find src -name '*.ts')`, `` cat `git ls-files` ``)
// prints every one it lists: the glob sweep spelled as a command.
const SUBST_SWEEP = /\b(?:cat|nl|tac|bat)\s+(?:-\w+\s+)*["']?(?:\$\(|`)\s*(?:find|fd|ls|git\s+ls-files|rg\s+--files)\b[^)`]*[)`]/;
// ---- Shell matcher: a whole-file dump via cat/sed is the Read block routed around ----
// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is shell-writes.js's one list,
// shipped beside this hook on both routes. A copy that runs before it lands judges by the payload's shape - a
// string `command` - and blanks no quoted span in the loop test below.
let shellWrites = null;
try { shellWrites = require(pathMod.join(__dirname, 'shell-writes.js')); } catch { shellWrites = null; }
if (shellWrites ? shellWrites.isShellTool(payload.tool_name) : typeof input.command === 'string') {
  // Runs FIRST and on EVERY Bash call, not just the dump verbs: a grep, a build and a test run all
  // name the files whose conventions the session needs, and none of them reaches the checks below.
  // ... plus the write targets shell-writes.js reads, an interpreter script's own writes among them (`p = '<file>'` then
  // `open(p, 'w')` in a `python3 - <<'EOF'` splice - audit 2026-10-10, session 81264f0d: 14 such edits drew no notice).
  try {
    let extra = [];
    let cds = [];
    if (shellWrites) {
      const scan = shellWrites.scanShell(String((payload.tool_input || {}).command || ''), {});
      extra = scan.targets.filter((t) => !t.unknown).map((t) => [scan.expandVars(String(t.raw || '')), t.index]).filter(([t]) => t && !isVar(t));
      cds = scan.cds || [];
    }
    announceRules(stripHeredocsOf(String((payload.tool_input || {}).command || '')), extra, cds);
  } catch { /* an injection never breaks the gate */ }
  try {
  // A heredoc body is DATA, not shell: a plan or checklist that merely DESCRIBES a dangerous
  // command is inert text, and matching it blocks a document write for its own prose (reproduced).
  // Blank the payload spans, keeping the character count so any index into the command still holds.
  const command = stripHeredocsOf(String(input.command || ''));
  // Anchors and same-command assignments, computed once for every check below.
  const assigns = assignsOf(command);
  // Each newline run is one newline for this scan: CD_RE's `\s*` after a newline separator ran every later newline of
  // the run from each one (review M3 of 2.1.6). Only the targets are read, never a position.
  for (const c of command.replace(/\n\s*/g, '\n').matchAll(CD_RE)) {
    const target = expandWith(assigns, c[1].replace(/^["']|["']$/g, ''));
    if (target === '-' || isVar(target)) { unfollowedCd = true; continue; }
    const abs = pathMod.isAbsolute(nativePath(target)) ? nativePath(target) : pathMod.join(anchorDirs[0] || process.cwd(), target);
    if (!anchorDirs.includes(abs)) anchorDirs.push(abs);
  }
  // Only `cat`/`sed` were gated, so the same whole-file dump walked through under any other verb:
  // `head -n 100000`, `tail -n +1`, `less`, `awk '1'`, `python3 -c "print(open(f).read())"` all
  // passed (reproduced x5 against a 1371-line file).
  // This pre-filter must name every verb the branches below look for: `readFileSync` / `File.read`
  // were in the runtime-dump pattern but not here, so `node -e "...readFileSync(f)..."` exited on
  // this line and that branch never ran (reproduced against the same 1371-line file).
  // Get-Content / gc / type are the PowerShell route's cat - wired on that tool, and unjudged until now.
  // ... and on the RAW command too: a script fed to a runtime through a heredoc reads inside the blanked body.
  // ... and the verbs that print a whole file under another name (wholeFiles), perl's handle reads and php's (2.1.6).
  const DUMP_VERBS = /\bcat\b|\bsed\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bawk\b|\bopen\(|\breadFileSync\b|\breadTextFile(?:Sync)?\b|File\.read|\bget-content\b|\bgc\b|\btype\b|\b(?:nl|tac|rev|fmt|expand|unexpand|fold|pr|od|xxd|hexdump|base64|strings|paste|column|sort|uniq|bat|batcat|cut|iconv|zcat|gzcat|zmore|zless|dd|cp|curl|vim?|nvim|gvim|ex|view|look|tee|done|split|diff|comm|sqlite3|[ef]?grep|rg|perl|ruby|php|open|readline|read_file|slurp|file_get_contents|readfile)\b|\b(?:shuf|vis|join|bzcat|xzcat|zstdcat|lz4cat|gzip|gunzip|bzip2|bunzip2|xz|unxz|lzma|unlzma|zstd|unzstd|lz4|brotli)\b|\bgit\b(?=[^\n;&|]*\b(?:show|diff)\b)/i;
  if (!DUMP_VERBS.test(command) && !DUMP_VERBS.test(String(input.command || ''))) process.exit(0);
  // EVERY test below is PER SEGMENT, and the extension is tested against the PATH the verb names -
  // never against the whole command. Testing `GATED_EXT_ANY` against the whole compound command
  // denied a command for an unrelated `*.js` glob sitting in a SIBLING segment (replayed: exit 2;
  // the same command minus that segment exit 0), and the sweep test running above the loop denied
  // an exact-filename `find -name` because a co-located bounded `grep | head -20` shared the line.
  // A path this guard cannot resolve is judged by its own segment, which is the old behaviour
  // narrowed to one segment rather than the whole line.
  const gatedIn = (text) => GATED_EXT_ANY.test(text);

  // Three shapes dumped whole source trees straight past the single-file check below (measured in
  // 5 sessions, 16-23 .cs files each, ~20k tokens a sweep): a shell loop whose cat argument is the
  // loop VARIABLE, a find -exec whose argument is the literal {}, and a multi-file `cat a.cs b.cs`
  // where only the first argument was ever size-checked. None can be size-checked per file.
  // A loop SPANS `;` boundaries by nature, so this one test stays above the segment loop - but the
  // extension is tested against the CONSTRUCT's own text, not the whole line, which is what denied
  // a command for an unrelated glob in a sibling segment. And a `find -name '<literal filename>'`
  // is exempt: no glob metacharacter means it names ONE file - the 'I know the name, not the path'
  // idiom, which falls through to the size check below like any other named target (its own denial
  // text used to advise doing exactly that).
  // The loop's own text ENDS at `done`: `[^\n]*?` ran straight past it, so an unrelated `cat` in a
  // later statement was read as the loop's body. Measured twice at ~88k tokens a block - the
  // capabilities skill's own grep-only loop followed by `; cat .mcp.json` was denied as a sweep.
  // The LOOP (I4, 2.1.4 audit) is read on a copy of the command whose quoted spans are blanked at the same
  // length (shell-writes.js's reader), so an index into the copy is an index into the command: a `cat` inside a
  // quoted string is text the loop carries (an `echo "{...cat .env...}"` payload was denied as a sweep, twice in
  // one audit), and a `done` inside one ends nothing. It is a sweep only when a `cat` in its body reads the
  // loop VARIABLE and a gated extension names what that variable walks - in the `in` list or in the operand
  // itself. Every other loop that happens to mention a `.js` (`node x.js`, a `*.jsonl` ledger) passes.
  const blankQuoted = (text) => {
    const chars = text.split('');
    for (const [a, b] of shellWrites ? shellWrites.quotedSpans(text) : []) for (let i = a; i < b; i++) if (chars[i] !== '\n') chars[i] = ' ';
    return chars.join('');
  };
  // Does the stage at `from` (quotes blanked) pipe straight into `wc`? Then the sweep prints a count, never the files
  // (audit 2026-10-20 C28, 8396b5df / a8804432: eight `... | xargs cat | wc -l`, `find -exec cat {} + | wc -l` and loop
  // `$(cat $d*.cs | wc -l)` line counts denied as dumps). find's `\;` ends its -exec, not the stage.
  const countedFrom = (masked, from) => {
    for (let i = from; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '>' && masked[i - 1] === '2') { i += masked[i + 1] === '&' ? 2 : 0; continue; } // stderr goes elsewhere
      if (ch === ';' || ch === '&' || ch === '\n' || ch === ')' || ch === '>' || ch === '<') return false;
      if (ch === '|') return masked[i + 1] !== '|' && /^\s*wc\b/.test(masked.slice(i + 1, i + 40));
    }
    return false;
  };
  const loop = (() => {
    const masked = blankQuoted(command);
    const LOOP_RE = /\bfor\s+([A-Za-z_]\w*)\s+in\b((?:(?!\bdo\b)[\s\S])*?)\bdo\b((?:(?!\bdone\b)[\s\S])*)/dgi;
    for (const m of masked.matchAll(LOOP_RE)) {
      const [listFrom, listTo] = m.indices[2];
      const [bodyFrom, bodyTo] = m.indices[3];
      const list = command.slice(listFrom, listTo);
      const body = masked.slice(bodyFrom, bodyTo);
      for (const c of body.matchAll(/(?:^|[;&|({\n]|\bthen\b|\belse\b)\s*cat\b/g)) {
        const from = bodyFrom + c.index + c[0].length;
        const stop = masked.slice(from, bodyTo).search(/[;&|<>)\n]/);
        const operand = command.slice(from, stop < 0 ? bodyTo : from + stop).trim();
        // sized per file only when cat reads the variable itself (`cat "$f"`), never a path built on it (`${d}/SKILL.md`)
        const bare = new RegExp(`^(?:-\\w+\\s+)*["']?\\$(?:\\{${m[1]}\\}|${m[1]}\\b)["']?$`).test(operand);
        if (new RegExp(`\\$\\{?${m[1]}\\b`).test(operand) && (SWEEP_EXT_ANY.test(list) || SWEEP_EXT_ANY.test(operand))
          && !(bare && smallLiteralLoop(list)) && !countedFrom(masked, from))
          return { var: m[1], operand: operand.slice(0, 120) };
      }
    }
    return null;
  })();
  const sweepM = loop ? null : command.match(/\bfind\b[^\n]*?-exec\s+cat\b[^\n]*/i)
    || lineHolding(command, /\|\s*xargs\s+(?:-\w+\s+)*cat\b/i);
  if (loop || sweepM) {
    const sweep = loop ? 'a shell loop over a file list'
      : /-exec/i.test(sweepM[0]) ? 'find -exec cat' : 'xargs cat';
    // `-iname` names one file the same way, case folded (audit 2026-10-20 H7: 8 corpus rows of `-iname <literal> | xargs cat`
    // were denied as sweeps)
    const namedFind = loop ? null : sweepM[0].match(/-(i?)name\s+(["']?)([^"'\s*?\[\]]+)\2(?=\s|$)/);
    // The literal-name exemption rests on 'no glob metacharacter means it names ONE file'. That
    // holds for a source file and fails completely for `-name SKILL.md`, which names one file per
    // skill directory - 35 of them in the measured dump, 46 in the next. So the exemption does not
    // cover markdown: a repeated literal `.md` name across a tree is the sweep, not the idiom.
    const namedOne = namedFind && !/\.md\b/i.test(namedFind[3] || '');
    const sweepMasked = loop ? '' : blankQuoted(sweepM[0]);
    const catAt = loop ? -1 : sweepMasked.search(/(?:-exec|\bxargs\b(?:\s+-\w+)*)\s+cat\b/i);
    const counted = catAt >= 0 && countedFrom(sweepMasked, catAt + sweepMasked.slice(catAt).search(/\bcat\b/) + 3);
    // ... and the files it names are SIZED, as a `cat` of each would be (H7: `find src -name big.ts -exec cat {} \;` printed
    // a 900-line file whole). Found under the find's start points, a bounded walk; one over THRESHOLD lines or BIG_BYTES is
    // the dump the Read half blocks.
    const bigNamed = namedOne && !counted ? namedFindOverCap(sweepM[0], namedFind[3], namedFind[1] === 'i') : null;
    if (bigNamed) {
      global.BLOCK_DETAIL = { branch: 'named-find-dump', file: pathMod.basename(bigNamed.file) };
      process.stderr.write(
        `Blocked: ${sweep} prints ${bigNamed.file} whole - ${bigNamed.why}.\n` +
        `The find names the file, but the cat after it prints every line, which is the whole-file read the Read gate\n` +
        `blocks. Locate what you need first (the navigation tools - LSP documentSymbol / goToDefinition - or grep -n for a\n` +
        `pattern), then read only the ranges that matter. Where the navigation tools are deferred, load them first with\n` + LOAD_NAV,
      );
      process.exit(2);
    }
    if (loop || (!namedOne && !counted && SWEEP_EXT_ANY.test(sweepM[0]))) {
      global.BLOCK_DETAIL = loop ? { branch: 'sweep', var: loop.var, operand: loop.operand } : { branch: 'sweep', shape: sweep };
      process.stderr.write(
        `Blocked: whole-file sweep of source files via ${sweep}.\n` +
        `Every file in the sweep is dumped unchecked - the per-file size gate cannot see a loop\n` +
        `variable or a find placeholder. Per alfred-navigation.md, locate what you need first\n` +
        `(the navigation tools - LSP documentSymbol / goToDefinition - or grep -n for a pattern), then read only the\n` +
        `ranges that matter. If you genuinely need one whole small file, cat it by name. Where the navigation\n` +
        `tools are deferred, load them first with\n` + LOAD_NAV,
      );
      process.exit(2);
    }
  }
  // The segments, stages, verbs, pipes and redirects below are read on `filled` (quoteFilled): a quoted `;`, `|`, `>` or
  // verb is text. A segment piped into a shell runs its strings, so it is read as written.
  const filled = quoteFilled(command);
  const intoFile = redirectedGroups(filled);
  const cuts = [0];
  for (const s of groupsAsCuts(filled).matchAll(/&&|\|\||;|\n/g)) cuts.push(s.index, s.index + s[0].length); // a subshell or group's parens are cuts
  cuts.push(command.length);
  for (let c = 0; c < cuts.length; c += 2) {
    const at = cuts[c];
    const seg = command.slice(at, cuts[c + 1]);
    const fseg = filled.slice(at, cuts[c + 1]);
    const hseg = /\|[ \t]*(?:(?:sudo|env|exec|command)[ \t]+)*(?:\S*\/)?(?:bash|sh|zsh|dash|ksh|fish|pwsh|powershell)\b/i.test(fseg) ? seg : fseg;
    // A pipe into a filter bounds the segment - unless every filter passes its input on (`grep ""`, `awk 1`) or lets
    // more than THRESHOLD lines through (`head -n 9999`): then the segment is judged with what they let through.
    const pipeSpan = segmentSpan(seg, fseg);
    if (!pipeSpan || pipeSpan.printed(1e9) <= THRESHOLD) continue;
    // Output redirected INTO a file never reaches the context - `cat a.ts > copy.ts` is a copy,
    // not a dump (an fd form like `2>&1` / `>&2` still prints, so only a path target is exempt).
    if (/\s>>?\s*[^&\s>]/.test(seg)) continue;
    // ...and so is every command inside a group or subshell redirected into a file (U25): the cuts split it at its own `;`
    // (the segment's own text from its first word: one cut after `&&` starts with the space before the group's `{`)
    const own = at + seg.length - seg.trimStart().length;
    if (intoFile.some(([a, b]) => own >= a && at + seg.length <= b + 1)) continue;

    // A dump verb whose output is unbounded is a dump: `head -n <huge>` and `tail -n +1` both print
    // the whole file, while a bounded `head -40` is the targeted read this gate exists to encourage.
    const unb = unquotedMatch(seg, hseg, /\bhead\s+-n\s*\d{5,}\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\btail\s+-n\s*\+\s*1\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\b(?:less|more)\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\bawk\s+(?:['"])1(?:['"])\s+((?:-\S+\s+)*\S+)/);
    if (unb && gatedIn(unb[1])) {
      process.stderr.write(
        'Blocked: unbounded whole-file dump (head -n <huge> / tail -n +1 / less / awk \'1\').\n' +
        'Per alfred-navigation.md, read the located range - the navigation tools\' goToDefinition, or a bounded\n' +
        'sed -n \'<start>,<end>p\' once you know where to look. Where the navigation tools are deferred, load them first with\n' + LOAD_NAV,
      );
      process.exit(2);
    }

    // Per pipeline segment: a bare `cat <gated file>` (or sed -n '1,$p') with no limiting
    // filter after it is a whole-file dump; `cat f | head -40` / grep / wc are targeted.
    const catAll = unquotedMatch(seg, hseg, /\bcat\s+((?:(?:-\w+|"[^"]+"|'[^']+'|[^\s;&|<>]+)\s*)+)/);
    const files = catAll
      ? catAll[1].trim().split(/\s+/).filter((t) => !t.startsWith('-')).map((t) => t.replace(/^["']|["']$/g, ''))
      : [];
    const sedM = unquotedMatch(seg, hseg, /\bsed\s+-n\s+["']1,\$p["']\s+("[^"]+"|'[^']+'|[^\s;&|<>]+)/);
    if (sedM) files.push(sedM[1].replace(/^["']|["']$/g, ''));
    // `echo "$(cat f)"` prints what its substitution read; an assignment or a runtime's `-e "$(cat f)"` does not.
    const subM = unquotedMatch(seg, hseg, /\b(?:echo|printf)\b[^;&|\n]{0,200}?(?:\$\(|`)\s*(?:cat|nl|tac)\s+(?:-\w+\s+)*("[^"]+"|'[^']+'|[^\s;&|<>)`]+)/);
    if (subM) files.push(subM[1].replace(/^["']|["']$/g, ''));
    // PowerShell's reader: bounded by -TotalCount / -Head / -First / -Tail / -Last; its path is the
    // positional argument or -Path / -LiteralPath, and the values of its other parameters are not paths.
    // The verb must be the segment's COMMAND (its start, or after a pipe, a paren, a brace or the quote of a script a shell runs, `pwsh -Command "..."`) - `grep type a.ts`
    // and `git gc` name the word as an argument.
    const gcM = unquotedMatch(seg, hseg, /(?:^\s*|[|(&{"']\s*)(?:get-content|gc|type)\s+((?:(?:-\w+|"[^"]+"|'[^']+'|[^\s;&|<>]+)\s*)+)/i);
    if (gcM) {
      const words = gcM[1].trim().match(/"[^"]+"|'[^']+'|\S+/g) || [];
      if (!words.some((w) => /^-(?:totalcount|head|first|tail|last)$/i.test(w))) {
        for (let k = 0; k < words.length; k++) {
          const w = words[k];
          if (/^-(?:path|literalpath|lp|pspath)$/i.test(w)) continue;
          if (/^-/.test(w)) { if (/^-(?:encoding|delimiter|readcount|filter|include|exclude|stream|credential)$/i.test(w)) k++; continue; }
          files.push(w.replace(/(?<!\))\)+$/, '').replace(/^["']|["']$/g, ''));
        }
      }
    }
    files.push(...wholeFiles(seg, filled, hseg));
    // A substitution that lists files hands every one to the dump verb (`cat $(find src -name '*.ts')`).
    const subSweep = unquotedMatch(seg, hseg, SUBST_SWEEP);
    if (subSweep && SWEEP_EXT_ANY.test(subSweep[0])) {
      global.BLOCK_DETAIL = { branch: 'sweep', shape: 'substitution' };
      process.stderr.write(
        `Blocked: a listing substitution (${subSweep[0].slice(0, 120)}) hands every file it names to the dump verb - a whole-file sweep.\n` +
        `Name the one file and read a range, or grep -n across them for what you need first:\n` + LOAD_NAV,
      );
      process.exit(2);
    }
    const entries = files.map((f) => ({ f, printed: (lc) => lc })).concat(spanFiles(seg, fseg));
    // A literal span (`sed -n a,bp`, head, tail, `awk NR`) that reaches the terminal as it is joins the Read tool's range
    // cap - judged after the file's other checks, so a span they block never counts as read (audit 2026-10-10 C11).
    const capSpans = [];
    for (const { f: rawF, printed, range } of entries) {
    const f = expandWith(assigns, rawF);
    const shown = (lc) => pipeSpan.printed(printed(lc));
    if (range && !isVar(f) && !/[*?[]/.test(f) && GATED_EXT.test(f) && shown(1e9) === printed(1e9)) capSpans.push({ f, range });
    if (shown(1e9) <= THRESHOLD) continue; // a span that never prints past the threshold is the targeted read
    // A target still carrying an unexpanded variable is unknowable - the sibling guard's rule:
    // judge nothing rather than deny on a guess. This failed CLOSED before, and half the denials
    // in one measured project were `$R/...` paths the session had every right to read.
    if (isVar(f)) continue;
    // A glob is a sweep - markdown included, the most measured sweep (`cat skills/*/SKILL.md`) - unless it expands to
    // files that together print no more than one cat the size gate lets through (audit 2026-10-20 C28, 3a8a1ee3 /
    // 56ca25cb: `cat Req/ReorderCategories*.cs` over two 2-line files, and a glob matching one generated migration or
    // none, were denied and the next call read the same files by name). A glob it cannot expand stays a sweep.
    if (/[*?[]/.test(f) && (GATED_EXT.test(f) || SWEEP_EXT_ANY.test(f))) {
      const matched = unfollowedCd ? null : globFiles(nativePath(f));
      if (matched && smallFiles(matched)) continue;
      process.stderr.write(
        `Blocked: a glob (${f}) hands every matching file to cat - a whole-file sweep, whatever each one weighs.\n` +
        `Name the one file and read a range, or locate the symbol first:\n` + navHint(f),
      );
      process.exit(2);
    }
    if (!GATED_EXT.test(f)) {
      // Any other extension is judged by SIZE, as the Read half is: a 130KB `cat big.md` printed whole passed the shell
      // route (audit 2026-10-08, route gap S2). Only a whole print that reaches the terminal - no program reading it.
      if (/[*?[]/.test(f) || pipeSpan.consumer || shown(1e9) !== 1e9) continue;
      const size = sizeOf(f);
      if (size > BIG_BYTES) {
        global.BLOCK_DETAIL = { branch: 'size', bytes: size };
        process.stderr.write(
          `Blocked: whole-file print of ${f} (${Math.round(size / 1024)}KB) via ${payload.tool_name}.\n` +
          `A file this large does not fit a tool result - printing it whole spends its entire size on context, the\n` +
          `whole-file Read the Read gate blocks routed through the shell. Take what you came for instead:\n` +
          `  grep -n '<pattern>' '${f}'   ->  then a bounded sed -n '<start>,<end>p' on the lines it names\n` +
          `  head -c 2000 '${f}'          ->  the first bytes, when it has no lines\n`,
        );
        process.exit(2);
      }
      continue;
    }
    // Nothing at any anchor prints nothing - a wrong path, a file the command creates first, a target past a cd the guard
    // cannot follow (that one failed CLOSED until complexity stage 1 A5).
    const { lc } = resolveLineCount(f);
    // A whole print past THRESHOLD lines, or a span printing past THRESHOLD lines and more than half the file - the
    // Read half's own 'half the file or less per range'.
    const n = shown(lc);
    if (lc > THRESHOLD && n > THRESHOLD && (n === lc || n > lc / 2)) {
      process.stderr.write(
        `Blocked: ${n === lc ? 'whole-file dump' : `a ${n}-line span`} of ${f} (${lc} lines) via ${payload.tool_name}.\n` +
        `Per alfred-navigation.md, a bare cat/sed of a large source file is the same\n` +
        `whole-file read the Read gate blocks - routed through the shell.\n` +
        (VIRTUAL.has(f)
          ? `It is a git object, so bound the print: git show '${f}' | grep -n '<pattern>', then\n` +
            `git show '${f}' | sed -n '<start>,<end>p' on the lines it names (git diff <rev> -- <path> for what changed).\n`
          : navHint(f)),
      );
      process.exit(2);
    }
    }
    for (const { f, range } of capSpans) {
      const at = resolvedPath(f);
      const lc = at ? lineCountOf(at) : 0;
      if (lc <= THRESHOLD) continue;
      const [a, b] = range(lc);
      if (b >= a) rangeCap(at, f, lc, a, b);
    }
  }
  } catch (err) {
    if (!(err instanceof JudgeBudget)) throw err;
    global.BLOCK_DETAIL = { branch: 'budget', matched: err.message };
    process.stderr.write(`Blocked: this command is too large or too deeply nested for the read guard to judge inside its\n` +
      `budget (${JUDGE_WORK.max} characters of judging) - nothing ran, and a command it cannot judge is read as the whole-file dump it may be.\n` +
      `Split it into smaller commands, or locate what you need first and read that range. Where the navigation tools\n` +
      `are deferred, load them first with\n` + LOAD_NAV);
    process.exit(2);
  }
  process.exit(0);
}

// ---- Read matcher ----
const path = input.file_path || '';
// Only gate source / markup files we navigate by symbol or read by range:
// the symbol-navigable languages the stack's LSP plugins cover (TS/JS family,
// C#, Go), plus large templates (Angular .html, Razor .razor/.cshtml, WPF
// .xaml) where you should read the range. SQL/SCSS/markdown aren't symbol-nav.
// A file too big to fit a tool result is the most predictable whole-read in the system, whatever
// its extension: the harness spills the oversized output to disk, and the recovery Read pulls the
// whole thing straight back into context. Measured: a 93KB spill read WHOLE, twice, for 99,277
// chars and no hook-block row, because the extension was not on the gated list. This branch judges
// SIZE, not language, and it only ever objects to the whole-file SHAPE - a ranged read of the same
// file passes untouched, which is the entire remedy. BIG_BYTES itself is declared beside THRESHOLD.
if (!GATED_EXT.test(path)) {
  let size = 0;
  try { size = fs.statSync(path).size; } catch { /* missing - let Read surface its own error */ }
  // A PDF Read naming its `pages` is a range, and a rendered image costs visual tokens by its pixels, never its bytes -
  // at most 4,784 for the largest the model takes (platform.claude.com/docs/en/build-with-claude/vision, 'Resolution and
  // token cost'), where 60KB of text is about 15,000. Both were blocked, and the issue-diagnoser's screenshot Read with
  // them (audit 2026-10-08).
  const whole = (input.offset ?? 0) <= 1 && input.limit == null && input.pages == null && !RENDERED_IMAGE.test(path);
  // A plan under the docs root's work/plans/ (plans/ before 2.8.0, until an update moves it) is a seat's MANDATED input,
  // read whole by design: a verifier denied its 65KB plan read it back through two ranges at once, so the block bought a
  // round trip and nothing else (audit 2026-10-10, session 05c925e9).
  const docsRel = docsRootEnv().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  // A scorer draft (mode-output-scorer) is the grader's mandated input the same way: the seat reads the whole draft.
  const dataRel = (() => { try { return require('./layout.js').dataRoot(process.env); } catch { return '.alfred'; } })();
  const scorerDraft = /\.md$/i.test(path) && String(path).replace(/\\/g, '/').includes(`${dataRel}/state/sessions/scorer/`);
  const planFile = scorerDraft || (/\.md$/i.test(path) && [`${docsRel}/work/plans/`, `${docsRel}/plans/`].some((d) => String(path).replace(/\\/g, '/').includes(d))); // plans/ is pre-2.8.0
  if (size > BIG_BYTES && whole && !planFile && /\.pdf$/i.test(path)) {
    // A PDF is read by PAGE: the Read tool takes one of 10 pages or fewer whole, and a longer one only through `pages`,
    // at most 20 a call - the binary remedy below ('head -c', 'file') answered nothing for one (hooks review 2026-10-16).
    // The page count is the document's own page objects; a count it hides (compressed object streams) asks for pages.
    let pages = 0;
    try {
      const fd = fs.openSync(path, 'r');
      const buf = Buffer.alloc(Math.min(size, 8 * 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
    } catch { pages = 0; }
    if (pages > 0 && pages <= 10) process.exit(0);
    process.stderr.write(`Blocked: whole-file Read of ${path} (${Math.round(size / 1024)}KB, ${pages ? `${pages} pages` : 'page count unknown'}).\n`
      + 'Read a PDF by page: Read with `pages: "1-5"` (at most 20 pages a call), then the next range only if the first did not answer.\n');
    process.exit(2);
  }
  if (size > BIG_BYTES && whole && !planFile) {
    // A grep remedy needs LINES. This branch judges size, not language, so it also catches the 93KB
    // PNG and the one-line minified bundle, where `grep -n` and an offset+limit Read both answer
    // nothing (measured: 2 wasted calls on an image). Sniff the first bytes and prescribe PAGING there.
    let head = null;
    try {
      const fd = fs.openSync(path, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n);
    } catch { /* unreadable - fall back to the line-based remedy */ }
    const unlined = !!head && (head.includes(0) || head.toString('latin1').split('\n').some((l) => l.length > 1000));
    process.stderr.write(
      `Blocked: whole-file Read of ${path} (${Math.round(size / 1024)}KB).\n` +
      `A file this large does not fit a tool result - reading it whole spends its entire size on\n` +
      `context, and every message after it re-sends that. Take what you came for instead:\n` +
      (unlined
        ? `This file is binary or minified - it has no lines to grep or to Read by range. Page it:\n`
          + `  head -c 2000 '${path}'      ->  the first bytes, capped\n`
          + `  sed -n '1,40p' '${path}'    ->  a page, if it has lines at all\n`
          + `  file '${path}'              ->  what it is, when the bytes say nothing`
        : `  grep -n '<pattern>' '${path}'   ->  then Read with offset+limit on the lines it names\n`
          + `A persisted/spilled output is the common case here: grep or tail it, never Read it whole.`),
    );
    process.exit(2);
  }
  process.exit(0);
}
const lineCount = lineCountOf(path);
if (lineCount === 0) process.exit(0); // missing/unreadable - let Read surface its own error
if (lineCount <= THRESHOLD) process.exit(0);

const offset = Math.max(1, input.offset ?? 1);
const wholeShape = (input.offset ?? 0) <= 1 && (input.limit == null || input.limit >= lineCount);
// A head window genuinely smaller than the file is targeted; a limit that spans
// the whole file (limit: 2000 from the top) is a whole-file Read wearing a range.
if (wholeShape) {
  const state = treeState(pathMod.resolve(anchorDirs[0] || process.cwd(), path));
  process.stderr.write(
    `Blocked: whole-file Read of ${path} (${lineCount} lines). Read is for code you've ALREADY located: locate the\n` +
      `symbol, then Read its range with offset+limit. A limit covering the whole file is still a whole read, and ranges\n` +
      `of one file may cover at most ${Math.round(CAP * 100)}% of it per session - never read it in halves.\n` +
      (state === 'changed' ? `Reviewing this change? Its diff is the review route: git diff HEAD -- '${path}'\n` : '') +
      navHint(path),
  );
  process.exit(2);
}

// Cumulative cap: one rule with the shell's literal spans (rangeCap, above).
const end = Math.min(lineCount, offset + (input.limit != null ? input.limit : lineCount) - 1);
rangeCap(pathMod.resolve(anchorDirs[0] || process.cwd(), path), path, lineCount, offset, end);
process.exit(0);
