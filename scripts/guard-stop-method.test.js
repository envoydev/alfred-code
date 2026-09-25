'use strict';
// R106: two of the method skills are MEASURED by guard-stop-contract.js - where the skill was needed,
// and what the turn did about it - so the analyzer can count the misses a description leaves.
//   done gate  - Stop, LOG-ONLY since 2026-09-25 (the user's ruling: measure before holding): a close
//                claiming the session's own change done / fixed / passing / works / ready writes ONE
//                probe row per turn - `unrun` when a source edit landed after the turn's last build or
//                test run (or none ran), `ran` otherwise. A close with no edit writes nothing.
//   root cause - PostToolUseFailure / PostToolUse on Bash and PowerShell, LOG-ONLY since the same ruling:
//                a build or test command that failed writes ONE probe row per failure streak, carrying the
//                run's tool_use_id and actor; the next green run of that command resets the streak.
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

// --- done gate: Stop (log-only probe) ---------------------------------------------------------
// User ruling 2026-09-25: the hold is off until its rate is measured. The branch judges the same
// close the same way and writes ONE `mode: probe` row per turn instead - `outcome: unrun` for a
// claim over a source edit nothing ran after (the case the hold used to stop), `outcome: ran` for
// a claim over a turn whose edits a run followed (the denominator) - and never blocks.
const probes = (root) => ledger(root).filter((r) => r.mode === 'probe' && r.kind === 'done-gate');
// One Stop, and the done-gate probe row it wrote (null when it wrote none). Another branch may still
// hold the same close ('Let me know when you're ready.' is a prose ask) - the done gate never does.
const gate = (root, rows, text, extraEnv, extra) =>
{
    const before = probes(root).length;
    const r = stop(root, rows, text, extraEnv, extra);
    assert.doesNotMatch(r.stderr, /alfred-habits-done-gate|DONE_GATE/, `the done gate never holds: ${r.stderr}`);
    assert.ok(!ledger(root).some((o) => !o.mode && o.detail && o.detail.branch === 'done-gate'), 'no done-gate block row');
    const after = probes(root);
    return { ...r, row: after.length > before ? after[after.length - 1] : null };
};
const unrun = (g) => !!(g.row && g.row.detail.outcome === 'unrun');

test('done gate: a done claim over an edit made after the turn\'s last test run is logged unrun, never held', () => {
    const root = project();
    const g = gate(root, steps(root, [['prompt', 'fix the cart total'], ['run', 'npm test', true], ['edit', 'src/money.js']]),
        'Fixed - the cart total is right now.');
    assert.doesNotMatch(g.stderr, /alfred-habits-done-gate/, 'no hold text reaches the model');
    assert.ok(unrun(g), JSON.stringify(g.row));
    assert.strictEqual(g.row.hook, 'guard-stop-contract.js');
    assert.strictEqual(g.row.event, 'Stop');
    assert.match(g.row.detail.claim, /Fixed/);
    assert.match(g.row.detail.file, /src[\\/]money\.js/);
    assert.strictEqual(g.row.detail.run, 'npm test', 'the run the edit came after');
    assert.strictEqual(ledger(root).filter((r) => !r.mode).length, 0, 'no block row');
});

test('done gate: an edit and no run at all in the turn is logged unrun too', () => {
    const root = project();
    const g = gate(root, steps(root, [['prompt', 'rename the helper'], ['edit', 'src/cart.js'], ['edit', 'src/money.js']]), 'Done. Both call sites use the new name.');
    assert.ok(unrun(g));
    assert.strictEqual(g.row.detail.run, null);
});

