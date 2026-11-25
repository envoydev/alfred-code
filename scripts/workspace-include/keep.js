'use strict';
// workspace-include: the lines a root keeps for a child it set aside. Pure, like select.js.

const { STORE_KINDS, KEPT_LINE_RE, MARKDOWN_SUFFIX_RE, MARKDOWN_KINDS } = require('./constants.js');
const { ownValue, setAsideRels, keptForJoined } = require('./select.js');

// An ignore entry as a view holds it ({ category, name }) or as a line.
const lineOf = (entry) => (typeof entry === 'string' ? entry : `${entry.category} ${entry.name}`);
const categoryOf = (line) => line.split(' ')[0];
const nameOf = (line) => line.slice(categoryOf(line).length + 1);
const linesOf = (entries) => new Set((entries || []).map(lineOf));

// Which set-aside children keep `line` and which ignore it. `isEntry` is the record's own ignore-entry rule, where the caller has it.
function keepTargets(view, line, ignoresByRel, isEntry = () => true)
{
    if (!KEPT_LINE_RE.test(line) || !isEntry(line)) return { error: `'${line}' is no ignore entry - it reads '<category> <name>'`, kept: [], ignoring: [] };
    const aside = setAsideRels(view);
    const ignores = (rel) => linesOf(ownValue(ignoresByRel, rel)).has(line);
    return { error: null, kept: aside.filter((rel) => !ignores(rel)), ignoring: aside.filter(ignores) };
}

// Adds `line` to the child's entry once; an entry whose child is no longer joined goes.
function addKept(record, rel, line)
{
    const held = ownValue(record.keptFor, rel) || [];
    const entries = Object.entries(record.keptFor || {});
    const at = entries.findIndex(([key]) => key === rel);
    const entry = [rel, held.includes(line) ? held : [...held, line]];
    if (at >= 0) entries[at] = entry;
    else entries.push(entry);
    record.keptFor = keptForJoined(Object.fromEntries(entries), record.children);
}

// Drops a line the child ignores or the root's own set holds, and an entry left empty.
function pruneKept(keptFor, childIgnores, rootLines)
{
    const held = new Set(rootLines);
    return Object.fromEntries(Object.entries(keptFor)
        .map(([rel, lines]) => [rel, lines.filter((line) => !linesOf(ownValue(childIgnores, rel)).has(line) && !held.has(line))])
        .filter(([, lines]) => lines.length));
}

// The kept lines that go to the root's own store: skills, agents and rules of children that are still joined.
function storeLines(view)
{
    const lines = Object.entries(view.keptFor || {}).filter(([rel]) => view.children.includes(rel)).flatMap(([, held]) => held);
    return [...new Set(lines.filter((line) => STORE_KINDS.includes(categoryOf(line))))].sort();
}

function isRetired(line, retired)
{
    const category = categoryOf(line);
    const comparable = (entry) => (MARKDOWN_KINDS.includes(category) ? entry.replace(MARKDOWN_SUFFIX_RE, '') : entry);
    return (ownValue(retired, `${category}s`) || []).some((entry) => comparable(entry) === nameOf(line));
}

// Each own pick the run dropped, for each set-aside child that neither ignores it nor keeps it already.
function backstopLines(priorOwn, finalOwn, retired, asideRels, ignoresByRel, keptFor)
{
    const dropped = priorOwn.filter((line) => !finalOwn.includes(line) && !isRetired(line, retired));
    return Object.fromEntries(asideRels
        .map((rel) => [rel, dropped.filter((line) => !linesOf(ownValue(ignoresByRel, rel)).has(line) && !(ownValue(keptFor, rel) || []).includes(line))])
        .filter(([, lines]) => lines.length));
}

// Kept lines through the manifest: a renamed item is read as its new name, a retired one is dropped.
function mapKept(lines, renamed, retired)
{
    const mapped = { lines: [], renamedPairs: [], retiredLines: [] };
    for (const line of lines)
    {
        if (isRetired(line, retired)) { mapped.retiredLines.push(line); continue; }
        const to = ownValue(ownValue(renamed, `${categoryOf(line)}s`), nameOf(line));
        const next = typeof to === 'string' && to !== nameOf(line) ? `${categoryOf(line)} ${to}` : line;
        if (next !== line) mapped.renamedPairs.push([line, next]);
        if (!mapped.lines.includes(next)) mapped.lines.push(next);
    }
    return mapped;
}

const keepLines = (line, kept, ignoring) => [...kept.map((rel) => `include: kept ${line} for ${rel}`), ...ignoring.map((rel) => `include: ${rel} ignores ${line} - not kept`)];

module.exports = { keepTargets, addKept, pruneKept, storeLines, backstopLines, mapKept, keepLines };
