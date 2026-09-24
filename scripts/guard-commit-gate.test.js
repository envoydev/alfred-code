// Behavior tests for the commit/push gate fixes in family F of the 2026-09-22 audit remediation
// (docs/sessions-investigation/AUDIT/_fixmap.json, cluster 'F'): the receipt's probe-SCOPE check,
// the security-review-receipt honesty check, the no-ff merge-order guidance, and the bare
// `git add -N` guard. Each case pins a real measured defect - both directions, since a false
// positive here is as costly as the miss it replaces.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-commit-gate-'));

// Pin an empty account dir and a scratch project root for the whole run - a real machine's
// account settings and this checkout's own `.claude/docs/hook-blocks/` must never be touched by
// a test run (the same containment guard-hooks.test.js's head applies).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.ALFRED_CODE_DEFAULT_CONTEXT_WINDOW;
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));

const runIn = (hook, payload, opts) =>
  spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });
const gateFull = (dir, command, env = {}) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command } }, {
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }, cwd: dir,
});
const gateIn = (dir, command, env = {}) => gateFull(dir, command, env).status;

function forty() { return Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'); }

// A dirty repo, no remote - for the COMMIT-GATE cases (mirrors guard-hooks.test.js's scratchRepo).
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), forty());
  return dir;
}

// A clone with a real upstream, so `git log @{u}..HEAD` / `git diff @{u}..HEAD` answer - the
// PUSH-GATE cases need both the nothing-to-publish exemption and the scope check's diff source.
function pushRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  spawnSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')], { encoding: 'utf8' });
  const dir = path.join(base, 'repo');
  spawnSync('git', ['clone', '-q', path.join(base, 'remote.git'), dir], { encoding: 'utf8' });
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
  return { dir, git };
}
const headOf = (dir) => spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

// The conformant PUSH-GATE body, and the pieces each case overrides.
function pushReceipt(head, over = {}) {
  return [
    over.first || 'VERIFIED the release',
    over.auth === null ? null : (over.auth || 'authorized: "push it"'),
    over.head === null ? null : `head: ${over.head || head}`,
    over.spec === null ? null : (over.spec || 'spec: 2 commits'),
    over.probe === null ? null : (over.probe || 'live-probe: `nx affected -t test` 40/40'),
    over.scope === null ? null : over.scope,
  ].filter((l) => l != null).join('\n') + '\n';
}
const writeReceipt = (dir, name, body) => {
  const flow = path.join(dir, '.claude', 'docs', 'flow');
  fs.mkdirSync(flow, { recursive: true });
  fs.writeFileSync(path.join(flow, name), body);
};

// ---------------------------------------------------------------------------------------------
// 1. gate-receipt-probe-scope
// ---------------------------------------------------------------------------------------------
test('guard-ungated-commit: a push whose diff spans two projects needs a scope: line that covers both', () => {
  const { dir, git } = pushRepo();
  fs.mkdirSync(path.join(dir, 'apps', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'consumer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'auth', 'a.ts'), forty());
  fs.writeFileSync(path.join(dir, 'apps', 'consumer', 'b.ts'), forty());
  git('add', '-A'); git('commit', '-qm', 'feat: auth + consumer');
  const head = headOf(dir);

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { scope: null }));
  const noScope = gateFull(dir, 'git push');
  assert.equal(noScope.status, 2, 'no scope: line at all - the probe ran something and never said what it covered');
  assert.match(noScope.stderr, /auth.*consumer|consumer.*auth/, 'names the touched projects');

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { scope: 'scope: nx test auth' }));
  const narrow = gateFull(dir, 'git push');
  assert.equal(narrow.status, 2, 'a probe scoped to one project against a two-project diff is blocked');
  assert.match(narrow.stderr, /consumer/, 'names the project the probe never ran');

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { scope: 'scope: nx test auth, nx build consumer' }));
  assert.equal(gateIn(dir, 'git push'), 0, 'a scope naming every touched project passes');

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { scope: 'scope: workspace' }));
  assert.equal(gateIn(dir, 'git push'), 0, 'a workspace-scope probe passes whatever the diff touches');
});

test('guard-ungated-commit: plain top-level folders are not projects - only a folder with its own manifest is', () => {
  const { dir, git } = pushRepo();
  // An ordinary repo: two top-level folders, no manifest of their own. A push spanning them is
  // workspace-wide by construction and must not demand a scope: line (this repo's own shape -
  // scripts/ + stack/ - would otherwise be gated on every push).
  for (const d of ['scripts', 'stack']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'f.js'), forty());
  }
  git('add', '-A'); git('commit', '-qm', 'chore: two folders');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { scope: null }));
  assert.equal(gateIn(dir, 'git push'), 0, 'folders without a manifest name no project');

  // Give each its own manifest and the same diff IS two projects.
  fs.writeFileSync(path.join(dir, 'scripts', 'package.json'), '{"name":"scripts"}\n');
  fs.writeFileSync(path.join(dir, 'stack', 'package.json'), '{"name":"stack"}\n');
  git('add', '-A'); git('commit', '-qm', 'chore: manifests');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { scope: null }));
  const gated = gateFull(dir, 'git push');
  assert.equal(gated.status, 2, 'two manifest-owning folders are two projects');
  assert.match(gated.stderr, /scripts|stack/, 'names them');
});

