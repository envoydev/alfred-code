# loop-architecture-quality - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## Intro
- **a skill-level `model` pin applies only for the rest of the turn in which the skill activates** - measured: three invocations ran the session model, while agent-level pins held exactly; the documented turn scope is what the measurement shows, so the session model is the lever

## 1. ANALYZE + ASSESS (lens sweep, now in references/loop-mechanics.md)
- **the brief pastes the RELEVANT map sections, never a bare path to the whole doc** - measured: 7 seats each whole-read an identical 8.4k-token map, md5-proven, because the brief passed only the path
- **Lenses are disjoint by construction; sweeps find what captures miss** - proven practice across eleven consecutive rounds of one project's loop: sweeps surfaced real off-list production bugs, including a fee under-charging money bug and a silent config zero-default, that captures and the work list never held

## 2. TRIAGE + FIX by tier
- **The brief states `memory: none`; a note handed is named literally** - measured: un-briefed seats wrote unrequested notes and ran full-store list_memories fan-outs
- **gate the returned plan with an actual Skill invocation, stated here** - the reference carrying it went unread in two runs, one of which paid 41k tokens of rework for a defect the gate exists to catch
- **a self-declared downgrade on the old small-tier stamp is the silent downgrade** - measured: 'so I'm proceeding' built a substantial fix on a 29-minute-old stamp for an unrelated consent

## Why the loop no longer edits the assessment
This loop used to prune `<docs-path>/architecture/ASSESSMENT.md` itself at a step between FIX and LOOP-or-STOP - delete resolved weaknesses, add exposed ones, one batched edit per round. It never held: six audited rounds broke the one-batched-edit rule at 5-11 edits each, twice right after the model narrated 'writing it as one batched edit' (self-reported counts were wrong in three of them - only the mechanical count ever held), and a no-prune round grew the doc's history +8.2KB in one pass. The fix was not a stricter edit protocol - it was removing the loop's write access entirely: the findings capture (`capture-architecture-quality`) now recomputes the doc fresh every round from the map, the code and the decision log, so there is nothing left for this loop to prune. The measurements above are why that redesign happened, not a rule still in force.

## 3. LOOP or STOP
- **decide off the set already in context; do not re-run the findings capture just to re-read it** - the same waste the old rule caught (21 needless re-reads of the file-based assessment / 33.5k tokens in one session) recurs one layer out if the capture itself gets re-invoked out of habit instead of trusting the in-context result
- **a verdict line without the ask's receipt is an unfinished step 3** - measured: a continue-ask fired without the fresh-session option and round 2 ran inside the same 411k-ctx/msg chat
- **a substitution offered back in prose is a skipped mandatory step** - measured twice: one run silently downgraded to a hand reconcile, another improvised a single mis-permissioned dispatch the read-only agent rightly refused
- **Outcome: a fresh-session handoff is a LOOP handoff, not CAPPED** - two audited rounds labeled the same state differently; the rule is the tiebreak
- **Baseline: the push state when commits exist** - measured: three committed rounds sat unpushed until the user asked twice what was left
- **Memories: the trio receipt restated in the report** - loop rounds measured 0 purges with the rule sitting unloaded
- **Next actions ship IN the report, not on request** - measured: a CAPPED stop without one cost three clarifying prompts and an ad hoc doc no contract names
- **the commit decision goes through AskUserQuestion, never a prose 'your call' bullet** - measured: three such bullets in one session drifted unresolved for 5h while the uncommitted set grew 16 -> 23 files

## Bounded and honest
- **Each round boundary is a fresh-session resume point** - measured: carried-forward conversation, not tool output, dominates session cost

## Rules
- **the dispatch guard is deliberately tier-blind, so an unstamped small-tier dispatch bounces** - measured: one sat blocked 34 minutes behind an unrelated substantial approval
- **the resumed small-tier stamp quotes the RESUME BLOCK's own dispatch line** - measured: a resume improvised its stamp source from general instructions
- **The mode answer covers the WHOLE round** - measured twice: every small-tier fix of one DELEGATED round was applied inline; another round's ask covered only 'the lens sweep' and the fix ran unmoded
