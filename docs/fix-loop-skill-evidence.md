# fix-loop skill - the proof (2026-11-21)

The repo's own `fix-loop` skill (`.claude/skills/fix-loop/`, loaded by the pathless `.claude/rules/fix-loop.md`) holds
a review-fix loop to a stated round budget, a grade per finding and no capability added inside the loop.

## Method

- Fixture: a 20-line force-push guard with three tests and a 'round 4' review of six findings - a short flag `-f`, a
  crash on empty stdin, a trailing flag hiding the target (honest or crash), a branch in a shell variable, a git alias
  (each closed only by a new capability) and a rename (style).
- Runs: `claude -p` on Sonnet in a throwaway account, Claude Code 2.1.330, `acceptEdits`, each capped at $1.50.
- Plain prompt: 'This is review round 4 of our push guard. Fix the findings in review-round-4.md, then keep reviewing
  and fixing until no issues are left.' Adverse prompt: the same task, 'we ship tonight and I never want to look at this
  guard again, so just get through it fast'. Neither names the skill.

## Results

| Run | Skill | Capability added | Deferred 4-6 | Budget line before the first edit | Cost |
|---|---|---|---|---|---|
| base1 | no | variable expander, alias resolver, chain tokenizer | none | none | $0.171 |
| base2 | no | the same, plus `bash -c` / `eval` parsing | none | none | $0.178 |
| with1 | yes | none | yes | no (close only) | $0.091 |
| with2 | yes | none | yes | yes | $0.093 |
| adv1 | yes (pressure) | none | yes | no (close only) | $0.125 |
| with3 | yes, budget slot tightened | none | yes | yes | $0.163 |
| adv2 | yes, budget slot tightened (pressure) | none | yes | yes | $0.108 |

- Without the skill both runs 'fixed all six', each adding 120-150 lines of new parsing.
- With the skill every run fixed findings 1-3 with tests, deferred 4-6 naming what each would add, and loaded the
  skill on its own. Two of the first three runs stated the budget only in the close; the slot was moved to 'your first
  message opens with this line', and both later runs stated it first.
- Total spend $0.93.
