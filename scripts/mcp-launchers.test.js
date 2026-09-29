'use strict';
// The small programs a plugin MCP entry cannot do without: the memory launcher, which turns the
// install's level choice into a db path, and the serena and uv-python launchers. They exist because
// a plugin entry expands only the SHELL and the ACCOUNT settings env - a PROJECT settings key arrives
// literal (measured, docs/plugin-migration-evidence.md).
//
// Every case runs on a SCRUBBED environment. This machine has real credentials exported, and a test
// that inherited one would put a live credential in its own assertions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LAUNCH = path.join(ROOT, 'stack/mcp/memory-launch.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launchers-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Only what node itself needs. No HOME either, unless a case sets one - a leaked HOME would let a
// case read the developer's own account settings and pass for the wrong reason.
const BARE = { PATH: process.env.PATH, NODE_OPTIONS: '' };

function project(name, { settings, local, account } = {})
{
    const dir = path.join(TMP, name);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const acct = path.join(dir, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    const write = (file, env) => fs.writeFileSync(file, JSON.stringify({ env }, null, 2));
    if (settings) write(path.join(dir, '.claude', 'settings.json'), settings);
    if (local) write(path.join(dir, '.claude', 'settings.local.json'), local);
    if (account) write(path.join(acct, 'settings.json'), account);
    return { dir, acct };
}

// The launcher execs uvx, so its resolution is exercised through the module, not by starting it.
function resolveDb(projectDir, env)
{
    const out = execFileSync(process.execPath, ['-e',
        'const m=require(process.argv[1]);process.stdout.write(m.resolveDb(process.argv[2]))',
        LAUNCH, projectDir], { env: { ...BARE, ...env }, encoding: 'utf8' });
    return out.trim();
}

// ------------------------------------------------------------------ memory-launch.js

test('memory-launch: the project settings env is the db, because a plugin entry cannot read it', () =>
{
    const { dir } = project('proj-db', { settings: { ALFRED_CODE_MEMORY_DB: '/tmp/chosen/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/chosen/memory.db');
});

// I7 (R47, fix round 1): settings.local.json is read BEFORE settings.json, the same order
// uv-python.js already uses - a local-scope install (T16) writes ALFRED_CODE_MEMORY_DB only to the
// local file, so reading the shared file first would open the wrong project's database whenever a
// repo also carries a committed project-scope install.
test('memory-launch: settings.local.json is the per-machine override, and it WINS over settings.json', () =>
{
    const { dir } = project('local-db', { local: { ALFRED_CODE_MEMORY_DB: '/tmp/local/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/local/memory.db');
    // ... and stays the winner once settings.json also registers one: local is this machine's own.
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/tmp/installed/memory.db' } }));
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/local/memory.db');
});

test('memory-launch: the ACCOUNT settings env answers for a global install', () =>
{
    const { dir, acct } = project('acct-db', { account: { ALFRED_CODE_MEMORY_DB: '/tmp/acct/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct }), '/tmp/acct/memory.db');
});

test('memory-launch: an explicit MCP_MEMORY_SQLITE_PATH wins over every file', () =>
{
    const { dir } = project('env-db', { settings: { ALFRED_CODE_MEMORY_DB: '/tmp/chosen/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir, MCP_MEMORY_SQLITE_PATH: '/tmp/forced/memory.db' }),
        '/tmp/forced/memory.db');
});

test('memory-launch: no key anywhere falls back to the global default, never to nothing', () =>
{
    const { dir } = project('no-db');
    // USERPROFILE too: on Windows os.homedir() reads it and never HOME, so the default would be the runner's own
    assert.strictEqual(resolveDb(dir, { HOME: dir, USERPROFILE: dir }), path.join(dir, '.alfred-memory', 'memory.db'));
});

test('memory-launch: a RELATIVE value resolves against the project, the way the docs engine reads it', () =>
{
    const { dir } = project('rel-db', { settings: { ALFRED_CODE_MEMORY_DB: '.memory-mcp/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.join(dir, '.memory-mcp/memory.db'));
});

test('memory-launch: malformed or empty settings are not a failure - the default still answers', () =>
{
    const { dir } = project('bad-db');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
    assert.strictEqual(resolveDb(dir, { HOME: dir, USERPROFILE: dir }), path.join(dir, '.alfred-memory', 'memory.db'));
});

test('memory-launch: a hand-edited entry with no --package says so instead of launching something else', () =>
{
    let code = 0;
    try { execFileSync(process.execPath, [LAUNCH], { env: BARE, stdio: 'pipe' }); }
    catch (err) { code = err.status; }
    assert.strictEqual(code, 2);
});

// ------------------------------------------------------------------ uv-python.js + the uvx launches
// serena-agent 1.7.0 pins pyyaml 6.0.2, which ships no CPython 3.14 wheel on ANY platform, and five of
// the two servers' compiled dependencies ship no Windows ARM64 wheel at all (cryptography, psutil,
// tiktoken, pyyaml, ruamel.yaml.clib). uvx takes the newest interpreter it finds, so a machine with
// 3.14 compiles pyyaml from source and dies without a compiler (docs/uv-python-pin-evidence.md).
const UV_PYTHON = path.join(ROOT, 'stack/mcp/uv-python.js');
const SERENA = path.join(ROOT, 'stack/mcp/serena-launch.js');

function pythonRequest(opts)
{
    const out = execFileSync(process.execPath, ['-e',
        'const m=require(process.argv[1]);process.stdout.write(m.pythonRequest(JSON.parse(process.argv[2])))',
        UV_PYTHON, JSON.stringify(opts)], { env: BARE, encoding: 'utf8' });
    return out;
}

test('uv-python: 3.13 on Windows x64, macOS and Linux - the newest CPython every compiled dependency has a wheel for', () =>
{
    for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64']])
        assert.strictEqual(pythonRequest({ platform, arch, env: {} }), '3.13', `${platform}/${arch}`);
});

test('uv-python: Windows on ARM takes the x64 CPython 3.13, which runs under emulation and has every wheel', () =>
{
    assert.strictEqual(pythonRequest({ platform: 'win32', arch: 'arm64', env: {} }), 'cpython-3.13-windows-x86_64-none');
});

test('uv-python: an x64 node emulated on Windows ARM still sees the ARM machine through the OS variables', () =>
{
    const arm = 'cpython-3.13-windows-x86_64-none';
    assert.strictEqual(pythonRequest({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'ARM64' } }), arm);
    assert.strictEqual(pythonRequest({ platform: 'win32', arch: 'x64', env: { PROCESSOR_IDENTIFIER: 'ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc' } }), arm);
    assert.strictEqual(pythonRequest({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: 'Intel64 Family 6 Model 154 Stepping 3, GenuineIntel' } }), '3.13');
    // the same variables on another OS mean nothing
    assert.strictEqual(pythonRequest({ platform: 'linux', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'ARM64' } }), '3.13');
});

test('uv-python: ALFRED_CODE_UV_PYTHON overrides the choice; an empty one does not', () =>
{
    assert.strictEqual(pythonRequest({ platform: 'win32', arch: 'arm64', env: { ALFRED_CODE_UV_PYTHON: '3.12' } }), '3.12');
    assert.strictEqual(pythonRequest({ platform: 'darwin', arch: 'arm64', env: { ALFRED_CODE_UV_PYTHON: '  ' } }), '3.13');
});

test('uv-python: the override is read from the settings files a plugin server never gets as env - this machine first', () =>
{
    const { dir, acct } = project('uvpy-files', { settings: { ALFRED_CODE_UV_PYTHON: '3.11' }, local: { ALFRED_CODE_UV_PYTHON: '3.12' }, account: { ALFRED_CODE_UV_PYTHON: '3.10' } });
    const ask = (extra = {}) => pythonRequest({ platform: 'linux', arch: 'x64', env: { CLAUDE_CONFIG_DIR: acct, ...extra }, projectDir: dir });
    assert.strictEqual(ask({ ALFRED_CODE_UV_PYTHON: '3.9' }), '3.9', 'the shell env beats every file');
    assert.strictEqual(ask(), '3.12', 'settings.local.json is this machine');
    fs.rmSync(path.join(dir, '.claude', 'settings.local.json'));
    assert.strictEqual(ask(), '3.11', 'then the project settings.json');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
    assert.strictEqual(ask(), '3.10', 'a malformed file falls through to the account');
    fs.rmSync(path.join(acct, 'settings.json'));
    assert.strictEqual(ask(), '3.13', 'no override anywhere is the machine default');
});

// F4 item 2: a --space account's directory is named by CLAUDE_CONFIG_DIR, never derived from HOME.
// overrideFrom resolves the account dir as `env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')`
// - already CLAUDE_CONFIG_DIR-first. Proven here with an account directory that is NOT '<home>/.claude'
// (the shape a --space account actually has, e.g. '<home>/.claude-work'): the value the module reads
// is the one at the CLAUDE_CONFIG_DIR path, so the lookup is not hardcoded to a HOME-derived layout.
test('uv-python: the account read is keyed by CLAUDE_CONFIG_DIR itself, not a HOME-derived .claude path (a --space account)', () =>
{
    const spaceDir = path.join(TMP, 'uvpy-space-acct-not-dot-claude');
    fs.mkdirSync(spaceDir, { recursive: true });
    fs.writeFileSync(path.join(spaceDir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_UV_PYTHON: '3.10-space' } }));
    const { dir } = project('uvpy-space-project', {});
    assert.strictEqual(
        pythonRequest({ platform: 'linux', arch: 'x64', env: { CLAUDE_CONFIG_DIR: spaceDir }, projectDir: dir }),
        '3.10-space',
        'the account file at the CLAUDE_CONFIG_DIR path must answer, whatever that directory is named',
    );
});

// A stub uvx on PATH records the argv it was started with, so the launches are read, not guessed.
function stubUvx(name)
{
    const bin = path.join(TMP, `${name}-bin`);
    fs.mkdirSync(bin, { recursive: true });
    const record = path.join(TMP, `${name}-argv.json`);
    fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), home: process.env.SERENA_HOME || null }));\n`, { mode: 0o755 });
    return { PATH: bin + path.delimiter + process.env.PATH, argv: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}
const POSIX = { skip: process.platform === 'win32' && 'the stub uvx is a node script with a shebang' };

test('serena-launch: uvx gets the Python pin, the pinned package and every serena argument, in order', POSIX, () =>
{
    const { dir } = project('serena-run');
    fs.mkdirSync(path.join(dir, '.git'));
    const uvx = stubUvx('serena');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--context', 'claude-code', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, SERENA_HOME: '.serena/home' }, stdio: 'pipe' });
    const got = uvx.argv();
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--from', 'serena-agent@1.7.0', 'serena', 'start-mcp-server', '--context', 'claude-code', '--project-from-cwd']);
    // RELATIVE and native: serena 1.7.0 execs the TypeScript server through npm's .bin shim, so on
    // Windows the path reaches cmd.exe unquoted - a '/' cuts it ('.serena' is not recognized as an
    // internal or external command), and so would a space in an absolute project path.
    assert.strictEqual(got.home, '.alfred/serena/home', 'the home stays relative, under the data root - whatever the entry passed');
});

test('serena-launch: the home is spelled in the platform separator, relative or absolute', () =>
{
    const { nativeHome } = require(SERENA);
    assert.strictEqual(nativeHome('.serena/home', 'win32'), '.serena\\home');
    assert.strictEqual(nativeHome('.serena/home', 'linux'), '.serena/home');
    assert.strictEqual(nativeHome('C:/work/app/.serena/home', 'win32'), 'C:\\work\\app\\.serena\\home');
});

// A uvx that exits with a code of its own, or waits and records the signal that reaches it.
function scriptedUvx(name, body)
{
    const bin = path.join(TMP, `${name}-bin`);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    return bin + path.delimiter + process.env.PATH;
}

for (const [label, script] of [['serena', 'serena-launch.js'], ['memory', 'memory-launch.js']])
{
    test(`${label} launcher: the server's exit code comes back, and stdout carries nothing of the launcher's`, POSIX, () =>
    {
        const { dir } = project(`${label}-exit`, { settings: { ALFRED_CODE_MEMORY_DB: path.join(TMP, `${label}-exit-db`, 'memory.db') } });
        const PATH = scriptedUvx(`${label}-exit`, "process.stderr.write('dying\\n'); process.exit(7);");
        let res;
        try { res = { status: 0, stdout: execFileSync(process.execPath, [path.join(ROOT, 'stack/mcp', script), '--package', 'pkg==1', '--', 'x'], { cwd: dir, env: { ...BARE, PATH, HOME: dir }, stdio: 'pipe', encoding: 'utf8' }) }; }
        catch (err) { res = { status: err.status, stdout: err.stdout }; }
        assert.strictEqual(res.status, 7);
        assert.strictEqual(res.stdout, '', 'stdout is the MCP stream - the launcher writes nothing there');
    });

    test(`${label} launcher: a stop signal reaches the server instead of orphaning it`, POSIX, async () =>
    {
        const { dir } = project(`${label}-sig`, { settings: { ALFRED_CODE_MEMORY_DB: path.join(TMP, `${label}-sig-db`, 'memory.db') } });
        const ready = path.join(TMP, `${label}-sig-ready`);
        const got = path.join(TMP, `${label}-sig-got`);
        const PATH = scriptedUvx(`${label}-sig`, `const fs = require('fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(got)}, 'SIGTERM'); process.exit(0); }); fs.writeFileSync(${JSON.stringify(ready)}, '1'); setInterval(() => {}, 1000);`);
        const { spawn } = require('node:child_process');
        const launcher = spawn(process.execPath, [path.join(ROOT, 'stack/mcp', script), '--package', 'pkg==1', '--', 'x'], { cwd: dir, env: { ...BARE, PATH, HOME: dir }, stdio: 'ignore' });
        const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); };
        await until(() => fs.existsSync(ready));
        assert.ok(fs.existsSync(ready), 'the stub server never started');
        const exited = new Promise((r) => launcher.on('exit', r));
        launcher.kill('SIGTERM');
        await exited;
        await until(() => fs.existsSync(got));
        assert.strictEqual(fs.existsSync(got) && fs.readFileSync(got, 'utf8'), 'SIGTERM', 'the server never saw the stop signal');
    });
}

test('serena-launch: the launcher owns SERENA_HOME - an entry or shell value never splits the home from its data', POSIX, () =>
{
    const { dir } = project('serena-home');
    fs.mkdirSync(path.join(dir, '.git'));
    const abs = path.join(TMP, 'elsewhere', '.serena', 'home');
    const uvx = stubUvx('serena-home');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, SERENA_HOME: abs }, stdio: 'pipe' });
    assert.strictEqual(uvx.argv().home, '.alfred/serena/home');
});

