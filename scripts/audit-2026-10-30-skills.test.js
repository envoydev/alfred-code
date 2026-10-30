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
