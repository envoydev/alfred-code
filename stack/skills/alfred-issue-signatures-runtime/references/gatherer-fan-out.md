# Evidence-gatherer fan-out - the main-session decision

Read in the MAIN session, before deciding whether to dispatch read-only evidence-gatherers. A
dispatched diagnoser seat never reads this file: the dispatch already answered the question.

## The ask

The read-only evidence-gatherer fan-out is judged from the evidence's shape - but dispatch is
explicit-only house-wide, so the seats never start on your own say-so. A calling flow that already
asked seats-or-inline (the gated investigation skill) has answered it - inherit, never re-ask;
otherwise, when a shape below warrants gatherers, put it through ONE AskUserQuestion (gatherers
recommended, the trigger named in the option's description; plain-text options where the harness
lacks the tool) and stay inline on an inline answer. A shape that stays inline needs no ask.

## The shapes

- **Dispatch gatherers** (parallel, one per source) when any of these holds: the evidence spans
  two or more independent sources (a server log AND a DB state AND a repro run); a log or trace
  runs to hundreds of lines, so reading it here would flood the context the diagnosis needs; the
  repro is a matrix (several inputs/orderings for an intermittent failure); or proving a fact
  means running the app while the reasoning continues here.
- **Stay inline** when the evidence is one pasted stack trace, a short log excerpt, or already
  in the chat - a gatherer would cost more than it saves.

## Worked example

'The list endpoint 500s on some months, prod DB snapshot and ops log attached' - three gatherers at
once: one windows the ops log to the failing requests, one inspects the suspect DB rows, one curls
the month matrix against a local run. Their digests come back; the signature match, the judgment,
and the fix-route gate stay in this session.

## Never the diagnoser seat

Do NOT dispatch the diagnoser seat from this skill - the catalogue is already in context, so the
seat would only duplicate it; the seat exists for the orchestrated issue flow and direct @agent-
calls, where it runs this same file in an isolated context with the same gatherer fan-out.
