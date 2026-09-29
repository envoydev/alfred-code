// Behavior tests for the commit/push gate fixes in family F of the 2026-09-22 audit remediation
// (docs/sessions-investigation/AUDIT/_fixmap.json, cluster 'F'): the receipt's probe-SCOPE check,
// the security-review-receipt honesty check, the no-ff merge-order guidance, and the bare
// `git add -N` guard. Each case pins a real measured defect - both directions, since a false
// positive here is as costly as the miss it replaces.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-commit-gate-'));

// Pin an empty account dir and a scratch project root for the whole run - a real machine's
// account settings and this checkout's own `.alfred/docs/hook-blocks/` must never be touched by
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
  const flow = path.join(dir, '.alfred', 'docs', 'flow');
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
  fs.mkdirSync(path.join(dir, '.alfred', 'docs', 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), forty());
  git('add', '-A'); git('commit', '-qm', 'docs: architecture notes');
  const docsHead = headOf(dir);
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(docsHead, { scope: null }));
  assert.equal(gateIn(dir, 'git push', { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }), 0,
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

// ---------------------------------------------------------------------------------------------
// 7. hidden characters on an added line (ECC comparison R9 - the Trojan Source class)
// ---------------------------------------------------------------------------------------------
// A bidi override, a tag-block character or a zero-width mark reads one way to the reviewer and
// another to the compiler or the model. Written as escapes: lint check 32 sweeps scripts/ too.
test('guard-ungated-commit: a hidden character on an added line blocks, a byte-0 BOM does not', () => {
  const clean = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-hidden-'));
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
    git('add', '-A'); git('commit', '-qm', 'seed');
    return { dir, git };
  };
  const RLO = '\u202E';
  const TAG_A = String.fromCodePoint(0xE0041);
  const BOM = '\uFEFF';

  for (const [name, text, hex] of [
    ['bidi.js', `const access = 'user${RLO} // admin';\n`, '202E'],
    ['tag.md', `Read me.${TAG_A}\n`, 'E0041'],
    ['zw.cs', `var is\u200BAdmin = false;\n`, '200B'],
    ['bom.cs', `using System;\nvar a = 1;${BOM}\n`, 'FEFF'],
  ]) {
    const { dir, git } = clean();
    fs.writeFileSync(path.join(dir, name), text);
    git('add', name);
    const r = gateFull(dir, 'git commit -m one');
    assert.equal(r.status, 2, `${name}: a hidden U+${hex} on an added line blocks`);
    assert.match(r.stderr, new RegExp(`${name.replace('.', '\\.')}:\\d+ - a hidden character U\\+${hex}`), `${name}: the hit names file, line and code point`);
    assert.match(r.stderr, /STAGED-SCAN-ALLOW/, `${name}: the same receipt route`);
  }

  const { dir, git } = clean();
  fs.writeFileSync(path.join(dir, 'setup.ps1'), `${BOM}Write-Host 'hi'\n`);
  fs.writeFileSync(path.join(dir, 'Program.cs'), `${BOM}using System;\nconst string Rlo = "\\u202E";\n`);
  git('add', '-A');   // two files, so the trivial-diff exemption keeps the commit gate out of it
  assert.equal(gateIn(dir, 'git commit -m bom'), 0, 'a byte-0 BOM (a .ps1, or an editor-written .cs) and an escape written as text pass');
  git('commit', '-qm', 'bom');

  fs.writeFileSync(path.join(dir, 'late.js'), `const s = 'x${RLO}y';\n`);
  assert.equal(gateIn(dir, 'git commit -m nothing-staged'), 0, 'an untracked file the commit does not take in is not scanned');
  assert.equal(gateIn(dir, 'git add -A && git commit -m late'), 2, 'a chained add takes it in, so it is scanned');
  const allow = path.join(dir, '.alfred', 'docs', 'flow', 'STAGED-SCAN-ALLOW');
  fs.mkdirSync(path.dirname(allow), { recursive: true });
  fs.writeFileSync(allow, 'late.js:1\n');
  assert.equal(gateIn(dir, 'git add -A && git commit -m late'), 0, 'the receipt naming the hit opens it');
});

