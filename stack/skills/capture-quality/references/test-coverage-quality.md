# Project Test Coverage Analyzer - Capture the Coverage (Deliberate)

**Contents:** When to use - Execution modes (the run gates, the % bar) - The run (1. ORIENT, 2. DETECT, 3. MEASURE, 4. ANALYZE, 5. WRITE, 6. REPORT) - Example - Don't game it.

You are the coverage seat for this run: you measure what the tests actually cover, judge it against the project's requirement, and record it as two artifacts - `<docs-path>/quality/COVERAGE-QUALITY.md` (the reasoned picture: per-stack and per-module numbers, the verdict, the tiered weak points) and the raw results under `<docs-path>/quality/coverage-raw/` (the machine-readable files the numbers came from). Coverage lives OUTSIDE the build flows: no seat gate runs it and no dispatch brief may carry it - a seat babysitting an instrumented run pays to idle on the wait - so this capture is the one place the instrumented suite runs, on the user's cadence, exactly like the architecture capture. The measurements behind these rules live in `references/test-coverage-quality-evidence.md` - an audit appendix, not a run-time load.

This is capture only: it measures, judges, and documents - it fixes nothing, writes no test, and never picks or installs a runner. Working the weak points is the coverage loop's job (`/loop-test-coverage-quality`), not this capture's.

## When to use

- Detects each stack's coverage tooling, runs the instrumented suite once per surface, judges it against the user's % bar and writes the coverage doc.
- Deliberate only, never mid-build.
- Not for writing the missing tests - that is the coverage loop (/loop-test-coverage-quality).

## Execution modes
Two halves, split differently:

- **Measurement is ALWAYS in this session** - every mode, every platform. The instrumented run is a slow gate; it never goes into any dispatch brief.
- **Analysis on the FIRST capture** (no existing doc / no stamp) - when dispatch is available, ask ONE question before the fan-out, via AskUserQuestion - analyze via test-coverage-analyzer seats (recommend it: the read-only seats absorb the raw-output reads), or in-session? - unless a calling flow (a mode word after the topic) or the chain ask already picked the run's mode, which is inherited, never re-asked. When the first capture's other mandatory asks fire (the % bar; a suite that cannot run - Docker down for Testcontainers, a red baseline - may add a run-it-or-record-unmeasured decision), the mode question joins the SAME AskUserQuestion call as one batched ask - a separately-scheduled mode question is the one that gets dropped. DELEGATED: fan out the read-only test-coverage-analyzer agent, one per measured surface, each dispatch carrying that surface's raw-results path, the suite location, and the requirement; it returns a structured digest (per-module numbers, uncovered hot spots, weak-point candidates, test-quality smells) and this session reasons over the digests - the judgment and the writing NEVER leave here. INLINE (chosen - or forced, no question asked: no dispatch): the same analysis yourself, locating testability facts with the navigation tools, bounded.

- **Run gate on an UPDATE no calling flow started.** Where COVERAGE-QUALITY.md exists, no mode word follows the topic (a calling flow) and capture-quality's chain ask did not already answer it, put this ask before MEASURE - every instrumented suite runs and the doc is rewritten, so a conversational 'what is our coverage?' never starts that alone. No answer, no run.

  ```ask
  Re-measure every surface and reconcile COVERAGE-QUALITY.md?
  - 'Re-measure and reconcile COVERAGE-QUALITY.md (Recommended)' - each surface's suite runs once, its raw files are replaced
  - 'Report from the existing COVERAGE-QUALITY.md only' - nothing runs, nothing is written
  ```

- **Run gate on a FIRST capture no calling flow started.** With no COVERAGE-QUALITY.md, no mode word after the topic (a calling flow) and no chain ask that already answered it, put this ask before MEASURE, in the SAME AskUserQuestion call as the first capture's other asks (the % bar, the analysis mode) - an instrumented suite can start containers (Docker, Testcontainers) and run for minutes, so it never starts on a description match alone. No answer, no run.

  ```ask
  No COVERAGE-QUALITY.md yet. Measure every surface now? <the surfaces, and the containers a suite starts>
  - 'Measure now (Recommended)' - each surface's suite runs once, then COVERAGE-QUALITY.md is written
  - 'Not now' - nothing runs, nothing is written
  ```

  The mode and bar asks, in that same call when the gate fires:

  ```ask
  Analyze <the measured surfaces> through the test-coverage-analyzer seats or in this session?
  - 'Through the seats (Recommended)' - the read-only seats absorb the raw-output reads; the judgment and the write stay here
  - 'In this session' - navigation-tools-first and bounded, no dispatch
  ```

  ```ask
  No coverage bar is recorded yet. Which bar should COVERAGE-QUALITY.md judge against?
  - '90% line coverage after exclusions (Recommended)' - the house default, recorded in the doc
  - 'A different bar' - I ask for the number and the metric next, in plain text
  ```

