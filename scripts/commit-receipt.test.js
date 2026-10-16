// habits-commit-checkpoint's receipt helper (hooks review 2026-10-16): every receipt it writes is fed to the REAL
// guard-ungated-commit hook, so a helper that drifts from the guard's own file set or field rules fails here.
const test = require('node:test');
// No inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'stack', 'skills', 'habits-commit-checkpoint', 'scripts', 'receipt.js');
const GUARD = path.join(__dirname, '..', 'stack', 'hooks', 'guard-ungated-commit.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-receipt-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));

const forty = () => Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
function repo({ remote = false } = {}) {
  const base = fs.mkdtempSync(path.join(TMP, 'r-'));
  let dir = base;
  if (remote) {
    spawnSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')]);
    dir = path.join(base, 'repo');
    spawnSync('git', ['clone', '-q', path.join(base, 'remote.git'), dir]);
  } else spawnSync('git', ['init', '-q', dir]);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  if (remote) { git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main'); }
  return { dir, git };
}
const helper = (dir, args, { cwd = dir, env = {} } = {}) =>
  spawnSync(process.execPath, [HELPER, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env } });
const guard = (dir, command, env = {}) => spawnSync(process.execPath, [GUARD], {
  input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'receipt-test', tool_name: 'Bash', tool_input: { command }, cwd: dir }),
  cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
});
const receiptOf = (dir, name = 'COMMIT-GATE', docs = '.alfred/docs') => fs.readFileSync(path.join(dir, docs, 'flow', name), 'utf8');
const COMMIT = ['commit', '--verified', 'the parser change', '--authorized', 'commit it', '--probe', 'npm test 12/12', '--format', 'npx prettier --check', '--findings', 'none'];

test('a staged subset: spec counts the index, and the guard takes the receipt', () => {
  const { dir, git } = repo();
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), forty());
  git('add', 'a.txt', 'b.txt');
  const r = helper(dir, COMMIT);
  assert.equal(r.status, 0, r.stderr);
  const body = receiptOf(dir);
  assert.match(body, /^spec: 2 files - a\.txt, b\.txt$/m);
  assert.match(body, new RegExp(`^head: ${git('rev-parse', 'HEAD').stdout.trim()}$`, 'm'));
  assert.match(body, /^format: npx prettier --check - clean over 2 staged files$/m);
  assert.equal(guard(dir, 'git commit -m x').status, 0, guard(dir, 'git commit -m x').stderr);
});

test('nothing staged: the whole tree, untracked files included - the receipt itself and the docs root left out', () => {
  const { dir } = repo();
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), forty());
  assert.equal(helper(dir, COMMIT).status, 0);
  assert.match(receiptOf(dir), /^spec: 3 files - a\.txt, b\.txt, c\.txt$/m);
  assert.equal(guard(dir, 'git add -A && git commit -m x').status, 0);
  // the same tree with a hand-counted spec one short is what the guard refused 12 times
  fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'flow', 'COMMIT-GATE'), receiptOf(dir).replace('spec: 3 files', 'spec: 2 files'));
  assert.equal(guard(dir, 'git add -A && git commit -m x').status, 2, 'the guard still holds a short count');
});

test('--all is commit -a; --paths is what a chained git add names', () => {
  const { dir } = repo();
  for (const f of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(dir, f), forty());
  spawnSync('git', ['-C', dir, 'add', 'b.txt']); spawnSync('git', ['-C', dir, 'commit', '-qm', 'b']);
  fs.writeFileSync(path.join(dir, 'b.txt'), `${forty()}\nmore\n`);
  fs.writeFileSync(path.join(dir, 'new.txt'), forty());
  assert.equal(helper(dir, [...COMMIT, '--all']).status, 0);
  assert.match(receiptOf(dir), /^spec: 2 files - a\.txt, b\.txt$/m, '-a takes tracked changes, not the untracked file');
  assert.equal(guard(dir, 'git commit -am x').status, 0);
  assert.equal(helper(dir, [...COMMIT, '--paths', 'a.txt', 'new.txt']).status, 0);
  assert.match(receiptOf(dir), /^spec: 2 files - a\.txt, new\.txt$/m);
  assert.equal(guard(dir, 'git add a.txt new.txt && git commit -m x').status, 0);
});

test('what was untracked when the session began stays out of the count', () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'old.txt'), forty());
  fs.writeFileSync(path.join(dir, 'a.txt'), forty());
  const flow = path.join(dir, '.alfred', 'docs', 'flow');
  fs.mkdirSync(flow, { recursive: true });
  fs.writeFileSync(path.join(flow, `untracked-at-start-${git('rev-parse', 'HEAD').stdout.trim()}`), 'old.txt\n');
  assert.equal(helper(dir, COMMIT).status, 0);
  assert.match(receiptOf(dir), /^spec: 1 file - a\.txt$/m);
});

