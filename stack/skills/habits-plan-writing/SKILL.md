---
name: habits-plan-writing
description: "Use when writing, stamping or resuming a plan file - 'write a plan', 'write it up as a plan'. Not for the design, which task-design owns."
---

# Plan writing - the file a design hands to the build

The plan file is the handoff: the build reads its task cards, the gates stamp its header, and a
compacted or fresh session resumes from it. This is its one shape - the design writes it, the plan
audit and the build read it.

## When to use

- Fires after a design is settled and before the build starts, and whenever a review, build or close marks the plan.
- The plan folder's shape: the Markdown's header and task card, what the script records in `status.json`, the frozen rule, the flat shape kept until 4.0.0, and what a plan never carries.
- Not for the design itself - that is task-design.

## The folder

One folder per scope at `<docs-path>/work/plans/<feature>/`, holding three files:

- `<feature>.md` - the design: the header, the fit, the task cards, the design-time decisions, the optional list. The design writes it; it is frozen at approval.
- `status.json` - what the gate, the approval and the build record. Written only by `node .claude/hooks/plan-status.js`.
- `scoring.json` - the grades. Written only by the scoring script, and absent until the plan was graded.

Never edit `status.json`, `scoring.json` or an approved plan: the script is the only writer. A new scope after the plan is completed starts a new folder. `<feature>` names the folder and the Markdown, and doubles as the plan id the approval stamp and every implementer brief's `plan:` line carry: letters, digits, `.`, `_` and `-` only, a letter or digit first, no dot last, never a Windows device name (`con`, `nul`, `com1`).

Where a `scoring: on` line naming the designer plan file or a `scoring: stacked` line is in context, the FIRST action before releasing the plan - before `<feature>.md` is written to that path - is the `mode-output-scoring` Skill call with output `designer-plan`.

```text
# <Feature> - plan

Oriented: <architecture sections read, symbol calls made, house skills loaded, preference and assessment docs read> | none - <reason>
Asked: "<the user's words, verbatim>"
Build: <the gate commands as the project runs them - build, tests, lint; the final gate's affected-set command>

## Fit

<extend | refactor first | isolate> - <the forcing edge, one or two sentences>

## Tasks

### Task 1 - <what the slice does, one line>

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

A prior plan consulted as a format reference is read scoped - the header plus one task entry, never the
whole file, and never another ticket's plan in place of this shape.

## The task card

- Bite-sized: one slice a reviewer checks in one sitting, green on its own build and tests. A card
  whose title needs 'and then' is two cards.
- Build order is the order written: a card depends only on the cards above it.
- Paths and symbols are exact - located, never guessed. Code goes in a card only where the shape IS
  the decision (a signature at a seam, a schema); the build writes the rest.
- `test:` is written first and fails for the reason the card names before the slice lands. A card
  with no test of its own says why (`test: covered by task 2`, `test: none - config only`).
- `acceptance:` is a command someone can run and a result they can read; 'works' is not a result.
- `estimate:` is the working minutes the slice takes the agent that builds it, not wall-clock time: the test, the code, the card's gate and one fix pass. Time spent waiting (a CI run, a deploy, an answer) is not counted. One whole number in steps of 5, never a range. A card with no estimate is not forecast, so the line is optional; a plan that carries any carries one on every card.
- Work `Asked:` does not name never becomes a card: it is one `## Optional` line, marked Recommended or Not worth it
  with the reason, unless the user asked for it (a Decision carries `asked: <the answer>`) or the request cannot be
  met safely without it - then it is a card, and a Decision says why.
  No extras, no section.

A documentation plan - pages, sections or docs files, no product code - takes the documentation card:
four fields in place of `files`, `anchors`, `traps`, `test`, `acceptance` and `log_points`, the
`estimate:` line and the header unchanged.

```text
### Task 1 - <the page or section, and what changes in it>

- target: <the page, section or docs file> (create | modify)
- change: <what a reader will find different, one or two lines>
- evidence: <the code, config or source each claim rests on - file:symbol or URL> located this session
- verification: <how the result is checked - a read-back of the written or published page, a link check>
- estimate: <N>m
```

## What the script records

Everything stamped after the design goes through one script, run from the project's folder. Flags carry ids and fixed words; every sentence goes on stdin as `label: text` lines. `--plan` is the plan folder, its Markdown or the bare id, spelled out in the command - never held in a variable.

