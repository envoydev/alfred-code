'use strict';
// The gate's half of the value templates: compiles a table template and tells whether one word of a call fits it. A word is
// { value, quote }. Pure.
const { ARG, VALUE, TEMPLATE, FLAG, WORD } = require('./constants.js');
const { isStrictlyUnder, segmentsBelow, resolveWord } = require('./paths.js');

const escapeText = (text) => text.replace(TEMPLATE.regexSpecials, '\\$&');

// A suffix segment as a case-blind test: its text is literal, and a `<name>` in it is one run of plain characters.
function segmentTest(segment)
{
    const pattern = segment.split(TEMPLATE.placeholderParts).map((part, at) => (at % 2 ? TEMPLATE.segmentPlaceholder : escapeText(part))).join('');
    return new RegExp(`^${pattern}$`, 'i');
}

// The template as the gate reads it, or null for one the table spells wrongly - which then matches nothing.
function compileTemplate(template)
{
    if (!template || typeof template !== 'object' || !TEMPLATE.kinds.has(template.kind)) return null;
    if (template.kind === VALUE.literal) return typeof template.value === 'string' ? { kind: VALUE.literal, value: template.value } : null;
    if (template.kind !== VALUE.runDir) return { kind: template.kind };
    if (typeof template.suffix !== 'string' || template.suffix === '') return null;
    return { kind: VALUE.runDir, segments: template.suffix.split(TEMPLATE.segmentSep).map(segmentTest) };
}

const startsWithDash = (text) => text.startsWith(FLAG.dash);

function isRunDirValue(template, word, base, state)
{
    const target = resolveWord(word.value, base, state.win);
    if (!target || !isStrictlyUnder(target, state.runDir, state.win)) return false;
    const below = segmentsBelow(target, state.runDir, state.win);
    return below.length === template.segments.length && below.every((segment, at) => ARG.targetSegment.test(segment) && template.segments[at].test(segment));
}

function isCwdPath(text)
{
    if (text === WORD.here) return true;
    if (!text.startsWith(`${WORD.here}${TEMPLATE.segmentSep}`)) return false;
    return text.slice(WORD.here.length + 1).split(TEMPLATE.segmentSep).every((segment) => ARG.cwdSegment.test(segment));
}

// Whether `word` fits `template`. After a `--` the words are data, so a leading dash passes there (`afterDashes`).
function fitsTemplate(template, word, base, state, { afterDashes = false } = {})
{
    const { value } = word;
    if (template.kind === VALUE.literal) return value === template.value;
    if (value === '') return false;
    if (template.kind === VALUE.runDir) return isRunDirValue(template, word, base, state);
    if (template.kind === VALUE.cwdPath) return isCwdPath(value);
    if (startsWithDash(value) && !afterDashes) return false;
    if (value === ARG.passthrough) return false;
    if (template.kind === VALUE.word) return ARG.plainWord.test(value) && !ARG.allDots.test(value);
    return template.kind === VALUE.phrase && ARG.phrase.test(value);
}

module.exports = { compileTemplate, fitsTemplate };
