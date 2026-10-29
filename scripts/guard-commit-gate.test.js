// Behavior tests for the commit/push gate fixes in family F of the 2026-09-22 audit remediation
// (docs/sessions-investigation/AUDIT/_fixmap.json, cluster 'F'): the receipt's probe-SCOPE check,
// the security-review-receipt honesty check, the no-ff merge-order guidance, and the bare
// `git add -N` guard. Each case pins a real measured defect - both directions, since a false
// positive here is as costly as the miss it replaces.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const { reviewedTranscript, REVIEW_ROW } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-commit-gate-'));

// Pin an empty account dir and a scratch project root for the whole run - a real machine's
// account settings and this checkout's own `.alfred/statistics/hook-blocks/` must never be touched by
// a test run (the same containment guard-hooks.test.js's head applies).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT;
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
// A session where a review ran: every commit receipt needs one since 2026-10-22, so a case judging another of its lines
// runs the guard over this transcript unless it hands its own.
const REVIEWED = reviewedTranscript(TMP);

const runIn = (hook, payload, opts) =>
  spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });
const gateFull = (dir, command, env = {}) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, transcript_path: REVIEWED }, {
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
// The commit receipt's formatter line (audit 2026-10-10 C18): every COMMIT-GATE fixture carries it.
const FMT_LINE = 'format: npx prettier --check - clean over 3 staged files';
const FMT = `${FMT_LINE}\nfindings: none`;
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
// 2.8.0 layout: where every hook writes a receipt now; the pre-2.8.0 flow/ above is still read for the 2.x line.
const writeStateReceipt = (dir, name, body) => {
  const file = path.join(dir, '.alfred', 'state', 'approvals', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
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

// Audit 2026-10-08 row 46: the Monitor tool runs its command under the shell route; no test replayed a commit through it.
test('audit 2026-10-08: a commit through the Monitor tool is gated like one through Bash', () => {
  const dir = scratchRepo();
  const viaMonitor = (command) => runIn('guard-ungated-commit.js', { tool_name: 'Monitor', tool_input: { command } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  }).status;
  assert.equal(gateIn(dir, 'git add -A && git commit -m x'), 2, 'Bash');
  assert.equal(viaMonitor('git add -A && git commit -m x'), 2, 'Monitor');
  assert.equal(viaMonitor('git log --oneline -3'), 0, 'a read through Monitor passes');
});

test('audit 2026-10-08: a commit, merge or reset chained before a push on a level branch still needs the publish receipt', () => {
  const { dir, git } = pushRepo();
  assert.equal(gateIn(dir, 'git push'), 0, 'control: a push with nothing ahead of its upstream publishes nothing');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nnext\n');
  const chained = gateFull(dir, 'git commit -am x && git push');
  assert.equal(chained.status, 2, `the commit runs first, so the push publishes it - exit ${chained.status}: ${chained.stderr}`);
  assert.match(chained.stderr, /publish gate receipt|PUSH-GATE/, 'blocked by the publish half');
  git('checkout', '-q', '-b', 'feature'); fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); git('add', '-A'); git('commit', '-qm', 'feat'); git('checkout', '-q', 'main');
  for (const c of ['git merge feature && git push', 'git pull && git push', 'git cherry-pick feature; git push', 'git reset --hard feature && git push']) {
    const r = gateFull(dir, c);
    assert.equal(r.status, 2, `${c} - exit ${r.status}`);
  }
  assert.equal(gateIn(dir, 'git status && git push'), 0, 'a read before the push moves nothing');
  assert.equal(gateIn(dir, 'git push && git merge feature'), 0, 'a mover AFTER the push is not what it publishes');
});

test('audit 2026-10-08: a push of another ref, a set or a tag is judged ahead even when HEAD is level', () => {
  const { dir, git } = pushRepo();
  git('checkout', '-q', '-b', 'feature'); fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); git('add', '-A'); git('commit', '-qm', 'feat');
  git('tag', 'v1'); git('checkout', '-q', 'main');
  for (const c of ['git push origin feature', 'git push origin feature:main', 'git push origin +feature:main', 'git push origin HEAD:release',
    'git push --all', 'git push --tags', 'git push origin --follow-tags', 'git push origin v1', 'git push -o ci.skip origin feature', 'git push origin :old']) {
    const r = gateFull(dir, c);
    assert.equal(r.status, 2, `${c} publishes what HEAD's upstream never shows - exit ${r.status}`);
  }
  for (const c of ['git push', 'git push origin', 'git push origin main', 'git push origin HEAD', 'git push origin main:main', 'git push -o ci.skip origin main', 'git push -u origin main']) {
    assert.equal(gateIn(dir, c), 0, `${c} pushes the level branch under its own name`);
  }
});

test('audit 2026-10-08: a first push names the projects its commits touch, with no upstream to diff', () => {
  const { dir, git } = pushRepo();
  git('checkout', '-q', '-b', 'two-projects');
  fs.mkdirSync(path.join(dir, 'apps', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'consumer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'auth', 'a.ts'), forty());
  fs.writeFileSync(path.join(dir, 'apps', 'consumer', 'b.ts'), forty());
  git('add', '-A'); git('commit', '-qm', 'feat: auth + consumer');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { scope: null }));
  const r = gateFull(dir, 'git push -u origin two-projects');
  assert.equal(r.status, 2, `the first push spans two projects and the receipt names no scope - exit ${r.status}`);
  assert.match(r.stderr, /auth.*consumer|consumer.*auth/, 'names both projects');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { scope: 'scope: workspace' }));
  assert.equal(gateIn(dir, 'git push -u origin two-projects'), 0, 'a workspace scope covers it');
});

test('audit 2026-10-08: head: is the first sha word on its line, and a header: line is not it', () => {
  const { dir } = pushRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nnext\n');
  spawnSync('git', ['-C', dir, 'commit', '-qam', 'next'], { encoding: 'utf8' });
  const head = headOf(dir);
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { head: 'unknown' }));
  assert.equal(gateIn(dir, 'git push'), 2, "'head: unknown' names no sha - it passed before");
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { head: null }).replace('VERIFIED the release\n', `VERIFIED the release\nheader: ${head}\n`));
  assert.equal(gateIn(dir, 'git push'), 2, 'a header: line is no head: line');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { head: `${head.slice(0, 12)} (main)` }));
  assert.equal(gateIn(dir, 'git push'), 0, "a sha with the branch after it is that sha - '(main)' added hex letters before");
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { head: head.toUpperCase() }));
  assert.equal(gateIn(dir, 'git push'), 0, 'an upper-case sha is the same sha');
});

test('audit 2026-10-08: a WAIVED quote must waive the review, in the user\'s words', () => {
  const { dir } = pushRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nnext\n');
  spawnSync('git', ['-C', dir, 'commit', '-qam', 'next'], { encoding: 'utf8' });
  for (const [quote, want] of [['what time is it?', 2], ['push it', 2], ['skip the review', 0], ['just push', 0], ['push it anyway, no review', 0], ['пуш без перевірки', 2]]) {
    writeReceipt(dir, 'PUSH-GATE', `WAIVED - "${quote}"\n`);
    assert.equal(gateIn(dir, 'git push'), want, `WAIVED - "${quote}"`);
  }
  const tp = path.join(dir, '..', 'waived-transcript.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: 'Push?', options: [{ label: 'Skip the review and push', description: 'x' }] }] } }] } }) + '\n');
  writeReceipt(dir, 'PUSH-GATE', 'WAIVED - "Skip the review and push"\n');
  const r = runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git push' }, transcript_path: tp }, { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  assert.equal(r.status, 2, 'an option label this run wrote is the model\'s sentence, not the user\'s waiver');
});

test('audit 2026-10-08: a publish receipt written before this session began is absent, and the act is capped and masked', () => {
  const { dir } = pushRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nnext\n');
  spawnSync('git', ['-C', dir, 'commit', '-qam', 'next'], { encoding: 'utf8' });
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir)));
  const gate = path.join(dir, '.alfred', 'docs', 'flow', 'PUSH-GATE');
  const past = (Date.now() - 10 * 60 * 1000) / 1000;
  fs.utimesSync(gate, past, past);
  const tp = path.join(dir, '..', `session-${process.pid}.jsonl`);
  fs.writeFileSync(tp, '');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  fs.appendFileSync(tp, '{}\n'); // a live transcript has been written since its birth, so its ctime moved past it
  const st = fs.statSync(tp);
  if (process.platform === 'darwin') assert.ok(st.birthtimeMs && st.birthtimeMs !== st.ctimeMs, 'APFS reports a birthtime - the session case must run here');
  const push = (command) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, transcript_path: tp }, { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  if (st.birthtimeMs && st.birthtimeMs !== st.ctimeMs) {
    assert.equal(push('git push').status, 2, 'another session\'s receipt opens no push in this one');
    fs.utimesSync(gate, Date.now() / 1000, Date.now() / 1000);
    assert.equal(push('git push').status, 0, 'one written in this session does');
  }
  fs.rmSync(gate);
  const masked = push('git push https://bob:tok3n-secret-value@example.invalid/x.git main');
  assert.equal(masked.status, 2);
  assert.doesNotMatch(masked.stderr, /tok3n-secret-value/, 'the denial never echoes a credential in a remote URL');
  assert.match(masked.stderr, /\/\/\*\*\*@example\.invalid/);
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
    FMT,
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
  assert.match(blocked.stderr, /git diff HEAD --stat; git ls-files -o --exclude-standard/, 'names the index-free survey alfred-git.md:9 gives (f24eb967)');

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
  assert.match(withCommit.stderr, /git ls-files -o --exclude-standard/);
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
  const inWorktree = (command) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, cwd: wt, transcript_path: REVIEWED }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: main }, cwd: main,
  });
  assert.equal(inWorktree('git commit -am x').status, 2, 'the worktree diff is non-trivial - no receipt, blocked');
  writeReceipt(wt, 'COMMIT-GATE', ['VERIFIED the worktree change', 'authorized: "commit it"', `head: ${headOf(wt)}`,
    'spec: 3 files', 'live-probe: `npm test` 12/12', FMT].join('\n') + '\n');
  assert.equal(inWorktree('git commit -am x').status, 0, 'the receipt in the worktree opens it');

  const sub = path.join(main, 'src');
  fs.mkdirSync(sub);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(main, f), forty());
  writeReceipt(main, 'COMMIT-GATE', ['VERIFIED the main change', 'authorized: "commit it"', `head: ${headOf(main)}`,
    'spec: 3 files', 'live-probe: `npm test` 12/12', FMT].join('\n') + '\n');
  const fromSub = runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: sub, transcript_path: REVIEWED }, {
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
    `head: ${headOf(r.dir)}`, `spec: ${n}`, 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
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
  const at = (cwd, command) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, cwd: path.join(r.dir, cwd), transcript_path: REVIEWED },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: r.dir }, cwd: r.dir });
  const spec = (n) => writeReceipt(r.dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', 'authorized: "commit it"', `head: ${headOf(r.dir)}`,
    `spec: ${n}`, 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
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
    'opening the PR now is fine', 'go ahead and open the pull request', 'open a draft PR', 'open up a PR', 'raise a new PR']) {
    assert.strictEqual(push(words), 0, `consent: ${words}`);
  }
  // m1: the review's 18 sentences about a PR that ask for nothing - an editing verb (make, file), the noun followed by
  // what is ABOUT the PR, a question, a negation
  for (const words of ['the PR is open', 'did you open the PR?', "don't open a PR", 'PR review', 'open the PR in the browser',
    'make the PR description shorter', 'create a PR template', 'file a PR comment on line 4', 'look at the PR',
    'never open a pull request for this',
    'PR', 'what does the PR say?', 'the pull request looks odd', 'open the file']) {
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
  writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', 'authorized: "commit it"', `head: ${headOf(dir)}`, 'spec: 2 files', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
  const added = gateFull(dir, 'git a c.js && git ci -m x');
  assert.strictEqual(added.status, 2, 'the aliased add takes c.js in');
  assert.match(added.stderr, /this commit takes in 3 /);
});
test('guard-ungated-commit: a ! shell alias is judged as the command it runs, and one that cannot be read gates (2.1.6 review T20)', () => {
  const { dir } = aliasRepo({ save: '!git add -A && git commit -m wip', run: '!f() { git "$@"; }; f', hi: '!echo hi' });
  assert.strictEqual(gateIn(dir, 'git save'), 2, 'the shell alias commits');
  assert.strictEqual(gateIn(dir, 'git run commit -m x'), 2, 'its git subcommand is a variable: unjudgeable, gated like a commit');
  assert.strictEqual(gateIn(dir, 'git hi'), 0, 'a shell alias that commits nothing passes');
  // a lookup git cannot answer (anything but 0 or 1 - 1 is 'no such alias') fails closed: the call gates as a commit.
  // The stub is a POSIX sh script named `git` on PATH; Windows resolves git.exe through PATHEXT and never runs it.
  if (process.platform === 'win32') return;
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
  for (const words of ["let's open a PR", 'push it, no need to wait for CI', 'yes, open the PR']) {
    assert.strictEqual(push(words), 0, `consent: ${words}`);
  }
  for (const words of ['I do not think we should open a PR yet', 'no need to open a PR', 'open a PR? not yet', "don't push yet",
    'never commit this']) {
    assert.strictEqual(push(words), 2, `no consent: ${words}`);
  }
});

