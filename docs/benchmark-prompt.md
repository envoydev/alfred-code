# Benchmark prompt - measure the Claude agent stack against the linked example projects

You are running an autonomous **benchmark** of a Claude Code agent stack. Your job is to
install the stack into two linked example projects, drive a fixed matrix of tasks and investigations
through it, **measure** what the stack actually does (which skills / MCPs / hooks / rules / agents fire,
how many times, and how many tokens each test case burns), and then write a statistics report and a
grounded pros/cons analysis.

This is a measurement exercise, not a feature project. Every number you report must be **MEASURED** from
real tool output and labelled with its source. Anything you infer is **ASSESSED** and must be kept
visibly separate. Never fabricate a number.

---

## 0. What you are benchmarking

The stack lives in the `alfred-code` repo (referred to below as `<STACK>`). It provides, per consuming
project: ~53 house **skills**, 32 **agents** (a `cross-stack-agents-flow` router over `main-stack-agents-flow`; per-domain
`solution-designer -> implementer -> verifier` trios for asp.net/angular/wpf/mobile/data/devops; cross
cutting `architecture-analyzer`, `task-analyzer`, `alfred-issue-diagnoser-runtime`, `alfred-issue-diagnoser-ci`,
`cross-stack-contract-designer`, `integration-reviewer`, `security-auditor`, four build/test resolvers,
and a read-only `evidence-gatherer` the diagnosers dispatch), 3 **hooks**, 8 path-scoped **rules**, 8
**plugins** (incl. `caveman` terse-output), and 4 **MCPs** (`serena`,
`context7`, `memory`, `playwright`).

**Read these before you start** (do not skip - they define the flow you are measuring):
`<STACK>/CLAUDE.md`, `<STACK>/skills/cross-stack-agents-flow/SKILL.md`,
`<STACK>/skills/main-stack-agents-flow/SKILL.md`, and the existing measurement harness under
`<STACK>/examples/` (`angular-project-test-prompt.md`, `ANSWER-KEY.md`, `RUN-PHASES-1-3.md`) - your
methodology mirrors and extends theirs (MEASURED vs ASSESSED; cite every number's source).

### The two projects (a linked backend + frontend pair)

- `<STACK>/examples/aspnet-api-project` - a .NET 10 Task API (Minimal API + vertical slice, EF Core +
  SQLite). Domains: **aspnet** + **data**. Runs on `http://localhost:5080`.
- `<STACK>/examples/angular-project` - an Angular 18 "Task Playground". Domain: **angular**. Consumes the
  API (`proxy.conf.json` maps `/api` -> `:5080`). Runs on `http://localhost:4200`.

They share one `Task` contract (`id`, `title`, `description`, `status`, `priority`, `dueDate`,
`createdAt`, `updatedAt`, `tags`), so a feature that touches both is a genuine **cross-domain** exercise.

---

## 1. Setup (Requirement 1 - install the stack per project)

These projects currently live as tracked content inside `alfred-code`, so they have **no git repo of
their own**. The installer resolves the project root via `git rev-parse` and serena binds via
`--project-from-cwd`, so each must be a standalone git repo or the install scopes to the wrong root.

For each project, do this **in an isolated workspace outside `<STACK>`** so the benchmark never mutates
the source repo:

1. Copy the project to a sibling benchmark workspace, e.g. `~/agent-bench/aspnet-api-project` and
   `~/agent-bench/angular-project` (keep them siblings so the cross-project link + proxy still work).
   Exclude any `bin/ obj/ .angular/ node_modules/ .serena/ .claude/ .mcp.json` you copied - reinstall clean.
2. `cd` into each, `git init`, restore deps (`dotnet restore` / `npm ci`), confirm the **baseline is
   GREEN** (`dotnet test` = 9 passing; `ng build` + `ng test --watch=false --browsers=ChromeHeadless`
   = 21 passing), commit, and `git tag baseline`.
3. Install the stack into each: run `node <STACK>/scripts/install/alfred-code.js install --source <STACK>`
   from inside the project (skills/agents via the plugin closure, MCPs into `.mcp.json` on the copy
   route, hooks/rules fetched, plugins installed).
   Enable the `playwright` MCP for `angular-project` and comment it out for `aspnet-api-project`;
   comment out the `memory` MCP in **both** - it is not needed here (the static cross-project map lives
   in `docs/RELATED-PROJECTS.md`, step 4, and serena's per-repo local memory carries the per-feature
   handoff).
4. **Create each project's `CLAUDE.md` from the template.** The installer lays down skills / MCPs /
   hooks / rules / agents / plugins but does NOT write the project instructions - fill those in from
   `<STACK>/templates/CLAUDE.template.md`, the stack-neutral base with `<placeholders>`. Copy it to the
   project's `CLAUDE.md` and resolve every placeholder for that project's stack:
   - `aspnet-api-project` = .NET 10, Minimal API + vertical slice, EF Core + SQLite (the `aspnet` + `data`
     domains); point the convention and secret/config-glob placeholders at the real stack.
   - `angular-project` = Angular 18 standalone task playground (the `angular` domain), consuming the API.
   Also fill each project's CLAUDE.md `## Related projects` awareness entries (the API
   `provides-to` the SPA; the SPA `consumes` the API - name, location, relation, the `/api` seam
   line) and put the orientation detail (what to read first, what sends you there) in a committed
   `docs/RELATED-PROJECTS.md` (tracked, never gitignored; the entries stay in `CLAUDE.md`, always
   loaded, so the agent knows the sibling exists). This static cross-project map is what replaces the
   `memory` MCP here. Without a filled `CLAUDE.md` the agents run with no project instructions and the
   run is not representative of the stack.
