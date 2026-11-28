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

// Runs one ask and returns what the ledger shows: the grade waits, every wait, and the auto-answers.
function gradeAsk(question)
{
    const p = project();
    const sid = `g${++n}`;
    fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n`);
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q(question)] }, session_id: sid, cwd: p.root, transcript_path: transcript() },
        { CLAUDE_PROJECT_DIR: p.root });
    const all = rows(p, sid);
    return { grade: all.filter((x) => x.kind === 'auto-ask-waits' && /grade under its pass level/.test(x.reason)),
        waits: all.filter((x) => x.kind === 'auto-ask-waits'), answers: all.filter((x) => x.kind === 'auto-answer') };
}
const waitsOnGrade = (question) => { const r = gradeAsk(question); return r.grade.length === 1 && r.waits.length === 1 && r.answers.length === 0; };
const answered = (question) => { const r = gradeAsk(question); return r.grade.length === 0 && r.answers.length === 1; };

test('a grade written as N of M under its pass level waits (C7, N06)', () =>
{
    // the N/100 form is the control: it waited before this change, so the harness reads a wait right
    for (const question of ['The plan scored 60/100 (level 90). Next?', 'The plan scored 60 of 90. Next?', 'The draft cap at 80 of 90. Next?',
        'The plan scored 85 of 100 (pass 90). Next?', 'The spec graded 70 of 80. Next?', 'The design score is 55 of 60. Next?'])
        assert.ok(waitsOnGrade(question), `waits: ${question}`);
});

test('a colon, scores and out of are read as the same grade (C7 fix 2)', () =>
{
    for (const question of ['The plan score: 60 of 90. Next?', 'The plan score: 85 of 100 (pass 90). Next?', 'The plan scored 85 out of 100 (pass 90). Next?',
        'The plan scores 60 of 90. Next?', 'The draft scored: 70 (level 80). Next?'])
        assert.ok(waitsOnGrade(question), `waits: ${question}`);
});

test('a named pass is the pass level, and M is the maximum (C7 fix 1)', () =>
{
    for (const question of ['The plan scored 85 of 90 (pass 80). Next?', 'The plan scored 70 of 80 (pass 70). Next?',
        'The plan scored 60 of 90 (max 100, pass 60). Next?'])
        assert.ok(answered(question), `answered: ${question}`);
    assert.ok(waitsOnGrade('The plan scored 60 of 90 (max 100, pass 70). Next?'), 'a pass over the grade waits');
});

// Round 2: a round word is no pass. A named pass counts only at 50 or more and at most M; below that the no-pass rule applies.
test('a round or tree level below 50 is no named pass, so the grade still waits (C7 round 2)', () =>
{
    for (const question of ['The plan scored 60 of 90 on pass 2. Next?', 'The plan scored 80 of 90 after fix pass 2. Next?',
        'The plan scored 60 of 90 at level 3 of the tree. Next?'])
        assert.ok(waitsOnGrade(question), `waits: ${question}`);
    // a pass over M is no pass of this grade either; '6 of 10 (pass 9)' falls under the bound (M under 50) and no longer waits
    assert.ok(waitsOnGrade('The plan scored 60 of 90 (pass 95). Next?'), 'a pass over M is ignored, no-pass rule waits');
    assert.ok(answered('The plan scored 6 of 10 (pass 9). Next?'), 'pass 9 is under 50, M under 50: no grade');
});

test('a count noun after M makes the match no grade (C7 fix 3)', () =>
{
    for (const question of ['The plan scored 45 of 50 tests. Next?', 'The plan grades 60 of 90 tasks. Next?', 'The plan cap at 50 of 80 workers. Next?',
        'The plan scored 60 of 90 rounds. Next?'])
        assert.ok(answered(question), `answered: ${question}`);
});

test('N (level M) beside a grade word waits for a draft only (C7)', () =>
{
    assert.ok(waitsOnGrade('The draft scored 70 (level 80). Next?'), 'a draft waits');
    assert.ok(answered('The output scored 70 (level 80). Next?'), 'no draft word, no wait');
});

test('a score at or over its level, a step count and a count of other things never wait (C7)', () =>
{
    for (const question of ['The plan scored 92 of 100 (pass 90). Next?', 'The plan scored 95 of 90. Next?', 'The plan scored 90 of 90. Next?',
        'Plan step 2 of 5 is done. Next?', 'The plan capped at 3 of 5 retries. Next?', 'The plan scored 3 of 4 checks. Next?',
        'The report graded 40 of 60 tasks. Next?', 'The plan is ready. The run graded 40 of 60 tasks. Next?',
        'The plan capped at 80 of 100 (pass 70). Next?'])
        assert.ok(answered(question), `answered: ${question}`);
});

test('an ask that writes 88/100 and 88 of 100 gives one wait and no answer (C7, Review Focus)', () =>
{
    const r = gradeAsk('The plan scored 88/100 (pass 90) and again scored 88 of 100. Next?');
    assert.strictEqual(r.waits.length, 1);
    assert.strictEqual(r.grade.length, 1);
    assert.match(r.waits[0].reason, /grade under its pass level/);
    assert.strictEqual(r.answers.length, 0);
});