// 2.1.6 re-verify 2 R2-M3: the N3 reading refused real consent - a deferral anywhere refused the whole quote, and a
// clause ran across a spaced dash or 'but' ('commit now, push later', 'no need to ask - just commit it') - while 23 of 24
// refusals still read as consent ('push is not needed', 'stop committing', 'why did you push?', 'hold the commit'). The
// reviewer's English quotes (25 of its 46; the Ukrainian ones left with the English-only ruling of 2026-10-16) through a
// real receipt and `git commit -am x`. R2-m4: the three
// holdouts its fix still read as consent. And consent is per gate class: 'commit it, don't push' opens the commit only.
const R2_CONSENTS = ['commit now, push later', "commit it, I'll open the PR later", 'no need to ask - just commit it', 'No problem - commit it',
  'never mind the lint warning - push it', 'not sure about the name but commit it', 'no issues - ship it', 'commit and push; we can tidy up later',
  "don't forget to commit", "I don't mind - push it", 'commit it', 'go ahead and push'];
const R2_REFUSALS = ['push is not needed', "commit isn't what I asked for", 'committing now would be a mistake', 'stop committing',
  'stop pushing to main', 'why did you push?', 'who told you to commit?', 'commit after I review it', 'push tomorrow, not today',
  'yes, but do not commit', 'hold the commit', 'wait with the push', 'the commit message has a typo'];
const R2_HOLDOUT_REFUSALS = ['I will commit it myself', 'commit is broken'];
test('guard-ungated-commit: consent is read per clause and per gate - 25 quotes through a real commit (2.1.6 re-verify 2 R2-M3, R2-m4)', () => {
  assert.equal(R2_CONSENTS.length + R2_REFUSALS.length, 25);
  const dir = scratchRepo();
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${headOf(dir)}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
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
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
    return gateIn(dir, 'git commit -am x');
  };
  assert.strictEqual(commit("commit it, don't push"), 0, 'the commit is asked for');
  assert.strictEqual(push("commit it, don't push"), 2, '... and the push refused');
  assert.strictEqual(push('yes, but never force-push'), 2, 'a refused force-push refuses the push gate');
  assert.strictEqual(commit('yes, but never force-push'), 0, '... and leaves the commit consented');
  assert.strictEqual(push('open the PR, but do not merge it'), 2, 'a refused merge refuses the push gate');
  assert.strictEqual(push('I will push it myself'), 2, 'the user keeping the act is no consent to it');
  assert.strictEqual(push('push is fine'), 0, 'a verb followed by a positive state is consent');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "commit it, don't push"` }));
  assert.match(gateFull(dir, 'git push').stderr, /carries no publish verb left standing \(push, merge, release, ship\) and opens no pull request/, 'the push gate names its own verb class');
  writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "push it, don't commit"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
  assert.match(gateFull(dir, 'git commit -am x').stderr, /carries no commit verb left standing/, 'the commit gate names its own');
});

// 2.1.6 re-verify 3 R3-M1: a consent for one gate opened the other - a standing commit verb consented to a push
// ('commit it' in a PUSH-GATE receipt) - and a bare 'no' after the verb was not read ('commit yes, push no'). R3-m1:
// the Ukrainian publish verbs were no consent verbs at all (gone with them, 2026-10-16). 'push after CI' names a condition that holds
// only after the push (CI runs on it), so it consents to nothing now. Each phrase is judged on both gates:
// [words, COMMIT-GATE, PUSH-GATE], 0 = consent, 2 = refused - 20 phrases, 40 per-gate cells.
const R3_PER_GATE = [
  // a commit-only answer opens the commit and never the push (5)
  ['commit it', 0, 2], ['go ahead and commit', 0, 2], ['yes, commit this', 0, 2], ['commit it and stop there', 0, 2], ['commit only', 0, 2],
  // a bare no after the verb answers it (2)
  ['commit yes, push no', 0, 2], ['commit no, push yes', 2, 0],
  // a publish conditioned on CI, which runs on the push itself (1)
  ['push after CI', 2, 2],
  // the rest of the grid (12)
  ['yes', 0, 0], ['go ahead', 0, 0], ['push it', 0, 0], ['commit and push', 0, 0], ['ship it', 0, 0], ['merge it', 0, 0],
  ['open the PR', 0, 0], ['approved', 0, 0],
  ["commit it, don't push", 0, 2], ["push it, don't commit", 2, 0], ['do not push', 2, 2],
  ['yes, commit and open a PR', 0, 0],
];
// The implementer's own holdout phrases (re-verify 2, the 26 English ones of its 36), both gates - the commit-only ones now refuse the push, and a
// publish conditioned on CI consents to nothing.
const R2_HOLDOUT_PER_GATE = [
  ['ok, commit', 0, 2], ['go ahead and commit', 0, 2], ['looks good, commit and push', 0, 0], ['sure - push it', 0, 0],
  ['please merge it', 0, 0],
  ['commit it now', 0, 2], ['yes', 0, 0], ['approved', 0, 0], ['do the commit', 0, 2], ['make a commit and push it', 0, 0],
  ['Stop the dev server and commit', 0, 2], ['tests pass, so push', 0, 0],
  ['commit it yourself', 0, 2], ['push when CI is green', 2, 2],
  ["don't commit yet", 2, 2], ['do not push', 2, 2], ['no commit today', 2, 2], ['never push to main', 2, 2],
  ['the push failed', 2, 2], ['was the commit signed?', 2, 2], ['I will push it later', 2, 2],
  ['commit? no', 2, 2], ['hold off on the push', 2, 2], ['stop pushing', 2, 2],
  ['who pushed this?', 2, 2], ['I committed it already', 2, 2],
];
function perGateWrong(rows) {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => { writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` })); return gateIn(dir, 'git push'); };
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
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
test('guard-ungated-commit: each gate consents on its own act - 40 per-gate cells (2.1.6 re-verify 3 R3-M1, R3-m1)', () => {
  assert.equal(R3_PER_GATE.length * 2, 40);
  assert.deepStrictEqual(perGateWrong(R3_PER_GATE), []);
});
test('guard-ungated-commit: the 26 holdout phrases hold on both gates (2.1.6 re-verify 3 R3-M1)', () => {
  assert.equal(R2_HOLDOUT_PER_GATE.length, 26);
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
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${headOf(dir)}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
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

// ---------------------------------------------------------------------------------------------
// audit 2026-10-10 (C01, C17, C18): the commit guard's whole-session reads and the receipt's batch, scope and format lines
// ---------------------------------------------------------------------------------------------
const writeTranscript = (dir, name, rows) => {
  const tp = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(tp, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return tp;
};
const commitReceipt = (head, over = {}) => [
  over.first || 'VERIFIED task-verify-code passed',
  over.auth || 'authorized: "commit it"',
  `head: ${head}`,
  over.spec || 'spec: 3 files',
  'live-probe: NOT RUN - fixture',
  over.format === null ? null : (over.format || FMT_LINE),
  over.findings === null ? null : (over.findings || 'findings: none'),
].filter((l) => l != null).join('\n') + '\n';
// A review's result line: a review skill counts once one follows its call (2026-10-22, the user's 'Fix ALL left gaps') -
// `Findings:` for review-code, review-security and the verify skills, a loop's `Outcome:`.
const resultRow = (ts, text = 'Findings: none') => ({ type: 'assistant', ...(ts ? { timestamp: ts instanceof Date ? ts.toISOString() : ts } : {}), message: { content: [{ type: 'text', text }] } });
const gateWith = (dir, command, extra = {}, env = {}) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command }, transcript_path: REVIEWED, ...extra }, {
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }, cwd: dir,
});

test('audit 2026-10-10 C01: a verify Skill call past the old 256KB tail still counts as run in this session', () => {
  const dir = scratchRepo();
  const skill = { type: 'assistant', message: { id: 'm0', content: [{ type: 'tool_use', id: 't0', name: 'Skill', input: { skill: 'task-verify-code' } }] } };
  // 1.3MB of later rows between the Skill call and the commit (84eedb4b: the call sat 1.33MB back)
  const filler = Array.from({ length: 1300 }, (_, i) => ({ type: 'assistant', message: { id: `f${i}`, content: [{ type: 'text', text: 'x'.repeat(1000) }] } }));
  const tp = writeTranscript(dir, 'far-skill', [skill, resultRow(), ...filler]);
  const launched = writeTranscript(dir, 'far-launched', [skill, ...filler]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir)));
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: tp }).status, 0, 'the Skill call 1.3MB back is in this session');
  const unfinished = gateWith(dir, 'git commit -am x', { transcript_path: launched });
  assert.equal(unfinished.status, 2, 'a call with no result line after it only launched (2026-10-22)');
  assert.match(unfinished.stderr, /names verify-code, but no run of it in this session reached its result line/);
  const none = writeTranscript(dir, 'no-skill', filler);
  // the receipt is this session's own: written after its transcript began (audit 2026-10-20 H4)
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir)));
  const r = gateWith(dir, 'git commit -am x', { transcript_path: none });
  assert.equal(r.status, 2, 'a session with no Skill call anywhere is still refused');
  assert.match(r.stderr, /reached its result line/);
  // the tool-usage ledger is no evidence (2026-10-22, the user's 'Fix ALL left gaps'): its row carries no target, no
  // result and no refusal
  const ledger = path.join(dir, '.alfred', 'statistics', 'tools-usage');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'sess-ledger.jsonl'), JSON.stringify({ ts: 'x', session: 'sess-ledger', tool: 'Skill', detail: 'task-verify-code', cwd: dir }) + '\n');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: none, session_id: 'sess-ledger' }).status, 2, 'a ledger Skill row is no run');
  // a malformed transcript fails toward the refusal, never a crash
  const bad = writeTranscript(dir, 'garbage', ['{not json', 'also not']);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir)));
  const garbage = gateWith(dir, 'git commit -am x', { transcript_path: bad });
  assert.equal(garbage.status, 2, 'garbage reads as no Skill call');
  assert.match(garbage.stderr, /reached its result line/);
});

