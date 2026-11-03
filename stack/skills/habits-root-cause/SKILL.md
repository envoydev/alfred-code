---
name: habits-root-cause
description: "Use when a failure's cause is unproven, before any fix - red test, build or auth error, stack trace, flaky run. Not for a known error code, which catalogs hold."
user-invocable: false
---

# Root cause - one hypothesis, one change, then the fix

A fix aimed at a symptom moves the failure somewhere nobody is looking. It finds the cause and says where the fix belongs; who writes the fix is the caller's scope. The loop runs on the obvious one-liner and under time pressure too - a simple bug is one fast pass, not a skipped one.

## When to use

- Fires BEFORE the first fix is written, for: a red test, a build or compile error, an auth or connection failure (a 401 / 403, a rejected token), a stack trace, an exception, a crash, a flaky or intermittent failure, a regression, wrong output, 'it worked yesterday' - and again when a fix did not hold.
- The debugging method that proves the cause before any change is made to fix it.
- Not for what a known failure signature or error code usually means, which the signature catalogs cover, or a whole investigation from scattered evidence (logs, monitors, a customer report), which is the gated diagnose flow's job.

## A broken build or red suite

Where this chat can dispatch seats and the roster holds a resolver for the stack - a build-error resolver for a broken build, a test-failure resolver for a red suite once the build is green (the stack's repair rule names them) - delegating beats looping in-session: the resolver absorbs the repeated build and test output and returns only a diagnosis. The run's session-or-agents pick, or the user's word, decides - absent both, offer the resolver through AskUserQuestion (resolver seat vs in-session fix, resolver recommended) - that ask comes before step 1 of the loop, and an in-session pick then starts at step 1. Dispatch the resolver exactly as the roster spells it.

```ask
The <build | suite> is red. Hand it to the <build-error | test-failure> resolver, or fix it in this session?
- 'Resolver seat (Recommended)' - it absorbs the repeated build and test output and returns only a diagnosis
- 'Fix it in this session' - the loop below runs here, from step 1
```

- A resolver that stops as BLOCKED_CONTRACT_CHANGE hit a fix needing a shared-contract change - outside its bounded scope by design; a running `task-solve-cross` flow handles it per its contract protocol - otherwise name `/task-solve-cross` as the user's next step (the skill is manual-only; a model Skill call is blocked). Never edit the contract to go green.
- A return with no closing status line - a seat stopped at its `maxTurns` (Claude Code marks the output partial from 2.1.246) or killed mid-task - is never DONE and never resumed as-is, since a resume hands a runaway a fresh budget: re-dispatch it ONCE with a scoped resume brief (its handoff note and partial diff name what landed); a second status-less return from that task goes to the user as BLOCKED.

## The loop

1. **Read the whole failure.** Every line of the error, every frame, and the FIRST failure in the log rather than the last - later ones are often fallout. Quote the lines that matter before touching anything; a warning printed beside the error is evidence too.
2. **Make it fail on demand.** One command that shows it red every time. An intermittent failure is a cause not yet isolated: gather the inputs, the timing and the environment delta until it reproduces, or work from the evidence and say that it did not.
3. **Localize - walk back from where it threw.** The top frame is where the bad value landed, rarely where it was made. Follow it upstream across each boundary it crossed (a call, a process, a config load, a serialization) and check what actually crossed. Ask what changed: the diff, the last commits, a bumped dependency, the machine. In a single chat a probe settles which boundary: log what enters and leaves each one, run once, read it, then remove the probe.
4. **Compare with a case that works.** A sibling path in the same code, a passing test, the last green commit. List every difference, small ones included - that list is where the hypotheses come from.
5. **One hypothesis, one change.** Write it as one line in your reply BEFORE the change - 'X fails because Y' - then make the smallest change or check that confirms or kills it, re-run, and read the result before the next. A cause worked out silently and stated only in the close is not a hypothesis - it is the fix explaining itself afterwards. Two changes at once prove nothing. A killed hypothesis is progress: revert its change before the next one, and note it so it is not tried twice.
6. **Fix at the root, test first.** Where writing tests is in scope, a test that fails for the reason you found lands first. Then ONE fix for the cause - never a guard around the symptom, never a bundle of 'while I am here' edits - then the repro and the relevant suite, output quoted, per `habits-done-gate`. The repro still red after the fix means the hypothesis was wrong: revert the fix and go back to step 3.
7. **Three fixes that did not hold: stop.** Three fixes that left the repro red, or that each surfaced a failure somewhere else, mean the shape is wrong, not the line. Put the design question to whoever owns the design - in a chat, ONE AskUserQuestion with the redesign recommended; a seat returns it in its report - instead of forcing a fourth fix. Each option names the measured quantity it changes, and what it claims about it ('memory stays bounded') agrees with the runs so far.

   ```ask
   Three fixes left <the repro> red. Redesign <the part> or try a fourth fix?
   - 'Redesign <the part> (Recommended)' - <the measured quantity it changes, and what it claims about it>
   - 'One more fix at <the line>' - <what it changes; why the three before it did not hold>
   ```

No root cause in the code - the evidence points at the environment, timing or an outside service: say what was ruled out, then handle it where it surfaces (a retry, a timeout, a clear error) and add a log point that catches it next time.

## Where a seat's scope cuts the loop

- A read-only run - a diagnoser seat, or the gated diagnose flow in this chat - runs steps 1-5, adds no instrumentation to the code and writes no fix: it reports the cause, the evidence and the route.
- A repair seat that does not write new tests (a build or test-suite resolver) runs steps 1-5, the one fix of step 6 without its failing test, and step 7.
- A single-chat run takes all seven.
- A seat with no Agent tool (an implementer or a resolver) does NOT delegate - the resolver routing above is the orchestrator's; run your own bounded fix loop and report the red per your cap. A read-only seat (a verifier, a designer, a reviewer, an analyzer) has no Edit to loop with: it reports the red and names the resolver. A diagnoser carries the Agent tool but its one sanctioned dispatch is the evidence-gatherer: it names the resolver in its report, never dispatches one.

## Signs the loop was skipped

Go back to step 1 on any of these:

- A change made to 'see what happens', with no hypothesis written down.
- A second change before the first one's result was read.
- A fix proposed before the failure reproduces or the evidence isolates it.
- 'It works now', with no sentence saying why.
- A test weakened, skipped or re-baselined to turn the run green.
