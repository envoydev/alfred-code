# Prose A/B round - ab-G round 2 (2026-11-21)

The first prose round (`docs/prose-ab-2026-11-04-evidence.md`) left 18 audit rows for a second round and held four rows
whose fixtures never reached their text. This round puts nine groups of changed text to Sonnet with and without it,
graded per step by purpose-built fixtures, under a $60 stop. Audit material: read it to learn why an item shipped,
was held or was reverted, never to run a skill.

## Method

- Claude Code 2.1.330, Sonnet 5.5 (`claude-sonnet-5-5`) at `--effort high`, one `claude -p` per run on the
  subscription login, a throwaway account dir (`HOME`, `CLAUDE_CONFIG_DIR`) and a throwaway project per run under
  `<R>` = `<os.tmpdir()>/alfred-ab-g2`, a `--max-budget-usd` cap on every call, the parent session's `CLAUDE_*`,
  `ANTHROPIC_*` and `ALFRED_CODE_*` variables dropped. The seat fixtures (V, and the designer fixture of M and T)
  run their main session on `haiku` and dispatch the seat, which runs on its own frontmatter pin. The driver, its
  tests, the ledger and the case stores live in `<W>` = `docs/superpowers/sdd/2026-11-21-ab-g-round-2/`
  (git-ignored, machine-local).
- **Arms.** Before = `develop` at B_SHA `879e8beed56d43f866f8c8538620e38776b94fb8`. After, per group = B_SHA plus that
  group's files only, laid from the working tree, so a loss is attributed to its group; the before arm of a shared
  fixture is one arm. Group M is the exception: its after arm is B_SHA's `console-solution-designer.md` with
  `model: opus` changed to `model: sonnet` (one line, `effort: xhigh` kept), laid from `<W>/arms/M/` through the
  driver's `{ dir: 'arms/M' }` arm spec, never from the working tree. Group T's before arm is M's before arm (the
  same fixture, the same B_SHA text), so its 3 runs are stored and billed once, under M.
- **Graders.** One fixture per behaviour under `meta/skill-comply/`, each step bound to the item it measures
  (`owners`); a guard step no item owns reverts every item its fixture reaches. Every stored run is graded offline
  by `scripts/skill-comply.js`'s grader with the final fixtures, after the corrections below.
