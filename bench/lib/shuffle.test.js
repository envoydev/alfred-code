'use strict';
// The run order is part of fairness: arms interleaved so no arm runs all its cells in one stretch of
// the day (rate limits, a CLI update, a slow network hit every arm alike), and seeded so a run can be
// replayed cell for cell.
const test = require('node:test');
const assert = require('node:assert');
const { cells, mulberry32 } = require('./shuffle.js');

const ARMS = ['ours', 'ecc', 'bare'];
const TASKS = ['api-1', 'api-2', 'web-1', 'data-1'];
const key = (c) => `${c.arm}/${c.task}/${c.rep}`;

test('shuffle: the same seed gives the same order, another seed another', () =>
{
    const a = cells({ arms: ARMS, tasks: TASKS, reps: 3, seed: 7 }).map(key);
    const b = cells({ arms: ARMS, tasks: TASKS, reps: 3, seed: 7 }).map(key);
    const c = cells({ arms: ARMS, tasks: TASKS, reps: 3, seed: 8 }).map(key);
    assert.deepStrictEqual(a, b);
    assert.notDeepStrictEqual(a, c);
});

test('shuffle: every (arm, task, rep) exactly once', () =>
{
    const order = cells({ arms: ARMS, tasks: TASKS, reps: 3, seed: 1 }).map(key);
    assert.strictEqual(order.length, 36);
    assert.strictEqual(new Set(order).size, 36);
    for (const arm of ARMS) for (const task of TASKS) for (const rep of [1, 2, 3]) assert.ok(order.includes(`${arm}/${task}/${rep}`));
});

test('shuffle: interleaved - every block of arms.length cells holds each arm once, on the same task and rep', () =>
{
    for (const seed of [1, 2, 3, 99])
    {
        const order = cells({ arms: ARMS, tasks: TASKS, reps: 3, seed });
        for (let i = 0; i < order.length; i += ARMS.length)
        {
            const block = order.slice(i, i + ARMS.length);
            assert.deepStrictEqual(block.map((c) => c.arm).sort(), [...ARMS].sort(), `seed ${seed} block ${i / ARMS.length}`);
            assert.strictEqual(new Set(block.map((c) => `${c.task}/${c.rep}`)).size, 1);
        }
    }
});

test('shuffle: the arm order inside a block is seeded too - no arm always goes first', () =>
{
    const firsts = new Set(cells({ arms: ARMS, tasks: TASKS, reps: 3, seed: 5 }).filter((_, i) => i % ARMS.length === 0).map((c) => c.arm));
    assert.ok(firsts.size > 1);
});

test('shuffle: mulberry32 is a fixed sequence (a changed generator would silently reorder old runs)', () =>
{
    const r = mulberry32(42);
    assert.deepStrictEqual([r(), r(), r()].map((x) => x.toFixed(10)), ['0.6011037519', '0.4482905590', '0.8524657935']);
});

test('shuffle: bad input is refused by name', () =>
{
    assert.throws(() => cells({ arms: [], tasks: TASKS, reps: 1, seed: 1 }), /arms/);
    assert.throws(() => cells({ arms: ARMS, tasks: TASKS, reps: 0, seed: 1 }), /reps/);
    assert.throws(() => cells({ arms: ['a', 'a'], tasks: TASKS, reps: 1, seed: 1 }), /twice/);
});
