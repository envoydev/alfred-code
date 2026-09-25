'use strict';
// R106: two of the method skills get a DETERMINISTIC trigger in guard-stop-contract.js, because a
// skill description alone never fires reliably.
//   done gate  - Stop: a close claiming the session's own change done / fixed / passing / works /
//                ready is held ONCE per turn when a source edit landed after the turn's last build or
//                test run (or none ran), naming `project-done-gate`. A close with no edit never trips.
//   root cause - PostToolUseFailure / PostToolUse on Bash and PowerShell: a build or test command that
//                failed injects 'load `project-root-cause`' ONCE per failure streak; the next green run
//                of that command resets the streak. Injection only - never a block.
// Both directions are pinned: a gate that also fires on the clean neighbour teaches a bypass.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-stop-method-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

// A session's own settings env reaches this process; pin every switch the branches read.
for (const k of ['ALFRED_CODE_DONE_GATE', 'CLAUDE_STACK_DONE_GATE', 'ALFRED_CODE_HOOKS_OFF', 'CLAUDE_STACK_HOOKS_OFF', // legacy-name
    'ALFRED_CODE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_DOCS_PATH', 'CLAUDE_PLUGIN_ROOT', 'ALFRED_CODE_ROTATE_ASK']) // legacy-name
    delete process.env[k];
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));

