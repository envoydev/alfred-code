#!/usr/bin/env node
'use strict';
// THE DESKTOP SERVERS' LAUNCHER - windows-desktop (Windows-MCP) and macos-desktop (MacOS-MCP).
//
//   node desktop-launch.js --server <windows-desktop|macos-desktop> --package <spec> [--exclude-newer <cut-off>] -- <server arguments>
//
// Three things a fixed plugin argv cannot do:
//   - THE PYTHON. uvx takes the newest interpreter it can find, and windows-mcp 0.8.6 already needs
//     3.14; every uvx-launched stack server runs on the one answer uv-python.js gives.
//   - THE OS. Each server drives THIS machine's own desktop, and an entry enabled at project scope
//     reaches every machine that opens the project. On the other OS it exits at once with one line
//     naming why, instead of downloading a package that cannot import there.
//   - THE TOOL GATE (windows-desktop). The entry passes `--exclude-tools PowerShell,Registry,Process,FileSystem`:
//     shell, registry, process control and file writes, moves and deletes stay off. Windows-MCP gates by
//     tool NAME, never by mode, so `App` stays on whole - launch, switch and resize, and its
//     `launch_executable` mode, which starts any program with the arguments given (windows-mcp 0.8.5
//     tools/app.py): a house guard denies that mode unless the user allowed it in
//     <docs-path>/flow/DESKTOP-EXEC-ALLOW. ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE replaces the list, and
//     `none` passes no flag at all (Windows-MCP's own config then decides) - read from the shell, then
//     settings.local.json, settings.json and the account settings, since a plugin server never gets a
//     PROJECT settings env key. MacOS-MCP 0.4.6 has no exclude flag; its own config.toml `[tools] exclude` removes
//     a tool (`serve --config`, else ~/.macos-mcp/config.toml), which the stack does not write: its Shell tool stays in the list, and
//     the same guard denies every Shell call unless DESKTOP-EXEC-ALLOW allows it.
//
// Everything after `--` goes to the server unchanged. stdout is the MCP stream: nothing is written to
// it here, diagnostics go to stderr, which Claude Code shows in the server's log.
//
// The installer and the walk read the table below too (stack/mcp is the one home of which OS each
// server drives), so an install never offers a server this launcher would refuse.
const path = require('node:path');
const { pythonRequest, runUvx, settingFrom } = require('./uv-python.js');

const DESKTOP = {
    'windows-desktop': { os: 'win32', bin: 'windows-mcp', upstream: 'Windows-MCP' },
    'macos-desktop': { os: 'darwin', bin: 'macos-mcp', upstream: 'MacOS-MCP' },
};
const DESKTOP_OS = Object.fromEntries(Object.entries(DESKTOP).map(([name, row]) => [name, row.os]));
const DEFAULT_EXCLUDE = 'PowerShell,Registry,Process,FileSystem';
// Windows-MCP's tools at the pin (windows-mcp 0.8.5, each tools/*.py `@mcp.tool(name=...)`; meta/mcp-tools.json
// records the same list and a test holds the two equal). It matches an --exclude-tools name CASE-SENSITIVELY
// and skips an unknown one silently, so an override is checked against this list before it is passed on.
const WINDOWS_TOOLS = Object.freeze(['App', 'Click', 'Clipboard', 'DisplayInventory', 'FileSystem', 'Move', 'MultiEdit', 'MultiSelect',
    'Notification', 'PowerShell', 'Process', 'Registry', 'Scrape', 'Screenshot', 'Scroll', 'Shortcut', 'Snapshot', 'Type', 'Wait', 'WaitFor']);
// Both upstreams send PostHog usage events unless ANONYMIZED_TELEMETRY is 'false' (their lifespan reads it,
// default 'true' - windows-mcp 0.8.5 and macos-mcp 0.4.6). The plugin entries pass this env, and the copy
// route registers the same pair: a server driving the user's own desktop reports to nobody.
const DESKTOP_ENV = Object.freeze({ ANONYMIZED_TELEMETRY: 'false' });
const OS_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const osLabel = (platform) => OS_LABEL[platform] || platform;
// The stack's marketplace key (scripts/install/brand.js BRAND.marketplace) - the launcher reads no module
// outside stack/mcp.
const STACK_MARKET = 'envoydev';

// The marketplace key the launcher runs under: its plugin-cache folder, <config>/plugins/cache/<key>/
// <plugin>/<version>/stack/mcp, else the stack's own key.
function marketOf(dir = __dirname)
{
    const parts = path.resolve(dir).split(path.sep);
    const at = parts.lastIndexOf('cache');
    return at > 0 && parts[at - 1] === 'plugins' && parts[at + 1] ? parts[at + 1] : STACK_MARKET;
}

