// shell-writes.js - what a shell command WRITES, read from its literal text. Shared by
// guard-cross-project-write.js (which judges where each target lands) and guard-stop-contract.js's
// done gate (which counts a target inside the project as a source edit). A module, copied beside the
// hooks on the copy route and never wired (the fresh-session.js pattern): both hooks require it
// through __dirname, so the plugin cache and a copied install find it the same way.
// It only PARSES - it never resolves a path against a root or decides anything. The targets come
// back in the order the guard judged them in when this code lived inside it, so its first block is
// the same block.
'use strict';
const path = require('path');

// A heredoc BODY is DATA, not shell - a plan that DESCRIBES a command is inert text, and
// matching it blocks a document write for its own prose. Blank the body, keep the length. The
// heredoc's own first line stays: `cat <<'EOF' > ../other/f.txt` carries its redirect THERE, and
// blanking the whole match let that classic shell write through (reproduced).
const blankHeredocs = (rawCommand) => String(rawCommand || '').replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => { const nl = m.indexOf('\n'); return nl === -1 ? m : m.slice(0, nl) + m.slice(nl).replace(/[^\n]/g, ' '); },
);

// Quoted spans: a `>` or a verb inside '...' / "..." is text an outer command carries (a commit
// message, an echo, a grep pattern), never a write of its own. The write TARGET may still be
// quoted - the patterns below capture it - only the verb's own position is checked.
// A `$( ... )` inside a double-quoted span is SHELL again, with its own quoting: bash does not end
// the outer span on the `"` of `"$(grep -o 'Sdk="[^"]*"' f)"`. Reading it as the closing quote
// flipped every span after it, and a later `sed 's/<OutputType>//'` then read as a redirection to
// `//` - replayed at exit 2, ~112k tokens re-sent. So the substitution is tracked as its own
// context: the outer span pauses at `$(`, the inside is judged on its own (a real redirect in
// there still counts), and the outer span resumes after the matching `)`.
function quotedSpans(command) {
  const quoted = [];
  const stack = []; let q = null; let start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && q !== "'") { i++; continue; }
    if (q !== "'" && c === '$' && command[i + 1] === '(') {
      if (q) quoted.push([start, i]);          // the outer span pauses here
      stack.push(q); q = null; i++; continue;
    }
    if (!q && c === ')' && stack.length) { q = stack.pop(); start = i + 1; continue; }
    if (!q && (c === '"' || c === "'")) { q = c; start = i; }
    else if (q && c === q) { quoted.push([start, i + 1]); q = null; }
  }
  if (q) quoted.push([start, command.length]);
  return quoted;
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
    if (/\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    cur += c; started = true;
  }
  if (started) out.push(cur);
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

