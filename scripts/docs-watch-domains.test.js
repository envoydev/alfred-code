'use strict';
// Every project-derived doc is watched (spec 2026-10-27, AC9 and AC10): the architecture assessment is written as
// sections with covers and merged into a recomputed quality/watch.json, each sibling's seam and the run book merge
// their entries through `docs.js watch-merge`, and no shipped text still calls quality/ watch-less.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

const AQ = 'stack/skills/capture-architecture-quality';
const AW = 'stack/skills/capture-awareness/references';
const SEED = `watch-merge quality --seed '{"recomputed":true,"notOwned":["CODE-ASSESSMENT.md","references/**"]}' --kinds 'weakness: ' 'strength: '`;

// A text that still calls quality/ watch-less, or no docs domain at all.
const WATCHLESS_RE = /quality\/`? carries no `?watch\.json|watch-less|quality\/`? is no docs domain|no docs domain at all|lives outside the docs-domain engine|recomputed with the doc and no docs domain|recomputed, not a domain|no domain of its own/i;

const filesUnder = (rel, keep) =>
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const p = path.posix.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (keep(p)) out.push(p);
        }
    };
    walk(rel);
    return out;
};

test('AC9: the assessment is written as sections with covers, then merged into its recomputed watch', () =>
{
    const s = squash(read(`${AQ}/references/doc-shape.md`) + '\n' + read(`${AQ}/SKILL.md`));
    assert.match(s, /## Why this doc is a recomputed domain/);
    assert.match(s, /`###` section/, 'each entry is a ### section');
    assert.match(s, /slug of the entry's title/, 'the id is the title slug');
    assert.match(s, /`-2`, `-3`/, 'the de-dup suffix');
    assert.match(s, /<!-- covers: /);
    assert.ok(s.includes('Resolved by <what changed>, <YYYY-MM-DD> - the next capture drops it.'), 'the resolved line');
    assert.ok(s.includes('` on <branch>`'), 'the resolved line names its branch off mainline');
    assert.ok(s.includes(SEED), 'the merge with the seed and the two prefixes');
    assert.match(s, /skip the merge and both checks/, 'the skew fallback');
    assert.ok(s.includes('docs.js lint quality'), 'the lint check');
    assert.ok(s.includes('docs.js watch <one located file>'), 'the watch check');
});

test('AC9: each sibling merges its own seam entry; the run book merges by its prefix and its doc', () =>
{
    const rel = read(`${AW}/related-projects.md`);
    assert.ok(rel.includes("--kind 'seam with <slug>'"), 'one --kind per sibling');
    assert.match(rel, /watch-merge awareness/);
    assert.match(rel, /<!-- covers: src\/Contracts\/OrderCreated\.cs -->/, 'the example section carries its covers');
    assert.doesNotMatch(rel, /deliberately NO `covers:`/);
    assert.doesNotMatch(rel, /No `watch` entry belongs to this doc/);

    const run = read(`${AW}/project.md`);
    assert.ok(run.includes("--kinds 'run book: ' --doc PROJECT-AWARENESS"));
    const kinds = [...run.matchAll(/"kind":\s*"([^"]*)"/g)].map((m) => m[1]);
    assert.ok(kinds.length >= 2, 'project.md carries example kinds');
    for (const k of kinds) assert.ok(k.startsWith('run book: '), `example kind '${k}' carries the run book prefix`);
});

test('AC9: the quality loop names the seat skip', () =>
{
    const s = squash(read('stack/skills/loop-architecture-quality/references/loop-mechanics.md'));
    assert.match(s, /asks no loop seat about the assessment/);
    assert.match(s, /skips[^.]*recompute/);
});

test('AC9: the code assessment is notOwned in the recomputed domain', () =>
{
    for (const f of ['stack/skills/capture-code-quality/SKILL.md', 'stack/skills/capture-code-quality/references/doc-shape.md'])
        assert.match(squash(read(f)), /recomputed domain[^.]*`notOwned`/, f);
});

test('AC9: no file under stack/, setup-plugin/, meta/ or scripts/ still calls quality/ watch-less or no docs domain', () =>
{
    const hits = [];
    const shipped = (p) => /\.(md|js|json)$/.test(p) && !/\.test\.js$/.test(p) && !p.startsWith('scripts/fixtures/') && !p.includes('/node_modules/');
    for (const dir of ['stack', 'setup-plugin', 'meta', 'scripts'])
        for (const f of filesUnder(dir, shipped))
            read(f).split('\n').forEach((line, i) => { if (WATCHLESS_RE.test(line)) hits.push(`${f}:${i + 1}`); });
    assert.deepStrictEqual(hits, []);
});

test('AC10: no capture-preferences text tells a capture to write watch entries for the personal docs', () =>
{
    const hits = [];
    for (const f of filesUnder('stack/skills/capture-preferences', (p) => /\.(md|js)$/.test(p)))
        read(f).split('\n').forEach((line, i) =>
        {
            if (/\bwatch-merge\b|\b(write|writes|add|adds|merge|merges)\b[^.\n]{0,60}\bwatch\b[^.\n]{0,20}\bentr(y|ies)\b/i.test(line))
                hits.push(`${f}:${i + 1}`);
        });
    assert.deepStrictEqual(hits, []);
});
