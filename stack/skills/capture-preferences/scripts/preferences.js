#!/usr/bin/env node
// preferences.js - the scripted half of /capture-preferences: measures each preference's `Check:` over the changed
// files or the tree, holds the three docs to their shape and their size cap, and writes the generated
// .claude/rules/alfred-preferences.md, one @ import per doc. Node built-ins only - no install, no network.
//
// Usage, from the project root:
//   node .claude/skills/capture-preferences/scripts/preferences.js check [--diff | --all] [--area code|architecture|git]
//   node .../preferences.js lint      the docs' shape and the 8,000-char cap; exits 1 on a problem
//   node .../preferences.js next --area code|architecture|git   the id a new entry takes
//   node .../preferences.js rule      the generated rule, after the docs are written
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
const TEMPLATE = path.join(SKILL_DIR, 'references', 'rule-template.md');
const IMPORTS_SLOT = '__IMPORTS__';
const RULE_FILE = path.join('.claude', 'rules', 'alfred-preferences.md');
const PREFS_DIR = 'preferences';
const DOCS = [
    { area: 'code', file: 'CODE-PREFERENCES.md', prefix: 'C' },
    { area: 'architecture', file: 'ARCHITECTURE-PREFERENCES.md', prefix: 'A' },
    { area: 'git', file: 'GIT-PREFERENCES.md', prefix: 'G' },
];
// Every session and seat pays for the three docs (the rule imports them), so together they stay near 2K tokens.
const CAP = 8000;
const LINE_CUT = 160;
// A source file past this is generated or vendored, never a preference's subject.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- the docs root

// This script ships inside a skill with no hook-prelude.js beside it, so it reads the key itself: the environment,
// then settings.local.json over settings.json (a local-scope install writes the key there, R99), else the default.
const DOCS_PATH_KEYS = ['ALFRED_CODE_DOCS_PATH'];

function docsRoot(projectRoot)
{
    for (const key of DOCS_PATH_KEYS)
    {
        if (process.env[key]) return process.env[key];
    }
    for (const file of ['settings.local.json', 'settings.json'])
    {
        try
        {
            const env = (JSON.parse(readText(path.join(projectRoot, '.claude', file)) || '{}') || {}).env || {};
            for (const key of DOCS_PATH_KEYS)
            {
                if (env[key]) return env[key];
            }
        }
        catch { /* a malformed settings file is the next one's case, not a failure */ }
    }
    return '.alfred/docs';
}

const prefsDir = (projectRoot) => path.resolve(projectRoot, docsRoot(projectRoot), PREFS_DIR);

