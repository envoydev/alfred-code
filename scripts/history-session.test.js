// scripts/history-session.test.js - the history hook (stack/hooks/history-session.js), driven through
// stdin payloads against throwaway git projects. Stop records the session; SessionStart records it too
// and injects what the last sessions on this branch did and ruled. Fail-open in every direction.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
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
// 2.8.0 layout: one record per session in <data root>/state/history/; the pre-2.8.0 <docs-path>/history/ is still read
const entryFile = (root, session) => path.join(root, '.alfred', 'state', 'history', `${session}.json`);
const legacyEntryFile = (root, session) => path.join(root, '.alfred', 'docs', 'history', `${session}.json`);

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

// Item 10 of 2026-10-21: the count of earlier sessions comes from ALFRED_CODE_HISTORY (seed 3, max 10), and the block's
// cap is a 150-char frame plus 150 per session shown (600 at the seed, as before).
function sessions(root, n) {
  for (let i = 1; i <= n; i++) {
    run(root, { hook_event_name: 'Stop', session_id: `s${i}`, transcript_path: transcript(root, `s${i}`, [[`Step ${i}?`, `Answer${i}`]]) });
    const t = new Date(Date.now() - (n - i + 1) * 60000);
    fs.utimesSync(entryFile(root, `s${i}`), t, t);
  }
}
const startBlock = (root, extra) => {
  const r = run(root, { hook_event_name: 'SessionStart', session_id: 'now', source: 'startup', transcript_path: path.join(root, 'absent.jsonl') }, extra);
  assert.strictEqual(r.status, 0);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
};
const shown = (block) => [...block.matchAll(/Answer(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);

test('ALFRED_CODE_HISTORY sets how many earlier sessions the start block shows, the cap growing with it', () => {
  const root = project();
  try {
    sessions(root, 12);
    for (const [value, want] of [[undefined, [10, 11, 12]], ['1', [12]], ['5', [8, 9, 10, 11, 12]], ['10', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], ['11', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], ['garbage', [10, 11, 12]]]) {
      const block = startBlock(root, value === undefined ? {} : { ALFRED_CODE_HISTORY: value });
      assert.deepStrictEqual(shown(block), want, `ALFRED_CODE_HISTORY=${value}: ${block}`);
      assert.ok(block.length <= 150 + 150 * want.length, `ALFRED_CODE_HISTORY=${value}: ${block.length} chars over ${150 + 150 * want.length}`);
    }
    assert.strictEqual(startBlock(root, { ALFRED_CODE_HISTORY: '0' }), '', '0 is off');
  } finally { rmDir(root); }
});

// The plan's state (the user's run order, 2026-10-28): read when the block renders, never recorded at Stop - a task ticked
// after the session ended shows at the next start.
const planDoc = (done, all, resume) => ['# F - plan', '', `Resume: ${resume}`, '', '## Tasks', '',
  ...Array.from({ length: all }, (_, i) => `### Task ${i + 1} - s${i + 1}\n\n- status: ${i < done ? 'DONE (ok)' : 'TODO'}\n`)].join('\n');
function planSession(root, session, plan) {
  const p = path.join(root, `${session}.jsonl`);
  fs.writeFileSync(p, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(root, plan) } }] } })}\n`);
  return run(root, { hook_event_name: 'Stop', session_id: session, transcript_path: p });
}
test('the start block shows the plan as it stands now: a task ticked after the session ended', () => {
  const root = project();
  try {
    fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'x.md'), planDoc(0, 2, 'next task 1'));
    assert.strictEqual(planSession(root, 's1', 'docs/plans/x.md').status, 0);
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'x.md'), planDoc(1, 2, 'next task 2 - card 1 done'));
    assert.match(startBlock(root, {}), /, plan docs\/plans\/x\.md \(1\/2 done; Resume: next task 2 - card 1 done\)$/m);
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'x.md'), `${planDoc(2, 2, 'done')}\nCompleted: 2026-10-28\n`);
    assert.match(startBlock(root, {}), /, plan docs\/plans\/x\.md \(completed\)$/m);
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'x.md'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    assert.match(startBlock(root, {}), /, plan docs\/plans\/x\.md$/m, 'garbage bytes: the path alone, no error');
  } finally { rmDir(root); }
});
test('a plan path that is no regular file keeps the path alone and never blocks the start', { skip: process.platform === 'win32' && 'mkfifo' }, () => {
  const root = project();
  try {
    fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
    execFileSync('mkfifo', [path.join(root, 'docs', 'plans', 'x.md')]);
    planSession(root, 's1', 'docs/plans/x.md');
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'now', source: 'startup', transcript_path: path.join(root, 'absent.jsonl') }), encoding: 'utf8', env: env(root), cwd: root, timeout: 4000 });
    assert.strictEqual(r.status, 0, `the start hook was killed waiting on the fifo: ${r.signal}`);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /, plan docs\/plans\/x\.md$/m);
  } finally { rmDir(root); }
});
test('with a plan state on every session the block stays within its cap at ALFRED_CODE_HISTORY 1, 3 and 10', () => {
  const root = project();
  try {
    fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
    for (let i = 1; i <= 12; i++) {
      fs.writeFileSync(path.join(root, 'docs', 'plans', `p${i}.md`), planDoc(1, 4, `next task 2 of plan ${i} - ${'w'.repeat(90)}`));
      planSession(root, `s${i}`, `docs/plans/p${i}.md`);
      const t = new Date(Date.now() - (13 - i) * 60000);
      fs.utimesSync(entryFile(root, `s${i}`), t, t);
    }
    for (const count of [1, 3, 10]) {
      const block = startBlock(root, { ALFRED_CODE_HISTORY: String(count) });
      assert.ok(block.length <= 150 + 150 * count, `${count}: ${block.length} chars`);
      assert.match(block, /plan docs\/plans\/p12\.md \(1\/4 done/, `${count}: the newest session keeps its plan state`);
      assert.doesNotMatch(block, /w{78}/, `${count}: the Resume: text is cut`);
      assert.match(block, /More: node \.claude\/hooks\/history\.js rulings$/, `${count}: the footer stays whole`);
    }
  } finally { rmDir(root); }
});

test('2.8.0: the start injection reads a legacy <docs>/history/ record while state/history/ has none for the branch', () => {
  const root = project();
  try {
    run(root, { hook_event_name: 'Stop', session_id: 'old', transcript_path: transcript(root, 'old', [['Ship it?', 'Yes, ship']]) });
    // the record a 2.7.0 hook wrote, before the update moved it
    fs.mkdirSync(path.dirname(legacyEntryFile(root, 'old')), { recursive: true });
    fs.renameSync(entryFile(root, 'old'), legacyEntryFile(root, 'old'));
    const r = run(root, { hook_event_name: 'SessionStart', session_id: 'new', source: 'startup', transcript_path: path.join(root, 'absent.jsonl') });
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Ship it\? -> Yes, ship/, 'the legacy record is injected');
    assert.ok(fs.existsSync(entryFile(root, 'new')), 'the new session pins its entry in state/history/');
    assert.ok(!fs.existsSync(legacyEntryFile(root, 'new')), 'and nothing in the legacy folder');
    // once state/history/ holds a record of the branch, the legacy folder is no longer read
    run(root, { hook_event_name: 'Stop', session_id: 'mid', transcript_path: transcript(root, 'mid', [['Push now?', 'No, hold']]) });
    const later = JSON.parse(run(root, { hook_event_name: 'SessionStart', session_id: 'last', source: 'startup', transcript_path: path.join(root, 'absent.jsonl') }).stdout).hookSpecificOutput.additionalContext;
    assert.match(later, /Push now\? -> No, hold/);
    assert.doesNotMatch(later, /Ship it/);
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
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'state', 'history')));
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'docs', 'history')));
  } finally { rmDir(root); }
});

test('ALFRED_CODE_HOOKS_OFF naming the hook stands it down', () => {
  const root = project();
  try {
    const r = run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: '' }, { ALFRED_CODE_HOOKS_OFF: 'history-session' });
    assert.strictEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'docs', 'history')));
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

// R54 / Task 16 review M8: a user-scope core runs this hook in every repo the user opens. One that was
// never set up gets no .alfred/docs/ - the prelude stands the hook down before it reads a byte.
test('a never-set-up project under a plugin-launched hook: nothing written, nothing printed', () => {
  const root = project();
  try {
    const pluginEnv = { CLAUDE_PLUGIN_ROOT: path.join(root, '..', 'plugin-cache', 'alfred-code', '2.0.0') };
    for (const payload of [
      { hook_event_name: 'SessionStart', session_id: 'u1', source: 'startup' },
      { hook_event_name: 'Stop', session_id: 'u1', transcript_path: transcript(root, 'u1', [['Ship it?', 'Yes']]) },
    ]) {
      const r = run(root, payload, pluginEnv);
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.stdout + r.stderr, '');
    }
    assert.ok(!fs.existsSync(path.join(root, '.claude')), 'no .claude/ written into a repo the user merely opened');
    // Positive control: the same run in a project the stack was set up in does record the session.
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
    const r = run(root, { hook_event_name: 'Stop', session_id: 'u2', transcript_path: transcript(root, 'u2', [['Ship it?', 'Yes']]) }, pluginEnv);
    assert.strictEqual(r.status, 0);
    assert.ok(fs.existsSync(entryFile(root, 'u2')), 'the set-up project gets its history entry');
  } finally { rmDir(root); }
});

// Loading audit 2026-10-21 G3: a seat's own compaction runs SessionStart inside the seat, the MAIN session's id on the
// payload - it records nothing and injects nothing, so the main session's entry is never rewritten by a seat.
test('a seat\'s own compaction start writes no entry and injects nothing', () => {
  const root = project();
  try {
    run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: transcript(root, 's1', [['Ship it?', 'Yes']]) });
    const r = run(root, { hook_event_name: 'SessionStart', session_id: 's2', source: 'compact', agent_id: 'agent-1', transcript_path: path.join(root, 'absent.jsonl') });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.ok(!fs.existsSync(entryFile(root, 's2')), 'no entry under the main session\'s id');
  } finally { rmDir(root); }
});
