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
// ... and a Claude Code session's own settings env reaches this process, so every window key is set to the seed an
// install writes (meta/environment.json): a tier left unset reads as ALFRED_CODE_CONTEXT_WINDOW_DEFAULT (the user's ruling
// of 2026-10-21), and a hand-set value would move every threshold assertion here.
Object.assign(process.env, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
  ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' });
delete process.env.ALFRED_CODE_AUTO_COMPACT;
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
// ends, so it held the exemption open for the rest of the session. The reviewer's closes and states, as fixtures.
const REVERIFY_STALLS = [
  ['X11', 'The fix is done and verified. Awaiting approval to commit.'],
  ['X12', 'Everything is ready - waiting for the go-ahead to push.'],
  ['X13', 'Migration done. Waiting on a decision about the schema.'],
  ['X14', 'Task 3 is done and the review agent is still running. Tell me whether to push.'],
  ['X18', 'Task 3 is done. Awaiting sign-off before I push.'],
  ['X19', 'Done - the reviewer is still running. Waiting for confirmation to merge.'],
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
    for (const [id, text] of REVERIFY_STALLS) if (closeOver(`nb2-${id}-${state}`, rows(), text).status !== 2) passed.push(`${id}/${state}`);
  }
  assert.deepStrictEqual(passed, [], 'a stall passed');
});
test('guard-stop-contract: a wait on the session\'s own running work is still a status line (2.1.6 re-verify N-B2)', () => {
  const live = ['agent', 'tests', 'monitor', 'resumed'];
  const idle = { none: () => fgBash, dotnet: RV_STATES.dotnet, compose: RV_STATES.compose, uvicorn: RV_STATES.uvicorn, hugo: RV_STATES.hugo };
  for (const [id, text] of [...REVERIFY_STATUS, ['P1', RUNNING_CLOSE], ['P2', WAITING_CLOSE]]) {
    for (const state of live) assert.equal(closeOver(`st-${id}-${state}`, RV_STATES[state](), text).status, 0, `${id} under ${state}`);
    for (const [state, rows] of Object.entries(idle)) assert.equal(closeOver(`st-${id}-${state}`, rows(), text).status, 2, `${id} with only ${state}`);
  }
});

