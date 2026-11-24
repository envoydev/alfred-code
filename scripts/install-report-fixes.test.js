'use strict';
// The run report tells the truth about what a user acts on (the final review of layered native rules): a skill the run
// re-points from the child's own copy to the root's store is updated, not removed; the 'new session needed' line comes
// only when the run changed a rule or an agent.
const test = require('node:test');
const assert = require('node:assert');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { TOP, CHILD, join, demote, runSteps } = require('./child-world-fixture.js');
const { NEW_SESSION_LINE } = require('./install/report-constants.js');

const SEL = 'skill markdown-style\nskill javascript\nrule alfred-security\nagent evidence-gatherer\n';
const REPORT = /^==> report: \.: added (\d+)(?: \((.*?)\))?, updated (\d+)(?: \((.*?)\))?, removed (\d+)(?: \((.*?)\))?, kept, yours (\d+)/m;
const reportOf = (out) =>
{
    const m = REPORT.exec(out);
    assert.ok(m, `a report line:\n${out}`);
    return { added: +m[1], addedNames: m[2] || '', updated: +m[3], updatedNames: m[4] || '', removed: +m[5], removedNames: m[6] || '' };
};

test('a joined child whose own skill links move to the root\'s store reports them updated, never removed', POSIX_ONLY, () =>
{
    const { outs } = runSteps([
        { at: TOP, act: 'install', sel: SEL },
        { at: CHILD, act: 'install', sel: SEL, after: join },
        { at: CHILD, act: 'update', sel: SEL },
    ]);
    const report = reportOf(outs[2]);
    assert.doesNotMatch(report.removedNames, /skill /, `no skill is removed - every one stays linked, to the root's store:\n${outs[2]}`);
    assert.ok(report.updated >= 2, `the re-pointed skills are updated (markdown-style, javascript at least): updated ${report.updated}`);
    assert.strictEqual(report.added, 0, 'and none is added');
});

test('a demoted child whose skill links move back to its own store reports them updated, never added', POSIX_ONLY, () =>
{
    const { outs } = runSteps([
        { at: TOP, act: 'install', sel: SEL, after: join },
        { at: CHILD, act: 'install', sel: SEL },
        { at: CHILD, act: 'update', sel: SEL, before: demote },
    ]);
    const report = reportOf(outs[2]);
    assert.doesNotMatch(report.addedNames, /skill /, `no skill is added - each was linked before:\n${outs[2]}`);
    assert.ok(report.updated >= 2, `the re-pointed skills are updated: ${REPORT.exec(outs[2])[0].slice(0, 300)}`);
});

test('a second identical update prints no new-session line, and a first update that changed rules still does', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update', 'update'], SEL, {});
    assert.doesNotMatch(outs[2], new RegExp(NEW_SESSION_LINE.replace(/[()/]/g, '\\$&')), `no change, no line:\n${outs[2]}`);
    assert.match(outs[0], /new session needed/, 'the first run printed it');
});
