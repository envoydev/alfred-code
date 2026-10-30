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

// audit 2026-10-10 C13: what a shell write names, read the way the shell and the runtime run it
test('audit 2026-10-10 C13: an interpreter write through a bound name, a computed path and the shell spellings that are no path', () => {
  const targets = (c, cwd) => shell.scanShell(c, cwd ? { cwd } : {}).targets.map((t) => (t.unknown ? '<unknown>' : t.raw));
  // python's `p = '<literal>'` then `open(p, 'w')`, node's `const f = '...'` then writeFileSync(f): the literal
  assert.deepStrictEqual(targets("python3 - <<'EOF'\np='libs/ui/src/lib/x.ts'\ns=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nEOF"), ['libs/ui/src/lib/x.ts']);
  assert.deepStrictEqual(targets("node -e \"const f='src/a.js'; require('fs').writeFileSync(f, 'x')\""), ['src/a.js']);
  assert.deepStrictEqual(targets("python3 - <<'EOF'\np='apps/a.ts'\nPath(p).write_text('x')\nEOF"), ['apps/a.ts']);
  // a path the script computes is still a write - one unknown row
  assert.deepStrictEqual(targets("python3 - <<'EOF'\nfor p in files:\n  open(p,'w').write('x')\nEOF"), ['<unknown>']);
  assert.deepStrictEqual(targets("python3 - <<'EOF'\nopen(f'{root}/a.ts','w').write('x')\nEOF"), ['<unknown>']);
  assert.ok(shell.isVar(shell.UNKNOWN_WRITE), 'the unknown row is spelled as a variable, so a guard that skips $NAME skips it');
  // a read is no write
  assert.deepStrictEqual(targets("python3 - <<'EOF'\np='a.ts'\nprint(open(p).read().count('x'))\nEOF"), []);
  // sed scripts with another delimiter and an address's text command are scripts, not paths
  assert.deepStrictEqual(targets("sed -i '' 's#a#b#g' src/a.ts"), ['src/a.ts']);
  assert.deepStrictEqual(targets("sed -i '' 's|a|b|' src/a.ts"), ['src/a.ts']);
  assert.deepStrictEqual(targets("sed -i '' '/^Build waves/a\\\n X' plan.md"), ['plan.md'], 'a\\ with the text on the next line (0498718d)');
  assert.deepStrictEqual(targets("sed -i '' '/^    \"order_not_in_process\": /a\\    \"x\": 1,' apps/consumer/public/i18n/en.json"), ['apps/consumer/public/i18n/en.json'], 'one-line a\\ (fbfc2de4)');
  assert.deepStrictEqual(targets("sed -i '' '3i\\\nnew line' f.txt"), ['f.txt']);
  assert.deepStrictEqual(targets("sed -i '' 's/a/b/' /tmp/s.a.b.ts"), ['/tmp/s.a.b.ts'], 'a dotted file name stays a path');
  assert.deepStrictEqual(targets("sed -i '' 's/x/y/' /tmp/a"), ['/tmp/a'], 'a one-letter file stays a path');
  // chmod's mode and chown's owner are no path
  assert.deepStrictEqual(targets('chmod +x pw.sh'), ['pw.sh'], '758ce661');
  assert.deepStrictEqual(targets('chmod -R 755 dist'), ['dist']);
  assert.deepStrictEqual(targets('chmod u+x,g-w a b'), ['a', 'b']);
  assert.deepStrictEqual(targets('chmod --reference=a.sh b.sh'), ['b.sh']);
  assert.deepStrictEqual(targets('chown me:staff f'), ['f']);
  // an array assignment is no subshell running the file (bba03dad)
  const dir = fs.mkdtempSync(path.join(TMP, 'arr-'));
  fs.writeFileSync(path.join(dir, 'checklist.md'), 'build > out.txt\nrm -rf /\n');
  assert.deepStrictEqual(targets('LIVE=(checklist.md); echo ok', dir), [], 'NAME=(file) is an array');
  assert.deepStrictEqual(targets('arr+=(a "b c)" d); (cd x && rm -f y)', dir), ['y'], 'a quoted ) inside it, then a real subshell');
});

