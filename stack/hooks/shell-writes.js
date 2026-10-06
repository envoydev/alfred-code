// shell-writes.js - what a shell command WRITES, read from its literal text. Shared by
// guard-cross-project-write.js (which judges where each target lands) and guard-stop-contract.js's
// done gate (which counts a target inside the project as a source edit). A module, copied beside the
// hooks on the copy route and never wired (the fresh-session.js pattern): both hooks require it
// through __dirname, so the plugin cache and a copied install find it the same way.
// It only PARSES - it never resolves a path against a root or decides anything. The targets come
// back in the order the command runs them.
//
// EVERY PARSER HERE IS LINEAR (2.1.6 re-verify 3 R3-M3, R3-M4). The text is walked ONCE into words and operators
// (parseShell), and each rule reads the words of the command it belongs to - no regex scans from a command position,
// and no regex holds a quantified group with another unbounded quantifier inside it (scripts/shell-writes.test.js
// checks every literal). The regexes this replaced were quadratic on shapes real scripts carry - a comment block, a
// `$((y<<shift))`, a heredoc opener with no terminator, nested `cd`s, a run of redirects - and the git option regexes
// backtracked exponentially: 36 x ' -c' before a push took 67s, 24 x ' --git-dir' timed out, and on a hook timeout
// the call is never judged. What is read is also bounded: the scan budget (hook-prelude.js, the one home) caps the
// bytes and the time a scan spends, and the depth of scripts nested in scripts; past it the rest is UNREAD, and every
// caller judges unread text conservatively - the cross-project guard asks, the commit guard gates.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scanBudget } = require(path.join(__dirname, 'hook-prelude.js'));

// THE SHELL ROUTE - every tool whose payload carries a shell `tool_input.command`. The PowerShell tool is the
// same route under a second name (122 PowerShell calls measured in a 115-session corpus with no gate on any,
// 2026-09-12), and Monitor runs its `command` in the background under Bash's own permission rules
// (code.claude.com/docs/en/tools-reference, 'Monitor tool'; a `ws` watch carries no command and passes). One
// list, required by every shell guard (and matched by the manifest's shell rows and shell-guards.js MATCHER),
// so the next command-running tool is one line here instead of five inline copies.
const SHELL_TOOLS = ['Bash', 'PowerShell', 'Monitor'];
const isShellTool = (name) => SHELL_TOOLS.includes(String(name || ''));

// A GIT BASH MOUNT PATH. Git Bash / MSYS spell a Windows path in POSIX mount form (`/c/Users/...`,
// `/cygdrive/c/...`), which node on win32 resolves against the CURRENT drive - the falsehood that made the
// cross-project guard block a session cleaning its own temp scratch. Every guard that resolves a path off a
// command line translates it here, before any resolution; off Windows the spelling is a real POSIX path and is
// never touched. The one home (2.1.5 M8): it was inlined in five guards, pinned as a shared rule on the premise
// that no hook had a shared module. `platform` is for the tests.
const MOUNT_RE = /^(?:\/cygdrive)?\/([A-Za-z])(?=\/|$)/;
const nativePath = (p, platform = process.platform) => (platform === 'win32'
  ? String(p).replace(MOUNT_RE, (m, d) => `${d.toUpperCase()}:\\`)
  : String(p));
// os.homedir() THROWS on Windows when USERPROFILE is set but empty (uv_os_homedir ENOENT), and a hook calling it at
// load crashed with exit 1 - failing open (2.1.7, the windows-2025 job). HOME answers then: Git Bash expands `~` from it.
const homeDir = () => { try { return os.homedir() || process.env.HOME || ''; } catch { return nativePath(process.env.HOME || ''); } };

// ---- heredocs ----------------------------------------------------------------------------------------------------
// A heredoc BODY is DATA, not shell - a plan that DESCRIBES a command is inert text, and matching it blocks a document
// write for its own prose. Every heredoc of a text, in order, in ONE pass (re-verify 3 R3-M3): the lines are indexed
// once, and each opener finds its terminator line by a binary search in that index - a lazy regex rescanned to the end
// of the text for every opener with no terminator (a 0.99MB script of `cat <<EOF` lines timed out). An opener inside
// arithmetic (`$((y<<shift))`, `((n<<2))`) or a here-string (`<<<`) is no heredoc; an opener with no terminator line
// opens nothing. Several openers on one line take their bodies in turn, as the shell does. Each heredoc: `index` (its
// `<<`), `delim`, `lineStart` / `lineEnd` (its opener line), `bodyStart` / `bodyEnd` (the body, up to the terminator
// line) and `end` (the end of the terminator line).
// A line holding only a delimiter (blanks around it allowed): the terminator candidates, found in one pass.
const DELIM_LINES = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?$/gm;
const OPENER = /<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/y;
function heredocsOf(text) {
  const out = [];
  let next = text.indexOf('<<');
  if (next < 0) return out;
  const byText = new Map(); // delimiter -> the start of every line holding only it, in order
  for (const m of text.matchAll(DELIM_LINES)) {
    let list = byText.get(m[1]);
    if (!list) byText.set(m[1], (list = []));
    list.push(m.index);
  }
  const firstAtOrAfter = (list, pos) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < pos) lo = mid + 1; else hi = mid; }
    return lo < list.length ? list[lo] : -1;
  };
  const lineEndAt = (pos) => { const e = text.indexOf('\n', pos); return e < 0 ? text.length : e; };
  while (next >= 0) {
    const ls = text.lastIndexOf('\n', next) + 1;
    const le = lineEndAt(next);
    let lastEnd = -1; // the end of the terminator line of the last body this line opened
    let arith = 0;
    let cursor = ls;
    for (let i = next; i >= 0 && i < le; i = text.indexOf('<<', i + 2)) {
      for (; cursor < i; cursor++) { // `((` / `))` between the last opener and this one
        if (text[cursor] === '(' && text[cursor + 1] === '(') { arith++; cursor++; } else if (text[cursor] === ')' && text[cursor + 1] === ')' && arith) { arith--; cursor++; }
      }
      if (text[i + 2] === '<') { i += 1; cursor = Math.max(cursor, i + 2); continue; } // a here-string
      if (arith) continue;
      OPENER.lastIndex = i;
      const m = OPENER.exec(text);
      if (!m || OPENER.lastIndex > le) continue;
      const bodyStart = Math.min((lastEnd >= 0 ? lastEnd : le) + 1, text.length);
      const term = firstAtOrAfter(byText.get(m[3]) || [], bodyStart);
      if (term < 0) continue;
      const end = lineEndAt(term);
      out.push({ index: i, delim: m[3], strip: m[1] === '-', openEnd: OPENER.lastIndex, lineStart: ls, lineEnd: le, bodyStart, bodyEnd: term, end });
      lastEnd = end;
      cursor = Math.max(cursor, OPENER.lastIndex);
    }
    const resume = (lastEnd >= 0 ? lastEnd : le) + 1;
    next = resume < text.length ? text.indexOf('<<', resume) : -1;
  }
  return out;
}
const bodyOf = (text, h) => text.slice(h.bodyStart, h.bodyEnd);
// A heredoc's body as the shell hands it over (no trailing newline), and whether the shell expands nothing in it: a quoted
// or backslashed tag (`<<'EOT'`, `<<"EOT"`, `<<\EOT`). The two guards that judge a body as code read it through these,
// so every opener spelling `heredocsOf` accepts is one spelling to them too (2.1.6 seam review M1).
const heredocBody = (text, h) => text.slice(h.bodyStart, Math.max(h.bodyStart, h.bodyEnd - 1));
const heredocVerbatim = (text, h) => /[\\'"]/.test(text.slice(h.index + 2, h.openEnd).replace(/^-/, ''));
// The `$( ... )` and backtick substitutions an UNQUOTED heredoc body has the shell expand, as { from, to } spans of each one's
// inner text (a heredoc body holds no quotes, so none is read; `$((` is arithmetic). The guards judge each as a command
// where the body is data: `cat <<EOF > f` / `key: $(cat .env)` / `EOF` reads the file (seam m5).
function heredocSubstitutions(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (c === '$' && body[i + 1] === '(' && body[i + 2] !== '(') {
      let depth = 1;
      let j = i + 2;
      for (; j < body.length && depth; j++) { if (body[j] === '(') depth++; else if (body[j] === ')') depth--; }
      out.push({ from: i + 2, to: depth ? j : j - 1 });
      i = j - 1;
    } else if (c === '`') {
      const j = body.indexOf('`', i + 1);
      if (j < 0) break;
      out.push({ from: i + 1, to: j });
      i = j;
    }
  }
  return out;
}
// Blank every heredoc body (and its terminator line), keep the length. The opener's own line stays: `cat <<'EOF' >
// ../other/f.txt` carries its redirect THERE, and blanking the whole match let that classic shell write through.
function blankHeredocs(rawCommand, known) {
  const text = String(rawCommand || '');
  const docs = known || heredocsOf(text);
  if (!docs.length) return text;
  const parts = [];
  let cursor = 0;
  for (const h of docs) {
    const from = Math.max(cursor, h.lineEnd);
    if (from > cursor) parts.push(text.slice(cursor, from));
    if (h.end > from) parts.push(text.slice(from, h.end).replace(/[^\n]/g, ' '));
    cursor = Math.max(cursor, h.end);
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

// A COMMENT is not shell either: bash ignores a word that starts with `#` to the end of its line, so
// nothing in one can write - and an apostrophe in one ('the model's') flipped every quoted span after
// it, so `x=>/@(...)` inside a later single-quoted `node -e` program read as a redirection to `/@` (the
// source-protocol snippet init runs, 2026-09-27). Blank it, keep the length. A `#` starts a comment only
// at a word start outside quotes - not in `a#b`, `$#`, `${#x}`, or a quoted string. The PowerShell route
// shares this parser: its `<# ... #>` block comment ends at `#>`, not at the line end, so it is blanked as
// its own span and a `#` after `<` starts no line comment (review A, M1: `<# note #> echo x > <outside>` lost
// its redirect). Bash's `$'...'` honours backslash escapes, so `$'it\'s # x'` stays one quoted word.
const COMMENT_BEFORE = new Set([' ', '\t', '\r', '\n', '\f', '\v', ';', '&', '|', '(', ')', '>']);
function blankComments(command) {
  const n = command.length;
  const parts = [];
  let cursor = 0;
  const blank = (from, to) => { // blank [from, to), keeping every newline
    parts.push(command.slice(cursor, from));
    let i = from;
    for (let nl = command.indexOf('\n', i); nl >= 0 && nl < to; nl = command.indexOf('\n', i)) { parts.push(' '.repeat(nl - i), '\n'); i = nl + 1; }
    parts.push(' '.repeat(to - i));
    cursor = to;
  };
  let q = '';
  let ansi = false;
  let blockEnds = true; // false once no `#>` is left after the scan point - never search for it again
  for (let i = 0; i < n; i++) {
    const c = command[i];
    if (q) {
      if (c === '\\' && (q === '"' || ansi)) { i++; continue; }
      if (c === q) { q = ''; ansi = false; }
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === "'" && i > 0 && command[i - 1] === '$') { q = c; ansi = true; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '<' && command[i + 1] === '#') {
      const end = blockEnds ? command.indexOf('#>', i + 2) : -1;
      if (end < 0) blockEnds = false;
      if (end > 0) { blank(i, end + 2); i = end + 1; }
      continue;
    }
    if (c === '#' && (i === 0 || COMMENT_BEFORE.has(command[i - 1]))) {
      let e = command.indexOf('\n', i);
      if (e < 0) e = n;
      blank(i, e);
      i = e - 1;
    }
  }
  if (!parts.length) return command;
  parts.push(command.slice(cursor));
  return parts.join('');
}

// Quoted spans: a `>` or a verb inside '...' / "..." is text an outer command carries (a commit
// message, an echo, a grep pattern), never a write of its own. The write TARGET may still be
// quoted - the rules below dequote it - only the verb's own position is checked.
// A `$( ... )` inside a double-quoted span is SHELL again, with its own quoting: bash does not end
// the outer span on the `"` of `"$(grep -o 'Sdk="[^"]*"' f)"`. Reading it as the closing quote
// flipped every span after it, and a later `sed 's/<OutputType>//'` then read as a redirection to
// `//` - replayed at exit 2, ~112k tokens re-sent. So the substitution is tracked as its own
// context: the outer span pauses at `$(`, the inside is judged on its own (a real redirect in
// there still counts), and the outer span resumes after the matching `)`.
const QS_CLASS = new Uint8Array(128); // the characters quotedSpans reads outside single quotes
for (const ch of '\\$)"\'') QS_CLASS[ch.charCodeAt(0)] = 1;
function quotedSpans(command) {
  const quoted = [];
  const stack = []; let q = null; let start = 0;
  const n = command.length;
  for (let i = 0; i < n; i++) {
    if (q === "'") { // nothing inside single quotes but the closing quote
      const close = command.indexOf("'", i);
      if (close < 0) break;
      quoted.push([start, close + 1]); q = null; i = close;
      continue;
    }
    const code = command.charCodeAt(i);
    if (code >= 128 || !QS_CLASS[code]) continue;
    const c = command[i];
    if (c === '\\') { i++; continue; }
    if (c === '$' && command[i + 1] === '(') {
      if (q) quoted.push([start, i]);          // the outer span pauses here
      stack.push(q); q = null; i++; continue;
    }
    if (!q && c === ')' && stack.length) { q = stack.pop(); start = i + 1; continue; }
    if (!q && (c === '"' || c === "'")) { q = c; start = i; }
    else if (q && c === q) { quoted.push([start, i + 1]); q = null; }
  }
  if (q) quoted.push([start, n]);
  return quoted;
}
// Is index `i` inside a quoted span (its quotes excluded)? The spans never overlap - a `$( ... )` pauses the one around
// it - so the last span opening before `i` is the only candidate: a binary search.
const sortedByStart = (spans) => {
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][0]) return spans.slice().sort((x, y) => x[0] - y[0]);
  return spans;
};
function spanTest(quoted) {
  const spans = sortedByStart(quoted);
  return (i) => {
    let lo = 0;
    let hi = spans.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid][0] < i) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return hit >= 0 && i < spans[hit][1];
  };
}
const unquote = (s) => s.replace(/^["']|["']$/g, '');
const isVar = (s) => /\$\{?[A-Za-z_]/.test(s);
// Split an argument list into SHELL WORDS, joining adjacent quoted and unquoted runs into one
// word before the quotes come off. A regex alternation of quoted-span-or-\S+ split
// `rm -f "$SP"/run*.log` into `"$SP"` and `/run*.log`, and that second fragment reads as an
// absolute path to the filesystem root - a session cleaning its OWN scratch was denied in 3
// bundles, while the identical command fully quoted or fully unquoted passed.
function shellWords(text) {
  const out = [];
  let cur = '';
  let q = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) q = null; else cur += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") { q = c; started = true; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    cur += c; started = true;
  }
  if (started) out.push(cur);
  return out;
}
// One shell word as the shell reads it: quotes removed, a backslash escape outside single quotes resolved (inside
// double quotes only before `$`, a backtick, `"`, `\` or a newline), `$'...'` read with its escapes.
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', a: '', b: '', f: '', v: '', e: '', c: '', "'": "'", '"': '"' };
const unescape = (s) => String(s).replace(/\\(0[0-7]{0,3}|[ntr\\abfvec'"])/g,
  (m, c) => (c[0] === '0' ? String.fromCharCode(parseInt(c.slice(1) || '0', 8)) : ESCAPES[c]));
const PLAIN_WORD = /^[^"'\\$]*$/;
// A Windows path written bare on Windows (`C:\Users\x\f.txt`, `\\server\share\f`, `if=C:\x`) is the path the session
// means, never bash's escape of each letter. Read as bash it collapsed to `C:Usersxf.txt`, a relative name, so every
// guard judged an out-of-project write, a `-C` into a sibling repo and a credential read as this project's own file
// (2.1.6 CI: the windows-2025 job red on 30 guard cases; the reader before the one-shell rewrite kept the backslashes).
const WIN_PATH_WORD = /^(?:[\w.-]*=)?(?:[A-Za-z]:\\|\\\\)[^"'$`]*$/;
function dequote(raw, platform = process.platform) {
  if (PLAIN_WORD.test(raw)) return raw;
  if (platform === 'win32' && WIN_PATH_WORD.test(raw)) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '$' && raw[i + 1] === "'") {
      let j = i + 2;
      let body = '';
      for (; j < raw.length && raw[j] !== "'"; j++) { if (raw[j] === '\\' && j + 1 < raw.length) body += raw[j++]; body += raw[j]; }
      out += unescape(body);
      i = j;
      continue;
    }
    if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end < 0) { out += raw.slice(i + 1); break; }
      out += raw.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '"') {
      for (i++; i < raw.length && raw[i] !== '"'; i++) {
        if (raw[i] === '\\' && '$`"\\\n'.includes(raw[i + 1] || '')) i++;
        out += raw[i];
      }
      continue;
    }
    if (c === '\\' && i + 1 < raw.length) { out += raw[++i]; continue; }
    out += c;
  }
  return out;
}
// A sed/perl SCRIPT is not a path: `sed -i '' '/^DIVIDER$/d' <file>` had its address form read as
// an absolute path and denied (replayed: exit 2, while `'s/a/b/'` exit 0 - it is not explicit, so
// it never reached the check). A leading-slash token whose body carries a regex metacharacter and
// which ends in sed command letters is a script; `/abs/path` has no metacharacter and stays a path.
const SED_SCRIPT = /^\/(?=[^/]*[\^$*+?\[\]\\.])[^/]*\/[a-zA-Z]*$/;
// The narrow form above only recognizes an address carrying a REGEX metacharacter, so a LITERAL
// address (`/ApPermissionGuard/d`), a substitution (`s/a/b/`) and a line address (`1,$d`) were all
// judged as out-of-project PATHS - 3 of 8 cross-write blocks in the audited corpus were sed scripts
// read that way. This form covers them, and it is applied ONLY to the sed/perl route: on the
// rm/chmod route those same tokens really are paths. The trailing command letter set is kept to
// the address commands (`d p q =`) so `/etc/passwd` and `/tmp/file.txt` still read as paths.
const SED_SCRIPT_ARG = /^(?:\/(?:[^/\\]|\\.)*\/(?:,\/(?:[^/\\]|\\.)*\/)?[dpq=]|(?:\$|\d+)(?:,(?:\$|\d+))?[dpq=]|[sy]\/(?:[^/\\]|\\.)*\/(?:[^/\\]|\\.)*\/[a-zA-Z0-9]*)$/;

// A `\`-newline continues the command on the next line: joined (to blanks of the same length) before any rule reads
// it, so `cp -r build \` + newline + `<outside>` is one command, as the shell runs it (2.1.6 review M3). An escaped
// backslash before the newline (`\\`) is a real line end.
const joinContinuations = (command) => command.replace(/(^|[^\\])((?:\\\\)*)\\(\r?\n)/g,
  (m, lead, pairs, nl) => `${lead}${pairs} ${nl.replace(/./gs, ' ')}`);

// ---- the command walker ------------------------------------------------------------------------------------------
// ONE pass over a command (heredoc bodies and comments blanked, continuations joined) into its words and operators,
// grouped into SIMPLE COMMANDS (the words between `;`, `&&`, `||`, `&`, `|`, a newline or a paren) and LIST ELEMENTS
// (a pipeline: simple commands joined by `|`). A quoted span is part of the word it sits in; `$( ... )`, a backtick
// pair and `<( ... )` / `>( ... )` are commands of their own inside the word that holds them; `$(( ... ))` and
// `${ ... }` are part of the word. Each simple command knows its words, its redirections ({ op, at, target }), its list
// element, its pipeline stage and the subshell it runs in (`end`: where that subshell closes, undefined at the top).
// Its COMMAND WORDS are found after the fact: the first word past assignments and the keywords that open a body
// (`then`, `do`, `!`, `{`, ...), and past each wrapper that runs the next word as the command (`sudo`, `env`, `nice`,
// `timeout`, `xargs`, `command`, `exec`, `eval`, `uv run`, ...) - with its flags, and a flag's value word, which is
// taken as a command word as well, since the text alone cannot say which it is (`sudo -u root rm x`) - and the word
// after `find`'s `-exec` / `-execdir` / `-ok`. A command word may be spelled by path (`/bin/rm`), escaped (`\cp`),
// quoted (`'git'`), split (`gi""t`), with `.exe`, or through a variable assigned a literal earlier in the same command
// (`GIT=git; $GIT commit`); on macOS and Windows, whose file systems fold case, `Git` runs git (re-verify 3 R3-m6).
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'xargs', 'time', 'nohup', 'nice', 'ionice', 'stdbuf', 'timeout', 'gtimeout', 'caffeinate',
  'command', 'exec', 'builtin', 'eval', 'coproc', 'npx', 'bunx', 'chronic', 'unbuffer', 'setsid']);
