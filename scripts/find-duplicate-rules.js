#!/usr/bin/env node
'use strict';
// THE UNDELIBERATE-DUPLICATION SCAN - advisory, run by hand before a release, never in lint or CI.
//
// meta/shared-rules.json pins every rule that lives in more than one home ON PURPOSE, and lint check 24
// keeps those copies in sync. Nothing catches the other kind: a sentence restated in a second rule or
// skill body by someone who never looked for the first, which then drifts on its own. This compares
// every sentence of the rules (stack/rules/*.md) and the skill bodies (stack/skills/*/SKILL.md, the
// frontmatter and fenced code left out) against every sentence of every OTHER file, by overlap of
// five-word shingles, and prints the pairs at or over the threshold that no pin already covers.
//
// A pin covers a pair when both sentences sit in the block (a bullet, a numbered step or a paragraph)
// holding that pin's marker in their files - the unit a marker pins. Each finding is one cluster of
// sentences joined by an unpinned match: every home, the sentence that matched there, the best score.
// The call on a finding is a person's: pin a deliberate copy in meta/shared-rules.json, fold an
// accidental one into one home.
//
//   node scripts/find-duplicate-rules.js [--threshold 0.5] [--min-words 8] [--limit 50] [--root <repo>]
const fs = require('node:fs');
const path = require('node:path');

const SHINGLE = 5;
const DEFAULTS = { threshold: 0.5, minWords: 8 };
// A shingle shared by this many sentences is boilerplate (a stock phrase), not a restated rule -
// skipping it keeps the pair count linear in practice.
const COMMON = 40;

const squash = (s) => s.replace(/\s+/g, ' ');

