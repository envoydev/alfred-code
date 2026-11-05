'use strict';
// The publish gate on every transport: a merge or a branch write through an MCP server or a CLI other than `gh` needs the
// same PUSH-GATE receipt `gh pr merge` and `git push` do; a forge call the lexicon cannot read is an ask (a deny when
// nobody is at the terminal); a read, a quoted merge and a non-forge tool pass. Every publish the gate allows is ledgered
// in <data root>/state/forge/ACTS-<session>.jsonl for the ref watch.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { reviewedTranscript } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gate-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
const REVIEWED = reviewedTranscript(TMP);

function pushRepo() {
  const base = fs.mkdtempSync(path.join(TMP, 'push-'));
  spawnSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')], { encoding: 'utf8' });
  const dir = path.join(base, 'repo');
  spawnSync('git', ['clone', '-q', path.join(base, 'remote.git'), dir], { encoding: 'utf8' });
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
  return { dir, git, remote: path.join(base, 'remote.git') };
}
const headOf = (dir) => spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const receipt = (dir, head) => {
  const file = path.join(dir, '.alfred', 'state', 'approvals', 'PUSH-GATE');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ['VERIFIED the merge', 'authorized: "merge it"', `head: ${head}`, 'spec: 1 commit', 'live-probe: `npm test` 12/12'].join('\n') + '\n');
};
const run = (dir, payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-ungated-commit.js')], {
  input: JSON.stringify({ transcript_path: REVIEWED, session_id: 'forge-s1', cwd: dir, ...payload }), encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_ENTRYPOINT: 'cli', ...env }, cwd: dir,
});
const mcp = (tool, input) => ({ tool_name: `mcp__gitlab__${tool}`, tool_input: input, mcp_server: { name: 'gitlab', source: 'user' } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const decision = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch { return null; } };
const acts = (dir) => {
  const file = path.join(dir, '.alfred', 'state', 'forge', 'ACTS-forge-s1.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

test('an MCP merge needs the publish receipt', () => {
  const { dir } = pushRepo();
  const r = run(dir, mcp('accept_merge_request', { merge_request_iid: 4, sha: headOf(dir) }));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /accept_merge_request/);
  assert.match(r.stderr, /PUSH-GATE/);
});

test('an MCP merge with a receipt passes and is ledgered', () => {
  const { dir } = pushRepo();
  receipt(dir, headOf(dir));
  const r = run(dir, mcp('merge_merge_request', { merge_request_iid: 4 }));
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = acts(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].concept, 'change.merge');
  assert.strictEqual(rows[0].change, '4');
  assert.strictEqual(rows[0].head, headOf(dir));
});

test('an MCP branch write needs the publish receipt', () => {
  const { dir } = pushRepo();
  const r = run(dir, { tool_name: 'mcp__github__push_files', tool_input: { branch: 'main', files: [], message: 'x' } });
  assert.strictEqual(r.status, 2, r.stderr);
});

test('a forge call with no known verb asks', () => {
  const { dir } = pushRepo();
  const r = run(dir, mcp('pull_request_frobnicate', { iid: 4 }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(decision(r), 'ask');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /frobnicate/);
});

test('a forge call with no known verb is denied when nobody is at the terminal', () => {
  const { dir } = pushRepo();
  const r = run(dir, mcp('pull_request_frobnicate', { iid: 4 }), { ALFRED_CODE_UNATTENDED: '1' });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /nobody|unattended/i);
});

test('a glab merge is gated like gh pr merge', () => {
  const { dir } = pushRepo();
  assert.strictEqual(run(dir, bash('glab mr merge 4')).status, 2);
  assert.strictEqual(run(dir, bash('az repos pr update --id 3 --status completed')).status, 2);
  assert.strictEqual(run(dir, bash('gh pr merge 12 --squash')).status, 2);
});

test('a shell merge with a receipt passes and is ledgered', () => {
  const { dir } = pushRepo();
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, bash('glab mr merge 4')).status, 0);
  assert.strictEqual(acts(dir)[0].concept, 'change.merge');
});

test('a quoted merge is text, not an act', () => {
  const { dir } = pushRepo();
  assert.strictEqual(run(dir, bash('echo glab mr merge 4')).status, 0);
  assert.strictEqual(run(dir, bash("cat > report.md <<'EOF'\nthen glab mr merge 4\nEOF")).status, 0);
});

