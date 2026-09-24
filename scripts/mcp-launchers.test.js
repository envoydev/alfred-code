'use strict';
// The two small programs a plugin MCP entry cannot do without: the memory launcher, which turns the
// install's level choice into a db path, and the sentry headers helper, which decides whether there
// is an auth header at all. Both exist because a plugin entry expands only the SHELL and the ACCOUNT
// settings env - a PROJECT settings key arrives literal (measured, docs/plugin-migration-evidence.md).
//
// Every case runs on a SCRUBBED environment. This machine has a real SENTRY_ACCESS_TOKEN exported,
// and a test that inherited it would put a live credential in its own assertions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LAUNCH = path.join(ROOT, 'stack/mcp/memory-launch.js');
const HEADERS = path.join(ROOT, 'stack/mcp/sentry-headers.js');
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

function runHeaders(projectDir, env)
{
    return execFileSync(process.execPath, [HEADERS, projectDir],
        { env: { ...BARE, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// ------------------------------------------------------------------ memory-launch.js

test('memory-launch: the project settings env is the db, because a plugin entry cannot read it', () =>
{
    const { dir } = project('proj-db', { settings: { ALFRED_CODE_MEMORY_DB: '/tmp/chosen/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/chosen/memory.db');
});

test('memory-launch: settings.local.json is the per-machine override, read after settings.json', () =>
{
    const { dir } = project('local-db', { local: { ALFRED_CODE_MEMORY_DB: '/tmp/local/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/local/memory.db');
    // ... and settings.json WINS when both are present: it is what the install wrote.
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/tmp/installed/memory.db' } }));
    assert.strictEqual(resolveDb(dir, { HOME: dir }), '/tmp/installed/memory.db');
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
    assert.strictEqual(resolveDb(dir, { HOME: dir, USERPROFILE: dir }), path.join(dir, '.memory-mcp', 'memory.db'));
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
    assert.strictEqual(resolveDb(dir, { HOME: dir, USERPROFILE: dir }), path.join(dir, '.memory-mcp', 'memory.db'));
});

test('memory-launch: a hand-edited entry with no --package says so instead of launching something else', () =>
{
    let code = 0;
    try { execFileSync(process.execPath, [LAUNCH], { env: BARE, stdio: 'pipe' }); }
    catch (err) { code = err.status; }
    assert.strictEqual(code, 2);
});

// ------------------------------------------------------------------ sentry-headers.js

test('sentry-headers: token mode prints the Sentry-Bearer header, the scheme the API takes', () =>
{
    const { dir, acct } = project('sentry-token', { account: { SENTRY_ACCESS_TOKEN: 'sntryu_TESTVALUE' } });
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer sntryu_TESTVALUE' });
});

test('sentry-headers: oauth mode prints NO header, and the two modes never mix', () =>
{
    const { dir, acct } = project('sentry-oauth', {
        settings: { ALFRED_CODE_SENTRY_AUTH: 'oauth' },
        account: { SENTRY_ACCESS_TOKEN: 'sntryu_TESTVALUE' },
    });
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct })), {});
});

test('sentry-headers: no token in token mode degrades to no header, never to a broken one', () =>
{
    const { dir, acct } = project('sentry-none');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct })), {});
});

test('sentry-headers: stdout is ONE json object and nothing else - it becomes the request headers', () =>
{
    const { dir, acct } = project('sentry-quiet');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(out, '{}');
    assert.doesNotThrow(() => JSON.parse(out));
});

test('sentry-headers: the SHELL env wins where it survives - the copy route and a run by hand', () =>
{
    const { dir, acct } = project('sentry-shell', { account: { SENTRY_ACCESS_TOKEN: 'from-file' } });
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct, SENTRY_ACCESS_TOKEN: 'from-shell' });
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer from-shell' });
});

// The environment this helper ACTUALLY gets on the plugin route. Claude Code removes every variable
// whose name carries TOKEN, SECRET, PASSWORD, KEY or AUTH from a helper a plugin or a project
// `.mcp.json` supplies (https://code.claude.com/docs/en/mcp, 'Which variables a helper can read'),
// and BOTH keys this file reads are such names - so a user who only exported the token gets no
// header, and the account settings.json is the only source that answers. Scrub the env the way the
// docs describe and the file path has to carry the whole job.
const scrub = (env) => Object.fromEntries(Object.entries(env)
    .filter(([k]) => !/TOKEN|SECRET|PASSWORD|KEY|AUTH/i.test(k)));

test('sentry-headers: with the credential variables removed, the ACCOUNT FILE still answers', () =>
{
    const { dir, acct } = project('sentry-scrubbed', { account: { SENTRY_ACCESS_TOKEN: 'from-file' } });
    const out = runHeaders(dir, scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct, SENTRY_ACCESS_TOKEN: 'from-shell' }));
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer from-file' },
        'the shell export reached a helper that cannot read it, or the file source stopped answering');
});