// I1: the done gate asks 'did anything run after the edit', a wider question than the root-cause
// pointer's 'which runner failed'. A run the narrow list cannot name is still a run.
test('done gate: a run the root-cause list cannot name still counts as the run', () => {
    const root = project();
    for (const cmd of ['make test', 'uv run pytest -q', 'poetry run pytest', 'bundle exec rspec', 'pnpm --filter web test', 'npm --prefix web test',
        './scripts/test.sh', 'deno test', 'python manage.py test', 'msbuild App.sln', 'swift test', 'flutter test'])
    {
        const g = gate(root, steps(root, [['prompt', `fix it ${cmd}`], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed - 12 passed.');
        assert.strictEqual(g.row && g.row.detail.outcome, 'ran', cmd);
    }
});

test('done gate: a read, a write, git or an install after the edit is no run', () => {
    const root = project();
    for (const cmd of ['git diff', 'cat src/money.js', 'grep -n toCents src/money.js', 'ls src', 'git status && git log -1', 'sed -n 1,20p src/money.js',
        'npm install', 'cd src; ls', 'Get-Content src/money.js'])
    {
        const g = gate(root, steps(root, [['prompt', `fix it ${cmd}`], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed.');
        assert.ok(unrun(g), cmd);
        assert.strictEqual(g.row.detail.run, null, `${cmd} is no run`);
    }
    const g = gate(root, steps(root, [['prompt', 'fix again'], ['run', 'make test'], ['edit', 'src/money.js']]), 'Fixed.');
    assert.ok(unrun(g));
    assert.strictEqual(g.row.detail.run, 'make test', 'the missed run is named');
});

// I2: under a Bash-first harness the shell IS the write route, so a shell write to a source file is an
// edit - read through the same detection the cross-project guard blocks with (shell-writes.js).
test('done gate: a shell write to a source file is an edit', () => {
    const root = project();
    const probe = (list, text) => gate(root, steps(root, [['prompt', `go ${JSON.stringify(list)}`], ...list]), text || 'Fixed.');
    const g = probe([['run', "sed -i '' 's/a/b/' src/a.js"]]);
    assert.ok(unrun(g), 'sed -i then Fixed.');
    assert.match(g.row.detail.file, /src[\\/]a\.js/);
    for (const cmd of ["cat > src/new.js <<'EOF'\nexport const x = 1;\nEOF", 'echo "export {}" >> src/index.ts', "cd src && perl -pi -e 's/a/b/' money.js",
        "python3 - <<'PY'\nfrom pathlib import Path\nPath('src/tax.py').write_text('x = 1')\nPY", 'cp templates/a.js src/b.js', 'rm src/old.js',
        "npm test && sed -i 's/a/b/' src/a.js"])
        assert.ok(unrun(probe([['run', cmd]])), cmd);
    assert.match(probe([['run', "cd src && sed -i 's/a/b/' money.js"]]).row.detail.file, /src[\\/]money\.js/, 'a cd moves the anchor');
    for (const cmd of ["sed -i 's/a/b/' src/a.js && npm test", 'npm test > build.log 2>&1', 'echo done > notes.log', 'echo x > /tmp/probe.js',
        'git commit -qm wip', "sed -i 's/a/b/' README.md", 'mkdir -p src/new', 'echo "sed -i s/a/b/ src/a.js"', 'npm test 2>&1 | tee test-output.txt',
        'make test > results.xml'])
        assert.ok(!unrun(probe([['run', cmd]])), cmd);
    assert.ok(!unrun(probe([['run', "sed -i 's/a/b/' src/a.js"], ['run', 'npm test']])), 'a run after the shell edit');
    assert.strictEqual(probe([['run', "sed -i 's/a/b/' src/a.js", 'Bash operation blocked by hook: outside']]).row, null, 'a denied shell write changed nothing');
});

// M3: the dispatched seat's own run is inside its own transcript; the Agent call is the run as far as
// this turn can see.
test('done gate: a dispatched agent after the edit counts as the run', () => {
    const root = project();
    assert.ok(!unrun(gate(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['agent', 'verify the cart fix']]), 'All tests passing.')));
    assert.ok(unrun(gate(root, steps(root, [['prompt', 'fix it'], ['agent', 'verify the cart fix'], ['edit', 'src/money.js']]), 'All tests passing.')), 'an edit after the dispatch');
    assert.ok(unrun(gate(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['agent', 'verify', 'Agent dispatch blocked by hook: no APPROVAL']]), 'All tests passing.')), 'a denied dispatch ran nothing');
});

// M1 / M2: the claim is a claim shape - a second-person subject, a when/once/until/if clause and a
// colour are not claims; the skill's own named signs are.
test('done gate: the claim shapes - what is no claim, and what the skill names as one', () => {
    const root = project();
    const logged = (text) => unrun(gate(root, steps(root, [['prompt', `go ${text}`], ['edit', 'src/money.js']]), text));
    for (const text of ["Let me know when you're ready.", "Once you're done reviewing, I will squash the commits.", 'The header is green now.',
        'The dev server is ready at http://localhost:4200', "You're all set to review the diff.", 'If it works for you, I will open the PR.',
        'Set the flag to 1 before the next run.'])
        assert.strictEqual(logged(text), false, text);
    for (const text of ['This fixes it.', 'Should be good to go.', 'All set.', 'Resolved.', 'Fixed the parser. The legacy exporter stays untested.',
        'The tests are green.', 'All green.', 'That should fix it.', 'Once the cache warms up the page is fast. Fixed.'])
        assert.strictEqual(logged(text), true, text);
});

test('done gate: the same close with a run after the last edit is logged ran', () => {
    const root = project();
    for (const cmd of ['npm test', 'node --test test/cart.test.js', 'cd sub && npx vitest run', 'dotnet test -v q 2>&1 | tail -5', 'pytest -q', 'go test ./...', 'cargo test', './gradlew test', 'mvn -q verify', 'ng build'])
    {
        const g = gate(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['run', cmd]]), 'Fixed - tests 3, pass 3.');
        assert.strictEqual(g.row && g.row.detail.outcome, 'ran', cmd);
    }
    // a RED run after the edit is still the run the gate asks for - the claim is another matter
    assert.strictEqual(gate(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['run', 'npm test', true]]), 'Fixed.').row.detail.outcome, 'ran');
});

