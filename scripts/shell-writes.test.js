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
test('gitText: ANSI-C quoting, a `$((` bash runs as a substitution and a quoted or commented heredoc opener hide no command (the eighth R015 review, 2026-11-05)', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  assert.deepStrictEqual(subs("echo $'a\\'b' ; git push"), ['push'], "$'a\\'b' is one word");
  assert.deepStrictEqual(subs("echo $$'\\' ; git push"), ['push'], "$$ then a plain '\\'");
  assert.deepStrictEqual(subs("echo \\$'a\\' ; git push"), ['push'], 'an escaped $ opens no ANSI-C quote');
  assert.deepStrictEqual(subs('echo $((git push) )'), ['push'], 'the inner group closes on ") " - a substitution');
  assert.deepStrictEqual(subs('echo $((echo a) ; (git push))'), ['push']);
  assert.deepStrictEqual(subs('echo $(( (1+2) )) && git status'), ['status'], 'arithmetic stays arithmetic');
  assert.deepStrictEqual(subs('echo "<<\'EOF\'"\ngit push\nEOF'), ['push'], 'a double-quoted opener');
  assert.deepStrictEqual(subs("echo '<<EOF'\ngit push\nEOF"), ['push'], 'a single-quoted opener');
  assert.deepStrictEqual(subs('echo hi # <<EOF\ngit push\nEOF'), ['push'], 'an opener in a comment');
  assert.deepStrictEqual(subs("cat <<'EOF'\nit's \"\ngit push\nEOF\ngit status"), ['status'], 'a real body holding quotes stays a body');
  assert.deepStrictEqual(subs('x="a\nb" && cat <<EOF\ngit push\nEOF'), [], 'a quote spanning lines before a real opener');
  assert.strictEqual(shell.heredocsOf('echo ${#x} <<EOF\nbody\nEOF').length, 1, '${#x} starts no comment');
});
test('lexShell: one pass reads quotes, comments and heredocs as bash does - the shapes the three scanners disagreed on (the eighth R015 review, retry)', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  assert.deepStrictEqual(subs('echo "`echo "\'"`" ; git push'), ['push'], 'a backtick holding a quote inside double quotes');
  assert.deepStrictEqual(subs('echo "`git push`"'), ['push'], 'a backtick inside double quotes runs');
  assert.deepStrictEqual(subs('echo $(echo a)#x ; git push'), ['push'], '# after a substitution\'s ) is word text');
  assert.deepStrictEqual(subs('(echo b)#x ; git push'), [], '# after a subshell\'s ) starts a comment');
  assert.deepStrictEqual(subs('echo "$(case a in a) echo "\'" ;; esac)" ; git push'), ['push'], 'a case arm\'s ) inside $( closes nothing');
  assert.deepStrictEqual(subs('x=$(case a in (a) echo y ;; esac); git status'), ['status'], 'a pattern with its own ( too');
  assert.deepStrictEqual(subs('echo ${x/<<EOF/y}\ngit push\nEOF'), ['push'], '<< inside ${ } opens no heredoc');
  assert.deepStrictEqual(subs('echo $((\n1 <<EOF\n))\ngit push\nEOF'), ['push'], '<< inside a $(( )) across lines opens none');
  assert.deepStrictEqual(subs("echo $((git push; echo '))') )"), ['push'], 'quotes inside a $(( are skipped');
  assert.deepStrictEqual(subs('echo $(date)#x <<EOF\ngit push\nEOF'), [], 'a real heredoc after #-in-a-word stays a body');
  assert.deepStrictEqual(subs("trap 'git push' EXIT"), ['push'], "trap's action runs");
  assert.deepStrictEqual(subs("X='git push'; trap \"$X\" EXIT"), ['push'], 'a bound action too');
  assert.deepStrictEqual(subs("trap - EXIT; trap '' INT; trap -p"), [], 'a reset, an ignore and a print run nothing');
  assert.deepStrictEqual(subs('x=$(cat <<EOF\ngit push\nEOF\n); git status'), ['status'], 'a heredoc inside $( takes its body');
  assert.deepStrictEqual(subs('cat <<A <<B\ngit push\nA\ngit push\nB\ngit status'), ['status'], 'two openers on a line, bodies in turn');
  assert.deepStrictEqual(shell.quotedSpans('echo "a $(echo "b") c"'), [[5, 8], [15, 18], [19, 22]], 'a substitution pauses the span');
  assert.strictEqual(shell.blankComments('echo a # x\necho "#" #y'), 'echo a    \necho "#"   ');
});
test('lexShell: the fuzzer\'s second pass - blanked text opens no body to the end, eval reads the parser\'s words, a pipe into a shell looks past a wrapper', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    "bash <<'E'\necho ${#x}; git push\nE", 'cat <<E\n$(echo ${#x}; git push)\nE', "cat <<E\nfoo\nE\n# it's\ngit push",
    "echo `eval 'git push'`", 'eval "echo "$((1))"; git push"', 'eval "echo "`echo \'`"; git push"',
    "time echo 'git push' | bash", "env A=1 echo 'git push' | bash", "nohup echo 'git push' | bash",
  ]) assert.ok(subs(c).includes('push'), `${JSON.stringify(c)} -> ${JSON.stringify(subs(c))}`);
  // a double-quoted span resumes after a substitution on any character: the word holds it, nothing in it runs
  assert.deepStrictEqual(shell.parseShell('echo "$(date) is; now"').cmds.map((k) => k.words.map((w) => w.raw)), [['echo', '"$(date) is; now"'], ['date']]);
  for (const c of ['echo "$(date)#x; git push"', 'x="`date` a; git push"']) assert.deepStrictEqual(subs(c), [], c);
  assert.ok(subs('sh -c "bash -c \'echo `echo a`#b; git push\'"').includes('push'), 'a carried script built round a substitution');
  // bash 5 reads a `$((` holding a `case` as a substitution; a `;` is never arithmetic either
  for (const c of ['echo $((echo $(case a in a) echo x;; esac); git push))', 'x=${y:=$((echo $(case a in (a) echo ")";; esac); git push))}']) {
    assert.ok(subs(c).includes('push'), c);
  }
  // a heredoc with no terminator inside a `$( )` inside a backtick: bash 3.2 ends it at the `)` - unread
  const g = shell.gitText('echo `x=$(cat <<E\nfoo\n); git push`', process.cwd());
  assert.ok(g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'), JSON.stringify(g.calls.map((x) => x.sub)));
});

