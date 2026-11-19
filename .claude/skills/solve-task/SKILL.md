---
name: solve-task
description: "Use when solving a task in this repo end to end - '/solve-task', 'solve this', 'spec, plan and build it'. This repo's own flow, not the stack's task-solve."
---

# Solve task - this repo's own flow

One change to alfred-code, from the request to a local commit, through the superpowers skills and this repo's
invariants (`AGENTS.md`). Each step that names a skill loads it with the Skill tool.

## When to use

- A change to this repo that is more than one sentence: a feature, a fix, a hook, a skill, an installer step.
- Not for a consuming project, which runs the stack's `task-solve`; not for a release, which has its own procedure.

## Size first

State one line before anything else: `Size: <trivial|spike|bounded|architectural> - <the signal>`.

- trivial - no behaviour a test would see: a typo, a comment, formatting, a rename inside one file. It just gets
  made (`.claude/rules/execution.md`), its covering check runs, done. Anything that adds or changes behaviour - a new
  flag, option, output or branch - is at least bounded, however short the request.
- spike, bounded, architectural - load superpowers:brainstorming next and take its path for this size: a spike has its question
  and probe approved first, then ends in an answer and keeps nothing in the tree - a spike branch that holds commits
  is left and named, as the `cleanup` rule says; a bounded change gets an in-chat design,
  approved as step 3 says, then the build; an architectural change takes every step below.
- A design already settled by a run order or the user's rulings skips the spec and goes to the plan.

## The four models

The `kit status` line the status hook adds to each request (or `node .claude/kit/settings.mjs`) names them:
`plan_model` writes the plan, `review_model` grades and reviews, `implement_model` builds, `search_model` finds
things in the code for the other three.

- State them under the size line: `Models: session <this session's model> - plan <m>, review <m>, implement <m>,
  search <m>`. When this session's model is not the plan model, add that the spec and every decision made here are
  this session's model's work, not the plan model's, and that `/model` before the spec changes that - then go on.
- They are what the settings select, not what this session runs on: a session cannot change its own model. A step
  whose model is this session's own runs here; any other is dispatched to an agent with that `model` - or, where no
  dispatch is available, runs here and the close says so.
- A dispatched agent cannot see this conversation. Its brief carries the files it works from - the approved spec,
  the plan, this repo's `AGENTS.md` - and names what it returns; its result is read before the next step.
- The spec is always written here, whatever the plan model: brainstorming is a conversation with the user, and an
  agent cannot hold one.
- A wide search - where a thing is defined, what calls it, how a pattern is used across the code - goes to a
  read-only search agent (`Explore` where the harness has one) with `model:` the search model, asked for paths with
  line numbers and one line on each, never a judgment on the design. Read the lines it points at before deciding
  anything on them: the search model finds, the step's own model decides. A lookup whose target is known - a named
  file, one grep - is done here, and so is every search where no dispatch is available.

## The steps

1. Spec - superpowers:brainstorming writes `docs/superpowers/specs/<date>-<topic>-design.md`.
2. Grade - `refining-plans` to the pass score, its own loop.
3. Approval - the `auto_approve` setting decides who approves the graded spec, as the `plan-approval` rule says:
   off, the user approves it and is notified that the run waits, under `auto-run` too; on, the run approves it and
   the score path is reported in place of the ask.
4. Plan - superpowers:writing-plans writes `docs/superpowers/plans/<date>-<topic>.md` from the approved spec, on the
   plan model; grade it to the pass score; approval as in step 3.
5. Build - on the implement model. superpowers:executing-plans when this session runs on it (one context,
   cheapest); otherwise superpowers:subagent-driven-development, each implementer dispatched with that `model`. Also
   subagent-driven when the user asks for a gate per task, or when all of `execution.md`'s Mode conditions hold; with
   superpowers:test-driven-development throughout. The ledger is `docs/superpowers/sdd/<plan basename>/progress.md`.
   A build from an approved plan file publishes its progress as 'The plan file' below says.
