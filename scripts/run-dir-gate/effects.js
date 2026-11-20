'use strict';
// The run-dir gate's one touch of the outside world: it reads the setup bodies and the table, the run dirs, the marker and
// the git top, writes the table and the block row, and answers on stdout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BODY_DIRS, TABLE_FILE, GENERATED_BY, TABLE_NOTE, SESSION_FILE, WIN32, EFFECTS, HOOK_FILE, EVENT, TOOL, BLOCK_BRANCH, BLOCK_REASON_MAX, VERDICT } = require('./constants.js');
const { buildTable } = require('./table.js');
const { findRunDirs, mapRunDir } = require('./dirs.js');
const { markerName } = require('./marker.js');
const { accountDirOf } = require('./account.js');
const { decide, hookOutput } = require('./verdict.js');

// Every markdown body under the setup folders, in a stable order.
function readBodies(root)
{
    const files = [];
    const walk = (dir) =>
    {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(EFFECTS.markdownSuffix)) files.push({ file: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, EFFECTS.textEncoding) });
        }
    };
    for (const dir of BODY_DIRS) walk(path.join(root, dir));
    return files;
}

const tableText = (table) => `${JSON.stringify({ generatedBy: GENERATED_BY, note: TABLE_NOTE, ...table }, null, 2)}\n`;

// Writes the table, or with `check` reports whether the file on disk is current. Returns { file, current }.
function writeTable(root, { check = false } = {})
{
    const file = path.join(root, TABLE_FILE);
    const want = tableText(buildTable(readBodies(root)));
    let have = '';
    try { have = fs.readFileSync(file, EFFECTS.textEncoding); } catch { have = ''; }
    if (!check && have !== want) fs.writeFileSync(file, want);
    return { file: TABLE_FILE, current: have === want };
}

function readTable(root)
{
    try { return JSON.parse(fs.readFileSync(path.join(root, TABLE_FILE), EFFECTS.textEncoding)); } catch { return { resolves: [], scripts: {} }; }
}

const ownedBy = (stat) => process.platform === WIN32 || typeof process.getuid !== 'function' || stat.uid === process.getuid();

// The session a run dir holds and whether this user owns it; null when the dir cannot be read.
function readRunDir(dirPath)
{
    let stat;
    try { stat = fs.statSync(dirPath); } catch { return null; }
    if (!stat.isDirectory()) return null;
    let session = '';
    try { session = fs.readFileSync(path.join(dirPath, SESSION_FILE), EFFECTS.textEncoding).trim(); } catch { session = ''; }
    return { session, owned: ownedBy(stat) };
}

const quiet = (command, args, options = {}) => spawnSync(command, args, { encoding: EFFECTS.textEncoding, windowsHide: true, timeout: EFFECTS.toolTimeoutMs, ...options });

function cygpathW(text)
{
    try
    {
        const run = quiet(EFFECTS.cygpath.command, [EFFECTS.cygpath.flag, text]);
        const mapped = run.status === 0 ? String(run.stdout).trim() : '';
        return mapped || null;
    }
    catch { return null; }
}

// The project root the resolve block names its marker by: the git top of the cwd, else the cwd.
function markerRoot(cwd, env)
{
    try
    {
        const { command, args, noLocksKey, noLocks } = EFFECTS.git;
        const run = quiet(command, args, { cwd, env: { ...env, [noLocksKey]: noLocks } });
        const top = run.status === 0 ? String(run.stdout).replace(/\n+$/, '') : '';
        return top || cwd;
    }
    catch { return cwd; }
}

function markerPathFor(cwd, env)
{
    const temp = String(env[EFFECTS.tempDirKey] || EFFECTS.tempFallback).replace(/\/$/, '');
    return `${temp}/${markerName(markerRoot(cwd, env))}`;
}

