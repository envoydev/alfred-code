# Rubric - topic-explainer

```json
{
  "output": "topic-explainer",
  "checks": {
    "A1": { "points": 8.34, "na": null },
    "A2": { "points": 8.34, "na": null },
    "A3": { "points": 8.34, "na": "a within-budget answer" },
    "A4": { "points": 8.34, "na": "a within-budget answer" },
    "A5": { "points": 8.33, "na": "a within-budget answer" },
    "A6": { "points": 8.33, "na": "the topic track, or a within-budget answer" },
    "A7": { "points": 8.33, "na": "the code track, or a within-budget answer" },
    "A8": { "points": 8.33, "na": "the code track, or a within-budget answer" },
    "A9": { "points": 8.33, "na": "the answer makes no such claim" },
    "A10": { "points": 8.33, "na": null },
    "A11": { "points": 8.33, "na": "the code track, or a within-budget answer" },
    "A12": { "points": 8.33, "na": null }
  }
}
```

Grades a `habits-explain-topic` answer - the walkthrough, or the within-budget answer - against the skill's 'Last check before sending' list (its diagram item dropped, its 'facts are right' item split in two) plus the code track's mark-the-moment part. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason.

## Checks

- **A1** (8.34) - the first sentence answers the question.
- **A2** (8.34) - the depth and level match what the user's words asked in context - 'like for a 6-year-old', 'for a child', 'more details', 'go deeper', 'step by step', in any language - judged from TASK at the skill's three levels, never from a keyword list.
- **A3** (8.34) - the analogy is mapped part by part, with its limit. n/a: a within-budget answer.
- **A4** (8.34) - numbered steps, one idea each, each saying why. n/a: a within-budget answer.
- **A5** (8.33) - a worked example with concrete details; on the code track each snippet matches its file, which you re-read. n/a: a within-budget answer.
- **A6** (8.33) - the bug, concept or compare part of the code track's step 3 is there, and a compare part's recommendation honours `ARCHITECTURE-PREFERENCES.md` or names the entry it departs from. n/a: the topic track, or a within-budget answer.
- **A7** (8.33) - the most common misconception is named and corrected. n/a: the code track, or a within-budget answer.
- **A8** (8.33) - every technical term is defined and listed under Words to know. n/a: the code track, or a within-budget answer.
- **A9** (8.33) - every claim about this repository is verified by a quote or a `file:line`, and every claim from a vendor page matches the page, which you re-fetch. n/a: the answer makes no such claim.
- **A10** (8.33) - uncertainty is labelled and nothing is invented.
- **A11** (8.33) - a recap plus 2-4 Check yourself questions, the answers after them. n/a: the code track, or a within-budget answer.
- **A12** (8.33) - the length is in proportion to the question, and a within-budget answer ends with the skill's one-line offer of the walkthrough.

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
