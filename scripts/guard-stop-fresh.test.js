// Behavior tests for the stop / answer-length / fresh-session fixes the 154-bundle session audit
// measured (fix family D). Every case here is a real transcript shape: a close the gate MISSED and
// the stall it cost, or a close the gate BLOCKED that asked nothing. Both directions are pinned in
// the same test - a widened regex that also fires on the neighbouring clean close is a worse gate
// than the one it replaces, because a false block teaches the model a bypass it then uses on the
// turn that mattered.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // audit 2026-10-08: its hooks' tmp state stays in a dir of its own
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-stop-fresh-'));

// The window layers read settings.json from the ACCOUNT dir and the project - a real machine's
// account file names a model like `opus[1m]`, which would silently move every threshold assertion
// here. Pin an EMPTY account dir for the whole run; the cases that exercise a tier point at a
// fixture of their own.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
// ... and a Claude Code session's own settings env reaches this process: the seeded
// ALFRED_CODE_DEFAULT_CONTEXT_WINDOW=1000000 would resolve every unproven window below as 1M.
delete process.env.ALFRED_CODE_DEFAULT_CONTEXT_WINDOW;
// Every guard appends a block row under CLAUDE_PROJECT_DIR, falling back to the process cwd - so an
// unpinned run forges field ledger rows into this repo's own docs root. Pin a scratch root.
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));

const runIn = (hook, payload, opts) =>
  spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });

function transcript(name, rows) {
  const p = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}
const assistantRow = (id, text, usage, extra) => ({
  type: 'assistant',
  message: { id, content: [{ type: 'text', text }], usage: usage || { cache_read_input_tokens: 10 } },
  ...(extra || {}),
});
// Every fresh-session fixture is TWO rows: the session's own cold FLOOR and then the context being
// measured - the offer is made only when what a resume would RECOVER is a real share of the carry,
// so a one-row fixture recovers nothing by construction.
const ctxRows = (name, ctx, text) => [
  assistantRow(`${name}-floor`, 'the first turn of this session', { cache_creation_input_tokens: 20000 }),
  assistantRow(name, text || 'ok', { cache_read_input_tokens: ctx }),
];
const logEnv = (extra) => ({ ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...(extra || {}) });
function accountDir(name, model) {
  const d = fs.mkdtempSync(path.join(TMP, `${name}-`));
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(model === null ? {} : { model }));
  return d;
}

// A close is judged from the harness's own `last_assistant_message` field, which is what the live
// hook reads first - no transcript needed for the phrase cases.
const close = (text, extra) => runIn('guard-stop-contract.js',
  { hook_event_name: 'Stop', last_assistant_message: text, ...(extra || {}) }, { env: logEnv() });

// ---------------------------------------------------------------------------------------------
// 1. stop-phrase-gaps - seven measured closes the decision-in-prose regexes did not see
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: the offer shapes the corpus measured unheld are stops', () => {
  // Each string is the measured close (or its load-bearing clause), each with the stall it cost.
  assert.equal(close("The permission is the only thing missing. Say 'allowed' and I continue.").status, 2,
    "a QUOTED say-token: 5 unheld asks in one session while the user's anger escalated");
  assert.equal(close("Ready when you are - say 'go' and I run it.").status, 2, "the same token in single quotes");
  assert.equal(close('Everything is staged and ready to commit when you say so.').status, 2,
    "'ready to commit when you say so' - 2h20m idle, then a 146.8k re-cache");
  assert.equal(close('The plan holds. If you say yes I start on task 3.').status, 2, "'if you say yes'");
  assert.equal(close("Say yes and I'll build it, or tell me the objection is acceptable noise.").status, 2,
    "'Say yes and I\\'ll build it' - 52s later the user asked 'Have you implemented?'");
  assert.equal(close("When the log looks right, tell me to push and I'll run the push gate first.").status, 2,
    "'tell me to push' - the next user turn was the correction 'Do it by your own'");
  assert.equal(close('Check the output above, then tell me. From there I drive task 4.').status, 2,
    "a bare 'then tell me' - the user asked 'Why you stopped?' 5 minutes later");
  assert.equal(close('- Do it by hand in the dashboard.\n- Or let me do it: give the connection a token with write scope.').status, 2,
    'a bulleted two-path offer with no question mark');
  assert.equal(close('Migration complete.\n\nNext steps:\n1. Reload the session.\n2. Re-run the capture.').status, 2,
    "'Next steps' PLURAL - PENDING_RE read only the singular, so the mandated close header escaped it");
});

test('guard-stop-contract: the widened shapes do not fire on a close that asks nothing', () => {
  // The neighbours. Each of these would be a false block, which costs the whole turn.
  assert.equal(close('The logs tell me the build failed on the second stage; I fixed the path and it is green.').status, 0,
    "'tell me' with a subject in front is narration, not an imperative");
  assert.equal(close('The docs say yes to both spellings, so I kept the shorter one. All tests pass.').status, 0,
    "'say yes' inside a statement about documentation");
  assert.equal(close('I applied the change and the suite is green. Three files moved.').status, 0, 'an ordinary clean close');
  assert.equal(close('Next steps are already done - the reload ran and the capture is current. Nothing is pending on this run - these are yours to run when you choose.').status, 0,
    'the plural header with the pinned nothing-pending line is still a finished close');
  assert.equal(close('Renamed the flag to say-so-mode in three files; the tests cover both spellings.').status, 0,
    "'say so' inside an identifier is not a hand-back");
});

// ---------------------------------------------------------------------------------------------
// 2. stop-false-positive - five measured blocks on closes that held no question
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: a code span, a path and a negation are not a pending decision', () => {
  assert.equal(close("The endpoint list is unchanged: `/health/ready` and `/health/live` both answer 200; the deploy is done and the tree is clean.").status, 0,
    "'ready' inside the path /health/ready is not a readiness claim - measured one forced round trip");
  assert.equal(close('Task 3 is done. Nothing I started is still running, and the tree is clean.').status, 0,
    "'still running' inside its own NEGATION - the most expensive false positive in the collection, ~1.01M tokens");
  assert.equal(close('The suite is green and nothing is left to do here - no jobs are queued and no background work is pending.').status, 0,
    'the same negation in its other spellings');
  assert.equal(close("The live-run probe was not run (your call, environment-sensitive) so its 11 checks are unverified. Everything else is committed.").status, 0,
    "a retrospective '(your call, <more words>)' - measured 298k cache-read and ~6 minutes for one retry");

  // ... and the shapes that MUST still block, so the fix did not buy the passes with a hole.
  assert.equal(close('The refactor is done. Pushing it is the next step, whenever you are ready.').status, 2, 'a real stall still blocks');
  assert.equal(close('Both work - your call which one ships.').status, 2, 'a live `your call` is still an offer');
  assert.equal(close('Task 3 is done. The seeder I started is still running, and nothing reports back on it.').status, 2,
    'the same sentence WITHOUT the negation is the stall the branch exists for');
});

