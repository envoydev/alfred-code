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
    assert.deepEqual(m.renames, [['CLAUDE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH']]);
    assert.deepEqual(m.prefixRenames, [['CLAUDE_STACK_', 'ALFRED_CODE_']]);
    // the retired/reseed key text is mapped through the prefix rename, since applyEnv's 1b pass
    // already moved any CLAUDE_STACK_* key by the time the retirement/reseed steps run.
    assert.ok(m.retired.some(([k]) => k === 'ALFRED_CODE_FRESH_SESSION_PCT'));
    assert.ok(m.reseed.some(([k]) => k === 'ALFRED_CODE_FRESH_SESSION_DEFAULT'));
});

test('an old install is migrated by the real file', () =>
{
    const env = { CLAUDE_DOCS_PATH: 'docs', CLAUDE_STACK_FRESH_SESSION_PCT: '60', CLAUDE_STACK_FRESH_SESSION_DEFAULT: '250000' };
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(env.ALFRED_CODE_DOCS_PATH, 'docs');
    assert.ok(!('CLAUDE_DOCS_PATH' in env));
    assert.ok(!('CLAUDE_STACK_DOCS_PATH' in env));
    assert.ok(!('CLAUDE_STACK_FRESH_SESSION_PCT' in env));
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_PCT' in env));
    assert.equal(env.ALFRED_CODE_FRESH_SESSION_DEFAULT, '180000');
    assert.ok(!('CLAUDE_STACK_FRESH_SESSION_DEFAULT' in env));
});

test('envMigrations maps a CLAUDE_STACK_ retirement/reseed target through the prefix rename', () =>
{
    const file = { migrations: [
        { remove_settings_env: { key: 'CLAUDE_STACK_FOO' } },
        { clear_settings_env: { key: 'CLAUDE_STACK_BAR', when_value: 'x', to: 'y' } },
        { rename_settings_env_prefix: { from: 'CLAUDE_STACK_', to: 'ALFRED_CODE_' } }
    ] };
    const m = envMigrations(file);
    assert.deepEqual(m.prefixRenames, [['CLAUDE_STACK_', 'ALFRED_CODE_']]);
    assert.deepEqual(m.retired, [['ALFRED_CODE_FOO', null]]);
    assert.deepEqual(m.reseed, [['ALFRED_CODE_BAR', 'x', 'y']]);
});

test('the prefix rename moves every old setting, after the exact renames', () =>
{
    const env = { CLAUDE_DOCS_PATH: 'docs', CLAUDE_STACK_MONITOR: 'log', ALFRED_CODE_HISTORY: '0', CLAUDE_STACK_HISTORY: '1', OTHER: 'x' };
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(env.ALFRED_CODE_DOCS_PATH, 'docs');
    assert.equal(env.ALFRED_CODE_MONITOR, 'log');
    assert.equal(env.ALFRED_CODE_HISTORY, '0', 'a value already under the new name is never overwritten');
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('CLAUDE_')), []);
    assert.equal(env.OTHER, 'x');
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
