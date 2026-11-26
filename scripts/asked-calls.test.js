// The relay of a guard's reason after the user's No (live, 2026-11-27, Claude Code 2.1.332: a No at a hook's `ask` ends the
// turn, and the tool result carries only Claude Code's rejection text - the hook's additionalContext is dropped, so the model
// could not say why the call was refused). Every ask blockVerdict builds is recorded; the next UserPromptSubmit hands the
// model the reason of each call the user declined.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const asked = require(path.join(HOOKS, 'asked-calls.js'));
const prelude = require(path.join(HOOKS, 'hook-prelude.js'));
const DECLINED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const REASON = 'rewriting or deleting a shared branch (main/master/develop) is forbidden - run it yourself if you meant it.';

function scratch()
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asked-'));
    const env = { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: dir };
    const transcript = path.join(dir, 't.jsonl');
    const result = (id, text, isError) => fs.appendFileSync(transcript, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } })}\n`);
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { content: 'go' } })}\n`);
    return { dir, env, transcript, result, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const payload = (s, id) => ({ session_id: 's1', tool_use_id: id, transcript_path: s.transcript, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: 'Bash' });

test('an ask records the call, and a declined call hands back its guard and reason once', () =>
{
    const s = scratch();
    try
    {
        asked.recordAsked(payload(s, 'toolu_1'), 'guard-protected-force-push', REASON, s.env);
        s.result('toolu_1', DECLINED, true);
        const first = asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env);
        assert.deepStrictEqual(first, [{ id: 'toolu_1', guard: 'guard-protected-force-push', reason: REASON }]);
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env), [], 'said once');
    }
    finally { s.rm(); }
});

test('a call that ran, or one denied by a hook, hands back nothing and is dropped', () =>
{
    const s = scratch();
    try
    {
        asked.recordAsked(payload(s, 'toolu_ran'), 'guard-catastrophic-rm', REASON, s.env);
        asked.recordAsked(payload(s, 'toolu_hook'), 'guard-catastrophic-rm', REASON, s.env);
        s.result('toolu_ran', 'Updated 1 path from the index', false);
        s.result('toolu_hook', 'PreToolUse:Bash hook error: Blocked', true);
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env), []);
        assert.strictEqual(fs.existsSync(asked.askedFile('s1', s.env)), false, 'nothing left pending');
    }
    finally { s.rm(); }
});

test('a call with no result yet stays pending until its bound, then is dropped', () =>
{
    const s = scratch();
    try
    {
        const now = Date.now();
        asked.recordAsked(payload(s, 'toolu_wait'), 'guard-catastrophic-rm', REASON, s.env, { now });
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env, { now: now + 1000 }), []);
        assert.ok(fs.existsSync(asked.askedFile('s1', s.env)), 'kept while it may still be answered');
        s.result('toolu_wait', DECLINED, true);
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env, { now: now + asked.ASKED_KEEP_MS + 1 }), [], 'past the bound');
        assert.strictEqual(fs.existsSync(asked.askedFile('s1', s.env)), false);
    }
    finally { s.rm(); }
});

test('no session or no call id records nothing, and a missing or garbage file reads as none', () =>
{
    const s = scratch();
    try
    {
        asked.recordAsked({ tool_use_id: 'toolu_x' }, 'g', REASON, s.env);
        asked.recordAsked({ session_id: 's1' }, 'g', REASON, s.env);
        assert.strictEqual(fs.existsSync(asked.askedFile('s1', s.env)), false);
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env), []);
        fs.writeFileSync(asked.askedFile('s1', s.env), 'not json\n{"id":5}\n');
        assert.deepStrictEqual(asked.refusedCalls({ session_id: 's1', transcript_path: s.transcript }, s.env), []);
    }
    finally { s.rm(); }
});

test('two guards asking on one call are one refused call, two calls are two', () =>
{
    const one = asked.refusalNote([{ id: 'toolu_1', guard: 'guard-protected-force-push', reason: REASON }, { id: 'toolu_1', guard: 'guard-ungated-commit', reason: 'no publish receipt' }]);
    assert.match(one, /about your call, so it did not run/);
    assert.match(one, /guard-ungated-commit: no publish receipt/);
    const two = asked.refusalNote([{ id: 'toolu_1', guard: 'g1', reason: 'a' }, { id: 'toolu_2', guard: 'g2', reason: 'b' }]);
    assert.match(two, /about 2 of your calls, so they did not run/);
});

test('the note names the guard and its reason for the model', () =>
{
    const note = asked.refusalNote([{ id: 'toolu_1', guard: 'guard-protected-force-push', reason: REASON }]);
    assert.match(note, /pressed No/);
    assert.match(note, /alfred-code guard-protected-force-push/);
    assert.ok(note.includes(REASON));
    assert.strictEqual(asked.refusalNote([]), '');
});