test('guard-ungated-commit: a pure docs diff, and a NOT RUN probe, are not scope-gated at all', () => {
  const { dir, git } = pushRepo();
  fs.mkdirSync(path.join(dir, '.claude', 'docs', 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), forty());
  git('add', '-A'); git('commit', '-qm', 'docs: architecture notes');
  const docsHead = headOf(dir);
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(docsHead, { scope: null }));
  assert.equal(gateIn(dir, 'git push', { ALFRED_CODE_DOCS_PATH: '.claude/docs' }), 0,
    'a docs-only diff touches no identifiable project - no scope: line required');

  fs.mkdirSync(path.join(dir, 'apps', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'consumer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'auth', 'a.ts'), forty());
  fs.writeFileSync(path.join(dir, 'apps', 'consumer', 'b.ts'), forty());
  git('add', '-A'); git('commit', '-qm', 'feat: auth + consumer');
  const head = headOf(dir);
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { scope: null, probe: 'live-probe: NOT RUN - no CI runner here' }));
  assert.equal(gateIn(dir, 'git push'), 0, 'a probe that ran nothing has nothing to scope - the base contract still gates NOT RUN honestly, just not on scope');
});

// ---------------------------------------------------------------------------------------------
// 2. security-review-receipt
// ---------------------------------------------------------------------------------------------
test('guard-ungated-commit: a VERIFIED security review must name its categories, not a bare no-findings nod', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const full = (first, over = {}) => [
    first,
    'authorized: "commit it"',
    `head: ${head}`,
    'spec: 3 files',
    'live-probe: `npm test` 12/12',
    over.security === undefined ? null : over.security,
    over.carried === undefined ? null : over.carried,
  ].filter((l) => l != null).join('\n') + '\n';

  writeReceipt(dir, 'COMMIT-GATE', full('VERIFIED inline security review (auth path, 0 findings)'));
  const bare = gateFull(dir, 'git commit -am x');
  assert.equal(bare.status, 2, 'a security review claim with no category rows is not a review');
  assert.match(bare.stderr, /security:/);

  writeReceipt(dir, 'COMMIT-GATE', full('VERIFIED inline security review', { security: 'security: no findings' }));
  assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a security: line that is just the same bare nod is still not a review');

  writeReceipt(dir, 'COMMIT-GATE', full('VERIFIED inline security review', { security: 'security: auth ok, secrets ok, injection ok, data-access n/a' }));
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'named category rows pass');

  writeReceipt(dir, 'COMMIT-GATE', full('VERIFIED security review carried from an earlier cycle', { carried: 'carried: cycle 4, reviewed 2026-09-20' }));
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a carried security review names its categories in the EARLIER session, not this one');

  writeReceipt(dir, 'COMMIT-GATE', full('VERIFIED the pre-commit checkpoint'));
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a receipt that never claims a security review is not held to this check at all');
});

// ---------------------------------------------------------------------------------------------
// 3. push-gate-merge-order
// ---------------------------------------------------------------------------------------------
test('guard-ungated-commit: a no-ff merge head must be the receipt\'s head, not the pre-merge tip', () => {
  const { dir, git } = pushRepo();
  const preMergeHead = headOf(dir);
  git('checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'work\n');
  git('add', '-A'); git('commit', '-qm', 'feature work');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-q', '-m', 'merge feature', 'feature');
  const mergeHead = headOf(dir);
  assert.notEqual(mergeHead, preMergeHead, 'the merge really did create a new head');

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(preMergeHead));
  assert.equal(gateIn(dir, 'git push'), 2, 'a receipt naming the pre-merge tip does not cover the actual publish head');

  writeReceipt(dir, 'PUSH-GATE', pushReceipt(mergeHead));
  assert.equal(gateIn(dir, 'git push'), 0, 'a receipt naming the merge commit itself passes');
});

// ---------------------------------------------------------------------------------------------
// 6. add-n-unchained (family E's one row, same hook)
// ---------------------------------------------------------------------------------------------
test('guard-ungated-commit: a bare `git add -N` with no chained reset is blocked', () => {
  const dir = scratchRepo();
  const blocked = gateFull(dir, 'git add -N .');
  assert.equal(blocked.status, 2, 'add -N alone leaves intent-to-add entries open');
  assert.match(blocked.stderr, /git reset -q/, 'names the remedy shape baseline-git.md:9 gives');

  assert.equal(gateIn(dir, 'git add -N . && git diff HEAD --stat; git reset -q'), 0,
    'the reset chained in the SAME call is the conformant scope-survey shape');
  assert.equal(gateIn(dir, 'git add -N . && git reset -q'), 0, 'any chained git reset clears the block');
  assert.equal(gateIn(dir, 'git add .'), 0, 'an ordinary add with no -N is untouched');
  assert.equal(gateIn(dir, 'git add -N src/new-file.ts'), 0,
    'intent-to-add on ONE named file is a deliberate staging move before `git add -p`, not the survey');
  assert.equal(gateIn(dir, 'git add --intent-to-add .'), 2, 'the long spelling of the whole-tree shape is the same defect');
  assert.equal(gateIn(dir, 'echo "run git add -N . then commit"'), 0, 'prose naming the shape is not the shape');
  assert.equal(gateIn(dir, "cat <<'EOF' > plan.md\nStep 1: git add -N .\nEOF"), 0, 'a heredoc body is data, not a command');

  const withCommit = gateFull(dir, 'git add -N . && git commit -am wip');
  assert.equal(withCommit.status, 2, 'the add -N check fires before the commit gate is even reached');
  assert.match(withCommit.stderr, /git reset -q/);
});