test('done gate: a close with no edit this turn writes nothing', () => {
    const root = project();
    // an edit in the PREVIOUS turn, a done claim in this one
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js'], ['text', 'Edited.'], ['prompt', 'is it done?']]);
    assert.strictEqual(gate(root, rows, 'Yes - it is done and ready.').row, null);
    assert.strictEqual(gate(root, steps(root, [['prompt', 'explain the cart']]), 'Done - the cart sums integer cents.').row, null);
});

test('done gate: what does not count as a source edit, or as a claim, writes nothing', () => {
    const root = project();
    const probe = (list, text) => gate(root, steps(root, [['prompt', `go ${text}`], ...list]), text);
    assert.strictEqual(probe([['edit', 'src/money.js', 'Error: String to replace not found']], 'Fixed.').row, null, 'a rejected edit changed nothing');
    assert.strictEqual(probe([['edit', 'README.md'], ['edit', 'docs/guide.md']], 'Done - the README is updated.').row, null, 'prose files are no build input');
    assert.strictEqual(probe([['edit', '.claude/docs/superpowers/plans/cart.md'], ['write', '.claude/docs/flow/COMMIT-GATE']], 'Ready.').row, null, 'the docs root and flow receipts');
    assert.strictEqual(probe([['edit', path.join(os.tmpdir(), 'scratch-probe.js')]], 'Done.').row, null, 'a scratch file outside the project');
    assert.strictEqual(probe([['edit', 'src/money.js']], 'The fix is in, but it is not done until the suite runs - that is next.').row, null, 'a negated claim');
    assert.strictEqual(probe([['edit', 'src/money.js']], 'Fixed toCents to strip the comma. Not run - I could not run the tests here, no node on this machine.').row, null, 'an honest could-not-run');
    assert.strictEqual(probe([['edit', 'src/money.js']], 'Changed toCents to strip the thousands comma.').row, null, 'no claim at all');
    assert.strictEqual(probe([['edit', 'src/money.js']], 'Here is how it works: the done gate reads the transcript, a fixed trigger, passing the flag through.').row, null, 'the words, not a claim');
    assert.strictEqual(probe([['edit', 'src/money.js']], 'Is it done? Not until the suite runs.').row, null, 'a question is no claim');
    assert.ok(unrun(probe([['edit', 'src/money.js']], 'The tests should pass now.')), 'the hedge the skill names as a skipped gate');
    assert.ok(unrun(probe([['edit', 'src/money.js']], 'It works now - the comma is stripped.')));
    assert.ok(unrun(probe([['edit', 'src/money.js']], 'The change is ready to commit.')));
    assert.ok(unrun(probe([['edit', 'src/money.js'], ['run', 'npm test', 'Bash operation blocked by hook: no receipt']], 'Fixed.')), 'a run a hook blocked never ran');
});

