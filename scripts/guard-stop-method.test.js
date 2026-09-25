'use strict';
// R106: two of the method skills get a DETERMINISTIC trigger in guard-stop-contract.js, because a
// skill description alone never fires reliably.
//   done gate  - Stop: a close claiming the session's own change done / fixed / passing / works /
//                ready is held ONCE per turn when a source edit landed after the turn's last build or
//                test run (or none ran), naming `alfred-habits-done-gate`. A close with no edit never trips.
//   root cause - PostToolUseFailure / PostToolUse on Bash and PowerShell: a build or test command that
//                failed injects 'load `alfred-habits-root-cause`' ONCE per failure streak; the next green run
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
    // ['run', cmd, err?] | ['edit', file, err?] | ['agent', prompt, err?] | ['text', s] | ['prompt', s]
    const rows = [];
    for (const [kind, arg, err] of list)
    {
        if (kind === 'prompt') { rows.push(typed(arg)); continue; }
        if (kind === 'text') { rows.push(say(arg)); continue; }
        const c = kind === 'run' ? call('Bash', { command: arg })
            : kind === 'agent' ? call('Agent', { subagent_type: 'web-angular-verifier', description: 'verify', prompt: arg })
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
    assert.match(r.stderr, /`alfred-habits-done-gate`/);
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
    assert.match(r.stderr, /no shell command or dispatched agent after it/);
});

