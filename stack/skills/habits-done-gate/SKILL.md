---
name: habits-done-gate
description: "Use before saying your own change is done, fixed, passing, working, ready or 'should work now'. Not for someone else's change, which a code review owns."
---

# Done gate - the run after the last edit is the evidence

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy this gate: build + relevant tests run after the last edit, output quoted - an earlier run
proves the earlier code. The per-task gate of a build, a verifier's acceptance check and a session's
close all run on this one gate.

## When to use

- Before any claim about your own change: done, fixed, passing, working, ready, resolved, all green, 'should work now'.
- The moment after the last edit of a feature, bug fix, refactor or config change, and before the close, a task
  ticked DONE, a plan stamped Completed or a commit.
- The verification gate for your own work, including the honest close when nothing can run here (a project with no
  tests, an instruction against running them).
- Not for reviewing someone else's change, which is a code review's job, or the commit itself, which the commit
  checkpoint owns.

## The gate

1. **Run after the last edit.** Any edit since the run - one line, a rename, a config key - makes
   that run stale. Run the build and the tests that cover the change again, now - plus the project's
   format check where it has one (a `format:check` script, the CI workflow's format step): CI fails
   on it as hard as on a red test, and lint plus typecheck green says nothing about it.
2. **Quote what the run proves.** A GREEN run needs the summary line, not `--verbose` - tail long
   runs to the verdict. A RED run is the opposite case - its stack traces and parse errors are the
   diagnosis, earned cost, never trimmed to the verdict line. A claim about a NAMED test inside a run
   ('X passes in full-suite order', 'the other 37 fail for Y') quotes that test's own line from the
   run's saved log, found by its name (`grep -n '<test name>' <log>`); a claim about every failure
   counts and reads the whole list - a `head` of it proves the lines it printed and nothing past them.
3. **Scoped while iterating, the full suite once.** While iterating on a failure, run the ONE
   failing test, file or project - the SCOPED test command this project's AGENTS.md records beside
   the full-suite one (a single project, a test filter, a spec path). The whole suite runs once, at
   the close gate (a seat's per-task gate runs the scope its brief names), and its output is the
   summary line.
4. **Honest, or not at all.** Fix the cause - never suppress a warning, weaken a test, or stub code
   to go green.
5. **Report the edges.** Say what changed and what deliberately did not. Cannot run it? Say so,
   never silently skip: 'not run - <why>' is a result, 'done' over an unrun change is not.

## Signs the gate was skipped

Go back to step 1 on any of these:

- 'Should pass now' or 'this fixes it', with no run after the change.
- A run quoted from before the last edit.
- A green claim over a red run, an unread run, or a pipe that hid the verdict.
- A claim about a named test, or about all the failures, resting on a `head` of the log that never printed it.
- A test, a warning or a check switched off on the way to green.
