'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cellPaths, runPaths, templatePaths, state, reset, partition } = require('./cells.js');

const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

function bench(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-cells-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const CELL = { run: 'r20260923', arm: 'ours', task: 'api-1', rep: 2 };

function holdLock(dir, pid)
{
    fs.mkdirSync(path.join(dir, '.lock'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.lock', 'pid'), `${pid}\n`);
}

test('the cell, run and template layout', (t) =>
{
    const b = bench(t);
    const c = cellPaths({ benchDir: b, ...CELL });
    const rel = (p) => path.relative(b, p).split(path.sep).join('/');
    assert.strictEqual(rel(c.work), 'work/r20260923/ours/api-1/r2');
    assert.deepStrictEqual([c.config, c.home, c.repo].map(rel), ['config', 'home', 'repo'].map((d) => `work/r20260923/ours/api-1/r2/${d}`));
    assert.strictEqual(rel(c.results), 'results/r20260923/ours/api-1/r2');
    assert.deepStrictEqual(
        [c.transcript, c.subagents, c.stdout, c.stderr, c.diff, c.session].map((p) => path.basename(p)),
        ['transcript.jsonl', 'subagents', 'stdout.jsonl', 'stderr.log', 'diff.patch', 'session.json']);
    const r = runPaths({ benchDir: b, run: CELL.run });
    assert.deepStrictEqual([r.dir, r.runJson, r.prices].map(rel), ['results/r20260923', 'results/r20260923/run.json', 'results/r20260923/prices.json']);
    const tp = templatePaths({ benchDir: b, arm: 'ours', hash: 'abcdef0123456789' });
    assert.strictEqual(rel(tp.dir), 'work/templates/ours-abcdef01');
    assert.deepStrictEqual([tp.config, tp.home, tp.repo, tp.src].map((p) => path.basename(p)), ['config', 'home', 'repo', 'src']);
});

test('a name that could leave its directory, and a rep that is not a count, are refused', (t) =>
{
    const b = bench(t);
    for (const bad of ['..', '.', '', 'a/b', 'a\\b', '../x'])
    {
        assert.throws(() => cellPaths({ benchDir: b, ...CELL, task: bad }), /task/);
        assert.throws(() => runPaths({ benchDir: b, run: bad }), /run/);
    }
    assert.throws(() => cellPaths({ benchDir: b, ...CELL, rep: 0 }), /rep/);
    assert.throws(() => cellPaths({ benchDir: b, ...CELL, rep: 1.5 }), /rep/);
    assert.throws(() => templatePaths({ benchDir: b, arm: 'ours', hash: 'xyz' }), /hash/);
});

test('state: nothing is todo, a complete session.json is done, a truncated one is todo', (t) =>
{
    const b = bench(t);
    const c = cellPaths({ benchDir: b, ...CELL });
    assert.strictEqual(state(c), 'todo');
    fs.mkdirSync(c.results, { recursive: true });
    fs.writeFileSync(c.transcript, '{}\n');
    assert.strictEqual(state(c), 'todo');
    fs.writeFileSync(c.session, '{"outcome":"ok"');
    assert.strictEqual(state(c), 'todo');
    fs.writeFileSync(c.session, '{"outcome":"ok"}');
    assert.strictEqual(state(c), 'done');
});

test('state: a cell lock held by a live pid is live, by a dead pid is todo', (t) =>
{
    const b = bench(t);
    const c = cellPaths({ benchDir: b, ...CELL });
    holdLock(c.results, process.pid);
    assert.strictEqual(state(c), 'live');
    holdLock(c.results, deadPid());
    assert.strictEqual(state(c), 'todo');
});

test('reset wipes a todo cell\'s work and results, and refuses a live or a done one', (t) =>
{
    const b = bench(t);
    const c = cellPaths({ benchDir: b, ...CELL });
    const sibling = cellPaths({ benchDir: b, ...CELL, rep: 3 });
    for (const d of [c.repo, c.results, sibling.repo]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(c.repo, 'half-done.txt'), 'x');
    holdLock(c.results, deadPid());
    reset(c);
    assert.ok(!fs.existsSync(c.work) && !fs.existsSync(c.results));
    assert.ok(fs.existsSync(sibling.repo), 'a sibling cell is untouched');

    holdLock(c.results, process.pid);
    assert.throws(() => reset(c), /live/);
    assert.ok(fs.existsSync(path.join(c.results, '.lock')));
    fs.rmSync(path.join(c.results, '.lock'), { recursive: true });
    fs.writeFileSync(c.session, '{}');
    assert.throws(() => reset(c), /done/);
    assert.ok(fs.existsSync(c.session));
});

test('partition sorts a run\'s cells for a resume: only todo runs, live is never touched', (t) =>
{
    const b = bench(t);
    const cells = [1, 2, 3].map((rep) => cellPaths({ benchDir: b, ...CELL, rep }));
    fs.mkdirSync(cells[0].results, { recursive: true });
    fs.writeFileSync(cells[0].session, '{}');
    holdLock(cells[1].results, process.pid);
    const p = partition(cells);
    assert.deepStrictEqual([p.done.length, p.live.length, p.todo.length], [1, 1, 1]);
    assert.strictEqual(p.todo[0].rep, 3);
});
