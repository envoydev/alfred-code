# Delegated mode - who does what (+ the INLINE domain conventions)

The main session is the orchestrator for the whole pipeline; it hands off only the audit and the fix work, never the bookkeeping.

## Main session owns all bookkeeping

For the whole pipeline: DISCOVERY, every pass's SCORE line and open set, STOP detection (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED), the DECISIONS log, and the Final report. A dispatched subagent never sees or updates this state - it returns a result and the main session interprets it.

## INNER LOOP step RUN dispatches the domain verifier as a read-only auditor

Every audit stage dispatches the domain verifier for the stack in play - the read-only seat that audits that surface, matched from your installed agents; a surface with no matching seat runs that stage INLINE. The structure and code-quality stages instead have their verifier read `<docs-path>/architecture/ARCHITECTURE.md` and audit TARGET against it - for structure, so a layout the map records as deliberate is not re-raised; for code-quality, so its findings cover both code quality AND architecture-conformance - code that violates the recorded structure (a cross-layer leak, a wrong-direction dependency, a rival pattern) is a finding.

Every RUN dispatches the verifier at its **sonnet/xhigh pin** by default. An **opus/xhigh first-find** - escalating only the thorough first RUN of a stage to opus, re-verify RUNs staying on the pin - is an OPT-IN experiment, not the default: it may catch materially more real issues, but that is an unproven pin change, so per the repo's prove-don't-assert rule it stays OFF until a benchmark on a real target shows it pays, then it can be adopted. Do not silently ship it on.

Gate stages (a transform naming a verifiable command) run the gate command in-session first and only dispatch on a red result - never dispatch an audit for a stage whose bar is a passing command.

Every dispatch prompt carries four REQUIRED fields, checked before the call goes out - a brief missing any of them is malformed, not merely terse: `slice:` (what this seat owns, and for a concurrent stage the label in the Agent call's own `description` names that slice too - three of ten seats in one run shipped a byte-identical stale label), `memory:` (the literal note name to read or write, else `memory: none` - measured: 9 of 9 briefs omitted the line and three seats ran full-store `list_memories` fan-outs), `model:` omitted entirely unless the designer stamped an `implementer_model` on the task card (measured: seven seats forced onto opus against their sonnet pins, no stamp, no stated reason), and the finding contract below. Build the rest of the prompt from: the full text of stage file F, TARGET, the previous pass's open set (empty on pass 1), and the mandatory finding contract - the result must give one entry per finding keyed (severity, file:line-or-symbol, 3-6 word description), sorted. That contract is load-bearing: PLATEAU and OSCILLATION are read off set identity across passes, so an auditor result in a different shape breaks STOP detection. Scope each seat's doc orientation to exactly the docs the brief names - a rubric auditor oriented on `ARCHITECTURE.md` needs nothing else (measured: unrequested `ASSESSMENT.md` reads across seats re-delivered ~111k tokens of unchanged documents in one run). Any diff used to build a brief scopes to the recorded stage-boundary sha, never a bare `git diff`, whenever the tree carries uncommitted prior-stage work (measured: a bare diff over a three-stage-dirty tree put a wrong file attribution into a pass-2 brief; the verifier caught it at two turns' cost).

For a style-heavy stage, tell the dispatch prompt to load the skills covering the SCSS/CSS styling layer and the Material/CDK component layer - described that way, not by name, since the Material one exists only where the project uses Material - because the convention rules auto-attach only on a matching edit and a read-only auditor edits nothing, so a dispatched auditor that isn't told to load them will miss styling findings.

## INNER LOOP step FIX stays a two-part split