// The docs that exist and hold text, in code, architecture, git order.
function presentDocs(projectRoot, area = null)
{
    const dir = prefsDir(projectRoot);
    return DOCS.filter((d) => !area || d.area === area).map((d) => ({ ...d, abs: path.join(dir, d.file), text: readText(path.join(dir, d.file)) }))
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
// The ids removed from a doc, so the next entry skips them - an id is never reused.
const RETIRED = /^Retired:\s*(.*?)\s*$/m;
const GLOBS = String.raw`\x60[^\x60]+\x60(?:\s*,\s*\x60[^\x60]+\x60)*`;
const CHECK = new RegExp(String.raw`^regex \x60([^\x60]+)\x60 in (${GLOBS})(?:\s*,?\s*excluding (${GLOBS}))?$`);
// What a shell command looks like when it was written where a regex belongs.
const COMMAND = /\$\(|\||;|&&|>|^\s*(?:grep|rg|find|sh|bash|node|npm|npx|git|cat|ls)\b/;
const globsOf = (s) => [...String(s || '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
const listOf = (s, sep) => String(s || '').split(sep).map((x) => x.replace(/`/g, '').trim()).filter(Boolean);

// The `Check:` value as data, or null when it is not the grammar.
function parseCheck(value)
{
    const m = CHECK.exec(String(value || '').trim());
    return m ? { regex: m[1], include: globsOf(m[2]), exclude: globsOf(m[3]) } : null;
}

// Every `##` section with what lint needs beside the fields: the heading, its id line, the raw Check: text.
function parseSections(text)
{
    const out = [];
    let cur = null;
    for (const line of String(text || '').split(/\r?\n/))
    {
        const h = HEADING.exec(line);
        if (h)
        {
            const id = ENTRY_ID.exec(h[1]);
            cur = { heading: h[1], id: id ? `${id[1]}${id[2]}` : null, title: h[1].replace(/^[A-Z]\d+\s*-\s*/, ''), idLine: null, fields: {} };
            out.push(cur);
            continue;
        }
        if (!cur) continue;
        const idLine = ID_LINE.exec(line.trim());
        if (idLine && cur.idLine === null) { cur.idLine = idLine[1]; continue; }
        const f = FIELD.exec(line);
        if (f && !(f[1] in cur.fields)) cur.fields[f[1]] = f[2];
    }
    return out;
}

const retiredIds = (text) => listOf((RETIRED.exec(String(text || '')) || [])[1], /,/);

function parseDoc(text)
{
    return parseSections(text).map((s) => ({
        id: s.id,
        title: s.title,
        rule: s.fields.Rule || '',
        scope: listOf(s.fields.Scope, /,/),
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

// The changed files: the diff against HEAD plus the untracked ones; an unborn branch has everything new.
function changedFiles(projectRoot)
{
    const diff = gitList(projectRoot, ['diff', '--name-only', '--relative', 'HEAD']);
    const untracked = gitList(projectRoot, ['ls-files', '-o', '--exclude-standard']) || [];
    if (diff) return [...diff, ...untracked];
    return gitList(projectRoot, ['ls-files', '-c', '-o', '--exclude-standard']) || [];
}

function fileList(projectRoot, mode)
{
    const rels = [...new Set(mode === 'all' ? allFiles(projectRoot) : changedFiles(projectRoot))].sort();
    return rels.map((rel) => ({ rel: rel.split(path.sep).join('/'), abs: path.join(projectRoot, rel) }))
        .filter((f) => { try { return fs.statSync(f.abs).isFile(); } catch { return false; } });
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

function check(projectRoot, { mode, area })
{
    let files = null;
    let checked = 0;
    let violations = 0;
    for (const d of presentDocs(projectRoot, area))
    {
        for (const s of parseSections(d.text))
        {
            if (s.fields.Check === undefined) continue;
            const id = s.id || s.heading;
            const parsed = parseCheck(s.fields.Check);
            if (!parsed) { console.log(`skipped: ${id} - the Check: is not regex \`<pattern>\` in \`<glob>\`, so nothing is run`); continue; }
            try { new RegExp(parsed.regex); }
            catch (err) { console.log(`skipped: ${id} - the Check: regex does not compile (${err.message})`); continue; }
            files = files || fileList(projectRoot, mode);
            const hits = runCheck([{ id, check: parsed }], files);
            for (const h of hits) console.log(`violation: ${h.id} ${h.file}:${h.line} ${h.text}`);
            checked++;
            violations += hits.length;
        }
    }
    console.log(`checked: ${checked} entries, ${violations} violations`);
    return 0;
}

// ---------------------------------------------------------------- lint

function lint(projectRoot)
{
    const problems = [];
    const docs = presentDocs(projectRoot);
    const seen = new Map();
    for (const d of docs)
    {
        const file = shown(projectRoot, d.abs);
        if (!/^Updated: \d{4}-\d{2}-\d{2}\b/m.test(d.text)) problems.push(`${file}: no \`Updated: <date>\` line`);
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
            if (s.fields.Check === undefined) continue;
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
    const chars = docs.reduce((n, d) => n + d.text.length, 0);
    if (chars > CAP) problems.push(`${shown(projectRoot, prefsDir(projectRoot))}/: the three docs are ${chars} chars, over ${CAP} - cut before the rule imports them`);
    for (const p of problems) console.log(`PROBLEM ${p}`);
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

// ---------------------------------------------------------------- rule

// The import line's path. Claude Code resolves an @ import from the folder of the file holding it, so a
// project-relative docs root is reached from .claude/rules/ through ../../; an absolute one is written as it is,
// and a space is escaped (a bare one ends the path) - the awareness rule's shape (capabilities-inventory.js).
function preferenceImport(docs, file)
{
    const r = String(docs || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const abs = /^(?:\/|[A-Za-z]:\/|~\/)/.test(r);
    return `@${abs ? '' : '../../'}${r}/${PREFS_DIR}/${file}`.replace(/ /g, '\\ ');
}

function rule(projectRoot)
{
    const docs = presentDocs(projectRoot);
    if (!docs.length) { console.log('Rule: no preferences captured'); return 0; }
    const template = readText(TEMPLATE);
    if (template === null || !template.includes(IMPORTS_SLOT)) { console.error(`preferences: ${TEMPLATE} is missing or has no ${IMPORTS_SLOT} line`); return 1; }
    const root = docsRoot(projectRoot);
    const text = template.replace(IMPORTS_SLOT, docs.map((d) => preferenceImport(root, d.file)).join('\n'));
    const target = path.join(projectRoot, RULE_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (readText(target) !== text) fs.writeFileSync(target, text);
    const chars = docs.reduce((n, d) => n + d.text.length, 0);
    console.log(`Rule: ${Buffer.byteLength(text)} bytes, imports ${docs.length}; preferences ${chars} chars of ${CAP}${chars > CAP ? ' - over the cap, cut before it ships' : ''}`);
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
        if (area && !DOCS.some((d) => d.area === area)) { console.error(`preferences: --area is code, architecture or git, not '${area}'`); return 2; }
        return check(projectRoot, { mode: flag('--all') ? 'all' : 'diff', area: area || null });
    }
    if (cmd === 'lint') return lint(projectRoot);
    if (cmd === 'next')
    {
        const area = value('--area');
        if (!DOCS.some((d) => d.area === area)) { console.error('preferences: next needs --area code|architecture|git'); return 2; }
        return nextId(projectRoot, area);
    }
    if (cmd === 'rule') return rule(projectRoot);
    console.error('usage: preferences.js check [--diff | --all] [--area code|architecture|git] | lint | next --area <area> | rule  [--project <dir>]');
    return 2;
}

module.exports = { parseDoc, runCheck, parseCheck, globRe, docsRoot, preferenceImport, CAP };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