// ---------------------------------------------------------------------------------------------
// 2b. 2.1.6 H4 - a main-session close over its OWN live background work is a status line. Two closes
// were blocked in one orchestrating session (2026-09-29) while two async agents it had launched were
// still running and their reports were what would wake it; both are quoted verbatim below.
// ---------------------------------------------------------------------------------------------
const WAITING_CLOSE = "Both background reports are still being written, and nothing has been committed or cherry-picked yet.\n\n- **Waiting on:** `review-216-ab.md` (the A/B package's review) and `fix-216-install-report.md` (fixes for the corrupt-file cases F1 and F2). The install package is still running its temp-project cases.\n- **Done while waiting:** I rebuilt the cursor-stack mirror list in `.superpowers/sdd/2026-09-29-audit/mirror-owed.md` from the fix reports. Only the install package's twin line is still missing.\n- **Next:** a watcher tells me when each file stops growing. Then I fix the A/B review's BLOCKER and MATERIAL findings in `fix216-ab` and dispatch the install package's review.";
const RUNNING_CLOSE = "The install package has finished: both corrupt-file bugs (F1 and F2) are fixed, 1200 of 1201 scoped tests pass (the one fail is a known environment issue), and lint is clean. Its review is now running.\n\n- **The review also checks two issues the package found:**\n  - a pre-existing bug where dropping macOS-desktop at local scope is undone by the next update;\n  - the cross-project write guard misreading the `/g` in `sed 's/../../g'` as a place it writes to.\n- **Still running:** the implementer fixing the A/B review findings (M70 PR test, M128 skill preload check).\n\nNothing needs your decision; I continue when either reports.";
// The transcript shapes Claude Code writes: a launch (tool_use + its tool_result), and the <task-notification>
// that arrives when the work ends - as a user row, or absorbed mid-turn as a queued_command attachment.
const launchRows = (id, name, input, resultText, toolUseResult) => [
  { type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: resultText }] }, toolUseResult },
];
const asyncAgent = (id, agentId) => launchRows(id, 'Agent', { description: 'Review the package', prompt: 'review it', subagent_type: 'general-purpose' },
  `Async agent launched successfully.\nagentId: ${agentId} (internal ID)\nThe agent is working in the background. You will be notified automatically when it completes.`,
  { isAsync: true, status: 'async_launched', agentId });
const bgBash = (id, taskId) => launchRows(id, 'Bash', { command: 'npm test', run_in_background: true },
  `Command running in background with ID: ${taskId}. Output is being written to: /tmp/x/tasks/${taskId}.output. You will be notified when it completes.`,
  { stdout: '', stderr: '', backgroundTaskId: taskId });
const monitor = (id, taskId) => launchRows(id, 'Monitor', { command: 'tail -f log', description: 'watch' },
  `Monitor started (task ${taskId}, expires in 30m unless the source ends first). You will be notified on each event.`, { taskId });
