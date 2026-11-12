'use strict';
// ENGINE - the one reader of a project's workspace record (spec: the workspace.json design, 2026-11-10). Copied beside
// layout.js on both routes and required by the installer, so it needs nothing but Node's own modules.
//
// The record is `<data root>/workspace.json`:
//
//   { "parent": "..", "above": "none", "children": ["api", "web/admin"], "ignore": { "skills": ["dotnet-build"] } }
//
//   parent    a run of `..` segments - or role "root" / "standalone", never both: a record holding both reads parent
//   above     the nearest stamped folder above when the role was last answered (a `..` run, or "none")
//   children  direct children only, relative, `/` separated
//   ignore    category -> names: an inherited item this project leaves out (docs and memory take only "root")
//             the five stack kinds read in either spelling and are written plural - an existing file with no plural key stays singular
//
// The old line file `<data root>/workspace` (`parent ..`, `child api`, ...) is read until the support floor: alone, or
// beside workspace.json as a union with the JSON's entries first (an older installer added a child line to a converted
// parent). A garbage workspace.json (not JSON, or JSON that is not an object) reads as `state: 'garbage'` and an empty
// record, the old file then not consulted; an empty one (0 bytes, whitespace, a lone BOM) is an empty record.
// An invalid value is dropped, named in `problems`, kept in `invalid`, and written back by its shape (renderRecord).
const fs = require('node:fs');
const path = require('node:path');

const JSON_NAME = 'workspace.json';
const LEGACY_NAME = 'workspace';
const LOCK_NAME = 'workspace.lock';
const CATEGORIES = Object.freeze(['skill', 'agent', 'rule', 'hook', 'plugin', 'env', 'mcp', 'secret', 'doc', 'instructions']);
const ROOT_ONLY = Object.freeze(['docs', 'memory']);
const PLURAL = Object.freeze({ __proto__: null, skill: 'skills', agent: 'agents', rule: 'rules', hook: 'hooks', plugin: 'plugins' });
const SINGULAR = { __proto__: null, ...Object.fromEntries(Object.entries(PLURAL).map(([one, many]) => [many, one])) };

const PARENT_RE = /^\.\.(\/\.\.)*$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const PATH_NAME_RE = /^[A-Za-z0-9._\/-]+$/;
const segmentsOk = (value) => value.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

function isChildPath(value)
{
    return typeof value === 'string' && value !== '' && !value.startsWith('/') && !/[:\\]/.test(value) && segmentsOk(value);
}

function isIgnoreName(category, name)
{
    if (!CATEGORIES.includes(category) || typeof name !== 'string') return false;
    if (NAME_RE.test(name)) return true;
    return (category === 'doc' || category === 'instructions') && PATH_NAME_RE.test(name) && segmentsOk(name);
}

// An ignore entry the record can hold: a category's name, or the fixed `docs root` / `memory root`.
function isIgnoreEntry(category, name)
{
    if (ROOT_ONLY.includes(category)) return name === 'root';
    return isIgnoreName(category, name);
}

const isCategory = (category) => CATEGORIES.includes(category) || ROOT_ONLY.includes(category);
const isParent = (v) => typeof v === 'string' && PARENT_RE.test(v);
const isRole = (v) => v === 'root' || v === 'standalone';
const isAbove = (v) => v === 'none' || isParent(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shown = (v) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

function emptyRecord()
{
    return { parent: null, role: null, above: null, children: [], ignore: {}, parentNone: false };
}

function addIgnore(record, category, name)
{
    const list = record.ignore[category] || (record.ignore[category] = []);
    if (!list.includes(name)) list.push(name);
}

// ------------------------------------------------------------------ the old line file

// One line as an entry: the keyword's value is the text after it and its separators, inner whitespace kept - a child
// folder named `a  b` must read back as itself, or the back-reference never matches the real folder (R062).
function parseLine(raw)
{
    const line = raw.trim();
    if (line === '') return { kind: 'blank' };
    if (line.startsWith('#')) return { kind: 'comment', line };
    const [word, ...rest] = line.split(/\s+/);
    const value = line.slice(word.length).replace(/^\s+/, '');
    if (word === 'parent')
    {
        if (value === 'none') return { kind: 'parent-none', line };
        if (isParent(value)) return { kind: 'parent', value, line };
    }
    else if (word === 'role' && isRole(value)) return { kind: 'role', value, line };
    else if (word === 'above' && isAbove(value)) return { kind: 'above', value, line };
    else if (word === 'child' && isChildPath(value)) return { kind: 'child', value, line };
    else if (word === 'ignore' && rest.length === 2 && isIgnoreEntry(rest[0], rest[1])) return { kind: 'ignore', category: rest[0], name: rest[1], line };
    return { kind: 'unknown', line };
}

const dedupeKey = (e) => (e.kind === 'parent' || e.kind === 'parent-none' ? 'parent'
    : e.kind === 'role' || e.kind === 'above' ? e.kind
    : e.kind === 'child' ? `child ${e.value}`
    : e.kind === 'ignore' ? `ignore ${e.category} ${e.name}` : null);

// The old file's text as a record. A leading BOM is dropped and CRLF reads as LF; a duplicate entry keeps its first
// spelling; a second, different parent line is named, never silently chosen. A comment or a line the grammar does not
// read is named as not carried into workspace.json.
function parseLegacy(text)
{
    const record = emptyRecord();
    const problems = [];
    const seen = new Map();
    for (const raw of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/))
    {
        const e = parseLine(raw);
        if (e.kind === 'blank') continue;
        if (e.kind === 'comment') { problems.push(`comment '${e.line}' not carried into workspace.json`); continue; }
        if (e.kind === 'unknown') { problems.push(`line '${e.line}' not carried into workspace.json`); continue; }
        const key = dedupeKey(e);
        if (seen.has(key))
        {
            if (key === 'parent' && seen.get(key) !== e.line) problems.push(`second parent line '${e.line}' not carried into workspace.json`);
            continue;
        }
        seen.set(key, e.line);
        if (e.kind === 'parent') record.parent = e.value;
        else if (e.kind === 'parent-none') { record.parentNone = true; record.role = record.role || 'standalone'; }
        else if (e.kind === 'role') record.role = e.value;
        else if (e.kind === 'above') record.above = e.value;
        else if (e.kind === 'child') record.children.push(e.value);
        else if (e.kind === 'ignore') addIgnore(record, e.category, e.name);
    }
    return { record, problems };
}

