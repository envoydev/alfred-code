'use strict';
// THE PROJECT DATA ROOT - one folder, `.alfred` by default, for everything the stack and its servers
// keep for a project: the docs, the navigation server's index and handoff notes, the browser profiles
// and a project-level memory database. The ONE home of where each lives, read by the three launchers
// (serena-launch.js, browser-launch.js, memory-launch.js) and by the installer, so none can disagree.
//
//   ALFRED_CODE_DATA_PATH   the root, relative to the project, never under `.claude/` (Claude Code
//                           prompts for every write there). Read like every launcher setting: the shell
//                           env, then settings.local.json, settings.json and the account settings.json.
//
// What moves, and who moves it. The docs are cold data and the installer moves them inline. A server's
// own data is LIVE - the session running the installer holds it - so the installer only records the
// move as a stamp line (`data-pending: <class> <from> -> <to>`) and the server's launcher performs it at
// its next start, and only when nothing holds the data: a SQLite database with no -wal / -shm / -journal
// beside it, a browser profile with no lock. Renaming an open database is undefined behaviour
// (sqlite.org/howtocorrupt.html 2.5) and Windows refuses to rename an open file anyway. With no pending
// line a launcher never moves anything: it serves the new place when it exists, else the old one.
//
// The memory folder is `.alfred-memory` wherever it sits (Task 7a): ~/.alfred-memory for the global and
// scoped levels, <root>/.alfred-memory for the project level. The account folder ~/.memory-mcp is shared
// by every Claude account and by Cursor, so it moves only when idle, and a link is left at the old path
// (a junction on Windows) so an install not yet updated and Cursor still reach the one database.
const fs = require('node:fs');
const path = require('node:path');
const { settingFrom } = require('./uv-python.js');

const DATA_ROOT_DEFAULT = '.alfred';
const MEMORY_FOLDER = '.alfred-memory';
const LEGACY_MEMORY_FOLDER = '.memory-mcp';
const ENGINES = ['chrome', 'msedge', 'firefox', 'webkit'];
// Each browser engine's server, plugin and data class: `<engine>-control` (the user's rename of 2026-10-13;
// `browser-<engine>` from 2.0.0, `playwright-<engine>` before) - the one spelling every reader takes from here.
const engineServer = (engine) => `${engine}-control`;
const ENGINE_SERVER = new RegExp(`^(${ENGINES.join('|')})-control$`);
const engineOfServer = (name) => (ENGINE_SERVER.exec(String(name)) || [])[1];
// Where 2.0.0 kept each server's data, relative to the project (the docs' old root is docs.js LEGACY_DOCS_ROOT).
const LEGACY = { serena: '.serena', browser: '.playwright', memory: LEGACY_MEMORY_FOLDER };
// Where 2.1.0 to 2.3.x kept every engine's profile under the root, one folder for all of them: <root>/browser/<engine>.
// Each engine has its own <root>/<engine>-control now, and the shared folder goes once the last profile left it.
const SHARED_BROWSER = 'browser';
// mobile-control's screenshots, recordings and saved page sources (stack/mcp/mobile-launch.js).
const MOBILE_FOLDER = 'mobile-control';
// The project's own secret store, a dotenv the user fills by hand (the user's ruling of 2026-10-13): every value in it is
// a credential to stack/hooks/guard-secret-value.js. The browser launcher hands Playwright MCP the FILE (--secrets), which
// types a value by its KEY and masks it in each response; mobile-control takes only the keys appium-mcp documents
// (withSensitive `only`); no other server gets any (audit 2026-10-14 PL2, the user's ruling of 2026-10-14).
const SENSITIVE_FILE = '.sensitive-data';

// ------------------------------------------------------------------ the setting

