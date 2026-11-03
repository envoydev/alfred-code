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
const POINTS = [];

module.exports = { ROWS, POINTS };
