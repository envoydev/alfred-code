'use strict';
// shell-writes.js is the parser every shell guard reads a command through - the cross-project guard, the commit guard,
// the done gate. It reads script files from disk and expands git aliases, so the text it parses is as large as a
// script a repo carries. 2.1.6 re-verify 3 (review-216-hooks.md): R3-M3 - the parsers grew quadratically on shapes real
// scripts carry (a comment block, `$((y<<shift))`, an unterminated heredoc opener, nested `cd`, a run of redirects);
// R3-M4 - the git option regexes backtracked exponentially (36 x ' -c' took 67s); R3-m5 - one git spawn per alias
// call, uncached. Every worst-case shape the review measured is read whole or left unread by a WORK cap - the
// scan budget (hook-prelude.js, the one home) counts characters and depth, never time - and what is unread is judged
// conservatively, never let through.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const shell = require(path.join(HOOKS, 'shell-writes.js'));
const prelude = require(path.join(HOOKS, 'hook-prelude.js'));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shell-writes-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const G = 'g' + 'it'; // the running session's own commit guard reads this file's text too
// The verdicts below are counts of WORK - what was read and what was left unread - the same on every machine. Time is
// only a sanity bound, ten times the 200ms the review asked for, measured as this process's CPU time (the least of
// three warm runs): a quadratic parser takes seconds to minutes on these shapes, a linear one a few hundred ms even at
// a load average of 130.
const SANITY_MS = 2000;
const cpuMs = (f) => {
  let r = f();
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const c0 = process.cpuUsage();
    r = f();
    const c = process.cpuUsage(c0);
    best = Math.min(best, (c.user + c.system) / 1000);
  }
  return { r, ms: best };
};
const repo = (aliases = {}) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'repo-'));
  spawnSync(G, ['init', '-q', dir], { encoding: 'utf8' });
  for (const [k, v] of Object.entries(aliases)) spawnSync(G, ['-C', dir, 'config', `alias.${k}`, v], { encoding: 'utf8' });
  return dir;
};
// A script of `size` bytes built from `lines` taken in turn.
const script = (lines, size) => {
  const out = [];
  let n = 0;
  for (let i = 0; n < size; i++) {
    const l = `${lines[i % lines.length].replace(/N/g, String(i))}\n`;
    out.push(l);
    n += l.length;
  }
  return out.join('');
};
const scriptIn = (name, text) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'scripts-'));
  fs.writeFileSync(path.join(dir, name), text);
  return dir;
};

test('R3-M3: every worst-case script shape the review measured is read whole, or unread by a work cap - never slow', () => {
  const shapes = {
    // the five line kinds of the review's table, a comment with an apostrophe among them - 0.5MB timed out through the hook
    'comment-heavy, 1MB': [script(["# the model's note N", 'echo x >> log', 'cd pkgN && npm run build', 'cd ..', 'cp a bN'], 1024 * 1024), null],
    // `<<shift` inside arithmetic read as a heredoc opener - 0.5MB timed out
    'arithmetic shifts, 0.99MB': [script(['x=$((y<<shift))'], 0.99 * 1024 * 1024), null],
    // a heredoc opener with no terminator rescanned to the end - 0.99MB timed out
    'unterminated heredoc openers, 0.99MB': [script(['cat <<EOF'], 0.99 * 1024 * 1024), null],
    // nested cds resolved per write - 0.99MB timed out; past 4096 characters a directory is no place a write can land
    'nested cd, 0.99MB': [script(['cd sub && touch f'], 0.99 * 1024 * 1024), /a directory past 4096 characters/],
  };
  const wrong = [];
  for (const [name, [text, unread]] of Object.entries(shapes)) {
    const dir = scriptIn('big.sh', text);
    const { r, ms: took } = cpuMs(() => shell.scanShell('bash big.sh', { cwd: dir, aliases: true }));
    const why = r.unread.map((u) => u.why).join('; ');
    if (unread ? !unread.test(why) : why) wrong.push(`${name}: unread '${why}'`);
    if (took >= SANITY_MS) wrong.push(`${name}: ${took.toFixed(0)}ms`);
  }
  assert.deepStrictEqual(wrong, []);
});