test('audit 2026-10-10 C17: the user\'s own typed words are their consent even when an option label spells them too', () => {
  const dir = scratchRepo();
  const ask = { type: 'assistant', message: { id: 'q1', content: [{ type: 'tool_use', id: 'u1', name: 'AskUserQuestion', input: { questions: [{ question: 'Next?', options: [{ label: 'Commit and push', description: 'x' }, { label: 'Commit to develop', description: 'y' }] }] } }] } };
  const picked = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'Commit to develop' }] } };
  const typed = { type: 'user', message: { role: 'user', content: 'commit and push' } };
  const withTyped = writeTranscript(dir, 'typed', [REVIEW_ROW, ask, picked, typed]);
  const noTyped = writeTranscript(dir, 'label-only', [REVIEW_ROW, ask, picked]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint', auth: 'authorized: "commit and push"' }));
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: withTyped }).status, 0, 'the user typed it in a turn of their own');
  const r = gateWith(dir, 'git commit -am x', { transcript_path: noTyped });
  assert.equal(r.status, 2, 'with no typed turn carrying it, the quote is still the model\'s own label');
  assert.match(r.stderr, /option label THIS run wrote/);
  // a meta row (a skill body) carrying the words is no typed turn
  const meta = writeTranscript(dir, 'meta', [REVIEW_ROW, ask, picked, { type: 'user', isMeta: true, message: { role: 'user', content: 'commit and push' } }]);
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: meta }).status, 2, 'a meta row is not the user typing');
});

test('audit 2026-10-10 C17: one receipt covers a reviewed batch - head: an ancestor of HEAD passes inside the reviewed set', () => {
  const dir = scratchRepo();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const reviewed = headOf(dir);
  // the review covered a.txt, b.txt, c.txt (3 files); commit 1 takes a.txt + b.txt, commit 2 c.txt
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(reviewed, { first: 'VERIFIED the checkpoint' }));
  const gate = path.join(dir, '.alfred', 'docs', 'flow', 'COMMIT-GATE');
  // A receipt REWRITTEN below is the same review re-spelled, so it keeps the first one's time: the guard refuses a commit
  // made more than 2s before the receipt it is judged under, and a slow runner (the gate's Windows leg) crossed that.
  const writtenAt = fs.statSync(gate).mtime;
  const sameReview = () => fs.utimesSync(gate, writtenAt, writtenAt);
  assert.equal(gateIn(dir, 'git add a.txt b.txt && git commit -m one'), 0, 'commit 1 under the receipt');
  git('add', 'a.txt', 'b.txt'); git('commit', '-qm', 'one');
  assert.equal(gateIn(dir, 'git add c.txt && git commit -m two'), 0, 'commit 2: head: is an ancestor and the batch stays inside 3 files');
  // a fourth file the review never covered pushes the batch past spec:
  fs.writeFileSync(path.join(dir, 'd.txt'), forty());
  const over = gateFull(dir, 'git add c.txt d.txt && git commit -m two');
  assert.equal(over.status, 2, 'the batch now takes in 4 files against a 3-file spec');
  assert.match(over.stderr, /more than the 3 its spec: covered/);
  // a spec naming its paths is read by path
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(reviewed, { first: 'VERIFIED the checkpoint', spec: 'spec: 3 files - a.txt, b.txt, c.txt' }));
  sameReview();
  assert.equal(gateIn(dir, 'git add c.txt && git commit -m two'), 0, 'every file named');
  const named = gateFull(dir, 'git add c.txt d.txt && git commit -m two');
  assert.equal(named.status, 2, 'd.txt is not among the named paths');
  assert.match(named.stderr, /d\.txt, which spec: never names/);
  // a head that is no ancestor (another branch's commit) is a different commit
  git('checkout', '-qb', 'side', reviewed); fs.writeFileSync(path.join(dir, 'e.txt'), 'e\n'); git('add', 'e.txt'); git('commit', '-qm', 'side');
  const side = headOf(dir); git('checkout', '-q', '-');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(side, { first: 'VERIFIED the checkpoint' }));
  assert.match(gateFull(dir, 'git add c.txt && git commit -m two').stderr, /the review ran against a different commit/, 'not an ancestor');
  // a commit made BEFORE the receipt was written was never under it
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(reviewed, { first: 'VERIFIED the checkpoint' }));
  const future = Date.now() / 1000 + 60; fs.utimesSync(gate, future, future); // the receipt reads as written after commit 1
  assert.match(gateFull(dir, 'git add c.txt && git commit -m two').stderr, /made before this receipt was written/, 'an older commit is outside the receipt');
});

test('audit 2026-10-10 C17: a single-project push needs no scope: line', () => {
  const { dir, git } = pushRepo();
  fs.mkdirSync(path.join(dir, 'libs', 'feature-admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'libs', 'feature-admin', 'a.ts'), forty());
  git('add', '-A'); git('commit', '-qm', 'feat: admin');
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { scope: null }));
  assert.equal(gateIn(dir, 'git push'), 0, 'one project touched - the probe needs no scope line');
});

test('audit 2026-10-10 C18: a commit receipt carries the formatter check and its clean verdict', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const at = (format) => { writeReceipt(dir, 'COMMIT-GATE', commitReceipt(head, { first: 'VERIFIED the checkpoint', format })); return gateFull(dir, 'git commit -am x'); };
  const none = at(null);
  assert.equal(none.status, 2, 'no format: line');
  assert.match(none.stderr, /no format: line - a commit receipt records the formatter CHECK/);
  assert.equal(at('format: npx prettier --check - 2 files need formatting').status, 2, 'a format line with no clean verdict');
  assert.equal(at('format: npx prettier --check src - clean over 3 staged files').status, 0, 'the check and its clean verdict');
  assert.equal(at('format: dotnet format --verify-no-changes - Clean over 3 staged files').status, 0, 'case does not matter');
  assert.equal(at('format: skipped - "skip the formatter, just commit"').status, 0, 'the user\'s quoted waiver stands in');
  assert.equal(at('format: skipped - "what time is it?"').status, 2, 'a quote that waives nothing does not');
  // the publish receipt is not held to it
  const { dir: pdir, git } = pushRepo();
  fs.writeFileSync(path.join(pdir, 'b.txt'), forty()); git('add', '-A'); git('commit', '-qm', 'b');
  writeReceipt(pdir, 'PUSH-GATE', pushReceipt(headOf(pdir)));
  assert.equal(gateIn(pdir, 'git push'), 0, 'a push receipt needs no format: line');
});

test('audit 2026-10-10 C17: the scope survey never resets an index holding staged work', () => {
  const dir = scratchRepo();
  assert.equal(gateIn(dir, 'git add -N . && git diff HEAD --stat; git reset -q'), 0, 'nothing staged - the survey passes as before');
  spawnSync('git', ['-C', dir, 'add', 'a.txt']);
  const r = gateFull(dir, 'git add -N . && git diff HEAD --stat; git reset -q');
  assert.equal(r.status, 2, 'a bare reset would unstage a.txt');
  assert.match(r.stderr, /git diff HEAD --stat; git ls-files -o --exclude-standard/, 'names the index-free survey');
  assert.equal(gateIn(dir, 'git add -N . && git diff HEAD --stat; git reset -q -- b.txt'), 0, 'a reset of named paths leaves the rest staged');
  assert.equal(gateIn(dir, 'git diff HEAD --stat; git ls-files -o --exclude-standard'), 0, 'the index-free survey');
});

// ---------------------------------------------------------------------------------------------
// audit 2026-10-10 (T4 cross-track: C30, C17, C18): the receipt's findings: line, its security count, a review older than
// the staged files, an ask answered before the review, and the denial naming the picked option
// ---------------------------------------------------------------------------------------------
test('audit 2026-10-10 C30: a commit receipt carries the review\'s findings: line', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const at = (findings) => { writeReceipt(dir, 'COMMIT-GATE', commitReceipt(head, { first: 'VERIFIED the checkpoint', findings })); return gateFull(dir, 'git commit -am x'); };
  const none = at(null);
  assert.equal(none.status, 2, 'no findings: line');
  assert.match(none.stderr, /no findings: line - a commit receipt carries the review's Findings field/);
  assert.equal(at('findings:').status, 2, 'an empty findings: line');
  assert.equal(at('findings: none').status, 0);
  assert.equal(at('findings: 0 BLOCKER, 0 MATERIAL, 2 MINOR').status, 0, 'a count by severity');
  assert.equal(at('findings: skipped - "skip the review, just commit"').status, 0, 'the user\'s quoted waiver');
  assert.equal(at('findings: skipped - "what time is it?"').status, 2, 'a quote that waives nothing');
  assert.equal(at('findings: none\nreviewer-note: an unknown line').status, 0, 'an unknown line is never refused');
});

test('audit 2026-10-10 C18: security: over <N> files is held to what the commit takes in', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const at = (sec) => {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(head, { first: 'VERIFIED the checkpoint and the security review', spec: `spec: 3 files\n${sec}` }));
    return gateFull(dir, 'git add -A && git commit -m x');
  };
  const short = at('security: auth ok, secrets ok - over 1 files');
  assert.equal(short.status, 2, 'the security half read 1 of 3 files');
  assert.match(short.stderr, /security: covered 1 file\(s\) but this commit takes in 3/);
  assert.equal(at('security: auth ok, secrets ok - over 3 files').status, 0);
  assert.equal(at('security: auth ok, secrets ok').status, 0, 'no count: not compared');
});

test('audit 2026-10-10 C17: a receipt written before a staged file last changed does not cover it', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(head, { first: 'VERIFIED the checkpoint' }));
  const receipt = path.join(dir, '.alfred', 'docs', 'flow', 'COMMIT-GATE');
  // a.txt moves a minute past the receipt, rather than the receipt a minute back: that would predate the session (H4)
  const aTxt = path.join(dir, 'a.txt');
  const written = fs.statSync(aTxt).mtime;
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(aTxt, later, later);
  const r = gateFull(dir, 'git commit -am x');
  assert.equal(r.status, 2, 'a.txt changed after the receipt');
  assert.match(r.stderr, /a\.txt changed after this receipt was written - the review never saw that version/);
  fs.utimesSync(aTxt, written, written);
  fs.utimesSync(receipt, new Date(), new Date());
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a receipt written after the last edit');
  // inside the clock slack
  const now = Date.now();
  fs.utimesSync(receipt, new Date(now - 1000), new Date(now - 1000));
  fs.utimesSync(path.join(dir, 'a.txt'), new Date(now), new Date(now));
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'one second apart is within the 2s slack');
});

test('audit 2026-10-10 C17: an answered: ask that came before every review is no consent to the reviewed commit', () => {
  const dir = scratchRepo();
  // the edits came before the 09:10 review these rows date, so the review saw them (the freshness check, 2026-10-22)
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.utimesSync(path.join(dir, f), new Date('2026-10-10T08:00:00Z'), new Date('2026-10-10T08:00:00Z'));
  const answer = (ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'Your questions have been answered' }] }, toolUseResult: { answers: { 'Commit the fix now?': 'Commit (Recommended)' } } });
  const review = (ts) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'task-verify-code' } }] } });
  const early = writeTranscript(dir, 'ask-first', [answer('2026-10-10T09:17:02Z'), review('2026-10-10T09:25:41Z'), resultRow('2026-10-10T09:28:00Z')]);
  const late = writeTranscript(dir, 'review-first', [review('2026-10-10T09:10:00Z'), resultRow('2026-10-10T09:12:00Z'), answer('2026-10-10T09:17:02Z')]);
  const seat = writeTranscript(dir, 'seat-first', [{ type: 'assistant', timestamp: '2026-10-10T09:10:00Z', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'alfred-code:aspnet-verifier', prompt: 'review the change: `git diff HEAD`' } }] } },
    { type: 'user', timestamp: '2026-10-10T09:12:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'VERIFIED - no findings' }] } }, answer('2026-10-10T09:17:02Z')]);
  const noReview = writeTranscript(dir, 'no-review', [answer('2026-10-10T09:17:02Z')]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint', auth: 'answered: Commit (Recommended)' }));
  const r = gateWith(dir, 'git commit -am x', { transcript_path: early });
  assert.equal(r.status, 2, 'the ask was answered before the review ran (a3d497f8)');
  assert.match(r.stderr, /was answered before any review ran in this session/);
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: late }).status, 0, 'review, then the ask');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: seat }).status, 0, 'a verifier seat counts as the review');
  const unreviewed = gateWith(dir, 'git commit -am x', { transcript_path: noReview });
  assert.equal(unreviewed.status, 2, 'no review in the transcript: the ask is not judged, the receipt is refused (2026-10-22)');
  assert.match(unreviewed.stderr, /names no review and no review ran in this session/);
});

