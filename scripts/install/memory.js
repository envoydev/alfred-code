'use strict';
// THE MEMORY LAYER - which database this install points at, and the one-time handover.
//
// The `memory` MCP is the SHARED memory: preferences, corrections, project facts and agent lessons,
// searchable by meaning, read by every Claude account and by Cursor at the chosen LEVEL. Claude's
// own built-in memory has no search and is not shared with Cursor, which is why the MCP REPLACES it
// rather than sitting beside it.
//
// The switch-off is gated, and the gate is the whole design:
//
//   - THE IMPORT COMES FIRST. `autoMemoryEnabled: false` is written only AFTER the project's
//     existing MEMORY.md / memory/*.md notes are in the database. A failed import leaves Claude's
//     own memory ON and says so - never retried into a false success - and the old files are never
//     deleted either way.
//   - THE REPLACEMENT MUST BE COMPLETE: the memory server in this run's MCP set AND
//     `baseline-memory.md` (the rule that tells Claude to save to it) both selected AND on disk.
//     Without either, the notes stay where Claude reads them.
//   - THE SWITCH-OFF IS WRITTEN TO THIS PROJECT'S OWN settings file, never the account one (that
//     would silence every other project's memory too) - and, per R47, to the SAME file this run's
//     other settings writes use: settings.local.json at local scope, settings.json otherwise
//     (settingsTarget in settings.js is the one place that decides which).
const fs = require('node:fs');
const path = require('node:path');

const MEMORY_DIR = '.memory-mcp';

// Mirrors the memory.js hook engine's pathForLevel. Three shapes, nothing else.
function pathForLevel(level, { home, space, projectRoot })
{
    const dir = path.join(home, MEMORY_DIR);
    if (level === 'global') return path.join(dir, 'memory.db');
    if (level === 'scoped') return path.join(dir, `memory_${space || 'default'}.db`);
    if (level === 'project') return projectRoot ? path.join(projectRoot, MEMORY_DIR, 'memory.db') : '';
    return '';
}

// The inverse, matching one of the three shapes EXACTLY - never a prefix or substring match, so a
// foreign path is never mistaken for one of ours. '' when it is none of them.
function levelOfPath(p, { home, projectRoot })
{
    if (!p) return '';
    const norm = path.normalize(p);
    if (projectRoot && norm === path.normalize(path.join(projectRoot, MEMORY_DIR, 'memory.db'))) return 'project';
    const dir = path.join(home, MEMORY_DIR);
    if (norm === path.join(dir, 'memory.db')) return 'global';
    if (path.dirname(norm) === dir && /^memory_.+\.db$/.test(path.basename(norm))) return 'scoped';
    return '';
}

// --memory-level, resolved. GIVEN: that level's default path. ABSENT: an EXISTING registration
// keeps its MCP_MEMORY_SQLITE_PATH byte-for-byte - only the runtime extra and the pragmas are
// upgraded, never the path - and with no registration at all it is `global`. A level change never
// copies or deletes a database: whichever file the old memories are in stays there, which is why
// the caller's log line names both.
function resolveLevel({ flag, registeredPath, home, space, projectRoot })
{
    if (flag) return { level: flag, dbPath: pathForLevel(flag, { home, space, projectRoot }), from: 'flag' };
    if (registeredPath)
    {
        const level = levelOfPath(registeredPath, { home, projectRoot });
        return { level: level || 'custom', dbPath: registeredPath, from: 'registration' };
    }
    return { level: 'global', dbPath: pathForLevel('global', { home, space, projectRoot }), from: 'default' };
}