// ---------------------------------------------------------------------------------------------
// the repo git runs in: a session whose shell sits in a git worktree of its project commits THERE
// ---------------------------------------------------------------------------------------------
test('guard-ungated-commit: a commit from a worktree is judged on the worktree, not the clean main checkout', () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-main-'));
  const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git(main, 'init', '-q'); git(main, 'config', 'user.email', 't@example.com'); git(main, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(main, 'a.txt'), 'seed\n');
  git(main, 'add', '-A'); git(main, 'commit', '-qm', 'seed');
  fs.appendFileSync(path.join(main, '.git', 'info', 'exclude'), '.claude/\n'); // as a set-up project ignores it
  const wt = path.join(main, '.claude', 'worktrees', 'feat');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(wt, f), forty());
  const inWorktree = (command) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, cwd: wt }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: main }, cwd: main,
  });
  assert.equal(inWorktree('git commit -am x').status, 2, 'the worktree diff is non-trivial - no receipt, blocked');
  writeReceipt(wt, 'COMMIT-GATE', ['VERIFIED the worktree change', 'authorized: "commit it"', `head: ${headOf(wt)}`,
    'spec: 3 files', 'live-probe: `npm test` 12/12'].join('\n') + '\n');
  assert.equal(inWorktree('git commit -am x').status, 0, 'the receipt in the worktree opens it');

  const sub = path.join(main, 'src');
  fs.mkdirSync(sub);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(main, f), forty());
  writeReceipt(main, 'COMMIT-GATE', ['VERIFIED the main change', 'authorized: "commit it"', `head: ${headOf(main)}`,
    'spec: 3 files', 'live-probe: `npm test` 12/12'].join('\n') + '\n');
  const fromSub = runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: sub }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: main }, cwd: main,
  });
  assert.equal(fromSub.status, 0, 'a subfolder of the project still reads the project receipt');
});

// ---------------------------------------------------------------------------------------------
// the staged scan reads what the commit takes in (2026-09-26 hooks review): a commit naming its
// paths, a spaced or non-ASCII name, and a file past the cap beside a real hit
// ---------------------------------------------------------------------------------------------
const TOKEN = ['ghp', '0123456789abcdefghij0123456789abcdef'].join('_');
const SCAN_BLOCK = /Blocked: the commit adds what must never land/;
function scanRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-scan-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.claude/\n');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  git('add', '-A'); git('commit', '-qm', 'seed');
  return { dir, git, write: (f, body) => fs.writeFileSync(path.join(dir, f), body) };
}

test('guard-ungated-commit: a commit naming paths is scanned for what git commits from them', () => {
  // `commitScope` read only -a and a chained add, so `git commit <path>` - which stages that path's
  // working tree itself - committed a credential literal with exit 0.
  const { dir, git, write } = scanRepo({ 'a.js': 'const a = 1;\n', 'b.js': 'const b = 1;\n' });
  write('a.js', `const a = '${TOKEN}';\n`);
  for (const c of ['git commit a.js -m x', 'git commit -m x -- a.js', 'git commit -o a.js -m x', 'git commit --only -m x a.js',
    'git commit -i a.js -m x', 'git commit --include -m "fix; wip" a.js']) {
    const r = gateFull(dir, c);
    assert.match(r.stderr, SCAN_BLOCK, `the named path's working tree is committed: ${c}`);
    assert.match(r.stderr, /a\.js:1 - a credential-shaped literal/, `and the hit is named: ${c}`);
  }
  write('b.js', 'const b = 2;\n');
  assert.doesNotMatch(gateFull(dir, 'git commit b.js -m x').stderr, SCAN_BLOCK, 'a path the commit does not name is not in it');
  write('c.js', 'debugger;\n'); git('add', 'c.js');
  assert.doesNotMatch(gateFull(dir, 'git commit b.js -m x').stderr, SCAN_BLOCK, '--only leaves the rest of the index out');
  assert.match(gateFull(dir, 'git commit -i b.js -m x').stderr, /c\.js:1 - a debugger statement/, '--include takes the index as well');
  assert.match(gateFull(dir, 'git commit -m x').stderr, /c\.js:1/, 'a plain commit takes the index');
});