test('gitText: a backtick that ends at the first backtick leaves the rest of the subcommand an expansion - the call is opaque, the gate\'s hidden push (the fuzzer\'s fifth pass)', () => {
  for (const c of [
    'echo `x="`echo `echo "\\`"`; git push`"`', 'echo `echo `x=`cat <<E\nfoo\n`; git push``', 'echo `echo "`! false; git push`"`',
    'echo `x="`echo $(case a in (a) echo ")";; esac); git push`"`', 'git push$(true)', 'git pu$(echo sh)',
  ]) {
    const calls = shell.gitText(c, process.cwd()).calls;
    assert.ok(calls.some((x) => x.opaque && /^pu/.test(x.subRaw)), `${JSON.stringify(c)} -> ${JSON.stringify(calls.map((x) => [x.subRaw, x.opaque]))}`);
  }
});

test('lexShell: the tenth review - a heredoc opened in a backtick or in a `$((` read as a substitution ends with it, any shell word is a delimiter, and past the re-read budget the text is unread', () => {
  // bash and zsh read a backtick, and a `$((` that is not arithmetic, as a string first: a heredoc opened in it has no
  // body past its end, so the lines after it run (the tenth R015 review, 2026-11-05: each hid a `git push`).
  const seen = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push' || x.opaque); };
  for (const c of [
    'a=1; b=2; echo $((a) + (b) << 2)\ngit push\n2', 'a=1; echo $(( (a) << 2 ) )\ngit push\n2',
    'x=$(( `case a in a) echo 1;; esac` << 2 ))\ngit push\n2', 'x=$(( "$(case a in a) echo 1;; esac)" << 2 ))\ngit push\n2',
    "sh -c 'x=$(( `case a in a) echo 1;; esac` << 2 ))\ngit push\n2'", "trap 'x=$(( `case a in a) echo 1;; esac` << 2 ))\ngit push\n2' EXIT",
    'x=$(( ${y:-`case a in a) echo 1;; esac`} << 2 ))\ngit push\n2', 'echo $(( 1 << 2 ; 3 ))\ngit push',
    'echo `cat <<E`\nfoo\nE\ngit push', 'cat <<${E}\ny\n${E}\ngit push', 'cat > notes.txt <<${MARK:-EOF}\nnotes\n${MARK:-EOF}\ngit push',
    'cat <<$(x)\nfoo\n$(x)\ngit push', 'cat <<`x`\nfoo\n`x`\ngit push',
    'echo ' + '$(('.repeat(12) + 'x' + ') '.repeat(24) + '\necho $(( 1 << 2 ))\ngit push\n2',
  ]) assert.ok(seen(c), JSON.stringify(c));
  // a heredoc whose body stays inside the region still hides its body, and an arithmetic shift opens nothing
  assert.deepStrictEqual(shell.gitText('x=$(( (a) <<E\ngit push\nE\n) ); git status', process.cwd()).calls.map((x) => x.sub), ['status']);
  assert.deepStrictEqual(shell.gitText('echo $(( 1 << 2 ))\ngit status', process.cwd()).calls.map((x) => x.sub), ['status']);
  assert.deepStrictEqual(shell.gitText('cat <<"$(x)"\ngit push\n$(x)\ngit status', process.cwd()).calls.map((x) => x.sub), ['status']);
});

