'use strict';
// Pure logic of the resolve-block table: the block's hashes, the scripts the walk runs, and the check of a command against
// them. Values in, values out.
const crypto = require('node:crypto');
const { SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, INLINE_CODE_RE, RESOLVE_LINE, CONTROL_RE, CARRIAGE_RETURN_RE, HASH, SCRIPT_RE } = require('./constants.js');

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

// The script paths a body runs from the snapshot: in a fenced shell block or an inline code span, never in prose.
function scriptsOf(text, blocks)
{
    const found = new Set();
    const sources = blocks.filter((block) => SHELL_LANGS.has(block.lang)).map((block) => block.body);
    sources.push(...Array.from(String(text).replace(FENCE_RE, '').matchAll(INLINE_CODE_RE), (span) => span[1]));
    for (const source of sources) for (const match of source.matchAll(SCRIPT_RE)) found.add(match[1]);
    return found;
}

// The table from the bodies ({ file, text } each): the sorted hashes of the resolve block's spellings, and the sorted
// script paths the bodies name.
function buildTable(files)
{
    const resolveBodies = new Set();
    const resolves = new Set();
    const scripts = new Set();
    for (const { text } of files)
    {
        const blocks = fenceBlocks(text);
        for (const script of scriptsOf(text, blocks)) scripts.add(script);
        for (const block of blocks)
        {
            if (!SHELL_LANGS.has(block.lang) || hasPlaceholder(block.body)) continue;
            const body = normalize(block.body);
            if (!body.includes(RESOLVE_LINE)) continue;
            resolveBodies.add(body);
            for (const spelling of new Set([body, withoutComments(body)].filter(Boolean))) resolves.add(digest(spelling));
        }
    }
    if (resolveBodies.size !== 1) throw new Error(`run-dir-gate: exactly one resolve block, found ${resolveBodies.size}`);
    return { resolves: [...resolves].sort(), scripts: [...scripts].sort() };
}

// Whether a Bash call's text is the resolve block, in either shipped spelling.
function isResolve(command, table)
{
    if (typeof command !== 'string' || !table || !Array.isArray(table.resolves)) return false;
    if (CARRIAGE_RETURN_RE.test(command)) return false;
    const text = normalize(command);
    return Boolean(text) && !CONTROL_RE.test(text) && table.resolves.includes(digest(text));
}

module.exports = { normalize, withoutComments, digest, fenceBlocks, buildTable, isResolve };