```text
node .claude/hooks/plan-status.js done --plan <docs-path>/work/plans/<feature> --task 3 <<'EOF'
result: <the acceptance command> - <its quoted result>
EOF
```

The heredoc is one way to hand the text over; any shell's way of piping text in works.

| When | Verb, flags and stdin labels |
|---|---|
| the plan is written, and after every edit to it before approval | `sync` |
| the plan review's eight-field block | `gate` - the block on stdin, as printed |
| the approval | `approve --mode session` or `--mode agents`; on its own, `words:` the user's, verbatim |
| before a task's code | `start --task <id>` |
| after its gate | `done --task <id>` - `result:` |
| a task waiting on a run that has not happened | `block --task <id>` - `needs:` |
| a task that failed, before its ask | `fail --task <id>` - `why:` |
| a done task found wrong | `reopen --task <id>` - `why:` |
| a judgment call the card left open | `decide` (`--task <id>` when it belongs to one) - `choice:`, `precedent:` |
| a card built differently from what it says | `deviate` - `what:`, `why:`, and `asked:` the user's answer when it changes what the user sees |
| a card added or split mid-build | `add-task` (`--after <id>` to place it) - the card on stdin, its heading `### Task - <title>` with no number |
| a card dropped | `drop --task <id>` - `why:` |
| every stop, and any mid-task state | `cursor` - `note:` the step and the modes |
| the conformance verdict | `conformance` - `verdict:` and `reviewer:`, or `skipped:` the user's words |
| the close | `complete` (`--with-open` when a task is left open) - `suite:` the final gate's command and its quoted result |

Each call prints the stamp it set and ends with the `Resume:` line - the note, then the next task. A refusal prints one line saying why and writes nothing; `nothing to change` is not an error. A status file the script cannot read is the user's to repair - say so and stop.

Three calls read: `resume` prints the stamps, the plan's header and each open card - what a compacted or fresh session reads to continue, never the closed cards. `show` prints the stamps alone, the block a stop quotes. `show --full` adds what the build recorded: each task's result, the decisions, the deviations, the dropped tasks and the added cards.

## Frozen at approval

After the approval the Markdown is not edited. A departure takes one of two routes:

- **It keeps the design** - recorded through the script: a judgment call (`decide`), a card built differently (`deviate`), a card added or split (`add-task`), a card dropped (`drop`). A departure that changes what the user sees, which `Asked:` does not name, needs the user's answer, quoted as `asked:`.
- **The design proves wrong** - the user's answer reopens it: `redesign` (`--task <id>` for the task in flight, which goes back to waiting; `why:` on stdin). The Markdown is editable again, the plan review runs again, and `approve` closes the reopen. Until then no task is started or ticked.

An estimate is rewritten with its card's scope only before approval, followed by `sync`. Scope found mid-build is a new card through `add-task` with its own estimate.

## What a plan never carries

- The execution mode, a banner, or advice on how to run it - that is the solve flow's mode ask.
- A whole implementation pasted in - anchors and shapes, not code.
- A library or vendor claim from memory - verify it via the documentation tools or the vendor doc and cite it,
  or mark it `unverified`.

## Flat plans (until 4.0.0)

A plan written before the folder shape is one file, `<docs-path>/work/plans/<feature>.md`. It is read and stamped where it is - never moved, never converted, and no new plan is written this way. It has no `status.json`, so the script does not take it, and its stamps go into the file:

- the header carries a `Resume:` line and each card a `- status:` line (`TODO`, `IN_PROGRESS`, `DONE (<the acceptance command's quoted result>)`, `IN_PROGRESS` plus `needs: <the run>`, `FAILED` plus the ask);
- the plan review's eight-field block, `Gated:` last, then ONE `Approved:` line under the header (`Approved: <date> - mode <session|agents>`, or `- "<the user's words, verbatim>"`);
- build-time judgment calls are appended to its `## Decisions` ledger;
- `Resume:` is rewritten after every tick and at every stop, and a card ticked `DONE` collapses to its title, its status line, its `estimate:` line and one evidence pointer;
- `Completed: <date>` with the per-task evidence table closes the file, and a new scope after it starts a new plan.