test('lexShell: a heredoc opened in a `$( )` that closes on its line - zsh and bash 3.2 give it no body, bash 5 reads on - is unread, and its next lines are read as commands', () => {
  // The tenth review's fix pass, against the shells: `x=$(cat <<E)` then `git push` pushes in zsh (the Bash tool's shell
  // on macOS) and bash 3.2, while bash 5.2 takes the line as the heredoc's body. No one reading is right for all three.
  for (const c of ['x=$(cat <<E)\ngit push', 'x=$(cat <<E $(cat <<E))\nfoo\nE\ngit push', "x=$(cat <<E)\nit's\nE\ngit push"]) {
    const g = shell.gitText(c, process.cwd());
    assert.ok(g.unreadAt >= 0, `${JSON.stringify(c)} is unread`);
  }
  assert.ok(shell.gitText('x=$(cat <<E)\ngit push', process.cwd()).calls.some((x) => x.sub === 'push'), 'the next line is a command');
  // the commit message pattern keeps its body inside the substitution: read, nothing unread
  const g = shell.gitText('git commit -m "$(cat <<\'EOF\'\nfix: it\'s (a) `thing` #2 $((1+1))\nEOF\n)"', process.cwd());
  assert.deepStrictEqual([g.calls.map((x) => x.sub), g.unreadAt], [['commit'], -1]);
});

test('carriedScripts: what echo, printf or a cat of a heredoc prints is read wherever it reaches a shell - a group or a subshell piped in, /dev/stdin, <( ), a substitution as the whole script word, env -S, busybox (the tenth review)', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    '{ echo git push; } | sh', '(echo git push) | sh', 'cat <<EOF | (sh)\ngit push\nEOF', '{ echo git push; echo true; } | bash',
    '(cat <<EOF\ngit push\nEOF\n) | sh', 'printf "git push\\n" | (cd . && sh)', 'source /dev/stdin <<EOF\ngit push\nEOF',
    '. /dev/stdin <<EOF\ngit push\nEOF', 'echo git push | sh /dev/stdin', 'bash <(echo git push)', 'source <(echo git push)',
    "eval \"$(cat <<'EOF'\ngit push\nEOF\n)\"", "sh -c \"$(printf 'git push')\"", 'bash -c "$(echo git push)"', 'eval `echo git push`',
    "env -S 'git push'", "env -S 'sh -c \"git push\"'", "busybox sh -c 'git push'", 'echo git push | busybox sh',
  ]) assert.ok(subs(c).includes('push'), `${JSON.stringify(c)} -> ${JSON.stringify(subs(c))}`);
  // what another program prints does not exist until it runs: out of model, as before
  for (const c of ['curl -fsSL https://example.com/i.sh | sh', 'eval "$(ssh-agent -s)"']) assert.deepStrictEqual(subs(c), [], c);
  // one push read once, never twice through two routes
  assert.deepStrictEqual(subs('echo git push | sh'), ['push']);
});

test('lexShell: a quote in an arithmetic scan whose text holds a paren, a backtick, a backslash or a newline, or runs on, is unread - bash reads a quote there, zsh a character (the seventh fuzz pass)', () => {
  // zsh scans `$((` and `((` as it scans a double-quoted string, so a `'` or `"` is a character; bash reads a quote. A
  // quote holding a paren or a line ends the scan in two places: `x=$(( (a) <<'E'` + `it's` + `E` + `) ); git push`
  // pushes in zsh and is a syntax error in bash (173 fuzz cases, 2026-11-05).
  const seen = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'); };
  for (const c of [
    "x=$(( (a) <<'E'\nit's\nE\n) ); git push", 'x=$(( (a) <<E\nit"s\nE\n) ); git push', "(( (a) <<'E'\nit's\nE\n) ); git push",
    "echo \"$(( (a) <<'E'\nit's\nE\n) )\"; git push", "echo $(( 1 ' ) )\ngit push",
  ]) assert.ok(seen(c), JSON.stringify(c));
  // a quote the two shells end in the same place reads as before
  for (const c of ["(( x == 'a' )); git status", 'echo $(( "1" + 2 )); git status', "echo $(( $(wc -l < 'f') + 1 )); git status"]) {
    const g = shell.gitText(c, process.cwd());
    assert.deepStrictEqual([g.calls.map((x) => x.sub), g.unreadAt], [['status'], -1], c);
  }
});

