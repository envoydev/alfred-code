# CLAUDE.md audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Score each CLAUDE.md on four weighted dimensions, 100 points total. For every point awarded or deducted, cite the line or block that justifies it. Then map the total to a grade using the band table, applying the dimension floors.

## Dimension 1 - Content fit and tier (30 pts)

- Right content. The file holds what Claude needs every session: build and test commands, architecture at a glance, core conventions, always-do rules. Multi-step procedures, path-specific guidance, deterministic steps, and hard blocks are routed to skills, path-scoped rules, hooks, and permissions respectively, per the mechanism map. The official include list is the checklist - Bash commands Claude cannot guess (the scoped test command beside the full-suite one, so iteration runs one test and the gate runs the suite), code style that differs from the language's defaults, the test runner and testing instructions, repository etiquette (branches, PR conventions), architectural decisions specific to the project, developer-environment quirks, non-obvious gotchas - and its exclude list is the cut list: anything Claude can read from the code, standard language conventions, detailed API documentation (link it), information that changes often, tutorials, file-by-file descriptions of the codebase, and self-evident practice ('write clean code'). Each excluded line found is cited and deducted. Five more shapes to name when found: the aspiration document (vague wishes), the wishlist (rules describing the code as the author wishes it were - Claude then writes against a reality that contradicts them; the file states the conventions actually enforced, and an inherited codebase's own conventions win), the freeze (untouched for months while the repo moved - compare the file's last change to repo activity), the TODO ledger (scratch notes), and the single source (everything in the root, no nested files or scoped rules). Formatting rules belong to the formatter (`.editorconfig`, `dotnet format`, ESLint, Prettier) - a lint rule restated in CLAUDE.md is leakage, not guidance. Three include-list items authors skip: a forbid-list ('we do NOT use: the repository pattern, AutoMapper, exceptions for business flow') - not derivable from code, high value; exact versions on the stack line ('EF Core 10', not 'EF Core'); a domain-terms map (business term to code entity) where the two vocabularies differ. A directory map is the derivable class `/doctor` cuts - keep the dependency rules, drop the folder tour. In template mode the authoring outline is scored against the same lists (measured 2026-09-29 on the shipped template: 22 live lines, 3,165 chars, ~0.8k tokens, outside its comment blocks; its outline now carries the forbid-list (item 7) and the domain-terms map (item 1), and its architecture item rules out the folder tour - an earlier 19-line version had neither item and asked for 'folder organization'). (10)
- Facts are verified. Every command, path, and claim checks out against the repository. Stale or wrong facts are the most damaging defect this file can have, because they are trusted and executed. (8)
- Right tier. Team-shared standards in project scope, individual preference in user or local scope, org policy in managed scope. Individual preference committed into a shared project file is a defect even when the content is good. (7)
- Nested CLAUDE.md files are used deliberately: subdirectory files carry only what is specific to that subtree, since they load on demand when Claude works there. Monorepo shape: the root holds shared conventions, each package its own file, a session launched from the package directory loads that file plus the root and never a sibling's - so anything two packages share goes to the root, and `claudeMdExcludes` keeps other teams' ancestors out. The community hub-and-spoke form - many 20-80-line files plus a root table mapping keywords to on-demand docs - is what the template's 'Load by artifact' table implements. (5)

Floor for A: >= 26/30.

## Dimension 2 - Hub structure and rule linkage (30 pts)

This is the dimension unique to CLAUDE.md: the file must function as the map of the instruction layer.

- Governing rules are mapped. The file names each unconditional rule file that defines process and behavior, by backticked path with a one-line framing of what it governs (for example: process and review workflow are defined in `.claude/rules/workflow.md`). A reader, and Claude, can find every governing document from this one file. Unmapped unconditional rules and dangling links both deduct. (9)
- Linked, never imported. Rule references are plain backticked mentions; no `@import` of any auto-loaded rules file exists anywhere in the file or its import chain. (5)
- Logically structured. Sections follow a predictable order a reader would guess: what the project is, how to build and test it, core conventions, governing rules, where procedures live (skills), scoped guidance (path rules). Headers and bullets group related content; no grab-bag sections. The order practitioners converge on - overview, stack with versions, non-obvious commands, architecture rules with their why, conventions used and forbidden, testing, git workflow, gotchas, domain terms - is a reference, not a requirement: the official line is 'there is no required format', so order is judged by whether a reader can predict where a fact lives. (9)
- Skills, agents, and docs are routed correctly: procedures point to skills - by name where every install the file ships into guarantees them, by what they cover otherwise - `AGENTS.md` is imported rather than restated where it exists, and README-level detail is referenced rather than copied. (7)

Floor for A: >= 26/30.

## Dimension 3 - Token efficiency (20 pts)

- Every line changes behavior or routes the reader. No project trivia, no narration, no restated documentation, no aspirational filler. Delete-on-sight, not rewrite-on-sight. (8)
- Size is disciplined, measured in tokens: report the file's characters and approximate tokens including the expanded cost of everything it imports, and hold every line to the official test (would removing it cause a mistake?). Report both official measures - the line count against the memory page's 'under 200 lines per file' target and the token cost with imports expanded - since either can fail alone. Oversized files reduce adherence, so size is a correctness problem, not just a cost problem. (6)
- Conditional content is actually conditional, in path-scoped rules or skills. Content moved into an `@path` import still loads at launch and scores nothing here; only real deferral scores. (4)
- Maintainer notes, where useful, sit in block-level HTML comments, which are stripped and therefore free. (2)

Floor for A: >= 17/20.

## Dimension 4 - Reuse and non-duplication (20 pts)

Scored against the duplication map. A file loses points for content it duplicates, even if it reads well alone.

- No rule content is restated. Where a rule file governs a topic, CLAUDE.md carries the link and at most a one-line framing, never a second copy that will drift. (7)
- No procedure is restated that a skill or agent owns; the file points to it - by name where guaranteed, by what it covers otherwise. (5)
- No repo documentation is restated: `AGENTS.md` is imported, README and style guides are referenced. (4)
- Single source of truth across tiers: the same instruction does not appear in both user and project files, or in both a nested and a root file. Each fact lives at exactly one tier, the one whose audience owns it. (4)

Floor for A: >= 17/20.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A file reaches A / 9 only when the total is >= 90 and every dimension clears its floor. This is deliberate: it blocks acing some dimensions and averaging away a weak one. A beautifully lean CLAUDE.md with a wrong build command is not an A file, because that command is executed on trust. A well-written file that leaves the rules layer unmapped is not an A file either, because the instruction layer then has no entry point and every reader has to reverse-engineer which documents govern.