The main session resolves every judgment call itself first, exactly as INNER LOOP step 5 describes - clear fixes, ambiguity calls (logged to DECISIONS with the precedent), out-of-scope, could-not-apply. Then trace each surviving finding to its exact line yourself with a deterministic locator (serena for a symbol, grep for a text pattern) before any brief is written - confirm it is real and note the sibling pattern the fix must mirror; a brief written from an untraced finding ships the auditor's guess (measured: six consecutive stages' re-verify caught regressions in pass-1 fixes; the first stage where every finding was hand-traced came back clean on pass 1, and the traced briefs could quote the guard the fix had to mirror). It then converts the resolved open set into a findings-plan: one step per finding, each naming the file and symbol, the smallest change already decided, and the check that proves it. A fix brief is the DECIDED edit, never the audit conversation that produced it: name the file, the symbol, the before/after with line numbers, and the one check that proves it. Measured both ways in one corpus - briefs carrying the pre-decided diff returned in 42-47s on 7-11 tool calls, while seats handed the audit report ran 170-668s on 37-166 calls, and across two other runs fix seats returned 5x less output per dispatch than audit seats for the same cache-read (one at ~1,051 cache-read tokens per output token, moving files by a fixed rule). For an audit stage, dispatch the matching domain implementer with that plan - the plan is what satisfies its no-plan-no-run contract, so never dispatch it with a bare finding list, and the AUTO stamp from the mode ask must be in place ('The approval stamp' below - the dispatch hook blocks an unstamped implementer). The FIX brief names the serena hand-off explicitly: the implementer writes ONE `write_memory` note at hand-off, named `<feature>__<contract_version>__<seat>__<task>`, for the re-verify auditor to read - seats reliably skip a handoff their brief does not name (measured: 1 of 10 wrote unprompted; the one note written was read back usefully by the re-verify). Every OTHER brief states `memory: none` - a RUN auditor or resolver returns its findings inline and neither reads nor writes notes; without the line seats invent hand-offs (measured: 8 of 10 seats wrote unrequested notes off findings-plan briefs, and un-named read sides ran full-store `list_memories` fan-outs of ~20-40k tokens each against a store grown past 200 entries). A brief that does hand a note to READ carries the literal note name too, exactly like the write side. At the run's close (or a stage close that ends the session), purge the run's notes fold-first - anything that outlives the run goes to the report or docs before the delete - and print the `memories purged: <names|none>` receipt in the final report; this is the trio protocol's rule restated here because loop runs never load that file (measured: 0 purges in every audited loop round; the one run with the protocol text in play purged 11/11 with receipt). For a red gate stage, dispatch that stack's build-error or test-failure resolver seat instead - matched from your installed agents; with none matching, resolve the red inline and say so.

## The approval stamp

DELEGATED mode dispatches implementers, and the dispatch hook (`guard-unapproved-dispatch.js`) blocks an
implementer dispatch without a live `<docs-path>/flow/APPROVAL` stamp. The mode-ask answer IS the standing
consent, so the stamp is written once the answer lands and BEFORE the first FIX dispatch - and again on every
resume that carries DELEGATED, because the stamp belongs to the session that dispatches.

- **Where and how.** Write it with the Write tool at the ABSOLUTE path
  `$CLAUDE_PROJECT_DIR/<docs-path>/flow/APPROVAL`. A relative Bash write follows whatever cwd the shell
  drifted to and lands the stamp in a phantom nested docs tree the hook never reads. `.claude/` is a
  protected path, so the first write raises a permission prompt: take its 'allow Claude to edit its own
  settings for this session' option and the rest of the run is free.
- **First line.** `AUTO - "<the mode-ask answer, verbatim>"` - the hook reads that line; never fabricate
  or paraphrase the quote.
- **Ownership.** Written when this session's own decision lands, deleted at its own close (the run's end,
  or a stage close that ends the session). An earlier session's leftover stamp is not consent - the hook
  expires stamps older than the session or older than 8h - and a leftover stamp from another flow is not
  either.
- **When the write is refused.** If the harness refuses BOTH the Write and an absolute-path Bash fallback,
  stop and put the choice through AskUserQuestion (retry, or run this stage inline). Never retry blind, and
  never let the run degrade to inline with nothing said - a stage that ran inline because the stamp could
  not be written is reported as exactly that.

## Economy guidance

