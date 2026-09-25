// Behavior tests for the guard hooks that had no coverage at all - written from defects the
// 74-session investigation and the hook audit REPRODUCED, so each case pins a real regression:
// a silent evasion the gate exists to stop, or a false positive that blocked honest work.
// Both directions matter: a hook that fires on the wrong turn trains the model to ignore blocks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-hooks-'));
const BIG = path.join(__dirname, 'lint-skills.js'); // a real, long source file in this repo

function run(hook, payload) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8' });
  return r.status;
}
const bash = (hook, command) => run(hook, { tool_name: 'Bash', tool_input: { command } });
const heredoc = (body, target = '/tmp/plan.md') => `cat <<'EOF' > ${target}\n${body}\nEOF`;

function transcript(name, rows) {
  const p = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}
// The context-window layers below read settings.json from the ACCOUNT dir and the project - and a
// real machine's account file names a model like `opus[1m]`, which would silently move every
// threshold assertion in this file. Pin an EMPTY account dir for the whole run; the tests that
// exercise the layers point it at a fixture of their own.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
// ... and a Claude Code session's settings env reaches this process too: the seeded
// ALFRED_CODE_DEFAULT_CONTEXT_WINDOW=1000000 would resolve every unproven window below as 1M.
// The fallback's own test sets it explicitly.
delete process.env.ALFRED_CODE_DEFAULT_CONTEXT_WINDOW;
// Same route, second key: an install of this stack writes ALFRED_CODE_DOCS_PATH into the
// project's settings.json env, which Claude Code exports into every tool call - so a suite run
// inside a stack-INSTALLED checkout resolves the receipt cases below from the SESSION's docs root
// instead of from the case, and the old-spelling fallback case can never take its fallback
// (measured 2026-09-22: red on an installed checkout, green in CI, which installs nothing).
delete process.env.ALFRED_CODE_DOCS_PATH;
delete process.env.CLAUDE_DOCS_PATH;
// envOf (hook-prelude.js, 2.0.0) now answers a bare CLAUDE_STACK_* the same way it answers // legacy-name
// ALFRED_CODE_* - so the same session-env leakage above reaches every 1.x-spelled setting too
// (measured here: CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW=1000000 resolved every unproven window in // legacy-name
// this file as 1M). Strip the whole prefix rather than naming each key by hand.
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_')) delete process.env[k]; // legacy-name
// Every guard appends a block row to `<root>/<docs-path>/hook-blocks/`, where the root falls back
// to the process cwd when CLAUDE_PROJECT_DIR is unset - so a suite run from this checkout forged
// 4MB of field ledger into the repo's own `.claude/docs/hook-blocks/` (measured 2026-09-07: 12,480
// rows in nosession.jsonl alone). Pin a scratch root for the whole run; the cases that exercise the
// ledger, or a gate that reads a receipt under the root, point it at a fixture of their own.
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
// Three cases below deliberately anchor on THIS repo (a real project does not live in the temp
// tree - that is what proves the containment rule, and the cwd fallback), so the root pin cannot
// help them. They redirect the LEDGER instead: an absolute docs root none of those guards reads.
const LEDGER = path.join(TMP, 'ledger');

const assistantRow = (id, text, usage) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage: usage || { cache_read_input_tokens: 10 } } });
// Every fresh-session fixture is TWO rows: the session's own cold FLOOR and then the context being
// measured. Both hooks read both - the offer is made only when what a resume would RECOVER (the
// carry minus the floor a fresh session pays again) is a real share of what a message now costs -
// so a one-row fixture recovers nothing by construction and would pin the opposite behaviour. The
// floor here is 20k; the measured range across the audited projects is 87k-134k, and the case that
// forced this rule is a 103,964 floor tripping a 150,000 trigger after ~55k of real conversation.
const ctxRows = (name, ctx, text) => [
  assistantRow(`${name}-floor`, 'the first turn of this session', { cache_creation_input_tokens: 20000 }),
  assistantRow(name, text || 'ok', { cache_read_input_tokens: ctx }),
];

test('guard-read-whole-file: shell sweeps and runtime reads are dumps', () => {
  assert.equal(bash('guard-read-whole-file.js', 'for f in src/*.cs; do cat -n "$f"; done'), 2, 'loop over a glob');
  assert.equal(bash('guard-read-whole-file.js', 'find . -name "*.cs" -exec cat {} +'), 2, 'find -exec cat');
  assert.equal(bash('guard-read-whole-file.js', 'find . -name "*.cs" | xargs cat'), 2, 'xargs cat');
  assert.equal(bash('guard-read-whole-file.js', `head -n 100000 ${BIG}`), 2, 'head -n <huge>');
  assert.equal(bash('guard-read-whole-file.js', `tail -n +1 ${BIG}`), 2, 'tail -n +1');
  assert.equal(bash('guard-read-whole-file.js', `python3 -c "print(open('${BIG}').read())"`), 2, 'runtime read');
});

test('guard-read-whole-file: targeted reads and doc prose stay silent', () => {
  assert.equal(bash('guard-read-whole-file.js', `head -40 ${BIG}`), 0, 'bounded head');
  assert.equal(bash('guard-read-whole-file.js', `sed -n '50,60p' ${BIG}`), 0, 'ranged sed');
  assert.equal(bash('guard-read-whole-file.js', `grep -n Foo ${BIG}`), 0, 'grep');
  assert.equal(bash('guard-read-whole-file.js', heredoc(`Step 1: cat ${BIG} to check the patterns`)), 0, 'heredoc prose');
});

// The commit gate reads the repo's real diff (a trivial one is exempt by design), so these cases
// need their own dirty repo - keying off this checkout's state made the test pass or fail with it.
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  // a non-trivial diff: past the hook's 2-file / 15-line trivial bar
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'));
  return dir;
}

test('guard-ungated-commit: the receipt must target the gate file, not merely name it', () => {
  const dir = scratchRepo();
  const inRepo = (command) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-ungated-commit.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    cwd: dir,
  }).status;
  assert.equal(inRepo('git commit -am wip'), 2, 'a non-trivial commit with no receipt is blocked');
  assert.equal(inRepo('echo "note: VERIFIED review authorized: go" > notes.txt && git commit -am wip'), 2,
    'prose naming the receipt words in an unrelated file must not satisfy the gate');
  assert.equal(inRepo(heredoc('Step 9: run git commit -F - here')), 0,
    'a plan document describing a commit is data, not a commit');
});

test('guard-protected-force-push / guard-catastrophic-rm: heredoc bodies are data', () => {
  assert.equal(bash('guard-protected-force-push.js', heredoc('Deploy: git push --force origin main')), 0);
  assert.equal(bash('guard-protected-force-push.js', 'git push --force origin main'), 2);
  assert.equal(bash('guard-catastrophic-rm.js', heredoc('Cleanup: rm -rf ~')), 0);
  assert.equal(bash('guard-catastrophic-rm.js', 'rm -rf ~'), 2);
});

test('guard-stop-contract: a decision question in ordinary words is still a stop', () => {
  const q = transcript('q', [assistantRow('m1', "Two options exist for the deploy target: staging or prod. What's the deploy target?")]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: q }), 2);
  const done = transcript('done', [assistantRow('m2', 'Done. Not pushed yet - the branch is ready whenever you are.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: done }), 2, 'declarative step-done close');
});

test('guard-stop-contract: an offer whose object is a DOTTED PATH is still a stop', () => {
  // The object class was `[^.?!\n]`, which excluded every dotted path, so the offers most likely to
  // be made in this repo were exactly the ones the gate could not see. A dot followed by space or
  // end still terminates, so a match cannot span a sentence boundary.
  const offer = (name, text) => run('guard-stop-contract.js',
    { hook_event_name: 'Stop', transcript_path: transcript(name, [assistantRow(name, text)]) });
  assert.equal(offer('dot-claudemd', 'Want me to update CLAUDE.md?'), 2, 'CLAUDE.md');
  assert.equal(offer('dot-gitignore', 'Want me to add the .gitignore entries?'), 2, 'a leading-dot filename');
  assert.equal(offer('dot-pkg', 'Shall I bump package.json?'), 2, 'package.json');
  assert.equal(offer('dot-settings', 'Should I wire it into settings.json?'), 2, 'settings.json');
  assert.equal(offer('dot-plain', 'Want me to run the tests?'), 2, 'the undotted offer still matches');
  assert.equal(offer('dot-boundary', 'I applied the change and the suite is green. Three files moved.'), 0,
    'a dot followed by a space still ends the sentence - no match spans it');
});

test('guard-stop-contract: status about a running job is not a pending decision', () => {
  const ci = transcript('ci', [assistantRow('m3', 'The fix is committed and pushed. Tests are still running in CI.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: ci }), 0);
  const plain = transcript('plain', [assistantRow('m4', 'Here is the summary of what changed: three files, all tests green.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: plain }), 0);
});

test('guard-stop-contract: a suggestion close that says nothing is pending on the run is finished, not a stall', () => {
  // The guided commands end on a next-steps card, not an ask: 'complete' + 'the next step' is the
  // measured stall shape (PENDING_RE reads the singular; a model writing the card freely lands on
  // it), and the one line that resolves it is the disclaimer - without it the same card stays blocked.
  const card = 'Install complete - 9 skills, 4 agents, 11 hooks.\n\nSuggested next steps:\n'
    + '1. Reload the session - the next step everything else depends on; nothing installed this run is live until the MCPs connect.\n'
    + '2. `/alfred-capture-agent-capabilities` - so the generated rule reflects the final inventory.\n\n'
    + 'Nothing is pending on this run - these are yours to run when you choose.';
  const sug = transcript('sug', [assistantRow('m6', card)]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: sug }), 0, 'the disclaimer line makes the close a finished one');
  const bare = transcript('bare', [assistantRow('m7', card.replace(/\n\nNothing is pending[^\n]*$/, ''))]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: bare }), 2, 'the same card without the line is the measured stall');
});

test('guard-stop-contract: a credential shape in a tool result demands the rotate ask - unless the user allowed the read this session', () => {
  // The secret guard's receipt is the user's consent to the value being in the transcript; without
  // honouring it here, every turn after a consented read ended in 'Rotate it now?'.
  const root = fs.mkdtempSync(path.join(TMP, 'projS-'));
  const shape = 'ghp_' + 'A'.repeat(24); // fake by construction - the SHAPE is what the contract reads
  const tp = transcript('leak', [
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: `TOKEN=${shape}` }] } },
    assistantRow('m9', 'Copied the token into .env as asked; all tests green.'),
  ]);
  const stop = () => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.claude/docs' } });
  const r = stop();
  assert.equal(r.status, 2, 'a shape in a tool result with no consent');
  assert.match(r.stderr, /Rotate it now/);
  const receipt = path.join(root, '.claude', 'docs', 'flow', 'SECRET-READ-ALLOW');
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, '*\n');
  assert.equal(stop().status, 0, 'the consented exposure is not re-asked');
  const old = (Date.now() - 9 * 3600 * 1000) / 1000; fs.utimesSync(receipt, old, old);
  assert.equal(stop().status, 2, 'a stale receipt is no consent');
});

test('guard-stop-contract: the rotate ask is asked ONCE per exposure, and ALFRED_CODE_ROTATE_ASK=0 turns it off', () => {
  // Every turn after an exposure re-demanded the ask - the shape stays in the transcript, so the
  // detector kept firing on a decision the user had already made. An answered rotate ask now covers
  // every credential already in the session; only a NEW exposure after it asks again.
  const root = fs.mkdtempSync(path.join(TMP, 'projR-'));
  const shape = 'ghp_' + 'B'.repeat(24); // fake by construction
  const leak = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `TOKEN=${shape}` }] } };
  const answered = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Your questions have been answered: "A GitHub token (ghp_ shape) entered this session through a tool result. Rotate it now?"="Acknowledge and defer"' }] } };
  // pushes the answer out of askJustAnswered's 8KB tail, so the once-per-exposure rule is what is judged
  const filler = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'x'.repeat(9000) }] } };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.claude/docs' };
  const stop = (name, rows, extra = {}) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: transcript(name, rows) }, { env: { ...env, ...extra } });
  assert.equal(stop('r1', [leak, assistantRow('a1', 'Wired the token as asked; tests green.')]).status, 2, 'the first exposure asks');
  const quiet = stop('r2', [leak, answered, filler, assistantRow('a2', 'Deferred as you chose. Remember to rotate the token when you get to it; the rest is done.')]);
  assert.equal(quiet.status, 0, 'an answered rotate ask covers the exposure - even a later close that names rotation');
  const second = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: `OTHER=${'ghp_' + 'C'.repeat(24)}` }] } };
  const again = stop('r3', [leak, answered, filler, second, assistantRow('a3', 'Copied the second token as asked; done.')]);
  assert.equal(again.status, 2, 'a NEW exposure after the answer asks again');
  assert.match(again.stderr, /once/, 'and says the ask comes once');
  assert.match(again.stderr, /ALFRED_CODE_ROTATE_ASK=0/, 'and names the switch');
  assert.equal(stop('r4', [leak, assistantRow('a4', 'Wired the token as asked; tests green.')], { ALFRED_CODE_ROTATE_ASK: '0' }).status, 0, 'the switch turns the ask off');
});

test('guard-stop-contract: one turn split across rows sharing a message.id is judged whole', () => {
  // The defect this pins: keeping only the LAST row read a thinking-only fragment as the turn and
  // passed a real decision stop - measured in six audited sessions.
  const split = transcript('split', [
    { type: 'assistant', message: { id: 'm5', content: [{ type: 'text', text: 'Weighing the options.' }], usage: { cache_read_input_tokens: 10 } } },
    { type: 'assistant', message: { id: 'm5', content: [{ type: 'text', text: 'Which one should we go with - A or B?' }], usage: { cache_read_input_tokens: 10 } } },
  ]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: split }), 2);
});

test('guard-fresh-session-start: gates orchestration runs only, and only past the threshold', () => {
  // 450k PROVES the 1M tier (no request holds more input tokens than the window), which resolves
  // the window and puts it past that tier's 400k trigger. 180k would prove nothing and make no offer.
  // One transcript per gated assertion: the size offer is made once per SESSION and then honoured
  // until the context grows 1.5x, so replaying three names against one transcript would measure the
  // re-arm, not the gate. Three sessions, each starting an orchestration run on carried history.
  const hot = (n) => transcript(`hot-${n}`, ctxRows(`m6-${n}`, 450000));
  const cold = transcript('cold', ctxRows('m7', 50000));
  const call = (skill, tp) => run('guard-fresh-session-start.js', { tool_name: 'Skill', tool_input: { skill }, transcript_path: tp });
  assert.equal(call('alfred-loop-quality', hot('a')), 2, 'orchestration run on carried history');
  assert.equal(call('alfred-code:alfred-loop-quality', hot('b')), 2, 'namespaced form');
  assert.equal(call('alfred-issue-diagnoser', hot('c')), 2, 'the gated diagnosis flow chained onto carried history');
  assert.equal(call('alfred-loop-quality', cold), 0, 'under the threshold');
  assert.equal(call('csharp', hot('d')), 0, 'an ordinary skill is never gated');
});

test('guard-fresh-session-start: the size offer is answerable - the retry passes, growth re-arms it', () => {
  // The denial mandates an AskUserQuestion whose second answer is 'run it here anyway with the cost
  // stated', and until 0.2.74 nothing honoured that answer: no receipt, no state, no re-arm, so the
  // retry re-blocked on the identical call (measured 2026-09-12: replayed twice, exit 2 both times).
  // A guard that denies the route its own denial offers is the failure DISCARD-ALLOW was bought for
  // on the rm guard; the sibling Stop-route offer already re-arms on 1.5x growth, so this does too.
  const logDir = fs.mkdtempSync(path.join(TMP, 'fresh-rearm-'));
  const env = { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir } };
  // ONE transcript throughout: the offer is remembered per session, so growth has to be written
  // into the same file a real session would grow.
  const tp = transcript('rearm', ctxRows('rearm', 450000));
  const grow = (ctx) => fs.writeFileSync(tp, ctxRows('rearm', ctx).map((r) => JSON.stringify(r)).join('\n') + '\n');
  const call = () => runIn('guard-fresh-session-start.js',
    { tool_name: 'Skill', tool_input: { skill: 'alfred-loop-quality' }, transcript_path: tp }, env).status;
  assert.equal(call(), 2, 'the offer is made once');
  assert.equal(call(), 0, 'the identical retry passes - the answer is honoured');
  grow(500000);
  assert.equal(call(), 0, 'still inside 1.5x of the offered context');
  grow(700000);
  assert.equal(call(), 2, 'past 1.5x growth the number changed, so the question is new');
});

// The trigger is an absolute token count PER WINDOW TIER, one environment variable each. The
// percentage it replaces was inert at its default on both real tiers - 200k x 40% fell under the
// floor and 1M x 40% sat over the ceiling - so the clamps decided and the knob lied.
test('guard-fresh-session-start: the trigger is the tier\'s own variable', () => {
  const at = (name, ctx) => transcript(name, ctxRows(name, ctx));
  const call = (tp, env) => runIn('guard-fresh-session-start.js',
    { tool_name: 'Skill', tool_input: { skill: 'alfred-loop-quality' }, transcript_path: tp },
    { env: { ...process.env, ...(env || {}) } }).status;

  // The window comes from ONE place, model-windows.json, keyed by the session's model id (these
  // fixtures carry no message.model, so the settings model answers). A model the table lacks takes
  // ALFRED_CODE_DEFAULT_CONTEXT_WINDOW, unset here, so the DEFAULT trigger.
  const w1m = (env) => ({ CLAUDE_CONFIG_DIR: accountDir('tier-1m', 'claude-opus-5'), ...(env || {}) });
  const w200 = (env) => ({ CLAUDE_CONFIG_DIR: accountDir('tier-200k', 'claude-haiku-4-5'), ...(env || {}) });
  // 200k tier: ALFRED_CODE_FRESH_SESSION_200K, default 150,000 (the measured figure).
  assert.equal(call(at('w-200k-140', 140000), w200()), 0, '140k is under the 200k tier default');
  assert.equal(call(at('w-200k-160', 160000), w200()), 2, '160k is past it');
  assert.equal(call(at('w-200k-110', 110000), w200({ ALFRED_CODE_FRESH_SESSION_200K: '100000' })), 2, 'the tier variable moves it');
  // A window that cannot be read is not guessed at: it takes ALFRED_CODE_FRESH_SESSION_DEFAULT,
  // 180,000 - a figure REACHABLE on the smallest window it could be applied to. At 250,000 it sat
  // above a 200k window entirely, so an unreadable window on that tier could never trip the gate.
  assert.equal(call(at('w-undeclared', 170000)), 0, '170k with nothing declared is under the 180k default');
  assert.equal(call(at('w-undeclared-190k', 190000)), 2, '190k is past it - on a 200k window that is 95% full, and the gate must still reach it');
  assert.equal(call(at('w-undeclared-260k', 260000)), 2, 'no model and no fallback: 260k is past the DEFAULT trigger - usage proves nothing any more');
  assert.equal(call(at('w-bare-sonnet-260k', 260000), { CLAUDE_CONFIG_DIR: accountDir('tier-bare', 'claude-sonnet-5') }), 0, 'Sonnet 5 on a bare id is 1M by its table row - 260k is under 400k');
  assert.equal(call(at('w-200k-row-260k', 260000), w200()), 2, 'a 200k row is the answer even at a carry that window could not hold');
  assert.equal(call(at('w-undeclared-160k', 160000), { ALFRED_CODE_FRESH_SESSION_DEFAULT: '150000' }), 2, 'the default variable moves it');
  assert.equal(call(at('w-undeclared-190k-off', 190000), { ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' }), 0, '0 switches the unreadable-window offer off');
  assert.equal(call(at('w-suffix-190k', 190000), { CLAUDE_CONFIG_DIR: accountDir('tier-suffix', 'opus[1m]') }), 2,
    'a [1m] suffix on an alias is not read - opus is no table row, so the DEFAULT trigger');
  // 1M tier: ALFRED_CODE_FRESH_SESSION_1M, default 400,000 - deliberately above the harness's own
  // auto-compaction band (387,619-397,171 measured), so the Stop offer there is usually unreachable
  // and the SessionStart compact route carries it instead. Lower the variable to be asked earlier.
  assert.equal(call(at('w-1m-395k', 395000), w1m()), 0, '395k is under the 1M tier default');
  assert.equal(call(at('w-1m-450k', 450000), w1m()), 2, '450k is past it');
  assert.equal(call(at('w-1m-450k-nodecl', 450000), { ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' }), 0,
    'without a model id it is not the 1M tier - it is the default one, off here');
  assert.equal(call(at('w-1m-260k', 260000), w1m({ ALFRED_CODE_FRESH_SESSION_1M: '250000' })), 2, 'the tier variable moves it');
  assert.equal(call(at('w-1m-450k-off', 450000), w1m({ ALFRED_CODE_FRESH_SESSION_1M: '0' })), 0, '0 switches that tier off');
  assert.equal(call(at('w-1m-450k-pct0', 450000), w1m({ CLAUDE_STACK_FRESH_SESSION_PCT: '0' })), 2, 'the retired percentage key is dead - it is no longer an off switch'); // legacy-name
});

// ---- hooks audit: every gate branch pinned in both directions (block AND the exemption) ----
const runIn = (hook, payload, opts) =>
  spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });
const BIG_LINES = fs.readFileSync(BIG, 'utf8').replace(/\n$/, '').split('\n').length; // lines, not newline-split pieces
const SMALL = path.join(HOOKS, 'instrument-tool-usage.js'); // 74 lines - the smallest shipped hook,
// deliberately not one of the guards: they grow, and a fixture that drifts past 200 lines turns
// two unrelated read-guard assertions red (measured: the fresh-session hook crossed it).
const REPO = path.join(__dirname, '..');
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A seeded repo whose HEAD sits on a named branch (the force-push guard reads HEAD for a bare push).
function scratchRepoOn(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n'); git('add', '-A'); git('commit', '-qm', 'seed');
  return dir;
}
// A seeded repo with a CLEAN tree - tests dirty it the way they need.
function cleanRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n'); git('add', '-A'); git('commit', '-qm', 'seed');
  return dir;
}
const gateIn = (dir, command, env = {}) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command } }, {
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }, cwd: dir,
}).status;
const forty = () => Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');

test('guard-read-whole-file: the Read matcher gates whole-file shapes and the cumulative cap', () => {
  const read = (input, session_id) => run('guard-read-whole-file.js', { tool_name: 'Read', tool_input: input, session_id });
  assert.equal(read({ file_path: BIG }), 2, 'no offset/limit');
  assert.equal(read({ file_path: BIG, offset: 1, limit: 2000 }), 2, 'a limit spanning the file is a whole-file Read');
  assert.equal(read({ file_path: BIG, offset: 1, limit: BIG_LINES }), 2, 'limit = the line count');
  assert.equal(read({ file_path: BIG, offset: 50, limit: 40 }), 0, 'a ranged read');
  assert.equal(read({ file_path: SMALL }), 0, 'a small file reads whole');
  assert.equal(read({ file_path: path.join(REPO, 'CLAUDE.md') }), 0, 'a non-source file is not gated');
  assert.equal(read({ file_path: '/nope/missing.ts' }), 0, 'a missing file lets Read surface its own error');
  const sid = `cap-${process.pid}-${Date.now()}`;
  const third = Math.floor(BIG_LINES * 0.3);
  assert.equal(read({ file_path: BIG, offset: 1, limit: third }, sid), 0, 'first 30%');
  assert.equal(read({ file_path: BIG, offset: third + 1, limit: third }, sid), 0, 'second 30% - at the cap');
  assert.equal(read({ file_path: BIG, offset: 2 * third + 1, limit: third }, sid), 2, 'third 30% reconstructs the file');
  assert.equal(read({ file_path: BIG, offset: 2 * third + 1, limit: third }, `${sid}-other`), 0, 'the cap is per session');
});

