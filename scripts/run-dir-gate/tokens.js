'use strict';
// A call may open with `cd . && ` and a run of `TMP=<dir>;`, `TMP_WIN=<dir>;` and `MARK=<path>;` assignments, each value the run's
// own. The gate reads such a call as its literal form: the tokens it sets are replaced by their values in the rest of the call.
// Pure: text in, text or null out.
const { RUN_TOKENS, SHELL, QUOTE } = require('./constants.js');
const { canon, resolveWord, isAbsoluteWord, sameFolded } = require('./paths.js');

// Whether `value` names what the token stands for: the run dir for TMP and TMP_WIN, the marker's path for MARK.
function isOwnValue(name, value, ctx)
{
    const win = SHELL.driveStart.test(ctx.runDir);
    const own = name === RUN_TOKENS.marker ? ctx.markerPath : ctx.runDir;
    if (!own || !isAbsoluteWord(value, win)) return false;
    const target = resolveWord(value, ctx.cwd, win);
    return Boolean(target) && sameFolded(target, canon(own, win));
}

// The leading assignments of `text`: { values, rest }, or null for a value that is not the run's own or a name set twice.
function takeAssignments(text, ctx)
{
    const values = new Map();
    let rest = text;
    for (let match = RUN_TOKENS.assignment.exec(rest); match; match = RUN_TOKENS.assignment.exec(rest))
    {
        const [whole, name, quoted, bare] = match;
        const value = quoted === undefined ? bare : quoted;
        if (values.has(name) || !isOwnValue(name, value, ctx)) return null;
        values.set(name, value);
        rest = rest.slice(whole.length);
    }
    return { values, rest };
}

// `text` with each `$TMP`, `${TMP}` (and the other two tokens) replaced by its value, outside single quotes only; a `$?` is left for
// the form check, which allows it in the echo tail alone. Null when a `$` or a backtick is left that is no set token, or a token's value would sit unquoted with a backslash in it.
function substitute(text, values)
{
    let out = '';
    let quote = QUOTE.none;
    let at = 0;
    while (at < text.length)
    {
        const ch = text[at];
        if (quote === QUOTE.single) { out += ch; quote = ch === QUOTE.single ? QUOTE.none : quote; at++; continue; }
        if (ch === RUN_TOKENS.escape)
        {
            const next = text[at + 1] || '';
            if (next === RUN_TOKENS.substitution || next === RUN_TOKENS.backtick) return null;
            out += ch + next;
            at += 2;
            continue;
        }
        if (ch === RUN_TOKENS.backtick) return null;
        if (ch === RUN_TOKENS.substitution)
        {
            if (text.startsWith(RUN_TOKENS.status, at)) { out += RUN_TOKENS.status; at += RUN_TOKENS.status.length; continue; }
            const reference = RUN_TOKENS.reference.exec(text.slice(at));
            const value = reference ? values.get(reference[1] || reference[2]) : undefined;
            if (value === undefined || (quote === QUOTE.none && value.includes(RUN_TOKENS.escape))) return null;
            out += value;
            at += reference[0].length;
            continue;
        }
        if (ch === QUOTE.double) quote = quote === QUOTE.double ? QUOTE.none : QUOTE.double;
        else if (ch === QUOTE.single && quote === QUOTE.none) quote = QUOTE.single;
        out += ch;
        at++;
    }
    return out;
}

// The call without its `cd . && ` and token assignments and with the tokens written out, the call itself when it has neither, or
// null for a prefix the gate does not read.
function withoutTokenPrefix(command, ctx)
{
    const opened = command.startsWith(RUN_TOKENS.cdHere) ? command.slice(RUN_TOKENS.cdHere.length) : command;
    const taken = takeAssignments(opened, ctx);
    if (!taken) return null;
    if (opened === command && taken.rest === command) return command;
    return substitute(taken.rest, taken.values);
}

module.exports = { withoutTokenPrefix };
