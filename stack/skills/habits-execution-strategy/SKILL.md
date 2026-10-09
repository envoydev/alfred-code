---
name: habits-execution-strategy
description: "Use before deciding how to run a multi-step build or fix - route, mode, seats, 'split this up', 'run in parallel'. Not for a small task, which settles inline."
---

# Execution strategy - how the work runs, not only what it changes, checked in tiers

A plan that names every file to change can still run badly: on the wrong route (a direct edit where
the change needed the user's sign-off, a gated flow for a two-file fix), serial where independent
parts could have run at once, fanned out where two parts share a file and collide, or on a model the
work does not need. So before a build or a fix starts, decide HOW it runs - the route, the mode and
the model - and recommend the parallel form whenever nothing is lost by it. Multi-agent work costs
several times a single session, so parallel SEATS need units that are each sizeable as well as
quality-safe; batched calls are the free parallel form. Every number below is a starting point to
tune on what the project measures, not a law.

## When to use

- Fires before the first edit of a task that needs more than a few steps across more than one file or subtask, spans stacks, touches auth, a migration or a public contract, or would fan work out to seats. A small task settles route, mode and model inline from the always-on line (a direct edit, one agent, batched calls, the session's model) - no load.
- It decides the route, the mode, the model and the check tiers. Test-first (`habits-test-first`) still runs inside each track, and this skill never replaces it.
- Inside a solve or diagnose flow, the flow calls it before its build-mode ask or its fix task cards. The route is then the flow, so it supplies the mode and the model in the `Execution:` verdict and the option it recommends; the flow keeps the plan file, the approval gate, the dispatch and the seats, and the user's answer still decides.

## Route - where the work runs

Outside a flow, pick the lightest route that keeps the work safe, from the task and the code it
touches:

- **Direct** - this session edits and verifies. The default for any task the session can finish
  and check itself.
- **The gated single-chat solve flow** - a change whose design should be signed off before it is
  built: an auth, payment, migration or public-contract path, or a request that asks for approvals.
  Also the route for parallel EDIT seats on one stack (its agents mode).
- **The cross-domain solve flow** - work spanning backend and frontend, or one that needs seats
  routed and a seam held between them.
- **The diagnose flow** - a failure whose evidence is outside the code (logs, a red CI run, a trace,
  a screenshot) and whose cause is not yet known. A failure in front of you goes to the root-cause
  habit first, here.
- **The greenfield or framework-upgrade flows** - a new app before any code exists, or a version
  bump with breaking changes across the codebase.

Parallel edit seats are a flow's job: an implementer seat dispatches only on an approval stamp that a
flow writes from the user's answer, so on the direct route the seats are read-only ones
(investigation, evidence) and edits run here.

The flows are user-invoked, so a route other than direct is never a silent switch: put it through
this ask before the first edit, and end the turn on it.

```ask
This task fits <the flow>: <what it adds for THIS task>. Start it, or proceed here directly?
- 'Start <the flow's slash command> (Recommended)' - <what the flow adds for this task>
- 'Proceed direct' - <what is given up: the sign-off, the parallel seats, the seam check>
```

'Start' hands the user the command to type. 'Proceed direct', or a flow that is not installed,
leaves the route direct; a parallel-edit verdict then runs as batched calls or in order here.

## How it runs - decide before the mode

For each subtask of the plan, or each task card of a flow, settle four things from the code, not
from the task's wording:

1. **What it writes** - the files, and any shared contract, manifest, lockfile, migration or DI
   registration it touches.
2. **What it needs first** - another unit's output (a type, an endpoint, a migration) or nothing.
3. **How it is verified alone** - the test or build that shows it works without the others, or
   'only the integrated run shows it'.
4. **Whether the design is settled** - a unit whose decision is still open is not ready to run
   anywhere but here.

Then ask the one question that sets the mode: **can these units run at the same time without losing
quality?** Quality is lost when two units write the same file or shared contract, when one needs
another's output, when a unit cannot be verified alone, or when a unit still needs a decision only
this session holds. When none of those holds for two or more units, parallel loses nothing and
**parallel is the recommendation** - batched tool calls for small units, parallel seats for sizeable
ones (Mode, below). When one holds, those units run in order; the rest may still run side by side.

## Model - what each part runs on

- **This session** runs on the model and effort the user chose; this skill never changes them.
  Name a switch in the verdict only when the work's risk needs deeper reasoning than the session
  has - a cross-domain contract design, a hard root cause - never by default.
- **A seat** runs on its frontmatter pin; that pin is the default. Where the platform takes a model
  per dispatch, the model can be overridden for one task, the effort cannot. A lighter model only for
  a mechanical task whose correctness shows on the diff AND an independent verifier re-runs its
  gates; never below the pin on auth, a migration, concurrency, security, a shared contract seam or
  unclear legacy code. The heaviest model is for design and hard root cause, not routine edits.
- Inside the cross-domain solve flow its model-routing reference (the role table, the escalation
  column, the designer's per-task model) wins; outside it, these lines are the whole rule.

## The verdict

State it in one line, the line a flow's mode ask carries as its reason (inside a flow, `route` is
the flow):

```
Execution: route <direct | the flow offered> - mode <serial | batched | parallel seats: <n>> - model <session | seat pins | <seat>=<model>> - <why>; parallel keeps quality: <yes - each unit owns its files and is verified alone | no - <the shared file, contract or output>>
```

Filled in, for a change whose two handlers both read a new DTO:

```
Execution: route direct - mode serial - model session - the DTO lands first, both handlers read it; parallel keeps quality: no - each handler needs the DTO's output
```

Inside a flow, the recommended option follows the verdict: `parallel seats` marks the flow's
seats option, `serial` or `batched` the in-session one. Where no dispatch is available,
`parallel seats` becomes batched calls in this session, said in the verdict.

## The plan - inline, five to ten lines

In the reply or the todo list, never a plan file - a flow's plan file included: there the
`Execution:` line rides the flow's mode ask, and a diagnose flow states it in its close. Then
proceed without waiting unless a stop below applies.

1. **Subtasks** - each with the files it touches.
2. **Dependencies** - dependent when one consumes the other's output, or both touch the same file, project or manifest file, lockfile, migration, DI registration or shared contract.
3. **Route, mode, model** - the `Execution:` verdict above.
4. **Checks** - what runs per batch, what runs once at the end.

## Mode

- **One agent, in order** - the quality check fails for these units.
- **One agent, batched calls** - the check passes and the units are small. Reads, searches and commands that do not depend on each other go in the same turn; a call whose input is another's result waits.
- **Parallel seats** - the check passes for two or more units that are each sizeable (about ten tool calls, or a wide read that would flood this context) and whose shared contracts already exist in code. Up to 3 at once by default, more only on the user's ask. Never for a handful of calls (those are batched), never to re-check your own work.

Edit seats are the house `<stack>-implementer`, inside a flow (Route, above); read-only seats run on any route. The dispatch guard blocks a generic dispatch while a flow stamp is live. Seats that edit files in one directory each get a separate worktree where the platform offers one. With no dispatch available, run the tracks inline in order.

## A fan-out, in three steps

1. **Contracts first, in order.** Shared interfaces, DTOs, schema and migrations, DI registrations and file ownership, then one build to prove they compile.
2. **Brief each seat completely** - it cannot see this conversation: the objective, the files it owns and the ones it must not touch, the contract to code against, the tier-1 checks it must pass, and the report shape (changes, files, check results, open questions).
3. **Integrate one track at a time,** conflicts settled here. A seat's 'tests pass' or 'no other callers' stays unverified until the integrated build and tests confirm it.

Inside the cross-domain solve flow its domain-trio protocol (split balance, the worktree brief, status routing, fan-in) wins; outside it, these three steps are the whole rule.

## Checks, in three tiers

Errors compound across steps, so check as you go, but never run the heavy suite after every step.

- **Tier 1, per batch (seconds)** - build or typecheck the affected project, lint the changed files, run only the tests covering the change. Fix before the next batch.
- **Tier 2, once after the whole change (minutes)** - the full build and the full unit and integration suites, e2e where the project has them; the done gate runs on this.
- **Tier 3, once before a push** - only where the project has a CI compose file or a Dockerfile test stage that CI calls: run it locally, images built from this branch. What ran, or `NOT RUN - <reason>`, is the push receipt's `live-probe:` line (the commit checkpoint owns the receipt). A CI step that cannot run here (secrets, cloud services, another OS's runner, signing) is named in the close. No such file: no Tier 3 - never invent one.

A wait of minutes runs in the background (the quality-gates rule).

## Stops

Beyond the always-on stops:

- A plan needing more than about five seats, or a scope far past the request: ONE AskUserQuestion first, the trimmed plan recommended.
- A required secret or service is missing and no local stand-in exists: report it, do not work around it.

## The close

One line on the route, mode and model and why, what changed, each tier's command with its result, and what was not verified here with the reason.

## Signs it was skipped

- Seats dispatched for work a few tool calls would have finished.
- Independent, separately verifiable units built one after another with no `Execution:` line saying why.
- A flow's mode ask whose recommendation names no execution verdict.
- A gated or cross-domain change started as a direct edit with no route ask, or an implementer seat dispatched on the direct route.
- A seat dispatched below its pin on a risk path.
- The full suite re-run after every step, or CI treated as the first real test.
- Two seats editing one file or one shared contract.
- A seat's report taken as proof without the integrated run.
