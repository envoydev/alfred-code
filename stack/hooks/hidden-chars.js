// hidden-chars.js - characters a reader cannot see: zero-width and joiner marks, bidi overrides and
// isolates (the Trojan Source class, CVE-2021-42574), word joiners, a byte-order mark past byte 0,
// and the Unicode tag block (U+E0000-E007F), which carries invisible text a model reads and a
// reviewer does not. ONE class, two readers: guard-ungated-commit.js scans a commit's added lines
// with it, and scripts/lint-skills.js sweeps this repo with it (lint check 32). Written as escapes
// so the file passes that sweep. Not a hook: the copy route copies it beside the hooks, the plugin
// route loads it from its own directory.
'use strict';

const HIDDEN_CHAR_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g;

// The hidden characters on ONE line (1-based `lineNo`), as upper-case hex code points. A BOM at the
// very start of line 1 is the file's byte-order mark, not hidden text, wherever `bomAllowed(file)`
// says so.
function hiddenInLine(text, lineNo, file, bomAllowed)
{
    const out = [];
    for (const m of String(text).matchAll(HIDDEN_CHAR_RE))
    {
        if (lineNo === 1 && m.index === 0 && m[0] === '\uFEFF' && bomAllowed(file)) continue;
        out.push(m[0].codePointAt(0).toString(16).toUpperCase());
    }
    return out;
}

// A whole file. The lint's default keeps a byte-0 BOM only in a .ps1: Windows PowerShell 5.1 reads a
// BOM-less script as the ANSI code page.
function hiddenChars(text, file, bomAllowed = (f) => /\.ps1$/i.test(f))
{
    const out = [];
    String(text).split('\n').forEach((l, i) =>
    {
        for (const hex of hiddenInLine(l, i + 1, file, bomAllowed)) out.push({ line: i + 1, hex });
    });
    return out;
}

module.exports = { HIDDEN_CHAR_RE, hiddenInLine, hiddenChars };
