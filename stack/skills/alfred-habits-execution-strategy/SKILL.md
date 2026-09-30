---
name: alfred-habits-execution-strategy
description: "Use before a multi-file task or one with many steps - split, parallelize, subagents. Not for a one-line diff or a solve flow, which owns its dispatch."
---

# Execution strategy - the cheapest mode that fits, checked in tiers

Multi-agent work costs several times a single session, and most coding work has fewer independent
parts than it first appears. So one agent is the default, and every number below is a starting
point to tune on what the project measures, not a law.

## When to use

- Fires before the first edit of a task that needs more than a few steps across more than one file or subtask. Skip it when the whole diff fits one sentence.
- It decides the mode and the check tiers. Test-first (`alfred-habits-test-first`) still runs inside each track, and this skill never replaces it.
- Not inside a stamped solve flow: the flow owns the plan, the approval gate, the dispatch and the seats. Follow it, and take from here only the check tiers where the flow is silent.

## The plan - inline, five to ten lines

In the reply or the todo list, never a plan file; then proceed without waiting unless a stop below applies.

1. **Subtasks** - each with the files it touches.
2. **Dependencies** - dependent when one consumes the other's output, or both touch the same file, project or manifest file, lockfile, migration, DI registration or shared contract.
3. **Mode** - one line of why.
4. **Checks** - what runs per batch, what runs once at the end.

## Mode

- **One agent, in order** - dependent steps, same-file edits, a small task, debugging one failure.
- **One agent, batched calls** - the speed lever. Reads, searches and commands that do not depend on each other go in the same turn; a call whose input is another's result waits.
- **Subagents** - only when ALL hold: two or more subtasks are independent; each is sizeable (about ten tool calls, or a wide read that would flood this context); the contracts they share already exist in code; each can be verified alone. Two to four is the usual count; past that, say why in the plan. Never for a handful of calls, never to re-check your own work.

The seats are the house `<stack>-implementer` for edits and the read-only seats for investigation (the dispatch guard blocks a generic dispatch while a flow stamp is live, and an implementer without the approval gate). Seats that edit files in one directory each get a separate worktree where the platform offers one. With no dispatch available, run the tracks inline in order.

## A fan-out, in three steps

1. **Contracts first, in order.** Shared interfaces, DTOs, schema and migrations, DI registrations and file ownership, then one build to prove they compile.
2. **Brief each seat completely** - it cannot see this conversation: the objective, the files it owns and the ones it must not touch, the contract to code against, the tier-1 checks it must pass, and the report shape (changes, files, check results, open questions).
3. **Integrate one track at a time,** conflicts settled here. A seat's 'tests pass' or 'no other callers' stays unverified until the integrated build and tests confirm it.

The stack's own fan-out (split balance, the worktree brief, status routing, fan-in) lives in the cross-domain solve flow's domain-trio protocol, where installed - use it, never restate it.

## Checks, in three tiers

Errors compound across steps, so check as you go, but never run the heavy suite after every step.

- **Tier 1, per batch (seconds)** - build or typecheck the affected project, lint the changed files, run only the tests covering the change. Fix before the next batch.
- **Tier 2, once after the whole change (minutes)** - the full build and the full unit and integration suites, e2e where the project has them; the done gate runs on this.
- **Tier 3, once before a push** - only where the project has a CI compose file or a Dockerfile test stage that CI calls: run it locally, images built from this branch. What ran, or `NOT RUN - <reason>`, is the push receipt's `live-probe:` line (the commit checkpoint owns the receipt). A CI step that cannot run here (secrets, cloud services, another OS's runner, signing) is named in the close. No such file: no Tier 3 - never invent one.

A wait of minutes runs in the background (the quality-gates rule).

## Stops

The always-on rules already stop for a destructive act, a push, merge or deploy nobody asked for, a commit before the user says so, and a fix that failed repeatedly (`alfred-habits-root-cause`). Beyond them:

- A plan needing more than about five seats, or a scope far past the request: ask first.
- A required secret or service is missing and no local stand-in exists: report it, do not work around it.

## The close

One line on the mode and why, what changed, each tier's command with its result, and what was not verified here with the reason.

## Signs it was skipped

- Subagents spawned for work a few tool calls would have finished.
- The full suite re-run after every step, or CI treated as the first real test.
- Two seats editing one file or one shared contract.
- A seat's report taken as proof without the integrated run.