// C1 (R117): only the skill's own result line - 'not run' then a dash or colon - disarms the whole
// close. 'Not tested on Windows.' is a scope caveat: it disarms its own sentence, never the claim before it.
test('done gate: only a not-run result line disarms the close, never a not-tested caveat', () => {
    const root = project();
    const probe = (text) => gate(root, steps(root, [['prompt', `go ${text}`], ['edit', 'src/money.js']]), text);
    for (const text of ['Fixed the path bug. Not tested on Windows.', 'Fixed the path bug.\nNot tested on Windows.', 'Fixed the parser. Not run on CI yet.',
        'Done. Not verified against the staging data.', 'Fixed. Not built for release.', 'Fixed. Not yet tested on the old schema.'])
        assert.ok(unrun(probe(text)), text);
    for (const text of ['Fixed the parser. Not run - no node on this machine.', 'Fixed the parser.\nNot run: the suite needs Docker.',
        'Fixed.\n- **Not run** - no emulator here.', 'Fixed. Not yet run - the CI runner is down.', 'Fixed. Not run \u2013 no node here.'])
        assert.strictEqual(probe(text).row, null, text);
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
    const probe = (list, text) => gate(root, steps(root, [['prompt', `go ${JSON.stringify(list)}`], ...list]), text || 'Fixed - tests pass.');
    for (const [list, text, why] of [
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['run', "cat > scratch/probe.js <<'EOF'\nconsole.log(1)\nEOF"]], null, 'a probe in a gitignored dir'],
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['write', 'scratch/probe.js']], null, 'the same probe through the Write tool'],
        [[['run', 'rm -rf node_modules && npm install']], 'Done - a clean reinstall.', 'a deleted dependency dir'],
        [[['run', 'rm -rf bin obj']], 'Done.', 'deleted build output'],
        [[['run', 'cp .env.example .env']], 'Ready.', 'a local env file'],
        [[['edit', 'src/money.js'], ['write', 'probe.js'], ['run', 'node probe.js'], ['run', 'rm probe.js']], null, 'scratch deleted after the check'],
        [[['edit', 'src/money.js'], ['run', 'npm test'], ['run', 'mkdir -p tmp-probe && echo 1 > tmp-probe/p.js && node tmp-probe/p.js && rm -rf tmp-probe']], null, 'a scratch dir made and removed'],
        [[['run', 'npm test'], ['write', 'probe.js'], ['run', 'rm -f probe.js']], null, 'created and deleted with nothing between'],
        [[['run', "printf '.claude/\\n' >> .gitignore"]], 'Installed - the stack is ready.', '.gitignore'],
        [[['edit', 'sub/.gitignore'], ['edit', '.gitattributes']], 'Ready.', 'a nested .gitignore and .gitattributes'],
        [[['run', "echo '.claude/' >> .git/info/exclude"]], 'Ready.', '.git/info/exclude'],
    ])
        assert.ok(!unrun(probe(list, text)), why);
    for (const [list, why] of [
        [[['run', 'npm test'], ['edit', 'src/money.js']], 'a source edit after the run'],
        [[['run', 'npm test'], ['edit', 'src/vendored.gen.js']], 'a TRACKED file an ignore pattern also matches'],
        [[['run', 'npm test'], ['run', 'rm src/old.js']], 'deleting a source file this turn did not create'],
        [[['run', 'npm test'], ['edit', 'src/money.js'], ['run', 'rm src/money.js']], 'deleting a file this turn only edited'],
        [[['run', 'npm test'], ['write', 'probe.js']], 'scratch written after the run and left in place'],
    ])
        assert.ok(unrun(probe(list)), why);
    const g = probe([['run', 'npm test'], ['edit', 'src/money.js'], ['run', 'echo 1 > scratch/p.js']]);
    assert.ok(unrun(g), 'an ignored write never hides the source edit before it');
    assert.match(g.row.detail.file, /src[\\/]money\.js/);
    const plain = project();
    assert.ok(unrun(gate(plain, steps(plain, [['prompt', 'go'], ['run', 'npm test'], ['write', 'scratch/probe.js']]), 'Fixed.')), 'outside a git repo nothing is ignored');
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
    assert.strictEqual(gate(root, steps(root, [['prompt', 'a'], ...three]), 'Changed toCents.', env).row, null, 'no claim');
    assert.ok(!unrun(gate(root, steps(root, [['prompt', 'b'], ['edit', 'src/money.js'], ['run', 'npm test']]), 'Fixed.', env)), 'no edit after the run');
    assert.deepStrictEqual(calls(), [], 'nothing to ask git about');
    assert.ok(unrun(gate(root, steps(root, [['prompt', 'c'], ...three]), 'Fixed.', env)));
    assert.deepStrictEqual(calls().map((c) => c.split(' ')[0]), ['check-ignore'], 'one spawn for every candidate');
});

