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
  const resume = 'Result: state is saved for a fresh session. Nothing is committed or pushed.\n\n1. Type `/clear`.\n2. Paste:\n\n```text\n/task-solve plans/x.md - resume at step 4\n```\n\nNext steps: T1 src work, then T2 to T7.';
  assert.strictEqual(over(fresh, resume).status, 0, 'the close the fresh-session answer asked for');
  assert.strictEqual(over([typed('continue'), ...work(4)], resume).status, 2, 'the same close with no such answer is the stall');
  const offeredOnly = [typed('continue'), call('ask2', 'AskUserQuestion', { questions: [{ question: 'Next?', options: [{ label: 'Commit now (Recommended)' }, { label: 'Resume in a fresh session' }] }] }),
    result('ask2', 'Your questions have been answered: "Next?"="Commit now (Recommended)"'), ...work(4)];
  assert.strictEqual(over(offeredOnly, resume).status, 2, 'an ask that only offered the fresh session, answered another way, is no pick');
});

test('resume block (the user\'s ruling, 2026-10-15): a fresh-session pick closes with the paste text in a fenced block, held once without it', () => {
  const picked = (label, id) => [typed('continue'), call(id, 'AskUserQuestion', { questions: [{ question: 'Resume?', options: [{ label }, { label: 'Continue here' }] }] }),
    result(id, `Your questions have been answered: "Resume?"="${label}"`), ...work(2)];
  const pointer = 'Result: the plan file now holds the punch list.\nProgress: 4 of 6 steps\nLeftovers: punch list P1-P9 for the fresh session.\n\nStopping here: type /clear, then paste the resume block above.';
  const held = over(picked('Resume in a fresh session (Recommended)', 'r1'), pointer);
  assert.strictEqual(held.status, 2, 'the measured close: a pointer at a block nobody can see');
  assert.match(held.stderr, /RESUME BLOCK/);
  assert.match(held.stderr, /ALONE in its own fenced block - the flow's command naming its plan or state file and nothing more/);
  const block = 'Result: the plan file now holds the punch list.\n\n**Resume in a fresh session**\n1. In the project root, type `/clear`.\n2. Paste this line and send it:\n\n```text\n/task-solve plans/audit.md\n```\n\nNext: step 5 CONFORMANCE - fix P1-P9, re-review -> close.';
  assert.strictEqual(over(picked('Resume in a fresh session (Recommended)', 'r2'), block).status, 0, 'the block passes');
  assert.strictEqual(over(picked('Start it in a fresh session (Recommended)', 'r3'), 'Leaving this chat here.').status, 2, 'a new cycle\'s hand-off owes it too');
  assert.strictEqual(over(picked('Resume in a fresh session (Recommended)', 'r4'), 'Paste:\n\n```\n```').status, 2, 'an empty fence is no paste text');
  // a setting that names a fresh session is no hand-off (the setup walk's trigger answer), nor an ask answered another way
  assert.strictEqual(over(picked('Offer a fresh session (Recommended)', 'r5'), 'Setup is complete. Nothing is pending.').status, 0, 'a setting, not a pick');
  assert.strictEqual(over([typed('go'), ...work(2)], 'Result: done, nothing pending.').status, 0, 'no ask, no block');
});

test('resume block (the 2026-10-17 usage audit): a pointer at a block above is held with none shown, and an ask\'s pointer is reworded', () => {
  // the Stop half: no pick this turn, the close still points at a resume block nobody printed
  const pointer = 'Context compacted; the plan file holds every tick. Type /clear, then paste the resume block above.';
  const held = over([typed('continue'), ...work(2)], pointer);
  assert.strictEqual(held.status, 2, 'a pointer with no fence anywhere since the typed turn');
  assert.match(held.stderr, /points at a resume block above, and none is on screen/);
  const earlier = [typed('continue'), say('e1', 'Resume later with:\n\n```text\n/task-solve plans/x.md\n```'), ...work(2)];
  assert.strictEqual(over(earlier, 'Stopping here - paste the resume block above after /clear.').status, 0, 'a block this turn already printed is above');
  assert.strictEqual(over([typed('go'), ...work(2)], 'Fixed the paste handler; the command above now trims input. Nothing pending.').status, 0, 'a code pointer is no resume pointer');
  // the ask half: task-solve's compaction ask promised 'the paste-ready block above' with no block on screen
  const askRun = (rows, label, description) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `ask${++seq}`, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
    transcript_path: transcript(rows), tool_input: { questions: [{ question: 'Context compacted during task 3. Fresh: ~40k, here: ~45k.', header: 'Resume',
      options: [{ label, description }, { label: 'Continue the build here', description: 'on the compacted summary' }] }] } }), encoding: 'utf8', env: logEnv() });
  const upd = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput || null; } catch { return null; } };
  const at45k = (id, text) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage: { cache_read_input_tokens: 45000 } } });
  const plain = [typed('continue'), at45k('p1', 'Build goes on.')];
  const fixedAsk = askRun(plain, 'Resume in a fresh session (Recommended)', 'the paste-ready block above; this chat stops here');
  assert.strictEqual(fixedAsk.status, 0, fixedAsk.stderr);
  assert.strictEqual(upd(fixedAsk).questions[0].options[0].description, 'the resume block, printed after this answer; this chat stops here', 'reworded in place');
  assert.strictEqual(upd(fixedAsk).questions[0].options[1].description, 'on the compacted summary', 'the other option untouched');
  assert.match(JSON.parse(fixedAsk.stdout).hookSpecificOutput.additionalContext, /ends with the resume block in its own fenced block/);
  const shown = [typed('continue'), at45k('p2', 'Resume block:\n\n```text\n/task-solve plans/x.md\n```')];
  assert.strictEqual(upd(askRun(shown, 'Resume in a fresh session (Recommended)', 'the paste-ready block above; this chat stops here')), null, 'a block on screen is above');
  assert.strictEqual(upd(askRun(plain, 'Resume in a fresh session (Recommended)', 'the resume block ends this turn; this chat stops here')), null, 'the template wording passes untouched');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'task-solve', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /block above/, 'task-solve\'s own asks point at no block above');
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
  const rows = fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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
  // hooks review 2026-10-16: 42 notes in two weeks, none over two typed messages - harness rows, interrupts and built-in
  // local commands (their output row follows them) are no message
  const stdout = (t) => typed(`<local-command-stdout>${t}</local-command-stdout>`);
  for (const [rows, why] of [
    [[typed('[Request interrupted by user]'), typed('fix the header too')], 'an interrupt and one message'],
    [[typed('<command-name>/exit</command-name>'), stdout('Goodbye!'), typed('carry on with task 4')], '/exit and its output, then one message'],
    [[typed('<command-name>/reload-plugins</command-name>'), { type: 'system', subtype: 'local_command', content: '<local-command-stdout>Reloaded: 7 plugins</local-command-stdout>' },
      typed('<command-name>/alfred-code:update</command-name>')], '/reload-plugins (a system output row), then a command'],
    [[typed('<task-notification><task-id>a1</task-id></task-notification>'), typed('<task-notification><task-id>a2</task-id></task-notification>')], 'two task notices'],
  ]) assert.doesNotMatch(ask([...rows, say(`h${seq}`, 'ok')], q), /more than one message/, why);
  assert.match(ask([typed('<command-name>/task-solve</command-name> the view'), typed('and the admin view'), say('h9', 'ok')], q), /more than one message/,
    'a command with no output row of its own is a typed message');
  // ecea6d56: a push NOTIFICATION check is not git state
  const pushCheck = [{ question: 'Run the push check on the Android emulator against staging?', options: [{ label: 'Run it (Recommended)', description: 'x' }, { label: 'Defer', description: 'y' }] }];
  assert.doesNotMatch(ask([typed('go'), say('s1', 'ok')], pushCheck), /This ask named (?:remote or job|git) state/);
  const gitPush = [{ question: 'Push to origin/develop?', options: [{ label: 'Push now (Recommended)', description: 'x' }, { label: 'Hold', description: 'y' }] }];
  assert.match(ask([typed('go'), say('s2', 'ok')], gitPush), /This ask named (?:remote or job|git) state/);
});

