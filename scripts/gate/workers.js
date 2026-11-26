'use strict';

// The test workers a VM leg runs: the host's share, capped at the guest's CPUs less one - the default node --test takes
// on a CI runner. The win leg alone on a 12-core Mac took 11 workers on 6 vCPUs, and six hook-budget tests ran red that
// pass alone (2026-11-24).
function guestWorkers(hostShare, guestCpus)
{
    if (!Number.isInteger(guestCpus) || guestCpus < 1) return hostShare;
    return Math.max(1, Math.min(hostShare, guestCpus - 1));
}

// The test workers per leg, near the 3 a runner has. The mac and linux legs run together and split the host's cores;
// the win leg starts after them and has the cores to itself, as it did when it ran alone (2026-11-26).
function hostShares(cores, legs)
{
    const alone = Math.max(1, cores - 1);
    const others = legs.filter((leg) => leg !== 'win').length;
    return { others: others > 1 ? Math.max(1, Math.floor(alone / others)) : alone, win: alone };
}

module.exports = { guestWorkers, hostShares };