// ------------------------------------------------------------------ the JSON file

// A parsed object as a record: each known key validated value by value; an invalid value lands in `invalid` with its
// key (`entry: true` for one entry of a list - a child, an ignore name, an unknown ignore category), an unknown key in
// `unknown`, each named once in `problems`.
function fromObject(obj)
{
    const record = emptyRecord();
    const unknown = {};
    const invalid = [];
    const problems = [];
    const bad = (key, value, label, entry = false, named = `${label} ${shown(value)}`) =>
    {
        invalid.push(entry ? { key, value, entry: true } : { key, value });
        problems.push(`invalid ${named} kept, not applied`);
    };
    for (const [key, value] of Object.entries(obj))
    {
        if (key === 'parent') { if (isParent(value)) record.parent = value; else bad('parent', value, 'parent'); }
        else if (key === 'role') { if (isRole(value)) record.role = value; else bad('role', value, 'role'); }
        else if (key === 'above') { if (isAbove(value)) record.above = value; else bad('above', value, 'above'); }
        else if (key === 'children')
        {
            if (!Array.isArray(value)) { bad('children', value, 'children (not a list)'); continue; }
            for (const child of value)
            {
                if (!isChildPath(child)) bad('children', child, 'child', true);
                else if (!record.children.includes(child)) record.children.push(child);
            }
        }
        else if (key === 'ignore')
        {
            if (!isPlainObject(value)) { bad('ignore', value, 'ignore (not an object)'); continue; }
            for (const [spelt, names] of Object.entries(value))
            {
                const category = SINGULAR[spelt] || spelt;
                if (!isCategory(category)) { bad(`ignore.${category}`, names, 'ignore category', true, `ignore category '${category}'`); continue; }
                if (!Array.isArray(names)) { bad(`ignore.${category}`, names, `ignore ${category} (not a list)`); continue; }
                for (const name of names)
                {
                    if (isIgnoreEntry(category, name)) addIgnore(record, category, name);
                    else bad(`ignore.${category}`, name, `ignore ${category}`, true);
                }
            }
        }
        else { unknown[key] = value; problems.push(`unknown key '${key}' kept`); }
    }
    return { record, unknown, invalid, problems, plural: Object.keys(obj.ignore || {}).some((key) => SINGULAR[key]) };
}

// The union of the JSON's record and the old file's: the JSON's scalars win, its list entries come first.
function union(json, legacy)
{
    const out = emptyRecord();
    out.parent = json.parent ?? legacy.parent;
    out.role = json.role ?? legacy.role;
    out.above = json.above ?? legacy.above;
    out.parentNone = legacy.parentNone && json.parent == null && json.role == null;
    for (const child of [...json.children, ...legacy.children]) if (!out.children.includes(child)) out.children.push(child);
    for (const source of [json.ignore, legacy.ignore]) for (const [category, names] of Object.entries(source)) for (const name of names) addIgnore(out, category, name);
    return out;
}

const readText = (file) =>
{
    try { return { text: fs.readFileSync(file, 'utf8') }; }
    catch (e) { return e.code === 'ENOENT' ? { missing: true } : { error: true }; }
};

