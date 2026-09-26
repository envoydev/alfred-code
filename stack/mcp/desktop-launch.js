#!/usr/bin/env node
'use strict';
// THE DESKTOP SERVERS' LAUNCHER - windows-desktop (Windows-MCP) and macos-desktop (MacOS-MCP).
//
//   node desktop-launch.js --server <windows-desktop|macos-desktop> --package <spec> -- <server arguments>
//
// Three things a fixed plugin argv cannot do:
//   - THE PYTHON. uvx takes the newest interpreter it can find, and windows-mcp 0.8.6 already needs
//     3.14; every uvx-launched stack server runs on the one answer uv-python.js gives.
//   - THE OS. Each server drives THIS machine's own desktop, and an entry enabled at project scope
//     reaches every machine that opens the project. On the other OS it exits at once with one line
//     naming why, instead of downloading a package that cannot import there.
//   - THE TOOL GATE (windows-desktop). The entry passes `--exclude-tools PowerShell,Registry,Process`:
//     shell, registry and process control stay off. ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE replaces that
//     list, and `none` passes no flag at all (Windows-MCP's own config then decides) - read from the
//     shell, then settings.local.json, settings.json and the account settings, since a plugin server
//     never gets a PROJECT settings env key. MacOS-MCP 0.4.6 has no such flag: its Shell tool stays
//     on, and the desktop-automation skill carries that rule.
//
// Everything after `--` goes to the server unchanged. stdout is the MCP stream: nothing is written to
// it here, diagnostics go to stderr, which Claude Code shows in the server's log.
//
// The installer and the walk read the table below too (stack/mcp is the one home of which OS each
// server drives), so an install never offers a server this launcher would refuse.
const { pythonRequest, runUvx, settingFrom } = require('./uv-python.js');

const DESKTOP = {
    'windows-desktop': { os: 'win32', bin: 'windows-mcp', upstream: 'Windows-MCP' },
    'macos-desktop': { os: 'darwin', bin: 'macos-mcp', upstream: 'MacOS-MCP' },
};
const DESKTOP_OS = Object.fromEntries(Object.entries(DESKTOP).map(([name, row]) => [name, row.os]));
const DEFAULT_EXCLUDE = 'PowerShell,Registry,Process';
const OS_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const osLabel = (platform) => OS_LABEL[platform] || platform;

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
function copyRouteExclude({ env, projectDir })
{
    const override = excludeSetting({ env, projectDir });
    if (!override) return DEFAULT_EXCLUDE;
    return /^none$/i.test(override) ? '' : override;
}

// The installer's two kinds of line, worded once here beside the table they describe.
// A server this machine cannot run, left out of a run - whatever put it in (a walk's seed, an --add, a
// read-back of a row another machine enabled).
function skipNote(name, platform)
{
    const drives = `it drives ${osLabel(DESKTOP[name].os)} apps and this machine runs ${osLabel(platform)}`;
    const own = Object.keys(DESKTOP).find((n) => DESKTOP[n].os === platform);
    return `desktop: ${name} left out - ${drives}${own ? `; the ${osLabel(platform)} one is ${own} (--add 'mcp ${own}')` : ', where no desktop server runs'}`;
}

// What a server needs before its first start, said on the run that brings it in.
function prereqNotes(name, { uvx = true } = {})
{
    const first = `its first start downloads Python and ${DESKTOP[name].upstream}, and a timeout then clears with a reconnect from /mcp`;
    const lines = name === 'windows-desktop'
        ? ["  desktop: windows-desktop needs the Windows display language set to English (Windows-MCP's App tool reads app names in English), and Claude Code at the same privilege level as the app it drives - a UAC prompt can never be automated",
            `  desktop: windows-desktop - ${DEFAULT_EXCLUDE.split(',').join(', ').replace(/, (?=[^,]*$)/, ' and ')} stay off (ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: another list, or none for every tool); ${first}`]
        : ["  !! desktop: macos-desktop needs Accessibility and Screen Recording (System Settings > Privacy & Security) for the terminal or IDE running Claude Code and for the uv-managed Python it runs on - approve the 'would like to control this computer' dialog at its first start; an empty snapshot means Accessibility is missing, black screenshots mean Screen Recording is",
            `  desktop: macos-desktop - its Shell tool stays on (MacOS-MCP has no flag for it; exclude = ['Shell'] under [tools] in ~/.macos-mcp/config.toml turns it off); ${first}`];
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
        process.stderr.write(`desktop-launch: ${server} drives ${osLabel(row.os)} apps and this machine runs ${osLabel(platform)} - not started; switch it off here with /plugin\n`);
        return 1;
    }
    const projectDir = env.CLAUDE_PROJECT_DIR || process.cwd();
    const rest = argv.indexOf('--');
    let args = rest < 0 ? [] : argv.slice(rest + 1);
    if (server === 'windows-desktop') args = withExclude(args, excludeSetting({ env, projectDir }));
    process.stderr.write(`desktop-launch: ${spec}, python ${pythonRequest({ env, projectDir })}, ${row.bin} ${args.join(' ')}\n`);
    runUvx(['--from', spec, row.bin, ...args], { env, projectDir, label: 'desktop-launch' });
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, DESKTOP, DESKTOP_OS, DEFAULT_EXCLUDE, platformOf, offeredOn, osLabel, withExclude, copyRouteExclude, skipNote, prereqNotes };