const notice = (body) => ({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n${body}\n</task-notification>` } });
const absorbed = (body) => ({ type: 'attachment', attachment: { type: 'queued_command', prompt: `<task-notification>\n${body}\n</task-notification>`, commandMode: 'task-notification' } });
const fgBash = launchRows('toolu_fg', 'Bash', { command: 'git status' }, 'clean', { stdout: 'clean' });
const closeOver = (name, rows, text) => close(text, { transcript_path: transcript(name, [...rows, assistantRow(`${name}-close`, text)]) });

test('guard-stop-contract: a main-session close over its own live background work is a status line (2.1.6 H4)', () => {
  const live = asyncAgent('toolu_ag1', 'a1b2c3');
  assert.equal(closeOver('h4-a', [...fgBash, ...live], WAITING_CLOSE).status, 0, 'the waiting close, an async agent still out');
  assert.equal(closeOver('h4-b', [...fgBash, ...live], RUNNING_CLOSE).status, 0, 'the running close, an async agent still out');
  assert.equal(closeOver('h4-bash', bgBash('toolu_bg1', 'bx9'), WAITING_CLOSE).status, 0, 'a run_in_background shell still open');
  const mon = monitor('toolu_mo1', 'bk77');
  assert.equal(closeOver('h4-mon', [...mon, absorbed('<task-id>bk77</task-id>\n<summary>Monitor event</summary>\n<event>one file landed</event>')], WAITING_CLOSE).status, 0,
    'a Monitor that delivered an event is still watching');
  // a tool result QUOTING a notice (a grep over a transcript) delivers nothing
  const quoted = launchRows('toolu_gr1', 'Bash', { command: 'grep task-notification t.jsonl' },
    '<task-notification>\n<task-id>a1b2c3</task-id>\n<tool-use-id>toolu_ag1</tool-use-id>\n<status>completed</status>\n</task-notification>', { stdout: '' });
  assert.equal(closeOver('h4-quoted', [...live, ...quoted], RUNNING_CLOSE).status, 0, 'a quoted notice is no completion');
});

test('audit 2026-10-08: the Stop payload\'s background_tasks registry is read before the lagging transcript', () => {
  // code.claude.com/docs/en/hooks 'Stop input': present when the task registry is reachable, empty when nothing is in flight
  const over = (name, rows, tasks) => close(WAITING_CLOSE, { transcript_path: transcript(name, [...rows, assistantRow(`${name}-close`, WAITING_CLOSE)]), background_tasks: tasks });
  assert.equal(over('bt-sub', fgBash, [{ id: 't1', type: 'subagent', status: 'running', description: 'review', agent_type: 'general-purpose' }]).status, 0,
    'a running subagent the transcript has not caught up with');
  assert.equal(over('bt-shell', fgBash, [{ id: 't2', type: 'shell', status: 'running', description: 'tests', command: 'npm test' }]).status, 0, 'a finite shell');
  assert.equal(over('bt-server', fgBash, [{ id: 't3', type: 'shell', status: 'running', description: 'dev', command: 'npm run dev' }]).status, 2, 'a server never reports back');
  assert.equal(over('bt-done', fgBash, [{ id: 't4', type: 'subagent', status: 'completed', description: 'review' }]).status, 2, 'a settled task is no live work');
  assert.equal(over('bt-empty', [...fgBash, ...asyncAgent('toolu_bt5', 'b5')], []).status, 2, 'an empty registry outranks a launch the transcript still shows open');
  assert.equal(over('bt-none', [...fgBash, ...asyncAgent('toolu_bt6', 'b6')], undefined).status, 0, 'with no registry the transcript decides, as before');
});

test('guard-stop-contract: the same closes with no live background work of their own still block (2.1.6 H4)', () => {
  // the measured case the branch exists for is untouched: done, a next action, nothing out to wake the session
  assert.equal(closeOver('h4-none-a', fgBash, WAITING_CLOSE).status, 2, 'nothing launched');
  assert.equal(closeOver('h4-none-b', fgBash, RUNNING_CLOSE).status, 2, 'nothing launched, and the running words alone decide nothing');
  const ended = [...asyncAgent('toolu_ag2', 'd4e5f6'), notice('<task-id>d4e5f6</task-id>\n<tool-use-id>toolu_ag2</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>')];
  assert.equal(closeOver('h4-ended', ended, RUNNING_CLOSE).status, 2, 'the agent reported already');
  const absorbedEnd = [...bgBash('toolu_bg2', 'bq1'), absorbed('<task-id>bq1</task-id>\n<tool-use-id>toolu_bg2</tool-use-id>\n<status>completed</status>')];
  assert.equal(closeOver('h4-absorbed', absorbedEnd, WAITING_CLOSE).status, 2, 'a completion absorbed mid-turn counts as arrived');
  const expired = [...monitor('toolu_mo2', 'bk88'), notice('<task-id>bk88</task-id>\n<event>[Monitor expired after 30m with 1 event delivered. Re-arm it if you still need the watch.]</event>')];
  assert.equal(closeOver('h4-expired', expired, WAITING_CLOSE).status, 2, 'an expired Monitor watches nothing');
  const sync = launchRows('toolu_sy1', 'Agent', { description: 'x', prompt: 'x', subagent_type: 'general-purpose' }, 'The review found two issues.', { status: 'completed' });
  assert.equal(closeOver('h4-sync', sync, RUNNING_CLOSE).status, 2, 'a foreground agent returned its report inline');
  // live work beside a hand-back to the USER is still a pending decision: the close must name the running work
  assert.equal(closeOver('h4-handback', asyncAgent('toolu_ag3', 'g7'), 'The refactor is done. Pushing it is the next step, whenever you are ready.').status, 2,
    'a stall on the user is not excused by an agent running elsewhere');
});

test('guard-stop-contract: work inherited from an earlier session makes the set unknown, and the words decide (2.1.6 H4)', () => {
  // Measured: the orchestrating session was a hand-off - its agents were launched in the session before, and their
  // notices arrived in this transcript naming ids it never launched. What else is still out cannot be read here.
  const inherited = [...fgBash, notice('<task-id>a69ff4</task-id>\n<tool-use-id>toolu_elsewhere</tool-use-id>\n<status>completed</status>')];
  assert.equal(closeOver('h4-inh-a', inherited, RUNNING_CLOSE).status, 0, "the running close: 'review is now running', 'when either reports'");
  assert.equal(closeOver('h4-inh-b', inherited, 'Task 3 is done. The seeder I started is still running, and nothing reports back on it.').status, 2,
    'the measured stall still blocks');
});

test('guard-stop-contract: with no transcript to read, the running noun and the waiter decide (2.1.6 H4)', () => {
  assert.equal(close(RUNNING_CLOSE).status, 0, "'review is now running' and 'I continue when either reports'");
  assert.equal(close('Task 5 is done. Two agents are still running.').status, 0, 'agents as the running noun');
  assert.equal(close('Task 5 is done. The implementer is still executing; its report wakes me.').status, 0, 'a waiter that wakes the session');
  assert.equal(close('Task 5 is done. Group B is still running; I pick it up when it lands.').status, 0, "'when it lands' as the waiter");
  assert.equal(close('Task 3 is done. The seeder I started is still running, and nothing reports back on it.').status, 2, 'the measured stall still blocks');
  assert.equal(close('The refactor is done. Pushing it is the next step, whenever you are ready.').status, 2, 'and so does the hand-back');
});

// 2.1.6 review B2 / m3: live work excused ANY close that said 'running' or 'waiting' - 21 of 27 true stalls passed under
// a live agent, dev server or Monitor. The review's closes, verbatim, across its seven transcript states: every stall
// blocks in every state; the two real status closes pass where work of the session's own is still out.
const REVIEW_STALLS = [
  ['X1', 'Step 1 is done. Next step: wire up the API endpoint.'],
  ['X2', 'The fix is done and verified. Awaiting your go-ahead to commit.'],
  ['X3', 'The refactor is done and the dev server is running. Next step: add the settings page.'],
  ['X4', 'Everything is ready - waiting for your go-ahead to push.'],
  ['X5', 'Task 3 is done. The seeder I started is still running, and nothing reports back on it.'],
  ['X6', 'Changes are complete and tests are green. Next steps: update the docs, then open the PR.'],
  ['X7', 'Migration done. Waiting on you to confirm the schema before the next step.'],
  ['X8', 'The review is done. The docs update is in progress next - that remains before the PR.'],
  ['X9', 'Task 4 is done. The review agent is queued; next step is task 5.'],
  // the first pass's own concern: running work named beside a step handed to the user
  ['X10', 'Task 2 is done. The review agent is still running; next step: you push the branch.'],
];
const REVIEW_STATUS = [
  ['P3', 'Task 2 is done. The implementer for task 3 is running in the background; I continue when it reports.'],
  ['P4', 'Task 2 is done. I sent the two findings back to the implementer; it is running again and its report wakes me.'],
];
const sendMessage = (id, to) => launchRows(id, 'SendMessage', { to, summary: 'two findings', message: 'fix them', type: 'message' },
  JSON.stringify({ success: true, message: `Resuming agent ${to.slice(0, 7)}`, resumedAgentId: to }), { success: true, message: `Resuming agent ${to.slice(0, 7)}`, resumedAgentId: to });
const reviewAgent = asyncAgent('toolu_rv1', 'a94802108a39744a2');
const reviewEnded = [...reviewAgent, notice('<task-id>a94802108a39744a2</task-id>\n<tool-use-id>toolu_rv1</tool-use-id>\n<status>completed</status>')];
const devServer = launchRows('toolu_dev1', 'Bash', { command: 'npm run dev', run_in_background: true, description: 'Start the dev server' },
  'Command running in background with ID: bdev1. Output is being written to: /tmp/x/tasks/bdev1.output.', { backgroundTaskId: 'bdev1' });
let bigFiller = null;
const filler = () => {
  if (!bigFiller) {
    const row = JSON.stringify(assistantRow('fill', 'x'.repeat(4000)));
    bigFiller = Array.from({ length: 2400 }, () => JSON.parse(row)); // ~9.7MB: the window never reaches a launch
  }
  return bigFiller;
};
const STATES = {
  none: () => fgBash,
  agent: () => reviewAgent,
  dev: () => devServer,
  monitor: () => monitor('toolu_mo9', 'bk99'),
  ended: () => reviewEnded,
  resumed: () => [...reviewEnded, ...sendMessage('toolu_sm1', 'a94802108a39744a2')],
  big: () => [...reviewAgent, ...filler()],
};

test('guard-stop-contract: every review stall blocks in every transcript state (2.1.6 review B2)', () => {
  const passed = [];
  for (const [state, rows] of Object.entries(STATES)) {
    for (const [id, text] of REVIEW_STALLS) if (closeOver(`b2-${id}-${state}`, rows(), text).status !== 2) passed.push(`${id}/${state}`);
  }
  assert.deepStrictEqual(passed, [], 'a stall passed');
});

test('guard-stop-contract: the real status closes pass over the session\'s own live work, and only there (2.1.6 review B2, m3)', () => {
  const want = { none: 2, agent: 0, dev: 2, monitor: 0, ended: 2, resumed: 0 };
  for (const [state, status] of Object.entries(want)) {
    assert.equal(closeOver(`p1-${state}`, STATES[state](), RUNNING_CLOSE).status, status, `the running close, ${state}`);
    assert.equal(closeOver(`p2-${state}`, STATES[state](), WAITING_CLOSE).status, status, `the waiting close, ${state}`);
  }
  // the big window holds no launch: unknown, and the words decide - the running close names a review running
  assert.equal(closeOver('p1-big', STATES.big(), RUNNING_CLOSE).status, 0, 'the running close, a window past its launch');
  for (const [state, rows] of Object.entries(STATES)) {
    for (const [id, text] of REVIEW_STATUS) assert.equal(closeOver(`${id}-${state}`, rows(), text).status, 0, `${id}, ${state}`);
  }
});

test('guard-stop-contract: a background dev server or watcher is no work that reports back (2.1.6 review B2)', () => {
  for (const command of ['npm run dev', 'npx vite serve', 'npm start', 'tsc --watch', 'ng serve', 'vite preview', 'tail -f app.log']) {
    const rows = launchRows('toolu_w1', 'Bash', { command, run_in_background: true }, 'Command running in background with ID: bw1.', { backgroundTaskId: 'bw1' });
    assert.equal(closeOver(`dev-${command.replace(/\W+/g, '-')}`, rows, RUNNING_CLOSE).status, 2, command);
  }
});

// 2.1.6 review re-verify N-B2: a hand-back whose wait names no person ('awaiting approval', 'waiting for the go-ahead')
// passed while any work ran - 59 cells, 0 on base - and a background server (`dotnet run`, `docker compose up`) never
// ends, so it held the exemption open for the rest of the session. The reviewer's closes and states, as fixtures. N4
// (its stop half): an all-Ukrainian or all-Russian stall is judged like an English one.
const REVERIFY_STALLS = [
  ['X11', 'The fix is done and verified. Awaiting approval to commit.'],
  ['X12', 'Everything is ready - waiting for the go-ahead to push.'],
  ['X13', 'Migration done. Waiting on a decision about the schema.'],
  ['X14', 'Task 3 is done and the review agent is still running. Tell me whether to push.'],
  ['X16', 'Task 3 is done; the review agent is still running. Чекаю на твоє рішення щодо push.'],
  ['X18', 'Task 3 is done. Awaiting sign-off before I push.'],
  ['X19', 'Done - the reviewer is still running. Waiting for confirmation to merge.'],
];
const CYRILLIC_STALLS = [
  ['UK1', 'Задача 3 виконана. Чекаю на твоє рішення щодо push.'],
  ['UK2', 'Готово. Наступний крок: додати сторінку налаштувань.'],
  ['UK3', 'Міграцію завершено. Чекаю на підтвердження схеми.'],
  ['RU1', 'Задача 3 выполнена. Жду твоего решения по push.'],
  ['RU2', 'Готово. Следующий шаг: добавить страницу настроек.'],
  ['RU3', 'Миграция завершена. Жду подтверждения схемы.'],
];
const CYRILLIC_STATUS = [
  ['UK4', "Задача 2 готова. Агент рев'ю ще працює; продовжу, коли він відзвітує."],
  ['RU4', 'Задача 2 выполнена. Агент ревью ещё работает; продолжу, когда он отчитается.'],
];
const REVERIFY_STATUS = [
  ['P5', 'Task 3 is done; the review agent is still running, waiting on its report.'],
  ['P6', 'Task 3 is done. Awaiting its verdict before task 4.'],
];
const bgShell = (id, command) => launchRows(id, 'Bash', { command, run_in_background: true }, `Command running in background with ID: ${id}.`, { backgroundTaskId: id });
const RV_STATES = {
  agent: () => reviewAgent,
  tests: () => bgShell('bt1', 'npm test'),
  dotnet: () => bgShell('bt2', 'dotnet run --project src/Api'),
  compose: () => bgShell('bt3', 'docker compose up'),
  uvicorn: () => bgShell('bt4', 'uvicorn app:app --reload'),
  hugo: () => bgShell('bt5', 'hugo server -D'),
  monitor: () => monitor('toolu_mo8', 'bk8'),
  resumed: () => [...reviewEnded, ...sendMessage('toolu_sm8', 'a94802108a39744a2')],
  big: () => [...reviewAgent, ...filler()],
};
test('guard-stop-contract: a hand-back waits on a person whatever else runs, and a server is no work that ends (2.1.6 re-verify N-B2)', () => {
  const passed = [];
  for (const [state, rows] of Object.entries(RV_STATES)) {
    for (const [id, text] of [...REVERIFY_STALLS, ...CYRILLIC_STALLS]) if (closeOver(`nb2-${id}-${state}`, rows(), text).status !== 2) passed.push(`${id}/${state}`);
  }
  for (const [id, text] of CYRILLIC_STALLS) if (closeOver(`nb2-${id}-none`, fgBash, text).status !== 2) passed.push(`${id}/none`);
  assert.deepStrictEqual(passed, [], 'a stall passed');
});
test('guard-stop-contract: a wait on the session\'s own running work is still a status line, in English, Ukrainian and Russian (2.1.6 re-verify N-B2, N4)', () => {
  const live = ['agent', 'tests', 'monitor', 'resumed'];
  const idle = { none: () => fgBash, dotnet: RV_STATES.dotnet, compose: RV_STATES.compose, uvicorn: RV_STATES.uvicorn, hugo: RV_STATES.hugo };
  for (const [id, text] of [...REVERIFY_STATUS, ['P1', RUNNING_CLOSE], ['P2', WAITING_CLOSE], ...CYRILLIC_STATUS]) {
    for (const state of live) assert.equal(closeOver(`st-${id}-${state}`, RV_STATES[state](), text).status, 0, `${id} under ${state}`);
    for (const [state, rows] of Object.entries(idle)) assert.equal(closeOver(`st-${id}-${state}`, rows(), text).status, 2, `${id} with only ${state}`);
  }
});

// 2.1.6 re-verify 2: 37 closes x 14 transcript states, the reviewer's cells. R2-B1: a hand-back the pending parser
// cannot see ('Push when you approve', 'I need your go-ahead', 'awaiting a review from you') passed under any live work,
// and a background server the never-ends list did not name held the exemption open. R2-M1: a hand-back beside a job
// noun ('The build is still running; awaiting your approval') passed through the text exemptions in every state. R2-M2:
// the first-person past ('Сделал', 'Зробив', 'Закоммитил') is how a Ukrainian or Russian close reports done. R2-m3: a
// wait on the stack's own seats ('the designer's plan') is a wait on running work.
const R2_HANDBACKS = [
  ['HB1', 'Task 3 is done and the review agent is still running. Push when you approve.'],
  ['HB2', 'Task 3 is done and the review agent is still running. I need your go-ahead to push.'],
  ['HB3', 'Task 3 is done and the review agent is still running. Your approval is needed before I push.'],
  ['HB4', 'Task 3 is done and the review agent is still running. Say the word and I push.'],
  ['HB5', 'Task 3 is done and the review agent is still running. Confirm and I push.'],
  ['HB6', 'Task 3 is done. Waiting on the review agent, then on your approval to push.'],
  ['HB7', 'Task 3 is done. Awaiting a review from you before I push.'],
  ['HB8', 'Task 3 is done. Awaiting review before I push.'],
  ['HB9', 'Task 3 is done. Waiting for them to sign off.'],
  ['HB10', 'Task 3 is done. Waiting for it to be approved.'],
  ['HB11', "Task 3 is done. Awaiting the user's review."],
  ['HB12', 'Task 3 is done. Waiting for the results of your manual test.'],
  ['HB13', "Задача 3 готова, агент рев'ю ще працює. Пуш після твого схвалення."],
  ['HB14', 'Задача 3 готова, агент ревью ещё работает. Пушну, когда подтвердишь.'],
  ['HB15', "Задача 3 готова. Чекаю на рев'ю від тебе."],
  ['HB16', 'Задача 3 готова. Жду ревью от тебя.'],
  ['PR1', 'Task 3 is done. The build is still running; awaiting your approval to push.'],
  ['PR2', 'Task 3 is done and the dev server runs in the background. Next step: push when you say so.'],
  ['PR3', 'All tests pass. CI is still running. Next steps: merge when you are ready.'],
  ['PR4', 'Task 3 is done; tests are queued in CI. Awaiting your go-ahead to merge.'],
  ['CY1', 'Сделал задачу 3. Жду твоего решения по push.'],
  ['CY2', 'Зробив задачу 3. Чекаю на твоє рішення щодо push.'],
  ['CY3', 'Закоммитил. Следующий шаг: пуш.'],
  ['CY4', 'Закомітив. Наступний крок: пуш.'],
  ['CY5', 'Всё сделал, жду решения по пушу.'],
  ['CY6', 'Виконав задачу 3. Залишилось запушити.'],
  ['CY7', 'Закончил миграцию. Осталось задеплоить.'],
  ['CY8', 'Готово. Далі - пуш, коли скажеш.'],
];
const R2_STATUS = [
  ['SN1', "Task 3 is done. Awaiting the designer's plan."],
  ['SN2', 'Task 3 is done. Waiting on the diagnoser.'],
  ['SN3', "Task 3 is done. Waiting for the gatherer's digest."],
  ['SN4', "Task 3 is done. Awaiting the verifier's answer."],
  ['ST1', 'Task 3 is done. Waiting on the test run to finish.'],
  ['P5', 'Task 3 is done; the review agent is still running, waiting on its report.'],
  ['P6', 'Task 3 is done. Awaiting its verdict before task 4.'],
  ['P1', RUNNING_CLOSE],
  ['P2', WAITING_CLOSE],
];
const R2_SERVERS = ['python manage.py runserver', 'docker run -p 8080:80 nginx', 'kubectl port-forward svc/api 8080:80', 'npx jest --watchAll',
  'npx tsc -w', 'npx vite', 'kubectl logs -f deploy/api', 'node app.js', 'ngrok http 3000', 'ng test'];
const R2_STATES = {
  none: () => fgBash,
  agent: () => reviewAgent,
  tests: () => bgBash('toolu_r2t', 'br2t'),
  dev: () => devServer,
  ...Object.fromEntries(R2_SERVERS.map((command, i) => [command, () => bgShell(`br2s${i}`, command)])),
};
test('guard-stop-contract: 37 closes in 14 states - a hand-back blocks whatever runs, a wait on finite work passes only while it runs (2.1.6 re-verify 2 R2-B1, R2-M1, R2-M2, R2-m3)', () => {
  assert.equal(Object.keys(R2_STATES).length, 14);
  assert.equal(R2_HANDBACKS.length + R2_STATUS.length, 37);
  const wrong = [];
  for (const [state, rows] of Object.entries(R2_STATES)) {
    const live = state === 'agent' || state === 'tests';
    for (const [id, text] of R2_HANDBACKS) if (closeOver(`r2-${id}-${state.replace(/\W+/g, '-')}`, rows(), text).status !== 2) wrong.push(`${id}/${state} passed`);
    for (const [id, text] of R2_STATUS) {
      const status = closeOver(`r2-${id}-${state.replace(/\W+/g, '-')}`, rows(), text).status;
      if (status !== (live ? 0 : 2)) wrong.push(`${id}/${state} ${status === 0 ? 'passed' : 'blocked'}`);
    }
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 518 cells wrong`);
});

