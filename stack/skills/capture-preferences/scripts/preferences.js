#!/usr/bin/env node
// preferences.js - the scripted half of /capture-preferences: measures each preference's `Check:` over the changed
// files or the tree, holds the four entry docs to their shape and their size caps and the git doc to its locked
// entries. No rule is written: the shipped alfred-preferences.md names the docs and says when each is read (the user's
// ruling of 2026-10-21). Node built-ins only - no install, no network.
//
// Usage, from the project root:
//   node .claude/skills/capture-preferences/scripts/preferences.js check [--diff [<base>] | --all] [--area code|architecture|git]
//                     --diff alone reads the files changed since HEAD plus the untracked ones; after a commit, name the base
//   node .../preferences.js lint      the docs' shape, the locked git entries and the three caps; exits 1 on a problem
//   node .../preferences.js next --area personal|code|architecture|git   the id a new entry takes
//   node .../preferences.js reach [--id <id>]   what each code or architecture entry's Scope: takes, and its Check: outside it
//   --project <dir>   the project root (default: the current directory)
//
// A `Check:` is DATA, never a command: regex `<pattern>` in `<glob>`[, `<glob>`] [excluding `<glob>`[, `<glob>`]].
// A shell command in a committed doc would run whatever a teammate wrote; a regex cannot. `check` always exits 0 -
// it measures, a verifier judges.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
// The house git lines the installer seeds GIT-PREFERENCES.md with; its locked entries are what lint holds the doc to.
const GIT_SEED = path.join(SKILL_DIR, 'references', 'git-seed.md');
const PREFS_DIR = 'preferences';
// The four docs of the user's own words. PROJECT-CODE-PREFERENCES.md beside them is the code-style capture's doc of
// language sections: read on the code trigger, never entry-linted here. The personal doc (how the user wants the
// assistant to work, 2026-10-21) is PUSHED at every session start, so it has no `Check:` and a cap of its own.
const DOCS = [
    { area: 'code', file: 'PERSONAL-CODE-PREFERENCES.md', prefix: 'C' },
    { area: 'architecture', file: 'ARCHITECTURE-PREFERENCES.md', prefix: 'A' },
    { area: 'git', file: 'GIT-PREFERENCES.md', prefix: 'G' },
    { area: 'personal', file: 'PERSONAL-PREFERENCES.md', prefix: 'P', pushed: true },
];
const AREAS = DOCS.map((d) => d.area);
// The name the personal code doc had until 2026-10-21; an update renames it (install/docs.js).
const OLD_CODE_DOC = 'CODE-PREFERENCES.md';
// The first git write's hold hands the git doc over whole (the user's ruling S-Q3 of 2026-10-21), inside the hook's
// 7,000-char room. The first edit's hold hands the personal code and architecture docs over entry by entry, in parts past
// one room (the user's ruling of 2026-10-22: the hand-over is capped, never the user's docs), so CAP binds one entry
// there and their sum is only noted. The personal doc rides every session start and every compaction, so it stays under
// 1K tokens.
const CAP = 5000;
const GIT_CAP = 5000;
const PERSONAL_CAP = 3000;
// The house keys a git entry may be locked by - the seed's, read when it is beside this script.
const HOUSE_KEYS = ['consent', 'scope', 'checkpoint', 'safety'];
const LINE_CUT = 160;
// A source file past this is generated or vendored, never a preference's subject.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- the docs root