const RUN_TOOLS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch', 'rye']);
// Heads whose later words are data or files, never a command they run: `echo git push`, `grep git log`, `man git x`.
const DATA_HEADS = new Set(['echo', 'printf', 'cat', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ls', 'll', 'man', 'which', 'whereis', 'type',
  'sed', 'awk', 'gawk', 'head', 'tail', 'less', 'more', 'diff', 'wc', 'tee', 'touch', 'mkdir', 'rm', 'cp', 'mv', 'ln', 'open', 'code', 'vim', 'vi',
  'nano', 'emacs', 'jq', 'gh', 'node', 'python', 'python3', 'ruby', 'perl', 'curl', 'wget', 'cd', 'pushd', 'test', 'true', 'false', 'read', 'set',
  'unset', 'alias', 'source', 'sort', 'uniq', 'cut', 'tr', 'stat', 'file', 'basename', 'dirname', 'realpath', 'readlink', 'chmod', 'chown',
  'tig', 'lazygit', 'make', 'cmake', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'rsync', 'docker', 'kubectl', 'dotnet', 'cargo', 'go']);
const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PACKAGE_VERBS = new Set(['run', 'exec', 'dlx', 'x']);
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'fi', 'done', 'esac']);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const FOLDS_CASE = process.platform === 'darwin' || process.platform === 'win32';
const VAR_WORD = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;
const NO_CHAIN = Object.freeze([]);
const NO_REDIRS = Object.freeze([]);
// One word of a parsed command: where it stands, its text as written (`raw`, cut on first use) and dequoted (`dq`).
class Tok {
  constructor(src, s, e) { this.src = src; this.s = s; this.e = e; this.dq = undefined; this._raw = undefined; }
  get raw() { return this._raw === undefined ? (this._raw = this.src.slice(this.s, this.e)) : this._raw; }
}
// The walker's character classes: 0 a plain word character, 1 a blank (never a newline, which ends a list element),
// 2 a character the walker reads one at a time (quotes, escapes, operators, parens, `$`, backtick, redirections).
const CHAR_CLASS = new Uint8Array(128);
for (const ch of ' \t\r\f\v') CHAR_CLASS[ch.charCodeAt(0)] = 1;
for (const ch of '\n;&|()`$<>"\'\\') CHAR_CLASS[ch.charCodeAt(0)] = 2;
const MAX_NEST = 256; // subshells nested deeper than this are unread - no real command opens 256 parens

function normCmd(word, assigns) {
  let w = word;
  const v = assigns && VAR_WORD.exec(w);
  if (v && assigns.has(v[1])) w = assigns.get(v[1]);
  let base = w.slice(w.lastIndexOf('/') + 1);
  if (process.platform === 'win32') base = base.slice(base.lastIndexOf('\\') + 1);
  if (/\.exe$/i.test(base)) base = base.slice(0, -4);
  return FOLDS_CASE ? base.toLowerCase() : base;
}