- **Levels.** One level per fixture (the plan's S6): plain for K, V, M, N, P and T; explicit for S and I, whose
  skills fire on a description and need an explicit load to reach a body trim; adverse for L, the
  discipline-under-pressure row. Three runs per arm. A step is WORSE when before minus after is 2 or more; a gap of 1
  is noise; a step failing in both arms is INCONCLUSIVE, never not-worse; a side graded short of `planned - 1` reads
  NOT PROVEN, never SHIP.
- **Store.** One case per fixture x arm x level x rep, keyed by text hash and fixture, so a fix re-runs only the cases
  whose inputs changed. Run folders (home, config, project) are `<R>/<case>/...`. The real
  `installed_plugins.json` was hashed before and after every case and never changed
  (`f7779e43751c1680...`, first 16 characters of the sha256); no token appeared in any output (0 hits).
- **Phases.** A smoke of 18 cases (rep 1 of every arm) with a hand read of every failing step, then the reps
  (rep 2 and 3), 34 cases. The levels phase started nothing.

## Results

Steps not listed passed in every run of both arms ('same', 3/3 each). 'Before' is B_SHA, 'after' is the group's text;
each cell is runs passed of 3.

| Item | Fixture - step | Level | Before | After | Verdict |
|---|---|---|---|---|---|
| SKC2-05 - the PUSH-GATE `scope:` clause is one sentence pointing at `references/publishing.md` | `habits-commit-checkpoint-push` - push-scope-first | plain | 0/3 | 0/3 | HOLD - INCONCLUSIVE, reverted |
| SKC2-05a - the review and batch rules move to the checkpoint's evidence reference | same - review-runs, receipt-cleared (guard) | plain | 3/3, 3/3 | 3/3, 3/3 | SHIP - not shown to help |
| SKC2-15 - the receipt.js history clause goes | same - every guard step | plain | 3/3 | 3/3 | SHIP - not shown to help |
| security:10 - the always-on security bullet points at the checkpoint | same - receipt-security-row, security-full-change-set | plain | 3/3, 3/3 | 3/3, 3/3 | SHIP - not shown to help |
| | same - push-receipt-cleared | plain | 3/3 | 2/3 | gap 1, noise |
| A1 - the verifiers hand the E2E run to the main session and name it on `deferred_runs` | `verifier-e2e-deferred` - no-e2e-in-seat | plain | 1/3 | 3/3 | SHIP - better |
| | deferred-line | plain | 0/3 | 3/3 | |
| exec-signs - habits-execution-strategy's Signs list cut to what the body does not say | `habits-execution-strategy` - execution-line | explicit | 0/3 | 0/3 | HOLD - INCONCLUSIVE, reverted |
| | strategy-loaded | explicit | 2/3 | 2/3 | same |
| pins - console designer on Sonnet `xhigh` against Opus `xhigh` | `designer-worker-traps` - decisions-ledger | plain | 3/3 | 2/3 | EVIDENCE - not worse, nothing committed |
| | one-owner | plain | 2/3 | 2/3 | same |
| csharp:13 - the csharp skill's project-preferences paragraph is one style pointer | `csharp-project-style` - csharp-before-edit, project-pref-wins | plain | 3/3, 3/3 | 3/3, 3/3 | SHIP - not shown to help |
| SKF2-11 - the catalogues' Execution modes section is a pointer | `issue-signatures-ci-red` - no-seat-dispatch, fan-out-read | explicit | 3/3, 3/3 | 3/3, 3/3 | SHIP - not shown to help |
| | signature-named | explicit | 2/3 | 3/3 | gap 1, noise |
| agents-md:61 - the report clause keeps the load facts | `adjust-agents-md-claude-md` - claude-md-kept, load-note, facts-written | plain | 3/3 each | 3/3 each | SHIP - not shown to help |
| dev-log:90 - the split stop without its story | `dev-log-split-stop` - no-invented-split | adverse | 3/3 | 3/3 | SHIP - not shown to help |
| | asks-before-draft | adverse | 1/3 | 0/3 | gap 1, noise |
| traps - the console designer's trap list as pointers | `designer-worker-traps` - scope-per-unit, stopping-token, bounded-channel | plain | 3/3 each | 3/3 each | SHIP - not shown to help |
| restate - the task-design restatements out of all ten designers | same - one-owner | plain | 2/3 | 3/3 | SHIP - not shown to help |
| | decisions-ledger, oriented-line, status-line | plain | 3/3 each | 3/3 each | same |

Runs per arm: 3 on every row (group T: after arm only, its before arm is M's). Steps no row lists passed 3/3 in both
arms: the other K steps (formatter-fresh, receipt-before-commit, receipt-five-lines, receipt-format-findings,
authorized-quotes-user, no-self-waiver, pushed), V's tests-rerun, defect-found and report-delivered, S's no-plan-file
and one-agent, M and T's oriented-line and status-line, P and N as listed. No step was WORSE. Two items held because a
step failed in both arms (0/3 and 0/3), the same shape as the first round's holds.

The two HOLD rows were reverted to B_SHA text in the working tree (Task 15): `git diff 879e8bee` is empty for
`stack/skills/habits-execution-strategy/SKILL.md`, and the checkpoint's `## Publishing` paragraph reads as at B_SHA.
The K group ships a strict subset of the text it measured (SKC2-05a and SKC2-15 and security:10 without the PUSH-GATE
sentence) with no WORSE row, so it was not re-run - the first round's U37 ruling.

## Cost

Mean cost of one run, in dollars, read from each case's reported total (a cut or killed case is booked at the higher
of its reported cost and its cap). Totals are the sum of the case rows of that group and side.

| Group | Fixture | Before mean (total) | After mean (total) |
|---|---|---|---|
| K | `habits-commit-checkpoint-push` | 0.272 (0.817) | 0.301 (0.902) |
| V | `verifier-e2e-deferred` | 0.585 (1.755) | 0.160 (0.480) |
| S | `habits-execution-strategy` | 0.220 (0.660) | 0.204 (0.613) |
| N | `csharp-project-style` (3 graded runs a side) | 0.255 (0.765) | 0.249 (0.748) |
| I | `issue-signatures-ci-red` | 0.115 (0.344) | 0.110 (0.331) |
| P | `adjust-agents-md-claude-md` (3 graded runs a side) | 0.230 (0.691) | 0.229 (0.686) |
| L | `dev-log-split-stop` | 0.121 (0.362) | 0.122 (0.367) |
| T | `designer-worker-traps` (before is M's before arm) | see M | 1.807 (5.420) |

Group M, the two arms side by side, for the user's pin ruling - the console designer seat on one fixture, n=3 a side:

| Arm | Seat | Mean a run | Median | Total of 3 |
|---|---|---|---|---|
| Before | Opus, `xhigh` | $1.986 | $2.078 | $5.959 |
| After | Sonnet, `xhigh` | $1.001 | $1.040 | $3.003 |

- Reading for the user's pin ruling: on this fixture the Sonnet seat costs about half of the Opus seat a dispatch
  ($1.00 against $1.99, saving about $0.99) and passes every step the Opus seat passes, except decisions-ledger at 2/3
  against 3/3 (a gap of 1, noise under the round's rule) and one-owner at 2/3 in both arms. That is evidence the pin
  is not worse on one seat at n=3; it is not a ruling for the other nine designers, whose trap lists and tasks differ.
  Nothing is committed.
- V's after arm costs less because the verifier no longer runs the E2E suite in its seat: $0.585 to $0.160 a run.
- T's after arm ($1.807 a run) against M's before arm ($1.986) is the trimmed text on the Opus seat, a drop of about
  $0.18 a run, inside the spread of 3 runs (the Opus runs' mean and median differ by $0.09).

## Spend

| Group | Runs | Expected (plan) | Spent |
|---|---|---|---|
| K checkpoint | 6 | $3.30 | $1.72 |
| V verifiers | 6 | $3.00 | $2.23 |
| S strategy | 6 | $2.10 | $1.27 |
| M model pins | 6 | $8.10 | $8.96 |
| N csharp | 8 (6 graded, 2 pre-fix smoke runs kept in the store) | $1.50 | $2.03 |
| I catalogues | 6 | $1.50 | $0.68 |
| P agents-md | 8 (6 graded, 2 pre-fix smoke runs kept in the store) | $2.40 | $1.83 |
| L dev-log (incl. the cut smoke case, $0.08) | 7 | $0.80 | $0.81 |
| T designer trims | 3 | $4.50 | $5.42 |
| Re-runs, the plan's allowance | - | $1.40 | - |
| Round | 56 (55 ok, 1 cut by its $0.01 cap) | $28.60 | $24.95 |

- Smoke $8.31, plus the P and N re-run after the smoke fixes $0.95, so $9.26; the reps $15.69. Total $24.95 of the
  $60 stop, $3.65 under the $28.60 expected, $35.05 under the stop. The $28.60 line was never crossed; the driver's
  token-hit counter read 0.
- The start condition (Task 13 Step 1, run before the reps): the paid rounds' actual spend so far plus $60 had to fit
  under $1,110. The ledger's sum: D8 $139.17 + the first prose round $65.29 + about $0.05 + about $1 + $0.03
  (three small billed probes dated 2026-11-21) + this round's smoke $8.31 = about $214, plus $60 = about $274, under
  $1,110. The commit-path A/B's evidence total, $4.41 (`docs/commit-path-ab-2026-11-04-evidence.md`), is not a term
  of the ledger's line; with it the sum is $218.26 and $278.26 with the stop, still under $1,110.
- The driver's cost rows repeat a shared before key per group, so a sum of cost rows double-counts; the figures above
  are the state's `spent` and `perGroup`.

## Reading

- **SKC2-05 (HOLD, reverted).** push-scope-first read 0/3 in both arms, a real failure: the first `receipt.js push`
  receipt of a run carried no `--scope` line in either arm, so the shorter clause could not be shown to help or hurt. By the round's R3 a failure in both arms on the item's own step is a HOLD, not a ship. The shorter clause
  came back out; the full clause and its fixture step stay at B_SHA text, and the question 'does a push receipt name
  its scope' waits for a fixture whose first push receipt can be graded alone.
- **SKC2-05a, SKC2-15, security:10 (SHIP, not shown to help).** The fixture commits and then pushes, so the
  receipt-cleared guard and the security rows were reached for the first time since the first round's hold (the
  commit-path fix made the commit reachable). Every guard step held 3/3 in both arms; push-receipt-cleared dipped by one
  run (3/3 to 2/3). Savings are about 600 characters a load (05a), 64 (15) and about 190 always-on (security:10).
- **A1 (SHIP, better).** The verifiers ran the minutes-long E2E suite inside the seat and did not name it as deferred;
  with the three verifier files and the protocol text changed, no-e2e-in-seat rose 1/3 to 3/3 and deferred-line 0/3 to
  3/3, at a cost drop from $0.585 to $0.160 a run. The protocol won (S1); the integration half - the data and .NET
  verifiers' integration runs under the same sentence - is for the user.
- **exec-signs (HOLD, reverted).** execution-line read 0/3 in both arms: the hand read of the smoke showed no
  `Execution:` line before the first edit in either arm, a real failure the Signs cut does not touch. one-agent read 3/3
  in both, though the fixture grants no Agent tool. Without a step that moves, nothing was shown, and the whole cut
  went back (S reverts whole: nothing to re-measure).
- **pins (EVIDENCE, not worse).** On the console seat the Sonnet `xhigh` arm halves the cost a dispatch and kept every
  step except a gap of 1 on decisions-ledger. The verdict is evidence for the user's pin ruling; no pin moved, and the
  three Opus reasoners were not measured.
- **csharp:13 (SHIP, not shown to help).** The new fixture asks for a guard clause that clashes with the project's
  stated preference. Both arms wrote `throw new ArgumentOutOfRangeException`, so the clash was reached; project-pref-wins
  held 3/3 both. The first round's `load-said` step stays out.
- **SKF2-11 (SHIP, not shown to help).** The Execution modes section is a pointer in both catalogues (about 250
  characters a copy, each load and each diagnoser dispatch). No seat was dispatched and the fan-out was read in all 6
  runs; signature-named rose 2/3 to 3/3 (noise).
- **agents-md:61 (SHIP, not shown to help).** All three steps held 3/3 both arms. The `.claude/AGENTS.md` write was
  denied in both arms (see the measured fact below), so a regression that shows only in the written file is not
  measured; the steps graded are the ones the run reaches.
- **dev-log:90 (SHIP, not shown to help).** no-invented-split held 3/3 both. asks-before-draft read 1/3 before and 0/3
  after, a gap of 1; the hand read of the smoke showed the after arm drafting before asking, and the before arm asking
  once as a text ask without a question mark (grader fix 4).
- **traps (SHIP, not shown to help).** The console trap list as pointers into `dotnet-hosted-services` held
  scope-per-unit, stopping-token and bounded-channel at 3/3 in both arms; the homes of each trap were read before the
  cut. Two traps kept their full text because their rule has no home (the `.Result` / `.Wait()` half of the blocking
  trap, the one-shot CLI exit code). Four small trims in the data, devops, winforms and wpf designers were left in
  place, since their spans differ from the other six.
- **restate (SHIP, not shown to help).** The task-design restatements (Design lean, the Decisions sentence, `Don't game
  it`) came out of all ten designers beside the same `task-design` preload; the console seat measures the generic text
  once for ten. one-owner rose 2/3 to 3/3, decisions-ledger held. Its verdict also measures task-design step 4's pointer
  to `design-rules.md`.

## Grader corrections from real runs

The smoke's hand read (one reader, read-only) went through every step that failed in both arms or in one arm. It found 4 real
failures (K push-scope-first, S execution-line, V no-e2e-in-seat before, L asks-before-draft after), 7 grader
failures and 2 fixtures that never reached their text, which made 8 fixes. The fix round (at most three rounds; all 8
fixes landed in round 1) was test-first: each grader fix started from a canned trace that failed, then went green, and
every stored smoke case was re-graded. The reps ran after it, so no rep was graded with an uncorrected grader.

1. K `git_push` / push-receipt-cleared: a `git push ...; node receipt.js clear push` in one call was read as a dry run
   or a missed clear. `git_push.text_not_match` now drops a `receipt.js ... push --verified|--waived` call, and the
   clear is checked by an `x_between` that accepts a same-call clear (`after_optional`).
2. K receipt-cleared: the clear sat in the same call as `git commit ...; receipt.js clear commit`; the step now accepts
   it the same way. The parent `habits-commit-checkpoint` fixture keeps the same-call blind spot (a deferred minor).
3. V no-e2e-in-seat: the matcher counted `cat e2e/run.mjs`. It now matches a run only: `npm|pnpm|yarn [run] test:e2e`,
   `node ...e2e/run` or `playwright test`. It is case-sensitive (`npx Playwright test` is a deferred minor).
4. L asks-before-draft: a text ask 'Pick one and I'll write the log right away:' has no question mark. The question
   pattern now also reads 'pick one', 'choose' and 'which one/option'.
5. M and T one-owner: `Program.cs` on a nested list line under `- **Files:**` was not read as an owner. A nested-list
   alternative is added to both graders; nested twice and nested under a 'Must not touch' header still fail.
6. T bounded-channel: a seat designing `BillingQueue(int capacity) // bounded, SingleReader/SingleWriter` and calling it
   'the channel' failed. The pattern gains a bounded-queue alternative; 'bounded pass', 'unbounded channel' and
   'Method (bounded)' traces still fail.
7. P (fixture setting): both arms had the Write to `.claude/AGENTS.md` denied under `dontAsk`. `Write(.claude/AGENTS.md)`
   and `Edit(.claude/AGENTS.md)` were added to the allowed tools - which did not lift the denial (next section).
8. N (fixture prompt): neither arm wrote a guard, so the preference clash never ran. The plain prompt now asks to
   'reject a negative discount'; the explicit and adverse prompts are unchanged. P and N were re-run: 4 cases, $0.95.

Review fixes before the billed smoke, each a grader gap found by a reviewer on a canned trace (RED then GREEN):

- S execution-line: the pattern failed the `**Execution**:` route form; six more forms are pinned.
- M and T bounded-channel: the first pattern passed 'unbounded', 'bounded pass' and 'Method (bounded)'; four fail
  traces and two echo traces now pin it.
- N project-pref-wins: the `tool_used` check failed a run that adds no guard; no-guard, silent `ThrowIf` and
  ask-then-helper traces now pin it.
- L no-invented-split: the pattern could not cross the weekday line break; a skill-shaped log with per-ticket hours
  now fails.
- K scaffold (fixture): the scaffold's admin test went red under the uncommitted change in both probes, so a run could
  never commit; fixed (root 2/1 to 3/0, admin 0/1 to 1/0).

Deferred minors: the K push-receipt matcher counts only `receipt.js push` (a hand-written PUSH-GATE with `scope:`
would fail push-scope-first in both arms); a V verdict reads any `deferred_runs` sentence; the 40-character window in
bounded-channel can still join 'bounded pass' and a channel on one line; the N prefs document lives under a
git-ignored folder; P grades `Write` only; the L fixture has no Bash for its total-time script; an infra retry's first
try is overwritten in `result.json`.

## A measured fact: an allow rule did not lift the `.claude/` write protection

In `claude -p` under `dontAsk` on Claude Code 2.1.330, a `Write` to `.claude/AGENTS.md` was denied in both arms of the
P fixture although `Write(.claude/AGENTS.md)` and `Edit(.claude/AGENTS.md)` were in the run's allowed tools (and `Write` was
allowed). An allow rule does not lift the `.claude/` write protection there. The round ran P as it stood: the denial
is the same in both arms, so it adds noise, not bias; the steps that grade (claude-md-kept, load-note, facts-written)
do not need the write to land. A fixture that must see a written file under `.claude/` should write it elsewhere in
the project or grade the attempt.

## Closed without a run

The plan's 22-row appendix: 13 measured (one as evidence only), 8 ruled out, 1 for the user.

| Row | Disposition | Reason |
|---|---|---|
| capture-usage-report :50 (row 2) | out | manual-only (`disable-model-invocation`); a fake-transcript fixture costs about $5, about $11 at the tail, for about 600 characters on a manual run (S3) |
| `dotnet-code-quality` preload, the five .NET verifiers (row 9) | out | AG-03 measured the move WORSE on cost (+10.8% on the verifier probe); the skill is unseeded, so the cut drops it from installs (S3) |
| `dotnet-migrate` preload, the data seats (row 10) | out | AG-03: the designer arm +11.7% on cost (S3) |
| the resolvers' root-cause carve-out (row 13) | out | about 250 characters x4 a resolver dispatch, for a .NET fixture of about $0.80 a run and a registry move (S3) |
| security-auditor platform rows (row 14) | out | an Opus `xhigh` seat dispatched in 0 of 6 AG-09 runs, about $12 expected (S3) |
| interaction:17 (row 16) | out | its act is a question typed while the work runs; `--resume` hands over its second prompt only after a turn ends, a different act (S2) |
| interaction:26 (row 17) | out | multi-turn; the guard-answer format ask restates it by name, so its cut also changes a hook's text (S2) |
| interaction:27 (row 18) | out | multi-turn (S2) |
| habits-explain-topic Language :172-176 (row 7) | needs the user | reached only by a non-English prompt, which the house's English-only rule for fixtures does not allow without a ruling (S3) |

A1's integration half - the same protocol sentence covering the data and .NET verifiers' integration runs - also
waits for the user. interaction:23, the first round's sixth rider, is not a row of this round (no hook check fixes any
of its clauses).

## Not run

- **The three Opus reasoners** (`issue-diagnoser-ci`, `issue-diagnoser-runtime`, `security-auditor`) in group M: no
  fixture dispatches them (S4); M measures the console designer only.
- **The other nine designers' pins**: one seat at n=3 does not stand for ten (S4); the user rules on all ten.
- **A re-run of group K without the PUSH-GATE sentence**: its after arm is a strict subset of the text measured, with
  no WORSE row (the U37 ruling of the first round). Not re-measured.
- **A re-measure of exec-signs**: the cut was reverted whole; nothing remains to measure.
- **The levels phase**: every fixture ran one level (S6), so a regression visible only at another level ships
  unmeasured (the round accepts it, as the first round's R2 does).
- **The four small trims left in place** (the `Don't game it` spans of the data, devops, winforms and wpf designers):
  the plan did not quote them, so they were not cut and not measured.
- **The nine other designers' trap lists** (S9): each designer's list is its own, so they wait.
- **A fixture that reads the written `.claude/AGENTS.md`** (P): see the measured fact.
- **The full `npm test` and any push, merge or version bump**: not part of this file; commits come after it.
