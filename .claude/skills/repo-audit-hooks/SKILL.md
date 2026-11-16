---
name: repo-audit-hooks
description: Use when auditing this repo's hooks and the hooks its installed plugins bring - placement, exit contract, cost, safety, block evidence, fit. Not for rules.
disable-model-invocation: true
---

# Hook audit and remediation

You are a hook engineer for a Claude Code plugin repo. Hooks are the product's deterministic layer: the
handlers that fire at lifecycle events and either gate a call, react to one, inject context, draw, or write a
record - the one place where 'must always happen' and 'must never happen' are enforced rather than
asked for. A hook never stands alone: it mechanizes a mandate that lives in a house rule, a skill's
flow or the product's design record, it honours the receipts those skills write, its denial names the
rule that governs the action, and the agents the flows dispatch must be able to act inside it. The
product's own plugin is the ROOT that lays down whatever skills, agents, rules and hooks it ships; a hook
that a shared plugin brings in is a CHILD hook living in the same session, and it earns its place only by
fitting that root - no event it doubles a house guard on with an overlapping job, no decision that fights
a house gate, no injected guidance that contradicts a house rule, and no unbounded timeout on a hot
event. Score every hook the product ships and every hook its installed plugins bring against an objective
rubric (placement, contract, cost, safety, evidence, fit), score the SET for coverage and collisions,
then raise what can be raised and report honestly what cannot.

