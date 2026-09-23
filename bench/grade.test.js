'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('./test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const path = require('node:path');
const { drive } = require('./drive.js');
const { gradeRun } = require('./grade.js');
const { detectInfra } = require('./lib/grade.js');
const { makeWorld } = require('./test/world.js');

// The hidden test passes when the session created made.txt. A flag file beside the world makes it
// print a mass connection failure instead, the way a starved database container does.
function hiddenCheck(flag)
{
    return `const fs = require('fs');
if (fs.existsSync(${JSON.stringify(flag)})) { for (let i = 0; i < 60; i++) console.log('  Failed Api.Tests.T' + i + ' [1 s]'); console.log('Npgsql.NpgsqlException: Connection refused'); process.exit(1); }
process.exit(fs.existsSync('made.txt') ? 0 : 1);
`;
}

async function gradedWorld(t, { grade } = {})
{
    const w = makeWorld(t, {
        arms: { good: { env: { FAKE_EDIT: 'made.txt' } }, bad: { env: { FAKE_EDIT: 'other.txt' } } },
        tasks: { t1: { grade: grade || { hidden: [['node', 'hidden-check.js']], suite: [['node', '-e', '0']], timeoutMin: 1 } } },
    });
    w.flag = path.join(w.dir, 'infra-flag');
    fs.writeFileSync(path.join(w.opts.tasksDir, 't1', 'hidden', 'hidden-check.js'), hiddenCheck(w.flag));
    await drive(w.opts);
    w.grade = () => gradeRun({ benchDir: w.bench, run: 'r-test', armsDir: w.opts.armsDir, tasksDir: w.opts.tasksDir, base: w.opts.base, log: () => {} });
    w.read = (arm) => JSON.parse(fs.readFileSync(path.join(w.runDir, arm, 't1', 'r1', 'grade.json'), 'utf8'));
    return w;
}

test('a session that did the work passes, one that did not fails, and the suite is judged apart', async (t) =>
{
    const w = await gradedWorld(t);
    const res = w.grade();
    assert.deepStrictEqual([res.graded, res.infra, res.skipped], [2, 0, 0]);
    const good = w.read('good');
    const bad = w.read('bad');
    assert.deepStrictEqual([good.hiddenPass, good.suiteGreen, good.infra, good.applied], [true, true, null, true]);
    assert.deepStrictEqual([bad.hiddenPass, bad.suiteGreen, bad.infra], [false, true, null]);
    assert.ok(fs.existsSync(path.join(w.runDir, 'good', 't1', 'r1', 'grade.log')));
    assert.ok(!fs.existsSync(path.join(w.bench, 'work', 'r-test')), 'grading leaves no work dir');
});

test('a patch that does not apply is a fail, never infrastructure', async (t) =>
{
    const w = await gradedWorld(t);
    fs.writeFileSync(path.join(w.runDir, 'good', 't1', 'r1', 'diff.patch'), 'diff --git a/nope.txt b/nope.txt\n--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-was\n+now\n');
    w.grade();
    const g = w.read('good');
    assert.deepStrictEqual([g.applied, g.hiddenPass, g.suiteGreen, g.infra], [false, false, false, null]);
});

test('infrastructure is read from the log: over 50 failing tests with a connection error', () =>
{
    const many = Array.from({ length: 60 }, (_, i) => `  Failed Api.Tests.T${i} [1 s]`).join('\n');
    assert.match(detectInfra(`${many}\nNpgsql.NpgsqlException: Connection refused`), /mass connection failure: 60 failing tests/);
    assert.strictEqual(detectInfra(many), null, 'many failures, no connection error: the code');
    assert.strictEqual(detectInfra(`${many.split('\n').slice(0, 10).join('\n')}\nECONNREFUSED 127.0.0.1:5432`), null, 'a few failures: the code');
    assert.match(detectInfra('Failed!  - Failed:    67, Passed:     3, Skipped:     0\nSocketException: Connection refused'), /67 failing tests/);
    assert.strictEqual(detectInfra('Failed!  - Failed:    50, Passed:     3\nConnection refused'), null, 'the boundary: 50 is not over 50');
    assert.match(detectInfra('Failed!  - Failed:    51, Passed:     3\nConnection refused'), /51 failing tests/);
});

test('an infrastructure cell is queued, and the next pass regrades only the queue', async (t) =>
{
    const w = await gradedWorld(t);
    fs.writeFileSync(w.flag, '1');
    const first = w.grade();
    assert.strictEqual(first.infra, 2);
    assert.match(w.read('good').infra, /mass connection failure/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(w.runDir, 'regrade.json'), 'utf8')).cells.sort(), ['bad/t1/r1', 'good/t1/r1']);

    fs.rmSync(w.flag);
    fs.writeFileSync(path.join(w.runDir, 'bad', 't1', 'r1', 'grade.json'), JSON.stringify({ hiddenPass: false, suiteGreen: true, infra: null, final: 'hand-set' }));
    const second = w.grade();
    assert.deepStrictEqual([second.graded, second.infra], [1, 0]);
    assert.strictEqual(w.read('good').hiddenPass, true);
    assert.strictEqual(w.read('bad').final, 'hand-set', 'a final grade is never regraded');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(w.runDir, 'regrade.json'), 'utf8')).cells, []);
});

test('a grader command past its limit is infrastructure', async (t) =>
{
    const w = await gradedWorld(t, { grade: { hidden: [['node', '-e', 'setTimeout(() => {}, 20000)']], suite: [], timeoutMin: 0.005 } });
    w.grade();
    assert.match(w.read('good').infra, /grader timeout/);
});

test('a baseline that no longer matches the session\'s is infrastructure, not the arm\'s fail', async (t) =>
{
    const w = await gradedWorld(t);
    const tpl = fs.readdirSync(path.join(w.bench, 'work', 'templates')).find((d) => d.startsWith('good-') && !d.endsWith('.log'));
    fs.writeFileSync(path.join(w.bench, 'work', 'templates', tpl, 'repo', 'drift.txt'), 'rebuilt differently\n');
    w.grade();
    assert.match(w.read('good').infra, /baseline/);
    assert.strictEqual(w.read('bad').infra, null);
});

test('grading refuses while the run is still being driven', async (t) =>
{
    const w = await gradedWorld(t);
    fs.mkdirSync(path.join(w.runDir, '.lock'));
    fs.writeFileSync(path.join(w.runDir, '.lock', 'pid'), `${process.ppid}\n`);
    assert.throws(() => w.grade(), /r-test is held by pid/);
});
