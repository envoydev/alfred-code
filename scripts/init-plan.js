#!/usr/bin/env node
'use strict';
// WHAT /alfred-code:init DOES IN THIS PROJECT - stated by a script, so the command never infers it.
//
//   node scripts/init-plan.js --installed <plan-out.json> --root <project> [--plugin-root <dir>]
//
// `--installed` is `update --installed-only --print-plan --plan-out`'s read-back. Two blocks:
//
//   machine: <what> - present | missing: <command> | missing after uv: <command> | blocked: <why>
//     What the kept MCPs need before they can start, probed on this machine, in install order: uv,
//     the pinned Python fetched through it, csharp-ls when csharp-lsp is kept, the picked playwright
//     browsers, and the serena index. Setup's install already downloaded a picked firefox / webkit, so
//     one is here only when that download failed; chrome and msedge run the machine's own browser,
//     probed like stack-select's msedge check, and one that is not there is `blocked` with its fix.
//     The command is the exact one to run; init puts every missing one through ONE ask.
//
//   capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>
//     The four captures in their fixed order, each only when the install lists its skill AND its seat
//     (agent-capabilities has none). init READS the SKILL.md and follows it inline: these skills are
//     manual-only, so a Skill call is denied. An existing output is done - re-capturing is the user's
//     call, later. The library copy in .claude/skills wins over the plugin's.
//
// Exit 0 with the plan, 2 on an unreadable --installed file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const { pythonRequest } = require(path.join(REPO, 'stack', 'mcp', 'uv-python.js'));
const { serenaHomeFor } = require(path.join(REPO, 'stack', 'mcp', 'serena-launch.js'));
const { resolveDocsRoot } = require(path.join(REPO, 'scripts', 'install', 'copy.js'));
const { browserCandidates } = require(path.join(REPO, 'scripts', 'stack-select.js'));

const DOWNLOADED = ['firefox', 'webkit'];
// The machine browsers a picked chrome / msedge runs: PATH names, then stack-select's app locations.
const MACHINE_BROWSERS = {
    chrome: { need: 'Google Chrome', bins: ['google-chrome', 'google-chrome-stable', 'chrome'] },
    msedge: { need: 'Microsoft Edge', bins: ['msedge', 'microsoft-edge'] },
};
const CAPTURES = [
    { skill: 'project-related-context', seat: 'related-project-analyzer', output: () => '.claude/rules/baseline-project-related-context.md' },
    { skill: 'project-architecture-analyzer', seat: 'architecture-analyzer', output: (docs) => `${docs}/architecture/ARCHITECTURE.md` },
    { skill: 'project-code-style-analyzer', seat: 'code-style-analyzer', output: (docs) => `${docs}/code-style/CODE-STYLE.md` },
    // Its own precheck decides whether the generated rule is current - always run when installed.
    { skill: 'project-agent-capabilities', seat: null, output: null },
];

// Playwright's own registry location (PLAYWRIGHT_BROWSERS_PATH, else the per-OS cache dir).
function browsersDir(platform, env)
{
    if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
    const home = env.HOME || env.USERPROFILE || os.homedir();
    if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
    if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
    return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');
}

const probes = {
    has: (bin, env = process.env) =>
    {
        const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { env, encoding: 'utf8' });
        return r.status === 0 && Boolean((r.stdout || '').trim());
    },
    pythonFound: (request, env = process.env) => spawnSync('uv', ['python', 'find', request], { env, encoding: 'utf8', shell: process.platform === 'win32' }).status === 0,
    file: (p) => fs.existsSync(p),
    dir: (dir, prefix) => { try { return fs.readdirSync(dir).some((n) => n.startsWith(prefix)); } catch { return false; } },
};

function pinOf(name)
{
    try
    {
        const row = JSON.parse(fs.readFileSync(path.join(REPO, 'meta', 'mcp-pins.json'), 'utf8')).pins[name];
        return row && row.version ? row.spelling.replace('<v>', row.version) : '';
    }
    catch { return ''; }
}

