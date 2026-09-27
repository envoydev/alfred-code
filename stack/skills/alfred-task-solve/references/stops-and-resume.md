# Stops and resume - the state and the stop contract in full

Read on a resumed cycle before its first ask, and at the first ask that carries the fresh-session option.
SKILL.md states each rule; this file keeps the example, the reasons and the measurements behind them.

**Contents:** [State](#state---two-layers-split-by-durability), [The stop contract](#the-stop-contract)

## State - two layers, split by durability

- **The plan file** (`<docs-path>/superpowers/plans/<feature>.md`) is the durable truth: the tasks, every stamp this cycle adds (`Gated`, `Approved` +
  build mode, `Conformance` verdict or `skipped`, `Completed`), per-task status + evidence. On any
  conflict with memory or the chat, the file wins.
- **The navigation server cycle note** (`write_memory` named `<feature>__cycle`) is the working cursor:
  current step, chosen modes, resume pointer (plan path + next task), any mid-task scratch worth
  carrying. Update it at EVERY stop and after every task tick; it is never more than one step
  stale when compaction hits. Local and disposable - everything essential is in the plan file.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the feature's cycle
note (or an equivalent direct read of `.serena/memories/` - the note's content is the contract,
not the tool route), and read the plan file's stamps. A cycle mid-flight resumes at its cursor - never restart a
step whose stamp says it already passed. A NEW cycle starting after a finished one in this same
session recommends the fresh-session hand-off in its first ask - the finished cycle's carried
context compounds into every later call. A cycle mid-build looks like:

```
plan <docs-path>/superpowers/plans/csv-export.md:
  Gated: passed | Approved: 2026-07-16 - mode session
  task 1 DONE (dotnet test green - 4 passed) | task 2 IN_PROGRESS
cycle note 'csv-export__cycle': step 4 BUILD - resume at task 2, mode session
```

## The stop contract

A stop IS one AskUserQuestion call: report THREE named fields, then put the next move through the
AskUserQuestion tool - EVERY stop, the plain step-done ones included.

```
Result:    <one line> - <the artifact path>
Progress:  <N> of <M> steps
Leftovers: <what this run started and did not finish | none>
```

Named fields, not prose about them: the named form survives a compaction where the prose
equivalent does not, and `Leftovers:` exists because an unreviewed fix delta otherwise sits
unnoticed - `none` is an answer, an omitted line is not. Markdown-bold (`**Result:**`) is the same
format and counts; a status table instead of the names does not. The stop-contract hook reads the
turn's prose and the ask's own text for all three names and says so when one is missing (measured:
13 sessions loaded this contract, 5 used the fields at all, across 109 asks).

### Every stop is a decision, and the fresh-session resume

There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete - the next step (named), the route-back where the step surfaced gaps or findings, the
fresh-session resume on a long cycle (below), any conflict's real resolutions - the
recommendation marked per that stop's own rule, free text always available via the built-in
Other. This is not a preference: a contract scoped to 'decision-carrying' stops lets a run
classify every plain stop out of the mandate and stall in prose - a question with options gets
answered, a prose 'how shall I proceed' gets skimmed. Where the harness has no such tool, list the same options in plain text
and END THE TURN. The question never closes the user's window: they can interrupt it to switch
model or effort, paste context, or edit the plan file directly, then answer - and the stop is
the cheap point to run the next step in a fresh session (`/clear`): resume needs only the plan
file + cycle note, so the step starts at a few k of context - in a long cycle the carried-forward
context is the single biggest token cost (a resume restarts at 21.5-59.4% of the carried context with zero
re-work - state those two absolute numbers to the user, never a ratio). On a long cycle this is a step,
not an offer to remember: once the cycle has crossed the install's fresh-session trigger for its context
window (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window),
spans hours, or resumes after an idle gap, the fresh-session resume IS one of the next ask's options - every
ask until it is taken or the cycle closes. The two absolute numbers are handed to you, not
estimated: on any of those three conditions the stop-contract hook injects this session's measured
carry per message and the cold floor a fresh one restarts at, before the ask is built - quote those,
and if the injection is absent say the numbers are unmeasured rather than inventing a fraction. And HONOR the answer: when the user picks it, the
turn ends with a short ack plus the paste-ready resume block - no 'one more step', no new work
in this chat. This is a CONSTRUCTION check, not a memory: before
emitting any stop's AskUserQuestion, ask 'has this cycle crossed the trigger?' - if yes and the
option list has no fresh-session entry, the question is malformed, rebuild it - only a per-ask
check survives a long cycle. The selected answer is the go; silence is not, and a stop that only narrates is not a stop.
