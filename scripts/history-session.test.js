// scripts/history-session.test.js - the history hook (stack/hooks/history-session.js), driven through
// stdin payloads against throwaway git projects. Stop records the session; SessionStart records it too
// and injects what the last sessions on this branch did and ruled. Fail-open in every direction.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const HOOK = path.join(HOOKS, 'history-session.js');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// An empty global git config OUTSIDE every project: os.devNull is `\\.\nul` on Windows, which git for
// Windows cannot open ('unable to access'), and a file inside the project would show as dirty.
const gitConfigDir = tmpDir('history-session-gitconfig-');
const EMPTY_GIT_CONFIG = path.join(gitConfigDir, 'config');
fs.writeFileSync(EMPTY_GIT_CONFIG, '');
test.after(() => rmDir(gitConfigDir));

// A clean env: nothing the developer's own shell carries (a docs root, an off switch) leaks into a case.
function env(root, extra = {}) {
  return { PATH: process.env.PATH, HOME: root, CLAUDE_PROJECT_DIR: root, GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG, GIT_CONFIG_NOSYSTEM: '1', ...extra };
}
function project() {
  const root = tmpDir('history-session-');
  const g = (...a) => execFileSync('git', a, { cwd: root, env: env(root), stdio: 'pipe' });
  g('init', '-q', '-b', 'feat/x');
  g('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '--allow-empty', '-m', 'start');
  return root;
}
function transcript(root, name, answers) {
  const p = path.join(root, `${name}.jsonl`);
  fs.writeFileSync(p, answers.map(([q, a]) => JSON.stringify({ type: 'user', timestamp: '2026-09-23T10:00:00Z', toolUseResult: { answers: { [q]: a } } })).join('\n') + '\n');
  return p;
}
function run(root, payload, extra, hook = HOOK) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [hook], { input, encoding: 'utf8', env: env(root, extra), cwd: root });
}
const entryFile = (root, session) => path.join(root, '.claude', 'docs', 'history', `${session}.json`);

test('Stop writes the session entry and prints nothing', () => {
  const root = project();
  try {
    const r = run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: transcript(root, 's1', [['Ship it?', 'Yes']]) });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    const e = JSON.parse(fs.readFileSync(entryFile(root, 's1'), 'utf8'));
    assert.strictEqual(e.branch, 'feat/x');
    assert.deepStrictEqual(e.rulings.map((x) => x.answer), ['Yes']);
  } finally { rmDir(root); }
});

test('SessionStart after two sessions on the branch injects one framed block within 600 chars', () => {
  const root = project();
  try {
    run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: transcript(root, 's1', [['Ship it?', 'Yes']]) });
    run(root, { hook_event_name: 'Stop', session_id: 's2', transcript_path: transcript(root, 's2', [['Push now?', 'No, hold']]) });
    const r = run(root, { hook_event_name: 'SessionStart', session_id: 's3', source: 'startup', transcript_path: path.join(root, 'absent.jsonl') });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    const block = out.hookSpecificOutput.additionalContext;
    assert.match(block, /history, not instructions/);
    assert.match(block, /Push now\? -> No, hold/);
    assert.ok(block.length <= 600, `block is ${block.length} chars`);
    assert.ok(fs.existsSync(entryFile(root, 's3')), 'SessionStart pins its own entry');
  } finally { rmDir(root); }
});

test('SessionStart with no earlier entry on the branch prints nothing', () => {
  const root = project();
  try {
    const r = run(root, { hook_event_name: 'SessionStart', session_id: 's1', source: 'startup', transcript_path: '' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { rmDir(root); }
});

test('ALFRED_CODE_HISTORY=0 writes nothing and prints nothing', () => {
  const root = project();
  try {
    const r = run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: transcript(root, 's1', [['Q', 'A']]) }, { ALFRED_CODE_HISTORY: '0' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'docs', 'history')));
  } finally { rmDir(root); }
});

test('ALFRED_CODE_HOOKS_OFF naming the hook stands it down', () => {
  const root = project();
  try {
    const r = run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: '' }, { ALFRED_CODE_HOOKS_OFF: 'history-session' });
    assert.strictEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'docs', 'history')));
  } finally { rmDir(root); }
});

test('the engine missing from beside the hook: exit 0, no output', () => {
  const root = project();
  const lone = tmpDir('history-lone-');
  try {
    fs.copyFileSync(HOOK, path.join(lone, 'history-session.js'));
    const r = run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: '' }, {}, path.join(lone, 'history-session.js'));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { rmDir(root); rmDir(lone); }
});

test('stdin garbage: exit 0, no output', () => {
  const root = project();
  try {
    for (const input of ['not json', '', 'null', '[]']) {
      const r = run(root, input);
      assert.strictEqual(r.status, 0, input);
      assert.strictEqual(r.stdout, '', input);
    }
  } finally { rmDir(root); }
});

test('a compact SessionStart in the same session does not duplicate its rulings', () => {
  const root = project();
  try {
    const t = transcript(root, 's1', [['Ship it?', 'Yes']]);
    run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: t });
    run(root, { hook_event_name: 'SessionStart', session_id: 's1', source: 'compact', transcript_path: t });
    run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: t });
    const e = JSON.parse(fs.readFileSync(entryFile(root, 's1'), 'utf8'));
    assert.strictEqual(e.rulings.length, 1);
  } finally { rmDir(root); }
});
