# Evidence-gatherer fan-out - the main-session decision

Read in the MAIN session, before deciding whether to dispatch read-only evidence-gatherers. A
dispatched diagnoser seat never reads this file: the dispatch already answered the question.

## The ask

The read-only evidence-gatherer fan-out is judged from the run's shape - but dispatch is
explicit-only house-wide, so the seats never start on your own say-so. A calling flow that already
asked seats-or-inline (the gated investigation skill) has answered it - inherit, never re-ask;
otherwise, when a shape below warrants gatherers, put it through ONE AskUserQuestion (gatherers
recommended, the trigger named in the option's description; plain-text options where the harness
lacks the tool) and stay inline on an inline answer. A shape that stays inline needs no ask.

## The shapes

- **Dispatch gatherers** (parallel, one per failing job) when any of these holds: the evidence
  spans two or more independent sources (more than one job or matrix leg is red, or a step log
  AND a re-run); the failed step's log is huge, or `--log-failed` came back empty so the full
  step log must be walked; the triage is a matrix (first bad run vs last good, or several
  re-runs to separate a flake from a real defect); or proving a fact means a local repro run
  while the log read continues here.
- **Stay inline** when one job failed and its failed-step log is short - pull it and read it
  here; a gatherer would cost more than it saves.

## Worked example

A matrix run with three red legs - three gatherers at once, one per leg, each returning the first
real error line plus its step context. The digests come back; the code-vs-environment call and the
route stay in this session.
