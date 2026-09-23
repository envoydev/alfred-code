'use strict';
// One scripted run through all three scripts - drive, grade, aggregate - on the fake CLI and the
// REAL fixture tag: a hidden test that passes and one that fails, graded and reported.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { POSIX_ONLY } = require('./test/posix-only.js');
const { makeWorld, AUTH } = require('./test/world.js');
const fixture = require('./fixture/verify.js');

const ROOT = path.join(__dirname, '..');
function tagMissing()
{
    try { execFileSync('git', ['-C', ROOT, 'rev-parse', '-q', '--verify', `refs/tags/${fixture.TAG}`], { stdio: 'pipe' }); return false; }
    catch { return `the ${fixture.TAG} tag is not in this clone - the end-to-end run is NOT RUN here`; }
}

const check = (file) => `process.exit(require('fs').existsSync(${JSON.stringify(file)}) ? 0 : 1);\n`;

test('drive, grade and aggregate, end to end on the real fixture', { skip: POSIX_ONLY || tagMissing() }, async (t) =>
{
    const { drive } = require('./drive.js');
    const { gradeRun } = require('./grade.js');
    const { aggregate } = require('./aggregate.js');
    const lock = fixture.parseLock(fs.readFileSync(fixture.LOCK_FILE, 'utf8'));
    const w = makeWorld(t, {
        fixture: { source: ROOT, lock },
        arms: { ours: { env: { FAKE_EDIT: 'made.txt', FAKE_LEAK: '1' }, onboarding: ['/init'] }, bare: { env: { FAKE_EDIT: 'made.txt' } } },
        tasks: {
            'pass-1': { group: 'api', grade: { hidden: [['node', 'hidden-pass.js']], suite: [['node', '-e', '0']], timeoutMin: 2 }, hidden: { 'hidden-pass.js': check('made.txt') } },
            'fail-1': { group: 'api', grade: { hidden: [['node', 'hidden-fail.js']], suite: [['node', '-e', '0']], timeoutMin: 2 }, hidden: { 'hidden-fail.js': check('never.txt') } },
        },
    });
    const prereg = path.join(w.bench, 'PREREGISTRATION.md');
    fs.writeFileSync(prereg, '# Pre-registration\n\nFrozen for the end-to-end test.\n');

    const d = await drive(w.opts);
    assert.deepStrictEqual([d.ran, d.failed], [4, 0]);
    const tpl = fs.readdirSync(path.join(w.bench, 'work', 'templates')).find((x) => x.startsWith('ours-') && !x.endsWith('.log'));
    assert.strictEqual(execFileSync('git', ['-C', path.join(w.bench, 'work', 'templates', tpl, 'repo'), 'rev-parse', 'HEAD'], { stdio: 'pipe' }).toString().trim(), lock.commit, 'the template is the locked fixture commit');

    const g = gradeRun({ benchDir: w.bench, run: 'r-test', armsDir: w.opts.armsDir, tasksDir: w.opts.tasksDir, base: w.opts.base, log: () => {} });
    assert.deepStrictEqual([g.graded, g.infra], [4, 0]);
    const grade = (arm, task) => JSON.parse(fs.readFileSync(path.join(w.runDir, arm, task, 'r1', 'grade.json'), 'utf8'));
    assert.deepStrictEqual([grade('ours', 'pass-1').hiddenPass, grade('ours', 'fail-1').hiddenPass, grade('bare', 'pass-1').hiddenPass], [true, false, true]);

    const { report, onboarding } = aggregate({ benchDir: w.bench, run: 'r-test', preregFile: prereg });
    assert.match(report, /\| ours \| 50% \(1\/2\)/);
    assert.match(report, /NO MEASURED DIFFERENCE between ours and bare|ours is not better than bare/);
    assert.ok(onboarding.ours > 0, 'onboarding cost priced from the real transcript');
    assert.strictEqual(onboarding.bare, 0, 'an arm with no onboarding pays none');
    assert.doesNotMatch(report.split('\n').find((l) => l.startsWith('| ours | ')), /\$0\.00 /, 'a cost under a cent is shown, not rounded to nothing');
    const metrics = JSON.parse(fs.readFileSync(path.join(w.runDir, 'metrics.json'), 'utf8'));
    assert.ok(metrics.every((m) => m.costUsd > 0 && m.turns >= 1), `every cell priced by the analyzer: ${JSON.stringify(metrics.map((m) => [m.id, m.costUsd, m.turns, m.unpriced]))}`);

    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(w.runDir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(AUTH), `${path.relative(w.runDir, f)} carries the auth value`);
    assert.ok(!fs.existsSync(path.join(w.bench, 'work', 'r-test')), 'no cell work dir survives');
});

test('the three command lines name a bad invocation and exit 2', () =>
{
    const run = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8' });
    const drive = run('drive.js', ['--rep', '3']);
    assert.deepStrictEqual([drive.status, /unknown argument --rep/.test(drive.stderr)], [2, true]);
    const grade = run('grade.js', []);
    assert.deepStrictEqual([grade.status, /usage: grade\.js <run-id>/.test(grade.stderr)], [2, true]);
    const agg = run('aggregate.js', []);
    assert.deepStrictEqual([agg.status, /usage: aggregate\.js <run-id>/.test(agg.stderr)], [2, true]);
});
