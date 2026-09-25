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
const { spawnSync, spawn: spawnAsync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);

// WINDOWS (R104, R105): an npm-installed `claude`, `npx` or `npm` is a BATCH FILE, and `where` lists
// npm's extensionless sh shim before it. Node starts a .exe/.com directly, but a .cmd/.bat only
// through cmd.exe: a batch file spawned directly fails EINVAL since the CVE-2024-27980 fix (ENOENT
// before it), in spawnSync and spawn alike - measured on a Windows 11 VM, where the seed read
// `claude` as present and then every plugin and MCP call failed. The first match Node can start, in
// `where`'s own order, is the one a shell would run - '' when there is none. `env` is the caller's:
// a PATH it changed (init installs a tool, then looks again) is the one searched.
function resolveWin(cmd, run = spawnSync, env = process.env)
{
    const r = run('where', [cmd], { encoding: 'utf8', env });
    if (!r || r.status !== 0) return '';
    return lines(r.stdout || '').find((p) => /\.(exe|com|cmd|bat)$/i.test(p)) || '';
}

// One `where` per name and PATH for the whole run - the seed makes dozens of `claude` calls. Only a
// FOUND path is kept, so a tool installed mid-run is still found on the next look.
const resolvedWin = new Map();
function resolveOnce(cmd, env = process.env)
{
    const key = `${cmd}\0${env.PATH || env.Path || ''}`;
    if (resolvedWin.has(key)) return resolvedWin.get(key);
    const full = resolveWin(cmd, spawnSync, env);
    if (full) resolvedWin.set(key, full);
    return full;
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

// WHAT to start for one external command: unchanged off Windows. On Windows the name is resolved to
// its full path first; a .exe/.com is started directly, a .cmd/.bat through cmd.exe with every
// argument escaped by `cmdArg`. No `shell: true`: that concatenates rather than escapes, which Node
// deprecated (DEP0190) for exactly the reason it sounds like. A line break has no escape in a cmd.exe
// command line - it ends the command - so an argument carrying one is refused, never run.
function commandPlan(bin, argv, opts, { platform = process.platform, resolve = resolveOnce } = {})
{
    if (platform !== 'win32') return { cmd: bin, args: argv, opts };
    const env = (opts && opts.env) || process.env;
    const full = resolve(bin, env);
    if (!full) return { why: `${bin}: not found on PATH as a .exe, .com, .cmd or .bat` };
    if (!/\.(cmd|bat)$/i.test(full)) return { cmd: full, args: argv, opts };
    if (argv.some((a) => /[\r\n]/.test(String(a)))) return { why: `${bin}: an argument holds a line break, which cmd.exe cannot pass` };
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const line = [full.replace(CMD_META, '^$1'), ...argv.map(cmdArg)].join(' ');
    return { cmd: comspec, args: ['/d', '/s', '/c', `"${line}"`], opts: { ...opts, windowsVerbatimArguments: true } };
}

// THE ONE SPAWN behind every external command the scripts run (R105) - `node` itself excepted, which
// is `process.execPath` and never a batch file. `platform`, `resolve` and `spawn` are the seams the
// tests hand in. A command that cannot be planned comes back as a spawn error, never a start.
function spawnCommand(bin, argv = [], opts = {}, { platform, resolve, spawn = spawnSync } = {})
{
    const plan = commandPlan(bin, argv, opts, { platform, resolve });
    if (plan.why) return { status: null, stdout: '', stderr: plan.why, error: new Error(plan.why) };
    return spawn(plan.cmd, plan.args, plan.opts);
}

// The async twin, a ChildProcess. A name that does not resolve is started plainly, so its failure
// arrives as the 'error' event every caller of `spawn` already handles.
function spawnCommandAsync(bin, argv = [], opts = {}, { platform, resolve, spawn = spawnAsync } = {})
{
    const plan = commandPlan(bin, argv, opts, { platform, resolve });
    return plan.why ? spawn(bin, argv, opts) : spawn(plan.cmd, plan.args, plan.opts);
}

// execFileSync's contract over the same route: stdout back, a throw carrying `status`, `stdout` and
// `stderr` on a failed start or a non-zero exit, and stderr passed through when no `stdio` was asked for.
function execCommand(bin, argv = [], opts = {}, seams = {})
{
    const r = spawnCommand(bin, argv, opts, seams);
    if (!opts.stdio && r.stderr && !r.error) process.stderr.write(r.stderr);
    if (r.error) throw Object.assign(r.error, { status: null, stdout: r.stdout, stderr: r.stderr });
    if (r.status !== 0)
        throw Object.assign(new Error(`Command failed: ${[bin, ...argv].join(' ')}${r.stderr ? `\n${String(r.stderr).trim()}` : ''}`),
            { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr });
    return r.stdout;
}

// Where a tool resolves - '' when it does not. `command -v` is a shell builtin, so posix gets an
// explicit `sh -c` with the name quoted into it. On Windows a tool counts only when it resolves to a
// file Node can start.
function locate(cmd, { platform = process.platform, resolve = resolveOnce, env = process.env } = {})
{
    if (platform === 'win32') return resolve(cmd, env) || '';
    const r = spawnSync('/bin/sh', ['-c', `command -v '${String(cmd).replace(/'/g, "'\\''")}'`], { encoding: 'utf8', env });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
}
const which = (cmd, seams = {}) => Boolean(locate(cmd, seams));

// FOUND BUT NOT RUNNABLE (R105): a tool on PATH that cannot be started - a batch file spawned
// directly, a missing interpreter, a broken ComSpec. One `--version` start answers it; only a failed
// START counts, never a non-zero exit. '' when it runs, else the one line the run prints.
function unrunnable(bin, { cwd, env, platform, resolve, spawn } = {})
{
    const r = spawnCommand(bin, ['--version'], { cwd, env, encoding: 'utf8' }, { platform, resolve, spawn });
    if (!r.error) return '';
    const at = locate(bin, { platform, resolve, env: env || process.env }) || bin;
    return `${bin} found at ${at} but could not be run: ${r.error.message}`;
}

// What a failed call says: its words up to the first option - never a value handed after one (a
// header, an env pair) - and the last line it printed, stderr first.
const callLabel = (argv) => { const at = argv.findIndex((a) => String(a).startsWith('-')); return (at < 0 ? argv : argv.slice(0, at)).join(' '); };
const lastSaid = (r) => (lines(r.stderr || '').pop() || lines(r.stdout || '').pop() || '').slice(0, 300);

// One runner for every `claude ...` call: true on exit 0. A FAILED call prints one line through
// `fail` (R105 - the VM run failed its marketplace and `mcp remove` calls with no line at all) unless
// the caller says what it expects: `expect: 'reported'` (the caller notes the failure itself),
// `'answer'` (the exit code IS the answer, as for `mcp get`) or a RegExp over the output (a benign
// failure, such as removing a server that is not there). A CLI that cannot START is said once, and
// no later call of the run starts it again.
function cliRunner(bin, { cwd, env, out = () => {}, fail = () => {}, platform, resolve, spawn } = {})
{
    let broken = false;
    return (argv, { quiet = false, expect } = {}) =>
    {
        if (broken) return false;
        const r = spawnCommand(bin, argv, { cwd, env, encoding: 'utf8' }, { platform, resolve, spawn });
        if (!quiet && r.stdout) out(r.stdout.trimEnd().split('\n').slice(-1)[0]);
        if (r.status === 0) return true;
        if (r.error)
        {
            broken = true;
            fail(`${bin} could not be run: ${r.error.message} - no later ${bin} call of this run is tried`);
            return false;
        }
        const benign = expect === 'reported' || expect === 'answer'
            || (expect instanceof RegExp && expect.test(`${r.stderr || ''}\n${r.stdout || ''}`));
        if (!benign) fail(`${bin} ${callLabel(argv)} failed (${r.signal ? `signal ${r.signal}` : `exit ${r.status}`})${lastSaid(r) ? `: ${lastSaid(r)}` : ''}`);
        return false;
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
        const r = spawnCommand('git', args, { cwd: dir, encoding: 'utf8' });
        return r.status === 0 ? (r.stdout || '').trim() : '';
    };
    const sha = ask(['rev-parse', 'HEAD']);
    if (!sha) return null;
    return { sha, ref: ask(['rev-parse', '--abbrev-ref', 'HEAD']), remote: ask(['config', '--get', 'remote.origin.url']) };
}

function gitRoot(cwd)
{
    const r = spawnCommand('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
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
    const ok = spawnCommand('curl', ['-fsSL', `${repoUrl}/releases/latest/download/alfred-code.tar.gz`, '-o', tgz], { stdio: 'ignore' }).status === 0
        && spawnCommand('tar', ['-xzf', tgz, '-C', repo], { stdio: 'ignore' }).status === 0;
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
    if (spawnCommand('git', ['clone', '--depth', '1', '-b', 'main', repoUrl, dir], { stdio: 'ignore' }).status !== 0)
    {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
    }
    const rev = gitRevision(dir) || { sha: '', ref: '' };
    return { dir, sha: rev.sha, ref: rev.ref };
}

module.exports = {
    which, locate, unrunnable, cliRunner, capture, resolveWin, cmdArg, spawnCommand, spawnCommandAsync, execCommand,
    gitRoot, gitRevision, runNode, lines, fetchArchive, cloneMain, join: path.join,
};
