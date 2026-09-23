'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { wilson, overlap, Z90 } = require('./stats.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('the 90% z is pinned', () => assert.strictEqual(Z90, 1.6448536269514722));

test('Wilson 90% intervals against values computed independently', () =>
{
    for (const [k, n, lo, hi] of [[8, 10, 0.540793, 0.931442], [0, 10, 0, 0.212942], [10, 10, 0.787058, 1], [30, 36, 0.708784, 0.911282], [3, 5, 0.272483, 0.857294]])
    {
        const w = wilson(k, n);
        near(w.lo, lo);
        near(w.hi, hi);
        near(w.p, k / n);
    }
});

test('no trials is the whole interval, and a count outside 0..n is refused', () =>
{
    assert.deepStrictEqual(wilson(0, 0), { p: null, lo: 0, hi: 1 });
    assert.throws(() => wilson(11, 10), /11 of 10/);
    assert.throws(() => wilson(-1, 10), /-1 of 10/);
});

test('overlap is inclusive at a shared endpoint', () =>
{
    assert.strictEqual(overlap({ lo: 0.1, hi: 0.5 }, { lo: 0.5, hi: 0.9 }), true);
    assert.strictEqual(overlap({ lo: 0.1, hi: 0.49 }, { lo: 0.5, hi: 0.9 }), false);
});
