'use strict';
// What the walk bodies call each script with: the mode (the first word, when it is a plain word) and the flags. Pure text work.
const { SHELL_LANGS, FENCE_RE, INLINE_CODE_RE, LINE_BREAK_RE, SCRIPT_RE, PLACEHOLDER_RE, ARG, CALL, QUOTE } = require('./constants.js');

const isSpace = (ch) => ch === ' ' || ch === '\t';
const startsPlaceholder = (text, at) => text[at] === '<' && /[A-Za-z]/.test(text[at + 1] || '');

// The end of a bare word: a space or a stop character; a `<name>` placeholder is read through to its `>`.
function bareEnd(text, start)
{
    let at = start;
    while (at < text.length && !isSpace(text[at]) && !CALL.stop.has(text[at]))
    {
        if (startsPlaceholder(text, at))
        {
            const close = text.indexOf('>', at);
            if (close < 0) break;
            at = close + 1;
        }
        else at++;
    }
    return at;
}

// The words of one call's argument list, up to the first `;` `)` `>` `&` `|` or line end: { value, quote, placeholder }.
function readCallWords(text)
{
    const words = [];
    let at = 0;
    while (at < text.length)
    {
        const ch = text[at];
        if (isSpace(ch)) { at++; continue; }
        if (text.startsWith(CALL.continuation, at)) { at += CALL.continuation.length; continue; }
        if (text.startsWith(CALL.stderrToOut, at) || (ch === '|' && (text[at + 1] === ' ' || text[at + 1] === '|' || text[at + 1] === undefined))) break;
        if (ch === QUOTE.double || ch === QUOTE.single)
        {
            const close = text.indexOf(ch, at + 1);
            if (close < 0) break;
            const value = text.slice(at + 1, close);
            words.push({ value, quote: ch, placeholder: PLACEHOLDER_RE.test(value) });
            at = close + 1;
            continue;
        }
        const end = bareEnd(text, at);
        if (end === at) break;
        const value = text.slice(at, end).replace(CALL.brackets.open, '').replace(CALL.brackets.close, '');
        if (value) words.push({ value, quote: QUOTE.none, placeholder: PLACEHOLDER_RE.test(value) });
        at = end;
    }
    return words;
}

const isFlagWord = (word) => word.quote === QUOTE.none && !word.placeholder
    && (ARG.longFlag.test(word.value) || ARG.shortFlag.test(word.value) || word.value === ARG.passthrough);

function shapeOfCall(words)
{
    const [first] = words;
    const mode = first && first.quote === QUOTE.none && !first.placeholder && ARG.modeWord.test(first.value) ? first.value : ARG.noMode;
    return { mode, flags: words.filter(isFlagWord).map((word) => word.value) };
}

// The texts a body runs commands from: its fenced shell blocks and its inline code spans, never its prose.
function sourcesOf(text, blocks)
{
    const sources = blocks.filter((block) => SHELL_LANGS.has(block.lang)).map((block) => block.body);
    sources.push(...Array.from(String(text).replace(FENCE_RE, '').matchAll(INLINE_CODE_RE), (span) => span[1].replace(LINE_BREAK_RE, ' ')));
    return sources;
}

// Every script a body names, with the modes and flags of each `node "<run dir>/repo/<script>" ...` call: Map path -> { modes, flags }.
function scriptShapes(text, blocks)
{
    const found = new Map();
    for (const source of sourcesOf(text, blocks))
    {
        for (const match of source.matchAll(SCRIPT_RE))
        {
            if (!found.has(match[1])) found.set(match[1], { modes: new Set(), flags: new Set() });
            if (!CALL.head.test(source.slice(0, match.index))) continue;
            const shape = shapeOfCall(readCallWords(source.slice(match.index + match[0].length)));
            found.get(match[1]).modes.add(shape.mode);
            for (const flag of shape.flags) found.get(match[1]).flags.add(flag);
        }
    }
    return found;
}

module.exports = { readCallWords, shapeOfCall, scriptShapes };
