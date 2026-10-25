# habits-output-scorer - calibration evidence

The S8 calibration of the output scorer, run on 2026-10-25: every fixture under
`meta/skill-comply/habits-output-scorer/fixtures/` graded by a real `output-scorer` seat and passed through
`scorecard.js grade --level 80`. It covers what AC8 and AC12 ask, the spread that set `NOISE_BAND`, each grade's
tokens, and the assumptions (AS3, AS8, AS9, AS11) the spec left for a real run to settle. Audit material: read it to
learn why the band is 15 and what one grade costs, never to run the skill.

## How it ran

- Claude Code 2.1.310. The parent session and every seat ran on Sonnet 5.5 (`claude-sonnet-5-5`, the seat's pin).
- One throwaway JavaScript project per run (`scripts/profile-fixture.js javascript`, installed from this tree on an
  isolated account dir), the fixture code laid down by `scaffold.sh`, its docs root under `.alfred/docs`.
- A batch was one nested `claude -p` session with a pre-assigned `--session-id`, `--permission-mode auto`, `--model
  sonnet`. Per grade, `scorecard.js start` ran first (so the seal's folder carried the batch's session id), the
  fixture's TASK and DRAFT were written to the files it printed, and the parent dispatched every brief to its own
  `alfred-code:output-scorer` seat in one message. After the session, `scorecard.js grade --level 80` read each
  sealed score file.
- 13 batches, 66 seat grades: 36 on the twelve strong fixtures' final drafts (three each), 17 on earlier drafts of
  eight of them, 13 on the planted fixtures (one each).
- A seat's tokens are summed from its own transcript under `<account>/projects/<project>/<session>/subagents/`,
  one usage per message id. A transcript writes one row per content block, each repeating the message's usage:
  summing rows counted the same tokens three to four times. Counted per message id, the seats plus the parent equal
  the session's `modelUsage` exactly, in all 13 batches.

## Strong fixtures (AC8, AC12)

Each strong fixture graded three times on its final draft. 'Passes' is at level 80.

| Fixture | Totals | Mean | Spread | Passes | Tokens per grade | USD per grade |
|---|---|---|---|---|---|---|
| designer-plan-strong-code | 90, 100, 100 | 96.7 | 10 | 3/3 | 191k, 181k, 321k | 0.30, 0.28, 0.38 |
| designer-plan-strong-doc | 100, 100, 100 | 100 | 0 | 3/3 | 392k, 212k, 218k | 0.28, 0.23, 0.27 |
| root-cause-strong-proven | 100, 100, 100 | 100 | 0 | 3/3 | 119k, 177k, 125k | 0.12, 0.15, 0.13 |
| root-cause-strong-unproven | 100, 100, 100 | 100 | 0 | 3/3 | 199k, 102k, 163k | 0.24, 0.18, 0.21 |
| inline-plan-strong | 100, 100, 100 | 100 | 0 | 3/3 | 155k, 151k, 149k | 0.17, 0.13, 0.13 |
| topic-explainer-strong-within-budget | 100, 100, 100 | 100 | 0 | 3/3 | 112k, 129k, 134k | 0.11, 0.13, 0.11 |
| topic-explainer-strong-code-track | 100, 100, 100 | 100 | 0 | 3/3 | 274k, 131k, 231k | 0.27, 0.18, 0.22 |
| topic-explainer-strong-topic-track | 100, 100, 100 | 100 | 0 | 3/3 | 99k, 183k, 181k | 0.20, 0.22, 0.20 |
| ticket-strong | 100, 100, 100 | 100 | 0 | 3/3 | 141k, 199k, 178k | 0.15, 0.16, 0.18 |
| upgrade-plan-strong | 85, 100, 85 | 90 | 15 | 3/3 | 539k, 418k, 492k | 0.45, 0.46, 0.46 |
| pick-strong | 100, 85, 85 | 90 | 15 | 3/3 | 73k, 190k, 97k | 0.16, 0.24, 0.19 |
| custom-strong | 100, 88, 100 | 96 | 12 | 3/3 | 231k, 261k, 192k | 0.20, 0.25, 0.21 |

- AC8, strong half: met - every strong fixture passes on the mean of its three grades and on all three of them.
- AC12: met - the within-budget, code-track and topic-track answers, the code and documentation plans and the
  proven and unproven verdicts each reach 100 (the code plan on two of its three grades).
- Where a total moved, exactly one check flipped, so each spread is that check's weight:
  - upgrade U6 (15): a stage 2 rollback `git restore` cannot reach while stage 1 is uncommitted;
  - pick K5 (15): a deciding reason that presumes the UI choice the brief left to the user;
  - custom X6 (12.5): the backup window was never asked about;
  - designer-plan P9 (10): no test fails on a missing reason, though the ask says 'required'.

  Each is a real gap that the 100-grade seats did not name. So the spread is the grader catching a real gap on some
  grades and missing it on others.

## The noise band

`NOISE_BAND` is 15, the widest spread above (pick and upgrade, 85 to 100). At level 80 a fail from 65 to 79 with no
BLOCKER is graded once more by a fresh seat and the round decided on the mean; 64 and under revises. Proven on an
install from this tree: the real 70 grade of `upgrade-plan-no-rollback` printed `regrade`, where the 5-point band of
the earlier install printed `revise`; a second `next` wrote nothing; the regrade by a real 100 grade released at a
mean of 85.

## Planted fixtures (AC8)

Each planted fixture graded once. Every one fails, with its planted flaw named as a BLOCKER or MATERIAL.

| Fixture | Planted flaw | Total | Checks failed | The finding that names it | Tokens | USD |
|---|---|---|---|---|---|---|
| designer-plan-blocker | Task 1 drops and recreates the orders table | 60 | P5, P7, P8, P9, P12, P14 | BLOCKER 'Task 1 migration destroys every existing order' | 217k | 0.32 |
| designer-plan-overscoped | Express and a DI container nobody asked for | 35 | P4-P9, P11, P12, P14, P16 | MATERIAL 'Two of three cards are unrequested framework work' | 172k | 0.25 |
| designer-plan-weakness | a new concatenated query, a second case of W1 | 55 | P4, P5, P7, P8, P9, P14, P16 | BLOCKER 'Task 2 builds the customer query by concatenating a URL parameter into SQL' | 131k | 0.20 |
| designer-plan-preference | the route calls the repository, against A1 | 60 | P5, P8, P14, P15 | BLOCKER 'The route handler is planned to call the repository directly, against A1' | 134k | 0.22 |
| root-cause-no-evidence | the verdict quotes nothing | 40 | D2, D3, D5, D6, D8 | MATERIAL 'Proven verdict carries no quoted evidence' | 236k | 0.25 |
| root-cause-assessment-proof | the W1 entry stands in for evidence | 50 | D2, D3, D5, D6 | BLOCKER 'The proven verdict rests only on an assessment entry' | 154k | 0.18 |
| inline-plan-missing-dependency | two subtasks edit one file | 60 | I1, I2 | BLOCKER 'The shared-file dependency is missed' | 123k | 0.14 |
| topic-explainer-invented-claim | `db.run` said to retry three times | 60 | A1, A9, A10, A12 | BLOCKER 'The whole answer describes a retry mechanism that does not exist' | 237k | 0.18 |
| topic-explainer-expert-for-child | B-trees for 'like for a 6-year-old' | 25 | A2-A5, A7, A8, A10-A12 | BLOCKER 'Expert-level answer to a 6-year-old request' | 118k | 0.13 |
| ticket-new-class | the ticket names new classes to write | 60 | T3, T4, T6 | MATERIAL 'The Scope prescribes new units' | 177k | 0.17 |
| upgrade-plan-no-rollback | no stage names a rollback point | 70 | U3, U6 | MATERIAL 'No stage names a rollback point' | 245k | 0.27 |
| pick-ignores-constraint | the pick needs the internet the brief rules out | 60 | K3 | BLOCKER 'The recommended option cannot meet the brief's no-internet requirement' | 93k | 0.13 |
| custom-invented-claim | a backup script the repository does not hold | 13 | X1-X6, X8 | BLOCKER 'Invented backup tooling' | 208k | 0.19 |

AC8's named checks all fail where it says: the over-scoped plan on P11, the weakness-repeating plan on P16, the
preference-breaking plan on P15, the assessment-as-proof verdict on D2, the wrong-depth answer on A2.

## Strong drafts changed during the run

A strong fixture was edited only where a seat's `no` held up against the draft and the rubric on a re-read; each
edit was then graded three times again. The first grades of the earlier drafts:

- designer-plan-strong-code, 80: the column was never named, no test proved the reason crossed the route-to-service
  and service-to-repository seams, a non-string reason and a re-cancel were unhandled, and two decisions carried no
  precedent marker.
- designer-plan-strong-doc, 95: the Build line named no gate command (P3).
- custom-strong, 63: the database engine was guessed without a label, and a fifth step ran the migration itself with
  no way back.
- pick-strong, 80: the recommendation's reason did not separate it from the alternative, and the one-time install
  on a machine with no internet went unaddressed.
- ticket-strong, 88: the problem stated an error string as observed, though the TASK never gave it.
- upgrade-plan-strong, 85: the target majors' breaking changes were never read, the rollbacks leaned on commits the
  plan never made, and nothing beyond the suite loaded the other modules. Rewritten from the Node 19-22
  changelogs, with a baseline stage, a load check of every module and a rollback per stage.
- topic-explainer-strong-topic-track, 92: the child level was not met. Rewritten at child level, then 83 three
  times: the first sentence did not answer the question, and three steps did not say why.
- topic-explainer-strong-code-track, 83: the core-concept sentence was false, a claim that `shipped` is set
  elsewhere was unlabelled, and the failure path was missing. Then 92 three times: the walkthrough skipped
  `setStatus(id, 'cancelled')`, gave an invented reason as the project's, and played W1 down. Then 92 three times
  again: the new worked example claimed a read the unquoted `findById` cannot make.

The three-times-92 and three-times-83 runs are the grader agreeing with itself on a real flaw: spread 0, so they are
left out of the band.

## Assumptions settled

- AS2 holds: two seats tried `Bash` (one `true`, one `ls -a` of the project), and both were refused with 'No such
  tool available: Bash'. The seat's allowlist is `LSP, Read, Grep, Glob, WebFetch`.
- AS3 VERIFIED: all 66 seat transcripts open on their own brief and hold no parent turn and no line of the parent's
  prompt. A dispatch naming `alfred-code:output-scorer` did not fork.
- AS8 VERIFIED: in every batch the seal rows sit in the hook-blocks ledger under the batch's own session id, so the
  seal's folder check and the session id `start` was given name the same folder.
- AS9 VERIFIED, both routes: 66 seals written, 53 from the seat's `SubagentHandback` call at PreToolUse and 13 at
  SubagentStop from `last_assistant_message`, where the seat ended on text before its hand-back. In the pilot the
  sealed text, the seat's last text and its hand-back message were byte-identical (10,608 chars).
- AS11 VERIFIED: a UserPromptSubmit probe hook in a throwaway project captured `prompt` as
  '/habits-output-scorer explain in two sentences what src/index.js exports', slash word kept, and the 'scorer:
  stacked' line reached the model request ($0.14).

## Cost

- The 13 sessions billed $17.71 at list price (`total_cost_usd`, which counts the seats: see How it ran), charged
  to the subscription's plan limits through a `claude setup-token` token rather than an API key.
- One grade: median 181k tokens and $0.20, range 73k-564k and $0.11-0.46. The seats' cache writes are at the 5m
  rate; the parent's at the 1h rate.
- Upgrade plans cost the most ($0.45 each): their seats made 11-17 `WebFetch` calls to re-read the changelogs the
  plan cites. A pick made 2-3.
- Against AS6 (Opus, one grade of a 250-300-line design, 159,572-279,972 tokens): the Sonnet seat graded the
  60-80-line designer plans in 131k-392k tokens.

## The loop replay (2026-10-25)

One billed `skill-comply replay` of the plain prompt (the task in the user's words, the skill unnamed) on a fresh
copy-route install of b2e689e2, with `ALFRED_CODE_SCORER_ROUNDS=1` in the project's `settings.local.json`: one
`claude -p` session, Sonnet 5.5 for the session and the seat, 23 turns, $0.69 by the CLI's `total_cost_usd` (the
seat included), about 70 seconds.

- The `scorer: on` line fired the loop with no prompt naming it: `start`, TASK, the draft, ONE background
  `output-scorer` seat, and the turn closed on `Scoring designer-plan - the grader is running`. The completion
  notification resumed the loop in print mode.
- The grade passed at 80 with five MATERIALs tagged `[closable]`, so `next` printed `offer-fix <id> recommend
  release`: at rounds 1 no run is left. The model put 'Use it as it is (Recommended)' first and 'Fix them first'
  second. Print mode disables AskUserQuestion, so it fell back to plain-text options. No plan file was written, and
  `rounds.log` ends on `asked <id> offer-fix`.
- The first plain-text close left out the `Scored:` line. The backstop held it once (`branch: scorer`), and the
  rewrite carried it.
- `expect.json`: 5 of 5 graded steps followed - the seat graded, `next` came before any plan write, no plan after a
  withhold or while the fix is offered, and `answers.md` written at most once.

## The A/B (2026-10-25)

The question: does scoring make better plans? Six plain-prompt plan tasks on the scaffold's orders service (a cancel
reason, an order lookup, refunds, a list by status, a column rename with no downtime, an order history table). Each
task ran once with `ALFRED_CODE_SCORER` `0` and once with `1`, set in `settings.local.json` of a fresh copy-route
install of 113ab6f3. Sonnet 5.5 ran the session and the seat, under `claude -p`, with a $6 cap per run. A run that
stopped on a question was resumed with 'Take the recommended option on every question.', at most four times. The
judge was Opus 5.5, blind:

- It worked in a bare copy of the scaffold, with no stack install.
- It saw both plans with the `Scored:` / `Open:` / `Fix:` lines, the scorer's name and the `Captured:` line removed.
- It ran twice per task, A and B swapped, and scored five criteria from 1 to 5: correct about the code, meets the task,
  safe to apply, buildable, in scope.

A task is won only when both orders prefer the same arm. The rule was fixed before the run: scoring helps when on
wins 4 or more tasks and off at most 1.

| Task | On: first grade -> released | Winner | Where it was decided |
|---|---|---|---|
| cancel reason | 75 -> 90 | on | safe 5 vs 3: off breaks the cancel path between tasks, no deploy order |
| order lookup | 0 -> 80, inline | off | both 5 on every criterion; off's null-to-404 needs no new error class |
| refunds | 75 -> 95 | on | safe and buildable, despite one false claim in on |
| list by status | 70 -> 80 | on | buildable 4 vs 2.5, safe 4 vs 3.5 |
| column rename | 60 -> 85 | on | safe 5 vs 2.5, off makes two false claims |
| order history | 65 -> 90 | on | safe 4 vs 3 |

- **Verdict: scoring helps, 5 to 1.** Every task was decided in both orders. No judge reply failed to parse.
- **How strong it is.** A calibration pair - two scoring-off runs of the cancel task, judged the same way - also got
  a winner in both orders. So the judge separates any two runs, not only two arms. Under that null, where every task
  gets a winner at even odds, a 5-1 or 6-0 for on comes up 7 times in 64 (about 11%). That makes this suggestive
  evidence from one run per task, not proof.