test('guard-ungated-commit: a chained add of a quoted name, a spaced name and a non-ASCII name are scanned', () => {
  // The chained add was split on whitespace before unquoting, and git's `+++ b/my file.js<TAB>` header
  // kept its TAB, so the extension tests missed and a STAGED-SCAN-ALLOW line never matched.
  const { dir, git, write } = scanRepo();
  write('cfg file.js', `module.exports = '${TOKEN}';\n`);
  const chained = gateFull(dir, 'git add "cfg file.js" && git commit -m x');
  assert.match(chained.stderr, /cfg file\.js:1 - a credential-shaped literal/, 'the quoted path of a chained add is taken in');
  git('add', '-A');
  write('my file.js', 'debugger;\n'); write('café.js', 'debugger;\n'); write('my notes.md', `token ${TOKEN}\n`);
  git('add', '-A');
  const r = gateFull(dir, 'git commit -m x');
  assert.match(r.stderr, /my file\.js:1 - a debugger statement/, 'a spaced name keeps its extension');
  assert.match(r.stderr, /café\.js:1 - a debugger statement/, 'a non-ASCII name is read as written');
  assert.match(r.stderr, /my notes\.md:1 - a credential-shaped literal/);
  writeReceipt(dir, 'STAGED-SCAN-ALLOW', ['cfg file.js', 'my file.js:1', 'café.js:1', 'my notes.md:1'].join('\n') + '\n');
  assert.doesNotMatch(gateFull(dir, 'git commit -m x').stderr, SCAN_BLOCK, 'every hit named in the receipt - the scan opens');
});

test('guard-ungated-commit: a binary or oversize file is skipped, and a hit beside it still blocks', () => {
  // Over the 2MB cap the scan threw and returned no findings at all, so a credential in leak.js
  // committed beside one oversize (or binary, read raw as UTF-8) untracked file.
  const LIMIT = 2 * 1024 * 1024;
  const { dir, git, write } = scanRepo();
  write('huge.log', `token ${TOKEN}\n${'x'.repeat(LIMIT + 10)}\n`);
  write('blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\n${TOKEN}\n`)]));
  write('leak.js', `const t = '${TOKEN}';\n`);
  const loose = gateFull(dir, 'git add -A && git commit -m x');
  assert.match(loose.stderr, /leak\.js:1 - a credential-shaped literal/, 'the untracked hit beside them stands');
  assert.doesNotMatch(loose.stderr, /huge\.log|blob\.bin/, 'an oversize or binary file is skipped, not scanned');
  git('add', '-A');
  const staged = gateFull(dir, 'git commit -m x');
  assert.match(staged.stderr, /leak\.js:1 - a credential-shaped literal/, 'the staged hit beside them stands');
  assert.doesNotMatch(staged.stderr, /huge\.log|blob\.bin/, 'staged, they are skipped the same way');
  git('rm', '-q', '--cached', 'leak.js'); fs.rmSync(path.join(dir, 'leak.js'));
  assert.doesNotMatch(gateFull(dir, 'git commit -m x').stderr, SCAN_BLOCK, 'alone, a file past the cap is not scanned');
});

test('guard-ungated-commit: a joiner or mark a script needs is text, and the rest of the hidden class still blocks', () => {
  // `hidden-chars.js` flagged a README emoji built with a ZWJ and a Persian ZWNJ as 'write it as an
  // escape', which Markdown and JSON prose cannot do. The commit scan and lint check 32 share the class.
  const { dir, git, write } = scanRepo();
  write('README.md', 'Built by a \u{1F468}\u200D\u{1F4BB}.\n');
  write('fa.json', '{ "want": "می\u200Cخواهم" }\n');
  write('he.md', 'שלום\u200F.\n');
  write('ar.md', 'مرحبا\u061C.\n');
  git('add', '-A');
  assert.doesNotMatch(gateFull(dir, 'git commit -m x').stderr, SCAN_BLOCK, 'an emoji ZWJ, a Persian ZWNJ, an RLM and an Arabic letter mark pass');
  // U+061C, the Arabic letter mark, is a bidi mark like the RLM: text beside a letter, hidden elsewhere (2.1.5 M16).
  write('d.js', 'const ok = "a\u061Cb";\n'); git('add', 'd.js');
  assert.match(gateFull(dir, 'git commit -m x').stderr, /d\.js:1 - a hidden character U\+61C/, 'an Arabic letter mark between ASCII letters blocks');
  git('rm', '-q', '--cached', 'd.js'); fs.rmSync(path.join(dir, 'd.js'));
  for (const [name, text, hex] of [['a.js', 'const ab = "a\u200Db";\n', '200D'], ['b.md', 'text \u202E here\n', '202E'], ['c.md', 'zero\u200Bwidth\n', '200B']]) {
    write(name, text); git('add', name);
    assert.match(gateFull(dir, 'git commit -m x').stderr, new RegExp(`${name.replace('.', '\\.')}:1 - a hidden character U\\+${hex}`), `${name}: still blocks`);
    git('rm', '-q', '--cached', name); fs.rmSync(path.join(dir, name));
  }
});
