# Architecture Quality Loop - loop mechanics

Step-scoped mechanics for `loop-architecture-quality`: the lens sweep (step 1, when the work list is drained), the seat brief shapes (step 2), the RESUME BLOCK (step 3, on a 'fresh' answer) and the final report's field rules (step 3, on STOP). The body's step 3 Reads this file whole and the report's `Mechanics` line is the receipt; step 1 and step 2 read their own sections when they need them. Every rule here is binding - this file holds the shape, the body holds the step.

## Lens sweep - step 1, when the work list is drained

Run a lens sweep instead of re-capturing when the Must-fix list is empty, or when a later round wants findings the last capture missed:

- Pick 3-5 distinct cross-cutting defect classes the codebase is actually exposed to - e.g. concurrency, money/precision handling, fail-open error paths, boot/config wiring, external-API trust.
- Sweep the code one lens at a time. DELEGATED: one architecture-analyzer seat per lens, each briefed with ONLY its lens plus the areas to read. INLINE: one lens per pass, yourself.
- Lenses are disjoint by construction - a seat that gets two lenses dilutes both.
- For map orientation the brief pastes the RELEVANT sections of `<docs-path>/architecture/ARCHITECTURE.md` (or names them for a ranged read), never a bare path to the whole doc - a path-only brief makes every seat whole-read the map.
- Findings triage into the same tier routing as the findings capture's own weaknesses (small / substantial / structural) and are worked the same way, but never hand-added to `<docs-path>/quality/ASSESSMENT.md` - this loop does not write that file. A sweep finding that reflects a real code change disappears from the doc on its own at the next findings-capture recompute; report it as Resolved off the sweep either way.

## Seat brief shapes - step 2

- **small-tier implementer brief** - the file/symbol, the smallest correct change, the check that proves it, and `memory: none`: a scoped fix has no navigation-server hand-off. A brief that does hand a note names it literally, read side included (memory hygiene: `references/domain-trio-protocol.md`) - an un-briefed seat writes unrequested notes and fans out over the whole memory store.
- **substantial-tier designer brief** - the weakness, its assessment entry (strength tensions included) and the remediation as the requirement; the designer returns the decomposition, the body's step 2 gates and approves it before any implementer runs.
- **lens-sweep analyzer brief** - ONE lens, the areas to read, the RELEVANT map sections pasted (see above).

## RESUME BLOCK - step 3, on 'fresh'

When the fresh-session ask answers 'fresh', end the turn with this block and nothing else - no 'one more step', no new work in this chat. The new session must be able to start from the block alone:

```text
RESUME - loop-architecture-quality
Invocation: /loop-architecture-quality <scope> - resumed round <N of 3> (rounds consumed: <list>)
Mode: <DELEGATED | INLINE> - "<the mode answer, verbatim>"
Read first: <docs-path>/architecture/ARCHITECTURE.md - step 1 recomputes <docs-path>/quality/ASSESSMENT.md fresh, so there is nothing to resume from in that file
Baseline: build <green | red: what>, tests <green | red: what>, last commit <sha | none>, pushed <yes | no>
Remaining weaknesses, leverage order (titles, not W-numbers - a fresh capture may re-rank):
  1. <weakness title> - <tier> - <remediation, one line>
Deferred: <structural items declined or undecided | none>
```

The invocation names the rounds already consumed so the 3-round cap survives the resume. On a RESUMED session no mode ask fires: the `Mode:` line is what the body's Rules have the small-tier stamp quote, so it carries the answer verbatim. The declined set does NOT carry across the resume - it lives in context only, never written to a file, so the new session starts with a clean one (an item declined last session may surface again; that is the accepted cost, not a defect).

## Final report - field rules, step 3 on STOP

One line per field, a table where a field lists several items - the close is an answer like any other and the answer-length hook blocks a wall of prose; tables are exempt.

- **Outcome** - SATISFIED / PLATEAU / CAPPED / BLOCKED, and on which round. CAPPED means the CUMULATIVE improve-round cap was reached - rounds count across sessions via the resume invocation's round numbering. A session ending because the user chose the fresh-session option with fixable weaknesses left is a LOOP handoff, not CAPPED - this rule is the tiebreak.
- **Resolved** - each weakness fixed, its tier, and the change that closed it.
- **Deferred** - structural items the user declined or has not decided this run, plus accepted tradeoffs left alone - never silently dropped.
- **Proposed decisions** - each declined-but-recurring finding or accepted-tradeoff-shaped call this round surfaced, in the shape `<docs-path>/quality/ASSESSMENT.md`'s Proposed decisions carries: the claim, the reason, what it costs. This loop never writes the decision log - a person accepts one by writing it themselves.
- **Docs** - which of the two captures ran at stop (`ARCHITECTURE.md: UPDATE`, `quality/ASSESSMENT.md: recomputed`) or `skipped - nothing shipped`. Neither doc is EDITED by this loop, so there is no touch count to report here - a touch count on either doc in a loop-authored diff is a defect this rule exists to catch, not a stream to count.
- **Baseline** - build + tests green at stop (or the red that blocked it), plus the push state when commits exist - unpushed rounds accumulate silently otherwise.
- **Memories** - `memories purged: <names|none>`, fold-first per `references/domain-trio-protocol.md` - the trio reference's receipt, restated in the report because the rule goes unread otherwise.
- **Next actions** - when Deferred items are blocked on the operator (a live walk, a log grab, a replay), a ranked what-to-do list ships IN this report, not on request.
- **Mechanics** - `loop-mechanics.md: read` - the receipt that this file was read this step.

Then the two closing asks the body mandates, both through AskUserQuestion and never a prose bullet: the commit decision (commit now / hold) when work is uncommitted and no round is queued, and tear-down-vs-keep for anything the round started and still has up.
