---
name: habits-plan-writing
description: "Use when writing, stamping, resuming or reading a plan file - 'write a plan', 'write it up as a plan'. Not for the design, which task-design owns."
---

# Plan writing - the file a design hands to the build

The plan file is the handoff: the build reads its task cards, the gates stamp its header, and a
compacted or fresh session resumes from it. This is its one shape - the design writes it, the plan
audit and the build read it.

## When to use

- Fires after a design is settled and before the build starts, and whenever a review, build or close marks the plan.
- The plan file's shape: the header lines, the task card, the status marks a build adds, the Gated and Approved lines, the Decisions ledger, the Completed stamp, and what a plan never carries.
- Not for the design itself - that is task-design.

## The file

One file per scope at `<docs-path>/work/plans/<feature>.md`. A new scope after `Completed:` starts a new file. `<feature>` doubles as the plan id the approval stamp and every implementer brief's `plan:` line carry, so it takes letters, digits, `.`, `_` and `-` only, starting with a letter or digit.

Where a `scorer: on` line naming the designer plan file or a `scorer: stacked` line is in context, the FIRST action before releasing the plan file - before it is written to that path - is the `mode-output-scorer` Skill call with output `designer-plan`.

```text
# <Feature> - plan

Oriented: <architecture sections read, symbol calls made, house skills loaded, preference and assessment docs read> | none - <reason>
Asked: "<the user's words, verbatim>"
Build: <the gate commands as the project runs them - build, tests, lint; the final gate's affected-set command>
Resume: next task 1

## Fit

<extend | refactor first | isolate> - <the forcing edge, one or two sentences>

## Tasks

### Task 1 - <what the slice does, one line>

- status: TODO
- files: <path> (create | modify) - one line per file; a shared file has ONE owning task
- anchors: <file:symbol> located this session
- traps: <the stack skill's trap this slice must handle>, and each recorded weakness in the files this slice touches - the assessment entry's title and its path:line - fixed in this slice, or left with no new case added
- test: <the test written first, and the assertion that fails before the slice lands>
- acceptance: `<command>` - <the green it must show>
- log_points: <where, level, identifiers> | none - <reason>
- estimate: <N>m

## Decisions

- <the choice> - precedent: <file:symbol or named rule> | no precedent - <reason>
- <a change to what the user sees that Asked: does not name> - asked: <the user's answer>

## Optional

- <work Asked: does not name> - Recommended - <reason> | Not worth it - <reason>
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
- `estimate:` is the working minutes the slice takes the agent that builds it, not wall-clock time: the test, the code, the card's gate and one fix pass. Time spent waiting (a CI run, a deploy, an answer) is not counted. One whole number in steps of 5, never a range. A card with no estimate is not forecast, so the line is optional; a plan that carries any carries one on every card. A card's estimate is rewritten in the same edit that changes its scope (`files`, `test`, `acceptance`) or adds or splits it, and only while the card is `TODO`. From `IN_PROGRESS` on it is frozen, because the forecast compares finished cards with their original estimates: scope found mid-build becomes a new card with its own estimate.
- Work `Asked:` does not name never becomes a card: it is one `## Optional` line, marked Recommended or Not worth it
  with the reason, unless the user asked for it (a Decision carries `asked: <the answer>`) or the request cannot be
  met safely without it - then it is a card, and a Decision says why.
  No extras, no section.

A documentation plan - pages, sections or docs files, no product code - takes the documentation card:
four fields in place of `files`, `anchors`, `traps`, `test`, `acceptance` and `log_points`, the status
marks, the `estimate:` line and the header unchanged.

```text
### Task 1 - <the page or section, and what changes in it>

- status: TODO
- target: <the page, section or docs file> (create | modify)
- change: <what a reader will find different, one or two lines>
- evidence: <the code, config or source each claim rests on - file:symbol or URL> located this session
- verification: <how the result is checked - a read-back of the written or published page, a link check>
- estimate: <N>m
```

## What the build and the gates add

The design writes the header, the fit, the cards at `status: TODO` and the ledger. The rest is
stamped later by the flow that owns it, never pre-filled:

- The plan review's eight-field block, its `Gated: <verdict>` line last, then ONE `Approved:` line under the header, in either of
  two shapes: `Approved: <date> - mode <session|agents>` from `task-solve`'s approval ask, or
  `Approved: <date> - "<the user's words, verbatim>"` when `task-implement` runs on its own.
- Each card's status: `IN_PROGRESS` before its code; `DONE (<the acceptance command's quoted
  result>)` after its gate; `IN_PROGRESS` plus `needs: <the run>` while a run it depends on has not
  happened; `FAILED` plus the ask.
- The `Resume:` line, rewritten after every task tick (next task plus any mid-task state) - never
  more than one task stale. Inside the solve flow it is the one cursor and leads with the step and
  the modes (`Resume: step 4 BUILD - mode session - next task 2`), rewritten at every stop too.
- `Completed: <date>` with the per-task evidence table, which closes the file.

A card ticked `DONE` collapses to its title, its status line, its `estimate:` line and one evidence pointer - its hypothesis logs,
measurement rows and probes go, since every resume reads the file and every later message carries it. A resume
reads the header, the `Resume:` line and the open cards, never the closed ones whole.

A prior plan consulted as a format reference is read scoped - the header plus one task entry, never the
whole file, and never another ticket's plan in place of this shape.

## What a plan never carries

- The execution mode, a banner, or advice on how to run it - that is the solve flow's mode ask.
- A whole implementation pasted in - anchors and shapes, not code.
- A library or vendor claim from memory - verify it via the documentation tools or the vendor doc and cite it,
  or mark it `unverified`.
