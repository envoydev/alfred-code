'use strict';

// The test workers a VM leg runs: the host's share, capped at the guest's CPUs less one - the default node --test takes
// on a CI runner. The win leg alone on a 12-core Mac took 11 workers on 6 vCPUs, and six hook-budget tests ran red that
// pass alone (2026-11-24).
function guestWorkers(hostShare, guestCpus)
{
    if (!Number.isInteger(guestCpus) || guestCpus < 1) return hostShare;
    return Math.max(1, Math.min(hostShare, guestCpus - 1));
}

module.exports = { guestWorkers };
