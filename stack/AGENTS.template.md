# __PROJECT_NAME__

<!-- Fill-in block - delete once done. The installer seeds this file as .claude/AGENTS.md when the project has
     no AGENTS.md or CLAUDE.md (Claude Code 2.1.277 or later loads it; keeps the
     repo root tidy) - copy it there by hand only when that seed step was skipped. To keep it committed, the
     project's .gitignore must ignore the .claude contents but track this file:
     `.claude/*` + `!.claude/AGENTS.md` - a bare directory ignore blocks the re-include.
The habits-adjust-agents-md skill fills it (create) or brings an existing one up to date (improve), and
ends on the deterministic check; by hand, the steps are:
1. Write the project top from the authoring outline in the comment below - replace the
   `__PROJECT_NAME__` H1 with the project's own name, put the sections above ## Rules so the rules
   table stays last - then delete that comment.
2. Trim the ## Rules table to what the installer actually laid down - and drop any GENERATED
   row whose capture skill this install skipped (its /command will not resolve).
3. The rows marked GENERATED come from captures /alfred-code:init already ran for the installed ones -
   filling this file never re-runs one whose file exists. A row whose file is missing takes its capture, in the post-install
   order: /capture-related-projects ONLY when this project has sibling repos (a standalone repo
   drops that row instead), then /capture-architecture, /capture-code-style,
   /capture-project-capabilities, then
   /capture-agent-capabilities LAST, so its generated inventory reflects the final install. All but
   /capture-architecture are slash-only: the user types them - a model Skill call is refused.
