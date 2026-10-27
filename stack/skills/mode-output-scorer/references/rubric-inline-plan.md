# Rubric - inline-plan

```json
{
  "output": "inline-plan",
  "checks": {
    "I1": { "points": 20, "na": null },
    "I2": { "points": 20, "na": null },
    "I3": { "points": 20, "na": null },
    "I4": { "points": 20, "na": null },
    "I5": { "points": 20, "na": null }
  }
}
```

Grades the `habits-execution-strategy` inline plan - five to ten lines and its `Execution:` line - in the reply or the todo list. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **I1** (20) - the subtasks each name their files.
- **I2** (20) - the dependencies are stated by the skill's rule: one subtask consumes another's output, or both share a file, a manifest or a contract.
- **I3** (20) - the `Execution:` line is there in its exact shape.
- **I4** (20) - the checks are named per tier - per batch, once after the whole change, before a push.
- **I5** (20) - the plan runs five to ten lines.

## Severity

- BLOCKER: as written, the plan fails its goal, corrupts or loses data, breaks a contract, opens a security hole, or cannot be executed.
- MATERIAL: the plan works but at a real cost (rework, outage risk, performance, maintenance burden), or it depends on a decision the author cannot make alone.
- MINOR: polish. List only when there is no BLOCKER or MATERIAL, at most 3.
- Every finding states failure mode, trigger condition, cost, evidence, and a one-line fix. A finding missing any of these is discarded.

## Caps

- BLOCKER: all of them.
- MATERIAL: up to 5 in full, then extras as one line each.
- MINOR: up to 3, only when there is no BLOCKER or MATERIAL.
- Positives: up to 3, one line each, and each must name the obvious alternative it beats. Zero is valid.

## Finding format

`- [BLOCKER] B1 <title>. Failure: <failure mode> Trigger: <trigger condition> Cost: <cost> Evidence: <quote or file:line> Fix: <one line> [closable]`

A Fix, and a `no` row's reason, ends with what closing it takes: `[closable]` when the draft's author could meet it from TASK, the inputs and the draft's kind; `[needs: <the decision or input>]` when it waits on something the author does not hold. The scorecard script recomputes the total from the Checks table; a BLOCKER caps it at 60.
