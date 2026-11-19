# Code audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the file and line that justifies it.

Seven dimensions, 100 points per item. A dimension below its floor caps the grade at B whatever the total. A
criterion is scored against the shared skill that owns it - read by path, and cited by path and section in the
deduction, as in '`.claude/skills/javascript/SKILL.md`, The two failure channels' - and is never restated here.
Where the repo's own `structure_map`, `tsconfig`, lint or format config differs from that skill on style or shape,
the repo's wins and the deduction cites it. A criterion that does not apply to an item is neither awarded nor
deducted: score the dimension on the criteria that do apply, scaled to its points, and name the skipped ones.

**D1 - Architecture and structure (20 pts, floor 12).** Owner: `project-structure` ('The shape', 'Code that predates the shape') and the repo's `structure_map`. The item's place and shape as the map gives them for its folder; an entry that only wires; one kind of thing per file; logic that touches nothing outside; the outside world reached from one effects file; imports pointing one way, with no reach past another feature's exported functions; named values in the constants home.

**D2 - Correctness and robustness (20 pts, floor 12).** Owner: `javascript` ('Async', 'The two failure channels', 'Untrusted input') and its `references/async-patterns.md`. Expected outcomes returned and unexpected failures thrown as an `Error`, nothing swallowed; input from outside checked at the edge where it enters; no floating promise, cancellable work cancelled, a resource released on every path. Every deduction names its failure scenario - the input, event or state, and what then goes wrong.

**D3 - Language and style (15 pts, floor 9).** Owner: `typescript` ('Make the compiler strict, then stricter', 'Don't lie to the compiler', 'Model the data with types', 'Type-layer imports') and its `references/typescript-style.md`; for a `check` file, `javascript` ('Modules and imports', 'Naming and shape of code'). Strict types with narrowing over `any`; naming; imports and exports; erasable syntax only wherever Node strips the types, and the `type` keyword on a type-only import (the `currency.md` rows 'erasable syntax' and 'type-only imports'); the repo's lint, where it has one, clean on the item.

**D4 - Comments (10 pts, floor 6).** Owner: `code-comments` ('Doc comments', 'Inline comments', 'Maintenance'). What a doc comment and an inline comment carry; no comment that restates the code, and none the code has left behind.

**D5 - Tests (15 pts, floor 9).** Owner: `ts-js-testing` ('Test strategy by role', 'The mock-masking trap', 'Suite quality') and its `references/suite-audit.md`. For a subject: its logic has tests where the repo keeps them - the map's 'Tests' line - read at this run for the behaviours they pin and the ones they miss; an entry the conversion listed as 'entry not covered' is a finding here. The quality of those tests is the test item's grade, not the subject's. For a test item: its own quality as a test - what it asserts, what a fake hides, whether it can fail. The limit of this dimension: a carried subject is not read again when only its test item changes, so its D5 can stand up to `max_age_days` old; a repo that needs it fresher lowers that number.

**D6 - Language (10 pts, floor 6).** Owner: `typescript` ('Plain JavaScript is checked JavaScript'). Scored by the class of each file, the item taking the lowest of its files':
- `convert`: TypeScript scores 10; still JavaScript scores 0, and the cap below applies.
- `check` for reason (a) or (b): `// @ts-check` at the top, JSDoc types on what it exports and takes, and the file in the compiler's file list, so the typecheck reads them (the `currency.md` row 'checked JavaScript') - 10 where all three hold, scaled down by what is untyped.
- `check` for reason (c): 4 of 10 even when typed - under the floor, so the item caps at B until its `solve-task` hand-off lands.
- `leave`: not applicable.

**D7 - Consistency (10 pts, floor 6).** Owner: the set maps of Phase 0. The same job done the same way as in the sibling items: one error style, one naming scheme, constants in the same home, one module system per package.

A `leave` file - generated, vendored, kept byte for byte, a fixture its test reads as data - is not scored on any
dimension, and an item whose code files are all `leave` takes the 'no code - not scored' line.

## Set-level defects

Scored once for the whole set and blocking every implicated item from A until resolved:

- An import cycle.
- A dependency that points against the layering.
- Logic duplicated across items.
- A named value defined in two homes.
- `structure_map` disagreeing with the tree.
- An export nothing imports, inside the repo or outside it.
- A `keep_js` path that matches no file, or one whose reason is the outside runtime - (a) or (b) - while its file is loaded only by the repo's own runtime.

A `keep_js` entry with a construct reason, (c), is no set-level defect: its item is held at B by D6 alone.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

Where a band gives two numerics, the upper half of its totals takes the higher: 85-89 is 8 and 80-84 is 7, 72-79 is 6 and 65-71 is 5, 57-64 is 4 and 50-56 is 3, 25-49 is 2 and under 25 is 1. A report prints the numeric beside the letter, and a mean is taken over the numerics.

An item reaches A / 9 only when the total is 90 or more and every dimension clears its floor. A file of the class `convert` still in JavaScript caps its item at B whatever the total - a defect no average should hide. Its price: an item below the target is read again at every run, which is why the audit waits for a finished conversion and the size line names the unconverted characters.