test('serena home spelling for the copy route: backslash on Windows, forward slash elsewhere', () =>
{
    const { serenaHomeFor } = require(SERENA);
    assert.strictEqual(serenaHomeFor('win32'), '.alfred\\serena\\home');
    for (const p of ['darwin', 'linux']) assert.strictEqual(serenaHomeFor(p), '.alfred/serena/home', p);
    assert.strictEqual(serenaHomeFor('win32', '.data'), '.data\\serena\\home');
    assert.strictEqual(serenaHomeFor('linux', '.alfred', '.serena'), '.serena/home', 'a folder not moved yet keeps its own home');
});

test('serena-launch: ALFRED_CODE_UV_PYTHON reaches uvx', POSIX, () =>
{
    const { dir } = project('serena-override');
    const uvx = stubUvx('serena-override');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, ALFRED_CODE_UV_PYTHON: 'cpython-3.13-windows-x86_64-none' }, stdio: 'pipe' });
    assert.deepStrictEqual(uvx.argv().argv.slice(0, 2), ['--python', 'cpython-3.13-windows-x86_64-none']);
});

test('serena-launch: an override in the PROJECT settings reaches uvx, though the entry never passes it', POSIX, () =>
{
    const { dir, acct } = project('serena-proj-override', { settings: { ALFRED_CODE_UV_PYTHON: '3.12' } });
    const uvx = stubUvx('serena-proj-override');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, CLAUDE_CONFIG_DIR: acct }, stdio: 'pipe' });
    assert.deepStrictEqual(uvx.argv().argv.slice(0, 2), ['--python', '3.12']);
});

