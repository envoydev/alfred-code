'use strict';
// PF1 D14: the three public shapes live in docs/plan-folder-contract.md, and each writer is held to its example.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { examples, keyLines, shapeOf } = require('./plan-contract-fixture.js');
const P = require(path.join(__dirname, '..', 'stack', 'hooks', 'plan-status.js'));

test('contract: the status example is a valid schema 1 file with the engine\'s keys, in order', () =>
{
    const { status } = examples();
    assert.deepStrictEqual(P.validate(status), []);
    assert.deepStrictEqual(Object.keys(status), P.KEYS);
    for (const t of status.tasks) assert.deepStrictEqual(Object.keys(t), P.TASK_KEYS);
    assert.deepStrictEqual(keyLines().status, P.KEYS, 'the doc\'s key list is the validator\'s');
    assert.deepStrictEqual(keyLines().task, P.TASK_KEYS);
    assert.deepStrictEqual(P.KEYS.slice(0, 5), ['schema', 'title', 'updatedAt', 'approvedAt', 'completedAt'], 'the contract\'s five lead');
    assert.deepStrictEqual(P.TASK_KEYS.slice(0, 6), ['id', 'title', 'status', 'estimateMin', 'startedAt', 'doneAt']);
});

test('contract: a renamed, dropped or retyped key, a sixth status word and another time format fail the validator', () =>
{
    const base = () => JSON.parse(JSON.stringify(examples().status));
    const broken = (change) => { const s = base(); change(s); return P.validate(s); };
    assert.match(broken((s) => { delete s.approvedAt; })[0], /^approvedAt - /);
    assert.match(broken((s) => { s.tasks[0].estimateMin = '25'; })[0], /^tasks\[0\]\.estimateMin - /);
    assert.match(broken((s) => { s.tasks[1].status = 'IN_PROGRESS'; })[0], /^tasks\[1\]\.status - /);
    assert.match(broken((s) => { s.updatedAt = '2026-11-13T10:42:07.123Z'; })[0], /^updatedAt - /);
    assert.match(broken((s) => { s.schema = 2; })[0], /^schema - /);
    assert.deepStrictEqual(P.STATUSES, ['todo', 'in_progress', 'blocked', 'done', 'failed']);
});

const SCORECARD = path.join(__dirname, '..', 'stack', 'skills', 'mode-output-scoring', 'scripts', 'scorecard.js');

test('contract: the score example - scale 100, the four disposition words, the time format, released naming a round', () =>
{
    const { scoring } = examples();
    assert.deepStrictEqual([scoring.schema, scoring.scale, Object.keys(scoring), Object.keys(scoring.rounds[0])], [1, 100, keyLines().scoring, keyLines().round]);
    assert.deepStrictEqual(keyLines().scoring.slice(0, 4), ['schema', 'scale', 'released', 'rounds']);
    assert.deepStrictEqual(keyLines().round.slice(0, 4), ['round', 'at', 'total', 'severities']);
    assert.ok(scoring.rounds.some((r) => r.round === scoring.released));
    for (const r of scoring.rounds) { assert.match(r.at, P.TIME_RE); assert.deepStrictEqual(Object.keys(r.severities), ['BLOCKER', 'MATERIAL', 'MINOR']); }
    assert.deepStrictEqual([...new Set(scoring.rounds.flatMap((r) => r.findings.map((f) => f.disposition)))].sort(), ['closable', 'discarded', 'needs-human', 'open']);
    assert.ok(['grading', 'released', 'accepted', 'withheld'].includes(scoring.status));
});

test('contract: the score file scorecard.js builds has the example\'s keys, in order, with its types', () =>
{
    const { scoringDoc } = require(SCORECARD);
    const round = (id, value, at) => ({ id, attempt: 1, self: false, value, at, rubric: 'rubric-designer-plan.md', level: 80, findings: [{ severity: 'MATERIAL', title: 'T', disposition: 'needs-human', needs: ['x'] }] });
    const doc = scoringDoc({ prev: null, output: 'designer-plan', rounds: [round('1a2b3c4d', 78, '2026-11-13T09:31Z'), round('2b3c4d5e', 85, null)], released: '2b3c4d5e', accepted: false, final: null, at: '2026-11-13T09:50Z' });
    assert.deepStrictEqual(shapeOf(doc), shapeOf(examples().scoring));
    assert.deepStrictEqual([doc.scale, doc.released, doc.status, doc.rounds.map((r) => r.at)], [100, 2, 'released', ['2026-11-13T09:31Z', '2026-11-13T09:50Z']]);
    const again = scoringDoc({ prev: doc, output: 'designer-plan', rounds: [round('3c4d5e6f', 70, null)], released: null, accepted: false, final: null, at: '2026-11-13T10:00Z' });
    assert.deepStrictEqual([again.released, again.releasedBefore, again.status, again.rounds.map((r) => r.round), again.rounds.slice(0, 2)], [null, 2, 'grading', [1, 2, 3], doc.rounds]);
    const ended = scoringDoc({ prev: again, output: 'designer-plan', rounds: [round('3c4d5e6f', 70, null)], released: null, accepted: false, final: '3c4d5e6f', at: '2026-11-13T10:05Z' });
    assert.deepStrictEqual([ended.released, ended.releasedBefore, ended.status, ended.rounds[2].at], [2, null, 'released', '2026-11-13T10:00Z']);
});

test('contract: the session example carries the status file\'s keys, in order, plan last and in its form', () =>
{
    const S = require(path.join(__dirname, '..', 'stack', 'hooks', 'session-status.js'));
    const { session } = examples();
    assert.deepStrictEqual([Object.keys(session), keyLines().session], [[...S.FIELDS], [...S.FIELDS]]);
    assert.strictEqual(S.FIELDS[S.FIELDS.length - 1], 'plan');
    assert.match(session.plan, /^(?!\/|\.\.\/|[A-Za-z]:)[^\\]+\/plans\/[^/\\]+\/$/, 'relative, forward slashes, one trailing slash');
});
