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
    assert.deepEqual(Object.keys(m).sort(), ['folds', 'offWith', 'renames', 'reseed', 'retired']);
    assert.deepEqual(m.folds.map(([k, , entry]) => `${k}>${entry}`).sort(), [
        'ALFRED_CODE_CONFIG_PROTECT>guard-config-protection', 'ALFRED_CODE_DOCS_ASK>docs-session:ask', 'ALFRED_CODE_DOCS_BLOCK>docs-session:block',
        'ALFRED_CODE_DOCS_GATE>docs-session:gate', 'ALFRED_CODE_DONE_GATE>guard-stop-contract:done', 'ALFRED_CODE_PUSH_GATE>guard-ungated-commit:push',
        'ALFRED_CODE_ROTATE_ASK>guard-stop-contract:rotate'], 'the env audit of 2026-10-21 folds seven switches into the hooks csv');
    assert.ok(m.folds.every(([, into, , when]) => into === 'ALFRED_CODE_HOOKS_OFF' && when === '0'));
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
    assert.ok(m.reseed.some(([k, bad, to]) => k === 'ALFRED_CODE_HISTORY' && bad === '1' && to === '3'),
        'the history switch became a session count (item 10, 2026-10-21): the old on seed moves to the count seed');
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

test('the history on-switch the stack seeded becomes the count 3; a typed value and the off switch stay', () =>
{
    assert.equal(run({ ALFRED_CODE_HISTORY: '1' }).env.ALFRED_CODE_HISTORY, '3');
    assert.equal(run({ ALFRED_CODE_HISTORY: '1' }, { stackWrote: () => false }).env.ALFRED_CODE_HISTORY, '1', 'typed by hand: one session');
    assert.equal(run({ ALFRED_CODE_HISTORY: '0' }).env.ALFRED_CODE_HISTORY, '0');
    assert.equal(run({ ALFRED_CODE_HISTORY: '7' }).env.ALFRED_CODE_HISTORY, '7');
});

// The env audit of 2026-10-21: seven on/off keys fold into ALFRED_CODE_HOOKS_OFF. A key at `0` (the user switched the part
// or hook off) becomes its entry in the csv; at any other value it is the seed's 'on', and goes.
const FOLD_LOG = /ALFRED_CODE_DOCS_GATE folded into ALFRED_CODE_HOOKS_OFF as docs-session:gate/;
test('a part or hook switched off with its old key becomes an entry in ALFRED_CODE_HOOKS_OFF; an on value just goes', () =>
{
    const { env, lines } = run({ ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_DOCS_GATE: '0', ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_CONFIG_PROTECT: '0', OTHER: 'x' });
    assert.equal(env.ALFRED_CODE_HOOKS_OFF, 'guard-answer,docs-session:gate,guard-config-protection');
    for (const k of ['ALFRED_CODE_DOCS_GATE', 'ALFRED_CODE_PUSH_GATE', 'ALFRED_CODE_CONFIG_PROTECT']) assert.ok(!(k in env), k);
    assert.equal(env.OTHER, 'x');
    assert.ok(lines.some((l) => FOLD_LOG.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /ALFRED_CODE_PUSH_GATE removed \(on - the part runs unless ALFRED_CODE_HOOKS_OFF names guard-ungated-commit:push\)/.test(l)), lines.join('\n'));
});

test('the fold makes the csv when there is none, never doubles an entry, and a re-run changes nothing', () =>
{
    assert.equal(run({ ALFRED_CODE_DOCS_ASK: '0' }).env.ALFRED_CODE_HOOKS_OFF, 'docs-session:ask');
    assert.equal(run({ ALFRED_CODE_HOOKS_OFF: 'docs-session:ask', ALFRED_CODE_DOCS_ASK: '0' }).env.ALFRED_CODE_HOOKS_OFF, 'docs-session:ask');
    assert.equal(run({ ALFRED_CODE_HOOKS_OFF: ' ', ALFRED_CODE_DOCS_ASK: '0' }).env.ALFRED_CODE_HOOKS_OFF, 'docs-session:ask', 'a blank csv is empty');
    const first = run({ ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_ROTATE_ASK: '0', ALFRED_CODE_DONE_GATE: '0' });
    assert.equal(first.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer,guard-stop-contract:rotate,guard-stop-contract:done');
    const again = run({ ...first.env });
    assert.equal(again.changed, false);
    assert.deepEqual(again.lines, []);
});

test('the fold lands where the csv takes effect: the overlay keeps its own, and a committed key also reaches an overlay csv', () =>
{
    const overlay = { ALFRED_CODE_DOCS_ASK: '0' };
    const env = { ALFRED_CODE_HOOKS_OFF: 'guard-answer' };
    run(env, { overlay });
    assert.equal(overlay.ALFRED_CODE_HOOKS_OFF, 'guard-answer,docs-session:ask', 'an overlay key folds into an overlay csv made from the one beneath');
    assert.equal(env.ALFRED_CODE_HOOKS_OFF, 'guard-answer', 'the committed csv is not the overlay key\'s to change');
    const held = { ALFRED_CODE_HOOKS_OFF: 'instrument-tool-usage' };
    const committed = { ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_DOCS_GATE: '0' };
    run(committed, { overlay: held });
    assert.equal(committed.ALFRED_CODE_HOOKS_OFF, 'docs-session:gate', 'the team\'s file keeps the team\'s switch');
    assert.equal(held.ALFRED_CODE_HOOKS_OFF, 'instrument-tool-usage,docs-session:gate', 'and the overlay csv that shadows it carries it too');
});

test('a walk that answered the hooks layer rewrites the hook names and keeps every part entry', () =>
{
    const env = { ALFRED_CODE_HOOKS_OFF: 'instrument-tool-usage,docs-session:gate,guard-ungated-commit:push' };
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), hooksAnswered: true, hooksOff: ['guard-answer'], log: () => {} });
    assert.equal(env.ALFRED_CODE_HOOKS_OFF, 'guard-answer,docs-session:gate,guard-ungated-commit:push');
});

