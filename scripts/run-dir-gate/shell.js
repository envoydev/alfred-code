'use strict';
// A small reader for the narrow shell the walk uses: words, `;` `&&` `||` `|`, one `( ... )` group, `> file` and `2>&1`.
// Anything else - a `$`, a backtick, a glob, a `<`, a lone `&` - is not read, and the reader returns null. Pure.
const { SHELL } = require('./constants.js');

const isBoundary = (ch) => ch === undefined || ch === ' ' || ch === ';' || ch === '|' || ch === '&' || ch === ')' || ch === '>';

function readQuoted(text, start)
{
    const quote = text[start];
    const end = text.indexOf(quote, start + 1);
    if (end < 0 || !isBoundary(text[end + 1])) return null;
    const value = text.slice(start + 1, end);
    if (quote === "'") return { token: { type: 'word', value, quote }, next: end + 1 };
    if (!SHELL.unsafeInDouble.test(value)) return { token: { type: 'word', value, quote }, next: end + 1 };
    if (SHELL.echoLabel.test(value)) return { token: { type: 'word', value, quote, label: true }, next: end + 1 };
    return null;
}

function readBare(text, start)
{
    let end = start;
    while (end < text.length && SHELL.bareChar.test(text[end])) end++;
    if (end === start || !isBoundary(text[end])) return null;
    return { token: { type: 'word', value: text.slice(start, end), quote: '' }, next: end };
}

function readOperator(text, start)
{
    const pair = text.slice(start, start + 2);
    if (pair === '&&' || pair === '||') return { token: { type: 'op', value: pair }, next: start + 2 };
    const ch = text[start];
    if (ch === ';' || ch === '|' || ch === '(' || ch === ')' || ch === '>') return { token: { type: 'op', value: ch }, next: start + 1 };
    return null;
}

function scan(text)
{
    const tokens = [];
    let i = 0;
    while (i < text.length)
    {
        const ch = text[i];
        if (ch === ' ') { i++; continue; }
        let read;
        if (text.startsWith(SHELL.stderrToOut, i) && isBoundary(text[i + SHELL.stderrToOut.length]))
            read = { token: { type: 'op', value: SHELL.stderrToOut }, next: i + SHELL.stderrToOut.length };
        else if (ch === '"' || ch === "'") read = readQuoted(text, i);
        else read = readOperator(text, i) || readBare(text, i);
        if (!read) return null;
        tokens.push(read.token);
        i = read.next;
    }
    return tokens;
}

const isOp = (token, value) => Boolean(token) && token.type === 'op' && token.value === value;

// One command: its words, an optional `> file` and an optional `2>&1`, and nothing after a redirect.
function readCommand(tokens, start)
{
    const command = { words: [], out: null, err: false };
    let i = start;
    while (i < tokens.length)
    {
        const token = tokens[i];
        if (token.type === 'word')
        {
            if (command.out || command.err) return null;
            command.words.push(token);
            i++;
        }
        else if (isOp(token, SHELL.redirect))
        {
            if (command.out || !tokens[i + 1] || tokens[i + 1].type !== 'word') return null;
            command.out = tokens[i + 1];
            i += 2;
        }
        else if (isOp(token, SHELL.stderrToOut))
        {
            if (command.err) return null;
            command.err = true;
            i++;
        }
        else break;
    }
    return command.words.length ? { command, next: i } : null;
}

function readPipeline(tokens, start)
{
    const commands = [];
    let i = start;
    for (;;)
    {
        const read = readCommand(tokens, i);
        if (!read) return null;
        commands.push(read.command);
        i = read.next;
        if (!isOp(tokens[i], SHELL.pipe)) return { element: { kind: 'pipeline', commands }, next: i };
        i++;
    }
}

// A list of pipelines and groups joined by `;` `&&` `||`: { list: { elements, seps }, next }. A group holds no group.
function readList(tokens, start, inGroup)
{
    const elements = [];
    const seps = [];
    let i = start;
    for (;;)
    {
        let element;
        if (isOp(tokens[i], SHELL.open))
        {
            if (inGroup) return null;
            const inner = readList(tokens, i + 1, true);
            if (!inner) return null;
            element = { kind: 'group', list: inner.list };
            i = inner.next;
        }
        else
        {
            const read = readPipeline(tokens, i);
            if (!read) return null;
            element = read.element;
            i = read.next;
        }
        elements.push(element);
        const token = tokens[i];
        if (!token) return inGroup ? null : { list: { elements, seps }, next: i };
        if (isOp(token, SHELL.close)) return inGroup ? { list: { elements, seps }, next: i + 1 } : null;
        if (token.type !== 'op' || !SHELL.listOps.has(token.value)) return null;
        seps.push(token.value);
        i++;
    }
}

function parse(text)
{
    const tokens = scan(text);
    if (!tokens || !tokens.length) return null;
    const read = readList(tokens, 0, false);
    return read ? read.list : null;
}

module.exports = { parse };
