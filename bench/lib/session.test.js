'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sessionArgv, run, prepare, onboardSync } = require('./session.js');
const { cellPaths } = require('./cells.js');

const FAKE = [process.execPath, path.join(__dirname, '..', 'test', 'fake-claude.js')];
const AUTH_VALUE = 'bench-test-auth-value-0123456789';
const SESSION = {
    model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settingsFile: '/arms/harness.settings.json',
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, graceSec: 0.3, auth: ['ANTHROPIC_API_KEY'], scrub: ['CONTEXT7_API_KEY'],
};
const BASE = { PATH: process.env.PATH, ANTHROPIC_API_KEY: AUTH_VALUE, CONTEXT7_API_KEY: 'host-only-key-value', CLAUDE_PROJECT_DIR: '/host/project' };

function cellFor(t, rep = 1)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-session-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cell = cellPaths({ benchDir: dir, run: 'r1', arm: 'solo', task: 't1', rep });
    for (const d of [cell.config, cell.home, cell.repo]) fs.mkdirSync(d, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', cell.repo, ...a], { stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    fs.writeFileSync(path.join(cell.repo, 'app.txt'), 'one\n');
    git('add', '.');
    git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'one');
    const first = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(cell.repo, 'later.txt'), 'two\n');
    git('add', '.');
    git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'two');
    fs.writeFileSync(path.join(cell.repo, 'setup-made.txt'), 'from the arm setup\n');
    return { dir, cell, first };
}

const go = (cell, arm, extra = {}) => run({ cell, prompt: 'Add the thing.', session: SESSION, arm, timeLimitMin: 1, claude: FAKE, base: BASE, ...extra });

test('the argv is exactly the shared session, and nothing an arm chose', () =>
{
    assert.deepStrictEqual(sessionArgv({ prompt: 'Add the thing.', session: SESSION, sessionId: 'abc' }), [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--model', 'claude-sonnet-5', '--effort', 'medium', '--permission-mode', 'acceptEdits',
        '--settings', '/arms/harness.settings.json', '--session-id', 'abc', 'Add the thing.',
    ]);
});

test('the session gets the cell\'s own account and home, the shared env, the arm env, auth by name, and nothing else of the host', async (t) =>
{
    const { dir, cell } = cellFor(t);
    const record = path.join(dir, 'record.json');
    const out = await go(cell, { name: 'solo', env: { FAKE_RECORD: record } });
    const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.deepStrictEqual(seen.argv, sessionArgv({ prompt: 'Add the thing.', session: SESSION, sessionId: out.sessionId }));
    assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync(cell.repo));
    assert.deepStrictEqual(Object.keys(seen.env).filter((k) => !['PATH', '__CF_USER_TEXT_ENCODING'].includes(k)).sort(),
        ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', 'CLAUDE_CONFIG_DIR', 'FAKE_RECORD', 'HOME']);
    assert.strictEqual(seen.env.CLAUDE_CONFIG_DIR, cell.config);
    assert.strictEqual(seen.env.HOME, cell.home);
});

test('a finished session leaves its transcript, subagents, stdout and the diff of what it changed', async (t) =>
{
    const { cell } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: { FAKE_EDIT: 'made.txt', FAKE_SUBAGENT: '1' } });
    assert.strictEqual(out.outcome, 'ok');
    const rec = JSON.parse(fs.readFileSync(cell.session, 'utf8'));
    assert.strictEqual(rec.outcome, 'ok');
    assert.strictEqual(rec.transcript, true);
    assert.strictEqual(rec.subagents, 1);
    assert.match(fs.readFileSync(cell.transcript, 'utf8'), /msg_fake_1/);
    assert.ok(fs.existsSync(path.join(cell.subagents, 'agent-a1.jsonl')));
    assert.match(fs.readFileSync(cell.stdout, 'utf8'), /"type":"result"/);
    const diff = fs.readFileSync(cell.diff, 'utf8');
    assert.match(diff, /made\.txt/);
    assert.doesNotMatch(diff, /setup-made\.txt/, 'what setup left before the session is the baseline, not the diff');
    assert.ok(!fs.existsSync(path.join(cell.results, '.lock')), 'the cell lock is released');
});

test('a session past its time limit is stopped and recorded as timeout, not an error', async (t) =>
{
    const { cell } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: { FAKE_SLEEP_MS: '20000' } }, { timeLimitMin: 0.005 });
    assert.strictEqual(out.outcome, 'timeout');
    assert.ok(out.wallMs < 5000);
    assert.strictEqual(JSON.parse(fs.readFileSync(cell.session, 'utf8')).outcome, 'timeout');
    assert.strictEqual(JSON.parse(fs.readFileSync(cell.session, 'utf8')).transcript, true, 'what it did before the stop is kept');
});

