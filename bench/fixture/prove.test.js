'use strict';
// The fixture's own proof: from a fresh verified clone, the database up, the build, the full suite
// green - three times serially, then two copies side by side (the case that once starved a shared
// database container and failed 676 tests). The suite must stay under four minutes; a restore is a
// network cost, not the suite's, so it is timed but never counted.
const test = require('node:test');
const assert = require('node:assert');
const { plan, steps, suiteSeconds, verdict } = require('./prove.js');

test('plan: the serial runs one at a time, then one round of side-by-side copies, each on its own port', () =>
{
    assert.deepStrictEqual(plan({ serial: 3, parallel: 2 }), [
        [{ id: 's1', port: 55431 }],
        [{ id: 's2', port: 55431 }],
        [{ id: 's3', port: 55431 }],
        [{ id: 'p1', port: 55431 }, { id: 'p2', port: 55432 }],
    ]);
    assert.deepStrictEqual(plan({ serial: 0, parallel: 0 }), []);
    assert.deepStrictEqual(plan({ serial: 1, parallel: 1 }), [[{ id: 's1', port: 55431 }], [{ id: 'p1', port: 55431 }]]);
});

test('steps: the database first and last, restores marked untimed, every command in the clone', () =>
{
    const s = steps();
    assert.match(s[0].cmd.join(' '), /docker compose up -d --wait/);
    assert.match(s[s.length - 1].cmd.join(' '), /docker compose down -v/);
    assert.ok(s.filter((x) => !x.timed).every((x) => /restore|npm ci|compose/.test(x.cmd.join(' '))), 'only restores and the database are untimed');
    assert.ok(s.some((x) => x.timed && /dotnet test/.test(x.cmd.join(' '))) && s.some((x) => x.timed && /npm (run )?test/.test(x.cmd.join(' '))));
});

test('suiteSeconds: sums the timed steps only, to the tenth', () =>
{
    const run = { steps: [{ timed: false, seconds: 50 }, { timed: true, seconds: 30.5 }, { timed: true, seconds: 12 }] };
    assert.strictEqual(suiteSeconds(run), 42.5);
    const drift = { steps: [{ timed: true, seconds: 0.1 }, { timed: true, seconds: 0.2 }] };
    assert.strictEqual(suiteSeconds(drift), 0.3, 'tenths never print as float drift');
});

test('verdict: green only when every run passed every step inside the limit', () =>
{
    const ok = (id, secs) => ({ id, steps: [{ timed: true, seconds: secs, code: 0 }] });
    assert.deepStrictEqual(verdict([ok('s1', 100), ok('s2', 239)], 240), { green: true, failures: [] });
    assert.deepStrictEqual(verdict([ok('s1', 240)], 240), { green: false, failures: ['s1: suite took 240s, the limit is under 240s'] });
    const red = { id: 'p2', steps: [{ timed: true, seconds: 10, code: 1, name: 'dotnet test' }] };
    assert.deepStrictEqual(verdict([ok('p1', 10), red], 240), { green: false, failures: ['p2: dotnet test exited 1'] });
    assert.deepStrictEqual(verdict([], 240), { green: false, failures: ['no runs'] });
});