test('refusals: a missing judgment line, a security claim with no categories, nothing to commit', () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'a.txt'), forty());
  const noFmt = helper(dir, COMMIT.filter((a, i) => a !== '--format' && COMMIT[i - 1] !== '--format'));
  assert.equal(noFmt.status, 2); assert.match(noFmt.stderr, /missing --format/);
  const noAuth = helper(dir, ['commit', '--verified', 'x', '--probe', 'p', '--format', 'f', '--findings', 'none']);
  assert.equal(noAuth.status, 2); assert.match(noAuth.stderr, /--authorized/);
  const sec = ['commit', '--verified', 'review + security review', ...COMMIT.slice(3)];
  const r = helper(dir, sec);
  assert.equal(r.status, 2); assert.match(r.stderr, /--security must name each category/);
  assert.ok(!fs.existsSync(path.join(dir, '.alfred', 'docs', 'flow', 'COMMIT-GATE')), 'a refusal writes nothing');
  assert.equal(helper(dir, [...sec, '--security', 'none']).status, 2, 'an empty verdict is no category');
  assert.equal(helper(dir, [...sec, '--security', 'auth ok, secrets ok, injection ok']).status, 0);
  assert.match(receiptOf(dir), /^security: auth ok, secrets ok, injection ok - over 1 files$/m);
  assert.equal(guard(dir, 'git add -A && git commit -m x').status, 0);
  const clean = repo();
  assert.equal(helper(clean.dir, COMMIT).status, 2, 'a clean tree takes in no file');
});

test('the user\'s words keep their own quotes, a waiver writes one line, and the answered form stands for a picked option', () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'a.txt'), forty());
  fs.writeFileSync(path.join(dir, 'b.txt'), forty());
  const quoted = COMMIT.map((a) => (a === 'commit it' ? 'commit the "parser" fix' : a));
  assert.equal(helper(dir, quoted).status, 0);
  assert.match(receiptOf(dir), /^authorized: “commit the "parser" fix”$/m);
  assert.equal(guard(dir, 'git add -A && git commit -m x').status, 0);
  assert.equal(helper(dir, ['commit', '--waived', 'skip the review, just commit']).status, 0);
  assert.equal(receiptOf(dir), 'WAIVED - "skip the review, just commit"\n');
  assert.equal(guard(dir, 'git add -A && git commit -m x').status, 0);
  const answered = ['commit', '--verified', 'the parser change', '--answered', 'Commit now', ...COMMIT.slice(5)];
  assert.equal(helper(dir, answered).status, 0);
  assert.match(receiptOf(dir), /^answered: Commit now$/m);
});

test('a subfolder, a moved docs root, --dry-run and clear', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'x.ts'), forty());
  assert.equal(helper(dir, COMMIT, { cwd: path.join(dir, 'src') }).status, 0);
  assert.match(receiptOf(dir), /^spec: 1 file - src\/x\.ts$/m, 'paths are repo-relative from any folder');
  const moved = { ALFRED_CODE_DOCS_PATH: 'docs/agent' };
  fs.rmSync(path.join(dir, '.alfred'), { recursive: true, force: true });
  assert.equal(helper(dir, COMMIT, { env: moved }).status, 0);
  assert.match(receiptOf(dir, 'COMMIT-GATE', 'docs/agent'), /^spec: 1 file - src\/x\.ts$/m, 'the moved docs root is out of the count too');
  assert.equal(guard(dir, 'git add -A && git commit -m x', moved).status, 0);
  const dry = helper(dir, [...COMMIT, '--dry-run'], { env: moved });
  assert.match(dry.stdout, /^would write/);
  assert.equal(helper(dir, ['clear', 'commit'], { env: moved }).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'agent', 'flow', 'COMMIT-GATE')));
  assert.equal(helper(dir, ['clear', 'commit'], { env: moved }).status, 0, 'clearing an absent receipt is fine');
});

test('push: commits and files going out, and scope required only past one project with a probe that ran', () => {
  const { dir, git } = repo({ remote: true });
  for (const p of ['apps/web/x.ts', 'apps/api/y.ts']) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), forty());
  }
  git('add', '-A'); git('commit', '-qm', 'two projects');
  const PUSH = ['push', '--verified', 'the release', '--authorized', 'push it', '--probe', 'nx affected -t test 40/40'];
  const r = helper(dir, PUSH);
  assert.equal(r.status, 2); assert.match(r.stderr, /touches (api, web|web, api) - --scope/);
  assert.match(helper(dir, [...PUSH, '--scope', 'web']).stderr, /misses api/);
  assert.equal(helper(dir, [...PUSH, '--probe', 'NOT RUN - CI runs it']).status, 0, 'a probe that ran nothing names no scope');
  assert.equal(helper(dir, [...PUSH, '--scope', 'workspace']).status, 0);
  const body = receiptOf(dir, 'PUSH-GATE');
  assert.match(body, /^spec: 1 commit, 2 files going out - apps\/api\/y\.ts, apps\/web\/x\.ts$/m);
  assert.match(body, /^scope: workspace$/m);
  assert.doesNotMatch(body, /^format:/m, 'a push receipt carries no format line');
  assert.equal(guard(dir, 'git push').status, 0, guard(dir, 'git push').stderr);
});
