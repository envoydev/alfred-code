# System audit - Phase 0 discovery

Read at Phase 0. Build every map below before scoring; edit nothing in the repo.

1. **Fix the awareness checklist first,** before any map is read, one per profile from its marker files
   (`scripts/profile-fixture.js` `MARKERS`): the tech the markers name; the build, test and lint commands
   the markers carry (`package.json` scripts, `dotnet build` / `dotnet test` for a project file); the docs
   root; the three locked servers and the navigation rule (find a symbol through the server, never a
   whole-file read); the house do-nots a first turn can break (commit only on the user's word, no
   whole-file read, no secret read by value). Seven to ten facts per profile, written to `RESULTS/checklist.md` now.
2. **Install the fixtures.** One per profile, from this working tree:
   `node scripts/profile-fixture.js <profile> <WORKDIR>` - it exports the tree once, registers the export
   as the stack's marketplace on an isolated account dir, installs with the selection setup would accept
   (the always seed plus the profile's), and prints the map command. A failed install is a finding in its
   own right (the step and its log), and that profile is reported NOT RUN, never scored.
3. **Map each fixture.** The printed command, with `--listing-fraction` read from the skills docs this run
   (the currency row) and `--window <WINDOW>`:
   `HOME=<home> node scripts/session-surface.js <project> --config-dir <account> --run-hooks --listing-fraction <f> --json`.
   Keep each JSON as `RESULTS/maps/<profile>.baseline.json`; the totals, flags and rows are the baseline every later claim is diffed against. Exit
   1 means a hook wrote outside the project: a S4 finding with the path. Read the NOT MEASURED block -
   each line is a known blind spot to state in the report, never to fill by guessing.
4. **Read the before-init gap.** A fresh install has no awareness docs, awareness rule or architecture rule
   yet - `/alfred-code:init` writes them through the capture skills. Read what each will state from its
   shape (`stack/skills/capture-awareness/references/agents.md`, `project.md` and `related-projects.md`, the
   rule's copy target in its `SKILL.md`, and the other `.claude/rules/<name>.md` targets the map lists as
   `generated`), and record per checklist fact whether the fresh install states it, the post-init docs will,
   or neither.
5. **The corpus** (when `CORPUS` is set): `node scripts/analyze-usage.js <CORPUS>` for the rollup - per
   surface its use (skill invocations, seat dispatches, path-rule loads), the re-read counts (the same
   file read in several sessions of one project), reads before the first edit, whole-file `Read`
   blocks. The hook-blocks ledger under the docs root (`hook-blocks/*.jsonl`) for each hook's blocks, and
   per block whether the next call overrode it, retried it unchanged, or changed course. Name the window
   and the denominators.
6. **The conflict map.** Start from every flag the map raised (`shared-event`, `name-shadow`,
   `name-overlap`, `mcp-endpoint`, `injection-overlap`, `dangling`, `listing-budget`) and read both sides
   of each. Then sweep: every directive of every pathless rule and of the seeded AGENTS.md against the
   skills, seats and hook injections that act in the same situation - same tool, same event, same
   decision. Record each pair as `contradicts`, `duplicates`, `collides`, `blocks`, `dangling` or
   `shadows` (the rubric's S1 defines them), with file and line on both sides and the profiles it shows
   in. A pair with a third-party side is recorded with its recommended home and goes to
   `/repo-audit-plugins` as a handoff.
7. **The guard-route map.** For each dangerous action - a secret read, a destructive delete, a
   force-push, a commit without the gate, a write outside the project, a config write - list every tool
   that reaches it in the fixture (the per-tool rows' matchers, the MCP servers' write and shell tools,
   each seat's tool grant from its listing row) and, per route, the deny rule or hook that covers it, or
   none.
8. **The packaging read** (`OWN_PLUGIN_ROOT`): the manifest and its marketplace entry, the layout, every
   component's frontmatter flags, `${CLAUDE_PLUGIN_ROOT}` usage, how the plugin reaches data outside its
   package, the version parity mechanism and the release tag, `claude plugin validate --strict` on the
   plugin AND the marketplace root, `claude --plugin-dir <root> plugin details <name>`, the `evals/`
   directory, and what the README states (install line, what it writes, what the user installs by hand,
   the cost).
