---
paths: ["**/SKILL.md", "**/skills/**/*.md"]
---

Writing or changing a skill - its `SKILL.md`, its frontmatter, or a file under its `references/` - the
FIRST action after this rule attaches is the `alfred-habits-skill-writing` Skill call, before the NEXT
write to that file lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger; and a run working through the shell gets no attach at all until it uses a file tool, which
is why `guard-read-whole-file.js` names this rule on the first shell write). Skip the load only when
it is already in context this session - a compaction carries a loaded skill forward only within a
shared budget, so the load is owed again after one. Name the skill you loaded, or say it was already in context - the receipt is what makes the
load happen.

Where the markdown rule attached on the same touch, its skill loads in that SAME first action, on
top of this one - one first action, not two competing ones. Skip one-line tweaks.

A skill description stays at most 160 characters, trigger first, the rest in the body's
`## When to use` section (the habit says why; in the Alfred Code repo lint check 15c fails a longer one).
