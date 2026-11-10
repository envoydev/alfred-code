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
//   capture: <skill> <topic> - run: read <SKILL.md> | done: <output> exists | skip: <why>
//     The awareness parts in their fixed order, each only when the install lists the skill AND the part's seat
//     (three parts have none). init READS the SKILL.md and follows it inline with the topic as its argument,
//     never a Skill call. An existing output is done - re-capturing is the user's call, later. The library copy in
//     .claude/skills wins over the plugin's.
//
//   auto-update: ask <key> | on|off for <key> (<where>) | not asked - <why>
//     Claude Code's auto-update for the stack's marketplace (install/marketplace-autoupdate.js): `ask` while nothing on
//     this account has answered it - step 4's call carries the question, once per account, since a no is written too.
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
const autoUpdateLib = require(path.join(REPO, 'scripts', 'install', 'marketplace-autoupdate.js'));

const HUD_ITEM = 'claude-hud status line + compact layout';

// One row per capture-awareness part (the merge of 2026-10-29), read as the router with the part's topic. A part with
// no seat always runs when the skill is installed - each decides from disk whether it has work; related-projects
// dispatches its opt-in seat only where it is installed. The agents part runs LAST, so the inventory reflects every
// part above.
const CAPTURES = [
    { skill: 'capture-awareness', topic: 'architecture', seat: 'architecture-analyzer', output: (docs) => `${docs}/awareness/ARCHITECTURE-AWARENESS.md` },
    { skill: 'capture-awareness', topic: 'project-code-style', seat: 'code-style-analyzer', output: (docs) => `${docs}/preferences/PROJECT-CODE-PREFERENCES.md` },
    { skill: 'capture-awareness', topic: 'project', seat: null, output: null },
    { skill: 'capture-awareness', topic: 'related-projects', seat: null, output: null },
    { skill: 'capture-awareness', topic: 'agents', seat: null, output: null },
];

const probes = {
    // On Windows a tool counts only when it resolves to a file Node can start (R105): `where` also
    // lists npm's extensionless sh shim, which no Windows spawn runs.
    has: (bin, env = process.env) => rt.which(bin, { env }),
    file: (p) => fs.existsSync(p),
};

function plan({ inv, root, platform = process.platform, env = process.env, probe = probes, pluginRoot = '', managedFile })
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
    const ws = require('./install/workspace.js');
    const bare = bareWorkspaceRoot(root, env, ws);
    const captures = CAPTURES.map(({ skill, topic, seat, output }) =>
    {
        if (!skills.has(skill) || off.has(`skill ${skill}`)) return { skill, topic, state: 'skip', detail: 'the skill is not installed' };
        if (seat && bare) return { skill, topic, state: 'skip', detail: 'a workspace root with no repository of its own - each child captures its own' };
        if (seat && off.has(`agent ${seat}`)) return { skill, topic, state: 'skip', detail: `its seat ${seat} is switched off` };
        if (seat && !agents.has(seat)) return { skill, topic, state: 'skip', detail: `its seat ${seat} is not installed` };
        const out = output && output(docs);
        if (out && fs.existsSync(path.join(root, out))) return { skill, topic, state: 'done', detail: `${out} exists` };
        const file = [path.join(root, '.claude', 'skills', skill, 'SKILL.md'),
            ...(pluginRoot ? [path.join(pluginRoot, 'stack', 'skills', skill, 'SKILL.md')] : []),
            path.join(REPO, 'stack', 'skills', skill, 'SKILL.md')].find((f) => fs.existsSync(f));
        return file ? { skill, topic, state: 'run', detail: `read ${rel(file)}` } : { skill, topic, state: 'skip', detail: 'its SKILL.md is in neither the project nor the plugin' };
    });
    // D5 (workspace layering): a joined child with a CLAUDE.md on its path, asked once per account.
    const instructionsBoth = ws.instructionsBothState({ projectRoot: root, env, ...ws.accountPaths(env) });
    const autoUpdate = autoUpdateLib.autoUpdateState({ projectRoot: root, env, managedFile });
    return { machine, captures, instructionsBoth, autoUpdate };
}

// AC-4 (2026-11-10): a root in NO repository that is a workspace root - its record says so, or two or more of its
// immediate child folders hold a `.git` (session be3a0031: six child repositories, no record) - has no code of its own
// for the architecture and code-style seats to describe; each child captures its own. `git` that cannot start (not on
// PATH) says nothing, so the root plans as before.
function bareWorkspaceRoot(root, env, ws)
{
    const r = rt.spawnCommand('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] });
    if (!r || r.error || typeof r.status !== 'number' || r.status === 0) return false;
    let role = null;
    try { role = ws.roleOf(root, { env, log: () => {} }).kind; } catch { /* an unreadable record says nothing */ }
    if (role === 'root') return true;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
    return entries.filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, '.git'))).length >= 2;
}