test('serena-launch: a hand-edited entry with no --package says so instead of launching something else', () =>
{
    let code = 0;
    try { execFileSync(process.execPath, [SERENA, '--', 'start-mcp-server'], { env: BARE, stdio: 'pipe' }); }
    catch (err) { code = err.status; }
    assert.strictEqual(code, 2);
});

test('memory-launch: uvx gets the same Python pin ahead of the package', POSIX, () =>
{
    const { dir } = project('memory-run', { settings: { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'memory-run-db', 'memory.db') } });
    const uvx = stubUvx('memory');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir }, stdio: 'pipe' });
    assert.deepStrictEqual(uvx.argv().argv, ['--python', '3.13', '--with', 'numpy', '--from', 'mcp-memory-service[sqlite]==11.13.0', 'memory', 'server']);
});

// ------------------------------------------------------------------ desktop-launch.js
// The two desktop servers drive THIS machine's own apps: windows-desktop (Windows-MCP) on Windows,
// macos-desktop (MacOS-MCP) on macOS. The OS is forced through ALFRED_CODE_PLATFORM so every case runs
// on any host.
const DESKTOP = path.join(ROOT, 'stack/mcp/desktop-launch.js');
const WIN_ARGS = ['--server', 'windows-desktop', '--package', 'windows-mcp==0.8.5', '--', 'serve', '--exclude-tools', 'PowerShell,Registry,Process'];
const MAC_ARGS = ['--server', 'macos-desktop', '--package', 'macos-mcp==0.4.6', '--', 'serve'];