function parseShell(command, opts = {}) {
  const n = command.length;
  const spans = sortedByStart(quotedSpans(command));
  const inQuotes = spanTest(spans);
  const cmds = [];
  const elems = [];
  const frames = [];
  let depth = 0;
  let tooDeep = false;
  const newCtx = (from, frame) => ({ cmd: null, from, cmds: [], frame, stage: 0 });
  let ctx = newCtx(0, null);
  const stack = [];
  let wStart = -1;
  let redir = null;
  const cmdOf = () => {
    if (!ctx.cmd) {
      ctx.cmd = { words: [], redirs: NO_REDIRS, frame: ctx.frame, stage: ctx.stage, elem: null, cands: null, index: cmds.length, end: undefined };
      cmds.push(ctx.cmd);
      ctx.cmds.push(ctx.cmd);
    }
    return ctx.cmd;
  };
  const endWord = (i) => {
    if (wStart < 0) return;
    const t = new Tok(command, wStart, i);
    wStart = -1;
    if (redir) { redir.target = t; const cmd = cmdOf(); if (cmd.redirs === NO_REDIRS) cmd.redirs = []; cmd.redirs.push(redir); redir = null; return; }
    cmdOf().words.push(t);
  };
  const endCmd = () => { ctx.cmd = null; };
  const endElem = (at, next) => {
    endCmd();
    redir = null;
    if (ctx.cmds.length) {
      const el = { from: ctx.from, to: at, cmds: ctx.cmds };
      for (const c of ctx.cmds) c.elem = el;
      elems.push(el);
    }
    ctx.cmds = [];
    ctx.from = next;
    ctx.stage = 0;
  };
  const open = (kind, i, len) => {
    const frame = { kind, open: i, close: undefined, parent: ctx.frame };
    frames.push(frame);
    if (++depth > MAX_NEST) tooDeep = true;
    stack.push({ frame, ctx, wStart, redir });
    if (kind === '(') { endElem(i, i + len); stack[stack.length - 1].ctx = ctx; }
    ctx = newCtx(i + len, frame);
    wStart = -1;
    redir = null;
    return frame;
  };
  const close = (i) => {
    const top = stack.pop();
    depth--;
    endWord(i);
    endElem(i, i + 1);
    top.frame.close = i;
    ctx = top.ctx;
    if (top.frame.kind === '(') { ctx.from = i + 1; wStart = -1; redir = top.redir; return; }
    // a substitution is part of the word that holds it: that word runs on past the closing mark
    wStart = top.wStart >= 0 ? top.wStart : top.frame.open;
    redir = top.redir;
  };
  let sp = 0;
  for (let i = 0; i < n; i++) {
    const code = command.charCodeAt(i);
    const cls = code < 128 ? CHAR_CLASS[code] : 0;
    if (cls === 0) { // a run of plain word characters
      if (wStart < 0) wStart = i;
      let j = i + 1;
      while (j < n) { const k = command.charCodeAt(j); if (k < 128 && CHAR_CLASS[k] !== 0) break; j++; }
      i = j - 1;
      continue;
    }
    if (cls === 1) { // a run of blanks
      endWord(i);
      let j = i + 1;
      while (j < n && CHAR_CLASS[command.charCodeAt(j)] === 1) j++;
      i = j - 1;
      continue;
    }
    while (sp < spans.length && spans[sp][0] < i) sp++;
    if (sp < spans.length && spans[sp][0] === i) { // a quoted span: part of the word, whatever it holds
      if (wStart < 0) wStart = i;
      i = Math.max(i, spans[sp][1] - 1);
      sp++;
      continue;
    }
    const c = command[i];
    if (c === '\\') { if (wStart < 0) wStart = i; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { endWord(i); continue; }
    if (c === '\n' || c === ';') { endWord(i); endElem(i, i + 1); continue; }
    if (c === '&') {
      endWord(i);
      if (command[i + 1] === '&') { endElem(i, i + 2); i++; continue; }
      if (command[i + 1] === '>') { // `&>` / `&>>` - both streams to a file
        const two = command[i + 2] === '>';
        redir = { op: two ? '&>>' : '&>', at: i + 1, target: null };
        i += two ? 2 : 1;
        continue;
      }
      endElem(i, i + 1);
      continue;
    }
    if (c === '|') {
      endWord(i);
      if (command[i + 1] === '|') { endElem(i, i + 2); i++; continue; }
      if (command[i + 1] === '&') i++;
      endCmd();
      redir = null;
      ctx.stage++;
      continue;
    }
    if (c === '(') { endWord(i); open('(', i, 1); continue; }
    if (c === ')') {
      if (stack.length) { close(i); continue; }
      endWord(i); endElem(i, i + 1); // a `case` arm's `)`: a command starts after it
      continue;
    }
    if (c === '`') {
      if (stack.length && stack[stack.length - 1].frame.kind === '`') { close(i); continue; }
      open('`', i, 1);
      continue;
    }
    if (c === '$') {
      const d = command[i + 1];
      if (d === '(' && command[i + 2] === '(') { // arithmetic: part of the word
        if (wStart < 0) wStart = i;
        let lvl = 0;
        let j = i + 1;
        for (; j < n; j++) { if (command[j] === '(') lvl++; else if (command[j] === ')' && --lvl === 0) break; }
        i = j;
        continue;
      }
      if (d === '(') { open('$(', i, 2); i++; continue; }
      if (d === '{') { // a parameter expansion: part of the word
        if (wStart < 0) wStart = i;
        let lvl = 0;
        let j = i + 1;
        for (; j < n; j++) { if (command[j] === '{') lvl++; else if (command[j] === '}' && --lvl === 0) break; }
        i = j;
        continue;
      }
      if (wStart < 0) wStart = i;
      continue;
    }
    if (c === '<' || c === '>') {
      let fdWord = false;
      if (wStart >= 0) {
        let digits = true;
        for (let k = wStart; k < i; k++) if (command[k] < '0' || command[k] > '9') { digits = false; break; }
        if (digits && i - wStart <= 4) { fdWord = true; wStart = -1; } else endWord(i);
      }
      void fdWord;
      const d = command[i + 1];
      if (d === '(') { open(c === '<' ? '<(' : '>(', i, 2); i++; continue; } // a process substitution
      let op = c;
      if (c === '>') {
        if (d === '>') op = '>>'; else if (d === '|') op = '>|'; else if (d === '&') op = '>&';
      } else if (d === '<') {
        op = command[i + 2] === '<' ? '<<<' : (command[i + 2] === '-' ? '<<-' : '<<');
      } else if (d === '>') op = '<>'; else if (d === '&') op = '<&';
      redir = { op, at: i, target: null };
      i += op.length - 1;
      continue;
    }
    if (wStart < 0) wStart = i;
  }
  endWord(n);
  while (stack.length) { // an unclosed substitution or subshell: what it holds is still read, in no subshell
    const top = stack.pop();
    endElem(n, n);
    ctx = top.ctx;
  }
  endElem(n, n);
  const assigns = opts.assigns || new Map();
  const assignEvents = [];
  for (let k = 0; k < cmds.length; k++) {
    const c = cmds[k];
    c.end = c.frame ? c.frame.close : undefined;
    c.cands = commandWordsOf(c, assigns, assignEvents);
  }
  const P = { command, spans, inQuotes, cmds, elems, frames, tooDeep, assigns, assignEvents };
  P.cds = cdsOf(P);
  return P;
}
// A variable assigned a LITERAL earlier in the same command is not unknowable (noteAssign) - `SP=/tmp/x` then `rm -rf "$SP"/*` is
// judgeable, and reading it as unjudgeable is how a real out-of-tree write would have walked through. Only literal
// values are taken - read as the shell reads the word (`G=g"i"t` is `git`, re-verify 3 R3-m6), before a command or
// after `export` / `local` / `declare` / `typeset` / `readonly`; anything carrying another expansion stays unresolved,
// and an unresolved variable is never judged.
const DECLARERS = new Set(['export', 'local', 'declare', 'typeset', 'readonly']);
const ASSIGN_NAME = /^([A-Za-z_][A-Za-z0-9_]*)=/;
// Each assignment is also kept in order (`events`), for the alias lookup's view of what was set before a call.
function noteAssign(assigns, events, tok) {
  const raw = tok.raw;
  const m = raw.indexOf('=') > 0 ? ASSIGN_NAME.exec(raw) : null;
  if (!m) return false;
  const v = raw.slice(m[0].length);
  const d = /[$`]/.test(v) ? '' : dequote(v);
  if (d) assigns.set(m[1], d);
  events.push({ at: tok.s, kind: 'set', name: m[1], value: dequote(v) });
  return true;
}
// The command words of one simple command: { at (its index in words), name (normalised), word (dequoted), via (the
// wrapper before it, if any), args (the argument words that command reads: to the end of the simple command, or to
// an -exec action's `;` / `+`) }.
const dqTok = (t) => (t.dq === undefined ? (t.dq = dequote(t.raw)) : t.dq);
// One command word: its `args` (the tokens it reads) and `argv` (those dequoted) are made on first use - most command
// words are never asked, and a megabyte of script is a hundred thousand of them.
class Cand {
  constructor(cmd, at, word, name, via, chain) {
    this.cmd = cmd; this.at = at; this.word = word; this.name = name; this.via = via; this.chain = chain;
    this._args = null; this._argv = null;
  }
  get args() { return this._args || (this._args = this.cmd.words.slice(this.at + 1)); }
  set args(v) { this._args = v; this._argv = null; }
  get argv() { return this._argv || (this._argv = this.args.map(dqTok)); }
}
const FINDS = new Set(['find', 'gfind']);
function commandWordsOf(cmd, assigns, events) {
  const w = cmd.words;
  const out = [];
  const dq = (k) => dqTok(w[k]);
  let wrapper = null;
  let afterFlag = false;
  let k = 0;
  const chain = [];
  const cand = (at, via) => { const word = dq(at); const c = new Cand(cmd, at, word, normCmd(word, assigns), via, chain.length ? chain.slice() : NO_CHAIN); out.push(c); return c; };
  for (; k < w.length; k++) {
    const raw = w[k].raw;
    if (!wrapper) {
      if (ASSIGN.test(raw)) { noteAssign(assigns, events, w[k]); continue; }
      if (KEYWORDS.has(raw)) continue;
      const c = cand(k, null);
      if (WRAPPERS.has(c.name)) { wrapper = c.name; chain.push(c.name); afterFlag = false; continue; }
      if (RUN_TOOLS.has(c.name) && w[k + 1] && dq(k + 1) === 'run') { wrapper = c.name; chain.push(c.name); afterFlag = false; k++; continue; }
      break;
    }
    const word = dq(k);
    if (word.startsWith('-')) { afterFlag = true; continue; }
    if (/^\d[\w.]*$/.test(word) || ASSIGN.test(raw)) { afterFlag = false; continue; }
    const c = cand(k, wrapper);
    if (WRAPPERS.has(c.name)) { wrapper = c.name; chain.push(c.name); afterFlag = false; continue; }
    if (RUN_TOOLS.has(c.name) && w[k + 1] && dq(k + 1) === 'run') { wrapper = c.name; chain.push(c.name); afterFlag = false; k++; continue; }
    if (afterFlag) { afterFlag = false; continue; } // perhaps the flag's value: the next word may be the command
    break;
  }
  // A runner the lists above do not name (`xcrun git push`, `bundle exec`, `op run --`, `direnv exec .`, `flock`,
  // `setsid`): a bare `git` word after a head that only prints, reads or edits data is the call, so a runner the
  // stack never heard of does not hide it (2.1.6 re-verify 4 R4-M2 - the base gated any word sequence that reached
  // git). A package runner counts only right after its run / exec verb: `npm run lint -- --fix git x` names a script
  // argument.
  if (out.length && k < w.length) {
    const head = out[out.length - 1].name;
    if (head !== 'git' && !DATA_HEADS.has(head) && !DECLARERS.has(head) && !FINDS.has(head)) {
      const pkg = PACKAGE_RUNNERS.has(head);
      for (let j = k + 1; j < w.length; j++) {
        if (pkg && !(PACKAGE_VERBS.has(dq(k + 1)) && (j === k + 2 || (j === k + 3 && dq(k + 2) === '--')))) continue;
        const word = dq(j);
        if ((word === 'git' || /^\/.*\/git$/.test(word)) && j + 1 < w.length && /^[A-Za-z-]/.test(dq(j + 1))) { cand(j, 'runner'); break; }
      }
    }
  }
  // `export G=git`: the declarer's assignments count like the leading ones
  if (out.length && DECLARERS.has(out[out.length - 1].name)) for (let j = k + 1; j < w.length; j++) noteAssign(assigns, events, w[j]);
  // every command word reads the words after it (its lazy `args`); a `find` -exec action's reads to its `;` / `+`
  if (!out.length || !FINDS.has(out[out.length - 1].name)) return out;
  for (let j = k + 1; j < w.length; j++) {
    if (!EXEC_ACTIONS.has(dq(j)) || j + 1 >= w.length) continue;
    const c = cand(j + 1, 'find');
    let e = j + 2;
    while (e < w.length && dq(e) !== ';' && dq(e) !== '+') e++;
    c.args = w.slice(j + 2, e);
    j = e;
  }
  return out;
}

// The index of the command word in an already-split word list (`words`, tokens as written): past `NAME=value` prefixes and
// every WRAPPERS word (and `uv run` / `poetry run` ...) with its own flags, their values and its operands - the ONE list
// the secret and read guards walk as well (2.1.6 seam review M2: the secret guard's own ten-row table missed doas, caffeinate,
// npx, `uv run`, xargs). `flagValues` names the one-letter flags of a wrapper that take a value; a wrapper with no row takes
// none, and a bare number is an operand (`caffeinate -t 5`). `eval` and `coproc` run their words as text, not as a command
// word, so a caller that reads them by name keeps them. `tokenize` splits an `env -S` string, spliced in place. At most 16
// wrappers, each word read once.
const WRAPPER_FLAGS = {
  timeout: { value: 'sk', long: /^--(?:signal|kill-after)$/, operands: 1 },
  gtimeout: { value: 'sk', long: /^--(?:signal|kill-after)$/, operands: 1 },
  env: { value: 'uCS', long: /^--(?:unset|chdir|split-string)$/, assigns: true, split: 'S' },
  nice: { value: 'n', long: /^--adjustment$/ },
  sudo: { value: 'ugCDhprtTU', long: /^--(?:user|group|close-from|chdir|host|prompt|role|type|command-timeout|other-user)$/, assigns: true },
  doas: { value: 'uC' },
  stdbuf: { value: 'ioe', long: /^--(?:input|output|error)$/ },
  ionice: { value: 'cnp', long: /^--(?:class|classdata|pid)$/ },
  time: { value: 'fo', long: /^--(?:format|output)$/ },
  exec: { value: 'a' },
  caffeinate: { value: 'tw' },
  xargs: { value: 'adEIiLnPsJ', long: /^--(?:arg-file|delimiter|eof|replace|max-lines|max-args|max-procs|max-chars)$/ },
  npx: { value: 'p', long: /^--(?:package|call)$/ },
};
const NOT_A_PREFIX = new Set(['eval', 'coproc']);
// The words that open a body or a group and run the command after them: a compound command's keywords, `!`, `{`, `(`.
const OPENERS = /^(?:if|then|elif|else|do|while|until|!|[({]+)$/;
// The index of the command word in `words`: past assignments, a body's keyword or a group's opener (seam delta 1: a
// subshell hid its commands from every guard - `groupsAsCuts` reads its parens as cuts for the guards that segment first),
// and every wrapper.
function commandIndex(words, tokenize = shellWords) {
  const wordOf = (t) => dequote(String(t == null ? '' : t));
  let k = 0;
  for (let n = 0; n < 16 && k < words.length; n++) {
    const w = wordOf(words[k]);
    if (OPENERS.test(w) || ASSIGN.test(w)) { k++; n--; continue; }
    const name = w.replace(/^.*[\\/]/, '');
    const run = RUN_TOOLS.has(name) && wordOf(words[k + 1]) === 'run';
    if (!run && (!WRAPPERS.has(name) || NOT_A_PREFIX.has(name))) break;
    const row = WRAPPER_FLAGS[name] || { value: '' };
    if (run) k++;
    for (k++; k < words.length; k++) {
      const a = wordOf(words[k]);
      if (a === '--') { k++; break; }
      if (row.assigns && ASSIGN.test(a)) continue;
      if (!/^-./.test(a)) break;
      let val = null;
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const flag = eq < 0 ? a : a.slice(0, eq);
        if (eq >= 0) val = a.slice(eq + 1); else if (row.long && row.long.test(flag)) val = wordOf(words[++k]);
        if (row.split && flag === '--split-string' && val !== null) words.splice(k + 1, 0, ...tokenize(val));
        continue;
      }
      for (let i = 1; i < a.length; i++) {
        if (!row.value.includes(a[i])) continue;
        val = i + 1 < a.length ? a.slice(i + 1) : wordOf(words[++k]);
        if (row.split === a[i]) words.splice(k + 1, 0, ...tokenize(val));
        break;
      }
    }
    k += row.operands || 0;
    while (k < words.length && /^\d[\w.]*$/.test(wordOf(words[k]))) k++; // a duration or count the wrapper reads
  }
  return k;
}
// A subshell or a group's own parens read as `;`, the same width: `(cd d && rm -rf x)` is `;cd d && rm -rf x;`, so a
// guard that cuts a command at its separators sees each command as a segment of its own, with no `(` glued to the
// first word and no `)` glued to the last (seam delta 1: a subshell hid its commands from every guard). A paren that
// belongs to a substitution (`$(`, `<(`, `>(`), an array assignment (`a=(`), an escape (`\(` of find) or a quoted span is
// text and stays, and so is the `)` that closes one. One pass, linear; a `)` with no `(` (a case pattern) reads as a cut.
function groupsAsCuts(text) {
  if (!/[()]/.test(text)) return text;
  const quoted = new Uint8Array(text.length);
  for (const [a, b] of quotedSpans(text)) quoted.fill(1, a, Math.min(b, text.length));
  const stack = [];
  let out = null;
  const cut = (i) => { if (out === null) out = text.split(''); out[i] = ';'; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (quoted[i]) continue;
    if (c === '(') {
      const kept = i > 0 && '$<>='.includes(text[i - 1]);
      stack.push(kept);
      if (!kept) cut(i);
    } else if (c === ')') {
      if (!stack.pop()) cut(i);
    }
  }
  return out === null ? text : out.join('');
}

// ---- cd, pushd, popd: where each later write lands ---------------------------------------------------------------
// `cd` / `pushd` earlier in the command move the anchor for everything after them. A target that cannot be followed
// (`cd -`, `cd $DIR`, a relative cd from an unknown place) makes the anchor unknown, and an unknown anchor judges
// nothing relative - never guess. PowerShell spells the same move Set-Location (sl, chdir) or Push-Location, a -Path /
// -LiteralPath name optional. The verbs are found as command words (the walker above), never by a regex scan from
// every separator: the old `(?:^|&&|...)\s*(?:cd|...)` crossed newlines, so a comment block rescanned to its end from
// every line (re-verify 3 R3-M3).
const CD_VERB = 'set-location|push-location|chdir|pushd|cd|sl';
const CD_VERBS = new Set(CD_VERB.split('|'));
const POPD_VERBS = new Set(['popd', 'pop-location']);
// The cds of a parsed command, in order: { 1: the target as written, dequoted; index; end: where the subshell it runs
// in closes (undefined at the top); pushd }, and a `popd` as { index, popd, end } (2.1.6 review m4).
function cdsOf(P) {
  const cds = [];
  for (const cmd of P.cmds) {
    for (const c of cmd.cands) {
      const verb = c.name.toLowerCase();
      if (POPD_VERBS.has(verb)) { cds.push({ index: cmd.words[c.at].s, popd: true, end: cmd.end }); continue; }
      if (!CD_VERBS.has(verb)) continue;
      let a = 0;
      while (a < c.argv.length && /^-[LPe@]+$/.test(c.argv[a])) a++; // `cd -P <dir>`
      if (a < c.argv.length && /^-(?:literal)?path$/i.test(c.argv[a])) a++;
      if (a >= c.argv.length) continue;
      cds.push({ 0: c.args[a].raw, 1: c.argv[a], index: cmd.words[c.at].s, end: cmd.end, pushd: verb === 'pushd' || verb === 'push-location' });
    }
  }
  return cds;
}
// The directory a path written at `index` resolves from: `root` moved by every cd before it, or null once a cd cannot
// be followed. `norm` turns a cd's target into a path (the guard adds its tilde and Git Bash mount spellings). A cd
// whose subshell - `( ... )`, `$( ... )`, a backtick pair - closed before `index` moved only that subshell, and a
// `popd` returns to the directory its `pushd` left (2.1.6 review m4). Compiled once per command (`anchorer`): the cds
// are folded in order with a stack of the subshells they run in, each state saved, so a query is a binary search plus
// the subshells that closed since - a fold per write made nested `cd sub && touch f` lines quadratic (R3-M3). A directory
// past MAX_PATH characters is no place a write can land (the kernel refuses the path) and resolving it again per `cd`
// is quadratic in the path itself: it becomes unknown, and `tooLong` names the cd that got there, which scanShell
// reports as unread.
const MAX_PATH = 4096;
const SIMPLE_DIR = /^[A-Za-z0-9_][A-Za-z0-9_.@+-]*$/; // one plain path component: joined without a resolve
function anchorer(cds, root, norm = unquote) {
  const at = [];
  const states = [];
  let tooLong = -1;
  let st = { cwd: root, pushed: null, frames: null };
  const popTo = (q, s) => {
    if (!s.frames || s.frames.end >= q) return s; // nothing closed since: the saved state stands
    let { cwd, pushed, frames } = s;
    while (frames && frames.end < q) { cwd = frames.cwd; pushed = frames.pushed; frames = frames.rest; }
    return { cwd, pushed, frames };
  };
  for (const c of cds) {
    st = popTo(c.index, st);
    let { cwd, pushed, frames } = st;
    if (c.end !== undefined && (!frames || frames.end !== c.end)) frames = { end: c.end, cwd, pushed, rest: frames };
    if (c.popd) {
      if (pushed) { cwd = pushed.dir; pushed = pushed.rest; }
    } else {
      if (c.pushd) pushed = { dir: cwd, rest: pushed };
      const t = norm(c[1]);
      if (t === '-' || isVar(t) || (cwd === null && !path.isAbsolute(t))) cwd = null;
      else if (SIMPLE_DIR.test(t) && path.isAbsolute(cwd)) cwd = cwd.endsWith(path.sep) ? cwd + t : cwd + path.sep + t;
      else if (t === '..' && path.isAbsolute(cwd)) cwd = path.dirname(cwd);
      else cwd = path.isAbsolute(t) ? path.resolve(t) : path.resolve(cwd, t);
      if (cwd !== null && cwd.length > MAX_PATH) { cwd = null; if (tooLong < 0) tooLong = c.index; }
    }
    st = { cwd, pushed, frames };
    at.push(c.index);
    states.push(st);
  }
  const f = (index) => {
    let lo = 0;
    let hi = at.length - 1;
    let k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (at[mid] < index) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k < 0 ? root : popTo(index, states[k]).cwd;
  };
  f.tooLong = tooLong;
  return f;
}
// anchorAt(cds, index, root, norm) - the same answer through a compiled anchorer, cached per (cds, norm, root): the
// callers query it once per write.
const anchorCache = new WeakMap();
function compiledAnchor(cds, root, norm = unquote) {
  let byNorm = anchorCache.get(cds);
  if (!byNorm) anchorCache.set(cds, (byNorm = new Map()));
  let byRoot = byNorm.get(norm);
  if (!byRoot) byNorm.set(norm, (byRoot = new Map()));
  let f = byRoot.get(root);
  if (!f) byRoot.set(root, (f = anchorer(cds, root, norm)));
  return f;
}
function anchorAt(cds, index, root, norm = unquote) {
  return compiledAnchor(cds, root, norm)(index);
}

// ---- the write rules ---------------------------------------------------------------------------------------------
// Only WRITE-shaped commands are considered, and only the paths they actually write to. Read-shaped commands (cat,
// grep, ls, find, git log/diff/show) are not listed at all. Each rule reads the words of its own command, found as a
// command word (so `tee` or `install` as a grep pattern or a folder name is no write, 2.1.6 review m1).
const GIT_READ_STASH = new Set(['list', 'show']);
// Does a git subcommand with these arguments change the checkout? `stash list` / `stash show` and the listing forms of
// `tag` (bare, -l, -n) are reads - flagging them as writes blocked honest investigation of the other repo.
function gitMutates(sub, argv) {
  switch (sub) {
    case 'commit': case 'add': case 'checkout': case 'switch': case 'merge': case 'rebase': case 'reset': case 'revert': case 'restore':
    case 'push': case 'pull': case 'apply': case 'am': case 'cherry-pick': case 'clean': case 'rm': case 'mv':
      return true;
    case 'stash': return !GIT_READ_STASH.has(argv[0]);
    case 'tag': return argv.length > 0 && !/^(?:-l|--list|-n)$/.test(argv[0]) && argv.some((a) => !a.startsWith('-'));
    case 'branch': return argv.length > 0 && /^-[dDm]/.test(argv[0]);
    default: return false;
  }
}
// Remove-Item's family deletes (the done gate counts it as a removal, like `rm`); the rest write.
const PS_REMOVE = new Set(['remove-item', 'ri', 'del', 'erase', 'rd']);
const PS_WRITE = new Set(['set-content', 'add-content', 'out-file', 'clear-content', 'new-item', 'ni', ...PS_REMOVE, 'move-item', 'mi', 'move',
  'copy-item', 'cpi', 'copy', 'rename-item', 'rni', 'ren']);
const PS_PATH_PARAMS = new Set(['path', 'literalpath', 'lp', 'pspath', 'filepath', 'destination']);
const PS_VALUE_PARAMS = new Set(['value', 'encoding', 'itemtype', 'type', 'filter', 'include', 'exclude', 'stream', 'credential',
  'delimiter', 'width', 'inputobject', 'newname', 'name', 'target', 'erroraction', 'ea', 'warningaction', 'wa', 'informationaction',
  'ia', 'errorvariable', 'ev', 'warningvariable', 'wv', 'outvariable', 'ov', 'outbuffer', 'ob', 'pipelinevariable', 'pv']);
// The paths one PowerShell write names: every -Path-like value and every positional argument.
function psTargets(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!w) continue;
    if (!w.startsWith('-')) { out.push(w); continue; }
    const colon = w.indexOf(':');
    const name = (colon === -1 ? w.slice(1) : w.slice(1, colon)).toLowerCase();
    const inline = colon === -1 ? null : w.slice(colon + 1);
    if (PS_PATH_PARAMS.has(name)) {
      if (inline !== null) { if (inline) out.push(inline); } else if (i + 1 < words.length) { out.push(words[i + 1]); i += 1; }
    } else if (PS_VALUE_PARAMS.has(name) && inline === null) {
      i += 1; // the parameter's value is data
    }
    // anything else is a switch (-Force, -Recurse, -Append, -Confirm:$false) and names no path
  }
  return out;
}
const FS_CHANGE = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'truncate', 'chmod', 'chown', 'rimraf']);
const COPY_VERBS = new Set(['cp', 'mv', 'ln', 'install', 'rsync']);
const IN_PLACE = /^-[A-Za-z]*i(?![A-Za-z0-9_])/;
const WRITE_REDIRS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
// `>&word` is `&>word` unless the word is a descriptor (`>&2`, `>&-`).
const isFileRedir = (r) => r.target && (WRITE_REDIRS.has(r.op) || (r.op === '>&' && !/^(?:\d+|-)$/.test(r.target.raw)));
// The target words of one command word, as { raw, index, what, verb }: `raw` dequoted, `index` where the command word
// (or the redirect) stands.
function writesOf(cmd, c, out) {
  const index = cmd.words[c.at].s;
  const name = c.name;
  const lower = name.toLowerCase();
  const verb = name === 'rimraf' ? 'rm' : name;
  const push = (raw, what, v = verb) => out.push({ raw, index, what, verb: v });
  const plain = (a) => a && !a.startsWith('-');
  if (name === 'tee') {
    for (const a of c.argv) if (plain(a)) push(a, 'a `tee` write');
  } else if ((name === 'sed' || name === 'perl') && c.argv.some((a) => IN_PLACE.test(a) || a === '--in-place' || a.startsWith('--in-place='))) {
    // in-place edits: every path argument, not just the last - `sed -i 's/a/b/' ../other/f x`
    for (const a of c.argv) if (plain(a) && !SED_SCRIPT.test(a) && !SED_SCRIPT_ARG.test(a)) push(a, 'an in-place edit');
  } else if (FS_CHANGE.has(name)) {
    // every argument counts: `rm -f a ../other/b`, `chmod +x ../other/x`
    for (const a of c.argv) if (plain(a) && !SED_SCRIPT.test(a)) push(a, 'a filesystem change');
  } else if (COPY_VERBS.has(name)) {
    const args = c.argv;
    // the destination ends the argument list; with `-t <dir>` / `--target-directory` it is named first (review M3)
    if (args.length >= 2 && plain(args[args.length - 1])) push(args[args.length - 1], 'a copy/move destination');
    if (name !== 'rsync') {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const long = /^--target-directory(?:=(.*))?$/.exec(a);
        if (long) { const v = long[1] !== undefined ? long[1] : args[i + 1]; if (v) push(v, 'a copy/move destination'); continue; }
        const short = /^-([A-Za-z]*?)t(.*)$/.exec(a);
        if (short && !a.startsWith('--') && /^[A-Za-z]*$/.test(short[1])) { const v = short[2] || args[i + 1]; if (v) push(v, 'a copy/move destination'); }
      }
    }
    // `mv` REMOVES its source, so an out-of-tree source is a write to that tree even when the destination is local
    if (name === 'mv') { const src = args.find(plain); if (src) push(src, 'a move OUT of another project'); }
  } else if (PS_WRITE.has(lower)) {
    const v = PS_REMOVE.has(lower) ? 'rm' : c.word.slice(c.word.lastIndexOf('/') + 1);
    for (const t of psTargets(c.argv)) push(t, 'a PowerShell write', v);
  } else if (name === 'git') {
    // `git -C <dir> <mutating subcommand>` is a write to that dir even with no path argument
    const call = gitCallOf(cmd, c);
    if (call.dirs.length && call.sub && gitMutates(call.sub, call.argv)) {
      const dir = call.dirs.reduce((acc, d) => (acc === null || path.isAbsolute(d) || isVar(d) ? d : path.join(acc, d)), null);
      push(dir, 'a git write in another checkout', 'git');
    }
  }
}

// ---- git calls: the ONE finder both guards read ------------------------------------------------------------------
// A git call is a command word that is git (normalised as above), and its global options are WALKED, one word at a
// time: `-C <dir>` / `-C<dir>`, `-c <key=value>`, `--git-dir` / `--work-tree` / `--namespace` with `=` or the next word,
// `--config-env=<key>=<var>`, and any other flag alone. The first word past them is the subcommand. Matching them with
// one regex let every option-like word be an option or the previous option's value, and every such word doubled the
// work (re-verify 3 R3-M4). A git word in an argument position - an echo, a file name, a grep pattern - is no call
// (R3-m7). Each call: { at (the git word), end (its list element's end), sub (normalised; null when none), subAt,
// subRaw, opaque (the subcommand is an expansion: `$C`, `$(...)`, a backtick), argv (the dequoted words after the
// subcommand), args (their tokens), dirs (-C values, in order), config (-c values), gitDir, workTree, configEnv,
// via (the wrapper before git: `xargs` makes the subcommand the input's), words (the tokens before the subcommand) }.
const GIT_VALUE_LONG = new Set(['--git-dir', '--work-tree', '--namespace', '--super-prefix']);
function gitCallOf(cmd, c) {
  const w = c.args;
  const argv = c.argv;
  const last = cmd.words[cmd.words.length - 1];
  const call = { at: cmd.words[c.at].s, cmd, cand: c, end: cmd.elem ? cmd.elem.to : undefined, stop: last ? last.e : cmd.words[c.at].e,
    sub: null, subAt: -1, subRaw: '', subEnd: -1, opaque: false, argv: [], args: [], dirs: [], config: [], configEnv: [], gitDir: null,
    workTree: null, via: c.via, xargs: c.chain.includes('xargs') };
  let k = 0;
  for (; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-C') { if (k + 1 < argv.length) call.dirs.push(argv[++k]); continue; }
    if (a.startsWith('-C') && a.length > 2 && !a.startsWith('--')) { call.dirs.push(a.slice(2)); continue; }
    if (a === '-c') { if (k + 1 < argv.length) call.config.push(argv[++k]); continue; }
    if (a.startsWith('-c') && a.length > 2 && !a.startsWith('--')) { call.config.push(a.slice(2)); continue; }
    if (a.startsWith('--config-env=')) { call.configEnv.push(a.slice(13)); continue; }
    const eq = a.indexOf('=');
    const long = eq < 0 ? a : a.slice(0, eq);
    if (GIT_VALUE_LONG.has(long)) {
      const v = eq < 0 ? (k + 1 < argv.length ? argv[++k] : '') : a.slice(eq + 1);
      if (long === '--git-dir') call.gitDir = v; else if (long === '--work-tree') call.workTree = v;
      continue;
    }
    if (a.startsWith('-')) continue;
    break;
  }
  if (k < argv.length) {
    const raw = w[k].raw;
    call.subRaw = raw;
    call.subAt = w[k].s;
    call.subEnd = w[k].e;
    call.opaque = /[$`]/.test(raw);
    call.sub = FOLDS_CASE ? argv[k].toLowerCase() : argv[k];
    call.argv = argv.slice(k + 1);
    call.args = w.slice(k + 1);
  }
  return call;
}
// Every git call of a command, in order. `text` is parsed the way scanShell parses it (heredoc bodies and comments
// blanked); `P` reuses a parse. The text may carry scripts appended after it (the commit guard's `withCarried`).
function gitCalls(text, P) {
  const parsed = P || parseShell(joinContinuations(blankComments(blankHeredocs(String(text || '')))));
  const out = [];
  for (const cmd of parsed.cmds) for (const c of cmd.cands) if (c.name === 'git') out.push(gitCallOf(cmd, c));
  return out.sort((a, b) => a.at - b.at);
}
// Every command word of a command, in order - { at, name, argv, via, cmd } - for a caller that looks for one verb
// (the commit guard's `gh pr merge`, the cross guard's probe).
function commandWords(text, P) {
  const parsed = P || parseShell(joinContinuations(blankComments(blankHeredocs(String(text || '')))));
  const out = [];
  for (const cmd of parsed.cmds) for (const c of cmd.cands) out.push({ at: cmd.words[c.at].s, name: c.name, argv: c.argv, via: c.via, chain: c.chain, cmd, cand: c });
  return out.sort((a, b) => a.at - b.at);
}

// ---- interpreter scripts -----------------------------------------------------------------------------------------
// An INTERPRETER with an inline script is a write route the rules above CANNOT see, and the reason is structural: a
// script body is always inside quotes (`node -e "…"`) or inside a heredoc, whose body is blanked as data. So it is read
// HERE, on the raw text. Measured as a blocked/allowed PAIR on one operation five seconds apart in the same session -
// the shell `rm -f "$B"/*/x` denied, the identical unlink through `python3 - <<'PY' … f.unlink()` allowed. Mirrors
// guard-read-whole-file.js's `runtimeDump`. Only a body actually FED to an interpreter is read: a heredoc going to
// `cat > plan.md` stays inert prose. And only a LITERAL path is taken - an interpolated or computed one is left alone.
// The runtime must be a COMMAND word (past sudo, env, a path spelling, or behind `uv run` / `poetry run`), never a
// runtime word anywhere before the `<<` on its line: `cat > run-node.txt <<'EOF'` read the file's text as node code
// (2.1.6 misc report, concern 1). A heredoc counts when a stage of the pipeline its `<<` opens is a runtime (`cat
// <<'PY' | python3` too). An inline script is the WHOLE argument after its flag (`-e`, `-c`, `-p`, `--eval`,
// `--print`, `-Command`, a perl or ruby cluster ending in one), read quote-aware.
const INTERP = /^(?:python[\d.]*|node|nodejs|ruby|perl|php|deno|bun|osascript|pwsh|powershell)$/;
const SCRIPT_FLAG = /^(?:-[A-Za-z]*[eEcr]|-p|--eval|--print|-Command|-command)$/;
// The shell words after `from` up to the command's end, each unquoted: a double-quoted word drops its escapes (`\"` is
// `"`), a single-quoted or `$'...'` one is taken as written.
function wordsFrom(text, from) {
  const words = [];
  let cur = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || (c === '$' && text[i + 1] === "'")) {
      if (c === '$') i++;
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end;
      cur = (cur || '') + text.slice(i + 1, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      cur = cur || '';
      for (i++; i < text.length && text[i] !== '"'; i++) cur += text[i] === '\\' && i + 1 < text.length ? text[++i] : text[i];
      continue;
    }
    if (c === '\\' && i + 1 < text.length) { cur = (cur || '') + text[++i]; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === ')' || c === '<' || c === '>') break;
    if (c === ' ' || c === '\t' || c === '\r') { if (cur !== null) { words.push(cur); cur = null; } continue; }
    cur = (cur || '') + c;
  }
  if (cur !== null) words.push(cur);
  return words;
}
const LIT = String.raw`(["'])([^"'\n]+)\1`;
const DESTRUCTIVE = 'write_text|write_bytes|unlink|mkdir|rmdir|rename|replace|touch|chmod';
// a write verb whose FIRST argument is the path
const WRITE_CALL = new RegExp(String.raw`\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile|unlinkSync|unlink|rmSync|rmdirSync|rmdir|mkdirSync|mkdir|makedirs|removedirs|renameSync|rename|copyFileSync|copyfile|copy2|truncateSync|truncate|chmodSync|chmod|remove|rmtree|move|touch)\s*\(\s*${LIT}`, 'g');
// `open(path, 'w')` - a bare `open(path)` is a READ; the mode is read as one quoted word, then tested
const OPEN_CALL = new RegExp(String.raw`\b(?:open|fopen)\s*\(\s*${LIT}\s*,\s*(["'])([^"'\n]*)\3`, 'g');
// pathlib, chained: `Path('…').write_text(…)`
const PATH_CALL = new RegExp(String.raw`\bPath\s*\(\s*${LIT}\s*\)\s*\.\s*(?:${DESTRUCTIVE})\b`, 'g');
// `f = Path('…')` … `f.unlink()` - the literal and the destructive call are statements apart, so the binding is
// followed by NAME; every receiver of a destructive call is collected once, then each binding is looked up in it.
const PATH_BIND = /(\w+)\s*=\s*(?:pathlib\.)?Path\s*\(\s*(["'])([^"'\n]+)\2/g;
const DESTROYED = new RegExp(String.raw`(\w+)\s*\.\s*(?:${DESTRUCTIVE})\b`, 'g');
function interpreterTargets(raw, P, heredocs) {
  const scripts = [];
  const runtimes = [];
  for (const cmd of P.cmds) for (const c of cmd.cands) if (INTERP.test(c.name)) runtimes.push({ cmd, c, at: cmd.words[c.at].s });
  if (!runtimes.length) return [];
  const runElems = new Set(runtimes.map((r) => r.cmd.elem));
  // a heredoc fed to a pipeline one of whose stages is a runtime: the heredoc's own command is in that element
  const heredocCmd = heredocOwners(P, heredocs);
  for (const h of heredocs) {
    const owner = heredocCmd.get(h.index);
    if (owner && runElems.has(owner.elem)) scripts.push({ body: bodyOf(raw, h), index: h.index });
  }
  // `node -e "…"` / `python3 -c '…'` - the whole script argument after its flag
  for (const r of runtimes) {
    const words = wordsFrom(raw, r.cmd.words[r.c.at].e);
    for (let i = 0; i < words.length - 1; i++) {
      if (SCRIPT_FLAG.test(words[i]) && !words[i + 1].startsWith('-')) scripts.push({ body: words[i + 1], index: r.at });
    }
  }
  const out = [];
  const literal = (p, index) => {
    if (/[${]/.test(p)) return; // interpolated - the path is computed, don't guess
    out.push({ raw: p, index, what: 'an interpreter write', verb: 'interpreter' });
  };
  for (const { body, index } of scripts) {
    for (const m of body.matchAll(WRITE_CALL)) literal(m[2], index);
    for (const m of body.matchAll(OPEN_CALL)) if (/[wax+]/.test(m[4])) literal(m[2], index);
    for (const m of body.matchAll(PATH_CALL)) literal(m[2], index);
    const destroyed = new Set([...body.matchAll(DESTROYED)].map((d) => d[1]));
    for (const b of body.matchAll(PATH_BIND)) if (destroyed.has(b[1])) literal(b[3], index);
  }
  return out;
}
// The simple command each heredoc opener belongs to, keyed by the opener's index.
function heredocOwners(P, heredocs) {
  const owners = new Map();
  if (!heredocs.length) return owners;
  const wanted = new Set(heredocs.map((h) => h.index));
  for (const cmd of P.cmds) for (const r of cmd.redirs) if ((r.op === '<<' || r.op === '<<-') && wanted.has(r.at)) owners.set(r.at, cmd);
  return owners;
}

// ---- shell text carried into a shell: the ONE home (review w24, re-verify N2 / N4, re-verify 2 R2-M5, re-verify 3 R3-m4)
// A LITERAL script handed to a shell runs as shell, and so does a script FILE a shell runs. Each carried script comes
// back as { text, at, end, mapped, cwd, sourced }: `mapped` when the text sits verbatim in the command at `at` (the -c
// form, read raw); otherwise it is derived or read from disk, `at` is the running word's own position and `end` where
// its list element ends. `cwd` is the directory the script runs from (the caller's cwd moved by every cd before it;
// null when no cwd was given or a cd cannot be followed). `sourced` marks a script run in the CURRENT shell (`.`,
// `source`, `eval`), whose cds outlive it. A script the reader CANNOT read is not dropped: it is named in the run's
// `unread` list ({ at, why, path }) and every caller judges it conservatively. The shapes:
//   - `sh -c '<script>'` (bash, zsh, dash, ksh, fish too), long options and `-o <name>` before the `-c`;
//   - `eval '<words>'`, its words joined;
//   - a shell with no -c and no script file, reading stdin: a heredoc, a here-string, `< <file>`, or the stage before
//     its pipe - an `echo`, a `printf` (its format cycled over its arguments, as the builtin does), a `cat <file>` -
//     past any `tee` or bare `cat` stage between them, which pass their input through;
//   - a script FILE: `bash <file>`, `. <file>` / `source <file>`, and a file run by its path (`./fix.sh`) whose first
//     line names a shell or no interpreter at all. A glob names the file it expands to first, as the shell does;
//   - `make [target]` (the target's recipe and those of its prerequisites, each line in a shell of its own, from the
//     Makefile's directory) and `npm run` / `npm test` / `pnpm` / `yarn` / `bun run` (the package.json script, with its
//     `pre` and `post` scripts, from the package's directory) - a script the command names by a name;
//   - a file the same command wrote first - a heredoc into it, an `echo` / `printf` / `cat` redirected to it, a `tee`
//     at the end of a pipe, a `cp` / `mv` / `install` of another script - is read from that text instead.
// A file is read only as a regular text file (a NUL in its first line is a binary the shell will not run; a NUL later
// is dropped, as bash drops it), resolved against a cwd unless its path is absolute. A shell told not to run its
// script (`-n`, `-o noexec`) and `make -n` carry none. What `curl` or any other command prints does not exist until
// that command runs, so nothing here reads it - the same as `sh -c "$(printf ...)"`.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
// Does a `#!` line run a shell? Its interpreter word, or the word `env` runs past its own flags, names one.
function shebangShell(line) {
  const words = line.slice(2).trim().split(/[ \t]+/);
  let k = 0;
  const base = (w) => String(w || '').slice(String(w || '').lastIndexOf('/') + 1);
  if (base(words[k]) === 'env') { k++; while (k < words.length && words[k].startsWith('-')) k++; }
  return SHELLS.has(base(words[k]));
}
const normPath = (t) => {
  const s = String(t);
  const c = s[0];
  if (c !== '~' && c !== '"' && c !== "'" && s[s.length - 1] !== '"' && s[s.length - 1] !== "'" && process.platform !== 'win32') return s;
  return nativePath(unquote(s).replace(/^~(?=\/|$)/, homeDir()));
};
const GLOB_CHARS = /[*?[]/;
// Wildcard match of one path segment, two pointers - never a regex built from the pattern (a pattern of stars is the
// nested-quantifier shape this file removes). `*` and `?` never match a leading dot, `[...]` a class with ranges.
function globMatch(pat, name) {
  if (name.startsWith('.') && !pat.startsWith('.')) return false;
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  const cls = (at, ch) => { // returns [matched, next index] for a class at pat[at] === '['
    let i = at + 1;
    const neg = pat[i] === '!' || pat[i] === '^';
    if (neg) i++;
    let hit = false;
    let first = true;
    for (; i < pat.length && (first || pat[i] !== ']'); i++, first = false) {
      if (pat[i + 1] === '-' && pat[i + 2] && pat[i + 2] !== ']') { if (ch >= pat[i] && ch <= pat[i + 2]) hit = true; i += 2; } else if (pat[i] === ch) hit = true;
    }
    return i < pat.length ? [hit !== neg, i + 1] : [pat[at] === ch, at + 1];
  };
  while (s < name.length) {
    if (p < pat.length && pat[p] === '*') { star = p++; mark = s; continue; }
    if (p < pat.length && pat[p] === '?') { p++; s++; continue; }
    if (p < pat.length && pat[p] === '[') { const [ok, next] = cls(p, name[s]); if (ok) { p = next; s++; continue; } }
    else if (p < pat.length && (pat[p] === '\\' ? pat[p + 1] === name[s] : pat[p] === name[s])) { p += pat[p] === '\\' ? 2 : 1; s++; continue; }
    if (star < 0) return false;
    p = star + 1;
    s = ++mark;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

// Every pass over a parse's commands asks the budget each 1024 commands; past it, the commands from there on are
// unread (true when it stopped the pass).
const cmdAt = (cmd) => (cmd.words.length ? cmd.words[0].s : (cmd.redirs.length ? cmd.redirs[0].at : 0));
function lateHere(run, k, cmd, where) {
  if ((k & 1023) !== 1023 || !run.budget.over()) return false;
  run.unread.push({ at: cmdAt(cmd), why: run.budget.why, path: where || null });
  return true;
}
// One scan RUN: the budget, the unread list, and the caches every nested scan and alias pass shares.
function newRun(opts = {}) {
  return {
    budget: opts.budget || scanBudget(),
    unread: [],
    listing: new Map(),
    stats: new Map(),
    files: new Map(),
    aliasTables: new Map(),
    spawns: 0,
    packages: new Map(),
    makefiles: new Map(),
    real: new Map(),
    aliasAdded: 0,
  };
}
const listDir = (run, dir) => {
  if (run.listing.has(dir)) return run.listing.get(dir);
  let names = null;
  try { names = new Set(fs.readdirSync(dir)); } catch { names = null; }
  run.listing.set(dir, names);
  return names;
};
// A path's stat, once per run (null when it is not there) - a stat that does not throw, since a script naming
// thousands of paths that do not exist made each miss an exception, and listing a directory to answer it read the
// whole OS temp directory once per scan.
const statOf = (run, p) => {
  if (run.stats.has(p)) return run.stats.get(p);
  let st = null;
  try { st = fs.statSync(p, { throwIfNoEntry: false }) || null; } catch { st = null; }
  run.stats.set(p, st);
  return st;
};
const exists = (run, p) => !!statOf(run, p);
const isDir = (run, p) => { const st = statOf(run, p); return !!st && st.isDirectory(); };
// A file a shell would run: a regular text file, read whole under the scan budget. Run by its path, only one whose
// first line names a shell, or no interpreter at all (the calling shell runs it then). Returns { text }, { unread, path,
// why } or null (not a script: missing, a directory, a binary, another interpreter).
const SCRIPT_CHUNK = 64 * 1024;
function readScript(run, abs, direct) {
  const key = `${direct ? 'x' : 'r'}${abs}`;
  if (run.files.has(key)) return run.files.get(key);
  let res = null;
  let fd;
  try {
    const st = statOf(run, abs);
    if (st) {
      if (st.isFile()) {
        fd = fs.openSync(abs, 'r');
        const head = Buffer.alloc(Math.min(st.size, 4096));
        fs.readSync(fd, head, 0, head.length, 0);
        const nl = head.indexOf(10);
        const firstLine = head.subarray(0, nl < 0 ? head.length : nl);
        if (!firstLine.includes(0)) {
          const first = firstLine.toString('utf8');
          if (!(direct && first.startsWith('#!') && !shebangShell(first))) {
            // Read to the first NUL byte and charge what was read, once: a self-extracting installer is a shell head and
            // a binary payload, and the payload is no script text (2.1.6 re-verify 4 R4-m2).
            const chunks = [];
            let over = false;
            for (let pos = 0; ; pos += SCRIPT_CHUNK) {
              const b = Buffer.alloc(SCRIPT_CHUNK);
              const n = fs.readSync(fd, b, 0, SCRIPT_CHUNK, pos);
              if (n <= 0) break;
              const nul = b.subarray(0, n).indexOf(0);
              const used = nul < 0 ? n : nul;
              if (!run.budget.take(used)) { over = true; break; }
              chunks.push(b.subarray(0, used));
              if (nul >= 0) break;
            }
            res = over ? { unread: true, path: abs, why: run.budget.why } : { text: Buffer.concat(chunks).toString('utf8') };
          }
        }
      }
    }
  } catch { res = null; } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  run.files.set(key, res);
  return res;
}
// What `echo` and `printf` print: echo's words joined (its -n / -e / -E flags dropped, `\n` read as the newline a dash
// `echo` prints); printf's format cycled over its arguments - `%s` takes one as written, `%b` with its escapes, `%%` is a
// percent - until they run out (`printf -v` prints nothing).
function echoOut(words) {
  const w = words.slice();
  while (w.length && /^-[neE]+$/.test(w[0])) w.shift();
  return w.join(' ').replace(/\\n/g, '\n');
}
function printfOut(words) {
  const w = words.slice();
  if (w[0] === '--') w.shift();
  if (!w.length || w[0] === '-v') return '';
  const format = unescape(w[0]);
  const args = w.slice(1);
  let out = '';
  let i = 0;
  for (let pass = 0; pass < 1000; pass++) {
    let used = false;
    out += format.replace(/%(%|[-+ #0]*\d*(?:\.\d+)?[sbdiouxXcqeEfgG])/g, (m, spec) => {
      if (spec === '%') return '%';
      used = true;
      const a = i < args.length ? args[i++] : '';
      return spec.endsWith('b') ? unescape(a) : a;
    });
    if (!used || i >= args.length) break;
  }
  return out;
}

// ---- package scripts and make recipes ----------------------------------------------------------------------------
const PKG_RUN = { npm: new Set(['run', 'run-script', 'rum', 'urn']), pnpm: new Set(['run', 'run-script']), yarn: new Set(['run']), bun: new Set(['run']) };
const PKG_LIFECYCLE = new Set(['test', 't', 'tst', 'start', 'stop', 'restart']);
const PKG_BUILTIN = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'exec', 'dlx', 'x', 'create',
  'init', 'link', 'unlink', 'publish', 'pack', 'version', 'view', 'info', 'ls', 'list', 'outdated', 'why', 'audit', 'config', 'set', 'get',
  'cache', 'login', 'logout', 'whoami', 'help', 'bin', 'root', 'prefix', 'dedupe', 'prune', 'rebuild', 'store', 'workspace', 'workspaces',
  'import', 'patch', 'patch-commit', 'env', 'fetch', 'node', 'global', 'tag', 'dist-tag', 'owner', 'team', 'token', 'profile', 'search',
  'doctor', 'explain', 'fund', 'query', 'repo', 'docs', 'bugs', 'edit', 'explore', 'shrinkwrap', 'star', 'unstar', 'stars', 'deprecate',
  'access', 'hook', 'org', 'ping', 'completion', 'plugin', 'constraints', 'dedupe', 'npm', 'set-script', 'pkg', 'sbom', 'diff', 'test', 'build']);
// The nearest package.json at or above `dir`: { dir, scripts, workspaces } or null.
function packageAt(run, dir) {
  const visited = []; // every directory walked through answers the same, cached for the next call
  let res = null;
  for (let d = dir, i = 0; i < 64; i++) {
    if (run.packages.has(d)) { res = run.packages.get(d); break; }
    visited.push(d);
    const file = path.join(d, 'package.json');
    const st = statOf(run, file);
    if (st && st.isFile()) {
      try {
        if (run.budget.take(st.size)) {
          const j = JSON.parse(fs.readFileSync(file, 'utf8'));
          res = { dir: d, file, scripts: j && typeof j.scripts === 'object' && j.scripts ? j.scripts : {}, name: j && j.name, workspaces: j && j.workspaces };
        } else res = { dir: d, file, unread: true, why: run.budget.why };
      } catch { res = { dir: d, file, scripts: {} }; }
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const v of visited) run.packages.set(v, res);
  return res;
}
// The workspace directories of a package: its `workspaces` (an array or { packages }) or a pnpm-workspace.yaml `packages:`
// list, each pattern a directory, `dir/*` or `dir/**` (one level, then one more). Past 256 directories: null (unread).
function workspaceDirs(run, pkg) {
  let pats = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && Array.isArray(pkg.workspaces.packages) ? pkg.workspaces.packages : null);
  if (!pats) {
    try {
      const y = fs.readFileSync(path.join(pkg.dir, 'pnpm-workspace.yaml'), 'utf8');
      const lines = y.split(/\r?\n/);
      const at = lines.findIndex((l) => /^packages:[ \t]*$/.test(l));
      if (at >= 0) {
        pats = [];
        for (let i = at + 1; i < lines.length && /^[ \t]*-/.test(lines[i]); i++) pats.push(lines[i].replace(/^[ \t]*-[ \t]*/, '').replace(/^['"]|['"]$/g, '').trim());
        pats = pats.filter(Boolean);
      }
    } catch { /* no pnpm workspace file */ }
  }
  if (!pats) return [];
  const out = [];
  for (const pat of pats) {
    if (pat.startsWith('!')) continue;
    const parts = pat.replace(/\/+$/, '').split('/');
    let dirs = [pkg.dir];
    for (const part of parts) {
      const next = [];
      for (const d of dirs) {
        if (part === '**') { next.push(d); for (const e of listDir(run, d) || []) next.push(path.join(d, e)); continue; }
        if (!GLOB_CHARS.test(part)) { next.push(path.join(d, part)); continue; }
        for (const e of listDir(run, d) || []) if (globMatch(part, e)) next.push(path.join(d, e));
      }
      dirs = next;
      if (dirs.length > 256) return null;
    }
    for (const d of dirs) { const names = listDir(run, d); if (names && names.has('package.json')) out.push(d); }
    if (out.length > 256) return null;
  }
  return out;
}
// The shell text a package-manager call runs, as [{ text, cwd, at }] - or { unread, path, why } when the call names
// scripts the reader cannot place (a workspace it cannot resolve).
function packageRun(run, name, argv, cwd) {
  let dir = cwd;
  let k = 0;
  let ws = null;
  let allWs = false;
  const takeDir = (v) => { if (v && !isVar(v)) dir = path.resolve(dir, normPath(v)); };
  for (; k < argv.length && argv[k].startsWith('-'); k++) {
    const a = argv[k];
    const eq = a.indexOf('=');
    const key = eq < 0 ? a : a.slice(0, eq);
    const val = () => (eq < 0 ? argv[++k] : a.slice(eq + 1));
    if (key === '--prefix' || key === '-C' || key === '--dir' || key === '--cwd') takeDir(val());
    else if (key === '-w' || key === '--workspace' || key === '--filter' || key === '-F') ws = val();
    else if (key === '-ws' || key === '--workspaces' || key === '-r' || key === '--recursive') allWs = true;
    else if (eq < 0 && /^--(?:loglevel|registry|userconfig|cache|reporter)$/.test(a)) k++;
  }
  let sub = argv[k];
  if (name === 'yarn' && sub === 'workspace') { ws = argv[k + 1]; k += 2; sub = argv[k]; }
  if (!sub) return [];
  let script;
  if (PKG_RUN[name] && PKG_RUN[name].has(sub)) { script = argv[k + 1]; k += 2; } else if (PKG_LIFECYCLE.has(sub) && name !== 'bun') { script = sub === 't' || sub === 'tst' ? 'test' : sub; k += 1; } else if (name !== 'npm' && !PKG_BUILTIN.has(sub)) { script = sub; k += 1; } else return [];
  if (!script || script.startsWith('-')) return [];
  // what follows the script name - after `--`, or directly (pnpm, yarn, bun) - is handed to it
  let rest = argv.slice(k);
  for (let j = 0; j < rest.length; j++) if (rest[j].startsWith('-') && rest[j] !== '--' && !rest.includes('--')) { if (name === 'npm') { rest = []; break; } }
  if (rest[0] === '--') rest = rest.slice(1);
  const extra = rest.length ? ` ${rest.map((r) => `'${r.replace(/'/g, "'\\''")}'`).join(' ')}` : '';
  const root = packageAt(run, dir);
  if (!root) return [];
  if (root.unread) return { unread: true, path: root.file, why: root.why };
  let pkgs = [root];
  if (ws || allWs) {
    const dirs = workspaceDirs(run, root);
    if (dirs === null) return { unread: true, path: root.file, why: 'a workspace list past 256 packages' };
    const all = dirs.map((d) => packageAt(run, d)).filter(Boolean);
    if (allWs) pkgs = all;
    else {
      const byPath = path.resolve(dir, normPath(ws));
      pkgs = all.filter((p) => p.dir === byPath || p.name === ws);
      if (!pkgs.length) return { unread: true, path: root.file, why: `the workspace '${ws}' it could not resolve` };
    }
  }
  const out = [];
  for (const p of pkgs) {
    if (p.unread) return { unread: true, path: p.file, why: p.why };
    for (const s of [`pre${script}`, script, `post${script}`]) {
      const body = p.scripts[s];
      if (typeof body === 'string' && body.trim()) out.push({ text: `${body}${s === script ? extra : ''}`, cwd: p.dir });
    }
  }
  return out;
}
// A Makefile: its rules { targets -> { prereqs, recipe[] } }, its first target, and its simple variables. `include`
// lines are followed (literal paths, 3 deep); a file the budget cannot hold is unread.
function makefileOf(run, file, depth = 0) {
  if (run.makefiles.has(file)) return run.makefiles.get(file);
  let res = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) res = null;
    else if (!run.budget.take(st.size)) res = { unread: true, path: file, why: run.budget.why };
    else {
      const lines = fs.readFileSync(file, 'utf8').replace(/\\\r?\n/g, ' ').split(/\r?\n/);
      const rules = new Map();
      const vars = new Map();
      let first = null;
      let current = null;
      let includesUnread = false;
      for (const line of lines) {
        if (line.startsWith('\t')) { if (current) for (const r of current) r.recipe.push(line.slice(1)); continue; }
        const text = line.replace(/(^|[^\\])#.*$/, '$1');
        if (!text.trim()) continue;
        current = null;
        const inc = /^[ \t]*-?include[ \t]+(.+)$/.exec(text);
        if (inc) {
          for (const f of inc[1].trim().split(/[ \t]+/)) {
            if (/[$*?[]/.test(f) || depth >= 3) { includesUnread = true; continue; }
            const sub = makefileOf(run, path.resolve(path.dirname(file), f), depth + 1);
            if (!sub || sub.unread) { if (sub && sub.unread) includesUnread = true; continue; }
            for (const [t, r] of sub.rules) if (!rules.has(t)) rules.set(t, r);
            for (const [k, v] of sub.vars) if (!vars.has(k)) vars.set(k, v);
            if (!first) first = sub.first;
          }
          continue;
        }
        const v = /^[ \t]*(?:override[ \t]+|export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*(?:::=|:=|\?=|\+=|!=|=)[ \t]*(.*)$/.exec(text);
        if (v && !/^[^=]*:[^=]/.test(text.slice(0, text.indexOf('=')) + ' ')) { vars.set(v[1], v[2].trim()); continue; }
        const r = /^([^:=#\t][^:=#]*?)[ \t]*::?(?!=)(.*)$/.exec(text);
        if (!r) continue;
        const semi = r[2].indexOf(';');
        const prereqs = (semi < 0 ? r[2] : r[2].slice(0, semi)).trim().split(/[ \t]+/).filter(Boolean).filter((p) => p !== '|');
        current = [];
        for (const t of r[1].trim().split(/[ \t]+/)) {
          if (!t) continue;
          const rule = rules.get(t) || { prereqs: [], recipe: [] };
          rule.prereqs.push(...prereqs);
          if (semi >= 0) rule.recipe.push(r[2].slice(semi + 1));
          rules.set(t, rule);
          current.push(rule);
          if (!first && !t.startsWith('.') && !t.includes('%')) first = t;
        }
      }
      res = { rules, vars, first, includesUnread, dir: path.dirname(file), path: file };
    }
  } catch { res = null; }
  run.makefiles.set(file, res);
  return res;
}
// The shell text `make` runs: each recipe line in its own subshell, prerequisites first, `$(VAR)` read from the file's
// simple variables, `$$` a dollar, `$@` / `$<` / `$^` the rule's own names. `make -n` runs nothing.
function makeRun(run, argv, cwd) {
  let dir = cwd;
  let file = null;
  const goals = [];
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-C' || a === '--directory') { const v = argv[++k]; if (v && !isVar(v)) dir = path.resolve(dir, normPath(v)); continue; }
    if (a.startsWith('--directory=')) { dir = path.resolve(dir, normPath(a.slice(12))); continue; }
    if (a.startsWith('-C') && a.length > 2 && !a.startsWith('--')) { dir = path.resolve(dir, normPath(a.slice(2))); continue; }
    if (a === '-f' || a === '--file' || a === '--makefile') { file = argv[++k]; continue; }
    if (/^--(?:file|makefile)=/.test(a)) { file = a.slice(a.indexOf('=') + 1); continue; }
    if (/^-[A-Za-z]*n/.test(a) && !a.startsWith('--') || /^--(?:just-print|dry-run|recon)$/.test(a)) return [];
    if (a === '-I' || a === '-o' || a === '-W' || a === '--include-dir' || a === '--old-file' || a === '--what-if') { k++; continue; }
    if (a === '-j' || a === '-l') { if (/^\d+$/.test(argv[k + 1] || '')) k++; continue; }
    if (a.startsWith('-') || ASSIGN.test(a)) continue;
    goals.push(a);
  }
  let mf = null;
  if (file) mf = makefileOf(run, path.resolve(dir, normPath(file)));
  else for (const f of ['GNUmakefile', 'makefile', 'Makefile']) if (exists(run, path.join(dir, f))) { mf = makefileOf(run, path.join(dir, f)); break; }
  if (!mf) return [];
  if (mf.unread) return { unread: true, path: mf.path, why: mf.why };
  if (!goals.length && mf.first) goals.push(mf.first);
  const lines = [];
  const seen = new Set();
  let missing = false;
  const expand = (text, target, rule) => {
    let t = text.replace(/\$\$/g, '\u0000');
    for (let pass = 0; pass < 5 && /\$[({@<^]/.test(t); pass++) {
      t = t.replace(/\$@/g, target).replace(/\$</g, rule.prereqs[0] || '').replace(/\$\^/g, rule.prereqs.join(' '))
        .replace(/\$\(([A-Za-z_][\w.-]*)\)|\$\{([A-Za-z_][\w.-]*)\}/g, (m, a, b) => {
          const k = a || b;
          if (k === 'MAKE' || k === 'MAKE_COMMAND') return 'make';
          if (k === 'CURDIR') return mf.dir;
          return mf.vars.has(k) ? mf.vars.get(k) : m;
        });
    }
    return t.replace(/\u0000/g, '$');
  };
  const walk = (target, d) => {
    if (seen.has(target) || seen.size > 256 || d > 32) return;
    seen.add(target);
    const rule = mf.rules.get(target);
    if (!rule) { if (mf.includesUnread) missing = true; return; }
    for (const p of rule.prereqs) walk(p, d + 1);
    for (const line of rule.recipe) {
      const body = line.replace(/^[ \t@+-]+/, '');
      if (body.trim()) lines.push(`( ${expand(body, target, rule)} )`);
    }
  };
  for (const g of goals) walk(g, 0);
  if (missing) return { unread: true, path: mf.path, why: 'a target from an include it could not read' };
  return lines.length ? [{ text: lines.join('\n'), cwd: mf.dir }] : [];
}

// The files this command writes a script into, keyed by absolute path, each with where it is written, so only a run
// after the write reads it: a heredoc into a redirect or a `tee` on its own line or at the end of its pipe; an `echo`,
// `printf` or `cat` redirected to it; a `tee` fed by such a stage; a `cp` / `mv` / `install` of another script (a
// directory destination takes the source's name). `>>` / `tee -a` add to what the file already holds.
function writtenScripts(P, raw, heredocs, anchor, run) {
  const out = new Map();
  const owners = heredocOwners(P, heredocs);
  const docOf = new Map();
  for (const h of heredocs) { const cmd = owners.get(h.index); if (cmd && !docOf.has(cmd)) docOf.set(cmd, h); }
  const absOf = (word, at) => {
    const base = anchor(at);
    const p = normPath(word);
    if (isVar(p) || (!path.isAbsolute(p) && base === null)) return null;
    return path.resolve(base || '/', p);
  };
  const current = (abs) => (out.has(abs) ? out.get(abs).text : ((readScript(run, abs) || {}).text || ''));
  const put = (word, at, text, append) => {
    const abs = absOf(word, at);
    if (!abs || typeof text !== 'string') return;
    out.set(abs, { at, text: (append ? current(abs) : '') + text });
  };
  const readOf = (word, at) => { const abs = absOf(word, at); return abs ? current(abs) : null; };
  // what one simple command prints to its stdout, when the text alone says: echo, printf, cat of files or a heredoc
  const printed = (cmd) => {
    const c = cmd.cands[0];
    if (!c) return null;
    const at = cmd.words[c.at].s;
    if (c.name === 'echo') return echoOut(wordsFrom(raw, cmd.words[c.at].e));
    if (c.name === 'printf') return printfOut(wordsFrom(raw, cmd.words[c.at].e));
    if (c.name === 'cat') {
      const files = c.argv.filter((a) => a && !a.startsWith('-'));
      const h = docOf.get(cmd);
      if (!files.length) return h ? bodyOf(raw, h) : null;
      let text = '';
      for (const f of files) { const t = readOf(f, at); if (t === null) return null; text += t; }
      return text;
    }
    return null;
  };
  for (const el of P.elems) {
    const stages = el.cmds;
    for (let i = 0; i < stages.length; i++) {
      const cmd = stages[i];
      const c = cmd.cands[0];
      const at = c ? cmd.words[c.at].s : (cmd.redirs[0] ? cmd.redirs[0].at : el.from);
      const h = docOf.get(cmd);
      // a redirect of this stage's own output into a file
      for (const r of cmd.redirs) {
        if (!(r.op === '>' || r.op === '>>' || r.op === '>|') || !r.target) continue;
        const text = h && (!c || c.name === 'cat' || !['echo', 'printf'].includes(c.name)) && !(c && c.name === 'cat' && c.argv.some((a) => !a.startsWith('-')))
          ? bodyOf(raw, h) : printed(cmd);
        if (text !== null && text !== undefined) put(dequote(r.target.raw), r.at, text, r.op === '>>');
      }
      if (c && c.name === 'tee') {
        let feed = h ? bodyOf(raw, h) : null;
        for (let j = i - 1; feed === null && j >= 0 && i - j <= 16; j--) {
          const prev = stages[j].cands[0];
          if (prev && (prev.name === 'tee' || (prev.name === 'cat' && !prev.argv.some((a) => !a.startsWith('-')) && !docOf.get(stages[j])))) continue;
          feed = printed(stages[j]);
          if (feed === null && docOf.get(stages[j])) feed = bodyOf(raw, docOf.get(stages[j]));
          break;
        }
        const append = c.argv.some((a) => a === '-a' || a === '--append');
        if (feed !== null) for (const a of c.argv) if (a && !a.startsWith('-')) put(a, at, feed, append);
      }
      if (c && (c.name === 'cp' || c.name === 'mv' || c.name === 'install')) {
        const args = c.argv.filter((a) => a && !a.startsWith('-'));
        if (args.length >= 2) {
          const dest = args[args.length - 1];
          const destAbs = absOf(dest, at);
          let toDir;
          for (const src of args.slice(0, -1)) {
            const text = destAbs ? readOf(src, at) : null;
            if (!text) continue; // only a script copied somewhere can run from there
            if (toDir === undefined) toDir = dest.endsWith('/') || isDir(run, destAbs);
            const target = toDir ? path.join(destAbs, path.basename(normPath(src))) : destAbs;
            out.set(target, { at, text });
          }
        }
      }
    }
  }
  return out;
}

function carriedOf(P, raw, heredocs, opts, run) {
  const cwd = opts.cwd || null;
  const files = opts.files !== undefined ? !!opts.files : !!cwd;
  const anchor = cwd ? (at) => compiledAnchor(P.cds, cwd, normPath)(at) : () => null;
  let writtenMap = null; // read only when a script file is looked for: most commands run none
  const written = { get: (abs) => { if (!writtenMap) writtenMap = files ? writtenScripts(P, raw, heredocs, anchor, run) : new Map(); return writtenMap.get(abs); } };
  const unread = (at, why, p) => run.unread.push({ at, why, path: p || null });
  // A script file named by `word` (its token `tok`, for a glob) at `at`: { text, cwd } | null, noting an unread one.
  const fromFile = (word, at, direct, tok) => {
    if (!files || !word) return null;
    const base = anchor(at);
    let p = normPath(word);
    if (isVar(p) || (!path.isAbsolute(p) && base === null)) return null;
    let abs = path.resolve(base || '/', p);
    if (tok && GLOB_CHARS.test(word) && !/['"\\]/.test(tok.raw)) {
      const dir = path.dirname(abs);
      if (GLOB_CHARS.test(path.relative(base || '/', dir)) || GLOB_CHARS.test(dir)) { unread(at, 'a glob in a directory name', abs); return null; }
      const names = [...(listDir(run, dir) || [])].filter((e) => globMatch(path.basename(abs), e)).sort();
      if (!names.length) return null; // no match: the shell passes the pattern as written, and no such file runs
      abs = path.join(dir, names[0]);
    }
    const w = written.get(abs);
    if (w && w.at < at) return { text: w.text, cwd: base, path: abs };
    const r = readScript(run, abs, direct);
    if (r && r.unread) { unread(at, r.why, r.path); return null; }
    return r && { text: r.text, cwd: base, path: abs };
  };
  const out = [];
  const push = (s) => { if (typeof s.text === 'string' && s.text.trim()) out.push(s); };
  const heredocAt = heredocs.filter((h) => !P.inQuotes(h.index));
  const owners = heredocOwners(P, heredocAt);
  for (let k = 0; k < P.cmds.length; k++) {
    const cmd = P.cmds[k];
    if (lateHere(run, k, cmd)) break;
    for (const c of cmd.cands) {
      const tok = cmd.words[c.at];
      const at = tok.s;
      const el = cmd.elem || { from: at, to: P.command.length, cmds: [cmd] };
      const name = c.name;
      if (SHELLS.has(name)) {
        const args = c.args;
        const argv = c.argv;
        let cform = -1;
        let noexec = false;
        let stdin = false;
        let file = -1;
        for (let k = 0; k < argv.length; k++) {
          const w = argv[k];
          if (w === '--' || w === '-') { if (w === '--' && k + 1 < argv.length) file = k + 1; stdin = stdin || w === '-'; break; }
          if (w.startsWith('--')) { if (w === '--rcfile' || w === '--init-file') k++; continue; }
          if (/^[-+][A-Za-z]+$/.test(w)) {
            if (w[0] === '-' && w.includes('n')) noexec = true;
            if (w[0] === '-' && w.includes('c')) { cform = k + 1; break; }
            if (w[0] === '-' && w.includes('s')) stdin = true;
            if (w.includes('o')) { if (argv[k + 1] === 'noexec' && w[0] === '-') noexec = true; k++; }
            continue;
          }
          file = k;
          break;
        }
        if (noexec) continue;
        if (cform >= 0) {
          if (cform >= args.length) continue;
          const t = args[cform];
          const single = (t.raw[0] === "'" || t.raw[0] === '"') && P.spans.some((s) => s[0] === t.s && s[1] === t.e);
          if (single) push({ text: t.raw.slice(1, -1), at: t.s + 1, end: t.e - 1, mapped: true, cwd: anchor(at) });
          else push({ text: argv[cform], at, end: el.to, mapped: false, cwd: anchor(at) });
          continue;
        }
        if (file >= 0 && !stdin) {
          const t = fromFile(argv[file], at, false, args[file]);
          if (t) push({ ...t, at, end: el.to, mapped: false });
          continue;
        }
        const texts = [];
        // a heredoc anywhere in this pipeline, a here-string or a file on the shell's own stdin
        for (const h of heredocAt) { const o = owners.get(h.index); if (o && o.elem === el) texts.push({ text: bodyOf(raw, h) }); }
        for (const r of cmd.redirs) {
          if (r.op === '<<<' && r.target) texts.push({ text: dequote(r.target.raw) });
          if (r.op === '<' && r.target) { const t = fromFile(dequote(r.target.raw), at, false, r.target); if (t) texts.push(t); }
        }
        // the stage before the shell's pipe, walked back past any tee or bare cat: an echo, a printf, a cat of files
        const stages = el.cmds;
        const me = stages.indexOf(cmd);
        for (let j = me - 1; j >= 0 && me - j <= 16; j--) {
          const prev = stages[j].cands[0];
          if (!prev) break;
          const pargs = prev.argv.filter((a) => !a.startsWith('-'));
          if (prev.name === 'tee' || (prev.name === 'cat' && !pargs.length)) continue;
          const pw = stages[j].words[prev.at].e;
          if (prev.name === 'echo') texts.push({ text: echoOut(wordsFrom(raw, pw)) });
          else if (prev.name === 'printf') texts.push({ text: printfOut(wordsFrom(raw, pw)) });
          else if (prev.name === 'cat') for (const a of pargs) { const t = fromFile(a, at); if (t) texts.push(t); }
          break;
        }
        for (const t of texts) push({ ...t, cwd: t.cwd !== undefined ? t.cwd : anchor(at), at, end: el.to, mapped: false });
        continue;
      }
      if (name === 'eval') {
        push({ text: wordsFrom(raw, tok.e).join(' '), at, end: el.to, mapped: false, sourced: true, cwd: anchor(at) });
        continue;
      }
      if (name === 'source' || name === '.') {
        const t = fromFile(c.argv[0], at, false, c.args[0]);
        if (t) push({ ...t, at, end: el.to, mapped: false, sourced: true });
        continue;
      }
      if (files && (name === 'make' || name === 'gmake' || name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun')) {
        const base = anchor(at);
        if (base === null) continue;
        const got = name === 'make' || name === 'gmake' ? makeRun(run, c.argv, base) : packageRun(run, name, c.argv, base);
        if (!Array.isArray(got)) { unread(at, got.why, got.path); continue; }
        for (const g of got) push({ text: g.text, cwd: g.cwd, at, end: el.to, mapped: false });
        continue;
      }
      // a file run by its path: a word holding a `/`, no expansion
      if (c.word.includes('/') && !/[$`]/.test(c.word)) {
        const t = fromFile(c.word, at, true, tok);
        if (t) push({ ...t, at, end: el.to, mapped: false });
      }
    }
  }
  return out;
}
// carriedScripts(raw, opts): the scripts a command hands to a shell, parsed the way scanShell parses it. `opts.cwd`
// resolves a script file (without one only an absolute path is read, and only when `files` is true); `opts.run` shares a
// scan run. Scripts it could not read are in `opts.run.unread` (the returned array's `unread` too).
function carriedScripts(raw, opts = {}) {
  const text = String(raw || '');
  const run = opts.run || newRun(opts);
  if (run.budget.over()) { run.unread.push({ at: 0, why: run.budget.why, path: null }); const none = []; none.unread = run.unread; return none; }
  const heredocs = heredocsOf(text);
  const command = joinContinuations(blankComments(blankHeredocs(text, heredocs)));
  const P = parseShell(command);
  const out = carriedOf(P, text, heredocs, opts, run);
  out.unread = run.unread;
  return out;
}

// ---- git aliases: the ONE home (2.1.6 review T20, re-verify N2, re-verify 2 R2-m1, re-verify 3 R3-m5) ------------
// A git ALIAS runs another git command - or, with `!`, a shell command, from the repository's top level - and git
// resolves it before it runs. Each git call whose subcommand is no builtin (git never lets an alias shadow one) is
// looked up where it runs and expanded in place: a plain alias becomes its words, a `!` alias the shell command it runs
// (with the call's own arguments, in a subshell at the top level when that is not where the call runs); the text is
// walked again for an alias of an alias, 5 passes at most. A call is looked up with what git reads: the directory (the
// cwd moved by every cd before the call, then its `-C`), its `-c` flags and `--config-env` (the named variable read from
// the command, then the environment), its `--git-dir` / `--work-tree`, the `GIT_CONFIG*`, `HOME`, `XDG_CONFIG_HOME`,
// `GIT_DIR` and `GIT_WORK_TREE` values assigned before it, and an alias the same command defines first (`git config
// alias.x commit && git x`). The aliases of one place are read ONCE, as a table (`git config -z --get-regexp ^alias\.`),
// and kept for the run: one git spawn per call made 800 calls cost 4s (R3-m5). At most 32 tables are read and 64KB of
// text expanded; past either, the calls left are UNREAD. Any lookup git cannot answer, an alias still standing after
// the last pass, or a subcommand an xargs input supplies (`xargs -I% git %`, `... | xargs git`) leaves the call unread:
// `unreadAt` is the first such call's position in the returned text (-1 for none), for a caller that must fail closed.
const GIT_BUILTINS = new Set(('add am annotate apply archive bisect blame branch bugreport bundle cat-file check-attr check-ignore '
  + 'check-mailmap check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column commit commit-graph '
  + 'commit-tree config count-objects credential describe diagnose diff diff-files diff-index diff-tree difftool fast-export '
  + 'fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref for-each-repo format-patch fsck gc '
  + 'get-tar-commit-id grep gui hash-object help hook index-pack init instaweb interpret-trailers log ls-files ls-remote '
  + 'ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index merge-tree mergetool mktag mktree '
  + 'multi-pack-index mv name-rev notes pack-objects pack-refs patch-id prune prune-packed pull push range-diff read-tree '
  + 'rebase reflog remote repack replace request-pull rerere reset restore rev-list rev-parse revert rm scalar send-email '
  + 'send-pack shortlog show show-branch show-index show-ref sparse-checkout stage stash status stripspace submodule '
  + 'switch symbolic-ref tag unpack-file unpack-objects update-index update-ref update-server-info var verify-commit '
  + 'verify-pack verify-tag version whatchanged worktree write-tree').split(' '));
const LOOKUP_ENV = /^(?:GIT_CONFIG\w*|HOME|XDG_CONFIG_HOME|GIT_DIR|GIT_WORK_TREE)$/;
const ALIAS_TABLES = 32;
const ALIAS_TEXT = 64 * 1024;
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const realOf = (run, p) => {
  if (run.real.has(p)) return run.real.get(p);
  let r = p;
  try { r = fs.realpathSync(p); } catch { /* keep the spelling */ }
  run.real.set(p, r);
  return r;
};
// `lookup` holds the GIT_CONFIG* / HOME / XDG_CONFIG_HOME / GIT_DIR / GIT_WORK_TREE values assigned before the call;
// the environment git gets is built only when the table is not read yet.
function aliasTable(run, dir, args, lookup, envKey) {
  const key = JSON.stringify([dir, args, envKey]);
  if (run.aliasTables.has(key)) return run.aliasTables.get(key);
  let res;
  if (run.spawns >= ALIAS_TABLES || run.budget.over()) res = { error: `past ${ALIAS_TABLES} alias tables` };
  else {
    run.spawns++;
    const env = Object.assign({}, process.env, Object.fromEntries(lookup));
    const cwd = dir && exists(run, dir) ? dir : undefined;
    const r = spawnSync('git', [...args, 'config', '-z', '--get-regexp', '^alias\\.'], { cwd, env, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 });
    if (r.error || (r.status !== 0 && r.status !== 1)) res = { error: 'a lookup git could not answer' };
    else {
      const map = new Map();
      for (const rec of String(r.stdout || '').split('\0')) {
        if (!rec.startsWith('alias.')) continue;
        const nl = rec.indexOf('\n');
        map.set((nl < 0 ? rec.slice(6) : rec.slice(6, nl)).toLowerCase(), nl < 0 ? '' : rec.slice(nl + 1));
      }
      res = { map, run: (argv) => spawnSync('git', [...args, ...argv], { cwd, env, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
    }
  }
  run.aliasTables.set(key, res);
  return res;
}
function aliasPass(text, base, depth, run) {
  const res = { text, reps: [], unread: -1 };
  if (!/git/i.test(text)) return res;
  if (run.budget.over()) { res.unread = 0; return res; }
  const command = joinContinuations(blankComments(blankHeredocs(text)));
  const P = parseShell(command);
  const anchor = anchorer(P.cds, base, normPath);
  const mark = (at) => { if (res.unread < 0 || at < res.unread) res.unread = at; };
  // one pass for what a call reads from before it: assignments and same-command alias definitions, in order
  const events = P.assignEvents.slice();
  const calls = gitCalls(null, P);
  for (const call of calls) {
    if (call.sub !== 'config') continue;
    const w = call.argv;
    let k = 0;
    while (k < w.length && (w[k].startsWith('-') || w[k] === 'set')) k += /^(?:-f|--file|--blob)$/.test(w[k]) ? 2 : 1;
    const m = /^alias\.(.+)$/i.exec(w[k] || '');
    if (m && w[k + 1] !== undefined) events.push({ at: call.at, kind: 'alias', name: m[1].toLowerCase(), value: w.slice(k + 1).join(' ') });
  }
  events.sort((a, b) => a.at - b.at);
  // an xargs whose git subcommand comes from its input
  for (const cmd of P.cmds) {
    for (const c of cmd.cands) {
      if (c.name !== 'xargs') continue;
      const w = c.argv;
      let i = 0;
      let repl = null;
      while (i < w.length && w[i].startsWith('-')) {
        const f = w[i];
        if (f === '--') { i++; break; }
        if (f === '-I') { repl = w[i + 1]; i += 2; continue; }
        if (/^-I./.test(f)) { repl = f.slice(2); i++; continue; }
        if (/^(?:-i|--replace)(?:=|$)/.test(f)) { repl = f.replace(/^(?:-i|--replace)=?/, '') || '{}'; i++; continue; }
        i += /^-[LnPsdEa]$/.test(f) || /^--(?:max-lines|max-args|max-procs|max-chars|delimiter|eof|arg-file)$/.test(f) ? 2 : 1;
      }
      if (normCmd(w[i] || '', P.assigns) !== 'git') continue;
      let j = i + 1;
      while (j < w.length && w[j].startsWith('-')) j += /^-[cC]$/.test(w[j]) || /^--(?:git-dir|work-tree|namespace)$/.test(w[j]) ? 2 : 1;
      if (!w[j] || (repl && w[j].includes(repl))) mark(c.args[i] ? c.args[i].s : cmd.words[c.at].s);
    }
  }
  let next = '';
  let last = 0;
  let ev = 0;
  const vars = new Map();
  const defs = new Map();
  const lookup = new Map(); // the assignments git reads its configuration by
  let envKey = '';
  for (const call of calls) {
    for (; ev < events.length && events[ev].at < call.at; ev++) {
      const e = events[ev];
      if (e.kind !== 'set') { defs.set(e.name, e.value); continue; }
      vars.set(e.name, e.value);
      if (LOOKUP_ENV.test(e.name)) { lookup.set(e.name, e.value); envKey = null; }
    }
    if (call.xargs) continue; // read above: its subcommand is the input's
    if (!call.sub || call.opaque || GIT_BUILTINS.has(call.sub)) continue;
    const name = call.sub.toLowerCase();
    let dir = anchor(call.at) || base;
    if (envKey === null) envKey = [...lookup].map(([k, v]) => `${k}=${v}`).join('\n');
    const args = [];
    for (const d of call.dirs) if (!isVar(d)) dir = path.resolve(dir, normPath(d));
    for (const cfg of call.config) args.push('-c', cfg);
    for (const ce of call.configEnv) {
      const m = /^([^=]+)=(.*)$/.exec(ce);
      if (!m) continue;
      const v = vars.has(m[2]) ? vars.get(m[2]) : process.env[m[2]];
      if (v !== undefined) args.push('-c', `${m[1]}=${v}`);
    }
    if (call.gitDir) args.push(`--git-dir=${call.gitDir}`);
    if (call.workTree) args.push(`--work-tree=${call.workTree}`);
    let value = defs.get(name);
    let table = null;
    if (value === undefined) {
      table = aliasTable(run, dir, args, lookup, envKey);
      if (table.error) { mark(call.at); continue; }
      if (!table.map.has(name)) continue; // no such alias: git says so itself
      value = table.map.get(name);
    }
    if (depth >= 5) { mark(call.at); continue; }
    value = String(value).trim();
    if (!value || value.split(/\s+/)[0] === name) continue; // empty, or git's 'recursive alias' error: runs nothing
    let from = call.subAt;
    let to = call.subEnd;
    let replacement = value;
    if (value.startsWith('!')) {
      from = call.at;
      replacement = value.slice(1);
      if (!table) table = aliasTable(run, dir, args, lookup, envKey);
      let topDir = '';
      if (!table.error) {
        if (table.top === undefined) {
          if (run.spawns >= ALIAS_TABLES) table.top = null;
          else { run.spawns++; const top = table.run(['rev-parse', '--show-toplevel']); table.top = !top.error && top.status === 0 ? String(top.stdout || '').trim() : ''; }
        }
        if (table.top === null) { mark(call.at); continue; }
        topDir = table.top;
      }
      if (topDir && realOf(run, topDir) !== realOf(run, dir)) {
        const end = call.args.length ? call.args[call.args.length - 1].e : call.subEnd;
        replacement = `(cd ${shq(topDir)} && ${replacement}${text.slice(to, end)})`;
        to = end;
      }
    }
    // the cap counts what the expansion ADDS, over every pass: a large script that merely uses an alias is read
    run.aliasAdded += Math.max(0, replacement.length - (to - from));
    if (run.aliasAdded > ALIAS_TEXT) { mark(call.at); break; }
    next += text.slice(last, from) + replacement;
    res.reps.push([from, to - from, replacement.length]);
    last = to;
  }
  if (res.reps.length) res.text = next + text.slice(last);
  return res;
}
function expandGitAliases(command, opts = {}) {
  let text = String(command || '');
  let mark = -1;
  const base = opts.cwd || process.cwd();
  const run = opts.run || newRun(opts);
  for (let depth = 0; depth <= 5; depth++) {
    const r = aliasPass(text, base, depth, run);
    if (mark >= 0) {
      let d = 0;
      for (const [at, oldLen, newLen] of r.reps) if (at + oldLen <= mark) d += newLen - oldLen;
      mark += d;
    }
    if (r.unread >= 0 && (mark < 0 || r.unread < mark)) mark = r.unread;
    text = r.text;
    if (!r.reps.length) break;
  }
  return { text, unreadAt: mark };
}

// ---- the git text the git guards judge (2.1.6 seam review M3) -----------------------------------------------------
// ONE reader of a command for every guard that judges a git call (commit, push, force-push, the rm guard's git half):
// git aliases expanded in place, every script the command hands a shell (`sh -c`, `eval`, a heredoc, a here-string, a script
// FILE, an `if` / `for` body already parsed as ordinary commands) appended after a newline with its aliases expanded, all
// inside ONE scan budget, then parsed once. `calls` are its git calls; `callDir(call)` is the directory a call runs in (its
// piece's cwd moved by every cd before it there, then its own `-C` chain; a cd it cannot follow leaves the piece's cwd);
// `unreadAt` is the first place the read stopped short (an alias git could not answer, text past the budget or the depth
// that still names git) or -1, which each caller judges its own conservative way. A script `curl` prints does not exist
// when a guard runs, so the call is judged on what it names.
const NAMES_GIT = /g[\\'"]*i[\\'"]*t/i;
const namesGit = (file) => {
  try { return fs.statSync(file).size > 64 * 1024 * 1024 || NAMES_GIT.test(fs.readFileSync(file, 'latin1')); } catch { return true; }
};
function gitText(raw, cwd) {
  const run = newRun();
  const aliased = expandGitAliases(String(raw || ''), { cwd, run });
  let unreadAt = aliased.unreadAt;
  const markUnread = (at) => { if (unreadAt < 0 || at < unreadAt) unreadAt = at; };
  // Where each piece of the final text runs from: the command from the shell's cwd, each carried script from the
  // directory it runs in - a cd inside one moves what follows it there. `base` is where `text` starts in the final text.
  const regions = [];
  function withCarried(text, dir0, base, depth) {
    regions.push({ from: base, to: base + text.length, cwd: dir0 });
    const u0 = run.unread.length;
    const scripts = carriedScripts(text, { cwd: dir0, files: true, run });
    for (const u of run.unread.slice(u0)) if (u.path ? namesGit(u.path) : NAMES_GIT.test(text.slice(u.at))) markUnread(base + u.at);
    let out = text;
    for (const sc of scripts) {
      if (run.budget.deep(depth) || run.budget.over()) { if (NAMES_GIT.test(sc.text)) markUnread(base + sc.at); continue; }
      const dir = sc.cwd || dir0;
      const inner = expandGitAliases(sc.text, { cwd: dir, run });
      const at = base + out.length + 1;
      if (inner.unreadAt >= 0) markUnread(at + inner.unreadAt);
      out += `\n${withCarried(inner.text, dir, at, depth + 1)}`;
    }
    return out;
  }
  // Every byte is charged once, where it comes from: the command here, a script file as it is read (`readScript`).
  // Past the budget the text is not parsed, and unread.
  run.budget.take(aliased.text.length);
  const command = withCarried(aliased.text, cwd, 0, 0);
  const parsed = !run.budget.over() ? parseShell(joinContinuations(blankComments(blankHeredocs(command)))) : null;
  if ((!parsed || parsed.tooDeep) && NAMES_GIT.test(command)) markUnread(0);
  const calls = parsed ? gitCalls(null, parsed) : [];
  const regionCds = new Map();
  const cdTarget = (t) => nativePath(unquote(t));
  function callDir(call) {
    let k = regions.length - 1;
    while (k > 0 && regions[k].from > call.at) k--;
    const r = regions[k];
    if (!regionCds.has(k)) regionCds.set(k, (parsed ? parsed.cds : []).filter((c) => c.index >= r.from && c.index < r.to));
    let dir = anchorAt(regionCds.get(k), call.at, r.cwd, cdTarget) || r.cwd;
    for (const d of call.dirs) if (!isVar(d)) dir = path.resolve(dir, nativePath(d));
    try { dir = fs.realpathSync.native(dir); } catch { /* git reports the missing directory itself */ }
    return dir;
  }
  return { command, parsed, calls, regions, unreadAt, callDir };
}

// Read a command's writes. `opts` (all optional): `cwd` resolves a script file a shell runs (without one only an
// absolute path is read, and only when `files` is true); `files` false reads no file at all; `aliases` expands git
// aliases first (their lookups run git), `aliasUnreadAt` naming a call whose alias could not be read; `run` shares a
// scan run (its budget and caches) with the caller. `unread` lists what the reader could not read - a script past the
// budget, a fourth level of scripts nested in scripts, a glob in a directory name, a workspace it cannot resolve - as
// { at, why, path }: the caller judges each conservatively.
// A script a shell is handed is read with these same rules: its targets, cds and git writes moved to where it sits in
// this command. A child shell's cds end with it; a sourced script's (`.`, `source`, `eval`) outlive it, up to the end of
// the subshell it runs in. A derived or file script has no place of its own in the command, so its positions are spread
// in order inside the running word's own (below one), which keeps its cds before its writes and every later command
// after them. Nested scripts are read 3 deep; a script at a fourth level is unread.
function scanShell(rawCommand, opts = {}) {
  const run = opts.run || newRun(opts);
  let raw = String(rawCommand || '');
  let aliasUnreadAt = -1;
  if (opts.aliases) ({ text: raw, unreadAt: aliasUnreadAt } = expandGitAliases(raw, { cwd: opts.cwd || undefined, run }));
  const empty = (why) => {
    run.unread.push({ at: 0, why, path: opts.path || null });
    const command = raw;
    const quoted = quotedSpans(command);
    return { command, quoted, inQuotes: spanTest(quoted), expandVars: (t) => t, cds: [], targets: [], gitWrites: [], aliasUnreadAt, unread: run.unread };
  };
  // Every byte is charged once, where it comes from: the command here at the top, a script file as it is read
  // (`readScript`); passes over text already charged cost nothing more (2.1.6 re-verify 4 R4-m2).
  if (!(opts.depth ? !run.budget.over() : run.budget.take(raw.length))) return empty(run.budget.why);
  const heredocs = heredocsOf(raw);
  const command = joinContinuations(blankComments(blankHeredocs(raw, heredocs)));
  const P = parseShell(command);
  if (P.tooDeep) return empty(`subshells nested past ${MAX_NEST}`);
  const assigns = P.assigns;
  const expandVars = (t) => t.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
    (m, br, bare) => (assigns.has(br || bare) ? assigns.get(br || bare) : m));
  const targets = [];
  const gitWrites = [];
  for (let k = 0; k < P.cmds.length; k++) {
    const cmd = P.cmds[k];
    if (lateHere(run, k, cmd, opts.path)) break;
    for (const r of cmd.redirs) {
      if (isFileRedir(r)) targets.push({ raw: dequote(r.target.raw), index: r.at, what: 'a shell redirection', verb: '>' });
    }
    for (const c of cmd.cands) {
      writesOf(cmd, c, targets);
      if (c.name === 'git') {
        // a bare `git <mutating>` after a `cd` out of tree writes THAT checkout - the same event as `git -C <dir>`
        const call = gitCallOf(cmd, c);
        if (!call.dirs.length && call.sub && gitMutates(call.sub, call.argv)) gitWrites.push(call.at);
      }
    }
  }
  targets.push(...interpreterTargets(raw, P, heredocs));
  const files = opts.files !== undefined ? !!opts.files : !!opts.cwd;
  const depth = opts.depth || 0;
  const carried = carriedOf(P, raw, heredocs, { cwd: opts.cwd || null, files }, run);
  const cds = carried.length ? P.cds.slice() : P.cds;
  if (carried.length && run.budget.deep(depth)) {
    for (const sc of carried) run.unread.push({ at: sc.at, why: `a script nested ${depth + 1} deep`, path: null });
  } else {
    const closesOf = new Map(P.cmds.map((c) => [c.words.length ? c.words[0].s : -1, c.end]));
    for (const sc of carried) {
      if (run.budget.over()) { run.unread.push({ at: sc.at, why: run.budget.why, path: null }); continue; }
      const u0 = run.unread.length;
      const inner = scanShell(sc.text, { cwd: sc.cwd || null, files, aliases: opts.aliases, depth: depth + 1, run, path: sc.path || null });
      for (let u = u0; u < run.unread.length; u++) run.unread[u] = { at: sc.at, why: run.unread[u].why, path: run.unread[u].path || sc.path || null };
      const verbatim = sc.mapped && inner.command.length === sc.text.length;
      const place = verbatim ? (i) => sc.at + i : (i) => sc.at + (i + 1) / (inner.command.length + 2);
      const closes = sc.sourced ? enclosingEnd(P, sc.at, closesOf) : sc.end;
      for (const t of inner.targets) { t.index = place(t.index); targets.push(t); } // the inner scan's own objects
      for (const c of inner.cds) cds.push({ 0: c[0], 1: c[1], index: place(c.index), end: c.end === undefined ? closes : place(c.end), pushd: c.pushd, popd: c.popd });
      gitWrites.push(...inner.gitWrites.map(place));
    }
  }
  if (cds !== P.cds) cds.sort((a, b) => a.index - b.index);
  targets.sort((a, b) => a.index - b.index);
  if (depth === 0 && cds.length && !run.budget.over()) {
    const deep = compiledAnchor(cds, opts.cwd || '/', normPath).tooLong;
    if (deep >= 0) run.unread.push({ at: deep, why: `a directory past ${MAX_PATH} characters`, path: null });
  }
  return { command, quoted: P.spans, inQuotes: P.inQuotes, expandVars, cds, targets, gitWrites, aliasUnreadAt, unread: run.unread };
}
// Where the subshell holding the command at `at` closes (undefined at the top level).
function enclosingEnd(P, at, closesOf) {
  if (closesOf.has(at)) return closesOf.get(at);
  for (const cmd of P.cmds) for (const c of cmd.cands) if (cmd.words[c.at].s === at) return cmd.end;
  return undefined;
}

module.exports = { scanShell, carriedScripts, expandGitAliases, gitCalls, commandWords, parseShell, newRun, anchorAt, anchorer, blankHeredocs, heredocsOf, heredocBody, heredocVerbatim, heredocSubstitutions, commandIndex, groupsAsCuts, gitText, WRAPPERS, RUN_TOOLS,
  blankComments, joinContinuations, quotedSpans, shellWords, dequote, unquote, isVar, gitMutates, SHELL_TOOLS, isShellTool, MOUNT_RE, nativePath, homeDir };