test('askOrBlock records an ask, and a deny records nothing', () =>
{
    const s = scratch();
    try
    {
        const out = (fn) => { const write = process.stdout.write; process.stdout.write = () => true; try { return fn(); } finally { process.stdout.write = write; } };
        out(() => prelude.askOrBlock(payload(s, 'toolu_ask'), REASON, { env: s.env, guard: 'guard-protected-force-push' }));
        out(() => prelude.askOrBlock({ ...payload(s, 'toolu_deny'), permission_mode: 'dontAsk' }, REASON, { env: s.env, guard: 'guard-protected-force-push' }));
        const rows = fs.readFileSync(asked.askedFile('s1', s.env), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepStrictEqual(rows.map((r) => r.id), ['toolu_ask']);
    }
    finally { s.rm(); }
});

test('the next typed prompt gives the model the reason of the call the user declined', () =>
{
    const s = scratch();
    try
    {
        asked.recordAsked(payload(s, 'toolu_1'), 'guard-protected-force-push', REASON, s.env);
        s.result('toolu_1', DECLINED, true);
        const project = fs.mkdtempSync(path.join(s.dir, 'proj-'));
        const r = spawnSync(process.execPath, [path.join(HOOKS, 'communication-reminder.js')], {
            encoding: 'utf8', cwd: project,
            env: { ...s.env, CLAUDE_PROJECT_DIR: project },
            input: JSON.stringify({ session_id: 's1', transcript_path: s.transcript, cwd: project, hook_event_name: 'UserPromptSubmit', prompt: 'why?' }),
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
        assert.ok(context.includes(REASON), context.slice(-400));
    }
    finally { s.rm(); }
});

test('an ask built by blockVerdict alone is recorded too, and a deny it builds is not', () =>
{
    const s = scratch();
    try
    {
        prelude.blockVerdict(payload(s, 'toolu_bv'), REASON, { env: s.env, guard: 'shell-guards' });
        prelude.blockVerdict({ ...payload(s, 'toolu_bv_deny'), permission_mode: 'dontAsk' }, REASON, { env: s.env, guard: 'shell-guards' });
        const rows = fs.readFileSync(asked.askedFile('s1', s.env), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepStrictEqual(rows.map((r) => [r.id, r.guard]), [['toolu_bv', 'shell-guards']]);
    }
    finally { s.rm(); }
});

test('the secret guard\'s credential Read ask is recorded for the relay', () =>
{
    const s = scratch();
    try
    {
        const project = fs.mkdtempSync(path.join(s.dir, 'proj-'));
        fs.writeFileSync(path.join(project, '.env'), 'API_TOKEN=sk-live-0123456789abcdef\n');
        const r = spawnSync(process.execPath, [path.join(HOOKS, 'guard-secret-value.js')], {
            encoding: 'utf8', cwd: project,
            env: { ...s.env, CLAUDE_PROJECT_DIR: project, CLAUDE_CODE_ENTRYPOINT: '' },
            input: JSON.stringify({ ...payload(s, 'toolu_env'), cwd: project, tool_name: 'Read', tool_input: { file_path: path.join(project, '.env') } }),
        });
        assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask', r.stdout + r.stderr);
        const rows = fs.readFileSync(asked.askedFile('s1', s.env), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepStrictEqual(rows.map((row) => [row.id, row.guard]), [['toolu_env', 'guard-secret-value']]);
    }
    finally { s.rm(); }
});

test('a record sweeps the prefix\'s stale files in its folder', () =>
{
    const s = scratch();
    try
    {
        const old = path.join(s.dir, `${asked.ASKED_FILE_PREFIX}gone.jsonl`);
        fs.writeFileSync(old, '{}\n');
        const weekAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
        fs.utimesSync(old, weekAgo, weekAgo);
        asked.recordAsked(payload(s, 'toolu_sw'), 'g', REASON, s.env);
        assert.strictEqual(fs.existsSync(old), false, 'a week-old record file is swept');
        assert.ok(fs.existsSync(asked.askedFile('s1', s.env)));
    }
    finally { s.rm(); }
});

test('a reason recorded twice for one call is said once', () =>
{
    const row = { id: 'toolu_1', guard: 'guard-secret-value', reason: 'Blocked: a credential file.' };
    const note = asked.refusalNote([row, { ...row }, { id: 'toolu_1', guard: 'shell-guards', reason: 'Blocked: a credential file.' }]);
    assert.strictEqual(note.split('Blocked: a credential file.').length - 1, 1, 'one line per call and reason, whichever guard recorded it');
});

test('the note stays inside its cap however many calls were refused, and says how many it left out', () =>
{
    const rows = Array.from({ length: 12 }, (_, at) => ({ id: `toolu_${at}`, guard: `g${at}`, reason: 'x'.repeat(3000) }));
    const note = asked.refusalNote(rows);
    assert.ok(note.length <= asked.REFUSAL_NOTE_MAX_CHARS, `${note.length} chars`);
    assert.match(note, /about 12 of your calls/);
    assert.match(note, /more not shown/);
});
