---
paths: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
---

Editing JavaScript - load `javascript`: the FIRST action after this rule attaches is that Skill call, before the NEXT
edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger). Name the skill you
loaded, or say it was already in context - the receipt is what makes the load happen. A compaction ends the
already-in-context skip. Conventions are the source of truth, not recall.

Writing or changing a `*.test.js` / `*.spec.js` (or `.mjs`) loads `ts-js-testing` in the same action, before the
first test edit lands. Skip one-line tweaks.
