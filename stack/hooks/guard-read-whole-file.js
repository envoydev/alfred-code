#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash): enforce alfred-navigation.md's hard rule - "Read
// is for code you've ALREADY located, never to find a symbol." Blocks a whole-file Read of a
// large source file so navigation goes through the navigation server (get_symbols_overview -> find_symbol)
// first; on Bash it blocks the same dump routed around the Read tool (a bare `cat file.ts` -
// measured: one session cat-ed the exact file the Read matcher had blocked, unblocked, and a
// 47-file grep loop dumped ~19.8k tokens the guard never saw). It also caps CUMULATIVE ranged
// reads per file per session: 2-3 half-splits that reconstruct the whole file satisfied the
// per-call check in 7 files across one run with zero counter-examples, so past ~60% coverage
// the remainder goes through the navigation server. A cat whose output is redirected into a file is a copy,
// not a dump, and passes. exit 2 = block (stderr fed back); exit 0 = allow.
const fs = require('fs');
// The docs root env value, ALFRED_CODE_DOCS_PATH (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const os = require('os');
const pathMod = require('path');
// The judging budget (review M3 of 2.1.6), its thresholds in this one place. It counts WORK, never time, so a
// command gets the same verdict on any machine under any load: each judging step charges the characters it reads,
// past JUDGE_MAX_WORK the command is blocked, and a script nested deeper than JUDGE_MAX_DEPTH is read as printing what
// it read - judged the conservative way, never let through. The credential guard carries the same budget. The count
// is `global.JUDGE_WORK`; a test preload lowers the ceiling through `global.JUDGE_WORK_MAX`.
// 20x the most any of 54,503 recorded commands cost (99,197), and about a second of judging
const JUDGE_MAX_WORK = 2000000;
const JUDGE_MAX_DEPTH = 64;
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
const THRESHOLD = 200;
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
// The byte size of a possibly-relative path, anchored like the line count; 0 when it is no regular file.
const sizeOf = (raw) => {
  const p = nativePath(raw);
  for (const abs of pathMod.isAbsolute(p) ? [p] : anchorDirs.map((d) => pathMod.join(d, p))) {
    try { const st = fs.statSync(abs); return st.isFile() ? st.size : 0; } catch { /* next anchor */ }
  }
  return 0;
};
const resolveLineCount = (raw) => {
  const p = nativePath(raw);
  if (pathMod.isAbsolute(p)) return { lc: lineCountOf(p), resolved: true };
  for (const d of anchorDirs) {
    const abs = pathMod.join(d, p);
    if (fs.existsSync(abs)) return { lc: lineCountOf(abs), resolved: true };
  }
  return { lc: 0, resolved: false };
};
// The trees the installers seed into the navigation server's OWN `ignored_paths` (its project.yml): the data
// root (ALFRED_CODE_DATA_PATH, default .alfred - serena's own home, the browser profiles, the docs), `.claude`,
// and the 2.0.0 `.serena` / `.playwright`. It cannot index them, so naming its tools for a path under one of them
// hands the model a remedy that errors. Measured twice - the denial named it for a `.claude/...` path and the
// redirect the model made from it failed. The ranged read is the remedy there.
const SERENA_IGNORED = /(?:^|[\\/])\.(?:claude|serena|playwright)(?:[\\/]|$)/;
const dataRootEnv = () => String(envOf(process.env, 'DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const underDataRoot = (p) =>
{
  const root = dataRootEnv();
  if (!root || /[\s$]/.test(root)) return false;
  const norm = String(p).replace(/\\/g, '/');
  return norm === root || norm.startsWith(`${root}/`) || norm.includes(`/${root}/`);
};
// The hint must be EXECUTABLE, not just correct. The navigation server's tools are deferred behind tool search in
// this harness, so naming them is not having them: measured, two sessions carried the rule text
// saying exactly that and still made 100 Bash calls and 0 navigation calls. The loading call goes in
// the denial itself, where the model is already looking for what to do instead.
const LOAD_SERENA = `  ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__get_symbols_overview,mcp__plugin_alfred-navigation_alfred-navigation__find_symbol,mcp__plugin_alfred-navigation_alfred-navigation__find_referencing_symbols\n`
  + `  (a seat whose tools: list names them has them loaded already - call them directly)\n`;
const serenaHint = (p) => (SERENA_IGNORED.test(String(p)) || underDataRoot(p)
  ? `The navigation server cannot locate anything here: the installers seed the data root (\`${dataRootEnv()}\`), \`.claude\` and the old \`.serena\` / \`.playwright\` into\n`
    + `its own ignored_paths, so this tree is not indexed. Locate inside the file instead:\n`
    + `  grep -n '<pattern>' '${p}'   ->  then Read with offset+limit on the lines it names.`
  : `Locate first with the navigation server. If those tools are not loaded in this session, load them first:\n` +
  LOAD_SERENA +
  `then get_symbols_overview('${p}') and find_symbol(...),\n` +
  `then Read with offset+limit on the returned range (find_symbol with include_body=true only for a SMALL symbol;\n` +
  `for a large body fetch it without the body first, then Read the range you need).`);

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
// (and read back when a shell reads them), unless the shell's output is bounded by a filter or sent into a file. Each
// restored body is kept in `shellBodies`, where the runtime-heredoc pass below finds a runtime heredoc nested inside.
// The spans are `heredocsOf`'s, the reader every guard shares, so every opener spelling it accepts is one here too
// (`<<\EOT` was never judged, seam M1).
let shellBodies = [];
function stripHeredocsOf(c, depth = 0) {
  if (!depth) shellBodies = [];
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
    shellBodies.push(body);
    out = out.slice(0, h.bodyStart) + stripHeredocsOf(body, depth + 1) + out.slice(h.bodyStart + body.length);
  }
  return out;
}
// A here-string is a one-line heredoc: `bash <<< 'cat f'` runs its word as commands, `python3 - <<< "print(open(f).read())"`
// as a script. A SHELL's here-string is read in the judged view as its `-c` (three characters, as wide, a lone `-` before it
// blanked), so the inline passes below judge it as they judge `-c` (seam m2); a runtime's is judged as a heredoc body below
// (`hereStringsOf`), whatever its `-` or flags (seam delta 3).
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
// The here-strings of `text` as heredoc-shaped records - the line, where `<<<` starts in it, the word it hands over.
function hereStringsOf(text) {
  const out = [];
  for (let i = text.indexOf('<<<'); i >= 0; i = text.indexOf('<<<', i + 3)) {
    const lineStart = text.lastIndexOf('\n', i) + 1;
    const nl = text.indexOf('\n', i);
    const word = /^\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/.exec(text.slice(i + 3, nl < 0 ? text.length : nl));
    if (word) out.push({ line: text.slice(lineStart, nl < 0 ? text.length : nl), at: i - lineStart, body: word[1].replace(/^(['"])([\s\S]*)\1$/, '$2') });
  }
  return out;
}
// ---- what an inline runtime script PRINTS (2.1.6 K2) ----------------------------------------------
// A read through a runtime is a dump only when the file's CONTENT reaches the output. Measured: `node -e
// 'const h=readFileSync(f);const s=[...h.matchAll(re)].map(m=>m[1]);for(const c of s){new Function(c)};
// console.log("scripts parse:",s.length)'` printed one count and was denied - the segment split cut the
// script at its first `;`, and the count test only knew a method chained straight onto the read call. So
// the WHOLE script is read: the names that hold content (the read itself, and every name assigned or looped
// from one, and a collection it is put into), then every print - an argument carrying one of them un-reduced
// (not reduced to a length, a count, a test, a comparison, a map of those) prints the content. A print reached
// through an alias is followed; one reached any way this reading cannot follow is a dump. The same reading
// catches dumps the old test passed: a read in the script's second statement, a `.split('\n')` array printed
// whole, and (2.1.6) a print through `const p = console.log`, `console.log.call` or `[h].forEach(console.log)`.
// String and regex-literal CONTENTS are blanked first, keeping the quotes and the length, so a name, a paren
// or a `;` inside one is never code - an interpolation (`${x}`, f'{x}', "#{x}") stays code, since it prints x.
function maskLiterals(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (k) => { if (k < n && out[k] !== '\n') out[k] = ' '; };
  const prevCode = (k) => { for (let j = k - 1; j >= 0; j--) if (!/\s/.test(src[j])) return src[j]; return ''; };
  let code;
  const str = (q, interp) => {
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === q) { i++; return; }
      if (interp === '{' && c === '{' && src[i + 1] === '{') { blank(i); blank(i + 1); i += 2; continue; }
      const open = interp === '${' ? (c === '$' && src[i + 1] === '{' ? 2 : 0)
        : interp === '#{' ? (c === '#' && src[i + 1] === '{' ? 2 : 0)
          : interp === '{' ? (c === '{' ? 1 : 0) : 0;
      if (open) { i += open; code('}'); i++; continue; }
      blank(i);
      i++;
    }
  };
  const regex = () => {
    i++;
    let cls = false;
    while (i < n && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (!cls && c === '/') { i++; while (i < n && /[a-z]/i.test(src[i])) i++; return; }
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      blank(i);
      i++;
    }
  };
  code = (stop) => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (stop && c === stop && depth === 0) return;
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      if (c === '`') { str('`', '${'); continue; }
      if (c === '"' || c === "'") {
        const fString = /[fF]/.test(src[i - 1] || '') && !/[\w$]/.test(src[i - 2] || '');
        str(c, fString ? '{' : c === '"' ? '#{' : null);
        continue;
      }
      if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && /^$|[(,=:[!&|?{};+\-*%<>~^]/.test(prevCode(i))) { regex(); continue; }
      i++;
    }
  };
  code(null);
  return out.join('');
}
const CLOSE = { '(': ')', '[': ']', '{': '}' };
// The masked script's brackets and statement ends, found in one pass each and read in O(1): matchClose and stmtEnd
// rescanned the rest of the script per call, once per assignment and per occurrence (review M3 of 2.1.6). Per position
// the innermost open bracket before it (`encl`), and per open bracket its first top-level `for` and comma - what
// reducedOcc walked back and forth for on every occurrence; the next `.` from each position, and receiverStart's answers.
let structOf = { m: null, close: null, stop: null, line: null, encl: null, firstFor: null, firstComma: null, nextDot: null, cond: null, recv: null };
function structure(m) {
  if (structOf.m === m) return structOf;
  const n = m.length;
  const close = new Int32Array(n).fill(-1);
  const encl = new Int32Array(n + 1).fill(-1);
  const firstFor = new Int32Array(n).fill(-1);
  const firstComma = new Int32Array(n).fill(-1);
  const stack = [];
  for (let k = 0; k < n; k++) {
    const c = m[k];
    const top = stack.length ? stack[stack.length - 1] : -1;
    encl[k] = top;
    if (CLOSE[c]) stack.push(k);
    else if (c === ')' || c === ']' || c === '}') { const o = stack.pop(); if (o !== undefined) close[o] = k; }
    else if (top >= 0 && c === ',' && firstComma[top] < 0) firstComma[top] = k;
    else if (top >= 0 && c === 'f' && firstFor[top] < 0 && m.startsWith('for', k) && !/\w/.test(m[k + 3] || '') && !/[\w$]/.test(m[k - 1] || '')) firstFor[top] = k;
  }
  encl[n] = stack.length ? stack[stack.length - 1] : -1;
  const stop = new Int32Array(n + 1).fill(n);
  const line = new Int32Array(n + 1).fill(n); // the same without the comma: stmtEnd's `lists`
  for (let k = n - 1; k >= 0; k--) {
    const c = m[k];
    if (c === ';' || c === '\n' || c === ')' || c === ']' || c === '}') { stop[k] = k; line[k] = k; }
    else if (c === ',') { stop[k] = k; line[k] = line[k + 1]; }
    else if (CLOSE[c]) { stop[k] = close[k] < 0 ? n : stop[close[k] + 1]; line[k] = close[k] < 0 ? n : line[close[k] + 1]; }
    else { stop[k] = stop[k + 1]; line[k] = line[k + 1]; }
  }
  const nextDot = new Int32Array(n + 1).fill(n);
  for (let k = n - 1; k >= 0; k--) nextDot[k] = m[k] === '.' ? k : nextDot[k + 1];
  // Per position: inside a keyword test at its own depth - from `if` / `unless` / `elif` to its `then`, `else`, `do`,
  // a python `:`, a `{`, the statement's end or the closing bracket. A test's operand is read, never printed (`puts n if
  // s`, `n if s else 0`); `while` and `until` stay out, since perl's `print while <F>` prints every line through $_.
  const cond = new Uint8Array(n + 1);
  const on = [0];
  const KEYWORD = /(?:if|unless|elif|then|else|do)(?![\w$])/y;
  for (let k = 0; k < n; k++) {
    const c = m[k];
    if (CLOSE[c]) { if (c === '{') on[on.length - 1] = 0; on.push(0); }
    else if (c === ')' || c === ']' || c === '}') { if (on.length > 1) on.pop(); }
    else if (c === ';' || c === '\n' || (c === ':' && !(/\s/.test(m[k - 1] || '') && /\w/.test(m[k + 1] || '')))) on[on.length - 1] = 0; // ` :sym` is ruby's
    else if (c >= 'a' && c <= 'u' && !/[\w$@%.]/.test(m[k - 1] || '')) {
      KEYWORD.lastIndex = k;
      const w = KEYWORD.exec(m);
      if (w) on[on.length - 1] = w[0] === 'if' || w[0] === 'unless' || w[0] === 'elif' ? 1 : 0;
    }
    cond[k] = on[on.length - 1];
  }
  structOf = { m, close, stop, line, encl, firstFor, firstComma, nextDot, cond, recv: new Int32Array(n + 1).fill(-1) };
  return structOf;
}
function matchClose(m, j) {
  if (m === curM && CLOSE[m[j]]) return structure(m).close[j];
  let depth = 0;
  for (let k = j; k < m.length; k++) {
    if (CLOSE[m[k]]) depth++;
    else if (m[k] === ')' || m[k] === ']' || m[k] === '}') { depth--; if (depth === 0) return k; }
  }
  return -1;
}
// Where the statement starting at `from` ends: a top-level `;`, `,`, newline or an unmatched closer. `lists` keeps
// the commas in: a paren-less call's argument list (`puts "x", s`, perl's `join "", <F>`) runs to the statement's end.
function stmtEnd(m, from, lists = false) {
  if (m === curM && from <= m.length) return structure(m)[lists ? 'line' : 'stop'][from];
  let depth = 0;
  for (let k = from; k < m.length; k++) {
    const c = m[k];
    if (CLOSE[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return k; depth--; }
    else if (depth === 0 && (c === ';' || (c === ',' && !lists) || c === '\n')) return k;
  }
  return m.length;
}
// Members whose result is a number or a boolean, never the content whatever the receiver held. Python's
// `find` / `index` return a position; JavaScript's `find` returns an element, so those two count only there.
const REDUCERS = 'length|size|byteLength|count|sum|includes|include|test|indexOf|lastIndexOf|search|findIndex|findLastIndex'
  + '|startsWith|endsWith|startswith|endswith|has|every|some|any|all|none|empty|nil|localeCompare|charCodeAt|codePointAt'
  + '|toFixed|isdigit|isalpha|isalnum|isspace|isupper|islower|isnumeric|bytesize';
const REDUCER_MEMBER = { js: new RegExp(`^(?:${REDUCERS})$`), python: new RegExp(`^(?:${REDUCERS}|find|rfind|index|rindex)$`), ruby: new RegExp(`^(?:${REDUCERS}|index|rindex)$`) };
const reducerOf = (lang) => REDUCER_MEMBER[lang] || REDUCER_MEMBER.js;
// Calls whose callback decides what they return: a map of lengths is lengths, a reduce to a sum is a number.
const MAPPER = /^(?:map|flatMap|reduce|reduceRight)$/;
// A SLICE with literal bounds no larger than the ranged read the Read-tool half allows is a ranged read - the
// `sed -n 10,40p` of a script: THRESHOLD lines for a slice of lines, BIG_BYTES for a slice of characters. So is a WINDOW
// of constant width around ONE base (`src.slice(i - 220, i + 220)`, `h[a:b]` with a and b bound around one match) when
// that base is a search hit, a match or a length - the grep -C of a script (2.1.6). A slice with an open or oversized
// end, two different bases, or a base stepped by a counter across the file is the dump it always was; a negative start
// with no end is `tail -N`, bounded by N. The span is read from the ORIGINAL text (`srcText`), where the masked copy
// (`curM`) has blanked a split's argument; the two share every position.
const SLICE_MEMBER = /^(?:slice|substring|substr)$/;
const LINE_SPLIT_ARG = /^\s*(?:(['"`])(?:\\r)?\\n\1|\/(?:\\r\??)?\\n\/[a-z]*)\s*$/;
const LINES_MEMBER = /^(?:splitlines|readlines|lines)$/;
// A bound is literal when it is an integer or constant arithmetic over integers (`4563608 - 900`); anything else is computed.
const boundOf = (t) => (/^\s*(?:-\s*)?\d+(?:\s*[+-]\s*\d+)*\s*$/.test(t) ? t.replace(/\s+/g, '').match(/[+-]?\d+/g).reduce((n, x) => n + Number(x), 0) : null);
let srcText = '';
let curM = '';
function sliceSpan(args, method) {
  const parts = args.split(',');
  if (parts.length > 2) return null;
  const [a, b] = [parts[0], parts[1]];
  const A = a === undefined || !a.trim() ? 0 : boundOf(a);
  const B = b === undefined ? undefined : boundOf(b);
  if (A === null || B === null) return null;
  if (method === 'substr') return B !== undefined ? Math.max(0, B) : A < 0 ? -A : null;
  if (B === undefined) return A < 0 ? -A : null;
  if (method === 'substring') return Math.abs(Math.max(0, B) - Math.max(0, A));
  return (A < 0) === (B < 0) ? Math.max(0, B - A) : null; // one bound from each end: the length decides, unknown here
}
// A python subscript `[a:b]` / `[:b]` / `[-n:]`: its span, or null when a bound is computed or the end is open.
function subscriptSpan(inner) {
  const parts = inner.split(':');
  if (parts.length < 2 || parts.length > 3 || (parts[2] !== undefined && !/^\s*(?:1\s*)?$/.test(parts[2]))) return null;
  const A = !parts[0].trim() ? 0 : boundOf(parts[0]);
  const B = !parts[1].trim() ? undefined : boundOf(parts[1]);
  if (A === null || B === null) return null;
  if (B === undefined) return A < 0 ? -A : null;
  return (A < 0) === (B < 0) ? Math.max(0, B - A) : null;
}
const withinCap = (span, unit) => span !== null && span <= (unit === 'lines' ? THRESHOLD : BIG_BYTES);
// The names bound to the content's LINES (`const lines = src.split("\n")`), whose slice counts lines, not characters.
let linesNames = new Set();
// The top-level pieces of curM[a, b) split at `sep` (`,` or `:`) as [from, to) pairs: a bracket or a blanked string never splits.
function splitTop(a, b, sep) {
  const out = [];
  let from = a;
  for (let k = a, depth = 0; k < b; k++) {
    const c = curM[k];
    if (CLOSE[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === sep) { out.push([from, k]); from = k + 1; }
  }
  out.push([from, b]);
  return out;
}
const trimSpan = ([a, b]) => { while (a < b && /\s/.test(curM[a])) a++; while (b > a && /\s/.test(curM[b - 1])) b--; return [a, b]; };
function openOf(close) {
  for (let k = close - 1, depth = 0; k >= 0; k--) {
    const c = curM[k];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (CLOSE[c]) { if (depth === 0) return k; depth--; }
  }
  return -1;
}
// Every binding of a name in the script - the right-hand side of each `name = ...` - and whether the name is a COUNTER:
// stepped (`+=`, `++`) or a counting loop's own variable (`range`, `enumerate`, `.entries()`, a C-style `for`).
let counterVars = new Set();
let bindingMemo = new Map();
function bindingsOf(name) {
  if (bindingMemo.has(name)) return bindingMemo.get(name);
  const esc = name.replace(/\$/g, '\\$');
  const rhs = [];
  let counter = counterVars.has(name);
  for (const x of curM.matchAll(new RegExp(`(?<![\\w$.])${esc}\\s*(\\*\\*|[-+*/%]|\\|\\||\\?\\?|&&)?=(?![=>])`, 'g'))) {
    if (x[1] && !/^(?:\|\||\?\?|&&)$/.test(x[1])) { counter = true; continue; }
    const from = x.index + x[0].length;
    rhs.push([from, stmtEnd(curM, from)]);
  }
  if (new RegExp(`(?:\\+\\+|--)\\s*${esc}(?![\\w$])|(?<![\\w$.])${esc}\\s*(?:\\+\\+|--)`).test(curM)) counter = true;
  const r = { rhs, counter };
  bindingMemo.set(name, r);
  return r;
}
// One bound as { base, off, span }: a constant (base ''), or one base plus a constant. The base is a match's position
// (`m.index`, `m.start()`, `m.end()` - the end is the start plus the match's own length, grep's unit), a length
// (`len(s)`, `s.length` - a window anchored at the end, `tail -c`), a name, or an expression. A name bound once is read
// through (`a = max(0, m.start() - 160)`). A clamp only narrows a window: `Math.max(0, i - 220)` as a start and
// `min(len(s), m.end() + 250)` as an end read as their inner bound.
const LEN_BASE = /^(?:len\(([A-Za-z_$][\w$]*)\)|([A-Za-z_$][\w$]*)\.(?:length|size))$/;
const MATCH_BASE = /^([A-Za-z_$][\w$]*)\.(?:index|start\(\d*\)|end\(\d*\))$/;
const MATCH_LEN = /^(?:([A-Za-z_$][\w$]*)\[0\]\??\.length|len\(([A-Za-z_$][\w$]*)(?:\.group\(\d*\)|\[0\])?\)|([A-Za-z_$][\w$]*)\.length)$/;
function boundParts(span, side, names, depth = 0) {
  let [a, b] = trimSpan(span);
  while (a < b && curM[a] === '(' && matchClose(curM, a) === b - 1) [a, b] = trimSpan([a + 1, b - 1]);
  if (a >= b || depth > 3) return null;
  const lit = boundOf(srcText.slice(a, b));
  if (lit !== null) return { base: '', off: lit };
  const clamp = /^(?:Math\s*\.\s*)?(max|min)\s*\(/.exec(curM.slice(a, b));
  if (clamp && matchClose(curM, a + clamp[0].length - 1) === b - 1) {
    const args = splitTop(a + clamp[0].length, b - 1, ',').map(trimSpan);
    const floor = (s) => boundOf(srcText.slice(s[0], s[1])) !== null;
    const ceil = (s) => floor(s) || LEN_BASE.test(curM.slice(s[0], s[1]).replace(/\s+/g, ''));
    const edge = clamp[1] === 'max' && side === 'start' ? floor : clamp[1] === 'min' && side === 'end' ? ceil : null;
    if (!edge || args.length !== 2) return null;
    const keep = edge(args[0]) ? 1 : edge(args[1]) ? 0 : -1;
    return keep < 0 ? null : boundParts(args[keep], side, names, depth + 1);
  }
  const terms = [];
  let from = a;
  let sign = 1;
  for (let k = a, d = 0; k < b; k++) {
    const c = curM[k];
    if (CLOSE[c]) d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && (c === '+' || c === '-') && /[\w$)\]]/.test(curM.slice(from, k).trimEnd().slice(-1))) {
      terms.push({ sign, span: trimSpan([from, k]) });
      sign = c === '+' ? 1 : -1;
      from = k + 1;
    }
  }
  terms.push({ sign, span: trimSpan([from, b]) });
  let off = 0;
  let base = null;
  for (const t of terms) {
    const text = curM.slice(t.span[0], t.span[1]).replace(/\s+/g, '');
    const n = boundOf(srcText.slice(t.span[0], t.span[1]));
    if (n !== null) { off += t.sign * n; continue; }
    const len = MATCH_LEN.exec(text);
    if (base && t.sign > 0 && len && !names.has(len[1] || len[2] || len[3])) continue; // `m.index + m[0].length`: the match itself
    if (base || t.sign < 0) return null;
    base = baseOf(t.span, text, side, names, depth);
    if (!base) return null;
    off += base.off;
  }
  return base && base.key ? { base: base.key, off, span: base.span } : { base: '', off };
}
function baseOf(span, text, side, names, depth) {
  let x;
  if ((x = MATCH_BASE.exec(text))) return { key: `match:${x[1]}`, off: 0 };
  if ((x = LEN_BASE.exec(text))) return { key: `len:${x[1] || x[2]}`, off: 0 };
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    const bs = bindingsOf(text);
    if (!bs.counter && bs.rhs.length === 1) {
      const inner = boundParts(bs.rhs[0], side, names, depth + 1);
      if (inner) return { key: inner.base, off: inner.off, span: inner.span };
    }
    // a name bound more than once holds one value per binding: the key names the binding that reaches this use, so a
    // bound read through an older binding shares no base with one read after the name moved (review M4 of 2.1.6)
    return { key: bs.rhs.length > 1 ? `name:${text}#${bs.rhs.filter((r) => r[0] < span[0]).length}` : `name:${text}`, off: 0 };
  }
  return { key: `expr:${srcText.slice(span[0], span[1]).replace(/\s+/g, '')}`, off: 0, span };
}
// Is a window's base a fixed point rather than a walk? A match or a length is; a name only when every binding of it is a
// position (a counter never is); an expression only when it is a search hit whose argument is no element of a walk over
// the content (`src.indexOf(l)` for every line is every window). Anywhere a match test guards (`guardedAt`), any base
// is: the window is printed only where the element matched, which is grep -C.
const SEARCH_TAIL = /\.\s*(?:indexOf|lastIndexOf|search|find|rfind|index|rindex|findIndex|findLastIndex)\s*\($/;
function baseOk(b, pos, names, depth = 0) {
  if (/^(?:match|len):/.test(b.base)) return true;
  if (pos >= 0 && guardedAt(pos, countersIn(b.base.replace(/^\w+:/, '')))) return true;
  if (depth > 3) return false;
  if (b.base.startsWith('name:')) {
    const bs = bindingsOf(b.base.slice(5).replace(/#\d+$/, ''));
    return !bs.counter && bs.rhs.length > 0 && bs.rhs.every((span) => positionAt(span, names, depth + 1));
  }
  return !!b.span && positionAt(b.span, names, depth + 1);
}
function positionAt(span, names, depth) {
  const p = boundParts(span, 'start', names, depth);
  if (!p) return false;
  if (!p.base || /^(?:match|len):/.test(p.base)) return true;
  if (p.base.startsWith('name:')) return baseOk(p, -1, names, depth);
  const [a, b] = trimSpan(p.span);
  const open = curM[b - 1] === ')' ? openOf(b - 1) : -1;
  if (open < a || !SEARCH_TAIL.test(curM.slice(a, open + 1))) return false;
  const args = curM.slice(open + 1, b - 1);
  return ![...loopVars].some((v) => names.has(v) && new RegExp(`(?<![\\w$.])${v.replace(/\$/g, '\\$')}(?![\\w$])`).test(args));
}
// The span of a window read as a slice (`slice` / `substring` / `substr` at curM[open, close]) or a subscript, when
// both bounds share one fixed base; null otherwise.
function windowSpan(open, close, method, names) {
  const parts = splitTop(open + 1, close, method === 'subscript' ? ':' : ',');
  if (parts.length !== 2 && !(method === 'subscript' && parts.length === 3 && /^\s*(?:1\s*)?$/.test(srcText.slice(parts[2][0], parts[2][1])))) return null;
  const s = boundParts(parts[0], 'start', names);
  if (method === 'substr') {
    const len = boundOf(srcText.slice(parts[1][0], parts[1][1]));
    return len !== null && s && (!s.base || baseOk(s, open, names)) ? Math.max(0, len) : null;
  }
  const e = boundParts(parts[1], 'end', names);
  if (!s || !e || !s.base || s.base !== e.base || !baseOk(s, open, names)) return null;
  return Math.max(0, method === 'substring' ? Math.abs(e.off - s.off) : e.off - s.off);
}
// A subscript is a slice when it holds a top-level `:` and no ternary.
const sliceSubscript = (open, close) => splitTop(open + 1, close, ':').length > 1 && splitTop(open + 1, close, '?').length === 1;
// An index by a counter is EVERY element in turn, not one - unless a match test guards it.
const countersIn = (text) => (text.match(/[A-Za-z_$][\w$]*/g) || []).filter((w) => bindingsOf(w).counter);
const countedIndex = (open, close) => countersIn(curM.slice(open + 1, close)).length > 0;
// grep -o: a match returns the matched piece, not the text (`s.match(re)`, `s.matchAll(re)`, `re.exec(s)`,
// `re.findall(p, s)`, `s.scan(re)`) - unless its pattern is WRITTEN to span lines: an any-character class or a dot-all
// dot, repeated without a bound (`[\s\S]*`, `(?s).*`, `re.S`). Such a match is the text itself, and so is its element.
const MATCH_MEMBER = /^(?:match|matchAll|scan)$/;
const PY_MATCH_CALL = /^(?:re|regex)\.(?:findall|finditer|search|match|fullmatch)$/;
const MATCH_METHOD = /^(?:exec|findall|finditer|search|match|fullmatch|scan)$/;
const ANY_CLASS_REPEAT = /\[(?:\\s\\S|\\S\\s|\\w\\W|\\W\\w|\\d\\D|\\D\\d|\^)\](?:[*+]|\{\d+,\})/;
const DOT_REPEAT = /(?:^|[^\\])\.(?:[*+]|\{\d+,\})/;
const spansLines = (pat, dotAll) => ANY_CLASS_REPEAT.test(pat) || ((dotAll || /\(\?[a-z]*s[a-z]*\)/.test(pat)) && DOT_REPEAT.test(pat));
function patternOf(span, lang, depth = 0) {
  const [a, b] = trimSpan(span);
  const t = srcText.slice(a, b);
  let x;
  if (!t.includes('\n') && (x = /^\/([\s\S]+)\/([a-z]*)$/.exec(t))) return { pat: x[1], dotAll: /s/.test(x[2]) || (lang === 'ruby' && /m/.test(x[2])), flags: x[2] };
  if ((x = /^new\s+RegExp\s*\(\s*(["'`])([\s\S]*?)\1\s*(?:,\s*(["'`])([a-z]*)\3\s*)?\)$/.exec(t))) return { pat: x[2].replace(/\\\\/g, '\\'), dotAll: /s/.test(x[4] || ''), flags: x[4] || '' };
  if ((x = /^(?:re\s*\.\s*compile\s*\(\s*)?([rRbBuU]*)(["'])([\s\S]*?)\2/.exec(t))) return { pat: /r/i.test(x[1]) ? x[3] : x[3].replace(/\\\\/g, '\\'), dotAll: /\bre\s*\.\s*(?:S|DOTALL)\b/.test(t) };
  if (/^[A-Za-z_$][\w$]*$/.test(t) && depth < 3) {
    const bs = bindingsOf(t);
    if (bs.rhs.length === 1) return patternOf(bs.rhs[0], lang, depth + 1);
  }
  return null;
}
// A pattern that keeps every line whole or every character (`.*`, `.+`, `^.+$`, `[^\n]*`, `\S+`, `.`, `[\s\S]`): its matches
// taken ALL at once (`matchAll`, `findall`, `scan`, a `g` match, an exec loop) are the text itself, rejoined - no
// grep -o (review M4 of 2.1.6). A lazy star matches nothing, so it keeps nothing.
const KEEPS_ALL = /^\^?\(?(?:\?:)?(?:\.|\[\^[^\]]*\]|\[(?:\\s\\S|\\S\\s|\\w\\W|\\W\\w|\\d\\D|\\D\\d|\^)\]|\\S)(?:\*|\+\??|\{[01],\}\??)?\)?\$?$/;
const ALL_AT_ONCE = /^(?:matchAll|scan|findall|finditer|exec)$/;
const patternSpans = (span, lang, dotAll = false, method = '') => {
  const p = patternOf(span, lang);
  if (!p) return false;
  if (spansLines(p.pat, p.dotAll || dotAll)) return true;
  return KEEPS_ALL.test(p.pat) && (ALL_AT_ONCE.test(method) || (method === 'match' && /g/.test(p.flags || '')));
};
// The member chain after an occurrence - `.split("\n").length`, `[1]`, `?.x` - and whether it REDUCES: a reducer
// member anywhere in it (`h.length.toString()` is a number), a map / reduce whose callback returns no content, ONE
// element (`lines[k]`, `m[1]` - the `sed -n 'Np'` of a script, unless `bounded` is off: a map or a loop reaches every
// element, and so does an index by a counter), a match (grep -o), a filter by a match test (grep), a ranged slice or
// window, or the name itself CALLED (`fn(...)` built by `new Function(src)` returns its result, not the text).
// `chainLimit` stops the walk at a position: a loop's receiver is judged without the loop call itself.
let chainLimit = Infinity;
const FILTER_MEMBER = /^(?:filter|select|find_all)$/;
function chainState(m, k, names, lang, bounded = true, unit = 'chars', whole = false) {
  // `whole`: a match of a pattern written to span lines - its element is no bounded piece
  let reduced = false;
  let last = null;
  for (let first = true; ; first = false) {
    let j = k;
    if (j >= chainLimit) break;
    if (m[j] === '?' && m[j + 1] === '.') j++;
    if (m[j] === '.') {
      const id = /^\.\s*([A-Za-z_$][\w$]*)/.exec(m.slice(j, j + 80));
      if (!id) break;
      last = id[1];
      if (reducerOf(lang).test(last)) reduced = true;
      if (LINES_MEMBER.test(last)) { unit = 'lines'; whole = false; }
      else if (last === 'join') unit = 'chars';
      k = j + id[0].length;
      continue;
    }
    if (m[j] === '(' || m[j] === '[') {
      const e = matchClose(m, j);
      if (e < 0) break;
      const call = m[j] === '(';
      if (call && !reduced && last && MAPPER.test(last) && callbackReduces(m, j, e, names, lang, last)) reduced = true;
      if (call && first) reduced = true;
      if (call && last === 'split') { whole = false; if (LINE_SPLIT_ARG.test(srcText.slice(j + 1, e))) unit = 'lines'; }
      if (call && !reduced && last && MATCH_MEMBER.test(last)) { if (patternSpans(splitTop(j + 1, e, ',')[0], lang, false, last)) whole = true; else reduced = true; }
      if (call && !reduced && last && FILTER_MEMBER.test(last) && callbackMatches(m, j, e, lang)) reduced = true;
      if (call && bounded && !reduced && !whole && lang !== 'python' && /^(?:find|findLast|detect)$/.test(last || '')) reduced = true; // one element
      // a slice of EVERY element (a loop variable, a callback parameter) is not one range, like an index of every element
      if (call && bounded && !reduced && last && SLICE_MEMBER.test(last)
        && (withinCap(sliceSpan(srcText.slice(j + 1, e), last), unit) || withinCap(windowSpan(j, e, last, names), unit))) reduced = true;
      if (!call) {
        if (sliceSubscript(j, e)) {
          if (bounded && !reduced && (withinCap(subscriptSpan(srcText.slice(j + 1, e)), unit) || withinCap(windowSpan(j, e, 'subscript', names), unit))) reduced = true;
        } else if (bounded && !whole && !(countedIndex(j, e) && !guardedAt(j, countersIn(curM.slice(j + 1, e))))) reduced = true; // one element
      }
      k = e + 1;
      continue;
    }
    break;
  }
  return { end: k, reduced, whole };
}
// A map / reduce callback that returns no content: its element parameter (the second for a reduce) is content,
// and the returned expression - or every `return` of a block body - carries none of it un-reduced.
function callbackReduces(m, open, close, names, lang, method) {
  const args = m.slice(open + 1, close);
  const arrow = /^\s*(?:async\s+)?(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*/.exec(args);
  const fn = !arrow && /^\s*(?:async\s+)?function\b[^(]*\(([^()]*)\)\s*/.exec(args);
  if (!arrow && !fn) return false;
  const params = (arrow ? (arrow[1] !== undefined ? arrow[1] : arrow[2]) : fn[1]).split(',').map((x) => x.trim().replace(/\s*=[\s\S]*$/, '')).filter(Boolean);
  const inner = new Set(names);
  const elem = /^reduce/.test(method) ? params[1] : params[0];
  if (elem) inner.add(elem);
  const from = open + 1 + (arrow || fn)[0].length;
  if (m[from] !== '{') return !carriesContent(m, from, stmtEnd(m, from), inner, lang, false);
  const end = matchClose(m, from);
  if (end < 0) return false;
  for (const r of m.slice(from, end).matchAll(/\breturn\b/g)) {
    const at = from + r.index + r[0].length;
    if (carriesContent(m, at, stmtEnd(m, at), inner, lang, false)) return false;
  }
  return true;
}
// Back over the receiver of a read call - `require("fs").readFileSync` starts at `require`.
// Every step of the walk is remembered with the answer it led to, so a long chain (`s.a(s).a(s)...`) is walked once, not
// once per call in it (review M3 of 2.1.6).
function receiverStart(m, k) {
  const memo = m === curM && k <= m.length ? structure(m).recv : null;
  const seen = [];
  let j = k;
  for (;;) {
    if (memo && memo[j] >= 0) { j = memo[j]; break; }
    seen.push(j);
    if (j > 0 && m[j - 1] === '.') { j--; continue; }
    if (j > 0 && /[\w$]/.test(m[j - 1])) { while (j > 0 && /[\w$]/.test(m[j - 1])) j--; continue; }
    if (j > 0 && (m[j - 1] === ')' || m[j - 1] === ']')) {
      let depth = 0; let p = j - 1;
      for (; p >= 0; p--) { if (m[p] === ')' || m[p] === ']') depth++; else if (m[p] === '(' || m[p] === '[') { depth--; if (depth === 0) break; } }
      if (p < 0) break;
      j = p;
      continue;
    }
    break;
  }
  if (memo) for (const v of seen) memo[v] = j;
  return j;
}
// A scalar the occurrence feeds: a wrapper call (len, Number, Math.max, a test), a negation (`!s`, `not s` - a perl
// sigil may sit between), a comparison, `in`. A keyword test's operand is structure()'s `cond`.
const WRAPPED = /(?:\bnot\s+[@%]?|\b(?:len|Number|Boolean|bool|int|float|parseInt|parseFloat|isNaN|isinstance|any|all|sum|hash|Math\s*\.\s*\w+)\s*\(\s*(?:\.\.\.\s*)?|\.\s*(?:test|includes|has|count|indexOf|lastIndexOf|startsWith|endsWith|localeCompare)\s*\(\s*|!\s*|\btypeof\s+|(?:===?|!==?|<=?|(?<!=)>=?)\s*|\bin\s+|(?:^|[(,=:?&|!]\s*)[+-]\s*)$/;
// Calls whose result carries an argument's content: a serializer, a copy, a collection, an iterator over it, python's
// regex module where it returns the text (`re.sub`, `re.split`), and the receiver methods that insert their argument.
// A MATCH call (`re.exec(src)`, `re.findall(p, s)`) returns the matched pieces - grep -o - unless its pattern spans
// lines. Any other call - a helper, `eval`, `new Function` - returns its own result, not the text it was handed; a
// loop's iterable is the exception (`iterMode`): a helper there most often hands the elements on (`chain(lines)`).
const FLOW_BARE = /^(?:String|Set|Map|WeakMap|Array|structuredClone|repr|str|list|tuple|sorted|reversed|set|frozenset|dict|escape|unescape|encodeURIComponent|decodeURIComponent|enumerate|zip|iter|map|filter)$/;
// perl's and php's (judged with perl's rules) bare calls whose result is the argument's text, transformed (2.1.6)
const FLOW_BARE_PERL = /^(?:join|reverse|sort|map|split|uc|lc|ucfirst|lcfirst|sprintf|quotemeta|pack|unpack|encode|decode|encode_json|decode_json|Dumper|implode|explode|strtoupper|strtolower|ucwords|trim|rtrim|ltrim|chop|nl2br|htmlspecialchars|htmlentities|html_entity_decode|strip_tags|addslashes|stripslashes|str_replace|str_ireplace|preg_replace|preg_split|str_split|json_encode|serialize|base64_encode|bin2hex|urlencode|rawurlencode|strrev|wordwrap|chunk_split|array_map|array_reverse|array_filter|array_values|vsprintf|str_pad|iconv|mb_convert_encoding)$/;
const FLOW_DOTTED = /^(?:stringify|parse|inspect|format|from|of|values|entries|assign|fromEntries|dumps|loads|pformat|escape|unescape|dedent|indent|fill|wrap|shorten|replace|replaceAll|concat|join|with|toSorted|toReversed|toSpliced)$/;
const FLOW_REGEX_MODULE = /^(?:re|regex)\.(?:sub|subn|split)$/;
let iterMode = false;
const COMPREHENSION = /\bfor\s+[\w$,\s()]+?\s+in\s+$/;
const COMPARED = /^\s*(?:===?|!==?|<=?|>=?|\?(?![.?])|&&|\binstanceof\b|\bin\b)/;
// A `for` at the top level of m[from, to): the occurrence sits in a comprehension's for / in / if clause, which
// feeds only its loop variable - judged where the comprehension's expression uses it.
function topLevelFor(m, from, to) {
  // inside an open bracket's own span, a top-level `for` is one whose innermost bracket is that one
  if (m === curM && CLOSE[m[from - 1]]) { const st = structure(m); const e = st.close[from - 1]; if (e < 0 || to <= e) { const f = st.firstFor[from - 1]; return f >= 0 && f < to; } }
  let depth = 0;
  for (let k = from; k < to; k++) {
    const c = m[k];
    if (CLOSE[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === 'f' && /^for\b/.test(m.slice(k, k + 4)) && !/[\w$]/.test(m[k - 1] || '')) return true;
  }
  return false;
}
const READ_CALL = /\b(?:readFileSync|File\s*\.\s*read|open)\s*\(/g;
// The content occurrences in m[a, b): a read call (with its receiver) or a name bound to content.
// Scanned from `a` on, never from the script start: the names pass calls this once per assignment in the script
// (a 25KB, 1,500-assignment script judges in about 50ms, measured in the 2.1.6 review round).
let namesReKey = null; let namesRe = null; // the names set, and the script its positions were found in
// The reads of a small or ungated file (a literal path heavyRead says no to) - set per script by scriptPrintsContent.
let lightReads = new Set();
// Every match is found ONCE per script (or per names set) and looked up by position: an exec from `a` searched on to
// the script's end whenever [a, b) held none, once per assignment (review M3 of 2.1.6).
let readCallsOf = { m: null, at: [] };
let namePositions = [];
const firstAtOrAfter = (list, a) => { let lo = 0; let hi = list.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid][0] < a) lo = mid + 1; else hi = mid; } return lo; };
// A generator, in start order: its one caller stops at the first occurrence that carries the content, so a span holding
// every later name of a long chain is never listed whole.
function* occurrencesIn(m, a, b, names) {
  const out = [];
  if (readCallsOf.m !== m) readCallsOf = { m, at: [...m.matchAll(READ_CALL)].map((r) => [r.index, r[0].length]) };
  for (let i = firstAtOrAfter(readCallsOf.at, a); i < readCallsOf.at.length && readCallsOf.at[i][0] < b; i++) {
    const [at, len] = readCallsOf.at[i];
    if (lightReads.has(at)) continue;
    const open = at + len - 1;
    const close = matchClose(m, open);
    out.push({ start: Math.max(a, receiverStart(m, at)), end: close < 0 ? b : close + 1 });
  }
  if (names.size) {
    const key = [...names].join('|');
    if (key !== namesReKey || namesRe !== m) {
      namesReKey = key;
      namesRe = m;
      const re = new RegExp(`(?<![\\w$])(?<![^.]\\.)(?<!^\\.)(?:${[...names].map((x) => x.replace(/\$/g, '\\$')).join('|')})(?![\\w$])`, 'g');
      namePositions = [...m.matchAll(re)].map((x) => [x.index, x[0]]);
    }
  }
  out.sort((p, q) => p.start - q.start);
  // this generator's own copy: a nested call for another names set replaces the shared one while this one is paused
  const positions = names.size ? namePositions : [];
  let r = 0;
  if (names.size) {
    for (let i = firstAtOrAfter(positions, a); i < positions.length && positions[i][0] < b; i++) {
      const [at, name] = positions[i];
      if (guards.length && relievedAt(at, name)) continue; // one matching element, under its match test
      while (r < out.length && out[r].start <= at) yield out[r++];
      yield { start: at, end: at + name.length, name };
    }
  }
  while (r < out.length) yield out[r++];
}
// Is this occurrence REDUCED before it reaches the output? Its own chain first, then what it is wrapped in or
// compared with, then the bracket around it - a comprehension clause, a key, a template, a group or a call, whose
// own chain is judged in turn (`new Set(s).size`, `Object.keys(JSON.parse(h)).length`, `(m||[]).length`).
function reducedOcc(m, occ, a, names, lang, bounded = true) {
  let { start, end } = occ;
  // a loop variable or a callback parameter is EVERY element in turn, so its index is not one element
  const oneElement = bounded && !(occ.name && loopVars.has(occ.name));
  // WHOLE: the value is a collection whose element is the text itself - a match of a pattern that spans lines, or
  // the content put into a new array (`[h]`, `out.push(h)`) - so one element of it is no bounded piece
  let whole = !!(occ.name && wholeNames.has(occ.name));
  for (let climb = 0; climb < 8; climb++) {
    const chain = chainState(m, end, names, lang, oneElement, climb === 0 && occ.name && linesNames.has(occ.name) ? 'lines' : 'chars', whole);
    judgeTick(1 + chain.end - start);
    if (chain.reduced) return { reduced: true, end: chain.end };
    if (chain.whole) whole = true;
    const before = m.slice(Math.max(a, start - 60), start);
    if (WRAPPED.test(before) && !COMPREHENSION.test(before)) return { reduced: true, end: chain.end };
    if (lang !== 'js' && m === curM && structure(m).cond[start]) return { reduced: true, end: chain.end };
    if (COMPARED.test(m.slice(chain.end, chain.end + 20))) return { reduced: true, end: chain.end };
    let p = start - 1;
    if (m === curM) p = Math.max(structure(m).encl[start], a - 1);
    else for (let depth = 0; p >= a; p--) { if (m[p] === ')' || m[p] === ']' || m[p] === '}') depth++; else if (m[p] === '(' || m[p] === '[' || m[p] === '{') { if (depth === 0) break; depth--; } }
    if (p < a) return { reduced: false, end: chain.end, whole };
    const close = matchClose(m, p);
    if (close < 0) return { reduced: false, end: chain.end, whole };
    if (topLevelFor(m, p + 1, start)) return { reduced: true, end: chain.end };
    let q = p - 1; while (q >= a && /\s/.test(m[q])) q--;
    const prev = q >= a ? m[q] : '';
    // a KEY: `counts[h]` reads an entry, it prints no content of h
    if (m[p] === '[' && /[\w$)\]]/.test(prev)) return { reduced: true, end: chain.end };
    if (m[p] === '{' && m[p - 1] === '$') {
      // a template interpolation prints the value: the template literal is the occurrence now
      const tick = m.lastIndexOf('`', p);
      const tickEnd = m.indexOf('`', close);
      if (tick < a || tickEnd < 0) return { reduced: false, end: chain.end, whole };
      start = tick;
      end = tickEnd + 1;
      continue;
    }
    if (m[p] === '(' && /[\w$)\]]/.test(prev)) {
      start = receiverStart(m, p);
      // a callee past 512 characters is a chain or a bracket group, never `re.search`: only its tail is read for the name
      const long = p - start > 512;
      const callee = m.slice(long ? p - 512 : start, p).replace(/\s+/g, '');
      const name = (callee.match(/([A-Za-z_$][\w$]*)$/) || ['', ''])[1];
      const dotted = long ? (m === curM ? structure(m).nextDot[start] < p : m.slice(start, p).includes('.')) : /\./.test(callee);
      const pyMatch = !long && PY_MATCH_CALL.test(callee);
      if (pyMatch || (dotted && MATCH_METHOD.test(name))) {
        // grep -o: the pattern is re's first argument, else the receiver (`re.exec(src)`, `pat.findall(s)`)
        const patSpan = pyMatch ? splitTop(p + 1, close, ',')[0] : [start, m.lastIndexOf('.', p)];
        if (!patternSpans(patSpan, lang, /\bre\s*\.\s*(?:S|DOTALL)\b/.test(srcText.slice(p + 1, close)), pyMatch ? callee.replace(/^\w+\./, '') : name)) return { reduced: true, end: chain.end };
        whole = true;
      } else if (!iterMode && !(!long && FLOW_REGEX_MODULE.test(callee)) && !(dotted ? FLOW_DOTTED : lang === 'perl' ? FLOW_BARE_PERL : FLOW_BARE).test(name)) return { reduced: true, end: chain.end };
    } else {
      start = p;
      // an array or a tuple literal: its element is the content itself
      const tuple = m[p] === '(' && (m === curM ? structure(m).firstComma[p] >= 0 && structure(m).firstComma[p] < close : splitTop(p + 1, close, ',').length > 1);
      if ((m[p] === '[' || tuple) && !topLevelFor(m, p + 1, close)) whole = true;
    }
    end = close + 1;
  }
  return { reduced: false, end, whole };
}
// Does m[a, b) carry the content un-reduced?
function carriesContent(m, a, b, names, lang, bounded = true) {
  judgeTick(1 + b - a);
  let k = a;
  for (const occ of occurrencesIn(m, a, b, names)) {
    if (occ.start < k) continue; // inside a chain already judged: `s.map(x => x).length`
    const r = reducedOcc(m, occ, a, names, lang, bounded);
    if (!r.reduced) { carryWhole = !!r.whole; return true; }
    k = Math.max(r.end, occ.end);
  }
  return false;
}
// Does a loop's iterable - m[a, b), or a callback's receiver ending at `limit` - hand the loop the content?
function iterCarries(m, a, b, names, lang, limit = Infinity) {
  iterMode = true;
  chainLimit = limit;
  try { return carriesContent(m, a, b, names, lang); } finally { iterMode = false; chainLimit = Infinity; }
}
// The end of a loop's iterable: the for's own closing paren (JS), else a python header's `:`, its line end, or a
// comprehension's next clause (`if` / `for`) or closing bracket - whichever comes first at the top level.
function iterEnd(m, from) {
  for (let k = from, d = 0; k < m.length; k++) {
    const c = m[k];
    if (CLOSE[c]) d++;
    else if (c === ')' || c === ']' || c === '}') { if (d === 0) return k; d--; }
    else if (d === 0 && (c === ':' || c === '\n' || (/^(?:if|for)\b/.test(m.slice(k, k + 4)) && !/[\w$.]/.test(m[k - 1] || '')))) return k;
  }
  return m.length;
}
// The names that hold the content: assigned from it, destructured from it, looped or called back over it, and a
// collection it is put into - pushed (`out.push(c)`, `out << c`) or used as a key or a value (`seen[c] = 1`).
// The loop variables and callback parameters among them - every element in turn (reducedOcc's `oneElement`).
let loopVars = new Set();
let wholeNames = new Set();
let carryWhole = false;
const FUNCTION_EXPR = /^\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|lambda\b)/;
function contentNames(m, lang) {
  const names = new Set();
  loopVars = new Set();
  wholeNames = new Set();
  linesNames = new Set();
  for (let pass = 0; pass < 6; pass++) {
    judgeTick(1 + m.length);
    const size = names.size;
    // A chained assignment (`a = b = rhs`) binds every link to the one rhs, so the links wait for it and it is judged
    // once: judging each link's own rest re-read the whole chain per link (review M3 of 2.1.6).
    let chain = []; let chainAt = -1;
    for (const x of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\+|\|\||\?\?)?=(?![=>])/g)) {
      if (chain.length && x.index !== chainAt) chain = [];
      const from = x.index + x[0].length;
      // pushed, never copied: a copy per link cost the chain's square (1.3s at 20,000 links)
      chain.push(x[1]);
      const bound = chain; chain = [];
      if (FUNCTION_EXPR.test(m.slice(from, from + 60))) continue; // a function built from content is code, not text
      const link = /^\s*(?=[A-Za-z_$][\w$]*\s*=(?![=>]))/.exec(m.slice(from, from + 256));
      if (link && x[0].endsWith('=') && !/[+|?]=$/.test(x[0])) { chain = bound; chainAt = from + link[0].length; continue; }
      // perl and ruby call without parens, so an assignment's comma is an argument list (`my $s = join "", <F>`)
      const end = stmtEnd(m, from, lang === 'perl' || lang === 'ruby');
      if (/\.\s*(?:split\s*\(\s*(?:(['"`])(?:\\r)?\\n\1|\/(?:\\r\??)?\\n\/[a-z]*)\s*\)|splitlines\s*\(\s*\)|readlines\s*\(\s*\)|lines\b(?:\s*\(\s*\))?)\s*$/.test(srcText.slice(from, end))) for (const w of bound) linesNames.add(w);
      if (carriesContent(m, from, end, names, lang)) for (const w of bound) { names.add(w); if (carryWhole) wholeNames.add(w); }
    }
    for (const x of m.matchAll(/\b(?:const|let|var)\s*[[{]([^\]}=]*)[\]}]\s*=(?![=>])/g)) {
      const from = x.index + x[0].length;
      if (carriesContent(m, from, stmtEnd(m, from), names, lang)) for (const w of x[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(w);
    }
    // no two whitespace runs side by side: `\s*\(?\s*` split a run of spaces every way before failing (review M3 of 2.1.6)
    for (const x of m.matchAll(/\bfor\s*(?:\(\s*)?(?:(?:const|let|var)\s*)?(?:\[\s*)?([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)(?:\s*\])?\s+(?:of|in)\s+/g)) {
      const from = x.index + x[0].length;
      // the iterable: up to the for's own closing paren, or a python clause's end - judged like any expression, so a
      // match iterator (`re.finditer(p, h)`, `src.matchAll(re)`) hands on matches, not the content
      const to = iterEnd(m, from);
      const iterable = m.slice(from, to);
      // `for i, l in enumerate(X)` / `for (const [i, l] of X.entries())`: the first is a COUNTER, not content
      const counted = /^\s*enumerate\s*\(/.test(iterable) || /\.\s*entries\s*\(\s*\)\s*$/.test(iterable);
      if (iterCarries(m, from, to, names, lang)) for (const w of x[1].split(/\s*,\s*/).slice(counted ? 1 : 0)) { names.add(w); loopVars.add(w); }
    }
    for (const x of m.matchAll(/\.\s*(forEach|map|flatMap|filter|find|findLast|some|every|reduce|reduceRight|sort|each|each_line|each_with_index|select)\s*(?:\(\s*(?:async\s+)?(?:function\b[^(]*\(([^()]*)\)|\(([^()]*)\)|([A-Za-z_$][\w$]*)\s*=>)|(?:do\s*|\{\s*)\|([^|]*)\|)/g)) {
      if (!iterCarries(m, receiverStart(m, x.index), x.index, names, lang, x.index)) continue;
      const params = (x[2] || x[3] || x[4] || x[5] || '').split(',').map((w) => w.trim().replace(/\s*=[\s\S]*$/, '')).filter((w) => /^[A-Za-z_$][\w$]*$/.test(w));
      const taken = /^sort$/.test(x[1]) ? params : /^reduce/.test(x[1]) ? params.slice(1, 2) : params.slice(0, 1);
      for (const w of taken) { names.add(w); loopVars.add(w); }
    }
    for (const x of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*(?:push|unshift|append|appendleft|extend|add|insert|set|update|put|concat|splice)\s*\(/g)) {
      const open = x.index + x[0].length - 1;
      const close = matchClose(m, open);
      if (close > open && carriesContent(m, open + 1, close, names, lang)) { names.add(x[1]); wholeNames.add(x[1]); }
    }
    for (const x of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*<<\s*/g)) {
      // `out << a << b` appends both to `out`: only the chain's receiver takes the content, so an operand is skipped - and
      // a long chain is judged once, not once per link (review M3 of 2.1.6)
      if (/<<\s*$/.test(m.slice(Math.max(0, x.index - 8), x.index))) continue;
      const from = x.index + x[0].length;
      if (carriesContent(m, from, stmtEnd(m, from), names, lang)) { names.add(x[1]); wholeNames.add(x[1]); }
    }
    for (const x of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\[/g)) {
      const open = x.index + x[0].length - 1;
      const close = matchClose(m, open);
      const op = close > open && /^\s*(?:\+|\|\||\?\?)?=(?![=>])/.exec(m.slice(close + 1, close + 8));
      if (!op) continue;
      const from = close + 1 + op[0].length;
      if (carriesContent(m, open + 1, close, names, lang)) names.add(x[1]);
      else if (carriesContent(m, from, stmtEnd(m, from), names, lang)) { names.add(x[1]); wholeNames.add(x[1]); }
    }
    if (names.size === size) break;
  }
  return names;
}
// ---- a print GUARDED by a match (2.1.6) -----------------------------------------------------------
// A loop that prints an element only where it matched is grep, and a window around it grep -C; the shell half blocks
// neither. A GUARD is a region of the script plus the per-element names a match test there holds true of: the body of
// `if 'x' in l:` / `if (l.includes("x"))`, the right side of `l.startsWith("x") && print(l)`, a ruby `puts l if l =~ /x/`,
// a comprehension's expression under its `if`, and the rest of a loop body after `if <negated test>: continue`. Inside
// one those names are RELIEVED - each is one matching element, grep's own output - and a window may take any base
// there (`lines[i-5:i+5]` around the matching line) unless its counter is stepped inside the guard. A test that holds
// of every element is none: a truthiness test (`if l:`), a test of another name, an empty needle or a pattern that
// matches the empty string, a negation, an `else`, a `||` short-circuit.
let guards = [];
let rawGuards = [];
let matchNames = new Map(); // a name bound once to a test of per-element names (`m = re.search(p, l)`): its subjects
let counterHeads = new Map(); // a counting loop's header position, per counter
let curLang = 'js';
const union = (sets) => new Set(sets.flatMap((s) => [...s]));
const intersect = (sets) => new Set([...sets[0]].filter((x) => sets.every((s) => s.has(x))));
const EMPTY_LIT = /^\s*[rRbBuU]*(['"`])\1\s*$/;
const NO_TEST = () => ({ pos: new Set(), neg: new Set() });
// A pattern that matches the empty string matches every line: `^`, `.*`, `\s?`, an empty alternative.
function matchesEmpty(pat) {
  const p = pat.replace(/^\(\?[a-zA-Z]+\)/, '').replace(/^\^|\$$/g, '').replace(/\\[bBAzZ]/g, '');
  if (!p || /^\||\|$|[^\\]\|\|/.test(p)) return true;
  return /^(?:\.|\\[sSwWdD]|\[[^\]]*\]|[^\\()[\]|*+?{}.^$]|\((?:\?:)?[^()]*\))(?:[*?]|\{0(?:,\d*)?\})$/.test(p);
}
const emptyPattern = (span) => { const p = span && patternOf(span, curLang); return !!p && matchesEmpty(p.pat); };
// The top-level pieces of curM[a, b) split at `op` - 'or' (`||`, `or`) or 'and' (`&&`, `and`).
function splitTopOp(a, b, op) {
  const sym = op === 'or' ? '||' : '&&';
  const out = [];
  let from = a;
  for (let k = a, d = 0; k < b; k++) {
    const c = curM[k];
    if (CLOSE[c]) d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && curM.startsWith(sym, k)) { out.push([from, k]); from = k + 2; k++; }
    else if (d === 0 && curM.startsWith(op, k) && !/[\w$.]/.test(curM[k - 1] || '') && !/[\w$]/.test(curM[k + op.length] || '')) { out.push([from, k]); from = k + op.length; k += op.length - 1; }
  }
  out.push([from, b]);
  return out;
}
// A condition's per-element subjects: `pos` - the names it being TRUE says matched; `neg` - the names it being FALSE says
// matched (`'x' not in l`, `!re.test(l)`). An OR holds of a name only when every branch does, an AND when one does.
// A guard only RELIEVES a name, so one that is not read is the stricter reading: a condition past GUARD_REACH characters,
// or a trailing `if` / `&&` whose statement starts further back, is none (review M3 of 2.1.6 - `if s:if s:...` read the
// rest of the line once per `if`).
const GUARD_REACH = 1000;
function cls(span, depth = 0) {
  if (span[1] - span[0] > GUARD_REACH) return NO_TEST();
  const [a, b] = trimSpan(span);
  if (a >= b || depth > 8) return NO_TEST();
  if (curM[a] === '(' && matchClose(curM, a) === b - 1) return cls([a + 1, b - 1], depth + 1);
  const ors = splitTopOp(a, b, 'or');
  if (ors.length > 1) { const cs = ors.map((s) => cls(s, depth + 1)); return { pos: intersect(cs.map((c) => c.pos)), neg: union(cs.map((c) => c.neg)) }; }
  const ands = splitTopOp(a, b, 'and');
  if (ands.length > 1) { const cs = ands.map((s) => cls(s, depth + 1)); return { pos: union(cs.map((c) => c.pos)), neg: intersect(cs.map((c) => c.neg)) }; }
  const not = /^(?:!(?!=)|not\b)\s*/.exec(curM.slice(a, b));
  if (not) { const c = cls([a + not[0].length, b], depth + 1); return { pos: c.neg, neg: c.pos }; }
  return atomTest(a, b);
}
// The first top-level comparison in curM[a, b): its operator and sides.
function topCompare(a, b) {
  for (let k = a, d = 0; k < b; k++) {
    const c = curM[k];
    if (CLOSE[c]) d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0) {
      const s3 = curM.slice(k, k + 3);
      let op = null;
      if (s3 === '===' || s3 === '!==') op = s3;
      else if (/^(?:==|!=|>=|<=)/.test(s3)) op = s3.slice(0, 2);
      else if ((c === '>' || c === '<') && !/[=<>-]/.test(curM[k - 1] || '') && !/[=<>]/.test(curM[k + 1] || '')) op = c;
      else if (/^is\b/.test(s3) && /\s/.test(curM[k - 1] || '')) op = (/^is\s+not\b/.exec(curM.slice(k, k + 12)) || ['is'])[0];
      if (op) return { op: op.replace(/\s+/g, ' '), left: [a, k], right: [k + op.length, b] };
    }
  }
  return null;
}
const SUBSTR_TEST = /^(?:includes|include|startsWith|endsWith|startswith|endswith|contains)$/;
// python `x in S` / `x not in S`: [whole, x, 'not ' or undefined, S] - what `/^([\s\S]+?)\s+(not\s+)?in\s+(ID)$/` matched,
// read back from the end in one pass (the lazy prefix beside `\s+` split a run of spaces every way; review M3 of 2.1.6).
function inTest(t) {
  const ws = (c) => /\s/.test(c || '');
  let i = t.length;
  while (i > 0 && /[\w$]/.test(t[i - 1])) i--;
  if (i === t.length || !/[A-Za-z_$]/.test(t[i])) return null;
  let j = i;
  while (j > 0 && ws(t[j - 1])) j--;
  if (j === i || t.slice(j - 2, j) !== 'in') return null;
  let w = j - 2;
  while (w > 0 && ws(t[w - 1])) w--;
  if (w === j - 2) return null;
  // where the prefix ends: at the space run's start, or one character in when the run starts the text
  const cut = (r, end) => (r > 0 ? r : end - r >= 2 ? 1 : -1);
  if (w >= 3 && t.slice(w - 3, w) === 'not') {
    let u = w - 3;
    while (u > 0 && ws(t[u - 1])) u--;
    const c = u < w - 3 ? cut(u, w - 3) : -1;
    if (c > 0) return [t, t.slice(0, c), t.slice(w - 3, j - 2), t.slice(i)];
  }
  const c = cut(w, j - 2);
  return c > 0 ? [t, t.slice(0, c), undefined, t.slice(i)] : null;
}
function atomTest(a, b) {
  const t = curM.slice(a, b);
  const ID = /^[A-Za-z_$][\w$]*$/;
  const one = (name, positive) => (positive ? { pos: new Set([name]), neg: new Set() } : { pos: new Set(), neg: new Set([name]) });
  let x;
  // python `x in S` / `x not in S`
  if ((x = inTest(t))) return EMPTY_LIT.test(srcText.slice(a, a + x[1].length)) ? NO_TEST() : one(x[3], !x[2]);
  // ruby / perl `S =~ re`, `S !~ re`
  if ((x = /^([A-Za-z_$][\w$]*)\s*([=!])~/.exec(t)) || (x = /([=!])~\s*([A-Za-z_$][\w$]*)$/.exec(t))) return x.length === 3 && ID.test(x[1]) ? one(x[1], x[2] === '=') : one(x[2], x[1] === '=');
  const cmp = topCompare(a, b);
  if (cmp) {
    const L = trimSpan(cmp.left); const R = curM.slice(cmp.right[0], cmp.right[1]).replace(/\s+/g, '');
    const left = curM.slice(L[0], L[1]);
    // `S.indexOf(x) >= 0` / `!== -1` is a test of S, `=== -1` / `< 0` its negation
    const idx = /^([A-Za-z_$][\w$]*)\s*\.\s*(?:indexOf|search|find)\s*\(/.exec(left);
    if (idx && curM[L[1] - 1] === ')' && openOf(L[1] - 1) === L[0] + idx[0].length - 1) {
      const arg = trimSpan([L[0] + idx[0].length, L[1] - 1]);
      if (EMPTY_LIT.test(srcText.slice(arg[0], arg[1]))) return NO_TEST();
      if ((/^(?:>=|!==?)$/.test(cmp.op) && R === (cmp.op === '>=' ? '0' : '-1')) || (cmp.op === '>' && R === '-1')) return one(idx[1], true);
      if ((/^(?:===?)$/.test(cmp.op) && R === '-1') || (cmp.op === '<' && R === '0')) return one(idx[1], false);
      return NO_TEST();
    }
    // a match name against none: `m is not None`, `m !== null`
    if (ID.test(left) && matchNames.has(left) && /^(?:None|null|undefined|nil)$/.test(R)) {
      const set = matchNames.get(left);
      return /^(?:is not|!==?)$/.test(cmp.op) ? { pos: new Set(set), neg: new Set() } : /^(?:is|===?)$/.test(cmp.op) ? { pos: new Set(), neg: new Set(set) } : NO_TEST();
    }
    return NO_TEST();
  }
  // a test call: `S.includes(x)`, `re.test(S)`, `re.search(p, S)`, `pat.match(S)`, `S.match(re)`, `S.include?(x)`
  if (curM[b - 1] === ')') {
    const open = openOf(b - 1);
    const h = open > a && /^([A-Za-z_$][\w$]*|\/[^/\n]*\/[a-z]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:\?\s*)?$/.exec(curM.slice(a, open));
    if (h) {
      const args = splitTop(open + 1, b - 1, ',').map(trimSpan).filter(([p, q]) => q > p);
      const idArg = (s) => (s && ID.test(curM.slice(s[0], s[1])) ? curM.slice(s[0], s[1]) : null);
      const recv = [a, a + h[1].length];
      const pos = new Set();
      if (SUBSTR_TEST.test(h[2])) { if (args[0] && !EMPTY_LIT.test(srcText.slice(args[0][0], args[0][1])) && ID.test(h[1])) pos.add(h[1]); }
      else if (/^(?:test|exec)$/.test(h[2])) { if (idArg(args[0]) && !emptyPattern(recv)) pos.add(idArg(args[0])); }
      else if (/^(?:match|search|fullmatch)$/.test(h[2])) {
        if (/^(?:re|regex)$/.test(h[1])) { if (idArg(args[1]) && !emptyPattern(args[0])) pos.add(idArg(args[1])); }
        else {
          // python's compiled `pat.match(S)` / `pat.search(S)`; JavaScript's and ruby's `S.match(re)` (a JS `search` is an index)
          if (curLang === 'python' && idArg(args[0]) && !emptyPattern(recv)) pos.add(idArg(args[0]));
          if (h[2] === 'match' && curLang !== 'python' && ID.test(h[1]) && !emptyPattern(args[0])) pos.add(h[1]);
        }
      }
      return { pos, neg: new Set() };
    }
  }
  // a match name, truthy: `if m:` after `m = re.search(p, l)`
  if (ID.test(t) && matchNames.has(t)) return { pos: new Set(matchNames.get(t)), neg: new Set() };
  return NO_TEST();
}
// Is a counter stepped inside curM[from, to)? Then a window on it there walks, guard or not.
function steppedIn(name, from, to) {
  const esc = name.replace(/\$/g, '\\$');
  if (new RegExp(`(?<![\\w$.])${esc}\\s*(?:\\*\\*|[-+*/%])=(?!=)|(?:\\+\\+|--)\\s*${esc}(?![\\w$])|(?<![\\w$.])${esc}\\s*(?:\\+\\+|--)`).test(curM.slice(from, to))) return true;
  return (counterHeads.get(name) || []).some((p) => p >= from && p < to);
}
const guardedAt = (pos, counters = []) => guards.some((g) => pos >= g.from && pos < g.to && counters.every((c) => !steppedIn(c, g.from, g.to)));
const relievedAt = (pos, name) => guards.some((g) => pos >= g.from && pos < g.to && g.subjects.has(name));
// A filter callback that keeps only matches (`l => l.includes("x")`): the filter is grep.
function callbackMatches(m, open, close) {
  const args = m.slice(open + 1, close);
  const arrow = /^\s*(?:async\s+)?(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*/.exec(args);
  const fn = !arrow && /^\s*(?:async\s+)?function\b[^(]*\(([^()]*)\)\s*/.exec(args);
  if (!arrow && !fn) return false;
  const elem = ((arrow ? (arrow[1] !== undefined ? arrow[1] : arrow[2]) : fn[1]).split(',')[0] || '').trim().replace(/\s*=[\s\S]*$/, '');
  if (!/^[A-Za-z_$][\w$]*$/.test(elem)) return false;
  const from = open + 1 + (arrow || fn)[0].length;
  if (m[from] !== '{') return cls([from, stmtEnd(m, from)]).pos.has(elem);
  const end = matchClose(m, from);
  const rets = end < 0 ? [] : [...m.slice(from, end).matchAll(/\breturn\b/g)];
  return rets.length > 0 && rets.every((r) => { const at = from + r.index + r[0].length; return cls([at, stmtEnd(m, at)]).pos.has(elem); });
}
// Where an operand starting at `from` ends: a top-level `;`, `,`, newline, `:`, a ternary `?`, `||` / `??`, or a closer -
// read at most GUARD_REACH characters on, since the guard it bounds only relieves.
function operandEnd(m, from) {
  for (let k = from, d = 0; k < m.length; k++) {
    if (k - from > GUARD_REACH) return k;
    const c = m[k];
    if (CLOSE[c]) d++;
    else if (c === ')' || c === ']' || c === '}') { if (d === 0) return k; d--; }
    else if (d === 0 && (/[;,\n:]/.test(c) || (c === '?' && m[k + 1] !== '.') || (c === '|' && m[k + 1] === '|'))) return k;
  }
  return m.length;
}
// The innermost loop or function body [from, to) holding `pos`.
const innermost = (bodies, pos) => bodies.filter(([f, t]) => pos >= f && pos < t).sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]))[0];
// `cond && <print>` (JavaScript, ruby): the right side runs only where the left held.
function andGuards(m) {
  const startOf = new Map(); // an earlier `&&` reached at the top level: its own walk's answer is this one's too
  for (const x of m.matchAll(/&&/g)) {
    const k = x.index;
    let s = k - 1;
    for (let d = 0; s >= 0; s--) {
      const c = m[s];
      if (d === 0 && c === '&' && startOf.has(s - 1)) { s = startOf.get(s - 1); break; }
      if (c === ')' || c === ']' || c === '}') d++;
      else if (CLOSE[c]) { if (d === 0) break; d--; }
      else if (d === 0 && (/[;,\n:]/.test(c) || (c === '?' && m[s + 1] !== '.') || (c === '|' && m[s - 1] === '|')
        || (c === '>' && m[s - 1] === '=') || (c === '=' && !/[=!<>]/.test(m[s - 1] || '') && m[s + 1] !== '='))) break;
      if (k - s > GUARD_REACH) break;
    }
    startOf.set(k, s);
    if (k - s > GUARD_REACH) continue;
    const ret = /^\s*return\b/.exec(m.slice(s + 1, k));
    rawGuards.push({ from: k + 2, to: operandEnd(m, k + 2), pos: cls([s + 1 + (ret ? ret[0].length : 0), k]).pos });
  }
}
function jsStructure(m) {
  const bodies = [];
  const heads = [];
  const bodyAfter = (k) => {
    while (k < m.length && /\s/.test(m[k])) k++;
    if (m[k] !== '{') return [k, stmtEnd(m, k)];
    const e = matchClose(m, k);
    return e < 0 ? null : [k, e + 1];
  };
  for (const x of m.matchAll(/(?<![\w$.])(if|for|while)\s*\(/g)) {
    const open = x.index + x[0].length - 1;
    const close = matchClose(m, open);
    const body = close > open && bodyAfter(close + 1);
    if (!body) continue;
    if (x[1] === 'if') heads.push({ at: x.index, cond: [open + 1, close], body });
    else bodies.push(body);
  }
  for (const x of m.matchAll(/=>\s*\{|\bfunction\b[^(]*\([^()]*\)\s*\{/g)) {
    const o = x.index + x[0].length - 1;
    const e = matchClose(m, o);
    if (e > o) bodies.push([o, e + 1]);
  }
  for (const h of heads) {
    rawGuards.push({ from: h.body[0], to: h.body[1], pos: cls(h.cond).pos });
    // `if (!test) continue;` - the rest of the loop (or function) body runs only where the test held
    if (/^\{?\s*(?:continue|break|return)\b[^{};]*;?\s*\}?$/.test(m.slice(h.body[0], h.body[1]).trim())) {
      const enc = innermost(bodies, h.at);
      if (enc) rawGuards.push({ from: h.body[1], to: enc[1], pos: cls(h.cond).neg });
    }
  }
  andGuards(m);
}
function pyStructure(m) {
  const lines = [];
  for (let s = 0; ;) {
    const e = m.indexOf('\n', s);
    const end = e < 0 ? m.length : e;
    const text = m.slice(s, end);
    const indent = text.match(/^[ \t]*/)[0].length;
    const rest = text.slice(indent);
    lines.push({ start: s, end, indent, blank: !rest.trim() || rest.startsWith('#') });
    if (e < 0) break;
    s = e + 1;
  }
  const lineOf = (pos) => { let lo = 0; let hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid].start <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const bodies = [];
  const heads = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const hx = /^[ \t]*(if|elif|while|for)\b/.exec(m.slice(L.start, L.end));
    if (!hx) continue;
    const kwEnd = L.start + hx[0].length;
    let colon = -1;
    for (let k = kwEnd, d = 0; k < m.length; k++) {
      const c = m[k];
      if (CLOSE[c]) d++;
      else if (c === ')' || c === ']' || c === '}') d--;
      else if (d === 0 && c === ':') { colon = k; break; } else if (d === 0 && c === '\n') break;
    }
    if (colon < 0) continue;
    const hl = lineOf(colon);
    const inline = m.slice(colon + 1, lines[hl].end).trim();
    let body = null;
    if (inline && !inline.startsWith('#')) body = [colon + 1, lines[hl].end];
    else {
      let last = -1;
      for (let j = hl + 1; j < lines.length; j++) { if (lines[j].blank) continue; if (lines[j].indent <= L.indent) break; last = j; }
      if (last >= 0) body = [lines[hl].end, lines[last].end];
    }
    if (!body) continue;
    if (hx[1] === 'for' || hx[1] === 'while') bodies.push(body);
    else heads.push({ at: L.start, cond: [kwEnd, colon], body, inline: !!(inline && !inline.startsWith('#')) });
  }
  for (const h of heads) {
    rawGuards.push({ from: h.body[0], to: h.body[1], pos: cls(h.cond).pos });
    // `if <negated test>: continue` - the rest of the loop body runs only where the test held
    const stmts = m.slice(h.body[0], h.body[1]).split(h.inline ? ';' : '\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    if (stmts.length && /^(?:continue|break)$/.test(stmts[stmts.length - 1])) {
      const enc = innermost(bodies, h.at);
      if (enc) rawGuards.push({ from: h.body[1], to: enc[1], pos: cls(h.cond).neg });
    }
  }
  // a comprehension's expression runs only where its `if` clauses held: `[(i, l) for i, l in enumerate(ls) if 'x' in l]`
  for (const x of m.matchAll(/(?<![\w$.])for\b/g)) {
    const o = openOf(x.index);
    const close = o < 0 ? -1 : matchClose(m, o);
    if (close < 0) continue;
    const conds = [];
    let cur = -1;
    for (let k = x.index + 3, d = 0; k < close; k++) {
      const c = m[k];
      if (CLOSE[c]) d++;
      else if (c === ')' || c === ']' || c === '}') d--;
      else if (d === 0 && /^(?:if|for)\b/.test(m.slice(k, k + 4)) && !/[\w$.]/.test(m[k - 1])) {
        if (cur >= 0) conds.push([cur, k]);
        cur = m.startsWith('if', k) ? k + 2 : -1;
      }
    }
    if (cur >= 0) conds.push([cur, close]);
    if (conds.length) rawGuards.push({ from: o + 1, to: x.index, pos: union(conds.map((s) => cls(s).pos)) });
  }
}
// ruby's trailing `<stmt> if <cond>` / `<stmt> unless <cond>`; a block `if ... end` is not read.
function rubyStructure(m) {
  for (const x of m.matchAll(/(?<![\w$.])(if|unless)\b/g)) {
    const k = x.index;
    let s = k - 1;
    for (let d = 0; s >= 0; s--) {
      const c = m[s];
      if (c === ')' || c === ']' || c === '}') d++;
      else if (CLOSE[c]) { if (d === 0) break; d--; }
      else if (d === 0 && (c === ';' || c === '\n')) break;
      if (k - s > GUARD_REACH) break;
    }
    if (k - s > GUARD_REACH) continue;
    const lead = /^\s*(?:do\b\s*)?(?:\|[^|]*\|\s*)?/.exec(m.slice(s + 1, k));
    const from = s + 1 + lead[0].length;
    if (!m.slice(from, k).trim()) continue;
    const c = cls([k + x[0].length, stmtEnd(m, k + x[0].length)]);
    rawGuards.push({ from, to: k, pos: x[1] === 'if' ? c.pos : c.neg });
  }
  andGuards(m);
}
// The counters, the match names and the raw guards of a script - before its content names are known.
function scanStructure(m, lang) {
  curLang = lang;
  guards = [];
  rawGuards = [];
  matchNames = new Map();
  counterVars = new Set();
  counterHeads = new Map();
  const head = (name, at) => { counterVars.add(name); counterHeads.set(name, [...(counterHeads.get(name) || []), at]); };
  const ID = '[A-Za-z_$][\\w$]*';
  for (const x of m.matchAll(new RegExp(`(?<![\\w$.])for\\s+(${ID})\\s+in\\s+range\\s*\\(`, 'g'))) head(x[1], x.index);
  for (const x of m.matchAll(new RegExp(`(?<![\\w$.])for\\s+(?:\\(\\s*)?(${ID})\\s*,[^\\n:]*?\\bin\\s+enumerate\\s*\\(`, 'g'))) head(x[1], x.index);
  for (const x of m.matchAll(new RegExp(`(?<![\\w$.])for\\s*\\(\\s*(?:(?:const|let|var)\\s*)?\\[\\s*(${ID})\\s*,[^\\]]*\\]\\s*of\\b[^)]*\\.\\s*entries\\s*\\(\\s*\\)\\s*\\)`, 'g'))) head(x[1], x.index);
  for (const x of m.matchAll(new RegExp(`(?<![\\w$.])for\\s*\\(\\s*(?:(?:let|var)\\s*)?(${ID})\\s*=[^;]*;`, 'g'))) head(x[1], x.index);
  // a callback's index parameter: `.forEach((l, i) => ...)`, ruby's `each_with_index { |l, i| ... }`
  for (const x of m.matchAll(new RegExp(`\\.\\s*(?:forEach|map|flatMap|filter|some|every|find|findIndex)\\s*\\(\\s*(?:async\\s+)?(?:\\(\\s*${ID}\\s*,\\s*(${ID})|function\\b[^(]*\\(\\s*${ID}\\s*,\\s*(${ID}))`, 'g'))) head(x[1] || x[2], x.index);
  for (const x of m.matchAll(new RegExp(`\\.\\s*(?:each_with_index|each\\.with_index)\\s*(?:do\\s*|\\{\\s*)\\|\\s*${ID}\\s*,\\s*(${ID})\\s*\\|`, 'g'))) head(x[1], x.index);
  bindingMemo = new Map();
  // a name bound once to a test: `m = re.search(p, l)`, `ok = 'x' in l`
  const seen = new Set();
  for (const x of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
    if (seen.has(x[1])) continue;
    seen.add(x[1]);
    const from = x.index + x[0].length;
    if (!/\.\s*(?:includes|include|startsWith|endsWith|startswith|endswith|contains|test|exec|match|search|fullmatch)\s*(?:\?\s*)?\(|\bin\b|[=!]~/.test(m.slice(from, stmtEnd(m, from)))) continue;
    const bs = bindingsOf(x[1]);
    if (bs.rhs.length !== 1 || bs.counter) continue;
    const c = cls(bs.rhs[0]);
    if (c.pos.size) matchNames.set(x[1], c.pos);
  }
  if (lang === 'python') pyStructure(m);
  else if (lang === 'ruby') rubyStructure(m);
  else if (lang === 'js') jsStructure(m);
}
// Output routes this reading cannot follow: a stream piped into stdout, a raw write to fd 1.
const OPAQUE_OUT = /\.\s*pipe\s*\(|copyfileobj|copy_stream|\bos\s*\.\s*write\s*\(|\bwriteSync\s*\(\s*(?:1|2)\b|\bsys\s*\.\s*stdout\s*\.\s*buffer/;
// A print function: a console method, a stdout write, a print builtin. Called directly it is a print; reached any
// other way - bound to a name (`const p = console.log`, `const {log} = console`, `.bind(...)`), through `.call` /
// `.apply`, by bracket (`console["log"]`) or passed along (`[h].forEach(console.log)`, `map(print, ...)`) - it is
// followed where the reading can (an alias's calls are prints like any other) and OPAQUE where it cannot.
const PRINT_FN = String.raw`(?:\bconsole\s*\.\s*[A-Za-z_$][\w$]*|\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write|\bsys\s*\.\s*(?:stdout|stderr)\s*\.\s*write|(?<![\w$.])stdout\s*\.\s*write|\$stdout\s*\.\s*(?:puts|print|write)|\bSTDOUT\s*\.\s*(?:puts|print|write)|\bpprint\s*\.\s*pprint|(?<![\w$.])(?:print|pprint|puts|pp|say|printf)(?![\w$]))`;
const PRINT_CALL = new RegExp(`${PRINT_FN}\\s*\\(`, 'g');
const PRINT_APPLY = new RegExp(`${PRINT_FN}\\s*\\.\\s*(?:call|apply)\\s*\\(`, 'g');
const PRINT_ALIAS = new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*=\\s*(${PRINT_FN})(\\s*\\.\\s*bind\\s*\\()?`, 'g');
const PRINT_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:console|process\s*\.\s*(?:stdout|stderr)|sys\s*\.\s*(?:stdout|stderr))\b/g;
const PRINT_REF = /\bconsole\b|\bprocess\s*\.\s*(?:stdout|stderr)\b|\bsys\s*\.\s*(?:stdout|stderr)\b|(?<![\w$.])(?:print|puts)\b/g;
// A bare print starts a statement: after a separator, a brace, or a ruby block's parameters (`{ |l| puts l }`).
const PRINT_BARE = /(?:^|[;{}\n|])\s*(?:print|puts|pp|p|say)\s+(?![=(.,)\]|])/g;
// The print regions of a script - [from, to) of what each print outputs - or null when a print is reached in a
// way this reading cannot follow.
function printRegions(m, lang) {
  const regions = [];
  const covered = [];
  const argsOf = (open, skipFirst) => {
    const close = matchClose(m, open);
    let from = open + 1;
    if (skipFirst) { const comma = stmtEnd(m, from); from = m[comma] === ',' ? comma + 1 : comma; }
    regions.push([from, close < 0 ? m.length : close]);
    return from;
  };
  for (const x of m.matchAll(PRINT_CALL)) { const open = x.index + x[0].length - 1; argsOf(open, false); covered.push([x.index, open]); }
  for (const x of m.matchAll(PRINT_APPLY)) { const open = x.index + x[0].length - 1; covered.push([x.index, argsOf(open, true)]); }
  if (lang === 'ruby') for (const x of m.matchAll(/(?<![\w$.])p\s*\(/g)) argsOf(x.index + x[0].length - 1, false);
  const aliases = new Set();
  for (const x of m.matchAll(PRINT_ALIAS)) {
    let end = x.index + x[0].length;
    if (x[3]) { const close = matchClose(m, end - 1); end = close < 0 ? m.length : close + 1; }
    if (!/^\s*(?:[;,)\n}]|$)/.test(m.slice(end, end + 4))) continue; // `p = console.log(...)` is a call, not an alias
    aliases.add(x[1]);
    covered.push([x.index, end]);
  }
  for (const x of m.matchAll(PRINT_DESTRUCTURE)) {
    for (const part of x[1].split(',')) { const w = part.split(':').pop().trim().replace(/\s*=[\s\S]*$/, ''); if (/^[A-Za-z_$][\w$]*$/.test(w)) aliases.add(w); }
    covered.push([x.index, x.index + x[0].length]);
  }
  if (aliases.size) {
    const names = [...aliases].map((w) => w.replace(/\$/g, '\\$')).join('|');
    for (const x of m.matchAll(new RegExp(`(?<![\\w$.])(?:${names})\\s*\\(`, 'g'))) { const open = x.index + x[0].length - 1; argsOf(open, false); covered.push([x.index, open]); }
    for (const x of m.matchAll(new RegExp(`(?<![\\w$.])(?:${names})\\s*\\.\\s*(?:call|apply)\\s*\\(`, 'g'))) { const open = x.index + x[0].length - 1; covered.push([x.index, argsOf(open, true)]); }
    // an alias passed along rather than called is a print this reading cannot follow
    for (const x of m.matchAll(new RegExp(`(?<![\\w$.])(?:${names})(?![\\w$])(?!\\s*(?:\\(|\\.\\s*(?:call|apply)\\s*\\())`, 'g'))) {
      if (!covered.some(([f, t]) => x.index >= f && x.index < t)) return null;
    }
  }
  for (const x of m.matchAll(PRINT_BARE)) { const from = x.index + x[0].length; regions.push([from, stmtEnd(m, from, true)]); covered.push([x.index, from]); }
  for (const x of m.matchAll(PRINT_REF)) {
    if (covered.some(([f, t]) => x.index >= f && x.index < t)) continue;
    if (/^process|^sys/.test(x[0]) && /^\s*\.\s*(?:isTTY|columns|rows|encoding)\b/.test(m.slice(x.index + x[0].length, x.index + x[0].length + 12))) continue;
    if (/^(?:print|puts)$/.test(x[0]) && /^\s*\./.test(m.slice(x.index + x[0].length, x.index + x[0].length + 3))) continue;
    return null;
  }
  return regions;
}
// true when the script's output can carry the read content; `printsValue` is node's -p / --print. `heavy(path)` says
// whether a literal read is a content source at all (a gated file over THRESHOLD); a read of a small or ungated file
// is not one, whatever is printed from it, and a read of a computed path is.
function scriptPrintsContent(script, printsValue, lang, heavy = () => true) {
  const src = String(script);
  const m = maskLiterals(src);
  srcText = src;
  curM = m;
  namesReKey = null;
  chainLimit = Infinity;
  iterMode = false;
  lightReads = new Set();
  READ_CALL.lastIndex = 0;
  for (let r; (r = READ_CALL.exec(m)) !== null;) {
    const open = r.index + r[0].length - 1;
    const close = matchClose(m, open);
    const lit = /^\s*(["'`])([^"'`\n]*)\1\s*(?:[,)]|$)/.exec(src.slice(open + 1, close < 0 ? src.length : close + 1));
    if (lit && !lit[2].includes('${') && !heavy(lit[2])) lightReads.add(r.index);
  }
  if (OPAQUE_OUT.test(m)) return true;
  // nested past the budget's depth: read as printing what it read, never walked
  let depth = 0;
  for (let k = 0, d = 0; k < m.length; k++) { if (CLOSE[m[k]]) { if (++d > depth) depth = d; } else if (m[k] === ')' || m[k] === ']' || m[k] === '}') d--; }
  if (depth > JUDGE_MAX_DEPTH) return true;
  const regions = printRegions(m, lang);
  if (!regions) return true;
  scanStructure(m, lang);
  let names = contentNames(m, lang);
  // Two passes: the guards relieve only per-element names - the loop variables this first pass found - and relieving
  // them can take a name out of the content (`bad = [(i, l) for i, l in enumerate(ls) if 'x' in l]`).
  guards = rawGuards.map((g) => ({ from: g.from, to: g.to, subjects: new Set([...g.pos].filter((n) => loopVars.has(n))) })).filter((g) => g.subjects.size && g.to > g.from);
  if (guards.length) names = contentNames(m, lang);
  if (printsValue) {
    let from = 0;
    for (let k = 0, depth = 0; k < m.length; k++) {
      if (CLOSE[m[k]]) depth++;
      else if (m[k] === ')' || m[k] === ']' || m[k] === '}') depth--;
      else if (depth === 0 && (m[k] === ';' || m[k] === '\n') && m.slice(k + 1).trim()) from = k + 1;
    }
    regions.push([from, m.length]);
  }
  return regions.some(([a, b]) => carriesContent(m, a, b, names, lang));
}
// `node -e '<script>'`, `python3 -c "<script>"`, `ruby -e`, `perl -e` - the script as the runtime receives it.
const RT_INLINE = /\b(python[\d.]*|node|nodejs|perl|ruby)\b((?:[ \t]+-[-\w=]+)*?)[ \t]+(-(?:e|c|p|pe|ep|E|-eval|-print))[ \t]+("(?:[^"\\]|\\.)*"|'[^']*')/g;
const RT_READ_LIT = /(?:open\(\s*(["'][^"']*["'])[^)]*\)\s*\.read\(|(?:readFileSync|File\.read)\(\s*(["'][^"']*["']))/;
// `php -r '<script>'` (2.1.6): its reads are rewritten by phpAsReads and the script judged with perl's print rules.
const PHP_INLINE = /\b(php)\b((?:[ \t]+-[-\w=]+)*?)[ \t]+(-(?:r|B|R|E))[ \t]+("(?:[^"\\]|\\.)*"|'[^']*')/g;
const langOf = (word) => (/^python/.test(word) ? 'python' : /^ruby/.test(word) ? 'ruby' : /^perl/.test(word) ? 'perl' : /^php/.test(word) ? 'php' : 'js');
const judgeLang = (lang) => (lang === 'php' ? 'perl' : lang);
// What reads a heredoc's body is the COMMAND of the stage holding the `<<`, or of a stage piped from it on the same
// line - a whole word, never a substring (`cat > run-node.txt <<'EOF'` feeds no runtime); a redirect target is the file
// written. The runtime or shell word, or null. guard-secret-value.js's heredocReader is the same reading (shared-rules).
const POSIX_SHELL = /^(?:bash|sh|zsh|dash|ksh)$/i;
const SHELL_RUNNER = /^(?:bash|sh|zsh|dash|ksh|pwsh|powershell)$/i; // a body they read is commands
const RUNTIME_RUNNER = /^(?:node|nodejs|python(?:\d+(?:\.\d+)?)?|ruby|perl|php|deno|bun)$/i; // a body they read is a script
function heredocRunner(line, at) {
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

// The nine path-scoped convention rules attach on a FILE-TOOL touch and on nothing else. Under a
// Bash-first working mode they therefore never attach at all: measured with a control for the first
// time, 19 Bash calls naming `.cs` files produced 0 attachments, while the session's single
// Read-tool call on a `.cs` file attached BOTH `.cs`-scoped rules 0.94 s later - so the C# rule was
// absent for the whole DESIGN, PLAN and GATE phase of a C# build. Corroborated at 0 attaches over
// 123 `.md` write targets and 54 authored docs. This hook already runs on every Bash call and
// already parses the extension, so it is the one place that can close the gap: it names the rule
// that governs the file, ONCE per rule per session, as non-blocking additionalContext.
const CONVENTION_RULES = [
  [/\.Designer\.cs\b|\w*Form(\.[^\s\/]+)?\.cs\b/, 'winforms-conventions.md'], // twin of the rule's paths (Designer + *Form.cs + *Form.*.cs); case-SENSITIVE so Platform.cs / Transform.cs stay plain C#
  [/\.cs\b/i, 'csharp-conventions.md'],
  [/\.xaml\b/i, 'wpf-conventions.md'],
  // Twin of the rule's own `paths:`. The suffixes are the pre-v20 spelling; the directory shapes are
  // the current one - the Angular style guide now recommends suffix-less names, and the rule matches
  // `**/src/app/**/*.ts` for exactly that reason, so a write to `src/app/user-profile.ts` was being
  // announced as typescript-conventions.md alone.
  [/\.(component|service|directive|pipe|guard|resolver|module|routes)\.ts\b|(?:^|[\s"'=\/])src\/(?:app|lib)\/[^\s"';|&]*\.tsx?\b/i, 'angular-conventions.md'],
  [/\.(component|global)\.(scss|css)\b|\bstyles\.(scss|css)\b/i, 'angular-styling-conventions.md'],
  [/\.tsx?\b/i, 'typescript-conventions.md'],
  [/\.(jsx?|mjs|cjs)\b/i, 'javascript-conventions.md'],
  [/\.sql\b/i, 'sql-conventions.md'],
  // Twin of the rule's own `paths:` - containers, compose, the three pipeline families, deploy scripts and env templates.
  [/\bDockerfile\b|\b(docker-)?compose[^\s]*\.ya?ml\b|\.github\/workflows\/[^\s]+\.ya?ml\b|\.github\/actions\/(?:\S+\/)?action\.ya?ml$|(?:^|\/)azure-pipelines[^\s\/]*\.ya?ml$|(?:^|\/)\.gitlab-ci\.yml$|(?:^|\/)deploy[^\s\/]*\.(?:sh|ps1)$|(?:^|\/)[^\s\/]*\.env\.(?:example|template)$/i, 'devops-conventions.md'],
  [/(?:^|\/)SKILL\.md$|(?:^|\/)skills\/\S*\.md$/, 'skill-authoring.md'], // twin of the rule's paths: **/SKILL.md + **/skills/**/*.md, case-sensitive, no .bak
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
  // stdout into a path. A leading fd (`2>`, `&>`) and an fd target (`>&2`) are not a file write.
  for (const m of text.matchAll(/(?:^|[^>&\d])1?>>?\s*(?!&)("[^"]*"|'[^']*'|[^\s;|&()<>]+)/g)) add(m[1]);
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
// The generated docs root is not governed by markdown-docs.md - the rule's own body says so - and
// neither is the install's own `.claude/` tree, so a `.md` target there names no rule - not even one
// whose pattern its NAME happens to carry (`next.js-upgrade.md`, `Dockerfile.md`): that would spend the
// rule's once-per-session announcement on a docs note. The one exception is skill-authoring.md -
// `.claude/skills/` is where a project keeps its own skills, and a skill file is governed wherever it lives.
// The docs root is RESOLVED, not assumed: hard-coding `.claude/` meant that with
// ALFRED_CODE_DOCS_PATH=docs - the committed-root case the docs-root rule itself describes - a write
// to `docs/architecture/ARCHITECTURE.md` still drew the announcement the rule says does not apply.
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNGOVERNED_MD = new RegExp(
  `(?:^|[\\s"'=])(?:\\./)?(?:\\.claude|${escapeRe(docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, ''))})/`);
function announceRules(text) {
  const docsRel = docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, '');
  const ungoverned = (t) => UNGOVERNED_MD.test(` ${t}`) || t.includes('.claude/') || t.includes(`${docsRel}/`);
  const targets = writeTargets(String(text));
  if (!targets.length) return;
  const hit = [];
  for (const t of targets) for (const [re, rule] of CONVENTION_RULES)
    if (re.test(t) && !hit.includes(rule) && !(rule !== 'skill-authoring.md' && /\.md\b/i.test(t) && ungoverned(t))) hit.push(rule);
  if (!hit.length) return;
  let state = {};
  const f = sessionStateFile();
  try { state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* fresh state */ }
  const said = state.__rules || [];
  const fresh = hit.filter((r) => !said.includes(r) && ruleInstalled(r));
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
        additionalContext: `This command touches files governed by ${fresh.map((r) => `\`.claude/rules/${r}\``).join(' and ')}. `
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
// a bounded run (cut of one field, bat -r, a real pattern, output into a file) names none. `grep .` stays the allowed
// filter it is for the runtime scripts' match guards.
// perl reads a file through a HANDLE, php through file_get_contents / readfile: each is rewritten as the read call the
// script analysis knows (`readFileSync('<path>')`), so `open F, '<x'; print <F>` is judged as `print(read('x'))`.
function perlAsReads(src) {
  const handles = new Map();
  const OPEN = /\bopen\s*\(?\s*(?:my\s+|our\s+|local\s+)?(\$?[A-Za-z_]\w*)\s*,\s*(?:(['"])([^'"\n]*)\2\s*,\s*)?(['"])([^'"\n]*)\4/g;
  for (const m of String(src).matchAll(OPEN)) {
    if (m[3] !== undefined ? /[>|]/.test(m[3]) : /^\s*[>+|]|\|\s*$/.test(m[5])) continue;
    handles.set(m[1], [m[4], m[5].replace(/^\s*<\s*/, '').trim()]);
  }
  const call = (h, m) => { const r = handles.get(h); return r ? `readFileSync(${r[0]}${r[1]}${r[0]})` : m; };
  return String(src).replace(/<\s*(\$?[A-Za-z_]\w*)\s*>/g, (m, h) => call(h, m)).replace(/\breadline\s*\(\s*(\$?[A-Za-z_]\w*)\s*\)/g, (m, h) => call(h, m))
    .replace(/\bread_file\s*\(/g, 'readFileSync(').replace(/\bpath\s*\(\s*((['"])[^'"\n]*\2)\s*\)\s*->\s*slurp\w*(?:\s*\(\s*\))?/g, 'readFileSync($1)');
}
function phpAsReads(src) {
  // a script from stdin opens with `<?php` (`<?=` prints): the tags are no code of their own
  return String(src).replace(/<\?=/g, ' print ').replace(/<\?(?:php\b)?|\?>/g, ' ').replace(/\bfile_get_contents\s*\(|\bfile\s*\(/g, 'readFileSync(').replace(/\b(?:readfile|fpassthru)\s*\(/g, 'print readFileSync(')
    .replace(/\b(?:echo|print_r|var_dump|var_export)\b/g, 'print');
}
// deno's read calls are the read the analysis knows too (`Deno.readTextFileSync('<path>')`)
const denoAsReads = (src) => String(src).replace(/\bDeno\s*\.\s*readTextFile(?:Sync)?\s*\(/g, 'readFileSync(');
function asReads(script, lang) { return lang === 'perl' ? perlAsReads(script) : lang === 'php' ? phpAsReads(script) : lang === 'js' ? denoAsReads(script) : script; }
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
      if (o.has('-c', '-l', '-L', '-q', '-o', '-m', '-v', '-f', '--count', '--files-with-matches', '--files-without-match', '--quiet', '--only-matching', '--max-count', '--invert-match', '--file')) continue;
      const given = o.vals.filter(([n]) => n === '-e' || n === '--regexp').map(([, w]) => w || '');
      const pats = given.length ? given : o.ops.slice(0, 1);
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
  if (verb === 'tail' && n.startsWith('+')) return (lc) => Math.max(0, lc - v + 1);
  if (verb === 'head' && n.startsWith('-')) return (lc) => Math.max(0, lc - v);
  return (lc) => Math.min(v, lc);
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
    const valued = verb === 'head' || verb === 'tail' ? /^(?:-n|-c|--lines|--bytes)$/ : /^(?:-e|--expression|-f|--file|-l|--line-length)$/;
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
    if (span && ops.length) { for (const f of ops) out.push({ f, printed: span }); continue; }
    if ((verb === 'sed' || verb === 'gsed') && own.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w)) && !own.some((w) => /^-[a-zA-Z]*i/.test(w) || /^--in-place/.test(w))) {
      const script = (ops[0] || '').replace(/\s+/g, '');
      const m = script.match(/^(\d+),(\d+|\$)p$/);
      if (m) {
        const a = +m[1]; const b = m[2] === '$' ? Infinity : +m[2];
        for (const f of ops.slice(1)) out.push({ f, printed: (lc) => Math.max(0, Math.min(b, lc) - a + 1) });
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
  try { announceRules(stripHeredocsOf(String((payload.tool_input || {}).command || ''))); } catch { /* an injection never breaks the gate */ }
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
    if (target === '-' || isVar(target)) continue;
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
  const DUMP_VERBS = /\bcat\b|\bsed\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bawk\b|\bopen\(|\breadFileSync\b|\breadTextFile(?:Sync)?\b|File\.read|\bget-content\b|\bgc\b|\btype\b|\b(?:nl|tac|rev|fmt|expand|unexpand|fold|pr|od|xxd|hexdump|base64|strings|paste|column|sort|uniq|bat|batcat|cut|iconv|zcat|gzcat|zmore|zless|dd|cp|curl|vim?|nvim|gvim|ex|view|look|tee|done|split|diff|comm|sqlite3|[ef]?grep|rg|perl|ruby|php|open|readline|read_file|slurp|file_get_contents|readfile)\b/i;
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
  const loop = (() => {
    const chars = command.split('');
    for (const [a, b] of shellWrites ? shellWrites.quotedSpans(command) : []) for (let i = a; i < b; i++) if (chars[i] !== '\n') chars[i] = ' ';
    const masked = chars.join('');
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
        if (new RegExp(`\\$\\{?${m[1]}\\b`).test(operand) && (SWEEP_EXT_ANY.test(list) || SWEEP_EXT_ANY.test(operand)))
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
    const namedFind = loop ? null : sweepM[0].match(/-name\s+(["']?)([^"'\s*?\[\]]+)\1(?=\s|$)/);
    // The literal-name exemption rests on 'no glob metacharacter means it names ONE file'. That
    // holds for a source file and fails completely for `-name SKILL.md`, which names one file per
    // skill directory - 35 of them in the measured dump, 46 in the next. So the exemption does not
    // cover markdown: a repeated literal `.md` name across a tree is the sweep, not the idiom.
    const namedOne = namedFind && !/\.md\b/i.test(namedFind[2] || '');
    if (loop || (!namedOne && SWEEP_EXT_ANY.test(sweepM[0]))) {
      global.BLOCK_DETAIL = loop ? { branch: 'sweep', var: loop.var, operand: loop.operand } : { branch: 'sweep', shape: sweep };
      process.stderr.write(
        `Blocked: whole-file sweep of source files via ${sweep}.\n` +
        `Every file in the sweep is dumped unchecked - the per-file size gate cannot see a loop\n` +
        `variable or a find placeholder. Per alfred-navigation.md, locate what you need first\n` +
        `(the navigation server's find_symbol / get_symbols_overview, or grep -n for a pattern), then read only the\n` +
        `ranges that matter. If you genuinely need one whole small file, cat it by name. The navigation\n` +
        `tools are DEFERRED - load them first:\n` + LOAD_SERENA,
      );
      process.exit(2);
    }
  }
  // A runtime read that PRINTS the file is the whole-file dump in another spelling. This branch used to block on the
  // extension ALONE (measured: a `node -e` whose whole output was `.match(...).length` on a 198-line file was denied,
  // a 107k-token retry), and then on a count test that saw one segment (scriptPrintsContent). Two
  // exemptions: the script prints no content, or the file is knowable and under THRESHOLD, exactly as for `cat`.
  // A HEAVY read is a gated file over THRESHOLD, or one this hook cannot size; only its content counts as printed.
  const heavyRead = (litRaw) => {
    const lit = String(litRaw || '').replace(/^["'`]|["'`]$/g, '');
    if (!lit || !gatedIn(lit)) return false;
    if (isVar(lit)) return true;
    const { lc, resolved } = resolveLineCount(expandWith(assigns, lit));
    return !resolved || lc > THRESHOLD;
  };
  const RT_READ_LITS = new RegExp(RT_READ_LIT.source, 'g');
  const readsHeavy = (script) => [...String(script).matchAll(RT_READ_LITS)].some((r) => heavyRead(r[1] || r[2]));
  const runtimeVerdict = (printsContent) => {
    if (!printsContent) return;
    process.stderr.write(
      'Blocked: whole-file read of a source file through a language runtime.\n' +
      'Per alfred-navigation.md this is the same whole-file read the Read gate blocks, spelled\n' +
      'differently. Locate the symbol first (the navigation server\'s find_symbol / get_symbols_overview), then read\n' +
      'only the range you need. A script that PRINTS only a count, a length or a test of the content\n' +
      '(`.length`, `.match(re).length`, `len(...)`, `.includes(...)`) is not a dump and is not blocked.\n' +
      'The navigation tools are DEFERRED - load them first:\n' + LOAD_SERENA,
    );
    process.exit(2);
  };
  // Every inline script is judged WHOLE, before the segment loop below cuts it at its own `;` (2.1.6 K2).
  const scriptSpans = [];
  for (const x of [...command.matchAll(RT_INLINE), ...command.matchAll(PHP_INLINE)]) {
    const to = x.index + x[0].length;
    scriptSpans.push([x.index, to]);
    const lang = langOf(x[1]);
    const script = asReads(x[4][0] === '"' ? x[4].slice(1, -1).replace(/\\(["\\$`])/g, '$1') : x[4].slice(1, -1), lang);
    if (!readsHeavy(script)) continue;
    // the segment loop's own exemptions: output bounded by a filter, or redirected into a file
    const tail = command.slice(to).match(/^[^;&\n]*/)[0];
    if (/\|\s*(head|tail|sed|grep|rg|wc|awk|cut|select-object|select|select-string|sls|measure-object|measure|findstr)\b/i.test(tail) || /(?:^|\s)>>?\s*[^&\s>]/.test(tail)) continue;
    const printsValue = /^node/.test(x[1]) && /(?:^|\s)-(?:p|pe|ep|-print)(?=\s|$)/.test(`${x[2]} ${x[3]}`);
    runtimeVerdict(scriptPrintsContent(script, printsValue, judgeLang(lang), heavyRead));
  }
  // A script fed to a runtime through a HEREDOC is the same script as `-e` / `-c` (2.1.6): measured, `node <<'EOF'`
  // printing a 3,245-line file passed, its body blanked as data above. The body is read back from the raw command
  // and judged the same way, with the same two exemptions the heredoc's own line can carry.
  // A runtime heredoc nested in a shell heredoc's body is read the same way (`shellBodies`, filled by stripHeredocsOf).
  const rawCommand = String(input.command || '');
  for (const text of [rawCommand, ...shellBodies]) {
    const docs = [...heredocsOf(text).map((h) => ({ line: text.slice(h.lineStart, h.lineEnd), at: h.index - h.lineStart, body: heredocBody(text, h) })), ...hereStringsOf(text)];
    for (const { line, at, body: raw } of docs) {
      const word = heredocRunner(line, at);
      if (!word || SHELL_RUNNER.test(word)) continue;
      const body = asReads(raw, langOf(word));
      if (!readsHeavy(body) || heredocBounded(line, at)) continue;
      runtimeVerdict(scriptPrintsContent(body, false, judgeLang(langOf(word)), heavyRead));
    }
  }
  // The segments, stages, verbs, pipes and redirects below are read on `filled` (quoteFilled): a quoted `;`, `|`, `>` or
  // verb is text. A segment piped into a shell runs its strings, so it is read as written.
  const filled = quoteFilled(command);
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

    // A runtime read the inline-script pass above did not see (an unquoted script): the same verdict, over the segment.
    const rtLang = langOf((seg.match(/\b(python|ruby|perl|php)/) || ['', 'node'])[1]);
    const rtSeg = asReads(seg, rtLang);
    const rtCall = !scriptSpans.some(([a, b]) => at < b && at + seg.length > a)
      && rtSeg.match(/\b(?:python3?|node|perl|ruby|php)\b[^\n]*?\b(?:open\(\s*(["'][^"']*["'])[^)]*\)\s*\.read\(|(?:readFileSync|File\.read)\(\s*(["'][^"']*["']))/);
    if (rtCall && readsHeavy(rtSeg)) runtimeVerdict(scriptPrintsContent(rtSeg, false, judgeLang(rtLang), heavyRead));

    // A dump verb whose output is unbounded is a dump: `head -n <huge>` and `tail -n +1` both print
    // the whole file, while a bounded `head -40` is the targeted read this gate exists to encourage.
    const unb = unquotedMatch(seg, hseg, /\bhead\s+-n\s*\d{5,}\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\btail\s+-n\s*\+\s*1\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\b(?:less|more)\s+((?:-\S+\s+)*\S+)/)
      || unquotedMatch(seg, hseg, /\bawk\s+(?:['"])1(?:['"])\s+((?:-\S+\s+)*\S+)/);
    if (unb && gatedIn(unb[1])) {
      process.stderr.write(
        'Blocked: unbounded whole-file dump (head -n <huge> / tail -n +1 / less / awk \'1\').\n' +
        'Per alfred-navigation.md, read the located range - the navigation server\'s find_symbol, or a bounded\n' +
        'sed -n \'<start>,<end>p\' once you know where to look. The navigation tools are DEFERRED - load them first:\n' + LOAD_SERENA,
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
        `Name the one file and read a range, or grep -n across them for what you need first:\n` + LOAD_SERENA,
      );
      process.exit(2);
    }
    const entries = files.map((f) => ({ f, printed: (lc) => lc })).concat(spanFiles(seg, fseg));
    for (const { f: rawF, printed } of entries) {
    const f = expandWith(assigns, rawF);
    const shown = (lc) => pipeSpan.printed(printed(lc));
    if (shown(1e9) <= THRESHOLD) continue; // a span that never prints past the threshold is the targeted read
    // A target still carrying an unexpanded variable is unknowable - the sibling guard's rule:
    // judge nothing rather than deny on a guess. This failed CLOSED before, and half the denials
    // in one measured project were `$R/...` paths the session had every right to read.
    if (isVar(f)) continue;
    // A glob is a sweep whatever each file weighs - markdown included, the most measured sweep (`cat skills/*/SKILL.md`).
    if (/[*?[]/.test(f) && (GATED_EXT.test(f) || SWEEP_EXT_ANY.test(f))) {
      process.stderr.write(
        `Blocked: a glob (${f}) hands every matching file to cat - a whole-file sweep, whatever each one weighs.\n` +
        `Name the one file and read a range, or locate the symbol first:\n` + serenaHint(f),
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
    const { lc, resolved } = resolveLineCount(f);
    if (!resolved) {
      // A dump-shaped command on a gated file whose size we cannot check fails CLOSED -
      // an unresolvable relative path was exactly how whole-file dumps slipped past this
      // matcher. Re-run with an absolute path (or read the located range via the navigation server).
      process.stderr.write(
        `Blocked: cannot size ${f} (relative path did not resolve against the project root or session cwd).\n` +
        `A whole-file cat/sed of a source file must be size-checked - use an absolute path,\n` +
        `or locate the symbol first:\n` + serenaHint(f),
      );
      process.exit(2);
    }
    // A whole print past THRESHOLD lines, or a span printing past THRESHOLD lines and more than half the file - the
    // Read half's own 'half the file or less per range'.
    const n = shown(lc);
    if (lc > THRESHOLD && n > THRESHOLD && (n === lc || n > lc / 2)) {
      process.stderr.write(
        `Blocked: ${n === lc ? 'whole-file dump' : `a ${n}-line span`} of ${f} (${lc} lines) via ${payload.tool_name}.\n` +
        `Per alfred-navigation.md, a bare cat/sed of a large source file is the same\n` +
        `whole-file read the Read gate blocks - routed through the shell.\n` + serenaHint(f),
      );
      process.exit(2);
    }
    }
  }
  } catch (err) {
    if (!(err instanceof JudgeBudget)) throw err;
    global.BLOCK_DETAIL = { branch: 'budget', matched: err.message };
    process.stderr.write(`Blocked: this command is too large or too deeply nested for the read guard to judge inside its\n` +
      `budget (${JUDGE_WORK.max} characters of judging) - nothing ran, and a command it cannot judge is read as the whole-file dump it may be.\n` +
      `Split it into smaller commands, or locate what you need first and read that range. The navigation tools\n` +
      `are DEFERRED - load them first:\n` + LOAD_SERENA);
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
  if (size > BIG_BYTES && whole) {
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
  process.stderr.write(
    `Blocked: whole-file Read of ${path} (${lineCount} lines).\n` +
      `Per alfred-navigation.md, Read is for code you've ALREADY located - never to find a symbol.\n` +
      `A limit that covers the whole file is still a whole-file Read - and so is\n` +
      `offset 1 with limit = the file's line count (measured: that exact retry got\n` +
      `blocked twice in a row). Read HALF the file or less per range.\n` + serenaHint(path),
  );
  process.exit(2);
}

// Cumulative cap: merge this range into the per-session interval set for the file; if the
// merged coverage would exceed ~60% of the file, the remainder goes through the navigation server - two
// half-splits reconstructing the file are the whole-file read in two calls (measured).
// The ranges are ROWS appended to a per-session log, one per Read, before the verdict - never a read-merge-write of one
// object, which four parallel Reads of a file's quarters each passed against an empty state (8 of 10 trials, audit
// 2026-10-08). Each Read replays the log up to its own row in append order, every earlier row judged by this same rule,
// so a row past the cap counts nothing and the last of a parallel batch sees the rows before it. The file is keyed by
// its real path: `./big.ts` reset the coverage `big.ts` had.
const CAP = 0.6;
const end = Math.min(lineCount, offset + (input.limit != null ? input.limit : lineCount) - 1);
let fileKey = pathMod.resolve(anchorDirs[0] || process.cwd(), path);
try { fileKey = fs.realpathSync(fileKey); } catch { /* as resolved */ }
const rangeLog = sessionStateFile().replace(/\.json$/, '-ranges.jsonl');
const rowId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
try { fs.appendFileSync(rangeLog, JSON.stringify({ f: fileKey, a: offset, b: end, id: rowId }) + '\n'); } catch { /* best-effort */ }
// State hygiene when this guard writes its state (hook-prelude.js sweepStale, audit 2026-10-08 S9): its session files
// past 7 days go.
try { const pre = require('./hook-prelude.js'); if (typeof pre.sweepStale === 'function') pre.sweepStale(os.tmpdir(), 'guard-read-'); } catch { /* no prelude */ }
const mergeIn = (merged, a, b) => {
  const out = merged.concat([[a, b]]).sort((x, y) => x[0] - y[0]);
  const m = [];
  for (const iv of out) { const last = m[m.length - 1]; if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]); else m.push([iv[0], iv[1]]); }
  return m;
};
const coverOf = (m) => m.reduce((n, [a, b]) => n + (b - a + 1), 0);
let merged = [];
let mine = false;
try {
  for (const line of fs.readFileSync(rangeLog, 'utf8').split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.f !== fileKey) continue;
    const next = mergeIn(merged, row.a, row.b);
    if (row.id === rowId) { merged = next; mine = true; break; }
    if (coverOf(next) <= lineCount * CAP) merged = next; // an earlier row past the cap was blocked: it read nothing
  }
} catch { /* no log - this range alone */ }
if (!mine) merged = mergeIn(merged, offset, end);
const covered = coverOf(merged);
if (covered > lineCount * CAP) {
  process.stderr.write(
    `Blocked: ranged Reads of ${path} now cover ${Math.round((100 * covered) / lineCount)}% of its ${lineCount} lines this session -\n` +
      `reconstructing a large file from half-splits is the whole-file read the guard exists to stop\n` +
      `(measured: 2-3-call splits rebuilt 7 blocked files in one run). For the remainder:\n` + serenaHint(path),
  );
  process.exit(2);
}
process.exit(0);