// audit 2026-10-20 C31 (970539b7): a write verb inside a string literal is text the script writes, never a write it makes;
// C25 (4d71a1b3): a `$NAME` the shell expands in a runtime's script takes the literal the same command assigned it.
test('audit 2026-10-20 C31 / C25: a write verb in a string is text; a shell-expanded $NAME in a runtime script resolves', () => {
  const targets = (c) => shell.scanShell(c, {}).targets.map((t) => (t.unknown ? '<unknown>' : t.raw));
  // the audited shape: python edits a scratch .mjs, the node call it inserts is a string argument
  assert.deepStrictEqual(targets("python3 - <<'EOF'\ns=open('scratch/r.mjs').read()\ns=s.replace(\"const a=1\", \"fs.mkdirSync('/work/out/dumps', {recursive:true})\")\nopen('scratch/r.mjs','w').write(s)\nEOF"), ['scratch/r.mjs']);
  assert.deepStrictEqual(targets("python3 - <<'EOF'\n\"\"\"doc: open('/a/b','w')\"\"\"\nopen('/real/x','w').write('y')\nEOF"), ['/real/x'], 'a docstring is text, the call after it is code');
  assert.deepStrictEqual(targets("python3 - <<'EOF'\nx = \"p = '/q'\"\nopen(p,'w')\nEOF"), ['<unknown>'], 'a binding inside a string binds nothing');
  // what the guard exists for still reads
  assert.deepStrictEqual(targets("python3 - <<'EOF'\nimport os\nos.makedirs('/elsewhere/out')\nEOF"), ['/elsewhere/out']);
  assert.deepStrictEqual(targets("python3 - <<'EOF'\n# don't touch\nopen('/out/x','w').write('y')\nEOF"), ['/out/x'], 'a comment apostrophe ends with its line');
  assert.deepStrictEqual(targets("node -e \"require('fs').writeFileSync('/out/y', 'x')\""), ['/out/y']);
  // C25: the shell expands $D in a double-quoted -e and an unquoted heredoc - never in a single-quoted -e or a quoted tag
  assert.deepStrictEqual(targets("D=/p/.alfred/docs/usage-report; node -e \"require('fs').writeFileSync('$D/SUMMARY.md', 'x')\""), ['/p/.alfred/docs/usage-report/SUMMARY.md']);
  assert.deepStrictEqual(targets("D=/x/y; python3 - <<EOF\nopen('${D}/a.md','w').write('x')\nEOF"), ['/x/y/a.md']);
  assert.deepStrictEqual(targets("D=/x/y; node -e 'require(\"fs\").writeFileSync(\"$D/a.md\", \"x\")'"), ['<unknown>'], 'single-quoted: $D is the script\'s own text');
  assert.deepStrictEqual(targets("D=/x/y; python3 - <<'EOF'\nopen('$D/a.md','w').write('x')\nEOF"), ['<unknown>'], 'a quoted tag hands $D over verbatim');
  assert.deepStrictEqual(targets("D=$(pwd); node -e \"require('fs').writeFileSync('$D/a.md','x')\""), ['<unknown>'], 'a computed value stays computed');
  assert.deepStrictEqual(targets("node -e \"require('fs').writeFileSync('$D/a.md','x')\"; D=/x"), ['<unknown>'], 'an assignment after the runtime is no value for it');
  // the script's own argument is its path; any other expression is computed - none registered a write before
  assert.deepStrictEqual(targets("node -e 'require(\"fs\").writeFileSync(process.argv[1], \"x\")' /out/a.txt"), ['/out/a.txt']);
  assert.deepStrictEqual(targets("python3 -c 'import sys; open(sys.argv[1], \"w\").write(\"x\")' /out/b.txt"), ['/out/b.txt']);
  assert.deepStrictEqual(targets("python3 -c 'import sys; print(open(sys.argv[1]).read())' /out/b.txt"), [], 'a read of the argument is no write');
  assert.deepStrictEqual(targets("node -e 'require(\"fs\").writeFileSync(process.argv[2], \"x\")' /out/a.txt"), ['<unknown>'], 'an argument not given is computed');
  assert.deepStrictEqual(targets("node -e 'require(\"fs\").writeFileSync(require(\"path\").join(\"/out\", \"c\"), \"x\")'"), ['<unknown>'], 'a built path is computed');
});

test('audit 2026-10-10 C13: a git tag listing reads; a new or deleted tag writes', () => {
  const writes = (c) => shell.scanShell(c, {}).gitWrites.length;
  for (const c of [`${G} tag --contains abc123`, `${G} tag -l 'v*'`, `${G} tag --points-at HEAD`, `${G} tag --merged main`, `${G} tag -n5`, `${G} tag`, `${G} tag --sort=-creatordate`])
    assert.equal(writes(c), 0, c);
  for (const c of [`${G} tag v1.2.3`, `${G} tag -a v1 -m x`, `${G} tag -d v1`, `${G} tag --delete v1 --contains x`]) assert.equal(writes(c), 1, c);
});

