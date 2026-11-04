'use strict';
// The D8 billed A/B's fixture builder (plan docs/superpowers/plans/2026-11-03-d8-ab.md, Tasks 2-3): every task.json
// is complete, a `from` task inherits, no fixture file is a test the repo runs, and `build` never lays `reference/`.
// Offline and spawn-free, so it passes on every CI OS; the real build and check are the plan's own free steps.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fx = require('./d8-ab-fixtures.js');

const ROOT = path.join(__dirname, '..');
const PRICED = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'model-prices.json'), 'utf8')).models.map((m) => m.id));
const NO_ACCEPTANCE = new Set(['t4']);

test('every task.json loads and is complete', () =>
{
    assert.deepStrictEqual(fx.list(), ['probe', 't1', 't2', 't3', 't4', 't7']);
    for (const id of fx.list())
    {
        const t = fx.loadTask(id);
        assert.strictEqual(t.id, id);
        assert.match(t.prompt, /^\/[a-z][a-z-]* --mode-auto-run-on \S/, `${id} prompt`);
        assert.ok(typeof t.suite === 'string' && t.suite.trim(), `${id} suite`);
        if (NO_ACCEPTANCE.has(id))
        {
            assert.strictEqual(t.acceptance, '', `${id} has no acceptance`);
            assert.deepStrictEqual(t.oracle, [], `${id} oracle`);
            assert.strictEqual(t.acceptanceCount, 0, `${id} acceptanceCount`);
        }
        else
        {
            assert.ok(t.acceptance.trim(), `${id} acceptance`);
            assert.ok(t.oracle.length > 0, `${id} oracle`);
            assert.ok(t.acceptanceCount >= 1, `${id} acceptanceCount`);
        }
        assert.ok(t.rows.length > 0 && t.rows.every((r) => Number.isInteger(r) && r >= 1 && r <= 16), `${id} rows`);
        assert.strictEqual(t.rubric.length, 5, `${id} rubric`);
        assert.ok(t.estimate > 0 && t.cap >= 2 * t.estimate, `${id} cap ${t.cap} vs estimate ${t.estimate}`);
        assert.ok(PRICED.has(t.model), `${id} model ${t.model} is priced`);
        assert.ok(['common/angular', 'common/dotnet', null].includes(t.base), `${id} base`);
        assert.ok(t.trigger && t.trigger.text && (t.trigger.files || t.trigger.grep), `${id} trigger`);
        const laid = new Set(fx.layout(id).filter((e) => e.layer !== 'base').map((e) => e.rel));
        for (const o of t.oracle) assert.ok(laid.has(o), `${id} oracle ${o} is laid by files/`);
        for (const r of t.rows) assert.ok(['session', 'seat'].includes(t.expect.A[r]) && ['session', 'seat'].includes(t.expect.B[r]), `${id} row ${r} expect`);
        assert.ok(Array.isArray(t.expect.notSeparatedIfSeat), `${id} notSeparatedIfSeat`);
    }
});

// Rows 1-3 are reached only on a `standard` or larger plan (D8 spec, 'Where the size line falls'); a `small` one
// designs, builds and verifies inline. The probe of 2026-11-04 asked for a change a model can make in two files, sized
// itself small, and never reached a row it was built to read. The request's own floor is the one size no run can go
// under, so every /task-solve task reading rows 1-3 floors at standard by task-solve's spec-check. t3 is left out: its
// rows come from a second /task-solve call whose request is the diagnosis, unknown until the run makes it - its calibration
// run reads that size (plan Task 9 Step 3).
test('a task that reads rows 1-3 floors at standard by its request alone', () =>
{
    const { classify } = require(path.join(ROOT, 'stack', 'skills', 'task-solve', 'scripts', 'spec-check.js'));
    for (const id of fx.list())
    {
        const t = fx.loadTask(id);
        if (!t.prompt.startsWith('/task-solve ') || !t.rows.some((r) => r <= 3)) continue;
        const floor = classify(t.prompt.replace(/^\/\S+ --mode-auto-run-on /, '')).sizeFloor;
        assert.strictEqual(floor, 'standard', `${id} floors at ${floor}`);
    }
});

test('t7 inherits t1 and runs on Fable', () =>
{
    const t1 = fx.loadTask('t1');
    const t7 = fx.loadTask('t7');
    assert.strictEqual(t7.prompt, t1.prompt);
    assert.strictEqual(t7.acceptance, t1.acceptance);
    assert.deepStrictEqual(t7.oracle, t1.oracle);
    assert.strictEqual(t7.model, 'claude-fable-5-1');
    assert.strictEqual(t1.model, 'claude-opus-5-5');
    assert.deepStrictEqual(t7.rows, [4, 1, 2, 3]);
    assert.deepStrictEqual(fx.layout('t7').map((e) => e.rel), fx.layout('t1').map((e) => e.rel));
});