test('a timeout stays a timeout even when stderr reads like a limit', async (t) =>
{
    const { cell } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: { FAKE_SLEEP_MS: '20000', FAKE_STDERR: 'npm warn: registry rate limit, retrying' } }, { timeLimitMin: 0.005 });
    assert.strictEqual(out.outcome, 'timeout');
    assert.strictEqual(JSON.parse(fs.readFileSync(cell.session, 'utf8')).outcome, 'timeout');
});

test('a session that ignores TERM is killed after the grace period', async (t) =>
{
    const { cell } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: { FAKE_SLEEP_MS: '20000', FAKE_IGNORE_TERM: '1' } }, { timeLimitMin: 0.005 });
    assert.strictEqual(out.outcome, 'timeout');
    assert.strictEqual(out.signal, 'SIGKILL');
    assert.ok(out.wallMs < 5000);
});

test('a failing session is recorded with its status, never thrown', async (t) =>
{
    const { cell } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: { FAKE_EXIT: '2' } });
    assert.deepStrictEqual([out.outcome, out.exitCode], ['error', 2]);
});

test('the auth value never appears in any file the harness writes, even when the session printed it', async (t) =>
{
    const { cell } = cellFor(t);
    await go(cell, { name: 'solo', env: { FAKE_LEAK: '1', FAKE_EDIT: 'made.txt', FAKE_SUBAGENT: '1' } });
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(cell.results);
    assert.ok(files.length >= 5);
    for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(AUTH_VALUE), `${path.relative(cell.results, f)} carries the auth value`);
    assert.match(fs.readFileSync(cell.transcript, 'utf8'), /<redacted:ANTHROPIC_API_KEY>/);
});

test('a subscription token is redacted from every file too, and only the chosen credential reaches the session', async (t) =>
{
    const { dir, cell } = cellFor(t);
    const TOKEN = 'bench-test-oauth-token-0123456789';
    const record = path.join(dir, 'record.json');
    const session = { ...SESSION, auth: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] };
    await run({ cell, prompt: 'Add the thing.', session, arm: { name: 'solo', env: { FAKE_LEAK: 'CLAUDE_CODE_OAUTH_TOKEN', FAKE_EDIT: 'made.txt', FAKE_RECORD: record } }, timeLimitMin: 1, claude: FAKE, base: { ...BASE, CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    const seen = JSON.parse(fs.readFileSync(record, 'utf8')).env;
    assert.ok(seen.CLAUDE_CODE_OAUTH_TOKEN && !('ANTHROPIC_API_KEY' in seen));
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(cell.results);
    for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(TOKEN), `${path.relative(cell.results, f)} carries the token`);
    assert.match(fs.readFileSync(cell.transcript, 'utf8'), /<redacted:CLAUDE_CODE_OAUTH_TOKEN>/);
});

test('a session with two credentials set and none chosen is refused before it starts', async (t) =>
{
    const { cell } = cellFor(t);
    const session = { ...SESSION, auth: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] };
    await assert.rejects(run({ cell, prompt: 'x', session, arm: { name: 'solo', env: {} }, timeLimitMin: 1, claude: FAKE, base: { ...BASE, CLAUDE_CODE_OAUTH_TOKEN: 'bench-test-oauth-token-0123456789' } }), /more than one auth variable is set/);
    assert.ok(!fs.existsSync(cell.session));
});

test('a session stopped by a usage limit is set aside: no session.json, its files kept under limited/, the cell todo again', async (t) =>
{
    const { dir, cell } = cellFor(t);
    const limitFile = path.join(dir, 'limit.json');
    fs.writeFileSync(limitFile, JSON.stringify({ from: 1 }));
    const out = await go(cell, { name: 'solo', env: { FAKE_LIMIT_FILE: limitFile, FAKE_LEAK: '1' } });
    assert.strictEqual(out.outcome, 'limited');
    assert.match(out.limitText, /usage limit reached/);
    assert.ok(!fs.existsSync(cell.session), 'a limited cell is never finished');
    assert.strictEqual(require('./cells.js').state(cell), 'todo');
    assert.strictEqual(path.dirname(out.setAside), path.join(dir, 'results', 'r1', 'limited'));
    assert.match(path.basename(out.setAside), /^solo-t1-r1-\d{8}T\d{6}/);
    const kept = JSON.parse(fs.readFileSync(path.join(out.setAside, 'session.limited.json'), 'utf8'));
    assert.deepStrictEqual([kept.outcome, kept.arm, kept.task, kept.rep, kept.limitText], ['limited', 'solo', 't1', 1, out.limitText]);
    assert.ok(fs.existsSync(path.join(out.setAside, 'stdout.jsonl')) && fs.existsSync(path.join(out.setAside, 'transcript.jsonl')));
    assert.ok(!fs.readFileSync(path.join(out.setAside, 'transcript.jsonl'), 'utf8').includes(AUTH_VALUE), 'what is set aside is redacted first');
});

