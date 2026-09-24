'use strict';
// THE MANIFEST IS ONE FILE - and, since Phase 7b deleted the frozen shell twins, the ONLY file.
//
// Until Phase 7 the six lists the installers work from - skills, agents, rules, hooks, plugins and
// MCPs - were declared inline in both `scripts/os/claude-stack.{sh,ps1}`, about 273 lines each, and // legacy-name
// `build-manifest.js` extracted `meta/stack-manifest.json` out of the sh twin while refusing to
// write when the ps1 twin disagreed. Phase 7b deleted both twins (R33): there is nothing left to
// extract from or check agreement against, so `meta/stack-manifest.json` is now hand-edited
// directly, and this file stops being a twin-parity gate and becomes a plain SHAPE validator plus a
// sweep that keeps a deleted path from creeping back into a test or a script.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'meta', 'stack-manifest.json');
const { loadManifest } = require('./install/manifest.js');

const SIX_LISTS = ['skills', 'agents', 'rules', 'hooks', 'plugins', 'mcps'];

test('stack-manifest: the file exists and carries the six lists', () =>
{
    assert.ok(fs.existsSync(MANIFEST), 'meta/stack-manifest.json is missing');
    const parsed = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const key of SIX_LISTS)
        assert.ok(Array.isArray(parsed[key]) && parsed[key].length > 0, `stack-manifest: the '${key}' list is missing or empty`);
    assert.ok(parsed.retired && typeof parsed.retired === 'object', 'stack-manifest: no `retired` block');
    for (const key of SIX_LISTS)
        assert.ok(Array.isArray(parsed.retired[key]), `stack-manifest: retired.${key} is missing`);
});

test('stack-manifest: every row a list carries has the fields its own block needs', () =>
{
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const row of m.skills) { assert.strictEqual(typeof row.repo, 'string'); assert.strictEqual(typeof row.name, 'string'); }
    for (const row of m.agents) assert.strictEqual(typeof row.file, 'string');
    for (const row of m.rules) assert.strictEqual(typeof row.file, 'string');
    for (const row of m.hooks) { assert.strictEqual(typeof row.file, 'string'); assert.strictEqual(typeof row.matcher, 'string'); }
    for (const row of m.plugins) assert.strictEqual(typeof row.id, 'string');
    for (const row of m.mcps) { assert.strictEqual(typeof row.name, 'string'); assert.strictEqual(typeof row.args, 'string'); }
});

// 'shipped but not seeded' is a real state - an MCP server no stack seeds, a plugin parked for a
// release (superpowers, a hard core dependency rather than a pick). Flattening it to 'absent' would
// silently drop the item from the catalog the guided walk offers, which is a different install, not
// a smaller file. The manifest's own convention - `active: false` survives, never dropped - is
// pinned here so a hand-edit cannot un-park a row by deleting it and losing the note.
test('stack-manifest: a parked row keeps its note and stays out of the seeded (active) set', () =>
{
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const parked = m.plugins.filter((r) => r.active === false);
    assert.ok(parked.length, 'the manifest lost its parked row - superpowers is a core dependency, not a pick');
    for (const row of parked)
    {
        assert.ok(row.note && row.note.trim(), `parked plugin '${row.id}' has no note explaining why it is shipped but not seeded`);
    }
});

// A plugin from a marketplace that is neither the official one nor this repo installs only once
// that marketplace is registered. The seed reads the manifest, so the source rides on the plugin
// row it serves - measured on the 1.0.0 release check, where a fresh account failed claude-hud with
// 'not found in marketplace'.
test('stack-manifest: a plugin from a third-party marketplace names the source it is registered from', () =>
{
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const claudeHud = m.plugins.find((r) => r.id === 'claude-hud@claude-hud');
    assert.ok(claudeHud, 'the claude-hud plugin row is missing');
    assert.strictEqual(claudeHud.marketplace, 'jarrodwatts/claude-hud');
});

// The seed (scripts/install/manifest.js) is the ONE Node reader of the six lists - this proves it
// actually reads every one of them, in the spellings the rest of the install code depends on, off
// the manifest committed on disk (not a fixture).
test('stack-manifest: the seed (install/manifest.js) reads every list off this file', () =>
{
    const m = loadManifest(ROOT);
    for (const key of SIX_LISTS) assert.ok(Array.isArray(m[key]) && m[key].length > 0, `install/manifest.js loaded no '${key}'`);
    for (const key of SIX_LISTS) assert.ok(Array.isArray(m.retired[key]), `install/manifest.js loaded no retired.${key}`);
    assert.ok(m.hooks.every((h) => h.includes('::')), 'hooks render as file::matcher::args');
    assert.ok(m.skills.every((s) => s.includes('|')), 'skills render as repo|name');
    assert.ok(m.mcps.every((s) => s.includes('|')), 'mcps render as name|args');
});

// Phase 7b (R33) deleted `scripts/os/claude-stack.{sh,ps1}` for good - they are not coming back for // legacy-name
// one more release the way Phase 7 froze them. Nothing shipped may point at that path again: a
// revived reference is either a leftover this task missed or a regression re-introducing it. A line
// that must still spell it out - this file's own header above, an explanatory comment, a historical
// note in source-protocol.md - carries a trailing `legacy-name` marker; every OTHER matching line
// in the scanned tree is an offender, checked line by line so a marked line never hides an
// unmarked one three lines down in the same file.
test('stack-manifest: scripts/os/ is gone, and no script or test names it without marking it', () => // legacy-name
{
    assert.ok(!fs.existsSync(path.join(ROOT, 'scripts', 'os')), 'scripts/os/ still exists - the frozen twins were supposed to be deleted'); // legacy-name

    const SCAN_DIRS = ['scripts', 'stack', 'setup-plugin', 'meta'];
    // The repo root is never walked (only its named directories are), so a root file - CLAUDE.md's
    // own installer-layout prose named the deleted twins unmarked and the sweep missed it - is
    // checked explicitly by name instead.
    const SCAN_FILES = ['CLAUDE.md'];
    const TWIN_PATTERN = /scripts\/os\/|claude-stack\.sh|claude-stack\.ps1/;
    const offenders = [];
    const check = (full) =>
    {
        const text = fs.readFileSync(full, 'utf8');
        const unmarked = text.split('\n').some((l) => TWIN_PATTERN.test(l) && !/legacy-name/.test(l));
        if (unmarked) offenders.push(path.relative(ROOT, full));
    };
    const walk = (dir) =>
    {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            // .ps1 joined the filter after fix-serena-ts-windows.ps1's relocated header named the
            // deleted twin unmarked and slipped through the old js|md|json-only filter.
            if (!/\.(js|md|json|ps1)$/.test(entry.name)) continue;
            check(full);
        }
    };
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
    for (const f of SCAN_FILES) check(path.join(ROOT, f));
    assert.deepStrictEqual(offenders, [], `these files name the deleted twins on an unmarked line: ${offenders.join(', ')}`);
});
