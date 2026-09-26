'use strict';
// Runs a queue with up to `parallel` concurrent workers, front to back, except an item whose
// exclusiveKey matches another item's already in flight is skipped until that one finishes: devops-01
// built and removed the shared Docker tag `lendingdesk-worker` within 19 s across three arms on the
// same daemon in pilot 2 - a race the pool now rules out rather than the task's own session having to.
// A worker that finds only exclusive-blocked items left WAITS rather than exits: the queue is not
// empty, just not ready for this worker, and exiting early would leave those cells unrun.
function run({ queue, parallel, exclusiveKey = () => null, task, stop = () => false })
{
    const running = new Set();
    let waiters = [];
    const wake = () => { const woken = waiters; waiters = []; for (const resolve of woken) resolve(); };
    const waitForChange = () => new Promise((resolve) => waiters.push(resolve));

    function take()
    {
        for (let i = 0; i < queue.length; i++)
        {
            const key = exclusiveKey(queue[i]);
            if (key && running.has(key)) continue;
            const [item] = queue.splice(i, 1);
            if (key) running.add(key);
            return { item, key };
        }
        return null;
    }

    async function worker()
    {
        while (queue.length && !stop())
        {
            const got = take();
            if (!got) { await waitForChange(); continue; }
            try { await task(got.item); }
            finally
            {
                if (got.key) running.delete(got.key);
                wake();
            }
        }
    }

    return Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
}

module.exports = { run };
