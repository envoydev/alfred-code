'use strict';
// One driver per run, and one worker per cell: a second driver on the same run would run cells twice
// and bill them twice. A lock whose holder died (a killed driver, a reboot) must not block the resume.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { acquire, release, holder } = require('./lock.js');

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lock-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A pid that is certainly dead: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

test('lock: the first acquire takes it and records our pid', () =>
{
    const dir = tmp();
    assert.deepStrictEqual(acquire(dir), { ok: true, reclaimed: null });
    assert.strictEqual(holder(dir), process.pid);
});

test('lock: a second driver is refused while the holder lives, and told who holds it', () =>
{
    const dir = tmp();
    acquire(dir);
    const second = acquire(dir, { pid: process.pid + 100000 });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.holder, process.pid);
});

test('lock: a lock left by a dead pid is reclaimed, and the reclaim is reported', () =>
{
    const dir = tmp();
    const dead = deadPid();
    fs.mkdirSync(path.join(dir, '.lock'));
    fs.writeFileSync(path.join(dir, '.lock', 'pid'), `${dead}\n`);
    assert.deepStrictEqual(acquire(dir), { ok: true, reclaimed: dead });
    assert.strictEqual(holder(dir), process.pid);
});

test('lock: a lock with no readable pid is live while fresh (mid-creation), reclaimed once stale', () =>
{
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '.lock'));
    assert.strictEqual(acquire(dir).ok, false);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, '.lock'), old, old);
    const again = acquire(dir);
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.reclaimed, 'unreadable');
});

test('lock: release removes only its own lock', () =>
{
    const dir = tmp();
    acquire(dir);
    assert.strictEqual(release(dir, { pid: process.pid + 100000 }), false);
    assert.ok(fs.existsSync(path.join(dir, '.lock')));
    assert.strictEqual(release(dir), true);
    assert.ok(!fs.existsSync(path.join(dir, '.lock')));
    assert.strictEqual(release(dir), false, 'releasing an absent lock is a no-op');
});
