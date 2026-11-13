'use strict';
// PF1 (plan 2, Task 9; R42): the order the raise-to-standard route sends the model through, run against the engine - a
// later engine change that refuses one of its steps goes red here by name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planFolder } = require('./plan-folder-fixture.js');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-order-'));
const first = (r) => r.out.split('\n')[0] || r.err.split('\n')[0];

test('the raise-to-standard route (R42): sync, approve with words alone, start and done per task, complete', () => {
    const plan = planFolder(project(), 'csv', { cards: 2 });                       // written and synced, not approved
    assert.match(first(plan.run(['start', '--plan', 'csv', '--task', '1'])), /the plan is not approved/, 'a task is not started before the approval');
    assert.match(first(plan.run(['complete', '--plan', 'csv'], 'suite: npm test - ok\n')), /the plan is not approved/);
    const approved = plan.run(['approve', '--plan', 'csv'], 'words: add a csv export to the orders page\n');
    assert.strictEqual(approved.code, 0);
    assert.match(approved.out, /^Approved: \S+ - "add a csv export to the orders page"$/m);
    for (const id of ['1', '2']) {
        assert.strictEqual(plan.run(['start', '--plan', 'csv', '--task', id]).code, 0, `start ${id}`);
        assert.strictEqual(plan.run(['done', '--plan', 'csv', '--task', id], 'result: npm test - 12 passed\n').code, 0, `done ${id}`);
    }
    const closed = plan.run(['complete', '--plan', 'csv'], 'suite: npm test - 12 passed\n');
    assert.match(first(closed), /^plan-status: complete ok - plan csv /);
    assert.ok(plan.status().completedAt);
});
