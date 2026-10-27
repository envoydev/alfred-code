# Rubric - pick

```json
{
  "output": "pick",
  "checks": {
    "K1": { "points": 20, "na": null },
    "K2": { "points": 20, "na": null },
    "K3": { "points": 20, "na": null },
    "K4": { "points": 15, "na": null },
    "K5": { "points": 15, "na": null },
    "K6": { "points": 10, "na": null }
  }
}
```

Grades `task-build-from-scratch`'s THE PICK, before its ask is put. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **K1** (20) - at least two architectures, or one with the reason no second fits.
- **K2** (20) - each option names its stack and the one reason that decides it.
- **K3** (20) - every constraint the brief states is met by the recommended option or named as given up.
- **K4** (15) - what the recommended option gives up is stated.
- **K5** (15) - no tech choice is made that the brief left to the user.
- **K6** (10) - the ask has exactly one `(Recommended)` option, listed first.

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