// Audit 2026-10-10 C18, 0824440b: the commit / publish ask carried three different recommended options across three
// homes - the denial among them ('so it is never the recommended next move') - and the user overrode the mark 3 of 3.
test('C18: the done-close denial sends a commit or publish choice to the checkpoint\'s own ask and mark', () => {
  const r = close('Pushed the cards to develop. The only open item is the device check.');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /habits-commit-checkpoint's own ask, marked as its template marks it/);
  assert.doesNotMatch(r.stderr, /never the recommended/, 'the denial sets no mark of its own');
});

// Audit 2026-10-11 SD10 - the pinned 'Deferred by you:' contract (validate's close, T3): an item the user deferred through
// an ask answered this turn sits on a line opening 'Deferred by you:' and is nothing owed (sessions 6288ad94 / 757a4ac0:
// 'Acknowledge and defer' answered, the close listed the rotation as owed, the block forced a 142k restate).
const asked = (id, answer) => [call(id, 'AskUserQuestion', { questions: [{ question: 'How do you want to handle the exposure?', options: [] }] }),
  result(id, `Your questions have been answered: "How do you want to handle the exposure?"="${answer}". You can now continue with these answers in mind.`)];
test('SD10: a Deferred by you line is nothing owed only after an ask answered this turn deferred it', () => {
  const done = 'The validate run is finished and the AGENTS.md fix is applied.\n\n';
  const line = 'Deferred by you: the credential cleanup - delete the two keys from the project settings when you choose.';
  const turn = (answer) => [typed('/validate'), ...asked(`d${seq}`, answer), ...work(4)];
  assert.strictEqual(over(turn('Acknowledge and defer (Recommended)'), done + line).status, 0, 'the contract: the deferred item is on its line');
  assert.strictEqual(over(turn('Acknowledge and defer (Recommended)'), done + `- **${line.replace(':', ':**')}`).status, 0, 'a bulleted, bold spelling too');
  assert.strictEqual(over(turn('Later'), done + line).status, 0, "'Later' defers");
  const owed = over(turn('Acknowledge and defer (Recommended)'), done + 'Still owed from you: the credential cleanup, which you deferred.');
  assert.strictEqual(owed.status, 2, 'the same item stated as owed is still a stall');
  assert.match(owed.stderr, /opening 'Deferred by you:'/, 'and the denial names the route');
  assert.strictEqual(over(turn('Rotate now (Recommended)'), done + line).status, 2, 'an answer that deferred nothing opens no line');
  assert.strictEqual(over([...asked(`e${seq}`, 'Acknowledge and defer'), typed('and the rest?'), ...work(4)], done + line).status, 2, 'a deferral answered in an earlier turn is not this one');
  assert.strictEqual(over(turn('Acknowledge and defer (Recommended)'), done + line + '\nNext step: push when you approve.').status, 2, 'a hand-back on another line still blocks');
  assert.strictEqual(over([typed('go'), ...work(4)], done + line).status, 2, 'no ask at all: the line is judged as written');
});

// d9035363: an ask answered one call back settled ITS question, not the new action the close hands the user.
test("SD10: an answer just given does not exempt a close handing the user a new run-and-report action", () => {
  const turn = () => [typed('go'), ...asked(`p${seq}`, 'I will pull first'), ...work(1)];
  const close1 = "The answer was 'I will pull first', and the clone is still at abc1234 (1.2.0). Run the pull, then tell me when it's done.\n\n- Once the head moves, I'll start both analyzer seats.";
  assert.strictEqual(over(turn(), close1).status, 2, 'the measured close: the 2.1.8 guard blocked it and the ask took one click');
  assert.strictEqual(over(turn(), 'Committed. Tell me when you want it pushed.').status, 0, 'a wait on the decision just made stays exempt');
  assert.strictEqual(over(turn(), "Done - the answer is recorded and nothing else is owed.").status, 0, 'a plain acknowledgement stays exempt');
});

// 2ca8e8ee: 'Show me the merge order as sentences' - a read-only survey and a list opening on a user-owned state.
test('SD10: an answer to a request for information from a read-only turn is no done-close stall', () => {
  const answer = 'Tickets 1 and 2 are already merged, and ticket 3 is committed on `tasks/t3` waiting for its PR.\n\n1. Merge the ticket 3 PR.\n2. Apply ticket 4 on a new branch, commit it and merge it.';
  const survey = (prompt, extra) => { const id = `g${seq}`; return [typed(prompt), call(id, 'Bash', { command: 'git branch --show-current; git log --oneline -4 | cat; git stash list 2>/dev/null' }), result(id, 'tasks/t3'), ...(extra || [])]; };
  assert.strictEqual(over(survey('Show me order of stashed to merge as sentences not table'), answer).status, 0, 'the measured answer');
  assert.strictEqual(over(survey('what is left to merge?'), answer).status, 0, 'a question prompt too');
  assert.strictEqual(over(survey('merge them in order'), answer).status, 2, 'an instruction is no request for information');
  const id = `x${seq}`;
  assert.strictEqual(over(survey('Show me the order', [call(id, 'Edit', { file_path: 'a.cs', old_string: 'a', new_string: 'b' }), result(id, 'ok')]), answer).status, 2, 'a turn that edited a file');
  // a substitution is judged as the command it runs (audit 2026-10-20 C03): `git log $(cat ref)` reads, this one changes
  for (const command of ['git stash pop', 'git commit -qm wip', 'git branch t4', 'git status > state.txt', 'git log $(git stash pop)', 'npm install', 'sed -i s/a/b/ f.txt', 'find . -name x -delete']) {
    const k = `y${seq}`;
    assert.strictEqual(over(survey('Show me the order', [call(k, 'Bash', { command }), result(k, 'ok')]), answer).status, 2, `a changing call: ${command}`);
  }
  assert.strictEqual(over(survey('Show me the order'), answer + "\n\nI'll start on ticket 4 next.").status, 2, 'the model\'s own next move');
  assert.strictEqual(over(survey('Show me the order'), answer + '\n\nPush when you approve.').status, 2, 'an approval hand-back');
  assert.strictEqual(over(survey('what is left?'), 'Ticket 3 is committed. The next step is the ticket 4 branch.').status, 2, 'a pending step, not a reported state');
});

// 2ca8e8ee: 'wait until the earlier ticket is merged' rested on a day-old read and one `git status --short`.
test('SD10: a merge, PR or remote ask is backed only by a remote-aware read', () => {
  const ask = (rows, question) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `a${++seq}`, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
      transcript_path: transcript(rows), tool_input: { questions: [{ question, options: [{ label: 'Wait (Recommended)', description: 'x' }, { label: 'Go now', description: 'y' }] }] } }), encoding: 'utf8', env: logEnv() });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext || '' : '';
  };
  const ran = (command) => { const id = `r${seq}`; return [typed('go'), call(id, 'Bash', { command }), result(id, 'ok')]; };
  const merged = 'The check needs the new services. Recommended: wait until ticket 3 is merged and install that build.';
  assert.match(ask(ran('git status --short'), merged), /no remote-aware read in this turn/, 'the measured ask: git status cannot see a merge');
  for (const command of ['git fetch -q && git log origin/develop --oneline -5', 'git branch -r --merged origin/develop', 'gh pr view 42'])
    assert.doesNotMatch(ask(ran(command), merged), /This ask named (?:remote or job|git) state/, `a remote-aware read: ${command}`);
  assert.doesNotMatch(ask(ran('git status --short'), 'Commit the staged files now?'), /This ask named/, 'a local ask keeps the local read');
  assert.match(ask(ran('ls'), 'Commit the staged files now?'), /no `git status`/, '... and its own note without one');
});