// The record a data-root folder holds: { state, source, file, record, unknown, invalid, problems, text }.
// `file` is workspace.json's path when it exists or neither file does, else the old file's; `text` is workspace.json's
// text as read (a BOM kept), for the writer's shape.
function readRecord(dir)
{
    const jsonFile = path.join(dir, JSON_NAME);
    const legacyFile = path.join(dir, LEGACY_NAME);
    const json = readText(jsonFile);
    const legacy = readText(legacyFile);
    const result = (state, source, file, read = {}, text = null) => ({
        state, source, file, singular: state === 'ok' && !read.plural,
        record: read.record || emptyRecord(), unknown: read.unknown || {}, invalid: read.invalid || [], problems: read.problems || [], text,
    });
    if (json.error) return result('garbage', 'json', jsonFile);
    if (!json.missing)
    {
        const body = json.text.replace(/^\uFEFF/, '');
        let parsed = {};
        if (body.trim() !== '')
        {
            try { parsed = JSON.parse(body); } catch { return result('garbage', 'json', jsonFile, {}, json.text); }
            if (!isPlainObject(parsed)) return result('garbage', 'json', jsonFile, {}, json.text);
        }
        const read = fromObject(parsed);
        if (legacy.missing || legacy.error) return finish(result('ok', 'json', jsonFile, read, json.text));
        const old = parseLegacy(legacy.text);
        return finish(result('ok', 'both', jsonFile, { ...read, record: union(read.record, old.record), problems: [...read.problems, ...old.problems] }, json.text));
    }
    if (legacy.missing) return result('absent', null, jsonFile);
    // an old file that cannot be read (a folder, no permission) reads as garbage too, so the installer leaves it as it is
    if (legacy.error) return result('garbage', 'legacy', legacyFile);
    return result('ok', 'legacy', legacyFile, parseLegacy(legacy.text));
}

// Parent wins: a record holding both reads the parent, and the dropped role is named.
function finish(read)
{
    if (read.record.parent && read.record.role)
    {
        read.problems.push(`role '${read.record.role}' dropped - parent is set`);
        read.record.role = null;
        read.record.parentNone = false;
    }
    return read;
}

// The installer's view of a record: { parent, parentNone, role, above, children, ignores: [{ category, name }] }.
function viewOf(record)
{
    const ignores = [];
    for (const [category, names] of Object.entries(record.ignore || {})) for (const name of names) ignores.push({ category, name });
    return { parent: record.parent, parentNone: !!record.parentNone, role: record.role, above: record.above, children: [...record.children], ignores };
}

// The object to write: keys in the fixed order (parent or role, above, children, ignore), each invalid value back by its
// shape - a list entry after the valid entries; a scalar or a wrong-typed key as read while the record holds no value for
// that key (a parent excludes any role) - the unknown keys last, empty keys left out, parentNone never written.
function renderRecord(record, unknown = {}, invalid = [], singular = false)
{
    const out = {};
    const scalar = (key) => invalid.find((i) => i.key === key && !i.entry);
    const entries = (key) => invalid.filter((i) => i.key === key && i.entry).map((i) => i.value);
    const badParent = scalar('parent');
    if (record.parent) out.parent = record.parent;
    else if (badParent) out.parent = badParent.value;
    if (!record.parent)
    {
        const badRole = scalar('role');
        if (record.role) out.role = record.role;
        else if (badRole) out.role = badRole.value;
    }
    const badAbove = scalar('above');
    if (record.above) out.above = record.above;
    else if (badAbove) out.above = badAbove.value;
    const children = [...record.children, ...entries('children')];
    const badChildren = scalar('children');
    if (record.children.length === 0 && badChildren) out.children = badChildren.value;
    else if (children.length) out.children = children;
    const badIgnore = scalar('ignore');
    const ignored = Object.values(record.ignore).some((names) => names.length);
    if (!ignored && badIgnore) out.ignore = badIgnore.value;
    else
    {
        const ignore = {};
        const categories = [...Object.keys(record.ignore)];
        for (const i of invalid) if (i.key.startsWith('ignore.') && !categories.includes(i.key.slice(7))) categories.push(i.key.slice(7));
        for (const category of categories)
        {
            const key = `ignore.${category}`;
            const names = record.ignore[category] || [];
            const badList = scalar(key);
            if (names.length === 0 && badList) { ignore[category] = badList.value; continue; }
            const extra = entries(key);
            // an unknown category is one entry of the ignore object: its value is written back whole
            if (!isCategory(category)) { if (extra.length) ignore[category] = extra[0]; continue; }
            const all = [...names, ...extra];
            if (all.length) ignore[category] = all;
        }
        if (Object.keys(ignore).length) out.ignore = singular ? ignore : Object.fromEntries(Object.entries(ignore).map(([k, v]) => [PLURAL[k] || k, v]));
    }
    for (const [key, value] of Object.entries(unknown)) out[key] = value;
    return out;
}

module.exports = {
    JSON_NAME, LEGACY_NAME, LOCK_NAME, CATEGORIES, PLURAL, PARENT_RE,
    isChildPath, isIgnoreName, isIgnoreEntry, emptyRecord, parseLegacy, readRecord, viewOf, renderRecord,
};
