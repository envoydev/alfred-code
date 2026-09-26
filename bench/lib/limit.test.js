'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { limitHit, probe } = require('./limit.js');

// The shapes below are NOT verified against a real limit - none can be provoked on purpose. The
// pattern is deliberately wide, and the phase-end review of every `error` cell is the net for a shape
// it misses (the subscription plan, Task 4).
function files(t, { result, stderr = '', raw } = {})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-limit-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const lines = [JSON.stringify({ type: 'system', subtype: 'init' })];
    if (raw) lines.push(raw);
    if (result) lines.push(JSON.stringify(result));
    const stdoutFile = path.join(dir, 'stdout.jsonl');
    const stderrFile = path.join(dir, 'stderr.log');
    fs.writeFileSync(stdoutFile, `${lines.join('\n')}\n`);
    fs.writeFileSync(stderrFile, stderr);
    return { stdoutFile, stderrFile, dir };
}

for (const text of ['Claude AI usage limit reached|1790000000', 'You\'ve hit your limit · resets 3pm', '5-hour limit reached - resets 9pm', 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}'])
{
    test(`an error result reading '${text.slice(0, 40)}' is a limit`, (t) =>
    {
        const got = limitHit(files(t, { result: { type: 'result', is_error: true, result: text } }));
        assert.deepStrictEqual(got, { hit: true, text });
    });
}

test('a successful result that talks about limits is not a limit', (t) =>
{
    assert.deepStrictEqual(limitHit(files(t, { result: { type: 'result', is_error: false, result: 'Added a rate limit of 429 per window; it resets at 3am.' } })), { hit: false, text: null });
});

test('an ordinary error result is not a limit, whatever stderr says', (t) =>
{
    assert.deepStrictEqual(limitHit(files(t, { result: { type: 'result', is_error: true, result: 'Tool permission denied' }, stderr: 'warn: npm rate limit on registry' })).hit, false);
});

test('a session that died before any result, with the limit on stderr, is a limit', (t) =>
{
    const got = limitHit(files(t, { stderr: 'starting\nError: Claude AI usage limit reached|1790000000\n' }));
    assert.deepStrictEqual(got, { hit: true, text: 'Error: Claude AI usage limit reached|1790000000' });
});

test('a session that died before any result for another reason is not a limit', (t) =>
{
    assert.strictEqual(limitHit(files(t, { stderr: 'Error: spawn ENOENT\n' })).hit, false);
});

test('the LAST result decides, a line that is not JSON is skipped, and missing files are no limit', (t) =>
{
    const f = files(t, { raw: '{"type":"result","is_error":true,"result":"usage limit reached"}\nnot json', result: { type: 'result', is_error: false, result: 'ok' } });
    assert.strictEqual(limitHit(f).hit, false);
    assert.deepStrictEqual(limitHit({ stdoutFile: path.join(f.dir, 'none'), stderrFile: path.join(f.dir, 'none') }), { hit: false, text: null });
});

// The probe runs the real CLI shape against a stand-in: one line of stream-json and an exit status.
const standIn = (rec, out, code) => [process.execPath, '-e',
    `require('fs').writeFileSync(${JSON.stringify(rec)}, JSON.stringify({ argv: process.argv.slice(1), env: Object.keys(process.env), cwd: process.cwd() }));`
    + `process.stdout.write(${JSON.stringify(out === null ? '' : `${JSON.stringify(out)}\n`)}); process.exit(${code});`, '--'];
const SESSION = { model: 'claude-sonnet-5', env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, auth: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] };
const BASE = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'probe-test-key-0123456789', CLAUDE_CODE_OAUTH_TOKEN: 'probe-test-token-0123456789' };

test('the probe is ok only on a successful result, and asks one short question with the chosen credential', async (t) =>
{
    const { dir } = files(t);
    const rec = path.join(dir, 'probe.json');
    const ok = await probe({ claude: standIn(rec, { type: 'result', is_error: false, result: 'ok' }, 0), session: SESSION, base: BASE, auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    assert.deepStrictEqual(ok, { ok: true, text: null });
    const seen = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.deepStrictEqual(seen.argv, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5', '--max-turns', '1', 'Reply with the single word ok']);
    assert.ok(seen.env.includes('CLAUDE_CODE_OAUTH_TOKEN') && !seen.env.includes('ANTHROPIC_API_KEY'));
    assert.ok(!fs.existsSync(seen.cwd), 'the throwaway account dir is removed');

    const limited = await probe({ claude: standIn(rec, { type: 'result', is_error: true, result: 'Claude AI usage limit reached|1790000000' }, 1), session: SESSION, base: BASE, auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    assert.deepStrictEqual(limited, { ok: false, text: 'Claude AI usage limit reached|1790000000' });
    const broken = await probe({ claude: standIn(rec, null, 1), session: SESSION, base: BASE, auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    assert.deepStrictEqual(broken, { ok: false, text: 'the probe exited 1 with no result' });
});