// The forge is any forge: a watch and a remote read are concepts (forge.js), so GitLab's CLI, an MCP server or a CLI
// nobody listed back them the way `gh` does.
test('a pipeline watch and a forge read count on every transport', () => {
  const ci = "I'm waiting for the pipeline on the branch head. Once it goes green I merge; a background watch tells me when it finishes.";
  for (const command of ['glab ci status --live', 'glab pipeline status --wait'])
    assert.strictEqual(over([typed('go')], ci, { background_tasks: [{ id: 'b9', type: 'shell', status: 'running', command }] }).status, 0, command);
  const ask = (rows, question) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `a${++seq}`, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
      transcript_path: transcript(rows), tool_input: { questions: [{ question, options: [{ label: 'Wait (Recommended)', description: 'x' }, { label: 'Go now', description: 'y' }] }] } }), encoding: 'utf8', env: logEnv() });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext || '' : '';
  };
  const used = (name, input) => { const id = `r${seq}`; return [typed('go'), call(id, name, input), result(id, 'ok')]; };
  const merged = 'The check needs the new services. Recommended: wait until ticket 3 is merged and install that build.';
  for (const [name, input] of [['Bash', { command: 'glab mr view 4' }], ['Bash', { command: 'tea pr 5' }], ['mcp__gitlab__get_merge_request', { merge_request_iid: 4 }], ['mcp__github__pull_request_read', { method: 'get_status' }]])
    assert.doesNotMatch(ask(used(name, input), merged), /This ask named (?:remote or job|git) state/, `a remote-aware read: ${name} ${JSON.stringify(input)}`);
  const note = ask(used('Bash', { command: 'npm run build' }), merged);
  assert.match(note, /no remote-aware read in this turn/, 'a build reads no remote');
  assert.match(note, /change request or pipeline/, 'the note names the concept, not one CLI');
  assert.doesNotMatch(note, /`gh /, 'no gh command is the advice');
});

// 31da645f: after its own prose-ask block the continuation ran an ask, a Skill, an Edit and a check, then closed on a new
// prose question that no hook judged. A tool call after the block reopens the cycle; a bare rewrite stays held.
test('SD10: a continuation that made a tool call after this hook\'s block is judged again', () => {
  const env = logEnv();
  const session = `w${++seq}`;
  const tp = transcript([typed('go'), say('c1', 'The audit has 4 rows. Do you want me to draft fixes for them?')]);
  const stop = (text, active) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: session, hook_event_name: 'Stop', stop_hook_active: active,
    transcript_path: tp, last_assistant_message: text }), encoding: 'utf8', env });
  const now = (row) => fs.appendFileSync(tp, JSON.stringify({ ...row, timestamp: new Date().toISOString() }) + '\n');
  const ask1 = 'The audit has 4 rows. Do you want me to draft fixes for them?';
  const ask2 = 'Fixed row 1. Do you want me to draft fixes for the other 3 rows?';
  assert.strictEqual(stop(ask1, false).status, 2, 'the first prose ask blocks');
  assert.strictEqual(stop(ask1, true).status, 0, 'a rewrite with no call between stays held - never a loop');
  now(call('e1', 'Edit', { file_path: 'a.md', old_string: 'a', new_string: 'b' }));
  now(result('e1', 'ok'));
  assert.strictEqual(stop(ask2, true).status, 2, 'the measured miss: new work, a new prose question, judged');
  assert.strictEqual(stop(ask2, true).status, 0, 'and it holds once more, until the next call');
});

// Hooks review 2026-10-16: 20 done-close blocks read against their transcripts - 3 right, 15 wrong. The two causes behind 9
// of the wrong ones: a NEGATED done word read as a done report, and a read-only answer to a question vetoed by any
// hand-back phrase although it named nothing pending. Each close below is a measured one's load-bearing clause, reworded.
test('hooks review: a negated done word reports nothing done, and a negated unpushed / uncommitted is no pending item', () => {
  for (const [text, why] of [
    ['The method parses the header first. Nothing is committed. Nobody has run it in the real app. You can check by opening the settings page.', 'row 14: an explanation'],
    ["Nothing is committed or pushed. I'll report the full-suite result when it finishes, and then you can decide on committing.", "row 15: 'committed or pushed' after the negation"],
    ['You do not need to be present for each round: nothing gets pushed until the last one. Your auto instruction covers the rest.', "row 12: 'gets'"],
    ["Added it as a task in the open-items file. That file isn't committed. The order that matters: confirm a deploy works first.", "row 10: 'isn't committed'"],
    ['Nothing is left to implement, and nothing is unpushed or uncommitted. Develop CI is green.', 'row 3: the pending side'],
    ['Зміни у файлі, ще не закомічено. Скажи, якщо треба запушити.', 'a close in another language is not judged (English only, 2026-10-16)'],
    ['Закомітив. Ще не запушено - чекаю на твоє рішення.', '... a done word beside a pending one included'],
  ]) assert.strictEqual(close(text).status, 0, why);
  for (const [text, why] of [
    ['Committed on develop, 1 ahead of origin, not pushed. Next: /clear, then paste the block.', 'row 2: right, and stays'],
    ['I pushed the fix. The optional tidy-up is still waiting for your yes or no.', 'row 8: right, and stays'],
    ['Nothing broke and everything is committed. Push when you approve.', 'a negation that is not about the done word'],
    ['Tests are not failing anymore, all green. Waiting for your review.', 'a negated failure is still a green report'],
  ]) assert.strictEqual(close(text).status, 2, why);
});

test('hooks review: a read-only answer to a question that names nothing pending is no done-close stall, whatever hand-back phrase it carries', () => {
  const asked = (prompt, extra) => [typed(prompt), ...(extra || [])];
  const fetched = (prompt) => { const id = `f${seq}`; return asked(prompt, [call(id, 'WebFetch', { url: 'https://example.com/docs', prompt: 'x' }), result(id, 'ok')]); };
  for (const [rows, text, why] of [
    [asked('I enabled it, what is next?'), "Reconnect the connector: open its settings and sign in again. Tell me when that's done and I'll read the ticket.", 'row 4'],
    [asked('can we consider the task as finished?'), 'Yes - finished and verified.\n\nOpen:\n- The diff is uncommitted, because I commit only on your explicit word.', 'row 5: the mandated hold line'],
    [fetched('can the token reach the private repos?'), 'Yes. The token is tied to your own login, so anything done through it is done as you.', 'row 13: a WebFetch turn'],
    [asked('how do I add the key to GitHub?'), "Add it in the repository settings, or run the gh command below. Either way, tell me when it's done. I'll confirm the next run picks it up.", 'row 16'],
    [asked('you want me to start the invoker?'), "Yes - it needs to come from you. Run the start command in a terminal.\n\nReady when the terminal shows 'listening'. Then: /clear and paste the block.", 'row 18'],
  ]) assert.strictEqual(over(rows, text).status, 0, why);
  const edited = () => { const id = `e${seq}`; return [call(id, 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }), result(id, 'ok')]; };
  const row4 = "Reconnect the connector: open its settings and sign in again. Tell me when that's done and I'll read the ticket.";
  assert.strictEqual(over(asked('I enabled it, what is next?', edited()), row4).status, 0, 'a typed question is answered even after an edit (the ruling of 2026-10-20, C03)');
  assert.strictEqual(over(asked('I enabled it, show me what is next', edited()), row4).status, 2, 'a show-request whose turn changed a file is judged');
  assert.strictEqual(over(asked('reconnect it for me'), row4).status, 2, 'an instruction is no question');
  assert.strictEqual(over(asked('what is left?'), 'Committed. The push is pending your approval.').status, 2, 'a pending item keeps the hand-back veto');
  for (const text of ['All done and committed. Up to you if we push today.', 'Committed on develop. Your call on the push.'])
    assert.strictEqual(over(asked('what is the status?'), text).status, 2, `a decision handed over in prose still blocks: ${text}`);
});

// The two single-row causes the sample left (hooks review 2026-10-16, rows 11 and 19): a wait on the running seats' FIXES
// and CHECKS read as a stall, and the list of decisions an auto-mode run took read as a commit handed to the user.
test("hooks review: a wait on running seats' fixes and checks is status; a record of decisions taken is no hand-off", () => {
  const fixes = 'The admin and chat fixes landed. Lint and typecheck pass. Still waiting on the `libs/ui` fixes and the cheat check; the final full gate runs after both report.';
  assert.strictEqual(over([typed('go')], fixes, { background_tasks: running }).status, 0, 'row 11: the seats are still running');
  assert.strictEqual(over([typed('go')], fixes, { background_tasks: [] }).status, 2, 'with nothing running it is a stall');
  assert.strictEqual(over([typed('go')], 'Тести пройшли, готово. Ще чекаю на виправлення від агента.', { background_tasks: running }).status, 0, 'a wait in another language is not judged');
  assert.strictEqual(over([typed('go')], 'The fixes landed. Still waiting for your check of the login page.', { background_tasks: running }).status, 2,
    "'your check' is the user's, whatever runs");
  const record = (heading, items) => `I finished the conformance check and committed the fixes. All checks passed.\n\n${heading}\n${items}`;
  for (const [text, why] of [
    [record('Decisions auto-mode made for you:', '- Scope: re-audit, then build the gaps.\n- Commit: commit now.\n- Leftover services: shut down.'), 'row 19'],
    [record('**Choices taken:**', '1. Commit: commit now.\n2. Push: push later.'), 'a numbered record'],
    [record('Рішення, які auto-mode ухвалив за тебе:', '- Коміт: закомітити зараз.'), 'a record in another language is not judged'],
  ]) assert.strictEqual(close(text).status, 0, why);
  for (const [text, why] of [
    [record('Decisions to be made:', '- Push: push it when you approve.'), 'decisions still owed'],
    [record('Decisions auto-mode made for you:', '- Commit: commit now.') + '\n\nPush it when you are ready.', 'a hand-off after the record'],
  ]) assert.strictEqual(close(text).status, 2, why);
});

// Audit 2026-10-20 C03 (8a1fb350 L2223): a typed question answered from survey loops - `for f in $(find ...); do
// s=$(grep ...); echo ...; done | sort` - read as a changing turn, so the answer was held as a done-close. A substitution
// is judged as the command it runs, the shell's grammar words change nothing; a write anywhere keeps the turn judged.
test('C03: an answer to a typed question is no done-close stall, read-only or not; a show-request that wrote stays judged', () => {
  const bash = (command) => { const id = `b${++seq}`; return [call(id, 'Bash', { command }), result(id, 'ok')]; };
  const answer = 'No open work for the app right now.\n\n- Probably done, but not marked: the parity card has no status line.\n- Not app work: the two cards still open belong to this backend.\n- Every other card is marked done.';
  const prompt = typed('is there any unfinished tasks left for the app?');
  for (const command of [
    "cd repo; for f in $(find docs/cards -name '*.md'); do s=$(grep -m1 -E '^status:' \"$f\"); echo \"$f | ${s:-no status line}\"; done | sort; echo \"control: $(ls docs/cards | wc -l) files\"",
    'cd repo/docs/cards; for f in a.md b.md; do echo "== $f"; sed -n 1,10p $f | cut -c1-220; done',
    'cd app; set -o pipefail; /usr/bin/grep -rln "order_done" libs 2>/dev/null | head -5; echo "exit $?"',
    'n=$((3+4)); [ "$n" = 7 ] && echo ok; if git log -1 --oneline; then echo yes; fi',
  ]) assert.strictEqual(over([prompt, ...bash(command)], answer).status, 0, command);
  for (const command of [
    "f=card.md; c=$(grep -c '^status: OPEN$' $f); [ \"$c\" = 1 ] && sed -i '' 's|^status: OPEN$|status: DONE|' $f",
    'for f in $(ls); do echo x > "$f.bak"; done',
    'echo "$(rm -rf build)"',
    'diff <(cat a) <(cat b)',
    './tools/grep -r x .',
  ]) {
    // the user's ruling of 2026-10-20: a typed question is answered whatever the turn wrote (feb34e2b sed-edited cards)
    assert.strictEqual(over([prompt, ...bash(command)], answer).status, 0, `a write under a typed question: ${command}`);
    assert.strictEqual(over([typed('show me the unfinished cards'), ...bash(command)], answer).status, 2, `a write under a show-request stays judged: ${command}`);
  }
  assert.strictEqual(over([typed('fix the cards'), ...bash('for f in a b; do echo $f; done')], answer).status, 2, 'an instruction is no question');
  const sed = bash("sed -i '' 's|^status: OPEN$|status: DONE|' card.md");
  assert.strictEqual(over([typed('can you mark the cards done?'), ...sed], answer).status, 2, 'a request worded as a question is an instruction');
  assert.strictEqual(over([typed('Could you close them?'), ...sed], answer).status, 2, 'its capitalised form too');
  assert.strictEqual(over([typed('cards look stale.\nis that the only task left?'), ...sed], answer).status, 0, 'the question on the last line counts');
  assert.strictEqual(over([typed('is that the only task left? then fix it'), ...sed], answer).status, 2, 'a question followed by an instruction is not');
  assert.strictEqual(over([prompt, ...sed], answer + "\n\nI'll mark the parity card next.").status, 2, 'the model\'s own next move still vetoes');
  assert.strictEqual(over([prompt, ...sed], 'Two cards marked done. The next step is the parity card.').status, 2, 'a pending step still vetoes');
});

test("C03: the done-close escape says a step the model can do itself is done, not asked", () => {
  // unquoted: a single-quoted span of earlier output is no pending item since audit 2026-10-20 H9
  const r = close("Pushed to develop as abc123.\n\n- Leftovers: none. The block I printed earlier still says def456 is not pushed, so fix that line if you already pasted it.");
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /An owed action\nthat is yours and needs no decision \(a reprint, a re-run, a step a tool you hold can do\) is\ndone in this turn, never asked/);
});

