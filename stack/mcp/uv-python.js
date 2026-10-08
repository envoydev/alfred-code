'use strict';
// THE PYTHON EVERY uvx-LAUNCHED STACK SERVER RUNS ON - one answer, read by every launcher and by the
// installer's copy route, so the plugin entries and a .mcp.json registration can never disagree.
//
// uvx takes the newest interpreter it can find or download, and that is the failure: serena-agent
// 1.7.0 pins pyyaml 6.0.2, which ships no CPython 3.14 wheel on any platform, so a machine holding
// 3.14 compiles pyyaml from source and the server dies at start-up without a C compiler (Claude Code
// shows only CONNECTION_CLOSED). Windows on ARM is worse: cryptography, psutil, tiktoken, pyyaml and
// ruamel.yaml.clib ship no ARM64 wheel on ANY Python, while the x64 CPython runs there under the
// OS's own emulation with every wheel (docs/uv-python-pin-evidence.md).
//
//   ALFRED_CODE_UV_PYTHON   a uv python request that replaces the choice below (e.g. 3.12), read
//                            from the shell env, then the project's settings.local.json, its
//                            settings.json and the account settings.json `env` - a plugin server never
//                            sees a PROJECT settings env key (memory-launch.js says why), so the files
//                            are read here rather than trusted to arrive
//
// It also RUNS uvx for every launcher (runUvx), so the pin, the exit code and the stop signal are
// handled once.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PYTHON = '3.13';
const WINDOWS_ARM_PYTHON = 'cpython-3.13-windows-x86_64-none';

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset. This file ships without hook-prelude.js
// (a plugin server, not a hook), so its own copy of envOf is inline - pinned with the hooks' copy as
// env-reader (meta/shared-rules.json).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}

// An x64 node emulated on ARM reports arch x64 and PROCESSOR_ARCHITECTURE AMD64, so the machine-wide
// PROCESSOR_IDENTIFIER ('ARMv8 (64-bit) Family 8 ...') is what still tells the truth there.
function isWindowsArm({ arch, env })
{
    if (arch === 'arm64') return true;
    if (/^arm64$/i.test(env.PROCESSOR_ARCHITECTURE || '') || /^arm64$/i.test(env.PROCESSOR_ARCHITEW6432 || '')) return true;
    return /^arm/i.test(env.PROCESSOR_IDENTIFIER || '');
}

// One ALFRED_CODE_<suffix> setting as a launcher sees it: the shell env, then this machine's file before
// the shared one, the way Claude Code layers them - a plugin server never gets a PROJECT settings env
// key, so the files are read here. '' when none of them names it. `key` reads another tool's own variable
// by its exact name instead (UV_EXCLUDE_NEWER), with no ALFRED_CODE_ or legacy spelling.
function settingFrom({ env, projectDir, suffix, key })
{
    const read = key ? (e) => e[key] : (e) => envOf(e, suffix);
    const own = String(read(env) || '').trim();
    if (own || !projectDir) return own;
    const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const file of [
        path.join(projectDir, '.claude', 'settings.local.json'),
        path.join(projectDir, '.claude', 'settings.json'),
        path.join(account, 'settings.json'),
    ])
    {
        try
        {
            const value = String(read((JSON.parse(fs.readFileSync(file, 'utf8')) || {}).env || {}) || '').trim();
            if (value) return value;
        }
        catch { /* absent, unreadable or malformed: the next file answers */ }
    }
    return '';
}

const overrideFrom = ({ env, projectDir }) => settingFrom({ env, projectDir, suffix: 'UV_PYTHON' });

function pythonRequest({ platform = process.platform, arch = process.arch, env = process.env, projectDir } = {})
{
    const override = overrideFrom({ env, projectDir });
    if (override) return override;
    return platform === 'win32' && isWindowsArm({ arch, env }) ? WINDOWS_ARM_PYTHON : PYTHON;
}