const nonEmptyDir = (dir) => { try { return fs.readdirSync(dir).length > 0; } catch { return false; } };

function plan({ inv, root, platform = process.platform, arch = process.arch, env = process.env, probe = probes, pluginRoot = '' })
{
    const machine = [];
    const add = (what, state, detail = '') => machine.push({ what, state, detail });
    const win = platform === 'win32';
    const home = env.HOME || env.USERPROFILE || os.homedir();

    const uv = probe.has('uv', env);
    add('uv', uv ? 'present' : 'missing', win
        ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
        : 'curl -LsSf https://astral.sh/uv/install.sh | sh');
    const afterUv = uv ? 'missing' : 'missing after uv';

    const request = pythonRequest({ platform, arch, env, projectDir: root });
    add(`python ${request}`, uv && probe.pythonFound(request, env) ? 'present' : afterUv, `uv python install ${request}`);

    if ((inv.plugins || []).some((p) => (p && p.name) === 'csharp-lsp'))
    {
        const tool = path.join(home, '.dotnet', 'tools', win ? 'csharp-ls.exe' : 'csharp-ls');
        if (probe.has('csharp-ls', env) || (probe.file || fs.existsSync)(tool)) add('csharp-ls', 'present');
        else if (probe.has('dotnet', env)) add('csharp-ls', 'missing', 'dotnet tool install --global csharp-ls');
        else add('csharp-ls', 'blocked', 'needs the .NET 10 SDK (dotnet) first - https://dot.net, then dotnet tool install --global csharp-ls');
    }

    const pwDir = browsersDir(platform, env);
    for (const engine of (inv.playwright && inv.playwright.installed) || [])
    {
        if (DOWNLOADED.includes(engine))
            add(`playwright ${engine}`, probe.dir(pwDir, `${engine}-`) ? 'present' : 'missing', `npx -y -p @playwright/mcp${pinOf('playwright')} playwright install ${engine}`);
        else if (MACHINE_BROWSERS[engine])
        {
            const { need, bins } = MACHINE_BROWSERS[engine];
            const found = bins.some((b) => probe.has(b, env)) || browserCandidates(engine, platform, env).some((c) => (probe.file || fs.existsSync)(c));
            add(`playwright ${engine}`, found ? 'present' : 'blocked', `needs ${need} - install it, or drop ${engine} from the playwright browsers (/alfred-code:configure)`);
        }
    }

    const serenaHome = serenaHomeFor(platform);
    const index = `uvx --python ${request} --from serena-agent${pinOf('serena')} serena project index`;
    add('serena index', nonEmptyDir(path.join(root, '.serena', 'cache')) ? 'present' : afterUv,
        win ? `$env:SERENA_HOME='${serenaHome}'; ${index}` : `SERENA_HOME=${serenaHome} ${index}`);

    const skills = new Set(inv.skills || []);
    const agents = new Set(inv.agents || []);
    const off = new Set(inv.left_out || []);
    const docs = resolveDocsRoot(root).replace(/[\\/]+$/, '');
    const rel = (p) => (path.relative(root, p).startsWith('..') ? p : path.relative(root, p).split(path.sep).join('/'));
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
    lines.push(`init-plan: ${count('missing')} to install, ${count('blocked')} blocked, ${captures.filter((c) => c.state === 'run').length} captures to run`);
    return lines;
}

module.exports = { plan, render, probes, browsersDir, CAPTURES };

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const file = flag('--installed');
    let inv;
    try { inv = JSON.parse(fs.readFileSync(file, 'utf8')); if (!inv || typeof inv !== 'object') throw new Error('not an object'); }
    catch (err)
    {
        console.error(`init-plan: cannot read --installed ${file || '(missing)'} (${err.message}) - it is update --installed-only --print-plan --plan-out's file`);
        process.exit(2);
    }
    const root = path.resolve(flag('--root') || process.cwd());
    for (const line of render(plan({ inv, root, pluginRoot: flag('--plugin-root') || '' }))) console.log(line);
}