test('R3-M3: every worst-case command shape the review measured is read whole, or unread by a work cap - never slow', () => {
  const shapes = {
    'a run of redirects on one line, 64KB': `echo x${' > f'.repeat(64 * 1024 / 4)}`,
    'comment lines in a command, 112KB': script(["# the model's note N", 'echo N'], 112 * 1024),
    'unterminated heredoc openers in a command, 156KB': script(['cat <<EOF'], 156 * 1024),
    'nested cd in a command, 64KB': script(['cd sub && touch f'], 64 * 1024),
  };
  const wrong = [];
  for (const [name, text] of Object.entries(shapes)) {
    const { r, ms: took } = cpuMs(() => shell.scanShell(text, { cwd: TMP, aliases: true }));
    const why = r.unread.map((u) => u.why).join('; ');
    if (/nested cd/.test(name) ? !/a directory past 4096 characters/.test(why) : why) wrong.push(`${name}: unread '${why}'`);
    if (took >= SANITY_MS) wrong.push(`${name}: ${took.toFixed(0)}ms`);
  }
  assert.deepStrictEqual(wrong, []);
});

test('R3-M4: a run of git options is walked, not matched - the push after 40 x -c and 40 x --git-dir is a git call', () => {
  const dir = repo();
  const wrong = [];
  for (const opt of [' -c', ' --git-dir']) {
    const text = `${G}${opt.repeat(40)}; ${G} pu${'sh'}`;
    const { r, ms: took } = cpuMs(() => shell.expandGitAliases(text, { cwd: dir }));
    if (took >= SANITY_MS) wrong.push(`${opt}: ${took.toFixed(0)}ms`);
    if (!shell.gitCalls(r.text).some((c) => c.sub === 'push')) wrong.push(`${opt.trim()} x 40: no push call`);
  }
  assert.deepStrictEqual(wrong, []);
});

test('R3-m5: alias lookups are one table per place git runs, and a fan-out past the expansion cap is unread', () => {
  const dir = repo({ st: 'status', l1: `!${G} l2; ${G} l2; ${G} l2; ${G} l2; ${G} l2; ${G} l2; ${G} l2; ${G} l2`,
    l2: `!${G} l3; ${G} l3; ${G} l3; ${G} l3; ${G} l3; ${G} l3; ${G} l3; ${G} l3`, l3: `!${G} l4; ${G} l4; ${G} l4; ${G} l4; ${G} l4; ${G} l4; ${G} l4; ${G} l4`,
    l4: `!${G} l5; ${G} l5; ${G} l5; ${G} l5; ${G} l5; ${G} l5; ${G} l5; ${G} l5`, l5: `!${G} l6; ${G} l6; ${G} l6; ${G} l6; ${G} l6; ${G} l6; ${G} l6; ${G} l6`,
    l6: 'status' });
  const wrong = [];
  const run = shell.newRun();
  const st = shell.expandGitAliases(`${G} st; `.repeat(800), { cwd: dir, run });
  assert.strictEqual(st.unreadAt, -1, 'a plain alias read 800 times is read');
  if (run.spawns !== 1) wrong.push(`st x 800: ${run.spawns} git spawns, not 1`);
  const zz = cpuMs(() => shell.expandGitAliases(`${G} zz; `.repeat(800), { cwd: dir }));
  if (zz.ms >= SANITY_MS) wrong.push(`zz x 800: ${zz.ms.toFixed(0)}ms`);
  const fan = shell.expandGitAliases(`${G} l1`, { cwd: dir });
  assert.ok(fan.unreadAt >= 0, 'a fan-out past the expansion cap is unread - the caller judges it conservatively');
  assert.deepStrictEqual(wrong, []);
});

test('the scan budget lives in hook-prelude.js: characters scanned and depth, never time, and past either the rest is unread', () => {
  assert.strictEqual(typeof prelude.scanBudget, 'function');
  assert.deepStrictEqual(Object.keys(prelude.SCAN_LIMITS).sort(), ['bytes', 'depth', 'gitJudged'], 'no time limit - a verdict never depends on the load');
  const b = prelude.scanBudget({ bytes: 10, depth: 3 });
  assert.strictEqual(b.take(10), true, 'at the byte limit');
  assert.strictEqual(b.take(1), false, 'one byte past it');
  assert.strictEqual(b.over(), true);
  assert.match(b.why, /10-byte scan budget/);
  assert.strictEqual(b.deep(2), false);
  assert.strictEqual(b.deep(3), true);
  // a script past the byte budget is not read and is named unread, with its path
  const dir = scriptIn('big.sh', script(['echo N'], prelude.SCAN_LIMITS.bytes + 1024));
  const r = shell.scanShell('bash big.sh', { cwd: dir });
  assert.ok(r.unread.some((u) => u.path === path.join(dir, 'big.sh')), 'the script past the budget is unread');
});