test('reads and non-forge tools pass untouched', () => {
  const { dir } = pushRepo();
  for (const p of [mcp('get_merge_request', { merge_request_iid: 4 }), { tool_name: 'mcp__fs__write_file', tool_input: { path: 'a', content: 'b' } }, bash('glab ci status --live')]) {
    const r = run(dir, p);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(decision(r), null, `${p.tool_name} ${r.stdout}`);
  }
});

test('the push switch turns the transport-neutral half off too', () => {
  const { dir } = pushRepo();
  assert.strictEqual(run(dir, mcp('accept_merge_request', { merge_request_iid: 4 }), { ALFRED_CODE_HOOKS_OFF: 'guard-ungated-commit:push' }).status, 0);
});

// --- the PR-head check: a merge lands the CHANGE's head, so the receipt must have reviewed it -----------------------------
// The head is read with plain git (refs/pull/<n>/head, refs/merge-requests/<n>/head, refs/pull/<n>/merge), so it holds on
// every forge and every transport; no ref or no network falls back to the local-HEAD rule.
const pushHead = (git, sha, ref) => git('push', '-q', 'origin', `${sha}:${ref}`);

test('a merge of the reviewed head passes', () => {
  const { dir, git } = pushRepo();
  pushHead(git, headOf(dir), 'refs/pull/7/head');
  receipt(dir, headOf(dir));
  const r = run(dir, bash('gh pr merge 7 --squash'));
  assert.strictEqual(r.status, 0, r.stderr);
});

test('a merge whose head carries commits the review never saw is denied', () => {
  const { dir, git } = pushRepo();
  const reviewed = headOf(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'later\n');
  git('add', '-A'); git('commit', '-qm', 'unreviewed');
  pushHead(git, headOf(dir), 'refs/merge-requests/7/head');
  git('reset', '-q', '--hard', reviewed);
  receipt(dir, reviewed);
  const r = run(dir, bash('glab mr merge 7'));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /never saw/);
});

// PR merges go through a forge MCP server (the user, 2026-11-04), not `gh pr merge`: the tool carries the change's number,
// so the head check runs there too - an MCP merge of a change whose head the review never saw is denied, the reviewed one passes.
test('an MCP merge_pull_request whose head carries commits the review never saw is denied; the reviewed head passes', () => {
  const { dir, git } = pushRepo();
  const reviewed = headOf(dir);
  pushHead(git, reviewed, 'refs/pull/5/head');
  receipt(dir, reviewed);
  const ok = run(dir, mcp('merge_pull_request', { owner: 'o', repo: 'r', pull_number: 5, merge_method: 'squash' }));
  assert.strictEqual(ok.status, 0, ok.stderr);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'later\n');
  git('add', '-A'); git('commit', '-qm', 'unreviewed');
  pushHead(git, headOf(dir), 'refs/pull/7/head');
  git('reset', '-q', '--hard', reviewed);
  receipt(dir, reviewed);   // one receipt covers one publish: the merge above used the first
  const r = run(dir, mcp('merge_pull_request', { owner: 'o', repo: 'r', pull_number: 7, merge_method: 'squash' }));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /never saw/);
});

test('a merge with no change ref on the remote falls back to the local rule', () => {
  const { dir } = pushRepo();
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, bash('gh pr merge 9')).status, 0);
});

