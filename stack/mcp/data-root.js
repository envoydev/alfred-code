'use strict';
// THE PROJECT DATA ROOT - one folder, `.alfred` by default, for what the stack keeps for a project: the docs, the hooks'
// state and statistics (stack/hooks/layout.js) and the project's sensitive data. The ONE home of where each lives, read by
// the installer, init's plan, the preflight and the hooks, so none can disagree.
//
//   ALFRED_CODE_DATA_PATH   the root, relative to the project, never under `.claude/` (Claude Code prompts for every
//                           write there). Read like every stack setting outside a session: the shell env, then
//                           settings.local.json, settings.json and the account settings.json (settingFrom).
//
// What moves, and who moves it: the docs move inline with the installer (docs.docsMovePlan), and the sensitive-data file
// with a root change, into a root whose .gitignore is written first. The stack ships no MCP server since 2.10.1, so no
// server's data is moved: what an older release's navigation index, browser profiles or memory database left under the
// root stays where it is, kept out of git by the root's own .gitignore.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_ROOT_DEFAULT = '.alfred';
// The four browser engines an older release ran one server each for (`<engine>-control`) - read back from an old
// install's stamp and registrations, never written.
const ENGINES = ['chrome', 'msedge', 'firefox', 'webkit'];
const engineServer = (engine) => `${engine}-control`;
const ENGINE_SERVER = new RegExp(`^(${ENGINES.join('|')})-control$`);
const engineOfServer = (name) => (ENGINE_SERVER.exec(String(name)) || [])[1];
// The project's own secret store, a dotenv the user fills by hand (the user's ruling of 2026-10-13): every value in it is
// a credential to stack/hooks/guard-secret-value.js.
const SENSITIVE_FILE = '.sensitive-data';

// ------------------------------------------------------------------ the setting

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset. This file is read where hook-prelude.js is not beside it
// (the installer, a plugin-root script), so its own copy of envOf is inline - pinned with the hooks' copy as env-reader
// (meta/shared-rules.json).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}

// One ALFRED_CODE_<suffix> setting as a script outside a session sees it: the shell env, then this machine's file before
// the shared one, the way Claude Code layers them - the files are read here, since no session hands their env over. '' when none of them names it. `key` reads another tool's own variable
// by its exact name instead (UV_EXCLUDE_NEWER), with no ALFRED_CODE_ or legacy spelling.
function settingFrom({ env, projectDir, suffix, key })
{
    const read = key ? (e) => e[key] : (e) => envOf(e, suffix);
    const own = String(read(env) || '').trim();
    if (own || !projectDir) return own;
    const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const file of [
        path.join(projectDir, '.claude', 'settings.local.json'),
        path.join(projectDir, '.claude', 'settings.json'),
        path.join(account, 'settings.json'),
    ])
    {
        try
        {
            const value = String(read((JSON.parse(fs.readFileSync(file, 'utf8')) || {}).env || {}) || '').trim();
            if (value) return value;
        }
        catch { /* absent, unreadable or malformed: the next file answers */ }
    }
    return '';
}

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

// Where a class of the stack's data lives under a root: only `sensitive` (the .sensitive-data FILE, which a root change
// takes along) since 2.10.1 - null for any other class.
function targetOf(cls, root = DATA_ROOT_DEFAULT)
{
    return cls === 'sensitive' ? `${root}/${SENSITIVE_FILE}` : null;
}
// The data root a class's place sits under - the inverse of targetOf; null for a 2.0.0 place or a foreign one.
function rootOfPlace(cls, rel)
{
    const place = targetOf(cls, '');
    if (!place) return null;
    const suffix = place.slice(1);   // '.sensitive-data'
    const root = String(rel || '').endsWith(`/${suffix}`) ? rel.slice(0, -(suffix.length + 1)) : '';
    return root && checkDataPath(root).ok ? root : null;
}

// ------------------------------------------------------------------ the root's own .gitignore