test('guard-read-whole-file: runtime dumps, file redirects, multi-file cats and unresolvable paths on Bash', () => {
  const noRoot = { ...process.env, CLAUDE_PROJECT_DIR: '', ALFRED_CODE_DOCS_PATH: LEDGER };
  assert.equal(bash('guard-read-whole-file.js', `node -e "console.log(require('fs').readFileSync('${BIG}','utf8'))"`), 2, 'node readFileSync dump');
  assert.equal(bash('guard-read-whole-file.js', `ruby -e "puts File.read('${BIG}')"`), 2, 'ruby File.read dump');
  assert.equal(bash('guard-read-whole-file.js', `cat ${BIG} > ${path.join(TMP, 'copy.js')}`), 0, 'a redirect into a file is a copy, not a dump');
  assert.equal(bash('guard-read-whole-file.js', `cat ${BIG} 2>&1`), 2, 'an fd redirect still prints');
  assert.equal(bash('guard-read-whole-file.js', `cat ${SMALL} ${BIG}`), 2, 'every file of a multi-file cat is sized');
  const rel = (payload, cwd) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', ...payload }, { cwd, env: noRoot }).status;
  assert.equal(rel({ tool_input: { command: 'cat scripts/lint-skills.js' } }, TMP), 2, 'a relative path that resolves nowhere fails CLOSED');
  assert.equal(rel({ tool_input: { command: 'cat scripts/lint-skills.js' }, cwd: REPO }, TMP), 2, 'anchored on the session cwd it is sized - and blocked');
  assert.equal(rel({ tool_input: { command: 'cat stack/hooks/instrument-tool-usage.js' }, cwd: REPO }, TMP), 0, 'anchored and small - passes');
});

test('guard-protected-force-push: the protected-branch matrix', () => {
  const fp = (c) => bash('guard-protected-force-push.js', c);
  for (const c of ['git push origin :main', 'git push -d origin develop', 'git push origin +main', 'git -C /tmp/x push --force origin master',
    'git push --mirror origin', 'git push origin "main" --force', 'git push --force origin refs/heads/main', 'npm test && git push --force origin main',
    'git push origin HEAD:main --force', 'git push -uf origin main', 'git push --force-with-lease=main:abc origin main', 'git push --all --force',
    'GIT_SSH_COMMAND=ssh git push -f origin main', 'git push -f origin main; echo done', "git push origin 'main' -d"]) {
    assert.equal(fp(c), 2, `must block: ${c}`);
  }
  for (const c of ['git push --force-with-lease origin feature/x', 'git push origin main', 'git push origin feature:main', 'git push --follow-tags origin main',
    'echo "git push --force origin main"', 'git commit -m "no git push --force to main"', 'git push origin --delete feature/x', 'git push -u origin feature/x']) {
    assert.equal(fp(c), 0, `must allow: ${c}`);
  }
});

test('guard-protected-force-push: a bare force targets HEAD, judged from the session cwd', () => {
  const dir = scratchRepoOn('main');
  const fp = (c, cwd) => run('guard-protected-force-push.js', { tool_name: 'Bash', tool_input: { command: c }, cwd });
  assert.equal(fp('git push -f', dir), 2, 'bare -f on main');
  assert.equal(fp('git push', dir), 0, 'a plain push to main is fast-forward work');
  spawnSync('git', ['-C', dir, 'checkout', '-qb', 'feature/z']);
  assert.equal(fp('git push -f', dir), 0, 'bare -f on a feature branch');
  assert.equal(fp('git push -f', TMP), 0, 'outside a repo the guard fails open');
});

test('guard-protected-force-push: HEAD and @ are the current branch, and -C or a cd moves where it is read', () => {
  // `git push -f origin HEAD` on main is the bare force spelled out, and passed (reproduced), as did a
  // bare force run through `git -C <repo>` from outside it.
  const dir = scratchRepoOn('main');
  const fp = (c, cwd) => runIn('guard-protected-force-push.js', { tool_name: 'Bash', tool_input: { command: c }, cwd }, {});
  for (const c of ['git push -f origin HEAD', 'git push --force origin @', 'git push origin +HEAD', 'git push -d origin HEAD'])
    assert.equal(fp(c, dir).status, 2, `must block on main: ${c}`);
  assert.equal(fp(`git -C ${dir} push -f`, TMP).status, 2, 'a -C names the repo the bare force runs in');
  assert.equal(fp(`cd ${dir} && git push -f`, TMP).status, 2, 'and so does a cd before it');
  assert.match(fp('git push -f origin HEAD', dir).stderr, /^Blocked: /, 'the denial opens on the word the analyzer counts');
  assert.equal(fp('git push origin HEAD', dir).status, 0, 'a plain push of HEAD is fast-forward work');
  spawnSync('git', ['-C', dir, 'checkout', '-qb', 'feature/y']);
  assert.equal(fp('git push -f origin HEAD', dir).status, 0, 'HEAD on a feature branch is the feature branch');
  assert.equal(fp('git push -f origin HEAD:main', dir).status, 2, 'an explicit protected destination still blocks');
});

test('guard-catastrophic-rm: the catastrophic-target matrix', () => {
  const rm = (c) => bash('guard-catastrophic-rm.js', c);
  for (const c of ['rm -rf /', 'rm -rf /*', 'rm -rf /usr /lib', 'rm -rf .', 'rm -rf ./', 'rm -rf *', 'rm -rf "$HOME"/*', 'rm -rf ${HOME}',
    'rm -rf /home/../', 'rm -rf $PWD', 'sudo rm -rf /', 'cd x && rm -rf *', 'rm --recursive ~/', 'rm -rf -- /', 'rm -r -f "/"',
    'rm -rf dist; rm -rf /', 'rm -rf ..', 'rm -rf ../*', 'rm -rf a/../..']) {
    assert.equal(rm(c), 2, `must block: ${c}`);
  }
  for (const c of ['rm -rf bin obj node_modules', 'git commit -m "rm -rf /"', 'rm -f /', 'rm -rf ./build/*', 'rm -rf /tmp/*', 'rm -rf ~/projects',
    'echo rm -rf /', 'rm -rf ./build 2>&1', 'rm -rf /usr/', 'find . -name "*.o" -delete']) {
    assert.equal(rm(c), 0, `must allow: ${c}`);
  }
});

test('guard-ungated-commit: untracked-only new files are churn, not an empty tree', () => {
  // The defect this pins: `git diff HEAD` never lists untracked files, so a feature landing in
  // new files only read as 'nothing to commit' and passed ungated (reproduced).
  const dir = cleanRepo();
  for (const f of ['n1.txt', 'n2.txt', 'n3.txt']) fs.writeFileSync(path.join(dir, f), forty());
  assert.equal(gateIn(dir, 'git add -A && git commit -m "feat: new module"'), 2, 'three 40-line new files are not trivial');
  fs.unlinkSync(path.join(dir, 'n2.txt')); fs.unlinkSync(path.join(dir, 'n3.txt')); fs.writeFileSync(path.join(dir, 'n1.txt'), 'one line\n');
  assert.equal(gateIn(dir, 'git add -A && git commit -m "add note"'), 0, 'one small new file is the trivial class');
});

test('guard-ungated-commit: trivial diffs, clean trees, non-commits and non-repos pass', () => {
  const dir = cleanRepo();
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a clean tree - let git say so');
  fs.appendFileSync(path.join(dir, 'seed.txt'), 'fix\n');
  assert.equal(gateIn(dir, 'git commit -am typo'), 0, 'one file, one line');
  assert.equal(gateIn(dir, 'git log --grep commit'), 0, 'not a commit');
  assert.equal(gateIn(TMP, 'git commit -am x'), 0, 'outside a repo the guard fails open');
});

test('guard-ungated-commit: the receipt states', () => {
  const dir = scratchRepo();
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const gate = path.join(dir, '.claude', 'docs', 'flow', 'COMMIT-GATE');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const receipt = (s) => fs.writeFileSync(gate, s);
  // the conformant receipt, and the pieces each clause removes from it
  const full = (over = {}) => [
    over.first || 'VERIFIED the pre-commit checkpoint',
    over.auth === null ? null : (over.auth || 'authorized: "commit it"'),
    over.head === null ? null : `head: ${over.head || head}`,
    over.spec === null ? null : (over.spec || 'spec: 3 files'),
    over.probe === null ? null : (over.probe || 'live-probe: `npm test` 238/238'),
  ].filter((l) => l != null).join('\n') + '\n';

  receipt('WAIVED - "skip the review"\n'); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'WAIVED');
  receipt('WAIVED\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'WAIVED with no quoted words');
  receipt(full()); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'the conformant receipt');
  receipt('VERIFIED scope\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'VERIFIED without the authorized line');
  receipt(full({ auth: 'authorized: yes' })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'an authorized line with no quoted words');
  receipt(full({ auth: 'authorized: PENDING - append the words' })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a PENDING placeholder');
  receipt(full({ auth: 'authorized: ""' })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'an EMPTY quoted span');
  receipt(full({ auth: 'authorized: "what time is it?"' })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a quote carrying no consent verb');
  receipt(full({ auth: 'answered: option 1 "Commit now"' })); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'consent given by picking an option has its own spelling');
  receipt(full({ head: '0'.repeat(40) })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a head: naming a different commit');
  receipt(full({ head: head.slice(0, 8) })); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a short sha is the same sha');
  receipt(full({ head: null })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'no head: line');
  receipt(full({ spec: null })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'no spec: line');
  receipt(full({ spec: 'spec: 1 file' })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a spec covering fewer files than the tree has');
  receipt(full({ probe: null })); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'no live-probe line');
  receipt(full({ probe: 'live probe = NOT RUN - no test target' })); assert.equal(gateIn(dir, 'git commit -am x'), 0, "'live probe' spelled with a space, NOT RUN with a reason");
  // the denial itself lists `live_probe` among the accepted spellings - a model that followed it
  // retried into the same block
  receipt(full({ probe: 'live_probe: `npm test` 12/12' })); assert.equal(gateIn(dir, 'git commit -am x'), 0, "'live_probe' is the third spelling the denial names");
  // the VERIFIED line names a verify skill and this transcript carries no Skill call
  const tp = transcript('no-skill', [assistantRow('m1', 'reviewed')]);
  const gateT = (cmd) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: cmd }, transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir }).status;
  receipt(full({ first: 'VERIFIED alfred-task-verify-code passed' })); assert.equal(gateT('git commit -am x'), 2, 'a verify skill named but never called');
  receipt(full({ first: 'VERIFIED alfred-task-verify-code passed' }) + 'carried: cycle 3, reviewed 2026-09-05\n');
  assert.equal(gateT('git commit -am x'), 0, 'unless the receipt says the review is carried');
  // the 2.0.0 loop names - `quality-loop` matched the 1.x spelling only, so a receipt naming the
  // renamed loop minted consent with no loop ever run
  receipt(full({ first: 'VERIFIED alfred-loop-quality round 2 gate' })); assert.equal(gateT('git commit -am x'), 2, 'a quality loop named but never called');
  receipt(full({ first: 'VERIFIED alfred-loop-architecture-quality stage 3' })); assert.equal(gateT('git commit -am x'), 2, 'the architecture loop too');
  // ... while a loop the user TYPED is a run of it: a slash invocation writes no Skill call at all
  // (measured: 4 of 4 slash-run loops, zero Skill events), only the harness's command row
  const slash = transcript('slash-loop', [{ type: 'user', message: { role: 'user', content: '<command-name>/alfred-code:alfred-loop-quality</command-name>' } }, assistantRow('m1', 'round 2 green')]);
  const gateS = (cmd) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: cmd }, transcript_path: slash },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir }).status;
  assert.equal(gateS('git commit -am x'), 0, 'a slash-invoked loop ran');

  receipt(full());
  const old = (Date.now() - 3 * 3600 * 1000) / 1000; fs.utimesSync(gate, old, old);
  assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a 3h-old receipt is absent');
  receipt('garbage\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'an unrecognized first line');
  fs.unlinkSync(gate);
  // the atomic write+commit shape carries its receipt - and answers to the SAME contract, or it
  // would be the cheapest way to skip every clause above
  const atomic = full().trim().replace(/\n/g, '\\n');
  assert.equal(gateIn(dir, `printf '${atomic}\\n' > .claude/docs/flow/COMMIT-GATE && git commit -am x`), 0, 'the atomic write+commit shape carries its receipt');
  assert.equal(gateIn(dir, `printf 'VERIFIED x\\nauthorized: "go"\\n' > .claude/docs/flow/COMMIT-GATE && git commit -am x`), 2, 'the atomic shape gets no lighter contract');
  assert.equal(gateIn(dir, `echo 'VERIFIED x' > .claude/docs/flow/COMMIT-GATE && git commit -am x`), 2, 'atomic VERIFIED without authorized:');
  assert.equal(gateIn(dir, 'git commit -am "COMMIT-GATE VERIFIED authorized: x > flow/COMMIT-GATE"'), 2, 'receipt words inside the commit message');
  fs.mkdirSync(path.join(dir, 'docs', 'flow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'flow', 'COMMIT-GATE'), 'WAIVED - "go"\n');
  assert.equal(gateIn(dir, 'git commit -am x', { ALFRED_CODE_DOCS_PATH: 'docs' }), 0, 'the receipt is looked up under ALFRED_CODE_DOCS_PATH');
  // the pre-0.2.43 spelling still resolves, so an install the rename has not reached keeps working
  assert.equal(gateIn(dir, 'git commit -am x', { CLAUDE_DOCS_PATH: 'docs' }), 0, 'the old key is read as a fallback');
  assert.equal(gateIn(dir, 'git commit -am x', { ALFRED_CODE_DOCS_PATH: 'docs', CLAUDE_DOCS_PATH: 'nowhere' }), 0, 'and the new key wins when both are set');
});

test('guard-ungated-commit: an option label THIS run wrote is not the user asking', () => {
  // measured: `authorized: "Commit now (Recommended)"` - marker and all - prescribed by a skill,
  // while the hook's own denial text demanded 'their words, verbatim'. The marker proves nothing
  // either way (the harness stores the marked label as the answer), so it is stripped before the
  // comparison and the LABEL ITSELF is what disqualifies the quote.
  const dir = scratchRepo();
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const gate = path.join(dir, '.claude', 'docs', 'flow', 'COMMIT-GATE');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const tp = transcript('own-label', [
    { type: 'assistant', message: { id: 'q1', content: [{ type: 'tool_use', id: 'u1', name: 'AskUserQuestion', input: { questions: [{ question: 'Next?', options: [{ label: 'Commit now (Recommended)', description: 'land it' }, { label: 'Hold', description: 'wait' }] }] } }] } },
  ]);
  const body = (auth) => `VERIFIED the checkpoint\n${auth}\nhead: ${head}\nspec: 3 files\nlive-probe: npm test\n`;
  const gateT = () => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir }).status;
  fs.writeFileSync(gate, body('authorized: "Commit now (Recommended)"')); assert.equal(gateT(), 2, 'the model\'s own option label, marker included');
  fs.writeFileSync(gate, body('authorized: "Commit now"')); assert.equal(gateT(), 2, 'and with the marker stripped');
  fs.writeFileSync(gate, body('answered: Commit now')); assert.equal(gateT(), 0, 'the same choice, spelled as the answer it was');
  fs.writeFileSync(gate, body('authorized: "ok commit it and push"')); assert.equal(gateT(), 0, 'the user\'s own typed words are untouched');
});

test('guard-ungated-commit: a cd or -C into a sibling repo judges THAT tree', () => {
  const home = cleanRepo();
  const sib = scratchRepo();
  assert.equal(gateIn(home, 'git commit -am x'), 0, 'the clean home repo passes');
  assert.equal(gateIn(home, `cd ${sib} && git commit -am x`), 2, 'cd into the dirty sibling');
  assert.equal(gateIn(home, `git -C "${sib}" commit -am x`), 2, '-C into the dirty sibling');
  // the PowerShell tool moves its cwd with Set-Location (or its sl / Push-Location spellings), and
  // the matcher claims that route - a sibling commit behind it was judged against the clean home
  const ps = (command) => runIn('guard-ungated-commit.js', { tool_name: 'PowerShell', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: home }, cwd: home }).status;
  assert.equal(ps(`Set-Location ${sib}; git commit -am x`), 2, 'Set-Location into the dirty sibling');
  assert.equal(ps(`sl '${sib}'; git commit -am x`), 2, 'the sl alias');
  assert.equal(ps(`Push-Location -Path "${sib}"; git commit -am x`), 2, 'Push-Location with its -Path name');
  assert.equal(ps('git commit -am x'), 0, 'the clean home still passes on PowerShell');
});

test('guard-ungated-commit: a first push denial opens on the gate, not on git\'s own errors', () => {
  // a branch with no upstream is the usual FIRST push - the @{u} probes print `fatal: no upstream`
  // and the denial the model reads started with two lines of it
  const dir = scratchRepo();
  const r = runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git push origin HEAD' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  assert.equal(r.status, 2, 'still gated');
  assert.doesNotMatch(r.stderr, /^fatal:/m, 'no git noise in the reason');
  assert.match(r.stderr, /^Blocked/, 'the reason leads');
});

// A clone with a real upstream, so `git log @{u}..HEAD` answers - the publish gate's
// nothing-to-publish exemption reads it.
function pushRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  spawnSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')], { encoding: 'utf8' });
  const dir = path.join(base, 'repo');
  spawnSync('git', ['clone', '-q', path.join(base, 'remote.git'), dir], { encoding: 'utf8' });
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
  return dir;
}

test('guard-ungated-commit: nothing gated a push, and a quoted publish verb is still prose', () => {
  // Four bundles: `git push` and `gh pr merge` passed EVERY guard on replay. One session's first
  // state-changing act published unpushed commits 18 minutes before any receipt existed, and 40
  // files reached a shared develop ungated. The gate ships with the heredoc + quote masking or it
  // reproduces the measured 430,740-token false positive - a report write denied for QUOTING a
  // merge command.
  const dir = pushRepo();
  const flow = path.join(dir, '.claude', 'docs', 'flow');
  fs.mkdirSync(flow, { recursive: true });
  const receipt = (s) => (s === null ? fs.rmSync(path.join(flow, 'PUSH-GATE'), { force: true }) : fs.writeFileSync(path.join(flow, 'PUSH-GATE'), s));
  const ahead = () => { fs.appendFileSync(path.join(dir, 'a.txt'), 'more\n'); spawnSync('git', ['-C', dir, 'commit', '-qam', 'work'], { encoding: 'utf8' }); };

  assert.equal(gateIn(dir, 'git push'), 0, 'nothing ahead of the upstream publishes nothing');
  ahead();
  assert.equal(gateIn(dir, 'git push'), 2, 'commits ahead, no receipt');
  assert.equal(gateIn(dir, 'git push --dry-run'), 0, 'a dry run publishes nothing');
  assert.equal(gateIn(dir, 'git push -n'), 0, '... and so does -n');
  assert.equal(gateIn(dir, 'gh pr merge 12 --squash'), 2, 'a merge lands code on the default branch');

  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  // the publish receipt answers to the same contract as the commit one - the spec names the set
  // LEAVING the machine, so it is required but never counted against the working tree
  const pushOk = (auth = 'authorized: "push it"') =>
    `VERIFIED the release merge\n${auth}\nhead: ${head}\nspec: 2 commits on develop\nlive-probe: npm test green\n`;
  receipt('VERIFIED the release merge\n');
  assert.equal(gateIn(dir, 'git push'), 2, 'VERIFIED without the authorized line is not consent');
  receipt(pushOk('authorized: "what time is it?"'));
  assert.equal(gateIn(dir, 'git push'), 2, 'a quote carrying no publish verb is not consent either');
  receipt(pushOk().replace(/^head:.*\n/m, ''));
  assert.equal(gateIn(dir, 'git push'), 2, 'no head: line');
  receipt(pushOk());
  assert.equal(gateIn(dir, 'git push'), 0, 'the conformant publish receipt');
  receipt('WAIVED - "just push"\n');
  assert.equal(gateIn(dir, 'git push'), 0, 'an explicit waiver');
  const old = (Date.now() - 3 * 3600 * 1000) / 1000;
  fs.utimesSync(path.join(flow, 'PUSH-GATE'), old, old);
  assert.equal(gateIn(dir, 'git push'), 2, 'a 3h-old receipt is absent');
  receipt(null);
  const atomicPush = pushOk().trim().replace(/\n/g, '\\n');
  assert.equal(gateIn(dir, `printf '${atomicPush}\\n' > .claude/docs/flow/PUSH-GATE && git push`), 0,
    'the atomic write+publish shape carries its own receipt');
  assert.equal(gateIn(dir, `printf 'VERIFIED x\\nauthorized: "go"\\n' > .claude/docs/flow/PUSH-GATE && git push`), 2,
    '... and gets no lighter contract than the file');
  assert.equal(gateIn(dir, 'git push', { ALFRED_CODE_PUSH_GATE: '0' }), 0, 'the switch turns the publish half off');

  // the false-positive class this gate must never reproduce
  assert.equal(gateIn(dir, "cat > report.md <<'EOF'\nThen run `gh pr merge 12 --squash` and `git push`.\nEOF"), 0,
    'a report that QUOTES a publish verb is prose - the 430,740-token false positive');
  assert.equal(gateIn(dir, 'echo "then git push to develop"'), 0, 'so is an echo');
  assert.equal(gateIn(dir, "grep -o 'git push' transcript.jsonl"), 0, 'so is a grep for push events');
  assert.equal(gateIn(dir, 'git commit -m "prep for git push"'), 0, 'a clean tree fires neither gate');
  fs.writeFileSync(path.join(dir, 'big.txt'), forty());
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  assert.equal(gateIn(dir, 'git commit -m "prep for git push"'), 2, 'and a dirty one fires the COMMIT gate, not the publish one');
});

test('guard-catastrophic-rm: git destroys a working tree too, and prose about it does not', () => {
  // 225 lines with no occurrence of `git`: a destructive `git checkout --` replayed exit 0 against
  // every guard in the stack. Gated on ACTUAL loss - a clean tree has nothing to destroy.
  const dir = cleanRepo();
  const rm = (command) => runIn('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir }).status;

  assert.equal(rm('git checkout -- .'), 0, 'a CLEAN tree has nothing to lose');
  assert.equal(rm('git reset --hard'), 0, '... same');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'changed\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x\n');
  assert.equal(rm('git checkout -- .'), 2, 'a dirty tree loses work with no reflog');
  assert.equal(rm('git checkout .'), 2, 'the pathless spelling too');
  assert.equal(rm('git restore seed.txt'), 2, 'and restore');
  assert.equal(rm('git reset --hard HEAD'), 2, 'and reset --hard');
  assert.equal(rm('git clean -fdx'), 2, 'and clean -fdx');
  assert.equal(rm('git restore --staged seed.txt'), 0, 'unstaging destroys nothing');
  assert.equal(rm('git checkout -b feature'), 0, 'a branch checkout is not a discard');
  assert.equal(rm('git reset HEAD~1'), 0, 'a soft reset keeps the tree');
  // a quoted span is data - denying it teaches the obfuscation that defeats the gate on a real one
  assert.equal(rm('echo "run git reset --hard"'), 0, 'an echo quoting it invokes nothing');
  assert.equal(rm("grep -o 'git checkout --' t.jsonl"), 0, 'nor does a grep pattern');
  assert.equal(rm('git commit -m "undo the git reset --hard"'), 0, 'nor a commit message');
  assert.equal(rm("cat > plan.md <<'EOF'\nThen: git clean -fdx\nEOF"), 0, 'nor a plan document');
  assert.equal(rm('echo "careful" && git clean -fdx'), 2, 'but a real one after a prose mention still blocks');
});

