'use strict';
// The final review of the audit-fix branch (2026-10-30) replayed six shell-guard gaps the branch left or opened; fix
// seat FB closes them here, one block per fix, each with its legitimate twin:
// 1. a double-quoted carried line (`--with-sensitive -- "..."`, `bash -c "..."`) was judged as raw text - bash's
//    double-quote escapes (`\"`, `\$`, `\\`, a backtick) never undone, so `"bash -c \"rm -rf ~\""` passed;
// 2. runner spellings the carrier missed - the script through a variable (`node "$G"`), a node option taking a separate
//    value (`--disable-warning X`) - and the RUNNER_LINES_MAX cap that silently stopped judging;
// 3. the variable expander scanned every assignment on each lookup: quadratic, ~10s on a 112KB chain;
// 4. `declare -x` / `-px` / `typeset -x` (and bare `declare`) printed every exported value raw;
// 5. git's own regenerable leftovers (`.git/refs/original`, `.git/worktrees/<name>`, `.git/lfs/tmp`) blocked with no
//    route, a submodule's repo blocked without naming the safe one;
// 6. the print-verb table read a compressor's `-9c` as a file.
// Nothing here runs a dangerous command: each is stdin text to a hook, in mkdtemp folders removed after.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const DISPATCH = path.join(HOOKS, 'shell-guards.js');
const GUARD = path.join(HOOKS, 'guard-secret-value.js');
const shell = require(path.join(HOOKS, 'shell-writes.js'));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixpass-shell-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
for (const k of Object.keys(process.env))
  if (/^ALFRED_CODE_/.test(k) || k === 'CLAUDE_PLUGIN_ROOT' || k === 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE') delete process.env[k];

const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
// A set-up project: a git repo with the install stamp, a credential file and a build log.
function project(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(TMP, prefix)));
  git(dir, 'init', '-q', '-b', 'feature');
  git(dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
  fs.writeFileSync(path.join(dir, '.env'), `API_TOKEN=${'x0'.repeat(20)}\n`);
  fs.writeFileSync(path.join(dir, 'build.log'), 'log\n');
  return dir;
}
// The dispatcher's verdict on one Bash command: 2 (exit 2), 'deny', 'rewrite' or 0.
function fire(dir, command) {
  const r = spawnSync(process.execPath, [DISPATCH], {
    input: JSON.stringify({ session_id: 'fb', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir }),
    encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  let v = r.status === 2 ? 2 : 0;
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput || {};
    if (v === 0 && o.permissionDecision === 'deny') v = 'deny';
    else if (v === 0 && o.updatedInput) v = 'rewrite';
  } catch { /* no JSON */ }
  return { v, out: `${r.stderr}${r.stdout}`, stdout: r.stdout };
}
const runner = (line) => `node "${GUARD}" --with-sensitive -- ${line}`;

test('FB 1: a double-quoted carried line is judged as bash hands it on - its \\" \\$ \\\\ escapes undone', () => {
  const texts = (c) => shell.carriedScripts(c).map((s) => ({ text: s.text, mapped: s.mapped }));
  // the shared reader: the runner's line and a shell's -c string, dequoted when an escape is in it
  assert.deepStrictEqual(texts(runner('"bash -c \\"rm -rf ~\\""')).filter((s) => s.text.startsWith('bash')), [{ text: 'bash -c "rm -rf ~"', mapped: false }]);
  assert.deepStrictEqual(texts('bash -c "rm -rf \\"\\$HOME\\""'), [{ text: 'rm -rf "$HOME"', mapped: false }]);
  assert.deepStrictEqual(texts('sh -c "a \\\\ b \\`c\\`"'), [{ text: 'a \\ b `c`', mapped: false }]);
  assert.deepStrictEqual(texts('bash -c "echo hi"'), [{ text: 'echo hi', mapped: true }], 'no escape: the span still maps');
  assert.deepStrictEqual(texts('bash -c \'rm -rf \\"x\\"\''), [{ text: 'rm -rf \\"x\\"', mapped: true }], 'single quotes keep every backslash');
  const dir = project('fb1-');
  for (const [c, why] of [
    [runner('"bash -c \\"rm -rf ~\\""'), 'a shell inside the runner, its line escaped'],
    [runner('"cat \\".env\\""'), 'the credential file named in escaped quotes'],
    [runner('"rm -rf \\"\\$HOME\\""'), 'an escaped $HOME the runner\'s shell expands'],
    ['bash -c "rm -rf \\"\\$HOME\\""', 'the same gap in a plain bash -c (it predates the runner)'],
    [runner('\'bash -c "rm -rf ~"\''), 'the single-quoted control'],
  ]) assert.strictEqual(fire(dir, c).v, 2, `${why}: ${c}`);
  // the legitimate use: a stored key in an escaped header still runs, unrewritten
  const ok = fire(dir, runner('"curl -H \\"Authorization: Bearer $API_TOKEN\\" https://example.invalid"'));
  assert.strictEqual(ok.v, 0, ok.out);
  assert.strictEqual(fire(dir, runner('"npm test"')).v, 0, 'a safe line runs');
});

test('FB 2: every runner spelling is carried - a variable script, a node option with a value - and past the cap it blocks', () => {
  const texts = (c) => shell.carriedScripts(c).filter((s) => s.runner).map((s) => s.text);
  assert.deepStrictEqual(texts(`G="${GUARD}"; node "$G" --with-sensitive -- "rm -rf ~"`), ['rm -rf ~'], 'the script through a variable');
  assert.deepStrictEqual(texts(`node "$(ls -d ${GUARD} | tail -1)" --with-sensitive -- "cat .env"`), ['cat .env'], 'the script through a substitution');
  for (const opt of ['--disable-warning ExperimentalWarning', '--report-dir /tmp', '--openssl-config /dev/null', '--stack-size 900'])
    assert.deepStrictEqual(texts(`node ${opt} "${GUARD}" --with-sensitive -- "rm -rf ~"`), ['rm -rf ~'], `a node option with a separate value: ${opt}`);
  assert.deepStrictEqual(texts(`node -e "1" x --with-sensitive -- "y"`), [], 'an inline script is the runtime reader\'s');
  assert.deepStrictEqual(texts('node --with-sensitive -- "y"'), [], 'no script word: node itself rejects the flag');
  const dir = project('fb2-');
  for (const [c, why] of [
    [`G="${GUARD}"; node "$G" --with-sensitive -- "rm -rf ~"`, 'a variable script, an rm of home'],
    [`G="${GUARD}"; node "$G" --with-sensitive -- "cat .env"`, 'a variable script, a raw credential read'],
    [`node --disable-warning ExperimentalWarning "${GUARD}" --with-sensitive -- "rm -rf ~"`, '--disable-warning X'],
    [`node --report-dir ${TMP} "${GUARD}" --with-sensitive -- "rm -rf ~"`, '--report-dir X'],
    [`node --openssl-config /dev/null "${GUARD}" --with-sensitive -- "cat .env"`, '--openssl-config X'],
  ]) assert.strictEqual(fire(dir, c).v, 2, `${why}: ${c}`);
  // the cap: four lines are judged; a fifth is never let through unjudged
  const calls = (n, last) => Array.from({ length: n }, (_, i) => runner(i === n - 1 && last ? last : '"true"')).join('; ');
  assert.strictEqual(fire(dir, calls(5, '"cat .env"')).v, 2, 'four true lines then cat .env');
  const over = fire(dir, calls(5));
  assert.strictEqual(over.v, 2, 'five lines: one past the cap blocks');
  assert.match(over.out, /more than 4/, 'the denial names the cap');
  assert.strictEqual(fire(dir, calls(4)).v, 0, 'four lines: at the cap, judged and run');
  assert.strictEqual(fire(dir, calls(3)).v, 0, 'three lines: under the cap');
  // a runner nested past the carried-script depth is never let through unjudged
  const wrap = (s) => `sh -c '${s.replace(/'/g, "'\\''")}'`;
  assert.strictEqual(fire(dir, wrap(wrap(wrap(wrap(runner('"true"')))))).v, 2, 'a runner four shells deep');
  assert.strictEqual(fire(dir, wrap(runner('"true"'))).v, 0, 'a runner one shell deep runs');
  assert.strictEqual(fire(dir, runner('"npm test"')).v, 0, 'one legitimate call runs');
});

// A copy of `events` that counts each element read: the expander's work on the assignments, a count of work, never time.
function counted(events) {
  const box = { n: 0 };
  const proxy = new Proxy(events, { get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) box.n++; return Reflect.get(t, k, r); } });
  return { proxy, box };
}
test('FB 3: the variable expander reads each assignment once per command - linear work, not a scan per lookup', () => {
  const shape = (n) => `${'a=$b;b=$a; '.repeat(n)}rm -rf ${'$a '.repeat(n)}`;
  const work = (n) => {
    const cmd = shape(n);
    const P = shell.parseShell(cmd);
    const { proxy, box } = counted(P.assignEvents);
    P.assignEvents = proxy;
    const vars = shell.shellVars(P, { cwd: TMP, home: '/home/x' });
    const at = cmd.indexOf('rm -rf');
    for (let i = 0; i < n; i++) vars.expand('$a', at + 7 + i * 3);
    return { reads: box.n, events: proxy.length };
  };
  const small = work(500);
  const big = work(2000);
  assert.ok(small.reads <= 4 * small.events, `500 pairs: ${small.reads} reads of ${small.events} assignments - at most 4 per assignment`);
  assert.ok(big.reads <= 4 * big.events, `2,000 pairs: ${big.reads} reads of ${big.events} assignments`);
  assert.ok(big.reads / small.reads < 6, `4x the command, ${(big.reads / small.reads).toFixed(1)}x the work`);
  // what is resolved is unchanged: the newest literal before the word, a cycle unresolved, a prefix assignment no binding
  const cmd = 'A=/x; A=/y; B=$A/z; C=$D; D=$C; E=/e rm -rf $A $B $C $E';
  const vars = shell.shellVars(shell.parseShell(cmd), { cwd: TMP, home: '/home/x' });
  const at = cmd.indexOf('rm -rf');
  assert.deepStrictEqual(['$A', '$B', '$C', '$E', '~/q'].map((w) => vars.expand(w, at)), ['/y', '/y/z', '$C', '$E', '/home/x/q']);
  assert.strictEqual(vars.expand('$A', cmd.indexOf('A=/y')), '/x', 'a word before the second assignment reads the first');
});

test('FB 3: an 8,000-pair assignment chain over 8,000 rm operands is judged in seconds, not tens', () => {
  const dir = project('fb3-');
  const cmd = `${'a=$b;b=$a; '.repeat(8000)}rm -rf ${'$a '.repeat(8000)}`;
  const c0 = process.hrtime.bigint();
  const r = fire(dir, cmd);
  const ms = Number(process.hrtime.bigint() - c0) / 1e6;
  assert.notStrictEqual(r.v, null);
  // 10.2s on the branch tip before the fix; the bound is a sanity bound only - the work count above is the verdict
  assert.ok(ms < 5000, `judged in ${Math.round(ms)}ms`);
});

