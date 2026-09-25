'use strict';
// THE PROCESS EDGE ON WINDOWS (R104) - `claude` and `npx` installed by npm are batch files.
//
// `where claude` answers for an npm install with the extensionless sh shim first and `claude.cmd`
// after it, and Node cannot start either without cmd.exe: a batch file spawned directly is rejected
// with EINVAL since the CVE-2024-27980 fix (src/spawn_sync.cc), ENOENT before it. So the seed read
// `claude` as present and then every plugin and MCP call failed. These tests run on any OS: the
// platform, the resolver and the spawn are handed in, and nothing real is started.
const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const { which, cliRunner, capture, resolveWin, cmdArg, spawnCommandAsync, execCommand, locate, unrunnable } = require('./install/runtime.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const NPM_SHIM = 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd';
// A name no machine carries: before the fix the runner ignored the injected spawn and started the
// real binary, which for this name is a harmless ENOENT.
const BIN = 'alfred-code-r104-no-such-bin';

function recorder(result = { status: 0, stdout: 'out\n', stderr: '' })
{
    const calls = [];
    const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
    return { calls, spawn };
}

// cmd.exe's metacharacters: one not preceded by an escaping caret is one cmd acts on.
const META = /[()\][%!^"`<>&|;, *?]/;
function unescapedMeta(text)
{
    const hits = [];
    for (let i = 0; i < text.length; i++)
    {
        if (text[i] === '^') { i += 1; continue; }
        if (META.test(text[i])) hits.push(`${text[i]}@${i}`);
    }
    return hits;
}
// One cmd.exe caret pass: each `^x` becomes a literal `x`.
const caretPass = (text) => text.replace(/\^(.)/g, '$1');

test('install-runtime: a .cmd resolved on win32 runs through cmd.exe, never a direct spawn of the batch file', () =>
{
    const { calls, spawn } = recorder();
    const run = cliRunner(BIN, { cwd: 'C:\\p', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, platform: 'win32', resolve: () => NPM_SHIM, spawn });
    assert.strictEqual(run(['plugin', 'list', '--json'], { quiet: true }), true);
    assert.strictEqual(calls.length, 1, 'the injected spawn was not used');
    const [call] = calls;
    assert.strictEqual(call.cmd, 'C:\\Windows\\system32\\cmd.exe');
    assert.deepStrictEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.strictEqual(call.opts.windowsVerbatimArguments, true);
    assert.strictEqual(call.opts.cwd, 'C:\\p');
    assert.match(call.args[3], /^"C:\\Users\\u\\AppData\\Roaming\\npm\\claude\.cmd /);
});

test('install-runtime: capture on win32 goes the same way and returns the output', () =>
{
    const { calls, spawn } = recorder({ status: 0, stdout: '[]', stderr: '' });
    const out = capture(BIN, ['plugin', 'list', '--json'], { env: {}, platform: 'win32', resolve: () => 'C:\\npm\\npx.cmd', spawn });
    assert.strictEqual(out, '[]');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, 'cmd.exe', 'no ComSpec in the env falls back to cmd.exe');
    assert.strictEqual(calls[0].opts.windowsVerbatimArguments, true);
});

test('install-runtime: an argument with spaces, quotes and & cannot break out of either cmd parse', () =>
{
    const evil = 'a b"& calc.exe & "c\\';
    const token = cmdArg(evil);
    // Two caret passes: the `cmd /c` line, then the batch file's own `%*` re-parse (an npm shim).
    const once = caretPass(token);
    const twice = caretPass(once);
    assert.deepStrictEqual(unescapedMeta(token), [], `the cmd /c parse sees a live metacharacter in ${token}`);
    assert.deepStrictEqual(unescapedMeta(once), [], `the batch re-parse sees a live metacharacter in ${once}`);
    // What reaches the program: ONE argument, C-runtime quoted, the quote and backslash kept literal.
    assert.strictEqual(twice, '"a b\\"& calc.exe & \\"c\\\\"');

    const { calls, spawn } = recorder();
    cliRunner(BIN, { env: {}, platform: 'win32', resolve: () => 'C:\\Program Files\\nodejs\\npx.cmd', spawn })(['install', evil], { quiet: true });
    const line = calls[0].args[3];
    assert.ok(line.startsWith('"') && line.endsWith('"'), '/s strips exactly one outer quote pair');
    const inner = line.slice(1, -1);
    // The path's space is escaped, so cmd keeps it one word; the separators are the only bare spaces.
    const words = inner.split(/(?<!\^) /);
    assert.deepStrictEqual(words, ['C:\\Program^ Files\\nodejs\\npx.cmd', cmdArg('install'), token]);
});

test('install-runtime: a line break in an argument is refused on win32 - cmd.exe ends the command there', () =>
{
    const { calls, spawn } = recorder();
    const run = cliRunner(BIN, { env: {}, platform: 'win32', resolve: () => NPM_SHIM, spawn });
    assert.strictEqual(run(['a\nb'], { quiet: true }), false);
    assert.strictEqual(capture(BIN, ['a\r\nb'], { env: {}, platform: 'win32', resolve: () => NPM_SHIM, spawn }), '');
    assert.strictEqual(calls.length, 0, 'nothing may start with a line-broken argument');
});

test('install-runtime: a .exe on win32 keeps the direct spawn, by its full path, arguments untouched', () =>
{
    const { calls, spawn } = recorder();
    const exe = 'C:\\Users\\u\\.local\\bin\\claude.exe';
    cliRunner(BIN, { env: {}, platform: 'win32', resolve: () => exe, spawn })(['plugin', 'install', 'a b"&c'], { quiet: true });
    assert.strictEqual(calls[0].cmd, exe);
    assert.deepStrictEqual(calls[0].args, ['plugin', 'install', 'a b"&c']);
    assert.notStrictEqual(calls[0].opts.windowsVerbatimArguments, true);
});

test('install-runtime: nothing resolved on win32 is a failed call, never a spawn', () =>
{
    const { calls, spawn } = recorder();
    assert.strictEqual(cliRunner(BIN, { env: {}, platform: 'win32', resolve: () => '', spawn })(['x'], { quiet: true }), false);
    assert.strictEqual(capture(BIN, ['x'], { env: {}, platform: 'win32', resolve: () => '', spawn }), '');
    assert.strictEqual(calls.length, 0);
});

test('install-runtime: off win32 the call is the plain spawn it always was', () =>
{
    const { calls, spawn } = recorder();
    cliRunner('claude', { cwd: '/p', env: {}, platform: 'darwin', resolve: () => { throw new Error('no resolver off win32'); }, spawn })(['plugin', 'list'], { quiet: true });
    assert.deepStrictEqual([calls[0].cmd, calls[0].args], ['claude', ['plugin', 'list']]);
    assert.notStrictEqual(calls[0].opts.windowsVerbatimArguments, true);
});

test('install-runtime: resolveWin takes the first match Node can start, in where\'s own order', () =>
{
    const where = (stdout, status = 0) => () => ({ status, stdout });
    // npm's extensionless sh shim comes first and cannot run under Windows.
    assert.strictEqual(resolveWin('claude', where('C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\nC:\\bin\\claude.exe\r\n')), 'C:\\npm\\claude.cmd');
    assert.strictEqual(resolveWin('claude', where('C:\\bin\\claude.exe\r\nC:\\npm\\claude.cmd\r\n')), 'C:\\bin\\claude.exe');
    assert.strictEqual(resolveWin('claude', where('C:\\npm\\claude\r\n')), '');
    assert.strictEqual(resolveWin('claude', where('', 1)), '');
});

test('install-runtime: which on win32 is true only for a match Node can start', () =>
{
    assert.strictEqual(which('claude', { platform: 'win32', resolve: () => NPM_SHIM }), true);
    assert.strictEqual(which('claude', { platform: 'win32', resolve: () => '' }), false);
});

// R105 - the Windows VM measured the rest: spawnSync('claude') ENOENT, spawnSync('claude.cmd') EINVAL,
// every plugin install '!! failed', and the marketplace calls and eight `mcp remove` calls failing
// with no line at all while the seed exited 0.

test('install-runtime: a .bat resolved on win32 takes the cmd.exe route like a .cmd', () =>
{
    const { calls, spawn } = recorder();
    cliRunner(BIN, { env: {}, platform: 'win32', resolve: () => 'C:\\tools\\claude.BAT', spawn })(['plugin', 'list'], { quiet: true });
    assert.strictEqual(calls[0].cmd, 'cmd.exe');
    assert.deepStrictEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
    assert.strictEqual(calls[0].opts.windowsVerbatimArguments, true);
    assert.match(calls[0].args[3], /^"C:\\tools\\claude\.BAT /);
});

test('install-runtime: execCommand routes like the runners, returns stdout, and throws with the status on a non-zero exit', () =>
{
    const { calls, spawn } = recorder({ status: 0, stdout: 'v1\n', stderr: '' });
    assert.strictEqual(execCommand(BIN, ['--version'], { encoding: 'utf8', stdio: 'pipe' }, { platform: 'win32', resolve: () => 'C:\\npm\\npm.cmd', spawn }), 'v1\n');
    assert.strictEqual(calls[0].cmd, 'cmd.exe');
    const bad = recorder({ status: 2, stdout: 'o', stderr: 'e' });
    assert.throws(() => execCommand(BIN, ['x'], { stdio: 'pipe' }, { platform: 'win32', resolve: () => 'C:\\bin\\git.exe', spawn: bad.spawn }),
        (e) => e.status === 2 && e.stdout === 'o' && e.stderr === 'e');
    assert.strictEqual(bad.calls[0].cmd, 'C:\\bin\\git.exe');
    assert.throws(() => execCommand(BIN, ['x'], {}, { platform: 'win32', resolve: () => '', spawn: bad.spawn }), /not found on PATH/);
});

test('install-runtime: spawnCommandAsync runs a .cmd through cmd.exe and a .exe directly, and leaves an unresolved name to the plain spawn', () =>
{
    const { calls, spawn } = recorder({ on: () => {} });
    spawnCommandAsync(BIN, ['-y', 'a b"&c'], { cwd: 'C:\\p' }, { platform: 'win32', resolve: () => 'C:\\npm\\npx.cmd', spawn });
    assert.strictEqual(calls[0].cmd, 'cmd.exe');
    assert.strictEqual(calls[0].opts.windowsVerbatimArguments, true);
    assert.ok(calls[0].args[3].endsWith(`${cmdArg('a b"&c')}"`));
    spawnCommandAsync(BIN, ['x'], {}, { platform: 'win32', resolve: () => 'C:\\uv\\uvx.exe', spawn });
    assert.deepStrictEqual([calls[1].cmd, calls[1].args], ['C:\\uv\\uvx.exe', ['x']]);
    // Unresolved: the plain spawn raises its own 'error' event, which the caller already handles.
    spawnCommandAsync(BIN, ['x'], {}, { platform: 'win32', resolve: () => '', spawn });
    assert.deepStrictEqual([calls[2].cmd, calls[2].args], [BIN, ['x']]);
});

test('install-runtime: resolveWin asks where with the caller\'s env, so a PATH the caller changed is the one searched', () =>
{
    let seen = null;
    resolveWin('uv', (cmd, args, opts) => { seen = opts.env; return { status: 0, stdout: 'C:\\uv\\uv.exe\r\n' }; }, { PATH: 'C:\\uv' });
    assert.deepStrictEqual(seen, { PATH: 'C:\\uv' });
    assert.strictEqual(locate('uv', { platform: 'win32', resolve: () => 'C:\\uv\\uv.exe' }), 'C:\\uv\\uv.exe');
});

test('install-runtime: a failed call prints ONE line naming the call and its reason, unless the caller expects the failure', () =>
{
    const fails = [];
    const failing = recorder({ status: 1, stdout: '', stderr: 'first\nNo MCP server named "x" in .mcp.json\n' });
    const run = cliRunner(BIN, { env: {}, platform: 'darwin', spawn: failing.spawn, fail: (m) => fails.push(m) });
    assert.strictEqual(run(['plugin', 'marketplace', 'update', 'envoydev'], { quiet: true }), false);
    assert.deepStrictEqual(fails, [`${BIN} plugin marketplace update envoydev failed (exit 1): No MCP server named "x" in .mcp.json`]);
    // Expected: an absent server's remove, a probe whose exit code is the answer, a failure the caller notes.
    run(['mcp', 'remove', 'x', '-s', 'project'], { quiet: true, expect: /No MCP server named/ });
    run(['mcp', 'get', 'x'], { quiet: true, expect: 'answer' });
    run(['plugin', 'install', 'x@y'], { expect: 'reported' });
    assert.strictEqual(fails.length, 1, fails.join('\n'));
    // A benign pattern that does not match is a real failure; the label stops at the first option,
    // so no value handed after it (a header, an env pair) is ever printed.
    run(['mcp', 'add', '--scope', 'project', 'x', '--', 'npx', 'value-r105'], { quiet: true, expect: /already exists/ });
    assert.strictEqual(fails[1], `${BIN} mcp add failed (exit 1): No MCP server named "x" in .mcp.json`);
    // No stderr: the reason is stdout's last line (the CLI prints 'Not logged in' there).
    const outOnly = recorder({ status: 1, stdout: 'Not logged in\n', stderr: '' });
    cliRunner(BIN, { env: {}, platform: 'darwin', spawn: outOnly.spawn, fail: (m) => fails.push(m) })(['plugin', 'update', 'x@y'], { quiet: true });
    assert.strictEqual(fails[2], `${BIN} plugin update x@y failed (exit 1): Not logged in`);
});

test('install-runtime: a CLI that cannot be RUN fails loudly once, and no later call spawns or prints', () =>
{
    const fails = [];
    const error = Object.assign(new Error('spawnSync C:\\npm\\claude.cmd EINVAL'), { code: 'EINVAL' });
    const { calls, spawn } = recorder({ status: null, stdout: '', stderr: '', error });
    const run = cliRunner(BIN, { env: {}, platform: 'darwin', spawn, fail: (m) => fails.push(m) });
    assert.strictEqual(run(['plugin', 'marketplace', 'update', 'a'], { quiet: true }), false);
    assert.strictEqual(run(['mcp', 'get', 'x'], { quiet: true, expect: 'answer' }), false);
    assert.strictEqual(run(['plugin', 'install', 'x@y'], { expect: 'reported' }), false);
    assert.strictEqual(calls.length, 1, 'a CLI that cannot start is not started again');
    assert.strictEqual(fails.length, 1, fails.join('\n'));
    assert.match(fails[0], /could not be run: spawnSync C:\\npm\\claude\.cmd EINVAL/);
});

test('install-runtime: unrunnable names the path and the error when the CLI cannot start, and is empty when it starts - whatever its exit', () =>
{
    const error = Object.assign(new Error('spawnSync C:\\npm\\claude.cmd EINVAL'), { code: 'EINVAL' });
    const cannot = recorder({ status: null, stdout: '', stderr: '', error });
    assert.strictEqual(unrunnable(BIN, { env: {}, platform: 'win32', resolve: () => NPM_SHIM, spawn: cannot.spawn }),
        `${BIN} found at ${NPM_SHIM} but could not be run: spawnSync C:\\npm\\claude.cmd EINVAL`);
    assert.deepStrictEqual(cannot.calls[0].args.slice(-1)[0].endsWith(`${cmdArg('--version')}"`), true, 'the probe is --version');
    assert.strictEqual(unrunnable(BIN, { env: {}, platform: 'win32', resolve: () => NPM_SHIM, spawn: recorder({ status: 1, stdout: '', stderr: '' }).spawn }), '');
});

const STUB_HEAD = ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"', 'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi'];
const bangLines = (out) => out.split('\n').filter((l) => l.includes('!!'));

test('install-runtime: the seed with a claude it finds but cannot run says so ONCE and skips the plugin and MCP layers', POSIX_ONLY, () =>
{
    // The posix twin of the Windows failure: on PATH and executable, but its interpreter is missing,
    // so every spawn fails ENOENT exactly as spawnSync('claude') did on the VM. PATH holds nothing
    // else named claude - a start that fails ENOENT goes on down PATH, and would reach a real CLI.
    const env = {};
    const run = seedRun('install', 'skill csharp\n', {
        env,
        prepare: (repo, work) =>
        {
            fs.writeFileSync(path.join(work, 'bin', 'claude'), '#!/nonexistent/alfred-code-r105\n', { mode: 0o755 });
            fs.mkdirSync(path.join(work, 'nodebin'));
            fs.symlinkSync(process.execPath, path.join(work, 'nodebin', 'node'));
            env.PATH = [path.join(work, 'bin'), path.join(work, 'nodebin'), '/usr/bin', '/bin'].join(path.delimiter);
        },
        inspect: (repo) => fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')),
    });
    const loud = run.out.split('\n').filter((l) => /could not be run/.test(l));
    assert.strictEqual(loud.length, 1, run.out);
    assert.match(loud[0], /!! claude found at \S+\/bin\/claude but could not be run: .*ENOENT - the plugin and MCP layers were skipped/);
    assert.doesNotMatch(run.out, /not on PATH|plugin \S+ failed|mcp \S+ failed/);
    assert.strictEqual(run.result, true, 'the file layers still land');
});

test('install-runtime: the seed prints a line for a failed marketplace refresh and a failed mcp remove, and none for an absent server', POSIX_ONLY, () =>
{
    const stub = [...STUB_HEAD,
        'if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "update" ]; then echo "r105 refresh refused" >&2; exit 1; fi',
        'if [ "$1" = "plugin" ] && [ "$2" = "install" ] && [ "${3%%@*}" = "claude-hud" ]; then echo "r105 install refused" >&2; exit 1; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "remove" ] && [ "$3" = "serena" ]; then echo "r105 .mcp.json could not be parsed" >&2; exit 1; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "remove" ]; then echo "No MCP server named \\"$3\\" in .mcp.json" >&2; exit 1; fi',
        'exit 0', ''].join('\n');
    const run = seedRun('install', 'skill csharp\n', { prepare: (repo, work) => fs.writeFileSync(path.join(work, 'bin', 'claude'), stub, { mode: 0o755 }) });
    const bangs = bangLines(run.out);
    const refreshes = run.calls.filter((c) => /^plugin marketplace update /.test(c));
    assert.ok(refreshes.length > 0, run.calls.join('\n'));
    for (const c of refreshes)
        assert.strictEqual(bangs.filter((l) => l.includes(`!! claude ${c} failed (exit 1): r105 refresh refused`)).length, 1, `${c}:\n${bangs.join('\n')}`);
    assert.strictEqual(bangs.filter((l) => l.includes('!! claude mcp remove serena failed (exit 1): r105 .mcp.json could not be parsed')).length, 1, bangs.join('\n'));
    assert.ok(run.calls.includes('mcp remove context7 -s project'), 'the absent-server remove ran');
    assert.deepStrictEqual(bangs.filter((l) => /mcp remove/.test(l) && !/serena/.test(l)), [], 'an absent server is nothing to report');
    // The install failure is the caller's own note, once - never a second line from the runner.
    assert.deepStrictEqual(bangs.filter((l) => /claude-hud@/.test(l)), ['==>   !! plugin claude-hud@claude-hud failed'], bangs.join('\n'));
});
