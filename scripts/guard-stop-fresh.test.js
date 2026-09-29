// Behavior tests for the stop / answer-length / fresh-session fixes the 154-bundle session audit
// measured (fix family D). Every case here is a real transcript shape: a close the gate MISSED and
// the stall it cost, or a close the gate BLOCKED that asked nothing. Both directions are pinned in
// the same test - a widened regex that also fires on the neighbouring clean close is a worse gate
// than the one it replaces, because a false block teaches the model a bypass it then uses on the
// turn that mattered.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

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
    { type: 'user', message: { role: 'user', content: '<command-name>/alfred-task-solve</command-name>' } },
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
    { type: 'user', message: { role: 'user', content: '<command-name>/alfred-code:alfred-task-solve</command-name>' } },
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
    const name = skill || 'alfred-task-solve';
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
    cmd('alfred-task-solve'), userRow('resume the build cycle, steps 1-3 are stamped'),
  ])), '', "a re-typed run the model never answered is not a run this session already made");

  // ... and the measured chain the trigger exists for still fires: a run, an ANSWER, then a second run.
  assert.match(slash(transcript('ab-real', [
    cmd('alfred-capture-architecture'),
    assistantRow('r1', 'Captured the architecture doc.', FLOOR),
    userRow('now run the task cycle'),
    assistantRow('r2', 'ok', COLD),
    cmd('alfred-task-solve'),
  ])), /ALREADY run one/i, 'a finished prior run, with the model\'s own turn in between, is still the measured chain');

  // `setup` is the guided install and `init` the bootstrap after it (Task 18a): both are
  // multi-phase runs, so both take the offer.
  for (const walk of ['alfred-code:init', 'alfred-code:setup'])
    assert.match(slash(transcript(`ab-${walk.split(':')[1]}`, [
      cmd('alfred-capture-architecture'),
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
  const q = 'do we need to update claude file according to claude stack?';
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
