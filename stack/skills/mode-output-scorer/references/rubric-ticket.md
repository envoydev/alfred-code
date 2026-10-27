# Rubric - ticket

```json
{
  "output": "ticket",
  "checks": {
    "T1": { "points": 12.5, "na": null },
    "T2": { "points": 12.5, "na": "the user named a tracker whose Component field carries the area (the skill's own rule)" },
    "T3": { "points": 12.5, "na": null },
    "T4": { "points": 12.5, "na": null },
    "T5": { "points": 12.5, "na": null },
    "T6": { "points": 12.5, "na": null },
    "T7": { "points": 12.5, "na": null },
    "T8": { "points": 12.5, "na": null }
  }
}
```

Grades a `habits-create-ticket` ticket. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **T1** (12.5) - exactly Title and Description, nothing else.
- **T2** (12.5) - the title is under 80 characters, in `[Area/Component] ...` form. n/a: the user named a tracker whose Component field carries the area (the skill's own rule).
- **T3** (12.5) - no new file, class, method or DTO is named.
- **T4** (12.5) - every acceptance criterion can be triggered and observed.
- **T5** (12.5) - nothing session-local - no chat reference, scratch path or 'as discussed'.
- **T6** (12.5) - unverified items are questions in Notes.
- **T7** (12.5) - it fits one screen, about 400 words.
- **T8** (12.5) - the Description sits in one fenced block.

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
