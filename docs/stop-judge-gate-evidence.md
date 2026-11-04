# Stop judge gate - P1 and P1b against regex v2 (2026-11-04)

HK-22's scoped build (`docs/superpowers/plans/2026-11-04-stop-judge-scoped.md`, git-ignored) shipped the prompt-hook
judge only if it beat the retuned regex (v2, `docs/stop-done-regex-v2-evidence.md`) by a set bar. It did not:
**GATE: FAIL**. The judge is retired per decision D7; the regex done-close reading stays as it is. The prompt file and
the replay runner named below left with it; git history holds both.

## What was run

- **Prompt:** `stack/hooks/stop-judge-prompt.txt`, sha256 `6c31922cb8e52c044b295657b20b37392145d333f060e899b6c87ce05686a5ee`
  (with the Cursor release line).
- **Model:** `claude-haiku-5-5`, pinned by full id; `claude -p --tools ''`, `--max-budget-usd 0.05` a call, one call per
  close per run, the Stop input rendered as the hook would get it.
- **Runner:** `scripts/ab-hk22.js` (a per-row cache keyed on model, run and input; a spend cap over the whole cache).
  Every call ran in an isolated `CLAUDE_CONFIG_DIR` and `HOME`; the account's `installed_plugins.json` hash was checked
  before and after each step, unchanged every time.
- **Corpora** (the text stays in a private scratch folder; this file gives counts only):
  - the 20 recorded closes of the 2026-11-03 replay (18 real, 2 marked active);
  - 162 closes, 161 labelled hold or release (hold 42, release 119) by the judge's own criteria;
  - P1b: 300 closes drawn from the 2,675 that pass under both the 3.7.0 and 3.7.1 hooks and are not among the 162
    (mulberry32, seed 20261104).

## Results

| Step | Rows | Result | Cost |
|---|---|---|---|
| T1 smoke | 20 | 17 right (15 of 18 real; both active rows released); 0 unparsed | $0.0134 |
| P1 run 1 | 162 | 135 of 161 right - holds right 30, releases right 105, wrong holds 14, misses 12 | $0.0785 |
| P1 run 2 | 162 | 125 of 161 right - holds right 27, releases right 98, wrong holds 21, misses 15 | $0.0804 |
| P1 run 3 | 162 | 123 of 161 right - holds right 28, releases right 95, wrong holds 24, misses 14 | $0.0995 |
| P1b | 300 | 39 held, 261 released, 0 unparsed | $0.1662 |
| Total | | | $0.4379 |

- **P1:** median 125, min 123, flips 24 (a close judged differently in at least one of the three runs).
- **Beside v2:** the regex alone is 122 of 161 right. Judge majority AND v2 (hold only when both hold): 137 of 161,
  wrong holds 7, misses 17. OR: 114 of 161, wrong holds 41.
- **P1b:** 39 of 300 closes that both the 3.7.0 and 3.7.1 hooks pass were held (13%). The blind reader that would label them
  was not run: P1 alone decided the gate, so its labels could not change the verdict.

## The bar and the verdict

`median >= 132, min >= 127, wrong holds <= 20 in every run, flips <= 8` on P1, and `wrong holds <= 6` on P1b.

P1 missed all four terms: median 125 < 132, min 123 < 127, wrong holds 24 > 20 (run 3), flips 24 > 8.

**GATE: FAIL.** The judge is three closes better than the regex at its median and unstable across runs at the same
input. The AND combination is the best reading measured (137, 7 wrong holds); the plan reported it and did not gate
it, and it would still need the judge running beside the regex on every Stop.

## Not measured

- P1b's wrong holds and the decoy misses (the blind reader, above).
- A judge on any other model or prompt: this gate measured the prompt and model above only.
