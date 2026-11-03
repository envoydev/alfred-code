'use strict';
// D8 row table (plan docs/superpowers/plans/2026-11-03-d8-heavy-session-seats.md, 'Shared copy'). One entry per
// insertion or replacement in a skill body, and one item per choice point in the 'A heavy session' bullet of
// `habits-execution-strategy`. Plan 2 holds a row by deleting its ROWS entries, its POINTS item and its text.
//
//   ROWS:   Array<{ row: number, skill: string, file: string, needle: string, kind: 'clause' | 'edit' }>
//           `clause` is a new sentence, `edit` a changed word, placeholder or replaced sentence;
//           `file` is repo-relative, `needle` the text the file must hold.
//   POINTS: Array<{ row: number, text: string }>   the bullet's list, in row order.
const ROWS = [];
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
