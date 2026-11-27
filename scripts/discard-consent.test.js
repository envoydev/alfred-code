'use strict';
// The rm guard's discard with no prompt (discard-consent.js): the user's typed word after the model proposed the discard
// of each row, and a discard of the session's own lines.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { verdictOf, blockText } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const consent = require('../stack/hooks/discard-consent.js');
const { realLong } = require('./test-paths.js');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const runRm = (dir, command, transcript, extra = {}) =>
{
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'guard-catastrophic-rm.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: transcript, session_id: 'dc-test', cwd: dir, ...extra }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir,
  });
  const verdict = verdictOf(r);
  return { status: verdict, text: verdict === 'ask' || verdict === 'deny' ? blockText(r) : r.stderr };
};
function repo(seed = 'const a = 1;\nconst b = 2;\n')
{
  const dir = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'discard-consent-')));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'app.js'), seed);
  git('add', '-A'); git('commit', '-qm', 'seed');
  return { dir, git };
}
const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const said = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
let callId = 0;
// A tool call and its result row, as Claude Code writes them.
function call(name, input, { isError = false, result = {} } = {})
{
  const id = `c${++callId}`;
  return [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] }, toolUseResult: result }];
}
const edit = (file, oldString, newString, opts) => call('Edit', { file_path: file, old_string: oldString, new_string: newString }, opts);
function transcript(dir, rows)
{
  const file = path.join(dir, '..', `${path.basename(dir)}-${++callId}.jsonl`);
  fs.writeFileSync(file, `${rows.flat().map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

test('a typed discard word is only a bare imperative', () => {
  for (const p of ['then drop', 'DROP!', 'drop it', 'discard the stash', 'yes, delete it', 'ok drop stash@{0}', 'Go ahead and drop it.'])
    assert.equal(consent.promptAsksDiscard(p, 'stash'), true, p);
  for (const p of ["don't drop it", 'keep it', 'do we need to drop it?', 'do not discard', "you shouldn't drop it", 'don’t drop it',
    'drop it if it is stale', 'drop it later', 'before you drop it, show me', 'drop the plan, keep the stash', ''])
    assert.equal(consent.promptAsksDiscard(p, 'stash'), false, p);
  assert.equal(consent.promptAsksDiscard('revert it', 'tree'), true, 'a tree discard takes revert');
  assert.equal(consent.promptAsksDiscard('revert it', 'stash'), false, 'a stash is not reverted');
});

test('a row counts as proposed only on a line naming it exactly beside a discard verb, with no keep or negation', () => {
  const row = 'stash@{1}: WIP on develop: 57a8cbac refactor';
  assert.equal(consent.namesRow('Recommendation: drop `stash@{1}`.', 'stash', row), true);
  assert.equal(consent.namesRow('`stash@{1}` is your WIP - keep it.\nDrop `stash@{0}`.', 'stash', row), false, 'review F1');
  assert.equal(consent.namesRow('drop stash@{10}', 'stash', row), false);
  assert.equal(consent.namesRow('I will not drop stash@{1}', 'stash', row), false);
  assert.equal(consent.namesRow('revert `src/app.js` now', 'tree', ' M src/app.js'), true);
  assert.equal(consent.namesRow('revert webapp.js and lib/src/app.js', 'tree', ' M src/app.js'), false, 'review F3');
  assert.equal(consent.namesRow('revert app.js', 'tree', ' M src/app.js'), false, 'a basename alone is not the path');
});

test('an edit adds what its new text has more of, counted', () => {
  assert.deepEqual(consent.editLines('a\nb', 'a\nb\nconsole.log(1)'), { added: ['console.log(1)'], removed: [] });
  assert.deepEqual(consent.editLines('a\nold', 'a\nnew'), { added: ['new'], removed: ['old'] });
  assert.deepEqual(consent.editLines('}', '}\n}'), { added: ['}'], removed: [] });
});

test('diff lines are read by hunk state; a header the reader cannot read is no diff', () => {
  const d = 'diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +1,2 @@\n x\n+-- user comment\n+++i;\n';
  assert.deepEqual(consent.diffLines(d).get('q.sql').added, ['-- user comment', '++i;'], 'review F7');
  assert.equal(consent.diffLines('diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"\n@@ -1 +1 @@\n+x\n'), null, 'review F8');
});

test('the typed word clears a stash drop only after the model proposed that entry', () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 3;\n');
  git('stash', 'push', '-qm', 'user work');
  const named = transcript(dir, [typed('what is left?'), said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop')]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', named).status, 0, 'the user typed the drop after seeing the proposal');
  assert.equal(runRm(dir, 'git stash drop stash@{0}', named, { agent_id: 'seat-1' }).status, 'ask', 'review F14: a seat is not the main session');
  const unnamed = transcript(dir, [typed('what is left?'), said('One old entry is left.'), typed('then drop')]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', unnamed).status, 'ask', 'the entry was never named');
  const kept = transcript(dir, [said('`stash@{0}` is your WIP - keep it.'), typed('drop it')]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', kept).status, 'ask', 'review F1: named only to keep it');
  const negated = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed("you shouldn't drop it")]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', negated).status, 'ask', 'review F2');
  const queued = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'), { type: 'queue-operation', operation: 'enqueue', content: 'wait, keep it' }]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', queued).status, 'ask', 'review F9: a prompt queued after it is newer');
  const modelOnly = transcript(dir, [typed('fix the bug'), said('I will drop `stash@{0}` now.')]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', modelOnly).status, 'ask', "the model's own words are no consent");
  assert.equal(runRm(dir, 'git stash drop stash@{0}', path.join(dir, 'missing.jsonl')).status, 'ask', 'no transcript asks');
  const realShaped = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'),
    { type: 'attachment', attachment: { type: 'date' } }, { type: 'attachment', attachment: { type: 'deferred_tools_delta' } }, { type: 'last-prompt' }]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', realShaped).status, 0, 're-review N1: the rows Claude Code writes after a prompt');
  const queuedAttachment = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'), { type: 'attachment', attachment: { type: 'queued_command', prompt: 'wait' } }]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', queuedAttachment).status, 'ask', 'a queued prompt is newer');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 5;\n');
  git('stash', 'push', '-qm', 'second');
  const two = transcript(dir, [said('Drop `stash@{0}` (my probe); `stash@{1}` holds your WIP.'), typed('drop it')]);
  assert.equal(runRm(dir, 'git stash drop stash@{1}', two).status, 'ask', 're-review F1: two refs named');
  const asked = transcript(dir, [said('Drop `stash@{1}`, the probe?'), typed('drop stash@{0}')]);
  assert.equal(runRm(dir, 'git stash drop stash@{1}', asked).status, 'ask', 're-review N2: the typed ref is another entry');
  const loop = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop')]);
  assert.equal(runRm(dir, 'for i in 1 2; do git stash drop; done', loop).status, 'ask', 're-review N4: a loop');
  assert.equal(runRm(dir, 'while git stash drop; do :; done', loop).status, 'ask', 're-review N4: a while loop');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 4;\n');
  assert.equal(runRm(dir, 'git stash && git stash drop stash@{0}', named).status, 'ask', 'review F4: the ref moves inside the command');
  const spent = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'), call('Bash', { command: 'git stash drop stash@{0}' })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', spent).status, 'ask', 'third review H1: the word is spent once a stash call ran');
  const notice = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'),
    { type: 'user', message: { role: 'user', content: '<task-notification><task-id>x</task-id></task-notification>' } }]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', notice).status, 'ask', 'third review H1: a later turn a notice started');
  assert.equal(runRm(dir, 'repeat 2 git stash drop', loop).status, 'ask', 'third review M2: zsh repeat');
  const listed = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'), call('Bash', { command: 'git stash list' })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', listed).status, 0, 'a stash list moves no ref, so the word holds');
  assert.equal(runRm(dir, 'git stash list && git stash drop stash@{0}', named).status, 0, 'a stash list in the same command is no second call');
  assert.equal(runRm(dir, 'git stash show -p stash@{0}; git stash drop stash@{0}', named).status, 0, 'nor is a stash show');
  const own = call('Bash', { command: 'git stash drop stash@{0}' })[0];
  const withOwnRow = transcript(dir, [said('`stash@{0}` holds a stale copy. Drop it?'), typed('then drop'), own]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', withOwnRow, { tool_use_id: own.message.content[0].id }).status, 0, 'the judged call\'s own row is no other call');
  const proposal = said('`stash@{0}` holds a stale copy. Drop it?');
  const pushedAfter = transcript(dir, [proposal, call('Bash', { command: 'git stash push -m wip' }), typed('then drop')]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', pushedAfter).status, 'ask', 'fourth review N1: a stash made after the proposal');
  const autostash = transcript(dir, [proposal, typed('then drop'), call('Bash', { command: 'git pull --rebase --autostash' })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', autostash).status, 'ask', 'fourth review N2: an autostash after the word');
  const refused = transcript(dir, [proposal, typed('then drop'), call('Bash', { command: 'git stash list' }, { isError: true })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', refused).status, 'ask', 'fourth review N3: a refused call carries newer words');
  const askedAfter = transcript(dir, [proposal, typed('then drop'), call('AskUserQuestion', { questions: [] })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', askedAfter).status, 'ask', 'fourth review N3: an ask after the word');
  const readFirst = transcript(dir, [proposal, typed('then drop'), call('ToolSearch', { query: 'x' }), call('Read', { file_path: 'x' }), call('Bash', { command: 'git --no-pager stash list' })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', readFirst).status, 0, 'fifth review R5-4: calls that change nothing keep the word');
  for (const between of [call('Skill', { skill: 'tidy' }), call('Bash', { command: 'cd ../other && git stash list' })])
    assert.equal(runRm(dir, 'git stash drop stash@{0}', transcript(dir, [proposal, typed('then drop'), between])).status, 'ask', 'sixth review R6-2, R6-3');
  const seat = transcript(dir, [proposal, typed('then drop'), call('Agent', { prompt: 'tidy up' })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', seat).status, 'ask', 'fourth review N5: a seat after the word');
  for (const cmd of ['{ for i in 1 2; do git stash drop; done; }', 'time for i in 1 2; do git stash drop; done', '! for i in 1; do git stash drop; done',
    'for((i=0;i<2;i++)); do git stash drop; done', 'foreach i (1 2) git stash drop; end'])
    assert.equal(runRm(dir, cmd, listed).status, 'ask', `fourth review N7: ${cmd}`);
});

test('a typed revert of a file is no consent: the typed route is for one stash', () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconsole.log(1);\nconst user = 2;\n');
  const t = transcript(dir, [said('I added a debug line to `app.js`. Remove it?'), typed('remove it')]);
  assert.equal(runRm(dir, 'git checkout -- app.js', t).status, 'ask', 're-review N3');
});

test('a loop word in an echo reads as a loop: the false ask is the safe side', () => {
  const { dir } = repo();
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, 'const a = 1;\nconsole.log("P");\nconst b = 2;\n');
  const t = transcript(dir, [typed('fix it'), edit(file, 'const a = 1;', 'const a = 1;\nconsole.log("P");')]);
  assert.equal(runRm(dir, 'git checkout -- app.js && echo "reverted for good"', t).status, 'ask', 'fourth review N7 over third review M2');
  assert.equal(runRm(dir, 'git checkout -- app.js', t).status, 0, 'the same revert alone runs');
});

test("an own stash of a file the run created is the run's", () => {
  const { dir, git } = repo();
  const file = path.join(dir, 'probe.js');
  fs.writeFileSync(file, 'console.log("probe");\n');
  git('add', 'probe.js');
  git('stash', 'push', '-qm', 'probe');
  const t = transcript(dir, [typed('go'), call('Write', { file_path: file, content: 'console.log("probe");\n' }, { result: { type: 'create' } })]);
  assert.equal(runRm(dir, 'git stash drop stash@{0}', t).status, 0, 'third review R1');
});

test("an own Edit of a user line that repeats a base line is not the run's", () => {
  const { dir } = repo('function f() {\n  return null;\n}\n');
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, 'function f() {\n  return null;\n}\nfunction g() {\n  return 1;\n}\n');
  const t = transcript(dir, [typed('fix it'), edit(file, 'function g() {\n  return null;', 'function g() {\n  return 1;')]);
  assert.equal(runRm(dir, 'git checkout -- app.js', t).status, 'ask', 'third review H2');
});

test("an own Edit that rewrote the user's uncommitted line is not the run's line", () => {
  const { dir } = repo('const a = 1;\n');
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, 'const a = 1;\nconst userLine = 6;\n');
  const t = transcript(dir, [typed('fix it'), edit(file, 'const userLine = 5;', 'const userLine = 6;')]);
  assert.equal(runRm(dir, 'git checkout -- app.js', t).status, 'ask', 're-review N5');
});

test("a discard of the session's own lines runs unasked; a line it did not add still asks", () => {
  const { dir, git } = repo();
  const file = path.join(dir, 'app.js');
  const probe = edit(file, 'const a = 1;\nconst b = 2;', 'const a = 1;\nconsole.log("PROBE8", a);\nconst b = 2;');
  fs.writeFileSync(file, 'const a = 1;\nconsole.log("PROBE8", a);\nconst b = 2;\n');
  const own = transcript(dir, [typed('fix it'), probe]);
  assert.equal(runRm(dir, 'git checkout -- app.js', own).status, 0, 'only the probe line the run added is lost');
  assert.equal(runRm(dir, 'git checkout -- app.js', transcript(dir, [typed('fix it'), edit(file, 'const a = 1;\nconst b = 2;', 'const a = 1;\nconsole.log("PROBE8", a);\nconst b = 2;', { isError: true })])).status,
    'ask', 'review F6: a refused edit is no own line');

  git('stash', 'push', '-qm', 'probe');
  assert.equal(runRm(dir, 'git stash drop stash@{0}', own).status, 0, "a stash of the run's own lines is the run's to drop");
  fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  git('stash', 'push', '-qm', 'user');
  assert.equal(runRm(dir, 'git stash drop && git stash drop', own).status, 'ask', 'review F4: two drops in one command');
  git('stash', 'pop', '-q'); git('checkout', '-q', '--', 'app.js'); git('stash', 'pop', '-q');

  fs.writeFileSync(file, 'const a = 1;\nconsole.log("PROBE8", a);\nconst b = 2;\nconst userLine = 9;\n');
  assert.equal(runRm(dir, 'git checkout -- app.js', own).status, 'ask', 'a line the user wrote is in the loss');
  assert.equal(runRm(dir, 'git restore app.js', transcript(dir, [typed('fix it')])).status, 'ask', 'no own edit at all asks');

  fs.writeFileSync(file, 'const a = 1;\nconsole.log("PROBE8", a);\nconsole.log("PROBE8", a);\nconst b = 2;\n');
  assert.equal(runRm(dir, 'git checkout -- app.js', own).status, 'ask', 'review F6: a second copy of the line is not the run\'s');

  fs.writeFileSync(file, 'const a = 1;\nconsole.log("PROBE8", a);\nconst b = 2;\n');
  git('add', 'app.js');
  assert.equal(runRm(dir, 'git reset --hard', own).status, 'ask', 'review F10: a staged version is not judged');
});

test('a Write over a file is no own line; only a Write that created the file is', () => {
  const { dir } = repo('const a = 1;\n');
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, 'const a = 1;\nconst userLine = 2;\n');
  const over = transcript(dir, [typed('go'), call('Write', { file_path: file, content: 'const a = 1;\nconst userLine = 2;\n' }, { result: { type: 'update' } })]);
  assert.equal(runRm(dir, 'git checkout -- app.js', over).status, 'ask', 'review F5: the user line the Write kept');
});

test('the own route stops at 40 lines', () => {
  const { dir } = repo('top\n');
  const file = path.join(dir, 'app.js');
  const body = Array.from({ length: consent.OWN_LINES_MAX + 1 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(file, `top\n${body}\n`);
  const big = transcript(dir, [typed('build it'), edit(file, 'top', `top\n${body}`)]);
  assert.equal(runRm(dir, 'git checkout -- app.js', big).status, 'ask', 'review F12: a whole deliverable still asks');
});

test("a seat row and a sidechain edit are not the session's own", () => {
  const rows = edit('/x/a.js', '', 'probe').map((r) => ({ ...r, isSidechain: true }));
  assert.equal(consent.ownEditsOf(rows).size, 0);
});

test("S21: the stash ask says what 'drop' does - the entry is deleted and its changes are gone", () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 3;\n');
  git('stash', 'push', '-qm', 'user work');
  const ask = runRm(dir, 'git stash drop stash@{0}', null);
  assert.equal(ask.status, 'ask');
  assert.match(ask.text, /'drop' deletes the stash entry, and its changes are gone/);
});
