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
        // carries a pick, a seat deny and a selection line across. Each old skill or seat is retired
        // too; an MCP name (2.0.0: the role names) is its plugin and server alike, an engine by prefix.
        renamed: {
            skills: { ...((raw.renamed || {}).skills || {}) },
            agents: { ...((raw.renamed || {}).agents || {}) },
            mcps: { ...((raw.renamed || {}).mcps || {}) },
        },
        rows: raw,
    };
}

// Every name the stack ever shipped a copy under, by kind - the catalog (inactive rows included), the
// renamed map's old names and the retired lists - so a file under `.claude/` is told apart from the
// project's own: `.claude/skills`, `agents`, `rules` and `hooks` are the project's folders too.
// `renamedSkills` / `renamedAgents` are the old -> new maps themselves.
function stackNames(manifest)
{
    const bare = (list, ext) => (list || []).map((f) => String(f).replace(ext, ''));
    const rows = manifest.rows || {};
    return {
        skills: new Set([...manifest.catalogs.skills.map((e) => e.split('|').pop()), ...Object.keys(manifest.renamed.skills), ...manifest.retired.skills]),
        agents: new Set([...bare((rows.agents || []).map((r) => r.file), /\.md$/), ...Object.keys(manifest.renamed.agents), ...bare(manifest.retired.agents, /\.md$/)]),
        rules: new Set([...bare((rows.rules || []).map((r) => r.file), /\.md$/), ...bare(manifest.retired.rules, /\.md$/)]),
        hooks: new Set([...manifest.catalogs.hooks.map((e) => e.split('::')[0].replace(/\.js$/, '')), ...bare(manifest.retired.hooks, /\.js$/)]),
        renamedSkills: manifest.renamed.skills,
        renamedAgents: manifest.renamed.agents,
    };
}

// M3: a name ONLY the stack uses - its `alfred-` / `project-` prefixes, or a renamed item's old name - of a
// kind `stackNames` read (`skills`, `agents`, `rules`). A catalog name like `typescript`, `npm` or
// `markdown-docs` is a project's own as often as the stack's, so on its own it proves nothing: not an
// install to take over (stamp.js legacySignature), not a copy the stack may overwrite (the library layer).
function stackOwnName(names, kind, name)
{
    if (!names || !names[kind] || !names[kind].has(name)) return false;
    if (/^(alfred|project)-/.test(name)) return true;
    const was = kind === 'skills' ? names.renamedSkills : kind === 'agents' ? names.renamedAgents : null;
    return Boolean(was) && Object.hasOwn(was, name);
}

module.exports = { loadManifest, stackNames, stackOwnName, renderHook, renderSkill, renderMcp, MANIFEST };
