# Prose A/B round - the E-batch wording and five ab-G riders (2026-11-04)

The E-batch inventories (`docs/superpowers/specs/2026-11-03-e-batch-inventory-a.md`, `-b.md`) left wording items
and two body-cap moves with 'A/B pending', and the 2026-10-20b audit left trims as ab-G rows. These runs put each
group's changed text to Sonnet with and without it, graded per step by purpose-built fixtures. Audit material: read
it to learn why an item shipped or was held, never to run a skill.

## Method

- Claude Code 2.1.318, Sonnet 5.5 (`claude-sonnet-5-5`) at `--effort high`, one `claude -p` per run on the
  subscription login, a throwaway account dir (`HOME`, `CLAUDE_CONFIG_DIR`) and a throwaway project per run under
  `<R>` = `<os.tmpdir()>/alfred-prose-ab`, a `--max-budget-usd` cap on every call, the parent session's `CLAUDE_*`,
  `ANTHROPIC_*` and `ALFRED_CODE_*` variables dropped. Each run is `scripts/skill-comply.js replay`'s plan: the
  arm's export installed on the copy route, the fixture's `scaffold.sh`, the level's prompt.
- **Arms.** Before = `develop` at B_SHA `df3e9673`. After, per group = B_SHA plus that group's files only, so a
  loss is attributed to its group; the before arm of a shared fixture is one arm for every group (R1). Group D's
  re-run laid `2a429343`'s `guard-ungated-commit.js` over BOTH arms (the clearer refusal, so the commit step could
  be reached); only that file differed from B_SHA in its before arm.
- **Graders.** One fixture per behaviour under `meta/skill-comply/`, each step bound to the item it measures
  (`owners`); a guard step no item owns reverts every item its fixture reaches. Every stored run was re-graded
  offline with the final graders after the corrections below.
- **Levels.** Plain (the task, no hint); adverse where the item is a discipline under pressure; explicit where plain
  never reached the text. Three runs per arm per level. A step is WORSE when before minus after, pooled over the
  levels both arms ran, is 2 or more; a step failing in both arms is INCONCLUSIVE, never not-worse (R2, R3).

## Results

Steps not listed passed in every run of both arms ('same', 3/3 each).

| Item | Fixture - step | Level | Before | After | Verdict |
|---|---|---|---|---|---|
| CAP-1 - task-solve's FULL spec definition moves to `references/full-spec.md` | `task-solve` - every step | plain + adverse | | | SHIP - not shown to help |
| U31 - the approve ask carries the fresh option | `task-solve-approve-fresh` - fresh-option | explicit | 0/3 | 2/3 | SHIP - better |
| | fresh-marked-first | explicit | 0/3 | 1/3 | |
| U34 - a bare `/task-solve` asks for the task | `task-solve-empty` - asks-for-task | adverse | 2/3 | 3/3 | SHIP - not shown to help |
| group A guards | `task-solve` - size-first / spec-line / plan-file | adverse | 0/3, 1/3, 0/3 | 2/3, 3/3, 2/3 | better |
| | spec-line / plan-file | plain | 3/3, 2/3 | 2/3, 1/3 | gap 1, noise |
| CAP-2 - task-design's cited-source and ownership rules move to `references/design-rules.md` | `task-design-cited-card` - verify-mapped | adverse | 3/3 | 2/3 | SHIP - not shown to help (gap 1) |
| ab-Q2 - the designer seats cite a preference row id, never an invented one | `designer-seat-decisions` - pref-row-id, no-invented-id | plain | 3/3 | 3/3 | SHIP - not shown to help |
| | verify-mapped | plain | 1/3 | 1/3 | same |
| U33 - the diagnose close carries its `Execution:` line | `issue-diagnoser-plan-close` - every step | plain + adverse | 3/3 | 3/3 | SHIP - not shown to help |
| U37 - the VERIFIED phrase says what ran on what | `habits-commit-checkpoint-split` - claim-backed | plain + adverse | 6/6 | 6/6 | SHIP - not shown to help |
| SKC2-05a - the review and batch rules move to the checkpoint's evidence reference | `habits-commit-checkpoint` - receipt-cleared (guard) | plain | 0/3 | 0/3 | HOLD - INCONCLUSIVE, reverted |
| SKC2-15 - the receipt.js history clause goes | same guard | plain | 0/3 | 0/3 | HOLD - reverted |
| security:10 - the always-on security bullet points at the checkpoint | same guard | plain | 0/3 | 0/3 | HOLD - reverted |
| U35 - a background wait names its watch and ETA; no permission re-ask; the literal example first | `interaction-literal-example` - example-first | adverse | 0/3 | 2/3 | SHIP - better |
| | `background-wait` - monitor | plain / adverse | 0/3, 0/3 | 0/3, 1/3 | pooled 0/6 to 1/6 |
| | eta / answer | adverse | 1/3, 3/3 | 0/3, 2/3 | gap 1, noise |
| U19b - a git correction is captured, never memory-only | `preferences-git-correction` - every step | plain + adverse | 3/3 | 3/3 | SHIP - not shown to help |
| U19c - a branch pattern is checked against the real branches | `preferences-branch-pattern` - no-silent-pattern | plain + adverse | 0/6 | 6/6 | SHIP - better |
| sc-13 - the scorer's background wording | `mode-output-scorer` - every step | plain | 3/3 | 3/3 | SHIP - not shown to help |
| AR-2 - SKC-12's dropped 'installs' trigger (arms reversed, R7) | `capture-awareness-installs` - fires | plain, explicit, adverse | 3/3 each | 3/3 each | CLOSE - not worse, nothing committed |
| csharp:13 - the csharp skill's project-preferences line trimmed | `csharp` - load-said | plain | 0/3 | 0/3 | HOLD - INCONCLUSIVE, reverted |

