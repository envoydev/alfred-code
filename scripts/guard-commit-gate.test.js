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
  assert.match(blocked.stderr, /git reset -q/, 'names the remedy shape alfred-git.md:9 gives');

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

// ---------------------------------------------------------------------------------------------
// 2.1.6 H2: the receipt's spec: and the trivial bar are measured against what THIS commit takes in
// (the index plus what -a, a chained add or the named paths take in), not the whole tree. The A/B runs
// hit 'the tree has M uncommitted' in 12 of 12 PR runs and 3 stopped: narrowing the commit never helped.
// ---------------------------------------------------------------------------------------------
const FORTY = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
function specRepo() {
  const r = scanRepo({ 'a.txt': 'seed\n', 'b.txt': 'seed\n', 'c.txt': 'seed\n', 'd.txt': 'seed\n' });
  const spec = (n) => writeReceipt(r.dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', 'authorized: "commit it"',
    `head: ${headOf(r.dir)}`, `spec: ${n}`, 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
  return { ...r, spec };
}

test('guard-ungated-commit: spec: counts the files this commit takes in, not the rest of the tree (2.1.6 H2)', () => {
  const { dir, git, write, spec } = specRepo();
  write('a.txt', FORTY); write('b.txt', FORTY); git('add', 'a.txt', 'b.txt');
  write('d.txt', FORTY); // unrelated dirty work, left out of this commit
  spec('2 files - a.txt, b.txt');
  const two = gateFull(dir, 'git commit -m x');
  assert.strictEqual(two.status, 0, `two staged files beside one unrelated dirty file: ${two.stderr}`);
  write('c.txt', FORTY); git('add', 'c.txt');
  const three = gateFull(dir, 'git commit -m x');
  assert.strictEqual(three.status, 2, 'three staged against a two-file spec still blocks');
  assert.match(three.stderr, /spec: claims 2 file\(s\) but this commit takes in 3/, 'the denial names what the commit takes in');
  assert.strictEqual(gateFull(dir, 'git commit -m x -- a.txt b.txt').status, 0, 'naming two paths narrows the commit to them');
  assert.strictEqual(gateFull(dir, 'git commit -i d.txt -m x').status, 2, '--include takes the index and the named path');
});

test('guard-ungated-commit: -a and a chained add widen the counted set by what they take in (2.1.6 H2)', () => {
  const { dir, write, spec } = specRepo();
  write('a.txt', FORTY); write('b.txt', FORTY); write('c.txt', FORTY);
  write('new.txt', FORTY); // untracked - -a never takes it
  spec('2 files');
  assert.strictEqual(gateFull(dir, 'git commit -am x').status, 2, '-a counts the three dirty tracked files');
  spec('3 files');
  const all = gateFull(dir, 'git commit -am x');
  assert.strictEqual(all.status, 0, `-a leaves the untracked file out: ${all.stderr}`);
  spec('3 files');
  const added = gateFull(dir, 'git add new.txt && git commit -am x');
  assert.strictEqual(added.status, 2, 'a chained add of new.txt counts it');
  assert.match(added.stderr, /this commit takes in 4/);
  spec('1 file');
  assert.strictEqual(gateFull(dir, 'git add new.txt && git commit -m x -- new.txt').status, 0, 'git add x && git commit x counts x alone');
});

test('guard-ungated-commit: a commit the guard cannot read the set of is measured on the whole tree (2.1.6 H2)', () => {
  const { dir, git, write, spec } = specRepo();
  write('a.txt', FORTY); git('add', 'a.txt');
  write('b.txt', FORTY); // dirty, unstaged
  spec('1 file');
  assert.strictEqual(gateFull(dir, 'git commit -m x').status, 0, 'the index alone is one file');
  const moved = gateFull(dir, 'git rm -q c.txt && git commit -m x');
  assert.strictEqual(moved.status, 2, 'a chained git rm moves the index in a way the guard cannot see before it runs');
  assert.match(moved.stderr, /this commit takes in 2/, '... so the whole tree is counted, as before');
  assert.strictEqual(gateFull(dir, 'C=commit; git $C -m x').status, 2, 'an opaque subcommand is counted on the whole tree');
});

test('guard-ungated-commit: with no session start to read, the trivial bar is the whole tree (2.1.6 review M2)', () => {
  // The review split a 60-line feature into six `git add featN.js && git commit` steps: the base gated all six, a
  // bar measured on each commit passed all six. The bar is cumulative per session (session-scope.test.js); a payload
  // with no session record falls back to the whole tree, where a slice gates and so does a staged one-liner beside
  // unrelated dirty work.
  const { dir, git, write } = specRepo();
  for (let n = 1; n <= 6; n++) write(`feat${n}.js`, Array.from({ length: 10 }, (_, i) => `f${n}_${i}`).join('\n') + '\n');
  assert.strictEqual(gateFull(dir, 'git add feat1.js && git commit -m "feat: part 1"').status, 2, 'one 10-line slice of a 60-line change gates');
  for (let n = 1; n <= 6; n++) fs.rmSync(path.join(dir, `feat${n}.js`));
  write('d.txt', FORTY); // a big unrelated edit, not in this commit
  write('a.txt', 'seed\nfix\n'); git('add', 'a.txt');
  assert.strictEqual(gateFull(dir, 'git commit -m typo').status, 2, 'with no session start, a staged one-liner beside a big unrelated edit gates');
  git('checkout', '--', 'd.txt');
  assert.strictEqual(gateFull(dir, 'git commit -m typo').status, 0, 'alone in the tree, the one-liner is trivial');
});

// ---------------------------------------------------------------------------------------------
// 2.1.6 review B1: every path an add or a commit names is placed where ITS git call runs - the payload cwd, a cd
// before it, its own -C - and a path the guard cannot place (a word the shell expands, an add fed by xargs, an
// interactive add or commit) sends the count to the whole tree. Placed from the repo top instead, a subfolder path
// matched nothing: 11 commit shapes passed with no receipt and a 1-file spec covered a 2-file commit.
// ---------------------------------------------------------------------------------------------
const nLines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + '\n';
function b1Repo() {
  const r = scanRepo({ 'a.js': nLines(10, 'old'), 'one.js': 'one\n', 'c.js': 'c\n' });
  fs.mkdirSync(path.join(r.dir, 'sub'));
  r.write('sub/big.js', nLines(100, 'old')); r.write('sub/two.js', nLines(50, 'old'));
  r.git('add', '-A'); r.git('commit', '-qm', 'sub');
  r.write('sub/big.js', nLines(100, 'new')); r.write('sub/two.js', nLines(50, 'new'));
  r.write('a.js', nLines(10, 'new')); r.write('one.js', 'one\ntwo\n'); r.write('new1.js', nLines(40, 'n'));
  // the tree: sub/big.js, sub/two.js, a.js, one.js and the untracked new1.js - 5 files
  const at = (cwd, command) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, cwd: path.join(r.dir, cwd) },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: r.dir }, cwd: r.dir });
  const spec = (n) => writeReceipt(r.dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', 'authorized: "commit it"', `head: ${headOf(r.dir)}`,
    `spec: ${n}`, 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
  return { ...r, at, spec };
}
const B1_ROWS = [
  // [id, payload cwd, command, what this commit takes in]
  ['T1', 'sub', 'git add big.js && git commit -m x', 1],
  ['T2', '.', 'cd sub && git add big.js && git commit -m x', 1],
  ['T3', 'sub', 'git commit -m x -- big.js', 1],
  ['T4', 'sub', 'git commit -m x big.js two.js', 2],
  ['T5', '.', 'git -C sub add big.js && git -C sub commit -m x', 1],
  ['T6', '.', 'git diff --name-only | xargs git add && git commit -m x', 5],
  ['T7', '.', 'git add $(git diff --name-only) && git commit -m x', 5],
  ['T8', '.', 'F=sub/big.js; git add "$F" && git commit -m x', 5],
  ['T9', '.', 'F=sub/big.js; git commit -m x -- "$F"', 5],
  ['T10', '.', 'yes | git commit -p -m x', 5],
  ['T11', '.', 'yes | git add -p && git commit -m x', 5],
];
for (const [id, cwd, command, takes] of B1_ROWS) {
  test(`guard-ungated-commit: ${id} - \`${command}\` from ${cwd === '.' ? 'the root' : cwd} is gated, and counted as ${takes} (2.1.6 review B1)`, () => {
    const r = b1Repo();
    assert.strictEqual(r.at(cwd, command).status, 2, 'no receipt: the commit is gated');
    r.spec('0 files');
    const probe = r.at(cwd, command);
    assert.strictEqual(probe.status, 2);
    assert.match(probe.stderr, new RegExp(`this commit takes in ${takes} `), `the set this commit takes in: ${takes}`);
  });
}
test('guard-ungated-commit: S2-S4 - a 1-file spec does not cover a 2-file commit named from a subfolder or fed by xargs (2.1.6 review B1)', () => {
  const r = b1Repo();
  r.spec('1 file');
  for (const [id, cwd, command, takes] of [['S2', '.', 'cd sub && git add big.js two.js && git commit -m x', 2],
    ['S3', 'sub', 'git commit -m x -- big.js two.js', 2], ['S4', '.', 'git diff --name-only | xargs git add && git commit -m x', 5]]) {
    const out = r.at(cwd, command);
    assert.strictEqual(out.status, 2, `${id}: blocked`);
    assert.match(out.stderr, new RegExp(`spec: claims 1 file\\(s\\) but this commit takes in ${takes} `), `${id}: counted as ${takes}`);
  }
  r.spec('2 files');
  assert.strictEqual(r.at('sub', 'git commit -m x -- big.js two.js').status, 0, 'a spec covering the two named files passes');
});
test('guard-ungated-commit: named paths that resolve to nothing while the tree is dirty count the whole tree (2.1.6 review B1)', () => {
  const r = b1Repo();
  r.spec('0 files');
  assert.match(r.at('.', 'git commit -m x -- sub/nosuch.js').stderr, /this commit takes in 5 /, 'the backstop');
});

