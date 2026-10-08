'use strict';
// Audit 2026-10-08 (skills): how the captures write their docs and when they may run at all.
// - C9 / BLOCKER 3: two captures said both 'MERGE writes the file directly' and 'MERGE calls `set`
//   unconditionally', and `docs.js set` refuses a file that does not exist yet - so a first capture on an
//   overlay branch failed. Every capture now states one route: a first capture writes whole, a re-run goes
//   through `set`, and the engine picks the target. The engine half is exercised on a real fixture.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo } = require('./docs-fixture.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

const ROUTE_FILES = [
    'stack/skills/capture-project-capabilities/references/doc-shape.md',
    'stack/skills/capture-code-style/references/doc-shape.md',
    'stack/skills/capture-related-projects/references/artifact-shapes.md',
];

test('C9: every capture states one docs-engine write route - whole on a first capture, `set` on a re-run', () => {
    for (const rel of ROUTE_FILES)
    {
        const text = squash(read(rel));
        assert.ok(text.includes('`docs.js set` refuses a file that does not exist yet'), `${rel}: a first capture writes the file whole`);
        assert.ok(text.includes('on mainline, without git or under git versioning, and into this branch\'s overlay otherwise - the capture never decides which'),
            `${rel}: the engine picks the target`);
        assert.ok(text.includes('also edit the top `Captured:` line to this run\'s'), `${rel}: an in-place re-run keeps the doc stamp current`);
        for (const stale of ['calls `set` unconditionally', 'writes the file directly', 'directly** (Write'])
            assert.ok(!text.includes(stale), `${rel}: still carries the contradicting route '${stale}'`);
    }
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['capture-docs-engine-write-route'];
    assert.ok(entry, 'the route is registered as a shared rule');
    assert.deepStrictEqual([entry.owner.file, ...entry.sites.map((s) => s.file)].sort(), [...ROUTE_FILES].sort(), 'owner + both sites');
});

test('C9: the engine refuses `set` on a missing doc on an overlay branch, and takes it once the file exists', () => {
    const r = repo();
    try
    {
        r.write('.claude/docs/code-style/watch.json', '{}\n');
        r.git('switch', '-q', '-c', 'feature/x');
        const missing = r.cli(['set', 'CODE-STYLE#typescript'], '## TypeScript\nTwo-space indent.\n');
        assert.match(missing.stdout, /no such doc file/, 'set cannot create the first file');
        r.write('.claude/docs/code-style/CODE-STYLE.md', 'Captured: feature/x@abc1234, 2026-10-08\n\n## TypeScript\n<!-- id: typescript -->\nTwo-space indent.\n');
        const rerun = r.cli(['set', 'CODE-STYLE#typescript'], '## TypeScript\nFour-space indent.\n');
        assert.doesNotMatch(rerun.stdout, /no such doc file|error/i, `a re-run's set lands: ${rerun.stdout}${rerun.stderr}`);
        assert.match(r.cli(['show', 'CODE-STYLE#typescript']).stdout, /Four-space indent/, 'the branch reads the re-run section');
    }
    finally { r.rm(); }
});
