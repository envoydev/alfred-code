'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('./pool.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an exclusive key never runs two items at once; a key-less item keeps its own parallelism', async () =>
{
    const queue = [
        { id: 'x1', key: 'devops-01' },
        { id: 'x2', key: 'devops-01' },
        { id: 'p1', key: null },
        { id: 'p2', key: null },
    ];
    const windows = [];
    const task = async (item) =>
    {
        const start = Date.now();
        await wait(30);
        windows.push({ id: item.id, key: item.key, start, end: Date.now() });
    };
    await run({ queue, parallel: 4, exclusiveKey: (item) => item.key, task });
    assert.strictEqual(windows.length, 4);
    const byKey = (k) => windows.filter((w) => w.key === k);
    const [a, b] = byKey('devops-01');
    assert.ok(a.end <= b.start, 'the second exclusive item starts only after the first ends');
    const free = byKey(null);
    const exclusiveSpan = [Math.min(...byKey('devops-01').map((w) => w.start)), Math.max(...byKey('devops-01').map((w) => w.end))];
    assert.ok(free.some((w) => w.start < exclusiveSpan[1] && w.end > exclusiveSpan[0]), 'a key-less item overlapped the exclusive pair - exclusivity never serialized the whole run');
});

test('a worker with nothing else to take waits for the key to free, instead of ending the pool early', async () =>
{
    const queue = [{ id: 'x1', key: 'k' }, { id: 'x2', key: 'k' }];
    const seen = [];
    const task = async (item) => { seen.push(item.id); await wait(10); };
    await run({ queue, parallel: 2, exclusiveKey: (item) => item.key, task });
    assert.deepStrictEqual(seen, ['x1', 'x2']);
});

test('stop() is read before every dequeue, never mid-item - an item already running finishes', async () =>
{
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    let stop = false;
    const started = [];
    const task = async (item) => { started.push(item.id); stop = item.id === 'a'; await wait(5); };
    await run({ queue, parallel: 1, exclusiveKey: () => null, task, stop: () => stop });
    assert.deepStrictEqual(started, ['a']);
    assert.deepStrictEqual(queue.map((i) => i.id), ['b', 'c'], 'the unstarted items are left in the queue for a resume');
});

test('parallel is capped at the queue length, and an empty queue runs no worker', async () =>
{
    let calls = 0;
    await run({ queue: [], parallel: 3, exclusiveKey: () => null, task: async () => { calls += 1; } });
    assert.strictEqual(calls, 0);
    const queue = [{ id: 'a' }];
    const seen = [];
    await run({ queue, parallel: 3, exclusiveKey: () => null, task: async (i) => seen.push(i.id) });
    assert.deepStrictEqual(seen, ['a']);
});

test('a key-less item never waits behind another key-less item\'s slot', async () =>
{
    const queue = [{ id: 'a', key: null }, { id: 'b', key: null }, { id: 'c', key: null }];
    const started = [];
    const task = async (item) => { started.push(item.id); await wait(15); };
    await run({ queue, parallel: 3, exclusiveKey: (item) => item.key, task });
    assert.deepStrictEqual(started.sort(), ['a', 'b', 'c']);
});
