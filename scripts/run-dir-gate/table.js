'use strict';
// Pure logic of the resolve-block table: the block's hashes, the scripts the walk runs, and the check of a command against
// them. Values in, values out.
const crypto = require('node:crypto');
const { SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, RESOLVE_LINE, CONTROL_RE, CARRIAGE_RETURN_RE, HASH } = require('./constants.js');
const { walkFilesOf, commandsOf, isNotCall } = require('./calls.js');
const { callsOf, mergeCall, scriptsObject } = require('./templates.js');

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

// The table from the bodies ({ file, text } each): the sorted hashes of the resolve block's spellings, and each script the four
// walks run from the snapshot with a template per mode - the positionals and the flag values the walk bodies write.
function buildTable(files)
{
    const resolveBodies = new Set();
    const resolves = new Set();
    const texts = new Map(files.map(({ file, text }) => [file, text]));
    for (const { text } of files)
    {
        for (const block of fenceBlocks(text))
        {
            if (!SHELL_LANGS.has(block.lang) || hasPlaceholder(block.body)) continue;
            const body = normalize(block.body);
            if (!body.includes(RESOLVE_LINE)) continue;
            resolveBodies.add(body);
            for (const spelling of new Set([body, withoutComments(body)].filter(Boolean))) resolves.add(digest(spelling));
        }
    }
    if (resolveBodies.size !== 1) throw new Error(`run-dir-gate: exactly one resolve block, found ${resolveBodies.size}`);
    const scripts = new Map();
    for (const file of walkFilesOf(texts))
    {
        const text = texts.get(file);
        for (const command of commandsOf(file, text, fenceBlocks(text)))
            if (!command.resolve && !isNotCall(command)) for (const call of callsOf(command.text)) mergeCall(scripts, call);
    }
    return { resolves: [...resolves].sort(), scripts: scriptsObject(scripts) };
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
