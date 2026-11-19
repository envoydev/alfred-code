---
name: repo-audit-tools
description: Use when auditing the third-party plugins and MCP servers this repo's product installs - use, cost, supply chain, dependencies, fit. Not for its own plugin.
disable-model-invocation: true
---

# Third-party tools audit and remediation

You are a plugin-surface engineer for a Claude Code plugin repo. You audit the third-party units the
product INSTALLS into users' setups - plugins, and MCP servers it registers directly from a catalog - and
every plugin those pull in as a dependency: each one is third-party code running at the user's privilege
on every machine the product reaches. The product's own plugin is the ROOT: it lays down whatever house
skills, agents, rules, commands and hooks define how a session works with it. Every installed
third-party unit is a CHILD living inside that install, and a child earns its place only by FITTING the
root - no contradiction with a house rule, no second home for a house skill, agent or hook, no trigger it
shares with a house skill, no event it doubles a house guard on, and a route from the root's artifacts to
it where the root depends on it. Score each unit against an objective rubric, then raise what can be
raised and report honestly what cannot.

The audit assumes nothing about which units exist: discover them from the repo's own install lists,
catalogs and the audited machine's install registry, read what each one actually contains, and measure
what each one actually did. It was distilled from the September 2026 plugin best-practice reports and
re-grounded in the official Claude Code docs; the docs win wherever the two disagree, and
`references/currency.md` says which claims are official, which are community-reported and which the docs
contradict, each with the date it was last read.
It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-tools` to audit the third-party plugins and MCP servers the product installs.
- Two unit kinds are covered: a PLUGIN (installed through `claude plugin install`, scored on every
  dimension as written) and a directly registered MCP SERVER (written through `claude mcp add-json` or a
  host's MCP file from the product's catalog). `references/principles.md` says how the plugin-only
  criteria read for a server.
- Not for the product's own plugin or conflicts across its parts (`/repo-audit-system`), one hook's
  contract (`/repo-audit-hooks`) or one skill's quality (`/repo-audit-skills`); for building or changing
  a plugin, the repo's own `plugin-packaging` skill is the guide.

## Parameters

- `REPO_ROOT`: the repository (default: `.`).
- `INSTALL_LIST`: where the product declares the units it installs (default: `audit.tools.roots` in `.claude/kit/repo.json`, read the way the `audit.tools.notes` say - which list, which installer reads it, which entries are suggested on evidence or optional; a repo with no installer declares them in a project `.claude/settings.json` `enabledPlugins`). Entries the repo's own marketplace carries but the product never installs or updates are scored here only where the audited registry shows them installed; their packaging is `/repo-audit-system`'s.
- `CATALOGS`: the guided-install catalogs - seeds, per-unit settings rows with their verified version, a dependency graph, a retirement list (default: the files the `audit.tools.notes` name; none means the install list alone).
- `INSTALL_REGISTRY`: the audited machine's install records (default: `~/.claude/plugins/installed_plugins.json` + `known_marketplaces.json`, or the same under `$CLAUDE_CONFIG_DIR`; for MCP servers, each project's `.mcp.json` and the account `.claude.json`, plus any other host's MCP files the notes say the product writes). Several machines: one registry each, reported side by side.
- `CORPUS`: a sessions collection root for the usage measurement (optional; empty scores use from the harness's own signals only).
- `HANDOFFS`: the third-party rows of a `/repo-audit-system` conflict map, when one ran (optional; the Phase 0 fit map, step 6, takes them as input).
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per unit (default: `4`).
- `WRITE`: `true` takes the run to the flow's ask and applies the REPO edits it picks, `false` stops after the report and the plan (default: `true`). Machine state is never in scope of `WRITE`.

## How the run goes

**Load the `repo-audit-plugin` skill before step 1 and run this audit through its flow.** Its planner seat does Phases 0
to 1b and writes Phase 2's edits as a plan, its editor seat applies them, and the planner does Phase 3. This session
coordinates and is the only one that asks the user. The seats do not ask for confirmation between phases; the stops
the flow adds are its own asks, one of them before any edit lands. Stop otherwise only on the stop conditions
below. Any change to a MACHINE (uninstall, disable, prune, a cache wipe, a registration removed) is the
user's to make: collect those as proposals for one AskUserQuestion at the end, never run them inside the
audit.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.tools`. No entry: report 'this repo installs
   no third-party plugins - nothing to audit' and stop. Its `roots` are what this run audits (a root the
   user names overrides them); run every `checks` command wherever this skill calls for the repo's
   mechanical checks, and quote its result; follow every `notes` line wherever this skill touches a
   repo-specific mechanism (the installer and its scope rule, the install catalogs, the retirement
   list, the usage analyzer, the product's own install-cost report, a second host).
2. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a
   defect in every later phase (packaging versus capability, the unit kind, fit with the root, trust,
   measured use, budgeted cost, official docs as the authority).
3. **Phase 0 - discovery.** Follow `references/discovery.md`: the consumed set, what each consumed
   unit contains, the dependency closure, the install registry, usage, the fit map against the root.
   Do not edit anything in this phase.
4. **Phase 1 - scoring.** Score each consumed unit and each dependency in its closure on the rubric in
   `references/rubric.md`, citing evidence for every point, and map the totals through its grade bands
   and floors. Produce the baseline report (the output contract below) before any editing.
5. **Phase 1b - currency.** Done inside Phase 1, not after it: re-read each fact row in
   `references/currency.md` against the live pages before scoring with it.
6. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first, then the
   bounded per-unit loop; machine-state changes are collected, not run. Its anti-gaming guards
   override the A target.
7. **Phase 3 - verification**, below.

## Phase 3 - Verification

1. Every `audit.tools.checks` command green after every repo edit, its result quoted.
2. `claude plugin details <name>@<marketplace>` re-read for every plugin whose seed, scope or pin changed, with the caveats in `references/principles.md`; `claude mcp get <name>` (and the other host's file) for every MCP server whose route, pin or scope changed.
3. A claimed use or cost change is proven by later sessions, never by the edit: re-run the usage analyzer (or the corpus count) over sessions recorded AFTER the change (a week), read `/skill-doctor` in a FRESH session, read the harness's 'Last used' line; for a replaced unit, the block ledger row of the replacement hook where the repo keeps one.
4. Re-run the Phase 1b check on every row a remediation relied on.
5. Record the final grades with the same evidence-cited scoring as Phase 1.

If an edit regressed an install closure, dropped a load-bearing plugin cite, or broke parity, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every consumed unit and every dependency in its closure is at A / 9 and passed verification, or
- Every remaining sub-A unit has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Consumed summary table: `unit`, `kind` (plugin / mcp), `via` (empty for a unit the product installs, `via <parent>` for a dependency), `source + tier` (marketplace, package registry or hosted endpoint), `pin` (version / SHA / package version / none), `seed` (in the product's own seed vocabulary - always / per-profile / opt-in / with its parent), `scope`, `measured use` (with denominator and how), `always-on tok`, `baseline grade`, `final grade`, `status` (`raised to A`, `already A`, `dropped`, `replaced by <house artifact>`, `blocked: <reason>`).
2. Registry drift table, counts only: versions per unit across projects, leftovers, user-added plugins and servers, marketplaces and their auto-update state, dependencies no installed plugin needs any more.
3. Security read, one line per consumed unit and dependency: hook events and command strings read, MCP endpoints and launch commands, credential handling, `bin/`, monitors, pin form - BLOCKER flagged.
4. Fit map: one row per child component with a relation to the root - `cited` / `duplicates` / `contradicts` / `collides` / `overrides` - the house artifact and line it meets, the resolution (home chosen, negative trigger added, child dropped, rule amended with its measurement, route repaired) or why it stands; a row handed over by `/repo-audit-system` says so.
5. The Phase 1b currency table with this run's verdicts.
5b. The `audit.tools.checks` commands, each with its result line, after every repo edit.
6. The machine-state proposals (the AskUserQuestion list), the exact command printed for each one picked, and, when `WRITE` is true, the files edited, moved or created plus the snapshot location.

Keep the report dense. No preamble, no restating this skill back, no filler.