// This script ships inside a skill with no hook-prelude.js beside it, so it reads the settings itself: the environment,
// then settings.local.json over settings.json (R99). The docs root is <data root>/docs (2.8.0, the user's ruling of
// 2026-10-20); a leftover ALFRED_CODE_DOCS_PATH, which an update moves and removes, is still read first for the 2.x line.
function setting(projectRoot, key)
{
    if (process.env[key]) return process.env[key];
    for (const file of ['settings.local.json', 'settings.json'])
    {
        try
        {
            const env = (JSON.parse(readText(path.join(projectRoot, '.claude', file)) || '{}') || {}).env || {};
            if (env[key]) return env[key];
        }
        catch { /* a malformed settings file is the next one's case, not a failure */ }
    }
    return undefined;
}
// The data root read as the hooks' layout.js reads it (`./` and an empty value are `.alfred`), so both find one folder.
const dataRoot = (projectRoot) => String(setting(projectRoot, 'ALFRED_CODE_DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.alfred';
const docsRoot = (projectRoot) => setting(projectRoot, 'ALFRED_CODE_DOCS_PATH') || `${dataRoot(projectRoot)}/docs`;

const prefsDir = (projectRoot) => path.resolve(projectRoot, docsRoot(projectRoot), PREFS_DIR);

// A doc that is a link is never read - the hooks paste what they read, and a cloned repo could point one at a credential
// store (audit 2026-10-21 PF-1); lint names it.
const isLink = (file) => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };

// The main checkout of a linked worktree, read from git's own files as the hooks read it (hook-prelude.js checkoutsOf),
// or null: the `.git` file's `gitdir:`, then that dir's `commondir`.
function mainCheckout(projectRoot)
{
    const text = readText(path.join(projectRoot, '.git'));
    const line = text && /^gitdir:\s*(.+?)\s*$/m.exec(text);
    if (!line) return null;
    const gitdir = path.resolve(projectRoot, line[1]);
    const commondir = readText(path.join(gitdir, 'commondir'));
    const common = commondir ? path.resolve(gitdir, commondir.trim())
        : path.basename(path.dirname(gitdir)) === 'worktrees' ? path.dirname(path.dirname(gitdir)) : null;
    return common && path.basename(common) === '.git' ? path.dirname(common) : null;
}

// Where each doc is looked for, in order: this checkout, then a linked worktree's main checkout - the personal docs are
// git-ignored (audit 2026-10-21 Q-1), so a seat's worktree has none of its own.
const prefsDirs = (projectRoot) =>
{
    const main = mainCheckout(projectRoot);
    return [...new Set([prefsDir(projectRoot), ...(main ? [path.resolve(main, docsRoot(projectRoot), PREFS_DIR)] : [])])];
};

// The dirs a READER walks (R3): this project's own (prefsDirs, nothing skipped), then each linked workspace member's,
// nearest first. A copy with no layout.js beside the hooks, or an older one, reads the own alone; no capture writes, lints
// or numbers through this list.
function readDirs(projectRoot, { env = process.env } = {})
{
    const own = prefsDirs(projectRoot).map((dir) => ({ dir, skip: new Set() }));
    let up = [];
    try
    {
        const layout = require(path.join(__dirname, '..', '..', '..', 'hooks', 'layout.js'));
        if (typeof layout.ancestorPrefsDirs === 'function') up = layout.ancestorPrefsDirs(projectRoot, { env });
    }
    catch { /* no layout beside the skill: the own dirs alone */ }
    return [...own, ...up];
}

// The entry docs that exist and hold text, in code, architecture, git, personal order. Each is read where it first sits;
// a link there is left out, never passed over for another copy.
function presentDocs(projectRoot, area = null)
{
    const dirs = prefsDirs(projectRoot);
    const exists = (file) => { try { fs.lstatSync(file); return true; } catch { return false; } };
    return DOCS.filter((d) => !area || d.area === area)
        .map((d) => ({ ...d, abs: dirs.map((dir) => path.join(dir, d.file)).find(exists) || path.join(dirs[0], d.file) }))
        .filter((d) => !isLink(d.abs)).map((d) => ({ ...d, text: readText(d.abs) }))
        .filter((d) => d.text !== null && d.text.trim() !== '');
}

// A path as the report names it: project-relative where it can be, so a line is pasteable.
const shown = (projectRoot, abs) =>
{
    const rel = path.relative(projectRoot, abs);
    return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs).split(path.sep).join('/');
};

// ---------------------------------------------------------------- one doc

