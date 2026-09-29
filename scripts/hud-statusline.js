#!/usr/bin/env node
'use strict';
// hud-statusline.js - claude-hud arrives CONFIGURED: /alfred-code:init's claude-hud item, made
// deterministic instead of a model walk through claude-hud's own /claude-hud:setup.
//
//   node scripts/hud-statusline.js [--config-dir <dir> | --space <name>] [--catalog <file>]
//
// Two writes into the ACCOUNT dir (CLAUDE_CONFIG_DIR, else ~/.claude-<space>, else ~/.claude - the
// installer's rule, stamp.js accountDir), both add-only:
//   1. settings.json `statusLine` - the command claude-hud 0.8.0's setup writes for a Node runtime: the
//      first `node` on PATH as found (setup's `command -v node`), in the bash sort -V form - on Windows
//      too when Git Bash is there, else the cmd.exe line and its launcher.
//      No statusLine: written. claude-hud's own line in a current shape: left as it is. claude-hud's
//      line in a stale shape (a pinned version path, the old PowerShell wrapper, a runtime that is
//      gone): its command refreshed, every other key kept. A line that is NOT claude-hud's: kept and
//      reported with the /claude-hud:setup line, never replaced and never given a refresh interval.
//   2. the claude-hud row of meta/plugin-settings.json (the Compact layout among it), through
//      plugin-settings.js - after the statusLine, because the row's refresh interval needs that block.
// claude-hud not installed, or switched off by the user: one skip line, nothing written. An account
// settings.json that is not a JSON object: one blocked line, nothing written, exit 1. Before its first
// write the account settings.json is copied to settings.json.bak.<YYYYMMDD-HHMMSS>; a copy that fails
// writes nothing, exit 1. An unknown argument or a flag with no value: exit 2, nothing written - never
// a fallback to the environment's account.
//
// The shapes below are claude-hud 0.8.0's (commands/setup.md; MIT, Copyright (c) 2026 Jarrod Watts),
// kept byte for byte so a line /claude-hud:setup wrote reads as current here, and ours there.
const fs = require('node:fs');
const path = require('node:path');

const { accountDir } = require('./install/stamp.js');
const { planFor, applyTargets, backupOnce, report, readDoc } = require('./plugin-settings.js');

const HUD = 'claude-hud';
const CATALOG = path.join(__dirname, '..', 'meta', 'plugin-settings.json');

// The Node shape for a bash-run status line (setup.md:199): the marketplace-aware cache glob, the
// newest version by `sort -V`, COLUMNS exported, `exec` with no second `bash -c` layer.
const SORT_V = 'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk \'{print $2}\');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"';
// What /claude-hud:setup itself writes on macOS / Linux (setup.md:185 node, :180 bun) - read as
// current there, never written here.
const AWK_NODE = 'bash -c \'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk \'"\'"\'{print $2}\'"\'"\');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ \'"\'"\'{ print $(NF-1) "\\t" $(0) }\'"\'"\' | grep -E \'"\'"\'^[0-9]+\\.[0-9]+\\.[0-9]+[[:space:]]\'"\'"\' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"\'';
const AWK_BUN = AWK_NODE.replace('exec "{RUNTIME_PATH}" "', 'exec "{RUNTIME_PATH}" --env-file /dev/null "');
// Windows (setup.md:369, the cmd path per :375-377): the launcher below, through the absolute cmd.exe.
const CMD = '{CMD_PATH} /d /s /c ""{RUNTIME_PATH}" "{WRAPPER_PATH}""';
const SHAPES = { sortV: SORT_V, awkNode: AWK_NODE, awkBun: AWK_BUN, cmd: CMD };

// The Windows launcher, `<account>/plugins/claude-hud/statusline.mjs` (setup.md:237-293).
const LAUNCHER = String.raw`import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
const width = Number.isFinite(envColumns) && envColumns > 0 ? envColumns : 120;
process.env.COLUMNS = String(Math.max(1, width - 4));

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const cacheDir = path.join(claudeDir, 'plugins', 'cache');

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const candidates = [];
try {
  for (const marketplace of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const pluginRoot = path.join(cacheDir, marketplace.name, 'claude-hud');
    let versions = [];
    try {
      versions = fs.readdirSync(pluginRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const parts = versionParts(version.name);
      if (!parts) continue;
      const dir = path.join(pluginRoot, version.name);
      if (fs.existsSync(path.join(dir, 'dist', 'index.js'))) {
        candidates.push({ dir, parts });
      }
    }
  }
} catch {
  process.exit(0);
}

candidates.sort((a, b) => compareVersions(a.parts, b.parts));
const latest = candidates.at(-1);
if (!latest) process.exit(0);

const hud = await import(pathToFileURL(path.join(latest.dir, 'dist', 'index.js')).href);
if (typeof hud.main === 'function') {
  await hud.main();
}`;

