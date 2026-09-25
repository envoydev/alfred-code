#!/usr/bin/env node
'use strict';
// hud-statusline.js - claude-hud arrives CONFIGURED: /alfred-code:init's claude-hud item, made
// deterministic instead of a model walk through claude-hud's own /claude-hud:setup.
//
//   node scripts/hud-statusline.js [--config-dir <dir> | --space <name>] [--catalog <file>]
//
// Two writes into the ACCOUNT dir (CLAUDE_CONFIG_DIR, else ~/.claude-<space>, else ~/.claude - the
// installer's rule, stamp.js accountDir), both add-only:
//   1. settings.json `statusLine` - the command claude-hud 0.8.0's setup writes for a Node runtime.
//      No statusLine: written. claude-hud's own line in a current shape: left as it is. claude-hud's
//      line in a stale shape (a pinned version path, the old PowerShell wrapper, a runtime that is
//      gone): its command refreshed, every other key kept. A line that is NOT claude-hud's: kept and
//      reported with the /claude-hud:setup line, never replaced and never given a refresh interval.
//   2. the claude-hud row of meta/plugin-settings.json (the Compact layout among it), through
//      plugin-settings.js - after the statusLine, because the row's refresh interval needs that block.
// claude-hud not installed, or switched off by the user: one skip line, nothing written. An account
// settings.json that is not a JSON object: one blocked line, nothing written, exit 1.
//
// The shapes below are claude-hud 0.8.0's (commands/setup.md; MIT, Copyright (c) 2026 Jarrod Watts),
// kept byte for byte so a line /claude-hud:setup wrote reads as current here, and ours there.
const fs = require('node:fs');
const path = require('node:path');

const { accountDir } = require('./install/stamp.js');
const { planFor, applyTargets, report, readDoc } = require('./plugin-settings.js');

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

// What this platform's line should be. `launcher` is the file Windows needs beside it.
function expected({ platform, configDir, runtime, env, exists })
{
    if (platform !== 'win32') return { command: fill(SORT_V, { RUNTIME_PATH: runtime, SOURCE: 'dist/index.js' }), launcher: null };
    const wrapper = path.win32.join(configDir, 'plugins', HUD, 'statusline.mjs');
    return {
        command: fill(CMD, { CMD_PATH: cmdPath(env, exists), RUNTIME_PATH: runtime, WRAPPER_PATH: wrapper }),
        launcher: { file: path.join(configDir, 'plugins', HUD, 'statusline.mjs'), wrapper },
    };
}

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
    const shapes = win
        // Windows takes node only (setup.md:128, :153) and never the awk form (setup.md:194).
        ? [[CMD, ''], [SORT_V, 'dist/index.js']]
        : [[SORT_V, 'dist/index.js'], [AWK_NODE, 'dist/index.js'], [AWK_BUN, 'src/index.ts']];
    for (const [shape, source] of shapes)
    {
        const m = shapeRe(shape, source).exec(command);
        if (!m) continue;
        if (shape === CMD)
        {
            const [, , runtime, wrapper] = m;
            if (exists(runtime) && wrapper.toLowerCase() === want.launcher.wrapper.toLowerCase() && exists(want.launcher.file)) return { state: 'current' };
        }
        else if (exists(m[1])) return { state: 'current' };
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

// Everything the run would do, nothing written. `item` is init-plan's machine line state.
function planHud({ configDir, platform = process.platform, runtime = process.execPath, env = process.env, exists = fs.existsSync, catalog })
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
    const want = expected({ platform, configDir, runtime, env, exists });
    const statusLine = settings.doc ? settings.doc.statusLine : undefined;
    plan.statusLine = { ...classify(statusLine, { platform, want, exists }), command: want.command, launcher: want.launcher };
    plan.entry = (catalog || readJsonFile(CATALOG) || { plugins: {} }).plugins[HUD] || { targets: [] };
    plan.targets = rowTargets(plan);
    const writesLine = ['absent', 'stale'].includes(plan.statusLine.state);
    plan.changes = (writesLine ? 1 : 0) + (writesLine && want.launcher ? 1 : 0)
        + plan.targets.reduce((n, t) => n + (t.skipped ? 0 : t.rows.filter((r) => r.status === 'missing').length), 0);
    if (plan.changes) plan.item = { state: 'missing', detail: null };
    else if (plan.statusLine.state === 'foreign')
        plan.item = { state: 'skip', detail: `the account statusLine is not claude-hud's (source: ${plan.statusLine.label}) - kept; /claude-hud:setup replaces it` };
    else plan.item = { state: 'present', detail: '' };
    return plan;
}

// The claude-hud row as plugin-settings plans it - minus the settings.json patch on a line that is
// not claude-hud's: a refresh interval would re-run the user's own command on a timer.
function rowTargets(plan)
{
    return planFor(plan.entry, plan.configDir).map((t) => (plan.statusLine.state === 'foreign' && t.file === 'settings.json'
        ? { ...t, rows: [], skipped: 'the statusLine is not claude-hud\'s - no refresh interval is added to it' }
        : t));
}

function applyHud(plan)
{
    if (!plan.install.ok) return { code: 0, lines: [`hud: skipped - ${plan.install.why}`] };
    if (plan.error) return { code: 1, lines: [`hud: blocked - ${plan.error} - nothing written; fix it and run this again`] };
    const lines = [];
    let changes = 0;
    const sl = plan.statusLine;
    if (sl.state === 'absent' || sl.state === 'stale')
    {
        if (sl.launcher)
        {
            fs.mkdirSync(path.dirname(sl.launcher.file), { recursive: true });
            fs.writeFileSync(sl.launcher.file, LAUNCHER);
            lines.push(`hud: launcher written - ${sl.launcher.file}`);
            changes += 1;
        }
        const doc = plan.settings.doc || {};
        const prior = doc.statusLine && typeof doc.statusLine === 'object' && !Array.isArray(doc.statusLine) ? doc.statusLine : {};
        doc.statusLine = { ...prior, type: 'command', command: sl.command };
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
    const applied = applyTargets(targets, false);
    changes += applied.changed;
    lines.push(...report([HUD], { [HUD]: rowTargets(plan) }, { applied }).text.split('\n').filter(Boolean));
    lines.push(`hud-statusline: ${changes} change(s)`);
    return { code: 0, lines };
}

function main(argv, { env = process.env, out = (s) => process.stdout.write(s) } = {})
{
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
    let configDir;
    try { configDir = resolveConfigDir({ flag: flag('--config-dir'), space: flag('--space'), env }); }
    catch (e) { out(`hud: ${e.message}\n`); return 2; }
    const catalog = flag('--catalog') ? readJsonFile(flag('--catalog')) : null;
    const res = applyHud(planHud({ configDir, env, catalog }));
    for (const line of res.lines) out(`${line}\n`);
    return res.code;
}

module.exports = { SHAPES, LAUNCHER, fill, classify, expected, sourceLabel, hudInstall, resolveConfigDir, planHud, applyHud, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
