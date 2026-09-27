'use strict';
// What a cell's sandboxed commands may read. The sandbox reads everywhere by default, so in pilot 3 every cell
// could read this repository - bench/results holds every other cell's diff and transcript, bench/tasks every
// hidden test - and one cell grepped it, taking the path from the sandbox instructions; every other cell and
// template under the work root was readable too. Each cell's own settings (lib/session.js) deny those reads and
// re-open what the cell runs from: its own work dir (clone, home, account dir, the dotnet shim), the plugin code
// its config loads in place from outside it (a template's src, whose .git - for ours, every branch of this
// repository - stays denied), and the shared uv store. The narrower rule wins in Claude Code's sandbox, so the
// re-opened paths read inside the denied ones. A narrowing only: nothing here widens the sandbox.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const unique = (list) => [...new Set(list)];

// The checkout the harness runs from and, when it is a worktree, the main checkout whose .git holds it.
function hostRoots(root)
{
    const roots = [real(root)];
    try
    {
        const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        roots.push(real(path.dirname(common)));
    }
    catch { /* not a repository: the directory alone */ }
    return unique(roots);
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const inside = (p, dir) => p === dir || p.startsWith(`${dir}${path.sep}`);

// Every marketplace and plugin install the cell's account dir names outside the cell's own work dir: the code
// its plugins run from in place (a directory marketplace loads from its source, not from the cache).
function pluginSourcesOf(cell)
{
    const plugins = path.join(cell.config, 'plugins');
    const markets = Object.values(readJson(path.join(plugins, 'known_marketplaces.json')) || {}).map((m) => m && m.installLocation);
    const installs = Object.values((readJson(path.join(plugins, 'installed_plugins.json')) || {}).plugins || {}).flat().map((i) => i && i.installPath);
    const work = real(cell.work);
    return unique([...markets, ...installs].filter((p) => typeof p === 'string' && p && fs.existsSync(p)).map(real)).filter((p) => !inside(p, work));
}

function cellReads({ cell, workRoot, hostRoots: roots, pluginSources = [] })
{
    return {
        denyRead: unique([...roots, workRoot, ...pluginSources.map((s) => path.join(s, '.git'))]),
        allowRead: unique([cell.work, ...pluginSources, path.join(workRoot, 'uv')]),
    };
}

module.exports = { hostRoots, pluginSourcesOf, cellReads };
