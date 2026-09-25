# Fix discipline - standing guidance, not a stage

This is a `0.`-numbered file: the pipeline reads it first, holds it as standing guidance for
every later stage's FIX step, records it SATISFIED with zero findings, and advances. Never run
an audit or a gate against it. Re-read it after a compaction or when splitting the run per
module. Its one job: stop the loop from recreating code it could reuse, and from spending
effort it does not need to spend.

## Reuse over recreation

Before a FIX writes new code, climb the ladder and stop at the first rung that holds:

1. Does this need to exist at all? Speculative -> out of scope, do not build it.
2. Does the stdlib, runtime, or a native framework feature already do it?
3. Does an existing helper in this repo, or an already-referenced package, already do it? Search first - duplicated logic is itself a finding; consolidate to the existing seam, never fork a second copy.
4. Can it be one line?
5. Only then: the minimum code that works.

## Edit, never re-emit

- Change only the lines the finding touches. Never re-output an unchanged file or an unchanged method body - that is pure recreation, and the top source of wasted effort and accidental drift.
- One fix per finding, smallest blast radius. Do not 'improve while you're here' - unrelated polish belongs to its own stage.
- Match the surrounding code's idiom, helpers, and naming rather than introducing a parallel way to do the same thing.

## Work lean

- Locate symbols via navigation (serena / the LSP), not whole-file reads; read the symbol under fix and its call sites, nothing more.
- Do not re-read a file you just edited - the edit succeeded or it errored.
- Keep findings terse: `file:line - one-line defect -> the fix`. Do not restate the code back.
- Batch independent reads and edits into one step rather than serial round-trips.

## Where lean stops

Less code that still works - never the flimsier algorithm, and never at the cost of input
validation at trust boundaries, error handling that prevents data loss, secret handling, or
anything a stage's bar explicitly requires. When two correct options are the same size, take
the one that is right on the edge cases.