// 2.1.6 re-verify 2: 37 closes x 14 transcript states, the reviewer's cells. R2-B1: a hand-back the pending parser
// cannot see ('Push when you approve', 'I need your go-ahead', 'awaiting a review from you') passed under any live work,
// and a background server the never-ends list did not name held the exemption open. R2-M1: a hand-back beside a job
// noun ('The build is still running; awaiting your approval') passed through the text exemptions in every state. R2-m3:
// a wait on the stack's own seats ('the designer's plan') is a wait on running work.
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
  ['PR1', 'Task 3 is done. The build is still running; awaiting your approval to push.'],
  ['PR2', 'Task 3 is done and the dev server runs in the background. Next step: push when you say so.'],
  ['PR3', 'All tests pass. CI is still running. Next steps: merge when you are ready.'],
  ['PR4', 'Task 3 is done; tests are queued in CI. Awaiting your go-ahead to merge.'],
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
test('guard-stop-contract: 25 closes in 14 states - a hand-back blocks whatever runs, a wait on finite work passes only while it runs (2.1.6 re-verify 2 R2-B1, R2-M1, R2-M2, R2-m3)', () => {
  assert.equal(Object.keys(R2_STATES).length, 14);
  assert.equal(R2_HANDBACKS.length + R2_STATUS.length, 25);
  const wrong = [];
  for (const [state, rows] of Object.entries(R2_STATES)) {
    const live = state === 'agent' || state === 'tests';
    for (const [id, text] of R2_HANDBACKS) if (closeOver(`r2-${id}-${state.replace(/\W+/g, '-')}`, rows(), text).status !== 2) wrong.push(`${id}/${state} passed`);
    for (const [id, text] of R2_STATUS) {
      const status = closeOver(`r2-${id}-${state.replace(/\W+/g, '-')}`, rows(), text).status;
      if (status !== (live ? 0 : 2)) wrong.push(`${id}/${state} ${status === 0 ? 'passed' : 'blocked'}`);
    }
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 350 cells wrong`);
});

// 2.1.6 re-verify 3 R3-M2: a done close that hands the next act back with no pending word ('Push when you approve.')
// passed in every state - the 'ready to commit when you say so' stall the contract exists for. R3-m2: a hand-back in
// words no list named ('over to you', 'the push is yours') passed while the session's own finite work ran.
// R3-m3: seven status closes were read as hand-backs under live work ('tell me' in a clause about the verifier, 'your'
// before a noun that is no approval, 'by the user' after 'requested', a hyphenated 'Pick-up').
const R3_DONE_HANDBACKS = [
  ['P1', 'Task 3 is done. Push when you approve.'],
  ['P2', 'Task 3 is done. I need your go-ahead to push.'],
  ['P3', 'Task 3 is done. The push is yours.'],
];
const R3_PAST_REPORTS = [['PP1', 'Pushed after your approval.']];
const R3_HANDBACK_WORDS = [
  ['N1', 'Over to you for the push'], ['N2', 'The push is yours'], ['N3', 'Ping me when to push'], ['N4', 'Ready to push on your signal'],
  ['N5', 'The push waits on you'], ['N6', 'Push is blocked on you'], ['N7', 'Your move on the push'], ['N8', 'Push once you have looked it over'],
  ['N9', 'The ball is in your court for the push'], ['N10', 'Push after your look'],
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
];
test('guard-stop-contract: a done close handing the next act back blocks in all 14 states, a past report passes (2.1.6 re-verify 3 R3-M2)', () => {
  const wrong = [];
  for (const [state, rows] of Object.entries(R2_STATES)) {
    const tag = state.replace(/\W+/g, '-');
    for (const [id, text] of R3_DONE_HANDBACKS) if (closeOver(`r3-${id}-${tag}`, rows(), text).status !== 2) wrong.push(`${id}/${state} passed`);
    for (const [id, text] of R3_PAST_REPORTS) if (closeOver(`r3-${id}-${tag}`, rows(), text).status !== 0) wrong.push(`${id}/${state} blocked`);
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 56 cells wrong`);
});
test('guard-stop-contract: a hand-back in any of 10 wordings blocks under live work (2.1.6 re-verify 3 R3-m2)', () => {
  const wrong = [];
  for (const state of ['agent', 'tests', 'none']) {
    for (const [id, text] of R3_HANDBACK_WORDS) {
      const close = `Task 3 is done and the review agent is still running. ${text}.`;
      if (closeOver(`r3-${id}-${state}`, R2_STATES[state](), close).status !== 2) wrong.push(`${id}/${state} passed`);
    }
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 30 cells wrong`);
});
test('guard-stop-contract: a status close on running work passes under live work (2.1.6 re-verify 3 R3-m3)', () => {
  const wrong = [];
  for (const state of ['agent', 'tests']) {
    for (const [id, text] of R3_STATUS) if (closeOver(`r3-${id}-${state}`, R2_STATES[state](), `Task 3 is done. ${text}`).status !== 0) wrong.push(`${id}/${state} blocked`);
  }
  assert.deepStrictEqual(wrong, [], `${wrong.length} of 20 cells wrong`);
});
// 2.1.6 re-verify 4 R4-M3: 'ping me', 'let me know' and the Ukrainian forms read as a hand-back whatever
// followed, so a finished answer signing off with an OFFER ('Ping me if anything looks off.') was blocked in every state
// and had to be rewritten. What follows an offer word (if / in case / how / what / whether / about) is no pending act;
// a condition with when / once / after still hands the next act back.
const R4_SIGN_OFFS = [
  ['O1', 'All done. Ping me if anything looks off.'],
  ['O2', 'All done. Ping me if you want changes.'],
  ['O3', 'All done. Feel free to ping me if something looks wrong.'],
  ['O4', 'All done. Let me know how the review goes.'],
  ['O5', 'All done. Ping me about anything that looks off.'],
  ['O9', 'Task 3 is done. Tell me what you think of the naming.'],
];
const R4_STILL_HANDBACKS = [
  ['H1', 'Task 3 is done. Ping me when you are ready to push.'],
  ['H2', 'Task 3 is done. Let me know when to push.'],
  ['H3', 'Task 3 is done. Let me know once you have looked it over.'],
  ['H6', 'Task 3 is done. Ping me after your review.'],
  // 'whether to' / 'how to' / 'what to' ask for the decision itself: the offer words hand back before an infinitive
  ['H7', 'Task 3 is done. Tell me whether to push.'],
  ['H8', 'Task 3 is done. Let me know how to proceed.'],
  ['H9', 'Task 3 is done. Tell me what to do next.'],
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

// A consuming project's sessions (2026-09-28), each close verbatim or its load-bearing clause.
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
  assert.equal(stop(at('fx-run', 500000, 'Run `/alfred-code:capture-awareness` in a new session - answer refresh there.')), 0,
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
  // An ask answered in an EARLIER turn counts as the last offer at the carry it was made at (audit 2026-10-11 SD11,
  // 7f8803eb: 'Continue in fresh session' answered at 435.6k, the next turn's close carrying the asked-for resume prompt
  // was blocked at 438.8k and the re-ask denied by the user): re-offered only past the 1.5x re-offer step.
  const askAt = (id, ctx) => { const row = ask(id, 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here']); row.message.usage = { cache_read_input_tokens: ctx }; return row; };
  assert.equal(stop(transcript('fa-earlier', [floor, askAt('t6', 200000), answer('t6', 'Continue here'), typed('now the next module'), closeRow(CLOSE)])), 2,
    'an ask answered in an EARLIER turn at well under the carry: offered again');
  assert.equal(stop(transcript('fa-earlier-near', [floor, askAt('t8', 435642), answer('t8', 'Fresh session (Recommended)'), typed('create me a prompt for the next session'), closeRow(CLOSE)])), 0,
    '7f8803eb: answered one typed turn back at nearly this carry - not asked again');
  assert.equal(stop(transcript('fa-earlier-bare', [floor, ask('t9', 'Where should the capture run?', ['Fresh session (Recommended)', 'Continue here']), answer('t9', 'Continue here'), typed('next'), closeRow(CLOSE)])), 2,
    'an earlier ask with no readable carry sets no step');
  const feedback = typed('Stop hook feedback:\n[guard-stop-contract.js]: The work in this turn is finished ...');
  assert.equal(fresh('fa-after-block', feedback, ask('t7', 'Where should we continue?', ['Resume in a fresh session (Recommended)', 'Continue here']),
    answer('t7', 'Continue here')), 0, "the hook's own feedback row is no typed prompt");
});

test('guard-stop-contract: the fresh-session offer waits while work this session launched is out (audit 2026-10-10 C09)', () => {
  // bba03dad: the offer said 'the work in this turn is finished' 3s after a verifier launched; the resume was picked,
  // the seat killed after one message and re-dispatched later.
  const tp = transcript('bg-defer', ctxRows('bg-defer', 500000, 'The review seat is out; the build itself is complete.'));
  const stop = (tasks) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, background_tasks: tasks }, { env: logEnv() }).status;
  assert.equal(stop([{ id: 'a1', type: 'subagent', status: 'running', description: 'verify' }]), 0, 'a running seat defers the offer');
  assert.equal(stop([]), 2, 'an empty registry makes it');
});

test('guard-stop-contract: an ask that sends the user to type into Other, or marks no recommendation, is sent back once (audit 2026-10-10 C26)', () => {
  const tp = transcript('ask-c26', [assistantRow('c26', 'ok', { cache_read_input_tokens: 900 })]);
  // ecea6d56: 'Paste ids in Other (Recommended)' returned only its label three times
  const other = [{ question: 'The staging Google client ids?', options: [{ label: 'Paste ids in Other (Recommended)', description: 'Type both ids in the Other field' }, { label: 'Defer', description: 'later' }] }];
  const env = logEnv();
  const r = askIn(tp, other, env);
  assert.equal(r.status, 2, 'denied once');
  assert.match(r.stderr, /returns only its LABEL/);
  assert.equal(askIn(tp, other, env).status, 0, 're-sent, it passes - never a loop');
  // bda299a8: two questions with no (Recommended) option
  const bare = [{ question: 'What should a Manager see?', options: [{ label: 'Hidden entirely', description: 'x' }, { label: 'Read-only', description: 'y' }] }];
  const u = askIn(tp, bare);
  assert.equal(u.status, 2);
  assert.match(u.stderr, /without exactly one option marked '\(Recommended\)'/);
  assert.equal(askIn(tp, [{ ...bare[0], multiSelect: true }]).status, 0, 'a multi-select question takes no single recommendation');
  assert.equal(askIn(tp, [{ question: 'Which file?', options: [{ label: 'a.js', description: 'x' }] }]).status, 0, 'one option is nothing to rank');
  assert.equal(askIn(tp, [{ question: 'Go?', options: [{ label: 'Yes (recommended)', description: 'x' }, { label: 'No', description: 'y' }] }]).status, 0, 'the mark in any case');
  const second = askIn(tp, [{ question: 'Ship?', options: [{ label: 'Hold', description: 'x' }, { label: 'Ship (Recommended)', description: 'y' }] }]);
  assert.equal(second.status, 2, 'the marked option goes first');
  assert.match(second.stderr, /listed first/);
  // f450ea64 (T5 cross-track): a question that already says why none is recommended is the no-default case stated
  assert.equal(askIn(tp, [{ ...bare[0], question: 'What should a Manager see? No option is recommended: the two rules contradict.' }]).status, 0,
    'a question saying why none is recommended passes at once');
  assert.equal(askIn(tp, [{ question: 'Ship? None is recommended.', options: [{ label: 'Hold (Recommended)', description: 'x' }, { label: 'Ship (Recommended)', description: 'y' }] }]).status, 2,
    'two marks are still denied');
});

// Audit 2026-10-11, session 2ca8e8ee: 'The staged plan is ready ... Execute it stage by stage?' with no text block since the
// prompt, and 'Post this simplified comment ... as shown' after the user's edit request - both approved unseen.
test('guard-stop-contract: an approval ask over nothing the chat showed since the typed turn is sent back once', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const toolRow = (id) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Read', input: { file_path: 'a.md' } }] } });
  const plan = [{ question: 'The staged plan is ready: 6 implementation stages. Execute it stage by stage?', options: [{ label: 'Execute (Recommended)', description: 'stage 1 first' }, { label: 'Hold', description: 'not now' }] }];
  const tp = transcript('blind-plan', [typed('upgrade the framework'), toolRow('b1'), toolRow('b2')]);
  const env = logEnv();
  const r = askIn(tp, plan, env);
  assert.equal(r.status, 2, 'the measured case: no text since the prompt');
  assert.match(r.stderr, /an approval of the plan the chat has not shown since the user's last message/);
  assert.match(r.stderr, /put the plan in your reply text first/);
  assert.equal(askIn(tp, plan, env).status, 0, 're-sent unchanged, it passes - never a loop');
  const stages = Array.from({ length: 6 }, (_, i) => `${i + 1}. Stage ${i + 1}: bump the packages of layer ${i + 1}, build, run its tests, rollback point tagged.`).join('\n');
  assert.equal(askIn(transcript('shown-plan', [typed('upgrade the framework'), toolRow('s1'), assistantRow('s2', `The staged plan:\n${stages}`)]), plan).status, 0,
    'the stages shown in the reply text first');
  const post = [{ question: 'Post this simplified comment on the ticket? It goes up as shown.', options: [{ label: 'Post it (Recommended)', description: 'as shown' }, { label: 'Do not post', description: 'hold' }] }];
  const status = 'Tests: 412 passed, 0 failed. Lint is clean, the build is green on both targets, and the branch is level with its upstream. '.repeat(2);
  assert.equal(askIn(transcript('blind-post', [typed('make it shorter and drop the second paragraph'), assistantRow('p1', status)]), post).status, 2,
    'text that does not carry the comment is no showing');
  const draft = `Here is the comment as it will be posted:\n\n> The crash came from the restore policy running twice on resume. The fix guards the second call and adds a regression test; the release note is in the ticket description. ${'x'.repeat(20)}`;
  assert.equal(askIn(transcript('shown-post', [typed('make it shorter and drop the second paragraph'), assistantRow('p2', draft)]), post).status, 0, 'the draft shown first');
  assert.equal(askIn(transcript('blind-other', [typed('what next?'), toolRow('o1')]), oneQ).status, 0, 'an ask that approves nothing');
  assert.equal(askIn(transcript('blind-untyped', [toolRow('u1')]), plan).status, 0, 'no typed turn to read back to: never a denial');
});

// Audit 2026-10-11, session 5984019e: a small solve-task run closed and handed off a product change with no verifier load
// and no review anywhere in its text (task-solve SKILL.md: 'a small close's `Result:` carries `review: <reviewer> - <its verdict>`').
test('guard-stop-contract: a small solve-task close whose Result line has no review field is sent back once', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const marker = typed('<command-name>/task-solve</command-name>');
  const close = (result) => [{ question: `Size: small - one file. Result: ${result}. Progress: 3 of 3 steps. Leftovers: none. Close the run?`,
    options: [{ label: 'Close it (Recommended)', description: 'x' }, { label: 'Keep going', description: 'y' }] }];
  const tp = transcript('small-close', [marker, assistantRow('a', 'Built and checked.')]);
  const env = logEnv();
  const r = askIn(tp, close('restore guard added at src/RetryPolicy.cs'), env);
  assert.equal(r.status, 2, 'the measured case: no review on the small close');
  assert.match(r.stderr, /a small solve-task close whose `Result:` line has no `review:` field/);
  assert.match(r.stderr, /run it, then put `review: <reviewer> - <its verdict>` on the `Result:` line/);
  assert.equal(askIn(tp, close('restore guard added at src/RetryPolicy.cs'), env).status, 0, 're-sent unchanged, it passes - never a loop');
  assert.equal(askIn(transcript('small-close-ok', [marker, assistantRow('a', 'Built and checked.')]),
    close('restore guard added at src/RetryPolicy.cs, review: task-verify-code - PASS, 0 findings')).status, 0, 'the receipt on the Result line');
  const std = [{ question: 'Size: standard - two modules. Result: spec at docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none. Go on?',
    options: [{ label: 'Go on (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }];
  assert.equal(askIn(transcript('std-close', [marker, assistantRow('a', 'ok')]), std).status, 0, 'a standard stop owes no review here');
  assert.equal(askIn(transcript('small-noflow', [typed('fix it'), assistantRow('a', 'ok')]), close('fixed')).status, 0, 'no solve-task run in this session');
});

// Audit 2026-10-20 C37 (4a210c3c, 8da401b1): a small close that never stated `Size:` escaped the review check, which keyed
// on the close's own `Size: small`. The cycle's size is read from the transcript - the size stated earlier, else the
// `size floor:` spec-check printed - and only after a source edit, never where the standard row's steps ran.
const specRun = (id, floor, bug) => [
  { type: 'assistant', message: { id: `sc-${id}`, content: [{ type: 'tool_use', id: `sc${id}`, name: 'Bash', input: { command: 'node "$SPEC" <<\'REQUEST\'\nx\nREQUEST' } }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `sc${id}`,
    content: `surface: yes - src/a.ts\nsecurity: no\nbug: ${bug || 'no'}\nsize floor: ${floor} - 2 file(s) named (the Size line may raise it, never go below it)\nspec: full\npath: merged` }] } },
];
const toolCall = (id, name, input) => ({ type: 'assistant', message: { id: `t-${id}`, content: [{ type: 'tool_use', id: `tu${id}`, name, input }] } });
const sourceEdit = (id) => toolCall(id, 'Edit', { file_path: '/p/src/RetryPolicy.cs', old_string: 'a', new_string: 'b' });
test('guard-stop-contract: a solve-task close stating no Size owes the review on the cycle\'s small or trivial size, never on a standard one (C37)', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const marker = typed('<command-name>/task-solve</command-name>');
  const bare = (result) => [{ question: `Result: ${result}. Progress: 5 of 5 steps. Leftovers: none. Close the run?`,
    options: [{ label: 'Close it (Recommended)', description: 'x' }, { label: 'Keep going', description: 'y' }] }];
  const built = assistantRow('b', 'Built and type-checked.');
  const env = logEnv();
  const tp = transcript('nosize-small', [marker, ...specRun(1, 'small'), sourceEdit(1), built]);
  const r = askIn(tp, bare('restore guard added at src/RetryPolicy.cs'), env);
  assert.equal(r.status, 2, 'the measured case: no Size line, a small floor, no review');
  assert.match(r.stderr, /a solve-task close that states no `Size:` \(this cycle's spec-check `size floor:` is small\)/);
  assert.match(r.stderr, /State the cycle's `Size:` on the close/);
  assert.equal(askIn(tp, bare('restore guard added at src/RetryPolicy.cs'), env).status, 0, 're-sent unchanged, it passes - never a loop');
  const deny = (name, rows, result) => askIn(transcript(name, rows), bare(result || 'restore guard added at src/RetryPolicy.cs')).status;
  assert.equal(deny('nosize-review', [marker, ...specRun(2, 'small'), sourceEdit(2), built], 'guard added, review: task-verify-code - PASS'), 0, 'the receipt on the Result line');
  assert.equal(deny('nosize-trivial', [marker, ...specRun(3, 'trivial'), sourceEdit(3), built]), 2, 'a trivial floor that reached a stop is small at least');
  assert.equal(deny('nosize-std-floor', [marker, ...specRun(4, 'standard'), sourceEdit(4), built]), 0, 'a standard floor owes no review here');
  assert.equal(deny('nosize-std-said', [marker, ...specRun(5, 'small'), assistantRow('s', 'Size: standard - two modules.'), typed('go on'), sourceEdit(5), built]), 0,
    'the Size stated earlier outranks the floor');
  const said = askIn(transcript('nosize-small-said', [marker, ...specRun(6, 'trivial'), assistantRow('s', '**Size:** small - two files.'), typed('go on'), sourceEdit(6), built]), bare('guard added'));
  assert.equal(said.status, 2, 'a small Size stated in an earlier turn, not restated on the close');
  assert.match(said.stderr, /this cycle's `Size:` was small/);
  assert.equal(deny('nosize-trivial-said', [marker, ...specRun(7, 'small'), assistantRow('s', 'Size: trivial - one line.'), typed('go on'), sourceEdit(7), built]), 0,
    'a stated trivial owes no review');
  assert.equal(deny('nosize-design', [marker, ...specRun(8, 'small'), toolCall(8, 'Skill', { skill: 'alfred-code:task-design' }), sourceEdit(8), built]), 0,
    'the standard row ran its design step');
  assert.equal(deny('nosize-plan', [marker, ...specRun(9, 'small'), toolCall(9, 'Read', { file_path: '/p/.alfred/docs/plans/x.md' }), sourceEdit(9), built]), 0,
    'a plan file read this cycle is a standard run resuming');
  assert.equal(deny('nosize-noedit', [marker, ...specRun(10, 'small'), built]), 0, 'no source edit yet - no close');
  assert.equal(deny('nosize-tmpedit', [marker, ...specRun(11, 'small'), toolCall(11, 'Write', { file_path: path.join(os.tmpdir(), 'scratch.js'), content: 'x' }), built]), 0,
    'a scratch file is no build');
  assert.equal(deny('nosize-unknown', [marker, sourceEdit(12), built]), 0, 'no floor and no stated size: nothing owed (8da401b1 ran no spec-check)');
  const raised = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'rz', content: 'size check: raise to standard - 4 files touched, small allows 3: a, b, c, d' }] } };
  assert.equal(deny('nosize-raised', [marker, ...specRun(13, 'small'), sourceEdit(13), raised, built]), 0, 'the re-check raised it to standard');
  assert.equal(deny('nosize-old-cycle', [marker, ...specRun(14, 'small'), sourceEdit(14), typed('<command-name>/task-solve</command-name>'), sourceEdit(15), built]), 0,
    'a floor from before the newest marker is another cycle');
  const quoted = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q', content: '   111\t        `size floor: small - x`,' }] } };
  assert.equal(deny('nosize-quoted', [marker, quoted, sourceEdit(16), built]), 0, 'a read of the script is no floor');
  assert.equal(deny('nosize-cross', [typed('<command-name>/task-solve-cross</command-name>'), ...specRun(17, 'small'), sourceEdit(17), built]), 0, 'the cross flow has no small row');
});

// Audit 2026-10-20 C37 (7c1af769): the user asked 'have you managed to reproduce?' four times - no stop of the bug run said.
// A stop past design in a cycle spec-check called a bug, or one whose plan carries a `## Repro` section, owes `Repro:` -
// a note beside the answer, like the other stop fields.
test('guard-stop-contract: a bug cycle\'s stop past design owes a Repro line - a note, never a deny (C37)', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const marker = typed('<command-name>/task-solve</command-name>');
  const fields = 'Size: standard - one module. Result: fix designed - docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none.';
  const design = toolCall('d', 'Skill', { skill: 'alfred-code:task-design' });
  const note = (name, rows, q) => {
    const r = askIn(transcript(name, rows), q || oneQ);
    assert.equal(r.status, 0, `${name}: the Repro field is a note, never a deny`);
    return ctxOf(r);
  };
  assert.match(note('repro-spec', [marker, ...specRun(1, 'standard', 'yes - the title (\'Fix\')'), design, assistantRow('a', fields)]),
    /a stop in a bug cycle \(spec-check printed `bug: yes`\), and it went out with no `Repro:` line/);
  assert.doesNotMatch(note('repro-said', [marker, ...specRun(2, 'standard', 'yes - x'), design, assistantRow('a', `${fields} Repro: not reproduced.`)]), /Repro/,
    'the stop that states it');
  assert.doesNotMatch(note('repro-nobug', [marker, ...specRun(3, 'standard', 'no'), design, assistantRow('a', fields)]), /Repro/, 'no bug, no field');
  assert.doesNotMatch(note('repro-predesign', [marker, ...specRun(4, 'standard', 'yes - x'), assistantRow('a', fields)]), /Repro/,
    'before design nothing was tried yet');
  assert.match(note('repro-edit', [marker, ...specRun(5, 'small', 'yes - x'), sourceEdit(5), assistantRow('a', fields)]), /`Repro:`/, 'a small run past its build');
  // the resumed bug cycle: no spec-check in this session, the plan read back carries the section (the 7c1af769 shape)
  const planRead = [toolCall('pr', 'Read', { file_path: '/p/.alfred/docs/plans/2026-10-15-oom.md' }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tupr', content: '     1\t# Firefox out of memory - plan\n   101\t## Repro - before fix\n   102\t- the report tab died at 3.5 GB' }] } }];
  assert.match(note('repro-plan', [marker, ...planRead, assistantRow('a', fields)]), /its plan carries a `## Repro` section/);
  const grepped = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'g', content: '1:# plan\n101:## Repro - before fix (production build)' }] } };
  assert.match(note('repro-grep', [marker, toolCall('g', 'Bash', { command: 'grep -n "^#" plan.md' }), grepped, toolCall('pr2', 'Read', { file_path: '/p/.alfred/docs/plans/a.md' }), assistantRow('a', fields)]), /`## Repro`/,
    'a heading listing of the plan counts too');
  const handOff = [{ question: 'Where?', options: [{ label: 'Resume in a fresh session (Recommended)', description: '~90k here, ~40k fresh' }, { label: 'Continue here', description: 'x' }] }];
  // a 40k first message and a 90k carry, where a fresh session pays back (check 15 keeps the hand-off)
  const floor = assistantRow('f0', 'first', { cache_creation_input_tokens: 40000 });
  assert.doesNotMatch(note('repro-handoff', [marker, floor, ...specRun(6, 'standard', 'yes - x'), design, assistantRow('a', fields, { cache_read_input_tokens: 90000 })], handOff), /Repro/, 'the opening hand-off is no stop');
  assert.doesNotMatch(note('repro-cross', [typed('<command-name>/task-solve-cross</command-name>'), ...specRun(7, 'standard', 'yes - x'), design, assistantRow('a', fields)]), /Repro/,
    'the cross flow carries no Repro field');
  assert.doesNotMatch(note('repro-old', [marker, ...specRun(8, 'standard', 'yes - x'), marker, design, assistantRow('a', fields)]), /Repro/, 'a bug line from an earlier cycle');
  assert.doesNotMatch(note('repro-noflow', [typed('fix the crash'), ...specRun(9, 'standard', 'yes - x'), design, assistantRow('a', fields)]), /Repro/, 'no solve-task run');
});

