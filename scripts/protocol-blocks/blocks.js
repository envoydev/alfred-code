'use strict';
// Pure logic of the protocol-block approval: a Bash call is approved only when its text is a shipped fixed block, or the
// shared opener followed by one. Values in, values out.
const crypto = require('node:crypto');
const { SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, OPENER_LINE, RESOLVE_LINE, CONTROL_RE, HASH } = require('./constants.js');

// Whether a block holds a `<name>` the model fills in, comments left out.
const hasPlaceholder = (body) => PLACEHOLDER_RE.test(body.replace(COMMENT_RE, '$1'));

// One spelling for a command: LF line ends, no trailing spaces, no blank lines around it. Only a CRLF pair is a line end.
function normalize(text)
{
    return String(text).replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n')
        .replace(/^\n+/, '').replace(/\n+$/, '');
}

// The block with its comments taken out, the way bash reads it: a `#` that opens a word outside quotes runs to the line's
// end, and a line left empty goes. Run on SHIPPED text only, so a second exact spelling is known - never on a command
// the hook judges. A block with a heredoc gets no second spelling (null).
function withoutComments(body)
{
    if (body.includes('<<')) return null;
    let quote = '';
    const lines = [];
    for (const line of body.split('\n'))
    {
        let cut = line.length;
        for (let i = 0; i < line.length; i++)
        {
            const ch = line[i];
            if (quote === "'") { if (ch === "'") quote = ''; continue; }
            if (ch === '\\') { i++; continue; }
            if (quote === '"') { if (ch === '"') quote = ''; continue; }
            if (ch === "'" || ch === '"') { quote = ch; continue; }
            if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) { cut = i; break; }
        }
        const kept = line.slice(0, cut).replace(/[ \t]+$/, '');
        if (kept || cut === line.length) lines.push(kept);
    }
    return normalize(lines.join('\n'));
}

const digest = (text) => crypto.createHash(HASH).update(text).digest('hex');

// Every fenced block of a markdown text, its language and its body with the fence's indent taken off.
function fenceBlocks(markdown)
{
    return [...String(markdown).matchAll(FENCE_RE)].map((m) => ({
        lang: m[2].trim(),
        body: m[3].split('\n').map((line) => (line.startsWith(m[1]) ? line.slice(m[1].length) : line)).join('\n').replace(/\n$/, ''),
    }));
}

// The table from the bodies ({ file, text } each): the opener, and the sorted hashes of every fixed shell block.
function buildTable(files)
{
    const openers = new Set();
    const resolves = new Set();
    const hashes = new Set();
    const spellings = (body) => [...new Set([body, withoutComments(body)].filter(Boolean))];
    for (const { text } of files)
        for (const block of fenceBlocks(text))
        {
            if (!SHELL_LANGS.has(block.lang) || hasPlaceholder(block.body)) continue;
            const body = normalize(block.body);
            if (!body) continue;
            for (const spelling of spellings(body))
            {
                if (body.includes(OPENER_LINE)) openers.add(spelling);
                if (body.includes(RESOLVE_LINE)) resolves.add(digest(spelling));
                hashes.add(digest(spelling));
            }
        }
    const shipped = (set) => files.flatMap(({ text }) => fenceBlocks(text)).filter((b) => SHELL_LANGS.has(b.lang)).map((b) => normalize(b.body))
        .filter((body) => body.includes(set)).filter((body, i, all) => all.indexOf(body) === i).length;
    if (shipped(OPENER_LINE) !== 1) throw new Error(`protocol-blocks: exactly one opener, found ${shipped(OPENER_LINE)}`);
    if (shipped(RESOLVE_LINE) !== 1) throw new Error(`protocol-blocks: exactly one resolve block, found ${shipped(RESOLVE_LINE)}`);
    return { openers: [...openers].sort(), resolves: [...resolves].sort(), blocks: [...hashes].sort() };
}

// Whether a Bash call's text is the resolve block, the opener, or the opener then a shipped fixed block on the next line.
// A fixed block alone sets no variable, so Claude Code's own prompt for it is left to the user (review MATERIAL).
function approves(command, table)
{
    if (typeof command !== 'string' || !table || !Array.isArray(table.blocks)) return false;
    const text = normalize(command);
    if (!text || CONTROL_RE.test(text)) return false;
    const openers = Array.isArray(table.openers) ? table.openers.map(String).filter(Boolean) : [];
    if ((Array.isArray(table.resolves) && table.resolves.includes(digest(text))) || openers.includes(text)) return true;
    const known = new Set(table.blocks);
    return openers.some((opener) =>
    {
        if (!text.startsWith(`${opener}\n`)) return false;
        const rest = normalize(text.slice(opener.length));
        return Boolean(rest) && known.has(digest(rest));
    });
}

module.exports = { normalize, withoutComments, digest, fenceBlocks, buildTable, approves };
