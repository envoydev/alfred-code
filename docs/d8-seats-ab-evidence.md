# D8 heavy-session seats - the billed A/B (2026-11-04)

D8 told a session heavier than the build seats' model - Opus or Fable leading a flow - to send the build, gate,
review and gather rows to the Sonnet seats, through a `**Seats:**` line the session-start hook printed and a
'Model' bullet in sixteen rows of fourteen skills. These runs put four Opus tasks to the stack with and without
D8, three runs per arm, under the spec's ship rule: B's median cost at least 25% under A's, the pass rate no
lower, the median grade no more than 0.5 under. No task passed, so batch 2 never ran and D8 leaves `develop`
(O3). Audit material: read it to learn why D8 was reverted, never to run a skill.

## Method

- Claude Code 2.1.318, every flow run on Opus 5.5 (`claude-opus-5-5`) at `--effort high`, `--permission-mode auto`,
  one `claude -p` per call on the subscription login, a throwaway account dir (`HOME`, `CLAUDE_CONFIG_DIR`) and a
  throwaway project per run under `<R>` = `<os.tmpdir()>/alfred-d8-ab`, a `--max-budget-usd` cap on every call. Each
  project was built by `scripts/d8-ab-fixtures.js` on the plugin route from its arm's export.
- **Arms.** B = `develop` at B_SHA `c5f614b9`. A = the same tree with D8 merged out (R1): for each of the 22 D8
  files, `git merge-file` of `650e0e32` (D8 final) against `e71bad20` (pre-D8), two conflicts resolved by the line
  rule (task-implement and task-solve SKILL.md, 0 unresolved), one post-pass line. Checks: no D8 marker under arm A's
  `stack/`; arm A holds 0 of the 38 `ROWS` needles, arm B 38 of 38 and all 16 `POINTS`; the two exports differ in
  exactly the 22 files plus `RELEASE-SOURCE`. Check (e), read by hand: 11 hunks from pre-D8 to arm A across 9 of the
  20 skill files, every one a non-D8 commit's (8 `state/approvals` path lines, 2 `argument-hint` lines, 1
  step-mechanics sentence).
- **Tasks.** t1 an Angular discount-code feature (`/task-solve`), t2 an ASP.NET refund endpoint with role checks
  (`/task-solve`), t3 a console ingest bug diagnosed from a 300 KB log then fixed (`/issue-diagnoser`, then
  `--resume`), t4 the code-quality loop over an Angular module with six seeded findings. Each fixture's base is red
  on its acceptance tests and its reference solution green (t4: suite and build green, the findings seeded).
- **Runs.** A probe (arm B, one run), then batch 1: 24 runs, three per arm per task, interleaved A, B and seeded
  (R6), after one calibration run. Batch 2 (t5 cross flow, t6 build from scratch, t7 = t1 on Fable 5.1) was gated on
  a batch-1 pass.
- **Caps** (the user's): probe $10, batch 1 $375, batch 2 $525.
- **Grader.** One blind Opus grade per run (R5) over the run's diff and resulting files, the reference shown as 'one
  correct answer, not the only one'; every stack tell (`Execution:`, `Seats`, `.claude`, `.alfred`, the run and
  session ids) swept out of the judge folder first.
- **Noise.** R2: B's median inside arm A's [min, max] on a measure sends that measure to the user, never to a pass.
- **Rows.** The reader (`read.js`) cuts each run's stream into the D8 rows it reaches, prices each row with the
  carry of its cache reads, and marks it `seat` or `session` by who ran it.

## Results

