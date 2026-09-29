# Plugin audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Set-level defects first. A D3 BLOCKER: drop the plugin from the manifest (with the HTML, README, seeds and graph) or replace it with a house hook doing the same deterministic job - and say which in the report. A duplicate home: choose by the house rule (a deterministic gate at a discrete event is a hook; procedure is a skill; the plugin's copy wins only when the packaging buys something the house copy cannot, such as an LSP wiring or a vendor-maintained MCP), then remove the other home. A `contradicts` row: the house rule wins - drop or disable the child's conflicting component (a plugin is enabled or disabled whole, so a partial fit usually means the child leaves); amend the house rule only when the child's guidance is measurably better, with the measurement and the reason in the report. A `collides` row: a negative trigger in the house skill's description for the child's phrasing, or the child dropped; two hooks on one event stay only when their jobs differ and the order is recorded. A broken `cited` route: fix the citer (describe the coverage instead of the stale name) or pin the child version that still ships it.

Then, for each plugin still below A / 9, a bounded loop:

1. Snapshot the files the edit will touch.
2. Rank the deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes it. Examples:
   - Seed placement unproven: move the plugin from `always` to the stacks whose surface needs it, or to the opt-in list, on the evidence rule; regenerate the graph; keep the install closures otherwise identical.
   - Pin form unrecorded: state it in the manifest comment (curated marketplace and explicit version, or SHA) so the next reader knows what an update means.
   - `plugin-settings.json` row stale: re-read the keys from the installed version and update `verified`.
   - Scope wrong for the audience: correct the installer's scope rule for that plugin.
   - Manifest / HTML / README drift: fix the source and let the lint prove it.
   - Own plugin: the `plugin-authoring` skill's loop - validate, the details number with its caveats, the eval suite or its named substitute, the README statements, one version home.
4. Re-score from scratch. Do not carry the previous score forward.
5. Repeat until A / 9, `MAX_ITERATIONS`, or a pass with no material gain.

Machine-state changes are collected, not run: uninstalling a dropped plugin from the audited machines, disabling one at a scope, `claude plugin prune` for dependencies nothing needs any more (a replaced cached version goes by the 14-day sweep), removing a leftover registry entry. They go into ONE AskUserQuestion at the end, one option per action with the recommended one marked.

## Anti-gaming guards (hard invariants)

- Unobservable is not unused. A hooks-only plugin scores D1 on its own output shape or is reported as 'not observable', never dropped for silence alone.
- A cite is use only with its content clause. A bare `plugin:skill` name in a house artifact does not earn the plugin a citer.
- No move inside an observation week. A seeded default or hook behaviour under observation is recorded with its week's end date.
- Validate is not a safety check. No D3 point for a passing `--strict` alone.
- `allowed-tools` earns no security point. It is a one-turn pre-approval, not a restriction.
- Preserve the display-driven split of the own plugin. Commands that list namespaced-only and a router skill that lists bare are a measured choice; do not convert either to gain a component-fit point.
- One version home. Never add a `version` to a marketplace entry whose source holds a `plugin.json` to 'be safe' - the manifest wins and validate warns on the pair. An entry with no `plugin.json` behind it IS the manifest, and its `version` is the one home.
- No private names. A finding about a specific consuming project is stated as a shape ('one project carries an older version').
- The root wins by default, never silently. A house rule is amended to fit a child only with a measurement and a recorded reason; a child is never kept by weakening the rule it contradicts.
- A fit finding quotes both sides. 'Overlaps with the house' without the two lines is noise, not a deduction.
- Honest scoring. A plugin that cannot reach A without breaking a guard is reported at its real grade with the blocker.