test('the parsers are linear: no nested quantifier left in a regex shell-writes.js owns', () => {
  // star height over each regex LITERAL: a quantified group holding an unbounded quantifier is the shape that
  // backtracks (GIT_OPTS, CMD_POS). The literals come from a small tokenizer that skips comments and strings, so a slash
  // in prose or in '/' is never read as one; character classes and escapes are skipped inside each.
  const src = fs.readFileSync(path.join(HOOKS, 'shell-writes.js'), 'utf8');
  const literals = regexLiterals(src);
  assert.ok(literals.length > 40, `the tokenizer found the file's regexes (${literals.length})`);
  const nested = literals.filter((re) => starHeight(re) > 1).map((re) => re.slice(0, 80));
  assert.deepStrictEqual(nested, []);
});
function regexLiterals(src) {
  const out = [];
  let prev = ''; // the last significant character outside strings and comments
  let word = ''; // the last identifier, for `return /x/`
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      prev = 'a'; word = '';
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /^(?:return|typeof|case|of|in)$/.test(word))) {
      let j = i + 1;
      let inClass = false;
      for (; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; else if (src[j] === '/' && !inClass) break;
      }
      out.push(src.slice(i + 1, j));
      i = j;
      prev = 'a'; word = '';
      continue;
    }
    if (/\s/.test(c)) continue;
    if (/[\w$]/.test(c)) { word = /[\w$]/.test(prev) ? word + c : c; } else word = '';
    prev = c;
  }
  return out;
}
function starHeight(re) {
  const stack = [{ inner: 0 }];
  let height = 0;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { while (i < re.length && re[i] !== ']') { if (re[i] === '\\') i++; i++; } continue; }
    if (c === '(') { stack.push({ inner: 0 }); continue; }
    if (c === ')') {
      if (stack.length < 2) return Infinity; // unbalanced: not a regex this check can read - named, never skipped
      const g = stack.pop();
      const q = re[i + 1];
      const unbounded = q === '*' || q === '+' || (q === '{' && /^\{\d+,\}/.test(re.slice(i + 1)));
      const h = g.inner + (unbounded ? 1 : 0);
      stack[stack.length - 1].inner = Math.max(stack[stack.length - 1].inner, h);
      height = Math.max(height, h);
      continue;
    }
    if ((c === '*' || c === '+') && re[i - 1] !== ')') stack[stack.length - 1].inner = Math.max(stack[stack.length - 1].inner, 1);
  }
  return Math.max(height, stack[0].inner);
}

// 2.1.6 re-verify 4 R4-m2: a script was charged to the scan budget by readScript (its size) and again by scanShell (its
// text), so one of about 4MB was over the 8MB cap - a 5MB installer and a 7MB text script were unread, and the cross guard
// asked. A self-extracting installer (a shell head, then a binary payload) is read only up to its first NUL byte and
// charged for what was read. Every byte is charged once, where it comes from.
test('R4-m2: a script is charged to the scan budget once', () => {
  const size = 2 * 1024 * 1024;
  const dir = scriptIn('two.sh', script(['echo N'], size));
  const run = shell.newRun();
  const r = shell.scanShell('bash two.sh', { cwd: dir, run });
  assert.deepStrictEqual(r.unread, []);
  assert.ok(run.budget.bytes < size * 1.05, `${run.budget.bytes} bytes charged for a ${size}-byte script`);
});
test('R4-m2: a 5MB script and a 7MB script are read, not unread', () => {
  const wrong = [];
  for (const mb of [5, 7]) {
    const dir = scriptIn('big.sh', script(['echo N'], mb * 1024 * 1024));
    const r = shell.scanShell('bash big.sh', { cwd: dir });
    if (r.unread.length) wrong.push(`${mb}MB: unread '${r.unread[0].why}'`);
  }
  assert.deepStrictEqual(wrong, []);
});
test('R4-m2: a self-extracting installer is read up to its first NUL byte and charged for that', () => {
  const head = `#!/bin/sh\ntouch ${path.join(TMP, 'elsewhere.txt')}\nexit 0\n`;
  const payload = Buffer.alloc(6 * 1024 * 1024, 1);
  payload[0] = 0;
  const dir = fs.mkdtempSync(path.join(TMP, 'installer-'));
  fs.writeFileSync(path.join(dir, 'setup.run'), Buffer.concat([Buffer.from(head), payload]));
  const run = shell.newRun();
  const r = shell.scanShell('sh setup.run', { cwd: dir, run });
  assert.deepStrictEqual(r.unread, [], 'the payload is no script text and costs no budget');
  assert.ok(run.budget.bytes < 64 * 1024, `${run.budget.bytes} bytes charged for a ${head.length}-byte head`);
  assert.ok(r.targets.some((t) => /elsewhere\.txt$/.test(t.raw)), 'the head is read: its write is seen');
});