// 2.1.6 re-verify 3 R3-M2: a done close that hands the next act back with no pending word ('Push when you approve.')
// passed in every state - the 'ready to commit when you say so' stall the contract exists for. R3-m2: a hand-back in
// words no list named ('over to you', 'the push is yours', 'за тобою') passed while the session's own finite work ran.
// R3-m3: seven status closes were read as hand-backs under live work ('tell me' in a clause about the verifier, 'your'
// before a noun that is no approval, 'by the user' after 'requested', a hyphenated 'Pick-up').
const R3_DONE_HANDBACKS = [
  ['P1', 'Task 3 is done. Push when you approve.'],
  ['P2', 'Task 3 is done. I need your go-ahead to push.'],
  ['P3', 'Task 3 is done. The push is yours.'],
  ['P4', 'Готово. Запушу, коли підтвердиш.'],
  ['P5', 'Сделал. Пушу после твоего одобрения.'],
];
const R3_PAST_REPORTS = [['PP1', 'Pushed after your approval.'], ['PP2', 'Запушив після твого схвалення.']];
const R3_HANDBACK_WORDS = [
  ['N1', 'Over to you for the push'], ['N2', 'The push is yours'], ['N3', 'Ping me when to push'], ['N4', 'Ready to push on your signal'],
  ['N5', 'The push waits on you'], ['N6', 'Push is blocked on you'], ['N7', 'Your move on the push'], ['N8', 'Push once you have looked it over'],
  ['N9', 'The ball is in your court for the push'], ['N10', 'Push after your look'],
  ['N11', 'Далі - за тобою'], ['N12', 'Дальше - за тобой'], ['N13', 'Твій хід щодо пушу'], ['N14', 'Дай знать - и я запушу'],
  ['N15', 'Скажи - і я запушу'], ['N16', 'Напиши, коли пушити'], ['N17', 'Пуш за тобой'], ['N18', 'Запушу после твоего апрува'],
  ['N19', 'Пушну після твого ок'], ['N20', 'Пушить - на твоё усмотрение'],
];
const R3_STATUS = [
  ['S1', 'Waiting on the verifier.'],
  ['S2', 'Waiting on the verifier - it will tell me if anything is off.'],
  ['S3', 'Waiting on the review agent to finish.'],
  ['S4', 'Waiting on the run of your test suite.'],
  ['S5', 'Waiting on the test run.'],
  ['S6', "Waiting on the auditor's report on your input handling."],
  ['S7', 'Waiting on the test run requested by the user.'],
  ['S8', 'Waiting on the review agent. Pick-up of task 4 starts after it reports.'],
  ['S9', 'The review agent is still running; I read its report next.'],
  ['S10', 'Waiting on the verifier to finish your review checklist.'],
  ['S11', "Чекаю на звіт агента рев'ю."],
  ['S12', 'Жду отчёт агента по вашему ревью.'],
  ['S13', 'Жду, пока агент закончит ревью.'],
];
test('guard-stop-contract: a done close handing the next act back blocks in all 14 states, a past report passes (2.1.6 re-verify 3 R3-M2)', () => {
  const wrong = [];
  for (const [state, rows] of Object.entries(R2_STATES)) {
    const tag = state.replace(/\W+/g, '-');
    for (const [id, text] of R3_DONE_HANDBACKS) if (closeOver(`r3-${id}-${tag}`, rows(), text).status !== 2) wrong.push(`${id}/${state} passed`);
    for (const [id, text] of R3_PAST_REPORTS) if (closeOver(`r3-${id}-${tag}`, rows(), text).status !== 0) wrong.push(`${id}/${state} blocked`);
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 98 cells wrong`);
});
test('guard-stop-contract: a hand-back in any of 20 wordings blocks under live work (2.1.6 re-verify 3 R3-m2)', () => {
  const wrong = [];
  for (const state of ['agent', 'tests', 'none']) {
    for (const [id, text] of R3_HANDBACK_WORDS) {
      const close = `Task 3 is done and the review agent is still running. ${text}.`;
      if (closeOver(`r3-${id}-${state}`, R2_STATES[state](), close).status !== 2) wrong.push(`${id}/${state} passed`);
    }
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 60 cells wrong`);
});
test('guard-stop-contract: a status close on running work passes under live work (2.1.6 re-verify 3 R3-m3)', () => {
  const wrong = [];
  for (const state of ['agent', 'tests']) {
    for (const [id, text] of R3_STATUS) if (closeOver(`r3-${id}-${state}`, R2_STATES[state](), `Task 3 is done. ${text}`).status !== 0) wrong.push(`${id}/${state} blocked`);
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 26 cells wrong`);
});
// 2.1.6 re-verify 4 R4-M3: 'ping me', 'let me know' and the Russian and Ukrainian forms read as a hand-back whatever
// followed, so a finished answer signing off with an OFFER ('Ping me if anything looks off.') was blocked in every state
// and had to be rewritten. What follows an offer word (if / in case / how / what / whether / about) is no pending act;
// a condition with when / once / after still hands the next act back.
const R4_SIGN_OFFS = [
  ['O1', 'All done. Ping me if anything looks off.'],
  ['O2', 'All done. Ping me if you want changes.'],
  ['O3', 'All done. Feel free to ping me if something looks wrong.'],
  ['O4', 'All done. Let me know how the review goes.'],
  ['O5', 'All done. Ping me about anything that looks off.'],
  ['O6', 'Готово. Дай знати, якщо щось не так.'],
  ['O7', 'Сделал. Напиши, если что-то не так.'],
  ['O8', 'Готово. Скажи, якщо потрібні зміни.'],
  ['O9', 'Task 3 is done. Tell me what you think of the naming.'],
];
const R4_STILL_HANDBACKS = [
  ['H1', 'Task 3 is done. Ping me when you are ready to push.'],
  ['H2', 'Task 3 is done. Let me know when to push.'],
  ['H3', 'Task 3 is done. Let me know once you have looked it over.'],
  ['H4', 'Готово. Дай знати, коли пушити.'],
  ['H5', 'Сделал. Напиши, когда пушить.'],
  ['H6', 'Task 3 is done. Ping me after your review.'],
  // 'whether to' / 'how to' / 'what to' ask for the decision itself: the offer words hand back before an infinitive
  ['H7', 'Task 3 is done. Tell me whether to push.'],
  ['H8', 'Task 3 is done. Let me know how to proceed.'],
  ['H9', 'Task 3 is done. Tell me what to do next.'],
  ['H10', 'Готово. Скажи, чи пушити.'],
];
test('guard-stop-contract: a finished answer signing off with an offer passes, a hand-back with a condition still blocks (2.1.6 re-verify 4 R4-M3)', () => {
  const wrong = [];
  for (const [state, rows] of Object.entries(R2_STATES)) {
    const tag = state.replace(/\W+/g, '-');
    for (const [id, text] of R4_SIGN_OFFS) if (closeOver(`r4-${id}-${tag}`, rows(), text).status !== 0) wrong.push(`${id}/${state} blocked`);
    for (const [id, text] of R4_STILL_HANDBACKS) if (closeOver(`r4-${id}-${tag}`, rows(), text).status !== 2) wrong.push(`${id}/${state} passed`);
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} cells wrong`);
});
// 2.1.6 re-verify 3 R3-m11: the reader saw the last 1,500 characters, so a done claim further up hid the stall.
test('guard-stop-contract: the done half is read over the whole close (2.1.6 re-verify 3 R3-m11)', () => {
  const pad = (n) => ' The migration notes are in the plan file.'.repeat(n);
  for (const n of [30, 40, 60, 300]) {
    const text = `Task 3 is done.${pad(n)} Next step: push when you say so.`;
    assert.equal(closeOver(`r3-win-${n}`, fgBash, text).status, 2, `a done claim ${text.length} characters up`);
  }
});

