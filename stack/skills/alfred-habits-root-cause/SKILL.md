---
name: alfred-habits-root-cause
description: "Use when any bug, failing test, build error or unexpected behavior needs its root cause found before any fix. Not for what a known failure signature usually means, which the signature catalogs cover, or a whole investigation from scattered evidence, which is the gated diagnose flow's job."
---

# Root cause - one hypothesis, one change, then the fix

A fix aimed at a symptom moves the failure somewhere nobody is looking. This is the loop every diagnosis in the stack runs on: the diagnoser seats preload it, the build and test resolvers localize with it, and the investigation flow proves its root cause through it. It finds the cause and says where the fix belongs; who writes the fix is the caller's scope. The loop runs on the obvious one-liner and under time pressure too - a simple bug is one fast pass, not a skipped one.

## The loop

1. **Read the whole failure.** Every line of the error, every frame, and the FIRST failure in the log rather than the last - later ones are often fallout. Quote the lines that matter before touching anything; a warning printed beside the error is evidence too.
2. **Make it fail on demand.** One command that shows it red every time. An intermittent failure is a cause not yet isolated: gather the inputs, the timing and the environment delta until it reproduces, or work from the evidence and say that it did not.
3. **Localize - walk back from where it threw.** The top frame is where the bad value landed, rarely where it was made. Follow it upstream across each boundary it crossed (a call, a process, a config load, a serialization) and check what actually crossed. Ask what changed: the diff, the last commits, a bumped dependency, the machine. In a single chat a probe settles which boundary: log what enters and leaves each one, run once, read it, then remove the probe.
4. **Compare with a case that works.** A sibling path in the same code, a passing test, the last green commit. List every difference, small ones included - that list is where the hypotheses come from.
5. **One hypothesis, one change.** Write it as one line - 'X fails because Y' - then make the smallest change or check that confirms or kills it, re-run, and read the result before the next. Two changes at once prove nothing. A killed hypothesis is progress: revert its change before the next one, and note it so it is not tried twice.
6. **Fix at the root, test first.** Where writing tests is in scope, a test that fails for the reason you found lands first. Then ONE fix for the cause - never a guard around the symptom, never a bundle of 'while I am here' edits - then the repro and the relevant suite, output quoted, per `alfred-habits-done-gate`. The repro still red after the fix means the hypothesis was wrong: revert the fix and go back to step 3.
7. **Three fixes that did not hold: stop.** Three fixes that left the repro red, or that each surfaced a failure somewhere else, mean the shape is wrong, not the line. Put the design question to whoever owns the design instead of forcing a fourth fix.

No root cause in the code - the evidence points at the environment, timing or an outside service: say what was ruled out, then handle it where it surfaces (a retry, a timeout, a clear error) and add a log point that catches it next time.

## Where a seat's scope cuts the loop

- A read-only seat (a diagnoser) runs steps 1-5, adds no instrumentation to the code and writes no fix: it reports the cause, the evidence and the route.
- A repair seat that does not write new tests (a build or test-suite resolver) runs steps 1-5, the one fix of step 6 without its failing test, and step 7.
- A single-chat run takes all seven.

## Signs the loop was skipped

Go back to step 1 on any of these:

- A change made to 'see what happens', with no hypothesis written down.
- A second change before the first one's result was read.
- A fix proposed before the failure reproduces or the evidence isolates it.
- 'It works now', with no sentence saying why.
- A test weakened, skipped or re-baselined to turn the run green.
