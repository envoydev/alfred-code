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

// ---- Task 3: the seam rung leads the ladder, and the designer cards the seam -------------------------------------------
const RUNG = 'Before new code, stop at the first rung that holds: the app\'s own seam for the capability';
const LADDER_SITES = () => ['stack/skills/task-implement/SKILL.md', ...SEATS('implementer').map((f) => `stack/agents/${f}`)];

test('the seam rung leads the ladder in task-implement and every implementer', () =>
{
    assert.strictEqual(SEATS('implementer').length, 10);
    for (const rel of LADDER_SITES())
    {
        const text = read(rel);
        assert.ok(text.includes(RUNG), `${rel}: the ladder opens on the seam rung`);
        assert.ok(text.includes('any capability the project wraps'), `${rel}: the rung names any wrapped capability`);
        assert.ok(text.indexOf(RUNG) < text.indexOf('the stdlib, runtime or framework already does it'), `${rel}: the seam rung comes before the stdlib rung`);
    }
});

test('the rung stops on a seam outside the task', () =>
{
    for (const rel of LADDER_SITES())
    {
        const text = read(rel);
        const ladder = text.indexOf(RUNG);
        const rung = text.indexOf('The seam rung: any capability the project wraps', ladder);
        assert.ok(ladder >= 0 && rung > ladder, `${rel}: the seam rung follows the ladder sentence`);
        assert.ok(text.indexOf('`BLOCKED_CONTRACT_CHANGE`', rung) > rung, `${rel}: an interface outside the task's files is a contract change`);
    }
});

test('the designer cards the seam', () =>
{
    assert.strictEqual(SEATS('solution-designer').length, 10);
    for (const rel of ['stack/skills/task-design/SKILL.md', ...SEATS('solution-designer').map((f) => `stack/agents/${f}`)])
        assert.ok(read(rel).includes('the app\'s own seam a task\'s code must go through'), `${rel}: the card names the seam`);
});

test('fix-discipline climbs the seam rung second', () =>
{
    const steps = read('stack/skills/loop-code-quality/assets/loops-starter/fix-discipline.md').split('\n').filter((l) => /^\d\. /.test(l));
    assert.strictEqual(steps.length, 6);
    assert.ok(steps[0].startsWith('1. Does this need to exist at all?'));
    assert.ok(steps[1].startsWith('2. Does the app\'s own seam for the capability already do it?'));
    assert.ok(steps[2].startsWith('3. Does the stdlib, runtime, or a native framework feature already do it?'));
    assert.ok(steps[3].startsWith('4. Does an existing helper in this repo'));
    assert.ok(steps[4].startsWith('5. Can it be one line?'));
    assert.ok(steps[5].startsWith('6. Only then: the minimum code that works.'));
});
