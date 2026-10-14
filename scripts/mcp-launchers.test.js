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
const { execFileSync, spawnSync } = require('node:child_process');

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
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/chosen/memory.db'));
});

// I7 (R47, fix round 1): settings.local.json is read BEFORE settings.json, the same order
// uv-python.js already uses - a local-scope install (T16) writes ALFRED_CODE_MEMORY_DB only to the
// local file, so reading the shared file first would open the wrong project's database whenever a
// repo also carries a committed project-scope install.
test('memory-launch: settings.local.json is the per-machine override, and it WINS over settings.json', () =>
{
    const { dir } = project('local-db', { local: { ALFRED_CODE_MEMORY_DB: '/tmp/local/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/local/memory.db'));
    // ... and stays the winner once settings.json also registers one: local is this machine's own.
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/tmp/installed/memory.db' } }));
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/local/memory.db'));
});

test('memory-launch: the ACCOUNT settings env answers for a global install', () =>
{
    const { dir, acct } = project('acct-db', { account: { ALFRED_CODE_MEMORY_DB: '/tmp/acct/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct }), path.normalize('/tmp/acct/memory.db'));
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

test('memory-launch: an EMPTY settings file holds no key - the default still answers', () =>
{
    const { dir } = project('empty-db');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '');
    assert.strictEqual(resolveDb(dir, { HOME: dir, USERPROFILE: dir }), path.join(dir, '.alfred-memory', 'memory.db'));
});

// Review 2.1.6 re-verify N2 - F2 on the plugin route: a settings file that did not parse was read as empty, so the
// launcher fell through to the GLOBAL database with no line, and every session wrote this project's memories into the
// account-wide one. A file that cannot be read is no answer: a later readable file's key answers (settings.json, then
// the account settings), said on stderr; with none the launcher refuses to start - the server shows as failed in /mcp -
// rather than open a database this project never chose.
const SHEBANG = { skip: process.platform === 'win32' && 'the stub uvx is a node script with a shebang' };
const launch = (dir, env) =>
{
    const bin = path.join(TMP, `${path.basename(dir)}-bin`);
    const record = path.join(TMP, `${path.basename(dir)}-db.txt`);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, process.env.MCP_MEMORY_SQLITE_PATH || '');\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'],
        { cwd: dir, env: { ...BARE, PATH: bin + path.delimiter + process.env.PATH, HOME: dir, USERPROFILE: dir, ...env }, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, db: fs.existsSync(record) ? fs.readFileSync(record, 'utf8') : null };
};

test('memory-launch: a malformed settings file with no other key refuses to start, naming it - never the global database', SHEBANG, () =>
{
    const { dir, acct } = project('bad-local');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage');
    const r = launch(dir, { CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(r.db, null, `the server started on ${r.db}`);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /settings\.local\.json could not be read/, r.stderr);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1, r.stderr);
});

test('memory-launch: a malformed settings.local.json hands over to the next readable key - settings.json, then the account settings - and says so', SHEBANG, () =>
{
    const shared = project('bad-local-shared', { settings: { ALFRED_CODE_MEMORY_DB: '/tmp/shared/memory.db' } });
    fs.writeFileSync(path.join(shared.dir, '.claude', 'settings.local.json'), '[1,2]');
    const a = launch(shared.dir, { CLAUDE_CONFIG_DIR: shared.acct });
    assert.strictEqual(a.db, '/tmp/shared/memory.db', a.stderr);
    assert.match(a.stderr, /settings\.local\.json could not be read/, a.stderr);
    const account = project('bad-both-acct', { account: { ALFRED_CODE_MEMORY_DB: '/tmp/account/memory.db' } });
    fs.writeFileSync(path.join(account.dir, '.claude', 'settings.local.json'), '{ garbage');
    fs.writeFileSync(path.join(account.dir, '.claude', 'settings.json'), '{ garbage');
    assert.strictEqual(launch(account.dir, { CLAUDE_CONFIG_DIR: account.acct }).db, '/tmp/account/memory.db');
});

// Re-verify 3 S6: where the stamp's ledger records the key in the unreadable settings.local.json, that file is the key's only
// home - the account's key (the global database, say) never answers for it, and the refusal says why, not 'no other file'.
test('memory-launch: an unreadable settings.local.json the ledger records the key in refuses, whatever a lower file names', SHEBANG, () =>
{
    const { dir, acct } = project('ledger-local', { account: { ALFRED_CODE_MEMORY_DB: '/tmp/account/memory.db' } });
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), `managed-env: settings.local.json:ALFRED_CODE_MEMORY_DB=${'a'.repeat(64)}\n`);
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ "env": { "ALFRED_CODE_MEMORY_DB": "/tmp/pro');
    const r = launch(dir, { CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(r.db, null, `the server started on ${r.db}`);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /settings\.local\.json could not be read, and it is the file this install keeps ALFRED_CODE_MEMORY_DB in \(the stamp's managed-env\) - not started/, r.stderr);
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
    fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), home: process.env.SERENA_HOME || null, tools: process.env.WINDOWS_MCP_TOOLS === undefined ? null : process.env.WINDOWS_MCP_TOOLS, exclude: process.env.UV_EXCLUDE_NEWER === undefined ? null : process.env.UV_EXCLUDE_NEWER }));\n`, { mode: 0o755 });
    return { PATH: bin + path.delimiter + process.env.PATH, argv: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}
const POSIX = { skip: process.platform === 'win32' && 'the stub uvx is a node script with a shebang' };

// The plugin entry's own argv, as the marketplace ships it - a launcher test over a hand-written copy
// passes while the shipped entry drifts.
const SHIPPED_ENTRIES = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins;
const entryArgs = (name) => SHIPPED_ENTRIES.find((p) => p.name === name).mcpServers[name].args.slice(1);
const SERENA_CONTEXT = path.join(ROOT, 'stack', 'mcp', 'navigation-context.yml');

test('serena-launch: uvx gets the Python pin, the pinned package and every serena argument, in order', POSIX, () =>
{
    const { dir } = project('serena-run');
    fs.mkdirSync(path.join(dir, '.git'));
    const uvx = stubUvx('serena');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--context', 'claude-code', '--project-from-cwd'],
        { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, SERENA_HOME: '.serena/home' }, stdio: 'pipe' });
    const got = uvx.argv();
    // I12: the upstream claude-code context is swapped for the stack's own, beside the launcher.
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--from', 'serena-agent@1.7.0', 'serena', 'start-mcp-server', '--context', SERENA_CONTEXT, '--project-from-cwd']);
    // RELATIVE and native: serena 1.7.0 execs the TypeScript server through npm's .bin shim, so on
    // Windows the path reaches cmd.exe unquoted - a '/' cuts it ('.serena' is not recognized as an
    // internal or external command), and so would a space in an absolute project path.
    assert.strictEqual(got.home, '.alfred/serena/home', 'the home stays relative, under the data root - whatever the entry passed');
});

// I12: serena 1.7.0's claude-code context serves seven file-writing tools (replace_content, replace_in_files,
// replace_symbol_body, insert_after_symbol, insert_before_symbol, rename_symbol, safe_delete_symbol), and a write
// through one bypasses every Edit/Write-matched guard. The ruling keeps rename and safe delete (reference-aware
// refactors) and turns the other five off, with onboarding. serena reads `--context <path>` as a custom context
// YAML (context_mode.py: a value with a separator or a .yml suffix is a file), so the launcher hands it the
// stack's own file - from the SHIPPED entry's argv, the one a plugin start really passes.
test('serena-launch: the shipped navigation entry starts serena on the stack context, never the upstream claude-code one (I12)', POSIX, () =>
{
    const { dir } = project('serena-context');
    fs.mkdirSync(path.join(dir, '.git'));
    const uvx = stubUvx('serena-context');
    const args = entryArgs('alfred-navigation');
    execFileSync(process.execPath, [SERENA, ...args], { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir }, stdio: 'pipe' });
    const argv = uvx.argv().argv;
    assert.strictEqual(argv[argv.indexOf('--context') + 1], SERENA_CONTEXT, argv.join(' '));
    assert.ok(fs.existsSync(SERENA_CONTEXT), 'the context file ships beside the launcher');
    // A context the entry names that is not claude-code is the user's own choice - passed unchanged.
    const own = stubUvx('serena-context-own');
    execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--context', 'agent'],
        { cwd: dir, env: { ...BARE, PATH: own.PATH, HOME: dir }, stdio: 'pipe' });
    assert.deepStrictEqual(own.argv().argv.slice(-2), ['--context', 'agent']);
});

// The file itself: serena 1.7.0's own claude-code context (single_project, structured output off, its six
// exclusions) plus the six the ruling names, and a prompt that sends edits to the harness tools - it never
// tells the model the Edit tool is forbidden, which the upstream prompt does.
const yamlList = (text, key) =>
{
    const at = text.split('\n').findIndex((l) => l === `${key}:`);
    if (at < 0) return null;
    const out = [];
    for (const line of text.split('\n').slice(at + 1))
    {
        const m = /^\s+-\s+(\S+)\s*$/.exec(line);
        if (m) out.push(m[1]); else if (line.trim() && !/^\s*#/.test(line)) break;
    }
    return out;
};
test('the stack serena context: upstream claude-code exclusions kept, the five edit tools, onboarding and the memory tools off, rename and safe delete on (I12)', () =>
{
    const text = fs.readFileSync(SERENA_CONTEXT, 'utf8');
    const excluded = yamlList(text, 'excluded_tools');
    const upstream = ['create_text_file', 'read_file', 'execute_shell_command', 'find_file', 'list_dir', 'search_for_pattern'];
    const ruled = ['replace_content', 'replace_in_files', 'replace_symbol_body', 'insert_after_symbol', 'insert_before_symbol', 'onboarding'];
    // The user's 2026-10-13 ruling: the server is navigation only - every note goes to alfred-memory.
    const memory = ['write_memory', 'read_memory', 'list_memories', 'edit_memory', 'rename_memory', 'delete_memory'];
    assert.deepStrictEqual([...excluded].sort(), [...upstream, ...ruled, ...memory].sort(), excluded.join(','));
    for (const kept of ['rename_symbol', 'safe_delete_symbol', 'find_symbol']) assert.ok(!excluded.includes(kept), `${kept} must stay on`);
    assert.match(text, /^single_project: true$/m);
    assert.match(text, /^structured_tool_output: false$/m);
    assert.match(text, /^tool_description_overrides: \{\}$/m);
    const prompt = text.slice(text.indexOf('prompt: |'), text.indexOf('excluded_tools:'));
    assert.doesNotMatch(prompt, /FORBIDDEN|forbidden|deny such edits|load them all immediately/, 'the upstream prompt\'s rules against the harness tools are not carried');
    assert.match(prompt, /\bEdit\b/, 'the prompt sends edits to the harness Edit tool');
    assert.match(prompt, /rename_symbol/);
    assert.match(prompt, /safe_delete_symbol/);
    assert.doesNotMatch(prompt, /write_memory/, 'the seat handoff left this server');
    assert.match(prompt, /goes through the alfred-memory MCP/, 'the prompt sends notes to alfred-memory');
    assert.ok(!/—/.test(text), 'house voice: no em-dash');
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
// The two desktop servers drive THIS machine's own apps: windows-control (Windows-MCP) on Windows,
// macos-control (MacOS-MCP) on macOS. The OS is forced through ALFRED_CODE_PLATFORM so every case runs
// on any host.
const DESKTOP = path.join(ROOT, 'stack/mcp/desktop-launch.js');
// I10: the shipped entry's own argv - FileSystem (write, copy, move, delete) joins the default gate.
const WIN_ARGS = entryArgs('windows-control');
const MAC_ARGS = ['--server', 'macos-control', '--package', 'macos-mcp==0.4.6', '--', 'serve'];

function desktopRun(name, args, { env = {}, settings } = {})
{
    const { dir, acct } = project(name, { settings });
    const uvx = stubUvx(name);
    const run = require('node:child_process').spawnSync(process.execPath, [DESKTOP, ...args], { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, CLAUDE_CONFIG_DIR: acct, ...env }, encoding: 'utf8' });
    const res = { status: run.status, stderr: String(run.stderr || ''), stdout: String(run.stdout || '') };
    let argv = null;
    try { argv = uvx.argv().argv; } catch { /* uvx never started */ }
    return { ...res, argv };
}

test('desktop-launch: windows-control gets the Python pin, the pinned package, serve and the safe tool gate, in order', POSIX, () =>
{
    const got = desktopRun('desktop-win', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.strictEqual(got.status, 0, got.stderr);
    assert.deepStrictEqual(got.argv, ['--python', '3.13', '--exclude-newer', CUTOFF, '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve', '--exclude-tools', 'PowerShell,Registry,Process,FileSystem']);
    assert.strictEqual(got.stdout, '', 'stdout is the MCP stream - the launcher writes nothing there');
});

test('desktop-launch: ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE replaces the list, and none passes no gate at all', POSIX, () =>
{
    const one = desktopRun('desktop-win-one', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'PowerShell' } });
    assert.deepStrictEqual(one.argv.slice(6), ['windows-mcp', 'serve', '--exclude-tools', 'PowerShell']);
    const none = desktopRun('desktop-win-none', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'none' } });
    assert.deepStrictEqual(none.argv.slice(6), ['windows-mcp', 'serve'], 'none must pass no --exclude-tools, so the user\'s own Windows-MCP config applies');
    const empty = desktopRun('desktop-win-empty', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: '' } });
    assert.deepStrictEqual(empty.argv.slice(8), ['--exclude-tools', 'PowerShell,Registry,Process,FileSystem'], 'an empty override is no override');
});

test('desktop-launch: the override is read from the PROJECT settings a plugin server never gets as env', POSIX, () =>
{
    const got = desktopRun('desktop-win-proj', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32' }, settings: { ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'none' } });
    assert.deepStrictEqual(got.argv.slice(6), ['windows-mcp', 'serve']);
});

// 2026-10-13: the key followed the server's rename (windows-desktop -> windows-control). One the user set under the old
// spelling - in the shell or a settings file - still decides while the new one is unset, and is named as renamed; the
// new one wins when both are set. A lifted gate never closes quietly on an update, an open one never opens.
test('desktop-launch: the old WINDOWS_DESKTOP_EXCLUDE is still read while the new key is unset, named as renamed; the new key wins', POSIX, () =>
{
    const shell = desktopRun('desktop-win-oldkey', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'none' } });
    assert.deepStrictEqual(shell.argv.slice(6), ['windows-mcp', 'serve'], 'the old none still lifts the gate');
    assert.match(shell.stderr, /ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE read as ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE - the server is windows-control now/);
    const file = desktopRun('desktop-win-oldfile', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32' }, settings: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'PowerShell' } });
    assert.deepStrictEqual(file.argv.slice(6), ['windows-mcp', 'serve', '--exclude-tools', 'PowerShell'], 'a settings file\'s old key too');
    const both = desktopRun('desktop-win-bothkeys', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'none', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'Registry' } });
    assert.deepStrictEqual(both.argv.slice(6), ['windows-mcp', 'serve', '--exclude-tools', 'Registry'], 'the new key wins');
    assert.doesNotMatch(both.stderr, /read as/, 'and no rename line then');
});

test('desktop-launch: macos-control runs serve on the pin, and the Windows gate never reaches it', POSIX, () =>
{
    const got = desktopRun('desktop-mac', MAC_ARGS, { env: { ALFRED_CODE_PLATFORM: 'darwin', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'Shell' } });
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
    assert.match(got.stderr, /not started - keep it off on this machine only: claude plugin disable windows-control@envoydev --scope local\n$/);
    assert.doesNotMatch(got.stderr, /\/plugin/, 'the /plugin toggle writes the scope the entry sits at - a project one reaches every teammate');
    const cached = path.join(TMP, 'cache-copy', 'plugins', 'cache', 'acme-key', 'windows-control', '2.0.0', 'stack', 'mcp');
    fs.mkdirSync(cached, { recursive: true });
    for (const f of ['desktop-launch.js', 'uv-python.js']) fs.copyFileSync(path.join(ROOT, 'stack/mcp', f), path.join(cached, f));
    let stderr = '';
    try { execFileSync(process.execPath, [path.join(cached, 'desktop-launch.js'), ...WIN_ARGS], { env: { ...BARE, ALFRED_CODE_PLATFORM: 'linux' }, stdio: 'pipe', encoding: 'utf8' }); }
    catch (err) { stderr = String(err.stderr || ''); }
    assert.match(stderr, /claude plugin disable windows-control@acme-key --scope local/, 'the marketplace key is the cache folder the launcher runs from');
});

test('desktop-launch: a hand-edited entry with no --server or --package says so instead of launching something else', () =>
{
    for (const args of [['--package', 'windows-mcp==0.8.5', '--', 'serve'], ['--server', 'windows-control', '--', 'serve'], ['--server', 'linux-desktop', '--package', 'x==1']])
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

// M24: the pin fixes the top package only, and its dependencies float - two starts a week apart could resolve
// different trees. Every uvx launcher hands uvx the release's own `--exclude-newer` cut-off, read from the SHIPPED
// entry (the pins file's refreshed day, its last second in UTC), right after the Python pin. A UV_EXCLUDE_NEWER the
// user set is uv's own knob and wins (`false` for a mirror that publishes no upload time); a malformed one is dropped.
const PINS_FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'mcp-pins.json'), 'utf8'));
const CUTOFF = `${PINS_FILE.refreshed}T23:59:59Z`;
test('M24 uvx launchers: the shipped entry\'s --exclude-newer cut-off reaches uvx right after the Python pin', POSIX, () =>
{
    const cases = [['alfred-navigation', SERENA], ['alfred-memory', LAUNCH], ['windows-control', DESKTOP], ['macos-control', DESKTOP]];
    for (const [name, launcher] of cases)
    {
        const { dir, acct } = project(`cutoff-${name}`, { settings: { ALFRED_CODE_MEMORY_DB: path.join(TMP, `cutoff-${name}-db`, 'memory.db') } });
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        const uvx = stubUvx(`cutoff-${name}`);
        const platform = name === 'windows-control' ? 'win32' : 'darwin';
        execFileSync(process.execPath, [launcher, ...entryArgs(name)], { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, CLAUDE_CONFIG_DIR: acct, ALFRED_CODE_PLATFORM: platform }, stdio: 'pipe' });
        const argv = uvx.argv().argv;
        assert.deepStrictEqual(argv.slice(0, 4), ['--python', '3.13', '--exclude-newer', CUTOFF], `${name}: ${argv.join(' ')}`);
    }
});

test('M24 uvx launchers: a UV_EXCLUDE_NEWER the user set wins over the cut-off, and a malformed cut-off is dropped', POSIX, () =>
{
    const { dir } = project('cutoff-own');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    const own = stubUvx('cutoff-own');
    const res = require('node:child_process').spawnSync(process.execPath, [SERENA, ...entryArgs('alfred-navigation')], { cwd: dir, env: { ...BARE, PATH: own.PATH, HOME: dir, UV_EXCLUDE_NEWER: 'false' }, encoding: 'utf8' });
    assert.ok(!own.argv().argv.includes('--exclude-newer'), own.argv().argv.join(' '));
    assert.match(res.stderr, /UV_EXCLUDE_NEWER=false is set - it replaces the release cut-off/);
    const bad = stubUvx('cutoff-bad');
    const res2 = require('node:child_process').spawnSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--exclude-newer', 'yesterday', '--', 'start-mcp-server'], { cwd: dir, env: { ...BARE, PATH: bad.PATH, HOME: dir }, encoding: 'utf8' });
    assert.deepStrictEqual(bad.argv().argv.slice(0, 3), ['--python', '3.13', '--from'], 'a malformed cut-off never reaches uv');
    assert.match(res2.stderr, /--exclude-newer yesterday is not a date/);
});

// A plugin server never sees a PROJECT settings env key, so a UV_EXCLUDE_NEWER the user put in the project's settings
// (the copy route honours it there too) is read by the launcher and handed to uvx in its own environment.
test('M24 uvx launchers: a UV_EXCLUDE_NEWER only a settings file names reaches uv, in place of the cut-off', POSIX, () =>
{
    const db = path.join(TMP, 'cutoff-file-db', 'memory.db');
    const cases = [['alfred-navigation', SERENA, { settings: { UV_EXCLUDE_NEWER: 'false' } }, 'false'],
        ['alfred-memory', LAUNCH, { settings: { ALFRED_CODE_MEMORY_DB: db }, local: { UV_EXCLUDE_NEWER: '2026-01-15' } }, '2026-01-15'],
        ['macos-control', DESKTOP, { account: { UV_EXCLUDE_NEWER: 'false' } }, 'false']];
    for (const [name, launcher, files, want] of cases)
    {
        const { dir, acct } = project(`cutoff-file-${name}`, files);
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        const uvx = stubUvx(`cutoff-file-${name}`);
        const res = require('node:child_process').spawnSync(process.execPath, [launcher, ...entryArgs(name)],
            { cwd: dir, env: { ...BARE, PATH: uvx.PATH, HOME: dir, CLAUDE_CONFIG_DIR: acct, ALFRED_CODE_PLATFORM: 'darwin' }, encoding: 'utf8' });
        const seen = uvx.argv();
        assert.ok(!seen.argv.includes('--exclude-newer'), `${name}: ${seen.argv.join(' ')}`);
        assert.strictEqual(seen.exclude, want, `${name}: uv reads the user's value from its own environment`);
        assert.match(res.stderr, new RegExp(`UV_EXCLUDE_NEWER=${want} is set - it replaces the release cut-off`), name);
    }
});

// M41: Windows-MCP matches tool names case-sensitively and skips an unknown one silently, so an override of
// `powershell` excludes nothing; and WINDOWS_MCP_TOOLS (its --tools) OVERRIDES --exclude-tools, so a stray one in
// the environment lifts the whole gate (windows-mcp 0.8.5 __main__.py _apply_tool_filter, the --tools envvar).
test('M41 desktop-launch: an override is checked against the pinned tool names - case mended, an unknown name said and dropped', POSIX, () =>
{
    const mended = desktopRun('desktop-win-case', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'powershell,Registry,NoSuchTool' } });
    assert.strictEqual(mended.status, 0, mended.stderr);
    assert.deepStrictEqual(mended.argv.slice(-2), ['--exclude-tools', 'PowerShell,Registry']);
    assert.match(mended.stderr, /NoSuchTool is no Windows-MCP tool/);
    const junk = desktopRun('desktop-win-junk', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'nothing-real' } });
    assert.deepStrictEqual(junk.argv.slice(-2), ['--exclude-tools', 'PowerShell,Registry,Process,FileSystem'], 'an override naming no real tool keeps the safe default, never an open gate');
});

