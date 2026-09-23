'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sessionArgv, run } = require('./session.js');
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

test('a start ref is checked out before the baseline is taken', async (t) =>
{
    const { cell, first } = cellFor(t);
    const out = await go(cell, { name: 'solo', env: {} }, { startRef: first });
    assert.ok(!fs.existsSync(path.join(cell.repo, 'later.txt')));
    assert.strictEqual(out.outcome, 'ok');
});

test('a cell another live worker holds is refused', async (t) =>
{
    const { cell } = cellFor(t);
    fs.mkdirSync(path.join(cell.results, '.lock'), { recursive: true });
    fs.writeFileSync(path.join(cell.results, '.lock', 'pid'), `${process.ppid}\n`);
    await assert.rejects(go(cell, { name: 'solo', env: {} }), /held by/);
});