// Seam delta 1: a subshell or group's parens are cuts, a substitution's, an array's, an escape's and a quote's are text.
test('groupsAsCuts reads a group\'s parens as cuts and leaves a substitution, an array, an escape and a quote alone', () => {
  const g = shell.groupsAsCuts;
  assert.strictEqual(g('(cd d && rm -rf x)'), ';cd d && rm -rf x;');
  assert.strictEqual(g('((a))'), ';;a;;');
  assert.strictEqual(g('echo $(pwd) && (ls)'), 'echo $(pwd) && ;ls;');
  assert.strictEqual(g('a=(1 2); diff <(ls) >(cat)'), 'a=(1 2); diff <(ls) >(cat)');
  assert.strictEqual(g('find . \\( -name a \\)'), 'find . \\( -name a \\)');
  assert.strictEqual(g('echo "(x)" \'(y)\''), 'echo "(x)" \'(y)\'');
  assert.strictEqual(g('case a in a) echo hi;; esac'), 'case a in a; echo hi;; esac');
  assert.strictEqual(g('ls'), 'ls', 'no paren, the same string');
  for (const n of [10, 1000]) assert.strictEqual(g('('.repeat(n) + 'x' + ')'.repeat(n)).length, 2 * n + 1, 'width kept');
});
test('commandIndex walks past a body keyword, a group opener, ! and setsid', () => {
  const at = (line) => { const w = line.split(' '); return w[shell.commandIndex(w)]; };
  assert.strictEqual(at('! rm -rf x'), 'rm');
  assert.strictEqual(at('{ rm -rf x'), 'rm');
  assert.strictEqual(at('( rm -rf x'), 'rm');
  assert.strictEqual(at('if rm -rf x'), 'rm');
  assert.strictEqual(at('time rm -rf x'), 'rm');
  assert.strictEqual(at('setsid -f rm -rf x'), 'rm');
  assert.strictEqual(at('setsid bash -c x'), 'bash');
  assert.strictEqual(at('echo rm'), 'echo');
});

test('dequote: a bare Windows path on win32 keeps its backslashes - bash escapes everywhere else (2.1.7, the windows-2025 job)', () => {
  // Read as bash, `C:\Users\x\f.txt` was `C:Usersxf.txt`: a relative name, so on Windows every guard took an out-of-project
  // write, a -C into a sibling repo and a credential read for this project's own file.
  for (const w of ['C:\\Users\\RUNNER~1\\Temp\\other\\f.txt', 'c:\\x', '\\\\server\\share\\f.txt', 'if=C:\\Users\\x\\.aws\\credentials', '--file=D:\\out\\a.txt'])
    assert.strictEqual(shell.dequote(w, 'win32'), w, w);
  assert.strictEqual(shell.dequote('C:\\Users\\x\\f.txt', 'linux'), 'C:Usersxf.txt', 'off Windows the word is bash\'s');
  assert.strictEqual(shell.dequote('"C:\\Users\\x"', 'win32'), 'C:\\Users\\x', 'a quoted path dequotes as before');
  assert.strictEqual(shell.dequote('C:\\a\\$HOME', 'win32'), 'C:a$HOME', 'an expansion inside keeps the shell reading');
  assert.strictEqual(shell.dequote('plain\\ space', 'win32'), 'plain space', 'a word that is no Windows path is bash\'s');
});
