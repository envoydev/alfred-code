// Session audit 2026-11-27, C3 (N02): an `authorized: "<quote>"` on a COMMIT-GATE or PUSH-GATE receipt counts only as the
// user's own words - a substring of a typed turn, or of an answer the user typed into an ask. A quote no typed turn holds,
// a side agent's note and a hook-answered ask give no consent. Each case runs through the hook's real entry.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { legacyBlock, REVIEW_ROW, userPick, foreignWords } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_PROJECT_DIR;

const GUARD = path.join(__dirname, '..', 'stack', 'hooks', 'guard-ungated-commit.js');
const HELPER = path.join(__dirname, '..', 'stack', 'skills', 'habits-commit-checkpoint', 'scripts', 'receipt.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-consent-quote-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
// Out of TMP first: Windows refuses to remove the folder a process stands in (EBUSY).
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.chdir(TMP);

const NOTE_OPENER = 'Here is a note offered by a side agent';
const QUOTE = 'yes, push it';
const NOT_TYPED = /not in any message the user typed/;

let n = 0;
const typedRow = (text, at) => JSON.stringify({ type: 'user', timestamp: `2026-11-27T${at}Z`, message: { role: 'user', content: text } });
// an AskUserQuestion answer row: `source` says who gave it ('user_temporary' a person, 'hook' an auto-answer)
const answerRow = (text, source, at) => JSON.stringify({ type: 'user', timestamp: `2026-11-27T${at}Z`,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Your questions have been answered' }] },
  ...userPick(source), toolUseResult: { answers: { 'Next?': text } } });
const labelRow = (label) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-27T09:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion',
  input: { questions: [{ question: 'Next?', header: 'Next', multiSelect: false, options: [{ label }, { label: 'Hold' }] }] } }] } });

function aheadRepo() {
  const base = fs.mkdtempSync(path.join(TMP, 'p-'));
  spawnSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')]);
  const dir = path.join(base, 'repo');
  spawnSync('git', ['clone', '-q', path.join(base, 'remote.git'), dir]);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nchanged\n');
  git('commit', '-qam', 'change');
  return dir;
}
function gateWith(rows, quote, command = 'git push', timeout) {
  const dir = aheadRepo();
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, `${[REVIEW_ROW, ...rows].join('\n')}\n`);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const h = spawnSync(process.execPath, [HELPER, 'push', '--verified', 'the change', '--authorized', quote, '--probe', 'NOT RUN - fixture'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(h.status, 0, h.stderr);
  return legacyBlock(spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `quote-${n}`, tool_name: 'Bash', tool_input: { command }, cwd: dir, transcript_path: tp }),
    cwd: dir, encoding: 'utf8', env, timeout }));
}
const passes = (rows, quote = QUOTE) => { const r = gateWith(rows, quote); assert.equal(r.status, 0, r.stderr); };
const refused = (rows, quote, reason) => {
  const r = gateWith(rows, quote);
  assert.equal(r.status, 2, 'the push is held');
  assert.match(r.stderr, reason);
};

test('a quote the user typed opens the gate', () => {
  passes([typedRow(`ok, ${QUOTE} now`, '10:00:00')]);
});

test('a quote no typed turn holds meets the ask', () => {
  refused([typedRow('looks good to me', '10:00:00')], QUOTE, NOT_TYPED);
});

test('a quote with no typed turn at all meets the ask', () => {
  refused([], QUOTE, NOT_TYPED);
});

test('a quote taken from a side-agent note meets the ask', () => {
  refused([typedRow(`${NOTE_OPENER}:\n${QUOTE}`, '10:00:00')], QUOTE, NOT_TYPED);
});

test("'yes, push it' typed into an ask's Other field opens the gate", () => {
  passes([answerRow(QUOTE, 'user_temporary', '10:00:00')]);
});

test('the same text in an auto-answered ask meets the ask', () => {
  refused([answerRow(QUOTE, 'hook', '10:00:00')], QUOTE, NOT_TYPED);
});

test('an option label as the quote is refused as the run\'s own sentence, as before', () => {
  refused([labelRow(QUOTE), typedRow('looks good to me', '10:00:00')], QUOTE, /option label THIS run wrote/);
});

test('a typed turn that holds an option label opens the gate, as before', () => {
  passes([labelRow(QUOTE), typedRow(QUOTE, '10:00:00')]);
});

