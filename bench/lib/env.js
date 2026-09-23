'use strict';
// The environment every harness process gets - setup, onboarding and the measured session alike.
// An ALLOWLIST, not a scrub: the host's shell carries the user's own account dir, project dir and
// credentials for other services, and a denylist only removes what someone remembered to name. What
// crosses is what a build and a test run need; the account and home are the cell's own; auth crosses
// by NAME, only for a process that calls the model.
const PASS = [
    'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME',
    'DOCKER_HOST', 'DOTNET_ROOT', 'NUGET_PACKAGES', 'npm_config_cache',
    'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR',
];
const PASS_PREFIX = ['TESTCONTAINERS_'];

function sessionEnv({ base = process.env, session, arm, config, home, auth })
{
    const env = {};
    for (const [k, v] of Object.entries(base))
    {
        if (v !== undefined && (PASS.includes(k) || PASS_PREFIX.some((p) => k.startsWith(p)))) env[k] = v;
    }
    Object.assign(env, { CLAUDE_CONFIG_DIR: config, HOME: home }, session.env, (arm && arm.env) || {});
    if (auth) for (const name of session.auth) if (base[name] !== undefined) env[name] = base[name];
    return env;
}

module.exports = { sessionEnv, PASS, PASS_PREFIX };