test('sentry-headers: the oauth PIN survives the scrub too - it is read from a file, not the env', () =>
{
    const { dir, acct } = project('sentry-scrubbed-oauth', {
        settings: { ALFRED_CODE_SENTRY_AUTH: 'oauth' },
        account: { SENTRY_ACCESS_TOKEN: 'from-file' },
    });
    const env = scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct, ALFRED_CODE_SENTRY_AUTH: 'token' });
    assert.ok(!('ALFRED_CODE_SENTRY_AUTH' in env), 'the scrub must drop the mode key - it carries AUTH');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, env)), {},
        'oauth mode pinned in the project settings lost to an env value the runtime removes');
});

// The helper STRING runs through a shell ('Use dynamic headers for custom authentication',
// code.claude.com/docs/en/mcp), so an unquoted placeholder splits on a space: a plugin root under a
// home like 'C:\Users\First Last' lost the script, a project path with a space lost the settings
// that pin oauth. So the GENERATED string runs here through sh with a space in both, once with the
// placeholders substituted as text (how ${CLAUDE_PROJECT_DIR} arrives) and once exported. The
// oauth pin is the witness: a split project path reads no pin and sends the token instead.
test('sentry-headers: the generated helper string survives a space in the plugin root and the project', { skip: process.platform === 'win32' && 'sh is not the Windows shell' }, () =>
{
    const { mcpServerShapes } = require('./build-marketplace.js');
    const helper = mcpServerShapes().sentry.servers.sentry.headersHelper;
    const root = path.join(TMP, 'plugin root');
    fs.mkdirSync(path.join(root, 'stack', 'mcp'), { recursive: true });
    fs.copyFileSync(HEADERS, path.join(root, 'stack', 'mcp', 'sentry-headers.js'));
    const { dir, acct } = project('sentry project dir', {
        settings: { ALFRED_CODE_SENTRY_AUTH: 'oauth' },
        account: { SENTRY_ACCESS_TOKEN: 'from-file' },
    });
    const env = { ...BARE, HOME: dir, CLAUDE_CONFIG_DIR: acct };
    for (const [how, line, extra] of [
        ['substituted', helper.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('${CLAUDE_PROJECT_DIR}', dir), {}],
        ['exported', helper, { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: dir }],
    ])
    {
        const out = execFileSync('sh', ['-c', line], { env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        assert.deepStrictEqual(JSON.parse(out), {}, `${how}: ${helper} lost a path to the space`);
    }
});

test('sentry-headers: CLAUDE_CONFIG_DIR is NOT a credential name, so a space install still finds its account file', () =>
{
    const { dir, acct } = project('sentry-space', { account: { SENTRY_ACCESS_TOKEN: 'space-token' } });
    const env = scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, acct, 'the scrub swallowed the config dir - the account file would be unreachable');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, env)), { Authorization: 'Sentry-Bearer space-token' });
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
    const uvx = stubUvx('serena');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--context', 'claude-code', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, SERENA_HOME: '.serena/home' }, stdio: 'pipe' });
    const got = uvx.argv();
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--from', 'serena-agent@1.7.0', 'serena', 'start-mcp-server', '--context', 'claude-code', '--project-from-cwd']);
    // RELATIVE and native: serena 1.7.0 execs the TypeScript server through npm's .bin shim, so on
    // Windows the path reaches cmd.exe unquoted - a '/' cuts it ('.serena' is not recognized as an
    // internal or external command), and so would a space in an absolute project path.
    assert.strictEqual(got.home, '.serena/home', 'the home stays relative - an absolute one carries the project path, spaces and all');
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

test('serena-launch: an absolute SERENA_HOME passes through; an absent one stays absent', POSIX, () =>
{
    const { dir } = project('serena-home');
    const abs = path.join(TMP, 'elsewhere', '.serena', 'home');
    const uvx = stubUvx('serena-home');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, SERENA_HOME: abs }, stdio: 'pipe' });
    assert.strictEqual(uvx.argv().home, abs);
    const bare = stubUvx('serena-nohome');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server'],
        { cwd: dir, env: { ...BARE, PATH: bare.PATH, HOME: dir }, stdio: 'pipe' });
    assert.strictEqual(bare.argv().home, null, 'the launcher invented a SERENA_HOME the entry never set');
});

test('serena home spelling for the copy route: backslash on Windows, forward slash elsewhere', () =>
{
    const { serenaHomeFor } = require(SERENA);
    assert.strictEqual(serenaHomeFor('win32'), '.serena\\home');
    for (const p of ['darwin', 'linux']) assert.strictEqual(serenaHomeFor(p), '.serena/home', p);
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
