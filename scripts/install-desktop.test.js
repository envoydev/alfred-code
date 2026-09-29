'use strict';
// THE DESKTOP SERVERS, END TO END. windows-desktop (Windows-MCP) and macos-desktop (MacOS-MCP) each drive
// the machine's OWN apps, so the seed installs each on its own OS only and neither on Linux, whatever put
// it in the run - a walk's wpf / winforms seed, an --add, a read-back. A server left out is named in one
// line; one this run brings in prints its prerequisites once. The OS is forced with ALFRED_CODE_PLATFORM,
// so every case runs on any host.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mcp = require('./install/mcp.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const row = (id, extra = {}) => ({ id, version: '2.0.0', scope: 'project', enabled: true, ...extra });
const INSTALLED = (...more) => JSON.stringify([...['alfred-code', 'navigation', 'documentation', 'memory'].map((n) => row(`${n}@envoydev`)), ...more]);
const prepare = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
};
const installs = (calls, name) => calls.filter((c) => c.startsWith(`plugin install ${name}@`));
const WPF = 'skill markdown-style\nrule wpf-conventions\nmcp windows-desktop\n';

test('desktopGate: each desktop server stays on its own OS, and a left-out one is named with the reason', () =>
{
    const mcps = ['navigation|x', 'windows-desktop|y', 'macos-desktop|z'];
    const on = (platform) => mcp.desktopGate({ mcps, platform });
    assert.deepStrictEqual(on('win32').kept, ['navigation|x', 'windows-desktop|y']);
    assert.deepStrictEqual(on('darwin').kept, ['navigation|x', 'macos-desktop|z']);
    assert.deepStrictEqual(on('linux').kept, ['navigation|x']);
    assert.deepStrictEqual(on('darwin').lines, ["desktop: windows-desktop left out - it drives Windows apps and this machine runs macOS; the macOS one is macos-desktop (--add 'mcp macos-desktop'); where the project enables it, keep it off on this machine only: claude plugin disable windows-desktop@envoydev --scope local"]);
    assert.deepStrictEqual(on('win32').lines, ["desktop: macos-desktop left out - it drives macOS apps and this machine runs Windows; the Windows one is windows-desktop (--add 'mcp windows-desktop'); where the project enables it, keep it off on this machine only: claude plugin disable macos-desktop@envoydev --scope local"]);
    assert.deepStrictEqual(on('linux').lines, [
        'desktop: windows-desktop left out - it drives Windows apps and this machine runs Linux, where no desktop server runs; where the project enables it, keep it off on this machine only: claude plugin disable windows-desktop@envoydev --scope local',
        'desktop: macos-desktop left out - it drives macOS apps and this machine runs Linux, where no desktop server runs; where the project enables it, keep it off on this machine only: claude plugin disable macos-desktop@envoydev --scope local',
    ]);
});

// I4 (final review of the rename): a row another machine enabled at project scope still starts here, and
// /plugin would switch it off in the committed settings.json - for the teammate on the right OS too. The
// skip line names the local-scope disable instead, under the marketplace key this install runs from.
test('desktopGate: the skip line names the local-scope disable under this install\'s marketplace key (I4)', () =>
{
    const [line] = mcp.desktopGate({ mcps: ['windows-desktop'], platform: 'darwin', market: 'acme-key' }).lines;
    assert.match(line, /keep it off on this machine only: claude plugin disable windows-desktop@acme-key --scope local$/);
    assert.doesNotMatch(line, /\/plugin/);
});

test('seed install: a wpf selection on Windows installs windows-desktop and says its prerequisites once', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', WPF, { env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.deepStrictEqual(installs(calls, 'windows-desktop'), ['plugin install windows-desktop@envoydev --scope project -y'], calls.join('\n'));
    assert.deepStrictEqual(installs(calls, 'macos-desktop'), []);
    assert.match(out, /windows-desktop needs the Windows display language set to English/);
    assert.match(out, /same privilege level as the app it drives - a UAC prompt can never be automated/);
    assert.match(out, /PowerShell, Registry, Process and FileSystem stay off \(ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE/);
    assert.ok(!/left out/.test(out), out);
});

