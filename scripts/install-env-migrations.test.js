'use strict';
// The seed's settings pass reads meta/migrations.json - the real file, never a hand-fed list,
// because the hand-fed unit test is what let the seed apply nothing for a whole release line.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { envMigrations } = require('./install/env-migrations.js');
const { applyEnv } = require('./install/settings.js');

const REAL = require(path.join(__dirname, '..', 'meta', 'migrations.json'));

test('every settings-env migration in the real file reaches applyEnv', () =>
{
    const m = envMigrations(REAL);
    assert.deepEqual(Object.keys(m).sort(), ['renames', 'reseed', 'retired']);
    assert.deepEqual(m.renames, [
        ['ALFRED_CODE_FRESH_SESSION_1M', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M'],
        ['ALFRED_CODE_FRESH_SESSION_200K', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K'],
        ['ALFRED_CODE_DEFAULT_CONTEXT_WINDOW', 'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT'],
    ]);
    assert.ok(m.retired.some(([k]) => k === 'ALFRED_CODE_FRESH_SESSION_PCT'));
    assert.ok(m.retired.some(([k]) => k === 'ALFRED_CODE_CONTEXT_WINDOW'));
    assert.ok(m.retired.some(([k, when]) => k === 'ALFRED_CODE_MONITOR' && when === null), 'the retired monitor hook\'s key goes whatever it held');
    assert.ok(m.retired.some(([k, when]) => k === 'ALFRED_CODE_FRESH_SESSION_DEFAULT' && when === null), 'the retired catch-all trigger goes whatever it held');
    assert.ok(m.reseed.some(([k, bad, to]) => k === 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K' && bad === '150000' && to === '180000'));
});

test('an old install is migrated by the real file', () =>
{
    const env = { ALFRED_CODE_DOCS_PATH: 'docs', ALFRED_CODE_FRESH_SESSION_PCT: '60', ALFRED_CODE_FRESH_SESSION_DEFAULT: '250000', ALFRED_CODE_FRESH_SESSION_1M: '350000', ALFRED_CODE_FRESH_SESSION_200K: '150000', ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: '200000', ALFRED_CODE_MONITOR: 'inject', ALFRED_CODE_CORRECTION_NUDGE: 'log', OTHER: 'x' };
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(env.ALFRED_CODE_DOCS_PATH, 'docs');
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_PCT' in env));
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_DEFAULT' in env), 'the retired catch-all trigger goes');
    assert.equal(env.ALFRED_CODE_CONTEXT_WINDOW_FOR_1M, '350000', 'a renamed trigger keeps its value');
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_1M' in env));
    assert.equal(env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, '180000', 'the old 200K seed moves to the new one');
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_200K' in env));
    assert.equal(env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '200000', 'the renamed window keeps its value');
    assert.ok(!('ALFRED_CODE_DEFAULT_CONTEXT_WINDOW' in env));
    assert.ok(!('ALFRED_CODE_MONITOR' in env), 'the retired monitor key goes, even off its seed');
    assert.equal(env.ALFRED_CODE_CORRECTION_NUDGE, 'log', 'a key no migration names is left alone');
    assert.equal(env.OTHER, 'x');
});

test('envMigrations translates each entry kind into its flat list', () =>
{
    const file = { migrations: [
        { rename_settings_env: { from: 'ALFRED_CODE_OLD', to: 'ALFRED_CODE_NEW' } },
        { remove_settings_env: { key: 'ALFRED_CODE_FOO' } },
        { remove_settings_env: { key: 'ALFRED_CODE_BAZ', when_value: '1' } },
        { clear_settings_env: { key: 'ALFRED_CODE_BAR', when_value: 'x', to: 'y' } },
        { id: 'file-only', remove: ['a.js'] }
    ] };
    const m = envMigrations(file);
    assert.deepEqual(m.renames, [['ALFRED_CODE_OLD', 'ALFRED_CODE_NEW']]);
    assert.deepEqual(m.retired, [['ALFRED_CODE_FOO', null], ['ALFRED_CODE_BAZ', '1']]);
    assert.deepEqual(m.reseed, [['ALFRED_CODE_BAR', 'x', 'y']]);
    assert.deepEqual(envMigrations(null), { renames: [], retired: [], reseed: [] });
});

test('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is dropped only while it still holds the old stack seed', () =>
{
    const removed = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' };
    applyEnv(removed, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.ok(!('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' in removed));

    const kept = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '35' };
    applyEnv(kept, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(kept.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '35');
});