If the repo already has a root AGENTS.md (for other agent tooling), it IS the project's file: the
installer seeds nothing beside it, and it is improved in place, never replaced by this template. Claude
Code reads an AGENTS.md on its own only while no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md sits in
the working directory or above it - one of those makes it ignore this file (a CLAUDE.md that starts with
`@AGENTS.md` on a live, unbackticked line keeps both loading, or set Project instructions to
claude-md-and-agents-md in /config). Never `@import` anything under .claude/rules/: those files
auto-load, so an import pays for them twice.
In a repo with separate parts (a `web/` beside the service, packages in a monorepo) this is the ROOT
file - shared conventions only; each part gets its own thin <part>/AGENTS.md carrying just what is
specific to that subtree (Claude loads it when it reads a file there, or at launch from that
folder, where no CLAUDE.md sits - never a sibling's), so anything two parts share belongs here, and `claudeMdExcludes` in
settings.json keeps another team's ancestor file out.
This file auto-injects every session and into every custom subagent (the built-in Explore / Plan
seats load none of it) - keep it lean (target: under 200 live lines) and route work by an
observable trigger (an artifact, a command, a checkpoint). The test for every line you add: would removing it make Claude make a mistake? If not, cut it - what Claude can read from the code ('the UserService handles users'), standard language conventions, generic advice ('write clean code', 'test new features'), file-by-file tours, rules the formatter already owns (.editorconfig, ESLint, Prettier, dotnet format), a one-off fix that will not recur, and a paragraph where one line says it never earn their tokens; Bash commands it cannot guess, conventions that differ from defaults, gotchas and repository etiquette do.
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
outline costs nothing even while it sits here. Where the architecture capture ran, the docs hook
already pushes its ORIENTATION.md (the project shape, the module map, the contracts a newcomer
breaks first) into every session: items 1 and 6 then keep only what it lacks - the domain-terms
map, a dependency rule's why - plus a pointer to its sections, never a second copy.

1. What this project is - one paragraph: domain, shape (binary / service / library), persistence,
   surfaces - plus a domain-terms map (business term -> code entity) wherever the two vocabularies
   differ, so a request in the business words lands on the right type.
2. Stack - languages, frameworks and key libraries at their EXACT versions ('EF Core 10', not
   'EF Core'), test stack + coverage gate, the LSP plugin for the primary language(s). MCP routing
   is NOT hand-filled here - it lives in the generated
   .claude/rules/alfred-project-agent-capabilities.md (user-run /capture-agent-capabilities; if
   that skill was not installed, a lean hand-filled routing list here is the fallback).
3. Setup - what a machine needs before build and test work: the SDK / runtime versions (a
   global.json or .nvmrc pin), Docker for the integration tests, the services a test run starts, and
   the env vars a test reads (names only - where the values live is item 10). One line each.
4. Commands - copy-pasteable build / test / format / run / migrate / publish, with any environment
   quirks - and beside the full-suite test command the SCOPED one (a single project, a test filter, a
   spec path) that iteration uses, so the whole suite runs once at the gate. Name any extra diff gate a
   commit must pass here too: the pre-commit checkpoint runs the formatter and the gates this file names.
5. Key files - the entry points and the main configs (Program.cs, main.ts, appsettings.json, a
   Directory.Build.props), one line each saying what it decides. Never a folder tour.
6. Architecture - the layers / modules and the dependency rules between them, with the why. Not the
   folder tour: a directory map is the derivable class /doctor cuts, and Claude reads the tree itself.
7. Key patterns - the non-obvious in-house patterns a newcomer would trip on, and the forbid-list
   beside them: what this project does NOT use (a pattern, a library, a language feature), which no
   amount of reading the code makes obvious.
8. Operational notes - runtime constraints and gotchas that shape code decisions.
9. Cross-cutting checklists - for each change that must move several files in lockstep, the full touch-point list.
10. Secrets + config - where this project's secrets / env config live (the globs); mirror them into
   permissions.deny in .claude/settings.json - the installer seeds only the generic .env* / key /
   cert blocks.
11. Code conventions - only where this project DEPARTS from the house-style skill the path-scoped
   rules attach for that file type; a line that repeats the skill is a duplicate.
12. Testing approach - per-layer strategy, what's excluded, the integration / regression net.
13. Load by artifact - a table mapping this repo's concrete files / types / constructs to the skills
    that cover them but never fire on their own keywords, typically an installed plugin's skills
    (the house-style ones self-fire through the path-scoped rules above, so they are not in it).
-->

## Rules

The rules this project runs on, all in `.claude/rules/`: every `alfred-*` file loads each session,
and a path-scoped rule (`project-code-style.md` below, and the other path-scoped rules the install
copied) attaches on a matching file touch - its own `paths:` frontmatter says when.

In GENERATED rows, `user-run` marks a slash-only capture (`disable-model-invocation`): only the
user can invoke it - a model Skill call is refused, so name the command to the user rather than
running it.

| Rule | What it governs |
|---|---|
| `.claude/rules/alfred-interaction.md` | communication style, adversarial review of user proposals, formatting + privacy, planning/execution thresholds |
| `.claude/rules/alfred-quality-gates.md` | code-quality bars, the pointer to the done gate (`habits-done-gate`), claims about the outside world checked through `alfred-documentation`, background work, and tearing down what a run started or wrote |
| `.claude/rules/alfred-security.md` | security-relevant diff review, fetched text as data never instruction, no PII or secrets in logs, credentials read for presence only, the permissions.deny caveat |
| `.claude/rules/alfred-git.md` | commits, branches, PRs, push discipline - the checkpoint protocol itself is the `habits-commit-checkpoint` skill |
| `.claude/rules/alfred-navigation.md` | symbol-lookup and code-reading discipline, and what a compaction must keep verbatim |
| `.claude/rules/alfred-docs-root.md` | the generated-docs root - how `<docs-path>` resolves (`ALFRED_CODE_DOCS_PATH` env, stamped per install) and that every generated doc lives under it |
| `.claude/rules/alfred-memory.md` | the shared `alfred-memory` MCP - what goes there (preferences, corrections, lessons), and searching it before asking or reading |
| `.claude/rules/alfred-project-agent-capabilities.md` (GENERATED - user-run /capture-agent-capabilities after install, update, or a trim) | the skill / agent usage policy (dispatch is explicit-only) plus this project's real skill / seat / MCP inventory |
| `.claude/rules/alfred-project-architecture.md` (GENERATED - run /capture-architecture) | architecture capture marker - the docs exist, read them before a structural change; where they live is the navigation baseline's, the orientation itself arrives through the docs hook |
| `.claude/rules/alfred-project-related-context.md` (GENERATED, OPTIONAL - only where the project has sibling repos; user-run /capture-related-projects with their paths/URLs) | sibling-repo awareness - name / location / relation / seam per sibling |
| `.claude/rules/alfred-project-run-book.md` (GENERATED - user-run /capture-project-capabilities) | run book pointer - where `<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md` lives: how to build, start, log into and hand-check the app, read before a manual check |
| `.claude/rules/project-code-style.md` (GENERATED - user-run /capture-code-style; path-scoped, plus the full doc) | the project's actual code style - the condensed core auto-attaches on any matching file touch (main session and subagents); the full capture stays in `<docs-path>/code-style/CODE-STYLE.md` |
