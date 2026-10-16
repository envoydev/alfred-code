# System audit - Phase 2 remediation

Read after the baseline report. Nothing moves before the user answers the one ask; the guards at the end
override the A target.

## The fix list

One row per standing defect the audit owns, most severe first: a S4 BLOCKER, then a `contradicts` or
`blocks` row, then the rest by points lost times the profiles it reaches. Each row carries:

- the defect in one line, both sides quoted with file and line;
- the chosen home and why, by the house rule - a deterministic gate at a discrete event is a hook,
  procedure is a skill, cross-cutting guidance one always-on rule, per-file-type guidance a path rule,
  project facts AGENTS.md or a generated rule; the other side loses its copy and keeps a pointer at most;
- the files the fix edits, and the profiles whose map it moves (and which row, flag or total);
- or `handoff: <audit>` for a defect inside one part, and `handoff: /repo-audit-plugins` for a
  third-party side - with the evidence, never a fix here.

Typical fixes: a rule sentence restated by a hook injection - drop the copy from the injection, keep the
rule; a guard missing on one route - widen the hook's matcher or add the deny rule, with the route's
test; a dangling cite - describe the coverage instead of naming the absent item, or seed it where the cite
installs; a listing over budget - move trigger text from the description into the body's `## When to use`
or mark a manual-only skill `disable-model-invocation: true`; a fact sessions re-read - state it in the
template or the generated rule that owns it.

## The ask

One AskUserQuestion, as an ask template: the question on its first line, then one `- '<label>' - <why>` per
option, the recommended one first and marked:

```ask
Apply the system audit's fixes? <n> rows, <m> handoffs (listed above).
- 'Apply the recommended set (Recommended)' - every row marked recommended in the fix list, verified per Phase 3
- 'Pick' - one call of up to four multi-select questions, the rows grouped by dimension
- 'Report only' - nothing moves; the report and the handoffs stand
```

Apply only what the answer picked, in the fix list's order, each with its snapshot and Phase 3 checks
before the next. A handoff is never applied here, whatever the answer.

## Packaging fixes

The own plugin's packaging rows follow the `plugin-authoring` skill's loop - validate, the details number
with its caveats, the eval suite or its named substitute, the README statements, one version home - and go
through the same ask.

## Anti-gaming guards (hard invariants)

- Seams only. A fix inside one part's own quality is that part's audit's; re-grading it here hides the
  handoff.
- A fix moves the map. A claim with no row, flag or total that moved on the re-run is not a fix.
- No saving that adds reads. Cutting a rule or an injection that the corpus shows sessions then re-derive by
  reading is a S2 loss, not a gain.
- A guard is never weakened to clear a `blocks` row. The flow gets its receipt path, or the guard keeps
  blocking and the row stays reported.
- The root wins by default, never silently. A house rule is amended to fit another part only with a
  measurement and a recorded reason.
- Not measured is not zero. A NOT MEASURED line is stated, never scored as free.
- No move inside an observation week. A seeded default or hook behaviour under observation is recorded with
  its week's end date.
- Preserve the display-driven split of the own plugin. Commands that list namespaced-only and a router skill
  that lists bare are a measured choice; do not convert either to gain a component-fit point.
- One version home. Never add a `version` to a marketplace entry whose source holds a `plugin.json` to 'be
  safe' - the manifest wins and validate warns on the pair. An entry with no `plugin.json` behind it IS the
  manifest, and its `version` is the one home.
- No private names. A finding about a consuming project is stated as a shape.
- Honest scoring. A profile that cannot reach A without breaking a guard is reported at its real grade with
  the blocker.