test('done gate: logged once per turn, re-armed by the next typed turn', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    assert.ok(unrun(gate(root, rows, 'Fixed.')));
    assert.strictEqual(gate(root, rows, 'Fixed.').row, null, 'the same turn is never logged twice');
    const next = rows.concat(steps(root, [['text', 'Fixed.'], ['prompt', 'now the tax line'], ['edit', 'src/tax.js']]));
    assert.ok(unrun(gate(root, next, 'Done - tax is applied per line.')), 'a new turn is judged afresh');
    assert.strictEqual(probes(root).length, 2);
});

test('done gate: a continuation another hook caused writes no row, on a turn not yet logged', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    assert.strictEqual(gate(root, rows, 'Fixed.', {}, { stop_hook_active: true }).row, null, 'the continuation itself');
    assert.ok(unrun(gate(root, rows, 'Fixed.')), 'the turn\'s own Stop still logs it');
});

// Review I9: the credential branch holds its close with exit 2, and the continuation that follows
// arrives with stop_hook_active - so a probe placed after it never ran on such a turn.
test('done gate: a close the credential branch holds is still logged', () => {
    const root = project();
    const g = gate(root, steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]), 'Fixed. Rotate the API key you pasted - it is in the transcript.');
    assert.strictEqual(g.status, 2, 'the rotate ask holds this close');
    assert.ok(unrun(g), 'and the done-gate row was written first');
});

test('done gate: ALFRED_CODE_DONE_GATE=0 switches the probe off', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['edit', 'src/money.js']]);
    assert.strictEqual(gate(root, rows, 'Fixed.', { ALFRED_CODE_DONE_GATE: '0' }).row, null);
    assert.ok(unrun(gate(root, rows, 'Fixed.', { ALFRED_CODE_DONE_GATE: '1' })));
});