- **What scoring changed.** On won on safe to apply and buildable: task orders that keep the real path working, a
  deploy order and rollback, and tests that fail first. These are the rubric's own checks. Every on draft started
  under the level 80 (0-75) and was released at 80-95. Four runs re-graded, two answered a question into a second
  attempt, four were offered a fix, and one took it. None was withheld.
- **False claims.** The judge found false claims in 3 on tasks and 1 off task. Four of the on arm's six, and the
  calibration copy's two, name stack files that exist in the planning project but not in the judge's bare folder
  (`.claude/hooks/docs.js`, `alfred-quality-gates.md`). That is an artifact of the judge folder, and it cut against
  the arm that won. Refunds' on claim is real: an integration test outside `test/` that `node --test` still picks
  up. So are the rename off plan's two.
- **The lost task.** With scoring on, the order-lookup session loaded the scorer, never the plan skill, and treated
  the task as an inline plan, so no plan file was written. The inline rubric scored its first draft 0 (I1-I5 all
  no). The answered question lifted it to 80, and it was released in chat. The judge preferred the off plan file by
  a narrow margin. The resumes then had nothing on disk to move, so the driver cut the run, and the judge read the
  released draft.
- **Cost.** With scoring on, a plan cost $1.67 on average ($0.92-2.15) and took 6-15 minutes. With it off, a plan
  cost $0.18 and took under a minute. That is about 9 times the spend. The whole A/B billed $14.89 at list price:
  $11.31 for 13 plan runs and $3.58 for 14 judge runs. It was charged to the subscription through the setup-token.