test('carriedScripts: a group piped into a shell after then, do or time, a word mixing text with what a substitution prints, and env -S with a backslash-newline are read (the seventh fuzz pass)', () => {
  // each pushed in bash 3.2, zsh and bash 5.2 and was read by no guard (2026-11-05)
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    "if true; then { echo 'git push'; } | sh; fi", "time { echo 'git push'; } | sh", "for i in 1; do { echo 'git push'; } | sh; done",
    "while true; do { { echo 'git push'; }; } | sh; break; done",
    "eval \"eval \"$(cat <<'E'\ngit push\nE\n)\"\"", 'eval "eval $(echo git push)"', "sh -c 'eval '\"$(printf 'git push')\"",
    "env -S 'sh -c \"echo a\\\ngit push\"'",
  ]) assert.ok(subs(c).includes('push'), `${JSON.stringify(c)} -> ${JSON.stringify(subs(c))}`);
  // a substitution of another program keeps the whole word out of model; a quoted `{` is no group
  assert.deepStrictEqual(subs('eval "eval $(ssh-agent -s)"'), []);
  assert.deepStrictEqual(subs("echo '{' | sh; git status"), ['status']);
});

test('carriedScripts: an unquoted substitution is word-split, a heredoc left open ends at its script, echo keeps a quoted substitution whole, and a `$[` holding a separator is unread (the eighth fuzz pass)', () => {
  // each pushed in bash 3.2, zsh and bash 5.2 or in dash, and was read by no guard (2026-11-05)
  const seen = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'); };
  for (const c of [
    // eval joins the split words with blanks: a line break the substitution prints is one
    "eval \"x=1; \"$(echo ': <<E\nE; git push')", "eval \"x=1; \"$(echo 'cat <<E\nfoo; git push')",
    "eval \"x=1; \"$(echo 'cat <<${E}\ny\n${E}; git push')",
    // a heredoc opened at the end of one carried script has no body: the next script is no part of it
    "bash <<E\necho $((a) + (b) << 2); git push\nE", "bash <(echo 'bash <<'E'\necho $((a) + (b) << 2); git push\nE')",
    // echo's words keep a substitution holding quotes whole
    'echo "a $(echo "b") ; git push" | sh', "bash <(echo 'env -S 'sh -c \"echo \"$(echo \"$(echo a)\")\"; git push\"'')",
    // dash reads `$[` as text, bash and zsh as arithmetic
    "sh -c 'eval '\"$(printf '%s' 'echo $[x; git push')\"", "sh -c 'echo $[x\ngit push'",
  ]) assert.ok(seen(c), JSON.stringify(c));
  // a double-quoted substitution keeps its lines; a closed `$[` with no separator reads as before
  assert.deepStrictEqual(shell.gitText("eval \"$(printf 'git status\\ngit push')\"", process.cwd()).calls.map((x) => x.sub), ['status', 'push']);
  const g = shell.gitText('echo $[1+2]; git status', process.cwd());
  assert.deepStrictEqual([g.calls.map((x) => x.sub), g.unreadAt], [['status'], -1]);
});

test('carriedScripts: echo prints a word with each substitution\'s output in place, and a heredoc body leaving a substitution open is unread (the ninth fuzz pass)', () => {
  const seen = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'); };
  for (const c of [
    // every shell: the inner `$(echo 'a\nb')` is printed, so its quotes are no quotes to the next shell
    "echo \"a $(echo \"b\") ; echo ': $(echo 'a\nb'); git push' | bash\" | sh",
    // dash parses a substitution in an unquoted heredoc body as it reads it, past the terminator line
    "sh -c 'eval '\"$(printf '%s' 'echo `cat <<E\n$(\nE\n); git push`')\"",
  ]) assert.ok(seen(c), JSON.stringify(c));
  // a closed substitution in a body reads as before; a deep nest of prints stays linear and is read
  assert.deepStrictEqual(shell.gitText('cat <<E\n$(date)\nE\ngit status', process.cwd()).calls.map((x) => x.sub), ['status']);
  const t0 = Date.now();
  const deep = shell.gitText(`eval "${'$(echo "'.repeat(2000)}git push${'")'.repeat(2000)}"`, process.cwd());
  assert.ok(Date.now() - t0 < 8000, `a 2,000-deep nest of prints took ${Date.now() - t0} ms`);
  assert.ok(deep.unreadAt >= 0 || deep.calls.some((x) => x.sub === 'push'), 'the nested push is read or unread');
});

test('carriedScripts: a print substitution inside a parameter expansion of a carried word is unread - the variable decides where its output lands (the tenth fuzz pass)', () => {
  // the outer shell expands `${y:=...}` around the output, so sh runs `x=a; git push` (every shell, 2026-11-05)
  const seen = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'); };
  for (const c of ['sh -c "x=${y:=$(echo a\\; git push)}"', 'eval "x=${y:-$(echo a\\; git push)}"', 'echo "x=${y:-$(echo a\\; git push)}" | sh']) {
    assert.ok(seen(c), JSON.stringify(c));
  }
  // a parameter expansion with no substitution in it, and a substitution beside one, read as before
  for (const c of ['sh -c "x=${y:-a}; git status"', 'eval "${y:-x}=1 $(echo git status)"']) {
    const g = shell.gitText(c, process.cwd());
    assert.deepStrictEqual([g.calls.map((x) => x.sub), g.unreadAt], [['status'], -1], c);
  }
});