test('no fixture file is a test the repo runs, a private name or a local path', () =>
{
    const dir = path.join(ROOT, 'scripts', 'fixtures', 'd8-ab');
    const files = fx.walk(dir);
    assert.ok(files.length > 10, 'the fixture tree is there');
    assert.deepStrictEqual(files.filter((f) => /\.test\.js$/.test(f)), []);
    let bytes = 0;
    for (const f of files)
    {
        const body = fs.readFileSync(path.join(dir, f), 'utf8');
        bytes += Buffer.byteLength(body);
        assert.ok(!/\/Users\/|C:\\\\Users|\/home\/[a-z]/.test(body), `${f} holds a local path`);
    }
    assert.ok(bytes < 600 * 1024, `the fixture tree is ${bytes} bytes, over 0.6 MB`);
});

test('build never lays reference/', () =>
{
    for (const id of fx.list())
    {
        const entries = fx.layout(id);
        assert.ok(entries.length > 0, id);
        assert.deepStrictEqual(entries.filter((e) => /(^|\/)reference\//.test(e.from) || e.layer === 'reference'), [], id);
        assert.ok(entries.every((e) => !e.rel.startsWith('reference/')), id);
    }
    assert.ok(fx.layout('t1', { reference: true }).some((e) => e.layer === 'reference'), 'check lays it on request');
});

test('JUDGE_EXCLUDES is the one list the diff and the tree leave out', () =>
{
    assert.deepStrictEqual(fx.JUDGE_EXCLUDES, ['.claude', '.alfred', 'node_modules', 'dist', '.angular', 'bin', 'obj', 'logs']);
});

test('a command line splits into argv steps, never a shell string', () =>
{
    assert.deepStrictEqual(fx.steps('npx ng build && npx ng test --watch=false'), [['npx', 'ng', 'build'], ['npx', 'ng', 'test', '--watch=false']]);
    assert.deepStrictEqual(fx.steps(''), []);
});

test('acceptance counts the passed tests from Vitest and dotnet output', () =>
{
    assert.strictEqual(fx.passedCount(' Test Files  1 passed (1)\n      Tests  2 passed (2)\n'), 2);
    assert.strictEqual(fx.passedCount('Passed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4'), 4);
    assert.strictEqual(fx.passedCount('No test matches the given testcase filter `FullyQualifiedName~X`'), 0);
    assert.strictEqual(fx.passedCount('\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m'), 5);
    assert.strictEqual(fx.passedCount('      Tests  2 failed | 3 passed (5)'), 3);
    const task = { acceptanceCount: 4 };
    assert.strictEqual(fx.acceptanceResult(0, 'No test matches the given testcase filter', task), false);
    assert.strictEqual(fx.acceptanceResult(0, 'Passed!  - Failed:     0, Passed:     4', task), true);
    assert.strictEqual(fx.acceptanceResult(1, 'Passed!  - Failed:     0, Passed:     4', task), false);
});

test('ingestLog is deterministic and near 300 KB', () =>
{
    const a = fx.ingestLog({ seed: 1101, lines: 4200 });
    const b = fx.ingestLog({ seed: 1101, lines: 4200 });
    assert.strictEqual(fx.sha256(a), fx.sha256(b));
    const bytes = Buffer.byteLength(a);
    assert.ok(bytes >= 280000 && bytes <= 320000, `${bytes} bytes`);
    const rows = a.split('\n').filter(Boolean);
    assert.strictEqual(rows.length, 4200);
    const quoted = rows.filter((l) => /^\S+Z,[^,]+,"[^"]*,[^"]*",/.test(l));
    assert.ok(quoted.length >= 60, `${quoted.length} quoted-comma lines`);
    const warns = rows.filter((l) => / WARN skipped line \d+: amount not a number$/.test(l));
    assert.strictEqual(warns.length, quoted.length, 'one WARN line per split record');
    for (const w of warns)
    {
        const n = Number(/skipped line (\d+)/.exec(w)[1]);
        assert.ok(quoted.includes(rows[n - 1]), `WARN line ${w} names the record it skipped`);
    }
    assert.notStrictEqual(fx.sha256(fx.ingestLog({ seed: 1102, lines: 4200 })), fx.sha256(a));
    const t3 = fx.loadTask('t3');
    assert.deepStrictEqual(t3.generate, [{ kind: 'ingestLog', path: 'logs/ingest-2026-11-01.log', seed: 1101, lines: 4200 }]);
    assert.ok(!fx.layout('t3').some((e) => e.rel.startsWith('logs/')), 'the log is generated, never tracked');
});

test('a red acceptance counts only when its tests ran and failed', () =>
{
    assert.strictEqual(fx.failedCount('      Tests  2 failed (2)'), 2);
    assert.strictEqual(fx.failedCount('Failed!  - Failed:     4, Passed:     0, Skipped:     0, Total:     4'), 4);
    assert.strictEqual(fx.failedCount('error TS2307: Cannot find module'), 0);
});