// { ok, value } for a usable root, { ok: false, why } otherwise. Forward slashes, no leading './', no
// trailing '/'. No space: serena hands its home to cmd.exe unquoted on Windows, where a space cuts it.
// No '$': serena reads the folder key through its own `$placeholder` substitution.
function checkDataPath(raw)
{
    const value = String(raw ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (!value) return { ok: false, why: 'the data root is empty' };
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return { ok: false, why: `${value} is absolute - the data root is a folder inside the project` };
    if (/\s/.test(value)) return { ok: false, why: `${value} holds a space - the navigation server's home reaches cmd.exe unquoted on Windows` };
    if (/[$%`"'*?<>|:]/.test(value)) return { ok: false, why: `${value} holds a character a shell or a server placeholder would read` };
    const parts = value.split('/');
    if (parts.some((p) => p === '.' || p === '..')) return { ok: false, why: `${value} has a . or .. segment - the data root stays inside the project` };
    if (parts[0] === '.claude') return { ok: false, why: `${value} is under .claude/, where Claude Code prompts for every write` };
    if (parts[0] === '.git') return { ok: false, why: `${value} is under .git/` };
    return { ok: true, value };
}

// The root in effect for a project: { root, source: 'setting' | 'default' | 'invalid', why? }.
function dataRootOf({ env = process.env, projectDir } = {})
{
    const raw = settingFrom({ env, projectDir, suffix: 'DATA_PATH' });
    if (!raw) return { root: DATA_ROOT_DEFAULT, source: 'default' };
    const checked = checkDataPath(raw);
    return checked.ok ? { root: checked.value, source: 'setting' } : { root: DATA_ROOT_DEFAULT, source: 'invalid', why: checked.why };
}

function layout(root = DATA_ROOT_DEFAULT)
{
    return {
        root,
        docs: `${root}/docs`,
        serena: `${root}/serena`,
        serenaHome: `${root}/serena/home`,
        browser: (engine) => `${root}/${engineServer(engine)}`,
        mobile: `${root}/${MOBILE_FOLDER}`,
        sensitive: `${root}/${SENSITIVE_FILE}`,
        memory: `${root}/${MEMORY_FOLDER}`,
        memoryDb: `${root}/${MEMORY_FOLDER}/memory.db`,
    };
}

// The server-data CLASSES a move carries: `serena`, `<engine>-control`, `memory` (the project level's
// folder) and `sensitive` (the .sensitive-data FILE, which a root change takes along and nothing else moves). Each has
// one place under the root and (but `sensitive`) one 2.0.0 place; an engine has the 2.1.0 shared folder too.
function targetOf(cls, root = DATA_ROOT_DEFAULT)
{
    if (cls === 'serena') return `${root}/serena`;
    if (cls === 'memory') return `${root}/${MEMORY_FOLDER}`;
    if (cls === 'sensitive') return `${root}/${SENSITIVE_FILE}`;
    return engineOfServer(cls) ? `${root}/${cls}` : null;
}
// The data root a class's place sits under - the inverse of targetOf; null for a 2.0.0 place or a foreign one.
function rootOfPlace(cls, rel)
{
    const suffix = targetOf(cls, '').slice(1);   // 'serena', '<engine>-control', '.alfred-memory', '.sensitive-data'
    const root = String(rel || '').endsWith(`/${suffix}`) ? rel.slice(0, -(suffix.length + 1)) : '';
    return root && checkDataPath(root).ok ? root : null;
}

function legacyOf(cls)
{
    if (cls === 'serena') return LEGACY.serena;
    if (cls === 'memory') return LEGACY.memory;
    const engine = engineOfServer(cls);
    return engine ? `${LEGACY.browser}/${engine}` : null;
}

// A move row out of the root's own 2.1.0 shared folder: a re-layout inside the root, which the installer never offers.
const isRelayout = (row, root) => Boolean(row) && row.from === sharedBrowserOf(row.cls, root);

// An engine's place in a root's 2.1.0 shared folder (`<root>/browser/<engine>`); null for any other class.
function sharedBrowserOf(cls, root = DATA_ROOT_DEFAULT)
{
    const engine = engineOfServer(cls);
    return engine ? `${root}/${SHARED_BROWSER}/${engine}` : null;
}

// ------------------------------------------------------------------ the root's own .gitignore

// THE ONE .gitignore the stack writes (the user's ruling of 2026-10-13: one file, at the data root). Everything under
// the root is this machine's - the navigation index and its ~327MB of language servers, browser profiles holding
// session cookies, a project memory database, the sensitive data - EXCEPT the docs, which follow
// ALFRED_CODE_DOCS_VERSIONING. `local` keeps them out too; `git` (and a mode nobody has set yet) re-includes the docs
// folder and keeps out only the hooks' machine state under it. A bare `*` would hide the docs from git under `git`,
// `git check-ignore` would then answer yes for them, and the versioning seed would read every fresh project as
// `local`. The file re-includes ITSELF, so it is committed and a teammate's clone has it before any server writes
// there. The header line marks it as the stack's: any other text is the project's own and is left alone. One home,
// read by the installer (docs.ensureDataIgnore) and by every launcher that writes under the root (ensureRootIgnore).
// A docs root OUTSIDE this root keeps its own file (docs.ensureDocsIgnore) - no file of the stack's reaches it.
const DATA_IGNORE_HEAD = '# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local';
// The hooks' machine state under the docs root, relative to it: never committed, whatever the versioning.
const DOCS_STATE_IGNORE = [
    '/flow/', '/hook-blocks/', '/history/', '/tools-usage/', '/.branches/', '/docs-log.jsonl',
    "# the usage audit's raw transcript and ledger copies stay on this machine",
    '/usage-report/**/*.jsonl',
    "# the run book's credentials file before 2026-10-13, which an older capture still writes",
    '/project-capabilities/credentials.local.env',
];
const relOf = (v) => String(v || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
function docsInsideRoot({ root, docsPath })
{
    const rel = path.posix.relative(relOf(root), relOf(docsPath));
    return rel && !rel.startsWith('..') && !path.posix.isAbsolute(rel) ? rel : '';
}
function dataIgnoreText({ root, docsPath, mode })
{
    const rel = docsInsideRoot({ root, docsPath });
    if (!rel) return `${DATA_IGNORE_HEAD}\n*\n!/.gitignore\n`;
    if (mode === 'local') return `${DATA_IGNORE_HEAD}; the docs under it are too (ALFRED_CODE_DOCS_VERSIONING=local)\n/*\n!/.gitignore\n`;
    const state = DOCS_STATE_IGNORE.map((l) => (l.startsWith('#') ? l : `/${rel}${l}`));
    return `${DATA_IGNORE_HEAD}; the docs under it are committed (ALFRED_CODE_DOCS_VERSIONING=git), the hooks' state there is not\n`
        + `/*\n!/.gitignore\n!/${rel.split('/')[0]}/\n${state.join('\n')}\n`;
}

// A launcher's half, before it hands out a path under the root: the file is written only when absent (the
// installer keeps it current), with the docs root and versioning the settings name - else `<root>/docs`, what every
// install writes, and the committed shape. A project on 2.0.0 whose servers are already 2.1 has none yet.
// 'written' | 'present'.
function ensureRootIgnore({ projectDir, root, env = process.env })
{
    const base = path.join(projectDir, ...String(root).split('/'));
    const file = path.join(base, '.gitignore');
    if (fs.existsSync(file)) return 'present';
    const docsPath = settingFrom({ env, projectDir, suffix: 'DOCS_PATH' }) || `${root}/docs`;
    const mode = String(settingFrom({ env, projectDir, suffix: 'DOCS_VERSIONING' }) || '').trim().toLowerCase();
    fs.mkdirSync(base, { recursive: true });
    // `wx`: another server starting at the same moment may have written it - its file stands.
    try { fs.writeFileSync(file, dataIgnoreText({ root, docsPath, mode }), { flag: 'wx' }); }
    catch (err) { if (err.code === 'EEXIST') return 'present'; throw err; }
    return 'written';
}

// ------------------------------------------------------------------ the memory database

function memoryDbFor(level, { home, space, projectRoot, root = DATA_ROOT_DEFAULT } = {})
{
    if (level === 'global') return path.join(home, MEMORY_FOLDER, 'memory.db');
    if (level === 'scoped') return path.join(home, MEMORY_FOLDER, `memory_${space || 'default'}.db`);
    if (level === 'project') return projectRoot ? path.join(projectRoot, ...String(root).split('/'), MEMORY_FOLDER, 'memory.db') : '';
    return '';
}

const inside = (child, parent) => { const rel = path.relative(parent, child); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
// A path in its real spelling, for comparing two: the nearest part that exists is resolved (macOS routes
// the temp dir through /var -> /private/var, and git answers the real form), the rest appended as written.
function realish(p)
{
    const abs = path.resolve(String(p));
    let head = abs;
    const tail = [];
    for (;;)
    {
        try { return path.join(fs.realpathSync.native(head), ...tail.reverse()); }
        catch { /* not there yet: one level up */ }
        const up = path.dirname(head);
        if (up === head) return abs;
        tail.push(path.basename(head));
        head = up;
    }
}

// The level a path belongs to - the new folder and the 2.0.0 one alike, and nothing else: never a prefix
// or substring match, so a foreign path is never mistaken for one of ours. '' when it is none of them.
function memoryLevelOf(p, { home, projectRoot } = {})
{
    if (!p) return '';
    const norm = realish(path.normalize(String(p)));
    const dir = path.dirname(norm);
    const file = path.basename(norm);
    if (projectRoot && file === 'memory.db')
    {
        const root = realish(projectRoot);
        if (dir === path.join(root, LEGACY_MEMORY_FOLDER)) return 'project';
        if (path.basename(dir) === MEMORY_FOLDER && inside(dir, root)) return 'project';
    }
    if (home && [MEMORY_FOLDER, LEGACY_MEMORY_FOLDER].some((f) => dir === path.join(realish(home), f)))
    {
        if (file === 'memory.db') return 'global';
        if (/^memory_.+\.db$/.test(file)) return 'scoped';
    }
    return '';
}

// The 2.0.0 spelling of a new memory path: the home folder by name, the project database at
// <project>/.memory-mcp. null for a path that has no old spelling.
function legacyTwinOf(p, { home, projectRoot } = {})
{
    if (!p) return null;
    const norm = realish(path.normalize(String(p)));
    const dir = path.dirname(norm);
    if (home && dir === path.join(realish(home), MEMORY_FOLDER)) return path.join(home, LEGACY_MEMORY_FOLDER, path.basename(norm));
    if (projectRoot && path.basename(norm) === 'memory.db' && path.basename(dir) === MEMORY_FOLDER && inside(dir, realish(projectRoot)))
        return path.join(projectRoot, LEGACY_MEMORY_FOLDER, 'memory.db');
    return null;
}

const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };

// The new spelling of a 2.0.0 HOME memory path (~/.memory-mcp/<file> -> ~/.alfred-memory/<file>); null for
// any other path. The project database has no fixed new place - it follows the data root.
function homeTwinOf(p, { home } = {})
{
    if (!p || !home) return null;
    const norm = realish(path.normalize(String(p)));
    return path.dirname(norm) === path.join(realish(home), LEGACY_MEMORY_FOLDER) ? path.join(home, MEMORY_FOLDER, path.basename(norm)) : null;
}

// The database a reader should open for a configured path: the path itself once it exists, else its old
// twin while that one has not moved yet - so a server and the session-start hook read the same memories
// in the window between an update and the move. An old HOME path that is gone names its new spelling
// (I2): the folder moved, and a link back could not be made - never the old folder, which a server would
// then re-create as a second, empty database.
function liveMemoryDb(p, { home, projectRoot } = {})
{
    if (!p || exists(p)) return p;
    const moved = homeTwinOf(p, { home });
    if (moved) return moved;
    const twin = legacyTwinOf(p, { home, projectRoot });
    return twin && exists(twin) ? twin : p;
}

// ------------------------------------------------------------------ what holds data open

// The databases in `dir` a connection has open: SQLite keeps -wal and -shm beside a WAL database while
// any connection is open and deletes them with the last clean close; -journal is a rollback write in
// flight. An unclean exit leaves them behind, which reads as busy - the safe side.
function busyDbs(dir)
{
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => n.endsWith('.db') && ['-wal', '-shm', '-journal'].some((s) => names.includes(`${n}${s}`))).sort();
}