test('2026-10-22 own reviewers: review-code and review-security are reviews the gate reads, the built-in is not, and the denial names ours', () => {
  const dir = scratchRepo();
  const answer = (ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'Your questions have been answered' }] }, toolUseResult: { answers: { 'Commit the fix now?': 'Commit (Recommended)' } } });
  const skill = (ts, name) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: name } }] } });
  const ours = ['review-code', 'review-security'].map((name) => [name, writeTranscript(dir, `ask-first-${name}`, [answer('2026-10-22T09:17:02Z'), skill('2026-10-22T09:25:41Z', name), resultRow('2026-10-22T09:28:00Z')])]);
  const builtin = writeTranscript(dir, 'ask-first-builtin', [answer('2026-10-22T09:17:02Z'), skill('2026-10-22T09:25:41Z', 'security-review')]);
  const silent = writeTranscript(dir, 'no-skill', [{ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'x' }] } }]);
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint', auth: 'answered: Commit (Recommended)' }));
  for (const [name, tp] of ours) {
    const r = gateWith(dir, 'git commit -am x', { transcript_path: tp });
    assert.equal(r.status, 2, `${name} is a review: the ask came before it`);
    assert.match(r.stderr, /was answered before any review ran in this session/);
  }
  const builtinOnly = gateWith(dir, 'git commit -am x', { transcript_path: builtin });
  assert.equal(builtinOnly.status, 2, 'the built-in is no review the gate reads: the ask is not judged, and no review ran');
  assert.match(builtinOnly.stderr, /names no review and no review ran in this session/);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  const replay = gateWith(dir, 'git commit -am x', { transcript_path: silent });
  assert.equal(replay.status, 2, 'a receipt naming review-code with no Skill call is a replay');
  assert.match(replay.stderr, /names review-code, but no run of it in this session reached its result line/);
  // the user's TYPED review is the run too: `/review-code` arrives as a command-name row, never a Skill tool call
  for (const name of ['review-code', 'review-security']) {
    // the transcript first: a receipt written before the session began is absent
    const typed = writeTranscript(dir, `typed-${name}`, [{ type: 'user', message: { role: 'user', content: `<command-name>/${name}</command-name>` } }, resultRow()]);
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: `VERIFIED ${name} inline` }) + 'security: auth ok, secrets ok, injection ok, data-access n/a - over 9 files\n');
    const r = gateWith(dir, 'git commit -am x', { transcript_path: typed });
    assert.doesNotMatch(r.stderr, /reached its result line/, `a typed /${name} is the review run`);
    assert.equal(r.status, 0, `and the receipt stands: ${r.stderr.slice(0, 200)}`);
  }
  const bare = gateFull(scratchRepo(), 'git commit -am x');
  assert.equal(bare.status, 2, 'no receipt');
  assert.match(bare.stderr, /task-verify-code or review-code, plus review-security/, 'the denial names our reviews');
  assert.doesNotMatch(bare.stderr, /\/security-review|\/code-review/, 'never the built-in');
});

test('2026-10-22 review proof: a VERIFIED line naming a review needs a run of that review, never any skill load', () => {
  const dir = scratchRepo();
  const skill = (id, name) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `t${id}`, name: 'Skill', input: { skill: name } }] } });
  const SEC = 'security: auth ok, secrets ok, injection ok, data-access n/a - over 3 files\n';
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const other = writeTranscript(dir, 'other-skill', [skill('a', 'javascript'), resultRow()]);
  const typedOther = writeTranscript(dir, 'typed-other', [{ type: 'user', message: { role: 'user', content: '<command-name>/habits-root-cause</command-name>' } }]);
  const secOnly = writeTranscript(dir, 'sec-only', [skill('a', 'review-security'), resultRow()]);
  const both = writeTranscript(dir, 'both', [skill('a', 'review-code'), resultRow(), skill('b', 'review-security'), resultRow()]);
  const spaced = writeTranscript(dir, 'namespaced', [skill('a', 'alfred-code:review-code'), resultRow()]);
  const taskVerify = writeTranscript(dir, 'task-verify', [skill('a', 'task-verify-code'), resultRow()]);
  const none = writeTranscript(dir, 'none', [{ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'x' }] } }]);
  // the result line, 2026-10-22 (the user's 'Fix ALL left gaps'): a review counts once its line follows the call
  const launched = writeTranscript(dir, 'launched', [skill('a', 'review-code')]);
  const before = writeTranscript(dir, 'line-before', [resultRow(), skill('a', 'review-code')]);
  const prose = writeTranscript(dir, 'prose', [skill('a', 'review-code'), resultRow(undefined, 'No findings so far, still reading.')]);
  const bold = writeTranscript(dir, 'bold', [skill('a', 'review-code'), resultRow(undefined, 'table\n\n**Findings:** 1 BLOCKER, 0 MATERIAL, 0 MINOR')]);
  const abandoned = writeTranscript(dir, 'abandoned', [skill('a', 'review-security'), skill('b', 'review-code'), resultRow()]);
  const seatReport = writeTranscript(dir, 'seat-report', [skill('a', 'review-code'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'v1', name: 'Agent', input: { subagent_type: 'alfred-code:node-verifier', prompt: 'review `git diff HEAD`' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'v1', content: [{ type: 'text', text: 'table\nFindings: none\nstatus: SIGNED_OFF' }] }] } }]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  for (const tp of [other, typedOther]) {
    const r = gateWith(dir, 'git commit -am x', { transcript_path: tp });
    assert.equal(r.status, 2, 'another skill\'s load is not the review the receipt names');
    assert.match(r.stderr, /names review-code, but no run of it in this session reached its result line/);
  }
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: spaced }).status, 0, 'a namespaced review-code is the run');
  for (const [tp, why] of [[launched, 'a review that only launched'], [before, 'a result line before the call'], [prose, 'prose naming no result field']]) {
    const r = gateWith(dir, 'git commit -am x', { transcript_path: tp });
    assert.equal(r.status, 2, why);
    assert.match(r.stderr, /reached its result line/, why);
  }
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: bold }).status, 0, 'a bold Findings line is the result');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: seatReport }).status, 0, 'the report of a seat the review sent carries its result');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code + review-security inline' }) + SEC);
  const half = gateWith(dir, 'git commit -am x', { transcript_path: secOnly });
  assert.equal(half.status, 2, 'each review the line names must have run');
  assert.match(half.stderr, /names review-code, but no run of it/);
  assert.doesNotMatch(half.stderr, /names review-code, review-security/, 'only the missing one is named');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: both }).status, 0, 'both ran');
  const left = gateWith(dir, 'git commit -am x', { transcript_path: abandoned });
  assert.equal(left.status, 2, 'the line closes the newest open review only: the security review left open never reported');
  assert.match(left.stderr, /names review-security, but no run of it/);
  // a legacy spelling still needs a verify skill: verify-code is met by task-verify-code, never by another skill
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED verify-code passed' }));
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: taskVerify }).status, 0, 'task-verify-code is a verify-code run');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: other }).status, 2, 'javascript is not');
  // the tool-usage ledger is no evidence (2026-10-22)
  const ledger = path.join(dir, '.alfred', 'statistics', 'tools-usage');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'sess-rc.jsonl'), JSON.stringify({ ts: 'x', session: 'sess-rc', tool: 'Skill', detail: 'review-code', cwd: dir }) + '\n');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: none, session_id: 'sess-rc' }).status, 2, 'a ledger row for review-code is no run');
  // every old spelling the manifest renames into a review is a run of it, and a receipt naming one is met by today's run
  const renamed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed.skills;
  const REVIEWS = /^(?:task-verify-(?:code|plan)|loop-(?:code-quality|architecture-quality|test-coverage(?:-quality)?)|review-(?:code|security))$/;
  const rows = Object.entries(renamed).filter(([, now]) => REVIEWS.test(now));
  assert.ok(rows.length >= 11, 'the manifest renames the reviews');
  for (const [old, now] of rows) {
    // a plan review reads no code: its session ran one of the code too, so the named check is what these cases judge
    const plus = /verify-plan$/.test(now) ? [REVIEW_ROW] : [];
    // a loop's result is its Outcome line, every other review's its Findings line
    const done = resultRow(undefined, /^loop-/.test(now) ? '**Outcome**: SATISFIED on round 1' : 'Findings: none');
    const typed = writeTranscript(dir, `old-${old}`, [...plus, { type: 'user', message: { role: 'user', content: `<command-name>/${old}</command-name>` } }, done]);
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: `VERIFIED ${now} passed` }));
    assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: typed }).status, 0, `a typed /${old} is a ${now} run`);
    const today = writeTranscript(dir, `new-${old}`, [...plus, skill('a', now), done]);
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: `VERIFIED ${old} passed` }));
    assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: today }).status, 0, `a receipt naming ${old} is met by ${now}`);
    if (/^loop-/.test(now)) {
      const wrong = writeTranscript(dir, `wrong-${old}`, [...plus, skill('a', now), resultRow()]);
      writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: `VERIFIED ${now} passed` }));
      assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: wrong }).status, 2, `a Findings line is no ${now} result`);
    }
  }
});

// 2026-10-29: the coverage loop is loop-test-coverage-quality; a VERIFIED line naming either spelling is met by its run.
test('a VERIFIED line naming loop-test-coverage-quality is met by its run', () => {
  const dir = scratchRepo();
  const skill = (id, name) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `t${id}`, name: 'Skill', input: { skill: name } }] } });
  const ran = writeTranscript(dir, 'coverage-loop', [skill('a', 'loop-test-coverage-quality'), resultRow(undefined, '**Outcome**: SATISFIED on round 1')]);
  // the first name, on an older copy: read from the rename map, its one home
  const { renamed } = require('./install/manifest.js').loadManifest(path.join(__dirname, '..'));
  const olds = Object.keys(renamed.skills).filter((k) => renamed.skills[k] === 'loop-test-coverage-quality' && !/^(alfred|project)-/.test(k));
  assert.ok(olds.length >= 1, 'the map renames the loop');
  for (const named of ['loop-test-coverage-quality', ...olds]) {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: `VERIFIED ${named} passed` }));
    const r = gateWith(dir, 'git commit -am x', { transcript_path: ran });
    assert.equal(r.status, 0, `VERIFIED ${named}: ${r.stderr}`);
  }
  // the name is read as a review: a session that ran only another review does not meet it
  const other = writeTranscript(dir, 'other-review', [skill('b', 'review-code'), resultRow()]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED loop-test-coverage-quality passed' }));
  const unmet = gateWith(dir, 'git commit -am x', { transcript_path: other });
  assert.equal(unmet.status, 2, 'a review-code run is no coverage loop run');
  assert.match(unmet.stderr, /names loop-test-coverage-quality, but no run of it/);
});

