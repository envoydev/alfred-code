#!/usr/bin/env node
'use strict';
// THE SENTRY AUTH HEADER, built rather than declared.
//
// Sentry's hosted MCP takes an API token in token mode and NO header at all in oauth mode, and the
// two must never be mixed. A static `headers` block cannot express 'sometimes absent', so the entry
// uses `headersHelper` - a command whose stdout becomes the request headers.
//
// Three measured facts shape this file (docs/plugin-migration-evidence.md, 'Phase 6 spikes'):
//   - `headersHelper` is a STRING command, not an object. The object form is rejected silently and
//     takes the whole server with it, down to `MCP servers (0)` with no error printed anywhere.
//   - Its cwd is the PLUGIN root, not the project, and CLAUDE_PROJECT_DIR is absent from its
//     environment - but ${CLAUDE_PROJECT_DIR} expands inside the helper STRING, so the project
//     arrives as argv[0].
//   - Settings-env keys do NOT expand in that string, so the token cannot be passed as an argument.
//     That is the better shape anyway: the token never reaches a command line, so it never reaches
//     `ps`. This file reads it and prints it, and prints nothing else, ever.
//
// And one fact from the docs that decides where the token has to LIVE: a `headersHelper` supplied by
// a plugin or a project `.mcp.json` runs WITHOUT the credential variables from the environment -
// Claude Code removes every variable whose name carries TOKEN, SECRET, PASSWORD, KEY or AUTH in
// either case (https://code.claude.com/docs/en/mcp, 'Which variables a helper can read'). Both keys
// this file reads are such names, so on the plugin route neither `SENTRY_ACCESS_TOKEN` nor
// `ALFRED_CODE_SENTRY_AUTH` can arrive through the shell, whatever the user exported. The FILES are
// the route that works there, which is why the installer writes the token into the account
// settings.json rather than trusting an export. The env branch below stays for the copy route and
// for running this file by hand, where nothing is removed.
//
// Output is ONE JSON object on stdout. Anything else - a log line, a warning, a stack trace - is
// read as headers and breaks every request, so every diagnostic goes to stderr and every failure
// prints `{}` (no header), which is exactly what oauth mode wants and what a missing token should
// degrade to.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function envFrom(file)
{
    try
    {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return (parsed && parsed.env) || {};
    }
    catch { return {}; }
}

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*. This helper ships without
// hook-prelude.js (a plugin server, not a hook), so its own copy of envOf is inline - pinned with
// the hooks' copy as env-legacy-fallback (meta/shared-rules.json). SENTRY_ACCESS_TOKEN is not
// renamed and never runs through this - only the ALFRED_CODE_SENTRY_AUTH mode switch does.
function envOf(env, suffix)
{
    const fresh = env[`ALFRED_CODE_${suffix}`];
    if (fresh !== undefined && fresh !== '') return fresh;
    const old = env[`CLAUDE_STACK_${suffix}`]; // legacy-name
    if (old !== undefined && old !== '') return old;
    return suffix === 'DOCS_PATH' ? env.CLAUDE_DOCS_PATH : old; // legacy-name
}

function accountDir()
{
    if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
    return path.join(os.homedir(), '.claude');
}

// The mode may be pinned per project (a repo whose org uses oauth while the account default is a
// token); the token itself is ACCOUNT-level by design, because it is one credential per human.
// Order: environment, project settings, project local settings, account settings. On the plugin
// route the environment step never answers for these two names (see the scrubbing note above), so
// the file steps are the ones that actually run - they are not a fallback there, they are the path.
// `legacySuffix` names the ALFRED_CODE_<suffix> setting's pre-2.0.0 CLAUDE_STACK_<suffix> spelling
// (envOf above); SENTRY_ACCESS_TOKEN is a plain credential name, never renamed, so it passes none.
function lookup(key, projectDir, legacySuffix)
{
    const pick = (src) => (legacySuffix ? envOf(src, legacySuffix) : src[key]);
    const direct = pick(process.env);
    if (direct) return direct;
    const files = [];
    if (projectDir) files.push(path.join(projectDir, '.claude', 'settings.json'),
        path.join(projectDir, '.claude', 'settings.local.json'));
    files.push(path.join(accountDir(), 'settings.json'));
    for (const file of files)
    {
        const value = pick(envFrom(file));
        if (value) return value;
    }
    return '';
}

function headers(projectDir)
{
    const mode = (lookup('ALFRED_CODE_SENTRY_AUTH', projectDir, 'SENTRY_AUTH') || 'token').toLowerCase();
    if (mode === 'oauth') return {};   // the browser consent flow registers no header at all
    const token = lookup('SENTRY_ACCESS_TOKEN', projectDir);
    if (!token)
    {
        // A LENGTH, never a value - and here not even that, since there is nothing to measure.
        process.stderr.write('sentry-headers: SENTRY_ACCESS_TOKEN is absent from the account settings env - sending no auth header. '
            + 'A shell export does not reach this helper on the plugin route: Claude Code removes credential-named variables from it. '
            + 'Put the token in the account settings.json env block.\n');
        return {};
    }
    // 'Sentry-Bearer' is the API-token scheme; a plain 'Bearer' is rejected as invalid_token.
    return { Authorization: `Sentry-Bearer ${token}` };
}

if (require.main === module)
{
    let out = {};
    try { out = headers(process.argv[2] || ''); }
    catch (err) { process.stderr.write(`sentry-headers: ${err.message}\n`); }
    process.stdout.write(JSON.stringify(out));
}
module.exports = { headers, lookup, envFrom, accountDir };