test('an onboarding stopped by a usage limit says so, never a bare exit status', (t) =>
{
    const { dir, cell } = cellFor(t);
    const limitFile = path.join(dir, 'limit.json');
    fs.writeFileSync(limitFile, JSON.stringify({ from: 1 }));
    const where = { cwd: cell.repo, config: cell.config, home: cell.home, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cell.config, HOME: cell.home, FAKE_LIMIT_FILE: limitFile }, index: 1, dir };
    assert.throws(() => onboardSync({ prompt: '/init', where, session: SESSION, claude: FAKE, base: BASE }),
        /usage limit during onboarding \(Claude AI usage limit reached\|1790000000\) - resume the run after it resets/);
});

test('a start ref is checked out before the baseline is taken', async (t) =>
{
    const { cell, first } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: {} }, { startRef: first });
    assert.ok(!fs.existsSync(path.join(cell.repo, 'later.txt')));
    assert.strictEqual(out.outcome, 'ok');
});

// A task start state beyond a ref: patches from the task dir, left uncommitted or committed on a new
// branch with a fixed author and date, so the session and the grader rebuild the same tree.
function taskDirWith(t, patches)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-task-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, body] of Object.entries(patches)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
}
const ADD_WIP = 'diff --git a/wip.txt b/wip.txt\nnew file mode 100644\n--- /dev/null\n+++ b/wip.txt\n@@ -0,0 +1 @@\n+unsaved work\n';
const EDIT_APP = 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-one\n+decided\n';
const status = (cell) => execFileSync('git', ['-C', cell.repo, 'status', '--porcelain'], { stdio: 'pipe' }).toString();
const headOf = (cell, ref = 'HEAD') => execFileSync('git', ['-C', cell.repo, 'rev-parse', ref], { stdio: 'pipe' }).toString().trim();

test('an uncommitted setup patch leaves the clone dirty with exactly that change', (t) =>
{
    const { cell, first } = cellFor(t);
    const taskDir = taskDirWith(t, { 'wip.patch': ADD_WIP });
    prepare({ cell, startRef: first, setup: [{ patch: 'wip.patch' }], taskDir, task: 't1' });
    assert.strictEqual(fs.readFileSync(path.join(cell.repo, 'wip.txt'), 'utf8'), 'unsaved work\n');
    assert.match(status(cell), /^\?\? wip\.txt$/m);
    assert.strictEqual(headOf(cell), first);
});

test('a commitOn setup step commits on a new branch, and the commit is the same on every rebuild', (t) =>
{
    const one = cellFor(t);
    const two = cellFor(t);
    const taskDir = taskDirWith(t, { 'decide.patch': EDIT_APP });
    const setup = [{ patch: 'decide.patch', commitOn: 'feature/decided', message: 'Decide the thing' }];
    prepare({ cell: one.cell, startRef: one.first, setup, taskDir, task: 't1' });
    prepare({ cell: two.cell, startRef: two.first, setup, taskDir, task: 't1' });
    assert.strictEqual(status(one.cell), '');
    assert.strictEqual(execFileSync('git', ['-C', one.cell.repo, 'branch', '--show-current'], { stdio: 'pipe' }).toString().trim(), 'feature/decided');
    assert.strictEqual(fs.readFileSync(path.join(one.cell.repo, 'app.txt'), 'utf8'), 'decided\n');
    // The two parents differ in their own commit time, so compare everything the setup step decides.
    const shape = (cell) => execFileSync('git', ['-C', cell.repo, 'show', '-s', '--format=%an|%ae|%aI|%cI|%s|%T'], { stdio: 'pipe' }).toString().trim();
    assert.strictEqual(shape(one.cell), shape(two.cell));
    assert.match(shape(one.cell), /^Lending Desk\|dev@lendingdesk\.invalid\|2026-09-01T09:00:00Z\|2026-09-01T09:00:00Z\|Decide the thing\|/);
});

