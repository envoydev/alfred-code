'use strict';
// Whether the arguments of one `node "<run dir>/repo/<script>"` call are ones a walk body writes: a mode and flags the table
// lists for the script, and values that are plain words or paths under the run dir or the project. Pure.
const { SHELL, QUOTE, FLAG, ARG, OUTPUT_FLAGS, PHRASE_FLAGS, INSTALLER_MODES, WORD, PARENT_READ } = require('./constants.js');
const { isAbsoluteWord, isUnder, sepOf, resolveWord } = require('./paths.js');
const { resolveIn, isTarget } = require('./state.js');

const isBare = (word) => word.quote === QUOTE.none;
const isFlagShape = (text) => ARG.longFlag.test(text) || ARG.shortFlag.test(text);

// The mode and the words after it. A first plain word is a mode when the script has modes; a script with none reads it as a value.
function splitMode(args, shape)
{
    const [first] = args;
    if (first && isBare(first) && ARG.modeWord.test(first.value))
    {
        if (shape.modes.has(first.value)) return { mode: first.value, rest: args.slice(1) };
        if (shape.hasModes) return null;
    }
    return shape.modes.has(ARG.noMode) ? { mode: ARG.noMode, rest: args } : null;
}

function isPathValue(word, base, state)
{
    const text = word.value;
    if (word.quote === QUOTE.single || ARG.badPathChar.test(text)) return false;
    const absolute = word.quote === QUOTE.double && isAbsoluteWord(text, state.win);
    if (!absolute && text !== WORD.here && !ARG.relativePath.test(text)) return false;
    const resolved = resolveWord(text, base, state.win);
    return Boolean(resolved) && state.roots.some((root) => isUnder(resolved, root, state.win));
}

function isValueWord(word, previousFlag, base, state)
{
    const text = word.value;
    if (text === '' || text.startsWith(FLAG.dash)) return false;
    if (PHRASE_FLAGS.has(previousFlag) && word.quote !== QUOTE.none && ARG.phrase.test(text)) return true;
    if (word.quote === QUOTE.single) return false;
    if (ARG.plainWord.test(text) && text !== WORD.here) return !ARG.allDots.test(text);
    return isPathValue(word, base, state);
}

// The mode of a call whose arguments all pass, else null. After a `--` the table lists for the script, flags are data: any
// flag-shaped word goes, and each value still passes the value test.
function checkArgs(shape, args, base, state)
{
    const split = splitMode(args, shape);
    if (!split) return null;
    const { rest } = split;
    let previous = '';
    let data = false;
    for (let i = 0; i < rest.length; i++)
    {
        const word = rest[i];
        if (isBare(word) && word.value.startsWith(FLAG.dash))
        {
            const known = shape.flags.has(word.value);
            if (word.value === ARG.passthrough && (!known || data)) return null;
            if (word.value === ARG.passthrough) data = true;
            else if (!isFlagShape(word.value) || !(known || data)) return null;
            previous = word.value === ARG.passthrough ? '' : word.value;
            if (OUTPUT_FLAGS.has(previous) && !data)
            {
                i++;
                if (!rest[i] || !isTarget(rest[i], base, state)) return null;
                previous = '';
            }
            continue;
        }
        if (!isValueWord(word, previous, base, state)) return null;
        previous = '';
    }
    return split.mode;
}

// The script a word names under the run dir's snapshot, as the table spells it, or null.
function scriptNameOf(word, base, state)
{
    const script = resolveIn(word, base, state);
    const prefix = `${state.repoDir}${sepOf(state.win)}`;
    if (!script || !script.startsWith(prefix)) return null;
    return script.slice(prefix.length).split(SHELL.segmentSplit).join('/');
}

function valueAfter(words, flag)
{
    const at = words.findIndex((word) => word.value === flag);
    return at < 0 || words.some((word, index) => index > at && word.value === flag) ? null : words[at + 1] || null;
}

// An installer call names its snapshot once, and it is this run's: an `--source=<path>` or a second `--source` would swap it for
// a folder the walk never made, and no `--flag=value` spelling passes an installer form at all.
function pinsSource(args, base, state)
{
    if (args.some((word) => word.value.startsWith(FLAG.long) && word.value.includes(FLAG.assign))) return false;
    const source = valueAfter(args, PARENT_READ.source);
    return Boolean(source) && resolveIn(source, base, state) === state.repoDir;
}

// A node call: the script is in the table, its mode and flags are ones a body calls it with, and an installer call also takes
// a mode of its own list and pins its source.
function isNodeCall(words, base, state)
{
    if (words.length === 0) return false;
    const name = scriptNameOf(words[0], base, state);
    const shape = name && state.scripts.get(name.toLowerCase());
    if (!shape) return false;
    const mode = checkArgs(shape, words.slice(1), base, state);
    if (mode === null) return false;
    return name.toLowerCase() !== PARENT_READ.installer || (INSTALLER_MODES.has(mode) && pinsSource(words.slice(1), base, state));
}

module.exports = { checkArgs, scriptNameOf, valueAfter, pinsSource, isNodeCall };
