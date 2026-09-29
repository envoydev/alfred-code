// hidden-chars.js - characters a reader cannot see: zero-width and joiner marks, bidi marks (LRM, RLM and
// the Arabic letter mark U+061C), overrides and isolates (the Trojan Source class, CVE-2021-42574), word joiners, a byte-order mark past byte 0,
// and the Unicode tag block (U+E0000-E007F), which carries invisible text a model reads and a
// reviewer does not. ONE class, two readers: guard-ungated-commit.js scans a commit's added lines
// with it, and scripts/lint-skills.js sweeps this repo with it (lint check 32). Written as escapes
// so the file passes that sweep. Not a hook: the copy route copies it beside the hooks, the plugin
// route loads it from its own directory.
'use strict';

const HIDDEN_CHAR_RE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g;

// The joiners and the bidi marks are TEXT where a script needs them, and hidden anywhere else: a zero-width joiner
// between two emoji parts (the sequence that builds one emoji) or two non-ASCII letters, a zero-width
// non-joiner between two non-ASCII letters (Persian, Indic), and a left-to-right, right-to-left or Arabic
// letter mark beside a non-ASCII letter. Flagging them told a README emoji and a Persian word to be written as an
// escape, which Markdown and JSON prose cannot do (the 2026-09-26 hooks review). Everything else in
// the class - the bidi embeddings, overrides and isolates, the zero-width space, the word joiners,
// the tag block, a BOM past byte 0 - is hidden whatever its neighbours. A neighbour that is itself in
// the class, or ASCII (digits and # are emoji components too), never vouches for one.
const ONE_HIDDEN = new RegExp(`^(?:${HIDDEN_CHAR_RE.source})$`);
const EMOJI_PART = /^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE00-\uFE0F]$/u;
const LETTER = /^\p{L}$/u;
const qualifies = (ch, re) => Boolean(ch) && ch.codePointAt(0) > 0x7F && !ONE_HIDDEN.test(ch) && re.test(ch);
function isScriptText(ch, before, after)
{
    const letter = (c) => qualifies(c, LETTER);
    if (ch === '\u200D') return (qualifies(before, EMOJI_PART) && qualifies(after, EMOJI_PART)) || (letter(before) && letter(after));
    if (ch === '\u200C') return letter(before) && letter(after);
    if (ch === '\u200E' || ch === '\u200F' || ch === '\u061C') return letter(before) || letter(after);
    return false;
}
// The whole code point ending just before `i`, and the one starting at `i`.
function pointBefore(text, i)
{
    if (i <= 0) return '';
    const low = text.charCodeAt(i - 1);
    if (low >= 0xDC00 && low <= 0xDFFF && i >= 2)
    {
        const high = text.charCodeAt(i - 2);
        if (high >= 0xD800 && high <= 0xDBFF) return text.slice(i - 2, i);
    }
    return text[i - 1];
}
const pointAt = (text, i) => (i < text.length ? String.fromCodePoint(text.codePointAt(i)) : '');

// The hidden characters on ONE line (1-based `lineNo`), as upper-case hex code points. A BOM at the
// very start of line 1 is the file's byte-order mark, not hidden text, wherever `bomAllowed(file)`
// says so.
function hiddenInLine(text, lineNo, file, bomAllowed)
{
    const out = [];
    const line = String(text);
    for (const m of line.matchAll(HIDDEN_CHAR_RE))
    {
        if (lineNo === 1 && m.index === 0 && m[0] === '\uFEFF' && bomAllowed(file)) continue;
        if (isScriptText(m[0], pointBefore(line, m.index), pointAt(line, m.index + m[0].length))) continue;
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
