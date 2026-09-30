#!/usr/bin/env node
'use strict';
// WHAT /alfred-code:init DOES IN THIS PROJECT - stated by a script, so the command never infers it.
//
//   node scripts/init-plan.js --installed <plan-out.json> --root <project> [--plugin-root <dir>] [--space <name>]
//
// `--installed` is `update --installed-only --print-plan --plan-out`'s read-back. Two blocks:
//
//   machine: <what> - present | missing: <command> | missing after uv: <command> | refresh: <command> | blocked: <why> | skip: <why>
//     What the kept MCPs need before they can start, probed on this machine, in install order: uv,
//     the pinned Python fetched through it, csharp-ls when csharp-lsp is kept, the picked playwright
//     browsers, the serena index and the memory service's embedding model. Setup's install already downloaded a picked firefox / webkit, so
//     one is here only when that download failed; chrome and msedge run the machine's own browser,
//     probed like stack-select's msedge check, and one that is not there is `blocked` with its fix.
//     Last, the account's claude-hud status line + compact layout (hud-statusline.js, the account dir
//     CLAUDE_CONFIG_DIR, else ~/.claude-<space>): `skip` when claude-hud is absent or switched off, or
//     the statusLine is the user's own with nothing else to add; `refresh` when claude-hud's own line
//     has a stale shape. Its command ends in `# adds <n> claude-hud keys: <names>`, a shell comment.
//     The command is the exact one to run; init puts every missing one through ONE ask.
//
//   capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>
//     The five captures in their fixed order, each only when the install lists its skill AND its seat
//     (project-capabilities and agent-capabilities have none). init READS the SKILL.md and follows it inline: these skills are
//     manual-only, so a Skill call is denied. An existing output is done - re-capturing is the user's
//     call, later. The library copy in .claude/skills wins over the plugin's.
//
//   unattended: <question> -> <choice>
//     Only with ALFRED_CODE_UNATTENDED=1: the answer to each ask init itself owns, after the plan -
//     the recommended option unless it is destructive or needs a person (init.md, 'Unattended').
//     `--mode` alone prints `unattended: on|off` and nothing else, for init's first call.
//
// Exit 0 with the plan, 2 on an unreadable --installed file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const REPO = path.join(__dirname, '..');
const { pythonRequest, excludeNewerOf, userExcludeNewer, cutoffFor } = require(path.join(REPO, 'stack', 'mcp', 'uv-python.js'));
const { serenaHomeFor } = require(path.join(REPO, 'stack', 'mcp', 'serena-launch.js'));
const dataRoot = require(path.join(REPO, 'stack', 'mcp', 'data-root.js'));
const { resolveDocsRoot } = require(path.join(REPO, 'scripts', 'install', 'copy.js'));
const { browserCandidates } = require(path.join(REPO, 'scripts', 'stack-select.js'));
const { planHud, resolveConfigDir } = require(path.join(REPO, 'scripts', 'hud-statusline.js'));

const HUD_ITEM = 'claude-hud status line + compact layout';

const DOWNLOADED = ['firefox', 'webkit'];
// The machine browsers a picked chrome / msedge runs: PATH names, then stack-select's app locations.
const MACHINE_BROWSERS = {
    chrome: { need: 'Google Chrome', bins: ['google-chrome', 'google-chrome-stable', 'chrome'] },
    msedge: { need: 'Microsoft Edge', bins: ['msedge', 'microsoft-edge'] },
};
const CAPTURES = [
    { skill: 'alfred-capture-related-projects', seat: 'related-project-analyzer', output: () => '.claude/rules/alfred-project-related-context.md' },
    { skill: 'alfred-capture-architecture', seat: 'architecture-analyzer', output: (docs) => `${docs}/architecture/ARCHITECTURE.md` },
    { skill: 'alfred-capture-code-style', seat: 'code-style-analyzer', output: (docs) => `${docs}/code-style/CODE-STYLE.md` },
    // The run book: no seat - it reads the repo and asks for the gaps in the main session.
    { skill: 'alfred-capture-project-capabilities', seat: null, output: (docs) => `${docs}/project-capabilities/PROJECT-CAPABILITIES.md` },
    // Its own precheck decides whether the generated rule is current - always run when installed.
    { skill: 'alfred-capture-agent-capabilities', seat: null, output: null },
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
    // On Windows a tool counts only when it resolves to a file Node can start (R105): `where` also
    // lists npm's extensionless sh shim, which no Windows spawn runs.
    has: (bin, env = process.env) => rt.which(bin, { env }),
    pythonFound: (request, env = process.env) => rt.spawnCommand('uv', ['python', 'find', request], { env, encoding: 'utf8' }).status === 0,
    file: (p) => fs.existsSync(p),
    dir: (dir, prefix) => { try { return fs.readdirSync(dir).some((n) => n.startsWith(prefix)); } catch { return false; } },
};

function pinsFile()
{
    try { return JSON.parse(fs.readFileSync(path.join(REPO, 'meta', 'mcp-pins.json'), 'utf8')) || {}; }
    catch { return {}; }
}

function pinOf(name)
{
    const row = (pinsFile().pins || {})[name];
    return row && row.version ? String(row.spelling || '@<v>').replace('<v>', row.version) : '';
}

const nonEmptyDir = (dir) => { try { return fs.readdirSync(dir).length > 0; } catch { return false; } };

