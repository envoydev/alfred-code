'use strict';
// D8 (spec docs/superpowers/specs/2026-11-03-d8-heavy-session-seats-design.md): the text of the heavy-session rule in
// `habits-execution-strategy` and of each clause at a choice point. `scripts/d8-rows.js` is the row table; plan 2 holds
// a row by deleting its entries, its item and its text, and every test here stays green.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROWS, POINTS } = require('./d8-rows.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const STRATEGY = 'stack/skills/habits-execution-strategy/SKILL.md';

const BULLET = '- **A heavy session** - heavier than a step\'s seat pin (the newest `Seats:` line, else the model your system prompt names; a `Seats:` line saying no step moves wins) - marks the seat only at these choice points, and only for a SIZEABLE step (Mode): '
    + '`task-solve` build; `task-solve` plan gate; `task-solve` reviewer; `task-design` mode; `task-implement` build; `task-implement` red after five; `task-implement` review; `task-verify-plan` audit; `issue-diagnoser` gather; the `loop-code-quality`, `loop-architecture-quality` and `loop-test-coverage-quality` mode; `task-solve-cross` mode; `task-solve-cross` plan gate; `task-build-from-scratch` mode; the `review-code` and `review-security` seat ask; `task-version-upgrade` approve; the forced inline of `capture-quality` code-quality and architecture-quality and `capture-awareness` code-style'
    + '. These stay here: one command, one grep, a one-file edit or diff, an unplanned review of a diff `task-solve`\'s size table calls `small`, and a stack with no seat; a risk-trigger diff keeps the verifier at any size. Design moves to the designer seat only from a session heavier than opus; a seats package keeps its designers. At a one-step choice the load writes only `Execution: <route> - mode <serial seats: 1 | serial> - model <seat pins | session> - <the size reason>`, with no plan, route or trim ask, or scorer. The direct route reads no model (Route).';

test('the Model section holds the heavy-session bullet whole', () => {
    assert.ok(squash(read(STRATEGY)).includes(squash(BULLET)));
    assert.ok(BULLET.length <= 1450, `bullet is ${BULLET.length} characters`);
});
test('the bullet list equals POINTS, in row order', () => {
    const text = squash(read(STRATEGY));
    const from = text.indexOf('only for a SIZEABLE step (Mode): ') + 'only for a SIZEABLE step (Mode): '.length;
    const to = text.indexOf('. These stay here');
    assert.ok(from > 40 && to > from, 'the list is bounded');
    assert.deepStrictEqual(text.slice(from, to).split('; '), POINTS.map((p) => p.text));
    assert.deepStrictEqual(POINTS.map((p) => p.row), POINTS.map((_, i) => i + 1), 'rows 1-16 in order');
    assert.strictEqual(POINTS.length, 16);
});
test('the verdict format and the mapping lines carry serial seats', () => {
    const text = squash(read(STRATEGY));
    assert.match(text, /Execution: route <direct \| the flow offered> - mode <serial \| serial seats: <n> \| batched \| parallel seats: <n>> - model </);
    assert.ok(text.includes('`serial seats` dispatches the seats one at a time in dependency order, each after the last report and its gates; it is written only where the \'Model\' bullet moves the step, else `serial`, and never on the direct route.'));
    assert.ok(text.includes('Inside a flow, the recommended option follows the verdict: `parallel seats` marks the flow\'s seats option; `serial seats` marks it in the flows the \'Model\' bullet lists, and any other flow reads it as `serial`; `serial` or `batched` marks the in-session one. Where no dispatch is available, `parallel seats` becomes batched calls and `serial seats` becomes `serial` in this session, said in the verdict.'));
    assert.ok(text.includes('A `serial` (not `serial seats`) verdict moves the gate\'s mark to the in-session option'));
});
test('every ROWS entry\'s needle is in its file', () => {
    for (const r of ROWS) assert.ok(squash(read(r.file)).includes(squash(r.needle)), `row ${r.row} ${r.skill}: ${r.needle.slice(0, 70)}`);
});

test('the old forced-INLINE texts are gone from their files', () => {
    const gone = [
        ['stack/skills/loop-code-quality/SKILL.md', 'a scope too small to fan out - one module, never several slices)'],
        ['stack/skills/loop-architecture-quality/SKILL.md', 'a non-stack project, a scope too small to fan out)'],
        ['stack/skills/task-build-from-scratch/SKILL.md', 'No dispatch or a scaffold too small to fan out is INLINE without asking.'],
        ['stack/skills/task-verify-plan/SKILL.md', 'always runs the five passes in-session'],
        ['stack/skills/task-solve-cross/references/cross-domain-run.md', 'the in-session `task-verify-plan` audit'],
        ['stack/skills/task-solve-cross/SKILL.md', 'and running its five passes in-session - traps named'],
    ];
    for (const [file, old] of gone) assert.ok(!squash(read(file)).includes(old), `${file} still holds: ${old}`);
});
