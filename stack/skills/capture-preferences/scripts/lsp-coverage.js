'use strict';
// lsp-coverage.js - whether a language server covers this project (spec N2), so the tool order ranks `LSP` only where it
// would answer: the enabled plugins' declared servers (a plugin's own plugin.json, its marketplace entry, its .lsp.json -
// the three ways Claude Code reads one, per code.claude.com/docs/en/plugins-reference), each command on PATH or not,
// against the file types the project holds. The installer runs it on every run (`tools.js lsp`, install/docs.js) and the
// hooks only read its file, so no session or seat start pays for the walk.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const prefs = require('./preferences.js');

const FILE = 'lsp-coverage.json';
const WALK_CAP = 20000;
const GIT_TIMEOUT_MS = 20000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude']);

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

function coveragePath(projectRoot)
{
    return path.resolve(projectRoot, prefs.dataRoot(projectRoot), 'state', FILE);
}

function readCoverage(projectRoot)
{
    const data = readJson(coveragePath(projectRoot));
    return data && typeof data === 'object' && Array.isArray(data.covered) && Array.isArray(data.servers) ? data : null;
}

// One install's declared servers: `lspServers` inline, as a path, or a list of either, a file config wrapping its map or not.
function declaredServers(installPath, name, marketDir)
{
    const entryIn = (file) => (((readJson(file) || {}).plugins) || []).find((p) => p && p.name === name) || null;
    const manifests = [readJson(path.join(installPath, '.claude-plugin', 'plugin.json')), entryIn(path.join(installPath, '.claude-plugin', 'marketplace.json'))];
    if (marketDir) manifests.push(entryIn(path.join(marketDir, '.claude-plugin', 'marketplace.json')));
    const configs = (v) =>
    {
        if (Array.isArray(v)) return v.flatMap(configs);
        const o = typeof v === 'string' ? readJson(path.join(installPath, v)) : v;
        if (!o || typeof o !== 'object') return [];
        return [o.lspServers && typeof o.lspServers === 'object' ? o.lspServers : o];
    };
    const maps = [...manifests.filter(Boolean).flatMap((m) => configs(m.lspServers)), ...configs('.lsp.json')];
    const out = [];
    for (const map of maps)
        for (const srv of Object.values(map))
        {
            if (!srv || typeof srv.command !== 'string' || !srv.command) continue;
            const exts = Object.keys(srv.extensionToLanguage || {}).map((e) => e.toLowerCase());
            // One binary may serve two languages: the servers sharing a command keep every file type between them.
            const same = out.find((x) => x.command === srv.command);
            if (same) same.exts = [...new Set([...same.exts, ...exts])].sort();
            else out.push({ command: srv.command, exts: [...new Set(exts)].sort() });
        }
    return out;
}

// Every enabled plugin's servers whose install record reaches this project: a record without a projectPath (user or
// managed scope) reaches every project, one with a projectPath only that project.
function pluginServers({ projectRoot, env, enabled })
{
    const plugins = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
    const registry = readJson(path.join(plugins, 'installed_plugins.json'));
    const markets = readJson(path.join(plugins, 'known_marketplaces.json')) || {};
    const here = realOf(projectRoot);
    const out = [];
    for (const [key, records] of Object.entries((registry && registry.plugins) || {}))
    {
        const [name, market] = key.split('@');
        if (!enabled || enabled.get(name) !== true) continue;
        const marketDir = market && markets[market] && markets[market].installLocation;
        for (const r of Array.isArray(records) ? records : [])
        {
            if (!r || !r.installPath || (r.projectPath && realOf(r.projectPath) !== here)) continue;
            for (const s of declaredServers(r.installPath, name, marketDir))
            {
                const same = out.find((x) => x.plugin === name && x.command === s.command);
                if (same) same.exts = [...new Set([...same.exts, ...s.exts])].sort();
                else out.push({ plugin: name, ...s, root: r.installPath });
            }
        }
    }
    return out;
}

