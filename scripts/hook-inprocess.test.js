'use strict';
// hook-inprocess.js runs a hook in this process for the suites that drive one hundreds of times. These cases hold its
// answer to the spawned one, field for field, on a sample of the stop contract's routes - a pass, each kind of block, an
// ask fixed in place, a seat's stop, garbage stdin - and pin that a run leaves this process as it found it.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inProcess, spawned, runHook, HOOKS } = require('./hook-inprocess');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-inprocess-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const transcript = (name, rows) => {
  const p = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
};
const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text }, uuid: `u-${text.length}`, timestamp: '2026-11-03T00:00:00.000Z' });
const assistantRow = (id, text) => ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }], usage: { cache_read_input_tokens: 10 } } });
// Each side gets its own log dir, so a marker one run writes never decides the other's answer.
const both = (name, payload) => {
  const env = (side) => ({ ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, `${name}-${side}-`)) });
  return { inproc: inProcess('guard-stop-contract.js', payload, { env: env('in') }), spawn: spawned('guard-stop-contract.js', payload, { env: env('sp') }) };
};

const CASES = [
  ['a clean done close passes', { hook_event_name: 'Stop', session_id: 'p1', last_assistant_message: 'Done. The fix is in and its test passes.' }],
  ['a decision put in prose blocks', { hook_event_name: 'Stop', session_id: 'p2', last_assistant_message: 'The parser is fixed. Should I also refactor the lexer, or leave it for now?' }],
  ['a done close with a step still pending blocks', { hook_event_name: 'Stop', session_id: 'p3', last_assistant_message: 'Done with the parser. Next I will update the lexer and then run the suite.' }],
  ['a close read from the transcript tail', { hook_event_name: 'Stop', session_id: 'p4', transcript_path: transcript('p4', [userRow('fix it'), assistantRow('m4', 'Fixed and tested.')]) }],
  ['a tool-ended transcript waits once and passes', { hook_event_name: 'Stop', session_id: 'p5', transcript_path: transcript('p5', [userRow('go'), { type: 'assistant', message: { id: 'm5', role: 'assistant', content: [{ type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'ls' } }] } }]) }],
  ['a continuation after its own hold', { hook_event_name: 'Stop', session_id: 'p6', stop_hook_active: true, last_assistant_message: 'Should I push it?' }],
  ['a seat\'s stop', { hook_event_name: 'SubagentStop', session_id: 'p7', agent_id: 'a7', agent_type: 'general-purpose', last_assistant_message: 'I will wait for the build to finish.' }],
  ['an ask with an em-dash is fixed in place', { hook_event_name: 'PreToolUse', session_id: 'p8', tool_name: 'AskUserQuestion', tool_use_id: 'tu8',
    tool_input: { questions: [{ question: 'Which route — A or B?', header: 'Route', multiSelect: false, options: [{ label: 'A (Recommended)', description: 'the short one' }, { label: 'B', description: 'the long one' }] }] } }],
  ['an unmarked question is denied', { hook_event_name: 'PreToolUse', session_id: 'p9', tool_name: 'AskUserQuestion', tool_use_id: 'tu9',
    tool_input: { questions: [{ question: 'Which route?', header: 'Route', multiSelect: false, options: [{ label: 'A', description: 'one' }, { label: 'B', description: 'two' }] }] } }],
  ['garbage stdin passes', '{not json'],
];

for (const [name, payload] of CASES) {
  test(`in-process equals spawned: ${name}`, () => {
    const { inproc, spawn } = both(name.replace(/\W+/g, '-').slice(0, 30), payload);
    assert.deepStrictEqual(inproc, spawn);
  });
}

test('the sample covers a pass, a block and an ask fixed in place, so the parity is not three passes', () => {
  const answers = CASES.map(([name, payload]) => both(`cov-${name.length}`, payload).inproc);
  assert.ok(answers.some((r) => r.status === 0 && !r.stdout.trim()), 'a silent pass');
  assert.ok(answers.some((r) => r.status === 2 || /"decision"\s*:\s*"block"/.test(r.stdout)), 'a block');
  assert.ok(answers.some((r) => /updatedInput/.test(r.stdout)), 'an ask fixed in place');
  assert.ok(answers.some((r) => r.status === 2 && /^Blocked: this AskUserQuestion/.test(r.stderr)), 'an ask denied');
});

test('a run leaves this process as it found it: env, cwd, argv, exit hooks and no stack module cached', () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  const argv = [...process.argv];
  const exit = process.exit;
  const elsewhere = fs.mkdtempSync(path.join(TMP, 'cwd-'));
  inProcess('guard-stop-contract.js', CASES[1][1], { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: elsewhere, EXTRA_ONLY_IN_RUN: '1' }, cwd: elsewhere });
  assert.deepStrictEqual({ ...process.env }, env);
  assert.strictEqual(process.cwd(), cwd);
  assert.deepStrictEqual(process.argv, argv);
  assert.strictEqual(process.exit, exit);
  assert.deepStrictEqual(Object.keys(require.cache).filter((k) => k.startsWith(HOOKS + path.sep)), []);
});

test('HOOK_TEST_SPAWN=1 spawns instead, the answer unchanged', () => {
  const payload = CASES[1][1];
  const env = () => ({ ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'sw-')) });
  const inproc = runHook('guard-stop-contract.js', payload, { env: env() });
  process.env.HOOK_TEST_SPAWN = '1';
  try { assert.deepStrictEqual(runHook('guard-stop-contract.js', payload, { env: env() }), inproc); }
  finally { delete process.env.HOOK_TEST_SPAWN; }
});

test('a hook that throws fails the call loudly - a process would print the stack and exit 1, never pass', () => {
  const bad = path.join(HOOKS, `zz-inprocess-throw-${process.pid}.js`);
  fs.writeFileSync(bad, "throw new Error('boom');\n");
  try { assert.throws(() => inProcess(path.basename(bad), {}), /threw in-process: Error: boom/); }
  finally { fs.rmSync(bad, { force: true }); }
});
