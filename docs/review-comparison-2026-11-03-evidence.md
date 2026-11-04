# Review comparison 2026-11-03 - our review-code against the built-in /code-review

C4 of the 2026-11-03 open list: the user authorised one comparison on a real diff, cap $25, two runs per arm on
Opus 5.5, a blind judge. Spent $8.59.

## Setup

- The diff: D8's branch (heavy session -> Sonnet seats) against its base, a1315e15..ac879c18 - 31 files, +616/-59,
  staged in a throwaway clone so both arms review the same uncommitted change.
- Arm A (ours): develop 7170b1c2 installed at `local` scope from a clean export (the always seed, stack-select, the
  installer), an isolated account; prompt `/review-code Review the staged changes in this repository (git diff HEAD).
  Report the findings only and change no file. Run without asking me; take the recommended options.`
- Arm B (built-in): the same clone, no plugin installed, an isolated account; prompt `/code-review high`.
- Both: `claude -p`, `--model claude-opus-5-5 --effort high --max-budget-usd 5`, tools Read, Grep, Glob, Bash(git),
  Bash(node), Agent, Skill, TodoWrite, LSP; a fresh copy of the arm's tree per run. The install's five pruned or
  rewritten tracked files were restored, so both trees show the identical 31-file diff.
- Judge: one Opus 5.5 `claude -p` run (high effort, read-only, $6 cap) on a third copy. The four reviews were
  normalised to one shape (location, claim, failure scenario - every self-assigned severity, category and verdict
  dropped) and shuffled as R1-R4; the arm key stayed outside its input. It judged every finding against the code
  (REAL major / REAL minor / FALSE / UNCLEAR), grouped duplicates into issues, and matched ten issues D8's own final
  review had deferred (K1-K10). Its per-review totals were recomputed from its per-finding verdicts and agree.

## Which model did the work

Every run's `modelUsage` lists claude-opus-5-5 only. Arm A dispatched no seat: its own note reads 'Reviewing inline
(one JS stack, no verifier seat on the roster)' - the always seed carries no stack seats, so D8's heavy-session
route had nothing to send to. This is a skill-against-skill comparison on one model; whether D8 moves a review to a
Sonnet seat is D8's own A/B (plan 2). Arm A's prompt wording also loaded this repo's own `auto-run` skill (no ask
came up in either run).

## Result

| Arm | Run | Findings | Real major | Real minor | False | Unclear | Known hit | Cost | Time |
|---|---|---|---|---|---|---|---|---|---|
| A ours | A1 | 6 | 2 | 3 | 1 | 0 | 2 | $2.44 | 256 s |
| A ours | A2 | 2 | 1 | 1 | 0 | 0 | 1 | $1.58 | 170 s |
| B built-in | B1 | 10 | 1 | 4 | 5 | 0 | 3 | $1.35 | 150 s |
| B built-in | B2 | 10 | 3 | 3 | 3 | 1 | 2 | $1.70 | 204 s |

- Precision: A 7 of 8 findings real (88%), B 11 of 20 (55%).
- Recall: 8 distinct real issues, 3 major. A's two runs found 5 of them (2 major), B's two runs all 8 (3 major).
- Cost: A $2.01 a run, B $1.53 - A about 1.3x.
- Read: a lean, not a verdict (two runs an arm, one judge). Ours is the more precise reviewer and the costlier one;
  the built-in casts wider and reaches more real issues, at a false finding in every second or third.

## The issues (the judge's grouping)

- I1 major (A1, A2, B1, B2) - task-solve's AUTO waiver lost its instruction to write the root stamp at the absolute
  `${CLAUDE_PROJECT_DIR}` path, while step-mechanics.md still points to SKILL.md for it. D8's final review had ruled
  this 'not a defect'.
- I2 major (A1, B2) - most heavy-session clauses read ANY `Seats:` line as heavy, the switch-down 'no step moves'
  line included; only rows 14 and 16 read the newest line.
- I6 major (B2) - task-solve step 3 and task-implement's 'unless this run did' asks reuse the one-step gate verdict
  of step 2 instead of a fresh build verdict, so a parallel plan can read `serial seats: 1`.
- I3 minor (all four) - the switch-down line calls Haiku 'the seats' own tier' (K6).
- I4 minor (A1, B1, B2) - seatsLedgerHolds builds the ledger path without ledgerRow's docsRootEnv fallback.
- I5 minor (B2) - a Sonnet-tier flow call reads the whole hook-blocks ledger synchronously, cost unmeasured (K8).
- I7 minor (A1, B1) - the 'what Sonnet pays' test only logs growth (K10).
- I8 minor (B1) - SEATS_SKILL_RE matches switch-only mode-* and capture-* commands with no seat choice point.

False findings: A1.6 and B2.10 (a docs/superpowers path in a test header - an established convention), B1.2 (the
repeated down line is by design), B1.6, B1.7, B1.9 (handled elsewhere in the bullet, the loop or the hook's exit
order), B1.8 and B2.8 (a redundant rounding with correct output), B2.9 (no version bump in a feature change is the
norm); B2.7 unclear (alias resolution is the provider's).

## Limits

- Two runs an arm; one judge on the same model as both arms.
- The normalised shape hides the arms' formats, not their prose styles.
- The fixture had no stack seats, so the stack's seat dispatch was not exercised.
