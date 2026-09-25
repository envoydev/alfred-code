---
name: alfred-habits-clarify
description: "Use before designing against an ambiguous feature, change or greenfield ask - a requirement that can be read more than one way. Not for how to build it: an implementation choice is decided, stated inline and recorded in the plan, which is the plan-writing habit's job."
---

# Clarify - one reading of the ask before any design

A design built on a guessed requirement is rebuilt when the guess is found out, usually after the
build. Clarifying is cheap at the start and expensive at every step after it. Gate on AMBIGUITY, not
on size or domain count: a one-file change with two readings is clarified, a large crisp one is not.

## The loop

1. **List the readings.** Read the ask for what changes, for whom, what must keep working and what
   must go away. Each place where two defensible answers lead to different designs is a reading.
   One reading left: record the ask verbatim as the requirement and go on to the design - nothing
   to ask.
2. **Ask one question at a time.** Through AskUserQuestion: the question names the fork and why it
   matters, 2-3 concrete options, the recommended one marked, free text left open (plain-text
   options where the tool is absent). One question per turn - a batch of five gets one answered.
3. **Until one reading is left.** Each answer can open or close other readings - re-read the ask with
   it before the next question.
4. **Record the answers verbatim.** They are the requirement the design builds on: the plan's
   `Asked:` line, or the `requirements_source` a dispatched designer receives. A paraphrase loses
   exactly the detail that was asked about.

## What is never asked

The implementation - library, structure, naming, pattern, placement. Those are the design's calls,
made with a precedent and recorded in the plan's `## Decisions` ledger, never bounced to the user.

## Who asks

Only the main session can talk to the user. A dispatched seat handed an ambiguous brief returns
NEEDS_CONTEXT with the readings it found instead of guessing, and the session that dispatched it
runs this loop before it dispatches again.
