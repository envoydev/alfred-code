'use strict';
// The environment every harness process gets - setup, onboarding and the measured session alike.
// An ALLOWLIST, not a scrub: the host's shell carries the user's own account dir, project dir and
// credentials for other services, and a denylist only removes what someone remembered to name. What
// crosses is what a build and a test run need; the account and home are the cell's own; auth crosses
// by NAME, only for a process that calls the model, and only the ONE name the run chose - in print mode
// an API key outranks the subscription token, so a second credential would decide who is billed.
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
    if (auth)
    {
        if (typeof auth !== 'string') throw new Error('auth names one variable, never a boolean');
        if (!session.auth.includes(auth)) throw new Error(`${auth} is not an auth variable common.json lists`);
        if (base[auth] !== undefined) env[auth] = base[auth];
    }
    return env;
}

// The one credential a run's sessions get: the name --auth gave, else the only listed name set.
function pickAuth(names, base, chosen)
{
    if (chosen)
    {
        if (!names.includes(chosen)) throw new Error(`--auth ${chosen} is not one of ${names.join(', ')}`);
        if (!base[chosen]) throw new Error(`--auth ${chosen} is not set in this shell`);
        return chosen;
    }
    const present = names.filter((name) => base[name]);
    if (!present.length) throw new Error(`no auth variable is set (${names.join(' or ')}) - the sessions could not call the model`);
    if (present.length > 1) throw new Error(`more than one auth variable is set (${present.join(', ')}) - pass --auth <name>: in print mode an API key outranks the subscription token and bills the Console`);
    return present[0];
}

module.exports = { sessionEnv, pickAuth, PASS, PASS_PREFIX };
