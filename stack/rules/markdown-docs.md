---
description: Trigger patch - a description match is a hint the model can skip on a content edit (docs-as-code drew 3 loads over 22 matching edits), so this glob binds the doc skills' load as the first action on any .md.
paths: ["**/*.md"]
---

Authoring or restructuring any .md (README, ADR, runbook): the FIRST action after this rule attaches
is the `markdown-style` Skill call, before the NEXT write to that file lands (a path-scoped rule
attaches ON the touch, measured 9.9 s after the edit, so it can never precede its own trigger; and a
run working through the shell gets no attach at all until it uses a file tool - 0 attaches over 123
`.md` write targets - which is why `guard-read-whole-file.js` names this rule on the first shell
write). ADR, Mermaid-diagram or C4 work loads `docs-as-code` in that SAME first action, on top of it -
one first action, not two competing ones. Skip one-line tweaks.

<!-- Maintainer note: the one-line-tweak carve-out stays in prose on purpose - `paths:` takes globs and brace
     expansion only (checked against the Claude Code memory docs: no negation form, and an invalid pattern
     matches nothing), so an exclusion cannot live in the glob. -->

**The generated docs root is NOT governed here, and neither are the generated rules.** Every document
under `<docs-path>`, every generated `.claude/rules/baseline-project-*.md` and
`.claude/rules/project-code-style.md` belongs to the skill that writes it, which fixes its shape
verbatim, down to the frontmatter - two owners pulling one file in opposite directions is worse than
either alone.
