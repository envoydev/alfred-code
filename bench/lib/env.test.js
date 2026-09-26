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

test('an arm\'s onboarding-only env crosses to an onboarding alone, never to a measured session', () =>
{
    const arm = { env: { ARM_ONLY: 'a' }, onboardingEnv: { STACK_UNATTENDED: '1' } };
    const measured = sessionEnv({ base: BASE, session: SESSION, arm, config: '/c/config', home: '/c/home', auth: false });
    assert.ok(!('STACK_UNATTENDED' in measured), 'a measured cell never takes recommended answers on its own');
    assert.strictEqual(measured.ARM_ONLY, 'a');
    const onboarding = sessionEnv({ base: BASE, session: SESSION, arm, config: '/c/config', home: '/c/home', auth: false, onboarding: true });
    assert.deepStrictEqual([onboarding.STACK_UNATTENDED, onboarding.ARM_ONLY], ['1', 'a']);
});

test('a session\'s own temp dir replaces the host\'s TMPDIR, for sandboxed and unsandboxed commands alike', () =>
{
    const env = sessionEnv({ base: BASE, session: { ...SESSION, env: { ...SESSION.env, TMPDIR: '/shared' } }, arm: { env: {} }, config: '/c', home: '/h', auth: false, tmp: '/private/tmp/bench-a1' });
    assert.strictEqual(env.TMPDIR, '/private/tmp/bench-a1', 'what an unsandboxed command (dotnet, docker) inherits');
    assert.strictEqual(env.CLAUDE_CODE_TMPDIR, '/private/tmp/bench-a1', 'the base Claude Code builds the sandboxed TMPDIR from');
    assert.strictEqual(sessionEnv({ base: BASE, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: false }).TMPDIR, '/tmp/x', 'no temp dir named: the host\'s passes');
});

test('the harness\'s own bin dir goes first on the PATH, so its dotnet shim wins', () =>
{
    const env = sessionEnv({ base: BASE, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: false, bin: '/w/cell/bin' });
    assert.strictEqual(env.PATH, `/w/cell/bin${require('node:path').delimiter}/usr/bin`);
    assert.strictEqual(sessionEnv({ base: BASE, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: false }).PATH, '/usr/bin');
});

test('the harness\'s shared stores cross to every session, and nothing an arm says can move them', () =>
{
    const shared = { UV_CACHE_DIR: '/w/uv/cache', UV_PYTHON_INSTALL_DIR: '/w/uv/python' };
    const env = sessionEnv({ base: { ...BASE, UV_CACHE_DIR: '/host/uv' }, session: SESSION, arm: { env: {} }, config: '/c', home: '/h', auth: false, shared });
    assert.deepStrictEqual([env.UV_CACHE_DIR, env.UV_PYTHON_INSTALL_DIR], ['/w/uv/cache', '/w/uv/python']);
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
