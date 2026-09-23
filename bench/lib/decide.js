'use strict';
// The decision rule, as pre-registered before any result existed:
//   an arm is BETTER than another when its all-pass rate is higher by at least 15 percentage points
//   AND the 90% Wilson intervals of the two rates do not overlap AND its mean cost is not more than
//   25% higher. Anything else is NO MEASURED DIFFERENCE, in those words.
//   If `ours` is not better than `bare` on the headline, that is the finding, and it outranks any
//   comparison with ECC.
// The point difference is compared in integers, so exactly 15 points is never lost to a float.
const { wilson, overlap } = require('./stats.js');

const MIN_POINTS = 15;
const MAX_COST_RATIO = 1.25;

function betterThan(a, b)
{
    const failed = [];
    if ((a.passes * b.n - b.passes * a.n) * 100 < MIN_POINTS * a.n * b.n) failed.push('points');
    if (overlap(wilson(a.passes, a.n), wilson(b.passes, b.n))) failed.push('intervals');
    const costOk = b.meanCost === 0 ? a.meanCost === 0 : a.meanCost <= b.meanCost * MAX_COST_RATIO;
    if (!costOk) failed.push('cost');
    return failed;
}

const pct = (x) => `${Math.round((x.passes / x.n) * 100)}% (${x.passes}/${x.n})`;

function compare(a, b)
{
    const aFailed = betterThan(a, b);
    if (!aFailed.length) return { verdict: 'better', failed: [], sentence: `${a.arm} is BETTER than ${b.arm}: ${pct(a)} against ${pct(b)}.` };
    if (!betterThan(b, a).length) return { verdict: 'worse', failed: aFailed, sentence: `${a.arm} is WORSE than ${b.arm}: ${pct(a)} against ${pct(b)}.` };
    return { verdict: 'no measured difference', failed: aFailed, sentence: `NO MEASURED DIFFERENCE between ${a.arm} and ${b.arm}: ${pct(a)} against ${pct(b)}.` };
}

// The headline tasks only; guard, home-advantage and flow each get their own sentence elsewhere.
function headline({ ours, bare, ecc })
{
    const vsBare = compare(ours, bare);
    const vsEcc = ecc ? compare(ours, ecc) : null;
    if (vsBare.verdict !== 'better')
    {
        return {
            lead: `${ours.arm} is not better than ${bare.arm} on the headline tasks - that is the finding, and it outranks any comparison with ECC. ${vsBare.sentence}`,
            rest: vsEcc ? [vsEcc.sentence] : [],
        };
    }
    return vsEcc ? { lead: vsEcc.sentence, rest: [vsBare.sentence] } : { lead: vsBare.sentence, rest: [] };
}

module.exports = { compare, headline, betterThan, MIN_POINTS, MAX_COST_RATIO };