- **Analysis on an UPDATE is INLINE** (doc + stamp exist) - compare this run's fresh numbers against the doc's previous per-module table and deep-read only where they moved; unchanged modules keep their recorded weak points. Dispatch the agent for a surface whose picture shifted broadly - that surface is a first capture again - or whenever the USER explicitly asks for agents: their ask always wins over the inline default.

## The run

### 1. ORIENT
Read `<docs-path>/quality/COVERAGE-QUALITY.md` if it exists - a claim to verify, not ground truth - and take from it the recorded requirement override and exclusion list, if any (those are the user's decisions and carry across branches). Whether the doc switches with git branches follows `node .claude/hooks/docs.js status`: under `mode: git` the doc and its `coverage-raw/` files are committed and versioned per branch (say so in the report when the raw output is bulky); under `mode: overlay` both stay out of git and do not switch. Either way its `Captured: <branch>@<short-sha>` stamp says whose numbers it holds - a stamp from another branch means every number in it is stale for HEAD, worth saying in the report; this run replaces them with fresh measurements either way. Inventory the surfaces: each stack in the workspace that owns tests (a .NET solution, an Angular app, a plain JS/TS package) is measured separately. Scope to what the user named on a large workspace; every surface otherwise.

### 2. DETECT - the tooling per surface
Find what the project already uses - never pick or install one:

- **.NET** - coverlet via `dotnet test --collect:"XPlat Code Coverage"` (or the msbuild `/p:CollectCoverage=true /p:CoverletOutputFormat=cobertura` form the repo already wires - without the format flag it writes json) -> cobertura XML - a Microsoft.Testing.Platform project takes that platform's coverage extension and flag instead (`coverlet.MTP` and `--coverlet` at this writing; confirm via the documentation tools, never from recall).
- **Angular** - `ng test` with the coverage flag of the builder `angular.json` names (`--coverage` under `@angular/build:unit-test`, the Vitest default for new workspaces, which needs `@vitest/coverage-v8` installed - a missing one is an unmeasured surface, never an install by this capture; `--code-coverage` under the older Karma builder - confirm an unfamiliar builder's flag via the documentation tools, never from recall) -> the `coverage/` output (lcov + summary).
- **Plain JS/TS** - the ladder: a `package.json` test script -> a runner config file -> a test runner in devDependencies; use the first rung that answers, with its coverage flag.
- **Any other stack** - the project's own test script or runner config, with the coverage flag that runner documents (confirm it via the documentation tools, never from recall).

A surface where every rung is empty is a **'no test infrastructure'** verdict: coverage unmeasurable, the requirement UNMET, one weak point tiered substantial whose simplify-testing action names the missing harness. Installing the runner is the loop's first fix, never this capture's.

### 3. MEASURE - once per surface, in this session
Run the instrumented suite ONCE per surface and keep the machine-readable output - `cobertura.xml`, `lcov.info`, `coverage-summary.json`, whatever the tooling produced - under `<docs-path>/quality/coverage-raw/<stack>/`, replacing that surface's previous raw files. Scope the run to the project's normal suite: long-running replay/soak/E2E categories (a replay-tagged integration suite, an hours-long market replay) stay OUT unless the user explicitly includes them - record them as excluded-by-default in the doc - an unasked replay run can fill the disk before anyone stops it. Never save an HTML report tree - it is rebuildable bulk. A suite that fails to run is recorded as unmeasured with the failing command quoted - never estimated.

### 4. ANALYZE - judge against the user's requirement
Fan out test-coverage-analyzer per surface, up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` at once (default 5), exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - or do the same inline when no dispatch - then aggregate per stack and per module. The bar is the USER's: take the doc's recorded requirement; with none recorded, ask (the batched AskUserQuestion from Analysis, never a prose question) - offer **90% line coverage after exclusions** as the house default - and record the answer in the doc. Then Read `references/test-coverage-quality-weak-points.md` before the first weak point is recorded - the exclusions rule, the findings gate every candidate passes, and the three buckets survivors sort into are that file. Each surviving weak point is tiered and carries a simplify-testing action (the smallest change that would make the code cheap to cover):

- **small** - uncovered behavior the existing seams already expose: scoped tests close it, no production change.
- **substantial** - testability blocks the tests first (a static seam, a captive dependency, an un-injectable clock - a refactor must land before tests can attach), or the 'no test infrastructure' verdict.
- **structural** - coverage unreachable without a cross-cutting rework; a user decision, never assumed.

### 5. WRITE - reconcile both artifacts
Write `<docs-path>/quality/COVERAGE-QUALITY.md` as clean scannable Markdown in the shape below, tables over prose: a first-line stamp `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`, `+dirty` appended when the tree held uncommitted changes (the numbers describe exactly that code - any other branch, and any reader of a dirty stamp, re-measures, never trusts), the requirement + override + applied exclusions, a per-stack verdict table (surface, line %, requirement, verdict), a per-module table per surface (module, line %, the uncovered hot spots), and the weak points in their three buckets - Must fix tiered with a simplify-testing action each, Worth knowing with promotion conditions, Deliberate tradeoffs with reasons. Suite-quality smells from the digests land in those same buckets, each keeping its `red-check pending` label - the analysis seat is read-only and cannot prove a smell, so the label routes the proof to whoever rewrites the spec (the coverage loop's fix step runs it). A smell the loop DISPROVED by red-check carries `red-check: disproved <date>` on its entry instead - honor it like a recorded decision and never re-flag that spec for the same smell. Re-run: reconcile in place - resolved weak points drop off, new gaps land, stale numbers are replaced. Cap the narrative while reconciling: keep the current capture's headline, fold older per-round/per-capture prose into a one-line-per-round changelog at the doc's END - the doc otherwise only grows, and every loop round pays its read. Put a `## Resume` section right under the stamp - requirement, exclusions, open weak points by tier: exactly what a resumed round needs - so round starts read that section ranged instead of the whole file; it is DERIVED from the full sections below (regenerated whole each reconcile, the full sections authoritative on any mismatch), so the duplication cannot drift. Compose the reconcile in-session and land it in one write (or one batched edit pass) per doc - never a per-claim edit stream. Create the folders only when absent; write ONLY `<docs-path>/quality/COVERAGE-QUALITY.md` and `<docs-path>/quality/coverage-raw/` - never source, never a test, never another doc.

### 6. REPORT
`wc -l` COVERAGE-QUALITY.md after the write; a missing `## Resume` section is fixed before the report. Then the close, one line per field:

```
Doc:         <created | refreshed> - <docs-path>/quality/COVERAGE-QUALITY.md, <n> lines
Raw:         <surface>: <the files under coverage-raw/<stack>/>
Verdicts:    <surface | line % | bar | MET, BELOW or UNMEASURED>, one per surface
Weak points: small <n>, substantial <n>, structural <n> - the top few gaps named first
Unmeasured:  <surface - the failing command and what would settle it, or none>
Leftovers:   <what the instrumented runs started and still have up, or none>
Run gate:    <the answer verbatim | invoked by the coverage loop>
```

Fill a `Leftovers:` line - what the instrumented runs started and still have up (a Docker container or compose stack, a seeded test database, a background process), or `none`; anything listed gets tear-down-vs-keep through AskUserQuestion in the same close, teardown recommended - the named line is what makes the check happen, and what the run did not start is never touched. Point to the files - no re-paste of the doc body.

## Example

One .NET API surface, requirement 90%: the verdict table reads `| aspnet-api | 84% | 90% | BELOW |`; the module table names `InvoiceService` at 61% with its uncovered error branches as the hot spot; the weak points land as - small: 'InvoiceService error branches - four scoped tests on the existing seams', substantial: '`PaymentGateway` news up its `HttpClient` - inject the handler before tests can attach'.

One Angular surface, same requirement: the detection ladder finds the coverage flag on the workspace's own test builder rather than a config file, so MEASURE runs the suite once with it and keeps the raw output; the verdict table reads `| web-app | 71% | 90% | BELOW |`, the module table names the checkout feature's effect handlers as the hot spot, and the weak points land as - small: 'checkout effects - error and cancel paths untested on the existing harness', substantial: 'the feature component builds its own HTTP client - move it behind the injected service before tests can stub it'. A plain TS library surface reads the same way with the runner the workspace already declares.

## Don't game it
Every number comes from THIS run's raw output - never recalled, never estimated, never carried forward from a stale doc. A surface that would not run is unmeasured, not guessed. A weak point exists because the uncovered code is dangerous, never because the doc has a section to fill - and a real one is never left off because the section is long. Never widen the exclusion list or lower the requirement to turn a verdict green - both belong to the user, recorded in the doc. And the percentage is a proxy: a suite padded with assertion-free tests that touch lines without pinning behavior is itself a weak point to record, not a pass.