test('gitText: a long word run and arithmetic closing on a non-`)` read in linear time (the ninth review\'s I6)', () => {
  // A command of many words walked every earlier word per word (`case case ...`: 6.8 s at 400,000 characters), and each
  // arithmetic read again as a substitution recounted every open frame (`$((1)$((1)...`: 1.7 s at 100,000). Each shape
  // here runs under 1 s now and near 25 s on the quadratic path; 8 s leaves room for a slow CI runner.
  // The tenth review's shapes: arithmetic open in arithmetic, each read again to its close; arithmetic in `${ }` in
  // arithmetic; and plain nesting, which every word's own re-lex made quadratic.
  for (const [unit, times, tail] of [['case ', 160000], ['$((1)', 80000], ['$((x ', 12800, ') '.repeat(25600)], ['$(( ${x:-', 3200, '} ) ) '.repeat(3200)], ['$(', 16000, ')'.repeat(16000)]]) {
    const t0 = Date.now();
    const g = shell.gitText('echo ' + unit.repeat(times) + (tail || '') + '\ngit push', process.cwd());
    const calls = g.unreadAt >= 0 ? [{ sub: 'unread' }] : g.calls;
    const ms = Date.now() - t0;
    assert.ok(ms < 8000, `${JSON.stringify(unit)} x ${times} took ${ms} ms`);
    assert.ok(calls.length >= 1, `${JSON.stringify(unit)}: the trailing push is still read`);
  }
});

test('lexShell: the fuzzer\'s first pass - a heredoc with no terminator line runs to the end of the text, a # after an escaped blank is word text', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    'echo a\\ #b; git push', 'echo a\\ #b\ngit push', "cat <<E\n$(echo a)'\nE; x=$(git push)", "cat <<-E\n\t'\n\tE; echo `git push`",
    "cat <<E-1\n'\nE-1; echo \"$(git push)\"",
    // a shell's -c word keeps its substitutions whole: bash removes no quote inside one (bash only - zsh reads the quote)
    'sh -c "echo "`echo \'`"; git push"',
  ]) assert.deepStrictEqual(subs(c), ['push'], c);
  // a carried script joins the text after whatever the text leaves open: a quote, a body, `${`, a trailing backslash
  for (const c of ["bash -c 'git push'\necho 'x", "bash -c 'git push'\necho \"x", "bash -c 'git push'\necho a\\", "bash -c 'git push'\necho ${x", "bash -c 'git push'\ncat <<E\nx"]) {
    assert.deepStrictEqual(subs(c), ['push'], `a carried script after an open end: ${JSON.stringify(c)}`);
  }
  assert.deepStrictEqual(subs('# run `git push` by hand\ngit status'), ['status'], 'a # opening the text is a comment');
  for (const c of ['cat <<E\ngit push', ': <<E\nE; git push', 'cat <<A <<B\nx\nA\ngit push']) {
    assert.deepStrictEqual(subs(c), [], `a body with no terminator line is data to the end: ${JSON.stringify(c)}`);
  }
});

test('carriedScripts: an unquoted heredoc body runs each substitution in it, as bash expands the body first (the fuzzer against bash and zsh)', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    'cat <<E\n$(git push)\nE', 'cat <<E\n`git push`\nE', 'cat <<E\n${x:-$(git push)}\nE', 'cat <<E\na $(echo "$(git push)") b\nE',
    "cat <<E\n'$(git push)'\nE", 'cat <<E\n$(( $(git push) ))\nE', 'cat <<E\n$((1+2)) $(git push)\nE', 'cat <<-E\n\t$(git push)\n\tE',
    'cat <<E\n\\\\$(git push)\nE', 'cat <<E\n"$(git push)"\nE', "cat <<E\n$(echo ')' ; git push)\nE",
    'cat <<E\n$(cat <<F\nx\nF\n)$(git push)\nE', 'cat <<E\n$(\ngit push\n)\nE',
  ]) assert.deepStrictEqual(subs(c), ['push'], c);
  assert.deepStrictEqual(subs('cat <<A <<B\n$(git status)\nA\n$(git push)\nB'), ['status', 'push'], 'two bodies, each expanded');
  for (const c of ['cat <<E\n\\$(git push)\nE', "cat <<'E'\n$(git push)\nE", 'cat <<"E"\n$(git push)\nE', 'cat <<\\E\n$(git push)\nE']) {
    assert.deepStrictEqual(subs(c), [], `a quoted delimiter or an escaped $ expands nothing: ${c}`);
  }
  // the other guards read it too: a write inside a body's substitution is a write
  const t = shell.scanShell('cat <<E\n$(touch /tmp/x-doc-write)\nE').targets.map((x) => x.raw);
  assert.ok(t.includes('/tmp/x-doc-write'), JSON.stringify(t));
});