// THE ONE .gitignore the stack writes (the user's ruling of 2026-10-13: one file, at the data root). Everything under
// the root is this machine's - the sensitive data, and whatever an older release's servers left there (a navigation
// index, browser profiles holding session cookies, a memory database) - EXCEPT the docs, which follow
// ALFRED_CODE_DOCS_VERSIONING. `local` keeps them out too; `git` (and a mode nobody has set yet) re-includes the docs
// folder and keeps out only the two machine-local files under it - the hooks' state and ledgers sit beside the docs
// since 2.8.0 (`state/`, `statistics/`, stack/hooks/layout.js), which `/*` keeps out. A bare `*` would hide the docs from git under `git`,
// `git check-ignore` would then answer yes for them, and the versioning seed would read every fresh project as
// `local`. The file re-includes ITSELF, so it is committed and a teammate's clone has it. The header line marks it as the stack's: any other text is the project's own and is left alone. One home,
// read by the installer (docs.ensureDataIgnore) and by the sensitive-data move (ensureRootIgnore).
// A docs root OUTSIDE this root keeps its own file (docs.ensureDocsIgnore) - no file of the stack's reaches it.
const DATA_IGNORE_HEAD = '# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local';
// What stays machine-local under the docs root, relative to it: never committed, whatever the versioning. The hooks' state
// left in 2.8.0 for the data root's state/ and statistics/ (docs.migrateLayout), but its old homes stay listed for the 2.x
// line: a session started before the update writes them again, and a hand-set root keeps them until its move is answered
// (temp-project matrix, 2026-10-21). A history record is `<session>.json`, so a team's own docs/history/ notes stay in git.
// The two personal preferences docs are one user's answer style and code taste, never the team's (audit 2026-10-21 Q-1, the
// user's standing ruling to take the Recommended option); the preferences hook reads a linked worktree's from the main
// checkout. `.branches/` is never written under `git`, and `local` keeps the root out.
const DOCS_STATE_IGNORE = [
    "# the hooks' state before 2.8.0, which a session started before the update still writes",
    '/flow/', '/hook-blocks/', '/history/*.json', '/tools-usage/', '/docs-log.jsonl', '/usage-report/**/*.jsonl',
    "# the run book's credentials file before 2026-10-13, which an older capture still writes",
    '/project-capabilities/credentials.local.env',
    "# the awareness capture's inventory names this machine's plugins",
    '/awareness/AGENTS-AWARENESS.md',
    "# the user's own preferences - how they want the assistant to work, and their code taste",
    '/preferences/PERSONAL-PREFERENCES.md', '/preferences/PERSONAL-CODE-PREFERENCES.md',
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
    return `${DATA_IGNORE_HEAD}; the docs under it are committed (ALFRED_CODE_DOCS_VERSIONING=git) but for the lines below\n`
        + `/*\n!/.gitignore\n!/${rel.split('/')[0]}/\n${state.join('\n')}\n`;
}

// Before the sensitive-data file lands in a root: the file is written only when absent (the installer keeps it current),
// with the docs root and versioning the settings name - else `<root>/docs`, what every install writes, and the committed
// shape.
// 'written' | 'present'.
function ensureRootIgnore({ projectDir, root, env = process.env })
{
    const base = path.join(projectDir, ...String(root).split('/'));
    const file = path.join(base, '.gitignore');
    if (fs.existsSync(file)) return 'present';
    const docsPath = settingFrom({ env, projectDir, suffix: 'DOCS_PATH' }) || `${root}/docs`;
    const mode = String(settingFrom({ env, projectDir, suffix: 'DOCS_VERSIONING' }) || '').trim().toLowerCase();
    fs.mkdirSync(base, { recursive: true });
    // `wx`: another run at the same moment may have written it - its file stands.
    try { fs.writeFileSync(file, dataIgnoreText({ root, docsPath, mode }), { flag: 'wx' }); }
    catch (err) { if (err.code === 'EEXIST') return 'present'; throw err; }
    return 'written';
}

// A text write that survives a Windows Hidden or System attribute. Node opens a file for 'w' with
// CREATE_ALWAYS, which Windows refuses (EPERM) on a hidden file unless the open asks for the attribute
// too - measured on a file carrying 'H', whose write failed. An existing file is then opened in place, truncated and
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

