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

// --- the session status file (2026-10-29, plan task 4): written at SessionStart and on a change at Stop, pruned and
// kept out of git. Each git case hands the hook a HOME outside the project (P3): gitTopOf stops at the home folder.
const { EXCLUDE_COMMENT } = require(path.join(HOOKS, 'session-status.js'));
const statusOf = (base, id) => path.join(base, '.claude', 'session-inspector', 'status', `${id}.json`);
const readStatus = (base, id) => JSON.parse(fs.readFileSync(statusOf(base, id), 'utf8'));
const listOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json'), 'utf8')); } catch { return null; } };
const posixOf = (p) => p.split(path.sep).join('/');
const DAY = 86400000;
const ageFile = (file, ms) => { const at = (Date.now() - ms) / 1000; fs.utimesSync(file, at, at); };
const putStatus = (base, id, text = '{}') => { const f = statusOf(base, id); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const away = () => fs.realpathSync(tmpDir('history-session-home-'));
const start = (root, id, extra = {}, cwd) => run(root, { hook_event_name: 'SessionStart', session_id: id, source: 'startup', ...(cwd ? { cwd } : {}) }, extra);
const stop = (root, id, extra = {}, cwd) => run(root, { hook_event_name: 'Stop', session_id: id, transcript_path: '', ...(cwd ? { cwd } : {}) }, extra);
const excludeOf = (root) => { try { return fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8'); } catch { return null; } };
const STATUS_LINE = '/.claude/session-inspector/status/';
const gitIn = (root, ...a) => execFileSync('git', a, { cwd: root, env: env(root), stdio: 'pipe' }).toString();

test('T7 a session writes, a new id writes anew, the prune keeps its edges', () => {
  const root = project();
  const home = away();
  try {
    const extra = { HOME: home };
    assert.strictEqual(start(root, 's1', extra).status, 0);
    assert.strictEqual(readStatus(root, 's1').session, 's1');
    const x1 = putStatus(root, 'x1');
    const x2 = putStatus(root, 'x2');
    const own = putStatus(root, 's2');
    ageFile(x1, 6 * DAY); ageFile(x2, 8 * DAY); ageFile(own, 8 * DAY);
    assert.strictEqual(start(root, 's2', extra).status, 0);
    assert.strictEqual(readStatus(root, 's2').session, 's2');
    assert.ok(fs.existsSync(x1), '6 days: kept');
    assert.ok(!fs.existsSync(x2), '8 days: removed');
    assert.ok(fs.existsSync(statusOf(root, 's1')), 'the other session\'s fresh file stays');
  } finally { rmDir(root); rmDir(home); }
});

test('T7 the cwd decides the base', () => {
  const root = project();
  const home = away();
  const wt = `${root}-wt`;
  const scratch = fs.realpathSync(tmpDir('history-session-scratch-'));
  const other = project();
  try {
    const extra = { HOME: home };
    gitIn(root, 'worktree', 'add', '-q', '-b', 'side', wt);
    start(root, 'w1', extra, wt);
    assert.ok(fs.existsSync(statusOf(wt, 'w1')), 'a linked worktree writes under the worktree');
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    start(root, 'u1', extra, sub);
    assert.ok(fs.existsSync(statusOf(sub, 'u1')), 'a subfolder writes under it');
    assert.ok(listOf(root).includes(posixOf(sub)), 'and lists it');
    ageFile(statusOf(sub, 'u1'), 8 * DAY);
    // a gone base and one outside the project join the list by hand
    const otherOld = putStatus(other, 'oooooooo');
    ageFile(otherOld, 8 * DAY);
    const otherExclude = excludeOf(other);
    fs.writeFileSync(path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json'), JSON.stringify([...listOf(root), posixOf(path.join(root, 'gone')), posixOf(other)]));
    start(root, 'u2', extra);
    assert.ok(!fs.existsSync(statusOf(sub, 'u1')), 'the next start from the root prunes the listed subfolder');
    assert.ok(fs.existsSync(otherOld), 'nothing pruned outside the project');
    assert.strictEqual(excludeOf(other), otherExclude, 'nothing excluded outside the project');
    const list = listOf(root);
    assert.ok(!list.includes(posixOf(path.join(root, 'gone'))), 'a gone folder leaves the list');
    assert.ok(!list.includes(posixOf(other)), 'an outside base leaves the list');
    // a 33rd base drops the oldest
    const many = Array.from({ length: 32 }, (_, i) => { const b = path.join(root, `m${i}`); putStatus(b, 'mmmmmmmm'); return posixOf(b); });
    fs.writeFileSync(path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json'), JSON.stringify(many));
    const last = path.join(root, 'm32');
    fs.mkdirSync(last);
    start(root, 'u3', extra, last);
    assert.deepStrictEqual(listOf(root), [...many.slice(1), posixOf(last)]);
    for (const cwd of [scratch, home]) {
      start(root, 'z1', extra, cwd);
      assert.ok(!fs.existsSync(path.join(cwd, '.claude')), `${cwd === home ? 'a fake home' : 'a scratch'} cwd writes nothing`);
    }
  } finally {
    try { gitIn(root, 'worktree', 'remove', '--force', wt); } catch { /* gone */ }
    rmDir(root); rmDir(home); rmDir(wt); rmDir(scratch); rmDir(other);
  }
});

test('T7 the gates', () => {
  const root = project();
  const home = away();
  try {
    const cases = [
      [{ HOME: home, CLAUDE_PLUGIN_ROOT: path.join(root, '..', 'plugin-cache', 'alfred-code', '3.3.0') }, {}],
      [{ HOME: home, ALFRED_CODE_HOOKS_OFF: 'history-session' }, {}],
      [{ HOME: home }, { cursor_version: '1.0' }],
    ];
    for (const [extra, more] of cases) {
      for (const payload of [{ hook_event_name: 'SessionStart', session_id: 'g1', source: 'startup' }, { hook_event_name: 'Stop', session_id: 'g1', transcript_path: '' }]) {
        assert.strictEqual(run(root, { ...payload, ...more }, extra).status, 0);
      }
      assert.ok(!fs.existsSync(path.join(root, '.claude', 'session-inspector')), JSON.stringify({ ...extra, ...more }));
    }
    start(root, 'h0', { HOME: home, ALFRED_CODE_HISTORY: '0' });
    assert.strictEqual(readStatus(root, 'h0').handoffPrompt, null, 'history off: written, no prompt');
  } finally { rmDir(root); rmDir(home); }
});

test('T7 fail-open and change-only', () => {
  const root = project();
  const home = away();
  const bare = tmpDir('history-session-bare-');
  try {
    const extra = { HOME: home };
    for (const f of fs.readdirSync(HOOKS)) if (f !== 'session-status.js' && !fs.statSync(path.join(HOOKS, f)).isDirectory()) fs.copyFileSync(path.join(HOOKS, f), path.join(bare, f));
    run(root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: transcript(root, 's1', [['Ship it?', 'Yes']]) }, extra);
    const without = run(root, { hook_event_name: 'SessionStart', session_id: 's3', source: 'startup' }, extra, path.join(bare, 'history-session.js'));
    fs.rmSync(path.join(root, '.claude', 'session-inspector'), { recursive: true, force: true });   // the Stop above made it
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector'), 'a file');
    const blocked = start(root, 's3', extra);
    assert.strictEqual(blocked.status, 0);
    assert.ok(without.stdout.length > 0, 'the start block is there to compare');
    assert.strictEqual(blocked.stdout, without.stdout, 'the start output is what it is without the module');
    fs.rmSync(path.join(root, '.claude', 'session-inspector'));
    stop(root, 'c1', extra);
    const file = statusOf(root, 'c1');
    const bytes = fs.readFileSync(file, 'utf8');
    ageFile(file, 3600000);
    const mtime = fs.statSync(file).mtimeMs;
    stop(root, 'c1', extra);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes, 'an unchanged Stop leaves the bytes');
    assert.strictEqual(fs.statSync(file).mtimeMs, mtime, 'and the mtime');
    ageFile(file, 25 * 3600000);
    stop(root, 'c1', extra);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes, '25 hours: the bytes stay');
    assert.ok(Date.now() - fs.statSync(file).mtimeMs < 3600000, '25 hours: the mtime moves');
    fs.writeFileSync(file, 'garbage');
    stop(root, 'c1', extra);
    assert.strictEqual(readStatus(root, 'c1').schema, 1, 'a garbage file gets a full write');
  } finally { rmDir(root); rmDir(home); rmDir(bare); }
});

test('T8 the exclude line', () => {
  const home = away();
  const roots = [];
  const fresh = () => { const r = project(); roots.push(r); return r; };
  try {
    const extra = { HOME: home };
    const root = fresh();
    start(root, 's1', extra);
    const lines = (text) => text.split(/\r?\n/);
    assert.deepStrictEqual(lines(excludeOf(root)).slice(-3), [EXCLUDE_COMMENT, STATUS_LINE, '']);
    start(root, 's2', extra);
    assert.strictEqual(lines(excludeOf(root)).filter((l) => l === STATUS_LINE).length, 1, 'a second start adds none');
    fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), excludeOf(root).replace(`${STATUS_LINE}\n`, ''));
    start(root, 's3', extra);
    assert.strictEqual(lines(excludeOf(root)).filter((l) => l === STATUS_LINE).length, 1, 'a deleted line is back');
    assert.strictEqual(gitIn(root, 'status', '--porcelain', '--', '.claude'), '', 'git sees no status file');

    const dirRoot = fresh();
    fs.rmSync(path.join(dirRoot, '.git', 'info', 'exclude'), { force: true });
    fs.mkdirSync(path.join(dirRoot, '.git', 'info', 'exclude'), { recursive: true });
    start(dirRoot, 'd1', extra);
    assert.ok(fs.existsSync(statusOf(dirRoot, 'd1')), 'the status file is still written');
    const rows = fs.readFileSync(path.join(dirRoot, '.alfred', 'statistics', 'hook-blocks', 'd1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'status-exclude');
    assert.deepStrictEqual(rows.map((r) => r.result), ['failed']);

    const main = fresh();
    const wt = `${main}-wt`;
    roots.push(wt);
    gitIn(main, 'worktree', 'add', '-q', '-b', 'side', wt);
    start(main, 'w1', extra, wt);
    assert.ok(lines(excludeOf(main)).includes(STATUS_LINE), 'a linked worktree\'s line lands in the main checkout\'s exclude');
    gitIn(main, 'worktree', 'remove', '--force', wt);

    const subRoot = fresh();
    fs.mkdirSync(path.join(subRoot, 'sub'));
    start(subRoot, 'u1', extra, path.join(subRoot, 'sub'));
    assert.ok(lines(excludeOf(subRoot)).includes('/sub/.claude/session-inspector/status/'));

    const crlf = fresh();
    fs.writeFileSync(path.join(crlf, '.git', 'info', 'exclude'), '# mine\r\n*.log\r\n');
    start(crlf, 'r1', extra);
    assert.strictEqual(excludeOf(crlf), `# mine\r\n*.log\r\n${EXCLUDE_COMMENT}\r\n${STATUS_LINE}\r\n`, 'a CRLF file stays CRLF');

    const open = fresh();
    fs.writeFileSync(path.join(open, '.git', 'info', 'exclude'), '*.log');
    start(open, 'o1', extra);
    assert.strictEqual(excludeOf(open), `*.log\n${EXCLUDE_COMMENT}\n${STATUS_LINE}\n`, 'the last line stays whole');

    const plain = fs.realpathSync(tmpDir('history-session-nogit-'));
    roots.push(plain);
    start(plain, 'n1', extra);
    assert.ok(fs.existsSync(statusOf(plain, 'n1')), 'outside git the file is written');
    assert.ok(!fs.existsSync(path.join(plain, '.git')), 'and no .git appears');
  } finally { rmDir(home); for (const r of roots) rmDir(r); }
});

test('T8 a glob character in the path is escaped', () => {
  const root = project();
  const home = away();
  try {
    const odd = path.join(root, 'a[1] b');
    fs.mkdirSync(odd);
    start(root, 's1', { HOME: home }, odd);
    assert.ok(excludeOf(root).split('\n').includes('/a\\[1] b/.claude/session-inspector/status/'));
    const r = spawnSync('git', ['check-ignore', '-q', 'a[1] b/.claude/session-inspector/status/s1.json'], { cwd: root, env: env(root) });
    assert.strictEqual(r.status, 0, 'git check-ignore reads it as ignored');
  } finally { rmDir(root); rmDir(home); }
});
