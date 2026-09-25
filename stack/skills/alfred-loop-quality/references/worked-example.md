# Worked example and the convergence note

Optional reading - a DELEGATED inner loop over one stage file, and why the stages are numbered the way
they are. Nothing here is a rule the body does not already state.

## Example - one file's inner loop

DELEGATED, `3.naming.md` over src/Orders/:

```
3.naming.md | Pass 1 - BLOCKER: 0, MAJOR: 1, MINOR: 2, DECIDED: 0
open: [(MAJOR, OrderSvc.cs:14, abbreviation in public type), (MINOR, OrderQueries.cs:22, vague 'data' param), (MINOR, OrderQueries.cs:41, vague 'tmp' local)]
```

- RUN dispatched the stack's verifier seat (here the .NET web one) as a read-only auditor; the open set above is its result.
- FIX: OrderSvc -> OrderService (clear); the two vague names renamed to follow the OrderQueries naming
  precedent, logged to DECISIONS. Dispatch the same stack's implementer seat with that findings-plan.
- Pass 2 re-runs the auditor -> `open: []` -> **SATISFIED**; advance to the next file.

## Note on convergence

The pipeline is a single forward pass through the files. A later file's edits are not re-checked
against earlier files. If you want a full fixpoint, run the whole pipeline again - a clean second run
(every file SATISFIED, or a stable PLATEAU) means it has converged. Order the files by blast radius so
later stages do not invalidate earlier ones: structure (widest - a move changes a symbol's public path,
so every later finding would have to be re-keyed), then code-quality (it carries
architecture-conformance), then naming, then logging (its messages are written against the settled
names, and its edits - a log line added, a duplicate removed - move nothing a later stage keys on),
then comments. DISCOVERY step 2 checks the numeric order against exactly this list.