// A browser profile a running browser holds: Chromium's Singleton* entries (dangling links, removed on a
// clean exit) and Firefox's `lock` link. WebKit's own lock is not known; a rename of a folder a process
// holds open fails on Windows, which is the fallback there.
const PROFILE_LOCKS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lock'];
function profileLocks(dir)
{
    return PROFILE_LOCKS.filter((name) => { try { fs.lstatSync(path.join(dir, name)); return true; } catch { return false; } });
}

// A serena serving this folder (M2): serena 1.7.0 names each start's log after its own pid -
// `<folder>/home/logs/<date>/mcp_<stamp>_<pid>.txt` (measured) - so a log whose pid is a live process is a
// server holding the folder: on the copy route the very session running the installer, else a second
// session's. A live pid counts only when its command line names serena, so an old log's REUSED pid keeps no
// move pending: `ps` on macOS and Linux, one CIM query on Windows (measured on a Windows ARM64 machine:
// dozens of September logs named pids Windows had handed to DefenderSessionHelper.exe and the like, and
// the move stayed busy for good while every live pid counted). A process whose command line cannot be
// read (another user's, an elevated one) is judged by its image - a python, uv or serena process is
// busy. No answer at all reads as busy, the safe side. This process's own pid is never one.
//   run(cmd, args) - spawnSync's result; injected by the tests, like `platform`.
const SERENA_IMAGE = /^(python|pythonw|py|uv|uvx|serena)(\.exe)?$/i;
function serenaPids(pids, { platform = process.platform, run } = {})
{
    if (!pids.length) return new Set();
    const spawn = run || ((cmd, args) => require('node:child_process').spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
    const all = () => new Set(pids);
    if (platform !== 'win32')
    {
        const r = spawn('ps', ['-o', 'pid=,command=', '-p', pids.join(',')]);
        if (r.error || r.status === null || (r.status !== 0 && r.status !== 1)) return all();
        const named = new Set();
        for (const line of String(r.stdout || '').split('\n'))
        {
            const m = /^\s*(\d+)\s+(.*)$/.exec(line);
            if (m && /serena/i.test(m[2])) named.add(Number(m[1]));
        }
        return named;
    }
    // Windows: one query for every pid - `<pid>\t<image>\t<command line>` per process still running.
    const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { [string]$_.ProcessId + [char]9 + $_.Name + [char]9 + $_.CommandLine }`;
    const r = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    if (r.error || r.status !== 0) return all();
    const named = new Set();
    for (const line of String(r.stdout || '').split(/\r?\n/))
    {
        const [pid, image = '', command = ''] = line.split('\t');
        if (!/^\d+$/.test(pid || '')) continue;
        if (command.trim() ? /serena/i.test(command) : SERENA_IMAGE.test(image.trim())) named.add(Number(pid));
    }
    return named;
}
function serenaBusy(dir, { platform, run } = {})
{
    const logs = path.join(dir, 'home', 'logs');
    let days;
    try { days = fs.readdirSync(logs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
    const live = new Set();
    for (const day of days)
    {
        let names;
        try { names = fs.readdirSync(path.join(logs, day)); } catch { continue; }
        for (const name of names)
        {
            const m = /^mcp_.*_(\d+)\.txt$/.exec(name);
            const pid = m ? Number(m[1]) : 0;
            if (pid > 0 && pid !== process.pid && !live.has(pid) && alive(pid)) live.add(pid);
        }
    }
    const held = serenaPids([...live], { platform, run });
    return [...held].sort((a, b) => a - b).map((pid) => `serena pid ${pid}`);
}

// A text write that survives a Windows Hidden or System attribute. Node opens a file for 'w' with
// CREATE_ALWAYS, which Windows refuses (EPERM) on a hidden file unless the open asks for the attribute
// too - measured: serena_config.yml and .serena/.gitignore carried 'H', and both the launcher's and the
// installer's writes failed after the move. An existing file is then opened in place, truncated and
// rewritten, which keeps its attributes. Any other error is the caller's.
function writeText(file, text)
{
    try { fs.writeFileSync(file, text); return; }
    catch (err)
    {
        if (!['EPERM', 'EACCES'].includes(err.code) || !fs.existsSync(file)) throw err;
    }
    const fd = fs.openSync(file, 'r+');
    try
    {
        fs.ftruncateSync(fd, 0);
        fs.writeSync(fd, text, 0, 'utf8');
    }
    finally { fs.closeSync(fd); }
}

// ------------------------------------------------------------------ moving

const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
// A folder holding nothing but a `.gitignore` holds no data: the installer's ignore files land before a
// launcher moves the data in, and must never read as the data already being there.
const isEmptyDir = (p) => { try { return fs.readdirSync(p).every((n) => n === '.gitignore'); } catch { return false; } };

// One folder, one rename: 'moved', 'absent' (nothing there, or a link or file that is not ours to move),
// 'conflict' (the target already holds data - neither side is touched) or 'failed' (the rename refused:
// EBUSY / EPERM on Windows for a folder a process holds, EXDEV across filesystems).
// `file`: the entry is one file (the .sensitive-data store) - any file already at the target is a conflict.
function moveEntry(from, to, { file = false } = {})
{
    if (file ? !isFile(from) : !isDir(from)) return { state: 'absent' };
    if (fs.existsSync(to))
    {
        if (file || !isEmptyDir(to)) return { state: 'conflict' };
        try { fs.rmSync(to, { recursive: true }); } catch (err) { return { state: 'failed', why: err.code || err.message }; }
    }
    try
    {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        return { state: 'moved' };
    }
    catch (err) { return { state: 'failed', why: err.code || err.message }; }
}

// ~/.memory-mcp -> ~/.alfred-memory, when no database in it is open, with the old path left as a link.
// { state: 'moved' | 'linked' (done before) | 'absent' | 'busy' | 'exists' (both hold data) | 'failed' }.
function moveHomeMemory({ home, platform = process.platform, symlink = fs.symlinkSync } = {})
{
    if (!home) return { state: 'absent' };
    const from = path.join(home, LEGACY_MEMORY_FOLDER);
    const to = path.join(home, MEMORY_FOLDER);
    let st;
    try { st = fs.lstatSync(from); } catch { return { state: 'absent', from, to }; }
    if (st.isSymbolicLink()) return { state: 'linked', from, to };
    if (!st.isDirectory()) return { state: 'absent', from, to };
    const busy = busyDbs(from);
    if (busy.length) return { state: 'busy', from, to, busy };
    const moved = moveEntry(from, to);
    if (moved.state === 'conflict') return { state: 'exists', from, to };
    if (moved.state !== 'moved') return { state: 'failed', from, to, why: moved.why || moved.state };
    // A junction needs an absolute target and no privilege on Windows; elsewhere a relative link keeps
    // working if the home folder itself is ever moved.
    try
    {
        if (platform === 'win32') symlink(to, from, 'junction');
        else symlink(MEMORY_FOLDER, from, 'dir');
        return { state: 'moved', from, to, linked: true };
    }
    catch (err) { return { state: 'moved', from, to, linked: false, why: err.code || err.message }; }
}

// M5: one server's data from `from` to `to` (both project-relative), and for the project memory folder
// leaving its 2.0.0 place, the link back the home folder gets - Cursor, and an install not yet updated,
// still open <project>/.memory-mcp/memory.db, and without the link would create a second, empty database
// there. Only that place: a server's other data and a move between two of the stack's own roots leave none
// (a link would keep the old root from ever being pruned). The link is no data to every reader (hasData
// reads the entry itself), so it never reads as a clash or an offer. An engine's profile leaving the 2.1.0 shared
// folder (`<root>/browser/<engine>`) takes that folder with it once it is empty - the last engine to move clears it. The
// sensitive-data file moves as one file, into a root whose .gitignore is written first.
// { state (moveEntry's), linked?, why? }.
function movePlace({ projectDir, cls, from, to, platform = process.platform, symlink = fs.symlinkSync })
{
    const abs = (rel) => path.join(projectDir, ...rel.split('/'));
    // The sensitive-data file never lands in a root its .gitignore does not cover yet - not even for one moment.
    if (cls === 'sensitive')
    {
        const root = rootOfPlace(cls, to);
        try { if (root) ensureRootIgnore({ projectDir, root }); }
        catch (err) { return { state: 'failed', why: `${to} has no .gitignore yet (${err.code || err.message})` }; }
    }
    const moved = moveEntry(abs(from), abs(to), { file: cls === 'sensitive' });
    if (moved.state === 'moved' && engineOfServer(cls) && path.posix.basename(path.posix.dirname(from)) === SHARED_BROWSER)
    {
        try { fs.rmdirSync(abs(path.posix.dirname(from))); }
        catch { /* another engine's profile is still there - its own move clears the folder */ }
    }
    if (moved.state !== 'moved' || cls !== 'memory' || from !== LEGACY.memory) return moved;
    try
    {
        if (platform === 'win32') symlink(abs(to), abs(from), 'junction');
        else symlink(path.relative(path.dirname(abs(from)), abs(to)), abs(from), 'dir');
        return { ...moved, linked: true };
    }
    catch (err) { return { ...moved, linked: false, why: err.code || err.message }; }
}

// ------------------------------------------------------------------ the project's sensitive data

// The project's .sensitive-data: <root>/.sensitive-data in the checkout `projectDir` belongs to, else in its main worktree
// (a gitignored file a new worktree does not have) - where guard-secret-value.js sensitiveFile() looks. null with none.
function sensitivePlaceOf({ projectDir, root = DATA_ROOT_DEFAULT })
{
    let places = [projectDir];
    try
    {
        const r = require('../hooks/memory.js').projectRootOf(projectDir);
        places = [...new Set([r.checkout, r.project])];
    }
    catch { /* no engine beside this folder: the project directory alone */ }
    return places.map((p) => path.join(p, ...root.split('/'), SENSITIVE_FILE)).find(isFile) || null;
}

// The values of the project's .sensitive-data, {} when there is none. The dotenv reading is the twin of
// guard-secret-value.js (DOTENV_LINE, unquote - the hooks ship apart from this folder on the copy route); a test holds
// the two to the same fixture.
const SENSITIVE_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
// Notepad's 'Unicode' is UTF-16 LE with a BOM; anything else reads as UTF-8, its BOM dropped.
const isUtf16 = (buf) => buf[0] === 0xff && buf[1] === 0xfe;
const dotenvText = (buf) => (isUtf16(buf) ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^\uFEFF/, ''));
// Every KEY=value line: { key, value (unquoted), line (as written) }; a later line for a key wins, as dotenv reads it.
function dotenvPairs(text)
{
    const out = [];
    for (const line of text.split(/\r?\n/))
    {
        if (/^\s*#/.test(line)) continue;
        const m = line.match(SENSITIVE_LINE);
        if (m) out.push({ key: m[1], value: m[2].trim().replace(/^(["'])(.*)\1$/, '$2'), line: line.trim() });
    }
    return out;
}
function readSensitive({ projectDir, root = DATA_ROOT_DEFAULT })
{
    const file = sensitivePlaceOf({ projectDir, root });
    let buf;
    try { buf = fs.readFileSync(file); }
    catch { return {}; }
    return Object.fromEntries(dotenvPairs(dotenvText(buf)).map((p) => [p.key, p.value]));
}

// A launcher's child environment with the project's sensitive data in it: a variable already set (the shell, a settings
// file's env) keeps its value - a launch takes the store only where nothing else answers, the dotenv convention. `only`
// names the keys the server documents (null: every key); any other key in the store stays out of its environment.
// { env, count } - the count is for the launcher's one stderr line; no value is ever logged.
function withSensitive(env, { projectDir, root, only = null } = {})
{
    const values = readSensitive({ projectDir, root: root || dataRootOf({ env, projectDir }).root });
    const added = Object.keys(values).filter((k) => !Object.hasOwn(env, k) && (!only || only.includes(k)));
    return { env: { ...env, ...Object.fromEntries(added.map((k) => [k, values[k]])) }, count: added.length };
}

// The project's sensitive data exists from the first install on (the user's ruling of 2026-10-13), so a person finds
// it where every rule points before anything needs a value. One comment line, no key: the secret guard's start line
// stays silent on it, and a run book capture's keys are a `KEY=` line it hands the user. Written only when absent and
// only where git keeps it out (or there is no repository) - a store git would commit is said, never made.
// 'written' | 'present' | 'exposed' | 'blocked' (a folder or link under the name).
const SENSITIVE_DEFAULT = "# alfred-code: this project's sensitive data - KEY=value, one per line; gitignored, and its values never reach the chat\n";
function ensureSensitiveFile({ projectDir, root = DATA_ROOT_DEFAULT, check = gitIgnores })
{
    const file = path.join(projectDir, ...String(root).split('/'), SENSITIVE_FILE);
    if (isFile(file)) return 'present';
    try { fs.lstatSync(file); return 'blocked'; }
    catch { /* absent: ours to write */ }
    if (check(projectDir, `${relOf(root)}/${SENSITIVE_FILE}`) === false) return 'exposed';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, SENSITIVE_DEFAULT, { flag: 'wx', mode: 0o600 }); }
    catch (err) { if (err.code === 'EEXIST') return 'present'; throw err; }
    return 'written';
}

// The capture's own credentials file before 2026-10-13 (`<docs>/project-capabilities/credentials.local.env`): one
// credential home now, so an install moves its pairs into the store - the values read and written here, never printed -
// and re-points the run book's line at the store. Nothing moves when the store holds a key with ANOTHER value (both
// stay, the keys are named), when git would commit the store, or when the store is not a file. The store is written
// before the old file goes, so a failed delete only leaves a move the next run finishes. The folder's .gitignore line
// stays: a capture of the other stack may write the file again.
// { state: 'absent' | 'moved' | 'empty' | 'clash' | 'exposed' | 'blocked' | 'failed', from, to, keys, added, repointed, why }.
const OLD_CREDENTIALS = 'credentials.local.env';
function adoptCredentials({ projectDir, root = DATA_ROOT_DEFAULT, docsPath = `${DATA_ROOT_DEFAULT}/docs`, check = gitIgnores })
{
    const folder = path.resolve(projectDir, String(docsPath), 'project-capabilities');   // a docs root the user set may be absolute
    const fromAbs = path.join(folder, OLD_CREDENTIALS);
    const rel = (p) => path.relative(projectDir, p).split(path.sep).join('/');
    const toAbs = path.join(projectDir, ...root.split('/'), SENSITIVE_FILE);
    const at = { from: rel(fromAbs), to: rel(toAbs) };
    if (!isFile(fromAbs)) return { state: 'absent', ...at };
    let pairs;
    try { pairs = dotenvPairs(dotenvText(fs.readFileSync(fromAbs))); }
    catch (err) { return { state: 'failed', ...at, why: err.code || err.message }; }
    const last = new Map(pairs.map((p) => [p.key, p]));
    if (!last.size) return { state: 'empty', ...at };
    if (fs.existsSync(toAbs) && !isFile(toAbs)) return { state: 'blocked', ...at, why: `${at.to} is not a file` };
    let buf = null;
    try { buf = isFile(toAbs) ? fs.readFileSync(toAbs) : null; }
    catch (err) { return { state: 'failed', ...at, why: err.code || err.message }; }
    const have = buf ? Object.fromEntries(dotenvPairs(dotenvText(buf)).map((p) => [p.key, p.value])) : {};
    const keys = [...last.keys()];
    const clash = keys.filter((k) => Object.hasOwn(have, k) && have[k] !== last.get(k).value);
    if (clash.length) return { state: 'clash', ...at, keys: clash };
    try { ensureRootIgnore({ projectDir, root }); }
    catch (err) { return { state: 'failed', ...at, why: `${root}/.gitignore: ${err.code || err.message}` }; }
    if (check(projectDir, at.to) === false) return { state: 'exposed', ...at };
    const added = keys.filter((k) => !Object.hasOwn(have, k));
    try
    {
        if (added.length)
        {
            const lines = [`# from ${at.from}, moved by the alfred-code installer`, ...added.map((k) => last.get(k).line)].join('\n') + '\n';
            if (!buf) fs.writeFileSync(toAbs, lines, { mode: 0o600 });
            else if (isUtf16(buf))
            {
                const text = dotenvText(buf);
                fs.writeFileSync(toAbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${text}${text && !text.endsWith('\n') ? '\n' : ''}${lines}`, 'utf16le')]));
            }
            else fs.appendFileSync(toAbs, `${buf.length && buf[buf.length - 1] !== 0x0a ? '\n' : ''}${lines}`);
        }
        fs.rmSync(fromAbs);
        // The run book left this folder on 2026-10-15 (docs.js migrateRunBook): emptied now, it goes in this same run,
        // so the next one has nothing left to do. Anything still in it - the run book itself, a .gitignore - keeps it.
        try { fs.rmdirSync(folder); } catch { /* not empty */ }
    }
    catch (err) { return { state: 'failed', ...at, why: err.code || err.message }; }
    // The run book names the file by a path ending in its name, backticked or bare: each spelling becomes the store's.
    // It sits at its 2026-10-15 home once an install moved it (docs.js migrateRunBook), at the old one before.
    let repointed = 0;
    for (const book of [path.resolve(projectDir, String(docsPath), 'project-awareness', 'PROJECT-AWARENESS.md'), path.join(folder, 'PROJECT-CAPABILITIES.md')])
    {
        try
        {
            let n = 0;
            const text = fs.readFileSync(book, 'utf8');
            const next = text.replace(/(?:[\w.\-<>]+\/)*credentials\.local\.env\b/g, () => { n += 1; return at.to; });
            if (n) { writeText(book, next); repointed += n; }
        }
        catch { /* no run book here, or one the next capture rewrites */ }
    }
    return { state: 'moved', ...at, keys, added, repointed };
}
// git's answer for a path: true ignored, false not ignored (or tracked), null no repository / no git.
function gitIgnores(projectDir, rel)
{
    const r = require('node:child_process').spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: projectDir, stdio: 'ignore', timeout: 10000 });
    return r.status === 0 ? true : r.status === 1 ? false : null;
}

// ------------------------------------------------------------------ the move plan and the pending record

const hasData = (p) => isDir(p) && !isEmptyDir(p);
// A class's place holds something to move: a folder with data, or for `sensitive` the file itself.
const holds = (cls, p) => (cls === 'sensitive' ? isFile(p) : hasData(p));

// One row per class whose data sits somewhere other than its place under `root`: the prior root's place
// first (a root change), then an engine's 2.1.0 shared-folder place (the prior root's, then this one's), then the
// 2.0.0 place. `conflict` when the target already holds data too. The
// classes are the kept engines' profiles, serena, the memory folder only at the project level, and the sensitive-data
// file - which has no 2.0.0 place, so only a root change moves it.
function dataMovePlan({ projectRoot, root, prior = null, engines = [], memory = false })
{
    const abs = (rel) => path.join(projectRoot, ...rel.split('/'));
    const classes = ['serena', ...engines.map(engineServer), ...(memory ? ['memory'] : []), 'sensitive'];
    const rows = [];
    for (const cls of classes)
    {
        const to = targetOf(cls, root);
        const moved = prior && prior !== root;
        const from = [moved ? targetOf(cls, prior) : null, moved ? sharedBrowserOf(cls, prior) : null, sharedBrowserOf(cls, root), legacyOf(cls)]
            .filter((c) => c && c !== to).find((c) => holds(cls, abs(c)));
        if (from) rows.push({ cls, from, to, conflict: holds(cls, abs(to)) });
    }
    return rows;
}

// `data-pending: <class> <from> -> <to>` - the move the installer recorded for a launcher to make. Read
// back strictly: a class the stack knows, and two relative paths that stay inside the project.
const CLASS = new RegExp(`^(serena|memory|sensitive|(?:${ENGINES.join('|')})-control)$`);
const renderPending = (rows) => rows.map((r) => `data-pending: ${r.cls} ${r.from} -> ${r.to}`);
// A line an install before the 2026-10-13 rename recorded (`browser-<engine>`, to `<root>/browser/<engine>`) reads as
// the engine's move to its own folder: the user's answer carried, the place renamed.
const OLD_ENGINE_CLASS = /^browser-(chrome|msedge|firefox|webkit)$/;
function readPending(text)
{
    const out = [];
    for (const m of String(text || '').matchAll(/^data-pending: *(\S+) +(\S+) +-> +(\S+) *$/gm))
    {
        let [, cls, from, to] = m;
        const old = OLD_ENGINE_CLASS.exec(cls);
        if (old)
        {
            cls = engineServer(old[1]);
            const shared = `/${SHARED_BROWSER}/${old[1]}`;
            if (to.endsWith(shared)) to = `${to.slice(0, -shared.length)}/${cls}`;
        }
        if (!CLASS.test(cls) || !checkDataPath(from).ok || !checkDataPath(to).ok) continue;
        out.push({ cls, from, to });
    }
    return out;
}

// The pending rows of a project's own stamp - [] with none.
function pendingOf(projectDir)
{
    for (const name of ['alfred-code.stamp'])
    {
        try { return readPending(fs.readFileSync(path.join(projectDir, '.claude', name), 'utf8')); }
        catch { /* no stamp: nothing pending */ }
    }
    return [];
}

// Where a launcher finds a class's data this start: { dir (relative), state }. 'current' - already under
// the root; 'moved' - a pending move ran now; 'busy' / 'failed' - a pending move could not run, so the old
// place serves this start; 'legacy' - no move was agreed, an older place serves (an engine's 2.1.0 shared folder,
// then the 2.0.0 place); 'fresh' - nothing yet.
function liveDir({ projectDir, cls, root = DATA_ROOT_DEFAULT, pending = [], busy = () => [], move = true })
{
    const abs = (rel) => path.join(projectDir, ...rel.split('/'));
    const want = targetOf(cls, root);
    if (hasData(abs(want))) return { dir: want, state: 'current' };
    const line = pending.find((r) => r.cls === cls && r.to === want);
    if (line && hasData(abs(line.from)))
    {
        if (!move) return { dir: line.from, state: 'pending' };
        const held = busy(abs(line.from));
        if (held.length) return { dir: line.from, state: 'busy', why: held.join(', ') };
        const moved = movePlace({ projectDir, cls, from: line.from, to: want });
        if (moved.state === 'moved') return { dir: want, state: 'moved', from: line.from, ...('linked' in moved ? { linked: moved.linked, why: moved.why } : {}) };
        // Another server's start may have made the same move a moment ago: its result is the answer.
        if (hasData(abs(want)) && !hasData(abs(line.from))) return { dir: want, state: 'current' };
        return { dir: line.from, state: 'failed', why: moved.why || moved.state };
    }
    const legacy = [sharedBrowserOf(cls, root), legacyOf(cls)].find((p) => p && p !== want && hasData(abs(p)));
    if (legacy) return { dir: legacy, state: 'legacy' };
    return { dir: want, state: 'fresh' };
}

// ------------------------------------------------------------------ the navigation server's own config

// serena reads its per-project folder from `project_serena_folder_location` in <SERENA_HOME>/serena_config.yml
// (serena 1.7.0; no CLI flag exists). The key is the stack's to set when absent, serena's own default
// ($projectDir/.serena) or an earlier root of the stack's; any other value is the user's central path.
// A file that does not exist yet gets the one key serena requires (`projects`) - every other field
// defaults on load. `folder` is the project-relative folder serena's data lives in this start.
// 'written' | 'appended' | 'rewritten' | 'current' | 'kept'.
const FOLDER_KEY = 'project_serena_folder_location';
function ensureSerenaConfig(homeAbs, folder = `${DATA_ROOT_DEFAULT}/serena`)
{
    const file = path.join(homeAbs, 'serena_config.yml');
    const want = `"$projectDir/${folder}"`;
    const line = `${FOLDER_KEY}: ${want}`;
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }
    if (text === null)
    {
        fs.mkdirSync(homeAbs, { recursive: true });
        fs.writeFileSync(file, `# Written by alfred-code: the per-project folder under the data root (ALFRED_CODE_DATA_PATH).\n${line}\nprojects: []\n`);
        return 'written';
    }
    const at = new RegExp(`^${FOLDER_KEY}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, 'm');
    const m = at.exec(text);
    if (!m)
    {
        writeText(file, `${text.replace(/\n*$/, '\n')}# Added by alfred-code: the per-project folder under the data root.\n${line}\n`);
        return 'appended';
    }
    const value = m[1].replace(/^(["'])(.*)\1$/, '$2');
    if (value === `$projectDir/${folder}`) return 'current';
    const stacks = value === '$projectDir/.serena' || /^\$projectDir\/[^\s$]+\/serena$/.test(value);
    if (!stacks) return 'kept';
    writeText(file, text.replace(at, line));
    return 'rewritten';
}

module.exports = {
    DATA_ROOT_DEFAULT, MEMORY_FOLDER, LEGACY_MEMORY_FOLDER, MOBILE_FOLDER, SENSITIVE_FILE, sensitivePlaceOf, readSensitive, withSensitive, adoptCredentials, ENGINES, LEGACY, SHARED_BROWSER, engineServer, engineOfServer, ENGINE_SERVER, sharedBrowserOf, isRelayout,
    checkDataPath, dataRootOf, layout, targetOf, rootOfPlace, legacyOf,
    DATA_IGNORE_HEAD, DOCS_STATE_IGNORE, docsInsideRoot, dataIgnoreText, ensureRootIgnore, SENSITIVE_DEFAULT, ensureSensitiveFile,
    memoryDbFor, memoryLevelOf, legacyTwinOf, homeTwinOf, liveMemoryDb,
    busyDbs, profileLocks, serenaBusy, serenaPids, writeText, moveEntry, movePlace, moveHomeMemory,
    dataMovePlan, renderPending, readPending, pendingOf, liveDir, ensureSerenaConfig,
};
