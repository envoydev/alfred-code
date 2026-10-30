'use strict';
// Audit 2026-10-30, Tier 4 candidates: each test pins one A/B-only candidate's text. The A/B that decides whether it
// helps runs later; a red A/B reverts that id's commit alone, together with its test here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const description = (skill) =>
{
    const m = /^description: "(.*)"$/m.exec(read('stack', 'skills', skill, 'SKILL.md'));
    assert.ok(m, `${skill} has a one-line quoted description`);
    return m[1];
};

test('RU-09: all ten FIRST-action rules carry the compaction clause once, pinned beside the receipt; csharp keeps no own copy', () =>
{
    const squash = (s) => s.replace(/\s+/g, ' ');
    const CLAUSE = 'the receipt is what makes the load happen. A compaction ends the already-in-context skip - a loaded skill outlives one only within a shared budget.';
    const pins = JSON.parse(read('meta', 'shared-rules.json')).rules;
    const homes = (pin) => [pin.owner, ...pin.sites];
    const files = homes(pins['convention-rule-first-action']).map((h) => h.file).sort();
    assert.strictEqual(files.length, 10);
    assert.deepStrictEqual(homes(pins['convention-rule-load-receipt']).map((h) => h.file).sort(), files);
    for (const h of homes(pins['convention-rule-load-receipt']))
        assert.ok(CLAUSE.startsWith(h.marker) && h.marker.includes('A compaction ends the already-in-context skip'), `${h.file}: the pinned marker carries the clause`);
    for (const f of files)
    {
        const text = squash(read(f));
        assert.ok(text.includes(CLAUSE), `${f} carries the clause`);
        assert.strictEqual(text.split('A compaction ends the already-in-context skip').length, 2, `${f} carries it once`);
    }
    const cs = squash(read('stack', 'rules', 'csharp-conventions.md'));
    assert.ok(!cs.includes('the exemption ends at the next compaction'), 'csharp drops its own longer copy');
    assert.ok(cs.includes('Skip the load only when it is already in context this session'), 'the skip itself stays');
});
