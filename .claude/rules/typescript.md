---
paths: ["**/*.ts", "**/*.tsx"]
---

Editing TypeScript - load `typescript`, the `javascript` base layer it stacks on, and `project-structure`: the FIRST
action after this rule attaches is those three Skill calls, before the NEXT edit lands (a path-scoped rule attaches ON
the touch, so it can never precede its own trigger) - even when the touch is incidental to the session's main thread
(measured in Alfred Code: the rule attached, its body entered the session, and its skills were not loaded across 12
edits to `.ts` files). The two language layers say how the code is written; `project-structure` says where a file,
a function, a constant or a type goes, and loads with every TypeScript file, whatever its folder (the user,
2026-11-15). Say which skills you loaded, or that they were already in context - the receipt is what makes the load
happen. A compaction ends the already-in-context skip. Conventions are the source of truth, not recall.

Writing or changing a `*.test.ts` / `*.spec.ts` loads `ts-js-testing` in the same action, before the first test edit
lands.

Skip one-line tweaks.
