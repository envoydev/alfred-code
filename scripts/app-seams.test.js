'use strict';
// The app's own seams first (the user's ruling of 2026-10-27: a stated case such as 'use IDateTimeService, not new
// DateTime' binds as its general rule). The capture lifts a case to its rule or asks, the ladder starts at the app's own
// seam, the review reports a bypassed one, and every quoter of the preferences check judges the entries it cannot grep.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SEATS = (suffix) => fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => f.endsWith(`-${suffix}.md`));
// The text between a `### ` heading that starts with `title` and the next `### ` heading.
const section = (text, title) =>
{
    const start = text.indexOf(`### ${title}`);
    assert.ok(start >= 0, `no ### ${title}`);
    const end = text.indexOf('\n### ', start + 4);
    return text.slice(start, end < 0 ? undefined : end);
};

const CAPTURE = 'stack/skills/capture-preferences/SKILL.md';

test('the check section names the by-hand line', () =>
{
    assert.ok(read(CAPTURE).includes('judge every id a `by hand:` line names'));
});

test('NORMALIZE lifts a case to its rule', () =>
{
    const normalize = section(read(CAPTURE), '2. NORMALIZE');
    assert.ok(normalize.includes('the general rule behind it'), 'the Rule: is the general rule');
    assert.ok(normalize.includes('`- Example:`'), 'the case goes on an Example: line');
    const asks = [...normalize.matchAll(/```ask\n([\s\S]*?)```/g)].map((m) => m[1].split('\n').filter((l) => /^- '/.test(l)));
    assert.ok(asks.some((options) => options[0] && options[0].startsWith('- \'Every case like it (Recommended)\'')), 'the ask recommends the general rule, first');
    assert.ok(normalize.includes('Under auto-run this ask goes out with no `(Recommended)` mark'), 'auto-run leaves the ask for the user');
    assert.ok(read('stack/skills/capture-preferences/references/doc-shape.md').includes('`Example:`'), 'the doc shape lists the line');
});