const HEADING = /^## (.+?)\s*$/;
const ENTRY_ID = /^([A-Z])(\d+)\b/;
const ID_LINE = /^<!--\s*id:\s*([^\s]+)\s*-->\s*$/;
const FIELD = /^- (Rule|Scope|Why|Except|Check):\s*(.*?)\s*$/;
const LOCKED_LINE = /^<!--\s*locked:\s*([a-z][a-z-]*)\s*-->\s*$/;
// The ids removed from a doc, so the next entry skips them - an id is never reused.
const RETIRED = /^Retired:\s*(.*?)\s*$/m;
const GLOBS = String.raw`\x60[^\x60]+\x60(?:\s*,\s*\x60[^\x60]+\x60)*`;
const CHECK = new RegExp(String.raw`^regex \x60([^\x60]+)\x60 in (${GLOBS})(?:\s*,?\s*excluding (${GLOBS}))?$`);
// What a shell command looks like when it was written where a regex belongs.
const COMMAND = /\$\(|\||;|&&|>|^\s*(?:grep|rg|find|sh|bash|node|npm|npx|git|cat|ls)\b/;
const globsOf = (s) => [...String(s || '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
const listOf = (s, sep) => String(s || '').split(sep).map((x) => x.replace(/`/g, '').trim()).filter(Boolean);
// A Scope: value's parts: its commas outside a `{a,b}` glob, so `src/**/*.{ts,tsx}` stays one glob (review 2026-10-23).
function scopeParts(value)
{
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const c of String(value || ''))
    {
        if (c === '{') depth++;
        else if (c === '}' && depth) depth--;
        if (c === ',' && !depth) { parts.push(cur); cur = ''; }
        else cur += c;
    }
    parts.push(cur);
    return parts.map((x) => x.replace(/`/g, '').trim()).filter(Boolean);
}

// The `Check:` value as data, or null when it is not the grammar.
function parseCheck(value)
{
    const m = CHECK.exec(String(value || '').trim());
    return m ? { regex: m[1], include: globsOf(m[2]), exclude: globsOf(m[3]) } : null;
}

// Every `##` section with what lint needs beside the fields: the heading, its id line, the raw Check: text. A fenced
// block is the entry's text: a `## ` line or a field inside one is an example, never read (audit 2026-10-21 PF-19).
const FENCE = /^\s*(`{3,}|~{3,})/;
// `field` is the doc's field pattern: the four entry docs' by default, the tools doc's own from tools.js.
function parseSections(text, field = FIELD)
{
    const out = [];
    let cur = null;
    let fence = null;
    for (const line of String(text || '').split(/\r?\n/))
    {
        const fm = FENCE.exec(line);
        if (fence) { if (fm && fm[1][0] === fence) fence = null; continue; }
        if (fm) { fence = fm[1][0]; continue; }
        const h = HEADING.exec(line);
        if (h)
        {
            const id = ENTRY_ID.exec(h[1]);
            cur = { heading: h[1], id: id ? `${id[1]}${id[2]}` : null, title: h[1].replace(/^[A-Z]\d+\s*-\s*/, ''), idLine: null, locked: null, fields: {} };
            out.push(cur);
            continue;
        }
        if (!cur) continue;
        const idLine = ID_LINE.exec(line.trim());
        if (idLine && cur.idLine === null) { cur.idLine = idLine[1]; continue; }
        const locked = LOCKED_LINE.exec(line.trim());
        if (locked && cur.locked === null) { cur.locked = locked[1]; continue; }
        const f = field.exec(line);
        if (f && !(f[1] in cur.fields)) cur.fields[f[1]] = f[2];
    }
    return out;
}

// The doc's own Retired: line sits above its first entry; one inside an entry's body is that entry's text.
function headOf(text)
{
    const out = [];
    let fence = null;
    for (const line of String(text || '').split(/\r?\n/))
    {
        const f = FENCE.exec(line);
        if (fence) { if (f && f[1][0] === fence) fence = null; continue; }
        if (f) { fence = f[1][0]; continue; }
        if (HEADING.test(line)) break;
        out.push(line);
    }
    return out.join('\n');
}
const retiredIds = (text) => listOf((RETIRED.exec(headOf(text)) || [])[1], /,/);

// Each entry's span - its heading to the next one, a fenced `## ` line staying text - and its size, trailing blanks out.
function entrySpans(text)
{
    const out = [];
    let cur = null;
    let fence = null;
    for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n'))
    {
        const fm = FENCE.exec(line);
        if (fence) { if (fm && fm[1][0] === fence) fence = null; }
        else if (fm) fence = fm[1][0];
        else
        {
            const h = HEADING.exec(line);
            if (h) { const id = ENTRY_ID.exec(h[1]); cur = { heading: h[1], id: id ? `${id[1]}${id[2]}` : null, lines: [] }; out.push(cur); }
        }
        if (cur) cur.lines.push(line);
    }
    return out.map((e) => ({ heading: e.heading, id: e.id, chars: e.lines.join('\n').trimEnd().length }));
}

function parseDoc(text)
{
    return parseSections(text).map((s) => ({
        id: s.id,
        title: s.title,
        rule: s.fields.Rule || '',
        scope: scopeParts(s.fields.Scope),
        why: s.fields.Why || '',
        except: listOf(s.fields.Except, /;/),
        check: s.fields.Check === undefined ? null : parseCheck(s.fields.Check),
    }));
}

// ---------------------------------------------------------------- globs and files

// A glob as a path regex: `*` and `?` stay inside one segment, `**/` spans any number of them, `{a,b}` is either.
function globSource(glob)
{
    let out = '';
    for (let i = 0; i < glob.length; i++)
    {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*')
        {
            if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
            else { out += '.*'; i += 1; }
        }
        else if (c === '*') out += '[^/]*';
        else if (c === '?') out += '[^/]';
        else if (c === '{' && glob.indexOf('}', i) > i)
        {
            const end = glob.indexOf('}', i);
            out += `(?:${glob.slice(i + 1, end).split(',').map(globSource).join('|')})`;
            i = end;
        }
        else out += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
    }
    return out;
}
const globRe = (glob) => new RegExp(`^${globSource(glob.replace(/^\.\//, ''))}$`);

// What an entry's Scope: reaches - the one reader, preferences-session.js loads it from here: nothing
// when any part is a plain area ('every language', 'Node.js') - the hook hands such an entry over for every edit; else
// one test per glob, where a glob with no `/` matches the file name and a path with no glob character matches itself and
// everything under it.
function scopeOf(value)
{
    const parts = scopeParts(value);
    if (!parts.length || parts.some((x) => /\s/.test(x) || !/[*?/{]/.test(x))) return [];
    return parts.map((glob) =>
    {
        const g = glob.replace(/^\.?\//, '');
        if (!/[*?{]/.test(g)) { const dir = g.replace(/\/+$/, ''); return { glob, test: (t) => t === dir || t.startsWith(`${dir}/`) }; }
        const re = new RegExp(`^${globSource(g)}$`);
        return { glob, test: g.includes('/') ? (t) => re.test(t) : (t) => re.test(t.slice(t.lastIndexOf('/') + 1)) };
    });
}

function gitList(projectRoot, args)
{
    const r = spawnSync('git', ['-C', projectRoot, ...args, '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}

// Every file in the tree, .gitignore honoured; outside git, a walk that skips .git and node_modules.
function allFiles(projectRoot)
{
    const listed = gitList(projectRoot, ['ls-files', '-c', '-o', '--exclude-standard']);
    if (listed) return listed;
    const out = [];
    const walk = (dir, rel) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), r);
            else if (e.isFile()) out.push(r);
        }
    };
    walk(projectRoot, '');
    return out;
}

// The changed files: the diff against `base` (HEAD when none is named) plus the untracked ones; an unborn branch has
// everything new; null outside git.
function changedFiles(projectRoot, base = null)
{
    const untracked = gitList(projectRoot, ['ls-files', '-o', '--exclude-standard']);
    if (untracked === null) return null;
    const diff = gitList(projectRoot, ['diff', '--name-only', '--relative', base || 'HEAD']);
    if (diff) return [...diff, ...untracked];
    return base ? untracked : gitList(projectRoot, ['ls-files', '-c', '-o', '--exclude-standard']) || [];
}

function fileList(projectRoot, mode, base = null)
{
    const changed = mode === 'all' ? null : changedFiles(projectRoot, base);
    const rels = [...new Set(mode === 'all' ? allFiles(projectRoot) : changed || [])].sort();
    return rels.map((rel) => ({ rel: rel.split(path.sep).join('/'), abs: path.join(projectRoot, rel) }))
        .filter((f) => { try { return fs.statSync(f.abs).isFile(); } catch { return false; } });
}

// Each code or architecture entry's Scope: glob that reaches no file in the project, as { doc, id, glob }: the hook hands
// an entry over only where its Scope: reaches (the user's ruling of 2026-10-22), so a dead glob hides the entry from every
// edit. The file list is read once, and only when some entry names a glob.
function deadScopesIn(projectRoot, docs)
{
    const wanted = [];
    for (const d of docs.filter((x) => x.area === 'code' || x.area === 'architecture'))
        for (const s of parseSections(d.text))
            for (const part of scopeOf(s.fields.Scope)) wanted.push({ doc: d, id: s.id || s.heading, part });
    if (!wanted.length) return [];
    const files = allFiles(projectRoot);
    return wanted.filter((w) => !files.some((f) => w.part.test(f))).map((w) => ({ doc: w.doc, id: w.id, glob: w.part.glob }));
}
// The code and architecture docs in `dir` - the update's reads, which name the docs root it migrated (a linked doc is
// never read).
function codeDocsIn(dir)
{
    return DOCS.filter((d) => d.area === 'code' || d.area === 'architecture').map((d) =>
    {
        const abs = path.join(dir, d.file);
        return isLink(abs) ? null : { ...d, abs, text: readText(abs) };
    }).filter((d) => d && d.text !== null);
}
const deadScopes = (projectRoot, dir = prefsDir(projectRoot)) => deadScopesIn(projectRoot, codeDocsIn(dir));

// What each code or architecture entry's Scope: takes (null for a plain area or none: every edit), and the files its
// Check: measures outside it. A Scope: aimed at the wrong existing folder hides its entry from the edits meant, and no
// script can know the folder meant, so `reach` shows what each pattern takes and lint names the one mismatch a script can
// see (the user's ruling of 2026-10-22). The file list is read once, and only when some entry names a glob.
function reachIn(projectRoot, docs)
{
    let files = null;
    const list = () => files || (files = allFiles(projectRoot));
    const out = [];
    for (const d of docs.filter((x) => x.area === 'code' || x.area === 'architecture'))
        for (const s of parseSections(d.text))
        {
            const parts = scopeOf(s.fields.Scope);
            const check = parseCheck(s.fields.Check);
            const scoped = (f) => parts.some((p) => p.test(f));
            let outside = [];
            if (parts.length && check)
            {
                const include = check.include.map(globRe);
                const exclude = check.exclude.map(globRe);
                outside = list().filter((f) => include.some((g) => g.test(f)) && !exclude.some((g) => g.test(f)) && !scoped(f));
            }
            out.push({ doc: d, id: s.id || s.heading, scope: String(s.fields.Scope || '').replace(/`/g, '').trim(), reached: parts.length ? list().filter(scoped) : null, outside });
        }
    return out;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sampleOf = (files, n = 3) => { const s = [...files].sort(); return s.slice(0, n).join(', ') + (s.length > n ? `, and ${s.length - n} more` : ''); };
// The entries whose Check: measures files their Scope: does not reach, as { doc, id, count, sample } - the update names
// each on every run, as lint notes it.
const scopeMismatches = (projectRoot, dir = prefsDir(projectRoot)) => reachIn(projectRoot, codeDocsIn(dir))
    .filter((r) => r.outside.length).map((r) => ({ doc: r.doc, id: r.id, count: r.outside.length, sample: sampleOf(r.outside), files: plural(r.outside.length, 'file') }));
// The three commonest file types a Scope: takes - a wrong folder shows as the wrong language.
function tallyOf(files)
{
    const counts = new Map();
    for (const f of files) { const ext = path.posix.extname(f) || '(no extension)'; counts.set(ext, (counts.get(ext) || 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([ext, k]) => `${ext} ${k}`).join(', ');
}

// `reach` - one line per entry (or the one `--id` names): what its Scope: takes, and what its Check: measures outside it.
function reach(projectRoot, id = null)
{
    const want = id ? String(id).toUpperCase() : null;
    const rows = reachIn(projectRoot, presentDocs(projectRoot)).filter((r) => !want || String(r.id).toUpperCase() === want);
    if (want && !rows.length) { console.error(`reach: ${want} is no code or architecture entry`); return 1; }
    for (const r of rows)
    {
        const what = r.reached === null ? `every edit (${r.scope ? 'a plain area' : 'no Scope:'})`
            : !r.reached.length ? `no file yet - no edit is handed ${r.id} until one exists`
            : `${plural(r.reached.length, 'file')} (${tallyOf(r.reached)}): ${sampleOf(r.reached)}`;
        console.log(`reach: ${r.id} Scope: ${r.scope || '(none)'} -> ${what}`);
        if (r.outside.length) console.log(`reach: ${r.id} Check: reaches ${plural(r.outside.length, 'file')} its Scope: does not: ${sampleOf(r.outside)}`);
    }
    return 0;
}

// ---------------------------------------------------------------- check

// The entries' checks over `files` ({ rel, abs }, or a path relative to the current directory). An entry with no
// compilable check is passed over here; `check` names it.
function runCheck(entries, files)
{
    const list = files.map((f) => (typeof f === 'string' ? { rel: f.split(path.sep).join('/'), abs: path.resolve(f) } : f));
    const out = [];
    for (const entry of entries)
    {
        if (!entry.check) continue;
        let re;
        try { re = new RegExp(entry.check.regex); } catch { continue; }
        const include = entry.check.include.map(globRe);
        const exclude = entry.check.exclude.map(globRe);
        for (const f of list)
        {
            if (!include.some((g) => g.test(f.rel)) || exclude.some((g) => g.test(f.rel))) continue;
            let text;
            try { if (fs.statSync(f.abs).size > MAX_FILE_BYTES) continue; text = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
            if (text.includes('\0')) continue;
            text.split(/\r?\n/).forEach((line, i) =>
            {
                if (re.test(line)) out.push({ id: entry.id, file: f.rel, line: i + 1, text: line.trim().slice(0, LINE_CUT) });
            });
        }
    }
    return out;
}

function check(projectRoot, { mode, area, base = null })
{
    let files = null;
    // A --diff that reads no file an entry covers says why, so a clean run is never read as a pass (audit 2026-10-21
    // PF-18): after a commit the diff against HEAD is empty, and outside git there is none.
    const noGit = mode !== 'all' && changedFiles(projectRoot, base) === null;
    const scoped = new Set();
    let checked = 0;
    let violations = 0;
    // An entry with no Check: is judged by the reader, never run: its id is named after the summary (the by-hand line),
    // so a clean summary is never read as every entry passing.
    const byHand = [];
    for (const d of presentDocs(projectRoot, area).filter((x) => !x.pushed))
    {
        const sections = parseSections(d.text);
        const shared = new Set();
        for (const s of sections)
        {
            // a violation - or a by-hand judgement - cites its entry by id: with none, or one another entry holds, there
            // is nothing to cite, whichever kind the entry is
            if (!s.id) { console.log(`skipped: ${s.heading} - the heading names no entry id (\`## C1 - <title>\`, A1 or G1 by doc), so nothing is run`); continue; }
            if (sections.filter((o) => o.id === s.id).length > 1)
            {
                if (!shared.has(s.id)) console.log(`skipped: ${s.id} - more than one entry holds this id, so nothing is run for any of them`);
                shared.add(s.id);
                continue;
            }
            if (s.fields.Check === undefined) { byHand.push(s.id); continue; }
            const id = s.id;
            const parsed = parseCheck(s.fields.Check);
            if (!parsed) { console.log(`skipped: ${id} - the Check: is not regex \`<pattern>\` in \`<glob>\`, so nothing is run`); continue; }
            try { new RegExp(parsed.regex); }
            catch (err) { console.log(`skipped: ${id} - the Check: regex does not compile (${err.message})`); continue; }
            files = files || fileList(projectRoot, mode, base);
            const include = parsed.include.map(globRe);
            const exclude = parsed.exclude.map(globRe);
            for (const f of files) if (include.some((g) => g.test(f.rel)) && !exclude.some((g) => g.test(f.rel))) scoped.add(f.rel);
            const hits = runCheck([{ id, check: parsed }], files);
            for (const h of hits) console.log(`violation: ${h.id} ${h.file}:${h.line} ${h.text}`);
            checked++;
            violations += hits.length;
        }
    }
    console.log(`checked: ${checked} entries, ${violations} violations`);
    if (byHand.length) console.log(`by hand: ${byHand.length} entries carry no Check: - judge each against the change: ${byHand.join(', ')}`);
    if (noGit) console.log('note: not a git repo - use --all');
    else if (mode !== 'all' && checked && !scoped.size)
        console.log(`note: no file changed since ${base || 'HEAD'} is in an entry's scope - after a commit, pass --diff <base> or --all`);
    return 0;
}

// ---------------------------------------------------------------- lint

// The seed's locked entries, key -> { title, fields }, whitespace-folded; empty when the seed is not beside this script.
function seedLocked()
{
    const text = readText(GIT_SEED);
    return new Map(parseSections(text || '').filter((s) => s.locked)
        .map((s) => [s.locked, { title: fold(s.title).toLowerCase(), fields: Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, fold(v)])) }]));
}
const fold = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const FIELDS = ['Rule', 'Scope', 'Why', 'Except', 'Check'];

function lint(projectRoot)
{
    const problems = [];
    const docs = presentDocs(projectRoot);
    const dir = prefsDir(projectRoot);
    for (const file of [...DOCS.map((d) => d.file), 'PROJECT-CODE-PREFERENCES.md', OLD_CODE_DOC])
        if (isLink(path.join(dir, file))) problems.push(`${shown(projectRoot, path.join(dir, file))} is a link - the hooks never read a linked doc; put the file itself there`);
    const old = path.join(dir, OLD_CODE_DOC);
    const oldText = isLink(old) ? null : readText(old);
    const newText = isLink(path.join(dir, DOCS[0].file)) ? null : readText(path.join(dir, DOCS[0].file));
    // Both names (audit 2026-10-21 PF-21): an exact copy goes at the update; two texts are the user's to merge.
    if (oldText !== null && newText !== null && newText.trim())
    {
        problems.push(oldText.replace(/\r\n/g, '\n').trim() === newText.replace(/\r\n/g, '\n').trim()
            ? `${shown(projectRoot, old)} is an exact copy of ${DOCS[0].file} - /alfred-code:update deletes it`
            : `${OLD_CODE_DOC} and ${DOCS[0].file} both hold entries - merge the old one into the new by hand, then delete it; the update never overwrites either`);
    }
    else if (oldText !== null) problems.push(`${shown(projectRoot, old)} is the old name of ${DOCS[0].file} - /alfred-code:update renames it`);
    const seen = new Map();
    const locked = seedLocked();
    for (const d of docs)
    {
        const file = shown(projectRoot, d.abs);
        if (!/^Updated: \d{4}-\d{2}-\d{2}\b/m.test(d.text)) problems.push(`${file}: no \`Updated: <date>\` line`);
        if (d.area === 'git')
        {
            const have = new Set(parseSections(d.text).map((s) => s.locked).filter(Boolean));
            for (const key of locked.keys()) if (!have.has(key)) problems.push(`${file}: the locked entry '${key}' is missing - /alfred-code:update puts it back`);
        }
        const retired = retiredIds(d.text);
        for (const id of retired) if (!new RegExp(`^${d.prefix}\\d+$`).test(id)) problems.push(`${file}: Retired: ${id} is not a ${d.prefix}<n> id`);
        for (const s of parseSections(d.text))
        {
            if (!s.id) { problems.push(`${file}: \`## ${s.heading}\` has no ${d.prefix}<n> id`); continue; }
            if (!s.id.startsWith(d.prefix)) problems.push(`${file}: ${s.id} is not a ${d.prefix}<n> id - this doc's entries are ${d.prefix}1, ${d.prefix}2, ...`);
            if (seen.has(s.id)) problems.push(`${file}: ${s.id} is used twice (first in ${seen.get(s.id)}) - an id is never reused`);
            else seen.set(s.id, file);
            if (retired.includes(s.id)) problems.push(`${file}: ${s.id} is retired - an id is never reused, take the next one (preferences.js next)`);
            if (s.idLine === null) problems.push(`${file}: ${s.id} has no <!-- id: --> line - docs.js show cannot read it alone`);
            else if (s.idLine.toLowerCase() !== s.id.toLowerCase()) problems.push(`${file}: ${s.id}'s id line says ${s.idLine}`);
            if (!s.fields.Rule) problems.push(`${file}: ${s.id} has no Rule: line`);
            // A locked entry is the seed's word for word, field by field (audit 2026-10-21 PF-4); a key the seed does not
            // lock is no house line, and a copy of a locked entry's title without the lock is a weakening of it.
            if (d.area === 'git' && s.locked && locked.size && !locked.has(s.locked))
                problems.push(`${file}: ${s.id} carries locked: ${s.locked} - only the house keys (${[...locked.keys()].join(', ')}) are locked; drop the line`);
            if (d.area === 'git' && s.locked && locked.has(s.locked))
            {
                const want = locked.get(s.locked).fields;
                for (const f of FIELDS.filter((k) => fold(s.fields[k]) !== (want[k] || '')))
                    problems.push(`${file}: ${s.id} is the locked '${s.locked}' entry and its ${f}: was changed - a locked entry is never edited; restore it from the seed`);
            }
            if (d.area === 'git' && !s.locked)
            {
                const twin = [...locked].find(([, v]) => v.title === fold(s.title).toLowerCase());
                if (twin) problems.push(`${file}: ${s.id} repeats the locked '${twin[0]}' entry's title without its lock - a locked entry is never edited; remove ${s.id}`);
            }
            if (s.fields.Check === undefined) continue;
            if (d.pushed) { problems.push(`${file}: ${s.id} carries a Check: - a personal entry has no code to grep; drop the line`); continue; }
            const parsed = parseCheck(s.fields.Check);
            if (!parsed)
            {
                problems.push(COMMAND.test(s.fields.Check)
                    ? `${file}: ${s.id} Check: is a shell command - only regex \`<pattern>\` in \`<glob>\` is run`
                    : `${file}: ${s.id} Check: is not regex \`<pattern>\` in \`<glob>\`[ excluding \`<glob>\`]`);
                continue;
            }
            try { new RegExp(parsed.regex); }
            catch (err) { problems.push(`${file}: ${s.id} Check: regex does not compile (${err.message})`); }
        }
    }
    // The edit hold's two docs have no doc cap (the user's ruling of 2026-10-22): the hook hands their entries over by
    // Scope:, without Check: lines, and in parts past one room - so only an entry no room holds whole is a problem.
    const notes = [];
    const codeDocs = docs.filter((d) => d.area === 'code' || d.area === 'architecture');
    for (const d of codeDocs)
        for (const e of entrySpans(d.text).filter((x) => x.chars > CAP))
            problems.push(`${shown(projectRoot, d.abs)}: ${e.id || `\`## ${e.heading}\``} is ${e.chars} chars, over ${CAP} - no hold hands it over whole; split it`);
    // A glob for files not written yet is fair, so a dead one is a note, never a problem.
    for (const x of deadScopesIn(projectRoot, codeDocs))
        notes.push(`${shown(projectRoot, x.doc.abs)}: ${x.id} Scope: \`${x.glob}\` reaches no file in the project - the first-edit hold hands ${x.id} over for no edit until one exists; fix the pattern if it is a typo`);
    // A Check: that measures files the Scope: never hands the entry over for is the one wrong-folder sign a script can see.
    for (const r of reachIn(projectRoot, codeDocs).filter((x) => x.outside.length))
        notes.push(`${shown(projectRoot, r.doc.abs)}: ${r.id} Check: reaches ${plural(r.outside.length, 'file')} its Scope: does not (${sampleOf(r.outside)}) - the first-edit hold hands ${r.id} over only where its Scope: reaches; widen the Scope: or narrow the Check:`);
    const chars = codeDocs.reduce((n, d) => n + d.text.length, 0);
    if (chars > CAP) notes.push(`${shown(projectRoot, prefsDir(projectRoot))}/: the personal code and architecture docs are ${chars} chars, past ${CAP} - the first edit's hold hands them over in parts (each entry where its Scope: reaches, no Check: lines), and every editing actor and every judging seat reads them; no cut needed`);
    for (const d of docs.filter((x) => x.area === 'git' && x.text.length > GIT_CAP))
        problems.push(`${shown(projectRoot, d.abs)} is ${d.text.length} chars, over ${GIT_CAP} - the first git write's hold hands it over; cut an entry that is not locked`);
    for (const d of docs.filter((x) => x.pushed && x.text.length > PERSONAL_CAP))
        problems.push(`${shown(projectRoot, d.abs)} is ${d.text.length} chars, over ${PERSONAL_CAP} - a hook pushes it at every session start; cut it`);
    for (const p of problems) console.log(`PROBLEM ${p}`);
    for (const n of notes) console.log(`note: ${n}`);
    console.log(`lint: ${problems.length} problems`);
    return problems.length ? 1 : 0;
}

// One past the highest number the area's doc has used, a retired one included: C1 for an absent doc.
function nextId(projectRoot, area)
{
    const d = DOCS.find((x) => x.area === area);
    const text = presentDocs(projectRoot, area)[0]?.text || '';
    const used = [...parseSections(text).map((s) => s.id), ...retiredIds(text)]
        .filter((id) => id && id.startsWith(d.prefix)).map((id) => Number(id.slice(1))).filter(Number.isInteger);
    console.log(`Next: ${d.prefix}${used.length ? Math.max(...used) + 1 : 1}`);
    return 0;
}

// ---------------------------------------------------------------- the command line

function main(argv)
{
    const [cmd, ...rest] = argv;
    const flag = (name) => rest.includes(name);
    const value = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
    const projectRoot = path.resolve(value('--project') || process.cwd());
    if (cmd === 'check')
    {
        const area = value('--area');
        if (area && !DOCS.some((d) => d.area === area)) { console.error(`preferences: --area is ${AREAS.join(', ')}, not '${area}'`); return 2; }
        const base = value('--diff');
        return check(projectRoot, { mode: flag('--all') ? 'all' : 'diff', area: area || null, base: base && !base.startsWith('--') ? base : null });
    }
    if (cmd === 'lint') return lint(projectRoot);
    if (cmd === 'reach') return reach(projectRoot, value('--id') || null);
    if (cmd === 'next')
    {
        const area = value('--area');
        if (!DOCS.some((d) => d.area === area)) { console.error('preferences: next needs --area personal|code|architecture|git'); return 2; }
        return nextId(projectRoot, area);
    }
    console.error('usage: preferences.js check [--diff [<base>] | --all] [--area code|architecture|git] | lint | next --area personal|code|architecture|git | reach [--id <id>]  [--project <dir>]');
    return 2;
}

module.exports = { parseDoc, parseSections, retiredIds, runCheck, parseCheck, globRe, scopeOf, deadScopes, scopeMismatches, docsRoot, dataRoot, prefsDirs, readDirs, setting, CAP, GIT_CAP, PERSONAL_CAP, HOUSE_KEYS };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
