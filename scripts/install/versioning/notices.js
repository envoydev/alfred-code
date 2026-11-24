'use strict';

// Which versioning notice a run says - pure: values in, values out (spec D6b, D7).
const { MARKER_PATTERN, SHARED_SCOPES, TOLD, chainedNotice, pulledNotice, lagNotice } = require('./constants.js');

// The versioning a data root `.gitignore` text names on its head line, or undefined (no text, no marker).
function markerOf(text)
{
    if (typeof text !== 'string') return undefined;
    const match = MARKER_PATTERN.exec(text.replace(/\r\n/g, '\n').split('\n')[0]);
    return match ? match[1] : undefined;
}

// D6b: [{ key, line }] for a linked child. `tracked`: git tracks `<data root>/.gitignore`. `said`: the told entries so far.
// The first line needs a shared scope, a tracked file whose marker became the chain's value this run, The second, at any scope (a local-scope `.variables` is pulled only where git tracks it), needs a `.variables` line no ledger row or answer owns that the ranking took over a different chain value.
function noticeRows({ scope, tracked, before, after, value, source, seed, ownLine, ledgerRow, answered, chain, said = [] })
{
    const rows = [];
    const sharedScope = SHARED_SCOPES.includes(scope);
    const chainedKey = `${TOLD.chained}${value}`;
    if (sharedScope && tracked && source === 'chain' && markerOf(before) !== value && markerOf(after) === value && !said.includes(chainedKey))
        rows.push({ key: chainedKey, line: chainedNotice(value, seed) });
    const pulledKey = `${TOLD.pulled}${ownLine}`;
    if (ownLine !== undefined && chain !== undefined && ownLine !== chain && source === 'own' && ledgerRow === undefined && !answered && !said.includes(pulledKey))
        rows.push({ key: pulledKey, line: pulledNotice(ownLine, chain) });
    return rows;
}

// D7: the line for a child whose data root file names another versioning than the child reads, else null.
function lagLine({ rel, text, value })
{
    const marker = markerOf(text);
    return marker !== undefined && value !== undefined && marker !== value ? lagNotice(rel, value) : null;
}

module.exports = { markerOf, noticeRows, lagLine };
