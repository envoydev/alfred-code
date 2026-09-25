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

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);

// WINDOWS (R104): an npm-installed `claude` or `npx` is a BATCH FILE, and `where` lists npm's
// extensionless sh shim before it. Node starts a .exe/.com directly, but a .cmd/.bat only through
// cmd.exe: a batch file spawned directly fails EINVAL since the CVE-2024-27980 fix (ENOENT before
// it), so the seed read `claude` as present and every plugin and MCP call then failed. The first
// match Node can start, in `where`'s own order, is the one a shell would run - '' when there is none.
function resolveWin(cmd, run = spawnSync)
{
    const r = run('where', [cmd], { encoding: 'utf8' });
    if (!r || r.status !== 0) return '';
    return lines(r.stdout || '').find((p) => /\.(exe|com|cmd|bat)$/i.test(p)) || '';
}

// cmd.exe's metacharacters; a caret before one makes it literal.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

// ONE argument for a batch file. Quoted first for the C runtime the batch hands it on to (a quote
// escaped, the backslashes before it and at the end doubled), then every metacharacter - the quotes
// included - caret-escaped TWICE: once for the `cmd /c` line and once for the batch's own re-parse of
// `%*`, which is how an npm shim passes its arguments on. Neither parse then sees a quote it would
// toggle on or an `&` / `|` it would act on.
function cmdArg(arg)
{
    const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
    return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

// The one spawn behind every runner: unchanged off Windows. On Windows the name is resolved to its
// full path first; a .exe/.com is spawned directly, a .cmd/.bat through cmd.exe with every argument
// escaped by `cmdArg`. No `shell: true`: that concatenates rather than escapes, which Node
// deprecated (DEP0190) for exactly the reason it sounds like. A line break has no escape in a cmd.exe
// command line - it ends the command - so an argument carrying one is refused, never run.
function spawnCommand(bin, argv, opts, { platform = process.platform, resolve = resolveWin, spawn = spawnSync } = {})
{
    if (platform !== 'win32') return spawn(bin, argv, opts);
    const failed = (why) => ({ status: null, stdout: '', stderr: why, error: new Error(why) });
    const full = resolve(bin);
    if (!full) return failed(`${bin}: not found on PATH as a .exe, .com, .cmd or .bat`);
    if (!/\.(cmd|bat)$/i.test(full)) return spawn(full, argv, opts);
    if (argv.some((a) => /[\r\n]/.test(String(a)))) return failed(`${bin}: an argument holds a line break, which cmd.exe cannot pass`);
    const env = (opts && opts.env) || process.env;
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const line = [full.replace(CMD_META, '^$1'), ...argv.map(cmdArg)].join(' ');
    return spawn(comspec, ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
}

// `command -v` is a shell builtin, so posix gets an explicit `sh -c` with the name quoted into it. On
// Windows a tool counts only when it resolves to a file Node can start.
const which = (cmd, { platform = process.platform, resolve = resolveWin } = {}) => (platform === 'win32'
    ? Boolean(resolve(cmd))
    : spawnSync('/bin/sh', ['-c', `command -v '${String(cmd).replace(/'/g, "'\\''")}'`], { stdio: 'ignore' }).status === 0);

// One runner for every `claude ...` call: returns true on exit 0, and prints nothing unless the
// caller asks for the output. `platform`, `resolve` and `spawn` are the seams the tests hand in.
function cliRunner(bin, { cwd, env, out = () => {}, platform, resolve, spawn } = {})
{
    return (argv, { quiet = false } = {}) =>
    {
        const r = spawnCommand(bin, argv, { cwd, env, encoding: 'utf8' }, { platform, resolve, spawn });
        if (!quiet && r.stdout) out(r.stdout.trimEnd().split('\n').slice(-1)[0]);
        return r.status === 0;
    };
}

// The captured stdout of one call, '' when it could not run - the shape every read-back wants.
function capture(bin, argv, { cwd, env, platform, resolve, spawn } = {})
{
    const r = spawnCommand(bin, argv, { cwd, env, encoding: 'utf8' }, { platform, resolve, spawn });
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

module.exports = { which, cliRunner, capture, resolveWin, cmdArg, spawnCommand, gitRoot, gitRevision, runNode, lines, fetchArchive, cloneMain, join: path.join };
