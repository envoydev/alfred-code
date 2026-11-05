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
// A path ROOTED WITHOUT A DRIVE (`/`, `\x`) on Windows: node resolves it on the hook process's own cwd drive, which
// need not be the project's - the runner checks out on D: beside a C: temp, so `rm -rf /` from a C: project read as D:\
// and missed the C: plugins tree it takes (3.7.1, the windows-2025 job). Every such path in a run lands on ONE drive, the
// anchor's, so a target and an allowance spelled alike (`/dev/null` against `/dev`) still meet. Anything else resolves
// as before. `P` and `platform` are for the tests.
const DRIVELESS_ROOT = /^[\\/](?![\\/])/;
const resolveOn = (p, anchor, P = path, platform = process.platform) => {
  const n = nativePath(p, platform);
  return platform === 'win32' && anchor && DRIVELESS_ROOT.test(n) ? P.resolve(anchor, n) : P.resolve(n);
};
// os.homedir() THROWS on Windows when USERPROFILE is set but empty (uv_os_homedir ENOENT), and a hook calling it at
// load crashed with exit 1 - failing open (2.1.7, the windows-2025 job). HOME answers then: Git Bash expands `~` from it.
const homeDir = () => { try { return os.homedir() || process.env.HOME || ''; } catch { return nativePath(process.env.HOME || ''); } };

