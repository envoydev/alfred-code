'use strict';
// The plan card's estimate line (2026-10-27): the session-inspector mod reads it as `estimateMin` and forecasts the
// plan's time left from the finished cards' actual-to-estimate ratio, so the line's unit, its presence on every card
// and its freeze once a card starts are the contract, and a collapse that dropped it would empty the ratio.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const SKILL = 'stack/skills/habits-plan-writing/SKILL.md';

test('both card shapes end with the estimate line', () =>
{
    const pw = read(SKILL);
    const code = (/### Task 1 - <what the slice does, one line>\n\n([\s\S]*?)\n\n## Decisions/.exec(pw) || [])[1] || '';
    const docs = (/A documentation plan[\s\S]*?```text\n([\s\S]*?)```/.exec(pw) || [])[1] || '';
    for (const card of [code, docs])
    {
        const fields = [...card.matchAll(/^- (\w+):/gm)].map((m) => m[1]);
        assert.strictEqual(fields[fields.length - 1], 'estimate');
        assert.match(card, /^- estimate: <N>m$/m);
    }
});

test('the estimate is working minutes, on every card or none, and frozen once the card starts', () =>
{
    const pw = flat(read(SKILL));
    assert.match(pw, /`estimate:` is the working minutes the slice takes the agent that builds it, not wall-clock time/);
    assert.match(pw, /Time spent waiting \(a CI run, a deploy, an answer\) is not counted\. One whole number in steps of 5, never a range\./);
    assert.match(pw, /a plan that carries any carries one on every card/);
    assert.match(pw, /rewritten in the same edit that changes its scope \(`files`, `test`, `acceptance`\) or adds or splits it, and only while the card is `TODO`/);
    assert.match(pw, /From `IN_PROGRESS` on it is frozen/);
    assert.match(pw, /scope found mid-build becomes a new card with its own estimate/);
});

test('a collapsed DONE card keeps its estimate', () =>
{
    assert.match(flat(read(SKILL)), /collapses to its title, its status line, its `estimate:` line and one evidence pointer/);
});