// THE DEPENDENCY CUT-OFF. The pin fixes the top package only; its dependencies float, so two starts a week
// apart could resolve different trees - the drift the pins exist to stop. uv's `--exclude-newer` takes only
// what was uploaded before a date, and the date is the pins file's own `refreshed` day (UTC, the day the
// refresh saw every pinned release), spelled as that day's last second in RFC 3339 so no machine's time
// zone moves it (docs.astral.sh/uv/concepts/resolution, 'Reproducible resolutions'). The plugin entry and
// the copy-route row each carry it beside the pin they were generated with, so the two never disagree.
// '' for a missing or malformed day: ship without the cut-off rather than a flag uv refuses.
const excludeNewerOf = (refreshed) => (/^\d{4}-\d{2}-\d{2}$/.test(String(refreshed || '')) ? `${refreshed}T23:59:59Z` : '');
const EXCLUDE_NEWER_SHAPE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

// UV_EXCLUDE_NEWER as the user set it - uv's own variable, read where the stack reads its other settings (the
// env, then settings.local.json, settings.json and the account settings.json `env`), since a plugin server never
// sees a PROJECT settings env key. An index that publishes no PEP 700 upload time (a private mirror) makes every
// file unavailable under a cut-off, and uv's error never names the cut-off; `false` lifts it
// (docs.astral.sh/uv/reference/environment, UV_EXCLUDE_NEWER).
const userExcludeNewer = ({ env = process.env, projectDir } = {}) => settingFrom({ env, projectDir, key: 'UV_EXCLUDE_NEWER' });

// The cut-off a row registers where no launcher runs (the copy route, init's index command): the release's, unless
// the user set their own - that value verbatim (uv reads it; a flag would beat their variable), or none for `false`.
const cutoffFor = (release, own) => (!own ? release : /^false$/i.test(own) ? '' : own);

// The cut-off a launcher hands uvx: the entry's own, unless the user set UV_EXCLUDE_NEWER themselves -
// uv's own variable, which the flag would override (`false` lifts it). A malformed value is dropped.
function excludeNewerArgs(value, { env = process.env, log = () => {} } = {})
{
    const own = String((env && env.UV_EXCLUDE_NEWER) || '').trim();
    if (!value) return [];
    if (own) { log(`UV_EXCLUDE_NEWER=${own} is set - it replaces the release cut-off ${value}`); return []; }
    if (!EXCLUDE_NEWER_SHAPE.test(value)) { log(`--exclude-newer ${value} is not a date - started without the cut-off`); return []; }
    return ['--exclude-newer', value];
}

// uvx with the pin in front of `args`, for as long as it lives. Its exit code is the launcher's, and
// a stop signal is passed on: Claude Code stops a server by signalling the process it started - the
// launcher - and uvx, the server and its language servers would otherwise outlive it (measured: a
// SIGTERM to the launcher left the server running).
function runUvx(args, { env: given = process.env, cwd, projectDir, label = 'launcher', excludeNewer = '' } = {})
{
    // A UV_EXCLUDE_NEWER only a settings file names is put where uv reads it - the child's own environment.
    const own = String(given.UV_EXCLUDE_NEWER || '').trim() ? '' : userExcludeNewer({ env: given, projectDir });
    const env = own ? { ...given, UV_EXCLUDE_NEWER: own } : given;
    const cutoff = excludeNewerArgs(excludeNewer, { env, log: (line) => process.stderr.write(`${label}: ${line}\n`) });
    const child = spawn('uvx', ['--python', pythonRequest({ env, projectDir }), ...cutoff, ...args], { stdio: 'inherit', env, cwd });
    const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, forward);
    child.on('error', err =>
    {
        process.stderr.write(`${label}: could not start uvx - ${err.message}\n`);
        process.exit(1);
    });
    child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
    return child;
}

module.exports = { pythonRequest, runUvx, settingFrom, excludeNewerOf, excludeNewerArgs, userExcludeNewer, cutoffFor, PYTHON, WINDOWS_ARM_PYTHON };