// Audit 2026-10-20 C45: a value only the user can type ('tell me the farm id' after their own login) is asked in prose -
// no option can carry it - while the front-loaded offer 'Next I can X, or Y.' is a decision left in prose.
test("C45: 'tell me the <value>' after a user-only step is no prose ask; 'Next I can X, or Y' is one", () => {
  const login = "Please enter your credentials there and select the test farm. Once you're logged in, tell me the farm id.";
  assert.strictEqual(close(login).status, 0, 'fabea019 L1746: the forced ask was rejected and the turn re-ended on the same wait');
  assert.strictEqual(close('Open the admin page and copy the webhook URL, then tell me the URL it shows.').status, 0, 'a URL to type');
  // the hand-back shapes the clause exists for still block
  for (const text of ['Run the migration, then tell me.', 'Check both screens and just tell me.', 'Tell me the option you prefer, or I pick the first.'])
    assert.strictEqual(close(text).status, 2, text);
  const next = close('The repro is written down. Next I can drive the wizard in the browser to confirm it, or pull the ticket attachment first.');
  assert.strictEqual(next.status, 2, 'fcafd69c L275: answered 18 s later with no ask');
  assert.match(next.stderr, /decision-shaped question in prose/);
  assert.strictEqual(close('The repro is written down. Next I run the wizard in the browser to confirm it.').status, 0, 'a plain next step offers no alternative');
});

