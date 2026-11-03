# Skill-edit A/B - the 2026-11-03 usage-audit edits (2026-11-03)

Five skill edits from the 2026-11-03 audits shipped on `develop` without a billed run behind them. These runs
put each edited step to Sonnet with and without the edit, graded by a narrow expectation file per step.

## Method

- Claude Code 2.1.317, `scripts/skill-comply.js replay --live`, `--model sonnet`, a throwaway account dir per
  run, the subscription login, `--max-budget-usd 0.75` per run (`1.5` on the first calibration runs).
  Every fixture had its `replay --dry-run` read before its first billed run.
- **Arms.** After = `develop` d3df8a07. Before = the same export with only the edited files put back: the
  five task-skill files at `v3.6.0` (task-solve `SKILL.md` and `references/step-mechanics.md`, task-verify-code
  `SKILL.md`, task-design `SKILL.md` and `references/evidence.md`, task-solve-cross
  `references/execution-modes.md`) and the three `repo-audit-system` files at `6d042b32^1`. A raw `v3.6.0`
  tree would also carry a month of hook changes; this keeps the delta to the edits (`diff -rq`: nine files).
- **Graders.** One fixture per edit under `meta/skill-comply/` (`task-solve-findings-ask`,
  `task-verify-code-surface`, `task-design-measured-ask`, `task-solve-auto-close`), each step quoting the
  sentence it grades and bound to its fixture (`session: false`). Each was probed offline on a pass and a
  fail trace per step before the first run, and re-cut where a real run showed a false verdict (below).
- **Levels.** Plain first; adverse where the edit is about pressure; explicit where plain never reached the
  edited text. A step failing on both arms is INCONCLUSIVE, never not-worse.

## Results

| Edit | Edited step | Level | Before | After | Verdict | Cost |
|---|---|---|---|---|---|---|
| U28 - task-solve step-5 ask template | the fix carries `(Recommended)` while an in-area MATERIAL is open | plain | 3/3 | 3/3 | | |
| | | adverse ('this ships today, wrap it up') | 4/5 | 5/5 | NOT-WORSE | $2.11, 16 runs |
| U29 - task-verify-code, unnamed surface | the shared helper's effect on the receipt email filed BLOCKER or MATERIAL | plain | 3/3 | 3/3 | | |
| | | adverse ('one-line change, keep it short') | 5/5 | 4/5 | NOT-WORSE (at ceiling) | $2.38, 16 runs |
| U30 - task-design, measured facts | the behaviour-change ask states today's import behaviour with how it is known | explicit | 4/4 | 3/4 | NOT-WORSE (at ceiling) | $1.70, 10 runs |
| U32 - task-solve, AUTO stamp deleted last | the stamp deleted after the close printed or its ask | plain + explicit | 0/4 | 0/4 | INCONCLUSIVE | $2.13, 12 runs |
| U32 twin - task-solve-cross | the same rule in `execution-modes.md` | - | - | - | NOT RUN | - |
| SYS-10 - repo-audit-system discovery | the Phase 0 checklist asks for no locked server; names LSP, grep, WebFetch | explicit | 2/2 | 2/2 | NOT-WORSE | $0.58, 4 runs |

Total billed: $9.42 (the four A/B fixtures $8.32 over 54 runs, SYS-10 $0.58 over 4, the plugin eval
re-record $0.53 over 13 runs, judge calls included).

## Reading

- **U28.** Both arms mark the fix at plain. Under the deadline prompt one before run of five fixed the
  MATERIAL without asking and then marked 'Close now (Recommended)' over the skipped re-review; no after run
  did. A one-run gap - a pointer, not a win.
- **U29.** The before arm already filed the email effect MATERIAL in all eight runs, so the edit cannot show
  a gain on this fixture. The one after miss (adverse) found and live-probed the email change, then put it to
  the user as a wording ask with no severity and no six fields - not the MINOR filing U29 targets. Read as
  noise at n=5; a regression would show as a MINOR on the email, and none did.
- **U30.** The plain prompt ('Plan this change ...') did not load `task-design` on either arm (2 runs), so the
  edited text was never in context; the explicit level types the command. The before arm located the import
  (`src/import.js:<line>`, three runs also `test/import.test.js:8`) on the ask's fact line unprompted in every
  run, so the edit is at ceiling here; the after arm's asks read the same, none in the template's
  `today: ... (measured: ...)` form. The
  after miss never opened `src/import.js` and asked about type validation instead - the ask detection
  upstream of the edited sentence, not the measured-facts rule.
- **U32 - the rule does not take.** Every run of both arms deletes the stamp in the same shell call that
  stamps `Completed:` (or the call before it), then prints the close. The explicit level tells the run to read
  `references/step-mechanics.md`, which holds the new rule, and all four after runs read it and still deleted
  first. A first cut with the work committed (nothing pending) read the same, 0/2 against 0/2. No run asked
  the commit question either: under the waiver both arms named the uncommitted diff in `Leftovers:`. Print
  mode reads as unattended whatever the stamp says, so the 3.8-hour wait itself cannot show here; the ORDER
  the rule sets is what failed. Not fixed here (a measurement pass): the rule needs a stronger home - the
  step-6 text in `SKILL.md`, or a hook - and its own A/B.
- **SYS-10.** Both arms wrote a checklist that names the LSP tool, a scoped grep and WebFetch and asks for no
  server. The before arm got there by overriding its own instruction: both of its runs wrote that the 'three
  locked servers' line is retired (CLAUDE.md's always-on text said so). The after arm carries no stale line to
  override. Cost even ($0.14 a run).

## Grader corrections made from real runs

- U28: a label's verdict is read from its FIRST action word, so 'Apply both fixes, re-review the fix delta,
  then close (Recommended)' is the fix and 'Ship it, fix later (Recommended)' the close; the first cut read
  'ship' in an option's description as a close mark.
- U30: the step-0 `habits-clarify` load counts as the design running (a typed command leaves no Skill call);
  the measured check reads any line of the ask that names the import, not one template line; a run that stops
  at its ask writes no plan yet, so only 'no code written' is graded there.
- U32: a `Completed:` stamp written by a shell edit counts; the fixture leaves the diff uncommitted so the
  close owes its ask.
- SYS-10 was graded by a scratch script, not `skill-comply` (the skill is this repo's own, not installed by
  the replay): the checklist written; no line asking for a locked server, `serena`, `context7` or an `mcp__`
  tool unless the same line says it is gone; LSP, grep and WebFetch named; no fixture installed.

## Not run

- **U32 twin (task-solve-cross).** The rule text is the same as task-solve's, and task-solve's own fixture
  shows neither arm following it; a cross fixture (ledger, contract, a member repo) costs more for no
  separable signal until the rule itself changes.
