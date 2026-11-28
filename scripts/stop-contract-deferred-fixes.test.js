'use strict';
// Session audit 2026-11-27, seat A (the deferred fixes of guard-stop-contract.js). Each test is named for the defect it pins.
// Asks go through the hook's real PreToolUse route under auto-run; Stop closes go through its real Stop route.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-deferred-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.CLAUDE_PROJECT_DIR;
process.chdir(TMP);

let counter = 0;
const iso = (ms) => new Date(ms).toISOString();
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(approvals, { recursive: true });
    return { root, gate: path.join(approvals, 'APPROVAL'), blocks: path.join(root, '.alfred', 'statistics', 'hook-blocks') };
}
function autoTranscript()
{
    const file = path.join(TMP, `t-${++counter}.jsonl`);
    const at = iso(Date.now() - 60000);
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] } });
    const said = (usage) => ({ type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++counter}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } });
    const rows = [
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } },
        typed('take every recommendation'), typed('go'), said({ cache_creation_input_tokens: 20000 }), said({ cache_read_input_tokens: 30000 }),
    ];
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
}
const ledger = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const opt = (label, description = 'd') => ({ label, description });

// One AskUserQuestion under a live auto-run stamp of its own session. Returns the ledger's waits and answers and the raw output.
function ask(question, options, env = {})
{
    const p = project();
    const sid = `d${++counter}`;
    fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
    const input = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', session_id: sid, cwd: p.root, transcript_path: autoTranscript(),
        tool_input: { questions: [{ question, header: 'H', multiSelect: false, options }] } };
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
    const rows = ledger(p, sid);
    return { waits: rows.filter((x) => x.kind === 'auto-ask-waits'), answers: rows.filter((x) => x.kind === 'auto-answer'), out: `${r.stdout}\n${r.stderr}`, status: r.status };
}
const PICK = [opt('Build it (Recommended)'), opt('Revise')];
const answeredByAuto = (question, options = PICK, env) => ask(question, options, env).answers.length === 1;
const waitsOn = (question, options = PICK, env) => { const r = ask(question, options, env); return r.answers.length === 0 && r.waits.length === 1; };

// A Stop close over a transcript holding one typed turn and the reply.
function stop(reply, { env = {}, rows = [] } = {})
{
    const p = project();
    const sid = `s${++counter}`;
    fs.mkdirSync(p.blocks, { recursive: true });
    if (rows.length) fs.writeFileSync(path.join(p.blocks, `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const file = path.join(TMP, `t-${++counter}.jsonl`);
    const at = iso(Date.now() - 60000);
    const lines = [{ type: 'user', timestamp: at, message: { role: 'user', content: 'go' } },
        { type: 'assistant', timestamp: at, message: { id: `m${counter}`, role: 'assistant', content: [{ type: 'text', text: reply }] } }];
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', cwd: p.root,
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: file, last_assistant_message: reply }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}
const passes = (reply) => stop(reply).status === 0;
const holds = (reply) => stop(reply).status === 2;

// ---- group (a): prose and wait items ----

test('L1-02: "Are you back from lunch?" is no more answered under auto-run than "Are you back?"', () =>
{
    assert.strictEqual(answeredByAuto('Are you back?'), false, 'control: the short form is blocked');
    for (const question of ['Are you back from lunch?', 'Are you back at your desk?', 'Are you there with the team now?'])
        assert.strictEqual(answeredByAuto(question), false, question);
    assert.strictEqual(answeredByAuto('Are you back to the old plan or the new one?'), true, 'a question about a plan stays an ordinary ask');
});

test('L1-03: "Hold the push until green and deploy now" deploys, so the ask waits', () =>
{
    const deploy = [opt('Hold the push until green and deploy now (Recommended)'), opt('Revise')];
    assert.strictEqual(waitsOn('Which route?', deploy), true, 'the deploy is the pick\'s own act');
    assert.strictEqual(answeredByAuto('Which route?', [opt('Hold the push until green (Recommended)'), opt('Revise')]), true, 'control: a pure hold is answered');
    assert.strictEqual(answeredByAuto('Which route?', [opt('Hold the push until green and then run the tests (Recommended)'), opt('Revise')]), true, 'a local act after the deferral is no outward act');
    assert.strictEqual(waitsOn('Which route?', [opt('Hold the push until green, then deploy (Recommended)'), opt('Revise')]), true, 'then deploy');
});

test('L1-08: "Tell me if I should have used another flag." is a past-tense courtesy and passes', () =>
{
    assert.ok(passes('Done: the lint run is clean.\n\nTell me if I should have used another flag.'));
    assert.ok(holds('Done: the lint run is clean.\n\nTell me if I should push it.'), 'control: a decision is held');
});

test('X-1: "Let me know if it happens again." passes as "Tell me if it happens again." does', () =>
{
    assert.ok(passes('Done: the lint run is clean.\n\nTell me if it happens again.'), 'control');
    assert.ok(passes('Done: the lint run is clean.\n\nLet me know if it happens again.'));
    assert.ok(passes('Done: the lint run is clean.\n\nLet me know if anything breaks.'));
    assert.ok(holds('Done: the lint run is clean.\n\nLet me know if you want me to push it.'), 'a decision word keeps the hold');
    assert.ok(holds('Done: the lint run is clean.\n\nLet me know whether to push it.'), 'whether to');
    assert.ok(holds('Done: the lint run is clean.\n\nLet me know if I should push it.'), 'if I should');
});

test('L2-11: a waited ask that also fails the mark check says the answer is the user\'s', () =>
{
    const r = ask('waits for you: pick the region', [opt('Skip it'), opt('West (Recommended)')]);
    assert.match(r.out, /marked '\(Recommended\)'|exactly one option marked/i, 'the mark check denied it');
    assert.match(r.out, /This ask waits for the user/);
});

test('L2-29: a Stop held for another reason still carries the note for an unrecorded auto line', () =>
{
    const r = stop("Fixed the lint run.\n\nAuto: 'Commit now?' -> 'Commit now (Recommended)'\n\nShall I push it now?");
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /does not hold: no auto-run answer is on record/);
    const clean = stop("Fixed the lint run.\n\nAuto: 'Commit now?' -> 'Commit now (Recommended)'\n");
    assert.strictEqual(clean.status, 0, 'control: the exit 0 route still carries the note as context');
    assert.match(clean.stdout, /no auto-run answer is on record/);
    const noAuto = stop('Fixed the lint run.\n\nShall I push it now?');
    assert.strictEqual(noAuto.status, 2);
    assert.doesNotMatch(noAuto.stderr, /on record/, 'no auto line, no note');
});