test('lexShell and parseShell: review 9 - quotes in arithmetic, esac after ) or in, a backtick ends at the first backtick, quotes in ${ }, any heredoc word, $[ ], a substitution in arithmetic', () => {
  const subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
  for (const c of [
    "n=$(( $(grep -c '(' a.txt) + 1 )); git push", 'echo $(( "(" )); git push',
    'echo "$(case a in a) esac)" \'#\'; git push', 'echo $(case a in esac)#x; git push', 'echo $(case=1; echo a)#x; git push',
    'echo "`echo \'`"; git push; echo "\'"', "echo `echo '`; git push; echo '`'", 'echo `echo a #`; git push',
    'echo ${x:-"{"}; git push', "echo ${x:-'{'}; git push", 'echo ${x:-\\{}; git push',
    "cat <<'END-X'\nit's\nEND-X\ngit push", "cat <<END.X\nit's\nEND.X\ngit push", "cat <<'1'\nit's\n1\ngit push",
    "cat <<E\"O\"F\nit's\nEOF\ngit push", "echo ${x/<#/y}; git push; echo '#>'", 'echo $[1<<EOF]\ngit push\nEOF',
    'echo $((1 + $(git push) ))',
  ]) assert.deepStrictEqual(subs(c), ['push'], c);
  assert.deepStrictEqual(subs('x=$(( $(date +%s) - 10 )); git status'), ['status'], 'arithmetic stays data');
  assert.deepStrictEqual(subs("cat <<'END-X'\ngit push\nEND-X\ngit status"), ['status'], 'a dashed delimiter still closes its body');
  for (const big of ['$(('.repeat(13334), '(('.repeat(20000), '$(( "('.repeat(5000)]) {
    const t = Date.now();
    shell.gitText(big, process.cwd());
    assert.ok(Date.now() - t < 1000, `${big.slice(0, 6)} x ${big.length}: ${Date.now() - t} ms`);
  }
});
test('commandWords: `time` takes a whole pipeline, a body keyword included (the seventh R015 review, 2026-11-05)', () => {
  const names = (c) => { const g = shell.gitText(c, process.cwd()); return shell.commandWords(g.command, g.parsed).map((w) => w.name); };
  assert.ok(names('time until gh pr merge --squash; do :; done').includes('gh'), 'time until');
  assert.ok(names('time ! gh pr merge --squash').includes('gh'), 'time !');
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
  assert.strictEqual(ex('cd ~/code && echo $PWD', '$PWD'), path.join(home, 'code'), 'a cd target is expanded too - a resolved anchor, native separators');
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
  // final review FB: the script word before the flag is never matched by name - `node "$G"` and `--disable-warning X <G>`
  // passed a basename test - so another script given the flag is judged too (a false block, never a line run unread)
  assert.deepStrictEqual(texts(`node other.js --with-sensitive -- "rm -rf ~"`), ['rm -rf ~'], 'any script given the flag is judged as the runner');
  assert.deepStrictEqual(texts(`echo node ${g} --with-sensitive -- "rm -rf ~"`), [], 'a printed runner runs nothing');
  // the shared readers see the line
  assert.match(shell.gitText(`node ${g} --with-sensitive -- "git push --force origin main"`, TMP).command, /git push --force origin main/);
  assert.deepStrictEqual(shell.scanShell(`node ${g} --with-sensitive -- "echo x > /elsewhere/f"`, {}).targets.map((t) => t.raw), ['/elsewhere/f']);
  assert.deepStrictEqual(shell.sensitiveRuns(`bash -c 'node ${g} --with-sensitive -- "cat .env"'`).map((s) => s.text), ['cat .env'], 'nested in a carried script');
});

// The 2026-10-30 gate's Windows leg: bash keeps a backslash inside double quotes unless it escapes `$`, a backtick, `"`,
// `\` or a newline, so `pwsh -Command "[IO.File]::WriteAllText('C:\x\sib\f.txt', 'x')"` hands PowerShell the path as
// written. The script reader dropped every backslash there and read a relative name inside the project (HK-14 passed).
test('runtimeScripts: a double-quoted script keeps each backslash bash keeps, and loses each one bash undoes', () => {
  const [ps] = shell.runtimeScripts(`pwsh -Command "[IO.File]::WriteAllText('C:\\a\\sib\\f.txt', 'x')"`);
  assert.strictEqual(ps.body, "[IO.File]::WriteAllText('C:\\a\\sib\\f.txt', 'x')", 'a backslash before a plain letter stays');
  const [js] = shell.runtimeScripts('node -e "console.log(\\"a\\\\b\\$c\\")"');
  assert.strictEqual(js.body, 'console.log("a\\b$c")', 'an escaped quote, backslash and dollar are undone');
});