// The project's run marker: its path, the dir it names (and that dir's real path), that dir's session, and whether this user owns both. Null when the
// marker is absent, empty or unreadable.
function findMarker(cwd, env)
{
    const markerPath = markerPathFor(cwd, env);
    let stat;
    let dir;
    try
    {
        stat = fs.statSync(markerPath);
        dir = fs.readFileSync(markerPath, EFFECTS.textEncoding).split('\n')[0].trim();
    }
    catch { return null; }
    if (!dir) return null;
    const mapped = mapRunDir(dir, process.platform, cygpathW);
    const info = mapped ? readRunDir(mapped) : null;
    return { path: markerPath, dir, realDir: mapped ? realOf(mapped) : dir, session: info ? info.session : '', owned: Boolean(info) && info.owned && ownedBy(stat) };
}

// The real path of a text, falling back to the text itself when it cannot be resolved.
function realOf(text)
{
    try { return fs.realpathSync.native(text); } catch { return text; }
}

const foldOnWindows = (text) => (process.platform === WIN32 ? text.toLowerCase() : text);

// Whether a dir's real parent is the hook's own temp dir: the real path of TMPDIR, else the OS's temp dir.
const sitsInTemp = (mapped, env) => foldOnWindows(realOf(path.dirname(mapped))) === foldOnWindows(realOf(env[EFFECTS.tempDirKey] || os.tmpdir()));

const dirInfo = (raw, env) =>
{
    const mapped = mapRunDir(raw, process.platform, cygpathW);
    const info = mapped ? readRunDir(mapped) : null;
    return { raw, path: mapped, real: mapped ? realOf(mapped) : null, inTemp: Boolean(info) && sitsInTemp(mapped, env), session: info ? info.session : '', owned: info ? info.owned : false };
};

// The verdict for one Bash payload: gathers the dirs, the marker and the table, then asks `decide`.
function judge(payload, env, pluginRoot)
{
    const command = payload && payload.tool_input && payload.tool_input.command;
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const dirs = findRunDirs(command).map((raw) => dirInfo(raw, env));
    const table = readTable(pluginRoot);
    const account = dirs.length ? accountDirOf(env, process.platform) : null;
    const accountPath = account ? mapRunDir(account, process.platform, cygpathW) : null;
    const ctx = { runDir: dirs.length ? dirs[0].path || '' : '', cwd, pluginRoot, scripts: table.scripts, markerPath: dirs.length ? markerPathFor(cwd, env) : null, accountDir: account, accountDirReal: accountPath ? realOf(accountPath) : null };
    const marker = dirs.length ? findMarker(cwd, env) : null;
    return decide({ command, table, sessionId: typeof payload.session_id === 'string' ? payload.session_id : '', dirs, marker, ctx });
}

const dataRootOf = (env) =>
{
    const raw = String(env[EFFECTS.dataPathKey] || '').trim().replace(/\\/g, '/');
    return EFFECTS.absoluteDataPath.test(raw) ? raw.replace(/\/+$/, '') || EFFECTS.dataRoot : EFFECTS.dataRoot;
};

// One block row in the hook-blocks ledger, in the shape guard-layer-table.js writes. Best-effort: telemetry never breaks the gate.
function appendBlockRow(payload, reason, env)
{
    try
    {
        const project = path.resolve(env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), dataRootOf(env), EFFECTS.statisticsDir, EFFECTS.blocksDir);
        const session = String(payload.session_id || EFFECTS.noSession).replace(EFFECTS.unsafeSessionChar, '_');
        fs.mkdirSync(project, { recursive: true });
        const row = { ts: new Date().toISOString(), hook: HOOK_FILE, event: EVENT, tool: payload.tool_name || TOOL, reason: reason.slice(0, BLOCK_REASON_MAX), detail: { branch: BLOCK_BRANCH } };
        fs.appendFileSync(path.join(project, `${session}.jsonl`), `${JSON.stringify(row)}\n`);
    }
    catch { /* telemetry never breaks the gate */ }
}

// Answers on stdout for a verdict; a deny also leaves its block row where the repo is set up (`record`).
function emit(verdict, payload, { record, env })
{
    const output = hookOutput(verdict);
    if (!output) return;
    if (verdict.decision === VERDICT.deny && record) appendBlockRow(payload, verdict.reason, env);
    process.stdout.write(JSON.stringify(output));
}

module.exports = { readBodies, writeTable, readRunDir, findMarker, markerPathFor, cygpathW, appendBlockRow, judge, emit };
