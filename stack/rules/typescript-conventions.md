---
paths: ["**/*.ts", "**/*.tsx"]
---

Editing TypeScript - load `typescript` and the `javascript` base layer it stacks on: the FIRST action
after this rule attaches is those two Skill calls, before the NEXT edit lands (a path-scoped rule attaches
ON the touch, so it can never precede its own trigger) - even when the touch is incidental to the
session's main thread (measured: both this rule and the Angular one attached, their bodies entered the
session, and neither skill was loaded across 12 edits to `.ts` components). Say which layers you
loaded, or that they were already in context - the receipt is what makes the load happen.

Where a FRAMEWORK or SURFACE rule attached on the same touch, its skill loads in that SAME first
action, on top of this baseline, and that rule's list is the authority on what to load - one first
action, not two competing ones (an Angular or Ionic `.component.ts` edit is the case that collides
here).

Skip a load when it is already in context (some seats preload them); conventions are the source of
truth, not recall. Skip one-line tweaks.