// 'true' / 'false' / 'absent' / 'malformed'. A missing file is 'absent' - nothing has switched
// Claude's own memory off yet.
function autoMemoryState(settingsFile)
{
    let raw;
    try { raw = fs.readFileSync(settingsFile, 'utf8'); }
    catch (err) { return err.code === 'ENOENT' ? 'absent' : 'malformed'; }
    let data;
    try { data = raw.trim() ? JSON.parse(raw) : {}; }
    catch { return 'malformed'; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'malformed';
    return Object.hasOwn(data, 'autoMemoryEnabled') ? String(data.autoMemoryEnabled) : 'absent';
}

// Merge the key in, leaving every other key untouched. REFUSES on a file that does not parse as a
// JSON object: the install continues, and the user's file is not overwritten.
function writeSwitchOff(settingsFile, { log = () => {} } = {})
{
    let data = {};
    try
    {
        const raw = fs.readFileSync(settingsFile, 'utf8');
        if (raw.trim()) data = JSON.parse(raw);
    }
    catch (err)
    {
        if (err.code !== 'ENOENT')
        {
            log(`  !! ${settingsFile} is not valid JSON - autoMemoryEnabled left untouched; fix it and re-run`);
            return false;
        }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
    {
        log(`  !! ${settingsFile} top level is not an object - autoMemoryEnabled left untouched`);
        return false;
    }
    data.autoMemoryEnabled = false;
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    log(`  ${path.basename(settingsFile)}: autoMemoryEnabled set to false (${settingsFile})`);
    return true;
}

// Everything that has to hold before Claude's own memory may go off. Returns `{ go: true }` or a
// reason - one sentence, already phrased for the log, because every 'no' here ends with Claude's
// own memory staying ON and the user needs to know which condition failed.
function importGate({ projectRoot, settingsFile, mcps = [], rules = [], tools = {} })
{
    if (!projectRoot)
        return { go: false, reason: "memory: global install scope with no identifiable project (not inside a git repo) - skipping the notes import; Claude's own memory stays on" };

    const state = autoMemoryState(settingsFile);
    if (state === 'false') return { go: false, already: true };   // already off - never re-run

    const name = (e) => (typeof e === 'string' ? e.split(/[|:]/)[0] : e.name || e.file);
    if (!mcps.some((e) => name(e) === 'memory'))
        return { go: false, reason: "memory: the notes import was skipped - the memory MCP is not part of this install; Claude's own memory stays on" };
    if (!rules.some((e) => name(e) === 'baseline-memory.md'))
        return { go: false, reason: "memory: the notes import was skipped - baseline-memory.md is not part of this install; Claude's own memory stays on" };
    if (!fs.existsSync(path.join(projectRoot, '.claude', 'rules', 'baseline-memory.md')))
        return { go: false, reason: `  !! memory: baseline-memory.md did not land in ${path.join(projectRoot, '.claude', 'rules')} - the notes import was skipped; Claude's own memory stays on until a run delivers it` };

    for (const [tool, present] of Object.entries(tools))
        if (!present) return { go: false, reason: `  !! ${tool} not found - the memory notes import was skipped; Claude's own memory stays on until it succeeds` };

    return { go: true };
}

// The import, then the switch-off - in that order, and the second only if the first succeeded.
// `runImport` returns { ok, output }: the importer's own lines - its count, or WHY it failed - are
// logged as the twins print them, before the verdict. Swallowed, a failure read 'import failed' with
// no reason (1.0.0's plugin-route miss did).
function importNotes({ gate, importer, runImport, settingsFile, log = () => {} })
{
    if (!gate.go)
    {
        if (gate.reason) log(gate.reason);
        return { switchedOff: Boolean(gate.already), imported: false };
    }
    if (!importer || !fs.existsSync(importer))
    {
        log(`  !! ${importer} not found in the source snapshot - memory notes import skipped`);
        return { switchedOff: false, imported: false };
    }
    log("memory: importing Claude's existing notes into the memory MCP (first run downloads the embedding model, ~1 min)");
    const res = runImport() || {};
    for (const line of String(res.output || '').split('\n').map((l) => l.trim()).filter(Boolean)) log(`  ${line}`);
    if (!res.ok)
    {
        log("  !! memory notes import failed - Claude's own memory stays ON until a later run imports successfully");
        return { switchedOff: false, imported: false };
    }
    return { switchedOff: writeSwitchOff(settingsFile, { log }), imported: true };
}

// --- /alfred-code:init's memory step --------------------------------------------
//
//   node scripts/install/memory.js init --project-root <root> --level <global|scoped|project>
//        [--space <name>] [--config-dir <dir>] [--memory-dir <dir>]
//
// setup installs with no level (the import waits); init asks it and lands it HERE - the settings key
// the plugin's launcher reads, the project database's own .gitignore, then the gated import and the
// switch-off above. No reinstall: nothing else under .claude/ is touched. A copy-route registration
// in .mcp.json is the installer's to re-point, so a different path there is refused, never edited.
// Exit 0: imported, already off, or nothing to import. 1: a refusal or a failed import. 2: usage.
const USAGE = 'usage: memory.js init --project-root <root> --level <global|scoped|project> [--space <name>] [--config-dir <dir>] [--memory-dir <dir>]';

function readObject(file)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { return err.code === 'ENOENT' ? { data: null } : { error: `${file} cannot be read` }; }
    try
    {
        const data = raw.trim() ? JSON.parse(raw) : {};
        return data && typeof data === 'object' && !Array.isArray(data) ? { data } : { error: `${file} top level is not an object` };
    }
    catch { return { error: `${file} is not valid JSON` }; }
}

// The `scope:` line of this project's stamp (2.x, else the 1.x name), '' when there is none.
function stampScope(claudeDir)
{
    for (const name of ['alfred-code.stamp', 'claude-stack.stamp']) // legacy-name
    {
        try { return (/^scope: *(\S+)/m.exec(fs.readFileSync(path.join(claudeDir, name), 'utf8')) || [])[1] || ''; }
        catch { /* absent: the next name */ }
    }
    return '';
}

function initMemory(argv, { which, runNode, homedir, log = console.log, err = console.error })
{
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const level = String(flag('--level') || '').toLowerCase();
    const root = flag('--project-root');
    if (!root || !['global', 'scoped', 'project'].includes(level))
    {
        err(`memory init: ${root ? '--level must be global, scoped or project' : '--project-root is required'}\n${USAGE}`);
        return 2;
    }
    const projectRoot = path.resolve(root);
    const home = homedir();
    const dbPath = pathForLevel(level, { home, space: flag('--space'), projectRoot });
    const claudeDir = path.join(projectRoot, '.claude');

    const registered = (readObject(path.join(projectRoot, '.mcp.json')).data || {}).mcpServers?.memory?.env?.MCP_MEMORY_SQLITE_PATH;
    if (registered && path.normalize(registered) !== path.normalize(dbPath))
    {
        log(`  !! memory: .mcp.json registers memory at ${registered} - the copy route re-points it through the installer: /alfred-code:update --memory-level ${level}`);
        return 1;
    }

    // The key, and the switch-off after it, go to the file this install's other settings writes use
    // (R47): the stamp's scope names it; with no readable stamp, the file that already holds the key.
    const local = path.join(claudeDir, 'settings.local.json');
    const localRead = readObject(local);
    const scope = stampScope(claudeDir);
    const target = scope ? require('./settings.js').settingsTarget(claudeDir, scope)
        : (localRead.data && localRead.data.env && localRead.data.env.ALFRED_CODE_MEMORY_DB !== undefined ? local : path.join(claudeDir, 'settings.json'));
    const read = target === local ? localRead : readObject(target);
    if (read.error)
    {
        log(`  !! ${read.error} - the memory level was not written; fix it and run /alfred-code:init again`);
        return 1;
    }
    const data = read.data || {};
    data.env = data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {};
    if (data.env.ALFRED_CODE_MEMORY_DB !== dbPath)
    {
        data.env.ALFRED_CODE_MEMORY_DB = dbPath;
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
    }
    log(`memory: level ${level} -> ${dbPath} (${path.basename(target)} env ALFRED_CODE_MEMORY_DB)`);
    if (level === 'project')
    {
        const ignore = path.join(projectRoot, MEMORY_DIR, '.gitignore');
        if (!fs.existsSync(ignore)) { fs.mkdirSync(path.dirname(ignore), { recursive: true }); fs.writeFileSync(ignore, '*\n'); }
    }

    const settingsFile = target;
    const gate = importGate({ projectRoot, settingsFile, mcps: ['memory'], rules: ['baseline-memory.md'], tools: { uvx: which('uvx') } });
    const importer = path.join(__dirname, '..', 'memory-import.js');
    const pass = ['--config-dir', '--memory-dir'].flatMap((name) => (flag(name) ? [name, flag(name)] : []));
    const out = importNotes({
        gate, importer, settingsFile, log,
        runImport: () =>
        {
            const r = runNode(importer, ['--project-root', projectRoot, ...pass], { cwd: projectRoot, env: process.env });
            return { ok: r.ok, output: `${r.stdout}\n${r.stderr}` };
        },
    });
    if (gate.already) log("memory: Claude's own memory is already off - nothing to import again");
    return out.switchedOff ? 0 : 1;
}

module.exports = { MEMORY_DIR, pathForLevel, levelOfPath, resolveLevel, autoMemoryState, writeSwitchOff, importGate, importNotes, initMemory };

if (require.main === module)
{
    const argv = process.argv.slice(2);
    if (argv[0] !== 'init') { console.error(USAGE); process.exit(2); }
    const { which, runNode } = require('./runtime.js');
    process.exit(initMemory(argv.slice(1), { which, runNode, homedir: require('node:os').homedir }));
}