5. **Record the installed inventory per project** (MEASURED): count of agents in `.claude/agents/`,
   skills in `.claude/skills/`, rules in `.claude/rules/`, hooks wired in `.claude/settings.json`, MCP
   servers in `.mcp.json`, plugins enabled, and confirm `CLAUDE.md` + `docs/RELATED-PROJECTS.md` exist
   and are filled from the template. Confirm serena + context7 connect (the `memory` MCP is intentionally
   off here).

You will run the benchmark from a session whose cwd is the relevant project (or, for cross-project
cases, launched so both project roots are reachable and both dev servers can run).

> **nx note:** neither project is an Nx workspace (no `nx.json`), so the `nx` skill will **not**
> self-activate. Handle this in the ablation phase (Section 6) - do not pretend it fired.

---

## 2. Ground rules (read before running anything)

- **MEASURED vs ASSESSED.** Token counts, agent/tool call counts, pass/fail, and punch-list cycles are
  MEASURED - cite the source (subagent result `subagent_tokens` / `tool_uses`, a `/cost` delta, the
  hook output block, the file diff). Quality judgements are ASSESSED - keep them in a separate column.
- **Test isolation.** Every test case branches fresh off the `baseline` tag, runs once, and is reset
  (`git checkout baseline` / delete the branch) before the next. No case may depend on another's state.
- **Grader-only ground truth.** For the defect and investigation phases you will author a private
  answer key (expected mode, seeded root cause, expected fix). **Never** paste that answer key, the
  expected mode, or the seeded root cause into a dispatched sub-agent's prompt - a seat that reads the
  answer voids the measurement. Feed dispatched seats only the user-facing symptom / task.
- **Cheapest signal, once.** Run each cell once, in the cheapest mode that still exercises the intended
  path. This matrix is large; if you must cap coverage, `log` exactly what you dropped - silent
  truncation reads as full coverage.
- **Cost warning.** The full matrix (5 test families x multiple cells x multi-agent flows + ablation
  re-runs) can run to millions of tokens. Confirm the intended scope before launching everything, and
  prefer the execution order in Section 8 (cheapest, highest-signal first).
