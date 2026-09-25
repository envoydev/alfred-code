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

const { which, cliRunner, capture, resolveWin, cmdArg } = require('./install/runtime.js');

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
