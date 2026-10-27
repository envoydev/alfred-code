---
name: solve-task
description: "Use when solving a task in this repo end to end - '/solve-task', 'solve this', 'spec, plan and build it'. This repo's own flow, not the stack's task-solve."
---

# Solve task - this repo's own flow

One change to alfred-code, from the request to a local commit, through the superpowers skills and this repo's
invariants (`CLAUDE.md`). Each step that names a skill loads it with the Skill tool.

## When to use

- A change to this repo that is more than one sentence: a feature, a fix, a hook, a skill, an installer step.
- Not for a consuming project, which runs the stack's `task-solve`; not for a release, which has its own procedure.

## Size first

State one line before anything else: `Size: <trivial|spike|bounded|architectural> - <the signal>`.

- trivial - no behaviour a test would see: a typo, a comment, formatting, a rename inside one file. It just gets
  made (`.claude/rules/execution.md`), its covering check runs, done. Anything that adds or changes behaviour - a new
  flag, option, output or branch - is at least bounded, however short the request.
- spike, bounded, architectural - load superpowers:brainstorming next and take its path for this size: a spike has its question
  and probe approved first, then ends in an answer and keeps nothing; a bounded change gets an in-chat design whose approval is a stop, then the build; an
  architectural change takes every step below. Under `auto-run` a bounded design's approval follows the same rule
  and waiver as a graded spec's (step 3).
- A design already settled by a run order or the user's rulings skips the spec and goes to the plan.

## The steps

1. Spec - superpowers:brainstorming writes `docs/superpowers/specs/<date>-<topic>-design.md`.
2. Grade - `refining-plans` to 90, its own loop.
3. Approval - the user approves the graded spec. Under `auto-run` it stays a stop; only the waiver `auto-run`
   defines skips it, and then the score path is reported in place of the ask.
4. Plan - superpowers:writing-plans writes `docs/superpowers/plans/<date>-<topic>.md`; grade it to 90; approval as in
   step 3.
5. Build - superpowers:executing-plans by default (one context, cheapest), superpowers:subagent-driven-development
   when the user asks for a gate per task, or when all of `execution.md`'s Mode conditions hold; with
   superpowers:test-driven-development throughout. The ledger is `docs/superpowers/sdd/<plan basename>/progress.md`.
6. Checks, in the tiers of `execution.md`:
   - per batch: `npm run lint` and the tests that cover the change;
   - a temp-project matrix from this working tree with CLAUDE.md's required edge cases - fresh install, update over
     an older install, re-run, the user's own config kept, missing or garbage input, every scope, every boundary -
     reading the written files, never the exit code alone;
   - the full `npm test` once, in the background, its output to a log, its tail read.

   House voice holds in every file written (single dashes; lint check 32). A case not run is reported NOT RUN.
7. Review - one fresh Opus review of the whole branch, one fix pass (each fix RED then GREEN), minors deferred to
   the ledger.
8. Commit - one commit per plan task as its commit step says, else one commit for the change; by pathspec, never
   `.gitignore` or `docs/habits-scorer-flow.html`. No version bump, push or merge without the user's word.

## The close

`execution.md`'s close - the mode and why, what changed, each tier's command with its result, what was not verified
and why - then 'Rulings I made' and 'Deferred minors' from the ledger, and `auto-run`'s close when it is on.

## Not here

- The Cursor mirror (paused since 2026-09-23).
- The stack's own `task-solve` and its seats, stamps and stops.