test('an unreachable remote falls back within the cap', () => {
  const { dir, git } = pushRepo();
  receipt(dir, headOf(dir));
  git('remote', 'set-url', 'origin', 'ssh://git@nohost.invalid/x.git');
  const t0 = Date.now();
  const r = run(dir, bash('gh pr merge 9'));
  assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0}ms`);
  assert.notStrictEqual(r.status, null, 'the hook ended on its own');
});

test('an MCP merge sha is compared directly', () => {
  const { dir, git } = pushRepo();
  const reviewed = headOf(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'later\n');
  git('add', '-A'); git('commit', '-qm', 'unreviewed');
  const later = headOf(dir);
  git('reset', '-q', '--hard', reviewed);
  receipt(dir, reviewed);
  assert.strictEqual(run(dir, mcp('accept_merge_request', { merge_request_iid: 4, sha: later })).status, 2);
  assert.strictEqual(run(dir, mcp('accept_merge_request', { merge_request_iid: 4, sha: reviewed })).status, 0);
});

// --- what a gated git push ledgers: one row per ref it names, so the ref watch never reads a push of one branch as
// covering a move of another ------------------------------------------------------------------------------------------
test('a gated git push ledgers each ref it names', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, bash('git push origin HEAD:refs/heads/feat/x main')).status, 0);
  assert.deepStrictEqual(acts(dir).map((a) => [a.concept, a.ref]), [['branch.write', 'feat/x'], ['branch.write', 'main']]);
});

test('a bare git push ledgers the branch it pushes, a --tags push no target', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, bash('git push')).status, 0);
  assert.strictEqual(run(dir, bash('git push --tags')).status, 0);
  assert.deepStrictEqual(acts(dir).map((a) => a.ref), ['main', null]);
});

test('a push naming no ref is ledgered as covering all; the act carries its tool call', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, { ...bash('git push --tags'), tool_use_id: 'tu-1' }).status, 0);
  const [row] = acts(dir);
  assert.strictEqual(row.all, true);
  assert.strictEqual(row.tool_use_id, 'tu-1');
});

test('an auto-merge is ledgered armed', () => {
  const { dir } = pushRepo();
  receipt(dir, headOf(dir));
  assert.strictEqual(run(dir, mcp('merge_merge_request', { merge_request_iid: 4, merge_when_pipeline_succeeds: true })).status, 0);
  assert.strictEqual(run(dir, bash('gh pr merge 4 --squash')).status, 0);
  assert.deepStrictEqual(acts(dir).map((a) => !!a.armed), [true, false]);
});

test('with the push half off, what it lets through is still ledgered', () => {
  const { dir, git } = pushRepo();
  const off = { ALFRED_CODE_HOOKS_OFF: 'guard-ungated-commit:push' };
  assert.strictEqual(run(dir, mcp('accept_merge_request', { merge_request_iid: 4 }), off).status, 0);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  assert.strictEqual(run(dir, bash('git push origin main'), off).status, 0);
  assert.strictEqual(run(dir, bash('git push --dry-run origin main'), off).status, 0);
  assert.deepStrictEqual(acts(dir).map((a) => [a.concept, a.ref]), [['change.merge', null], ['branch.write', 'main']]);
});

// fn-9: a command that pushes and then merges is two acts, and the ref watch reads both - the merge rode along unledgered
// behind the push.
test('fn-9: git push && gh pr merge ledgers both acts (under a waiver - a reviewed head refuses the pair, R015)', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  receipt(dir, headOf(dir));
  fs.writeFileSync(path.join(dir, '.alfred', 'state', 'approvals', 'PUSH-GATE'), 'WAIVED - "Skip the review, push and merge it"\n');
  const r = run(dir, bash('git push origin main && gh pr merge 4 --squash'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(acts(dir).map((a) => [a.concept, a.ref || a.change]), [['branch.write', 'main'], ['change.merge', '4']]);
});

// Task 4b (a side review of fn-9): the push leads the command, so the merge-only checks never saw the merge behind it -
// its unseen-head check, and, with nothing ahead to push, the receipt itself.
test('4b: a merge chained after a push is refused (R015: it runs after the push); alone it is checked against the change head', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  const reviewed = headOf(dir);
  fs.writeFileSync(path.join(dir, 'c.txt'), 'later\n');
  git('add', '-A'); git('commit', '-qm', 'unreviewed');
  pushHead(git, headOf(dir), 'refs/pull/7/head');
  git('reset', '-q', '--hard', reviewed);
  receipt(dir, reviewed);
  const r = run(dir, bash('git push origin main && gh pr merge 7 --squash'));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /so it judges only a merge that runs first/);
  assert.match(r.stderr, /gh pr merge 7/);
  const alone = run(dir, bash('gh pr merge 7 --squash'));
  assert.strictEqual(alone.status, 2, alone.stderr);
  assert.match(alone.stderr, /never saw/);
  pushHead(git, reviewed, 'refs/pull/8/head');
  const ok = run(dir, bash('gh pr merge 8 --squash'));
  assert.strictEqual(ok.status, 0, `the reviewed head merges: ${ok.stderr}`);
});

test('4b: a push with nothing ahead, or a dry run, does not carry a chained merge past the receipt', () => {
  const { dir } = pushRepo();
  for (const cmd of ['git push origin main && gh pr merge 4 --squash', 'git push -n origin main && gh pr merge 4 --squash', 'git push --dry-run && gh pr merge 4'])
  {
    const r = run(dir, bash(cmd));
    assert.strictEqual(r.status, 2, `${cmd}: ${r.stderr}`);
    assert.match(r.stderr, /PUSH-GATE/, cmd);
  }
  assert.deepStrictEqual(acts(dir), [], 'a denied act is not ledgered');
  receipt(dir, headOf(dir));
  const r = run(dir, bash('git push origin main && gh pr merge 4 --squash'));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /so it judges only a merge that runs first/, 'a reviewed head is never compared behind a push (R015)');
  assert.deepStrictEqual(acts(dir), [], 'a denied act is not ledgered');
  // under a waiver there is no reviewed head to compare, so the pair passes - and the level push moved nothing
  fs.writeFileSync(path.join(dir, '.alfred', 'state', 'approvals', 'PUSH-GATE'), 'WAIVED - "Skip the review, push and merge it"\n');
  const w = run(dir, bash('git push origin main && gh pr merge 4 --squash'));
  assert.strictEqual(w.status, 0, w.stderr);
  assert.deepStrictEqual(acts(dir).map((a) => [a.concept, a.ref || a.change]), [['change.merge', '4']], 'the level push moved nothing, so only the merge is an act');
  assert.strictEqual(run(dir, bash('git push origin main')).status, 0, 'a level push alone still needs nothing');
});

test('a push from a worktree is ledgered where the main checkout\'s ref watch reads', () => {
  const { dir, git } = pushRepo();
  const wt = path.join(path.dirname(dir), 'wt');
  git('worktree', 'add', '-q', '-b', 'feat/wt', wt);
  fs.writeFileSync(path.join(wt, 'w.txt'), 'w\n');
  spawnSync('git', ['-C', wt, 'add', '-A']); spawnSync('git', ['-C', wt, 'commit', '-qm', 'w']);
  receipt(wt, headOf(wt));
  const r = run(wt, bash('git push -u origin feat/wt'), { CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(acts(dir).map((a) => a.ref), ['feat/wt']);
});

// Audit 2026-10-30 (hooks report, the threat table's low row): `gh pr create` was never gated, while it pushes the current
// branch when that is not on a remote yet (cli.github.com/manual/gh_pr_create: 'When the current branch isn't fully pushed
// to a git remote, a prompt will ask where to push the branch'; `--dry-run` 'May still push git changes'). Opening a change
// request is gated only where it can push: a branch ahead of its upstream or on no remote; `--head` skips the push.
test('opening a change request from a branch no remote holds needs the publish receipt; a pushed branch or --head passes', () => {
  const { dir, git } = pushRepo();
  git('checkout', '-qb', 'feat/x');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  for (const cmd of ['gh pr create --fill', 'gh pr create --dry-run --fill', 'glab mr create --fill --push', 'git commit -qam y && gh pr create --fill']) {
    const r = run(dir, bash(cmd));
    assert.strictEqual(r.status, 2, `${cmd}: an unpushed branch goes out with it\n${r.stderr}`);
    assert.match(r.stderr, /PUSH-GATE/);
  }
  assert.strictEqual(run(dir, bash('gh pr create --head feat/x --fill')).status, 0, '--head skips the push');
  assert.strictEqual(run(dir, bash('gh api repos/o/r/pulls -X POST -f head=feat/x')).status, 0, 'the API route pushes nothing');
  git('push', '-q', 'origin', 'feat/x');
  assert.strictEqual(run(dir, bash('gh pr create --fill')).status, 0, 'pushed with no upstream set: a remote branch of its name holds HEAD');
  git('branch', '-q', '--set-upstream-to', 'origin/feat/x');
  assert.strictEqual(run(dir, bash('gh pr create --fill')).status, 0, 'level with its upstream');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git('add', '-A'); git('commit', '-qm', 'c');
  assert.strictEqual(run(dir, bash('gh pr create --fill')).status, 2, 'one commit ahead of its upstream');
  receipt(dir, headOf(dir));
  const ok = run(dir, bash('gh pr create --fill'));
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.deepStrictEqual(acts(dir).map((a) => a.concept), ['change.create'], 'and the act is ledgered for the ref watch');
});

// --- R015: a merge with no number reads the head of its branch -----------------------------------------------------------
// `gh pr merge --squash` merges the current branch's change, `gh pr merge feature-x` names one: the branch's tip on the
// remote (or a `gh pr checkout` branch's refs/pull/<n>/head) is the change's head, so the unseen-head check runs.
const featureRepo = () => {
  const r = pushRepo();
  r.git('checkout', '-qb', 'feature');
  r.git('config', 'branch.feature.remote', 'origin');
  r.git('config', 'branch.feature.merge', 'refs/heads/feature');
  r.reviewed = headOf(r.dir);
  pushHead(r.git, r.reviewed, 'refs/heads/feature');
  receipt(r.dir, r.reviewed);
  return r;
};
// One commit the review never saw, left in the checkout's objects; the work tree goes back to the reviewed head.
const unreviewedCommit = (r) => {
  fs.writeFileSync(path.join(r.dir, 'b.txt'), 'later\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'later');
  const sha = headOf(r.dir);
  r.git('reset', '-q', '--hard', r.reviewed);
  return sha;
};

test('R015: a merge with no number checks the tip of its branch on the remote', () => {
  const r = featureRepo();
  assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'the reviewed tip passes');
  const later = unreviewedCommit(r);
  pushHead(r.git, later, 'refs/heads/feature');
  receipt(r.dir, r.reviewed);
  const blocked = run(r.dir, bash('gh pr merge --squash'));
  assert.strictEqual(blocked.status, 2, 'an unreviewed tip is refused');
  assert.match(blocked.stderr, /never saw/);
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('gh pr merge feature --subject "fix it"')).status, 2, 'a named branch reads its tip');
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('glab mr merge --squash')).status, 2, 'glab reads it too');
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('gh pr merge --squash -R other/repo')).status, 0, '-R keeps today\'s rule');
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('gh pr merge nobranch')).status, 0, 'no such remote branch keeps today\'s rule');
});

test('R015: a branch tracking a fork reads the fork\'s tip, not origin\'s', () => {
  const r = featureRepo();
  const fork = path.join(path.dirname(r.dir), 'fork.git');
  spawnSync('git', ['init', '-q', '--bare', fork], { encoding: 'utf8' });
  r.git('remote', 'add', 'fork', fork);
  r.git('config', 'branch.feature.remote', 'fork');
  const later = unreviewedCommit(r);
  pushHead(r.git, later, 'refs/heads/feature');
  r.git('push', '-q', 'fork', `${r.reviewed}:refs/heads/feature`);
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'the fork holds the reviewed tip');
  r.git('push', '-q', '-f', 'fork', `${later}:refs/heads/feature`);
  r.git('push', '-q', '-f', 'origin', `${r.reviewed}:refs/heads/feature`);
  receipt(r.dir, r.reviewed);
  assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 2, 'the fork holds an unreviewed tip');
});

// R015's reviews (2026-11-05): the hook judges a merge on the repository and its remote as they stand BEFORE the command
// runs, so it judges only a merge nothing runs ahead of. Six reviews broke every reading of what runs first - a push's join,
// remote, refspec and sources, a pull, reset, checkout or config write, an exported HOME, a function, a carried script, an
// expansion - so anything before or beside the merge refuses the pair, and the denial names it. After the merge, anything.
const amendedRepo = () => {
  const r = featureRepo();
  fs.writeFileSync(path.join(r.dir, 'a.txt'), 'amended\n');
  r.git('add', '-A'); r.git('commit', '-q', '--amend', '-m', 'amended');
  r.amended = headOf(r.dir);
  return r;
};
const verdictOf = (r, cmd) => { receipt(r.dir, headOf(r.dir)); return run(r.dir, bash(cmd)); };
const RUNS_FIRST = /so it judges only a merge that runs first/;
test('R015 reviews: a merge with anything run before or beside it in its command is refused, naming what runs first', () => {
  const r = featureRepo();
  r.git('branch', 'wip', unreviewedCommit(r));
  for (const cmd of ['git push && gh pr merge --squash', 'git push -u origin HEAD && gh pr merge --squash --delete-branch', 'git push; gh pr merge --squash',
    'git push -f origin wip:feature && gh pr merge --squash', 'git push -f origin :/later:feature && gh pr merge --squash',
    'git push -n origin feature && gh pr merge --squash', 'git fetch && gh pr merge --squash', 'cd . && gh pr merge --squash',
    'git checkout -q wip && git push -f origin HEAD:feature && gh pr merge --squash', 'git config push.default matching && git push && gh pr merge feature --squash',
    'HOME=/nowhere git push && gh pr merge --squash', "bash -c 'git push -f origin wip:feature' && gh pr merge --squash",
    "eval 'git push -f origin wip:feature' && gh pr merge --squash", 'S=push; git $S -f origin wip:feature && gh pr merge --squash',
    'm() { gh pr merge --squash; }; git push -f origin wip:feature && m', 'gh pr merge $(git push -qf origin wip:feature; echo --squash)',
    'for p in 1; do gh pr merge --squash; git push -f origin wip:feature; done', 'while gh pr merge --squash; do git push -f origin wip:feature; done',
    'gh pr merge --squash & git push -f origin wip:feature', 'gh pr merge --squash | git push -f origin wip:feature',
    '{ gh pr merge --squash; } & git push -f origin wip:feature', 'git log --output=.git/x && gh pr merge --squash',
    'gh pr merge --squash --body "$(git branch -f feature wip; echo x)"',
    // the seventh review: a merge after another forge act, a loop not leading its command, a backgrounded subshell or a
    // forking wrapper, and the substitutions the shared reader never opens
    'gh pr merge 3 --squash && gh pr merge --squash', 'gh api -X PATCH repos/o/r/git/refs/heads/feature -f sha=abc -F force=true && gh pr merge --squash',
    '{ until gh pr merge --squash; do git push -q origin wip:feature; done; }', '! until gh pr merge --squash; do git push; done',
    'time until gh pr merge --squash; do git push; done', '( gh pr merge --squash ) & git push -q origin wip:feature',
    'setsid -f gh pr merge --squash; git push -q origin wip:feature', 'gh pr merge --squash --body ${X:-$(git push -q origin wip:feature; echo x)}',
    'gh pr merge --squash --body $(( $(git push -q origin wip:feature >/dev/null; echo 1) ))',
    'gh pr merge --squash --body-file - <<EOF\n$(git push -q origin wip:feature)\nEOF']) {
    const got = verdictOf(r, cmd);
    assert.strictEqual(got.status, 2, `${cmd}: ${got.stderr}`);
    assert.match(got.stderr, RUNS_FIRST, cmd);
  }
  for (const cmd of ['gh pr merge --squash', 'gh pr merge --squash && git checkout -q main', 'gh pr merge --squash; git status',
    'gh pr merge --squash --body "$(cat <<\'EOF\'\nthe body\nEOF\n)"', 'GH_PROMPT_DISABLED=1 gh pr merge --squash',
    'git status && gh pr merge --squash', 'gh pr merge --squash --body "$(git log -1 --format=%B)"',
    'gh pr merge --squash --delete-branch 2>&1 | tail -5', 'gh pr merge --squash --body-file - <<\'EOF\'\n$(not run)\nEOF',
    // a comment runs nothing, backticks and `$(` included
    '# run `git push` and $(git push) by hand first\ngh pr merge --squash']) {
    const got = verdictOf(r, cmd);
    assert.strictEqual(got.status, 0, `${cmd}: ${got.stderr}`);
  }
});
test('R015 reviews: after an amend the merge alone is refused on the remote tip; once the push has run on its own it passes', () => {
  const r = amendedRepo();
  const alone = verdictOf(r, 'gh pr merge --squash');
  assert.strictEqual(alone.status, 2, 'the remote still holds the commit the amend replaced');
  assert.match(alone.stderr, /never saw/);
  assert.doesNotMatch(alone.stderr, RUNS_FIRST, 'nothing runs before it');
  r.git('push', '-q', '-f', 'origin', `${r.amended}:refs/heads/feature`);
  assert.strictEqual(verdictOf(r, 'gh pr merge --squash').status, 0, 'the push ran on its own first');
});
// The sixth review: a dry run or a push with nothing ahead goes ungated only as the command's one act - a second push, an
// expanded subcommand, xargs, a prefix, a call-level setting or a config write beside it can each send what no one saw.
// The seventh review: 'nothing ahead' read HEAD against its local @{u}, so push.default=matching, a remote's push refspec,
// a local upstream or a stale tracking ref published with no receipt. The hook now asks git: the push's own words as a
// dry run (--porcelain), exempt only when no ref would move.
test('push gate: a push is let out as nothing ahead only when git says no ref would move', () => {
  const r = featureRepo();
  const later = unreviewedCommit(r);
  const gateFile = path.join(r.dir, '.alfred', 'state', 'approvals', 'PUSH-GATE');
  const bare = (cmd) => { fs.rmSync(gateFile, { force: true }); return run(r.dir, bash(cmd)); };
  assert.strictEqual(bare('git push').status, 0, 'control: a level push alone');
  r.git('branch', 'other', later);
  r.git('push', '-q', 'origin', `${r.reviewed}:refs/heads/other`);
  r.git('config', 'push.default', 'matching');
  assert.strictEqual(bare('git push').status, 2, 'push.default=matching sends other');
  r.git('config', '--unset', 'push.default');
  r.git('config', 'remote.origin.push', 'refs/heads/other:refs/heads/feature');
  assert.strictEqual(bare('git push').status, 2, "a remote's push refspec sends other to feature");
  assert.strictEqual(bare('git push origin feature').status, 0, 'a refspec on the line wins over remote.origin.push');
  r.git('config', '--unset', 'remote.origin.push');
  r.git('branch', 'mirror', later);
  r.git('reset', '-q', '--hard', later);
  r.git('branch', '-u', 'mirror');
  assert.strictEqual(bare('git push origin feature').status, 2, 'a local upstream at HEAD hides what origin lacks');
  r.git('update-ref', 'refs/remotes/origin/feature', later);
  r.git('branch', '-u', 'origin/feature');
  assert.strictEqual(bare('git push').status, 2, 'a stale tracking ref at HEAD hides what origin lacks');
});
test('push gate: a dry run or a push with nothing ahead goes ungated only as the command\'s one act', () => {
  const r = featureRepo();
  r.git('branch', 'wip', unreviewedCommit(r));
  const gateFile = path.join(r.dir, '.alfred', 'state', 'approvals', 'PUSH-GATE');
  const bare = (cmd) => { fs.rmSync(gateFile, { force: true }); return run(r.dir, bash(cmd)); };
  for (const cmd of ['git push -n origin feature; git push -f origin wip:feature', 'git push origin feature && git push -f origin wip:feature',
    'S=push; git $S -f origin wip:feature', 'echo push -f origin wip:feature | xargs git', 'GIT_SSH_COMMAND=true git push -n origin feature',
    'git -c core.sshCommand=true push -n origin feature', 'git push -n --exec=true origin feature', 'git push -n --receive-pack=true origin feature',
    'git config remote.origin.push refs/heads/wip:refs/heads/feature && git push', 'git push -n origin feature | cat',
    'git show HEAD:a.txt > .git/x && git push', 'git log --output=x && git push', 'for i in 1; do git push; done', 'git push & true',
    'git branch -f other wip && git push', '{ git push -n origin feature; }',
    ': ${X:-$(git push -q -f origin wip:feature)}', 'cat <<EOF\n$(git push -q -f origin wip:feature)\nEOF',
    'git push -n origin feature <<EOF\n$(git push -f origin wip:feature)\nEOF', 'echo push | xargs -I{} git {} -f origin wip:feature',
    'echo push | xargs -I SUB git SUB -f origin wip:feature',
    // the eighth review's leads, each a push the shared reader never saw: ANSI-C quoting, a `$((` that bash runs as a
    // substitution, a heredoc opener inside quotes or a comment
    "echo $'a\\'b' ; git push -f origin wip:feature", 'echo $((git push -f origin wip:feature) )',
    'echo "<<\'EOF\'"\ngit push -f origin wip:feature\nEOF', 'echo hi # <<EOF\ngit push -f origin wip:feature\nEOF']) {
    const got = bare(cmd);
    assert.strictEqual(got.status, 2, `${cmd}: ${got.stderr}`);
    assert.match(got.stderr, /PUSH-GATE/, cmd);
  }
  for (const cmd of ['git push -n origin feature', 'git push --dry-run', 'git push', 'git push origin feature', 'git push -n origin feature 2>&1',
    'git status && git push', 'git log --oneline -3 2>/dev/null; git push -n origin feature', 'git push && git status', 'git push; git checkout -q main'])
    assert.strictEqual(bare(cmd).status, 0, `${cmd} alone sends nothing`);
});
// The push gate's dry run (forge.js pushDryRun): a dry run publishes nothing and is not gated, so only a CERTAIN one counts -
// an option it does not know, an abbreviation, a later --no-dry-run or --end-of-options make the push a real one, gated.
test('push gate: only a certain dry run goes ungated; -on, --no-dry-run, abbreviations and --end-of-options are gated', () => {
  const { dir, git } = pushRepo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A'); git('commit', '-qm', 'b');
  for (const cmd of ['git push -on origin main', 'git push -n --no-dry-run origin main', 'git push --dry-run --no-dry-run origin main',
    'git push --rep -n origin main', 'git push --pu -n origin main', 'git push --end-of-options -nx main', 'git push --dry origin main',
    'git push -- -n main', 'X=--no-dry-run; git push -n $X origin main', 'git push -n $(echo --no-dry-run) origin main',
    'git push -n {--no-dry-run,origin} main', 'git push -n ${U:---no-dry-run} origin main']) {
    const got = run(dir, bash(cmd));
    assert.strictEqual(got.status, 2, `${cmd}: ${got.stderr}`);
    assert.match(got.stderr, /PUSH-GATE/, cmd);
  }
  for (const cmd of ['git push -n origin main', 'git push --dry-run origin main', 'git push -vn origin main', 'git push --repo origin -n main', 'git push -o ci.skip -n origin main'])
    assert.strictEqual(run(dir, bash(cmd)).status, 0, `${cmd} is a dry run`);
});

// R015's review: a named branch is read on its own remote; a push remote (branch.<b>.pushRemote, else remote.pushDefault)
// comes first, as gh finds the change through it - a stale same-named branch on origin is no false block.
test('R015 review: a named branch reads its own remote, and a push remote comes first', () => {
  const setUp = () => {
    const r = featureRepo();
    const fork = path.join(path.dirname(r.dir), `fork-${Math.random().toString(36).slice(2, 8)}.git`);
    spawnSync('git', ['init', '-q', '--bare', fork], { encoding: 'utf8' });
    r.git('remote', 'add', 'fork', fork);
    const later = unreviewedCommit(r);
    pushHead(r.git, later, 'refs/heads/feature');
    r.git('push', '-q', 'fork', `${r.reviewed}:refs/heads/feature`);
    return r;
  };
  {
    const r = setUp();
    r.git('config', 'branch.feature.remote', 'fork');
    r.git('checkout', '-qb', 'other');
    receipt(r.dir, r.reviewed);
    const got = run(r.dir, bash('gh pr merge feature --squash'));
    assert.strictEqual(got.status, 0, `the named branch's own remote holds the reviewed tip: ${got.stderr}`);
  }
  {
    const r = setUp();
    r.git('config', 'branch.feature.pushRemote', 'fork');
    receipt(r.dir, r.reviewed);
    const got = run(r.dir, bash('gh pr merge --squash'));
    assert.strictEqual(got.status, 0, `branch.feature.pushRemote is read first: ${got.stderr}`);
  }
  {
    const r = setUp();
    r.git('config', 'remote.pushDefault', 'fork');
    receipt(r.dir, r.reviewed);
    const got = run(r.dir, bash('gh pr merge --squash'));
    assert.strictEqual(got.status, 0, `remote.pushDefault is read first: ${got.stderr}`);
  }
  {
    const r = setUp();
    r.git('config', 'branch.feature.pushRemote', 'origin');
    receipt(r.dir, r.reviewed);
    assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 2, 'a push remote holding the unreviewed tip is refused');
  }
});

