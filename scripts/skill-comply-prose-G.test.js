'use strict';
// Group G of the 2026-11-04 prose A/B round - mode-output-scorer: sc-13 (the seat runs in the background only in an
// interactive session; a seat that returns in the foreground goes straight on to step 6). The prose pin, and the
// offline proof that the new 'mode-output-scorer' step passes a trace that keeps it and fails one that breaks it,
// before any billed run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKILL = 'stack/skills/mode-output-scorer/SKILL.md';

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('sc-13: the background turn is the interactive session\'s; a foreground return goes on to step 6', () =>
{
    const step5 = read(SKILL).split('\n').find((l) => l.startsWith('5. Dispatch ONE new output-scorer seat per grade'));
    assert.ok(step5.includes('never write or edit one. In an interactive session the seat runs in the background: the turn that dispatches it ends with the one line `Scoring <output> - the grader is running` and releases nothing;'));
    assert.ok(step5.endsWith('answered without releasing the output. A seat that returns in the foreground hands its report back in the same turn: go on to step 6.'));
    assert.ok(!/(?:^|\. )The seat runs in the background/.test(step5), 'the unconditional sentence left');
    // the round's replay setting: one scorer round, the 2026-10-25 replay's
    assert.match(read('meta/skill-comply/mode-output-scorer/scaffold.sh'), /ALFRED_CODE_SCORER:'1',ALFRED_CODE_SCORER_ROUNDS:'1'/);
});

// --- the offline proof -----------------------------------------------------------------------------------------

const S = 'S="${CLAUDE_SKILL_DIR}/scripts/scorecard.js"\n[ -f "$S" ] || S=.claude/skills/mode-output-scorer/scripts/scorecard.js\n';
// combined: the grade and the next in ONE Bash command - 'grade-next' the 2026-11-04 smoke's shape on both arms,
// 'next-grade' the order reversed; extraNext adds a later next of its own.
function scorerRun({ grade = true, next = true, gradeFirst = false, combined = null, extraNext = false } = {})
{
    const rows = [user('Write an implementation plan for a cancellation reason: `POST /orders/:id/cancel` takes a `reason` (required, at most 200 characters) and the order row keeps it. Plan only, no code changes.'),
        tool('Skill', { skill: 'habits-plan-writing' }),
        tool('Bash', { command: `${S}node "$S" start --root /w --session s1 --slug cancel-reason --output designer-plan --target /w/.alfred/docs/work/plans/cancel-reason.md` }),
        tool('Write', { file_path: '/w/.alfred/state/sessions/scorer/s1/cancel-reason/task.md', content: 'the request' }),
        tool('Write', { file_path: '/w/.alfred/state/sessions/scorer/s1/cancel-reason/draft-0.md', content: '# plan' })];
    const gradeRow = () => tool('Bash', { command: `${S}node "$S" grade /w/.alfred/state/sessions/scorer/s1/cancel-reason/score-0.md --output designer-plan --level 80` });
    if (gradeFirst) rows.push(gradeRow());
    rows.push(tool('Agent', { subagent_type: 'alfred-code:output-scorer', description: 'grade the plan', prompt: 'score-file: /w/.alfred/state/sessions/scorer/s1/cancel-reason/score-0.md' }));
    if (!grade && !next) { rows.push(say('Scoring designer-plan - the grader is running')); return jsonl(rows); }
    const GRADE = 'node "$S" grade /w/.alfred/state/sessions/scorer/s1/cancel-reason/score-0.md --output designer-plan --level 80';
    const NEXT = 'node "$S" next --root /w --session s1 --slug cancel-reason --level 80 --rounds 1';
    if (combined) rows.push(tool('Bash', { command: `${S}${combined === 'grade-next' ? `${GRADE} && ${NEXT}` : `${NEXT}; ${GRADE}`}` }));
    else
    {
        if (grade && !gradeFirst) rows.push(gradeRow());
        if (next) rows.push(tool('Bash', { command: `${S}${NEXT}` }));
    }
    if (extraNext) rows.push(tool('Bash', { command: `${S}${NEXT}` }));
    // a run that never asks the script what's next stops at the score: nothing is released
    rows.push(say('Scored: 88/100 (level 80) - 1 run(s) - independent - designer-plan'));
    if (next || combined || extraNext) rows.push(tool('Write', { file_path: '/w/.alfred/docs/work/plans/cancel-reason.md', content: '# plan' }));
    return jsonl(rows);
}

test('group G fixtures: grade-after-return passes the foreground loop and fails a stop after the dispatch', () =>
{
    const fx = expectOf('mode-output-scorer');
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun(), { level: 'plain' })), []);
    // the background shape in a print run: the dispatching turn ends, nothing after it
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ grade: false, next: false }), { level: 'plain' })), ['grade-after-return']);
    // next with no grade, and a grade run before the seat returned
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ grade: false }), { level: 'plain' })), ['grade-after-return']);
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ gradeFirst: true }), { level: 'plain' })), ['grade-after-return']);
    // grade then next in one command is next after grade; with a later next of its own too
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ combined: 'grade-next' }), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ combined: 'grade-next', extraNext: true }), { level: 'plain' })), []);
    // next ahead of the grade in one command, and a grade with no next after it
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ combined: 'next-grade' }), { level: 'plain' })), ['grade-after-return']);
    assert.deepStrictEqual(failing(sc.grade(fx, scorerRun({ next: false }), { level: 'plain' })), ['grade-after-return']);
});