test('guard-catastrophic-rm: the gate reads the PATHSPEC, and honours a discard receipt', () => {
  // The gate asked only 'is the tree dirty', which made its own prescribed escape - 'name the ONE
  // file to revert instead of the whole tree' - unreachable: `git restore .gitignore` was denied
  // with all seven dirty files listed, six of which the command never touched (measured twice).
  const dir = cleanRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n');
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-qm', 'two files'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one changed\n');          // only a.txt is dirty
  const rm = (command) => runIn('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });

  assert.equal(rm('git restore b.txt').status, 0, 'a CLEAN path has nothing to lose, dirty tree or not');
  assert.equal(rm('git restore a.txt').status, 2, 'the dirty one it names is still blocked');
  assert.equal(rm('git checkout -- .').status, 2, 'and the whole tree keeps the old arithmetic');
  assert.match(rm('git restore a.txt').stderr, /the path\(s\) this command names/, 'the denial says which scope it judged');

  // every other blocking guard honours an answer; this one re-blocked a discard the user had just
  // chosen, and the chosen action was silently substituted with a `git stash push -u`
  assert.match(rm('git restore a.txt').stderr, /DISCARD-ALLOW/, 'the denial names the receipt');
  const flow = path.join(dir, '.claude', 'docs', 'flow');
  fs.mkdirSync(flow, { recursive: true });
  fs.writeFileSync(path.join(flow, 'DISCARD-ALLOW'), '# the user answered Discard it\na.txt\n');
  assert.equal(rm('git restore a.txt').status, 0, 'the receipt is honoured for the path it names');
  assert.equal(rm('git checkout -- .').status, 2, 'but it does not cover the whole tree');
  fs.writeFileSync(path.join(flow, 'DISCARD-ALLOW'), '*\n');
  assert.equal(rm('git checkout -- .').status, 0, 'the * line does');
  fs.utimesSync(path.join(flow, 'DISCARD-ALLOW'), new Date(Date.now() - 9 * 3600 * 1000), new Date(Date.now() - 9 * 3600 * 1000));
  assert.equal(rm('git checkout -- .').status, 2, 'a receipt older than 8h reads as absent');
});

test('guard-catastrophic-rm: a forced checkout or switch, a stash drop or clear and a reflog expire lose work too', () => {
  // Five verbs with no undo walked past the four the gate knew (reproduced on a dirty tree): a forced
  // branch change overwrites the tree, a dropped stash and an expired reflog are the recovery points.
  // The same arithmetic: gated on what the call would actually destroy, answered by DISCARD-ALLOW.
  const dir = cleanRepo();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('branch', 'other');
  const rm = (command) => runIn('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });

  for (const c of ['git checkout -f other', 'git switch -f other', 'git switch --discard-changes other', 'git stash clear', 'git stash drop'])
    assert.equal(rm(c).status, 0, `nothing to lose yet: ${c}`);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'changed\n');
  for (const c of ['git checkout -f other', 'git checkout --force', 'git checkout -qf other', 'git switch -f other',
    'git switch --force other', 'git switch --discard-changes other', 'git -C . checkout -f other'])
    assert.equal(rm(c).status, 2, `a dirty tree is overwritten: ${c}`);
  assert.match(rm('git switch -f other').stderr, /DISCARD-ALLOW/, 'the denial names the receipt');
  for (const c of ['git switch -c fresh', 'git checkout other', 'git switch other', 'git stash list', 'git stash push -m keep'])
    assert.equal(rm(c).status, 0, `keeps the work: ${c}`);

  git('stash', 'push', '-qm', 'keep');                            // the tree is clean, one stash holds the work
  for (const c of ['git stash clear', 'git stash drop', 'git stash drop stash@{0}', 'git stash drop 0', "git stash drop 'stash@{0}'"])
    assert.equal(rm(c).status, 2, `a stash with work in it: ${c}`);
  assert.equal(rm('git stash drop stash@{4}').status, 0, 'an entry that does not exist loses nothing');
  assert.equal(rm('git stash pop').status, 0, 'pop drops only what it applied');
  assert.match(rm('git stash clear').stderr, /stash@\{0\}/, 'the denial lists the entries it would destroy');
  assert.equal(rm('echo "then git stash clear"').status, 0, 'a quoted mention is prose');

  assert.equal(rm('git reflog expire --expire=now --all').status, 2, 'expiring every reflog entry now removes the recovery points');
  assert.equal(rm('git reflog expire --all').status, 0, 'the default 90-day window prunes nothing in a fresh repo');
  assert.equal(rm('git reflog show').status, 0, 'reading the reflog loses nothing');

  const flow = path.join(dir, '.claude', 'docs', 'flow');
  fs.mkdirSync(flow, { recursive: true });
  fs.writeFileSync(path.join(flow, 'DISCARD-ALLOW'), 'stash@{0}\n');
  assert.equal(rm('git stash drop').status, 0, 'the receipt names the entry the user chose to drop');
  assert.equal(rm('git reflog expire --expire=now --all').status, 2, 'and covers nothing else');
  fs.writeFileSync(path.join(flow, 'DISCARD-ALLOW'), '*\n');
  assert.equal(rm('git reflog expire --expire=now --all').status, 0, 'the * line does');
});

test('guard-catastrophic-rm: a SQL DROP or an EF database drop is counted, never denied', () => {
  // Count first (the user's direction): a probe row per call, so the block rate a gate would have is
  // measured before one is built.
  const dir = cleanRepo();
  const sid = 'probe-sql';
  const rm = (command) => runIn('guard-catastrophic-rm.js', { session_id: sid, tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  const ledger = path.join(dir, '.claude', 'docs', 'hook-blocks', `${sid}.jsonl`);
  const rows = () => (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

  assert.equal(rm('psql -c "DROP TABLE users"').status, 0, 'a probe never denies');
  assert.equal(rm('dotnet ef database drop --force').status, 0);
  assert.equal(rm('sqlite3 app.db "drop database x"').status, 0);
  assert.equal(rm('ls -la').status, 0);
  const got = rows();
  assert.equal(got.length, 3, 'one row per drop-shaped call, none for the rest');
  for (const r of got) {
    assert.equal(r.mode, 'probe');
    assert.match(r.reason, /^probe: /);
  }
  assert.deepStrictEqual(got.map((r) => r.kind), ['sql-drop', 'ef-database-drop', 'sql-drop']);
  assert.equal(got[0].detail.client, 'psql', 'the client that ran it is named, so prose can be told from execution');
});

test('guard-catastrophic-rm: the pathspec is judged where the command runs - its cwd, a cd, a -C', () => {
  // Judged from the project root, a dirty file one folder down read as absent, so the discard passed.
  const dir = cleanRepo();
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'a.txt'), 'one\n');
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-qm', 'sub'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(sub, 'a.txt'), 'changed\n');
  const rm = (command, cwd) => runIn('guard-catastrophic-rm.js', { tool_name: 'Bash', cwd, tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir }).status;

  assert.equal(rm('git checkout -- a.txt', sub), 2, 'the payload cwd is where git resolves the path');
  assert.equal(rm('git -C sub restore a.txt', dir), 2, 'a -C moves it');
  assert.equal(rm('cd sub && git checkout -- a.txt', dir), 2, 'a cd before it moves it');
  assert.equal(rm('git checkout -- seed.txt', dir), 0, 'a clean path at the root still passes');
});

test('guard-catastrophic-rm: the PowerShell spellings and the Windows roots', () => {
  for (const c of ['Remove-Item -Recurse -Force ~', 'Remove-Item -Recurse -Force $HOME', 'Remove-Item -Recurse -Force C:\\',
    'rm -r -fo $env:USERPROFILE', 'ri -Recurse C:/', 'Remove-Item C:\\* -Recurse', 'del -Recurse -Force .'])
    assert.equal(pwsh('guard-catastrophic-rm.js', c), 2, `must block: ${c}`);
  for (const c of ['rm -rf C:/', 'rm -rf /c/', 'rm -rf /c', 'rm -rf /cygdrive/c', 'rm -rf /mnt/c/'])
    assert.equal(bash('guard-catastrophic-rm.js', c), 2, `must block: ${c}`);
  for (const c of ['Remove-Item -Recurse -Force ./dist', 'Remove-Item -Force *', 'rm -Force *.log', 'Remove-Item -Recurse ./logs -Include *',
    'Remove-Item -Recurse -Force C:\\build\\out'])
    assert.equal(pwsh('guard-catastrophic-rm.js', c), 0, `must allow: ${c}`);
  assert.equal(bash('guard-catastrophic-rm.js', 'rm -rf \\*'), 0, 'a backslash-escaped star is a file named *, not a glob');
});

test('guard-read-whole-file: the extension is judged against the PATH, not the whole line', () => {
  // Every one of these was replayed as a false positive: GATED_EXT_ANY was tested against the WHOLE
  // compound command at three sites, and the sweep test ran above the per-segment loop.
  const big = BIG;
  assert.equal(bash('guard-read-whole-file.js', `ls src/*.js && head -40 ${big}`), 0,
    'an unrelated *.js glob in a SIBLING segment denies nothing');
  assert.equal(bash('guard-read-whole-file.js', `grep -rn "x" --include='*.cs' . | head -20 && wc -l ${big}`), 0,
    'a bounded grep beside a glob is not a dump');
  assert.equal(bash('guard-read-whole-file.js', `find . -name "guard-read-whole-file.js" && grep -n "THRESHOLD" ${big} | head -20`), 0,
    'an exact-filename find names ONE file - the know-the-name-not-the-path idiom its own denial used to advise');
  assert.equal(bash('guard-read-whole-file.js', 'head -n 100000 notes.txt # about Foo.cs'), 0,
    'a huge head of a NON-gated file is not gated by a .cs mention elsewhere');
  assert.equal(bash('guard-read-whole-file.js', `python3 -c "print(open('notes.txt').read())" # Foo.cs`), 0,
    'nor is a runtime read of one');
  assert.equal(bash('guard-read-whole-file.js', `cat ${big} > /tmp/copy.js`), 0,
    'a redirected dump never reaches the context');
  // and the sweeps still block
  assert.equal(bash('guard-read-whole-file.js', 'for f in src/*.cs; do cat -n "$f"; done'), 2, 'a loop still blocks');
  assert.equal(bash('guard-read-whole-file.js', 'find . -name "*.cs" -exec cat {} +'), 2, 'a globbed find -exec cat still blocks');
});

test('guard-unapproved-dispatch: the stamp lifecycle', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const disp = (seat, env = {}) => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env } }).status;
  assert.equal(disp('aspnet-implementer'), 2, 'implementer with no stamp');
  assert.equal(disp('aspnet-solution-designer'), 0, 'a designer needs no stamp');
  assert.equal(disp('general-purpose'), 0, 'a generic seat outside a flow');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go ahead"\n');
  assert.equal(disp('aspnet-implementer'), 0, 'stamped');
  assert.equal(disp('general-purpose'), 2, 'a generic seat while a flow is stamped');
  assert.equal(disp('claude'), 2, 'the other generic seat');
  // a fork inherits the WHOLE parent context - the most expensive dispatch there is, and the one
  // seat no gate looked at (measured: 869,483 cache-read for a read-only grep job)
  assert.equal(disp('fork'), 2, 'a fork is a generic seat while a flow is stamped');
  assert.equal(disp('Explore'), 0, 'a read-only built-in');
  assert.equal(disp('aspnet-verifier'), 0, 'a verifier');
  fs.writeFileSync(gate, 'AUTO - "run without stops"\n'); assert.equal(disp('wpf-implementer'), 0, 'the AUTO waiver');
  fs.writeFileSync(gate, 'approved maybe\n'); assert.equal(disp('wpf-implementer'), 2, 'a first line that is neither APPROVED nor AUTO');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  const old = (Date.now() - 9 * 3600 * 1000) / 1000; fs.utimesSync(gate, old, old);
  assert.equal(disp('wpf-implementer'), 2, 'a 9h-old stamp is absent');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  assert.equal(disp('wpf-implementer', { ALFRED_CODE_DOCS_PATH: 'docs' }), 2, 'the stamp is looked up under ALFRED_CODE_DOCS_PATH');
});

// Spike S1 run 4: a plugin agent is addressable ONLY as `<plugin>:<agent>` - the bare name returns
// 'Agent type not found'. So from the release that ships the seats as plugins, every house dispatch
// arrives prefixed, and a gate keyed on the bare name would stop gating anything at all.
test('guard-unapproved-dispatch: a scoped house seat is the same seat, a foreign one is not', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const disp = (seat) => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status;
  assert.equal(disp('wpf-implementer'), 2, 'bare - the copy route and cursor-stack');
  assert.equal(disp('claude-stack-wpf:wpf-implementer'), 2, 'scoped to a per-stack plugin');
  assert.equal(disp('alfred-code:wpf-implementer'), 2, 'scoped to the core plugin');
  // Gating this one would block a tool the user chose with a message about a flow it has no part
  // in - it carries no APPROVAL convention, so there is nothing for the stamp to authorize.
  assert.equal(disp('someoneelse:their-implementer'), 0, 'a FOREIGN plugin implementer is not this flow\'s seat');
  // A hyphenated foreign plugin name, carrying a REAL house seat name after the colon, is still
  // judged by its PREFIX, not by whether the seat name happens to match - the legacy claude-stack // legacy-name
  // spelling must not widen HOUSE_PREFIX into matching any hyphenated home.
  assert.equal(disp('someone-else:wpf-implementer'), 0, 'a hyphenated FOREIGN plugin is still foreign');
  assert.equal(disp('claude-stack-wpf:wpf-verifier'), 0, 'a scoped verifier still needs no stamp');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go ahead"\n');
  assert.equal(disp('claude-stack-wpf:wpf-implementer'), 0, 'and the stamp releases the scoped seat too');
});

test("guard-unapproved-dispatch: a stamp written before this session began is another session's consent", () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  pause(50);
  const tp = path.join(root, 'session.jsonl');
  fs.writeFileSync(tp, '{}\n'); pause(20); fs.appendFileSync(tp, '{}\n'); // born after the stamp, then grown like a real transcript
  const disp = () => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: 'wpf-implementer' }, transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status;
  assert.equal(disp(), 2, 'the stamp predates the session');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  assert.equal(disp(), 0, 'a stamp written during the session');
});

test('guard-stop-contract: the AskUserQuestion branch injects and NEVER denies', () => {
  // It used to deny an ask carrying no fresh-session option, which stopped Claude mid-response to
  // rebuild the question. The matcher is wired again, injection-only: every path exits 0, and what
  // it emits is `hookSpecificOutput.additionalContext` the model reads while building the ask.
  const logDir = fs.mkdtempSync(path.join(TMP, 'asklog-'));
  const hot = transcript('ask-hot', [assistantRow('h1', 'ok', { cache_read_input_tokens: 900000 })]);
  const cold = transcript('ask-cold', [
    { type: 'user', message: { content: 'clean up the branch' } },
    { type: 'assistant', message: { id: 'c1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git status --porcelain' } }], usage: { cache_read_input_tokens: 900 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'M f' }] } },
  ]);
  const ask = (tp, questions) => runIn('guard-stop-contract.js',
    { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', transcript_path: tp, tool_input: { questions } },
    { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir } });
  const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };

  const deep = ask(hot, [{ question: 'Which next?', options: [{ label: 'Continue', description: 'x' }, { label: 'Stop', description: 'y' }] }]);
  assert.equal(deep.status, 0, 'no fresh option, deep into a 1M session - it injects, it does not deny');
  assert.match(ctxOf(deep), /resume in a fresh session/i, 'the fresh-session offer reaches a flow whose every stop is a tool call');
  assert.equal(ask(hot, [{ question: 'Continue or resume in a fresh session?', options: [{ label: 'Fresh session', description: 'resume' }] }]).status, 0);
  assert.doesNotMatch(ctxOf(ask(hot, [{ question: 'Next?', options: [{ label: 'Resume in a fresh session', description: 'start clean' }] }])), /add an option to/i,
    'an ask that already offers it is not told to offer it');

  // stale scope: an option naming repo state, with no state read in this turn
  const stale = ask(transcript('ask-stale', [assistantRow('s1', 'ok', { cache_read_input_tokens: 900 })]),
    [{ question: 'Publish?', options: [{ label: 'Push to origin', description: 'land the commit' }] }]);
  assert.match(ctxOf(stale), /no `git status`/, 'an ask built on an unrefreshed scope is flagged');
  assert.doesNotMatch(ctxOf(ask(cold, [{ question: 'Publish?', options: [{ label: 'Push to origin', description: 'land it' }] }])), /no `git status`/,
    'a state read in the same turn clears it');

  // house voice, on a surface no Stop hook reads
  const voice = ask(cold, [{ question: 'Target - staging or prod?', header: 'Target', options: [{ label: 'staging', description: 'the shared box' }] }]);
  assert.equal(ctxOf(voice), '', "a plain hyphen and an apostrophe are clean - and a clean ask emits nothing at all");
  assert.match(ctxOf(ask(cold, [{ question: 'Pick one \u2014 now', options: [{ label: 'the "fast" one', description: 'x' }] }])),
    /em- or en-dash.*double quote/s, 'an em-dash and a double quote in the ask text are both named');

  // two typed turns before one reply - the contradicted-recommendation shape
  const two = ask(transcript('ask-two', [
    { type: 'user', message: { content: 'stop touching staging' } },
    { type: 'user', message: { content: 'and add the health endpoint' } },
    assistantRow('t1', 'ok', { cache_read_input_tokens: 900 }),
  ]), [{ question: 'Which one?', options: [{ label: 'Deploy staging', description: 'x' }] }]);
  assert.match(ctxOf(two), /more than one message before this reply/);
});

test('guard-stop-contract: prose offers, tool-call ends, continuations and unreadable turns', () => {
  const stop = (tp, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, ...extra });
  assert.equal(stop(transcript('p1', [assistantRow('a', 'Patch is ready. Say the word and I will push it.')])), 2, "'say the word'");
  assert.equal(stop(transcript('p2', [assistantRow('a', 'All green. Want me to open the PR?')])), 2, "'want me to'");
  assert.equal(stop(transcript('p3', [{ type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'Want me to push?' }, { type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }])), 0, 'ended on a tool call');
  assert.equal(stop(transcript('p4', [assistantRow('a', 'Want me to push?')]), { stop_hook_active: true }), 0, 'a continuation we caused');
  assert.equal(stop(path.join(TMP, 'absent-stop.jsonl')), 0, 'missing transcript');
  assert.equal(stop(transcript('p5', [{ type: 'assistant', message: { id: 'c', content: [{ type: 'thinking', thinking: 'hm' }] } }])), 0, 'no text at all');
  assert.equal(stop(transcript('p6', [assistantRow('a', 'Is it safe? Yes - the guard fails closed.')])), 0, 'a question answered in the same breath');
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'PreCompact' }), 0, 'an unrelated event');
});

test('guard-stop-contract: the quality loop\'s mode ask and stage-close ask in prose are sent to ONE AskUserQuestion; the same words through the tool pass', () => {
  // alfred-loop-quality's two structural pauses are sentences in its SKILL.md (improvement plan 2.5):
  // worded as a statement they end on no '?', so the question shape alone never caught them.
  const stop = (tp) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp });
  const prose = (id, text) => stop(transcript(id, [assistantRow('a', text)]));
  assert.equal(prose('ql-m1', 'DISCOVERY is next. Run the pipeline inline in this session, or dispatch the audit and fix seats - pick one and I start.'), 2, 'the mode ask as a statement');
  assert.equal(prose('ql-m2', 'Which mode: inline or delegated.'), 2, "'which mode' with no question mark");
  assert.equal(prose('ql-s1', 'Stage 01 reached SATISFIED on pass 3 and RUN-STATE.md is written. Continue in a fresh session from the loops folder (recommended), or continue here.'), 2, 'the stage-close ask as a statement');
  assert.equal(prose('ql-s2', 'Close this stage and resume fresh, or keep going here.'), 2, "'close this stage' with no question mark");
  // The same words handed to the tool: the turn ends on the AskUserQuestion call, which is the contract.
  const viaTool = transcript('ql-t', [{ type: 'assistant', message: { id: 'q', content: [
    { type: 'text', text: 'Stage 01 reached SATISFIED on pass 3 and RUN-STATE.md is written.' },
    { type: 'tool_use', id: 'u', name: 'AskUserQuestion', input: { questions: [{ question: 'Continue in a fresh session from the loops folder, or continue here?', header: 'Stage close', multiSelect: false, options: [{ label: 'Fresh session (Recommended)', description: 'resume from the loops folder' }, { label: 'Continue here', description: 'keep this context' }] }] } },
  ] } }]);
  assert.equal(stop(viaTool), 0, 'the ask made through the tool');
  // A record of an answer already given is no ask.
  assert.equal(prose('ql-r1', 'Mode: DELEGATED - the user chose to dispatch the audit and fix seats. Stage 01 started.'), 0, 'the mode, recorded');
  assert.equal(prose('ql-r2', 'Stage 01: SATISFIED on pass 3, continue: fresh - "fresh session". The resume block is below.'), 0, 'the stage outcome, recorded');
});

test('guard-stop-contract: last_assistant_message wins over a lagging transcript', () => {
  // The harness documents the transcript as written asynchronously: here it still holds the
  // PREVIOUS turn's clean close while the payload field carries this turn's decision stop.
  const lag = transcript('lag', [assistantRow('old', 'Fixed and committed; nothing pending.')]);
  const stop = (extra) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: lag, ...extra });
  assert.equal(stop({}), 0, 'the transcript alone reads clean');
  assert.equal(stop({ last_assistant_message: 'Two options for the deploy target. Which one should we go with?' }), 2, 'the field carries the decision stop');
  assert.equal(stop({ last_assistant_message: 'Fixed and committed; nothing pending.' }), 0, 'a clean close in the field');
  assert.equal(stop({ last_assistant_message: '' }), 0, 'an empty field falls back to the transcript');
});

test('guard-fresh-session-start: other tools, unreadable transcripts, the name field and the exact threshold', () => {
  const hot = transcript('fs-hot', ctxRows('m', 190000));   // past the 150k floor
  // The window is RESOLVED here (a 200k model id): this test pins the boundary, and an unresolved
  // window now makes no offer at all, which would mask every one of these branches behind the same 0.
  const call = (payload) => runIn('guard-fresh-session-start.js', payload,
    { env: { ...process.env, CLAUDE_CONFIG_DIR: accountDir('fs-thresh-200k', 'claude-haiku-4-5') } }).status;
  assert.equal(call({ tool_name: 'Read', tool_input: { file_path: 'x.ts' }, transcript_path: hot }), 0, 'not a Skill call');
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'alfred-loop-quality' }, transcript_path: path.join(TMP, 'absent-fs.jsonl') }), 0, 'no transcript - fail open');
  assert.equal(call({ tool_name: 'Skill', tool_input: { name: 'alfred-task-solve' }, transcript_path: hot }), 2, 'the name field spelling');
  const edge = transcript('fs-edge', ctxRows('m', 150000));
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'alfred-task-solve' }, transcript_path: edge }), 0, 'exactly 150k is not past it');
  const sum = transcript('fs-sum', [ctxRows('m', 0)[0], assistantRow('m', 'ok', { cache_read_input_tokens: 100000, cache_creation_input_tokens: 40000, input_tokens: 10001 })]);
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'alfred-task-solve' }, transcript_path: sum }), 2, 'the three usage fields add up');
});

