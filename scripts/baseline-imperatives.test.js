// The pilot-3 trim cut each always-on rule clause to its imperative and a one-line reason. Review A (M6) found five
// cuts that took an instruction with the story - each is pinned here in its own home, so a later trim keeps it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const squash = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('the always-on rules keep the imperatives the pilot-3 trim dropped', () =>
{
    const kept = [
        ['stack/rules/alfred-navigation.md', 'never the same read in another shape or against a second path'],
        ['stack/rules/alfred-navigation.md', 'resolves its tool absolutely or checks it with `type` first'],
        ['stack/rules/alfred-interaction.md', 'Push-back without new facts: restate the objection'],
        ['stack/rules/alfred-security.md', 'compare char counts, or have the user compare'],
    ];
    for (const [rel, phrase] of kept) assert.ok(squash(rel).includes(phrase), `${rel}: '${phrase}'`);
});

test('the stamped usage policy keeps the slash-only imperative, and the evidence doc no longer holds it', () =>
{
    const skill = squash('stack/skills/alfred-capture-agent-capabilities/SKILL.md');
    const policy = skill.slice(skill.indexOf('<!-- policy-rev:'), skill.indexOf('## Orchestration skills (slash-only - invisible until invoked) <the script'));
    assert.ok(policy.includes('never spend the turn explaining that you cannot'), 'the policy block carries it');
    assert.ok(!squash('docs/baseline-rules-evidence.md').includes('never spend the turn explaining that you cannot'), 'an imperative is not a story');
});