test('envMigrations translates each entry kind into its flat list', () =>
{
    const file = { migrations: [
        { rename_settings_env: { from: 'ALFRED_CODE_OLD', to: 'ALFRED_CODE_NEW' } },
        { remove_settings_env: { key: 'ALFRED_CODE_FOO' } },
        { remove_settings_env: { key: 'ALFRED_CODE_BAZ', when_value: '1' } },
        { clear_settings_env: { key: 'ALFRED_CODE_BAR', when_value: 'x', to: 'y' } },
        { off_settings_env: { key: 'ALFRED_CODE_QUX', with: ['ALFRED_CODE_A', 'ALFRED_CODE_B'], when_value: ['5'], to: '0' } },
        { fold_settings_env: { key: 'ALFRED_CODE_ZED', when_value: '0', into: 'ALFRED_CODE_HOOKS_OFF', entry: 'some-hook:part' } },
        { id: 'file-only', remove: ['a.js'] }
    ] };
    const m = envMigrations(file);
    assert.deepEqual(m.renames, [['ALFRED_CODE_OLD', 'ALFRED_CODE_NEW']]);
    assert.deepEqual(m.retired, [['ALFRED_CODE_FOO', null], ['ALFRED_CODE_BAZ', '1']]);
    assert.deepEqual(m.reseed, [['ALFRED_CODE_BAR', 'x', 'y']]);
    assert.deepEqual(m.offWith, [['ALFRED_CODE_QUX', ['ALFRED_CODE_A', 'ALFRED_CODE_B'], ['5'], '0']]);
    assert.deepEqual(m.folds, [['ALFRED_CODE_ZED', 'ALFRED_CODE_HOOKS_OFF', 'some-hook:part', '0']]);
    assert.deepEqual(envMigrations(null), { renames: [], retired: [], reseed: [], offWith: [], folds: [] });
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

// 2.10.1 (the user's ruling of 2026-10-24): the stack ships no MCP server, so every key that pointed one of its servers
// somewhere is dead - the memory database path the install seeded and init rewrote (no ledger hash follows init's write, so
// it goes whatever it holds), and the switches a user set for a server or its route. Each goes from the file and the overlay.
const SERVER_KEYS = ['ALFRED_CODE_MEMORY_DB', 'ALFRED_CODE_MCPS_VIA_PLUGIN', 'ALFRED_CODE_UV_PYTHON', 'ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE', 'ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE', 'ALFRED_CODE_MEMORY_WARM'];
test('the retired servers\' keys go whatever they hold, from the file and the overlay alike (2.10.1)', () =>
{
    const m = envMigrations(REAL);
    for (const key of SERVER_KEYS) assert.ok(m.retired.some(([k, when]) => k === key && when === null), `${key} is retired whatever it holds`);
    const env = Object.fromEntries(SERVER_KEYS.map((k) => [k, 'x']));
    const overlay = { ALFRED_CODE_MEMORY_DB: '~/.alfred-memory/global.db', OTHER: 'y' };
    const lines = [];
    applyEnv(env, { catalog: [], migrations: m, overlay, log: (l) => lines.push(l) });
    for (const key of SERVER_KEYS) assert.ok(!(key in env), `${key} left settings.json`);
    assert.deepEqual(overlay, { OTHER: 'y' }, 'the database path a level answer rewrote leaves the overlay too');
    assert.ok(lines.some((l) => /settings\.local\.json env: ALFRED_CODE_MEMORY_DB removed \(retired - nothing reads it\)/.test(l)), lines.join('\n'));
});
