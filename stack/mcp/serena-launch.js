#!/usr/bin/env node
'use strict';
// THE SERENA SERVER'S LAUNCHER - it picks the Python serena runs on, and where serena keeps its data.
//
// A plugin MCP entry is a fixed argv, and the right interpreter is a property of the MACHINE: 3.13
// everywhere, the x64 3.13 on Windows on ARM (uv-python.js says why). A fixed `--python` in the
// entry would be wrong on one of them, and a hand patch of the cached entry is lost on the next
// marketplace refresh - measured: the entry Claude Code launches is read from the marketplace clone,
// not the plugin cache, so a patch there too is overwritten by `claude plugin marketplace update`.
//
//   node serena-launch.js --package serena-agent@<ver> -- <serena arguments>
//
// Everything after `--` goes to serena unchanged, but for one swap below. stdout is the MCP stream:
// nothing is written to it here, diagnostics go to stderr, which Claude Code shows in the server's log.
//
// THE DATA (data-root.js): serena's per-project folder - the index cache, the handoff memories, the
// project.yml - lives at <data root>/serena, and its home (SERENA_HOME: the config, the logs, ~327MB of
// language servers) at <data root>/serena/home. serena has no flag for the folder, so the home's own
// serena_config.yml carries `project_serena_folder_location`. A move the installer recorded runs here,
// at start, before this serena holds anything - and only while no other serena does (a second session's, whose
// log names a live pid: data-root.js serenaBusy, the installer's inline check too); with none, a 2.0.0 `.serena`
// keeps serving where it is.
// `--project-from-cwd` finds the project by `.serena/project.yml` or `.git` walking UP from the cwd, so a
// project with no `.git` of its own whose folder has moved gets `--project <cwd>` instead - the literal
// directory, never the `${CLAUDE_PROJECT_DIR}` expansion that failed in a registration.
//
// SERENA_HOME is spelled in the platform's own separator, and left RELATIVE. serena 1.7.0 execs the
// TypeScript server through npm's .bin shim, so on Windows the path reaches cmd.exe UNQUOTED: a '/' in
// it is cut there ('.serena' is not recognized as an internal or external command), and an absolute
// path would be cut at the first space in the project's own path the same way. The cwd of a plugin
// server is the project (measured), so the relative home is that project's own, as on the copy route.
const fs = require('node:fs');
const path = require('node:path');
const { pythonRequest, runUvx } = require('./uv-python.js');
const dataRoot = require('./data-root.js');

const nativeHome = (value, platform = process.platform) => (platform === 'win32' ? path.win32 : path.posix).normalize(value);
// The copy route registers the same spelling - the same directory on disk either way.
const serenaHomeFor = (platform = process.platform, root = dataRoot.DATA_ROOT_DEFAULT, dir = `${root}/serena`) => nativeHome(`${dir}/home`, platform);

// Where serena's data lives this start - the move recorded for it runs now - and the home to hand it.
function serenaData({ projectDir, env = process.env, platform = process.platform, log = () => {} })
{
    const { root, source, why } = dataRoot.dataRootOf({ env, projectDir });
    if (source === 'invalid') log(`serena-launch: ALFRED_CODE_DATA_PATH refused (${why}) - using ${root}`);
    const live = dataRoot.liveDir({ projectDir, cls: 'serena', root, pending: dataRoot.pendingOf(projectDir), busy: dataRoot.serenaBusy });
    if (live.state === 'moved') log(`serena-launch: moved ${live.from} -> ${live.dir}`);
    if (live.state === 'busy' || live.state === 'failed') log(`serena-launch: ${live.dir} not moved (${live.why}) - serving it where it is this start`);
    const legacy = live.dir === dataRoot.LEGACY.serena;
    // The 2.0.0 folder keeps its own home and serena's own default folder key: nothing is written there.
    if (!legacy)
    {
        // serena's home holds ~327MB of language servers and its index: the root's .gitignore lands first.
        try { dataRoot.ensureRootIgnore({ projectDir, root, env }); }
        catch (err) { log(`serena-launch: ${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore`); }
        try
        {
            const said = dataRoot.ensureSerenaConfig(path.join(projectDir, ...`${live.dir}/home`.split('/')), live.dir);
            if (said === 'kept') log('serena-launch: serena_config.yml names its own project folder - left as it is');
        }
        catch (err) { log(`serena-launch: serena_config.yml could not be written (${err.message}) - serena falls back to .serena`); }
    }
    return { root, dir: live.dir, legacy, home: nativeHome(`${live.dir}/home`, platform) };
}

// `--project-from-cwd` stays wherever it still finds this project; otherwise the cwd itself is named.
function projectArgs(args, { projectDir, legacy })
{
    const at = args.indexOf('--project-from-cwd');
    if (at < 0 || legacy || fs.existsSync(path.join(projectDir, '.git'))) return args;
    return [...args.slice(0, at), '--project', projectDir, ...args.slice(at + 1)];
}

function main(argv)
{
    const at = argv.indexOf('--package');
    const rest = argv.indexOf('--');
    // The pin is passed in by the generated plugin entry (meta/mcp-pins.json owns the version), so
    // an absent flag means the entry was hand-edited - say so rather than launch something else.
    if (at < 0 || !argv[at + 1] || argv[at + 1] === '--')
    {
        process.stderr.write('serena-launch: --package <spec> is required (the plugin entry passes it)\n');
        return 2;
    }
    const spec = argv[at + 1];
    const projectDir = process.cwd();
    const log = (line) => process.stderr.write(`${line}\n`);
    const data = serenaData({ projectDir, log });
    const args = projectArgs(rest < 0 ? [] : argv.slice(rest + 1), { projectDir, legacy: data.legacy });
    const env = { ...process.env, SERENA_HOME: data.home };
    log(`serena-launch: ${spec}, python ${pythonRequest({ env, projectDir })}, home ${env.SERENA_HOME}`);
    runUvx(['--from', spec, 'serena', ...args], { env, projectDir, label: 'serena-launch' });
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, nativeHome, serenaHomeFor, serenaData, projectArgs };