test('instrument-tool-usage: off by default, one JSONL row per call when switched on, never blocks', () => {
  const log = path.join(TMP, 'ledger.jsonl');
  const inst = (payload, env) => runIn('instrument-tool-usage.js', payload, { env: { ...process.env, ALFRED_CODE_INSTRUMENT_LOG: log, ...env } }).status;
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '0' }), 0);
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '' }), 0);
  assert.equal(fs.existsSync(log), false, 'nothing is written while the switch is off');
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1', cwd: '/x' }, { ALFRED_CODE_INSTRUMENT: '1' }), 0);
  assert.equal(inst({ tool_name: 'Bash', tool_input: { command: 'cat secret', description: 'run tests' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: 'true' }), 0);
  assert.equal(inst({ tool_name: 'mcp__plugin_serena_serena__find_symbol', tool_input: {}, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '1' }), 0);
  // a dispatch row names the SEAT (65 of 65 Agent rows were detail-blind), and a Bash call whose
  // description the model omitted falls back to the VERB - never a path or an argument
  assert.equal(inst({ tool_name: 'Task', tool_input: { subagent_type: 'architecture-analyzer', prompt: 'characterize /secret/module' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '1' }), 0);
  assert.equal(inst({ tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '1' }), 0);
  assert.equal(inst({ tool_name: 'Bash', tool_input: { command: 'cat /home/me/.env' }, session_id: 's1' }, { ALFRED_CODE_INSTRUMENT: '1' }), 0);
  const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.tool, r.detail]), [['Read', 'c.ts'], ['Bash', 'run tests'], ['mcp__plugin_serena_serena__find_symbol', 'serena'],
    ['Task', 'architecture-analyzer'], ['Bash', 'git commit'], ['Bash', 'cat']]);
  assert.ok(!JSON.stringify(rows).includes('secret'), 'a command body is never logged');
  assert.ok(!JSON.stringify(rows).includes('.env'), '... and neither is a path the fallback saw');
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'instrument-tool-usage.js')], { input: 'not json', encoding: 'utf8',
    env: { ...process.env, ALFRED_CODE_INSTRUMENT: '1', ALFRED_CODE_INSTRUMENT_LOG: log } }).status, 0, 'bad input never blocks');
  const root = fs.mkdtempSync(path.join(TMP, 'inst-'));
  assert.equal(inst({ tool_name: 'Grep', tool_input: { pattern: 'x' }, session_id: 'sid/../up' },
    { ALFRED_CODE_INSTRUMENT: '1', ALFRED_CODE_INSTRUMENT_LOG: '', CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: 'docs' }), 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'docs', 'tools-usage')), ['sid..up.jsonl'], 'default ledger under the docs root, session id sanitized');
});

test('guard-unapproved-dispatch: a symbol question never goes to a grep-shaped seat', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const disp = (seat, prompt) => runIn('guard-unapproved-dispatch.js',
    { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status;

  // the measured case: a C# symbol hunt handed to the built-in Explore, which greps
  assert.equal(disp('Explore', 'Find who calls SocketConnection.Send'), 2, 'callers question');
  assert.equal(disp('Explore', 'Where is ISocketFactory declared?'), 2, 'declaration question');
  assert.equal(disp('Explore', 'find the class SocketConnection'), 2, 'named-symbol hunt');
  assert.equal(disp('general-purpose', 'list all usages of AddSocketServices'), 2, 'the generic seat too');

  // the denial names the deferred tools AND the one line that loads them - naming a tool is not having it
  const denied = runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'Find who calls SocketConnection.Send' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert.match(denied.stderr, /ToolSearch select:mcp__plugin_serena_serena__find_symbol,mcp__plugin_serena_serena__find_referencing_symbols,mcp__plugin_serena_serena__get_symbols_overview/, 'the loading line');

  // a real sweep still passes - no stamp involved, so this is the no-flow path
  assert.equal(disp('Explore', 'Map the auth module and report which files configure logging'), 0, 'a broad sweep');
  assert.equal(disp('Explore', 'x'), 0, 'an empty brief');
  assert.equal(disp('aspnet-verifier', 'who calls Foo'), 0, 'a named seat carries serena itself');
});

// An Agent call with no subagent_type runs the built-in general-purpose seat (the docs: 'When Claude
// calls the Agent tool without a subagent_type, it gets the built-in general-purpose subagent'), so
// leaving the field out was a way around both generic gates - the same brief blocked when typed.
test('guard-unapproved-dispatch: an untyped dispatch is the general-purpose seat it runs as', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const untyped = (prompt) => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { prompt } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert.equal(untyped('Find who calls SocketConnection.Send').status, 2, 'a symbol question with the seat left out');
  assert.equal(untyped('Implement the endpoint in Orders.cs').status, 0, 'no flow stamped - a generic seat is free');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go ahead"\n');
  const r = untyped('Implement the endpoint in Orders.cs');
  assert.equal(r.status, 2, 'a stamped flow refuses the untyped generic seat');
  assert.match(r.stderr, /general-purpose/, 'the denial names the seat that would have run');
});

test('guard-stop-contract: the fresh-session offer lands at turn end, once per cost step', () => {
  const logDir = fs.mkdtempSync(path.join(TMP, 'freshstop-'));
  const at = (name, ctx, text) => transcript(name, ctxRows(name, ctx, text || 'Applied the change; tests pass.'));
  const stop = (tp) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir } }).status;

  assert.equal(stop(at('fs-cold', 170000)), 0, '170k with no readable window is under the 180k default - nothing to offer');
  const s1 = at('fs-hot', 500000);
  assert.equal(stop(s1), 2, 'a CLEAN close past the trigger: held once so the user is asked');
  assert.equal(stop(s1), 0, 'the same session again - already asked at this cost step');
  assert.equal(stop(at('fs-hot', 700000)), 0, 'still under 1.5x of the last offer');
  assert.equal(stop(at('fs-hot', 760000)), 2, 're-armed at the next cost step');
  assert.equal(stop(at('fs-fresh', 900000, 'Done. Worth continuing in a fresh session from the plan file.')), 0,
    'a turn that already made the offer is left alone');
  assert.equal(stop(at('fs-other', 500000)), 2, 'another session is asked on its own first clean close');
});

test('guard-stop-contract: the tier variable at 0 turns the offer off', () => {
  // A `parseInt(...) || 40` fallback used to swallow the 0 and re-enable what the user disabled;
  // the tier variables keep that property (0 is an answer, garbage takes the default).
  const tp = transcript('fs-off', ctxRows('fs-off', 900000, 'Applied the change; tests pass.'));
  const w1m = { CLAUDE_CONFIG_DIR: accountDir('fs-off-1m', 'claude-opus-5') };
  // a fresh state dir per call: the offer is made ONCE per session, so a shared one would answer
  // every assertion after the first with the already-asked 0 rather than with the tier's verdict
  const stop = (extra) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'freshoff-')), ...extra } }).status;

  // the settings model is claude-opus-5, a 1M table row, so that tier's trigger applies
  assert.equal(stop({ ...w1m, ALFRED_CODE_FRESH_SESSION_1M: '0' }), 0, '0 on the trigger this session uses disables the offer outright');
  assert.equal(stop(w1m), 2, 'and the same session still qualifies at the 1M default');
  assert.equal(stop({ ...w1m, ALFRED_CODE_FRESH_SESSION_DEFAULT: '0', ALFRED_CODE_FRESH_SESSION_200K: '0' }), 2, 'the other tiers\' switches do not reach it');
  assert.equal(stop({ ...w1m, CLAUDE_STACK_FRESH_SESSION_PCT: '0' }), 2, 'and the retired percentage key is not read at all'); // legacy-name
  const acct1m = fs.mkdtempSync(path.join(TMP, 'stopoff-1m-'));
  fs.writeFileSync(path.join(acct1m, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));
  assert.equal(stop({ CLAUDE_CONFIG_DIR: acct1m, ALFRED_CODE_FRESH_SESSION_1M: '0' }), 0, 'a readable 1M window reads its own switch');
});

// --- guard-cross-project-write: one session, one project -------------------
// Both directions carry equal weight here: a gate that fires on an ordinary in-project write
// would block almost every turn, so the passes are as load-bearing as the blocks.
const XP_ROOT = fs.mkdtempSync(path.join(TMP, 'projA-'));
const XP_OTHER = fs.mkdtempSync(path.join(TMP, 'projB-'));
const xp = (payload) => {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: XP_ROOT, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' },
  });
  return r.status;
};
const xpWrite = (file) => xp({ tool_name: 'Write', tool_input: { file_path: file } });
const xpBash = (command) => xp({ tool_name: 'Bash', tool_input: { command } });

test('guard-cross-project-write: a write into another project is blocked', () => {
  assert.equal(xpWrite(path.join(XP_OTHER, 'src', 'a.ts')), 2, 'an absolute path in the sibling repo');
  assert.equal(xpWrite('../projB/src/a.ts'), 2, 'the same reach expressed relatively');
  assert.equal(xp({ tool_name: 'Edit', tool_input: { file_path: path.join(XP_OTHER, 'a.cs') } }), 2, 'Edit too');
  assert.equal(xp({ tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(XP_OTHER, 'a.ipynb') } }), 2, 'and NotebookEdit');
});

test('guard-cross-project-write: the shell routes around the file tools the same way', () => {
  assert.equal(xpBash(`echo x > ${path.join(XP_OTHER, 'f.txt')}`), 2, 'redirection into the other repo');
  assert.equal(xpBash('printf y >> ../projB/f.txt'), 2, 'appending, relative');
  assert.equal(xpBash(`cp build/out.js ${path.join(XP_OTHER, 'vendor', 'out.js')}`), 2, 'a copy destination');
  assert.equal(xpBash(`git -C ${XP_OTHER} commit -m "fix"`), 2, 'a commit in another checkout');
  assert.equal(xpBash(`rm -rf ${path.join(XP_OTHER, 'dist')}`), 2, 'a delete outside the project');
  assert.equal(xpBash(`sed -i.bak 's/a/b/' ${path.join(XP_OTHER, 'f.txt')}`), 2, 'an in-place edit');
  // `mv` removes its SOURCE, so an out-of-tree source is a write there even when the
  // destination is local - a destination-only rule waves this through.
  assert.equal(xpBash(`mv ${path.join(XP_OTHER, 'a.txt')} ./b.txt`), 2, 'moving a file OUT of the other project');
  assert.equal(xpBash('mv src/a.ts src/b.ts'), 0, 'but our own rename is ordinary work');
});

test('guard-cross-project-write: reading and investigating the other project stays open', () => {
  // The whole point of the gate is that the handoff card must be SPECIFIC, which takes reading B.
  assert.equal(xpBash(`cat ${path.join(XP_OTHER, 'src', 'a.ts')}`), 0, 'reading a file there');
  assert.equal(xpBash(`grep -rn "Foo" ${XP_OTHER}`), 0, 'searching there');
  assert.equal(xpBash(`git -C ${XP_OTHER} log --oneline -5`), 0, 'read-only git in the other checkout');
  assert.equal(xpBash(`git -C ${XP_OTHER} diff HEAD~1`), 0, 'and a diff');
  assert.equal(xp({ tool_name: 'Read', tool_input: { file_path: path.join(XP_OTHER, 'a.ts') } }), 0, 'Read is not even matched');
});

test('guard-cross-project-write: ordinary in-project work is never touched', () => {
  assert.equal(xpWrite(path.join(XP_ROOT, 'src', 'a.ts')), 0, 'an absolute path inside the project');
  assert.equal(xpWrite('src/a.ts'), 0, 'a relative path inside the project');
  assert.equal(xpBash('echo x > out.txt'), 0, 'redirection to a relative file');
  assert.equal(xpBash('npm test 2>&1 | tail -3'), 0, '2>&1 is not a file target');
  assert.equal(xpBash('node build.js > dist/bundle.js'), 0, 'a build output inside the tree');
  assert.equal(xpBash("sed -i.bak 's/a/b/' src/a.ts"), 0, 'an in-place edit of our own file');
  assert.equal(xpBash('rm -rf node_modules'), 0, 'cleaning our own tree');
  assert.equal(xpBash('mkdir -p src/nested'), 0, 'making our own directory');
});

test('guard-cross-project-write: the session\'s own scratch and the account dir stay writable', () => {
  // A real project does not live in the temp tree, so this case runs with THIS repo as the
  // root - the fixtures above deliberately do, which is what proves the containment rule.
  const repoRoot = path.join(__dirname, '..');
  const inRepo = (payload) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', ALFRED_CODE_DOCS_PATH: LEDGER } }).status;
  const w = (f) => inRepo({ tool_name: 'Write', tool_input: { file_path: f } });

  assert.equal(w(path.join(os.tmpdir(), 'scratch', 'notes.md')), 0, 'the harness scratchpad');
  assert.equal(inRepo({ tool_name: 'Bash', tool_input: { command: 'echo x > /tmp/probe.txt' } }), 0, 'a temp file from the shell');
  const home = os.homedir();
  if (home) assert.equal(w(path.join(home, '.claude', 'projects', 'p', 'memory', 'm.md')), 0, 'memory writes must keep working');
  assert.equal(w(path.join(path.dirname(repoRoot), 'some-other-repo', 'src', 'a.ts')), 2, 'a real sibling repo is still blocked');
});

test('guard-cross-project-write: the session cleaning its own scratch is not a cross-project write', () => {
  // Every shape here was replayed as a false positive against a real session's own scratch.
  // in-project on purpose: the defect was the TOKENIZER, which split `"$SP"/run*.log` into two
  // words and read the second as a path at the filesystem root - so the target's real location is
  // what the assertion has to isolate.
  const sp = path.join(XP_ROOT, 'scratch');
  assert.equal(xpBash(`SP=${sp}; rm -f "$SP"/run*.log`), 0,
    'a quoted var with an unquoted suffix is ONE word - splitting it made `/run*.log` an absolute path (3 bundles)');
  assert.equal(xpBash('rm -f "$SP"/run*.log'), 0, 'and an unresolved variable is never judged');
  assert.equal(xpBash(`rm -f "${sp}/run.log"`), 0, 'the fully quoted spelling always passed - now all three agree');
  assert.equal(xpBash("sed -i '' '/^DIVIDER$/d' notes.md"), 0, "a sed ADDRESS is a script, not a path");
  // ...and so is a LITERAL address, a substitution and a line address - 3 of 8 audited cross-write
  // blocks were sed scripts judged as out-of-project paths because only a metacharacter address
  // was recognized.
  assert.equal(xpBash("sed -i '' '/ApPermissionGuard/d' notes.md"), 0, 'a literal sed address is a script');
  assert.equal(xpBash("sed -i '' 's/a/b/g' notes.md"), 0, 'a substitution is a script');
  assert.equal(xpBash("sed -i '' '1,$d' notes.md"), 0, 'a line address is a script');
  // the exemption is sed-scoped and stops at the command letters a path would not end in
  assert.equal(xpBash("rm -f /ApPermissionGuard/d"), 2, 'the same token on the rm route is still a path');
  assert.equal(xpBash("sed -i '' 's/a/b/' notes.md"), 0, 'as is a substitution');
  assert.equal(xpBash('rm -f /run*.log'), 0, 'a target whose leading segment is a glob names no project to hand off to');
  // and the real writes still block, including one the variable resolution now makes judgeable
  assert.equal(xpBash(`sed -i 's/a/b/' ${XP_OTHER}/f.ts x`), 2, 'an in-place edit in another project');
  assert.equal(xpBash(`D=${XP_OTHER}; rm -rf "$D"/x`), 2, 'a variable assigned a LITERAL out-of-tree path is judgeable');
});

test('guard-cross-project-write: prose describing a command is not a command', () => {
  // The measured false-positive class: a plan or report that QUOTES a dangerous command is
  // inert text, and blocking the document write for its own prose stalls honest work.
  // The heredoc lands INSIDE the project: this test project lives under os.tmpdir(), and an
  // allowance containing the project root is dropped - so on Linux (tmpdir = /tmp) a /tmp/plan.md
  // target is judged out-of-tree and the body would never be what blocked (measured in CI).
  assert.equal(xpBash(heredoc('Then run: echo x > /etc/hosts', path.join(XP_ROOT, 'plan.md'))), 0, 'a heredoc body is data');
  assert.equal(xpBash(heredoc('plain notes', path.join(XP_OTHER, 'plan.md'))), 2, "the heredoc's own first line still carries its redirect");
  assert.equal(xpBash('echo "writes go to ../projB/f.txt" '), 0, 'a quoted mention is not a redirection');
});

test('guard-cross-project-write: it fails open rather than guessing', () => {
  assert.equal(xpBash('cp a.txt "$OTHER_REPO/a.txt"'), 0, 'an unexpanded variable is not judged');
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: 'not json', encoding: 'utf8' }).status, 0, 'unparseable stdin never blocks');
  const opened = spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(XP_OTHER, 'a.ts') } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: XP_ROOT, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: XP_OTHER },
  }).status;
  assert.equal(opened, 0, 'the escape hatch opens a second tree this project really owns');
});

