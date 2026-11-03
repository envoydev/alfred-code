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

// Row 12's point is the cross flow's plan gate; the audited skill, task-verify-plan, carries the one line saying it runs the passes where that protocol says.
const ALSO_EDITED = { 12: ['task-verify-plan'] };
test('every row has its point and its text', () => {
    assert.deepStrictEqual([...new Set(POINTS.map((p) => p.row))].sort((a, b) => a - b), [...new Set(ROWS.map((r) => r.row))].sort((a, b) => a - b));
    for (const r of ROWS) {
        const point = POINTS.find((p) => p.row === r.row);
        assert.ok(point.text.includes(r.skill) || (ALSO_EDITED[r.row] || []).includes(r.skill), `row ${r.row}: ${r.skill} is named in "${point.text}"`);
    }
});

test('every clause is conditioned', () => {
    for (const r of ROWS.filter((x) => x.kind === 'clause')) {
        const n = r.needle.toLowerCase();
        assert.ok(n.includes('on a heavy session') || n.includes('serial seats'), `row ${r.row} clause is not conditioned: ${r.needle.slice(0, 70)}`);
        if (r.needle.includes('load `habits-execution-strategy` with the Skill tool'))
            assert.ok(r.needle.includes('a `Seats:` line in context, or a system-prompt model above Sonnet') || r.needle.includes('the newest `Seats:` line in context unless it says no step moves, else a system-prompt model above Sonnet'), `row ${r.row}: the load carries the heavy-session condition`);
    }
    for (const r of ROWS.filter((x) => x.row === 14)) assert.ok(r.needle.includes('any other keeps the no-ask path'), `row 14 ${r.skill} keeps the no-ask path`);
});

// What Sonnet pays: the clause text every sonnet session loads with these skills, bounded. The strategy file's base size is a literal.
const STRATEGY_BASE_CHARS = 13673;
test('what Sonnet pays', () => {
    assert.ok(BULLET.length <= 1450, `bullet is ${BULLET.length}`);
    const clauses = ROWS.filter((r) => r.kind === 'clause').map((r) => r.needle.length);
    for (const n of clauses) assert.ok(n <= 360, `a clause is ${n} characters`);   // 330 at planning; rows 14 and 16 name the newest line (review finding 1)
    const mean = clauses.reduce((a, b) => a + b, 0) / clauses.length;
    assert.ok(mean <= 260, `clause mean ${mean}`);
    const perRow = {};
    for (const r of ROWS) perRow[r.row] = (perRow[r.row] || 0) + r.needle.length;
    const growth = fs.statSync(path.join(ROOT, STRATEGY)).size - STRATEGY_BASE_CHARS;
    console.log(`# D8 cost: bullet ${BULLET.length}; strategy growth ${growth} bytes; ${clauses.length} clauses, total ${clauses.reduce((a, b) => a + b, 0)}, mean ${Math.round(mean)}; per row ${JSON.stringify(perRow)}`);
});

// Asks D8 leaves alone (spec 3.3, 'Already seat-first' and 'Not a chat-or-seat choice'): first line and marked label,
// read once from the branch base and written as literals. Never reads git at run time.
const UNTOUCHED = [
    { file: 'stack/skills/capture-awareness/SKILL.md', firstLine: "Run the seat parts through their analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-awareness/references/architecture.md', firstLine: "First architecture capture across <the modules>. Characterize them through the architecture-analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-awareness/references/project-code-style.md', firstLine: "First style capture across <the languages>. Characterize them through the code-style-analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-awareness/references/related-projects.md', firstLine: "Characterize <the siblings> through the related-project-analyzer seats, one per sibling, or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-quality/SKILL.md', firstLine: "Run the chosen parts through their analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-quality/references/architecture-quality.md', firstLine: "Hunt the weaknesses and strengths of <the modules> through the architecture-analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-quality/references/code-quality.md', firstLine: "Judge <the modules> through the code-quality-analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-quality/references/test-coverage-quality.md', firstLine: "Analyze <the measured surfaces> through the test-coverage-analyzer seats or in this session?", recommended: "Through the seats (Recommended)" },
    { file: 'stack/skills/capture-preferences/references/tools-area.md', firstLine: "May agents use <server>?", recommended: "Main session only (Recommended)" },
    { file: 'stack/skills/habits-execution-strategy/SKILL.md', firstLine: "This task fits <the flow>: <what it adds for THIS task>. Start it, or proceed here directly?", recommended: "Start <the flow's slash command> (Recommended)" },
    { file: 'stack/skills/habits-execution-strategy/SKILL.md', firstLine: "The plan needs <N> seats / reaches <the scope past the request>. Run the trimmed plan?", recommended: "Run the trimmed plan (Recommended)" },
    { file: 'stack/skills/mode-output-scorer/SKILL.md', firstLine: "The <output> scored <S>/100 (level <n>); the next revision can reach at most <ceiling> - <the needs line, or nothing closable left>. How should it go on?", recommended: "Answer the open decisions (Recommended)" },
    { file: 'stack/skills/task-implement/SKILL.md', firstLine: "<task> FAILED: <why>.", recommended: "Stop and report (Recommended)" },
    { file: 'stack/skills/task-implement/SKILL.md', firstLine: "Both write routes refused the approval stamp: <the refusal>.", recommended: "Retry the stamp (Recommended)" },
    { file: 'stack/skills/loop-code-quality/SKILL.md', firstLine: "Both write routes refused the approval stamp: <the refusal>.", recommended: "Retry the stamp (Recommended)" }
];
test('the asks D8 leaves alone keep their marks', () => {
    for (const u of UNTOUCHED) {
        const blocks = [...read(u.file).matchAll(/```ask\n([\s\S]*?)```/g)].map((m) => m[1].split('\n'));
        const marked = blocks.filter((b) => b[0].trim() === u.firstLine).some((b) => b.some((l) => /^\s*- '/.test(l) && l.includes(`'${u.recommended}'`)));
        assert.ok(marked, `${u.file}: the ask "${u.firstLine.slice(0, 60)}" still marks '${u.recommended}'`);
    }
    assert.ok(UNTOUCHED.length >= 14);
});

// Review finding 1: a `/model` switch down prints a `Seats:` line saying no step moves, so 'a line in context' alone reads a
// Sonnet session as heavy - the parts that load nothing (row 16) and the reviews (row 14) name the NEWEST line and its exception.
test('the clauses that decide on their own read the newest Seats line, not any', () => {
    const own = ROWS.filter((r) => r.kind === 'clause' && (r.row === 14 || r.row === 16));
    assert.strictEqual(own.length, 5);
    for (const r of own) {
        assert.ok(r.needle.includes('the newest `Seats:` line in context unless it says no step moves, else a system-prompt model above Sonnet'), `row ${r.row} ${r.skill}`);
        assert.ok(!r.needle.includes('a `Seats:` line in context, or'), `row ${r.row} ${r.skill} still reads any line`);
    }
});
