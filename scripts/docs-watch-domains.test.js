'use strict';
// Every project-derived doc is watched (spec 2026-10-27, AC9 and AC10): the architecture assessment is written as
// sections with covers and merged into a recomputed quality/watch.json, each sibling's seam and the run book merge
// their entries through `docs.js watch-merge`, and no shipped text still calls quality/ watch-less.
const test = require('node:test');

require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // AC18 spawns the docs hook
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, section } = require('./docs-fixture');

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

// AC18: the capture's own steps, with no model - a hand-built assessment in the D3 shape, its entries merged through
// watch-merge from no quality/watch.json, the two checks the capture runs, and the close ask a change then brings. A
// durable architecture/ domain sits beside it: a docs root whose only domain is recomputed runs no docs hook (spec D4).
test('AC18: a hand-built assessment passes the capture\'s checks', () =>
{
    const r = repo({ tracked: true, files: { 'src/Invoicing/InvoiceBuilder.cs': 'class InvoiceBuilder {}\n', 'src/Orders/Order.cs': 'class Order {}\n', 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/boot.md': section('entry', 'src/Api/Program.cs', 'Program.cs wires every module.'), 'watch.json': JSON.stringify({ watch: [{ kind: 'root', globs: ['src/Api/Program.cs'], sections: ['boot#entry'] }] }) } });
    const Q = '.claude/docs/quality';
    const doc = [
        '# Architecture assessment', '',
        '## Strengths', '<!-- id: strengths -->', '',
        '### S1 - Orders owns its persistence behind one module', '<!-- id: orders-owns-its-persistence-behind-one-module -->',
        '<!-- covers: src/Orders/** -->', 'Orders keeps its tables behind its own module.', '',
        '## Must-fix', '<!-- id: must-fix -->', '',
        '### W1 - Invoicing queries Orders\' persistence entities across the module boundary',
        '<!-- id: invoicing-queries-orders-persistence-entities-across-the-module-boundary -->',
        '<!-- covers: src/Invoicing/InvoiceBuilder.cs, src/Orders/Order.cs -->',
        'InvoiceBuilder reads Order directly. located: Invoicing/InvoiceBuilder -> Orders.Order', '',
        '## Summary', '<!-- id: summary -->', '1 strength, 1 must-fix.', '',
    ].join('\n');
    const W1 = 'ARCHITECTURE-ASSESSMENT#invoicing-queries-orders-persistence-entities-across-the-module-boundary';
    const S1 = 'ARCHITECTURE-ASSESSMENT#orders-owns-its-persistence-behind-one-module';
    const entries = [
        { kind: 'weakness: invoicing reads orders entities', globs: ['src/Invoicing/InvoiceBuilder.cs', 'src/Orders/Order.cs'], sections: [W1] },
        { kind: 'strength: orders owns its persistence', globs: ['src/Orders/**'], sections: [S1] },
    ];
    try
    {
        assert.ok(!r.exists(`${Q}/watch.json`), 'the run starts from no quality/watch.json');
        r.write(`${Q}/ARCHITECTURE-ASSESSMENT.md`, doc);
        const seed = '{"recomputed":true,"notOwned":["CODE-ASSESSMENT.md","references/**"]}';
        const merged = r.cli(['watch-merge', 'quality', '--seed', seed, '--kinds', 'weakness: ', 'strength: '], JSON.stringify(entries));
        assert.strictEqual(merged.status, 0, merged.stdout + merged.stderr);
        assert.match(merged.stdout, /^watch-merge quality: kept 0, replaced 0 with 2$/m);
        const watch = JSON.parse(r.read(`${Q}/watch.json`));
        assert.strictEqual(watch.recomputed, true);
        assert.deepStrictEqual(watch.notOwned, ['CODE-ASSESSMENT.md', 'references/**']);

        const lint = r.cli(['lint', 'quality']);
        assert.match(lint.stdout, /^0 problems, /m, lint.stdout);
        const hit = r.cli(['watch', 'src/Invoicing/InvoiceBuilder.cs']);
        assert.ok(hit.stdout.includes(`weakness: invoicing reads orders entities: src/Invoicing/InvoiceBuilder.cs -> ${W1}`), hit.stdout);

        r.git('add', '-A'); r.git('commit', '-qm', 'capture');
        const s = `ac18-${process.pid}`;
        r.hook({ hook_event_name: 'SessionStart', session_id: s });
        r.hook({ hook_event_name: 'PreToolUse', session_id: s, tool_name: 'Bash', tool_input: { command: 'npm run generate' } });
        r.write('src/Invoicing/InvoiceBuilder.cs', 'class InvoiceBuilder { int total; }\n');
        const out = r.hook({ hook_event_name: 'Stop', session_id: s, stop_hook_active: false });
        const reason = out.stdout ? JSON.parse(out.stdout).reason : '';
        assert.deepStrictEqual([...reason.matchAll(/ set (\S+) --expect/g)].map((m) => m[1]), [W1], reason);
    }
    finally { r.rm(); }
});
