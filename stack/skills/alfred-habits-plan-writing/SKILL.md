---
name: alfred-habits-plan-writing
description: "Use when writing, stamping, resuming or reading an implementation plan file under the docs root's superpowers/plans folder - after a design is settled and before the build starts, and whenever a review, build or close marks the plan. The plan file's shape: the header lines, the task card, the status marks a build adds, the Gated and Approved lines, the Decisions ledger, the Completed stamp, and what a plan never carries. Not for the design itself - that is alfred-task-design."
---

# Plan writing - the file a design hands to the build

The plan file is the handoff: the build reads its task cards, the gates stamp its header, and a
compacted or fresh session resumes from it. This is its one shape - the design writes it, the plan
audit and the build read it, and the Example in `alfred-task-design` is the same plan in chat
shorthand.

## The file

One file per scope at `<docs-path>/superpowers/plans/<feature>.md` (the folder name is the stack's
own convention). A new scope after `Completed:` starts a new file.

```text
# <Feature> - plan

Oriented: <architecture sections read, symbol calls made, house skills loaded> | none - <reason>
Asked: "<the user's words, verbatim>"
Resume: next task 1

## Fit

<extend | refactor first | isolate> - <the forcing edge, one or two sentences>

## Tasks

### Task 1 - <what the slice does, one line>

- status: TODO
- files: <path> (create | modify) - one line per file; a shared file has ONE owning task
- anchors: <file:symbol> located this session
- traps: <the stack skill's trap this slice must handle>
- test: <the test written first, and the assertion that fails before the slice lands>
- acceptance: `<command>` - <the green it must show>
- log_points: <where, level, identifiers> | none - <reason>

## Decisions

- <the choice> - precedent: <file:symbol or named rule> | no precedent - <reason>
```

## The task card

- Bite-sized: one slice a reviewer checks in one sitting, green on its own build and tests. A card
  whose title needs 'and then' is two cards.
- Build order is the order written: a card depends only on the cards above it.
- Paths and symbols are exact - located, never guessed. Code goes in a card only where the shape IS
  the decision (a signature at a seam, a schema); the build writes the rest.
- `test:` is written first and fails for the reason the card names before the slice lands. A card
  with no test of its own says why (`test: covered by task 2`, `test: none - config only`).
- `acceptance:` is a command someone can run and a result they can read; 'works' is not a result.

## What the build and the gates add

The design writes the header, the fit, the cards at `status: TODO` and the ledger. The rest is
stamped later by the flow that owns it, never pre-filled:

- `Gated: <verdict>` from the plan review, then ONE `Approved:` line under the header, in either of
  two shapes: `Approved: <date> - mode <session|agents>` from `alfred-task-solve`'s approval ask, or
  `Approved: <date> - "<the user's words, verbatim>"` when `alfred-task-implement` runs on its own.
- Each card's status: `IN_PROGRESS` before its code; `DONE (<the acceptance command's quoted
  result>)` after its gate; `IN_PROGRESS` plus `needs: <the run>` while a run it depends on has not
  happened; `FAILED` plus the ask.
- The `Resume:` line, rewritten after every task tick (next task plus any mid-task state) - never
  more than one task stale.
- `Completed: <date>` with the per-task evidence table, which closes the file.

## What a plan never carries

- The execution mode, a banner, or advice on how to run it - that is the solve flow's mode ask.
- A whole implementation pasted in - anchors and shapes, not code.
- A library or vendor claim from memory - `alfred-task-design`'s Plan format section says how
  one is cited.
