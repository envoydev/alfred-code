---
name: alfred-habits-done-gate
description: "Use before saying your own change is done, fixed, passing, works or ready: build and the relevant tests run after the last edit, output quoted, a green summary vs a red trace, scoped runs while iterating and the full suite once, never a gamed pass."
---

# Done gate - the run after the last edit is the evidence

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy this gate: build + relevant tests run after the last edit, output quoted - an earlier run
proves the earlier code. The per-task gate of a build, a verifier's acceptance check and a session's
close all run on this one gate.

## The gate

1. **Run after the last edit.** Any edit since the run - one line, a rename, a config key - makes
   that run stale. Run the build and the tests that cover the change again, now.
2. **Quote what the run proves.** A GREEN run needs the summary line, not `--verbose` - tail long
   runs to the verdict. A RED run is the opposite case - its stack traces and parse errors are the
   diagnosis, earned cost, never trimmed to the verdict line.
3. **Scoped while iterating, the full suite once.** While iterating on a failure, run the ONE
   failing test, file or project - the SCOPED test command this project's CLAUDE.md records beside
   the full-suite one (a single project, a test filter, a spec path). The whole suite runs once, at
   the gate, and its output is the summary line - the analyzer's test-run row counts scoped against
   whole-suite runs per session.
4. **Honest, or not at all.** Fix the cause - never suppress a warning, weaken a test, or stub code
   to go green.
5. **Report the edges.** Say what changed and what deliberately did not. Cannot run it? Say so,
   never silently skip: 'not run - <why>' is a result, 'done' over an unrun change is not.

## Signs the gate was skipped

Go back to step 1 on any of these:

- 'Should pass now' or 'this fixes it', with no run after the change.
- A run quoted from before the last edit.
- A green claim over a red run, an unread run, or a pipe that hid the verdict.
- A test, a warning or a check switched off on the way to green.
