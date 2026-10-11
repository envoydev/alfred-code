'use strict';
// guard-stop-contract.js, the Stop branch's two halves widened from the audit 2026-10-10 C15 measured misses - each
// close below is the measured one (or its load-bearing clause, names replaced), with the stall or the false block it
// cost - and the ask branch's typed-turn count and stale-scope read.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-closes-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));

let seq = 0;
const logEnv = () => ({ ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) });
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `s${++seq}`, ...payload }), encoding: 'utf8', env: logEnv() });
const transcript = (rows) => {
  const p = path.join(TMP, `t${++seq}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
};
const say = (id, text) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage: { cache_read_input_tokens: 10 } } });
const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const call = (id, name, input) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, toolUseResult) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult });
const work = (n) => Array.from({ length: n }, (_, i) => [call(`w${seq}-${i}`, 'Read', { file_path: `f${i}.md` }), result(`w${seq}-${i}`, 'ok')]).flat();
const close = (text, extra) => run({ hook_event_name: 'Stop', last_assistant_message: text, ...(extra || {}) });
const over = (rows, text, extra) => close(text, { transcript_path: transcript([...rows, say(`c${seq}`, text)]), ...(extra || {}) });
const running = [{ id: 't1', type: 'subagent', status: 'running', description: 'build', agent_type: 'implementer' }];

test('C15: the offer shapes the audit measured unheld are stops', () => {
  for (const [text, why] of [
    ["The 81 changed files are ready for you to review on develop. Say 'commit' when you want them committed.", 'f450ea64: asked 64 minutes later whether anything was left'],
    ['If you want a real confirmation, I can re-check every screen against its frame after CI finishes.', 'f450ea64: the conditional offer'],
    ['That would save a few KB per lazy page at most; I can do it if you want.', '9a4ef375: the offer, then 34 minutes of silence'],
    ['I can run that manual check now if you want; it starts the local backend and stops it afterwards.', '458953b8'],
    ['Full list in the ledger. I can start the M2 plan for the minor gaps whenever you want.', '7491ab75'],
    ["I can draft a plan for #9 and #10 next, or go through the 'DIFFERENT' rows and pick the ones worth matching.", '6ed392a5 L1578'],
    ['My recommendation is to skip a full triage and do one quick pass over the behaviour rows. Otherwise this parity scope can stop here.', "6ed392a5 L1585: the user typed 'Do recommendation' 2 minutes later"],
  ]) assert.strictEqual(close(text).status, 2, why);
});

test('C15: the done half reads a push, the pending half reads a check never run and an open item', () => {
  assert.strictEqual(close("I pushed the change to origin/develop.\n\n- Not run: the card's manual check against the local backend.").status, 2, '458953b8 L220');
  assert.strictEqual(close("I added the audit line to each plan; it is marked 'probably done on the server'. The only open item is the rate-limit check, which never ran, and closing port 8080 is still put off. Your invite diff is still held for review.").status, 2, '390aebcb L776: the user asked 5.5 minutes later whether it had started');
  const r = close('Pushed to develop. The only open item is the device check.');
  assert.strictEqual(r.status, 2);
  // the neighbours stay clean
  assert.strictEqual(close('Nothing was pushed. The tree is clean and the suite is green.').status, 0, "'not / nothing pushed' is no push report");
  assert.strictEqual(close("The live-run probe was not run (your call, environment-sensitive). Everything else is committed.").status, 0, "a retrospective 'was not run' records a decision");
  assert.strictEqual(close('Done - all seven cards are built and pushed. No open items.').status, 0, "'no open items'");
});

test("C15: 'nothing pending on my side' is no exit while the close names the user's own run, and the escape says so", () => {
  const r = close("Both cards are done. Nothing is pending on my side - the two open items wait on the customer's ids and on your device run.");
  assert.strictEqual(r.status, 2, 'ecea6d56: the user came back 25 minutes later to ask why the device check was theirs');
  assert.match(r.stderr, /A deferred item either side still owes/);
  assert.strictEqual(close('Done - the reload ran and the capture is current. Nothing is pending on this run - these are yours to run when you choose.').status, 0, 'the pinned suggestion-card line still closes cleanly');
});

test('C15: a prose ask whose close also names pending work gets no restate escape', () => {
  const pending = close('Full list in the ledger; still open: the M2 gaps. I can start the M2 plan whenever you want.');
  assert.strictEqual(pending.status, 2);
  assert.match(pending.stderr, /This close also names pending work \('still open'\)/, '7491ab75: the restated offer passed as a statement');
  assert.doesNotMatch(pending.stderr, /restate the close WITHOUT question/);
  const plain = close('Both work - your call which one ships.');
  assert.match(plain.stderr, /restate the close WITHOUT question/, 'a close with nothing pending keeps the escape');
});

test('C15: under live work the mandated hold line, a gated step, a resumed seat and a CI watch are status', () => {
  // 0498718d: three implementer seats running
  const building = 'Boards, team and clients (tasks 19-21) are done. Three agents are still building: orders, profile and the chat list. Only tasks 4-5 remain to start, once the orders agent is done with the translation files.';
  assert.strictEqual(over([typed('go')], building, { background_tasks: running }).status, 0, 'a step gated on the running work');
  assert.strictEqual(over([typed('go')], building, { background_tasks: [] }).status, 2, 'with nothing running it is a stall');
  assert.strictEqual(over([typed('go')], 'Task 4 is done. The review agent is queued; next step is task 5.', { background_tasks: running }).status, 2,
    'review B2: an ungated next step stays a stall under live work');
  // 6ed392a5: the mandated hold line, 3s after an async verifier launched
  const gate = 'The full gate passed with the fixes in, and the same reviewer is now checking just those fixes. I will finish the run once it reports. Nothing is committed; the diff stays uncommitted for your review.';
  assert.strictEqual(over([typed('go')], gate, { background_tasks: running }).status, 0, 'the hold line is the state of the tree, not the next act');
  assert.strictEqual(over([typed('go')], gate, { background_tasks: [] }).status, 2, 'with nothing running the hold still asks about the commit');
  // 05c925e9: a SendMessage resumed the verifier, the close waits on its sign-off
  const signoff = "The six review fixes are built and green. I've sent the fix delta to the same verifier seat and I'm waiting for its sign-off. Nothing is pending from you right now.";
  assert.strictEqual(over([typed('go')], signoff, { background_tasks: running }).status, 0, "the running seat's own sign-off is a wait");
  assert.strictEqual(over([typed('go')], 'Build is done; the verifier is reviewing the diff and I am waiting on its report. The copy there waits on your allow at the close ask.',
    { background_tasks: running }).status, 2, "05c925e9: 'your allow' is a decision the live work cannot excuse");
  // bba03dad: an armed CI watch ends with its run
  const ci = "I'm waiting for develop CI run 375 on the branch head. Once it goes green I fast-forward staging; a background watch tells me when the run finishes.";
  assert.strictEqual(over([typed('go')], ci, { background_tasks: [{ id: 'b2', type: 'shell', status: 'running', command: 'gh run watch 375 --exit-status' }] }).status, 0, 'gh run watch');
  assert.strictEqual(over([typed('go')], ci, { background_tasks: [{ id: 'b3', type: 'shell', status: 'running', command: 'gh pr checks 12 --watch' }] }).status, 0, 'gh pr checks --watch');
});

test("C15: an answer to the user's own question listing others' or deferred items passes; the fresh-ask close passes", () => {
  const answer = "No, the backend needs nothing new; every earlier card is done or deliberately deferred.\n\n- **Still open but deferred:** item 7, pointing the store consoles at the new webhook paths. You said that comes later.\n- **Waiting on the customer:** the client ids for staging sign-in.";
  assert.strictEqual(over([typed('Is there something we need to pass for backend?')], answer).status, 0, 'f450ea64: a ~136k restate of the same facts');
  assert.strictEqual(over([typed('wrap up the backend side')], answer).status, 2, 'not an answer to a question: the stall shape holds');
  assert.strictEqual(over([typed('Anything left?')], 'Done. Waiting on the customer for the ids, and the next step is task 5.').status, 2, "the model's own step still blocks");
  // 69dbed46: the user picked the fresh session; the mandated close read 'committed' + 'next steps'
  const fresh = [typed('continue'), call('ask1', 'AskUserQuestion', { questions: [{ question: 'Resume?', options: [{ label: 'Resume in a fresh session (Recommended)' }, { label: 'Continue here' }] }] }),
    result('ask1', 'Your questions have been answered: "Resume?"="Resume in a fresh session (Recommended)"'), ...work(4)];
  const resume = 'Result: state is saved for a fresh session. Nothing is committed or pushed.\n\nNext steps: T1 src work, then T2 to T7.';
  assert.strictEqual(over(fresh, resume).status, 0, 'the close the fresh-session answer asked for');
  assert.strictEqual(over([typed('continue'), ...work(4)], resume).status, 2, 'the same close with no such answer is the stall');
  const offeredOnly = [typed('continue'), call('ask2', 'AskUserQuestion', { questions: [{ question: 'Next?', options: [{ label: 'Commit now (Recommended)' }, { label: 'Resume in a fresh session' }] }] }),
    result('ask2', 'Your questions have been answered: "Next?"="Commit now (Recommended)"'), ...work(4)];
  assert.strictEqual(over(offeredOnly, resume).status, 2, 'an ask that only offered the fresh session, answered another way, is no pick');
});

test('C15: the corpus replay neighbours stay clean', () => {
  assert.strictEqual(close('Nothing is waiting on you. The fix is pushed and CI has confirmed the upload works.').status, 0, "572a163d: 'Nothing is waiting on you'");
  assert.strictEqual(close("Nothing is pending: all three commits are on develop, nothing is pushed, and there's no open next step.").status, 0, '7b524da0');
  assert.strictEqual(close('No - no merge happened. The run is on develop, triggered by the empty commit I pushed there; I never ran or merged anything to staging.').status, 0, "6cbf9398: 'I never ran' denies an act");
  assert.strictEqual(close('Pushed the cards. The backend card reads:\n\n````markdown\n**Still open:** the device check.\n```ts\nx\n```\n````\n\nThe full cards stay in the tasks folder.').status, 0, 'fbfc2de4: a four-backtick fence is payload');
  assert.strictEqual(over([typed('Is anything left for the app?')], 'No - the categories change is done and on develop. The only card still open is blocked on the client.').status, 0,
    'ca65b406: an answer naming a card blocked on a third party');
});

test("C15: the done-close row names the hand-back, never 'undefined'", () => {
  const root = process.env.CLAUDE_PROJECT_DIR;
  const sid = 'ledger-c15';
  spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: sid, hook_event_name: 'Stop',
    last_assistant_message: 'The catch-up is committed on develop. Still uncommitted: the 10-file push-routing diff, held for your review.' }), encoding: 'utf8', env: logEnv() });
  const rows = fs.readFileSync(path.join(root, '.alfred', 'docs', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const row = rows.find((r) => /done-close/.test(JSON.stringify(r)));
  assert.ok(row, 'a done-close row');
  assert.doesNotMatch(JSON.stringify(row), /undefined/, '0824440b: committed + undefined');
});

test('C15: a close not yet on disk at the first read is judged on the retry', async () => {
  const tp = transcript([typed('push it?'), call('x1', 'Bash', { command: 'git commit -m x' })]);
  const child = spawn(process.execPath, [HOOK], { env: logEnv() });
  child.stdin.end(JSON.stringify({ session_id: 'late', hook_event_name: 'Stop', transcript_path: tp }));
  setTimeout(() => fs.appendFileSync(tp, JSON.stringify(result('x1', 'ok')) + '\n' + JSON.stringify(say('late', 'Committed. Say the word when you want it pushed.')) + '\n'), 120);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.strictEqual(code, 2, "fbfc2de4: 'Say the word when you want it pushed.' was flushed 97ms before the summary and passed unjudged");
});

test('C15: the ask branch counts typed turns on the live branch, and push as git state only in a git shape', () => {
  const q = [{ question: 'Run it?', options: [{ label: 'Run (Recommended)', description: 'x' }, { label: 'Hold', description: 'y' }] }];
  const ask = (rows, questions) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `a${++seq}`, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
      transcript_path: transcript(rows), tool_input: { questions } }), encoding: 'utf8', env: logEnv() });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext || '' : '';
  };
  // ca65b406: the client double-submitted a slash command as two siblings of one parent
  const p = { type: 'assistant', uuid: 'p', parentUuid: null, message: { id: 'p', content: [{ type: 'text', text: 'done' }] } };
  const dead = { type: 'user', uuid: 'd', parentUuid: 'p', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } };
  const live = { type: 'user', uuid: 'l', parentUuid: 'p', message: { role: 'user', content: '<command-name>/task-solve</command-name> the manager view' } };
  const att = { type: 'attachment', uuid: 'at', parentUuid: 'l', attachment: { type: 'command_permissions' } };
  const reply = { type: 'assistant', uuid: 'r', parentUuid: 'at', message: { id: 'r', content: [{ type: 'text', text: 'on it' }] } };
  assert.doesNotMatch(ask([p, dead, live, att, reply], q), /more than one message/, 'the abandoned sibling is no second message');
  const second = { type: 'user', uuid: 'l2', parentUuid: 'l', message: { role: 'user', content: 'and the admin view too' } };
  const reply2 = { type: 'assistant', uuid: 'r2', parentUuid: 'l2', message: { id: 'r2', content: [{ type: 'text', text: 'on it' }] } };
  assert.match(ask([p, live, second, reply2], q), /more than one message/, 'two typed turns on one chain still count');
  assert.match(ask([typed('a'), typed('b'), say('r3', 'ok')], q), /more than one message/, 'a transcript with no uuids is read in order');
  // ecea6d56: a push NOTIFICATION check is not git state
  const pushCheck = [{ question: 'Run the push check on the Android emulator against staging?', options: [{ label: 'Run it (Recommended)', description: 'x' }, { label: 'Defer', description: 'y' }] }];
  assert.doesNotMatch(ask([typed('go'), say('s1', 'ok')], pushCheck), /named repository, remote or job state/);
  const gitPush = [{ question: 'Push to origin/develop?', options: [{ label: 'Push now (Recommended)', description: 'x' }, { label: 'Hold', description: 'y' }] }];
  assert.match(ask([typed('go'), say('s2', 'ok')], gitPush), /named repository, remote or job state/);
});

// Audit 2026-10-10 C18, 0824440b: the commit / publish ask carried three different recommended options across three
// homes - the denial among them ('so it is never the recommended next move') - and the user overrode the mark 3 of 3.
test('C18: the done-close denial sends a commit or publish choice to the checkpoint\'s own ask and mark', () => {
  const r = close('Pushed the cards to develop. The only open item is the device check.');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /habits-commit-checkpoint's own ask, marked as its template marks it/);
  assert.doesNotMatch(r.stderr, /never the recommended/, 'the denial sets no mark of its own');
});
