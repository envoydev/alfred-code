# Rubric - designer-plan

```json
{
  "output": "designer-plan",
  "checks": {
    "P1": { "points": 5, "na": null },
    "P2": { "points": 5, "na": null },
    "P3": { "points": 5, "na": null },
    "P4": { "points": 5, "na": null },
    "P5": { "points": 10, "na": null },
    "P6": { "points": 10, "na": null },
    "P7": { "points": 5, "na": "a documentation plan" },
    "P8": { "points": 5, "na": null },
    "P9": { "points": 10, "na": "a documentation plan" },
    "P10": { "points": 10, "na": null },
    "P11": { "points": 5, "na": null },
    "P12": { "points": 5, "na": null },
    "P13": { "points": 5, "na": null },
    "P14": { "points": 5, "na": "the plan touches no stored data, public contract, auth, secret or migration" },
    "P15": { "points": 5, "na": "no preference doc exists" },
    "P16": { "points": 5, "na": "neither assessment exists" }
  }
}
```

Grades a plan file in the `habits-plan-writing` shape, either card shape that skill defines: the code card, or the documentation card whose four fields `target`, `change`, `evidence` and `verification` replace the six. A check is yes only with a quote or a section of the draft; n/a only where its line names the case, with the reason. The C-ids name the plan-grading checks each one comes from.

## Checks

- **P1** (5) - `Asked:` quotes the user's words verbatim (C4.1).
- **P2** (5) - `Oriented:` names the architecture sections read, the symbol calls made, the house skills loaded, and the preference and assessment docs read, or `none present` / `none - <reason>` (C1.2).
- **P3** (5) - `Build:` names the project's real gate commands - build, tests, lint, the final gate's affected-set command (C3.2).
- **P4** (5) - `## Fit` names extend, refactor first or isolate, with the forcing edge (C1.1).
- **P5** (10) - the cards together meet every requirement in `Asked:` and TASK, and no card contradicts another card or a constraint (C1.1, C4.1).
- **P6** (10) - every `files:` path and `anchors:` `file:symbol` exists or is marked `create`; on a documentation card every `target:` and `evidence:` reference resolves (C1.2; check each with LSP, Grep or Read).
- **P7** (5) - each card's `traps:` names the stack's trap or `none - <reason>`, and the edge cases intrinsic to the slice (empty or large input, concurrency, partial failure) are handled in a card or ruled out in Decisions (C1.4). n/a: a documentation plan.
- **P8** (5) - each Decision carries `precedent:` or `no precedent - <reason>`, and a choice the precedent does not force names the alternative it beat (C1.3).
- **P9** (10) - each card's `test:` names the test written first and the assertion that fails before the slice, or says why it has none in the skill's own form (`covered by task <n>`, `none - <reason>`) (C3.2). n/a: a documentation plan.
- **P10** (10) - each card's `acceptance:` is a command and the green it must show; on a documentation card `verification:` names the read-back or link check (C3.1, C3.3).
- **P11** (5) - scope: no card adds work `Asked:` does not name unless a Decision records the user's answer, and no new framework or abstraction where a local change suffices (C4.2, C4.4).
- **P12** (5) - order and slices: a card depends only on the cards above it, each card is one slice (no 'and then' in its title), and a shared file has one owning card (C5.4, C7.4).
- **P13** (5) - no `TBD`, `maybe` or `should` in a load-bearing field (C7.3).
- **P14** (5) - a change to stored data, a public contract, auth, secrets or a migration names its gate or rollback in a card or a Decision (C2.4, C6.1, C6.2). n/a: the plan touches none of them.
- **P15** (5) - preferences: each Decision a preferences entry governs names the entry's id, and no card contradicts an entry of the code or architecture preference docs unless a Decision records the user's ruling on the clash (C4.1). n/a: no preference doc exists.
- **P16** (5) - known weaknesses: no card adds another case of a weakness `quality/CODE-ASSESSMENT.md` or `quality/ARCHITECTURE-ASSESSMENT.md` records; a card that touches code a recorded weakness sits in names the entry and says fix now (inside the ask) or leave for a follow-up; a weakness outside the ask that the plan leaves alone is no finding (C1.4, C4.2). n/a: neither assessment exists.

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
