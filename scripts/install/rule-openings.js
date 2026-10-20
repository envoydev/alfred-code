'use strict';
// A stack RULE's identity across releases - the rule twin of skill-headings.js. A rule has no frontmatter heading, so
// its identity is its OPENING: the first non-blank line after any frontmatter (what `ruleOpening` in alfred-code.js
// reads). `meta/rule-openings.json` holds, per rule the stack ships, a hash of every opening it has shipped under that
// file name - every state of `stack/rules/<name>.md` and the older `rules/` and `claude/rules/` layouts in git history,
// plus the working tree's. Append-only within a name, so a shallow clone never drops history it cannot see.
//
// M3 claims a same-named rule copy the stamp does not record when its opening is the stack's. Checking the CURRENT
// opening alone missed every copy made before the stamp recorded rules: markdown-docs.md has shipped seven openings and
// devops-conventions.md six, so an older copy read as the project's own, was never refreshed, and the report told the
// user to rename or remove it (audit 2026-10-20 C23, a72fdfbc, b1c22192, e43969a7, 24841a36).
//
//   node scripts/install/rule-openings.js [--root <repo>]      writes meta/rule-openings.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = path.join('meta', 'rule-openings.json');
const RULE_PATH = /^(?:stack\/|claude\/)?rules\/([^/]+)\.md$/;
const ZERO = /^0+$/;

// The first non-blank line after any frontmatter, trailing blanks dropped; null when there is none.
function openingOf(text)
{
    const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const line = body.split(/\r?\n/).find((l) => l.trim());
    return line ? line.trimEnd() : null;
}

const openingHash = (opening) => crypto.createHash('sha256').update(opening).digest('hex').slice(0, 16);

// name -> Set of past opening hashes from the source's shipped file; an empty map when it is absent or unreadable (an
// older source: the current-opening test still runs).
function pastOpenings(sourceDir)
{
    try
    {
        const data = JSON.parse(fs.readFileSync(path.join(sourceDir, FILE), 'utf8'));
        return new Map(Object.entries(data.rules || {}).map(([name, list]) => [name, new Set(list)]));
    }
    catch { return new Map(); }
}

// True when `text` opens the way the stack's rule `name` opens now (`current`) or once did (the shipped file).
function stackOpening(name, text, current, past)
{
    const theirs = text == null ? null : openingOf(text);
    if (!theirs) return false;
    if (current != null && theirs === openingOf(current)) return true;
    const list = past.get(name);
    return Boolean(list && list.has(openingHash(theirs)));
}

function collect(root)
{
    const rt = require('./runtime.js');   // every external command through the one Windows-safe spawn (M6)
    const out = new Map();
    const add = (name, text) =>
    {
        const opening = openingOf(text);
        if (!opening) return;
        if (!out.has(name)) out.set(name, new Set());
        out.get(name).add(openingHash(opening));
    };
    const blobs = new Map();
    let raw = '';
    try
    {
        raw = rt.execCommand('git', ['-C', root, 'log', '--all', '--format=', '--raw', '--no-abbrev', '--no-renames', '--', 'stack/rules/*.md', 'rules/*.md', 'claude/rules/*.md'],
            { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch { raw = ''; }   // not a git checkout: the working tree's openings alone
    for (const line of raw.split('\n'))
    {
        const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) [A-Z]\d*\t(.+)$/.exec(line);
        const p = m && RULE_PATH.exec(m[3]);
        if (!p) continue;
        for (const blob of [m[1], m[2]]) if (!ZERO.test(blob)) blobs.set(blob, p[1]);
    }
    if (blobs.size)
    {
        // One cat-file process for every blob: `<sha> blob <size>\n<content>\n` per entry.
        const ids = [...blobs.keys()];
        const buf = rt.execCommand('git', ['-C', root, 'cat-file', '--batch'], { input: ids.join('\n') + '\n', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
        let at = 0;
        for (const id of ids)
        {
            const nl = buf.indexOf(0x0a, at);
            const head = buf.subarray(at, nl).toString('utf8').split(' ');
            const size = Number(head[2]);
            if (head[1] !== 'blob' || !Number.isFinite(size)) { at = nl + 1; continue; }
            add(blobs.get(id), buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
            at = nl + 1 + size + 1;
        }
    }
    // Only names the stack ships now: a renamed or retired name is the rename and prune paths' (retired-rules.js).
    const dir = path.join(root, 'stack', 'rules');
    const shipped = new Set();
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    {
        if (!file.endsWith('.md')) continue;
        const name = file.slice(0, -3);
        shipped.add(name);
        add(name, fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    for (const name of [...out.keys()]) if (!shipped.has(name)) out.delete(name);
    return out;
}

function write(root)
{
    const file = path.join(root, FILE);
    let prior = {};
    try { prior = JSON.parse(fs.readFileSync(file, 'utf8')).rules || {}; } catch { prior = {}; }
    const found = collect(root);
    for (const [name, list] of Object.entries(prior))
    {
        if (!found.has(name)) continue;   // no longer shipped
        for (const h of list) found.get(name).add(h);
    }
    const rules = Object.fromEntries([...found.keys()].sort().map((name) => [name, [...found.get(name)].sort()]));
    const data = {
        about: 'GENERATED by scripts/install/rule-openings.js - never edit by hand. Per rule the stack ships, the first 16 hex of sha256 over the opening line (the first non-blank line after any frontmatter, trailing blanks dropped) of every text the stack has shipped under that file name. The installer claims a same-named rule copy the stamp does not record when its opening hashes to one of these (M3); scripts/rule-openings.test.js fails when a current opening is missing.',
        rules,
    };
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const changed = !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text;
    if (changed) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
    return { file, changed, names: Object.keys(rules).length, hashes: Object.values(rules).reduce((n, l) => n + l.length, 0) };
}

if (require.main === module)
{
    const i = process.argv.indexOf('--root');
    const root = path.resolve(i === -1 ? path.join(__dirname, '..', '..') : process.argv[i + 1]);
    const r = write(root);
    console.log(`${r.changed ? 'wrote' : 'unchanged'} ${path.relative(root, r.file)} - ${r.names} rule names, ${r.hashes} openings`);
}

module.exports = { FILE, openingOf, openingHash, pastOpenings, stackOpening, collect, write };