test('guard-stop-contract: a solve-task stop that owes a receipt is told which one (audit 2026-10-10, T4 cross-track)', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const marker = typed('<command-name>/task-solve</command-name>');
  const fields = 'Result: spec at docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none.';
  const note = (name, rows, q) => {
    const r = askIn(transcript(name, rows), q);
    assert.equal(r.status, 0, `${name}: a receipt is a note, never a deny`);
    try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
  };
  const goOn = [{ question: 'Next?', options: [{ label: 'Go on (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }];
  const answered = (id) => [{ type: 'assistant', message: { id: `q-${id}`, content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: goOn } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Your questions have been answered: "Next?"="Go on (Recommended)". You can now continue.' }] } }];
  // 3b53e0e8: the first stop went out with no Size line
  assert.match(note('rc-first', [marker, assistantRow('a', fields)], goOn), /`Size: /);
  assert.equal(note('rc-first-ok', [marker, assistantRow('a', `Size: standard - two modules. ${fields}`)], goOn), '');
  assert.doesNotMatch(note('rc-later', [marker, ...answered('u1'), assistantRow('a', fields)], goOn), /Size/, 'a later stop owes no Size');
  const handOff = [{ question: 'A cycle already closed here. Where?', options: [{ label: 'Resume in a fresh session (Recommended)', description: '~90k here, ~40k fresh' }, { label: 'Continue here', description: 'x' }] }];
  // a 40k first message under the 90k carry, where a fresh session pays back (check 15 keeps the hand-off)
  assert.doesNotMatch(note('rc-handoff', [marker, assistantRow('f0', 'first', { cache_creation_input_tokens: 40000 }), assistantRow('a', fields, { cache_read_input_tokens: 90000 })], handOff), /Size/, 'the opening hand-off is no stop');
  // e499fc94: the step-3 approval with no `mechanics: read`
  const approve = [{ question: 'The plan is gated. Build it in this session: one chat fits.', options: [
    { label: 'Approve - build in this session (Recommended)', description: 'x' }, { label: 'Approve - dispatch the agent seats', description: 'y' },
    { label: 'Not yet - changes needed', description: 'z' }] }];
  assert.match(note('rc-approve', [marker, ...answered('u2'), assistantRow('a', fields)], approve), /mechanics: read/);
  assert.equal(note('rc-approve-ok', [marker, ...answered('u3'), assistantRow('a', fields.replace('spec at', 'mechanics: read; plan at'))], approve), '');
  // a09fc7d6#3 (audit 2026-10-20): the approval after this cycle's task-verify-plan run quotes the gate's `Passes:` line
  const gateRun = { type: 'assistant', message: { id: 'vp', content: [{ type: 'tool_use', id: 'vp1', name: 'Skill', input: { skill: 'alfred-code:task-verify-plan' } }] } };
  const mech = fields.replace('spec at', 'mechanics: read; plan at');
  assert.match(note('rc-passes', [marker, ...answered('u8'), gateRun, assistantRow('a', mech)], approve), /`Passes: risk <v>/);
  assert.equal(note('rc-passes-ok', [marker, ...answered('u9'), gateRun, assistantRow('a', `${mech} Passes: risk pass | scope pass | existence pass | edges MINOR | soundness pass`)], approve), '');
  assert.equal(note('rc-passes-none', [marker, ...answered('u10'), assistantRow('a', mech)], approve), '', 'no gate ran this cycle, no Passes owed');
  // 390aebcb, 3ce6b036, 49cb4b82: the close with no `notes purged:` (`memories purged:` before 2026-10-24, still read)
  const completed = { type: 'assistant', message: { id: 'done', content: [{ type: 'tool_use', id: 'w1', name: 'Edit',
    input: { file_path: '/p/.alfred/docs/plans/2026-10-08-x.md', old_string: 'Approved:', new_string: 'Approved: yes\nCompleted: 2026-10-08' } }] } };
  assert.match(note('rc-close', [marker, ...answered('u4'), completed, assistantRow('a', fields)], goOn), /`notes purged: <names\|none>`/);
  assert.equal(note('rc-close-ok', [marker, ...answered('u5'), completed,
    assistantRow('a', 'Result: Completed 2026-10-08, notes purged: none. Progress: 6 of 6 steps. Leftovers: none.')], goOn), '');
  assert.equal(note('rc-close-old', [marker, ...answered('u5b'), completed,
    assistantRow('a', 'Result: Completed 2026-10-08, memories purged: none. Progress: 6 of 6 steps. Leftovers: none.')], goOn), '', 'an older skill copy\'s spelling still closes');
  assert.doesNotMatch(note('rc-after-close', [marker, ...answered('u6'), completed, ...answered('u7'), assistantRow('a', fields)], goOn), /notes purged/,
    'an ask after the close was answered is no close');
  // a6a24815: the cross close report with no `ceilings:`
  const cross = typed('<command-name>/task-solve-cross</command-name>');
  const report = `${fields}\nmode: agents | contract: n/a\nlanes: api - endpoints - SIGNED_OFF\nfinal gate: PASS\npending: none\nleftovers: none\nnotes purged: none`;
  assert.match(note('rc-cross', [cross, ...answered('u8'), assistantRow('a', report)], goOn), /ceilings:/);
  assert.equal(note('rc-cross-ok', [cross, ...answered('u9'), assistantRow('a', `${report}\nceilings: none`)], goOn), '');
  assert.equal(note('rc-noflow', [typed('fix the typo'), assistantRow('a', 'hello')], approve), '', 'a session that never ran the flow owes nothing');
});

test('guard-stop-contract: a new cycle after a finished one is sent back once without the fresh option (audit 2026-10-10 C08)', () => {
  // bda299a8: cycle 2's first ask, typed after cycle 1's plan was stamped Completed:, carried no fresh-session option.
  const completed = { type: 'assistant', message: { id: 'done', content: [{ type: 'tool_use', id: 'w1', name: 'Edit',
    input: { file_path: '/p/.alfred/docs/plans/2026-10-08-x.md', old_string: 'Approved:', new_string: 'Approved: yes\nCompleted: 2026-10-08' } }] } };
  const base = [{ type: 'user', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } },
    assistantRow('f', 'first', { cache_creation_input_tokens: 40000 }), completed];
  const next = { type: 'user', message: { role: 'user', content: 'now the manager view' } };
  const hot = assistantRow('h', 'Result: design done. Progress: 1 of 6 steps. Leftovers: none.', { cache_read_input_tokens: 362000 });
  const q = [{ question: 'Result: design done. Progress: 1 of 6 steps. Leftovers: none. Build it?', options: [{ label: 'Build (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }];
  const env = logEnv();
  const r = askIn(transcript('nc-new', [...base, next, hot]), q, env);
  assert.equal(r.status, 2, 'the new cycle\'s first ask is sent back');
  assert.match(r.stderr, /add a fresh-session option to this first ask of a new cycle - This session carries ~362k tokens per message/);
  assert.equal(askIn(transcript('nc-new', [...base, next, hot]), [{ ...q[0], question: `${q[0].question} Now?` }], env).status, 0, 'once per Completed stamp');
  assert.equal(askIn(transcript('nc-close', [...base, hot]), q, logEnv()).status, 0, 'the finished cycle\'s own close ask, before any new prompt, is left alone');
  const withFresh = [{ ...q[0], options: [{ label: 'Resume in a fresh session (Recommended)', description: '~362k here, ~40k fresh' }, { label: 'Build here', description: 'x' }] }];
  assert.equal(askIn(transcript('nc-fresh', [...base, next, hot]), withFresh, logEnv()).status, 0, 'an ask carrying the option passes');
});

// ---------------------------------------------------------------------------------------------
// 4. stop-denial-stale-150k - the denial printed a number that was not this session's trigger
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: the prose-ask denial quotes the session\'s own carry and trigger', () => {
  // the session's model is the transcript's own row (a settings alias is never read)
  const tp = transcript('denial-num', ctxRows('denial-num', 266711, 'Patch is ready. Say the word and I will push it.')
    .map((r) => ({ ...r, message: { ...r.message, model: 'claude-opus-5' } })));
  const r = runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, { env: logEnv() });
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
const oneQ = [{ question: 'Which next?', options: [{ label: 'Continue (Recommended)', description: 'carry on here' }, { label: 'Stop', description: 'hold' }] }];
const ts = (h) => new Date(Date.UTC(2026, 8, 20, h, 0, 0)).toISOString();

test('guard-stop-contract: the fresh-session note carries the two absolute numbers, not a ratio', () => {
  const tp = transcript('ask-nums', [
    assistantRow('nf', 'the first turn', { cache_creation_input_tokens: 90000 }),
    { type: 'assistant', message: { id: 'nc', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 500000 } } },
  ]);
  const note = ctxOf(askIn(tp, oneQ, logEnv()));
  assert.match(note, /500k/, 'the carry this session pays per message');
  assert.match(note, /90k/, "this session's own cold floor - the number a resume restarts at");
  assert.match(note, /400k/, 'and the trigger it crossed');
  assert.doesNotMatch(note, /80-105k/, 'the generic range is gone - the skill step needs THIS session\'s numbers');
  assert.match(note, /This session carries ~500k tokens per message; with the cache warm \(5m TTL\) a turn re-reads it at 0\.1x the input price\. A fresh session restarts at ~90k, written new at 1\.25x, and pays back in about 3 messages\./,
    'the paying text, priced with the cache warm');
  assert.doesNotMatch(note, /re-sends all of it/, 'no re-send claim');
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

// The cache-aware verdict (spec 2026-10-28, sections 1-3): claude-opus-5-5 reads at 0.05x, the 1h split writes at 2x and
// the payback window is 30, so over a 79k floor a fresh session pays back past a 211,600 carry - and never at ctx 0.
test('guard-stop-contract: the new-cycle deny, the post-answer note and the Stop offer go only where a fresh session pays back', () => {
  const F = 79000;
  const H1 = { cache_creation_input_tokens: F, cache_creation: { ephemeral_1h_input_tokens: F, ephemeral_5m_input_tokens: 0 } };
  const row = (id, text, usage, timestamp) => ({ type: 'assistant', ...(timestamp ? { timestamp } : {}),
    message: { id, model: 'claude-opus-5-5', content: [{ type: 'text', text }], ...(usage ? { usage } : {}) } });

  // Check 10: a new cycle's first ask is sent back for a fresh option only where one pays.
  const completed = { type: 'assistant', message: { id: 'done', content: [{ type: 'tool_use', id: 'w1', name: 'Edit',
    input: { file_path: '/p/.alfred/docs/plans/2026-10-08-x.md', old_string: 'Approved:', new_string: 'Approved: yes\nCompleted: 2026-10-08' } }] } };
  const cycle = (name, ctx) => transcript(name, [{ type: 'user', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } },
    row('f', 'first', ctx ? H1 : null), completed, { type: 'user', message: { role: 'user', content: 'now the manager view' } },
    row('h', 'Result: design done. Progress: 1 of 6 steps. Leftovers: none.', ctx ? { cache_read_input_tokens: ctx } : null)]);
  const q = [{ question: 'Result: design done. Progress: 1 of 6 steps. Leftovers: none. Build it?', options: [{ label: 'Build (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }];
  assert.equal(askIn(cycle('pay-nc-100', 100000), q).status, 0, 'check 10: 100k does not pay back - no deny');
  assert.equal(askIn(cycle('pay-nc-0', 0), q).status, 0, 'check 10: no reading - no deny');
  const denied = askIn(cycle('pay-nc-250', 250000), q);
  assert.equal(denied.status, 2, 'check 10: 250k pays back - sent back');
  assert.match(denied.stderr, /add a fresh-session option to this first ask of a new cycle - This session carries ~250k tokens per message; with the cache warm \(1h TTL\) a turn re-reads it at 0\.05x the input price\. A fresh session restarts at ~79k, written new at 2x, and pays back in about 23 messages\./);
  assert.match(denied.stderr, /`Size:`/, 'the Size sentence stays');

  // The post-answer note on the clock route: open 3h, priced by the same verdict.
  const clock = (name, ctx) => transcript(name, [row(`${name}-f`, 'the first turn', H1, ts(0)), row(name, 'ok', { cache_read_input_tokens: ctx }, ts(3))]);
  assert.equal(ctxOf(askIn(clock('pay-clock-100', 100000), oneQ)), '', '3h at 100k: no note');
  assert.match(ctxOf(askIn(clock('pay-clock-250', 250000), oneQ)), /has been open 3\.0h[^]*This session carries ~250k tokens per message; with the cache warm \(1h TTL\)/, '3h at 250k: the note, priced');

  // The finished-turn Stop offer past the 1M tier's trigger.
  const stop = runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: transcript('pay-stop', [row('s-f', 'the first turn', H1),
    row('s', 'Applied the change; tests pass.', { cache_read_input_tokens: 401000 })]) }, { env: logEnv({ ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000' }) });
  assert.equal(stop.status, 2, '401k past the 400k trigger pays back: the offer');
  assert.match(stop.stderr, /This session carries ~401k tokens per message; with the cache warm \(1h TTL\) a turn re-reads it at 0\.05x the input price\. A fresh session restarts at ~79k, written new at 2x, and pays back in about 12 messages\./);
  assert.doesNotMatch(stop.stderr, /re-sends all of it|NOT a tenth/);
});

// Check 15 (spec 2026-10-28 section 4): a fresh-session HAND-OFF where a fresh session does not pay back is dropped from the
// ask in place, and a question the drop would leave with one option is refused once, naming that option. Fixtures:
// claude-opus-5-5, a 1h split, F 79k - at 100k a fresh session pays back only after ~449 messages, at 250k in ~23.
const C15_F = 79000;
const c15Rows = (ctx) => [{ type: 'assistant', message: { id: 'f', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'first' }],
  usage: { cache_creation_input_tokens: C15_F, cache_creation: { ephemeral_1h_input_tokens: C15_F, ephemeral_5m_input_tokens: 0 } } } },
  ...(ctx != null ? [{ type: 'assistant', message: { id: 'n', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], usage: ctx ? { cache_read_input_tokens: ctx } : { input_tokens: 0 } } }] : [])];
function c15(name, ctx, questions, opts = {}) {
  const root = fs.mkdtempSync(path.join(TMP, `c15-${name}-`));
  const log = fs.mkdtempSync(path.join(TMP, `c15log-${name}-`));
  const sid = `c15-${name}`;
  const tp = transcript(sid, opts.rows || c15Rows(ctx));
  if (opts.setup) opts.setup(root, sid);
  const env = { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: log, CLAUDE_PROJECT_DIR: root, ...(opts.env || {}) };
  const send = () => runIn('guard-stop-contract.js', { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', session_id: sid, cwd: root,
    transcript_path: tp, tool_input: { questions }, ...(opts.payload || {}) }, { env });
  const r = send();
  const upd = (() => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput || null; } catch { return null; } })();
  const rows = () => { try { return fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
  return { r, upd, rows, log, send };
}
const labelsOf = (upd) => upd.questions[0].options.map((o) => o.label);
// The hand-off listed last behind a marked first option, so no other check of the ask has a reason to touch it.
const opts3last = (fresh) => [{ question: 'The cycle is done. What next?', options: [{ label: 'Start it here (Recommended)', description: 'x' }, { label: 'Leave it for later', description: 'y' }, { label: fresh, description: 'z' }] }];
const opts3 = (fresh) => [{ question: 'The cycle is done. What next?', options: [{ label: fresh, description: 'x' }, { label: 'Start it here', description: 'y' }, { label: 'Leave it for later', description: 'z' }] }];

test('check 15: a three-option ask at 100k goes out without its hand-off', () => {
  const { r, upd, rows, log } = c15('three', 100000, opts3('Start it in a fresh session (Recommended)'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepStrictEqual(labelsOf(upd), ['Start it here (Recommended)', 'Leave it for later'], 'dropped in place, the mark moved to the first option left');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /would pay back only after about 449 messages, past the 30-message window/, 'the model is told why');
  assert.deepStrictEqual(fs.readdirSync(log).filter((f) => /^guard-stop-askvoice-.*\.denied$/.test(f)), [], 'no deny marker spent');
  assert.equal(rows().filter((x) => x.kind === 'fresh-verdict' && x.detail.route === 'fresh-ask').length, 1, 'one fresh-ask verdict row');
});

test('check 15: a two-option fresh-or-here ask at 100k is refused once, naming the option left', () => {
  const loop = c15('loop', 100000, [{ question: 'Round 2 is done. Go on?', options: [{ label: 'Continue here (Recommended)', description: 'x' },
    { label: 'Continue in a fresh session from the loops folder', description: 'y' }] }]);
  assert.equal(loop.r.status, 2, 'refused');
  assert.match(loop.r.stderr, /This session carries ~100k tokens per message; with the cache warm \(1h TTL\) a turn re-reads it at 0\.05x\. A fresh session restarts at ~79k, written new at 2x, and would pay back only after about 449 messages, past the 30-message window\./);
  assert.match(loop.r.stderr, /take that option - 'Continue here \(Recommended\)' - and drop the question/);
  assert.doesNotMatch(loop.r.stderr, /Re-send the ask/, 'nothing is left to re-send');
  assert.equal(loop.send().status, 0, 'the same ask re-sent passes');
  const diag = c15('diag', 100000, [{ question: 'Findings written. Next?', options: [{ label: 'Stop here (Recommended)', description: 'x' },
    { label: 'Resume in a fresh session', description: 'y' }] }]);
  assert.equal(diag.r.status, 2);
  assert.match(diag.r.stderr, /take that option - 'Stop here \(Recommended\)' - and drop the question/);
});

// the final review (2026-10-29): a label that only mentions a session is the user's own work, a question of hand-offs
// alone is left as written, and a question left with one option leaves the re-send
test('check 15: an option that only mentions a session is never dropped or refused', () => {
  for (const [id, opts] of [['expiry', ['Build the new session expiry check (Recommended)', 'Leave it for later']],
    ['bug', ['Continue fixing the fresh session bug (Recommended)', 'Write the tests first', 'Stop here']]]) {
    const { r, upd } = c15(id, 100000, [{ question: 'What next?', options: opts.map((label) => ({ label, description: 'x' })) }]);
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
    assert.equal(upd, null, `${id}: untouched`);
  }
});

test('check 15: a question whose every option is a hand-off is left as written', () => {
  const { r, upd, rows, log } = c15('allfresh', 100000, [{ question: 'Where next?', options: [{ label: 'Resume in a fresh session (Recommended)', description: 'x' },
    { label: 'Start the loop in a new session', description: 'y' }] }]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(upd, null, 'nothing dropped');
  assert.deepStrictEqual(fs.readdirSync(log).filter((f) => /\.denied$/.test(f)), [], 'no deny marker spent');
  assert.equal(rows().filter((x) => x.kind === 'fresh-verdict' && x.detail.route === 'fresh-ask').length, 0, 'no fresh-ask row');
});

test('check 15: the re-send carries only the questions still worth asking', () => {
  const { r } = c15('two-q', 100000, [{ question: 'Round 2 is done. Go on?', options: [{ label: 'Continue here (Recommended)', description: 'x' },
    { label: 'Resume in a fresh session', description: 'y' }] }, { question: 'Which file first?', options: [{ label: 'a.js (Recommended)', description: 'x' }, { label: 'b.js', description: 'y' }] }]);
  assert.equal(r.status, 2, 'refused');
  assert.match(r.stderr, /take that option - 'Continue here \(Recommended\)' - and drop the question/);
  const sent = JSON.parse(r.stderr.split('changed:\n')[1]);
  assert.deepStrictEqual(sent.map((q) => q.question), ['Which file first?'], 'the lone question is not re-sent');
});

test('check 15: at 250k the ask goes out as written', () => {
  const { r, upd } = c15('pays', 250000, [{ question: 'The cycle is done. What next?', options: [{ label: 'Start it here (Recommended)', description: 'x' },
    { label: 'Leave it for later', description: 'y' }, { label: 'Start it in a fresh session', description: '~250k per message here, ~79k fresh' }] }]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(upd, null, 'no change, the hand-off still unmarked');
});

test('check 15: setting and audit options are not hand-offs', () => {
  for (const label of ['Offer a fresh session (Recommended)', 'Hand off to a fresh session']) {
    const qs = [{ question: 'Which default?', options: [{ label, description: 'x' }, { label: 'Keep it as it is', description: 'y' }] }];
    if (!/Recommended/.test(label)) qs[0].options.reverse()[0].label += ' (Recommended)';
    for (const ctx of [100000, 250000]) {
      const { r, upd } = c15(`setting-${ctx}-${label.length}`, ctx, qs);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(upd, null, `${label} at ${ctx}: untouched, no numbers line`);
    }
  }
});

test('isFreshHandoff: every template label matches', () => {
  for (const label of ['Resume in a fresh session', 'Resume the next phase in a fresh session', 'Start it in a fresh session', 'Start AUTO in a fresh session',
    'Continue in a fresh session from the loops folder', 'Continue the build in a fresh session', 'Build it in a fresh session: /task-solve docs/work/findings/2026-10-28.v2.md',
    'Start the loop in a new session', 'Continue in a new chat', 'Continue in fresh session', 'Start it in a fresh session: /clear, then /loop-code-quality',
    'Resume from docs/superpowers/sdd/2026-10-24-no-mcp-stack/plan.md in a fresh session']) {
    const { r, upd } = c15(`label-${label.length}`, 100000, opts3last(label));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(upd && !labelsOf(upd).includes(label), `${label} is a hand-off - dropped`);
  }
  for (const label of ['Offer a fresh session', 'Hand off to a fresh session', 'Move to a new session', 'Build the new session expiry check',
    'Continue fixing the fresh session bug', 'Continue here - no new session needed', 'Continue here, not in a new session']) {
    const { r, upd } = c15(`nolabel-${label.length}`, 100000, opts3last(label));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!upd || labelsOf(upd).includes(label), `${label} is no hand-off - kept`);
  }
});

test('check 15: it leaves the ask alone', () => {
  const q = opts3('Start it in a fresh session (Recommended)');
  const kept = (c, why, sent = q) => {
    assert.equal(c.r.status, 0, `${why}: ${c.r.stderr}`);
    assert.ok(!c.upd || JSON.stringify(c.upd.questions[0].options.map((o) => o.label)) === JSON.stringify(sent[0].options.map((o) => o.label)), `${why}: options unchanged`);
  };
  kept(c15('off', 100000, q, { env: { ALFRED_CODE_HOOKS_OFF: 'guard-stop-contract:fresh-ask' } }), 'the part switched off');
  // audit 2026-10-30 HK-03: the stamp the start hook writes records the transcript's size, and the typed row turning
  // auto-run on sits there (hook-prelude.js autoStampVerified)
  const typedOn = { type: 'user', message: { role: 'user', content: '<command-name>/loop-code-quality</command-name>\n<command-args>--mode-auto-run-on</command-args>' } };
  kept(c15('auto', 100000, q, { rows: [typedOn, ...c15Rows(100000)], setup: (root, sid) => {
    const dir = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'APPROVAL'), `AUTO - "/loop-code-quality --mode-auto-run-on"\nsession: ${sid}\nskill: loop-code-quality\ntranscript-size: 0\n`);
  } }), 'a live auto-run stamp of this session');
  kept(c15('unattended', 100000, q, { env: { ALFRED_CODE_UNATTENDED: '1' } }), 'nobody at the terminal');
  kept(c15('seat', 100000, q, { payload: { agent_id: 'seat-1' } }), 'a seat');
  kept(c15('ctx0', 0, q), 'ctx 0');
  kept(c15('norow', 0, q, { rows: [{ type: 'user', message: { role: 'user', content: 'go' } }] }), 'no assistant row');
  const multi = [{ ...q[0], multiSelect: true, options: q[0].options.map((o) => ({ ...o, label: o.label.replace(' (Recommended)', '') })) }];
  kept(c15('multi', 100000, multi), 'multi-select', multi);
  kept(c15('asked', 100000, q, { rows: [{ type: 'user', message: { role: 'user', content: 'should I start a fresh session?' } }, ...c15Rows(100000)] }), 'the user asked about a fresh session');
  for (const [id, said] of [['conv', 'move this to a new conversation'], ['ctx', 'clear the context and go on'], ['over', 'start over from the plan file']])
    kept(c15(`asked-${id}`, 100000, q, { rows: [{ type: 'user', message: { role: 'user', content: said } }, ...c15Rows(100000)] }), `the user asked: '${said}'`);
});

test('guard-stop-contract: the prose written before an ask is checked for house voice', () => {
  // guard-answer.js reads the turn's FINAL text only, so prose that ends on a tool call is
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
  // (the first stop also owes its `Size:` receipt - audit 2026-10-10, T4 cross-track)
  assert.equal(ctxOf(askIn(cycle('sf-fields',
    'Size: small - one module\nResult:    task 2 landed - docs/plans/csv.md\nProgress:  4 of 6 steps\nLeftovers: none'), oneQ)), '',
    'the stamped fields clear it');
  assert.equal(ctxOf(askIn(cycle('sf-bold',
    '**Size:** small - one module\n**Result:** task 2 landed\n**Progress:** 4 of 6 steps\n**Leftovers:** none'), oneQ)), '',
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

test('guard-stop-contract: a solve-task stop MBs after its slash marker is still a cycle stop (audit 2026-10-10 C01)', () => {
  // 17 sessions: the marker sat at the transcript's head and the first stop 0.5-3MB later, past the 256KB tail
  // solveTaskCycle() read - 0 of N stops carried the fields and the note never fired (0 of 12 in 0d070bcc).
  const pad = (n) => Array.from({ length: n }, (_, i) => ({ type: 'user', message: { role: 'user',
    content: [{ type: 'tool_result', tool_use_id: `p${i}`, content: 'x'.repeat(100 * 1024) }] } }));
  const marker = { type: 'user', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } };
  const far = transcript('sf-far', [marker, ...pad(9), assistantRow('far', 'Design done, the plan is written.', { cache_read_input_tokens: 900 })]);
  assert.ok(fs.statSync(far).size > 900 * 1024, 'the marker sits ~900KB behind the ask');
  assert.match(ctxOf(askIn(far, oneQ)), /THREE named fields/, 'a stop far past the marker is still reminded');
  const env = logEnv();
  assert.match(ctxOf(askIn(far, oneQ, env)), /THREE named fields/, '... and again from the kept answer');
  // A marker only QUOTED in a tool result (a sed over a test file, a transcript dump) is no run.
  const quoted = transcript('sf-quoted', [
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'fixture: <command-name>/task-solve</command-name>' }] } },
    assistantRow('q', 'Read the fixture.', { cache_read_input_tokens: 900 }),
  ]);
  assert.equal(ctxOf(askIn(quoted, oneQ)), '', 'a quoted marker is not a cycle');
  // The kept answer reads only what was appended: a miss, then the flow typed later in the same session, is a cycle.
  const grows = transcript('sf-grows', [{ type: 'user', message: { role: 'user', content: 'fix the test' } }, assistantRow('g1', 'Fixed.', { cache_read_input_tokens: 900 })]);
  const genv = logEnv();
  assert.equal(ctxOf(askIn(grows, oneQ, genv)), '', 'no flow yet');
  fs.appendFileSync(grows, [marker, ...pad(3), assistantRow('g2', 'Design done.', { cache_read_input_tokens: 900 })].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.match(ctxOf(askIn(grows, oneQ, genv)), /THREE named fields/, 'the appended marker is found past the recorded miss');
  // The fields written INLINE in a one-line question (session 516e653d, 5 of 5 compliant asks) satisfy the contract.
  const inline = [{ question: 'Size: standard - two modules. Result: design done - docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none. Continue to the plan audit?',
    options: [{ label: 'Continue (Recommended)', description: 'run the gate' }, { label: 'Stop', description: 'hold' }] }];
  assert.equal(ctxOf(askIn(far, inline)), '', 'inline fields after a sentence boundary count');
});

test('guard-stop-contract: an answer a few calls back is still just answered, in either wording (audit 2026-10-10 C01)', () => {
  const answer = (id, text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const ask = (id) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: oneQ } }], usage: { cache_read_input_tokens: 900 } } });
  const call = (id, out) => [
    { type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'docker desktop stop' } }], usage: { cache_read_input_tokens: 900 } } },
    answer(id, out),
  ];
  const stopOn = (tp, text) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: text }, { env: logEnv() });
  const closeText = 'Docker has quit. The diff stays as you chose - say the word when you want it committed.';
  // bc2fa83e: one Bash call (7.6KB of rows) put the answer past the 8KB tail and the restating close was blocked.
  const oneCall = transcript('aj-one', [
    { type: 'user', message: { role: 'user', content: 'finish the feature' } }, ask('a1'),
    answer('a1', 'Your questions have been answered: "Commit now?"="Hold - review the diff first". You can now continue.'),
    ...call('b1', 'exit=0\n' + 'y'.repeat(12 * 1024)),
  ]);
  assert.equal(stopOn(oneCall, closeText).status, 0, 'one call after the answer is still just answered');
  // 4f1c2ebb: a free-text answer is worded 'The user answered:' - its acknowledgement was blocked 4s later.
  const freeText = transcript('aj-free', [
    { type: 'user', message: { role: 'user', content: 'go on' } }, ask('a2'),
    answer('a2', 'The user answered: "Sign in as the customer?"="Disable automode". Read the answers carefully.'),
  ]);
  assert.equal(stopOn(freeText, closeText).status, 0, 'a free-text answer counts');
  // ... and a decision put in prose after real work since the answer is a new decision, judged as before.
  const worked = transcript('aj-worked', [
    { type: 'user', message: { role: 'user', content: 'finish the feature' } }, ask('a3'),
    answer('a3', 'Your questions have been answered: "Next?"="Build it"'),
    ...call('c1', 'ok'), ...call('c2', 'ok'), ...call('c3', 'ok'), ...call('c4', 'ok'),
  ]);
  assert.equal(stopOn(worked, closeText).status, 2, 'four calls after the answer, the prose decision is held');
  const newTurn = transcript('aj-turn', [
    ask('a4'), answer('a4', 'Your questions have been answered: "Next?"="Build it"'),
    { type: 'user', message: { role: 'user', content: 'and now the docs' } },
  ]);
  assert.equal(stopOn(newTurn, closeText).status, 2, 'an answer from before the typed prompt is not this turn\'s');
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
  // A prior run counts once it WORKED - two tool calls (audit 2026-10-20 C13, 24841a36).
  const callRow = (id, usage) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }], usage } });
  const result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
  const worked = (id, usage) => [callRow(`${id}-c1`, usage), result(), callRow(`${id}-c2`, usage), result()];
  // The slash route is UserPromptExpansion (2.1.5 M14): the typed command arrives by name.
  const slash = (tp, skill) => {
    const name = skill || 'task-solve';
    const r = runIn('guard-fresh-session-start.js',
      { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: name, command_args: '', prompt: `/${name}`, transcript_path: tp },
      { env: logEnv() });
    assert.equal(r.status, 0, 'the slash route never denies');
    // the mode banner every typed task-* command carries (2026-10-15) is no offer
    return (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '').replace(/(?:^|\n\n)Open your reply to this command with these two lines[\s\S]*$/, '');
  };

  assert.equal(slash(transcript('ab-dup', [
    cmd('alfred-code:init'), cmd('alfred-code:update'),
  ]), 'alfred-code:update'), '', 'two commands 4s apart with NO assistant turn between them is one abandoned run');
  assert.equal(slash(transcript('ab-resume', [
    cmd('task-solve'), userRow('resume the build cycle, steps 1-3 are stamped'),
  ])), '', "a re-typed run the model never answered is not a run this session already made");

  // ... and the measured chain the trigger exists for still fires: a run, an ANSWER, then a second run.
  assert.match(slash(transcript('ab-real', [
    cmd('capture-awareness'),
    ...worked('r1', FLOOR),
    assistantRow('r1', 'Captured the architecture doc.', FLOOR),
    userRow('now run the task cycle'),
    assistantRow('r2', 'ok', COLD),
    cmd('task-solve'),
  ])), /ALREADY run one/i, 'a finished prior run, with the model\'s own turn in between, is still the measured chain');

  // `init` is the guided install and, after its restart, the bootstrap (setup merged into it on 2026-10-17); update
  // is a multi-phase run too - both take the offer.
  for (const walk of ['alfred-code:init', 'alfred-code:update'])
    assert.match(slash(transcript(`ab-${walk.split(':')[1]}`, [
      cmd('capture-awareness'),
      ...worked('i1', FLOOR),
      assistantRow('i1', 'Captured the architecture doc.', FLOOR),
      userRow('now install the stack'),
      assistantRow('i2', 'ok', COLD),
      cmd(walk),
    ]), walk), /ALREADY run one/i, `${walk} is a guided walk`);
});

