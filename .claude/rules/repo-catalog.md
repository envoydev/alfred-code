---
paths:
  - "stack/skills/**"
  - "stack/agents/**"
  - "stack/rules/**"
  - "stack/AGENTS.template.md"
  - "stack/skills/**/SKILL.md"
---

# Catalog items - skills, agents, rules, the AGENTS template

How the skills, the 44 agents, the shipped rules and the per-project AGENTS template are delivered and held to each other. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- `stack/skills/` - the house-style skills (`SKILL.md` each), auto-activating on their keywords /
  file types. Every one is LIBRARY (2.1.0) - listed by no marketplace entry, copied into
  `.claude/skills` per pick, the always ones included (locked: adopted by every update, a drop
  refused; `skillOverrides` is the per-project lever, and `library-check.js` flags a `blocked` row where
  one set `off` or `user-invocable-only` hits a skill a shipped rule still sends the model to - 2.1.5 audit
  M75) - and every rule is a library copy in
  `.claude/rules` the same way (`scripts/install/library.js`, each copy's hash in the stamp), because a
  plugin skill is locked on and only a project copy can be switched off per project (measured, the
  2026-09-24 library test). `scripts/library-check.js` reports drift and staleness for validate and
  status. A folder already under a catalog skill name that the stamp does not record (a library hash or a
  pick), whose name a project uses too and whose SKILL.md heading (frontmatter `name` + `description`) is not
  the stack's, is the project's own (M3): never overwritten, pruned, dropped or read back as a pick - named
  once with `!!` where it was picked, and left out of the stamp. The core's SessionStart line
  (`setup-plugin/hooks/library-stamp.js`) says when the copies
  are older than the stack - and, for a stamp from before 2.1.0 (no `seats-route:`) under a core at or
  past it, that the skills and seat denies wait for `/alfred-code:update` (the skew window: the core
  updates itself, the copies do not). `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` restores the 0.2.x copy
  route, which since 2.1.0 moves only the SEATS (copied into `.claude/agents`); with the core still on
  there, the seats it lists beside the copies are denied the same way.

- `stack/AGENTS.template.md` - the stack-neutral per-project skeleton a consuming project's
  `AGENTS.md` is filled in from (seeded to `.claude/AGENTS.md`, only when the project has no AGENTS.md or CLAUDE.md; a root
  AGENTS.md the project owns is checked and improved in place, never overwritten; an unedited `.claude/CLAUDE.md` an
  earlier release seeded is moved by `update`, an edited one named with its `mv` command; Claude Code reads AGENTS.md
  natively from 2.1.277, and only while no CLAUDE.md or CLAUDE.local.md sits beside or above it). Conventions ship separately in `stack/rules/*-conventions.md`. Its
  authoring outline (Setup and Key files among it) and keep-out list say WHAT an AGENTS.md holds; the
  always-on `habits-adjust-agents-md` skill is HOW, the one home of the fill (create, or improve with
  every change shown first, a separate part getting its own `<part>/AGENTS.md`) - `/alfred-code:init`,
  `update` and `configure` follow it inline; and `scripts/agents-md-check.js` (AGENTS.md and any CLAUDE.md the project keeps) is the verdict it closes
  on: every named path exists, every command's program resolves on PATH or in the project, no
  placeholder, `TODO` or template text is left, and an installer seed still unfilled is named
  (`--list` marks it). Validate runs the check for drift. Its rows are heuristic (measured 2026-09-26
  over four real projects: 39 rows with 1 true, 7 rows once the shapes behind the rest were fixed), so
  no ask marks a check-driven fix recommended - the skill offers each one and the user picks.

- `stack/agents/` - 44 subagents, all in the core plugin (2.1.0), each one the selection did not pick
  denied as `Agent(alfred-code:<seat>)` (a seat whose preloaded skills were not copied is never picked);
  their `skills:` preloads are BARE - the project copy (`npm run scope-preloads`, lint check 50;
  plugin-migration-evidence S6 measured a plugin seat's bare preload load the project copy). A plugin
  seat answers only to `alfred-code:<seat>` (spike S1: a bare name is 'Agent type not found'), so every
  body that dispatches a named seat says to dispatch it exactly as the roster spells it (pinned as
  `seat-dispatch-spelling`; `scripts/seat-dispatch-spelling.test.js` fails a new site without it):
  - resolvers: `dotnet-build-error-resolver`, `dotnet-test-failure-resolver`, `ng-build-error-resolver`,
    `angular-test-resolver`;
  - cross-cutting: `issue-diagnoser-ci`, `issue-diagnoser-runtime`, `security-auditor` (read-only
    OWASP/CWE posture audit), `integration-reviewer` (mandatory read-only cross-domain final gate
    against the frozen contract);
  - 30 per-domain seats - `<stack>-solution-designer` -> `<stack>-implementer` -> `<stack>-verifier`
    across 10 stacks (ASP.NET, web Angular, WPF, WinForms, console, Windows Service, Ionic Angular, data,
    DevOps, browser extension);
  - six read-only support seats: `evidence-gatherer`, `test-coverage-analyzer`,
    `architecture-analyzer`, `code-quality-analyzer`, `code-style-analyzer`, `related-project-analyzer`.
  Every seat that judges or writes code holds `mcp__plugin_alfred-documentation_alfred-documentation__*` (alfred-quality-gates
  sends its outside-world claims there); the five read-only gatherers do not. A seat reports through
  SubagentHandback when its tools include it, else its last message (`verifier-memory-before-report`);
  `scripts/seat-grants.test.js` holds the grants. For the 2.x line the nine seats the retired 1.x core alias
  carries also grant (and deny) the OLD spelling of each renamed server they hold - `serena`, `context7`,
  `playwright-<engine>` - because those alias ids still serve their successor's server under the old name to an
  install not yet updated (2.1.5 M35); an absent server's tool is inert, and check 59 allows an alias spelling on a
  seat's `tools:` / `disallowedTools:` line only.
  Pins: resolvers `sonnet`/`high`, designers `opus`/`xhigh`, verifiers `sonnet`/`xhigh`, implementers
  `sonnet`/`medium`, support seats `sonnet`, and three read-only reasoners on `opus` - `issue-diagnoser-ci`
  `high`, `issue-diagnoser-runtime` and `security-auditor` `xhigh` (the reasons, and the A/B they still lack, in
  `stack/skills/task-solve-cross/references/model-routing.md`). Turn caps (`maxTurns`, 2.1.6 M59 - a runaway
  backstop at twice the most turns measured for the seat's kind over 802 local subagent transcripts, rounded up to
  the next 50; at the cap Claude Code returns the output marked partial (2.1.246+), with no closing status line, which
  every orchestrator routes as a seat death - one scoped re-dispatch, then BLOCKED to the user, pinned as
  `seat-statusless-return`): implementers 250 (max seen 116), verifiers
  350 (152), `architecture-analyzer` 100 (30), and the four resolvers the implementers' 250 (one run seen) since an
  until-green loop is the runaway the cap is for; every other seat had too few runs, so none. Lint check 15d fails a
  seat with a `## Loop` section and no cap. Captures are deliberate-only
  (`capture-architecture` writes `architecture/ARCHITECTURE.md` and
  `alfred-project-architecture.md`; the findings go to `capture-architecture-quality`
  (`quality/ASSESSMENT.md`), the code's to `capture-code-quality` (`quality/CODE-ASSESSMENT.md`), and the
  run book to `capture-project-capabilities` (`project-capabilities/PROJECT-CAPABILITIES.md` and
  `alfred-project-run-book.md` - how to build, start, reach, log into and hand-check the app, which the
  ten verifiers, `issue-diagnoser-runtime`, `evidence-gatherer` and `integration-reviewer` read
  before they run it, pinned as `run-book-read-first`); never in a build flow).
  `task-solve-cross` is the single entry-point orchestrator (single-stack vertical per
  `references/domain-trio-protocol.md`; cross-domain runs freeze the contract and end at
  `integration-reviewer`; two tasks sharing a directory run as `isolation: "worktree"` seats, which
  branch from HEAD because the installer seeds `worktree.baseRef: "head"` add-only, and fan in as an
  uncommitted `git apply`). cursor-stack shipped twins of all 44 before this rebrand and is PENDING
  the same rename while its mirror is paused - a protocol change here usually needs the same edit
  there once it resumes (divergences only: `model: inherit`, no `tools:` allowlist, no auto-delegation
  hard-disable).
- `stack/rules/` - twenty single-job rules, each a library copy in `.claude/rules/`. Seven always-on `alfred-*.md`
  (no `paths:`): interaction, quality-gates, security, git (the commit checkpoint itself is the
  `habits-commit-checkpoint` skill), navigation, docs-root (`ALFRED_CODE_DOCS_PATH` is the ONLY lever the
  hooks read, default `.alfred/docs`, written by the installer as `<data root>/docs`; it stamps its value over
  `__DOCS_ROOT__` on every run),
  memory (what belongs in the shared `memory` MCP, when to save it, and to search before asking or
  reading - locks the server in the way `alfred-navigation` locks the navigation server).
  Skill/agent usage policy + MCP routing live in the GENERATED `alfred-project-agent-capabilities.md`.
  Thirteen path-scoped: `markdown-docs.md`, `skill-authoring.md`, the repair routers
  (`dotnet-repair-agents.md`, `angular-repair-agents.md`) and nine convention rules, each
  glob-attaching ONE file family to its house-style skill. Every convention rule uses the imperative form pinned as
  `convention-rule-first-action` in shared-rules.json, and the load receipt pinned as `convention-rule-load-receipt`
  in the same eleven files (`scripts/rule-prose.test.js` fails a mismatch) - a new one copies both, never paraphrases them.
  The `baseline-` prefix is retired (2.1.6, the user's ruling): the seven shipped rules and the generated
  `project-*` ones are `alfred-*` (`alfred-git`, `alfred-project-run-book`, ...), and `baseline-*` names live only in
  `retired.rules`, `renamed.rules`, the migration code and its tests, and the `docs/*-evidence.md` history. An update over
  an older install prunes the seven old library copies by the `retired` list (the existing policy: by name, hand-edited
  or not, one `rule pruned (retired upstream)` line each) and writes the new ones; the disk read-back maps a leftover old
  name to the new one through `renamed.rules` (`selection.renameLines`), so no `not found in the stack source` note. The four generated files
  (`agent-capabilities`, `related-context`, `architecture`, `run-book`) are MOVED with their content kept
  (`selection.moveGeneratedRules`, before the docs-root re-stamp) because their captures never re-run by themselves - a
  file already there under the new name wins and the old one is named; `meta/migrations.json` is not the route, its file
  entries are remove-only and applied by the update command. Readers that outlive the update carry both names for
  the 2.x line (`memory.js` related-projects, the preflight's policy-rev row). A new rule is named `alfred-<job>.md`.
