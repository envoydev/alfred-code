# System audit - Phase 0 discovery

Read at Phase 0. Build every map below before scoring; edit nothing in the repo. Each step names the
repo-specific tool it wants generically: use the one a `notes` line names, and where none is named do the step
by hand as described, saying so in the report.

1. **Fix the awareness checklist first,** before any map is read, one per profile from its marker files (the
   markers the profile list a note names; for a `default` install, the plugin's own README and manifest): the
   tech the markers name; the build, test and lint commands the markers carry (`package.json` scripts, `dotnet
   build` / `dotnet test` for a project file); the docs root, where the plugin keeps one; the navigation and tool
   habits the plugin's own rules prescribe (a note lists them); the house do-nots a first turn can break, as the
   plugin's rules state them (for example commit only on the user's word, no secret read by value). Seven to ten
   facts per profile, written to `RESULTS/checklist.md` now. A plugin that by design states no project facts
   (a note says so) fixes the facts it does promise a session - what each of its commands and listed skills is for.
2. **Install the fixtures.** One per profile, from this working tree, with the fixture tool a note names - it
   should export the tree once, register the export as the plugin's marketplace on an isolated account dir, install
   with the selection setup would accept, and print the map command. With none named: register the working tree
   as a local marketplace (or load it with `--plugin-dir`) under an isolated `CLAUDE_CONFIG_DIR` and `HOME` in
   `WORKDIR`, install the plugin, and seed a project with the profile's markers. A failed install is a finding in
   its own right (the step and its log), and that profile is reported NOT RUN, never scored.
3. **Map each fixture.** With the session-surface tool a note names, hooks run, as JSON, the listing fraction
   read from the skills docs this run (the currency row) and `WINDOW` passed where it takes them. By hand: per
   load point - session start, a turn, each agent's dispatch, after compaction, each path rule, the skill and agent
   listings - the file or hook that feeds it, with its characters measured (`wc -c` on a file, the hook's stdout on
   a probe input in the fixture), its owner, and the same flags a tool would raise. Keep each map as
   `RESULTS/maps/<profile>.baseline.json`; the totals, flags and rows are the baseline every later claim is diffed
   against. A hook that wrote outside the project on the probe is a S4 finding with the path (`stray-write`). Read
   the NOT MEASURED block - each line is a known blind spot to state in the report, never to fill by guessing; a
   hand map lists every row it could not measure the same way.
4. **Read the before-init gap.** Where the plugin generates project docs or rules after install (an init step a
   note names, with the templates it fills), a fresh install does not state them yet. Read what each will state
   from its template and the rule targets the map lists as `generated`, and record per checklist fact whether the
   fresh install states it, the post-init docs will, or neither. A plugin with no init step records the fresh
   install only.
5. **The corpus** (when `CORPUS` is set): the usage analyzer a note names, for the rollup - per surface its use
   (skill invocations, agent dispatches, path-rule loads), the re-read counts (the same file read in several
   sessions of one project), reads before the first edit, whole-file `Read` blocks; with none, the same counts
   with `jq` / `grep` over the transcripts. The hook-block ledger a note names, for each hook's blocks, and per
   block whether the next call overrode it, retried it unchanged, or changed course. Name the window and the
   denominators.
6. **The conflict map.** Start from every flag the map raised (`shared-event`, `name-shadow`,
   `name-overlap`, `mcp-endpoint`, `injection-overlap`, `dangling`, `listing-budget`) and read both sides
   of each. Then sweep: every directive of every pathless rule and of any AGENTS.md or CLAUDE.md the plugin
   seeds against the skills, agents and hook injections that act in the same situation - same tool, same
   event, same decision. Record each pair as `contradicts`, `duplicates`, `collides`, `blocks`, `dangling` or
   `shadows` (the rubric's S1 defines them), with file and line on both sides and the profiles it shows
   in. A pair with a third-party side is recorded with its recommended home and goes to
   `/repo-audit-tools` as a handoff.
7. **The guard-route map.** For each dangerous action - a secret read, a destructive delete, a
   force-push, a commit without the gate, a write outside the project, a config write - list every tool
   that reaches it in the fixture (the per-tool rows' matchers, the MCP servers' write and shell tools,
   each agent's tool grant from its listing row) and, per route, the deny rule or hook that covers it, or
   none.
8. **The packaging read** (`OWN_PLUGIN_ROOT`): the manifest and its marketplace entry, the layout, every
   component's frontmatter flags, `${CLAUDE_PLUGIN_ROOT}` usage, how the plugin reaches data outside its
   package, the version parity mechanism and the release tag, `claude plugin validate --strict` on the
   plugin AND the marketplace root, `claude --plugin-dir <root> plugin details <name>`, the `evals/`
   directory, and what the README states (install line, what it writes, what the user installs by hand,
   the cost).