// What the analyzer splits the unrun rows by: was the skill loaded this turn, does the project declare
// tests at all, and does an instruction file forbid running them (the user's two named exceptions).
test('done gate: the row records the skill load, the project\'s test markers and a rule against running tests', () => {
    const skill = (root) => { const c = call('Skill', { skill: 'alfred-code:alfred-habits-done-gate' }); return [c.row, result(c.id, 'Launching skill')]; };
    const bare = project();
    let g = gate(bare, steps(bare, [['prompt', 'fix it'], ['edit', 'src/money.js']]), 'Fixed.');
    assert.deepStrictEqual([g.row.detail.skill, g.row.detail.tests, g.row.detail.rule], [false, 'none-found', null]);

    const withSkill = project();
    g = gate(withSkill, [...steps(withSkill, [['prompt', 'fix it'], ['edit', 'src/money.js']]), ...skill(withSkill)], 'Fixed.');
    assert.strictEqual(g.row.detail.skill, true, 'the done-gate skill loaded this turn');

    for (const [setup, want, why] of [
        [(r) => fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } })), 'declared', 'a package.json test script'],
        [(r) => fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })), 'none-found', "npm init's placeholder is no test script"],
        [(r) => fs.mkdirSync(path.join(r, 'tests')), 'declared', 'a tests folder'],
        [(r) => { fs.mkdirSync(path.join(r, 'App.Tests')); fs.writeFileSync(path.join(r, 'App.Tests', 'App.Tests.csproj'), '<Project/>'); }, 'declared', 'a .NET test project'],
        [(r) => fs.writeFileSync(path.join(r, 'pytest.ini'), '[pytest]\n'), 'declared', 'a pytest config'],
        [(r) => fs.writeFileSync(path.join(r, 'go.mod'), 'module x\n'), 'declared', 'a Go module - go test is always there'],
        [(r) => fs.writeFileSync(path.join(r, 'Cargo.toml'), '[package]\n'), 'declared', 'a Cargo crate - inline tests, cargo test'],
        [(r) => fs.writeFileSync(path.join(r, 'src', 'money.test.js'), ''), 'declared', 'a spec beside the source, no test script'],
        [(r) => { fs.mkdirSync(path.join(r, 'pkg', 'cart'), { recursive: true }); fs.writeFileSync(path.join(r, 'pkg', 'cart', 'cart_test.go'), ''); }, 'declared', 'a Go test file two folders down'],
        [(r) => { fs.mkdirSync(path.join(r, 'web', 'app'), { recursive: true }); fs.writeFileSync(path.join(r, 'web', 'app', 'cart.spec.ts'), ''); }, 'declared', 'a spec file two folders down'],
    ])
    {
        const root = project();
        setup(root);
        assert.strictEqual(gate(root, steps(root, [['prompt', why], ['edit', 'src/money.js']]), 'Fixed.').row.detail.tests, want, why);
    }

    for (const [file, line] of [
        ['CLAUDE.md', '- Do not run the tests: they need the staging database.'],
        [path.join('.claude', 'rules', 'house.md'), 'Never run tests locally - CI owns them.'],
        ['AGENTS.md', 'Tests must not be run by the agent.'],
    ])
    {
        const root = project();
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), `# House\n\nKeep it short.\n${line}\n`);
        const got = gate(root, steps(root, [['prompt', file], ['edit', 'src/money.js']]), 'Fixed.').row.detail.rule;
        assert.ok(got && got.includes(line.trim()) && got.includes(path.basename(file)), `${file}: ${got}`);
    }
    for (const line of ['Run the ONE failing test while iterating; the whole suite runs once, at the gate.',
        'Never run the full test suite while iterating.', "Don't run the whole test suite on every edit.", 'Avoid running tests in watch mode.'])
    {
        const quiet = project();
        fs.writeFileSync(path.join(quiet, 'CLAUDE.md'), `# House\n\n${line}\n`);
        assert.strictEqual(gate(quiet, steps(quiet, [['prompt', 'q'], ['edit', 'src/money.js']]), 'Fixed.').row.detail.rule, null, `a rule about HOW or WHEN to run tests is no rule against running them: ${line}`);
    }
});

