# Weak points - exclusions, the findings gate, the three buckets

Read at step 4 ANALYZE, before the first weak point is recorded.

## Exclusions

Exclusions are the code coverage cannot meaningfully claim - taken from the tooling's existing
exclusion config plus the doc's recorded list, with the catalog and after-exclusions semantics
owned by the house testing skill for the stack in play - matched from your skill list by what it
covers (.NET, Angular, or plain TS/JS testing practices; its coverage section carries the catalog),
and with none matching, apply only the tooling's own exclusion config and say so in the doc. The
list you applied is recorded, never silently widened.

## What makes an uncovered number a weak point

A number below the bar is not automatically a weak point - judge by what the uncovered code DOES. Uncovered payment, auth, deletion, money, or data-integrity paths are weak points; an uncovered trivial mapper, DTO, or generated file is a number, not a risk - record the number in the module table and move on. Every weak-point candidate passes the findings gate before it is recorded, all four questions answered explicitly: what breaks if this code regresses untested (the concrete wrong outcome - 'the number is below the bar' is not an answer); who notices, and when; is it actually new (an already-recorded weak point re-observed is updated in place, never re-opened); and has the project already decided it (the recorded bar, a recorded exclusion, an excluded-by-default suite are decisions, not gaps). Survivors sort into three buckets, none size-limited: **Must fix** (tiered as above, each with its simplify-testing action - the action is required for this bucket only), **Worth knowing** (true but no action warranted - one line plus the condition that would promote it to Must fix; each re-run promotes it, leaves it, or deletes it when its condition can no longer occur - never trims it), and **Deliberate tradeoff** (a recorded decision, with the reason - never re-raised). The count cuts both ways: bar met and nothing uncovered dangerous means 'no weak points' is the correct, complete output - and many genuinely dangerous uncovered paths means ALL of them are listed, ranked by what they guard, never trimmed to a tidy number.