// I1: the done gate asks 'did anything run after the edit', a wider question than the root-cause
// pointer's 'which runner failed'. A run the narrow list cannot name is still a run, so the honest
// close over it passes; only reads, writes and git after the edit leave the change unrun.
test('done gate: a run the root-cause list cannot name still counts as the run', () => {
    const root = project();
    for (const cmd of ['make test', 'uv run pytest -q', 'poetry run pytest', 'bundle exec rspec', 'pnpm --filter web test', 'npm --prefix web test',
        './scripts/test.sh', 'deno test', 'python manage.py test', 'msbuild App.sln', 'swift test', 'flutter test'])
    {
        const r = stop(root, steps(root, [['prompt', `fix it ${cmd}`], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed - 12 passed.');
        assert.strictEqual(r.status, 0, `${cmd}: ${r.stderr}`);
    }
    assert.deepStrictEqual(ledger(root), []);
});

test('done gate: a read, a write, git or an install after the edit is no run, and the hold never says none ran', () => {
    const root = project();
    for (const cmd of ['git diff', 'cat src/money.js', 'grep -n toCents src/money.js', 'ls src', 'git status && git log -1', 'sed -n 1,20p src/money.js',
        'npm install', 'cd src; ls', 'Get-Content src/money.js'])
    {
        const r = stop(root, steps(root, [['prompt', `fix it ${cmd}`], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed.');
        assert.strictEqual(r.status, 2, `${cmd}: ${r.stderr}`);
        assert.doesNotMatch(r.stderr, /none ran/);
        assert.match(r.stderr, /no shell command or dispatched agent after it/);
    }
    const r = stop(root, steps(root, [['prompt', 'fix again'], ['run', 'make test'], ['edit', 'src/money.js']]), 'Fixed.');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /after the last build or test run in this turn \(`make test`\)/, 'the missed run is named, never called none');
});

// I2: under a Bash-first harness the shell IS the write route, so a shell write to a source file is an
// edit - read through the same detection the cross-project guard blocks with (shell-writes.js).
test('done gate: a shell write to a source file is an edit', () => {
    const root = project();
    const held = (list, text) => stop(root, steps(root, [['prompt', `go ${JSON.stringify(list)}`], ...list]), text || 'Fixed.');
    const r = held([['run', "sed -i '' 's/a/b/' src/a.js"]]);
    assert.strictEqual(r.status, 2, 'sed -i then Fixed.');
    assert.match(r.stderr, /src[\\/]a\.js was edited/);
    for (const cmd of ["cat > src/new.js <<'EOF'\nexport const x = 1;\nEOF", 'echo "export {}" >> src/index.ts', "cd src && perl -pi -e 's/a/b/' money.js",
        "python3 - <<'PY'\nfrom pathlib import Path\nPath('src/tax.py').write_text('x = 1')\nPY", 'cp templates/a.js src/b.js', 'rm src/old.js',
        "npm test && sed -i 's/a/b/' src/a.js"])
        assert.strictEqual(held([['run', cmd]]).status, 2, cmd);
    assert.match(held([['run', "cd src && sed -i 's/a/b/' money.js"]]).stderr, /src[\\/]money\.js was edited/, 'a cd moves the anchor');
    for (const cmd of ["sed -i 's/a/b/' src/a.js && npm test", 'npm test > build.log 2>&1', 'echo done > notes.log', 'echo x > /tmp/probe.js',
        'git commit -qm wip', "sed -i 's/a/b/' README.md", 'mkdir -p src/new', 'echo "sed -i s/a/b/ src/a.js"', 'npm test 2>&1 | tee test-output.txt',
        'make test > results.xml'])
        assert.strictEqual(held([['run', cmd]]).status, 0, cmd);
    assert.strictEqual(held([['run', "sed -i 's/a/b/' src/a.js"], ['run', 'npm test']]).status, 0, 'a run after the shell edit');
    assert.strictEqual(held([['run', "sed -i 's/a/b/' src/a.js", 'Bash operation blocked by hook: outside']]).status, 0, 'a denied shell write changed nothing');
});

// M3: the dispatched seat's own run is inside its own transcript; the Agent call is the run as far as
// this turn can see, and the gate fails open on it.
test('done gate: a dispatched agent after the edit counts as the run', () => {
    const root = project();
    assert.strictEqual(stop(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['agent', 'verify the cart fix']]), 'All tests passing.').status, 0);
    assert.strictEqual(stop(root, steps(root, [['prompt', 'fix it'], ['agent', 'verify the cart fix'], ['edit', 'src/money.js']]), 'All tests passing.').status, 2, 'an edit after the dispatch');
    assert.strictEqual(stop(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['agent', 'verify', 'Agent dispatch blocked by hook: no APPROVAL']]), 'All tests passing.').status, 2, 'a denied dispatch ran nothing');
});

// M1 / M2: the claim is a claim shape - a second-person subject, a when/once/until/if clause and a
// colour are not claims; the skill's own named signs are.
test('done gate: the claim shapes - what is no claim, and what the skill names as one', () => {
    const root = project();
    // judged by the gate's own message: 'let me know ...' is the prose-ask branch's to hold, not this one's
    const held = (text) => (/`alfred-habits-done-gate`/.test(stop(root, steps(root, [['prompt', `go ${text}`], ['edit', 'src/money.js']]), text).stderr) ? 2 : 0);
    for (const text of ["Let me know when you're ready.", "Once you're done reviewing, I will squash the commits.", 'The header is green now.',
        'The dev server is ready at http://localhost:4200', "You're all set to review the diff.", 'If it works for you, I will open the PR.',
        'Set the flag to 1 before the next run.'])
        assert.strictEqual(held(text), 0, text);
    for (const text of ['This fixes it.', 'Should be good to go.', 'All set.', 'Resolved.', 'Fixed the parser. The legacy exporter stays untested.',
        'The tests are green.', 'All green.', 'That should fix it.', 'Once the cache warms up the page is fast. Fixed.'])
        assert.strictEqual(held(text), 2, text);
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

// C1 (R117): only the skill's own result line - 'not run' then a dash or colon - disarms the whole
// close. 'Not tested on Windows.' is a scope caveat: it disarms its own sentence, never the claim before it.
test('done gate: only a not-run result line disarms the close, never a not-tested caveat', () => {
    const root = project();
    const held = (text) => stop(root, steps(root, [['prompt', `go ${text}`], ['edit', 'src/money.js']]), text).status;
    for (const text of ['Fixed the path bug. Not tested on Windows.', 'Fixed the path bug.\nNot tested on Windows.', 'Fixed the parser. Not run on CI yet.',
        'Done. Not verified against the staging data.', 'Fixed. Not built for release.', 'Fixed. Not yet tested on the old schema.'])
        assert.strictEqual(held(text), 2, text);
    for (const text of ['Fixed the parser. Not run - no node on this machine.', 'Fixed the parser.\nNot run: the suite needs Docker.',
        'Fixed.\n- **Not run** - no emulator here.', 'Fixed. Not yet run - the CI runner is down.', 'Fixed. Not run \u2013 no node here.'])
        assert.strictEqual(held(text), 0, text);
});

// C2 + B-M5 (R117): what a rule-following close writes after its check is no source edit - a path git
// ignores (asked once, at Stop), a scratch path this turn created and then deleted, and git's own files.
function gitProject()
{
    const root = project();
    execFileSync('git', ['init', '-q', root]);
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nbin/\nobj/\n.env\nscratch/\n*.gen.js\n');
    fs.writeFileSync(path.join(root, 'src', 'vendored.gen.js'), 'x');
    execFileSync('git', ['-C', root, 'add', '-f', '.gitignore', 'src/vendored.gen.js']);
    return root;
}
test('done gate: a gitignored write, the turn\'s own scratch deleted after its check, and git\'s own files are no source edit', () => {
    const root = gitProject();
    const held = (list, text) => stop(root, steps(root, [['prompt', `go ${JSON.stringify(list)}`], ...list]), text || 'Fixed - tests pass.');
    // a gitignored target, after the run
    for (const [list, text, why] of [
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['run', "cat > scratch/probe.js <<'EOF'\nconsole.log(1)\nEOF"]], null, 'a probe in a gitignored dir'],
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['write', 'scratch/probe.js']], null, 'the same probe through the Write tool'],
        [[['run', 'rm -rf node_modules && npm install']], 'Done - a clean reinstall.', 'a deleted dependency dir'],
        [[['run', 'rm -rf bin obj']], 'Done.', 'deleted build output'],
        [[['run', 'cp .env.example .env']], 'Ready.', 'a local env file'],
        // the turn's own scratch, not ignored, deleted after its check
        [[['edit', 'src/money.js'], ['write', 'probe.js'], ['run', 'node probe.js'], ['run', 'rm probe.js']], null, 'scratch deleted after the check'],
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['run', 'mkdir -p tmp-probe && echo 1 > tmp-probe/p.js && node tmp-probe/p.js && rm -rf tmp-probe']], null, 'a scratch dir made and removed'],
        [[['run', 'npm test'], ['write', 'probe.js'], ['run', 'rm -f probe.js']], null, 'created and deleted with nothing between'],
        // git's own files (B-M5): setup's git-hygiene write
        [[['run', "printf '.claude/\\n' >> .gitignore"]], 'Installed - the stack is ready.', '.gitignore'],
        [[['edit', 'sub/.gitignore'], ['edit', '.gitattributes']], 'Ready.', 'a nested .gitignore and .gitattributes'],
        [[['run', "echo '.claude/' >> .git/info/exclude"]], 'Ready.', '.git/info/exclude'],
    ])
        assert.strictEqual(held(list, text).status, 0, why);
    // still source edits
    for (const [list, why] of [
        [[['run', 'npm test'], ['edit', 'src/money.js']], 'a source edit after the run'],
        [[['run', 'npm test'], ['edit', 'src/vendored.gen.js']], 'a TRACKED file an ignore pattern also matches'],
        [[['run', 'npm test'], ['run', 'rm src/old.js']], 'deleting a source file this turn did not create'],
        [[['run', 'npm test'], ['edit', 'src/money.js'], ['run', 'rm src/money.js']], 'deleting a file this turn only edited'],
        [[['run', 'npm test'], ['write', 'probe.js']], 'scratch written after the run and left in place'],
    ])
        assert.strictEqual(held(list).status, 2, why);
    const r = held([['run', 'npm test'], ['edit', 'src/money.js'], ['run', 'echo 1 > scratch/p.js']]);
    assert.strictEqual(r.status, 2, 'an ignored write never hides the source edit before it');
    assert.match(r.stderr, /src[\\/]money\.js was edited/);
    // no git, no ignore rules: the same probe is an edit
    const plain = project();
    assert.strictEqual(stop(plain, steps(plain, [['prompt', 'go'], ['run', 'npm test'], ['write', 'scratch/probe.js']]), 'Fixed.').status, 2, 'outside a git repo nothing is ignored');
});