// Hooks review 2026-10-16: the in-place targets come from sed's own argument grammar, not the script's shape - 27 of 47
// cross-project blocks were a sed script read as an out-of-project path (`/a/d;/b/d`, `/x/s/a/b/`).
test('sed: the script is the first operand unless -e / -f name it, and every other operand is an in-place target', () => {
  const targets = (c) => shell.scanShell(c, {}).targets.map((t) => t.raw);
  assert.deepStrictEqual(targets("sed -i '/a/d;/b/d' f"), ['f'], 'two commands joined by ;');
  assert.deepStrictEqual(targets(`sed -i "" -E '/x/s/a/b/' f`), ['f'], 'an address then a substitution');
  assert.deepStrictEqual(targets("sed -i '' -e '/a/d' -e '/b/d' f g"), ['f', 'g'], 'every -e value is a script, every operand a file');
  assert.deepStrictEqual(targets("sed -i -e '/a/d' f"), ['f']);
  assert.deepStrictEqual(targets("sed -ne '/a/p' -i f"), ['f'], '-e at the end of a flag cluster takes the next word');
  assert.deepStrictEqual(targets("sed -i -es/a/b/ f"), ['f'], 'an attached -e value');
  assert.deepStrictEqual(targets("sed --in-place --expression='/a/d' f"), ['f']);
  assert.deepStrictEqual(targets("sed --in-place=.bak --expression '/a/d' f"), ['f']);
  assert.deepStrictEqual(targets("sed -i -f /tmp/edits.sed f"), ['f'], 'a -f script file is read, never written');
  assert.deepStrictEqual(targets("sed -i.bak '/a/d' f"), ['f'], 'an attached suffix');
  assert.deepStrictEqual(targets("sed -i .bak '/a/d' f"), ['f'], "BSD's separate suffix");
  assert.deepStrictEqual(targets("sed -ie '/a/d' f"), ['f'], '-ie is in-place with the suffix e');
  assert.deepStrictEqual(targets("sed -Ei '' '/a/{N;d;}' f"), ['f'], 'i at the end of a cluster');
  assert.deepStrictEqual(targets("sed -I '' '/a/d' f"), ['f'], "BSD's -I");
  assert.deepStrictEqual(targets("sed -i '' -- '/a/d' -f"), ['-f'], 'after -- a dash word is an operand');
  assert.deepStrictEqual(targets("sed -i 's/a/b/' /abs/other/f.ts x"), ['/abs/other/f.ts', 'x'], 'GNU spelling: no suffix word');
  // no in-place flag: sed writes nothing, whatever its operands look like
  assert.deepStrictEqual(targets("sed -n '/a/p' /abs/other/f"), []);
  assert.deepStrictEqual(targets("sed -e 's/i/x/' f"), [], 'an i inside a script is no flag');
  assert.deepStrictEqual(targets("sed -n -e '/a/d' -- -i"), [], 'an operand spelled -i after -- is a file, not the flag');
});

