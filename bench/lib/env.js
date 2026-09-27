'use strict';
// The environment every harness process gets - setup, onboarding and the measured session alike.
// An ALLOWLIST, not a scrub: the host's shell carries the user's own account dir, project dir and
// credentials for other services, and a denylist only removes what someone remembered to name. What
// crosses is what a build and a test run need; the account and home are the cell's own; auth crosses
// by NAME, only for a process that calls the model, and only the ONE name the run chose - in print mode
// an API key outranks the subscription token, so a second credential would decide who is billed.
//
// Every session also gets a temp dir of its own (`tmp`): Claude Code builds the sandboxed commands'
// TMPDIR from CLAUDE_CODE_TMPDIR (`<it>/claude-<uid>/`, default `/tmp`), and an unsandboxed one
// (dotnet, docker) inherits TMPDIR - so without it every parallel cell shared `/tmp/claude-<uid>`
// and read the others' build logs (first pilot). It sits under /tmp to stay SHORT: for a long
// override Claude Code hands sandboxed commands a shared fallback instead.
const fs = require('node:fs');
const path = require('node:path');

const PASS = [
    'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME',
    'DOCKER_HOST', 'DOTNET_ROOT', 'NUGET_PACKAGES', 'npm_config_cache',
    'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR',
];
const PASS_PREFIX = ['TESTCONTAINERS_'];

// `onboarding`: the arm's onboarding-only env (`onboardingEnv`, a stack's unattended switch) joins its
// own env for that one session - never for a setup step or a measured cell.
function sessionEnv({ base = process.env, session, arm, config, home, auth, tmp, bin, shared, envFile, onboarding = false })
{
    const env = {};
    for (const [k, v] of Object.entries(base))
    {
        if (v !== undefined && (PASS.includes(k) || PASS_PREFIX.some((p) => k.startsWith(p)))) env[k] = v;
    }
    Object.assign(env, { CLAUDE_CONFIG_DIR: config, HOME: home }, session.env, (arm && arm.env) || {}, (onboarding && arm && arm.onboardingEnv) || {});
    if (auth)
    {
        if (typeof auth !== 'string') throw new Error('auth names one variable, never a boolean');
        if (!session.auth.includes(auth)) throw new Error(`${auth} is not an auth variable common.json lists`);
        if (base[auth] !== undefined) env[auth] = base[auth];
    }
    // The run's shared stores (the uv cache and Python installs under the work root): every template step and
    // session sees the same ones, so an MCP server launched through uvx starts warm in every cell.
    Object.assign(env, shared || {});
    if (tmp) Object.assign(env, { TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp });
    // The session's Bash env (common.json bashEnv): a file Claude Code sources before each Bash command, so only
    // Bash commands see it - never the CLI, its hooks or its MCP servers.
    if (envFile) env.CLAUDE_ENV_FILE = envFile;
    // The harness's shims (lib/dotnet-shim.js) first, so every route to `dotnet` meets them.
    if (bin) env.PATH = env.PATH ? `${bin}${path.delimiter}${env.PATH}` : bin;
    return env;
}

// A fresh temp dir for one session, by its real path (macOS /tmp is a link); the caller removes it.
const sessionTmp = () => fs.realpathSync(fs.mkdtempSync('/tmp/bench-'));

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

module.exports = { sessionEnv, pickAuth, sessionTmp, PASS, PASS_PREFIX };
