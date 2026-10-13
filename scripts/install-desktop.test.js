'use strict';
// THE DESKTOP SERVERS, END TO END. windows-control (Windows-MCP) and macos-control (MacOS-MCP) each drive
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
const INSTALLED = (...more) => JSON.stringify([...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@envoydev`)), ...more]);
const prepare = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
};
const installs = (calls, name) => calls.filter((c) => c.startsWith(`plugin install ${name}@`));
const WPF = 'skill markdown-style\nrule wpf-conventions\nmcp windows-control\n';

test('desktopGate: each desktop server stays on its own OS, and a left-out one is named with the reason', () =>
{
    const mcps = ['alfred-navigation|x', 'windows-control|y', 'macos-control|z'];
    const on = (platform) => mcp.desktopGate({ mcps, platform });
    assert.deepStrictEqual(on('win32').kept, ['alfred-navigation|x', 'windows-control|y']);
    assert.deepStrictEqual(on('darwin').kept, ['alfred-navigation|x', 'macos-control|z']);
    assert.deepStrictEqual(on('linux').kept, ['alfred-navigation|x']);
    assert.deepStrictEqual(on('darwin').lines, ["desktop: windows-control left out - it drives Windows apps and this machine runs macOS; the macOS one is macos-control (--add 'mcp macos-control'); where the project enables it, keep it off on this machine only: claude plugin disable windows-control@envoydev --scope local"]);
    assert.deepStrictEqual(on('win32').lines, ["desktop: macos-control left out - it drives macOS apps and this machine runs Windows; the Windows one is windows-control (--add 'mcp windows-control'); where the project enables it, keep it off on this machine only: claude plugin disable macos-control@envoydev --scope local"]);
    assert.deepStrictEqual(on('linux').lines, [
        'desktop: windows-control left out - it drives Windows apps and this machine runs Linux, where no desktop server runs; where the project enables it, keep it off on this machine only: claude plugin disable windows-control@envoydev --scope local',
        'desktop: macos-control left out - it drives macOS apps and this machine runs Linux, where no desktop server runs; where the project enables it, keep it off on this machine only: claude plugin disable macos-control@envoydev --scope local',
    ]);
});

// I4 (final review of the rename): a row another machine enabled at project scope still starts here, and
// /plugin would switch it off in the committed settings.json - for the teammate on the right OS too. The
// skip line names the local-scope disable instead, under the marketplace key this install runs from.
test('desktopGate: the skip line names the local-scope disable under this install\'s marketplace key (I4)', () =>
{
    const [line] = mcp.desktopGate({ mcps: ['windows-control'], platform: 'darwin', market: 'acme-key' }).lines;
    assert.match(line, /keep it off on this machine only: claude plugin disable windows-control@acme-key --scope local$/);
    assert.doesNotMatch(line, /\/plugin/);
});

test('seed install: a wpf selection on Windows installs windows-control and says its prerequisites once', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', WPF, { env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.deepStrictEqual(installs(calls, 'windows-control'), ['plugin install windows-control@envoydev --scope project -y'], calls.join('\n'));
    assert.deepStrictEqual(installs(calls, 'macos-control'), []);
    assert.match(out, /windows-control needs the Windows display language set to English/);
    assert.match(out, /same privilege level as the app it drives - a UAC prompt can never be automated/);
    assert.match(out, /PowerShell, Registry, Process and FileSystem stay off \(ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE/);
    // SD08 (audit 2026-10-11): the screenshot knob is named at install and never given a value by the stack.
    assert.match(out, /windows-control sends screenshots at full display size - WINDOWS_MCP_SCREENSHOT_SCALE \(0\.1 to 1\.0, Windows-MCP's own, unset by the stack\)/);
    assert.ok(!calls.some((c) => /SCREENSHOT_SCALE/.test(c)), calls.join("\n"));
    assert.ok(!/left out/.test(out), out);
});

// The prerequisite line names the tools the gate ACTUALLY keeps off: an ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE that
// replaced the list, or `none` that lifted it, was reported as the default four (review 2.1.5 plugin, MINOR 2).
test('seed install: the windows-control prerequisite line names the gate in effect - an override\'s list, or none', POSIX_ONLY, () =>
{
    const gateLine = (value) => seedRun('install', WPF, { env: { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: value } })
        .out.split('\n').find((l) => /desktop: windows-control - /.test(l)) || '';
    const one = gateLine('powershell');
    assert.match(one, /windows-control - PowerShell stays off \(ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE's list; the default keeps PowerShell, Registry, Process and FileSystem off\)/, one);
    const two = gateLine('PowerShell,Registry');
    assert.match(two, /windows-control - PowerShell and Registry stay off \(ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE's list;/, two);
    const none = gateLine('none');
    assert.match(none, /windows-control - every tool is on \(ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE is none; the default keeps PowerShell, Registry, Process and FileSystem off\)/, none);
    const { prereqNotes } = require('../stack/mcp/desktop-launch.js');
    assert.match(prereqNotes('windows-control').join('\n'), /PowerShell, Registry, Process and FileSystem stay off \(ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE: another list, or none for every tool\)/, 'no list given: the default');
});

test('seed install: the same wpf selection on macOS installs no desktop server, and one line says why', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', WPF, { env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(calls.filter((c) => /desktop/.test(c) && !c.startsWith('mcp remove')), [], calls.join('\n'));
    const said = out.split('\n').filter((l) => /left out/.test(l));
    assert.deepStrictEqual(said, ["==> desktop: windows-control left out - it drives Windows apps and this machine runs macOS; the macOS one is macos-control (--add 'mcp macos-control'); where the project enables it, keep it off on this machine only: claude plugin disable windows-control@envoydev --scope local"]);
    assert.ok(!/English|Accessibility/.test(out), 'no prerequisite is said for a server the run left out');
});

test('seed update --add mcp macos-control on macOS installs it and prints the permissions it needs', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', 'mcp macos-control'], prepare, env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(installs(calls, 'macos-control'), ['plugin install macos-control@envoydev --scope project -y'], calls.join('\n'));
    assert.match(out, /!! desktop: macos-control needs Accessibility and Screen Recording/);
    // I45: macos-mcp 0.4.6 checks its grants before it serves and exits when one is missing
    // (permissions.py validate_permissions) - the empty snapshot needs MACOS_MCP_SKIP_PERMISSION_CHECK=1 first.
    assert.match(out, /a server that fails to connect at start while System Settings opens is missing a grant - its log names which; a black vision snapshot means Screen Recording is missing/);
    assert.doesNotMatch(out, /an empty snapshot means Accessibility is missing/);
});

test('seed update --add of either desktop server on Linux installs nothing and says why', POSIX_ONLY, () =>
{
    for (const name of ['macos-control', 'windows-control'])
    {
        const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', `mcp ${name}`], prepare, env: { ALFRED_CODE_PLATFORM: 'linux' } });
        assert.deepStrictEqual(installs(calls, name), [], calls.join('\n'));
        assert.match(out, new RegExp(`desktop: ${name} left out - it drives (Windows|macOS) apps and this machine runs Linux, where no desktop server runs`));
        assert.ok(!/names nothing this release ships/.test(out), 'a shipped server is not an unknown name');
    }
});

test('seed update over an install that carries windows-control keeps it, and says the prerequisites no second time', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(row('windows-control@envoydev')), args: ['--installed-only'], prepare, env: { ALFRED_CODE_PLATFORM: 'win32' } });
    assert.ok(calls.includes('plugin update windows-control@envoydev --scope project -y'), calls.join('\n'));
    assert.ok(!calls.some((c) => /^plugin (uninstall|disable) windows-control@/.test(c)), calls.join('\n'));
    assert.ok(!/English/.test(out), 'the prerequisites were said again on an update that brought nothing in');
    assert.ok(!/SCREENSHOT_SCALE/.test(out), 'the screenshot knob was said again on an update that brought nothing in');
});

test('seed update on macOS over a project a Windows machine enabled windows-control in: left as it is, and said', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(row('windows-control@envoydev')), args: ['--installed-only'], prepare, env: { ALFRED_CODE_PLATFORM: 'darwin' } });
    assert.deepStrictEqual(calls.filter((c) => /^plugin \S+ windows-control@/.test(c)), [], `a row the other OS enabled was touched:\n${calls.join('\n')}`);
    assert.match(out, /desktop: windows-control left out - it drives Windows apps and this machine runs macOS/);
});

// The skill that teaches the desktop servers arrives with either one (the graph's server -> skill edge),
// and never without one: an --add the OS gate refuses brings no skill either.
test('the desktop skill arrives with its server, and never with a server this OS refuses', POSIX_ONLY, () =>
{
    const has = (repo) => fs.existsSync(path.join(repo, '.claude', 'skills', 'desktop-automation', 'SKILL.md'));
    const add = (platform) => seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', 'mcp macos-control'], prepare, env: { ALFRED_CODE_PLATFORM: platform }, inspect: has });
    const mac = add('darwin');
    assert.strictEqual(mac.result, true, `macOS --add brought no skill:\n${mac.out}`);
    const linux = add('linux');
    assert.strictEqual(linux.result, false, `Linux copied the skill of a server it left out:\n${linux.out}`);
    assert.strictEqual((linux.out.match(/desktop: macos-control left out/g) || []).length, 1, 'the skip is said once');
    // setup hands the installer the walk's selection as stack-select emits it - already closed.
    const { computeClosure, emitSelectionFile } = require('./stack-select.js');
    const emitted = emitSelectionFile(computeClosure(require('../meta/stack-graph.json'), { skills: ['markdown-style'], rules: ['wpf-conventions'], mcps: ['windows-control'] }));
    assert.ok(emitted.split('\n').includes('skill desktop-automation'), emitted);
    const win = seedRun('install', emitted, { env: { ALFRED_CODE_PLATFORM: 'win32' }, inspect: has });
    assert.strictEqual(win.result, true, 'a wpf selection on Windows copies the skill with its server');
});

// 2026-10-13: windows-desktop is windows-control. An update over a copy-route install that registered the old name
// replaces the registration under the new one and says the prerequisites no more than an update of the same name
// would - the old registration is read under today's name before the run removes it. Plugin route: a parked old row
// arrives parked (install-plugins.test.js covers migrateRenamed itself).
test('seed update over a copy-route windows-desktop registration: windows-control replaces it, the prerequisites stay unsaid', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_PLATFORM: 'win32', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const read = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers;
    const { outs, steps } = seedRun(['install', 'update'], WPF, {
        env: COPY, account: true, args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            const servers = read(repo);
            if (i === 0)
            {
                // What the older install left: the same registration, and its ledger row, under the server's old name.
                const doc = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
                doc.mcpServers = Object.fromEntries(Object.entries(doc.mcpServers).map(([n, e]) => [n === 'windows-control' ? 'windows-desktop' : n, e]));
                fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify(doc, null, 2)}\n`);
                const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
                fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/^(managed-mcp:.*)\bwindows-control=/m, '$1windows-desktop='));
            }
            return Object.keys(i === 0 ? read(repo) : servers);
        },
    });
    assert.match(outs[0], /windows-control needs the Windows display language set to English/, 'the install says them');
    assert.ok(steps[0].includes('windows-desktop') && !steps[0].includes('windows-control'), steps[0].join(','));
    assert.ok(steps[1].includes('windows-control') && !steps[1].includes('windows-desktop'), steps[1].join(','));
    assert.doesNotMatch(outs[1], /needs the Windows display language/, 'the rename brings no server in');
});