// --- root cause: PostToolUseFailure / PostToolUse (log-only probe) ------------------------------
// LOG-ONLY since 2026-09-25, like the done gate: a red build or test run writes ONE `mode: probe`,
// `kind: root-cause` row per failure streak and says nothing to the model. The row carries the run's
// `tool_use_id` and actor, so the analyzer can read the transcript after it: was the skill loaded
// before the next fix, after it, or never.
let tu = 0;
const post = (root, event, tool, command, extra, extraEnv) =>
    run(root, { hook_event_name: event, tool_name: tool, tool_input: { command }, tool_use_id: `toolu_${++tu}`, ...(extra || {}) }, extraEnv);
const rcProbes = (root) =>
{
    const dir = path.join(root, '.claude', 'docs', 'hook-blocks');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean))
        .filter((l) => { const o = JSON.parse(l); return o.mode === 'probe' && o.kind === 'root-cause'; });
};
// One shell event, and the root-cause probe row it wrote (null when it wrote none).
const logged = (root, event, tool, command, extra, extraEnv) =>
{
    const before = new Set(rcProbes(root));
    const r = post(root, event, tool, command, extra, extraEnv);
    assert.strictEqual(r.status, 0, `log-only, never a block: ${r.stderr}`);
    assert.strictEqual(r.stdout.trim(), '', 'log-only: nothing is injected');
    const added = rcProbes(root).filter((l) => !before.has(l));
    return added.length ? JSON.parse(added[0]) : null;
};

