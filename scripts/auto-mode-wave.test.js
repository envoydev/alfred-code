// The final fix wave of the session audit (2026-11-27): the auto-answer reads a held outward act in a pick's description as
// held (B14), a typed stop ends with the next run start (A2d), and a classifier denial holds only the next ask. Every case
// drives the stop contract's real entry by payload, as auto-mode.test.js does.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-wave-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.chdir(TMP);

let counter = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(approvals, { recursive: true });
    return { root, gate: path.join(approvals, 'APPROVAL') };
}
const typedAt = (text, msFromNow = 2000) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date(Date.now() + msFromNow).toISOString(), message: { role: 'user', content: text } });
function transcript(rows = [])
{
    const file = path.join(TMP, `t-${++counter}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const base = [
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${counter}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 30000 } } },
    ];
    fs.writeFileSync(file, [...base, ...rows].map((row) => JSON.stringify(row)).join('\n') + '\n');
    return file;
}
const autoStamp = (p, sid) => fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
const markerOf = (p, sid) => path.join(p.root, '.alfred', 'state', 'sessions', `AUTO-RUN-${sid}`);
function openRun(p, sid, atMs = Date.now())
{
    fs.mkdirSync(path.dirname(markerOf(p, sid)), { recursive: true });
    fs.writeFileSync(markerOf(p, sid), `skill: task-solve\nprompt: 0123456789ab\nat: ${new Date(atMs).toISOString()}\n`);
    fs.utimesSync(markerOf(p, sid), new Date(atMs), new Date(atMs));
}
const ask = (p, sid, questions, rowsAfter = [], extra = {}) => verdictResult(spawnSync(process.execPath, [path.join(HOOKS, 'guard-stop-contract.js')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions }, session_id: sid, cwd: p.root, transcript_path: transcript(rowsAfter), ...extra }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) } }));
const answered = (result) => { try { const out = JSON.parse(result.stdout).hookSpecificOutput; return out.permissionDecision === 'allow' ? out.updatedInput.answers : null; } catch { return null; } };
const pick = (question, label, description, other = 'Not now') => ({ question, header: 'H', multiSelect: false,
    options: [{ label, description }, { label: other, description: 'd' }] });

// Item 0 (B14): a description that names the outward act as held, deferred or the user's own does not make the ask wait.
test('auto-wave: a held outward act in the picked option\'s description is answered', () =>
{
    const p = project();
    autoStamp(p, 'h1');
    const question = 'Which row next?';
    for (const description of ['draft the request for you to send', 'the commit and the publish still wait for your word', 'publish and push stay held',
        'the publish waits for your word', 'the push gate asks you later', 'CI stays red until the next push', 'merge waits for you', 'pushes nothing', 'publishes nothing', 'sends nothing',
        'Read the log; then one publish ask for both changes, with rooms empty', 'I edit the config and test it; publishing from the old network then needs the value switched back',
        'Nothing goes live now; tell me when rooms are free, then I publish'])
        assert.deepStrictEqual(answered(ask(p, 'h1', [pick(question, 'Go on (Recommended)', description)])), { [question]: 'Go on (Recommended)' }, description);
});

test('auto-wave: an outward act in a description that is not held still waits', () =>
{
    const p = project();
    autoStamp(p, 'h2');
    const question = 'Which row next?';
    for (const description of ['pushes to origin', 'publish now, the push waits for your word', 'Build, test on a lane, publish (your OK asked first), then close',
        'After the tests pass, I push develop', 'Run the tests, then push develop and merge to main', 'push once CI is green', 'let me push the branch', 'the push waits, then merge it'])
        assert.strictEqual(answered(ask(p, 'h2', [pick(question, 'Go on (Recommended)', description)])), null, description);
});

// Item 1 (A2d): a typed stop is judged against the later of the stamp and this session's run marker.
test('auto-wave: a typed stop outlives only until the next run starts', () =>
{
    const p = project();
    autoStamp(p, 's1');
    const one = [pick('Run the tests next?', 'Run the tests (Recommended)', 'd', 'Skip them')];
    assert.strictEqual(answered(ask(p, 's1', one, [typedAt('stop everything until I ask')])), null, 'a stop alone waits');
    openRun(p, 's1', Date.now() - 30000);
    assert.strictEqual(answered(ask(p, 's1', one, [typedAt('stop everything until I ask')])), null, 'a run marker older than the stop holds nothing back');
    openRun(p, 's1', Date.now() + 10000);
    assert.ok(answered(ask(p, 's1', one, [typedAt('stop everything until I ask'), typedAt('/task-solve next', 5000)])), 'a run started after the stop is answered');
});

// Item 3 (B3): a classifier denial holds the next ask only, whether that ask was answered or not.
test('auto-wave: a classifier denial holds the first ask after it, not the second', () =>
{
    const p = project();
    autoStamp(p, 'd1');
    const one = [pick('Apply this plan?', 'Apply (Recommended)', 'd', 'Cancel')];
    const toolRow = (type, content) => ({ type, entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: type, content } });
    const denial = { ...toolRow('user', [{ type: 'tool_result', tool_use_id: 'x1', is_error: true, content: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: x.' }]), toolDenialKind: 'automode-blocked' };
    const call = toolRow('assistant', [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'x' } }]);
    const askCall = (id) => toolRow('assistant', [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [] } }]);
    const refusal = (id) => toolRow('user', [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'The user doesn\'t want to proceed with this tool use. The tool use was rejected.' }]);
    assert.strictEqual(answered(ask(p, 'd1', one, [call, denial])), null, 'the first ask after the denial waits');
    assert.strictEqual(answered(ask(p, 'd1', one, [call, denial, askCall('cur')], { tool_use_id: 'cur' })), null, 'the ask being judged is no earlier ask');
    assert.ok(answered(ask(p, 'd1', one, [call, denial, askCall('q1'), refusal('q1')])), 'a refused ask settles the denial');
    assert.ok(answered(ask(p, 'd1', one, [call, denial, askCall('q1')])), 'an ask sent after the denial settles it, answered or not');
});
