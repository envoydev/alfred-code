// The installer's exclusive-create lock (scripts/install/file-lock.js): a stale lock it cannot remove - a directory
// named like the lock, a dangling link - must end the wait after `retryMs`, never spin (R065).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STEP_MS, takeLock } = require('./install/file-lock.js');
const ws = require('./install/workspace.js');
const variables = require('./install/variables.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const fresh = () => fs.mkdtempSync(path.join(TMP, 'p-'));

// A fake clock whose sleep advances it. A loop that reads it 10000 times without sleeping is a spin: the clock then
// removes the lock, so the spin ends in a taken lock the test reports, never a hang (takeLock's own catch would swallow a
// throw from it). A link goes by unlink: rmSync's force reads a dangling one as absent.
const clock = (lock) =>
{
    const state = { t: Date.now(), reads: 0, spun: false };
    return {
        state,
        now: () =>
        {
            state.reads += 1;
            if (lock && state.reads > 10000 && !state.spun) { state.spun = true; try { fs.unlinkSync(lock); } catch { fs.rmSync(lock, { recursive: true, force: true }); } }
            return state.t;
        },
        sleep: (ms) => { state.reads = 0; state.t += ms; },
    };
};
const RETRY = 2000;
const STALE = 30000;
const oldDirLock = (lock) =>
{
    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 10 * STALE);
    fs.utimesSync(lock, old, old);
    return lock;
};
const danglingLock = (lock) =>
{
    try { fs.symlinkSync(path.join(path.dirname(lock), 'gone-target'), lock); return true; }
    catch { return false; }
};

test('R065: takeLock gives up after retryMs on a lock it cannot remove - a directory named like the lock', () =>
{
    const lock = oldDirLock(path.join(fresh(), 'x.lock'));
    const c = clock(lock);
    const start = c.state.t;
    assert.strictEqual(takeLock(lock, { now: c.now, sleep: c.sleep, retryMs: RETRY, staleMs: STALE }), false);
    assert.ok(c.state.t - start <= RETRY + STEP_MS, `waited ${c.state.t - start} ms`);
    assert.ok(fs.statSync(lock).isDirectory(), 'the directory is left as it was');
});

test('R065: takeLock gives up after retryMs on a dangling link lock', (t) =>
{
    const lock = path.join(fresh(), 'x.lock');
    if (!danglingLock(lock)) return t.skip('this host cannot make a link');
    const c = clock(lock);
    const start = c.state.t;
    assert.strictEqual(takeLock(lock, { now: c.now, sleep: c.sleep, retryMs: RETRY, staleMs: STALE }), false);
    assert.ok(c.state.t - start <= RETRY + STEP_MS, `waited ${c.state.t - start} ms`);
});

test('R065: takeLock still takes over a stale lock file and takes a free one at once', () =>
{
    const root = fresh();
    const lock = path.join(root, 'x.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 10 * STALE);
    fs.utimesSync(lock, old, old);
    const c = clock();
    assert.strictEqual(takeLock(lock, { now: c.now, sleep: c.sleep, retryMs: RETRY, staleMs: STALE }), true);
    fs.rmSync(lock);
    assert.strictEqual(takeLock(lock, { now: c.now, sleep: c.sleep, retryMs: RETRY, staleMs: STALE }), true);
});

test('R065: the workspace file\'s writer handed a lock it cannot take reports it busy and writes nothing', () =>
{
    const root = fresh();
    fs.mkdirSync(path.join(root, '.alfred'));
    oldDirLock(path.join(root, '.alfred', 'workspace.lock'));
    const c = clock(path.join(root, '.alfred', 'workspace.lock'));
    const r = ws.writeWorkspace(root, (m) => { m.entries.push({ kind: 'child', value: 'api', raw: 'child api' }); }, { now: c.now, sleep: c.sleep });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.why, 'locked');
    assert.strictEqual(fs.existsSync(path.join(root, '.alfred', 'workspace')), false, 'nothing written');
});

test('R065: the .variables writer handed a lock it cannot take reports it busy and writes nothing', () =>
{
    const root = fresh();
    const file = path.join(root, '.alfred', '.variables');
    fs.mkdirSync(path.dirname(file));
    oldDirLock(`${file}.lock`);
    const c = clock(`${file}.lock`);
    const r = variables.write(file, { ALFRED_CODE_HISTORY: '3' }, { now: c.now, sleep: c.sleep });
    assert.deepStrictEqual(r, { changed: false, why: 'locked' });
    assert.strictEqual(fs.existsSync(file), false, 'nothing written');
});
