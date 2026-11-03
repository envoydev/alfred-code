'use strict';
// The usage audit of 2026-11-03 (21 sessions on 2.9.0, two consuming projects) - the flow skills' half. Each block
// names its finding id, so an edit that brings the defect back goes red here. The analyzer's U02 is pinned in
// analyze-usage.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
// Every `ask` block of a text, as { question, options: [label] }.
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => (l.match(/^- '(.*)' - /) || l.match(/^- '(.*)'\s*$/))[1]) };
});

// U28: the step-5 findings stop had no template, and a run marked 'Close now' over a MATERIAL in the request's area.
test('U28: the step-5 findings stop is an ask template, Fix now marked while an in-area BLOCKER or MATERIAL is open', () => {
    const solve = read('stack/skills/task-solve/SKILL.md');
    const step5 = solve.slice(solve.indexOf('5. **CONFORMANCE**'), solve.indexOf('6. **CLOSE**'));
    const a = asks(step5)[0];
    assert.ok(a, 'step 5 carries its own ask template');
    assert.match(a.question, /^<The review's `Findings:` line, quoted>; open in the request's area: /);
    assert.deepStrictEqual(a.options, ['Fix now (Recommended)', 'Close now - defer the findings']);
    assert.match(flat(step5), /by the step mechanics' conformance rules/, 'step 5 points at the mark rule\'s home');
    // the mark rule lives with the rest of the step-5 mechanics, so the body stays under its 17,700 re-attach cap
    const conf = flat(read('stack/skills/task-solve/references/step-mechanics.md')).split('## Conformance - step 5')[1].split('## The step-6 notes purge')[0];
    assert.match(conf, /'Fix now' keeps the mark while a BLOCKER or MATERIAL is open in the request's area - the code this diff changed, or a behaviour the `Asked:` line names - under AUTO too/);
    assert.match(conf, /The mark moves to 'Close now' only when every open finding is MINOR or outside that area/);
    assert.doesNotMatch(flat(solve), /apply any fixes the step-5 review handed back/, 'step 6 no longer applies fixes the step-5 ask routed to step 4');
});

// U32: a hand-written AUTO waiver had no order rule at the close; one run deleted it before the close ask, which then
// waited 3.8 hours for a user who was away.
test('U32: the hand-written AUTO stamp is deleted last - after the close ask is answered or the close printed', () => {
    const mech = flat(read('stack/skills/task-solve/references/step-mechanics.md'));
    const sec = mech.split('## The APPROVAL stamp - writing it, and its lifetime')[1].split('## Agents-mode dispatch - step 4')[0];
    assert.match(sec, /\*\*The hand-written stamp goes LAST\.\*\* Step 6 deletes it only after the close stop's ask is answered, or after the close printed when nothing is pending - never before the ask/);
});

// U32's twin: task-solve-cross deleted its stamp 'when the run completes', with no order against the close ask either.
test('U32: task-solve-cross deletes a hand-written AUTO stamp last too', () => {
    const t = flat(read('stack/skills/task-solve-cross/references/execution-modes.md'));
    assert.match(t, /delete the file when the run completes - a hand-written AUTO stamp LAST, only after the close's ask is answered or the close printed when nothing is pending/);
});

// U29: a side effect on a surface the plan did not name was filed MINOR (14% of its run went to rework), and a change
// served to every device was tested on one device class.
test('U29: an effect on a surface or device class the plan did not name is at least MATERIAL', () => {
    const t = read('stack/skills/task-verify-code/SKILL.md');
    const rubric = flat(t.slice(t.indexOf('Then the body: a ranked punch-list'), t.indexOf('## Example')));
    assert.match(rubric, /An effect on a surface or device class the plan did not name - another page or screen, a browser, a phone, a platform the changed code also serves - is at least MATERIAL, under auto-run too/);
});

// U30: a design ask put an unmeasured side effect to the user as a premise; the build disproved it, and the task written
// for it was built, then reverted.
test('U30: a design ask states only measured facts; an unmeasured behaviour becomes a plan check, never a premise', () => {
    const t = flat(read('stack/skills/task-design/SKILL.md'));
    assert.match(t, /A design ask - or a seat's `user_decisions:` row - states only measured facts, each with how it was measured \(a run, a test, a located `file:symbol`\)/);
    assert.match(t, /an unmeasured behaviour is never a premise the user is asked to accept: it becomes a plan check, a first step that measures it before any task builds on it/);
    const a = asks(read('stack/skills/task-design/SKILL.md'))[0];
    assert.match(a.question, /today: <what runs now> \(measured: <the run or `file:symbol`>\)/, 'the template carries the measurement slot');
    assert.match(read('stack/skills/task-design/references/evidence.md'), /\*\*A design ask states measured facts/);
});