No step was WORSE.

## Spend

| Group | Runs | Spent |
|---|---|---|
| A task-solve | 38 | $8.46 |
| B designer | 32 | $22.57 |
| C diagnose | 12 | $2.33 |
| D commit (incl. the 18-run re-run) | 38 | $14.82 |
| E interaction | 44 | $5.27 |
| F preferences | 24 | $2.72 |
| G scorer | 6 | $4.68 |
| H trigger | 19 | $3.08 |
| J csharp | 6 | $1.35 |
| Round | 219 (plus 18 prep failures booked at $0) | $65.29, past the $60 line, under the $130 stop |

## Reading

- **Group A.** CAP-1 is a move to make room; U31's fresh option appeared where it never did (explicit 0/3 to 2/3)
  and the adverse size, spec and plan-file steps rose. Plain dips of one run are noise under R2.
- **Group B.** Both moves held every step; the seat's verify-mapped sat at 1/3 in both arms.
- **Group C, F, G.** U33, U19b and sc-13 held a ceiling; U19c turned a silent branch pattern into a checked one in
  every run.
- **Group D.** No checkpoint run in either arm committed (4 to 12 refusals each). The commit guard counted one
  `Findings:` line per reply, while the checkpoint loads review-code and review-security back to back, and most
  runs kept the reports in thinking: the receipt-cleared guard was never reached, so the three trims are held for
  a fixture that commits (the guard fix and the checkpoint's own step are a separate change). U37 ships on its own
  steps; the hold leaves its after arm as B_SHA plus U37's two lines, a subset of the text measured, so it was not
  re-run.
- **Group E.** U35's literal-example rule took effect under pressure (0/3 to 2/3); the Monitor step stays near zero
  in both arms - two sleep-polls and no Monitor call across eight runs read by hand.
- **Group J.** csharp loaded first in all six runs and never said so: the trim is held.

## Grader corrections from real runs

Each was a grader gap, fixed test-first; every stored run was re-graded, which flipped exactly five stored grades
FAIL to PASS and changed no verdict.

- cited-card one-owner counted a forbid of `src/routes.js` on another task's `files:` line as a second owner.
- formatter-fresh: the fixture's formatter has no check mode, so the trailing-whitespace grep both arms ran is the
  check; a receipt naming `npm run format` no longer reads as a formatter run.
- cited-card verify-mapped read a zero-orders header literal as a difference between arms.

## Not run

- **A re-run of group D after the hold** - ruled out above.
- **ab-G round 2** - the 18 R2 rows of the triage, planned separately under a $60 stop.
- **conventions-applied** (csharp) - an llm grader step, NOT GRADED offline; by the round's ruling it decides
  nothing, so J was judged on load-said and its guard steps.
- **ab-G3 interaction:23** (a shorter ask bullet) - dropped before the round: each of its clauses is also enforced
  by `guard-stop-contract.js` (the `(Recommended)` count and place, the mark against a 'Recommended:' clause, the
  type-into-Other wording), but no clause has a hook home that would let the rule line go, so nothing was cut.

## Closed without a run

The 2026-10-20b audit's ab-G rows this round closed by a commit already made, or set aside as not worth a run.

| Row | Disposition | Commit or reason |
|---|---|---|
| ab-G1 dotnet-testing licensing | done | 32780bfd, e7d4046d |
| ab-G1 dotnet-hosted-services Channels | done | 32780bfd |
| ab-G1 web-backend, winforms, wpf, security, mvc-controllers, grpc | moot | graded A (96-99) by the 2026-10-30 audit, no trim named |
| ab-G1 SKF2-15 task-implement | done | 4d73ecab |
| ab-G1 capture-architecture | moot | retired into capture-awareness, b8799425 |
| ab-G1 capture-code-quality JUDGE paragraph | done | 0991ada7 |
| ab-G1 capture-test-coverage Analysis bullet | done | 0991ada7 |
| ab-G1 preload trims (angular, database, ionic, typescript / javascript) | superseded | AG-03 WORSE, reverted febe328a |
| ab-G1 SKS2-06 npm | done | 3a0a7f56 |
| ab-G1 SKC2-10 first-look paragraph | moot | capture-first-look retired, a4f2bea2 |
| ab-G2 csharp-design-patterns in the .NET designers | superseded | AG-03, reverted febe328a |
| ab-G2 the implementers' preload weight | superseded | AG-03 WORSE |
| ab-G2 the ionic 47 KB preload | superseded | AG-03 |
| ab-G3 git:9 / :11 | done | 880d078b |
| ab-G3 security:22 | superseded | RU-13 NOT-WORSE, 1350c567 |
| ab-G3 docs-root:7 | superseded | RU-05 NOT-WORSE, efb2f2fc |
| ab-G3 docs-root:10 | superseded | RU-05 WORSE, reverted 9a6c339d |
| ab-G3 quality-gates:10 | superseded | RU-10 NOT-WORSE, 8592eeae |
| ab-G3 repair-router trims | superseded | RU-08 WORSE, reverted 3b5dc1bf |
| ab-G4 guard-answer BUDGET_TEXT | closed | three of its four clauses are the user's pinned rulings; the fourth saves about 70 characters a prompt |
| ab-G4 memory-session start size | moot | hook retired, 17ed6684 |
| ab-G1 loop-architecture-quality / loop-code-quality | not worth a run | no audit names a block to cut |
| ab-G1 habits-code-comments examples | not worth a run | the C# and TSDoc pair is one pattern in two languages |
| ab-G1 Fhabits-7 root-cause description | not worth a run | -10 characters of a description |
| ab-G1 SKS2-10 ionic description | not worth a run | +3 characters |
| ab-G1 `paths:` frontmatter candidate | not worth a run | SKS-03 measured the rule line beating description routing, 0/6 to 6/6 |
| ab-G3 interaction:49 | not worth a run | the small-task list is what a task is judged by before any skill loads, 140 characters |
| ab-G3 capabilities usage-policy line 2 | not worth a run | no scaffold writes the awareness doc, and its policy rev bumps |
| ab-G4 docs-session start size | not worth a run | no audit names the lines |
| ab-G4 secret-guard stream-pipe noise | free, not billed | deterministic hook output, proven by its hook suite once a change is named |

The 18 rows left for ab-G round 2 are listed in its plan, `docs/superpowers/plans/2026-11-04-ab-g-round-2.md`
(git-ignored), under a $60 stop.
