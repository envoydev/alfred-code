---
paths: ["**/*.ts", "**/*.tsx"]
---

Editing TypeScript - load `typescript` and the `javascript` base layer it stacks on: the FIRST action after this rule
attaches is those two Skill calls, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can
never precede its own trigger) - even when the touch is incidental to the session's main thread (measured in Alfred
Code: the rule attached, its body entered the session, and neither skill was loaded across 12 edits to `.ts` files).
Say which layers you loaded, or that they were already in context - the receipt is what makes the load happen. A
compaction ends the already-in-context skip. Conventions are the source of truth, not recall.

Skip one-line tweaks.
