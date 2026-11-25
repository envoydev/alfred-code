'use strict';
// scan-evidence --children: which projects the scan reads and how their finds merge. Pure - values in, values out.
const { NONE, ROW_OK, DIRECT_DEPTH, LIST_SEPARATOR, PATH_SEPARATOR, HIT_PRESENT, HIT_IN } = require('./constants.js');

// A hit is '<path> present' or '<name> in <path>'; the child's folder goes in front of the path.
function prefixHit(hit, rel)
{
    if (hit.endsWith(HIT_PRESENT)) return `${rel}${PATH_SEPARATOR}${hit}`;
    const at = hit.lastIndexOf(HIT_IN);
    if (at < 0) return hit;
    const cut = at + HIT_IN.length;
    return `${hit.slice(0, cut)}${rel}${PATH_SEPARATOR}${hit.slice(cut)}`;
}

// The root's own hits first, then each child's in the order given; the first hit per name stays.
function mergeFound(own, byChild)
{
    const merged = Object.fromEntries(Object.entries(own).map(([layer, names]) => [layer, { ...names }]));
    for (const { rel, found } of byChild)
    {
        for (const [layer, names] of Object.entries(found))
        {
            merged[layer] = merged[layer] || {};
            for (const [name, hit] of Object.entries(names))
            {
                if (!(name in merged[layer])) merged[layer][name] = prefixHit(hit, rel);
            }
        }
    }
    return merged;
}

const underAny = (relPath, rels) => rels.some((rel) => relPath === rel || relPath.startsWith(`${rel}${PATH_SEPARATOR}`));

const childList = (value) => (value === NONE ? [] : value.split(LIST_SEPARATOR).filter(Boolean));

// Each named child, then every row below it, in row order.
function withBelow(named, rows)
{
    const out = [];
    for (const rel of named)
    {
        for (const found of [rel, ...rows.filter((row) => row.rel.startsWith(`${rel}${PATH_SEPARATOR}`)).map((row) => row.rel)])
        {
            if (!out.includes(found)) out.push(found);
        }
    }
    return out;
}

// What to read for a `--children` value over the `subtree()` rows: the root without any joined project, then each named
// direct child and every project below it as its own root, with the projects below that root left out of it.
function planChildren(value, rows)
{
    const direct = new Set(rows.filter((row) => row.depth === DIRECT_DEPTH && row.state === ROW_OK).map((row) => row.rel));
    const named = childList(value);
    const readable = rows.filter((row) => row.state === ROW_OK);
    const rootOf = new Map(readable.map((row) => [row.rel, row.root]));
    return {
        rootExclude: rows.filter((row) => row.depth >= DIRECT_DEPTH).map((row) => row.rel),
        unknown: named.filter((rel) => !direct.has(rel)),
        reads: withBelow(named.filter((rel) => direct.has(rel)), readable).map((rel) => ({
            rel,
            root: rootOf.get(rel),
            exclude: rows.filter((row) => row.rel.startsWith(`${rel}${PATH_SEPARATOR}`)).map((row) => row.rel.slice(rel.length + 1)),
        })),
    };
}

module.exports = { prefixHit, mergeFound, underAny, childList, withBelow, planChildren };
