# __PROJECT_NAME__

<!-- Fill-in block - delete once done. The installer seeds this file as .claude/CLAUDE.md when the project has
     none (auto-loaded, same as a root CLAUDE.md; keeps the repo root tidy) - copy it there by hand only when
     that seed step was skipped. To keep it committed, the project's .gitignore must ignore the .claude
     contents but track this file: `.claude/*` + `!.claude/CLAUDE.md` - a bare directory ignore blocks the re-include. Then:
1. Write the project top from the authoring outline in the comment below - replace the
   `__PROJECT_NAME__` H1 with the project's own name, put the sections above ## Rules so the rules
   table stays last - then delete that comment.
2. Trim the ## Rules table to what the installer actually laid down - and drop any GENERATED
   row whose capture skill this install skipped (its /command will not resolve).
3. Run the captures that write the rows marked GENERATED, in the post-install order:
   /project-architecture-analyzer, /project-code-style-analyzer, /project-related-context ONLY
   when this project has sibling repos (a standalone repo drops that row instead), then
   /project-agent-capabilities LAST, so its generated inventory reflects the final install. All but
   /project-architecture-analyzer are slash-only: the user types them - a model Skill call is refused.
If the repo's canonical agent instructions already live in an AGENTS.md (for other agent
tooling), keep this file thin and import it with `@AGENTS.md` - written unbackticked on a live line,
since backticks make a path literal - instead of filling the same content twice. But never
`@import` anything under .claude/rules/: those files auto-load, so an import pays for them twice.
In a monorepo this is the ROOT file - shared conventions only; every package gets its own thin
.claude/CLAUDE.md carrying just what is specific to that subtree (a session launched from the
package directory loads that file plus the root, never a sibling's), so anything two packages share
belongs here, and `claudeMdExcludes` in settings.json keeps another team's ancestor file out.
This file auto-injects every session and into every custom subagent (the built-in Explore / Plan
seats load none of it) - keep it lean (target: under 200 live lines) and route work by an
observable trigger (an artifact, a command, a checkpoint). The test for every line you add: would removing it make Claude make a mistake? If not, cut it - what Claude can read from the code, standard language conventions, file-by-file tours, rules the formatter already owns (.editorconfig, ESLint, Prettier, dotnet format) and 'write clean code' never earn their tokens; Bash commands it cannot guess, conventions that differ from defaults, gotchas and repository etiquette do.
Five shapes to keep out, whatever they cost: the aspiration document (vague wishes), the wishlist
(conventions the author wants instead of the ones the code enforces - an inherited codebase's own
conventions win), the freeze (never touched while the repo moved on), the TODO ledger (scratch
notes), and the single source (everything here, nothing routed to a scoped rule or a skill).
Prune it when things go wrong, and test a change by watching whether behaviour shifts. The cross-project working conventions
are NOT here: they load from the always-on baseline rules in .claude/rules/ (installer-managed,
refreshed on update) - never restate them in this file. (HTML comment: stripped from injection,
so an unfilled template pays nothing for this block.) -->

<!-- Authoring outline - write these sections into the project-specific top of this file, in the
numbered order below, with ## Rules left last: a fixed order means every filled file keeps the same
fact in the same place, and the two highest-traffic facts (stack, commands) sit at the top. Keep
each section lean, then delete this comment block. Comments are stripped from injection, so this
outline costs nothing even while it sits here.

1. What this project is - one paragraph: domain, shape (binary / service / library), persistence,
   surfaces - plus a domain-terms map (business term -> code entity) wherever the two vocabularies
   differ, so a request in the business words lands on the right type.
2. Stack - languages, frameworks and key libraries at their EXACT versions ('EF Core 10', not
   'EF Core'), test stack + coverage gate, the LSP plugin for the primary language(s). MCP routing
   is NOT hand-filled here - it lives in the generated
   .claude/rules/baseline-project-agent-capabilities.md (user-run /project-agent-capabilities; if
   that skill was not installed, a lean hand-filled routing list here is the fallback).
3. Commands - copy-pasteable build / test / run / migrate / publish, with any environment quirks - and
   beside the full-suite test command the SCOPED one (a single project, a test filter, a spec path)
   that iteration uses, so the whole suite runs once at the gate.
4. Architecture - the layers / modules and the dependency rules between them, with the why. Not the
   folder tour: a directory map is the derivable class /doctor cuts, and Claude reads the tree itself.
5. Key patterns - the non-obvious in-house patterns a newcomer would trip on, and the forbid-list
   beside them: what this project does NOT use (a pattern, a library, a language feature), which no
   amount of reading the code makes obvious.
6. Operational notes - runtime constraints and gotchas that shape code decisions.
7. Cross-cutting checklists - for each change that must move several files in lockstep, the full touch-point list.
8. Secrets + config - where this project's secrets / env config live (the globs); mirror them into
   permissions.deny in .claude/settings.json - the installer seeds only the generic .env* / key /
   cert blocks.
9. Code conventions - only where this project DEPARTS from the house-style skill the path-scoped
   rules attach for that file type; a line that repeats the skill is a duplicate.
10. Testing approach - per-layer strategy, what's excluded, the integration / regression net.
11. Load by artifact - a table mapping this repo's concrete files / types / constructs to the skills
    that cover them but never fire on their own keywords, typically an installed plugin's skills
    (the house-style ones self-fire through the path-scoped rules above, so they are not in it).
-->

## Rules

The always-on baseline set in `.claude/rules/`, all loaded every session. Path-scoped rules in the
same directory attach on a matching file touch - their own `paths:` frontmatter says when.

In GENERATED rows, `user-run` marks a slash-only capture (`disable-model-invocation`): only the
user can invoke it - a model Skill call is refused, so name the command to the user rather than
running it.

| Rule | What it governs |
|---|---|
| `.claude/rules/baseline-interaction.md` | communication style, adversarial review of user proposals, formatting + privacy, planning/execution thresholds |
| `.claude/rules/baseline-quality-gates.md` | code-quality bars, the pointer to the done gate (`alfred-habits-done-gate`), and claims about the outside world checked through `context7` |
| `.claude/rules/baseline-security.md` | /security-review routing, PII/secret handling, the permissions.deny caveat |
| `.claude/rules/baseline-git.md` | commits, branches, PRs, push discipline - the checkpoint protocol itself is the `project-commit-checkpoint` skill |
| `.claude/rules/baseline-navigation.md` | symbol-lookup and code-reading discipline, and what a compaction must keep verbatim |
| `.claude/rules/baseline-docs-root.md` | the generated-docs root - how `<docs-path>` resolves (`ALFRED_CODE_DOCS_PATH` env, stamped per install) and that every generated doc lives under it |
| `.claude/rules/baseline-project-agent-capabilities.md` (GENERATED - user-run /project-agent-capabilities after install, update, or a trim) | the skill / agent usage policy (dispatch is explicit-only) plus this project's real skill / seat / MCP inventory |
| `.claude/rules/baseline-project-architecture.md` (GENERATED - run /project-architecture-analyzer) | architecture docs pointer - where the docs live and how to read them by section; the orientation itself arrives through the docs hook |
| `.claude/rules/baseline-project-related-context.md` (GENERATED, OPTIONAL - only where the project has sibling repos; user-run /project-related-context with their paths/URLs) | sibling-repo awareness - name / location / relation / seam per sibling |
| `.claude/rules/project-code-style.md` (GENERATED - user-run /project-code-style-analyzer; path-scoped, plus the full doc) | the project's actual code style - the condensed core auto-attaches on any matching file touch (main session and subagents); the full capture stays in `<docs-path>/code-style/CODE-STYLE.md` |