// ---------------------------------------------------------------------------------------------
// 9 + 10. guard-answer: the verbatim re-ask, and the two Stop hooks no longer contradict
// ---------------------------------------------------------------------------------------------
const promptSubmit = (prompt, tp, env) => {
  const r = runIn('guard-answer.js', { hook_event_name: 'UserPromptSubmit', prompt, transcript_path: tp }, { env: env || logEnv() });
  assert.equal(r.status, 0, 'UserPromptSubmit never denies - a denial erases the prompt');
  return ctxOf(r);
};

test('guard-answer: a verbatim-repeated prompt is an ambiguity signal, not a re-answer', () => {
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

// Deep hooks review 2026-10-16, the user's ruling 'English + script rule': the word lists read English only, so a close
// in another language is not judged on its words - only on its neutral signals.
test('guard-stop-contract: a close the hook cannot read as English is not judged on its words, a closing question mark still is (deep review: English only)', () => {
  const stall = 'Задача 3 готова. Чекаю на твоє рішення.';
  const ask = 'Задача 3 готова. Пушити?';
  for (const [state, rows] of [['none', fgBash], ['agent', reviewAgent]]) {
    assert.equal(closeOver(`en-stall-${state}`, rows, stall).status, 0, `a stall in Ukrainian under ${state}`);
    assert.equal(closeOver(`en-ask-${state}`, rows, ask).status, 2, `a closing '?' in Ukrainian under ${state}`);
  }
});

// Audit 2026-10-20 C45: three approval-ask misses and a mark the question contradicts.
test('guard-stop-contract (C45): a referent approval is judged on what was shown, a review verdict is no send, and the mark agrees with the question', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const toolRow = (id) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Read', input: { file_path: 'a.md' } }] } });
  const q = (question) => [{ question, options: [{ label: 'Apply (Recommended)', description: 'write it' }, { label: 'Skip', description: 'nothing' }] }];
  // e31af926 L128: reworded from 'as shown' to 'the diff above' with the diff still unshown; e43969a7 L139: 'fixes shown above'
  for (const ask of ['Apply the diff above?', 'Apply the AGENTS.md fixes shown above?']) {
    const r = askIn(transcript(`c45-blind-${ask.length}`, [typed('update the install'), toolRow('b1')]), q(ask));
    assert.equal(r.status, 2, `nothing shown: ${ask}`);
    assert.match(r.stderr, /the chat has not shown since the user's last message/);
  }
  const diff = 'The diff, 7 lines:\n\n```diff\n- old line one of the rule file\n+ new line one of the rule file\n- old line two\n+ new line two\n```\n' + 'Each line keeps its section. '.repeat(6);
  for (const ask of ['Apply the diff above?', 'Apply the AGENTS.md fixes shown above?'])
    assert.equal(askIn(transcript(`c45-shown-${ask.length}`, [typed('update the install'), assistantRow('s1', diff)]), q(ask)).status, 0, `shown first: ${ask}`);
  // fabea019 L1421: a review verdict ask - 'send it back to the build' - is no send-this approval
  const verdict = [{ question: 'The review found one MATERIAL gap. Fix it now, or send it back to the build?', options: [{ label: 'Fix it now (Recommended)', description: 'x' }, { label: 'Send it back', description: 'y' }] }];
  assert.equal(askIn(transcript('c45-verdict', [typed('review it'), toolRow('v1')]), verdict).status, 0, 'send it back is no approval of a text');
  assert.equal(askIn(transcript('c45-send', [typed('draft the reply'), toolRow('v2')]), [{ question: 'Send it to the customer?', options: [{ label: 'Send (Recommended)', description: 'x' }, { label: 'Hold', description: 'y' }] }]).status, 2,
    "'send it' is still the approval it was");
  // fabea019 L2845: the question recommended one option, the mark sat on another
  const tp = transcript('c45-mark', [assistantRow('m1', 'ok', { cache_read_input_tokens: 900 })]);
  const mis = [{ question: 'Where do we verify? Recommended: the alpha site after you deploy the fix branch.', options: [
    { label: 'Swap the scripts on production (Recommended)', description: 'fast, risky' }, { label: 'Alpha site after the deploy', description: 'safe' }] }];
  const env = logEnv();
  const m = askIn(tp, mis, env);
  assert.equal(m.status, 2, 'the mark contradicts the question');
  assert.match(m.stderr, /names another option than the one marked/);
  assert.equal(askIn(tp, mis, env).status, 0, 're-sent unchanged, it passes - never a loop');
  const agree = [{ ...mis[0], options: [{ label: 'Alpha site after the deploy (Recommended)', description: 'safe' }, { label: 'Swap the scripts on production', description: 'fast' }] }];
  assert.equal(askIn(tp, agree).status, 0, 'mark and question agree');
  assert.equal(askIn(tp, [{ ...mis[0], question: 'Where do we verify? Recommended: a quick look first.' }]).status, 0, 'a question naming no option decides nothing');
});

test('guard-stop-contract: a /mode-auto-run run that reads the installed solve flow owes its receipts; nothing else marks one (2026-10-25)', () => {
  const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const auto = typed('<command-message>mode-auto-run</command-message>\n<command-name>/mode-auto-run</command-name>\n<command-args>add a status route</command-args>');
  let k = 0;
  const readOf = (file) => ({ type: 'assistant', message: { id: `rd${++k}`, content: [{ type: 'tool_use', id: `rd${k}t`, name: 'Read', input: { file_path: file } }] } });
  const SOLVE = '/p/.claude/skills/task-solve/SKILL.md';
  const fields = 'Result: spec at docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none.';
  const note = (name, rows, q) => {
    const r = askIn(transcript(name, rows), q);
    assert.equal(r.status, 0, `${name}: a receipt is a note, never a deny`);
    try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
  };
  const goOn = [{ question: 'Next?', options: [{ label: 'Go on (Recommended)', description: 'x' }, { label: 'Stop', description: 'y' }] }];
  const answered = (id) => [{ type: 'assistant', message: { id: `q-${id}`, content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: goOn } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Your questions have been answered: "Next?"="Go on (Recommended)". You can now continue.' }] } }];
  assert.match(note('ta-first', [auto, readOf(SOLVE), assistantRow('a', fields)], goOn), /`Size: /, 'the code route owes the first stop\'s Size line');
  assert.match(note('ta-win', [auto, readOf('C:\\p\\.claude\\skills\\task-solve\\SKILL.md'), assistantRow('a', fields)], goOn), /`Size: /, 'a Windows path, as the JSON escapes it');
  assert.equal(note('ta-noauto', [readOf(SOLVE), assistantRow('a', fields)], goOn), '', 'a read of the source with no /mode-auto-run row');
  const quoted = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z', content: '<command-name>/mode-auto-run</command-name>' }] } };
  assert.equal(note('ta-quoted', [quoted, readOf(SOLVE), assistantRow('a', fields)], goOn), '', 'a /mode-auto-run quoted in a tool result');
  assert.equal(note('ta-other', [auto, readOf('/p/stack/skills/task-design/SKILL.md'), assistantRow('a', fields)], goOn), '', 'another skill read');
  // the re-read after a compaction keeps the cycle's start: a later turn's stop owes no Size again
  assert.doesNotMatch(note('ta-reread', [auto, readOf(SOLVE), assistantRow('a', `Size: standard - two modules. ${fields}`), ...answered('u1'),
    typed('use the v2 endpoint'), readOf(SOLVE), assistantRow('b', fields)], goOn), /Size/);
});