test('M41 desktop-launch: a WINDOWS_MCP_TOOLS in the environment never reaches Windows-MCP, where it would override the gate', POSIX, () =>
{
    const got = desktopRun('desktop-win-tools', WIN_ARGS, { env: { ALFRED_CODE_PLATFORM: 'win32', WINDOWS_MCP_TOOLS: 'PowerShell,FileSystem' } });
    assert.strictEqual(got.status, 0, got.stderr);
    const rec = JSON.parse(fs.readFileSync(path.join(TMP, 'desktop-win-tools-argv.json'), 'utf8'));
    assert.strictEqual(rec.tools, null, 'the child must not inherit WINDOWS_MCP_TOOLS');
    assert.match(got.stderr, /WINDOWS_MCP_TOOLS .*dropped/);
});

test('desktop gate: each server runs on its own OS only, and an unknown platform override is ignored', () =>
{
    const { offeredOn, platformOf, DESKTOP_OS } = require(DESKTOP);
    assert.deepStrictEqual(DESKTOP_OS, { 'windows-control': 'win32', 'macos-control': 'darwin' });
    assert.strictEqual(offeredOn('windows-control', 'win32'), true);
    assert.strictEqual(offeredOn('windows-control', 'darwin'), false);
    assert.strictEqual(offeredOn('macos-control', 'darwin'), true);
    assert.strictEqual(offeredOn('macos-control', 'linux'), false);
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

// M2: the launcher takes the same idle check as the installer's inline move - a second session's serena still
// serving from .serena keeps it where it is this start.
test('M2 serena-launch: a recorded move waits while another serena holds the folder', POSIX, () =>
{
    const { spawn } = require('node:child_process');
    const { dir } = project('serena-held');
    put(path.join(dir, '.serena', 'project.yml'), 'project_name: x\n');
    stamp(dir, ['data-pending: serena .serena -> .alfred/serena']);
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', 'serena-agent'], { stdio: 'ignore' });
    try
    {
        put(path.join(dir, '.serena', 'home', 'logs', '2026-09-29', `mcp_20260929-111111_${live.pid}.txt`), 'live');
        const rec = stubRecorder('serena-held', 'uvx');
        const r = require('node:child_process').spawnSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'],
            { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
        assert.strictEqual(rec.got().home, '.serena/home', r.stderr);
        assert.match(r.stderr, new RegExp(`not moved \\(serena pid ${live.pid}\\)`));
        assert.ok(fs.existsSync(path.join(dir, '.serena', 'project.yml')) && !fs.existsSync(path.join(dir, '.alfred', 'serena')));
    }
    finally { live.kill(); }
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
    // I11: --no-webmcp - a page the browser opens never adds tools of its own to the session.
    assert.deepStrictEqual(rec.got().argv, ['-y', '@playwright/mcp@0.0.82', '--browser', 'firefox',
        '--user-data-dir', path.join(real, '.alfred', 'firefox-control'), '--output-dir', path.join(real, '.alfred', 'firefox-control', 'output'), '--no-webmcp']);
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
    stamp(dir, ['data-pending: chrome-control .playwright/chrome -> .alfred/chrome-control']);
    fs.symlinkSync('host-1', path.join(dir, '.playwright', 'chrome', 'SingletonLock'));
    assert.strictEqual(run('browser-move-2').dataDir, path.join(real, '.playwright', 'chrome'), 'a running browser holds it: not this start');
    fs.unlinkSync(path.join(dir, '.playwright', 'chrome', 'SingletonLock'));
    const moved = run('browser-move-3');
    assert.strictEqual(moved.dataDir, path.join(real, '.alfred', 'chrome-control'));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', 'chrome-control', 'Default', 'Cookies'), 'utf8'), 'session', 'the login moved with the profile');
    assert.strictEqual(moved.argv[moved.argv.length - 1], '--isolated-no', 'arguments after -- reach the server unchanged');
});

// 2026-10-13: no shared browser folder. A profile 2.1.0-2.3.x kept at .alfred/browser/<engine> serves where it is until
// its line is recorded, then moves to .alfred/<engine>-control at start; the emptied .alfred/browser goes with the last
// engine. A pending line a 2.3.x install wrote (browser-<engine>, to .alfred/browser/<engine>) is read as today's move.
test('browser-launch: a profile in the shared .alfred/browser folder serves, then moves to .alfred/<engine>-control; a 2.3.x pending line still moves', POSIX, () =>
{
    const { dir } = project('browser-shared');
    put(path.join(dir, '.alfred', 'browser', 'chrome', 'Default', 'Cookies'), 'shared');
    put(path.join(dir, '.playwright', 'firefox', 'prefs.js'), 'old');
    const real = fs.realpathSync(dir);
    const run = (name, engine) =>
    {
        const rec = stubRecorder(name, 'npx');
        execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.82', '--browser', engine],
            { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, stdio: 'pipe' });
        const argv = rec.got().argv;
        return argv[argv.indexOf('--user-data-dir') + 1];
    };
    assert.strictEqual(run('browser-shared-1', 'chrome'), path.join(real, '.alfred', 'browser', 'chrome'), 'no line yet: the profile serves where it is');
    stamp(dir, ['data-pending: chrome-control .alfred/browser/chrome -> .alfred/chrome-control',
        'data-pending: browser-firefox .playwright/firefox -> .alfred/browser/firefox']);
    assert.strictEqual(run('browser-shared-2', 'chrome'), path.join(real, '.alfred', 'chrome-control'));
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', 'chrome-control', 'Default', 'Cookies'), 'utf8'), 'shared');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', 'browser')), 'the emptied shared folder is gone');
    assert.strictEqual(run('browser-shared-3', 'firefox'), path.join(real, '.alfred', 'firefox-control'), 'the 2.3.x line moves to the engine\'s own folder');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', 'firefox-control', 'prefs.js'), 'utf8'), 'old');
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
    // M5: the old place is linked back, as the home folder is - Cursor, still on .memory-mcp, reads the same file
    // instead of creating a second, empty database there (and the next update a clash forever).
    assert.ok(fs.lstatSync(path.join(dir, '.memory-mcp')).isSymbolicLink(), 'M5: the old project place is a link');
    assert.strictEqual(fs.realpathSync(path.join(dir, '.memory-mcp', 'memory.db')), fs.realpathSync(path.join(dir, '.alfred', '.alfred-memory', 'memory.db')));
    assert.strictEqual(fs.readlinkSync(path.join(dir, '.memory-mcp')), path.join('.alfred', '.alfred-memory'), 'a relative link, so a moved checkout keeps it');
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
    put(path.join(dir, '.alfred', 'chrome-control', 'Default', 'Cookies'), 'session');   // what Playwright writes next
    assert.ok(fs.existsSync(path.join(dir, '.alfred', '.gitignore')), 'the launcher wrote the root\'s .gitignore');
    assert.ok(ignored(dir, '.alfred/chrome-control/Default/Cookies'), 'the session cookies are ignored');
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

// Re-verify 3 S3: every launcher took the project from CLAUDE_PROJECT_DIR or its cwd - both the directory the session was
// started in, or an inherited folder - so a session started in a package folder opened the account-wide memory database,
// handed Playwright a profile outside every .gitignore and started serena on a home that is not there. Each now asks
// memory.js projectRootOf: the folder holding the install record above the launch directory.
test('S3 launchers: started in a subdirectory, or under another folder\'s CLAUDE_PROJECT_DIR, each serves its project', POSIX, () =>
{
    const home = path.join(TMP, 's3-home');
    fs.mkdirSync(home, { recursive: true });
    const { dir, acct } = project('s3-root', { settings: { ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: 'PowerShell' } });
    const real = fs.realpathSync(dir);
    const projectDb = path.join(real, '.alfred', '.alfred-memory', 'memory.db');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: projectDb } }));
    fs.mkdirSync(path.join(dir, '.git'));
    stamp(dir, ['scope: user']);
    const sub = path.join(dir, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const elsewhere = path.join(TMP, 's3-elsewhere');
    fs.mkdirSync(path.join(elsewhere, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(elsewhere, 'other.db') } }));
    for (const inherited of [{}, { CLAUDE_PROJECT_DIR: sub }, { CLAUDE_PROJECT_DIR: elsewhere }])
    {
        const env = (rec) => ({ ...BARE, PATH: rec.PATH, HOME: home, CLAUDE_CONFIG_DIR: acct, ...inherited });
        const said = JSON.stringify(inherited);
        const mem = stubRecorder('s3-mem', 'uvx');
        execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd: sub, env: env(mem), stdio: 'pipe' });
        assert.deepStrictEqual([mem.got().db, mem.got().cwd], [projectDb, real], `memory ${said}`);
        const br = stubRecorder('s3-browser', 'npx');
        execFileSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.83', '--browser', 'chrome'], { cwd: sub, env: env(br), stdio: 'pipe' });
        const argv = br.got().argv;
        assert.deepStrictEqual([argv[argv.indexOf('--user-data-dir') + 1], br.got().cwd], [path.join(real, '.alfred', 'chrome-control'), real], `browser ${said}`);
        const se = stubRecorder('s3-serena', 'uvx');
        execFileSync(process.execPath, [SERENA, '--package', 'serena-agent@1.7.0', '--', 'start-mcp-server', '--project-from-cwd'], { cwd: sub, env: env(se), stdio: 'pipe' });
        // serena's home stays relative (Windows cmd.exe cuts an absolute one at a space), so serena starts AT the project.
        assert.deepStrictEqual([se.got().home, se.got().cwd], ['.alfred/serena/home', real], `navigation ${said}`);
        const dk = stubUvx('s3-desktop');
        execFileSync(process.execPath, [DESKTOP, ...WIN_ARGS], { cwd: sub, env: { ...env(dk), ALFRED_CODE_PLATFORM: 'win32' }, stdio: 'pipe' });
        assert.deepStrictEqual(dk.argv().argv.slice(-2), ['--exclude-tools', 'PowerShell'], `desktop ${said}: the project's own override`);
    }
    assert.strictEqual(fs.existsSync(path.join(sub, '.alfred')), false, 'nothing is created under the launch directory');
});

