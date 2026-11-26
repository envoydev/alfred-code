'use strict';

// Runs `start` once the legs that share the host's CPU have finished. The win leg's test run took 36 minutes alone
// and passed its 45-minute limit with the mac and linux legs running beside it (2026-11-26). `start` is where the
// leg's timer begins, so the wait is never part of the limit. Where no other leg runs, nothing waits and nothing prints.
async function runAfterOthers({ leg, others, finished, start, say = console.log })
{
    if (others.length === 0) return start();
    say(`  [${leg}] waiting for ${others.join(', ')} to finish`);
    await finished();
    say(`  [${leg}] running`);
    return start();
}

module.exports = { runAfterOthers };