const fill = (template, vars) => template.replace(/\{(RUNTIME_PATH|SOURCE|CMD_PATH|WRAPPER_PATH)\}/g, (m, k) => (k in vars ? vars[k] : m));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A shape as a matcher: the placeholders become captures, everything else literal.
function shapeRe(template, source)
{
    const holes = { RUNTIME_PATH: '([^"]+)', SOURCE: escapeRe(source || ''), CMD_PATH: '([^"]*cmd\\.exe)', WRAPPER_PATH: '([^"]+)' };
    // Windows paths compare without case; the bash shapes byte for byte.
    return new RegExp(`^${escapeRe(template).replace(/\\\{(RUNTIME_PATH|SOURCE|CMD_PATH|WRAPPER_PATH)\\\}/g, (m, k) => holes[k])}$`, template === CMD ? 'i' : '');
}

// setup.md:478-485 - the label a statusLine that is not claude-hud's is reported under.
function sourceLabel(command)
{
    if (command.includes('claude-pace')) return 'claude-pace';
    if (command.includes('cc-statusline') || command.includes('ccstatusline')) return 'cc-statusline';
    if (/statusline\.(sh|js|py)/.test(command)) return 'statusline script';
    return 'custom';
}

// The absolute cmd.exe (setup.md:375-376): SystemRoot's System32, else the bare name.
function cmdPath(env, exists)
{
    const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
    const abs = path.win32.join(root, 'System32', 'cmd.exe');
    return exists(abs) ? abs : 'cmd.exe';
}

// PATH's absolute entries, whatever the key's case (Windows spells it Path).
function pathDirs(env, platform)
{
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
    const p = platform === 'win32' ? path.win32 : path.posix;
    return String((key && env[key]) || '').split(platform === 'win32' ? ';' : ':').filter((d) => d && p.isAbsolute(d));
}

const isExecutable = (platform) => (file) =>
{
    try
    {
        if (!fs.statSync(file).isFile()) return false;
        if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
        return true;
    }
    catch { return false; }
};

// The runtime setup writes: `command -v node` (setup.md:126, :130), `(Get-Command node).Source` on
// PowerShell (:217) - the first executable node on PATH AS FOUND. Never process.execPath's resolved
// binary: a Homebrew Cellar path or a version manager's target is gone after the next upgrade.
function nodeOnPath(env = process.env, platform = process.platform, runnable = isExecutable(platform))
{
    const p = platform === 'win32' ? path.win32 : path.posix;
    const name = platform === 'win32' ? 'node.exe' : 'node';
    return pathDirs(env, platform).map((d) => p.join(d, name)).find(runnable) || process.execPath;
}