// --- block telemetry: the block RATE is what says a gate earns its keep ----
// Measured 2026-09-04: hooks cost 22-25ms, essentially all of it the node spawn, so their
// runtime is not the risk - a FALSE block is, because it costs the denial text plus a whole
// retried turn. Until this ledger existed the per-hook block count was unmeasurable.
test('guard hooks record every block, and nothing on a pass', () => {
  const proj = fs.mkdtempSync(path.join(TMP, 'blocklog-'));
  const run = (hook, payload) => spawnSync(process.execPath, [path.join(HOOKS, hook)], {
    input: JSON.stringify({ session_id: 'sess1', hook_event_name: 'PreToolUse', ...payload }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
  }).status;
  const ledger = () => {
    const f = path.join(proj, '.claude', 'docs', 'hook-blocks', 'sess1.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };

  assert.equal(run('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), 0);
  assert.deepEqual(ledger(), [], 'a pass writes nothing - the ledger is blocks only');

  assert.equal(run('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), 2);
  assert.equal(run('guard-cross-project-write.js', { tool_name: 'Write', tool_input: { file_path: '/etc/elsewhere/x.ts' } }), 2);
  assert.equal(run('guard-unapproved-dispatch.js', { tool_name: 'Task', tool_input: { subagent_type: 'Explore', prompt: 'who calls Foo' } }), 2);

  const rows = ledger();
  assert.equal(rows.length, 3, 'one row per block');
  assert.deepEqual(rows.map((r) => r.hook).sort(),
    ['guard-catastrophic-rm.js', 'guard-cross-project-write.js', 'guard-unapproved-dispatch.js']);
  for (const r of rows) {
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/, 'timestamped');
    assert.equal(r.event, 'PreToolUse', 'carries the event that was blocked');
    assert.ok(['Bash', 'Task', 'Write'].includes(r.tool), 'and the TOOL - the event alone is PreToolUse for every guard, which says nothing');
    assert.match(r.reason, /^Blocked|^Refusing/, 'carries the first line of the denial');
    assert.ok(r.reason.length <= 200, 'reason is capped - a ledger is not a transcript');
  }
});

test('block telemetry never interferes with the gate', () => {
  // An unwritable docs root must not turn a block into a pass, nor a pass into an error.
  const proj = fs.mkdtempSync(path.join(TMP, 'blockro-'));
  fs.mkdirSync(path.join(proj, '.claude', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'docs', 'hook-blocks'), 'not a directory');
  const run = (cmd) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-catastrophic-rm.js')], {
    input: JSON.stringify({ session_id: 's', tool_name: 'Bash', tool_input: { command: cmd } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
  });
  const blocked = run('rm -rf /');
  assert.equal(blocked.status, 2, 'still blocks when the ledger cannot be written');
  assert.match(blocked.stderr, /^Blocked: a recursive rm/, 'and the model still gets the reason, under the word the analyzer counts');
  assert.equal(run('npm test').status, 0, 'and an ordinary command still passes');
});

// --- hooks audit 2026-09-04: the cross-project guard's remaining routes, each pinned from a probe
// that reproduced the wrong verdict before the fix (a pass on a real cross-repo write, or a block
// on honest in-project work). The fixtures above are reused: XP_ROOT is the project, XP_OTHER the sibling.
test('guard-cross-project-write: a cd into the other project moves the anchor for what follows', () => {
  assert.equal(xpBash(`cd ${XP_OTHER} && git commit -am x`), 2, 'cd then a bare git commit is the -C write, spelled the usual way');
  assert.equal(xpBash('cd ../projB && git add -A && git commit -m x'), 2, 'a relative cd, chained');
  assert.equal(xpBash(`cd ${XP_OTHER}; git add -A; git commit -m x`), 2, 'semicolon-chained');
  assert.equal(xpBash(`(cd ${XP_OTHER} && git commit -am x)`), 2, 'inside a subshell');
  assert.equal(xpBash(`pushd ${XP_OTHER} && git commit -am x`), 2, 'pushd too');
  assert.equal(xpBash(`cd ${XP_OTHER} && echo x > f.txt`), 2, 'a bare relative write after the cd lands over there');
  assert.equal(xpBash(`cd ${XP_OTHER} && git log --oneline -3 && cat f.txt`), 0, 'reading after the cd stays open');
  assert.equal(xpBash('cd src && echo x > ../out.txt'), 0, '../ from a subdirectory of our own project resolves inside it');
  assert.equal(xpBash('cd $OTHER && echo x > f.txt'), 0, 'an anchor that cannot be followed judges nothing relative');
  assert.equal(xpBash(`cd $OTHER && echo x > ${path.join(XP_OTHER, 'f.txt')}`), 2, '...while an absolute target is still judged');
});

test('guard-cross-project-write: prose inside quotes is not a write, and a heredoc keeps its own redirect', () => {
  assert.equal(xpBash(`git commit -m "fix: pipe > ${path.join(XP_OTHER, 'f.txt')}"`), 0, 'a > inside a commit message');
  assert.equal(xpBash(`echo "copy with: cp a ${path.join(XP_OTHER, 'b')}"`), 0, 'a verb inside an echo string');
  assert.equal(xpBash(`echo x > "${path.join(XP_OTHER, 'my file.txt')}"`), 2, 'a quoted TARGET is still a target');
  assert.equal(xpBash(`cat <<'EOF' > ${path.join(XP_OTHER, 'f.txt')}\nhello\nEOF`), 2, 'the heredoc line carries its redirect - only the body is data');
  assert.equal(xpBash(`cat > ${path.join(XP_OTHER, 'f.txt')} <<'EOF'\nhello\nEOF`), 2, 'either order');
});

test('guard-cross-project-write: every argument of an in-place edit or filesystem change is judged', () => {
  assert.equal(xpBash(`perl -pi -e 's/a/b/' ${path.join(XP_OTHER, 'f.txt')}`), 2, "perl's -pi cluster is an in-place edit");
  assert.equal(xpBash(`sed -i 's/a/b/' ${path.join(XP_OTHER, 'f.txt')} src/a.ts`), 2, 'the FIRST of two sed targets');
  assert.equal(xpBash(`rm -f a.txt ${path.join(XP_OTHER, 'b.txt')}`), 2, 'the second rm argument');
  assert.equal(xpBash(`mkdir -p x ${path.join(XP_OTHER, 'y')}`), 2, 'the second mkdir argument');
  assert.equal(xpBash(`truncate -s 0 ${path.join(XP_OTHER, 'log')}`), 2, 'truncate, after its size argument');
  assert.equal(xpBash(`chmod +x ${path.join(XP_OTHER, 'bin', 'x')}`), 2, 'chmod, after its mode');
  assert.equal(xpBash(`chown me ${path.join(XP_OTHER, 'bin', 'x')}`), 2, 'chown, after its owner');
  assert.equal(xpBash('chmod 755 bin/x && truncate -s 0 log && rm -f a b && perl -pi -e "s/a/b/" src/a.ts'), 0, 'the same verbs on our own files');
});

test('guard-cross-project-write: git listing forms in the other checkout are reads', () => {
  assert.equal(xpBash(`git -C ${XP_OTHER} stash list`), 0, 'stash list');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag`), 0, 'tag (list)');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag -l 'v*'`), 0, 'tag -l');
  assert.equal(xpBash(`git -C ${XP_OTHER} branch`), 0, 'branch (list)');
  assert.equal(xpBash(`git -C ${XP_OTHER} stash`), 2, 'a stash push is a write');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag v1.0`), 2, 'creating a tag is a write');
  assert.equal(xpBash(`git -C ${XP_OTHER} branch -d x`), 2, 'deleting a branch is a write');
});

test('guard-cross-project-write: space account dirs, ~ in the allowance, and unresolvable roots', () => {
  const home = os.homedir();
  const repoRoot = path.join(__dirname, '..');
  const inRepo = (payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', ALFRED_CODE_DOCS_PATH: LEDGER, ...env } }).status;
  if (home) {
    // A --space install keeps its memory under ~/.claude-<space>; the old check disabled that
    // allowance for every project living under HOME, i.e. every real project (reproduced).
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(home, '.claude-work', 'projects', 'p', 'memory', 'm.md') } }), 0, 'a space account dir');
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(home, '.claude-x', '..', 'elsewhere', 'f.txt') } }), 2, 'reaching back out of one');
    const owned = path.join(home, `alfred-code-owned-tree-${process.pid}`); // never created - realish resolves through the missing tail
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(owned, 'f.txt') } }), 2, 'a second tree under HOME is outside');
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(owned, 'f.txt') } }, { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '~' + owned.slice(home.length) }), 0, 'a ~ in the allowance expands');
  }
  assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(XP_OTHER, 'f.txt') } }, { CLAUDE_PROJECT_DIR: '/nonexistent/root' }), 0, 'a root that does not exist fails open, as the header promises');
  // Without CLAUDE_PROJECT_DIR the nearest .git ancestor of the session cwd is the root - the cwd
  // itself may be a subdirectory the session cd-ed into, which called a sibling folder 'outside'.
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(repoRoot, 'stack', 'x.md') }, cwd: path.join(repoRoot, 'scripts') }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' },
  }).status, 0, 'a subdirectory cwd still sees the whole repo');
});

test("guard-cross-project-write: a block ends in an ask, and the user's allow is honoured through a session receipt", () => {
  // The denial used to end at 'write a task card' - the model wrote the card or just stopped, and
  // the user never got the choice. Now the denial mandates ONE AskUserQuestion and names the
  // receipt an 'allow' answer writes; the guard reads that receipt the way the dispatch guard reads
  // APPROVAL - this session's own, under 8h - and a root that contains the project is dropped.
  const root = fs.mkdtempSync(path.join(TMP, 'projC-'));
  const other = fs.mkdtempSync(path.join(TMP, 'projD-'));
  const receipt = path.join(root, '.claude', 'docs', 'flow', 'CROSS-WRITE-ALLOW');
  const tp = path.join(root, 'session.jsonl');
  const go = (payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: JSON.stringify({ transcript_path: tp, ...payload }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', ALFRED_CODE_DOCS_PATH: '.claude/docs', ...env } });
  const target = path.join(other, 'src', 'a.ts');
  const denied = go({ tool_name: 'Write', tool_input: { file_path: target } });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /ONE AskUserQuestion/, 'the denial mandates the ask');
  assert.match(denied.stderr, /Task card in this project \(Recommended\)/, 'the card is the recommended option');
  assert.ok(denied.stderr.includes(`Allow writes into ${fs.realpathSync(other)} for this session`), 'the allow option names the other ROOT, not the file');
  assert.match(denied.stderr, /flow[\\/]CROSS-WRITE-ALLOW/, 'the denial names the receipt (path.join spells the separator per OS - measured: windows-latest printed a backslash)');
  assert.doesNotMatch(denied.stderr, /stale/, 'no receipt, no staleness talk');
  // the receipt: one root per line, comments allowed, this session's own
  fs.writeFileSync(tp, '{}\n'); pause(30);
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, `# allowed by the user in this session\n${other}\n`);
  assert.equal(go({ tool_name: 'Write', tool_input: { file_path: target } }).status, 0, 'the receipt opens the named tree');
  assert.equal(go({ tool_name: 'Bash', tool_input: { command: `echo x > ${target}` } }).status, 0, 'through the shell too');
  assert.equal(go({ tool_name: 'Bash', tool_input: { command: `git -C ${other} commit -m x` } }).status, 0, 'and a git write there');
  assert.equal(go({ tool_name: 'Write', tool_input: { file_path: path.join(TMP, 'projE-elsewhere', 'f.txt') } }).status, 2, 'only the named tree');
  // a root that CONTAINS the project would swallow the whole gate
  fs.writeFileSync(receipt, `${TMP}\n`);
  assert.equal(go({ tool_name: 'Write', tool_input: { file_path: target } }).status, 2, 'a containing root is dropped');
  // stale: older than 8h
  fs.writeFileSync(receipt, `${other}\n`);
  const old = (Date.now() - 9 * 3600 * 1000) / 1000; fs.utimesSync(receipt, old, old);
  const aged = go({ tool_name: 'Write', tool_input: { file_path: target } });
  assert.equal(aged.status, 2, 'a 9h-old receipt is absent');
  assert.match(aged.stderr, /stale/, 'and the denial says so, so the model does not loop on rewriting it');
  // stale: written before this session began
  fs.writeFileSync(receipt, `${other}\n`); pause(50);
  const tp2 = path.join(root, 'session2.jsonl');
  fs.writeFileSync(tp2, '{}\n'); pause(20); fs.appendFileSync(tp2, '{}\n');
  assert.equal(go({ tool_name: 'Write', tool_input: { file_path: target }, transcript_path: tp2 }).status, 2, "another session's receipt is not this one's consent");
});

test('every guard fails open on a JSON scalar or null payload', () => {
  // `null` parses, so the parse guard let it through and the first field read threw a TypeError -
  // exit 1 with a stack trace surfaced as a hook error (reproduced on 7 of 9 guards).
  for (const hook of fs.readdirSync(HOOKS).filter((f) => f.startsWith('guard-'))) {
    for (const input of ['null', '"str"', '[]', '{"tool_name":"Bash","tool_input":null}']) {
      const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input, encoding: 'utf8' });
      assert.equal(r.status, 0, `${hook} on ${input}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || ''}`);
    }
  }
});

// --- Windows / Git Bash mount paths: reported 2026-09-04 from a Windows session ------------
// `rm -rf /c/Users/<u>/AppData/Local/Temp/<x>` - the session cleaning its OWN scratch - was
// blocked as a cross-project write. Cause: Git Bash spells a Windows path in POSIX MOUNT form,
// and node on win32 resolves `/c/...` against the CURRENT drive, so the target matched neither
// the project root nor the temp allowance. The three hooks that resolve a path now translate
// the mount form first. The win32 half is pinned through path.win32 (a POSIX host cannot run
// the branch); the POSIX half is pinned by running the hooks.
const MOUNT_SOURCES = ['guard-cross-project-write.js', 'guard-read-whole-file.js', 'guard-ungated-commit.js'];
const mountRuleOf = (hook) => {
  const src = fs.readFileSync(path.join(HOOKS, hook), 'utf8');
  const m = /^const MOUNT_RE = (\/.*\/);$/m.exec(src);
  assert.ok(m, `${hook} must carry the mount-form rule`);
  // eslint-disable-next-line no-eval -- pins the SHIPPED regex, not a copy of it
  return eval(m[1]);
};

test('mount paths: the shipped rule maps a Git Bash temp path into the Windows temp allowance', () => {
  const w = path.win32;
  const TEMP = 'C:\\Users\\u\\AppData\\Local\\Temp';
  const raw = '/c/Users/u/AppData/Local/Temp/alfred-code/x';
  const inside = (t, d) => t === d || t.startsWith(d.endsWith(w.sep) ? d : d + w.sep);

  // the defect, reproduced under win32 semantics: the raw mount form lands nowhere near Temp
  assert.equal(inside(w.resolve(raw), TEMP), false, 'raw mount form mis-resolves - this is the block');

  for (const hook of MOUNT_SOURCES) {
    const native = raw.replace(mountRuleOf(hook), (m, d) => `${d.toUpperCase()}:\\`);
    assert.equal(inside(w.resolve(native), TEMP), true, `${hook}: translated form is inside temp`);
  }
  const rule = mountRuleOf('guard-cross-project-write.js');
  assert.equal(w.resolve('/cygdrive/d/work/repo'.replace(rule, (m, d) => `${d.toUpperCase()}:\\`)), 'D:\\work\\repo', 'cygdrive form too');
  assert.equal('/usr/local/lib'.replace(rule, 'X'), '/usr/local/lib', 'a multi-letter first segment is not a drive');
  assert.equal('/tmp/x'.replace(rule, 'X'), '/tmp/x', 'and neither is /tmp');
});

test('mount paths: a POSIX host still reads /c/... as a POSIX path', () => {
  // The translation must never fire off Windows: `/c/...` there is an ordinary absolute path,
  // outside the project, and the gate must keep blocking it.
  if (process.platform === 'win32') return;
  assert.equal(xpWrite('/c/Users/u/AppData/Local/Temp/x.ts'), 2, 'still outside this project on POSIX');
  assert.equal(xpWrite(path.join(XP_ROOT, 'src', 'x.ts')), 0, 'and this project\'s own file still passes');
  assert.equal(bash('guard-read-whole-file.js', `cat -n ${BIG}`), 2, 'the read guard still counts a real file');
});

// --- the context window the trigger scales against: reported 2026-09-04 on a 1M session -------
// CLAUDE_STACK_FRESH_SESSION_PCT was documented as a percentage of the window but inert on a // legacy-name
// fresh 1M session: the window was INFERRED from observed usage, so it read 200k until the
// session had already grown past 200k per message - the state the gate exists to prevent - and
// 200k x every percent from 5 to 75 collapses onto the 150k floor. Both that key and the
// CLAUDE_STACK_CONTEXT_WINDOW override are retired; the window is DETECTED in two layers, the // legacy-name
// settings model id's own suffix and then the old inference, and an unresolved one gates nothing.
const winEnv = (extra) => ({ ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'latch-')), ...(extra || {}) });
const askLoop = (tp, env) => runIn('guard-fresh-session-start.js',
    { tool_name: 'Skill', tool_input: { skill: 'alfred-loop-quality' }, transcript_path: tp }, { env }).status;
const ctxAt = (name, ctx) => transcript(name, ctxRows(name, ctx));
function accountDir(name, model) {
  const d = fs.mkdtempSync(path.join(TMP, `${name}-`));
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(model === null ? {} : { model }));
  return d;
}

test('guard-fresh-session-start: the slash and compaction routes carry the same offer', () => {
    // The Skill route reaches only a run invoked as a Skill CALL. Measured across four bundles:
    // 4 of 4 orchestration runs arrived slash-injected, ZERO Skill tool_use events in 45 messages,
    // two captures entered at 150.4k and 164.5k - both past the floor, both ungated. And a long
    // agentic turn emits no Stop either (23m27s / 277 messages / +178k ctx, zero Stop events), so
    // the compaction the harness DOES guarantee is the third route.
    const ups = (prompt, tp, env) => runIn('guard-fresh-session-start.js',
        { hook_event_name: 'UserPromptSubmit', prompt, transcript_path: tp }, { env: winEnv(env) });
    const start = (source, env) => runIn('guard-fresh-session-start.js',
        { hook_event_name: 'SessionStart', source }, { env: winEnv(env) });
    const injected = (r) => (r.stdout && r.stdout.includes('additionalContext') ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');
    const hot = ctxAt('ups-hot', 450000);   // no model id here, so 450k is past the 180k DEFAULT trigger

    // NEVER exit 2 on UserPromptSubmit: that erases the user's prompt and shows the reason to the
    // user only - the run would be lost and the model would never learn why.
    const slash = ups('<command-name>/alfred-loop-quality</command-name>\nrun it', hot);
    assert.equal(slash.status, 0, 'the slash route never denies');
    assert.match(injected(slash), /Do NOT start the run yet/, '... it injects the ask instead');
    assert.match(injected(ups('/alfred-capture-agent-capabilities', hot)), /Do NOT start the run yet/, 'a hand-typed slash is the same intent');
    assert.match(injected(ups('<command-name>/alfred-code:update</command-name>', hot)), /Do NOT start the run yet/, 'the guided plugin walks are orchestration too');
    assert.equal(injected(ups('<command-name>/alfred-loop-quality</command-name>', ctxAt('ups-cold', 40000))), '', 'a cold session is left alone');
    assert.equal(injected(ups('fix the failing test', hot)), '', 'an ordinary prompt is never touched');
    assert.equal(injected(ups('/help', hot)), '', 'a slash that is not an orchestration run passes');
    assert.equal(injected(ups('/alfred-loop-quality', hot, { ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' })), '', '0 on the trigger this session uses disables this route too');

    // SessionStart measures nothing - the transcript has just been replaced by its summary - so the
    // compaction event itself is the evidence.
    assert.match(injected(start('compact')), /just AUTO-COMPACTED/, 'a compaction carries the offer');
    // Two sessions switched to English right after compacting, and one resume grepped the tree and
    // read a 10k-char range before opening the plan whose header named the ranges (both measured).
    assert.match(injected(start('compact')), /language of the user's own prompts/, '... with the language line');
    assert.match(injected(start('compact')), /re-read its HEADER first/, '... and the plan-first line');
    assert.equal(injected(start('startup')), '', 'an ordinary session start does not');
    assert.equal(injected(start('compact', { ALFRED_CODE_FRESH_SESSION_1M: '0', ALFRED_CODE_FRESH_SESSION_200K: '0', ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' })), '', 'and all three off disables it - SessionStart measures nothing, so no single trigger owns it');

    // the Skill route is unchanged, and the widened list reaches the review seats
    assert.equal(askLoop(hot, winEnv()), 2, 'the Skill route still BLOCKS');
    assert.equal(runIn('guard-fresh-session-start.js',
        { tool_name: 'Skill', tool_input: { skill: 'alfred-task-verify-code' }, transcript_path: hot }, { env: winEnv() }).status, 2,
        'alfred-task-verify-code is orchestration - measured starting at 364.6k ctx');
});

test('fresh-session window: the account settings model id names the tier before any usage proves it', () => {
    // The FIRST readable source that keeps the window suffix (the transcript's own assistant rows
    // record `claude-opus-5` with the [1m] stripped; `cost-state` keeps it, and is the second
    // source - covered in its own case below). 170k is past the 150k floor on the 200k tier and
    // under the 180k default an unresolved window takes, so each layer shows its own trigger here.
    const hot = ctxAt('win-model-170k', 170000);
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('acct-1m', 'claude-opus-5') })), 0, 'a 1M model id lifts the trigger to that tier\'s 400k');
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('acct-200k', 'claude-haiku-4-5') })), 2, 'a 200k suffix resolves the window - 170k is past its 150k floor');
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('acct-plain', 'opus') })), 0, 'a plain model id proves no TIER - it falls to the default trigger, which 170k is under');
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('acct-none', null) })), 0, 'no model key at all - same default');
    assert.equal(askLoop(ctxAt('win-model-450k', 450000), winEnv({ CLAUDE_CONFIG_DIR: accountDir('acct-1m2', 'claude-opus-5') })), 2, 'and 450k on the 1M tier still fires');
});

test('fresh-session window: the retired CLAUDE_STACK_CONTEXT_WINDOW override is inert', () => { // legacy-name
    // It used to be the FIRST resolution layer and is gone: the window is detected, never stated.
    // Every install seeded the key, so a settings block still carrying one must not move a tier.
    const hot = ctxAt('win-env-170k', 170000);
    assert.equal(askLoop(hot, winEnv({ CLAUDE_STACK_CONTEXT_WINDOW: '200000' })), 0, // legacy-name
        'a stated 200k window resolves nothing now - the default trigger applies, and 170k is under it');
    assert.equal(askLoop(hot, winEnv({ CLAUDE_STACK_CONTEXT_WINDOW: '1000000', CLAUDE_CONFIG_DIR: accountDir('acct-inert', 'claude-haiku-4-5') })), 2, // legacy-name
        'the model id decides alone: 170k is past the 200k tier trigger, whatever the dead key says');
    assert.equal(askLoop(ctxAt('win-env-450k', 450000), winEnv({ CLAUDE_STACK_CONTEXT_WINDOW: '200000' })), 2, // legacy-name
        '... and 450k fires on the default trigger, the dead key naming a tier it cannot set');
});

test('fresh-session window: the tier variable is the whole setting on a declared 1M window', () => {
    // The report this replaced: raising the percentage to 40 changed nothing, because 200k x
    // anything up to 75% still sat under the 150k floor and 1M x 40% still sat over the 250k
    // ceiling - the clamps decided both tiers and the knob controlled nothing. Now the tier's own
    // absolute variable IS the trigger, with no arithmetic between the setting and the behaviour.
    const at260 = ctxAt('win-tier-260k', 260000);
    const env = (extra) => winEnv({ CLAUDE_CONFIG_DIR: accountDir('tier-decl-1m', 'claude-opus-5'), ...extra });
    assert.equal(askLoop(at260, env()), 0, '260k is under the 400,000 default of the 1M tier');
    assert.equal(askLoop(at260, env({ ALFRED_CODE_FRESH_SESSION_1M: '250000' })), 2, '... and past a 250,000 setting');
    assert.equal(askLoop(at260, env({ ALFRED_CODE_FRESH_SESSION_1M: '0' })), 0, '0 disables that tier outright');
    // the 200k tier has its own knob and the two never interfere
    const at160 = ctxAt('win-tier-160k', 160000);
    const w200 = (extra) => winEnv({ CLAUDE_CONFIG_DIR: accountDir('tier-decl-200k', 'claude-haiku-4-5'), ...extra });
    assert.equal(askLoop(at160, w200()), 2, '160k is past the 150,000 default of the 200k tier');
    assert.equal(askLoop(at160, w200({ ALFRED_CODE_FRESH_SESSION_1M: '100000' })), 2, 'the 1M knob does not touch the 200k tier');
    assert.equal(askLoop(at160, w200({ ALFRED_CODE_FRESH_SESSION_200K: '180000' })), 0, '... and its own knob does');
});

test('fresh-session window: model-windows.json is the single source, ALFRED_CODE_DEFAULT_CONTEXT_WINDOW the fallback', () => {
    // ONE rule: the session's model id -> its table row, else the fallback variable, else the DEFAULT
    // trigger. No suffix, carry or compaction moves it.
    const onModel = (name, ctx, model, extra = []) => transcript(name, [
        assistantRow(`${name}-floor`, 'the first turn of this session', { cache_creation_input_tokens: 20000 }),
        { type: 'assistant', message: { id: name, model, content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: ctx } } },
        ...extra,
    ]);
    const fb = (extra) => winEnv({ ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: '1000000', ...extra });
    assert.equal(askLoop(onModel('tbl-haiku-160k', 160000, 'claude-haiku-4-5-20251001'), fb()), 2,
        'a dated Haiku id matches its 200k row - 160k is past the 150k trigger, the 1M fallback never consulted');
    assert.equal(askLoop(onModel('tbl-haiku-260k', 260000, 'claude-haiku-4-5-20251001'), fb()), 2,
        'the row stands even at a carry past 200k - usage is not read');
    assert.equal(askLoop(onModel('tbl-sonnet5-190k', 190000, 'claude-sonnet-5'), winEnv()), 0,
        'Sonnet 5 on a bare id is 1M by its row - 190k is under 400k with no fallback set');
    assert.equal(askLoop(onModel('tbl-bedrock-160k', 160000, 'us.anthropic.claude-haiku-4-5-20251001-v1:0'), fb()), 2,
        'a provider-prefixed id matches the same row');
    assert.equal(askLoop(onModel('tbl-suffix-160k', 160000, 'claude-haiku-4-5[1m]'), fb()), 2,
        'a [1m] suffix is not read - the Haiku row still answers 200k');
    assert.equal(askLoop(onModel('tbl-compact-160k', 160000, 'claude-opus-5',
        [{ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 170000 } }]), winEnv()), 0,
        'an auto-compaction under 200k is not read - the Opus 5 row still answers 1M');
    assert.equal(askLoop(onModel('tbl-sub-160k', 160000, 'claude-opus-5'), fb({ CLAUDE_CONFIG_DIR: accountDir('tbl-sub', 'claude-haiku-4-5') })), 0,
        'the transcript model outranks the settings model');
    // not in the table: the fallback variable
    assert.equal(askLoop(onModel('fb-unknown-190k', 190000, 'claude-nova-9'), fb()), 0, 'an unlisted model takes the 1M fallback - 190k is under 400k');
    assert.equal(askLoop(onModel('fb-unknown-160k-200k', 160000, 'claude-nova-9'), winEnv({ ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: '200000' })), 2, '... or a 200k one - 160k is past 150k');
    assert.equal(askLoop(onModel('fb-unset-190k', 190000, 'claude-nova-9'), winEnv()), 2, 'fallback unset: the 180k DEFAULT trigger');
    assert.equal(askLoop(onModel('fb-junk-190k', 190000, 'claude-nova-9'), fb({ ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: 'lots' })), 2, 'garbage is no fallback');
    assert.equal(askLoop(ctxAt('fb-nomodel-190k', 190000), fb()), 0, 'no model id at all takes the fallback too');
});

test('fresh-session window: a trigger at or above its own window is clamped back inside it', () => {
    // A gate that cannot fire is the gate not existing. The measured case is the DEFAULT at 250,000
    // on a 200k window, and the same hole opens whenever the variable is hand-set past the window.
    const hot = ctxAt('clamp-190k', 190000);
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('clamp-200k', 'claude-haiku-4-5'), ALFRED_CODE_FRESH_SESSION_200K: '250000' })), 2,
        'a 250,000 trigger on a 200k window is unreachable - clamped to 90% of the window, so 190k still fires');
    assert.equal(askLoop(ctxAt('clamp-170k', 170000), winEnv({ CLAUDE_CONFIG_DIR: accountDir('clamp-200k2', 'claude-haiku-4-5'), ALFRED_CODE_FRESH_SESSION_200K: '250000' })), 0,
        '... and the clamp does not fire the gate early - 170k is under the clamped 180,000');
    assert.equal(askLoop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('clamp-off', 'claude-haiku-4-5'), ALFRED_CODE_FRESH_SESSION_200K: '0' })), 0,
        '0 is still the off switch, never clamped into a trigger');
});

test('stop contract: the fresh-session offer reads the window exactly as its twin does', () => {
    // The two hooks carry the same window block - a change to one that misses the other would put
    // the gate and the offer on different triggers in the same session.
    const at = (name, ctx) => transcript(name, ctxRows(name, ctx, 'Applied the change; tests pass.'));
    const stop = (tp, env) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, { env }).status;
    const hot = at('stopwin-190k', 190000);

    assert.equal(stop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('stop-acct-200k', 'claude-haiku-4-5') })), 2, '190k on a declared 200k tier: past its 150k floor');
    assert.equal(stop(hot, winEnv()), 2, '190k with no readable window: PAST the 180k default - the twin agrees with the gate. This is the blocker: at the old 250,000 an unreadable window on a 200k tier could never trip either hook, and a session measured at 187.2k (93.6% of its window) ran both Stop hooks with neither holding');
    assert.equal(stop(hot, winEnv({ CLAUDE_CONFIG_DIR: accountDir('stop-acct-1m', 'claude-opus-5') })), 0, 'a 1M model id lifts it past 190k');
    assert.equal(stop(at('stopwin-450k', 450000), winEnv()), 2, 'and 450k is past the default trigger');
    assert.equal(stop(at('stopwin-450k-1m', 450000), winEnv({ CLAUDE_CONFIG_DIR: accountDir('stop-acct-1m2', 'claude-opus-5') })), 2, '... as it is past the 1M one');
    assert.equal(stop(hot, winEnv({ CLAUDE_STACK_CONTEXT_WINDOW: '1000000' })), 2, 'the retired override moves nothing here either - it resolves no window, so the default trigger applies and 190k is past it'); // legacy-name
});

