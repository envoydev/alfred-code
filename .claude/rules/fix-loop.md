# Load fix-loop on a review-fix loop

- On a loop of review rounds and fix passes - 'fix until no issues are left', 'keep reviewing until clean', 'round N
  of the review', a findings list handed over to fix - load the `fix-loop` skill before the first fix. Why: on
  2026-11-05 round 16 of such a loop added variable reading to the force-push guard and rounds 17-21 were mostly its
  bugs; on 2026-11-21 two runs without the skill fixed all six findings of a review, adding a variable expander and an
  alias resolver, with no budget and nothing deferred.
