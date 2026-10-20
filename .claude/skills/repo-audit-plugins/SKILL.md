---
name: repo-audit-plugins
description: Use when auditing the third-party plugins Alfred Code installs and their dependencies - use, cost, supply chain, fit. Not for Alfred Code itself.
disable-model-invocation: true
---

# Third-party plugin audit and remediation

You are a plugin-surface engineer for a Claude Code stack. You audit the plugins the stack INSTALLS into
consuming projects, and every plugin those pull in as a dependency: each one is third-party code running
at the user's privilege on every machine the stack reaches. The stack's own plugin is the ROOT: it lays
down the house skills, agents, rules and hooks that define how a session works. Every installed
third-party plugin is a CHILD living inside that install, and a child earns its place only by FITTING the
root - no contradiction with a house rule, no second home for a house skill, agent or hook, no trigger it
shares with a house skill, no event it doubles a house guard on, and a route from the root's artifacts to
it where the root depends on it. Score each plugin against an objective rubric, then raise what can be
raised and report honestly what cannot.

The audit assumes nothing about which plugins exist: discover them from the stack's own manifests,
catalogs and the audited machine's install registry, read what each one actually contains, and measure
what each one actually did. It was distilled from the September 2026 plugin best-practice reports and
re-grounded in the official Claude Code docs on 2026-09-12 and re-checked on 2026-09-26; the docs win
wherever the two disagree, and `references/currency.md` says which claims are official, which are
community-reported and which the docs contradict. It is this repo's own maintenance tool, not part of
the shipped catalog. The stack's own plugin - its packaging and how its parts work together - is
`/repo-audit-system`'s.

## When to use

- The user types `/repo-audit-plugins` to audit the third-party plugins the stack installs.
- Not for the Alfred Code plugin itself or conflicts across its parts (`/repo-audit-system`), one hook's
  contract (`/repo-audit-hooks`) or one skill's quality (`/repo-audit-skills`); for building or changing
  a plugin, the repo's own `plugin-authoring` skill is the guide.

## Parameters

- `STACK_ROOT`: the stack repository (default: `.`).
- `PLUGIN_MANIFESTS`: where the stack declares the plugins it installs (default: the `plugins` list in `./meta/stack-manifest.json`, read by the Node seed `scripts/install/alfred-code.js` - the `*-lsp` pair suggested on evidence and the optional `claude-hud`; a stack with no installer declares them in a project `.claude/settings.json` `enabledPlugins`). The stack's own marketplace also carries ten generated MCP entries (`scripts/build-marketplace.js --mcp-entries`, from `meta/mcp-pins.json`): the upstream package each one launches is third-party code and is scored here under D3; the entries' packaging is the stack's own and `/repo-audit-system` scores it.
- `CATALOGS`: the guided-install catalogs (default: `./meta/` - `recommendations.json` seeds, `plugin-settings.json`, `stack-graph.json`, `retired-plugins.json`).
- `INSTALL_REGISTRY`: the audited machine's plugin registry (default: `~/.claude/plugins/installed_plugins.json` + `known_marketplaces.json`, or the same under `$CLAUDE_CONFIG_DIR`). Several machines: one registry each, reported side by side.
- `CORPUS`: a sessions collection root for the usage measurement (optional; empty scores use from the harness's own signals only).
- `HANDOFFS`: the third-party rows of a `/repo-audit-system` conflict map, when one ran (optional; the Phase 0 fit map, step 6, takes them as input).
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per plugin (default: `4`).
- `WRITE`: `true` edits REPO files in place, `false` produces the report only (default: `true`). Machine state is never in scope of `WRITE`.

## How the run goes

You operate autonomously. Do not ask for confirmation between phases. Stop only on the stop conditions
below. Any change to a MACHINE (uninstall, disable, prune, a cache wipe) is the user's to make: collect
those as proposals for one AskUserQuestion at the end, never run them inside the audit.

1. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a
   defect in every later phase (packaging versus capability, fit with the root, trust, measured use,
   budgeted cost, official docs as the authority).
2. **Phase 0 - discovery.** Follow `references/discovery.md`: the consumed set, what each consumed
   plugin contains, the dependency closure, the install registry, usage, the fit map against the root.
   Do not edit anything in this phase.
3. **Phase 1 - scoring.** Score each consumed plugin and each dependency in its closure on the rubric in
   `references/rubric.md`, citing evidence for every point, and map the totals through its grade bands
   and floors. Produce the baseline report (the output contract below) before any editing.
4. **Phase 1b - currency.** Re-read each fact row in `references/currency.md` against the live pages
   before scoring with it.
5. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first, then the
   bounded per-plugin loop; machine-state changes are collected, not run. Its anti-gaming guards
   override the A target.
6. **Phase 3 - verification**, below.

## Phase 3 - Verification

1. `npm run lint` and `npm test` green after every repo edit.
2. `claude plugin details <name>@<marketplace>` re-read for every plugin whose seed, scope or pin changed, with the caveats in `references/principles.md`.
3. A claimed use or cost change is proven by later sessions, never by the edit: re-run the analyzer over sessions recorded AFTER the change (a week), read `/skill-doctor` in a FRESH session, read the harness's 'Last used' line; for a replaced plugin, the hook-blocks ledger row of the replacement hook.
4. Re-run the Phase 1b check on every row a remediation relied on.
5. Record the final grades with the same evidence-cited scoring as Phase 1.

If an edit regressed an install closure, dropped a load-bearing plugin cite, or broke parity, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every consumed plugin and every dependency in its closure is at A / 9 and passed verification, or
- Every remaining sub-A plugin has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Consumed summary table: `plugin`, `via` (empty for a plugin the stack installs, `via <parent>` for a dependency), `marketplace + tier`, `pin` (version / SHA / none), `seed` (always / stack / opt-in / with its parent), `scope`, `measured use` (with denominator and how), `always-on tok`, `baseline grade`, `final grade`, `status` (`raised to A`, `already A`, `dropped`, `replaced by <house artifact>`, `blocked: <reason>`).
2. Registry drift table, counts only: versions per plugin across projects, leftovers, user-added plugins, marketplaces and their auto-update state, dependencies no installed plugin needs any more.
3. Security read, one line per consumed plugin and dependency: hook events and command strings read, MCP endpoints, `bin/`, monitors, pin form - BLOCKER flagged.
4. Fit map: one row per child component with a relation to the root - `cited` / `duplicates` / `contradicts` / `collides` / `overrides` - the house artifact and line it meets, the resolution (home chosen, negative trigger added, child dropped, rule amended with its measurement, route repaired) or why it stands; a row handed over by `/repo-audit-system` says so.
5. The Phase 1b currency table with this run's verdicts.
6. The machine-state proposals (the AskUserQuestion list) and, when `WRITE` is true, the files edited, moved or created plus the snapshot location.

Keep the report dense. No preamble, no restating this skill back, no filler.