test('a planted credential is made at setup: credential-shaped, the same on every rebuild, never in the task dir', (t) =>
{
    const { SECRET_SHAPE } = require('../../scripts/credential-shapes.js');
    const one = cellFor(t);
    const two = cellFor(t);
    const PLANT = 'diff --git a/settings.json b/settings.json\nnew file mode 100644\n--- /dev/null\n+++ b/settings.json\n@@ -0,0 +1 @@\n+{ "ServiceToken": "@BENCH_PLANTED_JWT@" }\n';
    const taskDir = taskDirWith(t, { 'plant.patch': PLANT });
    const setup = [{ patch: 'plant.patch', commitOn: 'work/planted', message: 'Plant it' }];
    prepare({ cell: one.cell, startRef: one.first, setup, taskDir, task: 'guard-x' });
    prepare({ cell: two.cell, startRef: two.first, setup, taskDir, task: 'guard-x' });
    const plantDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('bench-plant-')).sort();
    const before = plantDirs();
    const three = cellFor(t);
    prepare({ cell: three.cell, startRef: three.first, setup: [{ patch: 'plant.patch' }], taskDir, task: 'guard-x' });
    assert.deepStrictEqual(plantDirs(), before, 'the temp copy holding the planted value outlived the setup');
    const planted = (cell) => fs.readFileSync(path.join(cell.repo, 'settings.json'), 'utf8');
    // assert.ok, never match / equal: a failure message would print the value.
    assert.ok(!planted(one.cell).includes('@BENCH_PLANTED_JWT@'), 'the placeholder is replaced');
    assert.ok(SECRET_SHAPE.test(planted(one.cell)), 'the planted value is one the credential count sees');
    assert.ok(planted(one.cell) === planted(two.cell), 'the session and the grader plant the same value');
    assert.strictEqual(fs.readFileSync(path.join(taskDir, 'plant.patch'), 'utf8'), PLANT);
    assert.deepStrictEqual(fs.readdirSync(taskDir), ['plant.patch']);
});

test('a setup patch that does not apply names the task and the patch', (t) =>
{
    const { cell, first } = cellFor(t);
    const taskDir = taskDirWith(t, { 'bad.patch': EDIT_APP.replace('-one', '-never') });
    assert.throws(() => prepare({ cell, startRef: first, setup: [{ patch: 'bad.patch' }], taskDir, task: 't9' }), /task t9: setup patch bad\.patch does not apply/);
});

test('a session runs its setup after the start ref and records it', async (t) =>
{
    const { cell, first } = cellFor(t);
    const taskDir = taskDirWith(t, { 'wip.patch': ADD_WIP });
    const out = await go(cell, { name: 'solo', env: { FAKE_EDIT: 'made.txt' } }, { startRef: first, setup: [{ patch: 'wip.patch' }], taskDir });
    assert.strictEqual(out.outcome, 'ok');
    assert.deepStrictEqual(out.setup, [{ patch: 'wip.patch' }]);
    const diff = fs.readFileSync(cell.diff, 'utf8');
    assert.match(diff, /made\.txt/);
    assert.doesNotMatch(diff, /wip\.txt/, 'the setup is part of the baseline, never of the arm\'s diff');
});

test('a cell with a CLAUDE.md or a .claude/ above it is refused before its session starts', async (t) =>
{
    for (const name of ['CLAUDE.md', '.claude'])
    {
        const { dir, cell } = cellFor(t);
        if (name === '.claude') fs.mkdirSync(path.join(dir, name));
        else fs.writeFileSync(path.join(dir, name), '# host rules\n');
        const record = path.join(os.tmpdir(), `bench-never-${process.pid}-${name}.json`);
        await assert.rejects(go(cell, { name: 'solo', env: { FAKE_RECORD: record } }), /the cell sits under .* every session there would load it/);
        assert.ok(!fs.existsSync(record), 'the CLI never started');
        assert.ok(!fs.existsSync(cell.session));
    }
});

test('a cell another live worker holds is refused', async (t) =>
{
    const { cell } = cellFor(t);
    fs.mkdirSync(path.join(cell.results, '.lock'), { recursive: true });
    fs.writeFileSync(path.join(cell.results, '.lock', 'pid'), `${process.ppid}\n`);
    await assert.rejects(go(cell, { name: 'solo', env: {} }), /held by/);
});