test('R015: a branch tracking another branch, a PR ref, a garbage merge ref or a detached HEAD reads the right head', () => {
  {
    const r = featureRepo();
    r.git('config', 'branch.feature.merge', 'refs/heads/main');
    const later = unreviewedCommit(r);
    pushHead(r.git, later, 'refs/heads/main');
    receipt(r.dir, r.reviewed);
    assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'a branch tracking main has no change head to read: today\'s rule');
  }
  {
    const r = featureRepo();
    r.git('config', 'branch.feature.merge', 'refs/pull/9/head');
    pushHead(r.git, r.reviewed, 'refs/pull/9/head');
    assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'the PR ref at the reviewed head passes');
    const later = unreviewedCommit(r);
    pushHead(r.git, later, 'refs/pull/9/head');
    receipt(r.dir, r.reviewed);
    const blocked = run(r.dir, bash('gh pr merge --squash'));
    assert.strictEqual(blocked.status, 2, 'the PR ref at an unreviewed head is refused');
    assert.match(blocked.stderr, /never saw/);
  }
  {
    const r = featureRepo();
    r.git('config', 'branch.feature.merge', 'refs/garbage');
    receipt(r.dir, r.reviewed);
    assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'a garbage merge ref keeps today\'s rule');
  }
  {
    const r = featureRepo();
    r.git('checkout', '-q', '--detach');
    receipt(r.dir, r.reviewed);
    assert.strictEqual(run(r.dir, bash('gh pr merge --squash')).status, 0, 'a detached HEAD keeps today\'s rule');
  }
});
