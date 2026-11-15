---
paths: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
---

Editing JavaScript - load `javascript` and `project-structure`: the FIRST action after this rule attaches is those
two Skill calls, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger). `javascript` says how the code is written; `project-structure` says where a file, a function, a constant or
a type goes, and loads with every JavaScript file, whatever its folder (the user, 2026-11-15). Name the skills you
loaded, or say they were already in context - the receipt is what makes the load happen. A compaction ends the
already-in-context skip. Conventions are the source of truth, not recall.

Writing or changing a `*.test.js` / `*.spec.js` (or `.mjs`) loads `ts-js-testing` in the same action, before the
first test edit lands. Skip one-line tweaks.
