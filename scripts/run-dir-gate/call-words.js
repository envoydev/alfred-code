'use strict';
// The words of one node call as a walk body writes it. Pure text work.
const { PLACEHOLDER_RE, CALL, QUOTE } = require('./constants.js');

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

module.exports = { readCallWords };
