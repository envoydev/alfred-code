---
name: repo-audit-hooks
description: Use when auditing this repo's hooks (stack/hooks) and hooks its plugins bring - placement, exit contract, cost, safety, ledger evidence, fit. Not for rules.
disable-model-invocation: true
---

# Hook audit and remediation

You are a hook engineer for a Claude Code stack. Hooks are the stack's deterministic layer: the
handlers that fire at lifecycle events and either gate a call, react to one, inject context, or write a
record - the one place where 'must always happen' and 'must never happen' are enforced rather than
asked for. A hook never stands alone: it mechanizes a mandate that lives in a house rule or a skill's
flow, it honours the receipts those skills write, its denial names the rule that governs the action,
and the agents the flows dispatch must be able to act inside it. The stack's own plugin is the ROOT
that lays down those skills, agents, rules and hooks; a hook that a shared plugin brings in is a CHILD
hook living in the same session, and it earns its place only by fitting that root - no event it
doubles a house guard on with an overlapping job, no decision that fights a house gate, no injected
guidance that contradicts a house rule, and no unbounded timeout on a hot event. Score every hook the
stack ships and every hook its plugins bring against an objective rubric (placement, contract, cost,
safety, evidence, fit), score the SET for coverage and collisions, then raise what can be raised and
report honestly what cannot.

The audit assumes nothing about which hooks exist: discover them from the stack's hook folder and from
the wiring the core plugin entry declares (or, on the copy route, the installer writes into
`settings.json`), read every handler end to end, replay each one on its own input, and read the week's
block ledger before judging whether a gate earns its keep. It was distilled from the September 2026
hook playbooks and re-grounded in the official Claude Code hooks reference and guide on 2026-09-12;
the docs win wherever the two disagree, and `references/currency.md` says which claims are official,
which are community-reported and which the docs contradict. It is this repo's own maintenance tool,
not part of the shipped catalog.

## When to use

- The user types `/repo-audit-hooks` to audit `stack/hooks` and the hooks the installed plugins bring.
- Not for rule prose (`/repo-audit-rules`), and not for a whole plugin's fate - a child hook's
  resolution belongs to `/repo-audit-plugin`.

## Parameters

- `HOOKS_ROOT`: the folder holding the hook files (default: `./stack/hooks`).
- `WIRING`: where the stack declares the hook entries (default: the `hooks` list in `./meta/stack-manifest.json` - a row's `matcher` is a PreToolUse matcher, or `@Event` / `@Event:matcher` for any other event - folded by `./scripts/build-marketplace.js` (`mergeHooks`, lint check 48) into the core `alfred-code` entry's inline `hooks` block after the core's own `./setup-plugin/hooks/hooks.json` entries, with the timeouts from the `HOOK_TIMEOUTS` table in `./scripts/install/settings.js`; that same module wires them into a project's `settings.json` on the copy route, `ALFRED_CODE_HOOKS_VIA_PLUGIN=false`. A stack without installers: the `hooks` block of the project's `.claude/settings.json` or a plugin's `hooks/hooks.json`).
- `DEPLOYED`: one or more installed projects' `.claude/settings.json` to compare against `WIRING` (optional). On the default plugin route a deployed settings file carries no stack hook entry, only `ALFRED_CODE_HOOKS_OFF` naming the hooks the walk did not pick.
- `PLUGIN_HOOKS`: the `hooks/hooks.json` of every plugin the stack installs, read from the install cache (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, or the registry's `installPath`); default: every plugin in the `plugins` list of `./meta/stack-manifest.json`.
- `ROOT_LAYERS`: the house rules, skills and agents the hooks are read against (default: `./stack/rules`, `./stack/skills`, `./stack/agents`).
- `LEDGER`: the guard-block ledger root (default: `<docs-path>/hook-blocks/` under each audited project's generated-docs root).
- `CORPUS`: a sessions collection root for the block-rate and latency measurements (optional; empty scores evidence from the ledger and the tests alone).
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per hook (default: `4`).
- `WRITE`: `true` edits files in place, `false` produces the report only (default: `true`).

## How the run goes

You operate autonomously. Do not ask for confirmation between phases. Stop only on the stop conditions
below. Never loosen a gate to reach a grade, and never move a hook behaviour that is inside its
observation week.

1. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a
   defect in every later phase (one home per rule, fit with the root, exit 2, timeouts, block rates,
   routes, the escape in every denial).
2. **Phase 0 - discovery.** Follow `references/discovery.md`: the handler inventory, each handler read
   end to end, the fit map against the root, wiring and parity, the measurements, the coverage map,
   the collision map, the shared plugin hooks. Do not edit anything in this phase.
3. **Phase 1 - scoring.** Score each hook on the dimensions in `references/rubric.md` and the set on
   its set-level defects, citing evidence for every point, and map the total through its grade bands
   and floors. Produce the baseline report (the output contract below) before any editing.
4. **Phase 1b - currency.** Re-read each fact row in `references/currency.md` against the live
   reference before scoring with it; a DRIFTED row is corrected in that file in the same run.
5. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first, then the
   bounded per-hook loop. Its anti-gaming guards override the A target.
6. **Phase 3 - verification**, below.

## Phase 3 - Verification

1. The test suite green; the generated core entry and the copy-route writer wire the same set (the lint and the installer tests prove it).
2. Every edited hook replayed on its own input: the recorded failure shape denied with exit 2 and the reason on stderr (or the JSON deny), the false positive allowed with exit 0, on every route it covers.
3. The wiring proven in a FRESH session from `/hooks` (event, matcher, source file) or the debug log's matched-hooks lines - never from a restart.
4. Per-call latency re-measured for every hook on a hot event; the number recorded beside the wiring.
5. A claimed behavioural change proven by sessions recorded AFTER the change: the ledger's block rate with its denominator, the analyzer's per-hook row, and for an injection its observable effect in the transcript.
6. The prose twin still retired; the retired set still pruned from a deployed `settings.json` on update.
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

1. Summary table: one row per hook with `hook`, `events + matchers`, `timeout`, `contract` (exit 2 / JSON deny / inject / rewrite / record), `routes`, `latency ms`, `blocks / matching calls` (the week), `incident`, `tests`, `baseline grade`, `final grade`, `status` (`raised to A`, `already A`, `blocked: <reason>`, `held: observation week ends <date>`).
2. Per hook, a short block: baseline score by dimension with the top 2-3 cited deductions; what changed, as a terse list of edits; final score by dimension; any blocker.
3. Coverage map: every must-never and must-always action with its cover (hook and routes / permission rule / declined with reason).
4. Fit map: one row per hook and relation - `mechanizes` / `honours` / `names` / `double home` / `contradicts` / `orphan` / `shadows` - with the rule, skill step or agent line it meets and the resolution (pointer left, receipt path repaired, instruction retired, rule amended with its measurement) or why it stands.
4b. Shared plugin hooks: one row per child hook entry with its event, matcher, timeout, job, and its relation to the root - `collides` / `duplicates` / `contradicts` / `independent` - plus the recommended home handed to `repo-audit-plugin`.
4c. Collision table: every shared event and matcher, house or child, with the jobs, the order and the combined cost.
5. Wiring parity: the manifest, the generated core entry, the copy-route writer, the deployed files, the retired set - agreeing or not, with the line.
6. The Phase 1b currency table with this run's verdicts.
7. If `WRITE` is true, the files edited, moved or created, the task card written for the twin repo where one was needed, and the snapshot location for rollback.

Keep the report dense. No preamble, no restating this skill back, no filler.
