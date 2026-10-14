---
description: Trigger patch - a description match is a hint the model can skip on a content edit (docs-as-code drew 3 loads over 22 matching edits), so this glob binds the doc skills' load as the first action on any .md.
paths: ["**/*.md"]
---

**The generated docs root is NOT governed here, and neither are the generated rules.** A plan, flow
note or capture under `<docs-path>`, a generated rule under `.claude/rules/` (`alfred-architecture.md`, `alfred-related-context.md`, `alfred-agent-awareness.md`, `alfred-project-awareness.md` or
`project-code-style.md`), a skill's own files, and a `.md` you only READ take no load:
each belongs to the skill that writes it, which fixes its shape verbatim, down to the frontmatter -
two owners pulling one file in opposite directions is worse than either alone.

Authoring or restructuring any other .md (README, ADR, runbook): the FIRST action after this rule attaches
is the `markdown-style` Skill call, before the NEXT write to that file lands (a path-scoped rule
attaches ON the touch, so it can never precede its own trigger - measured 9.9 s after the edit). ADR,
Mermaid-diagram or C4 work loads `docs-as-code` in that SAME first action, on top of it - one first
action, not two competing ones. Skip the load when it is already in context. Name the skill you
loaded, or say it was already in context - the receipt is what makes the load happen. Skip one-line
tweaks.

<!-- Maintainer note: a run working through the shell gets no attach on a shell write -
     0 attaches over 123 `.md` write targets - so a sentence saying so here could never reach the run it
     describes; guard-read-whole-file.js names this rule on the first shell write instead (audit M67). -->

<!-- Maintainer note: the one-line-tweak carve-out stays in prose on purpose - `paths:` takes globs and brace
     expansion only (checked against the Claude Code memory docs: no negation form, and an invalid pattern
     matches nothing), so an exclusion cannot live in the glob. -->
