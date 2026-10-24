#!/usr/bin/env node
'use strict';
// WHAT /alfred-code:init DOES IN THIS PROJECT - stated by a script, so the command never infers it.
//
//   node scripts/init-plan.js --installed <plan-out.json> --root <project> [--plugin-root <dir>]
//
// `--installed` is `update --installed-only --print-plan --plan-out`'s read-back. Two blocks:
//
//   machine: <what> - present | missing: <command> | refresh: <command> | blocked: <why> | skip: <why>
//     What the kept plugins need before they can start, probed on this machine, in install order: csharp-ls when
//     csharp-lsp is kept, typescript-language-server (with the TypeScript 6 it needs beside it) when typescript-lsp is
//     kept - the stack ships no MCP server since 2.10.1, so no uv, Python, browser, index or model is fetched.
//     Last, claude-hud's status line + compact layout (hud-statusline.js, the account dir CLAUDE_CONFIG_DIR,
//     else ~/.claude; the line in the project's settings.local.json when claude-hud is installed for
//     this project alone): `skip` when claude-hud is absent or switched off, or
//     the statusLine is the user's own with nothing else to add; `refresh` when claude-hud's own line
//     has a stale shape. Its command ends in `# adds <n> claude-hud keys: <names>`, a shell comment.
//     The command is the exact one to run; init puts every missing one through ONE ask.
//
//   capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>
//     The three captures in their fixed order, each only when the install lists its skill AND its seat
//     (capture-awareness has none). init READS the SKILL.md and follows it inline: these skills are
//     manual-only, so a Skill call is denied. An existing output is done - re-capturing is the user's
//     call, later. The library copy in .claude/skills wins over the plugin's.
//
//   unattended: <question> -> <choice>
//     Only with ALFRED_CODE_UNATTENDED=1: the answer to each ask init itself owns, after the plan -
//     the recommended option unless it is destructive or needs a person (references/init-bootstrap.md, 'Unattended').
//     `--mode` alone prints `unattended: on|off` and nothing else, for init's first call.
//
// Exit 0 with the plan, 2 on an unreadable --installed file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const REPO = path.join(__dirname, '..');
const { resolveDocsRoot } = require(path.join(REPO, 'scripts', 'install', 'copy.js'));
const { planHud, resolveConfigDir } = require(path.join(REPO, 'scripts', 'hud-statusline.js'));

const HUD_ITEM = 'claude-hud status line + compact layout';

const CAPTURES = [
    { skill: 'capture-architecture', seat: 'architecture-analyzer', output: (docs) => `${docs}/architecture/ARCHITECTURE.md` },
    { skill: 'capture-project-code-style', seat: 'code-style-analyzer', output: (docs) => `${docs}/preferences/PROJECT-CODE-PREFERENCES.md` },
    // The inventory, the run book and the sibling repos in one run (the user's ruling of 2026-10-16), no seat of its own -
    // its related-projects part dispatches the opt-in seat only where it is installed. LAST, so the inventory reflects
    // every capture above; each part decides from disk whether it has work, so it always runs when installed.
    { skill: 'capture-awareness', seat: null, output: null },
];

const probes = {
    // On Windows a tool counts only when it resolves to a file Node can start (R105): `where` also
    // lists npm's extensionless sh shim, which no Windows spawn runs.
    has: (bin, env = process.env) => rt.which(bin, { env }),
    file: (p) => fs.existsSync(p),
};

function plan({ inv, root, platform = process.platform, env = process.env, probe = probes, pluginRoot = '' })
{
    const machine = [];
    const add = (what, state, detail = '') => machine.push({ what, state, detail });
    const win = platform === 'win32';
    const home = env.HOME || env.USERPROFILE || os.homedir();

    if ((inv.plugins || []).some((p) => (p && p.name) === 'csharp-lsp'))
    {
        const tool = path.join(home, '.dotnet', 'tools', win ? 'csharp-ls.exe' : 'csharp-ls');
        if (probe.has('csharp-ls', env) || (probe.file || fs.existsSync)(tool)) add('csharp-ls', 'present');
        else if (probe.has('dotnet', env)) add('csharp-ls', 'missing', 'dotnet tool install --global csharp-ls');
        else add('csharp-ls', 'blocked', 'needs the .NET 10 SDK (dotnet) first - https://dot.net, then dotnet tool install --global csharp-ls');
    }

    // typescript-lsp's server, which the plugin names but never installs. npm comes with the node the stack already
    // needs, so it is never blocked. `typescript@6`: TypeScript 7 ships no tsserver.js, and typescript-language-server
    // reads one from the workspace or from the TypeScript installed beside it (stack-select.js SCOPED_PREREQS).
    if ((inv.plugins || []).some((p) => (p && p.name) === 'typescript-lsp'))
        add('typescript-language-server', probe.has('typescript-language-server', env) ? 'present' : 'missing', 'npm install -g typescript-language-server typescript@6');

    // claude-hud arrives configured: its statusLine (the account's, or this project's settings.local.json for a
    // claude-hud installed for this project alone) plus the plugin-settings row, one command.
    // The runtime is planHud's default - the node the command itself finds on this PATH.
    const configDir = resolveConfigDir({ env });
    const hud = planHud({ configDir, project: root, platform, env });
    const hudCommand = `node "${path.join(REPO, 'scripts', 'hud-statusline.js')}" --config-dir "${configDir}" --project "${root}"`;
    add(HUD_ITEM, hud.item.state, ['missing', 'refresh'].includes(hud.item.state)
        ? (hud.item.note ? `${hudCommand} # ${hud.item.note}` : hudCommand)
        : hud.item.detail);

    const skills = new Set(inv.skills || []);
    const agents = new Set(inv.agents || []);
    const off = new Set(inv.left_out || []);
    const docs = resolveDocsRoot(root).replace(/[\\/]+$/, '');
    const rel = (p) => shownPath(root, p);
    const captures = CAPTURES.map(({ skill, seat, output }) =>
    {
        if (!skills.has(skill) || off.has(`skill ${skill}`)) return { skill, state: 'skip', detail: 'the skill is not installed' };
        if (seat && off.has(`agent ${seat}`)) return { skill, state: 'skip', detail: `its seat ${seat} is switched off` };
        if (seat && !agents.has(seat)) return { skill, state: 'skip', detail: `its seat ${seat} is not installed` };
        const out = output && output(docs);
        if (out && fs.existsSync(path.join(root, out))) return { skill, state: 'done', detail: `${out} exists` };
        const file = [path.join(root, '.claude', 'skills', skill, 'SKILL.md'),
            ...(pluginRoot ? [path.join(pluginRoot, 'stack', 'skills', skill, 'SKILL.md')] : []),
            path.join(REPO, 'stack', 'skills', skill, 'SKILL.md')].find((f) => fs.existsSync(f));
        return file ? { skill, state: 'run', detail: `read ${rel(file)}` } : { skill, state: 'skip', detail: 'its SKILL.md is in neither the project nor the plugin' };
    });
    return { machine, captures };
}

