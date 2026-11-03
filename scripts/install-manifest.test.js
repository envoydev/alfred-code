'use strict';
// THE MANIFEST LOADER - Phase 7, T4b; twin comparison removed in Phase 7b (R33).
//
// Until Phase 7b, one assertion here proved the loader rendered character-for-character what the sh
// twin declared. The twins are deleted now (`scripts/stack-manifest.test.js` covers that), so
// `meta/stack-manifest.json` is the only copy of the six lists left - there is nothing left to drift
// FROM. What remains here is the loader's own contract: the rendered spellings every later layer of
// the install depends on, active-vs-parked filtering, and the retired-block defaults.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadManifest } = require('./install/manifest.js');

const ROOT = path.join(__dirname, '..');

// A fixture, not the shipped manifest: which plugin is parked changes with the release (R72 took
// superpowers out of it), the loader's contract does not.
test('manifest: an active:false row is SHIPPED but not seeded', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-parked-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'meta'));
        fs.writeFileSync(path.join(dir, 'meta', 'stack-manifest.json'), JSON.stringify({
            plugins: [{ id: 'companion@elsewhere', active: false, note: 'installed beside the core' }, { id: 'pick@elsewhere' }],
        }));
        const m = loadManifest(dir);
        assert.deepStrictEqual(m.plugins, ['pick@elsewhere'], 'the parked row is not seeded');
        assert.deepStrictEqual(m.catalogs.plugins, ['companion@elsewhere', 'pick@elsewhere'], 'and it stays in the catalog - the stamp and --installed-only both read it');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manifest: the hook and mcp CATALOGS are never narrowed', () =>
{
    const m = loadManifest(ROOT);
    // Audit 2026-10-30 HK-22: one row is parked - the stop judge, a `prompt` hook the plugin route alone carries. It names
    // the stop contract's file on the same Stop, so its rendered string repeats that wiring and every catalog reader (each
    // dedupes by file or by wiring id) sees the same hooks; the copy route never wires it.
    const parked = (m.rows.hooks || []).filter((r) => r.active === false);
    assert.deepStrictEqual(parked.map((r) => [r.type, r.file, r.matcher]), [['prompt', 'guard-stop-contract.js', '@Stop']], 'the stop judge is the one parked hook row');
    assert.deepStrictEqual(m.catalogs.hooks.filter((h, i) => m.catalogs.hooks.indexOf(h) === i), m.hooks, 'the catalog is the live list plus that repeat');
    assert.ok(m.hooks.includes('guard-stop-contract.js::@Stop::'), 'the stop contract\'s own Stop wiring is live');
    assert.strictEqual(m.catalogs.mcps.length, (m.rows.mcps || []).length);
});

test('manifest: a hook wired on two events is two entries and one file', () =>
{
    const m = loadManifest(ROOT);
    const stop = m.hooks.filter((h) => h.startsWith('guard-stop-contract.js::'));
    assert.ok(stop.length >= 2, stop.join(' | '));
    assert.ok(stop.some((h) => h.includes('::@Stop::')), stop.join(' | '));
    assert.ok(stop.some((h) => /::AskUserQuestion::/.test(h)), stop.join(' | '));
});

test('manifest: a manifest with no retired block, or a partial one, prunes nothing it does not name', () =>
{
    const fs = require('node:fs');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-retired-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'meta'));
        const file = path.join(dir, 'meta', 'stack-manifest.json');
        fs.writeFileSync(file, JSON.stringify({ skills: [], agents: [], rules: [], hooks: [], plugins: [], mcps: [] }));
        assert.deepStrictEqual(loadManifest(dir).retired, { skills: [], agents: [], rules: [], hooks: [], mcps: [], plugins: [] });
        fs.writeFileSync(file, JSON.stringify({ skills: [], agents: [], rules: [], hooks: [], plugins: [], mcps: [], retired: { plugins: ['ponytail'] } }));
        const r = loadManifest(dir).retired;
        assert.deepStrictEqual(r.plugins, ['ponytail']);
        assert.deepStrictEqual(r.agents, []);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
