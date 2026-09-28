#!/usr/bin/env node
'use strict';
// THE BROWSER SERVERS' LAUNCHER - one per engine (browser-chrome, -msedge, -firefox, -webkit), each
// running Playwright MCP with a PERSISTENT profile: the cookies and storage of whatever site a check
// logged into.
//
//   node browser-launch.js --package @playwright/mcp@<ver> --browser <engine> [-- <more server arguments>]
//
// It exists for the profile's place. A plugin entry can only spell a fixed path, and the profile belongs
// under the project's data root (ALFRED_CODE_DATA_PATH, default .alfred - data-root.js), which is a
// PROJECT setting a plugin entry never sees. So the launcher resolves <root>/browser/<engine>, runs a
// move the installer recorded once no browser holds the profile (Chromium's Singleton* lock, Firefox's
// `lock`), and otherwise serves a 2.0.0 profile at .playwright/<engine> where it is. The paths are
// ABSOLUTE: Playwright MCP resolves a relative one against its own cwd rules, and the entry used
// ${CLAUDE_PROJECT_DIR} for the same reason.
//
// stdout is the MCP stream: nothing is written to it here, diagnostics go to stderr. The spawn is the
// installer's Windows-safe one (scripts/install/runtime.js - the plugin tree is the whole repo): npx is a
// batch file on Windows, which Node starts only through cmd.exe since the CVE-2024-27980 fix.
const path = require('node:path');
const dataRoot = require('./data-root.js');

function browserArgs({ spec, engine, projectDir, env = process.env, extra = [], log = () => {} })
{
    const { root, source, why } = dataRoot.dataRootOf({ env, projectDir });
    if (source === 'invalid') log(`browser-launch: ALFRED_CODE_DATA_PATH refused (${why}) - using ${root}`);
    const live = dataRoot.liveDir({ projectDir, cls: `browser-${engine}`, root, pending: dataRoot.pendingOf(projectDir), busy: dataRoot.profileLocks });
    if (live.state === 'moved') log(`browser-launch: moved ${live.from} -> ${live.dir}`);
    if (live.state === 'busy' || live.state === 'failed') log(`browser-launch: ${live.dir} not moved (${live.why}) - serving it where it is this start`);
    const profile = path.join(projectDir, ...live.dir.split('/'));
    return ['-y', spec, '--browser', engine, '--user-data-dir', profile, '--output-dir', path.join(profile, 'output'), ...extra];
}

function main(argv)
{
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && argv[i + 1] !== '--' ? argv[i + 1] : null; };
    const spec = flag('--package');
    const engine = flag('--browser');
    // Both come from the generated plugin entry (meta/mcp-pins.json owns the version): an absent one
    // means the entry was hand-edited - say so rather than launch something else.
    if (!spec || !engine || !dataRoot.ENGINES.includes(engine))
    {
        process.stderr.write(`browser-launch: --package <spec> and --browser <${dataRoot.ENGINES.join('|')}> are required (the plugin entry passes both)\n`);
        return 2;
    }
    const rest = argv.indexOf('--');
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const log = (line) => process.stderr.write(`${line}\n`);
    const args = browserArgs({ spec, engine, projectDir, extra: rest < 0 ? [] : argv.slice(rest + 1), log });
    log(`browser-launch: ${spec} ${engine}, profile ${args[args.indexOf('--user-data-dir') + 1]}`);
    const { spawnCommandAsync } = require('../../scripts/install/runtime.js');
    const child = spawnCommandAsync('npx', args, { stdio: 'inherit', env: process.env, cwd: projectDir });
    // A stop signal is passed on: Claude Code stops a server by signalling the process it started.
    const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, forward);
    child.on('error', (err) => { process.stderr.write(`browser-launch: could not start npx - ${err.message}\n`); process.exit(1); });
    child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, browserArgs };