// 2.1.6 H3: the commit checkpoint fires on 'open the PR', but the receipt's consent verbs did not read a pull request
// being opened - a user's own 'open the PR' was refused as consent. A bare mention of a PR still asks for nothing.
test('guard-ungated-commit: opening a pull request is consent to publish, a bare PR mention is not (2.1.6 H3)', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => {
    writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` }));
    return gateIn(dir, 'git push');
  };
  // the real asks - m2 (review-216-hooks.md): a word between the article and the noun, and 'up' after the verb
  for (const words of ['open the PR', 'open a PR', 'create a pull request', 'raise a PR', 'raise a PR for it', 'please submit the pull request',
    'opening the PR now is fine', 'go ahead and open the pull request', 'open a draft PR', 'open up a PR', 'raise a new PR',
    'відкрий PR', 'створи пул-реквест', 'открой пулл-реквест', 'создай PR', 'відкрий новий PR', 'создай новый PR']) {
    assert.strictEqual(push(words), 0, `consent: ${words}`);
  }
  // m1: the review's 18 sentences about a PR that ask for nothing - an editing verb (make, file), the noun followed by
  // what is ABOUT the PR, a question, a negation, and every adjectival or negated Ukrainian / Russian form
  for (const words of ['the PR is open', 'did you open the PR?', "don't open a PR", 'PR review', 'open the PR in the browser',
    'make the PR description shorter', 'create a PR template', 'file a PR comment on line 4', 'look at the PR',
    'never open a pull request for this', 'не відкривай PR', 'у відкритому PR помилка', 'подальший PR додасть тести',
    'створений PR має конфлікт', 'в открытом PR ошибка', 'не открывай PR', 'созданный PR упал', 'откройте PR в браузере, я гляну',
    'PR', 'what does the PR say?', 'the pull request looks odd', 'open the file', 'відкрий файл', 'посмотри PR']) {
    assert.strictEqual(push(words), 2, `no consent: ${words}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 2.1.6 review T20: a git ALIAS runs another git command (or, with `!`, a shell command) and git resolves it before
// it runs - `git ci -m x` with `alias.ci = commit` committed ungated on both trees. The guard now expands an alias
// the way git does, where the call runs, before any check reads the command.
// ---------------------------------------------------------------------------------------------
function aliasRepo(aliases) {
  const r = scanRepo({ 'a.js': nLines(10, 'old') });
  for (const [name, value] of Object.entries(aliases)) r.git('config', `alias.${name}`, value);
  r.write('a.js', nLines(10, 'new')); r.write('b.js', nLines(40, 'b')); r.git('add', 'a.js', 'b.js'); // 2 files, 60 lines staged
  return r;
}
test('guard-ungated-commit: a git alias for commit is judged as the commit it runs (2.1.6 review T20)', () => {
  const { dir } = aliasRepo({ ci: 'commit', cm: 'commit -m', c: 'ci', st: 'status' });
  assert.strictEqual(gateIn(dir, 'git ci -m x'), 2, 'alias.ci = commit');
  assert.strictEqual(gateIn(dir, 'git cm "feat: x"'), 2, 'an alias carrying its own arguments (co-style)');
  assert.strictEqual(gateIn(dir, 'git c -m x'), 2, 'an alias of an alias');
  assert.strictEqual(gateIn(dir, 'cd . && git -c core.pager=cat ci -m x'), 2, 'behind a cd and a global flag');
  assert.strictEqual(gateIn(dir, 'git st'), 0, 'an alias for a read runs as the read');
  assert.strictEqual(gateIn(dir, 'git frobnicate'), 0, 'a word that is no alias stays what it was');
});
test('guard-ungated-commit: a git alias for push or add is judged as what it runs (2.1.6 review T20)', () => {
  const { dir, write } = aliasRepo({ p: 'push', a: 'add', ci: 'commit' });
  assert.strictEqual(gateIn(dir, 'git p'), 2, 'alias.p = push - the publish gate');
  write('c.js', nLines(5, 'c'));
  writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', 'authorized: "commit it"', `head: ${headOf(dir)}`, 'spec: 2 files', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
  const added = gateFull(dir, 'git a c.js && git ci -m x');
  assert.strictEqual(added.status, 2, 'the aliased add takes c.js in');
  assert.match(added.stderr, /this commit takes in 3 /);
});
test('guard-ungated-commit: a ! shell alias is judged as the command it runs, and one that cannot be read gates (2.1.6 review T20)', () => {
  const { dir } = aliasRepo({ save: '!git add -A && git commit -m wip', run: '!f() { git "$@"; }; f', hi: '!echo hi' });
  assert.strictEqual(gateIn(dir, 'git save'), 2, 'the shell alias commits');
  assert.strictEqual(gateIn(dir, 'git run commit -m x'), 2, 'its git subcommand is a variable: unjudgeable, gated like a commit');
  assert.strictEqual(gateIn(dir, 'git hi'), 0, 'a shell alias that commits nothing passes');
  // a lookup git cannot answer (anything but 0 or 1 - 1 is 'no such alias') fails closed: the call gates as a commit
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'git-stub-'));
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase "$*" in *"config"*"alias"*) exit 128;; esac\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  assert.strictEqual(gateIn(dir, 'git ci -m x', { PATH: `${bin}${path.delimiter}${process.env.PATH}` }), 2, 'an alias lookup that fails gates');
  assert.strictEqual(gateIn(dir, 'git status', { PATH: `${bin}${path.delimiter}${process.env.PATH}` }), 0, 'a builtin needs no lookup');
  fs.rmSync(bin, { recursive: true, force: true });
});