6. Checks, in the tiers of `execution.md`:
   - per batch: `npm run lint` and the tests that cover the change;
   - a temp-project matrix from this working tree with AGENTS.md's required edge cases - fresh install, update over
     an older install, re-run, the user's own config kept, missing or garbage input, every scope, every boundary -
     reading the written files, never the exit code alone;
   - the full `npm test` once, in the background, its output to a log, its tail read.

   House voice holds in every file written (single dashes; lint check 32). A case not run is reported NOT RUN.
7. Review - one fresh review of the whole branch on the review model, one fix pass (each fix RED then GREEN), minors deferred to
   the ledger.
8. Commit - one commit per plan task as its commit step says, else one commit for the change; by pathspec,
   never `.gitignore` or `docs/habits-scorer-flow.html`. A run the session loaded by itself - no `/solve-task`, no ask for this flow in the user's words - has
   no word for a commit: before its first one, in whichever step it falls, it asks once (AskUserQuestion: 'Commit
   locally (Recommended)' / 'Leave the change uncommitted') and holds the answer - on 'Leave', every commit step is
   skipped and the close lists the files left uncommitted. No version bump, push or merge without the user's word.

## The plan file

alfred-mods reads the plan's progress from a file (its README, 'Plan and score files', is the contract).

- When the build starts from an approved plan file, Write `<root>/plans/<slug>.json` under the project root. Take
  the project root, the root and the slug from the Project root, Root and Slug bullets of 'The scores file' in
  `refining-plans`, and Read that section first where this session has not loaded the skill (scoring off, a
  compaction, a dispatched seat). Resolve the root before each write. The slug is the plan's basename without a leading `YYYY-MM-DD-` and its extension.
  The score then joins the plan row.
- Fields: `version` 1, `slug`, `title` (the plan's title), `updatedAt`, `steps[]` and `changes[]`.
- `steps[]`: one per plan task, in order, `{ id, title, status, estimateMin, startedAt, doneAt }`. The id is `T<n>`
  and the title is the task's heading without its number prefix: `Task 2: Rotate tokens` gives `Rotate tokens`.
  Every step starts `pending`.
- `estimateMin`: the plan's figure where it gives one. Else the run's estimate of the builder's working minutes, with
  tests, the gate, one fix pass and build waits - not waits for the user. It can change only while the step is
  `pending`.
- Before a task starts, set it `in_progress` with `startedAt`. After its checks and gate pass, set it `done` with
  `doneAt`. Set a dropped task `skipped`.
- `changes[]` starts with `{ at, kind: 'created', source: 'claude' }`. Text the user gives to fold into the plan
  changes the affected steps and adds `{ at, kind: 'integrated', source: 'user', step, note }`, the note their words
  in 200 characters or fewer. Give `step` the step id when the text is about one step, else leave it out.
- Always rewrite the whole file with the Write tool and update `updatedAt`. Never patch it with Edit. A root that
  changed mid-build changes the path only: the steps and `changes[]` carry on.
- Every subagent dispatched on a task - implementer, reviewers, fix passes - carries the two lines `plan: <slug>` and
  `task: <step id>` in its prompt.
- A run with no plan file - a bounded change built from an in-chat design - writes no plan file.
- The file is a view, never a gate: a write the permission mode denies is skipped, the build goes on, and the close
  says so.

```json
{ "version": 1, "slug": "token-refresh", "title": "Token refresh", "updatedAt": "2026-10-27T13:41:00Z",
  "steps": [
    { "id": "T1", "title": "Add refresh endpoint", "status": "done", "estimateMin": 15, "startedAt": "2026-10-27T13:20:00Z", "doneAt": "2026-10-27T13:40:00Z" },
    { "id": "T2", "title": "Rotate tokens", "status": "in_progress", "estimateMin": 20, "startedAt": "2026-10-27T13:41:00Z" },
    { "id": "T3", "title": "E2E tests", "status": "pending", "estimateMin": 15 } ],
  "changes": [ { "at": "2026-10-27T13:05:00Z", "kind": "created", "source": "claude" } ] }
```

## The close

`execution.md`'s close, then one line per step with the model it actually ran on (`here - <this session's model>`,
or the dispatched model) and one for the searches, then 'Rulings I made' and 'Deferred minors' from the ledger, and
`auto-run`'s close when it is on.

## Not here

- The stack's own `task-solve` and its seats, stamps and stops.