// Speech-direct sessions (2026-09-28), each close verbatim or its load-bearing clause.
test('guard-stop-contract: a bare \'remains\' is a status, only its pending forms are a step (8b5dcb1a)', () => {
  assert.equal(close('Done - `playwright-chrome` removed from `.mcp.json` and `enabledMcpjsonServers`; only `sentry` remains.').status, 0,
    'what is left installed is no pending step');
  assert.equal(close('Done. The push remains to be done.').status, 2, "'remains to be done' is pending");
  assert.equal(close('Task 3 is done. What remains is the docs update.').status, 2, "'what remains' is pending");
  assert.equal(close('Lint is green. That still remains open: the migration.').status, 2, "'remains open' is pending");
});

test('guard-stop-contract: a wait on forks, subagents or workers is a wait on work (177c5743)', () => {
  const text = 'Packages page audit done. Plan at `confluence-packages-update.md` (5 tasks). Waiting on the other 3 forks (stale-archive triage, extension-bundling page, Guide).';
  assert.equal(closeOver('fork-live', asyncAgent('toolu_fk1', 'af1'), text).status, 0, 'the measured close, its forks still out');
  assert.equal(closeOver('fork-sub', asyncAgent('toolu_fk2', 'af2'), 'Task 2 is done. Waiting on the two subagents.').status, 0, 'subagents');
  assert.equal(closeOver('fork-wrk', asyncAgent('toolu_fk3', 'af3'), 'Task 2 is done. Waiting for the workers to report.').status, 0, 'workers');
  assert.equal(closeOver('fork-none', fgBash, text).status, 2, 'nothing out - the same close is a stall');
  assert.equal(closeOver('fork-hb', asyncAgent('toolu_fk4', 'af4'), 'All 7 plans are done, waiting on your go-ahead.').status, 2,
    'the hand-back beside a live fork still blocks (177c5743 L587)');
});

