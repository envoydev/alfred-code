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
