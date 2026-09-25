'use strict';
// THE MANIFEST - the six lists, read from meta/stack-manifest.json.
//
// Until Phase 7b the JSON was generated FROM the sh twin, refusing to build when the ps1 disagreed
// (T0); the twins are deleted now (R33), so the JSON is hand-edited directly and this is its only
// reader. This loader renders it into the entry SPELLINGS the shell twins used to write - `repo|name`,
// `file.js::matcher::event`, `name|args`, `plugin@marketplace` - because every layer of this seed
// still parses those spellings, and `scripts/build-marketplace.js`'s hook-wiring generator reads the
// rendered `hooks` catalog the same way. `scripts/install-manifest.test.js` pins the loader's own
// contract; `scripts/stack-manifest.test.js` pins the manifest's shape.
//
// A row carrying `active: false` is SHIPPED BUT NOT SEEDED - a real state, not an absence. It stays
// in the catalog (a stamp and an `--installed-only` derivation both need to know the release ships
// it) and out of the default selection.
//
// Two catalogs are kept UNFILTERED: hooks and mcps as SHIPPED. The selection narrows the live lists,
// and the retirement passes have to name every hook and server the stack ever wrote - including the
// ones this run did not pick.
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = path.join('meta', 'stack-manifest.json');

const renderHook = (row) => `${row.file}::${row.matcher || ''}::${row.event || ''}`;
const renderSkill = (row) => `${row.repo}|${row.name}`;
const renderMcp = (row) => `${row.name}|${row.args}`;

function loadManifest(sourceDir)
{
    const file = path.join(sourceDir, MANIFEST);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const active = (rows) => (rows || []).filter((r) => r.active !== false);

    return {
        skills: active(raw.skills).map(renderSkill),
        agents: active(raw.agents).map((r) => r.file),
        rules: active(raw.rules).map((r) => r.file),
        hooks: active(raw.hooks).map(renderHook),
        plugins: active(raw.plugins).map((r) => r.id),
        mcps: active(raw.mcps).map(renderMcp),
        // As SHIPPED - never narrowed by a selection.
        catalogs: {
            hooks: (raw.hooks || []).map(renderHook),
            mcps: (raw.mcps || []).map(renderMcp),
            plugins: (raw.plugins || []).map((r) => r.id),
            skills: (raw.skills || []).map(renderSkill),
        },
        // What a release retired - pruned from a project that still carries it.
        retired: { skills: [], agents: [], rules: [], hooks: [], mcps: [], plugins: [], ...(raw.retired || {}) },
        // What a release RENAMED, old name -> new (a seat by its bare name): the one table update
        // carries a pick, a seat deny and a selection line across. Each old name is retired too.
        renamed: { skills: { ...((raw.renamed || {}).skills || {}) }, agents: { ...((raw.renamed || {}).agents || {}) } },
        rows: raw,
    };
}

module.exports = { loadManifest, renderHook, renderSkill, renderMcp, MANIFEST };