// A desktop row another machine enabled at PROJECT scope starts on this one too. /plugin would switch
// it off in the committed settings.json - for the teammate on the right OS as well, at their next pull -
// so the way off is the local-scope disable, this machine only (settings.local.json wins over it).
const offHere = (name, market) => `keep it off on this machine only: claude plugin disable ${name}@${market} --scope local`;

// The OS every gate reads. ALFRED_CODE_PLATFORM stands in for it where a run must be judged as another
// OS's (the tests, a dry run); only a platform the gate knows is taken, anything else is this machine.
function platformOf(env = process.env)
{
    const forced = String((env && env.ALFRED_CODE_PLATFORM) || '').trim();
    return Object.hasOwn(OS_LABEL, forced) ? forced : process.platform;
}

// A server that is no desktop server runs anywhere.
const offeredOn = (name, platform) => !Object.hasOwn(DESKTOP, name) || DESKTOP[name].os === platform;

// The override as the user wrote it: '' (none given), 'none', or a csv.
const excludeSetting = ({ env, projectDir }) => settingFrom({ env, projectDir, suffix: 'WINDOWS_DESKTOP_EXCLUDE' });

// The override checked against the pinned names: a name in another case is mended ('powershell' would
// exclude nothing), an unknown one is said and dropped, and a list naming no real tool keeps the safe
// default - never an open gate the user did not ask for (`none` is how they ask).
function checkedExclude(override, { log = () => {} } = {})
{
    if (!override || /^none$/i.test(override)) return override;
    const byLower = new Map(WINDOWS_TOOLS.map((t) => [t.toLowerCase(), t]));
    const kept = [];
    for (const name of String(override).split(',').map((t) => t.trim()).filter(Boolean))
    {
        const real = byLower.get(name.toLowerCase());
        if (!real) { log(`ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: ${name} is no Windows-MCP tool (${WINDOWS_TOOLS.join(', ')}) - dropped`); continue; }
        if (real !== name) log(`ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: ${name} read as ${real} - Windows-MCP matches tool names case-sensitively`);
        if (!kept.includes(real)) kept.push(real);
    }
    if (kept.length) return kept.join(',');
    log(`ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE names no Windows-MCP tool - the default gate stays (${DEFAULT_EXCLUDE}); none lifts it`);
    return DEFAULT_EXCLUDE;
}

// The entry's own `--exclude-tools <list>` pair, replaced by the override or dropped on `none`.
function withExclude(args, override)
{
    if (!override) return [...args];
    const at = args.indexOf('--exclude-tools');
    const rest = at < 0 ? [...args] : [...args.slice(0, at), ...args.slice(at + 2)];
    return /^none$/i.test(override) ? rest : [...rest, '--exclude-tools', override];
}

// The copy route registers no launcher: the same list reaches Windows-MCP as its own
// WINDOWS_MCP_EXCLUDE_TOOLS, resolved at install time - empty for `none`, which Windows-MCP reads as unset.
function copyRouteExclude({ env, projectDir, log = () => {} })
{
    const override = checkedExclude(excludeSetting({ env, projectDir }), { log });
    if (!override) return DEFAULT_EXCLUDE;
    return /^none$/i.test(override) ? '' : override;
}

// The installer's two kinds of line, worded once here beside the table they describe.
// A server this machine cannot run, left out of a run - whatever put it in (a walk's seed, an --add, a
// read-back of a row another machine enabled).
function skipNote(name, platform, market = STACK_MARKET)
{
    const drives = `it drives ${osLabel(DESKTOP[name].os)} apps and this machine runs ${osLabel(platform)}`;
    const own = Object.keys(DESKTOP).find((n) => DESKTOP[n].os === platform);
    return `desktop: ${name} left out - ${drives}${own ? `; the ${osLabel(platform)} one is ${own} (--add 'mcp ${own}')` : ', where no desktop server runs'}; where the project enables it, ${offHere(name, market)}`;
}

// 'A, B and C' from a csv of tool names.
const spoken = (csv) => csv.split(',').join(', ').replace(/, (?=[^,]*$)/, ' and ');

// windows-desktop's gate as it stands: the list in effect (copyRouteExclude's answer - the default, the
// user's checked list, or '' when `none` lifted it), never the default four when an override replaced them.
function gateNote(exclude)
{
    if (exclude === DEFAULT_EXCLUDE) return `${spoken(DEFAULT_EXCLUDE)} stay off (ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: another list, or none for every tool)`;
    const dflt = `the default keeps ${spoken(DEFAULT_EXCLUDE)} off`;
    if (!exclude) return `every tool is on (ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE is none; ${dflt})`;
    return `${spoken(exclude)} ${exclude.includes(',') ? 'stay' : 'stays'} off (ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE's list; ${dflt})`;
}

