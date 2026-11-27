// N01 (session audit, 2026-11-27): the trivial-diff exit of guard-ungated-commit (2 files or fewer, 15 lines or fewer) skipped
// the consent as well as the receipt, and a real session committed a one-line change with no word from the user. The exit
// now needs the user's commit consent - a typed sentence or a picked option - and skips only the verify receipt.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { legacyBlock, userPick } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'stack', 'hooks', 'guard-ungated-commit.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-consent-trivial-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let n = 0;
// a repo holding one staged one-line change (the trivial class), or `files` staged files of 40 lines each
function repo(files = 0) {
  const dir = fs.mkdtempSync(path.join(TMP, 'r-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  if (files) for (let i = 0; i < files; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), Array.from({ length: 40 }, (_, k) => `line ${k}`).join('\n'));
  else fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nchanged\n');
  git('add', '-A');
  return dir;
}
const typed = (text, at = '10:00:00') => JSON.stringify({ type: 'user', timestamp: `2026-11-27T${at}Z`, message: { role: 'user', content: text } });
const picked = (label, at = '10:01:00') => JSON.stringify({ type: 'user', timestamp: `2026-11-27T${at}Z`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'answered' }] }, ...userPick(), toolUseResult: { answers: { 'Commit the change?': label } } });
function run(dir, rows) {
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, rows.length ? `${rows.join('\n')}\n` : '');
  return legacyBlock(spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `consent-${n}`, tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir, transcript_path: tp }),
    cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }));
}
const passes = (rows) => { const r = run(repo(), rows); assert.equal(r.status, 0, r.stderr); };
const meetsAsk = (rows) => {
  const r = run(repo(), rows);
  assert.equal(r.status, 2, 'the commit is held');
  assert.match(r.stderr, /Blocked: git commit/);
  assert.match(r.stderr, /AskUserQuestion/, 'the reason names the commit ask');
};

test('a one-line commit with no typed word and no answered ask meets the commit ask', () => { meetsAsk([]); });
test("'commit it' typed lets a one-line commit through with no receipt asked", () => { passes([typed('commit it')]); });
test("'commit it' at the end of a 2,000-char message lets it through", () => {
  const text = `${'Some long notes about the change. '.repeat(60)}commit it`;
  assert.ok(text.length > 2000);
  passes([typed(text)]);
});
test("'do not commit yet' alone meets the commit ask", () => { meetsAsk([typed('do not commit yet')]); });
test("an answered 'Commit now (Recommended)' lets it through", () => { passes([picked('Commit now (Recommended)')]); });
test("an answered 'Leave the change uncommitted' meets the commit ask", () => { meetsAsk([picked('Leave the change uncommitted')]); });
test("an answered 'Fix all, one more round' meets the commit ask", () => { meetsAsk([picked('Fix all, one more round')]); });
test("'commit it but do not push' lets the commit through", () => { passes([typed('commit it but do not push')]); });
test("a bullet-style message whose own line says 'commit it', with no stop marks, lets the commit through", () => {
  passes([typed('- fix the typo\n- check the docs\n- commit it\n- watch CI')]);
});
test("'do not push' on one line and 'commit it' on the next lets the commit through", () => { passes([typed('do not push\ncommit it')]); });
test('a 3-file commit is unchanged: the receipt path still asks for the gate receipt', () => {
  const r = run(repo(3), [typed('commit it')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pre-commit gate receipt/);
});

// The controller's ruling: the trivial exit reads the LATEST typed turn, and an answer only when it landed after that turn.
test("'commit it' typed, then a later typed turn, then a one-line commit meets the commit ask", () => {
  meetsAsk([typed('commit it', '10:00:00'), typed('what does the parser do?', '10:05:00')]);
});
test("'commit it' as the latest typed turn lets the commit through, an older turn notwithstanding", () => {
  passes([typed('what does the parser do?', '10:00:00'), typed('commit it', '10:05:00')]);
});
test("an answered 'Commit now (Recommended)' after the latest typed turn lets it through", () => {
  passes([typed('fix the typo', '10:00:00'), picked('Commit now (Recommended)', '10:05:00')]);
});
test("an answered 'Commit now (Recommended)' before the latest typed turn meets the commit ask", () => {
  meetsAsk([picked('Commit now (Recommended)', '10:00:00'), typed('fix one more typo', '10:05:00')]);
});
