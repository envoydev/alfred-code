# System audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the map row, the file and line, or the corpus row that justifies it.

Two grades, 100 points each, the band table below. The SYSTEM grade is scored per profile on S1-S5 and is the lowest profile's: the weakest install a user can get is the stack's grade. A dimension below its floor caps that profile at B whatever the total. The PACKAGING grade is scored once.

## System grade - S1-S5 per profile

**S1 - Coherence (30 pts, floor 18).** Scored from the Phase 0 conflict map, both sides quoted. The relations:

- `contradicts` - two parts tell the model opposite things for the same situation (a rule says ask, a skill step says proceed; a hook's injection says one cap, a rule another). MATERIAL: fails the floor while it stands.
- `blocks` - a hook or deny rule refuses a step a skill, flow or seat requires, with no receipt or escape the flow can take. MATERIAL: fails the floor while it stands.
- `duplicates` - two homes for one job (the repo's one-home invariant): a rule restating a skill's procedure, a hook re-injecting a rule, two seats or two skills for the same task, a third-party plugin doing a house artifact's job.
- `collides` - a shared trigger phrase between two listed skills, or the same event and matcher wired by two owners with overlapping jobs (the map's `shared-event` rows) where the combined cost or the order between them is unmeasured.
- `dangling` - a cite to a skill, seat, tool or server this profile does not install (a pathless rule naming an absent skill, a seat's tool grant naming a server the profile lacks, an enabled plugin missing from the cache).
- `shadows` - an injection repeating a rule's or memory file's text (the map's `injection-overlap` rows), a bare name shadowing a namespaced one (`name-shadow`), or two namespaces sharing a bare command name (`name-overlap`), paid or confused twice.

Deduct per standing row by its reach: one profile, several, every profile.

**S2 - Tokens (20 pts, floor 12).** Overuse and underuse, both from evidence.

- Overuse: the session-start total by owner; the skill listing against its budget for `WINDOW` (over it, the least-used descriptions are dropped whole - a listed skill that silently loses its trigger); the recurring per-turn injection (`a turn`, paid on every prompt); the biggest dispatch; after compaction; dead weight - a surface the corpus shows unused over a window of four weeks or more with no load-bearing citer.
- Underuse: the corpus shows the same project file read in several sessions where a rule or AGENTS.md could state its fact, broad reads before the first edit, whole-file `Read` blocks, a path rule that never loads because its glob misses the profile's files.

Cost is judged against measured use: an expensive surface the sessions use fully scores; a cheap unused one still loses. Without `CORPUS` the dimension scores the overuse side only and says so.

**S3 - Hooks (15 pts, floor 9).** The hooks as a set, per profile.

- Cost: per event, the summed latency of its hooks on the probe and the timeout exposure (an untimed hook runs on the 600-second default); the combined injection per turn and per dispatch; the hooks bound to events that fire without a prompt.
- Value against harm, from the ledger: each block split into prevented harm, a false block (the next call overrode it or a person did), a retry unchanged, or a legitimate flow step denied. A deny-then-retry loop in the corpus is harm.
- A defect inside one hook's contract (its exit codes, its matcher, its message) is a handoff to `/repo-audit-hooks`.

**S4 - Safety (20 pts, floor 14).** Scored from the guard-route map. Every route to each dangerous action covered by a deny rule or a hook: Bash, PowerShell and Monitor alike; Read, Grep and an MCP read alike; Write, Edit, NotebookEdit and an MCP edit tool alike; the main session and every seat that holds the tool. A hook that wrote outside the project on the probe (the map's `stray-write`) is a gap. A reachable secret read or exfiltration, or a reachable destructive delete or force-push with no guard on that route, is a BLOCKER: it blocks every profile from A whatever the totals.

**S5 - Awareness (15 pts, floor 9).** Scored from the checklist fixed before the maps were read. Per fact: stated at session start in this install (the row that states it), stated after init by a generated rule (its template slot), or missing. The essentials come back after compaction (the `compaction` rows). The path rules reach the profile's own file types. With `CORPUS`: the exploratory reads before the first edit in real sessions of that stack. A missing house do-not (commit, whole-file read, secret read) costs more than a missing command.

## Packaging grade - the stack's own plugin

Today's own-plugin rubric, moved here from the plugin audit unchanged: the same five dimensions, 100 points, the same bands and floors.

**A1 - Manifest and layout (15 pts, floor 10).** `name` kebab-case; `author` an object; component paths relative, starting `./`, no `../`; the path fields understood (`commands`, `agents`, `outputStyles`, `workflows` and the `experimental.*` paths REPLACE their default folder, `skills` ADDS, `hooks` / `mcpServers` / `lspServers` MERGE with the default file, which loads first - an enumerated `commands` list means a new file in `commands/` loads nowhere until listed); only `plugin.json` inside `.claude-plugin/`; no `CLAUDE.md` at the root (not loaded); `version` in ONE place (plugin.json wins over the marketplace entry, and validate warns on the pair; where the source holds no plugin.json the entry IS the manifest and its `version` is the one home).

**A2 - Component fit (25 pts, floor 15).** Each entry's type justified by what the user sees and who may invoke it (a plugin command lists namespaced-only, a plugin skill named like the plugin lists bare); side-effect entries carry `disable-model-invocation: true`; `allowed-tools` absent or justified as the one-turn pre-approval it is; references reached through `${CLAUDE_PLUGIN_ROOT}`; data outside the package reached by a documented route; state never written under `${CLAUDE_PLUGIN_ROOT}` (`${CLAUDE_PLUGIN_DATA}` persists across updates); plugin agents free of `hooks`, `mcpServers`, `permissionMode`. The root side of fit: every child a house artifact depends on is seeded wherever that artifact installs (the install closures prove it), the route to each child is by description or by a name the closure guarantees, and the root declares its children in one place the lint reads.

**A3 - Distribution and versioning (20 pts, floor 12).** Parity between plugin.json and the marketplace enforced mechanically; the release tag cut from that field; the marketplace entry's source relative or SHA-pinned; a rename handled the way this repo decided: no `renames` key (it strands an install - `docs/plugin-cli-evidence.md` S11, S16; lint check 49 fails on one), the old id kept LISTED as a retired alias carrying its successor (an unlisted entry still enabled silently stops loading, S25) until evidence shows no install resolves through it; the third-party auto-update default acknowledged - the plugin's own update path is what delivers a release; cache orphans understood (a replaced version is swept about 14 days later; a machine carrying many versions is a check, not a defect).

**A4 - Verification and cost (25 pts, floor 15).** `claude plugin validate --strict` on the plugin and the marketplace root - manifest evidence only (measured 2026-09-26 on 2.1.282: a plugin root holding an agent with broken YAML frontmatter still passed, and against a marketplace root it opens no component file), so the component frontmatter is proven by the repo's own lint or it is unproven; the `details` number read with its caveats and the REAL always-on computed (the descriptions the model can see); `claude plugin eval` (2.1.269 and later) with the with / without delta recorded. It does NOT need a model-invocable component: an eval case's `prompt.md` is a USER turn, which is precisely how a `disable-model-invocation` command is invoked, so a read-only walk is a valid case whose without-arm cannot resolve the command at all and therefore yields a clean delta. 'Nothing here is model-invocable' is not a reason to skip it. A substitute (the repo's tests and lint) is named only where the walks all mutate a real install, and the reason is stated; every behaviour claim about the plugin carried by a measurement.

**A5 - Security and governance (15 pts, floor 10).** Hooks, MCP servers, dependencies and `bin/` absent or reviewed; the README states what the plugin writes, what it starts, what the user must install, and the measured cost; the managed-settings fit stated.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A profile reaches A / 9 only when its total is 90 or more and every dimension clears its floor. A standing `contradicts` or `blocks` row blocks BOTH parts it joins from A in every profile it appears in, and a S4 BLOCKER blocks every profile.
