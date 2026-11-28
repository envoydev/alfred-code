'use strict';
// guard-stop-contract.js, the ask branch's 'remote or job state' note (session audit B5): a project name such as
// 'Remote-Ops' drew the note in a folder with no git. The note needs a git work tree and a lowercase 'remote' or
// 'upstream' not joined to a hyphen. Each case drives the hook through its AskUserQuestion payload, spawned.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-note-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
for (const key of Object.keys(process.env)) if (key.startsWith('ALFRED_CODE_')) delete process.env[key];

const REMOTE_NOTE = /This ask named remote or job state/;
const ANY_NOTE = /This ask named (?:remote or job|git) state/;

let seq = 0;
const makeProject = (withGit) => {
  const dir = fs.mkdtempSync(path.join(TMP, withGit ? 'repo-' : 'plain-'));
  if (withGit) assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0, 'git init');
  return dir;
};
const REPO = makeProject(true);
const PLAIN = makeProject(false);

const ask = (project, question) => {
  const id = `r${++seq}`;
  const rows = [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } },
  ];
  const transcript = path.join(TMP, `t${seq}.jsonl`);
  fs.writeFileSync(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const payload = { session_id: `a${seq}`, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', transcript_path: transcript,
    tool_input: { questions: [{ question, options: [{ label: 'Wait (Recommended)', description: 'x' }, { label: 'Go now', description: 'y' }] }] } };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) };
  const out = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env });
  return out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.additionalContext || '' : '';
};

test('B5: a project name Remote-Ops draws no remote-state note in a folder with no git', () => {
  assert.doesNotMatch(ask(PLAIN, 'Notify Remote-Ops about the new build?'), ANY_NOTE);
});

test('B5: a project name Remote-Ops draws no remote-state note in a git repo either', () => {
  assert.doesNotMatch(ask(REPO, 'Notify Remote-Ops about the new build?'), ANY_NOTE);
  assert.doesNotMatch(ask(REPO, 'Ask Upstream-Team about the new build?'), ANY_NOTE);
});

test('B5: a capitalised Remote is a name, not remote state', () => {
  assert.doesNotMatch(ask(REPO, 'Ask Remote about the new build?'), ANY_NOTE);
});

test('B5: the remote branch in a git repo still draws the remote-state note', () => {
  assert.match(ask(REPO, 'The check needs the remote branch to be current. Recommended: wait for the merge.'), REMOTE_NOTE);
  assert.match(ask(REPO, 'Compare with the upstream copy before the check?'), REMOTE_NOTE);
});

test('B5: the other state words stay case-insensitive in a git repo', () => {
  assert.match(ask(REPO, 'Merged is not enough, wait for the pipeline?'), REMOTE_NOTE);
});

test('B5: the remote branch in a folder with no git draws no remote-state note', () => {
  assert.doesNotMatch(ask(PLAIN, 'The check needs the remote branch to be current. Recommended: wait for the merge.'), ANY_NOTE);
});
