# alfred-capture-architecture-quality - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill. Most of
these predate the split from `alfred-capture-architecture`, back when this judgment ran as that skill's
AGGREGATE step 3 and wrote `<docs-path>/architecture/ASSESSMENT.md` - the anecdotes are unchanged, only the
doc's path and the skill that owns them moved.

## Intro
- **a skill-level `model` pin applies only for the rest of the turn in which the skill activates** - measured: invocations ran on the session model, while agent-level pins in the same session held exactly; the documented turn scope is what the measurement shows, so the session model is the lever
- **`Decisions:` is unconditional, receipt-logic like every other named field** - measured: a project with one Accepted ADR was captured and re-assessed 44 times and no round carried a trace of that ADR; the decision log is 'declared intent to reconcile against', and the report's `Decisions:` line is what turns that from a statement into an act

## JUDGE
- **the reasoning pass never stops early because the list already looks long enough** - measured 2026-08-21: one round filed 5 tiered items including the first `structural` in thirteen rounds against code that had not regressed - three of the five were artifacts of a new lens, not defects
- **one write (or one batched edit pass) - never a per-claim edit stream** - measured: 31 serial edits to one assessment in a single session, each later re-read costing more as the doc grew
- **this doc is read at intake on every loop round, so its weight is paid again each time** - measured: one assessment reached 1,068 lines / ~31k tokens with no budget to fail against; another reached 1,935 - neither had a number to fail against, because 'length is handled by ranking and spilling' names the mechanism and no threshold, and a rule with no threshold never fires
- **no per-round history in this doc, ever** - measured: 352 of one 1,935-line assessment were round log, in a doc recomputed fresh every run - a log inside a cache outlives the state it described

## The findings gate
- **a re-measurement of an already-recorded limit folds into its existing entry, never re-tiered upward** - measured 2026-08-21: a declared, accepted scope limit got promoted to `substantial` for gaining a measurement, on code that had not changed
- **a property true since the project's first commit is not a new finding** - measured 2026-08-21: two such candidates were tiered - one at `structural`, the highest alarm, for a property true since the project's first commit
- **Worth knowing carries a promotion condition, never an untiered ceilings list** - measured 2026-08-21: an untiered ceilings list reached 42 entries and had never retired one
- **W-IDs are rank labels, renumbered on re-rank** - measured: the same kept-old-IDs re-sort drew a correction in two projects

## Don't game it
- **keep the re-measuring; kill the inflating** - measured: the 2026-08-21 round that inflated three lens artifacts into tiered findings ALSO caught four wrong numbers by re-measurement - one where the doc and the code's own XML doc agreed with each other and were both wrong

## Reads decisions, never writes them
- **an analyzer that could write its own decisions would be marking its own homework against its own gate** - the design reason this rule is a hard rule rather than a preference: gate question 4 ('has the project already decided this') only means anything if the decision log is a source this skill cannot also be the author of
