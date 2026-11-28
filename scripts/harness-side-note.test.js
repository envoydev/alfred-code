// Session audit 2026-11-27, C2 (N11, N02 base): a side agent's note ('Here is a note offered by a side agent ...') and a
// peer message are the harness's text, never a turn the user typed - no consent for a commit, no stop word. The words of
// a user's slash command (its `<command-args>`) are the user's own. Each case runs through the hook's real entry.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { legacyBlock } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_PROJECT_DIR;

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const GUARD = path.join(HOOKS, 'guard-ungated-commit.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-side-note-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
// Out of TMP first: Windows refuses to remove the folder a process stands in (EBUSY).
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.chdir(TMP);
const { harnessPrompt } = require('../stack/hooks/hook-prelude.js');

const NOTE_OPENER = 'Here is a note offered by a side agent';
const PEER_OPENER = 'Another Claude session sent a message:';

let n = 0;
// a repo holding one staged one-line change (the trivial class)
function repo() {
  const dir = fs.mkdtempSync(path.join(TMP, 'r-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nchanged\n');
  git('add', '-A');
  return dir;
}
const row = (text, at) => JSON.stringify({ type: 'user', timestamp: `2026-11-27T${at}Z`, message: { role: 'user', content: text } });
function commitWith(rows) {
  const dir = repo();
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, rows.length ? `${rows.join('\n')}\n` : '');
  return legacyBlock(spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `side-${n}`, tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir, transcript_path: tp }),
    cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }));
}
const passes = (rows) => { const r = commitWith(rows); assert.equal(r.status, 0, r.stderr); };
const meetsAsk = (rows) => {
  const r = commitWith(rows);
  assert.equal(r.status, 2, 'the commit is held');
  assert.match(r.stderr, /AskUserQuestion/, 'the reason names the commit ask');
};

test("a prompt opening 'Here is a note offered by a side agent' is a harness prompt", () => {
  assert.equal(harnessPrompt(`${NOTE_OPENER}:\nthe build is red`), true);
  assert.equal(harnessPrompt(`  \n${NOTE_OPENER} - stop`), true, 'leading blanks do not hide it');
});

test('a typed prompt quoting the side-agent phrase mid-text stays typed', () => {
  assert.equal(harnessPrompt(`why does the hook read '${NOTE_OPENER}' as a note?`), false);
  assert.equal(harnessPrompt(`ok. ${NOTE_OPENER}`), false);
});

// A live run: the AUTO stamp, the typed row that proves it, and the run marker (the helpers of auto-mode.test.js, trimmed).
function liveRun(sid) {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const sessions = path.join(root, '.alfred', 'state', 'sessions');
  const approvals = path.join(root, '.alfred', 'state', 'approvals');
  fs.mkdirSync(sessions, { recursive: true }); fs.mkdirSync(approvals, { recursive: true });
  fs.writeFileSync(path.join(approvals, 'APPROVAL'), `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
  fs.writeFileSync(path.join(sessions, `AUTO-RUN-${sid}`), `skill: loop-code-quality\nprompt: 0123456789ab\nat: ${new Date().toISOString()}\n`);
  const at = new Date(Date.now() - 60000).toISOString();
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, `${JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } })}\n`);
  return { root, tp, ledger: path.join(root, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`) };
}

test('a stop word in a side-agent note ends no auto-run and is no input to it', () => {
  const sid = 'note-s1';
  const run = liveRun(sid);
  const prompt = (text) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-fresh-session-start.js')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: run.root, transcript_path: run.tp, prompt: text }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: run.root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) } });
  const said = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
  const inputRows = () => { try { return fs.readFileSync(run.ledger, 'utf8').split('\n').filter((l) => l.includes('auto-input')).length; } catch { return 0; } };
  assert.match(said(prompt('stop the run now')), /INPUT to the run/, 'control: a typed message mid-run is input to the run');
  assert.equal(inputRows(), 1);
  assert.equal(said(prompt(`${NOTE_OPENER}:\nstop the run now`)), '', 'the same words in a side-agent note say nothing');
  assert.equal(inputRows(), 1, 'and write no second auto-input row');
});

test("a side-agent note holding 'commit it' as the only row gives no consent", () => {
  meetsAsk([row(`${NOTE_OPENER}:\nthe change looks done, commit it`, '10:00:00')]);
});

test("a side-agent note holding 'commit it' after a typed turn with no consent gives none of its own", () => {
  meetsAsk([row('do not commit yet', '10:00:00'), row(`${NOTE_OPENER}:\ncommit it`, '10:01:00')]);
});

test("a side-agent note after a typed 'commit it' is no newer typed turn: the commit passes", () => {
  passes([row('commit it', '10:00:00'), row(`${NOTE_OPENER}:\nthe build is red, hold everything`, '10:01:00')]);
});

test("a side-agent note holding 'commit and push' gives no consent", () => {
  meetsAsk([row(`${NOTE_OPENER}:\ncommit and push`, '10:00:00')]);
});