- **Time the heavy one-offs separately.** The C# Roslyn LSP index build (~327MB) and first serena
  warmup are one-time costs - measure once and amortize; never fold them into a per-case token figure.

---

## 3. Instrumentation - the per-case ledger

Maintain a machine-readable ledger (`BENCHMARK-LEDGER.jsonl`, one row per test case) with this schema.
Fill every field from observation; mark any estimate `ASSESSED`.

```json
{
  "id": "B3",
  "family": "happy-path | architecture | verifier-loop | investigation | ablation",
  "projects": ["aspnet-api-project"],
  "description": "server-side filter + pagination on GET /api/tasks",
  "expected_mode": "domain_trio",          // your grader-only prediction
  "actual_mode": "fanout_domain_trio",     // MEASURED from what actually ran
  "agents": { "aspnet-solution-designer": 1, "aspnet-implementer": 2, "aspnet-verifier": 1 },
  "skills_invoked": ["csharp", "dotnet-web-backend", "dotnet-testing"],
  "mcps_used": { "serena": 14, "context7": 2 },
  "hooks_fired": ["guard-read-whole-file"],
  "rules_attached": ["csharp-conventions"],
  "tokens": { "subagents_total": 41000, "by_agent": { "aspnet-implementer": 21000 }, "main_delta": 6000, "source": "subagent_tokens + /cost delta" },
  "tool_uses": 47,
  "duration_ms": 144000,
  "outcome": "pass | fail",
  "verifier_caught_issue": false,
  "punchlist_cycles": 0,
  "evidence_gatherers": 0,
  "notes": "MEASURED: ...; ASSESSED: ..."
}
```

**How to capture each field:**
- **Tokens** - the precise source is each dispatched agent's result metadata (`subagent_tokens`,
  `tool_uses`); sum them for the case. For main-loop tokens, snapshot `/cost` before and after the case
  and record the delta. State the method; main-loop attribution is approximate - say so.
- **Agents / their counts** - you dispatch them, so tally directly.
- **Skills** - count `Skill` tool invocations; also note any skill whose guidance auto-attached.
- **MCPs** - count `mcp__<server>__*` tool calls, grouped by server.
- **Hooks** - each guard hook prints a block when it fires on a `Bash`/`Read` event; tally those.
- **Rules** - a path-scoped rule injects its text as a system-reminder when a matching file is touched;
  note which fired (observed, lower-confidence than the tool tallies - mark it).

---

## 4. The test matrix

Author your grader-only answer key first (Appendix A gives concrete cells and seeded defects). Then run
each family. For every case, produce one ledger row.

### Family A - Architecture analysis (Requirement 2)

Per project, dispatch `architecture-analyzer` on the clean baseline. Measure: does it produce a lean
`docs/architecture/ARCHITECTURE.md` core plus `docs/architecture/references/` deep-dive files; which tools it used (serena
symbol nav vs whole-file Reads; context7); whether it applied `markdown-style`; tokens + duration.
ASSESSED: rate the doc's usefulness to a downstream designer (would a solution-designer orient from it
without re-deriving the project?).

### Family B - Happy-path task flow (Requirement 3)

Drive real work through `cross-stack-agents-flow`/`main-stack-agents-flow` and measure the normal path (no forced defect):
- **B1 small / aspnet**, **B2 small / angular** - expect a light mode (`single_chat` / `implementer_only`).
- **B3 big / aspnet**, **B4 big / angular** - expect a full `domain_trio` (or fan-out).
- **B5 cross-project feature** - a feature spanning both projects; expect the cross-domain path
  (`cross-stack-contract-designer` freezes the contract -> aspnet+data trio and angular trio run ->
  `integration-reviewer` final gate before commit). This is the flagship cell - the reason the linked
  pair exists.
Record actual vs expected mode, the full agent roster + counts, skills/MCPs/hooks/rules, tokens, outcome.

### Family C - Verifier catches an implementer defect (Requirement 4)

