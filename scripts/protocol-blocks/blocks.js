'use strict';
// Pure logic of the protocol-block approval: a Bash call is approved only when its text is a shipped fixed block, or the
// shared opener followed by one. Values in, values out.
const crypto = require('node:crypto');
const { SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, OPENER_LINE, HASH } = require('./constants.js');

// Whether a block holds a `<name>` the model fills in, comments left out.
const hasPlaceholder = (body) => PLACEHOLDER_RE.test(body.replace(COMMENT_RE, '$1'));

// One spelling for a command: LF line ends, no trailing spaces, no blank lines around it.
function normalize(text)
{
    return String(text).replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n')
        .replace(/^\n+/, '').replace(/\n+$/, '');
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
    const hashes = new Set();
    for (const { text } of files)
        for (const block of fenceBlocks(text))
        {
            if (!SHELL_LANGS.has(block.lang) || hasPlaceholder(block.body)) continue;
            const body = normalize(block.body);
            if (!body) continue;
            if (body.includes(OPENER_LINE)) openers.add(body);
            hashes.add(digest(body));
        }
    if (openers.size !== 1) throw new Error(`protocol-blocks: exactly one opener, found ${openers.size}`);
    return { opener: [...openers][0], blocks: [...hashes].sort() };
}

// Whether a Bash call's text is a shipped fixed block, or the opener then one on the next line.
function approves(command, table)
{
    if (typeof command !== 'string' || !table || !Array.isArray(table.blocks)) return false;
    const text = normalize(command);
    if (!text) return false;
    const known = new Set(table.blocks);
    if (known.has(digest(text))) return true;
    const opener = String(table.opener || '');
    if (!opener || !text.startsWith(`${opener}\n`)) return false;
    const rest = normalize(text.slice(opener.length));
    return Boolean(rest) && known.has(digest(rest));
}

module.exports = { normalize, digest, fenceBlocks, buildTable, approves };