function desktopRun(name, args, { env = {}, settings } = {})
{
    const { dir, acct } = project(name, { settings });
    const uvx = stubUvx(name);
    let res;
    try { res = { status: 0, stderr: '', stdout: execFileSync(process.execPath, [DESKTOP, ...args], { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, CLAUDE_CONFIG_DIR: acct, ...env }, stdio: 'pipe', encoding: 'utf8' }) }; }
    catch (err) { res = { status: err.status, stderr: String(err.stderr || ''), stdout: String(err.stdout || '') }; }
    let argv = null;
    try { argv = uvx.argv().argv; } catch { /* uvx never started */ }
    return { ...res, argv };
}

test('desktop-launch: windows-desktop gets the Python pin, the pinned package, serve and the safe tool gate, in order', POSIX, () =>
{
    const got = desktopRun('desktop-win', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.strictEqual(got.status, 0, got.stderr);
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve', '--exclude-tools', 'PowerShell,Registry,Process']);
    assert.strictEqual(got.stdout, '', 'stdout is the MCP stream - the launcher writes nothing there');
});

test('desktop-launch: ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE replaces the list, and none passes no gate at all', POSIX, () =>
{
    const one = desktopRun('desktop-win-one', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'PowerShell' } });
    assert.deepStrictEqual(one.argv.slice(4), ['windows-mcp', 'serve', '--exclude-tools', 'PowerShell']);
    const none = desktopRun('desktop-win-none', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'none' } });
    assert.deepStrictEqual(none.argv.slice(4), ['windows-mcp', 'serve'], 'none must pass no --exclude-tools, so the user\'s own Windows-MCP config applies');
    const empty = desktopRun('desktop-win-empty', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: '' } });
    assert.deepStrictEqual(empty.argv.slice(6), ['--exclude-tools', 'PowerShell,Registry,Process'], 'an empty override is no override');
});

