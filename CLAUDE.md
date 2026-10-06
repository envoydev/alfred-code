# CLAUDE.md - Alfred Code repo

## What this repo is

The single source of truth for the **Claude Code** half of the house coding-agent setup - not an
application. It holds what is applied to *other* projects: house-style skills, the base instruction
template, hook scripts, convention rules, agents, and the installer that wires skills / MCP servers /
plugins into each project. The **Cursor** twin lives in
[`cursor-stack`](https://github.com/envoydev/cursor-stack), a sibling with its OWN skills, agents and
installers (it does not clone this repo, and its lists may diverge).
A change that maps to Cursor is mirrored there in the same sitting. Consuming projects pull from
here; a change made only inside a consuming project is throwaway.

**The goal every change serves: Sonnet at high / xhigh effort, run through this stack, does better
work than Opus at high effort without it.** Skills, rules, hooks, agents, docs structures and scripts
exist to close that gap - pre-digested context, deterministic scripts and hooks doing the navigation
and checking, small pushed slices instead of broad reads. Judge every design by that yardstick: does
it make Sonnet more correct, cheaper or more reliable? A feature that only pays off on Opus, or needs
the model to infer what a script could state, works against the goal. Prove it like any behavioral
change (see the invariants below).

## Layout - one home per concern

The mechanism notes for each part live in a path-scoped rule in `.claude/rules/` and load when you edit its files. Read the named rule before you change that part; it holds the why, the measurements and the edge cases this file leaves out.

- `stack/skills/` (library skills, each copied per pick), `stack/agents/` (44 seats in the core plugin), `stack/rules/` (twenty shipped rules) and `stack/AGENTS.template.md` (the per-project instruction skeleton): `repo-catalog.md`.
- `stack/hooks/` - eighteen hooks folded into the core `alfred-code` plugin, generated from the manifest's `hooks[]`: `repo-hooks.md`.
- `scripts/install/` - THE INSTALLER, the ONLY route, one `node` command on every OS - and `setup-plugin/`, the seven commands and the router skill. The delivery-surfaces table, the install stamp and the snapshot gotchas are there too: `repo-installer.md`.
- `stack/mcp/` and the generated MCP plugin entries (one plugin, one server, same name): `repo-mcp.md`.
- Memory levels, the docs root, the data root and the two stores: `repo-memory-data.md`.
- `meta/` (never installed) and the repo scripts (`lint-skills.js`, `analyze-usage.js`, `scan-evidence.js`): `repo-meta.md`.
- `docs/` holds the browser inventory `docs/alfred-code.html` and the evidence files; `assets/` the logo and banner.

**Three locked MCP servers** - `alfred-navigation`, `alfred-documentation`, `alfred-memory` (2.2.0; `navigation` / `documentation` / `memory` before) - are in every install and may be named in artifacts; every other server is droppable, so a body describes it. **Never `Read` a whole file to find a symbol**: locate it through the navigation server (`find_symbol` / `find_referencing_symbols`) or the LSP; `Read` is for code already located.

## Working in THIS repo - invariants

- **`develop` is where work lands; `main` is the release branch.** Merging `develop` -> `main` IS the
  release: the workflow rebuilds the archive and tags `v<version>` from
  `setup-plugin/.claude-plugin/plugin.json`. Bump it (plus `marketplace.json` metadata and `package.json`; lint enforces
  equality) on `develop` with any release-worthy change - a merge that reuses a version whose tag names another
  commit FAILS the release job (2.1.5 M27; only a manual run with `replace_tag` moves it). Never commit feature work to `main`; keep `main`
  the GitHub default branch. Lint + test workflows gate every push and PR.
- **Public repo.** No private project names or absolute local paths in tracked files.
- **The 1.x name is retired, never reused.** Its spellings (`CLAUDE_STACK_*`, the older <!-- legacy-name -->
  `CLAUDE_DOCS_PATH`, `claude-stack.stamp`, the marketplace key, the plugin cache dir, <!-- legacy-name -->
  `Agent(claude-stack:<seat>)`) are READ for the whole 2.x line by legacy readers; the new spelling <!-- legacy-name -->
  wins when both exist. Lint check 57 fails on any other 1.x spelling in a tracked file: a reader's
  line carries the word `legacy-name` in a comment (`<!-- legacy-name -->` in markdown, `//` or `#`
  in code), and only history (`docs/*-evidence.md`, `meta/migrations.json`,
  `meta/retired-entries.json`), the marketplace's generated `plugins[]` and the retired entry names
  pass unmarked. Anything NEW is `alfred-code` / `ALFRED_CODE_` from day one.
- **The repo root is a plugin source, so twelve names are RESERVED there.** Every marketplace entry
  shares this root as its `source` and lists the paths it ships, but a shared root is auto-discovered
  whatever an entry lists (measured, spike S9c in `docs/plugin-migration-evidence.md`): a root
  `agents/` or `commands/` loads once PER ENTRY, a root `.mcp.json` or `hooks/hooks.json` loads once
  and is attributed to a different entry each time. So `skills/`, `commands/`, `agents/`,
  `hooks/hooks.json`, `monitors/`, `settings.json` and `.lsp.json` never appear at the root, nor the other
  default locations the plugin reference names - `bin/` (it would sit on every entry's Bash PATH),
  `output-styles/`, `workflows/`, `themes/` and a root `SKILL.md` (a single-skill plugin) (lint
  check 46), and hooks and MCP servers are declared INLINE in each entry instead. `.mcp.json` is the
  one exception, because this repo is also a consuming project: it stays machine-local and
  gitignored, and the temp-project matrix installs from `scripts/clean-export.js` so it cannot leak
  into a case.
- **Parity / source-of-truth.** Behaviour lands only in `scripts/install/`, the one route.
  `meta/stack-manifest.json` is hand-edited and carries the six lists the seed reads (`npm run lint`
  holds it to disk, the HTML and the skill count). A shared baseline change is mirrored into
  cursor-stack in the same sitting. Never patch only a generated `.mcp.json` or a consuming
  project's copy - the installer wipes it.
- **Select a skill by DESCRIPTION, not by name.** Naming works only for a skill guaranteed alongside its
  citer (a frontmatter preload, an own-stack skill). Anything else - a skill no stack seeds, or one from a
  DIFFERENT stack - is described by what it covers. A guard phrase beside the name is not the remedy.
  Lint checks 25 and 26 block a named cite that can be absent; a router hub opts out with an
  `**Availability**` callout. Naming a skill never installs it: `suggests:` is removed (check 27) and the
  graph emits no body-mention edge. Install need is PROVEN via `meta/evidence.json`, a per-stack seed, or
  a server that brings the skill: a manifest `mcps[].skills` row is the graph's one edge back at a skill
  (`graph.mcps`), so the skill arrives with its server, a configure drop cascades both ways, and update
  never offers it alone.
- **One home per piece, no duplication.** A deterministic gate -> a hook. A per-file-type convention -> a
  path-scoped rule attaching its skill. A keyword capability -> the skill's description. Cross-cutting
  guidance -> the always-on `alfred-*.md` set (each with an `.mdc` twin in cursor-stack to mirror). The
  base template carries only per-project structure + platform routing. Never state one trigger twice.
- **Prove a behavioral change, don't assert it.** A model / effort pin, routing rule or plugin-set change
  ships only with evidence: run the build + tests yourself and read the code, measure the token delta when
  the claim is about cost, and commit the evidence BEFORE any reset. Verify outside-world claims
  (package, version, API shape, CLI flag) through the documentation server in the same sitting and cite it.
- **Every change is proven on a TEMP PROJECT before it is committed - MANDATORY, no exceptions.** Unit
  tests and a green `npm run lint` / `npm test` are necessary, never sufficient. Each change or feature
  (installer, hook, command, skill, rule, agent, MCP, manifest - a one-line or prose-only edit included)
  is exercised end to end from THIS working tree (`--source <repo>`) inside throwaway projects created
  under the session scratchpad (or `os.tmpdir()`), never a real consuming project, and removed after.
  - Edge cases are REQUIRED, not optional: a fresh install; an update over an older install; a re-run
    (idempotent - a second run changes nothing); a project holding the user's own config the change must
    not clobber (hand-added MCP server, settings key, hook); missing, empty or malformed input (absent
    file, garbage JSON, unset env); every scope the change touches (`project`, `user`, `local`); and
    every boundary the change introduces (at, one under, one over).
  - Read the RESULT, never the exit code alone: open the written `.mcp.json` / `settings.json` / copied
    files and hook output, and assert they are what the change claims.
  - A bug found blocks the commit AND the release: fix it, add a regression test, re-run the whole
    temp-project matrix. A case not run is reported as NOT RUN, never implied as passing. No 'done',
    commit, version bump or `develop` -> `main` merge until the matrix is green and its commands plus
    results are in the report.
- **House voice:** direct, lean, single dashes not em-dashes, single quotes in prose, recommend one
  option with a reason. Lint check 32 sweeps `stack/`, `setup-plugin/`, `meta/` for em-dashes, and
  those plus `scripts/` for characters nobody can see (zero-width, bidi, a BOM past byte 0 outside a
  `.ps1`, the tag block) - write one as an escape. A joiner or direction mark a script needs is text:
  a ZWJ between two emoji parts or two non-ASCII letters, a ZWNJ between two non-ASCII letters, an
  LRM / RLM / Arabic letter mark (U+061C) beside one.
- **The always-on surface has a BUDGET.** Lint check 33 (`scripts/always-on-surface.js`) sums what the model is sent - the pathless
  `alfred-*.md` rules as injected (frontmatter and HTML comments stripped), every agent DESCRIPTION,
  every skill DESCRIPTION plus `when_to_use` (a `disable-model-invocation` skill's is not in context, so
  its description is skipped), and the fixed text every generated capabilities rule carries (the usage
  policy and the locked-server row) - prints each part, and fails over 70,000 chars (lowered from 160,000
  on 2026-09-29, about 40% over the measured total; 50,007 on 2026-10-06 (2.1.7): pathless rules 23,759, agent
  descriptions 12,532, skill descriptions 11,886 with 13 manual-only skipped, capabilities fixed text
  1,830 - the pilot-3 trim cut each rule clause to its imperative plus a one-line reason, the stories
  moving to `docs/baseline-rules-evidence.md`, and the 2.1.2 cap below cut the skill descriptions from
  50,719; the whole-file count it replaced read 51,473 and missed the generated rule). A rule moved into the
  baseline set or a grown description is costed against it. `/alfred-code:status` reports an install's
  own floor. An AGENT description is capped at 300 chars (check 15b): the 'Use when...' sentence and its
  'Do NOT use' (or 'Not for') clause, the rest in the agent's ONE `## Scope` body section (both held by 15b since
  2.1.5, M55) - the dispatcher's listing carries
  every enabled seat's description in every session's first call. A SKILL description (plus any
  `when_to_use`) is capped at 160 chars (check 15c): 'Use when' / 'Load when' with the strongest trigger
  phrases and at most one short 'Not for', the rest in the body's `## When to use` section. Claude Code
  lists every model-invocable skill's description on every turn inside ONE budget that scales with the
  context window, and past it drops the least-used skills' descriptions whole
  (<https://code.claude.com/docs/en/skills> - read the figure at use, never pin it here). Measured on a
  TypeScript install, 200K window, Claude Code 2.1.284: '39 skills, 19901 chars > 8000 budget' before the cap,
  '39 skills, 10781 chars' after it (the drop is exactly the 9,120 chars the stack's 24 listed descriptions
  lost) - the stack's share now ~4.3K, the other 15 entries (~6.5K) not the stack's to trim. The authoring
  method is `habits-skill-writing`.

## Maintenance gotchas

- Editing a consuming project's installed copy is local-only; mirror it into `scripts/install/` here
  (and into cursor-stack when it touches the shared baseline or a twinned agent/rule).
- Authoring a skill in `stack/skills/`: the method is `habits-skill-writing` (the
  `skill-authoring.md` rule loads it; its A/B is `scripts/skill-comply.js`); on top of it here - the
  parity lint, HTML + count sync, house voice. A stop's question is written as an ASK TEMPLATE - a
  fenced `ask` block, the question on its first line, then one `- '<label>' - <why>` line per option -
  and lint check 61 fails one that marks no option `(Recommended)`, or two, or lists the marked one anywhere
  but first (a label runs to its last quote before ` - `, so an apostrophe stays in it); the three flow skills
  (`task-solve`, `-cross`, `issue-diagnoser`) carry theirs in SKILL.md at a count pinned in
  `ASK_FLOW_TEMPLATES`, so one stop dropped back to prose goes red (pilot 3: 18 of 40 flow asks had no mark,
  and the approver took the first option each time). The setup / configure walk's layer asks are templates too (`setup-plugin/references/walk.md` and `commands/setup.md`, pinned in `SETUP_ASK_TEMPLATES`): each layer's first ask is a single-select (keep the marked rows / pick / add every / only the locked rows) and 'Pick' opens ONE call of up to 4 multi-select questions grouped from the table's own labels, so no per-row change is typed.
- Skills are shared with Cursor: a skill body stays platform-neutral (conditionals like 'INLINE when no
  dispatch'), never forked per platform.