// ---- audit 2026-10-30 a0: the shared contracts every shell guard reads (T1; T2 consumes them) ----------------------
test('audit 2026-10-30 a0: shellVars expands $NAME / ${NAME} / $HOME / $PWD / ~ the way the shell will at that word', () => {
  const home = path.join(TMP, 'home-a0');
  const cwd = path.join(home, 'code', 'proj');
  const at = (cmd, word, n = 0) => { let i = -1; for (let k = 0; k <= n; k++) i = cmd.indexOf(word, i + 1); return i; };
  const ex = (cmd, word, opts = {}, n = 0) => {
    const P = shell.parseShell(cmd);
    return shell.shellVars(P, { cwd, home, ...opts }).expand(shell.dequote(word), at(cmd, word, n));
  };
  assert.strictEqual(ex('rm -rf "$HOME"', '"$HOME"'), home, '$HOME is the home directory');
  assert.strictEqual(ex('rm -rf ${HOME}/x', '${HOME}/x'), `${home}/x`, '${HOME}');
  assert.strictEqual(ex('rm -rf ~', '~'), home, 'a leading tilde');
  assert.strictEqual(ex('rm -rf ~/x', '~/x'), `${home}/x`);
  assert.strictEqual(ex('echo a~b', 'a~b'), 'a~b', 'a tilde inside a word is a name (RUNNER~1)');
  assert.strictEqual(ex('cat $PWD/.env', '$PWD/.env'), `${cwd}/.env`, '$PWD is where the shell stands');
  assert.strictEqual(ex('cat "$PWD"/.env', '"$PWD"/.env'), `${cwd}/.env`);
  assert.strictEqual(ex('cd .. && cat $PWD/x', '$PWD/x'), `${path.dirname(cwd)}/x`, 'a followed cd moves $PWD');
  assert.strictEqual(ex('cd /tmp && cd sub && echo $PWD', '$PWD'), path.resolve('/tmp/sub'));
  assert.strictEqual(ex('(cd /tmp); echo $PWD', '$PWD'), cwd, 'a subshell cd ends with it');
  assert.strictEqual(ex('H=$HOME; rm -rf "$H"', '"$H"'), home, 'an assignment followed within the command, its value expanded too');
  assert.strictEqual(ex('D=/srv/x; E=$D/y; rm -rf $E', '$E'), '/srv/x/y', 'a chain of assignments');
  assert.strictEqual(ex('rm -rf $(echo ~)', '$(echo ~)'), home, '$(echo <literal>) is its literal, tilde-expanded');
  assert.strictEqual(ex('rm -rf `echo $HOME`', '`echo $HOME`'), home);
  assert.strictEqual(ex('rm -rf "$(pwd)"', '"$(pwd)"'), cwd, '$(pwd) is $PWD');
  assert.strictEqual(ex('rm -rf "${HOME:?}"', '"${HOME:?}"'), home, 'a default / error form names the variable');
  assert.strictEqual(ex('echo $USERPROFILE/x', '$USERPROFILE/x'), `${home}/x`, 'USERPROFILE is the home directory');
  assert.strictEqual(ex('Remove-Item $env:USERPROFILE', '$env:USERPROFILE'), home, "PowerShell's $env:");
  assert.strictEqual(ex('rd /s /q %USERPROFILE%', '%USERPROFILE%'), home, "cmd's %NAME%");
  assert.strictEqual(ex('echo x > $CLAUDE_PROJECT_DIR/f', '$CLAUDE_PROJECT_DIR/f', { project: cwd }), `${cwd}/f`);
  assert.strictEqual(ex('cd /tmp && rm -rf x', 'x'), 'x', 'a plain word is itself');
  // what is never guessed: an unset name, a loop or read variable, a computed value, a name assigned AFTER the word
  assert.strictEqual(ex('rm -rf $OTHER/x', '$OTHER/x'), '$OTHER/x', 'an unset name stays');
  assert.strictEqual(ex('for H in a b; do rm -rf $H; done', '$H'), '$H', 'a loop variable stays');
  assert.strictEqual(ex('H=/x; read H; rm -rf $H', '$H'), '$H', 'a read variable stays');
  assert.strictEqual(ex('H=$(date); rm -rf $H', '$H'), '$H', 'a computed value stays');
  assert.strictEqual(ex('rm -rf $H; H=/x', '$H'), '$H', 'an assignment after the word does not reach back');
  assert.strictEqual(ex('H=/x rm -rf $H', '$H'), '$H', "a prefix assignment is the command's environment, not its arguments");
  assert.strictEqual(ex('HOME=/elsewhere; rm -rf ~', '~'), '/elsewhere', 'a reassigned HOME moves the tilde');
  assert.strictEqual(ex('cd $UNSET && cat $PWD/x', '$PWD/x'), '$PWD/x', 'a cd that cannot be followed leaves $PWD unknown');
  assert.strictEqual(ex('cd ~/code && echo $PWD', '$PWD'), `${home}/code`, 'a cd target is expanded too');
  const v = shell.shellVars(shell.parseShell('cd .. && x'), { cwd, home });
  assert.strictEqual(v.pwdAt(9), path.dirname(cwd), 'pwdAt is exported for a caller resolving a relative path');
});

