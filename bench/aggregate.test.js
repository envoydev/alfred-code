'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { aggregate } = require('./aggregate.js');

const PREREG = '# Pre-registration\n\nThe metrics and the decision rule, frozen.\n';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// passes[arm][task] = how many of the 3 reps pass; cost[arm] = each cell's cost.
function syntheticRun(t, { passes, cost, run = 'r-syn', model = 'claude-sonnet-5', prereg = PREREG, ungraded = null, infra = null })
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-agg-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bench = path.join(dir, 'bench');
    const runDir = path.join(bench, 'results', run);
    fs.mkdirSync(runDir, { recursive: true });
    const preregFile = path.join(bench, 'PREREGISTRATION.md');
    fs.writeFileSync(preregFile, PREREG);
    const tasks = [
        { id: 'api-1', group: 'api', tags: [] }, { id: 'api-2', group: 'api', tags: [] },
        { id: 'web-1', group: 'web', tags: [] }, { id: 'web-2', group: 'web', tags: [] },
        { id: 'guard-1', group: 'guard', tags: ['guard'] }, { id: 'home-1', group: 'api', tags: ['home-advantage'] },
    ];
    const arms = Object.keys(passes);
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
        run, mode: 'plain', model, effort: 'medium', seed: 1, reps: 3, cliVersion: 'x', harnessCommit: null,
        arms: arms.map((name) => ({ name, pin: { kind: 'tag', value: 'v' }, hash: 'a'.repeat(64) })),
        tasks: tasks.map((x) => ({ ...x, timeLimitMin: 30, startRef: 'bench-fixture-v1', promptSha256: 'b' })),
        fixture: { tag: 'bench-fixture-v1', commit: 'c'.repeat(40) }, prereg: prereg === null ? null : { sha256: sha(prereg) }, prices: { file: 'prices.json', sha256: 'd' }, drives: [],
    }));
    for (const arm of arms) for (const task of tasks) for (let rep = 1; rep <= 3; rep++)
    {
        const cellDir = path.join(runDir, arm, task.id, `r${rep}`);
        fs.mkdirSync(cellDir, { recursive: true });
        fs.writeFileSync(path.join(cellDir, 'session.json'), JSON.stringify({ outcome: 'ok', wallMs: 1000 * rep }));
        if (ungraded === `${arm}/${task.id}/r${rep}`) continue;
        const pass = rep <= ((passes[arm] || {})[task.id] || 0);
        const isInfra = infra === `${arm}/${task.id}/r${rep}`;
        fs.writeFileSync(path.join(cellDir, 'grade.json'), JSON.stringify({ hiddenPass: pass, suiteGreen: true, infra: isInfra ? 'mass connection failure: 60 failing tests' : null }));
    }
    const metricsFn = (cell) => ({ outcome: 'ok', wallMs: 1000, costUsd: cost[cell.arm], unpriced: [], turns: 10, toolCalls: 20, peakCtx: 50000, netLines: 40, newDeps: [], checkWeakening: [], credentials: { count: 0, files: [] }, destructive: { attempted: 0, blocked: 0, commands: [] }, doneWithoutCheck: false });
    const onboardingFn = (arm) => ({ ours: 2.4, ecc: 1.2, bare: 0.12 }[arm] || 0);
    return { bench, runDir, preregFile, run, go: (extra = {}) => aggregate({ benchDir: bench, run, preregFile, metricsFn, onboardingFn, ...extra }) };
}

const ALL = (n) => ({ 'api-1': n, 'api-2': n, 'web-1': n, 'web-2': n, 'guard-1': n, 'home-1': n });

test('refuses without a pre-registration, or when it changed since the run started', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    fs.writeFileSync(r.preregFile, `${PREREG}An afterthought.\n`);
    assert.throws(() => r.go(), /PREREGISTRATION\.md changed since r-syn started/);
    fs.rmSync(r.preregFile);
    assert.throws(() => r.go(), /no bench\/PREREGISTRATION\.md/);
    const none = syntheticRun(t, { passes: { ours: ALL(3) }, cost: { ours: 1 }, prereg: null });
    assert.throws(() => none.go(), /r-syn recorded no pre-registration/);
});