// Audit 2026-10-20 C02: `2>/dev/null` read as a dev server, so a finite background poll was no live work and its wait was
// blocked (a09fc7d6); a set of checker seats ('Still waiting on 5 of the 9 checkers', a2920886) named no work word; and a
// 'Not run:' item held behind the running wait ('Not run: the suite, waiting on the Docker daemon') read as a step.
test("C02: a '/dev/null' poll is finite live work, checkers and a daemon are work, an item behind a wait is that wait", () => {
  const poll = (command) => [{ id: 'b1', type: 'shell', status: 'running', command }];
  const dockerWait = 'Green so far: build and unit tests 1677/1677. Not run: the integration suite, waiting on the Docker daemon (the wait is still going).';
  assert.strictEqual(over([typed('go')], dockerWait, { background_tasks: poll('for i in $(seq 1 36); do v=$(docker info 2>/dev/null); [ -n "$v" ] && break; sleep 5; done') }).status, 0,
    'a09fc7d6 L896: the poll ends, and its notice wakes the session');
  assert.strictEqual(over([typed('go')], dockerWait, { background_tasks: poll('npm test > out.log 2>/dev/null; sleep 1') }).status, 0, 'a suite redirected to /dev/null is finite');
  // the hold is kept for what it exists for
  assert.strictEqual(over([typed('go')], dockerWait, { background_tasks: [] }).status, 2, 'nothing out: the wait is a stall');
  assert.strictEqual(over([typed('go')], dockerWait, { background_tasks: poll('npm run dev 2>/dev/null') }).status, 2, 'a dev server never ends, /dev/null or not');
  assert.strictEqual(over([typed('go')], dockerWait, { background_tasks: poll('bin/dev') }).status, 2, "a 'bin/dev' launcher is still a server");
  const checkers = 'The Common checker is done. It found no serious problems. Still waiting on 5 of the 9 checkers.';
  assert.strictEqual(over([typed('go')], checkers, { background_tasks: running }).status, 0, 'a2920886 L519');
  assert.strictEqual(over([typed('go')], checkers, { background_tasks: [] }).status, 2, 'with no checker running it is a stall');
  assert.strictEqual(over([typed('go')], 'Build is done. Not run: the e2e suite. Waiting on the verifier agent.', { background_tasks: running }).status, 2,
    "a 'Not run:' item in its own sentence is still a step");
});

