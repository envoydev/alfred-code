# Rubric - custom

```json
{
  "output": "custom",
  "checks": {
    "X1": { "points": 12.5, "na": null },
    "X2": { "points": 12.5, "na": "no code claim" },
    "X3": { "points": 12.5, "na": "the output is not a plan" },
    "X4": { "points": 12.5, "na": null },
    "X5": { "points": 12.5, "na": "none touched" },
    "X6": { "points": 12.5, "na": "none open" },
    "X7": { "points": 12.5, "na": "no code change proposed" },
    "X8": { "points": 12.5, "na": null }
  }
}
```

Grades any other reply a typed stack names. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **X1** (12.5) - it meets every point of TASK.
- **X2** (12.5) - each claim about this project's or a related project's code is quoted with `file:line`, or a sibling you could not read is said to be checked against its awareness entry only (`sibling unread`). n/a: no code claim.
- **X3** (12.5) - the steps run in order, each with its check. n/a: the output is not a plan.
- **X4** (12.5) - nothing beyond the ask.
- **X5** (12.5) - stored data, a public contract, auth or a migration is named with its gate. n/a: none touched.
- **X6** (12.5) - open questions are asked, never guessed. n/a: none open.
- **X7** (12.5) - a proposed code change honours the preference docs and adds no case of a weakness either assessment records. n/a: no code change proposed.
- **X8** (12.5) - uncertainty is labelled and nothing is invented.

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
