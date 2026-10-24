'use strict';
// Phase 7b (R33) deleted the frozen shell twins (.sh, .ps1): this file used to drive
// them directly (--print-plan / --installed-only selection filtering, hook adoption on update, the
// empty-.claude guard, a Hidden .claude tree under pwsh) as a real subprocess for both. That logic is
// unit-tested against the Node seed's own selection module in install-selection.test.js (filter, plan,
// derive, adopt-hooks, adopt-always, read-back, addLines/closeLines/dropLines - all already green,
// seed-only, no subprocess). What remains here is the environment catalog - meta/environment.json -
// which was never twin-specific: it is read directly, with no installer subprocess in the loop.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- the environment catalog (meta/environment.json) ------------------------------------------
// One list for the settings.json env block: setup asks its rows, configure changes them, validate
// reconciles them, the installers seed them. The lint pins catalog <-> installer parity; these
// pin the catalog's own shape and the rename wiring, so a bad row fails here with a name.
test('environment catalog: every row is askable, seeded and shaped', () =>
{
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8'));
    // 'tokens' is an absolute per-message token count with 0 meaning off - the fresh-session
    // triggers, which replaced a percentage that the clamps made inert at its own default.
    // 'window' is a context-window SIZE in tokens: no off value, since a window of 0 is not a window.
    // 'csv' is a comma-separated name list whose EMPTY default means 'nothing switched off' -
    // ALFRED_CODE_HOOKS_OFF, which replaced the walk's hooks layer once the set stopped being copied.
    // 'absolute-path' is a resolved filesystem path the install WRITES rather than asks -
    // ALFRED_CODE_MEMORY_DB, the channel a plugin MCP entry cannot expand and its launcher reads.
    // 'hours' is a duration the idle-gap offer reads with parseFloat: decimals allowed, 0 meaning off.
    // 'int' is a whole number in min..max - a count, never a percent (ALFRED_CODE_SCORER_ROUNDS).
    const TYPES = new Set(['percent', 'enum', 'relative-path', 'absolute-path', 'int-or-auto', 'tokens', 'window', 'csv', 'hours', 'int']);
    assert.ok(cat.env.length >= 5, 'the catalog carries the stack env values');
    for (const row of cat.env)
    {
        assert.match(row.key, /^ALFRED_CODE_[A-Z0-9_]+$/, `${row.key} is an env key`);
        assert.strictEqual(typeof row.default, 'string', `${row.key} has a string default`);
        assert.ok(row.what && row.what.length > 20, `${row.key} explains itself in plain words`);
        assert.ok(TYPES.has(row.validate.type), `${row.key} has a validate shape the walks can check`);
        // A WRITTEN row mirrors a choice the run just made into the file a plugin launcher reads, so
        // it is never asked on the environment screen - the question that owns it is elsewhere
        // (--memory-level), and asking twice would let the two answers disagree.
        if (row.written) { assert.strictEqual(row.ask, false, `${row.key} is written by the install, so it is not asked`); }
        if (row.validate.type === 'enum') { assert.ok(row.validate.values.includes(row.default), `${row.key} default is one of its own values`); }
        if (row.validate.type === 'percent')
        {
            const n = Number(row.default);
            const inRange = n >= row.validate.min && n <= row.validate.max;
            assert.ok(inRange || row.default === row.validate.off, `${row.key} default is inside its own range (or is its off value)`);
        }
        if (row.validate.type === 'int')
        {
            const n = Number(row.default);
            assert.ok(Number.isInteger(n) && n >= row.validate.min && n <= row.validate.max, `${row.key} default is a whole number in its own range`);
        }
        if (row.validate.type === 'csv' && row.validate.values)
        {
            for (const item of row.default.split(',').map((s) => s.trim()).filter(Boolean))
                assert.ok(row.validate.values.includes(item), `${row.key} default item ${item} is one of its own values`);
        }
        // a token count is an absolute trigger the hook reads with parseInt: anything negative or
        // unparseable falls back to the default, and 0 is the real answer 'this tier is off' - so
        // the catalog must accept 0 and never declare a floor the runtime would not honour
        if (row.validate.type === 'tokens')
        {
            const n = Number(row.default);
            assert.ok(Number.isInteger(n) && n >= 0, `${row.key} default is a whole token count`);
            assert.strictEqual(row.validate.min, 0, `${row.key} accepts 0 - the hook reads it as off, not as invalid`);
            assert.strictEqual(row.validate.off, '0', `${row.key} documents 0 as its off switch`);
        }
        // an hour count (the idle-gap offer) takes decimals; 0 is its off switch
        if (row.validate.type === 'hours')
        {
            const n = Number(row.default);
            assert.ok(Number.isFinite(n) && n >= 0, `${row.key} default is a non-negative hour count`);
            assert.strictEqual(row.validate.off, '0', `${row.key} documents 0 as its off switch`);
        }
        if (row.validate.type === 'window')
        {
            const n = Number(row.default);
            assert.ok(Number.isInteger(n) && n >= row.validate.min, `${row.key} default is a whole window size at or above its floor`);
            assert.ok(!('off' in row.validate), `${row.key} has no off value - removing the key is how it stops applying`);
        }
        if (row.asked_with) { assert.ok(cat.env.some(r => r.key === row.asked_with), `${row.key} rides along with a row that exists`); }
        // `group_off` makes a row the OWNER of a whole feature: setup and configure ask it as one
        // question with a 'do not use it' answer that writes this value to the row AND to every
        // row riding with it, so an off answer can never leave half a feature switched on.
        if (row.group_off)
        {
            assert.ok(row.ask && !row.asked_with, `${row.key} owns its question - a group_off row is asked, never a rider`);
            const riders = cat.env.filter(r => r.asked_with === row.key);
            assert.ok(riders.length > 0, `${row.key} carries group_off but nothing rides with it`);
            for (const r of riders) { assert.ok(!r.validate || r.validate.off === row.group_off, `${r.key} reads ${row.group_off} as off, like the row it rides with`); }
        }
    }
});

