'use strict';
// The one JSON reader for every file the installer parses that a person may have edited (.mcp.json, settings.json,
// the account's .claude.json). An editor on Windows saves UTF-8 with a BOM, and a bare JSON.parse on it throws -
// which every `catch { return {} }` reader turned into 'the file is empty' (matrix F-BOM: a BOM'd .mcp.json read
// as no servers, so an update dropped a pick). One leading BOM is stripped; anything else wrong with the text - a
// BOM plus garbage included - still throws, so it still counts as unreadable.

const fs = require('node:fs');

const stripBom = (text) => (typeof text === 'string' && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

// JSON.parse of text that may start with a BOM; throws on anything unparseable.
const parseJson = (text) => JSON.parse(stripBom(text));

// The file's parsed value, or `{}` when it is absent or unreadable (the installer's long-standing reader shape).
const readJson = (file) => { try { return parseJson(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// THE ONE WRITE SHAPE (bug 4 of the complexity audit, 2026-11-10): a JSON file the installer writes back keeps the shape
// it was read in - its BOM, its line ends and its indent - so an update never re-lays out a person's CRLF or 4-space
// settings.json. Four writers kept the shape and seventeen did not; every write goes through these two now.
// `text` is the file as read, or null when it was absent. Blank text, and a file with no indented line (`{}`, a one-line
// object), is written with two spaces; a one-line file's layout is not kept, so it also takes the new file's final line
// end (and `writeLike`'s absent account file, read as '{}', is written as before). A mix of line ends is written all CRLF.
function formatOf(text)
{
    const bom = typeof text === 'string' && text.startsWith('\uFEFF');
    const body = typeof text === 'string' ? stripBom(text) : '';
    if (!body.trim()) return { bom, indent: '  ', eol: '\n', final: true };
    const indented = body.split(/\r?\n/).find((l) => /^[ \t]+\S/.test(l));
    return {
        bom,
        indent: indented ? /^[ \t]+/.exec(indented)[0] : '  ',
        eol: body.includes('\r\n') ? '\r\n' : '\n',
        final: /\r?\n$/.test(body) || !/\n/.test(body),
    };
}

// `data` as JSON in `format` (formatOf's shape).
const stringifyLike = (data, format) =>
    `${format.bom ? '\uFEFF' : ''}${JSON.stringify(data, null, format.indent).split('\n').join(format.eol)}${format.final ? format.eol : ''}`;

module.exports = { stripBom, parseJson, readJson, formatOf, stringifyLike };