// 2026-10-22, a side agent's note on the fix above: a VERIFIED line naming NO review skipped that check, so `VERIFIED the
// checkpoint` passed with no review in the session. The user's ruling 'Need any review run': any wording passes once a
// review of the code ran; a carried review and the user's waiver need none. A whitespace-only diff needed none until the
// user's 'Fix ALL left gaps' (2026-10-22): git's -w reads `rm -rf / tmp` for `/tmp` as no change.
// Review 2026-10-23: the review words came from an unguarded top-level require, so a prelude without them (one older
// than this hook) threw outside any try - and the dispatcher fails a throwing guard open, passing every commit. Now
// no review is seen: the checks that need one refuse, and a carried review still passes.
test('review 2026-10-23: a prelude without the review words refuses what needs a review, never crashes open', () => {
  const dir = scratchRepo();
  const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'old-prelude-'));
  for (const f of fs.readdirSync(HOOKS)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HOOKS, f), path.join(hooks, f));
  const words = ['bareSkill', 'reviewKind', 'REVIEW_SKILL', 'REVIEW_SEAT', 'codeReviewCall', 'reviewTargets', 'reviewCovers', 'briefTargets', 'REVIEW_PROOF', 'reviewProof', 'REVIEW_SNAPSHOT', 'snapshotReview', 'readReviewSnapshots', 'heldByReview'];
  fs.appendFileSync(path.join(hooks, 'hook-prelude.js'), `\nfor (const k of ${JSON.stringify(words)}) delete module.exports[k];\n`);
  const gate = () => spawnSync(process.execPath, [path.join(hooks, 'guard-ungated-commit.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, transcript_path: REVIEWED }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  const r = gate();
  assert.equal(r.status, 2, `a reviewed transcript under an old prelude is refused, not crashed (${r.stderr.slice(0, 200)})`);
  assert.match(r.stderr, /names no review and no review ran in this session/);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }) + 'carried: c1, reviewed 2026-10-21\n');
  assert.equal(gate().status, 0, 'a carried review needs no run here');
  fs.rmSync(hooks, { recursive: true, force: true });
});

test('2026-10-22 review proof: a commit receipt naming no review needs some review of the code in the session', () => {
  const dir = scratchRepo();
  const skill = (id, name) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `t${id}`, name: 'Skill', input: { skill: name } }] } });
  const seat = { type: 'assistant', message: { id: 's', content: [{ type: 'tool_use', id: 'ts', name: 'Agent', input: { subagent_type: 'alfred-code:node-verifier', prompt: 'review the change: `git diff HEAD`' } }] } };
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const other = writeTranscript(dir, 'nr-other', [skill('a', 'javascript')]);
  const plan = writeTranscript(dir, 'nr-plan', [skill('a', 'task-verify-plan'), resultRow()]);
  const reviewed = writeTranscript(dir, 'nr-reviewed', [skill('a', 'review-security'), resultRow()]);
  const seated = writeTranscript(dir, 'nr-seat', [seat, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ts', content: 'VERIFIED - no findings' }] } }]);
  const typed = writeTranscript(dir, 'nr-typed', [{ type: 'user', message: { role: 'user', content: '<command-name>/alfred-code:loop-code-quality</command-name>' } }, resultRow(undefined, '**Outcome**: SATISFIED on round 2')]);
  const typedOpen = writeTranscript(dir, 'nr-typed-open', [{ type: 'user', message: { role: 'user', content: '<command-name>/alfred-code:loop-code-quality</command-name>' } }]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }));
  for (const [tp, why] of [[other, 'only another skill ran'], [plan, 'a plan review reads no code'], [typedOpen, 'a typed loop with no Outcome line yet']]) {
    const r = gateWith(dir, 'git commit -am x', { transcript_path: tp });
    assert.equal(r.status, 2, why);
    assert.match(r.stderr, /names no review and no review ran in this session - run review-code/);
  }
  for (const [tp, why] of [[reviewed, 'a review skill'], [seated, 'a verifier seat'], [typed, 'the user typed a quality loop']]) {
    assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: tp }).status, 0, why);
  }
  // a line naming only the plan review names no review of the code
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED task-verify-plan passed' }));
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: plan }).stderr, /names no review and no review ran/);
  // the tool-usage ledger is no review (2026-10-22), and a review carried from an earlier cycle needs no run here
  const ledger = path.join(dir, '.alfred', 'statistics', 'tools-usage');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'sess-nr.jsonl'), JSON.stringify({ ts: 'x', session: 'sess-nr', tool: 'Skill', detail: 'task-verify-code', cwd: dir }) + '\n');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }));
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: other, session_id: 'sess-nr' }).stderr, /names no review and no review ran/, 'a ledger row for task-verify-code');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }) + 'carried: c2, reviewed 2026-10-21\n');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: other }).status, 0, 'a carried review');

  // a whitespace-only diff is no exemption: spacing inside a string, or between two words a shell reads, is code
  const ws = scanRepo({ 'a.js': nLines(20, 'const a ='), 'b.js': nLines(20, 'const b ='), 'c.sh': nLines(20, 'rm -rf /tmp') });
  const wsOther = writeTranscript(ws.dir, 'ws-other', [skill('a', 'javascript')]);
  for (const f of ['a.js', 'b.js']) ws.write(f, fs.readFileSync(path.join(ws.dir, f), 'utf8').replace(/ =/g, '  =').replace(/\n/g, '\n\n'));
  ws.write('c.sh', fs.readFileSync(path.join(ws.dir, 'c.sh'), 'utf8').replace(/\/tmp/g, '/ tmp'));
  writeReceipt(ws.dir, 'COMMIT-GATE', commitReceipt(headOf(ws.dir), { first: 'VERIFIED formatting-only sweep' }));
  const sweep = gateWith(ws.dir, 'git commit -am x', { transcript_path: wsOther });
  assert.equal(sweep.status, 2, 'a whitespace-only sweep needs a review like any change');
  assert.match(sweep.stderr, /names no review and no review ran in this session - run review-code/);
  assert.doesNotMatch(sweep.stderr, /changes only whitespace/, 'and the denial offers no spacing exemption');

  // the push gate's line names what is published, never a review: not judged here
  const p = pushRepo();
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'seed\nmore\n');
  p.git('commit', '-qam', 'ahead');
  const pushTp = writeTranscript(p.dir, 'push-other', [skill('a', 'javascript')]);
  writeReceipt(p.dir, 'PUSH-GATE', pushReceipt(headOf(p.dir)));
  assert.equal(gateWith(p.dir, 'git push', { transcript_path: pushTp }).status, 0, 'a push receipt naming no review stands');
});

// 2026-10-22, a second side note: any review in the session counted, so one review early in a long session covered a
// commit of work edited hours after it. The user's ruling 'After the last edit': the newest review of the code started
// after the last change to every file the commit takes in.
test('2026-10-22 review proof: the newest review of the code started after the last edit to what is committed', () => {
  const dir = scratchRepo();
  const now = Date.now();
  const min = (n) => new Date(now - n * 60 * 1000);
  // a review skill's call, then its result line
  const skill = (ago, name) => [{ type: 'assistant', timestamp: min(ago).toISOString(), message: { content: [{ type: 'tool_use', id: `s${ago}${name}`, name: 'Skill', input: { skill: name } }] } },
    resultRow(min(ago - 1))];
  const seat = (ago) => ({ type: 'assistant', timestamp: min(ago).toISOString(), message: { content: [{ type: 'tool_use', id: `a${ago}`, name: 'Agent', input: { subagent_type: 'alfred-code:node-verifier', prompt: 'review the change: `git diff HEAD`' } }] } });
  const edit = (ago) => fs.utimesSync(path.join(dir, 'a.txt'), min(ago), min(ago));
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const early = writeTranscript(dir, 'fr-early', [...skill(60, 'review-code')]);
  const again = writeTranscript(dir, 'fr-again', [...skill(60, 'review-code'), ...skill(5, 'review-code')]);
  const planLate = writeTranscript(dir, 'fr-plan', [...skill(60, 'review-code'), ...skill(5, 'task-verify-plan')]);
  const seatLate = writeTranscript(dir, 'fr-seat', [...skill(60, 'review-code'), seat(5), { type: 'user', timestamp: min(4).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a5', content: 'VERIFIED - no findings' }] } }]);
  const lateOpen = writeTranscript(dir, 'fr-open', [...skill(60, 'review-code'), skill(5, 'review-code')[0]]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  edit(120);
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: early }).status, 0, 'the edit came before the review');
  edit(10);
  const stale = gateWith(dir, 'git commit -am x', { transcript_path: early });
  assert.equal(stale.status, 2, 'an edit after the review: no review saw that version');
  assert.match(stale.stderr, /a\.txt changed after the last review of the code covering it started \(\d\d:\d\d\) - no review saw that version; run review-code on it/);
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: again }).status, 0, 'a review run after the edit');
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: planLate }).stderr, /a\.txt changed after the last review/, 'a later plan review reads no code');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: seatLate }).status, 0, 'a verifier seat after the edit');
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: lateOpen }).stderr, /a\.txt changed after the last review/, 'a later review with no result line yet');
  // the ledger's row is no review (2026-10-22)
  const ledger = path.join(dir, '.alfred', 'statistics', 'tools-usage');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'sess-fr.jsonl'), JSON.stringify({ ts: min(5).toISOString(), session: 'sess-fr', tool: 'Skill', detail: 'review-code', cwd: dir }) + '\n');
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: early, session_id: 'sess-fr' }).stderr, /a\.txt changed after the last review/, 'a ledger row after the edit');
  // a carried review is judged where it ran
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }) + 'carried: c2, reviewed 2026-10-21\n');
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: early }).status, 0, 'a carried review');
  // and a whitespace-only sweep after the review is a version no review saw, like any edit (2026-10-22)
  const ws = scanRepo({ 'a.js': nLines(20, 'const a ='), 'b.js': nLines(20, 'const b ='), 'c.js': nLines(20, 'const c =') });
  const wsEarly = writeTranscript(ws.dir, 'ws-early', [...skill(60, 'review-code')]);
  for (const name of ['a.js', 'b.js', 'c.js']) ws.write(name, fs.readFileSync(path.join(ws.dir, name), 'utf8').replace(/ =/g, '  ='));
  writeReceipt(ws.dir, 'COMMIT-GATE', commitReceipt(headOf(ws.dir), { first: 'VERIFIED review-code inline' }));
  assert.match(gateWith(ws.dir, 'git commit -am x', { transcript_path: wsEarly }).stderr, /a\.js, b\.js, c\.js changed after the last review/, 'a whitespace-only sweep after the review');
});

