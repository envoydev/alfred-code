'use strict';
// D8 row table (plan docs/superpowers/plans/2026-11-03-d8-heavy-session-seats.md, 'Shared copy'). One entry per
// insertion or replacement in a skill body, and one item per choice point in the 'A heavy session' bullet of
// `habits-execution-strategy`. Plan 2 holds a row by deleting its ROWS entries, its POINTS item and its text.
//
//   ROWS:   Array<{ row: number, skill: string, file: string, needle: string, kind: 'clause' | 'edit' }>
//           `clause` is a new sentence, `edit` a changed word, placeholder or replaced sentence;
//           `file` is repo-relative, `needle` the text the file must hold.
//   POINTS: Array<{ row: number, text: string }>   the bullet's list, in row order.
const SM = 'stack/skills/task-solve/references/step-mechanics.md';
const TS = 'stack/skills/task-solve/SKILL.md';
const FS = 'stack/skills/task-solve/references/full-spec.md';
const CITE = "On a heavy session the 'Model' bullet of `habits-execution-strategy` sets this mark.";
const ROWS = [
    { row: 1, skill: 'task-solve', file: SM, kind: 'edit', needle: '`parallel seats` or `serial seats` recommends agents' },
    { row: 1, skill: 'task-solve', file: SM, kind: 'clause', needle: "Under `serial seats`, the cards go out one at a time in the plan's dependency order: the next card only after the last card's report is in and its gates are green; a red stops the chain and routes by the build-time stop list." },
    { row: 1, skill: 'task-solve', file: TS, kind: 'edit', needle: "- 'Approve - dispatch the agent seats' - <independent tasks that build in parallel | the cards one at a time in dependency order>" },
    { row: 1, skill: 'task-solve', file: TS, kind: 'edit', needle: "- 'Build as planned - dispatch the agent seats' - <independent tasks that build in parallel | the cards one at a time in dependency order>" },
    { row: 2, skill: 'task-solve', file: TS, kind: 'clause', needle: "On a heavy session (a `Seats:` line in context, or a system-prompt model above Sonnet), load `habits-execution-strategy` with the Skill tool before this gate unless this run did; its 'Model' bullet sends the audit to the `<stack>-verifier` seat whatever step 1's mode." },
    { row: 2, skill: 'task-solve', file: TS, kind: 'edit', needle: 'load `habits-execution-strategy` (the Skill tool) unless this run already did; its `Execution:` line' },
    { row: 2, skill: 'task-solve', file: FS, kind: 'clause', needle: "; on a heavy session the audit half goes to the `<stack>-verifier` seat by the same 'Model' bullet, still with no stop between" },
    { row: 3, skill: 'task-solve', file: SM, kind: 'clause', needle: CITE + " It marks the verifier for every diff past one file; on a serial-seats build whose card tripped a risk trigger, the stop's reason names the trigger and the card." },
];
const POINTS = [
    { row: 1, text: '`task-solve` build' },
    { row: 2, text: '`task-solve` plan gate' },
    { row: 3, text: '`task-solve` reviewer' },
    { row: 4, text: '`task-design` mode' },
    { row: 5, text: '`task-implement` build' },
    { row: 6, text: '`task-implement` red after five' },
    { row: 7, text: '`task-implement` review' },
    { row: 8, text: '`task-verify-plan` audit' },
    { row: 9, text: '`issue-diagnoser` gather' },
    { row: 10, text: 'the `loop-code-quality`, `loop-architecture-quality` and `loop-test-coverage-quality` mode' },
    { row: 11, text: '`task-solve-cross` mode' },
    { row: 12, text: '`task-solve-cross` plan gate' },
    { row: 13, text: '`task-build-from-scratch` mode' },
    { row: 14, text: 'the `review-code` and `review-security` seat ask' },
    { row: 15, text: '`task-version-upgrade` approve' },
    { row: 16, text: 'the forced inline of `capture-quality` code-quality and architecture-quality and `capture-awareness` code-style' },
];

module.exports = { ROWS, POINTS };