// The file cut into blocks, each with the line it starts on. Frontmatter and fenced code are skipped;
// a bullet, a numbered step, a heading and a table row each open a block of their own, a blank line
// closes one, and a wrapped line continues it.
function blocksOf(text)
{
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let i = 0;
    if (/^---\s*$/.test(lines[0] || ''))
    {
        const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
        if (end > 0) i = end + 1;
    }
    let cur = null;
    let fence = null;
    const close = () => { if (cur) blocks.push(cur); cur = null; };
    for (; i < lines.length; i += 1)
    {
        const line = lines[i];
        const f = /^\s*(```|~~~)/.exec(line);
        if (fence) { if (f && f[1] === fence) fence = null; continue; }
        if (f) { close(); fence = f[1]; continue; }
        if (!line.trim()) { close(); continue; }
        if (/^\s*([-*+]\s|\d+\.\s|#{1,6}\s|\|)/.test(line) || !cur) { close(); cur = { line: i + 1, text: line.trim() }; }
        else cur.text += ` ${line.trim()}`;
        if (/^\s*(#{1,6}\s|\|)/.test(line)) close();
    }
    close();
    return blocks;
}

// A block's sentences - split after . ! or ? when the next word opens a new sentence, never after 'e.g.' or 'i.e.'.
function sentencesOf(block)
{
    const body = block.text.replace(/^([-*+]|\d+\.)\s+/, '');
    return body.split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e)\.)\s+(?=[A-Z`'*(_[])/).map((s) => s.trim()).filter(Boolean);
}

const wordsOf = (sentence) => sentence.toLowerCase().replace(/[^a-z0-9<>'\s-]/g, ' ').split(/\s+/).filter(Boolean);

function shinglesOf(words)
{
    const out = new Set();
    for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(' '));
    return out;
}

// `${file}\0${blockIndex}` -> the pin names whose marker sits in that block.
function pinnedBlocks(registry, blocksByFile)
{
    const pins = new Map();
    for (const [name, rule] of Object.entries((registry && registry.rules) || {}))
    {
        for (const copy of [rule.owner, ...(rule.sites || [])].filter(Boolean))
        {
            const blocks = blocksByFile.get(copy.file);
            if (!blocks || typeof copy.marker !== 'string' || !copy.marker.trim()) continue;
            const marker = squash(copy.marker.trim());
            blocks.forEach((b, k) =>
            {
                if (!squash(b.text).includes(marker)) return;
                const key = `${copy.file}\0${k}`;
                if (!pins.has(key)) pins.set(key, new Set());
                pins.get(key).add(name);
            });
        }
    }
    return pins;
}

// files: [{ path, text }] with repo-relative paths; registry: the parsed meta/shared-rules.json.
// Returns one finding per cluster, best score first: { score, pairs, homes }, each home
// { file, line, text } - the block's line and its best-matching sentence.
function findDuplicates({ files, registry, threshold = DEFAULTS.threshold, minWords = DEFAULTS.minWords })
{
    const blocksByFile = new Map(files.map((f) => [f.path, blocksOf(f.text)]));
    const pins = pinnedBlocks(registry, blocksByFile);

    const sentences = [];
    for (const [file, blocks] of blocksByFile)
        blocks.forEach((block, k) =>
        {
            for (const text of sentencesOf(block))
            {
                const words = wordsOf(text);
                if (words.length < minWords) continue;
                sentences.push({ file, block: k, line: block.line, text, shingles: shinglesOf(words) });
            }
        });

    const index = new Map();
    sentences.forEach((s, id) => { for (const sh of s.shingles) { if (!index.has(sh)) index.set(sh, []); index.get(sh).push(id); } });
    const shared = new Map();
    for (const ids of index.values())
    {
        if (ids.length < 2 || ids.length > COMMON) continue;
        for (let x = 0; x < ids.length; x += 1)
            for (let y = x + 1; y < ids.length; y += 1)
            {
                if (sentences[ids[x]].file === sentences[ids[y]].file) continue;
                const key = `${ids[x]}:${ids[y]}`;
                shared.set(key, (shared.get(key) || 0) + 1);
            }
    }

    // Sentences joined by an unpinned match form one cluster - a sentence restated in five skills is
    // one finding with five homes, not ten pairs. Clusters are built per SENTENCE, so two unrelated
    // sentences sharing a paragraph never chain; clusters landing in the same set of blocks (a
    // paragraph copied whole) then merge back into one finding.
    const parent = sentences.map((_, id) => id);
    const root = (k) => { while (parent[k] !== k) k = parent[k]; return k; };
    const edges = [];
    for (const [key, n] of shared)
    {
        const [x, y] = key.split(':').map(Number);
        const [a, b] = [sentences[x], sentences[y]];
        const score = n / (a.shingles.size + b.shingles.size - n);
        if (score < threshold) continue;
        const pinsA = pins.get(`${a.file}\0${a.block}`);
        const pinsB = pins.get(`${b.file}\0${b.block}`);
        if (pinsA && pinsB && [...pinsA].some((name) => pinsB.has(name))) continue;
        edges.push({ x, y, score });
        parent[root(x)] = root(y);
    }

    const clusters = new Map();
    for (const { x, y, score } of edges)
    {
        const id = root(x);
        if (!clusters.has(id)) clusters.set(id, { score: 0, pairs: 0, members: new Map() });
        const c = clusters.get(id);
        c.pairs += 1;
        c.score = Math.max(c.score, score);
        for (const m of [x, y]) c.members.set(m, Math.max(c.members.get(m) || 0, score));
    }

    const findings = new Map();
    for (const c of clusters.values())
    {
        const homes = new Map();
        for (const [m, score] of c.members)
        {
            const s = sentences[m];
            const k = `${s.file}\0${s.block}`;
            const have = homes.get(k);
            if (!have || score > have.score) homes.set(k, { file: s.file, line: s.line, text: s.text, score });
        }
        const blockSet = [...homes.keys()].sort().join('\n');
        const have = findings.get(blockSet);
        if (!have) findings.set(blockSet, { score: c.score, pairs: c.pairs, homes });
        else
        {
            have.pairs += c.pairs;
            if (c.score > have.score) Object.assign(have, { score: c.score, homes });
        }
    }
    return [...findings.values()]
        .map((f) => ({
            score: f.score,
            pairs: f.pairs,
            homes: [...f.homes.values()].map(({ file, line, text }) => ({ file, line, text }))
                .sort((p, q) => p.file.localeCompare(q.file) || p.line - q.line),
        }))
        .sort((p, q) => q.score - p.score || q.homes.length - p.homes.length || p.homes[0].file.localeCompare(q.homes[0].file));
}

// The corpus: every rule and every skill body under a repo root, as repo-relative forward-slash paths
// (the spelling meta/shared-rules.json uses).
function readCorpus(root)
{
    const files = [];
    const rulesDir = path.join(root, 'stack', 'rules');
    for (const name of fs.existsSync(rulesDir) ? fs.readdirSync(rulesDir).sort() : [])
        if (name.endsWith('.md')) files.push(`stack/rules/${name}`);
    const skillsDir = path.join(root, 'stack', 'skills');
    for (const name of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).sort() : [])
        if (fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) files.push(`stack/skills/${name}/SKILL.md`);
    return files.map((rel) => ({ path: rel, text: fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8') }));
}

function main(argv)
{
    const opt = { ...DEFAULTS, limit: 50, root: path.join(__dirname, '..') };
    for (let i = 0; i < argv.length; i += 1)
    {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--threshold') opt.threshold = Number(value);
        else if (flag === '--min-words') opt.minWords = Number(value);
        else if (flag === '--limit') opt.limit = Number(value);
        else if (flag === '--root') opt.root = path.resolve(value);
        else { process.stderr.write(`find-duplicate-rules: unknown flag ${flag}\n`); return 2; }
        i += 1;
    }
    if (!(opt.threshold > 0 && opt.threshold <= 1) || !(opt.minWords >= SHINGLE) || !(opt.limit > 0))
    {
        process.stderr.write(`find-duplicate-rules: --threshold takes (0, 1], --min-words at least ${SHINGLE}, --limit at least 1\n`);
        return 2;
    }
    const files = readCorpus(opt.root);
    const registry = JSON.parse(fs.readFileSync(path.join(opt.root, 'meta', 'shared-rules.json'), 'utf8'));
    const found = findDuplicates({ files, registry, threshold: opt.threshold, minWords: opt.minWords });
    const cut = (s) => (s.length > 160 ? `${s.slice(0, 157)}...` : s);
    const lines = [`find-duplicate-rules: ${found.length} unpinned cluster(s) at >= ${opt.threshold} across ${files.length} file(s) - advisory: pin a deliberate copy in meta/shared-rules.json, fold an accidental one into one home`];
    for (const f of found.slice(0, opt.limit))
    {
        lines.push('', `${f.score.toFixed(2)}  ${f.homes.length} homes, ${f.pairs} matching sentence pair(s)`);
        // One shared wording prints once; differing wordings print beside each home.
        const same = f.homes.every((h) => h.text === f.homes[0].text);
        for (const h of f.homes) lines.push(`      ${h.file}:${h.line}${same ? '' : `  ${cut(h.text)}`}`);
        if (same) lines.push(`      text: ${cut(f.homes[0].text)}`);
    }
    if (found.length > opt.limit) lines.push('', `... ${found.length - opt.limit} more - raise --limit to see them`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
}

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { findDuplicates, blocksOf, sentencesOf, readCorpus };
