---
paths: ["**/SKILL.md", "**/skills/**/*.md"]
---

Writing or changing a skill - its `SKILL.md`, its frontmatter, or a file under its `references/` - the
FIRST action after this rule attaches is the `habits-skill-writing` Skill call, before the NEXT
write to that file lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger). Skip the load only when it is already in context this session - a compaction carries a
loaded skill forward only within a shared budget, so the load is owed again after one. Name the skill
you loaded, or say it was already in context - the receipt is what makes the load happen.

<!-- Maintainer note: a run working through the shell gets no attach at all until it uses a file tool,
     so a sentence saying so here could never reach the run it describes - guard-read-whole-file.js
     names this rule on the first shell write instead (audit M67). The description cap and its lint
     check live in the skill this rule loads and in this repo's CLAUDE.md, never in a rule every
     consuming project installs (audit M65). -->

Where the markdown rule attached on the same touch, its skill loads in that SAME first action, on
top of this one - one first action, not two competing ones. Skip one-line tweaks.