- **Assumptions:**
  - A resume moved the loop on.
  - A resumed call's `total_cost_usd` holds the earlier spend (the same Haiku $0.0014 on both rows).
  - The off arm wrote a plan file.
  - The judge logged in under its own config, read the project files, and was refused Bash by `dontAsk`.
  - The plain prompt fired the plan skill in 11 of 12 runs; the order-lookup on run is the miss.
- **Following the spec:** `ALFRED_CODE_SCORER` stays seeded `0`. Turning it on by default is the user's separate
  ruling.

## The A/B, phase 2: three runs per task (2026-10-25)

Phase 1 could not tell an arm effect from run-to-run spread, so the user asked for three runs per task. The setup
was the same: tasks, flags, caps, resume rule, judge, rubric and blinding. The changes:

- Two more runs per arm per task, on a fresh install at 5c208912 (its `stack/` and `scripts/` equal 113ab6f3's).
  Phase 1's second off run of the cancel task served as that task's second off run.
- 18 pairs, each pairing off run r with on run r, plus 6 same-arm pairs (off run 2 vs off run 3), all judged anew.
  Phase 1's judgments stay as its record and are not counted.
- The judge folder now carries a mirror of a fresh install's `.claude/` under `house/`, read-only. It has no
  settings, no CLAUDE.md, none of the scorer's 14 files and no line naming the scorer or the loop. The tell grep was
  run over the mirror and every hit was read; the hits left are the review skills' own scores and severity scale,
  and the docs engine's ranking code. A ninth fact tells the judge where the mirror is.
- The rule was set before any phase 2 call: scoring helps when on wins 14 or more of the 18 pairs, a pair counting
  only when both orders agree. That comes up 1.5% of the time under a coin-flip null.

The result:

- **Verdict: scoring helps - on 14, off 3, 1 split.** That is exactly at the bar.
- **The null is the coin flip.** 5 of the 6 same-arm pairs also got a winner in both orders, and 1 split. So the
  judge picks a side on nearly every pair, and 14 of 18 is about 1.5% by chance.
- **Effect size.** Summed over the five criteria (5-25), on scored 2.19 more than off on average. Two off runs of one
  task differed by 1.00. Per criterion, on minus off:

  | Safe to apply | Buildable | Correct about the code | Meets the task | In scope |
  |---|---|---|---|---|
  | +1.03 | +1.06 | +0.19 | +0.19 | -0.28 |

  So the scored plans add a little more than asked.
- **Every off win was an inline plan.** In 3 of 18 runs with scoring on, the session went to an inline plan with no
  plan file: the cancel task's run 3, and the order lookup's runs 1 and 3. Those three lost, by -1.33 on average.
  Where the scored session wrote a plan file, it won 14 of 15 pairs (the 15th split), by +2.90 on average.
- **By task (run 1 / 2 / 3):**

  | Cancel reason | Order lookup | Refunds | List by status | Column rename | Order history |
  |---|---|---|---|---|---|
  | on / on / off | off / on / off | split / on / on | on / on / on | on / on / on | on / on / on |
- **False claims, with the mirror in place.** Scored plans made 4 false claims across 2 pairs; unscored plans made 15
  across 6. The phase 1 claims about `.claude/hooks/docs.js` did not come back.
- **Cost.** Over all 18 runs per arm, a scored plan cost $1.67 on average and took 11.7 minutes (3-24). An unscored
  plan cost $0.18 and took under a minute. Phase 2 billed $35.24: $22.04 for 23 plan runs and $13.20 for 48 judge
  runs. Both phases came to $50.13 at list price, charged to the subscription through the setup-token.
- **Two cut runs, both inline.** The cancel task's run 3 used all four resumes. The order lookup's run 3 was released
  'accepted below the level' and then had nothing on disk to move. Each was judged on its newest released draft.
- **Judge.** In both phases the Opus judge stayed read-only. Claude Code ran one read-only `find` / `cat` under
  `dontAsk` and refused a looping command, and every judge folder was unchanged.
- **What follows:**
  - The scorer makes plan files safer to apply and easier to build, at about 9 times the cost.
  - The inline-plan route is the weak spot. A plain 'write an implementation plan' request with scoring on should
    reach the plan skill and its plan file every time, not 15 times in 18.
  - `ALFRED_CODE_SCORER` stays seeded `0`. Turning it on by default is the user's ruling.

## Not run

- The withhold path: every A/B run released its draft. Revise, re-grade, the fix after an offer and an answered
  question opening a second attempt ran in the A/B (above), through resumed `claude -p` calls.
- An interactive (non-`-p`) session and the default permission mode: every batch, the replay and the A/B ran under
  `claude -p`.