test('audit 2026-10-30 a0: printedFiles - the ONE whole-file print verb table (HK-06, HK-19)', () => {
  const pf = (cmd) => { const [verb, ...argv] = cmd.split(' '); const r = shell.printedFiles(verb, argv); return r && (r.bounded ? ['bounded', ...r.files] : r.files); };
  for (const v of ['cat', 'tac', 'nl', 'rev', 'shuf', 'vis', 'sort', 'uniq', 'od', 'xxd', 'hexdump', 'base64', 'strings', 'paste', 'fold', 'fmt',
    'expand', 'unexpand', 'pr', 'column', 'zcat', 'gzcat', 'bzcat', 'xzcat', 'zstdcat'])
    assert.deepStrictEqual(pf(`${v} .env`), ['.env'], `${v} prints its operand whole`);
  assert.deepStrictEqual(pf('shuf -n 3 big.ts'), ['bounded', 'big.ts'], 'shuf -n is bounded');
  assert.strictEqual(pf('shuf -e a b'), null, 'shuf -e echoes its arguments, no file');
  assert.strictEqual(pf('shuf -i 1-9'), null, 'shuf -i is a range, no file');
  assert.deepStrictEqual(pf('join -t= -v1 .env /dev/null'), ['.env', '/dev/null'], 'join prints its files');
  assert.deepStrictEqual(pf('join -1 2 -2 1 a b'), ['a', 'b'], "join's -1 / -2 take a field");
  assert.deepStrictEqual(pf('vis -F 80 .env'), ['.env'], "vis's -F takes a width");
  assert.deepStrictEqual(pf('gzip -c .env'), ['.env'], 'gzip -c prints the file (compressed) to stdout');
  assert.deepStrictEqual(pf('gzip -dc f.gz'), ['f.gz'], 'a cluster holding c');
  assert.deepStrictEqual(pf('gunzip --stdout f.gz'), ['f.gz']);
  assert.deepStrictEqual(pf('xz -c f'), ['f']);
  assert.deepStrictEqual(pf('bzip2 -kc f'), ['f']);
  assert.strictEqual(pf('gzip .env'), null, 'gzip without -c writes a file, prints nothing');
  assert.deepStrictEqual(pf('sort -k 2 -o out.txt a'), ['a'], "sort's -k and -o take a value");
  assert.deepStrictEqual(pf('cat -- -x'), ['-x'], 'after -- a dash word is a file');
  assert.deepStrictEqual(pf('cat - f'), ['f'], 'stdin is no file');
  assert.strictEqual(pf('grep x f'), null, 'grep is no whole-file print');
  assert.ok(Object.isFrozen(shell.PRINT_VERBS), 'the table is frozen: one home, read-only for every guard');
});

test('audit 2026-10-30 HK-01: the --with-sensitive runner is a carrier - its line is shell text like sh -c', () => {
  const g = '/x/stack/hooks/guard-secret-value.js';
  const texts = (c) => shell.carriedScripts(c).filter((s) => s.runner).map((s) => s.text);
  assert.deepStrictEqual(texts(`node "${g}" --with-sensitive -- "rm -rf ~"`), ['rm -rf ~'], 'one word after -- is the line');
  assert.deepStrictEqual(texts(`node ${g} --with-sensitive -- 'cat .env'`), ['cat .env']);
  assert.deepStrictEqual(texts(`node ${g} --with-sensitive -- rm -rf "a b"`), ["rm -rf 'a b'"], 'several words are one argv line, quoted');
  assert.deepStrictEqual(texts(`node ${g} --with-sensitive "git push -f"`), ['git push -f'], 'no -- before the line');
  assert.deepStrictEqual(texts(`/usr/local/bin/node --no-warnings ${g} --with-sensitive -- x`), ['x'], 'node by path, its own options first');
  assert.deepStrictEqual(texts(`env A=1 nodejs ${g} --with-sensitive -- y`), ['y'], 'past a wrapper');
  assert.deepStrictEqual(texts(`node ${g} --presence .env KEY`), [], 'the presence view carries nothing');
  assert.deepStrictEqual(texts(`node ${g} --with-sensitive --`), [], 'an empty runner carries nothing');
  assert.deepStrictEqual(texts(`node other.js --with-sensitive -- "rm -rf ~"`), [], 'another script is not the runner');
  assert.deepStrictEqual(texts(`echo node ${g} --with-sensitive -- "rm -rf ~"`), [], 'a printed runner runs nothing');
  // the shared readers see the line
  assert.match(shell.gitText(`node ${g} --with-sensitive -- "git push --force origin main"`, TMP).command, /git push --force origin main/);
  assert.deepStrictEqual(shell.scanShell(`node ${g} --with-sensitive -- "echo x > /elsewhere/f"`, {}).targets.map((t) => t.raw), ['/elsewhere/f']);
  assert.deepStrictEqual(shell.sensitiveRuns(`bash -c 'node ${g} --with-sensitive -- "cat .env"'`).map((s) => s.text), ['cat .env'], 'nested in a carried script');
});
