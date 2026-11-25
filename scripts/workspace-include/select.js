'use strict';
// workspace-include: which joined children a root includes, which it has set aside and which it has not asked about.
// Pure: values in, values out. The installer requires this file, so it requires nothing but its own constants.

const { STATE, FLAG, TOP_RELS } = require('./constants.js');

// A map read as an own key only: a child named `constructor` or `toString` is an ordinary child, never an inherited member.
const ownValue = (map, key) => (map && Object.hasOwn(map, key) ? map[key] : undefined);
const unique = (list) => [...new Set(list)];
// How a key is compared with a child: the caller passes the platform's rule (`workspace-file.js low`); the default compares as written.
const asWritten = (text) => text;

function stateOf(view, rel)
{
    if ((view.includedChildren || []).includes(rel)) return STATE.included;
    return (view.includeAsked || []).includes(rel) ? STATE.setAside : STATE.unasked;
}

const childStates = (view) => view.children.map((rel) => ({ rel, state: stateOf(view, rel) }));
const setAsideRels = (view) => childStates(view).filter((child) => child.state === STATE.setAside).map((child) => child.rel);

// The text of the first thing wrong with an answer, or null. `joined` is the root's joined children.
function answerError(answer, joined)
{
    const named = [...answer.include, ...answer.setAside];
    if (!named.length) return `include takes ${FLAG.include}, ${FLAG.setAside} or ${FLAG.keep}`;
    const stranger = named.find((rel) => !joined.includes(rel));
    if (stranger !== undefined) return `'${stranger}' is no joined child`;
    const both = answer.include.find((rel) => answer.setAside.includes(rel));
    if (both !== undefined) return `'${both}' is named by both ${FLAG.include} and ${FLAG.setAside}`;
    const twice = named.find((rel, at) => named.indexOf(rel) !== at);
    return twice === undefined ? null : `'${twice}' is named twice`;
}

// The kept lines of the children that are still joined, a key matched to a child through `low`; an entry is built as an own key.
const keptForJoined = (keptFor, children, low = asWritten) => Object.fromEntries(Object.entries(keptFor || {}).filter(([rel]) => children.some((child) => low(child) === low(rel))));

// Merges an answer into the record: a child the answer does not name keeps its state.
function applyAnswer(record, answer, low = asWritten)
{
    const included = record.includedChildren.filter((rel) => !answer.setAside.includes(rel));
    for (const rel of answer.include) if (!included.includes(rel)) included.push(rel);
    record.includedChildren = included;
    record.includeAsked = unique([...record.includeAsked, ...answer.setAside, ...answer.include]);
    record.keptFor = keptForJoined(record.keptFor, record.children, low);
}

const relativeTo = (rel, parentRel) => (TOP_RELS.includes(parentRel) ? rel : rel.slice(parentRel.length + 1));

// The `subtree()` rows a parent's record sets aside, and every row below one. `viewsByParent` maps a parent row's rel to its view.
function asideRows(rows, viewsByParent)
{
    const aside = new Set();
    for (const row of rows)
    {
        if (row.parentRel === null || row.parentRel === undefined) continue;
        const view = ownValue(viewsByParent, row.parentRel);
        const direct = Boolean(view) && setAsideRels(view).includes(relativeTo(row.rel, row.parentRel));
        if (direct || aside.has(row.parentRel)) aside.add(row.rel);
    }
    return aside;
}

// The verb's lines: one a child, the count, then each project below.
function lines(states, below, saved = false)
{
    const count = (state) => states.filter((child) => child.state === state).length;
    const counts = `${count(STATE.included)} included, ${count(STATE.setAside)} set aside, ${count(STATE.unasked)} unasked`;
    return [...states.map(({ rel, state }) => `${state}: ${rel}`), `include: ${saved ? 'saved ' : ''}${counts}`, ...below.map((rel) => `below: ${rel}`)];
}

const csvOf = (text) => String(text ?? '').split(',').map((word) => word.trim()).filter(Boolean);

// `values` holds each flag the run named: a flag with no value, or --keep beside a list flag, is refused.
function flagError(values)
{
    const given = Object.keys(values);
    const empty = given.find((flag) => values[flag] === undefined);
    if (empty !== undefined) return `'${empty}' needs a value`;
    if (given.includes(FLAG.keep) && (given.includes(FLAG.include) || given.includes(FLAG.setAside))) return `${FLAG.keep} cannot be combined with ${FLAG.include} or ${FLAG.setAside}`;
    return null;
}

module.exports = { asWritten, ownValue, childStates, setAsideRels, answerError, keptForJoined, applyAnswer, asideRows, lines, csvOf, flagError };
