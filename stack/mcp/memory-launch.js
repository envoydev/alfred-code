#!/usr/bin/env node
'use strict';
// THE MEMORY SERVER'S LAUNCHER - it exists for exactly one reason.
//
// The memory database's path is the INSTALL's level choice (global ~/.alfred-memory/memory.db, scoped
// ~/.alfred-memory/memory_<space>.db, project <project>/<data root>/.alfred-memory/memory.db), so it
// differs per project. A plugin MCP entry cannot read that: measured 2026-09-22, a plugin entry expands ${KEY}
// from the SHELL and the ACCOUNT settings.json env only - a PROJECT .claude/settings.json env key
// arrives as the literal ${KEY} (docs/plugin-migration-evidence.md, 'Phase 6 spikes'; S10's note to
// the contrary is retracted there).
//
// What a plugin server DOES get is a cwd equal to the project directory - also measured - so this
// launcher reads the project's own settings.json, resolves the path, and execs the real server.
// It never prints the path to stdout: stdout is the MCP stream, and one stray line kills the
// session. Diagnostics go to stderr, which Claude Code shows in the server's log.
//
//   node memory-launch.js --package 'mcp-memory-service[sqlite]==<ver>'
//
// Resolution order for the database, first hit wins:
//   1. MCP_MEMORY_SQLITE_PATH already in the environment - someone set it deliberately, obey it
//   2. ALFRED_CODE_MEMORY_DB in <cwd>/.claude/settings.local.json `env` (a per-machine override -
//      read BEFORE the shared file, the same order uv-python.js already uses: I7, R47 fix round 1.
//      A local-scope install (T16) now writes this key ONLY here, so reading the shared file first
//      would open the wrong project's database whenever both files register one.)
//   3. ALFRED_CODE_MEMORY_DB in <cwd>/.claude/settings.json `env`      (the install's choice)
//   4. ALFRED_CODE_MEMORY_DB in the ACCOUNT settings.json `env`
//   5. ~/.alfred-memory/memory.db - the global default, which is what a fresh install picks
//
// Then the database is found where it LIVES (data-root.js): the 2.0.0 folder was ~/.memory-mcp, shared by
// every Claude account and by Cursor. It moves to ~/.alfred-memory here, at start, only when no database
// in it is open (no -wal / -shm beside it), and the old path is left as a link so everything still
// configured with it reaches the same file. While another server holds it, it is served where it is -
// never a second, empty database beside the live one. A project-level database moves under the data root
// the same way, when the installer recorded that move in the stamp.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runUvx } = require('./uv-python.js');
const dataRoot = require('./data-root.js');

function envFrom(file)
{
    try
    {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return (parsed && parsed.env) || {};
    }
    catch { return {}; }   // absent, unreadable or malformed is not a failure - fall through
}

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*. This launcher ships without // legacy-name
// hook-prelude.js (a plugin server, not a hook), so its own copy of envOf is inline - pinned with
// the hooks' copy as env-legacy-fallback (meta/shared-rules.json).
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

function resolveDb(projectDir)
{
    if (process.env.MCP_MEMORY_SQLITE_PATH) return process.env.MCP_MEMORY_SQLITE_PATH;
    for (const file of [
        path.join(projectDir, '.claude', 'settings.local.json'),
        path.join(projectDir, '.claude', 'settings.json'),
        path.join(accountDir(), 'settings.json'),
    ])
    {
        const value = envOf(envFrom(file), 'MEMORY_DB');
        if (value) return path.isAbsolute(value) ? value : path.join(projectDir, value);
    }
    return path.join(os.homedir(), dataRoot.MEMORY_FOLDER, 'memory.db');
}

