'use strict';
// The Wilson score interval: the pre-registered interval for an all-pass rate. It behaves at 0 and at
// n successes, where the normal approximation gives an interval outside 0..1 or of zero width.
const Z90 = 1.6448536269514722;

function wilson(k, n, z = Z90)
{
    if (!(Number.isInteger(k) && Number.isInteger(n) && n >= 0 && k >= 0 && k <= n)) throw new Error(`${k} of ${n} is not a count of trials`);
    if (n === 0) return { p: null, lo: 0, hi: 1 };
    const p = k / n;
    const z2 = z * z;
    const d = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / d;
    const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
    return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const overlap = (a, b) => a.lo <= b.hi && b.lo <= a.hi;

module.exports = { wilson, overlap, Z90 };
