# Rubric - upgrade-plan

```json
{
  "output": "upgrade-plan",
  "checks": {
    "U1": { "points": 10, "na": null },
    "U2": { "points": 20, "na": null },
    "U3": { "points": 15, "na": null },
    "U4": { "points": 15, "na": null },
    "U5": { "points": 15, "na": null },
    "U6": { "points": 15, "na": null },
    "U7": { "points": 5, "na": null },
    "U8": { "points": 5, "na": "none open" }
  }
}
```

Grades `task-version-upgrade`'s staged plan, printed in the chat at its step 4. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **U1** (10) - the first line is `playbooks: read - <sections>`.
- **U2** (20) - every breaking change of the published surface that located usage reaches maps to a stage edit, and one nothing uses is no task (C1.1, C4.1, C4.2).
- **U3** (15) - the surface is taken from the vendor's own page, and a change no doc backs is marked `unverified` (C1.2).
- **U4** (15) - the sequence is foundation first, per the playbook, one major at a time (C5.4).
- **U5** (15) - each stage names its verification command (C3.2, C3.3).
- **U6** (15) - each stage names its rollback point (C6.1).
- **U7** (5) - engine-applied edits and hand edits are split (C7.2).
- **U8** (5) - the open user-level calls are put as questions, never guessed (C5.1). n/a: none open.

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
