'use strict';
// The run order. Seeded, so a run replays cell for cell; interleaved, so every arm meets the same
// stretch of the day - one block per (task, rep), each block holding every arm once, the blocks and
// the arm order inside each block both drawn from the seed.

// mulberry32: a small, fixed 32-bit generator. Fixed matters more than good here - a changed
// generator would silently reorder every run already recorded under its seed.
function mulberry32(seed)
{
    let a = seed | 0;
    return () =>
    {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Fisher-Yates over a copy.
function shuffled(list, rand)
{
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--)
    {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function cells({ arms, tasks, reps, seed })
{
    if (!Array.isArray(arms) || !arms.length) throw new Error('shuffle: arms must be a non-empty list');
    if (new Set(arms).size !== arms.length) throw new Error('shuffle: an arm is named twice');
    if (!Array.isArray(tasks) || !tasks.length) throw new Error('shuffle: tasks must be a non-empty list');
    if (!Number.isInteger(reps) || reps < 1) throw new Error('shuffle: reps must be a whole number of at least 1');
    const rand = mulberry32(seed);
    const blocks = [];
    for (const task of tasks) for (let rep = 1; rep <= reps; rep++) blocks.push({ task, rep });
    const order = [];
    for (const { task, rep } of shuffled(blocks, rand))
        for (const arm of shuffled(arms, rand)) order.push({ arm, task, rep });
    return order;
}

module.exports = { cells, mulberry32 };