test('root cause: a failing test command is logged once per streak, never injected, and a green run resets it', () => {
    const root = project();
    const first = logged(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1\nnot ok 1 - cart total', tool_use_id: 'toolu_red1' });
    assert.ok(first, 'the first failure is logged');
    assert.strictEqual(first.hook, 'guard-stop-contract.js');
    assert.strictEqual(first.event, 'PostToolUseFailure');
    assert.strictEqual(first.tool, 'Bash');
    assert.deepStrictEqual(first.detail, { run: 'npm test', key: 'npm test', tool_use_id: 'toolu_red1', agent: null, agent_type: null });
    assert.strictEqual(logged(root, 'PostToolUseFailure', 'Bash', 'npm test 2>&1 | tail -20', { error: 'Exit code 1' }), null, 'a second failure in the streak is silent');
    assert.strictEqual(logged(root, 'PostToolUse', 'Bash', 'npm test', { tool_response: { stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '' } }), null, 'a green run logs nothing');
    assert.ok(logged(root, 'PostToolUseFailure', 'Bash', 'npm test', { error: 'Exit code 1' }), 'the next failure after green is logged again');
    const rows = ledger(root);
    assert.strictEqual(rows.length, 2, JSON.stringify(rows));
    for (const row of rows) { assert.strictEqual(row.mode, 'probe'); assert.strictEqual(row.kind, 'root-cause'); }
});

test('root cause: a subagent\'s red run names the actor, so a seat that preloads the skill can be told apart', () => {
    const root = project();
    const row = logged(root, 'PostToolUseFailure', 'Bash', 'dotnet test', { error: 'Exit code 1', agent_id: 'agent-7', agent_type: 'alfred-code:dotnet-test-failure-resolver' });
    assert.strictEqual(row.detail.agent, 'agent-7');
    assert.strictEqual(row.detail.agent_type, 'alfred-code:dotnet-test-failure-resolver');
});

// M6: one streak per actor. A second failing spelling of the same suite, or another failing command
// inside the same red stretch, is the same need. A green run closes its own command (and the scoped
// runs of it, when it ran unscoped); the streak ends when none is open.
test('root cause: one streak per actor - a scoped green never closes the full suite, and two spellings log once', () => {
    const root = project();
    const red = (cmd, extra) => logged(root, 'PostToolUseFailure', 'Bash', cmd, { error: 'Exit code 1', ...(extra || {}) });
    const green = (cmd) => logged(root, 'PostToolUse', 'Bash', cmd, { tool_response: { stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '' } });
    assert.ok(red('npm test'));
    assert.strictEqual(red('npx vitest run'), null, 'a second spelling of the failing suite is the same streak');
    assert.strictEqual(red('dotnet build'), null, 'another red run inside the streak is the same need');
    assert.ok(red('npm test', { agent_id: 'agent-7' }), 'a subagent keeps its own streak');
    assert.ok(logged(root, 'PostToolUseFailure', 'PowerShell', 'dotnet test', { error: 'Exit code 1', session_id: 'ps-1' }), 'PowerShell runs count');
    for (const cmd of ['npm test -- -t cart', 'npx vitest run', 'dotnet build']) assert.strictEqual(green(cmd), null);
    assert.strictEqual(red('npm test'), null, 'the scoped green left the full-suite streak open');
    assert.strictEqual(green('npm test -- -t cart'), null);
    assert.strictEqual(green('npm test 2>&1 | tail -3'), null, 'the unscoped green closes npm test and its scoped runs');
    assert.ok(red('npm test -- -t tax'), 'nothing open - a new streak is logged');
});

test('root cause: a streak left open for an hour lapses', () => {
    const root = project();
    const state = path.join(root, '.hooklog', 'guard-stop-rootcause-sess-1-main.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ 'npm test': new Date(Date.now() - 61 * 60 * 1000).toISOString() }));
    assert.ok(logged(root, 'PostToolUseFailure', 'Bash', 'dotnet build', { error: 'Exit code 1' }), 'the stale open key no longer silences the probe');
    fs.writeFileSync(state, JSON.stringify({ 'npm test': new Date(Date.now() - 59 * 60 * 1000).toISOString() }));
    assert.strictEqual(logged(root, 'PostToolUseFailure', 'Bash', 'go test ./...', { error: 'Exit code 1' }), null, 'one under the hour still holds');
});

test('root cause: a piped cargo or ng failure counts as red', () => {
    const root = project();
    let s = 0;
    const piped = (cmd, stdout) => logged(root, 'PostToolUse', 'Bash', cmd, { session_id: `m6-${++s}`, tool_response: { stdout, stderr: '' } });
    assert.ok(piped('cargo build 2>&1 | tail -20', 'error[E0308]: mismatched types\n --> src/main.rs:4:5'));
    assert.ok(piped('cargo test 2>&1 | tail -5', 'error: could not compile `app` (lib) due to 1 previous error'));
    assert.ok(piped('ng build 2>&1 | tail -5', 'Error: Schema validation failed with the following errors:'));
    assert.strictEqual(piped('node --test 2>&1 | tail -5', 'Error: logged by a passing test\nℹ pass 3\nℹ fail 0'), null, 'an Error line outside ng is no verdict');
});

test('root cause: a red run piped to a filter that exits 0 still counts as red', () => {
    const root = project();
    const piped = (stdout) => logged(root, 'PostToolUse', 'Bash', 'node --test 2>&1 | tail -5', { tool_response: { stdout, stderr: '' } });
    assert.ok(piped('ℹ tests 3\nℹ pass 2\nℹ fail 1'), 'node --test summary with a failure');
    assert.strictEqual(piped('ℹ tests 3\nℹ pass 2\nℹ fail 1'), null, 'the same streak');
    assert.strictEqual(piped('ℹ tests 3\nℹ pass 3\nℹ fail 0'), null, 'green resets');
    assert.ok(piped('Tests:       1 failed, 2 passed, 3 total'), 'a jest summary after the reset');
});

test('root cause: what is not a failing build or test run logs nothing', () => {
    const root = project();
    const none = (event, tool, cmd, extra) => assert.strictEqual(logged(root, event, tool, cmd, extra), null, `${event} ${tool} ${cmd}`);
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
    const fires = (cmd) => !!logged(root, 'PostToolUseFailure', 'Bash', cmd, { error: 'Exit code 1', session_id: `c-${++s}` });
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
