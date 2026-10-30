'use strict';
// The 2026-10-30 report-only audit, track T3 (the flow, capture and habit skills): each block names the finding it
// holds (skills-flows.md SKF-nn, skills-capture-habits.md SKC-nn, rules.md RU-nn), so an edit that brings the
// defect back goes red here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const skill = (name) => read(`stack/skills/${name}/SKILL.md`);
const section = (text, heading) => (text.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1] || '').split(/^## /m)[0];
const registry = () => JSON.parse(read('meta/shared-rules.json')).rules;

test('SKF-03: no skill names the alfred-architecture rule 3.5.0 removed', () =>
{
    const t = flat(skill('task-solve-cross'));
    assert.doesNotMatch(t, /alfred-architecture/, 'task-solve-cross names the removed rule');
    assert.match(t, /`alfred-awareness` points at it when the hook is off/, 'the hook-off pointer is alfred-awareness');
});

test('SKF-04: the two reviewers read their target with one registered text', () =>
{
    const code = skill('review-code');
    const security = skill('review-security');
    const target = section(code, 'Target');
    assert.ok(target.length > 1000, 'review-code has a Target section');
    assert.strictEqual(section(security, 'Target'), target, 'the Target sections are byte-identical');
    const entry = registry()['review-target-read'];
    assert.ok(entry, 'registered as review-target-read');
    const files = [entry.owner, ...entry.sites].map((c) => c.file);
    for (const f of ['stack/skills/review-code/SKILL.md', 'stack/skills/review-security/SKILL.md']) assert.ok(files.includes(f), f);
    const count = /Run inline\. First count the target from its own diff: [\s\S]*?the convention rules the changed files attach/;
    assert.strictEqual(count.exec(flat(security))[0], count.exec(flat(code))[0], 'the Dispatch count sentence is shared');
});

// The compaction re-attach keeps a skill's first 5,000 tokens; the repo pins that at 17,700 body chars
// (audit-2026-10-20-skills.test.js, task-solve's cap). A rule past it is gone after a compaction.
const body = (name) => skill(name).replace(/^---\n[\s\S]*?\n---\n/, '');
const REATTACH = 17700;
const inside = (name, marker) =>
{
    const at = flat(body(name)).indexOf(flat(marker));
    assert.ok(at > -1, `${name}: '${marker}' present`);
    assert.ok(at + flat(marker).length <= REATTACH, `${name}: '${marker}' ends at ${at + flat(marker).length}, past ${REATTACH}`);
};

test('SKF-05: the architecture loop runs its siblings\' anti-gaming sweep and reports the field', () =>
{
    const ref = 'stack/skills/loop-architecture-quality/references/anti-gaming-sweep.md';
    const entry = registry()['anti-gaming-sweep-commands'];
    assert.ok([entry.owner, ...entry.sites].some((c) => c.file === ref), 'the vendored commands are registered');
    const t = flat(skill('loop-architecture-quality'));
    assert.match(t, /round 1 also records the sweep baseline/, 'round 1 records the baseline');
    assert.match(t, /On STOP, when any fix shipped: after the final build \+ tests, Read `references\/anti-gaming-sweep\.md`/, 'the sweep runs at STOP');
    assert.match(t, /\*\*Baseline\*\*, \*\*Anti-gaming\*\*, \*\*Notes\*\*/, 'the report field');
    const mech = flat(read('stack/skills/loop-architecture-quality/references/loop-mechanics.md'));
    assert.match(mech, /Sweep baseline: <sha recorded at round 1>/, 'the RESUME BLOCK carries the baseline');
    assert.match(mech, /\*\*Anti-gaming\*\* - the sweep over the cumulative diff/, 'the field rule');
});

test('SKF-06: the loops\' consent stamp, the round cap and task-implement\'s closers sit inside the re-attach window', () =>
{
    for (const loop of ['loop-architecture-quality', 'loop-code-quality'])
    {
        inside(loop, 'APPROVED small-tier - resumed round <N>');
        inside(loop, 'Hard cap: 3 improve rounds');
        assert.match(flat(section(skill(loop), 'Execution modes')), /mode ask's answer IS the dispatch consent/, `${loop}: the consent stamp sits in Execution modes`);
    }
    inside('task-implement', '**Known ceilings.** File every deliberate simplification');
    inside('task-implement', 'a task that cannot go green honestly goes back to design as a named delta');
});

test('SKF-07: task-solve\'s Modes paragraph is in the reference read first, on every size', () =>
{
    assert.match(flat(read('stack/skills/task-solve/references/full-spec.md')), /\*\*Modes\.\*\* Mode flags right after the command/);
    assert.doesNotMatch(read('stack/skills/task-solve/references/step-mechanics.md'), /\*\*Modes\.\*\*/);
    const sites = [registry()['auto-mode-contract'].owner, ...registry()['auto-mode-contract'].sites].map((c) => c.file);
    assert.ok(sites.includes('stack/skills/task-solve/references/full-spec.md'));
});

test('SKF-08: a findings-path hand-off reads as the diagnosed bug once the heredoc carries its lines', () =>
{
    const { classify } = require('../stack/skills/task-solve/scripts/spec-check.js');
    const bare = classify('.alfred/docs/work/diagnoses/orders-sync-disposed.md');
    assert.strictEqual(bare.bug, '', 'the bare path reads bug: no (the defect)');
    assert.strictEqual(bare.sizeFloor, 'trivial');
    const shaped = classify([
        'Type: bug',
        'Observable: nightly order sync stops after the first batch; expected all batches',
        'Task 1: scope the DbContext per batch - owns src/Orders/OrderSyncJob.cs; acceptance: the sync job test covers three batches and passes',
        'Task 2: integration test for a multi-batch sync - owns tests/Orders/OrderSyncJobTests.cs; acceptance: the test fails on the old code and passes on the fix',
        '.alfred/docs/work/diagnoses/orders-sync-disposed.md',
    ].join('\n'));
    assert.match(shaped.bug, /ticket kind/, 'bug: yes');
    assert.notStrictEqual(shaped.sizeFloor, 'trivial');
    assert.match(flat(read('stack/skills/task-solve/references/full-spec.md')), /A request that is only a findings path [^.]*?put `Type: bug`, the file's `Observable:` line and each `## Tasks` card's title, owned files and acceptance criterion above the path/);
});
