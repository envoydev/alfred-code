# Calibration fixtures - mode-output-scorer

One file per graded case, `<output>-<case>.md`. Line 1 is `<!-- planted: <the flaw> | none -->`, read by the
calibration run only and never handed to the grader. `## TASK` holds the user's request as the grader's `task.md`
gets it; everything after the `## DRAFT` line is the draft, written as `<id>.draft.md`. The code they cite is the
project `../scaffold.sh` builds, and `inputs/` is its docs root (`.alfred/docs`), so `start` lists those docs in
`inputs.md`.

The run (Task 14 Step 5 of the plan, billed or on a restart with this tree's plugin, the user's word first): per
fixture `start --output <output>`, the TASK and the draft written, one output-scorer seat dispatched, then
`scorecard.js grade`. Every `none` fixture is graded three times, the rest once. A `none` fixture passes at level 80
on the mean of its three grades and on two of them, a planted one fails with its flaw among the findings; the spread
of the `none` grades sets `NOISE_BAND`. The results and each run's tokens go to `docs/habits-scorer-evidence.md`.