let n = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    fs.mkdirSync(path.join(root, 'src'));
    return root;
}
function run(root, payload, extraEnv)
{
    const logDir = path.join(root, '.hooklog');
    fs.mkdirSync(logDir, { recursive: true });
    const r = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({ session_id: 'sess-1', cwd: root, ...payload }), encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_HOOK_LOG_DIR: logDir, ...(extraEnv || {}) },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const ledger = (root) =>
{
    const f = path.join(root, '.claude', 'docs', 'hook-blocks', 'sess-1.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// --- transcript rows --------------------------------------------------------------------------
const typed = (text, uuid) => ({ type: 'user', uuid: uuid || `u-${++n}`, message: { role: 'user', content: text } });
const call = (name, input) => { const id = `t-${++n}`; return { id, row: { type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } } }; };
const result = (id, content, isError) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m-${++n}`, content: [{ type: 'text', text }] } });
function steps(root, list)
{
    // ['run', cmd, err?] | ['edit', file, err?] | ['text', s] | ['prompt', s]
    const rows = [];
    for (const [kind, arg, err] of list)
    {
        if (kind === 'prompt') { rows.push(typed(arg)); continue; }
        if (kind === 'text') { rows.push(say(arg)); continue; }
        const c = kind === 'run' ? call('Bash', { command: arg })
            : call(kind === 'write' ? 'Write' : 'Edit', { file_path: path.isAbsolute(arg) ? arg : path.join(root, arg), old_string: 'a', new_string: 'b' });
        rows.push(c.row, result(c.id, err ? (typeof err === 'string' ? err : 'Exit code 1\nfailed') : 'ok', !!err));
    }
    return rows;
}
function transcript(root, rows)
{
    const p = path.join(root, `t-${++n}.jsonl`);
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const stop = (root, rows, text, extraEnv, extra) =>
    run(root, { hook_event_name: 'Stop', stop_hook_active: false, transcript_path: transcript(root, rows), last_assistant_message: text, ...(extra || {}) }, extraEnv);

// --- done gate: Stop --------------------------------------------------------------------------
test('done gate: a done claim over an edit made after the turn\'s last test run is held, naming the skill', () => {
    const root = project();
    const r = stop(root, steps(root, [['prompt', 'fix the cart total'], ['run', 'npm test', true], ['edit', 'src/money.js']]),
        'Fixed - the cart total is right now.');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /`project-done-gate`/);
    assert.match(r.stderr, /after the last build or test run/);
    const rows = ledger(root);
    assert.strictEqual(rows.length, 1, JSON.stringify(rows));
    assert.strictEqual(rows[0].detail.branch, 'done-gate');
    assert.ok(!rows[0].mode, 'a block row, not a probe');
});

test('done gate: an edit and no run at all in the turn is held too', () => {
    const root = project();
    const r = stop(root, steps(root, [['prompt', 'rename the helper'], ['edit', 'src/cart.js'], ['edit', 'src/money.js']]), 'Done. Both call sites use the new name.');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /none ran/);
});

test('done gate: the same close with a run after the last edit passes', () => {
    const root = project();
    for (const cmd of ['npm test', 'node --test test/cart.test.js', 'cd sub && npx vitest run', 'dotnet test -v q 2>&1 | tail -5', 'pytest -q', 'go test ./...', 'cargo test', './gradlew test', 'mvn -q verify', 'ng build'])
    {
        const r = stop(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed - tests 3, pass 3.');
        assert.strictEqual(r.status, 0, `${cmd}: ${r.stderr}`);
    }
    // a RED run after the edit is still the run the gate asks for - the claim is another matter
    assert.strictEqual(stop(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['run', 'npm test', true]]), 'Fixed.').status, 0);
    assert.deepStrictEqual(ledger(root), [], 'no block, no row');
});

test('done gate: a close with no edit this turn never trips', () => {
    const root = project();
    // an edit in the PREVIOUS turn, a done claim in this one
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['text', 'Edited.'], ['prompt', 'is it done?']]);
    assert.strictEqual(stop(root, rows, 'Yes - it is done and ready.').status, 0);
    assert.strictEqual(stop(root, steps(root, [['prompt', 'explain the cart']]), 'Done - the cart sums integer cents.').status, 0);
});

test('done gate: what does not count as a source edit, or as a claim, passes', () => {
    const root = project();
    const held = (list, text) => stop(root, steps(root, [['prompt', 'go'], ...list]), text).status;
    assert.strictEqual(held([['edit', 'src/money.js', 'Error: String to replace not found']], 'Fixed.'), 0, 'a rejected edit changed nothing');
    assert.strictEqual(held([['edit', 'README.md'], ['edit', 'docs/guide.md']], 'Done - the README is updated.'), 0, 'prose files are no build input');
    assert.strictEqual(held([['edit', '.claude/docs/superpowers/plans/cart.md'], ['write', '.claude/docs/flow/COMMIT-GATE']], 'Ready.'), 0, 'the docs root and flow receipts');
    assert.strictEqual(held([['edit', path.join(os.tmpdir(), 'scratch-probe.js')]], 'Done.'), 0, 'a scratch file outside the project');
    assert.strictEqual(held([['edit', 'src/money.js']], 'The fix is in, but it is not done until the suite runs - that is next.'), 0, 'a negated claim');
    assert.strictEqual(held([['edit', 'src/money.js']], 'Fixed toCents to strip the comma. Not run - I could not run the tests here, no node on this machine.'), 0, 'an honest could-not-run');
    assert.strictEqual(held([['edit', 'src/money.js']], 'Changed toCents to strip the thousands comma.'), 0, 'no claim at all');
    assert.strictEqual(held([['edit', 'src/money.js']], 'Here is how it works: the done gate reads the transcript, a fixed trigger, passing the flag through.'), 0, 'the words, not a claim');
    assert.strictEqual(held([['edit', 'src/money.js']], 'Is it done? Not until the suite runs.'), 0, 'a question is no claim');
    assert.strictEqual(held([['edit', 'src/money.js']], 'The tests should pass now.'), 2, 'the hedge the skill names as a skipped gate');
    assert.strictEqual(held([['edit', 'src/money.js']], 'It works now - the comma is stripped.'), 2);
    assert.strictEqual(held([['edit', 'src/money.js']], 'The change is ready to commit.'), 2);
    assert.strictEqual(held([['edit', 'src/money.js'], ['run', 'npm test', 'Bash operation blocked by hook: no receipt']], 'Fixed.'), 2, 'a run a hook blocked never ran');
});

test('done gate: held once per turn, re-armed by the next typed turn', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    assert.strictEqual(stop(root, rows, 'Fixed.').status, 2);
    assert.strictEqual(stop(root, rows, 'Fixed.').status, 0, 'the same turn is never held twice');
    assert.strictEqual(stop(root, rows, 'Fixed.', {}, { stop_hook_active: true }).status, 0, 'the continuation the block caused');
    const next = rows.concat(steps(root, [['text', 'Fixed.'], ['prompt', 'now the tax line'], ['edit', 'src/tax.js']]));
    assert.strictEqual(stop(root, next, 'Done - tax is applied per line.').status, 2, 'a new turn is judged afresh');
    assert.strictEqual(ledger(root).length, 2);
});

test('done gate: ALFRED_CODE_DONE_GATE=0 switches it off', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    assert.strictEqual(stop(root, rows, 'Fixed.', { ALFRED_CODE_DONE_GATE: '0' }).status, 0);
    assert.strictEqual(stop(root, rows, 'Fixed.', { ALFRED_CODE_DONE_GATE: '1' }).status, 2);
});

// --- root cause: PostToolUseFailure / PostToolUse ---------------------------------------------
const post = (root, event, tool, command, extra, extraEnv) =>
    run(root, { hook_event_name: event, tool_name: tool, tool_input: { command }, ...(extra || {}) }, extraEnv);
const injected = (r) =>
{
    if (!r.stdout.trim()) return null;
    const o = JSON.parse(r.stdout);
    return o.hookSpecificOutput;
};

test('root cause: a failing test command injects the skill once per streak, and a green run resets it', () => {
    const root = project();
    const first = post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1\nnot ok 1 - cart total' });
    assert.strictEqual(first.status, 0, 'injection only, never a block');
    const out = injected(first);
    assert.ok(out, 'the first failure injects');
    assert.strictEqual(out.hookEventName, 'PostToolUseFailure');
    assert.match(out.additionalContext, /load `project-root-cause`/);
    assert.match(out.additionalContext, /before the next fix/);
    assert.strictEqual(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test 2>&1 | tail -20', { error: 'Exit code 1' })), null, 'a second failure in the streak is silent');
    assert.strictEqual(injected(post(root, 'PostToolUse', 'Bash', 'npm test', { tool_response: { stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '' } })), null, 'a green run says nothing');
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1' })), 'the next failure after green injects again');
    const rows = ledger(root);
    assert.strictEqual(rows.length, 2, JSON.stringify(rows));
    for (const row of rows) { assert.strictEqual(row.mode, 'inject'); assert.strictEqual(row.kind, 'root-cause'); }
});

test('root cause: the streak is per command, per actor, and the shell tools both count', () => {
    const root = project();
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1' })));
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'dotnet build', { error: 'Exit code 1' })), 'another command is another streak');
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1', agent_id: 'agent-7' })), 'a subagent keeps its own streak');
    assert.ok(injected(post(root, 'PostToolUseFailure', 'PowerShell', 'dotnet test', { error: 'Exit code 1' })), 'PowerShell runs count');
    // a green dotnet build resets that streak only
    assert.strictEqual(injected(post(root, 'PostToolUse', 'Bash', 'dotnet build', { tool_response: { stdout: 'Build succeeded.\n    0 Error(s)', stderr: '' } })), null);
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'dotnet build', { error: 'Exit code 1' })));
    assert.strictEqual(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1' })), null, 'the npm test streak never reset');
});

test('root cause: a red run piped to a filter that exits 0 still counts as red', () => {
    const root = project();
    const piped = (stdout) => injected(post(root, 'PostToolUse', 'Bash', 'node --test 2>&1 | tail -5', { tool_response: { stdout, stderr: '' } }));
    assert.ok(piped('ℹ tests 3\nℹ pass 2\nℹ fail 1'), 'node --test summary with a failure');
    assert.strictEqual(piped('ℹ tests 3\nℹ pass 2\nℹ fail 1'), null, 'the same streak');
    assert.strictEqual(piped('ℹ tests 3\nℹ pass 3\nℹ fail 0'), null, 'green resets');
    assert.ok(piped('Tests:       1 failed, 2 passed, 3 total'), 'a jest summary after the reset');
});

test('root cause: what is not a failing build or test run injects nothing', () => {
    const root = project();
    const none = (event, tool, cmd, extra) => assert.strictEqual(injected(post(root, event, tool, cmd, extra)), null, `${event} ${tool} ${cmd}`);
    none('PostToolUseFailure', 'Bash', 'ls missing-dir', { error: 'Exit code 1' });
    none('PostToolUseFailure', 'Bash', 'grep -rn "npm test" docs', { error: 'Exit code 1' });
    none('PostToolUseFailure', 'Bash', 'cat jest.config.js', { error: 'Exit code 1' });
    none('PostToolUseFailure', 'Bash', 'npm install', { error: 'Exit code 1' });
    none('PostToolUseFailure', 'Bash', 'npm test', { error: 'Interrupted', is_interrupt: true });
    none('PostToolUseFailure', 'Read', 'npm test', { error: 'boom' });
    none('PostToolUse', 'Bash', 'npm test', { tool_response: { stdout: 'ok', stderr: '', interrupted: true } });
    assert.deepStrictEqual(ledger(root), []);
});

test('root cause: a runner counts at the start of a segment, never as an argument', () => {
    const root = project();
    let s = 0;
    const fires = (cmd) => !!injected(post(root, 'PostToolUseFailure', 'Bash', cmd, { error: 'Exit code 1', session_id: `c-${++s}` }));
    for (const cmd of ['npx jest --watchAll=false', 'yarn test', 'pnpm run build', 'npm run typecheck', 'python -m pytest tests', 'cargo clippy',
        'go vet ./...', 'ng test --watch=false', '.\\gradlew.bat build', 'FOO=1 npm test', 'env -u X node --test a.test.js', 'timeout 60 dotnet test',
        'cd web && npm test -- --run'])
        assert.ok(fires(cmd), `a build or test run: ${cmd}`);
    for (const cmd of ['npm run lint', 'npm ci', 'npm install jest', 'echo npm test', 'git commit -m "npm test"', 'cat <<EOF\nnpm test\nEOF', 'node scripts/build-marketplace.js'])
        assert.ok(!fires(cmd), `not a build or test run: ${cmd}`);
});

// --- both: a repo never set up, and a malformed payload -----------------------------------------
test('both branches stand down in a repo never set up, and write nothing there', () => {
    const repo = fs.mkdtempSync(path.join(TMP, 'unset-'));
    execFileSync('git', ['init', '-q', repo]);
    const env = { CLAUDE_PLUGIN_ROOT: '/cfg/plugins/cache/envoydev/alfred-code/2.0.0' };
    const rows = steps(repo, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    const p = path.join(TMP, 'unset-transcript.jsonl');
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const payload of [
        { hook_event_name: 'Stop', stop_hook_active: false, transcript_path: p, last_assistant_message: 'Fixed.' },
        { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' },
    ])
    {
        const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'unset', cwd: repo, ...payload }), encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env } });
        assert.strictEqual(r.status, 0, `${payload.hook_event_name}: ${r.stderr}`);
        assert.strictEqual(r.stdout.trim(), '');
    }
    assert.ok(!fs.existsSync(path.join(repo, '.claude')), 'nothing written into a repo never set up');
});

test('garbage in fails open', () => {
    const root = project();
    for (const input of ['', 'not json', '42', JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }),
        JSON.stringify({ hook_event_name: 'Stop', transcript_path: path.join(root, 'absent.jsonl'), last_assistant_message: 'Fixed.' })])
    {
        const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_HOOK_LOG_DIR: TMP } });
        assert.strictEqual(r.status, 0, `${input.slice(0, 40)}: ${r.stderr}`);
    }
});
