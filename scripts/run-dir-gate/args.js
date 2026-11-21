'use strict';
// Whether the arguments of one `node "<run dir>/repo/<script>"` call are ones a walk body writes: a mode of the script's table
// entry, and flags, values and positionals that fit its templates. Pure.
const { SHELL, QUOTE, FLAG, ARG, OUTPUT_FLAGS, INSTALLER_MODES, PARENT_READ } = require('./constants.js');
const { sepOf, sameFolded, fold } = require('./paths.js');
const { fitsTemplate } = require('./values.js');
const { resolveIn, isTarget } = require('./state.js');

const isBare = (word) => word.quote === QUOTE.none;
const isFlagShape = (text) => ARG.longFlag.test(text) || ARG.shortFlag.test(text);
const looksLikeFlag = (word) => isBare(word) && word.value.startsWith(FLAG.dash);

// The mode and the words after it. A first plain word that names a mode of the script is the mode; otherwise the call has no
// mode, and the script must list the empty one.
function splitMode(args, modes)
{
    const [first] = args;
    if (first && isBare(first) && ARG.modeWord.test(first.value) && modes.has(first.value)) return { mode: first.value, rest: args.slice(1) };
    return modes.has(ARG.noMode) ? { mode: ARG.noMode, rest: args } : null;
}

const fitsAny = (templates, word, base, state, afterDashes = false) => templates.some((template) => fitsTemplate(template, word, base, state, { afterDashes }));

// Whether the words are the templates in order, a `repeat` template taking one word or more. One pass over the words with the
// set of template positions still possible, so a long run of words costs no stack.
function fitsSequence(sequence, words, base, state)
{
    let positions = new Set([0]);
    for (const word of words)
    {
        const next = new Set();
        for (const at of positions)
        {
            if (at >= sequence.length || !fitsTemplate(sequence[at], word, base, state)) continue;
            next.add(at + 1);
            if (sequence[at].repeat === true) next.add(at);
        }
        if (next.size === 0) return false;
        positions = next;
    }
    return positions.has(sequence.length);
}

// Whether the words after the mode are the flags, flag values and positionals one mode's template lists. A flag takes the next
// word as its value when a template of the flag fits it; otherwise it must be one that stands alone. After a `--` every
// word is data and must fit one of the `--`'s templates.
function fitsMode(shape, rest, base, state)
{
    const positionals = [];
    const seen = new Set();
    for (let at = 0; at < rest.length; at++)
    {
        const word = rest[at];
        if (!looksLikeFlag(word)) { positionals.push(word); continue; }
        const entry = isFlagShape(word.value) || word.value === ARG.passthrough ? shape.flags.get(word.value) : null;
        if (!entry) return false;
        seen.add(word.value);
        if (word.value === ARG.passthrough)
        {
            const data = rest.slice(at + 1);
            if (data.length === 0 ? !entry.bare : !data.every((one) => fitsAny(entry.values, one, base, state, true))) return false;
            break;
        }
        const next = rest[at + 1];
        if (next && !looksLikeFlag(next) && fitsAny(entry.values, next, base, state))
        {
            if (OUTPUT_FLAGS.has(word.value) && !isTarget(next, base, state)) return false;
            at++;
        }
        else if (!entry.bare || OUTPUT_FLAGS.has(word.value)) return false;
    }
    return shape.required.every((flag) => seen.has(flag)) && shape.sequences.some((sequence) => fitsSequence(sequence, positionals, base, state));
}

// The mode of a call whose arguments all fit a template of the script, else null.
function checkArgs(modes, args, base, state)
{
    const split = splitMode(args, modes);
    return split && fitsMode(modes.get(split.mode), split.rest, base, state) ? split.mode : null;
}

// The script a word names under the run dir's snapshot, as the table spells it, or null.
function scriptNameOf(word, base, state)
{
    const script = resolveIn(word, base, state);
    const prefix = `${state.repoDir}${sepOf(state.win)}`;
    if (!script || !fold(script).startsWith(fold(prefix))) return null;
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
    return Boolean(source) && sameFolded(resolveIn(source, base, state) || '', state.repoDir);
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