// The configured database as it lives this start: a pending move runs first (the home folder when the
// path is in either home folder, a project folder the installer recorded), then an unmoved one is served
// at its old place.
function liveDb(db, { projectDir, home = os.homedir(), log = () => {}, symlink } = {})
{
    const inHome = [dataRoot.MEMORY_FOLDER, dataRoot.LEGACY_MEMORY_FOLDER].some((f) => path.dirname(path.normalize(db)) === path.join(home, f));
    if (inHome)
    {
        const moved = dataRoot.moveHomeMemory({ home, ...(symlink ? { symlink } : {}) });
        const file = path.join(home, dataRoot.MEMORY_FOLDER, path.basename(db));
        // I2: the data is at the new place and nothing links the old one to it - serve the new file, never the
        // old path a server would re-create as a second, empty database.
        const cursorLine = `Cursor, and any install still naming ${moved.from}, does not see these memories until it is pointed at ${moved.to}`;
        if (moved.state === 'moved' && moved.linked) log(`memory-launch: moved ${moved.from} -> ${moved.to}, the old path linked to it`);
        if (moved.state === 'moved' && !moved.linked)
        {
            log(`memory-launch: moved ${moved.from} -> ${moved.to} - the old path could not be linked (${moved.why}); serving the new one. ${cursorLine}`);
            return file;
        }
        if (moved.state === 'busy') log(`memory-launch: ${moved.from} not moved - ${moved.busy.join(', ')} open in another server; served where it is`);
        // Both hold data: the old folder was re-created after the stack's move (another reader still on the old
        // path). The stack's own database is the new one; the configured old spelling is read there.
        if (moved.state === 'exists')
        {
            const legacyNamed = dataRoot.homeTwinOf(db, { home });
            log(`memory-launch: both ${moved.from} and ${moved.to} hold data - neither is touched${legacyNamed && fs.existsSync(file) ? `; serving ${moved.to}. ${cursorLine}` : ''}`);
            if (legacyNamed && fs.existsSync(file)) return file;
        }
        return dataRoot.liveMemoryDb(db, { home, projectRoot: projectDir });
    }
    if (dataRoot.memoryLevelOf(db, { home, projectRoot: projectDir }) === 'project' && path.basename(path.dirname(db)) === dataRoot.MEMORY_FOLDER)
    {
        const rel = path.relative(projectDir, path.dirname(db)).split(path.sep).join('/');
        const root = rel.endsWith(`/${dataRoot.MEMORY_FOLDER}`) ? rel.slice(0, -(`/${dataRoot.MEMORY_FOLDER}`.length)) : '';
        if (!dataRoot.checkDataPath(root).ok) return dataRoot.liveMemoryDb(db, { home, projectRoot: projectDir });
        const live = dataRoot.liveDir({ projectDir, cls: 'memory', root, pending: dataRoot.pendingOf(projectDir), busy: dataRoot.busyDbs });
        if (live.dir === dataRoot.targetOf('memory', root))
        {
            try { dataRoot.ensureRootIgnore({ projectDir, root }); }
            catch (err) { log(`memory-launch: ${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore`); }
        }
        if (live.state === 'moved') log(`memory-launch: moved ${live.from} -> ${live.dir}`);
        if (live.state === 'busy' || live.state === 'failed') log(`memory-launch: ${live.dir} not moved (${live.why}) - served where it is`);
        const found = path.join(projectDir, ...live.dir.split('/'), 'memory.db');
        return fs.existsSync(found) ? found : dataRoot.liveMemoryDb(db, { home, projectRoot: projectDir });
    }
    return db;
}

function main(argv)
{
    const at = argv.indexOf('--package');
    // The pin is passed in by the generated plugin entry (meta/mcp-pins.json owns the version), so
    // an absent flag means the entry was hand-edited - say so rather than launch something else.
    if (at < 0 || !argv[at + 1])
    {
        process.stderr.write('memory-launch: --package <spec> is required (the plugin entry passes it)\n');
        return 2;
    }
    const spec = argv[at + 1];
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const db = liveDb(resolveDb(projectDir), { projectDir, log: (line) => process.stderr.write(`${line}\n`) });
    // The service opens the file itself; create the directory so a first run on a fresh machine is
    // not a start-up failure the user has to decode from a python traceback.
    try { fs.mkdirSync(path.dirname(db), { recursive: true }); } catch { /* read-only home: let the service say so */ }
    process.stderr.write(`memory-launch: ${spec}, db ${db}\n`);
    // runUvx puts the pinned Python in front (uv-python.js). numpy is injected because the sqlite_vec
    // backend needs it but does not declare it, so uvx's isolated env omits it and the server dies
    // with "No module named 'numpy'".
    runUvx(['--with', 'numpy', '--from', spec, 'memory', 'server'], {
        cwd: projectDir, projectDir, label: 'memory-launch',
        env: { ...process.env, MCP_MEMORY_SQLITE_PATH: db },
    });
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { resolveDb, liveDb, envFrom, accountDir };