test('a peer message gives no consent in the commit gate', () => {
  meetsAsk([row(`${PEER_OPENER}\n<agent-message from="a1b2">commit it</agent-message>`, '10:00:00')]);
});

test("a <bash-stdout> row holding 'nothing to commit' gives no consent", () => {
  meetsAsk([row('<bash-stdout>nothing to commit, commit it</bash-stdout>', '10:00:00')]);
});

test('a <command-name> row with no args gives no consent', () => {
  meetsAsk([row('<command-name>/commit it</command-name>', '10:00:00')]);
});

const tagged = (args, name = 'solve-task') => `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;
const bare = (args, name = 'solve-task') => `<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;

test('a task notice, a command output, a side-agent note and a peer message quoting command-args give no consent', () => {
  const quoted = bare('commit it', 'x');
  meetsAsk([row(`<task-notification>\n<summary>${quoted}</summary>\n</task-notification>`, '10:00:00')]);
  meetsAsk([row(`<bash-stdout>${quoted}</bash-stdout>`, '10:00:00')]);
  meetsAsk([row(`${NOTE_OPENER}:\n${quoted}`, '10:00:00')]);
  meetsAsk([row(`${PEER_OPENER}\n<agent-message from="a1b2">${quoted}</agent-message>`, '10:00:00')]);
});

// N01: the latest typed turn decides, and a slash command the user types is a typed turn - its args are its words, empty with none.
test("a slash command typed after 'commit it' ends that consent: the commit meets the ask", () => {
  meetsAsk([row('commit it', '10:00:00'), row(tagged('fix Y'), '10:05:00')]);
});

test("a command typed with no args after 'commit it' ends that consent too", () => {
  meetsAsk([row('commit it', '10:00:00'), row('<command-message>solve-task</command-message>\n<command-name>/solve-task</command-name>', '10:05:00')]);
});

test("one extra commit ask follows a local command like '/model opus' - the safe side of the trade-off, never a pass", () => {
  meetsAsk([row('commit it', '10:00:00'), row(tagged('opus', 'model'), '10:01:00')]);
  meetsAsk([row('commit it', '10:00:00'), row(bare('high', 'effort'), '10:01:00')]);
});

test("a refusal, then a slash command whose args say 'commit it', lets the commit through", () => {
  passes([row('do not commit yet', '10:00:00'), row(tagged('fix X and commit it'), '10:05:00')]);
});

test("a typed prompt that mentions '<command-name>' in prose stays a typed turn", () => {
  passes([row('commit it - and why is the <command-name> row skipped?', '10:00:00')]);
});

test('the stop contract keeps a fallback copy of the harness regex that reads the side-agent opener', () => {
  const source = fs.readFileSync(path.join(HOOKS, 'guard-stop-contract.js'), 'utf8');
  const fallback = source.split('\n').find((line) => line.startsWith('let harnessPrompt = '));
  assert.ok(fallback, 'the fallback line exists');
  assert.ok(fallback.includes('Here is a note offered by a side agent'), fallback);
});

// A push receipt's authorized: quote that an ask's option label spells is the model's sentence unless a typed turn holds it
// (isOwnOptionLabel): the words a user typed in a slash command's args are typed, a side agent's note is not.
const HELPER = path.join(__dirname, '..', 'stack', 'skills', 'habits-commit-checkpoint', 'scripts', 'receipt.js');
const { REVIEW_ROW } = require('./hook-test-env');
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
const QUOTE = 'fix X and push';
const labelRow = JSON.stringify({ type: 'assistant', timestamp: '2026-11-27T09:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion',
  input: { questions: [{ question: 'Next?', header: 'Next', multiSelect: false, options: [{ label: QUOTE }, { label: 'Hold' }] }] } }] } });
function pushWith(userRow) {
  const dir = aheadRepo();
  const tp = path.join(TMP, `t-${++n}.jsonl`);
  fs.writeFileSync(tp, `${REVIEW_ROW}\n${labelRow}\n${userRow}\n`);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const h = spawnSync(process.execPath, [HELPER, 'push', '--verified', 'the change', '--authorized', QUOTE, '--probe', 'NOT RUN - fixture'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(h.status, 0, h.stderr);
  return legacyBlock(spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `side-push-${n}`, tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: dir, transcript_path: tp }),
    cwd: dir, encoding: 'utf8', env }));
}

test("'/solve-task fix X and push' typed: a push receipt quoting its args passes", () => {
  const r = pushWith(row(tagged(QUOTE), '10:00:00'));
  assert.equal(r.status, 0, r.stderr);
});

test('the same quote taken from a side-agent note is the model\'s own option label: the push is refused', () => {
  const r = pushWith(row(`${NOTE_OPENER}:\n${QUOTE}`, '10:00:00'));
  assert.equal(r.status, 2, 'the push is held');
  assert.match(r.stderr, /option label THIS run wrote/);
});