// The sensitive-data file from `from` to `to` (both project-relative), into a root whose .gitignore is written first - it
// never lands in a root its .gitignore does not cover yet, not even for one moment. { state (moveEntry's), why? }.
function movePlace({ projectDir, cls, from, to })
{
    if (cls !== 'sensitive') return { state: 'absent' };
    const abs = (rel) => path.join(projectDir, ...rel.split('/'));
    const root = rootOfPlace(cls, to);
    try { if (root) ensureRootIgnore({ projectDir, root }); }
    catch (err) { return { state: 'failed', why: `${to} has no .gitignore yet (${err.code || err.message})` }; }
    return moveEntry(abs(from), abs(to), { file: true });
}

// ------------------------------------------------------------------ the project's sensitive data

// The dotenv reading is the twin of guard-secret-value.js (DOTENV_LINE, unquote - the hooks ship apart from this folder on
// the copy route); a test holds the two to the same fixture.
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
// A store's bytes as { KEY: value } - the clash check below, and the tests that hold this reader to the guard's.
const storeValues = (buf) => Object.fromEntries(dotenvPairs(dotenvText(buf)).map((p) => [p.key, p.value]));

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
    const have = buf ? storeValues(buf) : {};
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
        // The run book left this folder on 2026-10-15 (docs.js DOCS_MIGRATIONS): emptied now, it goes in this same run,
        // so the next one has nothing left to do. Anything still in it - the run book itself, a .gitignore - keeps it.
        try { fs.rmdirSync(folder); } catch { /* not empty */ }
    }
    catch (err) { return { state: 'failed', ...at, why: err.code || err.message }; }
    // The run book names the file by a path ending in its name, backticked or bare: each spelling becomes the store's.
    // It sits in awareness/ once an install moved it there (2026-10-16, docs.js DOCS_MIGRATIONS), at its 2026-10-15 or
    // its first home before.
    let repointed = 0;
    for (const book of [path.resolve(projectDir, String(docsPath), 'awareness', 'PROJECT-AWARENESS.md'),
        path.resolve(projectDir, String(docsPath), 'project-awareness', 'PROJECT-AWARENESS.md'), path.join(folder, 'PROJECT-CAPABILITIES.md')])
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

// One row when the sensitive-data file sits under the PRIOR root (a root change) and not under this one - the one thing
// a root change moves. `conflict` when the target already holds a file too.
function dataMovePlan({ projectRoot, root, prior = null })
{
    const abs = (rel) => path.join(projectRoot, ...rel.split('/'));
    if (!prior || prior === root) return [];
    const from = targetOf('sensitive', prior);
    const to = targetOf('sensitive', root);
    return isFile(abs(from)) ? [{ cls: 'sensitive', from, to, conflict: isFile(abs(to)) }] : [];
}

// `data-pending: sensitive <from> -> <to>` - a sensitive-data move an earlier run could not make, retried by the next. Read
// back strictly: two relative paths that stay inside the project. A line an older release recorded for a server's data
// (serena, memory, an engine) is no move any more and is not read.
const renderPending = (rows) => rows.map((r) => `data-pending: ${r.cls} ${r.from} -> ${r.to}`);
function readPending(text)
{
    const out = [];
    for (const m of String(text || '').matchAll(/^data-pending: *(\S+) +(\S+) +-> +(\S+) *$/gm))
    {
        const [, cls, from, to] = m;
        if (cls !== 'sensitive' || !checkDataPath(from).ok || !checkDataPath(to).ok) continue;
        out.push({ cls, from, to });
    }
    return out;
}

module.exports = {
    DATA_ROOT_DEFAULT, SENSITIVE_FILE, adoptCredentials, ENGINES, engineServer, engineOfServer, ENGINE_SERVER, settingFrom,
    checkDataPath, dataRootOf, targetOf, rootOfPlace,
    DATA_IGNORE_HEAD, DOCS_STATE_IGNORE, docsInsideRoot, dataIgnoreText, ensureRootIgnore, SENSITIVE_DEFAULT, ensureSensitiveFile, storeValues,
    writeText, moveEntry, movePlace, dataMovePlan, renderPending, readPending,
};