test('seed install: the same wpf selection on macOS installs no desktop server, and one line says why', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', WPF, { env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(calls.filter((c) => /desktop/.test(c) && !c.startsWith('mcp remove')), [], calls.join('\n'));
    const said = out.split('\n').filter((l) => /left out/.test(l));
    assert.deepStrictEqual(said, ["==> desktop: windows-desktop left out - it drives Windows apps and this machine runs macOS; the macOS one is macos-desktop (--add 'mcp macos-desktop'); where the project enables it, keep it off on this machine only: claude plugin disable windows-desktop@envoydev --scope local"]);
    assert.ok(!/English|Accessibility/.test(out), 'no prerequisite is said for a server the run left out');
});

test('seed update --add mcp macos-desktop on macOS installs it and prints the permissions it needs', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', 'mcp macos-desktop'], prepare, env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(installs(calls, 'macos-desktop'), ['plugin install macos-desktop@envoydev --scope project -y'], calls.join('\n'));
    assert.match(out, /!! desktop: macos-desktop needs Accessibility and Screen Recording/);
    // I45: macos-mcp 0.4.6 checks its grants before it serves and exits when one is missing
    // (permissions.py validate_permissions) - the empty snapshot needs MACOS_MCP_SKIP_PERMISSION_CHECK=1 first.
    assert.match(out, /a server that fails to connect at start while System Settings opens is missing a grant - its log names which; black screenshots mean Screen Recording is missing/);
    assert.doesNotMatch(out, /an empty snapshot means Accessibility is missing/);
});

test('seed update --add of either desktop server on Linux installs nothing and says why', POSIX_ONLY, () =>
{
    for (const name of ['macos-desktop', 'windows-desktop'])
    {
        const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', `mcp ${name}`], prepare, env: { ALFRED_CODE_PLATFORM: 'linux' } });
        assert.deepStrictEqual(installs(calls, name), [], calls.join('\n'));
        assert.match(out, new RegExp(`desktop: ${name} left out - it drives (Windows|macOS) apps and this machine runs Linux, where no desktop server runs`));
        assert.ok(!/names nothing this release ships/.test(out), 'a shipped server is not an unknown name');
    }
});

test('seed update over an install that carries windows-desktop keeps it, and says the prerequisites no second time', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(row('windows-desktop@envoydev')), args: ['--installed-only'], prepare, env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.ok(calls.includes('plugin update windows-desktop@envoydev --scope project -y'), calls.join('\n'));
    assert.ok(!calls.some((c) => /^plugin (uninstall|disable) windows-desktop@/.test(c)), calls.join('\n'));
    assert.ok(!/English/.test(out), 'the prerequisites were said again on an update that brought nothing in');
});

test('seed update on macOS over a project a Windows machine enabled windows-desktop in: left as it is, and said', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(row('windows-desktop@envoydev')), args: ['--installed-only'], prepare, env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(calls.filter((c) => /^plugin \S+ windows-desktop@/.test(c)), [], `a row the other OS enabled was touched:\n${calls.join('\n')}`);
    assert.match(out, /desktop: windows-desktop left out - it drives Windows apps and this machine runs macOS/);
});

// The skill that teaches the desktop servers arrives with either one (the graph's server -> skill edge),
// and never without one: an --add the OS gate refuses brings no skill either.
test('the desktop skill arrives with its server, and never with a server this OS refuses', POSIX_ONLY, () =>
{
    const has = (repo) => fs.existsSync(path.join(repo, '.claude', 'skills', 'desktop-automation', 'SKILL.md'));
    const add = (platform) => seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', 'mcp macos-desktop'], prepare, env: { ALFRED_CODE_PLATFORM: platform }, inspect: has });
    const mac = add('darwin');
    assert.strictEqual(mac.result, true, `macOS --add brought no skill:\n${mac.out}`);
    const linux = add('linux');
    assert.strictEqual(linux.result, false, `Linux copied the skill of a server it left out:\n${linux.out}`);
    assert.strictEqual((linux.out.match(/desktop: macos-desktop left out/g) || []).length, 1, 'the skip is said once');
    // setup hands the installer the walk's selection as stack-select emits it - already closed.
    const { computeClosure, emitSelectionFile } = require('./stack-select.js');
    const emitted = emitSelectionFile(computeClosure(require('../meta/stack-graph.json'), { skills: ['markdown-style'], rules: ['wpf-conventions'], mcps: ['windows-desktop'] }));
    assert.ok(emitted.split('\n').includes('skill desktop-automation'), emitted);
    const win = seedRun('install', emitted, { env: { ALFRED_CODE_PLATFORM: 'win32' }, inspect: has });
    assert.strictEqual(win.result, true, 'a wpf selection on Windows copies the skill with its server');
});