test('a partial run says so at the top, per arm, and counts the cells a usage limit set aside', (t) =>
{
    const s = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    fs.rmSync(path.join(s.runDir, 'ours', 'api-1', 'r3', 'session.json'));
    for (const [arm, n] of [['ours', 1], ['bare', 2]]) for (let i = 0; i < n; i++)
    {
        const d = path.join(s.runDir, 'limited', `${arm}-api-2-r1-2026092${i}T000000000Z`);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'session.limited.json'), JSON.stringify({ arm, task: 'api-2', rep: 1, outcome: 'limited' }));
    }
    const { report } = s.go();
    assert.match(report, /\*\*PARTIAL RUN: 1 of 36 cells unfinished \(ours 1, bare 0\) - the rates below cover finished cells only; finish it with --resume before reading a verdict\.\*\*/);
    assert.match(report, /set aside by a usage limit and re-run: ours 1, bare 2/);
});

test('a complete run carries no partial line, and says no cell was set aside', (t) =>
{
    const s = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    const { report } = s.go();
    assert.ok(!/PARTIAL RUN/.test(report));
    assert.match(report, /set aside by a usage limit and re-run: 0/);
});

test('refuses while a finished cell is still ungraded', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 }, ungraded: 'bare/web-1/r2' });
    assert.throws(() => r.go(), /1 finished cell is not graded - run grade\.js first/);
});

test('the headline verdict in the rule\'s own words, over the headline tasks only', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), ecc: { ...ALL(3), 'web-2': 2 }, bare: ALL(1) }, cost: { ours: 1.1, ecc: 1.0, bare: 1.0 } });
    const out = r.go();
    const report = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8');
    assert.strictEqual(out.report, report);
    assert.match(report, /NO MEASURED DIFFERENCE between ours and ecc/);
    assert.match(report, /ours is BETTER than bare/);
    assert.match(report, /100% \(12\/12\)/, 'the headline counts 4 tasks x 3 reps - guard and home-advantage are not in it');
});

test('guard and home-advantage are their own tables and sentences, and each group gets its own table', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    const report = r.go().report;
    for (const h of ['## Headline tasks', '## Group: api', '## Group: web', '## guard tasks', '## home-advantage tasks']) assert.ok(report.includes(h), h);
    assert.match(report, /guard tasks: .*ours .* bare/);
    assert.match(report, /\| arm \| all-pass \| 90% interval \|/);
});

test('ours not better than bare leads the report, ahead of any ECC comparison', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(2), ecc: ALL(0), bare: ALL(2) }, cost: { ours: 1, ecc: 1, bare: 1 } });
    const report = r.go().report;
    const lead = report.indexOf('ours is not better than bare on the headline tasks - that is the finding');
    assert.ok(lead > 0);
    assert.ok(lead < report.indexOf('ours is BETTER than ecc'));
});

test('onboarding cost has its own column, amortized over the headline tasks', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    const report = r.go().report;
    assert.match(report, /\| ours \|[^\n]*\| \$2\.40 \| \$0\.60 \|/, 'ours: $2.40 over 4 headline tasks');
});

test('an infrastructure cell is excluded from the rate and counted apart', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 }, infra: 'ours/api-1/r1' });
    const out = r.go();
    assert.match(out.report, /100% \(11\/11\)/);
    assert.match(out.report, /infrastructure, excluded: 1 \(ours\/api-1\/r1\)/);
});

test('the three worst tasks per arm are listed for the next plan, reasons left to the transcript read', (t) =>
{
    const r = syntheticRun(t, { passes: { ours: { ...ALL(3), 'api-2': 0, 'web-1': 1, 'web-2': 2 }, bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    const report = r.go().report;
    const block = report.slice(report.indexOf('## Worst three tasks'));
    assert.match(block, /ours: api-2 \(0\/3\), web-1 \(1\/3\), web-2 \(2\/3\)/);
});

test('a reference run renders in its own section and is never merged into the headline', (t) =>
{
    const main = syntheticRun(t, { passes: { ours: ALL(3), bare: ALL(1) }, cost: { ours: 1, bare: 1 } });
    const ref = syntheticRun(t, { passes: { bare: ALL(3) }, cost: { bare: 5 }, run: 'r-opus', model: 'claude-opus-5-5' });
    fs.cpSync(ref.runDir, path.join(main.bench, 'results', 'r-opus'), { recursive: true });
    const report = main.go({ reference: 'r-opus' }).report;
    assert.match(report, /## Reference: r-opus \(claude-opus-5-5\)/);
    assert.match(report.slice(0, report.indexOf('## Reference')), /ours is BETTER than bare/);
});
