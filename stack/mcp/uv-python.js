'use strict';
// THE PYTHON EVERY uvx-LAUNCHED STACK SERVER RUNS ON - one answer, read by both launchers and by the
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
// It also RUNS uvx for both launchers (runUvx), so the pin, the exit code and the stop signal are
// handled once.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PYTHON = '3.13';
const WINDOWS_ARM_PYTHON = 'cpython-3.13-windows-x86_64-none';

// An x64 node emulated on ARM reports arch x64 and PROCESSOR_ARCHITECTURE AMD64, so the machine-wide
// PROCESSOR_IDENTIFIER ('ARMv8 (64-bit) Family 8 ...') is what still tells the truth there.
function isWindowsArm({ arch, env })
{
    if (arch === 'arm64') return true;
    if (/^arm64$/i.test(env.PROCESSOR_ARCHITECTURE || '') || /^arm64$/i.test(env.PROCESSOR_ARCHITEW6432 || '')) return true;
    return /^arm/i.test(env.PROCESSOR_IDENTIFIER || '');
}

// This machine's file before the shared one, the way Claude Code layers them.
function overrideFrom({ env, projectDir })
{
    const own = (env.ALFRED_CODE_UV_PYTHON || '').trim();
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
            const value = String(((JSON.parse(fs.readFileSync(file, 'utf8')) || {}).env || {}).ALFRED_CODE_UV_PYTHON || '').trim();
            if (value) return value;
        }
        catch { /* absent, unreadable or malformed: the next file answers */ }
    }
    return '';
}

function pythonRequest({ platform = process.platform, arch = process.arch, env = process.env, projectDir } = {})
{
    const override = overrideFrom({ env, projectDir });
    if (override) return override;
    return platform === 'win32' && isWindowsArm({ arch, env }) ? WINDOWS_ARM_PYTHON : PYTHON;
}

// uvx with the pin in front of `args`, for as long as it lives. Its exit code is the launcher's, and
// a stop signal is passed on: Claude Code stops a server by signalling the process it started - the
// launcher - and uvx, the server and its language servers would otherwise outlive it (measured: a
// SIGTERM to the launcher left the server running).
function runUvx(args, { env = process.env, cwd, projectDir, label = 'launcher' } = {})
{
    const child = spawn('uvx', ['--python', pythonRequest({ env, projectDir }), ...args], { stdio: 'inherit', env, cwd });
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

// `node uv-python.js [projectDir]` prints the request: the frozen installer twins resolve their
// @UV_PYTHON@ with it.
if (require.main === module) process.stdout.write(pythonRequest({ projectDir: process.argv[2] }));
module.exports = { pythonRequest, runUvx, PYTHON, WINDOWS_ARM_PYTHON };
