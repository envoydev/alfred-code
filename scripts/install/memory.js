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

// The folder is `.alfred-memory` wherever it sits (Task 7a): ~/.alfred-memory for the global and scoped
// levels, <project>/<data root>/.alfred-memory for the project level. stack/mcp/data-root.js is the one
// home of the shapes - the launcher, this layer and (inline, since it ships alone) the hook engine agree.
const dataRoot = require('../../stack/mcp/data-root.js');
const MEMORY_DIR = dataRoot.MEMORY_FOLDER;

// Three shapes, nothing else. `root` is the project's data root (ALFRED_CODE_DATA_PATH).
function pathForLevel(level, { home, space, projectRoot, root = dataRoot.DATA_ROOT_DEFAULT })
{
    return dataRoot.memoryDbFor(level, { home, space, projectRoot, root });
}

// The inverse, matching one of the three shapes EXACTLY - never a prefix or substring match, so a
// foreign path is never mistaken for one of ours - under the new folder or the 2.0.0 `.memory-mcp`.
// '' when it is none of them.
function levelOfPath(p, { home, projectRoot })
{
    return dataRoot.memoryLevelOf(p, { home, projectRoot });
}

// --memory-level, resolved. GIVEN: that level's default path. ABSENT: an EXISTING registration keeps its
// level - and a CUSTOM path its MCP_MEMORY_SQLITE_PATH byte-for-byte; one of the three shapes is re-spelled
// to its current place (the `.alfred-memory` folder, the project level under the data root), which is where
// its launcher moves the file and where every reader looks first (data-root.js liveMemoryDb falls back to
// the old place until then). With no registration at all it is `global` - unless a record that could hold
// it was unread (recordedPath's `unread`) on a project a stamp records: then the level is `kept`, no path, and
// nothing re-points the server or writes the key (F2). A fresh install has no level to keep, so it takes the
// default (review 2.1.6 M1: `kept` there registered no memory server at all on the full copy route). A level
// change never copies or deletes a database: whichever file the old memories are in stays there, which is why
// the caller's log line names both.
function resolveLevel({ flag, registeredPath, unread = [], stamped = false, home, space, projectRoot, root = dataRoot.DATA_ROOT_DEFAULT })
{
    if (flag) return { level: flag, dbPath: pathForLevel(flag, { home, space, projectRoot, root }), from: 'flag' };
    if (registeredPath)
    {
        const level = levelOfPath(registeredPath, { home, projectRoot });
        if (!level) return { level: 'custom', dbPath: registeredPath, from: 'registration' };
        const scopedSpace = level === 'scoped' ? /^memory_(.+)\.db$/.exec(path.basename(registeredPath))[1] : space;
        return { level, dbPath: pathForLevel(level, { home, space: scopedSpace, projectRoot, root }), from: 'registration' };
    }
    if (unread.length && stamped) return { level: 'kept', dbPath: '', from: 'unreadable' };
    return { level: 'global', dbPath: pathForLevel('global', { home, space, projectRoot, root }), from: 'default' };
}

