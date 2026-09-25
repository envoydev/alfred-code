---
name: project-runtime-failure-signatures
description: Use when something breaks at runtime on your own machine and you have the evidence - a stack trace, an exception, a hang, or a broken screen - and want to know where the real cause lives. A lookup of the common local-runtime failure signatures, each mapped to where to isolate it - usually not the line that threw. The single-chat form of the diagnoser seat's failure catalogue; pairs with the root-cause method. NOT for a CI or build/test-gate failure (the resolvers and ci-failure-diagnoser own those) or a production incident - local-runtime evidence only; and when the evidence spans more than one source, that is the gated four-step investigation flow, not a lookup. Keywords NullReferenceException, Cannot read properties of undefined, Unable to resolve service, NG0201 No provider, ObjectDisposedException, deadlock, hang, 401/403, config drift.
---

# Failure Signatures - what the crash means and where the cause actually lives

Every runtime failure has a signature, and the signature names where to look - which is almost never the line in the top frame. This is the single-chat form of the diagnoser seat's failure catalogue: match the evidence to a signature, then isolate at the place the signature points, not the place it threw. It pairs with `alfred-habits-root-cause` - the disciplined hypothesis-and-test loop; this one tells you which hypothesis the signature warrants. Read the evidence first and quote the exact frame, then match.

## The signatures - and where each isolates

- **Null-reference / undefined access** (`NullReferenceException`, `Cannot read properties of undefined/null`). The frame names the dereference, but the cause is usually one hop up: a dependency never assigned, or a value read across an async gap before its `await` resolved (an `@Input` touched in the constructor before `ngOnInit`, a field read before the task that sets it finished). Isolate by walking the assignment of the null symbol, not the line that dereferenced it.
- **DI / composition-root failure** (`Unable to resolve service for type`, a startup `InvalidOperationException`, Angular `NG0201`). The injection site is innocent - the registration is missing, mis-scoped, or a captive dependency (a singleton capturing a scoped service). Isolate at the composition root (the container setup / module providers), never the consuming class.
- **Async deadlock / sync-over-async** (a hang, not a crash). `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` blocking a captured synchronization context (the classic WPF / WinForms UI-thread and ASP.NET-request deadlock), or a `TaskCompletionSource` never completed. Isolate to the sync-over-async boundary, not the innermost `await`.
- **Race / shared mutable state** (reproduces under load or a specific ordering, passes in isolation). A `static` or singleton mutated concurrently, an un-awaited fire-and-forget, subscriptions firing out of order. Isolate by naming the shared cell and its competing writers, not by re-running until green.
- **Disposed / lifecycle** (`ObjectDisposedException`, `Cannot access a disposed context`). A `DbContext` or `HttpClient` captured past its scope, a subscription or timer firing after teardown, a handler outliving its view. Isolate to the lifetime boundary that ended early, not the use site.
- **Database contention / exhaustion** (a query that deadlocks, times out, or violates a constraint under concurrency but is fine in isolation). A deadlock victim (SQL Server error 1205, Postgres 'deadlock detected') from two transactions taking locks in opposite order; connection-pool exhaustion (a timeout acquiring a pooled connection - usually a leaked or un-disposed connection or `DbContext`, or sync-over-async starving the pool); or a unique / foreign-key violation surfacing a lost race. Isolate to the competing transactions and their lock order, or the connection that was never returned - not the statement that happened to lose.
- **Config / environment drift** (a value read as null or wrong, no crash at the read). A missing user secret / env var / `appsettings` key, a connection string pointing at the wrong database, a WPF binding silently no-op'ing (the `System.Windows.Data` error in the Output window). Isolate by proving the value the code actually received, not the value it expected.
- **Boundary / off-by-one** (`IndexOutOfRangeException`, `ArgumentOutOfRangeException`, an empty-sequence `.First()` / `.Single()`). A fencepost in a slice or loop, an empty collection assumed non-empty. Isolate to the boundary input that triggers it, and keep it as the regression case the fix must cover.
- **HTTP error with a clean response** (a returned status, no stack trace). Triage by the status class - it names the failing layer before you open a trace: 401 authentication, 403 authorization / policy, 400 / 422 validation, 404 routing / binding, 405 verb, an antiforgery or CORS-preflight rejection. Isolate at the layer the status names, not the handler body.

## Execution modes

This catalogue is single-sourced: the runtime-failure-diagnoser seat preloads this same file, so
the inline and seated forms never drift. Loaded INSIDE the seat, this section is already satisfied
- the seat is the dispatched form, and the rest of this section is not read there. Loaded in the
MAIN session, run the triage HERE and Read `references/gatherer-fan-out.md` before deciding on
evidence-gatherers - the inherit-or-ask rule, the four dispatch triggers, the stay-inline shapes
and a worked fan-out are that file. Either way, dispatch is explicit-only house-wide, so the seats
never start on your own say-so.


## How to use it

Match the evidence to one signature, form the fewest hypotheses it warrants, and confirm each against located code before you touch anything - root cause before symptom, never a plausible guess. State the match in three lines - the quoted evidence, the signature, the isolation point (and the hypothesis it warrants) - then run the loop:

```text
Evidence:  'ObjectDisposedException: Cannot access a disposed context instance' in OrderSyncJob.ExecuteAsync
Signature: disposed / lifecycle - a DbContext captured past its scope.
Isolate:   the lifetime boundary - the scoped DbContext resolved once and stored on the singleton job - not the query line that threw.
```

Prove the isolation point before the fix goes anywhere near it: the check is that the symptom changes when THAT point changes - a breakpoint or log at the boundary that shows the wrong lifetime, value or order, or the smallest edit that makes the failure move. A signature match that sends a fix at the wrong symbol is the failure this catalogue exists to prevent, so an unproven isolation point is stated as a hypothesis, never as the cause. Once the cause is proven, load the stack's house skill for the fix convention - your project's convention rules auto-attach it on a matching file touch. If the signature stays ambiguous after two passes, report the surviving hypotheses and what would decide between them rather than guessing.
