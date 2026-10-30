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

