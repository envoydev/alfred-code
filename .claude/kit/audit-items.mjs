// Copied into each repo as .claude/kit/audit-items.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// The decisions of audit-scope.mjs, with no file, process or git access: which entries are items, why an item is
// audited or carried, the lines `scope` prints, the grades text read into grades, the state `record` builds, and the
// state file's text turned into a checked state and back. The command passes in what it reads and writes what comes back.
import path from 'node:path';

const PATH_SEPARATOR_PATTERN = /[\\/]/;
const LETTER_PATTERN = /^[A-F][+-]?$/;
const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AT_TARGET = Object.freeze({ yes: 'yes', no: 'no' });
const GRADE_FIELDS = 4;
const STATE_TEXT_KEYS = Object.freeze(['letter', 'numeric', 'date', 'run', 'scoring', 'folder']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHashRecord = (value) => isRecord(value) && Object.values(value).every((hash) => typeof hash === 'string');
const isUnder = (file, base) => file === base || file.startsWith(`${base}/`);
export const filesUnder = (files, base) => files.filter((file) => isUnder(file, base));
const sortedKeys = (map) => [...map.keys()].sort();
const sortedRecord = (map) => Object.fromEntries(sortedKeys(map).map((key) => [key, map.get(key)]));

export function localDate(now)
{
    const pad = (part) => String(part).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Whole calendar days from the first date to the second, both as YYYY-MM-DD; a clock change never shifts the count.
function daysBetween(from, to)
{
    const utcDay = (date) =>
    {
        const [year, month, day] = date.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    return Math.round((utcDay(to) - utcDay(from)) / MS_PER_DAY);
}

// A path as the command line gives it, from the repository root with '/' and no trailing '/', or the problem with it.
export function checkedPath(text)
{
    if (text === '') return { problem: 'is empty' };
    if (path.posix.isAbsolute(text) || path.win32.isAbsolute(text)) return { problem: 'is outside the repository' };
    if (text.split(PATH_SEPARATOR_PATTERN).includes('..')) return { problem: 'is outside the repository' };
    const clean = text.split('/').filter((segment) => segment !== '' && segment !== '.').join('/');
    return clean === '' ? { problem: 'names the repository itself' } : { path: clean };
}

// The state file as data, or { problem } when it is not an audit state file of this kind.
export function parseState(text, kind)
{
    let data;
    try
    {
        data = JSON.parse(text);
    }
    catch (error)
    {
        return { problem: error.message };
    }
    if (!isRecord(data) || data.kind !== kind || !isHashRecord(data.with) || !isRecord(data.items)) return { problem: `not the state of an audit of kind ${kind}` };
    const items = new Map();
    for (const [id, entry] of Object.entries(data.items))
    {
        const sound = isRecord(entry) && STATE_TEXT_KEYS.every((key) => typeof entry[key] === 'string') && typeof entry.atTarget === 'boolean' && DATE_PATTERN.test(entry.date) && isHashRecord(entry.files);
        if (!sound) return { problem: `item ${id} is not an audit entry` };
        items.set(id, { ...entry, files: new Map(Object.entries(entry.files)) });
    }
    return { state: { with: new Map(Object.entries(data.with)), items } };
}

export function serializeState(kind, state)
{
    const items = Object.fromEntries(sortedKeys(state.items).map((id) =>
    {
        const { letter, numeric, atTarget, date, run, files, scoring, folder } = state.items.get(id);
        return [id, { letter, numeric, atTarget, date, run, files: sortedRecord(files), scoring, folder }];
    }));
    return `${JSON.stringify({ kind, with: sortedRecord(state.with), items }, null, 2)}\n`;
}

// The items of an audit: one per root that is a file, else one per first segment below the root that holds a present file,
// less every entry a --with path names or lies under; plus each state id outside the roots. A state id with no present file
// is gone, not an item.
export function itemsOf(roots, withPaths, present, stateIds)
{
    const presentSet = new Set(present);
    const entries = new Set();
    for (const root of roots)
    {
        if (presentSet.has(root)) entries.add(root);
        else for (const file of filesUnder(present, root)) entries.add(`${root}/${file.slice(root.length + 1).split('/')[0]}`);
    }
    const audited = [...entries].filter((entry) => ![...withPaths].some((withPath) => isUnder(entry, withPath)));
    const outside = stateIds.filter((id) => ![...roots].some((root) => isUnder(id, root)));
    const items = [...new Set([...audited, ...outside])].sort().map((id) => ({ id, files: filesUnder(present, id) })).filter((item) => item.files.length > 0);
    const gone = stateIds.filter((id) => filesUnder(present, id).length === 0).sort();
    return { items, gone };
}

function sameHashes(first, second)
{
    return first.size === second.size && [...first].every(([file, hash]) => second.get(file) === hash);
}

// The first path, sorted, that is in one map and not the other or has another hash in each; undefined when they agree.
function firstDifference(now, before)
{
    return [...new Set([...now.keys(), ...before.keys()])].sort().find((file) => now.get(file) !== before.get(file));
}

// Why an item is audited - the text after `audit <id> - `, and whether its age is the reason - or null when it keeps its
// grade. The first rule that holds wins.
function reasonToAudit(item, entry, context)
{
    if (entry === undefined) return { text: 'new', aged: false };
    if (context.full) return { text: 'full', aged: false };
    if (!sameHashes(item.hashes, entry.files)) return { text: 'changed', aged: false };
    const moved = firstDifference(context.withHashes, context.state.with);
    if (moved !== undefined) return { text: `changed (${moved})`, aged: false };
    if (context.scoring !== entry.scoring) return { text: 'changed (the rubric)', aged: false };
    if (!entry.atTarget) return { text: `below the target (${entry.letter} / ${entry.numeric})`, aged: false };
    if (daysBetween(entry.date, context.today) > context.maxAgeDays) return { text: `older than ${context.maxAgeDays} days (${entry.letter} / ${entry.numeric} from ${entry.date})`, aged: true };
    return null;
}

// Every line `scope` prints. Each item is { id, hashes }; `state` is null where there is no state file.
export function scopeLines({ items, gone, state, full, withHashes, scoring, folder, today, maxAgeDays })
{
    const context = { full, withHashes, state, scoring, today, maxAgeDays };
    const lines = state === null ? ['no earlier audit on this machine'] : [];
    const kept = [];
    let audited = 0;
    let aged = 0;
    for (const item of items)
    {
        const entry = state?.items.get(item.id);
        const reason = reasonToAudit(item, entry, context);
        if (reason !== null)
        {
            audited++;
            if (reason.aged) aged++;
            lines.push(`audit ${item.id} - ${reason.text}`);
            continue;
        }
        kept.push(entry);
        lines.push(`carried ${item.id} - ${entry.letter} / ${entry.numeric} from ${entry.date} - ${entry.run}`);
    }
    lines.push(...gone.map((id) => `gone ${id}`), `Scope: ${audited} of ${items.length} items audited, ${kept.length} carried`);
    if (aged > 0) lines.push(`age: ${aged} items graded more than ${maxAgeDays} days ago are audited again`);
    const earlier = kept.filter((entry) => entry.folder !== folder);
    if (earlier.length > 0)
    {
        const since = earlier.map((entry) => entry.date).sort()[0];
        lines.push(`the audit skill changed since ${since}: ${earlier.length} carried grades stand under the earlier text`);
    }
    lines.push(`Graded under: ${scoring} ${folder}`);
    return lines;
}

// One grades line as { grade }, or { problem }. An id that is no path of this repository stays text with no present
// file, so `record` skips it and never builds a path from it.
function gradeOf(line)
{
    const fields = line.split('\t');
    if (fields.length !== GRADE_FIELDS) return { problem: `expected ${GRADE_FIELDS} tab-separated fields, found ${fields.length}` };
    const [rawId, letter, numeric, flag] = fields;
    if (rawId === '') return { problem: 'the id is empty' };
    if (!LETTER_PATTERN.test(letter)) return { problem: `letter ${letter} is not A to F with an optional + or -` };
    if (!NUMERIC_PATTERN.test(numeric)) return { problem: `numeric ${numeric} is not a number` };
    if (!Object.hasOwn(AT_TARGET, flag)) return { problem: `${flag} is not ${AT_TARGET.yes} or ${AT_TARGET.no}` };
    return { grade: { id: checkedPath(rawId).path ?? rawId, letter, numeric, atTarget: flag === AT_TARGET.yes } };
}

export function parseGrades(text)
{
    const grades = [];
    const seen = new Set();
    const lines = text.split('\n');
    for (const [index, line] of lines.entries())
    {
        if (line === '') continue;
        const parsed = gradeOf(line);
        const problem = parsed.problem ?? (seen.has(parsed.grade.id) ? `${parsed.grade.id} is named twice` : undefined);
        if (problem !== undefined) return { problem: `line ${index + 1}: ${problem}` };
        seen.add(parsed.grade.id);
        grades.push(parsed.grade);
    }
    return { grades };
}

// The state after a record: each graded id with files stored fresh; each id left out kept while its files and the --with
// files are as stored, else dropped. `filesOf(id)` is a map from the id's present files to their hashes.
export function recordState({ previous, grades, filesOf, withHashes, today, run, scoring, folder })
{
    const items = new Map();
    const skipped = [];
    for (const { id, letter, numeric, atTarget } of grades)
    {
        const files = filesOf(id);
        if (files.size === 0) skipped.push(id);
        else items.set(id, { letter, numeric, atTarget, date: today, run, files, scoring, folder });
    }
    const graded = items.size;
    const named = new Set(grades.map((grade) => grade.id));
    const withHeld = previous !== null && sameHashes(withHashes, previous.with);
    let kept = 0;
    let dropped = 0;
    for (const [id, entry] of previous?.items ?? [])
    {
        if (named.has(id)) continue;
        if (withHeld && sameHashes(filesOf(id), entry.files))
        {
            items.set(id, entry);
            kept++;
        }
        else dropped++;
    }
    return { state: { with: withHashes, items }, skipped, counts: { graded, kept, dropped, skipped: skipped.length } };
}

export const hashMap = (files, hashes) => new Map(files.map((file) => [file, hashes.get(file)]));