test('guard-answer-length: the cap holds, and never deletes a report field or a self-correction', () => {
  // Measured damage: a forced re-answer went 3,184 -> 1,085 chars and took TWO of five headline
  // findings and a self-correction disclosure with it. Both exemptions are narrow on purpose -
  // 'Recommendation first' is the house answer shape, so a bolded lead-in must NOT lift the cap.
  const filler = 'This is filler prose that says very little but goes on and on about the process. '.repeat(40);
  const answer = (userText, text) => run('guard-answer-length.js', {
    hook_event_name: 'Stop',
    session_id: 's',
    cwd: TMP,
    transcript_path: transcript(`al-${Math.random().toString(36).slice(2)}`, [
      { type: 'user', message: { content: userText } },
      assistantRow('a1', text),
    ]),
  });
  assert.equal(answer('which one?', `**Recommendation:** use option B. ${filler}`), 2, 'a bolded lead-in is not a mandated field');
  assert.equal(answer('which one?', `Sorry about that. ${filler}`), 2, "'sorry' is not a self-correction");
  assert.equal(answer('which one?', 'Use option B.'), 0, 'an answer at budget passes');
  assert.equal(answer('which one?', `## Findings\n\n${filler}`), 0, "a skill's own report field is exempt");
  assert.equal(answer('which one?', `I was wrong about the threshold earlier. ${filler}`), 0, 'a self-correction is exempt');
  assert.equal(answer('walk me through it', filler), 0, "the user's own depth request still lifts the cap");
});

test('guard-read-whole-file: a shell touch names the convention rule the file tools would have attached', () => {
  // Measured with a control: 19 Bash calls naming .cs files -> 0 attachments, while the session's
  // single Read-tool call on a .cs file attached BOTH .cs-scoped rules 0.94 s later. Under a
  // Bash-first mode the nine path-scoped rules are simply OFF.
  const call = (command, session_id) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command }, session_id }, {});
  const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
  const s1 = `m5-${Math.random().toString(36).slice(2)}`;
  // A pure READ announces nothing. The announcement is once per rule per session, so spending it on
  // an inventory grep leaves the authoring write with no notice at all - measured twice, each time
  // re-paid on every later message in the turn's context.
  assert.equal(ctxOf(call("grep -rn 'IOrderService' src/Api/Orders.cs", s1)), '', 'a read is not a touch');
  assert.equal(ctxOf(call("awk '/^description:/' src/Api/Orders.cs | head -c 900", s1)), '', 'nor is a bounded extraction');
  assert.match(ctxOf(call("sed -i '' 's/a/b/' src/Api/Orders.cs", s1)), /csharp-conventions\.md/, 'an in-place edit is');
  assert.equal(ctxOf(call('dotnet build && cp x.cs src/Api/Orders.cs', s1)), '', 'once per rule per session');
  assert.match(ctxOf(call('echo x > README.md', s1)), /markdown-docs\.md/, 'a different rule still announces');
  assert.equal(ctxOf(call('ls -la', s1)), '', 'a command naming nothing governed is silent');
  assert.equal(ctxOf(call(`cat <<'EOF' > plan.md\nedit src/Thing.sql later\nEOF`, s1)), '', 'a heredoc body is prose, not a touch');
  // the generated docs root and the install's own tree are not governed by markdown-docs.md - its
  // own body says so - so a write that only touches them announces nothing
  const s3 = `m5-${Math.random().toString(36).slice(2)}`;
  assert.equal(ctxOf(call('echo x > .claude/docs/loops/RUN-STATE.md', s3)), '', 'the generated docs root is not governed');
  assert.match(ctxOf(call('echo x > docs/guide.md', s3)), /markdown-docs\.md/, 'a project doc still is');
  // the WinForms row is the twin of winforms-conventions.md's paths: the designer file AND the hand-written
  // *Form.cs / *Form.*.cs code-behind (a Designer-only row never named the rule on a MainForm.cs edit, so the
  // rule's own code-behind clause was unreachable from the shell route). Case-sensitive: Platform.cs and
  // Transform.cs end in the letters form and stay plain C#.
  const s4 = `m5-${Math.random().toString(36).slice(2)}`;
  const formCtx = ctxOf(call("sed -i '' 's/a/b/' src/Forms/MainForm.cs", s4));
  assert.match(formCtx, /winforms-conventions\.md/, "a hand-written *Form.cs edit names the WinForms rule");
  assert.match(formCtx, /csharp-conventions\.md/, "... and the C# baseline beside it");
  const s5 = `m5-${Math.random().toString(36).slice(2)}`;
  const platCtx = ctxOf(call("sed -i '' 's/a/b/' src/Core/Platform.cs", s5));
  assert.doesNotMatch(platCtx, /winforms-conventions\.md/, "Platform.cs is not a form");
  assert.match(platCtx, /csharp-conventions\.md/, "... it is plain C#");
  assert.match(ctxOf(call("sed -i '' 's/a/b/' src/Forms/MainForm.Designer.cs", `m5-${Math.random().toString(36).slice(2)}`)), /winforms-conventions\.md/, "the designer file still names it");
  // a denial and an injection are two answers to one call: the rule is not spent on a blocked command
  const s2 = `m5-${Math.random().toString(36).slice(2)}`;
  const blocked = call(`cat ${BIG.replace(/\.js$/, '.js')}`, s2);
  assert.equal(blocked.status, 2, 'a whole-file dump of a large .js file is still blocked');
  assert.equal(ctxOf(blocked), '', 'and announces nothing');
  assert.match(ctxOf(call(`cp x.js ${BIG}`, s2)), /javascript-conventions\.md/, 'the next allowed write still gets it');
  // The Angular row is the twin of angular-conventions.md's `paths:`, and that rule matches
  // `**/src/app/**/*.ts` because the Angular style guide now recommends suffix-less names. Matching
  // only the .component/.service/... suffixes announced a `src/app/user-profile.ts` write as
  // typescript-conventions.md alone, so the Angular rule was unreachable from the shell route for
  // every file written the current way.
  const s6 = `m5-${Math.random().toString(36).slice(2)}`;
  const ngCtx = ctxOf(call("sed -i '' 's/a/b/' src/app/user-profile.ts", s6));
  assert.match(ngCtx, /angular-conventions\.md/, 'a suffix-less file under src/app names the Angular rule');
  assert.match(ngCtx, /typescript-conventions\.md/, '... and the TypeScript baseline beside it');
  const s7 = `m5-${Math.random().toString(36).slice(2)}`;
  const plainTs = ctxOf(call("sed -i '' 's/a/b/' tools/build/util.ts", s7));
  assert.doesNotMatch(plainTs, /angular-conventions\.md/, 'a .ts file outside src/app or src/lib is not Angular');
  assert.match(plainTs, /typescript-conventions\.md/, '... it is plain TypeScript');
});

test('guard-read-whole-file: the ungoverned docs root is RESOLVED, not assumed to be .claude', () => {
  // markdown-docs.md says every document under the generated docs root is not governed by it. The
  // test that dropped the announcement hard-coded `.claude/`, so with ALFRED_CODE_DOCS_PATH=docs -
  // the committed-root case the docs-root rule itself describes - a write to
  // docs/architecture/ARCHITECTURE.md still drew an announcement the rule says does not apply.
  const call = (command, session_id, docsRoot) => runIn('guard-read-whole-file.js',
    { tool_name: 'Bash', tool_input: { command }, session_id },
    { env: { ...process.env, ALFRED_CODE_DOCS_PATH: docsRoot } });
  const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
  const sid = () => `md6-${Math.random().toString(36).slice(2)}`;
  assert.equal(ctxOf(call('tee docs/architecture/ARCHITECTURE.md < in', sid(), 'docs')), '', 'a custom docs root is ungoverned');
  assert.match(ctxOf(call('tee docs/architecture/ARCHITECTURE.md < in', sid(), '.claude/docs')), /markdown-docs\.md/,
    'the same path IS governed when it is not the docs root');
  assert.equal(ctxOf(call('tee .claude/docs/loops/RUN-STATE.md < in', sid(), '.claude/docs')), '', 'the default root still drops');
  assert.match(ctxOf(call('tee README.md < in', sid(), 'docs')), /markdown-docs\.md/, 'a tracked doc still announces');
});

test('guard-read-whole-file: an unexpanded $VAR is judged by nobody, and a leading cd moves the anchor', () => {
  // 6 of 12 measured denials in one project named a `$R/...` target: the size check could not
  // resolve it, failed CLOSED, and denied reads the session had every right to make. The sibling
  // cross-project guard already refuses to judge a path whose value it cannot see.
  const call = (command) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command } }, {}).status;
  assert.equal(call(`cat $R/src/Thing.cs`), 0, 'an unexpanded variable target is not judged');
  assert.equal(call(`cat \${SRC}/Thing.ts`), 0, 'the braced spelling either');
  // ... but a variable the SAME command sets is knowable, and the file is large
  assert.equal(call(`R=${REPO}/scripts && cat $R/lint-skills.js`), 2, 'a same-command assignment is expanded and judged');
  // a leading cd moves the anchor: this relative path resolves nowhere from the project root
  assert.equal(call(`cd ${path.join(REPO, 'scripts')} && cat lint-skills.js`), 2, 'a cd-anchored relative dump is still caught');
  assert.equal(call(`cd ${path.join(REPO, 'stack', 'hooks')} && cat instrument-tool-usage.js`), 0, 'and a small one still passes');
});

test('guard-read-whole-file: a runtime expression that only COUNTS is not a dump', () => {
  // Measured: a `node -e` whose entire output was `.match(...).length` on a 198-line file - under
  // the guard's own threshold - was denied, killing a five-probe compound command and costing a
  // 107k-token retry. The branch tested the extension and nothing else.
  const call = (command) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command } }, {}).status;
  assert.equal(call(`node -e 'console.log(require("fs").readFileSync("${BIG}","utf8").match(/function/g).length)'`), 0, 'a count is not a dump');
  assert.equal(call(`node -e 'console.log(require("fs").readFileSync("${BIG}","utf8").split("\\n").length)'`), 0, 'nor is a line count');
  assert.equal(call(`node -e 'console.log(require("fs").readFileSync("${BIG}","utf8"))'`), 2, 'printing the content still is');
  assert.equal(call(`node -e 'console.log(require("fs").readFileSync("${SMALL}","utf8"))'`), 0, 'and a small file is fine either way, like cat');
});

test('guard-read-whole-file: a sweep over .md files is a sweep; one named .md file is not', () => {
  // 84.1KB from 35 SKILL.md files in one call, 120KB from 46 in another - stopped only by the
  // harness's own output cap. Markdown is not symbol-navigable, so the single-file check still
  // ignores it: the sweep is the shape that dumps, not the named read.
  const call = (command) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command } }, {}).status;
  assert.equal(call('for f in .claude/skills/*/SKILL.md; do cat "$f"; done'), 2, 'a loop over every SKILL.md is blocked');
  assert.equal(call(`cat ${path.join(REPO, 'CLAUDE.md')}`), 0, 'one named markdown file is still a fine read');
  assert.equal(call('find .claude/skills -name SKILL.md -exec cat {} \\;'), 2, 'find -exec over the same set too');
});

test('guard-read-whole-file: a whole Read of an oversized file is blocked whatever its extension', () => {
  // A 93KB spill read WHOLE, twice, for 99,277 chars and no hook-block row - the extension was not
  // on the gated list. A persisted output is by definition over the inline cap.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spill-'));
  const spill = path.join(dir, 'persisted-output.txt');
  fs.writeFileSync(spill, 'x'.repeat(70 * 1024));
  const read = (tool_input) => runIn('guard-read-whole-file.js', { tool_name: 'Read', tool_input }, {}).status;
  assert.equal(read({ file_path: spill }), 2, 'the whole-file shape is blocked');
  assert.equal(read({ file_path: spill, offset: 1, limit: 50 }), 0, 'a ranged read of the same file passes');
  const small = path.join(dir, 'small.txt');
  fs.writeFileSync(small, 'x'.repeat(1024));
  assert.equal(read({ file_path: small }), 0, 'a small non-source file is untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard-read-whole-file: the denial names the call that LOADS the serena tools', () => {
  // The tools are deferred behind tool search in this harness, so naming them is not having them:
  // two sessions carried the rule text saying exactly that and still made 100 Bash calls and 0
  // serena calls. The remedy belongs in the denial the model is already reading.
  const r = runIn('guard-read-whole-file.js', { tool_name: 'Read', tool_input: { file_path: BIG } }, {});
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ToolSearch select:mcp__plugin_serena_serena__get_symbols_overview,mcp__plugin_serena_serena__find_symbol/);
});

test('guard-read-whole-file: a file is as long as its lines - the trailing newline is not one more', () => {
  // A 200-line file read as 201 and was blocked at the threshold it sits on; the denial reported
  // 1501 lines for a 1500-line file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
  const at = path.join(dir, 'at.ts');
  const over = path.join(dir, 'over.ts');
  fs.writeFileSync(at, Array.from({ length: 200 }, (_, i) => `const a${i} = ${i};`).join('\n') + '\n');
  fs.writeFileSync(over, Array.from({ length: 201 }, (_, i) => `const a${i} = ${i};`).join('\n') + '\n');
  assert.equal(bash('guard-read-whole-file.js', `cat ${at}`), 0, 'exactly the threshold passes');
  assert.equal(run('guard-read-whole-file.js', { tool_name: 'Read', tool_input: { file_path: at } }), 0, 'on the Read route too');
  const r = runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command: `cat ${over}` } }, {});
  assert.equal(r.status, 2, 'one line over blocks');
  assert.match(r.stderr, /\(201 lines\)/, 'and the denial counts it right');
});

test('guard-read-whole-file: the PowerShell reads and anchors are judged like their Bash twins', () => {
  // Wired on PowerShell, yet Get-Content / gc / type dumped a 3000-line file unjudged.
  for (const c of [`Get-Content ${BIG}`, `gc ${BIG}`, `type ${BIG}`, `Get-Content -Path ${BIG} -Raw`, `Get-Content -LiteralPath '${BIG}'`])
    assert.equal(pwsh('guard-read-whole-file.js', c), 2, `must block: ${c}`);
  for (const c of [`Get-Content ${BIG} -TotalCount 40`, `gc ${BIG} -Head 20`, `Get-Content ${BIG} -Tail 30`,
    `Get-Content ${BIG} | Select-Object -First 40`, `Get-Content ${BIG} | Select-String 'foo'`, `Get-Content ${BIG} | Measure-Object -Line`])
    assert.equal(pwsh('guard-read-whole-file.js', c), 0, `bounded: ${c}`);
  assert.equal(pwsh('guard-read-whole-file.js', `Set-Location ${HOOKS}; Get-Content instrument-tool-usage.js`), 0,
    'a Set-Location moves the anchor, so a small file named relative to it resolves');
  assert.equal(bash('guard-read-whole-file.js', 'type node'), 0, 'the bash builtin reads no file');
  assert.equal(bash('guard-read-whole-file.js', `grep -n type ${BIG}`), 0, 'nor is the word an argument');
  assert.equal(pwsh('guard-read-whole-file.js', `$x = (Get-Content ${BIG})`), 2, 'a parenthesised read is still the command');
});

test('guard-read-whole-file: every source-read denial carries the call that loads serena', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadline-'));
  const big = path.join(dir, 'big.ts');
  fs.writeFileSync(big, Array.from({ length: 400 }, (_, i) => `const a${i} = ${i};`).join('\n') + '\n');
  const deny = (command) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', tool_input: { command } }, { cwd: dir });
  for (const c of [`for f in ${dir}/*.ts; do cat $f; done`, `node -e "console.log(require('fs').readFileSync('${big}','utf8'))"`, `head -n 99999 ${big}`]) {
    const r = deny(c);
    assert.equal(r.status, 2, c);
    assert.match(r.stderr, /ToolSearch select:mcp__plugin_serena_serena__/, `the loading line: ${c}`);
  }
});

test('guard-ungated-commit: an ABSOLUTE docs root inside the repo does not fail its own receipt', () => {
  // The receipt lives under the docs root, so it is itself an untracked changed file. `docsPrefix`
  // excluded it only for a RELATIVE root and returned null for an absolute one - so a project whose
  // docs root is set to an absolute path INSIDE the repo (the shape blocker B4 was about) had every
  // conformant receipt fail its own `spec:` count, and the gate blocked the commit it had just
  // authorized. Found by porting this hook to the Cursor twin, where the payload carries no
  // CLAUDE_PROJECT_DIR and an absolute docs root is the natural spelling.
  const dir = scratchRepo();
  const docs = path.join(dir, '.claude', 'docs');           // absolute, and inside the tree
  fs.mkdirSync(path.join(docs, 'flow'), { recursive: true });
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(docs, 'flow', 'COMMIT-GATE'),
    `VERIFIED the three fixtures\nauthorized: "commit it"\nhead: ${head}\nspec: 3 files - the fixtures\nlive-probe: tests green\n`);
  const status = spawnSync(process.execPath, [path.join(HOOKS, 'guard-ungated-commit.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -am wip' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_DOCS_PATH: docs },
    cwd: dir,
  }).status;
  assert.equal(status, 0, 'a conformant receipt under an absolute in-repo docs root passes');
});

// The generated capabilities rule stamped 'the harness BLOCKS the Skill call' on a slash-only
// skill into every project, and the harness did not: a user typed the command with a LEADING
// SPACE (so no `<command-name>` marker fired), and the model reached the flagged skill through a
// Skill tool call four seconds later - body injected, run started. The assertion is now the gate.
test('guard-fresh-session-start: a disable-model-invocation skill is denied to the MODEL, never to the user', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'dmi-'));
    const write = (name, front) =>
    {
        const dir = path.join(root, '.claude', 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: a test skill\n${front}---\n\nbody\n`);
    };
    write('alfred-loop-quality', 'disable-model-invocation: true\n');
    write('alfred-capture-architecture', '');   // deliberately model-invocable so the loop can call it
    write('csharp', '');
    const skillCall = (skill) => runIn('guard-fresh-session-start.js',
        { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill }, cwd: root, session_id: 'dmi' },
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });

    const blocked = skillCall('alfred-loop-quality');
    assert.equal(blocked.status, 2, 'the model may not call a slash-only skill');
    assert.match(blocked.stderr, /disable-model-invocation/, 'the denial names why');
    assert.match(blocked.stderr, /hand the turn back/, 'and says what to do instead - not to retry');
    // No threshold involved: this payload carries no transcript at all, so a context-based block
    // could not have fired. The flag is the whole verdict.
    assert.equal(skillCall('alfred-capture-architecture').status, 0, 'the unflagged capture stays callable');
    assert.equal(skillCall('csharp').status, 0, 'an ordinary skill is untouched');
    assert.equal(skillCall('not-installed-here').status, 0, 'a skill this project does not carry is not this guard\'s business');

    // The USER's own route is a different event and must stay open.
    const typed = runIn('guard-fresh-session-start.js',
        { hook_event_name: 'UserPromptSubmit', prompt: '<command-name>/alfred-loop-quality</command-name>', cwd: root, session_id: 'dmi' },
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(typed.status, 0, 'the user typing the command is never blocked');
});

// The same gate, on the route where the skill is NOT copied into the project. Reading only
// `.claude/skills/` made it stop firing the moment the skills moved into the plugins: the missing
// file landed in the catch and every one of the 13 flagged skills became model-callable again.
test('guard-fresh-session-start: the flag is read from the PLUGIN cache too, not only the project copy', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'dmiplug-'));
    const cfg = path.join(root, 'cfg');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const place = (plugin, name, front, sub) =>
    {
        const dir = path.join(cfg, 'plugins', 'cache', 'envoydev', plugin, '1.0.0', ...sub, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: a test skill\n${front}---\n\nbody\n`);
    };
    place('alfred-code', 'alfred-loop-quality', 'disable-model-invocation: true\n', ['stack', 'skills']);
    place('claude-stack-wpf', 'dotnet-wpf', '', ['stack', 'skills']);
    const skillCall = (skill) => runIn('guard-fresh-session-start.js',
        { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill }, cwd: root, session_id: 'dmip' },
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: cfg } });

    assert.equal(skillCall('alfred-loop-quality').status, 2, 'a flagged skill served by a plugin is still denied');
    assert.equal(skillCall('alfred-code:alfred-loop-quality').status, 2, 'and under its scoped spelling');
    assert.equal(skillCall('claude-stack-wpf:dotnet-wpf').status, 0, 'an unflagged plugin skill stays callable');
    assert.equal(skillCall('alfred-code:not-shipped').status, 0, 'a name no home carries is not this guard\'s business');
});

