// A waited ask under auto-run (the second-pass session audit, C4 and N03): the user's answer to a waited ask came back as a
// tool result, and a run logged it as an `auto:` pick. The wait branch of the stop contract now tells the model, in the one
// JSON object the hook writes, that the answer is the user's own. Every case drives the hook's real entry by payload.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { verdictResult } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_PROJECT_DIR;

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-wait-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.chdir(TMP);

const LINE = 'This ask waits for the user. Their answer is their own: never report it as an auto-run pick.';
let counter = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(approvals, { recursive: true });
    return { root, gate: path.join(approvals, 'APPROVAL') };
}
function transcript()
{
    const file = path.join(TMP, `t-${++counter}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const base = [
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${counter}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 30000 } } },
    ];
    fs.writeFileSync(file, base.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return file;
}
const autoStamp = (p, sid) => fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
const ask = (p, sid, questions) => verdictResult(spawnSync(process.execPath, [path.join(HOOKS, 'guard-stop-contract.js')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions }, session_id: sid, cwd: p.root, transcript_path: transcript() }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) } }));
const q = (question, labels) => ({ question, header: 'H', multiSelect: false, options: labels.map((label) => ({ label, description: 'd' })) });
const out = (r) => JSON.parse(r.stdout).hookSpecificOutput;

test('a waited ask under auto-run tells the model the answer is the user\'s, not an auto-run pick (C4)', () =>
{
    const p = project();
    autoStamp(p, 'w1');
    const r = ask(p, 'w1', [q('Commit is done. Next?', ['Push to origin (Recommended)', 'Stop here'])]);
    assert.strictEqual(r.status, 0, r.stderr);
    const o = out(r);
    assert.ok(o.additionalContext.includes(LINE), `the line rides additionalContext: ${r.stdout}`);
    assert.strictEqual(o.permissionDecision, undefined, 'a wait decides nothing');
    assert.strictEqual(o.updatedInput, undefined, 'and fixes nothing here');
});

test('an auto-answered ask carries no waits-for-the-user line', () =>
{
    const p = project();
    autoStamp(p, 'w2');
    const r = ask(p, 'w2', [q('Build it?', ['Go (Recommended)', 'Stop'])]);
    assert.strictEqual(out(r).permissionDecision, 'allow');
    assert.ok(!out(r).additionalContext.includes(LINE));
});

test('a waited ask with an ask fix still carries its updatedInput and the line, in one JSON object', () =>
{
    const p = project();
    autoStamp(p, 'w3');
    const r = ask(p, 'w3', [q('Commit is done. Push the "name" branch?', ['Push to origin (Recommended)', 'Stop here'])]);
    assert.strictEqual(r.status, 0, r.stderr);
    const o = out(r);
    assert.ok(o.updatedInput && o.updatedInput.questions[0].question === 'Commit is done. Push the \'name\' branch?', `the fixed ask rides updatedInput: ${r.stdout}`);
    assert.ok(o.additionalContext.includes(LINE), 'and the line');
    assert.strictEqual(r.stdout.trim().split('\n').length, 1, 'one line');
    assert.doesNotThrow(() => JSON.parse(r.stdout), 'stdout holds one JSON object');
});
