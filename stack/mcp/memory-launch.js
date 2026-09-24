#!/usr/bin/env node
'use strict';
// THE MEMORY SERVER'S LAUNCHER - it exists for exactly one reason.
//
// The memory database's path is the INSTALL's level choice (global ~/.memory-mcp/memory.db, scoped
// ~/.memory-mcp/memory_<space>.db, project <project>/.memory-mcp/memory.db), so it differs per
// project. A plugin MCP entry cannot read that: measured 2026-09-22, a plugin entry expands ${KEY}
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
//   2. ALFRED_CODE_MEMORY_DB in <cwd>/.claude/settings.json `env`      (the install's choice)
//   3. ALFRED_CODE_MEMORY_DB in <cwd>/.claude/settings.local.json `env` (a per-machine override)
//   4. ALFRED_CODE_MEMORY_DB in the ACCOUNT settings.json `env`
//   5. ~/.memory-mcp/memory.db - the global default, which is what a fresh install picks
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runUvx } = require('./uv-python.js');

function envFrom(file)
{
    try
    {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return (parsed && parsed.env) || {};
    }
    catch { return {}; }   // absent, unreadable or malformed is not a failure - fall through
}

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*. This launcher ships without
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
        path.join(projectDir, '.claude', 'settings.json'),
        path.join(projectDir, '.claude', 'settings.local.json'),
        path.join(accountDir(), 'settings.json'),
    ])
    {
        const value = envOf(envFrom(file), 'MEMORY_DB');
        if (value) return path.isAbsolute(value) ? value : path.join(projectDir, value);
    }
    return path.join(os.homedir(), '.memory-mcp', 'memory.db');
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
    const db = resolveDb(projectDir);
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
module.exports = { resolveDb, envFrom, accountDir };