// ------------------------------------------------------------------ mobile-control (appium-mcp), 2026-10-13
const MOBILE = path.join(ROOT, 'stack/mcp/mobile-launch.js');
const mobile = require('../stack/mcp/mobile-launch.js');
const MOBILE_KEYS = ['ANDROID_HOME', 'JAVA_HOME', 'NO_UI', 'ALLOW_REMOTE_APP_URLS', 'REMOTE_SERVER_URL_ALLOW_REGEX', 'SCREENSHOTS_DIR', 'PAGE_SOURCES_DIR', 'npm_config_before', 'NPM_CONFIG_BEFORE'];
function envRecorder(name)
{
    const dir = path.join(TMP, `${name}-rec-bin`);
    fs.mkdirSync(dir, { recursive: true });
    const record = path.join(TMP, `${name}-rec.json`);
    fs.writeFileSync(path.join(dir, 'npx'), `#!/usr/bin/env node\nconst keys = ${JSON.stringify(MOBILE_KEYS)};\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null])) }));\n`, { mode: 0o755 });
    return { PATH: dir + path.delimiter + process.env.PATH, got: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}

test('mobile-launch: npx gets the pinned package, the safe defaults, and output dirs under the data root', POSIX, () =>
{
    const { dir } = project('mobile-run');
    const rec = envRecorder('mobile-run');
    const r = spawnSync(process.execPath, [MOBILE, '--package', 'appium-mcp@1.97.1'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const real = fs.realpathSync(dir);
    const got = rec.got();
    assert.deepStrictEqual(got.argv, ['-y', 'appium-mcp@1.97.1']);
    assert.strictEqual(fs.realpathSync(got.cwd), real, 'the server starts at the project');
    assert.deepStrictEqual([got.env.NO_UI, got.env.ALLOW_REMOTE_APP_URLS, got.env.REMOTE_SERVER_URL_ALLOW_REGEX], ['true', 'false', mobile.LOCAL_ONLY]);
    assert.strictEqual(got.env.SCREENSHOTS_DIR, path.join(real, '.alfred', 'mobile-control', 'screenshots'));
    assert.strictEqual(got.env.PAGE_SOURCES_DIR, path.join(real, '.alfred', 'mobile-control', 'page-sources'));
    assert.ok(fs.existsSync(path.join(dir, '.alfred', '.gitignore')), 'the root ignores what lands under it before the server writes');
    assert.match(r.stderr, /no Android SDK found - Android needs ANDROID_HOME/, 'an empty HOME holds no SDK, and the line says so');
    assert.strictEqual(got.env.npm_config_before, null, 'an entry with no --before (an older one) sets no cut-off');
});

// Audit 2026-10-14 PL4: appium-mcp pins only itself and its 17 dependencies are caret ranges, so the entry hands the
// launcher its pin's own day and npx gets it as npm_config_before (honoured for the whole tree - measured on npm 11.6.1).
// A npm_config_before the user set wins: the shell's in any case, then a settings file's; an empty one means none.
test('PL4 mobile-launch: --before reaches npx as npm_config_before, never as an argument; the user\'s own value wins', POSIX, () =>
{
    const DAY = '2026-10-13T23:59:59Z';
    const run = (name, { env = {}, local } = {}) =>
    {
        const { dir } = project(name, local ? { local } : {});
        const rec = envRecorder(name);
        const r = spawnSync(process.execPath, [MOBILE, '--package', 'appium-mcp@1.97.1', '--before', DAY], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, ...env }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, r.stderr);
        return { got: rec.got(), err: r.stderr };
    };
    const plain = run('mobile-before');
    assert.deepStrictEqual(plain.got.argv, ['-y', 'appium-mcp@1.97.1'], 'the launcher flag is not handed to the server');
    assert.strictEqual(plain.got.env.npm_config_before, DAY);
    assert.match(plain.err, /appium-mcp@1\.97\.1, dependencies published by 2026-10-13T23:59:59Z/);
    const shell = run('mobile-before-shell', { env: { NPM_CONFIG_BEFORE: '2026-10-20' } });
    assert.strictEqual(shell.got.env.NPM_CONFIG_BEFORE, '2026-10-20', 'the shell\'s own, in any case');
    assert.strictEqual(shell.got.env.npm_config_before, null, 'no second spelling beside the user\'s');
    assert.match(shell.err, /NPM_CONFIG_BEFORE=2026-10-20 is set - npx takes it in place of the release's cut-off \(2026-10-13T23:59:59Z\)/);
    const empty = run('mobile-before-empty', { env: { npm_config_before: '' } });
    assert.strictEqual(empty.got.env.npm_config_before, '', 'an empty one (no cut-off) is kept');
    const local = run('mobile-before-local', { local: { npm_config_before: '2026-11-01' } });
    assert.strictEqual(local.got.env.npm_config_before, '2026-11-01', 'a settings file\'s value, which a plugin server never gets on its own');
    assert.deepStrictEqual(mobile.npmBefore({ env: {}, projectDir: project('mobile-before-none').dir, before: '' }), { value: null, own: '', registered: '' }, 'no day, nothing set');
});

test('mobile-launch: the user\'s own values win - the shell, then a settings file; a boolean appium-mcp would refuse keeps the default', POSIX, () =>
{
    const { dir } = project('mobile-own', { local: { ALLOW_REMOTE_APP_URLS: 'true', REMOTE_SERVER_URL_ALLOW_REGEX: '^https://hub\\.example\\.com/', ANDROID_HOME: '/from/settings/sdk' } });
    const rec = envRecorder('mobile-own');
    const r = spawnSync(process.execPath, [MOBILE, '--package', 'appium-mcp@1.97.1', '--', '--extra'], { cwd: dir, encoding: 'utf8',
        env: { ...BARE, PATH: rec.PATH, HOME: dir, NO_UI: 'yes', SCREENSHOTS_DIR: '/tmp/my-shots', JAVA_HOME: '/from/shell/jdk' } });
    assert.strictEqual(r.status, 0, r.stderr);
    const got = rec.got();
    assert.deepStrictEqual(got.argv, ['-y', 'appium-mcp@1.97.1', '--extra'], 'arguments after -- reach the server');
    assert.strictEqual(got.env.ALLOW_REMOTE_APP_URLS, 'true');
    assert.strictEqual(got.env.REMOTE_SERVER_URL_ALLOW_REGEX, '^https://hub\\.example\\.com/');
    assert.strictEqual(got.env.ANDROID_HOME, '/from/settings/sdk', 'a settings file\'s value is taken as set, never looked up');
    assert.strictEqual(got.env.JAVA_HOME, '/from/shell/jdk');
    assert.strictEqual(got.env.SCREENSHOTS_DIR, '/tmp/my-shots');
    assert.strictEqual(got.env.NO_UI, 'true', 'yes is no boolean appium-mcp starts on');
    assert.match(r.stderr, /NO_UI=yes is not true or false/);
    assert.doesNotMatch(r.stderr, /ANDROID_HOME unset|JAVA_HOME unset/);
});

test('mobile-launch: an unset SDK path is looked up - ANDROID_SDK_ROOT, then Android Studio\'s place; the JDK by java_home, then the bundled JBR', () =>
{
    const home = '/h';
    const dirs = (...p) => (q) => p.includes(q);
    const none = () => false;
    const sdk = (over) => mobile.androidHome({ env: {}, platform: 'darwin', home, isDir: none, ...over });
    assert.deepStrictEqual(sdk({ env: { ANDROID_HOME: '/a' } }), { value: '/a', from: 'set' });
    assert.deepStrictEqual(sdk({ env: { ANDROID_SDK_ROOT: '/r' } }), { value: '/r', from: 'ANDROID_SDK_ROOT' });
    assert.deepStrictEqual(sdk({ isDir: dirs('/h/Library/Android/sdk') }), { value: '/h/Library/Android/sdk', from: 'default' });
    assert.deepStrictEqual(sdk({ platform: 'linux', isDir: dirs('/h/Android/Sdk') }), { value: '/h/Android/Sdk', from: 'default' });
    assert.deepStrictEqual(sdk({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, isDir: dirs('C:\\Users\\u\\AppData\\Local\\Android\\Sdk') }),
        { value: 'C:\\Users\\u\\AppData\\Local\\Android\\Sdk', from: 'default' });
    assert.deepStrictEqual(sdk({}), { value: '', from: null }, 'nothing found');
    const jdk = (over) => mobile.javaHome({ env: {}, platform: 'darwin', home, isDir: none, tool: () => '', ...over });
    assert.deepStrictEqual(jdk({ env: { JAVA_HOME: '/j' } }), { value: '/j', from: 'set' });
    assert.deepStrictEqual(jdk({ tool: () => '/Library/Java/jdk', isDir: dirs('/Library/Java/jdk') }), { value: '/Library/Java/jdk', from: 'java_home' });
    const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
    assert.deepStrictEqual(jdk({ isDir: dirs(jbr) }), { value: jbr, from: 'studio' });
    assert.deepStrictEqual(jdk({ platform: 'linux', tool: () => assert.fail('java_home is macOS only'), isDir: dirs('/opt/android-studio/jbr') }), { value: '/opt/android-studio/jbr', from: 'studio' });
    assert.deepStrictEqual(jdk({}), { value: '', from: null });
});

test('mobile-launch: an older Node is refused in one line, and an entry with no --package says so', () =>
{
    assert.strictEqual(mobile.main(['--package', 'appium-mcp@1.97.1'], { node: '20.11.1' }), 1);
    assert.strictEqual(mobile.main([], { node: '22.0.0' }), 2);
    const r = spawnSync(process.execPath, [MOBILE], { env: BARE, encoding: 'utf8' });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /--package <spec> is required/);
});

test('mobile-launch: the copy route registers the same values, its dirs relative to the project root, and no SDK path', () =>
{
    const { dir } = project('mobile-copy', { settings: { ALLOW_REMOTE_APP_URLS: 'true' } });
    const got = mobile.copyRouteEnv({ env: {}, projectDir: dir, root: '.data', before: '2026-10-13T23:59:59Z' });
    assert.deepStrictEqual(got, { MOBILE_BEFORE: '2026-10-13T23:59:59Z', MOBILE_NO_UI: 'true', MOBILE_REMOTE_APPS: 'true', MOBILE_REMOTE_ALLOW: mobile.LOCAL_ONLY,
        MOBILE_SCREENSHOTS: '.data/mobile-control/screenshots', MOBILE_PAGE_SOURCES: '.data/mobile-control/page-sources' });
    assert.strictEqual(mobile.copyRouteEnv({ env: { npm_config_before: '2026-12-01' }, projectDir: dir, root: '.data', before: '2026-10-13T23:59:59Z' }).MOBILE_BEFORE, '2026-12-01', 'PL4: the user\'s own cut-off is registered');
    assert.strictEqual(mobile.copyRouteEnv({ env: {}, projectDir: dir, root: '.data' }).MOBILE_BEFORE, '', 'no day recorded: an empty value, which npm reads as none');
    assert.ok(!Object.keys(got).some((k) => /ANDROID|JAVA/.test(k)), 'a committed .mcp.json never carries one machine\'s SDK path');
});

test('mobile-launch: the prerequisites say Node, the SDK paths found or missing, and iOS by OS', () =>
{
    const notes = (over) => mobile.prereqNotes({ env: {}, platform: 'darwin', home: '/h', node: '24.1.0', isDir: () => false, tool: () => '', ...over }).join('\n');
    const bare = notes({});
    assert.doesNotMatch(bare, /needs Node 22/);
    assert.match(bare, /ANDROID_HOME: not found\) and a JDK \(JAVA_HOME: not found\) \(the launcher looks each up only when it is unset\)/);
    assert.match(bare, /!! mobile: set ANDROID_HOME and JAVA_HOME .*settings\.local\.json `env` \(machine-local\)/);
    assert.match(bare, /iOS needs Xcode/);
    const set = notes({ env: { ANDROID_HOME: '/a', JAVA_HOME: '/j' }, platform: 'linux', route: 'copy' });
    assert.match(set, /ANDROID_HOME: \/a\) and a JDK \(JAVA_HOME: \/j\), adb/);
    assert.doesNotMatch(set, /!! mobile: set ANDROID_HOME/);
    assert.match(set, /iOS needs macOS with Xcode; on this machine it drives Android only/);
    assert.match(notes({ node: '20.11.1' }), /!! mobile: mobile-control needs Node 22 or newer .* this machine runs 20\.11\.1/);
});

