'use strict';
// THE PROCESS EDGE - everything the layers need from the machine, in one place.
//
// Every layer above this takes its side effects as injected functions, which is what makes them
// testable without a machine. This module is the one that actually spawns, and it is deliberately
// thin: no decisions live here, only the calls.
//
// Two rules the shell learned:
//
//   - A MISSING TOOL IS FAIL-SOFT, never an abort. `claude` absent means the plugin and MCP layers
//     are skipped and reported; the file layers still land.
//   - A COMMAND'S EXIT CODE IS THE ANSWER, never its output. The verify passes read files.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No `shell: true`: passing args through a shell concatenates rather than escapes them, which Node
// deprecated for exactly the reason it sounds like. `command -v` is a shell builtin, so posix gets
// an explicit `sh -c` with the name quoted into it.
const which = (cmd) => (process.platform === 'win32'
    ? spawnSync('where', [cmd], { stdio: 'ignore' })
    : spawnSync('/bin/sh', ['-c', `command -v '${String(cmd).replace(/'/g, "'\\''")}'`], { stdio: 'ignore' })).status === 0;

// One runner for every `claude ...` call: returns true on exit 0, and prints nothing unless the
// caller asks for the output.
function cliRunner(bin, { cwd, env, out = () => {} } = {})
{
    return (argv, { quiet = false } = {}) =>
    {
        const r = spawnSync(bin, argv, { cwd, env, encoding: 'utf8' });
        if (!quiet && r.stdout) out(r.stdout.trimEnd().split('\n').slice(-1)[0]);
        return r.status === 0;
    };
}

// The captured stdout of one call, '' when it could not run - the shape every read-back wants.
function capture(bin, argv, { cwd, env } = {})
{
    const r = spawnSync(bin, argv, { cwd, env, encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '') : '';
}

// The revision a PROVIDED source is at. Without this the stamp is skipped for a plain checkout -
// and the stamp is what `/alfred-code:configure` diffs to say what an update would bring.
function gitRevision(dir)
{
    const ask = (args) =>
    {
        const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
        return r.status === 0 ? (r.stdout || '').trim() : '';
    };
    const sha = ask(['rev-parse', 'HEAD']);
    if (!sha) return null;
    return { sha, ref: ask(['rev-parse', '--abbrev-ref', 'HEAD']), remote: ask(['config', '--get', 'remote.origin.url']) };
}

function gitRoot(cwd)
{
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
}

// A node script from the source snapshot, run with its own argv. Used for selection-plugins.js and
// the memory importer - both of which ship in the snapshot rather than beside this file.
function runNode(script, argv, { cwd, env } = {})
{
    const r = spawnSync(process.execPath, [script, ...argv], { cwd, env, encoding: 'utf8' });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);

// THE TWO OUTWARD ROUTES, used only when no --source and no plugin cache answered.
//
// curl + tar rather than Node's own fetch: the twin uses exactly these two, a machine without them
// has no archive route on either route, and reimplementing gzip extraction here would be a second
// behaviour to keep in step. The tarball is downloaded into its own scratch dir and that dir is
// removed as soon as it is extracted, because `source.js` cleans up the ONE directory it is handed.
function fetchArchive({ repoUrl, tmpdir = os.tmpdir() } = {})
{
    if (!which('curl') || !which('tar')) return null;
    const dl = fs.mkdtempSync(path.join(tmpdir, 'alfred-code-dl-'));
    const repo = fs.mkdtempSync(path.join(tmpdir, 'alfred-code-src-'));
    const tgz = path.join(dl, 'alfred-code.tar.gz');
    const ok = spawnSync('curl', ['-fsSL', `${repoUrl}/releases/latest/download/alfred-code.tar.gz`, '-o', tgz], { stdio: 'ignore' }).status === 0
        && spawnSync('tar', ['-xzf', tgz, '-C', repo], { stdio: 'ignore' }).status === 0;
    fs.rmSync(dl, { recursive: true, force: true });
    if (!ok) { fs.rmSync(repo, { recursive: true, force: true }); return null; }
    return repo;
}

// Pinned to `main`, never the default branch: the release branch is what installs deliver, and
// development lands on `develop`. The caller validates the tree before it is used.
function cloneMain({ repoUrl, tmpdir = os.tmpdir() } = {})
{
    if (!which('git')) return null;
    const dir = fs.mkdtempSync(path.join(tmpdir, 'alfred-code-clone-'));
    if (spawnSync('git', ['clone', '--depth', '1', '-b', 'main', repoUrl, dir], { stdio: 'ignore' }).status !== 0)
    {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
    }
    const rev = gitRevision(dir) || { sha: '', ref: '' };
    return { dir, sha: rev.sha, ref: rev.ref };
}

module.exports = { which, cliRunner, capture, gitRoot, gitRevision, runNode, lines, fetchArchive, cloneMain, join: path.join };