// 2.1.6 review re-verify N2: alias expansion failed open on hostile shapes, and a commit inside a script handed to a
// shell was quoted text to the guard. N4 (its shell half): a literal script piped to a shell is judged as the commands
// it carries.
test('guard-ungated-commit: a git call inside a script handed to a shell is judged (2.1.6 re-verify N2, N4)', () => {
  const { dir } = aliasRepo({ sv: "!sh -c 'git add -A && git commit -m wip'" });
  assert.strictEqual(gateIn(dir, 'git sv'), 2, 'a ! alias running sh -c whose script commits');
  assert.strictEqual(gateIn(dir, "bash -c 'git commit -m x'"), 2, 'bash -c typed directly');
  assert.strictEqual(gateIn(dir, "echo 'git commit -m x' | sh"), 2, 'a literal piped to sh');
  assert.strictEqual(gateIn(dir, "sh <<'EOF'\ngit commit -m x\nEOF"), 2, 'a heredoc into sh');
  assert.strictEqual(gateIn(dir, "echo 'git commit -m x'"), 0, 'an echo alone runs nothing');
  assert.strictEqual(gateIn(dir, "docker exec app sh -c 'git commit -m x'"), 0, 'a script that runs elsewhere is not this repo');
});
test('guard-ungated-commit: an alias past the walk gates, and one set on the command line or in the environment is read (2.1.6 re-verify N2)', () => {
  const chain = { c7: 'commit' };
  for (let n = 1; n < 7; n++) chain[`c${n}`] = `c${n + 1}`;
  const { dir } = aliasRepo(chain);
  assert.strictEqual(gateIn(dir, 'git c1 -m x'), 2, 'a 7-deep chain: past the bound the call gates, unread');
  assert.strictEqual(gateIn(dir, 'git -c alias.zz=commit zz -m x'), 2, 'an alias set with -c on the call');
  assert.strictEqual(gateIn(dir, 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.zz GIT_CONFIG_VALUE_0=commit git zz -m x'), 2, 'GIT_CONFIG_* in front of the call');
  assert.strictEqual(gateIn(dir, "GIT_CONFIG_PARAMETERS=\"'alias.zz=commit'\" git zz -m x"), 2, 'GIT_CONFIG_PARAMETERS in front of the call');
  assert.strictEqual(gateIn(dir, 'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.zz GIT_CONFIG_VALUE_0=commit; git zz -m x'), 2, 'exported earlier in the command');
  assert.strictEqual(gateIn(dir, 'git -c alias.zz=status zz'), 0, 'a -c alias for a read runs as the read');
  assert.strictEqual(gateIn(dir, 'git c7'), 2, 'the chain end itself is the commit');
});

// 2.1.6 review re-verify N3: three negated statements still read as consent, and three asks were refused - "let's"
// cut at its apostrophe, and the imperfective imperatives.
test('guard-ungated-commit: consent reads the whole quote, and a negation or a question in its clause refuses it (2.1.6 re-verify N3)', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => {
    writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` }));
    return gateIn(dir, 'git push');
  };
  for (const words of ["let's open a PR", 'Открывай PR', 'відкривай PR', 'push it, no need to wait for CI', 'yes, open the PR']) {
    assert.strictEqual(push(words), 0, `consent: ${words}`);
  }
  for (const words of ['I do not think we should open a PR yet', 'no need to open a PR', 'open a PR? not yet', "don't push yet",
    'never commit this', 'не пуш поки', 'не открывай PR']) {
    assert.strictEqual(push(words), 2, `no consent: ${words}`);
  }
});

// 2.1.6 re-verify 2 R2-M3: the N3 reading refused real consent - a deferral anywhere refused the whole quote, and a
// clause ran across a spaced dash or 'but' ('commit now, push later', 'no need to ask - just commit it', 'не забудь
// закомітити') - while 23 of 24 refusals still read as consent ('push is not needed', 'stop committing', 'why did you
// push?', 'hold the commit'). The reviewer's 46 quotes through a real receipt and `git commit -am x`. R2-m4: the three
// holdouts its fix still read as consent. And consent is per gate class: 'commit it, don't push' opens the commit only.
const R2_CONSENTS = ['commit now, push later', "commit it, I'll open the PR later", 'no need to ask - just commit it', 'No problem - commit it',
  'never mind the lint warning - push it', 'not sure about the name but commit it', 'no issues - ship it', 'commit and push; we can tidy up later',
  'не забудь закомітити', 'не питай - просто коміть', 'закоміть зараз, а пуш пізніше', 'Не чекай CI - мерж', 'коміть, PR відкриємо пізніше',
  'не жди CI - мержи', 'коммить сейчас, пуш позже', 'Нет проблем - пушь', "don't forget to commit", "I don't mind - push it",
  'не забудь закоммитить', 'не спрашивай - просто коммить', 'commit it', 'go ahead and push'];
const R2_REFUSALS = ['push is not needed', "commit isn't what I asked for", 'committing now would be a mistake', 'stop committing',
  'stop pushing to main', 'why did you push?', 'who told you to commit?', 'commit after I review it', 'push tomorrow, not today',
  'yes, but do not commit', 'hold the commit', 'wait with the push', 'the commit message has a typo', 'пушити не треба', 'коміт поки не робимо',
  'з пушем зачекай', 'мерж завтра', 'давай ще раз перевіримо тести', 'так, але не коміть', 'пушить не надо', 'давай ещё раз проверим тесты',
  'да, но не коммить', 'зачем ты запушил?', 'коммит пока не делаем'];
const R2_HOLDOUT_REFUSALS = ['I will commit it myself', 'пуш не потрібен', 'commit is broken'];
test('guard-ungated-commit: consent is read per clause and per gate - 46 quotes through a real commit (2.1.6 re-verify 2 R2-M3, R2-m4)', () => {
  assert.equal(R2_CONSENTS.length + R2_REFUSALS.length, 46);
  const dir = scratchRepo();
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${headOf(dir)}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
    return gateIn(dir, 'git commit -am x');
  };
  const wrong = [];
  for (const words of R2_CONSENTS) if (commit(words) !== 0) wrong.push(`refused: ${words}`);
  for (const words of [...R2_REFUSALS, ...R2_HOLDOUT_REFUSALS]) if (commit(words) !== 2) wrong.push(`accepted: ${words}`);
  assert.deepStrictEqual(wrong, []);
});
test('guard-ungated-commit: a negated verb of the gate\'s own class refuses that gate only (2.1.6 re-verify 2 R2-M3)', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => { writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` })); return gateIn(dir, 'git push'); };
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
    return gateIn(dir, 'git commit -am x');
  };
  assert.strictEqual(commit("commit it, don't push"), 0, 'the commit is asked for');
  assert.strictEqual(push("commit it, don't push"), 2, '... and the push refused');
  assert.strictEqual(push('yes, but never force-push'), 2, 'a refused force-push refuses the push gate');
  assert.strictEqual(commit('yes, but never force-push'), 0, '... and leaves the commit consented');
  assert.strictEqual(push('open the PR, but do not merge it'), 2, 'a refused merge refuses the push gate');
  assert.strictEqual(push('I will push it myself'), 2, 'the user keeping the act is no consent to it');
  assert.strictEqual(push('сам запушу'), 2, '... in Ukrainian and Russian too');
  assert.strictEqual(push('push is fine'), 0, 'a verb followed by a positive state is consent');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "commit it, don't push"` }));
  assert.match(gateFull(dir, 'git push').stderr, /carries no publish verb left standing \(push, merge, release, ship\) and opens no pull request/, 'the push gate names its own verb class');
  writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "push it, don't commit"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
  assert.match(gateFull(dir, 'git commit -am x').stderr, /carries no commit verb left standing/, 'the commit gate names its own');
});

// 2.1.6 re-verify 3 R3-M1: a consent for one gate opened the other - a standing commit verb consented to a push
// ('commit it' in a PUSH-GATE receipt) - and a bare 'no' after the verb was not read ('commit yes, push no'). R3-m1:
// the Ukrainian and Russian publish verbs were no consent verbs at all. 'push after CI' names a condition that holds
// only after the push (CI runs on it), so it consents to nothing now. Each phrase is judged on both gates:
// [words, COMMIT-GATE, PUSH-GATE], 0 = consent, 2 = refused - 41 phrases, 82 per-gate cells.
const R3_PER_GATE = [
  // a commit-only answer opens the commit and never the push (12)
  ['commit it', 0, 2], ['go ahead and commit', 0, 2], ['yes, commit this', 0, 2], ['закоміть', 0, 2], ['закоміть це', 0, 2],
  ['зроби коміт', 0, 2], ['закоммить', 0, 2], ['сделай коммит', 0, 2], ['commit it and stop there', 0, 2], ['commit only', 0, 2],
  ['тільки коміт', 0, 2], ['только коммит', 0, 2],
  // a bare no after the verb answers it (5)
  ['commit yes, push no', 0, 2], ['коміт так, пуш ні', 0, 2], ['коммит да, пуш нет', 0, 2], ['commit no, push yes', 2, 0], ['коміт ні', 2, 2],
  // the Ukrainian and Russian publish verbs (6) - a push takes the commit with it, so the commit gate reads them too
  ['мерджи', 0, 0], ['залий', 0, 0], ['залей', 0, 0], ['влей в main', 0, 0], ['викоти', 0, 0], ['выкати', 0, 0],
  // a publish conditioned on CI, which runs on the push itself (1)
  ['push after CI', 2, 2],
  // the rest of the grid (17)
  ['yes', 0, 0], ['go ahead', 0, 0], ['push it', 0, 0], ['commit and push', 0, 0], ['ship it', 0, 0], ['merge it', 0, 0],
  ['open the PR', 0, 0], ['запуш', 0, 0], ['запушь', 0, 0], ['так, пуш', 0, 0], ['давай', 0, 0], ['approved', 0, 0],
  ["commit it, don't push", 0, 2], ["push it, don't commit", 2, 0], ['do not push', 2, 2], ['не коміть', 2, 2],
  ['yes, commit and open a PR', 0, 0],
];
// The implementer's own 36 holdout phrases (re-verify 2), both gates - the commit-only ones now refuse the push, and a
// publish conditioned on CI consents to nothing.
const R2_HOLDOUT_PER_GATE = [
  ['ok, commit', 0, 2], ['go ahead and commit', 0, 2], ['looks good, commit and push', 0, 0], ['sure - push it', 0, 0],
  ['please merge it', 0, 0], ['коміть', 0, 2], ['пуш', 0, 0], ['давай, коммить', 0, 2], ['так, пуш', 0, 0],
  ['commit it now', 0, 2], ['yes', 0, 0], ['approved', 0, 0], ['do the commit', 0, 2], ['make a commit and push it', 0, 0],
  ['Stop the dev server and commit', 0, 2], ['tests pass, so push', 0, 0], ['закомить и запушь', 0, 0], ['коммить и пушь', 0, 0],
  ['commit it yourself', 0, 2], ['push when CI is green', 2, 2],
  ["don't commit yet", 2, 2], ['do not push', 2, 2], ['no commit today', 2, 2], ['never push to main', 2, 2],
  ['the push failed', 2, 2], ['was the commit signed?', 2, 2], ['I will push it later', 2, 2], ['не коміть', 2, 2],
  ['не пуш', 2, 2], ['пуш потім', 2, 2], ['commit? no', 2, 2], ['hold off on the push', 2, 2], ['stop pushing', 2, 2],
  ['who pushed this?', 2, 2], ['I committed it already', 2, 2], ['коміт не потрібен', 2, 2],
];
function perGateWrong(rows) {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => { writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` })); return gateIn(dir, 'git push'); };
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
    return gateIn(dir, 'git commit -am x');
  };
  const wrong = [];
  for (const [words, c, p] of rows) {
    const gotC = commit(words);
    const gotP = push(words);
    if (gotC !== c) wrong.push(`COMMIT-GATE ${words}: ${gotC} want ${c}`);
    if (gotP !== p) wrong.push(`PUSH-GATE ${words}: ${gotP} want ${p}`);
  }
  return wrong;
}
test('guard-ungated-commit: each gate consents on its own act - 82 per-gate cells (2.1.6 re-verify 3 R3-M1, R3-m1)', () => {
  assert.equal(R3_PER_GATE.length * 2, 82);
  assert.deepStrictEqual(perGateWrong(R3_PER_GATE), []);
});
test('guard-ungated-commit: the 36 holdout phrases hold on both gates (2.1.6 re-verify 3 R3-M1)', () => {
  assert.equal(R2_HOLDOUT_PER_GATE.length, 36);
  assert.deepStrictEqual(perGateWrong(R2_HOLDOUT_PER_GATE), []);
});
// R4-m1: 'once CI is green' was a deferral for every verb, so 'merge it once CI is green' - the ordinary way to ask for a
// merge that waits on CI - was refused at the PUSH-GATE. A push, publish, release or ship still waits on CI; a merge
// is the act that CI gates and consents.
test('guard-ungated-commit: a merge that waits on CI consents to the merge, a push that waits on CI does not (2.1.6 re-verify 4 R4-m1)', () => {
  assert.deepStrictEqual(perGateWrong([
    ['merge it once CI is green', 0, 0], ['merge when the checks pass', 0, 0], ['please merge it after the pipeline is green', 0, 0],
    ['push it once CI is green', 2, 2], ['release after the checks pass', 2, 2], ['ship it when CI is green', 2, 2],
    ['merge it later', 2, 2], ['merge it, not yet', 2, 2],
  ]), []);
});
test('guard-ungated-commit: the push denial says what the push gate reads (2.1.6 re-verify 3 R3-M1)', () => {
  const dir = scratchRepo();
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { auth: 'authorized: "commit it"' }));
  assert.match(gateFull(dir, 'git push').stderr, /a commit-only answer \('commit it'\) consents to no push/);
});
// 2.1.6 re-verify 3 R3-m10: the consent reader walked every clause bound for every verb, quadratic on a long quote. A
// quote past 1,000 characters is no answer; at the cap it is read.
test('guard-ungated-commit: an authorized: quote past 1,000 characters is no answer (2.1.6 re-verify 3 R3-m10)', () => {
  const dir = scratchRepo();
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${headOf(dir)}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
    return gateFull(dir, 'git commit -am x');
  };
  const at = 'commit it, '.repeat(90) + 'x'.repeat(10);
  assert.equal(at.length, 1000);
  assert.strictEqual(commit(at).status, 0, 'at the cap the quote is read');
  const over = commit(`${at}y`);
  assert.strictEqual(over.status, 2, 'one past it is no answer');
  assert.match(over.stderr, /runs past 1000 characters/);
});