// 2026-10-22, a third side note: the rule above read a file's time, so a rewrite after the review that left the code as
// it was - a stash and pop, a branch round-trip, a formatter's spacing - asked for the review again. The user's ruling
// 'Snapshot at review': when a review of the code starts, the session-start guard records what each changed file
// holds, and a file whose content still matches passes - byte for byte only since the user's 'Fix ALL left gaps'.
test('2026-10-22 review proof: a file rewritten after the review with its code unchanged still passes', () => {
  const dir = scratchRepo();
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  const sid = 'sess-snap';
  const start = (input, session = sid) => runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: session, cwd: dir, ...input }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  // one snapshot file per call: review-snapshot-<session>@<call>.json (review 2026-10-23)
  const sessions = path.join(dir, '.alfred', 'state', 'sessions');
  const snapshots = (session) => { try { return fs.readdirSync(sessions).filter((n) => n.startsWith(`review-snapshot-${session}@`) && n.endsWith('.json')); } catch { return []; } };
  const a = path.join(dir, 'a.txt');
  const body = fs.readFileSync(a, 'utf8');
  const rewrite = (text) => { fs.writeFileSync(a, text); fs.utimesSync(a, ago(10), ago(10)); };
  // the transcript first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const early = writeTranscript(dir, 'sn-early', [{ type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 's60', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(59))]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  const gate = (session = sid) => gateWith(dir, 'git commit -am x', { transcript_path: early, session_id: session });
  rewrite(body);
  assert.equal(gate().status, 2, 'no snapshot holds the content: the time decides');
  // the review starts, and the hook records what a.txt holds
  start({ tool_name: 'Skill', tool_use_id: 's60', tool_input: { skill: 'review-code' } });
  assert.deepEqual(snapshots(sid), ['review-snapshot-sess-snap@s60.json'], 'a review-code call writes its own snapshot file');
  rewrite(body);
  assert.equal(gate().status, 0, 'the same bytes rewritten after the review (a stash and pop)');
  rewrite(body.replace(/\n/g, ' \n\n'));
  assert.equal(gate().status, 2, 'spacing and blank lines are a version no review saw (byte for byte only, 2026-10-22)');
  rewrite(`${body}\nline 40`);
  const edited = gate();
  assert.equal(edited.status, 2, 'a changed token is a version no review saw');
  assert.match(edited.stderr, /a\.txt changed after the last review of the code covering it started/);
  rewrite(body);
  assert.equal(gate('sess-other').status, 2, 'another session\'s snapshot is not this one\'s review');
  // a snapshot whose call never reached its result line vouches for nothing: an older review counted, s60 did not
  const open = writeTranscript(dir, 'sn-open', [{ type: 'assistant', timestamp: ago(120).toISOString(), message: { content: [{ type: 'tool_use', id: 's120', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(119)), { type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 's60', name: 'Skill', input: { skill: 'review-code' } }] } }]);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  const unproven = gateWith(dir, 'git commit -am x', { transcript_path: open, session_id: sid });
  assert.equal(unproven.status, 2, 'the snapshot of a review with no result line');
  assert.match(unproven.stderr, /a\.txt changed after the last review of the code covering it started/);
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  // only a review of the code takes one: the plan review and a seat that writes take none; a verifier seat and the
  // typed command do
  for (const [input, session, taken, why] of [
    [{ tool_name: 'Skill', tool_input: { skill: 'task-verify-plan' } }, 'sess-plan', false, 'a plan review'],
    [{ tool_name: 'Agent', tool_input: { subagent_type: 'alfred-code:node-implementer', prompt: 'x' } }, 'sess-impl', false, 'an implementer seat'],
    [{ tool_name: 'Agent', tool_input: { subagent_type: 'alfred-code:node-verifier', prompt: 'review `git diff HEAD`' } }, 'sess-seat', true, 'a verifier seat'],
    [{ hook_event_name: 'UserPromptExpansion', command_name: 'alfred-code:loop-code-quality', prompt: '/alfred-code:loop-code-quality' }, 'sess-typed', true, 'a typed quality loop'],
  ]) {
    start(input, session);
    assert.equal(snapshots(session).length > 0, taken, why);
  }
});

// 2026-10-22, a fourth side note: both spacing exemptions read indentation as spacing, and in Python, YAML or a Makefile
// it is code - a line moved out of an `if`, a key one level up. The user's ruling 'Exact for those types' closed those
// formats; the user's 'Fix ALL left gaps' closed the rest: spacing inside a string, or `rm -rf / tmp` for `/tmp`, is code
// in any format, so neither exemption is left - a whitespace-only commit needs a review, a snapshot matches byte for byte.
test('2026-10-22 review proof: spacing is a change in every format', () => {
  // forty lines each: a smaller change is under the trivial bar and needs no receipt at all
  const rows = (fn) => Array.from({ length: 40 }, (_, i) => fn(i)).join('');
  const py = `def f(x):\n    if x:\n${rows((i) => `        a${i} = ${i}\n`)}    return x\n`;
  const moved = `def f(x):\n    if x:\n${rows((i) => `    a${i} = ${i}\n`)}    return x\n`;
  const sh = rows((i) => `rm -rf /tmp/build${i}\n`);
  const ws = scanRepo({ 'job.py': py, 'ci.yml': `jobs:\n  build:\n${rows((i) => `    k${i}: ${i}\n`)}`, 'Makefile': `all:\n${rows((i) => `\techo ${i}\n`)}`, 'a.js': nLines(40, 'const a ='), 'clean.sh': sh });
  const other = writeTranscript(ws.dir, 'wm-other', [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'j', name: 'Skill', input: { skill: 'javascript' } }] } }]);
  const sweep = () => {
    writeReceipt(ws.dir, 'COMMIT-GATE', commitReceipt(headOf(ws.dir), { first: 'VERIFIED formatting-only sweep' }));
    return gateWith(ws.dir, 'git commit -am x', { transcript_path: other });
  };
  for (const [file, body, why] of [['job.py', moved, 'lines moved out of an if'], ['ci.yml', `jobs:\n  build:\n${rows((i) => `  k${i}: ${i}\n`)}`, 'YAML keys one level up'],
    ['Makefile', `all:\n${rows((i) => `        echo ${i}\n`)}`, 'recipe tabs made spaces'], ['a.js', nLines(40, 'const a  ='), 'spacing in a .js file'],
    ['clean.sh', sh.replace(/\/tmp/g, '/ tmp'), 'a space that splits one shell word in two']]) {
    const before = fs.readFileSync(path.join(ws.dir, file), 'utf8');
    ws.write(file, body);
    const r = sweep();
    assert.equal(r.status, 2, `${why} is no formatting-only sweep`);
    assert.match(r.stderr, /names no review and no review ran/);
    ws.write(file, before);
  }

  // the snapshot: a file matches what the review saw only byte for byte, whatever its format
  const dir = scratchRepo();
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  const sid = 'sess-indent';
  const p = path.join(dir, 'job.py');
  const j = path.join(dir, 'a.txt');
  fs.writeFileSync(p, py);
  const early = writeTranscript(dir, 'wm-early', [{ type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 's60', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(59))]);
  runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: sid, cwd: dir, tool_name: 'Skill', tool_use_id: 's60', tool_input: { skill: 'review-code' } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  const text = fs.readFileSync(j, 'utf8');
  const gate = (file, body) => {
    fs.writeFileSync(file, body); fs.utimesSync(file, ago(10), ago(10));
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
    return gateWith(dir, 'git add job.py && git commit -am x', { transcript_path: early, session_id: sid });
  };
  assert.equal(gate(p, py).status, 0, 'the same bytes pass');
  const indent = gate(p, moved);
  assert.equal(indent.status, 2, 'a line moved out of the if is a version no review saw');
  assert.match(indent.stderr, /job\.py changed after the last review of the code/);
  gate(p, py);
  const spaced = gate(j, text.replace(/ /g, '  '));
  assert.equal(spaced.status, 2, 'spacing in a text file is a version no review saw too');
  assert.match(spaced.stderr, /a\.txt changed after the last review of the code/);
});

// 2026-10-22, a fifth side note: the scan counted a review's CALL, and a call another hook refused still sits in the
// transcript - the fresh-session gate refusing review-code late in a long session left a 'review' the commit check
// trusted, and its snapshot with it. A call whose result is an error (a hook's denial, an unknown skill) is no review:
// not for the named review, the no-name rule, the freshness rule or the snapshot - and takes no result line after it.
test('2026-10-22 review proof: a review call another hook refused is no review', () => {
  const dir = scratchRepo();
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  const call = (id, n, name, tool = 'Skill') => ({ type: 'assistant', timestamp: ago(n).toISOString(), message: { content: [{ type: 'tool_use', id, name: tool,
    input: tool === 'Skill' ? { skill: name } : { subagent_type: name, prompt: 'x' } }] } });
  const result = (id, n, error) => ({ type: 'user', timestamp: ago(n).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
    ...(error ? { is_error: true, content: `PreToolUse:Skill hook error: [node guard-fresh-session-start.js]: a fresh session first` } : { content: 'Launching skill' }) }] } });
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const refused = writeTranscript(dir, 'rf-skill', [call('r1', 5, 'review-code'), result('r1', 5, true)]);
  const refusedThenLine = writeTranscript(dir, 'rf-line', [call('r1', 5, 'review-code'), result('r1', 5, true), resultRow(ago(4))]);
  const refusedSeat = writeTranscript(dir, 'rf-seat', [call('r2', 5, 'alfred-code:node-verifier', 'Agent'), result('r2', 5, true)]);
  const ranEarly = writeTranscript(dir, 'rf-early', [call('r0', 60, 'review-code'), result('r0', 60, false), resultRow(ago(59)), call('r1', 5, 'review-code'), result('r1', 5, true)]);
  const ran = writeTranscript(dir, 'rf-ran', [call('r0', 60, 'review-code'), result('r0', 60, false), resultRow(ago(59)), call('r3', 5, 'review-code'), result('r3', 5, false), resultRow(ago(4))]);
  const gate = (first, tp, session) => {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first }));
    return gateWith(dir, 'git commit -am x', { transcript_path: tp, ...(session ? { session_id: session } : {}) });
  };
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.utimesSync(path.join(dir, f), ago(120), ago(120));   // edited before every review
  assert.match(gate('VERIFIED review-code inline', refused).stderr, /names review-code, but no run of it in this session reached its result line/, 'a refused review-code is not the run the line names');
  assert.match(gate('VERIFIED review-code inline', refusedThenLine).stderr, /reached its result line/, 'and a result line after it is no one\'s');
  assert.match(gate('VERIFIED the checkpoint', refused).stderr, /names no review and no review ran/, 'nor some review of the code');
  assert.match(gate('VERIFIED the checkpoint', refusedSeat).stderr, /names no review and no review ran/, 'a refused verifier seat neither');
  fs.utimesSync(path.join(dir, 'a.txt'), ago(10), ago(10));
  assert.match(gate('VERIFIED review-code inline', ranEarly).stderr, /a\.txt changed after the last review of the code/, 'the refused call is not the newest review');
  assert.equal(gate('VERIFIED review-code inline', ran).status, 0, 'a review whose result came back clears it');
  // and the snapshot the refused call took holds nothing: the file's time decides
  runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: 'sess-rf', cwd: dir, tool_name: 'Skill', tool_use_id: 'r1', tool_input: { skill: 'review-code' } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  assert.match(gate('VERIFIED review-code inline', ranEarly, 'sess-rf').stderr, /a\.txt changed after the last review/, 'the refused call\'s snapshot');
  assert.equal(gate('VERIFIED review-code inline', ran, 'sess-rf').status, 0, 'a snapshot whose call ran is the review\'s');
});

