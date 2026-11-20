'use strict';
// The generator's half of the value templates: each `node "$TMP/repo/<script>" ...` call a walk body writes becomes a mode, a
// list of positional templates and a flag -> value templates map, and the calls of one (script, mode) merge. Pure.
const { SCRIPT_RE, CALL, ARG, QUOTE, VALUE, TEMPLATE, WORD, PATH_VALUE_FLAGS, ACCOUNT } = require('./constants.js');
const { readCallWords } = require('./call-words.js');

const isFlagWord = (word) => word.quote === QUOTE.none && !word.placeholder
    && (ARG.longFlag.test(word.value) || ARG.shortFlag.test(word.value) || word.value === ARG.passthrough);

const literal = (value) => ({ kind: VALUE.literal, value });
const plain = (kind) => ({ kind });

// The templates one word of a call stands for: a bare `a|b` is a choice of literals, so it stands for several.
function classify(word)
{
    const { value, quote, placeholder } = word;
    if (quote === QUOTE.double && value.startsWith(TEMPLATE.tmpPrefix)) return [{ kind: VALUE.runDir, suffix: value.slice(TEMPLATE.tmpPrefix.length) }];
    if (quote === QUOTE.double && value.startsWith(`${WORD.here}${TEMPLATE.segmentSep}`) && placeholder) return [plain(VALUE.cwdPath)];
    if (quote === QUOTE.none && !placeholder && value === WORD.here) return [plain(VALUE.cwdPath)];
    if (placeholder)
    {
        const spaced = quote === QUOTE.single || (quote === QUOTE.double && TEMPLATE.whitespace.test(value));
        return [plain(spaced ? VALUE.phrase : VALUE.word)];
    }
    if (quote === QUOTE.none && value.includes(TEMPLATE.choiceSep)) return value.split(TEMPLATE.choiceSep).map(literal);
    return [literal(value)];
}

// A placeholder a path-valued flag takes: the account's folder where the body says so, else no template at all.
const pathPlaceholder = (flag, word) => (flag === ACCOUNT.dirFlag && ACCOUNT.placeholder.test(word.value) ? [plain(VALUE.accountDir)] : []);

const product = (lists) => lists.reduce((rows, alternatives) => rows.flatMap((row) => alternatives.map((one) => [...row, one])), [[]]);

// One call's arguments (the words after the script): { mode, sequences, flags } - `flags` maps a flag to the templates of its
// value, `true` for the flag with none. The words after a `--` are the data of that flag.
function shapeOfCall(words)
{
    const [first] = words;
    const hasMode = first && first.quote === QUOTE.none && !first.placeholder && ARG.modeWord.test(first.value);
    const flags = new Map();
    const positionals = [];
    const note = (flag, entry) => flags.set(flag, [...(flags.get(flag) || []), entry]);
    for (let at = hasMode ? 1 : 0; at < words.length; at++)
    {
        const word = words[at];
        if (!isFlagWord(word)) { positionals.push(classify(word)); continue; }
        if (word.value === ARG.passthrough)
        {
            const rest = words.slice(at + 1);
            if (rest.length === 0) note(word.value, true);
            for (const data of rest) for (const entry of classify(data)) note(word.value, entry);
            break;
        }
        const next = words[at + 1];
        if (next && !isFlagWord(next))
        {
            if (!flags.has(word.value)) flags.set(word.value, []);
            const entries = PATH_VALUE_FLAGS.has(word.value) && next.placeholder ? pathPlaceholder(word.value, next) : classify(next);
            for (const entry of entries) note(word.value, entry);
            at++;
        }
        else note(word.value, true);
    }
    return { mode: hasMode ? first.value : ARG.noMode, sequences: product(positionals), flags };
}

// Every node call of one command text, as { script, shape }.
function callsOf(text)
{
    const found = [];
    for (const match of text.matchAll(SCRIPT_RE))
    {
        if (!CALL.head.test(text.slice(0, match.index))) continue;
        found.push({ script: match[1], shape: shapeOfCall(readCallWords(text.slice(match.index + match[0].length))) });
    }
    return found;
}

const keyOf = (entry) => JSON.stringify(entry);

// Adds one call's shape to the merged scripts Map: script -> mode -> { sequences: Map key -> sequence, flags: Map flag -> Map key -> entry }.
function mergeCall(scripts, { script, shape })
{
    if (!scripts.has(script)) scripts.set(script, new Map());
    const modes = scripts.get(script);
    if (!modes.has(shape.mode)) modes.set(shape.mode, { sequences: new Map(), flags: new Map() });
    const into = modes.get(shape.mode);
    for (const sequence of shape.sequences) into.sequences.set(keyOf(sequence), sequence);
    for (const [flag, entries] of shape.flags)
    {
        if (!into.flags.has(flag)) into.flags.set(flag, new Map());
        for (const entry of entries) into.flags.get(flag).set(keyOf(entry), entry);
    }
}

const sorted = (map) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);

// The merged Map as the table's `scripts` object, every list in a stable order.
function scriptsObject(scripts)
{
    const out = {};
    for (const name of [...scripts.keys()].sort())
    {
        out[name] = {};
        for (const mode of [...scripts.get(name).keys()].sort())
        {
            const { sequences, flags } = scripts.get(name).get(mode);
            const flagObject = {};
            for (const flag of [...flags.keys()].sort()) flagObject[flag] = sorted(flags.get(flag));
            out[name][mode] = { positionals: sorted(sequences), flags: flagObject };
        }
    }
    return out;
}

module.exports = { classify, shapeOfCall, callsOf, mergeCall, scriptsObject };