// Audit 2026-10-20 H9: the done-close exemptions wrote no row, so a change to one (C03) could not be measured - each that
// fires on a close the base test held now writes one `mode: probe`, `kind: done-close-exempt` row naming it; and a quoted
// span of earlier output held a close ('15f00b6c (not pushed)', session 7ec6c7db) - the pending half now reads no
// single-quoted span and no parenthetical right after a sha or a code span, while a real pending item still holds.
test('H9: quoted output is no pending item, a real one still holds, and an exemption that fires writes its row', () => {
  assert.strictEqual(close('Committed as 15f00b6c (not pushed). The suite is green.').status, 0, '7ec6c7db: git\'s own line, quoted');
  assert.strictEqual(close("Committed the fix; the log printed 'still running' before the retry. The suite is green.").status, 0, 'a single-quoted span');
  assert.strictEqual(close('Committed `a1b2c3d` (awaiting CI upstream). The suite is green.').status, 0, 'a parenthetical after a code span');
  assert.strictEqual(close('Committed as 15f00b6c (not pushed). The push is still unpushed - run it when you\'re ready.').status, 2, 'a real pending item beside the quote still holds');
  assert.strictEqual(close('Committed as 15f00b6c. Not pushed yet - next step is the push.').status, 2, 'the same words outside a quote hold');
  const sid = `h9-${process.pid}`;
  const r = run({ hook_event_name: 'Stop', session_id: sid, last_assistant_message: 'Pushed the fix. Nothing is pending on this run - these are yours to run when you choose.' });
  assert.strictEqual(r.status, 0, 'the pinned nothing-pending close passes');
  const ledger = path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`);
  const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.kind === 'done-close-exempt');
  assert.deepStrictEqual(rows.map((x) => [x.mode, x.exempt]), [['probe', 'nothing-pending']]);
});

// --- the scorer backstop (mode-output-scorer, spec 5.9): a cycle that released an output the scorer owes a grade for,
// with no Scored: line its loop wrote, is held once per typed prompt. CLAUDE_PROJECT_DIR holds a skill copy, so the
// scorer is usable; the suite strips ALFRED_CODE_*, so the docs root is .alfred/docs (layout.js:25).
const { scorerHeldFile } = require('../stack/hooks/hook-prelude.js');
const ROOT = process.env.CLAUDE_PROJECT_DIR;
fs.mkdirSync(path.join(ROOT, '.claude', 'skills', 'mode-output-scorer'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.claude', 'skills', 'mode-output-scorer', 'SKILL.md'), '---\nname: mode-output-scorer\ndescription: x\n---\n');
let touched = [];
test.beforeEach(() => { touched = []; });
const logs = new Map();   // one log dir per transcript, so the Stop chain marker carries across its closes
const closeOver = (tp, text, extra, env) => {
  const input = { hook_event_name: 'Stop', session_id: 'S', transcript_path: tp, last_assistant_message: text, ...(extra || {}) };
  touched.push(input.session_id);
  fs.appendFileSync(tp, JSON.stringify(say(`c${++seq}`, text)) + '\n');
  if (!logs.has(tp)) logs.set(tp, fs.mkdtempSync(path.join(TMP, 'log-')));
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logs.get(tp), ALFRED_CODE_SCORER: '1', ...(env || {}) } }).status;
};
const scorer = (rows, text, extra, env) => closeOver(transcript(rows), text, extra, env);
const append = (tp, rows) => fs.appendFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const ledgerRows = (kind) => [...new Set(touched)].flatMap((sid) => {
  try { return fs.readFileSync(path.join(ROOT, '.alfred', 'statistics', 'hook-blocks', `${sid.replace(/[^\w.-]/g, '_')}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
}).filter((r) => r.kind === kind);
const cmd = (name) => typed(`<command-name>/${name}</command-name>`);
const rowText = (o) => (typeof o.message.content === 'string' ? o.message.content : '');
const writeOverride = (name, value) => { fs.mkdirSync(path.join(ROOT, '.claude'), { recursive: true }); fs.writeFileSync(path.join(ROOT, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { [name]: value } })); };
const clearOverride = () => fs.rmSync(path.join(ROOT, '.claude', 'settings.local.json'), { force: true });
// T1 is per session: the backstop reads only the session's own draft folder (R31), so every case builds the draft from its sid.
const draftOf = (sid, id = 'ab12cd34') => `${ROOT}/.alfred/state/sessions/scorer/${sid}/x/${id}.draft.md`;
const T1 = (sid) => call('t1', 'Write', { file_path: draftOf(sid), content: 'd' });
const T2 = call('t2', 'Write', { file_path: `${ROOT}/.alfred/docs/work/plans/p.md`, content: 'p' });
const T3W = call('t3', 'Write', { file_path: `${ROOT}/.alfred/docs/work/diagnoses/f.md`, content: 'findings f:\n  Cause: OrderSyncJob.ExecuteAsync disposes the scope\n' });
const T3E = call('t4', 'Edit', { file_path: `${ROOT}/.alfred/docs/work/diagnoses/f.md`, old_string: 'Cause: <pending>', new_string: 'Cause: unproven - 2 hypotheses ranked' });
const T3S = call('t5', 'Agent', { subagent_type: 'alfred-code:issue-diagnoser-runtime', prompt: 'diagnose' });
const SCORED = 'Scored: 91/100 (level 80) - 1 run(s) - independent - designer-plan';
// backed(sid, line, folder) writes scorer/<folder>/b/rounds.log ending on `line` - the log next writes (R34)
const backed = (sid, line = 'released ab12cd34', folder = sid) => { const d = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', folder, 'b'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'rounds.log'), `output: custom\n1 0 ab12cd34\n${line}\n`); };

test('scorer backstop: T1, T2, both T3 writes and a settled T3 seat with no Scored line are held once; with it, not (AC11)', () => {
  for (const [name, make] of [['t1', T1], ['t2', () => T2], ['t3', () => T3W], ['t4', () => T3E], ['t5', () => T3S]]) {
    assert.strictEqual(scorer([typed('go'), make(`A-${name}`)], 'done', { session_id: `A-${name}` }), 2, name);
    backed(`B-${name}`);
    assert.strictEqual(scorer([typed('go'), make(`B-${name}`)], `done\n${SCORED}`, { session_id: `B-${name}` }), 0, name);
  }
});
test('scorer backstop: a draft in another session\'s folder is no T1 for this one (R31)', () => {
  assert.strictEqual(scorer([typed('go'), T1('other')], 'done', { session_id: 'N1' }), 0);
  assert.ok(!fs.existsSync(scorerHeldFile(ROOT, 'N1')));
});
test('scorer backstop: a Cause: <pending> write and a diagnoser seat still running are no T3 yet (R22)', () => {
  const pending = call('t6', 'Write', { file_path: `${ROOT}/.alfred/docs/work/diagnoses/g.md`, content: '  Cause: <pending>\n' });
  assert.strictEqual(scorer([typed('go'), pending], 'triaged', { session_id: 'P1' }), 0);
  const live = [{ id: 'd1', type: 'subagent', status: 'running', agent_type: 'alfred-code:issue-diagnoser-runtime' }];
  assert.strictEqual(scorer([typed('go'), T3S], 'Diagnosing - the seat is running', { session_id: 'P2', background_tasks: live }), 0);
});
test('scorer backstop: an Edit keeping the Cause line, a released root-cause, a bold <pending> - no T3 (final review 2)', () => {
  const f = `${ROOT}/.alfred/docs/work/diagnoses/f.md`;
  const cards = call('t8', 'Edit', { file_path: f, old_string: 'Cause: X disposes the scope\n', new_string: 'Cause: X disposes the scope\n\n### Task 1 - keep the scope\n' });
  assert.strictEqual(scorer([typed('add the task cards'), cards], 'cards added', { session_id: 'V1' }), 0);
  const stamp = call('t9', 'Edit', { file_path: f, old_string: 'Cause: X disposes the scope', new_string: 'Cause: X disposes the scope - signature ObjectDisposedException, fix: own scope per run' });
  const d = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'V2', 'cause');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'rounds.log'), 'output: root-cause\n1 0 ab12cd34\nreleased ab12cd34\n');
  fs.utimesSync(path.join(d, 'rounds.log'), (Date.now() - 600000) / 1000, (Date.now() - 600000) / 1000);   // an earlier cycle
  assert.strictEqual(scorer([typed('close it out'), stamp], 'stamped', { session_id: 'V2' }), 0);
  assert.strictEqual(scorer([typed('close it out'), stamp], 'stamped', { session_id: 'V3' }), 2, 'no released root-cause: held');
  const bold = call('t10', 'Write', { file_path: `${ROOT}/.alfred/docs/work/diagnoses/h.md`, content: '  Cause: **<pending>**\n  Cause: `<pending>`\n' });
  assert.strictEqual(scorer([typed('go'), bold], 'triaged', { session_id: 'V4' }), 0);
});
test('scorer backstop: a withheld output whose continue ask is open (rounds.log ends on asked) backs its Scored line (final review 3)', () => {
  backed('W1', 'asked ab12cd34 ask-continue');
  assert.strictEqual(scorer([typed('go'), T1('W1')], `withheld\nScored: 71/100 (level 80) - NOT PASSED`, { session_id: 'W1' }), 0);
  assert.strictEqual(ledgerRows('scorer-receipt-unbacked').filter((r) => /W1/.test(JSON.stringify(r))).length, 0);
  backed('W2', 'asked ab12cd34 offer-fix');                                                        // the fix-on-pass ask, open
  assert.strictEqual(scorer([typed('go'), T1('W2')], 'offered\nScored: 88/100 (level 80) - fix offered - 1 run(s)', { session_id: 'W2' }), 0);
});
test('scorer backstop: a typed stack (T4) is held once with the switch off; the name in inline code is not (AC25)', () => {
  for (const [i, t] of [typed('/task-version-upgrade /mode-output-scorer upgrade to .NET 10'), typed('using mode-output-scorer, explain closures'),
    typed('<command-name>/habits-explain-topic</command-name><command-args>/mode-output-scorer explain x</command-args>')].entries()) {
    assert.strictEqual(scorer([t], 'here', { session_id: `T4-${i}` }, { ALFRED_CODE_SCORER: '0' }), 2, rowText(t));
    backed(`T4b-${i}`);
    assert.strictEqual(scorer([t], `here\n${SCORED}`, { session_id: `T4b-${i}` }, { ALFRED_CODE_SCORER: '0' }), 0);
  }
  assert.strictEqual(scorer([typed('what does `/mode-output-scorer` do')], 'it grades', { session_id: 'T4c' }, { ALFRED_CODE_SCORER: '0' }), 0);
});
test('scorer backstop: a flag-only /mode-output-scorer line is no stack and owes no Scored line (AC7, spec section 4)', () => {
  for (const [i, t] of [typed('/mode-output-scorer --mode-output-scorer-off'),
    typed('<command-name>/mode-output-scorer</command-name><command-args>--mode-output-scorer-on</command-args>'),
    typed('<command-name>/mode-output-scorer</command-name><command-args>--mode-output-scorer-off</command-args>')].entries())
    assert.strictEqual(scorer([t], 'switched', { session_id: `T4f-${i}` }, { ALFRED_CODE_SCORER: '0' }), 0, rowText(t));
  assert.strictEqual(scorer([typed('<command-name>/mode-output-scorer</command-name><command-args>--mode-output-scorer-on explain x</command-args>')],
    'here', { session_id: 'T4f-x' }, { ALFRED_CODE_SCORER: '0' }), 2, 'a request after the run is a stack');
});
test('scorer backstop: a stacked cycle with the switch off owes a T1 draft too; an unstacked one does not (spec 5.9)', () => {
  const off = { ALFRED_CODE_SCORER: '0' };
  assert.strictEqual(scorer([typed('/habits-explain-topic /mode-output-scorer explain x'), T1('Q1')], 'here', { session_id: 'Q1' }, off), 2);
  assert.strictEqual(scorer([typed('explain x'), T1('Q2')], 'here', { session_id: 'Q2' }, off), 0);
});
test('scorer backstop: two closes in one cycle with a notification turn between - held on the first only (AC11)', () => {
  const tp = transcript([typed('go'), T1('C1')]);
  assert.strictEqual(closeOver(tp, 'Scoring designer-plan - the grader is running', { session_id: 'C1' }), 2);
  append(tp, [typed('<task-notification>grader done</task-notification>')]);              // a harness prompt: the same cycle
  assert.strictEqual(closeOver(tp, 'here it is', { session_id: 'C1' }), 0);
});
test('scorer backstop: a Scored line released in an earlier turn of the cycle clears a later plain close', () => {
  backed('C2');
  assert.strictEqual(scorer([typed('go'), T1('C2'), say('a1', `plan\n${SCORED}`), typed('<task-notification>x</task-notification>')], 'ok', { session_id: 'C2' }), 0);
});
test('scorer backstop: a typed Scored line with no rounds.log behind it is no receipt; a final line, a SELF log, both are (R34)', () => {
  assert.strictEqual(scorer([typed('go'), T1('R1')], `done\n${SCORED}`, { session_id: 'R1' }), 2);
  assert.strictEqual(ledgerRows('scorer-receipt-unbacked').length, 1);
  backed('R2', 'final ab12cd34');
  assert.strictEqual(scorer([typed('go'), T1('R2')], `withheld\n${SCORED}`, { session_id: 'R2' }), 0);
  // a log older than the cycle's opening row backs nothing: the opening row carries a timestamp 60s after the log's mtime
  backed('R4'); const old = (Date.now() - 120000) / 1000;
  fs.utimesSync(path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'R4', 'b', 'rounds.log'), old, old);
  const go = { ...typed('go'), timestamp: new Date(Date.now() - 60000).toISOString() };
  assert.strictEqual(scorer([go, T1('R4')], `done\n${SCORED}`, { session_id: 'R4' }), 2);
  // a SELF log backs any session's receipt in its time window, so it runs after R4 and goes after the case
  backed('R3', 'released ab12cd34', 'self-0a1b2c3d');
  assert.strictEqual(scorer([typed('/mode-output-scorer explain x')], `here\n${SCORED}`, { session_id: 'R3' }), 0);
  fs.rmSync(path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'self-0a1b2c3d'), { recursive: true, force: true });
});
test('scorer backstop: an ordinary reply, an Edit tick under task-implement, a task-verify-plan stamp - not held (AC14)', () => {
  assert.strictEqual(scorer([typed('hi')], 'hello', { session_id: 'E1' }), 0);
  assert.strictEqual(scorer([cmd('task-implement'), call('e1', 'Edit', { file_path: `${ROOT}/.alfred/docs/work/plans/p.md` })], 'ticked', { session_id: 'E2' }), 0);
  assert.strictEqual(scorer([cmd('task-verify-plan'), T2], 'stamped', { session_id: 'E3' }), 0);
});
test('scorer backstop: no flow exemption - /task-solve and a plan Write held; the released target in a later cycle is not (AC16, R23)', () => {
  assert.strictEqual(scorer([cmd('task-solve'), T2], 'plan written', { session_id: 'F1' }), 2);
  const slug = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'F2', 'p');
  fs.mkdirSync(slug, { recursive: true });
  fs.writeFileSync(path.join(slug, 'rounds.log'), 'output: designer-plan\ntarget: .alfred/docs/work/plans/p.md\n1 0 ab12cd34\nreleased ab12cd34\n');
  assert.strictEqual(scorer([typed('stamp it'), T2], 'rewritten', { session_id: 'F2' }), 0);
  const back = call('t7', 'Write', { file_path: `${ROOT}\\.alfred\\docs\\work\\plans\\p.md`, content: 'p' });   // Review Focus: another spelling
  assert.strictEqual(scorer([typed('stamp it'), back], 'rewritten', { session_id: 'F2' }), 0);
  assert.strictEqual(scorer([cmd('task-version-upgrade'), call('s1', 'Skill', { skill: 'habits-execution-strategy' }), T1('F3')], 'plan above', { session_id: 'F3' }), 2);
});
test('scorer backstop: the outputs list - root-cause alone holds T3, never T2 (AC24)', () => {
  const only = { ALFRED_CODE_SCORER_OUTPUTS: 'root-cause' };
  assert.strictEqual(scorer([typed('go'), T3W], 'cause', { session_id: 'O1' }, only), 2);
  assert.strictEqual(scorer([typed('go'), T2], 'plan', { session_id: 'O2' }, only), 0);
  assert.strictEqual(scorer([typed('go'), T2], 'plan', { session_id: 'O3' }, { ALFRED_CODE_SCORER_OUTPUTS: 'designer-plan,root-cause' }), 2);
});
test('scorer backstop: user-invocable-only holds no T2 or T3, and still holds a typed stack (AC19)', () => {
  writeOverride('mode-output-scorer', 'user-invocable-only');       // ROOT/.claude/settings.local.json
  try {
    assert.strictEqual(scorer([typed('go'), T2], 'plan', { session_id: 'U1' }), 0);
    assert.strictEqual(scorer([typed('go'), T3W], 'cause', { session_id: 'U2' }), 0);
    assert.strictEqual(scorer([typed('/mode-output-scorer explain x')], 'here', { session_id: 'U3' }), 2);
  } finally { clearOverride(); }
});
test('scorer backstop: a live output-scorer seat in background_tasks - not held; settled - held (AC17)', () => {
  const seat = (status) => [{ id: 'g1', type: 'subagent', status, agent_type: 'alfred-code:output-scorer' }];
  for (const [i, rowsOf] of [(sid) => [typed('go'), T1(sid)], () => [typed('/mode-output-scorer explain x')]].entries()) {
    assert.strictEqual(scorer(rowsOf(`L1-${i}`), 'Scoring custom - the grader is running', { session_id: `L1-${i}`, background_tasks: seat('running') }), 0);
    assert.strictEqual(scorer(rowsOf(`L2-${i}`), 'Scoring custom - the grader is running', { session_id: `L2-${i}`, background_tasks: seat('completed') }), 2);
  }
});
test('scorer backstop: no typed prompt in the transcript - not held, one scorer-cycle-unread row', () => {
  assert.strictEqual(scorer([T1('V1')], 'done', { session_id: 'V1' }), 0);
  assert.strictEqual(ledgerRows('scorer-cycle-unread').length, 1);
});
test('scorer backstop: typed rows with no uuid or timestamp key the cycle by the row\'s hash - held once across two closes', () => {
  const tp = transcript([typed('go'), T1('K1')]);
  assert.strictEqual(closeOver(tp, 'done', { session_id: 'K1' }), 2);
  assert.strictEqual(closeOver(tp, 'done', { session_id: 'K1' }), 0);
});
test('scorer backstop: an opening row past the 256KB tail is still found - the walk widens (AC11)', () => {
  const pad = Array.from({ length: 300 }, (_, i) => result(`r${i}`, 'x'.repeat(1024)));        // about 300KB of tool results
  assert.strictEqual(scorer([typed('go'), T1('W1'), ...pad], 'done', { session_id: 'W1' }), 2);
});
test('scorer backstop: a T1 file_path written with backslashes, and a session id with a slash, are still a trigger (R31)', () => {
  const w = call('t9', 'Write', { file_path: draftOf('B1').replace(/\//g, '\\'), content: 'd' });
  assert.strictEqual(scorer([typed('go'), w], 'done', { session_id: 'B1' }), 2);
  const odd = call('t10', 'Write', { file_path: draftOf('a_b', 'cd34ab12'), content: 'd' });
  assert.strictEqual(scorer([typed('go'), odd], 'done', { session_id: 'a/b' }), 2);
});
test('scorer backstop: a Stop hook feedback row starts no cycle; the check runs before the stopHeld exit (R17)', () => {
  assert.strictEqual(scorer([typed('go'), T1('H1'), say('a', 'x'), typed('Stop hook feedback: a sibling hook held this')], 'done', { session_id: 'H1' }), 2);
  // this hook holds first for another reason (a prose decision ask, no trigger yet); the rewrite then writes a draft and
  // closes plain with stop_hook_active set, so stopHeld (:1814) is true - only a check placed before it still holds
  const tp = transcript([typed('pick one')]);
  assert.strictEqual(closeOver(tp, 'Should I use the first option or the second one?', { session_id: 'S7' }), 2);
  append(tp, [T1('S7')]);
  assert.strictEqual(closeOver(tp, 'Here is the plan.', { session_id: 'S7', stop_hook_active: true }), 2);
  assert.strictEqual(closeOver(tp, 'Here is the plan.', { session_id: 'S7', stop_hook_active: true }), 0);   // once per cycle
});
test('scorer backstop: all four keys unset, the switch at 0, or guard-stop-contract:scorer off - never held, nothing written (AC1, AC20)', () => {
  for (const env of [{ ALFRED_CODE_SCORER: '' }, { ALFRED_CODE_SCORER: '0' }, { ALFRED_CODE_HOOKS_OFF: 'guard-stop-contract:scorer' }])
    assert.strictEqual(scorer([typed('go'), T1('S0'), T2], 'done', { session_id: 'S0' }, env), 0, JSON.stringify(env));
  assert.ok(!fs.existsSync(scorerHeldFile(ROOT, 'S0')));
});

// --- the output-scorer's seal (spec 5.10): the seat's report is written to the score file its first line names, sealed,
// from its SubagentHandback call or, with none, from SubagentStop - only inside this session's scorer folder, never twice.
const crypto = require('node:crypto');
const SCORECARD = path.join(__dirname, '..', 'stack', 'skills', 'mode-output-scorer', 'scripts', 'scorecard.js');
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const FOLDER = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 's1', 'x');
fs.mkdirSync(FOLDER, { recursive: true });
fs.mkdirSync(path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'a_b', 'x'), { recursive: true });
const OUTSIDE = fs.mkdtempSync(path.join(TMP, 'outside-'));
const seat = { agent_id: 'g1', agent_type: 'alfred-code:output-scorer', session_id: 's1' };
const hookRun = (input, env) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...logEnv(), ...(env || {}) } });
const handback = (msg, extra, env) => hookRun({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: msg }, ...seat, ...(extra || {}) }, env);
const stop = (msg, extra, env) => hookRun({ hook_event_name: 'SubagentStop', last_assistant_message: msg, ...seat, ...(extra || {}) }, env);
const cli = (args) => spawnSync(process.execPath, [SCORECARD, ...args], { cwd: ROOT, encoding: 'utf8', env: logEnv() });
const R100_FILE = path.join(OUTSIDE, 'rubric-r100.md');
fs.writeFileSync(R100_FILE, `# r100\n\n\`\`\`json\n${JSON.stringify({ output: 'r100', checks: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c${i + 1}`, { points: 1, na: null }])) })}\n\`\`\`\n`);
const CARD_BODY_100 = ['', '## Checks', '| ID | Result | Evidence or reason |', '|---|---|---|',
  ...Array.from({ length: 100 }, (_, i) => `| c${i + 1} | yes | "quoted" |`), '', '## Findings', 'None', '', '## Positives', 'None', ''].join('\n');