// `cd` / `pushd` earlier in the command move the anchor for everything after them. A target
// that cannot be followed (`cd -`, `cd $DIR`, a relative cd from an unknown place) makes the
// anchor unknown, and an unknown anchor judges nothing relative - never guess.
const CD_RE = /(?:^|&&|\|\||;|\n|\(|\|)\s*(?:cd|pushd)\s+("[^"]+"|'[^']+'|[^\s;|&()]+)/g;
// The directory a path written at `index` resolves from: `root` moved by every cd before it, or
// null once a cd cannot be followed. `norm` turns a cd's raw token into a path (the guard adds its
// tilde and Git Bash mount spellings; unquoting is the floor).
function anchorAt(cds, index, root, norm = unquote) {
  let cwd = root;
  for (const c of cds) {
    if (c.index >= index) break;
    const t = norm(c[1]);
    if (t === '-' || isVar(t) || (cwd === null && !path.isAbsolute(t))) { cwd = null; continue; }
    cwd = path.resolve(cwd, t);
  }
  return cwd;
}

// Only WRITE-shaped commands are considered, and only the paths they actually write to. Read-shaped
// commands (cat, grep, ls, find, git log/diff/show) are not listed at all.
const TARGET = `("[^"]+"|'[^']+'|[^\\s;|&<>()]+)`;
const SEG = '[^;|&\\n]';
const GIT_MUTATING = 'commit|add|checkout|switch|merge|rebase|reset|revert|restore|push|pull|apply|am|cherry-pick'
  // `stash list`/`stash show` and the listing forms of `tag` (bare, -l, -n) are reads - flagging
  // them as writes blocked honest investigation of the other repo (reproduced).
  + '|stash(?!\\s+(?:list|show)\\b)|clean|rm|mv|tag\\s+(?!-l\\b|--list\\b|-n\\b)(?:-\\S+\\s+)*[^-\\s]\\S*|branch\\s+-[dDm]';
const WRITE_PATTERNS = [
  // shell redirection into a file, `>>` included; `2>&1` and `>&2` are not file targets
  { re: new RegExp(`>>?\\s*(?!&)${TARGET}`, 'g'), what: 'a shell redirection' },
  { re: new RegExp(`\\btee\\s+(?:-\\w+\\s+)*${TARGET}`, 'g'), what: 'a `tee` write' },
  // in-place edits: every path argument, not just the last - `sed -i 's/a/b/' ../other/f x`
  // dodged a last-argument rule, and perl's usual `-pi` cluster dodged a literal `-i` (both reproduced)
  { re: new RegExp(`\\b(?:sed|perl)\\s+((?:${SEG}*?\\s)?-[A-Za-z]*i\\b\\S*\\s${SEG}*)`, 'g'), what: 'an in-place edit', all: true, sedish: true },
  { re: new RegExp(`\\b(?:cp|mv|ln|install|rsync)\\s+${SEG}*?\\s${TARGET}\\s*(?:;|\\||&|$)`, 'g'), what: 'a copy/move destination' },
  // every argument counts: `rm -f a ../other/b`, `chmod +x ../other/x` and `truncate -s 0 ../other/log`
  // all put the out-of-tree path AFTER a non-flag token a first-argument rule stopped at (reproduced)
  { re: new RegExp(`\\b(?:rm|rmdir|mkdir|touch|truncate|chmod|chown)\\s+(${SEG}+)`, 'g'), what: 'a filesystem change', all: true },
  // `mv` REMOVES its source, so an out-of-tree source is a write to that tree even when the
  // destination is local - the destination-only rule above would have waved it through.
  { re: new RegExp(`\\bmv\\s+(?:-\\S+\\s+)*${TARGET}`, 'g'), what: 'a move OUT of another project' },
  // `git -C <dir> <mutating subcommand>` is a write to that dir even with no path argument
  { re: new RegExp(`\\bgit\\s+-C\\s+${TARGET}\\s+(?:${GIT_MUTATING})(?![\\w-])`, 'g'), what: 'a git write in another checkout' },
];

// An INTERPRETER with an inline script is a write route the patterns above CANNOT see, and the
// reason is structural: a script body is always inside quotes (`node -e "…"`), which `inQuotes`
// skips as prose, or inside a heredoc, whose body is blanked as data before they run. So it is read
// HERE, on the raw text. Measured as a blocked/allowed PAIR on one operation five seconds apart in
// the same session - the shell `rm -f "$B"/*/x` denied, the identical unlink through
// `python3 - <<'PY' … f.unlink()` allowed - and under a Bash-first harness the heredoc IS the write
// route (23 of 23 writes in one bundle, 17 sibling mutations in another). Mirrors
// guard-read-whole-file.js's `runtimeDump`. Only a body actually FED to an interpreter is read: a
// heredoc going to `cat > plan.md` stays inert prose, which is what keeps a document write from
// blocking on its own text. And only a LITERAL path is taken - an interpolated or computed one is
// left alone for the same reason an unexpanded shell variable is never judged. Heredoc blanking
// keeps the command's LENGTH, so an index into the raw text still anchors correctly.
const INTERP = String.raw`(?:python[\d.]*|node|nodejs|ruby|perl|php|deno|bun|osascript|pwsh|powershell)`;
function interpreterTargets(rawCommand) {
  const scripts = [];
  const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([\s\S]*?)^\s*\2\s*$/gm;
  const isInterp = new RegExp(`\\b${INTERP}\\b`);
  let h;
  while ((h = HEREDOC.exec(rawCommand)) !== null) {
    const header = rawCommand.slice(rawCommand.lastIndexOf('\n', h.index) + 1, h.index);
    if (isInterp.test(header)) scripts.push({ body: h[3], index: h.index });
  }
  // `node -e "…"` / `python3 -c '…'` - the same script, spelled as one argument
  const INLINE = new RegExp(`\\b${INTERP}\\b[^\\n;|&]*?\\s-(?:e|c|-eval|-command)\\s+("[\\s\\S]*?"|'[\\s\\S]*?')`, 'g');
  let e;
  while ((e = INLINE.exec(rawCommand)) !== null) scripts.push({ body: e[1].slice(1, -1), index: e.index });
  const out = [];
  if (!scripts.length) return out;
  const LIT = String.raw`(["'])([^"'\n]+)\1`;
  const DESTRUCTIVE = 'write_text|write_bytes|unlink|mkdir|rmdir|rename|replace|touch|chmod';
  const WRITE_CALLS = [
    // a write verb whose FIRST argument is the path
    new RegExp(String.raw`\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile|unlinkSync|unlink|rmSync|rmdirSync|rmdir|mkdirSync|mkdir|makedirs|removedirs|renameSync|rename|copyFileSync|copyfile|copy2|truncateSync|truncate|chmodSync|chmod|remove|rmtree|move|touch)\s*\(\s*${LIT}`, 'g'),
    // `open(path, 'w')` - a bare `open(path)` is a READ, and reading another repo stays open
    new RegExp(String.raw`\b(?:open|fopen)\s*\(\s*${LIT}\s*,\s*["'][^"']*[wax+][^"']*["']`, 'g'),
    // pathlib, chained: `Path('…').write_text(…)`
    new RegExp(String.raw`\bPath\s*\(\s*${LIT}\s*\)\s*\.\s*(?:${DESTRUCTIVE})\b`, 'g'),
  ];
  // `f = Path('…')` … `f.unlink()` - the measured shape: the literal and the destructive call are
  // statements apart, so the binding is followed by NAME. Pairing them is what keeps a script that
  // READS another repo and writes in-project from blocking.
  // spelled out rather than reusing LIT: the leading capture shifts LIT's own backreference
  const PATH_BIND = /(\w+)\s*=\s*(?:pathlib\.)?Path\s*\(\s*(["'])([^"'\n]+)\2/g;
  const literal = (raw, index) => {
    if (/[${]/.test(raw)) return; // interpolated - the path is computed, don't guess
    out.push({ raw, index, what: 'an interpreter write', verb: 'interpreter' });
  };
  for (const { body, index } of scripts) {
    for (const re of WRITE_CALLS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body)) !== null) literal(m[2], index);
    }
    PATH_BIND.lastIndex = 0;
    let b;
    while ((b = PATH_BIND.exec(body)) !== null) {
      if (new RegExp(String.raw`\b${b[1]}\s*\.\s*(?:${DESTRUCTIVE})\b`).test(body)) literal(b[3], index);
    }
  }
  return out;
}

// One pass over a command. `targets` are the written paths, UNRESOLVED, in judging order:
// { raw, index, what, verb } - `raw` unquoted, `index` where the writing verb (or the redirect)
// stands in the command, `verb` the command word that writes (`>` for a redirection).
// `gitWrites` are the indices of a bare `git <mutating>` - a write to whatever checkout the anchor
// is in at that point.
function scanShell(rawCommand) {
  const raw = String(rawCommand || '');
  const command = blankHeredocs(raw);
  const quoted = quotedSpans(command);
  const inQuotes = (i) => quoted.some(([a, b]) => i > a && i < b);
  // A variable assigned to a LITERAL earlier in the same command is not unknowable - `SP=/tmp/x`
  // then `rm -rf "$SP"/*` is judgeable, and reading it as unjudgeable is how a real out-of-tree
  // write would have walked through. Only literal values are taken; anything carrying another
  // expansion stays unresolved, and an unresolved variable is still never judged.
  const assigns = new Map();
  for (const a of command.matchAll(/(?:^|[;&|(\n]|\s)([A-Za-z_]\w*)=("[^"\n]*"|'[^'\n]*'|[^\s;|&()]*)/g)) {
    const v = unquote(a[2]);
    if (v && !/[$`]/.test(v)) assigns.set(a[1], v);
  }
  const expandVars = (t) => t.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
    (m, br, bare) => (assigns.has(br || bare) ? assigns.get(br || bare) : m));
  const cds = [...command.matchAll(CD_RE)].filter((c) => !inQuotes(c.index + c[0].search(/(?:cd|pushd)\s/)));

  const targets = [];
  for (const { re, what, all, sedish } of WRITE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(command)) !== null) {
      if (inQuotes(m.index)) continue; // prose inside a quoted string
      const verb = (/^[>\s]/.test(m[0]) ? '>' : m[0].match(/^\S+/)[0]);
      if (!all) { targets.push({ raw: unquote(m[1]), index: m.index, what, verb }); continue; }
      for (const tok of shellWords(m[1])) {
        if (tok.startsWith('-')) continue; // a flag (or `--`), never a path
        if (!tok || SED_SCRIPT.test(tok)) continue; // an empty -i suffix, or a sed address form
        if (sedish && SED_SCRIPT_ARG.test(tok)) continue; // ...and the script itself, on the sed route only
        targets.push({ raw: tok, index: m.index, what, verb });
      }
    }
  }
  targets.push(...interpreterTargets(raw));

  // A bare `git <mutating>` after a `cd` out of tree writes THAT checkout - the same event as
  // `git -C <dir>`, spelled the way a session actually spells it (reproduced: passed).
  const GIT_BARE = new RegExp(`\\bgit\\s+(?:-c\\s+\\S+\\s+|--\\S+\\s+)*(?:${GIT_MUTATING})(?![\\w-])`, 'g');
  const gitWrites = [];
  let g;
  while ((g = GIT_BARE.exec(command)) !== null) if (!inQuotes(g.index)) gitWrites.push(g.index);

  return { command, quoted, inQuotes, expandVars, cds, targets, gitWrites };
}

module.exports = { scanShell, anchorAt, blankHeredocs, quotedSpans, shellWords, unquote, isVar };
