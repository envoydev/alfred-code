'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sessionEnv, pickAuth } = require('./env.js');

const SESSION = { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, auth: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'], scrub: ['CONTEXT7_API_KEY'] };
const BASE = {
    PATH: '/usr/bin', LANG: 'en_US.UTF-8', TMPDIR: '/tmp/x', DOCKER_HOST: 'unix:///d.sock', TESTCONTAINERS_RYUK_DISABLED: 'true',
    HOME: '/Users/real', CLAUDE_CONFIG_DIR: '/Users/real/.claude', CLAUDE_PROJECT_DIR: '/real/project',
    CONTEXT7_API_KEY: 'k', SENTRY_ACCESS_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's', ANTHROPIC_API_KEY: 'auth-value',
};

test('only the allowlist crosses from the host, and the cell\'s own account and home replace the host\'s', () =>
{
    const env = sessionEnv({ base: BASE, session: SESSION, arm: { env: { ARM_ONLY: 'a' } }, config: '/c/config', home: '/c/home', auth: false });
    assert.deepStrictEqual(env, {
        PATH: '/usr/bin', LANG: 'en_US.UTF-8', TMPDIR: '/tmp/x', DOCKER_HOST: 'unix:///d.sock', TESTCONTAINERS_RYUK_DISABLED: 'true',
        CLAUDE_CONFIG_DIR: '/c/config', HOME: '/c/home', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', ARM_ONLY: 'a',
    });
});

test('auth crosses by name only when asked, and only the one name the run chose', () =>
{
    const base = { ...BASE, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-value' };
    const env = sessionEnv({ base, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: 'CLAUDE_CODE_OAUTH_TOKEN' });
    assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-value');
    assert.ok(!('ANTHROPIC_API_KEY' in env), 'a second credential in the shell never crosses: in print mode a key outranks the token');
    assert.ok(!('ANTHROPIC_AUTH_TOKEN' in env), 'an unset auth name is not invented');
    assert.ok(!('CONTEXT7_API_KEY' in env) && !('SENTRY_ACCESS_TOKEN' in env) && !('CLAUDE_PROJECT_DIR' in env));
});

test('auth is one name common.json lists, never a boolean or a stray variable', () =>
{
    const at = (auth) => () => sessionEnv({ base: BASE, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth });
    assert.throws(at(true), /auth names one variable/);
    assert.throws(at('AWS_SECRET_ACCESS_KEY'), /AWS_SECRET_ACCESS_KEY is not an auth variable common.json lists/);
});

test('the run picks exactly one credential: the only one set, or the one --auth names', () =>
{
    const names = SESSION.auth;
    assert.strictEqual(pickAuth(names, { ANTHROPIC_API_KEY: 'k' }), 'ANTHROPIC_API_KEY');
    assert.strictEqual(pickAuth(names, { CLAUDE_CODE_OAUTH_TOKEN: 't' }), 'CLAUDE_CODE_OAUTH_TOKEN');
    assert.strictEqual(pickAuth(names, { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' }, 'CLAUDE_CODE_OAUTH_TOKEN'), 'CLAUDE_CODE_OAUTH_TOKEN');
    assert.throws(() => pickAuth(names, {}), /no auth variable is set \(ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN\)/);
    assert.throws(() => pickAuth(names, { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' }), /more than one auth variable is set \(ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN\) - pass --auth <name>/);
    assert.throws(() => pickAuth(names, { ANTHROPIC_API_KEY: 'k' }, 'CLAUDE_CODE_OAUTH_TOKEN'), /--auth CLAUDE_CODE_OAUTH_TOKEN is not set in this shell/);
    assert.throws(() => pickAuth(names, { OTHER: 'x' }, 'OTHER'), /--auth OTHER is not one of ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN/);
    assert.throws(() => pickAuth(names, { ANTHROPIC_API_KEY: '' }), /no auth variable is set/, 'an empty value is not a credential');
});
