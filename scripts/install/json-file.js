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

module.exports = { stripBom, parseJson, readJson };