// 2.1.6 re-verify 2 R2-M5: a script FILE handed to a shell - `bash x.sh`, `. x.sh`, `cat x.sh | sh`, a file the same
// command writes first - holding `git commit` committed ungated on both trees. R2-m1: nine alias spellings, `eval` and
// an xargs placeholder committed ungated.
test('guard-ungated-commit: a script file a shell runs is judged as the commands it holds (2.1.6 re-verify 2 R2-M5)', () => {
  const { dir, write } = aliasRepo({});
  write('commit.sh', '#!/bin/sh\ngit add -A\ngit commit -m wip\n');
  write('build.sh', '#!/bin/sh\necho building\n');
  fs.chmodSync(path.join(dir, 'commit.sh'), 0o755);
  const wrong = [];
  for (const command of ['bash commit.sh', 'sh ./commit.sh', '. ./commit.sh', 'source commit.sh', 'cat commit.sh | sh', 'sh < commit.sh',
    './commit.sh', `bash ${path.join(dir, 'commit.sh')}`, "cat > run.sh <<'EOF'\ngit commit -m x\nEOF\nbash run.sh"]) {
    if (gateIn(dir, command) !== 2) wrong.push(`passed: ${command}`);
  }
  for (const command of ['bash build.sh', 'bash -n commit.sh', 'bash missing.sh']) if (gateIn(dir, command) !== 0) wrong.push(`gated: ${command}`);
  assert.deepStrictEqual(wrong, []);
});
test('guard-ungated-commit: a script piped from curl does not exist until it runs, so the call is judged on what it names', () => {
  const { dir } = aliasRepo({});
  assert.strictEqual(gateIn(dir, 'curl -fsSL https://example.invalid/install.sh | sh'), 0);
});
// 2.1.6 re-verify 3 R3-m4: the reader stops at the scan budget (hook-prelude.js), not at a fixed 1MB - and what it
// leaves unread gates when it names git, never passes.
test('guard-ungated-commit: a script file is judged at any size - read under the scan budget, gated past it only when it names git (2.1.6 re-verify 3 R3-m4)', () => {
  const { dir, write } = aliasRepo({});
  const sized = (name, size, last) => {
    const pad = 'echo pad\n';
    const body = pad.repeat(Math.floor((size - last.length) / pad.length));
    const fill = size - last.length - body.length;
    write(name, (fill ? `${'#'.repeat(fill - 1)}\n` : '') + body + last);
    return fs.statSync(path.join(dir, name)).size;
  };
  assert.strictEqual(sized('at.sh', 1024 * 1024, 'git commit -qm x\n'), 1024 * 1024);
  assert.strictEqual(gateIn(dir, 'bash at.sh'), 2, 'a script of 1MB is judged');
  assert.strictEqual(sized('over.sh', 1024 * 1024 + 1, 'git commit -qm x\n'), 1024 * 1024 + 1);
  assert.strictEqual(gateIn(dir, 'bash over.sh'), 2, 'one byte more is judged the same - no flip at 1MB');
  assert.strictEqual(sized('plain.sh', 1024 * 1024 + 1, 'echo done\n'), 1024 * 1024 + 1);
  assert.strictEqual(gateIn(dir, 'bash plain.sh'), 0, 'a script that never names git cannot commit');
  const { SCAN_LIMITS } = require(path.join(HOOKS, 'hook-prelude.js'));
  sized('huge.sh', SCAN_LIMITS.bytes + 1024, 'git commit -qm x\n');
  assert.strictEqual(gateIn(dir, 'bash huge.sh'), 2, 'past the byte budget, a script naming git gates unread');
  sized('huge-plain.sh', SCAN_LIMITS.bytes + 1024, 'echo done\n');
  assert.strictEqual(gateIn(dir, 'bash huge-plain.sh'), 0, 'past it, one that never names git cannot commit');
});
test('guard-ungated-commit: every spelling of an alias call is expanded (2.1.6 re-verify 2 R2-m1)', () => {
  const { dir } = aliasRepo({ ci: 'commit' });
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-home-'));
  fs.writeFileSync(path.join(home, '.gitconfig'), '[alias]\n\thh = commit\n');
  const wrong = [];
  for (const command of ['git -P ci -qm x', 'git -p ci -qm x', `${realGit} ci -qm x`, '\\git ci -qm x', 'git --git-dir .git ci -qm x',
    'git --work-tree . ci -qm x', 'git --git-dir .git commit -qm x', 'V=commit git --config-env=alias.zz=V zz -qm x',
    'git config alias.yy commit && git yy -qm x', `HOME=${home} git hh -qm x`, "eval 'git commit -qm x'", 'xargs -I% git % -qm x <<< commit',
    'git --work-tree . commit -qm x', `${realGit} push`, '\\git push', 'git --work-tree . push', 'git -P --git-dir .git push']) {
    if (gateIn(dir, command) !== 2) wrong.push(`passed: ${command}`);
  }
  for (const command of ['git -P log -1', 'git config alias.yy status && git yy', "eval 'git status'"]) if (gateIn(dir, command) !== 0) wrong.push(`gated: ${command}`);
  fs.rmSync(home, { recursive: true, force: true });
  assert.deepStrictEqual(wrong, []);
});