test('done gate: git check-ignore is asked at most once, and only for a claim over edits after the last run', { skip: process.platform === 'win32' && 'a POSIX shell stub for git' }, () => {
    const root = gitProject();
    const bin = fs.mkdtempSync(path.join(TMP, 'bin-'));
    const log = path.join(bin, 'calls.log');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
    const three = [['run', 'npm test'], ['edit', 'src/money.js'], ['write', 'scratch/a.js'], ['run', 'rm -rf node_modules']];
    assert.strictEqual(stop(root, steps(root, [['prompt', 'a'], ...three]), 'Changed toCents.', env).status, 0, 'no claim');
    assert.strictEqual(stop(root, steps(root, [['prompt', 'b'], ['edit', 'src/money.js'], ['run', 'npm test']]), 'Fixed.', env).status, 0, 'no edit after the run');
    assert.deepStrictEqual(calls(), [], 'nothing to ask git about');
    assert.strictEqual(stop(root, steps(root, [['prompt', 'c'], ...three]), 'Fixed.', env).status, 2);
    assert.deepStrictEqual(calls().map((c) => c.split(' ')[0]), ['check-ignore'], 'one spawn for every candidate');
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
    assert.match(out.additionalContext, /load `alfred-habits-root-cause`/);
    assert.match(out.additionalContext, /before the next fix/);
    assert.strictEqual(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test 2>&1 | tail -20', { error: 'Exit code 1' })), null, 'a second failure in the streak is silent');
    assert.strictEqual(injected(post(root, 'PostToolUse', 'Bash', 'npm test', { tool_response: { stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '' } })), null, 'a green run says nothing');
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1' })), 'the next failure after green injects again');
    const rows = ledger(root);
    assert.strictEqual(rows.length, 2, JSON.stringify(rows));
    for (const row of rows) { assert.strictEqual(row.mode, 'inject'); assert.strictEqual(row.kind, 'root-cause'); }
});

// M6: one streak per actor. The pointer says 'load the method'; a second failing spelling of the same
// suite, or another failing command inside the same red stretch, says nothing new. A green run closes
// its own command (and the scoped runs of it, when it ran unscoped); the streak ends when none is open.
test('root cause: one streak per actor - a scoped green never closes the full suite, and two spellings inject once', () => {
    const root = project();
    const red = (cmd, extra) => injected(post(root, 'PostToolUseFailure', 'Bash', cmd, { error: 'Exit code 1', ...(extra || {}) }));
    const green = (cmd) => injected(post(root, 'PostToolUse', 'Bash', cmd, { tool_response: { stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '' } }));
    assert.ok(red('npm test'));
    assert.strictEqual(red('npx vitest run'), null, 'a second spelling of the failing suite is the same streak');
    assert.strictEqual(red('dotnet build'), null, 'another red run inside the streak says nothing new');
    assert.ok(red('npm test', { agent_id: 'agent-7' }), 'a subagent keeps its own streak');
    assert.ok(injected(post(root, 'PostToolUseFailure', 'PowerShell', 'dotnet test', { error: 'Exit code 1', session_id: 'ps-1' })), 'PowerShell runs count');
    for (const cmd of ['npm test -- -t cart', 'npx vitest run', 'dotnet build']) assert.strictEqual(green(cmd), null);
    assert.strictEqual(red('npm test'), null, 'the scoped green left the full-suite streak open');
    assert.strictEqual(green('npm test -- -t cart'), null);
    assert.strictEqual(green('npm test 2>&1 | tail -3'), null, 'the unscoped green closes npm test and its scoped runs');
    assert.ok(red('npm test -- -t tax'), 'nothing open - a new streak injects');
});

test('root cause: a streak left open for an hour lapses', () => {
    const root = project();
    const state = path.join(root, '.hooklog', 'guard-stop-rootcause-sess-1-main.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ 'npm test': new Date(Date.now() - 61 * 60 * 1000).toISOString() }));
    assert.ok(injected(post(root, 'PostToolUseFailure', 'Bash', 'dotnet build', { error: 'Exit code 1' })), 'the stale open key no longer silences the pointer');
    fs.writeFileSync(state, JSON.stringify({ 'npm test': new Date(Date.now() - 59 * 60 * 1000).toISOString() }));
    assert.strictEqual(injected(post(root, 'PostToolUseFailure', 'Bash', 'go test ./...', { error: 'Exit code 1' })), null, 'one under the hour still holds');
});

test('root cause: a piped cargo or ng failure counts as red', () => {
    const root = project();
    let s = 0;
    const piped = (cmd, stdout) => injected(post(root, 'PostToolUse', 'Bash', cmd, { session_id: `m6-${++s}`, tool_response: { stdout, stderr: '' } }));
    assert.ok(piped('cargo build 2>&1 | tail -20', 'error[E0308]: mismatched types\n --> src/main.rs:4:5'));
    assert.ok(piped('cargo test 2>&1 | tail -5', 'error: could not compile `app` (lib) due to 1 previous error'));
    assert.ok(piped('ng build 2>&1 | tail -5', 'Error: Schema validation failed with the following errors:'));
    assert.strictEqual(piped('node --test 2>&1 | tail -5', 'Error: logged by a passing test\nℹ pass 3\nℹ fail 0'), null, 'an Error line outside ng is no verdict');
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
    for (const cmd of ['npm run lint', 'npm run lint-check', 'npm ci', 'npm install jest', 'echo npm test', 'echo "a; npm test --silent"', 'git commit -m "npm test"',
        'cat <<EOF\nnpm test\nEOF', 'node scripts/build-marketplace.js'])
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