function render({ machine, captures, instructionsBoth, autoUpdate })
{
    const lines = machine.map(({ what, state, detail }) => (state === 'present' ? `machine: ${what} - present` : `machine: ${what} - ${state}: ${detail}`));
    for (const { skill, topic, state, detail } of captures) lines.push(`capture: ${skill} ${topic} - ${state}: ${detail}`);
    if (autoUpdate) lines.push(autoUpdateLib.stateLine(autoUpdate));
    const both = require('./install/workspace.js').instructionsBothLine(instructionsBoth);
    if (both) lines.push(both);
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
// Memory P3: the plan lines step 4 asks from - whether docs mode can be written here, and how many memory files the copy
// to the docs place would carry (`memory-docs:`, `memory-copy:`); a tools.js too old to print them reads as not writable.
function modesOf(root)
{
    try
    {
        const tools = require(path.join(REPO, 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js'));
        const plan = typeof tools.memoryPlanLines === 'function' ? tools.memoryPlanLines({ projectRoot: root, target: 'docs' }) : [];
        const copy = plan.map((l) => /^memory-copy: (\d+) memory files at /.exec(l)).find(Boolean);
        return {
            memory: tools.memoryMode({ projectRoot: root }), ownNavigation: tools.jobOrder({ projectRoot: root, job: 'navigation' }).own,
            docsWritable: plan.some((l) => l.startsWith('memory-docs: can be written')), copyCount: copy ? Number(copy[1]) : 0,
            docsCommitted: !plan.some((l) => /^memory-docs: can be written - .*, kept out of git$/.test(l)),
        };
    }
    catch { return { memory: 'default', ownNavigation: false, docsWritable: false, copyCount: 0, docsCommitted: true }; }
}

function unattended({ machine, captures, instructionsBoth, autoUpdate, memory = 'default', ownNavigation = false, docsWritable = false, copyCount = 0, docsCommitted = true })
{
    const lines = [];
    const take = machine.filter((m) => m.state === 'missing').map((m) => m.what);
    if (take.length) lines.push(`unattended: machine installs -> install ${take.join(', ')}`);
    for (const m of machine.filter((x) => DESTRUCTIVE_MACHINE.includes(x.state)))
        lines.push(`unattended: machine installs -> skip ${m.what} (a refresh replaces the account's existing status line - destructive)`);
    // Step 4 asks each only while its mode is the stack's default: a mode already chosen is configure's to change (D12).
    // Docs mode is the Recommended answer wherever it can be written, and the copy of the old memory files with it - but
    // where git versions the docs, the copy would commit this account's own memory files unread (P3 review finding 2), so
    // an unattended run starts empty there; the old files stay at their place for configure's copy.
    if (memory === 'default')
    {
        lines.push(`unattended: Memory for this project? -> ${docsWritable ? "Native, in this repo's docs" : "Native, Claude's default place"} (Recommended)`);
        if (docsWritable && copyCount > 0)
        {
            lines.push(docsCommitted
                ? `unattended: Copy your ${copyCount} memory files to the new place? -> Start empty (the copy would commit this account's memory files with the docs, unread - they stay at their default place)`
                : `unattended: Copy your ${copyCount} memory files to the new place? -> Copy them (Recommended)`);
        }
    }
    if (!ownNavigation) lines.push("unattended: Navigation in files? -> Agent decides, the stack's order (Recommended)");
    lines.push('unattended: AGENTS.md -> fill it in (Recommended)');
    if (instructionsBoth === 'ask') lines.push('unattended: instructions-both -> load');
    // A setting where none was: adding, never destructive (references/init-bootstrap.md, 'Unattended').
    if (autoUpdate && autoUpdate.state === 'ask') lines.push('unattended: auto-update -> Turn it on (Recommended)');
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

// 2026-11-10 (the user's report on 3.9.2): the state read not-installed while an earlier install's data root was there,
// and nothing said so before the install. `--mode` names it: the data root (the settings' ALFRED_CODE_DATA_PATH, else
// .alfred) of the cwd's git top level, or the cwd, when it holds anything and no stamp says an install is here.
function leftovers(cwd = process.cwd(), env = process.env)
{
    const r = rt.spawnCommand('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const top = r && r.status === 0 ? String(r.stdout || '').trim() : '';
    const projectRoot = top || cwd;
    if (require('./install/stamp.js').stampFiles({ projectRoot }).read) return 'none';
    const root = require('../stack/mcp/data-root.js').dataRootOf({ env, projectDir: projectRoot }).root;
    let names = [];
    try { names = fs.readdirSync(path.join(projectRoot, ...root.split('/'))).sort(); } catch { /* no data root */ }
    return names.length ? `${root}/ (${names.join(', ')})` : 'none';
}

module.exports = { plan, render, probes, CAPTURES, unattended, isUnattended, DESTRUCTIVE_MACHINE, shownPath, leftovers };

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    if (argv.includes('--mode'))
    {
        console.log(`unattended: ${isUnattended() ? 'on' : 'off'}`);
        let left = 'none';
        try { left = leftovers(); } catch { /* an unreadable tree says nothing */ }
        console.log(`leftovers: ${left}`);
        process.exit(0);
    }
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
