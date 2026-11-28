'use strict';
// C7 (session audit 2026-11-27, N06): a real session wrote 'The plan scored 60 of 90' and the ask was auto-answered, because
// `gradeUnderPass` read only 'N/100'. It also reads 'N of M' beside a grade word and 'N (level M)'. Each case goes through the
// stop contract's real ask route under auto-run, so a wait shows as the 'grade under its pass level' ledger row.
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

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-of-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.CLAUDE_PROJECT_DIR;
process.chdir(TMP);

let n = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(approvals, { recursive: true });
    return { root, gate: path.join(approvals, 'APPROVAL'), blocks: path.join(root, '.alfred', 'statistics', 'hook-blocks') };
}
function transcript()
{
    const p = path.join(TMP, `t-${++n}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] } });
    const said = (usage) => ({ type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } });
    const rows = [
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } },
        typed('take every recommendation'), typed('go'),
        said({ cache_creation_input_tokens: 20000 }), said({ cache_read_input_tokens: 30000 }),
    ];
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const run = (payload, env) => verdictResult(spawnSync(process.execPath, [path.join(HOOKS, 'guard-stop-contract.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...env } }));
const q = (question) => ({ question, header: 'H', multiSelect: false, options: [{ label: 'Build it (Recommended)', description: 'd' }, { label: 'Revise', description: 'd' }] });
const rows = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };

// Returns the ledger rows of the grade wait: [] when the ask was answered or waited for another reason.
function gradeWaits(question)
{
    const p = project();
    const sid = `g${++n}`;
    fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q(question)] }, session_id: sid, cwd: p.root, transcript_path: transcript() },
        { CLAUDE_PROJECT_DIR: p.root });
    return rows(p, sid).filter((x) => x.kind === 'auto-ask-waits' && /grade under its pass level/.test(x.reason));
}

test('a grade written as N of M under its pass level waits (C7, N06)', () =>
{
    // the N/100 form is the control: it waited before this change, so the harness reads a wait right
    for (const question of ['The plan scored 60/100 (level 90). Next?', 'The plan scored 60 of 90. Next?', 'The draft cap at 80 of 90. Next?', 'The plan scored 85 of 100 (pass 90). Next?',
        'The spec graded 70 of 80. Next?', 'The design score is 55 of 60. Next?'])
        assert.strictEqual(gradeWaits(question).length, 1, `waits: ${question}`);
});

test('N (level M) beside a grade word waits for a draft only (C7)', () =>
{
    assert.strictEqual(gradeWaits('The draft scored 70 (level 80). Next?').length, 1, 'a draft waits');
    assert.strictEqual(gradeWaits('The output scored 70 (level 80). Next?').length, 0, 'no draft word, no wait');
});

test('a score at or over its level, a step count and a count of other things never wait (C7)', () =>
{
    for (const question of ['The plan scored 92 of 100 (pass 90). Next?', 'The plan scored 95 of 90. Next?', 'The plan scored 90 of 90. Next?',
        'Plan step 2 of 5 is done. Next?', 'The plan capped at 3 of 5 retries. Next?', 'The plan scored 3 of 4 checks. Next?',
        'The report graded 40 of 60 tasks. Next?', 'The plan is ready. The run graded 40 of 60 tasks. Next?',
        'The plan capped at 80 of 100 (pass 70). Next?'])
        assert.strictEqual(gradeWaits(question).length, 0, `no grade wait: ${question}`);
});

test('an ask that writes 88/100 and 88 of 100 gives one wait (C7, Review Focus)', () =>
{
    assert.strictEqual(gradeWaits('The plan scored 88/100 (pass 90) and again scored 88 of 100. Next?').length, 1);
});
