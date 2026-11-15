---
paths: ["**/SKILL.md", "**/skills/**/*.md", "**/skills/**/*.md.tmpl"]
---

Writing or changing a skill - its `SKILL.md`, its frontmatter, or a file under its `references/` - the
FIRST action after this rule attaches is the `skill-authoring` Skill call, before the NEXT
write to that file lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger). Name the skill you loaded, or say it was already in context - the receipt is what makes the load happen.
A compaction ends the already-in-context skip. Skip one-line tweaks.

<!-- Maintainer note: kept in claude-kit and synced into each repo (skill writing serves authoring, so no install
     carries it); edit it there, never here. A run working through the shell gets no attach on a shell write, so a
     shell edit of a skill here loads the skill by hand. A flow skill READING its own reference attaches this rule too - accepted: a glob
     cannot negate, and narrowing to SKILL.md would drop the reference files this rule exists to cover. The
     *.md.tmpl pattern is for a templated SKILL.md, such as solve-task's, which the sync fills. -->
