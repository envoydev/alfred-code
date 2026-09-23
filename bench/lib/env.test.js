'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sessionEnv } = require('./env.js');

const SESSION = { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, auth: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], scrub: ['CONTEXT7_API_KEY'] };
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

test('auth crosses by name only when asked, and only the names common.json lists', () =>
{
    const env = sessionEnv({ base: BASE, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: true });
    assert.strictEqual(env.ANTHROPIC_API_KEY, 'auth-value');
    assert.ok(!('ANTHROPIC_AUTH_TOKEN' in env), 'an unset auth name is not invented');
    assert.ok(!('CONTEXT7_API_KEY' in env) && !('SENTRY_ACCESS_TOKEN' in env) && !('CLAUDE_PROJECT_DIR' in env));
});
