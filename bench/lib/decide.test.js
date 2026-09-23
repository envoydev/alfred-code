'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compare, headline } = require('./decide.js');

const arm = (name, passes, n, meanCost) => ({ arm: name, passes, n, meanCost });

test('better: 15+ points, intervals apart, cost within 25%', () =>
{
    const r = compare(arm('ours', 30, 36, 1.0), arm('bare', 20, 36, 1.0));
    assert.strictEqual(r.verdict, 'better');
    assert.match(r.sentence, /^ours is BETTER than bare/);
    assert.strictEqual(compare(arm('bare', 20, 36, 1.0), arm('ours', 30, 36, 1.0)).verdict, 'worse');
});

test('no measured difference when any one of the three conditions fails alone', () =>
{
    const points = compare(arm('a', 900, 1000, 1), arm('b', 760, 1000, 1));
    assert.deepStrictEqual([points.verdict, points.failed], ['no measured difference', ['points']]);
    const apart = compare(arm('a', 4, 5, 1), arm('b', 3, 5, 1));
    assert.deepStrictEqual([apart.verdict, apart.failed], ['no measured difference', ['intervals']]);
    const cost = compare(arm('a', 30, 36, 1.26), arm('b', 20, 36, 1.0));
    assert.deepStrictEqual([cost.verdict, cost.failed], ['no measured difference', ['cost']]);
    assert.match(points.sentence, /NO MEASURED DIFFERENCE between a and b/);
});

test('the boundaries: exactly 15 points and exactly 25% more cost still count', () =>
{
    assert.strictEqual(compare(arm('a', 650, 1000, 1.25), arm('b', 500, 1000, 1.0)).verdict, 'better');
    assert.strictEqual(compare(arm('a', 649, 1000, 1.0), arm('b', 500, 1000, 1.0)).verdict, 'no measured difference');
    assert.strictEqual(compare(arm('a', 30, 36, 0.3), arm('b', 20, 36, 0)).verdict, 'no measured difference', 'any cost over a free arm is more than 25%');
});

test('ours not better than bare is the finding, and it outranks the ECC comparison', () =>
{
    const h = headline({ ours: arm('ours', 25, 36, 1), bare: arm('bare', 22, 36, 1), ecc: arm('ecc', 10, 36, 1) });
    assert.match(h.lead, /ours is not better than bare on the headline tasks - that is the finding/);
    assert.match(h.rest[0], /ours is BETTER than ecc/);
});

test('when ours beats bare, the lead is the ECC comparison, with the bare result beside it', () =>
{
    const h = headline({ ours: arm('ours', 30, 36, 1), bare: arm('bare', 20, 36, 1), ecc: arm('ecc', 28, 36, 1) });
    assert.match(h.lead, /NO MEASURED DIFFERENCE between ours and ecc/);
    assert.match(h.rest[0], /ours is BETTER than bare/);
});