Repeat the B1 / B3 / B5 shapes, but each task carries a specific, verifiable acceptance criterion the
implementer is likely to under-deliver (Appendix A). The goal is to observe the **verifier -> implementer
punch-list loop** fire at least once per case. Measure: did the verifier catch a real issue, how many
punch-list cycles ran, and the token cost of the loop vs the clean B run. If a first pass comes back
genuinely clean, note it (also a result) and then inject one realistic seeded defect from Appendix A so
the loop is exercised and measured - keep the seeded defect out of every dispatched seat.

### Family D - Investigation / diagnosis (Requirement 5)

Seed a real bug (grader-only), then feed the **diagnoser only the user-facing symptom**. Measure how
many `evidence-gatherer` runs the diagnoser dispatches (1..N) and how much each consumes (its
`subagent_tokens` / tool output volume), and whether root cause was proven before any fix.
- **D1 small / aspnet**, **D3 small / angular** - a one-line bug; expect 1 gatherer.
- **D2 hard / aspnet**, **D4 hard / angular** - a subtle cross-file bug; expect several gatherers.
- **D5 hard / cross-project** - a bug whose symptom is in one project and root cause in the other (a
  contract mismatch); expect gatherers spanning both.
(Requirement 5's list repeats "small issue per project" - treat that as the small x2 + hard x2 + hard
cross-project set above; note the dedup in your report.)

### Family E - Ablation: how much do caveman / nx help (Requirement 6)

Re-run two representative cells (recommend **B3** big-task and **D2** hard-investigation) with one
capability removed at a time, comparing tokens and behaviour against the baseline run:
- **the minimal-code discipline off** - it is no longer a plugin: since 0.2.74 the ladder lives inline
  in the seat bodies, so ablate it by dispatching a seat whose discipline paragraph is stripped.
  Measure diff size / over-build (did the implementer add abstractions or dependencies it did not need?)
  and token delta.
- **caveman off** - disable it. Measure output-token delta (report/punch-list verbosity), not input.
- **nx** - **not applicable**: neither project is an Nx workspace, so `nx` never activates. Report this
  honestly, describe what `nx affected` / graph-scoping *would* save in a real Nx monorepo, and mark the
  cell N/A. (Optional, only if you want a real number: convert `angular-project` to a minimal Nx
  workspace and re-run - flag it as a synthetic setup.)

---

## 5. Deliverables

Write two files at the benchmark root.

### `BENCHMARK-STATS.md` (all MEASURED, tables)

1. **Install inventory** per project (agents/skills/rules/hooks/mcps/plugins counts).
2. **Usage totals across all cases** - one table each for skills, MCPs, hooks, rules, agents, with a
   "times used" count and which cases used them. (This is the "what was used and how many times" ask.)
3. **Per-case cost** - a row per cell: tokens (subagent + main), tool_uses, duration, actual mode,
   outcome. Subtotal per family and a grand total.
4. **Flow metrics** - mode-ladder distribution (how often each mode fired), verifier catch rate +
   punch-list cycles, evidence-gatherer fan-out per investigation cell.
5. **Ablation deltas** - baseline vs minimal-code-off vs caveman-off token + behaviour comparison; the nx
   N/A note.

### `BENCHMARK-ANALYSIS.md` (MEASURED-grounded judgement)

Based strictly on the statistics above, write:
- **10 pros** of the approach (design + token usage) - each citing the stat that supports it.
- **10 cons** (only real ones; if you find fewer than 10, say so rather than padding) - each citing the
  stat that reveals it, **and** a concrete description of how to improve it (a specific change to a
  skill / agent pin / mode threshold / MCP config / hook, not a vague "optimize further").
Keep MEASURED evidence and ASSESSED judgement distinguishable throughout.

---

## 6. Appendix A - concrete cells + grader-only seeds

Treat this appendix as grader-only. The **task/symptom** line is what you may give a dispatched seat;
the **seed / expected** lines are yours alone.