test('guard-fresh-session-start: a SECOND typed run is gated on the FIRST one, at any context size', () => {
    // Measured across three audited sessions: four deliberate flows chained with zero `/clear`
    // boundary, 199.1k average context per message for well under 30k of real tool output, and the
    // size trigger fired on none of them - every run STARTED under it and crossed it only while
    // running. So the second run is judged on the FIRST run's own marker and never on the context,
    // which is why every transcript here sits at 60k, far under the smallest trigger.
    // 20k floor, 60k carry: cold by every trigger, and two thirds of the carry is what a resume
    // would recover, so the recoverable-share rule has nothing to say about these fixtures.
    const FLOOR = { cache_creation_input_tokens: 20000 };
    const COLD = { cache_read_input_tokens: 60000 };
    const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text } });
    const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
    const cmd = (name) => userRow(`<command-name>/${name}</command-name>`);
    const skillRow = (id, name) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }], usage: COLD } });
    // The slash route is the only route this trigger judges. Its prompt row is already on disk when
    // UserPromptSubmit fires, so every fixture ends with the command being judged. It never denies:
    // an offer is injected context, so the helper returns that text ('' = no offer).
    const slash = (tp, env, skill) => {
      const r = runIn('guard-fresh-session-start.js',
          { hook_event_name: 'UserPromptSubmit', prompt: `<command-name>/${skill || 'alfred-loop-quality'}</command-name>`, transcript_path: tp },
          { env: env || winEnv() });
      assert.equal(r.status, 0, 'the slash route never denies');
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
    };
    const skillCall = (tp, skill) => runIn('guard-fresh-session-start.js',
        { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill }, transcript_path: tp },
        { env: winEnv() }).status;

    // ONE run starting - its own marker is not a prior run.
    assert.equal(slash(transcript('chain-first', [cmd('alfred-loop-quality')])), '', 'the run that is starting is not evidence against itself');

    // A finished run, a human turn, then a second typed one: the whole measured shape.
    const second = transcript('chain-second', [
      cmd('alfred-capture-architecture'), assistantRow('a1', 'captured', FLOOR), toolResult(),
      userRow('now run the quality loop'), assistantRow('a2', 'ok', COLD), cmd('alfred-loop-quality'),
    ]);
    const env = winEnv();
    const offered = slash(second, env);
    assert.match(offered, /ALREADY run one/, 'the offer names the reason - the prior run, not the size');
    assert.match(offered, /fresh session/, 'and carries the same offer the size trigger does');
    // ONCE per session: the user has answered, so the retry must go through.
    assert.equal(slash(second, env), '', 'an answered offer is not asked again');

    // ONE gated cycle is one run: its phases arrive as Skill calls, and its approval step puts a
    // human turn between them. Measured 2026-09-14: the build step of a single cycle was offered a
    // fresh session when Skill calls counted as runs.
    const cycle = transcript('chain-cycle', [
      cmd('alfred-task-solve'), assistantRow('a0', 'reading the plan', FLOOR), skillRow('a1', 'alfred-task-design'),
      toolResult(), assistantRow('a2', 'approve the plan?', COLD), userRow('approved'), skillRow('a3', 'alfred-task-implement'),
    ]);
    assert.equal(skillCall(cycle, 'alfred-task-implement'), 0, 'a phase of a run in flight is not a second run');
    assert.equal(skillCall(cycle, 'alfred-loop-quality'), 0, '... nor is any Skill-route call - only a typed run chains');

    // Chaining the SAME command twice is still chaining.
    assert.match(slash(transcript('chain-twice', [
      cmd('alfred-loop-quality'), assistantRow('a1', 'done', FLOOR), toolResult(),
      userRow('do it again'), assistantRow('a2', 'ok', COLD), cmd('alfred-loop-quality'),
    ])), /ALREADY run one/, 'the same run a second time carries the same carried history');

    // The REAL slash shape: the harness writes the skill's body as an isMeta user record right after
    // the marker, and other harness rows (command output, task notifications, a compact summary)
    // are user-typed too. None is a human turn - measured 2026-09-14, a run started right after
    // /clear was offered a fresh session.
    assert.equal(slash(transcript('chain-harness-rows', [
      assistantRow('a0', 'hello', FLOOR), assistantRow('a1', 'ok', COLD), cmd('alfred-task-solve'),
      { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: x' }] } },
      userRow('<local-command-stdout>Set effort level</local-command-stdout>'),
      userRow('<task-notification>agent done</task-notification>'),
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued' } },
    ]), winEnv(), 'alfred-task-solve'), '', 'harness-written user records are not a human turn');

    // The marker as TEXT is not a run: a tool result that printed a transcript or a test file, or the
    // model's own tool input writing one. Measured 2026-09-15: 28 of 73 markers in the corpus sat in
    // tool results, and a replayed session was offered a fresh session for a run nobody typed.
    const markup = '<command-name>/alfred-capture-architecture</command-name>';
    assert.equal(slash(transcript('chain-in-tool-result', [
      assistantRow('a0', 'reading', FLOOR),
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: `const x = '${markup}';` }] } },
      userRow('next'), assistantRow('a1', 'ok', COLD), cmd('alfred-loop-quality'),
    ])), '', 'a marker printed by a tool is not a prior run');
    assert.equal(slash(transcript('chain-in-tool-input', [
      { type: 'assistant', message: { id: 'a0', content: [{ type: 'tool_use', name: 'Write', input: { content: markup } }], usage: FLOOR } },
      toolResult(), userRow('next'), assistantRow('a1', 'ok', COLD), cmd('alfred-loop-quality'),
    ])), '', 'a marker the model wrote into a tool input is not a prior run');
    assert.equal(slash(transcript('chain-in-meta', [
      assistantRow('a0', 'hi', FLOOR),
      { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: `skill body quoting ${markup}` }] } },
      userRow('next'), assistantRow('a1', 'ok', COLD), cmd('alfred-loop-quality'),
    ])), '', 'a marker inside a harness-written row is not a prior run');

    // An ordinary skill after a deliberate run is not a run, and the off switch covers both triggers.
    const plain = transcript('chain-plain', [
      cmd('alfred-capture-architecture'), assistantRow('a1', 'captured', FLOOR), toolResult(), userRow('next'), cmd('dev-log-convert'),
    ]);
    assert.equal(slash(plain, winEnv(), 'dev-log-convert'), '', 'a non-orchestration skill is untouched');
    // A chain whose whole carry IS the install's own floor has nothing for a resume to recover.
    assert.equal(slash(transcript('chain-allfloor', [
      cmd('alfred-capture-architecture'), assistantRow('a1', 'captured', { cache_read_input_tokens: 59000 }),
      toolResult(), userRow('next'), assistantRow('a2', 'ok', COLD), cmd('alfred-loop-quality'),
    ])), '', 'a second run carrying only the cold floor is not worth a fresh session');
    assert.equal(slash(transcript('chain-off', [
      cmd('alfred-capture-architecture'), assistantRow('a1', 'captured', FLOOR), toolResult(), userRow('next'), cmd('alfred-loop-quality'),
    ]), winEnv({ ALFRED_CODE_FRESH_SESSION_200K: '0', ALFRED_CODE_FRESH_SESSION_1M: '0', ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' })), '',
        'all three triggers off is the whole off switch - the chained one included');
});

test('fresh-session offer: what a resume would RECOVER, not the absolute carry - both hooks', () => {
    // Measured: an 18-minute single-command run that STARTED from `/clear` had a first message of
    // 103,964 - the install's own standing inventory - and tripped the 150,000 trigger at 159,363
    // after ~55k of actual conversation. The ask and its close cost two messages and 320,973
    // context and moved nothing, because a fresh session would have restarted at 103,964 anyway.
    // The floors measured across the nine audited projects run 87k-134k, so this is not an outlier.
    const rows = (name, floor, ctx) => transcript(name, [
        assistantRow(`${name}-floor`, 'the first turn', { cache_creation_input_tokens: floor }),
        assistantRow(name, 'Applied the change; tests pass.', { cache_read_input_tokens: ctx }),
    ]);
    const w200 = () => winEnv({ CLAUDE_CONFIG_DIR: accountDir('recov-200k', 'claude-haiku-4-5') });
    const stop = (tp, env) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, { env: env || w200() }).status;

    // The measured case itself, on both hooks: past the trigger, but 65% of the carry is floor.
    const measured = rows('recov-measured', 103964, 159363);
    assert.equal(stop(measured), 0, 'the offer stays quiet when a resume would recover 34.8% of the carry');
    assert.equal(askLoop(measured, w200()), 0, '... and the gate agrees - the two hooks share the arithmetic');
    // Same context, a floor a tenth the size: now the carry IS the conversation.
    const real = rows('recov-real', 12000, 159363);
    assert.equal(stop(real), 2, 'the same 159k with a small floor is 92% recoverable - offer it');
    assert.equal(askLoop(real, w200()), 2, '... and the gate blocks the chained run there');
    // Exactly at the 40% line, from both sides.
    assert.equal(stop(rows('recov-40', 120000, 200000)), 2, '40% recoverable is enough');
    assert.equal(stop(rows('recov-39', 122000, 200000)), 0, '39% is not');
    // An unreadable floor answers YES - the behaviour that shipped before the rule existed.
    assert.equal(stop(transcript('recov-nofloor', [assistantRow('nf', 'Applied the change; tests pass.', { cache_read_input_tokens: 190000 })]), w200()), 0,
        'a one-row session is all floor by its own arithmetic');
    assert.equal(stop(transcript('recov-noutoken', [
        { type: 'assistant', message: { id: 'x', content: [{ type: 'text', text: 'hi' }] } },
        assistantRow('nu', 'Applied the change; tests pass.', { cache_read_input_tokens: 190000 }),
    ]), w200()), 0, 'a row carrying no usage is not a billed message - the floor is the first one that is');
    // The floor is read from the HEAD of the transcript. A session whose first half-megabyte holds
    // no billed message at all (a giant paste before the first answer) has no readable floor, and
    // the offer then goes out exactly as it did before this rule existed.
    const wall = transcript('recov-wall', [
        { type: 'user', message: { role: 'user', content: 'x'.repeat(600 * 1024) } },
        assistantRow('w1', 'Applied the change; tests pass.', { cache_read_input_tokens: 190000 }),
    ]);
    assert.equal(stop(wall, w200()), 2, 'an unreadable floor answers yes - fail open, never silent');
});

test('guard-stop-contract: the three block shapes the audit reproduced', () => {
    const ledger = fs.mkdtempSync(path.join(TMP, 'stopled-'));
    const logDir = fs.mkdtempSync(path.join(TMP, 'stoplog-'));
    const close = (text, extra) => runIn('guard-stop-contract.js',
        { hook_event_name: 'Stop', session_id: 'shapes', cwd: ledger, last_assistant_message: text, ...(extra || {}) },
        { env: { ...process.env, CLAUDE_PROJECT_DIR: ledger, ALFRED_CODE_DOCS_PATH: path.join(ledger, 'docs'), ALFRED_CODE_HOOK_LOG_DIR: logDir } });

    // 1. `your call` inside a NEGATION is not an offer - it says the opposite. Measured: a step-12
    //    post-check closing 'closure-held, not your call' was blocked, 174,321 cache-read retried.
    assert.equal(close('The closure is held here, not your call. Everything is committed and green.').status, 0, 'a negated `your call` is not an ask');
    assert.equal(close('Both work - your call which one ships.').status, 2, '... and the offer itself still blocks');
    // 1b. An IMPERATIVE offer waits exactly like a question, and a RETROSPECTIVE '(your call)' does
    //     not (measured: a real decision stalled 11.5 min unheld; a close recording a decision the
    //     user had already taken was blocked as an ask).
    assert.equal(close('Confirm you want that dropped, or I can stash it instead (`git stash -u`) to keep it recoverable.').status, 2,
        'an imperative decision offer is an ask');
    assert.equal(close('Tell me which one to keep and I will apply it.').status, 2, '... and so is a bare `tell me which`');
    assert.equal(close('Requirement recorded: 90% line coverage after exclusions (your call). Nothing is pending on this run - these are yours to run when you choose.').status, 0,
        'a retrospective `(your call)` beside a record verb is a note, not an offer');

    // 2. The background exemption reads the run-state VERB plus a named waiter, not a noun list.
    //    Measured: 'the integration half is still running and will notify on completion' was
    //    blocked because the noun was 'half', and the SAME close passed a minute later reworded.
    assert.equal(close('All 12 files are done. The integration half (~6-7 min) is still running and will notify on completion.').status, 0, 'a verb plus a waiter is a status line');
    assert.equal(close('All 12 files are done. The integration half (~6-7 min) is still executing and will notify on completion.').status, 0, '... and a synonym of the verb does not decide a block');
    assert.equal(close('The fix is committed and pushed. Tests are still running in CI.').status, 0, 'the job-noun form still passes');
    assert.equal(close('The refactor is done. Pushing it is the next step, whenever you are ready.').status, 2, 'a real stall still blocks');

    // 3. The ledger row names the BRANCH and what matched. A block whose cause cannot be
    //    reconstructed cannot be tuned - this audit hit that wall three times.
    const rows = fs.readFileSync(path.join(ledger, 'docs', 'hook-blocks', 'shapes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.detail.branch), ['prose-ask', 'prose-ask', 'prose-ask', 'done-close'], 'each block names its branch');
    assert.match(rows[0].detail.matched, /your call/, 'and the substring that fired it');
    assert.match(rows[3].detail.matched, /done \+ next step/, '... both halves, for the two-part branch');
});

test('guard-stop-contract: a credential the USER pasted demands the rotate ask too', () => {
    // The one bundle in the audited collection that had to ship with no transcript at all: a live
    // API key entered that session by PASTE, every close was credential-free, and the shape scan
    // read only tool results - so the guard covered every route the model can take to a credential
    // and none of the one route the user takes.
    const root = fs.mkdtempSync(path.join(TMP, 'paste-'));
    const shape = 'sntryu_' + '0123456789abcdef'.repeat(2);   // fake by construction - the SHAPE is read, never a value
    const pasted = transcript('pasted', [
        { type: 'user', message: { role: 'user', content: `register this: ${shape}` } },
        assistantRow('p1', 'Registered it; the install is green.'),
    ]);
    const clean = transcript('pasted-clean', [
        { type: 'user', message: { role: 'user', content: 'register the token from my env' } },
        assistantRow('p2', 'Registered it; the install is green.'),
    ]);
    const stop = (tp) => runIn('guard-stop-contract.js',
        { hook_event_name: 'Stop', session_id: 'paste', cwd: root, transcript_path: tp, last_assistant_message: 'Registered it; the install is green.' },
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: path.join(root, 'docs') } });
    const blocked = stop(pasted);
    assert.equal(blocked.status, 2, 'a pasted credential ends the turn in the rotate ask');
    assert.match(blocked.stderr, /pasted into the chat/, 'and the denial names the route it came in by');
    assert.ok(!blocked.stderr.includes(shape), 'the value itself is never repeated back');
    assert.equal(stop(clean).status, 0, 'a turn with no credential shape is untouched');
});

// --- guard-cross-project-write: the fork-liveness probe (log-only) ---------
// A backgrounded turn continues under a NEW session id whose transcript opens as a copy of the
// parent's rows while the user keeps talking to the other copy. Measured once: five test cycles,
// five WINWORD kills and an edit collision, 15 minutes after the foreground's user said stop. The
// probe writes a row and denies nothing; the week's rows decide whether a denial follows.
test('guard-cross-project-write: the fork-liveness probe logs a mutating call beside a live sibling of the same lineage, and denies nothing', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'forks-'));
  const docs = fs.mkdtempSync(path.join(TMP, 'forkdocs-'));
  const ids = {
    parent: '11111111-1111-4111-8111-111111111111',
    own: '22222222-2222-4222-8222-222222222222',
    sib: '33333333-3333-4333-8333-333333333333',
    other: '44444444-4444-4444-8444-444444444444',
  };
  // the measured shape: a copied row keeps the ORIGINAL id under session_id while sessionId is
  // rewritten to the fork's own (387 of 1,093 rows in one fork carried a parent's session_id)
  const row = (own, origin, text) => JSON.stringify({ type: 'user', sessionId: own, session_id: origin, message: { role: 'user', content: text } }) + '\n';
  // this session is a FORK: its transcript opens with the parent's rows
  fs.writeFileSync(path.join(dir, ids.own + '.jsonl'), row(ids.own, ids.parent, 'summary') + row(ids.own, ids.own, 'continue'));
  // a sibling fork of the same parent, touched now - the foreground the user is talking to
  fs.writeFileSync(path.join(dir, ids.sib + '.jsonl'), row(ids.sib, ids.parent, 'summary') + row(ids.sib, ids.sib, 'stop'));
  // an unrelated session touched now - not this lineage, never a probe hit
  fs.writeFileSync(path.join(dir, ids.other + '.jsonl'), row(ids.other, ids.other, 'hello'));
  const probe = (payload, sid) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify({ ...payload, transcript_path: path.join(dir, sid + '.jsonl'), session_id: sid }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: XP_ROOT, ALFRED_CODE_DOCS_PATH: docs, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' },
  }).status;
  const ledger = (sid) => {
    const p = path.join(docs, 'hook-blocks', sid + '.jsonl');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  assert.equal(probe({ tool_name: 'Edit', tool_input: { file_path: path.join(XP_ROOT, 'a.cs') } }, ids.own), 0, 'the probe never denies');
  let rows = ledger(ids.own);
  assert.equal(rows.length, 1, 'one probe row for the edit');
  assert.equal(rows[0].mode, 'probe');
  assert.equal(rows[0].kind, 'fork-liveness');
  assert.equal(rows[0].detail.live[0].id, ids.sib, 'the live sibling of the same lineage is named');
  assert.equal(rows[0].detail.live[0].relation, 'sibling');
  assert.equal(probe({ tool_name: 'Bash', tool_input: { command: 'dotnet test ./tests' } }, ids.own), 0);
  assert.equal(probe({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }, ids.own), 0);
  rows = ledger(ids.own);
  assert.equal(rows.length, 2, 'a test run is a mutation; a git status is not');
  // the unrelated session edits freely: it is nobody's fork
  assert.equal(probe({ tool_name: 'Edit', tool_input: { file_path: path.join(XP_ROOT, 'a.cs') } }, ids.other), 0);
  assert.equal(ledger(ids.other).length, 0, 'no lineage, no row');
  // a sibling gone quiet (older than the liveness window) is not live
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(path.join(dir, ids.sib + '.jsonl'), old, old);
  assert.equal(probe({ tool_name: 'Edit', tool_input: { file_path: path.join(XP_ROOT, 'b.cs') } }, ids.own), 0);
  assert.equal(ledger(ids.own).length, 2, 'a quiet sibling is not live');
});

// ---------------------------------------------------------------------------
// The PowerShell route. Every shell guard matched `Bash` alone until 2026-09-12,
// when a hook audit measured 122 PowerShell tool calls in a 115-session corpus -
// the same shapes, a second spelling, and no gate on any of them. The analyzer had
// read PowerShell as a shell route since 34 of 38 test runs in one collection
// arrived that way, so the blind half was the guards. The payload is identical:
// `tool_input.command`. One case per guard, each the Bash case this file already
// pins, re-sent under the other tool name - a matcher widened with no case behind
// it is a claim, not a gate.
// ---------------------------------------------------------------------------
const pwsh = (hook, command) => run(hook, { tool_name: 'PowerShell', tool_input: { command } });

test('PowerShell route: the shell guards judge the second spelling of the same call', () => {
  assert.equal(pwsh('guard-protected-force-push.js', 'git push --force origin main'), 2, 'force-push to a protected branch');
  assert.equal(pwsh('guard-protected-force-push.js', 'echo "git push --force origin main"'), 0, 'the same text quoted is prose');
  assert.equal(pwsh('guard-catastrophic-rm.js', 'rm -rf $HOME'), 2, 'recursive rm of an unrecoverable target');
  assert.equal(pwsh('guard-catastrophic-rm.js', 'rm -rf bin obj node_modules'), 0, 'named build dirs pass');
  assert.equal(pwsh('guard-read-whole-file.js', `cat ${BIG}`), 2, 'whole-file dump of a large source');
  assert.equal(pwsh('guard-read-whole-file.js', `sed -n 1,40p ${BIG}`), 0, 'a ranged read passes');
  assert.equal(pwsh('guard-ungated-commit.js', 'git push origin develop'), 2, 'a push with no PUSH-GATE receipt');
  assert.equal(pwsh('guard-ungated-commit.js', 'git push --dry-run origin develop'), 0, 'a dry run publishes nothing');
});

test('PowerShell route: the cross-project write guard resolves the same target', () => {
  const outside = path.join(path.dirname(XP_ROOT), 'not-this-project-pwsh', 'f.txt');
  assert.equal(pwsh('guard-cross-project-write.js', `echo hi > ${outside}`), 2, 'a redirection outside the project root');
  assert.equal(run('guard-cross-project-write.js', { tool_name: 'Bash', tool_input: { command: `echo hi > ${outside}` } }), 2, 'and the Bash spelling agrees');
  assert.equal(pwsh('guard-cross-project-write.js', 'echo hi > README.md'), 0, 'an in-project relative target passes');
});

// The PowerShell tool's OWN write verbs. The case above re-sends a Bash spelling; the cmdlets a
// PowerShell session actually writes with (Set-Content, Out-File, Remove-Item, New-Item, Copy-Item,
// Move-Item) and the Set-Location that moves its cwd were never parsed, so the matcher claimed a
// route the parser could not see (replayed: each of these exit 0 while `echo x > <same path>` exits 2).
test('PowerShell route: the cmdlets that write, and Set-Location, are judged like their Bash twins', () => {
  const psx = (command) => xp({ tool_name: 'PowerShell', tool_input: { command } });
  const out = path.join(XP_OTHER, 'ps', 'f.txt');
  assert.equal(psx(`Set-Content -Path ${out} -Value x`), 2, 'Set-Content -Path');
  assert.equal(psx(`Add-Content ${out} 'more'`), 2, 'Add-Content, positional');
  assert.equal(psx(`'x' | Out-File -FilePath "${out}"`), 2, 'Out-File -FilePath behind a pipe');
  assert.equal(psx(`Remove-Item ${path.join(XP_OTHER, 'dist')} -Recurse -Force`), 2, 'Remove-Item');
  assert.equal(psx(`New-Item -ItemType File -Path ${out}`), 2, 'New-Item, the value of -ItemType skipped');
  assert.equal(psx(`Copy-Item README.md -Destination ${out}`), 2, 'Copy-Item -Destination');
  assert.equal(psx(`Move-Item ${out} .\\b.txt`), 2, 'Move-Item removes its source');
  assert.equal(psx(`set-content -path ${out} -value x`), 2, 'cmdlets are case-insensitive');
  assert.equal(psx(`Set-Location ${XP_OTHER}; Set-Content f.txt x`), 2, 'Set-Location then a relative write');
  assert.equal(psx(`Set-Location -Path ${XP_OTHER}; git commit -m x`), 2, 'Set-Location then a bare git write');
  // the passes carry equal weight - an in-project write, a read of the sibling, a value that looks like a path
  assert.equal(psx('Set-Content -Path notes.txt -Value x'), 0, 'an in-project Set-Content');
  assert.equal(psx(`Get-Content ${out}`), 0, 'reading the sibling stays open');
  assert.equal(psx(`Set-Content -Path notes.txt -Value ${out}`), 0, 'the -Value is data, not a target');
  assert.equal(psx(`Write-Output 'Remove-Item ${out}'`), 0, 'a quoted cmdlet is prose');
});

// ---- SubagentStop: a subagent that stops on a wait nobody will end ----------------------------
// Field report (2026-09-19, win32, v2.1.268): a fork with a multi-step brief made 2 tool calls in 18s,
// wrote nothing, and closed on 'That wakeup wasn't the right tool here (no /loop in play) - cancelled
// it. I'll just wait for the pilot fork's completion notification.' The pilot fork and the wait were the
// PARENT's; a subagent with no background work of its own is never notified or re-invoked, so the
// stop was final. The transcript shape below is the one the harness writes (measured on a real fork):
// a pointer to the parent's context, the parent's own Agent dispatch, the tool_result carrying the
// fork boilerplate, then the fork's own turns - rows before the boilerplate are the parent's.
const FORK_CLOSE = "That wakeup wasn't the right tool here (no /loop in play) - cancelled it. I'll just wait for the pilot fork's completion notification.";
function forkTranscript(name, ownTools, { parentBackground = false, fork = true } = {}) {
  const tu = (id, tool, input) => ({ type: 'tool_use', id, name: tool, input });
  const head = fork ? [
    { type: 'fork-context-ref' },
    { type: 'assistant', isSidechain: true, message: { content: [tu('p1', 'Agent', { subagent_type: 'fork', prompt: 'run the script, write the files', run_in_background: parentBackground })] } },
    { type: 'user', isSidechain: true, message: { content: [{ type: 'tool_result', tool_use_id: 'p1', content: 'launched' }, { type: 'text', text: '<fork-boilerplate>\nYou are a worker fork.\n</fork-boilerplate>\nRun the script, then write the files.' }] } },
  ] : [{ type: 'user', isSidechain: true, message: { content: 'Run the script, then write the files.' } }];
  const own = ownTools.map((t, i) => ({ type: 'assistant', isSidechain: true, message: { content: [tu(`o${i}`, t.name, t.input || {})] } }));
  return transcript(name, [...head, ...own]);
}
const WAKEUP_PAIR = [{ name: 'ScheduleWakeup', input: { delaySeconds: 60, prompt: 'x', reason: 'y', noop: false } }, { name: 'ScheduleWakeup', input: { stop: true } }];
function subStop(tp, text, { agentId, agentType = 'fork', logDir } = {}) {
  return runIn('guard-stop-contract.js', {
    hook_event_name: 'SubagentStop', session_id: 'sub-stop', agent_id: agentId || `a${Math.random().toString(16).slice(2, 14)}`,
    agent_type: agentType, agent_transcript_path: tp, last_assistant_message: text,
  }, { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir || fs.mkdtempSync(path.join(TMP, 'sub-')) } });
}

test('guard-stop-contract: the field-report fork - stopped on a wait with no background work of its own - is held and told to do its task', () => {
  const r = subStop(forkTranscript('fork-report', WAKEUP_PAIR), FORK_CLOSE);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no background work of its own|started no background work/i);
  assert.match(r.stderr, /the session that dispatched you/i);
  assert.match(r.stderr, /BLOCKED/);
});

test('guard-stop-contract: a subagent waiting on background work it started itself is not held', () => {
  const tools = [{ name: 'Bash', input: { command: 'npm test', run_in_background: true } }];
  assert.equal(subStop(forkTranscript('fork-own-bg', tools), 'Tests are running; I will wait for the background task notification.').status, 0);
  const monitor = [{ name: 'Monitor', input: { command: 'tail -f x' } }];
  assert.equal(subStop(forkTranscript('fork-own-monitor', monitor), "I'll wait for the monitor to report.").status, 0);
});

test('guard-stop-contract: the parent\'s own background dispatch, inherited above the boilerplate, is not the fork\'s', () => {
  assert.equal(subStop(forkTranscript('fork-parent-bg', WAKEUP_PAIR, { parentBackground: true }), FORK_CLOSE).status, 2);
});