// ---- the lexer: quotes, comments, heredocs and expansion regions in ONE pass ----------------------------------------
// Three scanners read quoting their own way until the eighth R015 review (2026-11-05) - heredocsOf, blankComments and
// quotedSpans - and every place one disagreed with bash hid a command from every guard. One pass now reads them all, as
// bash does, with a stack of contexts - the top, a `$( )`, a backtick, a `${ }`, an arithmetic `$(( ))` / `(( ))` /
// `$[ ]` - each with its own quote state, open `(` / `{` / `[` count and open `case` count:
//  - a `$((` or `((` is arithmetic only when the group its second `(` opens closes right before a `)`; when it closes on
//    anything else the region is read again as a substitution holding a subshell (`$((git push) )`), each open decided
//    once, and past a re-read budget every later one reads as a substitution - parsed as commands, never hidden;
//  - a backtick ends at the first unescaped backtick, inside quotes too (bash; zsh honours the quotes, and bash's
//    reading shows more), and a comment inside one ends there;
//  - a `case` word opens arms whose `)` close nothing; `esac` closes it wherever it stands (`in esac`, `a) esac`);
//  - a heredoc's delimiter is a shell WORD (`END-X`, `E"O"F`, `'1'`), its body starts after the first unquoted newline
//    past its opener, several openers on a line take their bodies in turn, and an opener in quotes, a comment, `${ }`
//    or arithmetic, or a here-string, is none. A terminator line matches with blanks around it - looser than bash, so a
//    body may end early and its rest read as commands, never the other way. A body with no terminator line runs to the
//    end of the text (bash and zsh read it so) - inside a backtick, to the backtick; inside a `$( )` the shells disagree
//    (bash 3.2 ends it at the `)`, bash 5 and zsh run it on), so its opener is `unsure`: unread to every guard.
// It yields:
//  - `spans`: quoted spans [start, end) with their quotes; a substitution inside double quotes pauses the span around it;
//  - `comments`: [start, end) of each comment (a `#` at a word start - not in `a#b`, `$#`, `${#x}`, after a substitution's
//    `)` or a backtick), and a PowerShell `<# ... #>` block in a shell context (the PowerShell route shares this parser);
//  - `docs`: each heredoc - `index` (its `<<`), `delim`, `strip`, `openEnd`, `lineStart` / `lineEnd`, `bodyStart` /
//    `bodyEnd` (up to the terminator line) and `end` (the end of the terminator line);
//  - `regions`: the open index of each `${ }`, arithmetic `$(( ))` / `(( ))` and `$[ ]` -> the index of its last char,
//    so the parser reads each as one word part and still opens the substitutions inside it;
//  - `close`: the text that shuts what the end leaves open - a body running to the end (its terminator line), a quote, a
//    `${ }` / `$[ ]`, a trailing backslash - so a script joined after it (gitText's carried ones) is read as commands.
// `subs` lists each `$( )` / backtick no other substitution holds - { open, close, kind }, one left open running to the
// end. `lexShell(body, true)` reads an UNQUOTED heredoc body the way bash expands it before its command reads it (only
// `\`, `$` and the backtick are special there), and `carriedOf` carries each of its `subs` as a script.
// A HEREDOC BODY is data, not shell: a plan that DESCRIBES a command is inert text.
const LEX_SPECIAL = new Uint8Array(128); // the characters the lexer reads; a run of any other is plain word text
for (const ch of '\\$()"\'`#<{}[]\n;&| \t') LEX_SPECIAL[ch.charCodeAt(0)] = 1;
const COMMENT_AFTER = new Set([' ', '\t', '\r', '\n', '\f', '\v', ';', '&', '|', '(', '>']);
const CMD_BEFORE = new Set([';', '&', '|', '(', '\n', '`']);
const CMD_KEYWORD_BEFORE = /(?:^|[\s;&|(`])(?:then|do|else|elif|if|while|until|\{|!)$/;
const WORD_END = /[\s;&|()<>]/;
// An ANSI-C quote (`$'...'`) opens at a `'` after an odd run of `$` none of which is escaped (`$$'x'` is the PID, then a
// plain quote); inside it a backslash escapes the next character, the closing quote included.
function ansiQuoteAt(text, i, escaped) {
  let k = i - 1;
  while (k >= 0 && text[k] === '$' && k !== escaped) k--;
  return (i - 1 - k) % 2 === 1;
}
function ansiCloseFrom(text, i) {
  for (let j = i; j < text.length; j++) { if (text[j] === '\\') j++; else if (text[j] === "'") return j; }
  return -1;
}
// The next unescaped backtick after `j`, or the end of the text.
function backtickAfter(text, j) {
  let k = text.indexOf('`', j + 1);
  while (k > 0 && text[k - 1] === '\\') k = text.indexOf('`', k + 1);
  return k < 0 ? text.length : k;
}
// Where a construct opened just before `from` ends, read as a string the way bash's parse_matched_pair reads one: `)`
// counts parens and `}` braces, quotes, escapes, backticks and nested `$( )` / `${ }` are skipped whole, and nothing is
// a comment or a heredoc. A `$((` that is no arithmetic is such a string first, so a heredoc in it ends with it (the
// tenth R015 review, 2026-11-05). The index of the closer, or the end of the text (`lim`).
function stringEnd(text, from, closer, lim = text.length) {
  const want = [closer];
  const depth = [0];
  for (let j = from; j < lim; j++) {
    const c = text[j];
    const top = want[want.length - 1];
    if (c === '\\') { j++; continue; }
    if (top === '"') {
      if (c === '"') { want.pop(); depth.pop(); } else if (c === '`') j = backtickAfter(text, j);
      else if (c === '$' && (text[j + 1] === '(' || text[j + 1] === '{')) { want.push(text[j + 1] === '(' ? ')' : '}'); depth.push(0); j++; }
      continue;
    }
    if (c === "'") { const e = text.indexOf("'", j + 1); if (e < 0) return lim; j = e; continue; }
    if (c === '"') { want.push('"'); depth.push(0); continue; }
    if (c === '`') { j = backtickAfter(text, j); continue; }
    if (c === '$' && (text[j + 1] === '(' || text[j + 1] === '{')) { want.push(text[j + 1] === '(' ? ')' : '}'); depth.push(0); j++; continue; }
    if (c === (top === ')' ? '(' : '{')) depth[depth.length - 1]++;
    else if (c === top) {
      if (depth[depth.length - 1]) depth[depth.length - 1]--;
      else { want.pop(); depth.pop(); if (!want.length) return j; }
    }
  }
  return lim;
}
// The heredoc delimiter WORD at `p`: its text with quotes and backslashes removed, whether any part was quoted, where it
// ends, and its quoted parts (spans). Any shell word is one: `$(x)`, `${E:-EOF}` and a backtick are read whole and kept
// as written. `lim` is where the backtick or string the opener stands in ends. Null when there is none.
function heredocWord(text, p, lim = text.length) {
  let j = p;
  let delim = '';
  let quoted = false;
  const quotes = [];
  while (j < lim && !WORD_END.test(text[j])) {
    const c = text[j];
    if (c === "'" || c === '"') {
      const e = text.indexOf(c, j + 1);
      if (e < 0 || e >= lim) return null;
      delim += text.slice(j + 1, e); quotes.push([j, e + 1]); quoted = true; j = e + 1;
      continue;
    }
    if (c === '\\') { if (j + 1 < lim) delim += text[j + 1]; quoted = true; j += 2; continue; }
    if ((c === '$' && (text[j + 1] === '(' || text[j + 1] === '{')) || c === '`') {
      const e = c === '`' ? backtickAfter(text, j) : stringEnd(text, j + 2, text[j + 1] === '(' ? ')' : '}', lim);
      if (e >= lim) return null;
      delim += text.slice(j, e + 1); j = e + 1;
      continue;
    }
    delim += c; j++;
  }
  return delim && !delim.includes('\n') ? { delim, quoted, end: Math.min(j, lim), quotes } : null;
}
// `eof` false reads a text whose heredoc bodies were BLANKED (blankComments, quotedSpans, parseShell): there a missing
// terminator line was blanked with its body, so an opener with none opens nothing - read as the raw text ran to its end,
// the joined carried scripts after it went unread (the fuzzer's second pass, 2026-11-05).
const lexMemo = [0, 1, 2].map(() => ({ text: null, out: null })); // one per mode
function lexShell(raw, doc = false, eof = true) {
  const text = String(raw || '');
  const memo = lexMemo[doc ? 1 : eof ? 0 : 2];
  if (memo.text !== text) { memo.out = lexCore(text, doc, eof); memo.text = text; }
  return memo.out;
}
// The lexer itself, unmemoised: a word's own read (`dequote`) never evicts the command's.
function lexCore(text, doc, eof = true) {
  const n = text.length;
  const spans = [];
  const comments = [];
  const docs = [];
  const regions = new Map();
  const regionOrder = [];
  const subs = [];
  const allSubs = []; // every `$( )` and backtick at any depth, [open, close]: a word's own substitutions, without a re-lex
  let unsure = -1; // a heredoc opener with no terminator line inside a `$( )`
  let doubt = -1; // the first place the reading stopped trusting itself: unread to every guard, never guessed
  let doubtWhy = '';
  const doubtAt = (at, why) => { if (doubt < 0 || at < doubt) { doubt = at; doubtWhy = why; } };
  const BUDGET_WHY = 'arithmetic read again past the re-read budget';
  // dash (sh on Debian and Ubuntu) reads `$[` as text, bash and zsh as arithmetic: a separator in it, or no `]`, splits
  // the command in dash alone (the eighth fuzz pass)
  const DASH_WHY = 'a $[ holding a separator or never closed: dash reads it as text, bash and zsh as arithmetic';
  // a doubt that outlives a rollback: what made it is in the text whichever way the region is read again
  let sticky = -1;
  let stickyWhy = '';
  // A quote at an arithmetic frame's own level: bash reads a quote, zsh (which scans `$((` as a double-quoted string) a
  // character. They end the scan apart when the quoted text holds a paren, a backtick, a backslash, a line or an
  // expansion, or never closes (the seventh fuzz pass: 173 cases pushed in zsh alone).
  const arithQuote = (i, q) => {
    const close = text.indexOf(q, i + 1);
    const span = text.slice(i + 1, close < 0 ? n : close);
    if ((close < 0 || /[()`\\\n]|\$[({[]/.test(span)) && (sticky < 0 || i < sticky)) { sticky = i; stickyWhy = 'a quote in an arithmetic scan: bash reads a quote, zsh a character'; }
  };
  let caseCount = 0; // the `case` words counted so far: an arithmetic frame holds one when the count grew since it opened
  let btDepth = 0; // the backtick frames open
  let subDepth = 0; // the `$( )` and backtick frames open
  const forced = new Set(); // an arithmetic open read again as a substitution
  let reread = 0; // characters read again; past 4n every later `$((` / `((` reads as a substitution
  // `lim`: where the innermost backtick or string around the frame ends; `sframe`: that frame (a heredoc in it ends there)
  const newFrame = (kind, open) => ({ kind, open, q: null, ansi: false, start: 0, parens: 0, cases: 0, snap: null, lim: n, sframe: null, end: undefined, cased0: 0 });
  const frames = [newFrame('top', -1)];
  let f = frames[0];
  if (doc) f.q = 'H'; // the body of an unquoted heredoc
  let escaped = -1; // the index the last backslash escaped (ansiQuoteAt)
  let opClose = -1; // the last `)` that closed a subshell or a case pattern: a `#` after it starts a comment
  let blockEnds = true; // false once no `#>` is left
  let pending = []; // heredoc openers waiting for the end of their command line
  let lines = null; // a terminator line's text (blanks trimmed) -> the start of every such line, in order
  let lastCase = -1; // the word caseWord read last (a word is reached from more than one side)
  let nextBt = -1; // the next unescaped backtick at or after the scan point
  const lineEndAt = (pos) => { const e = text.indexOf('\n', pos); return e < 0 ? n : e; };
  const firstAtOrAfter = (list, pos) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < pos) lo = mid + 1; else hi = mid; }
    return lo < list.length ? list[lo] : -1;
  };
  const backtickFrom = (pos) => {
    if (nextBt >= pos) return nextBt;
    let j = text.indexOf('`', pos);
    while (j > 0 && text[j - 1] === '\\') j = text.indexOf('`', j + 1);
    nextBt = j < 0 ? n : j;
    return nextBt;
  };
  const inBacktick = () => btDepth > 0;
  const shellFrame = () => f.kind === 'top' || f.kind === '$(' || f.kind === '`';
  const push = (kind, at, snap) => {
    if (f.q && f.q !== 'H') spans.push([f.start, at]); // the quote around a substitution pauses at it
    const parent = f;
    f = newFrame(kind, at);
    f.snap = snap || null;
    f.lim = parent.lim;
    f.sframe = parent.sframe;
    if (kind === '`') { btDepth++; f.lim = Math.min(f.lim, backtickFrom(at + 1)); f.sframe = f; }
    if (kind === 'arith') f.cased0 = caseCount;
    frames.push(f);
    if (kind === '$(' || kind === '`') subDepth++;
  };
  const pop = (at, region) => {
    if (frames.length < 2) return;
    const done = frames.pop();
    if (done.kind === '`') btDepth--;
    if ((done.kind === '$(' || done.kind === '`') && pending.length && pending[pending.length - 1].index > done.open) {
      // a heredoc opened in it with no body yet has none: a backtick or a `$((` read as a string ends there in every
      // shell, a `$( )` in zsh and bash 3.2 - bash 5 reads its body from the next lines, so that one is unread
      if (done.sframe !== done) doubtAt(pending.find((p) => p.index > done.open).index, 'a heredoc opened in a $( ) that closes on its line: zsh and bash 3.2 give it no body, bash 5 reads the next lines');
      pending = pending.filter((p) => p.index < done.open);
    }
    if (done.end !== undefined && at !== done.end) doubtAt(done.open, 'a $(( read again ends where bash does not');
    if (done.kind === '$(' || done.kind === '`') allSubs.push([done.open, at]);
    if (region) { regions.set(done.open, at); regionOrder.push(done.open); }
    if ((done.kind === '$(' || done.kind === '`') && --subDepth === 0) subs.push({ open: done.open, close: at, kind: done.kind });
    f = frames[frames.length - 1];
    if (f.q) f.start = at + 1; // and resumes after it
  };
  const snapshot = (at) => ({ at, spans: spans.length, comments: comments.length, docs: docs.length, subs: subs.length, allSubs: allSubs.length, unsure, doubt, doubtWhy, pending: pending.slice(), escaped, opClose, depth: frames.length, subDepth, btDepth });
  // the arithmetic frame on top closed on something but `)`: read its region again as a substitution
  const rollback = () => {
    const s = f.snap;
    spans.length = s.spans; comments.length = s.comments; docs.length = s.docs; subs.length = s.subs; allSubs.length = s.allSubs; unsure = s.unsure; doubt = s.doubt; doubtWhy = s.doubtWhy; btDepth = s.btDepth;
    pending = s.pending; escaped = s.escaped; opClose = s.opClose;
    frames.length = s.depth;
    f = frames[frames.length - 1];
    subDepth = s.subDepth; // the frames under the arithmetic one are the snapshot's: a recount walks every open frame
    while (regionOrder.length && regionOrder[regionOrder.length - 1] > s.at) regions.delete(regionOrder.pop());
    forced.add(s.at);
    lastCase = -1; nextBt = -1;
    return s.at - 1;
  };
  const arithOpen = (at) => !forced.has(at) && reread <= 4 * n;
  // the first non-blank past a blank run is found once per run (the twelfth review: from every blank, a heredoc body - blanked
  // to spaces - of one 118,000-character line took 11 s)
  let runFrom = -1;
  let runTo = -1;
  const caseWord = (at) => {
    let j = at + 1;
    if (j >= runFrom && j <= runTo) j = runTo;
    else { runFrom = j; while (j < n && (text[j] === ' ' || text[j] === '\t')) j++; runTo = j; }
    if (j === lastCase) return;
    const w = text.startsWith('case', j) ? 'case' : text.startsWith('esac', j) ? 'esac' : null;
    if (!w || (j + 4 < n && !WORD_END.test(text[j + 4]))) return;
    lastCase = j;
    if (w === 'esac') { if (f.cases) f.cases--; return; }
    let k = j - 1;
    while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
    if (k < 0 || CMD_BEFORE.has(text[k]) || CMD_KEYWORD_BEFORE.test(text.slice(Math.max(0, k - 5), k + 1))) {
      f.cases++;
      caseCount++; // an arithmetic frame open around it is read as a substitution: bash 5 does
    }
  };
  const bodies = (nl) => { // the newline at `nl` ends the openers' command line: their bodies follow, in turn
    if (!lines) {
      lines = new Map();
      for (let s = 0; s < n;) {
        const e = lineEndAt(s);
        const key = text.slice(s, e).replace(/\r$/, '').replace(/^[ \t]+|[ \t]+$/g, '');
        if (key) { let l = lines.get(key); if (!l) lines.set(key, (l = [])); l.push(s); }
        s = e + 1;
      }
    }
    let at = nl + 1;
    let last = nl;
    const limit = f.lim; // a backtick, or a `$((` read as a string, ends every body inside it
    const sf = f.sframe; // and only the heredocs opened in it take their bodies at its newlines
    const take = sf ? pending.filter((p) => p.index > sf.open) : pending;
    const keep = sf ? pending.filter((p) => p.index <= sf.open) : [];
    for (const p of take) {
      const bodyStart = Math.min(at, limit);
      let term = firstAtOrAfter(lines.get(p.delim) || [], bodyStart);
      if (term >= limit) term = -1;
      if (term < 0) { // no terminator line
        if (!eof) continue;
        // the innermost substitution decides: a backtick ends the body, a `$( )` leaves it unsure, none runs it on
        let k = frames.length - 1;
        while (k > 0 && frames[k].kind !== '$(' && frames[k].kind !== '`') k--;
        if (frames[k].kind !== '$(' || frames[k].end !== undefined) {
          docs.push({ index: p.index, delim: p.delim, strip: p.strip, quoted: p.quoted, openEnd: p.openEnd, lineStart: text.lastIndexOf('\n', p.index) + 1, lineEnd: nl, bodyStart, bodyEnd: limit, end: limit });
          last = Math.max(nl, limit - 1);
          break;
        }
        if (unsure < 0) unsure = p.index;
        continue;
      }
      const end = lineEndAt(term);
      docs.push({ index: p.index, delim: p.delim, strip: p.strip, quoted: p.quoted, openEnd: p.openEnd, lineStart: text.lastIndexOf('\n', p.index) + 1, lineEnd: nl, bodyStart, bodyEnd: term, end });
      at = end + 1;
      last = end;
    }
    pending = keep;
    return last;
  };
  // `$((` at `i` (the `$`): an arithmetic frame, or a substitution once it was read again
  const dollarParen = (i) => {
    if (text[i + 2] === '(') {
      if (arithOpen(i)) { push('arith', i, snapshot(i)); return i + 2; }
      if (!forced.has(i)) doubtAt(i, BUDGET_WHY);
    }
    push('$(', i);
    if (text[i + 2] === '(' && reread <= 4 * n) { // bash reads it as a string to the `)` its parens match
      f.end = stringEnd(text, i + 2, ')', f.lim);
      reread += f.end - i;
      f.lim = Math.min(f.lim, f.end);
      f.sframe = f;
    }
    caseWord(i + 1); return i + 1;
  };
  caseWord(-1);
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    if (code >= 128 || !LEX_SPECIAL[code]) continue;
    const c = text[i];
    if (f.q === "'") { // single quotes: nothing but the closing quote (and, in `$'...'`, an escaped character)
      const close = f.ansi ? ansiCloseFrom(text, i) : text.indexOf("'", i);
      if (f.kind === '`' || inBacktick()) { // bash ends a backtick at its first unescaped backtick, quotes or not
        const bt = backtickFrom(i);
        if (bt < n && (close < 0 || bt < close)) { spans.push([f.start, bt]); f.q = null; f.ansi = false; i = bt - 1; continue; }
      }
      if (close < 0) { spans.push([f.start, n]); f.q = null; break; }
      spans.push([f.start, close + 1]); f.q = null; f.ansi = false; i = close;
      continue;
    }
    if (c === '\\') { escaped = i + 1; i++; continue; }
    if (f.q === 'H') { // an unquoted heredoc body: quotes are text, a substitution runs
      if (c === '`') { push('`', i); caseWord(i); }
      else if (c === '$' && text[i + 1] === '(') i = dollarParen(i);
      else if (c === '$' && text[i + 1] === '{') { push('${', i); i++; }
      else if (c === '$' && text[i + 1] === '[') { push('$[', i); i++; }
      continue;
    }
    if (f.q === '"') { // double quotes: a substitution opens a context of its own
      if (c === '"') { spans.push([f.start, i + 1]); f.q = null; }
      else if (c === '$' && text[i + 1] === '(') i = dollarParen(i);
      else if (c === '`') {
        if (f.kind === '`') { spans.push([f.start, i]); f.q = null; pop(i); } else { push('`', i); caseWord(i); }
      }
      continue;
    }
    switch (c) {
      case "'": if (f.kind === 'arith') arithQuote(i, c); f.q = "'"; f.start = i; f.ansi = ansiQuoteAt(text, i, escaped); break;
      case '"': if (f.kind === 'arith') arithQuote(i, c); f.q = '"'; f.start = i; break;
      case '`': if (f.kind === '`') pop(i); else { push('`', i); caseWord(i); } break;
      case '$':
        if (text[i + 1] === '(') i = dollarParen(i);
        else if (text[i + 1] === '{') { push('${', i); i++; }
        else if (text[i + 1] === '[') { push('$[', i); i++; }
        break;
      case '{': if (f.kind === '${') f.parens++; break;
      case '}': if (f.kind === '${') { if (f.parens) f.parens--; else pop(i, true); } break;
      case '[': if (f.kind === '$[') f.parens++; break;
      case ']': if (f.kind === '$[') { if (f.parens) f.parens--; else pop(i, true); } break;
      case '(':
        if (f.kind === 'arith' || f.kind === '$[' || f.kind === '${') { if (f.kind === 'arith') f.parens++; break; }
        if (text[i + 1] === '(') {
          if (arithOpen(i)) { push('arith', i, snapshot(i)); i++; break; } // `(( ... ))`
          if (!forced.has(i)) doubtAt(i, BUDGET_WHY);
        }
        f.parens++;
        caseWord(i);
        break;
      case ')':
        if (f.kind === 'arith') {
          if (f.parens) { f.parens--; break; }
          // `))`: arithmetic - unless a `$((` holds a `case` (bash 5 reads it as a substitution) or a `;`, which no
          // arithmetic holds: then it is read again as one
          if (text[i + 1] === ')' && !(text[f.open] === '$' && (caseCount > f.cased0 || f.semi))) { pop(i + 1, true); i++; break; }
          if (reread + (i - f.open) > 4 * n) { doubtAt(f.open, BUDGET_WHY); pop(i, true); break; } // linear, and unread
          reread += i - f.open;
          i = rollback(); // the inner group closed on something else: a substitution holding a subshell
          break;
        }
        if (f.kind !== 'top' && f.kind !== '$(' && f.kind !== '`') break;
        if (f.parens) { f.parens--; opClose = i; break; }
        if (f.cases) { opClose = i; caseWord(i); break; } // a case arm's pattern
        if (f.kind === '$(') { pop(i); break; }
        opClose = i; // a stray `)`: a top-level case arm
        break;
      case '#': // a word start - never right after an escaped character (`a\ #b` is one word)
        if (shellFrame() && (i === 0 || (escaped !== i - 1 && (COMMENT_AFTER.has(text[i - 1]) || (text[i - 1] === ')' && opClose === i - 1))))) {
          let e = lineEndAt(i);
          e = Math.min(e, f.lim); // a backtick or a string ends it
          comments.push([i, e]);
          i = e - 1;
        }
        break;
      case '<':
        if (!shellFrame()) break;
        if (text[i + 1] === '#') { // a PowerShell block comment
          const end = blockEnds ? text.indexOf('#>', i + 2) : -1;
          if (end < 0) blockEnds = false;
          if (end > 0) { comments.push([i, end + 2]); i = end + 1; }
          break;
        }
        if (text[i + 1] !== '<') break;
        if (text[i + 2] === '<') { i += 2; break; } // a here-string
        {
          let j = i + 2;
          const strip = text[j] === '-';
          if (strip) j++;
          while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
          const w = heredocWord(text, j, f.lim);
          if (!w) { i++; break; }
          pending.push({ index: i, delim: w.delim, strip, quoted: w.quoted, openEnd: w.end });
          if (/[$`]/.test(text.slice(j, w.end))) { i = j - 1; break; } // `<<${E}`: the parser looks its region up
          for (const q of w.quotes) spans.push(q);
          i = w.end - 1;
        }
        break;
      case '\n':
        if (f.kind === '$[') doubtAt(f.open, DASH_WHY);
        if (pending.length && shellFrame()) i = bodies(i);
        if (shellFrame()) caseWord(i);
        break;
      case ';': case '&': case '|': case ' ': case '\t':
        if (shellFrame()) caseWord(i);
        else if (c === ';' && f.kind === 'arith') f.semi = true;
        else if (f.kind === '$[' && c !== ' ' && c !== '\t') doubtAt(f.open, DASH_WHY);
        break;
      default: break;
    }
  }
  if (f.q && f.q !== 'H') spans.push([f.start, n]);
  if (sticky >= 0) doubtAt(sticky, stickyWhy);
  for (const x of frames) if (x.kind === '$[') doubtAt(x.open, DASH_WHY);
  if (subDepth) { // a substitution the text leaves open runs to its end
    const k = frames.findIndex((x) => x.kind === '$(' || x.kind === '`');
    subs.push({ open: frames[k].open, close: n, kind: frames[k].kind });
    for (const x of frames) if (x.kind === '$(' || x.kind === '`') allSubs.push([x.open, n]);
  }
  let close = '';
  const open = docs.length && docs[docs.length - 1].end === n && docs[docs.length - 1].bodyEnd === n ? docs[docs.length - 1] : null;
  if (open) close = `\n${open.delim}`; // the body runs on: its terminator line ends it
  else {
    if (escaped === n) close = ' '; // a trailing backslash would join the next line
    for (let k = frames.length - 1; k >= 0; k--) {
      const x = frames[k];
      if (x.q === "'" || x.q === '"') close += x.q;
      if (x.kind === '${') close += '}'.repeat(x.parens + 1);
      else if (x.kind === '$[') close += ']'.repeat(x.parens + 1);
    }
    // a heredoc whose line the text ends has no body (bash: 'delimited by end-of-file'): what is joined after is not one
    if (pending.length) close += `\n${pending.map((p) => p.delim).join('\n')}`;
  }
  allSubs.sort((a, b) => a[0] - b[0]);
  return { spans, comments, docs, regions, subs, allSubs, unsure, doubt, doubtWhy, close };
}
function heredocsOf(text) {
  return lexShell(text).docs;
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
function heredocSubstitutions(body) { // lexShell's heredoc mode: one reader of a body's substitutions for every guard
  return lexShell(String(body || ''), true).subs.map((x) => ({ from: x.open + (x.kind === '$(' ? 2 : 1), to: x.close }));
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

// A COMMENT is not shell either: bash ignores a word that starts with `#` to the end of its line, so nothing in one can
// write - and an apostrophe in one ('the model's') flipped every quoted span after it (the source-protocol snippet init
// runs, 2026-09-27). Blank each comment lexShell finds, keep the length and every newline.
function blankComments(command) {
  const spans = lexShell(command, false, false).comments;
  if (!spans.length) return command;
  const parts = [];
  let cursor = 0;
  for (const [from, to] of spans) {
    parts.push(command.slice(cursor, from), command.slice(from, to).replace(/[^\n]/g, ' '));
    cursor = to;
  }
  parts.push(command.slice(cursor));
  return parts.join('');
}

// Quoted spans: a `>` or a verb inside '...' / "..." is text an outer command carries (a commit message, an echo, a grep
// pattern), never a write of its own. The write TARGET may still be quoted - the rules below dequote it - only the verb's
// own position is checked. A `$( ... )` or a backtick inside a double-quoted span is SHELL again, with its own quoting
// (`"$(grep -o 'Sdk="[^"]*"' f)"` once flipped every span after it - replayed at exit 2, ~112k tokens re-sent): lexShell
// pauses the outer span there and resumes it after the substitution.
function quotedSpans(command) {
  return lexShell(command, false, false).spans;
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
// `$'...'`'s escapes as bash and zsh read them: the letters, \NNN octal, \xHH, \uHHHH, \UHHHHHHHH, \cX a control character,
// \' \" \? (review 14: `$'\x67\x69\x74' push` and `eval $'gi\x74 push'` ran a push read as no git)
const unescape = (s) => {
  const str = String(s);
  let out = '';
  for (let i = 0; i < str.length;) {
    const j = str.indexOf('\\', i);
    if (j < 0) { out += str.slice(i); break; }
    out += str.slice(i, j);
    if (str[j + 1] === 'c' && j + 2 < str.length) { out += String.fromCharCode(str.charCodeAt(j + 2) & 31); i = j + 3; continue; }
    const e = escapeAt(str, j, true);
    if (e.len === 1 && j + 1 < str.length) { // an escape neither knows: bash keeps the backslash, zsh drops it (`$'g\it'`)
      readingsDiffer = true;
      if (!bashReading) { i = j + 1; continue; }
    }
    out += e.text;
    i = j + e.len;
  }
  const nul = out.indexOf('\0');
  return nul < 0 ? out : out.slice(0, nul); // a NUL ends the word in every shell (review 15: `$'git\0x' push`)
};
const PLAIN_WORD = /^[^"'\\$]*$/;
// A Windows path written bare on Windows (`C:\Users\x\f.txt`, `\\server\share\f`, `if=C:\x`) is the path the session
// means, never bash's escape of each letter. Read as bash it collapsed to `C:Usersxf.txt`, a relative name, so every
// guard judged an out-of-project write, a `-C` into a sibling repo and a credential read as this project's own file
// (2.1.6 CI: the windows-2025 job red on 30 guard cases; the reader before the one-shell rewrite kept the backslashes).
const WIN_PATH_WORD = /^(?:[\w.-]*=)?(?:[A-Za-z]:\\|\\\\)[^"'$`]*$/;
// The outermost substitutions of the word at [s, e) of a lexed text, as word offsets: a binary search of the lex's
// `allSubs`, so a word nested 4,000 deep costs no lex of its own (the tenth review: each word's re-lex was quadratic).
function subsIn(lex, s, e) {
  const a = lex.allSubs;
  const map = new Map();
  const firstFrom = (lo, at) => { let hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < at) lo = m + 1; else hi = m; } return lo; };
  for (let k = firstFrom(0, s); k < a.length && a[k][0] < e; k = firstFrom(k + 1, a[k][1] + 1)) map.set(a[k][0] - s, Math.min(a[k][1], e - 1) - s);
  return map;
}
function dequote(raw, platform = process.platform, subsHint = null) {
  if (PLAIN_WORD.test(raw)) return raw;
  if (platform === 'win32' && WIN_PATH_WORD.test(raw)) return raw;
  // a substitution is kept as written: bash removes no quote inside one (`"echo `echo '`"` hands on `echo `echo '``)
  const subAt = subsHint || (/\$\(|`/.test(raw) ? new Map(lexCore(raw, false).subs.map((x) => [x.open, x.close])) : null);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (subAt && subAt.has(i)) { out += raw.slice(i, subAt.get(i) + 1); i = subAt.get(i); continue; }
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
        if (subAt && subAt.has(i)) { out += raw.slice(i, subAt.get(i) + 1); i = subAt.get(i); continue; }
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
// Audit 2026-10-10 C13: a substitution with another delimiter (`s#a#b#g`, `s|a|b|`) and an address's text command
// (`/^Build waves/a\ X`, `3i\ line`, `$a text`) are scripts too - read as paths, they blocked in-project edits as
// cross-project writes (0498718d, fbfc2de4) and filled COMPACT-STATE with sed scripts (68da4b6b). The other delimiters
// are the ones scripts use; a `.`, `-` or `_` stays out, so `s.a.b.ts` is still a file.
const SED_ADDR = String.raw`(?:\/(?:[^/\\]|\\.)*\/|\$|\d+)(?:,(?:\/(?:[^/\\]|\\.)*\/|\$|\d+))?`;
const SED_SCRIPT_ARG = new RegExp(String.raw`^(?:${SED_ADDR}[dpq=]|[sy]([/#|:,@!~+%^;])(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[a-zA-Z0-9]*|(?:${SED_ADDR})?[aic](?:\\|\s)[\s\S]*)$`);

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
  'command', 'exec', 'builtin', 'eval', 'coproc', 'npx', 'bunx', 'chronic', 'unbuffer', 'setsid', 'busybox', 'toybox']);
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
  constructor(src, s, e, lex) { this.src = src; this.s = s; this.e = e; this.lex = lex || null; this.dq = undefined; this._raw = undefined; }
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
  const lex = lexShell(command, false, false); // the caller blanked its heredoc bodies
  const spans = sortedByStart(lex.spans);
  // a `${ }`, `$(( ))` or `$[ ]` region (lexShell's `regions`) is part of its word: its text is data, but a `$( )` or a
  // backtick inside it still runs - each region on this stack ends at its last char
  let region = [];
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
      ctx.kwOnly = true; // every word of the command so far is a keyword (`if`, `then`, `!`...)
      cmds.push(ctx.cmd);
      ctx.cmds.push(ctx.cmd);
    }
    return ctx.cmd;
  };
  const endWord = (i) => {
    if (wStart < 0) return;
    const t = new Tok(command, wStart, i, lex);
    wStart = -1;
    if (redir) { redir.target = t; const cmd = cmdOf(); if (cmd.redirs === NO_REDIRS) cmd.redirs = []; cmd.redirs.push(redir); redir = null; return; }
    cmdOf().words.push(t);
    const lead = ctx.kwOnly;
    if (!KEYWORDS.has(t.raw)) ctx.kwOnly = false; // a flag, not a walk of the words: a long command stays linear
    // `case` as a command word opens arms whose `)` close nothing; `esac` closes it wherever it stands (`case a in esac`)
    if (t.raw === 'case' && lead) ctx.cases = (ctx.cases || 0) + 1;
    else if (t.raw === 'esac' && ctx.cases > 0) ctx.cases--;
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
    // the commands made while a frame is open are its own, a contiguous run of indexes [cmdFrom, cmdTo)
    const frame = { kind, open: i, close: undefined, parent: ctx.frame, cmdFrom: cmds.length, cmdTo: undefined };
    frames.push(frame);
    if (++depth > MAX_NEST) tooDeep = true;
    stack.push({ frame, ctx, wStart, redir, region });
    region = [];
    if (kind === '(') { endElem(i, i + len); stack[stack.length - 1].ctx = ctx; }
    ctx = newCtx(i + len, frame);
    wStart = -1;
    redir = null;
    return frame;
  };
  // Past MAX_NEST a substitution is word text to the lexer's close of it: the reading is unread anyway (`tooDeep`), and
  // building every deeper command made a 48,000-character nest quadratic (the tenth review). -1 below the cap.
  let subClose = null;
  const deepSkip = (i) => {
    if (depth < MAX_NEST) return -1;
    if (!subClose) subClose = new Map(lex.allSubs);
    const e = subClose.get(i);
    if (e === undefined) return -1;
    tooDeep = true;
    if (wStart < 0) wStart = i;
    return e;
  };
  const close = (i) => {
    const top = stack.pop();
    depth--;
    endWord(i);
    endElem(i, i + 1);
    top.frame.close = i;
    top.frame.cmdTo = cmds.length;
    ctx = top.ctx;
    region = top.region || [];
    if (top.frame.kind === '(') { ctx.from = i + 1; wStart = -1; redir = top.redir; return; }
    // a substitution is part of the word that holds it: that word runs on past the closing mark
    wStart = top.wStart >= 0 ? top.wStart : top.frame.open;
    redir = top.redir;
  };
  let sp = 0;
  for (let i = 0; i < n; i++) {
    while (region.length && i > region[region.length - 1]) region.pop();
    if (region.length) {
      if (i === region[region.length - 1]) { region.pop(); continue; } // the region's last char
      while (sp < spans.length && spans[sp][0] < i) sp++;
      if (sp < spans.length && spans[sp][0] === i) { i = Math.max(i, spans[sp][1] - 1); sp++; continue; }
      const r = command[i];
      if (r === '\\') { i++; continue; }
      if (r === '$' && (command[i + 1] === '(' || command[i + 1] === '{' || command[i + 1] === '[')) {
        const e = lex.regions.get(i);
        if (e !== undefined) { region.push(e); i++; continue; }
        if (command[i + 1] === '(') { const e = deepSkip(i); if (e >= 0) i = e; else { open('$(', i, 2); i++; } }
        continue;
      }
      if (r === '`') {
        if (stack.length && stack[stack.length - 1].frame.kind === '`') close(i);
        else { const e = deepSkip(i); if (e >= 0) i = e; else open('`', i, 1); }
      }
      continue;
    }
    // a quoted span first: one resuming after a substitution starts on any character (`"$(date) is; now"`), and the
    // runs below read past it (the fuzzer's fourth pass)
    while (sp < spans.length && spans[sp][0] < i) sp++;
    if (sp < spans.length && spans[sp][0] === i) { // a quoted span: part of the word, whatever it holds
      if (wStart < 0) wStart = i;
      i = Math.max(i, spans[sp][1] - 1);
      sp++;
      continue;
    }
    const code = command.charCodeAt(i);
    const cls = code < 128 ? CHAR_CLASS[code] : 0;
    const next = sp < spans.length ? spans[sp][0] : n; // a run stops where the next span starts
    if (cls === 0) { // a run of plain word characters
      if (wStart < 0) wStart = i;
      let j = i + 1;
      while (j < next) { const k = command.charCodeAt(j); if (k < 128 && CHAR_CLASS[k] !== 0) break; j++; }
      i = j - 1;
      continue;
    }
    if (cls === 1) { // a run of blanks
      endWord(i);
      let j = i + 1;
      while (j < next && CHAR_CLASS[command.charCodeAt(j)] === 1) j++;
      i = j - 1;
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
    if (c === '(') {
      // `NAME=( ... )` / `NAME+=( ... )` is an ARRAY assignment, never a subshell: `LIVE=(<file>.md)` ran the file as a
      // script and blocked a read-only scan as a write to '/' (audit 2026-10-10, session bba03dad).
      if (wStart >= 0 && /^[A-Za-z_]\w*\+?=$/.test(command.slice(wStart, i))) {
        let lvl = 0; let j = i; let q = sp;
        for (; j < n; j++) {
          while (q < spans.length && spans[q][0] < j) q++;
          if (q < spans.length && spans[q][0] === j) { j = Math.max(j, spans[q][1] - 1); q++; continue; }
          if (command[j] === '\\') { j++; continue; }
          if (command[j] === '(') lvl++;
          else if (command[j] === ')' && --lvl === 0) break;
        }
        i = Math.min(j, n - 1);
        continue;
      }
      endWord(i); open('(', i, 1); continue;
    }
    if (c === ')') {
      endWord(i);
      // a `case` arm's `)` - at the top, or inside a substitution whose `case` is open - ends its pattern: a command
      // starts after it; any other closes the context it is in
      if (stack.length && !(ctx.cases > 0)) { close(i); continue; }
      endElem(i, i + 1);
      continue;
    }
    if (c === '`') {
      if (stack.length && stack[stack.length - 1].frame.kind === '`') { close(i); continue; }
      const e = deepSkip(i);
      if (e >= 0) { i = e; continue; }
      open('`', i, 1);
      continue;
    }
    if (c === '$') {
      const d = command[i + 1];
      if (d === '(' || d === '{' || d === '[') { // `$((` arithmetic, `${ }`, `$[ ]`: part of the word, as lexShell reads it
        const e = lex.regions.get(i);
        if (e !== undefined || d === '{') {
          if (wStart < 0) wStart = i;
          region.push(e !== undefined ? e : n - 1);
          i++;
          continue;
        }
      }
      if (d === '(') { const e = deepSkip(i); if (e >= 0) { i = e; continue; } open('$(', i, 2); i++; continue; }
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
    top.frame.cmdTo = cmds.length;
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
  // a `$'...'` part is quoting, no expansion (review 15: `x=$'git'; bash -c "$x push"` read no push)
  const d = /[$`]/.test(v.replace(/\$'(?:[^'\\]|\\[\s\S])*'/g, '')) ? '' : dequote(v);
  if (d) assigns.set(m[1], d);
  // `raw` keeps the value as written (a single-quoted `'$HOME'` is text, never expanded - shellVars reads it)
  events.push({ at: tok.s, kind: 'set', name: m[1], value: dequote(v), raw: v });
  return true;
}
// The command words of one simple command: { at (its index in words), name (normalised), word (dequoted), via (the
// wrapper before it, if any), args (the argument words that command reads: to the end of the simple command, or to
// an -exec action's `;` / `+`) }.
const dqTok = (t) => (t.dq === undefined ? (t.dq = dequote(t.raw, process.platform, t.lex && /[$`]/.test(t.raw) ? subsIn(t.lex, t.s, t.e) : null)) : t.dq);
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
const LOOKUP_FLAG = /^-[pvV]*[vV][pvV]*$/; // `command -v`, `-V`, `-pv`: a lookup, no run
function commandWordsOf(cmd, assigns, events) {
  const w = cmd.words;
  const out = [];
  const dq = (k) => dqTok(w[k]);
  let wrapper = null;
  let afterFlag = false;
  let lookup = false;
  let maybeValue = false; // the wrapper word just read may be the previous flag's value (`env -u command -v git push`)
  let k = 0;
  const chain = [];
  const cand = (at, via) => { const word = dq(at); const c = new Cand(cmd, at, word, normCmd(word, assigns), via, chain.length ? chain.slice() : NO_CHAIN); out.push(c); return c; };
  const lead = events.length; // the leading assignments: a PREFIX of the command word after them (`H=/x rm $H` expands the old H)
  for (; k < w.length; k++) {
    const raw = w[k].raw;
    if (!wrapper) {
      if (ASSIGN.test(raw)) { noteAssign(assigns, events, w[k]); continue; }
      if (KEYWORDS.has(raw)) continue;
      const c = cand(k, null);
      if (WRAPPERS.has(c.name)) { wrapper = c.name; maybeValue = false; chain.push(c.name); afterFlag = false; continue; }
      if (RUN_TOOLS.has(c.name) && w[k + 1] && dq(k + 1) === 'run') { wrapper = c.name; chain.push(c.name); afterFlag = false; k++; continue; }
      break;
    }
    const word = dq(k);
    // `time` is the shell's reserved word, not a program: it takes a whole pipeline, a keyword included (`time until
    // gh pr merge; do ...; done`, the seventh R015 review)
    if (wrapper === 'time' && KEYWORDS.has(raw)) continue;
    // `command -v` / `-V` looks the words after it up and runs none of them (the source-protocol snippet's PATH check,
    // `for T in git tr ...; do command -v "$T"`, read as an unknown git call once a loop name took its list)
    if (wrapper === 'command' && !maybeValue && LOOKUP_FLAG.test(word)) { lookup = true; break; }
    if (word.startsWith('-')) { afterFlag = true; continue; }
    if (/^\d[\w.]*$/.test(word) || ASSIGN.test(raw)) { afterFlag = false; continue; }
    const c = cand(k, wrapper);
    if (WRAPPERS.has(c.name)) { wrapper = c.name; maybeValue = afterFlag; chain.push(c.name); afterFlag = false; continue; }
    if (RUN_TOOLS.has(c.name) && w[k + 1] && dq(k + 1) === 'run') { wrapper = c.name; chain.push(c.name); afterFlag = false; k++; continue; }
    if (afterFlag) { afterFlag = false; continue; } // perhaps the flag's value: the next word may be the command
    break;
  }
  // A runner the lists above do not name (`xcrun git push`, `bundle exec`, `op run --`, `direnv exec .`, `flock`,
  // `setsid`): a bare `git` word after a head that only prints, reads or edits data is the call, so a runner the
  // stack never heard of does not hide it (2.1.6 re-verify 4 R4-M2 - the base gated any word sequence that reached
  // git). A package runner counts only right after its run / exec verb: `npm run lint -- --fix git x` names a script
  // argument.
  if (out.length && k < w.length && !lookup) {
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
  if (out.length) for (let e = lead; e < events.length; e++) events[e].prefix = true;
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
    const at = k;
    if (run) k++;
    for (k++; k < words.length; k++) {
      const a = wordOf(words[k]);
      if (name === 'command' && LOOKUP_FLAG.test(a)) return at; // a lookup: `command` is the command
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
    // a listing (`--contains <sha>`, `--points-at`, `--merged`, `-l`, `-n<N>`, a `--sort`) reads; a delete, or a new name, writes
    // (audit 2026-10-10, session bba03dad: `git tag --contains <sha>` blocked a read-only seat)
    case 'tag':
      if (argv.some((a) => /^(?:-d|--delete)$/.test(a))) return true;
      if (argv.some((a) => /^(?:-l|--list|-n\d*|--(?:no-)?contains(?:=.*)?|--points-at(?:=.*)?|--(?:no-)?merged(?:=.*)?|--sort(?:=.*)?|--column(?:=.*)?|--format(?:=.*)?|-v|--verify)$/.test(a))) return false;
      return argv.length > 0 && argv.some((a) => !a.startsWith('-'));
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
// unlink, shred and the trash CLIs remove a file like rm (E1-2c): each operand is a target. shred's -n / -s values are counts.
const FS_CHANGE = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'truncate', 'chmod', 'chown', 'rimraf', 'unlink', 'shred', 'trash', 'trash-put']);
const SHRED_VALUE = new Set(['-n', '--iterations', '-s', '--size']);
const COPY_VERBS = new Set(['cp', 'mv', 'ln', 'install', 'rsync']);
const IN_PLACE = /^-[A-Za-z]*i(?![A-Za-z0-9_])/;
// sed's own argument grammar (GNU and BSD): which words are its in-place TARGETS. The script is the first operand unless
// -e / -f (or --expression / --file) name it, so every other operand is a file, whatever its text looks like - reading
// the script by its SHAPE missed `/a/d;/b/d` and `/x/s/a/b/` and blocked 27 of 47 cross-project writes as an
// out-of-project path (hooks review 2026-10-16). `-i` / `-I` end their flag word (the rest is the backup suffix:
// `-i.bak`, `-ie`); a bare one takes the next word as BSD's suffix only when it is one (`''`, `.bak`), so GNU's
// `sed -i 's/a/b/' f` keeps its script. `--` ends the options.
const SED_SUFFIX = /^(?:\.[\w.~-]*)?$/;
function sedTargets(argv) {
  let inPlace = false;
  let scripted = false;
  const operands = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { operands.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const m = /^--([a-z-]+)(=?)/.exec(a) || ['', '', ''];
      if (m[1] === 'in-place') inPlace = true;
      else if (m[1] === 'expression' || m[1] === 'file') { scripted = true; if (!m[2]) i++; }
      else if (m[1] === 'line-length' && !m[2]) i++;
      continue;
    }
    if (a.length < 2 || a[0] !== '-') { operands.push(a); continue; }
    for (let k = 1; k < a.length; k++) {
      const flag = a[k];
      const last = k === a.length - 1;
      if (flag === 'e' || flag === 'f') { scripted = true; if (last) i++; break; }
      if (flag === 'i' || flag === 'I') { inPlace = true; if (last && i + 1 < argv.length && SED_SUFFIX.test(argv[i + 1])) i++; break; }
      if (flag === 'l') { if (last && /^\d+$/.test(argv[i + 1] || '')) i++; break; }
    }
  }
  return inPlace ? (scripted ? operands : operands.slice(1)) : [];
}
const WRITE_REDIRS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
// `>&word` is `&>word` unless the word is a descriptor (`>&2`, `>&-`).
const isFileRedir = (r) => r.target && (WRITE_REDIRS.has(r.op) || (r.op === '>&' && !/^(?:\d+|-)$/.test(r.target.raw)));
// The target words of one command word, as { raw, index, what, verb, argv }: `raw` dequoted, `index` where the command
// word (or the redirect) stands, `argv` the command's own words (a copy's sources, an extract's archive - the config
// guard reads what a copy or extract LANDS through `copyPlan` / `tarPlan` / `unzipPlan`). `opts.landing` also reports an
// extract with no destination as one into the working folder (`.`), which only a caller asking for it reads.
function writesOf(cmd, c, out, opts = {}) {
  const index = cmd.words[c.at].s;
  const name = c.name;
  const lower = name.toLowerCase();
  const verb = name === 'rimraf' ? 'rm' : name;
  const push = (raw, what, v = verb) => out.push({ raw, index, what, verb: v, argv: c.argv });
  const plain = (a) => a && !a.startsWith('-');
  if (name === 'tee') {
    for (const a of c.argv) if (plain(a)) push(a, 'a `tee` write');
  } else if (name === 'sponge') {
    // moreutils' `sponge [-a] <file>` soaks its stdin and writes the file (review fix pass run B M1: `jq ... f | sponge f`)
    for (const a of c.argv) if (plain(a)) push(a, 'a `sponge` write');
  } else if (name === 'sed') {
    // in-place edits: every file operand, not just the last - `sed -i 's/a/b/' ../other/f x`
    for (const a of sedTargets(c.argv)) if (a) push(a, 'an in-place edit');
  } else if (name === 'perl' && c.argv.some((a) => IN_PLACE.test(a))) {
    for (const a of c.argv) if (plain(a) && !SED_SCRIPT.test(a) && !SED_SCRIPT_ARG.test(a)) push(a, 'an in-place edit');
  } else if (FS_CHANGE.has(name)) {
    // every argument counts: `rm -f a ../other/b`, `chmod +x ../other/x` - but chmod's MODE and chown's OWNER are the
    // first operand, never a path (`+x`, `755`, `u+x,g-w`, `user:group`), unless --reference names the file to copy
    // them from (audit 2026-10-10, session 758ce661: COMPACT-STATE listed '+x' as a file written)
    let skip = (name === 'chmod' || name === 'chown') && !c.argv.some((a) => a.startsWith('--reference'));
    let count = false;
    for (const a of c.argv) {
      if (count) { count = false; continue; }
      if (name === 'shred' && SHRED_VALUE.has(a)) { count = true; continue; }
      // `chmod -x f` / `chmod -w f`: a mode spelled like a flag
      if (skip && name === 'chmod' && /^-[rwxXst]+$/.test(a)) { skip = false; continue; }
      if (!plain(a) || SED_SCRIPT.test(a)) continue;
      if (skip) { skip = false; continue; }
      push(a, 'a filesystem change');
    }
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
    for (const t of gitDestinations(call)) push(t, 'a git write in another checkout', 'git');
  } else {
    const dests = verbDestinations(lower, c.argv);
    for (const t of dests) push(t, 'a download, extract or patch destination');
    if (opts.landing && !dests.length && extractsHere(lower, c.argv)) push('.', 'an extract into the working folder');
  }
}

// ---- the other write verbs' destinations (audit 2026-10-30 HK-14) --------------------------------------------------
// `curl -o`, `wget -O`, `tar -C` / `tar cf`, `unzip -d`, `dd of=`, `patch <file>`, and `git init` / `git clone` /
// `git apply --directory` wrote into a sibling folder unjudged. Each verb's own option grammar names its destination;
// `-` (stdout) and a remote-named download (`curl -O`, `wget` with no `-O`) name none.
const CURL_FLAGS = 'sSLfkviIONgGjJlnqR#:Z';
function flagValue(argv, i, letter, flags) {
  // a cluster of value-less flags ending in `letter` takes the next word; one with text after `letter` holds it
  const a = argv[i];
  if (a.length < 2 || a[0] !== '-' || a[1] === '-') return null;
  const k = a.indexOf(letter, 1);
  if (k < 0 || ![...a.slice(1, k)].every((ch) => flags.includes(ch))) return null;
  return k === a.length - 1 ? { value: argv[i + 1], skip: 1 } : { value: a.slice(k + 1), skip: 0 };
}
function longValue(argv, i, names) {
  const a = argv[i];
  for (const n of names) {
    if (a === n) return { value: argv[i + 1], skip: 1 };
    if (a.startsWith(`${n}=`)) return { value: a.slice(n.length + 1), skip: 0 };
  }
  return null;
}
function verbDestinations(verb, argv) {
  const out = [];
  const take = (v) => { if (v && v !== '-') out.push(v); };
  const walk = (fn) => { for (let i = 0; i < argv.length; i++) { const r = fn(i); if (r) { take(r.value); i += r.skip; } } };
  if (verb === 'curl') {
    walk((i) => longValue(argv, i, ['--output', '--output-dir', '--dump-header', '--cookie-jar']) || flagValue(argv, i, 'o', CURL_FLAGS) || flagValue(argv, i, 'D', CURL_FLAGS) || flagValue(argv, i, 'c', CURL_FLAGS));
  } else if (verb === 'wget') {
    walk((i) => longValue(argv, i, ['--output-document', '--directory-prefix', '--output-file', '--append-output'])
      || flagValue(argv, i, 'O', 'qvnckNrpSx') || flagValue(argv, i, 'P', 'qvnckNrpSx') || flagValue(argv, i, 'o', 'qvnckNrpSx') || flagValue(argv, i, 'a', 'qvnckNrpSx'));
  } else if (verb === 'unzip') {
    walk((i) => (argv[i] === '-d' ? { value: argv[i + 1], skip: 1 } : /^-d./.test(argv[i]) ? { value: argv[i].slice(2), skip: 0 } : null));
  } else if (verb === 'dd') {
    for (const a of argv) if (a.startsWith('of=')) take(a.slice(3));
  } else if (verb === 'tar' || verb === 'bsdtar' || verb === 'gtar') {
    out.push(...tarDestinations(argv));
  } else if (verb === 'patch') {
    out.push(...patchDestinations(argv));
  }
  return out;
}
// tar: an extract writes under `-C <dir>`; a create, append or update writes its archive (`-f <file>`, or the word an
// old-style cluster's `f` takes: `tar czf out.tgz src`). A listing writes nothing.
function tarDestinations(argv) {
  const { mode, archive, dirs } = tarPlan(argv);
  const out = [];
  if (mode === 'x') out.push(...dirs.filter(Boolean));
  if ('cru'.includes(mode) && mode && archive && archive !== '-') out.push(archive);
  return out;
}
// One tar call's grammar: { mode ('x', 'c', 'r', 'u', 't' or ''), archive (null when it reads stdin or a tape), dirs (each
// `-C`), strip (`--strip-components`), renamed (`--transform` / `--xform` / bsdtar's `-s` - names the reader cannot
// follow), absolute (`-P` / `--absolute-names`) }. GNU tar opens the archive where the shell stands, before any `-C`.
const TAR_VALUE_LONG = ['--directory', '--file', '--strip-components', '--transform', '--xform', '--exclude', '--exclude-from', '--files-from',
  '--use-compress-program', '--owner', '--group', '--mode', '--mtime', '--newer', '--after-date', '--format', '--blocking-factor', '--record-size',
  '--label', '--volno-file', '--to-command', '--checkpoint-action', '--suffix', '--rsh-command', '--index-file', '--level', '--listed-incremental'];
function tarPlan(argv) {
  let mode = '';
  let archive = null;
  const dirs = [];
  let strip = 0;
  let renamed = false;
  let absolute = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const long = /^--(extract|get|create|append|update|list|diff|compare|delete)$/.exec(a);
    if (long) { mode = { extract: 'x', get: 'x', create: 'c', append: 'r', update: 'u', list: 't' }[long[1]] || mode; continue; }
    if (a === '--absolute-names') { absolute = true; continue; }
    const lv = longValue(argv, i, TAR_VALUE_LONG);
    if (lv) {
      const opt = a.replace(/=.*$/, '');
      if (opt === '--directory') dirs.push(lv.value);
      else if (opt === '--file') archive = lv.value;
      else if (opt === '--strip-components') strip = /^\d+$/.test(String(lv.value)) ? Number(lv.value) : -1;
      else if (opt === '--transform' || opt === '--xform') renamed = true;
      i += lv.skip;
      continue;
    }
    if (a.startsWith('--')) continue;
    // the first word may be an old-style cluster with no dash (`xzf`, `czf`)
    const cluster = a.startsWith('-') ? a.slice(1) : (i === 0 && /^[A-Za-z]+$/.test(a) ? a : null);
    if (cluster === null) continue;
    for (let k = 0; k < cluster.length; k++) {
      const ch = cluster[k];
      if ('xcrutd'.includes(ch) && !mode) mode = ch === 'd' ? 't' : ch;
      if (ch === 'P') absolute = true;
      if (ch === 'f' || ch === 'C' || ch === 's') {
        const rest = cluster.slice(k + 1);
        const v = a.startsWith('-') && rest ? rest : argv[++i];
        if (ch === 'f') archive = v; else if (ch === 'C') dirs.push(v); else renamed = true;
        break;
      }
    }
  }
  return { mode, archive: archive && archive !== '-' ? archive : null, dirs: dirs.filter(Boolean), strip, renamed, absolute };
}
// unzip [opts] <archive> [members] [-x excluded] [-d dir]: { archive, dir, junk (`-j`: every entry lands by its last name),
// extracts (false for a listing, a test or a print to stdout) }.
function unzipPlan(argv) {
  let archive = null;
  let dir = null;
  let junk = false;
  let extracts = true;
  let excluding = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-d') { dir = argv[++i] || null; excluding = false; continue; }
    if (/^-d./.test(a)) { dir = a.slice(2); continue; }
    if (a === '-x') { excluding = true; continue; }
    if (a === '-P') { i++; continue; }
    if (a.startsWith('-') && a.length > 1) {
      excluding = false;
      if (/[lvtzZpc]/.test(a.slice(1))) extracts = false;
      if (a.slice(1).includes('j')) junk = true;
      continue;
    }
    if (excluding) continue;
    if (archive === null) archive = a;
  }
  return { archive, dir, junk, extracts };
}
// An extract with no destination of its own writes into the working folder.
function extractsHere(verb, argv) {
  if (verb === 'tar' || verb === 'bsdtar' || verb === 'gtar') { const t = tarPlan(argv); return t.mode === 'x' && !t.dirs.length; }
  if (verb === 'unzip') { const z = unzipPlan(argv); return z.extracts && !z.dir && Boolean(z.archive); }
  return false;
}
// One copy, move, link or install call's grammar (GNU and BSD): { sources, dest, intoDir (`-t` named the folder),
// fileDest (`-T`: the destination is the file itself), recursive, parents (`--parents`, rsync's `-R`: the source's
// path as written is kept under the folder), symbolic (`ln -s`) }. A value option's word is never an operand.
const COPY_VALUE_SHORT = { cp: 'S', mv: 'S', ln: 'S', install: 'mogSt', rsync: 'eBfMT@' };
const COPY_VALUE_LONG = new Set(['--suffix', '--target-directory', '--mode', '--owner', '--group', '--strip-program', '--exclude', '--include',
  '--filter', '--rsh', '--rsync-path', '--files-from', '--exclude-from', '--include-from', '--backup-dir', '--chmod', '--chown', '--usermap',
  '--groupmap', '--link-dest', '--compare-dest', '--copy-dest', '--partial-dir', '--temp-dir', '--log-file', '--log-file-format',
  '--out-format', '--password-file', '--port', '--timeout', '--contimeout', '--bwlimit', '--max-size', '--min-size', '--max-delete',
  '--block-size', '--compress-level', '--skip-compress', '--modify-window', '--info', '--debug', '--iconv', '--checksum-choice',
  '--compress-choice', '--sockopts', '--address', '--protocol', '--outbuf', '--stop-after', '--stop-at', '--remote-option']);
function copyPlan(verb, argv) {
  const operands = [];
  let tdir = null;
  let fileDest = false;
  let recursive = verb === 'mv';
  let parents = false;
  let symbolic = false;
  const valueShort = COPY_VALUE_SHORT[verb] || '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { operands.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const name = a.replace(/=.*$/, '');
      const inline = a.includes('=') ? a.slice(a.indexOf('=') + 1) : null;
      if (name === '--target-directory') tdir = inline !== null ? inline : argv[++i];
      else if (name === '--no-target-directory') fileDest = true;
      else if (name === '--recursive' || name === '--archive') recursive = true;
      else if (name === '--parents' || name === '--relative') parents = true;
      else if (name === '--symbolic') symbolic = true;
      else if (COPY_VALUE_LONG.has(name) && inline === null) i++;
      continue;
    }
    if (a.length < 2 || a[0] !== '-') { operands.push(a); continue; }
    for (let k = 1; k < a.length; k++) {
      const ch = a[k];
      if (ch === 't' && verb !== 'rsync') { tdir = k < a.length - 1 ? a.slice(k + 1) : argv[++i]; break; }
      if (valueShort.includes(ch)) { if (k === a.length - 1) i++; break; }
      if (ch === 'T' && verb !== 'rsync') fileDest = true;
      if ('rRa'.includes(ch) && (verb === 'cp' || verb === 'rsync')) { recursive = true; if (ch === 'R' && verb === 'rsync') parents = true; }
      if (ch === 's' && verb === 'ln') symbolic = true;
    }
  }
  if (tdir) return { sources: operands, dest: tdir, intoDir: true, fileDest: false, recursive, parents, symbolic };
  const dest = operands.length >= 2 ? operands.pop() : (verb === 'ln' && operands.length === 1 ? '.' : null);
  return { sources: operands, dest, intoDir: operands.length > 1, fileDest, recursive, parents, symbolic };
}
// PowerShell's Copy-Item / Move-Item: -Path / -LiteralPath (a comma list) or the first positional is the source,
// -Destination or the second positional the destination; -Recurse copies a folder's contents.
const PS_COPY = new Set(['copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move']);
function psCopyPlan(verb, words) {
  const sources = [];
  let dest = null;
  let recursive = /^m/.test(String(verb).toLowerCase());
  const positional = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    if (!w.startsWith('-')) { positional.push(w); continue; }
    const colon = w.indexOf(':');
    const name = (colon === -1 ? w.slice(1) : w.slice(1, colon)).toLowerCase();
    const value = colon === -1 ? null : w.slice(colon + 1);
    const take = () => (value !== null ? value : words[++i]);
    if (['path', 'literalpath', 'lp', 'pspath'].includes(name)) sources.push(...String(take() || '').split(',').filter(Boolean));
    else if (name === 'destination') dest = take() || null;
    else if (name === 'recurse') recursive = true;
    else if (PS_VALUE_PARAMS.has(name) && value === null) i++;
  }
  if (!sources.length && positional.length) sources.push(...String(positional.shift()).split(',').filter(Boolean));
  if (dest === null && positional.length) dest = positional.shift();
  return { sources, dest, intoDir: false, fileDest: false, recursive, parents: false, symbolic: false };
}
// patch [options] [originalfile [patchfile]]: the file it patches, `-o <out>`, `-r <rejects>`, and `-d <dir>`, where
// every file the patch names is written.
const PATCH_VALUE = 'pFDBYzVgrodi';
function patchDestinations(argv) {
  const out = [];
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const lv = longValue(argv, i, ['--output', '--reject-file', '--directory', '--input', '--strip', '--fuzz', '--ifdef', '--prefix', '--basename-prefix', '--suffix', '--version-control', '--get']);
    if (lv) { if (/^--(?:output|reject-file|directory)/.test(a)) out.push(lv.value); i += lv.skip; continue; }
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) continue;
    if (a.length > 1 && a[0] === '-') {
      for (let k = 1; k < a.length; k++) {
        if (!PATCH_VALUE.includes(a[k])) continue;
        const v = k === a.length - 1 ? argv[++i] : a.slice(k + 1);
        if ('ord'.includes(a[k])) out.push(v);
        break;
      }
      continue;
    }
    positional.push(a);
  }
  if (positional[0]) out.push(positional[0]);
  return out.filter((v) => v && v !== '-');
}
// git: `init <dir>` (and `--separate-git-dir`), `clone <repo> <dir>`, `apply --directory=<root>`.
const CLONE_VALUE = new Set(['-b', '--branch', '-o', '--origin', '--depth', '--reference', '--reference-if-able', '-c', '--config', '--template',
  '--separate-git-dir', '-u', '--upload-pack', '-j', '--jobs', '--filter', '--shallow-since', '--shallow-exclude', '--bundle-uri', '--server-option', '--ref-format']);
const INIT_VALUE = new Set(['--template', '--separate-git-dir', '-b', '--initial-branch', '--object-format', '--ref-format']);
function gitDestinations(call) {
  const out = [];
  const argv = call.argv;
  const positional = (values) => {
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
      if (values.has(a)) { if (a === '--separate-git-dir') out.push(argv[i + 1]); i++; continue; }
      if (a.startsWith('--separate-git-dir=')) { out.push(a.slice(19)); continue; }
      if (a.startsWith('-')) continue;
      pos.push(a);
    }
    return pos;
  };
  if (call.sub === 'init') { const p = positional(INIT_VALUE); if (p[0]) out.push(p[0]); }
  else if (call.sub === 'clone') { const p = positional(CLONE_VALUE); if (p[1]) out.push(p[1]); }
  else if (call.sub === 'apply') { for (let i = 0; i < argv.length; i++) { const lv = longValue(argv, i, ['--directory']); if (lv) { out.push(lv.value); i += lv.skip; } } }
  return out.filter(Boolean);
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
// The words after a command's name as the shell hands them over, each substitution kept whole - what echo and printf
// print (`wordsFrom` ended a double-quoted word at a quote inside its substitution, the eighth fuzz pass)
function wordsAfter(src, cmd, c) {
  return cmd.words.slice(c.at + 1).map((t) => {
    const w = src.slice(t.s, t.e);
    return dequote(w, process.platform, t.lex && /[$`]/.test(w) ? subsIn(t.lex, t.s, t.e) : null);
  });
}
// The runtime must be a COMMAND word (past sudo, env, a path spelling, or behind `uv run` / `poetry run`), never a
// runtime word anywhere before the `<<` on its line: `cat > run-node.txt <<'EOF'` read the file's text as node code
// (2.1.6 misc report, concern 1). A heredoc counts when a stage of the pipeline its `<<` opens is a runtime (`cat
// <<'PY' | python3` too). An inline script is the WHOLE argument after its flag (`-e`, `-c`, `-p`, `--eval`,
// `--print`, `-Command`, a perl or ruby cluster ending in one), read quote-aware.
const INTERP = /^(?:python[\d.]*|node|nodejs|ruby|perl|php|deno|bun|osascript|pwsh|powershell)$/;
const SCRIPT_FLAG = /^(?:-[A-Za-z]*[eEcr]|-p|--eval|--print|-Command|-command)$/;
// The shell words after `from` up to the command's end, each unquoted: a double-quoted word drops its escapes (`\"` is
// `"`), a single-quoted or `$'...'` one is taken as written. `expands`, when given, gets one flag per word: a `$` the
// shell expands (unquoted or double-quoted) is in it.
function wordsFrom(text, from, expands) {
  const words = [];
  let cur = null;
  let exp = false;
  const flush = () => { words.push(cur); if (expands) expands.push(exp); cur = null; exp = false; };
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '$' && text[i + 1] !== "'") exp = true;
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
      // inside double quotes bash undoes a backslash only before `$`, a backtick, `"`, `\` or a newline: a quoted
      // `'C:\x\f.txt'` reaches pwsh as written (the 2026-10-30 gate's Windows leg)
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '$') exp = true;
        cur += text[i] === '\\' && i + 1 < text.length && '$`"\\\n'.includes(text[i + 1]) ? text[++i] : text[i];
      }
      continue;
    }
    if (c === '\\' && i + 1 < text.length) { cur = (cur || '') + text[++i]; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === ')' || c === '<' || c === '>') break;
    if (c === ' ' || c === '\t' || c === '\r') { if (cur !== null) flush(); continue; }
    cur = (cur || '') + c;
  }
  if (cur !== null) flush();
  return words;
}
const LIT = String.raw`(["'])([^"'\n]+)\1`;
const DESTRUCTIVE = 'write_text|write_bytes|unlink|mkdir|rmdir|rename|replace|touch|chmod';
// a write verb whose FIRST argument is the path
const WRITE_CALL = new RegExp(String.raw`\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile|unlinkSync|unlink|rmSync|rmdirSync|rmdir|mkdirSync|mkdir|makedirs|removedirs|renameSync|rename|copyFileSync|copyfile|copy2|truncateSync|truncate|chmodSync|chmod|remove|rmtree|move|touch)\s*\(\s*${LIT}`, 'g');
// `open(path, 'w')` - a bare `open(path)` is a READ; the mode is read as one quoted word, then tested
const OPEN_CALL = new RegExp(String.raw`\b(?:open|fopen)\s*\(\s*(?:[fFrRbBuU]{1,2}(?=["']))?${LIT}\s*,\s*(["'])([^"'\n]*)\3`, 'g');
// pathlib, chained: `Path('…').write_text(…)`
const PATH_CALL = new RegExp(String.raw`\bPath\s*\(\s*${LIT}\s*\)\s*\.\s*(?:${DESTRUCTIVE})\b`, 'g');
// `f = Path('…')` … `f.unlink()` - the literal and the destructive call are statements apart, so the binding is
// followed by NAME; every receiver of a destructive call is collected once, then each binding is looked up in it.
const PATH_BIND = /(\w+)\s*=\s*(?:pathlib\.)?Path\s*\(\s*(["'])([^"'\n]+)\2/g;
const DESTROYED = new RegExp(String.raw`(\w+)\s*\.\s*(?:${DESTRUCTIVE})\b`, 'g');
// A string bound to a name (`p = '...'`, `const f = "..."`), and the write calls that take a NAME as their path.
const STR_BIND = /(?:^|[\s;{(,])(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(["'])([^"'\n]+)\2\s*(?=[;,)\n]|$)/gm;
const OPEN_NAME = /\b(?:open|fopen)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:mode\s*=\s*)?(["'])([^"'\n]*)\2/g;
const WRITE_NAME = /\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
const PATH_NAME_CALL = new RegExp(String.raw`\bPath\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:write_text|write_bytes)\b`, 'g');
// A write whose path is the script's own argument (`process.argv[1]`, `sys.argv[1]`) takes the shell word handed to it,
// and one whose path is any other expression (`path.join(...)`, a template) is computed (audit 2026-10-20, found beside
// C25: `node -e 'require("fs").writeFileSync(process.argv[1], ...)' <path>` registered no write at all).
const WRITE_ARGV = /\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\s*\(\s*(?:process|sys)\.argv\[(\d+)\]/g;
const OPEN_ARGV = /\b(?:open|fopen)\s*\(\s*sys\.argv\[(\d+)\]\s*,\s*(?:mode\s*=\s*)?(["'])([^"'\n]*)\2/g;
const WRITE_EXPR = /\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\s*\(\s*(?!["']|[A-Za-z_$][\w$]*\s*[,)]|(?:process|sys)\.argv\[\d+\])(?=\S)/g;
// .NET's file API, called from PowerShell (the tool's own command, or a `pwsh -Command` / heredoc script): the path it
// writes, and a Copy / Move / Replace's destination - a Move's or Replace's source is removed too (audit 2026-10-30 HK-14:
// `[IO.File]::WriteAllText('<sibling>/f', ...)` passed). Literal paths only, like every runtime write here.
const PS_FILE_CALL = /\[(?:System\.)?IO\.(?:File|Directory)\]::(WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|AppendAllLines|AppendText|CreateText|CreateDirectory|Create|Delete|OpenWrite|Copy|Move|Replace)\s*\(\s*(["'])([^"'\n]+)\2(?:\s*,\s*(["'])([^"'\n]+)\4)?/gi;
function psFilePaths(m) {
  const method = m[1].toLowerCase();
  if (method === 'copy') return m[5] ? [m[5]] : [];
  if (method === 'move' || method === 'replace') return [m[3], ...(m[5] ? [m[5]] : [])];
  return [m[3]];
}
// The target a script's computed write reports: a variable spelling, so a guard that cannot judge `$NAME` skips it.
const UNKNOWN_WRITE = '$UNKNOWN_INTERPRETER_WRITE';
// Where a script's string literals sit, so a write verb only counts in CODE (audit 2026-10-20 C31, 970539b7: a python
// heredoc's `s.replace("...", "fs.mkdirSync('/work/out/dumps', ...)")` - text the script writes into a file - was read as
// a node write outside the project). Quote-aware over ', ", ` and the triple forms; a one-quote string ends at its line's
// end, so a comment's apostrophe (`# don't`) costs at most the rest of its own line. A verb inside a string is text.
function codeStrings(body) {
  const mark = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "'" && c !== '"' && c !== '`') continue;
    const triple = c !== '`' && body[i + 1] === c && body[i + 2] === c;
    const close = triple ? c + c + c : c;
    let j = i + close.length;
    for (; j < body.length; j++) {
      if (body[j] === '\\') { j++; continue; }
      if (!triple && c !== '`' && body[j] === '\n') break;
      if (body.startsWith(close, j)) break;
    }
    const stop = Math.min(body.length, j + (body.startsWith(close, j) ? close.length : 0));
    mark.fill(1, i, stop);
    i = stop - 1;
  }
  return (at) => mark[at] === 1;
}
// The scripts a command hands a runtime (the ONE reader of them - the write targets below, the rm guard's runtime delete
// and the commit guard's runtime commit, audit 2026-10-30 HK-11 / HK-17): a heredoc fed to a pipeline holding a runtime,
// and the script argument after a runtime's `-e` / `-c` / `-Command`. Each: { body, index, runtime, shellExpands, argv }.
function runtimeScriptsOf(raw, P, heredocs) {
  const scripts = [];
  const runtimes = [];
  for (const cmd of P.cmds) for (const c of cmd.cands) if (INTERP.test(c.name)) runtimes.push({ cmd, c, at: cmd.words[c.at].s });
  if (!runtimes.length) return scripts;
  const runElems = new Map(runtimes.map((r) => [r.cmd.elem, r.c.name]));
  // a heredoc fed to a pipeline one of whose stages is a runtime: the heredoc's own command is in that element
  const heredocCmd = heredocOwners(P, heredocs);
  for (const h of heredocs) {
    const owner = heredocCmd.get(h.index);
    // an unquoted tag's body is expanded by the shell; `<<'EOF'` / `<<\EOF` hands it over verbatim
    if (owner && runElems.has(owner.elem)) scripts.push({ body: bodyOf(raw, h), index: h.index, runtime: runElems.get(owner.elem), shellExpands: !/['"\\]/.test(raw.slice(h.index, h.openEnd)) });
  }
  // `node -e "…"` / `python3 -c '…'` - the whole script argument after its flag
  for (const r of runtimes) {
    const expands = [];
    const words = wordsFrom(raw, r.cmd.words[r.c.at].e, expands);
    for (let i = 0; i < words.length - 1; i++) {
      // the words after the script are its argv: node's process.argv[1] and python's sys.argv[1] are the first of them
      if (SCRIPT_FLAG.test(words[i]) && !words[i + 1].startsWith('-')) scripts.push({ body: words[i + 1], index: r.at, runtime: r.c.name, shellExpands: expands[i + 1], argv: words.slice(i + 2) });
    }
  }
  return scripts;
}
// runtimeScripts(raw): the same, read from a command's text (heredocs, comments and continuations as scanShell reads them).
function runtimeScripts(raw) {
  const text = String(raw || '');
  const heredocs = heredocsOf(text);
  const P = parseShell(joinContinuations(blankComments(blankHeredocs(text, heredocs))));
  return P.tooDeep ? [] : runtimeScriptsOf(text, P, heredocs).map((s) => ({ ...s, P }));
}
function interpreterTargets(raw, P, heredocs) {
  const scripts = runtimeScriptsOf(raw, P, heredocs);
  if (!scripts.length) return [];
  // A `$NAME` the SHELL expands in the script (a double-quoted `-e "..."`, an unquoted heredoc) takes the newest literal
  // the same command assigned it before the runtime (audit 2026-10-20 C25, 4d71a1b3: `D=<docs>/x; node -e "...
  // writeFileSync('$D/SUMMARY.md', ...)"` was an unknown write, held by the docs gate as a source edit). Anything else
  // stays computed.
  const events = P.assignEvents || [];
  const shellValue = (name, at) => {
    let v = null;
    for (const e of events) if (e.kind === 'set' && e.name === name && e.at < at) v = /[$`]/.test(String(e.value)) || !e.value ? null : e.value;
    return v;
  };
  const out = [];
  // A write whose path the script computes (a loop variable, a parameter, an f-string) is still a write: one row per
  // script, `unknown`, spelled as a variable so every guard that skips an unexpanded `$NAME` skips it and the docs hook
  // maps it to its first source root (audit 2026-10-10 C13: 34 heredoc edits in 4f1c2ebb, 16 in 68da4b6b, 155 of 183 seat
  // edits in 9a4ef375 registered no write at all).
  const unknown = new Set();
  const computed = (index) => {
    if (unknown.has(index)) return;
    unknown.add(index);
    out.push({ raw: UNKNOWN_WRITE, index, what: 'an interpreter write', verb: 'interpreter', unknown: true });
  };
  let expandHere = false;
  const literal = (p, index) => {
    if (expandHere && /\$/.test(p)) p = p.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, br, bare) => { const v = shellValue(br || bare, index); return v === null ? m : v; });
    if (/[${]/.test(p)) { computed(index); return; } // interpolated - the path is computed, don't guess it
    out.push({ raw: p, index, what: 'an interpreter write', verb: 'interpreter' });
  };
  for (const { body, index, shellExpands, argv } of scripts) {
    expandHere = !!shellExpands;
    const inStr = codeStrings(body);
    // a match counts only where its verb (or bound name) sits in code, never inside a string literal
    const code = (m, word) => !inStr(m.index + Math.max(0, m[0].indexOf(word)));
    for (const m of body.matchAll(WRITE_CALL)) if (!inStr(m.index)) literal(m[2], index);
    for (const m of body.matchAll(OPEN_CALL)) if (!inStr(m.index) && /[wax+]/.test(m[4])) literal(m[2], index);
    for (const m of body.matchAll(PATH_CALL)) if (!inStr(m.index)) literal(m[2], index);
    for (const m of body.matchAll(PS_FILE_CALL)) if (!inStr(m.index)) for (const p of psFilePaths(m)) literal(p, index);
    const destroyed = new Set([...body.matchAll(DESTROYED)].filter((d) => !inStr(d.index)).map((d) => d[1]));
    for (const b of body.matchAll(PATH_BIND)) if (!inStr(b.index) && destroyed.has(b[1])) literal(b[3], index);
    // `p = '<literal>'` ... `open(p, 'w')` / `writeFileSync(f, ...)` / `Path(p).write_text(...)`: the name resolves to every
    // literal the script binds it to (81264f0d: 14 such edits to 13 files reached no rule and no docs gate)
    const bound = new Map();
    for (const b of body.matchAll(STR_BIND)) { if (!code(b, b[1])) continue; if (!bound.has(b[1])) bound.set(b[1], []); bound.get(b[1]).push(b[3]); }
    const byName = (name, index) => { const lits = bound.get(name); if (lits) for (const l of lits) literal(l, index); else computed(index); };
    for (const m of body.matchAll(OPEN_NAME)) if (!inStr(m.index) && /[wax+]/.test(m[3])) byName(m[1], index);
    for (const m of body.matchAll(WRITE_NAME)) if (!inStr(m.index)) byName(m[1], index);
    for (const m of body.matchAll(PATH_NAME_CALL)) if (!inStr(m.index)) byName(m[1], index);
    const byArg = (k, index) => { const w = argv && argv[Number(k) - 1]; if (w && Number(k) > 0) literal(w, index); else computed(index); };
    for (const m of body.matchAll(WRITE_ARGV)) if (!inStr(m.index)) byArg(m[1], index);
    for (const m of body.matchAll(OPEN_ARGV)) if (!inStr(m.index) && /[wax+]/.test(m[3])) byArg(m[1], index);
    for (const m of body.matchAll(WRITE_EXPR)) if (!inStr(m.index)) computed(index);
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
// script (`-n`, `-o noexec`) and `make -n` carry none. What `echo`, `printf` and a `cat` of a heredoc, a here-string or a
// file print is read wherever it reaches a shell: a pipe from a group or a subshell, `/dev/stdin`, `<( )`, a substitution
// that is the whole script word of `-c` or `eval`, `env -S` (the tenth R015 review, 2026-11-05). What `curl` or any
// other program prints does not exist until it runs, so nothing here reads it (`eval "$(ssh-agent -s)"`).
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
// What `echo` and `printf` print, read as the union of bash, dash and zsh so a guard sees what any of them runs. echo
// joins its words with blanks and ends the line (`-n` or `\c` leave it open); its escapes are always read, since dash's
// and zsh's echo read them unasked. printf cycles its format over its arguments until they run out, reading the format's
// escapes as it goes (`\045s` prints `%s`, never a conversion) and the conversions `%s %b %c %q %d %i %u %o %x %X %%` with
// their flags, width and precision; `%q` quotes its argument so a shell reads it back as one word. What the reader does
// not model - a `*` width, a float, an unknown conversion - is `odd`: the text then stays unread, never guessed (the
// eleventh review: `printf 'git\x20push\n' | sh`, `printf '%.3s push\n' gitx | sh` and `echo -e '\x67it push' | sh` each ran a
// push nobody read). `printf -v` prints nothing.
const LETTER_ESCAPES = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' };
// The escape at `s[i]`, a backslash: { text, len, stop }. `fmt` reads printf's format (`\NNN`, `\"`, `\'`, `\?`), else echo's
// and `%b`'s (`\0NNN` and `\NNN`). `\c` ends the output in both - zsh's printf ends at one in its format, where bash and dash
// print it (the twelfth review). Any other backslash prints as written.
function escapeAt(s, i, fmt) {
  const d = s[i + 1];
  if (d === undefined) return { text: '\\', len: 1 };
  if (d === 'c') return { text: '', len: 2, stop: true };
  if (Object.prototype.hasOwnProperty.call(LETTER_ESCAPES, d)) return { text: LETTER_ESCAPES[d], len: 2 };
  if (fmt && (d === '"' || d === "'" || d === '?')) return { text: d, len: 2 };
  const rest = s.slice(i + 1, i + 10);
  let m = fmt ? null : /^0([0-7]{0,3})/.exec(rest);
  if (m) return { text: String.fromCharCode(parseInt(m[1] || '0', 8) & 255), len: 1 + m[0].length };
  if ((m = /^[0-7]{1,3}/.exec(rest))) return { text: String.fromCharCode(parseInt(m[0], 8) & 255), len: 1 + m[0].length };
  if ((m = /^x([0-9A-Fa-f]{1,2})/.exec(rest))) return { text: String.fromCharCode(parseInt(m[1], 16)), len: 1 + m[0].length };
  if ((m = /^u([0-9A-Fa-f]{1,4})/.exec(rest) || /^U([0-9A-Fa-f]{1,8})/.exec(rest)) && parseInt(m[1], 16) <= 0x10ffff) {
    return { text: String.fromCodePoint(parseInt(m[1], 16)), len: 1 + m[0].length };
  }
  return { text: '\\', len: 1 };
}
function escapesOut(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const j = s.indexOf('\\', i);
    if (j < 0) { out += s.slice(i); break; }
    out += s.slice(i, j);
    const e = escapeAt(s, j, false);
    if (e.stop) return { text: out, stop: true };
    out += e.text;
    i = j + e.len;
  }
  return { text: out, stop: false };
}
// Every command is read two ways where the shells part (the twelfth gate, the thirteenth review). The first reading is
// zsh's and sh's: echo reads its escapes whatever -e / -E says (sh and dash print `-E` and still read them), a printf
// format ends at `\c`, and a print whose stdout goes to a file or stderr joins no stream. The second is bash's: echo
// reads escapes only after -e (the last of -e / -E decides), a printf format prints `\c` and goes on, and every print
// joins the stream - zsh's multios sends a pipe stage's redirected output down the pipe too, and an enclosing `2>&1`,
// `|&` or `exec` sends stderr there. A pass sets `readingsDiffer` when one of these met a text where the two part, and
// carriedScripts then reads the command again with `bashReading` on.
let bashReading = false;
let readingsDiffer = false;
function echoPrint(words) {
  const w = words.slice();
  let line = true;
  let mode = null;
  while (w.length && /^-[neE]+$/.test(w[0])) { for (const ch of w[0].slice(1)) { if (ch === 'n') line = false; else mode = ch; } w.shift(); }
  const said = w.join(' ');
  const r = escapesOut(said);
  const read = r.text + (line && !r.stop ? '\n' : '');
  const bash = mode === 'e' ? read : said + (line ? '\n' : '');
  if (bash !== read) readingsDiffer = true;
  return { text: bashReading ? bash : read, odd: false };
}
// A printf number: a leading quote is the next character's code, else C's decimal, octal and hex forms; null for any other
function printfNumber(a) {
  if (a === '') return 0;
  if (a[0] === "'" || a[0] === '"') return a.length > 1 ? a.codePointAt(1) : 0;
  if (/^[+-]?0[xX][0-9A-Fa-f]+$/.test(a)) return parseInt(a, 16);
  if (/^[+-]?0[0-7]*$/.test(a)) return parseInt(a, 8);
  if (/^[+-]?\d+$/.test(a)) return parseInt(a, 10);
  return null;
}
const PRINT_CAP = 1 << 20;
const PRINTF_SPEC = /%([-+ #0]*)(\*|\d*)(?:\.(\*|\d*))?([A-Za-z%])/y;
function printfPrint(words) {
  const w = words.slice();
  if (w[0] === '--') w.shift();
  if (!w.length || w[0] === '-v') return { text: '', odd: false };
  const format = w[0];
  const args = w.slice(1);
  const pad = (t, flags, width) => {
    const n = Number(width) || 0;
    if (t.length >= n) return t;
    return flags.includes('-') ? t + ' '.repeat(n - t.length) : ' '.repeat(n - t.length) + t;
  };
  const cut = (t, prec) => (prec === undefined ? t : t.slice(0, Number(prec) || 0));
  let out = '';
  let i = 0;
  for (let pass = 0; pass < 1000; pass++) {
    let used = false;
    for (let k = 0; k < format.length;) {
      const ch = format[k];
      if (ch === '\\') {
        const e = escapeAt(format, k, true);
        if (e.stop && bashReading) { out += '\\c'; k += e.len; continue; } // bash, sh and dash print it and go on
        if (e.stop) { readingsDiffer = true; return { text: out, odd: false }; }
        out += e.text;
        k += e.len;
        continue;
      }
      if (ch !== '%') { const j = format.slice(k).search(/[\\%]/); const end = j < 0 ? format.length : k + j; out += format.slice(k, end); k = end; continue; }
      PRINTF_SPEC.lastIndex = k;
      const m = PRINTF_SPEC.exec(format);
      if (!m) return { text: out, odd: true };
      k = PRINTF_SPEC.lastIndex;
      const [, flags, width, prec, conv] = m;
      if (conv === '%') { out += '%'; continue; }
      if (width === '*' || prec === '*') return { text: out, odd: true };
      used = true;
      const a = i < args.length ? args[i++] : '';
      if (conv === 's') out += pad(cut(a, prec), flags, width);
      else if (conv === 'q') out += pad(runnerQuote(a), flags, width);
      else if (conv === 'b') {
        const r = escapesOut(a);
        out += pad(cut(r.text, prec), flags, width);
        if (r.stop) return { text: out, odd: false };
      } else if (conv === 'c') out += pad(a ? String.fromCodePoint(a.codePointAt(0)) : '', flags, width);
      else if ('diouxX'.includes(conv)) {
        const n = printfNumber(a);
        if (n === null || flags.includes('#') || (n < 0 && 'ouxX'.includes(conv))) return { text: out, odd: true };
        let digits = Math.abs(n).toString(conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) digits = digits.padStart(Number(prec) || 0, '0');
        const sign = n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        const n0 = Number(width) || 0;
        if (flags.includes('0') && !flags.includes('-') && prec === undefined) digits = digits.padStart(n0 - sign.length, '0');
        out += pad(sign + digits, flags, width);
      } else return { text: out, odd: true };
    }
    if (!used || i >= args.length) break;
    if (out.length > PRINT_CAP) return { text: '', odd: true }; // cycling a long format: not modelled (the twelfth review)
  }
  return { text: out, odd: false };
}
// Where a command's stdout ends up once its own redirects apply, in order: 'out' (its pipe, or the stream it prints into),
// 'err' or 'away'. A print sent to a file, /dev/null or stderr joins no stream a shell reads (the twelfth review: `{ printf
// 'git '; printf status >/dev/null; echo push; } | sh` ran a push read as `git status`).
const STDOUT_FILES = new Set(['/dev/stdout', '/dev/fd/1', '/proc/self/fd/1']);
const STDERR_FILES = new Set(['/dev/stderr', '/dev/fd/2', '/proc/self/fd/2']);
function stdoutOf(cmd, text) {
  let fd1 = 'out';
  let fd2 = 'err';
  for (const r of cmd.redirs || []) {
    if (!r.target || !/^(?:>|>>|>\||>&|&>|&>>)$/.test(r.op)) continue;
    const t = dequote(r.target.raw);
    const to = STDOUT_FILES.has(t) ? fd1 : STDERR_FILES.has(t) ? fd2 : 'away';
    if (r.op === '&>' || r.op === '&>>') { fd1 = to; fd2 = to; continue; }
    let j = r.at;
    while (j > 0 && text[j - 1] >= '0' && text[j - 1] <= '9') j--;
    const fd = j < r.at && (j === 0 || /[\s;&|()]/.test(text[j - 1])) ? text.slice(j, r.at) : null;
    let v = to;
    if (r.op === '>&') {
      if (/^\d+$/.test(t) || t === '-') v = t === '1' ? fd1 : t === '2' ? fd2 : 'away';
      else if (fd === null) { fd1 = to; fd2 = to; continue; } // bash's `>&file`: both
    }
    if ((fd || '1') === '1') fd1 = v;
    else if (fd === '2') fd2 = v;
  }
  return fd1;
}
const echoOut = (words) => echoPrint(words).text;
const printfOut = (words) => printfPrint(words).text;

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
    if (c.name === 'echo') return echoOut(wordsAfter(raw, cmd, c));
    if (c.name === 'printf') return printfOut(wordsAfter(raw, cmd, c));
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

// THE SENSITIVE RUNNER (audit 2026-10-30 HK-01, the BLOCKER): `node <path>/guard-secret-value.js --with-sensitive --
// "<command line>"` - the route alfred-security.md mandates and every session's `Sensitive data:` line prints - runs its line
// through a shell (`spawn(line, { shell: true })`: sh, cmd.exe on Windows) with the store's values in its environment, and
// no guard read that line: `rm -rf ~`, a force push to main, `cat .env`, a write outside the project and an ungated commit
// all ran through it. It is a carried script here, like `sh -c`, so every guard reading this module judges the line: one
// word after `--` (or after the flag) is the line itself, several words are one command line, each quoted for the shell -
// the runner's own rule. The runner masks only the store's exact values in what the line prints; it never made the line
// safe. Returns { text, at, end, mapped } for the call `c`, or null.
const RUNNER_FILE = 'guard-secret-value.js';
const runnerQuote = (w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);
// A word whose quoted text IS what the carried shell runs, so a position in it maps back to the command: a single-quoted
// word, or a double-quoted one holding none of bash's double-quote escapes. Bash undoes `\"`, `\$`, `\\`, a backslashed
// backtick and a backslashed newline before the word is handed on, so such a word's line is its DEQUOTED text, mapped
// nowhere (final review 2026-10-30, FB: `-- "bash -c \"rm -rf ~\""`, `-- "cat \".env\""` and `bash -c "rm -rf
// \"\$HOME\""` were judged as the raw text, every escape kept, and passed).
const DQ_ESCAPE = /\\[$`"\\\n]/;
const verbatimWord = (t, P) => Boolean(t) && (t.raw[0] === "'" || (t.raw[0] === '"' && !DQ_ESCAPE.test(t.raw)))
  && P.spans.some((s) => s[0] === t.s && s[1] === t.e);
// The script word is the one right before `--with-sensitive`, whatever its spelling: node's own options may take a
// separate value (`--disable-warning X`, `--report-dir X`, `--openssl-config X` - no table of them stays complete), and
// the script may be a variable or a substitution (`node "$G"`, `node "$(ls ... | tail -1)"`) - each passed unjudged
// behind a basename test (final review 2026-10-30, FB). Another script given `--with-sensitive` is judged too: a line
// judged that never ran through a shell costs a block, a runner missed ran its line unread.
function runnerLine(c, P, bound = () => null) {
  if (c.name !== 'node' && c.name !== 'nodejs') return null;
  const argv = c.argv;
  let k = -1;
  for (let j = 0; j + 1 < argv.length; j++) {
    if (/^-(?:e|p|pe|-eval|-print)$|^--(?:eval|print)=/.test(argv[j])) return null; // an inline script is the runtime reader's
    if (argv[j + 1] === '--with-sensitive' && !/^-./.test(argv[j])) { k = j; break; }
  }
  if (k < 0) return null;
  let from = k + 2;
  if (argv[from] === '--') from++;
  const words = argv.slice(from);
  if (!words.length) return null;
  // an unquoted word is passed as the outer shell expands it (`~`, `$HOME`), which the line's own shell expands alike;
  // a quoted one reaches the runner as text and is quoted again for its shell
  if (words.length > 1) return { text: c.args.slice(from).map((t, i) => (/^[^'"\\]*$/.test(t.raw) ? t.raw : runnerQuote(words[i]))).join(' '), mapped: false };
  const t = c.args[from];
  const named = bound(t);
  if (named !== null) return { text: named, mapped: false, bound: true };
  return verbatimWord(t, P) ? { text: t.raw.slice(1, -1), at: t.s + 1, end: t.e - 1, mapped: true } : { text: words[0], mapped: false };
}
// sensitiveRuns(raw, opts) - the command lines a command hands the sensitive runner, through every carried script (3 deep):
// [{ text, cwd }]. The shell dispatcher judges each one again with the guards that keep a reader of their own. The array's
// `unread` is true when a text naming the runner was left unwalked - past the depth or the scan budget - so the caller
// judges conservatively (final review 2026-10-30, FB: nothing stops judging silently at a count).
function sensitiveRuns(raw, opts = {}) {
  const run = opts.run || newRun(opts);
  const out = [];
  out.unread = false;
  const walk = (text, cwd, depth) => {
    // a line read from no file names the runner in its own text; one reading script files is walked whole
    if (!opts.files && !/with-sensitive/.test(text)) return;
    if (depth > 3 || run.budget.over()) { if (/with-sensitive/.test(text)) out.unread = true; return; }
    for (const sc of carriedScripts(text, { cwd: cwd || undefined, files: opts.files, run })) {
      if (sc.runner) out.push({ text: sc.text, cwd: sc.cwd || cwd || null });
      walk(sc.text, sc.cwd || cwd, depth + 1);
    }
  };
  walk(String(raw || ''), opts.cwd || null, 0);
  return out;
}

// The commands of `P` with an index in [from, to) that write where a command in `base` writes: in `base` itself or a subshell of
// it, never inside a substitution or a process substitution, whose output is their own (the eleventh review: the commands
// nested in a substitution were read as printing beside it, so `eval "$(echo "$(echo "git push")")"` read the push twice
// over, and a nested `echo '"'` opened a quote over it). A frame's commands are contiguous, so a skipped one is passed whole.
function levelOf(P, base, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const c = P.cmds[i];
    let skip = null;
    for (let f = c.frame; f && f !== base; f = f.parent) if (f.kind !== '(') skip = f;
    if (skip) { if (skip.cmdTo !== undefined) i = Math.max(i, skip.cmdTo - 1); continue; }
    out.push(c);
  }
  return out;
}
// The words that open and close a block whose output is one stream: a group, a loop, an if, a case
const BLOCK_OPEN = new Map([['{', '{'], ['for', 'loop'], ['while', 'loop'], ['until', 'loop'], ['select', 'loop'], ['if', 'if'], ['case', 'case']]);
const BLOCK_CLOSE = new Map([['}', '{'], ['done', 'loop'], ['fi', 'if'], ['esac', 'case']]);
// Whether offset `i` of the parsed command stands in a single-quoted (or `$'...'`) span, where nothing expands
function singleQuoted(P, i) {
  const sp = P.spans;
  let lo = 0;
  let hi = sp.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sp[m][0] <= i) lo = m + 1; else hi = m; }
  const q = sp[lo - 1];
  return !!q && i < q[1] && (P.command[q[0]] === "'" || (P.command[q[0]] === '$' && P.command[q[0] + 1] === "'"));
}
// The code a zsh glob qualifier list runs for each file the glob matches (`*(e:'git push':)`, `*(.oe{...})`, `*(+fn)`): each `e`
// string, dequoted as zsh reads it, and each `+` command name. `u`, `g`, `f` and `P` take a delimited argument, skipped.
const QUAL_PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };
const QUAL_AFTER = /[^\s$<>=|&;()`{]/; // the character a qualifier list opens after: the end of a glob word
// zsh's `${(flags)name}`: the flags run matched once, never backtracked (the twelfth review: 30 s on an open run; the
// thirteenth: a bound of 32 missed a longer run)
const PARAM_E = /\$\{\((?=([^()$]*))\1\)([A-Za-z_]\w*)/g;
function qualifierCode(q) {
  const out = [];
  const closeOf = (from, d) => {
    const end = QUAL_PAIRS[d] || d;
    for (let j = from; j < q.length; j++) {
      if (q[j] === '\\') { j++; continue; }
      if (q[j] === end) return j;
      if (q[j] === "'" || q[j] === '"') { const c = q.indexOf(q[j], j + 1); if (c < 0) return -1; j = c; }
    }
    return -1;
  };
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    const d = q[i + 1];
    if ('eugfP'.includes(ch) && d !== undefined && !/[\w\s]/.test(d)) {
      const c = closeOf(i + 2, d);
      if (c < 0) break;
      if (ch === 'e') out.push(dequote(q.slice(i + 2, c)));
      i = c;
    } else if (ch === '[') {
      const c = q.indexOf(']', i);
      if (c < 0) break;
      i = c;
    } else if (ch === '+' && d !== undefined && /[A-Za-z_]/.test(d)) {
      const m = /^[A-Za-z_][\w:.-]*/.exec(q.slice(i + 1));
      out.push(m[0]);
      i += m[0].length;
    }
  }
  return out.filter((t) => t.trim());
}

// Frames by open and close, each command by where it ends, and each `}`, `done`, `fi` or `esac` by the command that opened
// it in the same frame - once per parse (carriedOf's pipe producers, its loop reading and the force-push guard's held
// branches share it)
const BLOCK_MAPS = new WeakMap();
function blockMaps(P) {
  let maps = BLOCK_MAPS.get(P);
  if (maps) return maps;
  maps = { byOpen: new Map(), byClose: new Map(), endAt: new Map(), opener: new Map() };
  for (const fr of P.frames) { maps.byOpen.set(fr.open, fr); if (fr.close !== undefined) maps.byClose.set(fr.close, fr); }
  const stacks = new Map();
  for (const c of P.cmds) {
    let e = c.words.length ? c.words[c.words.length - 1].e : -1;
    for (const r of c.redirs) if (r.target && r.target.e > e) e = r.target.e;
    if (e >= 0) maps.endAt.set(e, c);
    if (!c.words.length) continue;
    let st = stacks.get(c.frame);
    if (!st) stacks.set(c.frame, (st = new Map()));
    const shut = BLOCK_CLOSE.get(c.words[0].raw);
    if (shut && st.has(shut) && st.get(shut).length) maps.opener.set(c, st.get(shut).pop());
    const lead = c.cands && c.cands.length ? c.cands[c.cands.length - 1].at : c.words.length - 1;
    for (let w = 0; w <= lead && w < c.words.length; w++) {
      const o = BLOCK_OPEN.get(c.words[w].raw);
      if (o) { if (!st.has(o)) st.set(o, []); st.get(o).push(c); }
    }
  }
  BLOCK_MAPS.set(P, maps);
  return maps;
}
// A frame is `outer` or inside it: a set in a subshell or a substitution ends with it
function frameWithin(inner, outer) {
  for (let fr = inner, n = 0; n < 64; fr = fr.parent, n++) { if (fr === outer) return true; if (!fr) return false; }
  return false;
}
// The loops binding each name: name -> Map(head command -> { close: index of its `done`, list: its words, nameAt }), a
// head counted where the parser opens its block (`do for t in ...`, `then for ...`) - once per parse
const LOOP_HEADS = new WeakMap();
const HEADS_MAX = 1024;
function loopHeadsIn(P) {
  let heads = LOOP_HEADS.get(P);
  if (heads) return heads;
  heads = new Map();
  for (const [close, open] of blockMaps(P).opener) {
    if (close.words[0].raw !== 'done') continue;
    const w = open.words;
    const lead = open.cands && open.cands.length ? open.cands[open.cands.length - 1].at : w.length - 1;
    let k = 0;
    while (k <= lead && k < w.length && w[k].raw !== 'for' && w[k].raw !== 'select') k++;
    if (k + 2 >= w.length || k > lead || w[k + 2].raw !== 'in') continue;
    const nm = w[k + 1].raw;
    if (!heads.has(nm)) heads.set(nm, new Map());
    const m = heads.get(nm);
    const h = m.get(open);
    if (!h) m.set(open, { close: close.index, list: w.slice(k + 3), nameAt: w[k + 1].s });
    else if (close.index < h.close) h.close = close.index;
  }
  LOOP_HEADS.set(P, heads);
  return heads;
}
// The loop words `name` holds at `cmd`: its innermost enclosing `for` / `select` binding the name, and each same-name
// loop that opened inside that body before `cmd` - { best, words } (tokens), or null outside any such body
function loopAt(P, name, cmd) {
  const heads = loopHeadsIn(P).get(name);
  if (!heads || heads.size > HEADS_MAX || !cmd) return null;
  let best = null;
  for (const [open, h] of heads) if (open.index < cmd.index && cmd.index < h.close && frameWithin(cmd.frame, open.frame) && (!best || open.index > best.index)) best = open;
  if (!best) return null;
  const words = heads.get(best).list.slice();
  for (const [open, h] of heads) if (open.index > best.index && open.index < cmd.index) for (const w of h.list) words.push(w);
  return { best, words };
}
function carriedOf(P, raw, heredocs, opts, run) {
  const cwd = opts.cwd || null;
  const files = opts.files !== undefined ? !!opts.files : !!cwd;
  const anchor = cwd ? (at) => compiledAnchor(P.cds, cwd, normPath)(at) : () => null;
  let writtenMap = null; // read only when a script file is looked for: most commands run none
  const written = { get: (abs) => { if (!writtenMap) writtenMap = files ? writtenScripts(P, raw, heredocs, anchor, run) : new Map(); return writtenMap.get(abs); } };
  const unread = (at, why, p, force) => run.unread.push({ at, why, path: p || null, ...(force ? { force: true } : {}) });
  // A shell-run string that is one `$NAME` / `${NAME}` the same command bound to a LITERAL before the use is carried as
  // that literal - the newest assignment, `shellVars` `literalOf` (final review 2026-10-30, FC: `C='rm -rf ~'; bash -c
  // "$C"` passed the rm guard, and so did `sh -c`, `eval` and the runner's line). The word is bare or double-quoted, so the
  // calling shell expands it; a bare one is read whole, which errs toward judging. A name bound to a substitution, or
  // never bound, stays out of model. Such a text is marked `bound`: it maps to no span of the command.
  let vars = null;
  const NAME_WORD = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))$/;
  const boundText = (word, at) => {
    const m = NAME_WORD.exec(String(word));
    if (!m) return null;
    if (!vars) vars = shellVars(P, {});
    return vars.literalOf(m[1] || m[2], at);
  };
  const boundTok = (t) => {
    if (!t || t.raw[0] === "'") return null;
    const inner = t.raw[0] === '"' ? (t.raw.length > 1 && t.raw.endsWith('"') ? t.raw.slice(1, -1) : null) : t.raw;
    return inner === null ? null : boundText(inner, t.s);
  };
  // A word's text with its substitutions taken out: what quotes it as a whole, never a quote inside a substitution
  const outsideSubs = (t) => {
    if (!t.lex) return t.raw;
    let out = '';
    let last = 0;
    for (const [off, end] of [...subsIn(t.lex, t.s, t.e)].sort((x, y) => x[0] - y[0])) { out += t.raw.slice(last, off); last = end + 1; }
    return out + t.raw.slice(last);
  };
  // The words a shell splits an expansion into, as a line that reads back the same words: each is literal - no tilde,
  // variable or quote in it is read again, and `;`, `|` or `&` is text - so any word holding one is quoted; a glob still
  // expands on a split word, so `*`, `?` and `[ ]` stay bare
  const literalWords = (text) => String(text).split(/[ \t\n]+/).filter(Boolean).map((w) => (/^[\w@%+=:,./*?[\]-]+$/.test(w) ? w : runnerQuote(w))).join(' ');
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
  // The heredocs each command owns, and each pipeline's, read once
  const docsOf = new Map();
  const docsByElem = new Map();
  for (const h of heredocAt) {
    const o = owners.get(h.index);
    if (!o) continue;
    if (!docsOf.has(o)) docsOf.set(o, []);
    docsOf.get(o).push(h);
    if (o.elem) { if (!docsByElem.has(o.elem)) docsByElem.set(o.elem, []); docsByElem.get(o.elem).push(h); }
  }
  // What a list of commands prints into one stream, as far as the text shows it: echo, printf and a cat of a heredoc or
  // here-string, joined as the shell writes them - echo ends its line, printf adds nothing (the eleventh review:
  // `{ printf 'git '; echo push; } | sh` read as two scripts, `git` and `push`) - plus each file a cat prints, a script of its own
  const reaches = (k, text) => {
    if (stdoutOf(k, text) === 'out') return true;
    readingsDiffer = true;
    return bashReading;
  };
  const printedBy = (cmds, at) => {
    let stream = '';
    let parts = 0;
    let only = null; // a file that is all the stream holds stays whole, its own directory with it
    let markAt = -1; // an unread print is marked where it prints: the text after it is what a reader of the mark sees
    resetPrint();
    for (const k of cmds) {
      const c = k.cands && k.cands[k.cands.length - 1];
      if (!c || !reaches(k, P.command)) continue;
      if (c.name === 'echo' || c.name === 'printf') { stream += printText(c.name, printedWords(raw, k, c, 0)); parts++; }
      else if (c.name === 'cat') { // its heredoc, here-string and files, in the stream's own order (the twelfth review, 1)
        for (const h of docsOf.get(k) || []) { stream += lineEnd(bodyText(raw, h, 0)); parts++; }
        for (const r of k.redirs) if (r.op === '<<<' && r.target) { stream += `${hereString(raw, r.target, 0)}\n`; parts++; }
        for (const a of c.argv.filter((x) => !x.startsWith('-'))) { const t = fromFile(a, at); if (t) { stream += t.text; parts++; only = t; } }
      }
      if (markAt < 0 && (deepPrint || paramPrint || oddPrint)) markAt = k.words[0].s;
    }
    if (stream && !run.budget.take(stream.length)) { deepPrint = true; stream = ''; } // the twelfth review, 10
    flagged(markAt >= 0 ? markAt : at);
    return !stream ? [] : [parts === 1 && only ? only : { text: stream }];
  };
  const blankAt = (k) => P.command[k] === ' ' || P.command[k] === '\t';
  // The `|` (or `|&`) that feeds the command at `pos`, through the `(` / `{` it stands first in: -1 for none
  const pipeBefore = (pos) => {
    let k = pos - 1;
    for (;;) {
      while (k >= 0 && blankAt(k)) k--;
      if (k >= 0 && (P.command[k] === '(' || (P.command[k] === '{' && (k === 0 || blankAt(k - 1) || P.command[k - 1] === '|')))) { k--; continue; }
      break;
    }
    if (k >= 1 && P.command[k] === '&' && P.command[k - 1] === '|') k--;
    return k >= 0 && P.command[k] === '|' && P.command[k - 1] !== '|' ? k : -1;
  };
  // ... or that feeds a subshell it runs in (`printf x | (cd d && sh)`)
  const feedOf = (cmd) => {
    if (!cmd.words.length) return -1;
    let p = pipeBefore(cmd.words[0].s);
    for (let fr = cmd.frame, n = 0; p < 0 && fr && n < 8; fr = fr.parent, n++) if (fr.kind === '(') p = pipeBefore(fr.open);
    return p;
  };
  // Lookups built once, so a pipe, a block or a process substitution costs no walk of the whole command (the eleventh
  // review: `{ echo a; } | sh;` repeated ran near 10 s at 400,000 characters): frames by open and close, each command by
  // where it ends, and each `}`, `done`, `fi` or `esac` by the command that opened it in the same frame - an opener counted among a
  // command's words up to its last command word (`{ echo`, `if true`, `do for b`), never in its arguments
  const mapsOf = () => blockMaps(P);
  // The commands that write into the pipe at `p`, at its level: a subshell, a group, a loop, an if or a case closing right
  // before it - a redirect after it too (the eleventh review: `{ echo git push; } 2>/dev/null | sh` and `for ...; done | sh`
  // were read as feeding nothing) - else the one command ending there
  const producersAt = (p) => {
    const M = mapsOf();
    let k = p - 1;
    while (k >= 0 && blankAt(k)) k--;
    if (k < 0) return [];
    const subshell = (close) => { const fr = M.byClose.get(close); return fr && fr.kind === '(' ? levelOf(P, fr, fr.cmdFrom, fr.cmdTo) : null; };
    if (P.command[k] === ')') { const sub = subshell(k); if (sub) return sub; }
    const c = M.endAt.get(k + 1);
    if (!c) return [];
    if (!c.words.length) { // `( ... ) 2>/dev/null`: the redirect is a command of its own, after the subshell
      let j = c.redirs[0].at - 1;
      while (j >= 0 && (blankAt(j) || /[0-9&]/.test(P.command[j]))) j--;
      return (j >= 0 && P.command[j] === ')' && subshell(j)) || [];
    }
    const o = M.opener.get(c);
    return o ? levelOf(P, c.frame, o.index, c.index) : [c];
  };
  // What a shell reading its stdin at `at` is fed: a heredoc anywhere in its pipeline, a here-string, a file on its
  // stdin, the stage before its pipe (walked back past tee and bare cat), or a group, a subshell or a command piped in
  const stdinTexts = (cmd, el, at) => {
    const texts = [];
    resetPrint();
    for (const h of docsByElem.get(el) || []) texts.push({ text: bodyText(raw, h, 0) });
    for (const r of cmd.redirs) {
      if (r.op === '<<<' && r.target) texts.push({ text: hereString(raw, r.target, 0) });
      if (r.op === '<' && r.target) { const t = fromFile(dequote(r.target.raw), at, false, r.target); if (t) texts.push(t); }
    }
    flagged(at);
    const stages = el.cmds;
    const me = stages.indexOf(cmd);
    for (let j = me - 1; j >= 0 && me - j <= 16; j--) {
      const prev = stages[j].cands[stages[j].cands.length - 1]; // the command past its wrappers (`time echo`)
      if (!prev) break;
      const pargs = prev.argv.filter((a) => !a.startsWith('-'));
      if (prev.name === 'tee' || (prev.name === 'cat' && !pargs.length)) continue;
      texts.push(...printedBy([stages[j]], at));
      break;
    }
    const p = feedOf(cmd);
    if (p >= 0) texts.push(...printedBy(producersAt(p), at));
    const seen = new Set();
    return texts.filter((t) => !seen.has(t.text) && seen.add(t.text));
  };
  // What the substitution at [a, e) of `src` prints through echo, printf or a cat of a heredoc or here-string - the one
  // stream its own commands write (never those of a substitution inside it, already in place), its trailing newlines
  // removed as a substitution removes them: null when none prints. Prints nested past PRINT_DEPTH, or past the parser's
  // nesting limit, are unread (`deepPrint`); each level parses its text once, and what it parses and makes is charged to the
  // scan budget, so no nest of prints grows past it unread
  let deepPrint = false;
  let paramPrint = false; // a print inside a parameter expansion: unread, as `deepPrint`
  let oddPrint = false; // a printf conversion the reader does not model
  const resetPrint = () => { deepPrint = false; paramPrint = false; oddPrint = false; };
  const PRINT_DEPTH = 8;
  const printText = (name, words) => { const r = name === 'echo' ? echoPrint(words) : printfPrint(words); if (r.odd) oddPrint = true; return r.text; };
  const lineEnd = (t) => (!t || t.endsWith('\n') ? t : `${t}\n`);
  const printOf = (src, a, e, depth) => {
    const bt = src[a] === '`';
    let inner = src.slice(a + (bt ? 1 : 2), e - 1);
    if (bt) inner = inner.replace(/\\([$`\\])/g, '$1');
    if (!run.budget.take(inner.length)) { deepPrint = true; return null; }
    const docs = heredocsOf(inner);
    const Q = parseShell(joinContinuations(blankComments(blankHeredocs(inner, docs))));
    if (Q.tooDeep) { deepPrint = true; return null; }
    const own = heredocOwners(Q, docs);
    const docsBy = new Map();
    for (const h of docs) { const o = own.get(h.index); if (o) { if (!docsBy.has(o)) docsBy.set(o, []); docsBy.get(o).push(h); } }
    let out = '';
    let any = false;
    for (const k of levelOf(Q, null, 0, Q.cmds.length)) {
      const c = k.cands && k.cands[k.cands.length - 1];
      if (!c) continue;
      if (!reaches(k, Q.command)) continue;
      if (c.name === 'echo' || c.name === 'printf') { out += printText(c.name, printedWords(inner, k, c, depth + 1)); any = true; }
      else if (c.name === 'cat') {
        for (const h of docsBy.get(k) || []) { out += lineEnd(bodyText(inner, h, depth + 1)); any = true; }
        for (const r of k.redirs) if (r.op === '<<<' && r.target) { out += `${hereString(inner, r.target, depth + 1)}\n`; any = true; }
      }
    }
    if (!any) return null;
    out = out.replace(/\n+$/, '');
    if (!run.budget.take(out.length)) { deepPrint = true; return null; }
    return out;
  };
  // A heredoc body as its command reads it: an unquoted one with each `$( )` and backtick replaced by what it prints, where
  // that is an echo, printf or cat (the eleventh review: `sh <<E` holding `$(echo git push)` fed sh a push); another program's
  // output stays as written
  // `$NAME` / `${NAME}` in text the shell expands, as the literal the command bound it to - an escaped one, or one
  // bound to anything else, stays as written (the twelfth review, 3: `x="git push"; sh <<<"$x"` ran a push read as `$x`)
  const boundIn = (text, at) => {
    if (!text.includes('$')) return text;
    const re = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      let k = m.index;
      while (k > 0 && text[k - 1] === '\\') k--;
      if ((m.index - k) % 2) continue; // an escaped `$` (the thirteenth review: a backslash run backtracked 23 s)
      if (!vars) vars = shellVars(P, {});
      const v = vars.literalOf(m[1] || m[2], at);
      if (v === null) continue;
      if (!run.budget.take(v.length)) { deepPrint = true; return text; } // the thirteenth review: 3 GB unread
      out += text.slice(last, m.index) + v;
      last = re.lastIndex;
    }
    return out + text.slice(last);
  };
  const bodyText = (src, h, depth) => {
    const body = bodyOf(src, h);
    if (h.quoted || !/[$`]/.test(body)) return body;
    if (depth > PRINT_DEPTH) { deepPrint = true; return body; }
    const vs = (t) => (src === raw ? boundIn(t, h.index) : t);
    let out = '';
    let last = 0;
    for (const sub of lexShell(body, true).subs) {
      if (sub.close >= body.length) break;
      const p = printOf(body, sub.open, sub.close + 1, depth);
      if (p === null) continue;
      out += vs(body.slice(last, sub.open)) + p;
      last = sub.close + 1;
    }
    return out + vs(body.slice(last));
  };
  // A here-string's text: its word expanded with no splitting, a substitution's output in place (the eleventh review:
  // `bash <<<"$(echo git push)"` ran a push read as the text `$(echo git push)`)
  const hereString = (src, t, depth) => {
    const p = /[$`]/.test(t.raw) ? subPrintIn(src, t, depth, true) : null;
    if (p !== null) return p;
    if (src === raw && /[$`]/.test(t.raw)) {
      const y = expandWord(t, t.s, null);
      if (y && y.fields) {
        // bash 3.2 splits an unquoted here-string's value and joins the fields; bash 5 and zsh keep it whole, newlines
        // and all (review 14, 4: `x="true<newline>git push"; bash <<< $x` pushes in zsh)
        const split = y.fields.join(' ');
        const w = expandWord(t, t.s, null, true);
        const whole = w && w.fields ? w.fields.join(' ') : split;
        if (whole !== split) readingsDiffer = true;
        return bashReading ? split : whole;
      }
    }
    return dequote(t.raw);
  };
  // A word holding substitutions (`"$(cat <<'EOF' ... EOF)"`, `"eval "$(echo x)""`, a backtick): its text with each one
  // replaced by what it prints - null when any one is another program's, whose output does not exist until it runs
  const subPrintIn = (src, t, depth, whole) => {
    if (!t || !t.lex) return null;
    if (depth > PRINT_DEPTH) { deepPrint = true; return null; }
    const m = subsIn(t.lex, t.s, t.e);
    if (!m.size) return null;
    const outs = [];
    const mark = (k) => `\u0001${k}\u0001`;
    let word = '';
    let last = t.s;
    let dq = false; // inside double quotes where the scan stands: an unquoted substitution's output is split into words
    let braces = 0; // the `${` open there: a variable's value decides where an output inside one lands
    const scan = (from, to) => {
      for (let i = from; i < to; i++) {
        const ch = src[i];
        if (ch === '\\') i++;
        else if (ch === "'" && !dq && !braces) { const j = src.indexOf("'", i + 1); i = j < 0 ? to : j; }
        else if (ch === '"') dq = !dq;
        else if (ch === '$' && src[i + 1] === '{') { braces++; i++; }
        else if (ch === '}' && braces) braces--;
      }
    };
    for (const [off, end] of [...m].sort((x, y) => x[0] - y[0])) {
      const p = printOf(src, t.s + off, t.s + end + 1, depth);
      if (p === null) return null;
      scan(last, t.s + off);
      if (braces) { paramPrint = true; return null; } // `${y:=$(echo a; git push)}` (the tenth fuzz pass)
      word += src.slice(last, t.s + off) + mark(outs.length);
      outs.push(dq || whole ? p : p.split(/[ \t\n]+/).filter(Boolean).join(' ')); // eval joins the words with blanks
      last = t.s + end + 1;
    }
    let text = dequote(word + src.slice(last, t.e));
    outs.forEach((p, k) => { text = text.split(mark(k)).join(p); });
    return text;
  };
  // echo's or printf's words with each substitution's output in place where it prints, else kept as written (the ninth
  // fuzz pass: a printed `$(echo 'a')` kept whole held quotes the next shell never sees)
  const printedWords = (src, k, c, depth) => k.words.slice(c.at + 1).map((t) => {
    const p = /[$`]/.test(t.raw) ? subPrintIn(src, t, depth) : null;
    return p !== null ? p : dequote(src.slice(t.s, t.e), process.platform, t.lex && /[$`]/.test(t.raw) ? subsIn(t.lex, t.s, t.e) : null);
  });
  const subPrint = (t) => subPrintIn(raw, t, 0);
  // A command word's expansions, as the shell makes them into fields (the twelfth review, 4: `cmd=(git push); "${cmd[@]}"`,
  // `set -- git push; "$@"`, `x=$(echo git push); $x`, `${x:-git push}`, zsh's `${=x}`, `IFS=,` and `$x$y` each ran a
  // push read as one word, or as none). Read: a bound literal, an array `${a[@]}` / `${a[*]}` (`$a` as every element, as
  // zsh), the positional words of the newest `set --`, a `:-` / `-` default, an assignment that is one print substitution
  // and a print substitution in place. An unquoted part is split on IFS (its bound literal, else blanks), a double-quoted
  // one is one field, `"${a[@]}"` and `"$@"` one per element. Returns { fields, plain, bound } - `plain` when the word
  // is only quoted variables, which the command's own name already reads - or { unknown, git } when a part is another
  // program's output or a value the command does not spell out, `git` when its binding or the word names git; null when
  // the word expands nothing.
  const within = frameWithin;
  // Each `set` that sets the positional words: after `--` or `-`, or from its first word that is no option (`set -e --
  // git push`, `set - git push` - the thirteenth review), its words read lazily, each expanded as a command word is
  let setsAt = null;
  const setsOf = () => {
    if (setsAt) return setsAt;
    setsAt = [];
    for (const k of P.cmds) {
      for (const c of k.cands) {
        if (c.name !== 'set') continue;
        let w = c.at + 1;
        let list = false;
        for (; w < k.words.length; w++) {
          const a = dequote(k.words[w].raw);
          if (a === '--' || a === '-') { w++; list = true; break; }
          if (/^[-+][A-Za-z]*o$/.test(a)) { w++; continue; } // `-o name`, and a cluster ending in o (`-euo pipefail`)
          if (/^[-+]/.test(a)) continue;
          list = true;
          break;
        }
        if (list) setsAt.push({ at: k.words[c.at].s, end: k.words[k.words.length - 1].e, frame: k.frame, words: k.words.slice(w), args: null });
      }
    }
    setsAt.sort((x, y) => x.at - y.at);
    setsAt.forEach((st, i) => { st.i = i; });
    return setsAt;
  };
  // A set's words, read oldest set first: a `"$@"` in one reads the set before it, already read, so a chain of
  // `set -- "$@" a` costs one level of recursion, never one per set (review 14, 2: 2,000 sets overflowed the stack and
  // every guard failed open)
  let setsRead = 0;
  const argsOf = (st) => {
    if (st.args) return st.args;
    const list = setsOf();
    for (; setsRead < st.i; setsRead++) if (!list[setsRead].args) argsOne(list[setsRead]);
    return argsOne(st);
  };
  const argsOne = (st) => {
    if (st.args) return st.args;
    st.args = { unknown: true, git: false }; // while its own words are read
    const list = [];
    let unknown = null;
    for (const t of st.words) {
      if (!/[$`]/.test(t.raw)) { list.push(dequote(t.raw)); continue; }
      const y = expandWord(t, t.s, st.frame);
      if (y && y.fields) list.push(...y.fields);
      else if (y && y.unknown) { unknown = { unknown: true, git: y.git || gitWord(t.raw) }; break; }
      else list.push(dequote(t.raw));
    }
    st.args = unknown || { list };
    return st.args;
  };
  // the positional words at `at` in `frame`: the newest set before it that ended before it, in that frame or one around it
  const positionalAt = (at, frame) => {
    const list = setsOf();
    let lo = 0;
    let hi = list.length - 1;
    let i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].at < at) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    for (let n = 0; i >= 0 && n < 64; i--, n++) if (list[i].end <= at && within(frame, list[i].frame)) return argsOf(list[i]);
    return i >= 0 ? { unknown: true, git: true } : null; // past 64 sets in other frames: not read, so judged as naming git (review 14, 8)
  };
  const arrays = new Map();
  const elementsOf = (ev) => {
    if (arrays.has(ev)) return arrays.get(ev);
    const inner = String(ev.raw).slice(1, -1);
    const r = /[$`]/.test(inner) || !run.budget.take(inner.length) ? { unknown: true, git: gitWord(inner) }
      : { els: parseShell(inner).cmds.flatMap((k) => k.words.map((w) => dequote(w.raw))) };
    arrays.set(ev, r);
    return r;
  };
  // `name[i]=...` / `name[i]+=...` between an array's assignment and its use: the elements are no longer the list's
  let elemAt = null;
  const elementSetBetween = (name, from, to) => {
    if (!elemAt) {
      elemAt = new Map();
      for (const m of P.command.matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)\[[^\]\n]{0,64}\]\+?=/g)) {
        if (!elemAt.has(m[1])) elemAt.set(m[1], []);
        elemAt.get(m[1]).push(m.index);
      }
    }
    const ps = elemAt.get(name);
    if (!ps) return false;
    let lo = 0;
    let hi = ps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ps[mid] <= from) lo = mid + 1; else hi = mid; }
    return lo < ps.length && ps[lo] < to;
  };
  // Whether anything binding `name` - a loop's word list, an assignment, an append, an element - names git as a word (the
  // thirteenth review: `for c in "git push"; do $c; done` and `cmd=(git); cmd+=(push); "${cmd[@]}"` ran unread)
  // Bounded (review 14, 6: `\([^)]*\)` rescanned to the end of the text at each `a=(`, 8.8 s on 200 KB): a loop list is read
  // to 1 KB - a longer one is judged as naming git - and an array to its first `)`, found once for every array after it.
  const LIST_MAX = 1024;
  const binders = new Map();
  const binderGit = (name) => {
    if (binders.has(name)) return binders.get(name);
    let v = false;
    const src = P.command;
    if (run.budget.take(src.length)) {
      for (const m of src.matchAll(new RegExp(`\\b(?:for|select)\\s+${name}\\s+in\\b([^;\\n]{0,${LIST_MAX}})`, 'g'))) {
        if (m[1].length >= LIST_MAX || gitWord(m[1])) { v = true; break; }
      }
      let close = -2;
      for (const m of v ? [] : src.matchAll(new RegExp(`\\b${name}(?:\\[[^\\]\\n]{0,64}\\])?\\+?=`, 'g'))) {
        const p = m.index + m[0].length;
        let val = /^[^\s;&|]{0,1024}/.exec(src.slice(p, p + 1024))[0];
        let cut = val.length >= 1024; // a value past 1 KB is judged as naming git, as a list past it is (review 15, 3)
        if (src[p] === '(') {
          if (close !== -1 && close < p) close = src.indexOf(')', p);
          if (close >= 0) {
            val = src.slice(p, close + 1);
            cut = false;
            if (!run.budget.take(val.length)) { deepPrint = true; v = true; break; }
          }
        }
        if (cut || gitWord(val)) { v = true; break; }
      }
    } else deepPrint = true;
    binders.set(name, v);
    return v;
  };
  // The words a loop runs a name through (review 14, 5: `for t in git node; do $t --version; done` read as an unknown git
  // command): a use INSIDE the body of a `for` / `select` binding the name over plain words reads the words of its
  // innermost such loop - and of each same-name loop that opened inside that body before the use - as the command in
  // turn. Review 15, 1: after the loop, or in a script a parent's assignment reaches, the name holds what the reader cannot
  // see (`(for t in git; do :; done); $t`), so only a body counts, by the parser's `for` / `done` pairs; and only when the
  // name appears nowhere but those heads and plain uses (`${t:=...}`), every IFS set is blanks, no builtin assigns a name
  // the command computes (`read "$v"`), and no eval, source or `.` runs in the body before the use. Review 16: those are
  // read as command words, never as text (`find . -name`, `cd .` and `export FOO=1` kept nothing from being read), a head
  // counts where the parser opens its block (`do for t in ...`, `then for ...`), and a use reads its own loop's words, not
  // every same-name loop's (1,000 repeated loops pushed a million calls). Anything else gives null - the conservative
  // reading stands.
  const ASSIGNING = new Set(['read', 'readarray', 'mapfile', 'getopts', 'declare', 'typeset', 'local', 'export', 'readonly', 'unset', 'let', 'vared', 'coproc', 'zparseopts', 'zstyle', 'zformat', 'strftime', 'sysread', 'getln', 'zregexparse', 'pcre_match']);
  const SOURCING = new Set(['eval', 'source', '.']);
  let loopScan = null; // once per command: an assignment to a computed name anywhere, and each eval / source / `.`
  const loopScanOf = () => {
    if (loopScan) return loopScan;
    loopScan = { computed: false, sourcing: [] };
    const named = (r) => !/[$`]/.test(r) || /^-/.test(r) || /^[A-Za-z_]\w*(?:\[[^\]\n]{0,64}\])?\+?=/.test(r);
    for (const c of P.cmds) {
      for (const k of c.cands || []) {
        if (SOURCING.has(k.name)) { loopScan.sourcing.push(c); continue; }
        const flag = k.name === 'printf' || k.name === 'print' ? 'v' : k.name === 'wait' ? 'p' : null;
        for (let w = k.at + 1; w < c.words.length; w++) {
          const r = c.words[w].raw;
          // printf / print bind only after -v, wait only after -p; the others bind their name words
          if (flag) {
            if (r === `-${flag}` && w + 1 < c.words.length && !named(c.words[w + 1].raw)) loopScan.computed = true;
            else if (r.startsWith(`-${flag}`) && r.length > 2 && /[$`]/.test(r)) loopScan.computed = true;
          } else if (ASSIGNING.has(k.name) && !named(r)) loopScan.computed = true;
        }
      }
    }
    return loopScan;
  };
  let ifsState;
  const ifsBlank = () => { // every IFS the command sets is blanks (`IFS=$'\n'`), and nothing else names IFS but a read
    if (ifsState !== undefined) return ifsState;
    const src = P.command;
    const sets = new Map();
    for (const e of P.assignEvents || []) if (e.name === 'IFS') sets.set(e.at, e);
    ifsState = true;
    for (const m of src.matchAll(/\bIFS\b/g)) {
      const i = m.index;
      if (src[i - 1] === '$' || (src[i - 1] === '{' && src[i - 2] === '$' && src[i + 3] === '}')) continue;
      const e = sets.get(i);
      if (e && /^[ \t\n]*$/.test(String(e.value))) continue;
      ifsState = false;
      break;
    }
    return ifsState;
  };
  const loopOk = new Map();
  const loopNameOk = (name, heads) => {
    if (loopOk.has(name)) return loopOk.get(name);
    const ok = (() => {
      if (loopScanOf().computed || !ifsBlank()) return false;
      for (const h of heads.values()) for (const w of h.list) if (w.raw.length > 1024 || /[$`*?[\]{}~\\'"()<>=]/.test(w.raw)) return false;
      const src = P.command;
      // binderGit already charged this name's scan (review 15, 6: a second charge halved the padding that drops every call)
      if (!binders.has(name) && !run.budget.take(src.length)) { deepPrint = true; return false; }
      const headAt = new Set([...heads.values()].map((h) => h.nameAt));
      for (const m of src.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
        const i = m.index;
        if (headAt.has(i) || src[i - 1] === '$' || (src[i - 1] === '{' && src[i - 2] === '$' && src[i + name.length] === '}')) continue;
        return false;
      }
      return true;
    })();
    loopOk.set(name, ok);
    return ok;
  };
  const loopItems = (name, cmd) => {
    const at = loopAt(P, name, cmd);
    if (!at || !loopNameOk(name, loopHeadsIn(P).get(name))) return null;
    for (const c of loopScanOf().sourcing) if (c.index > at.best.index && c.index < cmd.index) return null;
    return [...new Set(at.words.map((w) => w.raw))];
  };
  // A command word that is one loop name, bare or quoted: the commands it runs, one a list word (null: not such a word)
  const loopWordItems = (tok, cmd) => {
    const m = /^(")?\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))(")?$/.exec(tok.raw);
    if (!m || !m[1] !== !m[4]) return null;
    const items = loopItems(m[2] || m[3], cmd);
    if (!items) return null;
    return items.map((it) => (m[1] ? fieldWord(it) : it.split(/[ \t\n]+/).filter(Boolean).map(fieldWord).join(' ')));
  };
  const assignedPrint = (ev, name) => {
    const r = String(ev.raw);
    let a = ev.at + name.length + 1;
    if (raw.slice(a, a + r.length) !== r) return null;
    let e = a + r.length;
    if (r.length > 1 && r[0] === '"' && r[r.length - 1] === '"') { a++; e--; }
    const t = raw.slice(a, e);
    if (!/\b(?:echo|printf|cat)\b/.test(t) || !(t[0] === '`' || t.startsWith('$('))) return null;
    if (!(lexShell(t).subs || []).some((x) => x.open === 0 && x.close === t.length - 1)) return null;
    return printOf(raw, a, e, 0);
  };
  const nameValue = (name, at) => {
    if (!vars) vars = shellVars(P, {});
    const ev = vars.eventOf(name, at);
    if (!ev) return { unknown: true, git: false, unset: true };
    if (ev.bound) return { unknown: true, git: binderGit(name) };
    const r = String(ev.raw !== undefined ? ev.raw : ev.value);
    if (r.length > 1 && r[0] === '(' && r[r.length - 1] === ')') {
      if (elementSetBetween(name, ev.at, at)) return { unknown: true, git: binderGit(name) };
      const x = elementsOf(ev);
      return x.els ? { v: x.els.join(' '), els: x.els } : x;
    }
    const lit = vars.literalOf(name, at);
    if (lit !== null) return { v: lit };
    const p = assignedPrint(ev, name);
    return p !== null ? { v: p } : { unknown: true, git: gitWord(r) };
  };
  const fieldWord = (w) => (/^[\w@%+=:,./*?[\]-]+$/.test(w) ? w : runnerQuote(w));
  // `$'...'`: bash's and zsh's C-style string, its escapes read (\c ends it)
  const ansiC = (src, i) => {
    let j = i + 2;
    while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
    let text = '';
    for (let k = i + 2; k < Math.min(j, src.length);) {
      if (src[k] !== '\\') { text += src[k]; k++; continue; }
      const e = escapeAt(src, k, true);
      if (e.stop) break;
      text += e.text;
      k += e.len;
    }
    return { text, end: j };
  };
  const expandWord = (tok, at, frame, nosplit = false) => {
    const src = tok.raw;
    const subs = tok.lex ? [...subsIn(tok.lex, tok.s, tok.e)].sort((x, y) => x[0] - y[0]) : [];
    const parts = [];
    let lit = null;
    let dq = false;
    let expanded = false;
    let plain = true;
    let printed = false;
    let anyVar = false;
    let unknown = null;
    const flush = () => { if (lit !== null) { parts.push({ text: lit }); lit = null; } };
    const miss = (git) => { if (!unknown) unknown = { unknown: true, git: false }; if (git) unknown.git = true; };
    const put = (v, o = {}) => {
      if (!run.budget.take(String(v).length)) { deepPrint = true; miss(false); return; } // the thirteenth review: 100 s
      flush();
      expanded = true;
      if (!dq || o.many || o.reread) plain = false;
      parts.push(o.many && dq ? { many: o.many } : { text: v, split: !dq });
    };
    const lookup = (name) => { const r = nameValue(name, at); if (r.unknown) { miss(r.git); return null; } anyVar = true; return r; };
    let si = 0;
    for (let i = 0; i < src.length; i++) {
      while (si < subs.length && subs[si][0] < i) si++;
      if (si < subs.length && subs[si][0] === i && (src[i] === '`' || src.startsWith('$(', i))) {
        const [off, end] = subs[si++];
        const p = /\b(?:echo|printf|cat)\b/.test(src.slice(off, end + 1)) ? printOf(raw, tok.s + off, tok.s + end + 1, 0) : null;
        if (p === null) miss(false);
        else { put(p); plain = false; printed = true; }
        i = end;
        continue;
      }
      const ch = src[i];
      if (ch === '\\') { lit = (lit || '') + (dq && !'$`"\\\n'.includes(src[i + 1]) ? ch : '') + (src[i + 1] || ''); i++; continue; }
      if (ch === "'" && !dq) { const j = src.indexOf("'", i + 1); lit = (lit || '') + src.slice(i + 1, j < 0 ? src.length : j); i = j < 0 ? src.length : j; continue; }
      if (ch === '"') { dq = !dq; lit = lit || ''; continue; }
      if (ch !== '$') { lit = (lit || '') + ch; continue; }
      if (src[i + 1] === "'" && !dq) { const q = ansiC(src, i); lit = (lit || '') + q.text; i = q.end; continue; }
      let body;
      if (src[i + 1] === '{') { // to its own `}`, past any `${...}` inside (`${x:-${y}}`)
        let j = i + 2;
        for (let d = 1; j < src.length; j++) {
          if (src[j] === '$' && src[j + 1] === '{') { d++; j++; } else if (src[j] === '}' && --d === 0) break;
        }
        if (j >= src.length) { miss(false); break; }
        body = src.slice(i + 2, j);
        i = j;
      }
      else { const m = /^(?:[A-Za-z_]\w*|[@*#?$!0-9-])/.exec(src.slice(i + 1, i + 256)); if (!m) { lit = (lit || '') + ch; continue; } body = m[0]; i += m[0].length; }
      let m;
      if ((m = /^([@*1-9])$/.exec(body))) {
        const st = positionalAt(at, frame);
        if (!st || st.unknown) { miss(st ? st.git : false); continue; }
        anyVar = true;
        if (m[1] === '@' || m[1] === '*') put(st.list.join(' '), { many: m[1] === '@' ? st.list : null, reread: true });
        else put(st.list[Number(m[1]) - 1] || '', { reread: true });
      } else if ((m = /^([A-Za-z_]\w*)\[([@*])\]$/.exec(body))) {
        const r = lookup(m[1]);
        if (r) put(r.v, { many: m[2] === '@' ? (r.els || [r.v]) : null, reread: true });
      } else if ((m = /^([A-Za-z_]\w*)\[(\d{1,6})\]$/.exec(body))) {
        // one element: bash counts from 0, zsh from 1
        const r = lookup(m[1]);
        const n = Number(m[2]);
        if (r && r.els) {
          const bash = r.els[n] === undefined ? '' : r.els[n];
          const zsh = n > 0 && r.els[n - 1] !== undefined ? r.els[n - 1] : '';
          if (bash !== zsh) readingsDiffer = true;
          put(bashReading ? bash : zsh, { reread: true });
        } else if (r) { if (n === 0) put(r.v, { reread: true }); else miss(false); }
      } else if ((m = /^=([A-Za-z_]\w*)$/.exec(body))) {
        const r = lookup(m[1]);
        if (r) put(r.v, { reread: true });
      } else if ((m = /^([A-Za-z_]\w*)(:?-)([\s\S]*)$/.exec(body))) {
        const r = nameValue(m[1], at);
        const named = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))$/.exec(m[3]);
        if (r.unknown && r.git) miss(true);
        else if (r.v !== undefined && (m[2] === '-' || r.v !== '')) { anyVar = true; put(r.v, { reread: true }); }
        else if (named) { const d = lookup(named[1] || named[2]); if (d) put(d.v, { reread: true }); }
        else if (/[$`]/.test(m[3])) miss(gitWord(m[3]));
        else put(dequote(m[3]), { reread: true });
      } else if ((m = /^([A-Za-z_]\w*)$/.exec(body))) {
        const r = lookup(m[1]);
        if (r) put(r.v);
      } else miss(false); // `$#`, `$?`, `${#x}`, `${x/a/b}`: not modelled
    }
    flush();
    if (unknown) return { unknown: true, git: unknown.git || gitWord(outsideSubs(tok)) };
    if (!expanded) return null;
    const ifsR = nameValue('IFS', at);
    const ifs = ifsR.v !== undefined ? ifsR.v : ' \t\n';
    const sep = ifs ? new RegExp(`[${ifs.replace(/[\]\\^-]/g, '\\$&')}]`) : null;
    const fields = [];
    let cur = null;
    for (const p of parts) {
      if (p.many) { p.many.forEach((w, n) => { if (n === 0) cur = (cur === null ? '' : cur) + w; else { fields.push(cur); cur = w; } }); continue; }
      if (!p.split || !sep || nosplit) { cur = (cur === null ? '' : cur) + p.text; continue; }
      p.text.split(sep).forEach((w, n) => {
        if (n > 0 && cur !== null) { fields.push(cur); cur = null; }
        if (w) cur = (cur === null ? '' : cur) + w;
      });
    }
    if (cur !== null) fields.push(cur);
    return { fields, plain, bound: anyVar && !printed };
  };
  const DEEP_WHY = 'output printed through substitutions nested too deep to read, or inside a parameter expansion whose value decides where it lands';
  const ODD_WHY = 'a printf conversion the reader does not model (a * width, a float or an unknown one), printing text a shell then runs';
  // an odd printf is unread whatever its text names: what it prints is not known (the twelfth review, 8)
  const flagged = (at) => { if (oddPrint) unread(at, ODD_WHY, null, true); else if (deepPrint || paramPrint) unread(at, DEEP_WHY); };
  // A `<( )` word: the commands inside it
  const procSub = (t) => {
    if (!t || !t.raw.startsWith('<(')) return null;
    const fr = mapsOf().byOpen.get(t.s);
    return fr && fr.kind === '<(' ? levelOf(P, fr, fr.cmdFrom, fr.cmdTo) : null;
  };
  const STDIN_FILE = /^\/(?:dev\/stdin|dev\/fd\/0|proc\/self\/fd\/0)$/;
  const unsureAt = lexShell(raw).unsure;
  if (unsureAt >= 0) unread(unsureAt, 'a heredoc with no terminator line inside a substitution, which bash 3.2 ends at its ) and bash 5 and zsh do not');
  if (lexShell(raw).doubt >= 0) unread(lexShell(raw).doubt, lexShell(raw).doubtWhy);
  // An unquoted heredoc's body is expanded before its command reads it, so each `$( )` and backtick in it runs, in a
  // subshell, where the command stands (the differential fuzzer against bash and zsh, 2026-11-05: `cat <<E` holding
  // `$(git push)` went unread by every guard). A backtick's `\``, `\$` and `\\` are undone first, as bash does.
  for (const h of heredocAt) {
    if (h.quoted) continue;
    const body = raw.slice(h.bodyStart, h.bodyEnd);
    if (!/[$`]/.test(body)) continue;
    for (const sub of lexShell(body, true).subs) {
      // dash parses a substitution in the body as it reads it, on past the terminator line; bash ends the body there
      if (sub.close >= body.length) unread(h.bodyStart + sub.open, 'a substitution its heredoc body leaves open: dash reads on past the terminator line, bash ends the body there');
      const at = h.bodyStart + sub.open;
      const end = h.bodyStart + sub.close;
      if (sub.kind === '$(') push({ text: body.slice(sub.open + 2, sub.close), at: at + 2, end, mapped: true, cwd: anchor(h.index) });
      else push({ text: body.slice(sub.open + 1, sub.close).replace(/\\([$`\\])/g, '$1'), at, end, mapped: false, cwd: anchor(h.index) });
    }
  }
  // zsh runs the code a glob qualifier names - `*(e:'git push':)`, `*(+fn)` - for each file the glob matches, and the `(e)` flag of
  // a parameter expansion expands its value again (the eleventh review: both went unread by every guard). A qualifier list
  // is a `( )` opened right after a word character, never an empty `()`; bash reads the same text as an extglob, which runs
  // nothing, so reading it as zsh errs toward judging. An `(e)` value the command bound to a literal is carried, any other
  // unread.
  // Each list is read at its own level, a nested `( )` a blank in it, so a nest is read once, not once per level (the
  // twelfth review, 6: `a(` nested 100,000 deep read its text 100,000 times)
  const kids = new Map();
  for (const fr of P.frames) if (fr.parent) { if (!kids.has(fr.parent)) kids.set(fr.parent, []); kids.get(fr.parent).push(fr); }
  for (const fr of P.frames) {
    if (fr.kind !== '(' || fr.close === undefined || fr.close === fr.open + 1 || fr.open === 0 || !QUAL_AFTER.test(P.command[fr.open - 1])) continue;
    let own = '';
    let last = fr.open + 1;
    for (const k of kids.get(fr) || []) { // a substitution in the list stays: zsh runs it (the thirteenth review)
      if (k.kind !== '(') continue;
      if (k.close === undefined || k.open < last) break;
      own += `${P.command.slice(last, k.open)} `;
      last = k.close + 1;
    }
    own += P.command.slice(last, fr.close);
    if (!run.budget.take(own.length)) { unread(fr.open, run.budget.why); break; }
    for (const code of qualifierCode(own)) push({ text: code, at: fr.open, end: fr.close + 1, mapped: false, cwd: anchor(fr.open) });
  }
  for (const m of P.command.matchAll(PARAM_E)) {
    if (!/e/.test(m[1].replace(/[jslrZgI_](\W).*?\1/g, '')) || singleQuoted(P, m.index)) continue;
    if (!vars) vars = shellVars(P, {});
    const v = vars.literalOf(m[2], m.index);
    if (v === null) unread(m.index, "zsh's (e) flag expands again a value the command does not spell out");
    else push({ text: v, at: m.index, end: m.index + m[0].length, mapped: false, cwd: anchor(m.index), bound: true });
  }
  for (let k = 0; k < P.cmds.length; k++) {
    const cmd = P.cmds[k];
    if (lateHere(run, k, cmd)) break;
    for (const c of cmd.cands) {
      const tok = cmd.words[c.at];
      const at = tok.s;
      const el = cmd.elem || { from: at, to: P.command.length, cmds: [cmd] };
      const name = c.name;
      // A command word that is an unquoted substitution or variable: the shell splits what it expands to into words, the
      // first of them the command (beside the eleventh review: `$(echo git push)`, ``echo git` push`, `x="git push"; $x` and
      // `x="rm -rf /"; $x` each ran unread). The words are literal - `literalWords` - and a word quoted outside its
      // substitutions is one word, a command of that whole name. A variable is read from the literal the command bound it to,
      // never its name as a path (`rm -rf /` named nothing); another program's output is not known before it runs, and stays
      // as it was read. A word that names no print is not parsed again.
      if (/[$`]/.test(tok.raw)) {
        resetPrint();
        const x = expandWord(tok, at, cmd.frame);
        // each later word expanded too, so a re-read line never meets a name it cannot see (`${cmd[0]} ${cmd[1]}`)
        const restOf = () => {
          let rest = '';
          let pos = tok.e;
          for (let w = c.at + 1; w < cmd.words.length; w++) {
            const t2 = cmd.words[w];
            let txt = P.command.slice(t2.s, t2.e);
            if (/[$`]/.test(t2.raw)) { const y = expandWord(t2, t2.s, cmd.frame); if (y && y.fields) txt = y.fields.map(fieldWord).join(' '); }
            rest += P.command.slice(pos, t2.s) + txt;
            pos = t2.e;
          }
          return rest;
        };
        const items = x && x.unknown && x.git ? loopWordItems(tok, cmd) : null;
        if (items) {
          const rest = restOf();
          flagged(at);
          for (const it of items) if (it.trim()) push({ text: it + rest, at, end: el.to, mapped: false, cwd: anchor(at) });
          continue;
        }
        if (x && x.unknown && x.git) unread(at, 'a command word built from a value the reader cannot know, whose binding names git', null, true);
        // a first field reading `NAME=...` is left to the parser, which already reads such a word both as a name and as an
        // assignment: a line re-read from it would count the command after it twice
        const words = x && x.fields && !x.plain && !/^[A-Za-z_]\w*=/.test(x.fields[0] || '') ? x.fields.map(fieldWord).join(' ') : '';
        if (words.trim()) {
          const rest = restOf();
          flagged(at);
          push({ text: words + rest, at, end: el.to, mapped: false, cwd: anchor(at), ...(x.bound ? { bound: true } : {}) });
          continue;
        }
        flagged(at);
      }
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
          if (STDIN_FILE.test(w)) stdin = true;
          break;
        }
        if (noexec) continue;
        if (cform >= 0) {
          if (cform >= args.length) continue;
          const t = args[cform];
          const named = boundTok(t);
          // a word whose substitutions print through echo, printf or cat is the script with their output in place; their
          // own commands run where this command stands, and are read there
          resetPrint();
          const printed = named === null ? subPrint(t) : null;
          flagged(at);
          if (named !== null) push({ text: named, at, end: el.to, mapped: false, cwd: anchor(at), bound: true });
          else if (printed !== null) push({ text: printed, at, end: el.to, mapped: false, cwd: anchor(at) });
          else if (verbatimWord(t, P)) push({ text: t.raw.slice(1, -1), at: t.s + 1, end: t.e - 1, mapped: true, cwd: anchor(at) });
          else push({ text: argv[cform], at, end: el.to, mapped: false, cwd: anchor(at) });
          continue;
        }
        const inner = file >= 0 && !stdin ? procSub(args[file]) : null;
        if (inner) { for (const t of printedBy(inner, at)) push({ ...t, cwd: t.cwd !== undefined ? t.cwd : anchor(at), at, end: el.to, mapped: false }); continue; }
        if (file >= 0 && !stdin) {
          const t = fromFile(argv[file], at, false, args[file]);
          if (t) push({ ...t, at, end: el.to, mapped: false });
          continue;
        }
        const texts = stdinTexts(cmd, el, at);
        for (const t of texts) push({ ...t, cwd: t.cwd !== undefined ? t.cwd : anchor(at), at, end: el.to, mapped: false });
        continue;
      }
      if (name === 'eval') {
        // eval parses its words again, so a `$NAME` word runs its value whatever the quoting; its words are the parser's
        // own, ending where the command ends (a backtick round it too) with each substitution kept whole
        let bound = false;
        resetPrint();
        const words = c.argv.map((w, k) => {
          const v = boundText(w, at);
          if (v === null) { const p = subPrint(c.args[k]); return p === null ? w : p; } // as for `-c` above
          bound = true;
          return v;
        });
        flagged(at);
        push({ text: words.join(' '), at, end: el.to, mapped: false, sourced: true, cwd: anchor(at), ...(bound ? { bound } : {}) });
        continue;
      }
      if (name === 'env') { // `env -S '<line>'` splits the line into a command it runs
        for (let k = 0; k < c.argv.length; k++) {
          const w = c.argv[k];
          const v = w === '-S' || w === '--split-string' ? c.argv[k + 1] : /^-S./.test(w) ? w.slice(2) : w.startsWith('--split-string=') ? w.slice(15) : null;
          if (v) {
            push({ text: v, at, end: el.to, mapped: false, cwd: anchor(at) });
            // BSD env (macOS) keeps a backslash-newline's line break, which a shell would join (the seventh fuzz pass);
            // the parser's words have it joined already, so it is read from the word as written
            const own = w === '-S' || w === '--split-string';
            const t = own ? c.args[k + 1] : c.args[k];
            const r = t ? dequote(raw.slice(t.s, t.e)) : '';
            const rv = own ? r : r.slice(w.length - v.length);
            if (/\\\n/.test(rv)) push({ text: rv.replace(/\\\n/g, '\n'), at, end: el.to, mapped: false, cwd: anchor(at) });
            break;
          }
          if (!w.startsWith('-')) break;
        }
        continue;
      }
      if (name === 'trap') {
        // trap's action is a script the shell runs when the signal comes - EXIT at the end of this very command (the
        // eighth R015 review: `trap 'git push --force origin main' EXIT` went unread by every guard); `-l` / `-p` print,
        // `-` resets and an empty action ignores
        let k = 0;
        while (k < c.argv.length && /^-[lp]+$/.test(c.argv[k])) k++;
        if (c.argv[k] === '--') k++;
        const action = c.argv[k];
        if (action && action !== '-') {
          const v = boundTok(c.args[k]);
          push({ text: v !== null ? v : action, at, end: el.to, mapped: false, sourced: true, cwd: anchor(at), ...(v !== null ? { bound: true } : {}) });
        }
        continue;
      }
      if (name === 'source' || name === '.') {
        const inner = procSub(c.args[0]);
        if (inner || STDIN_FILE.test(c.argv[0] || '')) {
          for (const t of inner ? printedBy(inner, at) : stdinTexts(cmd, el, at)) push({ ...t, cwd: t.cwd !== undefined ? t.cwd : anchor(at), at, end: el.to, mapped: false, sourced: true });
          continue;
        }
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
      // the sensitive runner: its command line runs through a shell (audit 2026-10-30 HK-01)
      const sr = runnerLine(c, P, boundTok);
      if (sr) {
        push({ ...sr, at: sr.mapped ? sr.at : at, end: sr.mapped ? sr.end : el.to, cwd: anchor(at), runner: true });
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
  try { return carriedScriptsIn(raw, opts); }
  catch (e) {
    bashReading = false;
    readingsDiffer = false;
    const none = [];
    none.unread = opts.run ? opts.run.unread : [];
    none.unread.push({ at: 0, why: `the reader failed on this command (${(e && e.name) || 'error'})`, path: null, force: true });
    return none;
  }
}
function carriedScriptsIn(raw, opts = {}) {
  const text = String(raw || '');
  const run = opts.run || newRun(opts);
  if (run.budget.over()) { run.unread.push({ at: 0, why: run.budget.why, path: null }); const none = []; none.unread = run.unread; return none; }
  const heredocs = heredocsOf(text);
  const command = joinContinuations(blankComments(blankHeredocs(text, heredocs)));
  const P = parseShell(command);
  const out = carriedBoth(P, text, heredocs, opts, run);
  out.unread = run.unread;
  return out;
}
// carriedBoth: carriedOf, read again with `bashReading` on when the shells part on this command - bash's reading's
// scripts join the first's. The one home for carriedScripts and scanShell (gate 13: scanShell read the first alone, so a
// write only bash's echo carried - a Windows path's backslashes, the text after a `\c` - passed the cross-project guard).
function carriedBoth(P, raw, heredocs, opts, run) {
  const outer = readingsDiffer;
  readingsDiffer = false;
  const out = carriedOf(P, raw, heredocs, opts, run);
  if (readingsDiffer && !bashReading) {
    bashReading = true;
    try {
      const seen = new Set(out.map((sc) => `${sc.at}\0${sc.text}`));
      for (const sc of carriedOf(P, raw, heredocs, opts, run)) if (!seen.has(`${sc.at}\0${sc.text}`)) out.push(sc);
    } finally { bashReading = false; }
  }
  readingsDiffer = outer || readingsDiffer;
  return out;
}

// ---- the variable expander: the ONE home (audit 2026-10-30 a0; HK-04, HK-10, HK-13) --------------------------------
// What a word names once the shell has expanded it, read from the command's own text: `$NAME` / `${NAME}` (its `:-`,
// `-`, `:?`, `?`, `:=` forms name the variable when it is set), a leading `~`, `$HOME` / `$USERPROFILE` (PowerShell's
// `$env:USERPROFILE`, cmd's `%USERPROFILE%` / `%HOMEDRIVE%%HOMEPATH%`), `$PWD` and `$(pwd)` - where the shell stands at
// that word, the cwd moved by every followed `cd` before it (a subshell's cd ends with it) - `$CLAUDE_PROJECT_DIR`, and
// `$(echo <words>)` as its words. A name the command assigned before the word, as a statement of its own, is its value,
// itself expanded at the assignment (`H=$HOME; rm -rf "$H"`); a prefix assignment (`H=/x rm $H`) is that command's
// environment and expands nothing in its own words. What cannot be known stays as written, for the caller to judge as
// unexpanded: an unset name, a loop / `read` / `+=` / arithmetic variable, a computed value, a `cd` past one. The word
// comes in dequoted, so a single-quoted `$` is expanded too - a guard reading it errs toward judging. Every shell guard
// expands through here (the rm, cross-project and secret guards each kept a partial copy: HOME but no PWD, `~` only).
// shellVars(P, opts): P is parseShell's result; `opts.cwd` the shell's start directory, `opts.home` (default the account
// home), `opts.project` ($CLAUDE_PROJECT_DIR), `opts.regions` ([{ from, to, cwd }], gitText's carried scripts, each
// starting from its own directory). Returns { expand(word, at), valueOf(name, at), pwdAt(at) }.
const VAR_BINDERS = [
  /\bfor\s+([A-Za-z_]\w*)\s+in\b/g, /\bselect\s+([A-Za-z_]\w*)\s+in\b/g, /\b([A-Za-z_]\w*)\+=/g, /\blet\s+([A-Za-z_]\w*)/g,
  /\(\(\s*([A-Za-z_]\w*)/g, /\bgetopts\s+\S+\s+([A-Za-z_]\w*)/g, /\bprintf\s+-v\s+([A-Za-z_]\w*)/g,
];
const READ_WORDS = /\b(?:read|mapfile|readarray)\b([^;&|\n]*)/g;
const VAR_DEPTH = 4;
const CD_RESOLVE_MAX = 64;
function shellVars(P, opts = {}) {
  const home = opts.home !== undefined ? opts.home : homeDir();
  const events = (P && P.assignEvents) || [];
  const bound = new Set();
  const text = String((P && P.command) || '');
  if (/[$%`~]/.test(text)) {
    for (const re of VAR_BINDERS) for (const m of text.matchAll(re)) bound.add(m[1]);
    for (const m of text.matchAll(READ_WORDS)) for (const w of m[1].split(/\s+/)) if (/^[A-Za-z_]\w*$/.test(w)) bound.add(w);
  }
  const regions = opts.regions && opts.regions.length ? opts.regions : [{ from: 0, to: Infinity, cwd: opts.cwd || null }];
  const regionOf = (at) => { let k = regions.length - 1; while (k > 0 && regions[k].from > at) k--; return k; };
  const anchors = new Map();
  const norm = (t) => nativePath(unquote(String(t)));
  // a region's cds, each variable target expanded where it stands (a cd past CD_RESOLVE_MAX of them stays as written)
  const anchorOf = (k) => {
    if (anchors.has(k)) return anchors.get(k);
    const r = regions[k];
    const own = ((P && P.cds) || []).filter((c) => c.index >= r.from && c.index < r.to);
    const resolved = [];
    let budget = CD_RESOLVE_MAX;
    for (const c of own) {
      const t = c[1];
      if (c.popd || t === undefined || !/[$`~%]/.test(String(t)) || budget-- <= 0) { resolved.push(c); continue; }
      const before = resolved.slice();
      const x = expandWith(String(t), c.index, 1, (q) => (r.cwd ? anchorer(before, r.cwd, norm)(q) : null));
      const copy = Object.assign([], c);
      copy[1] = x;
      resolved.push(copy);
    }
    const f = r.cwd ? anchorer(resolved, r.cwd, norm) : () => null;
    anchors.set(k, f);
    return f;
  };
  const pwdAt = (at) => anchorOf(regionOf(at))(at);
  // The statement assignments by name, each list in text order, built on the first lookup: a lookup is a binary search
  // for the newest one before the word, never a scan of every assignment - one scan per lookup and level made a 112KB
  // chain of `a=$b;b=$a` over 8,000 rm operands cost 10s (final review 2026-10-30, FB; 0.6s before the expander).
  let byName = null;
  const setBefore = (name, at) => {
    if (!byName) {
      byName = new Map();
      for (let i = 0, n = events.length; i < n; i++) {
        const e = events[i];
        if (e.kind !== 'set' || e.prefix) continue;
        const list = byName.get(e.name);
        if (list) list.push(e); else byName.set(e.name, [e]);
      }
      for (const list of byName.values()) for (let i = 1; i < list.length; i++) if (list[i].at < list[i - 1].at) { list.sort((x, y) => x.at - y.at); break; }
    }
    const list = byName.get(name);
    if (!list) return null;
    let lo = 0;
    let hi = list.length - 1;
    let hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].at < at) { hit = list[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return hit;
  };
  const valueWith = (name, at, depth, pwd) => {
    if (depth > VAR_DEPTH || bound.has(name)) return null;
    const ev = setBefore(name, at);
    if (ev) {
      const raw = String(ev.raw !== undefined ? ev.raw : ev.value);
      if (/^'[^']*'$/.test(raw)) return raw.slice(1, -1);
      const v = String(ev.value);
      const x = /[$`~%]/.test(v) ? expandWith(v, ev.at, depth + 1, pwd) : v;
      return /[$`]/.test(x) ? null : x;
    }
    const up = name.toUpperCase();
    if (name === 'HOME' || up === 'USERPROFILE') return home || null;
    if (name === 'PWD') return pwd(at);
    if (name === 'CLAUDE_PROJECT_DIR') return opts.project || null;
    return null;
  };
  // linear: one greedy class per alternative, trimmed in code (no lazy run beside an overlapping `\s*`)
  const SUBST = /\$\(([^()`$]*)\)|`([^`()$]*)`/g;
  const ECHO_SUBST = /\$\(\s*echo\s([^()`;&|<>]*)\)|`\s*echo\s([^`();&|<>]*)`/g;
  function expandWith(word, at, depth, pwd) {
    let s = String(word);
    if (!/[$`~%]/.test(s)) return s;
    // `$(echo <words>)`: its words, each expanded as a word of its own
    s = s.replace(ECHO_SUBST, (m, a, b) => {
      const words = String(a !== undefined ? a : b).match(/"[^"]*"|'[^']*'|\S+/g) || [];
      const out = words.map((w) => expandWith(dequote(w), at, depth + 1, pwd));
      return out.some((w) => /[$`]/.test(w)) ? m : out.join(' ');
    });
    s = s.replace(SUBST, (m, a, b) => {
      const body = String(a !== undefined ? a : b).trim();
      if (/^pwd(?:\s+-[LP])?$/.test(body)) { const d = pwd(at); return d === null ? m : d; }
      return m;
    });
    if (s[0] === '~' && (s.length === 1 || s[1] === '/' || s[1] === '\\')) {
      const h = valueWith('HOME', at, depth, pwd);
      if (h) s = h + s.slice(1);
    }
    s = s.replace(/\$\{([A-Za-z_]\w*)(?:(:?[-?=])[^}]*)?\}|\$([A-Za-z_]\w*)/g, (m, br, op, bare) => {
      const v = valueWith(br || bare, at, depth, pwd);
      return v === null ? m : v;
    });
    s = s.replace(/\$\{?env:([A-Za-z_]\w*)\}?/gi, (m, name) => {
      const v = /^(?:userprofile|home)$/i.test(name) ? valueWith(name.toUpperCase() === 'HOME' ? 'HOME' : 'USERPROFILE', at, depth, pwd) : null;
      return v === null ? m : v;
    });
    s = s.replace(/%HOMEDRIVE%%HOMEPATH%|%(USERPROFILE|HOMEPATH)%/gi, () => valueWith('USERPROFILE', at, depth, pwd) || '%USERPROFILE%');
    return s;
  }
  // The newest statement assignment of `name` before `at` when it is a LITERAL - a single-quoted value as written, any
  // other with no `$` or backtick left once dequoted - else null: a substitution, an expansion, a loop or `read` name, a
  // prefix assignment and an unset name stay unknowable (final review 2026-10-30, FC: the runtime `-e` rule, on this index).
  const literalOf = (name, at) => {
    if (bound.has(name)) return null;
    const ev = setBefore(name, at);
    if (!ev) return null;
    const raw = String(ev.raw !== undefined ? ev.raw : ev.value);
    if (/^'[^']*'$/.test(raw)) return raw.slice(1, -1);
    const v = String(ev.value);
    return /[$`]/.test(v) ? null : v;
  };
  return {
    expand: (word, at) => expandWith(word, at, 0, pwdAt),
    valueOf: (name, at) => valueWith(name, at, 0, pwdAt),
    literalOf,
    // the newest statement assignment of `name` before `at`: { bound: true } for a loop, `read` or similar name, null when none
    eventOf: (name, at) => (bound.has(name) ? { bound: true } : setBefore(name, at) || null),
    pwdAt,
  };
}

// ---- the whole-file print verbs: the ONE table (audit 2026-10-30 a0; HK-06, HK-19) --------------------------------
// The commands that print a file's whole content under another name than `cat` - each was found printing a credential
// file raw past the secret guard (`shuf .env`, `vis .env`, `join -t= -v1 .env /dev/null`, `gzip -c .env | gunzip`) or a
// 700-line source past the read guard (`shuf big.ts`). Per verb: `values` - the one-letter flags that take a value (its
// operand is no file), `long` the long ones, `needs` - flags without which it prints nothing (a compressor writes a
// file unless told `-c`), `none` - flags with which it reads no file (`shuf -e` echoes its words), `bounded` - flags that
// cap what it prints, `digits` - `-1` / `-2` are flags (join's fields), never operands, `levels` - a digit is a flag in
// any cluster (a compressor's `-9c`). printedFiles(verb, argv) names
// the files a call prints and whether it is bounded; null when the verb prints none. Both guards read this table.
const LONG_VALUES = /^--(?:tabs|width|lines|key|output|separator|suffix|field-separator|head-count|input-range|random-source|read-bytes|bytes|skip-bytes|format|address-radix)$/;
// `levels`: a digit is a flag (a compression level), alone or in a cluster - `-9`, `-9c`, `-19` (final review 2026-10-30,
// FB: `gzip -9c <file>` read `-9c` as the file, and the secret guard kept a local workaround)
const COMPRESSOR = { values: 'S', needs: ['-c', '--stdout', '--to-stdout'], levels: true };
const PRINT_VERBS = Object.freeze(Object.fromEntries(Object.entries({
  cat: { values: '' }, tac: { values: 's' }, nl: { values: 'bdfhilnsvw' }, rev: { values: '' }, fmt: { values: 'wgpdlt' },
  expand: { values: 't' }, unexpand: { values: 't' }, fold: { values: 'w' }, pr: { values: 'hlowWsSNe' },
  od: { values: 'tjNAw', bounded: ['-N', '--read-bytes'] }, xxd: { values: 'lscgo', bounded: ['-l'] },
  hexdump: { values: 'efns', bounded: ['-n'] }, base64: { values: 'w' }, strings: { values: 'not' }, paste: { values: 'd' },
  column: { values: 'scNR' }, sort: { values: 'ktoST' }, uniq: { values: 'fsw' },
  zcat: { values: 'S' }, gzcat: { values: 'S' }, zmore: { values: '' }, zless: { values: '' }, bzcat: { values: '' },
  xzcat: { values: '' }, zstdcat: { values: '' }, lz4cat: { values: '' },
  shuf: { values: 'nio', bounded: ['-n', '--head-count'], none: ['-e', '--echo', '-i', '--input-range'] },
  vis: { values: 'Fe' },
  join: { values: 'aejot12v', digits: true },
  gzip: COMPRESSOR, gunzip: COMPRESSOR, bzip2: COMPRESSOR, bunzip2: COMPRESSOR, xz: COMPRESSOR, unxz: COMPRESSOR,
  lzma: COMPRESSOR, unlzma: COMPRESSOR, zstd: COMPRESSOR, unzstd: COMPRESSOR, lz4: COMPRESSOR, brotli: COMPRESSOR,
}).map(([k, v]) => [k, Object.freeze({ ...v })])));
function printedFiles(verb, argv) {
  const spec = Object.prototype.hasOwnProperty.call(PRINT_VERBS, verb) ? PRINT_VERBS[verb] : null;
  if (!spec) return null;
  const ops = [];
  const flags = new Set();
  const words = (argv || []).map(String);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') { ops.push(...words.slice(i + 1)); break; }
    if (w === '-' || !w.startsWith('-') || (/^-\d/.test(w) && !spec.digits && !spec.levels)) { ops.push(w); continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const n = eq < 0 ? w : w.slice(0, eq);
      flags.add(n);
      if (eq < 0 && LONG_VALUES.test(n)) i++;
      continue;
    }
    for (let j = 1; j < w.length; j++) {
      flags.add(`-${w[j]}`);
      if (spec.values.includes(w[j])) { if (j + 1 === w.length) i++; break; }
    }
  }
  if (spec.needs && !spec.needs.some((f) => flags.has(f))) return null;
  if (spec.none && spec.none.some((f) => flags.has(f))) return null;
  return { files: ops.filter((o) => o && o !== '-'), bounded: !!(spec.bounded && spec.bounded.some((f) => flags.has(f))) };
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
    const env = Object.assign({}, process.env, Object.fromEntries(lookup), { GIT_OPTIONAL_LOCKS: '0' });
    const cwd = dir && exists(run, dir) ? dir : undefined;
    const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args, 'config', '-z', '--get-regexp', '^alias\\.'], { cwd, env, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 });
    if (r.error || (r.status !== 0 && r.status !== 1)) res = { error: 'a lookup git could not answer' };
    else {
      const map = new Map();
      for (const rec of String(r.stdout || '').split('\0')) {
        if (!rec.startsWith('alias.')) continue;
        const nl = rec.indexOf('\n');
        map.set((nl < 0 ? rec.slice(6) : rec.slice(6, nl)).toLowerCase(), nl < 0 ? '' : rec.slice(nl + 1));
      }
      res = { map, run: (argv) => spawnSync('git', ['-c', 'core.fsmonitor=false', ...args, ...argv], { cwd, env, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
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
// A text that names git as a word - a command or a path ending in one - once its substitutions, quotes and backslashes
// are taken out: a read-only `$(git rev-parse ...)` in it, a `github` or a `.git` folder is no git word (the thirteenth
// review: `"$HOME/github/x.sh"` and `ROOT=$(git rev-parse --show-toplevel); "$ROOT/t.sh"` were asked on).
const GIT_WORDS = new Map();
let gitWordsHeld = 0;
const GIT_VALUE = /^\s*(?:\S*[\\/])?git(?:\.exe)?\s+(?:-C\s+\S+\s+)?(?:rev-parse|symbolic-ref|merge-base|ls-files|branch\s+--show-current)\b/i;
function gitWord(text) {
  const key = String(text);
  if (GIT_WORDS.has(key)) return GIT_WORDS.get(key);
  // a parameter's operator (`${x:-`, `${y:=`) is no part of the word after it (review 14, 1: `${x:-${y:-git}} reset`)
  // ... and the name before it stays (review 15, 2: `${GIT:-true}`), the subscript bounded (review 15, 4: an unclosed
  // `${a[` rescanned the rest of the text)
  let t = key.replace(/\$\{([A-Za-z_]\w*)(?:\[[^\]\n]{0,64}\])?:?[-=+?]/g, ' $1 ');
  // a substitution that asks git for a path or a ref alone (`$(git rev-parse --show-toplevel)`) prints a value, never
  // git's name; any other keeps its words, so `$(command -v git)`, `$(which git)`, `$(echo git)` (review 14, 1) and
  // `$(git --version | cut -d' ' -f1)` (review 15) name git
  // - judged one pipeline segment at a time, its redirections to /dev/null or a descriptor dropped, so a fallback or a
  // filter beside it (`|| pwd`, `| tr -d '\r'`) keeps its own words and drops none of git's (review 16, 1)
  const inner = (m, a, b) => {
    const body = (a !== undefined ? a : b).replace(/\d*>&\d+|\d*>>?[ \t]*\/dev\/null/g, ' ');
    return ` ${body.split(/\|\|?|&&?|;|\n/).map((sg) => (GIT_VALUE.test(sg) && !/--(?:sq-quote|parseopt|format|pretty)|\sgit\b/i.test(sg.replace(GIT_VALUE, '')) ? ' ' : sg)).join(' ')} `;
  };
  for (let n = 0; n < 8 && /\$\(|`/.test(t); n++) t = t.replace(/\$\(([^()]*)\)|`([^`]*)`/g, inner);
  t = t.replace(/[\\'"]/g, '');
  // a git program by its path (`$(git --exec-path)/git-push`) too
  const v = /(?:^|[^\w.-])git(?:$|[^\w.-])/i.test(t) || /(?:^|[\/\s])git-[a-z]/i.test(t);
  if (gitWordsHeld + key.length > 4194304) { GIT_WORDS.clear(); gitWordsHeld = 0; } // a cache of at most 4 MB of keys
  GIT_WORDS.set(key, v);
  gitWordsHeld += key.length;
  return v;
}
const namesGit = (file) => {
  try { return fs.statSync(file).size > 64 * 1024 * 1024 || NAMES_GIT.test(fs.readFileSync(file, 'latin1')); } catch { return true; }
};
// A reader that throws fails CLOSED: the whole command is unread, which every gate judges as the act it guards (review 14,
// 2: a stack overflow failed the force-push, rm, commit and cross-project guards open).
function gitText(raw, cwd) {
  try { return gitTextIn(raw, cwd); }
  catch (e) { return failedRead(raw, cwd, e); }
}
// The read a failure leaves: every word unread, `failed` naming the error - the force-push guard, which leaves unread text
// alone by design, blocks on it when the text names a push (review 15, 7)
function failedRead(raw, cwd, e) {
  bashReading = false;
  readingsDiffer = false;
  let command = '';
  try { command = String(raw || ''); } catch { /* an unprintable value */ }
  return { command, parsed: parseShell(''), calls: [], regions: [], unreadAt: 0, callDir: () => cwd || null, literalAt: () => null, vars: null, orderOf: () => 0, failed: String((e && e.message) || e) };
}
function gitTextIn(raw, cwd) {
  const run = newRun();
  const aliased = expandGitAliases(String(raw || ''), { cwd, run });
  let unreadAt = aliased.unreadAt;
  const markUnread = (at) => { if (unreadAt < 0 || at < unreadAt) unreadAt = at; };
  // Where each piece of the final text runs from: the command from the shell's cwd, each carried script from the
  // directory it runs in - a cd inside one moves what follows it there. `base` is where `text` starts in the final text.
  // `trail` is where each carrying word sits in the text around it, outermost first: a carried script is appended AFTER
  // the command, so its calls run where its carrier stands, never at their place in the joined text (`orderOf`).
  const regions = [];
  function withCarried(text, dir0, base, depth, trail = []) {
    regions.push({ from: base, to: base + text.length, cwd: dir0, trail });
    const u0 = run.unread.length;
    const scripts = carriedScripts(text, { cwd: dir0, files: true, run });
    for (const u of run.unread.slice(u0)) if (u.force || (u.path ? namesGit(u.path) : NAMES_GIT.test(text.slice(u.at)))) markUnread(base + u.at);
    // what the text leaves open is shut first - in a carried script always, since another may be joined after it
    let out = scripts.length || depth > 0 ? text + lexShell(text).close : text;
    for (const sc of scripts) {
      if (run.budget.deep(depth) || run.budget.over()) { if (NAMES_GIT.test(sc.text)) markUnread(base + sc.at); continue; }
      const dir = sc.cwd || dir0;
      const inner = expandGitAliases(sc.text, { cwd: dir, run });
      const at = base + out.length + 1;
      if (inner.unreadAt >= 0) markUnread(at + inner.unreadAt);
      out += `\n${withCarried(inner.text, dir, at, depth + 1, trail.concat(base + sc.at))}`;
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
  // A `cd "$WT"` whose variable the same command assigned a LITERAL before it is followed (audit 2026-10-11 SD16, session
  // 2ca8e8ee: `WT=<scratch>; git worktree add --detach "$WT" ... && cd "$WT" && git commit` was judged in the project's
  // tree, whose 39-file diff demanded a receipt). The newest literal set before the cd wins; anything else stays unread.
  const events = (parsed && parsed.assignEvents) || [];
  const literalAt = (name, at) => {
    let v = null;
    for (const e of events) if (e.kind === 'set' && e.name === name && e.at < at) v = /[$`]/.test(String(e.value)) ? null : e.value;
    return v;
  };
  const resolveCd = (c) => {
    const t = unquote(String(c[1] || ''));
    if (!/\$/.test(t)) return c;
    const out = t.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, br, bare) => { const v = literalAt(br || bare, c.index); return v === null ? m : v; });
    if (out === t) return c;
    const copy = Object.assign([], c);
    copy[1] = out;
    return copy;
  };
  const regionAt = (at) => {
    let k = regions.length - 1;
    while (k > 0 && regions[k].from > at) k--;
    return k;
  };
  // Run order of two positions in the joined text: < 0 when `a` runs first. A call in a carried script runs where its
  // carrier stands (`bash -c 'git switch main' && git push -f` switches before the push), then in its own script's order.
  function orderOf(a, b) {
    const ka = regions[regionAt(a)].trail.concat(a);
    const kb = regions[regionAt(b)].trail.concat(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return ka.length - kb.length;
  }
  function callDir(call) {
    const k = regionAt(call.at);
    const r = regions[k];
    if (!regionCds.has(k)) regionCds.set(k, (parsed ? parsed.cds : []).filter((c) => c.index >= r.from && c.index < r.to).map(resolveCd));
    let dir = anchorAt(regionCds.get(k), call.at, r.cwd, cdTarget) || r.cwd;
    for (const d of call.dirs) if (!isVar(d)) dir = path.resolve(dir, nativePath(d));
    try { dir = fs.realpathSync.native(dir); } catch { /* git reports the missing directory itself */ }
    return dir;
  }
  // the one expander, each carried script starting from its own directory (audit 2026-10-30 a0)
  let vars = null;
  try { vars = parsed && !parsed.tooDeep ? shellVars(parsed, { cwd, regions }) : null; } catch { vars = null; }
  return { command, parsed, calls, regions, unreadAt, callDir, literalAt, vars, orderOf };
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
  if (opts.depth) return scanShellIn(rawCommand, opts);
  try { return scanShellIn(rawCommand, opts); }
  catch (e) {
    bashReading = false;
    readingsDiffer = false;
    let command = '';
    try { command = String(rawCommand || ''); } catch { /* an unprintable value */ }
    const unread = opts.run ? opts.run.unread : [];
    unread.push({ at: 0, why: `the reader failed on this command (${(e && e.name) || 'error'})`, path: opts.path || null });
    return { command, quoted: [], inQuotes: () => false, expandVars: (t) => t, cds: [], targets: [], gitWrites: [], aliasUnreadAt: -1, unread };
  }
}
function scanShellIn(rawCommand, opts = {}) {
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
  // A target word as the shell expands it where it stands (`at`, its index; none reads the command's end): the one
  // expander first - `$HOME` / `${HOME}` / `~` / `$USERPROFILE` / `$env:USERPROFILE`, `$PWD` after a followed cd,
  // `$CLAUDE_PROJECT_DIR`, a name the command assigned, `$(echo ...)` (audit 2026-10-30 HK-13: every `$HOME` spelling was
  // an unexpanded variable to the cross-project guard) - then any literal the command assigned the name, as before.
  let vars;
  const expandVars = (t, at) => {
    let s = String(t);
    if (/[$`~%]/.test(s)) {
      if (vars === undefined) {
        try {
          vars = shellVars(P, { cwd: opts.cwd || null, home: opts.home, project: opts.project !== undefined ? opts.project : (process.env.CLAUDE_PROJECT_DIR || null) });
        } catch { vars = null; }
      }
      if (vars) s = vars.expand(s, at === undefined ? Infinity : at);
    }
    return s.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, br, bare) => (assigns.has(br || bare) ? assigns.get(br || bare) : m));
  };
  const targets = [];
  const gitWrites = [];
  for (let k = 0; k < P.cmds.length; k++) {
    const cmd = P.cmds[k];
    if (lateHere(run, k, cmd, opts.path)) break;
    for (const r of cmd.redirs) {
      if (isFileRedir(r)) targets.push({ raw: dequote(r.target.raw), index: r.at, what: 'a shell redirection', verb: '>' });
    }
    for (const c of cmd.cands) {
      writesOf(cmd, c, targets, opts);
      if (c.name === 'git') {
        // a bare `git <mutating>` after a `cd` out of tree writes THAT checkout - the same event as `git -C <dir>`
        const call = gitCallOf(cmd, c);
        if (!call.dirs.length && call.sub && gitMutates(call.sub, call.argv)) gitWrites.push(call.at);
      }
    }
  }
  targets.push(...interpreterTargets(raw, P, heredocs));
  // the PowerShell tool's own command calling .NET's file API (a quoted one is text, or a runtime's script read above)
  if (/IO\.(?:File|Directory)\]::/i.test(command)) {
    for (const m of command.matchAll(PS_FILE_CALL)) {
      if (P.inQuotes(m.index)) continue;
      for (const p of psFilePaths(m)) targets.push({ raw: p, index: m.index, what: 'a .NET file write', verb: /^delete$/i.test(m[1]) ? 'rm' : 'interpreter' });
    }
  }
  const files = opts.files !== undefined ? !!opts.files : !!opts.cwd;
  const depth = opts.depth || 0;
  const carried = carriedBoth(P, raw, heredocs, { cwd: opts.cwd || null, files }, run);
  const cds = carried.length ? P.cds.slice() : P.cds;
  if (carried.length && run.budget.deep(depth)) {
    for (const sc of carried) run.unread.push({ at: sc.at, why: `a script nested ${depth + 1} deep`, path: null });
  } else {
    const closesOf = new Map(P.cmds.map((c) => [c.words.length ? c.words[0].s : -1, c.end]));
    for (const sc of carried) {
      if (run.budget.over()) { run.unread.push({ at: sc.at, why: run.budget.why, path: null }); continue; }
      const u0 = run.unread.length;
      const inner = scanShell(sc.text, { cwd: sc.cwd || null, files, aliases: opts.aliases, landing: opts.landing, depth: depth + 1, run, path: sc.path || null });
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

module.exports = { failedRead, scanShell, carriedScripts, expandGitAliases, gitCalls, commandWords, parseShell, newRun, anchorAt, anchorer, blankHeredocs, heredocsOf, heredocBody, heredocVerbatim, heredocSubstitutions, commandIndex, groupsAsCuts, gitText, WRAPPERS, RUN_TOOLS,
  blankComments, joinContinuations, quotedSpans, shellWords, dequote, unquote, isVar, gitMutates, SHELL_TOOLS, isShellTool, MOUNT_RE, nativePath, homeDir, UNKNOWN_WRITE,
  resolveOn, shellVars, PRINT_VERBS, printedFiles, sensitiveRuns, RUNNER_FILE, runtimeScripts, codeStrings, copyPlan, psCopyPlan, PS_COPY, tarPlan, unzipPlan, COPY_VERBS };