// Windows: is there a Git Bash for Claude Code to run the status line through? claude-hud decides by
// the session shell (setup.md:98-111): a node child sees MSYSTEM, which Git for Windows exports (bash
// does not export OSTYPE). Else Claude Code's own lookup (code.claude.com troubleshoot-install and env-vars):
// CLAUDE_CODE_GIT_BASH_PATH when it names an existing bash / sh, the two Program Files installs,
// then bin\bash.exe of the git on PATH - skipping, as it does, a git in the launch folder (`cwd`), or
// below it in a path holding node_modules or a virtual-environment folder (.venv, env).
function gitBash(env, exists, cwd = process.cwd())
{
    if (env.MSYSTEM || /^(msys|cygwin)/.test(env.OSTYPE || '')) return true;
    const pinned = env.CLAUDE_CODE_GIT_BASH_PATH;
    if (pinned && /^(bash|sh)(\.exe)?$/i.test(path.win32.basename(pinned)) && exists(pinned)) return true;
    if (['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].some((b) => exists(b))) return true;
    const git = pathDirs(env, 'win32').map((d) => path.win32.join(d, 'git.exe')).find((g) => exists(g) && !projectGit(g, cwd));
    if (!git) return false;
    // cmd\git.exe or bin\git.exe sits one level under the install, mingw64\bin\git.exe two.
    const up = path.win32.dirname(path.win32.dirname(git));
    return [up, path.win32.dirname(up)].some((root) => exists(path.win32.join(root, 'bin', 'bash.exe')));
}

// A project's own git, which Claude Code will not run (troubleshoot-install): its folder IS the launch
// folder, or lies below it with node_modules / .venv / env among the path's folders.
function projectGit(git, cwd)
{
    const norm = (p) => path.win32.normalize(p).replace(/\\+$/, '').toLowerCase();
    const dir = norm(path.win32.dirname(git));
    const launch = norm(cwd);
    if (dir === launch) return true;
    return dir.startsWith(`${launch}\\`) && dir.split('\\').some((seg) => ['node_modules', '.venv', 'env'].includes(seg));
}

// What this platform's line should be: the bash form (POSIX, or Windows with Git Bash - forward slashes,
// which bash does not eat as escapes), else the cmd.exe line with `launcher`, the file it runs.
function expected({ platform, configDir, runtime, env, exists, bash })
{
    if (platform !== 'win32' || bash)
    {
        const node = platform === 'win32' ? runtime.replace(/\\/g, '/') : runtime;
        return { shell: 'bash', command: fill(SORT_V, { RUNTIME_PATH: node, SOURCE: 'dist/index.js' }), launcher: null };
    }
    const wrapper = path.win32.join(configDir, 'plugins', HUD, 'statusline.mjs');
    return {
        shell: 'cmd',
        command: fill(CMD, { CMD_PATH: cmdPath(env, exists), RUNTIME_PATH: runtime, WRAPPER_PATH: wrapper }),
        launcher: { file: path.join(configDir, 'plugins', HUD, 'statusline.mjs'), wrapper },
    };
}

// Git Bash spells a Windows path in mount form (`/c/...`, `/cygdrive/c/...`) - the regex the hooks read from
// shell-writes.js, its one home - and `command -v node` drops the .exe.
const { MOUNT_RE } = require('../stack/hooks/shell-writes.js');
const winRuntimeExists = (runtime, exists) =>
{
    const native = runtime.replace(MOUNT_RE, (m, d) => `${d.toUpperCase()}:`);
    return exists(native) || exists(`${native}.exe`);
};

// absent | current | stale | foreign. Current = a shape claude-hud 0.8.0 writes on this platform,
// whose runtime (and on Windows, whose launcher) is on disk.
function classify(statusLine, { platform, want, exists })
{
    if (statusLine !== undefined && (statusLine === null || typeof statusLine !== 'object' || Array.isArray(statusLine)))
        return { state: 'foreign', label: 'custom' };
    const command = statusLine && typeof statusLine.command === 'string' ? statusLine.command : '';
    if (!command.trim()) return { state: 'absent' };
    if (!command.includes(HUD)) return { state: 'foreign', label: sourceLabel(command) };
    const win = platform === 'win32';
    // Windows takes node only (setup.md:128, :153), never the awk form (setup.md:194), and only the
    // form of the shell that will run it: a bash line cannot run without Git Bash, a cmd line under it.
    const shapes = !win ? [[SORT_V, 'dist/index.js'], [AWK_NODE, 'dist/index.js'], [AWK_BUN, 'src/index.ts']]
        : want.shell === 'bash' ? [[SORT_V, 'dist/index.js']] : [[CMD, '']];
    for (const [shape, source] of shapes)
    {
        const m = shapeRe(shape, source).exec(command);
        if (!m) continue;
        if (shape === CMD)
        {
            const [, , runtime, wrapper] = m;
            if (exists(runtime) && wrapper.toLowerCase() === want.launcher.wrapper.toLowerCase() && exists(want.launcher.file)) return { state: 'current' };
        }
        else if (win ? winRuntimeExists(m[1], exists) : exists(m[1])) return { state: 'current' };
    }
    return { state: 'stale' };
}

const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// Installed = registered in the account's installed_plugins.json AND a runnable version in its cache
// (the version dirs the launcher accepts, setup.md:250 and :277). The user's OFF wins.
function hudInstall(configDir, settings)
{
    const reg = readJsonFile(path.join(configDir, 'plugins', 'installed_plugins.json'));
    const rows = (reg && reg.plugins && typeof reg.plugins === 'object') ? reg.plugins : {};
    const ids = Object.keys(rows).filter((id) => id.split('@')[0] === HUD && Array.isArray(rows[id]) && rows[id].length);
    const none = 'claude-hud is not installed in this account';
    if (!ids.length) return { ok: false, why: none };
    const enabled = (settings && settings.enabledPlugins) || {};
    if (ids.every((id) => enabled[id] === false)) return { ok: false, why: 'claude-hud is switched off in this account' };
    const cache = path.join(configDir, 'plugins', 'cache');
    let versions = [];
    try
    {
        for (const market of fs.readdirSync(cache))
        {
            let names = [];
            try { names = fs.readdirSync(path.join(cache, market, HUD)); }
            catch { continue; }
            for (const v of names)
                if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(v) && fs.existsSync(path.join(cache, market, HUD, v, 'dist', 'index.js'))) versions.push(v);
        }
    }
    catch { versions = []; }
    if (!versions.length) return { ok: false, why: `${none} (registered, but its plugin cache holds no version to run)` };
    return { ok: true };
}

function resolveConfigDir({ flag, space, env = process.env })
{
    if (flag) return path.resolve(flag);
    // The installer's own check (args.js): --space is baked into a directory name.
    if (space && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(space)) throw new Error(`--space '${space}' must start alphanumeric; chars [A-Za-z0-9._-]`);
    return accountDir(env, space || '');
}

// The statusLine block as the run writes it: the command set, every other key the user had kept.
function lineAfter(doc, command)
{
    const prior = doc && doc.statusLine && typeof doc.statusLine === 'object' && !Array.isArray(doc.statusLine) ? doc.statusLine : {};
    return { ...prior, type: 'command', command };
}

// What the row adds, for the plan line: 'adds 13 claude-hud keys: lineLayout, display (8), ...'.
function addsNote(targets)
{
    const groups = new Map();
    for (const t of targets)
        for (const r of t.skipped ? [] : t.rows.filter((row) => row.status === 'missing'))
        {
            const [head, ...rest] = r.key.split('.');
            const g = groups.get(head) || { keys: [] };
            g.keys.push(rest.length ? r.key : head);
            groups.set(head, g);
        }
    const n = [...groups.values()].reduce((sum, g) => sum + g.keys.length, 0);
    if (!n) return '';
    const names = [...groups.entries()].map(([head, g]) => (g.keys.length > 1 ? `${head} (${g.keys.length})` : g.keys[0]));
    return `adds ${n} claude-hud key${n === 1 ? '' : 's'}: ${names.join(', ')}`;
}

// Everything the run would do, nothing written. `item` is init-plan's machine line state: skip,
// blocked, missing, refresh (a claude-hud line of a stale shape will be replaced) or present.
function planHud({ configDir, platform = process.platform, env = process.env, runtime = nodeOnPath(env, platform), exists = fs.existsSync, cwd = process.cwd(), catalog })
{
    const settingsFile = path.join(configDir, 'settings.json');
    const settings = readDoc(settingsFile);
    const plan = { configDir, platform, settingsFile, settings, changes: 0 };
    plan.install = hudInstall(configDir, settings.doc);
    if (!plan.install.ok) return { ...plan, item: { state: 'skip', detail: plan.install.why } };
    if (settings.bad)
    {
        plan.error = `${settingsFile} is not valid JSON`;
        return { ...plan, item: { state: 'blocked', detail: `${plan.error} - fix it, then run /alfred-code:init again` } };
    }
    const bash = platform === 'win32' && gitBash(env, exists, cwd);
    const want = expected({ platform, configDir, runtime, env, exists, bash });
    const statusLine = settings.doc ? settings.doc.statusLine : undefined;
    plan.statusLine = { ...classify(statusLine, { platform, want, exists }), command: want.command, launcher: want.launcher };
    plan.entry = (catalog || readJsonFile(CATALOG) || { plugins: {} }).plugins[HUD] || { targets: [] };
    plan.writesLine = ['absent', 'stale'].includes(plan.statusLine.state);
    // The row as it lands AFTER the statusLine write, which its refresh interval is gated on.
    plan.targets = rowTargets(plan, plan.writesLine ? { 'settings.json': { ...(settings.doc || {}), statusLine: lineAfter(settings.doc, want.command) } } : {});
    plan.changes = (plan.writesLine ? 1 : 0) + (plan.writesLine && want.launcher ? 1 : 0)
        + plan.targets.reduce((n, t) => n + (t.skipped ? 0 : t.rows.filter((r) => r.status === 'missing').length), 0);
    const note = addsNote(plan.targets);
    if (plan.changes) plan.item = { state: plan.statusLine.state === 'stale' ? 'refresh' : 'missing', detail: null, note };
    else if (plan.statusLine.state === 'foreign')
        plan.item = { state: 'skip', detail: `the account statusLine is not claude-hud's (source: ${plan.statusLine.label}) - kept; /claude-hud:setup replaces it` };
    else plan.item = { state: 'present', detail: '' };
    return plan;
}

// The claude-hud row as plugin-settings plans it - minus the settings.json patch on a line that is
// not claude-hud's: a refresh interval would re-run the user's own command on a timer.
function rowTargets(plan, overlay = {})
{
    return planFor(plan.entry, plan.configDir, overlay).map((t) => (plan.statusLine.state === 'foreign' && t.file === 'settings.json'
        ? { ...t, rows: [], skipped: 'the statusLine is not claude-hud\'s - no refresh interval is added to it' }
        : t));
}

// `run` is this run's backup state (plugin-settings.js backupOnce): `now` and `copy` for tests.
function applyHud(plan, run = {})
{
    if (!plan.install.ok) return { code: 0, lines: [`hud: skipped - ${plan.install.why}`] };
    if (plan.error) return { code: 1, lines: [`hud: blocked - ${plan.error} - nothing written; fix it and run this again`] };
    const lines = [];
    let changes = 0;
    const sl = plan.statusLine;
    // The account settings.json is copied before the run's first write to it (setup.md:487-505).
    if (plan.writesLine || plan.targets.some((t) => t.file === 'settings.json' && !t.skipped && t.rows.some((r) => r.status === 'missing')))
    {
        try
        {
            const bak = backupOnce(plan.settingsFile, run);
            if (bak) lines.push(`hud: backup - ${bak}`);
        }
        catch (e)
        {
            if (!e.backup) throw e;
            return { code: 1, lines: [`hud: blocked - ${e.message} - nothing written; fix it and run this again`] };
        }
    }
    if (plan.writesLine)
    {
        if (sl.launcher)
        {
            fs.mkdirSync(path.dirname(sl.launcher.file), { recursive: true });
            fs.writeFileSync(sl.launcher.file, LAUNCHER);
            lines.push(`hud: launcher written - ${sl.launcher.file}`);
            changes += 1;
        }
        const doc = plan.settings.doc || {};
        doc.statusLine = lineAfter(doc, sl.command);
        fs.mkdirSync(plan.configDir, { recursive: true });
        fs.writeFileSync(plan.settingsFile, JSON.stringify(doc, null, 2) + '\n');
        lines.push(sl.state === 'absent'
            ? 'hud: statusLine written - claude-hud\'s own shape for this platform'
            : 'hud: statusLine refreshed - the claude-hud line had a stale shape; its other keys kept');
        changes += 1;
    }
    else if (sl.state === 'current') lines.push('hud: statusLine current - left as it is');
    else lines.push(`hud: statusLine kept - it is not claude-hud's (source: ${sl.label}); /claude-hud:setup replaces it, backing yours up first`);

    // Re-planned after the statusLine write: the row's refresh interval is gated on that block.
    const targets = rowTargets(plan);
    const applied = applyTargets(targets, false, run);
    changes += applied.changed;
    lines.push(...report([HUD], { [HUD]: rowTargets(plan) }, { applied }).text.split('\n').filter(Boolean));
    lines.push(`hud-statusline: ${changes} change(s)`);
    return { code: 0, lines };
}

const USAGE = 'usage: node scripts/hud-statusline.js [--config-dir <dir> | --space <name>] [--catalog <file>]';

// Strict: a flag this script does not know, one without a value, the `--flag=value` form or a flag
// given twice throws - never read as absent, which would fall back to the environment's account.
function parseArgs(argv)
{
    const known = ['--config-dir', '--space', '--catalog'];
    const args = {};
    for (let i = 0; i < argv.length; i += 1)
    {
        const a = argv[i];
        if (!known.includes(a)) throw new Error(`unknown argument '${a}'`);
        if (Object.hasOwn(args, a)) throw new Error(`${a} is given twice`);
        const v = argv[i + 1];
        if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${a} needs a value`);
        args[a] = v;
        i += 1;
    }
    return args;
}

function main(argv, { env = process.env, out = (s) => process.stdout.write(s) } = {})
{
    let configDir;
    let catalog = null;
    try
    {
        const args = parseArgs(argv);
        configDir = resolveConfigDir({ flag: args['--config-dir'], space: args['--space'], env });
        if (args['--catalog'] && !(catalog = readJsonFile(args['--catalog']))) throw new Error(`--catalog ${args['--catalog']} is not readable JSON`);
    }
    catch (e) { out(`hud: ${e.message} - nothing written; ${USAGE}\n`); return 2; }
    const res = applyHud(planHud({ configDir, env, catalog }));
    for (const line of res.lines) out(`${line}\n`);
    return res.code;
}

module.exports = { SHAPES, LAUNCHER, fill, classify, expected, sourceLabel, gitBash, nodeOnPath, hudInstall, resolveConfigDir, planHud, applyHud, parseArgs, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
