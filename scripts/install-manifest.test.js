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
const path = require('node:path');

const { loadManifest } = require('./install/manifest.js');

const ROOT = path.join(__dirname, '..');

test('manifest: an active:false row is SHIPPED but not seeded', () =>
{
    const m = loadManifest(ROOT);
    const parked = (m.rows.plugins || []).filter((r) => r.active === false).map((r) => r.id);
    assert.ok(parked.length, 'the fixture lost its parked row - superpowers is a core dependency, not a pick');
    for (const id of parked)
    {
        assert.ok(!m.plugins.includes(id), `${id} is seeded although it is parked`);
        assert.ok(m.catalogs.plugins.includes(id), `${id} left the catalog - the stamp and --installed-only both read it`);
    }
});

test('manifest: the hook and mcp CATALOGS are never narrowed', () =>
{
    const m = loadManifest(ROOT);
    assert.deepStrictEqual(m.catalogs.hooks, m.hooks, 'no hook is parked today, so the two lists must match exactly');
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

test('manifest: every MCP entry keeps its install-time placeholders intact', () =>
{
    // JSON has no `$` expansion, so an install-time shell variable became an @PLACEHOLDER@ token the
    // argv resolver already understands. A row that lost one would register a literal.
    const m = loadManifest(ROOT);
    const serena = m.mcps.find((e) => e.startsWith('serena|'));
    assert.match(serena, /@SERENA_CONTEXT@/);
    const memory = m.mcps.find((e) => e.startsWith('memory|'));
    assert.match(memory, /@MEMORY_DB_PATH@/);
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