test('the refusal tells the model to quote the user or ask', () => {
  const r = gateWith([typedRow('looks good to me', '10:00:00')], QUOTE);
  assert.match(r.stderr, /quote the user's own words, or ask/);
});

// A quote is the user's words when it matches a typed turn by whole words, punctuation aside (fix round 1).
test('a curly apostrophe typed and a straight one quoted match as the same words', () => {
  passes([typedRow('yes it’s fine, push it', '10:00:00')], "yes it's fine, push it");
});

test('a straight apostrophe typed and a curly one quoted match as the same words', () => {
  passes([typedRow("yes it's fine, push it", '10:00:00')], 'yes it’s fine, push it');
});

test("typed 'push it' and quoted 'push it.' match: end punctuation is no part of the words", () => {
  passes([typedRow('push it', '10:00:00')], 'push it.');
});

test("typed 'push it!' and quoted 'push it.' match", () => {
  passes([typedRow('push it!', '10:00:00')], 'push it.');
});

test("typed 'ok… push it' with the ellipsis sign and quoted 'ok... push it' match", () => {
  passes([typedRow('ok… push it', '10:00:00')], 'ok... push it');
});

test("a quote cut with '...' matches a longer typed turn whose parts come in the same order", () => {
  passes([typedRow('ok, the tests look fine to me so push it', '10:00:00')], 'ok ... push it');
});

test("a cut quote whose parts come in the other order in the typed turn meets the ask", () => {
  refused([typedRow('push it, ok', '10:00:00')], 'ok ... push it', NOT_TYPED);
});

test("a quote 'yes' is not in a typed 'yesterday': whole words only", () => {
  refused([typedRow('yesterday it was red', '10:00:00')], 'yes', NOT_TYPED);
});

test("a quote 'push' is not in a typed 'pushover': whole words only", () => {
  refused([typedRow('the pushover app is fine', '10:00:00')], 'push', NOT_TYPED);
});

test("typed 'Push it.' and quoted 'push it' match: case is no part of the words", () => {
  passes([typedRow('Push it.', '10:00:00')], 'push it');
});

// DEFERRED (round 2 ruling): a quote cut out of a refusal - typed 'don't push it', quoted 'push it' - passes the match. Only a
// reader of the user's clause could close it, and that is a new parser. The quote's own words still go through consentIn.

test("a quote from a longer turn passes: typed 'ok, push it. don't merge yet'", () => {
  passes([typedRow("ok, push it. don't merge yet", '10:00:00')], 'push it');
});

test("a refusing sentence earlier in the turn does not hide a later one that consents", () => {
  passes([typedRow("don't push it yet. ok, push it now", '10:00:00')], 'push it now');
});

// Matching is whole words in order and reads no clause of the typed turn: honest consent is never refused for what else it says.
test("typed \"commit and push, don't merge\" and quoted 'commit and push' pass on the PUSH-GATE", () => {
  passes([typedRow("commit and push, don't merge", '10:00:00')], 'commit and push');
});

test("typed 'push it but don't merge' and quoted 'push it' pass", () => {
  passes([typedRow("push it but don't merge", '10:00:00')], 'push it');
});

test("typed 'push it' with words of another script after it passes with the quote 'push it'", () => {
  passes([typedRow(`push it, ${foreignWords(2, 5)}`, '10:00:00')], 'push it');
});

test("typed 'push it to Jos\u00e9 now' and quoted 'push it' pass", () => {
  passes([typedRow('push it to Jos\u00e9 now', '10:00:00')], 'push it');
});

test('a typed run-on sentence past 1,000 characters holds a short quote', () => {
  passes([typedRow(`ok push it ${'and then some words '.repeat(60)}`, '10:00:00')], 'push it');
});

// The parts of a cut quote are placed one after the other, each at its first whole-word place: no backtracking.
test("a cut quote with many parts against a long typed turn is refused at once, not after a search of every placement", () => {
  const typed = typedRow(`push it ${'a '.repeat(300)}`, '10:00:00');
  const quote = 'push it ... a ... a ... a ... a ... zz';
  const control = Date.now();
  refused([typedRow('push it a', '10:00:00')], quote, NOT_TYPED);
  const baseline = Date.now() - control;
  const started = Date.now();
  const r = gateWith([typed], quote, 'git push', 20000);
  const took = Date.now() - started;
  assert.equal(r.status, 2, 'the push is held');
  assert.match(r.stderr, NOT_TYPED);
  assert.ok(took < baseline + 500, `took ${took}ms against ${baseline}ms for a short turn`);
});

// The COMMIT-GATE receipt reads the same quote: a change past the trivial bar needs the receipt.
function commitGateWith(rows, quote) {
  const dir = fs.mkdtempSync(path.join(TMP, 'c-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) fs.writeFileSync(path.join(dir, name), `${'line\n'.repeat(40)}${name}\n`);
  git('add', '-A');
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, `${[REVIEW_ROW, ...rows].join('\n')}\n`);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const h = spawnSync(process.execPath, [HELPER, 'commit', '--verified', 'the change', '--authorized', quote, '--probe', 'NOT RUN - fixture', '--format', 'none', '--findings', 'none'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(h.status, 0, h.stderr);
  return legacyBlock(spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `quote-${n}`, tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir, transcript_path: tp }),
    cwd: dir, encoding: 'utf8', env }));
}

test('a COMMIT-GATE quote the user typed opens the gate', () => {
  const r = commitGateWith([typedRow('please commit it now', '10:00:00')], 'commit it');
  assert.equal(r.status, 0, r.stderr);
});

test('a COMMIT-GATE quote no typed turn holds meets the ask', () => {
  const r = commitGateWith([typedRow('looks good to me', '10:00:00')], 'commit it');
  assert.equal(r.status, 2, 'the commit is held');
  assert.match(r.stderr, NOT_TYPED);
});