// E1-2c (inventory A): unlink, shred, trash and trash-put remove files like rm, so each operand is a write target;
// shred's -n / -s values are counts, never paths.
test('E1-2c: unlink, shred and trash name their operands as writes', () => {
  const targets = (c) => shell.scanShell(c, {}).targets.map((t) => t.raw);
  for (const cmd of ['unlink a/f', 'shred -u a/f', 'trash a/f', 'trash-put a/f'])
    assert.deepStrictEqual(targets(cmd), ['a/f'], cmd);
  assert.deepStrictEqual(targets('shred -n 3 -u a/f'), ['a/f'], "shred's -n value is no path");
  assert.deepStrictEqual(targets('shred --iterations 3 -s 1K a/f'), ['a/f'], "shred's --iterations and -s values are no paths");
});

// The eleventh review of the one-shell reader (2026-11-05) and the probes beside it: each shape below runs the push (or
// the rm) in bash 3.2, zsh and dash, and was read as running nothing.
const r11Subs = (c) => shell.gitText(c, process.cwd()).calls.map((x) => x.sub);
const r11Carried = (c) => shell.carriedScripts(c).map((s) => s.text);
const r11Read = (c) => { const g = shell.gitText(c, process.cwd()); return g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'); };

test('carriedScripts: a print counts at its own substitution\'s level only - a nested one is already in place (review 11, 1)', () => {
  // the inner echo's `"` was read as a quote opening over the push; nesting doubled the text at each level
  assert.deepStrictEqual(r11Subs(`eval "$(echo "x=1 # $(echo '"') " ; echo "git push")"`), ['push']);
  assert.deepStrictEqual(r11Subs('eval "$(echo "$(echo "git push")")"'), ['push']);
  let five = 'git push';
  for (let i = 0; i < 5; i++) five = `$(echo "${five}")`;
  assert.deepStrictEqual(r11Subs(`eval "${five}"`), ['push']);
  // a subshell inside the substitution prints to its output
  assert.deepStrictEqual(r11Subs('eval "$( (echo git push) )"'), ['push']);
});

test('carriedScripts: prints into one stream join as the shell joins them - echo ends its line, printf adds nothing (review 11, 2)', () => {
  for (const c of ["{ printf 'git '; echo push; } | sh", "eval \"$(printf git; printf ' push')\"", "( printf 'git '; printf 'push\\n' ) | bash", "{ echo -n 'git '; echo push; } | sh"])
    assert.deepStrictEqual(r11Subs(c), ['push'], c);
  assert.deepStrictEqual(r11Subs('{ echo git status; echo git push; } | sh'), ['status', 'push'], 'each echo still ends its line');
  assert.ok(r11Carried("{ printf 'rm -rf '; echo '~'; } | sh").some((t) => /^rm -rf ~$/m.test(t)), 'the rm the stream spells is carried');
});

test('carriedScripts: a group, loop, if or case piped to a shell is read whole, a redirect after it too (review 11, 3)', () => {
  for (const c of ['{ echo git push; } 2>/dev/null | sh', 'for r in origin; do echo "git push $r"; done | sh', 'if true; then echo git push; fi | sh',
    'case x in x) echo git push;; esac | sh', '( echo git push ) 2>/dev/null | sh', 'while false; do :; done; { if true; then echo git push; fi; } | bash',
    'for a in 1; do for b in 2; do echo git push; done; done | sh']) assert.deepStrictEqual(r11Subs(c), ['push'], c);
  assert.ok(r11Carried("{ echo 'rm -rf ~'; } 2>/dev/null | sh").some((t) => /^rm -rf ~$/m.test(t)));
  assert.ok(r11Carried('for d in ~; do echo "rm -rf $d"; done | sh').some((t) => /^rm -rf /m.test(t)));
  // what the condition runs is no print into the pipe
  assert.deepStrictEqual(r11Subs('if git diff --quiet; then echo ok; fi | sh'), ['diff']);
});

test('carriedScripts: a here-string or an unquoted heredoc body fed to a shell runs with each print in place (review 11, 4)', () => {
  for (const c of ['bash <<<"$(echo git push)"', 'sh <<< $(echo git push)', 'cat <<< "$(printf \'git push\')" | sh', 'sh <<E\n$(echo git push)\nE', 'bash <<E\n`echo git push`\nE'])
    assert.deepStrictEqual(r11Subs(c), ['push'], JSON.stringify(c));
  assert.ok(r11Carried('bash <<<"$(echo rm -rf \'~\')"').some((t) => /^rm -rf ~$/m.test(t)));
});

test('carriedScripts: printf and echo escapes, precision and width are read; a spec the reader does not model is unread (review 11, 5)', () => {
  for (const c of ["printf 'git\\x20push\\n' | sh", "printf '\\147it push\\n' | sh", "printf '%.3s push\\n' gitx | sh", "echo -e '\\x67it push' | sh",
    "eval \"$(printf 'git\\x20push')\"", "printf '%b' 'git\\x20push' | sh", "printf '%5s push\\n' git | sh", "printf '%-4spush\\n' git | sh",
    "printf '%c%s\\n' gx 'it push' | sh", "echo 'git push\\c; ignored' | sh", "printf 'git \\u0070ush\\n' | sh"])
    assert.deepStrictEqual(r11Subs(c), ['push'], c);
  assert.ok(r11Carried("printf 'rm -rf \\176\\n' | sh").some((t) => /^rm -rf ~$/m.test(t)));
  for (const c of ["printf '%*s' 3 'git push' | sh", "printf '%j' 'git push' | sh", "printf '%f git push' 1 | sh"]) assert.ok(r11Read(c), c);
  // %q quotes its argument so the shell reads it back as one word
  assert.deepStrictEqual(r11Subs("printf '%q' 'git push' | sh"), []);
  assert.deepStrictEqual(r11Subs("printf '%q %q\\n' git push | sh"), ['push']);
  // \c ends the output: nothing after it runs
  assert.deepStrictEqual(r11Subs("printf '%b' 'git status\\cgit push' | sh"), ['status']);
});

test('gitText: piped groups, subshells, stdin files and process substitutions read in linear time at 800,000 characters (review 11, 6)', () => {
  // Each print, group and stdin file was matched by a walk over every earlier command: near 10 s at 400,000 characters,
  // four times that at 800,000. Linear, each shape here runs well under 1 s; 8 s leaves room for a slow CI runner.
  for (const unit of ['{ echo a; } | sh; ', '( echo a ) | sh; ', 'echo a | sh /dev/stdin; ', 'source <(echo a); ', 'for i in 1; do echo a; done | sh; ']) {
    const text = unit.repeat(Math.ceil(800000 / unit.length)) + '\ngit push';
    const t0 = Date.now();
    const g = shell.gitText(text, process.cwd());
    const ms = Date.now() - t0;
    assert.ok(ms < 8000, `${JSON.stringify(unit)} took ${ms} ms`);
    assert.ok(g.unreadAt >= 0 || g.calls.some((x) => x.sub === 'push'), `${JSON.stringify(unit)}: the trailing push is read or unread`);
  }
});

test('carriedScripts: zsh glob qualifiers and the (e) flag run code - their text is carried (review 11, 7)', () => {
  for (const c of ["echo *(e:'git push':)", 'ls *(.e:"git push":)', "print -l *(oe:'git push':)", "a='$(git push)'; echo ${(e)a}"]) assert.ok(r11Read(c), c);
  assert.ok(r11Carried("echo *(e:'rm -rf ~':)").some((t) => /^rm -rf ~$/m.test(t)));
  assert.ok(r11Carried('echo *(+myfn)').some((t) => /^myfn\b/m.test(t)), 'a + qualifier runs the named function');
  // arrays, functions, substitutions and a plain qualifier are no code
  for (const c of ['a=(x y); git status', 'f() { git status; }', 'echo $(git status)', 'ls *(.) && git status', 'diff <(git status) x'])
    assert.deepStrictEqual(r11Carried(c).filter((t) => /git status/.test(t) && !/^git status$/m.test(t)), [], c);
});

test('carriedScripts: an unquoted substitution or variable as the command name runs its words - the shell splits them (new, 2026-11-05)', () => {
  for (const c of ['$(echo git push)', '`echo git push`', 'FOO=1 $(echo git) push', 'x="git push"; $x', 'sh <<\'E\'\n$(echo git push)\nE'])
    assert.deepStrictEqual(r11Subs(c), ['push'], JSON.stringify(c));
  // quoted, the output is one word - a command named `git push`, which no shell finds
  assert.deepStrictEqual(r11Subs('"$(echo git push)"'), []);
  // another program's output is not modelled, and stays as it was read
  assert.deepStrictEqual(r11Subs('"$(git rev-parse --show-toplevel)/x.sh"'), ['rev-parse']);
  // the words split out of an expansion are literal: a `;` is text, a `~` names no home, a quote inside the substitution
  // quotes nothing outside it - and a `/` in the value still names the root
  for (const c of ['x="git status; git push"; $x', '$(echo git status\\; git push)']) assert.ok(!r11Subs(c).includes('push'), c);
  assert.deepStrictEqual(r11Carried("$(echo rm -rf '~')").filter((t) => /^rm -rf ~$/m.test(t)), [], 'a ~ from an expansion is a file named ~');
  assert.ok(r11Carried("$(echo rm -rf '~')").some((t) => /^rm -rf '~'$/m.test(t)), 'the inner quotes leave the outer word unquoted');
  assert.ok(r11Carried('x="rm -rf /"; $x').some((t) => /^rm -rf \/$/m.test(t)), 'a command in a variable is carried whole');
  assert.ok(r11Carried('x="rm -rf *"; $x').some((t) => /^rm -rf \*$/m.test(t)), 'a glob in a split word still expands');
});