// ------------------------------------------------------------------ the project's sensitive data (2026-10-13)
// The browser launcher hands Playwright MCP the store as a FILE (--secrets: it types a value by its KEY and masks it in
// each response), mobile-control takes only the keys appium-mcp documents, and no uvx server gets any (audit
// 2026-10-14 PL2, the user's ruling of 2026-10-14). No value ever reaches a server's environment it would not read.
function keyRecorder(name, bin, keys)
{
    const dir = path.join(TMP, `${name}-keys-bin`);
    fs.mkdirSync(dir, { recursive: true });
    const record = path.join(TMP, `${name}-keys.json`);
    fs.writeFileSync(path.join(dir, bin), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), env: Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k] ?? null])) }));\n`, { mode: 0o755 });
    return { PATH: dir + path.delimiter + process.env.PATH, got: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}
const STORE_TEXT = 'API_TOKEN="tok-abcdef123456"\nDB_HOST=db.internal\nALLOW_REMOTE_APP_URLS=true\nAI_VISION_API_KEY=vis-0987654321\n';
const STORE_KEYS = ['API_TOKEN', 'DB_HOST', 'ALLOW_REMOTE_APP_URLS', 'AI_VISION_API_KEY'];
const NO_KEYS = { API_TOKEN: null, DB_HOST: null, ALLOW_REMOTE_APP_URLS: null, AI_VISION_API_KEY: null };

test('PL2 sensitive data: the browser gets --secrets <the store, absolute> and none of its values in its environment', POSIX, () =>
{
    const { dir } = project('sensitive-browser');
    put(path.join(dir, '.alfred', '.sensitive-data'), STORE_TEXT);
    const rec = keyRecorder('sensitive-browser', 'npx', STORE_KEYS);
    const r = spawnSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.83', '--browser', 'chrome', '--', '--headless'],
        { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const got = rec.got();
    const real = fs.realpathSync(dir);
    const at = got.argv.indexOf('--secrets');
    assert.ok(at > 0, `no --secrets in ${got.argv.join(' ')}`);
    assert.strictEqual(got.argv[at + 1], path.join(real, '.alfred', '.sensitive-data'), 'the store, absolute');
    assert.ok(path.isAbsolute(got.argv[at + 1]));
    assert.strictEqual(got.argv[got.argv.length - 1], '--headless', 'the entry\'s own arguments still come last');
    assert.deepStrictEqual(got.env, NO_KEYS, 'no store value reaches the browser\'s environment');
    assert.match(r.stderr, /sensitive data .*\.sensitive-data \(typed by KEY name, masked in responses\)/);
    assert.ok(!r.stderr.includes('tok-abcdef123456'), `a value was printed:\n${r.stderr}`);
});

test('PL2 sensitive data: a store under a custom data root, or in the main worktree, is the one handed over', POSIX, () =>
{
    const { dir } = project('sensitive-browser-root', { settings: { ALFRED_CODE_DATA_PATH: 'var/data' } });
    put(path.join(dir, 'var', 'data', '.sensitive-data'), STORE_TEXT);
    put(path.join(dir, '.alfred', '.sensitive-data'), 'WRONG=1\n');
    const rec = keyRecorder('sensitive-browser-root', 'npx', STORE_KEYS);
    const r = spawnSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.83', '--browser', 'chrome'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const argv = rec.got().argv;
    assert.strictEqual(argv[argv.indexOf('--secrets') + 1], path.join(fs.realpathSync(dir), 'var', 'data', '.sensitive-data'));
});

test('PL2 sensitive data: no store, or a UTF-16 one Playwright cannot read, passes no --secrets; the UTF-16 one is named', POSIX, () =>
{
    for (const [name, text] of [['none', null], ['utf16', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('API_TOKEN=x\n', 'utf16le')])]])
    {
        const { dir } = project(`sensitive-browser-${name}`);
        if (text !== null) { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', '.sensitive-data'), text); }
        const rec = keyRecorder(`sensitive-browser-${name}`, 'npx', STORE_KEYS);
        const r = spawnSync(process.execPath, [BROWSER, '--package', '@playwright/mcp@0.0.83', '--browser', 'chrome'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, `${name}: ${r.stderr}`);
        assert.ok(!rec.got().argv.includes('--secrets'), name);
        assert.deepStrictEqual(rec.got().env, NO_KEYS, name);
        if (name === 'utf16') assert.match(r.stderr, /is UTF-16 - Playwright MCP reads it as UTF-8; save it as UTF-8/);
        else assert.doesNotMatch(r.stderr, /sensitive data/);
    }
});

test('PL2 sensitive data: serena, the memory service and the desktop servers (runUvx) get no store key at all', POSIX, () =>
{
    const launches = [
        ['serena', SERENA, ['--package', 'serena-agent@1.7.0'], {}],
        ['memory', LAUNCH, ['--package', 'mcp-memory-service[sqlite]==11.14.0'], { ALFRED_CODE_MEMORY_DB: path.join(TMP, 'sensitive-uvx-db', 'memory.db') }],
        ['macos', DESKTOP, MAC_ARGS, { ALFRED_CODE_PLATFORM: 'darwin' }],
    ];
    for (const [name, script, args, extra] of launches)
    {
        const { dir } = project(`sensitive-uvx-${name}`);
        put(path.join(dir, '.alfred', '.sensitive-data'), STORE_TEXT);
        const rec = keyRecorder(`sensitive-uvx-${name}`, 'uvx', STORE_KEYS);
        const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, DB_HOST: 'from-the-shell', ...extra }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, `${name}: ${r.stderr}`);
        assert.deepStrictEqual(rec.got().env, { ...NO_KEYS, DB_HOST: 'from-the-shell' }, `${name}: only the shell's own value`);
        assert.doesNotMatch(r.stderr, /sensitive data/, name);
    }
});

