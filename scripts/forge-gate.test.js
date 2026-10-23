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