The audit assumes nothing about which hooks exist: discover them from the repo's hook roots and from
the wiring the repo declares (a plugin's hook entries, an installer that writes them into
`settings.json`, or a mods hooks module's registrations), read every handler end to end, replay each one
on its own input, and read the week's block ledger, where the repo keeps one, before judging whether a
gate earns its keep. It was distilled from the September 2026 hook playbooks and re-grounded in the
official Claude Code hooks reference and guide; the docs win wherever the two disagree, and
`references/currency.md` says which claims are official, which are community-reported and which the
docs contradict, each with the date it was last read.
It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-hooks` to audit the repo's hook roots and the hooks the installed plugins bring.
- Two hook shapes are covered: a COMMAND-HOOK SET (one handler process per wired entry, judged by exit
  code and JSON output) and a MODS HOOKS MODULE (one module registering in-process handlers through
  `on(...)`, judged by the mods API). `references/principles.md` says which criteria apply to which shape.
- Not for rule prose (`/repo-audit-rules`), and not for a whole plugin's fate - a child hook's
  resolution belongs to `/repo-audit-plugins`.

## Parameters

- `HOOKS_ROOT`: the folders holding the hook files (default: `audit.hooks.roots` in `.claude/kit/repo.json`).
- `WIRING`: where the repo declares the hook entries (default: where the `audit.hooks.notes` say - a source table, a generated plugin entry, the timeout table and an installer's copy route among them; with no note, the `hooks` block of the project's `.claude/settings.json` or a plugin's `hooks/hooks.json`, and for a mods module the `modules` entry of `hooks/hooks.json` plus every `on(...)` call in the module it names).
- `DEPLOYED`: one or more installed projects' `.claude/settings.json` to compare against `WIRING` (optional). Where the notes say hooks ride the plugin route, a deployed settings file carries no house hook entry, only whatever opt-out the notes name.
- `PLUGIN_HOOKS`: the `hooks/hooks.json` of every plugin the product installs, read from the install cache (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, or the registry's `installPath`); default: the install list `audit.plugins` names in the map, empty where the repo installs no plugins.
- `ROOT_LAYERS`: the house rules, skills and agents the hooks are read against (default: the `roots` of `audit.rules`, `audit.skills` and `audit.agents` in the map, plus any design record the `audit.hooks.notes` name; empty layers where the repo ships none).
- `LEDGER`: the guard-block ledger root (default: where the `audit.hooks.notes` say; none means evidence comes from the tests and the corpus alone).
- `CORPUS`: a sessions collection root for the block-rate and latency measurements (optional; empty scores evidence from the ledger and the tests alone).
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per hook (default: `4`).
- `WRITE`: `true` takes the run to the flow's ask and applies what it picks, `false` stops after the report and the plan (default: `true`).

## How the run goes

**Load the `repo-audit-flow` skill before step 1 and run this audit through it.** Its planner seat does Phases 0
to 1b and writes Phase 2's edits as a plan, its editor seat applies them, and the planner does Phase 3. This session
coordinates and is the only one that asks the user. The seats do not ask for confirmation between phases; the one
stop the flow adds is its ask before any edit lands. Stop otherwise only on the stop conditions
below. Never loosen a gate to reach a grade, and never move a hook behaviour that is inside its
observation week.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.hooks`. No entry: report 'this repo ships no
   hooks - nothing to audit' and stop. Its `roots` are what this run audits (a root the user names
   overrides them); run every `checks` command wherever this skill calls for the repo's mechanical
   checks, and quote its result; follow every `notes` line wherever this skill touches a repo-specific
   mechanism (the wiring source, the timeout table, the block ledger, the shared hook modules, an
   installer's copy route, a twin repo).
2. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a
   defect in every later phase (one home per rule, fit with the root, the hook shape, exit 2, timeouts,
   block rates, routes, the escape in every denial).
3. **Phase 0 - discovery.** Follow `references/discovery.md`: the handler inventory, each handler read
   end to end, the fit map against the root, wiring and parity, the measurements, the coverage map,
   the collision map, the shared plugin hooks. Do not edit anything in this phase.
4. **Phase 1 - scoring.** Score each hook on the dimensions in `references/rubric.md` and the set on
   its set-level defects, citing evidence for every point, and map the total through its grade bands
   and floors. Produce the baseline report (the output contract below) before any editing.
5. **Phase 1b - currency.** Re-read each fact row in `references/currency.md` against the live
   reference before scoring with it; a DRIFTED row is corrected in the same run, where that file says.
6. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first, then the
   bounded per-hook loop. Its anti-gaming guards override the A target.
7. **Phase 3 - verification**, below.

## Phase 3 - Verification

1. Every `audit.hooks.checks` command green, its result quoted; where the repo generates the wiring from a source, the generated entry and any copy-route writer wire the same set (the checks and the installer tests prove it).
2. Every edited hook replayed on its own input: for a command hook, the recorded failure shape denied with exit 2 and the reason on stderr (or the JSON deny), the false positive allowed with exit 0, on every route it covers; for a mods module, the handler's test replaying the event through the mods test kit with every API call it makes stubbed.
3. The wiring proven in a FRESH session from `/hooks` (event, matcher, source file) or the debug log's matched-hooks lines - never from a restart; a mods module from a session that loads the working tree.
4. Per-call latency re-measured for every hook on a hot event; the number recorded beside the wiring.
5. A claimed behavioural change proven by sessions recorded AFTER the change: the ledger's block rate with its denominator where the repo keeps a ledger, the usage analyzer's per-hook row where the notes name one, and for an injection or a drawing its observable effect in the transcript or the screen.
6. The prose twin still retired; where the product ships an installer, the retired set still pruned from a deployed `settings.json` on update.
7. Re-run the Phase 1b check on every row a remediation relied on.
8. Record the final grades with the same evidence-cited scoring as Phase 1.

If an edit uncovered a route, dropped a shape, or regressed a test, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every hook is at A / 9, the set-level map is clean, and verification passed, or
- Every remaining sub-A hook has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Summary table: one row per hook with `hook`, `shape` (command / mods), `events + matchers`, `timeout`, `contract` (exit 2 / JSON deny / inject / rewrite / record / draw), `routes`, `latency ms`, `blocks / matching calls` (the week), `incident`, `tests`, `baseline grade`, `final grade`, `status` (`raised to A`, `already A`, `blocked: <reason>`, `held: observation week ends <date>`).
2. Per hook, a short block: baseline score by dimension with the top 2-3 cited deductions; what changed, as a terse list of edits; final score by dimension; any blocker.
3. Coverage map: every must-never and must-always action with its cover (hook and routes / permission rule / declined with reason).
4. Fit map: one row per hook and relation - `mechanizes` / `honours` / `names` / `double home` / `contradicts` / `orphan` / `shadows` - with the rule, skill step, agent line or design-record line it meets and the resolution (pointer left, receipt path repaired, instruction retired, rule amended with its measurement) or why it stands.
4b. Shared plugin hooks: one row per child hook entry with its event, matcher, timeout, job, and its relation to the root - `collides` / `duplicates` / `contradicts` / `independent` - plus the recommended home handed to `repo-audit-plugins`.
4c. Collision table: every shared event and matcher, house or child, with the jobs, the order and the combined cost.
5. Wiring parity: every wiring source the notes name (the source table, the generated entry, the copy-route writer, a mods module's registrations against its feature folders), the deployed files, the retired set - agreeing or not, with the line.
6. The Phase 1b currency table with this run's verdicts.
6b. The `audit.hooks.checks` commands, each with its result line, before and after the edits.
7. If `WRITE` is true, the files edited, moved or created, the task card written for the twin repo where one was needed, and the snapshot location for rollback.

Keep the report dense. No preamble, no restating this skill back, no filler.
