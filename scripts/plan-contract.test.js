'use strict';
// PF1 D14: the three public shapes live in docs/plan-folder-contract.md, and each writer is held to its example.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { examples, keyLines } = require('./plan-contract-fixture.js');
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
