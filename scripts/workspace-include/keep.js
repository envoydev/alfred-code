'use strict';
// workspace-include: the lines a root keeps for a child it set aside. Pure, like select.js.

const { STORE_KINDS, KEPT_LINE_RE, MARKDOWN_SUFFIX_RE, MARKDOWN_KINDS } = require('./constants.js');
const { asWritten, ownValue, setAsideRels, keptForJoined } = require('./select.js');

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

// Adds `line` to the child's entry once, in the entry whose key `low` reads as the child; an entry whose child is no longer joined goes.
function addKept(record, rel, line, low = asWritten)
{
    const entries = Object.entries(record.keptFor || {});
    const at = entries.findIndex(([key]) => low(key) === low(rel));
    const [key, held] = at >= 0 ? entries[at] : [rel, []];
    const entry = [key, held.includes(line) ? held : [...held, line]];
    if (at >= 0) entries[at] = entry;
    else entries.push(entry);
    record.keptFor = keptForJoined(Object.fromEntries(entries), record.children, low);
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
function storeLines(view, low = asWritten)
{
    const lines = Object.entries(keptForJoined(view.keptFor, view.children, low)).flatMap(([, held]) => held);
    return [...new Set(lines.filter((line) => STORE_KINDS.includes(categoryOf(line))))].sort();
}

function isRetired(line, retired)
{
    const category = categoryOf(line);
    const comparable = (entry) => (MARKDOWN_KINDS.includes(category) ? entry.replace(MARKDOWN_SUFFIX_RE, '') : entry);
    return (ownValue(retired, `${category}s`) || []).some((entry) => comparable(entry) === nameOf(line));
}

// The lines kept for `rel`: the entry whose key `low` reads as it.
const keptLinesAt = (keptFor, rel, low) => Object.entries(keptFor || {}).filter(([key]) => low(key) === low(rel)).flatMap(([, held]) => held);

// Each own pick the run dropped, for each set-aside child that neither ignores it nor keeps it already.
function backstopLines(priorOwn, finalOwn, retired, asideRels, ignoresByRel, keptFor, low = asWritten)
{
    const dropped = priorOwn.filter((line) => !finalOwn.includes(line) && !isRetired(line, retired));
    return Object.fromEntries(asideRels
        .map((rel) => [rel, dropped.filter((line) => !linesOf(ownValue(ignoresByRel, rel)).has(line) && !keptLinesAt(keptFor, rel, low).includes(line))])
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

// The log lines (without their indent) for what `mapKept` read as another name and what it dropped as retired.
const keptNotes = (mapped) => [...mapped.renamedPairs.map(([from, to]) => `kept line ${from} read as ${to}`), ...mapped.retiredLines.map((line) => `kept line ${line} dropped: retired`)];

// One record's keep as the root's run reads it: the backstop's lines added, an entry whose child left the workspace dropped,
// the lines read through the manifest, then the lines the child ignores or the root holds dropped (after the rename, so a
// renamed line the root holds under its new name settles in one run). Returns { keptFor, notes, changed } - the record's own
// value is never touched.
function settleKept({ keptFor, children, backstop = {}, childIgnores, rootLines, renamed, retired, low = asWritten })
{
    const record = { keptFor: { ...keptFor }, children };
    for (const [rel, lines] of Object.entries(backstop)) for (const line of lines) addKept(record, rel, line, low);
    const notes = [];
    const mapped = Object.fromEntries(Object.entries(keptForJoined(record.keptFor, children, low)).map(([rel, lines]) =>
    {
        const read = mapKept(lines, renamed, retired);
        notes.push(...keptNotes(read));
        return [rel, read.lines];
    }));
    const settled = pruneKept(mapped, childIgnores, rootLines);
    return { keptFor: settled, notes: [...new Set(notes)], changed: JSON.stringify(settled) !== JSON.stringify(keptFor) };
}

// A child's inherited set: its parent's lines and the lines the parent kept for it, read through the manifest.
function inheritKept(parentLines, kept, renamed, retired)
{
    const mapped = mapKept(kept, renamed, retired);
    return { lines: [...new Set([...parentLines, ...mapped.lines])], notes: keptNotes(mapped) };
}

const keepLines = (line, kept, ignoring) => [...kept.map((rel) => `include: kept ${line} for ${rel}`), ...ignoring.map((rel) => `include: ${rel} ignores ${line} - not kept`)];

module.exports = { keepTargets, addKept, pruneKept, storeLines, backstopLines, mapKept, keepLines, keptNotes, settleKept, inheritKept };