function plan({ inv, root, platform = process.platform, arch = process.arch, env = process.env, probe = probes, pluginRoot = '', space = '' })
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
    for (const engine of (inv.browser && inv.browser.installed) || [])
    {
        if (DOWNLOADED.includes(engine))
            add(`playwright ${engine}`, probe.dir(pwDir, `${engine}-`) ? 'present' : 'missing', `npx -y -p @playwright/mcp${pinOf('browser')} playwright install ${engine}`);
        else if (MACHINE_BROWSERS[engine])
        {
            const { need, bins } = MACHINE_BROWSERS[engine];
            const found = bins.some((b) => probe.has(b, env)) || browserCandidates(engine, platform, env).some((c) => (probe.file || fs.existsSync)(c));
            add(`playwright ${engine}`, found ? 'present' : 'blocked', `needs ${need} - install it, or drop ${engine} from the browsers (/alfred-code:configure)`);
        }
    }

    // serena's folder this start: under the data root, or a 2.0.0 .serena its launcher has not moved yet.
    const data = dataRoot.dataRootOf({ env, projectDir: root }).root;
    const serenaDir = dataRoot.liveDir({ projectDir: root, cls: 'serena', root: data, pending: dataRoot.pendingOf(root), move: false }).dir;
    const serenaHome = serenaHomeFor(platform, data, serenaDir);
    // The same pin and dependency cut-off the server itself starts on (M24), so the index and the server agree -
    // a UV_EXCLUDE_NEWER the user set included (a mirror with no upload times serves nothing under a cut-off).
    const cutoff = cutoffFor(excludeNewerOf(pinsFile().refreshed), userExcludeNewer({ env, projectDir: root }));
    const index = `uvx --python ${request}${cutoff ? ` --exclude-newer ${cutoff}` : ''} --from serena-agent${pinOf('navigation')} serena project index`;
    add('serena index', nonEmptyDir(path.join(root, ...serenaDir.split('/'), 'cache')) ? 'present' : afterUv,
        win ? `$env:SERENA_HOME='${serenaHome}'; ${index}` : `SERENA_HOME=${serenaHome} ${index}`);

    // The memory service's embedding model (~166MB), fetched ahead: its first start downloads it, 33s cold
    // against Claude Code's 30s connect budget, and a server that misses it is cached as failed (live check F2).
    // Setup's install fetches it where uvx already was; here it follows the uv this init installs.
    const marker = path.join(home, '.cache', 'mcp_memory', 'onnx_models', 'all-MiniLM-L6-v2', 'onnx', 'model.onnx');
    add('memory model', (probe.file || fs.existsSync)(marker) ? 'present' : afterUv,
        `node "${path.join(REPO, 'stack', 'hooks', 'memory.js')}" warm --root "${root}" --plugin-root "${REPO}"`);

    // claude-hud arrives configured: its account statusLine plus the plugin-settings row, one command.
    // The runtime is planHud's default - the node the command itself finds on this PATH.
    const configDir = resolveConfigDir({ space, env });
    const hud = planHud({ configDir, platform, env });
    const hudCommand = `node "${path.join(REPO, 'scripts', 'hud-statusline.js')}" --config-dir "${configDir}"`;
    add(HUD_ITEM, hud.item.state, ['missing', 'refresh'].includes(hud.item.state)
        ? (hud.item.note ? `${hudCommand} # ${hud.item.note}` : hudCommand)
        : hud.item.detail);

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
    lines.push(`init-plan: ${count('missing') + count('refresh')} to install, ${count('blocked')} blocked, ${captures.filter((c) => c.state === 'run').length} captures to run`);
    return lines;
}

// UNATTENDED - nobody answers the asks. The switch is exactly '1', like every other stack switch.
const isUnattended = (env = process.env) => String(env.ALFRED_CODE_UNATTENDED || '').trim() === '1';
// A machine line whose command REPLACES something already there (claude-hud's own status line in a
// stale shape, after a backup) is destructive; `missing` ones only add. init.md defines the word.
const DESTRUCTIVE_MACHINE = ['refresh'];
function unattended({ machine, captures })
{
    const lines = [];
    const take = machine.filter((m) => m.state === 'missing' || m.state === 'missing after uv').map((m) => m.what);
    if (take.length) lines.push(`unattended: machine installs -> install ${take.join(', ')}`);
    for (const m of machine.filter((x) => DESTRUCTIVE_MACHINE.includes(x.state)))
        lines.push(`unattended: machine installs -> skip ${m.what} (a refresh replaces the account's existing status line - destructive)`);
    lines.push('unattended: memory level -> global (Recommended)');
    // Its only real answer is a sibling list someone types - an unattended run would be inventing one.
    if (captures.some((c) => c.skill === 'alfred-capture-related-projects' && c.state === 'run'))
        lines.push('unattended: related projects -> none - skip it (naming the siblings needs a person)');
    lines.push('unattended: CLAUDE.md -> fill it in (Recommended)');
    return lines;
}

module.exports = { plan, render, probes, browsersDir, CAPTURES, unattended, isUnattended, DESTRUCTIVE_MACHINE };

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    if (argv.includes('--mode')) { console.log(`unattended: ${isUnattended() ? 'on' : 'off'}`); process.exit(0); }
    // A --space that names no profile would plan the default account instead.
    if (argv.some((a) => a.startsWith('--space=')) || (argv.includes('--space') && !flag('--space')))
    {
        console.error('init-plan: --space needs a profile name, as --space <name>');
        process.exit(2);
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
        const planned = plan({ inv, root, pluginRoot: flag('--plugin-root') || '', space: flag('--space') || '' });
        lines = render(planned).concat(isUnattended() ? unattended(planned) : []);
    }
    catch (err) { console.error(`init-plan: ${err.message}`); process.exit(2); }
    for (const line of lines) console.log(line);
}