test('guard-stop-contract: a subagent that did its work and reports is never held', () => {
  const tools = [{ name: 'Bash', input: { command: 'node build.js' } }, { name: 'Write', input: { file_path: 'out/a.md', content: 'a' } }];
  assert.equal(subStop(forkTranscript('fork-done', tools), 'Wrote out/a.md and out/b.md; build.js exited 0.').status, 0);
  // 'wait' describing the CODE, not the agent, is a report too.
  assert.equal(subStop(forkTranscript('fork-desc', tools), 'The retry loop waits for the lock before writing, so the files land in order.').status, 0);
});

test('guard-stop-contract: a subagent that called ScheduleWakeup is held even when its close names no wait', () => {
  assert.equal(subStop(forkTranscript('fork-wakeup-only', WAKEUP_PAIR), 'Cancelled the wakeup.').status, 2);
});

test('guard-stop-contract: a plain (non-fork) subagent stopping on a wait with nothing of its own running is held too', () => {
  assert.equal(subStop(forkTranscript('plain-wait', [], { fork: false }), "I'll wait for the other agent to finish first.", { agentType: 'general-purpose' }).status, 2);
});

test('guard-stop-contract: the hold fires once per subagent - the second stop goes through', () => {
  const logDir = fs.mkdtempSync(path.join(TMP, 'sub-once-'));
  const tp = forkTranscript('fork-once', WAKEUP_PAIR);
  assert.equal(subStop(tp, FORK_CLOSE, { agentId: 'aonce1', logDir }).status, 2);
  assert.equal(subStop(tp, FORK_CLOSE, { agentId: 'aonce1', logDir }).status, 0, 'never a loop');
  assert.equal(subStop(tp, FORK_CLOSE, { agentId: 'aonce2', logDir }).status, 2, 'another subagent is its own case');
});

test('guard-stop-contract: an unreadable subagent transcript never holds (no proof it started nothing)', () => {
  assert.equal(subStop(path.join(TMP, 'no-such-transcript.jsonl'), FORK_CLOSE).status, 0);
  assert.equal(subStop(undefined, FORK_CLOSE).status, 0);
});

// --- guard-config-protection.js: the cheapest way to 'pass' a check is to weaken it ---------------
function cfgProject(prefix) {
  const root = fs.mkdtempSync(path.join(TMP, prefix));
  const at = (rel, body) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };
  return { root, at };
}
function withProject(root, env, fn) {
  const keys = ['CLAUDE_PROJECT_DIR', ...Object.keys(env)];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_PROJECT_DIR = root;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('guard-config-protection: an existing check config cannot be weakened, a new one can be created', () => {
  const H = 'guard-config-protection.js';
  const { root, at } = cfgProject('cfg-');
  const edit = (file, old_string, new_string) => run(H, { tool_name: 'Edit', cwd: root, tool_input: { file_path: file, old_string, new_string } });
  const write = (file, content) => run(H, { tool_name: 'Write', cwd: root, tool_input: { file_path: file, content } });
  const sh = (command, tool = 'Bash') => run(H, { tool_name: tool, cwd: root, tool_input: { command } });
  withProject(root, {}, () => {
    const eslint = at('eslint.config.js', 'export default [];');
    assert.strictEqual(edit(eslint, '[]', '[{ rules: {} }]'), 2, 'existing eslint config is protected');
    assert.strictEqual(write(path.join(root, '.prettierrc'), '{}'), 0, 'creating a config is allowed');

    const ts = at('tsconfig.json', '{ "compilerOptions": { "strict": true, "paths": {} } }');
    assert.strictEqual(edit(ts, '"paths": {}', '"paths": { "@app/*": ["src/*"] }'), 0, 'a non-strictness key is open');
    assert.strictEqual(edit(ts, '"strict": true', '"strict": false'), 2, 'a strictness key is protected');
    assert.strictEqual(write(ts, '{ "compilerOptions": { "strict": true, "paths": { "a": ["b"] } } }'), 0, 'a whole-file Write keeping every strictness line is open');
    assert.strictEqual(write(ts, '{ "compilerOptions": { "strict": true, "skipLibCheck": true } }'), 2, 'a whole-file Write adding one is not');
    assert.strictEqual(run(H, { tool_name: 'MultiEdit', cwd: root, tool_input: { file_path: ts, edits: [
      { old_string: '"paths": {}', new_string: '"paths": {}, "noImplicitAny": false' }] } }), 2, 'MultiEdit is judged edit by edit');

    const proj = at('src/App/App.csproj', '<Project><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>');
    assert.strictEqual(edit(proj, '</PropertyGroup>', '<NoWarn>CS8602</NoWarn></PropertyGroup>'), 2, 'NoWarn added');
    assert.strictEqual(edit(proj, '</Project>', '<ItemGroup><PackageReference Include="X" Version="1.0.0" /></ItemGroup></Project>'), 0, 'a package reference is open');

    at('.editorconfig', 'root = true');
    at('.eslintrc.json', '{}');
    assert.strictEqual(sh("sed -i '' 's/true/false/' .editorconfig"), 2, 'in-place sed');
    assert.strictEqual(sh('echo x > .editorconfig'), 2, 'redirect');
    assert.strictEqual(sh('echo x | tee .editorconfig'), 2, 'tee after a pipe');
    assert.strictEqual(sh('rm .eslintrc.json'), 2, 'deleting the check is weakening it');
    assert.strictEqual(sh('cp /tmp/loose.json .eslintrc.json'), 2, 'copying over it');
    assert.strictEqual(sh("Set-Content -Path .editorconfig -Value 'root = false'", 'PowerShell'), 2, 'the PowerShell route');
    assert.strictEqual(sh('cat .editorconfig | grep root'), 0, 'a read passes');
    assert.strictEqual(sh('git restore .editorconfig'), 0, 'restoring the committed check passes');
    assert.strictEqual(sh('cp .eslintrc.json /tmp/backup.json'), 0, 'copying FROM it passes');
    assert.strictEqual(sh('npx eslint --fix src'), 0, 'running the check passes');

    const outside = fs.mkdtempSync(path.join(TMP, 'cfg-outside-'));
    fs.writeFileSync(path.join(outside, '.editorconfig'), 'root = true');
    assert.strictEqual(write(path.join(outside, '.editorconfig'), ''), 0, 'outside the project - the cross-project guard owns it');

    at('.claude/docs/flow/CONFIG-EDIT-ALLOW', 'eslint.config.js\n');
    assert.strictEqual(edit(eslint, '[]', '[{ rules: {} }]'), 0, 'the receipt is honoured');
    assert.strictEqual(edit(ts, '"strict": true', '"strict": false'), 2, 'for the file it names only');
    const old = new Date(Date.now() - 9 * 60 * 60 * 1000);
    fs.utimesSync(path.join(root, '.claude/docs/flow/CONFIG-EDIT-ALLOW'), old, old);
    assert.strictEqual(edit(eslint, '[]', '[{ rules: {} }]'), 2, 'a receipt older than 8h is not');
  });
  withProject(root, { ALFRED_CODE_CONFIG_PROTECT: '0' }, () =>
    assert.strictEqual(edit(path.join(root, 'tsconfig.json'), '"strict": true', '"strict": false'), 0, 'the env switch turns it off'));
  withProject(root, { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length,guard-config-protection' }, () =>
    assert.strictEqual(edit(path.join(root, 'tsconfig.json'), '"strict": true', '"strict": false'), 0, 'the per-project hooks csv switches it off'));
});

// A heredoc body and a quoted span are TEXT the command carries - a runbook that describes the rm, a
// commit message that names the file - and the siblings mask both for the same reason (a 47KB plan
// write denied for its own prose cost ~44k tokens). Replayed: both shapes below exit 2 before the fix.
test('guard-config-protection: a heredoc body or a quoted message naming a config is prose', () => {
  const H = 'guard-config-protection.js';
  const { root, at } = cfgProject('cfg-prose-');
  const sh = (command, tool = 'Bash') => run(H, { tool_name: tool, cwd: root, tool_input: { command } });
  withProject(root, {}, () => {
    at('.eslintrc.json', '{}');
    at('.editorconfig', 'root = true');
    assert.strictEqual(sh("cat > runbook.md <<'EOF'\n## Reset lint\nrm .eslintrc.json\necho x > .editorconfig\nEOF"), 0, 'a heredoc body describing the rm');
    assert.strictEqual(sh("git commit -m 'docs: explain why; rm .eslintrc.json is blocked'"), 0, 'a quoted commit message naming it');
    assert.strictEqual(sh('echo "use tee .editorconfig | never" > notes.md'), 0, 'a quoted pipe is not a pipe');
    // the real writes stay blocked, quoted targets included
    assert.strictEqual(sh('rm ".eslintrc.json"'), 2, 'a quoted target is still the target');
    assert.strictEqual(sh("cat > .editorconfig <<'EOF'\nroot = false\nEOF"), 2, "a heredoc's own redirect still writes");
    assert.strictEqual(sh("git add -A && rm .eslintrc.json"), 2, 'a real second step');
  });
});

test('guard-config-protection: the denial routes a wanted change through ONE ask and the receipt', () => {
  const { root, at } = cfgProject('cfg-msg-');
  const file = at('.editorconfig', 'root = true');
  const r = withProject(root, {}, () => spawnSync(process.execPath, [path.join(HOOKS, 'guard-config-protection.js')],
    { input: JSON.stringify({ tool_name: 'Write', cwd: root, tool_input: { file_path: file, content: '' } }), encoding: 'utf8' }));
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /Blocked: \.editorconfig already exists/);
  assert.match(r.stderr, /ONE AskUserQuestion/);
  assert.match(r.stderr, /\.claude\/docs\/flow\/CONFIG-EDIT-ALLOW/);
  // the denial names the mandate it mechanizes, so the next maintainer (and the model) can read why
  assert.match(r.stderr, /alfred-habits-done-gate/);
});

test('guard-config-protection: a block writes one ledger row naming the hook', () => {
  const { root } = cfgProject('cfg-led-');
  fs.writeFileSync(path.join(root, '.editorconfig'), 'root = true');
  withProject(root, {}, () => {
    run('guard-config-protection.js', { session_id: 's1', tool_name: 'Write', cwd: root, tool_input: { file_path: path.join(root, '.editorconfig'), content: '' } });
    const rows = fs.readFileSync(path.join(root, '.claude/docs/hook-blocks/s1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hook, 'guard-config-protection.js');
    assert.deepStrictEqual(rows[0].detail, { file: '.editorconfig', why: 'it is a lint / format / analyzer config' });
  });
});

// --- the staged-diff scan on the commit branch -------------------------------------------------
// A fact check on what the commit would add - conflict markers, a debugger, a focused test, a
// credential - ahead of the trivial-diff exemption and of every receipt.
const stagedRepo = (files, { stage = true } = {}) => {
  const dir = cleanRepo();
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  if (stage) spawnSync('git', ['-C', dir, 'add', '-A']);
  return dir;
};
const commitIn = (files, command = 'git commit -m "x"', opts) => gateIn(stagedRepo(files, opts), command);

test('guard-ungated-commit: the staged scan blocks conflict markers, debugger, focused tests and credentials - on ADDED lines only', () => {
  const token = ['ghp', '0123456789abcdefghij0123456789abcdef'].join('_');
  assert.equal(commitIn({ 'a.ts': 'const a = 1;\ndebugger;\n' }), 2, 'debugger');
  assert.equal(commitIn({ 'a.spec.ts': "fdescribe('x', () => {});\n" }), 2, 'focused test');
  assert.equal(commitIn({ 'src/a.test.js': "it.only('x', () => {});\n" }), 2, 'it.only');
  assert.equal(commitIn({ 'a.cs': 'System.Diagnostics.Debugger.Launch();\n' }), 2, 'Debugger.Launch');
  assert.equal(commitIn({ 'a.txt': '<<<<<<< HEAD\n' }), 2, 'conflict marker');
  assert.equal(commitIn({ 'notes.md': `token ${token}\n` }), 2, 'a credential blocks even in markdown');
  assert.equal(commitIn({ 'notes.md': 'never commit a `debugger;` line\n' }), 0, 'prose about the pattern passes');
  assert.equal(commitIn({ 'model.py': 'model.fit(x, y)\n' }), 0, 'fit( outside a test file is not a focused test');
  assert.equal(commitIn({ 'a.ts': 'const a = 1;\n' }), 0, 'a clean one-line diff stays trivial and passes');
});

test('guard-ungated-commit: the staged scan reads what THIS act commits', () => {
  // a chained add stages mid-command: nothing is staged when the hook runs, so the tree is read
  assert.equal(commitIn({ 'a.ts': 'debugger;\n' }, 'git add . && git commit -m "x"', { stage: false }), 2, 'git add . && commit');
  assert.equal(commitIn({ 'a.ts': 'debugger;\n' }, 'git add -A; git commit -m "x"', { stage: false }), 2, 'git add -A; commit');
  // a plain commit takes only the index: an unstaged debugger is not part of it
  const dir = stagedRepo({ 'clean.ts': 'const a = 1;\n' });
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n<<<<<<< HEAD\n');
  assert.equal(gateIn(dir, 'git commit -m "x"'), 0, 'an unstaged conflict marker is not committed');
  assert.equal(gateIn(dir, 'git commit -am "x"'), 2, 'commit -a takes the unstaged change too');
  // a REMOVED line is never a finding
  const rm = cleanRepo();
  fs.writeFileSync(path.join(rm, 'b.ts'), 'const b = 1;\ndebugger;\n');
  spawnSync('git', ['-C', rm, 'add', '-A']); spawnSync('git', ['-C', rm, 'commit', '-qm', 'seed debugger']);
  fs.writeFileSync(path.join(rm, 'b.ts'), 'const b = 1;\n'); spawnSync('git', ['-C', rm, 'add', '-A']);
  assert.equal(gateIn(rm, 'git commit -m "remove debugger"'), 0, 'removing a debugger line passes');
  assert.equal(commitIn({ 'a.ts': 'debugger;\n' }, 'git commit --dry-run -m "x"'), 0, 'a dry run is never scanned');
});

test('guard-ungated-commit: no receipt opens the staged scan, and the block names file and line', () => {
  const dir = stagedRepo({ 'n1.txt': forty(), 'n2.txt': forty(), 'n3.txt': forty() });
  const gate = path.join(dir, '.claude', 'docs', 'flow', 'COMMIT-GATE');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  fs.writeFileSync(gate, 'WAIVED - "commit it without the review"\n');
  assert.equal(gateIn(dir, 'git commit -m "x"'), 0, 'the waiver opens the gate on a clean non-trivial diff');
  fs.writeFileSync(path.join(dir, 'n4.ts'), 'const a = 1;\ndebugger;\n'); spawnSync('git', ['-C', dir, 'add', '-A']);
  const r = runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' }, session_id: 'scan-sess' },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, cwd: dir });
  assert.equal(r.status, 2, 'the same waiver does not open the scan');
  assert.match(r.stderr, /n4\.ts:2 - a debugger statement/, 'file and line named');
  const ledger = path.join(dir, '.claude', 'docs', 'hook-blocks', 'scan-sess.jsonl');
  const row = JSON.parse(fs.readFileSync(ledger, 'utf8').trim().split('\n').pop());
  assert.deepEqual(row.detail, { branch: 'staged-scan', count: 1 }, 'the block row carries the scan branch');
});

test('guard-ungated-commit: the staged scan reads at most 2MB of diff, and passes past it', () => {
  const LIMIT = 2 * 1024 * 1024;
  const dir = cleanRepo();
  const file = path.join(dir, 'big.ts');
  const diffLen = () => spawnSync('git', ['-C', dir, 'diff', '--cached', '-U0', '--no-color'], { maxBuffer: 16 * LIMIT }).stdout.length;
  const sized = (target) => {
    let pad = target;
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(file, `debugger;\n${'x'.repeat(pad)}\n`); spawnSync('git', ['-C', dir, 'add', '-A']);
      pad += target - diffLen();
    }
    assert.equal(diffLen(), target, `fixture diff is exactly ${target} bytes`);
  };
  sized(LIMIT - 1);
  assert.equal(gateIn(dir, 'git commit -m "x"'), 2, 'a diff one byte under the cap is scanned');
  sized(LIMIT + 1);
  assert.equal(gateIn(dir, 'git commit -m "x"'), 0, 'a diff one byte over the cap passes unscanned');
});

test('guard-ungated-commit: a STAGED-SCAN-ALLOW receipt keeps exactly the hits it names, for 8h', () => {
  const dir = stagedRepo({ 'a.spec.ts': "fit('x', () => {});\n", 'b.ts': 'debugger;\n' });
  const allow = path.join(dir, '.claude', 'docs', 'flow', 'STAGED-SCAN-ALLOW');
  fs.mkdirSync(path.dirname(allow), { recursive: true });
  fs.writeFileSync(allow, 'a.spec.ts:1\n');
  assert.equal(gateIn(dir, 'git commit -m "x"'), 2, 'one hit kept, the other still blocks');
  fs.writeFileSync(allow, 'a.spec.ts:1\nb.ts\n');
  assert.equal(gateIn(dir, 'git commit -m "x"'), 0, 'every hit named - the commit passes');
  const hours = (h) => { const t = new Date(Date.now() - h * 3600 * 1000); fs.utimesSync(allow, t, t); };
  hours(7.9);
  assert.equal(gateIn(dir, 'git commit -m "x"'), 0, 'just under 8h still holds');
  hours(8.1);
  assert.equal(gateIn(dir, 'git commit -m "x"'), 2, 'past 8h the receipt is absent');
});

// --- one home for the fresh-session arithmetic ---------------------------------------------------
const FRESH_FNS = ['freshAt', 'tableWindow', 'coldFloor', 'worthResuming', 'ctxThreshold', 'sessionModelId'];

test('fresh-session engine: the arithmetic both fresh-session hooks share lives in ONE file', () => {
  const eng = require(path.join(HOOKS, 'fresh-session.js'));
  for (const fn of FRESH_FNS) assert.equal(typeof eng[fn], 'function', `the engine exports ${fn}`);
  for (const h of ['guard-stop-contract.js', 'guard-fresh-session-start.js']) {
    const src = fs.readFileSync(path.join(HOOKS, h), 'utf8');
    for (const fn of FRESH_FNS) assert.ok(!new RegExp(`(const|let|function)\\s+${fn}\\b`).test(src), `${h} no longer defines ${fn}`);
  }
  eng.use({});
  assert.equal(eng.freshAt('NO_SUCH_FRESH_KEY', 7), 7, 'garbage or absent takes the default');
  assert.equal(eng.worthResuming(300000), true, 'an unreadable floor answers yes');
});

test('fresh-session engine: both hooks run silent when the engine file is missing', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'no-engine-'));
  for (const f of ['guard-stop-contract.js', 'guard-fresh-session-start.js', 'hook-prelude.js', 'model-windows.json']) fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
  const tp = transcript('no-engine', [{ type: 'assistant', message: { model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 1, cache_read_input_tokens: 900000 } } }]);
  const go = (hook, payload) => spawnSync(process.execPath, [path.join(dir, hook)], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const stop = go('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: 'Done.' });
  assert.equal(stop.status, 0, stop.stderr); assert.equal(stop.stderr, ''); assert.equal(stop.stdout, '');
  const skill = go('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'alfred-task-verify-code' }, transcript_path: tp });
  assert.equal(skill.status, 0, skill.stderr); assert.equal(skill.stderr, ''); assert.equal(skill.stdout, '');
});

test('guard-stop-contract: a turn that ends on a tool call logs one skip-tool-end row and passes', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'tool-end-'));
  const tp = transcript('tool-end', [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }]);
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'guard-stop-contract.js')], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'tool-end-sess', transcript_path: tp }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r.status, 0);
  const rows = fs.readFileSync(path.join(dir, '.claude', 'docs', 'hook-blocks', 'tool-end-sess.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, 'skip-tool-end');
  assert.equal(rows[0].hook, 'guard-stop-contract.js');
});

// ---- guard-stop-contract: the audit's R1 / R2 / R4 / R6 ----------------------------------------
const FAKE_TOKEN = 'ghp_' + 'Q7'.repeat(18);   // credential-SHAPED, no real value

test('guard-stop-contract: the ask-time credential note honours the same off switch and answers as the Stop branch', () => {
  // The Stop branch asks once per exposure and never with ROTATE_ASK=0; the ask-time note ignored all
  // three and re-raised rotation on every ask of a session whose user had already answered.
  const logDir = fs.mkdtempSync(path.join(TMP, 'r1-'));
  const leaked = transcript('r1-leak', [
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `token=${FAKE_TOKEN}` }] } },
    assistantRow('r1', 'ok', { cache_read_input_tokens: 900 }),
  ]);
  const answered = transcript('r1-answered', [
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `token=${FAKE_TOKEN}` }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Your questions have been answered: rotate now' }] } },
  ]);
  const ask = (tp, extra) => runIn('guard-stop-contract.js',
    { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', transcript_path: tp,
      tool_input: { questions: [{ question: 'Next?', options: [{ label: 'Continue', description: 'x' }] }] } },
    { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir, ...(extra || {}) } });
  const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
  assert.match(ctxOf(ask(leaked)), /credential-shaped value/, 'an unanswered exposure is still raised');
  assert.doesNotMatch(ctxOf(ask(leaked, { ALFRED_CODE_ROTATE_ASK: '0' })), /credential-shaped value/, 'ROTATE_ASK=0 turns it off here too');
  assert.doesNotMatch(ctxOf(ask(answered)), /credential-shaped value/, 'an answered rotate ask covers it');
});

test('guard-stop-contract: a continued subagent stop is never held again, marker or not', () => {
  // The once-marker was the only loop guard on SubagentStop; an unwritable log dir lost it.
  const r = runIn('guard-stop-contract.js', {
    hook_event_name: 'SubagentStop', session_id: 'sub-stop', agent_id: 'a-r2', agent_type: 'fork', stop_hook_active: true,
    agent_transcript_path: forkTranscript('fork-r2', WAKEUP_PAIR), last_assistant_message: FORK_CLOSE,
  }, { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'r2-')) } });
  assert.equal(r.status, 0, r.stderr);
});

test('guard-stop-contract: a PowerShell git status is the state read the stale-scope note looks for', () => {
  const tp = transcript('r4-ps', [
    { type: 'user', message: { content: 'publish it' } },
    { type: 'assistant', message: { id: 'p1', content: [{ type: 'tool_use', id: 't1', name: 'PowerShell', input: { command: 'git status --porcelain' } }], usage: { cache_read_input_tokens: 900 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'M f' }] } },
  ]);
  const r = runIn('guard-stop-contract.js',
    { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', transcript_path: tp,
      tool_input: { questions: [{ question: 'Publish?', options: [{ label: 'Push to origin', description: 'land it' }] }] } },
    { env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'r4-')) } });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { ctx = ''; }
  assert.doesNotMatch(ctx, /no `git status`/);
});

test('guard-stop-contract: a credential in the blocked text never reaches the ledger or the breadcrumb', () => {
  const ledger = fs.mkdtempSync(path.join(TMP, 'r6-'));
  const logDir = fs.mkdtempSync(path.join(TMP, 'r6log-'));
  const r = runIn('guard-stop-contract.js',
    { hook_event_name: 'Stop', session_id: 'r6', cwd: ledger, last_assistant_message: `The token is ${FAKE_TOKEN} - should I rotate it or keep ${FAKE_TOKEN}?` },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: ledger, ALFRED_CODE_DOCS_PATH: path.join(ledger, 'docs'), ALFRED_CODE_HOOK_LOG_DIR: logDir } });
  assert.equal(r.status, 2, 'the close ends on a question and is held');
  const rows = fs.readFileSync(path.join(ledger, 'docs', 'hook-blocks', 'r6.jsonl'), 'utf8');
  assert.ok(!rows.includes(FAKE_TOKEN), 'the ledger row carries no value');
  assert.match(rows, /<redacted>/, 'it says one was there');
  assert.ok(!fs.readFileSync(path.join(logDir, 'guard-stop-contract.log'), 'utf8').includes(FAKE_TOKEN), 'nor does the breadcrumb');
});