test('guard-stop-contract: a queued notice has not ended the work, the delivered one has (177c5743)', () => {
  const body = '<task-id>aq1</task-id>\n<tool-use-id>toolu_q1</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>';
  const enqueue = { type: 'queue-operation', operation: 'enqueue', content: `<task-notification>\n${body}\n</task-notification>` };
  const text = 'Localisation audit done. Last Phase 2 fork still running, nothing pending on your end.';
  assert.equal(closeOver('q-enq', [...asyncAgent('toolu_q1', 'aq1'), enqueue], text).status, 0, 'queued, not yet delivered');
  assert.equal(closeOver('q-dlv', [...asyncAgent('toolu_q1', 'aq1'), enqueue, notice(body)], text).status, 2, 'delivered - the fork is done');
  const removed = { type: 'queue-operation', operation: 'remove', content: `<task-notification>\n${body}\n</task-notification>` };
  assert.equal(closeOver('q-rm', [...asyncAgent('toolu_q1', 'aq1'), removed], text).status, 2, 'any other queue operation still delivers');
});

// ---------------------------------------------------------------------------------------------
// 3. fresh-offer-phrase-exempt - the offer skipped itself on any mention of the phrase
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: only a close that OFFERS the fresh session skips the offer', () => {
  const at = (name, ctx, text) => transcript(name, ctxRows(name, ctx, text));
  const stop = (tp) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, { env: logEnv() }).status;

  assert.equal(stop(at('fx-mention', 500000,
    'The audit is written to docs/audit.md. Worth auditing this run itself later from a fresh session, with the transcript open.')), 2,
    'a close that merely NAMES a fresh session skipped its own overdue offer: 9 messages and 5.08M cache-read followed');
  assert.equal(stop(at('fx-offer', 500000,
    'Done. Worth continuing in a fresh session from the plan file.')), 0,
    'a close that offers to continue THIS work there is left alone');
  assert.equal(stop(at('fx-resume', 500000,
    'Task 4 landed. Resume in a fresh session with the block below and I pick up at task 5.')), 0,
    'the mandated resume wording is an offer');
  assert.equal(stop(at('fx-run', 500000, 'Run `/alfred-code:capture-architecture` in a new session - answer refresh there.')), 0,
    "the imperative 'Run ... in a new session' hands the work over (8b5dcb1a)");
  assert.equal(stop(at('fx-run-noun', 500000, 'The audit is written. A separate run from a fresh session would be worth it later.')), 2,
    "'run' as a noun only recommends");
});

