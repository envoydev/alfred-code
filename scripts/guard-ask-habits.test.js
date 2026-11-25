// scripts/guard-ask-habits.test.js - the read, fresh-session and dispatch guards ask where a person can answer and deny with
// today's text where nobody can (guards ask, Task 5). The wording of each block is pinned by the suites of the guards; this one
// pins what the block DOES: the verdict per mode, the one JSON object on stdout, and the dispatch cap's pending file.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { verdictOf, blockText, askText, legacyBlock } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { realLong } = require('./test-paths');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const READ_GUARD = path.join(HOOKS, 'guard-read-whole-file.js');
const FRESH_GUARD = path.join(HOOKS, 'guard-fresh-session-start.js');
const DISPATCH_GUARD = path.join(HOOKS, 'guard-unapproved-dispatch.js');
const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-ask-habits-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let counter = 0;
const sessionId = () => `habits-${process.pid}-${++counter}`;
// A project folder with one file past the 400-line threshold, the stack's convention rules as library copies and the
// ledger kept inside it.
function project() {
  const root = realLong(fs.mkdtempSync(path.join(TMP, 'proj-')));
  fs.writeFileSync(path.join(root, 'big.js'), 'const a = 1;\n'.repeat(500));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'stack', 'rules'), path.join(root, '.claude', 'rules'), { recursive: true });
  return root;
}
const spawnHook = (hook, root, payload, env = {}) => spawnSync(process.execPath, [hook], {
  cwd: root, input: JSON.stringify({ cwd: root, ...payload }), encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.alfred/docs', ...env },
});
const DONT_ASK = { permission_mode: 'dontAsk' };
const stateFile = (session) => path.join(os.tmpdir(), `guard-read-${session}.json`);

// Both modes of one call: asked in a mode a person answers, denied with today's text in dontAsk.
function bothWays(what, make, textRe) {
  const asked = make({});
  assert.strictEqual(verdictOf(asked), 'ask', `${what}: default mode asks (${asked.stdout}${asked.stderr})`);
  assert.match(askText(asked), /^alfred-code [\w-]+: \S/, `${what}: the user's line names the guard`);
  assert.match(blockText(asked), /^A guard asked the user about this call: /, `${what}: the model text opens with the asked line`);
  assert.match(legacyBlock(asked).stderr, textRe, `${what}: and carries today's full reason`);
  const denied = make(DONT_ASK);
  assert.strictEqual(verdictOf(denied), 'deny', `${what}: dontAsk denies (${denied.stdout}${denied.stderr})`);
  assert.match(blockText(denied), textRe, `${what}: the deny carries today's full text`);
  const output = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.strictEqual(output.additionalContext, undefined, `${what}: a deny has no additionalContext`);
}

test('each habit block denies under dontAsk with today\'s text: whole Read (B14), range cap (B12), cat dump (B13)', () => {
  const root = project();
  const big = path.join(root, 'big.js');
  bothWays('a whole-file Read', (extra) => spawnHook(READ_GUARD, root, { session_id: sessionId(), tool_name: 'Read', tool_input: { file_path: big }, ...extra }),
    /^Blocked: whole-file Read of .*big\.js \(500 lines\)/);
  bothWays('a ranged Read past the cap', (extra) => {
    const session = sessionId();
    const read = (offset) => spawnHook(READ_GUARD, root, { session_id: session, tool_name: 'Read', tool_input: { file_path: big, offset, limit: 200 }, ...extra });
    assert.strictEqual(verdictOf(read(1)), 0, 'the first 200 lines are a range');
    return read(201);
  }, /^Blocked: ranged reads of .* now cover 80% of its 500 lines/);
  bothWays('a cat dump', (extra) => spawnHook(READ_GUARD, root, { session_id: sessionId(), tool_name: 'Bash', tool_input: { command: `cat ${big}` }, ...extra }),
    /^Blocked: whole-file dump of .*big\.js \(500 lines\)/);
});

test('each habit block denies under dontAsk with today\'s text: a user-only skill (B38)', () => {
  const root = project();
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'users-own'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'users-own', 'SKILL.md'), '---\nname: users-own\ndescription: x\ndisable-model-invocation: true\n---\nbody\n');
  bothWays('a disable-model-invocation skill', (extra) => spawnHook(FRESH_GUARD, root,
    { hook_event_name: 'PreToolUse', session_id: sessionId(), tool_name: 'Skill', tool_input: { skill: 'users-own' }, ...extra }),
  /^Blocked: users-own is marked disable-model-invocation/);
});

test('each habit block denies under dontAsk with today\'s text: a symbol question (B44) and an unapproved implementer (B47)', () => {
  const root = project();
  const dispatch = (subagent_type, prompt) => (extra) => spawnHook(DISPATCH_GUARD, root,
    { hook_event_name: 'PreToolUse', session_id: sessionId(), tool_name: 'Agent', tool_use_id: 'toolu_habits', tool_input: { subagent_type, prompt }, ...extra });
  bothWays('an Explore symbol question', dispatch('Explore', 'Find who calls SocketConnection.Send'), /^Blocked: /);
  bothWays('an implementer with no APPROVAL stamp', dispatch('alfred-code:aspnet-implementer', 'build it'), /without an approval gate/);
});

test('the rule notice never rides a block: one JSON object on stdout, and the rule is not spent', () => {
  const root = project();
  const big = path.join(root, 'big.js');
  const noticeRe = /touches files governed by/;
  const announced = sessionId();
  const write = 'printf x > out.js';
  const control = spawnHook(READ_GUARD, root, { session_id: announced, tool_name: 'Bash', tool_input: { command: write } });
  assert.strictEqual(verdictOf(control), 0, 'a write of a rule-governed file is allowed');
  assert.match(String(JSON.parse(control.stdout).hookSpecificOutput.additionalContext), noticeRe, 'control: an allowed write of a rule-governed file carries the notice');
  assert.ok(JSON.parse(fs.readFileSync(stateFile(announced), 'utf8')).__rules.length > 0, 'control: and records the rule as said');

  for (const extra of [{}, DONT_ASK]) {
    const session = sessionId();
    const blocked = spawnHook(READ_GUARD, root, { session_id: session, tool_name: 'Bash', tool_input: { command: `${write} && cat ${big}` }, ...extra });
    const verdict = verdictOf(blocked);   // throws where stdout holds two JSON objects
    assert.strictEqual(verdict, extra.permission_mode ? 'deny' : 'ask', blocked.stdout);
    assert.doesNotMatch(blocked.stdout, noticeRe, 'the notice is not in the block');
    assert.ok(!fs.existsSync(stateFile(session)), 'the __rules state is not written for a blocked call');
  }
});