test('desktop-launch: the override is read from the PROJECT settings a plugin server never gets as env', POSIX, () =>
{
    const got = desktopRun('desktop-win-proj', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32' }, settings: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'none' } });
    assert.deepStrictEqual(got.argv.slice(4), ['windows-mcp', 'serve']);
});

test('desktop-launch: macos-desktop runs serve on the pin, and the Windows gate never reaches it', POSIX, () =>
{
    const got = desktopRun('desktop-mac', MAC_ARGS, { env: { ALFRED_CODE_PLATFORM: 'darwin', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'Shell' } });
    assert.strictEqual(got.status, 0, got.stderr);
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve']);
});

test('desktop-launch: on another OS the server does not start, and one line says why', POSIX, () =>
{
    for (const [name, args, platform] of [['desktop-win-on-mac', WIN_ARGS, 'darwin'], ['desktop-mac-on-win', MAC_ARGS, 'win32'], ['desktop-win-on-linux', WIN_ARGS, 'linux']])
    {
        const got = desktopRun(name, args, { env: { ALFRED_CODE_PLATFORM: platform } });
        assert.strictEqual(got.status, 1, name);
        assert.strictEqual(got.argv, null, `${name}: uvx was started on the wrong OS`);
        assert.match(got.stderr, /drives (Windows|macOS) apps and this machine runs (macOS|Windows|Linux)/, name);
    }
});

// I4 (final review of the rename): the refusal said 'switch it off here with /plugin', which for a
// project-scope entry writes the committed settings.json and switches it off for the teammate on the
// right OS at their next pull. It names the local-scope disable - this machine only - and the marketplace
// key the launcher runs from (its plugin-cache folder), the stack's own key outside a cache.
test('desktop-launch: the wrong-OS line names the local-scope disable, for this machine only (I4)', POSIX, () =>
{
    const got = desktopRun('desktop-win-on-mac-line', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.strictEqual(got.status, 1);
    assert.match(got.stderr, /not started - keep it off on this machine only: claude plugin disable windows-desktop@envoydev --scope local\n$/);
    assert.doesNotMatch(got.stderr, /\/plugin/, 'the /plugin toggle writes the scope the entry sits at - a project one reaches every teammate');
    const cached = path.join(TMP, 'cache-copy', 'plugins', 'cache', 'acme-key', 'windows-desktop', '2.0.0', 'stack', 'mcp');
    fs.mkdirSync(cached, { recursive: true });
    for (const f of ['desktop-launch.js', 'uv-python.js']) fs.copyFileSync(path.join(ROOT, 'stack/mcp', f), path.join(cached, f));
    let stderr = '';
    try { execFileSync(process.execPath, [path.join(cached, 'desktop-launch.js'), ...WIN_ARGS], { env: { ...BARE, ALFRED_CODE_PLATFORM: 'linux' }, stdio: 'pipe', encoding: 'utf8' }); }
    catch (err) { stderr = String(err.stderr || ''); }
    assert.match(stderr, /claude plugin disable windows-desktop@acme-key --scope local/, 'the marketplace key is the cache folder the launcher runs from');
});

test('desktop-launch: a hand-edited entry with no --server or --package says so instead of launching something else', () =>
{
    for (const args of [['--package', 'windows-mcp==0.8.5', '--', 'serve'], ['--server', 'windows-desktop', '--', 'serve'], ['--server', 'linux-desktop', '--package', 'x==1']])
    {
        let code = 0;
        try { execFileSync(process.execPath, [DESKTOP, ...args], { env: { ...BARE, ALFRED_CODE_PLATFORM: 'win32' }, stdio: 'pipe' }); }
        catch (err) { code = err.status; }
        assert.strictEqual(code, 2, args.join(' '));
    }
});

test('desktop-launch: the server\'s exit code comes back', POSIX, () =>
{
    const { dir } = project('desktop-exit');
    const PATH = scriptedUvx('desktop-exit', "process.stderr.write('dying\\n'); process.exit(7);");
    let status = 0;
    try { execFileSync(process.execPath, [DESKTOP, ...MAC_ARGS], { cwd: dir, env: { ...BARE, PATH, HOME: dir, ALFRED_CODE_PLATFORM: 'darwin' }, stdio: 'pipe' }); }
    catch (err) { status = err.status; }
    assert.strictEqual(status, 7);
});

test('desktop gate: each server runs on its own OS only, and an unknown platform override is ignored', () =>
{
    const { offeredOn, platformOf, DESKTOP_OS } = require(DESKTOP);
    assert.deepStrictEqual(DESKTOP_OS, { 'windows-desktop': 'win32', 'macos-desktop': 'darwin' });
    assert.strictEqual(offeredOn('windows-desktop', 'win32'), true);
    assert.strictEqual(offeredOn('windows-desktop', 'darwin'), false);
    assert.strictEqual(offeredOn('macos-desktop', 'darwin'), true);
    assert.strictEqual(offeredOn('macos-desktop', 'linux'), false);
    assert.strictEqual(offeredOn('browser', 'linux'), true, 'a server that is no desktop server runs anywhere');
    assert.strictEqual(platformOf({ ALFRED_CODE_PLATFORM: 'win32' }), 'win32');
    assert.strictEqual(platformOf({ ALFRED_CODE_PLATFORM: 'beos' }), process.platform);
    assert.strictEqual(platformOf({}), process.platform);
});

// ------------------------------------------------------------------ the data root (data-root.js)
// Each launcher resolves its server's data under ALFRED_CODE_DATA_PATH (default .alfred), runs a move the
// installer recorded in the stamp once nothing holds the data, and otherwise serves a 2.0.0 place where
// it is. A stub records the argv and env the real server would have been started with.
function stubRecorder(name, bin)
{
    const dir = path.join(TMP, `${name}-rec-bin`);
    fs.mkdirSync(dir, { recursive: true });
    const record = path.join(TMP, `${name}-rec.json`);
    fs.writeFileSync(path.join(dir, bin), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), home: process.env.SERENA_HOME || null, db: process.env.MCP_MEMORY_SQLITE_PATH || null }));\n`, { mode: 0o755 });
    return { PATH: dir + path.delimiter + process.env.PATH, got: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}
const stamp = (dir, lines) => fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), `sha: abc\n${lines.join('\n')}\n`);
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('serena-launch: a fresh project gets its home and folder under .alfred, and serena is told where the folder is', POSIX, () =>
{
    const { dir } = project('serena-fresh');
    fs.mkdirSync(path.join(dir, '.git'));
    const rec = stubRecorder('serena-fresh', 'uvx');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().home, '.alfred/serena/home');
    const cfg = fs.readFileSync(path.join(dir, '.alfred', 'serena', 'home', 'serena_config.yml'), 'utf8');
    assert.match(cfg, /^project_serena_folder_location: "\$projectDir\/\.alfred\/serena"$/m);
    assert.ok(rec.got().argv.includes('--project-from-cwd'), 'a git project is still found from the cwd');
});

test('serena-launch: a 2.0.0 .serena with no agreed move keeps serving from .serena, untouched', POSIX, () =>
{
    const { dir } = project('serena-legacy');
    put(path.join(dir, '.serena', 'project.yml'), 'project_name: x\n');
    const rec = stubRecorder('serena-legacy', 'uvx');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().home, '.serena/home');
    assert.ok(rec.got().argv.includes('--project-from-cwd'), '.serena/project.yml still marks the project');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred')), 'nothing was written under the new root');
});

test('serena-launch: the move the installer recorded runs at start, and a project with no .git is named outright', POSIX, () =>
{
    const { dir } = project('serena-move');
    put(path.join(dir, '.serena', 'project.yml'), 'project_name: x\n');
    put(path.join(dir, '.serena', 'home', 'serena_config.yml'), 'project_serena_folder_location: "$projectDir/.serena"\nprojects:\n- /x\n');
    put(path.join(dir, '.serena', 'memories', 'feature__v1__designer.md'), 'handoff');
    stamp(dir, ['data-pending: serena .serena -> .alfred/serena']);
    const rec = stubRecorder('serena-move', 'uvx');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.ok(!fs.existsSync(path.join(dir, '.serena')), 'the old folder moved');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', 'serena', 'memories', 'feature__v1__designer.md'), 'utf8'), 'handoff');
    assert.match(fs.readFileSync(path.join(dir, '.alfred', 'serena', 'home', 'serena_config.yml'), 'utf8'), /project_serena_folder_location: "\$projectDir\/\.alfred\/serena"\nprojects:\n- \/x/);
    assert.strictEqual(rec.got().home, '.alfred/serena/home');
    const argv = rec.got().argv;
    assert.ok(!argv.includes('--project-from-cwd'), 'with no .git and no .serena/project.yml, the walk up from the cwd would find nothing - or a parent');
    assert.deepStrictEqual(argv.slice(argv.indexOf('--project'), argv.indexOf('--project') + 2), ['--project', fs.realpathSync(dir)]);
});

test('serena-launch: a custom data root from the project settings', POSIX, () =>
{
    const { dir } = project('serena-custom', { settings: { ALFRED_CODE_DATA_PATH: '.data' } });
    fs.mkdirSync(path.join(dir, '.git'));
    const rec = stubRecorder('serena-custom', 'uvx');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().home, '.data/serena/home');
});

const BROWSER = path.join(ROOT, 'stack/mcp/browser-launch.js');

test('browser-launch: npx gets the pinned package, the engine, and a profile and output dir under the data root', POSIX, () =>
{
    const { dir } = project('browser-run');
    const rec = stubRecorder('browser-run', 'npx');
    execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.82', '--browser', 'firefox'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    const real = fs.realpathSync(dir);
    assert.deepStrictEqual(rec.got().argv, ['-y', '@playwright/mcp@0.0.82', '--browser', 'firefox',
        '--user-data-dir', path.join(real, '.alfred', 'browser', 'firefox'), '--output-dir', path.join(real, '.alfred', 'browser', 'firefox', 'output')]);
});

test('browser-launch: a 2.0.0 profile keeps serving until a move is agreed, then moves at start unless a browser holds it', POSIX, () =>
{
    const { dir } = project('browser-move');
    put(path.join(dir, '.playwright', 'chrome', 'Default', 'Cookies'), 'session');
    const real = fs.realpathSync(dir);
    const run = (name) =>
    {
        const rec = stubRecorder(name, 'npx');
        execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.82', '--browser', 'chrome', '--', '--isolated-no'],
            { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
        const argv = rec.got().argv;
        return { dataDir: argv[argv.indexOf('--user-data-dir') + 1], argv };
    };
    assert.strictEqual(run('browser-move-1').dataDir, path.join(real, '.playwright', 'chrome'), 'no move agreed: the old profile, where it is');
    stamp(dir, ['data-pending: browser-chrome .playwright/chrome -> .alfred/browser/chrome']);
    fs.symlinkSync('host-1', path.join(dir, '.playwright', 'chrome', 'SingletonLock'));
    assert.strictEqual(run('browser-move-2').dataDir, path.join(real, '.playwright', 'chrome'), 'a running browser holds it: not this start');
    fs.unlinkSync(path.join(dir, '.playwright', 'chrome', 'SingletonLock'));
    const moved = run('browser-move-3');
    assert.strictEqual(moved.dataDir, path.join(real, '.alfred', 'browser', 'chrome'));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', 'browser', 'chrome', 'Default', 'Cookies'), 'utf8'), 'session', 'the login moved with the profile');
    assert.strictEqual(moved.argv[moved.argv.length - 1], '--isolated-no', 'arguments after -- reach the server unchanged');
});

test('browser-launch: an entry with no --package or no --browser says so instead of launching something else', () =>
{
    for (const args of [['--browser', 'chrome'], ['--package', '@playwright/mcp@0.0.82'], ['--package', '@playwright/mcp@0.0.82', '--browser', 'lynx']])
    {
        let code = 0;
        try { execFileSync(process.execPath, [BROWSER, ...args], { env: BARE, stdio: 'pipe' }); }
        catch (err) { code = err.status; }
        assert.strictEqual(code, 2, args.join(' '));
    }
});

test('memory-launch: an idle ~/.memory-mcp moves to ~/.alfred-memory at start and the old path is linked back', POSIX, () =>
{
    const { dir } = project('mem-home-move', { local: { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'mem-home-move', '.alfred-memory', 'memory.db') } });
    put(path.join(dir, '.memory-mcp', 'memory.db'), 'DB');
    const rec = stubRecorder('mem-home-move', 'uvx');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, USERPROFILE: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().db, path.join(dir, '.alfred-memory', 'memory.db'));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred-memory', 'memory.db'), 'utf8'), 'DB');
    assert.ok(fs.lstatSync(path.join(dir, '.memory-mcp')).isSymbolicLink(), 'Cursor and an install not yet updated reach it through the old path');
});

test('memory-launch: a ~/.memory-mcp database another server holds stays put, and is served where it is', POSIX, () =>
{
    const { dir } = project('mem-home-busy', { local: { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'mem-home-busy', '.alfred-memory', 'memory.db') } });
    put(path.join(dir, '.memory-mcp', 'memory.db'), 'DB');
    put(path.join(dir, '.memory-mcp', 'memory.db-wal'), 'LIVE');
    const rec = stubRecorder('mem-home-busy', 'uvx');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, USERPROFILE: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().db, path.join(dir, '.memory-mcp', 'memory.db'), 'never a second, empty database beside the live one');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred-memory')), 'the new folder is not created while the old one serves');
});

test('memory-launch: a project-level database moves under the data root when the installer recorded it and it is idle', POSIX, () =>
{
    const { dir } = project('mem-proj');
    const real = fs.realpathSync(dir);
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(real, '.alfred', '.alfred-memory', 'memory.db') } }));
    put(path.join(dir, '.memory-mcp', 'memory.db'), 'PROJ');
    put(path.join(dir, '.memory-mcp', '.gitignore'), '*\n');
    stamp(dir, ['data-pending: memory .memory-mcp -> .alfred/.alfred-memory']);
    const rec = stubRecorder('mem-proj', 'uvx');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: path.join(dir, 'h'), USERPROFILE: path.join(dir, 'h') }, stdio: 'pipe' });
    assert.strictEqual(rec.got().db, path.join(real, '.alfred', '.alfred-memory', 'memory.db'));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', '.alfred-memory', 'memory.db'), 'utf8'), 'PROJ');
    assert.ok(!fs.existsSync(path.join(dir, '.memory-mcp')));
});

// ------------------------------------------------------------------ I1: every writer under the data root ignores it first

// A 2.0.0 project whose MCP plugins are already 2.1 (a user-scope install updated from another project, or a
// marketplace auto-update): the docs sit at .alfred/docs with their own .gitignore, and there is no
// .alfred/.gitignore. The first launcher start that writes under the root lays that file down first, so a browser
// profile's cookies and serena's ~327MB home are never untracked files a `git add -A` takes in.
function twoZeroProject(name)
{
    const { dir } = project(name, { settings: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' } });
    execFileSync('git', ['init', '-q', dir]);
    put(path.join(dir, '.alfred', 'docs', '.gitignore'), '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n');
    put(path.join(dir, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), '# arch\n');
    return dir;
}
const ignored = (dir, rel) => { try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: dir, stdio: 'ignore' }); return true; } catch { return false; } };

test('I1 browser-launch: a never-used engine on a 2.0.0 project gets the data root ignored before its profile is handed out', POSIX, () =>
{
    const dir = twoZeroProject('i1-browser');
    const rec = stubRecorder('i1-browser', 'npx');
    execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.82', '--browser', 'chrome'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    put(path.join(dir, '.alfred', 'browser', 'chrome', 'Default', 'Cookies'), 'session');   // what Playwright writes next
    assert.ok(fs.existsSync(path.join(dir, '.alfred', '.gitignore')), 'the launcher wrote the root\'s .gitignore');
    assert.ok(ignored(dir, '.alfred/browser/chrome/Default/Cookies'), 'the session cookies are ignored');
    assert.ok(!ignored(dir, '.alfred/docs/architecture/ARCHITECTURE.md'), 'the docs stay visible to git');
    assert.ok(!ignored(dir, '.alfred/.gitignore'), 'the ignore file re-includes itself, so a teammate\'s clone inherits it');
});

test('I1 serena-launch: a fresh serena folder under a 2.0.0 project\'s root is ignored before serena writes it', POSIX, () =>
{
    const dir = twoZeroProject('i1-serena');
    const rec = stubRecorder('i1-serena', 'uvx');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.ok(ignored(dir, '.alfred/serena/home/serena_config.yml'), 'serena\'s home is ignored');
    assert.ok(!ignored(dir, '.alfred/docs/architecture/ARCHITECTURE.md'), 'the docs stay visible to git');
});

test('I1 memory-launch: a project-level database under the root is ignored before the folder is created', POSIX, () =>
{
    const dir = twoZeroProject('i1-memory');
    const real = fs.realpathSync(dir);
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(real, '.alfred', '.alfred-memory', 'memory.db') } }));
    const rec = stubRecorder('i1-memory', 'uvx');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: path.join(dir, 'h'), USERPROFILE: path.join(dir, 'h') }, stdio: 'pipe' });
    put(path.join(dir, '.alfred', '.alfred-memory', 'memory.db'), 'PROJ');
    assert.ok(ignored(dir, '.alfred/.alfred-memory/memory.db'), 'the project database is ignored');
});

test('I1 launchers: a data root .gitignore the project wrote itself is left as it is', POSIX, () =>
{
    const dir = twoZeroProject('i1-own');
    put(path.join(dir, '.alfred', '.gitignore'), '# mine\n/browser/\n');
    const rec = stubRecorder('i1-own', 'npx');
    execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.82', '--browser', 'firefox'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', '.gitignore'), 'utf8'), '# mine\n/browser/\n');
});

// ------------------------------------------------------------------ I2: a failed link never splits the memories

test('I2 memory-launch: the move ran but the link failed - the launcher serves the new file and never re-creates the old folder', POSIX, () =>
{
    const { dir } = project('i2-nolink');
    put(path.join(dir, '.memory-mcp', 'memory.db'), 'DB');
    const lines = [];
    const eperm = () => { const err = new Error('operation not permitted'); err.code = 'EPERM'; throw err; };
    const { liveDb } = require(LAUNCH);
    const db = liveDb(path.join(dir, '.memory-mcp', 'memory.db'), { projectDir: dir, home: dir, log: (l) => lines.push(l), symlink: eperm });
    assert.strictEqual(db, path.join(dir, '.alfred-memory', 'memory.db'));
    assert.ok(!fs.existsSync(path.join(dir, '.memory-mcp')), 'the old folder is not re-created');
    assert.match(lines.join('\n'), /Cursor/, `the consequence for a reader still on the old path is named:\n${lines.join('\n')}`);
});

test('I2 memory-launch: settings still naming a gone ~/.memory-mcp start the server on ~/.alfred-memory, and create nothing at the old path', POSIX, () =>
{
    const { dir } = project('i2-gone', { local: { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'i2-gone', '.memory-mcp', 'memory.db') } });
    put(path.join(dir, '.alfred-memory', 'memory.db'), 'DB');
    const rec = stubRecorder('i2-gone', 'uvx');
    execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, USERPROFILE: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().db, path.join(dir, '.alfred-memory', 'memory.db'));
    assert.ok(!fs.existsSync(path.join(dir, '.memory-mcp')), 'never a second, empty database at the old path');
});

test('I2 memory-launch: ~/.memory-mcp re-created after the move (another reader on the old path) - the settings\' old spelling reads the stack\'s moved database', POSIX, () =>
{
    const { dir } = project('i2-recreated', { local: { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'i2-recreated', '.memory-mcp', 'memory.db') } });
    put(path.join(dir, '.alfred-memory', 'memory.db'), 'DB');
    put(path.join(dir, '.memory-mcp', 'memory.db'), 'EMPTY');
    const rec = stubRecorder('i2-recreated', 'uvx');
    const out = execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, USERPROFILE: dir }, stdio: 'pipe' });
    assert.strictEqual(rec.got().db, path.join(dir, '.alfred-memory', 'memory.db'), String(out));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.memory-mcp', 'memory.db'), 'utf8'), 'EMPTY', 'the other reader\'s file is not touched');
});
