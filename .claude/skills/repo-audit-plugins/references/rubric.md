# Plugin audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

One rubric, 100 points per consumed plugin and per dependency in its closure. Every point cites its evidence. Map totals to grades with the band table; a dimension below its floor caps the grade at B whatever the total.

## The rubric - a consumed plugin or a dependency

A dependency is scored on the same five dimensions, read through its parent where the parent is what puts it on the machine: D1 use is the parent's use (a dependency the parent needs is load-bearing for it - say which component calls it), D4 placement is the parent's seed and scope, and D3 and D5 are its own, read from its own cache copy.

**D1 - Earned use (25 pts, floor 12).** Measured use over the corpus window, with denominators (sessions installed / sessions used / calls, from the analyzer's rows); the harness's 'Not used recently' state where readable; for a hooks-only plugin, its output observed (the grep shape named); for an LSP plugin, diagnostics delivered. A plugin the house artifacts depend on by name earns use through those citers even at a low direct count - say so and list them. Zero measured use across a window of four weeks or more, with no load-bearing citer, scores 10 or below.

**D2 - Context and runtime cost (15 pts, floor 8).** The `details` always-on and on-invoke numbers, read with the two caveats above; skill count and description lengths against the 1,536-character listing truncation; MCP servers (deferred or not, how many schemas); an LSP server's binary requirement and memory; every `command` hook's `timeout` (none means the 600-second default); the events its hooks bind, with the ones that fire without any prompt or tool call named (`SessionStart`, `SessionEnd`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `Notification`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop` among them). Cost is judged against D1: a cheap unused plugin still loses in D1; an expensive used one scores full here when the cost is proportional to what it delivers.

**D3 - Supply chain and security (30 pts, floor 20).** Source tier; pin form (an explicit `version` in plugin.json means updates only on a bump, its absence means every source commit is an update; a marketplace entry `sha` for git sources); auto-update state (official Anthropic marketplaces default ON, so a curated plugin moves under the user with no stack action; third-party and local marketplaces default OFF, so the stack's `update` is the only mover unless the user or an admin toggled it); hooks read line by line - network egress, a credential read, a write to any `settings*.json`, a permission rewrite is a BLOCKER; MCP endpoints and credential handling (`userConfig` `sensitive` entries or the account settings `env`, never a literal); `bin/` and monitors; Node dependencies with a lockfile (installed with `--ignore-scripts`); `claude plugin validate --strict` passes. Validate checks structure and never safety; it earns no security point by itself.

**D4 - Placement and governance (10 pts, floor 5).** Scope matches audience (project scope for what a team shares, user scope for a personal surface such as a status line); seed placement (`always`, per-stack, or opt-in in `general`) proven by the same evidence rule the skills use, never by assumption; the `plugin-settings.json` row's `verified` version equals the installed version; manifest, HTML and README agree (the lint); a retirement path exists; the managed-settings fit is stated (which `strictKnownMarketplaces` entries an organisation would need for this plugin to install).

**D5 - Fit with the root (20 pts, floor 12).** Scored from the Phase 0 fit map, both sides quoted. No `contradicts` row left standing (a child telling the model the opposite of a house rule for the same situation is a MATERIAL defect: the rule loses or the child loses, never both live). No `duplicates` row without a chosen home (a child doing a house skill's, agent's or hook's job either replaces that artifact or is dropped - record which and why). No `collides` row unresolved (a shared trigger gets a negative trigger on the house side or the child is dropped; a doubled event is kept only when the two jobs differ and the combined cost is measured). Every `cited` row resolves in the installed version (a house artifact naming a child skill that the child's current version no longer ships is a broken route). Child agents respect the explicit-dispatch policy; child side-effect skills carry the user-only flag or the house gate covers them. A child with no relation at all is not a defect here - it is scored in D1.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A plugin reaches A / 9 only when the total is 90 or more and every dimension clears its floor. A dependency's D3 BLOCKER is its parent's too - the parent cannot be installed without it. A D3 BLOCKER in any consumed plugin blocks the WHOLE consumed set from A until that plugin is dropped or replaced - one hook that exfiltrates makes the rest of the set's score meaningless. A duplicate home is a set-level defect too: both artifacts are blocked from A until one home is chosen. So is a `contradicts` row: the child and the house rule it contradicts are both blocked until one of them changes, and a broken `cited` route blocks the citing house artifact as well as the child.