// The memory database this project's install already records, where it was read, and the records that could
// not be read. A copy-route registration in .mcp.json first (project scope, and user scope's C10), then the
// settings key the plugin route's launcher reads (memory-launch.js, same file order: the local file first).
// F2 (matrix 2.1.5 7c): a settings file that does not parse is no answer - read as {}, it let the level fall to
// the global default, and the full copy route re-registered the memory server there at local scope. The next
// readable key answers, as the launcher's does (re-verify 2 R5 - one reader, stack/hooks/memory.js settingsDbState);
// with none, the account's local-scope registration answers - the copy route's own at local scope - read by the
// caller before any claude call can replace an account file it cannot parse (F1). An unread file is named whatever
// answers, so the run can say so before it registers.
function recordedPath({ mcpFile, claudeDir, accountFile, projectRoot, configDir, home })
{
    const engine = require('../../stack/hooks/memory.js');
    const read = (file) =>
    {
        let raw;
        try { raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
        catch (err) { return err.code === 'ENOENT' ? {} : null; }
        try { const data = raw.trim() ? JSON.parse(raw) : {}; return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
        catch { return null; }
    };
    // A registration's path read the engine's way (memoryEnvPath): a relative one - the copy route's project level in the
    // committed .mcp.json, started at its project through ROOT_BOOT (re-verify 3 S2) - is this project's own path.
    const dbOf = (entry) => engine.memoryEnvPath(entry, home || require('node:os').homedir(), projectRoot) || '';
    // The settings keys through the ONE reader the plugin's launcher and the session-start engine use (re-verify 2 R5):
    // settings.local.json, settings.json, the account settings.json - an unreadable file is no answer, the next
    // readable key answers, and every file skipped is named (`unread`).
    const label = (file) => (claudeDir && file === path.join(claudeDir, 'settings.local.json') ? 'settings.local.json'
        : claudeDir && file === path.join(claudeDir, 'settings.json') ? 'settings.json' : file);
    const settings = claudeDir ? engine.settingsDbState(projectRoot, { home, configDir: configDir || (accountFile ? path.dirname(accountFile) : undefined) }) : { db: '', unread: [] };
    const unread = settings.unread.map(label);
    // Where it was read is returned too - the file and key, or the registration's entry - so the caller can ask the
    // stamp's ledger whether the stack wrote that value (a moved or copied folder, review 2.1.6).
    const entry = ((read(mcpFile) || {}).mcpServers || {}).memory;
    const registered = dbOf(entry);
    if (registered) return { path: registered, from: 'registration', entry, unread };
    if (settings.db) return { path: settings.db, from: 'settings', file: label(settings.from), key: settings.key, value: settings.value, unread };
    if (!unread.length || !accountFile) return { path: '', from: '', unread };
    const account = require('./mcp.js').registrationsAt({ scope: 'local', accountFile, projectRoot });
    if (account.state === 'unreadable') unread.push(path.basename(accountFile));
    const db = dbOf(account.servers.memory);
    return db ? { path: db, from: 'local registration', unread } : { path: '', from: '', unread };
}

// The folder a project-level database path belongs to when it is not this project's - a project moved or copied to
// `projectRoot` carries settings and a .mcp.json naming the OLD folder's database: `<old>/<data root>/.alfred-memory/memory.db`,
// or a 2.0.0 `<old>/.memory-mcp/memory.db`. '' for any other path, and for this project's own.
function movedProjectRoot(p, { projectRoot, root = dataRoot.DATA_ROOT_DEFAULT } = {})
{
    if (!p || !path.isAbsolute(p) || path.basename(p) !== 'memory.db') return '';
    const dir = path.dirname(path.normalize(p));
    const candidates = [];
    // The 2.0.0 shape is a 2.0.0 GLOBAL database under another home too (a folder copied between machines), so it counts
    // only where this folder holds a project-level memory folder of its own - one a moved project brings along.
    const ownFolder = [path.join(projectRoot, dataRoot.LEGACY_MEMORY_FOLDER), path.join(projectRoot, root, dataRoot.MEMORY_FOLDER)].some((d) => fs.existsSync(d));
    if (path.basename(dir) === dataRoot.LEGACY_MEMORY_FOLDER && ownFolder) candidates.push(path.dirname(dir));
    const suffix = path.join(root, dataRoot.MEMORY_FOLDER);
    if (dir.endsWith(path.sep + suffix)) candidates.push(dir.slice(0, -(suffix.length + 1)));
    const same = (a, b) => { const real = (x) => { try { return fs.realpathSync(x); } catch { return path.resolve(x); } }; return real(a) === real(b); };
    return candidates.find((old) => old && !same(old, projectRoot) && dataRoot.memoryLevelOf(p, { projectRoot: old }) === 'project') || '';
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
    let raw = '';
    // Re-verify 3 S9: a read error is named by its code, a parse error as bad JSON.
    try { raw = fs.readFileSync(settingsFile, 'utf8'); }
    catch (err)
    {
        if (err.code !== 'ENOENT')
        {
            log(`  !! ${settingsFile} could not be read (${err.code || err.message}) - autoMemoryEnabled left untouched; fix it and re-run`);
            return false;
        }
    }
    try { if (raw.trim()) data = JSON.parse(raw); }
    catch
    {
        log(`  !! ${settingsFile} is not valid JSON - autoMemoryEnabled left untouched; fix it and re-run`);
        return false;
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

// How many of Claude's own notes this project has, found the way the import finds them. 0 means nothing
// to import, so nothing waits on init's level choice; null means the folders could not be read, which
// the caller treats as notes present (the switch-off then waits for init, the old path).
function countNotes({ projectRoot, configDir, home })
{
    try
    {
        // This run's account dir is always scanned; the importer's own scan adds $HOME/.claude and its
        // `.claude-<space>` siblings, so a folder the import would read is never missed here.
        const { findNotes } = require('../memory-import.js');
        return findNotes(projectRoot, configDir, configDir, home, null).noteEntries.length;
    }
    catch { return null; }
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
// switch-off above, and on success the stamp's `initialised:` line - the one signal the router and
// every later run read (Task 18a I1). No reinstall: nothing else under .claude/ is touched. A copy-route
// registration is the installer's to re-point, so a different path there is refused, never edited - in
// the file the importer would spawn from: .mcp.json, else the account .claude.json (M4).
// Exit 0: imported, already off, or nothing to import. 1: a refusal or a failed import. 2: usage.
const USAGE = 'usage: memory.js init --project-root <root> --level <global|scoped|project> [--space <name>] [--config-dir <dir>] [--memory-dir <dir>]';

function readObject(file)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { return err.code === 'ENOENT' ? { data: null } : { error: `${file} could not be read (${err.code || err.message})` }; }
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

// The registration the importer spawns the server from, in its own order (the engine's
// registrationEntry): this project's .mcp.json, then the account file's user-scope entry, then its
// entry for this project. The account file is `<config-dir>/.claude.json` when a config dir is named or
// live, else `$HOME/.claude.json`. Null when none registers memory - the plugin route.
function registeredMemory(projectRoot, { home, configDir })
{
    const withPath = (file, entry) =>
    {
        if (!entry || typeof entry.command !== 'string' || !entry.command) return null;
        const raw = entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
        return { file, path: typeof raw === 'string' && raw ? raw.replace(/^~(?=[/\\]|$)/, home) : '' };
    };
    const mcpFile = path.join(projectRoot, '.mcp.json');
    const project = withPath(mcpFile, (readObject(mcpFile).data || {}).mcpServers?.memory);
    if (project) return project;
    const acctFile = path.join(configDir || process.env.CLAUDE_CONFIG_DIR || home, '.claude.json');
    const account = readObject(acctFile).data || {};
    const user = withPath(acctFile, account.mcpServers?.memory);
    if (user) return user;
    const projects = account.projects || {};
    const own = projects[projectRoot] || projects[projectRoot.split(path.sep).join('/')];
    return withPath(acctFile, own && own.mcpServers && own.mcpServers.memory);
}

// A project-level database lives in the repo, so its folder gets its own `.gitignore` (`*`) the moment
// the level lands - from init, update or configure alike (M5) - on top of the data root's own. `dbPath` is
// the database the level names; with none, the 2.0.0 place. An existing file is the user's, left alone.
function ensureProjectIgnore(projectRoot, log = () => {}, dbPath = '')
{
    const dir = dbPath ? path.dirname(dbPath) : path.join(projectRoot, dataRoot.LEGACY_MEMORY_FOLDER);
    const ignore = path.join(dir, '.gitignore');
    if (fs.existsSync(ignore)) return false;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ignore, '*\n');
    log(`  memory: ${path.relative(projectRoot, ignore).split(path.sep).join('/')} written - the project database is never committed`);
    return true;
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
    // The project level sits under the data root this project's settings name (the launchers read it the
    // same way, data-root.js dataRootOf), never a shell export.
    const { root: data } = dataRoot.dataRootOf({ env: flag('--config-dir') ? { CLAUDE_CONFIG_DIR: flag('--config-dir') } : {}, projectDir: projectRoot });
    const named = pathForLevel(level, { home, space: flag('--space'), projectRoot, root: data });
    // Where that level's database LIVES now: a 2.0.0 file its launcher has not moved yet is the one the
    // notes go into and the key names (data-root.js - the installer names it the same way).
    let dbPath = dataRoot.liveMemoryDb(named, { home, projectRoot });
    if (level === 'project' && !fs.existsSync(dbPath))
    {
        const dir = dataRoot.liveDir({ projectDir: projectRoot, cls: 'memory', root: data, pending: dataRoot.pendingOf(projectRoot), move: false }).dir;
        const found = path.join(projectRoot, ...dir.split('/'), 'memory.db');
        if (fs.existsSync(found)) dbPath = found;
    }
    const claudeDir = path.join(projectRoot, '.claude');

    const registered = registeredMemory(projectRoot, { home, configDir: flag('--config-dir') });
    // The same database under its 2.0.0 spelling is no mismatch: the installer re-spells the registration.
    const sameDb = (p) => [dbPath, named, dataRoot.legacyTwinOf(named, { home, projectRoot })].some((q) => q && path.normalize(p) === path.normalize(q));
    if (registered && registered.path && !sameDb(registered.path))
    {
        const where = path.basename(registered.file) === '.mcp.json' ? '.mcp.json' : registered.file;
        log(`  !! memory: ${where} registers memory at ${registered.path} - the copy route re-points it through the installer: /alfred-code:update --memory-level ${level}`);
        return 1;
    }

    // The switch-off goes to the file this install's other settings writes use (R47): the stamp's scope
    // names it; with no readable stamp, the file that already holds the key. C8 (R100, R101): the key
    // itself is this machine's database path, so it goes to settings.local.json at every scope, and a
    // copy an older run left in settings.json leaves it - unless settings.json is a file this install
    // never writes (the local scope).
    const local = path.join(claudeDir, 'settings.local.json');
    const shared = path.join(claudeDir, 'settings.json');
    const localRead = readObject(local);
    const scope = stampScope(claudeDir);
    const target = scope ? require('./settings.js').settingsTarget(claudeDir, scope)
        : (localRead.data && localRead.data.env && localRead.data.env.ALFRED_CODE_MEMORY_DB !== undefined ? local : shared);
    const targetRead = target === local ? localRead : readObject(target);
    const failed = localRead.error || targetRead.error;
    if (failed)
    {
        log(`  !! ${failed} - the memory level was not written; fix it and run /alfred-code:init again`);
        return 1;
    }
    const envOfData = (data) => { data.env = data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? data.env : {}; return data.env; };
    const localData = localRead.data || {};
    if (envOfData(localData).ALFRED_CODE_MEMORY_DB !== dbPath)
    {
        localData.env.ALFRED_CODE_MEMORY_DB = dbPath;
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(local, `${JSON.stringify(localData, null, 2)}\n`);
    }
    if (target === shared && targetRead.data && targetRead.data.env && typeof targetRead.data.env === 'object' && 'ALFRED_CODE_MEMORY_DB' in targetRead.data.env)
    {
        delete targetRead.data.env.ALFRED_CODE_MEMORY_DB;
        fs.writeFileSync(shared, `${JSON.stringify(targetRead.data, null, 2)}\n`);
        log("  settings.json env: ALFRED_CODE_MEMORY_DB removed - this machine's database path, kept in settings.local.json from here on");
    }
    log(`memory: level ${level} -> ${dbPath} (settings.local.json env ALFRED_CODE_MEMORY_DB)`);
    if (level === 'project') ensureProjectIgnore(projectRoot, log, dbPath);

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
    if (!out.switchedOff) return 1;
    const stamp = require('./stamp.js');
    if (stamp.markInitialised(claudeDir)) log(`memory: initialised - the stamp records it, so no later run defers to /alfred-code:init`);
    else log('  !! memory: no install stamp to mark - run /alfred-code:setup first');
    return 0;
}

module.exports = { MEMORY_DIR, pathForLevel, levelOfPath, resolveLevel, recordedPath, movedProjectRoot, autoMemoryState, writeSwitchOff, importGate, importNotes, countNotes, initMemory, ensureProjectIgnore };

if (require.main === module)
{
    const argv = process.argv.slice(2);
    if (argv[0] !== 'init') { console.error(USAGE); process.exit(2); }
    const { which, runNode } = require('./runtime.js');
    process.exit(initMemory(argv.slice(1), { which, runNode, homedir: require('node:os').homedir }));
}