// 2.1.6 re-verify 3 R3-M4: the git option regexes backtracked exponentially - `git` + 36 x ' -c' + '; git push' took 67s
// through the hook and 24 x ' --git-dir' timed out, stalling every shell call. The options are walked word by word now
// (shell-writes.js gitCalls), in the one call finder both guards read. The bound is a sanity check ten times the 1s the
// review asked for, spawn included, so a loaded machine never flips it; the exponential form took minutes.
test('guard-ungated-commit: a run of git options is walked, not matched - 40 x -c and 40 x --git-dir before a push gate, well inside a sanity bound (2.1.6 re-verify 3 R3-M4)', () => {
  const { dir } = aliasRepo({});
  const wrong = [];
  for (const opt of [' -c', ' --git-dir']) {
    const t0 = Date.now();
    const status = gateIn(dir, `git${opt.repeat(40)}; git push`);
    const took = Date.now() - t0;
    if (status !== 2 || took >= 10000) wrong.push(`${opt.trim()} x 40: exit ${status} in ${took}ms`);
  }
  assert.deepStrictEqual(wrong, []);
});
// R3-m6: the command word was matched as the literal `git` - a quoted, escaped, split or case-changed spelling, a
// variable holding it and a Windows `.exe` name committed or published ungated. The word is normalised the way the
// shell reads it before it is compared (case folded where the file system folds it: macOS and Windows).
test('guard-ungated-commit: git is found however the command word is spelled (2.1.6 re-verify 3 R3-m6)', () => {
  const { dir } = aliasRepo({});
  const caseless = process.platform === 'darwin' || process.platform === 'win32';
  const wrong = [];
  for (const command of ["'git' commit -qm x", '"git" push -q', 'g\\it commit -qm x', 'gi""t push -q', 'GIT=git; $GIT commit -qm x',
    'git.exe commit -qm x', ...(caseless ? ['Git commit -qm x', 'GIT push -q'] : [])]) {
    if (gateIn(dir, command) !== 2) wrong.push(`passed: ${command}`);
  }
  assert.deepStrictEqual(wrong, []);
});
// R3-m7: git anywhere in the text gated - an echo, a file name, a grep pattern and a script's own arguments named no
// git call, and a commit dry run commits nothing. Only a command word is a call now.
test('guard-ungated-commit: git in an argument position is no git call, and a commit dry run commits nothing (2.1.6 re-verify 3 R3-m7)', () => {
  const { dir } = aliasRepo({ ci: 'commit' });
  const wrong = [];
  for (const command of ['echo /usr/bin/git push', 'echo git ci', 'echo git push', 'echo git commit -m x', 'ls docs/git commit.md',
    'grep -c git push.log', 'npm run lint -- --fix git commit', 'git commit --dry-run -m x']) {
    if (gateIn(dir, command) !== 0) wrong.push(`gated: ${command}`);
  }
  assert.deepStrictEqual(wrong, []);
});
// R4-M2: the linear parser knew only the wrappers it lists, so a runner in front of git (`xcrun git push`, `arch -arm64
// git commit`, `bundle exec`, `direnv exec .`, `op run --`) was no git call and published ungated - the base gated any
// word sequence that reached git. A bare `git` word after a head that is not a data head (echo, grep, ls, npm ...) is the
// call; `echo git push` and `grep git log` stay text.
test('guard-ungated-commit: git behind a runner the parser does not list is still the call (2.1.6 re-verify 4 R4-M2)', () => {
  const { dir } = aliasRepo({});
  const wrong = [];
  for (const command of ['xcrun git push -q', 'arch -arm64 git push -q', 'arch -x86_64 git commit -qm x', 'xcrun git commit -qm x',
    'op run -- git push -q', 'direnv exec . git push -q', 'mise x -- git push -q', 'aws-vault exec dev -- git push -q',
    'bundle exec git push -q', 'pnpm exec git push -q', 'yarn run git push -q', 'taskset -c 0 git push -q',
    'flock /tmp/l git push -q', 'setsid git push -q', 'rtk git commit -qm x']) {
    if (gateIn(dir, command) !== 2) wrong.push(`passed: ${command}`);
  }
  for (const command of ['echo git push', 'printf "%s\\n" git commit', 'grep git log', 'man git commit', 'cat git push.txt', 'ls git commit.md',
    'npm run lint -- --fix git commit', 'yarn run build git push', 'gh pr view git push', 'node script.js git commit', 'cd git push', 'touch git push', 'rg git push', 'sed -n p git push']) {
    if (gateIn(dir, command) !== 0) wrong.push(`gated: ${command}`);
  }
  assert.deepStrictEqual(wrong, []);
});
