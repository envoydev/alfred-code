'use strict';
// R106: two of the method skills are MEASURED by guard-stop-contract.js - where the skill was needed,
// and what the turn did about it - so the analyzer can count the misses a description leaves.
//   done gate  - Stop, LOG-ONLY since 2026-09-25 (the user's ruling: measure before holding): a close
//                claiming the session's own change done / fixed / passing / works / ready writes ONE
//                probe row per turn - `unrun` when a source edit landed after the turn's last build or
//                test run (or none ran), `ran` otherwise. A close with no edit writes nothing.
//   root cause - the PostToolUse / PostToolUseFailure probe, dropped in the deep hooks review 2026-10-16;
//                one test below pins that a red shell result now writes nothing.
// Both directions are pinned: a gate that also fires on the clean neighbour teaches a bypass.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // audit 2026-10-08: its hooks' tmp state stays in a dir of its own
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-stop-method-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

// A session's own settings env reaches this process; pin every switch the branches read.
for (const k of ['ALFRED_CODE_DONE_GATE', 'ALFRED_CODE_HOOKS_OFF',
    'ALFRED_CODE_DOCS_PATH', 'CLAUDE_PLUGIN_ROOT', 'ALFRED_CODE_ROTATE_ASK'])
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
    const f = path.join(root, '.alfred', 'statistics', 'hook-blocks', 'sess-1.jsonl');
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
    assert.doesNotMatch(r.stderr, /habits-done-gate|DONE_GATE/, `the done gate never holds: ${r.stderr}`);
    assert.ok(!ledger(root).some((o) => !o.mode && o.detail && o.detail.branch === 'done-gate'), 'no done-gate block row');
    const after = probes(root);
    return { ...r, row: after.length > before ? after[after.length - 1] : null };
};
const unrun = (g) => !!(g.row && g.row.detail.outcome === 'unrun');

