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
// Where 2.0.0 kept each server's data, relative to the project (the docs' old root is docs.js LEGACY_DOCS_ROOT).
const LEGACY = { serena: '.serena', browser: '.playwright', memory: LEGACY_MEMORY_FOLDER };

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
        browser: (engine) => `${root}/browser/${engine}`,
        memory: `${root}/${MEMORY_FOLDER}`,
        memoryDb: `${root}/${MEMORY_FOLDER}/memory.db`,
    };
}

// The server-data CLASSES a move carries: `serena`, `browser-<engine>`, `memory` (the project level's
// folder). Each has one place under the root and one 2.0.0 place.
function targetOf(cls, root = DATA_ROOT_DEFAULT)
{
    if (cls === 'serena') return `${root}/serena`;
    if (cls === 'memory') return `${root}/${MEMORY_FOLDER}`;
    const m = /^browser-(.+)$/.exec(cls);
    return m ? `${root}/browser/${m[1]}` : null;
}
// The data root a class's place sits under - the inverse of targetOf; null for a 2.0.0 place or a foreign one.
function rootOfPlace(cls, rel)
{
    const suffix = targetOf(cls, '').slice(1);   // 'serena', 'browser/<engine>', '.alfred-memory'
    const root = String(rel || '').endsWith(`/${suffix}`) ? rel.slice(0, -(suffix.length + 1)) : '';
    return root && checkDataPath(root).ok ? root : null;
}

function legacyOf(cls)
{
    if (cls === 'serena') return LEGACY.serena;
    if (cls === 'memory') return LEGACY.memory;
    const m = /^browser-(.+)$/.exec(cls);
    return m ? `${LEGACY.browser}/${m[1]}` : null;
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

// The database a reader should open for a configured path: the path itself once it exists, else its old
// twin while that one has not moved yet - so a server and the session-start hook read the same memories
// in the window between an update and the move.
function liveMemoryDb(p, { home, projectRoot } = {})
{
    if (!p || exists(p)) return p;
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

// ------------------------------------------------------------------ moving

const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
// A folder holding nothing but a `.gitignore` holds no data: the installer's ignore files land before a
// launcher moves the data in, and must never read as the data already being there.
const isEmptyDir = (p) => { try { return fs.readdirSync(p).every((n) => n === '.gitignore'); } catch { return false; } };

// One folder, one rename: 'moved', 'absent' (nothing there, or a link or file that is not ours to move),
// 'conflict' (the target already holds data - neither side is touched) or 'failed' (the rename refused:
// EBUSY / EPERM on Windows for a folder a process holds, EXDEV across filesystems).
function moveEntry(from, to)
{
    if (!isDir(from)) return { state: 'absent' };
    if (fs.existsSync(to))
    {
        if (!isEmptyDir(to)) return { state: 'conflict' };
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
function moveHomeMemory({ home, platform = process.platform } = {})
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
        if (platform === 'win32') fs.symlinkSync(to, from, 'junction');
        else fs.symlinkSync(MEMORY_FOLDER, from, 'dir');
        return { state: 'moved', from, to, linked: true };
    }
    catch (err) { return { state: 'moved', from, to, linked: false, why: err.code || err.message }; }
}

// ------------------------------------------------------------------ the move plan and the pending record

const hasData = (p) => isDir(p) && !isEmptyDir(p);

// One row per class whose data sits somewhere other than its place under `root`: the prior root's place
// first (a root change), then the 2.0.0 place. `conflict` when the target already holds data too. The
// classes are the kept engines' profiles, serena, and the memory folder only at the project level.
function dataMovePlan({ projectRoot, root, prior = null, engines = [], memory = false })
{
    const abs = (rel) => path.join(projectRoot, ...rel.split('/'));
    const classes = ['serena', ...engines.map((e) => `browser-${e}`), ...(memory ? ['memory'] : [])];
    const rows = [];
    for (const cls of classes)
    {
        const to = targetOf(cls, root);
        const from = [prior && prior !== root ? targetOf(cls, prior) : null, legacyOf(cls)]
            .filter((c) => c && c !== to).find((c) => hasData(abs(c)));
        if (from) rows.push({ cls, from, to, conflict: hasData(abs(to)) });
    }
    return rows;
}

// `data-pending: <class> <from> -> <to>` - the move the installer recorded for a launcher to make. Read
// back strictly: a class the stack knows, and two relative paths that stay inside the project.
const CLASS = /^(serena|memory|browser-[a-z]+)$/;
const renderPending = (rows) => rows.map((r) => `data-pending: ${r.cls} ${r.from} -> ${r.to}`);
function readPending(text)
{
    const out = [];
    for (const m of String(text || '').matchAll(/^data-pending: *(\S+) +(\S+) +-> +(\S+) *$/gm))
    {
        const [, cls, from, to] = m;
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
// place serves this start; 'legacy' - no move was agreed, the 2.0.0 place serves; 'fresh' - nothing yet.
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
        const moved = moveEntry(abs(line.from), abs(want));
        if (moved.state === 'moved') return { dir: want, state: 'moved', from: line.from };
        // Another server's start may have made the same move a moment ago: its result is the answer.
        if (hasData(abs(want)) && !hasData(abs(line.from))) return { dir: want, state: 'current' };
        return { dir: line.from, state: 'failed', why: moved.why || moved.state };
    }
    const legacy = legacyOf(cls);
    if (legacy && legacy !== want && hasData(abs(legacy))) return { dir: legacy, state: 'legacy' };
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
        fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}# Added by alfred-code: the per-project folder under the data root.\n${line}\n`);
        return 'appended';
    }
    const value = m[1].replace(/^(["'])(.*)\1$/, '$2');
    if (value === `$projectDir/${folder}`) return 'current';
    const stacks = value === '$projectDir/.serena' || /^\$projectDir\/[^\s$]+\/serena$/.test(value);
    if (!stacks) return 'kept';
    fs.writeFileSync(file, text.replace(at, line));
    return 'rewritten';
}

module.exports = {
    DATA_ROOT_DEFAULT, MEMORY_FOLDER, LEGACY_MEMORY_FOLDER, ENGINES, LEGACY,
    checkDataPath, dataRootOf, layout, targetOf, rootOfPlace, legacyOf,
    memoryDbFor, memoryLevelOf, legacyTwinOf, liveMemoryDb,
    busyDbs, profileLocks, moveEntry, moveHomeMemory,
    dataMovePlan, renderPending, readPending, pendingOf, liveDir, ensureSerenaConfig,
};