// 8b5dcb1a: a skill's own gate asked the fresh-session choice, the user answered, and the block forced the same ask again.
test('guard-stop-contract: a fresh-session ask answered this turn is not asked again', () => {
  const stop = (tp) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, { env: logEnv() }).status;
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const ask = (id, question, labels) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'AskUserQuestion',
    input: { questions: [{ question, header: 'Session choice', multiSelect: false, options: labels.map((label) => ({ label, description: 'x' })) }] } }] } });
  const answer = (id, picked) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
    content: `Your questions have been answered: "Where should the capture run?"="${picked}". You can now continue with these answers in mind.` }] } });
  const floor = assistantRow('fa-floor', 'the first turn', { cache_creation_input_tokens: 20000 });
  const closeRow = (text) => assistantRow('fa-close', text, { cache_read_input_tokens: 500000 });
  const CLOSE = 'Acknowledged - the capture goes ahead where you picked.';
  const fresh = (name, ...rows) => stop(transcript(name, [floor, typed('capture the architecture'), ...rows, closeRow(CLOSE)]));
  assert.equal(fresh('fa-answered', ask('t1', 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here anyway']), answer('t1', 'Fresh session (Recommended)')), 0,
    'the answered fresh-session ask settles it');
  assert.equal(fresh('fa-continue', ask('t2', 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here anyway']), answer('t2', 'Continue here anyway')), 0,
    "'continue here' is an answer too");
  assert.equal(fresh('fa-question', ask('t3', 'Start a new session for the capture?', ['Yes (Recommended)', 'No']), answer('t3', 'No')), 0, 'the phrase in the question');
  // the nearby stalls still get the offer
  assert.equal(fresh('fa-other', ask('t4', 'Which module first?', ['Api (Recommended)', 'Web']), answer('t4', 'Api (Recommended)')), 2, 'an unrelated ask');
  assert.equal(fresh('fa-open', ask('t5', 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here'])), 2, 'an ask never answered');
  assert.equal(stop(transcript('fa-earlier', [floor, ask('t6', 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here']),
    answer('t6', 'Continue here'), typed('now the next module'), closeRow(CLOSE)])), 2, 'an ask answered in an EARLIER turn');
  const feedback = typed('Stop hook feedback:\n[guard-stop-contract.js]: The work in this turn is finished ...');
  assert.equal(fresh('fa-after-block', feedback, ask('t7', 'Where should we continue?', ['Resume in a fresh session (Recommended)', 'Continue here']),
    answer('t7', 'Continue here')), 0, "the hook's own feedback row is no typed prompt");
});

// ---------------------------------------------------------------------------------------------
// 4. stop-denial-stale-150k - the denial printed a number that was not this session's trigger
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: the prose-ask denial quotes the session\'s own carry and trigger', () => {
  const tp = transcript('denial-num', ctxRows('denial-num', 266711, 'Patch is ready. Say the word and I will push it.'));
  const r = runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: logEnv({ CLAUDE_CONFIG_DIR: accountDir('denial-1m', 'claude-opus-5') }) });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /~150k/, 'the hardcoded 150k told a 1M-window session the opposite of its real trigger');
  assert.match(r.stderr, /267k/, "the session's own measured carry");
  assert.match(r.stderr, /400k/, "... and the trigger this window actually uses");
});

// ---------------------------------------------------------------------------------------------
// 5 + 6 + 7. the AskUserQuestion branch: absolute numbers, the long-run route, mid-turn prose,
//            and the solve-task stop fields. Injection only - every path here exits 0 (the ask's own house voice is the one deny).
// ---------------------------------------------------------------------------------------------
const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
const askIn = (tp, questions, env) => runIn('guard-stop-contract.js',
  { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', transcript_path: tp, tool_input: { questions } },
  { env: env || logEnv() });
const oneQ = [{ question: 'Which next?', options: [{ label: 'Continue', description: 'carry on here' }, { label: 'Stop', description: 'hold' }] }];
const ts = (h) => new Date(Date.UTC(2026, 8, 20, h, 0, 0)).toISOString();

test('guard-stop-contract: the fresh-session note carries the two absolute numbers, not a ratio', () => {
  const tp = transcript('ask-nums', [
    assistantRow('nf', 'the first turn', { cache_creation_input_tokens: 90000 }),
    assistantRow('nc', 'ok', { cache_read_input_tokens: 500000 }),
  ]);
  const note = ctxOf(askIn(tp, oneQ, logEnv({ CLAUDE_CONFIG_DIR: accountDir('ask-1m', 'claude-opus-5') })));
  assert.match(note, /500k/, 'the carry this session pays per message');
  assert.match(note, /90k/, "this session's own cold floor - the number a resume restarts at");
  assert.match(note, /400k/, 'and the trigger it crossed');
  assert.doesNotMatch(note, /80-105k/, 'the generic range is gone - the skill step needs THIS session\'s numbers');
});

test('guard-stop-contract: a long or idle run offers the fresh session before the context trigger', () => {
  // Measured: 12 asks over 3h+ and a 2-day idle gap carried no fresh-session option and the resume
  // re-carried ~346k; the skill's own 'spans hours / resumes after an idle gap' clause is prose and
  // slipped in 3 of 3 bundles that tested it. The context trigger is untouched - this is the second
  // route to the same note, and it never denies.
  const rows = (name, hours, ctx) => transcript(name, [
    { ...assistantRow(`${name}-f`, 'the first turn', { cache_creation_input_tokens: 20000 }), timestamp: ts(0) },
    { ...assistantRow(name, 'ok', { cache_read_input_tokens: ctx }), timestamp: ts(hours) },
  ]);
  const long = ctxOf(askIn(rows('ask-long', 5, 120000), oneQ));
  assert.match(long, /resume in a fresh session/i, 'a five-hour cycle at 120k - under every trigger - is offered the resume');
  assert.match(long, /5\.0h/, '... and the note names the span it fired on');
  assert.equal(ctxOf(askIn(rows('ask-short', 1, 120000), oneQ)), '', 'a one-hour session is left alone');
  assert.equal(ctxOf(askIn(rows('ask-off', 5, 120000), oneQ, logEnv({ ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '0' }))), '',
    '0 on the hours knob switches the route off');
  // The recoverable-share rule owns this route too: a carry that is mostly the install's own floor
  // buys nothing by resuming, however long the session has been open.
  const floorBound = transcript('ask-floorbound', [
    { ...assistantRow('fb-f', 'the first turn', { cache_creation_input_tokens: 100000 }), timestamp: ts(0) },
    { ...assistantRow('fb', 'ok', { cache_read_input_tokens: 120000 }), timestamp: ts(6) },
  ]);
  assert.equal(ctxOf(askIn(floorBound, oneQ)), '', 'six hours whose carry is 83% cold floor is not worth a resume');
});

test('guard-stop-contract: the prose written before an ask is checked for house voice', () => {
  // guard-answer-length.js reads the turn's FINAL text only, so prose that ends on a tool call is
  // never scanned: measured 5 em-dashes in a report that preceded an AskUserQuestion, plus two more
  // bundles. This is the injection-only surface that reaches it - it never denies.
  const withDash = transcript('ask-dash', [
    { type: 'user', message: { role: 'user', content: 'run the update' } },
    assistantRow('d1', 'The refresh landed — no migrations, prune list empty.', { cache_read_input_tokens: 900 }),
  ]);
  assert.match(ctxOf(askIn(withDash, oneQ)), /before the ask just answered carries an em-dash/i, 'the mid-turn em-dash is named, for the rest of the turn');
  const clean = transcript('ask-clean', [
    { type: 'user', message: { role: 'user', content: 'run the update' } },
    assistantRow('c1', 'The refresh landed - no migrations, prune list empty.', { cache_read_input_tokens: 900 }),
  ]);
  assert.equal(ctxOf(askIn(clean, oneQ)), '', 'a single dash in the same sentence emits nothing at all');
  // and the turn boundary holds: an em-dash from a PREVIOUS turn is not this turn's to fix
  const older = transcript('ask-older', [
    assistantRow('o1', 'An older answer — with a dash.', { cache_read_input_tokens: 900 }),
    { type: 'user', message: { role: 'user', content: 'now do the next one' } },
    assistantRow('o2', 'Applied it; the suite is green.', { cache_read_input_tokens: 900 }),
  ]);
  assert.equal(ctxOf(askIn(older, oneQ)), '', "a previous turn's dash is not re-raised");
});

test('guard-stop-contract: a solve-task stop is reminded of its three named fields', () => {
  // Measured across the collection: 13 sessions loaded the Result / Progress / Leftovers stop
  // contract, 5 used the fields even once, across 109 asks - one session missed all 12 of its stops.
  const cycle = (name, text) => transcript(name, [
    { type: 'user', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } },
    assistantRow(name, text, { cache_read_input_tokens: 900 }),
  ]);
  assert.match(ctxOf(askIn(cycle('sf-bare', 'Task 2 landed, tests green.'), oneQ)), /Result:.*Progress:.*Leftovers:/s,
    'a solve-task stop with no fields anywhere is reminded');
  assert.equal(ctxOf(askIn(cycle('sf-fields',
    'Result:    task 2 landed - docs/plans/csv.md\nProgress:  4 of 6 steps\nLeftovers: none'), oneQ)), '',
    'the stamped fields clear it');
  assert.equal(ctxOf(askIn(cycle('sf-bold',
    '**Result:** task 2 landed\n**Progress:** 4 of 6 steps\n**Leftovers:** none'), oneQ)), '',
    'the markdown-bold variant 5 of 13 sessions actually wrote satisfies the format');
  // M7 (Task 22 fix round 1): on the plugin route the slash command is recorded with its plugin prefix.
  const prefixed = transcript('sf-plugin', [
    { type: 'user', message: { role: 'user', content: '<command-name>/alfred-code:task-solve</command-name>' } },
    assistantRow('sf-plugin', 'Task 2 landed, tests green.', { cache_read_input_tokens: 900 }),
  ]);
  assert.match(ctxOf(askIn(prefixed, oneQ)), /Result:.*Progress:.*Leftovers:/s,
    'a plugin-prefixed solve-task slash command is a solve-task cycle too');
  const notACycle = transcript('sf-none', [
    { type: 'user', message: { role: 'user', content: 'fix the failing test' } },
    assistantRow('n1', 'Fixed it; the suite is green.', { cache_read_input_tokens: 900 }),
  ]);
  assert.equal(ctxOf(askIn(notACycle, oneQ)), '', 'an ordinary session is never asked for a flow stamp it does not run');
});

// ---------------------------------------------------------------------------------------------
// 8. fresh-session-abandoned-run - a typed-then-abandoned slash command is not a finished run
// ---------------------------------------------------------------------------------------------
test('guard-fresh-session-start: an abandoned or double-submitted run is not a PRIOR run', () => {
  // Measured (AUDIT/_tools/dupslash.js): 7 of 115 sessions re-submitted an orchestration command
  // before any assistant turn. Worst case: a fresh post-`/clear` build resume was told to start a
  // fresh session, the user rejected it and quit - 0 of 2 tasks landed, 100% of 86.7k tokens wasted.
  const FLOOR = { cache_creation_input_tokens: 20000 };
  const COLD = { cache_read_input_tokens: 60000 };
  const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const cmd = (name) => userRow(`<command-name>/${name}</command-name>`);
  // The slash route is UserPromptExpansion (2.1.5 M14): the typed command arrives by name.
  const slash = (tp, skill) => {
    const name = skill || 'task-solve';
    const r = runIn('guard-fresh-session-start.js',
      { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: name, command_args: '', prompt: `/${name}`, transcript_path: tp },
      { env: logEnv() });
    assert.equal(r.status, 0, 'the slash route never denies');
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
  };

  assert.equal(slash(transcript('ab-dup', [
    cmd('alfred-code:setup'), cmd('alfred-code:update'),
  ]), 'alfred-code:update'), '', 'two commands 4s apart with NO assistant turn between them is one abandoned run');
  assert.equal(slash(transcript('ab-resume', [
    cmd('task-solve'), userRow('resume the build cycle, steps 1-3 are stamped'),
  ])), '', "a re-typed run the model never answered is not a run this session already made");

  // ... and the measured chain the trigger exists for still fires: a run, an ANSWER, then a second run.
  assert.match(slash(transcript('ab-real', [
    cmd('capture-architecture'),
    assistantRow('r1', 'Captured the architecture doc.', FLOOR),
    userRow('now run the task cycle'),
    assistantRow('r2', 'ok', COLD),
    cmd('task-solve'),
  ])), /ALREADY run one/i, 'a finished prior run, with the model\'s own turn in between, is still the measured chain');

  // `setup` is the guided install and `init` the bootstrap after it (Task 18a): both are
  // multi-phase runs, so both take the offer.
  for (const walk of ['alfred-code:init', 'alfred-code:setup'])
    assert.match(slash(transcript(`ab-${walk.split(':')[1]}`, [
      cmd('capture-architecture'),
      assistantRow('i1', 'Captured the architecture doc.', FLOOR),
      userRow('now install the stack'),
      assistantRow('i2', 'ok', COLD),
      cmd(walk),
    ]), walk), /ALREADY run one/i, `${walk} is a guided walk`);
});

// ---------------------------------------------------------------------------------------------
// 9 + 10. guard-answer-length: the verbatim re-ask, and the two Stop hooks no longer contradict
// ---------------------------------------------------------------------------------------------
const promptSubmit = (prompt, tp, env) => {
  const r = runIn('guard-answer-length.js', { hook_event_name: 'UserPromptSubmit', prompt, transcript_path: tp }, { env: env || logEnv() });
  assert.equal(r.status, 0, 'UserPromptSubmit never denies - a denial erases the prompt');
  return ctxOf(r);
};

test('guard-answer-length: a verbatim-repeated prompt is an ambiguity signal, not a re-answer', () => {
  // Measured in three sessions of one day: the user re-sent an identical question 2-3 times,
  // escalating /model and /effort between them, before the model asked what was meant.
  const q = 'do we need to update claude file according to alfred code?';
  const again = transcript('vr-again', [
    { type: 'user', message: { role: 'user', content: q } },
    assistantRow('v1', 'Here is a long answer about the file.'),
  ]);
  assert.match(promptSubmit(q, again), /VERBATIM RE-ASK[\s\S]*Ask ONE AskUserQuestion about the goal/,
    'the FIRST repeat is the signal - the measured sessions took three');
  // the prompt row is already on disk when UserPromptSubmit fires, so the current turn must not
  // read as its own repeat
  const onDisk = transcript('vr-ondisk', [
    { type: 'user', message: { role: 'user', content: 'something else entirely, at length' } },
    assistantRow('v2', 'answered'),
    { type: 'user', message: { role: 'user', content: q } },
  ]);
  assert.doesNotMatch(promptSubmit(q, onDisk), /VERBATIM RE-ASK/, 'a prompt seeing itself on disk is not a repeat');
  const different = transcript('vr-diff', [
    { type: 'user', message: { role: 'user', content: 'what does the docs hook actually gate?' } },
    assistantRow('v3', 'answered'),
  ]);
  assert.doesNotMatch(promptSubmit(q, different), /VERBATIM RE-ASK/, 'a different question is an ordinary turn');
  const short = transcript('vr-short', [
    { type: 'user', message: { role: 'user', content: 'continue' } },
    assistantRow('v4', 'ok'),
  ]);
  assert.doesNotMatch(promptSubmit('continue', short), /VERBATIM RE-ASK/, "a repeated 'continue' is pacing, not ambiguity");
});

test('guard-answer-length: the em-dash fix yields to a stop-contract block on the same turn', () => {
  // Measured: guard-answer-length's 'Re-send the SAME answer' and guard-stop-contract's 'Add
  // nothing else to this turn' answered ONE Stop event with opposite orders; the model obeyed the
  // second and the flagged text shipped uncorrected.
  const root = fs.mkdtempSync(path.join(TMP, 'conflict-'));
  const tp = transcript('conf', [
    { type: 'user', message: { role: 'user', content: 'wrap it up' } },
    assistantRow('c9', 'The work is finished — the suite is green.'),
  ]);
  const stopAnswer = () => runIn('guard-answer-length.js',
    { hook_event_name: 'Stop', session_id: 'conf', cwd: root, transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.claude/docs' } });

  const alone = stopAnswer();
  assert.equal(alone.status, 2, 'an em-dash still blocks');
  assert.match(alone.stderr, /Re-send the SAME answer/, 'and still asks for the same answer back');

  const ledger = path.join(root, '.claude', 'docs', 'hook-blocks');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'conf.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), hook: 'guard-stop-contract.js', event: 'Stop', reason: 'This turn ends on a decision-shaped question in prose.' }) + '\n');
  const together = stopAnswer();
  assert.equal(together.status, 2, 'the dash is still worth fixing');
  assert.match(together.stderr, /guard-stop-contract/, 'but the text names the hook that already blocked this turn');
  assert.match(together.stderr, /fold/i, '... and folds the fix into that turn instead of ordering the same answer back');
  assert.doesNotMatch(together.stderr, /Re-send the SAME answer/, 'the contradictory order is gone');

  const stale = JSON.stringify({ ts: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), hook: 'guard-stop-contract.js', event: 'Stop', reason: 'x' }) + '\n';
  fs.writeFileSync(path.join(ledger, 'conf.jsonl'), stale);
  assert.match(stopAnswer().stderr, /Re-send the SAME answer/, "an earlier turn's block is not this turn's");

  // Only a BLOCK yields. The contract also logs rows that block nothing - the two method probes and
  // the skip at a tool-ended turn - and the A/B's after arm lost its verification line when a fresh
  // log row read as a block: the model was told to obey a block it never received. The done-gate
  // probe is a Stop row written in this very turn, the closest shape to a real block.
  const now = new Date().toISOString();
  for (const row of [
    { ts: now, hook: 'guard-stop-contract.js', event: 'PostToolUseFailure', tool: 'Bash', mode: 'probe', kind: 'root-cause', reason: 'probe: a red npm test run' },
    { ts: now, hook: 'guard-stop-contract.js', event: 'Stop', tool: '', mode: 'probe', kind: 'done-gate', reason: 'probe: a done claim, unrun - logged, not held' },
    { ts: now, hook: 'guard-stop-contract.js', event: 'Stop', tool: '', mode: 'skip-tool-end', kind: 'tool-ended-turn', reason: 'skip: the turn ended on a tool call' },
  ]) {
    fs.writeFileSync(path.join(ledger, 'conf.jsonl'), JSON.stringify(row) + '\n');
    assert.match(stopAnswer().stderr, /Re-send the SAME answer/, `a '${row.mode}' row blocked nothing, so the dash order stands`);
  }

  // the LENGTH branch carries the same yield - 'Re-answer at budget' contradicts 'add nothing else'
  // exactly as the dash order did.
  const wall = transcript('conf-long', [
    { type: 'user', message: { role: 'user', content: 'wrap it up' } },
    assistantRow('c8', 'This is filler prose that says very little but goes on and on about the process. '.repeat(30)),
  ]);
  const longAnswer = () => runIn('guard-answer-length.js',
    { hook_event_name: 'Stop', session_id: 'conf', cwd: root, transcript_path: wall },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.claude/docs' } });
  assert.doesNotMatch(longAnswer().stderr, /blocked this same turn too/, 'a stale ledger leaves the length text alone');
  fs.writeFileSync(path.join(ledger, 'conf.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), hook: 'guard-stop-contract.js', event: 'Stop', reason: 'fresh-session offer' }) + '\n');
  const both = longAnswer();
  assert.equal(both.status, 2, 'the wall of text still blocks');
  assert.match(both.stderr, /blocked this same turn too/, '... and the two hooks now agree on one turn');
});