// 2026-10-22, a sixth side note: the check compared times only, so a review pointed at one file cleared every file the
// commit took in, and its snapshot recorded files it never read. The user's ruling 'Match path targets': review-code and
// review-security cover the paths their arguments name (a folder what it holds; a branch or a PR none of the uncommitted
// change); no target argument, task-verify-code and a loop cover the whole change. A seat covers what its brief names
// (the user's 'Fix ALL left gaps', 2026-10-22): a `git diff` of the whole change, else the paths it names, else nothing.
test('2026-10-22 review proof: a review pointed at paths covers those paths alone', () => {
  const dir = scratchRepo();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'x.txt'), 'x\n');
  git('add', 'lib/x.txt'); git('commit', '-qm', 'lib', '--', 'lib/x.txt');
  fs.writeFileSync(path.join(dir, 'lib', 'x.txt'), forty());
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  for (const f of ['a.txt', 'lib/x.txt']) fs.utimesSync(path.join(dir, f), ago(10), ago(10));
  let id = 0;
  // a review skill's call, then its result line
  const review = (n, name, args) => [{ type: 'assistant', timestamp: ago(n).toISOString(), message: { content: [{ type: 'tool_use', id: `pt${id++}`, name: 'Skill',
    input: args === undefined ? { skill: name } : { skill: name, args } }] } }, resultRow(ago(n - 1))];
  const seatRow = (n, prompt) => ({ type: 'assistant', timestamp: ago(n).toISOString(), message: { content: [{ type: 'tool_use', id: `ps${id}`, name: 'Agent', input: { subagent_type: 'alfred-code:node-verifier', prompt } }] } });
  const seat = (n, prompt) => [seatRow(n, prompt), { type: 'user', timestamp: ago(n - 1).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `ps${id++}`, content: 'VERIFIED - no findings' }] } }];
  const typed = (n, args) => [{ type: 'user', timestamp: ago(n).toISOString(), message: { role: 'user', content: `<command-message>review-code</command-message>\n<command-name>/review-code</command-name>\n<command-args>${args}</command-args>` } }, resultRow(ago(n - 1))];
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const tps = {};
  for (const [k, rows] of Object.entries({
    early: [...review(60, 'review-code')],
    oneFile: [...review(60, 'review-code'), ...review(5, 'review-code', 'a.txt')],
    folder: [...review(60, 'review-code'), ...review(5, 'review-code', 'lib')],
    both: [...review(5, 'review-code', 'a.txt lib/x.txt --depth quick')],
    onlyOne: [...review(5, 'review-code', 'a.txt')],
    branch: [...review(60, 'review-code'), ...review(5, 'review-code', 'develop')],
    security: [...review(60, 'review-code'), ...review(5, 'review-security', 'lib/x.txt')],
    typedOne: [...review(60, 'review-code'), ...typed(5, 'lib/x.txt')],
    whole: [...review(60, 'review-code', 'a.txt'), ...review(5, 'review-code', '--depth deep')],
    planned: [...review(60, 'review-code', 'a.txt'), ...review(5, 'task-verify-code', 'plan-1')],
    seatWhole: [...review(60, 'review-code', 'a.txt'), ...seat(5, 'Read the change with `git diff HEAD` and review it.')],
    seatPath: [...review(5, 'review-code', 'a.txt'), ...seat(5, 'Review `git diff HEAD -- lib/x.txt` (lib/x.txt:3).')],
    seatOne: [...review(60, 'review-code', 'lib/x.txt'), ...seat(5, 'review a.txt')],
    seatNone: [...review(60, 'review-code', 'a.txt'), ...seat(5, 'review the parser change')],
    seatRange: [...review(60, 'review-code', 'a.txt'), ...seat(5, 'review `git diff main..HEAD`')],
  })) tps[k] = writeTranscript(dir, `pt-${k}`, rows);
  const gate = (k, session) => {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
    return gateWith(dir, 'git commit -am x', { transcript_path: tps[k], ...(session ? { session_id: session } : {}) });
  };
  const refuses = (k, re, why) => { const r = gate(k); assert.equal(r.status, 2, why); assert.match(r.stderr, re, why); return r; };
  refuses('early', /a\.txt, lib\/x\.txt changed after the last review of the code covering them started/, 'an edit after the whole-change review');
  const one = refuses('oneFile', /^.*lib\/x\.txt changed after the last review of the code covering it started/m, 'a review of a.txt leaves lib/x.txt stale');
  assert.doesNotMatch(one.stderr, /a\.txt, lib/, 'and names only the file it did not cover');
  refuses('folder', /a\.txt changed after the last review of the code covering it started/, 'a folder target covers what it holds, nothing else');
  assert.equal(gate('both').status, 0, 'a review naming both files');
  refuses('onlyOne', /lib\/x\.txt is in no review of the code this session ran \(the last, at \d\d:\d\d, was pointed at other paths, or was a seat whose brief named none of it/, 'a file no review covered');
  refuses('branch', /a\.txt, lib\/x\.txt changed after the last review of the code covering them started/, 'a branch target covers none of the uncommitted change');
  refuses('security', /a\.txt changed after the last review of the code covering it/, 'review-security reads its target the same way');
  refuses('typedOne', /a\.txt changed after the last review of the code covering it/, 'and so does the typed command');
  for (const k of ['whole', 'planned', 'seatWhole']) assert.equal(gate(k).status, 0, `${k}: covers the whole change`);
  assert.equal(gate('seatPath').status, 0, 'a seat whose brief names lib/x.txt covers it, beside a review of a.txt');
  refuses('seatOne', /lib\/x\.txt changed after the last review of the code covering it/, 'a seat whose brief names a.txt covers a.txt alone');
  refuses('seatNone', /lib\/x\.txt/, 'a seat whose brief names no path and no git diff covers nothing');
  refuses('seatRange', /lib\/x\.txt/, 'a diff of a commit range reads none of the uncommitted change');
  // the snapshot of a review pointed at paths holds only those
  const start = (session, args, toolUseId) => runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: session, cwd: dir, tool_name: 'Skill', tool_use_id: toolUseId, tool_input: { skill: 'review-code', args } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  // the snapshot is the early transcript's own call (pt0), so it counts once that call reported
  start('sess-pt', 'a.txt', 'pt0');
  const held = fs.readFileSync(path.join(dir, '.alfred', 'state', 'sessions', 'review-snapshot-sess-pt@pt0.json'), 'utf8');
  assert.match(held, /a\.txt"/, 'the snapshot holds the file the review was pointed at');
  assert.doesNotMatch(held, /x\.txt"/, 'and not a file it never read');
  for (const f of ['a.txt', 'lib/x.txt']) { fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f))); fs.utimesSync(path.join(dir, f), ago(10), ago(10)); }
  const rewritten = gate('early', 'sess-pt');
  assert.equal(rewritten.status, 2, 'a rewrite of the file the snapshot never held is judged by its time');
  assert.match(rewritten.stderr, /^.*lib\/x\.txt changed after the last review/m);
  assert.doesNotMatch(rewritten.stderr, /a\.txt, lib/, 'while the file it held passes');
});

// 2026-10-22, a seventh side note: a review seat counted from its dispatch, so one still running - or sent to the
// background, whose result is only a launch notice - cleared a commit before it reported. The user's ruling 'Seats must
// finish': a foreground seat counts at its result row, a background one at its completed task notification; its snapshot
// counts from then too. A Skill review counts at its result line (the test above).
test('2026-10-22 review proof: a review seat counts once it has reported', () => {
  const dir = scratchRepo();
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.utimesSync(path.join(dir, f), ago(120), ago(120));
  const BRIEF = 'review the change: `git diff HEAD`';
  const dispatch = (id, n, bg) => ({ type: 'assistant', timestamp: ago(n).toISOString(), message: { content: [{ type: 'tool_use', id, name: 'Agent',
    input: { subagent_type: 'alfred-code:node-verifier', prompt: BRIEF, ...(bg ? { run_in_background: true } : {}) } }] } });
  const result = (id, n, content, extra = {}) => ({ type: 'user', timestamp: ago(n).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });
  const launched = (id, n) => result(id, n, [{ type: 'text', text: 'Async agent launched successfully. agentId: x' }], { toolUseResult: { status: 'async_launched' } });
  const note = (id, n, status) => ({ type: 'user', timestamp: ago(n).toISOString(), message: { role: 'user',
    content: `<task-notification>\n<task-id>x1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>/tmp/x1.output</output-file>\n<status>${status}</status>\n<summary>Agent done</summary>\n</task-notification>` } });
  // the transcripts first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const running = writeTranscript(dir, 'sf-running', [dispatch('v1', 5)]);
  const reported = writeTranscript(dir, 'sf-reported', [dispatch('v1', 5), result('v1', 4, 'VERIFIED - no findings')]);
  const background = writeTranscript(dir, 'sf-bg', [dispatch('v2', 5, true), launched('v2', 5)]);
  const bgDone = writeTranscript(dir, 'sf-bg-done', [dispatch('v2', 5, true), launched('v2', 5), note('v2', 3, 'completed')]);
  const bgFailed = writeTranscript(dir, 'sf-bg-failed', [dispatch('v2', 5, true), launched('v2', 5), note('v2', 3, 'failed')]);
  const otherDone = writeTranscript(dir, 'sf-bg-other', [dispatch('v2', 5, true), launched('v2', 5), note('v9', 3, 'completed')]);
  const gate = (tp, session) => {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }));
    return gateWith(dir, 'git commit -am x', { transcript_path: tp, ...(session ? { session_id: session } : {}) });
  };
  for (const [tp, why] of [[running, 'a seat still running'], [background, 'a background seat that only launched'], [bgFailed, 'a background seat that failed'],
    [otherDone, 'another task\'s notification']]) {
    assert.match(gate(tp).stderr, /names no review and no review ran in this session/, why);
  }
  assert.equal(gate(reported).status, 0, 'a foreground seat that reported');
  assert.equal(gate(bgDone).status, 0, 'a background seat whose notification says completed');
  // the snapshot a running seat's dispatch took vouches for nothing until it reports
  const early = writeTranscript(dir, 'sf-snap', [{ type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 'r0', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(59)), dispatch('v3', 5)]);
  const earlyDone = writeTranscript(dir, 'sf-snap-done', [{ type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 'r0', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(59)), dispatch('v3', 5), result('v3', 4, 'VERIFIED - no findings')]);
  runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: 'sess-sf', cwd: dir, tool_name: 'Agent', tool_use_id: 'v3', tool_input: { subagent_type: 'alfred-code:node-verifier', prompt: BRIEF } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  for (const f of ['a.txt', 'b.txt', 'c.txt']) { fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f))); fs.utimesSync(path.join(dir, f), ago(10), ago(10)); }
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  assert.match(gateWith(dir, 'git commit -am x', { transcript_path: early, session_id: 'sess-sf' }).stderr, /a\.txt changed after the last review of the code/, 'the running seat\'s snapshot');
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
  assert.equal(gateWith(dir, 'git commit -am x', { transcript_path: earlyDone, session_id: 'sess-sf' }).status, 0, 'and once it reported, its time and its snapshot count');
});

// 2026-10-22, a gap found in the close of the rulings above: the snapshot read the work tree, while a plain commit takes
// the index - staging an unreviewed version, then putting the reviewed text back in the tree, passed. A file whose index
// stages a version of its own passes the snapshot only when a review saw both.
test('2026-10-22 review proof: a staged version no review saw is refused though the tree holds the reviewed one', () => {
  const dir = scratchRepo();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const ago = (n) => new Date(Date.now() - n * 60 * 1000);
  const a = path.join(dir, 'a.txt');
  const reviewed = fs.readFileSync(a, 'utf8');
  // the transcript first: a receipt written before the session began is absent (audit 2026-10-20 H4)
  const early = writeTranscript(dir, 'st-early', [{ type: 'assistant', timestamp: ago(60).toISOString(), message: { content: [{ type: 'tool_use', id: 'r0', name: 'Skill', input: { skill: 'review-code' } }] } },
    resultRow(ago(59))]);
  runIn('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: 'sess-st', cwd: dir, tool_name: 'Skill', tool_use_id: 'r0', tool_input: { skill: 'review-code' } }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  const gate = () => {
    writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED review-code inline' }));
    return gateWith(dir, 'git commit -m x', { transcript_path: early, session_id: 'sess-st' });
  };
  // stage a version the review never saw, then put the reviewed text back in the tree
  fs.writeFileSync(a, `${reviewed}\nline 40 unreviewed`); git('add', 'a.txt');
  fs.writeFileSync(a, reviewed); fs.utimesSync(a, ago(10), ago(10));
  const staged = gate();
  assert.equal(staged.status, 2, 'the index holds a version no review saw');
  assert.match(staged.stderr, /a\.txt changed after the last review of the code covering it started/);
  // once the index holds the reviewed version too, the snapshot vouches for what is committed
  git('add', 'a.txt'); fs.utimesSync(a, ago(10), ago(10));
  assert.equal(gate().status, 0, 'index and tree both hold what the review saw');
  // a file gone from the tree whose index still stages a version of its own is judged by that version (the user's 'Fix
  // ALL left gaps', 2026-10-22: the time check skipped a file it could not stat)
  fs.writeFileSync(a, `${reviewed}\nline 40 unreviewed`); git('add', 'a.txt'); fs.unlinkSync(a);
  const gone = gate();
  assert.equal(gone.status, 2, 'a staged version no review saw, the tree file deleted');
  assert.match(gone.stderr, /a\.txt changed after the last review of the code covering it started/);
  fs.writeFileSync(a, reviewed); git('add', 'a.txt'); fs.unlinkSync(a);
  assert.equal(gate().status, 0, 'the staged version the review saw, the tree file deleted');
});

