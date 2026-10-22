---
paths: ["**/SKILL.md", "**/skills/**/*.md"]
---

Writing or changing a skill - its `SKILL.md`, its frontmatter, or a file under its `references/` - the
FIRST action after this rule attaches is the `skill-authoring` Skill call, before the NEXT
write to that file lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger). Skip the load only when it is already in context this session - a compaction carries a
loaded skill forward only within a shared budget, so the load is owed again after one. Name the skill
you loaded, or say it was already in context - the receipt is what makes the load happen.

<!-- Maintainer note: this repo's own rule since 2026-10-22 (the user's ruling - skill writing serves the stack's own
     authoring, so no install carries it); the stack's retired copy is pruned by update. A run working through the shell
     gets no attach on a shell write, and the stack's read guard no longer names this rule, so a shell edit of a skill
     here loads the skill by hand. A flow skill READING its own reference attaches this rule too - accepted: a glob
     cannot negate, and narrowing to SKILL.md would drop the reference files this rule exists to cover. -->

Where the markdown rule attached on the same touch, its skill loads in that SAME first action, on
top of this one - one first action, not two competing ones. Skip one-line tweaks.