test('done gate: a done claim over an edit made after the turn\'s last test run is logged unrun, never held', () => {
    const root = project();
    const g = gate(root, steps(root, [['prompt', 'fix the cart total'], ['run', 'npm test', true], ['edit', 'src/money.js']]),
        'Fixed - the cart total is right now.');
    assert.doesNotMatch(g.stderr, /habits-done-gate/, 'no hold text reaches the model');
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

test('done gate: a Monitor shell write and a navigation rename are source edits too (2.1.5 final review R8)', () => {
    // The probe's shell-write read stopped at Bash|PowerShell, where every shell guard reads the whole shell route
    // (Monitor runs its command under Bash's rules); and a navigation rename or safe delete - the two edit tools
    // the navigation server keeps - changed source nothing read as an edit, though the navigation-edit-tools note
    // cites this probe. The declaring file (`relative_path`) is the one credited.
    const root = project();
    const turn = (c) => [typed('go'), c.row, result(c.id, 'ok')];
    const mon = call('Monitor', { command: "sed -i '' 's/a/b/' src/a.js", description: 'edit' });
    const g1 = gate(root, turn(mon), 'Fixed.');
    assert.ok(unrun(g1), 'a Monitor shell write then Fixed.');
    assert.match(g1.row.detail.file, /src[\\/]a\.js/);
    // both routes' spellings - the copy route's bare server is composed, never literal text (lint check 54)
    for (const tool of ['plugin_alfred-navigation_alfred-navigation__rename_symbol', 'alfred-navigation__safe_delete_symbol', 'plugin_navigation_navigation__rename_symbol', 'navigation__rename_symbol', 'plugin_navigation_navigation__safe_delete_symbol'].map((t) => `mcp__${t}`)) {
        const nav = call(tool, { name_path: 'Cart/total', relative_path: 'src/cart.ts', new_name: 'sum' });
        const g = gate(root, turn(nav), 'Done - renamed.');
        assert.ok(unrun(g), `${tool} then Done`);
        assert.match(g.row.detail.file, /src[\\/]cart\.ts/, `${tool}: the declaring file`);
    }
    const lookup = call('mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', { name_path: 'Cart', relative_path: 'src/cart.ts' });
    assert.strictEqual(gate(root, turn(lookup), 'Done.').row, null, 'a lookup is no edit');
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
    assert.strictEqual(probe([['edit', '.alfred/docs/superpowers/plans/cart.md'], ['write', '.alfred/docs/flow/COMMIT-GATE']], 'Ready.').row, null, 'the docs root and flow receipts');
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
    // every hook git runs with the repository's fsmonitor off (hook-prelude.js gitSafe, audit 2026-10-20 H2)
    assert.deepStrictEqual(calls().map((c) => c.replace(/^-c core\.fsmonitor=false /, '').split(' ')[0]), ['check-ignore'], 'one spawn for every candidate');
    assert.ok(calls().every((c) => c.startsWith('-c core.fsmonitor=false ')), 'the fsmonitor is off');
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
    const skill = (root) => { const c = call('Skill', { skill: 'alfred-code:habits-done-gate' }); return [c.row, result(c.id, 'Launching skill')]; };
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
        [path.join('.claude', 'AGENTS.md'), 'Never run the tests here - CI owns them.'],
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

// --- root cause: the PostToolUse / PostToolUseFailure probe is gone -------------------------------
// Dropped in the deep hooks review 2026-10-16 (27,380 async runs for 250 rows nobody read). A stale wiring that still
// sends a red shell result passes silently and writes nothing.
test('deep review: a red shell result writes no root-cause row and says nothing', () => {
    const root = project();
    const dir = path.join(root, '.alfred', 'statistics', 'hook-blocks');
    for (const [event, extra] of [['PostToolUseFailure', { error: 'Exit code 1\nnot ok 1 - cart total' }],
        ['PostToolUse', { tool_response: { stdout: 'not ok 1 - cart total\n1 failing', stderr: '' } }]])
    {
        const r = run(root, { hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_red', ...extra });
        assert.strictEqual(r.status, 0, `${event}: ${r.stderr}`);
        assert.strictEqual(r.stdout.trim(), '', `${event}: nothing injected`);
    }
    const rows = fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean)) : [];
    assert.deepStrictEqual(rows.filter((l) => /root-cause|test-first-red/.test(l)), [], 'no probe row');
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
        { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\n1 failing' },
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

// --- rationalization: Stop (log-only probe, ECC comparison R8) ----------------------------------
// ECC's delivery gate warns on a regex over the close ('skipping tests for now', 'pre-existing bug').
// Here the phrase counts only when the SAME turn had something to dismiss: a red build or test run, a
// run that reported a skipped test, or an edit that added a skip marker. One `kind: rationalization`
// row per turn; the close is never held and nothing is injected.
const rationalizations = (root) => ledger(root).filter((r) => r.mode === 'probe' && r.kind === 'rationalization');
const ratStop = (root, rows, text, extra) =>
{
    const before = rationalizations(root).length;
    const r = stop(root, rows, text, undefined, extra);
    assert.strictEqual(r.status, 0, `the probe never holds: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /rationaliz/i, 'nothing reaches the model');
    const after = rationalizations(root);
    return after.length > before ? after[after.length - 1] : null;
};
const RED = 'Exit code 1\n  2 failing\n  auth.spec.js';

test('rationalization: a dismissal after a red run in the same turn writes one row', () => {
    const root = project();
    const row = ratStop(root, steps(root, [['prompt', 'fix the cart total'], ['run', 'npm test', RED]]),
        'The cart total is fixed. The auth suite still fails, but that failure is unrelated to my change.');
    assert.ok(row, 'a row');
    assert.strictEqual(row.hook, 'guard-stop-contract.js');
    assert.strictEqual(row.event, 'Stop');
    assert.strictEqual(row.detail.phrase, 'unrelated to my change');
    assert.strictEqual(row.detail.evidence, 'red');
    assert.deepStrictEqual(row.detail.red, ['npm test']);
    assert.strictEqual(ledger(root).filter((r) => !r.mode).length, 0, 'no block row');
});

test('rationalization: every listed phrase counts after a red run', () => {
    for (const close of [
        'This is a pre-existing issue, so I left it.',
        'The two red specs are a pre-existing failure on main.',
        'Skipping the e2e tests for now - they need a browser.',
        'I commented out the flaky spec for now.',
        'Tests are failing but I will fix them in the next pass.',
        'Not addressing the failing integration tests here.',
        'The timeout is not caused by this change.',
        'That spec is flaky, it passed on the rerun.',
        'It is good enough for now.',
        'The run hit transient connection failures from the container.',
    ])
    {
        const root = project();
        assert.ok(ratStop(root, steps(root, [['prompt', 'ship it'], ['run', 'npm test', RED]]), close), close);
    }
});

test('rationalization: a skipped test in the run, or a skip marker the turn added, is evidence too', () => {
    const root = project();
    const c = call('Bash', { command: 'node --test' });
    const rows = [typed('make the suite pass'), c.row, result(c.id, 'ℹ tests 14\nℹ pass 12\nℹ skipped 2\nℹ fail 0')];
    const row = ratStop(root, rows, 'Green. The two skipped cases are a pre-existing issue.');
    assert.strictEqual(row && row.detail.evidence, 'skipped');
    assert.deepStrictEqual(row.detail.skipped, ['node --test']);
    const root2 = project();
    const e = call('Edit', { file_path: path.join(root2, 'src', 'cart.test.js'), old_string: "it('rounds', () => {", new_string: "it.skip('rounds', () => {" });
    const row2 = ratStop(root2, [typed('make the suite pass'), e.row, result(e.id, 'ok')], 'Skipping the rounding test for now.');
    assert.strictEqual(row2 && row2.detail.evidence, 'skip-edit');
});

test('rationalization: no row without the evidence, without the phrase, or on a negated phrase', () => {
    const root = project();
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'npm test']]), 'Green. The old flake is unrelated to my change.'), null,
        'a green run leaves nothing to dismiss');
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'npm test', RED], ['prompt', 'and now?']]),
        'The failure is unrelated to my change.'), null, 'the red run was an earlier turn');
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'npm test', RED], ['edit', 'src/cart.js'], ['run', 'npm test']]),
        'Fixed the rounding bug; the suite is green now.'), null, 'a red run and an honest close');
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'npm test', RED]]),
        'This is not a pre-existing failure - my change caused it, and I fixed the cause.'), null, 'a negated phrase');
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'npm test', RED]]),
        'Renamed the `unrelated to my change` fixture.\n```\n// flaky, skip for now\n```'), null, 'code spans and fences are payload');
    assert.strictEqual(ratStop(root, steps(root, [['prompt', 'fix it'], ['run', 'git status', 'Exit code 1\nfatal']]),
        'The failure is unrelated to my change.'), null, 'a red command that is no build or test run');
});

test('rationalization: one row per turn, and none on the continuation a block caused', () => {
    const root = project();
    const rows = steps(root, [['prompt', 'fix it'], ['run', 'npm test', RED]]);
    assert.ok(ratStop(root, rows, 'The failure is unrelated to my change.'));
    assert.strictEqual(ratStop(root, rows, 'The failure is unrelated to my change.'), null, 'the same turn logs once');
    const root2 = project();
    assert.strictEqual(ratStop(root2, rows, 'The failure is unrelated to my change.', { stop_hook_active: true }), null, 'a continuation is not a new close');
});

// --- flow probes: Stop (log-only, audit 2026-10-10, T4 cross-track) -------------------------------
// 349e4825: habits-execution-strategy loaded and no `Execution:` line after it; 9a4ef375: source edited after the plan's
// `Completed:` stamp under a new prompt, with no new plan file. One row each, never held, nothing injected.
const flowProbes = (root, kind) => ledger(root).filter((r) => r.mode === 'probe' && r.kind === kind);
const flowStop = (root, tp, text) =>
{
    const r = run(root, { hook_event_name: 'Stop', stop_hook_active: false, transcript_path: tp, last_assistant_message: text });
    assert.strictEqual(r.status, 0, `a flow probe never holds: ${r.stderr}`);
    return r;
};

test('flow probes: a turn that loaded habits-execution-strategy and wrote no Execution line writes one row', () => {
    const root = project();
    const skill = call('Skill', { skill: 'alfred-code:habits-execution-strategy' });
    const base = [typed('<command-name>/task-solve</command-name>'), skill.row, result(skill.id, 'Launching skill: habits-execution-strategy')];
    const tp = transcript(root, [...base, say('The plan is gated.')]);
    flowStop(root, tp, 'Approved - building in this session.');
    assert.strictEqual(flowProbes(root, 'execution-line').length, 1, 'a row');
    flowStop(root, tp, 'Approved - building in this session.');
    assert.strictEqual(flowProbes(root, 'execution-line').length, 1, 'once per turn');
    const ok = project();
    flowStop(ok, transcript(ok, [...base, say('Execution: session - the three tasks share one file.')]), 'Approved.');
    flowStop(ok, transcript(ok, [...base]), 'Approved.\n\n**Execution:** session - one chat fits.');
    const q = call('AskUserQuestion', { questions: [{ question: 'The plan is gated. Execution: session - one chat fits. Build it?', options: [] }] });
    flowStop(ok, transcript(ok, [...base, q.row, result(q.id, 'Your questions have been answered: "x"="y"')]), 'Building.');
    flowStop(ok, transcript(ok, [typed('/task-solve'), say('The plan is gated.')]), 'Approved.');
    assert.strictEqual(flowProbes(ok, 'execution-line').length, 0, 'the line in prose, in the close, in the ask - or no load - writes nothing');
});

test('flow probes: a source edit under a new prompt after the plan\'s Completed stamp, with no new plan, writes one row', () => {
    const root = project();
    const plan = path.join(root, '.alfred', 'docs', 'plans', '2026-10-10-cart.md');
    const stamp = call('Edit', { file_path: plan, old_string: 'Approved: yes', new_string: 'Approved: yes\nCompleted: 2026-10-10' });
    const head = [typed('<command-name>/task-solve</command-name>'), stamp.row, result(stamp.id, 'ok')];
    const tp = transcript(root, [...head, ...steps(root, [['prompt', 'also fix the header colour'], ['edit', 'src/header.css']])]);
    flowStop(root, tp, 'The header colour is fixed.');
    const rows = flowProbes(root, 'post-close-edit');
    assert.strictEqual(rows.length, 1, 'a row');
    assert.strictEqual(rows[0].detail.file, 'header.css');
    assert.strictEqual(rows[0].detail.ungated, false);
    flowStop(root, tp, 'The header colour is fixed.');
    assert.strictEqual(flowProbes(root, 'post-close-edit').length, 1, 'once per stamp');
    const ok = project();
    const next = call('Write', { file_path: path.join(ok, '.alfred', 'docs', 'plans', '2026-10-11-header.md'), content: '# header' });
    flowStop(ok, transcript(ok, [...head, typed('now the header'), next.row, result(next.id, 'ok'), ...steps(ok, [['edit', 'src/header.css']])]), 'Done.');
    flowStop(ok, transcript(ok, [...head, ...steps(ok, [['edit', 'src/header.css']])]), 'Done.');
    flowStop(ok, transcript(ok, [...head, ...steps(ok, [['prompt', 'and the readme'], ['edit', 'README.md']])]), 'Done.');
    flowStop(ok, transcript(ok, [typed('fix the header'), stamp.row, result(stamp.id, 'ok'), ...steps(ok, [['prompt', 'more'], ['edit', 'src/header.css']])]), 'Done.');
    assert.strictEqual(flowProbes(ok, 'post-close-edit').length, 0, 'a new plan, the same turn as the stamp, a prose file, or no flow - nothing');
});

// Audit 2026-10-11, session 7f8803eb: 21 Edits over 5 files with habits-execution-strategy never loaded, against the
// always-on clause that makes it the first action of a multi-file task. Log-only, once per session.
test('flow probes: a session whose edits span 2+ files with no habits-execution-strategy load before them writes one row', () => {
    const root = project();
    // the measured run spread its edits over many prompts: the second file arrives two turns after the first
    const tp = transcript(root, steps(root, [['prompt', 'fix the totals'], ['edit', 'src/cart.ts'], ['edit', 'src/cart.ts'], ['prompt', 'and the rounding'], ['text', 'On it.']]));
    flowStop(root, tp, 'Done.');
    assert.strictEqual(flowProbes(root, 'no-execution-strategy').length, 0, 'one file so far');
    fs.appendFileSync(tp, steps(root, [['prompt', 'now the totals helper'], ['edit', 'src/totals.ts']]).map((r) => JSON.stringify(r)).join('\n') + '\n');
    flowStop(root, tp, 'The totals are fixed.');
    const rows = flowProbes(root, 'no-execution-strategy');
    assert.strictEqual(rows.length, 1, 'a row once the second file is edited');
    assert.deepStrictEqual(rows[0].detail, { loaded: 'never', files: ['cart.ts', 'totals.ts'] });
    fs.appendFileSync(tp, steps(root, [['prompt', 'and the header'], ['edit', 'src/a.css']]).map((r) => JSON.stringify(r)).join('\n') + '\n');
    flowStop(root, tp, 'Done.');
    assert.strictEqual(flowProbes(root, 'no-execution-strategy').length, 1, 'once per session');
    const skill = call('Skill', { skill: 'alfred-code:habits-execution-strategy' });
    const late = project();
    flowStop(late, transcript(late, [...steps(late, [['prompt', 'fix it'], ['edit', 'src/cart.ts']]), skill.row, result(skill.id, 'ok'), ...steps(late, [['edit', 'src/totals.ts']])]), 'Done.');
    assert.deepStrictEqual(flowProbes(late, 'no-execution-strategy').map((r) => r.detail.loaded), ['after-first-edit'], 'loaded after the first edit');
    const ok = project();
    flowStop(ok, transcript(ok, [typed('fix the totals'), skill.row, result(skill.id, 'Launching skill: habits-execution-strategy'), ...steps(ok, [['edit', 'src/cart.ts'], ['edit', 'src/totals.ts']])]), 'Done.');
    assert.strictEqual(flowProbes(ok, 'no-execution-strategy').length, 0, 'the skill loaded first - nothing');
    const r = run(project(), { hook_event_name: 'Stop', stop_hook_active: true, transcript_path: tp, last_assistant_message: 'Done.' });
    assert.strictEqual(r.status, 0, 'a continuation never holds on it');
});

// Audit 2026-10-20 C08: the probe fired on every conforming flow run - the plan written at step 2 counted as the first
// edit (970539b7, 8a1fb350), scratch scripts under the session scratchpad (aae9d911, 8f130789), generated docs (ce3fd60a),
// and a resumed step-4 session whose plan already carried its approved mode (fc4fec40, 55abbb18). The execution-line
// probe missed the verdict riding the mode ask (9a0314ed, 970539b7).
test('flow probes (C08): only source edits inside the project count, an approved plan read first settles the mode, and the mode ask carries the Execution line', () => {
    const skill = call('Skill', { skill: 'alfred-code:habits-execution-strategy' });
    const plan = (root) => path.join(root, '.alfred', 'docs', 'plans', '2026-10-15-pdf.md');
    const writePlan = (root) => { const w = call('Write', { file_path: plan(root), content: '# plan' }); return [w.row, result(w.id, 'ok')]; };
    const flowRun = project();
    flowStop(flowRun, transcript(flowRun, [typed('<command-name>/task-solve</command-name>'), ...writePlan(flowRun), skill.row, result(skill.id, 'ok'),
        ...steps(flowRun, [['edit', 'src/cart.ts'], ['edit', 'src/totals.ts']])]), 'Done.');
    assert.strictEqual(flowProbes(flowRun, 'no-execution-strategy').length, 0, '8a1fb350: the plan written at step 2 is no first edit');
    const scratch = project();
    const tmpFile = (n) => { const e = call('Write', { file_path: path.join(os.tmpdir(), 'claude-501', 'scratchpad', n), content: 'x' }); return [e.row, result(e.id, 'ok')]; };
    flowStop(scratch, transcript(scratch, [typed('fix it'), ...tmpFile('repro.mjs'), ...tmpFile('entry.js'), ...steps(scratch, [['edit', 'src/cart.ts']])]), 'Done.');
    assert.strictEqual(flowProbes(scratch, 'no-execution-strategy').length, 0, 'aae9d911: scratchpad scripts and one source file');
    const docs = project();
    const doc = (n) => { const e = call('Write', { file_path: path.join(docs, '.alfred', 'docs', 'architecture', n), content: 'x' }); return [e.row, result(e.id, 'ok')]; };
    flowStop(docs, transcript(docs, [typed('capture it'), ...doc('boundaries.md'), ...doc('blind-spots.md')]), 'Done.');
    assert.strictEqual(flowProbes(docs, 'no-execution-strategy').length, 0, 'ce3fd60a: generated docs');
    const resumed = project();
    const read = call('Read', { file_path: plan(resumed) });
    flowStop(resumed, transcript(resumed, [typed('/task-solve resume step 4'), read.row, result(read.id, '    16→Gated: 5 passes\n    17→Approved: build in this session - "approve"\n'),
        ...steps(resumed, [['edit', 'src/cart.ts'], ['edit', 'src/totals.ts']])]), 'Done.');
    assert.strictEqual(flowProbes(resumed, 'no-execution-strategy').length, 0, 'fc4fec40: the mode was approved before this session');
    // the case the probe exists for still logs
    const real = project();
    flowStop(real, transcript(real, [typed('fix both'), ...writePlan(real), ...steps(real, [['edit', 'src/cart.ts'], ['edit', 'src/totals.ts']])]), 'Done.');
    assert.deepStrictEqual(flowProbes(real, 'no-execution-strategy').map((r) => r.detail.files), [['cart.ts', 'totals.ts']], 'two source files, no load: one row naming them');
    // execution-line: the verdict riding the mode ask is the line
    const base = [typed('<command-name>/task-solve</command-name>'), skill.row, result(skill.id, 'Launching skill: habits-execution-strategy')];
    const modeAsk = call('AskUserQuestion', { questions: [{ question: 'The plan passed. I recommend this session: the tasks depend on each other.', options: [{ label: 'Approve - build in this session (Recommended)' }, { label: 'Approve - dispatch the agent seats' }] }] });
    const ok = project();
    flowStop(ok, transcript(ok, [...base, modeAsk.row, result(modeAsk.id, 'Your questions have been answered: "x"="y"')]), 'Building.');
    assert.strictEqual(flowProbes(ok, 'execution-line').length, 0, '9a0314ed: the mode ask carries the verdict');
    const plain = call('AskUserQuestion', { questions: [{ question: 'The plan passed. Build it?', options: [{ label: 'Approve (Recommended)' }, { label: 'Not yet' }] }] });
    const miss = project();
    flowStop(miss, transcript(miss, [...base, plain.row, result(plain.id, 'Your questions have been answered: "x"="y"')]), 'Building.');
    assert.strictEqual(flowProbes(miss, 'execution-line').length, 1, 'an ask naming no mode is still a miss');
});

test('flow probes: a Windows plan path - backslashes, as Claude Code writes file_path there - is read the same (gate, Windows leg)', () => {
    const root = project();
    const plan = 'C:\\proj\\.alfred\\docs\\plans\\2026-10-10-cart.md';
    const stamp = call('Edit', { file_path: plan, old_string: 'Approved: yes', new_string: 'Approved: yes\nCompleted: 2026-10-10' });
    const head = [typed('<command-name>/task-solve</command-name>'), stamp.row, result(stamp.id, 'ok')];
    const edit = call('Edit', { file_path: 'C:\\proj\\src\\header.css', old_string: 'a', new_string: 'b' });
    const tp = transcript(root, [...head, typed('also fix the header colour'), edit.row, result(edit.id, 'ok')]);
    flowStop(root, tp, 'The header colour is fixed.');
    const rows = flowProbes(root, 'post-close-edit');
    assert.strictEqual(rows.length, 1, 'the backslash plan stamp is read');
    assert.strictEqual(rows[0].detail.file, 'header.css', 'the basename on either separator');
    const ok = project();
    const next = call('Write', { file_path: 'C:\\proj\\.alfred\\docs\\plans\\2026-10-11-header.md', content: '# header' });
    flowStop(ok, transcript(ok, [...head, typed('also fix the header colour'), next.row, result(next.id, 'ok'), edit.row, result(edit.id, 'ok')]), 'Planned and fixed.');
    assert.strictEqual(flowProbes(ok, 'post-close-edit').length, 0, 'a new backslash plan file covers the edit');
});