test('PL2 sensitive data: mobile-control takes only the keys appium-mcp documents; the shell still wins', POSIX, () =>
{
    const { dir } = project('sensitive-mobile');
    put(path.join(dir, '.alfred', '.sensitive-data'), STORE_TEXT);
    const rec = keyRecorder('sensitive-mobile', 'npx', STORE_KEYS);
    const r = spawnSync(process.execPath, [MOBILE, '--package', 'appium-mcp@1.97.1'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir, AI_VISION_API_KEY: 'from-the-shell' }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(rec.got().env, { API_TOKEN: null, DB_HOST: null, ALLOW_REMOTE_APP_URLS: 'true', AI_VISION_API_KEY: 'from-the-shell' });
    assert.match(r.stderr, /: 1 value\(s\) from the project's sensitive data in the environment \(the keys appium-mcp documents\)/);
    assert.ok(!r.stderr.includes('vis-0987654321') && !r.stderr.includes('tok-abcdef123456'), r.stderr);
    assert.ok(!rec.got().argv.includes('--secrets'), 'appium-mcp has no secrets flag');
});

test('sensitive data: no store, an empty one or a malformed one starts every server as before and says nothing', POSIX, () =>
{
    for (const [name, text] of [['none', null], ['empty', ''], ['garbage', '{"not": "dotenv"}\n\u0000\n']])
    {
        const { dir } = project(`sensitive-quiet-${name}`);
        if (text !== null) put(path.join(dir, '.alfred', '.sensitive-data'), text);
        const rec = keyRecorder(`sensitive-quiet-${name}`, 'npx', STORE_KEYS);
        const r = spawnSync(process.execPath, [MOBILE, '--package', 'appium-mcp@1.97.1'], { cwd: dir, env: { ...BARE, PATH: rec.PATH, HOME: dir }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, `${name}: ${r.stderr}`);
        assert.deepStrictEqual(rec.got().env, { ...NO_KEYS, ALLOW_REMOTE_APP_URLS: 'false' }, `${name}: the launcher's own safe default only`);
        assert.doesNotMatch(r.stderr, /sensitive data/, name);
    }
});
