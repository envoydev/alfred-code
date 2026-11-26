// The shared block helper (guards ask instead of block, 2026-11-25): canAsk says whether a person can answer a prompt for
// a call, blockVerdict builds the ask or the deny, askOrBlock writes it, and the test helpers read it back.
'use strict';
require('./hook-test-env').isolateHookSuite();
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verdictOf, blockText, askText } = require('./hook-test-env');
const { canAsk, blockVerdict, askOrBlock, blockExitCode, unattended, ASKED_PREFIX } = require('../stack/hooks/hook-prelude.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-ask-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const REASON = 'Blocked: a recursive rm of ~ - nothing ran.\nDelete a subdirectory by name.';
const GUARD = 'guard-catastrophic-rm';
const RECOMMENDED = "Recommended: No, unless you meant this call - after a No, Claude stops until you write.";
const bash = (extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', ...extra });

let rows = 0;
function transcript(entrypoint, extra = [])
{
    const file = path.join(TMP, `t-${++rows}.jsonl`);
    const lines = [{ type: 'user', entrypoint, message: { role: 'user', content: [{ type: 'text', text: 'run it overnight, take every recommendation' }] } }, ...extra];
    fs.writeFileSync(file, lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
}

test('canAsk: a person can answer', () =>
{
    for (const p of [{}, { permission_mode: 'default' }, { permission_mode: 'acceptEdits' }, { permission_mode: 'auto' }, { permission_mode: 'plan' }])
        assert.strictEqual(canAsk(p, {}), true, JSON.stringify(p));
    // a live AUTO stamp with an idle user: unattended reads it as away, canAsk never reads the stamp
    const root = fs.mkdtempSync(path.join(TMP, 'auto-'));
    const flow = path.join(root, '.alfred', 'docs', 'flow');
    fs.mkdirSync(flow, { recursive: true });
    const payload = { transcript_path: transcript('cli') };
    // the stamp is written after the transcript began: an older one is another session's
    fs.writeFileSync(path.join(flow, 'APPROVAL'), 'AUTO - "run it overnight, take every recommendation"\n');
    const env = { CLAUDE_PROJECT_DIR: root };
    assert.strictEqual(unattended(payload, env), true, 'the stamp reads as nobody for the stop contract');
    assert.strictEqual(canAsk(payload, env), true, 'an idle user under auto-run is asked');
});

test('canAsk: nobody can answer', () =>
{
    const no = (label, p, env = {}) => assert.strictEqual(canAsk(p, env), false, label);
    no('dontAsk', { permission_mode: 'dontAsk' });
    no('bypassPermissions', { permission_mode: 'bypassPermissions' });
    no('unattended', {}, { ALFRED_CODE_UNATTENDED: '1' });
    no('print mode', {}, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
    no('print mode by transcript', { transcript_path: transcript('cli', [{ type: 'assistant', entrypoint: 'sdk-cli', message: { id: 'a', content: [] } }]) });
    no('switch 0', {}, { ALFRED_CODE_GUARD_ASK: '0' });
    no('switch 0 padded', {}, { ALFRED_CODE_GUARD_ASK: ' 0 ' });
    no('cursor_version', { cursor_version: '1.7' });
    no('cursor event name', { hook_event_name: 'preToolUse' });
    for (const mode of ['default', 'auto', 'dontAsk']) no(`SubagentHandback under ${mode}`, { tool_name: 'SubagentHandback', permission_mode: mode });
    no('null', null);
    no('array', []);
    no('string', 'x');
});

test('canAsk: the switch at each boundary', () =>
{
    for (const value of [undefined, '', '1', 'garbage', '00'])
        assert.strictEqual(canAsk({}, value === undefined ? {} : { ALFRED_CODE_GUARD_ASK: value }), true, `value ${JSON.stringify(value)}`);
    assert.strictEqual(canAsk({}, { ALFRED_CODE_GUARD_ASK: '0' }), false);
});

test('canAsk: a throw reads as nobody', () =>
{
    const payload = { get permission_mode() { throw new Error('boom'); } };
    assert.strictEqual(canAsk(payload, {}), false);
});

test('blockVerdict: ask carries the user and the model text', () =>
{
    const v = blockVerdict(bash(), REASON, { env: {}, guard: GUARD });
    assert.strictEqual(v.decision, 'ask');
    const out = v.hookSpecificOutput;
    assert.strictEqual(out.hookEventName, 'PreToolUse');
    assert.strictEqual(out.permissionDecision, 'ask');
    assert.strictEqual(out.permissionDecisionReason, `alfred-code ${GUARD}: a recursive rm of ~ - nothing ran.\n${RECOMMENDED}`);
    assert.ok(out.additionalContext.startsWith(`${ASKED_PREFIX}a recursive rm of ~ - nothing ran. If the result shows`), out.additionalContext);
    assert.ok(out.additionalContext.endsWith(REASON), 'the model gets the full reason');
    assert.ok(out.additionalContext.includes('If the user declined: '));
});

test('blockVerdict: Held once is dropped too, and a long first sentence is capped at 400', () =>
{
    const held = blockVerdict(bash(), 'Held once: read the file first. Then retry.', { env: {}, guard: 'guard-x' });
    assert.strictEqual(held.hookSpecificOutput.permissionDecisionReason.split('\n')[0], 'alfred-code guard-x: read the file first.');
    const long = `${'word '.repeat(180)}end.`;
    const v = blockVerdict(bash(), long, { env: {}, guard: 'guard-x' });
    const line = v.hookSpecificOutput.permissionDecisionReason.split('\n')[0];
    const sentence = line.slice('alfred-code guard-x: '.length);
    assert.ok(sentence.length <= 400, `${sentence.length}`);
    assert.ok(sentence.endsWith('...'));
    const kept = sentence.slice(0, -3);
    assert.ok(long.startsWith(kept), 'the kept text is a prefix of the sentence');
    assert.strictEqual(long[kept.length], ' ', 'the cut falls on a word boundary');
});

test('blockVerdict: a reason with leading blanks still loses its Blocked lead', () =>
{
    const v = blockVerdict(bash(), '  \n Blocked: lead space. Next.', { env: {}, guard: 'guard-x' });
    assert.strictEqual(v.hookSpecificOutput.permissionDecisionReason.split('\n')[0], 'alfred-code guard-x: lead space.');
});

test('blockVerdict and askOrBlock: a null options argument still answers', () =>
{
    const v = blockVerdict(bash(), REASON, null);
    assert.strictEqual(v.decision, 'ask');
    assert.ok(v.hookSpecificOutput.permissionDecisionReason.startsWith('alfred-code: a recursive rm'));
    const realWrite = process.stdout.write;
    const out = [];
    process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
    try { assert.strictEqual(askOrBlock(bash({ permission_mode: 'dontAsk' }), REASON, null), 'deny'); }
    finally { process.stdout.write = realWrite; }
    assert.strictEqual(out.length, 1, 'one write');
    assert.strictEqual(JSON.parse(out[0]).hookSpecificOutput.permissionDecisionReason, REASON);
});

test('askOrBlock: a throw inside it writes a fixed deny, never nothing', () =>
{
    const realWrite = process.stdout.write;
    const out = [];
    process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
    Object.defineProperty(global, 'BLOCK_VERDICT', { configurable: true, set() { throw new Error('hostile global'); } });
    let decision;
    try { decision = askOrBlock(bash(), REASON, { env: {}, guard: GUARD }); }
    finally { process.stdout.write = realWrite; delete global.BLOCK_VERDICT; }
    assert.strictEqual(decision, 'deny');
    assert.strictEqual(out.length, 1, 'one write');
    const output = JSON.parse(out[0]).hookSpecificOutput;
    assert.strictEqual(output.permissionDecision, 'deny');
    assert.strictEqual(output.permissionDecisionReason, REASON);
});

test('blockVerdict: deny carries today\'s reason and no context', () =>
{
    const v = blockVerdict(bash({ permission_mode: 'dontAsk' }), REASON, { env: {}, guard: GUARD });
    assert.strictEqual(v.decision, 'deny');
    assert.strictEqual(v.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(v.hookSpecificOutput.permissionDecisionReason, REASON);
    assert.ok(!('additionalContext' in v.hookSpecificOutput));
});

test('blockVerdict: a reason that throws on read still denies', () =>
{
    const reason = { toString() { throw new Error('x'); } };
    const v = blockVerdict(bash(), reason, { env: {}, guard: GUARD });
    assert.strictEqual(v.decision, 'deny');
    assert.strictEqual(v.hookSpecificOutput.permissionDecisionReason, `alfred-code ${GUARD}: a guard blocked this call.`);
});

test('askOrBlock: writes one JSON object, sets the verdict, returns it', () =>
{
    const realWrite = process.stdout.write;
    const realErr = process.stderr.write;
    const run = (payload) =>
    {
        const out = [];
        const err = [];
        process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
        process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
        try { return { decision: askOrBlock(payload, REASON, { env: {}, guard: GUARD }), out, err, verdict: global.BLOCK_VERDICT }; }
        finally { process.stdout.write = realWrite; process.stderr.write = realErr; }
    };
    const asked = run(bash());
    assert.strictEqual(asked.decision, 'ask');
    assert.strictEqual(asked.out.length, 1, 'one write');
    assert.strictEqual(JSON.parse(asked.out[0]).hookSpecificOutput.permissionDecision, 'ask');
    assert.deepStrictEqual(asked.verdict, { decision: 'ask', reason: REASON });
    assert.deepStrictEqual(asked.err, []);
    assert.strictEqual(blockExitCode(bash(), asked.decision), 0);

    const cursor = { cursor_version: '1.7', hook_event_name: 'preToolUse' };
    const denied = run(cursor);
    assert.strictEqual(denied.decision, 'deny');
    assert.strictEqual(JSON.parse(denied.out[0]).hookSpecificOutput.permissionDecisionReason, REASON);
    assert.ok(denied.err.join('').includes(REASON), 'a Cursor deny names the reason on stderr');
    assert.deepStrictEqual(denied.verdict, { decision: 'deny', reason: REASON });
    assert.strictEqual(blockExitCode(cursor, denied.decision), 2);
    assert.strictEqual(blockExitCode(bash({ permission_mode: 'dontAsk' }), 'deny'), 0, 'a Claude deny exits 0');
});

test('askOrBlock and blockVerdict: updatedInput rides an ask only, and nothing else changes without it', () =>
{
    const realWrite = process.stdout.write;
    const write = (payload, opts) =>
    {
        const out = [];
        process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
        try { askOrBlock(payload, REASON, opts); }
        finally { process.stdout.write = realWrite; }
        return out.join('');
    };
    const changed = { subagent_type: 'Explore', prompt: 'brief\n\nsentence', model: 'haiku' };
    const withInput = { env: {}, guard: GUARD, updatedInput: changed };
    const asked = JSON.parse(write(bash(), withInput)).hookSpecificOutput;
    assert.strictEqual(asked.permissionDecision, 'ask');
    assert.deepStrictEqual(asked.updatedInput, changed);
    const denied = JSON.parse(write(bash({ permission_mode: 'dontAsk' }), withInput)).hookSpecificOutput;
    assert.strictEqual(denied.permissionDecision, 'deny');
    assert.ok(!Object.hasOwn(denied, 'updatedInput'), 'a deny never carries it');
    assert.ok(!Object.hasOwn(blockVerdict(bash({ permission_mode: 'dontAsk' }), REASON, withInput).hookSpecificOutput, 'updatedInput'));
    for (const absent of [{ env: {}, guard: GUARD }, { env: {}, guard: GUARD, updatedInput: null }, { env: {}, guard: GUARD, updatedInput: 'text' }, { env: {}, guard: GUARD, updatedInput: [1] }])
    {
        const plain = write(bash(), absent);
        assert.strictEqual(plain, JSON.stringify({ hookSpecificOutput: blockVerdict(bash(), REASON, { env: {}, guard: GUARD }).hookSpecificOutput }), JSON.stringify(absent));
        assert.ok(!plain.includes('updatedInput'));
    }
});

test('verdictOf: the shapes', () =>
{
    const ask = JSON.stringify({ hookSpecificOutput: blockVerdict(bash(), REASON, { env: {}, guard: GUARD }).hookSpecificOutput });
    const deny = JSON.stringify({ hookSpecificOutput: blockVerdict(bash({ permission_mode: 'dontAsk' }), REASON, { env: {}, guard: GUARD }).hookSpecificOutput });
    assert.strictEqual(verdictOf({ status: 2, stdout: '' }), 2);
    assert.strictEqual(verdictOf({ code: 2 }), 2);
    assert.strictEqual(verdictOf({ status: 0, stdout: ask }), 'ask');
    assert.strictEqual(verdictOf({ code: 0, stdout: deny }), 'deny');
    assert.strictEqual(verdictOf({ status: 0, stdout: '' }), 0);
    assert.throws(() => verdictOf({ status: 0, stdout: '{"a":1}{"b":2}' }), /stdout is not one JSON object/);
    assert.ok(blockText({ status: 0, stdout: ask }).startsWith(ASKED_PREFIX));
    assert.strictEqual(blockText({ status: 0, stdout: deny }), REASON);
    assert.strictEqual(blockText({ status: 2, stderr: 'cursor says no' }), 'cursor says no');
    assert.strictEqual(blockText({ status: 0, stdout: '' }), '');
    assert.ok(askText({ status: 0, stdout: ask }).endsWith(RECOMMENDED));
    assert.strictEqual(askText({ status: 0, stdout: deny }), '');
});

test('a runner env with the switch at 0 is scrubbed', () =>
{
    const script = "require('./scripts/hook-test-env').isolateHookSuite();"
        + 'console.log(JSON.stringify([process.env.ALFRED_CODE_GUARD_ASK, process.env.CLAUDE_CODE_ENTRYPOINT]));';
    const r = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, ALFRED_CODE_GUARD_ASK: '0', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.split('\n')[0], '[null,null]', 'both are gone from the runner env');
    assert.strictEqual(process.env.ALFRED_CODE_GUARD_ASK, undefined);
    assert.strictEqual(process.env.CLAUDE_CODE_ENTRYPOINT, undefined);
});
