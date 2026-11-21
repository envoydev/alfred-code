---
name: fix-loop
description: "Use when running review and fix rounds - 'fix until no issues are left', 'review round N', a reviewer's findings list to work through. Not for one fix."
---

# Fix loop - a budget, a grade per finding, no new capability

A review-fix loop ends when a round finds nothing worth fixing, not when nothing can be found. A guard, a parser or a
checker can always be beaten by a more deliberate input, so a loop that fixes every finding never ends: each round adds
a capability, and the next rounds are mostly that capability's bugs.

## When to use

- A loop of review rounds and fix passes: 'fix until no issues are left', 'keep reviewing until it is clean', 'round 4
  of the review', a list of findings handed over to fix.
- Not for a single bug fix or a single review with no loop after it.

## Before round 1

Your first message opens with this line, before you read the code or edit anything:
`Loop: at most <N> rounds, ends <date or the session's end> - fix: honest bypass, crash or hang, regression; defer the rest`.
N is 3 unless the user named another number. A loop already past its budget stops now and says so. The line is the
budget the user can hold you to; a budget stated only in the close was never a budget.

## Grade every finding before the fix pass

Each finding gets one grade, written in the round's list before any edit:

- **honest** - an input a person types in normal work gets the wrong verdict: a short flag (`-f`), an option after the
  target, a second space. Fix.
- **crash** - the code throws, exits wrong or hangs on an input it can meet (empty stdin, garbage JSON). Fix.
- **regression** - something an earlier round or the original code handled is broken now. Fix.
- **deferred** - anything else: an input built to get past the check (a value in a variable, an alias, `eval`,
  `bash -c`, a substitution), a rename or another style point, a case no one reported. Write it under `Deferred:` with
  one line on what fixing it would add, and do not touch it.

A fix adds no capability: no new parser, expander, resolver or input format, and no reading of a source the code did
not read before (git config, the environment, another file). A finding that needs one is deferred whatever its grade
would be.

## Each round

1. Grade the findings, as above.
2. Fix the honest, crash and regression findings, each with a test that fails before the fix.
3. Run the tests.
4. Review only the diff of this round for honest, crash and regression findings. New findings outside that diff are
   deferred.
5. Stop when a round grades no finding honest, crash or regression, or the budget runs out.

## The close

`Loop: <rounds used> of <N> - fixed: <count> - deferred: <count>`, then the `Deferred:` list, one line each with what
fixing it would add. Never 'all findings fixed' when some were deferred.

## Excuses and what answers them

- 'It is a real bypass' - it is, and it is deferred: a deliberate bypass is closed by a capability, and a capability is
  a design change for the user, not a fix inside a loop.
- 'It is only a few lines' - the lines are the capability; its bugs fill the next rounds.
- 'The user said until no issues are left' - an issue is an honest, crash or regression finding; the deferred list
  hands the rest back to the user.
- 'I found more gaps while re-reviewing' - outside this round's diff, so deferred.

## Signs it was skipped

- No `Loop:` line before the first edit.
- A fix that adds a tokenizer, an expander, a config read or a new syntax.
- A close saying every finding was fixed when one needed a capability.
