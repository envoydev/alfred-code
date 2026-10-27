---
name: refining-plans
description: "Use when a spec or plan is drafted for the user's approval, or on 'grade this plan' / 'scoring for plans' - a fresh reviewer grades it to 90+."
---

# Refining plans - an independent grade before the handoff

The user's bar for anything they approve before work starts is 9 or 10 out of 10 from an independent grade, and they should never have to ask for it. A fresh reviewer that never saw this conversation grades the draft against a fixed rubric, the author revises, and the draft reaches the user only once it passes or the loop stops.

## When to use

- Before the step that asks the user to review a written spec, an implementation plan, a design doc, an ADR or a migration plan in this repo - after the author's own self-review, never in place of it.
- Again when the user's requested changes alter a graded draft's substance; a wording fix needs no new grade.
- Also when the user asks for it in their words - 'grade this plan', 'scoring for plans', 'score the spec'.
- Not for code diffs (the review skills own those), and not for an inline plan of five to ten lines.
- Off for the rest of the session once a user message starts with 'stop scoring' - the always-grade rule included. A handoff after that says `ungraded - scoring stopped` in place of a score path.
- Cost, measured 2026-10-24 on a 250-300-line design: 160k-280k tokens and 9-13 minutes per round on Opus; that run took five rounds (60, 86, 86, 91, 95).

## Inputs

Write them to a folder `refining/<slug>/` in the session scratchpad:

1. `task.md` - the user's request and hard constraints verbatim (typos kept), their answers to the design questions, and the repo constraints the draft must honour (from `CLAUDE.md` and the rules). No author reasoning, no alternatives weighed, no self-assessment.
2. The artifact is the file the request asked for - the spec file, the plan file - never a stand-in: a chat summary or an inline outline is never graded in its place, and a missing file is written first (2026-10-25: 3 of 18 scored stack runs graded an inline plan instead of the plan file asked for, and lost all 3). For an implementation plan, the spec it implements is part of the artifact (the reviewer prompt's last line says how to pass it).
3. Nothing the reviewer reads carries a score, a grade history or a review note - a status line such as 'graded 60, 86, 91' tells it this is a revision. Copy such a file into the folder without that line and pass the copy.

## The loop

Round 0 grades the draft; rounds 1-3 each revise, then grade again.

1. Dispatch ONE new reviewer: the Agent tool, `subagent_type: general-purpose`, `model: opus`, description `Review <kind> round <n>`, prompt = `references/reviewer-prompt.md` with TASK = `task.md`, RUBRIC = `${CLAUDE_SKILL_DIR}/references/rubric.md`, ARTIFACT = the draft (and, for a plan, its spec). Never a fork, never resumed, never told earlier scores, findings, the change log, or that this is a revision.
2. Validate the scorecard: recompute each criterion as weight x met / 4 and the total rounded; flip a `yes` with no quote to `no`, and an `n/a` on a check that allows none to `no`; apply the BLOCKER cap of 60. Change nothing else. A malformed reply gets one re-run with a new reviewer - a failed grade, not a second opinion. A well-formed grade is never repeated on an unchanged draft: a fail is revised at once (2026-10-25: 10 of 10 stack re-grades of an unchanged draft were followed by the revision anyway, 16% of the scored minutes). Save it as `round-<n>.md` in the folder, and a copy of the draft it graded as `draft-<n>` (the draft's own extension) beside it.
3. Verify each finding against what it cites before acting on it. A finding that is factually wrong is rejected with the evidence, never 'fixed' to please the grader.
4. Decide, in this order. 90 is the target, not a strict bar: whether another round is worth it depends on what it can still reach.
   - ROLL BACK first - when this total is lower than an earlier round's, copy the highest-scoring round's `draft-<k>` back over the draft and take its `round-<k>.md` as this round's scorecard: every rule below, the stall test and the next revision work from the best version, never the lower one. A tie keeps the newer draft. Why: a revision can trade a fixed finding for two new ones, and the user's bar is the best the loop reached, not the last it wrote (the user, 2026-10-27).
   - PASS - 90 or more and no BLOCKER or MATERIAL open: finish.
   - PASS WITH FIXES - 90 or more, no BLOCKER, a MATERIAL open: fix each MATERIAL the evidence confirms and finish WITHOUT another grade; the handoff lists them as fixed after the last grade. A round to confirm a fix already checked against the finding's own evidence costs 160k-280k tokens and mostly measures grader noise. Aim for 100 only when every unmet check closes with information in hand and the stakes are high (stored data, a public contract, security, a release).
   - Measure the CEILING - the most the next round can reach in the current circumstances: the uncapped total plus the points (weight / 4) of each unmet check you can close with what is in hand - the reviewer's `[closable]` / `[needs: ...]` tag is its claim, the sum is yours (the repository, the docs, the user's answers so far). A check that needs a decision only the user can make, information nobody has, or a section this kind of artifact does not carry adds nothing, and an open BLOCKER whose fix needs such a decision keeps the cap of 60. Print it on the round's line.
   - CONTINUE - a round remains, the ceiling is 90 or more, at least 5 points are closable, and this is round 0 or the total rose by 5 or more over the round before: revise (step 5) and go back to step 1.
   - Otherwise - the ceiling under 90, under 5 points closable, a stall (round 1 or later, the total rose by under 5), or round 3 graded - fix the open BLOCKERs and MATERIALs the evidence confirms, then the ask below, and act on the answer. (2026-10-24: a round after a stall at 86 went on to 91 and 95, so a stall under 90 is the user's call, not a stop.)
5. Revise: every BLOCKER, then every MATERIAL; a MINOR only when trivial. Each finding gets one disposition - fixed (what changed), rejected (the evidence), needs-human (the decision). Never delete substance to dodge a check, never add a hollow section to satisfy one, never edit the rubric or the reviewer prompt mid-run.

```ask
The draft scored <S>/100 after round <n> (<why it stopped>); the next round can reach at most <ceiling> (<what blocks the rest>), for about 250k tokens and 12 minutes. How should it go on?
- 'Fix all, one more round (Recommended)' - the confirmed findings are fixed and a fresh reviewer grades once more
- 'Hand it over as is' - you review it now, with the open findings and the ceiling listed
- 'Answer <the decision> first' - only when a decision of yours is what caps the ceiling
```

Recommend 'Fix all, one more round' when the ceiling is 90 or more; under 90, 'Answer <the decision> first' when your decision lifts it, else 'Hand it over as is'. The recommended option is always listed first.

Under auto-run the ask is not put: the Recommended option is taken. Auto-run is on when the user's words in this session said to take the recommended options or to run without asking ('auto-run', 'auto mode'), or the `auto-run` skill is loaded - and no user message since started with 'stop auto run'. A decision only the user can make - an `Answer <the decision> first` recommendation, a MATERIAL tagged `[needs: ...]` - takes that decision's own recommended answer the same way; then the loop goes on: fix and finish on a pass, else one more grade. Write `Ruling: <the ask> - <the option taken> - <cost if wrong>` to the run's ledger when one is named (a plan's `progress.md`, a task ledger under `docs/superpowers/`), else to `refining/<slug>/rulings.md`.

## In the chat

- One line per round, never the scorecard table: `Round <n> - <S>/100 (<delta>) - ceiling <c> - <b> BLOCKER, <m> MATERIAL - <decision>`; a rolled-back round's decision starts `ROLLED BACK to round <k>`.
- The handoff names the draft's path, the score path (`60 -> 86 -> 91 -> 95`; a drop shows where it went back: `60 -> 86 -> 82 (back to round 1) -> 91`), `independent` or `SELF`, and every finding fixed after the last grade (not re-graded). A status line goes into the file only now, after the loop.

## Fallback

No Agent tool, or two failed dispatches: grade in a separate step that reads only `task.md`, the rubric and the draft, looking for the reason to answer no before yes. Label it `SELF`; 100 is not allowed; a PASS says an independent review is recommended before work starts.

## Signs it was skipped

- A spec or plan handed over for review with no score path.
- The user asking whether it was scored.
- A reviewer that was told an earlier score, or read a file carrying one.
- A draft handed over, or revised again, that scored lower than an earlier round of the same run.