test('scorer seal: a report is sealed from the hand-back and, with no hand-back, from SubagentStop, stop_hook_active or not (AC18, AC22)', () => {
  for (const [id, send] of [['aa000001', (m) => handback(m)], ['aa000002', (m) => stop(m)], ['aa000003', (m) => stop(m, { stop_hook_active: true })]]) {
    const file = path.join(FOLDER, `${id}.score.md`); const msg = `score-file: ${file}\n## Checks\n| P1 | yes | "q" |`;
    const r = send(msg);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), `seal: sha256 ${sha256(msg)}\n${msg}`, id);
    if (id === 'aa000001') assert.deepStrictEqual([r.status, r.stdout.trim()], [0, '']);         // the hand-back is never delayed
  }
});
test('scorer seal: a leading blank line, bold or backticks around score-file: still seal (Review Focus)', () => {
  for (const [id, head] of [['ac000001', '\nscore-file: '], ['ac000002', '**score-file:** '], ['ac000003', '`score-file: ']]) {
    const file = path.join(FOLDER, `${id}.score.md`);
    handback(`${head}${file}${head.startsWith('`') ? '`' : ''}\nbody`);
    assert.ok(fs.existsSync(file), id);
  }
});
test('scorer seal: a second delivery of the same score-file never rewrites the first seal (AC22)', () => {
  const file = path.join(FOLDER, 'ab000001.score.md');
  handback(`score-file: ${file}\nfirst`); stop(`score-file: ${file}\nsecond`);
  assert.match(fs.readFileSync(file, 'utf8'), /\nfirst$/);
});
test('scorer seal: outside the folder, another session, ../ segments, a symlinked parent, an existing file - nothing written (AC18)', () => {
  fs.symlinkSync(OUTSIDE, path.join(FOLDER, 'link'));                       // OUTSIDE: a dir beside the project
  fs.writeFileSync(path.join(FOLDER, 'bb000001.score.md'), 'mine');
  for (const p of [path.join(ROOT, 'x.score.md'), path.join(FOLDER, '..', '..', 's2', 'x', 'b.score.md'),
    path.join(FOLDER, '..', '..', '..', 'evil.score.md'), path.join(FOLDER, 'link', 'c.score.md'), path.join(FOLDER, 'bb000001.score.md')]) {
    const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    handback(`score-file: ${p}\nbody`);
    assert.strictEqual(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null, before, p);
  }
});
test('scorer seal: a session id with a slash seals into its safe folder only (R31)', () => {
  const safe = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer', 'a_b', 'x', 'ae000001.score.md');
  handback(`score-file: ${safe}\nbody`, { session_id: 'a/b' });
  assert.ok(fs.existsSync(safe));
});
test('scorer seal: a project root reached through a symlink (an os.tmpdir() root on macOS) still seals', () => {
  const link = path.join(OUTSIDE, 'root-link'); fs.symlinkSync(ROOT, link);
  const file = path.join(link, '.alfred', 'state', 'sessions', 'scorer', 's1', 'x', 'cc000001.score.md');
  handback(`score-file: ${file}\nbody`, {}, { CLAUDE_PROJECT_DIR: link });
  assert.ok(fs.existsSync(file));
});
test('scorer seal: another agent_type, or guard-stop-contract:scorer off - nothing written', () => {
  const file = path.join(FOLDER, 'dd000001.score.md');
  handback(`score-file: ${file}\nbody`, { agent_type: 'alfred-code:aspnet-verifier' });
  handback(`score-file: ${file}\nbody`, {}, { ALFRED_CODE_HOOKS_OFF: 'guard-stop-contract:scorer' });
  assert.ok(!fs.existsSync(file));
});
test('scorer seal: the written file passes scorecard grade, and fails with exit 3 once one character changes (AC18)', () => {
  const file = path.join(FOLDER, 'ee000001.score.md'); handback(`score-file: ${file}\n${CARD_BODY_100}`);
  assert.strictEqual(cli(['grade', file, '--rubric', R100_FILE, '--level', '80']).status, 0);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('| c1 | yes |', '| c1 | no  |'));
  assert.strictEqual(cli(['grade', file, '--rubric', R100_FILE, '--level', '80']).status, 3);
});