// A command Claude Code could start: an absolute path that exists, or a PATH entry holding it (on win32 with each PATHEXT
// suffix, the way a .cmd shim is found). Claude Code resolves `${...}` in an LSP server's command - the plugin's
// install folder, the project root, its data folder, a user_config value (code.claude.com/docs/en/plugins-reference,
// 'Where each variable resolves'); `vars` holds the first two, and a reference this check cannot resolve is taken as
// present - a server read as missing would drop LSP on a guess.
function onPath(command, env = process.env, platform = process.platform, vars = {})
{
    command = String(command).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name) => (Object.hasOwn(vars, name) && vars[name] ? vars[name] : all));
    if (command.includes('${')) return true;
    const win = platform === 'win32';
    const suffixes = win && !path.extname(command) ? ['', ...String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
    const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
    if (path.isAbsolute(command)) return suffixes.some((x) => isFile(command + x));
    const dirs = String(env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
    return dirs.some((d) => suffixes.some((x) => isFile(path.join(d, command + x)) || isFile(path.join(d, command + x.toLowerCase()))));
}

// The file types the project holds: where git answers, its tracked files and the ones not committed yet that it does not
// ignore (a fresh repo has nothing tracked), every one of them - git hands the list over whole, so a cap would only cut
// covered files off (final review I2) - else a breadth-first walk that skips git's, the packages', Claude Code's and the
// stack's data folders and stops at `walkCap` files. `files` counts what was read, `capped` says the walk stopped short.
function scanProject({ projectRoot, spawn = spawnSync, walkCap = WALK_CAP })
{
    const exts = new Set();
    const add = (name) => { const e = path.extname(name).toLowerCase(); if (e) exts.add(e); };
    const git = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: projectRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 512 * 1024 * 1024, windowsHide: true });
    if (git && git.status === 0 && typeof git.stdout === 'string')
    {
        let files = 0;
        for (const f of git.stdout.split('\0')) if (f) { files++; add(f); }
        return { exts, files, capped: false };
    }
    const skip = new Set([...SKIP_DIRS, prefs.dataRoot(projectRoot).split('/')[0]]);
    const queue = [projectRoot];
    let n = 0;
    let capped = false;
    while (queue.length && !capped)
    {
        const dir = queue.shift();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
        catch { continue; }
        for (const d of entries)
        {
            if (d.isDirectory()) { if (!(dir === projectRoot && skip.has(d.name)) && !SKIP_DIRS.has(d.name)) queue.push(path.join(dir, d.name)); continue; }
            if (!d.isFile()) continue;
            if (n >= walkCap) { capped = true; break; }
            n++;
            add(d.name);
        }
    }
    return { exts, files: n, capped };
}
const projectExtensions = (opts) => scanProject(opts).exts;

function computeCoverage({ projectRoot, env = process.env, enabled, platform = process.platform, spawn = spawnSync, walkCap = WALK_CAP })
{
    const servers = pluginServers({ projectRoot, env, enabled }).map((s) => ({ plugin: s.plugin, command: s.command, onPath: onPath(s.command, env, platform, { CLAUDE_PLUGIN_ROOT: s.root, CLAUDE_PROJECT_DIR: projectRoot }), exts: s.exts }));
    const scan = scanProject({ projectRoot, spawn, walkCap });
    const held = scan.exts;
    const covered = new Set();
    const missing = [];
    for (const s of servers)
    {
        const mine = s.exts.filter((e) => held.has(e));
        if (!mine.length) continue;
        if (s.onPath) mine.forEach((e) => covered.add(e));
        else missing.push({ plugin: s.plugin, command: s.command });
    }
    // Final review I3: nothing covered in an empty project or a walk cut short is no finding - LSP stays until a check settles.
    const why = !scan.files ? 'empty' : scan.capped && !covered.size ? 'capped' : null;
    return { version: 1, servers, covered: [...covered].sort(), missing, settled: !why, ...(why ? { why } : {}) };
}

// Written by temp file and rename, and only when the result changed - a re-run on another day leaves the file as it was.
function writeCoverage(projectRoot, result, { today = new Date().toISOString().slice(0, 10) } = {})
{
    const file = coveragePath(projectRoot);
    const old = readCoverage(projectRoot);
    const facts = (r) => JSON.stringify({ version: r.version, servers: r.servers, covered: r.covered, missing: r.missing || [], settled: r.settled !== false, why: r.why || null });
    if (old && facts(old) === facts(result)) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, checked: today, servers: result.servers, covered: result.covered, missing: result.missing || [], settled: result.settled !== false, ...(result.why ? { why: result.why } : {}) }, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return true;
}

function coverageLine(result)
{
    if (!result) return 'lsp: not checked yet - the next update or /alfred-code:init checks it';
    if (result.settled === false)
        return `lsp: not settled - ${result.why === 'capped' ? `the walk stopped at ${WALK_CAP} files before a covered one` : 'the project holds no files yet'}, so LSP stays in the order; /alfred-code:update checks again`;
    if (!result.covered.length)
    {
        const missing = (result.missing || []).map((m) => `${m.plugin}'s ${m.command}`);
        return `lsp: none covers this project's files - navigation starts at the grep${missing.length ? `; ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not on PATH` : ''}; /alfred-code:update checks again`;
    }
    const plugins = [...new Set(result.servers.filter((s) => s.onPath && s.exts.some((e) => result.covered.includes(e))).map((s) => s.plugin))].sort();
    return `lsp: covers ${result.covered.join(', ')} (${plugins.join(', ')})`;
}

module.exports = { FILE, WALK_CAP, coveragePath, readCoverage, declaredServers, pluginServers, onPath, scanProject, projectExtensions, computeCoverage, writeCoverage, coverageLine };