test('catalog: the scorer rows carry the validate shapes the walks check', () =>
{
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8'));
    const v = (k) => cat.env.find((r) => r.key === k).validate;
    assert.deepStrictEqual(v('ALFRED_CODE_SCORER'), { type: 'enum', values: ['0', '1'] });
    assert.deepStrictEqual(v('ALFRED_CODE_SCORER_LEVEL'), { type: 'percent', min: 60, max: 100 });
    assert.deepStrictEqual(v('ALFRED_CODE_SCORER_OUTPUTS'), { type: 'csv', values: ['designer-plan', 'root-cause', 'inline-plan'] });
    assert.deepStrictEqual(v('ALFRED_CODE_SCORER_ROUNDS'), { type: 'int', min: 1, max: 10 });
    assert.ok(!('values' in v('ALFRED_CODE_HOOKS_OFF')), 'the one csv row of today is unchanged');
});

test('environment catalog: a renamed key is declared on both sides', () =>
{
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8'));
    const migrations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'migrations.json'), 'utf8'));
    const renames = migrations.migrations.filter(m => m.rename_settings_env);
    for (const m of renames)
    {
        const row = cat.env.find(r => r.key === m.rename_settings_env.to);
        assert.ok(row, `${m.id} renames into a key the catalog owns`);
        assert.strictEqual(row.renamed_from, m.rename_settings_env.from, `${row.key} records the old spelling validate looks for`);
        assert.strictEqual(m.detect.settings_env_key, m.rename_settings_env.from, `${m.id} detects the key it renames`);
    }
    // the other side: a catalog row naming an old spelling has the rename that moves it
    for (const row of cat.env.filter(r => r.renamed_from))
        assert.ok(renames.some(m => m.rename_settings_env.to === row.key && m.rename_settings_env.from === row.renamed_from), `${row.key} names renamed_from with no rename entry`);
});