- **B1 (small aspnet):** Task - "Add `GET /api/tasks/count` returning `{ count }` for all tasks."
  Expected: implementer_only / single_chat.
- **B2 (small angular):** Task - "Add a 'Clear completed' button to the list header wired to
  `store.removeCompleted()`." Expected: implementer_only.
- **B3 (big aspnet):** Task - "Add server-side filtering + pagination to `GET /api/tasks`: query params
  `status,priority,page,pageSize`; response `{ items, total }`; cover with tests." Expected: domain_trio.
- **B4 (big angular):** Task - "Add a tag filter: a multiselect over `allTags()` that narrows
  `visibleTasks`, persisted in the filter, with specs." Expected: domain_trio.
- **B5 (cross-project):** Task - "Add an `archived` flag to tasks end-to-end: EF field + migration; API
  create/update accept it and `GET /api/tasks` excludes archived unless `?includeArchived=true`; Angular
  `Task` model + store + an Archive/Unarchive action; hide archived by default." Expected: cross-domain
  (contract freeze -> both trios -> integration-reviewer).
- **C-series acceptance criteria to under-deliver:** B1+"count must honour the same archived exclusion as
  list"; B3+"pagination must be covered by a test for the last partial page"; B5+"the API must reject an
  update that sets both archived=true and status=active with 422". A conscientious verifier catches the
  gap.
- **D1 (small aspnet seed):** pagination off-by-one - `Skip(page*size)` instead of `(page-1)*size`.
  Symptom: "page 2 skips a task." Expect 1 gatherer.
- **D2 (hard aspnet seed):** EF change-tracking staleness or a captive dependency (a scoped service
  captured by a singleton). Symptom: "an updated task keeps returning its old values until the app
  restarts." Expect several gatherers; grade a FAIL if the seat patches the symptom instead of fixing
  the lifetime/tracking root cause.
- **D3 (small angular seed):** flip the `isOverdue` comparison (`>` vs `<`). Symptom: "the overdue count
  is wrong." Expect 1 gatherer.
- **D4 (hard angular seed):** make a filter field a plain property (not a signal) so `filteredTasks`
  stops reacting. Symptom: "changing the filter doesn't update the list until I navigate away." Expect
  several gatherers.
- **D5 (cross-project seed):** change the API enum casing or rename a serialized field so the Angular
  client mis-binds it. Symptom: "after a backend deploy, task status shows blank in the UI." Expect
  gatherers reading both projects; root cause is the contract, not the client.

---

## 7. Appendix B - honest caveats to state in your report

- Main-loop token attribution per case is approximate (via `/cost` deltas); sub-agent tokens are exact.
- Rule / auto-skill firing is observed, not perfectly instrumented - mark its confidence lower than the
  tool-call tallies.
- Single-run-per-cell means no variance estimate; note that a repeat could shift token figures.
- `nx` is not exercised on these projects (Section 4E) - its value here is described, not measured.
- The two projects carry two known transitive NU1903 advisories in the .NET build and a deliberately
  permissive dev CORS policy; neither affects the benchmark but both will appear in tool output.

---

## 8. Suggested execution order (cheapest, highest-signal first)

1. Setup + install both projects, record inventory + baseline (Section 1).
2. Family A (architecture) - cheap, and its docs feed later designers.
3. Family D small (D1, D3) - cheap, exercises the diagnoser + gatherer path.
4. Family B small (B1, B2) then big (B3, B4) - the core flow.
5. Family C on B1/B3 - the punch-list loop.
6. Family B5 + D5 - the cross-project flagship cases.
7. Family D hard (D2, D4) - the multi-gatherer cases.
8. Family E ablation on B3 + D2.
9. Write `BENCHMARK-STATS.md`, then `BENCHMARK-ANALYSIS.md`.

Stop and report partial results at any budget ceiling rather than skipping the write-up - a half matrix
with an honest stats table beats a full matrix with no analysis.