function render({ machine, captures })
{
    const lines = machine.map(({ what, state, detail }) => (state === 'present' ? `machine: ${what} - present` : `machine: ${what} - ${state}: ${detail}`));
    for (const { skill, state, detail } of captures) lines.push(`capture: ${skill} - ${state}: ${detail}`);
    const count = (s) => machine.filter((m) => m.state.startsWith(s)).length;
    lines.push(`init-plan: ${count('missing') + count('refresh')} to install, ${count('blocked')} blocked, ${captures.filter((c) => c.state === 'run').length} captures to run`);
    return lines;
}

// UNATTENDED - nobody answers the asks. The switch is exactly '1', like every other stack switch.
const isUnattended = (env = process.env) => String(env.ALFRED_CODE_UNATTENDED || '').trim() === '1';
// A machine line whose command REPLACES something already there (claude-hud's own status line in a
// stale shape, after a backup) is destructive; `missing` ones only add. references/init-bootstrap.md defines the word.
const DESTRUCTIVE_MACHINE = ['refresh'];
// The two modes step 4 reads (tools.js), so the unattended answers skip an ask that will not fire; unknown reads as default.
function modesOf(root)
{
    try
    {
        const tools = require(path.join(REPO, 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js'));
        return { memory: tools.memoryMode({ projectRoot: root }), ownNavigation: tools.jobOrder({ projectRoot: root, job: 'navigation' }).own };
    }
    catch { return { memory: 'default', ownNavigation: false }; }
}

function unattended({ machine, captures, memory = 'default', ownNavigation = false })
{
    const lines = [];
    const take = machine.filter((m) => m.state === 'missing').map((m) => m.what);
    if (take.length) lines.push(`unattended: machine installs -> install ${take.join(', ')}`);
    for (const m of machine.filter((x) => DESTRUCTIVE_MACHINE.includes(x.state)))
        lines.push(`unattended: machine installs -> skip ${m.what} (a refresh replaces the account's existing status line - destructive)`);
    // Step 4 asks each only while its mode is the stack's default: a mode already chosen is configure's to change.
    if (memory !== 'custom') lines.push("unattended: Memory for this project? -> Native, Claude's default place (Recommended)");
    if (!ownNavigation) lines.push("unattended: Navigation in files? -> Agent decides, the stack's order (Recommended)");
    lines.push('unattended: AGENTS.md -> fill it in (Recommended)');
    return lines;
}

// How the plan prints a path: project-relative inside the project, absolute outside it, and forward slashes
// either way - init reads the plan through Bash, where a backslash is an escape. Outside used to keep the native
// separators; windows-2025 CI never showed it, because its checkout is on D: and its temp on C:, and a relative
// path across drives comes back absolute, which took the forward-slash branch. One drive printed `C:\...`.
function shownPath(root, p, pth = path)
{
    const r = pth.relative(root, p);
    return (r.startsWith('..') || pth.isAbsolute(r) ? p : r).split(pth.sep).join('/');
}

module.exports = { plan, render, probes, CAPTURES, unattended, isUnattended, DESTRUCTIVE_MACHINE, shownPath };

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    if (argv.includes('--mode')) { console.log(`unattended: ${isUnattended() ? 'on' : 'off'}`); process.exit(0); }
    const file = flag('--installed');
    let inv;
    try { inv = JSON.parse(fs.readFileSync(file, 'utf8')); if (!inv || typeof inv !== 'object') throw new Error('not an object'); }
    catch (err)
    {
        console.error(`init-plan: cannot read --installed ${file || '(missing)'} (${err.message}) - it is update --installed-only --print-plan --plan-out's file`);
        process.exit(2);
    }
    const root = path.resolve(flag('--root') || process.cwd());
    let lines;
    try
    {
        const planned = plan({ inv, root, pluginRoot: flag('--plugin-root') || '' });
        lines = render(planned).concat(isUnattended() ? unattended({ ...planned, ...modesOf(root) }) : []);
    }
    catch (err) { console.error(`init-plan: ${err.message}`); process.exit(2); }
    for (const line of lines) console.log(line);
}
