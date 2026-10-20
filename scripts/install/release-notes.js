#!/usr/bin/env node
'use strict';
// The release notes an update owes THIS install: the sections of setup-plugin/references/update-history.md for the
// releases between the stamp's version and now, never the whole file. The notes rode every update's command body
// whole (~12k of the 72.5k-char body), for every install, on every message of the run - an install already past a
// release carried that release's rename story anyway (audit 2026-10-20 C15, e31af926 / a72fdfbc).
//
// A section heading names the release it belongs to:
//   `## in <version> - <title>`     owed when the stamp's version is BELOW <version>
//   `## after <version> - <title>`  owed when the stamp's version is AT or below <version> (the next release carries it)
//   `## table - <title>`            printed only with --table (a reference the installer's `renamed:` lines already cover)
// A stamp with no version (a legacy install, a garbled line) owes every dated section.
//
//   node scripts/install/release-notes.js [--file <update-history.md>] (--root <project> | --since <version>) [--table]
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'setup-plugin', 'references', 'update-history.md');
const HEADING = /^## (in|after|table)\b(?:\s+(\d+\.\d+\.\d+))?/;

// -1, 0 or 1 over the numeric triple; a missing or malformed version reads as the oldest.
function compareVersions(a, b)
{
    const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim()) || []).slice(1).map(Number);
    const x = parse(a), y = parse(b);
    if (!x.length && !y.length) return 0;
    if (!x.length) return -1;
    if (!y.length) return 1;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}

// The file's `## ` sections, each { kind, version, text } - the text runs from its heading to the next.
function sectionsOf(markdown)
{
    const out = [];
    let cur = null;
    for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n'))
    {
        const h = /^## /.test(line) ? HEADING.exec(line) : null;
        if (/^## /.test(line)) { cur = h ? { kind: h[1], version: h[2] || null, lines: [line] } : null; if (cur) out.push(cur); continue; }
        if (cur) cur.lines.push(line);
    }
    return out.map(({ lines, ...s }) => ({ ...s, text: lines.join('\n').trimEnd() }));
}

// The sections owed since `since` (a version string, or empty for an install that recorded none).
function owed(sections, since, { table = false } = {})
{
    const known = /^\d+\.\d+\.\d+/.test(String(since || '').trim());
    return sections.filter((s) =>
    {
        if (s.kind === 'table') return table;
        if (!s.version) return false;
        if (!known) return true;
        const c = compareVersions(since, s.version);
        return s.kind === 'in' ? c < 0 : c <= 0;
    });
}

function main(argv)
{
    const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
    const file = arg('--file') || DEFAULT_FILE;
    let since = arg('--since');
    if (since === null && arg('--root') !== null)
    {
        const stamp = require('./stamp.js');
        const { read } = stamp.stampFiles({ projectRoot: path.resolve(arg('--root')) });
        since = read ? stamp.readVersion(read) : '';
    }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { console.log(`release notes: unreadable (${e.code || e.message}) - nothing printed`); return 0; }
    const list = owed(sectionsOf(text), since, { table: argv.includes('--table') });
    const from = since ? since : 'no recorded version';
    if (!list.length) { console.log(`release notes: none owed since ${from}`); return 0; }
    console.log(`release notes since ${from}: ${list.length} section(s)`);
    for (const s of list) console.log(`\n${s.text}`);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { compareVersions, sectionsOf, owed, main };