test('audit 2026-10-10 C17: a refused consent quote names the option the user picked', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), forty()); git('add', '-A'); git('commit', '-qm', 'b');
  // the transcript first: a PUSH-GATE written before the session began is absent
  const tp = writeTranscript(dir, 'picked', [{ type: 'user', timestamp: '2026-10-10T14:52:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'answered' }] }, toolUseResult: { answers: { 'Publish now?': 'Publish (Recommended)' } } }]);
  writeReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir), { auth: 'authorized: "commit and oush to develop"' }));
  const r = gateWith(dir, 'git push', { transcript_path: tp });
  assert.equal(r.status, 2, 'a typo carries no publish verb (bda299a8)');
  assert.match(r.stderr, /this session's latest ask was answered "Publish \(Recommended\)"; a picked option is written `answered: Publish \(Recommended\)`/);
});

// Audit 2026-10-11 SD16, session 2ca8e8ee: a throwaway replay commit in a DETACHED scratch worktree (`cd "$WT"`, WT
// assigned in the same command) was judged in the project's 39-file tree and held for its receipt.
test('audit 2026-10-11 SD16: a literal cd "$WT" is followed, and a detached scratch worktree under the temp dir is no project history', () => {
  const dir = scratchRepo();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-scratch-')));
  const detachedWt = path.join(scratch, 'replay');
  git('worktree', 'add', '-q', '--detach', detachedWt);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(detachedWt, f), forty());
  assert.equal(gateIn(dir, `WT=${detachedWt}; cd "$WT" && git add -A && git commit -qm replay`), 0, 'the measured scratch commit');
  assert.equal(gateIn(dir, `cd ${detachedWt} && git commit -qam replay`), 0, 'a literal cd too');
  assert.equal(gateIn(dir, `git -C ${detachedWt} commit -qam replay`), 0, 'and -C');
  // the cd resolution on its own: a worktree on a BRANCH is gated in its own tree
  const clean = scratchRepo();
  spawnSync('git', ['-C', clean, 'checkout', '-q', '--', '.'], { encoding: 'utf8' });
  for (const f of ['b.txt', 'c.txt']) fs.rmSync(path.join(clean, f), { force: true });
  const branchWt = path.join(scratch, 'feature');
  spawnSync('git', ['-C', clean, 'worktree', 'add', '-q', '-b', 'feature', branchWt], { encoding: 'utf8' });
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(branchWt, f), forty());
  assert.equal(gateIn(clean, `WT=${branchWt}; cd "$WT" && git add -A && git commit -qm feature`), 2, 'a branch worktree is real history: gated in ITS tree (the clean project would pass)');
  assert.equal(gateIn(clean, 'WT=$(mktemp -d); cd "$WT" && git commit -qam x'), 0, 'a computed cd stays unread: the clean project is judged');
  assert.equal(gateIn(dir, 'WT=$(mktemp -d); cd "$WT" && git commit -qam x'), 2, '... and the dirty one is gated');
  assert.equal(gateIn(dir, `cd "$WT" && git commit -qam x; WT=${detachedWt}`), 2, 'an assignment AFTER the cd is not its value');
  // the staged scan still runs in a scratch tree
  fs.writeFileSync(path.join(detachedWt, 'd.txt'), '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n');
  assert.equal(gateIn(dir, `cd ${detachedWt} && git add -A && git commit -qm replay`), 2, 'a conflict marker is still caught');
});

// Deep hooks review 2026-10-16 (the user's ruling: the hooks read English only): a quote holding any letter outside ASCII is
// no consent on either gate - the Ukrainian lists had read 'закомітив, не пуш' and 'Я зміни закомітив, перевір' as consent -
// and the denial routes to an ask; a waiver can be a picked option too, while someone is at the terminal.
test('deep review: a non-English quote is no consent and names the answered: route; a waiver can be picked', () => {
  const dir = scratchRepo();
  const head = headOf(dir);
  const push = (words) => { writeReceipt(dir, 'PUSH-GATE', pushReceipt(head, { auth: `authorized: "${words}"` })); return gateFull(dir, 'git push'); };
  const commit = (words) => {
    writeReceipt(dir, 'COMMIT-GATE', ['VERIFIED the checkpoint', `authorized: "${words}"`, `head: ${head}`, 'spec: 1 file', 'live-probe: NOT RUN - fixture', FMT].join('\n') + '\n');
    return gateFull(dir, 'git commit -am x');
  };
  for (const words of ['закоміть', 'Я зміни закомітив, перевір', 'закомітив, не пуш', 'так, пуш', 'commit пізніше', 'не треба commit', 'commit the café fix']) {
    const c = commit(words);
    assert.equal(c.status, 2, `commit gate: ${words}`);
    assert.match(c.stderr, /is not in English - the gate reads a quote in English only; ask with AskUserQuestion/, words);
    assert.equal(push(words).status, 2, `push gate: ${words}`);
  }
  assert.equal(commit('commit it').status, 0, 'English consent is unchanged');
  // WAIVED - answered: <label>
  const { dir: pdir } = pushRepo();
  fs.writeFileSync(path.join(pdir, 'a.txt'), 'seed\nnext\n');
  spawnSync('git', ['-C', pdir, 'commit', '-qam', 'next'], { encoding: 'utf8' });
  const tp = writeTranscript(pdir, 'waiver', [{ type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'answered' }] }, toolUseResult: { answers: { 'Push without the review?': 'Skip the review and push' } } }]);
  const waive = (line, env = {}) => { writeReceipt(pdir, 'PUSH-GATE', `${line}\n`); return gateWith(pdir, 'git push', { transcript_path: tp }, env); };
  assert.equal(waive('WAIVED - answered: Skip the review and push').status, 0, 'a waiver the user picked');
  const none = waive('WAIVED - answered: Skip the lint and push');
  assert.equal(none.status, 2, 'a label no ask answered');
  assert.match(none.stderr, /matches no ask answered in this session/);
  const nothing = waive('WAIVED - answered: Push now');
  assert.equal(nothing.status, 2, 'a label that skips nothing');
  assert.match(nothing.stderr, /skips no review/);
  assert.equal(waive('WAIVED - "пуш без перевірки"').status, 2, 'a non-English waiver quote');
  assert.equal(waive('WAIVED - answered: Skip the review and push', { ALFRED_CODE_UNATTENDED: '1' }).status, 2, 'nobody at the terminal');
});

// Audit 2026-10-20 H4: the COMMIT-GATE receipt had no session floor while PUSH-GATE did, so a WAIVED receipt (no head:)
// written in one session opened every session's commits for 2h. Both gates now read a receipt written before this
// session began as absent (the transcript's birthtime, where the filesystem reports one).
test('audit 2026-10-20 H4: a commit receipt written before this session began is absent - waived or verified', () => {
  const dir = scratchRepo();
  const tp = path.join(dir, '..', `h4-session-${process.pid}.jsonl`);
  // a leftover from an earlier run under the same pid keeps its old birth time through a truncate: start fresh
  fs.rmSync(tp, { force: true });
  fs.writeFileSync(tp, '');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  fs.appendFileSync(tp, `${REVIEW_ROW}\n`); // the session ran the review: a fresh VERIFIED receipt needs one
  const st = fs.statSync(tp);
  if (!(st.birthtimeMs && st.birthtimeMs !== st.ctimeMs)) return; // no birthtime here: the floor is unknown, as before
  const gate = path.join(dir, '.alfred', 'docs', 'flow', 'COMMIT-GATE');
  const commit = () => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, transcript_path: tp }, { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  const past = (Date.now() - 10 * 60 * 1000) / 1000;
  for (const body of [
    ['WAIVED - "skip the review and just commit it"', 'format: WAIVED - "skip the review and just commit it"', 'findings: skipped - "skip the review and just commit it"'],
    ['VERIFIED the checkpoint', 'authorized: "commit it"', `head: ${headOf(dir)}`, 'spec: 3 files', 'live-probe: NOT RUN - fixture', FMT],
  ]) {
    writeReceipt(dir, 'COMMIT-GATE', body.join('\n') + '\n');
    fs.utimesSync(gate, Date.now() / 1000, Date.now() / 1000);
    const fresh = commit();
    assert.equal(fresh.status, 0, `${body[0]}: written in this session, it opens the commit - ${fresh.stderr}`);
    fs.utimesSync(gate, past, past);
    const old = commit();
    assert.equal(old.status, 2, `${body[0]}: another session's receipt opens no commit in this one`);
    assert.match(old.stderr, /written before this session began/);
  }
});

// ---------------------------------------------------------------------------------------------
// 2.8.0 layout: the receipts live in <data root>/state/approvals/
// ---------------------------------------------------------------------------------------------
test('2.8.0 layout: a COMMIT-GATE receipt under state/approvals/ opens the commit', () => {
  const dir = scratchRepo();
  writeStateReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }));
  assert.equal(gateIn(dir, 'git add a.txt b.txt c.txt && git commit -m x'), 0);
});

test('2.8.0 layout: a receipt only under the legacy flow/ still opens it (the 2.x skew: a 2.7.0 skill copy wrote it)', () => {
  const dir = scratchRepo();
  writeReceipt(dir, 'COMMIT-GATE', commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }));
  assert.equal(gateIn(dir, 'git add a.txt b.txt c.txt && git commit -m x'), 0);
});

test('2.8.0 layout: the denial names state/approvals/COMMIT-GATE', () => {
  const dir = scratchRepo();
  const r = gateFull(dir, 'git add a.txt b.txt c.txt && git commit -m x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /write \S*\.alfred[\\/]state[\\/]approvals[\\/]COMMIT-GATE/);
  assert.doesNotMatch(r.stderr, /flow[\\/]COMMIT-GATE/);
});

test('2.8.0 layout: a shell write to .alfred/state/approvals/COMMIT-GATE is read as a receipt write', () => {
  const dir = scratchRepo();
  const atomic = commitReceipt(headOf(dir), { first: 'VERIFIED the checkpoint' }).trim().replace(/\n/g, '\\n');
  assert.equal(gateIn(dir, `mkdir -p .alfred/state/approvals && printf '${atomic}\\n' > .alfred/state/approvals/COMMIT-GATE && git add a.txt b.txt c.txt && git commit -m x`), 0);
});

test('2.8.0 layout: a PUSH-GATE receipt under state/approvals/ opens the push, and the denial names it', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), forty());
  git('add', '-A'); git('commit', '-qm', 'feat: b');
  const denied = gateFull(dir, 'git push');
  assert.equal(denied.status, 2, 'ahead of upstream with no receipt');
  assert.match(denied.stderr, /\.alfred[\\/]state[\\/]approvals[\\/]PUSH-GATE/);
  writeStateReceipt(dir, 'PUSH-GATE', pushReceipt(headOf(dir)));
  assert.equal(gateIn(dir, 'git push'), 0);
});
