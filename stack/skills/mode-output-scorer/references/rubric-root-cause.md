# Rubric - root-cause

```json
{
  "output": "root-cause",
  "checks": {
    "D1": { "points": 10, "na": null },
    "D2": { "points": 20, "na": null },
    "D3": { "points": 10, "na": "an unproven verdict" },
    "D4": { "points": 10, "na": "a proven verdict" },
    "D5": { "points": 10, "na": null },
    "D6": { "points": 10, "na": null },
    "D7": { "points": 10, "na": null },
    "D8": { "points": 10, "na": "an unproven verdict with no fix plan, or no preference doc and no assessment" },
    "D9": { "points": 5, "na": "the step-3 verdict, or a seat report whose brief did not ask to level" },
    "D10": { "points": 5, "na": "the step-3 verdict, or a seat report whose brief did not ask to level" }
  }
}
```

Grades the `issue-diagnoser` step-3 cause verdict and its 4a report, and a diagnoser seat's report. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason. An honest `unproven` verdict can reach 100, so the revise loop never pushes toward claiming a cause.

## Checks

- **D1** (10) - the verdict stated first (after a seat report's `checked prior notes:` opener): `proven at <file:symbol>` or `unproven - <n> hypotheses ranked`.
- **D2** (20) - each supporting fact quoted from THIS failure - a log line, a stack frame, a failing test, a command and its output, or the code read at `file:line`; an assessment entry counts as a lead, never as the proof; evidence gathered through a shell is quoted in the findings file or the report, because the grader cannot re-run it.
- **D3** (10) - at least one competing cause ruled out with the reason. n/a: an unproven verdict.
- **D4** (10) - the hypotheses ranked, each with the observation that would confirm it. n/a: a proven verdict.
- **D5** (10) - the evidence tier carried as the confidence label (a seat report's `confidence:` line).
- **D6** (10) - the observation that would change the verdict.
- **D7** (10) - what a fix would have to change, or for an unproven verdict the log points that would raise the tier.
- **D8** (10) - the fix plan honours the code and architecture preference docs and adds no case of a weakness either assessment records; a recorded weakness the fix touches is named, fix now or leave. n/a: an unproven verdict with no fix plan, or no preference doc and no assessment.
- **D9** (5) - blast radius and who it affects. n/a: the step-3 verdict, or a seat report whose brief did not ask to level.
- **D10** (5) - severity and P0-P3 priority. n/a: the step-3 verdict, or a seat report whose brief did not ask to level.

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
