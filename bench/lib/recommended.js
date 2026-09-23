'use strict';
// The selection a user gets from `/claude-stack:init` by taking every recommended option: the
// always set, each confirmed stack's seeds, and what the evidence scan found in the project's own
// manifests - the three sources init pre-selects - run through the release's own closure. The
// scripts come from the PINNED source, so the selection logic is the release's, never this tree's.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LAYERS = ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins'];

// `general` is the never-seeded list (addable, not recommended), so it never enters.
function recommendedRaw({ recs, stacks, found })
{
    for (const st of stacks)
    {
        if (!(recs.stacks || {})[st]) throw new Error(`unknown stack '${st}' - the catalog has ${Object.keys(recs.stacks || {}).join(', ')}`);
    }
    const raw = {};
    for (const layer of LAYERS)
    {
        const set = new Set((recs.always || {})[layer] || []);
        for (const st of stacks) for (const name of recs.stacks[st][layer] || []) set.add(name);
        for (const name of Object.keys((found || {})[layer] || {})) set.add(name);
        raw[layer] = [...set].sort();
    }
    return raw;
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
    const src = arg('--src'), root = arg('--root'), stacks = arg('--stacks'), out = arg('--out');
    if (!src || !root || !stacks || !out)
    {
        console.error('usage: recommended.js --src <stack source> --root <project> --stacks <csv> --out <selection.txt>');
        return 2;
    }
    const found = `${out}.found.json`;
    const rawFile = `${out}.raw.json`;
    execFileSync(process.execPath, [path.join(src, 'scripts', 'scan-evidence.js'), '--root', root, '--catalog', path.join(src, 'meta', 'evidence.json'), '--out', found], { stdio: ['ignore', 'ignore', 'inherit'] });
    const recs = JSON.parse(fs.readFileSync(path.join(src, 'meta', 'recommendations.json'), 'utf8'));
    const foundJson = JSON.parse(fs.readFileSync(found, 'utf8'));
    const raw = recommendedRaw({ recs, stacks: stacks.split(',').filter(Boolean), found: foundJson.found || foundJson });
    fs.writeFileSync(rawFile, `${JSON.stringify(raw, null, 2)}\n`);
    execFileSync(process.execPath, [path.join(src, 'scripts', 'stack-select.js'), '--selection', rawFile, '--emit', out], { stdio: ['ignore', 'ignore', 'inherit'] });
    return 0;
}

if (require.main === module)
{
    try { process.exitCode = main(process.argv.slice(2)); }
    catch (err) { console.error(`recommended: ${err.message}`); process.exitCode = 1; }
}

module.exports = { recommendedRaw, LAYERS };
