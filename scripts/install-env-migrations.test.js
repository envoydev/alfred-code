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
    assert.deepEqual(Object.keys(m).sort(), ['offWith', 'renames', 'reseed', 'retired']);
    assert.deepEqual(m.offWith, [['ALFRED_CODE_CONTEXT_WINDOW_DEFAULT',
        ['ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K'], ['300000', '180000'], '0']],
        'three tiers at 0 carry the DEFAULT to 0 (item 12, 2026-10-21)');
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
    assert.ok(m.reseed.some(([k, bad, to]) => k === 'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT' && bad === '300000' && to === '180000'),
        'the default became a trigger (the user\'s ruling, 2026-10-21): its old window seed moves to the trigger seed');
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

// The reseed line is what an update prints for the 2026-10-21 DEFAULT move: it names the old seed it replaced, the way the
// retirement line does - '(auto-detect)' was a leftover label that described no reseed.
test('a reseed says which old stack seed it replaced', () =>
{
    const env = { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' };
    const lines = [];
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: (l) => lines.push(l) });
    assert.equal(env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '180000');
    assert.ok(lines.some((l) => /ALFRED_CODE_CONTEXT_WINDOW_DEFAULT reset to 180000 \(the old stack seed 300000\)/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('auto-detect')), 'no leftover label');
});

// Item 12 of 2026-10-21: three tiers at `0` turned the offers off before the DEFAULT became a trigger. Since then the off
// switch is all four keys, so an update writes the DEFAULT's `0` too - only over a value the stack seeded (or an absent key),
// never over one the user typed.
const TIERS_OFF = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0' };
const run = (env, opts = {}) => { const lines = []; const changed = applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: (l) => lines.push(l), ...opts }); return { env, lines, changed }; };

test('three tiers at 0 carry the DEFAULT\'s old seed to 0, not to the new trigger seed', () =>
{
    const { env, lines } = run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' });
    assert.equal(env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '0');
    assert.ok(lines.some((l) => /ALFRED_CODE_CONTEXT_WINDOW_DEFAULT set to 0 \(the stack seed 300000; the three tiers are 0, so the offers stay off\)/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('reset to 180000')), 'no reseed line first');
});

test('three tiers at 0 carry an absent DEFAULT and the current seed the stack wrote to 0', () =>
{
    assert.equal(run({ ...TIERS_OFF }).env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '0', 'absent');
    assert.equal(run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' }, { stackWrote: () => true }).env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '0', 'the seed the ledger says the stack wrote');
});

test('a DEFAULT the user typed stays, whatever the tiers hold', () =>
{
    assert.equal(run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' }, { stackWrote: () => false }).env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '180000', 'the seed value, typed by hand');
    assert.equal(run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '250000' }).env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '250000', 'no seed at all');
});

test('one tier on or absent leaves the DEFAULT to the reseed', () =>
{
    const on = run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' }).env;
    assert.equal(on.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '180000');
    const gone = { ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' };
    delete gone.ALFRED_CODE_CONTEXT_WINDOW_FOR_1M;
    assert.equal(run(gone).env.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '180000', 'an absent tier is seeded on, so the offers are not off');
});

test('a re-run over the carried 0 changes nothing', () =>
{
    const first = run({ ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' });
    const again = run({ ...first.env });
    assert.equal(again.changed, false);
    assert.deepEqual(again.lines, []);
});

test('the overlay is carried in its own file, and an absent DEFAULT is never added to it', () =>
{
    const overlay = { ...TIERS_OFF, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '300000' };
    run({ ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' }, { overlay });
    assert.equal(overlay.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '0');
    const bare = { ...TIERS_OFF };
    run({ ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' }, { overlay: bare });
    assert.ok(!('ALFRED_CODE_CONTEXT_WINDOW_DEFAULT' in bare), 'the overlay gains no key it never held');
    const beneath = run({ ...TIERS_OFF }, { inherited: { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '250000' } }).env;
    assert.ok(!('ALFRED_CODE_CONTEXT_WINDOW_DEFAULT' in beneath), 'a value in the file beneath is the user\'s - nothing hides it');
});

test('envMigrations translates each entry kind into its flat list', () =>
{
    const file = { migrations: [
        { rename_settings_env: { from: 'ALFRED_CODE_OLD', to: 'ALFRED_CODE_NEW' } },
        { remove_settings_env: { key: 'ALFRED_CODE_FOO' } },
        { remove_settings_env: { key: 'ALFRED_CODE_BAZ', when_value: '1' } },
        { clear_settings_env: { key: 'ALFRED_CODE_BAR', when_value: 'x', to: 'y' } },
        { off_settings_env: { key: 'ALFRED_CODE_QUX', with: ['ALFRED_CODE_A', 'ALFRED_CODE_B'], when_value: ['5'], to: '0' } },
        { id: 'file-only', remove: ['a.js'] }
    ] };
    const m = envMigrations(file);
    assert.deepEqual(m.renames, [['ALFRED_CODE_OLD', 'ALFRED_CODE_NEW']]);
    assert.deepEqual(m.retired, [['ALFRED_CODE_FOO', null], ['ALFRED_CODE_BAZ', '1']]);
    assert.deepEqual(m.reseed, [['ALFRED_CODE_BAR', 'x', 'y']]);
    assert.deepEqual(m.offWith, [['ALFRED_CODE_QUX', ['ALFRED_CODE_A', 'ALFRED_CODE_B'], ['5'], '0']]);
    assert.deepEqual(envMigrations(null), { renames: [], retired: [], reseed: [], offWith: [] });
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