| Task | Runs per arm | Cost median A / B | Pass A / B | Grade median A / B | B took a seat A kept in the session | Oracle changed | Verdict |
|---|---|---|---|---|---|---|---|
| t1 Angular feature | 3 | $5.34 / $5.81 (inside A's $5.12-$9.97) | 3/3 / 3/3 | 8 / 9 | row 1 in 1 of 3, row 2 in 0 of 3 | none | user (noise) |
| t2 ASP.NET endpoint | 3 | $5.41 / $5.69 (+5%) | 3/3 / 3/3 | 7 / 9 | row 1 in 0 of 3, row 2 in 1 of 3 | none | FAIL - cost |
| t3 diagnose then fix | 3 | $6.60 / $6.33 (inside A's $5.94-$7.19) | 3/3 / 3/3 | 8 / 8 | rows 1, 2, 9 in 0 of 3 | none | user (noise) |
| t4 code-quality loop | 3 | $3.72 / $2.99 (-20%) | 3/3 / 3/3 | 9 / 6 (outside A's 8-9) | rows 10, 16 in 0 of 3 | none | FAIL - cost and grade |

`batch2Gate false; noWin true`.

## Per row

Medians over the runs that reached the row; carry is the row's share of cache reads it inherited.

| Row | Runs per arm | A cost + carry | B cost + carry | Marks A / B | Verdict | Siblings it carries |
|---|---|---|---|---|---|---|
| 1 build | 9 | $1.18 + $0.16 | $1.43 + $0.12 | session 9 / session 8, seat 1 | hold (t2 failed) | 5, 6, 15 |
| 2 gate | 9 | $0.33 + $0.10 | $0.35 + $0.11 | session 9 / session 8, seat 1 | hold (t2 failed) | 8 |
| 3 review | 3 | $1.65 + $0.00 | $1.49 + $0.01 | seat 3 / seat 3 | user (not separated: arm A took the seat too) | 7, 14-review-code |
| 9 gather | 3 | $0.63 + $0.69 | $0.68 + $0.64 | session 3 / session 3 | hold (costlier, compliance 0/3) | 4-fanout |
| 10 loop | 3 | $3.31 + $0.03 | $2.69 + $0.00 | session 3 / session 3 | hold (t4 failed) | 10-loops, 16 |
| 4-designer, 14-security | - | - | - | - | hold (t7 never ran) | - |
| 11, 12 | - | - | - | - | hold (t5 never ran) | - |
| 13 | - | - | - | - | hold (t6 never ran) | - |

No row was kept.

## The Seats line

Arm B printed it, and it reached the model, in 12 of 12 runs: routes `skill` on every flow skill, `typed` once
per t3 run for the typed `/issue-diagnoser`. Arm A printed none (0 of 12), as built.

## Reading

- **t1.** B cost the same within noise and graded one point higher. Both arms ran row 3's review in the verifier
  seat, so the review row cannot tell them apart. B moved row 1 into a seat once.
- **t2.** B was 5% dearer and graded 9 against 7: the higher grade came with more spend, not less, and B moved a row
  into a seat once in six chances.
- **t3.** Equal grades, cost within noise, and B kept every row in the session.
- **t4.** B was 20% cheaper, short of the 25% bar, and graded 6 against 9: it fixed fewer of the six seeded findings
  and left a manual subscription in place. It ran the loop in the session in every run, like A.
- **The held rows.** D8's mechanism is the seat move, and B made it on 2 of 27 row-runs where A stayed in the
  session. The probe moved all three of its rows (one run), but the counted runs did not. The text did not change
  where the session ran its work, so the rows' cost and grade differences are the line's and the bullets' presence
  in context, not the routing they asked for.

## Rulings

- **R1** Arm A is D8 merged out of B_SHA, not pre-D8 `develop` - cost if wrong: arm A keeps a trace of D8 the checks
  missed; the marker, needle and diff checks bound it.
- **R2** The noise rule, read per condition - cost if wrong: more tasks go to the user than the spec meant, never fewer.
- **R3** 'Re-run once, in both arms' applies to a run in either arm, its healthy pair not re-run - cost if wrong:
  one more run per infrastructure error (none happened).
- **R4** A run cut by its own cap is booked at its cap, counted as not passing, its task to the user - cost if wrong:
  none here, no run was cut.
- **R5** One blind Opus grade per run, the reference as 'one correct answer' - cost if wrong: a grader's bias, the
  same in both arms.
- **R6** Concurrency 3 after the calibration run, interleaved and seeded - cost if wrong: a usage-limit pause.
- **R7** Pass = suite and acceptance exit 0 (t4: suite and build) - cost if wrong: none, every run passed in both arms.
- **R8** Spec 5 step 6 read as 'keep on develop what passed, hold what failed' - cost if wrong: none, nothing passed.
- **R9** The calibration trigger stays at $7.50 - cost if wrong: one re-statement ask; the calibration run booked
  $5.12, under it.

## Reader corrections before the counted runs

Each was a gap in the reader, not in a fixture or an arm; each was fixed test-first and every counted run was
re-read with the final reader, which changed no verdict.

- A plan created by a shell `cp`, `mv` or redirect, or into a path held in a shell variable, is read as the plan
  write (the probe; b1-t1-A-1).
- A `Gated:` stamp written by a script editing the plan counts as the gate's write (b1-t1-A-1).
- A run that states no `Size:` line takes spec-check's size floor (b1-t1-A-1).
- Row 9 ends at the first Gather done line - in text or an ask, never a Triage done line - else at the
  `habits-root-cause` call (t3, both arms).
- Rows 10/16 start at the moded `capture-quality` call and end at the last `Result:` or `Outcome:` line, else at a
  prose close naming the loop status (t4, both arms; b1-t4-B-3).
- A build written only through the shell (a redirect, `tee` or script into `src/`) starts row 3 at the verifier
  after it (b1-t1-B-3).

## Cost

| Phase | Runs | Grades | Booked | Cap |
|---|---|---|---|---|
| Probe | 2 ($1.36 void - the request floored at trivial, so rows 1-3 were never reached - then $4.50 on the fixed request) | 0 | $5.86 | $10 |
| Batch 1 | 24 ($2.24-$9.97 each, $128.96) | 24 ($4.35) | $133.31 | $375 |
| Batch 2 | not run | - | $0 | $525 |
| Total | | | $139.17 | $910 |

Two t3 runs are booked at the sum of their two calls' result rows ($1.90 over their priced totals together), the
rule in force before the cumulative-row reading was proven.

## Not run

- **Batch 2** - t5 (cross flow: rows 11, 12), t6 (build from scratch: row 13), t7 (t1 on Fable 5.1: rows
  4-designer and 14-security): gated on a batch-1 pass, and none passed.
- **A re-run of any task** - the measured verdicts were not borderline on the seat move itself (2 of 27).
- **A grade by a second judge** - one blind grade per run, as planned (R5).
