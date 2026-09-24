---
description: "House baseline - quality gates: code quality and the done-claim gate. Always-on (no paths), installer-managed - update overwrites local edits."
---

# Quality gates

## Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple: no speculative abstractions; touch only what the task requires.
- Inline comments explain *why*, not *what*.

## Definition of done

### The done gate

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy this gate: build + relevant tests run, output quoted.
Bound that output: a GREEN run needs the summary line, not `--verbose` - tail long runs to the
verdict; a RED run is the opposite case - its stack traces and parse errors are the diagnosis,
earned cost, never trimmed to the verdict line. While iterating on a failure, run the ONE failing
test, file or project - the SCOPED test command this project's CLAUDE.md records beside the
full-suite one (a single project, a test filter, a spec path); the whole suite runs once, at the
gate, and its output is the summary line - the analyzer's test-run row counts scoped against
whole-suite runs per session. Satisfy the gate honestly - fix the cause, never suppress a warning,
weaken a test, or stub code to go green. Report what changed and what deliberately did not. Cannot
run it? Say so, never silently skip.

### Claims about the outside world

A green build proves the code COMPILES, never that the API it calls is current: any claim about a
package, a version floor, an API shape, a config key or a deprecation is checked against `context7`
(the docs-lookup MCP - this rule locks it into every install) at the moment you write it - the docs
are the authority, recall is not, and a wrong version-coupled claim ships silently because the
compiler has no opinion about it. Prefer the durable policy plus a fetch-at-use pointer over a
pinned number, so the artifact keeps the judgment and the drifting fact is fetched live. Use the
REGISTERED server, not a shell stand-in: a `npx`/`curl` at a registry answers a different, narrower
question (a version number, not the API shape) and leaves the server that was installed for this
unused. Its tools arrive DEFERRED - the names exist, the schemas do not - so the first use is two
calls, not one: `ToolSearch select:mcp__plugin_context7_context7__resolve-library-id,mcp__plugin_context7_context7__query-docs`,
then the query. context7 unreachable: say the claim is unverified rather than asserting it.

### Partial work

State complete vs not vs why, then put continue / redirect / stop through the AskUserQuestion tool -
one option each, recommendation marked (a prose-only ask gets skipped).

### Background work

A wait measured in MINUTES is not a foreground command. A CI run, a container build, a full suite,
an emulator boot: start it in the background and go on with work that does not depend on it, rather
than blocking the turn on it. Arm the blocking wait when you background the job, not after polling
it - the wait tool is DEFERRED, so `ToolSearch` loads it first. A polling wait or a
'what is running' answer keys on a specific PID, marker file, or output sentinel - never a bare
process-name grep (`pgrep -f 'dotnet test'` matches a sibling project's run). Task lists track
created tasks only, never background shells - check the shell's own PID and listening ports before
claiming nothing runs.

### What the run started, and what the run wrote

Started infrastructure: anything the run started or seeded to build, test, or verify - a Docker
container or compose stack, an integration-test database and its seeded data, a dev server, an
emulator, a background watcher - never outlives the work silently. At close, list exactly what
is still up and put tear-down-vs-keep through AskUserQuestion (batched into the flow's existing
close ask where one fires), teardown recommended for the disposable. The teardown RUNS AFTER that
ask is answered, never before it - a run that tore down first and asked second paid a second
up-build-down cycle when the answer arrived 1h47m later and said keep it. Never stop or wipe what
you did not start - the ask covers only what this run brought up.

Generated files are the same contract with a different default: anything the run wrote only to
build, test or verify - a scratch script or probe, a temp fixture or sandbox directory, a coverage
or log dump, a downloaded sample - is DELETED as soon as the check that needed it passes, no ask (it
is working state, not output; the ask covers only what is still running). Three exceptions survive:
the user asked for the file, a later step still needs it, or it is a real deliverable (a report
under `<docs-path>`, a committed fixture) - name those in the close. Never delete a file this run
did not create, and never leave the repo dirtier than you found it: `git status` at the close
shows only the intended change.
