#!/usr/bin/env node
'use strict';
// THE BROWSER SERVERS' LAUNCHER - one per engine (chrome-control, msedge-, firefox-, webkit-control), each
// running Playwright MCP with a PERSISTENT profile: the cookies and storage of whatever site a check
// logged into.
//
//   node browser-launch.js --package @playwright/mcp@<ver> --browser <engine> [-- <more server arguments>]
//
// It exists for the profile's place. A plugin entry can only spell a fixed path, and the profile belongs
// under the project's data root (ALFRED_CODE_DATA_PATH, default .alfred - data-root.js), which is a
// PROJECT setting a plugin entry never sees. So the launcher resolves <root>/<engine>-control, runs a
// move the installer recorded once no browser holds the profile (Chromium's Singleton* lock, Firefox's
// `lock`), and otherwise serves an older profile where it is - the 2.1.0 shared <root>/browser/<engine>, or a
// 2.0.0 .playwright/<engine>. The paths are
// ABSOLUTE: Playwright MCP resolves a relative one against its own cwd rules, and the entry used
// ${CLAUDE_PROJECT_DIR} for the same reason.
//
// `--no-webmcp` on every start (I11): Playwright MCP 0.0.82 collects the tools a visited PAGE registers
// through the WebMCP API and lists them beside its own, enabled by default ('Tool names, descriptions,
// schemas and results come from the page', the v0.0.82 release notes) - a page is data, never a toolbox.
// The copy route's registration carries the same flag (meta/stack-manifest.json, the browser row).
//
// `--secrets <the project's sensitive data>` when the store exists (audit 2026-10-14 PL2, the user's ruling of
// 2026-10-14): Playwright MCP reads the dotenv itself, fills a field typed as a KEY name with its value
// (browser_type, browser_fill_form - `lookupSecret`) and writes every value back as <secret>KEY</secret> in its
// responses (`redactSecrets`; playwright-core's coreBundle.js, the @playwright/mcp 0.0.83 pin). The values never enter
// the server's environment, which browser_run_code_unsafe can reach. Its own README calls the masking 'a convenience
// and not a security feature', so the secret guard stays the gate. A UTF-16 store (Notepad's 'Unicode') or one that
// cannot be read is not passed - Playwright reads the file as UTF-8 and stops at a read error - and one line says so.
//
// stdout is the MCP stream: nothing is written to it here, diagnostics go to stderr. The spawn is the
// installer's Windows-safe one (scripts/install/runtime.js - the plugin tree is the whole repo): npx is a
// batch file on Windows, which Node starts only through cmd.exe since the CVE-2024-27980 fix.
const fs = require('node:fs');
const path = require('node:path');
const dataRoot = require('./data-root.js');

// ['--secrets', <absolute path>] for the store this project's checkout (or its main worktree) holds, [] with none.
function secretsArgs({ projectDir, root, log = () => {} })
{
    const file = dataRoot.sensitivePlaceOf({ projectDir, root });
    if (!file) return [];
    let head;
    try { const fd = fs.openSync(file, 'r'); try { head = Buffer.alloc(2); fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); } }
    catch (err) { log(`browser-launch: ${file} could not be read (${err.code || err.message}) - started without the project's sensitive data`); return []; }
    if (head[0] === 0xff && head[1] === 0xfe)
    {
        log(`browser-launch: ${file} is UTF-16 - Playwright MCP reads it as UTF-8; save it as UTF-8 for the browser to type its keys`);
        return [];
    }
    return ['--secrets', path.resolve(file)];
}

function browserArgs({ spec, engine, projectDir, env = process.env, extra = [], log = () => {} })
{
    const { root, source, why } = dataRoot.dataRootOf({ env, projectDir });
    if (source === 'invalid') log(`browser-launch: ALFRED_CODE_DATA_PATH refused (${why}) - using ${root}`);
    const cls = dataRoot.engineServer(engine);
    const live = dataRoot.liveDir({ projectDir, cls, root, pending: dataRoot.pendingOf(projectDir), busy: dataRoot.profileLocks });
    if (live.state === 'moved') log(`browser-launch: moved ${live.from} -> ${live.dir}`);
    if (live.state === 'busy' || live.state === 'failed') log(`browser-launch: ${live.dir} not moved (${live.why}) - serving it where it is this start`);
    // A profile under the root holds session cookies: the root's .gitignore lands before Playwright writes one.
    if (live.dir !== dataRoot.legacyOf(cls))
    {
        try { dataRoot.ensureRootIgnore({ projectDir, root, env }); }
        catch (err) { log(`browser-launch: ${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore`); }
    }
    const profile = path.join(projectDir, ...live.dir.split('/'));
    return ['-y', spec, '--browser', engine, '--user-data-dir', profile, '--output-dir', path.join(profile, 'output'), '--no-webmcp', ...secretsArgs({ projectDir, root, log }), ...extra];
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
    // Re-verify 3 S3: the checkout the launch directory belongs to (memory.js projectRootOf), never a subdirectory or an
    // inherited CLAUDE_PROJECT_DIR - the profile lands under that checkout's data root, which its .gitignore covers.
    const projectDir = require('../hooks/memory.js').projectRootOf(process.cwd()).checkout;
    const log = (line) => process.stderr.write(`${line}\n`);
    const args = browserArgs({ spec, engine, projectDir, extra: rest < 0 ? [] : argv.slice(rest + 1), log });
    const secrets = args.indexOf('--secrets');
    log(`browser-launch: ${spec} ${engine}, profile ${args[args.indexOf('--user-data-dir') + 1]}${secrets >= 0 ? `, sensitive data ${args[secrets + 1]} (typed by KEY name, masked in responses)` : ''}`);
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
module.exports = { main, browserArgs, secretsArgs };
