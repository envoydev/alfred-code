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
const { proveTasks, DROP } = require('./prove-tasks.js');
const { makeWorld } = require('./test/world.js');

const addFile = (name, body) => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+${body}\n`;
const EDIT_APP = 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-app\n+broken\n';
const HIDDEN = { hidden: [['node', 'check.js']], suite: [['node', '-e', "process.exit(require('fs').readFileSync('app.txt', 'utf8') === 'app\\n' ? 0 : 1)"]], timeoutMin: 1 };
const CHECK = "process.exit(require('fs').existsSync('made.txt') ? 0 : 1);\n";

test('the proof drops every name common.json keeps from a session, both docs-path spellings included', () =>
{
    const common = JSON.parse(fs.readFileSync(path.join(__dirname, 'arms', 'common.json'), 'utf8'));
    assert.deepStrictEqual([...DROP].sort(), [...common.auth, ...common.scrub].sort());
    for (const name of ['CLAUDE_STACK_DOCS_PATH', 'ALFRED_CODE_DOCS_PATH', 'ANTHROPIC_API_KEY']) assert.ok(DROP.includes(name), name); // legacy-name
});

function world(t, tasks)
{
    const spec = {};
    for (const [id, { reference, check = CHECK, setup, files = {} }] of Object.entries(tasks))
    {
        spec[id] = { grade: HIDDEN, hidden: { 'check.js': check }, setup, files: { ...files, ...(reference ? { 'reference.patch': reference } : {}) } };
    }
    const w = makeWorld(t, { arms: {}, tasks: spec });
    w.prove = (ids = 'all') => proveTasks({ tasksDir: w.opts.tasksDir, tasks: ids, benchDir: w.bench, fixtureSource: w.opts.fixtureSource, lock: w.opts.lock, base: { PATH: process.env.PATH }, log: () => {} });
    return w;
}

test('a task whose hidden tests fail at the start and pass on its reference, suite green, is proven', (t) =>
{
    const w = world(t, { good: { reference: addFile('made.txt', 'done') } });
    const [r] = w.prove().tasks;
    assert.deepStrictEqual([r.id, r.ok, r.startFails, r.referencePasses, r.suiteGreen, r.problems], ['good', true, true, true, true, []]);
});

test('each way a task can be unprovable is named', (t) =>
{
    const w = world(t, {
        'passes-untouched': { reference: addFile('made.txt', 'done'), check: 'process.exit(0);\n' },
        'wrong-reference': { reference: addFile('other.txt', 'done') },
        'breaks-suite': { reference: addFile('made.txt', 'done') + EDIT_APP },
        'no-reference': {},
    });
    const by = Object.fromEntries(w.prove().tasks.map((r) => [r.id, r]));
    assert.deepStrictEqual(by['passes-untouched'].problems, ['the hidden tests pass on the untouched start']);
    assert.deepStrictEqual(by['wrong-reference'].problems, ['the hidden tests fail on the reference']);
    assert.deepStrictEqual(by['breaks-suite'].problems, ['the reference breaks the suite']);
    assert.deepStrictEqual(by['no-reference'].problems, ['no reference.patch']);
    for (const r of Object.values(by)) assert.strictEqual(r.ok, false);
});

test('the start state includes the task setup, and a reference that no longer applies is named', (t) =>
{
    const w = world(t, {
        dirty: {
            setup: [{ patch: 'wip.patch' }],
            files: { 'wip.patch': addFile('wip.txt', 'unsaved') },
            check: "process.exit(require('fs').existsSync('made.txt') && require('fs').existsSync('wip.txt') ? 0 : 1);\n",
            reference: addFile('made.txt', 'done'),
        },
        stale: { reference: 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-never\n+x\n' },
    });
    const by = Object.fromEntries(w.prove().tasks.map((r) => [r.id, r]));
    assert.strictEqual(by.dirty.ok, true);
    assert.match(by.stale.problems[0], /^reference\.patch does not apply/);
});

test('a task carrying a trap.patch is proven only when its hidden tests also fail on the trap', (t) =>
{
    const w = world(t, {
        caught: { reference: addFile('made.txt', 'done'), files: { 'trap.patch': addFile('other.txt', 'naive') } },
        missed: { reference: addFile('made.txt', 'done'), files: { 'trap.patch': addFile('made.txt', 'naive') } },
        stale: { reference: addFile('made.txt', 'done'), files: { 'trap.patch': 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-never\n+x\n' } },
        plain: { reference: addFile('made.txt', 'done') },
    });
    const by = Object.fromEntries(w.prove().tasks.map((r) => [r.id, r]));
    assert.deepStrictEqual([by.caught.ok, by.caught.trapFails, by.caught.problems], [true, true, []]);
    assert.deepStrictEqual([by.missed.ok, by.missed.trapFails, by.missed.problems], [false, false, ['the hidden tests pass on trap.patch - the trap is not caught']]);
    assert.strictEqual(by.stale.ok, false);
    assert.match(by.stale.problems[0], /^trap\.patch does not apply/);
    assert.deepStrictEqual([by.plain.ok, by.plain.trapFails], [true, null], 'a task with no trap.patch is proven as before');
});

test('the proof writes its table under results and leaves no work dir behind', (t) =>
{
    const w = world(t, { good: { reference: addFile('made.txt', 'done') } });
    const out = w.prove();
    assert.ok(out.dir.startsWith(path.join(w.bench, 'results', 'prove-')));
    const table = fs.readFileSync(path.join(out.dir, 'prove.md'), 'utf8');
    assert.match(table, /\| good \| yes \| yes \| yes \| yes \| - \|/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out.dir, 'prove.json'), 'utf8')).tasks.map((r) => r.id), ['good']);
    assert.ok(!fs.existsSync(path.join(w.bench, 'work', 'prove')));
});