The first RUN of an audit stage is always a dispatch - never skip straight to an inline audit on pass 1. From then on, if a dispatched auditor's returned open set is tiny (at most 3 MINOR findings, all in one file), the main session may fix and re-verify that stage's remaining passes inline instead of paying dispatch overhead on trivial cleanup. Any BLOCKER or MAJOR finding, or findings spanning more than one file, keeps dispatching. Exception: a finding of any severity whose already-decided fix is a single mechanical edit in one file (a rename, a comment) may be applied inline; the stage's re-verify RUN still follows the rules above (measured: a stage's MAJOR was a one-token rename - dispatching an implementer for it buys nothing the re-verify does not already guarantee). The exception is judged against the whole BATCH, not each finding in it: a pass whose open set holds any BLOCKER/MAJOR dispatches whole, unless the set IS that one mechanical finding (measured: the per-finding reading stretched the exception over a 6-finding/2-MAJOR/5-file batch, and the inline sweep missed a stale test name the dispatched pass-2 then caught). The exception licenses the FIX only, never the re-verify: a pass whose originating batch held a BLOCKER or MAJOR, or spanned more than one file, still dispatches its re-verify RUN - no after-the-fact reclassification (measured: three runs read this as covering the re-verify; the independent re-verify is the same gate that caught an orchestrator's own brief error and its own bad fix).

**Unchanged-slice gate and re-audit scoping.** When TARGET is partitioned into slices (one auditor per slice), record with every returned result - zero-findings or not - the git sha it audited. Before re-dispatching an auditor over a slice for the same stage, run `git diff --name-only <recorded-sha> -- <slice paths>`: an empty diff on a zero-findings slice means the prior verdict still stands - carry it forward, log the skip, and do not dispatch. A pass-2+ RUN over a findings-bearing slice may scope to that diff plus the files carrying open findings - an unchanged file's prior verdict stands - logging the scope in the SCORE line. Never brief an agent to confirm that nothing changed - the diff is the confirmation (measured: two dispatches over a byte-identical slice cost ~241k tokens to return the same empty set).

**A seat's FLOOR is paid per dispatch, so the slice count is a budget decision.** Every dispatch
re-sends that seat's whole standing inventory before it reads one line of the target - measured at
about 112k tokens for a domain verifier, against 53k for the style-characterizer shape and 39k for
the architecture one. Across one audited collection the domain verifier was the single largest line
item anywhere - 86 seats, 687.7M cache-read, 27.9% of the whole bill, 73% of it floor, and 81 of
those 86 were rubric audits over 78 distinct slice briefs on two project-days. Part of that floor
is the seat's own `skills:` preload, re-sent on every dispatch of the seat: measured at 26k-70k
chars of SKILL.md bodies (roughly 7k-17k tokens) for the designer, implementer and verifier seats
and zero for the support seats - so of the gap between the verifier's 112k and the support seats'
39-53k, the preload accounts for 7k-17k and the rest is not yet attributed (no verifier transcript
sits in the audited collection to read it from). A re-verify dispatch re-pays the preload in full,
which is one more reason to batch a punch-list into one re-dispatch per seat. So: fold slices
together until each seat has enough to justify its own floor (a seat reviewing four related slices
pays the floor once, not four times), and prefer the NARROWEST read-only seat the project has
installed whenever the stage is a pure rubric read - no build, no test rerun, no memory write, no
browser driver. Splitting finer buys parallelism at 112k a slice; say in the SCORE line why the
split was worth it.

**One auditor gets the diff as its lens.** When TARGET is partitioned into slices, dedicate one auditor to the cumulative `git diff` against the run's green-baseline sha - the delta IS its slice, regression hunting its rubric - because some defect classes are visible only in the change (measured: the diff-lens auditor was the only one of six to catch a model-snapshot drift; no whole-file correctness lens ever opens a snapshot file).

**Auditor contradiction.** Two auditors contradicting each other on a checkable fact is settled by the cheapest deterministic command in-session - never a tie-break re-dispatch, which costs a seat and returns another opinion.

## DOMAIN CONVENTIONS - .NET / Angular targets (INLINE mode)

This section applies to INLINE mode. In DELEGATED mode the convention rules auto-attach inside the editing subagent's own session, and the domain verifiers / implementers / resolvers load the relevant convention skills themselves - the only thing DELEGATED mode still needs from you is the style-heavy stage's load line in the dispatch prompt (RUN above).

In a project that carries the path-scoped convention rules (`.claude/rules/`), an edit to a matching file auto-attaches that file type's convention-skill guidance. It is a soft nudge, never a block, so a FIX never exit-2's and the inner loop cannot thrash on it. Still, load the governing convention skill before the loop starts editing - conventions are the source of truth, not recall.

For a .NET or Angular TARGET, make each audit stage convention-aware: first load the domain's house skills, then audit TARGET against them - every deviation from a loaded convention is a finding, severity by blast radius. For .NET, load the C# convention skill plus the hub for the surface in play - the ASP.NET request pipeline, the SQL layer, or the error-handling channel; for Angular, the Angular convention skill and the TypeScript one, plus the styling and Material/CDK skills for CSS- or Material-heavy code. Match each from your skill list by what it covers and skip what is not there. The convention rules auto-attach the C# / TypeScript / Angular guidance on a matching edit, and the styling layer too (`.claude/rules/angular-styling-conventions.md` globs .scss/.css), but never the Material/CDK layer (it has no file trigger) - so name the load step in the stage explicitly, and it stays correct on pasted code and on files no rule matches too. The Material/CDK skill is the one row here a project can lack (it installs only where Material is a dependency): with nothing in your list covering it, audit the Material code against the Angular convention and styling skills you did load.

## While the seats run

Do not narrate the wait. A completion arrives as a task notification carrying the seat's own cited
result, so a turn that restates it buys nothing and costs a full round-trip at the session's
current context - measured in three runs: 8 restatement turns for ~1.45M cache-read, 5 for ~879k,
5 for ~1.0M. Log a seat's verdict straight to `DECISIONS.md` with a Bash append if it needs
keeping, print ONE consolidated tally per wave, and wait with `Monitor` (an until-loop) rather
than a `sleep` poll or a prose 'still waiting' turn - one run was handed that exact instruction by
the harness's own block message and used prose waits anyway.

And do not re-run a command the seat already ran and quoted: when a returned finding carries an
exact locator plus its reproducing output, that IS the trace - re-deriving it is a second full
read of what you already have. Trace only findings whose locator you cannot see.
