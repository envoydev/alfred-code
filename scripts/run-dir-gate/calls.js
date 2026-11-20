'use strict';
// The commands the four typed walks run, read from their bodies: which files a walk reaches, and the shell commands those files
// hold. The table generator and the body test share this one reader. Pure: the caller hands the texts in.
const { BODY, WALKS, SKIPPED_REFERENCES, REFERENCE_NAME, COLLECT, NOT_CALLS, SHELL_LANGS, FENCE_RE, INLINE_CODE_RE, LINE_BREAK_RE, RESOLVE_LINE } = require('./constants.js');

// The files a walk reaches from its command file through the `references/<name>.md` names its bodies write: a Set of paths.
// `texts` is a Map path -> text; a name with no file in it is not followed.
function reachableFiles(walk, texts)
{
    const start = `${BODY.commands}/${walk}.md`;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length)
    {
        const file = queue.shift();
        for (const match of String(texts.get(file) || '').matchAll(REFERENCE_NAME))
        {
            const next = `${BODY.references}/${match[1]}`;
            if (SKIPPED_REFERENCES.has(match[1]) || seen.has(next) || !texts.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return seen;
}

// Every file any of the four walks reaches and the texts hold, sorted.
const walkFilesOf = (texts) => [...new Set(WALKS.flatMap((walk) => [...reachableFiles(walk, texts)]))].filter((file) => texts.has(file)).sort();

// Each 'in ONE Bash `cat`' sentence is a call that reads the plugin-root paths named before it in the same paragraph or item.
function proseReads(text)
{
    const reads = [];
    for (const match of text.matchAll(COLLECT.proseCat))
    {
        const before = text.slice(Math.max(0, match.index - COLLECT.proseWindow), match.index);
        const cut = before.split(COLLECT.paragraphBreak).pop();
        const paths = [...new Set((cut.match(COLLECT.pluginPath) || []).map((found) => found.replace(COLLECT.trailingPunctuation, '')))];
        if (paths.length) reads.push(`cat ${paths.map((found) => `"${found}"`).join(' ')}`);
    }
    return reads;
}

// The commands of one body: the resolve block whole, each other fenced shell line, each inline span that reads as a command,
// and each prose `cat` read. `blocks` are the body's fenced blocks ({ lang, body }).
function commandsOf(file, text, blocks)
{
    const found = [];
    for (const block of blocks)
    {
        if (!SHELL_LANGS.has(block.lang)) continue;
        if (block.body.includes(RESOLVE_LINE)) { found.push({ file, text: block.body, resolve: true }); continue; }
        for (const line of block.body.split('\n')) if (line.trim() && !COLLECT.commentLine.test(line)) found.push({ file, text: line.trim(), resolve: false });
    }
    for (const span of text.replace(FENCE_RE, '').matchAll(INLINE_CODE_RE))
    {
        const flat = span[1].replace(LINE_BREAK_RE, ' ').trim();
        if (COLLECT.appended.test(flat)) found.push({ file, text: `${COLLECT.appendBase} ${flat}`, resolve: false });
        else if (COLLECT.commandSpan.test(flat) && !COLLECT.scriptPlaceholder.test(flat)) found.push({ file, text: flat, resolve: false });
    }
    for (const read of proseReads(text)) found.push({ file, text: read, resolve: false });
    return found;
}

const isNotCall = (command) => NOT_CALLS.some((entry) => command.file.endsWith(entry.file) && command.text.startsWith(entry.prefix));

module.exports = { reachableFiles, walkFilesOf, proseReads, commandsOf, isNotCall };