// What a server needs before its first start, said on the run that brings it in. `exclude` is
// windows-desktop's gate in effect (copyRouteExclude), the default when not given.
function prereqNotes(name, { uvx = true, exclude = DEFAULT_EXCLUDE } = {})
{
    const first = `its first start downloads Python and ${DESKTOP[name].upstream}, and a timeout then clears with a reconnect from /mcp`;
    const lines = name === 'windows-desktop'
        ? ["  desktop: windows-desktop needs the Windows display language set to English (Windows-MCP's App tool reads app names in English), and Claude Code at the same privilege level as the app it drives - a UAC prompt can never be automated",
            `  desktop: windows-desktop - ${gateNote(exclude)}; ${first}`]
        // I45: MacOS-MCP 0.4.6 checks its grants before it serves and exits when one is missing
        // (permissions.py validate_permissions) - an empty snapshot needs MACOS_MCP_SKIP_PERMISSION_CHECK=1 first.
        : ["  !! desktop: macos-desktop needs Accessibility and Screen Recording (System Settings > Privacy & Security) for the terminal or IDE running Claude Code and for the uv-managed Python it runs on - approve the 'would like to control this computer' dialog at its first start; a server that fails to connect at start while System Settings opens is missing a grant - its log names which; a black vision snapshot means Screen Recording is missing",
            `  desktop: macos-desktop - its Shell tool stays in the list, and a house guard denies every Shell call unless DESKTOP-EXEC-ALLOW allows it (MacOS-MCP has no exclude flag; its own config.toml removes it - exclude = ['Shell'] under [tools] in ~/.macos-mcp/config.toml); ${first}`];
    if (!uvx) lines.unshift(`  !! desktop: ${name} starts through uvx, which is not on PATH - install uv (https://docs.astral.sh/uv/)`);
    return lines;
}

const valueOf = (argv, flag) =>
{
    const at = argv.indexOf(flag);
    return at >= 0 && argv[at + 1] && argv[at + 1] !== '--' ? argv[at + 1] : '';
};

function main(argv, env = process.env)
{
    const server = valueOf(argv, '--server');
    const spec = valueOf(argv, '--package');
    const row = DESKTOP[server];
    // Both are passed by the generated plugin entry, so a missing one means a hand-edited entry.
    if (!row || !spec)
    {
        process.stderr.write(`desktop-launch: --server ${Object.keys(DESKTOP).join('|')} and --package <spec> are required (the plugin entry passes both)\n`);
        return 2;
    }
    const platform = platformOf(env);
    if (platform !== row.os)
    {
        process.stderr.write(`desktop-launch: ${server} drives ${osLabel(row.os)} apps and this machine runs ${osLabel(platform)} - not started - ${offHere(server, marketOf())}\n`);
        return 1;
    }
    const projectDir = env.CLAUDE_PROJECT_DIR || process.cwd();
    const rest = argv.indexOf('--');
    let args = rest < 0 ? [] : argv.slice(rest + 1);
    const log = (line) => process.stderr.write(`desktop-launch: ${line}\n`);
    let childEnv = env;
    if (server === 'windows-desktop')
    {
        args = withExclude(args, checkedExclude(excludeSetting({ env, projectDir }), { log }));
        // Windows-MCP's --tools (WINDOWS_MCP_TOOLS) OVERRIDES --exclude-tools: one inherited from the shell
        // would lift the whole gate, so it never reaches the child.
        if (Object.hasOwn(env, 'WINDOWS_MCP_TOOLS'))
        {
            childEnv = { ...env };
            delete childEnv.WINDOWS_MCP_TOOLS;
            log('WINDOWS_MCP_TOOLS in the environment dropped - it would override the tool gate; ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE is the setting');
        }
    }
    process.stderr.write(`desktop-launch: ${spec}, python ${pythonRequest({ env, projectDir })}, ${row.bin} ${args.join(' ')}\n`);
    runUvx(['--from', spec, row.bin, ...args], { env: childEnv, projectDir, label: 'desktop-launch', excludeNewer: valueOf(argv.slice(0, rest < 0 ? argv.length : rest), '--exclude-newer') });
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, DESKTOP, DESKTOP_OS, DEFAULT_EXCLUDE, WINDOWS_TOOLS, checkedExclude, DESKTOP_ENV, platformOf, offeredOn, osLabel, withExclude, copyRouteExclude, skipNote, prereqNotes, marketOf };
